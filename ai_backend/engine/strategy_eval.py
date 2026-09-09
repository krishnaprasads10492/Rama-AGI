"""
strategy_eval.py — the harness that decides whether a strategy found an edge or found noise.

Master asked for strategy permutations ranked by backtest accuracy. Built the obvious way that is not
a strategy engine but a machine for manufacturing false confidence, so this module exists to be the
judge that the search cannot flatter (spec Section 95).

THE PROBLEM, PLAINLY. Search 4,096 parameter combinations against one price history and the best one
will show an excellent Sharpe ratio whether or not any edge exists, because the maximum of many noisy
estimates is biased upward. The reported number rewards searching hard, not finding something real.
This is why strategies that backtest beautifully lose money live, and it is the exact class of
dishonesty Sections 66-69 were written to refuse.

WHAT THIS MODULE REFUSES TO DO
  - rank by raw return or raw Sharpe
  - report a metric without the number of trials that produced it
  - judge a strategy on too few trades
  - let the search touch the holdout
  - present a backtested win rate as a forward-looking probability

STDLIB ONLY, deliberately. This is statistics and index arithmetic, not dataframe work. So it runs on
any interpreter master has, it is testable where the engine's numpy/pandas are not installed, and the
layer everything else is judged by carries no dependency that can be missing when it is needed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from statistics import NormalDist
from typing import Callable, Iterable, Optional, Sequence

# ── Evidence floors ───────────────────────────────────────────────────────────
# Chosen to match the spirit of the model gate in `training.py` (MIN_HOLDOUT_ROWS = 150): below a
# floor, the honest verdict is that there is not enough evidence to judge, not a percentage.
MIN_TRADES = 30                # below this, no verdict on win rate or Sharpe
MIN_TRADES_CONFIDENT = 100     # below this, a verdict is provisional
DSR_THRESHOLD = 0.95           # deflated Sharpe must imply >95% chance the edge is not luck
DEFAULT_HOLDOUT_FRAC = 0.30    # withheld from the search entirely
DEFAULT_EMBARGO_FRAC = 0.01    # of the series, either side of a test fold

_NORM = NormalDist()


# ── Costs ─────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class CostModel:
    """
    What a trade actually costs. Never optional.

    A strategy profitable only without costs is not a strategy, and high-frequency permutations
    flatter themselves here most — halving the holding period doubles the cost drag while leaving the
    gross edge looking unchanged.

    Defaults are deliberately not zero. A zero-cost default is how a caller who forgets to pass a
    cost model gets a flattering answer instead of an obviously wrong one.
    """
    commission_pct: float = 0.03     # per side, percent of notional
    slippage_pct: float = 0.05       # per side, percent of notional
    spread_pct: float = 0.02         # crossing the spread, once per round trip

    def round_trip_pct(self) -> float:
        return 2.0 * (self.commission_pct + self.slippage_pct) + self.spread_pct

    def apply(self, gross_pct: float) -> float:
        return gross_pct - self.round_trip_pct()


# ── Splitting ─────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Split:
    """One train/test division. Indices are half-open ranges into the series."""
    train: tuple[int, int]
    test: tuple[int, int]
    purged: int = 0
    embargoed: int = 0


def holdout_split(n: int, holdout_frac: float = DEFAULT_HOLDOUT_FRAC) -> tuple[int, int]:
    """
    Split off a final segment the search must never see.

    Returns `(search_end, n)` — the search may use `[0, search_end)` and nothing else.

    WHY THE FINAL SEGMENT AND NOT A RANDOM SAMPLE: a strategy is used forward in time, so the only
    honest question is how it behaves on data that came after everything used to build it. A random
    holdout answers a question nobody is asking.
    """
    if n <= 0:
        return (0, 0)
    frac = min(max(holdout_frac, 0.0), 0.9)
    search_end = int(n * (1.0 - frac))
    # Never hand back an empty search window: a caller with 10 bars should get a refusal downstream
    # from the trade-count floor, not a silent split that makes the search impossible.
    search_end = max(1, min(search_end, n - 1)) if n > 1 else n
    return (search_end, n)


def purged_walk_forward(
    n: int,
    folds: int = 5,
    label_horizon: int = 1,
    embargo_frac: float = DEFAULT_EMBARGO_FRAC,
) -> list[Split]:
    """
    Walk-forward folds with purging and an embargo.

    WHY PURGING IS NOT OPTIONAL. A label is built from bars AFTER the decision — "did price reach the
    target within 10 bars". So a training example at index i depends on bars up to i+horizon. If the
    test fold begins at i+3, the training example at i already contains information from inside the
    test window, and the model is being validated on data it has partly seen. The measured effect is
    always in the flattering direction.

    Purging drops training rows whose label window reaches into the test fold. The embargo drops a
    little more on each side, because serial correlation means bars adjacent to the test window carry
    nearly the same information even when their labels do not formally overlap.

    Train is the region BEFORE each test fold only. A strategy cannot be built on its own future,
    which is what a symmetric k-fold would allow.
    """
    if n <= 0 or folds <= 0:
        return []

    embargo = max(0, int(n * max(0.0, embargo_frac)))
    horizon = max(0, label_horizon)
    fold_size = n // folds
    if fold_size <= 0:
        return []

    out: list[Split] = []
    for k in range(1, folds):          # fold 0 has no history to train on
        test_start = k * fold_size
        test_end = n if k == folds - 1 else (k + 1) * fold_size

        # Purge the label window, then embargo a further margin.
        train_end = test_start - horizon - embargo
        if train_end <= 0:
            continue

        out.append(Split(
            train=(0, train_end),
            test=(test_start, test_end),
            purged=horizon,
            embargoed=embargo,
        ))
    return out


# ── Metrics ───────────────────────────────────────────────────────────────────
def sharpe(returns: Sequence[float], periods_per_year: int = 252) -> Optional[float]:
    """Annualised Sharpe of per-trade or per-period returns. None when undefined."""
    vals = [float(r) for r in returns]
    n = len(vals)
    if n < 2:
        return None
    mean = sum(vals) / n
    var = sum((v - mean) ** 2 for v in vals) / (n - 1)
    sd = math.sqrt(var)
    if sd <= 0:
        # A constant return series has no risk to divide by. Reporting an enormous Sharpe here is a
        # classic backtest artefact, so it is refused instead.
        return None
    return (mean / sd) * math.sqrt(periods_per_year)


def _moments(returns: Sequence[float]) -> tuple[float, float]:
    """Skewness and kurtosis, needed because the deflation depends on non-normality."""
    vals = [float(r) for r in returns]
    n = len(vals)
    if n < 4:
        return (0.0, 3.0)
    mean = sum(vals) / n
    m2 = sum((v - mean) ** 2 for v in vals) / n
    if m2 <= 0:
        return (0.0, 3.0)
    m3 = sum((v - mean) ** 3 for v in vals) / n
    m4 = sum((v - mean) ** 4 for v in vals) / n
    return (m3 / (m2 ** 1.5), m4 / (m2 ** 2))


def expected_max_sharpe(n_trials: int, trial_sharpe_sd: float = 1.0) -> float:
    """
    The Sharpe a SEARCH WOULD PRODUCE FROM PURE NOISE, given how many things it tried.

    This is the number that makes the whole module honest. With `n_trials` independent strategies that
    all have zero true edge, the best observed Sharpe is not 0 — it is roughly this. Any observed
    Sharpe must beat it to mean anything.

    Uses the standard expected-maximum approximation for Gaussian order statistics
    (Bailey & Lopez de Prado): E[max] ≈ sd * ((1-γ)·z(1 - 1/N) + γ·z(1 - 1/(N·e))), γ the
    Euler-Mascheroni constant.
    """
    n = max(1, int(n_trials))
    if n == 1:
        return 0.0
    gamma = 0.5772156649015329
    a = _NORM.inv_cdf(1.0 - 1.0 / n)
    b = _NORM.inv_cdf(1.0 - 1.0 / (n * math.e))
    return trial_sharpe_sd * ((1.0 - gamma) * a + gamma * b)


def deflated_sharpe(
    observed_sharpe: float,
    n_obs: int,
    n_trials: int,
    skew: float = 0.0,
    kurtosis: float = 3.0,
    trial_sharpe_sd: float = 1.0,
) -> Optional[float]:
    """
    Probability that the observed Sharpe reflects a real edge rather than the best of many tries.

    Returns a probability in [0, 1], or None when it cannot be computed.

    Two corrections, both necessary:

      MULTIPLE TESTING — the benchmark is not zero but `expected_max_sharpe(n_trials)`. Searching more
      raises the bar the result must clear, which is the entire point: a strategy is not more credible
      for having been found among thousands, it is less.

      NON-NORMALITY — trading returns are skewed and fat-tailed. The standard error of a Sharpe
      estimate depends on both, and using the Gaussian form on fat-tailed returns understates the
      uncertainty, again in the flattering direction.
    """
    if n_obs < 2:
        return None
    sr = float(observed_sharpe)
    benchmark = expected_max_sharpe(n_trials, trial_sharpe_sd)

    # Standard error of the Sharpe estimate under non-normality (Lo, 2002).
    denom = n_obs - 1
    if denom <= 0:
        return None
    var = (1.0 - skew * sr + ((kurtosis - 1.0) / 4.0) * sr * sr) / denom
    if var <= 0:
        # A negative variance estimate means the moment inputs are not usable; refuse rather than
        # returning a confident-looking number derived from nonsense.
        return None
    se = math.sqrt(var)
    return _NORM.cdf((sr - benchmark) / se)


def max_drawdown(equity: Sequence[float]) -> float:
    """Largest peak-to-trough fall, as a positive fraction."""
    peak = None
    worst = 0.0
    for v in equity:
        x = float(v)
        peak = x if peak is None else max(peak, x)
        if peak and peak > 0:
            worst = max(worst, (peak - x) / peak)
    return worst


# ── Verdict ───────────────────────────────────────────────────────────────────
@dataclass
class Verdict:
    """
    What Rāma concluded, why, and what would change it.

    `meaning`, `risks` and `would_change` exist because master asked not to be dumped on: a table of
    statistics is not a judgement. The numbers stay available underneath; they are not the default
    presentation (spec Section 95).
    """
    passed: bool
    reason: str
    trades: int
    n_trials: int
    gross_sharpe: Optional[float] = None
    net_sharpe: Optional[float] = None
    deflated: Optional[float] = None
    benchmark_sharpe: Optional[float] = None
    win_rate: Optional[float] = None
    expectancy_pct: Optional[float] = None
    max_drawdown: Optional[float] = None
    cost_drag_pct: Optional[float] = None
    confidence: str = "none"          # none | provisional | measured
    provenance: dict = field(default_factory=dict)
    meaning: str = ""
    risks: list[str] = field(default_factory=list)
    would_change: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate(
    trade_returns_pct: Sequence[float],
    *,
    n_trials: int,
    cost_model: Optional[CostModel] = None,
    periods_per_year: int = 252,
    provenance: Optional[dict] = None,
    is_holdout: bool = False,
) -> Verdict:
    """
    Judge one strategy's realised trades.

    `n_trials` is REQUIRED and keyword-only. It is the number of variants the search examined before
    offering this one, and a caller who does not know it does not know whether the result means
    anything — so there is deliberately no default. Passing 1 asserts that this strategy was specified
    in advance and not selected from a search, which is a strong claim and should be a conscious one.
    """
    costs = cost_model or CostModel()
    gross = [float(r) for r in trade_returns_pct]
    n = len(gross)
    prov = dict(provenance or {})
    prov.setdefault("evaluatedOn", "holdout" if is_holdout else "search-window")

    if n == 0:
        return Verdict(
            passed=False, reason="no trades", trades=0, n_trials=n_trials, provenance=prov,
            meaning="This strategy never traded on the data supplied, so there is nothing to judge.",
            would_change=["Widen the entry conditions, or test over a longer history."],
        )

    net = [costs.apply(r) for r in gross]
    wins = sum(1 for r in net if r > 0)
    win_rate = wins / n
    expectancy = sum(net) / n

    equity = []
    acc = 100.0
    for r in net:
        acc *= (1.0 + r / 100.0)
        equity.append(acc)

    gs = sharpe(gross, periods_per_year)
    ns = sharpe(net, periods_per_year)
    skew, kurt = _moments(net)
    dsr = deflated_sharpe(ns, n, n_trials, skew, kurt) if ns is not None else None
    bench = expected_max_sharpe(n_trials)
    dd = max_drawdown(equity)
    drag = costs.round_trip_pct()

    base = dict(
        trades=n, n_trials=n_trials, gross_sharpe=gs, net_sharpe=ns, deflated=dsr,
        benchmark_sharpe=bench, win_rate=win_rate, expectancy_pct=expectancy,
        max_drawdown=dd, cost_drag_pct=drag, provenance=prov,
    )

    # ── The evidence floor comes first, before any metric is believed ─────────
    if n < MIN_TRADES:
        return Verdict(
            passed=False,
            reason=f"insufficient evidence: {n} trades, need {MIN_TRADES}",
            confidence="none",
            meaning=(
                f"Only {n} trades. That is too few to tell skill from luck, so Rāma is not "
                f"reporting a win rate or a Sharpe as if they meant something."
            ),
            risks=["A win rate from this few trades will not survive contact with live markets."],
            would_change=[
                f"At least {MIN_TRADES} trades, from a longer history or looser entry conditions.",
            ],
            **base,
        )

    if ns is None:
        return Verdict(
            passed=False, reason="return series has no variance to measure risk against",
            confidence="none",
            meaning="Every trade returned the same amount, which means the simulation is wrong "
                    "rather than that the strategy is riskless.",
            risks=["A constant return series usually indicates a bug in the backtest."],
            would_change=["Check the exit logic and that prices vary across the test window."],
            **base,
        )

    confidence = "measured" if n >= MIN_TRADES_CONFIDENT else "provisional"

    # ── Net of costs, or it is not a result ──────────────────────────────────
    if ns <= 0:
        return Verdict(
            passed=False, reason="no edge after costs", confidence=confidence,
            meaning=(
                f"Gross Sharpe {gs:.2f} becomes {ns:.2f} once the {drag:.2f}% round-trip cost is "
                f"applied. The apparent edge is smaller than the cost of trading it."
            ),
            risks=["Trading this would convert a modest gross edge into a reliable loss."],
            would_change=[
                "Fewer, larger trades so the fixed cost matters less.",
                "Confirm the cost assumptions match master's actual broker.",
            ],
            **base,
        )

    # ── And finally: is it better than what searching alone would produce? ───
    if dsr is None:
        return Verdict(
            passed=False, reason="could not deflate the Sharpe for the number of trials",
            confidence=confidence,
            meaning="The return distribution is too irregular to judge reliably against the number "
                    "of variants tried.",
            would_change=["More trades, or a search over fewer variants."],
            **base,
        )

    if dsr < DSR_THRESHOLD:
        return Verdict(
            passed=False,
            reason=f"not distinguishable from the best of {n_trials} random tries",
            confidence=confidence,
            meaning=(
                f"Net Sharpe {ns:.2f} sounds good, but searching {n_trials} variants would produce "
                f"about {bench:.2f} from pure noise. Allowing for that, the chance this is a real "
                f"edge is {dsr * 100:.0f}%, short of the {DSR_THRESHOLD * 100:.0f}% required."
            ),
            risks=[
                "This is the shape of result that backtests well and loses money live.",
                f"The more variants are tried, the higher {bench:.2f} climbs.",
            ],
            would_change=[
                "A larger margin over the noise benchmark, not a longer search.",
                "Testing far fewer, theory-driven variants instead of many arbitrary ones.",
            ],
            **base,
        )

    return Verdict(
        passed=True,
        reason=f"net Sharpe {ns:.2f} clears the {n_trials}-trial noise benchmark {bench:.2f}",
        confidence=confidence,
        meaning=(
            f"After {drag:.2f}% round-trip costs, net Sharpe is {ns:.2f} over {n} trades. "
            f"Allowing for {n_trials} variants tried, the chance this is a real edge is "
            f"{dsr * 100:.0f}%."
            + ("" if confidence == "measured"
               else f" Provisional: under {MIN_TRADES_CONFIDENT} trades, so treat it as a lead.")
        ),
        risks=[
            f"Worst peak-to-trough fall was {dd * 100:.1f}%; master must be able to sit through that.",
            "A backtested win rate is not a forward-looking probability.",
        ]
        + ([] if is_holdout else
           ["Measured on the search window, so it is not yet an out-of-sample result."]),
        would_change=[
            "A holdout run that fails would overturn this." if not is_holdout
            else "Live results diverging from this would overturn it.",
            "Higher real costs than assumed would reduce or remove the edge.",
        ],
        **base,
    )


def search_and_judge(
    variants: Iterable[dict],
    run: Callable[[dict, int, int], Sequence[float]],
    *,
    n: int,
    holdout_frac: float = DEFAULT_HOLDOUT_FRAC,
    cost_model: Optional[CostModel] = None,
    provenance: Optional[dict] = None,
) -> dict:
    """
    Search for a strategy, then judge the winner ON DATA THE SEARCH NEVER SAW.

    `run(variant, start, end)` returns that variant's trade returns over `[start, end)`.

    THE STRUCTURE IS THE SAFEGUARD. The search ranks variants on `[0, search_end)` only. Exactly one
    variant is then evaluated once on the holdout. A holdout consulted while choosing has already
    become training data, and the commonest way to ruin this is to peek at holdout scores for several
    candidates and pick the best — so only the winner is ever run against it.

    The returned `trials` count is what makes the holdout number interpretable, and it is carried
    through rather than left for a caller to remember.
    """
    search_end, total = holdout_split(n, holdout_frac)
    costs = cost_model or CostModel()

    ranked = []
    trials = 0
    for v in variants:
        trials += 1
        rets = run(v, 0, search_end)
        s = sharpe([costs.apply(r) for r in rets])
        ranked.append((s if s is not None else float("-inf"), trials, v, len(rets)))

    if trials == 0:
        return {"ok": False, "reason": "no variants supplied", "trials": 0}

    ranked.sort(key=lambda t: t[0], reverse=True)
    best_score, _, best_variant, best_n = ranked[0]

    if best_score == float("-inf"):
        return {"ok": False, "reason": "no variant produced a measurable result", "trials": trials}

    holdout_returns = run(best_variant, search_end, total)
    verdict = evaluate(
        holdout_returns,
        n_trials=trials,
        cost_model=costs,
        provenance=provenance,
        is_holdout=True,
    )

    return {
        "ok": True,
        "trials": trials,
        "variant": best_variant,
        "searchSharpe": best_score,
        "searchTrades": best_n,
        "holdout": verdict.to_dict(),
        # Said explicitly: the in-sample number is the one that must not be quoted on its own.
        "note": (
            f"searchSharpe {best_score:.2f} is in-sample across {trials} trials and is NOT evidence; "
            "the holdout verdict is."
        ),
    }
