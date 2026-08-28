"""
Tests for the rewritten backtest (spec Section 66).

Each defect from the old implementation gets an assertion that would have failed against
it. Run from `ai_backend/`:  python -m tests.test_backtest
"""

import os
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STOCKMIND_DATA_DIR"] = tempfile.mkdtemp(prefix="rama-bt-")

from engine.backtest import (                          # noqa: E402
    run_backtest, filter_by_date_range, _simulate, _pnl_pct, _atr_at,
    _assign_grade, _max_streak, TIMEFRAME_PRESETS, INTERVAL_PERIODS_PER_YEAR,
    BACKTEST_GEOMETRY,
)

PASS = 0
FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


def series(n=900, seed=11, price=1000.0, drift=0.0003, vol=0.012):
    rng   = np.random.default_rng(seed)
    close = price * np.cumprod(1 + rng.normal(drift, vol, n))
    high  = close * (1 + np.abs(rng.normal(0, 0.006, n)))
    low   = close * (1 - np.abs(rng.normal(0, 0.006, n)))
    openp = np.concatenate([[price], close[:-1]])
    return pd.DataFrame({
        "date":  pd.bdate_range("2015-01-01", periods=n),
        "open":  openp, "high": np.maximum(high, np.maximum(openp, close)),
        "low":   np.minimum(low, np.minimum(openp, close)),
        "close": close, "volume": np.abs(rng.normal(1e6, 2e5, n)),
    })


# ── Trade simulation: the three accounting defects ────────────────────────────
print("\n--- simulation: stop assumed first, timeout marked to market ---")

# A bar spanning BOTH stop and target must resolve as the stop (conservative).
both = pd.DataFrame({"high": [120.0], "low": [80.0], "close": [100.0]})
outcome, exit_px, _ = _simulate(100, 90, 110, 120, 130, "LONG", both)
check("a bar containing both stop and target resolves as the stop",
      outcome == "SL_HIT" and exit_px == 90, f"{outcome} @ {exit_px}")

# TIMEOUT must be marked to market, NOT booked as a stop-loss.
flat = pd.DataFrame({"high": [101.0, 101.5], "low": [99.0, 99.5], "close": [100.0, 100.8]})
outcome, exit_px, held = _simulate(100, 90, 110, 120, 130, "LONG", flat)
check("a signal that expires flat is a TIMEOUT", outcome == "TIMEOUT", outcome)
check("TIMEOUT exits at the final close, not at the stop",
      abs(exit_px - 100.8) < 1e-9, f"exit {exit_px} — booking it at the stop overstates losses")
check("TIMEOUT P&L is near zero, not a full loss",
      abs(_pnl_pct(100, exit_px, "LONG")) < 2.0, str(_pnl_pct(100, exit_px, "LONG")))

# T2/T3 must be credited at their own level, not at T1.
t3bar = pd.DataFrame({"high": [131.0], "low": [99.0], "close": [130.0]})
outcome, exit_px, _ = _simulate(100, 90, 110, 120, 130, "LONG", t3bar)
check("a T3 hit is recorded as T3", outcome == "T3_HIT", outcome)
check("a T3 hit is credited at T3, not at T1",
      abs(_pnl_pct(100, exit_px, "LONG") - 30.0) < 1e-6,
      f"{_pnl_pct(100, exit_px, 'LONG')}% — crediting T1 would report 10%")

print("\n--- shorts are handled symmetrically ---")
sbar = pd.DataFrame({"high": [101.0], "low": [88.0], "close": [89.0]})
outcome, exit_px, _ = _simulate(100, 110, 90, 80, 70, "SHORT", sbar)
check("a short reaching its target is a win", outcome == "T1_HIT" and exit_px == 90)
check("short P&L is positive when price falls", _pnl_pct(100, 90, "SHORT") > 0,
      str(_pnl_pct(100, 90, "SHORT")))
check("long P&L is negative when price falls", _pnl_pct(100, 90, "LONG") < 0)

