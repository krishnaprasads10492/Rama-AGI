"""
The projection cone and the risk ruler (spec Section 78).

A forecast drawn on a chart is the most persuasive object a trading tool can produce, so the
shape matters more than the numbers.

A CONE, NEVER A PATH. A single predicted price line implies Rāma knows the path. It does not know
the path even with a good model, and no model here has cleared the gate — a line would be the
chart-shaped version of the failure Section 76 exists to prevent.

THE WIDTH OF THE CONE IS MEASURED. THE TILT OF ITS CENTRE IS THE MODEL'S. That split is the whole
design. Width comes from realised volatility over stored bars, which is a fact. The centre stays
flat unless a model is entitled to tilt it, and a gate-refused model tilts it by nothing at all
while the payload says so.

THE RISK RULER is the part worth more than the cone. Once ordinary volatility is known:
  - a stop inside one bar's normal range will be hit by noise rather than by being wrong
  - a target inside 1σ of the horizon is a move needing no edge at all
Both are arithmetic over stored bars, so both are actionable today with no model involved.
"""

import datetime as _dt
import logging
import math
from typing import Optional

import numpy as np
import pandas as pd

from . import store

logger = logging.getLogger("stockmind.projection")

# Enough returns for a standard deviation to mean something, without reaching so far back that
# it averages across regimes that no longer exist.
DEFAULT_LOOKBACK = 120
MIN_LOOKBACK = 30

# sqrt(h) growth means a 200-bar cone says only "anything can happen" — true and useless.
MAX_BARS_AHEAD = 40

# A stop closer than this many one-bar sigmas is inside ordinary noise.
STOP_NOISE_SIGMAS = 1.0

# Sigma multiples the cone draws.
BANDS = (1.0, 2.0)


def _now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def volatility(symbol: str, exchange: str = "NSE", interval: str = "1d",
               lookback: int = DEFAULT_LOOKBACK) -> dict:
    """
    Realised volatility of the stored bars, measured on the interval being projected.

    SIGMA IS MEASURED ON THE SAME INTERVAL. Scaling a daily sigma down to hours by dividing by
    √7 would assume intraday variance is spread evenly across the session, which is false — the
    open and the close carry most of it. Measuring directly makes that a non-issue.

    Both sigma (log returns) and ATR are returned. Sigma is the right input for √h scaling; ATR
    is what a trader reads a stop against. They are allowed to disagree, and the disagreement is
    informative: ATR much larger than sigma means wide intraday ranges that close near the open.
    """
    out = {"symbol": str(symbol or "").upper(), "interval": interval,
           "sigmaPct": None, "sigmaAbs": None, "atrPct": None, "atrAbs": None,
           "lastClose": None, "asOf": None, "rows": 0, "lookback": lookback,
           "ok": False, "reason": None}
    try:
        df = store.load(symbol, exchange, interval)
    except Exception as e:
        out["reason"] = f"could not read stored bars: {type(e).__name__}: {e}"
        return out
    if df is None or "close" not in df.columns:
        out["reason"] = f"no stored {interval} bars for {symbol} — sync first"
        return out

    d = df.dropna(subset=["close"]).copy()
    out["rows"] = int(len(d))
    if len(d) < MIN_LOOKBACK + 1:
        out["reason"] = (f"need at least {MIN_LOOKBACK + 1} {interval} bars to measure "
                         f"volatility, have {len(d)}")
        return out

    tail = d.tail(max(MIN_LOOKBACK, lookback) + 1)
    close = tail["close"].astype(float)
    out["lastClose"] = float(close.iloc[-1])
    out["asOf"] = str(tail["date"].iloc[-1])

    logret = np.diff(np.log(close.to_numpy()))
    logret = logret[np.isfinite(logret)]
    if len(logret) < MIN_LOOKBACK:
        out["reason"] = f"only {len(logret)} usable returns"
        return out

    sigma = float(np.std(logret, ddof=1))
    out["sigmaPct"] = round(sigma * 100, 4)
    out["sigmaAbs"] = round(sigma * out["lastClose"], 4)
    out["returnsUsed"] = int(len(logret))

    if {"high", "low"}.issubset(tail.columns):
        hi = tail["high"].astype(float).to_numpy()
        lo = tail["low"].astype(float).to_numpy()
        pc = close.shift(1).to_numpy()
        tr = np.nanmax(np.vstack([hi - lo, np.abs(hi - pc), np.abs(lo - pc)]), axis=0)
        tr = tr[np.isfinite(tr)]
        if len(tr) >= 14:
            atr = float(np.mean(tr[-14:]))
            out["atrAbs"] = round(atr, 4)
            out["atrPct"] = round(atr / out["lastClose"] * 100, 4)

    out["ok"] = True
    return out


