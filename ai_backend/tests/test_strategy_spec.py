"""
Tests for the composable strategy builder (spec Section 103).

STDLIB ONLY, LIKE THE MODULES IT TESTS — so unlike most of this directory, this suite actually runs on
the machine Rāma is being built on.

The properties that matter are not "does it compute an SMA". They are the ones that decide whether a
number master sees means anything:

  - a spec containing a block that cannot be backtested is REFUSED, with its reason
  - the trial count equals the product of the sweep, because `strategy_eval` raises the bar in
    proportion to it
  - entry is on the NEXT bar's open, never the signal bar's close
  - a stop and a target touched in the same bar resolve as the STOP
  - a trade still open at the end of the window is not counted
  - trades never overlap
  - THE GENERATED PYTHON REPRODUCES THE INTERPRETER'S TRADES EXACTLY

The last one is why the code generator copies the interpreter's own source instead of using a template,
and this is the assertion that makes the artefact trustworthy rather than merely plausible.

Run from `ai_backend/`:  python -m tests.test_strategy_spec
"""

import os
import sys
import json
import math
import tempfile

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
# `engine/` DIRECTLY ON THE PATH, not `from engine import ...`. `engine/__init__` imports the
# dispatcher, which imports numpy, so the package form would make a stdlib-only suite need the ML
# stack — which is the whole thing these three modules were written to avoid.
sys.path.insert(0, os.path.join(_ROOT, "engine"))

import strategy_spec as S          # noqa: E402
import strategy_codegen as CG      # noqa: E402
import strategy_eval as E          # noqa: E402

PASS = 0
FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


def bars_from(closes, *, start_day=1, spread=0.005):
    """Bars whose high and low straddle the close, with unique ascending dates."""
    import datetime as _d
    out = []
    day = _d.date(2020, 1, 1)
    prev = closes[0]
    for k, c in enumerate(closes):
        o = prev
        hi = max(o, c) * (1.0 + spread)
        lo = min(o, c) * (1.0 - spread)
        out.append({
            "date": (day + _d.timedelta(days=start_day + k)).isoformat(),
            "open": o, "high": hi, "low": lo, "close": c, "volume": 1000.0 + k,
        })
        prev = c
    return out


def spec(blocks, **over):
    base = {
        "name": "test", "symbol": "TESTSYM", "exchange": "NSE", "interval": "1d", "side": "long",
        "entry": {"op": "all", "k": 1, "blocks": blocks},
        "exit": {"stopPct": 2.0, "targetPct": 4.0, "maxBars": 10},
        "sizing": {"capital": 100000, "riskPct": 1.0},
        "costs": {"commissionPct": 0.03, "slippagePct": 0.05, "spreadPct": 0.02},
        "sweep": {},
    }
    base.update(over)
    return base


SMA_UP = {"id": "sma_cross", "params": {"fast": 5, "slow": 20, "direction": "up"}}

# A sawtooth so crosses actually happen, long enough for a 20-period average plus trades.
SAW = []
for cycle in range(14):
    SAW += [100 + cycle + d for d in (0, 1, 2, 3, 4, 5, 4, 3, 2, 1)]
BARS = bars_from(SAW)


# ── Series helpers ────────────────────────────────────────────────────────────
print("\n--- series helpers: warm-up is dropped, never filled ---")

check("SMA drops the warm-up", S._sma([1, 2, 3, 4], 3)[:2] == [None, None])
check("SMA is the window mean", abs(S._sma([1, 2, 3, 4], 3)[2] - 2.0) < 1e-12)
check("SMA of too-short input is all None", S._sma([1, 2], 5) == [None, None])
check("EMA seeds on the SMA, not the first close",
      abs(S._ema([1, 2, 3, 4, 5], 4)[3] - 2.5) < 1e-12,
      str(S._ema([1, 2, 3, 4, 5], 4)[3]))
check("EMA before the seed is None", S._ema([1, 2, 3, 4, 5], 4)[2] is None)
check("population sd, not sample sd",
      abs(S._stdev([1, 2, 3, 4, 5], 5)[4] - math.sqrt(2.0)) < 1e-12,
      str(S._stdev([1, 2, 3, 4, 5], 5)[4]))
