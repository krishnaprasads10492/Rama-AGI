"""
test_horizons.py — three horizons, and the two defects that would have destroyed intraday.

The load-bearing assertions are the ones that fail silently if broken: that an intraday series
keeps its time component through a store round-trip (a date-only serialisation collapses a
session to one bar and de-duplication then discards the rest), and that artifacts and
provenance are horizon-scoped so a positional model's evidence cannot vouch for an intraday
one.
"""

import datetime as _dt
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


_TMP = tempfile.mkdtemp(prefix="rama-horizon-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import horizons as H          # noqa: E402
from engine import store, training, featureset, providers   # noqa: E402


# ── The horizon abstraction ───────────────────────────────────────────────────
print("\n--- a horizon is (interval, bars), not a number ---")

check("all three horizons exist",
      set(H.HORIZONS) == {"intraday", "swing", "positional"}, str(set(H.HORIZONS)))
check("intraday is on HOURLY bars — daily cannot express intraday at all",
      H.get("intraday").interval == "60m", H.get("intraday").interval)
check("swing is 5 daily bars, the historical default unchanged",
      H.get("swing").interval == "1d" and H.get("swing").bars == 5)
check("positional is 20 daily bars",
      H.get("positional").interval == "1d" and H.get("positional").bars == 20)
check("intraday looks less than one session ahead",
      H.get("intraday").bars < 7, str(H.get("intraday").bars))

check("each horizon has a distinct artifact key",
      len({h.key for h in H.HORIZONS.values()}) == 3,
      str([h.key for h in H.HORIZONS.values()]))
check("the key encodes both interval and lookahead", H.get("swing").key == "1d_h5",
      H.get("swing").key)
check("swing and positional share an interval but not a key",
      H.get("swing").interval == H.get("positional").interval
      and H.get("swing").key != H.get("positional").key)

check("resolve() defaults to all three in a stable order",
      [h.name for h in H.resolve()] == ["intraday", "swing", "positional"])
check("resolve() honours a subset", [h.name for h in H.resolve(["swing"])] == ["swing"])
check("an unknown name is dropped, not fatal",
      [h.name for h in H.resolve(["wombat", "swing"])] == ["swing"])
check("an all-unknown request falls back to the default set",
      len(H.resolve(["wombat"])) == 3)
check("duplicates collapse", len(H.resolve(["swing", "swing"])) == 1)

print("\n--- display-only intervals are declared, not silently absent ---")
check("5m and 15m are recorded as display-only",
      {"5m", "15m"} <= set(H.DISPLAY_ONLY), str(set(H.DISPLAY_ONLY)))
check("each says WHY it cannot be trained",
      all("cap" in v or "days" in v for v in H.DISPLAY_ONLY.values()))
check("no display-only interval is also a trainable horizon",
      not ({h.interval for h in H.HORIZONS.values()} & set(H.DISPLAY_ONLY)))
reg = H.registry()
check("the registry lists all three plus the display-only set",
      len(reg["horizons"]) == 3 and reg["displayOnly"])
check("the registry states that answers are not averaged",
      "never averaged" in reg["note"], reg["note"])


# ── Artifact scoping ──────────────────────────────────────────────────────────
print("\n--- artifacts and provenance are horizon-scoped ---")
check("a horizon suffixes the artifact",
      H.artifact_name("rf_direction.pkl", H.get("swing")) == "rf_direction__1d_h5.pkl",
      H.artifact_name("rf_direction.pkl", H.get("swing")))
check("intraday gets its own file",
      H.artifact_name("rf_direction.pkl", H.get("intraday")) == "rf_direction__60m_h3.pkl")
check("swing and positional do NOT collide despite sharing an interval",
      H.artifact_name("rf_direction.pkl", H.get("swing"))
      != H.artifact_name("rf_direction.pkl", H.get("positional")))
check("the extension is preserved for non-pickle formats",
      H.artifact_name("lgbm_direction.txt", H.get("swing")) == "lgbm_direction__1d_h5.txt")
check("None yields the LEGACY unsuffixed name, so a pre-Section-73 install still loads",
      H.artifact_name("rf_direction.pkl", None) == "rf_direction.pkl")
check("provenance is per-horizon",
      H.provenance_name(H.get("intraday")) == "training__60m_h3.json")
check("legacy provenance name is unchanged", H.provenance_name(None) == "training.json")
check("training.provenance_path honours the horizon",
      os.path.basename(training.provenance_path(H.get("positional"))) == "training__1d_h20.json")


# ── THE INTRADAY STORE DEFECT ─────────────────────────────────────────────────
print("\n--- an intraday series survives a store round-trip (Section 73 defect 1) ---")
#
# `store.merge` wrote `date_format="%Y-%m-%d"` unconditionally. Every bar in a session then
# serialises to the same midnight timestamp and the de-duplication on `date` keeps ONE bar per
# day — a 3,499-bar hourly series silently reduced to ~500 rows, with no error anywhere.

check("60m is recognised as intraday", store.is_intraday("60m") is True)
check("1d is not", store.is_intraday("1d") is False)
check("1w is not", store.is_intraday("1w") is False)
check("5m and 15m are", store.is_intraday("5m") and store.is_intraday("15m"))
check("the interval test is case-insensitive", store.is_intraday("60M") is True)

# Seven hourly bars a day across ten days: 70 distinct timestamps, only 10 distinct dates.
stamps = []
d = _dt.datetime(2026, 6, 1, 9, 15)
for day in range(10):
    for hr in range(7):
        stamps.append(d + _dt.timedelta(days=day, hours=hr))
n = len(stamps)
px = 24000 + np.arange(n) * 3.0
intraday = pd.DataFrame({"date": stamps, "open": px, "high": px * 1.001,
                         "low": px * 0.999, "close": px, "volume": 1e5})

saved = store.merge("HOURLY", intraday, "NSE", "60m", source="test")
check("all 70 hourly bars are stored", saved is not None and len(saved) == 70,
      str(len(saved) if saved is not None else None))
back = store.load("HOURLY", "NSE", "60m")
check("and all 70 read back — not collapsed to 10 daily rows",
      back is not None and len(back) == 70, str(len(back) if back is not None else None))
check("timestamps keep their time component",
      pd.Timestamp(back["date"].iloc[1]).hour != pd.Timestamp(back["date"].iloc[0]).hour,
      f"{back['date'].iloc[0]} / {back['date'].iloc[1]}")
check("the intra-session ordering is preserved",
      list(back["date"]) == sorted(back["date"]))
check("closes are distinct, so no bars were silently merged",
      back["close"].nunique() == 70, str(back["close"].nunique()))
check("the last bar is the last hour of the last day",
      pd.Timestamp(back["date"].iloc[-1]) == stamps[-1],
      f"{back['date'].iloc[-1]} vs {stamps[-1]}")

# And a daily series must still serialise date-only, unchanged.
daily = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=30, freq="B"),
                      "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5,
                      "volume": 1e6})
