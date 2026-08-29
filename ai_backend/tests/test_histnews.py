"""
test_histnews.py — the GDELT historical-news path, verified without the network.

WHY OFFLINE. GDELT is verified to work (Section 72: 181 daily tone points for H1 2018, and
tone tracking the covid crash), but it throttles hard and blocked this machine at the TLS
handshake after the probing burst. A live nine-year backfill therefore has to run in a fresh
window. What CAN be verified now, and is verified here, is every part that is not the socket:
the plain-text-error handling, the point parsing, the year-by-year merge, the lag discipline
that keeps tone out of the same bar, and — most importantly — that the measurement pipeline
detects a real signal and rejects a fake one.

That last pair is the point. When the backfill does run, the answer it produces has to be
trustworthy, and the way to establish that is to feed the pipeline a series that provably
does predict and one that provably does not.
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


_TMP = tempfile.mkdtemp(prefix="rama-histnews-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import news as N            # noqa: E402
from engine import featureset, store, training   # noqa: E402


# ── Query construction ────────────────────────────────────────────────────────
print("\n--- GDELT queries are built the way GDELT demands ---")

q = N.gdelt_query_for("NIFTY50")
check("a known index has a curated query", '"nifty"' in q and "sourcecountry:IN" in q, q)
check("OR'd terms are PARENTHESISED — GDELT rejects them otherwise",
      all(("OR" not in v) or ("(" in v and ")" in v) for v in N.GDELT_QUERIES.values()),
      str([v for v in N.GDELT_QUERIES.values() if "OR" in v and "(" not in v]))
check("an unknown symbol gets a quoted fallback",
      N.gdelt_query_for("WOMBATCORP") == '"WOMBATCORP" sourcecountry:IN',
      N.gdelt_query_for("WOMBATCORP"))
check("the history floor is 2017, as verified against the live API",
      N.GDELT_FLOOR == _dt.date(2017, 1, 1), str(N.GDELT_FLOOR))
check("a per-request timeout is set, so a throttled endpoint cannot stall a run forever",
      N.GDELT_TIMEOUT_SECONDS <= 60, str(N.GDELT_TIMEOUT_SECONDS))
check("calls are paced", N.GDELT_PAUSE_SECONDS >= 3, str(N.GDELT_PAUSE_SECONDS))


# ── Point parsing ─────────────────────────────────────────────────────────────
print("\n--- GDELT's timeline shape parses to dated values ---")

pts = [
    {"date": "20180101T000000Z", "value": 0.1735},
    {"date": "20180102T000000Z", "value": -1.2},
    {"date": "20180103T000000Z", "value": 0},
    {"date": "20180104T000000Z"},                 # no value
    {"date": "bad"},                              # unusable date
    {"date": "20180105T000000Z", "value": "0.5"},  # numeric string
]
m = N._gdelt_points_to_map(pts)
check("valid points become ISO-dated floats", m.get("2018-01-01") == 0.1735, str(m))
check("negative tone survives", m.get("2018-01-02") == -1.2)
check("a genuine zero is KEPT, not dropped as falsy",
      "2018-01-03" in m and m["2018-01-03"] == 0.0, str(m.get("2018-01-03")))
check("a point with no value is skipped", "2018-01-04" not in m)
check("a malformed date is skipped", len(m) == 4, str(sorted(m)))
check("a numeric string is coerced", m.get("2018-01-05") == 0.5)
check("an empty list gives an empty map", N._gdelt_points_to_map([]) == {})
check("None is handled", N._gdelt_points_to_map(None) == {})


# ── The plain-text error trap ─────────────────────────────────────────────────
print("\n--- GDELT reports its errors as PLAIN TEXT on HTTP 200 ---")
#
# This is the trap worth a test: `Invalid query start date.` and `Queries containing OR'd
# terms must be surrounded by ()` arrive with status 200 and a text/plain body. Code that
# checks only the status code treats them as success and then throws at json.loads.

import httpx                                       # noqa: E402


class _FakeResp:
    def __init__(self, text):
        self.text = text
        self.status_code = 200


class _FakeClient:
    def __init__(self, body):
        self._body = body
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def get(self, *a, **k):
        if isinstance(self._body, Exception):
            raise self._body
        return _FakeResp(self._body)


_real_client = httpx.Client


def with_body(body):
    httpx.Client = lambda *a, **k: _FakeClient(body)


try:
    with_body("Invalid query start date.")
    pts, err = N.gdelt_timeline("q", "TimelineTone", _dt.date(2015, 1, 1), _dt.date(2015, 2, 1))
    check("a plain-text refusal is reported as an error, not parsed",
          pts == [] and err and "refused" in err, f"{pts} {err}")
    check("and the refusal text is carried so the cause is visible",
          "Invalid query start date" in err, err)

    with_body("Queries containing OR'd terms must be surrounded by ().")
    _, err2 = N.gdelt_timeline("a OR b", "TimelineTone", _dt.date(2020, 1, 1), _dt.date(2020, 2, 1))
    check("the OR-syntax refusal is also caught", err2 and "surrounded by" in err2, err2)

    good = json.dumps({"timeline": [{"data": [
        {"date": "20200101T000000Z", "value": -0.5},
        {"date": "20200102T000000Z", "value": 0.25}]}]})
    with_body(good)
    pts3, err3 = N.gdelt_timeline("q", "TimelineTone", _dt.date(2020, 1, 1), _dt.date(2020, 2, 1))
    check("a real payload parses", err3 is None and len(pts3) == 2, f"{err3} {pts3}")

    with_body(json.dumps({"timeline": []}))
    pts4, err4 = N.gdelt_timeline("q", "TimelineTone", _dt.date(2020, 1, 1), _dt.date(2020, 2, 1))
    check("an empty timeline is empty, not an error", pts4 == [] and err4 is None, f"{pts4} {err4}")
finally:
    httpx.Client = _real_client


# ── Backfill merge, and per-year persistence ──────────────────────────────────
print("\n--- the backfill persists per YEAR, not only at the end ---")


def fake_gdelt(days_by_year, tone=lambda d: -0.5, vol=lambda d: 0.01):
    """Patch `gdelt_timeline` to serve a synthetic series per year window."""
    def _fn(query, mode, start, end):
        out = []
        d = start
        while d <= end:
            if d.year in days_by_year:
                v = tone(d) if mode == "TimelineTone" else vol(d)
                out.append({"date": d.strftime("%Y%m%d") + "T000000Z", "value": v})
            d += _dt.timedelta(days=1)
        return out, None
    return _fn


_real_timeline = N.gdelt_timeline
_real_pause = N.GDELT_PAUSE_SECONDS
try:
    N.GDELT_PAUSE_SECONDS = 0.0
    N.gdelt_timeline = fake_gdelt({2024, 2025, 2026})
    merged, stats = N.backfill_history("HISTSYM", "NSE", years=3,
                                       until=_dt.date(2026, 6, 30), budget_seconds=60)
    check("years are fetched", len(stats["fetched"]) == 3, str(stats["fetched"]))
    check("tone points accumulate", stats["tonePoints"] > 700, str(stats["tonePoints"]))
    check("rows were stored", stats["rows"] > 700, str(stats["rows"]))
    check("newest-first ordering is reported",
          stats["fetched"][0]["year"] > stats["fetched"][-1]["year"], str(stats["fetched"]))
    check("the floor is reported for the caller", stats["floor"] == "2017-01-01")

    ser = N.load_series("HISTSYM", "NSE")
    check("the series has the gdelt columns", "gdelt_tone" in ser.columns)
    tone = pd.to_numeric(ser["gdelt_tone"], errors="coerce")
    check("tone is populated", tone.notna().sum() > 700, str(tone.notna().sum()))
    vol = pd.to_numeric(ser["gdelt_volume"], errors="coerce")
    check("volume is populated too", vol.notna().sum() > 700, str(vol.notna().sum()))
    check("dates are unique", ser["date"].nunique() == len(ser))

    # Re-running must converge, not re-fetch.
    _, stats2 = N.backfill_history("HISTSYM", "NSE", years=3,
                                   until=_dt.date(2026, 6, 30), budget_seconds=60)
    check("a second run skips covered years",
          len(stats2["skipped"]) >= 2, str(stats2["skipped"]))
    check("and fetches little or nothing new", stats2["tonePoints"] < stats["tonePoints"],
          f"{stats2['tonePoints']} vs {stats['tonePoints']}")
    ser2 = N.load_series("HISTSYM", "NSE")
    check("the row count did not balloon", len(ser2) == len(ser), f"{len(ser2)} vs {len(ser)}")

    print("\n--- a year before the floor is refused without a request ---")
    _, stats3 = N.backfill_history("OLDSYM", "NSE", years=12,
                                   until=_dt.date(2026, 6, 30), budget_seconds=60)
    pre = [s for s in stats3["skipped"] if "floor" in s.get("why", "")]
    check("pre-2017 years are skipped on the floor", len(pre) >= 2, str(stats3["skipped"]))

    print("\n--- RSS and GDELT columns coexist on the same day ---")
    rss_row = {c: None for c in N.NEWS_COLUMNS}
    rss_row.update({"date": "2026-06-01", "items": 12, "sources": 3, "sentiment": 0.4,
                    "sentiment_abs": 0.5, "positive": 7, "negative": 2, "neutral": 3,
                    "relevance_mean": 0.6, "dominant_event": "earnings",
                    "event_counts": "earnings=7", "top_headline": "A headline"})
    # `combine=True`, mirroring what `news.sync_today` does. Row-replacement is what erased
    # the GDELT tone in the first run of this test.
    store.merge("HISTSYM", pd.DataFrame([rss_row]), "NSE", N.NEWS_INTERVAL,
                source="rss", columns=N.NEWS_COLUMNS, combine=True)
    row = N.load_series("HISTSYM", "NSE")
    day = row[pd.to_datetime(row["date"]).dt.date == _dt.date(2026, 6, 1)]
    check("the day carries the RSS sentiment", float(day["sentiment"].iloc[0]) == 0.4,
          str(day["sentiment"].iloc[0]))
    check("...and did not lose its GDELT tone — the columns are disjoint",
          pd.notna(pd.to_numeric(day["gdelt_tone"], errors="coerce").iloc[0]),
          str(day["gdelt_tone"].iloc[0]))
finally:
    N.gdelt_timeline = _real_timeline
    N.GDELT_PAUSE_SECONDS = _real_pause


# ── The lag discipline ────────────────────────────────────────────────────────
print("\n--- tone is joined from BEFORE the bar, never the same day (Section 72) ---")

rows = []
for i in range(40):
    d = _dt.date(2026, 1, 5) + _dt.timedelta(days=i)
    r = {c: None for c in N.NEWS_COLUMNS}
    # A distinctive value per day, so which row was picked is unambiguous.
    r.update({"date": d.isoformat(), "gdelt_tone": float(i), "gdelt_volume": 0.01 * i})
    rows.append(r)
store.merge("LAGSYM", pd.DataFrame(rows), "NSE", N.NEWS_INTERVAL,
            source="gdelt", columns=N.NEWS_COLUMNS)

f = featureset.news_features("LAGSYM", "NSE", _dt.date(2026, 1, 20))
# 2026-01-20 is index 15; the strictly-prior row is index 14.
check("the tone used is the PREVIOUS day's, not the bar's own",
      f["gdelt_tone"] == 14.0, str(f["gdelt_tone"]))
check("availability is flagged", f["gdelt_available"] == 1.0)
check("the 5-day mean is over prior days only",
      abs(f["gdelt_tone_5d"] - np.mean([10, 11, 12, 13, 14])) < 1e-9, str(f["gdelt_tone_5d"]))
check("the delta is latest minus that mean",
      abs(f["gdelt_tone_delta"] - (14.0 - 12.0)) < 1e-9, str(f["gdelt_tone_delta"]))
check("volume follows the same rule",
      abs(f["gdelt_volume"] - 0.14) < 1e-9, str(f["gdelt_volume"]))

first = featureset.news_features("LAGSYM", "NSE", _dt.date(2026, 1, 5))
check("the very first stored day has NO prior tone, so it abstains",
      first["gdelt_available"] == 0.0 and first["gdelt_tone"] == 0.0, str(first))
before = featureset.news_features("LAGSYM", "NSE", _dt.date(2025, 12, 1))
check("a bar before the series starts gets nothing", before["gdelt_available"] == 0.0)
absent = featureset.news_features("NOSUCHSYM", "NSE", _dt.date(2026, 1, 20))
check("an unknown symbol yields the neutral block",
      absent["gdelt_available"] == 0.0 and set(absent) == set(featureset.NEWS_FEATURES))
check("every value is finite", all(np.isfinite(v) for v in f.values()))


# ── Feature contract ──────────────────────────────────────────────────────────
print("\n--- the news block extends the contract without moving anything ---")
base = featureset.feature_names(False, False)
withn = featureset.feature_names(False, True)
both = featureset.feature_names(True, True)
check("news columns are appended", withn[:len(base)] == base)
check("the gdelt columns are inside the news block",
      all(c in featureset.NEWS_FEATURES for c in
          ("gdelt_tone", "gdelt_tone_5d", "gdelt_tone_delta", "gdelt_volume",
           "gdelt_volume_5d", "gdelt_available")))
check("order is price -> derivatives -> news",
      both == base + featureset.DERIV_FEATURES + featureset.NEWS_FEATURES)
check("names stay unique", len(set(both)) == len(both))
check("every news feature has a neutral value",
      all(k in featureset.NEWS_NEUTRAL for k in featureset.NEWS_FEATURES))


# ── The measurement pipeline: does it detect signal, and reject noise? ─────────
print("\n--- THE POINT: the gate detects a real news signal and rejects a fake one ---")
#
# The live backfill has to run in a fresh window, so the answer to "does news predict?" is
# not available yet. What must be true NOW is that the pipeline would give a trustworthy
# answer. So: a tone series constructed to predict the next 5 bars must pass the gate, and a
# random tone series must fail it — with everything else held identical.

rng = np.random.default_rng(21)
NB = 2200
dates = pd.bdate_range("2017-01-02", periods=NB)


def build(tone_predicts: bool):
    """
    A price series plus a tone series that either drives it or does not.

    TONE IS AR(1), and that is what makes the test valid. The first attempt used i.i.d. tone
    with `steps[i]` depending on `tone[i-1]`, which fails: the label is
    `close[i+5] > close[i]`, so `tone[i-1]` only moved the label's BASE, not the forward
    return, and the feature genuinely could not predict it (measured AUC 0.425). Persistent
    tone makes `tone[i-1]` correlate with `tone[i..i+4]`, which drive `steps[i+1..i+5]` — so
    the lagged feature the join actually provides does carry information about the forward
    move. It is also the realistic shape: news sentiment is persistent, not white noise.
    """
    tone = np.empty(NB)
    tone[0] = rng.normal(0, 1.0)
    for i in range(1, NB):
        tone[i] = 0.9 * tone[i - 1] + rng.normal(0, 0.44)
    steps = np.empty(NB)
    for i in range(NB):
        drift = 0.0004
        if tone_predicts:
            drift += 0.0022 * np.tanh(tone[i])
        steps[i] = drift + rng.normal(0, 0.0030)
    close = 20000 * np.cumprod(1 + steps)
    bars = pd.DataFrame({
        "date": dates, "open": close, "high": close * 1.004,
        "low": close * 0.996, "close": close, "volume": 1e6,
    })
    news_rows = []
    for i, d in enumerate(dates):
        r = {c: None for c in N.NEWS_COLUMNS}
        r.update({"date": d.date().isoformat(),
                  "gdelt_tone": round(float(tone[i]), 5),
                  "gdelt_volume": round(float(abs(tone[i]) * 0.01), 6)})
        news_rows.append(r)
    return bars, pd.DataFrame(news_rows)


for name, predicts in (("SIGNALSYM", True), ("NOISESYM", False)):
    bars, nrows = build(predicts)
    store.merge(name, bars, "NSE", "1d", source="test")
    store.merge(name, nrows, "NSE", N.NEWS_INTERVAL, source="test", columns=N.NEWS_COLUMNS)

# stride 2, not 3: at stride 3 the holdout came to 129 rows and the gate correctly refused to
# offer a verdict at all (MIN_HOLDOUT_ROWS is 150). The gate was right; the test was too small.
rep_sig = training.train("SIGNALSYM", "NSE", "1d", horizon=5, include_news=True,
                         models=["random_forest"], n_splits=3, stride=2, dry_run=True)
rep_noise = training.train("NOISESYM", "NSE", "1d", horizon=5, include_news=True,
                           models=["random_forest"], n_splits=3, stride=2, dry_run=True)

check("training runs with news features enabled", rep_sig.get("ok"), str(rep_sig.get("reason")))
if rep_sig.get("ok"):
    print(f"  (feature count with news: {rep_sig['featureCount']}, "
          f"news coverage {rep_sig.get('newsCoverage')})")
    check("the news columns are actually in the vector",
          rep_sig["featureCount"] == len(featureset.feature_names(False, True)),
          str(rep_sig["featureCount"]))
    check("news coverage is reported and high", (rep_sig.get("newsCoverage") or 0) > 0.9,
          str(rep_sig.get("newsCoverage")))
    check("includeNews is recorded in the report", rep_sig["includeNews"] is True)

    s = rep_sig["models"]["random_forest"]["holdout"]
    g = rep_sig["models"]["random_forest"]
    print(f"  SIGNAL: AUC {s['auc']} BSS {s['brierSkillScore']} "
          f"foldAUC {g['foldMeanAuc']} accepted={g['accepted']}")
    check("a tone series that genuinely predicts PASSES the gate",
          g["accepted"] is True, str(g.get("reason")))
    check("its AUC is clearly above chance", s["auc"] > 0.6, str(s["auc"]))
    check("its Brier skill is positive", s["brierSkillScore"] > 0, str(s["brierSkillScore"]))

if rep_noise.get("ok"):
    sn = rep_noise["models"]["random_forest"]["holdout"]
    gn = rep_noise["models"]["random_forest"]
    print(f"  NOISE : AUC {sn['auc']} BSS {sn['brierSkillScore']} "
          f"foldAUC {gn['foldMeanAuc']} accepted={gn['accepted']}")
    check("a random tone series is REJECTED — the gate is not fooled by the extra columns",
          gn["accepted"] is False, str(sn))
    check("and the refusal names a condition", bool(gn.get("reason")), str(gn.get("reason")))
    check("both runs used the same feature width, so only the data differed",
          rep_noise["featureCount"] == rep_sig["featureCount"])

print("\n--- coverage reporting reflects the historical series ---")
cov = N.coverage("SIGNALSYM", "NSE")
check("coverage counts the backfilled days", cov["days"] > 2000, str(cov["days"]))
check("and now reports trainable", cov["trainable"] is True, str(cov))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
