"""
The position ledger — what master actually has on the table (spec Section 74).

Everything else in StockMind is either a claim about the future (`/predict`) or a score of
past claims (`outcomes`). Neither knows whether master has money at risk. A position is a
third kind of object: it has a cost, it moves every session, and being wrong about it costs
capital rather than accuracy.

TWO RULES THIS MODULE EXISTS TO HOLD:

1. A position is a LIST OF FILLS, never a single entry price. Master asked to be told when to
   "buy more/sell more", so the record has to survive the very action Rāma recommends. One
   `entryPrice` field cannot hold "bought 100 at 2,400, added 50 at 2,310" without destroying
   one of the two prices, and the average is not recoverable afterwards.

2. Nothing derived is ever stored. Net quantity, average cost, realised and unrealised P&L are
   all computed on read by `derive()`. A stored total is a second source of truth that goes
   stale the instant a fill is corrected.

THIS IS NOT A TAX OR ACCOUNTING RECORD. Average cost is weighted-average, which is what an
Indian broker shows on a holdings screen so master can reconcile it against his account.
Indian equity tax is FIFO; because every fill is kept with its date, FIFO is derivable later
without a migration, but it is not what these numbers are.

THE FILE IS PLAINTEXT ON DISK — see Section 74. It describes master's real exposure. `data/`
is gitignored so it cannot leave the machine through git, but anyone who can read the data
directory can read it. Moving it behind Electron's encrypted `dataStore` is a decision for
master, and it would cost mark-to-market inside this engine.
"""

import logging
import os
import uuid
import datetime as _dt
from typing import Optional

from . import store

# The proven atomic JSONL helpers, deliberately reused rather than reimplemented. They carry a
# Windows sharing-violation retry around `os.replace` that was written against a real failure
# (Section 68); a second copy here would be a second thing to get right.
from .outcomes import _read_jsonl, _rewrite_jsonl

logger = logging.getLogger("stockmind.ledger")

SIDES = ("BUY", "SELL")
INSTRUMENT_TYPES = ("EQUITY", "FUTURES", "OPTIONS")
STATUS_OPEN = "open"
STATUS_CLOSED = "closed"

# A tracked position whose price is older than this is not marked to market silently.
MAX_PRICE_AGE_DAYS = 5


# ── Paths ─────────────────────────────────────────────────────────────────────

def _dir() -> str:
    d = os.path.join(store.store_root(), "_ledger")
    os.makedirs(d, exist_ok=True)
    return d


def positions_path() -> str:
    return os.path.join(_dir(), "positions.jsonl")


# ── Validation ────────────────────────────────────────────────────────────────

def _now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def _norm_date(value) -> str:
    """
    A fill date, normalised but never invented.

    Accepts a date, a datetime, "YYYY-MM-DD" or a full ISO timestamp. An unparseable value is
    an error rather than a silent `today()` — a fill on the wrong date produces a wrong average
    cost and a wrong holding period, and master would have no way to see it happened.
    """
    if value in (None, ""):
        return _dt.date.today().isoformat()
    if isinstance(value, _dt.datetime):
        return value.date().isoformat()
    if isinstance(value, _dt.date):
        return value.isoformat()
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return _dt.datetime.strptime(text[:len(fmt) + 2].strip(), fmt).date().isoformat()
        except ValueError:
            continue
    try:
        return _dt.datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        raise ValueError(f"unrecognised date {value!r} — use YYYY-MM-DD")


def _positive(value, label: str) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a number, got {value!r}")
    if not out > 0:
        raise ValueError(f"{label} must be greater than zero, got {out}")
    if out != out or out in (float("inf"), float("-inf")):
        raise ValueError(f"{label} must be finite")
    return out


def _side(value: str) -> str:
    s = str(value or "").strip().upper()
    if s in ("B", "LONG", "BUY"):
        return "BUY"
    if s in ("S", "SHORT", "SELL"):
        return "SELL"
    raise ValueError(f"side must be BUY or SELL, got {value!r}")


