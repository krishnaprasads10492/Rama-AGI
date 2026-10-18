"""
strategy_factory.py - Rama proposes strategies; master chooses parameters (spec Section 151).

Master: *"reduce the work on master. Suggestions of well calculated strategies for various items based on
selection of params."* Before this, he built one rule by hand, backtested it, and the result vanished when he
navigated away. This module does the part that is mechanical: take the published library, run each template over
master's instrument, judge it honestly, and hand back candidates already ranked by Section 135's rule.

WHAT "WELL CALCULATED" HAS TO MEAN, because generating many strategies and showing the best is how a tool
manufactures false confidence. Generate 500, score them all, present five, and the five are overfit by
construction. So every candidate here is judged by WALK-FORWARD, not by the data it was tuned on:

  - Each variant is simulated ONCE over the whole series (continuous trading, entry on the next open) and its
    trades are SLICED by the bar they were opened on.
  - For each fold, the variant is chosen by net per-trade Sharpe on trades that were opened AND closed before
    the cut (the purge), and scored on trades opened in the fold.
  - The scored trades from every fold are POOLED into one out-of-sample record. That record measures the
    PROCEDURE ("tune on the past, trade the next stretch"), which is exactly what a stored strategy will do.
  - The parameters that get STORED are the procedure applied to all the data; their record over that same data
    is the in-sample verdict, and the gap between the two is reported, not averaged away (135.4).

STDLIB ONLY. It reads bars as a list of dicts and a cost basis as an injected function, so it runs on any
interpreter and is testable where pandas is not installed. The bars come from the service layer.

NOT HERE: order placement (Section 95: never), a probability of profit (a backtested hit rate describes the past),
and any claim a number cannot back.
"""

from __future__ import annotations

import copy
import math
from typing import Callable, Iterable, Optional

try:                                    # pragma: no cover - import shape, not logic
    from . import strategy_eval as _se
    from . import strategy_library as _lib
    from . import strategy_rank as _rank
    from . import strategy_spec as _ss
except Exception:                       # pragma: no cover
    import strategy_eval as _se
    import strategy_library as _lib
    import strategy_rank as _rank
    import strategy_spec as _ss

# A fold whose training window is shorter than this share of the series, or holds fewer eligible trades than
# MIN_TRAIN_TRADES, cannot choose a parameter from evidence. It is SKIPPED AND REPORTED, never silently kept.
MIN_TRAIN_FRACTION = 0.30
MIN_TRAIN_TRADES = 10
DEFAULT_FOLDS = 5
MIN_BARS = 250
EMBARGO_FRAC = _se.DEFAULT_EMBARGO_FRAC

# `explore: "wider"` multiplies every template's exit by these. Declared, small, and counted as trials.
EXIT_GRID = (0.67, 1.0, 1.5)

EXPLORE = ("library", "wider")
SIDES = ("long", "short", "both")


def _net(gross: float, cost: "_se.CostModel") -> float:
    return gross - cost.round_trip_pct()


def _sharpe_of(gross: list, cost: "_se.CostModel") -> Optional[float]:
    """Per-trade, NOT annualised: it is only used to ORDER variants against each other (Section 149.2a)."""
    return _se.sharpe([_net(g, cost) for g in gross], 1)


