"""
strategy_rank.py — how a strategy earns a place on the list (spec Section 135, built in Section 149).

Master's ruling, verbatim: *"scored candidates with their sample sizes and cost-adjusted edge, ranked and
named - but filtered for optimal accuracy and profit. accuracy takes most precedence but without profit
what's the point."*

THE RULE. Profit is a GATE and accuracy is the RANKING inside it. They only conflict if both are
rankings to be weighted. As a requirement and an ordering they compose exactly:

  1. Cost-adjusted expectancy must be POSITIVE on out-of-sample trades, or the candidate is EXCLUDED
     WITH ITS REASON. Never ranked lower: down-ranking lets an unfit candidate win whenever nothing
     better exists (the requirement-not-preference pattern `modelRoles` already uses).
  2. Among the survivors, hit rate decides the order. Master's stated precedence, exactly.

Hit rate alone is the refused filter of Section 113: 40 wins of 1% against 10 losses of 5% is 80%
accurate and loses 0.20% a trade. Gated on profit it never reaches the ranking.

THREE GATES NOBODY ASKED FOR, without which a ranking of this kind is the most confident-looking wrong
answer the project could produce (135.4):

  - MINIMUM SAMPLE. 100% accuracy over three trades is noise. Below `MIN_TRADES` out-of-sample trades a
    candidate is `insufficient` and is never ranked.
  - OUT-OF-SAMPLE IS MANDATORY. A candidate with no out-of-sample verdict is `unvalidated`. In-sample is
    shown beside it and is never the number that ranks.
  - SELECTION NOISE. Ranking K candidates on the same window is itself a search: the best of K zero-edge
    strategies reaches an impressive hit rate by construction. Each row carries the hit rate that the
    best of K coin-flips would typically reach at ITS sample size, and says whether it exceeds it.

THE CLAIM AND THE MEASUREMENT NEVER MERGE (135.5). A book's assertion is a hypothesis. The candidate
carries `claim` (what the source said) and `measurement` (what Rāma found) as separate fields, plus the
date the measurement was taken, which is what says how stale it is.

WHAT THIS MODULE DOES NOT DO: it runs no backtest and reads no bars. It judges verdicts that
`strategy_eval` already produced, so it needs no dataframe and runs on any interpreter. It names no
forward-looking probability: a backtested hit rate is a description of the past.

STDLIB ONLY, like `strategy_eval`.
"""

from __future__ import annotations

import math
from typing import Iterable, Optional

try:                                    # pragma: no cover - import shape, not logic
    from . import strategy_eval as _se
except Exception:                       # pragma: no cover
    import strategy_eval as _se

MIN_TRADES = _se.MIN_TRADES

# The reasons a candidate does not reach the list. Machine-readable, so a UI can group by them and a
# test can assert a specific one rather than "was excluded".
UNVALIDATED = "unvalidated"
INSUFFICIENT = "insufficient"
EXCLUDED = "excluded"
RANKED = "ranked"

# A hit-rate gap between in-sample and out-of-sample beyond this many percentage points is reported as
# the finding. 135.4: "If in-sample reads 71% and out-of-sample reads 48%, that gap IS the finding."
LARGE_GAP_POINTS = 10.0


def selection_noise_ceiling(breakeven: Optional[float], n_trades: int, k_candidates: int) -> Optional[float]:
    """
    The hit rate the BEST of `k_candidates` zero-edge strategies would typically reach over `n_trades`.

    A strategy with no edge wins at about its breakeven rate (that is what zero expectancy means), and a
    win rate over `n` trades has standard deviation sqrt(p(1-p)/n). The maximum of K standard-normal
    draws is, to the same approximation `strategy_eval.expected_max_sharpe` uses, a known function of K.

    Returns None when the inputs cannot support it (no breakeven, no trades). A ceiling invented from
    nothing would be a number with no meaning, and `None` says so.
    """
    if breakeven is None or n_trades <= 0:
        return None
    p = float(breakeven)
    if not (0.0 < p < 1.0):
        return None
    z = _se.expected_max_sharpe(max(1, int(k_candidates)), 1.0)
    return min(1.0, p + z * math.sqrt(p * (1.0 - p) / n_trades))


def _hit(v: Optional[dict]) -> Optional[float]:
    return None if not v else v.get("win_rate")


def _summary(v: Optional[dict]) -> Optional[dict]:
    """The few figures that identify a measurement. Not the whole verdict - that stays one call away."""
    if not v:
        return None
    return {
        "trades": v.get("trades"),
        "hitRate": v.get("win_rate"),
        "expectancyPct": v.get("expectancy_pct"),
        "payoffRatio": v.get("payoff_ratio"),
        "profitFactor": v.get("profit_factor"),
        "breakevenWinRate": v.get("breakeven_win_rate"),
        "maxDrawdown": v.get("max_drawdown"),
        "demonstrated": bool(v.get("passed")),
        "chanceReal": v.get("deflated"),
        "nTrials": v.get("n_trials"),
        "confidence": v.get("confidence"),
    }


def _refusal(c: dict, status: str, reason: str, k: int) -> dict:
    return {
        "id": c.get("id"), "name": c.get("name"), "status": status, "reason": reason,
        "claim": c.get("claim"), "measuredOn": c.get("measuredOn"),
        "inSample": _summary(c.get("inSample")), "outOfSample": _summary(c.get("outOfSample")),
        "candidatesCompared": k,
    }


