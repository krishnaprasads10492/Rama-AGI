"""
test_strategy_eval.py — does the harness actually refuse noise? (spec Section 95)

The two assertions this suite exists for:

    A SEARCH OVER PURE NOISE MUST BE REJECTED, even though its best variant looks excellent.
    A STRATEGY WITH A PLANTED EDGE MUST BE FOUND, or the harness is merely pessimistic.

A harness that rejects everything is as useless as one that accepts everything; both are tested.

Stdlib only, like the module. Run:  python -m tests.test_strategy_eval   (from ai_backend/)
"""

from __future__ import annotations

import math
import random
import sys

import pathlib

# IMPORTED AS A TOP-LEVEL MODULE, NOT AS `engine.strategy_eval`, and that is deliberate.
#
# `engine/__init__.py` imports the dispatcher, which imports numpy. Going through the package would
# require the whole scientific stack to test a module that needs none of it — and where numpy is not
# installed the suite would be unrunnable for a reason unrelated to what it tests.
#
# This also PROVES the stdlib-only claim: if a numpy import ever creeps into `strategy_eval.py`, this
# import fails immediately and loudly.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import strategy_eval as _se   # noqa: E402

CostModel = _se.CostModel
Verdict = _se.Verdict
holdout_split = _se.holdout_split
purged_walk_forward = _se.purged_walk_forward
sharpe = _se.sharpe
expected_max_sharpe = _se.expected_max_sharpe
deflated_sharpe = _se.deflated_sharpe
max_drawdown = _se.max_drawdown
evaluate = _se.evaluate
search_and_judge = _se.search_and_judge
MIN_TRADES = _se.MIN_TRADES
MIN_TRADES_CONFIDENT = _se.MIN_TRADES_CONFIDENT
DSR_THRESHOLD = _se.DSR_THRESHOLD

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


# ── Splitting ─────────────────────────────────────────────────────────────────
def test_splits() -> None:
    print("\n  holdout and purged walk-forward")

    end, total = holdout_split(1000, 0.30)
    check("the holdout is the FINAL segment, because strategies run forward in time",
          end == 700 and total == 1000, f"{end}/{total}")
    check("a tiny series still yields a usable search window",
          holdout_split(2, 0.30)[0] >= 1)
    check("an empty series yields an empty split", holdout_split(0) == (0, 0))
    check("an absurd holdout fraction is clamped rather than erasing the search window",
          holdout_split(100, 0.99)[0] >= 1)

    folds = purged_walk_forward(1000, folds=5, label_horizon=10, embargo_frac=0.01)
    check("folds are produced", len(folds) == 4, str(len(folds)))
    check("training always ends before its test fold begins",
          all(f.train[1] <= f.test[0] for f in folds))
    # THE LEAK THIS PREVENTS: a label at index i is built from bars up to i+horizon, so without
    # purging, training rows near the boundary already contain test-window information.
    check("the label horizon plus embargo is purged from the end of training",
          all(f.test[0] - f.train[1] >= 10 for f in folds),
          str([f.test[0] - f.train[1] for f in folds]))
    check("purge and embargo amounts are reported, not silent",
          all(f.purged == 10 and f.embargoed == 10 for f in folds))
    check("no fold trains on its own future",
          all(f.train[0] == 0 and f.train[1] <= f.test[0] for f in folds))
    check("the final fold reaches the end of the series", folds[-1].test[1] == 1000)
    check("a series too short to fold yields nothing rather than a bogus split",
          purged_walk_forward(3, folds=5) == [])
    check("zero folds yields nothing", purged_walk_forward(100, folds=0) == [])


