"""
datasets.py - named, immutable candle snapshots (spec Section 153)

The chart shows bars that are a VIEW: changing a parameter or fetching for display writes nothing.
When master wants to keep exactly what he is looking at, for later reference, he saves it under a name.
That is this module. A dataset is a snapshot of the bars passed to `save`, with where it came from, and
it is never changed afterwards: a different snapshot is a different name, or an explicit overwrite.

This is NOT engine input. Strategy, training and outcomes read the keyed working store (`store.py`);
loading a dataset draws it on the chart and nothing else (Section 153.2 item 4).

NAME CONVENTION      SYMBOL.EXCHANGE.INTERVAL.YYYYMMDD.label
    e.g.  NIFTY50.NSE.1d.20261004.pre-budget
The label is [A-Za-z0-9_-]{1,40}. The other parts are fixed by the data, so a name always says what is
inside, and a dataset named for one symbol cannot hold another's bars (checked on save).

STDLIB ONLY (sqlite3), no pandas: it works on plain lists of bar dicts shaped exactly like the /ohlcv
route's, so it is testable without the data stack and the route hands bars straight to the chart.
The directory is passed in, like `strategy_book.py`, so tests never touch real data.

DECISIONS
  - Rollback journal (the default), not WAL. WAL adds -wal/-shm files that must travel with the
    database and misbehave on network or synced folders; this store has one writer at a time and a
    handful of writes a day, so WAL's concurrent-reader advantage buys nothing here.
  - One connection per call, closed on exit. No connection is ever shared between threads.
  - Every write is one `BEGIN IMMEDIATE` transaction: a failed save leaves nothing, and an overwrite
    that fails mid-way leaves the OLD dataset intact. IMMEDIATE takes the write lock up front, so
    concurrent savers queue (busy timeout) instead of failing on a lock upgrade.
  - Reads never create the file or the directory. Only `save` does.
  - Every statement is parameterised. The name is validated against a fixed grammar first, so it can
    never carry a path separator, a space or a quote, and is never used to build a path anyway.

Public functions return dicts {ok, ...}. Expected refusals are values with a `code` and a `reason`; the
route never has to catch an exception for them.
"""

from __future__ import annotations

import datetime as _dt
import math
import os
import re
import sqlite3
from typing import Optional

SCHEMA = 1
DIR = "_datasets"
FILE = "datasets.db"

MAX_BARS = 50000
MAX_LABEL = 40
MAX_NOTE = 300
MAX_SOURCE = 60

_PART = r"[A-Z0-9_-]{1,%d}"
_NAME_RE = re.compile(
    r"(?P<symbol>" + (_PART % 20) + r")\.(?P<exchange>" + (_PART % 12) + r")\.(?P<interval>[a-z0-9_-]{1,8})"
    r"\.(?P<date>[0-9]{8})\.(?P<label>[A-Za-z0-9_-]{1," + str(MAX_LABEL) + r"})"
)
_LABEL_RE = re.compile(r"[A-Za-z0-9_-]{1,%d}" % MAX_LABEL)
_TS_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}( [0-9]{2}:[0-9]{2}:[0-9]{2})?")
_FIELDS = ("open", "high", "low", "close", "volume")

_DDL = """
CREATE TABLE IF NOT EXISTS datasets (
    name        TEXT PRIMARY KEY,
    symbol      TEXT NOT NULL,
    exchange    TEXT NOT NULL,
    interval    TEXT NOT NULL,
    saved_at    TEXT NOT NULL,
    first_bar   TEXT NOT NULL,
    last_bar    TEXT NOT NULL,
    bars_count  INTEGER NOT NULL,
    source      TEXT,
    note        TEXT,
    window_from TEXT,
    window_to   TEXT
);
CREATE TABLE IF NOT EXISTS dataset_bars (
    name   TEXT NOT NULL REFERENCES datasets(name) ON DELETE CASCADE,
    ts     TEXT NOT NULL,
    open   REAL NOT NULL,
    high   REAL NOT NULL,
    low    REAL NOT NULL,
    close  REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (name, ts)
);
CREATE INDEX IF NOT EXISTS idx_dataset_bars_name_ts ON dataset_bars(name, ts);
"""


def _refuse(code: str, reason: str, **extra) -> dict:
    return {"ok": False, "code": code, "reason": reason, **extra}


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def db_path(root: str) -> str:
    return os.path.join(root, DIR, FILE)


# ── names ─────────────────────────────────────────────────────────────────────────────────────────

def clean_part(value: str, width: int, lower: bool = False) -> str:
    """A symbol/exchange/interval made safe for a name: anything outside [A-Za-z0-9_-] becomes '_'.

    '.' is the field separator, so it must never survive into a part (RELIANCE.NS would otherwise
    read as two fields), and `M&M` must not carry an ampersand into a file or a UI string."""
    s = "".join(ch if (ch.isascii() and (ch.isalnum() or ch in "-_")) else "_" for ch in str(value or "").strip())
    s = s[:width] or "X"
    return s.lower() if lower else s.upper()


