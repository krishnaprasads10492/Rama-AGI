"""
store.py — the local historical bar store.

WHY THIS IS THE ANSWER TO "READ DATA FROM AS FAR BACK AS POSSIBLE".

You do not get thirty years of history from an API call at request time. Every free
provider rate-limits, and the deep-history ones charge per call. What you do is fetch
the deepest history **once**, keep it on disk, and top it up with the handful of bars
that appeared since. After the first fetch a decade of daily bars is available offline,
instantly, and identically on every run — which is also what makes a backtest
reproducible instead of dependent on whoever answered the HTTP call that day.

So the store is not a cache in front of the providers. It is the primary source, and the
providers exist to fill and extend it.

PROPERTIES THAT MATTER FOR A BACKTEST

  - Append-only by date, de-duplicated on the date key. A re-fetch that overlaps
    existing bars corrects them rather than duplicating them.
  - Never silently truncates. A provider returning a shorter window than what is
    already stored merges into it instead of replacing it — losing history to a bad
    response would be invisible and unrecoverable.
  - Records provenance per symbol: which provider, when, how many bars, what range. A
    backtest over data of unknown origin is not evidence.

CSV, not parquet. `pyarrow` is a large dependency and this project pins deliberately
(I12); CSV is readable by hand, diffable, and fast enough for daily bars — a 30-year
daily series is about 7,500 rows.
"""

import os
import json
import logging
import threading
import time
import datetime as _dt
from typing import Optional

import pandas as pd

logger = logging.getLogger("stockmind-ai.store")

COLUMNS = ["date", "open", "high", "low", "close", "volume"]

# A series does not have to be OHLCV. `derivatives.py` stores one row of derived
# option/future metrics per symbol per day, and it needs exactly the properties this
# module already has and that are easy to get wrong: de-duplication on the date key,
# a refusal to shrink, atomic replacement, provenance, business-day staleness.
#
# So the column set is a parameter, defaulting to OHLCV. Every existing caller is
# unchanged (I11 — additive), and there is no second store to drift out of sync. Ledger
# row 19 exists because nineteen subsystems were once duplicated this way.
#
# `required` names the columns a row cannot be missing. For bars that is `close`, since a
# bar with no close is not a bar. For a derived series it is only `date`, because a
# legitimate row may have every metric null on a day with no open interest.
def _column_spec(columns: Optional[list] = None) -> tuple[list, list]:
    if not columns:
        return COLUMNS, ["date", "close"]
    cols = list(columns)
    if "date" not in cols:
        cols = ["date"] + cols
    return cols, ["date"]


def _root_path() -> str:
    """Where bars live, without creating it. Reads use this: looking must not write (Section 153)."""
    root = os.environ.get("STOCKMIND_DATA_DIR")
    if not root:
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "history")
    return root


def store_root() -> str:
    """
    Where bars live. `STOCKMIND_DATA_DIR` overrides, which is how the Electron side
    points this at `userData` so a packaged app writes somewhere writable rather than
    next to a read-only executable.

    Still creates the directory: the book, ledger and dataset modules are handed this path and
    write beneath it. Only the bar READ paths below avoid the mkdir.
    """
    root = _root_path()
    os.makedirs(root, exist_ok=True)
    return root


def _safe(name: str) -> str:
    return "".join(ch if (ch.isalnum() or ch in "-_") else "_" for ch in (name or "unknown").upper())


def paths(symbol: str, exchange: str = "NSE", interval: str = "1d", create: bool = False):
    """
    The csv and meta paths for a series.

    `create` is False for reads. This used to makedirs on every call, so merely asking whether a
    series existed created an empty exchange directory, and a view-only fetch (Section 153) could
    not honestly claim to write nothing. Only the write path passes `create=True`.
    """
    base = os.path.join(_root_path(), _safe(exchange))
    if create:
        os.makedirs(base, exist_ok=True)
    stem = f"{_safe(symbol)}__{_safe(interval)}"
    return os.path.join(base, stem + ".csv"), os.path.join(base, stem + ".meta.json")