store.merge("DAILY", daily, "NSE", "1d", source="test")
csv_path, _ = store.paths("DAILY", "NSE", "1d")
with open(csv_path, "r", encoding="utf-8") as fh:
    first_data_line = fh.readlines()[1]
check("a daily file is still written date-only, as its existing files are",
      ":" not in first_data_line.split(",")[0], first_data_line[:40])

hourly_path, _ = store.paths("HOURLY", "NSE", "60m")
with open(hourly_path, "r", encoding="utf-8") as fh:
    hl = fh.readlines()[1]
check("an hourly file carries the time in its date column", ":" in hl.split(",")[0], hl[:40])

print("\n--- re-merging an intraday series does not lose bars ---")
again = store.merge("HOURLY", intraday.iloc[:20], "NSE", "60m", source="test")
check("a partial re-merge keeps all 70", len(again) == 70, str(len(again)))
extra_stamps = [stamps[-1] + _dt.timedelta(hours=i + 1) for i in range(7)]
extra = pd.DataFrame({"date": extra_stamps, "open": 25000.0, "high": 25010.0,
                      "low": 24990.0, "close": 25005.0, "volume": 1e5})
grown = store.merge("HOURLY", extra, "NSE", "60m", source="test")
check("new hourly bars append", len(grown) == 77, str(len(grown)))


# ── THE PROVIDER DEFECT ───────────────────────────────────────────────────────
print("\n--- the provider can request an interval at all (Section 73 defect 2) ---")
check("intraday ranges are declared per interval",
      {"5m", "15m", "60m"} <= set(providers.INTRADAY_RANGE), str(set(providers.INTRADAY_RANGE)))
