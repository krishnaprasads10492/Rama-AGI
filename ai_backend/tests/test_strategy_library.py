"""
test_strategy_library.py — the literature, as falsifiable specs (Section 113).

Two classes of assertion matter here.

STRUCTURAL: every template must build into a spec that `validate_spec` accepts. The library names blocks
and parameters by string, so a template can silently rot when the block catalogue changes — and a
rotted template fails in front of master rather than here unless this runs.

HONESTY: a book is a hypothesis. Every entry must carry a source, a claim, a way to disprove it, and the
label `published` rather than any measured result. And the library must never rank or filter on win rate,
which is the thing master asked for and the thing that would do the damage.

Run from `ai_backend/`:  py -m tests.test_strategy_library
"""

import pathlib
import sys

# Top-level import, bypassing `engine/__init__.py` and its numpy dependency — same reason as
# test_strategy_eval and test_costs. Both modules under test are stdlib-only by design.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import strategy_library as L   # noqa: E402
import strategy_spec as S      # noqa: E402

_pass = 0
_fail = 0


def check(label, ok, detail=""):
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {label}")
    else:
        _fail += 1
        print(f"  FAIL  {label}{(' - ' + str(detail)) if detail else ''}")


def _key_error_text(fn, needle):
    """Whether a refusal names what WOULD have worked, rather than just refusing."""
    try:
        fn()
        return False
    except KeyError as e:
        return needle in str(e)


print("\nstrategy library - a book is a hypothesis, not evidence\n")

# ── Every template must survive the validator ─────────────────────────────────
print("  every template builds into a spec the validator accepts")
for tid in sorted(L.TEMPLATES):
    spec = L.build(tid, symbol="RELIANCE")
    v = S.validate_spec(spec)
    check(f"{tid} validates", v["ok"] is True, v["errors"])
    check(f"{tid} is backtestable - no blocked block slipped in", v["backtestable"] is True)

print("\n  and the blocks they name really exist")
for tid, t in L.TEMPLATES.items():
    for b in t["entry"]["blocks"]:
        check(f"{tid}: block {b['id']} is in the catalogue", b["id"] in S.BLOCKS)
        check(f"{tid}: every param of {b['id']} is declared",
              all(p in S.BLOCKS[b["id"]]["params"] for p in b["params"]),
              set(b["params"]) - set(S.BLOCKS[b["id"]]["params"]))

# ── Trial counts stay small, deliberately ─────────────────────────────────────
print("\n  sweeps are theory-driven, not grids")
worst = max(S.validate_spec(L.build(t, symbol="X"))["trials"] for t in L.TEMPLATES)
check("no template searches more than 4 variants", worst <= 4, worst)
check("the sweep can be dropped entirely, giving a trial count of 1",
      S.validate_spec(L.build("livermore_breakout", symbol="X", include_sweep=False))["trials"] == 1)
check("which is the strongest form of this evidence - parameters fixed in advance",
      L.build("tsmom_12m", symbol="X", include_sweep=False)["sweep"] == {})
check("Donchian's own two lookbacks and nothing between them",
      L.TEMPLATES["livermore_breakout"]["sweep"]["0.lookback"] == [20, 55])
check("the momentum paper's own two horizons, 9 and 12 months of trading days",
      L.TEMPLATES["tsmom_12m"]["sweep"]["0.period"] == [189, 252])

# ── Provenance on everything ───────────────────────────────────────────────────
print("\n  provenance: a source, a claim, and a way to disprove it")
for tid, t in L.TEMPLATES.items():
    check(f"{tid} names an author and a work",
          bool(t["source"]["author"]) and bool(t["source"]["work"]))
    check(f"{tid} records where it can be read", bool(t["source"]["free"]))
    check(f"{tid} states what would DISCONFIRM it", len(t["disconfirms"]) > 40)
p = L.provenance("livermore_breakout")
check("provenance labels the claim as published, never measured", p["evidence"] == L.PUBLISHED)
check("and says so in words, so a cited author is not read as an endorsement",
      "not a measured result" in p["evidenceNote"])