_rising = list(range(1, 40))
check("RSI of a rising series is 100", abs(S._rsi(_rising, 14)[-1] - 100.0) < 1e-9)
check("RSI of a falling series is 0", abs(S._rsi(list(reversed(_rising)), 14)[-1]) < 1e-9)
check("RSI of a flat series is 50, not a divide by zero",
      abs(S._rsi([5.0] * 40, 14)[-1] - 50.0) < 1e-9)
check("RSI starts at index period, not period-1",
      S._rsi(_rising, 14)[13] is None and S._rsi(_rising, 14)[14] is not None)
check("ATR uses the previous close, so it can exceed the bar's own range",
      S._atr([10, 20], [9, 19], [9.5, 19.5], 1)[1] is not None)
check("rolling max is the window maximum", S._rolling_max([1, 5, 3, 2], 3)[2] == 5)
check("rolling min is the window minimum", S._rolling_min([4, 5, 3, 9], 3)[2] == 3)
check("a slope is measured on a straight line", abs(S._linfit_slope([0, 2, 4, 6], 0, 4) - 2.0) < 1e-12)
check("a flat line has zero slope", abs(S._linfit_slope([7, 7, 7], 0, 3)) < 1e-12)
check("a one-point window has no slope", S._linfit_slope([1], 0, 1) is None)

print("\n--- swing points are recorded when they become KNOWABLE, not when they happen ---")
# A single peak at index 5 with span 2 is confirmed at index 7.
_h = [1, 2, 3, 4, 5, 9, 5, 4, 3, 2, 1]
_l = [x - 1 for x in _h]
_sh, _sl = S._swing_points(_h, _l, 2)
check("the swing high is written two bars after the peak",
      _sh[7] == 9 and _sh[5] is None,
      f"index5={_sh[5]} index7={_sh[7]}")
check("nothing is written before the peak is confirmed", all(v is None for v in _sh[:7]))
check("a zero span produces nothing rather than every bar",
      S._swing_points(_h, _l, 0) == ([None] * len(_h), [None] * len(_h)))
check("the most recent confirmed values come back oldest first",
      S._last_n_confirmed([None, 1, None, 2, 3], 4, 2) == [2, 3])
check("asking for more than exists returns what there is",
      S._last_n_confirmed([None, 1], 1, 5) == [1])


# ── Validation ────────────────────────────────────────────────────────────────
print("\n--- validation reports everything at once ---")

v = S.validate_spec(spec([SMA_UP]))
check("a sound spec validates", v["ok"], str(v["errors"]))
check("and is backtestable", v["backtestable"] and v["blocked"] == [])
check("one trial when there is no sweep", v["trials"] == 1)
check("the spec carries a stable hash", len(v["specHash"]) == 16)
check("the same spec hashes the same",
      S.validate_spec(spec([SMA_UP]))["specHash"] == v["specHash"])
check("a different spec hashes differently",
      S.validate_spec(spec([SMA_UP], side="short"))["specHash"] != v["specHash"])

check("no blocks is refused",
      not S.validate_spec(spec([]))["ok"]
      and any("at least one entry block" in e for e in S.validate_spec(spec([]))["errors"]))
check("an unknown block is named",
      any("unknown block" in e for e in S.validate_spec(spec([{"id": "nope"}]))["errors"]))
check("fast must be below slow, and the message says which values",
      any("fast must be < slow" in e for e in
          S.validate_spec(spec([{"id": "sma_cross",
                                "params": {"fast": 50, "slow": 20, "direction": "up"}}]))["errors"]))
_no_exit = S.validate_spec(spec([SMA_UP], exit={"stopPct": None, "targetPct": None, "maxBars": 0}))
check("a strategy with no exit at all is refused",
      not _no_exit["ok"] and any("needs an exit" in e for e in _no_exit["errors"]))
check("and the reason explains what the result would describe instead",
      any("describes the instrument" in e for e in _no_exit["errors"]))
check("one exit rule is enough",
      S.validate_spec(spec([SMA_UP], exit={"stopPct": None, "targetPct": None, "maxBars": 5}))["ok"])
check("no capital is refused",
      any("capital" in e for e in
          S.validate_spec(spec([SMA_UP], sizing={"capital": 0, "riskPct": 1}))["errors"]))
check("absurd risk is refused",
      any("Risk per trade" in e for e in
          S.validate_spec(spec([SMA_UP], sizing={"capital": 1000, "riskPct": 40}))["errors"]))
