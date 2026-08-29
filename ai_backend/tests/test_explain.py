"""
test_explain.py — justification that cannot flatter a failed model.

The load-bearing assertions are about restraint, not coverage:

  - an observation and its conventional reading are SEPARATE bullets with different `basis`
  - no bullet ever says a fact implies a direction
  - the gate verdict is emitted BEFORE the probability it qualifies
  - the caveat travels inside the payload, so a UI cannot render bullets without it
  - a check that could not run appears as `checked: false`, never as absence

A suite that only checked bullets are produced would pass on a module that printed
"Overbought — expect a pullback" under an unvalidated probability, which is the exact harm.
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


_TMP = tempfile.mkdtemp(prefix="rama-explain-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import explain as E     # noqa: E402
from engine import store            # noqa: E402


def bars(symbol, closes, volumes=None, opens=None, exchange="NSE", interval="1d"):
    n = len(closes)
    days = pd.bdate_range(end=_dt.date.today(), periods=n)
    store.merge(symbol, pd.DataFrame({
        "date": [d.strftime("%Y-%m-%d") for d in days],
        "open": opens if opens is not None else closes,
        "high": [c * 1.01 for c in closes],
        "low": [c * 0.99 for c in closes],
        "close": closes,
        "volume": volumes if volumes is not None else [100000] * n,
    }), exchange, interval)


def texts(bullets):
    return " | ".join(b["text"] for b in bullets)


def kinds(ws):
    return [w["kind"] for w in ws]


def one(ws, kind):
    hits = [w for w in ws if w["kind"] == kind]
    return hits[0] if hits else None


# ── Observations are facts ────────────────────────────────────────────────────
print("\n--- observations from stored bars ---")

bars("TRENDUP", [1000.0 + i * 5 for i in range(300)])
b = E.justify("TRENDUP")
check("bullets are produced from stored bars", len(b) > 5, str(len(b)))
check("every bullet has text", all(x["text"] for x in b))
check("every bullet carries an evidence class",
      all(x["evidence"] in ("DECLARED", "MEASURED", "MODEL") for x in b),
      str({x["evidence"] for x in b}))
check("every bullet carries a basis",
      all(x["basis"] in (E.OBSERVATION, E.CONVENTION, E.FORECAST, E.GATE) for x in b),
      str({x["basis"] for x in b}))
check("the last close is reported", "Last stored close" in texts(b))
check("the moving averages are reported as facts with the distance",
      "20-bar average" in texts(b) and "50-bar average" in texts(b), texts(b)[:200])
check("a rising series is above its averages", "above its 20-bar" in texts(b))
check("RSI is reported as a number", "RSI(14) is" in texts(b))
check("returns over 5 and 20 bars are reported",
      "last 5 bars" in texts(b) and "last 20 bars" in texts(b))
check("position in the 252-bar range is reported", "252-bar range" in texts(b))
check("the average daily range is reported as what a stop must survive",
      "a stop has to survive" in texts(b))

check("with a rising series, no bullet claims the price will keep rising",
      not any(w in texts(b).lower() for w in
              ("will rise", "will fall", "expect a", "therefore", "should rise")),
      texts(b)[:300])


print("\n--- an observation and its conventional reading stay SEPARATE ---")

bars("HOT", [100.0] * 20 + [100.0 + i * 4 for i in range(40)])
b = E.justify("HOT")
rsi_obs = [x for x in b if x["field"] == "rsi14" and x["basis"] == E.OBSERVATION]
rsi_conv = [x for x in b if x["field"] == "rsi14" and x["basis"] == E.CONVENTION]
check("a high RSI produces an observation bullet", len(rsi_obs) == 1, str(len(rsi_obs)))
check("AND A SEPARATE convention bullet", len(rsi_conv) == 1, str(len(rsi_conv)))
check("the observation bullet states only the number, no reading",
      rsi_obs and "overbought" not in rsi_obs[0]["text"].lower(),
      str(rsi_obs and rsi_obs[0]["text"]))
check("the convention bullet NAMES ITSELF as a convention",
      rsi_conv and "convention" in rsi_conv[0]["text"].lower(),
      str(rsi_conv and rsi_conv[0]["text"]))
check("AND SAYS IT IS NOT A MEASURED EDGE",
      rsi_conv and "not a measured edge" in rsi_conv[0]["text"],
      str(rsi_conv and rsi_conv[0]["text"]))
check("no bullet fuses the fact and the reading into a prediction",
      not any("overbought" in x["text"].lower() and "expect" in x["text"].lower() for x in b))

bars("COLD", [200.0] * 20 + [200.0 - i * 3 for i in range(40)])
b = E.justify("COLD")
cold = [x for x in b if x["basis"] == E.CONVENTION]
check("a low RSI produces the oversold convention",
      any("oversold" in x["text"].lower() for x in cold), texts(cold))
check("also labelled as convention, not edge",
      all("not a measured edge" in x["text"] for x in cold), texts(cold))


print("\n--- too little data is said, not guessed around ---")

bars("THIN", [50.0 + i for i in range(12)])
b = E.justify("THIN")
check("a short series produces one honest bullet", len(b) == 1, str(len(b)))
check("it names the bar count", "12 stored" in b[0]["text"], b[0]["text"])
check("and says it is too few to observe trend or momentum",
      "too few" in b[0]["text"], b[0]["text"])
check("and tells master to sync", "Sync" in b[0]["text"])
b = E.justify("NOTHINGSTORED")
check("an unsynced symbol produces a bullet rather than an empty list", len(b) == 1)
check("and reports zero bars", "0 stored" in b[0]["text"], b[0]["text"])


# ── The gate comes first ─────────────────────────────────────────────────────
print("\n--- THE GATE VERDICT PRECEDES THE PROBABILITY IT QUALIFIES ---")

pred = {"horizons": {"swing": {"probability": 0.62, "conviction": 0.24, "bars": 5,
                               "interval": "1d", "asOf": "2026-08-28"}},
        "agreement": {"state": "aligned-long", "note": "both point the same way"}}
b = E.justify("TRENDUP", prediction=pred)
gate_idx = next((i for i, x in enumerate(b) if x["basis"] == E.GATE), None)
fc_idx = next((i for i, x in enumerate(b) if x["basis"] == E.FORECAST), None)
check("a gate bullet is emitted", gate_idx is not None, str([x["basis"] for x in b[:4]]))
check("a forecast bullet is emitted", fc_idx is not None)
check("THE GATE BULLET COMES BEFORE THE FORECAST", gate_idx < fc_idx,
      f"gate at {gate_idx}, forecast at {fc_idx}")
gate = b[gate_idx]
check("it says the model has NOT cleared the gate", "NOT cleared the gate" in gate["text"],
      gate["text"])
check("it gives the recorded reason", "never been trained" in gate["text"], gate["text"])
check("it tells master to treat the number as unproven",
      "unproven" in gate["text"], gate["text"])
check("AND that the measured bullets are not support for it",
      "rather than support for it" in gate["text"], gate["text"])
check("its evidence class is MODEL", gate["evidence"] == "MODEL")
check("the probability is still reported honestly",
      any("0.6200" in x["text"] for x in b), texts(b)[:200])
check("the cross-horizon state is reported",
      any("aligned-long" in x["text"] for x in b))

ent = {"swing": {"entitled": True, "reason": "cleared the gate: random_forest",
                 "acceptedModels": ["random_forest"]}}
b = E.justify("TRENDUP", prediction=pred, entitlements=ent)
g = next(x for x in b if x["basis"] == E.GATE)
check("an entitled model says it CLEARED the gate", "cleared the gate" in g["text"]
      and "NOT cleared" not in g["text"], g["text"])
check("and names the held-out measurement", "never saw" in g["text"], g["text"])

errp = {"horizons": {"swing": {"probability": None, "error": "need at least 120 bars"}}}
b = E.justify("TRENDUP", prediction=errp)
check("a failed horizon is reported as unanswerable",
      any("could not be answered" in x["text"] for x in b), texts(b)[:200])
check("and no forecast bullet is invented",
      not any(x["basis"] == E.FORECAST and "P(up" in x["text"] for x in b))
check("no prediction at all yields no gate or forecast bullets",
      not any(x["basis"] in (E.GATE, E.FORECAST) for x in E.justify("TRENDUP")))


# ── Correlation is measured, not assumed ─────────────────────────────────────
print("\n--- correlation from bars, with no sector table ---")

base = [1000.0 + i * 3 for i in range(200)]
bars("PAIRA", base)
bars("PAIRB", [x * 2.0 for x in base])

# ANTI-CORRELATION HAS TO BE BUILT ON RETURNS, NOT ON PRICES. Two monotonic price series -- one
# rising, one falling -- have monotonically DECREASING return series (3/1003, 3/1006, ... and
# -3/2997, -3/2994, ...), so their returns correlate near +1. Mirroring the step sequence is
# what actually produces r = -1.
_steps = [(0.012 if i % 3 == 0 else -0.008) for i in range(200)]
_up, _dn = [1000.0], [1000.0]
for _s in _steps:
    _up.append(_up[-1] * (1 + _s))
    _dn.append(_dn[-1] * (1 - _s))
bars("WOBBLEUP", _up)
bars("OPPOS", _dn)
bars("MONODOWN", [3000.0 - i * 3 for i in range(200)])

c = E.correlations(["PAIRA", "PAIRB"])
check("a pair is measured", len(c["pairs"]) == 1, str(c))
check("two identically-shaped series correlate near +1",
      c["pairs"][0]["correlation"] > 0.95, str(c["pairs"][0]))
check("the overlapping session count is reported",
      c["pairs"][0]["overlappingSessions"] > 100, str(c["pairs"][0]))
check("the lookback is reported", c["lookback"] == E.CORRELATION_LOOKBACK)

c = E.correlations(["WOBBLEUP", "OPPOS"])
check("a mirrored return series correlates near -1", c["pairs"][0]["correlation"] < -0.95,
      str(c["pairs"][0]))
c2 = E.correlations(["PAIRA", "MONODOWN"])
check("TWO MONOTONIC PRICE SERIES IN OPPOSITE DIRECTIONS STILL CORRELATE POSITIVELY on "
      "returns — the measure is co-movement of returns, not price direction",
      c2["pairs"][0]["correlation"] > 0.9, str(c2["pairs"][0]))

c = E.correlations(["PAIRA", "THIN"])
check("a symbol with too few bars is reported as insufficient",
      any(i["symbol"] == "THIN" for i in c["insufficient"]), str(c["insufficient"]))
check("and NOT silently dropped from the answer", len(c["insufficient"]) >= 1)
check("insufficient entries state what was needed",
      all("need" in i for i in c["insufficient"]))
check("a single symbol produces no pairs", E.correlations(["PAIRA"])["pairs"] == [])
check("an empty list is survivable", E.correlations([])["pairs"] == [])

w = E._correlation_warnings(["PAIRA", "PAIRB"], "NSE")
a = one(w, "CORRELATED_POSITIONS")
check("a high correlation becomes a warning", a is not None, str(kinds(w)))
check("it says the number was measured, not inferred from a sector",
      a and "not inferred from a sector label" in a["detail"], str(a and a["detail"]))
check("and explains the diversification is smaller than the position count",
      a and "diversification is smaller" in a["detail"])
check("it reports the overlapping session count", a and "overlapping sessions" in a["detail"])
w = E._correlation_warnings(["WOBBLEUP", "OPPOS"], "NSE")
check("an inverse pair is described as offsetting, not as diversification",
      "offset" in one(w, "CORRELATED_POSITIONS")["detail"],
      str(one(w, "CORRELATED_POSITIONS")["detail"]))
check("and its headline says they move inversely",
      "inversely" in one(w, "CORRELATED_POSITIONS")["headline"],
      str(one(w, "CORRELATED_POSITIONS")["headline"]))
check("a single symbol raises no correlation warning",
      E._correlation_warnings(["PAIRA"], "NSE") == [])


# ── Absence is reported ───────────────────────────────────────────────────────
print("\n--- A CHECK THAT COULD NOT RUN IS NOT A CLEAN BILL OF HEALTH ---")

w = E.warnings_for("TRENDUP")
d = one(w, "DERIVATIVES_ABSENT")
check("with no derivative data, absence is reported", d is not None, str(kinds(w)))
check("it is marked checked: false", d and d["checked"] is False)
check("it names every check that did not run",
      d and all(k in d["detail"] for k in ("pinning", "PCR", "straddle", "basis", "rollover")),
      str(d and d["detail"]))
check("AND SAYS AN EMPTY LIST IS NOT 'CLEAR'",
      d and "not 'clear'" in d["detail"], str(d and d["detail"]))

live = one(w, "LIVE_CHECKS_SKIPPED")
check("live checks are off by default and reported as skipped", live is not None)
check("marked checked: false", live and live["checked"] is False)
check("naming delivery and event risk",
      live and "Delivery" in live["headline"] and "event risk" in live["headline"],
      str(live and live["headline"]))

thin = E.warnings_for("THIN")
lu = one(thin, "LIQUIDITY_UNCHECKED")
check("too few bars means liquidity is reported unchecked", lu is not None, str(kinds(thin)))
check("marked checked: false", lu and lu["checked"] is False)
check("stating how many bars were needed", lu and "at least" in lu["detail"])

check("every warning carries a kind, severity and checked flag",
      all(x["kind"] and x["severity"] in ("critical", "warning", "info")
          and isinstance(x["checked"], bool) for x in w))
check("every warning carries an evidence class",
      all(x["evidence"] in ("DECLARED", "MEASURED", "MODEL") for x in w),
      str({x["evidence"] for x in w}))


print("\n--- illiquidity and gap risk, measured ---")

quiet = [100000] * 80 + [20000] * 20
bars("QUIET", [500.0 + i * 0.5 for i in range(100)], volumes=quiet)
w = E.warnings_for("QUIET")
il = one(w, "ILLIQUID")
check("collapsing volume raises ILLIQUID", il is not None, str(kinds(w)))
check("it says fills get worse on the way out",
      il and "worse fills" in il["detail"], str(il and il["detail"]))
check("it reports the ratio", il and il["value"] is not None and il["value"] < 1.0,
      str(il and il["value"]))
bars("STEADY", [500.0 + i * 0.5 for i in range(100)], volumes=[100000] * 100)
check("steady volume raises no illiquidity warning",
      one(E.warnings_for("STEADY"), "ILLIQUID") is None)

closes = [1000.0 + i for i in range(80)]
gappy = [c * 1.04 for c in closes]      # every open 4% away from the prior close
bars("GAPPY", closes, opens=gappy)
w = E.warnings_for("GAPPY")
g = one(w, "GAP_RISK")
check("frequent gaps raise GAP_RISK", g is not None, str(kinds(w)))
check("THE DETAIL SAYS A STOP DOES NOT PROTECT AGAINST A GAP",
      g and "does not protect against a gap" in g["detail"], str(g and g["detail"]))
check("and names position size as the real limit",
      g and "Position size" in g["detail"])
check("a smooth series raises no gap warning",
      one(E.warnings_for("STEADY"), "GAP_RISK") is None)


print("\n--- confidence collapse comes from the model's own words ---")

w = E._confidence_warnings({"horizons": {"swing": {"suppressed": True, "probability": 0.5}}})
a = one(w, "CONFIDENCE_COLLAPSE")
check("a suppressed reading raises CONFIDENCE_COLLAPSE", a is not None, str(kinds(w)))
check("its evidence class is MODEL", a and a["evidence"] == "MODEL")
check("it says to treat the number as ABSENT, not neutral",
      a and "absent rather than as neutral" in a["detail"], str(a and a["detail"]))
w = E._confidence_warnings({"horizons": {"swing": {"uncertainty": 0.82, "probability": 0.55}}})
check("high uncertainty raises it too", one(w, "CONFIDENCE_COLLAPSE") is not None)
check("explaining the members disagree",
      "disagree with each other" in one(w, "CONFIDENCE_COLLAPSE")["detail"])
w = E._confidence_warnings({"horizons": {"swing": {"uncertainty": 0.1, "probability": 0.55}}})
check("low uncertainty raises nothing", w == [])
check("no prediction raises nothing", E._confidence_warnings(None) == [])


# ── The brief ─────────────────────────────────────────────────────────────────
print("\n--- brief(): the one call a UI needs ---")

r = E.brief("TRENDUP", include_prediction=False)
check("it returns bullets", len(r["bullets"]) > 5, str(r["counts"]))
check("and warnings", len(r["warnings"]) >= 2, str(kinds(r["warnings"])))
check("it counts observations and conventions separately",
      r["counts"]["observations"] > 0 and "conventions" in r["counts"], str(r["counts"]))
check("it reports how many checks could not run", r["counts"]["unchecked"] > 0,
      str(r["counts"]))
check("and names them", len(r["uncheckedWarnings"]) > 0, str(r["uncheckedWarnings"]))
check("no horizon is entitled on an untrained install", r["entitledHorizons"] == [])
check("entitlements are reported for all three horizons",
      set(r["entitlements"]) == {"intraday", "swing", "positional"},
      str(list(r["entitlements"])))

check("THE CAVEAT IS PART OF THE PAYLOAD, not left to the UI", bool(r["caveat"]))
check("it says no model has cleared the gate",
      "cleared the gate" in r["caveat"], r["caveat"])
check("AND that the measured bullets are not evidence the probability is right",
      "not evidence that any" in r["caveat"], r["caveat"])
check("it is timestamped", bool(r["generatedAt"]))
check("the symbol is echoed uppercase", E.brief("trendup", include_prediction=False)[
    "symbol"] == "TRENDUP")

check("a symbol with nothing stored still returns a usable brief",
      len(E.brief("GHOSTSYM", include_prediction=False)["bullets"]) >= 1)
check("and still carries the caveat",
      bool(E.brief("GHOSTSYM", include_prediction=False)["caveat"]))

check("no bullet in a full brief asserts a direction from an observation",
      not any(("therefore" in b["text"].lower() or "expect a pullback" in b["text"].lower())
              for b in r["bullets"]), texts(r["bullets"])[:300])


print(f"\n{'=' * 62}")
print(f"  {PASS} passed, {FAIL} failed")
print(f"{'=' * 62}")
sys.exit(1 if FAIL else 0)
