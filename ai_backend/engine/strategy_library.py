"""
strategy_library.py — trading strategies drawn from the literature, as falsifiable specs.

Master: *"refer various popular and high rated trading/StockMarket books and Authors suggestions and
record them and analyze along with relevant data to formulate long term, short term strategies and
backtest them."*

THE CENTRAL RULE: A BOOK IS A HYPOTHESIS, NOT EVIDENCE. Every entry here records an author's claim, where
it can be read, the mechanism proposed, and — the part that matters — WHAT WOULD DISCONFIRM IT. None of
that is a result. A template ships with `evidence: "published"` and can only ever become `"measured"` by
clearing `strategy_eval` on master's own data. The same two-kinds-of-evidence discipline as `modelRoles`
(Section 112): published evidence is about the claim, measured evidence is about this instrument.

WHY EACH TEMPLATE CARRIES AN EXPECTED SHAPE. Master asked for strategies with a success rate "near to 80
and above". `expected_shape` states, per template, the win rate and payoff ratio the author's own logic
implies — and they are inversely related in every single case. Livermore's breakout is SUPPOSED to lose
most trades. Bollinger reversion is supposed to win most and win small. Reading the library makes the
point better than any warning: **a win rate is a description of a strategy's shape, not a measure of its
quality**, and screening on it selects the shape, not the quality. See `win_rate_warning()`.

SWEEPS ARE NARROW AND THEORY-DRIVEN, never grids. `strategy_eval` raises the bar in proportion to the
trial count, so a library that shipped 10,000-variant sweeps would make its own templates unprovable.
Where a sweep exists it holds the author's OWN stated alternatives — Donchian's 20 and 55, the paper's 9
and 12 months — and nothing else.

STDLIB ONLY. Same reason as `strategy_spec` and `costs`: verifiable with no scientific stack.
"""

from __future__ import annotations

from typing import Optional

# Reusing the vocabulary from Section 112 rather than inventing a second one.
PUBLISHED = "published"      # the author's claim, about the claim
MEASURED = "measured"        # cleared strategy_eval on master's own data

LONG_TERM = "long"           # months to years; daily or weekly bars
SHORT_TERM = "short"         # days to weeks; the swing horizon
INTRADAY = "intraday"


# ── Templates that the existing block vocabulary can actually express ──────────
#
# Each `entry`/`exit` below is a fragment. `build()` completes it into a spec `validate_spec` accepts,
# so a template that drifts out of the block catalogue fails a test rather than failing in front of
# master.