# One lock per series, so two requests merging into the same file cannot interleave their
# load -> union -> write (a lost update, or two writers on one temp name). A series is keyed by
# its csv path; different series never contend. In-process only: the engine is one process.
_locks: dict = {}
_locks_guard = threading.Lock()


def _lock_for(csv_path: str) -> threading.Lock:
    key = os.path.normcase(os.path.abspath(csv_path))
    with _locks_guard:
        lk = _locks.get(key)
        if lk is None:
            lk = _locks[key] = threading.Lock()
        return lk


def _replace_with_retry(tmp: str, dest: str) -> None:
    """os.replace, retried briefly: on Windows a scanner or reader can hold the target for a moment."""
    last = None
    for i in range(10):
        try:
            os.replace(tmp, dest)
            return
        except PermissionError as exc:
            last = exc
            time.sleep(0.05 * (i + 1))
    raise last if last else OSError(f"could not replace {dest}")


# ── Read ──────────────────────────────────────────────────────────────────────

def load(symbol: str, exchange: str = "NSE", interval: str = "1d",
         columns: Optional[list] = None) -> Optional[pd.DataFrame]:
    cols, _ = _column_spec(columns)
    csv_path, _ = paths(symbol, exchange, interval)
    if not os.path.exists(csv_path):
        return None
    try:
        for attempt in range(3):
            try:
                df = pd.read_csv(csv_path, parse_dates=["date"])
                break
            except PermissionError:
                # A writer's os.replace can hold the file for an instant on Windows; reading it
                # as "no data" would make a concurrent view of a series flicker empty.
                if attempt == 2:
                    raise
                time.sleep(0.03 * (attempt + 1))
        if df is None or len(df) == 0:
            return None
        # Only project onto the requested columns when they are all present. A stored
        # series written by an older version may legitimately lack a column added since,
        # and failing the read would look like "no data" rather than "one column is new".
        present = [c for c in cols if c in df.columns]
        if len(present) < len(cols):
            missing = [c for c in cols if c not in df.columns]
            logger.warning(f"[store] {symbol} {interval}: stored series lacks {missing}")
            for c in missing:
                df[c] = float("nan")
        return df[cols].sort_values("date").reset_index(drop=True)
    except Exception as e:
        logger.warning(f"[store] could not read {csv_path}: {e}")
        return None


def meta(symbol: str, exchange: str = "NSE", interval: str = "1d") -> dict:
    _, meta_path = paths(symbol, exchange, interval)
    try:
        with open(meta_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


# ── Write ─────────────────────────────────────────────────────────────────────

# Intervals finer than a day. Anything in this set is serialised with its time component.
INTRADAY_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "4h"}


def is_intraday(interval: str) -> bool:
    return str(interval or "").strip().lower() in INTRADAY_INTERVALS


def _date_format_for(interval: str) -> str:
    return "%Y-%m-%d %H:%M:%S" if is_intraday(interval) else "%Y-%m-%d"


def _last_valid(series):
    """The newest non-null value in a group, or NaN when the group is entirely null."""
    s = series.dropna()
    return s.iloc[-1] if len(s) else float("nan")


def _prepare_incoming(incoming: pd.DataFrame, cols: list, columns: Optional[list]) -> pd.DataFrame:
    inc = incoming.copy()
    inc["date"] = pd.to_datetime(inc["date"], errors="coerce")
    inc = inc.dropna(subset=["date"])
    for col in cols:
        if col not in inc.columns:
            # NaN, not 0.0, for a non-OHLCV series: a missing metric is unknown, and 0
            # is a value a model would learn from. Bars keep the old 0.0 fill because a
            # provider omitting volume genuinely means none was reported.
            inc[col] = 0.0 if not columns else float("nan")
    return inc[cols]