print("\n--- ATR is causal ---")
df = series(300)
a_mid  = _atr_at(df, 100)
a_mid2 = _atr_at(df.iloc[:150].copy(), 100)
check("ATR at a bar ignores everything after it", abs(a_mid - a_mid2) < 1e-9,
      f"{a_mid} vs {a_mid2} — a backtest peeking ahead measures nothing")
check("ATR is positive", a_mid > 0)

# ── The full run ──────────────────────────────────────────────────────────────
print("\n--- walk-forward run over real-shaped data ---")
df = series(900, seed=17)
res = run_backtest(df, "TESTSYM", interval="1d", use_model=False, horizon_bars=10)

check("the run produces trades", res["signalsTested"] > 0, str(res["signalsTested"]))
check("bars used is reported", res["barsUsed"] == len(df))
check("a per-trade ledger is returned", len(res["trades"]) > 0)

print("\n--- windows are non-overlapping ---")
trades = res["trades"]
idxs = [t["index"] for t in trades]
check("trade entry bars are strictly increasing", all(b > a for a, b in zip(idxs, idxs[1:])))
overlaps = sum(1 for a, b in zip(trades, trades[1:]) if b["index"] <= a["index"] + a["barsHeld"])
check("no trade starts before the previous one resolved", overlaps == 0,
      f"{overlaps} overlapping — the old version re-tested each bar ~10x")
check("signalsTested cannot exceed the available bars",
      res["signalsTested"] <= len(df), f"{res['signalsTested']} vs {len(df)} bars")

print("\n--- grading uses no lookahead ---")
# The decisive test: grade must be a function of pre-trade inputs only. Two trades with
# the same predicted probability must carry the same grade regardless of how they ended.
by_prob = {}
for t in trades:
    by_prob.setdefault(round(t["predictedProb"], 3), set()).add(t["grade"])
inconsistent = {p: g for p, g in by_prob.items() if len(g) > 1}
check("equal predicted probability always yields the same grade",
      not inconsistent, f"{inconsistent} — grade is leaking the outcome")

wins  = [t for t in trades if t["won"]]
losses = [t for t in trades if not t["won"]]
if wins and losses:
    import statistics
    gw = statistics.mean(t["predictedProb"] for t in wins)
    gl = statistics.mean(t["predictedProb"] for t in losses)
    # With a heuristic direction these should be close. A large gap would indicate the
    # probability is being informed by the result.
    check("predicted probability is not suspiciously separated by outcome",
          abs(gw - gl) < 0.25, f"win {gw:.3f} vs loss {gl:.3f}")

print("\n--- accounting is internally consistent ---")
m = res["metrics"]
rate_sum = m["t1HitRate"] + m["t2HitRate"] + m["t3HitRate"] + m["slHitRate"] + m["timeoutRate"]
check("outcome rates sum to 100%", abs(rate_sum - 100.0) < 0.5, str(rate_sum))
check("win rate is between 0 and 100", 0 <= m["winRatePct"] <= 100)
check("timeouts are counted separately from stops", "timeoutRate" in m)
check("expectancy is reported", "expectancyPct" in m)
check("max drawdown is non-negative", m["maxDrawdownPct"] >= 0)

print("\n--- Sharpe is annualised ---")
check("periods-per-year table covers the intervals",
      all(k in INTERVAL_PERIODS_PER_YEAR for k in ("5m", "15m", "1h", "1d", "1w")))
daily = run_backtest(df, "S", interval="1d", use_model=False, horizon_bars=10)
weekly = run_backtest(df, "S", interval="1w", use_model=False, horizon_bars=10)
check("the same trades annualise differently by interval",
      daily["metrics"]["sharpe"] != weekly["metrics"]["sharpe"],
      f"1d {daily['metrics']['sharpe']} vs 1w {weekly['metrics']['sharpe']} — unscaled mean/std is not a Sharpe")

