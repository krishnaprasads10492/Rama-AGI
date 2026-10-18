"""
strategy_service.py - the glue between the routes and the strategy book (spec Section 151.4)

`main.py` stays a thin adapter: it turns a request into a call here and a result into a response. Everything
that decides something lives in this module or the ones it calls, and the bar loader is INJECTED, so all of it
runs in the tests without pandas, FastAPI or any stored data.

    cost_for        the ONE definition of what a trade costs: the real-charge block that used to sit inline
                    in `/strategy/backtest`. The route, evolve and refresh all call it, so a strategy cannot be
                    judged under one cost when stored and another when refreshed.
    run_evolve      candidates -> walk-forward -> rank. STORES NOTHING; the run is cached under a `runId`.
    keep            master's act: store named rows of a cached run. The rows come from the CACHE, never from the
                    request, so a client cannot assert that a candidate is `demonstrated`.
    book_view       the stored strategies with their staleness.
    refresh         the forward test, for the stale ones or the named ones. Master-initiated only.
    signals         what each stored rule says right now.
    retire/restore/remove   master's acts, passed through.

NO ORDER PLACEMENT (Section 95): nothing here can reach a broker, and no state is worded as an instruction.
"""

from __future__ import annotations

import collections
import datetime as _dt
import threading
import time
import uuid
from typing import Callable, Iterable, Optional

try:                                    # pragma: no cover - import shape, not logic
    from . import costs as _costs
    from . import strategy_book as _book
    from . import strategy_eval as _se
    from . import strategy_factory as _factory
    from . import strategy_spec as _ss
except Exception:                       # pragma: no cover
    import costs as _costs
    import strategy_book as _book
    import strategy_eval as _se
    import strategy_factory as _factory
    import strategy_spec as _ss

RUN_CACHE_SIZE = 8                      # evolve runs kept so master can Keep from them; process lifetime only
_runs: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
_lock = threading.Lock()

LoadBars = Callable[[str, str, str], Optional[list]]


def clear_runs() -> None:
    with _lock:
        _runs.clear()


# ── Bars ──────────────────────────────────────────────────────────────────────

def bars_from_frame(df) -> list:
    """A stored frame (date/open/high/low/close/volume) as the plain bar dicts the engine speaks."""
    return [
        {"date": str(r["date"]), "open": float(r["open"]), "high": float(r["high"]),
         "low": float(r["low"]), "close": float(r["close"]),
         "volume": float(r["volume"]) if r.get("volume") is not None else 0.0}
        for _, r in df.iterrows()
    ]


# ── Cost: one definition ──────────────────────────────────────────────────────

