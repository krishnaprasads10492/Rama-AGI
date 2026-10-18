"""
test_strategy_factory.py - does Rama's strategy book find edges and refuse noise? (spec Section 151)

The thing a strategy GENERATOR can do wrong is find winners in noise: score enough candidates and the best looks
excellent by construction. So the tests that matter run the factory on series whose truth it cannot see:

    pure noise          nothing may be DEMONSTRATED, however many runs
    a planted edge      the template that carries it must be found, ranked and demonstrated
    an edge that stops  a forward test on the frozen strategy must reach `decaying` and PROPOSE retirement,
                        never retire it
    the leak            walk-forward must choose parameters from trades closed BEFORE the cut

Stdlib only; the series are `synthetic_bars`. Run:  python -m tests.test_strategy_factory   (from ai_backend/)
"""

from __future__ import annotations

import copy
import json
import os
import pathlib
import shutil
import sys
import tempfile

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "engine"))
sys.path.insert(0, str(_HERE))
import strategy_eval as SE         # noqa: E402
import strategy_spec as SS         # noqa: E402
import strategy_factory as F       # noqa: E402
import strategy_book as B          # noqa: E402
import synthetic_bars as SB        # noqa: E402

COST = SE.CostModel(commission_pct=0.10, slippage_pct=0.05, spread_pct=0.02)

_pass = 0
_fail = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {label}")
    else:
        _fail += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


def evolve(bars, **kw):
    c = F.candidate_specs(symbol="TEST", interval="1d", capital=200000, risk_pct=1.0, **kw)
    return F.evolve(bars, c["specs"], COST), c


def row_of(r, tid):
    for k in ("ranked", "insufficient", "unvalidated", "excluded"):
        for x in r[k]:
            if x["id"] == tid:
                return k, x
    return None, None


print("\nstrategy_factory - generating, judging, storing\n")

# ═══ candidates ═══════════════════════════════════════════════════════════════════════════════════
print("--- candidates: the library, completed, with nothing dropped silently ---")
c = F.candidate_specs(symbol="TEST", interval="1d")
check("all nine published templates are candidates", len(c["specs"]) == 9 and c["refused"] == [], str(c["refused"]))
check("each carries a validated, sweep-bearing spec", all(x["spec"]["symbol"] == "TEST" for x in c["specs"]))
check("side=long keeps only long templates",
      all(x["spec"]["side"] == "long" for x in F.candidate_specs(symbol="T", side="long")["specs"]))
check("side=short keeps only the short one",
      [x["template"] for x in F.candidate_specs(symbol="T", side="short")["specs"]] == ["livermore_short"])
check("a horizon filter is a filter, not a refusal",
      all(x["template"] in ("dow_primary_trend", "tsmom_12m")
          for x in F.candidate_specs(symbol="T", horizon="long")["specs"]))
check("an unknown template is REFUSED with a reason, not dropped",
      F.candidate_specs(symbol="T", templates=["nope"])["refused"][0]["reason"] == "not a template in the library")
opt = F.candidate_specs(symbol="T", instrument="options", interval="1d")
check("options cannot be backtested: every candidate is refused WITH the reason",
      opt["specs"] == [] and len(opt["refused"]) == 9 and all("premium" in r["reason"] for r in opt["refused"]))
check("a bad explore value is refused", F.candidate_specs(symbol="T", explore="everything")["ok"] is False)
check("a bad side is refused", F.candidate_specs(symbol="T", side="sideways")["ok"] is False)
wide = F.candidate_specs(symbol="T", explore="wider")
check("explore=wider multiplies the exits by the declared grid: 3x the specs", len(wide["specs"]) == 27)
base_exit = F.candidate_specs(symbol="T")["specs"][0]["spec"]["exit"]
scales = sorted({s["spec"]["exit"]["stopPct"] for s in wide["specs"] if s["template"] == "livermore_breakout"})
check("and the exits are scaled, not replaced", scales == sorted(round(base_exit["stopPct"] * k, 4) for k in F.EXIT_GRID), str(scales))
check("explore=library records no exit scaling", all(x["exitScale"] is None for x in c["specs"]))

