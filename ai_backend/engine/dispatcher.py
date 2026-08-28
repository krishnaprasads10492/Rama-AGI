"""
dispatcher.py — Routes prediction requests to the correct generator.

Upgrades:
  - Uses real OHLCV from Node.js backend (via data_fetcher)
  - Applies adaptive weight from learning history
  - Supports dual-mode: learning (exploratory) vs realworld (calibrated)
  - Futures meta: basis, lot size, expiry from FuturesPanel
  - Options meta: strike, expiry, IV from OptionsPanel
  - Derivative recommender: scan all strikes for an index
"""

import numpy as np
import uuid
import time
import logging
from typing import Any

from .registry import MODEL_REGISTRY
from .features import compute_features, compute_full_features_dict
from .calibration import clamp_probability, regime_adjust
from .data_fetcher import get_ohlcv

# ── Risk variants ─────────────────────────────────────────────────────────────
# One bar of data yields ONE directional view. It used to yield N "signals" by calling
# the ensemble N times on the same feature vector plus Gaussian jitter, then ranking by
# the resulting noise — sixteen copies of one guess, ranked by randomness.
#
# What genuinely differs per setup is the GEOMETRY: how much room the stop is given and
# how far the targets sit. Each of these is a real, distinct trade with a real, distinct
# risk/reward and a real, distinct probability of getting there. Multiples are in ATR
# units. See spec Section 64.
RISK_VARIANTS = [
    {"name": "scalp",      "sl": 0.8, "t1": 1.0, "t2": 1.6, "t3": 2.2,
     "note": "tight stop, near target — highest hit rate, smallest reward"},
    {"name": "tight",      "sl": 1.0, "t1": 1.5, "t2": 2.4, "t3": 3.4,
     "note": "close stop, modest target"},
    {"name": "balanced",   "sl": 1.3, "t1": 1.8, "t2": 3.0, "t3": 4.5,
     "note": "the default geometry — room to breathe, 1.4:1 on T1"},
    {"name": "swing",      "sl": 1.6, "t1": 2.6, "t2": 4.2, "t3": 6.0,
     "note": "wider stop survives noise, larger reward"},
    {"name": "positional", "sl": 2.0, "t1": 3.5, "t2": 5.5, "t3": 8.0,
     "note": "widest stop, largest target — lowest hit rate, best payoff"},
    {"name": "runner",     "sl": 1.3, "t1": 2.2, "t2": 4.5, "t3": 7.5,
     "note": "balanced stop with stretched targets — lets a trend run"},
]

logger = logging.getLogger("stockmind-ai.dispatcher")

# ── Black-Scholes ─────────────────────────────────────────────────────────────

def _erf(x):
    t = 1 / (1 + 0.3275911 * abs(x))
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return y if x >= 0 else -y

def _N(x): return 0.5 * (1 + _erf(x / np.sqrt(2)))
def _n(x): return np.exp(-x * x / 2) / np.sqrt(2 * np.pi)

def bs_price(S, K, T, iv, opt_type):
    if T <= 0:
        return max(0, S - K) if opt_type == "CE" else max(0, K - S)
    d1 = (np.log(S / K) + (0.05 + iv**2 / 2) * T) / (iv * np.sqrt(T))
    d2 = d1 - iv * np.sqrt(T)
    if opt_type == "CE":
        return max(0, S * _N(d1) - K * np.exp(-0.05 * T) * _N(d2))
    return max(0, K * np.exp(-0.05 * T) * _N(-d2) - S * _N(-d1))

def bs_greeks(S, K, T, iv, opt_type):
    if T <= 0:
        return {"delta": 1.0 if (opt_type == "CE" and S > K) else -1.0, "gamma": 0, "theta": 0, "vega": 0}
    d1 = (np.log(S / K) + (0.05 + iv**2 / 2) * T) / (iv * np.sqrt(T))
    d2 = d1 - iv * np.sqrt(T)
    delta = _N(d1) if opt_type == "CE" else _N(d1) - 1
    gamma = _n(d1) / (S * iv * np.sqrt(T))
    theta = (-(S * _n(d1) * iv) / (2 * np.sqrt(T)) - 0.05 * K * np.exp(-0.05 * T) * (_N(d2) if opt_type == "CE" else _N(-d2))) / 365
    vega  = S * _n(d1) * np.sqrt(T) / 100
    return {
        "delta": round(delta, 4),
        "gamma": round(gamma, 6),
        "theta": round(theta, 4),
        "vega":  round(vega, 4),
    }

