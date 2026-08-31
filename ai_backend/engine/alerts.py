"""
Alerts — when to leave, reduce, or add (spec Section 75).

THE PROBLEM THIS MODULE IS BUILT AROUND. Section 73 measured, on real data, that no horizon's
model clears Section 69's gate. The positional model looked the best of the three and was
refused for taking credit for the market's drift. Turning those same probabilities into
"EXIT NOW" would launder a failed model into an instruction at the exact moment master has
capital at risk. So an alert here does not ask "what does the model think". It asks **what
entitles this alert to be acted on**.

THREE EVIDENCE CLASSES:

  DECLARED  master's own thesis — his stop, his target. Reporting a breach is reporting a fact
            against an instruction he gave. Actionable.
  MEASURED  arithmetic over stored bars and his own fills — drawdown, days held, concentration.
            Counting, not forecasting. Actionable.
  MODEL     a directional probability. Actionable ONLY if that horizon's model cleared the gate.
            None do, so today every one of these carries actionable=False and the recorded
            refusal reason. It is neither dropped (which would hide that Rāma looked) nor
            promoted (which is the capital-destroying failure).

THE ASYMMETRY IS DELIBERATE. Exit and reduce can be justified by arithmetic alone: they reduce
exposure, and a false positive costs upside. ADD increases exposure, and a false positive costs
capital — so ADD is reachable only through the MODEL class and is therefore currently never
actionable. Rāma will not tell master to put more money in on the strength of arithmetic that
cannot see the future.

A STALE PRICE DISQUALIFIES EVERY PRICE COMPARISON. Section 74 built `priceStale` for this. An
exit alert fired on last week's close is worse than no alert, because it carries the authority
of a system that looks current.

ALERTS ARE COMPUTED FRESH, NEVER STORED. A stored alert is a claim about the present that ages
badly. De-duplicating notifications belongs where the notification is shown.
"""

import datetime as _dt
import logging
from typing import Optional

from . import ledger, store

logger = logging.getLogger("stockmind.alerts")

# ── Evidence classes ─────────────────────────────────────────────────────────
DECLARED = "DECLARED"      # master set this level himself
MEASURED = "MEASURED"      # arithmetic over bars and fills
MODEL = "MODEL"            # a forecast, and therefore gated

ACTIONS = ("EXIT", "REDUCE", "ADD", "REVIEW", "HOLD", "NONE")
CRITICAL, WARNING, INFO = "critical", "warning", "info"

# ── Thresholds, each with the reason it is what it is ────────────────────────

# Close enough to a declared stop that master should decide deliberately rather than be
# stopped out by a wick while he is not looking.
STOP_PROXIMITY_PCT = 2.0

# Same courtesy at the target: a target reached and ignored becomes a round trip.
TARGET_PROXIMITY_PCT = 2.0

# A 15% fall from the best close since entry. Below this, normal volatility in Indian equities
# would fire constantly and master would learn to ignore the alert, which is worse than not
# having it.
DRAWDOWN_PCT = 15.0

# An unrealised loss of 10% is worth a second look even with no stop declared.
LOSS_REVIEW_PCT = 10.0

# One position above 40% of invested capital is a concentration risk regardless of how good
# the thesis is.
CONCENTRATION_PCT = 40.0

# A swing thesis is 5 trading days. Held past 2x its horizon, the reason master entered on has
# expired even if the price has not moved.
THESIS_HORIZON_TOLERANCE = 2.0

# 5 trading days is about 7 calendar days.
TRADING_TO_CALENDAR = 7.0 / 5.0

# Below this conviction a model reading is not worth relaying even as non-actionable noise.
MODEL_CONVICTION_FLOOR = 0.20


def _now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def _alert(kind, evidence, action, severity, headline, detail,
           position_view=None, triggered_by=None, actionable=True,
           why_not=None) -> dict:
    return {
        "kind": kind,
        "evidence": evidence,
        "action": action,
        "severity": severity,
        "headline": headline,
        "detail": detail,
        "positionId": (position_view or {}).get("positionId"),
        "symbol": (position_view or {}).get("symbol"),
        "instrType": (position_view or {}).get("instrType"),
        "triggeredBy": triggered_by or {},
        "actionable": bool(actionable),
        "whyNotActionable": why_not,
        "priceAsOf": (position_view or {}).get("priceAsOf"),
        "generatedAt": _now(),
    }


# ── Is a horizon's model entitled to speak? ──────────────────────────────────