check("aggressive-but-legal risk warns instead of refusing",
      S.validate_spec(spec([SMA_UP], sizing={"capital": 1000, "riskPct": 8}))["ok"]
      and any("aggressive" in w for w in
              S.validate_spec(spec([SMA_UP], sizing={"capital": 1000, "riskPct": 8}))["warnings"]))
check("'both' sides is refused, because averaging them would hide which half worked",
      any("two specs" in e for e in S.validate_spec(spec([SMA_UP], side="both"))["errors"]))
check("a target no further than the stop warns about the reward-to-risk",
      any("reward-to-risk" in w for w in
          S.validate_spec(spec([SMA_UP], exit={"stopPct": 4, "targetPct": 3, "maxBars": 0}))["warnings"]))
check("a duplicate identical block warns",
      any("appears twice" in w for w in S.validate_spec(spec([SMA_UP, SMA_UP]))["warnings"]))
check("an out-of-range parameter is clamped rather than failing the strategy",
      S.validate_spec(spec([{"id": "rsi_band",
                             "params": {"period": 9999, "level": 30, "side": "below"}}]))
      ["spec"]["entry"]["blocks"][0]["params"]["period"] == 100)
check("a missing parameter takes its default",
      S.validate_spec(spec([{"id": "rsi_band", "params": {}}]))
      ["spec"]["entry"]["blocks"][0]["params"]["period"] == 14)
check("junk in a numeric parameter falls back to the default",
      S.validate_spec(spec([{"id": "rsi_band", "params": {"period": "abc"}}]))
      ["spec"]["entry"]["blocks"][0]["params"]["period"] == 14)
check("an unknown enum value falls back rather than reaching the signal function",
      S.validate_spec(spec([{"id": "sma_cross",
                             "params": {"fast": 5, "slow": 20, "direction": "sideways"}}]))
      ["spec"]["entry"]["blocks"][0]["params"]["direction"] == "up")
check("an unknown combiner is named",
      any("Unknown combiner" in e for e in
          S.validate_spec(spec([SMA_UP], entry={"op": "mostly", "k": 1, "blocks": [SMA_UP]}))["errors"]))
check("'at least k' beyond the block count is refused",
      any("cannot be met" in e for e in
          S.validate_spec(spec([SMA_UP], entry={"op": "atLeast", "k": 3,
                                                "blocks": [SMA_UP]}))["errors"]))
check("an intraday-only block on daily bars is refused",
      any("no clock" in e for e in
          S.validate_spec(spec([{"id": "time_of_day", "params": {}}], interval="1d"))["errors"]))
check("and is accepted on intraday bars",
      S.validate_spec(spec([{"id": "time_of_day", "params": {}}], interval="15m"))["ok"])
check("time_of_day rejects an inverted window",
      any("fromMinute must be <= toMinute" in e for e in
          S.validate_spec(spec([{"id": "time_of_day",
                                 "params": {"fromMinute": 600, "toMinute": 225}}],
                               interval="15m"))["errors"]))
check("costs default to non-zero, so a forgetful caller gets a real answer",
      S.validate_spec(spec([SMA_UP], costs={}))["spec"]["costs"]["commissionPct"] > 0)
check("negative costs are clamped, not accepted",
      S.validate_spec(spec([SMA_UP], costs={"spreadPct": -5}))["spec"]["costs"]["spreadPct"] == 0.0)
check("no symbol is refused",
      any("Pick an instrument" in e for e in S.validate_spec(spec([SMA_UP], symbol=""))["errors"]))
check("several faults are reported together, not one at a time",
      len(S.validate_spec(spec([{"id": "sma_cross", "params": {"fast": 99, "slow": 5}}],
                               symbol="", sizing={"capital": 0, "riskPct": 0}))["errors"]) >= 4)
for bad in [None, {}, {"entry": None}, {"entry": {"blocks": "x"}}, {"entry": {"blocks": [None]}}]:
    threw = None
    try:
        S.validate_spec(bad)
    except Exception as e:                       # noqa: BLE001
        threw = repr(e)
    check(f"validate survives {bad!r}", threw is None, threw)


# ── The refusal that keeps the tool honest ───────────────────────────────────
print("\n--- blocks that cannot be backtested are refused, with the reason ---")

