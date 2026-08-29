"""
Justification and capital-protection warnings (spec Section 76).

THE TRAP THIS MODULE IS BUILT TO AVOID. "Justify the prediction" is a dangerous instruction to
follow literally when the prediction has not earned trust. Section 73 measured that no horizon
clears the gate. A list of supportive-sounding technical observations printed under an ungated
probability is the most harmful thing in this codebase: it makes a coin flip look researched.
The observations would all be true, the probability would be worthless, and putting them
together would imply the first supports the second.

So every bullet carries a `basis`, and they are never merged:

  observation  a measured fact             "RSI(14) is 72.4"
  convention   how the market reads it     "above 70 is conventionally read as overbought"
  forecast     a model's output            "P(up over 5 bars) = 0.58"
  gate         whether it may be believed  "the swing model has not cleared the gate"

"RSI is 72.4" is a fact. "RSI is 72.4 therefore it will fall" is a claim StockMind has not
earned. Bullets like "Overbought — expect a pullback" are refused: that reads as analysis and is
an untested assertion wearing analysis's clothes.

Evidence classes are REUSED FROM alerts.py, not reinvented. A reader who learned what MEASURED
means on an alert must not have to learn a second scale here.

A CHECK THAT COULD NOT RUN PRODUCES A WARNING SAYING SO. An empty warning list must mean
"checked and clear", never "could not look".
"""

import datetime as _dt
import logging
from typing import Optional

import numpy as np
import pandas as pd

from . import store
from .alerts import DECLARED, MEASURED, MODEL, CRITICAL, WARNING, INFO, model_entitlement

logger = logging.getLogger("stockmind.explain")

# ── Bullet bases ─────────────────────────────────────────────────────────────
OBSERVATION = "observation"
CONVENTION = "convention"
FORECAST = "forecast"
GATE = "gate"

# ── Thresholds, each with the reason it holds its value ──────────────────────

# Two sessions or fewer to expiry: gamma and pinning dominate, and a directional view stops
# being the thing that decides the outcome.
EXPIRY_IMMINENT_DAYS = 2
EXPIRY_PINNING_DAYS = 5

# Spot within 1% of max pain, with open interest concentrated in few strikes, is the classic
# pinning setup — writers are defending a level.
PINNING_DIST_PCT = 1.0
PINNING_CONCENTRATION = 0.15

# PCR beyond these is crowded positioning by convention. Not a validated signal.
PCR_HIGH = 1.6
PCR_LOW = 0.6

# A straddle above ~4% of spot means the option market is pricing a large move — usually an
# event. Selling premium into it, or buying direction, are both different trades than intended.
STRADDLE_WIDE_PCT = 4.0

# Futures more than 1% from spot is a financing or sentiment dislocation worth naming.
BASIS_DISLOCATION_PCT = 1.0

# Below 30% rollover into a new series, the prior positioning is being abandoned.
WEAK_ROLLOVER_PCT = 30.0

# Under 25% delivery, a move is dominated by intraday churn rather than accumulation.
LOW_DELIVERY_PCT = 25.0

# Recent volume under 60% of its own longer average makes exits expensive.
ILLIQUID_RATIO = 0.60
VOLUME_LOOKBACK = 20
VOLUME_BASELINE = 100

# A gap above 1.5% on more than a fifth of recent sessions means stops do not protect what
# they appear to protect.
GAP_PCT = 1.5
GAP_FREQUENCY = 0.20
GAP_LOOKBACK = 60

# Positions correlated above this move together, so they are one bet wearing two names.
CORRELATION_HIGH = 0.70
CORRELATION_LOOKBACK = 120
CORRELATION_MIN_ROWS = 40

# Derivative metrics older than this cannot support a warning about today.
DERIV_MAX_AGE_DAYS = 5

# Above this, the model's own uncertainty says it does not know.
UNCERTAINTY_HIGH = 0.60


def _now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def _bullet(text, evidence, basis, field=None, value=None) -> dict:
    return {"text": text, "evidence": evidence, "basis": basis,
            "field": field, "value": value}


def _warn(kind, severity, headline, detail, evidence=MEASURED, field=None,
          value=None, checked=True) -> dict:
    return {"kind": kind, "severity": severity, "headline": headline, "detail": detail,
            "evidence": evidence, "field": field, "value": value,
            # False means "this check could not run", which is different from "clear".
            "checked": bool(checked)}