def _instr(value: Optional[str]) -> str:
    s = str(value or "EQUITY").strip().upper()
    if s not in INSTRUMENT_TYPES:
        raise ValueError(f"instrType must be one of {', '.join(INSTRUMENT_TYPES)}, got {value!r}")
    return s


def _sign(x: float) -> int:
    return 1 if x > 0 else (-1 if x < 0 else 0)


def _clean_thesis(thesis: Optional[dict]) -> dict:
    """
    The projection the position was opened on.

    Kept because master's instruction was "based on projection he made the decision of
    investing". Without it, "was I right, or lucky?" has no answer later and an exit alert
    would be reasoning about a number with no intent attached.
    """
    t = dict(thesis or {})
    out = {
        "direction": (str(t.get("direction") or "").strip().upper() or None),
        "horizon": t.get("horizon"),
        "targetPrice": t.get("targetPrice"),
        "stopPrice": t.get("stopPrice"),
        "probability": t.get("probability"),
        "predictionId": t.get("predictionId"),
        "rationale": t.get("rationale"),
        "recordedAt": t.get("recordedAt") or _now(),
    }
    for k in ("targetPrice", "stopPrice", "probability"):
        if out[k] is not None:
            try:
                out[k] = float(out[k])
            except (TypeError, ValueError):
                out[k] = None
    if out["direction"] not in ("LONG", "SHORT", "UP", "DOWN", None):
        out["direction"] = None
    return out


# ── The money math, in exactly one place ──────────────────────────────────────

def replay(fills: list) -> dict:
    """
    Walk the fills in order and produce net quantity, average cost, realised P&L and fees.

    SIGNED QUANTITY, so a short is the same code path as a long: BUY is +q, SELL is −q, and
    `netQty < 0` is short. Two branches for long and short would be two places for the sign to
    be wrong, and this is master's capital.

    - a fill in the same direction as the current net is an ADD, and re-averages the cost
    - a fill against the net is a REDUCE, and realises (fillPrice − avgCost) × closed × sign
    - a fill larger than the open quantity closes it and opens the remainder the other way

    Realised P&L uses the average cost AT THE MOMENT OF THE REDUCING FILL, not the final
    average, so a later add cannot retroactively rewrite a profit already booked.

    Fills are ordered by date, with the stored order as the tie-break: intraday ordering of two
    fills on the same date is not recoverable from a date alone, so the order master entered
    them in is used, and that choice is stated rather than hidden.
    """
    ordered = sorted(enumerate(fills or []), key=lambda p: (str(p[1].get("date") or ""), p[0]))

    net = 0.0
    avg = 0.0
    realised = 0.0
    fees_total = 0.0
    bought = 0.0
    sold = 0.0

    for _, f in ordered:
        try:
            qty = float(f.get("quantity") or 0)
            price = float(f.get("price") or 0)
        except (TypeError, ValueError):
            logger.warning("[ledger] skipping a fill with a non-numeric quantity or price")
            continue
        if qty <= 0:
            continue
        fees_total += float(f.get("fees") or 0)
        signed = qty if str(f.get("side")).upper() == "BUY" else -qty
        if signed > 0:
            bought += qty
        else:
            sold += qty

        if net == 0:
            net, avg = signed, price
            continue

        if _sign(signed) == _sign(net):
            total = abs(net) + abs(signed)
            avg = (avg * abs(net) + price * abs(signed)) / total
            net += signed
            continue

        closed = min(abs(signed), abs(net))
        realised += (price - avg) * closed * _sign(net)
        new_net = net + signed
        if new_net == 0:
            avg = 0.0
        elif _sign(new_net) != _sign(net):
            # Reversed through flat: the remainder is a new position at this fill's price.
            avg = price
        net = new_net

    return {"netQty": net, "avgCost": avg, "realisedPnl": realised,
            "feesTotal": fees_total, "totalBought": bought, "totalSold": sold,
            "fillCount": len(fills or [])}


def _round(x, n: int = 2):
    return None if x is None else round(float(x), n)