# ── Config ────────────────────────────────────────────────────────────────────

STRIKE_STEPS = {"NIFTY": 50, "BANKNIFTY": 100, "FINNIFTY": 50, "MIDCPNIFTY": 25, "SENSEX": 100, "NIFTY50": 50}
LOT_SIZES    = {"NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 40, "MIDCPNIFTY": 75, "SENSEX": 10, "NIFTY50": 25}

def _step(sym): return STRIKE_STEPS.get(sym.upper().replace("50", "").replace("NIFTY50", "NIFTY"), 50)
def _lot(sym):  return LOT_SIZES.get(sym.upper().replace("50", "").replace("NIFTY50", "NIFTY"), 25)
def _atm(price, sym): s = _step(sym); return round(price / s) * s

# ── Mode-aware probability adjustment ────────────────────────────────────────

def _apply_mode(prob: float, mode: str, adaptive_weight: float = 1.0) -> float:
    """
    Apply prediction mode adjustments:
      - learning:   wider confidence intervals, more exploratory
      - realworld:  tighter, uses adaptive weight from history
      - both:       blend of both
    """
    if mode == "learning":
        # Add noise to explore the probability space
        noise = np.random.normal(0, 0.04)
        return float(np.clip(prob + noise, 0.10, 0.95))
    elif mode == "realworld":
        # Apply adaptive weight from learning history
        adjusted = prob * adaptive_weight
        return float(np.clip(adjusted, 0.05, 0.99))
    else:  # both
        # Blend: 40% learning (noisy), 60% realworld (calibrated)
        learning_p  = float(np.clip(prob + np.random.normal(0, 0.03), 0.10, 0.95))
        realworld_p = float(np.clip(prob * adaptive_weight, 0.05, 0.99))
        return float(np.clip(0.4 * learning_p + 0.6 * realworld_p, 0.05, 0.99))

# ── Signal builder ────────────────────────────────────────────────────────────

def barrier_probability(directional_prob: float, reward: float, risk: float) -> float:
    """
    Probability of reaching the target before the stop, given the directional edge and
    the geometry of the two barriers.

    P = (p * b) / (p * b + (1 - p) * a),  where a = reward distance, b = risk distance

    Chosen because it behaves correctly at every limit:
      - p = 0.5      → b / (a + b), the classic driftless first-passage result
      - a = b        → p, so symmetric barriers just return the directional edge
      - p → 1 or 0   → 1 or 0
      - a ↑ with b fixed → probability falls, as a farther target must

    This replaces hardcoded decrements of −0.18 for T2 and −0.38 for T3, which took no
    account of where those targets actually were. A far target and a near one reported
    the same penalty. See spec Section 64.

    It is an approximation — it assumes the directional edge is constant over the
    horizon and ignores volatility clustering — and is labelled as such wherever it
    reaches master.
    """
    p = float(np.clip(directional_prob, 1e-6, 1 - 1e-6))
    a = max(float(reward), 1e-9)
    b = max(float(risk), 1e-9)
    return float(np.clip((p * b) / (p * b + (1.0 - p) * a), 0.01, 0.99))


def _grade_for(prob: float) -> str:
    return ("A+" if prob >= 0.80 else "A" if prob >= 0.70 else
            "B"  if prob >= 0.60 else "C" if prob >= 0.50 else "D")


GRADE_ORDER = {"A+": 4, "A": 3, "B": 2, "C": 1, "D": 0}


def _build_signal(rank, prob, direction, entry, sl, t1, t2, t3, capital, risk_pct,
                  reasons, extra=None, ensemble=None, total=16, variant=None):
    """
    Assemble the signal contract.

    Now carries what the ensemble actually computed instead of discarding it
    (spec Section 64): `suppressed` was hardcoded `False` — which is why
    `suppressedCount` in the response was structurally always 0 — `regime` was
    hardcoded `"trending"` regardless of what `detect_regime` returned, and the T2/T3
    probabilities were fixed decrements rather than a function of the target distance.
    """
    ens      = ensemble or {}
    max_risk = capital * (risk_pct / 100)
    risk_d   = abs(entry - sl)
    rr       = abs(t1 - entry) / (risk_d + 1e-9)

    p1 = barrier_probability(prob, abs(t1 - entry), risk_d)
    p2 = barrier_probability(prob, abs(t2 - entry), risk_d)
    p3 = barrier_probability(prob, abs(t3 - entry), risk_d)

    grade = _grade_for(p1)

    return {
        "rank":               rank,
        "id":                 uuid.uuid4().hex,
        "type":               direction,
        "entryPrice":         round(entry, 2),
        "entryZoneLow":       round(entry - risk_d * 0.1, 2),
        "entryZoneHigh":      round(entry + risk_d * 0.1, 2),
        "t1Price":            round(t1, 2),
        "t2Price":            round(t2, 2),
        "t3Price":            round(t3, 2),
        "stopLoss":           round(sl, 2),
        "immediateOptimalSL": round(sl + (entry - sl) * 0.35, 2),
        "maxRisk":            round(max_risk),
        "riskRewardRatio":    round(rr, 2),
        "validity":           _validity_ts(rank, total),
        "validityBars":       max(4, total - rank + 1),
        # The directional view, and the geometry-aware probability of this variant.
        "directionalProbability": int(round(clamp_probability(prob) * 100)),
        "probability":        int(round(p1 * 100)),
        "grade":              grade,
        "t1Probability":      int(round(p1 * 100)),
        "t2Probability":      int(round(p2 * 100)),
        "t3Probability":      int(round(p3 * 100)),
        "slProbability":      int(round((1.0 - p1) * 100)),
        "probabilityBasis":   "barrier approximation from directional edge and target distance",
        # Straight from the ensemble rather than invented here.
        "regime":             ens.get("regime_detected", "unknown"),
        "suppressed":         bool(ens.get("suppressed", False)),
        "suppressReason":     ens.get("suppress_reason"),
        "modelAgreement":     ens.get("agreement"),
        "uncertainty":        ens.get("uncertainty"),
        "epistemic":          ens.get("epistemic"),
        "variant":            variant,
        "reasons":            reasons,
        "hmacSignature":      "",
        **(extra or {}),
    }


def _validity_ts(rank, total=16):
    """
    Validity window for a signal.

    Was `(16 - rank) * 15` minutes, so any request with `signalCount > 16` produced a
    **negative** offset and stamped validity in the past. Now derived from the actual
    count, so the highest-ranked signal always has the longest window.
    """
    import datetime
    minutes = max(15, (max(1, int(total)) - int(rank) + 1) * 15)
    return (datetime.datetime.now() + datetime.timedelta(minutes=minutes)).isoformat()

# ── Main entry point ──────────────────────────────────────────────────────────

def generate_signals(params: dict) -> list[dict]:
    instr_type   = params.get("instrType", "spot")
    is_deriv_rec = params.get("isDerivRec", False) or params.get("isIndexDerivRec", False)

    if is_deriv_rec:
        return _deriv_recommendations(params)
    if instr_type == "futures":
        return _futures_signals(params)
    if instr_type == "options":
        return _options_signals(params)
    return _spot_signals(params)


def _signal_count(params: dict) -> int:
    """Return user-requested signal count, clamped to 1–50. Defaults to 16."""
    n = params.get("signalCount") or params.get("count") or 16
    try:
        return max(1, min(50, int(n)))
    except (TypeError, ValueError):
        return 16


# ── Spot signals ──────────────────────────────────────────────────────────────

def _spot_signals(params: dict) -> list[dict]:
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    direction      = params.get("direction", "both")
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))

    df, is_real = get_ohlcv(params)

    # Full feature set (base + Ichimoku/Fibonacci/Supertrend/profile/order-flow/ICT).
    # `compute_full_features` existed but had no callers, so /predict ran on 59 of the
    # 100 available features while the advanced buckets reached only /strategy/score.
    fmap     = compute_full_features_dict(df)
    features = np.array(list(fmap.values()), dtype=np.float32)

    if not is_real:
        logger.info(f"[Dispatcher] {symbol}: using mock OHLCV for features")

    # ONE prediction for one bar of information.
    result   = MODEL_REGISTRY.ensemble_predict(features, feature_map=fmap)
    raw_prob = result["probability"]
    prob     = _apply_mode(raw_prob, mode, adaptive_weight)

    # Real measured ATR rather than the hardcoded 0.9% proxy the levels used to be
    # built from — `atr14_pct` was computed on every request and never read.
    atr_pct = float(fmap.get("atr14_pct") or 0.0)
    if not (0.0005 < atr_pct < 0.25):
        atr_pct = 0.009
        atr_source = "fallback 0.9% proxy — measured ATR unavailable"
    else:
        atr_source = f"measured ATR(14) = {atr_pct * 100:.2f}% of price"
    atr = base * atr_pct

    requested = _signal_count(params)
    variants  = RISK_VARIANTS[:max(1, min(requested, len(RISK_VARIANTS)))]

    base_reasons = list(result["reasons"])
    base_reasons.append(atr_source)
    if not is_real:
        base_reasons.append("⚠ Using estimated data — live data unavailable")
    if requested > len(RISK_VARIANTS):
        base_reasons.append(
            f"{requested} signals requested; {len(RISK_VARIANTS)} distinct setups exist for "
            f"one bar of data — padding with noise would not add information"
        )

    long_bias = direction != "short"
    signals = []
    for i, v in enumerate(variants):
        is_long = long_bias if direction in ("long", "short") else (prob >= 0.5)
        sign    = 1 if is_long else -1
        entry   = base
        sl      = entry - sign * atr * v["sl"]
        t1      = entry + sign * atr * v["t1"]
        t2      = entry + sign * atr * v["t2"]
        t3      = entry + sign * atr * v["t3"]

        signals.append(_build_signal(
            i + 1, prob, "LONG" if is_long else "SHORT",
            entry, sl, t1, t2, t3, capital, risk_pct,
            base_reasons + [f"{v['name']} geometry — {v['note']}"],
            {"instrType": "spot", "spotPrice": round(base, 2),
             "dataSource": "real" if is_real else "mock"},
            ensemble=result, total=len(variants), variant=v["name"],
        ))

    signals.sort(key=lambda s: s["probability"], reverse=True)
    for i, s in enumerate(signals):
        s["rank"] = i + 1
    return _apply_min_grade(signals, params)


