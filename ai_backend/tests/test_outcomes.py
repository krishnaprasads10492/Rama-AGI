"""
test_outcomes.py — the loop that was never connected: record, resolve, learn.

The assertions that matter here are about *properties*, not happy paths: that a repeated
prediction for the same bar is one claim and not two, that learning is exactly-once, that
mock data never reaches the learner, and that meta-learner weights survive a restart.
Each of those, if broken, produces plausible-looking numbers that are wrong — which is the
failure mode this whole section exists to prevent.
"""

import json
import os
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


# Isolate before importing anything that touches the store.
_TMP = tempfile.mkdtemp(prefix="rama-outcome-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP

from engine import outcomes as oc          # noqa: E402
from engine import store                   # noqa: E402
from engine.registry import MODEL_REGISTRY, StackingMetaLearner   # noqa: E402


def reset():
    for p in (oc.records_path(), oc.features_path(), oc.meta_state_path()):
        if os.path.exists(p):
            os.remove(p)


def bars(n=60, start="2024-01-01", base=100.0, drift=0.0, seed=1):
    """A price series with controllable drift, so outcomes are predictable."""
    rng = np.random.default_rng(seed)
    closes = base * np.cumprod(1 + rng.normal(drift, 0.004, n))
    return pd.DataFrame({
        "date":  pd.date_range(start, periods=n, freq="B"),
        "open":  closes, "high": closes * 1.01, "low": closes * 0.99,
        "close": closes, "volume": 1e6,
    })


def signal(sid="s1", variant="Balanced", direction="LONG", prob=70,
           entry=100.0, sl=97.0, t1=104.0, t2=108.0, t3=112.0, validity=10, grade="A"):
    return {
        "id": sid, "variant": variant, "type": direction, "probability": prob,
        "directionalProbability": prob, "grade": grade,
        "entryPrice": entry, "stopLoss": sl,
        "t1Price": t1, "t2Price": t2, "t3Price": t3,
        "validityBars": validity, "suppressed": False, "regime": "trending",
    }


def ctx(bar_date="2024-01-10", source="real", nfeat=8, pid=None):
    return {
        "predictionId": pid,
        "barDate": bar_date, "dataSource": source,
        "features": np.arange(nfeat, dtype=float),
        "featureNames": [f"f{i}" for i in range(nfeat)],
        "modelProbs": {"lgbm": 0.7, "xgb": 0.65, "rf": 0.6},
        "rawProb": 0.68,
    }


PARAMS = {"symbol": "TESTSYM", "exchange": "NSE", "instrType": "spot", "interval": "1d"}


# ── Recording ─────────────────────────────────────────────────────────────────
print("\n--- recording a claim ---")
reset()

r = oc.record_prediction(PARAMS, [signal()], ctx())
check("a claim is recorded", r["recorded"] == 1, str(r))
recs = oc._read_jsonl(oc.records_path())
check("it lands in the records file", len(recs) == 1)
rec = recs[0]
check("it carries the bar it was computed on", rec["barDate"] == "2024-01-10")
check("it carries the geometry", (rec["entry"], rec["sl"], rec["t1"]) == (100.0, 97.0, 104.0))
check("probability is stored as a fraction, not a percent", rec["probability"] == 0.70)
check("the raw pre-mode probability is kept alongside it", rec["rawProbability"] == 0.68)
check("per-model probabilities are kept for the meta-learner",
      set(rec["modelProbs"]) == {"lgbm", "xgb", "rf"})
check("it starts unresolved", rec["resolved"] is False and rec["outcome"] is None)
check("it starts unlearned", rec["learnedAt"] is None)

feats = oc._read_jsonl(oc.features_path())
check("the feature vector is stored once", len(feats) == 1)
check("it is stored under the prediction id", feats[0]["predictionId"] == rec["predictionId"])
check("feature names travel with it", feats[0]["featureNames"][0] == "f0")

# Decision 4: one vector per prediction, not one per signal.
print("\n--- one feature vector per prediction, not per signal ---")
reset()
many = [signal(f"s{i}", variant=v) for i, v in
        enumerate(("Tight", "Balanced", "Wide", "Runner"))]
oc.record_prediction(PARAMS, many, ctx())
check("four variants make four claims", len(oc._read_jsonl(oc.records_path())) == 4)
check("but only ONE feature vector is stored", len(oc._read_jsonl(oc.features_path())) == 1,
      str(len(oc._read_jsonl(oc.features_path()))))
ids = {r_["predictionId"] for r_ in oc._read_jsonl(oc.records_path())}
check("all four share the same prediction id", len(ids) == 1, str(ids))


# ── Deduplication: the decision the measurement depends on ────────────────────
print("\n--- one claim per bar per variant (Section 68 decision 2) ---")
reset()
oc.record_prediction(PARAMS, [signal()], ctx())
r2 = oc.record_prediction(PARAMS, [signal(sid="s2", prob=72)], ctx())
check("re-predicting the same bar updates rather than appends",
      r2["updated"] == 1 and r2["recorded"] == 0, str(r2))
check("still exactly one claim on file", len(oc._read_jsonl(oc.records_path())) == 1)
check("the refreshed probability is the one kept",
      oc._read_jsonl(oc.records_path())[0]["probability"] == 0.72)

for i in range(20):
    oc.record_prediction(PARAMS, [signal(prob=70 + i % 3)], ctx())
check("twenty polls of one bar are still one claim",
      len(oc._read_jsonl(oc.records_path())) == 1,
      str(len(oc._read_jsonl(oc.records_path()))))

oc.record_prediction(PARAMS, [signal()], ctx(bar_date="2024-01-11"))
check("a different bar is a different claim", len(oc._read_jsonl(oc.records_path())) == 2)
oc.record_prediction(PARAMS, [signal(variant="Wide")], ctx(bar_date="2024-01-11"))
check("a different variant on the same bar is a different claim",
      len(oc._read_jsonl(oc.records_path())) == 3)
oc.record_prediction({**PARAMS, "symbol": "OTHER"}, [signal()], ctx(bar_date="2024-01-11"))
check("a different symbol is a different claim",
      len(oc._read_jsonl(oc.records_path())) == 4)
oc.record_prediction({**PARAMS, "instrType": "futures"}, [signal()], ctx(bar_date="2024-01-11"))
check("a different instrument type is a different claim",
      len(oc._read_jsonl(oc.records_path())) == 5)


# ── Resolution ────────────────────────────────────────────────────────────────
print("\n--- resolution against real bars ---")
reset()
up = bars(n=60, drift=0.004, base=100.0, seed=3)
store.merge("TESTSYM", up, "NSE", "1d", source="test")
bar_date = str(up["date"].iloc[20].date())
entry = float(up["close"].iloc[20])

oc.record_prediction(PARAMS, [signal(entry=entry, sl=entry * 0.97,
                                     t1=entry * 1.01, t2=entry * 1.02, t3=entry * 1.03,
                                     validity=10)], ctx(bar_date=bar_date))
res = oc.resolve()
check("the claim resolves", res["resolved"] == 1, str(res))
rec = oc._read_jsonl(oc.records_path())[0]
check("an outcome is recorded", rec["outcome"] in ("T1_HIT", "T2_HIT", "T3_HIT", "SL_HIT", "TIMEOUT"),
      str(rec["outcome"]))
check("a rising series hit a target, not the stop", rec["outcome"].startswith("T"), rec["outcome"])
check("pnl is positive on a target hit", rec["pnlPct"] > 0, str(rec["pnlPct"]))
check("`won` agrees with pnl", rec["won"] == (rec["pnlPct"] > 0))
check("bars held is recorded", rec["barsHeld"] >= 1)
check("resolution is timestamped", rec["resolvedAt"] is not None)

res2 = oc.resolve()
check("re-resolving does not re-resolve", res2["resolved"] == 0, str(res2))
check("it reports what it skipped", res2["alreadyResolved"] == 1, str(res2))

# A short claim on a falling series must stop out, using the backtest's rules.
print("\n--- the resolver uses the backtest's rules (Section 68 decision 1) ---")
reset()
store.merge("TESTSYM", up, "NSE", "1d", source="test")
oc.record_prediction(PARAMS, [signal(direction="SHORT", entry=entry,
                                     sl=entry * 1.005, t1=entry * 0.99,
                                     t2=entry * 0.98, t3=entry * 0.97, validity=10)],
                     ctx(bar_date=bar_date))
oc.resolve()
short_rec = oc._read_jsonl(oc.records_path())[0]
check("a short into a rally stops out", short_rec["outcome"] == "SL_HIT", str(short_rec["outcome"]))
check("its pnl is negative", short_rec["pnlPct"] < 0, str(short_rec["pnlPct"]))

# Same inputs through the backtest simulator must give the same answer.
from engine.backtest import _simulate_np       # noqa: E402
w = up.iloc[21:31]
direct = _simulate_np(entry, entry * 1.005, entry * 0.99, entry * 0.98, entry * 0.97,
                      "SHORT", w["high"].to_numpy(float), w["low"].to_numpy(float),
                      w["close"].to_numpy(float))
check("the resolver's outcome equals the backtest simulator's on the same inputs",
      direct[0] == short_rec["outcome"]
      and abs(direct[1] - short_rec["exitPrice"]) < 5e-4     # record stores 4dp
      and direct[2] == short_rec["barsHeld"],
      f"{direct} vs {short_rec['outcome']}/{short_rec['exitPrice']}/{short_rec['barsHeld']}")

# Early scoring must not happen.
print("\n--- a claim is not scored before its horizon elapses ---")
reset()
short_series = up.iloc[:24].copy()            # only 3 bars after index 20
store.merge("TESTSYM2", short_series, "NSE", "1d", source="test")
oc.record_prediction({**PARAMS, "symbol": "TESTSYM2"},
                     [signal(entry=entry, sl=entry * 0.5, t1=entry * 2.0,
                             t2=entry * 3.0, t3=entry * 4.0, validity=10)],
                     ctx(bar_date=bar_date))
r_early = oc.resolve()
check("a claim whose horizon has not elapsed stays pending",
      r_early["resolved"] == 0 and r_early["pending"] == 1, str(r_early))
check("it is still unresolved on file",
      oc._read_jsonl(oc.records_path())[0]["resolved"] is False)

# But one that closed early inside the available bars resolves now.
reset()
store.merge("TESTSYM2", short_series, "NSE", "1d", source="test")
oc.record_prediction({**PARAMS, "symbol": "TESTSYM2"},
                     [signal(entry=entry, sl=entry * 0.97, t1=entry * 1.001,
                             t2=entry * 1.002, t3=entry * 1.003, validity=10)],
                     ctx(bar_date=bar_date))
r_close = oc.resolve()
check("a claim that closed early resolves without waiting out the horizon",
      r_close["resolved"] == 1, str(r_close))

print("\n--- claims with no bars, no date, or mock data ---")
reset()
oc.record_prediction({**PARAMS, "symbol": "NOSUCHSYMBOL"}, [signal()], ctx())
r_nb = oc.resolve()
check("a symbol with no stored bars is counted, not crashed", r_nb["noBars"] == 1, str(r_nb))

reset()
oc.record_prediction(PARAMS, [signal()], ctx(bar_date=None))
r_nd = oc.resolve()
check("a claim with no bar date is counted, not crashed", r_nd["noBarDate"] == 1, str(r_nd))

reset()
store.merge("TESTSYM", up, "NSE", "1d", source="test")
oc.record_prediction(PARAMS, [signal()], ctx(bar_date=bar_date, source="mock"))
r_mock = oc.resolve()
check("a mock-data claim is recorded but never resolved against real price",
      r_mock["skippedMock"] == 1 and r_mock["resolved"] == 0, str(r_mock))
check("it stays unresolved", oc._read_jsonl(oc.records_path())[0]["resolved"] is False)


# ── Learning: exactly once ────────────────────────────────────────────────────
print("\n--- learning is exactly-once (Section 68 decision 5) ---")
reset()
MODEL_REGISTRY._meta = StackingMetaLearner(n_models=MODEL_REGISTRY._meta.n)
before_w = MODEL_REGISTRY._meta.weights.copy()
before_n = MODEL_REGISTRY.meta_update_count()
check("weights start uniform", np.allclose(before_w, before_w[0]), str(before_w))

store.merge("TESTSYM", up, "NSE", "1d", source="test")
for i in range(6):
    bd = str(up["date"].iloc[10 + i].date())
    e  = float(up["close"].iloc[10 + i])
    oc.record_prediction(PARAMS, [signal(sid=f"x{i}", entry=e, sl=e * 0.97,
                                         t1=e * 1.005, t2=e * 1.01, t3=e * 1.02,
                                         validity=8)],
                         ctx(bar_date=bd))
oc.resolve()
l1 = oc.learn()
check("resolved claims are learned", l1["learned"] == 6, str(l1))
check("the meta-learner update count rose by exactly that many",
      MODEL_REGISTRY.meta_update_count() == before_n + 6,
      f"{MODEL_REGISTRY.meta_update_count()} vs {before_n + 6}")
check("weights are no longer uniform — the learner actually moved",
      not np.allclose(MODEL_REGISTRY._meta.weights, before_w),
      str(np.round(MODEL_REGISTRY._meta.weights, 4)))

n_after = MODEL_REGISTRY.meta_update_count()
l2 = oc.learn()
check("re-running learn consumes nothing", l2["learned"] == 0, str(l2))
check("and does not touch the update count",
      MODEL_REGISTRY.meta_update_count() == n_after)
check("every learned record is stamped",
      all(r_["learnedAt"] for r_ in oc._read_jsonl(oc.records_path()) if r_["resolved"]))

print("\n--- mock claims never reach the learner (Section 68 decision 6) ---")
reset()
MODEL_REGISTRY._meta = StackingMetaLearner(n_models=MODEL_REGISTRY._meta.n)
n0 = MODEL_REGISTRY.meta_update_count()
recs = oc._read_jsonl(oc.records_path())
oc.record_prediction(PARAMS, [signal()], ctx(bar_date=bar_date, source="mock"))
# Force it resolved, as a buggy resolver might.
forced = oc._read_jsonl(oc.records_path())
forced[0].update({"resolved": True, "won": True, "outcome": "T1_HIT", "pnlPct": 1.0,
                  "resolvedAt": "2024-01-01T00:00:00"})
oc._rewrite_jsonl(oc.records_path(), forced)
lm = oc.learn()
check("even a resolved mock claim is not learned from", lm["learned"] == 0, str(lm))
check("the update count is untouched", MODEL_REGISTRY.meta_update_count() == n0)


# ── Persistence: what makes the loop real ─────────────────────────────────────
print("\n--- learned weights survive a restart (Section 68 decision 5) ---")
reset()
MODEL_REGISTRY._meta = StackingMetaLearner(n_models=MODEL_REGISTRY._meta.n)
MODEL_REGISTRY._meta.perf_ema = np.linspace(0.2, 0.9, MODEL_REGISTRY._meta.n)
MODEL_REGISTRY._meta.weights  = np.linspace(0.05, 0.3, MODEL_REGISTRY._meta.n)
MODEL_REGISTRY._meta.weights /= MODEL_REGISTRY._meta.weights.sum()
MODEL_REGISTRY._meta._update_count = 137
saved_w = MODEL_REGISTRY._meta.weights.copy()
saved_e = MODEL_REGISTRY._meta.perf_ema.copy()

check("state saves", MODEL_REGISTRY.save_meta_state())
check("a state file exists", os.path.exists(MODEL_REGISTRY._meta_state_path()))

# Simulate the process restarting: fresh uniform learner, then restore.
MODEL_REGISTRY._meta = StackingMetaLearner(n_models=MODEL_REGISTRY._meta.n)
check("a fresh learner is uniform and has no updates",
      MODEL_REGISTRY.meta_update_count() == 0)
check("state restores", MODEL_REGISTRY.load_meta_state())
check("the weights came back", np.allclose(MODEL_REGISTRY._meta.weights, saved_w),
      str(np.round(MODEL_REGISTRY._meta.weights - saved_w, 6)))
check("the performance EMA came back", np.allclose(MODEL_REGISTRY._meta.perf_ema, saved_e))
check("the update count came back", MODEL_REGISTRY.meta_update_count() == 137)

print("\n--- a mismatched or corrupt state is discarded, not misapplied ---")
with open(MODEL_REGISTRY._meta_state_path(), "r", encoding="utf-8") as fh:
    good = json.load(fh)

bad_n = dict(good); bad_n["n"] = good["n"] + 1
with open(MODEL_REGISTRY._meta_state_path(), "w", encoding="utf-8") as fh:
    json.dump(bad_n, fh)
MODEL_REGISTRY._meta = StackingMetaLearner(n_models=MODEL_REGISTRY._meta.n)
check("a state with a different model count is refused",
      MODEL_REGISTRY.load_meta_state() is False)
check("and the uniform weights are left intact",
      np.allclose(MODEL_REGISTRY._meta.weights, 1.0 / MODEL_REGISTRY._meta.n))

bad_names = dict(good); bad_names["modelNames"] = ["a"] * len(good["modelNames"])
with open(MODEL_REGISTRY._meta_state_path(), "w", encoding="utf-8") as fh:
    json.dump(bad_names, fh)
check("a state whose model NAMES differ is refused — weights are positional",
      MODEL_REGISTRY.load_meta_state() is False)

bad_sum = dict(good); bad_sum["weights"] = [0.0] * len(good["weights"])
with open(MODEL_REGISTRY._meta_state_path(), "w", encoding="utf-8") as fh:
    json.dump(bad_sum, fh)
check("weights that sum to zero are refused", MODEL_REGISTRY.load_meta_state() is False)

with open(MODEL_REGISTRY._meta_state_path(), "w", encoding="utf-8") as fh:
    fh.write("{not json")
check("a corrupt state file is refused without raising",
      MODEL_REGISTRY.load_meta_state() is False)
os.remove(MODEL_REGISTRY._meta_state_path())
check("an absent state file simply reports False", MODEL_REGISTRY.load_meta_state() is False)


# ── Torn lines ────────────────────────────────────────────────────────────────
print("\n--- a torn final line loses one record, not the file ---")
reset()
oc.record_prediction(PARAMS, [signal(sid="a")], ctx(bar_date="2024-02-01"))
oc.record_prediction(PARAMS, [signal(sid="b")], ctx(bar_date="2024-02-02"))
with open(oc.records_path(), "a", encoding="utf-8") as fh:
    fh.write('{"partial": tru')
kept = oc._read_jsonl(oc.records_path())
check("the two intact records still read", len(kept) == 2, str(len(kept)))


# ── Measured statistics ───────────────────────────────────────────────────────
print("\n--- measured stats, and the thresholds below which nothing is claimed ---")
reset()
s0 = oc.stats()
check("with nothing recorded, calibration is unmeasured",
      s0["calibrationMeasured"] is False and s0["ece"] is None)
check("adaptive weight is exactly 1.0 and flagged unmeasured",
      s0["adaptiveWeight"] == 1.0 and s0["adaptiveWeightMeasured"] is False)
check("it says what is missing", "note" in s0)

# Enough resolved claims to cross the calibration threshold but not the weight one.
def seed_resolved(n, win_rate=0.6, prob=0.6):
    rows = []
    for i in range(n):
        rows.append({
            "predictionId": f"p{i}", "signalId": f"s{i}", "symbol": "TESTSYM",
            "exchange": "NSE", "instrType": "spot", "interval": "1d",
            "barDate": f"2024-03-{(i % 28) + 1:02d}", "recordedAt": f"2024-03-01T00:{i:02d}:00",
            "variant": f"v{i}", "direction": "LONG", "entry": 100.0, "sl": 97.0,
            "t1": 104.0, "t2": 108.0, "t3": 112.0,
            "probability": prob, "rawProbability": prob,
            "directionalProbability": prob, "grade": "A" if i % 2 else "B",
            "validityBars": 10, "suppressed": False, "regime": "trending",
            "dataSource": "real", "modelProbs": {"lgbm": 0.6, "xgb": 0.6, "rf": 0.6},
            "resolved": True, "outcome": "T1_HIT" if i < n * win_rate else "SL_HIT",
            "exitPrice": 104.0 if i < n * win_rate else 97.0,
            "pnlPct": 4.0 if i < n * win_rate else -3.0,
            "won": i < n * win_rate, "barsHeld": 3,
            "resolvedAt": f"2024-03-15T00:{i:02d}:00", "learnedAt": None,
        })
    oc._rewrite_jsonl(oc.records_path(), rows)


seed_resolved(oc.MIN_SAMPLES_FOR_CALIBRATION, win_rate=0.6, prob=0.6)
s1 = oc.stats()
check(f"calibration is reported at {oc.MIN_SAMPLES_FOR_CALIBRATION} resolved outcomes",
      s1["calibrationMeasured"] is True and s1["ece"] is not None, str(s1["ece"]))
check("a well-calibrated set has a small ECE", s1["ece"] < 0.1, str(s1["ece"]))
check("Brier is reported too", s1["brierScore"] is not None)
check("the win rate is measured", abs(s1["winRatePct"] - 60.0) < 0.1, str(s1["winRatePct"]))
check("the mean predicted probability is reported", abs(s1["meanPredicted"] - 0.6) < 1e-6)
check("adaptive weight is still unmeasured below its own, higher threshold",
      s1["adaptiveWeightMeasured"] is False and s1["adaptiveWeight"] == 1.0, str(s1))
check("grade breakdown is reported", "byGrade" in s1 and len(s1["byGrade"]) == 2,
      str(s1.get("byGrade")))
check("outcome counts are reported", "outcomeCounts" in s1)

# An overconfident forecaster must produce a weight below 1.
seed_resolved(oc.MIN_SAMPLES_FOR_WEIGHT + 10, win_rate=0.4, prob=0.8)
s2 = oc.stats()
check(f"adaptive weight is measured at {oc.MIN_SAMPLES_FOR_WEIGHT}+ outcomes",
      s2["adaptiveWeightMeasured"] is True, str(s2["adaptiveWeight"]))
check("an overconfident forecaster is corrected DOWNWARD",
      s2["adaptiveWeight"] < 1.0, str(s2["adaptiveWeight"]))
check("the correction is win rate over mean predicted",
      abs(s2["adaptiveWeight"] - (s2["winRatePct"] / 100) / s2["meanPredicted"]) < 1e-3,
      str(s2["adaptiveWeight"]))
check("a high ECE is reported for a badly calibrated set", s2["ece"] > 0.3, str(s2["ece"]))

# And an underconfident one above 1, clamped to the schema's bounds.
seed_resolved(oc.MIN_SAMPLES_FOR_WEIGHT + 10, win_rate=0.9, prob=0.2)
s3 = oc.stats()
check("an underconfident forecaster is corrected UPWARD", s3["adaptiveWeight"] > 1.0,
      str(s3["adaptiveWeight"]))
check("the correction is clamped to the range the request schema validates",
      s3["adaptiveWeight"] <= oc.ADAPTIVE_WEIGHT_BOUNDS[1], str(s3["adaptiveWeight"]))

w, measured = oc.measured_adaptive_weight()
check("measured_adaptive_weight agrees with stats", w == s3["adaptiveWeight"] and measured)


# ── The dispatcher path ───────────────────────────────────────────────────────
print("\n--- adaptiveWeight is measured, with the request as an override ---")
from engine.dispatcher import resolve_adaptive_weight, generate_signals   # noqa: E402

w_m, src = resolve_adaptive_weight({"symbol": "TESTSYM"})
check("with history, the default resolves to the measured value",
      src["measured"] is True and w_m == s3["adaptiveWeight"], f"{w_m} {src}")
w_o, src_o = resolve_adaptive_weight({"symbol": "TESTSYM", "adaptiveWeight": 1.75})
check("an explicitly supplied weight still wins", w_o == 1.75 and src_o["source"] == "request",
      f"{w_o} {src_o}")
w_d, src_d = resolve_adaptive_weight({"symbol": "TESTSYM", "adaptiveWeight": 1.0})
check("the schema default 1.0 is treated as 'not supplied', so measurement applies",
      src_d["measured"] is True, str(src_d))

reset()
w_n, src_n = resolve_adaptive_weight({"symbol": "FRESHSYM"})
check("with no history it is exactly 1.0 and flagged unmeasured",
      w_n == 1.0 and src_n["measured"] is False, f"{w_n} {src_n}")


# ── End to end through /predict's real path ───────────────────────────────────
print("\n--- end to end: generate_signals records automatically ---")
reset()
real = bars(n=300, drift=0.0006, base=2500.0, seed=11)
store.merge("E2ESYM", real, "NSE", "1d", source="test")

req = {"symbol": "E2ESYM", "exchange": "NSE", "instrType": "spot",
       "basePrice": float(real["close"].iloc[-1]), "capital": 100000.0, "riskPct": 1.5,
       "direction": "both", "predictionMode": "realworld", "signalCount": 4,
       "minGrade": "D", "interval": "1d",
       "ohlcv": real.assign(date=real["date"].astype(str)).to_dict("records")}

sigs = generate_signals(req)
check("signals are produced", len(sigs) > 0, str(len(sigs)))
e2e = oc._read_jsonl(oc.records_path())
check("they were recorded without anyone asking", len(e2e) == len(sigs),
      f"{len(e2e)} records for {len(sigs)} signals")
check("the recorded bar date is the last bar, not today",
      e2e[0]["barDate"] == str(real["date"].iloc[-1].date()), str(e2e[0]["barDate"]))
check("the data source was captured", e2e[0]["dataSource"] in ("real", "mock"))
check("per-model probabilities were captured", len(e2e[0]["modelProbs"]) > 0)
check("one feature vector for the whole prediction",
      len(oc._read_jsonl(oc.features_path())) == 1)
check("the feature vector has the full width",
      len(oc._read_jsonl(oc.features_path())[0]["features"]) > 50,
      str(len(oc._read_jsonl(oc.features_path())[0]["features"])))

sigs2 = generate_signals(req)
check("calling /predict again does not double the record count",
      len(oc._read_jsonl(oc.records_path())) == len(sigs2), str(len(oc._read_jsonl(oc.records_path()))))

# Resolve on a mid-history bar so later bars exist.
reset()
mid_date = str(real["date"].iloc[250].date())
oc.record_prediction({"symbol": "E2ESYM", "exchange": "NSE", "instrType": "spot",
                      "interval": "1d"},
                     [signal(entry=float(real["close"].iloc[250]),
                             sl=float(real["close"].iloc[250]) * 0.97,
                             t1=float(real["close"].iloc[250]) * 1.01,
                             t2=float(real["close"].iloc[250]) * 1.02,
                             t3=float(real["close"].iloc[250]) * 1.03, validity=10)],
                     ctx(bar_date=mid_date))
rr = oc.resolve()
ll = oc.learn()
check("the full loop runs end to end", rr["resolved"] == 1 and ll["learned"] == 1,
      f"{rr} {ll}")
check("learning persisted the meta state",
      os.path.exists(MODEL_REGISTRY._meta_state_path()))


# ── /health ───────────────────────────────────────────────────────────────────
print("\n--- /health reports measured calibration once it exists ---")
reset()
from engine.health import get_health          # noqa: E402

h0 = get_health()
check("with nothing resolved, ece is still null", h0["ece"] is None)
check("and calibrationMeasured is False", h0["calibrationMeasured"] is False)
check("it reports the loop's counts", h0["outcomes"]["recordedPredictions"] == 0)
check("the note explains what to do next", "resolve" in h0["note"].lower(), h0["note"])

seed_resolved(40, win_rate=0.55, prob=0.57)
h1 = get_health()
check("with resolved outcomes, ece is a number", h1["ece"] is not None, str(h1["ece"]))
check("calibrationMeasured flips to True", h1["calibrationMeasured"] is True)
check("brierScore is reported", h1["brierScore"] is not None)
check("the resolved count is reported", h1["outcomes"]["resolvedOutcomes"] == 40,
      str(h1["outcomes"]["resolvedOutcomes"]))
check("the measured win rate is reported", h1["outcomes"]["measuredWinRatePct"] is not None)
check("the note now states the measurement", "measured" in h1["note"].lower(), h1["note"])


# ── Provenance: online-fitted is not the same claim as trained ────────────────
#
# Connecting the loop made `OnlineSGDModel.partial_fit` reachable for the first time, and
# it used to set `trained = True` — a flag documented as "loaded a fitted artifact from
# disk". So /health began claiming an artifact that does not exist after a single online
# sample. Section 68 split the two.
print("\n--- online-fitted is reported separately from trained ---")
sgd = MODEL_REGISTRY.sgd
sgd._reset_model()
NF = 20                                    # one width throughout, or sklearn rejects it

check("a fresh online model reports no samples", sgd.is_online_fitted() is False)
check("and does not claim to be trained", sgd.is_trained() is False)
check("and is not ready to displace the heuristic", sgd.online_ready() is False)

for i in range(10):
    sgd.partial_fit(np.arange(NF, dtype=float) + i, i % 2)
check("partial_fit counts samples", sgd.online_samples == 10, str(sgd.online_samples))
check("partial_fit still does NOT claim a trained artifact", sgd.is_trained() is False)
check("it does report being online-fitted", sgd.is_online_fitted() is True)
check(f"but not ready below {sgd.MIN_ONLINE_SAMPLES} samples — a 10-sample logistic "
      f"model is worse than the heuristic it would replace",
      sgd.online_ready() is False)

h3 = get_health()
check("/health counts it as online-fitted, not as a loaded artifact",
      h3["modelsLoaded"] == 0 and h3["modelsOnlineFitted"] == 1,
      f"loaded={h3['modelsLoaded']} online={h3['modelsOnlineFitted']}")
check("the model's type reads 'online', not 'trained' or 'heuristic'",
      h3["modelStatus"]["online_sgd"]["type"] == "online",
      h3["modelStatus"]["online_sgd"]["type"])
check("the sample count is visible", h3["modelStatus"]["online_sgd"]["onlineSamples"] == 10)
check("the note distinguishes the two", "fitted online" in h3["note"], h3["note"])
check("loaded + online + mocked accounts for every model",
      h3["modelsLoaded"] + h3["modelsOnlineFitted"] + h3["modelsMocked"] == h3["modelsTotal"],
      str(h3))

for i in range(sgd.MIN_ONLINE_SAMPLES):
    sgd.partial_fit(np.arange(NF, dtype=float) + i, i % 2)
check(f"past {sgd.MIN_ONLINE_SAMPLES} samples with both classes seen it becomes ready",
      sgd.online_ready() is True, str(sgd.online_samples))
check("even then it does not claim a trained artifact", sgd.is_trained() is False)

# One class only must never be ready — a single-class SGD is a constant.
sgd._reset_model()
for i in range(sgd.MIN_ONLINE_SAMPLES + 20):
    sgd.partial_fit(np.arange(NF, dtype=float) + i, 1)
check("a model that has only ever seen one class is never ready, however many samples",
      sgd.online_ready() is False,
      f"{sgd.online_samples} samples, classes {sgd._classes_seen}")

# A feature-width change must reset rather than warn forever. Task 4 adds derivative
# features, so this path will be taken for real.
print("\n--- a feature-width change resets the online model ---")
sgd._reset_model()
for i in range(60):
    sgd.partial_fit(np.arange(NF, dtype=float) + i, i % 2)
check("it accumulated samples at the original width", sgd.online_samples == 60,
      str(sgd.online_samples))
check("and became ready", sgd.online_ready() is True)
sgd.partial_fit(np.arange(NF + 12, dtype=float), 1)
check("a wider vector resets the count instead of failing silently forever",
      sgd.online_samples == 1, str(sgd.online_samples))
check("the new width is accepted, not rejected", sgd._n_features == NF + 12,
      str(sgd._n_features))
check("it is no longer ready, so the heuristic takes over during the rebuild",
      sgd.online_ready() is False)
for i in range(sgd.MIN_ONLINE_SAMPLES + 5):
    sgd.partial_fit(np.arange(NF + 12, dtype=float) + i, i % 2)
check("it relearns at the new width and becomes ready again", sgd.online_ready() is True,
      str(sgd.online_samples))
sgd._reset_model()

# /health must survive the loop being unavailable.
_orig = oc.stats
try:
    oc.stats = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    h2 = get_health()
    check("/health still answers when the outcome loop raises", h2["level"] is not None)
    check("and it says the loop is unavailable",
          h2["outcomes"].get("outcomeLoop") == "unavailable", str(h2["outcomes"]))
finally:
    oc.stats = _orig


# ── Pruning ───────────────────────────────────────────────────────────────────
print("\n--- retention prunes records and their feature vectors together ---")
reset()
_orig_max = oc.MAX_RECORDS
try:
    oc.MAX_RECORDS = 10
    for i in range(14):
        oc.record_prediction(PARAMS, [signal(sid=f"p{i}")], ctx(bar_date=f"2024-04-{i+1:02d}"))
    kept = oc._read_jsonl(oc.records_path())
    check("records are capped", len(kept) == 10, str(len(kept)))
    check("the newest are the ones kept",
          kept[-1]["barDate"] == "2024-04-14", str(kept[-1]["barDate"]))
    fk = oc._read_jsonl(oc.features_path())
    check("orphaned feature vectors are pruned with them", len(fk) == 10, str(len(fk)))
    ids = {r_["predictionId"] for r_ in kept}
    check("every surviving vector belongs to a surviving record",
          all(f["predictionId"] in ids for f in fk))
finally:
    oc.MAX_RECORDS = _orig_max

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
