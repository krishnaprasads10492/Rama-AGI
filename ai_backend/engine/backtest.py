"""
backtest.py — walk-forward evaluation of the actual predictor.

WHAT THIS REPLACES (spec Section 66). The previous file had five defects and ~200 lines
of dead code, and it did not test the predictor at all:

  1. Four functions were defined TWICE. Python kept the second, so the first ~210 lines
     were unreachable — including a `run_backtest` whose signature did not match what
     `main.py` calls.
  2. `grade` was computed as `0.5 + rr*0.1 + (0.05 if outcome != "SL_HIT" else -0.1)` —
     **derived from the realized outcome**. The reported grade distribution was read off
     the answer key. Straight lookahead.
  3. `TIMEOUT` was booked as a **full stop-loss**. A signal that simply expired flat was
     recorded as a maximum loss, so every loss statistic was overstated.
  4. T2 and T3 wins were credited at **T1 size**, so wins were understated while losses
     were overstated — biasing P&L, Sharpe and Calmar in opposite directions at once.
  5. Windows advanced by `test_size // 10`, so with a 60-bar window a new one started
     every 6 bars and **each bar was re-tested about ten times**. `signalsTested` was
     inflated an order of magnitude and the "independent" windows were near-duplicates.
  6. `train_size` was computed and never used to fit anything. `MODEL_REGISTRY` was
     never touched. It measured a fixed ATR bracket, not the ensemble — so it could
     never answer the only question that matters: does the prediction work?

INTRABAR AMBIGUITY, STATED. When a bar's range contains both the stop and a target,
OHLC cannot say which was touched first. This assumes the **stop** hit first. That is
the conservative choice and it is deliberate: the alternative flatters the strategy, and
a backtest that flatters is worse than none.
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("stockmind-ai.backtest")

# ── Constants ─────────────────────────────────────────────────────────────────

ACCURACY_FLOOR   = 0.75      # retained for the response contract; no longer a verdict
ACCURACY_CEILING = 0.97
MIN_BARS_TRAIN   = 500
MIN_BARS_TEST    = 60

TIMEFRAME_PRESETS = {
    "1M":  {"days": 30,   "min_bars": 20,  "label": "1 Month"},
    "3M":  {"days": 90,   "min_bars": 60,  "label": "3 Months"},
    "6M":  {"days": 180,  "min_bars": 120, "label": "6 Months"},
    "1Y":  {"days": 365,  "min_bars": 250, "label": "1 Year"},
    "2Y":  {"days": 730,  "min_bars": 500, "label": "2 Years"},
    "3Y":  {"days": 1095, "min_bars": 750, "label": "3 Years"},
    "5Y":  {"days": 1825, "min_bars": 1250,"label": "5 Years"},
    "10Y": {"days": 3650, "min_bars": 2500,"label": "10 Years"},
    "MAX": {"days": 99999,"min_bars": 250, "label": "Maximum Available"},
}

INTERVAL_BARS_PER_DAY = {"5m": 78, "15m": 26, "1h": 7, "1d": 1, "1w": 0.2}

# Trading periods per year, used to annualise. `mean/std` with no scaling is not a
# Sharpe ratio, and reporting it as one invites a comparison that cannot be made.
INTERVAL_PERIODS_PER_YEAR = {
    "5m": 78 * 252, "15m": 26 * 252, "1h": 7 * 252, "1d": 252, "1w": 52,
}

# Geometry evaluated, in ATR units. Mirrors dispatcher.RISK_VARIANTS so the backtest
# measures the setups the engine actually proposes.
BACKTEST_GEOMETRY = {"sl": 1.3, "t1": 1.8, "t2": 3.0, "t3": 4.5}


# ── Date filtering ────────────────────────────────────────────────────────────

def filter_by_date_range(df: pd.DataFrame, from_date: Optional[str] = None,
                         to_date: Optional[str] = None,
                         preset: Optional[str] = None) -> pd.DataFrame:
    """
    Restrict to a date range by preset or explicit bounds.

    Returns the frame untouched when there is no `date` column — which used to mean
    every date option was silently ignored, because `mock_ohlcv` produced no dates. It
    now does, so this actually filters.
    """
    if df is None or len(df) == 0 or "date" not in df.columns:
        return df

    out = df.copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out = out.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)

    if preset and preset in TIMEFRAME_PRESETS:
        days = TIMEFRAME_PRESETS[preset]["days"]
        if days < 99999:
            cutoff = out["date"].max() - pd.Timedelta(days=days)
            out = out[out["date"] >= cutoff].reset_index(drop=True)
        return out

    if from_date:
        try:
            out = out[out["date"] >= pd.Timestamp(from_date)].reset_index(drop=True)
        except Exception:
            pass
    if to_date:
        try:
            out = out[out["date"] <= pd.Timestamp(to_date)].reset_index(drop=True)
        except Exception:
            pass
    return out


# ── ATR ───────────────────────────────────────────────────────────────────────

def _atr_at(df: pd.DataFrame, idx: int, period: int = 14) -> float:
    """
    ATR using bars up to and including `idx`. Causal by construction — a backtest that
    peeks one bar ahead for its position sizing is not measuring anything real.
    """
    start = max(0, idx - period)
    h = df["high"].values[start:idx + 1]
    l = df["low"].values[start:idx + 1]
    c = df["close"].values[start:idx + 1]
    if len(c) < 2:
        return float(abs(h[-1] - l[-1])) or 1e-6
    prev = np.roll(c, 1)
    prev[0] = c[0]
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev), np.abs(l - prev)))
    return float(np.mean(tr)) or 1e-6


# ── Trade simulation ──────────────────────────────────────────────────────────

def _simulate(entry, sl, t1, t2, t3, direction, future: pd.DataFrame) -> tuple[str, float, int]:
    """
    Walk forward bar by bar until something is touched.

    @returns (outcome, exit_price, bars_held)

    The stop is checked BEFORE the targets within each bar. When a single bar spans both,
    OHLC cannot resolve the order, and assuming the target came first would manufacture
    profit that may not exist.

    `TIMEOUT` returns the final close — marked to market. Booking it as a full stop-loss,
    as the previous version did, turns "nothing happened" into "maximum loss".
    """
    is_long = direction == "LONG"
    for n, (_, bar) in enumerate(future.iterrows(), start=1):
        high, low = float(bar["high"]), float(bar["low"])
        if is_long:
            if low <= sl:
                return "SL_HIT", sl, n
            if high >= t3:
                return "T3_HIT", t3, n
            if high >= t2:
                return "T2_HIT", t2, n
            if high >= t1:
                return "T1_HIT", t1, n
        else:
            if high >= sl:
                return "SL_HIT", sl, n
            if low <= t3:
                return "T3_HIT", t3, n
            if low <= t2:
                return "T2_HIT", t2, n
            if low <= t1:
                return "T1_HIT", t1, n
    last = float(future["close"].iloc[-1]) if len(future) else entry
    return "TIMEOUT", last, len(future)


def _simulate_np(entry, sl, t1, t2, t3, direction, highs, lows, closes) -> tuple[str, float, int]:
    """
    Array form of `_simulate`, used by the walk-forward loop.

    Identical semantics — stop checked first, TIMEOUT marked to market — but without
    `DataFrame.iterrows()`, which builds a Series per bar. `_simulate` is kept because it
    is the readable reference the tests assert against.
    """
    is_long = direction == "LONG"
    for n in range(len(closes)):
        high, low = float(highs[n]), float(lows[n])
        if is_long:
            if low <= sl:   return "SL_HIT", sl, n + 1
            if high >= t3:  return "T3_HIT", t3, n + 1
            if high >= t2:  return "T2_HIT", t2, n + 1
            if high >= t1:  return "T1_HIT", t1, n + 1
        else:
            if high >= sl:  return "SL_HIT", sl, n + 1
            if low <= t3:   return "T3_HIT", t3, n + 1
            if low <= t2:   return "T2_HIT", t2, n + 1
            if low <= t1:   return "T1_HIT", t1, n + 1
    return "TIMEOUT", float(closes[-1]), len(closes)


def _atr_at_np(highs, lows, closes, idx: int, period: int = 14) -> float:
    """Array form of `_atr_at` — same value, without re-materialising a column."""
    start = max(0, idx - period)
    h, l, c = highs[start:idx + 1], lows[start:idx + 1], closes[start:idx + 1]
    if len(c) < 2:
        return float(abs(h[-1] - l[-1])) or 1e-6
    prev = np.roll(c, 1)
    prev[0] = c[0]
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev), np.abs(l - prev)))
    return float(np.mean(tr)) or 1e-6


def _pnl_pct(entry: float, exit_price: float, direction: str) -> float:
    """Realized P&L at the level actually reached — not at T1 regardless of outcome."""
    if entry <= 0:
        return 0.0
    raw = (exit_price - entry) / entry * 100.0
    return raw if direction == "LONG" else -raw


# ── Grading, without the answer key ───────────────────────────────────────────

def _assign_grade(prob: float) -> str:
    return ("A+" if prob >= 0.80 else "A" if prob >= 0.70 else
            "B"  if prob >= 0.60 else "C" if prob >= 0.50 else "D")


def _pre_trade_probability(directional_prob: float, reward: float, risk: float) -> float:
    """Same barrier approximation the live engine uses, so grades are comparable."""
    from .dispatcher import barrier_probability
    return barrier_probability(directional_prob, reward, risk)


# ── Directional view ──────────────────────────────────────────────────────────

# The deepest lookback any feature uses is 252 bars (52-week high/low) and EMA(200).
# A trailing window of 400 therefore produces identical values to passing the whole
# history, while keeping each call O(400) instead of O(idx).
#
# WHY THIS MATTERS: passing `df.iloc[:idx+1]` would grow the window with every trade,
# and several feature routines walk their input in a Python loop, so the total cost is
# quadratic in the history length. Over 4,600 bars of NIFTY that is the difference
# between a four-second run and one nobody will wait for. A backtest too slow to run is
# a backtest that never gets run. See spec Section 66.
FEATURE_WINDOW = 400


def _model_probability(df: pd.DataFrame, idx: int, symbol: str = None,
                       exchange: str = "NSE") -> Optional[float]:
    """
    The ensemble's directional probability using only bars up to `idx`.

    This is what makes the backtest a test of the predictor rather than of a fixed ATR
    bracket. The slice ends at `idx` — that is the whole causality guarantee, and the
    features cannot see a bar that has not happened.
    """
    try:
        from .featureset import build_feature_map
        from .registry import MODEL_REGISTRY
        start  = max(0, idx + 1 - FEATURE_WINDOW)
        window = df.iloc[start: idx + 1]
        if len(window) < 60:
            return None
        # Same builder as the trainer and the dispatcher (Section 69). If the backtest built
        # a 100-column vector while a trained model expected the derivative columns too, it
        # would be measuring a different model than the one that serves predictions.
        fmap = build_feature_map(window, symbol, exchange)
        vec  = np.array(list(fmap.values()), dtype=np.float32)
        return float(MODEL_REGISTRY.ensemble_predict(vec, feature_map=fmap)["probability"])
    except Exception as e:
        logger.debug(f"[backtest] model probability failed at {idx}: {e}")
        return None


def _momentum_probability(df: pd.DataFrame, idx: int, lookback: int = 5) -> float:
    """Baseline when the ensemble is unavailable — declared, not disguised as a model."""
    c = df["close"].values
    if idx < lookback:
        return 0.5
    change = (c[idx] - c[idx - lookback]) / (c[idx - lookback] + 1e-9)
    return float(np.clip(0.5 + np.tanh(change * 12) * 0.2, 0.15, 0.85))


# ── The backtest ──────────────────────────────────────────────────────────────

def run_backtest(df: pd.DataFrame, symbol: str, model_version: str = "v1.0.0",
                 from_date: Optional[str] = None, to_date: Optional[str] = None,
                 preset: Optional[str] = None, interval: str = "1d",
                 use_model: bool = True, horizon_bars: int = 10,
                 max_signals: int = 2000, exchange: str = "NSE") -> dict:
    """
    Walk-forward evaluation over **non-overlapping** test windows.

    Every trade is independent: a signal is opened at a bar, resolved against the next
    `horizon_bars`, and the next candidate starts after the resolution. No bar is
    evaluated twice, so `signalsTested` means what it says.
    """
    if preset or from_date or to_date:
        df = filter_by_date_range(df, from_date, to_date, preset)

    if df is None or len(df) < 80:
        return _insufficient_data_result(symbol, model_version, 0 if df is None else len(df))

    df = df.reset_index(drop=True)
    has_dates = "date" in df.columns

    warmup = min(MIN_BARS_TRAIN, max(60, int(len(df) * 0.15)))
    if len(df) - warmup - horizon_bars < 20:
        warmup = max(60, len(df) // 3)

    # Pre-extract to numpy once, so the hot loop does no per-bar pandas work: no column
    # lookup, no Series construction, and no `iterrows()` (which builds a Series per bar).
    # This is a constant-factor saving, not a fix for anything — the run's real cost is
    # the feature computation in `_model_probability`.
    highs  = df["high"].to_numpy(dtype=float)
    lows   = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    dates  = df["date"].to_numpy() if has_dates else None

    trades = []
    idx = warmup

    # No iteration guard here, deliberately. Every path through this body advances `idx`
    # by at least one — the skip path by 1, the trade path by `bars_held + 1` >= 2 — so
    # the walk is bounded by `len(df)` by construction. An earlier version carried a
    # counter added while chasing a hang that turned out to be in
    # `advanced_features.market_profile_features`; it was unreachable, and a guard that
    # cannot fire only misdirects the next reader.
    while idx < len(df) - horizon_bars - 1 and len(trades) < max_signals:
        atr = _atr_at_np(highs, lows, closes, idx)
        entry = float(closes[idx])
        if atr <= 0 or entry <= 0:
            idx += 1
            continue

        prob = _model_probability(df, idx, symbol, exchange) if use_model else None
        source = "ensemble"
        if prob is None:
            prob = _momentum_probability(df, idx)
            source = "momentum-baseline"

        direction = "LONG" if prob >= 0.5 else "SHORT"
        # A short's directional edge is the complement of a long's.
        edge = prob if direction == "LONG" else 1.0 - prob
        sign = 1 if direction == "LONG" else -1

        g  = BACKTEST_GEOMETRY
        sl = entry - sign * atr * g["sl"]
        t1 = entry + sign * atr * g["t1"]
        t2 = entry + sign * atr * g["t2"]
        t3 = entry + sign * atr * g["t3"]

        # Graded BEFORE the outcome is known — from the edge and the geometry only.
        pre_prob = _pre_trade_probability(edge, abs(t1 - entry), abs(entry - sl))
        grade    = _assign_grade(pre_prob)

        hi_f = highs[idx + 1: idx + 1 + horizon_bars]
        lo_f = lows[idx + 1: idx + 1 + horizon_bars]
        cl_f = closes[idx + 1: idx + 1 + horizon_bars]
        if len(cl_f) == 0:
            break

        outcome, exit_price, bars_held = _simulate_np(entry, sl, t1, t2, t3, direction,
                                                      hi_f, lo_f, cl_f)
        pnl = _pnl_pct(entry, exit_price, direction)

        trades.append({
            "index":     idx,
            "date":      str(pd.Timestamp(dates[idx]).date()) if has_dates else None,
            "direction": direction,
            "entry":     round(entry, 4),
            "sl":        round(sl, 4),
            "t1":        round(t1, 4),
            "exit":      round(exit_price, 4),
            "outcome":   outcome,
            "won":       pnl > 0,
            "pnlPct":    round(pnl, 4),
            "rr":        round(abs(t1 - entry) / (abs(entry - sl) + 1e-9), 3),
            "barsHeld":  bars_held,
            "predictedProb": round(pre_prob, 4),
            "grade":     grade,
            "probSource": source,
        })

        # NON-OVERLAPPING: resume after this trade resolved.
        idx += max(1, bars_held) + 1

    if not trades:
        return _insufficient_data_result(symbol, model_version, len(df))

    return _summarise(df, symbol, model_version, interval, preset, from_date, to_date,
                      trades, horizon_bars, use_model)


def _summarise(df, symbol, model_version, interval, preset, from_date, to_date,
               trades, horizon_bars, use_model) -> dict:
    total = len(trades)
    pnls  = np.array([t["pnlPct"] for t in trades], dtype=float)
    wins  = np.array([t["won"] for t in trades], dtype=bool)

    counts = {k: sum(1 for t in trades if t["outcome"] == k)
              for k in ("T1_HIT", "T2_HIT", "T3_HIT", "SL_HIT", "TIMEOUT")}

    win_rate = float(wins.mean())
    gross_win  = float(pnls[pnls > 0].sum()) if (pnls > 0).any() else 0.0
    gross_loss = float(-pnls[pnls < 0].sum()) if (pnls < 0).any() else 0.0

    periods = INTERVAL_PERIODS_PER_YEAR.get(interval, 252)
    # Trades are not one-per-bar, so scale by realised trade frequency.
    avg_hold = float(np.mean([t["barsHeld"] for t in trades])) or 1.0
    trades_per_year = periods / max(avg_hold, 1.0)

    std = float(pnls.std(ddof=1)) if total > 1 else 0.0
    sharpe = float(pnls.mean() / std * np.sqrt(trades_per_year)) if std > 0 else 0.0
    downside = pnls[pnls < 0]
    dstd = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    sortino = float(pnls.mean() / dstd * np.sqrt(trades_per_year)) if dstd > 0 else 0.0

    # Compounded equity, which is what an account actually does.
    equity = [100.0]
    for p in pnls:
        equity.append(equity[-1] * (1 + p / 100.0))
    eq = np.array(equity)
    peak = np.maximum.accumulate(eq)
    dd   = (peak - eq) / peak * 100.0
    max_dd = float(dd.max())
    total_return = float((eq[-1] / eq[0] - 1) * 100)

    years = max(total / max(trades_per_year, 1e-9), 1e-9)
    cagr  = float(((eq[-1] / eq[0]) ** (1 / years) - 1) * 100) if eq[-1] > 0 else 0.0
    calmar = round(cagr / max_dd, 2) if max_dd > 0 else 0.0

    # Calibration measured against realised outcomes — the honest version of the
    # numbers /health used to hardcode to 0.
    from .calibration import compute_ece, compute_brier_score
    y_prob = np.array([t["predictedProb"] for t in trades], dtype=float)
    y_true = wins.astype(float)
    ece   = round(compute_ece(y_true, y_prob), 4)
    brier = round(compute_brier_score(y_true, y_prob), 4)

    grade_counts = {g: 0 for g in ("A+", "A", "B", "C", "D")}
    grade_perf = {}
    for t in trades:
        grade_counts[t["grade"]] = grade_counts.get(t["grade"], 0) + 1
        grade_perf.setdefault(t["grade"], []).append(t["won"])
    # Does a better grade actually win more often? The point of grading.
    grade_win_rates = {g: round(float(np.mean(v)) * 100, 1) for g, v in grade_perf.items() if v}

    monthly = {}
    for t in trades:
        if t["date"]:
            key = t["date"][:7]
            monthly[key] = monthly.get(key, 0.0) + t["pnlPct"]

    ec = [round(v, 2) for v in equity]
    if len(ec) > 300:
        ec = ec[::max(1, len(ec) // 300)]

    prob_sources = {t["probSource"] for t in trades}
    trained = _trained_model_note(df)

    return {
        "symbol":        symbol,
        "modelVersion":  model_version,
        "interval":      interval,
        "preset":        preset,
        "fromDate":      from_date,
        "toDate":        to_date,
        "barsUsed":      len(df),
        "signalsTested": total,
        "accuracyPct":   round(win_rate * 100, 1),
        # No pass/fail claim. A 75% floor on a mechanical ATR bracket is not a
        # meaningful bar, and asserting it produced a permanent "retrain_required".
        "stable":        None,
        "action":        "measured",
        "message": (f"{total} independent trades, {round(win_rate*100,1)}% won, "
                    f"expectancy {round(float(pnls.mean()),3)}% per trade. "
                    f"Direction from {', '.join(sorted(prob_sources))}."),
        "metrics": {
            "winRatePct":     round(win_rate * 100, 1),
            "t1HitRate":      round(counts["T1_HIT"] / total * 100, 1),
            "t2HitRate":      round(counts["T2_HIT"] / total * 100, 1),
            "t3HitRate":      round(counts["T3_HIT"] / total * 100, 1),
            "slHitRate":      round(counts["SL_HIT"] / total * 100, 1),
            "timeoutRate":    round(counts["TIMEOUT"] / total * 100, 1),
            "avgRR":          round(float(np.mean([t["rr"] for t in trades])), 2),
            "avgPnlPct":      round(float(pnls.mean()), 3),
            "expectancyPct":  round(float(pnls.mean()), 3),
            "profitFactor":   round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "totalReturnPct": round(total_return, 2),
            "cagrPct":        round(cagr, 2),
            "sharpe":         round(sharpe, 2),
            "sortino":        round(sortino, 2),
            "calmar":         calmar,
            "maxDrawdownPct": round(max_dd, 2),
            "avgBarsHeld":    round(avg_hold, 1),
            "maxWinStreak":   _max_streak(trades, True),
            "maxLossStreak":  _max_streak(trades, False),
            "ece":            ece,
            "brierScore":     brier,
        },
        "calibration": {
            "ece": ece, "brierScore": brier, "samples": total,
            "note": "Measured against realised outcomes of these trades.",
        },
        "gradeDistribution": grade_counts,
        "gradeWinRates":     grade_win_rates,
        "equityCurve":       ec,
        "equityCurveBasis":  "compounded, starting at 100",
        "monthlyPnl":        [{"month": k, "pnl": round(v, 2)} for k, v in sorted(monthly.items())],
        "trades":            trades[:500],
        "methodology": {
            "windows":            "non-overlapping; each trade resolves before the next begins",
            "horizonBars":        horizon_bars,
            "geometry":           BACKTEST_GEOMETRY,
            "intrabarAmbiguity":  "stop assumed hit first when a bar spans both stop and target",
            "timeoutHandling":    "marked to market at the final close, not booked as a stop-loss",
            "gradedFrom":         "pre-trade edge and geometry only — never the outcome",
            "directionSource":    sorted(prob_sources),
            "modelInLoop":        bool(use_model),
            "trainedArtifacts":   trained,
        },
        "thresholds": {"floor": ACCURACY_FLOOR * 100, "ceiling": ACCURACY_CEILING * 100},
    }


def _trained_model_note(df: pd.DataFrame = None) -> dict:
    """
    Whether a trained artifact is in the loop, and whether this evaluation is in-sample.

    An out-of-sample claim has to be checkable. Now that `training.py` records its train and
    holdout date ranges (spec Section 69), this compares the backtest window against them
    instead of returning `"unknown"` — because a model evaluated on its own training data
    will look excellent and mean nothing, and a reader has no way to notice from the metrics.
    """
    try:
        from .registry import MODEL_REGISTRY
        st = MODEL_REGISTRY.status()
        trained = [n for n, m in st["models"].items() if m.get("trained")]
        out = {"count": len(trained), "models": trained}
        if not trained:
            out.update({
                "outOfSample": "n/a — no trained model in the loop",
                "note": "Heuristic ensemble; nothing was fitted, so there is no in-sample risk.",
            })
            return out

        from .training import load_provenance
        prov = load_provenance()
        if not prov:
            out.update({"outOfSample": "unknown",
                        "note": "Artifacts exist but carry no training provenance — "
                                "their date range cannot be checked against this window."})
            return out

        tr = prov.get("trainRange") or {}
        out["trainedOn"] = tr
        out["holdoutRange"] = prov.get("holdoutRange")
        out["horizonBars"] = prov.get("horizonBars")
        if df is None or "date" not in getattr(df, "columns", []) or len(df) == 0:
            out.update({"outOfSample": "unknown",
                        "note": "This window carries no dates to compare."})
            return out

        w0 = pd.Timestamp(df["date"].iloc[0]).normalize()
        w1 = pd.Timestamp(df["date"].iloc[-1]).normalize()
        t0 = pd.Timestamp(tr.get("first")) if tr.get("first") else None
        t1 = pd.Timestamp(tr.get("last")) if tr.get("last") else None
        if t0 is None or t1 is None:
            out.update({"outOfSample": "unknown", "note": "Training range incomplete."})
            return out

        overlaps = not (w1 < t0 or w0 > t1)
        out["backtestWindow"] = {"first": str(w0.date()), "last": str(w1.date())}
        out["outOfSample"] = not overlaps
        out["note"] = (
            f"IN-SAMPLE: this window ({w0.date()} → {w1.date()}) overlaps the training range "
            f"({t0.date()} → {t1.date()}). These results are not evidence of out-of-sample "
            f"skill — the model saw these bars while fitting."
            if overlaps else
            f"Out of sample: this window ends before or starts after the training range "
            f"({t0.date()} → {t1.date()})."
        )
        return out
    except Exception as e:
        return {"count": 0, "models": [], "outOfSample": "unknown",
                "note": f"registry or provenance unavailable: {type(e).__name__}"}


def _max_streak(trades: list, won: bool) -> int:
    best = cur = 0
    for t in trades:
        if t["won"] == won:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best


def _insufficient_data_result(symbol: str, model_version: str, bars: int) -> dict:
    return {
        "symbol":        symbol,
        "modelVersion":  model_version,
        "barsUsed":      bars,
        "signalsTested": 0,
        "accuracyPct":   None,
        "stable":        None,
        "action":        "insufficient_data",
        "message":       f"Need at least 80 bars to evaluate; got {bars}. Widen the date range.",
        "metrics":       {},
        "calibration":   {},
        "gradeDistribution": {},
        "gradeWinRates": {},
        "equityCurve":   [],
        "monthlyPnl":    [],
        "trades":        [],
        "methodology":   {},
        "thresholds":    {"floor": ACCURACY_FLOOR * 100, "ceiling": ACCURACY_CEILING * 100},
    }