def model_entitlement(horizon_name: str) -> dict:
    """
    Whether a horizon's model cleared the gate, read from what was actually recorded.

    NOT ASSUMED EITHER WAY. Section 73 writes provenance per horizon containing the gate
    verdict, so this reads that file. No provenance means never trained, which is also not
    entitled — but for a different reason, and master should be told which.
    """
    out = {"horizon": horizon_name, "entitled": False, "reason": None,
           "trainedAt": None, "acceptedModels": []}
    try:
        from . import horizons as _h
        from . import training
        h = _h.get(horizon_name)
    except Exception as e:
        out["reason"] = f"unknown horizon: {type(e).__name__}: {e}"
        return out

    # `horizons.get` returns None for a name it does not know, and `load_provenance(None)`
    # reads the LEGACY unsuffixed report. Without this guard a mistyped horizon would be
    # answered from a model belonging to no horizon at all — and could answer `entitled: True`.
    # An unknown name has to be an unknown name.
    if h is None:
        out["reason"] = (f"unknown horizon {horizon_name!r} — no model can be vouched for, "
                         f"and the legacy record must not be used to answer for it")
        return out

    try:
        prov = training.load_provenance(h)
    except Exception as e:
        out["reason"] = f"could not read the training record: {type(e).__name__}: {e}"
        return out

    if not prov:
        out["reason"] = ("this horizon has never been trained, so no model has been measured "
                         "against the gate")
        return out

    out["trainedAt"] = prov.get("trainedAt") or prov.get("generatedAt")
    models = prov.get("models") or {}
    accepted = [name for name, m in models.items() if m.get("accepted")]
    out["acceptedModels"] = accepted
    if accepted:
        out["entitled"] = True
        out["reason"] = f"cleared the gate: {', '.join(accepted)}"
        return out

    refusals = [m.get("reason") or (m.get("gate") or {}).get("reason")
                for m in models.values() if m.get("reason") or m.get("gate")]
    out["reason"] = ("no model cleared the gate for this horizon"
                     + (f" — {refusals[0]}" if refusals and refusals[0] else ""))
    return out


# ── Bars since entry, for the drawdown measurement ───────────────────────────

def peak_since(symbol: str, exchange: str, since: str, interval: str = "1d") -> dict:
    """
    The best close between the first fill and now.

    Uses close rather than high so it agrees with the mark-to-market in `ledger.derive`;
    measuring the drawdown against an intraday high that the position was never marked at would
    manufacture a drawdown that master never actually saw.
    """
    out = {"peak": None, "peakDate": None, "bars": 0}
    try:
        df = store.load(symbol, exchange, interval)
    except Exception:
        return out
    if df is None or len(df) == 0 or "close" not in df.columns:
        return out
    try:
        d = df.copy()
        d["_d"] = d["date"].astype(str).str.slice(0, 10)
        d = d[d["_d"] >= str(since)[:10]].dropna(subset=["close"])
    except Exception:
        return out
    if len(d) == 0:
        return out
    idx = d["close"].idxmax()
    out["peak"] = float(d.loc[idx, "close"])
    out["peakDate"] = str(d.loc[idx, "date"])[:10]
    out["bars"] = int(len(d))
    return out


# ── The rules, per position ──────────────────────────────────────────────────

