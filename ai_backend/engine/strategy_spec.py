"""
strategy_spec.py — composable strategies: the blocks, the combiner, and the interpreter.

Master: *"strategies can be made individually or various combo of probability calculation +
higherhigh-lowerlow (trend lines) + technical indicators + various things (news + sentiment) etc., so we
need to have ability to pick things, backtest them for various scenarios."* See spec Section 103 for the
decisions; the ones that shape this file:

  - A STRATEGY IS A DECLARATION. Master picks blocks; Rāma holds a spec. A spec can be counted (the
    trial count is what makes any backtest number interpretable at all), re-run, diffed and versioned.
    Freeform code can be none of those.
  - BLOCKS THAT CANNOT BE BACKTESTED ARE OFFERED AND REFUSED, not quietly included. Model probability
    is look-ahead against historical bars; news has no free history (Sections 66, 70). Both are usable
    in a live strategy and both make `run_spec` refuse, naming the reason. A verdict can never be
    stronger than the weakest block in the spec.
  - ROI IS AN OUTPUT. Capital and risk are inputs.
  - ONE POSITION AT A TIME. Overlapping positions need a portfolio model, and the trade-return series
    `strategy_eval` judges assumes independent round trips.

STDLIB ONLY, for the same reason `strategy_eval.py` is: this is the layer results come from, so it must
be testable on a machine with no numpy — including this one.

BLOCK LOGIC IS WRITTEN ONCE. `strategy_codegen` emits the generated script using
`inspect.getsource()` of the very `_sig_*` functions below, so the artefact and the interpreter cannot
drift. That is why each one is self-contained and imports nothing beyond the helpers directly above it.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from typing import Callable, Optional

# ── Series helpers. Plain lists in, plain lists out, `None` for warm-up. ──────
#
# `None` rather than 0.0 or a partial average: a partial average drawn as an average is a wrong number
# that looks right, and a block reading it would fire on a value that does not exist yet. Every helper
# returns a list the same length as `bars` so an index into one is always an index into the other.


def _sma(values: list, period: int) -> list:
    out = [None] * len(values)
    if period < 1:
        return out
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            out[i] = total / period
    return out


def _ema(values: list, period: int) -> list:
    out = [None] * len(values)
    if period < 1 or len(values) < period:
        return out
    k = 2.0 / (period + 1.0)
    prev = sum(values[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1.0 - k)
        out[i] = prev
    return out


def _stdev(values: list, period: int) -> list:
    """Population standard deviation over a rolling window — the window IS the thing described."""
    out = [None] * len(values)
    if period < 2:
        return out
    for i in range(period - 1, len(values)):
        window = values[i - period + 1:i + 1]
        mean = sum(window) / period
        var = sum((w - mean) ** 2 for w in window) / period
        out[i] = math.sqrt(var)
    return out


def _rsi(values: list, period: int) -> list:
    """Wilder's smoothing, not a plain mean of gains and losses — those are different indicators."""
    out = [None] * len(values)
    if period < 2 or len(values) < period + 1:
        return out
    gain = loss = 0.0
    for i in range(1, period + 1):
        d = values[i] - values[i - 1]
        if d >= 0:
            gain += d
        else:
            loss -= d
    avg_gain = gain / period
    avg_loss = loss / period

    def rsi_value(g, l):
        if l == 0:
            return 50.0 if g == 0 else 100.0
        return 100.0 - 100.0 / (1.0 + g / l)

    out[period] = rsi_value(avg_gain, avg_loss)
    for i in range(period + 1, len(values)):
        d = values[i] - values[i - 1]
        g = d if d > 0 else 0.0
        l = -d if d < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        out[i] = rsi_value(avg_gain, avg_loss)
    return out


def _atr(highs: list, lows: list, closes: list, period: int) -> list:
    """True range, Wilder-smoothed. Uses the previous close, which is what makes it *true* range."""
    out = [None] * len(closes)
    if period < 1 or len(closes) < period + 1:
        return out
    trs = [None]
    for i in range(1, len(closes)):
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]),
                       abs(lows[i] - closes[i - 1])))
    prev = sum(trs[1:period + 1]) / period
    out[period] = prev
    for i in range(period + 1, len(closes)):
        prev = (prev * (period - 1) + trs[i]) / period
        out[i] = prev
    return out


def _rolling_max(values: list, period: int) -> list:
    out = [None] * len(values)
    for i in range(len(values)):
        if i >= period - 1 >= 0:
            out[i] = max(values[i - period + 1:i + 1])
    return out


def _rolling_min(values: list, period: int) -> list:
    out = [None] * len(values)
    for i in range(len(values)):
        if i >= period - 1 >= 0:
            out[i] = min(values[i - period + 1:i + 1])
    return out


def _swing_points(highs: list, lows: list, span: int) -> tuple:
    """
    Confirmed swing highs and lows.

    A swing high at `i` needs `span` bars either side that are lower. THE RIGHT-HAND BARS ARE THE
    PROBLEM: at bar `i` those have not happened yet, so a swing is only KNOWN at `i + span`. Both lists
    are therefore written at `i + span`, not at `i`. Writing them at `i` is the classic trend-structure
    look-ahead and it makes higher-high logic appear to predict the future.
    """
    n = len(highs)
    sh = [None] * n
    sl = [None] * n
    if span < 1:
        return (sh, sl)
    for i in range(span, n - span):
        left_h = highs[i - span:i]
        right_h = highs[i + 1:i + span + 1]
        if highs[i] > max(left_h) and highs[i] > max(right_h):
            sh[i + span] = highs[i]
        left_l = lows[i - span:i]
        right_l = lows[i + 1:i + span + 1]
        if lows[i] < min(left_l) and lows[i] < min(right_l):
            sl[i + span] = lows[i]
    return (sh, sl)