def _forward_times(dates: pd.Series, n: int, interval: str) -> list[str]:
    """
    Where the projected bars sit in time.

    FROM THE OBSERVED BAR SPACING, not a calendar assumption. Hardcoding "one day" would put a
    daily cone on Saturdays and an hourly cone in the middle of the night. The median gap between
    recent stored bars reproduces whatever rhythm the series actually has.
    """
    try:
        ts = pd.to_datetime(dates.astype(str), errors="coerce").dropna()
    except Exception:
        return []
    if len(ts) < 3:
        return []
    deltas = ts.diff().dropna()
    if len(deltas) == 0:
        return []
    # Median over recent gaps, ignoring the weekend-sized outliers that would inflate a mean.
    step = deltas.tail(40).median()
    if pd.isna(step) or step <= pd.Timedelta(0):
        step = pd.Timedelta(days=1)

    intraday = store.is_intraday(interval)
    last = ts.iloc[-1]
    out = []
    cursor = last
    for _ in range(n):
        cursor = cursor + step
        if not intraday:
            # Daily bars: keep the cone on business days.
            while cursor.weekday() >= 5:
                cursor = cursor + pd.Timedelta(days=1)
            out.append(cursor.strftime("%Y-%m-%d"))
        else:
            out.append(cursor.strftime("%Y-%m-%d %H:%M:%S"))
    return out


def project(symbol: str, exchange: str = "NSE", interval: str = "1d",
            bars_ahead: int = 5, probability: Optional[float] = None,
            entitled: bool = False, lookback: int = DEFAULT_LOOKBACK) -> dict:
    """
    The forward cone.

    `probability` tilts the centre ONLY when `entitled` is True. A gate-refused model tilts it by
    nothing, and `tilted: false` plus `tiltReason` say so — the cone still draws, correctly, from
    measured volatility alone.
    """
    n = max(1, min(int(bars_ahead or 1), MAX_BARS_AHEAD))
    vol = volatility(symbol, exchange, interval, lookback)
    out = {"symbol": vol["symbol"], "interval": interval, "barsAhead": n,
           "capped": int(bars_ahead or 0) > MAX_BARS_AHEAD,
           "maxBarsAhead": MAX_BARS_AHEAD,
           "volatility": vol, "points": [], "anchor": None,
           "tilted": False, "tiltReason": None, "probability": probability,
           "bands": list(BANDS), "ok": False, "reason": None,
           "generatedAt": _now()}
    if not vol["ok"]:
        out["reason"] = vol["reason"]
        return out

    df = store.load(symbol, exchange, interval)
    d = df.dropna(subset=["close"])
    times = _forward_times(d["date"], n, interval)
    if not times:
        out["reason"] = "could not place the projection in time from the stored bar spacing"
        return out

    last = vol["lastClose"]
    sigma = vol["sigmaPct"] / 100.0
    out["anchor"] = {"time": str(d["date"].iloc[-1]), "price": round(last, 4)}

    # THE TILT. Only an entitled model moves the centre, and even then it moves it by the model's
    # own edge over 50/50 scaled by one horizon-sigma — not by an invented target.
    drift_total = 0.0
    if probability is not None and entitled:
        try:
            edge = (float(probability) - 0.5) * 2.0     # -1 .. +1
            drift_total = edge * sigma * math.sqrt(n)
            out["tilted"] = True
            out["tiltReason"] = (f"centre tilted by the model's edge over even money "
                                 f"({edge:+.3f}) scaled by one horizon-sigma")
        except (TypeError, ValueError):
            drift_total = 0.0
    elif probability is not None:
        out["tiltReason"] = ("centre left FLAT — this horizon's model has not cleared the gate, "
                             "so its direction is not allowed to move the projection. The width "
                             "below is measured volatility and is unaffected by that.")
    else:
        out["tiltReason"] = "centre flat — no model probability supplied"

    for i, t in enumerate(times, start=1):
        s = sigma * math.sqrt(i)
        drift = drift_total * (i / n)
        mid = last * math.exp(drift)
        pt = {"time": t, "bar": i, "mid": round(mid, 4),
              "sigmaPct": round(s * 100, 4)}
        for band in BANDS:
            pt[f"upper{int(band)}"] = round(mid * math.exp(band * s), 4)
            pt[f"lower{int(band)}"] = round(mid * math.exp(-band * s), 4)
        out["points"].append(pt)

    final = out["points"][-1]
    out["summary"] = {
        "horizonSigmaPct": final["sigmaPct"],
        "ordinaryRange": [final["lower1"], final["upper1"]],
        "wideRange": [final["lower2"], final["upper2"]],
        "centre": final["mid"],
        "text": (f"Over {n} {interval} bars, ordinary movement for this instrument spans "
                 f"{final['lower1']:,.2f} to {final['upper1']:,.2f} "
                 f"(±1σ = {final['sigmaPct']:.2f}%). Two thirds of outcomes historically land "
                 f"inside that."),
    }
    out["ok"] = True
    return out


