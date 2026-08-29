"""
test_alerts.py — what entitles an alert to tell master to act.

The load-bearing assertions are not that alerts fire. They are that the WRONG ones cannot:

  - a MODEL alert is non-actionable while no horizon has cleared the gate, and says why
  - ADD is never actionable on arithmetic alone, however good the position looks
  - a stale price strips authority from every alert that compares a price
  - master can tell "nothing is wrong" apart from "Rāma is not allowed to tell you"

A test suite that only checked alerts appear would pass on a module that shipped a failed
model's opinion as an instruction, which is the specific harm this design exists to prevent.
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


_TMP = tempfile.mkdtemp(prefix="rama-alerts-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import alerts as A       # noqa: E402
from engine import ledger as L       # noqa: E402
from engine import store            # noqa: E402


def kinds(rows):
    return [r["kind"] for r in rows]


def one(rows, kind):
    hits = [r for r in rows if r["kind"] == kind]
    return hits[0] if hits else None


def view(**over):
    """A derived position view, as `ledger.derive` would produce it."""
    base = {
        "positionId": "p1", "symbol": "RELIANCE", "exchange": "NSE", "instrType": "EQUITY",
        "status": "open", "direction": "LONG", "netQty": 100, "avgCost": 2400.0,
        "investedValue": 240000.0, "lastPrice": 2400.0, "marketValue": 240000.0,
        "realisedPnl": 0.0, "unrealisedPnl": 0.0, "feesTotal": 0.0, "netPnl": 0.0,
        "pnlPct": 0.0, "fillCount": 1, "openedAt": "2026-08-01T10:00:00", "closedAt": None,
        "firstFillDate": "2026-08-01", "lastFillDate": "2026-08-01", "daysHeld": 5,
        "priceAsOf": "2026-08-28", "priceStale": False, "flags": [],
        "thesis": {"direction": "LONG", "horizon": "swing", "targetPrice": 2700.0,
                   "stopPrice": 2280.0, "probability": 0.6, "rationale": "test"},
    }
    base.update(over)
    return base


# ── DECLARED: the levels master set himself ───────────────────────────────────
print("\n--- a stop is master's own instruction, not a forecast ---")

r = A.evaluate_position(view(lastPrice=2270.0))
a = one(r, "STOP_BREACHED")
check("a long below its stop raises STOP_BREACHED", a is not None, str(kinds(r)))
check("the action is EXIT", a and a["action"] == "EXIT")
check("the severity is critical", a and a["severity"] == "critical")
check("THE EVIDENCE IS DECLARED — master set the level", a and a["evidence"] == "DECLARED")
check("IT IS ACTIONABLE, because it is his own instruction", a and a["actionable"] is True)
check("it names the field that triggered it",
      a and a["triggeredBy"]["field"] == "thesis.stopPrice", str(a and a["triggeredBy"]))
check("it reports the threshold and the observation",
      a and a["triggeredBy"]["threshold"] == 2280.0 and a["triggeredBy"]["observed"] == 2270.0)
check("it says plainly it is not a forecast",
      a and "not a forecast" in a["detail"], str(a and a["detail"]))

r = A.evaluate_position(view(lastPrice=2400.0))
check("a long above its stop does not raise STOP_BREACHED",
      one(r, "STOP_BREACHED") is None, str(kinds(r)))

short = view(netQty=-100, direction="SHORT", instrType="FUTURES",
             thesis={"direction": "SHORT", "horizon": "swing", "targetPrice": 2200.0,
                     "stopPrice": 2500.0})
r = A.evaluate_position(short | {"lastPrice": 2520.0})
check("A SHORT ABOVE its stop is breached — the comparison flips with the sign",
      one(r, "STOP_BREACHED") is not None, str(kinds(r)))
r = A.evaluate_position(short | {"lastPrice": 2400.0})
check("a short below its stop is not breached", one(r, "STOP_BREACHED") is None)

r = A.evaluate_position(view(lastPrice=2310.0))
a = one(r, "STOP_APPROACHING")
check("within 2% of the stop raises STOP_APPROACHING", a is not None, str(kinds(r)))
check("as a REVIEW, not an EXIT", a and a["action"] == "REVIEW")
check("and it reports the gap", a and a["triggeredBy"]["gapPct"] <= 2.0,
      str(a and a["triggeredBy"]))
r = A.evaluate_position(view(lastPrice=2500.0))
check("comfortably above the stop raises neither stop alert",
      one(r, "STOP_APPROACHING") is None and one(r, "STOP_BREACHED") is None, str(kinds(r)))


print("\n--- a target reached is a reason satisfied, not a move ended ---")

r = A.evaluate_position(view(lastPrice=2750.0, pnlPct=14.6, unrealisedPnl=35000))
a = one(r, "TARGET_REACHED")
check("a long at or above its target raises TARGET_REACHED", a is not None, str(kinds(r)))
check("the action is REDUCE, not EXIT", a and a["action"] == "REDUCE")
check("IT DOES NOT CLAIM THE MOVE IS OVER",
      a and "not telling you the move is over" in a["detail"], str(a and a["detail"]))
r = A.evaluate_position(view(lastPrice=2660.0))
check("within 2% of target raises TARGET_APPROACHING",
      one(r, "TARGET_APPROACHING") is not None, str(kinds(r)))
r = A.evaluate_position(short | {"lastPrice": 2150.0})
check("a SHORT at or below its target has reached it",
      one(r, "TARGET_REACHED") is not None, str(kinds(r)))


print("\n--- no stop recorded is itself the warning ---")

r = A.evaluate_position(view(thesis={"direction": "LONG", "horizon": "swing"}))
a = one(r, "NO_STOP_SET")
check("a position with no stop raises NO_STOP_SET", a is not None, str(kinds(r)))
check("it is MEASURED, not DECLARED — master declared nothing",
      a and a["evidence"] == "MEASURED")
check("it is actionable: recording a stop is something he can do now",
      a and a["actionable"] is True)
check("it says nothing bounds the loss", a and "bounds the loss" in a["detail"])
r = A.evaluate_position(view())
check("a position with a stop does not raise it", one(r, "NO_STOP_SET") is None)
r = A.evaluate_position(view(thesis={}, investedValue=0, netQty=100))
check("no capital invested raises no missing-stop warning",
      one(r, "NO_STOP_SET") is None, str(kinds(r)))


# ── MEASURED: arithmetic ──────────────────────────────────────────────────────
print("\n--- arithmetic on his own fills ---")

r = A.evaluate_position(view(lastPrice=2100.0, pnlPct=-12.5, unrealisedPnl=-30000))
a = one(r, "LOSS_THRESHOLD")
check("down more than 10% raises LOSS_THRESHOLD", a is not None, str(kinds(r)))
check("it is MEASURED", a and a["evidence"] == "MEASURED")
check("it is actionable on a fresh price", a and a["actionable"] is True)
check("it states it is arithmetic rather than a forecast",
      a and "not a forecast" in a["detail"])
r = A.evaluate_position(view(pnlPct=-5.0))
check("down 5% does not", one(r, "LOSS_THRESHOLD") is None)
r = A.evaluate_position(view(pnlPct=None))
check("an unknown P&L percent cannot trigger a loss alert",
      one(r, "LOSS_THRESHOLD") is None, str(kinds(r)))


print("\n--- a thesis has a shelf life ---")

r = A.evaluate_position(view(daysHeld=60, thesis={"horizon": "swing", "stopPrice": 2280.0}))
a = one(r, "THESIS_EXPIRED")
check("a SWING thesis held 60 days has expired", a is not None, str(kinds(r)))
check("it is MEASURED", a and a["evidence"] == "MEASURED")
check("it says the position is now held for an unstated reason",
      a and "reason you have not stated" in a["detail"], str(a and a["detail"]))
check("it names the thesis horizon that expired",
      a and a["triggeredBy"]["thesisHorizon"] == "swing")
r = A.evaluate_position(view(daysHeld=6, thesis={"horizon": "swing", "stopPrice": 2280.0}))
check("a swing thesis held 6 days has not expired", one(r, "THESIS_EXPIRED") is None)
# positional is 20 daily bars ~= 28 calendar days, so the tolerance is ~56 — 40 is inside it
# while the same 40 days would be well past a swing thesis's 14.
r = A.evaluate_position(view(daysHeld=40, thesis={"horizon": "positional",
                                                  "stopPrice": 2280.0}))
check("A POSITIONAL THESIS AT 40 DAYS HAS NOT — the span differs per horizon",
      one(r, "THESIS_EXPIRED") is None, str(kinds(r)))
check("while the SAME 40 days expires a swing thesis",
      one(A.evaluate_position(view(daysHeld=40, thesis={"horizon": "swing",
                                                        "stopPrice": 2280.0})),
          "THESIS_EXPIRED") is not None)
r = A.evaluate_position(view(daysHeld=200, thesis={"horizon": "positional",
                                                   "stopPrice": 2280.0}))
check("but a positional thesis at 200 days has", one(r, "THESIS_EXPIRED") is not None)
r = A.evaluate_position(view(daysHeld=600, thesis={"stopPrice": 2280.0}))
check("no recorded horizon means no expiry claim", one(r, "THESIS_EXPIRED") is None)


print("\n--- concentration is a fact about size, not direction ---")

r = A.evaluate_position(view(), book_invested=400000.0)
a = one(r, "CONCENTRATION")
check("240,000 of a 400,000 book is a concentration alert", a is not None, str(kinds(r)))
check("the action is REDUCE", a and a["action"] == "REDUCE")
check("it says it is independent of direction",
      a and "independent of direction" in a["detail"])
check("it reports the share", a and 59 < a["triggeredBy"]["observed"] < 61,
      str(a and a["triggeredBy"]))
r = A.evaluate_position(view(), book_invested=2000000.0)
check("12% of the book is not", one(r, "CONCENTRATION") is None)
r = A.evaluate_position(view(), book_invested=None)
check("with no book total, no concentration claim is made",
      one(r, "CONCENTRATION") is None)


print("\n--- a net short on cash equity ---")

r = A.evaluate_position(view(netQty=-100, direction="SHORT",
                             flags=["net short on equity — deliverable short selling is not "
                                    "permitted in Indian cash equity, so this must be an "
                                    "intraday position"]))
a = one(r, "EQUITY_SHORT")
check("the ledger's equity-short flag becomes an alert", a is not None, str(kinds(r)))
check("it is critical", a and a["severity"] == "critical")
check("it offers both readings — intraday, or the wrong instrument",
      a and "wrong instrument" in a["detail"])


# ── A stale price strips authority ────────────────────────────────────────────
print("\n--- THE RULE THAT MATTERS MOST: a stale price cannot instruct ---")

stale = view(lastPrice=2270.0, priceStale=True, priceAsOf="2026-06-01",
             flags=["the newest stored bar is 88 days old — sync before trusting P&L"])
r = A.evaluate_position(stale)
check("a stale price raises PRICE_STALE", one(r, "PRICE_STALE") is not None, str(kinds(r)))
check("the PRICE_STALE alert is itself non-actionable",
      one(r, "PRICE_STALE")["actionable"] is False)
check("its action is NONE", one(r, "PRICE_STALE")["action"] == "NONE")

breach = one(r, "STOP_BREACHED")
check("the stop breach is still REPORTED, not hidden", breach is not None, str(kinds(r)))
check("BUT IT IS NOT ACTIONABLE — an exit on last week's close is worse than silence",
      breach and breach["actionable"] is False)
check("and it says why", breach and breach["whyNotActionable"],
      str(breach and breach["whyNotActionable"]))
check("the reason names the staleness",
      breach and ("stale" in breach["whyNotActionable"].lower()
                  or "days old" in breach["whyNotActionable"]))

r2 = A.evaluate_position(view(lastPrice=None, priceStale=True,
                              flags=["no stored price for this symbol, so unrealised P&L "
                                     "cannot be computed"]))
check("no price at all also raises PRICE_STALE", one(r2, "PRICE_STALE") is not None)
check("a missing price cannot raise a stop breach",
      one(r2, "STOP_BREACHED") is None, str(kinds(r2)))

nostop = one(A.evaluate_position(stale | {"thesis": {"horizon": "swing"}}), "NO_STOP_SET")
check("NO_STOP_SET STAYS ACTIONABLE on a stale price — it compares no price at all",
      nostop and nostop["actionable"] is True)


# ── Closed and flat positions ────────────────────────────────────────────────
print("\n--- nothing to warn about ---")

check("a closed position raises no alerts",
      A.evaluate_position(view(status="closed")) == [])
check("a flat position raises no alerts", A.evaluate_position(view(netQty=0)) == [])


# ── Model entitlement ────────────────────────────────────────────────────────
print("\n--- is a model allowed to speak? ---")

e = A.model_entitlement("swing")
check("an untrained horizon is NOT entitled", e["entitled"] is False, str(e))
check("and the reason says it has never been trained",
      "never been trained" in (e["reason"] or ""), str(e["reason"]))
check("no models are listed as accepted", e["acceptedModels"] == [])
bad = A.model_entitlement("no-such-horizon")
check("an unknown horizon is not entitled either", bad["entitled"] is False)
check("and says so rather than raising", "unknown horizon" in (bad["reason"] or ""),
      str(bad["reason"]))
check("AND REFUSES TO ANSWER FROM THE LEGACY RECORD — horizons.get returns None for an "
      "unknown name, and load_provenance(None) would read the unsuffixed model",
      "legacy record must not be used" in (bad["reason"] or ""), str(bad["reason"]))
check("an unknown horizon lists no accepted models", bad["acceptedModels"] == [])


print("\n--- a model that has not cleared the gate cannot instruct ---")

pred_down = {"horizons": {"swing": {"probability": 0.18, "conviction": 0.64, "bars": 2192,
                                    "interval": "1d", "asOf": "2026-08-28"}},
             "agreement": {"state": "aligned-short", "weakestConviction": 0.64}}
r = A.evaluate_position(view(), prediction=pred_down)
a = one(r, "MODEL_AGAINST_POSITION")
check("a model pointing against a long is reported", a is not None, str(kinds(r)))
check("its evidence class is MODEL", a and a["evidence"] == "MODEL")
check("IT IS NOT ACTIONABLE — no horizon has cleared the gate",
      a and a["actionable"] is False, str(a))
check("the reason names the horizon", a and "swing" in (a["whyNotActionable"] or ""))
check("THE REASON QUOTES THE GATE rather than paraphrasing it",
      a and "has not cleared the gate" in (a["whyNotActionable"] or ""),
      str(a and a["whyNotActionable"]))
check("it says it is reported so master knows Rāma looked",
      a and "Rāma looked" in (a["whyNotActionable"] or ""))
check("its severity drops to info while ungated", a and a["severity"] == "info")
check("the probability is still shown honestly",
      a and a["triggeredBy"]["observed"] == 0.18)

entitled = {"swing": {"horizon": "swing", "entitled": True,
                      "reason": "cleared the gate: random_forest",
                      "acceptedModels": ["random_forest"]}}
r = A.evaluate_position(view(), prediction=pred_down, entitlements=entitled)
a = one(r, "MODEL_AGAINST_POSITION")
check("WITH a gate pass the same alert becomes actionable",
      a and a["actionable"] is True, str(a))
check("and its severity rises to warning", a and a["severity"] == "warning")
check("with no withholding reason", a and a["whyNotActionable"] is None)

r = A.evaluate_position(stale, prediction=pred_down, entitlements=entitled)
a = one(r, "MODEL_AGAINST_POSITION")
check("a gate pass does NOT survive a stale price", a and a["actionable"] is False,
      str(a and a["whyNotActionable"]))


print("\n--- THE ASYMMETRY: adding is not the mirror of reducing ---")

pred_up = {"horizons": {"swing": {"probability": 0.86, "conviction": 0.72, "bars": 2192,
                                  "interval": "1d", "asOf": "2026-08-28"}},
           "agreement": {"state": "aligned-long", "weakestConviction": 0.72}}
r = A.evaluate_position(view(), prediction=pred_up)
a = one(r, "MODEL_SUPPORTS_ADD")
check("a strongly agreeing model produces an ADD candidate", a is not None, str(kinds(r)))
check("ADD IS NEVER REACHED THROUGH ARITHMETIC — its evidence is MODEL",
      a and a["evidence"] == "MODEL")
check("AND IT IS NOT ACTIONABLE while ungated", a and a["actionable"] is False)
check("it explains that increasing exposure needs more than arithmetic",
      a and "increases" in a["detail"] and "at risk" in a["detail"], str(a and a["detail"]))

check("NO ADD ALERT EXISTS WITH DECLARED OR MEASURED EVIDENCE, in any scenario tested",
      all(not (x["action"] == "ADD" and x["evidence"] in (A.DECLARED, A.MEASURED))
          for x in (A.evaluate_position(view(), book_invested=400000.0)
                    + A.evaluate_position(view(lastPrice=2750.0))
                    + A.evaluate_position(view(pnlPct=-12.5))
                    + A.evaluate_position(view(daysHeld=60))
                    + A.evaluate_position(stale)
                    + A.evaluate_position(view(), prediction=pred_up))))

r = A.evaluate_position(view(), prediction=pred_up, entitlements=entitled)
check("even entitled, ADD only becomes actionable via the MODEL class",
      one(r, "MODEL_SUPPORTS_ADD")["actionable"] is True)

weak = {"horizons": {"swing": {"probability": 0.53, "conviction": 0.06, "bars": 100,
                               "interval": "1d", "asOf": "2026-08-28"}},
        "agreement": {"state": "aligned-long"}}
r = A.evaluate_position(view(), prediction=weak)
check("a near-coin-flip reading is not relayed at all",
      one(r, "MODEL_SUPPORTS_ADD") is None and one(r, "MODEL_AGAINST_POSITION") is None,
      str(kinds(r)))

err = {"horizons": {"swing": {"probability": None, "error": "need at least 120 bars"}},
       "agreement": {"state": "unknown"}}
r = A.evaluate_position(view(), prediction=err)
check("a failed prediction produces no model alert",
      not any(x["evidence"] == "MODEL" for x in r), str(kinds(r)))
check("and no prediction at all produces none either",
      not any(x["evidence"] == "MODEL" for x in A.evaluate_position(view())))


print("\n--- disagreement between horizons ---")

split = {"horizons": {"intraday": {"probability": 0.22, "conviction": 0.56, "interval": "60m",
                                   "bars": 1593, "asOf": "2026-08-28"},
                      "positional": {"probability": 0.79, "conviction": 0.58,
                                     "interval": "1d", "bars": 2185, "asOf": "2026-08-28"}},
         "agreement": {"state": "split", "weakestConviction": 0.56,
                       "long": ["positional"], "short": ["intraday"],
                       "note": "a pullback inside an uptrend"}}
r = A.evaluate_position(view(), prediction=split)
a = one(r, "MODEL_SPLIT")
check("a split raises MODEL_SPLIT", a is not None, str(kinds(r)))
check("it is not actionable while nothing is entitled", a and a["actionable"] is False)
check("and the reason is that neither reading has been shown to predict anything",
      a and "neither of which has been shown to predict" in (a["whyNotActionable"] or ""),
      str(a and a["whyNotActionable"]))
check("it carries Section 73's note through", a and "pullback" in a["detail"])
check("it reports the weakest conviction, not a mean", a and "0.56" in a["detail"])
r = A.evaluate_position(view(), prediction=pred_up)
check("agreement raises no split alert", one(r, "MODEL_SPLIT") is None)


# ── The whole book, end to end ────────────────────────────────────────────────
print("\n--- across the tracked book ---")

res = A.evaluate()
check("an empty ledger produces no alerts", res["alerts"] == [], str(res["alerts"]))
check("and says there is nothing tracked rather than nothing wrong",
      "nothing to warn about" in res["summary"], res["summary"])
check("it invites master to record what he holds", "Record what you hold" in res["summary"])
check("zero positions checked", res["positionsChecked"] == 0)

days = pd.bdate_range(end=_dt.date.today(), periods=60)
closes = [2000.0 + i * 10 for i in range(40)] + [2400.0 - i * 25 for i in range(20)]
store.merge("BOOKED", pd.DataFrame({
    "date": [d.strftime("%Y-%m-%d") for d in days], "open": closes, "high": closes,
    "low": closes, "close": closes, "volume": 1000}), "NSE", "1d")

L.open_position("BOOKED", "NSE", "EQUITY", "BUY", 100, 2000.0,
                days[0].strftime("%Y-%m-%d"),
                thesis={"direction": "LONG", "horizon": "swing",
                        "targetPrice": 2500.0, "stopPrice": 1900.0})
res = A.evaluate()
check("a tracked position is checked", res["positionsChecked"] == 1, str(res))
check("the book's invested value is reported", res["investedValue"] == 200000.0,
      str(res["investedValue"]))
ks = kinds(res["alerts"])
check("the drawdown from its peak since entry is found",
      "DRAWDOWN_FROM_PEAK" in ks, str(ks))
d = one(res["alerts"], "DRAWDOWN_FROM_PEAK")
check("the peak is the best close since the first fill, 2400",
      d and abs(d["triggeredBy"]["peak"] - 2400.0) < 0.01, str(d and d["triggeredBy"]))
check("measured on closes, and it says so", d and "not an intraday wick" in d["detail"])
check("a swing thesis held 60 business days is flagged expired",
      "THESIS_EXPIRED" in ks, str(ks))
check("one position is the whole book, so concentration fires", "CONCENTRATION" in ks)
check("alerts carry the position id", all(a["positionId"] for a in res["alerts"]))
check("and the symbol", all(a["symbol"] == "BOOKED" for a in res["alerts"]))
check("the evidence breakdown is reported",
      set(res["byEvidence"]) == {"DECLARED", "MEASURED", "MODEL"}, str(res["byEvidence"]))
check("no MODEL alerts appear when predictions are not requested",
      res["byEvidence"]["MODEL"] == 0, str(res["byEvidence"]))
check("predictions are off by default", res["predictionsIncluded"] is False)
check("the summary counts the actionable ones",
      "actionable" in res["summary"], res["summary"])
check("critical count is reported", isinstance(res["critical"], int))
check("it is timestamped", bool(res["generatedAt"]))

check("filtering by symbol finds it", A.evaluate(symbol="BOOKED")["positionsChecked"] == 1)
check("and another symbol finds nothing", A.evaluate(symbol="INFY")["positionsChecked"] == 0)

crit = [a for a in res["alerts"] if a["severity"] == "critical" and a["actionable"]]
non = [a for a in res["alerts"] if not a["actionable"]]
if res["alerts"]:
    check("actionable alerts sort ahead of withheld ones",
          all(res["alerts"][i]["actionable"] >= res["alerts"][i + 1]["actionable"]
              for i in range(len(res["alerts"]) - 1)),
          str([(a["kind"], a["actionable"]) for a in res["alerts"]]))
check("withheld are counted separately from actionable",
      res["withheld"] == len(non) and res["actionable"] == len(res["alerts"]) - len(non))

L.open_position("STALEBOOK", "NSE", "EQUITY", "BUY", 5, 100.0, "2026-01-01",
                thesis={"horizon": "swing", "stopPrice": 90.0})
res = A.evaluate()
check("a symbol with no bars at all is still checked", res["positionsChecked"] == 2)
sb = [a for a in res["alerts"] if a["symbol"] == "STALEBOOK"]
check("and produces a PRICE_STALE rather than a fabricated P&L",
      "PRICE_STALE" in kinds(sb), str(kinds(sb)))
check("no price comparison is asserted against it",
      not any(a["kind"] in ("STOP_BREACHED", "TARGET_REACHED") and a["actionable"]
              for a in sb), str([(a["kind"], a["actionable"]) for a in sb]))

res = A.evaluate(include_prediction=True)
check("requesting predictions records that they were included",
      res["predictionsIncluded"] is True)
check("entitlements are reported for every horizon",
      set(res["entitlements"]) == {"intraday", "swing", "positional"},
      str(list(res["entitlements"])))
check("NONE of them is entitled, on an untrained install",
      not any(e["entitled"] for e in res["entitlements"].values()))
check("THE SUMMARY SAYS SO EXPLICITLY — master must not read silence as safety",
      "no horizon's model has cleared the gate" in res["summary"], res["summary"])
check("every MODEL alert in the book is non-actionable",
      all(not a["actionable"] for a in res["alerts"] if a["evidence"] == "MODEL"),
      str([(a["kind"], a["actionable"]) for a in res["alerts"]
           if a["evidence"] == "MODEL"]))


print(f"\n{'=' * 62}")
print(f"  {PASS} passed, {FAIL} failed")
print(f"{'=' * 62}")
sys.exit(1 if FAIL else 0)