def derive(position: dict, last_price: Optional[float] = None,
           price_as_of: Optional[str] = None,
           price_stale: Optional[bool] = None,
           price_note: Optional[str] = None) -> dict:
    """
    A position plus a price becomes a decision-ready view. The single implementation.

    MARK-TO-MARKET NEVER INVENTS A PRICE. With no price the P&L fields are `None` and
    `priceStale` says so; it does not fall back to the entry price and call the difference
    zero P&L. Section 66's rule applied to money: a missing input is reported, not substituted.
    """
    fills = position.get("fills") or []
    r = replay(fills)
    net = r["netQty"]
    avg = r["avgCost"]
    open_qty = abs(net)
    invested = open_qty * avg

    unrealised = None
    market_value = None
    pnl_pct = None
    if net != 0 and last_price is not None:
        unrealised = (float(last_price) - avg) * net
        market_value = open_qty * float(last_price)
        pnl_pct = (unrealised / invested * 100.0) if invested else None

    net_pnl = r["realisedPnl"] - r["feesTotal"]
    if unrealised is not None:
        net_pnl += unrealised

    dates = [str(f.get("date")) for f in fills if f.get("date")]
    first_date = min(dates) if dates else None
    last_fill_date = max(dates) if dates else None
    days_held = None
    if first_date:
        try:
            end = (_dt.date.fromisoformat(position["closedAt"][:10])
                   if position.get("closedAt") else _dt.date.today())
            days_held = (end - _dt.date.fromisoformat(first_date)).days
        except (ValueError, KeyError, TypeError):
            days_held = None

    flags = []
    if net < 0 and position.get("instrType") == "EQUITY":
        flags.append("net short on equity — deliverable short selling is not permitted in "
                     "Indian cash equity, so this must be an intraday position")
    if price_stale:
        flags.append(price_note or "price is stale, so P&L is not current")
    if net != 0 and last_price is None:
        flags.append("no stored price for this symbol, so unrealised P&L cannot be computed")

    return {
        "positionId": position.get("positionId"),
        "symbol": position.get("symbol"),
        "exchange": position.get("exchange"),
        "instrType": position.get("instrType"),
        "status": position.get("status"),
        "direction": "LONG" if net > 0 else ("SHORT" if net < 0 else "FLAT"),
        "netQty": _round(net, 4),
        "avgCost": _round(avg, 4),
        "investedValue": _round(invested),
        "lastPrice": _round(last_price, 4) if last_price is not None else None,
        "marketValue": _round(market_value),
        "realisedPnl": _round(r["realisedPnl"]),
        "unrealisedPnl": _round(unrealised),
        "feesTotal": _round(r["feesTotal"]),
        "netPnl": _round(net_pnl),
        "pnlPct": _round(pnl_pct, 2),
        "totalBought": _round(r["totalBought"], 4),
        "totalSold": _round(r["totalSold"], 4),
        "fillCount": r["fillCount"],
        "openedAt": position.get("openedAt"),
        "closedAt": position.get("closedAt"),
        "firstFillDate": first_date,
        "lastFillDate": last_fill_date,
        "daysHeld": days_held,
        "priceAsOf": price_as_of,
        "priceStale": bool(price_stale) if price_stale is not None else None,
        "thesis": position.get("thesis"),
        "flags": flags,
    }


# ── Pricing ───────────────────────────────────────────────────────────────────