def assess_levels(symbol: str, exchange: str = "NSE", interval: str = "1d",
                  stop: Optional[float] = None, target: Optional[float] = None,
                  bars_ahead: int = 5, entry: Optional[float] = None,
                  lookback: int = DEFAULT_LOOKBACK) -> dict:
    """
    THE RISK RULER. Are master's own levels inside ordinary noise?

    A stop within one bar's ordinary range will be hit by noise rather than by the thesis being
    wrong. A target within 1σ of the horizon is a move the instrument makes anyway, so the thesis
    is not what would produce the profit even if the trade works.

    Arithmetic over stored bars — no model, so this is usable today.
    """
    vol = volatility(symbol, exchange, interval, lookback)
    out = {"symbol": vol["symbol"], "interval": interval, "ok": False, "reason": None,
           "volatility": vol, "stop": None, "target": None, "rewardRisk": None,
           "notes": [], "generatedAt": _now()}
    if not vol["ok"]:
        out["reason"] = vol["reason"]
        return out

    n = max(1, min(int(bars_ahead or 1), MAX_BARS_AHEAD))
    ref = float(entry) if entry else vol["lastClose"]
    sigma_bar = vol["sigmaPct"] / 100.0 * ref
    sigma_h = sigma_bar * math.sqrt(n)
    out["referencePrice"] = round(ref, 4)
    out["sigmaOneBar"] = round(sigma_bar, 4)
    out["sigmaHorizon"] = round(sigma_h, 4)

    if stop is not None:
        try:
            dist = abs(ref - float(stop))
            bars_of_noise = dist / sigma_bar if sigma_bar > 0 else None
            inside = bars_of_noise is not None and bars_of_noise < STOP_NOISE_SIGMAS
            out["stop"] = {
                "price": round(float(stop), 4),
                "distance": round(dist, 4),
                "distancePct": round(dist / ref * 100, 3),
                "barsOfNoise": round(bars_of_noise, 3) if bars_of_noise is not None else None,
                "insideNoise": bool(inside),
                "verdict": (
                    f"This stop is {bars_of_noise:.2f} of one bar's ordinary movement away. "
                    "A single normal session can take it out, so it will most likely be hit "
                    "because the market moved, not because your thesis was wrong."
                    if inside else
                    f"This stop is {bars_of_noise:.2f} ordinary bar-moves away, so it sits "
                    "outside single-session noise."
                ) if bars_of_noise is not None else "volatility could not be measured",
            }
            if inside:
                out["notes"].append("stop is inside one bar of ordinary noise")
        except (TypeError, ValueError):
            pass

    if target is not None:
        try:
            dist = abs(float(target) - ref)
            in_sigmas = dist / sigma_h if sigma_h > 0 else None
            unremarkable = in_sigmas is not None and in_sigmas <= 1.0
            out["target"] = {
                "price": round(float(target), 4),
                "distance": round(dist, 4),
                "distancePct": round(dist / ref * 100, 3),
                "horizonSigmas": round(in_sigmas, 3) if in_sigmas is not None else None,
                "insideNoise": bool(unremarkable),
                "verdict": (
                    f"This target is {in_sigmas:.2f} horizon-sigmas away — inside what this "
                    "instrument does anyway over that span. Reaching it needs no edge, so the "
                    "thesis is not what would be producing the gain."
                    if unremarkable else
                    f"This target is {in_sigmas:.2f} horizon-sigmas away, so it requires a move "
                    "larger than ordinary volatility supplies."
                ) if in_sigmas is not None else "volatility could not be measured",
            }
            if unremarkable:
                out["notes"].append("target is inside ordinary volatility for the horizon")
        except (TypeError, ValueError):
            pass

    if out["stop"] and out["target"] and out["stop"]["distance"] > 0:
        rr = out["target"]["distance"] / out["stop"]["distance"]
        out["rewardRisk"] = round(rr, 3)
        out["notes"].append(
            f"reward-to-risk {rr:.2f}:1 against your own levels"
            + ("" if rr >= 1.5 else " — under 1.5:1 the win rate has to be high to profit"))

    out["ok"] = True
    return out


def forecast(symbol: str, exchange: str = "NSE", horizon: str = "swing",
             probability: Optional[float] = None, stop: Optional[float] = None,
             target: Optional[float] = None, entry: Optional[float] = None,
             lookback: int = DEFAULT_LOOKBACK) -> dict:
    """
    The composed call the chart uses: cone plus risk ruler for one named horizon.

    Entitlement is read from the training record, not assumed — the same source Section 75 uses,
    so the chart and the alerts cannot disagree about whether a model may speak.
    """
    from .alerts import model_entitlement
    from . import horizons as _h

    h = _h.get(horizon)
    if h is None:
        return {"ok": False, "reason": f"unknown horizon {horizon!r}",
                "horizons": list(_h.HORIZONS)}
    ent = model_entitlement(h.name)

    cone = project(symbol, exchange, h.interval, h.bars, probability,
                   bool(ent.get("entitled")), lookback)
    ruler = assess_levels(symbol, exchange, h.interval, stop, target, h.bars, entry, lookback)

    return {
        "symbol": str(symbol or "").upper(), "exchange": exchange,
        "horizon": h.describe(), "entitlement": ent,
        "cone": cone, "risk": ruler,
        "caveat": (
            "The WIDTH of this cone is measured from this instrument's own volatility and is a "
            "fact. Its centre is flat because no model has cleared the gate for this horizon, so "
            "no direction is being claimed."
            if not ent.get("entitled") else
            "The width of this cone is measured volatility. Its centre is tilted by a model that "
            "cleared the gate, which is evidence but not certainty."
        ),
        "generatedAt": _now(),
    }
