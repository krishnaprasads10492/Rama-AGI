"""
indicator_attribution.py — which indicator is actually contributing, measured (spec Section 172).

Master's ask, verbatim: *"which indicator is predicting best ... sometimes the combinations of indicator
can explain the better flow and the required parameters have to be figured from data alone ... which %
of weightage can be obtained from each indicator in the combination."*

WHAT THIS REPLACES. `strategy_scorer.compute_composite_score` already returns that exact shape — ten
algorithms each with a `weight` percentage. Its weights are `regime_weights`: four hand-written dicts
with no fitting and no backtest behind them, and every algorithm has an `except` branch substituting
`score: 50, confidence: 0`, so a BROKEN indicator casts a neutral vote at full weight. This module is
the honest half: the weight is the measured out-of-sample contribution, or there is no weight.

HOW A CONTRIBUTION IS MEASURED. Permutation importance. Shuffle one indicator's signal column, hold
everything else fixed, and measure how much out-of-sample performance falls. The fall IS the
contribution. It needs no new dependency — only a seeded shuffle — which matters because I12 pins
dependencies and prefers none.

WHY THE TRIAL COUNT IS THE MOST IMPORTANT NUMBER HERE (172.2). Searching parameters and combinations
manufactures false edges: the best of K zero-edge candidates looks excellent by construction. The
defence this project already owns is `strategy_eval.evaluate`, whose `n_trials` is keyword-only and
required, and which deflates the Sharpe by it. So EVERY candidate examined is counted and threaded
through — not the number of finalists, which is the lie that makes a search look like a hypothesis.
The MinervaScore result is the cautionary case: a composite grade that separated signal from luck at
AUROC 0.989 on synthetic data carried no significant forward relationship on unseen real market data.

WHAT IT REFUSES TO EMIT. No composite score, no letter grade, no forward-looking probability. A
measured contribution describes the past, which is all a backtest can describe. `claimGate` forbids a
number on a sentence and `verifyClaimGate` asserts it; this module's output is built to be a reflex
record that can be cited, carrying every figure at the precision it will be quoted.

STDLIB ONLY, like `strategy_eval` and `strategy_rank`, so it runs on any interpreter and is testable
without pandas. It reads no bars and fetches nothing: signals and forward returns come from the caller.
"""

from __future__ import annotations

import math
import random
from typing import Callable, Mapping, Optional, Sequence

try:                                    # pragma: no cover - import shape, not logic
    from . import strategy_eval as _se
except Exception:                       # pragma: no cover
    import strategy_eval as _se

MIN_TRADES = _se.MIN_TRADES

# How many shuffles per indicator. One shuffle is a single draw from a noisy distribution and would
# rank indicators by luck; the mean over repeats is the estimate, and its spread is reported so master
# can see when two indicators are not actually distinguishable.
DEFAULT_REPEATS = 20

# A combination beyond this many indicators is not interpretable by a human reading a checkbox panel,
# and each addition multiplies the search. Greedy selection stops here even if score still improves.
MAX_COMBINATION = 4

# Greedy selection keeps an indicator only if it improves the out-of-sample score by more than this.
# Zero would admit noise-sized improvements, which is how a four-indicator combination becomes three
# indicators and one coin.
MIN_IMPROVEMENT = 1e-9

# A vote outside this range is a bug in the caller, not a strong opinion.
VOTE_FLOOR, VOTE_CEIL = -1.0, 1.0

ABSTAIN = None   # an indicator with no reading for a bar. NOT zero-the-vote: see `blend`.


# ─── the contract ───────────────────────────────────────────────────────────────────────────────────
def validate(signals: Mapping[str, Sequence[Optional[float]]],
             forward_returns: Sequence[float]) -> Optional[str]:
    """
    Why this data cannot be measured, or None if it can.

    THE ALIGNMENT RULE, AND IT IS THE ONE THAT MATTERS: `signals[id][i]` is what the indicator said
    using bars up to and including `i`, and `forward_returns[i]` is what happened AFTER bar `i`. A
    caller that passes the return of bar `i` itself has built a look-ahead and every number below will
    be excellent and worthless. This function cannot detect that — no function can — so it is stated
    here and asserted in the test by feeding a deliberately leaked column and showing the engine
    reports it as a perfect score, which is the signature a reader can recognise.
    """
    if not isinstance(signals, Mapping) or not signals:
        return "no indicator signals supplied"
    n = len(forward_returns)
    if n == 0:
        return "no forward returns supplied"
    for sid, col in signals.items():
        if not isinstance(sid, str) or not sid:
            return "an indicator id must be a non-empty string"
        if len(col) != n:
            return (f"indicator {sid!r} has {len(col)} readings against {n} forward returns; "
                    "a signal column must align one-to-one with the bars it is judged on")
    for i, r in enumerate(forward_returns):
        if r is None or not isinstance(r, (int, float)) or not math.isfinite(float(r)):
            return f"forward return at index {i} is not a finite number"
    return None