def rank(candidates: Iterable[dict], *, min_trades: int = MIN_TRADES,
         require_demonstrated: bool = False) -> dict:
    """
    Admit, exclude and order candidates.

    @param candidates  each `{id, name, claim?, measuredOn?, inSample?, outOfSample?}`, the two verdicts
                       being `strategy_eval.Verdict.to_dict()` output.
    @param require_demonstrated  also require the out-of-sample verdict to have PASSED the deflated-Sharpe
                       test. Off by default because master's ruling made profit the gate; every row says
                       whether it passed, so the choice stays visible rather than being made for him.

    @returns `{ranked, insufficient, unvalidated, excluded, candidatesCompared, ...notes}`. A candidate
             appears in exactly ONE list. Nothing is silently dropped: master can see what was refused
             and why, which is the point of a gate that excludes instead of down-ranking.
    """
    cands = [c for c in candidates if isinstance(c, dict)]
    k = len(cands)
    ranked, insufficient, unvalidated, excluded = [], [], [], []

    for c in cands:
        oos = c.get("outOfSample")
        ins = c.get("inSample")

        # 1. Out-of-sample is mandatory. In-sample is never the number that ranks.
        if not oos or oos.get("trades") is None:
            unvalidated.append(_refusal(
                c, UNVALIDATED,
                "no out-of-sample verdict. A candidate scored only on the data it was tuned on cannot "
                "be ranked: the best of many tuned candidates looks excellent by construction.", k))
            continue

        n = int(oos.get("trades") or 0)

        # 2. Minimum sample, before any metric is believed.
        if n < min_trades:
            insufficient.append(_refusal(
                c, INSUFFICIENT,
                f"{n} out-of-sample trades, need {min_trades}. Too few to tell skill from luck, so no "
                f"hit rate is quoted as if it meant something.", k))
            continue

        # 3. THE PROFIT GATE. A requirement, so a failure excludes with its reason.
        exp = oos.get("expectancy_pct")
        if exp is None or exp <= 0:
            hit = _hit(oos)
            note = ""
            if hit is not None:
                note = (f" Its hit rate was {hit * 100:.0f}%, which is exactly why it is shown: "
                        f"accuracy without profit is the combination master ruled out.")
            excluded.append(_refusal(
                c, EXCLUDED,
                f"cost-adjusted expectancy {'is not defined' if exp is None else f'{exp:.2f}% per trade'}"
                f" out of sample. It does not make money after costs.{note}", k))
            continue

        if require_demonstrated and not oos.get("passed"):
            excluded.append(_refusal(
                c, EXCLUDED,
                "positive expectancy out of sample, but the edge is not distinguishable from the best "
                "of its own search, and this ranking was asked to require that.", k))
            continue

        # 4. Admitted. Everything master needs to weigh it, and the claim kept apart from the measure.
        hit = _hit(oos)
        ceiling = selection_noise_ceiling(oos.get("breakeven_win_rate"), n, k)
        gap = None
        if _hit(ins) is not None and hit is not None:
            gap = (_hit(ins) - hit) * 100.0

        row = {
            "id": c.get("id"), "name": c.get("name"), "status": RANKED,
            "claim": c.get("claim"),                       # what the source asserted - a hypothesis
            "measurement": _summary(oos),                  # what Rāma found, out of sample
            "inSample": _summary(ins),
            "measuredOn": c.get("measuredOn"),
            "hitRate": hit,
            "inSampleHitRate": _hit(ins),
            "hitRateGapPoints": gap,
            "largeGap": gap is not None and abs(gap) >= LARGE_GAP_POINTS,
            "selectionNoiseHitRate": ceiling,
            "exceedsSelectionNoise": ceiling is not None and hit is not None and hit > ceiling,
            "candidatesCompared": k,
        }
        ranked.append(row)

    # Accuracy orders the survivors. Ties go to the larger edge, then to the larger sample: of two
    # strategies equally accurate, the one that made more per trade over more trades is the better bet.
    ranked.sort(key=lambda r: (
        -(r["hitRate"] if r["hitRate"] is not None else -1.0),
        -(r["measurement"]["expectancyPct"] or 0.0),
        -(r["measurement"]["trades"] or 0),
    ))
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i

    demonstrated = sum(1 for r in ranked if r["measurement"]["demonstrated"])
    notes = []
    if ranked:
        notes.append(
            f"{len(ranked)} of {k} candidates are ranked, ordered by out-of-sample hit rate. "
            f"{demonstrated} of them cleared the deflated-Sharpe test; the rest are profitable after "
            f"costs but not distinguishable from luck."
        )
        notes.append(
            "These are the best of "
            f"{k} compared on the same out-of-sample window, so their numbers are optimistic. "
            "Re-test the top few on data none of them has seen before relying on them."
        )
        notes.append("A backtested hit rate describes the past. It is not the probability of the next trade winning.")
    elif k:
        notes.append("No candidate is ranked. See why each was refused below.")

    return {
        "ok": True,
        "ranked": ranked,
        "insufficient": insufficient,
        "unvalidated": unvalidated,
        "excluded": excluded,
        "candidatesCompared": k,
        "minTrades": min_trades,
        "requireDemonstrated": bool(require_demonstrated),
        "notes": notes,
    }
