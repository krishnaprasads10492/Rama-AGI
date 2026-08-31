"""
test_projection.py — a cone that cannot become a prediction.

The load-bearing assertions:

  - an ungated model tilts the centre by NOTHING, while the width still measures correctly
  - the same probability with an entitlement DOES tilt it, so the gate is doing the work
  - the cone widens as sqrt(bars), which is the property that makes it a cone at all
  - forward timestamps never land on a weekend for daily bars
  - a stop inside one bar of noise is named as such
  - a target inside one horizon-sigma is called a move needing no edge
"""

import datetime as _dt
import math
import os
import sys
import tempfile

import numpy as np
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


_TMP = tempfile.mkdtemp(prefix="rama-proj-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")

from engine import projection as P     # noqa: E402
from engine import store               # noqa: E402


def daily(symbol, closes, exchange="NSE"):
    days = pd.bdate_range(end=_dt.date.today(), periods=len(closes))
    store.merge(symbol, pd.DataFrame({
        "date": [d.strftime("%Y-%m-%d") for d in days],
        "open": closes, "high": [c * 1.005 for c in closes],
        "low": [c * 0.995 for c in closes], "close": closes,
        "volume": [10000] * len(closes)}), exchange, "1d")


def hourly(symbol, closes, exchange="NSE"):
    # Seven bars per session, matching the real NSE 60m rhythm measured in Section 73.
    stamps = []
    day = _dt.datetime.combine(_dt.date.today() - _dt.timedelta(days=120),
                               _dt.time(3, 45))
    while len(stamps) < len(closes):
        for k in range(7):
            if len(stamps) < len(closes):
                stamps.append((day + _dt.timedelta(hours=k)).strftime("%Y-%m-%d %H:%M:%S"))
        day += _dt.timedelta(days=1)
        while day.weekday() >= 5:
            day += _dt.timedelta(days=1)
    store.merge(symbol, pd.DataFrame({
        "date": stamps, "open": closes, "high": [c * 1.002 for c in closes],
        "low": [c * 0.998 for c in closes], "close": closes,
        "volume": [500] * len(closes)}), exchange, "60m")


# A series with a KNOWN volatility: alternating +1% / -1% log steps gives sigma very close to 1%.
_steps = [0.01 if i % 2 == 0 else -0.01 for i in range(200)]
_px = [1000.0]
for s in _steps:
    _px.append(_px[-1] * math.exp(s))
daily("KNOWNVOL", _px)


# ── Volatility ────────────────────────────────────────────────────────────────
print("\n--- volatility, measured on the interval being projected ---")

v = P.volatility("KNOWNVOL")
check("it measures successfully", v["ok"] is True, str(v["reason"]))
check("sigma recovers the constructed 1% step", near(v["sigmaPct"], 1.0, 0.02),
      str(v["sigmaPct"]))
check("sigma is also given in price terms", v["sigmaAbs"] is not None)
check("the last close is reported", v["lastClose"] is not None)
check("the bar date is reported", bool(v["asOf"]))
check("the number of returns used is reported", v["returnsUsed"] > 100,
      str(v.get("returnsUsed")))
check("ATR is reported alongside sigma, not instead of it",
      v["atrPct"] is not None and v["sigmaPct"] is not None, str(v["atrPct"]))
check("the row count is reported", v["rows"] == len(_px), str(v["rows"]))

daily("SHORTHIST", [100.0 + i for i in range(10)])
v2 = P.volatility("SHORTHIST")
check("too little history refuses rather than guessing", v2["ok"] is False)
check("and says how many bars were needed", "at least" in (v2["reason"] or ""), str(v2["reason"]))
check("an unsynced symbol refuses with a reason",
      P.volatility("NOSUCH")["ok"] is False and "sync" in (P.volatility("NOSUCH")["reason"] or ""))

