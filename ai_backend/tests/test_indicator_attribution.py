"""
test_indicator_attribution.py — the attribution engine measures, and refuses to flatter (Section 172).

The properties proven here, in the order they matter:

  HONEST ABOUT NOISE    an indicator with no information gets no credit, and a column of pure noise
                        does not reach a share just because it was in the room
  ABSTENTION IS NOT A VOTE  a warm-up gap costs influence; it does not manufacture neutrality
  THE SEARCH IS COUNTED every candidate scored is charged to the gate, because the deflation is only
                        as honest as the trial count
  OUT OF SAMPLE         the combination is chosen on the search window and measured on the holdout;
                        the holdout is never consulted while choosing
  DETERMINISTIC         a given seed gives a given ranking, or the record could not be cited
  LOOK-AHEAD IS VISIBLE a leaked column produces an absurd score, which is the signature to recognise

Runs under pytest AND as a plain script, because this machine has Python 3.14 with no pytest and a
test that cannot be executed here is not a test:

    python ai_backend/tests/test_indicator_attribution.py
"""

from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))

import indicator_attribution as ia          # noqa: E402
import strategy_eval as se                   # noqa: E402

# Costs are switched OFF in most checks below so each one measures the property it names rather than
# the cost model. The two cost checks construct a real `CostModel()` on purpose.
NO_COST = se.CostModel(commission_pct=0.0, slippage_pct=0.0, spread_pct=0.0)


# ─── fixtures, built so the ANSWER IS KNOWN before the engine is asked ──────────────────────────────
def _returns(n, seed=7):
    rng = random.Random(seed)
    return [rng.gauss(0.0, 1.0) for _ in range(n)]


def _informative(returns, strength=1.0, seed=99):
    """
    A column that knows the sign of the next return `strength` of the time. The real signal.

    `seed` exists because a fixture built twice from the same seed produces the SAME column, so
    `{"x": col, "y": [-v for v in col]}` is a pair of exact opposites that blends to a flat position
    on every bar — no position, no score, and a test that fails for a reason that has nothing to do
    with what it was checking. Distinct seeds give columns that disagree without annihilating.
    """
    rng = random.Random(seed)
    return [(1.0 if r > 0 else -1.0) if rng.random() < strength else (-1.0 if r > 0 else 1.0)
            for r in returns]


def _noise(n, seed=3):
    rng = random.Random(seed)
    return [rng.choice([-1.0, 1.0]) for _ in range(n)]


# ─── validation ─────────────────────────────────────────────────────────────────────────────────────
def test_misaligned_columns_are_refused_not_padded():
    bad = ia.validate({"a": [1.0, -1.0]}, [0.1, 0.2, 0.3])
    assert bad and "align one-to-one" in bad


def test_empty_and_junk_inputs_are_refused():
    assert ia.validate({}, [1.0])
    assert ia.validate({"a": [1.0]}, [])
    assert ia.validate({"a": [1.0]}, [float("nan")])
    assert ia.validate({"a": [1.0]}, [None])
    assert ia.validate({"": [1.0]}, [0.5])
    assert ia.validate({"a": [1.0]}, [0.5]) is None          # the happy case really does pass


# ─── blending: the defect in strategy_scorer, restated as arithmetic ───────────────────────────────
def test_an_abstention_costs_influence_rather_than_inventing_neutrality():
    # One bullish indicator, two abstaining. The bull must read FULL strength, not one third.
    signals = {"bull": [1.0], "warming1": [ia.ABSTAIN], "warming2": [ia.ABSTAIN]}
    assert ia.blend(signals, ["bull", "warming1", "warming2"]) == [1.0]


def test_a_bar_where_everyone_abstains_is_flat():
    signals = {"a": [ia.ABSTAIN], "b": [ia.ABSTAIN]}
    assert ia.blend(signals, ["a", "b"]) == [0.0]


def test_disagreement_cancels():
    signals = {"a": [1.0], "b": [-1.0]}
    assert ia.blend(signals, ["a", "b"]) == [0.0]