# ── Correlation, measured rather than assumed from a sector table ────────────

def correlations(symbols: list, exchange: str = "NSE",
                 lookback: int = CORRELATION_LOOKBACK) -> dict:
    """
    Pairwise correlation of daily returns, from stored bars.

    NO SECTOR TABLE. A hardcoded symbol→sector map would be my guess, would rot, and would miss
    the real case: an index and one of its own heavyweight constituents are correlated by
    construction, not by sector label. Measured returns catch that, and master can check the
    number against the same bars.
    """
    out = {"pairs": [], "insufficient": [], "lookback": lookback}
    series = {}
    for s in sorted(set(symbols or [])):
        try:
            df = store.load(s, exchange, "1d")
        except Exception:
            df = None
        if df is None or len(df) < CORRELATION_MIN_ROWS or "close" not in df.columns:
            out["insufficient"].append(
                {"symbol": s, "rows": 0 if df is None else int(len(df)),
                 "need": CORRELATION_MIN_ROWS})
            continue
        d = df.dropna(subset=["close"]).tail(lookback).copy()
        d["_d"] = d["date"].astype(str).str.slice(0, 10)
        r = d[["_d", "close"]].set_index("_d")["close"].pct_change().dropna()
        if len(r) < CORRELATION_MIN_ROWS - 1:
            out["insufficient"].append({"symbol": s, "rows": int(len(r)),
                                        "need": CORRELATION_MIN_ROWS})
            continue
        series[s] = r

    names = sorted(series)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = series[names[i]], series[names[j]]
            joined = pd.concat([a, b], axis=1, join="inner").dropna()
            if len(joined) < CORRELATION_MIN_ROWS - 1:
                out["insufficient"].append({"symbol": f"{names[i]}+{names[j]}",
                                            "rows": int(len(joined)),
                                            "need": CORRELATION_MIN_ROWS})
                continue
            try:
                c = float(np.corrcoef(joined.iloc[:, 0], joined.iloc[:, 1])[0, 1])
            except Exception:
                continue
            if c != c:
                continue
            out["pairs"].append({"a": names[i], "b": names[j],
                                 "correlation": round(c, 4),
                                 "overlappingSessions": int(len(joined))})
    out["pairs"].sort(key=lambda p: -abs(p["correlation"]))
    return out


# ── Observations from stored bars ─────────────────────────────────────────────