def _clamp_vote(v: Optional[float]) -> Optional[float]:
    if v is ABSTAIN:
        return ABSTAIN
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ABSTAIN
    if not math.isfinite(f):
        return ABSTAIN
    return max(VOTE_FLOOR, min(VOTE_CEIL, f))


# ─── combining votes into a position ───────────────────────────────────────────────────────────────
def blend(signals: Mapping[str, Sequence[Optional[float]]], ids: Sequence[str],
          weights: Optional[Mapping[str, float]] = None) -> list[float]:
    """
    One position per bar in [-1, +1] from the selected indicators' votes.

    AN ABSTENTION IS NOT A VOTE OF ZERO, and this is the defect in `strategy_scorer` restated as
    arithmetic. During warm-up an indicator has no reading. If absence were scored zero and divided by
    the full weight, then on a bar where two of three indicators are still warming up, one bullish
    indicator would read as a third of a vote — diluted by two indicators that said nothing. Here the
    denominator is the weight that ACTUALLY voted, so an abstention costs influence rather than
    inventing neutrality. A bar where everyone abstains is flat, which is the one correct reading.
    """
    w = {sid: 1.0 for sid in ids} if weights is None else {sid: float(weights.get(sid, 0.0)) for sid in ids}
    n = len(next(iter(signals.values()))) if signals else 0
    out = []
    for i in range(n):
        num = 0.0
        den = 0.0
        for sid in ids:
            vote = _clamp_vote(signals[sid][i])
            if vote is ABSTAIN:
                continue
            weight = w.get(sid, 0.0)
            num += weight * vote
            den += abs(weight)
        out.append(0.0 if den <= 0 else max(VOTE_FLOOR, min(VOTE_CEIL, num / den)))
    return out


def position_returns(position: Sequence[float], forward_returns: Sequence[float],
                     cost: Optional[_se.CostModel] = None) -> list[float]:
    """
    The return series the blended position actually earned, net of cost on the bars it traded.

    Cost is charged in proportion to the CHANGE in position, not per bar held. A model charged a full
    round trip for staying in a trade reports a cost drag several times the real one and rejects
    strategies that would have worked; one charged nothing for turnover is the flattering error. Both
    are wrong, and the direction of each is stated so a reader can see which way this errs.
    """
    costs = cost or _se.CostModel()
    round_trip = costs.round_trip_pct()
    out = []
    prev = 0.0
    for i, r in enumerate(forward_returns):
        pos = float(position[i]) if i < len(position) else 0.0
        turnover = abs(pos - prev)
        out.append(pos * float(r) - turnover * round_trip / 2.0)
        prev = pos
    return out


def per_trade_sharpe(returns: Sequence[float]) -> Optional[float]:
    """Mean over standard deviation in PER-BAR units — the units `strategy_eval` deflates in."""
    return _se.sharpe(returns, 1)


def _score(signals, ids, weights, forward_returns, cost) -> Optional[float]:
    if not ids:
        return None
    return per_trade_sharpe(position_returns(blend(signals, ids, weights), forward_returns, cost))