def suggest_name(symbol: str, exchange: str, interval: str, label: str, today: Optional[_dt.date] = None) -> str:
    """The name the UI proposes. A label that is not valid is replaced by a safe form, never rejected here:
    this only suggests, `validate_name` decides."""
    d = today or _dt.date.today()
    lab = "".join(ch if (ch.isascii() and (ch.isalnum() or ch in "-_")) else "-" for ch in str(label or "").strip())
    lab = lab[:MAX_LABEL] or "snapshot"
    return (f"{clean_part(symbol, 20)}.{clean_part(exchange, 12)}.{clean_part(interval, 8, lower=True)}"
            f".{d.strftime('%Y%m%d')}.{lab}")


def validate_name(name) -> dict:
    """{ok, parts} for a name that follows the convention and nothing else. Total: never raises."""
    if not isinstance(name, str):
        return _refuse("bad-name", "a dataset name must be text")
    if len(name) > 120:
        return _refuse("bad-name", "that name is too long")
    m = _NAME_RE.fullmatch(name)
    if not m:
        return _refuse("bad-name", "names look like SYMBOL.EXCHANGE.INTERVAL.YYYYMMDD.label, where the label "
                                   "is 1-40 letters, digits, '-' or '_'")
    parts = m.groupdict()
    try:
        _dt.datetime.strptime(parts["date"], "%Y%m%d")
    except ValueError:
        return _refuse("bad-name", "the date part of the name is not a real date")
    return {"ok": True, "parts": parts}


def validate_label(label) -> dict:
    if not isinstance(label, str) or not _LABEL_RE.fullmatch(label):
        return _refuse("bad-label", "a label is 1-40 letters, digits, '-' or '_'")
    return {"ok": True}


# ── bars ──────────────────────────────────────────────────────────────────────────────────────────

def _check_bars(bars) -> dict:
    """Validate and normalise the payload. Returns {ok, rows} with rows as tuples ready to insert."""
    if not isinstance(bars, (list, tuple)) or len(bars) == 0:
        return _refuse("empty", "there are no bars to save")
    if len(bars) > MAX_BARS:
        return _refuse("too-many", f"{len(bars)} bars is more than a dataset may hold ({MAX_BARS}); narrow the dates")
    rows = []
    prev = None
    for i, b in enumerate(bars):
        if not isinstance(b, dict):
            return _refuse("bad-bars", f"bar {i} is not a bar")
        ts = b.get("date")
        if not isinstance(ts, str) or not _TS_RE.fullmatch(ts):
            return _refuse("bad-bars", f"bar {i} has no valid date")
        vals = []
        for f in _FIELDS:
            v = b.get(f)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                return _refuse("bad-bars", f"bar {i} has a missing or non-numeric {f}")
            vals.append(float(v))
        if prev is not None and ts <= prev:
            # A snapshot is a chronological series. Out-of-order or repeated stamps mean the caller built
            # it wrongly, and the primary key would collapse them silently if they were let through.
            return _refuse("bad-bars", f"bar {i} is not later than the bar before it")
        prev = ts
        rows.append((ts, *vals))
    return {"ok": True, "rows": rows}


def _bar_dict(row) -> dict:
    return {"date": row[0], "open": row[1], "high": row[2], "low": row[3], "close": row[4], "volume": row[5]}


def _meta_dict(r) -> dict:
    return {"name": r[0], "symbol": r[1], "exchange": r[2], "interval": r[3], "savedAt": r[4],
            "firstBar": r[5], "lastBar": r[6], "bars": r[7], "source": r[8], "note": r[9],
            "windowFrom": r[10], "windowTo": r[11]}


_META_COLS = ("name, symbol, exchange, interval, saved_at, first_bar, last_bar, bars_count, "
              "source, note, window_from, window_to")


# ── connection ────────────────────────────────────────────────────────────────────────────────────