def _last_n_confirmed(series: list, upto: int, count: int) -> list:
    """The most recent `count` non-None values at or before `upto`, oldest first."""
    out = []
    i = upto
    while i >= 0 and len(out) < count:
        if series[i] is not None:
            out.append(series[i])
        i -= 1
    out.reverse()
    return out


def _linfit_slope(values: list, start: int, end: int) -> Optional[float]:
    """Least-squares slope over `[start, end)`. Used for the trendline blocks."""
    n = end - start
    if n < 2:
        return None
    xs = list(range(n))
    ys = values[start:end]
    mx = sum(xs) / n
    my = sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return None
    return sum((xs[k] - mx) * (ys[k] - my) for k in range(n)) / den


# ── Signal functions ─────────────────────────────────────────────────────────
#
# EVERY ONE HAS THE SAME SHAPE: `(bars, p) -> list[bool]`, one entry per bar, `False` wherever the
# inputs are not yet available. That uniformity is what lets the combiner be trivial and lets
# `strategy_codegen` emit them by source without knowing anything about them.
#
# `p` is the block's validated parameters. Validation happens in `validate_spec`, so these functions do
# not re-check — but they never index past the end, because a malformed length is a crash rather than a
# wrong answer and crashes in here are hard to attribute.


def _sig_sma_cross(bars, p):
    closes = [b["close"] for b in bars]
    fast = _sma(closes, p["fast"])
    slow = _sma(closes, p["slow"])
    out = [False] * len(bars)
    for i in range(1, len(bars)):
        a, b = fast[i], slow[i]
        pa, pb = fast[i - 1], slow[i - 1]
        if None in (a, b, pa, pb):
            continue
        # The CROSS, not "fast is above slow". A level test fires on every bar of a trend, which makes
        # the trade count explode and the cost drag with it.
        out[i] = (pa <= pb) and (a > b) if p["direction"] == "up" else (pa >= pb) and (a < b)
    return out


def _sig_ema_cross(bars, p):
    closes = [b["close"] for b in bars]
    fast = _ema(closes, p["fast"])
    slow = _ema(closes, p["slow"])
    out = [False] * len(bars)
    for i in range(1, len(bars)):
        a, b = fast[i], slow[i]
        pa, pb = fast[i - 1], slow[i - 1]
        if None in (a, b, pa, pb):
            continue
        out[i] = (pa <= pb) and (a > b) if p["direction"] == "up" else (pa >= pb) and (a < b)
    return out


def _sig_price_vs_sma(bars, p):
    closes = [b["close"] for b in bars]
    ma = _sma(closes, p["period"])
    out = [False] * len(bars)
    for i in range(len(bars)):
        if ma[i] is None:
            continue
        out[i] = closes[i] > ma[i] if p["side"] == "above" else closes[i] < ma[i]
    return out


def _sig_rsi_band(bars, p):
    closes = [b["close"] for b in bars]
    r = _rsi(closes, p["period"])
    out = [False] * len(bars)
    for i in range(len(bars)):
        if r[i] is None:
            continue
        out[i] = r[i] < p["level"] if p["side"] == "below" else r[i] > p["level"]
    return out


def _sig_macd_cross(bars, p):
    closes = [b["close"] for b in bars]
    fast = _ema(closes, p["fast"])
    slow = _ema(closes, p["slow"])
    line = [None if (fast[i] is None or slow[i] is None) else fast[i] - slow[i]
            for i in range(len(bars))]
    # The signal line is an EMA OF THE MACD LINE, so it is seeded on the line's own first values.
    first = next((i for i, v in enumerate(line) if v is not None), None)
    sig = [None] * len(bars)
    if first is not None:
        dense = [v for v in line[first:] if v is not None]
        smoothed = _ema(dense, p["signal"])
        for k, v in enumerate(smoothed):
            sig[first + k] = v
    out = [False] * len(bars)
    for i in range(1, len(bars)):
        a, b = line[i], sig[i]
        pa, pb = line[i - 1], sig[i - 1]
        if None in (a, b, pa, pb):
            continue
        out[i] = (pa <= pb) and (a > b) if p["direction"] == "up" else (pa >= pb) and (a < b)
    return out


def _sig_bollinger_touch(bars, p):
    closes = [b["close"] for b in bars]
    mid = _sma(closes, p["period"])
    sd = _stdev(closes, p["period"])
    out = [False] * len(bars)
    for i in range(len(bars)):
        if mid[i] is None or sd[i] is None:
            continue
        if p["side"] == "lower":
            out[i] = closes[i] <= mid[i] - p["mult"] * sd[i]
        else:
            out[i] = closes[i] >= mid[i] + p["mult"] * sd[i]
    return out


def _sig_atr_expansion(bars, p):
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    a = _atr(highs, lows, closes, p["period"])
    base = _sma([0.0 if v is None else v for v in a], p["baseline"])
    out = [False] * len(bars)
    for i in range(len(bars)):
        if a[i] is None or base[i] is None or base[i] <= 0:
            continue
        out[i] = a[i] >= base[i] * p["mult"]
    return out