TEMPLATES: dict = {
    # ── Trend and breakout: low win rate, high payoff, by design ─────────────
    "livermore_breakout": {
        "name": "Line of least resistance (Livermore)",
        "horizon": SHORT_TERM,
        "side": "long",
        "source": {
            "author": "Edwin Lefevre (on Jesse Livermore)",
            "work": "Reminiscences of a Stock Operator",
            "year": 1923,
            "free": "Project Gutenberg ebook 60979; archive.org — public domain",
        },
        "claim": ("Buy when price breaks out of its recent range in the direction the trend is already "
                  "going; cut the loss quickly and let the winner run."),
        "mechanism": ("A range break is where supply at the old level has been exhausted. The asymmetric "
                      "exit is the strategy: most breakouts fail, and the few that do not pay for them."),
        "disconfirms": ("A payoff ratio at or below 1. This strategy has no other way to make money — "
                        "it is designed to lose most of its trades."),
        "entry": {"op": "all", "blocks": [
            {"id": "breakout", "params": {"lookback": 20, "direction": "up"}},
            {"id": "higher_structure", "params": {"span": 3, "swings": 2}},
        ]},
        "exit": {"stopPct": 3.0, "targetPct": 12.0, "maxBars": 60},
        # Donchian's own two lookbacks, and nothing between them.
        "sweep": {"0.lookback": [20, 55]},
        "shape": {"winRate": "below 50%", "payoff": "3 or better",
                  "why": "asymmetric by construction: a 3% stop against a 12% target"},
    },

    "wyckoff_volume_breakout": {
        "name": "Breakout confirmed by volume (Wyckoff)",
        "horizon": SHORT_TERM,
        "side": "long",
        "source": {
            "author": "Richard D. Wyckoff",
            "work": "Studies in Tape Reading (1910); The Day Trader's Bible (1919)",
            "year": 1910,
            "free": "archive.org — public domain",
        },
        "claim": ("Price movement is only meaningful when volume confirms it. A breakout on thin volume "
                  "is not accumulation, it is drift."),
        "mechanism": ("Volume is the trace of large participants. A move without it has no one behind "
                      "it to continue it."),
        "disconfirms": ("The same breakout WITHOUT the volume condition performing as well or better. "
                        "That is a one-line comparison and it is the whole test of Wyckoff's claim."),
        "entry": {"op": "all", "blocks": [
            {"id": "breakout", "params": {"lookback": 20, "direction": "up"}},
            {"id": "volume_surge", "params": {"period": 20, "mult": 2.0}},
        ]},
        "exit": {"stopPct": 3.0, "targetPct": 9.0, "maxBars": 40},
        "sweep": {"1.mult": [1.5, 2.0, 3.0]},
        "shape": {"winRate": "45-55%", "payoff": "2 or better",
                  "why": "the volume filter should raise the win rate over a bare breakout, or the "
                         "claim is wrong"},
    },

    "dow_primary_trend": {
        "name": "Primary trend (Dow / Hamilton)",
        "horizon": LONG_TERM,
        "side": "long",
        "source": {
            "author": "William Peter Hamilton, after Charles H. Dow",
            "work": "The Stock Market Barometer",
            "year": 1922,
            "free": "archive.org, Project Gutenberg — public domain",
        },
        "claim": ("A primary trend persists for months or years, and is identified by successively "
                  "higher peaks and troughs. Trade with it and ignore the minor swings."),
        "mechanism": ("Trends reflect the slow revision of collective expectation, which does not "
                      "complete in a day."),
        "disconfirms": ("Returns no better than buy-and-hold over the same window. A long-only trend "
                        "filter on a rising instrument is the classic way to mistake the market's own "
                        "return for a strategy's."),
        "entry": {"op": "all", "blocks": [
            {"id": "price_vs_sma", "params": {"period": 200, "side": "above"}},
            {"id": "higher_structure", "params": {"span": 5, "swings": 2}},
        ]},
        "exit": {"stopPct": 8.0, "targetPct": None, "maxBars": 250},
        "sweep": {},
        "shape": {"winRate": "40-55%", "payoff": "2 or better",
                  "why": "few trades, each held a long time; the drawdowns are the cost"},
    },

    "tsmom_12m": {
        "name": "Time-series momentum, 12 month (Moskowitz, Ooi & Pedersen)",
        "horizon": LONG_TERM,
        "side": "long",
        "source": {
            "author": "Tobias Moskowitz, Yao Hua Ooi, Lasse Heje Pedersen",
            "work": "Time Series Momentum, Journal of Financial Economics",
            "year": 2012,
            "free": "AQR publishes the paper free; also on SSRN",
        },
        "claim": ("An instrument's own past 12-month excess return positively predicts its next-month "
                  "return. The effect persists about a year, then partially reverses."),
        "mechanism": ("Initial under-reaction followed by delayed over-reaction — the authors' own "
                      "sentiment explanation. Extended to 1880 by Hurst, Ooi & Pedersen (2014), "
                      "'A Century of Evidence on Trend-Following Investing', also free."),
        "disconfirms": ("No edge over buy-and-hold net of costs, or an edge that disappears outside the "
                        "futures markets the paper studied. The paper is about a diversified FUTURES "
                        "portfolio; a single Indian equity is not that, and the transfer is an "
                        "assumption rather than a finding."),
        "entry": {"op": "all", "blocks": [
            {"id": "price_vs_sma", "params": {"period": 252, "side": "above"}},
        ]},
        "exit": {"stopPct": 15.0, "targetPct": None, "maxBars": 250},
        # The paper's own two lookbacks: 9 and 12 months of trading days.
        "sweep": {"0.period": [189, 252]},
        "shape": {"winRate": "35-50%", "payoff": "3 or better",
                  "why": "the published result is driven by a small number of large trends"},
    },

    "schabacker_trendline": {
        "name": "Trendline break (Schabacker)",
        "horizon": SHORT_TERM,
        "side": "long",
        "source": {
            "author": "Richard W. Schabacker",
            "work": "Technical Analysis and Stock Market Profits",
            "year": 1932,
            "free": "archive.org — the foundation Edwards & Magee later built on",
        },
        "claim": "A break of an established trendline marks a change of control between buyers and sellers.",
        "mechanism": "A trendline is where demand has repeatedly appeared; its failure says it has stopped.",
        "disconfirms": ("Results no better than a fixed-lookback breakout. A fitted line has more "
                        "freedom than a range high, and more freedom is more chance to fit noise."),
        "entry": {"op": "all", "blocks": [
            {"id": "trendline_break", "params": {"lookback": 30, "direction": "up"}},
            {"id": "volume_surge", "params": {"period": 20, "mult": 1.5}},
        ]},
        "exit": {"stopPct": 4.0, "targetPct": 10.0, "maxBars": 45},
        "sweep": {"0.lookback": [20, 30, 50]},
        "shape": {"winRate": "40-50%", "payoff": "2 or better", "why": "a breakout strategy in a "
                  "different coat, and should be compared against one"},
    },

    # ── Mean reversion: high win rate, low payoff, by design ─────────────────
    "bollinger_reversion": {
        "name": "Band touch reversion (Bollinger)",
        "horizon": SHORT_TERM,
        "side": "long",
        "source": {
            "author": "John Bollinger",
            "work": "Bollinger on Bollinger Bands",
            "year": 2001,
            "free": "bollingerbands.com publishes the rules and the author's own cautions",
        },
        "claim": ("Price touching the lower band is stretched relative to its recent range. Bollinger "
                  "himself states the bands are NOT a standalone signal and require confirmation."),
        "mechanism": "Short-term overreaction in a range-bound instrument reverts to the mean.",
        "disconfirms": ("A trending instrument. In a downtrend the lower band is touched all the way "
                        "down, and this becomes a way to buy every step of a decline."),
        "entry": {"op": "all", "blocks": [
            {"id": "bollinger_touch", "params": {"period": 20, "mult": 2.0, "side": "lower"}},
            {"id": "rsi_band", "params": {"period": 14, "level": 30.0, "side": "below"}},
        ]},
        "exit": {"stopPct": 4.0, "targetPct": 3.0, "maxBars": 10},
        "sweep": {"0.mult": [2.0, 2.5]},
        # THE TEMPLATE THAT MAKES MASTER'S POINT FOR HIM.
        "shape": {"winRate": "65-80%", "payoff": "below 1",
                  "why": "THIS IS THE 80% SHAPE. A 3% target against a 4% stop wins often and loses "
                         "more when it loses. At a payoff of 0.75 it needs 57% wins merely to break "
                         "even, and costs push that higher. A high win rate here is the strategy's "
                         "GEOMETRY, not its edge."},
    },

    "wilder_pullback_in_trend": {
        "name": "Oversold inside an uptrend (Wilder)",
        "horizon": SHORT_TERM,
        "side": "long",
        "source": {
            "author": "J. Welles Wilder Jr.",
            "work": "New Concepts in Technical Trading Systems",
            "year": 1978,
            "free": "The RSI and ATR formulas are published everywhere; the book is not free",
        },
        "claim": ("RSI below 30 marks an oversold condition. Taken only in the direction of the larger "
                  "trend, it is a pullback entry rather than a bottom-picking one."),
        "mechanism": ("A trend that is intact reasserts itself after a shallow counter-move; the trend "
                      "filter is what separates a pullback from a reversal."),
        "disconfirms": ("Removing the 200-day filter not making it worse. If the filter does nothing, "
                        "this is bottom-picking with extra steps."),
        "entry": {"op": "all", "blocks": [
            {"id": "price_vs_sma", "params": {"period": 200, "side": "above"}},
            {"id": "rsi_band", "params": {"period": 14, "level": 30.0, "side": "below"}},
        ]},
        "exit": {"stopPct": 5.0, "targetPct": 6.0, "maxBars": 20},
        "sweep": {"1.level": [25.0, 30.0, 35.0]},
        "shape": {"winRate": "55-70%", "payoff": "around 1",
                  "why": "roughly symmetric exits, so the win rate has to carry the result"},
    },

    "kaufman_volatility_expansion": {
        "name": "Volatility expansion breakout (Kaufman)",
        "horizon": SHORT_TERM,
        "side": "long",
        "source": {
            "author": "Perry J. Kaufman",
            "work": "Trading Systems and Methods",
            "year": 1978,
            "free": "The efficiency ratio is published widely; Rama already computes it as "
                    "efficiency_ratio_10 in features.py",
        },
        "claim": ("A breakout matters more when volatility is expanding; a quiet market's range break "
                  "is noise."),
        "mechanism": "Expanding true range signals new information arriving rather than drift.",
        "disconfirms": "No improvement over the unfiltered breakout it is built from.",
        "entry": {"op": "all", "blocks": [
            {"id": "atr_expansion", "params": {"period": 14, "baseline": 50, "mult": 1.5}},
            {"id": "breakout", "params": {"lookback": 20, "direction": "up"}},
        ]},
        "exit": {"stopPct": 4.0, "targetPct": 12.0, "maxBars": 30},
        "sweep": {"0.mult": [1.3, 1.5, 2.0]},
        "shape": {"winRate": "40-50%", "payoff": "2.5 or better",
                  "why": "a breakout filter; the asymmetry does the work"},
    },

    "livermore_short": {
        "name": "Breakdown in a failing structure (Livermore, short)",
        "horizon": SHORT_TERM,
        "side": "short",
        "source": {
            "author": "Edwin Lefevre (on Jesse Livermore)",
            "work": "Reminiscences of a Stock Operator",
            "year": 1923,
            "free": "Project Gutenberg ebook 60979 — public domain",
        },
        "claim": "The same logic downward: sell the break of support when peaks and troughs are falling.",
        "mechanism": "Demand that repeatedly failed at a level has been shown to be absent.",
        "disconfirms": ("Indian equity indices have risen over most measurable history, so a short book "
                        "starts against the drift. A short strategy that merely loses less than the "
                        "index rose has found nothing."),
        "entry": {"op": "all", "blocks": [
            {"id": "breakout", "params": {"lookback": 20, "direction": "down"}},
            {"id": "lower_structure", "params": {"span": 3, "swings": 2}},
        ]},
        "exit": {"stopPct": 3.0, "targetPct": 9.0, "maxBars": 40},
        "sweep": {"0.lookback": [20, 55]},
        "shape": {"winRate": "below 50%", "payoff": "2.5 or better",
                  "why": "asymmetric, and fighting the long-run drift as well"},
    },
}