def _price_observations(symbol: str, exchange: str, interval: str = "1d") -> list[dict]:
    """
    Facts about the stored bars. Each stated as a fact; the conventional reading, where one
    exists, is a SEPARATE bullet marked as convention.
    """
    out = []
    try:
        df = store.load(symbol, exchange, interval)
    except Exception as e:
        return [_bullet(f"Stored bars for {symbol} could not be read: {type(e).__name__}",
                        MEASURED, OBSERVATION)]
    if df is None or len(df) < 30:
        return [_bullet(
            f"Only {0 if df is None else len(df)} stored {interval} bars for {symbol} — too few "
            "to observe anything about trend or momentum. Sync before relying on this.",
            MEASURED, OBSERVATION, "bars", 0 if df is None else int(len(df)))]

    d = df.dropna(subset=["close"])
    close = d["close"].astype(float)
    last = float(close.iloc[-1])
    as_of = str(d["date"].iloc[-1])[:10]

    out.append(_bullet(f"Last stored close is {last:,.2f} on {as_of}, from "
                       f"{len(d):,} {interval} bars.",
                       MEASURED, OBSERVATION, "close", round(last, 2)))

    for win in (20, 50, 200):
        if len(close) >= win:
            ma = float(close.tail(win).mean())
            side = "above" if last >= ma else "below"
            out.append(_bullet(
                f"Price is {side} its {win}-bar average ({ma:,.2f}), by "
                f"{abs(last - ma) / ma * 100:.1f}%.",
                MEASURED, OBSERVATION, f"ma{win}", round(ma, 2)))

    if len(close) >= 15:
        diff = close.diff().dropna()
        gain = float(diff.clip(lower=0).tail(14).mean())
        loss = float((-diff.clip(upper=0)).tail(14).mean())
        # A WINDOW WITH NO DOWN-BARS IS RSI 100, NOT "NO RSI". Guarding only on `loss > 0`
        # skipped the indicator entirely on a strongly trending instrument — which is precisely
        # when the overbought reading is worth showing master.
        rsi = None
        if loss > 0:
            rsi = 100 - (100 / (1 + gain / loss))
        elif gain > 0:
            rsi = 100.0
        elif gain == 0:
            rsi = 50.0
        if rsi is not None:
            out.append(_bullet(f"RSI(14) is {rsi:.1f}.", MEASURED, OBSERVATION,
                               "rsi14", round(float(rsi), 2)))
            if rsi >= 70:
                out.append(_bullet(
                    "Above 70 is conventionally read as overbought. That is a convention, "
                    "not a measured edge in this data.",
                    MEASURED, CONVENTION, "rsi14", round(float(rsi), 2)))
            elif rsi <= 30:
                out.append(_bullet(
                    "Below 30 is conventionally read as oversold. That is a convention, "
                    "not a measured edge in this data.",
                    MEASURED, CONVENTION, "rsi14", round(float(rsi), 2)))

    for win, label in ((5, "5 bars"), (20, "20 bars")):
        if len(close) > win:
            ret = (last / float(close.iloc[-1 - win]) - 1) * 100
            out.append(_bullet(f"Return over the last {label}: {ret:+.2f}%.",
                               MEASURED, OBSERVATION, f"return{win}", round(float(ret), 2)))

    if len(close) >= 252:
        hi = float(close.tail(252).max())
        lo = float(close.tail(252).min())
        out.append(_bullet(
            f"{(last - lo) / (hi - lo) * 100:.0f}% of the way up its 252-bar range "
            f"({lo:,.2f} to {hi:,.2f}).",
            MEASURED, OBSERVATION, "rangePosition",
            round((last - lo) / (hi - lo) * 100, 1) if hi > lo else None))

    if len(d) >= 20 and "high" in d.columns and "low" in d.columns:
        tr = (d["high"].astype(float) - d["low"].astype(float)).tail(14).mean()
        if last:
            out.append(_bullet(
                f"Average daily range over 14 bars is {tr / last * 100:.2f}% of price — "
                "the size of a normal session, which is what a stop has to survive.",
                MEASURED, OBSERVATION, "atrPct", round(float(tr / last * 100), 2)))
    return out


def _model_bullets(prediction: Optional[dict], entitlements: dict) -> list[dict]:
    """
    The forecast, and immediately after it, whether it may be believed.

    THE GATE BULLET COMES FIRST for any horizon that has not cleared it. Printing the
    probability and only later admitting it is unvalidated gets the emphasis exactly backwards.
    """
    out = []
    if not prediction:
        return out
    for name, h in (prediction.get("horizons") or {}).items():
        p = h.get("probability")
        if h.get("error"):
            out.append(_bullet(f"The {name} horizon could not be answered: {h['error']}",
                               MODEL, GATE, f"{name}.error", None))
            continue
        if p is None:
            continue
        ent = entitlements.get(name) or model_entitlement(name)
        if not ent.get("entitled"):
            out.append(_bullet(
                f"The {name} model has NOT cleared the gate — {ent.get('reason')}. "
                f"Treat its number as unproven, and everything measured below as history "
                f"rather than support for it.",
                MODEL, GATE, f"{name}.entitled", False))
        else:
            out.append(_bullet(
                f"The {name} model cleared the gate ({', '.join(ent.get('acceptedModels') or [])}), "
                f"measured on a held-out period it never saw.",
                MODEL, GATE, f"{name}.entitled", True))
        out.append(_bullet(
            f"{name}: P(up over {h.get('bars') or '?'} {h.get('interval')} bars) = {p:.4f}"
            + (f", conviction {h.get('conviction'):.2f}" if h.get("conviction") is not None
               else "") + f", as of {h.get('asOf')}.",
            MODEL, FORECAST, f"{name}.probability", round(float(p), 4)))

    agree = prediction.get("agreement") or {}
    if agree.get("state"):
        out.append(_bullet(
            f"Across horizons: {agree['state']}."
            + (f" {agree['note']}" if agree.get("note") else ""),
            MODEL, FORECAST, "agreement.state", agree["state"]))
    return out