def _sig_breakout(bars, p):
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    # The window ends at i-1. Including bar `i`'s own high makes "close above the highest high" almost
    # tautological and is a look-ahead into the bar being decided on.
    hh = _rolling_max(highs, p["lookback"])
    ll = _rolling_min(lows, p["lookback"])
    out = [False] * len(bars)
    for i in range(1, len(bars)):
        if p["direction"] == "up":
            ref = hh[i - 1]
            out[i] = ref is not None and closes[i] > ref
        else:
            ref = ll[i - 1]
            out[i] = ref is not None and closes[i] < ref
    return out


def _sig_volume_surge(bars, p):
    vols = [float(b.get("volume") or 0.0) for b in bars]
    avg = _sma(vols, p["period"])
    out = [False] * len(bars)
    for i in range(len(bars)):
        if avg[i] is None or avg[i] <= 0:
            continue
        out[i] = vols[i] >= avg[i] * p["mult"]
    return out


def _sig_higher_structure(bars, p):
    """
    Higher highs AND higher lows — an uptrend by structure rather than by indicator.

    Both, not either. Higher highs alone happens in a widening range that is going nowhere, and master
    named the pair ("higherhigh-lowerlow") because the pair is what a trend is.
    """
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    sh, sl = _swing_points(highs, lows, p["span"])
    need = p["swings"]
    out = [False] * len(bars)
    for i in range(len(bars)):
        hs = _last_n_confirmed(sh, i, need)
        ls = _last_n_confirmed(sl, i, need)
        if len(hs) < need or len(ls) < need:
            continue
        rising_h = all(hs[k] > hs[k - 1] for k in range(1, need))
        rising_l = all(ls[k] > ls[k - 1] for k in range(1, need))
        out[i] = rising_h and rising_l
    return out


def _sig_lower_structure(bars, p):
    """Lower lows AND lower highs — the mirror of the above."""
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    sh, sl = _swing_points(highs, lows, p["span"])
    need = p["swings"]
    out = [False] * len(bars)
    for i in range(len(bars)):
        hs = _last_n_confirmed(sh, i, need)
        ls = _last_n_confirmed(sl, i, need)
        if len(hs) < need or len(ls) < need:
            continue
        falling_h = all(hs[k] < hs[k - 1] for k in range(1, need))
        falling_l = all(ls[k] < ls[k - 1] for k in range(1, need))
        out[i] = falling_h and falling_l
    return out


def _sig_trendline_break(bars, p):
    """
    Close crossing the least-squares line fitted over the previous `lookback` bars.

    A regression line rather than two touched points: two-point trendlines are what the drawer chose,
    and a backtest of a line master would have drawn differently is not a backtest of anything.
    """
    closes = [b["close"] for b in bars]
    look = p["lookback"]
    out = [False] * len(bars)
    for i in range(look, len(bars)):
        start, end = i - look, i
        slope = _linfit_slope(closes, start, end)
        if slope is None:
            continue
        window = closes[start:end]
        n = len(window)
        mean_y = sum(window) / n
        mean_x = (n - 1) / 2.0
        projected = mean_y + slope * (n - mean_x)      # the line extended to bar i
        if p["direction"] == "up":
            out[i] = closes[i] > projected and closes[i - 1] <= projected
        else:
            out[i] = closes[i] < projected and closes[i - 1] >= projected
    return out


def _sig_day_of_week(bars, p):
    """Monday is 0. A session filter, which is the cheapest way to test "is this a Monday effect".""" 
    import datetime as _d
    wanted = set(p["days"])
    out = [False] * len(bars)
    for i, b in enumerate(bars):
        raw = str(b.get("date") or "")[:10]
        try:
            out[i] = _d.date.fromisoformat(raw).weekday() in wanted
        except Exception:
            out[i] = False
    return out


def _sig_time_of_day(bars, p):
    """Bars whose clock time falls inside a window. Intraday series only — daily has no clock."""
    out = [False] * len(bars)
    lo, hi = p["fromMinute"], p["toMinute"]
    for i, b in enumerate(bars):
        raw = str(b.get("date") or "")
        if len(raw) < 16:
            continue
        try:
            hh = int(raw[11:13])
            mm = int(raw[14:16])
        except Exception:
            continue
        minute = hh * 60 + mm
        out[i] = lo <= minute <= hi
    return out


# ── The catalogue ────────────────────────────────────────────────────────────
#
# `backtestable: False` is a refusal, not a warning. See Section 103: a spec's verdict can never be
# stronger than its weakest block, and the two unbacktestable groups are exactly the ones that would
# produce the most flattering numbers if allowed through.