def union_frames(existing: Optional[pd.DataFrame], incoming: Optional[pd.DataFrame],
                 columns: Optional[list] = None, combine: bool = False) -> Optional[pd.DataFrame]:
    """
    The pure half of `merge`: the union of what is held and what arrived, with nothing written.

    It exists so a view-only fetch (Section 153) applies EXACTLY the rules a persisting merge
    does, from one implementation: de-duplicate on the date key with the newer row winning, never
    return fewer rows than `existing` held, and keep the time component (the frame carries
    Timestamps, so an intraday stamp survives until a caller serialises it). Two copies of these
    rules would drift, and then "what you viewed" and "what was kept" would quietly differ.
    """
    cols, required = _column_spec(columns)
    if incoming is None or len(incoming) == 0:
        return existing

    inc = _prepare_incoming(incoming, cols, columns)
    before = 0 if existing is None else len(existing)

    combined = inc if existing is None else pd.concat([existing, inc], ignore_index=True)
    # STABLE, because the next steps keep the LAST row per date and that is only the newer one if equal dates
    # stay in arrival order. The default sort is not stable, so a re-fetch could silently lose to the stored row
    # (found in Section 154: a rebuilt series kept 207 of its old impossible bars).
    combined = combined.dropna(subset=required).sort_values("date", kind="stable")

    if combine:
        # FIELD-LEVEL merge: the newest NON-NULL value wins per column.
        #
        # `drop_duplicates(keep="last")` replaces the whole ROW, which is right for bars — a
        # re-fetch corrects every field at once — and wrong for a series two sources write
        # different columns of. News is exactly that: `news.py` writes the RSS lexicon columns
        # and the GDELT backfill writes `gdelt_*`, and row-replacement meant whichever wrote
        # second silently erased the other's columns with its own nulls. "The columns are
        # disjoint" is only true if the merge respects fields. See Section 72.
        combined = (combined
                    .groupby("date", as_index=False, sort=True)
                    .agg({c: _last_valid for c in combined.columns if c != "date"}))
    else:
        combined = combined.drop_duplicates(subset=["date"], keep="last")  # newer corrects older
    combined = combined.sort_values("date").reset_index(drop=True)

    if existing is not None and len(combined) < before:
        logger.error(f"[store] refusing to shrink a series from {before} to {len(combined)} rows")
        return existing
    return combined


def _write_series(combined: pd.DataFrame, symbol: str, exchange: str, interval: str,
                  source: str, before: int, columns: Optional[list]) -> None:
    """The write half of `merge`: csv then provenance, each replaced atomically."""
    csv_path, meta_path = paths(symbol, exchange, interval, create=True)
    # A unique temp name per writer: a fixed `.tmp` let two concurrent merges truncate each
    # other's half-written file. pid + thread id is unique across processes and threads.
    suffix = f".{os.getpid()}.{threading.get_ident()}.tmp"
    tmp = csv_path + suffix
    # INTRADAY SERIES MUST KEEP THEIR TIME COMPONENT (spec Section 73).
    #
    # This wrote `%Y-%m-%d` unconditionally. For an hourly series every bar in a session
    # serialises to the same midnight timestamp, and the de-duplication on `date` above then
    # keeps **one bar per day** — a 3,499-bar hourly series silently reduced to ~500 rows with
    # no error anywhere. Daily and coarser keep the date-only form because it is what the
    # existing files contain and what makes them readable by hand.
    try:
        combined.to_csv(tmp, index=False, date_format=_date_format_for(interval))
        _replace_with_retry(tmp, csv_path)   # atomic — a crash mid-write cannot leave a half file
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass

    record = {
        "symbol": symbol, "exchange": exchange, "interval": interval,
        "bars": int(len(combined)),
        "firstBar": str(combined["date"].iloc[0].date()),
        "lastBar":  str(combined["date"].iloc[-1].date()),
        "lastSource": source,
        "lastFetchedAt": _dt.datetime.now().isoformat(timespec="seconds"),
        "barsAdded": int(len(combined) - before),
        "yearsCovered": round((combined["date"].iloc[-1] - combined["date"].iloc[0]).days / 365.25, 2),
    }
    meta_tmp = meta_path + suffix
    try:
        # Atomic like the csv: a crash mid-dump used to leave a truncated meta.json, which
        # `meta()` reads as {} — and an empty meta made the intraday cooldown forget it had fetched.
        with open(meta_tmp, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2)
        _replace_with_retry(meta_tmp, meta_path)
    except Exception as e:
        logger.warning(f"[store] could not write provenance for {symbol}: {e}")
        try:
            if os.path.exists(meta_tmp):
                os.remove(meta_tmp)
        except OSError:
            pass

    unit = "bars" if not columns else "rows"
    logger.info(f"[store] {symbol} {exchange} {interval}: {len(combined)} {unit} "
                f"({record['firstBar']} → {record['lastBar']}, +{record['barsAdded']} from {source})")