def justify(symbol: str, exchange: str = "NSE", prediction: Optional[dict] = None,
            interval: str = "1d", entitlements: Optional[dict] = None) -> list[dict]:
    """
    Simple bullets explaining what the reading rests on.

    Ordered deliberately: the gate verdict and forecast first (so an unproven number is labelled
    before it is read), then measured observations, then conventions.
    """
    ents = entitlements or {}
    bullets = _model_bullets(prediction, ents)
    bullets.extend(_price_observations(symbol, exchange, interval))
    return bullets


# ── Warnings, pitfalls and traps ─────────────────────────────────────────────

def _deriv_warnings(symbol: str, exchange: str) -> list[dict]:
    """Everything the stored derivative metrics can say about risk today."""
    out = []
    try:
        from . import derivatives
        row = derivatives.latest_metrics(symbol, exchange)
    except Exception as e:
        return [_warn("DERIVATIVES_ABSENT", INFO,
                      "Derivative risk checks could not run",
                      f"Could not read the derivative metrics: {type(e).__name__}: {e}. "
                      "Expiry pinning, PCR, straddle width, basis and rollover were NOT "
                      "checked — this is not a clean bill of health.",
                      field="derivatives", checked=False)]

    if not row:
        return [_warn("DERIVATIVES_ABSENT", INFO,
                      "No derivative data stored for this symbol",
                      "Expiry pinning, PCR, straddle width, basis and rollover were NOT "
                      "checked. Run a derivatives sync to enable them. An empty warning list "
                      "here means 'not looked at', not 'clear'.",
                      field="derivatives", checked=False)]

    as_of = str(row.get("date") or "")[:10]
    age = None
    try:
        age = (_dt.date.today() - _dt.date.fromisoformat(as_of)).days
    except ValueError:
        pass
    if age is not None and age > DERIV_MAX_AGE_DAYS:
        out.append(_warn("DERIVATIVES_STALE", INFO,
                         f"Derivative data is {age} days old",
                         f"The newest stored derivative row is {as_of}. The checks below "
                         "describe that date, not today.",
                         field="date", value=as_of, checked=False))

    dte = row.get("days_to_expiry")
    mpd = row.get("max_pain_dist")
    conc = row.get("oi_concentration")

    if dte is not None and dte <= EXPIRY_IMMINENT_DAYS:
        out.append(_warn("EXPIRY_IMMINENT", CRITICAL,
                         f"{dte:g} sessions to expiry",
                         "This close to expiry, pinning and time decay usually decide the "
                         "outcome rather than direction. A directional view is not the thing "
                         "being expressed by an option position here.",
                         field="days_to_expiry", value=dte))

    if (dte is not None and dte <= EXPIRY_PINNING_DAYS and mpd is not None
            and abs(float(mpd)) * 100 <= PINNING_DIST_PCT
            and conc is not None and float(conc) >= PINNING_CONCENTRATION):
        out.append(_warn("EXPIRY_PINNING", WARNING,
                         "Spot is pinned near max pain with concentrated open interest",
                         f"Spot sits {abs(float(mpd)) * 100:.2f}% from max pain "
                         f"({row.get('max_pain')}) with {dte:g} sessions left and an OI "
                         f"concentration of {float(conc):.3f}. Writers defend that level, so "
                         "moves away from it tend to be sold into. This is a well-known "
                         "market convention, not a measured edge in this data.",
                         field="max_pain_dist", value=mpd))

    pcr = row.get("pcr_oi")
    if pcr is not None:
        pcr = float(pcr)
        if pcr >= PCR_HIGH:
            out.append(_warn("PCR_EXTREME", INFO,
                             f"Put-call ratio is high at {pcr:.2f}",
                             "Conventionally read as crowded put positioning, which can cut "
                             "either way — support from writers, or a squeeze if it unwinds. "
                             "Named because it is unusual, not because it predicts.",
                             field="pcr_oi", value=round(pcr, 4)))
        elif pcr <= PCR_LOW:
            out.append(_warn("PCR_EXTREME", INFO,
                             f"Put-call ratio is low at {pcr:.2f}",
                             "Conventionally read as crowded call positioning. Named because "
                             "it is unusual, not because it predicts.",
                             field="pcr_oi", value=round(pcr, 4)))

    sp = row.get("straddle_pct")
    if sp is not None and float(sp) >= STRADDLE_WIDE_PCT:
        out.append(_warn("WIDE_STRADDLE", WARNING,
                         f"The at-the-money straddle is {float(sp):.2f}% of spot",
                         "The option market is pricing a large move, which usually means an "
                         "event is expected. Buying direction here pays for that expectation; "
                         "selling premium takes the other side of it.",
                         field="straddle_pct", value=round(float(sp), 3)))

    basis = row.get("fut_basis_pct")
    if basis is not None and abs(float(basis)) >= BASIS_DISLOCATION_PCT:
        out.append(_warn("BASIS_DISLOCATION", INFO,
                         f"Futures are {float(basis):+.2f}% from spot",
                         "A basis this wide is a financing or sentiment dislocation. If you "
                         "are trading the future, this is part of your entry price.",
                         field="fut_basis_pct", value=round(float(basis), 4)))

    roll = row.get("rollover_pct")
    if roll is not None and float(roll) < WEAK_ROLLOVER_PCT:
        out.append(_warn("WEAK_ROLLOVER", INFO,
                         f"Rollover is {float(roll):.1f}%",
                         "Positioning is being closed rather than carried into the next "
                         "series, so the prior trend has less committed money behind it.",
                         field="rollover_pct", value=round(float(roll), 3)))
    return out


