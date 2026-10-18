"""
synthetic_bars.py - price series with KNOWN properties, for testing the strategy factory (spec Section 151).

A strategy generator can only be tested against truth it was not told. So the series here have a ground truth
the factory has no access to:

  noise_series      a driftless random walk. There is NO edge, so anything the factory stores from it is a
                    false positive, and that rate is the number that matters.
  trend_series      alternating drifting regimes with persistence. A breakout/trend rule has a real edge here.
  reversion_series  a mean-reverting series. A band-touch rule has a real edge here.
  decayed(series)   the first part has the edge, the rest is noise: what a strategy that STOPS working looks
                    like to a forward test.

Stdlib only and deterministic from `seed`. Bars are dicts with ISO dates, one per calendar day, so the day-of-week
and clock blocks behave as they do on real data.
"""

from __future__ import annotations

import datetime as _dt
import math
import random


def _to_bars(closes: list, rng: random.Random, start: str = "2015-01-01", wick: float = 0.004) -> list:
    d0 = _dt.date.fromisoformat(start)
    bars, prev = [], closes[0]
    for i, c in enumerate(closes):
        o = prev * (1 + rng.gauss(0, 0.001))                 # a small overnight gap
        hi = max(o, c) * (1 + abs(rng.gauss(0, wick)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, wick)))
        day = d0 + _dt.timedelta(days=i)
        bars.append({"date": day.isoformat(), "open": o, "high": hi, "low": lo, "close": c,
                     # Heavy-tailed, as real volume is: a lognormal, so a "2x its average" surge happens.
                     "volume": 100000.0 * math.exp(rng.gauss(0.0, 0.55))})
        prev = c
    return bars


def noise_series(n: int = 1500, seed: int = 1, vol: float = 0.012) -> list:
    rng = random.Random(seed)
    price, closes = 100.0, []
    for _ in range(n):
        price *= math.exp(rng.gauss(0.0, vol))
        closes.append(price)
    return _to_bars(closes, rng)


def trend_series(n: int = 1500, seed: int = 1, vol: float = 0.010, drift: float = 0.0035,
                 regime_len: int = 90, persistence: float = 0.85) -> list:
    """Regimes that last: each day's drift sign tends to stay, so a breakout is followed through."""
    rng = random.Random(seed)
    price, closes, sign, left = 100.0, [], 1, regime_len
    for _ in range(n):
        left -= 1
        if left <= 0:
            sign = 1 if rng.random() < 0.5 else -1
            left = int(regime_len * (0.6 + rng.random() * 0.8))
        step = rng.gauss(drift * sign, vol)
        price *= math.exp(step)
        closes.append(price)
    return _to_bars(closes, rng)


def reversion_series(n: int = 1500, seed: int = 1, vol: float = 0.011, pull: float = 0.18) -> list:
    """An Ornstein-Uhlenbeck log price: stretched prices are pulled back toward the mean."""
    rng = random.Random(seed)
    mean = math.log(100.0)
    x, closes = mean, []
    for _ in range(n):
        x += pull * (mean - x) + rng.gauss(0.0, vol)
        closes.append(math.exp(x))
    return _to_bars(closes, rng)


def decayed(good: list, noise: list, keep: int) -> list:
    """`good[:keep]` then `noise` re-based to continue from where `good` ended, with dates continuing."""
    head = [dict(b) for b in good[:keep]]
    if not head:
        return [dict(b) for b in noise]
    scale = head[-1]["close"] / noise[0]["close"]
    d0 = _dt.date.fromisoformat(head[-1]["date"])
    tail = []
    for i, b in enumerate(noise, start=1):
        tail.append({
            "date": (d0 + _dt.timedelta(days=i)).isoformat(),
            "open": b["open"] * scale, "high": b["high"] * scale, "low": b["low"] * scale,
            "close": b["close"] * scale, "volume": b["volume"],
        })
    return head + tail