# ── The noise benchmark ───────────────────────────────────────────────────────
def test_noise_benchmark() -> None:
    print("\n  the benchmark a search must beat")

    check("a single pre-specified strategy has a zero benchmark",
          expected_max_sharpe(1) == 0.0)
    # This is the number that makes the module honest: searching harder raises the bar.
    check("trying more variants raises the bar",
          expected_max_sharpe(1000) > expected_max_sharpe(100) > expected_max_sharpe(10))
    check("1000 trials of pure noise are expected to produce a Sharpe above 3",
          expected_max_sharpe(1000) > 3.0, f"{expected_max_sharpe(1000):.2f}")

    # A Sharpe of 2.0 is impressive alone and unremarkable as the best of 5000 tries.
    solo = deflated_sharpe(2.0, n_obs=200, n_trials=1)
    searched = deflated_sharpe(2.0, n_obs=200, n_trials=5000)
    check("the same Sharpe is credible when pre-specified", solo is not None and solo > 0.95,
          f"{solo}")
    check("and NOT credible as the best of 5000 tries", searched is not None and searched < 0.5,
          f"{searched}")
    check("deflation refuses to answer on too few observations",
          deflated_sharpe(2.0, n_obs=1, n_trials=10) is None)
    # Fat tails widen the error bars, so the same Sharpe means less.
    check("fat-tailed returns reduce confidence at equal Sharpe",
          deflated_sharpe(1.5, 200, 1, 0.0, 12.0) < deflated_sharpe(1.5, 200, 1, 0.0, 3.0))


# ── Metrics ───────────────────────────────────────────────────────────────────
def test_metrics() -> None:
    print("\n  metrics")

    check("sharpe needs at least two points", sharpe([0.5]) is None)
    # A constant return series is a backtest bug, not a riskless strategy.
    check("a zero-variance series is refused rather than given an infinite Sharpe",
          sharpe([1.0] * 50) is None)
    check("a positive drifting series has a positive Sharpe",
          (sharpe([0.4, 0.5, 0.6, 0.45, 0.55] * 10) or 0) > 0)
    check("drawdown of a monotonic rise is zero", max_drawdown([1, 2, 3, 4]) == 0.0)
    check("drawdown is measured peak to trough",
          abs(max_drawdown([100, 120, 60, 80]) - 0.5) < 1e-9,
          str(max_drawdown([100, 120, 60, 80])))


# ── Costs ─────────────────────────────────────────────────────────────────────
def test_costs() -> None:
    print("\n  costs")

    c = CostModel()
    # A zero default is how a caller who forgets costs gets a flattering answer.
    check("costs default to a non-zero round trip", c.round_trip_pct() > 0)
    check("costs are subtracted from gross", c.apply(1.0) < 1.0)

    # The case that flatters high-frequency permutations most: a genuine but tiny gross edge, many
    # trades. Varying returns, because a constant series is correctly caught earlier as a bug.
    rng = random.Random(7)
    drag = CostModel().round_trip_pct()
    gross = [rng.gauss(drag * 0.5, 0.6) for _ in range(200)]   # mean edge = half the cost
    v = evaluate(gross, n_trials=1, cost_model=CostModel())
    check("a gross edge smaller than the cost drag is rejected",
          not v.passed and "after costs" in v.reason, v.reason)
    check("and the explanation quotes both the gross and net figures",
          "becomes" in v.meaning and "round-trip" in v.meaning, v.meaning)
    check("the same edge survives when costs are genuinely zero, proving costs caused the rejection",
          evaluate(gross, n_trials=1, cost_model=CostModel(0.0, 0.0, 0.0)).net_sharpe > 0)


# ── Evidence floor ────────────────────────────────────────────────────────────
def test_evidence_floor() -> None:
    print("\n  the evidence floor comes before any metric")

    few = [1.0, -0.5, 2.0, 0.8, -0.3] * 4      # 20 trades, healthy-looking
    v = evaluate(few, n_trials=1)
    check("too few trades is refused outright", not v.passed)
    check("the reason is insufficient evidence, not a bad metric",
          "insufficient evidence" in v.reason, v.reason)
    check("no win rate is presented as meaningful", v.confidence == "none")
    check("the remedy names the required trade count",
          str(MIN_TRADES) in " ".join(v.would_change), str(v.would_change))

    v0 = evaluate([], n_trials=10)
    check("no trades at all is handled", not v0.passed and v0.trades == 0)
    check("and explained rather than left blank", len(v0.meaning) > 20)

    strong = [2.0, -0.8] * 25                  # 50 trades
    v2 = evaluate(strong, n_trials=1)
    check("between the floors, a verdict is provisional",
          v2.confidence == "provisional", v2.confidence)
    check("and says so in words master will read",
          "Provisional" in v2.meaning or "lead" in v2.meaning, v2.meaning)

    many = [2.0, -0.8] * 60                    # 120 trades
    v3 = evaluate(many, n_trials=1)
    check("above the confident floor, a verdict is measured",
          v3.confidence == "measured", v3.confidence)