def test_votes_are_clamped_and_junk_abstains():
    signals = {"a": [50.0], "b": [-50.0], "c": ["nonsense"], "d": [float("inf")]}
    assert ia.blend(signals, ["a"]) == [1.0]
    assert ia.blend(signals, ["b"]) == [-1.0]
    assert ia.blend(signals, ["c"]) == [0.0]      # unparseable reading abstains, never votes
    assert ia.blend(signals, ["d"]) == [0.0]


def test_the_clamp_is_applied_PER_VOTE_and_not_only_to_the_blend():
    # Mutation found this: asserting `blend(['a']) == [1.0]` for a vote of 50 passes even with the
    # per-vote clamp removed, because the final ratio is clamped anyway. The difference only shows
    # when an out-of-range vote is averaged AGAINST another — unclamped, one indicator shouting 50
    # drowns out a legitimate opposing vote instead of being capped at parity with it.
    signals = {"loud": [50.0], "quiet": [-1.0]}
    assert ia.blend(signals, ["loud", "quiet"]) == [0.0]


def test_weights_shift_the_blend_toward_the_heavier_indicator():
    signals = {"a": [1.0], "b": [-1.0]}
    heavy_a = ia.blend(signals, ["a", "b"], {"a": 3.0, "b": 1.0})[0]
    assert heavy_a > 0


def test_a_zero_weighted_indicator_cannot_influence_the_result():
    signals = {"a": [1.0], "b": [-1.0]}
    assert ia.blend(signals, ["a", "b"], {"a": 1.0, "b": 0.0}) == [1.0]


# ─── cost is charged on turnover, not per bar held ─────────────────────────────────────────────────
def test_holding_a_position_is_not_charged_a_round_trip_every_bar():
    cost = se.CostModel()
    held = ia.position_returns([1.0, 1.0, 1.0], [1.0, 1.0, 1.0], cost)
    flipped = ia.position_returns([1.0, -1.0, 1.0], [1.0, -1.0, 1.0], cost)
    # Same gross return on every bar; the flipping series must pay strictly more in costs.
    assert sum(held) > sum(flipped)


def test_a_flat_position_earns_and_costs_nothing():
    assert ia.position_returns([0.0, 0.0], [5.0, -5.0], se.CostModel()) == [0.0, 0.0]


# ─── permutation importance ────────────────────────────────────────────────────────────────────────
def test_an_informative_indicator_takes_the_credit_and_noise_does_not():
    rets = _returns(400)
    signals = {"real": _informative(rets, 0.70), "noise": _noise(400)}
    out = ia.permutation_importance(signals, ["real", "noise"], rets, repeats=25, cost=NO_COST)
    assert out["ok"], out.get("reason")
    assert out["importance"]["real"]["dropMean"] > out["importance"]["noise"]["dropMean"]
    assert out["importance"]["real"]["share"] > 50.0


def test_a_harmful_indicator_gets_zero_share_rather_than_a_negative_one():
    rets = _returns(400)
    # Deliberately inverted: it knows the answer and says the opposite.
    signals = {"inverted": [-s for s in _informative(rets, 0.75)]}
    out = ia.permutation_importance(signals, ["inverted"], rets, repeats=20, cost=NO_COST)
    assert out["ok"]
    rec = out["importance"]["inverted"]
    assert rec["harmful"] is True
    assert rec["share"] == 0.0          # never a negative percentage, never positive credit


def test_shares_of_contributing_indicators_total_one_hundred():
    rets = _returns(400)
    signals = {"a": _informative(rets, 0.68), "b": _informative(rets, 0.60), "c": _noise(400)}
    out = ia.permutation_importance(signals, ["a", "b", "c"], rets, repeats=20, cost=NO_COST)
    total = sum(v["share"] for v in out["importance"].values() if v["share"])
    assert abs(total - 100.0) < 0.5


def test_it_is_deterministic_for_a_given_seed_and_moves_with_a_different_one():
    rets = _returns(300)
    signals = {"a": _informative(rets, 0.65), "b": _noise(300)}
    first = ia.permutation_importance(signals, ["a", "b"], rets, repeats=10, seed=1, cost=NO_COST)
    again = ia.permutation_importance(signals, ["a", "b"], rets, repeats=10, seed=1, cost=NO_COST)
    other = ia.permutation_importance(signals, ["a", "b"], rets, repeats=10, seed=2, cost=NO_COST)
    assert first["importance"]["a"]["dropMean"] == again["importance"]["a"]["dropMean"]
    assert first["importance"]["a"]["dropMean"] != other["importance"]["a"]["dropMean"]