def _apply_min_grade(signals: list[dict], params: dict) -> list[dict]:
    """
    Honour `minGrade`, which the request schema has always accepted and validated and
    the engine has never read (spec Section 64).

    Never returns an empty list from a non-empty one — a filter that silently hides
    every result looks identical to a backend failure, so the best available signal is
    kept and flagged as below the requested grade.
    """
    want = params.get("minGrade")
    if not want or want not in GRADE_ORDER or not signals:
        return signals

    floor = GRADE_ORDER[want]
    kept  = [s for s in signals if GRADE_ORDER.get(s.get("grade"), -1) >= floor]
    if kept:
        return kept

    best = signals[0]
    best["belowRequestedGrade"] = want
    best["reasons"] = list(best.get("reasons", [])) + [
        f"No setup reached grade {want}; showing the best available ({best.get('grade')})"
    ]
    return [best]


# ── Futures signals ───────────────────────────────────────────────────────────

def _futures_signals(params: dict) -> list[dict]:
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    direction      = params.get("direction", "both")
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))

    # Use futures meta from FuturesPanel if available
    futures_meta = params.get("futuresMeta") or {}
    lot_size     = futures_meta.get("lotSize") or params.get("lotSize") or _lot(symbol)
    basis        = futures_meta.get("basis") or base * (0.001 + np.random.uniform(0, 0.004))
    fut_base     = futures_meta.get("futuresPrice") or (base + basis)
    days_left    = futures_meta.get("daysLeft", 30)
    series       = futures_meta.get("series", "Near")

    df, is_real = get_ohlcv(params)
    fmap     = compute_full_features_dict(df)
    features = np.array(list(fmap.values()), dtype=np.float32)

    # One bar, one ensemble call — hoisted out of the loop. It used to run inside, on
    # the same vector plus fresh noise each time (Section 64).
    result   = MODEL_REGISTRY.ensemble_predict(features, feature_map=fmap)
    raw_prob = result["probability"]

    atr_pct = float(fmap.get("atr14_pct") or 0.0)
    if not (0.0005 < atr_pct < 0.25):
        atr_pct = 0.009

    count = min(_signal_count(params), len(RISK_VARIANTS))
    signals = []
    for i in range(count):
        prob = _apply_mode(raw_prob, mode, adaptive_weight)

        is_long = direction != "short"
        v       = RISK_VARIANTS[i]
        sign    = 1 if is_long else -1
        atr     = fut_base * atr_pct
        entry   = fut_base
        sl = entry - sign * atr * v["sl"]
        t1 = entry + sign * atr * v["t1"]
        t2 = entry + sign * atr * v["t2"]
        t3 = entry + sign * atr * v["t3"]

        lots = max(1, int((capital * risk_pct / 100) / (abs(entry - sl) * lot_size + 1e-9)))
        max_risk_lots = abs(entry - sl) * lot_size * lots

        reasons = result["reasons"][:3] + [
            f"{v['name']} geometry — {v['note']}",
            f"Futures basis {'+' if basis >= 0 else ''}{basis:.1f} ({basis/base*100:.2f}%) — {series} series",
            f"{lots} lot{'s' if lots > 1 else ''} × {lot_size} = ₹{max_risk_lots:,.0f} max risk",
            f"{days_left}d to expiry",
        ]

        signals.append(_build_signal(
            i + 1, prob, "LONG" if is_long else "SHORT",
            entry, sl, t1, t2, t3, capital, risk_pct, reasons,
            {
                "instrType": "futures", "spotPrice": round(base, 2),
                "lotSize": lot_size, "lotCount": lots,
                "basis": round(basis, 2), "maxRisk": round(max_risk_lots),
                "daysLeft": days_left, "series": series,
                "dataSource": "real" if is_real else "mock",
            },
            ensemble=result, total=count, variant=v["name"],
        ))

    signals.sort(key=lambda s: s["probability"], reverse=True)
    for i, s in enumerate(signals): s["rank"] = i + 1
    return _apply_min_grade(signals, params)