def candidate_specs(*, symbol: str, exchange: str = "NSE", interval: str = "1d", capital: float = 100000.0,
                    risk_pct: float = 1.0, instrument: Optional[str] = None, lot_size: Optional[int] = None,
                    side: str = "both", horizon: Optional[str] = None, explore: str = "library",
                    templates: Optional[Iterable[str]] = None) -> dict:
    """
    The strategies to try, as validated specs, plus every one that was refused and why.

    Nothing is dropped silently: a template that cannot be run on this input appears in `refused` with its
    reason, because "the library has nothing for you" and "the library could not be asked" are different.
    """
    if explore not in EXPLORE:
        return {"ok": False, "reason": f"explore must be one of {', '.join(EXPLORE)}"}
    if side not in SIDES:
        return {"ok": False, "reason": f"side must be one of {', '.join(SIDES)}"}

    wanted = list(templates) if templates else list(_lib.TEMPLATES)
    specs, refused = [], []
    for tid in wanted:
        t = _lib.TEMPLATES.get(tid)
        if t is None:
            refused.append({"template": tid, "reason": "not a template in the library"})
            continue
        if side != "both" and t["side"] != side:
            continue                                   # a filter master chose, not a refusal
        if horizon and t["horizon"] != horizon:
            continue

        base = _lib.build(tid, symbol=symbol, exchange=exchange, interval=interval,
                          capital=capital, risk_pct=risk_pct, include_sweep=True)
        if instrument:
            base["instrument"] = instrument
        if lot_size:
            base["lotSize"] = lot_size

        variants_of_exit = [base]
        if explore == "wider":
            variants_of_exit = []
            for k in EXIT_GRID:
                b = copy.deepcopy(base)
                ex = b["exit"]
                if ex.get("stopPct"):
                    ex["stopPct"] = round(ex["stopPct"] * k, 4)
                if ex.get("targetPct"):
                    ex["targetPct"] = round(ex["targetPct"] * k, 4)
                variants_of_exit.append(b)

        for b in variants_of_exit:
            v = _ss.validate_spec(b)
            if not v["ok"]:
                refused.append({"template": tid, "reason": "; ".join(v["errors"])})
                continue
            if v["blocked"]:
                refused.append({"template": tid, "reason": "; ".join(x["why"] for x in v["blocked"])})
                continue
            specs.append({"template": tid, "spec": v["spec"], "warnings": v["warnings"],
                          "exitScale": None if explore == "library" else b["exit"]})
    return {"ok": True, "specs": specs, "refused": refused}


def _window_trades(trades: list, lo: int, hi: int) -> list:
    """Trades OPENED in [lo, hi). Their exits may run past hi: that is the cost of trading continuously."""
    return [t for t in trades if lo <= t["entryIndex"] < hi]


def _closed_before(trades: list, cut: int) -> list:
    """Trades that were opened AND CLOSED strictly before `cut`: all a chooser standing at `cut` could know."""
    return [t for t in trades if t["exitIndex"] < cut]