def last_close(symbol: str, exchange: str = "NSE", interval: str = "1d",
               newest_fill: Optional[str] = None) -> dict:
    """
    The last stored close for a symbol, with an honest account of how old it is.

    Returns `price=None` rather than guessing. A price older than the newest fill is reported
    stale even if it is recent in absolute terms, because a position opened after the last
    stored bar cannot be marked to market at all.
    """
    out = {"price": None, "asOf": None, "stale": True, "note": None, "bars": 0}
    try:
        df = store.load(symbol, exchange, interval)
    except Exception as e:
        out["note"] = f"could not read stored bars: {type(e).__name__}: {e}"
        return out
    if df is None or len(df) == 0 or "close" not in df.columns:
        out["note"] = f"no stored {interval} bars for {symbol} — run a sync first"
        return out

    out["bars"] = int(len(df))
    tail = df.dropna(subset=["close"])
    if len(tail) == 0:
        out["note"] = "stored bars carry no close price"
        return out

    row = tail.iloc[-1]
    try:
        out["price"] = float(row["close"])
    except (TypeError, ValueError):
        out["note"] = "the last stored close is not a number"
        out["price"] = None
        return out

    # `store.load` parses the date column, so a daily bar comes back as a Timestamp and
    # stringifies to "2026-08-28 00:00:00". Reporting a midnight on a daily bar invites the
    # reader to think the price is from midnight. An INTRADAY bar's time is real information,
    # so it is kept — the same distinction `store._date_format_for` draws on the way in.
    raw = row.get("date")
    if store.is_intraday(interval):
        out["asOf"] = str(raw)
    else:
        out["asOf"] = str(raw)[:10]

    as_of_date = None
    try:
        as_of_date = _dt.date.fromisoformat(str(row.get("date"))[:10])
    except ValueError:
        pass

    if as_of_date is None:
        out["note"] = "the last bar's date could not be read, so its age is unknown"
        return out

    age = (_dt.date.today() - as_of_date).days
    if newest_fill:
        try:
            if as_of_date < _dt.date.fromisoformat(str(newest_fill)[:10]):
                out["note"] = (f"the newest stored bar ({out['asOf']}) is older than the newest "
                               f"fill ({newest_fill}) — this position cannot be marked to market")
                return out
        except ValueError:
            pass
    if age > MAX_PRICE_AGE_DAYS:
        out["note"] = f"the newest stored bar is {age} days old — sync before trusting P&L"
        return out

    out["stale"] = False
    return out


# ── Persistence ───────────────────────────────────────────────────────────────

def _all() -> list[dict]:
    return _read_jsonl(positions_path())


def _save(rows: list[dict]) -> None:
    _rewrite_jsonl(positions_path(), rows)


def _find(rows: list[dict], position_id: str) -> int:
    for i, r in enumerate(rows):
        if r.get("positionId") == position_id:
            return i
    raise KeyError(f"no position {position_id}")


def _make_fill(side, quantity, price, date=None, fees=0.0, note=None,
               prediction_id=None) -> dict:
    return {
        "fillId": uuid.uuid4().hex[:12],
        "side": _side(side),
        "quantity": _positive(quantity, "quantity"),
        "price": _positive(price, "price"),
        "date": _norm_date(date),
        "fees": max(0.0, float(fees or 0)),
        "note": (str(note).strip() or None) if note else None,
        "predictionId": prediction_id or None,
        "recordedAt": _now(),
    }


# ── Public API ────────────────────────────────────────────────────────────────

def open_position(symbol: str, exchange: str = "NSE", instr_type: str = "EQUITY",
                  side: str = "BUY", quantity: float = 0, price: float = 0,
                  date=None, fees: float = 0.0, thesis: Optional[dict] = None,
                  note: Optional[str] = None, prediction_id: Optional[str] = None,
                  interval: str = "1d") -> dict:
    """
    Record a position master has taken.

    An existing OPEN position for the same (symbol, exchange, instrType) is added to rather
    than duplicated — two open rows for the same holding would each show a different average
    cost for the same money, and neither would match the broker.
    """
    sym = str(symbol or "").strip().upper()
    if not sym:
        raise ValueError("symbol is required")
    itype = _instr(instr_type)
    fill = _make_fill(side, quantity, price, date, fees, note, prediction_id)

    rows = _all()
    for i, r in enumerate(rows):
        if (r.get("symbol") == sym and r.get("exchange") == exchange
                and r.get("instrType") == itype and r.get("status") == STATUS_OPEN):
            rows[i].setdefault("fills", []).append(fill)
            if thesis:
                rows[i]["thesis"] = _clean_thesis(thesis)
            rows[i]["updatedAt"] = _now()
            rows[i] = _settle(rows[i])
            _save(rows)
            return {"ok": True, "created": False, "addedToExisting": True,
                    "position": _mark(rows[i], interval)}

    pos = {
        "positionId": uuid.uuid4().hex[:12],
        "symbol": sym, "exchange": exchange, "instrType": itype,
        "openedAt": _now(), "closedAt": None, "status": STATUS_OPEN,
        "thesis": _clean_thesis(thesis),
        "fills": [fill],
        "notes": [],
        "updatedAt": _now(),
    }
    pos = _settle(pos)
    rows.append(pos)
    _save(rows)
    return {"ok": True, "created": True, "addedToExisting": False,
            "position": _mark(pos, interval)}