def evaluate_position(view: dict, book_invested: Optional[float] = None,
                      prediction: Optional[dict] = None,
                      entitlements: Optional[dict] = None,
                      interval: str = "1d") -> list[dict]:
    """
    Every alert a single position earns. Pure — takes a derived view, returns a list.

    `view` is `ledger.derive()`'s output. `prediction` is `horizons.predict_all()`'s output for
    the same symbol, optional. `entitlements` maps horizon name to `model_entitlement()`.
    """
    out = []
    if view.get("status") != ledger.STATUS_OPEN:
        return out

    last = view.get("lastPrice")
    net = view.get("netQty") or 0
    if net == 0:
        return out
    is_long = net > 0
    thesis = view.get("thesis") or {}
    stale = bool(view.get("priceStale"))
    invested = view.get("investedValue") or 0

    # A stale price does not silence the alert — it removes its authority, and says so.
    stale_why = None
    if stale or last is None:
        # PREFER THE LEDGER'S OWN NOTE. `derive` puts the real reason in `flags` — "the newest
        # stored bar is 88 days old, sync before trusting P&L", or that the bar predates the
        # newest fill. That message tells master what to DO; a generic "not current" does not,
        # so the generic text is only a fallback.
        stale_why = next((f for f in (view.get("flags") or [])
                          if any(w in f.lower() for w in
                                 ("stale", "price", "bar", "sync", "market"))), None) \
            or "the stored price could not be trusted, so this comparison is not current"
        out.append(_alert(
            "PRICE_STALE", MEASURED, "NONE", INFO,
            f"{view['symbol']}: the price is not current, so nothing here can be acted on",
            (f"The newest usable bar is {view.get('priceAsOf') or 'unknown'}. "
             "Sync this symbol before treating any price comparison below as live."),
            view, {"priceAsOf": view.get("priceAsOf")}, actionable=False,
            why_not=stale_why))

    price_ok = (last is not None) and not stale

    # ── DECLARED: the levels master set himself ──────────────────────────────
    stop = thesis.get("stopPrice")
    target = thesis.get("targetPrice")

    if stop is not None and last is not None:
        breached = (last <= stop) if is_long else (last >= stop)
        if breached:
            out.append(_alert(
                "STOP_BREACHED", DECLARED, "EXIT", CRITICAL,
                f"{view['symbol']}: your stop at {stop:g} is breached — last {last:g}",
                (f"You recorded {stop:g} as the level at which this thesis is wrong. "
                 f"The position is {'long' if is_long else 'short'} "
                 f"{abs(net):g} at an average of {view['avgCost']:g}. "
                 "This is your own instruction, not a forecast."),
                view, {"field": "thesis.stopPrice", "threshold": stop, "observed": last},
                actionable=price_ok, why_not=stale_why))
        else:
            gap = abs(last - stop) / last * 100.0 if last else None
            if gap is not None and gap <= STOP_PROXIMITY_PCT:
                out.append(_alert(
                    "STOP_APPROACHING", DECLARED, "REVIEW", WARNING,
                    f"{view['symbol']}: within {gap:.1f}% of your stop at {stop:g}",
                    ("Close enough that a normal session could take it out. Decide "
                     "deliberately now rather than be stopped out while not watching."),
                    view, {"field": "thesis.stopPrice", "threshold": stop,
                           "observed": last, "gapPct": round(gap, 2)},
                    actionable=price_ok, why_not=stale_why))

    if target is not None and last is not None:
        reached = (last >= target) if is_long else (last <= target)
        if reached:
            out.append(_alert(
                "TARGET_REACHED", DECLARED, "REDUCE", WARNING,
                f"{view['symbol']}: your target of {target:g} is met — last {last:g}",
                (f"You opened this expecting {target:g}. Unrealised P&L is "
                 f"{view.get('unrealisedPnl')} ({view.get('pnlPct')}%). "
                 "Rāma is not telling you the move is over — it is telling you the reason "
                 "you gave for being here has been satisfied."),
                view, {"field": "thesis.targetPrice", "threshold": target, "observed": last},
                actionable=price_ok, why_not=stale_why))
        else:
            gap = abs(target - last) / last * 100.0 if last else None
            if gap is not None and gap <= TARGET_PROXIMITY_PCT:
                out.append(_alert(
                    "TARGET_APPROACHING", DECLARED, "REVIEW", INFO,
                    f"{view['symbol']}: within {gap:.1f}% of your target of {target:g}",
                    "Worth deciding in advance whether you take it or trail it.",
                    view, {"field": "thesis.targetPrice", "threshold": target,
                           "observed": last, "gapPct": round(gap, 2)},
                    actionable=price_ok, why_not=stale_why))

    if stop is None and invested > 0:
        out.append(_alert(
            "NO_STOP_SET", MEASURED, "REVIEW", WARNING,
            f"{view['symbol']}: no stop recorded on {invested:,.0f} of capital",
            ("Nothing here bounds the loss, and Rāma cannot warn you about a level you have "
             "not given it. Record a stop on this position so a breach can be watched for."),
            view, {"field": "thesis.stopPrice", "observed": None},
            actionable=True))

    # ── MEASURED: arithmetic over the bars and the fills ─────────────────────
    pnl_pct = view.get("pnlPct")
    if pnl_pct is not None and pnl_pct <= -LOSS_REVIEW_PCT:
        out.append(_alert(
            "LOSS_THRESHOLD", MEASURED, "REVIEW", WARNING,
            f"{view['symbol']}: down {abs(pnl_pct):.1f}% against your average cost",
            (f"Unrealised {view.get('unrealisedPnl')} on an invested {invested:,.0f}. "
             "This is arithmetic on your own fills, not a forecast."),
            view, {"field": "pnlPct", "threshold": -LOSS_REVIEW_PCT, "observed": pnl_pct},
            actionable=price_ok, why_not=stale_why))

    first_fill = view.get("firstFillDate")
    if first_fill and last is not None and is_long:
        pk = peak_since(view["symbol"], view.get("exchange") or "NSE", first_fill, interval)
        if pk["peak"] and pk["peak"] > 0:
            fall = (pk["peak"] - last) / pk["peak"] * 100.0
            if fall >= DRAWDOWN_PCT:
                out.append(_alert(
                    "DRAWDOWN_FROM_PEAK", MEASURED, "REDUCE", WARNING,
                    f"{view['symbol']}: {fall:.1f}% below its best close since you entered",
                    (f"Peaked at {pk['peak']:g} on {pk['peakDate']}, last {last:g}. "
                     "Measured on closes, so this is a fall you were actually marked at, "
                     "not an intraday wick."),
                    view, {"field": "drawdownPct", "threshold": DRAWDOWN_PCT,
                           "observed": round(fall, 2), "peak": pk["peak"],
                           "peakDate": pk["peakDate"]},
                    actionable=price_ok, why_not=stale_why))

    # ── Trade style (Section 77) ──────────────────────────────────────────────
    #
    # INTRADAY_NOT_SQUARED is pure arithmetic — a date comparison, no model — so it is actionable
    # today under this module's own rules. It is also the most expensive item in the list: a
    # broker's auto-square-off executes at whatever price the market offers, usually with a
    # penalty, and an unsquared intraday equity short becomes a short-delivery settlement
    # failure. Rāma can see this with certainty and could not say it before styles existed.
    style = view.get("tradeStyle")
    last_fill = view.get("lastFillDate")
    if style == "INTRADAY" and last_fill:
        try:
            opened_on = _dt.date.fromisoformat(str(last_fill)[:10])
            stale_days = (_dt.date.today() - opened_on).days
        except ValueError:
            stale_days = None
        if stale_days and stale_days >= 1:
            out.append(_alert(
                "INTRADAY_NOT_SQUARED", MEASURED, "EXIT", CRITICAL,
                f"{view['symbol']}: an INTRADAY position is still open {stale_days} day"
                f"{'s' if stale_days != 1 else ''} after {last_fill}",
                (f"You recorded this as an intraday trade of {abs(view['netQty']):g}. It has not "
                 "been squared off. Either it was closed and the exit is missing from the "
                 "ledger, or it is genuinely still open — in which case a broker auto-square-off "
                 "executes at whatever price is available, usually with a penalty, and a short "
                 "carried past settlement becomes a delivery failure. Record the exit or change "
                 "the trade style to what you actually intend."),
                view, {"field": "tradeStyle", "threshold": "same session",
                       "observed": f"{stale_days} days", "lastFillDate": last_fill},
                actionable=True))

    if style == "SWING" and view.get("daysHeld") is not None:
        span = ledger.STYLE_SPAN_DAYS.get("SWING")
        if span and view["daysHeld"] > span:
            out.append(_alert(
                "SWING_OVERHELD", MEASURED, "REVIEW", WARNING,
                f"{view['symbol']}: a SWING trade has been held {view['daysHeld']} days",
                (f"A swing trade is meant to run about {span} days. Past that it is a position "
                 "you are holding for a reason you have not recorded — either restate it as "
                 "positional with a fresh thesis, or close it."),
                view, {"field": "daysHeld", "threshold": span,
                       "observed": view["daysHeld"], "tradeStyle": "SWING"},
                actionable=True))

    if view.get("styleVsThesis"):
        out.append(_alert(
            "STYLE_THESIS_MISMATCH", MEASURED, "REVIEW", INFO,
            f"{view['symbol']}: trade style and thesis horizon disagree",
            view["styleVsThesis"] + ". Neither is overridden — Rāma is telling you they differ "
            "so you can decide which one you actually meant.",
            view, {"field": "tradeStyle", "observed": view.get("tradeStyle"),
                   "thesisHorizon": (thesis or {}).get("horizon")},
            actionable=True))

    days = view.get("daysHeld")
    hz_name = thesis.get("horizon")
    if days is not None and hz_name:
        span = _thesis_span_days(hz_name)
        if span and days > span * THESIS_HORIZON_TOLERANCE:
            out.append(_alert(
                "THESIS_EXPIRED", MEASURED, "REVIEW", WARNING,
                f"{view['symbol']}: held {days} days on a '{hz_name}' thesis worth ~{span:.0f}",
                (f"A {hz_name} call is about the next ~{span:.0f} calendar days. This position "
                 f"is {days} days old, so whatever you decided on has already played out — "
                 "the position is now being held for a reason you have not stated. "
                 "Re-state the thesis or close it."),
                view, {"field": "daysHeld", "threshold": round(span * THESIS_HORIZON_TOLERANCE),
                       "observed": days, "thesisHorizon": hz_name},
                actionable=True))

    if book_invested and invested > 0:
        share = invested / book_invested * 100.0
        if share > CONCENTRATION_PCT:
            out.append(_alert(
                "CONCENTRATION", MEASURED, "REDUCE", WARNING,
                f"{view['symbol']}: {share:.0f}% of your invested capital sits in one position",
                (f"{invested:,.0f} of {book_invested:,.0f}. However good the thesis, a single "
                 "adverse event here moves the whole book. This is a position-size fact, "
                 "independent of direction."),
                view, {"field": "concentrationPct", "threshold": CONCENTRATION_PCT,
                       "observed": round(share, 2)},
                actionable=True))

    for flag in (view.get("flags") or []):
        if "short" in flag.lower() and "equity" in flag.lower():
            out.append(_alert(
                "EQUITY_SHORT", MEASURED, "REVIEW", CRITICAL,
                f"{view['symbol']}: net short on cash equity",
                flag + " If this was meant to be an intraday trade it must be squared off "
                       "today; if it was meant to be a futures position it is recorded against "
                       "the wrong instrument.",
                view, {"field": "netQty", "observed": net}, actionable=True))

    # ── MODEL: gated on the horizon having earned the right to speak ──────────
    out.extend(_model_alerts(view, prediction, entitlements, is_long, price_ok, stale_why))
    return out