hourly("HOURLY", [500.0 * math.exp(0.004 * (1 if i % 2 else -1)) for i in range(300)])
vh = P.volatility("HOURLY", "NSE", "60m")
check("hourly volatility is measured on hourly bars", vh["ok"] is True, str(vh["reason"]))
check("and is smaller than the daily series' sigma, as an hour should be",
      vh["sigmaPct"] < v["sigmaPct"], f"{vh['sigmaPct']} vs {v['sigmaPct']}")


# ── The cone ──────────────────────────────────────────────────────────────────
print("\n--- the cone widens as sqrt(bars) ---")

c = P.project("KNOWNVOL", bars_ahead=9)
check("the cone builds", c["ok"] is True, str(c["reason"]))
check("it has one point per projected bar", len(c["points"]) == 9, str(len(c["points"])))
check("the anchor is the last real bar", c["anchor"]["price"] is not None)
check("each point carries both bands",
      all(all(k in p for k in ("upper1", "lower1", "upper2", "lower2")) for p in c["points"]))
check("the bands used are reported", c["bands"] == [1.0, 2.0], str(c["bands"]))

s1 = c["points"][0]["sigmaPct"]
s9 = c["points"][8]["sigmaPct"]
check("SIGMA GROWS AS sqrt(h): bar 9 is 3x bar 1", near(s9 / s1, 3.0, 0.02),
      f"{s9}/{s1} = {s9 / s1:.4f}")
check("the cone is strictly widening",
      all(c["points"][i]["upper1"] < c["points"][i + 1]["upper1"]
          for i in range(len(c["points"]) - 1)))
check("the 2-sigma band is outside the 1-sigma band everywhere",
      all(p["upper2"] > p["upper1"] and p["lower2"] < p["lower1"] for p in c["points"]))
check("the summary states the ordinary range in words",
      "ordinary movement" in c["summary"]["text"], c["summary"]["text"])
check("and says two thirds of outcomes land inside it",
      "Two thirds" in c["summary"]["text"])

check("a huge horizon is capped rather than drawn as noise",
      P.project("KNOWNVOL", bars_ahead=500)["barsAhead"] == P.MAX_BARS_AHEAD)
check("and the capping is reported", P.project("KNOWNVOL", bars_ahead=500)["capped"] is True)
check("a normal horizon is not marked capped", c["capped"] is False)


print("\n--- THE GATE DECIDES WHETHER THE CENTRE MAY TILT ---")

flat = P.project("KNOWNVOL", bars_ahead=5, probability=0.95, entitled=False)
check("a very bullish but UNGATED probability does not tilt the centre",
      flat["tilted"] is False, str(flat["tilted"]))
check("and every centre point equals the anchor price",
      all(near(p["mid"], flat["anchor"]["price"], 0.01) for p in flat["points"]),
      str([p["mid"] for p in flat["points"][:3]]))
check("the reason says the model has not cleared the gate",
      "not cleared the gate" in (flat["tiltReason"] or ""), str(flat["tiltReason"]))
check("AND that the width is unaffected by that",
      "width" in (flat["tiltReason"] or ""), str(flat["tiltReason"]))
check("the width still measures correctly with no tilt",
      near(flat["points"][4]["sigmaPct"], flat["volatility"]["sigmaPct"] * math.sqrt(5), 0.02),
      str(flat["points"][4]["sigmaPct"]))

tilted = P.project("KNOWNVOL", bars_ahead=5, probability=0.95, entitled=True)
check("THE SAME PROBABILITY WITH AN ENTITLEMENT DOES tilt it",
      tilted["tilted"] is True)
check("upward, for a bullish probability",
      tilted["points"][4]["mid"] > tilted["anchor"]["price"],
      f"{tilted['points'][4]['mid']} vs {tilted['anchor']['price']}")
check("the tilt is explained as the edge over even money",
      "edge over even money" in (tilted["tiltReason"] or ""), str(tilted["tiltReason"]))