check("an unknown template has no provenance rather than an invented one",
      L.provenance("nonesuch") is None)


def raises_key_error(fn):
    try:
        fn()
        return False
    except KeyError:
        return True


check("building an unknown template raises rather than returning a default",
      raises_key_error(lambda: L.build("nonesuch", symbol="X")))
check("and the error names the valid ids",
      _key_error_text(lambda: L.build("nonesuch", symbol="X"), "livermore_breakout"))
check("public-domain sources are genuinely free and named as such",
      "public domain" in L.TEMPLATES["livermore_breakout"]["source"]["free"])
check("a paid book is not claimed to be free",
      L.BLOCKED["natenberg_delta_neutral"]["source"]["free"].startswith("No"))

# ── The 80% question ──────────────────────────────────────────────────────────
print("\n  the win-rate question master asked")
w = L.win_rate_warning()
check("the library states plainly that a win rate describes shape, not quality",
      "shape, not its quality" in w["headline"], w["headline"])
check("it gives four independent reasons", len(w["reasons"]) >= 4)
check("one of them is the search-artefact problem",
      any("trials" in r for r in w["reasons"]))
check("one of them is that few losses means the loss side is least observed",
      any("least-observed" in r for r in w["reasons"]))
check("it names what to use instead", len(w["instead"]) >= 4)
check("expectancy after costs is first", "Expectancy" in w["instead"][0])
check("the win rate is still REPORTED, just never used as a filter",
      "never a filter" in w["reported"])
check("and a counterexample is given: a tail hedge that almost never wins",
      "tail hedge" in w["counterexample"])

print("\n  expected shape is stated in advance, so a result can contradict it")
low = L.expected_shape("livermore_breakout")
high = L.expected_shape("bollinger_reversion")
check("the breakout strategy expects to LOSE most of its trades",
      low["winRate"] == "below 50%", low)
check("and to make it back on payoff", low["payoff"].startswith("3"))
check("the reversion strategy expects 65-80% wins", "65-80%" in high["winRate"])
check("and a payoff BELOW 1 - the 80% shape", high["payoff"] == "below 1")
check("which the library names explicitly as the trap",
      "THIS IS THE 80% SHAPE" in high["why"])
check("and works out the break-even win rate it implies", "57%" in high["why"])
check("expected shape is labelled published, not measured", low["evidence"] == L.PUBLISHED)
check("shapes are inversely related across the library - no template claims both",
      not any(t["shape"]["payoff"].startswith("3") and "80%" in t["shape"]["winRate"]
              for t in L.TEMPLATES.values()))

# THE INDEPENDENT CONFIRMATION: the validator, written months earlier and knowing nothing about this
# library, flags the reversion template's geometry on its own.
rev = S.validate_spec(L.build("bollinger_reversion", symbol="X"))
check("THE VALIDATOR INDEPENDENTLY WARNS ABOUT THE 80% TEMPLATE'S GEOMETRY",
      any("reward-to-risk" in x for x in rev["warnings"]), rev["warnings"])
check("and says a win rate above 50% is needed merely to break even",
      any("break" in x and "50%" in x for x in rev["warnings"]))
check("while the breakout template draws no such warning",
      not any("reward-to-risk" in x
              for x in S.validate_spec(L.build("livermore_breakout", symbol="X"))["warnings"]))

# ── Horizons ──────────────────────────────────────────────────────────────────
print("\n  long term and short term, as master asked")
check("there are long-term templates", len(L.by_horizon(L.LONG_TERM)) >= 2)
check("and short-term templates", len(L.by_horizon(L.SHORT_TERM)) >= 5)
check("every template declares one of the known horizons",
      all(t["horizon"] in (L.LONG_TERM, L.SHORT_TERM, L.INTRADAY) for t in L.TEMPLATES.values()))
check("a long-term template holds for a long time",
      L.TEMPLATES["tsmom_12m"]["exit"]["maxBars"] >= 200)