# ── Recorded, and NOT implementable in this harness ───────────────────────────
#
# Offered and refused, naming the missing capability — the same rule `strategy_spec` applies to model
# probability and news sentiment. A library that silently omitted these would read as "the literature
# contains nothing else", which is the opposite of true.

BLOCKED: dict = {
    "sinclair_variance_premium": {
        "name": "Short variance / option premium selling (Sinclair)",
        "source": {"author": "Euan Sinclair", "work": "Volatility Trading; Positional Option Trading",
                   "year": 2013, "free": "No; the variance-risk-premium literature on SSRN is free"},
        "claim": ("Implied volatility is on average higher than subsequently realised volatility, so "
                  "selling options carries a genuine risk premium. Sinclair is also explicit that the "
                  "high win rate of premium selling is a property of its PAYOFF SHAPE and not evidence "
                  "of edge — the same point that makes an 80% target the wrong target."),
        "needs": ["implied volatility", "option greeks", "a multi-leg position model",
                  "per-strike historical option prices", "a margin model"],
        "why": ("`derivatives.py` deliberately computes no implied volatility: neither NSE bhavcopy "
                "carries an IV column, and back-solving Black-Scholes across 21 years needs assumed "
                "rate and dividend curves. `straddle_pct` is used instead precisely because it assumes "
                "nothing. And `simulate()` holds ONE position in ONE instrument with a percent stop on "
                "spot, so a spread cannot be expressed at all."),
    },
    "natenberg_delta_neutral": {
        "name": "Delta-neutral volatility positions (Natenberg)",
        "source": {"author": "Sheldon Natenberg", "work": "Option Volatility & Pricing", "year": 1994,
                   "free": "No"},
        "claim": "Trade the difference between implied and realised volatility, hedging away direction.",
        "needs": ["option greeks", "continuous delta hedging", "a multi-leg position model"],
        "why": "No greeks anywhere in the engine, and no leg model. Same gap as above.",
    },
    "taleb_tail_hedge": {
        "name": "Convex tail hedging (Taleb)",
        "source": {"author": "Nassim Nicholas Taleb", "work": "Dynamic Hedging", "year": 1997,
                   "free": "No; the essays on the payoff asymmetry are free"},
        "claim": ("Pay a small certain cost for a large uncertain payoff. The mirror image of premium "
                  "selling, and the reason a high win rate and a positive expectancy are different "
                  "questions — a tail hedge wins almost never and can still be correct."),
        "needs": ["far out-of-the-money option pricing history", "a multi-leg position model"],
        "why": ("Worth recording precisely because it is the counterexample to a win-rate screen: this "
                "strategy would be rejected by ANY minimum-win-rate filter, including master's 80%."),
    },
    "jegadeesh_titman_cross_sectional": {
        "name": "Cross-sectional momentum (Jegadeesh & Titman)",
        "source": {"author": "Narasimhan Jegadeesh, Sheridan Titman",
                   "work": "Returns to Buying Winners and Selling Losers, Journal of Finance",
                   "year": 1993, "free": "Widely available free as a working paper"},
        "claim": "Buy the past 3-12 month winners and sell the losers, RANKED ACROSS A UNIVERSE.",
        "needs": ["a universe of instruments ranked against each other", "a portfolio model",
                  "simultaneous positions"],
        "why": ("`simulate()` is one instrument, one position at a time, and the trade-return series "
                "`strategy_eval` judges assumes independent round trips. Cross-sectional ranking is a "
                "portfolio question, and a portfolio model does not exist. This is a real and "
                "well-evidenced strategy that Rama currently cannot express."),
    },
    "oi_positioning": {
        "name": "Open-interest positioning (PCR, max pain, basis, rollover)",
        "source": {"author": "NSE derivatives archive", "work": "Bhavcopy-derived daily metrics",
                   "year": 2026,
                   "free": "Yes, and the history is already on disk — stored by derivatives.py"},
        "claim": ("Put-call ratio, max-pain distance, futures basis and rollover percentage describe "
                  "where positioning sits, and positioning constrains price near expiry."),
        "needs": ["a strategy block that can read the deriv1d series"],
        "why": ("THE SMALLEST REAL GAP IN THIS LIST. The history is already on disk — `DERIV_COLUMNS` "
                "holds pcr_oi, max_pain_dist, fut_basis_pct, rollover_pct and more, per day, back "
                "years. But every block in `BLOCKS` recomputes its indicator from OHLCV bars and "
                "nothing can read a second series. So 'PCR above 1.3' is unexpressible even though the "
                "data to backtest it is sitting in the store. One new block shape closes this."),
    },
}