# ── Options signals ───────────────────────────────────────────────────────────

def _options_signals(params: dict) -> list[dict]:
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))

    # Use options meta from OptionsPanel if available
    option_meta = params.get("optionMeta") or {}
    strike      = option_meta.get("strike") or params.get("strike") or _atm(base, symbol)
    opt_type    = option_meta.get("optType") or params.get("optType", "CE")
    days_left   = option_meta.get("daysLeft") or params.get("daysLeft", 14)
    lot_size    = option_meta.get("lotSize") or params.get("lotSize") or _lot(symbol)
    iv_override = option_meta.get("iv")  # IV from OptionsPanel (already in %)
    T = max(0.001, days_left / 365)

    df, is_real = get_ohlcv(params)
    features = compute_features(df)

    # Use IV from OptionsPanel if available, else compute
    if iv_override:
        iv = iv_override / 100.0
    else:
        iv = 0.16 + abs(strike - _atm(base, symbol)) / base * 0.8 + np.random.uniform(0, 0.04)

    premium  = bs_price(base, strike, T, iv, opt_type)
    greeks   = bs_greeks(base, strike, T, iv, opt_type)
    breakeven = strike + premium if opt_type == "CE" else strike - premium
    idx_move  = breakeven - base

    daily_vol  = base * 0.009
    period_vol = daily_vol * np.sqrt(max(1, days_left))
    z_score    = abs(idx_move) / (period_vol + 1e-9)
    prob_reach = float(np.clip(1 - min(0.95, z_score * 0.28), 0.10, 0.90))

    count = _signal_count(params)
    signals = []
    for i in range(count):
        result = MODEL_REGISTRY.ensemble_predict(
            features + np.random.normal(0, 0.01, len(features))
        )
        raw_prob = float(np.clip(result["probability"] * 0.6 + prob_reach * 0.4, 0.10, 0.95))
        prob = _apply_mode(raw_prob, mode, adaptive_weight)

        entry = max(0.5, premium * (0.95 + np.random.uniform(0, 0.1)))
        sl    = max(0.1, entry * (0.40 + np.random.uniform(0, 0.15)))
        t1    = entry * (1.5 + np.random.uniform(0, 0.3))
        t2    = entry * (2.2 + np.random.uniform(0, 0.4))
        t3    = entry * (3.0 + np.random.uniform(0, 0.5))

        lots = max(1, int((capital * risk_pct / 100) / (entry * lot_size + 1e-9)))
        max_risk_lots = (entry - sl) * lot_size * lots

        reasons = [
            f"{opt_type} {strike:.0f} | Spot: ₹{base:.0f} | IV: {iv*100:.1f}% | {days_left}d to expiry",
            f"Δ {greeks['delta']:.3f} | Θ {greeks['theta']:.2f}/day | ν {greeks['vega']:.2f}",
            f"Index needs {idx_move:+.0f} pts → breakeven {breakeven:.0f}",
            f"Prob reach breakeven: {int(prob_reach*100)}%",
            f"{lots} lot{'s' if lots > 1 else ''} × {lot_size} = ₹{entry*lot_size*lots:,.0f} premium",
        ]

        signals.append(_build_signal(
            i + 1, prob, "LONG" if opt_type == "CE" else "SHORT",
            entry, sl, t1, t2, t3, capital, risk_pct, reasons,
            {
                "instrType": "options", "spotPrice": round(base, 2),
                "optType": opt_type, "strike": strike,
                "iv": round(iv * 100, 1), **greeks,
                "lotSize": lot_size, "lotCount": lots,
                "maxRisk": round(max_risk_lots),
                "breakeven": round(breakeven, 2),
                "indexMoveNeeded": round(idx_move, 2),
                "probReachBreakeven": int(prob_reach * 100),
                "dataSource": "real" if is_real else "mock",
            },
        ))

    signals.sort(key=lambda s: s["probability"], reverse=True)
    for i, s in enumerate(signals): s["rank"] = i + 1
    return signals


