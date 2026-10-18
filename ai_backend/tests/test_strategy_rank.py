"""
test_strategy_rank.py — does a strategy earn its place the way master ruled? (spec Sections 135, 149)

Master: "ranked and named - but filtered for optimal accuracy and profit. accuracy takes most precedence
but without profit what's the point."

What must hold:

    PROFIT IS A GATE. An 80%-accurate money-loser is EXCLUDED, never ranked, never merely ranked lower.
    ACCURACY ORDERS THE SURVIVORS. The more accurate profitable strategy outranks the more profitable one.
    NOTHING IS RANKED WITHOUT OUT-OF-SAMPLE EVIDENCE OR ENOUGH OF IT.
    NOTHING IS SILENTLY DROPPED. Every candidate appears in exactly one list, with its reason.

Candidates are built from REAL `strategy_eval.evaluate` output, not hand-written dicts, so the module is
tested against the shape the engine actually produces.

Stdlib only. Run:  python -m tests.test_strategy_rank   (from ai_backend/)
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import strategy_eval as _se    # noqa: E402
import strategy_rank as R      # noqa: E402

FREE = _se.CostModel(0.0, 0.0, 0.0)

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


def verdict(wins: int, win_pct: float, losses: int, loss_pct: float, trials: int = 1) -> dict:
    """A real verdict from a deterministic, interleaved trade list (no randomness, so exact figures)."""
    seq = []
    w, l = wins, losses
    # Interleave so the series is not all-wins-then-all-losses; the order does not change the figures
    # asserted here but a sorted series would be a stranger fixture than any real one.
    while w or l:
        if w and (not l or w * (losses or 1) >= l * (wins or 1)):
            seq.append(win_pct); w -= 1
        else:
            seq.append(-loss_pct); l -= 1
    return _se.evaluate(seq, n_trials=trials, cost_model=FREE).to_dict()


def cand(cid: str, oos, ins=None, claim=None, date="2026-10-17") -> dict:
    return {"id": cid, "name": cid.upper(), "outOfSample": oos, "inSample": ins,
            "claim": claim, "measuredOn": date}


def where(res: dict, cid: str):
    for key in ("ranked", "insufficient", "unvalidated", "excluded"):
        for r in res[key]:
            if r["id"] == cid:
                return key, r
    return None, None


print("\nstrategy_rank - profit is a gate, accuracy is the ranking\n")

# ── THE CASE SECTION 113 REFUSED ────────────────────────────────────────────────────────────────────
print("--- the 80%-accurate money-loser ---")
loser = verdict(40, 1.0, 10, 5.0)
check("the fixture is what it claims: 80% accurate", abs(loser["win_rate"] - 0.80) < 1e-9, str(loser["win_rate"]))
check("and loses 0.20% a trade", abs(loser["expectancy_pct"] - (-0.20)) < 1e-9, str(loser["expectancy_pct"]))

good = verdict(55, 2.0, 45, 1.0)           # 55% accurate, +0.65 per trade
accurate = verdict(65, 1.0, 35, 1.2)       # 65% accurate, +0.23 per trade
res = R.rank([cand("loser", loser), cand("good", good), cand("accurate", accurate)])
k, row = where(res, "loser")
check("the accurate money-loser is EXCLUDED", k == "excluded", str(k))
check("and never appears in the ranking at any position", all(r["id"] != "loser" for r in res["ranked"]))
check("its exclusion says it does not make money after costs", "does not make money" in row["reason"], row["reason"])
check("and shows the hit rate that made it tempting", "80%" in row["reason"], row["reason"])
check("it carries its out-of-sample figures so master can see what was refused",
      row["outOfSample"]["hitRate"] == loser["win_rate"])

# ── ACCURACY ORDERS THE SURVIVORS ───────────────────────────────────────────────────────────────────
print("\n--- accuracy orders the survivors ---")
check("both profitable candidates are ranked", [r["id"] for r in res["ranked"]] == ["accurate", "good"],
      str([r["id"] for r in res["ranked"]]))
check("the MORE ACCURATE one is first even though the other earns three times as much per trade",
      res["ranked"][0]["id"] == "accurate"
      and good["expectancy_pct"] > 2.5 * accurate["expectancy_pct"])
check("ranks are numbered from 1", [r["rank"] for r in res["ranked"]] == [1, 2])

tie_a = verdict(60, 1.0, 40, 1.0)          # 60%, +0.2
tie_b = verdict(60, 1.5, 40, 1.0)          # 60%, +0.5
t = R.rank([cand("tie_a", tie_a), cand("tie_b", tie_b)])
check("equal accuracy: the larger edge goes first",
      [r["id"] for r in t["ranked"]] == ["tie_b", "tie_a"], str([r["id"] for r in t["ranked"]]))

# ── MINIMUM SAMPLE ──────────────────────────────────────────────────────────────────────────────────
print("\n--- minimum sample ---")
tiny = verdict(12, 1.0, 0, 1.0)            # 100% accurate over 12 trades
tres = R.rank([cand("tiny", tiny), cand("good", good)])
k, row = where(tres, "tiny")
check("100% accuracy over twelve trades is INSUFFICIENT, not first place", k == "insufficient", str(k))
check("the reason names the shortfall", "12" in row["reason"] and str(R.MIN_TRADES) in row["reason"], row["reason"])
check("and quotes no hit rate as if it meant something", "no hit rate is quoted" in row["reason"])
check("the real candidate is unaffected", tres["ranked"][0]["id"] == "good")
check("the floor is the evaluator's own, not a second number",
      R.MIN_TRADES == _se.MIN_TRADES)
custom = R.rank([cand("tiny", tiny)], min_trades=10)
check("a lower floor can be chosen deliberately", where(custom, "tiny")[0] == "ranked")

# ── OUT-OF-SAMPLE IS MANDATORY ──────────────────────────────────────────────────────────────────────
print("\n--- out-of-sample is mandatory ---")
ures = R.rank([cand("insample_only", None, ins=good), cand("blank", {"trades": None})])
check("a candidate with only an in-sample verdict is UNVALIDATED",
      where(ures, "insample_only")[0] == "unvalidated")
check("and so is one whose out-of-sample verdict carries no trade count",
      where(ures, "blank")[0] == "unvalidated")
check("the reason says why in-sample cannot rank",
      "best of many tuned candidates" in where(ures, "insample_only")[1]["reason"])
check("an in-sample-only candidate is never ranked", ures["ranked"] == [])

# ── THE GAP IS THE FINDING ──────────────────────────────────────────────────────────────────────────
print("\n--- the in-sample / out-of-sample gap is shown, not averaged ---")
ins_high = verdict(71, 1.0, 29, 1.0)       # 71% in sample
oos_low = verdict(52, 1.2, 48, 1.0)        # 52% out of sample, still profitable
g = R.rank([cand("fits_past", oos_low, ins=ins_high)])
row = g["ranked"][0]
check("both hit rates are reported", row["inSampleHitRate"] == ins_high["win_rate"] and row["hitRate"] == oos_low["win_rate"])
check("the gap is in percentage points", abs(row["hitRateGapPoints"] - 19.0) < 1e-6, str(row["hitRateGapPoints"]))
check("a gap that large is flagged", row["largeGap"] is True)
small = R.rank([cand("steady", verdict(60, 1.0, 40, 1.0), ins=verdict(62, 1.0, 38, 1.0))])
check("a small gap is not flagged", small["ranked"][0]["largeGap"] is False)
check("the ranking uses the OUT-OF-SAMPLE hit rate",
      row["hitRate"] == oos_low["win_rate"] and row["hitRate"] != ins_high["win_rate"])

# ── CLAIM AND MEASUREMENT NEVER MERGE ───────────────────────────────────────────────────────────────
print("\n--- the claim and the measurement are separate fields ---")
claimed = {"source": "A Trading Book, ch.4", "text": "wins 85% of the time"}
c = R.rank([cand("booked", accurate, claim=claimed, date="2026-10-17")])["ranked"][0]
check("the claim is preserved verbatim", c["claim"] == claimed)
check("the measurement is what the engine found, not what the book said",
      c["measurement"]["hitRate"] == accurate["win_rate"] and c["measurement"]["hitRate"] != 0.85)
check("they are different fields", c["claim"] is not c["measurement"])
check("the date of measurement travels with it", c["measuredOn"] == "2026-10-17")

# ── SELECTION NOISE ─────────────────────────────────────────────────────────────────────────────────
print("\n--- ranking K candidates is itself a search ---")
check("with one candidate there is nothing to select among: the ceiling is the breakeven rate",
      abs(R.selection_noise_ceiling(0.5, 100, 1) - 0.5) < 1e-9)
c10 = R.selection_noise_ceiling(0.5, 100, 10)
c500 = R.selection_noise_ceiling(0.5, 100, 500)
check("comparing more candidates raises the hit rate pure luck would reach", 0.5 < c10 < c500 <= 1.0,
      f"{c10} {c500}")
check("a bigger sample lowers it", R.selection_noise_ceiling(0.5, 1000, 50) < R.selection_noise_ceiling(0.5, 50, 50))
check("it is None, not invented, when there is no breakeven", R.selection_noise_ceiling(None, 100, 10) is None)
check("or no trades", R.selection_noise_ceiling(0.5, 0, 10) is None)
check("or a breakeven outside (0,1)", R.selection_noise_ceiling(1.0, 100, 10) is None)
crowd = [cand(f"c{i}", accurate) for i in range(30)]
cr = R.rank(crowd)
check("every row records how many candidates it was compared against", cr["ranked"][0]["candidatesCompared"] == 30)
check("every row says whether it beats the hit rate luck alone would reach",
      isinstance(cr["ranked"][0]["exceedsSelectionNoise"], bool))
check("the top of a crowd is called optimistic", any("optimistic" in n for n in cr["notes"]))
check("and master is told to re-test on data none of them saw", any("none of them has seen" in n for n in cr["notes"]))

# ── NOTHING IS SILENTLY DROPPED ─────────────────────────────────────────────────────────────────────
print("\n--- every candidate appears exactly once ---")
mix = [cand("a", good), cand("b", loser), cand("c", tiny), cand("d", None), cand("e", accurate)]
m = R.rank(mix)
seen = [r["id"] for key in ("ranked", "insufficient", "unvalidated", "excluded") for r in m[key]]
check("every input is accounted for", sorted(seen) == sorted(c["id"] for c in mix), str(seen))
check("none appears twice", len(seen) == len(set(seen)))
check("the count is reported", m["candidatesCompared"] == 5)
check("each refused candidate carries a reason", all(r["reason"] for key in ("insufficient", "unvalidated", "excluded") for r in m[key]))
check("each refused candidate carries a machine-readable status",
      {r["status"] for r in m["excluded"]} == {R.EXCLUDED} and {r["status"] for r in m["unvalidated"]} == {R.UNVALIDATED})

# ── THE OPTIONAL STRICTER POLICY ────────────────────────────────────────────────────────────────────
print("\n--- requiring the edge to be demonstrated is a choice, off by default ---")
weak = verdict(34, 1.0, 26, 0.9)           # profitable but 60 trades with a thin edge
check("the fixture is profitable and NOT demonstrated", weak["expectancy_pct"] > 0 and weak["passed"] is False,
      f"{weak['expectancy_pct']} {weak['passed']}")
default = R.rank([cand("weak", weak)])
check("by default a profitable, undemonstrated candidate is ranked (master's ruling made profit the gate)",
      where(default, "weak")[0] == "ranked")
check("and the row says it did not pass, so the choice stays visible",
      default["ranked"][0]["measurement"]["demonstrated"] is False)
check("the notes say how many of the ranked cleared the test", any("cleared the deflated-Sharpe test" in n for n in default["notes"]))
strict = R.rank([cand("weak", weak)], require_demonstrated=True)
check("with the stricter policy it is excluded, with the reason", where(strict, "weak")[0] == "excluded"
      and "not distinguishable" in where(strict, "weak")[1]["reason"])
check("the policy in force is reported", strict["requireDemonstrated"] is True and default["requireDemonstrated"] is False)

# ── WORDING ─────────────────────────────────────────────────────────────────────────────────────────
print("\n--- wording ---")
text = " ".join(default["notes"] + m["notes"]).lower()
check("a hit rate is never called a probability of profit",
      "probability of profit" not in text and "chance of profit" not in text)
check("it says outright that a backtested hit rate is not a forecast", "not the probability of the next trade" in text)

# ── HOSTILE INPUT ───────────────────────────────────────────────────────────────────────────────────
print("\n--- hostile input ---")
check("an empty list ranks nothing and says nothing misleading",
      R.rank([])["ranked"] == [] and R.rank([])["notes"] == [])
junk = R.rank([None, 3, "x", [], cand("ok", good)])
check("non-dict entries are ignored, the real one is ranked", [r["id"] for r in junk["ranked"]] == ["ok"])
check("and the compared count excludes the junk", junk["candidatesCompared"] == 1)
odd = R.rank([cand("odd", {"trades": 100, "expectancy_pct": None, "win_rate": 0.9})])
check("a verdict with an undefined expectancy is excluded, not ranked",
      where(odd, "odd")[0] == "excluded" and "not defined" in where(odd, "odd")[1]["reason"])
nowin = R.rank([cand("nowin", {"trades": 100, "expectancy_pct": 0.5, "win_rate": None})])
check("a missing hit rate still ranks (last) rather than crashing", where(nowin, "nowin")[0] == "ranked")
check("the module is stdlib-only", "numpy" not in sys.modules and "pandas" not in sys.modules)

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