def _liquidity_warnings(symbol: str, exchange: str, interval: str = "1d") -> list[dict]:
    """Can master actually get out, and do stops mean what they appear to mean?"""
    out = []
    try:
        df = store.load(symbol, exchange, interval)
    except Exception:
        df = None
    if df is None or len(df) < VOLUME_LOOKBACK + 5:
        return [_warn("LIQUIDITY_UNCHECKED", INFO,
                      "Liquidity and gap risk could not be checked",
                      f"Needs at least {VOLUME_LOOKBACK + 5} stored {interval} bars; "
                      f"{0 if df is None else len(df)} are present.",
                      field="bars", checked=False)]

    d = df.dropna(subset=["close"])
    if "volume" in d.columns:
        vol = pd.to_numeric(d["volume"], errors="coerce").dropna()
        if len(vol) >= VOLUME_LOOKBACK + 5:
            recent = float(vol.tail(VOLUME_LOOKBACK).mean())
            base = float(vol.tail(VOLUME_BASELINE).mean())
            if base > 0 and recent / base < ILLIQUID_RATIO:
                out.append(_warn("ILLIQUID", WARNING,
                                 f"Recent volume is {recent / base * 100:.0f}% of its longer "
                                 f"average",
                                 "Thinner trade means a wider spread and worse fills on the "
                                 "way out. An exit plan that assumes today's liquidity may not "
                                 "hold when it is needed.",
                                 field="volumeRatio", value=round(recent / base, 3)))

    if {"open", "close"}.issubset(d.columns) and len(d) >= 20:
        tail = d.tail(GAP_LOOKBACK)
        prev_close = tail["close"].astype(float).shift(1)
        gap = ((tail["open"].astype(float) - prev_close).abs() / prev_close * 100).dropna()
        if len(gap) >= 20:
            freq = float((gap >= GAP_PCT).mean())
            if freq >= GAP_FREQUENCY:
                out.append(_warn("GAP_RISK", WARNING,
                                 f"{freq * 100:.0f}% of recent sessions opened more than "
                                 f"{GAP_PCT}% away from the prior close",
                                 "A stop does not protect against a gap — the market can open "
                                 "past it. Position size, not the stop level, is what limits "
                                 "the loss on a gapping instrument.",
                                 field="gapFrequency", value=round(freq, 3)))
    return out