BLOCKS: dict = {
    "sma_cross": {
        "label": "SMA cross", "group": "Moving averages", "backtestable": True,
        "fn": _sig_sma_cross,
        "params": {
            "fast": {"type": "int", "default": 20, "min": 2, "max": 200},
            "slow": {"type": "int", "default": 50, "min": 3, "max": 400},
            "direction": {"type": "enum", "default": "up", "options": ["up", "down"]},
        },
        "explain": "The faster average crossing the slower one. A cross, not a level — a level test "
                   "fires on every bar of a trend and multiplies the cost drag.",
        "rules": [("fast", "<", "slow")],
    },
    "ema_cross": {
        "label": "EMA cross", "group": "Moving averages", "backtestable": True,
        "fn": _sig_ema_cross,
        "params": {
            "fast": {"type": "int", "default": 12, "min": 2, "max": 200},
            "slow": {"type": "int", "default": 26, "min": 3, "max": 400},
            "direction": {"type": "enum", "default": "up", "options": ["up", "down"]},
        },
        "explain": "As above, weighted toward recent bars so it turns sooner.",
        "rules": [("fast", "<", "slow")],
    },
    "price_vs_sma": {
        "label": "Price vs SMA", "group": "Moving averages", "backtestable": True,
        "fn": _sig_price_vs_sma,
        "params": {
            "period": {"type": "int", "default": 200, "min": 2, "max": 400},
            "side": {"type": "enum", "default": "above", "options": ["above", "below"]},
        },
        "explain": "A regime filter rather than a trigger. Usually combined with something that fires.",
    },
    "rsi_band": {
        "label": "RSI band", "group": "Momentum", "backtestable": True,
        "fn": _sig_rsi_band,
        "params": {
            "period": {"type": "int", "default": 14, "min": 2, "max": 100},
            "level": {"type": "float", "default": 30.0, "min": 1.0, "max": 99.0},
            "side": {"type": "enum", "default": "below", "options": ["below", "above"]},
        },
        "explain": "Wilder's RSI beyond a level. Oversold is not a buy signal on its own — it is a "
                   "condition that some other block can act inside.",
    },
    "macd_cross": {
        "label": "MACD signal cross", "group": "Momentum", "backtestable": True,
        "fn": _sig_macd_cross,
        "params": {
            "fast": {"type": "int", "default": 12, "min": 2, "max": 100},
            "slow": {"type": "int", "default": 26, "min": 3, "max": 200},
            "signal": {"type": "int", "default": 9, "min": 2, "max": 50},
            "direction": {"type": "enum", "default": "up", "options": ["up", "down"]},
        },
        "explain": "The MACD line crossing its own signal line.",
        "rules": [("fast", "<", "slow")],
    },
    "bollinger_touch": {
        "label": "Bollinger touch", "group": "Volatility", "backtestable": True,
        "fn": _sig_bollinger_touch,
        "params": {
            "period": {"type": "int", "default": 20, "min": 3, "max": 200},
            "mult": {"type": "float", "default": 2.0, "min": 0.5, "max": 5.0},
            "side": {"type": "enum", "default": "lower", "options": ["lower", "upper"]},
        },
        "explain": "Close at or beyond a band. Population standard deviation, which is what the "
                   "window is.",
    },
    "atr_expansion": {
        "label": "ATR expansion", "group": "Volatility", "backtestable": True,
        "fn": _sig_atr_expansion,
        "params": {
            "period": {"type": "int", "default": 14, "min": 2, "max": 100},
            "baseline": {"type": "int", "default": 50, "min": 5, "max": 300},
            "mult": {"type": "float", "default": 1.5, "min": 1.0, "max": 5.0},
        },
        "explain": "True range running above its own longer average — a volatility regime filter.",
    },
    "breakout": {
        "label": "N-bar break", "group": "Breakout", "backtestable": True,
        "fn": _sig_breakout,
        "params": {
            "lookback": {"type": "int", "default": 20, "min": 2, "max": 400},
            "direction": {"type": "enum", "default": "up", "options": ["up", "down"]},
        },
        "explain": "Close beyond the highest high or lowest low of the previous N bars. The window "
                   "ends at the bar before, so the bar being decided on is not part of its own test.",
    },
    "volume_surge": {
        "label": "Volume surge", "group": "Breakout", "backtestable": True,
        "fn": _sig_volume_surge,
        "params": {
            "period": {"type": "int", "default": 20, "min": 2, "max": 200},
            "mult": {"type": "float", "default": 2.0, "min": 1.0, "max": 10.0},
        },
        "explain": "Volume a multiple of its own average. Indices often report no volume, in which "
                   "case this never fires — which the trade count will show.",
    },
    "higher_structure": {
        "label": "Higher highs and higher lows", "group": "Trend structure", "backtestable": True,
        "fn": _sig_higher_structure,
        "params": {
            "span": {"type": "int", "default": 3, "min": 1, "max": 20},
            "swings": {"type": "int", "default": 2, "min": 2, "max": 6},
        },
        "explain": "An uptrend by structure. A swing is only confirmed `span` bars later, and it is "
                   "recorded at the bar where it became knowable — recording it earlier is the "
                   "classic trend look-ahead.",
    },
    "lower_structure": {
        "label": "Lower lows and lower highs", "group": "Trend structure", "backtestable": True,
        "fn": _sig_lower_structure,
        "params": {
            "span": {"type": "int", "default": 3, "min": 1, "max": 20},
            "swings": {"type": "int", "default": 2, "min": 2, "max": 6},
        },
        "explain": "The mirror image — a downtrend by structure.",
    },
    "trendline_break": {
        "label": "Trendline break", "group": "Trend structure", "backtestable": True,
        "fn": _sig_trendline_break,
        "params": {
            "lookback": {"type": "int", "default": 30, "min": 5, "max": 400},
            "direction": {"type": "enum", "default": "up", "options": ["up", "down"]},
        },
        "explain": "Close crossing the least-squares line fitted over the previous N bars. A "
                   "regression line rather than two hand-picked touches, so the test is reproducible.",
    },
    "day_of_week": {
        "label": "Day of week", "group": "Session", "backtestable": True,
        "fn": _sig_day_of_week,
        "params": {
            "days": {"type": "intset", "default": [0, 1, 2, 3, 4], "min": 0, "max": 6},
        },
        "explain": "Monday is 0. The cheapest way to test whether a day-of-week effect is real, and "
                   "usually it is not.",
    },
    "time_of_day": {
        "label": "Time of day", "group": "Session", "backtestable": True,
        "fn": _sig_time_of_day,
        "params": {
            "fromMinute": {"type": "int", "default": 225, "min": 0, "max": 1439},
            "toMinute": {"type": "int", "default": 600, "min": 0, "max": 1439},
        },
        "explain": "Minutes from UTC midnight, because the store keeps intraday stamps in UTC — the "
                   "09:15 IST open is 03:45 UTC, which is minute 225. Intraday series only.",
        "rules": [("fromMinute", "<=", "toMinute")],
        "intradayOnly": True,
    },

    # ── Offered, and refused by the backtest ─────────────────────────────────
    "model_probability": {
        "label": "Model directional probability", "group": "Probability", "backtestable": False,
        "fn": None,
        "params": {
            "minProbability": {"type": "float", "default": 60.0, "min": 50.0, "max": 99.0},
            "horizon": {"type": "enum", "default": "swing",
                        "options": ["intraday", "swing", "positional"]},
        },
        "explain": "The trained ensemble's own view on direction.",
        "whyNotBacktestable":
            "The model was fitted on data that includes the period a backtest would test it over, so "
            "any result would be look-ahead and would be the most flattering number in this tool. "
            "Making it honest needs the model refitted inside every walk-forward fold. Usable in a "
            "live strategy; refused in a backtest.",
    },
    "sentiment_level": {
        "label": "News sentiment", "group": "News", "backtestable": False,
        "fn": None,
        "params": {
            "threshold": {"type": "float", "default": 0.15, "min": -1.0, "max": 1.0},
            "side": {"type": "enum", "default": "above", "options": ["above", "below"]},
        },
        "explain": "Aggregate tone of recent headlines.",
        "whyNotBacktestable":
            "No free feed carries enough history to measure whether tone predicts anything — the same "
            "finding that labels the NEWS panel NOT BACKTESTABLE (Sections 66, 70). Usable in a live "
            "strategy; refused in a backtest.",
    },
    "news_volume_spike": {
        "label": "Headline volume spike", "group": "News", "backtestable": False,
        "fn": None,
        "params": {
            "mult": {"type": "float", "default": 3.0, "min": 1.0, "max": 20.0},
        },
        "explain": "Unusually many headlines, regardless of their tone.",
        "whyNotBacktestable":
            "Same reason as sentiment: the history does not exist to measure it on.",
    },
}

