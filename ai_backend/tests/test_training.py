"""
test_training.py — labels, splits, the acceptance gate, and the feature contract.

The load-bearing assertions here are the ones that would let a bad model ship quietly:
that labels look forward and never fill, that no validation block precedes its training
block, that the holdout is untouched by every fold, that a misaligned artifact is REFUSED
rather than used, and that the scaler cannot be separated from the estimator.

Real NIFTY data yields no model that clears the gate (recorded in Section 69), so the
persist/load path is proved on a synthetic series where direction genuinely is predictable.
Otherwise "nothing persisted" would be indistinguishable from "persisting is broken".
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


_TMP = tempfile.mkdtemp(prefix="rama-train-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import featureset, store, training   # noqa: E402
from engine import models as M                   # noqa: E402


# ── Labels ────────────────────────────────────────────────────────────────────
print("\n--- labels look forward, and are undefined where the future is not known ---")

closes = np.array([100.0, 101, 102, 103, 104, 103, 102, 101, 100, 99], dtype=float)
y = training.make_labels(closes, horizon=2)
check("the last `horizon` labels are NaN, not filled",
      np.isnan(y[-2:]).all() and not np.isnan(y[:-2]).any(), str(y))
check("a rise over the horizon labels 1", y[0] == 1.0, str(y[0]))
check("a fall over the horizon labels 0", y[5] == 0.0, str(y[5]))
check("the label compares t+h against t, not t+1 against t",
      y[3] == 0.0, f"close[3]={closes[3]} close[5]={closes[5]} label={y[3]}")
check("a horizon longer than the series yields all NaN",
      np.isnan(training.make_labels(closes, horizon=50)).all())
check("a zero horizon yields all NaN", np.isnan(training.make_labels(closes, 0)).all())

flat = np.full(10, 100.0)
check("an exactly flat move is labelled 0, not 1 — 'not down' is not 'up'",
      training.make_labels(flat, 2)[0] == 0.0)

# The threshold variant exists but must be off by default.
atr = np.full(10, 5.0)
yt = training.make_labels(closes, 2, threshold_atr=1.0, atr=atr)
check("with a wide threshold, small moves become NaN rather than a forced direction",
      np.isnan(yt[0]), str(yt[0]))
check("the default labels that same move", y[0] == 1.0)


# ── Splits ────────────────────────────────────────────────────────────────────
print("\n--- forward-chaining splits, and a holdout nothing touches ---")

folds, (h0, h1) = training.forward_chaining_splits(1000, n_splits=4, holdout_frac=0.2)
check("folds are produced", len(folds) == 4, str(len(folds)))
check("the holdout is the final fifth", (h0, h1) == (800, 1000), f"{h0},{h1}")

ok_order = all(tr.max() < va.min() for tr, va in folds)
check("every validation block starts strictly after its training block ends", ok_order)
check("training windows grow", all(len(folds[i][0]) < len(folds[i + 1][0])
                                  for i in range(len(folds) - 1)))
check("NO fold touches the holdout",
      all(va.max() < h0 and tr.max() < h0 for tr, va in folds),
      str([(int(tr.max()), int(va.max())) for tr, va in folds]))
check("indices are contiguous and ordered — nothing was shuffled",
      all(np.array_equal(tr, np.arange(tr.min(), tr.max() + 1)) for tr, va in folds))
check("a tiny series yields no folds rather than nonsense",
      training.forward_chaining_splits(3, 4, 0.2)[0] == [])
check("an empty series is handled", training.forward_chaining_splits(0)[0] == [])
check("holdout fraction is clamped to something sane",
      training.forward_chaining_splits(1000, 4, 0.99)[1][0] >= 500)


# ── Metrics ───────────────────────────────────────────────────────────────────
print("\n--- the gate's metrics ---")

check("base rate is the majority class", training.base_rate(np.array([1, 1, 1, 0])) == 0.75)
check("base rate is symmetric", training.base_rate(np.array([0, 0, 0, 1])) == 0.75)

t = np.array([0, 0, 1, 1], dtype=float)
check("a perfect ranker scores AUC 1.0",
      training.auc_score(np.array([0.1, 0.2, 0.8, 0.9]), t) == 1.0)
check("an inverted ranker scores AUC 0.0",
      training.auc_score(np.array([0.9, 0.8, 0.2, 0.1]), t) == 0.0)
check("a constant predictor scores AUC 0.5",
      training.auc_score(np.full(4, 0.5), t) == 0.5)
check("a single-class truth has no AUC rather than a fake one",
      training.auc_score(np.array([0.1, 0.9]), np.array([1.0, 1.0])) is None)

# AUC must be prior-invariant; accuracy must not be. That difference is the reason the gate
# uses AUC at all (Section 69).
rng = np.random.default_rng(3)
skew = np.concatenate([np.ones(90), np.zeros(10)])
p_const = np.full(100, 0.9)
s_const = training.score_model(p_const, skew)
check("a constant-majority predictor gets high ACCURACY on skewed data",
      s_const["accuracy"] == 0.9, str(s_const["accuracy"]))
check("...but AUC 0.5, exposing that it knows nothing",
      s_const["auc"] == 0.5, str(s_const["auc"]))
check("...and its Brier skill is <= 0 because it is no better than climatology",
      s_const["brierSkillScore"] <= 0, str(s_const["brierSkillScore"]))

perfect = training.score_model(skew * 0.98 + 0.01, skew)
check("a near-perfect forecaster has positive Brier skill",
      perfect["brierSkillScore"] > 0.9, str(perfect["brierSkillScore"]))
check("and AUC 1.0", perfect["auc"] == 1.0)

overconf = training.score_model(np.where(skew == 1, 0.999, 0.001)[::-1], skew)
check("a confidently WRONG forecaster has strongly negative Brier skill",
      overconf["brierSkillScore"] < -1.0, str(overconf["brierSkillScore"]))
check("climatology Brier is reported so the skill score can be checked by hand",
      "brierClimatology" in s_const)


# ── Featureset contract ───────────────────────────────────────────────────────
print("\n--- the feature manifest is the contract (Section 69) ---")

base_names = featureset.feature_names(include_derivatives=False)
deriv_names = featureset.feature_names(include_derivatives=True)
check("the base feature set is the 100 price/volume features", len(base_names) == 100,
      str(len(base_names)))
check("derivative columns are APPENDED, never interleaved",
      deriv_names[:len(base_names)] == base_names)
check("the derivative block is the declared list",
      deriv_names[len(base_names):] == featureset.DERIV_FEATURES)
check("names are unique", len(set(deriv_names)) == len(deriv_names))

check("with no manifest, nothing is claimed to be trained against a contract",
      featureset.load_manifest() is None)
check("and alignment therefore passes — nothing to violate",
      M.artifact_alignment()[0] is True, str(M.artifact_alignment()))
check("and inference defaults to no derivative columns",
      featureset.include_derivatives_default() is False)

featureset.save_manifest(base_names, include_derivatives=False)
m = featureset.load_manifest()
check("the manifest round-trips", m and m["featureNames"] == base_names)
check("it records the featureset version", m["featuresetVersion"] == featureset.FEATURESET_VERSION)
check("it records the derivative flag", m["includeDerivatives"] is False)
check("alignment passes against the live builder", M.artifact_alignment()[0] is True)

ok, why = featureset.validate_against_live(base_names[:-1], False)
check("a DROPPED feature is caught", ok is False and "count changed" in why, why)
ok, why = featureset.validate_against_live(base_names + ["invented"], False)
check("an ADDED feature is caught", ok is False, why)

permuted = list(base_names)
permuted[4], permuted[9] = permuted[9], permuted[4]
ok, why = featureset.validate_against_live(permuted, False)
check("a PERMUTATION is caught — a set comparison would have passed this",
      ok is False and "order changed" in why, why)
check("and it names the position that moved", "position 4" in why, why)

featureset.save_manifest(base_names, include_derivatives=False,
                         extra={"featuresetVersion": 999})
bad = featureset.load_manifest()
bad["featuresetVersion"] = 999
with open(featureset.manifest_path(), "w", encoding="utf-8") as fh:
    json.dump(bad, fh)
ok, why = M.artifact_alignment()
check("a featureset VERSION bump refuses every artifact", ok is False and "version" in why, why)

with open(featureset.manifest_path(), "w", encoding="utf-8") as fh:
    fh.write("{not json")
check("a corrupt manifest is treated as absent, not as aligned",
      featureset.load_manifest() is None)
os.remove(featureset.manifest_path())


# ── Derivative block ──────────────────────────────────────────────────────────
print("\n--- derivative features are constant width, neutral-filled, and flagged ---")

d_absent = featureset.derivative_features("NOSUCH", "NSE", "2026-01-01")
check("the block is always the full width", set(d_absent) == set(featureset.DERIV_FEATURES))
check("absent data is flagged, not silently neutral",
      d_absent["deriv_available"] == 0.0)
check("an absent put/call ratio is 1.0 — balanced, not 0",
      d_absent["pcr_oi"] == 1.0, str(d_absent["pcr_oi"]))
check("absent distances are 0.0", d_absent["max_pain_dist"] == 0.0)
check("every value is finite — sklearn rejects NaN outright",
      all(np.isfinite(v) for v in d_absent.values()))

from engine import derivatives as dv        # noqa: E402

rows = []
for day in range(1, 11):
    rows.append({c: None for c in dv.DERIV_COLUMNS})
    rows[-1].update({
        "date": f"2026-03-{day:02d}", "spot": 100.0 + day,
        "pcr_oi": 0.8, "pcr_volume": 0.9, "pcr_oi_all": 0.85,
        "max_pain_dist": 0.01, "resistance_dist": 0.02, "support_dist": 0.03,
        "oi_concentration": 0.2, "straddle_pct": 0.015,
        "ce_oi": 1000.0, "pe_oi": 800.0, "ce_oi_chg": 100.0, "pe_oi_chg": -80.0,
        "fut_close": 101.0, "fut_basis_pct": 0.004, "fut_oi": 5000.0,
        "fut_oi_chg": 250.0, "rollover_pct": 0.2, "days_to_expiry": 15,
        "source": "test",
    })
store.merge("DERIVSYM", pd.DataFrame(rows), "NSE", dv.DERIV_INTERVAL,
            source="test", columns=dv.DERIV_COLUMNS)

d_have = featureset.derivative_features("DERIVSYM", "NSE", "2026-03-05")
check("stored metrics are joined", d_have["deriv_available"] == 1.0)
check("PCR comes through", abs(d_have["pcr_oi"] - 0.8) < 1e-9, str(d_have["pcr_oi"]))
check("OI change is normalised by the level it changed from, not left raw",
      abs(d_have["ce_oi_chg_norm"] - 0.1) < 1e-9, str(d_have["ce_oi_chg_norm"]))
check("a negative OI change keeps its sign",
      abs(d_have["pe_oi_chg_norm"] - (-0.1)) < 1e-9, str(d_have["pe_oi_chg_norm"]))
check("days to expiry is scaled by a month",
      abs(d_have["days_to_expiry_norm"] - 0.5) < 1e-9, str(d_have["days_to_expiry_norm"]))

# The as-of rule: a bar must never see a metric row dated after it.
d_before = featureset.derivative_features("DERIVSYM", "NSE", "2026-02-01")
check("a bar before every stored row gets no data, not the first future row",
      d_before["deriv_available"] == 0.0, str(d_before["deriv_available"]))
d_mid = featureset._deriv_row_for("DERIVSYM", "NSE", "2026-03-05")
check("the as-of lookup takes the latest row ON OR BEFORE the bar",
      str(pd.Timestamp(d_mid["date"]).date()) == "2026-03-05", str(d_mid["date"]))
d_gap = featureset._deriv_row_for("DERIVSYM", "NSE", "2026-03-15")
check("a later bar carries the most recent prior row forward",
      str(pd.Timestamp(d_gap["date"]).date()) == "2026-03-10", str(d_gap["date"]))
check("OI change normalisation survives a zero level rather than dividing by it",
      featureset._norm_oi_change(50.0, 0.0) == 0.0)
check("and a non-finite input", featureset._norm_oi_change(float("nan"), 10.0) == 0.0)


# ── Synthetic learnable series ────────────────────────────────────────────────
print("\n--- the persist/load path, on data where direction IS predictable ---")


def trending_series(n=3000, seed=7):
    """
    Sustained runs, so recent slope genuinely predicts the next few bars.

    Real NIFTY yields no model that clears the gate (Section 69). Without a series that
    *does*, "nothing persisted" and "persisting is broken" look identical.
    """
    rng = np.random.default_rng(seed)
    out, price, i = [], 100.0, 0
    while len(out) < n:
        run = int(rng.integers(30, 70))
        drift = 0.004 if i % 2 == 0 else -0.004
        for _ in range(run):
            price *= (1 + drift + rng.normal(0, 0.0015))
            out.append(price)
            if len(out) >= n:
                break
        i += 1
    c = np.array(out[:n])
    return pd.DataFrame({
        "date": pd.date_range("2010-01-01", periods=n, freq="B"),
        "open": c, "high": c * 1.004, "low": c * 0.996, "close": c,
        "volume": 1e6,
    })


store.merge("SYNTH", trending_series(), "NSE", "1d", source="test")
rep = training.train("SYNTH", "NSE", "1d", horizon=5, models=["random_forest"],
                     n_splits=3, stride=2)
check("training runs on the synthetic series", rep.get("ok"), str(rep.get("reason")))
if rep.get("ok"):
    rf = rep["models"]["random_forest"]
    print(f"  (AUC {rf['holdout']['auc']} BSS {rf['holdout']['brierSkillScore']} "
          f"foldAUC {rf['foldMeanAuc']})")
    check("a genuinely predictable series clears the gate", rf["accepted"] is True,
          str(rf.get("reason")))
    check("and the artifact is written", rf["persisted"] is True)
    check("the artifact file exists on disk",
          os.path.exists(os.path.join(featureset.models_dir(), "rf_direction.pkl")))
    check("provenance is written", training.load_provenance() is not None)
    check("provenance records the horizon",
          training.load_provenance()["horizonBars"] == 5)
    check("provenance records the training date range",
          "first" in training.load_provenance()["trainRange"])
    check("the manifest is written alongside", featureset.load_manifest() is not None)
    check("the manifest matches what was fitted",
          featureset.load_manifest()["featureCount"] == rep["featureCount"])
    check("train and holdout ranges do not overlap",
          rep["trainRange"]["last"] < rep["holdoutRange"]["first"],
          f"{rep['trainRange']['last']} vs {rep['holdoutRange']['first']}")
    check("the registry reloaded and now reports a trained model",
          "random_forest" in (rep.get("reloaded") or {}).get("trainedAfter", []),
          str(rep.get("reloaded")))

    # THE SCALER MUST BE INSIDE THE ARTIFACT. If it were not, this raw vector would be
    # scored on the wrong scale and nothing would raise (Section 69).
    import joblib
    pipe = joblib.load(os.path.join(featureset.models_dir(), "rf_direction.pkl"))
    check("the persisted object is a Pipeline, not a bare estimator",
          type(pipe).__name__ == "Pipeline", type(pipe).__name__)
    check("it carries a scaler as its first step",
          "StandardScaler" in type(pipe.steps[0][1]).__name__, str(pipe.steps[0]))
    raw = np.arange(rep["featureCount"], dtype=float) * 3.7
    p = float(pipe.predict_proba(raw.reshape(1, -1))[0][1])
    check("it predicts from a RAW vector, scaling internally", 0.0 <= p <= 1.0, str(p))

    from engine.registry import MODEL_REGISTRY   # noqa: E402
    check("the live registry model reports trained", MODEL_REGISTRY.rf.is_trained() is True)
    live = MODEL_REGISTRY.rf.predict_proba(raw.astype(np.float32))
    check("and answers through the normal predict path", 0.05 <= live <= 0.95, str(live))

    print("\n--- a misaligned manifest REFUSES the artifact rather than misusing it ---")
    good_manifest = featureset.load_manifest()
    broken = dict(good_manifest)
    broken["featureNames"] = list(good_manifest["featureNames"])
    broken["featureNames"][2], broken["featureNames"][7] = \
        broken["featureNames"][7], broken["featureNames"][2]
    with open(featureset.manifest_path(), "w", encoding="utf-8") as fh:
        json.dump(broken, fh)
    ok, why = M.artifact_alignment()
    check("alignment now fails", ok is False, why)
    M._ALIGNMENT_WARNED = False
    reload_info = MODEL_REGISTRY.reload_models()
    check("the trained artifact is refused on reload",
          MODEL_REGISTRY.rf.is_trained() is False, str(reload_info))
    check("the model falls back to its heuristic and still answers",
          0.0 <= MODEL_REGISTRY.rf.predict_proba(raw.astype(np.float32)) <= 1.0)
    check("the refusal reason is reported",
          reload_info["featureContract"]["aligned"] is False)

    with open(featureset.manifest_path(), "w", encoding="utf-8") as fh:
        json.dump(good_manifest, fh)
    M._ALIGNMENT_WARNED = False
    again = MODEL_REGISTRY.reload_models()
    check("restoring the manifest makes the artifact usable again",
          MODEL_REGISTRY.rf.is_trained() is True, str(again))


# ── The gate rejects, for the right reasons ───────────────────────────────────
print("\n--- the gate's three conditions are independent ---")

g = {"minAuc": training.MIN_AUC, "minBrierSkill": training.MIN_BRIER_SKILL,
     "minFoldAuc": training.MIN_FOLD_AUC}
check("all three thresholds are declared", set(g) == {"minAuc", "minBrierSkill", "minFoldAuc"})
check("the AUC threshold is above chance by a margin", training.MIN_AUC > 0.5)
check("Brier skill must be strictly positive", training.MIN_BRIER_SKILL == 0.0)
check("fold stability is only 'not worse than chance'", training.MIN_FOLD_AUC == 0.50)

# A pure random walk must be rejected. Sized so the holdout clears MIN_HOLDOUT_ROWS — the
# point is that the gate rejects it ON MERIT, not that it declines to judge.
rng = np.random.default_rng(11)
n = 2600
rw = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
store.merge("RANDOMWALK", pd.DataFrame({
    "date": pd.date_range("2008-01-01", periods=n, freq="B"),
    "open": rw, "high": rw * 1.005, "low": rw * 0.995, "close": rw, "volume": 1e6,
}), "NSE", "1d", source="test")
rw_rep = training.train("RANDOMWALK", "NSE", "1d", horizon=5, models=["random_forest"],
                        n_splits=3, stride=2, dry_run=True)
check("a random walk trains without error", rw_rep.get("ok"), str(rw_rep.get("reason")))
if rw_rep.get("ok"):
    rwm = rw_rep["models"]["random_forest"]
    hg = rwm["gate"]
    print(f"  (random walk n={rwm['holdout']['n']} AUC {rwm['holdout']['auc']} "
          f"floor {hg['aucSignificanceFloor']} BSS {rwm['holdout']['brierSkillScore']} "
          f"foldAUC {rwm['foldMeanAuc']})")
    check("the holdout is large enough to be judged", hg["passesHoldoutSize"] is True,
          str(rwm["holdout"]["n"]))
    check("a random walk is REJECTED — there is nothing to learn", rwm["accepted"] is False,
          str(rwm["holdout"]))
    check("and the reason names which condition failed", bool(rwm.get("reason")))
check("dry_run writes no artifact for it", rw_rep["models"]["random_forest"]["persisted"] is False)

# The small-sample guard itself: a tiny holdout must be refused rather than judged.
print("\n--- a holdout too small to judge is refused, not flattered ---")
small = training.train("RANDOMWALK", "NSE", "1d", horizon=5, models=["random_forest"],
                       n_splits=3, stride=14, dry_run=True)
if small.get("ok"):
    sm = small["models"]["random_forest"]
    print(f"  (n={sm['holdout']['n']} AUC {sm['holdout']['auc']})")
    check("a small holdout fails the size condition",
          sm["gate"]["passesHoldoutSize"] is False, str(sm["holdout"]["n"]))
    check("so the model is not accepted however good the numbers look",
          sm["accepted"] is False, str(sm["holdout"]["auc"]))
    check("and the reason says the sample is too small to judge",
          "too few" in (sm.get("reason") or ""), sm.get("reason"))

print("\n--- the AUC significance floor scales with sample size ---")
se_small = training.auc_standard_error(25, 25)
se_big = training.auc_standard_error(2500, 2500)
check("a small sample has a wide standard error", se_small > 0.09, str(se_small))
check("a large sample has a narrow one", se_big < 0.011, str(se_big))
check("so a small sample must clear a HIGHER AUC to be believed",
      0.5 + 2 * se_small > 0.5 + 2 * se_big)
check("the minority class sets the precision, not the total",
      training.auc_standard_error(10000, 9) == training.auc_standard_error(9, 10000))
check("too few of either class gives no standard error rather than a fake one",
      training.auc_standard_error(1000, 1) is None)


# ── In-sample detection ───────────────────────────────────────────────────────
print("\n--- the backtest can finally tell in-sample from out-of-sample ---")
from engine.backtest import _trained_model_note   # noqa: E402

prov = training.load_provenance()
if prov:
    tr = prov["trainRange"]
    inside = pd.DataFrame({"date": pd.to_datetime([tr["first"], tr["last"]])})
    note_in = _trained_model_note(inside)
    check("a window overlapping the training range is flagged IN-SAMPLE",
          note_in.get("outOfSample") is False, str(note_in.get("outOfSample")))
    check("and the note says so in words a reader will notice",
          "IN-SAMPLE" in note_in.get("note", ""), note_in.get("note"))
    after = pd.DataFrame({"date": pd.to_datetime(["2035-01-01", "2035-06-01"])})
    note_out = _trained_model_note(after)
    check("a window entirely after training is flagged out of sample",
          note_out.get("outOfSample") is True, str(note_out.get("outOfSample")))
    check("the training range is reported for checking", "trainedOn" in note_in)
    check("the horizon the model was fitted for is reported",
          note_in.get("horizonBars") == prov["horizonBars"])
    check("a window with no dates says unknown rather than guessing",
          _trained_model_note(pd.DataFrame()).get("outOfSample") == "unknown")


# ── Directories ───────────────────────────────────────────────────────────────
print("\n--- training and loading agree on where artifacts live ---")
check("models_dir honours STOCKMIND_MODELS_DIR",
      os.path.abspath(featureset.models_dir()) ==
      os.path.abspath(os.environ["STOCKMIND_MODELS_DIR"]),
      featureset.models_dir())
check("models.py resolves the SAME directory as the trainer",
      os.path.abspath(M._models_dir()) == os.path.abspath(featureset.models_dir()),
      f"{M._models_dir()} vs {featureset.models_dir()}")


# ── Refusals are results ──────────────────────────────────────────────────────
print("\n--- too little data is reported, not crashed ---")
tiny = pd.DataFrame({
    "date": pd.date_range("2024-01-01", periods=50, freq="B"),
    "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1e6,
})
store.merge("TINY", tiny, "NSE", "1d", source="test")
tr_tiny = training.train("TINY", "NSE", "1d", horizon=5)
check("a too-short series reports why rather than raising",
      tr_tiny.get("ok") is False and "bars" in tr_tiny.get("reason", ""),
      str(tr_tiny.get("reason")))
check("an unknown symbol reports why",
      training.train("NOSUCHSYMBOL", "NSE", "1d").get("ok") is False)
check("an unknown model name is skipped, not fatal",
      "wombat" in training.train("SYNTH", "NSE", "1d", horizon=5,
                                 models=["wombat"], dry_run=True).get("skipped", {}))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