def test_an_indicators_measurement_does_not_depend_on_its_POSITION_in_the_list():
    # Mutation found the hole: comparing {"a"} against {"a","b"} while measuring only ["a"] draws the
    # same shuffle sequence either way, so a single shared generator survived. Measuring the SAME two
    # indicators in a different ORDER is what exposes it — with one generator seeded once, whoever is
    # permuted second gets different draws, and a ranking would then depend on list order.
    rets = _returns(300)
    signals = {"a": _informative(rets, 0.66), "b": _noise(300)}
    forward = ia.permutation_importance(signals, ["a", "b"], rets, repeats=8, seed=5, cost=NO_COST)
    reverse = ia.permutation_importance(signals, ["b", "a"], rets, repeats=8, seed=5, cost=NO_COST)
    assert forward["importance"]["a"]["dropMean"] == reverse["importance"]["a"]["dropMean"]
    assert forward["importance"]["b"]["dropMean"] == reverse["importance"]["b"]["dropMean"]


def test_each_indicator_gets_its_OWN_shuffle_sequence():
    # Position-independence above does not prove independence: re-seeding one generator with the same
    # seed inside the loop is also position-independent, and it hands EVERY indicator the identical
    # permutation, which correlates all the measurements. Two identical columns is what exposes it —
    # with per-id seeding their drops differ; with one shared seed they come out exactly equal.
    rets = _returns(400)
    col = _informative(rets, 0.68)
    signals = {"twin_a": list(col), "twin_b": list(col)}
    out = ia.permutation_importance(signals, ["twin_a", "twin_b"], rets, repeats=15, cost=NO_COST)
    assert out["ok"], out.get("reason")
    assert out["importance"]["twin_a"]["dropMean"] != out["importance"]["twin_b"]["dropMean"]


def test_only_positive_contributions_form_the_denominator_of_the_shares():
    # Mutation found this: with every candidate helpful, including negative drops in the denominator
    # barely moves the shares. A harmful column alongside a useful one is what exposes it — summed
    # in, the denominator shrinks and the useful indicator's share inflates past 100%.
    rets = _returns(500)
    # Built from DIFFERENT seeds so the pair disagrees without cancelling to a flat position.
    signals = {"good": _informative(rets, 0.78, seed=99),
               "inverted": [-s for s in _informative(rets, 0.70, seed=7)]}
    out = ia.permutation_importance(signals, ["good", "inverted"], rets, repeats=20, cost=NO_COST)
    assert out["ok"], out.get("reason")
    assert out["importance"]["inverted"]["harmful"] is True
    assert out["importance"]["inverted"]["share"] == 0.0
    # The only contributor therefore holds all of the credit — exactly 100%, not more.
    assert abs(out["importance"]["good"]["share"] - 100.0) < 0.01


def test_distinguishable_reports_exactly_the_documented_predicate():
    # The first version of this check fed pure noise and asserted `distinguishable is False`, which
    # depended on one seed's luck and passed or failed for no reason the test could explain. What is
    # actually worth pinning is that the flag IS the documented predicate — mean fall larger than the
    # shuffle-to-shuffle spread — for every indicator in a mixed run.
    rets = _returns(400)
    signals = {"real": _informative(rets, 0.72), "noise": _noise(400), "weak": _informative(rets, 0.53)}
    out = ia.permutation_importance(signals, list(signals), rets, repeats=20, cost=NO_COST)
    assert out["ok"]
    for sid, rec in out["importance"].items():
        expected = bool(rec["dropSd"] > 0 and abs(rec["dropMean"]) > rec["dropSd"])
        assert rec["distinguishable"] is expected, sid
    # Non-vacuous: a genuinely informative column clears its own spread.
    assert out["importance"]["real"]["distinguishable"] is True