def _thesis_span_days(horizon_name: str) -> Optional[float]:
    """A thesis horizon in calendar days, so 'held too long' is measurable."""
    try:
        from . import horizons as _h
        h = _h.get(horizon_name)
    except Exception:
        return None
    if store.is_intraday(h.interval):
        return 1.0
    return float(h.bars) * TRADING_TO_CALENDAR


def _model_alerts(view, prediction, entitlements, is_long, price_ok, stale_why) -> list[dict]:
    """
    What the models say, and whether they are allowed to say it.

    EVERY alert from here is non-actionable unless that horizon's model cleared the gate. The
    reason is attached verbatim rather than summarised, so master sees the measurement rather
    than Rāma's paraphrase of it.
    """
    out = []
    if not prediction:
        return out
    by_h = (prediction.get("horizons") or {})
    ents = entitlements or {}

    for name, h in by_h.items():
        p = h.get("probability")
        if p is None or h.get("error"):
            continue
        conviction = h.get("conviction")
        if conviction is None:
            conviction = abs(p - 0.5) * 2
        if conviction < MODEL_CONVICTION_FLOOR:
            continue

        ent = ents.get(name) or model_entitlement(name)
        entitled = bool(ent.get("entitled"))
        why = None if entitled else (
            f"the {name} model has not cleared the gate — {ent.get('reason')}. "
            "Reported so you know Rāma looked, not as advice.")

        against = (p < 0.5) if is_long else (p >= 0.5)
        if against:
            out.append(_alert(
                "MODEL_AGAINST_POSITION", MODEL,
                "REDUCE" if conviction < 0.5 else "EXIT",
                WARNING if entitled else INFO,
                (f"{view['symbol']}: the {name} model points "
                 f"{'down' if p < 0.5 else 'up'} against your "
                 f"{'long' if is_long else 'short'}"),
                (f"P(up) = {p:.4f} over {h.get('bars') or '?'} {h.get('interval')} bars, "
                 f"conviction {conviction:.2f}, as of {h.get('asOf')}."),
                view, {"field": f"model.{name}.probability", "observed": round(p, 4),
                       "conviction": round(conviction, 4)},
                actionable=entitled and price_ok,
                why_not=why or stale_why))
        elif conviction >= 0.5:
            # The ONLY path to an ADD, and it is gated. See the module docstring: increasing
            # exposure is not symmetric with reducing it.
            out.append(_alert(
                "MODEL_SUPPORTS_ADD", MODEL, "ADD", INFO,
                (f"{view['symbol']}: the {name} model agrees with your "
                 f"{'long' if is_long else 'short'}"),
                (f"P(up) = {p:.4f}, conviction {conviction:.2f}. Adding to a position is the "
                 "one action Rāma will not justify with arithmetic alone, because it increases "
                 "what is at risk — so this needs a model that has cleared the gate."),
                view, {"field": f"model.{name}.probability", "observed": round(p, 4),
                       "conviction": round(conviction, 4)},
                actionable=entitled and price_ok,
                why_not=why or stale_why))

    agree = prediction.get("agreement") or {}
    if agree.get("state") == "split":
        any_entitled = any((ents.get(n) or {}).get("entitled") for n in by_h) or False
        out.append(_alert(
            "MODEL_SPLIT", MODEL, "REVIEW", INFO,
            f"{view['symbol']}: the horizons disagree with each other",
            (agree.get("note") or "One horizon points up and another down.")
            + f" Weakest conviction across them: {agree.get('weakestConviction')}.",
            view, {"field": "agreement.state", "observed": "split",
                   "long": agree.get("long"), "short": agree.get("short")},
            actionable=any_entitled,
            why_not=None if any_entitled else
            "no horizon's model has cleared the gate, so the disagreement is between two "
            "readings neither of which has been shown to predict anything."))
    return out