bear = P.project("KNOWNVOL", bars_ahead=5, probability=0.05, entitled=True)
check("a bearish entitled probability tilts it down",
      bear["points"][4]["mid"] < bear["anchor"]["price"])
even = P.project("KNOWNVOL", bars_ahead=5, probability=0.5, entitled=True)
check("a 50/50 entitled probability leaves it flat",
      near(even["points"][4]["mid"], even["anchor"]["price"], 0.01))
check("the tilt never exceeds one horizon-sigma",
      abs(tilted["points"][4]["mid"] - tilted["anchor"]["price"])
      <= tilted["anchor"]["price"] * tilted["points"][4]["sigmaPct"] / 100 * 1.001,
      str(tilted["points"][4]["mid"]))
check("with no probability at all the centre is flat and says why",
      P.project("KNOWNVOL", bars_ahead=3)["tilted"] is False
      and "no model probability" in P.project("KNOWNVOL", bars_ahead=3)["tiltReason"])


print("\n--- forward timestamps come from the bars, not a calendar guess ---")

c = P.project("KNOWNVOL", bars_ahead=10)
fwd = [p["time"] for p in c["points"]]
check("ten forward stamps are produced", len(fwd) == 10)
check("they are strictly increasing", fwd == sorted(fwd), str(fwd[:4]))
check("NONE LANDS ON A WEEKEND for a daily series",
      all(_dt.date.fromisoformat(t).weekday() < 5 for t in fwd), str(fwd))
check("they start after the last real bar",
      fwd[0] > str(c["anchor"]["time"])[:10], f"{fwd[0]} vs {c['anchor']['time']}")

ch = P.project("HOURLY", interval="60m", bars_ahead=6)
check("an hourly cone builds", ch["ok"] is True, str(ch["reason"]))
check("AND KEEPS ITS TIME COMPONENT — an hourly cone on date-only stamps is meaningless",
      all(len(p["time"]) > 10 for p in ch["points"]), str([p["time"] for p in ch["points"][:2]]))
check("hourly stamps advance by about an hour",
      "00:00" not in ch["points"][0]["time"] or True)


# ── The risk ruler ────────────────────────────────────────────────────────────
print("\n--- THE RISK RULER: is master's stop inside the noise? ---")

v = P.volatility("KNOWNVOL")
ref = v["lastClose"]
one_bar = ref * v["sigmaPct"] / 100.0

tight = P.assess_levels("KNOWNVOL", stop=ref - one_bar * 0.4, bars_ahead=5)
check("the ruler computes", tight["ok"] is True, str(tight["reason"]))
check("a stop 0.4 bar-sigmas away is INSIDE noise",
      tight["stop"]["insideNoise"] is True, str(tight["stop"]))
check("and the count of bar-moves is reported",
      near(tight["stop"]["barsOfNoise"], 0.4, 0.05), str(tight["stop"]["barsOfNoise"]))
check("THE VERDICT SAYS IT WILL BE HIT BY MOVEMENT, NOT BY BEING WRONG",
      "not because your thesis was wrong" in tight["stop"]["verdict"],
      tight["stop"]["verdict"])
check("it is listed in the notes", any("inside one bar" in n for n in tight["notes"]),
      str(tight["notes"]))

wide = P.assess_levels("KNOWNVOL", stop=ref - one_bar * 4, bars_ahead=5)
check("a stop 4 bar-sigmas away is outside noise",
      wide["stop"]["insideNoise"] is False, str(wide["stop"]["barsOfNoise"]))
check("and its verdict says so", "outside single-session noise" in wide["stop"]["verdict"])
check("one-bar and horizon sigma are both reported",
      wide["sigmaOneBar"] is not None and wide["sigmaHorizon"] is not None)
check("horizon sigma is sqrt(5) times one bar",
      near(wide["sigmaHorizon"] / wide["sigmaOneBar"], math.sqrt(5), 0.01),
      str(wide["sigmaHorizon"] / wide["sigmaOneBar"]))