# ── Method claims: these change how results are REPORTED, not what is traded ──

METHOD_SOURCES = (
    {"author": "Van K. Tharp", "work": "Trade Your Way to Financial Freedom", "year": 1998,
     "claim": ("Expectancy — average win times win rate, less average loss times loss rate — is the "
               "number that decides whether a system makes money. Position sizing, not entry, "
               "determines the outcome."),
     "appliedIn": "strategy_eval.Verdict.expectancy_pct, payoff_ratio and breakeven_win_rate; "
                  "strategy_spec.position_size sizes from the stop distance"},
    {"author": "Marcos Lopez de Prado", "work": "Advances in Financial Machine Learning", "year": 2018,
     "claim": ("Backtest overfitting is the central failure of quantitative strategy research. Report a "
               "deflated Sharpe against the number of trials, and purge label overlap when splitting."),
     "appliedIn": "strategy_eval.deflated_sharpe, expected_max_sharpe, purged_walk_forward"},
    {"author": "David Bailey, Marcos Lopez de Prado", "work": "The Deflated Sharpe Ratio", "year": 2014,
     "claim": "The expected maximum Sharpe from N random trials is far above zero, so an observed "
              "Sharpe must beat that benchmark to mean anything.",
     "appliedIn": "strategy_eval.expected_max_sharpe — the noise benchmark printed in every verdict"},
    {"author": "Andrew W. Lo", "work": "The Statistics of Sharpe Ratios", "year": 2002,
     "claim": "Sharpe ratio standard errors must account for non-normality and autocorrelation.",
     "appliedIn": "strategy_eval.deflated_sharpe, which takes skew and kurtosis"},
)