# ── THE TWO ASSERTIONS THIS SUITE EXISTS FOR ──────────────────────────────────
def _noise_runner(seed: int):
    """
    Every variant is pure noise: no variant has any edge whatsoever.

    THE SEED INCLUDES `start`, and that detail is the difference between a real test and a fake one.
    Seeding on the variant id alone makes a variant produce the same sequence in every window, so the
    holdout is a copy of the search data and no degradation can appear — an earlier version of this
    fixture did exactly that and reported in-sample 1.72 against holdout 1.70, hiding the effect it
    was written to demonstrate. Including `start` makes the holdout genuinely different data, which is
    what a later period is.
    """
    def run(variant, start, end):
        # A STRING seed, not a tuple: Python 3.14 accepts only None, int, float, str, bytes and
        # bytearray, and a tuple raises TypeError.
        rng = random.Random(f"noise-{seed}-{variant['id']}-{start}")
        n = max(0, end - start)
        # ~1 trade every 4 bars, zero-mean returns, realistic dispersion.
        return [rng.gauss(0.0, 1.5) for _ in range(n // 4)]
    return run


def _edge_runner(seed: int, edge_variant: int):
    """One variant has a genuine, persistent edge; the rest are noise."""
    def run(variant, start, end):
        rng = random.Random(f"edge-{seed}-{variant['id']}-{start}")
        n = max(0, end - start)
        count = n // 4
        mu = 0.9 if variant["id"] == edge_variant else 0.0
        return [rng.gauss(mu, 1.2) for _ in range(count)]
    return run


def test_rejects_noise() -> None:
    print("\n  A SEARCH OVER PURE NOISE MUST BE REJECTED")

    variants = [{"id": i} for i in range(400)]
    res = search_and_judge(variants, _noise_runner(11), n=4000, holdout_frac=0.30)

    check("the search ran and reported its trial count",
          res["ok"] and res["trials"] == 400, str(res.get("trials")))

    # THE DATA-SNOOPING EFFECT, MEASURED — and measured with costs OFF, deliberately.
    #
    # With realistic costs the drag (~0.18% a round trip) is larger than anything 400 noise variants
    # can conjure, so every variant scores negative and in-sample and holdout come out nearly equal:
    # -0.17 against -0.18. Costs already killed it, which is reassuring but demonstrates nothing about
    # selection bias. Removing costs isolates the effect being tested.
    free = search_and_judge([{"id": i} for i in range(400)], _noise_runner(11),
                            n=4000, holdout_frac=0.30,
                            cost_model=CostModel(0.0, 0.0, 0.0))
    free_holdout = free["holdout"].get("net_sharpe")

    check("400 tries against pure noise yield a flattering in-sample Sharpe",
          free["searchSharpe"] > 1.0, f"{free['searchSharpe']:.2f}")
    check("the SAME variant is markedly worse out-of-sample — this gap IS the bias",
          free_holdout is None or free["searchSharpe"] > free_holdout + 0.5,
          f"in-sample={free['searchSharpe']:.2f} holdout={free_holdout}")
    check("and it is rejected despite the flattering in-sample number",
          free["holdout"]["passed"] is False, str(free["holdout"]["reason"]))

    check("but the holdout verdict REJECTS it",
          res["holdout"]["passed"] is False,
          f"sharpe={res['holdout'].get('net_sharpe')} dsr={res['holdout'].get('deflated')}")
    check("the in-sample number is explicitly labelled as not evidence",
          "NOT evidence" in res["note"], res["note"])
    check("the holdout was evaluated as a holdout",
          res["holdout"]["provenance"]["evaluatedOn"] == "holdout")
    check("the trial count travels with the verdict",
          res["holdout"]["n_trials"] == 400)


def test_finds_planted_edge() -> None:
    print("\n  A PLANTED EDGE MUST BE FOUND (or the harness is just pessimistic)")

    variants = [{"id": i} for i in range(40)]
    res = search_and_judge(variants, _edge_runner(23, edge_variant=17), n=8000, holdout_frac=0.30)

    check("the search found the variant carrying the edge",
          res["ok"] and res["variant"]["id"] == 17, str(res.get("variant")))
    check("the holdout ACCEPTS a real edge",
          res["holdout"]["passed"] is True,
          f"reason={res['holdout']['reason']} dsr={res['holdout'].get('deflated')}")
    check("and reports it as measured, not provisional",
          res["holdout"]["confidence"] == "measured", res["holdout"]["confidence"])
    check("the verdict quotes the noise benchmark it had to clear",
          res["holdout"]["benchmark_sharpe"] > 0)
    check("a passing verdict still carries risks rather than reading as a green light",
          len(res["holdout"]["risks"]) >= 2, str(res["holdout"]["risks"]))
    # The distinction most easily blurred, so it is stated on every passing verdict.
    check("it states that a backtested win rate is not a forward probability",
          any("forward-looking probability" in r for r in res["holdout"]["risks"]),
          str(res["holdout"]["risks"]))


def test_communication_shape() -> None:
    print("\n  communication, not a data dump")

    v = evaluate([2.0, -0.8] * 60, n_trials=1, provenance={"model": "qwen3.5:27b", "version": "1"})
    check("every verdict explains what it means", len(v.meaning) > 40)
    check("every verdict names what would change it", len(v.would_change) >= 1)
    check("a passing verdict still names its risks", len(v.risks) >= 1)
    # Master's requirement: the generating model is recorded so a better one can be compared later.
    check("provenance is carried through so a later model can be compared",
          v.provenance.get("model") == "qwen3.5:27b", str(v.provenance))
    check("where it was evaluated is recorded",
          v.provenance.get("evaluatedOn") == "search-window", str(v.provenance))
    check("a search-window result says it is not yet out-of-sample",
          any("out-of-sample" in r for r in v.risks), str(v.risks))
    check("the verdict serialises for IPC", isinstance(v.to_dict(), dict))

    # n_trials is keyword-only and has no default: a caller who does not know it does not know
    # whether the result means anything.
    try:
        evaluate([1.0] * 40)          # type: ignore[call-arg]
        check("n_trials cannot be omitted", False, "call succeeded without n_trials")
    except TypeError:
        check("n_trials cannot be omitted", True)


def test_search_guards() -> None:
    print("\n  search guards")

    check("no variants is refused",
          search_and_judge([], _noise_runner(1), n=1000)["ok"] is False)

    def empty_run(variant, start, end):
        return []
    res = search_and_judge([{"id": 1}], empty_run, n=1000)
    check("variants that never trade are refused rather than ranked",
          res["ok"] is False and "measurable" in res["reason"], str(res))

    # The safeguard: the search must only ever see the pre-holdout window.
    seen: list[tuple[int, int]] = []

    def spy(variant, start, end):
        seen.append((start, end))
        rng = random.Random(variant["id"])
        return [rng.gauss(0.1, 1.0) for _ in range((end - start) // 4)]

    search_and_judge([{"id": i} for i in range(5)], spy, n=1000, holdout_frac=0.30)
    search_calls = seen[:-1]
    holdout_call = seen[-1]
    check("every search call stayed inside the pre-holdout window",
          all(s == 0 and e == 700 for s, e in search_calls), str(search_calls))
    check("exactly ONE holdout evaluation happened, on the winner only",
          holdout_call == (700, 1000) and len(search_calls) == 5, str(seen))


def main() -> int:
    print("\nstrategy_eval — refusing noise, finding real edges\n")
    test_splits()
    test_noise_benchmark()
    test_metrics()
    test_costs()
    test_evidence_floor()
    test_rejects_noise()
    test_finds_planted_edge()
    test_communication_shape()
    test_search_guards()
    print(f"\n  {_pass} passed, {_fail} failed\n")
    return 1 if _fail else 0


if __name__ == "__main__":
    sys.exit(main())