COMBINERS = ("all", "any", "atLeast")


def catalogue() -> dict:
    """The blocks, shaped for the UI. `fn` is dropped — it does not serialise and is not the UI's."""
    groups: dict = {}
    for bid, b in BLOCKS.items():
        groups.setdefault(b["group"], []).append({
            "id": bid, "label": b["label"], "backtestable": b["backtestable"],
            "params": b["params"], "explain": b.get("explain", ""),
            "whyNotBacktestable": b.get("whyNotBacktestable"),
            "intradayOnly": bool(b.get("intradayOnly")),
            "rules": [list(r) for r in b.get("rules", [])],
        })
    return {
        "groups": [{"group": g, "blocks": v} for g, v in groups.items()],
        "combiners": list(COMBINERS),
        "note": "A block marked backtestable:false can be used in a live strategy and is refused by "
                "the backtest, with its reason. A verdict is never stronger than the weakest block.",
    }


# ── Validation ───────────────────────────────────────────────────────────────

def _coerce_param(spec: dict, value):
    t = spec["type"]
    if t == "int":
        v = int(round(float(value)))
        return max(spec["min"], min(spec["max"], v))
    if t == "float":
        v = float(value)
        return max(spec["min"], min(spec["max"], v))
    if t == "enum":
        s = str(value)
        return s if s in spec["options"] else spec["default"]
    if t == "intset":
        vals = value if isinstance(value, (list, tuple, set)) else [value]
        out = sorted({int(x) for x in vals if spec["min"] <= int(x) <= spec["max"]})
        return out or list(spec["default"])
    return value


def normalise_block(entry: dict) -> dict:
    """
    One block with every parameter present, coerced and clamped.

    Clamping rather than rejecting: a slider that sends 500 for a 400-max period is a UI bug, and
    failing the whole strategy over it tells master nothing he can act on. A value outside a range is
    pulled to the edge and the `rules` check below still catches combinations that make no sense.
    """
    bid = str(entry.get("id") or "")
    if bid not in BLOCKS:
        raise ValueError(f"unknown block {bid!r}")
    block = BLOCKS[bid]
    supplied = entry.get("params") or {}
    params = {}
    for name, pspec in block["params"].items():
        raw = supplied.get(name, pspec["default"])
        try:
            params[name] = _coerce_param(pspec, raw)
        except (TypeError, ValueError):
            params[name] = pspec["default"]
    return {"id": bid, "params": params}


_RULE_OPS = {
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
}


def _rule_errors(bid: str, params: dict) -> list:
    out = []
    for left, op, right in BLOCKS[bid].get("rules", []):
        a, b = params.get(left), params.get(right)
        if a is None or b is None:
            continue
        if not _RULE_OPS[op](a, b):
            out.append(f"{BLOCKS[bid]['label']}: {left} must be {op} {right} "
                       f"(got {left}={a}, {right}={b})")
    return out


