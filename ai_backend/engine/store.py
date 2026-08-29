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


def store_root() -> str:
    """
    Where bars live. `STOCKMIND_DATA_DIR` overrides, which is how the Electron side
    points this at `userData` so a packaged app writes somewhere writable rather than
    next to a read-only executable.
    """
    root = os.environ.get("STOCKMIND_DATA_DIR")
    if not root:
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "history")
    os.makedirs(root, exist_ok=True)
    return root


def _safe(name: str) -> str:
    return "".join(ch if (ch.isalnum() or ch in "-_") else "_" for ch in (name or "unknown").upper())


def paths(symbol: str, exchange: str = "NSE", interval: str = "1d"):
    base = os.path.join(store_root(), _safe(exchange))
    os.makedirs(base, exist_ok=True)
    stem = f"{_safe(symbol)}__{_safe(interval)}"
    return os.path.join(base, stem + ".csv"), os.path.join(base, stem + ".meta.json")


# ── Read ──────────────────────────────────────────────────────────────────────

def load(symbol: str, exchange: str = "NSE", interval: str = "1d",
         columns: Optional[list] = None) -> Optional[pd.DataFrame]:
    cols, _ = _column_spec(columns)
    csv_path, _ = paths(symbol, exchange, interval)
    if not os.path.exists(csv_path):
        return None
    try:
        df = pd.read_csv(csv_path, parse_dates=["date"])
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


def merge(symbol: str, incoming: pd.DataFrame, exchange: str = "NSE",
          interval: str = "1d", source: str = "unknown",
          columns: Optional[list] = None, combine: bool = False) -> Optional[pd.DataFrame]:
    """
    Merge `incoming` into whatever is stored and persist the union.

    Union, never replace. A provider that answers with 6 months when 20 years are
    already on disk must not shrink the store — that loss would be silent and
    permanent, and it is exactly what a "refresh" button would cause on a bad day.
    """
    cols, required = _column_spec(columns)
    if incoming is None or len(incoming) == 0:
        return load(symbol, exchange, interval, columns)

    inc = incoming.copy()
    inc["date"] = pd.to_datetime(inc["date"], errors="coerce")
    inc = inc.dropna(subset=["date"])
    for col in cols:
        if col not in inc.columns:
            # NaN, not 0.0, for a non-OHLCV series: a missing metric is unknown, and 0
            # is a value a model would learn from. Bars keep the old 0.0 fill because a
            # provider omitting volume genuinely means none was reported.
            inc[col] = 0.0 if not columns else float("nan")
    inc = inc[cols]

    existing = load(symbol, exchange, interval, columns)
    before   = 0 if existing is None else len(existing)

    combined = inc if existing is None else pd.concat([existing, inc], ignore_index=True)
    combined = combined.dropna(subset=required).sort_values("date")

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
        logger.error(f"[store] refusing to shrink {symbol} from {before} to {len(combined)} rows")
        return existing

    csv_path, meta_path = paths(symbol, exchange, interval)
    tmp = csv_path + ".tmp"
    # INTRADAY SERIES MUST KEEP THEIR TIME COMPONENT (spec Section 73).
    #
    # This wrote `%Y-%m-%d` unconditionally. For an hourly series every bar in a session
    # serialises to the same midnight timestamp, and the de-duplication on `date` above then
    # keeps **one bar per day** — a 3,499-bar hourly series silently reduced to ~500 rows with
    # no error anywhere. Daily and coarser keep the date-only form because it is what the
    # existing files contain and what makes them readable by hand.
    combined.to_csv(tmp, index=False, date_format=_date_format_for(interval))
    os.replace(tmp, csv_path)   # atomic — a crash mid-write cannot leave a half file

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
    try:
        with open(meta_path, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2)
    except Exception as e:
        logger.warning(f"[store] could not write provenance for {symbol}: {e}")

    unit = "bars" if not columns else "rows"
    logger.info(f"[store] {symbol} {exchange} {interval}: {len(combined)} {unit} "
                f"({record['firstBar']} → {record['lastBar']}, +{record['barsAdded']} from {source})")
    return combined


def is_stale(symbol: str, exchange: str = "NSE", interval: str = "1d",
             max_age_days: int = 1, columns: Optional[list] = None) -> bool:
    """
    Does the store need topping up?

    Weekends and holidays are why this is date-based rather than "was it fetched
    today": on a Sunday the newest available bar is Friday's, and treating that as
    stale would re-fetch all weekend for nothing.
    """
    df = load(symbol, exchange, interval, columns)
    if df is None or len(df) == 0:
        return True
    last = pd.Timestamp(df["date"].iloc[-1]).normalize()
    today = pd.Timestamp.today().normalize()
    business_gap = len(pd.bdate_range(last, today)) - 1
    return business_gap > max_age_days


def sync(symbol: str, exchange: str = "NSE", interval: str = "1d",
         years: int = None, force: bool = False) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Bring the store up to date and return the full history.

    The first call fetches as deep as the chain allows; later calls return from disk
    and only reach out when the newest stored bar has fallen behind.

    @returns (df, info) where info records what happened and where it came from —
             the caller needs that to label the output honestly.
    """
    from . import providers

    stored = load(symbol, exchange, interval)
    info = {
        "symbol": symbol, "exchange": exchange, "interval": interval,
        "fromStore": stored is not None, "fetched": False,
        "source": (meta(symbol, exchange, interval).get("lastSource") if stored is not None else None),
        "bars": 0 if stored is None else len(stored),
    }

    need = force or stored is None or is_stale(symbol, exchange, interval)
    if not need:
        info["reason"] = "store is current"
        return stored, info

    want_years = years or (30 if stored is None else 1)
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