def _connect(path: str) -> sqlite3.Connection:
    # isolation_level=None: transactions are explicit (BEGIN IMMEDIATE ... COMMIT), never implicit.
    conn = sqlite3.connect(path, timeout=15.0, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")      # off by default per connection; the cascade depends on it
    return conn


def _insert_bars(conn: sqlite3.Connection, name: str, rows: list) -> None:
    """Insert the bars of one dataset. A separate function so a test can make it fail midway."""
    conn.executemany(
        "INSERT INTO dataset_bars (name, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(name, *r) for r in rows])


# ── the five acts ─────────────────────────────────────────────────────────────────────────────────

def save(root: str, *, name: str, symbol: str, exchange: str, interval: str, bars,
         source: str = "", note: str = "", window_from: Optional[str] = None,
         window_to: Optional[str] = None, overwrite: bool = False) -> dict:
    """Snapshot exactly `bars` under `name`. A name that exists is refused unless `overwrite` is True."""
    v = validate_name(name)
    if not v["ok"]:
        return v
    p = v["parts"]
    want = (clean_part(symbol, 20), clean_part(exchange, 12), clean_part(interval, 8, lower=True))
    if (p["symbol"], p["exchange"], p["interval"]) != want:
        return _refuse("name-mismatch", f"the name says {p['symbol']}.{p['exchange']}.{p['interval']} but the "
                                        f"bars are {want[0]}.{want[1]}.{want[2]}")
    chk = _check_bars(bars)
    if not chk["ok"]:
        return chk
    rows = chk["rows"]
    src = str(source or "")[:MAX_SOURCE]
    nt = str(note or "")[:MAX_NOTE]
    wf = str(window_from)[:10] if window_from else None
    wt = str(window_to)[:10] if window_to else None

    path = db_path(root)
    conn = None
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = _connect(path)
        conn.execute("BEGIN IMMEDIATE")
        try:
            # Statement by statement: executescript would COMMIT first and end this transaction.
            for stmt in _DDL.strip().split(";"):
                if stmt.strip():
                    conn.execute(stmt)
            existing = conn.execute("SELECT name FROM datasets WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
            if existing and overwrite is not True:          # only the boolean True, never a truthy string
                conn.execute("ROLLBACK")
                return _refuse("exists", f"a dataset named {existing[0]} already exists; choose another label or "
                                         f"tick overwrite", name=existing[0])
            if existing:
                conn.execute("DELETE FROM datasets WHERE name = ?", (existing[0],))     # cascades to its bars
            conn.execute(
                "INSERT INTO datasets (name, symbol, exchange, interval, saved_at, first_bar, last_bar, "
                "bars_count, source, note, window_from, window_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (name, p["symbol"], p["exchange"], p["interval"], _now_iso(), rows[0][0], rows[-1][0],
                 len(rows), src, nt, wf, wt))
            _insert_bars(conn, name, rows)
            conn.execute("COMMIT")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass                                    # SQLite already rolled back on its own error
            raise
        return {"ok": True, "name": name, "bars": len(rows), "firstBar": rows[0][0], "lastBar": rows[-1][0],
                "overwritten": bool(existing)}
    except sqlite3.Error as exc:
        return _refuse("io", f"the dataset could not be saved: {exc}")
    except OSError as exc:
        return _refuse("io", f"the dataset could not be saved: {exc}")
    except Exception as exc:                            # a failure injected or unforeseen: still a value
        return _refuse("io", f"the dataset could not be saved: {exc}")
    finally:
        if conn is not None:
            conn.close()


def list_datasets(root: str) -> dict:
    """Every saved dataset, newest first. Never creates the file: no database means no datasets."""
    path = db_path(root)
    if not os.path.exists(path):
        return {"ok": True, "datasets": []}
    conn = None
    try:
        conn = _connect(path)
        rows = conn.execute(f"SELECT {_META_COLS} FROM datasets ORDER BY saved_at DESC, name ASC").fetchall()
        return {"ok": True, "datasets": [_meta_dict(r) for r in rows]}
    except sqlite3.Error as exc:
        return _refuse("io", f"the dataset list could not be read: {exc}")
    finally:
        if conn is not None:
            conn.close()


def load(root: str, name: str) -> dict:
    """{ok, meta, bars} with bars shaped like the /ohlcv route's, oldest first."""
    v = validate_name(name)
    if not v["ok"]:
        return v
    path = db_path(root)
    if not os.path.exists(path):
        return _refuse("missing", "no such dataset")
    conn = None
    try:
        conn = _connect(path)
        m = conn.execute(f"SELECT {_META_COLS} FROM datasets WHERE name = ?", (name,)).fetchone()
        if not m:
            return _refuse("missing", "no such dataset")
        rows = conn.execute("SELECT ts, open, high, low, close, volume FROM dataset_bars "
                            "WHERE name = ? ORDER BY ts ASC", (name,)).fetchall()
        return {"ok": True, "meta": _meta_dict(m), "bars": [_bar_dict(r) for r in rows]}
    except sqlite3.Error as exc:
        return _refuse("io", f"the dataset could not be read: {exc}")
    finally:
        if conn is not None:
            conn.close()


def delete(root: str, name: str) -> dict:
    """Remove one dataset and its bars together. The confirmation is the caller's; this is the act."""
    v = validate_name(name)
    if not v["ok"]:
        return v
    path = db_path(root)
    if not os.path.exists(path):
        return _refuse("missing", "no such dataset")
    conn = None
    try:
        conn = _connect(path)
        conn.execute("BEGIN IMMEDIATE")
        try:
            cur = conn.execute("DELETE FROM datasets WHERE name = ?", (name,))      # bars go with it (cascade)
            gone = cur.rowcount
            conn.execute("COMMIT")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        if not gone:
            return _refuse("missing", "no such dataset")
        return {"ok": True, "name": name}
    except sqlite3.Error as exc:
        return _refuse("io", f"the dataset could not be deleted: {exc}")
    finally:
        if conn is not None:
            conn.close()
