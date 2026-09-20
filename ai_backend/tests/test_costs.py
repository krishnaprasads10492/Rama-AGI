"""
test_costs.py — what a trade actually costs (Section 113).

Every expected figure below is computed BY HAND from the published rates and written into the assertion,
not read back out of the module. A test that recomputes using the code under test asserts only that the
code is consistent with itself.

The assertions that matter most are the ones about SHAPE rather than arithmetic: that a small delivery
trade pays about 2% round trip because of a flat depository fee, that options cost six times equity
intraday as a percentage because the same flat brokerage sits on a smaller notional, and that on futures
the STT dominates everything else. Those are the facts that decide whether a backtested edge survives.

Run from `ai_backend/`:  py -m tests.test_costs
"""

import pathlib
import sys

# IMPORTED AS A TOP-LEVEL MODULE, not as `engine.costs`, for the same reason `test_strategy_eval` does:
# `engine/__init__.py` imports the dispatcher, which needs numpy. This module is stdlib-only precisely so
# it can be verified on a machine with no scientific stack, and going through the package would defeat
# that — so a numpy dependency creeping in here fails loudly instead of silently.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import costs as C   # noqa: E402

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


def near(a, b, tol=0.01):
    return a is not None and b is not None and abs(float(a) - float(b)) <= tol


print("\nIndian trading charges - rupees, per order, per instrument\n")

# ── Equity intraday: Rs 1,000 x 100 shares ────────────────────────────────────
print("  equity intraday, 100 shares at 1000 (turnover 100,000)")
buy = C.order_charges(C.EQUITY_INTRADAY, "buy", 1000.0, 100)
check("the order prices", buy["ok"] is True, buy.get("reason"))
check("brokerage is the Rs 20 cap, not the 0.03% (which would be Rs 30)", near(buy["brokerage"], 20.0))
check("no STT on an intraday BUY - it is a sell-side tax", near(buy["stt"], 0.0))
check("exchange charge is 0.00297% of turnover = 2.97", near(buy["exchangeTxn"], 2.97))
check("SEBI turnover fee is Rs 10 per crore = 0.10", near(buy["sebiTurnover"], 0.10))
check("stamp duty is buy-side, 0.003% = 3.00", near(buy["stampDuty"], 3.00))
check("GST is 18% of brokerage+exchange+SEBI+IPFT = 4.17, NOT of stamp duty",
      near(buy["gst"], 4.1706), buy["gst"])
check("no depository charge on intraday", near(buy["dp"], 0.0))
check("total = 30.34", near(buy["total"], 30.3406), buy["total"])

sell = C.order_charges(C.EQUITY_INTRADAY, "sell", 1000.0, 100)
check("STT lands on the SELL at 0.025% = 25.00", near(sell["stt"], 25.0))
check("no stamp duty on a sell", near(sell["stampDuty"], 0.0))
check("sell total = 52.34", near(sell["total"], 52.3406), sell["total"])

rt = C.round_trip_charges(C.EQUITY_INTRADAY, 1000.0, 1000.0, 100)
check("a round trip is both legs = 82.68", near(rt["total"], 82.6812), rt["total"])
check("as a percentage of the entry notional that is 0.083%", near(rt["totalPct"], 0.0827, 0.001))
check("break-even move is the same figure", near(rt["breakEvenPct"], rt["totalPct"]))

# ── The flat-fee trap: a small delivery trade ─────────────────────────────────
print("\n  the flat-fee trap: 10 shares at 100 delivery (turnover 1,000)")
d_buy = C.order_charges(C.EQUITY_DELIVERY, "buy", 100.0, 10)
d_sell = C.order_charges(C.EQUITY_DELIVERY, "sell", 100.0, 10)
check("delivery brokerage is zero on the assumed plan", near(d_buy["brokerage"], 0.0))
check("delivery STT is charged on BOTH sides at 0.1%", near(d_buy["stt"], 1.0) and near(d_sell["stt"], 1.0))
check("the Rs 15 depository fee lands on the delivery SELL only",
      near(d_sell["dp"], 15.0) and near(d_buy["dp"], 0.0))
check("GST applies to the depository fee too", near(d_sell["gst"], 2.705706, 0.001), d_sell["gst"])
d_rt = C.round_trip_charges(C.EQUITY_DELIVERY, 100.0, 100.0, 10)
check("A 1,000-RUPEE DELIVERY TRADE PAYS ABOUT 2% ROUND TRIP",
      near(d_rt["totalPct"], 1.9925, 0.01), d_rt["totalPct"])
check("which is the flat fee, not the rates - the same trade 100x larger pays far less",
      C.round_trip_charges(C.EQUITY_DELIVERY, 100.0, 100.0, 1000)["totalPct"] < 0.5,
      C.round_trip_charges(C.EQUITY_DELIVERY, 100.0, 100.0, 1000)["totalPct"])