def win_rate_warning() -> dict:
    """
    Why this library will not screen on win rate — the direct answer to master's 80% target.

    Returned as data rather than written in a comment, so it can be shown on screen next to the field
    where master would otherwise type a number.
    """
    return {
        "headline": "A win rate describes a strategy's shape, not its quality.",
        "reasons": [
            ("A high win rate is cheap to buy. Take profits early and hold losers, or sell option "
             "premium, and 80-90% of trades win while the strategy loses money. Six of the templates "
             "here are DESIGNED to win under half their trades."),
            ("Screening on win rate therefore selects the shape — small wins, rare large losses — that "
             "is most likely to ruin an account. It does not select for edge."),
            ("A high win rate means few losses, so the loss side is the least-observed part of the "
             "record. The more impressive the win rate, the less is known about what a loss costs."),
            ("Searching enough combinations always produces some that clear 80%. With enough trials "
             "that is a property of the search, not of the market — which is what the deflated Sharpe "
             "against trial count exists to measure."),
        ],
        "instead": [
            "Expectancy after costs — what the average trade actually returns.",
            "Payoff ratio and the break-even win rate this payoff requires.",
            "Worst trade and the worst 5% of trades, because that is the part that ends accounts.",
            "The deflated Sharpe against how many variants were tried.",
        ],
        "reported": ("The win rate IS reported, on every verdict, alongside all of the above and a "
                     "plain-language caveat when the two disagree. It is never a filter."),
        "counterexample": ("Taleb's tail hedge wins almost no trades and can still be correct. Any "
                           "minimum-win-rate filter rejects it. That is the filter being wrong, not "
                           "the strategy."),
    }