def test_a_worthless_indicator_is_measured_at_zero_rather_than_unmeasurable():
    # 0% means "measured, contributed nothing"; None means "could not be measured". Collapsing the
    # two would hide the most useful reading this engine produces.
    rets = _returns(400)
    signals = {"inverted": [-s for s in _informative(rets, 0.75)]}
    out = ia.permutation_importance(signals, ["inverted"], rets, repeats=20, cost=NO_COST)
    assert out["anyContributed"] is False
    assert out["importance"]["inverted"]["share"] == 0.0


def test_an_unknown_indicator_is_refused():
    assert ia.permutation_importance({"a": [1.0]}, ["ghost"], [0.5])["ok"] is False
    assert ia.permutation_importance({"a": [1.0]}, [], [0.5])["ok"] is False


# ─── greedy search, and the trial count ────────────────────────────────────────────────────────────
def test_the_search_counts_every_candidate_it_scored():
    rets = _returns(300)
    signals = {f"i{k}": _noise(300, seed=k) for k in range(5)}
    signals["real"] = _informative(rets, 0.70)
    out = ia.greedy_combination(signals, rets, max_size=3, cost=NO_COST)
    assert out["ok"]
    # Greedy over a pool of 6 for up to 3 picks examines 6 then 5 then 4 — never merely 3.
    assert out["trials"] >= out["poolSize"]
    assert out["trials"] > len(out["selected"])


def test_the_search_finds_the_informative_column_first():
    rets = _returns(400)
    signals = {f"n{k}": _noise(400, seed=k) for k in range(4)}
    signals["real"] = _informative(rets, 0.72)
    out = ia.greedy_combination(signals, rets, max_size=3, cost=NO_COST)
    assert out["selected"][0] == "real"


def test_the_search_stops_when_adding_does_not_help_and_says_so():
    # Unconditional now. The earlier version wrapped its real assertion in `if stopped:`, so when the
    # stop was removed entirely the test passed by checking nothing — the vacuous-test shape Section
    # 169.2 names as a standing rule.
    rets = _returns(400)
    signals = {"real": _informative(rets, 0.95), "n1": _noise(400, 1), "n2": _noise(400, 2)}
    out = ia.greedy_combination(signals, rets, max_size=3, cost=NO_COST)
    assert out["selected"] == ["real"], out["selected"]
    stopped = [s for s in out["steps"] if s.get("added") is False]
    assert stopped, "the search filled its cap with indicators that did not help"
    assert "did not improve" in stopped[0]["why"]


def test_the_combination_is_capped_however_large_the_pool():
    rets = _returns(300)
    signals = {f"i{k}": _informative(rets, 0.6 + k * 0.01) for k in range(12)}
    out = ia.greedy_combination(signals, rets, max_size=99, cost=NO_COST)
    assert len(out["selected"]) <= ia.MAX_COMBINATION
    # The cap itself is asserted, not only its effect: a pool of 12 and max_size 99 must still
    # resolve to the declared ceiling. Mutation found that checking the effect alone passes whenever
    # greedy happens to stop early for an unrelated reason.
    assert out["cap"] <= ia.MAX_COMBINATION
    assert out["poolSize"] == 12


# ─── the composed measurement ──────────────────────────────────────────────────────────────────────
def test_attribute_splits_and_measures_on_the_holdout():
    rets = _returns(600)
    signals = {"real": _informative(rets, 0.68), "n": _noise(600)}
    out = ia.attribute(signals, rets, repeats=10, cost=NO_COST)
    assert out["ok"], out.get("reason")
    assert out["search"]["bars"] + out["holdout"]["bars"] == 600
    assert out["holdout"]["bars"] > 0
    assert out["verdict"]["provenance"]["measuredOn"] == "holdout"
    # `measuredOn` is a string THIS module writes, so it survives `is_holdout` being flipped.
    # `evaluatedOn` is written by `strategy_eval` from `is_holdout` itself, so it is the field that
    # actually pins the flag. Mutation found that distinction.
    assert out["verdict"]["provenance"]["evaluatedOn"] == "holdout"