def _correlation_warnings(symbols: list, exchange: str) -> list[dict]:
    out = []
    if len(set(symbols or [])) < 2:
        return out
    c = correlations(symbols, exchange)
    for p in c["pairs"]:
        if abs(p["correlation"]) >= CORRELATION_HIGH:
            same = p["correlation"] > 0
            out.append(_warn(
                "CORRELATED_POSITIONS", WARNING,
                f"{p['a']} and {p['b']} move "
                f"{'together' if same else 'inversely'} (r = {p['correlation']:+.2f})",
                (f"Measured over {p['overlappingSessions']} overlapping sessions of stored "
                 "daily returns — not inferred from a sector label. "
                 + ("Holding both long is closer to one position of double the size than to "
                    "two independent bets, so the diversification is smaller than the position "
                    "count suggests." if same else
                    "They tend to offset, so the combined exposure is smaller than each leg "
                    "implies.")),
                field="correlation", value=p["correlation"]))
    for ins in c["insufficient"]:
        out.append(_warn("CORRELATION_INSUFFICIENT", INFO,
                         f"Correlation for {ins['symbol']} could not be measured",
                         f"{ins['rows']} usable rows against a minimum of {ins['need']}. "
                         "This pair was not checked.",
                         field="rows", value=ins["rows"], checked=False))
    return out


def _confidence_warnings(prediction: Optional[dict]) -> list[dict]:
    """When the model's own uncertainty says it does not know."""
    out = []
    if not prediction:
        return out
    for name, h in (prediction.get("horizons") or {}).items():
        if h.get("suppressed"):
            out.append(_warn("CONFIDENCE_COLLAPSE", WARNING,
                             f"The {name} reading was suppressed by the engine itself",
                             "The prediction path declined to stand behind this number. "
                             "Treat it as absent rather than as neutral.",
                             evidence=MODEL, field=f"{name}.suppressed", value=True))
            continue
        unc = h.get("uncertainty")
        if unc is not None:
            try:
                unc = float(unc)
            except (TypeError, ValueError):
                continue
            if unc >= UNCERTAINTY_HIGH:
                out.append(_warn("CONFIDENCE_COLLAPSE", INFO,
                                 f"The {name} model reports high uncertainty ({unc:.2f})",
                                 "Its members disagree with each other, so the headline "
                                 "probability is an average over a wide spread.",
                                 evidence=MODEL, field=f"{name}.uncertainty",
                                 value=round(unc, 4)))
    return out


def _live_warnings(symbol: str, include_live: bool) -> list[dict]:
    """
    Delivery percentage and event risk. Both need the network, so both are opt-in.

    When skipped they are REPORTED as skipped. A justification that silently takes seconds and
    can fail is worse than one that names the two checks it did not run.
    """
    if not include_live:
        return [_warn("LIVE_CHECKS_SKIPPED", INFO,
                      "Delivery percentage and event risk were not checked",
                      "Both need a live fetch and are off by default. Request them explicitly "
                      "to include them.",
                      field="includeLive", value=False, checked=False)]
    out = []
    try:
        from . import derivatives
        dd = derivatives.delivery_data(symbol=symbol)
        rows = dd.get("symbols") or dd.get("rows")
        rec = None
        if isinstance(rows, list) and rows:
            rec = rows[0]
        pct = (rec or {}).get("deliveryPct") if isinstance(rec, dict) else None
        if pct is None:
            out.append(_warn("LOW_DELIVERY", INFO,
                             "Delivery percentage was unavailable",
                             f"The delivery report returned nothing usable for {symbol} "
                             f"({dd.get('error') or 'no matching row'}).",
                             field="deliveryPct", checked=False))
        elif float(pct) < LOW_DELIVERY_PCT:
            out.append(_warn("LOW_DELIVERY", WARNING,
                             f"Delivery is {float(pct):.1f}% of traded quantity",
                             "Most of the volume is being squared off intraday rather than "
                             "taken as delivery, so the move reflects positioning more than "
                             "accumulation.",
                             field="deliveryPct", value=round(float(pct), 2)))
    except Exception as e:
        out.append(_warn("LOW_DELIVERY", INFO, "Delivery check failed",
                         f"{type(e).__name__}: {e}", field="deliveryPct", checked=False))

    try:
        from . import news
        hl = news.headlines(symbol, limit=30)
        items = hl.get("items") or []
        found = {}
        for it in items:
            for ev in (it.get("events") or []):
                found.setdefault(ev, 0)
                found[ev] += 1
        if found:
            top = sorted(found.items(), key=lambda kv: -kv[1])
            out.append(_warn("EVENT_RISK", WARNING,
                             "Event-type headlines are present: "
                             + ", ".join(f"{k} ({v})" for k, v in top[:4]),
                             "A scheduled or breaking event can move price independently of "
                             "any technical reading. Check what is dated before sizing up.",
                             field="events", value=dict(top[:6])))
        elif not items:
            out.append(_warn("EVENT_RISK", INFO, "No headlines were retrieved",
                             "Event risk could not be assessed for this symbol.",
                             field="events", checked=False))
    except Exception as e:
        out.append(_warn("EVENT_RISK", INFO, "Event check failed",
                         f"{type(e).__name__}: {e}", field="events", checked=False))
    return out