def cost_for(clean: dict, bars: list) -> tuple:
    """
    `(CostModel, cost_basis)` for a validated spec over these bars.

    Judged against REAL charges where they can be computed (Section 115). `CostModel` speaks only in
    percentages, so the bridge needs a representative notional: the quantity this strategy would actually take
    at the last price. Without one a flat rupee brokerage cannot be expressed, and the flat default flatters
    small trades by exactly the amount that kills them.

    DECOMPOSITION, stated rather than blended: `costs.py` covers brokerage and every statutory charge, so it
    replaces the COMMISSION term. Slippage and spread are not broker charges and are left as master's own
    estimates.
    """
    c = clean["costs"]
    commission = c["commissionPct"]
    basis = {"source": "flat", "why": "no instrument on the spec, so the flat percentages stand"}
    try:
        instrument = clean.get("instrument")
        rep_price = float(bars[-1]["close"]) if bars else 0.0
        raw_qty = _ss.position_size(clean, rep_price) if rep_price > 0 else 0
        lot = max(1, int(clean.get("lotSize") or 1))
        rep_qty = (raw_qty // lot) * lot
        if instrument and instrument != "options" and rep_qty > 0:
            eff = _costs.effective_round_trip_pct(instrument, rep_price, rep_qty)
            if eff.get("ok"):
                commission = eff["pct"] / 2.0          # round_trip = 2*(comm + slip) + spread
                basis = {
                    "source": "measured", "instrument": instrument, "roundTripPct": eff["pct"],
                    "assumedPrice": eff["assumedPrice"], "assumedQuantity": eff["assumedQuantity"],
                    "assumedNotional": eff["assumedNotional"],
                    "why": ("brokerage and statutory charges computed for this instrument at the quantity the "
                            "strategy would take; slippage and spread remain master's own estimates because "
                            "they are not broker charges"),
                    "provenance": eff["provenance"],
                }
        elif instrument == "options":
            basis = {"source": "flat", "instrument": instrument,
                     "why": "options are priced on premium and there is no premium history"}
        elif instrument and rep_qty <= 0:
            basis = {"source": "flat", "instrument": instrument,
                     "why": (f"the risk budget sizes below one lot of {lot} units at {rep_price:g}, so there is "
                             f"no quantity to price charges on")}
    except Exception as exc:                            # a charge-model fault must not lose the run
        basis = {"source": "flat", "why": f"charge model unavailable: {exc}"}
        commission = c["commissionPct"]
    model = _se.CostModel(commission_pct=commission, slippage_pct=c["slippagePct"], spread_pct=c["spreadPct"])
    return model, basis


def _conservative_cost(specs: Iterable[dict], bars: list) -> tuple:
    """
    One cost for a whole run. Templates size differently (a wide stop takes fewer units), so a flat rupee
    brokerage is a different percentage for each. The run judges all of them under the HIGHEST, which can only
    make a result look worse, never better; the range is reported.
    """
    best, best_basis, pcts, seen = None, None, [], set()
    for s in specs:
        h = _ss.spec_hash(s)
        if h in seen:
            continue
        seen.add(h)
        model, basis = cost_for(s, bars)
        pcts.append(model.round_trip_pct())
        if best is None or model.round_trip_pct() > best.round_trip_pct():
            best, best_basis = model, basis
    if best is None:
        return None, {"source": "flat", "why": "no candidates to price"}
    best_basis = dict(best_basis, runRoundTripPct=best.round_trip_pct(),
                      candidateRoundTripRange=[min(pcts), max(pcts)],
                      rule="the run is judged under the highest round-trip cost among its candidates")
    return best, best_basis


# ── Guard ─────────────────────────────────────────────────────────────────────

def _book_error(exc: Exception) -> dict:
    return {"ok": False, "corrupt": isinstance(exc, _book.BookCorrupt), "reason": str(exc)}


# ── Evolve ────────────────────────────────────────────────────────────────────

def run_evolve(load_bars: LoadBars, *, symbol: str, exchange: str = "NSE", interval: str = "1d",
               capital: float = 100000.0, risk_pct: float = 1.0, instrument: Optional[str] = None,
               lot_size: Optional[int] = None, side: str = "both", horizon: Optional[str] = None,
               explore: str = "library", templates: Optional[list] = None, folds: int = _factory.DEFAULT_FOLDS) -> dict:
    """Generate, walk-forward judge and rank. Stores nothing: the result is cached for `keep`."""
    cand = _factory.candidate_specs(symbol=symbol, exchange=exchange, interval=interval, capital=capital,
                                    risk_pct=risk_pct, instrument=instrument, lot_size=lot_size, side=side,
                                    horizon=horizon, explore=explore, templates=templates)
    if not cand.get("ok"):
        return cand
    if not cand["specs"]:
        return {"ok": False, "reason": "no strategy in the library can run with these choices", "refused": cand["refused"]}
    bars = load_bars(symbol, exchange, interval)
    have = len(bars) if bars else 0
    if have < _factory.MIN_BARS:
        return {"ok": False, "storedBars": have, "needBars": _factory.MIN_BARS,
                "reason": (f"only {have} stored {interval} bars for {symbol}; at least {_factory.MIN_BARS} are needed "
                           f"to hold anything out. Fetch more history first.")}
    cost, basis = _conservative_cost([e["spec"] for e in cand["specs"]], bars)
    measured_on = _book._now_iso()
    started = time.time()
    result = _factory.evolve(
        bars, cand["specs"], cost, folds=folds, measured_on=measured_on,
        provenance={"symbol": symbol, "exchange": exchange, "interval": interval, "bars": have,
                    "firstBar": bars[0]["date"], "lastBar": bars[-1]["date"], "generator": "strategy_factory"})
    if not result.get("ok"):
        return dict(result, storedBars=have)
    run_id = uuid.uuid4().hex[:12]
    out = dict(result, runId=run_id, symbol=symbol, exchange=exchange, interval=interval, bars=have,
               firstBar=bars[0]["date"], lastBar=bars[-1]["date"], costBasis=basis, refused=cand["refused"],
               explore=explore, seconds=round(time.time() - started, 1), measuredOn=measured_on,
               params={"capital": capital, "riskPct": risk_pct, "side": side, "horizon": horizon,
                       "instrument": instrument, "lotSize": lot_size})
    with _lock:
        _runs[run_id] = out
        while len(_runs) > RUN_CACHE_SIZE:
            _runs.popitem(last=False)
    return out


def keep(root: str, run_id: str, *, ids: Optional[list] = None, demonstrated: bool = False) -> dict:
    """
    Store rows of a cached run. `demonstrated=True` keeps every row the factory called demonstrated; `ids`
    keeps the named rows, `unproven` ones included, one by one. The rows are read from the cache.
    """
    with _lock:
        run = _runs.get(run_id)
    if run is None:
        return {"ok": False, "gone": True, "reason": "that run is no longer held (the backend restarted or it is old). Evolve again."}
    rows = {r["id"]: r for r in run["ranked"]}
    if demonstrated:
        wanted = [r["id"] for r in run["ranked"] if r.get("verdictClass") == _factory.DEMONSTRATED]
    else:
        wanted = [str(i) for i in (ids or [])]
    if not wanted:
        return {"ok": True, "kept": [], "skipped": [], "note": "nothing to keep: no demonstrated row in this run" if demonstrated else "no ids named"}
    kept, skipped = [], []
    try:
        for tid in wanted:
            row = rows.get(tid)
            if row is None:
                skipped.append({"id": tid, "reason": "not a ranked row of that run"})
                continue
            res = _book.upsert_from_evolution(root, row, symbol=run["symbol"], exchange=run["exchange"],
                                              interval=run["interval"], bars=run["bars"], last_bar=run["lastBar"],
                                              measured_on=run["measuredOn"])
            if res.get("ok"):
                kept.append(dict(res, template=tid))
            else:
                skipped.append({"id": tid, "reason": res.get("reason")})
    except _book.BookCorrupt as exc:
        return dict(_book_error(exc), kept=kept, skipped=skipped)
    return {"ok": True, "kept": kept, "skipped": skipped}


# ── The book ──────────────────────────────────────────────────────────────────

def book_view(root: str, *, include_retired: bool = False, today: Optional[_dt.date] = None) -> dict:
    try:
        rows = _book.list_all(root, include_retired=include_retired)
    except _book.BookCorrupt as exc:
        return _book_error(exc)
    out = [dict(e, stale=_book.is_stale(e, today)) for e in rows]
    counts = {s: 0 for s in _book.STATUSES}
    for e in out:
        counts[e["status"]] = counts.get(e["status"], 0) + 1
    return {"ok": True, "strategies": out, "counts": counts, "staleIds": [e["id"] for e in out if e["stale"] and e["status"] != _book.RETIRED]}


def refresh(root: str, load_bars: LoadBars, *, ids: Optional[list] = None, only_stale: bool = True,
            today: Optional[_dt.date] = None) -> dict:
    """The forward test for the named strategies, or for every stale one. A fault in one does not lose the rest."""
    try:
        entries = [e for e in _book.list_all(root) if (ids is None or e["id"] in ids)]
    except _book.BookCorrupt as exc:
        return _book_error(exc)
    if ids is None and only_stale:
        entries = [e for e in entries if _book.is_stale(e, today)]
    results = []
    for e in entries:
        try:
            bars = load_bars(e["symbol"], e["exchange"], e["interval"])
            if not bars:
                results.append({"ok": False, "id": e["id"], "reason": f"no stored {e['interval']} bars for {e['symbol']}"})
                continue
            model, basis = cost_for(e["spec"], bars)
            res = _book.refresh(root, e["id"], bars, model)
            results.append(dict(res, costBasis=basis, name=e.get("name")))
        except _book.BookCorrupt as exc:
            return dict(_book_error(exc), results=results)
        except Exception as exc:                        # one bad strategy must not stop the others
            results.append({"ok": False, "id": e["id"], "reason": f"forward test failed: {exc}"})
    return {"ok": True, "results": results, "refreshed": sum(1 for r in results if r.get("ok")),
            "proposeRetire": [r["id"] for r in results if r.get("proposeRetire")]}


def signals(root: str, load_bars: LoadBars, *, ids: Optional[list] = None, today: Optional[_dt.date] = None) -> dict:
    """What each stored rule says on the last stored bar, and how old that bar is."""
    try:
        entries = [e for e in _book.list_all(root) if (ids is None or e["id"] in ids)]
    except _book.BookCorrupt as exc:
        return _book_error(exc)
    day = today or _dt.date.today()
    out = []
    for e in entries:
        try:
            bars = load_bars(e["symbol"], e["exchange"], e["interval"])
            if not bars:
                out.append({"id": e["id"], "state": _book.FLAT, "reason": f"no stored {e['interval']} bars", "lastBar": None})
                continue
            st = _book.signal_now(e, bars)
            try:
                st["barAgeDays"] = (day - _dt.date.fromisoformat(str(st["lastBar"])[:10])).days
            except Exception:
                st["barAgeDays"] = None
            out.append(dict(st, id=e["id"], name=e.get("name"), symbol=e["symbol"], status=e["status"]))
        except Exception as exc:
            out.append({"id": e["id"], "state": _book.FLAT, "reason": f"could not read the rule: {exc}", "lastBar": None})
    return {"ok": True, "signals": out}


def retire(root: str, sid: str, reason: str = "") -> dict:
    try:
        return _book.retire(root, sid, reason)
    except _book.BookCorrupt as exc:
        return _book_error(exc)


def restore(root: str, sid: str) -> dict:
    try:
        return _book.restore(root, sid)
    except _book.BookCorrupt as exc:
        return _book_error(exc)


def remove(root: str, sid: str) -> dict:
    try:
        return _book.remove(root, sid)
    except _book.BookCorrupt as exc:
        return _book_error(exc)