def merge(symbol: str, incoming: pd.DataFrame, exchange: str = "NSE",
          interval: str = "1d", source: str = "unknown",
          columns: Optional[list] = None, combine: bool = False) -> Optional[pd.DataFrame]:
    """
    Merge `incoming` into whatever is stored and persist the union.

    Union, never replace. A provider that answers with 6 months when 20 years are
    already on disk must not shrink the store — that loss would be silent and
    permanent, and it is exactly what a "refresh" button would cause on a bad day.

    The load -> union -> write runs under a per-series lock, so concurrent merges serialise
    instead of one silently overwriting the other's additions.
    """
    csv_path, _ = paths(symbol, exchange, interval)
    with _lock_for(csv_path):
        existing = load(symbol, exchange, interval, columns)
        if incoming is None or len(incoming) == 0:
            return existing
        before = 0 if existing is None else len(existing)
        combined = union_frames(existing, incoming, columns, combine)
        if combined is None or len(combined) == 0 or combined is existing:
            return existing                      # refused to shrink (or nothing usable arrived)
        _write_series(combined, symbol, exchange, interval, source, before, columns)
        return combined


# How many minutes one bar spans, for the intervals finer than a day. Used only for staleness —
# the fetch itself is shaped by `providers.INTRADAY_RANGE`.
INTERVAL_MINUTES = {
    "1m": 1, "2m": 2, "5m": 5, "15m": 15, "30m": 30,
    "60m": 60, "1h": 60, "90m": 90, "4h": 240,
}

# How many sessions one bar spans, for daily and coarser. A weekly series whose newest bar is
# Monday's is not behind on Thursday — the bar is still forming.
INTERVAL_SESSIONS = {"1d": 1, "5d": 5, "1wk": 5, "1mo": 21, "3mo": 63}


def is_stale(symbol: str, exchange: str = "NSE", interval: str = "1d",
             max_age_days: int = 1, columns: Optional[list] = None) -> bool:
    """
    Does the store need topping up?

    Weekends and holidays are why the daily branch is date-based rather than "was it fetched
    today": on a Sunday the newest available bar is Friday's, and treating that as stale
    would re-fetch all weekend for nothing.

    INTRADAY NEEDED ITS OWN BRANCH (spec Section 101). The whole function used to `normalise()`
    the newest bar to a date, which for an intraday series is always today during a session —
    so a 5m series fetched at 10:00 read as CURRENT for the rest of the day and `sync=True`
    kept returning the same frozen frame. The chart looked broken while the store believed it
    was up to date, which is the worst combination: no error anywhere.

    The fix cannot simply be bar age, either. Outside market hours the newest bar only gets
    older, so bar age alone would re-fetch on every request all night and all weekend. So the
    intraday test is bar age AND a per-interval cooldown on the FETCH — which bounds network
    calls regardless of whether the market is open, without needing a holiday calendar.
    """
    df = load(symbol, exchange, interval, columns)
    if df is None or len(df) == 0:
        return True

    iv = str(interval or "1d").strip().lower()

    if is_intraday(iv):
        span = INTERVAL_MINUTES.get(iv, 60)
        # Stored intraday stamps are naive UTC (Section 73), so `now` must be naive UTC too.
        # A naive local `now` would be 5h30m ahead in IST and read every fresh bar as stale.
        now_utc = pd.Timestamp.now(tz="UTC").tz_localize(None)
        last = pd.Timestamp(df["date"].iloc[-1])
        if getattr(last, "tzinfo", None) is not None:
            last = last.tz_convert("UTC").tz_localize(None)
        age_min = (now_utc - last).total_seconds() / 60.0
        # Two bar widths of slack: one for the bar still forming, one for provider lag.
        if age_min <= 2 * span:
            return False
        cooldown = max(5, span)
        stamp = meta(symbol, exchange, interval).get("lastFetchedAt")
        if stamp:
            try:
                since_min = ((_dt.datetime.now() - _dt.datetime.fromisoformat(stamp))
                             .total_seconds() / 60.0)
                if since_min < cooldown:
                    return False
            except Exception:
                # An unparseable stamp must not make the series permanently fresh; fall through
                # and treat it as stale, which is the recoverable direction.
                pass
        return True

    last = pd.Timestamp(df["date"].iloc[-1]).normalize()
    today = pd.Timestamp.today().normalize()
    business_gap = len(pd.bdate_range(last, today)) - 1
    # A coarse bar is not late until a whole bar could have closed.
    allowed = max(int(max_age_days), INTERVAL_SESSIONS.get(iv, 1))
    return business_gap > allowed