def add_fill(position_id: str, side: str, quantity: float, price: float,
             date=None, fees: float = 0.0, note: Optional[str] = None,
             prediction_id: Optional[str] = None, interval: str = "1d") -> dict:
    """Add to, or reduce, a tracked position. This is the "buy more/sell more" path."""
    rows = _all()
    i = _find(rows, position_id)
    rows[i].setdefault("fills", []).append(
        _make_fill(side, quantity, price, date, fees, note, prediction_id))
    rows[i]["updatedAt"] = _now()
    rows[i] = _settle(rows[i])
    _save(rows)
    return {"ok": True, "position": _mark(rows[i], interval)}


def close_position(position_id: str, price: float, date=None, fees: float = 0.0,
                   note: Optional[str] = None, interval: str = "1d") -> dict:
    """
    Exit the whole open quantity at one price.

    Writes the closing fill rather than only flipping the status, so realised P&L stays
    derivable from the fills alone and the exit price is on the record.
    """
    rows = _all()
    i = _find(rows, position_id)
    state = replay(rows[i].get("fills") or [])
    net = state["netQty"]
    if net == 0:
        rows[i]["status"] = STATUS_CLOSED
        rows[i]["closedAt"] = rows[i].get("closedAt") or _now()
        _save(rows)
        return {"ok": True, "alreadyFlat": True, "position": _mark(rows[i], interval)}

    rows[i]["fills"].append(_make_fill("SELL" if net > 0 else "BUY", abs(net), price,
                                       date, fees, note or "closing fill"))
    rows[i]["updatedAt"] = _now()
    rows[i] = _settle(rows[i])
    _save(rows)
    return {"ok": True, "alreadyFlat": False, "position": _mark(rows[i], interval)}


def remove_fill(position_id: str, fill_id: str, interval: str = "1d") -> dict:
    """
    Delete a fill master entered by mistake.

    A correction has to be possible or the ledger stops matching reality and master stops
    using it. The removal is recorded in `notes` so the history is not silently rewritten.
    """
    rows = _all()
    i = _find(rows, position_id)
    fills = rows[i].get("fills") or []
    keep = [f for f in fills if f.get("fillId") != fill_id]
    if len(keep) == len(fills):
        raise KeyError(f"no fill {fill_id} on position {position_id}")
    removed = next(f for f in fills if f.get("fillId") == fill_id)
    rows[i]["fills"] = keep
    rows[i].setdefault("notes", []).append({
        "at": _now(), "kind": "fill-removed",
        "text": (f"removed {removed.get('side')} {removed.get('quantity')} @ "
                 f"{removed.get('price')} dated {removed.get('date')}"),
    })
    rows[i]["updatedAt"] = _now()
    rows[i] = _settle(rows[i])
    _save(rows)
    return {"ok": True, "removed": removed, "position": _mark(rows[i], interval)}


def set_thesis(position_id: str, thesis: dict, interval: str = "1d") -> dict:
    """
    Replace the projection a position is being held on.

    The previous thesis is kept in `notes`. Master revising his reason is information — an exit
    alert that fires against a thesis he abandoned two months ago is noise.
    """
    rows = _all()
    i = _find(rows, position_id)
    old = rows[i].get("thesis")
    rows[i]["thesis"] = _clean_thesis(thesis)
    if old:
        rows[i].setdefault("notes", []).append({
            "at": _now(), "kind": "thesis-replaced", "previous": old})
    rows[i]["updatedAt"] = _now()
    _save(rows)
    return {"ok": True, "position": _mark(rows[i], interval)}