# ─── permutation importance ─────────────────────────────────────────────────────────────────────────
def permutation_importance(signals: Mapping[str, Sequence[Optional[float]]],
                           ids: Sequence[str],
                           forward_returns: Sequence[float],
                           *,
                           weights: Optional[Mapping[str, float]] = None,
                           repeats: int = DEFAULT_REPEATS,
                           seed: int = 0,
                           cost: Optional[_se.CostModel] = None) -> dict:
    """
    What each indicator contributes, measured by destroying its information and nothing else.

    For each indicator: shuffle its own signal column `repeats` times, leaving every other column and
    the forward returns exactly as they were, and record how far the score falls. The mean fall is the
    contribution. The shuffle preserves the column's distribution — the same votes, in the wrong order
    — so what is destroyed is the TIMING, which is the only thing an indicator claims to supply.

    Deterministic for a given `seed`, because an importance ranking that changed between two runs of
    the same data could not be cited as evidence.

    @returns `{ok, baseline, importance: {id: {dropMean, dropSd, share, harmful, ...}}, repeats, seed}`
             `share` is master's percentage, and it is computed from the POSITIVE drops only: an
             indicator that improves the result when its timing is destroyed is actively harmful, and
             giving it a positive share of the credit would be the opposite of the truth.
    """
    bad = validate(signals, forward_returns)
    if bad:
        return {"ok": False, "reason": bad}
    missing = [s for s in ids if s not in signals]
    if missing:
        return {"ok": False, "reason": f"no signal column for {', '.join(missing)}"}
    if not ids:
        return {"ok": False, "reason": "no indicators selected"}

    base = _score(signals, ids, weights, forward_returns, cost)
    if base is None:
        return {"ok": False, "reason": "the selected indicators produced no measurable position"}

    reps = max(1, int(repeats))
    out = {}
    for sid in ids:
        original = list(signals[sid])
        drops = []
        # One generator per indicator, seeded from the id, so adding an indicator does not reshuffle
        # the others' draws and silently change their measured importance.
        rng = random.Random(f"{seed}:{sid}")
        for _ in range(reps):
            shuffled = original[:]
            rng.shuffle(shuffled)
            trial = dict(signals)
            trial[sid] = shuffled
            s = _score(trial, ids, weights, forward_returns, cost)
            if s is not None:
                drops.append(base - s)
        if not drops:
            out[sid] = {"dropMean": None, "dropSd": None, "share": None, "harmful": None,
                        "repeats": 0, "reason": "no shuffle produced a measurable score"}
            continue
        mean = sum(drops) / len(drops)
        sd = (math.sqrt(sum((d - mean) ** 2 for d in drops) / (len(drops) - 1))
              if len(drops) > 1 else 0.0)
        out[sid] = {
            "dropMean": mean,
            "dropSd": sd,
            # Distinguishable from zero only if the mean fall exceeds the spread of the falls. Two
            # indicators whose intervals overlap are NOT ranked against each other, and this is the
            # field that says so.
            "distinguishable": bool(sd > 0 and abs(mean) > sd),
            "harmful": bool(mean < 0),
            "repeats": len(drops),
        }

    # `share` is 0.0 for "contributed nothing" and None ONLY for "could not be measured". The first
    # version collapsed both to None whenever no indicator contributed, which lost the most useful
    # reading in the set: an indicator measured and found worthless is a FINDING, and reporting it as
    # unmeasurable hides that behind the same word used for a failed shuffle.
    positive = sum(v["dropMean"] for v in out.values()
                   if v.get("dropMean") is not None and v["dropMean"] > 0)
    for v in out.values():
        d = v.get("dropMean")
        if d is None:
            v["share"] = None
        elif d <= 0 or positive <= 0:
            v["share"] = 0.0
        else:
            v["share"] = round(100.0 * d / positive, 2)

    return {
        "ok": True,
        "baseline": base,
        "importance": out,
        "repeats": reps,
        "seed": seed,
        # Said as a field and not only in prose, because "none of these contributed" is the result
        # this measurement will most often produce on real data, and a panel needs to be able to
        # render that case rather than drawing a pie chart of zeroes.
        "anyContributed": positive > 0,
        "shareNote": ("Shares are the measured out-of-sample contribution normalised to 100%, across "
                      "indicators that contributed at all. 0% means measured and worth nothing; null "
                      "means it could not be measured. An indicator may also be `harmful`."),
    }