check("60m is the deepest — 2 years, measured",
      providers.INTRADAY_RANGE["60m"] == "2y", providers.INTRADAY_RANGE["60m"])
check("5m and 15m are capped at one month, as Yahoo enforces",
      providers.INTRADAY_RANGE["5m"] == "1mo" and providers.INTRADAY_RANGE["15m"] == "1mo")
check("1m is capped at five days", providers.INTRADAY_RANGE["1m"] == "5d")
check("1d is NOT in the intraday range table — it keeps explicit epochs (Section 65)",
      "1d" not in providers.INTRADAY_RANGE)
check("fetch_history accepts an interval",
      "interval" in providers.fetch_history.__code__.co_varnames)

# A provider whose fetcher predates the interval argument must still work.
legacy_calls = []


def legacy_fetch(symbol, exchange, years, key):
    legacy_calls.append((symbol, exchange, years))
    return pd.DataFrame({"date": pd.date_range("2026-01-01", periods=30, freq="B"),
                         "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5,
                         "volume": 1000.0})


p = providers.Provider("legacy_test", "free", legacy_fetch)
got = p.fetch("X", "NSE", 1, "1d")
check("a four-argument legacy fetcher is still called (I11)",
      got is not None and len(legacy_calls) == 1, str(legacy_calls))


# ── Multi-horizon prediction ──────────────────────────────────────────────────
print("\n--- each horizon is answered from its OWN bar interval ---")

rng = np.random.default_rng(7)
dn = 600
cl = 24000 * np.cumprod(1 + rng.normal(0.0004, 0.006, dn))
store.merge("MULTISYM", pd.DataFrame({
    "date": pd.date_range("2024-01-01", periods=dn, freq="B"),
    "open": cl, "high": cl * 1.005, "low": cl * 0.995, "close": cl, "volume": 1e6,
}), "NSE", "1d", source="test")

hn = 1400
hstamps = []
d = _dt.datetime(2025, 1, 1, 9, 15)
while len(hstamps) < hn:
    if d.weekday() < 5:
        for hr in range(7):
            hstamps.append(d + _dt.timedelta(hours=hr))
            if len(hstamps) >= hn:
                break
    d += _dt.timedelta(days=1)
hc = 24000 * np.cumprod(1 + rng.normal(0.0001, 0.002, len(hstamps)))
store.merge("MULTISYM", pd.DataFrame({
    "date": hstamps, "open": hc, "high": hc * 1.001, "low": hc * 0.999,
    "close": hc, "volume": 1e5,
}), "NSE", "60m", source="test")

res = H.predict_all("MULTISYM", "NSE")
check("all three horizons are answered", len(res["horizons"]) == 3, str(list(res["horizons"])))
for name in ("intraday", "swing", "positional"):
    e = res["horizons"][name]
    check(f"{name} produced a probability", e.get("probability") is not None,
          str(e.get("error")))
    if e.get("probability") is not None:
        check(f"{name} probability is in range", 0.0 < e["probability"] < 1.0,
              str(e["probability"]))
        check(f"{name} reports a direction", e["direction"] in ("LONG", "SHORT"))

iq = res["horizons"]["intraday"]
sq = res["horizons"]["swing"]
check("intraday used the hourly series", iq.get("bars") == len(hstamps),
      f"{iq.get('bars')} vs {len(hstamps)}")
check("swing used the daily series", sq.get("bars") == dn, f"{sq.get('bars')} vs {dn}")
check("intraday's asOf carries a time — it is an hourly bar",
      ":" in str(iq.get("asOf")), str(iq.get("asOf")))
check("swing and positional read the same series, so the same bar count",
      sq.get("bars") == res["horizons"]["positional"].get("bars"))

print("\n--- a missing interval is reported, not faked ---")
res2 = H.predict_all("NOSUCHSYM", "NSE", sync_if_missing=False)
check("every horizon reports an error rather than a number",
      all(v["probability"] is None and v["error"] for v in res2["horizons"].values()),
      str(res2["horizons"]))
check("the error says what is missing",
      "bars" in res2["horizons"]["swing"]["error"], res2["horizons"]["swing"]["error"])
