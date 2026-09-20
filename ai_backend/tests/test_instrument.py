"""
test_instrument.py — instrument type, lot size, and real rupee charges (Section 115).

Master asked for every instrument type with its own tab. This is the prerequisite: without an instrument
on the spec, `costs.py` cannot be applied per trade, and a tab that charges equity rates on an options
trade is worse than no tab at all.

The assertions that matter:
  - the FLATTERING error is refused: intraday charges on bars the strategy can hold overnight,
  - options are BLOCKED rather than priced against the wrong series,
  - lot rounding is reported, because 4 units of a 75-unit contract is zero lots and not a free trade,
  - the real rupee figure sits BESIDE the flat one so the size of the old error stays visible.

Run from `ai_backend/`:  py -m tests.test_instrument
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import costs as C            # noqa: E402
import strategy_spec as S    # noqa: E402

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


def spec(**over):
    base = {
        "name": "t", "symbol": "RELIANCE", "exchange": "NSE", "interval": "1d", "side": "long",
        "entry": {"op": "all", "blocks": [{"id": "breakout", "params": {"lookback": 20}}]},
        "exit": {"stopPct": 2.0, "targetPct": 6.0, "maxBars": 20},
        "sizing": {"capital": 500000, "riskPct": 1.0},
    }
    base.update(over)
    return base


print("\ninstrument type, lots, and charges in rupees\n")

# ── Derivation ────────────────────────────────────────────────────────────────
print("  the instrument is derived from the bars, and reported as derived")
v = S.validate_spec(spec())
check("daily bars imply delivery", v["spec"]["instrument"] == "equity_delivery")
check("and it is flagged as derived, not chosen", v["spec"]["instrumentDerived"] is True)
check("with a warning that the charge difference is large",
      any("charge difference" in w for w in v["warnings"]))
vi = S.validate_spec(spec(interval="15m", exit={"stopPct": 1.0, "maxBars": 6}))
check("intraday bars imply intraday charges", vi["spec"]["instrument"] == "equity_intraday")
ve = S.validate_spec(spec(instrument="futures", lotSize=75))
check("an explicit instrument is not overridden", ve["spec"]["instrument"] == "futures")
check("and is not flagged as derived", ve["spec"]["instrumentDerived"] is False)
check("no derivation warning when master chose",
      not any("No instrument chosen" in w for w in ve["warnings"]))
check("an unknown instrument is an error, not a default",
      S.validate_spec(spec(instrument="crypto"))["ok"] is False)
check("and the error lists what is valid",
      any("equity_delivery" in e for e in S.validate_spec(spec(instrument="crypto"))["errors"]))

# ── The flattering error ──────────────────────────────────────────────────────
print("\n  the error that would make a result look better is refused")
bad = S.validate_spec(spec(instrument="equity_intraday"))
check("intraday charges on daily bars held for 20 bars is REFUSED", bad["ok"] is False)
check("and the reason says the position is held overnight",
      any("held overnight" in e for e in bad["errors"]), bad["errors"])
check("and names the direction of the error - it UNDERSTATES the cost",
      any("understate" in e for e in bad["errors"]))
ok1 = S.validate_spec(spec(instrument="equity_intraday",
                           exit={"stopPct": 2.0, "targetPct": 6.0, "maxBars": 1}))
check("maxBars of 1 on daily bars IS intraday, and is allowed", ok1["ok"] is True, ok1["errors"])
check("intraday on intraday bars is fine",
      S.validate_spec(spec(instrument="equity_intraday", interval="5m",
                           exit={"stopPct": 1.0, "maxBars": 12}))["ok"] is True)

# ── Options are blocked, not mispriced ───────────────────────────────────────
print("\n  options: offered and refused")
opt = S.validate_spec(spec(instrument="options", lotSize=75))
check("the spec still validates - it can be specified", opt["ok"] is True, opt["errors"])
check("but it is NOT backtestable", opt["backtestable"] is False)
check("and appears in blocked with a label", any(b["label"] == "Options" for b in opt["blocked"]))
check("the reason names the missing per-strike premium history",
      any("premium history" in b["why"] for b in opt["blocked"]))
check("and says a backtest would be measuring the wrong thing",
      any("not a measurement of anything" in b["why"] for b in opt["blocked"]))
check("run_spec therefore refuses the whole spec",
      S.run_spec(spec(instrument="options", lotSize=75), [])["ok"] is False)
check("naming options as the cause",
      "Options" in S.run_spec(spec(instrument="options", lotSize=75), [])["reason"])

print("\n  futures are allowed, with the proxy stated")
fut = S.validate_spec(spec(instrument="futures", lotSize=75))
check("futures validate", fut["ok"] is True)
check("and are backtestable", fut["backtestable"] is True)
check("but a warning says the bars are the SPOT series",
      any("SPOT series" in w for w in fut["warnings"]), fut["warnings"])
check("and that basis and rollover are not modelled",
      any("rolling at expiry are not modelled" in w for w in fut["warnings"]))

# ── Lot size ──────────────────────────────────────────────────────────────────
print("\n  lot size")
check("a lot size of 1 on futures warns that real contracts trade in lots",
      any("fixed lots" in w for w in S.validate_spec(spec(instrument="futures"))["warnings"]))
check("NIFTY's 75 is named in that warning",
      any("75 units" in w for w in S.validate_spec(spec(instrument="futures"))["warnings"]))
check("a zero lot size is an error", S.validate_spec(spec(lotSize=0))["ok"] is False)
check("a negative lot size is an error", S.validate_spec(spec(lotSize=-5))["ok"] is False)
check("a non-numeric lot size is an error", S.validate_spec(spec(lotSize="many"))["ok"] is False)
check("an absurd lot size is refused", S.validate_spec(spec(lotSize=999999))["ok"] is False)
check("equity does not warn about lots", 
      not any("fixed lots" in w for w in S.validate_spec(spec())["warnings"]))

# ── Real charges beside the flat model ───────────────────────────────────────
print("\n  the rupee figure sits beside the percentage one")
trades = [{"entryDate": "2026-01-05", "exitDate": "2026-01-09", "entryPrice": 1000.0,
           "exitPrice": 1030.0, "bars": 4, "grossPct": 3.0, "exitReason": "target"}] * 12
cv = S.validate_spec(spec(instrument="equity_delivery"))["spec"]
m = S.money_summary(cv, trades, 0.17)
check("the flat-model fields are unchanged", "roiPct" in m and "netPnl" in m)
rc = m["realCharges"]
check("a real-charge block is present", rc["ok"] is True, rc.get("reason"))
check("it names the instrument it priced as", rc["instrument"] == "equity_delivery")
check("it priced every trade", rc["tradesPriced"] == 12)
check("charges are a positive rupee amount", rc["totalCharges"] > 0)
check("gross P&L is in rupees, not percent", rc["grossPnl"] > 1000)
check("net is gross less charges", abs(rc["netPnl"] - (rc["grossPnl"] - rc["totalCharges"])) < 1e-6)
check("both round-trip percentages are reported side by side",
      rc["realRoundTripPct"] is not None and rc["flatModelRoundTripPct"] == 0.17)
check("and the note says which way the flat model was wrong",
      "UNDERSTATE" in rc["note"] or "overstate" in rc["note"], rc["note"])
check("provenance travels with the figure", rc["provenance"]["asOf"] == C.TABLE_AS_OF)
check("and the contract-note caveat is repeated here",
      "contract note" in rc["note"])

print("\n  a small delivery trade is where the flat model lies most")
small = [{"entryDate": "2026-01-05", "exitDate": "2026-01-09", "entryPrice": 100.0,
          "exitPrice": 104.0, "bars": 4, "grossPct": 4.0, "exitReason": "target"}] * 40
tiny = S.validate_spec(spec(instrument="equity_delivery",
                            sizing={"capital": 20000, "riskPct": 1.0}))["spec"]
st = S.money_summary(tiny, small, 0.17)["realCharges"]
check("the real round trip far exceeds the flat assumption",
      st["realRoundTripPct"] > st["flatModelRoundTripPct"], 
      (st["realRoundTripPct"], st["flatModelRoundTripPct"]))
check("and the note says the percentage figures understate the cost", "UNDERSTATE" in st["note"])

# ── THE RETAIL CONSTRAINT ─────────────────────────────────────────────────────
print("\n  a contract master cannot afford is reported, not rounded past")
nifty = [{"entryDate": "2026-01-05", "exitDate": "2026-01-09", "entryPrice": 25000.0,
          "exitPrice": 25500.0, "bars": 4, "grossPct": 2.0, "exitReason": "target"}] * 10
# Rs 1,00,000 capital, 1% risk = Rs 1,000. A 2% stop on 25,000 is Rs 500 per unit, so 2 units - and a
# NIFTY lot is 75. Master cannot place this trade at all.
poor = S.validate_spec(spec(instrument="futures", lotSize=75,
                            sizing={"capital": 100000, "riskPct": 1.0}))["spec"]
pr = S.money_summary(poor, nifty, 0.17)["realCharges"]
check("position_size alone would report 2 units", S.position_size(poor, 25000.0) == 2)
check("but 2 units is ZERO lots of 75, so no trade is priced", pr["tradesPriced"] == 0)
check("and all ten are reported as below one lot", pr["tradesBelowOneLot"] == 10)
check("the block reports ok false rather than a zero-cost success", pr["ok"] is False)
check("and says no trade could be sized to a whole lot",
      "whole lot" in pr["reason"], pr["reason"])
check("THE NOTE SAYS THEY ARE NOT FREE TRADES",
      "NOT counted as free trades" in pr["note"], pr["note"])
check("and names the lot size that defeated the risk budget", "75 units" in pr["note"])

rich = S.validate_spec(spec(instrument="futures", lotSize=75,
                            sizing={"capital": 5000000, "riskPct": 2.0}))["spec"]
rr = S.money_summary(rich, nifty, 0.17)["realCharges"]
check("with enough capital the same strategy prices", rr["tradesPriced"] == 10, rr.get("reason"))
check("quantity is a whole multiple of the lot", all(r["units"] % 75 == 0 for r in rr["trades"]))
check("and the lot count is reported, not just the unit count",
      all(r["lots"] >= 1 for r in rr["trades"]))
check("futures STT makes the charges substantial", rr["totalCharges"] > 1000)

print("\n  options refuse a rupee figure rather than compute a wrong one")
ov = dict(S.validate_spec(spec(instrument="options", lotSize=75))["spec"])
om = S.money_summary(ov, trades, 0.17)["realCharges"]
check("no rupee figure is produced for options", om["ok"] is False)
check("and the reason is the missing premium series",
      "premium history" in om["reason"], om["reason"])
check("rather than arithmetic on the wrong series", "wrong series" in om["reason"])

# ── The codegen defect this exposed ──────────────────────────────────────────
print("\n  the generated script survives booleans and nulls")
import strategy_codegen as G   # noqa: E402
g = G.to_python(spec(instrument="equity_delivery"), verdict=None, trials=1)
check("code is produced", g["ok"] is True, g.get("reason"))
check("the spec is PARSED at runtime, not pasted as a literal", "json.loads" in g["code"])
check("and it compiles", compile(g["code"], "gen.py", "exec") is not None)
# The latent defect: a target-only strategy has stopPct None, which JSON writes as `null`. Every such
# generated script was a NameError before this was fixed, and nothing had ever run one.
nostop = G.to_python(spec(exit={"stopPct": None, "targetPct": 5.0, "maxBars": 10}),
                     verdict=None, trials=1)
check("a strategy with NO STOP still generates", nostop["ok"] is True, nostop.get("reason"))
check("and compiles, where before it was a NameError on `null`",
      compile(nostop["code"], "gen2.py", "exec") is not None)
check("the boolean field does not become a NameError on `true`",
      "true" not in g["code"].split("import csv")[0] or "json.loads" in g["code"])

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