# ─── greedy combination search ──────────────────────────────────────────────────────────────────────
def greedy_combination(signals: Mapping[str, Sequence[Optional[float]]],
                       forward_returns: Sequence[float],
                       *,
                       candidates: Optional[Sequence[str]] = None,
                       max_size: int = MAX_COMBINATION,
                       cost: Optional[_se.CostModel] = None) -> dict:
    """
    Build a combination by adding the indicator that most improves the score, and COUNT EVERY TRY.

    Greedy rather than exhaustive (172.3 D7): 2^25 combinations is not searchable, and a search that
    claimed to cover it would understate the trial count — which is the number the whole statistical
    defence rests on. Greedy examines `k * n` candidates for a combination of size k, every one of
    which is counted, so the deflation downstream is charged for the real search.

    @returns `{ok, selected, trials, steps[], scores}`. `trials` is the honest count: every single
             candidate scored, not the size of the final set.
    """
    bad = validate(signals, forward_returns)
    if bad:
        return {"ok": False, "reason": bad, "trials": 0}

    pool = [s for s in (candidates if candidates is not None else list(signals.keys())) if s in signals]
    if not pool:
        return {"ok": False, "reason": "no candidate indicators", "trials": 0}

    cap = max(1, min(int(max_size), MAX_COMBINATION, len(pool)))
    selected: list[str] = []
    steps = []
    trials = 0
    best_overall = None

    while len(selected) < cap:
        best_sid = None
        best_score = None
        for sid in pool:
            if sid in selected:
                continue
            trials += 1
            s = _score(signals, selected + [sid], None, forward_returns, cost)
            if s is None:
                continue
            if best_score is None or s > best_score:
                best_score, best_sid = s, sid
        if best_sid is None:
            break
        if best_overall is not None and best_score <= best_overall + MIN_IMPROVEMENT:
            steps.append({"considered": best_sid, "score": best_score, "added": False,
                          "why": "it did not improve the out-of-sample score, so the search stopped"})
            break
        selected.append(best_sid)
        best_overall = best_score
        steps.append({"added": True, "indicator": best_sid, "score": best_score,
                      "size": len(selected)})

    return {
        "ok": bool(selected),
        "reason": None if selected else "no indicator produced a measurable position",
        "selected": selected,
        "score": best_overall,
        "trials": trials,
        "steps": steps,
        "poolSize": len(pool),
        "cap": cap,
    }