# ── The whole book ───────────────────────────────────────────────────────────

def evaluate(symbol: Optional[str] = None, include_prediction: bool = False,
             interval: str = "1d") -> dict:
    """
    Every alert across the tracked book.

    `include_prediction` runs the multi-horizon models. Off by default: it is the slow path,
    and with no horizon entitled to speak it currently adds only non-actionable readings.
    """
    views = ledger.positions(status=ledger.STATUS_OPEN, symbol=symbol, interval=interval)
    book = sum(v.get("investedValue") or 0 for v in views)

    entitlements = {}
    predictions = {}
    if include_prediction and views:
        try:
            from . import horizons as _h
            for name in _h.DEFAULT_ORDER:
                entitlements[name] = model_entitlement(name)
            for sym in sorted({v["symbol"] for v in views}):
                ex = next(v.get("exchange") or "NSE" for v in views if v["symbol"] == sym)
                try:
                    predictions[sym] = _h.predict_all(sym, ex)
                except Exception as e:
                    logger.warning(f"[alerts] prediction failed for {sym}: {e}")
                    predictions[sym] = None
        except Exception as e:
            logger.warning(f"[alerts] could not prepare predictions: {e}")

    all_alerts = []
    for v in views:
        all_alerts.extend(evaluate_position(
            v, book_invested=book, prediction=predictions.get(v["symbol"]),
            entitlements=entitlements, interval=interval))

    rank = {CRITICAL: 0, WARNING: 1, INFO: 2}
    all_alerts.sort(key=lambda a: (not a["actionable"], rank.get(a["severity"], 3),
                                   a["symbol"] or ""))

    actionable = [a for a in all_alerts if a["actionable"]]
    withheld = [a for a in all_alerts if not a["actionable"]]

    return {
        "alerts": all_alerts,
        "actionable": len(actionable),
        "withheld": len(withheld),
        "critical": sum(1 for a in actionable if a["severity"] == CRITICAL),
        "positionsChecked": len(views),
        "investedValue": round(book, 2),
        "byEvidence": {c: sum(1 for a in all_alerts if a["evidence"] == c)
                       for c in (DECLARED, MEASURED, MODEL)},
        "predictionsIncluded": bool(include_prediction),
        "entitlements": entitlements,
        # Said explicitly rather than left to be inferred from an empty list: master must be
        # able to tell "nothing is wrong" apart from "Rāma is not allowed to tell you".
        "summary": _summarise(views, actionable, withheld, include_prediction, entitlements),
        "generatedAt": _now(),
    }


def _summarise(views, actionable, withheld, include_prediction, entitlements) -> str:
    if not views:
        return ("No open positions are being tracked, so there is nothing to warn about. "
                "Record what you hold to get exit and risk alerts.")
    parts = [f"{len(views)} open position{'s' if len(views) != 1 else ''} checked"]
    if actionable:
        crit = sum(1 for a in actionable if a["severity"] == CRITICAL)
        parts.append(f"{len(actionable)} actionable alert{'s' if len(actionable) != 1 else ''}"
                     + (f", {crit} critical" if crit else ""))
    else:
        parts.append("nothing actionable")
    if withheld:
        parts.append(f"{len(withheld)} withheld as not currently trustworthy")
    if include_prediction:
        entitled = [n for n, e in entitlements.items() if e.get("entitled")]
        parts.append("no horizon's model has cleared the gate, so no model reading is "
                     "actionable" if not entitled
                     else f"model readings actionable for: {', '.join(entitled)}")
    return "; ".join(parts) + "."