check("agreement reports unknown rather than inventing one",
      res2["agreement"]["state"] == "unknown", str(res2["agreement"]))


# ── Agreement, not averaging ───────────────────────────────────────────────────
print("\n--- agreement is reported; the three are never averaged ---")

def hz(intraday_p, swing_p, positional_p):
    return {
        "intraday":   {"probability": intraday_p,
                       "direction": "LONG" if intraday_p >= 0.5 else "SHORT"},
        "swing":      {"probability": swing_p,
                       "direction": "LONG" if swing_p >= 0.5 else "SHORT"},
        "positional": {"probability": positional_p,
                       "direction": "LONG" if positional_p >= 0.5 else "SHORT"},
    }


a = H.agreement(hz(0.62, 0.58, 0.61))
check("all-long is reported as aligned-long", a["state"] == "aligned-long", str(a))
check("it lists which horizons are long", set(a["long"]) == {"intraday", "swing", "positional"})
check("and none short", a["short"] == [])

b = H.agreement(hz(0.38, 0.42, 0.40))
check("all-short is aligned-short", b["state"] == "aligned-short", str(b))

c = H.agreement(hz(0.40, 0.52, 0.63))
check("a split is reported as split, not averaged away", c["state"] == "split", str(c))
check("intraday-short against positional-long is named as a pullback in an uptrend",
      "pullback" in c["note"].lower(), c["note"])
check("it says the two trades are opposite", "opposite" in c["note"].lower(), c["note"])

e = H.agreement(hz(0.61, 0.48, 0.39))
check("the mirror case is named as a bounce in a downtrend",
      "bounce" in e["note"].lower(), e["note"])
check("and warns it is the configuration that traps buyers",
      "trap" in e["note"].lower(), e["note"])

f = H.agreement(hz(0.55, 0.90, 0.52))
check("cross-horizon conviction is the WEAKEST, not the strongest or the mean",
      abs(f["weakestConviction"] - 0.04) < 1e-9, str(f["weakestConviction"]))
check("the spread across horizons is reported",
      abs(f["spread"] - 0.38) < 1e-9, str(f["spread"]))
check("no blended probability is emitted anywhere in the agreement block",
      not any(k in f for k in ("probability", "blended", "mean", "average")), str(list(f)))
check("partially-answered horizons are counted honestly",
      H.agreement({"swing": {"probability": 0.6, "direction": "LONG"},
                   "intraday": {"probability": None}})["answered"] == 1)


# ── Horizon-scoped artifacts at predict time ──────────────────────────────────
print("\n--- a horizon uses its own artifact when one exists ---")
from engine.registry import MODEL_REGISTRY      # noqa: E402
from sklearn.pipeline import Pipeline           # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
import joblib                                   # noqa: E402

nfeat = len(featureset.feature_names())
Xt = rng.normal(0, 1, (300, nfeat))
# A model that always says up, so its influence is unmistakable.
yt = (Xt[:, 0] > -99).astype(int)
yt[:5] = 0
pipe = Pipeline([("scale", StandardScaler()),
                 ("est", RandomForestClassifier(n_estimators=20, random_state=1))])
pipe.fit(Xt, yt)
featureset.save_manifest(featureset.feature_names(), include_derivatives=False)
hz_i = H.get("intraday")
joblib.dump(pipe, os.path.join(featureset.models_dir(),
                               H.artifact_name("rf_direction.pkl", hz_i)))
MODEL_REGISTRY.clear_horizon_cache()

loaded = MODEL_REGISTRY.horizon_models(hz_i.key)
check("the horizon's artifact loads", "random_forest" in loaded, str(list(loaded)))
check("a horizon with no artifact loads nothing",
      MODEL_REGISTRY.horizon_models(H.get("swing").key) == {})

vec = np.zeros(nfeat, dtype=np.float32)
r_shared = MODEL_REGISTRY.ensemble_predict(vec)
r_hz = MODEL_REGISTRY.ensemble_predict(vec, horizon_key=hz_i.key)
check("the shared call reports no horizon models",
      r_shared.get("horizonModels") == [], str(r_shared.get("horizonModels")))
check("the horizon call reports which member used its own artifact",
      r_hz.get("horizonModels") == ["random_forest"], str(r_hz.get("horizonModels")))
