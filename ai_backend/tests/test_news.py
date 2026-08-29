"""
test_news.py — the lexicon, event classification, and the noise generator that was voting.

The assertion that matters most is not about news at all: `SentimentModel` used to return
`0.5 + gaussian noise` on every prediction, so one of eight ensemble members was a random
number generator. It now abstains, and `ensemble_predict` omits it. Everything else here is
about not overstating what a headline lexicon can do.
"""

import datetime as _dt
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


_TMP = tempfile.mkdtemp(prefix="rama-news-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import news as N            # noqa: E402
from engine import featureset, store    # noqa: E402


# ── Lexicon ───────────────────────────────────────────────────────────────────
print("\n--- the lexicon reads finance, not general English ---")

up = N.score_text("Nifty surges to record high as banks rally")
dn = N.score_text("Sensex crashes as metals slump on growth concerns")
check("a clearly bullish headline scores positive", up["score"] > 0.5, str(up))
check("a clearly bearish headline scores negative", dn["score"] < -0.5, str(dn))
check("matched words are reported, so a reading can be checked by hand",
      "surges" in up["matched"] and "crashes" in dn["matched"], str(up["matched"]))

flat = N.score_text("Company announces annual general meeting date")
check("a headline with no polarity words scores exactly 0", flat["score"] == 0.0, str(flat))
check("and reports that nothing matched", flat["matched"] == [])

print("\n--- negation flips polarity (the thing word-counting gets wrong) ---")
beat = N.score_text("Infosys beats estimates")
miss = N.score_text("Infosys fails to beat estimates")
check("'beats estimates' is positive", beat["score"] > 0, str(beat["score"]))
check("'FAILS TO beat estimates' is negative, not positive",
      miss["score"] < 0, f"{miss['score']} matched={miss['matched']}")
check("the negation is counted and visible", miss["negated"] >= 1, str(miss["negated"]))
notp = N.score_text("Firm is not profitable this quarter")
check("'not profitable' is negative", notp["score"] < 0, str(notp["score"]))
check("a negator beyond the window does not reach back",
      N.score_text("not clear whether the long delayed order will finally surge")["score"] > 0)

print("\n--- intensity is graded, not binary ---")
check("'surges' is stronger than 'edges up'",
      N.score_text("Stock surges")["score"] >= N.score_text("Stock rises")["score"])
check("'crash' is stronger than 'slips'",
      abs(N.score_text("Index crashes")["score"]) >= abs(N.score_text("Index slips")["score"]))
check("a downgrade is negative even with no price word",
      N.score_text("Brokerage downgrades stock to underweight")["score"] < 0)
check("an upgrade is positive even with no price word",
      N.score_text("Brokerage upgrades stock to overweight")["score"] > 0)
check("a regulatory probe is negative", N.score_text("Sebi probe into the company")["score"] < 0)
check("a buyback is positive", N.score_text("Board approves share buyback")["score"] > 0)

print("\n--- the score is normalised by matched weight, not headline length ---")
short = N.score_text("Stock surges")
padded = N.score_text("In a development reported this morning by several outlets the "
                      "stock surges")
check("padding a headline with neutral words does not dilute the reading",
      abs(short["score"] - padded["score"]) < 1e-9,
      f"{short['score']} vs {padded['score']}")
check("scores stay inside [-1, 1]",
      all(-1.0 <= N.score_text(t)["score"] <= 1.0 for t in
          ("surges soars rallies jumps beats upgrade buyback wins",
           "crashes plunges slumps misses downgrade fraud probe default")))
check("empty text is handled", N.score_text("")["score"] == 0.0)
check("None is handled", N.score_text(None)["score"] == 0.0)
check("accents are normalised away", N.score_text("Índex surges")["score"] > 0)


# ── Events ────────────────────────────────────────────────────────────────────
print("\n--- event classification ---")
cases = {
    "Q2 results: profit rises 12% on higher revenue":        "earnings",
    "Brokerage downgrades stock, cuts price target":         "rating",
    "Sebi issues notice to the company over disclosures":    "regulatory",
    "Company acquires rival in all-cash deal":              "ma",
    "Board approves dividend of Rs 12 per share":            "capital",
    # `deal` rather than `ma`: a block deal is a share transaction, not a merger, and the
    # more specific reading is the right one.
    "Promoter sells stake via block deal":                   "deal",
    "RBI holds repo rate as inflation cools":                "macro",
    "CFO resigns with immediate effect":                     "management",
}
for text, want in cases.items():
    ev, evs = N.classify_event(text)
    check(f"'{text[:44]}...' -> {want}", ev == want, f"got {ev} (all {evs})")

ev, evs = N.classify_event("Nifty ends flat in choppy trade")
check("a headline with no event type returns None rather than a guess", ev is None, str(evs))
ev, evs = N.classify_event("Brokerage says buy; company also bags an order")
check("'buy' is read as a rating note, not an order win — the more specific reading wins",
      ev == "rating", f"{ev} {evs}")
check("but both types are still reported", "order_win" in evs, str(evs))


# ── Relevance ─────────────────────────────────────────────────────────────────
print("\n--- relevance weighting ---")
check("a headline naming the symbol is relevant",
      N.relevance("Reliance Industries share price rises", "RELIANCE") > 0.5)
check("an unrelated headline is not",
      N.relevance("Gold prices climb in Asia", "RELIANCE") == 0.0)
check("a longer alias match scores higher than a bare one",
      N.relevance("Reliance Industries gains", "RELIANCE") >
      N.relevance("Reliance gains", "RELIANCE"))
check("index aliases work", N.relevance("Nifty 50 closes higher", "NIFTY50") > 0.5)
check("aliases are case-insensitive", N.relevance("NIFTY 50 CLOSES HIGHER", "NIFTY50") > 0.5)
check("an unknown symbol falls back to its own name",
      N.relevance("WOMBATCORP rallies", "WOMBATCORP") > 0.5)


# ── Dedupe ────────────────────────────────────────────────────────────────────
print("\n--- the same wire story is not ten pieces of evidence ---")
items = [
    {"title": "Nifty ends higher, Sensex gains 300 points", "source": "a"},
    {"title": "Nifty ends higher, Sensex gains 300 points!", "source": "b"},
    {"title": "NIFTY ENDS HIGHER, SENSEX GAINS 300 POINTS", "source": "c"},
    {"title": "Nifty ends lower after choppy session", "source": "d"},
]
ded = N._dedupe(items)
check("punctuation and case variants collapse to one", len(ded) == 2, str(len(ded)))
check("a genuinely different headline survives",
      any("lower" in i["title"] for i in ded))
check("an empty title is dropped", len(N._dedupe([{"title": "", "source": "x"}])) == 0)


# ── Staleness ─────────────────────────────────────────────────────────────────
print("\n--- a feed that stopped publishing is caught (the Moneycontrol case) ---")
check("moneycontrol is not registered as a source",
      not any("moneycontrol" in s["name"] for s in N.registry()),
      str([s["name"] for s in N.registry()]))
check("the staleness threshold is declared", N.MAX_SOURCE_AGE_DAYS > 0)
check("every registered source is marked NOT backtestable",
      all(s["backtestable"] is False for s in N.registry()))
check("yahoo_ticker records that it is US-only",
      "US TICKERS ONLY" in [s for s in N.SOURCES if s["name"] == "yahoo_ticker"][0]["notes"])

os.environ["STOCKMIND_DISABLE_NEWS"] = "livemint"
check("a source can be disabled by environment",
      [s for s in N.registry() if s["name"] == "livemint"][0]["disabled"] is True)
check("the others stay available",
      [s for s in N.registry() if s["name"] == "economic_times"][0]["available"] is True)
os.environ.pop("STOCKMIND_DISABLE_NEWS", None)


# ── Aggregation ───────────────────────────────────────────────────────────────
print("\n--- daily aggregation is relevance-weighted ---")
mixed = [
    {"title": "Reliance Industries surges on strong results", "sentiment": 0.9,
     "relevance": 0.7, "events": ["earnings"], "source": "a", "publisher": "P1"},
    {"title": "Markets slip in choppy trade", "sentiment": -0.8,
     "relevance": 0.0, "events": [], "source": "b", "publisher": "P2"},
]
agg = N.aggregate(mixed, "RELIANCE")
check("the relevant headline dominates the reading", agg["sentiment"] > 0.2, str(agg["sentiment"]))
check("a general headline still counts, just less",
      agg["sentiment"] < 0.9, str(agg["sentiment"]))
check("positive and negative are counted", agg["positive"] == 1 and agg["negative"] == 1)
check("distinct sources are counted", agg["sources"] == 2)
check("the dominant event is reported", agg["dominantEvent"] == "earnings")
check("the top headline is the most relevant one",
      "Reliance" in agg["topHeadline"], agg["topHeadline"])
check("it says it is not a forecast", "not a forecast" in agg["note"].lower())
check("no items gives no sentiment rather than 0",
      N.aggregate([], "X")["sentiment"] is None)


# ── The noise generator ───────────────────────────────────────────────────────
print("\n--- the sentiment member abstains instead of voting noise (Section 70) ---")
from engine.models import SentimentModel     # noqa: E402
from engine.registry import MODEL_REGISTRY   # noqa: E402

sm = SentimentModel()
check("with no text it returns None, not a number", sm.predict_proba("") is None)
check("with whitespace only it returns None", sm.predict_proba("   ") is None)
check("from features it returns None — there is no sentiment in a price vector",
      sm.predict_proba_from_features(np.arange(100, dtype=float)) is None)
check("a headline with no polarity words also abstains",
      sm.predict_proba("Company announces AGM date") is None)

bull = sm.predict_proba("Stock surges to record high after upgrade")
bear = sm.predict_proba("Stock crashes as regulator opens fraud probe")
check("a bullish headline gives a probability above 0.5", bull is not None and bull > 0.5,
      str(bull))
check("a bearish headline gives one below 0.5", bear is not None and bear < 0.5, str(bear))
check("the mapping is deliberately narrow — a headline is weak evidence",
      bull <= 0.85 and bear >= 0.15, f"{bull} {bear}")
check("it reports that it is a lexicon, not a model",
      sm.is_lexicon() is True or sm.pipeline is not None)

# Determinism is the real proof the noise is gone.
reps = [sm.predict_proba("Stock surges to record high after upgrade") for _ in range(8)]
check("the same headline gives the SAME number every time — the noise is gone",
      len(set(reps)) == 1, str(set(reps)))

print("\n--- and the ensemble omits it rather than counting a neutral vote ---")
feats = np.random.default_rng(4).normal(0, 1, 100).astype(np.float32)
res_nonews = MODEL_REGISTRY.ensemble_predict(feats)
check("with no news, 'sentiment' is absent from model_probs",
      "sentiment" not in res_nonews["model_probs"], str(list(res_nonews["model_probs"])))
check("the other members still voted", len(res_nonews["model_probs"]) >= 5,
      str(len(res_nonews["model_probs"])))
check("a probability is still produced", 0.0 < res_nonews["probability"] < 1.0)

res_news = MODEL_REGISTRY.ensemble_predict(
    feats, news_text="Stock surges to record high after a broker upgrade")
check("with news, 'sentiment' IS present", "sentiment" in res_news["model_probs"],
      str(list(res_news["model_probs"])))
check("it voted bullish", res_news["model_probs"]["sentiment"] > 0.5,
      str(res_news["model_probs"].get("sentiment")))
check("so the member count grows by exactly one",
      len(res_news["model_probs"]) == len(res_nonews["model_probs"]) + 1,
      f"{len(res_news['model_probs'])} vs {len(res_nonews['model_probs'])}")

# THE POSITIONAL HAZARD. Omitting a member is only safe because sentiment is the LAST slot,
# so a shorter value list still lines up with weights[:len(values)]. Sections 68 and 69 were
# both about positional misalignment, so this is asserted rather than assumed.
names = [m.name for m in MODEL_REGISTRY._base_models] + ["sentiment"]
check("sentiment is the LAST meta-learner slot, which is what makes omitting it safe",
      names[-1] == "sentiment", str(names))
check("the meta-learner has exactly one slot per member",
      MODEL_REGISTRY._meta.n == len(names), f"{MODEL_REGISTRY._meta.n} vs {len(names)}")
check("meta_weights is keyed by those same names in order",
      list(MODEL_REGISTRY.meta_weights().keys()) == names)


# ── Feature block ─────────────────────────────────────────────────────────────
print("\n--- news features: constant width, neutral fill, availability flag ---")
absent = featureset.news_features("NOSUCHSYM", "NSE", "2026-01-01")
check("the block is always the full width", set(absent) == set(featureset.NEWS_FEATURES))
check("absent news is flagged, not silently neutral", absent["news_available"] == 0.0)
check("absent sentiment is 0.0", absent["news_sentiment"] == 0.0)
check("every value is finite — sklearn rejects NaN",
      all(np.isfinite(v) for v in absent.values()))

rows = []
for day in range(1, 9):
    rows.append({
        "date": f"2026-05-{day:02d}", "items": 20, "sources": 3,
        "sentiment": 0.4, "sentiment_abs": 0.5, "positive": 12, "negative": 4,
        "neutral": 4, "relevance_mean": 0.6, "dominant_event": "earnings",
        "event_counts": "earnings=12", "top_headline": "Something happened",
    })
store.merge("NEWSSYM", pd.DataFrame(rows), "NSE", N.NEWS_INTERVAL,
            source="test", columns=N.NEWS_COLUMNS)

have = featureset.news_features("NEWSSYM", "NSE", "2026-05-05")
check("stored news is joined", have["news_available"] == 1.0)
check("sentiment comes through", abs(have["news_sentiment"] - 0.4) < 1e-9)
check("item count is normalised, not raw",
      abs(have["news_items_norm"] - 0.5) < 1e-9, str(have["news_items_norm"]))
check("positive ratio is a ratio", abs(have["news_pos_ratio"] - 0.6) < 1e-9)
check("negative ratio is a ratio", abs(have["news_neg_ratio"] - 0.2) < 1e-9)

before = featureset.news_features("NEWSSYM", "NSE", "2026-04-01")
check("a bar before every stored row gets nothing — no lookahead",
      before["news_available"] == 0.0, str(before["news_available"]))
after = featureset.news_features("NEWSSYM", "NSE", "2026-05-20")
check("a later bar carries the most recent prior row forward",
      after["news_available"] == 1.0)


# ── Featureset contract ───────────────────────────────────────────────────────
print("\n--- news columns extend the contract without moving anything ---")
base = featureset.feature_names(include_derivatives=False, include_news=False)
withd = featureset.feature_names(include_derivatives=True, include_news=False)
withn = featureset.feature_names(include_derivatives=False, include_news=True)
both = featureset.feature_names(include_derivatives=True, include_news=True)

check("the base set is unchanged at 100", len(base) == 100, str(len(base)))
check("news columns are APPENDED", withn[:len(base)] == base)
check("the news block is the declared list", withn[len(base):] == featureset.NEWS_FEATURES)
check("with both, the order is price -> derivatives -> news",
      both == base + featureset.DERIV_FEATURES + featureset.NEWS_FEATURES)
check("enabling news cannot move a derivative column",
      both[:len(withd)] == withd)
check("all names are unique with both blocks on", len(set(both)) == len(both))

featureset.save_manifest(withn, include_derivatives=False, include_news=True)
m = featureset.load_manifest()
check("the manifest records includeNews", m["includeNews"] is True)
check("and inference reads it", featureset.include_news_default() is True)
from engine.models import artifact_alignment     # noqa: E402
check("alignment passes against the news-enabled builder", artifact_alignment()[0] is True,
      str(artifact_alignment()))

featureset.save_manifest(base, include_derivatives=False, include_news=False)
check("turning news off in the manifest turns it off for inference",
      featureset.include_news_default() is False)
ok, why = featureset.validate_against_live(withn, False, False)
check("a manifest claiming news columns against a no-news build is caught",
      ok is False and "count changed" in why, why)
os.remove(featureset.manifest_path())

fmap = featureset.build_feature_map(
    pd.DataFrame({"date": pd.date_range("2026-05-01", periods=300, freq="B"),
                  "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0,
                  "volume": 1e6}),
    "NEWSSYM", "NSE", include_derivatives=False, include_news=True)
check("build_feature_map produces exactly the declared names in order",
      list(fmap.keys()) == withn, str(len(fmap)))
check("and every value is finite", all(np.isfinite(v) for v in fmap.values()))


# ── Coverage ──────────────────────────────────────────────────────────────────
print("\n--- coverage says plainly how far off a trainable feature is ---")
cov = N.coverage("NEWSSYM", "NSE")
check("days collected are reported", cov["days"] == 8, str(cov["days"]))
check("8 days is NOT trainable, and says so", cov["trainable"] is False)
check("the note gives the number needed", "800" in cov["note"], cov["note"])
empty = N.coverage("NOTHINGSYM", "NSE")
check("an uncollected symbol reports 0 days", empty["days"] == 0)
check("and tells the caller what to do", "sync" in empty["note"].lower(), empty["note"])


# ── Persistence ───────────────────────────────────────────────────────────────
print("\n--- items are bucketed by their own publication date ---")
check("the news column set is declared", "sentiment" in N.NEWS_COLUMNS)
check("the interval key does not collide with bars or derivatives",
      N.NEWS_INTERVAL not in ("1d", "deriv1d"))
back = N.load_series("NEWSSYM", "NSE")
check("the series round-trips", back is not None and len(back) == 8)
check("with the declared columns", list(back.columns) == N.NEWS_COLUMNS)
check("text columns survive", str(back["dominant_event"].iloc[0]) == "earnings")


# ── LIVE ──────────────────────────────────────────────────────────────────────
print("\n--- LIVE: the feeds in Section 70 ---")
if os.environ.get("STOCKMIND_SKIP_LIVE"):
    print("  SKIPPED (STOCKMIND_SKIP_LIVE set)")
else:
    g = N.fetch_feed(N._google_news("NIFTY 50 stock market India"), "google_news")
    check("Google News RSS answers", g["ok"] is True, str(g["error"]))
    if g["ok"]:
        print(f"  ({len(g['items'])} items, newest {g['newestAgeDays']}d old)")
        check("it returns many items", len(g["items"]) > 20, str(len(g["items"])))
        check("it is not stale", g["stale"] is False, str(g["newestAgeDays"]))
        check("items carry titles", all(i["title"] for i in g["items"][:10]))
        check("items carry publication dates",
              sum(1 for i in g["items"] if i["published"]) > 10)
        check("items carry a publisher name",
              len({i["publisher"] for i in g["items"]}) > 3,
              str(len({i["publisher"] for i in g["items"]})))
        parsed = [i for i in g["items"] if i["published"]]
        check("dates parse to real timestamps",
              all(pd.Timestamp(i["published"]).year >= 2020 for i in parsed[:10]))

    et = N.fetch_feed(
        "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
        "economic_times")
    check("Economic Times answers", et["ok"] is True, str(et["error"]))
    if et["ok"]:
        print(f"  (ET {len(et['items'])} items, newest {et['newestAgeDays']}d)")
        check("and is fresh", et["stale"] is False, str(et["newestAgeDays"]))

    # The verified-stale source, asserted rather than assumed.
    mc = N.fetch_feed("https://www.moneycontrol.com/rss/business.xml", "moneycontrol")
    if mc["ok"]:
        print(f"  (moneycontrol newest {mc['newestAgeDays']}d old)")
        check("moneycontrol IS detected as stale — 200 with valid XML is not freshness",
              mc["stale"] is True, str(mc["newestAgeDays"]))
        check("and the reason explains the trap", "still answers 200" in (mc["error"] or ""),
              str(mc["error"]))

    yh = N.fetch_feed(
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=RELIANCE.NS&region=IN&lang=en-IN",
        "yahoo_ticker")
    check("Yahoo per-ticker answers for an Indian symbol but with ZERO items",
          yh["ok"] is True and len(yh["items"]) == 0,
          f"ok={yh['ok']} items={len(yh['items'])}")

    bad = N.fetch_feed("https://www.nseindia.com/", "not_a_feed")
    check("a non-feed URL is reported, not crashed",
          bad["ok"] is False and bad["error"], str(bad["error"]))

    print("\n--- LIVE: headlines for a symbol ---")
    h = N.headlines("NIFTY50", limit=25)
    check("headlines are returned", len(h["items"]) > 5, str(len(h["items"])))
    check("it is labelled NOT backtestable", h["backtestable"] is False)
    check("it says it is a lexicon, not a language model",
          "lexicon" in h["note"].lower(), h["note"])
    check("per-source status is reported", len(h["sources"]) >= 4, str(list(h["sources"])))
    if h["items"]:
        agg = h["aggregate"]
        print(f"  (items={agg['items']} sentiment={agg['sentiment']} "
              f"pos={agg['positive']} neg={agg['negative']} "
              f"event={agg['dominantEvent']} sources={agg['sources']})")
        print(f"  top: {agg['topHeadline'][:90]}")
        check("the aggregate reports a sentiment in range",
              -1.0 <= agg["sentiment"] <= 1.0, str(agg["sentiment"]))
        check("every item is scored", all("sentiment" in i for i in h["items"]))
        check("every item has a relevance", all("relevance" in i for i in h["items"]))
        check("items are sorted by relevance first",
              h["items"][0]["relevance"] >= h["items"][-1]["relevance"])
        check("no duplicate titles survived",
              len({i["title"] for i in h["items"]}) == len(h["items"]))
        check("at least one item was classified with an event type",
              any(i["event"] for i in h["items"]))

    print("\n--- LIVE: sync accumulates a series ---")
    _, info = N.sync_today("NIFTY50", "NSE", limit=60)
    print(f"  recorded={info['recorded']} rows={info.get('rows')} "
          f"span={info.get('firstDate')}..{info.get('lastDate')}")
    check("today's reading is recorded", info["recorded"] > 0, str(info))
    check("it says news cannot be backfilled", "backfill" in info["note"].lower(), info["note"])
    ser = N.load_series("NIFTY50", "NSE")
    check("the series exists", ser is not None and len(ser) > 0)
    if ser is not None and len(ser):
        check("dates are unique", ser["date"].nunique() == len(ser))
        check("dates are sorted", list(ser["date"]) == sorted(ser["date"]))
        sent = pd.to_numeric(ser["sentiment"], errors="coerce").dropna()
        check("every stored sentiment is in range",
              len(sent) and ((sent >= -1) & (sent <= 1)).all(), str(sent.tolist()[:5]))
        cov2 = N.coverage("NIFTY50", "NSE")
        print(f"  (coverage {cov2['days']} days, trainable={cov2['trainable']})")
        check("coverage confirms this is nowhere near trainable yet",
              cov2["trainable"] is False, str(cov2))

    # Re-running must converge rather than duplicate.
    _, info2 = N.sync_today("NIFTY50", "NSE", limit=60)
    ser2 = N.load_series("NIFTY50", "NSE")
    check("re-syncing does not duplicate days",
          ser2["date"].nunique() == len(ser2), str(len(ser2)))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