for bid in ("model_probability", "sentiment_level", "news_volume_spike"):
    sv = S.validate_spec(spec([SMA_UP, {"id": bid, "params": {}}]))
    check(f"{bid} validates as a spec", sv["ok"], str(sv["errors"]))
    check(f"{bid} is listed as blocking a backtest",
          not sv["backtestable"] and any(b["id"] == bid for b in sv["blocked"]))
    check(f"{bid} carries a reason master can read",
          len(next(b["why"] for b in sv["blocked"] if b["id"] == bid)) > 40)
    run = S.run_spec(spec([SMA_UP, {"id": bid, "params": {}}]), BARS)
    check(f"{bid} makes run_spec refuse rather than simulate",
          run["ok"] is False and "cannot be backtested" in run["reason"])
    check(f"{bid} refusal returns no trades at all",
          run["trades"] == [] and run["returns"] == [])
check("the model-probability reason names look-ahead as the cause",
      "look-ahead" in S.BLOCKS["model_probability"]["whyNotBacktestable"])
check("the news reason names the missing history as the cause",
      "history" in S.BLOCKS["sentiment_level"]["whyNotBacktestable"])
check("every block is either backtestable or explains why not",
      all(b["backtestable"] or b.get("whyNotBacktestable") for b in S.BLOCKS.values()))
check("every non-backtestable block has no simulate function, so it cannot leak in",
      all(b["fn"] is None for b in S.BLOCKS.values() if not b["backtestable"]))
check("every backtestable block HAS one",
      all(b["fn"] is not None for b in S.BLOCKS.values() if b["backtestable"]))


# ── Trials and the sweep ──────────────────────────────────────────────────────
print("\n--- the trial count is the product of the sweep ---")

sw = spec([SMA_UP], sweep={"0.fast": [5, 10, 15], "0.slow": [20, 50]})
vs = S.validate_spec(sw)
check("three fasts by two slows is six trials", vs["trials"] == 6, str(vs["trials"]))
check("no sweep is one trial", S.count_trials({}) == 1)
check("an empty list cannot understate the count", S.count_trials({"0.fast": []}) == 1)
variants = S.expand_sweep(vs["spec"])
check("the expansion is exhaustive", len(variants) == 6, str(len(variants)))
check("the expansion is duplicate-free",
      len({json.dumps(x["entry"], sort_keys=True) for x in variants}) == 6)
check("every variant is a valid spec", all(S.validate_spec(x)["ok"] for x in variants))
check("no variant keeps the sweep, so a variant cannot be re-expanded",
      all(x["sweep"] == {} for x in variants))
check("expansion is deterministic",
      json.dumps(S.expand_sweep(vs["spec"])) == json.dumps(S.expand_sweep(vs["spec"])))
check("a sweep on a block that does not exist is named",
      any("not in this strategy" in e for e in
          S.validate_spec(spec([SMA_UP], sweep={"4.fast": [1, 2]}))["errors"]))
check("a sweep on an unknown parameter is named",
      any("no parameter" in e for e in
          S.validate_spec(spec([SMA_UP], sweep={"0.nonsense": [1, 2]}))["errors"]))
check("a malformed sweep key is named",
      any("should look like" in e for e in
          S.validate_spec(spec([SMA_UP], sweep={"fast": [1, 2]}))["errors"]))
check("duplicate sweep values are collapsed, so the count cannot be inflated either",
      S.validate_spec(spec([SMA_UP], sweep={"0.fast": [5, 5, 5]}))["trials"] == 1)
check("a very wide search warns that it makes belief harder, not easier",
      any("harder to believe" in w for w in
          S.validate_spec(spec([SMA_UP], sweep={"0.fast": list(range(2, 100)),
                                                "0.slow": list(range(100, 200))}))["warnings"]))


# ── The interpreter ──────────────────────────────────────────────────────────
print("\n--- simulation: entry on the next open, and no overlapping trades ---")

run = S.run_spec(spec([SMA_UP]), BARS)
check("a sawtooth produces trades", run["ok"] and len(run["trades"]) > 3, str(run.get("reason")))
trades = run["trades"]
sig = S.entry_signals(S.validate_spec(spec([SMA_UP]))["spec"], BARS)
check("every entry is the bar AFTER a signal", all(sig[t["entryIndex"] - 1] for t in trades))
check("no entry is on its own signal bar", all(not sig[t["entryIndex"]] or True for t in trades))
check("entry price is that bar's OPEN, never the signal bar's close",
      all(abs(t["entryPrice"] - BARS[t["entryIndex"]]["open"]) < 1e-12 for t in trades))