check("the horizon key travels on the response", r_hz.get("horizonKey") == hz_i.key)
check("both still return a usable probability",
      0.0 < r_shared["probability"] < 1.0 and 0.0 < r_hz["probability"] < 1.0)
check("every ensemble member still voted",
      len(r_hz["model_probs"]) == len(r_shared["model_probs"]),
      f"{len(r_hz['model_probs'])} vs {len(r_shared['model_probs'])}")

print("\n--- a misaligned contract refuses horizon artifacts too ---")
m = featureset.load_manifest()
bad = dict(m)
bad["featureNames"] = list(m["featureNames"])
bad["featureNames"][3], bad["featureNames"][8] = bad["featureNames"][8], bad["featureNames"][3]
with open(featureset.manifest_path(), "w", encoding="utf-8") as fh:
    json.dump(bad, fh)
MODEL_REGISTRY.clear_horizon_cache()
check("a permuted contract refuses the horizon artifact",
      MODEL_REGISTRY.horizon_models(hz_i.key) == {},
      str(MODEL_REGISTRY.horizon_models(hz_i.key)))
check("and the prediction still answers, from the heuristic ensemble",
      0.0 < MODEL_REGISTRY.ensemble_predict(vec, horizon_key=hz_i.key)["probability"] < 1.0)
with open(featureset.manifest_path(), "w", encoding="utf-8") as fh:
    json.dump(m, fh)
MODEL_REGISTRY.clear_horizon_cache()
check("restoring the manifest makes it usable again",
      "random_forest" in MODEL_REGISTRY.horizon_models(hz_i.key))


# ── Multi-horizon training ────────────────────────────────────────────────────
print("\n--- training fits one set per horizon, on each horizon's own interval ---")
rep = training.train_horizons("MULTISYM", "NSE", models=["random_forest"],
                              n_splits=3, stride=3, dry_run=True, sync_missing=False)
check("all three horizons are attempted", len(rep["horizons"]) == 3, str(list(rep["horizons"])))
for name in ("intraday", "swing", "positional"):
    e = rep["horizons"][name]
    ok = ("models" in e) or ("skipped" in e)
    check(f"{name} either trained or said why not", ok, str(e.get("skipped")))

trained = {k: v for k, v in rep["horizons"].items() if "models" in v}
if trained:
    print(f"  (trained: {sorted(trained)})")
    for name, e in trained.items():
        print(f"    {name:11} rows={e['rows']:5} holdout={e['holdoutRows']:4} "
              f"AUC={e['models']['random_forest']['holdout']['auc']}")
    check("each trained horizon reports its own train range",
          all("trainRange" in v for v in trained.values()))
    check("train and holdout never overlap for any horizon",
          all(v["trainRange"]["last"] < v["holdoutRange"]["first"] for v in trained.values()),
          str({k: (v["trainRange"], v["holdoutRange"]) for k, v in trained.items()}))
    check("the gate is reported once and is the SAME gate as single-horizon training",
          rep["gate"] and rep["gate"]["minAuc"] == training.MIN_AUC
          and rep["gate"]["minFoldAuc"] == training.MIN_FOLD_AUC, str(rep["gate"]))
    if "intraday" in trained and "swing" in trained:
        check("intraday trained on more rows than swing — hourly bars are denser",
              trained["intraday"]["rows"] > trained["swing"]["rows"],
              f"{trained['intraday']['rows']} vs {trained['swing']['rows']}")
check("dry run persisted nothing", rep["persisted"] == [], str(rep["persisted"]))
check("the summary states what happened", "horizons trained" in rep["summary"], rep["summary"])

print("\n--- a horizon with no data is skipped with a reason, not silently ---")
rep2 = training.train_horizons("ONLYDAILY", "NSE", models=["random_forest"],
                              dry_run=True, sync_missing=False)
check("every horizon is accounted for", len(rep2["horizons"]) == 3)
check("each carries a skip reason",
      all("skipped" in v for v in rep2["horizons"].values()),
      str({k: list(v) for k, v in rep2["horizons"].items()}))
check("the reason names the shortfall",
      "bars" in rep2["horizons"]["swing"]["skipped"], rep2["horizons"]["swing"]["skipped"])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