def add_note(position_id: str, text: str) -> dict:
    rows = _all()
    i = _find(rows, position_id)
    rows[i].setdefault("notes", []).append({"at": _now(), "kind": "note",
                                            "text": str(text or "").strip()})
    rows[i]["updatedAt"] = _now()
    _save(rows)
    return {"ok": True, "positionId": position_id,
            "noteCount": len(rows[i]["notes"])}


def _settle(pos: dict) -> dict:
    """Flat means closed; a re-entry on a closed position reopens it."""
    net = replay(pos.get("fills") or [])["netQty"]
    if net == 0 and (pos.get("fills") or []):
        pos["status"] = STATUS_CLOSED
        pos["closedAt"] = pos.get("closedAt") or _now()
    else:
        pos["status"] = STATUS_OPEN
        pos["closedAt"] = None
    return pos


def _mark(pos: dict, interval: str = "1d") -> dict:
    fills = pos.get("fills") or []
    newest = max([str(f.get("date")) for f in fills if f.get("date")], default=None)
    px = last_close(pos.get("symbol"), pos.get("exchange") or "NSE", interval, newest)
    return derive(pos, px["price"], px["asOf"], px["stale"], px["note"])


def positions(status: Optional[str] = None, symbol: Optional[str] = None,
              interval: str = "1d") -> list[dict]:
    rows = _all()
    if status:
        rows = [r for r in rows if r.get("status") == status]
    if symbol:
        rows = [r for r in rows if r.get("symbol") == str(symbol).strip().upper()]
    rows.sort(key=lambda r: str(r.get("openedAt") or ""), reverse=True)
    return [_mark(r, interval) for r in rows]


def position_detail(position_id: str, interval: str = "1d") -> dict:
    rows = _all()
    i = _find(rows, position_id)
    view = _mark(rows[i], interval)
    view["fills"] = sorted(rows[i].get("fills") or [],
                           key=lambda f: str(f.get("date") or ""))
    view["notes"] = rows[i].get("notes") or []
    return view


def portfolio(interval: str = "1d") -> dict:
    """
    The whole book. Open exposure, realised and unrealised P&L, and what could not be priced.

    `unpriced` is reported as its own count rather than folded into the totals as zero, because
    a portfolio total that quietly excludes positions is the kind of number that gets acted on.
    """
    views = positions(interval=interval)
    open_views = [v for v in views if v["status"] == STATUS_OPEN]

    invested = sum(v["investedValue"] or 0 for v in open_views)
    market = sum(v["marketValue"] or 0 for v in open_views if v["marketValue"] is not None)
    unreal = sum(v["unrealisedPnl"] or 0 for v in open_views if v["unrealisedPnl"] is not None)
    real = sum(v["realisedPnl"] or 0 for v in views)
    fees = sum(v["feesTotal"] or 0 for v in views)
    unpriced = [v["symbol"] for v in open_views if v["unrealisedPnl"] is None]
    stale = [v["symbol"] for v in open_views if v.get("priceStale")]

    priced_invested = sum(v["investedValue"] or 0 for v in open_views
                          if v["unrealisedPnl"] is not None)

    return {
        "positions": len(views),
        "openPositions": len(open_views),
        "closedPositions": len(views) - len(open_views),
        "investedValue": _round(invested),
        "marketValue": _round(market),
        "unrealisedPnl": _round(unreal),
        "realisedPnl": _round(real),
        "feesTotal": _round(fees),
        "netPnl": _round(real + unreal - fees),
        "unrealisedPct": _round((unreal / priced_invested * 100.0) if priced_invested else None, 2),
        "unpricedSymbols": unpriced,
        "stalePriceSymbols": stale,
        "priceCoverage": (f"{len(open_views) - len(unpriced)} of {len(open_views)} open "
                          f"positions could be marked to market"),
        "symbols": sorted({v["symbol"] for v in open_views}),
        "generatedAt": _now(),
    }