def validate_spec(spec: dict) -> dict:
    """
    Normalise a spec and report everything wrong with it at once.

    @returns `{ok, spec, errors, warnings, blocked, trials, backtestable}`

    ALL ERRORS AT ONCE, not the first. A form that reports one problem per submission makes master
    guess how many are left.
    """
    errors: list = []
    warnings: list = []
    blocked: list = []
    s = dict(spec or {})

    entry_in = (s.get("entry") or {})
    raw_blocks = entry_in.get("blocks") or []
    if not isinstance(raw_blocks, list) or len(raw_blocks) == 0:
        errors.append("A strategy needs at least one entry block — otherwise it never trades.")
        raw_blocks = []

    blocks = []
    for b in raw_blocks:
        try:
            nb = normalise_block(b if isinstance(b, dict) else {})
        except ValueError as e:
            errors.append(str(e))
            continue
        errors.extend(_rule_errors(nb["id"], nb["params"]))
        blocks.append(nb)
        if not BLOCKS[nb["id"]]["backtestable"]:
            blocked.append({"id": nb["id"], "label": BLOCKS[nb["id"]]["label"],
                            "why": BLOCKS[nb["id"]]["whyNotBacktestable"]})

    seen = set()
    for nb in blocks:
        key = (nb["id"], json.dumps(nb["params"], sort_keys=True))
        if key in seen:
            warnings.append(f"{BLOCKS[nb['id']]['label']} appears twice with identical settings — the "
                            "duplicate changes nothing.")
        seen.add(key)

    combiner = str(entry_in.get("op") or "all")
    if combiner not in COMBINERS:
        errors.append(f"Unknown combiner {combiner!r}; use one of {', '.join(COMBINERS)}.")
        combiner = "all"
    k = int(entry_in.get("k") or 1)
    if combiner == "atLeast":
        if k < 1:
            errors.append("'at least k' needs k of 1 or more.")
            k = 1
        if blocks and k > len(blocks):
            errors.append(f"'at least {k}' cannot be met by {len(blocks)} blocks.")

    interval = str(s.get("interval") or "1d")
    for nb in blocks:
        if BLOCKS[nb["id"]].get("intradayOnly") and interval in ("1d", "1wk", "1mo", "5d", "3mo"):
            errors.append(f"{BLOCKS[nb['id']]['label']} needs intraday bars; {interval} has no clock.")

    exit_in = (s.get("exit") or {})
    stop = exit_in.get("stopPct")
    target = exit_in.get("targetPct")
    max_bars = int(exit_in.get("maxBars") or 0)
    stop = None if stop in (None, "") else float(stop)
    target = None if target in (None, "") else float(target)
    if stop is None and target is None and max_bars <= 0:
        errors.append("A strategy needs an exit: a stop, a target, or a maximum holding period. "
                      "Without one, every trade runs to the end of the data and the result describes "
                      "the instrument rather than the strategy.")
    if stop is not None and stop <= 0:
        errors.append("The stop must be a positive percentage away from entry.")
    if target is not None and target <= 0:
        errors.append("The target must be a positive percentage away from entry.")
    if max_bars < 0:
        errors.append("A maximum holding period cannot be negative.")
    if stop is not None and target is not None and target <= stop:
        warnings.append(f"Target {target}% is not further than stop {stop}%, so the reward-to-risk "
                        "ratio is 1 or worse before costs. That needs a win rate above 50% to break "
                        "even.")

    side = str(s.get("side") or "long")
    if side not in ("long", "short"):
        errors.append("Side must be long or short. 'Both' needs two specs, judged separately — "
                      "averaging them would hide which half carries the result.")
        side = "long"

    sizing = s.get("sizing") or {}
    capital = float(sizing.get("capital") or 0)
    risk_pct = float(sizing.get("riskPct") or 0)
    if capital <= 0:
        errors.append("Enter the capital this strategy trades with.")
    if risk_pct <= 0 or risk_pct > 25:
        errors.append("Risk per trade must be above 0 and at most 25% of capital.")
    elif risk_pct > 5:
        warnings.append(f"{risk_pct}% per trade is aggressive: a run of five losses costs about "
                        f"{risk_pct * 5:.0f}% of capital.")

    sweep, sweep_errors = _normalise_sweep(s.get("sweep") or {}, blocks)
    errors.extend(sweep_errors)
    trials = count_trials(sweep)
    if trials > 5000:
        warnings.append(f"{trials} variants is a very wide search. The noise benchmark rises with the "
                        "count, so a wider search makes any result harder to believe, not easier.")

    clean = {
        "name": str(s.get("name") or "Untitled strategy")[:80],
        "symbol": str(s.get("symbol") or "").upper().strip(),
        "exchange": str(s.get("exchange") or "NSE").upper().strip(),
        "interval": interval,
        "side": side,
        "entry": {"op": combiner, "k": k, "blocks": blocks},
        "exit": {"stopPct": stop, "targetPct": target, "maxBars": max_bars, "blocks": []},
        "sizing": {"capital": capital, "riskPct": risk_pct},
        "costs": _normalise_costs(s.get("costs") or {}),
        "sweep": sweep,
    }
    if not clean["symbol"]:
        errors.append("Pick an instrument for this strategy.")

    return {
        "ok": len(errors) == 0,
        "spec": clean,
        "errors": errors,
        "warnings": warnings,
        "blocked": blocked,
        "backtestable": len(blocked) == 0,
        "trials": trials,
        "specHash": spec_hash(clean),
    }


def _normalise_costs(c: dict) -> dict:
    def pos(key, default):
        try:
            v = float(c.get(key, default))
        except (TypeError, ValueError):
            v = default
        return max(0.0, min(5.0, v))
    # Defaults are deliberately not zero: a zero-cost default is how a caller who forgets gets a
    # flattering answer instead of an obviously wrong one. Same rule as `strategy_eval.CostModel`.
    return {
        "commissionPct": pos("commissionPct", 0.03),
        "slippagePct": pos("slippagePct", 0.05),
        "spreadPct": pos("spreadPct", 0.02),
    }