# ── Derivative recommender ────────────────────────────────────────────────────

def _deriv_recommendations(params: dict) -> list[dict]:
    """Scan all nearby strikes + futures, rank by profit potential."""
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    direction      = params.get("direction", "both")
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))
    step           = _step(symbol)
    atm            = _atm(base, symbol)
    lot_size       = _lot(symbol)
    T              = 0.04 + np.random.uniform(0, 0.06)
    iv_base        = 0.16 + np.random.uniform(0, 0.06)

    df, is_real = get_ohlcv(params)
    features = compute_features(df)

    candidates = []

    # Futures
    basis    = base * (0.001 + np.random.uniform(0, 0.003))
    fut_base = base + basis
    atr      = fut_base * 0.009
    result   = MODEL_REGISTRY.ensemble_predict(features)
    fut_prob = _apply_mode(result["probability"], mode, adaptive_weight)
    candidates.append({
        "label": f"{symbol} Futures", "instrType": "futures",
        "symbol": f"{symbol}FUT", "prob": fut_prob,
        "entry": fut_base, "sl": fut_base - atr * 1.3,
        "t1": fut_base + atr * 2.0, "t2": fut_base + atr * 3.5, "t3": fut_base + atr * 5.5,
        "rr": (atr * 2.0) / (atr * 1.3), "score": fut_prob * 1.54 * 0.8,
        "lotSize": lot_size, "basis": round(basis, 2),
        "reasons": result["reasons"][:3] + [f"Futures basis +{basis:.1f}"],
    })

    # Options: ATM ± 4 strikes
    for n in range(-4, 5):
        strike = atm + n * step
        for opt_type in ["CE", "PE"]:
            if direction == "long"  and opt_type == "PE": continue
            if direction == "short" and opt_type == "CE": continue

            iv = iv_base + abs(n) * 0.02
            premium = bs_price(base, strike, T, iv, opt_type)
            if premium < 1: continue

            greeks = bs_greeks(base, strike, T, iv, opt_type)
            sl = max(0.5, premium * 0.45)
            t1 = premium * 1.6
            rr = (t1 - premium) / (premium - sl + 1e-9)

            result = MODEL_REGISTRY.ensemble_predict(
                features + np.random.normal(0, 0.02, len(features))
            )
            raw_prob = float(np.clip(result["probability"] * 0.7 + abs(greeks["delta"]) * 0.3, 0.10, 0.95))
            prob = _apply_mode(raw_prob, mode, adaptive_weight)
            cap_eff = (t1 - premium) / (premium + 1e-9)
            score = prob * rr * cap_eff * (1.0 if opt_type == "CE" else 0.95)

            moneyness = "ATM" if n == 0 else (
                f"OTM +{n*step}" if (opt_type == "CE" and n > 0) or (opt_type == "PE" and n < 0)
                else f"ITM {abs(n)*step}"
            )

            candidates.append({
                "label": f"{symbol} {strike:.0f} {opt_type} ({moneyness})",
                "instrType": "options", "symbol": f"{symbol}{strike:.0f}{opt_type}",
                "optType": opt_type, "strike": strike, "prob": prob,
                "entry": round(premium, 2), "sl": round(sl, 2),
                "t1": round(t1, 2), "t2": round(premium * 2.4, 2), "t3": round(premium * 3.5, 2),
                "rr": round(rr, 2), "score": score, "iv": round(iv * 100, 1),
                "lotSize": lot_size, **greeks,
                "reasons": [
                    f"{opt_type} {strike:.0f} ({moneyness}) | IV: {iv*100:.1f}%",
                    f"Δ {greeks['delta']:.3f} | Θ {greeks['theta']:.2f}/day",
                    f"Premium ₹{premium:.1f} | R:R 1:{rr:.2f}",
                    f"Capital efficiency: {cap_eff*100:.0f}% gain at T1",
                ],
            })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    count = _signal_count(params)
    top_n = candidates[:count]

    signals = []
    for i, c in enumerate(top_n):
        lots = max(1, int((capital * risk_pct / 100) / (abs(c["entry"] - c["sl"]) * c["lotSize"] + 1e-9)))
        signals.append(_build_signal(
            i + 1, c["prob"],
            "SHORT" if c.get("optType") == "PE" else "LONG",
            c["entry"], c["sl"], c["t1"], c["t2"], c["t3"],
            capital, risk_pct, c["reasons"],
            {
                "instrType":  c["instrType"],
                "spotPrice":  round(base, 2),
                "derivLabel": c["label"],
                "symbol":     c["symbol"],
                "optType":    c.get("optType"),
                "strike":     c.get("strike"),
                "iv":         c.get("iv"),
                "delta":      c.get("delta"),
                "gamma":      c.get("gamma"),
                "theta":      c.get("theta"),
                "vega":       c.get("vega"),
                "lotSize":    c["lotSize"],
                "lotCount":   lots,
                "basis":      c.get("basis"),
                "score":      round(c["score"], 2),
                "maxRisk":    round(abs(c["entry"] - c["sl"]) * c["lotSize"] * lots),
                "dataSource": "real" if is_real else "mock",
            },
        ))

    return signals