def warnings_for(symbol: str, exchange: str = "NSE", prediction: Optional[dict] = None,
                 include_live: bool = False, peer_symbols: Optional[list] = None,
                 interval: str = "1d") -> list[dict]:
    """Every pitfall and trap Rāma can actually check, plus the ones it could not."""
    out = []
    out.extend(_deriv_warnings(symbol, exchange))
    out.extend(_liquidity_warnings(symbol, exchange, interval))
    out.extend(_confidence_warnings(prediction))
    out.extend(_correlation_warnings(list({symbol, *(peer_symbols or [])}), exchange))
    out.extend(_live_warnings(symbol, include_live))
    rank = {CRITICAL: 0, WARNING: 1, INFO: 2}
    out.sort(key=lambda w: (not w["checked"] and w["severity"] == INFO,
                            rank.get(w["severity"], 3), w["kind"]))
    return out


def brief(symbol: str, exchange: str = "NSE", include_prediction: bool = True,
          include_live: bool = False, interval: str = "1d",
          include_positions: bool = True) -> dict:
    """
    The one call a UI needs: bullets, warnings, the gate verdict, and a caveat line.

    Peer symbols for the correlation check come from the tracked ledger, so "you already hold
    something that moves with this" is answerable without master listing his book by hand.
    """
    sym = str(symbol or "").strip().upper()
    prediction = None
    entitlements = {}
    try:
        from . import horizons as _h
        for name in _h.DEFAULT_ORDER:
            entitlements[name] = model_entitlement(name)
        if include_prediction:
            prediction = _h.predict_all(sym, exchange)
    except Exception as e:
        logger.warning(f"[explain] prediction unavailable for {sym}: {e}")

    peers = []
    if include_positions:
        try:
            from . import ledger
            peers = [p["symbol"] for p in ledger.positions(status=ledger.STATUS_OPEN,
                                                           interval=interval)]
        except Exception as e:
            logger.warning(f"[explain] could not read the ledger: {e}")

    bullets = justify(sym, exchange, prediction, interval, entitlements)
    warns = warnings_for(sym, exchange, prediction, include_live, peers, interval)

    entitled = [n for n, e in entitlements.items() if e.get("entitled")]
    unchecked = [w["kind"] for w in warns if not w["checked"]]

    return {
        "symbol": sym, "exchange": exchange,
        "bullets": bullets,
        "warnings": warns,
        "entitlements": entitlements,
        "entitledHorizons": entitled,
        "counts": {
            "bullets": len(bullets),
            "observations": sum(1 for b in bullets if b["basis"] == OBSERVATION),
            "conventions": sum(1 for b in bullets if b["basis"] == CONVENTION),
            "forecasts": sum(1 for b in bullets if b["basis"] == FORECAST),
            "warnings": len(warns),
            "critical": sum(1 for w in warns if w["severity"] == CRITICAL),
            "unchecked": len(unchecked),
        },
        "uncheckedWarnings": unchecked,
        # The caveat is part of the payload, not decoration a UI may drop. If no horizon has
        # earned the gate, that has to travel with the bullets wherever they are rendered.
        "caveat": (
            "No horizon's model has cleared the gate, so nothing here is a validated forecast. "
            "The measured bullets are facts about past bars; they are not evidence that any "
            "probability shown is correct."
            if not entitled else
            f"Gate-cleared horizons: {', '.join(entitled)}. Every other reading is unvalidated."
        ),
        "unsafeToInferFrom": (
            [w["kind"] for w in warns if not w["checked"]] or None),
        "generatedAt": _now(),
    }