def _normalise_sweep(sweep: dict, blocks: list) -> tuple:
    """
    A sweep is `{"<blockIndex>.<param>": [values]}`.

    Indexed rather than keyed by block id, because the same block can appear twice with different
    settings and a sweep must be able to address one of them.
    """
    out: dict = {}
    errors: list = []
    for key, values in (sweep or {}).items():
        parts = str(key).split(".")
        if len(parts) != 2:
            errors.append(f"Sweep key {key!r} should look like '0.fast'.")
            continue
        try:
            idx = int(parts[0])
        except ValueError:
            errors.append(f"Sweep key {key!r} has a non-numeric block index.")
            continue
        if idx < 0 or idx >= len(blocks):
            errors.append(f"Sweep key {key!r} points at block {idx}, which is not in this strategy.")
            continue
        pname = parts[1]
        bid = blocks[idx]["id"]
        pspec = BLOCKS[bid]["params"].get(pname)
        if pspec is None:
            errors.append(f"{BLOCKS[bid]['label']} has no parameter {pname!r}.")
            continue
        if not isinstance(values, (list, tuple)) or len(values) == 0:
            errors.append(f"Sweep {key!r} needs a non-empty list of values.")
            continue
        coerced = []
        for v in values:
            try:
                cv = _coerce_param(pspec, v)
            except (TypeError, ValueError):
                continue
            if cv not in coerced:
                coerced.append(cv)
        if not coerced:
            errors.append(f"Sweep {key!r} had no usable values.")
            continue
        out[f"{idx}.{pname}"] = coerced
    return (out, errors)


def count_trials(sweep: dict) -> int:
    """
    How many variants a sweep describes.

    THIS IS THE MOST IMPORTANT NUMBER IN THE WHOLE FEATURE. `strategy_eval` raises the bar a result
    must clear in proportion to it, so it is computed from the spec rather than asserted by a caller —
    a trial count master could type would be a trial count he could understate.
    """
    total = 1
    for values in (sweep or {}).values():
        total *= max(1, len(values))
    return total


def expand_sweep(spec: dict) -> list:
    """Every variant the sweep describes, as fully-formed specs. Deterministic order."""
    sweep = spec.get("sweep") or {}
    if not sweep:
        return [spec]
    keys = sorted(sweep.keys())
    out = []
    for combo in itertools.product(*[sweep[k] for k in keys]):
        variant = json.loads(json.dumps(spec))
        variant["sweep"] = {}
        for k, v in zip(keys, combo):
            idx, pname = k.split(".")
            variant["entry"]["blocks"][int(idx)]["params"][pname] = v
        out.append(variant)
    return out