# ═══ the verdict class ════════════════════════════════════════════════════════════════════════════
print("\n--- what a row may be CALLED ---")
dem = {"measurement": {"demonstrated": True}, "exceedsSelectionNoise": True}
check("demonstrated + beats selection noise = demonstrated", F.verdict_class(dem, "ranked") == F.DEMONSTRATED)
check("demonstrated but NOT above selection noise = unproven (the second guard)",
      F.verdict_class({"measurement": {"demonstrated": True}, "exceedsSelectionNoise": False}, "ranked") == F.UNPROVEN)
check("selection noise unknown (None) does not block a demonstrated row",
      F.verdict_class({"measurement": {"demonstrated": True}, "exceedsSelectionNoise": None}, "ranked") == F.DEMONSTRATED)
check("profitable but not demonstrated = unproven",
      F.verdict_class({"measurement": {"demonstrated": False}, "exceedsSelectionNoise": True}, "ranked") == F.UNPROVEN)
for b in ("insufficient", "unvalidated", "excluded"):
    check(f"a row in `{b}` is refused", F.verdict_class(dem, b) == F.REFUSED)

# ═══ pure noise ═══════════════════════════════════════════════════════════════════════════════════
print("\n--- PURE NOISE: nothing may be demonstrated (the acceptance test, Section 151.7) ---")
RUNS = 12
demo, unproven_runs, ranked_rows, total_rows = 0, 0, 0, 0
for seed in range(1, RUNS + 1):
    r, _ = evolve(SB.noise_series(4000, seed=seed))
    demo += r["counts"][F.DEMONSTRATED]
    unproven_runs += 1 if r["counts"][F.UNPROVEN] else 0
    ranked_rows += len(r["ranked"])
    total_rows += sum(len(r[k]) for k in ("ranked", "insufficient", "unvalidated", "excluded"))
check(f"across {RUNS} noise series ({total_rows} template-runs) NOTHING is demonstrated", demo == 0, f"{demo} demonstrated")
print(f"        (for the record: {ranked_rows} rows were profitable after costs by luck, in {unproven_runs} of {RUNS} runs - "
      f"which is why a ranked row is labelled `unproven` until it clears both guards)")
r1, _ = evolve(SB.noise_series(4000, seed=3))
check("every row of a noise run carries a verdictClass",
      all("verdictClass" in x for k in ("ranked", "insufficient", "unvalidated", "excluded") for x in r1[k]))
check("the counts add up to every template run",
      sum(r1["counts"].values()) == sum(len(r1[k]) for k in ("ranked", "insufficient", "unvalidated", "excluded")))
check("a row is in exactly one list", len({x["id"] for k in ("ranked", "insufficient", "unvalidated", "excluded") for x in r1[k]})
      == sum(len(r1[k]) for k in ("ranked", "insufficient", "unvalidated", "excluded")))

# ═══ a planted edge ═══════════════════════════════════════════════════════════════════════════════
print("\n--- a PLANTED edge: the template that carries it must be found ---")
trend = SB.trend_series(5000, seed=1)
rt, _ = evolve(trend)
k, lb = row_of(rt, "livermore_breakout")
check("livermore_breakout is RANKED on a trending series", k == "ranked", str(k))
check("and is DEMONSTRATED", lb and lb["verdictClass"] == F.DEMONSTRATED, str(lb and lb.get("verdictClass")))
check("with a real sample, not a handful of trades", lb and lb["measurement"]["trades"] >= SE.MIN_TRADES, str(lb and lb["measurement"]["trades"]))
check("positive after costs", lb and lb["measurement"]["expectancyPct"] > 0)
check("positive in most folds (stable, not one lucky stretch)", lb and lb["foldsPositive"] >= lb["foldsScored"] - 1,
      f"{lb and lb['foldsPositive']}/{lb and lb['foldsScored']}")
