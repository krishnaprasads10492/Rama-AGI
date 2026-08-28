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

def load(symbol: str, exchange: str = "NSE", interval: str = "1d") -> Optional[pd.DataFrame]:
    csv_path, _ = paths(symbol, exchange, interval)
    if not os.path.exists(csv_path):
        return None
    try:
        df = pd.read_csv(csv_path, parse_dates=["date"])
        if df is None or len(df) == 0:
            return None
        return df[COLUMNS].sort_values("date").reset_index(drop=True)
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

def merge(symbol: str, incoming: pd.DataFrame, exchange: str = "NSE",
          interval: str = "1d", source: str = "unknown") -> Optional[pd.DataFrame]:
    """
    Merge `incoming` into whatever is stored and persist the union.

    Union, never replace. A provider that answers with 6 months when 20 years are
    already on disk must not shrink the store — that loss would be silent and
    permanent, and it is exactly what a "refresh" button would cause on a bad day.
    """
    if incoming is None or len(incoming) == 0:
        return load(symbol, exchange, interval)

    inc = incoming.copy()
    inc["date"] = pd.to_datetime(inc["date"], errors="coerce")
    inc = inc.dropna(subset=["date"])
    for col in COLUMNS:
        if col not in inc.columns:
            inc[col] = 0.0
    inc = inc[COLUMNS]

    existing = load(symbol, exchange, interval)
    before   = 0 if existing is None else len(existing)

    combined = inc if existing is None else pd.concat([existing, inc], ignore_index=True)
    combined = (combined
                .dropna(subset=["date", "close"])
                .drop_duplicates(subset=["date"], keep="last")   # newer fetch corrects older
                .sort_values("date")
                .reset_index(drop=True))

    if existing is not None and len(combined) < before:
        logger.error(f"[store] refusing to shrink {symbol} from {before} to {len(combined)} bars")
        return existing

    csv_path, meta_path = paths(symbol, exchange, interval)
    tmp = csv_path + ".tmp"
    combined.to_csv(tmp, index=False, date_format="%Y-%m-%d")
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

    logger.info(f"[store] {symbol} {exchange} {interval}: {len(combined)} bars "
                f"({record['firstBar']} → {record['lastBar']}, +{record['barsAdded']} from {source})")
    return combined


def is_stale(symbol: str, exchange: str = "NSE", interval: str = "1d",
             max_age_days: int = 1) -> bool:
    """
    Does the store need topping up?

    Weekends and holidays are why this is date-based rather than "was it fetched
    today": on a Sunday the newest available bar is Friday's, and treating that as
    stale would re-fetch all weekend for nothing.
    """
    df = load(symbol, exchange, interval)
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
    fetched, source = providers.fetch_history(symbol, exchange, want_years)

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
