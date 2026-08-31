"""
test_ledger.py — the position ledger, where a sign error costs master money.

The load-bearing assertions are the arithmetic ones. Everything in this module either matches
what master's broker shows him or it is worthless, so the tests assert exact rupee figures
computed by hand rather than "is a number". The cases that would fail silently and expensively:
adding to a position must re-average rather than replace, realised P&L must use the average cost
at the moment of the reducing fill, a short must be the same code path as a long, and a
missing price must produce `None` instead of a P&L of zero.
"""

import datetime as _dt
import os
import sys
import tempfile

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


def near(a, b, tol=0.01):
    if a is None or b is None:
        return a is b
    return abs(float(a) - float(b)) <= tol


_TMP = tempfile.mkdtemp(prefix="rama-ledger-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import ledger as L       # noqa: E402
from engine import store             # noqa: E402


def fill(side, qty, price, date, fees=0.0):
    return {"fillId": f"{side}{qty}{price}", "side": side, "quantity": qty,
            "price": price, "date": date, "fees": fees}


# ── replay: a single long ──────────────────────────────────────────────────────
print("\n--- one buy ---")

r = L.replay([fill("BUY", 100, 2400, "2026-01-05")])
check("net quantity is the quantity bought", near(r["netQty"], 100), r["netQty"])
check("average cost is the price paid", near(r["avgCost"], 2400), r["avgCost"])
check("nothing is realised while the position is open", near(r["realisedPnl"], 0))
check("no fills means nothing at all",
      L.replay([])["netQty"] == 0 and L.replay([])["fillCount"] == 0)
check("a fill list of None is survivable", L.replay(None)["netQty"] == 0)


# ── replay: adding re-averages, it does not replace ────────────────────────────
print("\n--- buying more: the case a single entryPrice field destroys ---")

r = L.replay([fill("BUY", 100, 2400, "2026-01-05"),
              fill("BUY", 50, 2310, "2026-02-10")])
# (100*2400 + 50*2310) / 150 = 355500 / 150 = 2370
check("net quantity adds", near(r["netQty"], 150), r["netQty"])
check("average cost is weighted by quantity, exactly 2370", near(r["avgCost"], 2370),
      r["avgCost"])
check("the second price did not simply replace the first", not near(r["avgCost"], 2310))
check("nor did the first survive alone", not near(r["avgCost"], 2400))
check("total bought is tracked", near(r["totalBought"], 150), r["totalBought"])

r3 = L.replay([fill("BUY", 10, 100, "2026-01-01"),
               fill("BUY", 10, 200, "2026-01-02"),
               fill("BUY", 20, 300, "2026-01-03")])
# (1000 + 2000 + 6000) / 40 = 225
check("three adds average correctly across all of them", near(r3["avgCost"], 225),
      r3["avgCost"])


# ── replay: reducing realises, and leaves the average alone ───────────────────
print("\n--- selling part of it ---")

base = [fill("BUY", 100, 2400, "2026-01-05"), fill("BUY", 50, 2310, "2026-02-10")]
r = L.replay(base + [fill("SELL", 50, 2500, "2026-03-01")])
# realised = (2500 - 2370) * 50 = 6500
check("realised P&L is (exit - average) x quantity sold, exactly 6500",
      near(r["realisedPnl"], 6500), r["realisedPnl"])
check("net quantity drops by what was sold", near(r["netQty"], 100), r["netQty"])
check("A PARTIAL SELL DOES NOT MOVE THE AVERAGE COST", near(r["avgCost"], 2370),
      r["avgCost"])
check("total sold is tracked separately from bought", near(r["totalSold"], 50))

r = L.replay(base + [fill("SELL", 150, 2500, "2026-03-01")])
# realised = (2500 - 2370) * 150 = 19500
check("selling everything realises the whole gain", near(r["realisedPnl"], 19500),
      r["realisedPnl"])
check("a fully exited position is flat", near(r["netQty"], 0), r["netQty"])
check("a flat position has no average cost to carry", near(r["avgCost"], 0))

r = L.replay(base + [fill("SELL", 50, 2000, "2026-03-01")])
# (2000 - 2370) * 50 = -18500
check("a loss is realised as a negative number, not an absolute value",
      near(r["realisedPnl"], -18500), r["realisedPnl"])


# ── THE ORDERING TRAP: realised must use the average AT THE TIME ───────────────
print("\n--- a later purchase must not rewrite a profit already booked ---")

booked = L.replay([fill("BUY", 100, 100, "2026-01-01"),
                   fill("SELL", 50, 120, "2026-02-01")])
check("baseline: 50 sold at 120 against a cost of 100 books 1000",
      near(booked["realisedPnl"], 1000), booked["realisedPnl"])

after = L.replay([fill("BUY", 100, 100, "2026-01-01"),
                  fill("SELL", 50, 120, "2026-02-01"),
                  fill("BUY", 100, 200, "2026-03-01")])
check("REALISED P&L IS UNCHANGED BY A LATER BUY — history is not rewritten",
      near(after["realisedPnl"], 1000), after["realisedPnl"])
# remaining 50 @ 100 plus 100 @ 200 = (5000 + 20000)/150 = 166.666...
check("the later buy re-averages only the open quantity",
      near(after["avgCost"], 166.6667, 0.001), after["avgCost"])
check("net quantity after the add is 150", near(after["netQty"], 150))


# ── fills arriving out of order ────────────────────────────────────────────────
print("\n--- fills entered out of chronological order ---")

in_order = L.replay([fill("BUY", 100, 100, "2026-01-01"),
                     fill("BUY", 100, 200, "2026-02-01")])
reversed_entry = L.replay([fill("BUY", 100, 200, "2026-02-01"),
                           fill("BUY", 100, 100, "2026-01-01")])
check("date order decides, not the order master typed them in",
      near(in_order["avgCost"], reversed_entry["avgCost"]),
      f"{in_order['avgCost']} vs {reversed_entry['avgCost']}")

out_of_order = L.replay([fill("SELL", 50, 120, "2026-02-01"),
                         fill("BUY", 100, 100, "2026-01-01")])
check("a sell typed before its buy is still replayed after it",
      near(out_of_order["realisedPnl"], 1000) and near(out_of_order["netQty"], 50),
      f"{out_of_order['realisedPnl']} / {out_of_order['netQty']}")


# ── shorts: the same code path ─────────────────────────────────────────────────
print("\n--- a short is a negative quantity, not a second implementation ---")

r = L.replay([fill("SELL", 100, 2400, "2026-01-05")])
check("selling first makes the net quantity negative", near(r["netQty"], -100), r["netQty"])
check("a short still records the price it was opened at", near(r["avgCost"], 2400))

r = L.replay([fill("SELL", 100, 2400, "2026-01-05"),
              fill("BUY", 100, 2300, "2026-02-01")])
check("SHORTING AT 2400 AND BUYING BACK AT 2300 IS A PROFIT OF 10000, not a loss",
      near(r["realisedPnl"], 10000), r["realisedPnl"])
check("buying back closes the short to flat", near(r["netQty"], 0))

r = L.replay([fill("SELL", 100, 2400, "2026-01-05"),
              fill("BUY", 100, 2500, "2026-02-01")])
check("a short that rises is a loss of 10000", near(r["realisedPnl"], -10000),
      r["realisedPnl"])

r = L.replay([fill("SELL", 100, 2400, "2026-01-05"),
              fill("SELL", 100, 2600, "2026-02-01")])
check("adding to a short re-averages it upward", near(r["avgCost"], 2500), r["avgCost"])
check("adding to a short makes it more negative", near(r["netQty"], -200))


# ── reversal through flat ──────────────────────────────────────────────────────
print("\n--- selling more than is held reverses the position ---")

r = L.replay([fill("BUY", 100, 2400, "2026-01-05"),
              fill("SELL", 150, 2500, "2026-02-01")])
check("the 100 held is closed for 10000", near(r["realisedPnl"], 10000), r["realisedPnl"])
check("the remaining 50 opens a short", near(r["netQty"], -50), r["netQty"])
check("the new short is carried at the reversing fill's price, not the old average",
      near(r["avgCost"], 2500), r["avgCost"])

r = L.replay([fill("SELL", 100, 2400, "2026-01-05"),
              fill("BUY", 150, 2300, "2026-02-01")])
check("the mirror case realises the short's gain", near(r["realisedPnl"], 10000),
      r["realisedPnl"])
check("and leaves a long of 50", near(r["netQty"], 50))
check("carried at the reversing price", near(r["avgCost"], 2300))


# ── fees ───────────────────────────────────────────────────────────────────────
print("\n--- fees are tracked, and kept out of the average cost ---")

r = L.replay([fill("BUY", 100, 2400, "2026-01-05", fees=120.5),
              fill("SELL", 100, 2500, "2026-02-01", fees=130.25)])
check("fees accumulate across fills", near(r["feesTotal"], 250.75), r["feesTotal"])
check("FEES DO NOT MOVE THE AVERAGE COST — it must match the broker's holdings screen",
      near(L.replay([fill("BUY", 100, 2400, "2026-01-05", fees=999)])["avgCost"], 2400))
check("gross realised P&L excludes fees", near(r["realisedPnl"], 10000), r["realisedPnl"])


# ── derive: the decision-ready view ────────────────────────────────────────────
print("\n--- derive: a position plus a price ---")

pos = {"positionId": "p1", "symbol": "RELIANCE", "exchange": "NSE", "instrType": "EQUITY",
       "status": "open", "openedAt": "2026-01-05T09:30:00", "closedAt": None,
       "fills": [fill("BUY", 100, 2400, "2026-01-05"), fill("BUY", 50, 2310, "2026-02-10")]}

d = L.derive(pos, last_price=2500, price_as_of="2026-08-28", price_stale=False)
check("direction is read off the sign", d["direction"] == "LONG", d["direction"])
check("invested value is average x quantity: 355500", near(d["investedValue"], 355500),
      d["investedValue"])
check("market value is price x quantity: 375000", near(d["marketValue"], 375000),
      d["marketValue"])
check("unrealised P&L is (2500 - 2370) x 150 = 19500", near(d["unrealisedPnl"], 19500),
      d["unrealisedPnl"])
check("net P&L with nothing realised and no fees equals unrealised",
      near(d["netPnl"], 19500), d["netPnl"])
check("P&L percent is against invested value, not market value",
      near(d["pnlPct"], 5.49, 0.01), d["pnlPct"])
check("the price date is carried through", d["priceAsOf"] == "2026-08-28")
check("a fresh price raises no flag", d["flags"] == [], str(d["flags"]))
check("fill count is reported", d["fillCount"] == 2)

d_short = L.derive({**pos, "instrType": "FUTURES",
                    "fills": [fill("SELL", 100, 2400, "2026-01-05")]}, last_price=2300)
check("A SHORT THAT FALLS SHOWS A PROFIT: (2300-2400) x -100 = 10000",
      near(d_short["unrealisedPnl"], 10000), d_short["unrealisedPnl"])
check("its direction reads SHORT", d_short["direction"] == "SHORT")
d_short_up = L.derive({**pos, "instrType": "FUTURES",
                       "fills": [fill("SELL", 100, 2400, "2026-01-05")]}, last_price=2500)
check("a short that rises shows a loss", near(d_short_up["unrealisedPnl"], -10000),
      d_short_up["unrealisedPnl"])


# ── derive with no price: the substitution that must not happen ────────────────
print("\n--- a missing price is reported, never substituted ---")

d = L.derive(pos, last_price=None, price_stale=True, price_note="no stored bars")
check("UNREALISED P&L IS None, NOT ZERO, when there is no price",
      d["unrealisedPnl"] is None, str(d["unrealisedPnl"]))
check("market value is None too", d["marketValue"] is None)
check("P&L percent is None rather than 0.0", d["pnlPct"] is None)
check("net P&L falls back to realised minus fees only", near(d["netPnl"], 0))
check("invested value is still known — it does not need a market price",
      near(d["investedValue"], 355500))
check("a flag names the missing price",
      any("unrealised" in f or "stale" in f for f in d["flags"]), str(d["flags"]))

d_flat = L.derive({**pos, "status": "closed", "closedAt": "2026-03-01T10:00:00",
                   "fills": [fill("BUY", 100, 100, "2026-01-01"),
                             fill("SELL", 100, 120, "2026-03-01")]}, last_price=None)
check("a closed position needs no price to report its realised gain",
      near(d_flat["realisedPnl"], 2000), d_flat["realisedPnl"])
check("a flat position raises no missing-price flag", d_flat["flags"] == [],
      str(d_flat["flags"]))
check("direction of a flat position is FLAT", d_flat["direction"] == "FLAT")
check("days held spans first fill to close, not to today",
      d_flat["daysHeld"] == 59, str(d_flat["daysHeld"]))


# ── the equity short flag ──────────────────────────────────────────────────────
print("\n--- a net short on cash equity is called out ---")

d = L.derive({**pos, "instrType": "EQUITY",
              "fills": [fill("SELL", 100, 2400, "2026-01-05")]}, last_price=2300)
check("a net short on EQUITY is flagged as intraday-only",
      any("short" in f.lower() for f in d["flags"]), str(d["flags"]))
d = L.derive({**pos, "instrType": "FUTURES",
              "fills": [fill("SELL", 100, 2400, "2026-01-05")]}, last_price=2300)
check("the same short on FUTURES is not flagged — it is ordinary there",
      not any("short" in f.lower() for f in d["flags"]), str(d["flags"]))


# ── validation ─────────────────────────────────────────────────────────────────
print("\n--- input validation, because a bad fill is a wrong average cost ---")


def raises(fn, *a, **k):
    try:
        fn(*a, **k)
        return False
    except Exception:
        return True


check("zero quantity is refused", raises(L._positive, 0, "quantity"))
check("a negative quantity is refused", raises(L._positive, -5, "quantity"))
check("a non-numeric quantity is refused", raises(L._positive, "many", "quantity"))
check("NaN is refused", raises(L._positive, float("nan"), "price"))
check("infinity is refused", raises(L._positive, float("inf"), "price"))
check("a valid number passes", near(L._positive("2400.5", "price"), 2400.5))

check("BUY normalises", L._side("buy") == "BUY")
check("SELL normalises", L._side(" sell ") == "SELL")
check("LONG is accepted as BUY", L._side("long") == "BUY")
check("SHORT is accepted as SELL", L._side("short") == "SELL")
check("a nonsense side is refused", raises(L._side, "hold"))
check("an empty side is refused", raises(L._side, ""))

check("EQUITY is the default instrument", L._instr(None) == "EQUITY")
check("OPTIONS is accepted", L._instr("options") == "OPTIONS")
check("an unknown instrument is refused", raises(L._instr, "CRYPTO"))

check("an ISO date passes through", L._norm_date("2026-01-05") == "2026-01-05")
check("a timestamp is reduced to its date",
      L._norm_date("2026-01-05T14:30:00") == "2026-01-05")
check("a date object is accepted", L._norm_date(_dt.date(2026, 1, 5)) == "2026-01-05")
check("a datetime is accepted", L._norm_date(_dt.datetime(2026, 1, 5, 14, 0)) == "2026-01-05")
check("an empty date means today", L._norm_date(None) == _dt.date.today().isoformat())
check("GARBAGE IS AN ERROR, NOT SILENTLY TODAY", raises(L._norm_date, "sometime last week"))


# ── persistence, end to end ────────────────────────────────────────────────────
print("\n--- the ledger on disk ---")

check("an empty ledger is an empty list, not a crash", L.positions() == [])
check("an empty portfolio reports zero positions", L.portfolio()["openPositions"] == 0)
check("an empty portfolio does not divide by zero", L.portfolio()["unrealisedPct"] is None)

res = L.open_position("RELIANCE", "NSE", "EQUITY", "BUY", 100, 2400, "2026-01-05",
                      fees=20, thesis={"direction": "LONG", "horizon": "positional",
                                       "targetPrice": 2700, "stopPrice": 2280,
                                       "probability": 0.61,
                                       "rationale": "testing the thesis is stored"})
pid = res["position"]["positionId"]
check("opening a position reports it created", res["created"] is True)
check("it is open", res["position"]["status"] == "open")
check("THE THESIS IS STORED WITH THE POSITION",
      res["position"]["thesis"]["targetPrice"] == 2700,
      str(res["position"]["thesis"]))
check("the rationale survives",
      "testing" in (res["position"]["thesis"]["rationale"] or ""))
check("the probability survives as a float",
      near(res["position"]["thesis"]["probability"], 0.61))
check("one position is now listed", len(L.positions()) == 1)
check("it is findable by symbol", len(L.positions(symbol="reliance")) == 1)
check("and not by another symbol", len(L.positions(symbol="INFY")) == 0)
check("filtering by open status finds it", len(L.positions(status="open")) == 1)
check("filtering by closed status does not", len(L.positions(status="closed")) == 0)

again = L.open_position("RELIANCE", "NSE", "EQUITY", "BUY", 50, 2310, "2026-02-10")
check("OPENING THE SAME HOLDING AGAIN ADDS TO IT rather than making a second row",
      again["addedToExisting"] is True and again["created"] is False)
check("still exactly one position for that holding", len(L.positions()) == 1)
check("the average cost is now the weighted average, 2370",
      near(again["position"]["avgCost"], 2370), again["position"]["avgCost"])
check("the earlier thesis was not wiped by the add",
      again["position"]["thesis"]["targetPrice"] == 2700)

other = L.open_position("INFY", "NSE", "EQUITY", "BUY", 10, 1500, "2026-02-01")
check("a different symbol is a different position", other["created"] is True)
check("two positions are tracked", len(L.positions()) == 2)
futures = L.open_position("RELIANCE", "NSE", "FUTURES", "BUY", 500, 2405, "2026-02-01")
check("THE SAME SYMBOL IN A DIFFERENT INSTRUMENT IS A SEPARATE POSITION",
      futures["created"] is True and len(L.positions()) == 3)

got = L.add_fill(pid, "SELL", 50, 2500, "2026-03-01", fees=15)
check("a reducing fill realises 6500", near(got["position"]["realisedPnl"], 6500),
      got["position"]["realisedPnl"])
check("the position stays open with 100 left", got["position"]["status"] == "open"
      and near(got["position"]["netQty"], 100))
check("fees from both fills are summed: 35", near(got["position"]["feesTotal"], 35),
      got["position"]["feesTotal"])

detail = L.position_detail(pid)
check("detail returns every fill", len(detail["fills"]) == 3, str(len(detail["fills"])))
check("fills come back in date order",
      [f["date"] for f in detail["fills"]] == sorted(f["date"] for f in detail["fills"]))
check("each fill has an id so it can be corrected",
      all(f.get("fillId") for f in detail["fills"]))

closed = L.close_position(pid, 2600, "2026-04-01", fees=25)
check("closing writes a fill rather than only flipping a flag",
      len(L.position_detail(pid)["fills"]) == 4)
check("the position is flat", near(closed["position"]["netQty"], 0))
check("and marked closed", closed["position"]["status"] == "closed")
check("it has a close timestamp", bool(closed["position"]["closedAt"]))
# 6500 + (2600-2370)*100 = 6500 + 23000 = 29500
check("total realised is 29500", near(closed["position"]["realisedPnl"], 29500),
      closed["position"]["realisedPnl"])
check("net P&L subtracts the 60 in fees", near(closed["position"]["netPnl"], 29440),
      closed["position"]["netPnl"])
check("a closed position reports no unrealised P&L",
      closed["position"]["unrealisedPnl"] in (None, 0))
check("closing an already flat position is not an error",
      L.close_position(pid, 2600)["alreadyFlat"] is True)

check("the closed one is excluded from open positions",
      len(L.positions(status="open")) == 2)
check("and included in closed", len(L.positions(status="closed")) == 1)


# ── corrections ────────────────────────────────────────────────────────────────
print("\n--- correcting a mistyped fill ---")

typo = L.open_position("TCS", "NSE", "EQUITY", "BUY", 10, 3200, "2026-02-01")
tid = typo["position"]["positionId"]
L.add_fill(tid, "BUY", 1000, 3210, "2026-02-02")     # a fat finger
check("the typo moved the average cost",
      not near(L.position_detail(tid)["avgCost"], 3200))
bad = [f for f in L.position_detail(tid)["fills"] if f["quantity"] == 1000][0]
fixed = L.remove_fill(tid, bad["fillId"])
check("removing the bad fill restores the average cost",
      near(fixed["position"]["avgCost"], 3200), fixed["position"]["avgCost"])
check("and the quantity", near(fixed["position"]["netQty"], 10))
check("THE REMOVAL IS RECORDED — history is not silently rewritten",
      any(n.get("kind") == "fill-removed" for n in L.position_detail(tid)["notes"]))
check("removing a fill that does not exist is an error",
      raises(L.remove_fill, tid, "nosuchfill"))
check("a fill on an unknown position is an error",
      raises(L.add_fill, "nosuchposition", "BUY", 1, 1))

L.set_thesis(tid, {"direction": "SHORT", "rationale": "changed my mind"})
th = L.position_detail(tid)
check("the thesis can be revised", th["thesis"]["direction"] == "SHORT")
check("THE PREVIOUS THESIS IS KEPT — an alert must not fire on an abandoned one",
      any(n.get("kind") == "thesis-replaced" for n in th["notes"]))
L.add_note(tid, "watching the results next week")
check("a free note can be attached",
      any(n.get("kind") == "note" for n in L.position_detail(tid)["notes"]))


# ── reopening ──────────────────────────────────────────────────────────────────
print("\n--- buying back into something already exited ---")

reopened = L.open_position("RELIANCE", "NSE", "EQUITY", "BUY", 25, 2550, "2026-05-01")
check("A CLOSED POSITION IS NOT ADDED TO — re-entry gets a fresh row with its own cost",
      reopened["created"] is True, str(reopened))
check("the new row carries only the new quantity",
      near(reopened["position"]["netQty"], 25), reopened["position"]["netQty"])
check("and its own average cost", near(reopened["position"]["avgCost"], 2550))
check("the old closed row is still there",
      len(L.positions(symbol="RELIANCE")) == 3)


# ── mark to market against the real store ─────────────────────────────────────
print("\n--- pricing from stored bars ---")

px = L.last_close("NOSUCHSYMBOL", "NSE")
check("an unknown symbol has no price", px["price"] is None)
check("and is reported stale", px["stale"] is True)
check("with a reason naming the missing sync", "sync" in (px["note"] or "").lower(),
      str(px["note"]))

days = pd.bdate_range(end=_dt.date.today(), periods=30)
bars = pd.DataFrame({"date": [d.strftime("%Y-%m-%d") for d in days],
                     "open": 2400.0, "high": 2450.0, "low": 2350.0,
                     "close": [2400.0 + i for i in range(30)], "volume": 1000})
store.merge("PRICED", bars, "NSE", "1d")

px = L.last_close("PRICED", "NSE")
check("a synced symbol prices from its newest close", near(px["price"], 2429), px["price"])
check("a current bar is not stale", px["stale"] is False, str(px["note"]))
check("the bar date is reported", px["asOf"] == days[-1].strftime("%Y-%m-%d"), px["asOf"])
check("the bar count is reported", px["bars"] == 30, str(px["bars"]))

px = L.last_close("PRICED", "NSE", newest_fill=(_dt.date.today()
                                                + _dt.timedelta(days=3)).isoformat())
check("A BAR OLDER THAN THE NEWEST FILL IS STALE, however recent it looks",
      px["stale"] is True, str(px["note"]))
check("and says the position cannot be marked to market",
      "marked to market" in (px["note"] or ""), str(px["note"]))

old_days = pd.bdate_range(end=_dt.date.today() - _dt.timedelta(days=40), periods=20)
old_bars = pd.DataFrame({"date": [d.strftime("%Y-%m-%d") for d in old_days],
                         "open": 100.0, "high": 105.0, "low": 95.0,
                         "close": 100.0, "volume": 10})
store.merge("STALEONE", old_bars, "NSE", "1d")
px = L.last_close("STALEONE", "NSE")
check("bars 40 days old are stale", px["stale"] is True)
check("and the note gives the age in days", "days old" in (px["note"] or ""),
      str(px["note"]))
check("a stale price is still returned so master can see it",
      px["price"] is not None)

live = L.open_position("PRICED", "NSE", "EQUITY", "BUY", 10, 2400,
                       days[0].strftime("%Y-%m-%d"))
lp = live["position"]
check("a real position marks to market from the store", near(lp["lastPrice"], 2429),
      lp["lastPrice"])
check("its unrealised P&L is (2429 - 2400) x 10 = 290", near(lp["unrealisedPnl"], 290),
      lp["unrealisedPnl"])
check("it is not flagged stale", lp["priceStale"] is False, str(lp["flags"]))
check("days held is measured from the first fill", lp["daysHeld"] is not None
      and lp["daysHeld"] > 0, str(lp["daysHeld"]))


# ── the portfolio view ─────────────────────────────────────────────────────────
print("\n--- the whole book ---")

p = L.portfolio()
check("every position is counted", p["positions"] == len(L.positions()), str(p))
check("open and closed sum to the total",
      p["openPositions"] + p["closedPositions"] == p["positions"])
check("realised P&L across the book includes the closed RELIANCE gain",
      p["realisedPnl"] >= 29500, str(p["realisedPnl"]))
check("fees are totalled across the book", p["feesTotal"] >= 60, str(p["feesTotal"]))
check("invested value is positive", p["investedValue"] > 0)
check("UNPRICED POSITIONS ARE NAMED, not folded in as zero",
      isinstance(p["unpricedSymbols"], list) and "INFY" in p["unpricedSymbols"],
      str(p["unpricedSymbols"]))
check("price coverage is stated in words master can check",
      "could be marked to market" in p["priceCoverage"], p["priceCoverage"])
check("the percentage is computed only over what could be priced",
      p["unrealisedPct"] is not None, str(p["unrealisedPct"]))
check("the symbol list covers open positions only",
      "PRICED" in p["symbols"], str(p["symbols"]))
check("it is timestamped", bool(p["generatedAt"]))

net_check = round(p["realisedPnl"] + (p["unrealisedPnl"] or 0) - p["feesTotal"], 2)
check("net P&L is realised plus unrealised minus fees, exactly",
      near(p["netPnl"], net_check), f"{p['netPnl']} vs {net_check}")


# ── durability ─────────────────────────────────────────────────────────────────
print("\n--- surviving a restart ---")

before = {v["positionId"]: v["netQty"] for v in L.positions()}
rows = L._all()
check("the ledger is on disk as JSONL", os.path.exists(L.positions_path()))
check("every position round-tripped", len(rows) == len(before), f"{len(rows)}/{len(before)}")
after = {v["positionId"]: v["netQty"] for v in L.positions()}
check("re-reading gives identical quantities", before == after)
check("nothing derived was persisted — no netQty on the stored row",
      all("netQty" not in r for r in rows))
check("nor avgCost", all("avgCost" not in r for r in rows))
check("nor P&L", all("realisedPnl" not in r and "unrealisedPnl" not in r for r in rows))
check("the stored row keeps the fills that produce them",
      all(isinstance(r.get("fills"), list) and r["fills"] for r in rows))

with open(L.positions_path(), "a", encoding="utf-8") as fh:
    fh.write('{"positionId": "torn", "fills": [{"side": "BUY"\n')
check("A TORN FINAL LINE IS DISCARDED, not fatal to the whole ledger",
      len(L._all()) == len(rows), str(len(L._all())))
check("and the surviving positions still price", len(L.positions()) == len(rows))


# ── Trade style (Section 77) ──────────────────────────────────────────────────
print("\n--- trade style is part of the position's identity ---")

check("the four styles exist",
      set(L.TRADE_STYLES) == {"INTRADAY", "SWING", "POSITIONAL", "LONGTERM"},
      str(L.TRADE_STYLES))
check("POSITIONAL is the default", L._style(None) == "POSITIONAL")
check("intraday normalises", L._style("intraday") == "INTRADAY")
check("a broker product code maps to a style", L._style("MIS") == "INTRADAY"
      and L._style("CNC") == "POSITIONAL", f"{L._style('MIS')}/{L._style('CNC')}")
check("BTST counts as swing", L._style("btst") == "SWING")
check("delivery maps to positional", L._style("Delivery") == "POSITIONAL")
check("an unknown style is refused", raises(L._style, "scalp-ish"))
check("a hyphenated form is accepted", L._style("long-term") == "LONGTERM")

check("INTRADAY is meant to last zero days", L.STYLE_SPAN_DAYS["INTRADAY"] == 0)
check("LONGTERM has no expiry to breach", L.STYLE_SPAN_DAYS["LONGTERM"] is None)

check("a record with no style reads as POSITIONAL", L.style_of({})[0] == "POSITIONAL")
check("AND IS MARKED INFERRED, so an old row is not silently relabelled",
      L.style_of({})[1] is True)
check("a record with a style is not inferred",
      L.style_of({"tradeStyle": "SWING"}) == ("SWING", False))
check("a corrupt stored style falls back to POSITIONAL and says it was inferred",
      L.style_of({"tradeStyle": "nonsense"}) == ("POSITIONAL", True))


print("\n--- THE CASE THE OLD KEY GOT WRONG: a scalp inside a holding ---")

hold = L.open_position("SBIN", "NSE", "EQUITY", "BUY", 100, 600.0, "2026-06-01",
                       trade_style="POSITIONAL",
                       thesis={"horizon": "positional", "stopPrice": 560.0})
scalp = L.open_position("SBIN", "NSE", "EQUITY", "BUY", 500, 640.0, "2026-08-27",
                        trade_style="INTRADAY")
check("THE INTRADAY TRADE IS A SEPARATE POSITION, not an addition to the holding",
      scalp["created"] is True and scalp["addedToExisting"] is False, str(scalp["created"]))
check("two positions now exist in the same symbol and instrument",
      len(L.positions(symbol="SBIN")) == 2)
check("the holding's average cost is untouched by the scalp",
      near(L.position_detail(hold["position"]["positionId"])["avgCost"], 600.0),
      str(L.position_detail(hold["position"]["positionId"])["avgCost"]))
check("and the scalp carries its own cost",
      near(scalp["position"]["avgCost"], 640.0), str(scalp["position"]["avgCost"]))
check("the derived view reports the style", scalp["position"]["tradeStyle"] == "INTRADAY")
check("and that it was stated rather than inferred",
      scalp["position"]["styleInferred"] is False)

more = L.open_position("SBIN", "NSE", "EQUITY", "BUY", 200, 645.0, "2026-08-27",
                       trade_style="INTRADAY")
check("a second intraday fill DOES add to the open intraday position",
      more["addedToExisting"] is True, str(more))
check("still two positions in the symbol", len(L.positions(symbol="SBIN")) == 2)
# (500*640 + 200*645) / 700 = 641.4285...
check("re-averaged across the intraday fills only",
      near(more["position"]["avgCost"], 641.4286, 0.001), str(more["position"]["avgCost"]))

check("positions can be filtered by style",
      len(L.positions(symbol="SBIN", trade_style="INTRADAY")) == 1
      and len(L.positions(symbol="SBIN", trade_style="POSITIONAL")) == 1)
check("filtering by an unused style finds nothing",
      len(L.positions(symbol="SBIN", trade_style="LONGTERM")) == 0)
check("an invalid filter is refused", raises(L.positions, None, "SBIN", "1d", "bogus"))


print("\n--- a legal intraday short is no longer flagged as an anomaly ---")

shorted = L.open_position("IDEA", "NSE", "EQUITY", "SELL", 1000, 12.0, "2026-08-27",
                          trade_style="INTRADAY")
check("an INTRADAY equity short raises no deliverability flag",
      not any("short" in f.lower() for f in shorted["position"]["flags"]),
      str(shorted["position"]["flags"]))
held_short = L.open_position("YESBANK", "NSE", "EQUITY", "SELL", 1000, 20.0, "2026-08-27",
                             trade_style="POSITIONAL")
check("BUT A POSITIONAL EQUITY SHORT STILL IS — it cannot be delivered",
      any("short" in f.lower() for f in held_short["position"]["flags"]),
      str(held_short["position"]["flags"]))
check("and the flag names the style it was recorded under",
      any("POSITIONAL" in f for f in held_short["position"]["flags"]),
      str(held_short["position"]["flags"]))


print("\n--- style and thesis horizon may disagree, and that is reported ---")

mix = L.open_position("TATAMOTORS", "NSE", "EQUITY", "BUY", 10, 900.0, "2026-08-27",
                      trade_style="INTRADAY",
                      thesis={"horizon": "positional", "stopPrice": 880.0})
check("a disagreement between style and thesis is reported",
      bool(mix["position"]["styleVsThesis"]), str(mix["position"]["styleVsThesis"]))
check("NEITHER IS OVERRIDDEN — the style stays as declared",
      mix["position"]["tradeStyle"] == "INTRADAY")
check("and the thesis horizon stays as declared",
      mix["position"]["thesis"]["horizon"] == "positional")
agree = L.open_position("WIPRO", "NSE", "EQUITY", "BUY", 10, 500.0, "2026-08-27",
                        trade_style="SWING", thesis={"horizon": "swing"})
check("matching style and horizon report no conflict",
      agree["position"]["styleVsThesis"] is None,
      str(agree["position"]["styleVsThesis"]))


print("\n--- correcting a mis-recorded style ---")

fixed = L.set_style(scalp["position"]["positionId"], "SWING")
check("the style can be changed", fixed["position"]["tradeStyle"] == "SWING")
check("THE CHANGE IS RECORDED, because it changes what Rāma will warn about",
      any(n.get("kind") == "style-changed"
          for n in L.position_detail(scalp["position"]["positionId"])["notes"]),
      str(L.position_detail(scalp["position"]["positionId"])["notes"]))
check("the note names both the old and the new style",
      any("INTRADAY to SWING" in (n.get("text") or "")
          for n in L.position_detail(scalp["position"]["positionId"])["notes"]))
check("an invalid style is refused", raises(L.set_style, scalp["position"]["positionId"], "xx"))
check("an unknown position is a KeyError", raises(L.set_style, "nosuch", "SWING"))
L.set_style(scalp["position"]["positionId"], "INTRADAY")


print("\n--- the portfolio breaks exposure down by style ---")

p = L.portfolio()
check("a per-style breakdown is reported", isinstance(p.get("byStyle"), dict), str(p.get("byStyle")))
check("intraday exposure is separated from held exposure",
      "INTRADAY" in p["byStyle"] and "POSITIONAL" in p["byStyle"], str(list(p["byStyle"])))
check("each style carries its own invested value",
      all("investedValue" in v for v in p["byStyle"].values()))
check("styles with no positions are omitted rather than shown as zero",
      all(v["open"] > 0 or v["realisedPnl"] is not None for v in p["byStyle"].values()))
check("positions whose style had to be inferred are counted",
      isinstance(p["inferredStyleCount"], int), str(p["inferredStyleCount"]))
style_sum = sum(v["investedValue"] or 0 for v in p["byStyle"].values())
check("per-style invested values sum to the book total",
      near(style_sum, p["investedValue"], 1.0), f"{style_sum} vs {p['investedValue']}")

print(f"\n{'=' * 62}")
print(f"  {PASS} passed, {FAIL} failed  (including Section 77 trade styles)")
print(f"{'=' * 62}")
sys.exit(1 if FAIL else 0)