# ─── the composed measurement ───────────────────────────────────────────────────────────────────────
def attribute(signals: Mapping[str, Sequence[Optional[float]]],
              forward_returns: Sequence[float],
              *,
              holdout_frac: float = _se.DEFAULT_HOLDOUT_FRAC,
              max_size: int = MAX_COMBINATION,
              repeats: int = DEFAULT_REPEATS,
              seed: int = 0,
              cost: Optional[_se.CostModel] = None,
              extra_trials: int = 0,
              provenance: Optional[dict] = None) -> dict:
    """
    THE WHOLE MEASUREMENT, with the search and the judgement kept apart.

    1. Split. The combination is chosen on `[0, search_end)` ONLY.
    2. Search. Greedy forward selection, every candidate counted.
    3. Measure. Permutation importance on the HOLDOUT, which the search never saw.
    4. Judge. `strategy_eval.evaluate` on the holdout returns, charged the honest trial count.
    5. Compare. The equal-weight blend of the same indicators, on the same holdout.

    `extra_trials` is for the caller to declare searching it did ELSEWHERE — a parameter grid over
    each indicator, for instance. It is added to the count the gate is charged. A caller that tuned
    twenty periods per indicator and does not declare them is hiding the search from its own judge.

    WHY STEP 5 EXISTS. `technical_confluence_score` is already an equal-weight vote counter, and it is
    what the measured weights have to beat to be worth having. If they do not, the honest answer is
    "equal weight is as good", and on most real data it will be.

    @returns a record designed to be CITED. Every figure a caller may quote is in it, at the precision
             it will be quoted, because `claimGate` requires a claim containing "best" to cite a reflex
             record that literally contains its numerals.
    """
    bad = validate(signals, forward_returns)
    if bad:
        return {"ok": False, "reason": bad}

    n = len(forward_returns)
    search_end, total = _se.holdout_split(n, holdout_frac)
    if search_end <= 0 or total - search_end <= 0:
        return {"ok": False, "reason": (f"{n} bars cannot be split into a search window and a holdout "
                                        f"at {holdout_frac}; supply more history")}

    def window(src, a, b):
        return {sid: list(col)[a:b] for sid, col in src.items()}

    search_signals = window(signals, 0, search_end)
    search_returns = list(forward_returns)[0:search_end]
    hold_signals = window(signals, search_end, total)
    hold_returns = list(forward_returns)[search_end:total]

    # ── 2. the search, on the search window only ──
    found = greedy_combination(search_signals, search_returns, max_size=max_size, cost=cost)
    if not found["ok"]:
        return {"ok": False, "reason": f"the search found nothing usable: {found['reason']}",
                "trials": found["trials"]}
    selected = found["selected"]
    trials = found["trials"] + max(0, int(extra_trials))

    # ── 3. importance, on the holdout the search never saw ──
    imp = permutation_importance(hold_signals, selected, hold_returns,
                                 repeats=repeats, seed=seed, cost=cost)

    # ── 4. the verdict, charged for the whole search ──
    measured_weights = None
    if imp.get("ok"):
        shares = {sid: (imp["importance"][sid].get("share") or 0.0) for sid in selected}
        if sum(shares.values()) > 0:
            measured_weights = shares

    hold_equal = position_returns(blend(hold_signals, selected, None), hold_returns, cost)
    hold_weighted = (position_returns(blend(hold_signals, selected, measured_weights), hold_returns, cost)
                     if measured_weights else None)

    # COSTS ARE ALREADY IN THESE RETURNS. `position_returns` charged them on turnover, so the judge is
    # handed a zero-cost model deliberately — charging them a second time here would double the drag
    # and reject strategies that do work. The cost actually applied is reported in `costPerRoundTrip`.
    verdict = _se.evaluate(
        hold_weighted if hold_weighted is not None else hold_equal,
        n_trials=max(1, trials),
        cost_model=_se.CostModel(commission_pct=0.0, slippage_pct=0.0, spread_pct=0.0),
        provenance={**(provenance or {}), "measuredOn": "holdout",
                    "weighting": "measured" if hold_weighted is not None else "equal",
                    "costsAppliedBy": "indicator_attribution.position_returns"},
        is_holdout=True,
    )

    equal_sharpe = per_trade_sharpe(hold_equal)
    weighted_sharpe = per_trade_sharpe(hold_weighted) if hold_weighted is not None else None
    beats_equal = (weighted_sharpe is not None and equal_sharpe is not None
                   and weighted_sharpe > equal_sharpe)

    notes = [
        f"{found['trials']} combinations were scored on the search window"
        + (f", plus {extra_trials} candidates the caller declared searching elsewhere" if extra_trials else "")
        + f"; the gate was charged {max(1, trials)} trials.",
        "Weights are the measured out-of-sample contribution of each indicator's TIMING, found by "
        "shuffling its own column and leaving everything else untouched.",
        "A contribution describes the past. It is not the probability that the next signal is right.",
    ]
    if weighted_sharpe is None:
        notes.append("No measured weighting was produced, so the equal-weight blend is what was judged.")
    elif not beats_equal:
        notes.append(
            f"The measured weighting did NOT beat equal weight out of sample "
            f"({weighted_sharpe:.4f} against {equal_sharpe:.4f} per bar), so equal weight is the "
            f"honest choice and the percentages below are description, not an improvement.")
    else:
        notes.append(
            f"The measured weighting beat equal weight out of sample "
            f"({weighted_sharpe:.4f} against {equal_sharpe:.4f} per bar).")
    if imp.get("ok"):
        undist = [s for s in selected if not imp["importance"][s].get("distinguishable")]
        if undist:
            notes.append(
                f"{len(undist)} of {len(selected)} contributions are not distinguishable from their own "
                f"shuffle-to-shuffle spread ({', '.join(undist)}); do not rank those against each other.")

    return {
        "ok": True,
        "selected": selected,
        "weights": measured_weights,
        "equalWeight": {sid: round(100.0 / len(selected), 2) for sid in selected} if selected else {},
        "importance": imp.get("importance") if imp.get("ok") else None,
        "importanceReason": None if imp.get("ok") else imp.get("reason"),
        "holdout": {
            "bars": len(hold_returns),
            "perBarSharpeEqual": equal_sharpe,
            "perBarSharpeWeighted": weighted_sharpe,
            "weightedBeatsEqual": beats_equal,
        },
        "search": {"bars": search_end, "trials": found["trials"], "steps": found["steps"],
                   "poolSize": found["poolSize"], "cap": found["cap"]},
        "trialsCharged": max(1, trials),
        "verdict": verdict.to_dict(),
        "repeats": repeats,
        "seed": seed,
        "notes": notes,
    }