# ── View-only fetches (spec Section 153) ───────────────────────────────────────
#
# A fetch that writes nothing also records nothing: `meta.lastFetchedAt` is what `is_stale` uses
# as the intraday cooldown, and a view-only fetch must not touch it. Left alone, every click on
# "Fetch (view only)" for a stale intraday series would go to the provider again, because the
# series would stay stale forever. So view fetches keep their OWN in-memory record per series:
# when it was fetched and what came back.
#
# It stores the frame, not only a timestamp. Within the cooldown a repeat request is answered
# from this memory, so the second click shows the same candles as the first rather than falling
# back to the (shorter) stored series and looking as if data vanished. It is also what lets a
# "save dataset" request re-read exactly what the chart is showing without a second network call.
#
# Bounded (a handful of series) and in-process only: a restart forgets it, which is the safe
# direction, because the worst case is one extra provider call.
VIEW_COOLDOWN_DAILY_SECONDS = 300
_VIEW_CACHE_MAX = 16
_view_cache: dict = {}
_view_guard = threading.Lock()


def _view_key(symbol: str, exchange: str, interval: str) -> str:
    csv_path, _ = paths(symbol, exchange, interval)
    return os.path.normcase(os.path.abspath(csv_path))


def _view_cooldown_seconds(interval: str) -> int:
    iv = str(interval or "1d").strip().lower()
    if is_intraday(iv):
        # The same floor `is_stale` uses for its persisted cooldown, so the two paths agree.
        return int(max(5, INTERVAL_MINUTES.get(iv, 60)) * 60)
    return VIEW_COOLDOWN_DAILY_SECONDS


def _view_get(key: str, cooldown: int):
    with _view_guard:
        entry = _view_cache.get(key)
        if entry is None:
            return None
        age = time.monotonic() - entry["at"]
        if age >= cooldown:
            _view_cache.pop(key, None)
            return None
        return entry["frame"].copy(), entry["source"], age


def _view_put(key: str, frame: pd.DataFrame, source: str) -> None:
    with _view_guard:
        _view_cache.pop(key, None)
        _view_cache[key] = {"at": time.monotonic(), "frame": frame.copy(), "source": source}
        while len(_view_cache) > _VIEW_CACHE_MAX:
            _view_cache.pop(next(iter(_view_cache)))     # oldest first (dicts keep insertion order)


def clear_view_cache() -> None:
    with _view_guard:
        _view_cache.clear()


REPAIR_SHARE = 0.005          # a stored series with more than this share of impossible bars is rebuilt


def ohlc_violations(df: Optional[pd.DataFrame]) -> int:
    """
    How many bars are impossible: the high below the open or close, the low above them, or a non-positive
    price. A bar like that is not a quirk of the market, it is two price bases mixed in one row (Section 154).
    """
    if df is None or len(df) == 0:
        return 0
    o, h, l, c = (pd.to_numeric(df[k], errors="coerce") for k in ("open", "high", "low", "close"))
    tol = 1e-6
    top = pd.concat([o, c], axis=1).max(axis=1)
    bottom = pd.concat([o, c], axis=1).min(axis=1)
    bad = (h < top * (1 - tol)) | (l > bottom * (1 + tol)) | (h < l) | (c <= 0) | (o <= 0) | (h <= 0) | (l <= 0)
    return int(bad.fillna(False).sum())