print("\n--- equity curve is compounded ---")
check("equity curve starts at 100", abs(res["equityCurve"][0] - 100.0) < 1e-6)
check("the basis is stated", "compounded" in res["equityCurveBasis"])
check("equity curve is downsampled for charting", len(res["equityCurve"]) <= 301)

print("\n--- calibration is measured, not asserted ---")
cal = res["calibration"]
check("ECE is computed from realised outcomes", isinstance(cal["ece"], float))
check("Brier is computed", isinstance(cal["brierScore"], float))
check("ECE is in range", 0.0 <= cal["ece"] <= 1.0, str(cal["ece"]))
check("Brier is in range", 0.0 <= cal["brierScore"] <= 1.0, str(cal["brierScore"]))
check("sample count matches the trades", cal["samples"] == res["signalsTested"])

print("\n--- no false pass/fail verdict ---")
check("stable is not asserted", res["stable"] is None,
      "a 75% floor on a mechanical bracket produced a permanent retrain_required")
check("action reports measurement rather than a verdict", res["action"] == "measured")

print("\n--- methodology is disclosed ---")
meth = res["methodology"]
for key in ("windows", "horizonBars", "intrabarAmbiguity", "timeoutHandling",
            "gradedFrom", "directionSource", "modelInLoop", "trainedArtifacts"):
    check(f"methodology states '{key}'", key in meth)
check("intrabar ambiguity is disclosed as conservative", "stop" in meth["intrabarAmbiguity"])
check("timeout handling is disclosed", "market" in meth["timeoutHandling"])
check("in-sample risk is addressed", "outOfSample" in meth["trainedArtifacts"])

print("\n--- grade quality is checkable ---")
check("grade distribution is returned", sum(res["gradeDistribution"].values()) == res["signalsTested"])
check("per-grade win rates are reported so grading can be judged",
      isinstance(res["gradeWinRates"], dict) and len(res["gradeWinRates"]) > 0)

print("\n--- date filtering actually filters now ---")
sub = filter_by_date_range(df, preset="1Y")
check("a preset narrows the frame", len(sub) < len(df), f"{len(sub)} vs {len(df)}")
check("a preset keeps roughly the right span",
      240 <= len(sub) <= 270, str(len(sub)))
sub2 = filter_by_date_range(df, from_date="2017-01-01", to_date="2017-12-31")
check("explicit bounds are honoured",
      sub2["date"].min() >= pd.Timestamp("2017-01-01") and sub2["date"].max() <= pd.Timestamp("2017-12-31"))
nodate = filter_by_date_range(df.drop(columns=["date"]), preset="1Y")
check("a frame without dates passes through unharmed", len(nodate) == len(df))

print("\n--- insufficient data is reported, not crashed ---")
short = run_backtest(series(30), "TINY", use_model=False)
check("a short series reports insufficient_data", short["action"] == "insufficient_data")
check("and returns the contract shape",
      all(k in short for k in ("metrics", "equityCurve", "gradeDistribution", "trades")))
check("None frame is handled", run_backtest(None, "X", use_model=False)["action"] == "insufficient_data")

print("\n--- helpers ---")
check("grade thresholds map correctly",
      _assign_grade(0.85) == "A+" and _assign_grade(0.75) == "A" and
      _assign_grade(0.65) == "B" and _assign_grade(0.55) == "C" and _assign_grade(0.2) == "D")
check("streaks are computed",
      _max_streak([{"won": True}, {"won": True}, {"won": False}, {"won": True}], True) == 2)
check("geometry is declared", set(BACKTEST_GEOMETRY) == {"sl", "t1", "t2", "t3"})

print("\n--- with the ensemble in the loop ---")
with_model = run_backtest(series(500, seed=23), "MODELED", use_model=True, horizon_bars=8, max_signals=60)
check("the model path runs", with_model["signalsTested"] > 0, str(with_model["signalsTested"]))
check("it records where direction came from",
      len(with_model["methodology"]["directionSource"]) > 0,
      str(with_model["methodology"]["directionSource"]))
check("modelInLoop is flagged", with_model["methodology"]["modelInLoop"] is True)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