def spec_hash(spec: dict) -> str:
    """A stable identity for a strategy, so a result can be tied to exactly what produced it."""
    payload = json.dumps(spec, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


# ── The interpreter ──────────────────────────────────────────────────────────

def entry_signals(spec: dict, bars: list) -> list:
    """Combine the chosen blocks into one entry array."""
    blocks = spec["entry"]["blocks"]
    op = spec["entry"]["op"]
    k = int(spec["entry"].get("k") or 1)
    if not blocks or not bars:
        return [False] * len(bars)
    arrays = []
    for nb in blocks:
        fn = BLOCKS[nb["id"]]["fn"]
        if fn is None:
            # A non-backtestable block reaching here is a caller bug; `run_spec` refuses first.
            raise ValueError(f"block {nb['id']} cannot be simulated")
        arrays.append(fn(bars, nb["params"]))
    out = [False] * len(bars)
    for i in range(len(bars)):
        hits = sum(1 for a in arrays if a[i])
        if op == "all":
            out[i] = hits == len(arrays)
        elif op == "any":
            out[i] = hits > 0
        else:
            out[i] = hits >= k
    return out


def simulate(spec: dict, bars: list, start: int = 0, end: Optional[int] = None) -> list:
    """
    Walk the bars and return one dict per completed round trip.

    ENTRY IS ON THE NEXT BAR'S OPEN. A signal computed from bar `i`'s close cannot be acted on at that
    close — master sees it after the bar has finished. Filling at the signal bar's close is the most
    common backtest overstatement there is, and on a breakout strategy it is most of the apparent edge.

    A STOP AND A TARGET HIT IN THE SAME BAR RESOLVE AS THE STOP. Bar data cannot say which came first,
    so the pessimistic reading is the only defensible one; the optimistic reading manufactures winners
    in exactly the volatile bars where it matters most.

    ONE POSITION AT A TIME. Overlapping trades need a portfolio model, and `strategy_eval` judges a
    series of independent round trips.
    """
    n = len(bars)
    end = n if end is None else min(end, n)
    sig = entry_signals(spec, bars)
    long_side = spec["side"] == "long"
    stop_pct = spec["exit"]["stopPct"]
    target_pct = spec["exit"]["targetPct"]
    max_bars = int(spec["exit"].get("maxBars") or 0)

    trades = []
    i = max(1, start)
    while i < end:
        if not sig[i - 1]:
            i += 1
            continue
        entry_price = float(bars[i]["open"])
        if entry_price <= 0:
            i += 1
            continue
        stop_price = (entry_price * (1 - stop_pct / 100.0) if long_side
                      else entry_price * (1 + stop_pct / 100.0)) if stop_pct else None
        target_price = (entry_price * (1 + target_pct / 100.0) if long_side
                        else entry_price * (1 - target_pct / 100.0)) if target_pct else None

        exit_idx = None
        exit_price = None
        why = None
        j = i
        while j < end:
            hi = float(bars[j]["high"])
            lo = float(bars[j]["low"])
            hit_stop = stop_price is not None and (lo <= stop_price if long_side else hi >= stop_price)
            hit_target = (target_price is not None
                          and (hi >= target_price if long_side else lo <= target_price))
            if hit_stop:
                exit_idx, exit_price, why = j, stop_price, "stop"
                break
            if hit_target:
                exit_idx, exit_price, why = j, target_price, "target"
                break
            if max_bars and (j - i + 1) >= max_bars:
                exit_idx, exit_price, why = j, float(bars[j]["close"]), "time"
                break
            j += 1
        if exit_idx is None:
            # Still open at the end of the window. NOT counted: an unclosed trade has no realised
            # return, and marking it to the last close would let the final open position decide the
            # verdict.
            break

        gross = ((exit_price - entry_price) / entry_price * 100.0 if long_side
                 else (entry_price - exit_price) / entry_price * 100.0)
        trades.append({
            "entryIndex": i, "exitIndex": exit_idx,
            "entryDate": str(bars[i].get("date") or ""), "exitDate": str(bars[exit_idx].get("date") or ""),
            "entryPrice": entry_price, "exitPrice": exit_price,
            "bars": exit_idx - i + 1, "grossPct": gross, "exitReason": why,
        })
        i = exit_idx + 1
    return trades


def position_size(spec, entry_price):
    """
    How many units. Risk amount divided by the distance to the stop, so the loss on a stopped trade is
    the same whatever the instrument costs.

    RETURNS 0 WHEN THERE IS NO STOP. Size without a stop is not a risk decision — there is no distance
    to divide by — and inventing one (a fixed fraction of capital, say) would report a risk figure that
    the strategy does not actually enforce.
    """
    stop_pct = spec["exit"]["stopPct"]
    if not stop_pct or entry_price <= 0:
        return 0
    risk_amount = spec["sizing"]["capital"] * spec["sizing"]["riskPct"] / 100.0
    per_unit = entry_price * stop_pct / 100.0
    if per_unit <= 0:
        return 0
    return int(risk_amount // per_unit)


def money_summary(spec: dict, trades: list, round_trip_pct: float) -> dict:
    """
    The outcome in master's own currency — what he asked for as "investment, ROI, risk".

    ROI IS AN OUTPUT, NEVER AN INPUT (Section 103). A field that accepts a target return and then
    produces a strategy meeting it is the commonest way a strategy tool lies: the search simply keeps
    going until something in the noise clears the bar. So capital and risk go in, and this comes out.

    Position sizing is NOT compounded into the risk: each trade risks the stated percentage of the
    ORIGINAL capital, not of the running equity. Compounding the risk makes a good run look
    exponential and a bad one bottomless, and neither is what master would actually do.
    """
    capital = float(spec["sizing"]["capital"])
    if capital <= 0:
        return {"ok": False, "reason": "no capital recorded"}
    equity = capital
    peak = capital
    worst = 0.0
    sized = 0
    unsized = 0
    rows = []
    for t in trades:
        units = position_size(spec, t["entryPrice"])
        net_pct = t["grossPct"] - round_trip_pct
        if units <= 0:
            unsized += 1
            pnl = 0.0
        else:
            sized += 1
            pnl = units * t["entryPrice"] * net_pct / 100.0
        equity += pnl
        peak = max(peak, equity)
        if peak > 0:
            worst = max(worst, (peak - equity) / peak)
        rows.append({
            "entryDate": t["entryDate"], "exitDate": t["exitDate"], "units": units,
            "netPct": net_pct, "pnl": pnl, "exitReason": t["exitReason"], "bars": t["bars"],
        })
    return {
        "ok": True,
        "capital": capital,
        "finalEquity": equity,
        "netPnl": equity - capital,
        "roiPct": (equity - capital) / capital * 100.0,
        "maxDrawdownPct": worst * 100.0,
        "sizedTrades": sized,
        # Reported, not hidden: a strategy with no stop cannot be sized, so its ROI would be zero and
        # look like a flat result rather than an unanswerable question.
        "unsizedTrades": unsized,
        "note": ("Every trade risks the stated percentage of the ORIGINAL capital, not of the running "
                 "equity. Compounding the risk makes a good run look exponential and a bad one "
                 "bottomless."
                 + ("" if unsized == 0 else
                    f" {unsized} trades could not be sized because the strategy has no stop, so they "
                    "contribute nothing to this figure.")),
        "trades": rows,
    }


def run_spec(spec: dict, bars: list, *, start: int = 0, end: Optional[int] = None) -> dict:
    """
    Simulate one spec. Refuses anything it cannot honestly measure.

    @returns `{ok, trades, returns, reason}` — `returns` is the gross per-trade percentage series,
             ready for `strategy_eval.evaluate`, which applies the costs.
    """
    v = validate_spec(spec)
    if not v["ok"]:
        return {"ok": False, "reason": "; ".join(v["errors"]), "trades": [], "returns": []}
    if v["blocked"]:
        names = ", ".join(b["label"] for b in v["blocked"])
        return {
            "ok": False,
            "reason": f"cannot be backtested because of: {names}",
            "blocked": v["blocked"],
            "trades": [], "returns": [],
        }
    trades = simulate(v["spec"], bars, start, end)
    return {
        "ok": True, "trades": trades,
        "returns": [t["grossPct"] for t in trades],
        "spec": v["spec"], "specHash": v["specHash"],
    }