def needs_repair(df: Optional[pd.DataFrame]) -> bool:
    """Is enough of a stored series impossible that topping it up cannot fix it?"""
    return df is not None and len(df) > 0 and ohlc_violations(df) / len(df) > REPAIR_SHARE


def sync(symbol: str, exchange: str = "NSE", interval: str = "1d",
         years: int = None, force: bool = False,
         persist: bool = True) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Bring the store up to date and return the full history.

    The first call fetches as deep as the chain allows; later calls return from disk
    and only reach out when the newest stored bar has fallen behind.

    `persist=False` is the view-only form (Section 153): it fetches the same way and returns the
    union with what is stored, but writes nothing — no csv, no meta, no directory — and obeys a
    per-series in-memory cooldown instead of `lastFetchedAt`. `force` bypasses both the staleness
    test and that cooldown, and is not exposed by any route.

    @returns (df, info) where info records what happened and where it came from —
             the caller needs that to label the output honestly. `info["unsaved"]` is True
             exactly when the returned frame holds provider data that is not on disk.
    """
    from . import providers

    stored = load(symbol, exchange, interval)
    info = {
        "symbol": symbol, "exchange": exchange, "interval": interval,
        "fromStore": stored is not None, "fetched": False,
        "source": (meta(symbol, exchange, interval).get("lastSource") if stored is not None else None),
        "bars": 0 if stored is None else len(stored),
        "persisted": bool(persist), "unsaved": False,
    }

    # A series written while close was dividend-adjusted and the rest was not (Section 154) is rebuilt in full, not
    # topped up: the fresh fetch overwrites every overlapping date, so one pass restores a consistent basis.
    repair = needs_repair(stored)
    info["repaired"] = bool(repair)
    need = force or repair or stored is None or is_stale(symbol, exchange, interval)
    if not need:
        info["reason"] = "store is current"
        return stored, info

    want_years = years or (30 if (stored is None or repair) else 1)

    if not persist:
        return _sync_view(symbol, exchange, interval, want_years, force, stored, info, providers)

    fetched, source = providers.fetch_history(symbol, exchange, want_years, interval)

    if fetched is None:
        info["reason"] = "no provider returned data"
        info["providersTried"] = [p.name for p in providers.active()]
        return stored, info                        # stored may still be usable

    merged = merge(symbol, fetched, exchange, interval, source=source)
    m = meta(symbol, exchange, interval)
    info.update({
        "fetched": True, "source": source, "bars": int(len(merged) if merged is not None else 0),
        "barsAdded": m.get("barsAdded"), "firstBar": m.get("firstBar"),
        "lastBar": m.get("lastBar"), "yearsCovered": m.get("yearsCovered"),
        "reason": "fetched deep history" if not info["fromStore"] else "topped up",
    })
    return merged, info


def _sync_view(symbol, exchange, interval, want_years, force, stored, info, providers):
    """The persist=False branch of `sync`: fetch (or reuse a recent fetch), union in memory, write nothing."""
    key = _view_key(symbol, exchange, interval)
    cached = None if force else _view_get(key, _view_cooldown_seconds(interval))
    reused = cached is not None
    if reused:
        fetched, source, age = cached
    else:
        fetched, source = providers.fetch_history(symbol, exchange, want_years, interval)
        age = 0.0
        if fetched is not None:
            _view_put(key, fetched, source)

    if fetched is None:
        # Not remembered: a network blip must be retryable on the next click, and a failed attempt
        # has no data worth reusing. The persisted path behaves the same way.
        info["reason"] = "no provider returned data"
        info["providersTried"] = [p.name for p in providers.active()]
        return stored, info

    before = 0 if stored is None else len(stored)
    union = union_frames(stored, fetched)
    if union is None or len(union) == 0:
        info["reason"] = "the provider answered with nothing usable"
        return stored, info

    first, last = union["date"].iloc[0], union["date"].iloc[-1]
    info.update({
        "fetched": not reused, "reusedView": reused, "unsaved": True,
        "source": source, "bars": int(len(union)), "barsAdded": int(len(union) - before),
        "firstBar": str(first.date()), "lastBar": str(last.date()),
        "yearsCovered": round((last - first).days / 365.25, 2),
        "reason": (f"reused a view-only fetch from {int(age)}s ago; nothing written" if reused
                   else "fetched for viewing; nothing written"),
    })
    return union, info


# Providers whose bars may be pushed in from outside the engine. Kite's access token lives in the Electron main
# process, so the main process fetches and hands the bars over; the engine never sees the token (Section 156).
IMPORT_SOURCES = {"kite"}
IMPORT_INTERVALS = {"1m", "3m", "5m", "10m", "15m", "30m", "60m", "1h", "1d"}
MAX_IMPORT_BARS = 60000


def import_bars(symbol: str, exchange: str, interval: str, source: str, bars: list) -> dict:
    """
    Validate bars handed in from another process and merge them into the working store.

    Nothing is trusted: the source must be on the list, the shape and size are checked, every price must be a
    positive number, and a batch with impossible bars (Section 154) is refused whole rather than stored.
    @returns {ok, imported, bars, firstBar, lastBar} or {ok: False, reason}
    """
    if source not in IMPORT_SOURCES:
        return {"ok": False, "reason": f"{source!r} is not an allowed import source"}
    iv = str(interval or "").lower()
    if iv not in IMPORT_INTERVALS:
        return {"ok": False, "reason": f"{interval!r} is not an interval that can be imported"}
    if not isinstance(bars, list) or not bars:
        return {"ok": False, "reason": "no bars were supplied"}
    if len(bars) > MAX_IMPORT_BARS:
        return {"ok": False, "reason": f"{len(bars)} bars is more than one import may carry ({MAX_IMPORT_BARS})"}
    try:
        df = pd.DataFrame(bars)
    except Exception as exc:
        return {"ok": False, "reason": f"the bars could not be read: {exc}"}
    need = ["date", "open", "high", "low", "close"]
    if any(c not in df.columns for c in need):
        return {"ok": False, "reason": "every bar needs date, open, high, low and close"}
    if "volume" not in df.columns:
        df["volume"] = 0.0
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    bad_rows = int(df[need].isna().any(axis=1).sum())
    if bad_rows:
        return {"ok": False, "reason": f"{bad_rows} bars have a missing or unreadable value"}
    if (df[["open", "high", "low", "close"]] <= 0).any().any():
        return {"ok": False, "reason": "a price is zero or negative"}
    if ohlc_violations(df) / len(df) > REPAIR_SHARE:
        return {"ok": False, "reason": "the bars contradict themselves (a close outside its own high-low range), so none were stored"}
    df = df[["date", "open", "high", "low", "close", "volume"]].drop_duplicates(subset=["date"], keep="last")
    merged = merge(symbol, df, exchange, iv, source=source)
    if merged is None:
        return {"ok": False, "reason": "the store did not accept the bars"}
    return {"ok": True, "imported": int(len(df)), "bars": int(len(merged)),
            "firstBar": str(merged["date"].iloc[0]), "lastBar": str(merged["date"].iloc[-1]), "source": source}


def inventory() -> list[dict]:
    """Every symbol held locally, with its depth — so master can see what Rāma has."""
    out = []
    root = store_root()
    for exchange in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        ex_dir = os.path.join(root, exchange)
        if not os.path.isdir(ex_dir):
            continue
        for fname in sorted(os.listdir(ex_dir)):
            if not fname.endswith(".meta.json"):
                continue
            try:
                with open(os.path.join(ex_dir, fname), "r", encoding="utf-8") as fh:
                    out.append(json.load(fh))
            except Exception:
                continue
    return out