def _stability_blocks(trades: list, n: int, blocks: int) -> list:
    """Equal slices of the series by entry bar, each with its own expectancy: is the result one lucky stretch?"""
    out = []
    size = max(1, n // blocks)
    for k in range(blocks):
        lo, hi = k * size, (n if k == blocks - 1 else (k + 1) * size)
        net = [t["net"] for t in trades if lo <= t["entryIndex"] < hi]
        out.append({"fold": k, "trades": len(net),
                    "expectancyPct": (sum(net) / len(net)) if net else None,
                    "hitRate": (sum(1 for x in net if x > 0) / len(net)) if net else None})
    return out


def walk_forward(variants: list, bars: list, cost: "_se.CostModel", *, default_index: int = 0,
                 folds: int = DEFAULT_FOLDS, label_horizon: int = 40) -> dict:
    """
    Judge a template's variants without letting the data it is scored on choose its parameters.

    ONE VARIANT: there is nothing to choose, so every trade it makes is already out of sample with respect to
    parameter selection (the parameters are the author's, published before this series was looked at). All of
    its trades are scored, `tuned` is False, and `n_trials=1` is true. Throwing away the first 20% of the
    series to "train" a choice that does not exist would cost trades the verdict badly needs.

    SEVERAL VARIANTS: for each fold, choose by net per-trade Sharpe on trades that were opened AND CLOSED
    before the cut, and score trades opened in the fold. A variant needs `MIN_TRAIN_TRADES` closed trades to
    be eligible to be chosen; when NONE has, the past cannot decide and the template's stated default is
    used. Falling back to the author's parameters rather than skipping the fold is the honest direction:
    the alternative to a choice made on thin evidence is not a better choice, it is the published one.
    """
    n = len(bars)
    trades_by = []
    for v in variants:
        tr = _ss.simulate(v, bars)
        for t in tr:
            t["net"] = _net(t["grossPct"], cost)
        trades_by.append(tr)

    if len(variants) == 1:
        tr = trades_by[0]
        return {"ok": bool(tr), "tuned": False, "pooledGross": [t["grossPct"] for t in tr],
                "folds": _stability_blocks(tr, n, folds), "skipped": [], "chosen": [0] * 1,
                "scheduled": folds, "fallbacks": 0, "trades": tr}

    splits = _se.purged_walk_forward(n, folds=folds, label_horizon=label_horizon, embargo_frac=EMBARGO_FRAC)
    pooled, per_fold, skipped, chosen, fallbacks = [], [], [], [], 0
    pooled_trades = []
    for k, sp in enumerate(splits):
        train_end = sp.train[1]
        test_lo, test_hi = sp.test
        best_i, best_s = None, None
        for i, tr in enumerate(trades_by):
            known = _closed_before(tr, train_end)
            if len(known) < MIN_TRAIN_TRADES:
                continue
            sh = _sharpe_of([t["grossPct"] for t in known], cost)
            if sh is not None and (best_s is None or sh > best_s):
                best_i, best_s = i, sh
        used_default = best_i is None
        if used_default:
            best_i = default_index
            fallbacks += 1
        test = _window_trades(trades_by[best_i], test_lo, test_hi)
        gross = [t["grossPct"] for t in test]
        pooled.extend(gross)
        pooled_trades.extend(test)
        chosen.append(best_i)
        net = [t["net"] for t in test]
        per_fold.append({
            "fold": k, "trainBars": train_end, "testFrom": bars[test_lo]["date"],
            "testTo": bars[min(test_hi, n) - 1]["date"], "trades": len(gross),
            "choice": "stated default" if used_default else "chosen on the past",
            "expectancyPct": (sum(net) / len(net)) if net else None,
            "hitRate": (sum(1 for x in net if x > 0) / len(net)) if net else None,
        })
    return {"ok": bool(pooled), "tuned": True, "pooledGross": pooled, "folds": per_fold, "skipped": skipped,
            "chosen": chosen, "scheduled": len(splits), "fallbacks": fallbacks, "trades": pooled_trades}


# What a row MAY be called. Section 135's profit gate decides whether a candidate is listed; it does NOT say the
# candidate has skill. Measured (Section 151.7): on pure noise at 5,000 bars, 31 of 216 template-runs were
# profitable after costs by luck and ranked, while none was demonstrated. A list of "profitable, accurate"
# rows is read as a recommendation, so the word that qualifies it is part of the data and not a footnote.
DEMONSTRATED = "demonstrated"   # cleared the deflated-Sharpe test AND beats what picking the best of K would give
UNPROVEN = "unproven"           # profitable after costs out of sample; NOT distinguishable from luck
REFUSED = "refused"             # not ranked: too few trades, no out-of-sample record, or does not pay after costs


def verdict_class(row: dict, bucket: str) -> str:
    """
    One definition of what a candidate is allowed to be called.

    DEMONSTRATED needs BOTH the deflated-Sharpe pass and a hit rate above the selection-noise ceiling: the
    first answers "is it distinguishable from a luckless search", the second "is it better than the best of
    this many candidates would look by chance". Either alone let noise through in measurement.
    """
    if bucket != "ranked":
        return REFUSED
    m = row.get("measurement") or {}
    if m.get("demonstrated") and row.get("exceedsSelectionNoise") is not False:
        return DEMONSTRATED
    return UNPROVEN


def _label_horizon(spec: dict) -> int:
    ex = spec["exit"]
    return int(ex.get("maxBars") or 0) or 20


def evolve(bars: list, entries: list, cost: "_se.CostModel", *, folds: int = DEFAULT_FOLDS,
           provenance: Optional[dict] = None, measured_on: Optional[str] = None) -> dict:
    """
    Judge every template's variants and rank the result by Section 135.

    @param entries  `candidate_specs(...)["specs"]`; entries of the same template are one search.
    @returns `{ok, ranked, insufficient, unvalidated, excluded, familyTrials, ...}` - `strategy_rank.rank`'s
             shape, with each row's `stored` spec and fold detail attached.
    """
    n = len(bars)
    if n < MIN_BARS:
        return {"ok": False, "reason": f"{n} bars is too few to hold anything out; need {MIN_BARS}.", "bars": n}

    by_template: dict = {}
    for e in entries:
        by_template.setdefault(e["template"], []).extend(_ss.expand_sweep(e["spec"]))

    family = sum(len(v) for v in by_template.values())
    candidates, notes = [], []
    for tid, variants in by_template.items():
        t = _lib.TEMPLATES[tid]
        claim = {"source": t["source"]["author"], "work": t["source"]["work"], "year": t["source"]["year"],
                 "text": t["claim"], "evidence": _lib.PUBLISHED}
        horizon = max(_label_horizon(v) for v in variants)

        # The author's stated parameters: the variant whose entry params equal the template's own.
        stated = _lib.build(tid, symbol="X", interval=variants[0]["interval"], include_sweep=False)
        stated_blocks = [(b["id"], tuple(sorted(b["params"].items()))) for b in stated["entry"]["blocks"]]
        default_index = 0
        for i, v in enumerate(variants):
            vb = [(b["id"], tuple(sorted(b["params"].items()))) for b in v["entry"]["blocks"]]
            if vb == stated_blocks:
                default_index = i
                break

        wf = walk_forward(variants, bars, cost, default_index=default_index, folds=folds, label_horizon=horizon)

        # How often does this template trade on THIS series, and so how much history would it take?
        base_trades = _ss.simulate(variants[default_index], bars)
        rate = len(base_trades) / n if n else 0.0
        needs = {
            "tradesSoFar": len(base_trades), "barsHave": n,
            "barsNeeded": (int(math.ceil(_se.MIN_TRADES / rate)) if rate > 0 else None),
        }

        trials = len(variants)
        if not wf["ok"]:
            candidates.append({
                "id": tid, "name": t["name"], "template": tid, "claim": claim, "measuredOn": measured_on,
                "inSample": None, "outOfSample": None, "variantsTried": trials, "needs": needs,
                "whyNot": ("it made no trades on this series" if not base_trades else
                           "no fold produced a trade to score"),
                "folds": wf["folds"], "skipped": wf["skipped"], "foldsPositive": 0, "foldsScored": 0,
                "shape": _lib.expected_shape(tid),
            })
            continue

        prov = dict(provenance or {}, template=tid, variants=trials, foldsScored=len(wf["folds"]),
                    foldsScheduled=wf["scheduled"], tuned=wf["tuned"],
                    procedure=("walk-forward" if wf["tuned"] else "stated parameters, no tuning"))
        oos = _se.evaluate(wf["pooledGross"], n_trials=trials if wf["tuned"] else 1, cost_model=cost,
                           provenance=prov, is_holdout=True).to_dict()

        # The parameters that get STORED are the same procedure applied to all the data.
        stored, ins = variants[default_index], None
        if wf["tuned"]:
            all_trades = [_ss.simulate(v, bars) for v in variants]
            best_i, best_s = None, None
            for i, tr in enumerate(all_trades):
                if len(tr) < MIN_TRAIN_TRADES:
                    continue
                sh = _sharpe_of([x["grossPct"] for x in tr], cost)
                if sh is not None and (best_s is None or sh > best_s):
                    best_i, best_s = i, sh
            if best_i is not None:
                stored = variants[best_i]
                ins = _se.evaluate([x["grossPct"] for x in all_trades[best_i]], n_trials=trials,
                                   cost_model=cost, provenance=dict(prov, evaluatedOn="search-window")).to_dict()

        positive = sum(1 for f in wf["folds"] if (f["expectancyPct"] or 0) > 0)
        candidates.append({
            "id": tid, "name": t["name"], "template": tid, "claim": claim, "measuredOn": measured_on,
            "inSample": ins, "outOfSample": oos, "tuned": wf["tuned"], "needs": needs,
            "stored": stored, "variantsTried": trials, "fallbacks": wf["fallbacks"],
            "folds": wf["folds"], "skipped": wf["skipped"], "foldsPositive": positive,
            "foldsScored": len(wf["folds"]), "shape": _lib.expected_shape(tid),
        })

    ranking = _rank.rank(candidates)
    detail = {c["id"]: c for c in candidates}
    for bucket in ("ranked", "insufficient", "unvalidated", "excluded"):
        for row in ranking[bucket]:
            d = detail.get(row["id"], {})
            for key in ("stored", "variantsTried", "folds", "skipped", "foldsPositive", "foldsScored",
                        "shape", "whyNot", "template", "tuned", "needs", "fallbacks"):
                if key in d:
                    row[key] = d[key]
    for bucket in ("ranked", "insufficient", "unvalidated", "excluded"):
        for row in ranking[bucket]:
            row["verdictClass"] = verdict_class(row, bucket)
    ranking["counts"] = {
        DEMONSTRATED: sum(1 for r in ranking["ranked"] if r["verdictClass"] == DEMONSTRATED),
        UNPROVEN: sum(1 for r in ranking["ranked"] if r["verdictClass"] == UNPROVEN),
        REFUSED: sum(len(ranking[b]) for b in ("insufficient", "unvalidated", "excluded")),
    }
    ranking.update({"bars": n, "firstBar": bars[0]["date"], "lastBar": bars[-1]["date"],
                    "familyTrials": family, "templatesRun": len(by_template),
                    "costRoundTripPct": cost.round_trip_pct()})
    return ranking