check("the CLAIM and the MEASUREMENT are separate fields", lb and lb["claim"]["text"] and lb["measurement"] and lb["claim"] is not lb["measurement"])
check("the claim names its source and says it is published, not measured",
      lb and lb["claim"]["evidence"] == "published" and "Lefevre" in lb["claim"]["source"])
check("the stored spec is ONE frozen variant (no sweep)", lb and lb["stored"]["sweep"] == {})
check("the trial count is the variants the template tried", lb and lb["variantsTried"] == 2)
check("and the out-of-sample verdict is deflated by THAT many trials, not one",
      lb and lb["measurement"]["nTrials"] == lb["variantsTried"], str(lb and lb["measurement"]["nTrials"]))
check("the in-sample and out-of-sample hit rates are both reported", lb and lb["inSampleHitRate"] is not None and lb["hitRateGapPoints"] is not None)
check("the ranking is by out-of-sample hit rate, highest first",
      [x["hitRate"] for x in rt["ranked"]] == sorted([x["hitRate"] for x in rt["ranked"]], reverse=True))
check("a template that did not carry the edge is not demonstrated",
      all(x["verdictClass"] != F.DEMONSTRATED for x in rt["ranked"] if x["id"] in ("bollinger_reversion", "wilder_pullback_in_trend")))
check("familyTrials counts EVERY variant tried across all templates", rt["familyTrials"] == 21, str(rt["familyTrials"]))

print("\n--- a single-variant template is not 'tuned' and says so ---")
k, dow = row_of(rt, "dow_primary_trend")
check("dow_primary_trend has one variant: tuned=False", dow and dow["tuned"] is False)
check("its trial count is 1 (the author's rule, specified in advance)", dow and dow["variantsTried"] == 1)
check("and its in-sample record is absent rather than invented", dow and dow["inSample"] is None)

print("\n--- when a template cannot be judged, say how much history it would take ---")
short = SB.trend_series(1500, seed=1)
rs, _ = evolve(short)
k, tm = row_of(rs, "tsmom_12m")
check("on ~6 years a slow template is insufficient, not silently absent", k == "insufficient", str(k))
check("and carries the history it would need", tm and tm["needs"]["barsNeeded"] and tm["needs"]["barsNeeded"] > tm["needs"]["barsHave"],
      str(tm and tm["needs"]))
check("insufficient rows are never given a verdict class above refused", all(x["verdictClass"] == F.REFUSED for x in rs["insufficient"]))
check("the floor was not lowered: nothing with fewer than MIN_TRADES is ranked",
      all(x["measurement"]["trades"] >= SE.MIN_TRADES for x in rs["ranked"]))

# ═══ the walk-forward leak ════════════════════════════════════════════════════════════════════════
print("\n--- walk-forward chooses from the PAST only ---")
tr = [{"entryIndex": 10, "exitIndex": 20}, {"entryIndex": 30, "exitIndex": 55}, {"entryIndex": 60, "exitIndex": 70}]
check("_closed_before keeps only trades closed strictly before the cut",
      [t["entryIndex"] for t in F._closed_before(tr, 56)] == [10, 30])
check("a trade open across the cut is NOT known at the cut", [t["entryIndex"] for t in F._closed_before(tr, 50)] == [10])
check("_window_trades selects by the bar a trade was OPENED on",
      [t["entryIndex"] for t in F._window_trades(tr, 30, 60)] == [30])

variants = SS.expand_sweep(F.candidate_specs(symbol="TEST", templates=["livermore_breakout"])["specs"][0]["spec"])
wf = F.walk_forward(variants, trend, COST, folds=5, label_horizon=60)
first_test = min(f["testFrom"] for f in wf["folds"]) if wf["folds"] else None
check("walk-forward ran and scored folds", wf["ok"] and len(wf["folds"]) >= 3, str(wf["scheduled"]))
check("no pooled trade was opened before the first test window began",
      all(t["entryDate"] >= first_test for t in wf["trades"]), str(first_test))