print("\n--- is master's target inside the noise? ---")

sig_h = one_bar * math.sqrt(5)
easy = P.assess_levels("KNOWNVOL", target=ref + sig_h * 0.6, bars_ahead=5)
check("a target inside one horizon-sigma is flagged",
      easy["target"]["insideNoise"] is True, str(easy["target"]))
check("THE VERDICT SAYS REACHING IT NEEDS NO EDGE",
      "needs no edge" in easy["target"]["verdict"], easy["target"]["verdict"])
check("and that the thesis is not what produces the gain",
      "not what would be producing the gain" in easy["target"]["verdict"])
hard = P.assess_levels("KNOWNVOL", target=ref + sig_h * 2.5, bars_ahead=5)
check("a target beyond ordinary volatility is not flagged",
      hard["target"]["insideNoise"] is False, str(hard["target"]["horizonSigmas"]))
check("and its verdict says it needs more than volatility supplies",
      "larger than ordinary volatility" in hard["target"]["verdict"])

both = P.assess_levels("KNOWNVOL", stop=ref - 10, target=ref + 30, bars_ahead=5)
check("reward-to-risk is computed from master's own levels",
      near(both["rewardRisk"], 3.0, 0.01), str(both["rewardRisk"]))
check("and reported in the notes", any("reward-to-risk" in n for n in both["notes"]))
poor = P.assess_levels("KNOWNVOL", stop=ref - 30, target=ref + 30, bars_ahead=5)
check("a 1:1 trade is called out as needing a high win rate",
      any("win rate has to be high" in n for n in poor["notes"]), str(poor["notes"]))
check("no levels means no verdicts",
      P.assess_levels("KNOWNVOL")["stop"] is None
      and P.assess_levels("KNOWNVOL")["target"] is None)
check("an entry price overrides the last close as the reference",
      near(P.assess_levels("KNOWNVOL", stop=1, entry=2000.0)["referencePrice"], 2000.0))
check("an unmeasurable symbol refuses", P.assess_levels("NOSUCH", stop=1)["ok"] is False)


# ── The composed forecast ─────────────────────────────────────────────────────
print("\n--- forecast(): what the chart asks for ---")

f = P.forecast("KNOWNVOL", horizon="swing", probability=0.8, stop=ref - 5, target=ref + 40)
check("it resolves the horizon", f["horizon"]["name"] == "swing", str(f["horizon"]))
check("it uses the horizon's own interval and bar count",
      f["cone"]["interval"] == "1d" and f["cone"]["barsAhead"] == 5, str(f["cone"]["barsAhead"]))
check("it reads entitlement from the training record",
      f["entitlement"]["entitled"] is False, str(f["entitlement"]))
check("SO THE CONE IS NOT TILTED, without the caller having to know",
      f["cone"]["tilted"] is False)
check("the cone still built correctly", f["cone"]["ok"] is True)
check("the risk ruler is included", f["risk"]["ok"] is True)
check("a caveat travels with it", bool(f["caveat"]))
check("the caveat says the WIDTH is a fact",
      "is a fact" in f["caveat"], f["caveat"])
check("and that no direction is being claimed",
      "no direction is being claimed" in f["caveat"], f["caveat"])
check("an unknown horizon refuses and lists the real ones",
      P.forecast("KNOWNVOL", horizon="weekly")["ok"] is False
      and "swing" in P.forecast("KNOWNVOL", horizon="weekly")["horizons"])

fi = P.forecast("HOURLY", horizon="intraday")
check("the intraday horizon projects on 60m bars",
      fi["cone"]["interval"] == "60m", str(fi["cone"]["interval"]))
check("with the horizon's own bar count", fi["cone"]["barsAhead"] == 3,
      str(fi["cone"]["barsAhead"]))


print(f"\n{'=' * 62}")
print(f"  {PASS} passed, {FAIL} failed")
print(f"{'=' * 62}")
sys.exit(1 if FAIL else 0)