def expected_shape(template_id: str) -> Optional[dict]:
    """
    What win rate and payoff the author's own logic implies, BEFORE any backtest.

    Stated in advance so a measured result can contradict it. A template whose measured win rate lands
    far outside its expected shape is either misimplemented or has found something the author did not
    describe, and both are worth knowing.
    """
    t = TEMPLATES.get(template_id)
    return dict(t["shape"], template=template_id, evidence=PUBLISHED) if t else None


def build(template_id: str, *, symbol: str, exchange: str = "NSE", interval: str = "1d",
          capital: float = 100000.0, risk_pct: float = 1.0,
          include_sweep: bool = True, costs: Optional[dict] = None) -> dict:
    """
    Complete a template into a spec `strategy_spec.validate_spec` accepts.

    `include_sweep=False` yields exactly one variant, which is the honest way to test a template as the
    author STATED it: a trial count of 1 asserts the parameters were specified in advance rather than
    selected, and that is the strongest form of this evidence available.
    """
    t = TEMPLATES.get(template_id)
    if t is None:
        raise KeyError(f"unknown template {template_id!r}; use one of {', '.join(sorted(TEMPLATES))}")
    entry = {"op": t["entry"].get("op", "all"), "k": t["entry"].get("k", 1),
             "blocks": [{"id": b["id"], "params": dict(b["params"])} for b in t["entry"]["blocks"]]}
    spec = {
        "name": t["name"],
        "symbol": str(symbol or "").upper().strip(),
        "exchange": exchange,
        "interval": interval,
        "side": t["side"],
        "entry": entry,
        "exit": dict(t["exit"]),
        "sizing": {"capital": float(capital), "riskPct": float(risk_pct)},
        "sweep": dict(t.get("sweep") or {}) if include_sweep else {},
    }
    if costs:
        spec["costs"] = dict(costs)
    return spec