check("and the flat model cannot express that: one percentage, two answers 4x apart",
      d_rt["totalPct"] / C.round_trip_charges(C.EQUITY_DELIVERY, 100.0, 100.0, 1000)["totalPct"] > 4.0)

# ── Options: premium is the basis, not contract value ─────────────────────────
print("\n  options, 75 units at 200 premium (turnover = premium x qty = 15,000)")
o_buy = C.order_charges(C.OPTIONS, "buy", 200.0, 75)
o_sell = C.order_charges(C.OPTIONS, "sell", 200.0, 75)
check("turnover is premium x quantity, not contract value", near(o_buy["turnover"], 15000.0))
check("options exchange charge is 0.03503% of premium = 5.25", near(o_buy["exchangeTxn"], 5.2545))
check("options STT is 0.15% of PREMIUM on the sell side = 22.50", near(o_sell["stt"], 22.5))
check("no STT on the option buy", near(o_buy["stt"], 0.0))
check("IPFT on options is 0.0005% = 0.075", near(o_buy["ipft"], 0.075))
o_rt = C.round_trip_charges(C.OPTIONS, 200.0, 200.0, 75)
check("round trip is 82.76 rupees", near(o_rt["total"], 82.76302, 0.01), o_rt["total"])
check("BUT THAT IS 0.55% OF PREMIUM - six times the equity intraday percentage",
      near(o_rt["totalPct"], 0.5518, 0.01), o_rt["totalPct"])
check("for nearly the same rupee cost, because the notional is smaller",
      near(o_rt["total"], rt["total"], 1.0))

# ── Futures: STT dominates ────────────────────────────────────────────────────
print("\n  futures, 75 units at 25000 (turnover 1,875,000)")
f_buy = C.order_charges(C.FUTURES, "buy", 25000.0, 75)
f_sell = C.order_charges(C.FUTURES, "sell", 25000.0, 75)
check("futures STT is 0.05% on the sell side = 937.50", near(f_sell["stt"], 937.5))
check("and it is the largest single charge on that order",
      f_sell["breakdown"][0]["name"] == "STT", f_sell["breakdown"][0])
check("it is over 90% of the sell-side total", f_sell["stt"] / f_sell["total"] > 0.90)
check("stamp duty on the futures buy is 0.002% = 37.50", near(f_buy["stampDuty"], 37.5))
f_rt = C.round_trip_charges(C.FUTURES, 25000.0, 25000.0, 75)
check("round trip is 1,107.60 rupees", near(f_rt["total"], 1107.6025, 0.1), f_rt["total"])
check("yet only 0.059% of notional - LOWER than the equity intraday percentage",
      f_rt["totalPct"] < rt["totalPct"], f_rt["totalPct"])
check("which is why a cost percentage without a size is meaningless",
      f_rt["total"] > rt["total"] * 10 and f_rt["totalPct"] < rt["totalPct"])

# ── The exit is priced at the exit price ──────────────────────────────────────
print("\n  the exit is priced at the exit price")
won = C.round_trip_charges(C.FUTURES, 25000.0, 26000.0, 75)
flat = C.round_trip_charges(C.FUTURES, 25000.0, 25000.0, 75)
check("a winning futures trade pays more exit-side STT", won["exit"]["stt"] > flat["exit"]["stt"])
check("exactly 0.05% of the higher sell turnover = 975.00", near(won["exit"]["stt"], 975.0))
check("so total charges are higher on the trade that worked", won["total"] > flat["total"])
check("gross P&L is computed from the price move", near(won["grossPnl"], 1000.0 * 75))
check("and net is gross less charges", near(won["netPnl"], won["grossPnl"] - won["total"]))
lost = C.round_trip_charges(C.FUTURES, 26000.0, 25000.0, 75)
check("a losing trade's gross P&L is negative", lost["grossPnl"] < 0)
check("and charges make it worse, never better", lost["netPnl"] < lost["grossPnl"])

print("\n  a short pays the same charges on the other legs")
sh = C.round_trip_charges(C.FUTURES, 25000.0, 24000.0, 75, side="short")
check("a short profits when price falls", sh["grossPnl"] > 0)
check("STT lands on the opening SELL for a short", sh["entry"]["stt"] > 0)
check("and stamp duty on the closing BUY", sh["exit"]["stampDuty"] > 0 and sh["entry"]["stampDuty"] == 0)

# ── The percentage bridge names its assumption ────────────────────────────────
print("\n  the bridge to the percent-based judge")
eff = C.effective_round_trip_pct(C.OPTIONS, 200.0, 75)
check("it returns a percentage", near(eff["pct"], 0.5518, 0.01))
check("and the notional it assumed, so the figure cannot be quoted as universal",
      near(eff["assumedNotional"], 15000.0))