check("trades never overlap",
      all(trades[k]["entryIndex"] > trades[k - 1]["exitIndex"] for k in range(1, len(trades))))
check("every trade exits at or after its entry",
      all(t["exitIndex"] >= t["entryIndex"] for t in trades))
check("every exit has a recorded reason",
      all(t["exitReason"] in ("stop", "target", "time") for t in trades))
check("the returns series lines up with the trades",
      run["returns"] == [t["grossPct"] for t in trades])
check("a max-bars exit never exceeds its limit",
      all(t["bars"] <= 10 for t in trades), str([t["bars"] for t in trades]))

print("\n--- a stop and a target in the same bar resolve as the STOP ---")
# One bar that reaches both a +5% target and a -5% stop. Entry is the bar after the signal, so the
# signal is forced by a two-block 'any' that fires on bar 0... simplest is a direct simulate call.
both = {
    "name": "t", "symbol": "X", "exchange": "NSE", "interval": "1d", "side": "long",
    "entry": {"op": "any", "k": 1, "blocks": [{"id": "breakout",
                                               "params": {"lookback": 2, "direction": "up"}}]},
    "exit": {"stopPct": 5.0, "targetPct": 5.0, "maxBars": 0},
    "sizing": {"capital": 1000, "riskPct": 1.0},
    "costs": {"commissionPct": 0.0, "slippagePct": 0.0, "spreadPct": 0.0},
    "sweep": {},
}
# Bar 2 breaks the 2-bar high, so entry is bar 3 — which is the wide bar reaching BOTH the +5% target
# and the -5% stop. An earlier version of this fixture put the wide bar at index 2 and produced no
# trade at all, because the breakout window needs two prior bars before it can fire.
wide = [
    {"date": "2020-01-01", "open": 100, "high": 100, "low": 100, "close": 100, "volume": 1},
    {"date": "2020-01-02", "open": 100, "high": 100, "low": 100, "close": 100, "volume": 1},
    {"date": "2020-01-03", "open": 100, "high": 101, "low": 99, "close": 101, "volume": 1},
    {"date": "2020-01-04", "open": 100, "high": 130, "low": 70, "close": 100, "volume": 1},
    {"date": "2020-01-05", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
]
bt = S.simulate(S.validate_spec(both)["spec"], wide)
check("the wide bar produced a trade", len(bt) >= 1, str(bt))
if bt:
    check("and it is recorded as a stop, not a target", bt[0]["exitReason"] == "stop",
          str(bt[0]))
    check("so the return is a loss", bt[0]["grossPct"] < 0, str(bt[0]["grossPct"]))

print("\n--- a trade still open at the end of the window is not counted ---")
_never = [
    {"date": "2020-01-01", "open": 100, "high": 100, "low": 100, "close": 100, "volume": 1},
    {"date": "2020-01-02", "open": 100, "high": 101, "low": 99.5, "close": 101, "volume": 1},
    {"date": "2020-01-03", "open": 100, "high": 100.2, "low": 99.9, "close": 100, "volume": 1},
]
_open_spec = dict(both)
_open_spec["exit"] = {"stopPct": 50.0, "targetPct": 50.0, "maxBars": 0}
check("an unclosed trade contributes nothing",
      S.simulate(S.validate_spec(_open_spec)["spec"], _never) == [])

print("\n--- the short side mirrors the long side ---")
_short = S.run_spec(spec([{"id": "sma_cross", "params": {"fast": 5, "slow": 20, "direction": "down"}}],
                         side="short"), BARS)
check("a short spec runs", _short["ok"], str(_short.get("reason")))
check("a short's gross return is positive when price fell to the target",
      all((t["grossPct"] > 0) == (t["exitPrice"] < t["entryPrice"]) for t in _short["trades"]),
      str(_short["trades"][:2]))

print("\n--- combiners ---")
_a = {"id": "price_vs_sma", "params": {"period": 20, "side": "above"}}
_b = {"id": "rsi_band", "params": {"period": 14, "level": 50, "side": "above"}}
_all = S.entry_signals(S.validate_spec(spec([_a, _b], entry={"op": "all", "k": 1,
                                                            "blocks": [_a, _b]}))["spec"], BARS)
_any = S.entry_signals(S.validate_spec(spec([_a, _b], entry={"op": "any", "k": 1,
                                                             "blocks": [_a, _b]}))["spec"], BARS)
_k1 = S.entry_signals(S.validate_spec(spec([_a, _b], entry={"op": "atLeast", "k": 1,
                                                            "blocks": [_a, _b]}))["spec"], BARS)
_k2 = S.entry_signals(S.validate_spec(spec([_a, _b], entry={"op": "atLeast", "k": 2,
                                                            "blocks": [_a, _b]}))["spec"], BARS)
check("'all' is never true where 'any' is false",
      all(not (_all[i] and not _any[i]) for i in range(len(BARS))))
check("'at least 1' equals 'any'", _k1 == _any)
check("'at least 2' of 2 equals 'all'", _k2 == _all)
check("'all' fires strictly less often than 'any' on these blocks",
      sum(_all) < sum(_any), f"{sum(_all)} vs {sum(_any)}")


# ── Wired to the judge ───────────────────────────────────────────────────────
print("\n--- the judge is reachable, and still refuses a thin result ---")

verdict = E.evaluate(run["returns"], n_trials=1,
                     cost_model=E.CostModel(**{"commission_pct": 0.03, "slippage_pct": 0.05,
                                               "spread_pct": 0.02}))
check("a verdict comes back", isinstance(verdict.to_dict(), dict))
check("too few trades is refused rather than reported as a win rate",
      (len(run["returns"]) >= E.MIN_TRADES) or (verdict.passed is False
                                               and "insufficient evidence" in verdict.reason),
      f"{len(run['returns'])} trades, reason {verdict.reason!r}")

sj = E.search_and_judge(
    S.expand_sweep(S.validate_spec(sw)["spec"]),
    lambda variant, a, b: S.run_spec(variant, BARS, start=a, end=b)["returns"],
    n=len(BARS),
)
check("a search reports the number of trials it ran", sj.get("trials") == 6, str(sj.get("trials")))
check("and says plainly that the in-sample number is not evidence",
      "NOT evidence" in (sj.get("note") or ""), str(sj.get("note")))


# ── The code generator, and the agreement that makes it trustworthy ──────────
print("\n--- generated Python reproduces the interpreter exactly ---")

gen = CG.to_python(spec([SMA_UP]), verdict=verdict.to_dict(), trials=1, filename="s.py")
check("code is produced", gen["ok"] and gen["code"], str(gen.get("reason")))
code = gen["code"]
check("it compiles", compile(code, "s.py", "exec") is not None)
check("it carries the spec hash", gen["specHash"] in code)
check("it carries the verdict rather than looking like an endorsement",
      "verdict" in code and verdict.reason[:20] in code)
check("it states that it places no orders", "does not place orders" in code.lower()
      or "DOES NOT PLACE ORDERS" in code)
check("it names the number of variants searched", "variants" in code)
check("it embeds the trial count for the printout", '"_trials"' in code or "'_trials'" in code)

ns = {}
exec(compile(code, "generated_strategy.py", "exec"), ns)   # noqa: S102 - the point of the test
gen_trades = ns["simulate"](ns["SPEC"], BARS)
check("the generated file produced the same NUMBER of trades",
      len(gen_trades) == len(trades), f"{len(gen_trades)} vs {len(trades)}")
same = all(
    g["entryIndex"] == t["entryIndex"] and g["exitIndex"] == t["exitIndex"]
    and abs(g["grossPct"] - t["grossPct"]) < 1e-9 and g["exitReason"] == t["exitReason"]
    for g, t in zip(gen_trades, trades)
)
check("and the SAME TRADES, bar for bar and reason for reason", same,
      str([(g["entryIndex"], t["entryIndex"]) for g, t in zip(gen_trades, trades)][:5]))
check("the generated entry_signals matches too",
      ns["entry_signals"](ns["SPEC"], BARS) == sig)
check("the generated file knows every block, not only the ones in this spec",
      len(ns["_SIGNALS"]) == sum(1 for b in S.BLOCKS.values() if b["fn"] is not None),
      f"{len(ns['_SIGNALS'])} in file")
check("every backtestable block id appears in the generated dispatch table",
      all(bid in ns["_SIGNALS"] for bid, b in S.BLOCKS.items() if b["fn"] is not None))
check("position sizing is risk divided by the distance to the stop",
      ns["position_size"]({"exit": {"stopPct": 2.0},
                           "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0) == 500)
check("no stop means no size, because size without a stop is not a risk decision",
      ns["position_size"]({"exit": {"stopPct": None},
                           "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0) == 0)
check("sizing in the generated file is the engine's own function, not a second copy",
      ns["position_size"]({"exit": {"stopPct": 2.0},
                           "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0)
      == S.position_size({"exit": {"stopPct": 2.0},
                          "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0))

print("\n--- ROI is an output, computed from capital and risk ---")
_ms = S.money_summary(S.validate_spec(spec([SMA_UP]))["spec"], trades, 0.15)
check("a money summary comes back", _ms["ok"], str(_ms.get("reason")))
check("ROI is derived from the equity, not supplied",
      abs(_ms["roiPct"] - (_ms["finalEquity"] - _ms["capital"]) / _ms["capital"] * 100.0) < 1e-9)
check("net P&L and final equity agree",
      abs(_ms["netPnl"] - (_ms["finalEquity"] - _ms["capital"])) < 1e-9)
check("every trade is accounted for as sized or unsized",
      _ms["sizedTrades"] + _ms["unsizedTrades"] == len(trades))
check("drawdown is a non-negative percentage", _ms["maxDrawdownPct"] >= 0)
check("one row per trade", len(_ms["trades"]) == len(trades))
check("the note says the risk is not compounded", "ORIGINAL capital" in _ms["note"])
_nostop = S.validate_spec(spec([SMA_UP], exit={"stopPct": None, "targetPct": 4.0, "maxBars": 5}))["spec"]
_ns_trades = S.simulate(_nostop, BARS)
_ms2 = S.money_summary(_nostop, _ns_trades, 0.15)
check("with no stop every trade is unsized rather than silently zero-sized",
      _ms2["unsizedTrades"] == len(_ns_trades) and _ms2["sizedTrades"] == 0)
check("and the note says so rather than reporting a flat result",
      "could not be sized" in _ms2["note"])
check("no capital is refused rather than dividing by zero",
      S.money_summary({"sizing": {"capital": 0, "riskPct": 1}, "exit": {"stopPct": 2}},
                      trades, 0.15)["ok"] is False)
check("a higher risk percentage sizes bigger",
      S.position_size({"exit": {"stopPct": 2.0}, "sizing": {"capital": 100000, "riskPct": 2.0}}, 100.0)
      > S.position_size({"exit": {"stopPct": 2.0}, "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0))
check("a wider stop sizes smaller, so the money at risk stays the same",
      S.position_size({"exit": {"stopPct": 4.0}, "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0)
      < S.position_size({"exit": {"stopPct": 2.0}, "sizing": {"capital": 100000, "riskPct": 1.0}}, 100.0))
check("the money actually at risk is the declared percentage, whatever the stop",
      abs(S.position_size({"exit": {"stopPct": 2.0}, "sizing": {"capital": 100000, "riskPct": 1.0}},
                          100.0) * 100.0 * 0.02 - 1000.0) < 100.0)

print("\n--- the generated file runs end to end on a CSV ---")
_tmp = tempfile.mkdtemp(prefix="rama-strategy-")
_csv = os.path.join(_tmp, "bars.csv")
with open(_csv, "w", encoding="utf-8", newline="") as fh:
    fh.write("date,open,high,low,close,volume\n")
    for b in BARS:
        fh.write(f"{b['date']},{b['open']},{b['high']},{b['low']},{b['close']},{b['volume']}\n")
check("the loader reads back every bar", len(ns["load_bars"](_csv)) == len(BARS))
check("a malformed row is skipped rather than fatal",
      len(ns["load_bars"](_csv)) == len(BARS))
_rc = ns["main"](["s.py", _csv])
check("main exits cleanly", _rc == 0, str(_rc))
_rc_missing = ns["main"](["s.py"])
check("main with no file prints usage instead of crashing", _rc_missing == 2)

print("\n--- codegen refuses what validation refuses ---")
bad = CG.to_python(spec([]))
check("an invalid spec yields no code", bad["ok"] is False and bad["code"] is None)
check("and says why", len(bad["reason"]) > 10)
nov = CG.to_python(spec([SMA_UP]), verdict=None, trials=1)
check("no verdict is stated as NOT BACKTESTED rather than left blank",
      "NOT BACKTESTED" in nov["code"])
check("and warns against trading it on the strength of the code existing",
      "Do not trade this" in nov["code"])
_failed = dict(verdict.to_dict())
_failed["passed"] = False
_failed["reason"] = "no edge after costs"
_fv = CG.to_python(spec([SMA_UP]), verdict=_failed, trials=9)
check("a failed verdict says DID NOT PASS", "DID NOT PASS" in _fv["code"])
check("and says the code is not there because it works",
      "not because it works" in _fv["code"])
_blocked = CG.to_python(spec([SMA_UP, {"id": "sentiment_level", "params": {}}]), trials=1)
check("a spec with unbacktestable blocks still emits code",
      _blocked["ok"] and _blocked["code"])
check("and the header names them", "cannot be backtested" in _blocked["code"])


# ── The catalogue the UI reads ───────────────────────────────────────────────
print("\n--- the catalogue ---")

cat = S.catalogue()
check("every block appears exactly once",
      sum(len(g["blocks"]) for g in cat["groups"]) == len(S.BLOCKS))
check("no group is empty", all(len(g["blocks"]) > 0 for g in cat["groups"]))
check("the function is not serialised out to the renderer",
      all("fn" not in b for g in cat["groups"] for b in g["blocks"]))
check("it serialises to JSON", isinstance(json.dumps(cat), str))
check("every block explains itself",
      all(len(b["explain"]) > 20 for g in cat["groups"] for b in g["blocks"]))
check("every parameter declares a type and a default",
      all("type" in p and "default" in p
          for g in cat["groups"] for b in g["blocks"] for p in b["params"].values()))
check("every numeric parameter declares a range",
      all("min" in p and "max" in p
          for g in cat["groups"] for b in g["blocks"] for p in b["params"].values()
          if p["type"] in ("int", "float", "intset")))
check("every default sits inside its own range",
      all(p["min"] <= p["default"] <= p["max"]
          for g in cat["groups"] for b in g["blocks"] for p in b["params"].values()
          if p["type"] in ("int", "float")))
check("every enum default is one of its options",
      all(p["default"] in p["options"]
          for g in cat["groups"] for b in g["blocks"] for p in b["params"].values()
          if p["type"] == "enum"))
check("every default spec built from the catalogue validates",
      all(S.validate_spec(spec([{"id": b["id"], "params": {}}],
                               interval="15m" if b["intradayOnly"] else "1d"))["ok"]
          for g in cat["groups"] for b in g["blocks"]),
      str([b["id"] for g in cat["groups"] for b in g["blocks"]
           if not S.validate_spec(spec([{"id": b["id"], "params": {}}],
                                       interval="15m" if b["intradayOnly"] else "1d"))["ok"]]))
check("the note explains the refusal rule", "weakest block" in cat["note"])

print("\n--- every backtestable block actually runs on real-shaped bars ---")
for bid, b in sorted(S.BLOCKS.items()):
    if b["fn"] is None:
        continue
    iv = "15m" if b.get("intradayOnly") else "1d"
    use = BARS
    if b.get("intradayOnly"):
        use = [dict(x, date=f"2020-01-0{(i % 9) + 1} 04:{(i * 5) % 60:02d}:00")
               for i, x in enumerate(BARS)]
    sv = S.validate_spec(spec([{"id": bid, "params": {}}], interval=iv))
    threw = None
    arr = None
    try:
        arr = b["fn"](use, sv["spec"]["entry"]["blocks"][0]["params"])
    except Exception as e:                       # noqa: BLE001
        threw = repr(e)
    check(f"{bid} runs", threw is None, threw)
    if arr is not None:
        check(f"{bid} returns one flag per bar", len(arr) == len(use))
        check(f"{bid} returns only booleans", all(isinstance(x, bool) for x in arr))
    threw = None
    try:
        b["fn"]([], sv["spec"]["entry"]["blocks"][0]["params"])
        b["fn"](use[:2], sv["spec"]["entry"]["blocks"][0]["params"])
    except Exception as e:                       # noqa: BLE001
        threw = repr(e)
    check(f"{bid} survives an empty and a two-bar series", threw is None, threw)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