check("a short-term template does not", L.TEMPLATES["bollinger_reversion"]["exit"]["maxBars"] <= 20)
check("both sides are represented, not just long",
      {t["side"] for t in L.TEMPLATES.values()} == {"long", "short"})
check("and the short template admits it fights the long-run drift",
      "drift" in L.TEMPLATES["livermore_short"]["disconfirms"])

# ── What it cannot express, named rather than omitted ─────────────────────────
print("\n  offered and refused: what the harness cannot express")
check("blocked strategies are recorded, not silently dropped", len(L.BLOCKED) >= 5)
for bid, b in L.BLOCKED.items():
    check(f"{bid} names the missing capability", len(b["needs"]) >= 1)
    check(f"{bid} explains why in engine terms", len(b["why"]) > 60)
check("option premium selling is blocked for want of IV, greeks and a leg model",
      set(["implied volatility", "option greeks"]).issubset(set(L.BLOCKED["sinclair_variance_premium"]["needs"])))
check("Sinclair's own point about win rate is recorded",
      "80%" in L.BLOCKED["sinclair_variance_premium"]["claim"])
check("cross-sectional momentum is blocked for want of a portfolio model",
      any("portfolio" in n for n in L.BLOCKED["jegadeesh_titman_cross_sectional"]["needs"]))
check("the OI gap names that the DATA IS ALREADY ON DISK",
      "already on disk" in L.BLOCKED["oi_positioning"]["source"]["free"])
check("and that one new block shape closes it",
      "One new block" in L.BLOCKED["oi_positioning"]["why"])
check("the tail hedge is recorded as the counterexample to a win-rate filter",
      "80%" in L.BLOCKED["taleb_tail_hedge"]["why"])

# ── Method sources ────────────────────────────────────────────────────────────
print("\n  method claims are separated from strategy claims")
check("method sources are recorded separately", len(L.METHOD_SOURCES) >= 4)
check("each names where it is already applied in the engine",
      all(m["appliedIn"] for m in L.METHOD_SOURCES))
check("Tharp's expectancy is tied to the fields that implement it",
      "expectancy_pct" in [m for m in L.METHOD_SOURCES if "Tharp" in m["author"]][0]["appliedIn"])
check("Lopez de Prado is tied to the deflated Sharpe",
      any("deflated_sharpe" in m["appliedIn"] for m in L.METHOD_SOURCES))

# ── The catalogue ─────────────────────────────────────────────────────────────
print("\n  the catalogue master reads")
c = L.catalogue()
check("every template appears", len(c["templates"]) == len(L.TEMPLATES))
check("with its trial count, so the cost of the search is visible up front",
      all(isinstance(t["trials"], int) and t["trials"] >= 1 for t in c["templates"]))
check("every row is labelled published", all(t["evidence"] == L.PUBLISHED for t in c["templates"]))
check("blocked entries travel with the catalogue", len(c["blocked"]) == len(L.BLOCKED))
check("the win-rate warning travels with it too", "headline" in c["winRateWarning"])
check("and the closing note says a book does not settle anything",
      "regardless of who wrote the book" in c["note"])
check("no row anywhere claims a measured result",
      "measured" not in str([t["evidence"] for t in c["templates"]]))

print("\n  build options")
b = L.build("dow_primary_trend", symbol="nifty50", exchange="nse", capital=250000, risk_pct=0.5)
check("the symbol is normalised by the validator",
      S.validate_spec(b)["spec"]["symbol"] == "NIFTY50")
check("capital and risk pass through", b["sizing"]["capital"] == 250000 and b["sizing"]["riskPct"] == 0.5)
check("a custom cost model can be supplied",
      L.build("dow_primary_trend", symbol="X", costs={"commissionPct": 0.1})["costs"]["commissionPct"] == 0.1)
check("template params are copied, not shared - building twice cannot mutate the library",
      (lambda: (L.build("livermore_breakout", symbol="X")["entry"]["blocks"][0]["params"].update({"lookback": 999}),
                L.TEMPLATES["livermore_breakout"]["entry"]["blocks"][0]["params"]["lookback"] == 20)[1])())

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