check("the note states the size it assumed", "15,000" in eff["note"], eff["note"])
check("and admits the exit-side understatement", "understates" in eff["note"])
check("and carries the rate provenance", eff["provenance"]["asOf"] == C.TABLE_AS_OF)
check("the same instrument at a different size gives a different percentage",
      not near(C.effective_round_trip_pct(C.OPTIONS, 200.0, 750)["pct"], eff["pct"], 0.01))

# ── Refusals ──────────────────────────────────────────────────────────────────
print("\n  what it refuses")
check("an unknown instrument is refused, not defaulted",
      C.order_charges("crypto", "buy", 100, 1)["ok"] is False)
check("and the reason lists what is valid",
      "equity_delivery" in C.order_charges("crypto", "buy", 100, 1)["reason"])
check("a zero price is refused", C.order_charges(C.OPTIONS, "buy", 0, 75)["ok"] is False)
check("a negative price is refused", C.order_charges(C.OPTIONS, "buy", -5, 75)["ok"] is False)
check("a zero quantity is refused", C.order_charges(C.OPTIONS, "buy", 200, 0)["ok"] is False)
check("a bad side is refused rather than assumed to be a buy",
      C.order_charges(C.OPTIONS, "hold", 200, 75)["ok"] is False)
check("a NaN price is refused", C.order_charges(C.OPTIONS, "buy", float("nan"), 75)["ok"] is False)
check("a round trip inherits the refusal",
      C.round_trip_charges(C.OPTIONS, 0, 200, 75)["ok"] is False)

# ── Provenance and staleness ──────────────────────────────────────────────────
print("\n  provenance: every rate traceable to a source and a date")
p = C.provenance()
check("the effective date is recorded", p["asOf"] == "2026-04-01")
check("the Budget 2026 change is named as the source", any("Budget 2026" in s for s in p["sources"]))
check("more than one source, so no single page is the authority", len(p["sources"]) >= 3)
check("GST base is stated, not implied",
      set(p["gstAppliesTo"]) == {"brokerage", "exchangeTxn", "sebiTurnover", "ipft"})
check("it says the contract note is the real authority", "contract note" in p["caveat"])

import datetime as dt
fresh = C.staleness(dt.date(2026, 6, 1))
check("a recent table is not stale", fresh["stale"] is False and fresh["warning"] is None)
old = C.staleness(dt.date(2028, 1, 1))
check("a table older than a budget cycle IS stale", old["stale"] is True)
check("and says so in words, with where to re-check", "Budget" in old["warning"], old["warning"])
check("the day count is reported, not just a flag", old["days"] > 400)

print("\n  what it deliberately does not model")
reg = C.registry()
check("unmodelled charges are listed rather than left to look like zero",
      len(reg["notModelled"]) >= 5)
check("physical delivery on stock F&O expiry is named", any("delivery" in n for n in reg["notModelled"]))
check("the brokerage assumption is printed for master to check",
      "contract note" in reg["planNote"])
check("every instrument is listed with its STT basis",
      all(i["sttBasis"] in ("turnover", "premium") for i in reg["instruments"]))
check("options are the only instrument taxed on premium",
      [i["id"] for i in reg["instruments"] if i["sttBasis"] == "premium"] == [C.OPTIONS])

# ── A custom plan ─────────────────────────────────────────────────────────────
print("\n  master's own broker")
full = C.BrokerPlan(delivery_flat_inr=0.0, delivery_pct=0.50, intraday_flat_inr=0.0,
                    intraday_pct=0.05, label="a full-service broker")
fs = C.order_charges(C.EQUITY_DELIVERY, "buy", 1000.0, 100, plan=full)
check("a percentage-only plan charges the percentage", near(fs["brokerage"], 500.0))
check("and brokerage becomes the single largest component",
      fs["breakdown"][0]["name"] == "brokerage", fs["breakdown"][0])
check("it is 70% of the whole cost", 0.65 < fs["brokerage"] / fs["total"] < 0.75,
      fs["brokerage"] / fs["total"])
check("THE BROKER CHOICE COSTS MORE THAN EVERY STATUTORY CHARGE COMBINED - the same trade is 6x "
      "dearer than on the discount plan",
      fs["total"] / C.order_charges(C.EQUITY_DELIVERY, "buy", 1000.0, 100)["total"] > 5.0,
      fs["total"] / C.order_charges(C.EQUITY_DELIVERY, "buy", 1000.0, 100)["total"])
check("the lower of flat and percentage applies when both are set",
      near(C.BrokerPlan().brokerage(C.EQUITY_INTRADAY, 10000.0), 3.0))
check("and the flat fee wins once the percentage exceeds it",
      near(C.BrokerPlan().brokerage(C.EQUITY_INTRADAY, 1000000.0), 20.0))
check("a plan with neither charges nothing",
      near(C.BrokerPlan(delivery_flat_inr=0, delivery_pct=0).brokerage(C.EQUITY_DELIVERY, 50000), 0.0))

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
