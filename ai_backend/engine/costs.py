"""
costs.py — what a trade actually costs in rupees on an Indian exchange.

Master: *"including trading charges for no. of trades suggested and actually taken."*

WHY THE EXISTING COST MODEL COULD NOT ANSWER THIS. `strategy_eval.CostModel` is three percentages
subtracted from a percent return. Indian charges do not have that shape:

  - Brokerage is ₹20 PER ORDER, or a percentage capped at ₹20. A flat rupee fee is 0.40% of a ₹5,000
    trade and 0.004% of a ₹5,00,000 trade — a hundredfold difference that no single percentage can
    express. The flat model therefore flatters small trades by exactly the amount that kills them.
  - STT is side-dependent (sell only for intraday, futures and options; both sides for delivery) and is
    charged on PREMIUM for options, not on contract value.
  - Stamp duty is buy-side only. DP charges are a flat rupee amount on delivery sells regardless of size.
  - GST at 18% applies to brokerage, exchange, SEBI and IPFT — and NOT to STT or stamp duty. Applying it
    to everything overstates; applying it to nothing understates.

So this module works in RUPEES, per order, and knows which instrument it is pricing. The percentage
conversion is available but REQUIRES a notional and reports the notional it assumed, because "what does
trading cost as a percentage" is an unanswerable question until someone says at what size.

RATES CHANGE WITH EVERY BUDGET. Every number here carries its source and the date it took effect, and
`provenance()` returns the lot so any verdict can print which rates produced it. `staleness()` says how
old the table is. **Master's own contract note is the authority** — this is a model of his broker's
charges, not a quotation from it, and it says so.

STDLIB ONLY, no I/O, no network. Same reason as `strategy_eval` and `strategy_spec`: this is a layer
results depend on, so it must be testable on a machine with no scientific stack — including this one.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field, asdict
from typing import Optional

# ── Instruments ───────────────────────────────────────────────────────────────
#
# Named rather than inferred. The same underlying traded as delivery, as intraday, as a future and as an
# option attracts four different charge structures differing by more than an order of magnitude, and
# guessing which one master meant is the kind of silent assumption this project does not make.

EQUITY_DELIVERY = "equity_delivery"
EQUITY_INTRADAY = "equity_intraday"
FUTURES = "futures"
OPTIONS = "options"

INSTRUMENTS = (EQUITY_DELIVERY, EQUITY_INTRADAY, FUTURES, OPTIONS)

INSTRUMENT_LABELS = {
    EQUITY_DELIVERY: "Equity delivery (CNC)",
    EQUITY_INTRADAY: "Equity intraday (MIS)",
    FUTURES: "Futures",
    OPTIONS: "Options",
}

# ── The rate table ────────────────────────────────────────────────────────────
#
# `TABLE_AS_OF` is the date these rates took effect, NOT the date they were written down. A rate table
# whose timestamp records when someone last looked cannot distinguish "current" from "unchanged since
# nobody checked".

TABLE_AS_OF = "2026-04-01"

# ── Rates have a HISTORY, because they change (Section 116) ───────────────────
#
# Master: *"Rama should have the ability to fetch latest charges info based on any news of price changes.
# not every day or some thing like that."*
#
# THE DEFECT THAT REQUIREMENT EXPOSED. A single current table means a backtest over 2023-2026 prices
# every trade at today's rates. Options STT went 0.0625% -> 0.10% -> 0.15% of premium across two changes,
# so a three-year options backtest was overstating early costs by more than double — and a cost error in
# EITHER direction invalidates a verdict, because `strategy_eval` refuses anything whose edge is smaller
# than its costs. Rates that change on news are rates with a history, and a backtest must price each
# trade at the rate that was in force.
#
# EACH ENTRY IS COMPLETE, not a partial overlay on its predecessor. Duplication is the point: with a
# partial overlay, a key someone forgot to restate silently inherits a rate from a different era, and
# that is invisible in review.
#
# BEFORE THE EARLIEST ENTRY, RATES ARE DECLARED UNKNOWN rather than guessed backwards. Pre-October-2024
# Indian rates are recoverable but this session could not source them to the precision the rest of this
# table holds, and inventing them would be the fabrication Section 94 removed — with the added harm that
# a plausible wrong rate is worth less than an admitted gap.

EARLIEST_KNOWN = "2024-10-01"

RATE_HISTORY = [
    {
        "from": "2024-10-01",
        "source": ("SEBI 'true to label' circular effective 2024-10-01: options STT raised to 0.10% "
                   "from 0.0625% and the options transaction charge cut to 0.035% from 0.0495%; futures "
                   "STT raised to 0.02%. Corroborated by the Budget-2026 coverage, which describes the "
                   "2026 rise as being FROM these values."),
        "stt": {
            EQUITY_DELIVERY: {"pct": 0.100, "side": "both", "basis": "turnover"},
            EQUITY_INTRADAY: {"pct": 0.025, "side": "sell", "basis": "turnover"},
            FUTURES:         {"pct": 0.020, "side": "sell", "basis": "turnover"},
            OPTIONS:         {"pct": 0.100, "side": "sell", "basis": "premium"},
        },
        "exchangeTxn": {EQUITY_DELIVERY: 0.00297, EQUITY_INTRADAY: 0.00297,
                        FUTURES: 0.00173, OPTIONS: 0.03503},
        "stampDuty": {EQUITY_DELIVERY: 0.015, EQUITY_INTRADAY: 0.003,
                      FUTURES: 0.002, OPTIONS: 0.003},
        "ipft": {EQUITY_DELIVERY: 0.0001, EQUITY_INTRADAY: 0.0001,
                 FUTURES: 0.0001, OPTIONS: 0.0005},
        "sebiTurnoverPct": 0.0001,
        "gstPct": 18.0,
        "dpChargeInr": 15.0,
    },
    {
        "from": "2026-04-01",
        "source": ("Union Budget 2026, effective 2026-04-01: STT on futures raised to 0.05% from 0.02% "
                   "and on options premium to 0.15% from 0.10%, both sell side. Cross-confirmed across "
                   "three independent publishers."),
        "stt": {
            EQUITY_DELIVERY: {"pct": 0.100, "side": "both", "basis": "turnover"},
            EQUITY_INTRADAY: {"pct": 0.025, "side": "sell", "basis": "turnover"},
            FUTURES:         {"pct": 0.050, "side": "sell", "basis": "turnover"},
            OPTIONS:         {"pct": 0.150, "side": "sell", "basis": "premium"},
        },
        "exchangeTxn": {EQUITY_DELIVERY: 0.00297, EQUITY_INTRADAY: 0.00297,
                        FUTURES: 0.00173, OPTIONS: 0.03503},
        "stampDuty": {EQUITY_DELIVERY: 0.015, EQUITY_INTRADAY: 0.003,
                      FUTURES: 0.002, OPTIONS: 0.003},
        "ipft": {EQUITY_DELIVERY: 0.0001, EQUITY_INTRADAY: 0.0001,
                 FUTURES: 0.0001, OPTIONS: 0.0005},
        "sebiTurnoverPct": 0.0001,
        "gstPct": 18.0,
        "dpChargeInr": 15.0,
    },
]


def rates_on(on_date: Optional[str] = None) -> dict:
    """
    The rates in force on a date. `None` means the latest.

    @returns the matching history entry plus `resolvedFrom`, and `unknownEra: True` when the date falls
             before anything this table can vouch for.
    """
    if not on_date:
        entry = RATE_HISTORY[-1]
        return {**entry, "resolvedFrom": entry["from"], "unknownEra": False, "requested": None}
    d = str(on_date)[:10]
    chosen = None
    for entry in RATE_HISTORY:
        if entry["from"] <= d:
            chosen = entry
    if chosen is None:
        # Not silently priced at the earliest known rates: flagged, so a verdict built on a period this
        # table cannot vouch for says so instead of reading as measured.
        first = RATE_HISTORY[0]
        return {
            **first, "resolvedFrom": first["from"], "requested": d, "unknownEra": True,
            "warning": (f"{d} is before {EARLIEST_KNOWN}, the earliest rates this table can source. The "
                        f"{EARLIEST_KNOWN} rates were used, and they are very likely wrong for that "
                        f"period — Indian STT has been raised twice since 2024. Treat any cost figure "
                        f"over that span as unverified rather than measured."),
        }
    return {**chosen, "resolvedFrom": chosen["from"], "requested": d, "unknownEra": False}


SOURCES = (
    "Union Budget 2026 (effective 2026-04-01): STT on futures raised to 0.05% and on options premium "
    "to 0.15%, both sell side.",
    "zerodha.com/charges — brokerage, STT, exchange transaction charges, SEBI turnover fee, GST base, "
    "stamp duty, DP charges.",
    "support.fyers.in — statutory charges, cross-check on options STT 0.15% on premium, sell side.",
    "NSE published maximums for exchange transaction charges and IPFT.",
)

VERIFY_AT = "https://zerodha.com/charges/ and master's own contract note"

# ── The current rates, as aliases onto the newest history entry ───────────────
#
# Derived rather than restated, so there is exactly one place a rate is written down. A second literal
# copy of "the current rates" is a second answer waiting to disagree with the first.
#
# STT `pct` is of turnover, except options where it is of PREMIUM. `side` is which leg pays it.
# Stamp duty is BUY SIDE ONLY, uniform across states since the 2019-20 Finance Bill.
# SEBI turnover fee is Rs 10 per crore. IPFT is small and included because omitting a small real charge
# is a silent understatement rather than a simplification.
_CURRENT = RATE_HISTORY[-1]
STT = _CURRENT["stt"]
EXCHANGE_TXN = _CURRENT["exchangeTxn"]
SEBI_TURNOVER_PCT = _CURRENT["sebiTurnoverPct"]
IPFT_PCT = _CURRENT["ipft"]
STAMP_DUTY_PCT = _CURRENT["stampDuty"]
GST_PCT = _CURRENT["gstPct"]
# GST applies to these components only. STT and stamp duty are outside GST.
GST_APPLIES_TO = ("brokerage", "exchangeTxn", "sebiTurnover", "ipft")

# Depository charge on a delivery SELL, flat per scrip regardless of quantity.
DP_CHARGE_INR = _CURRENT["dpChargeInr"]


@dataclass(frozen=True)
class BrokerPlan:
    """
    Master's broker's own pricing. Defaults model a typical Indian discount broker.

    A DEFAULT IS A MODEL, NOT A QUOTATION. Brokerage is the one component that differs from broker to
    broker by a factor of ten, so it is the one component master must confirm. `describe()` prints the
    assumption so it is visible in every result rather than buried here.
    """
    delivery_flat_inr: float = 0.0          # many discount brokers charge nothing on delivery
    delivery_pct: float = 0.0
    intraday_flat_inr: float = 20.0         # "Rs 20 or 0.03%, whichever is lower"
    intraday_pct: float = 0.03
    futures_flat_inr: float = 20.0
    futures_pct: float = 0.0                # flat per order
    options_flat_inr: float = 20.0
    options_pct: float = 0.0
    dp_charge_inr: float = DP_CHARGE_INR
    label: str = "typical Indian discount broker (assumed, not quoted)"

    def brokerage(self, instrument: str, turnover: float) -> float:
        """Per order. Where both a flat fee and a percentage are set, the LOWER applies."""
        if instrument == EQUITY_DELIVERY:
            flat, pct = self.delivery_flat_inr, self.delivery_pct
        elif instrument == EQUITY_INTRADAY:
            flat, pct = self.intraday_flat_inr, self.intraday_pct
        elif instrument == FUTURES:
            flat, pct = self.futures_flat_inr, self.futures_pct
        elif instrument == OPTIONS:
            flat, pct = self.options_flat_inr, self.options_pct
        else:
            raise ValueError(f"unknown instrument {instrument!r}")
        by_pct = turnover * pct / 100.0 if pct > 0 else None
        if by_pct is None:
            return max(0.0, flat)
        if flat <= 0:
            return max(0.0, by_pct)
        return max(0.0, min(flat, by_pct))

    def describe(self) -> str:
        return (f"Brokerage assumed: {self.label}. Delivery "
                f"{'free' if self.delivery_flat_inr == 0 and self.delivery_pct == 0 else 'charged'}; "
                f"intraday Rs {self.intraday_flat_inr:.0f} or {self.intraday_pct}% whichever lower; "
                f"futures Rs {self.futures_flat_inr:.0f}; options Rs {self.options_flat_inr:.0f} per "
                f"order. Confirm against the contract note.")


DEFAULT_PLAN = BrokerPlan()


def _validate(instrument: str, price: float, quantity: float) -> Optional[str]:
    if instrument not in INSTRUMENTS:
        return f"unknown instrument {instrument!r}; use one of {', '.join(INSTRUMENTS)}"
    if not isinstance(price, (int, float)) or price != price or price <= 0:
        return "price must be a positive number"
    if not isinstance(quantity, (int, float)) or quantity != quantity or quantity <= 0:
        return "quantity must be a positive number"
    return None


def order_charges(instrument: str, side: str, price: float, quantity: float,
                  *, plan: Optional[BrokerPlan] = None, on_date: Optional[str] = None) -> dict:
    """
    Every charge on ONE order, in rupees.

    For options, `price` is the PREMIUM per unit and `quantity` is the total units (lots x lot size).
    Turnover is premium x quantity, which is the basis STT and the exchange charge actually use — using
    contract value there would overstate option costs by orders of magnitude.

    @returns `{ok, instrument, side, turnover, brokerage, stt, exchangeTxn, sebiTurnover, ipft,
               stampDuty, dp, gst, total, totalPct, breakdown[]}` or `{ok: False, reason}`.
    """
    err = _validate(instrument, price, quantity)
    if err:
        return {"ok": False, "reason": err}
    s = str(side).lower().strip()
    if s not in ("buy", "sell"):
        return {"ok": False, "reason": "side must be 'buy' or 'sell'"}

    p = plan or DEFAULT_PLAN
    turnover = float(price) * float(quantity)

    # Priced at the rates in force ON THE TRADE DATE, not today's. `on_date=None` keeps the current
    # rates, so every existing caller is unchanged.
    era = rates_on(on_date)

    brokerage = p.brokerage(instrument, turnover)

    stt_spec = era["stt"][instrument]
    stt = turnover * stt_spec["pct"] / 100.0 if stt_spec["side"] in ("both", s) else 0.0

    exchange = turnover * era["exchangeTxn"][instrument] / 100.0
    sebi = turnover * era["sebiTurnoverPct"] / 100.0
    ipft = turnover * era["ipft"][instrument] / 100.0

    # Buy side only. A round trip pays it once, which is why it cannot be folded into a per-side rate.
    stamp = turnover * era["stampDuty"][instrument] / 100.0 if s == "buy" else 0.0

    # Flat, per scrip, on a delivery sell — so it is the charge that makes a small delivery trade
    # uneconomic no matter how good the signal was.
    dp = p.dp_charge_inr if (instrument == EQUITY_DELIVERY and s == "sell") else 0.0

    gst_base = brokerage + exchange + sebi + ipft
    gst = gst_base * era["gstPct"] / 100.0
    # DP charges attract GST too, and it is levied on the depository fee itself.
    gst += dp * era["gstPct"] / 100.0

    total = brokerage + stt + exchange + sebi + ipft + stamp + dp + gst
    return {
        "ok": True,
        "instrument": instrument,
        "side": s,
        "turnover": turnover,
        "brokerage": brokerage,
        "stt": stt,
        "exchangeTxn": exchange,
        "sebiTurnover": sebi,
        "ipft": ipft,
        "stampDuty": stamp,
        "dp": dp,
        "gst": gst,
        "total": total,
        "totalPct": total / turnover * 100.0 if turnover > 0 else None,
        # Which rate era priced this, so a figure can always be traced to a dated source.
        "ratesFrom": era["resolvedFrom"],
        "ratesUnknownEra": era["unknownEra"],
        **({"ratesWarning": era["warning"]} if era.get("warning") else {}),
        # Ordered largest first, because the useful question is which charge dominates — and for a
        # small trade the answer is brokerage, which is the one master can change by changing broker.
        "breakdown": sorted(
            [{"name": k, "inr": v} for k, v in (
                ("brokerage", brokerage), ("STT", stt), ("exchange", exchange),
                ("SEBI", sebi), ("IPFT", ipft), ("stamp duty", stamp), ("DP", dp), ("GST", gst),
            ) if v > 0],
            key=lambda r: r["inr"], reverse=True,
        ),
    }


def round_trip_charges(instrument: str, entry_price: float, exit_price: float, quantity: float,
                       *, plan: Optional[BrokerPlan] = None, side: str = "long",
                       entry_date: Optional[str] = None, exit_date: Optional[str] = None) -> dict:
    """
    Both legs of one trade.

    THE EXIT IS PRICED AT THE EXIT PRICE, not the entry price. STT on a futures sell is 0.05% of the
    SELL turnover, so a trade that doubled pays twice the exit-side STT of one that went nowhere.
    Pricing both legs at entry would understate every winning trade's cost — a bias that grows with
    exactly the trades a backtest is most pleased about.

    A short sells first and buys back: stamp duty (buy-side) lands on the cover, STT on the open.
    """
    long_side = str(side).lower() != "short"
    open_side, close_side = ("buy", "sell") if long_side else ("sell", "buy")

    # EACH LEG IS PRICED AT ITS OWN DATE. A trade opened before a rate change and closed after it pays
    # the old rate on the open and the new one on the close — which is exactly what happened to every
    # position held across 2026-04-01, when futures STT went from 0.02% to 0.05% on the sell side.
    # Pricing both legs at the entry date would understate precisely those trades.
    a = order_charges(instrument, open_side, entry_price, quantity, plan=plan, on_date=entry_date)
    if not a.get("ok"):
        return a
    b = order_charges(instrument, close_side, exit_price, quantity, plan=plan,
                      on_date=exit_date or entry_date)
    if not b.get("ok"):
        return b

    total = a["total"] + b["total"]
    gross = (float(exit_price) - float(entry_price)) * float(quantity)
    if not long_side:
        gross = -gross
    entry_notional = float(entry_price) * float(quantity)
    return {
        "ok": True,
        "instrument": instrument,
        "side": "long" if long_side else "short",
        "quantity": float(quantity),
        "entry": a,
        "exit": b,
        "total": total,
        "grossPnl": gross,
        "netPnl": gross - total,
        # On the ENTRY notional, which is the capital actually committed — the denominator a percent
        # return is measured against, so the two are comparable.
        "totalPct": total / entry_notional * 100.0 if entry_notional > 0 else None,
        # What the trade must move, in percent, before it is worth taking at all.
        "breakEvenPct": total / entry_notional * 100.0 if entry_notional > 0 else None,
        "ratesFrom": {"entry": a["ratesFrom"], "exit": b["ratesFrom"]},
        # Said explicitly rather than left to be noticed by comparing two strings.
        "ratesChangedMidTrade": a["ratesFrom"] != b["ratesFrom"],
        "ratesUnknownEra": bool(a["ratesUnknownEra"] or b["ratesUnknownEra"]),
    }


def effective_round_trip_pct(instrument: str, price: float, quantity: float,
                             *, plan: Optional[BrokerPlan] = None) -> dict:
    """
    The bridge to `strategy_eval.CostModel`, which speaks only in percentages.

    THE NOTIONAL IS REQUIRED AND IS REPORTED BACK. A flat ₹20 is 0.40% of a ₹5,000 trade and 0.004% of
    a ₹5,00,000 one, so "the cost percentage" does not exist until someone states the size. Returning
    the assumed notional alongside the percentage is what stops it being quoted as if it were universal.

    Priced at a flat round trip (exit at entry price), which UNDERSTATES a winning trade's exit-side
    STT. Said here rather than left implicit: the real figure comes from `round_trip_charges`, and this
    exists only because the percent-based judge cannot see quantity.
    """
    rt = round_trip_charges(instrument, price, price, quantity, plan=plan)
    if not rt.get("ok"):
        return rt
    return {
        "ok": True,
        "pct": rt["totalPct"],
        "assumedPrice": float(price),
        "assumedQuantity": float(quantity),
        "assumedNotional": float(price) * float(quantity),
        "instrument": instrument,
        "note": (f"{rt['totalPct']:.3f}% round trip assumes {quantity:g} units at {price:g} "
                 f"(notional {float(price) * float(quantity):,.0f}). A flat rupee brokerage makes this "
                 f"percentage size-dependent, so it does not carry to a different trade size. Exit-side "
                 f"STT is priced at the entry price, which understates a profitable trade."),
        "provenance": provenance(),
    }


def staleness(today: Optional[_dt.date] = None) -> dict:
    """
    How old the rate table is.

    Indian charges move at every Union Budget, so a table nobody has revisited is a table that may be
    quietly wrong. Reported rather than assumed current — the same rule `ollamaCatalog` applies to a
    fetched catalogue.
    """
    d = today or _dt.date.today()
    try:
        eff = _dt.date.fromisoformat(TABLE_AS_OF)
    except ValueError:
        return {"asOf": TABLE_AS_OF, "days": None, "stale": True,
                "warning": "the rate table's effective date is unreadable, so it cannot be trusted"}
    days = (d - eff).days
    # One budget cycle. Past that, a new Finance Act has had the chance to move every rate here.
    stale = days > 400
    return {
        "asOf": TABLE_AS_OF,
        "days": days,
        "stale": stale,
        "warning": (f"These rates took effect {TABLE_AS_OF}, {days} days ago, so at least one Union "
                    f"Budget has passed since. Re-check them at {VERIFY_AT}." if stale else None),
    }


def provenance() -> dict:
    """Which rates produced a figure, so a number can always be traced to a source and a date."""
    return {
        "asOf": TABLE_AS_OF,
        "sources": list(SOURCES),
        "verifyAt": VERIFY_AT,
        "gstPct": GST_PCT,
        "gstAppliesTo": list(GST_APPLIES_TO),
        "caveat": ("A model of master's broker's charges, not a quotation from it. Brokerage in "
                   "particular varies tenfold between brokers; the contract note is the authority."),
        **staleness(),
    }


def registry() -> dict:
    """What this module can price, for the UI — including what it deliberately does not model."""
    return {
        "instruments": [{"id": i, "label": INSTRUMENT_LABELS[i],
                         "sttPct": STT[i]["pct"], "sttSide": STT[i]["side"],
                         "sttBasis": STT[i]["basis"],
                         "exchangeTxnPct": EXCHANGE_TXN[i],
                         "stampDutyPct": STAMP_DUTY_PCT[i]} for i in INSTRUMENTS],
        "plan": asdict(DEFAULT_PLAN),
        "planNote": DEFAULT_PLAN.describe(),
        # Stated, because an unlisted charge reads as a charge that does not exist.
        "notModelled": [
            "Physical delivery of stock F&O on expiry, which attracts delivery-equivalent charges.",
            "Auction penalties for short delivery.",
            "Call-and-trade or off-market transfer fees.",
            "Annual demat maintenance, which is not per-trade.",
            "Interest on margin funding or on a debit balance.",
            "Securities lending charges.",
        ],
        "provenance": provenance(),
    }