def _two_window_fixture(n=600, seed=31):
    """
    A series whose two halves disagree on purpose: `early` carries the signal in the search window
    and noise in the holdout, `late` the reverse.

    This is what makes the out-of-sample checks below DISCRIMINATING. Against a fixture where both
    windows agree, choosing on the search window and choosing on the whole series give the same
    answer, so a test comparing them passes whether the split is honoured or not — which is exactly
    how two mutations survived the first version of these tests.
    """
    rets = _returns(n, seed)
    end, _ = se.holdout_split(n, se.DEFAULT_HOLDOUT_FRAC)
    sign = [1.0 if r > 0 else -1.0 for r in rets]
    noise_a, noise_b = _noise(n, 41), _noise(n, 42)

    # The STRENGTHS are chosen so the two searches genuinely disagree, and the arithmetic is worth
    # stating. The split is 70/30. `early` is only weakly right (0.56) across the search window, an
    # edge of about 0.7 x 0.12 = 0.084 over the whole series. `late` is exactly right across the
    # holdout, an edge of about 0.3 x 1.0 = 0.30. So a search over the WHOLE series prefers `late`,
    # while a search restricted to the search window — where `late` is pure noise — prefers `early`.
    # A fixture whose halves merely differ is not enough; the preference has to flip.
    weak = _informative(rets, 0.56, seed=17)
    early = [weak[i] if i < end else noise_a[i] for i in range(n)]
    late = [noise_b[i] if i < end else sign[i] for i in range(n)]
    return rets, end, {"early": early, "late": late}


def test_the_combination_is_chosen_on_the_SEARCH_WINDOW_ONLY():
    # THE PROPERTY THE WHOLE DESIGN RESTS ON. A holdout consulted while choosing has already become
    # training data.
    rets, end, signals = _two_window_fixture()
    out = ia.attribute(signals, rets, repeats=5, cost=NO_COST)
    assert out["ok"], out.get("reason")
    assert 0 < end < len(rets)

    on_search = ia.greedy_combination({k: v[:end] for k, v in signals.items()}, rets[:end],
                                      max_size=ia.MAX_COMBINATION, cost=NO_COST)
    on_everything = ia.greedy_combination(signals, rets, max_size=ia.MAX_COMBINATION, cost=NO_COST)

    # NON-VACUITY, asserted rather than hoped for: the fixture must actually distinguish the two.
    assert on_search["selected"] != on_everything["selected"], \
        "fixture does not discriminate, so this test would pass either way"
    assert out["selected"] == on_search["selected"]
    assert out["search"]["trials"] == on_search["trials"]


def test_importance_is_measured_on_the_HOLDOUT_the_search_never_saw():
    # Pinned by EXACT EQUALITY against an independent measurement on the holdout slice, rather than
    # by a conditional about which column won. The earlier version branched on the selection and had
    # a path where it asserted nothing at all, so the mutation that measured importance on the
    # search window survived it.
    rets, end, signals = _two_window_fixture()
    out = ia.attribute(signals, rets, repeats=10, seed=3, cost=NO_COST)
    assert out["ok"], out.get("reason")
    assert out["importance"] is not None

    hold = {k: v[end:] for k, v in signals.items()}
    on_holdout = ia.permutation_importance(hold, out["selected"], rets[end:],
                                           repeats=10, seed=3, cost=NO_COST)
    on_search = ia.permutation_importance({k: v[:end] for k, v in signals.items()},
                                          out["selected"], rets[:end],
                                          repeats=10, seed=3, cost=NO_COST)
    assert on_holdout["ok"] and on_search["ok"]
    for sid in out["selected"]:
        assert out["importance"][sid]["dropMean"] == on_holdout["importance"][sid]["dropMean"], sid
    # NON-VACUITY: the two windows really do give different answers here, so matching the holdout
    # is a meaningful fact rather than an accident of identical numbers.
    assert any(on_holdout["importance"][s]["dropMean"] != on_search["importance"][s]["dropMean"]
               for s in out["selected"])


