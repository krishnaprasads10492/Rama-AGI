"""
test_strategy_service.py - the glue between the routes and the strategy book (spec Section 151.4)

The routes in `main.py` are thin adapters over `strategy_service`, and the bar loader is injected, so this runs
the whole evolve -> keep -> refresh -> read-out path without pandas, FastAPI or stored data. What it guards:

    one cost definition   evolve, refresh and the backtest route price a trade the same way
    evolve stores nothing keeping is a separate act, from a CACHED run, never from the request
    the book survives     a corrupt file is reported, one bad strategy does not stop the others
    master's acts only    nothing here retires, restores or deletes by itself

Run:  python -m tests.test_strategy_service   (from ai_backend/)
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib
import shutil
import sys
import tempfile

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "engine"))
sys.path.insert(0, str(_HERE))
import strategy_book as B          # noqa: E402
import strategy_eval as SE         # noqa: E402
import strategy_factory as F       # noqa: E402
import strategy_service as SV      # noqa: E402
import strategy_spec as SS         # noqa: E402
import strategy_library as LIB     # noqa: E402
import costs as COSTS              # noqa: E402
import synthetic_bars as SB        # noqa: E402

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


print("\nstrategy_service - evolve, keep, refresh, read out\n")

# ═══ the cost, defined once ═══════════════════════════════════════════════════════════════════════
print("--- cost_for: one definition of what a trade costs ---")
bars_small = SB.trend_series(300, seed=1)
spec = SS.validate_spec(LIB.build("livermore_breakout", symbol="TEST", interval="1d", capital=200000, risk_pct=1.0))["spec"]
model, basis = SV.cost_for(spec, bars_small)
check("an equity strategy is priced on real charges", basis["source"] == "measured", str(basis))
qty = (SS.position_size(spec, bars_small[-1]["close"]) // max(1, int(spec.get("lotSize") or 1))) * max(1, int(spec.get("lotSize") or 1))
eff = COSTS.effective_round_trip_pct(spec["instrument"], bars_small[-1]["close"], qty)
check("the commission term is the charge model's round trip, halved (round trip = 2 x commission + 2 x slippage + spread)",
      abs(model.commission_pct - eff["pct"] / 2.0) < 1e-12, f"{model.commission_pct} vs {eff['pct'] / 2.0}")
check("slippage and spread stay master's own estimates",
      model.slippage_pct == spec["costs"]["slippagePct"] and model.spread_pct == spec["costs"]["spreadPct"])
check("it reports the quantity and notional it priced, so the percentage is not mistaken for universal",
      basis["assumedQuantity"] == qty and basis["assumedNotional"] > 0)

opt = dict(spec, instrument="options")
check("options stay on the flat percentages, and say why", SV.cost_for(opt, bars_small)[1]["source"] == "flat" and "premium" in SV.cost_for(opt, bars_small)[1]["why"])
broke = dict(spec, sizing=dict(spec["sizing"], capital=100, riskPct=0.01))
check("a risk budget that sizes below one unit has no quantity to price, and says so",
      SV.cost_for(broke, bars_small)[1]["source"] == "flat")
check("no bars at all is not a crash", SV.cost_for(spec, [])[1]["source"] == "flat")

# A flat rupee brokerage makes the percentage depend on size, so a run is priced under the HIGHEST among its candidates.
small = dict(spec, sizing=dict(spec["sizing"], capital=20000))
big = dict(spec, sizing=dict(spec["sizing"], capital=2000000))
mp, bp = SV._conservative_cost([small, big], bars_small)
pcts = sorted([SV.cost_for(small, bars_small)[0].round_trip_pct(), SV.cost_for(big, bars_small)[0].round_trip_pct()])
check("a run is judged under the highest round-trip cost among its candidates (can only look worse, never better)",
      abs(mp.round_trip_pct() - pcts[-1]) < 1e-12, f"{mp.round_trip_pct()} vs {pcts}")
check("and the range it chose from is reported", bp["candidateRoundTripRange"] == [pcts[0], pcts[1]])
check("no candidates is not a crash", SV._conservative_cost([], bars_small)[0] is None)

# ═══ evolve: stores nothing ═══════════════════════════════════════════════════════════════════════
print("\n--- evolve: it generates and judges, and stores NOTHING ---")
ROOT = tempfile.mkdtemp(prefix="rama-svc-")
try:
    full = SB.trend_series(5000, seed=1)
    world = {"bars": full[:3500]}
    calls = []

    def loader(symbol, exchange, interval):
        calls.append((symbol, exchange, interval))
        return world["bars"] if symbol == "TEST" else None

    short = SV.run_evolve(lambda s, e, i: SB.trend_series(100, seed=1), symbol="TEST")
    check("too few bars is refused with how many it has and how many it needs",
          short["ok"] is False and short["storedBars"] == 100 and short["needBars"] == F.MIN_BARS and "Fetch more history" in short["reason"])
    nodata = SV.run_evolve(lambda s, e, i: None, symbol="TEST")
    check("no stored bars is the same refusal with zero", nodata["ok"] is False and nodata["storedBars"] == 0)
    check("a bad side is refused before any work", SV.run_evolve(loader, symbol="TEST", side="sideways")["ok"] is False)
    check("a template that does not exist is refused with its name",
          SV.run_evolve(loader, symbol="TEST", templates=["nope"])["ok"] is False)
    check("a refused run is not cached, so it cannot be kept", len(SV._runs) == 0)

    SV.clear_runs()
    run = SV.run_evolve(loader, symbol="TEST", capital=200000, risk_pct=1.0)
    check("an evolve over enough bars succeeds", run["ok"] is True, str(run.get("reason")))
    check("it carries a run id, the bars it used and what it was asked", bool(run["runId"]) and run["bars"] == 3500 and run["params"]["capital"] == 200000)
    check("the cost basis it was judged under is on the result", run["costBasis"]["source"] in ("measured", "flat") and "runRoundTripPct" in run["costBasis"])
    check("nothing is in the book: EVOLVING STORES NOTHING", B.list_all(ROOT) == [] and not os.path.exists(os.path.join(ROOT, "_strategies")))
    check("every ranked row says what it may be called", all(r["verdictClass"] in (F.DEMONSTRATED, F.UNPROVEN) for r in run["ranked"]))
    check("the refused templates travel with the result, not silently dropped", isinstance(run["refused"], list))
    ranked_ids = [r["id"] for r in run["ranked"]]
    check("the run is cached for keeping", run["runId"] in SV._runs)

    # ═══ keep ═════════════════════════════════════════════════════════════════════════════════════
    print("\n--- keep: master's act, from the cached run ---")
    check("a run id that does not exist says the run is gone and to evolve again",
          SV.keep(ROOT, "nope", demonstrated=True)["gone"] is True)
    check("keeping nothing named keeps nothing", SV.keep(ROOT, run["runId"], ids=[])["kept"] == [])
    spoof = SV.keep(ROOT, run["runId"], ids=["not_a_template", "../../etc"])
    check("a name that is not a ranked row of that run is skipped with a reason, not stored",
          spoof["kept"] == [] and len(spoof["skipped"]) == 2 and B.list_all(ROOT) == [])
    not_ranked = [x["id"] for k in ("insufficient", "unvalidated", "excluded") for x in run[k]]
    if not_ranked:
        check("a row that was NOT ranked cannot be kept even by name", SV.keep(ROOT, run["runId"], ids=[not_ranked[0]])["kept"] == [])
    demo = [r["id"] for r in run["ranked"] if r["verdictClass"] == F.DEMONSTRATED]
    unproven = [r["id"] for r in run["ranked"] if r["verdictClass"] == F.UNPROVEN]
    k1 = SV.keep(ROOT, run["runId"], demonstrated=True)
    check("`keep demonstrated` keeps exactly the demonstrated rows of the run",
          sorted(x["template"] for x in k1["kept"]) == sorted(demo)
          and all(e["baseline"]["verdictClass"] == F.DEMONSTRATED for e in B.list_all(ROOT)))
    check("something was stored", len(B.list_all(ROOT)) >= 1, "this series should demonstrate at least one template")
    again = SV.keep(ROOT, run["runId"], demonstrated=True)
    check("keeping the same rows again updates them instead of duplicating",
          all(x["action"] == "updated" for x in again["kept"]) and len(B.list_all(ROOT)) == len(set(x["id"] for x in B.list_all(ROOT))))

    stored = B.list_all(ROOT)[0]
    check("a stored strategy remembers where it was stored: the symbol, the interval and the LAST bar of the run",
          stored["symbol"] == "TEST" and stored["interval"] == "1d" and stored["storedOnBar"] == full[3499]["date"])

    # The cache is bounded.
    # Unproven vs demonstrated, deterministically: a cached run holding one of each, built from a real stored row.
    SV.clear_runs()
    donor = next(r for r in run["ranked"] if r.get("stored"))
    mk_row = lambda rid, klass, tid: dict(donor, id=tid, template=tid, name=tid, verdictClass=klass)
    # distinct frozen specs so they are distinct records
    spec_a, spec_b = json.loads(json.dumps(donor["stored"])), json.loads(json.dumps(donor["stored"]))
    spec_b["exit"]["stopPct"] = round((spec_b["exit"].get("stopPct") or 5.0) + 1.25, 4)
    SV._runs["mix"] = dict(run, ranked=[dict(mk_row("a", F.DEMONSTRATED, "tpl_a"), stored=spec_a),
                                         dict(mk_row("b", F.UNPROVEN, "tpl_b"), stored=spec_b)])
    MIX = tempfile.mkdtemp(prefix="rama-svc-mix-")
    try:
        got = SV.keep(MIX, "mix", demonstrated=True)
        check("`keep demonstrated` keeps the demonstrated row and NOT the unproven one",
              [x["template"] for x in got["kept"]] == ["tpl_a"] and len(B.list_all(MIX)) == 1)
        got2 = SV.keep(MIX, "mix", ids=["tpl_b"])
        check("the unproven row is kept only when NAMED, and is stored as unproven",
              len(got2["kept"]) == 1 and len(B.list_all(MIX)) == 2 and
              sorted(e["baseline"]["verdictClass"] for e in B.list_all(MIX)) == [F.DEMONSTRATED, F.UNPROVEN])
    finally:
        shutil.rmtree(MIX, ignore_errors=True)

    # The cache is bounded: evolve more times than it holds, with one cheap template.
    SV.clear_runs()
    first_id = None
    for i in range(SV.RUN_CACHE_SIZE + 2):
        rr = SV.run_evolve(loader, symbol="TEST", capital=200000, templates=["dow_primary_trend"])
        first_id = first_id or rr["runId"]
    check("only the last few runs are held (bounded memory)", len(SV._runs) == SV.RUN_CACHE_SIZE and first_id not in SV._runs)
    check("and a dropped run says it is gone rather than guessing", SV.keep(ROOT, first_id, demonstrated=True)["gone"] is True)

    # ═══ the book, refresh, signals ═══════════════════════════════════════════════════════════════
    print("\n--- the book: staleness, refresh, read-out ---")
    now_day = _dt.datetime.now(_dt.timezone.utc).date()
    view = SV.book_view(ROOT)
    check("the book view lists each strategy with its status and counts", view["ok"] and view["counts"]["watch"] == len(view["strategies"]))
    check("a strategy stored just now is not stale", view["staleIds"] == [])
    check("it is stale two days later", len(SV.book_view(ROOT, today=now_day + _dt.timedelta(days=2))["staleIds"]) == len(view["strategies"]))

    world["bars"] = full                                   # the market moved on: 1500 new bars
    calls.clear()
    fresh = SV.refresh(ROOT, loader)
    check("refreshing when nothing is stale does no work and loads no bars", fresh["refreshed"] == 0 and calls == [])
    r1 = SV.refresh(ROOT, loader, only_stale=False)
    check("a forced refresh forward-tests every stored strategy", r1["refreshed"] == len(B.list_all(ROOT)))
    check("each result carries the cost basis it was priced under", all("costBasis" in x for x in r1["results"]))
    check("every forward test saw only bars AFTER the one it was stored on",
          all(x["forward"]["forwardBars"] == 1500 for x in r1["results"]))
    check("the book now has a `current` column; the baseline is untouched",
          all(e["current"] and e["baseline"]["measuredOn"] and e["current"]["forwardBars"] == 1500 for e in B.list_all(ROOT)))
    check("a refresh never retires anything", all(e["status"] != B.RETIRED for e in B.list_all(ROOT)))
    check("stale ones refresh by default when due",
          SV.refresh(ROOT, loader, today=now_day + _dt.timedelta(days=3))["refreshed"] == len(B.list_all(ROOT)))

    sid = B.list_all(ROOT)[0]["id"]
    named = SV.refresh(ROOT, loader, ids=[sid], only_stale=False)
    check("naming one refreshes only that one", named["refreshed"] == 1 and named["results"][0]["id"] == sid)

    # One strategy whose bars are gone must not stop the others.
    book = B.load(ROOT)
    ghost = json.loads(json.dumps(book["strategies"][0]))
    ghost["id"], ghost["symbol"] = "ghost0000000", "GONE"
    book["strategies"].append(ghost)
    B._save(ROOT, book)
    mixed = SV.refresh(ROOT, loader, only_stale=False)
    bad = [x for x in mixed["results"] if x["id"] == "ghost0000000"][0]
    check("a strategy with no stored bars reports that, and the others still refresh",
          bad["ok"] is False and "no stored" in bad["reason"] and mixed["refreshed"] == len(B.list_all(ROOT)) - 1)

    def exploding(symbol, exchange, interval):
        if symbol == "GONE":
            raise RuntimeError("disk fell off")
        return world["bars"]
    boom = SV.refresh(ROOT, exploding, only_stale=False)
    check("a loader that RAISES for one strategy is contained to that strategy",
          [x for x in boom["results"] if x["id"] == "ghost0000000"][0]["ok"] is False and boom["refreshed"] == len(B.list_all(ROOT)) - 1)
    B.remove(ROOT, "ghost0000000")

    sig = SV.signals(ROOT, loader, today=_dt.date.fromisoformat(full[-1]["date"]) + _dt.timedelta(days=3))
    check("signals give one reading per live strategy", sig["ok"] and len(sig["signals"]) == len(B.list_all(ROOT)))
    check("every reading is flat / conditions-met / in-trade", all(x["state"] in (B.FLAT, B.CONDITIONS_MET, B.IN_TRADE) for x in sig["signals"]))
    check("every reading says how old its last bar is", all(x["barAgeDays"] == 3 for x in sig["signals"]))
    blob = json.dumps(sig).lower()
    check("NO ORDER LANGUAGE in a reading: no 'buy', 'sell' or 'order'", not any(w in blob for w in ("buy", "sell", "order")))
    noload = SV.signals(ROOT, lambda s, e, i: None)
    check("a strategy whose bars are gone reads flat with the reason, not a crash",
          all(x["state"] == B.FLAT and "no stored" in x["reason"] for x in noload["signals"]))

    # ═══ master's acts ════════════════════════════════════════════════════════════════════════════
    print("\n--- retire, restore, remove: only when asked ---")
    check("retiring is master's act and works", SV.retire(ROOT, sid, "no longer wanted")["status"] == B.RETIRED)
    check("a retired strategy leaves the default view but is kept", sid not in [e["id"] for e in SV.book_view(ROOT)["strategies"]]
          and sid in [e["id"] for e in SV.book_view(ROOT, include_retired=True)["strategies"]])
    check("a retired strategy is not refreshed or read", all(x["id"] != sid for x in SV.refresh(ROOT, loader, only_stale=False)["results"])
          and all(x["id"] != sid for x in SV.signals(ROOT, loader)["signals"]))
    check("restoring puts it back on watch", SV.restore(ROOT, sid)["status"] == B.WATCH)
    check("removing deletes it", SV.remove(ROOT, sid)["ok"] and B.get(ROOT, sid) is None)
    check("removing something that is not there says so", SV.remove(ROOT, sid)["ok"] is False)

    # ═══ a corrupt book ═══════════════════════════════════════════════════════════════════════════
    print("\n--- a corrupt book is reported by every entry point and never overwritten ---")
    p = os.path.join(ROOT, "_strategies", "book.json")
    good = open(p, "rb").read()
    open(p, "w").write("{ nope")
    outs = [SV.book_view(ROOT), SV.refresh(ROOT, loader), SV.signals(ROOT, loader), SV.retire(ROOT, "x"),
            SV.restore(ROOT, "x"), SV.remove(ROOT, "x")]
    SV.clear_runs()
    SV._runs["live"] = {"ranked": [{"id": "livermore_breakout", "verdictClass": F.DEMONSTRATED, "stored": spec, "name": "x"}],
                        "symbol": "TEST", "exchange": "NSE", "interval": "1d", "bars": 1, "lastBar": "2020-01-01", "measuredOn": "2020-01-01T00:00:00Z"}
    outs.append(SV.keep(ROOT, "live", demonstrated=True))
    check("every entry point reports it as corrupt (or a gone run) instead of raising",
          all(o.get("ok") is False and o.get("corrupt") is True for o in outs), str([o.get("reason") for o in outs if not o.get("corrupt")]))
    check("and the file on disk is exactly as it was", open(p, "rb").read() == b"{ nope")
    open(p, "wb").write(good)
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

print(f"\n  {_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
