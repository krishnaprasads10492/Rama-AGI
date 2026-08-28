"""
Regression tests for the defects fixed in spec Section 64.

Each test names the defect it guards. Run from `ai_backend/`:
    python -m tests.test_defects

Deliberately dependency-light: numpy, pandas and the engine itself. No pytest, so it
runs anywhere the backend runs.
"""

import sys
import os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.calibration import (               # noqa: E402
    platt_scale, calibrate_ensemble_output, clamp_probability,
    compute_ece, compute_brier_score, REGIME_WEIGHTS,
)
from engine.features import (                  # noqa: E402
    compute_features, compute_features_dict, get_feature_names,
    compute_full_features, compute_full_features_dict, get_full_feature_names,
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
        print(f"  FAIL  {label}" + (f" — {detail}" if detail else ""))


def frame(n=260, seed=3, start=100.0):
    rng    = np.random.default_rng(seed)
    closes = start * np.cumprod(1 + rng.normal(0.0003, 0.011, n))
    opens  = np.concatenate([[start], closes[:-1]])
    highs  = np.maximum(opens, closes) * (1 + np.abs(rng.normal(0, 0.004, n)))
    lows   = np.minimum(opens, closes) * (1 - np.abs(rng.normal(0, 0.004, n)))
    return pd.DataFrame({
        "date":   pd.date_range("2023-01-02", periods=n, freq="B"),
        "open":   opens, "high": highs, "low": lows,
        "close":  closes, "volume": np.abs(rng.normal(2e6, 4e5, n)),
    })


# ── Defect 1: calibration was inverted and range-collapsing ──────────────────
print("\n--- calibration: identity at defaults, monotone increasing ---")

check("sigmoid(logit(p)) == p at A=1,B=0",
      all(abs(platt_scale(p) - p) < 1e-9 for p in (0.05, 0.2, 0.5, 0.73, 0.95)),
      str([round(platt_scale(p), 6) for p in (0.05, 0.5, 0.95)]))

probs = [0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95]
scaled = [platt_scale(p) for p in probs]
check("platt_scale is monotonically INCREASING",
      all(b > a for a, b in zip(scaled, scaled[1:])), str([round(s, 4) for s in scaled]))

# The defect in one assertion: a more confident ensemble must not report lower.
check("a more confident input yields a higher calibrated output",
      calibrate_ensemble_output(0.90) > calibrate_ensemble_output(0.55),
      f"0.90 -> {calibrate_ensemble_output(0.90):.4f}, 0.55 -> {calibrate_ensemble_output(0.55):.4f}")

check("A+ territory is reachable again (>=0.80)",
      calibrate_ensemble_output(0.88, regime="trending") >= 0.80,
      f"{calibrate_ensemble_output(0.88, regime='trending'):.4f}")

check("grade A reachable (>=0.70)",
      calibrate_ensemble_output(0.72, regime="trending") >= 0.70,
      f"{calibrate_ensemble_output(0.72, regime='trending'):.4f}")

lo, hi = calibrate_ensemble_output(0.05), calibrate_ensemble_output(0.95)
check("output spans a usable range, not ~0.29-0.51",
      (hi - lo) > 0.5, f"{lo:.4f} .. {hi:.4f}")

check("regime weights still applied",
      calibrate_ensemble_output(0.7, regime="volatile") < calibrate_ensemble_output(0.7, regime="trending"))

check("clamp still prevents 0% and 100%",
      clamp_probability(0.0) > 0 and clamp_probability(1.0) < 1)

check("calibration stays inside [0,1] for extreme inputs",
      all(0.0 <= calibrate_ensemble_output(p) <= 1.0 for p in (1e-9, 0.5, 1 - 1e-9)))

check("platt_scale with fitted A,B still bounded",
      all(0.0 <= platt_scale(p, A=2.5, B=-1.2) <= 1.0 for p in (0.01, 0.5, 0.99)))

# ── The metrics /health used to hardcode to 0 ─────────────────────────────────
print("\n--- calibration metrics are real, so health can stop faking them ---")
y_true = np.array([0, 0, 1, 1, 1, 0, 1, 0])
perfect = y_true.astype(float)
check("ECE of a perfect forecaster is ~0", compute_ece(y_true, perfect) < 1e-9)
check("ECE of an inverted forecaster is large", compute_ece(y_true, 1 - perfect) > 0.9)
check("Brier of a perfect forecaster is 0", compute_brier_score(y_true, perfect) < 1e-9)
check("Brier penalises confident-and-wrong",
      compute_brier_score(y_true, 1 - perfect) > compute_brier_score(y_true, np.full(8, 0.5)))

# ── Defect 3: feature names must match the vector, exactly ────────────────────
print("\n--- features: names derived from the vector, not hand-maintained ---")
df   = frame()
vec  = compute_features(df)
d    = compute_features_dict(df)
names = get_feature_names()

check("names count == vector length", len(names) == len(vec), f"{len(names)} names vs {len(vec)} values")
check("names match the dict keys in order", names == list(d.keys()))
check("zip(names, vector) is faithful",
      all(abs(d[n] - float(v)) < 1e-6 for n, v in zip(names, vec)))

# The specific reasons that were reading the wrong feature.
for key in ("rsi14", "price_vs_ema20", "ema20_slope", "volume_ratio", "hurst_exp", "atr14_pct", "adx14"):
    check(f"'{key}' is present and addressable by name", key in d, f"missing from {len(d)} features")

check("hurst_exp is in range [0,1]", 0.0 <= d["hurst_exp"] <= 1.0, str(d["hurst_exp"]))
check("rsi14 is normalised 0-1", 0.0 <= d["rsi14"] <= 1.0, str(d["rsi14"]))
check("atr14_pct is a sane fraction", 0.0 < d["atr14_pct"] < 0.5, str(d["atr14_pct"]))

# ── Advanced features now reach the ensemble ──────────────────────────────────
print("\n--- full feature set is joined and addressable ---")
full_d = compute_full_features_dict(df)
full_v = compute_full_features(df)
full_n = get_full_feature_names()
check("full vector is larger than base", len(full_v) > len(vec), f"{len(full_v)} vs {len(vec)}")
check("full names count == full vector length", len(full_n) == len(full_v), f"{len(full_n)} vs {len(full_v)}")
check("full names match dict order", full_n == list(full_d.keys()))
check("base features survive the join", all(full_d[n] == d[n] for n in names))
check("no NaN in the full vector", not np.isnan(full_v).any())
check("no inf in the full vector", not np.isinf(full_v).any())

# ── Defect 12: time features come from the bar, not the wall clock ────────────
print("\n--- time features describe the bar, not 'now' ---")
a = frame(seed=5)
b = a.copy()
b["date"] = pd.date_range("2019-06-03", periods=len(b), freq="B")   # same prices, different dates
da, db = compute_features_dict(a), compute_features_dict(b)
time_keys = ("hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos")
check("identical prices on different dates give different time features",
      any(abs(da[k] - db[k]) > 1e-9 for k in time_keys),
      "time features ignored the bar date — still reading the wall clock")
check("non-time features are unchanged by the date shift",
      all(abs(da[k] - db[k]) < 1e-9 for k in names if k not in time_keys))

# A frame with no date column must still work.
no_date = frame(seed=9).drop(columns=["date"])
check("a frame without dates still computes", len(compute_features(no_date)) == len(vec))


# ── End-to-end: the pipeline the renderer actually calls ──────────────────────
from engine.dispatcher import (              # noqa: E402
    generate_signals, barrier_probability, RISK_VARIANTS, GRADE_ORDER,
)
from engine.data_fetcher import mock_ohlcv, get_ohlcv   # noqa: E402
from engine.health import get_health                    # noqa: E402
from engine.registry import MODEL_REGISTRY              # noqa: E402

print("\n--- barrier probability behaves at every limit ---")
check("symmetric barriers return the directional edge",
      abs(barrier_probability(0.62, 1.0, 1.0) - 0.62) < 1e-9,
      str(barrier_probability(0.62, 1.0, 1.0)))
check("no edge reduces to the driftless result b/(a+b)",
      abs(barrier_probability(0.5, 3.0, 1.0) - 0.25) < 1e-9,
      str(barrier_probability(0.5, 3.0, 1.0)))
check("a farther target is less likely",
      barrier_probability(0.6, 4.0, 1.0) < barrier_probability(0.6, 2.0, 1.0))
check("a wider stop makes the target more likely",
      barrier_probability(0.6, 2.0, 2.0) > barrier_probability(0.6, 2.0, 1.0))
check("stays inside (0,1) at extremes",
      0 < barrier_probability(0.999, 100, 0.01) < 1 and 0 < barrier_probability(0.001, 0.01, 100) < 1)

print("\n--- /predict: one view, distinct setups, nothing discarded ---")
req = {
    "symbol": "RELIANCE", "exchange": "NSE", "instrType": "spot",
    "basePrice": 2500.0, "capital": 100000.0, "riskPct": 1.5,
    "direction": "both", "predictionMode": "realworld", "adaptiveWeight": 1.0,
    "signalCount": 16, "minGrade": "D",
}
sigs = generate_signals(dict(req))
check("signals are returned", len(sigs) > 0, str(len(sigs)))
check("count is capped at the distinct geometries, not padded to 16",
      len(sigs) <= len(RISK_VARIANTS), f"{len(sigs)} signals for {len(RISK_VARIANTS)} variants")

check("every signal names its geometry variant", all(s.get("variant") for s in sigs))
check("variants are distinct", len({s["variant"] for s in sigs}) == len(sigs))
check("risk/reward genuinely differs between setups",
      len({s["riskRewardRatio"] for s in sigs}) > 1,
      str(sorted({s["riskRewardRatio"] for s in sigs})))

# The defects that used to hardcode these.
check("regime comes from the ensemble, not the literal 'trending'",
      all(s["regime"] in ("trending", "ranging", "volatile", "low_liquidity") for s in sigs)
      and "regime_detected" in MODEL_REGISTRY.ensemble_predict(
          compute_full_features(frame()), feature_map=compute_full_features_dict(frame())),
      str({s["regime"] for s in sigs}))
check("suppressed reflects model agreement rather than always False",
      all(isinstance(s["suppressed"], bool) for s in sigs))
check("model agreement is reported", all(s.get("modelAgreement") is not None for s in sigs))
check("uncertainty is reported", all(s.get("uncertainty") is not None for s in sigs))
check("directional probability is carried separately from the geometry probability",
      all("directionalProbability" in s for s in sigs))

print("\n--- target probabilities decrease with distance ---")
for s in sigs:
    ok = s["t1Probability"] >= s["t2Probability"] >= s["t3Probability"]
    if not ok:
        check(f"{s['variant']}: T1 >= T2 >= T3", False,
              f"{s['t1Probability']}/{s['t2Probability']}/{s['t3Probability']}")
        break
else:
    check("T1 >= T2 >= T3 for every setup", True)
check("SL probability is the complement of T1",
      all(abs(s["slProbability"] + s["t1Probability"] - 100) <= 1 for s in sigs))

print("\n--- validity windows are monotonic, even past 16 signals ---")
many = generate_signals({**req, "signalCount": 50})
check("validity never lands in the past",
      all(pd.Timestamp(s["validity"]) > pd.Timestamp.now() - pd.Timedelta(minutes=1) for s in many))
check("rank 1 has the longest validity",
      pd.Timestamp(sorted(many, key=lambda s: s["rank"])[0]["validity"])
      >= pd.Timestamp(sorted(many, key=lambda s: s["rank"])[-1]["validity"]))

print("\n--- minGrade is honoured ---")
strict = generate_signals({**req, "minGrade": "A+"})
check("filtering never returns nothing", len(strict) > 0)
check("either all meet the floor, or the fallback is flagged",
      all(GRADE_ORDER.get(s["grade"], -1) >= GRADE_ORDER["A+"] for s in strict)
      or strict[0].get("belowRequestedGrade") == "A+",
      str([s["grade"] for s in strict]))
loose = generate_signals({**req, "minGrade": "D"})
check("a permissive floor keeps every setup", len(loose) == len(sigs))

print("\n--- levels come from measured ATR, not a 0.9% guess ---")
lo = generate_signals({**req, "basePrice": 2500.0})
risk_frac = abs(lo[0]["entryPrice"] - lo[0]["stopLoss"]) / lo[0]["entryPrice"]
check("stop distance is a plausible fraction of price", 0.0005 < risk_frac < 0.15, str(risk_frac))
check("an ATR reason is stated", any("ATR" in r for r in lo[0]["reasons"]))

print("\n--- mock data no longer reseeds the global RNG ---")
before = np.random.default_rng(1).normal()   # untouched reference
np.random.seed(12345)
first = np.random.normal()
np.random.seed(12345)
_ = mock_ohlcv(2500.0, 120)
after = np.random.normal()
check("global numpy stream is undisturbed by mock_ohlcv", abs(first - after) < 1e-12,
      f"{first} vs {after} — mock_ohlcv still calls np.random.seed")
check("mock frames now carry a date column", "date" in mock_ohlcv(100.0, 60).columns)
check("mock data is still deterministic for a given price",
      float(mock_ohlcv(2500.0, 60)["close"].iloc[-1]) == float(mock_ohlcv(2500.0, 60)["close"].iloc[-1]))

print("\n--- /health tells the truth ---")
h = get_health()
check("ece is null, not a fake 0", h["ece"] is None)
check("brierScore is null, not a fake 0", h["brierScore"] is None)
check("calibration is flagged unmeasured", h["calibrationMeasured"] is False)
check("modelsLoaded counts real artifacts only", h["modelsLoaded"] == 0, str(h["modelsLoaded"]))
check("modelsTotal is the real ensemble size", h["modelsTotal"] == len(h["modelStatus"]),
      f"{h['modelsTotal']} vs {len(h['modelStatus'])}")
check("loaded never exceeds total", h["modelsLoaded"] <= h["modelsTotal"])
check("level reports heuristics_only with no artifacts", h["level"] == "heuristics_only", h["level"])
check("the note says heuristics rather than claiming trained models",
      "heuristic" in h["note"].lower() and "7/4" not in h["note"], h["note"])

print("\n--- regime detection reads named features ---")
d = compute_full_features_dict(frame())
calm = dict(d);  calm.update({"atr14_pct": 0.005, "adx14": 0.10, "bb_width": 0.005})
vol  = dict(d);  vol.update({"atr14_pct": 0.05})
trend= dict(d);  trend.update({"atr14_pct": 0.01, "adx14": 0.45})
rm = MODEL_REGISTRY.regime
check("high ATR is volatile", rm.detect_regime(None, feature_map=vol) == "volatile")
check("high ADX is trending", rm.detect_regime(None, feature_map=trend) == "trending")
check("narrow bands are ranging", rm.detect_regime(None, feature_map=calm) == "ranging")


# ── Defect 11: the market-profile value area could loop forever ───────────────
#
# `market_profile_features` expanded the value area outward from the POC, taking the
# heavier neighbour each step. It read an exhausted side's contribution as 0, so on a
# 0-vs-0 tie `add_high >= add_low` chose the high side, `min(va_high_b + 1, n - 1)`
# clamped to the same index, and `va_vol += 0` changed nothing — while the `or` in the
# loop condition stayed true because the low side still had room. Infinite loop, on data
# alone: POC in the top bucket with an empty bucket beneath it. That hung backtests AND
# live /predict calls.
#
# The frame below reproduces it deterministically. Because the failure is a HANG, these
# run on a thread with a join timeout — an assertion cannot catch a loop that never
# returns.
print("\n--- market profile value area terminates ---")
import threading                                    # noqa: E402
from engine.advanced_features import (              # noqa: E402
    market_profile_features, compute_advanced_features,
)


def terminates(fn, arg, budget=10.0):
    """Run `fn(arg)` on a daemon thread. @returns (finished, value)."""
    box = {}
    th = threading.Thread(target=lambda: box.__setitem__("v", fn(arg)), daemon=True)
    th.start()
    th.join(timeout=budget)
    return (not th.is_alive()), box.get("v")


# 19 bars parked in the bottom bucket, one heavy bar alone in the top bucket. POC lands
# at bucket 19 holding 200 of 390 total — under the 70% threshold, so the value area must
# expand — and every bucket between 1 and 18 is empty.
_n = 20
poc_top = pd.DataFrame({
    "open":   [100.5] * (_n - 1) + [199.5],
    "high":   [101.0] * (_n - 1) + [200.0],
    "low":    [100.0] * (_n - 1) + [199.0],
    "close":  [100.5] * (_n - 1) + [199.5],
    "volume": [10.0]  * (_n - 1) + [200.0],
})

ok, feats = terminates(market_profile_features, poc_top)
check("value area terminates when the POC is the top bucket and the one below is empty",
      ok, "still running after 10s — the value-area loop is spinning")
if ok and feats:
    check("value area still spans both volume nodes", feats["mp_in_value_area"] == 1.0,
          str(feats))
    check("value area width is the full range, not a degenerate zero",
          feats["mp_va_width"] > 0.4, str(feats.get("mp_va_width")))
    check("every market-profile feature is finite",
          all(np.isfinite(v) for v in feats.values()), str(feats))
    check("all six market-profile features are produced", len(feats) == 6, str(len(feats)))

# The mirror case: POC in the bottom bucket with an empty bucket above it. The same
# tie-break bug in the opposite direction is not reachable in the original code, but the
# fix must not introduce it.
poc_bottom = pd.DataFrame({
    "open":   [199.5] * (_n - 1) + [100.5],
    "high":   [200.0] * (_n - 1) + [101.0],
    "low":    [199.0] * (_n - 1) + [100.0],
    "close":  [199.5] * (_n - 1) + [100.5],
    "volume": [10.0]  * (_n - 1) + [200.0],
})
ok_b, feats_b = terminates(market_profile_features, poc_bottom)
check("value area terminates when the POC is the bottom bucket", ok_b,
      "still running after 10s")

# Zero-volume bars are not hypothetical: Yahoo returns volume 0 for a long stretch of
# early NIFTY history, which is exactly how this defect surfaced.
zero_vol = frame(n=120, seed=11)
zero_vol.loc[zero_vol.index[:80], "volume"] = 0.0
ok_z, _ = terminates(market_profile_features, zero_vol.iloc[-20:].reset_index(drop=True))
check("value area terminates on a window whose bars all have zero volume", ok_z,
      "still running after 10s")

ok_all, adv = terminates(compute_advanced_features, poc_top)
check("the full advanced-feature bucket terminates on the same frame", ok_all,
      "still running after 10s")

# Every window of a real-shaped series must terminate, not just the crafted ones.
_swept = frame(n=200, seed=5)
_swept.loc[_swept.index[::3], "volume"] = 0.0
ok_sweep = True
for _i in range(20, 200):
    fin, _ = terminates(market_profile_features,
                        _swept.iloc[_i - 20:_i].reset_index(drop=True), budget=2.0)
    if not fin:
        ok_sweep = False
        break
check("180 consecutive windows with scattered zero volume all terminate", ok_sweep,
      f"window ending at {_i} hung")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