def test_the_gate_is_charged_the_whole_search_including_declared_outside_trials():
    rets = _returns(600)
    signals = {f"n{k}": _noise(600, seed=k) for k in range(4)}
    plain = ia.attribute(signals, rets, repeats=5, cost=NO_COST)
    declared = ia.attribute(signals, rets, repeats=5, cost=NO_COST, extra_trials=5000)
    assert declared["trialsCharged"] == plain["search"]["trials"] + 5000
    assert declared["verdict"]["n_trials"] == declared["trialsCharged"]
    # And charging a huge search makes the gate harder, never easier.
    assert declared["verdict"]["benchmark_sharpe"] > plain["verdict"]["benchmark_sharpe"]


def test_pure_noise_does_not_pass_the_gate():
    rets = _returns(600, seed=11)
    signals = {f"n{k}": _noise(600, seed=k) for k in range(6)}
    out = ia.attribute(signals, rets, repeats=5, cost=NO_COST)
    assert out["ok"]
    assert out["verdict"]["passed"] is False


def test_the_equal_weight_baseline_is_always_reported_for_comparison():
    rets = _returns(600)
    signals = {"a": _informative(rets, 0.66), "b": _informative(rets, 0.62)}
    out = ia.attribute(signals, rets, repeats=10, cost=NO_COST)
    assert out["holdout"]["perBarSharpeEqual"] is not None
    assert "weightedBeatsEqual" in out["holdout"]
    assert sum(out["equalWeight"].values()) > 99.0
    # And when weighting does not win, the notes say so rather than presenting it as an improvement.
    if not out["holdout"]["weightedBeatsEqual"]:
        assert any("did NOT beat equal weight" in n for n in out["notes"])


def test_it_never_emits_a_composite_score_or_a_grade():
    rets = _returns(600)
    signals = {"a": _informative(rets, 0.66), "n": _noise(600)}
    out = ia.attribute(signals, rets, repeats=5, cost=NO_COST)
    flat = repr(out).lower()
    for forbidden in ("compositescore", "grade", "overallconfidence", "a+"):
        assert forbidden not in flat, forbidden


def test_the_record_warns_that_a_contribution_is_not_a_forward_probability():
    rets = _returns(600)
    out = ia.attribute({"a": _informative(rets, 0.66)}, rets, repeats=5, cost=NO_COST)
    assert any("not the probability" in n for n in out["notes"])


def test_too_little_history_is_refused_rather_than_split_into_nothing():
    assert ia.attribute({"a": [1.0]}, [0.5], cost=NO_COST)["ok"] is False


def test_a_leaked_column_produces_an_absurd_score_which_is_the_signature_to_recognise():
    # THE LOOK-AHEAD CHECK. `validate` cannot detect a leak — no function can — so this test shows
    # what one LOOKS like, so a reader meeting a Sharpe of this size knows to suspect the alignment
    # rather than celebrate. A column that already knows the answer scores far beyond anything real.
    rets = _returns(600)
    leaked = {"oracle": [1.0 if r > 0 else -1.0 for r in rets]}
    out = ia.attribute(leaked, rets, repeats=5, cost=NO_COST)
    assert out["ok"]
    assert out["holdout"]["perBarSharpeEqual"] > 1.0      # no honest indicator reaches this per bar


# ─── runner, so this executes on a machine with no pytest ──────────────────────────────────────────
def _main():
    tests = [(n, o) for n, o in sorted(globals().items())
             if n.startswith("test_") and callable(o)]
    passed = failed = 0
    print(f"\nindicator attribution — {len(tests)} behavioural checks\n")
    import traceback
    for name, fn in tests:
        try:
            fn()
            passed += 1
            print(f"  PASS  {name}")
        except Exception as e:                                  # noqa: BLE001
            failed += 1
            # The failing LINE, not just the message. A bare `assert` carries no message, and the
            # first version of this runner printed an empty string for exactly the failure that was
            # hardest to diagnose — which cost a round trip working out why a test that passed when
            # called directly failed inside the runner.
            tb = traceback.extract_tb(sys.exc_info()[2])
            where = f" at line {tb[-1].lineno}: {tb[-1].line}" if tb else ""
            print(f"  FAIL  {name} — {type(e).__name__}: {e}{where}")
    print(f"\n{passed} passed, {failed} failed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