def provenance(template_id: str) -> Optional[dict]:
    """Where a template came from and what would disconfirm it. Never a result."""
    t = TEMPLATES.get(template_id) or BLOCKED.get(template_id)
    if t is None:
        return None
    return {
        "template": template_id,
        "name": t["name"],
        "source": t["source"],
        "claim": t["claim"],
        "mechanism": t.get("mechanism"),
        "disconfirms": t.get("disconfirms"),
        # Said on every single one, because a cited author reads as an endorsement otherwise.
        "evidence": PUBLISHED,
        "evidenceNote": ("This is the author's claim, not a measured result. It becomes evidence about "
                         "master's instrument only after clearing strategy_eval on master's own data."),
    }


def catalogue() -> dict:
    """Everything the library knows, including what it cannot express and why."""
    return {
        "templates": [
            {
                "id": tid,
                "name": t["name"],
                "horizon": t["horizon"],
                "side": t["side"],
                "author": t["source"]["author"],
                "work": t["source"]["work"],
                "year": t["source"]["year"],
                "free": t["source"]["free"],
                "claim": t["claim"],
                "disconfirms": t["disconfirms"],
                "blocks": [b["id"] for b in t["entry"]["blocks"]],
                "trials": _trials(t.get("sweep") or {}),
                "shape": t["shape"],
                "evidence": PUBLISHED,
            }
            for tid, t in TEMPLATES.items()
        ],
        "blocked": [
            {"id": bid, "name": b["name"], "author": b["source"]["author"], "work": b["source"]["work"],
             "claim": b["claim"], "needs": b["needs"], "why": b["why"]}
            for bid, b in BLOCKED.items()
        ],
        "methodSources": [dict(m) for m in METHOD_SOURCES],
        "winRateWarning": win_rate_warning(),
        "horizons": {LONG_TERM: "months to years", SHORT_TERM: "days to weeks",
                     INTRADAY: "within one session"},
        "note": ("Every entry is a hypothesis with a named source and a stated way to disprove it. None "
                 "is a result. Rama's verdict comes from strategy_eval on master's own data, and a "
                 "template that fails there has failed regardless of who wrote the book."),
    }


def _trials(sweep: dict) -> int:
    total = 1
    for v in (sweep or {}).values():
        total *= max(1, len(v))
    return total


def by_horizon(horizon: str) -> list:
    """Template ids for one horizon. Master picks long term or short term; this is that list."""
    return [tid for tid, t in TEMPLATES.items() if t["horizon"] == horizon]