check("every fold records whether its choice was made on the past or fell back to the stated default",
      all(f["choice"] in ("chosen on the past", "stated default") for f in wf["folds"]))
check("pooled returns equal the pooled trades' returns", len(wf["pooledGross"]) == len(wf["trades"]))

print("\n--- costs and determinism ---")
cheap = SE.CostModel(0.0, 0.0, 0.0)
c0 = F.candidate_specs(symbol="TEST", templates=["livermore_breakout"])
e_cheap = F.evolve(trend, c0["specs"], cheap)
e_dear = F.evolve(trend, c0["specs"], SE.CostModel(0.30, 0.15, 0.10))
def exp_of(res):
    k, x = row_of(res, "livermore_breakout")
    return (x.get("measurement") or x.get("outOfSample") or {}).get("expectancyPct") if k == "ranked" else None
check("higher costs lower the out-of-sample expectancy", (exp_of(e_cheap) or 0) > (exp_of(e_dear) or -1e9),
      f"{exp_of(e_cheap)} vs {exp_of(e_dear)}")
a, _ = evolve(trend)
b, _ = evolve(trend)
check("the same input gives the same output", json.dumps(a["ranked"], sort_keys=True, default=str) == json.dumps(b["ranked"], sort_keys=True, default=str))

print("\n--- hostile input ---")
check("too few bars is refused with the number it needs", F.evolve(trend[:100], c0["specs"], COST)["ok"] is False)
check("no entries is not an error and ranks nothing", F.evolve(trend, [], COST)["ranked"] == [])
flat = [{"date": f"2020-01-{(i % 28) + 1:02d}", "open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 1.0} for i in range(400)]
rf, _ = evolve(flat)
check("a perfectly flat series (zero variance) does not crash and ranks nothing", rf["ranked"] == [])
nov = [dict(b, volume=0.0) for b in SB.noise_series(1200, seed=2)]
check("zero volume does not crash (indices often report none)", evolve(nov)[0] is not None)

# ═══ the book ═════════════════════════════════════════════════════════════════════════════════════
print("\nstrategy_book - storing, updating, utilising\n")
ROOT = tempfile.mkdtemp(prefix="rama-book-")
try:
    last_bar = trend[-1]["date"]
    print("--- store ---")
    st = B.upsert_from_evolution(ROOT, lb, symbol="TEST", exchange="NSE", interval="1d", bars=len(trend), last_bar=last_bar)
    check("a ranked candidate is stored", st["ok"] and st["action"] == "stored", str(st))
    sid = st["id"]
    e = B.get(ROOT, sid)
    check("its id is the hash of the FROZEN spec", sid == SS.spec_hash(B._frozen(lb["stored"])))
    check("the stored spec has no sweep", e["spec"]["sweep"] == {})
    check("the CLAIM is kept apart from the BASELINE", e["claim"]["text"] and e["baseline"]["outOfSample"] and e["claim"] is not e["baseline"])
    check("the baseline carries the verdict class it was stored with", e["baseline"]["verdictClass"] == lb["verdictClass"])
    check("`current` (the updated column) is empty until a refresh", e["current"] is None)
    check("it starts on `watch`: nothing forward has happened", e["status"] == B.WATCH)
    check("it records the bar it was stored on", e["storedOnBar"] == last_bar)
    check("no temp file is left behind (atomic write)", not any(f.endswith(".tmp") for f in os.listdir(os.path.join(ROOT, "_strategies"))))

    again = B.upsert_from_evolution(ROOT, lb, symbol="TEST", exchange="NSE", interval="1d", bars=len(trend), last_bar=last_bar)
    check("re-storing the same frozen strategy UPDATES it", again["action"] == "updated" and len(B.list_all(ROOT)) == 1)
    check("the claim is untouched by the update", B.get(ROOT, sid)["claim"] == e["claim"])
    check("the history records both events", [h["kind"] for h in B.get(ROOT, sid)["history"]] == ["stored", "re-evolved"])
    changed = copy.deepcopy(lb)
    changed["stored"]["exit"]["stopPct"] = 7.5
    other = B.upsert_from_evolution(ROOT, changed, symbol="TEST", exchange="NSE", interval="1d", bars=len(trend), last_bar=last_bar)
    check("a CHANGED parameter is a NEW strategy, and the old one is untouched",
          other["action"] == "stored" and other["id"] != sid and len(B.list_all(ROOT)) == 2
          and B.get(ROOT, sid)["spec"]["exit"]["stopPct"] == lb["stored"]["exit"]["stopPct"])
    refused_row = next(iter(rs["insufficient"]))
    check("a REFUSED row cannot be stored", B.upsert_from_evolution(ROOT, refused_row, symbol="T", exchange="NSE", interval="1d", bars=1, last_bar="x")["ok"] is False)
    check("nor a row with no parameters", B.upsert_from_evolution(ROOT, dict(lb, stored=None), symbol="T", exchange="NSE", interval="1d", bars=1, last_bar="x")["ok"] is False)

    print("\n--- a corrupt book is reported, never overwritten ---")
    p = os.path.join(ROOT, "_strategies", "book.json")
    good_bytes = open(p, "rb").read()
    open(p, "w").write("{ this is not json")
    raised = False
    try:
        B.load(ROOT)
    except B.BookCorrupt:
        raised = True
    check("loading a corrupt book raises BookCorrupt instead of returning an empty one", raised)
    raised = False
    try:
        B.upsert_from_evolution(ROOT, lb, symbol="TEST", exchange="NSE", interval="1d", bars=1, last_bar="x")
    except B.BookCorrupt:
        raised = True
    check("so a save cannot overwrite master's strategies with nothing", raised and open(p).read() == "{ this is not json")
    open(p, "wb").write(good_bytes)
    open(p, "w").write(json.dumps({"schema": 99, "strategies": []}))
    try:
        B.load(ROOT); newer = False
    except B.BookCorrupt:
        newer = True
    check("a book written by a NEWER version is refused, not downgraded", newer)
    open(p, "wb").write(good_bytes)

    # ── the forward test ─────────────────────────────────────────────────────────────────────────
    print("\n--- update: the forward test is genuinely out of sample ---")
    # Store the strategy at an EARLY bar of a long trend series, then test it on everything after.
    long_trend = SB.trend_series(8000, seed=2)
    early = 3000
    seed_run, _ = evolve(long_trend[:early])
    k2, early_row = row_of(seed_run, "livermore_breakout")
    spec_early = (early_row or lb)["stored"]
    entry = {"id": "x", "template": "livermore_breakout", "spec": B._frozen(spec_early), "storedOnBar": long_trend[early - 1]["date"]}
    fwd = B.forward_test(entry, long_trend, COST)
    first_fwd = B._index_after(long_trend, entry["storedOnBar"])
    check("the first forward bar is strictly after the stored-on bar", first_fwd == early)
    all_tr = [t for t in SS.simulate(entry["spec"], long_trend) if t["entryIndex"] >= first_fwd]
    check("every forward trade was OPENED after the stored-on bar", all(t["entryIndex"] >= early for t in all_tr))
    check("the forward test counts exactly those trades", fwd["trades"] == len(all_tr))
    check("it is judged with n_trials = 1 (the parameters were fixed before these bars)", fwd["verdict"]["n_trials"] == 1)
    check("with a real edge continuing, the forward record is positive after costs", fwd["verdict"]["expectancy_pct"] > 0,
          str(fwd["verdict"]["expectancy_pct"]))
    # Boundary, made deterministic: store the strategy ON the very bar a real trade was opened on. That trade
    # (and any opened a few bars before) is the past; only trades opened strictly later are forward.
    every = SS.simulate(entry["spec"], long_trend)
    pivot = next(t for t in every if t["entryIndex"] > early + 200)
    at = dict(entry, storedOnBar=long_trend[pivot["entryIndex"]]["date"])
    fb = B.forward_test(at, long_trend, COST)
    check("a trade opened ON the stored-on bar is not a forward trade",
          fb["trades"] == sum(1 for t in every if t["entryIndex"] > pivot["entryIndex"]), f"{fb['trades']}")
    near = dict(entry, storedOnBar=long_trend[pivot["entryIndex"] - 1]["date"])
    check("moving the boundary one bar earlier admits exactly that trade, so the line is exact, not approximate",
          B.forward_test(near, long_trend, COST)["trades"] == fb["trades"] + 1)
    none = B.forward_test(dict(entry, storedOnBar=long_trend[-1]["date"]), long_trend, COST)
    check("stored on the LAST bar: no forward bars, no verdict, and it says so",
          none["forwardBars"] == 0 and none["verdict"] is None)
    check("a stored-on date later than every bar is also nothing", B.forward_test(dict(entry, storedOnBar="2999-01-01"), long_trend, COST)["forwardBars"] == 0)

    print("\n--- classify: watch, holding, decaying - and never retired ---")
    mk = lambda n, e, d=0.99: {"verdict": {"trades": n, "expectancy_pct": e, "deflated": d}}
    check("under 10 forward trades is `watch` even when the sign is negative", B.classify(mk(9, -5.0)) == B.WATCH)
    check("no verdict at all is `watch`", B.classify({"verdict": None}) == B.WATCH)
    check("10 trades, a positive expectancy and a forward result unlikely to be luck is `holding`",
          B.classify(mk(10, 0.4)) == B.HOLDING)
    check("a POSITIVE SIGN ALONE is not `holding`: 29 trades at +0.07% with probability 0.55 is `watch`",
          B.classify(mk(29, 0.07, 0.55)) == B.WATCH)
    check("probability just under the bar is `watch`, at the bar is `holding`",
          B.classify(mk(20, 0.3, B.HOLD_CONFIDENCE - 0.001)) == B.WATCH and B.classify(mk(20, 0.3, B.HOLD_CONFIDENCE)) == B.HOLDING)
    check("a missing confidence never reads as `holding`", B.classify(mk(20, 0.3, None)) == B.WATCH)
    check("a negative expectancy is `decaying` however confident the (irrelevant) figure", B.classify(mk(20, -0.1, 0.99)) == B.DECAYING)
    check("10 trades and a negative expectancy is `decaying`", B.classify(mk(10, -0.4)) == B.DECAYING)
    check("exactly zero expectancy is `decaying` (it does not pay)", B.classify(mk(25, 0.0)) == B.DECAYING)
    check("an undefined expectancy is `decaying`, not holding", B.classify(mk(25, None)) == B.DECAYING)
    check("classify can never return `retired`", all(B.classify(mk(n, e)) != B.RETIRED for n in (0, 5, 30) for e in (-3, 0, 3, None)))

    print("\n--- refresh over the real book ---")
    R2 = tempfile.mkdtemp(prefix="rama-book2-")
    try:
        sidc = B.upsert_from_evolution(R2, dict(early_row or lb), symbol="TEST", exchange="NSE", interval="1d",
                                       bars=early, last_bar=long_trend[early - 1]["date"])["id"]
        rf1 = B.refresh(R2, sidc, long_trend, COST)
        check("refresh of a strategy whose edge continues is `holding`", rf1["status"] == B.HOLDING, str(rf1))
        check("the `current` column is filled and the baseline is untouched",
              B.get(R2, sidc)["current"]["forwardTrades"] == rf1["forward"]["trades"] and B.get(R2, sidc)["baseline"]["measuredOn"])
        check("a holding strategy is not proposed for retirement", rf1["proposeRetire"] is False)
        for _ in range(B.HISTORY_CAP + 5):
            B.refresh(R2, sidc, long_trend, COST)
        check("refreshing again and again keeps the history at its cap", len(B.get(R2, sidc)["history"]) == B.HISTORY_CAP)

        # THE EDGE STOPS: same strategy, the world afterwards is noise.
        # Seed 1 is a world where the edge simply stops: measured -0.26%/trade over 41 trades. (Seed 9 happened to
        # be +0.07% by luck, which is what the HOLD_CONFIDENCE rule exists for; it is covered across seeds below.)
        dec = SB.decayed(long_trend[:early], SB.noise_series(4000, seed=1), early)
        rf2 = B.refresh(R2, sidc, dec, COST)
        check("when the edge stops, the forward test reaches `decaying`", rf2["status"] == B.DECAYING, str(rf2))
        check("it PROPOSES retirement", rf2["proposeRetire"] is True)
        check("it reports what changed", rf2["changedFrom"] == B.HOLDING, str(rf2["changedFrom"]))
        check("BUT IT DID NOT RETIRE ITSELF: still listed, status is decaying not retired",
              B.get(R2, sidc)["status"] == B.DECAYING and len(B.list_all(R2)) == 1)
        check("only master's act retires", B.retire(R2, sidc, "edge gone")["status"] == B.RETIRED)
        check("a retired strategy is hidden by default and kept for the history",
              B.list_all(R2) == [] and len(B.list_all(R2, include_retired=True)) == 1)
        check("a retired strategy is not refreshed", B.refresh(R2, sidc, long_trend, COST)["reason"] == "retired")
        check("restoring puts it back on watch", B.restore(R2, sidc)["status"] == B.WATCH)
        check("deleting is a separate act", B.remove(R2, sidc)["ok"] and B.get(R2, sidc) is None)
        check("refreshing something that does not exist says so", B.refresh(R2, "nope", long_trend, COST)["ok"] is False)
    finally:
        shutil.rmtree(R2, ignore_errors=True)

    print("\n--- a dead strategy is rarely called `holding` (measured across worlds where the edge stops) ---")
    stored_entry = {"id": "y", "template": "livermore_breakout", "spec": B._frozen(spec_early),
                    "storedOnBar": long_trend[early - 1]["date"]}
    verdicts = []
    for sd in range(1, 13):
        verdicts.append(B.classify(B.forward_test(stored_entry, SB.decayed(long_trend[:early], SB.noise_series(3000, seed=sd), early), COST)))
    n_hold = sum(1 for x in verdicts if x == B.HOLDING)
    check(f"on 12 no-edge worlds at most 2 are called `holding` (got {n_hold}: {verdicts})", n_hold <= 2)
    check("and most are `decaying` or `watch`: it did not call a dead strategy healthy", sum(1 for x in verdicts if x != B.HOLDING) >= 10)

    print("\n--- history is bounded ---")
    R3 = tempfile.mkdtemp(prefix="rama-book3-")
    try:
        s3 = B.upsert_from_evolution(R3, lb, symbol="TEST", exchange="NSE", interval="1d", bars=len(trend), last_bar=last_bar)["id"]
        for _ in range(B.HISTORY_CAP + 15):
            B.upsert_from_evolution(R3, lb, symbol="TEST", exchange="NSE", interval="1d", bars=len(trend), last_bar=last_bar)
        check("the history never exceeds its cap", len(B.get(R3, s3)["history"]) == B.HISTORY_CAP)
    finally:
        shutil.rmtree(R3, ignore_errors=True)

    print("\n--- staleness ---")
    import datetime as _dt
    today = _dt.date(2026, 10, 20)
    check("measured today is fresh", B.is_stale({"current": {"measuredOn": "2026-10-20T08:00:00+00:00"}}, today) is False)
    check("measured yesterday is stale", B.is_stale({"current": {"measuredOn": "2026-10-19T08:00:00+00:00"}}, today) is True)
    check("never measured falls back to the stored date", B.is_stale({"storedAt": "2026-10-20T01:00:00+00:00"}, today) is False)
    check("no date at all is stale", B.is_stale({}, today) is True)
    check("an unparseable date is stale, not an exception", B.is_stale({"current": {"measuredOn": "garbage"}}, today) is True)

finally:
    shutil.rmtree(ROOT, ignore_errors=True)

# ═══ utilise: signal_now ══════════════════════════════════════════════════════════════════════════
print("\n--- utilise: what the rule says right now ---")
spec_b = SS.validate_spec({
    "name": "t", "symbol": "TEST", "exchange": "NSE", "interval": "1d", "side": "long",
    "entry": {"op": "all", "k": 1, "blocks": [{"id": "breakout", "params": {"lookback": 3, "direction": "up"}}]},
    "exit": {"stopPct": 5.0, "targetPct": 10.0, "maxBars": 30},
    "sizing": {"capital": 100000, "riskPct": 1.0}, "costs": {}, "sweep": {},
})["spec"]
def bar(i, o, h, l, c): return {"date": f"2021-05-{i:02d}", "open": o, "high": h, "low": l, "close": c, "volume": 1.0}
flatb = [bar(i + 1, 100, 100.5, 99.5, 100) for i in range(6)]
check("a quiet series is `flat`", B.signal_now({"spec": spec_b}, flatb)["state"] == B.FLAT)
met = flatb + [bar(7, 100, 104, 100, 103)]
sm = B.signal_now({"spec": spec_b}, met)
check("a breakout on the last close is `conditions-met`", sm["state"] == B.CONDITIONS_MET, str(sm))
check("it says a fill would be the NEXT bar's open", "NEXT bar" in sm["note"])
check("the indicative stop and target are computed from the last close",
      abs(sm["indicativeStop"] - 103 * 0.95) < 1e-9 and abs(sm["indicativeTarget"] - 103 * 1.10) < 1e-9)
check("the size comes from the risk budget: 1% of 100000 over a 5% stop at 103",
      sm["units"] == int(1000 // (103 * 0.05)), str(sm["units"]))
held = met + [bar(8, 103, 105, 102, 104), bar(9, 104, 106, 103, 105)]
sh = B.signal_now({"spec": spec_b}, held)
check("after the entry bar the rule is `in-trade`", sh["state"] == B.IN_TRADE, str(sh))
if sh["state"] == B.IN_TRADE:
    check("an in-trade state carries entry, stop, target and unrealised %",
          sh["entryPrice"] == 103 and abs(sh["stopPrice"] - 103 * 0.95) < 1e-9 and abs(sh["unrealisedPct"] - (105 - 103) / 103 * 100) < 1e-9)
    check("and how many bars it has been held", sh["barsHeld"] == 2)
check("the state is stamped with the last bar's date, so a stale reading is visible", sh["lastBar"] == "2021-05-09")
check("no bars is flat with a reason, not a crash", B.signal_now({"spec": spec_b}, [])["state"] == B.FLAT)
out = json.dumps([sm, sh, B.signal_now({"spec": spec_b}, flatb)]).lower()
check("NO ORDER LANGUAGE anywhere in a state: no 'buy', 'sell' or 'order' (Section 95)",
      not any(w in out for w in ('"buy', ' buy', 'sell', 'order')), out[:200])
spec_lots = copy.deepcopy(spec_b); spec_lots["lotSize"] = 25; spec_lots["instrument"] = "futures"
check("futures report lots as well as units", B.signal_now({"spec": spec_lots}, met)["lots"] is not None)
spec_nostop = copy.deepcopy(spec_b); spec_nostop["exit"]["stopPct"] = None
sn = B.signal_now({"spec": spec_nostop}, met)
check("a strategy with no stop is flagged unsized, never given an invented size", sn.get("unsized") is True and sn["units"] == 0)

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
