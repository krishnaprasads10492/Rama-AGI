"""
derivatives.py — NSE options, futures and institutional flows, free and backtestable.

WHY THIS EXISTS. Master's requirement names derivatives explicitly: predict "impact on
index, stocks and derivatives, commodities". StockMind had none of it — no open interest,
no put/call ratio, no max pain, no institutional positioning. Those are not garnish for an
Indian index trader; open interest and FII positioning are most of how the market is read.

THE DESIGN DECISION THAT SHAPES EVERYTHING HERE (spec Section 67).

There are two ways to get option data from NSE, and only one of them is worth building on:

  - `api/option-chain-v3` describes **today**. One HTTP call, looks impressive, and can
    only ever feed a dashboard.
  - The **bhavcopy archives** describe **every trading day since 2001** — which is when
    index options started trading in India, so it is the entire history of the instrument
    class.

Only the archive can feed a backtest or train a model. So the archive is primary and the
live chain is an intraday top-up, labelled as not backtestable wherever it surfaces. Same
reasoning as Section 65's "the store is primary, providers fill it".

TWO FORMATS, ONE OUTPUT. NSE changed the F&O bhavcopy to a UDiFF layout in 2024 and moved
the archive host to `nsearchives.nseindia.com`. UDiFF covers ~2024 onward; the legacy
layout covers 2001 to 2024, and both answer identically in the overlap. Both are parsed
into one canonical contract frame so nothing downstream knows which file a date came from.

WHAT IS PERSISTED. Not contracts — 21 years at ~30,000 rows a day is ~150 million rows,
which would break the CSV choice made in Section 65 and force parquet or a database. The
model consumes *features*, so one derived row per (symbol, date) is stored: about 5,000
rows for the full history, the same order as an OHLCV series. Raw contract frames are
parsed, used and dropped.
"""

import io
import csv
import json
import logging
import os
import zipfile
import datetime as _dt
from typing import Optional

import numpy as np
import pandas as pd

from . import store

logger = logging.getLogger("stockmind-ai.derivatives")

ARCHIVE = "https://nsearchives.nseindia.com"
NSE_WWW = "https://www.nseindia.com"

# The interval key under which derived metrics live in the store, so they sit beside the
# OHLCV series for the same symbol without colliding with it.
DERIV_INTERVAL = "deriv1d"

# One row per symbol per day. Ordered deliberately: identity, options, futures,
# provenance — so the CSV is readable by hand, which is half the reason for CSV.
DERIV_COLUMNS = [
    "date",
    "spot",
    # Options — nearest expiry
    "expiry", "days_to_expiry", "strikes_count",
    "ce_oi", "pe_oi", "ce_oi_chg", "pe_oi_chg", "pcr_oi",
    "ce_volume", "pe_volume", "pcr_volume",
    "max_pain", "max_pain_dist",
    "max_ce_oi_strike", "max_pe_oi_strike", "resistance_dist", "support_dist",
    "oi_concentration", "straddle_pct",
    # Options — every listed expiry
    "ce_oi_all", "pe_oi_all", "pcr_oi_all",
    # Futures
    "fut_close", "fut_basis_pct", "fut_oi", "fut_oi_chg", "rollover_pct",
    # Provenance
    "source",
]

# Instrument-type codes. UDiFF uses ISO-ish short codes; legacy uses NSE's own.
# Kept as an explicit map rather than a prefix test, because `STO`/`STF` and
# `OPTSTK`/`FUTSTK` do not share a pattern and guessing would silently misclassify.
_INSTRUMENT = {
    "IDO": ("option", "index"), "STO": ("option", "stock"),
    "IDF": ("future", "index"), "STF": ("future", "stock"),
    "OPTIDX": ("option", "index"), "OPTSTK": ("option", "stock"),
    "FUTIDX": ("future", "index"), "FUTSTK": ("future", "stock"),
}

CANONICAL = ["symbol", "kind", "underlying_kind", "expiry", "strike", "option_type",
             "open", "high", "low", "close", "settle", "volume", "value",
             "oi", "oi_change", "underlying_price"]


# ── HTTP session ──────────────────────────────────────────────────────────────

def _client(timeout: float = 40.0):
    """
    An httpx client configured the way NSE actually requires.

    TWO NON-OBVIOUS CONSTRAINTS, both found by probing (Section 67):

    1. **Never advertise brotli.** NSE honours `br`, and the bundled httpx has no brotli
       decoder, so `fiidiiTradeReact` came back as **status 200 with 115 bytes of
       undecodable binary** that parsed as neither JSON nor an error. It read exactly like
       a working endpoint returning junk. Adding a brotli package would fix the symptom
       and cost a new pinned dependency (I12) for payloads measured in kilobytes.

    2. **Warm on a content page, not the root.** `https://www.nseindia.com/` returns
       **403** and one cookie; `/option-chain` and `/all-reports` return 200 and set the
       cookies the API needs. Warming on the root — the obvious choice — leads to a 401
       on the next call.
    """
    import httpx
    return httpx.Client(
        timeout=timeout, follow_redirects=True,
        headers={
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        })


def _warm(client, page: str = "/all-reports") -> bool:
    try:
        return client.get(NSE_WWW + page).status_code == 200
    except Exception as e:
        logger.warning(f"[derivatives] warm-up failed: {e}")
        return False


# ── Non-publication memo ──────────────────────────────────────────────────────
#
# Holidays AND weekends return 404 with an HTML body — verified for 2026-01-15 (a trading
# holiday) and Sunday 2026-08-30. So a 404 is normal for a large fraction of calendar
# dates and is NOT a failure.
#
# It is remembered, or a historical backfill re-requests every holiday since 2001 on every
# single run. Conflating "not published" with "fetch failed" would either spam the exchange
# or make a backfill look broken.

def _memo_path() -> str:
    d = os.path.join(store.store_root(), "_derivatives")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "no-publication.json")


def _load_memo() -> set:
    try:
        with open(_memo_path(), "r", encoding="utf-8") as fh:
            return set(json.load(fh).get("dates") or [])
    except Exception:
        return set()


def _save_memo(dates: set) -> None:
    try:
        tmp = _memo_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"dates": sorted(dates),
                       "note": "Dates NSE published no F&O bhavcopy — holidays and "
                               "weekends. Not errors; recorded so a backfill does not "
                               "re-request them.",
                       "updatedAt": _dt.datetime.now().isoformat(timespec="seconds")},
                      fh, indent=2)
        os.replace(tmp, _memo_path())
    except Exception as e:
        logger.warning(f"[derivatives] could not persist non-publication memo: {e}")


# ── Bhavcopy fetch ────────────────────────────────────────────────────────────

def _udiff_url(d: _dt.date) -> str:
    return f"{ARCHIVE}/content/fo/BhavCopy_NSE_FO_0_0_0_{d.strftime('%Y%m%d')}_F_0000.csv.zip"


def _legacy_url(d: _dt.date) -> str:
    return (f"{ARCHIVE}/content/historical/DERIVATIVES/{d.strftime('%Y')}/"
            f"{d.strftime('%b').upper()}/fo{d.strftime('%d%b%Y').upper()}bhav.csv.zip")


def _read_zip_csv(content: bytes) -> Optional[pd.DataFrame]:
    try:
        z = zipfile.ZipFile(io.BytesIO(content))
        text = z.read(z.namelist()[0]).decode("utf-8", "replace")
    except zipfile.BadZipFile:
        text = content.decode("utf-8", "replace")
    if "<html" in text[:200].lower():
        return None
    try:
        return pd.read_csv(io.StringIO(text))
    except Exception:
        return None


def fetch_bhavcopy(d: _dt.date, client=None) -> tuple[Optional[pd.DataFrame], str]:
    """
    The F&O bhavcopy for one date, from whichever archive format has it.

    @returns (canonical_contracts, status) where status is one of
             'udiff' | 'legacy' | 'not-published' | 'failed'.

    UDiFF is tried first because it covers recent dates, which is what a top-up asks for;
    legacy is the fallback and reaches back to 2001.
    """
    own = client is None
    client = client or _client()
    try:
        if own:
            _warm(client)
        for label, url in (("udiff", _udiff_url(d)), ("legacy", _legacy_url(d))):
            try:
                r = client.get(url, headers={"Referer": NSE_WWW + "/all-reports"})
            except Exception as e:
                logger.debug(f"[derivatives] {label} {d}: {e}")
                continue
            if r.status_code == 404:
                continue
            if r.status_code != 200 or len(r.content) < 500:
                continue
            raw = _read_zip_csv(r.content)
            if raw is None or len(raw) == 0:
                continue
            canon = to_canonical(raw, label)
            if canon is not None and len(canon):
                return canon, label
        # Both formats 404'd. On a weekday that is a trading holiday; on a weekend it is
        # a weekend. Either way there is nothing to fetch, now or ever.
        return None, "not-published"
    finally:
        if own:
            client.close()


# ── Canonical contract frame ──────────────────────────────────────────────────

def to_canonical(raw: pd.DataFrame, layout: str) -> Optional[pd.DataFrame]:
    """
    Normalise either bhavcopy layout into one frame.

    Nothing downstream should know which archive a date came from — that is the whole
    point, and it is also what stops a feature encoding its own provenance.
    """
    if raw is None or len(raw) == 0:
        return None
    cols = {str(c).strip(): c for c in raw.columns}

    if layout == "udiff" or "FinInstrmTp" in cols:
        m = {"symbol": "TckrSymb", "instrument": "FinInstrmTp", "expiry": "XpryDt",
             "strike": "StrkPric", "option_type": "OptnTp",
             "open": "OpnPric", "high": "HghPric", "low": "LwPric", "close": "ClsPric",
             "settle": "SttlmPric", "volume": "TtlTradgVol", "value": "TtlTrfVal",
             "oi": "OpnIntrst", "oi_change": "ChngInOpnIntrst",
             "underlying_price": "UndrlygPric"}
        expiry_fmt = None                      # ISO — pandas infers
    else:
        # LEGACY. Two traps here, both verified against 2020-06-10:
        #   `OPTION_TYP` is the literal string `XX` on futures rows, not blank or null.
        #   There is no underlying-price column at all (see `derive_metrics`).
        m = {"symbol": "SYMBOL", "instrument": "INSTRUMENT", "expiry": "EXPIRY_DT",
             "strike": "STRIKE_PR", "option_type": "OPTION_TYP",
             "open": "OPEN", "high": "HIGH", "low": "LOW", "close": "CLOSE",
             "settle": "SETTLE_PR", "volume": "CONTRACTS", "value": "VAL_INLAKH",
             "oi": "OPEN_INT", "oi_change": "CHG_IN_OI"}
        expiry_fmt = "%d-%b-%Y"

    out = pd.DataFrame()
    for dest, src in m.items():
        out[dest] = raw[cols[src]] if src in cols else np.nan
    if "underlying_price" not in out.columns:
        out["underlying_price"] = np.nan

    out["symbol"] = out["symbol"].astype(str).str.strip().str.upper()
    inst = out.pop("instrument").astype(str).str.strip().str.upper()
    mapped = inst.map(_INSTRUMENT)
    known = mapped.notna()
    if not known.any():
        logger.warning(f"[derivatives] no recognised instrument codes in {layout} file")
        return None
    out = out[known].copy()
    mapped = mapped[known]
    out["kind"]            = [t[0] for t in mapped]
    out["underlying_kind"] = [t[1] for t in mapped]

    out["expiry"] = pd.to_datetime(out["expiry"], format=expiry_fmt, errors="coerce")
    ot = out["option_type"].astype(str).str.strip().str.upper()
    # `XX` and every other non-CE/PE marker becomes NaN, so a futures row can never be
    # counted as a call or a put by a downstream filter.
    out["option_type"] = ot.where(ot.isin(("CE", "PE")))

    for c in ("strike", "open", "high", "low", "close", "settle", "volume", "value",
              "oi", "oi_change", "underlying_price"):
        out[c] = pd.to_numeric(out[c], errors="coerce")

    return out[CANONICAL].dropna(subset=["symbol", "expiry"]).reset_index(drop=True)


# ── Max pain ──────────────────────────────────────────────────────────────────

def max_pain(strikes, ce_oi, pe_oi) -> tuple[Optional[float], Optional[float]]:
    """
    The strike at which option writers pay out least, and that payout.

    Vectorised deliberately. This is O(strikes^2) — ~11,000 terms for one NIFTY expiry —
    and it runs once per day across 21 years, so a nested Python loop would be roughly 55
    million interpreted iterations for a number numpy produces in milliseconds. Section 66
    was an entire session lost to a Python loop over market data; this is the same shape.

    @returns (strike, payout) or (None, None) when there is nothing to evaluate.
    """
    s = np.asarray(strikes, dtype=float)
    c = np.nan_to_num(np.asarray(ce_oi, dtype=float))
    p = np.nan_to_num(np.asarray(pe_oi, dtype=float))
    if s.size == 0 or (c.sum() + p.sum()) <= 0:
        return None, None
    # diff[i, j] = candidate_i - strike_j
    diff = s[:, None] - s[None, :]
    pain = np.clip(diff, 0, None) @ c + np.clip(-diff, 0, None) @ p
    i = int(np.argmin(pain))
    return float(s[i]), float(pain[i])


def _herfindahl(values) -> Optional[float]:
    """
    OI concentration across strikes — how pinned the market is to a few levels.

    1.0 means all open interest sits at one strike; 1/n means it is spread evenly. A
    concentrated chain near expiry is the classic pinning setup, which is why this is a
    feature rather than a diagnostic.
    """
    v = np.nan_to_num(np.asarray(values, dtype=float))
    v = v[v > 0]
    if v.size == 0:
        return None
    w = v / v.sum()
    return float((w ** 2).sum())


# ── Derived daily metrics ─────────────────────────────────────────────────────

def derive_metrics(contracts: pd.DataFrame, symbol: str, trade_date,
                   spot: Optional[float] = None, source: str = "unknown") -> Optional[dict]:
    """
    One row of features for one symbol on one day.

    `spot` IS A PARAMETER ON PURPOSE. UDiFF carries `UndrlygPric`; legacy carries no
    underlying price at all. Rather than let spot change source at the 2024 archive
    boundary, the caller supplies it from the OHLCV store for both formats.

    That is not tidiness. `max_pain_dist` and `fut_basis_pct` are ratios against spot, and
    a denominator whose provenance changes mid-history makes those features encode *which
    file the row came from*. A model would learn the archive boundary. It is the same
    failure as the Section 64 time-features bug, where every historical row carried
    today's timestamp.
    """
    if contracts is None or len(contracts) == 0:
        return None
    sym = (symbol or "").upper().strip()
    mine = contracts[contracts["symbol"] == sym]
    if len(mine) == 0:
        return None

    td = pd.Timestamp(trade_date).normalize()
    row = {c: None for c in DERIV_COLUMNS}
    row["date"]   = td.date().isoformat()
    row["source"] = source

    if spot is None or not np.isfinite(spot) or spot <= 0:
        # Last resort only: UDiFF's own underlying price. Recorded as a different source
        # so the mixed-provenance risk above stays visible rather than becoming invisible.
        up = pd.to_numeric(mine["underlying_price"], errors="coerce").dropna()
        up = up[up > 0]
        if len(up):
            spot = float(up.median())
            row["source"] = f"{source}+file-spot"
    row["spot"] = round(float(spot), 4) if spot and np.isfinite(spot) and spot > 0 else None

    opts = mine[(mine["kind"] == "option") & mine["option_type"].notna()]
    futs = mine[mine["kind"] == "future"]

    # ── Options, all expiries ────────────────────────────────────────────────
    if len(opts):
        ce_all = opts[opts["option_type"] == "CE"]["oi"].sum(skipna=True)
        pe_all = opts[opts["option_type"] == "PE"]["oi"].sum(skipna=True)
        row["ce_oi_all"] = float(ce_all)
        row["pe_oi_all"] = float(pe_all)
        row["pcr_oi_all"] = round(float(pe_all / ce_all), 5) if ce_all > 0 else None

        # ── Options, nearest expiry ──────────────────────────────────────────
        # Nearest expiry that has not already passed. `>= td` rather than `> td` because
        # expiry day itself is a trading day and its chain is the most active one there is.
        future_exp = sorted(e for e in opts["expiry"].dropna().unique()
                            if pd.Timestamp(e).normalize() >= td)
        near = pd.Timestamp(future_exp[0]) if future_exp else \
            pd.Timestamp(sorted(opts["expiry"].dropna().unique())[-1])
        ne = opts[opts["expiry"] == near]
        row["expiry"] = near.date().isoformat()
        row["days_to_expiry"] = int((near.normalize() - td).days)

        ce = ne[ne["option_type"] == "CE"]
        pe = ne[ne["option_type"] == "PE"]
        ce_oi = float(ce["oi"].sum(skipna=True))
        pe_oi = float(pe["oi"].sum(skipna=True))
        row["ce_oi"]     = ce_oi
        row["pe_oi"]     = pe_oi
        row["ce_oi_chg"] = float(ce["oi_change"].sum(skipna=True))
        row["pe_oi_chg"] = float(pe["oi_change"].sum(skipna=True))
        row["pcr_oi"]    = round(pe_oi / ce_oi, 5) if ce_oi > 0 else None

        ce_v = float(ce["volume"].sum(skipna=True))
        pe_v = float(pe["volume"].sum(skipna=True))
        row["ce_volume"]  = ce_v
        row["pe_volume"]  = pe_v
        row["pcr_volume"] = round(pe_v / ce_v, 5) if ce_v > 0 else None

        ce_by = ce.groupby("strike")["oi"].sum()
        pe_by = pe.groupby("strike")["oi"].sum()
        strikes = sorted(set(ce_by.index) | set(pe_by.index))
        row["strikes_count"] = len(strikes)
        if strikes:
            c_vec = np.array([ce_by.get(s, 0.0) for s in strikes], dtype=float)
            p_vec = np.array([pe_by.get(s, 0.0) for s in strikes], dtype=float)

            mp, _ = max_pain(strikes, c_vec, p_vec)
            row["max_pain"] = mp
            if mp is not None and row["spot"]:
                row["max_pain_dist"] = round((row["spot"] - mp) / row["spot"], 6)

            if c_vec.sum() > 0:
                r_strike = float(strikes[int(np.argmax(c_vec))])
                row["max_ce_oi_strike"] = r_strike
                if row["spot"]:
                    row["resistance_dist"] = round((r_strike - row["spot"]) / row["spot"], 6)
            if p_vec.sum() > 0:
                s_strike = float(strikes[int(np.argmax(p_vec))])
                row["max_pe_oi_strike"] = s_strike
                if row["spot"]:
                    row["support_dist"] = round((row["spot"] - s_strike) / row["spot"], 6)

            row["oi_concentration"] = _herfindahl(c_vec + p_vec)

            # ATM straddle as a fraction of spot — the market's own priced expected move.
            #
            # USED INSTEAD OF IMPLIED VOLATILITY, deliberately. Neither bhavcopy carries
            # an IV column, and back-solving Black-Scholes across 21 years needs assumed
            # rate and dividend curves. This is one subtraction from the raw data and
            # assumes nothing. Reporting a computed IV would look more sophisticated and
            # be less honest. See Section 67.
            if row["spot"]:
                atm = min(strikes, key=lambda s: abs(s - row["spot"]))
                cp = ce.loc[ce["strike"] == atm, "close"]
                pp = pe.loc[pe["strike"] == atm, "close"]
                if len(cp) and len(pp):
                    tot = float(cp.mean()) + float(pp.mean())
                    if np.isfinite(tot) and tot > 0:
                        row["straddle_pct"] = round(tot / row["spot"], 6)

    # ── Futures ──────────────────────────────────────────────────────────────
    if len(futs):
        exps = sorted(futs["expiry"].dropna().unique())
        forward = [e for e in exps if pd.Timestamp(e).normalize() >= td] or exps
        near_f = pd.Timestamp(forward[0])
        nf = futs[futs["expiry"] == near_f]
        fut_close = float(pd.to_numeric(nf["close"], errors="coerce").dropna().mean()) \
            if len(nf) else None
        row["fut_close"]  = round(fut_close, 4) if fut_close and np.isfinite(fut_close) else None
        row["fut_oi"]     = float(nf["oi"].sum(skipna=True))
        row["fut_oi_chg"] = float(nf["oi_change"].sum(skipna=True))
        if row["fut_close"] and row["spot"]:
            row["fut_basis_pct"] = round((row["fut_close"] - row["spot"]) / row["spot"], 6)

        # Rollover: share of futures OI already sitting in later expiries. Rising into
        # expiry week means positions are being carried forward rather than closed.
        total_oi = float(futs["oi"].sum(skipna=True))
        if total_oi > 0:
            later = futs[futs["expiry"] > near_f]["oi"].sum(skipna=True)
            row["rollover_pct"] = round(float(later) / total_oi, 6)

    return row


# ── Historical backfill ───────────────────────────────────────────────────────

def _spot_lookup(symbol: str, exchange: str = "NSE") -> dict:
    """Date → close from the OHLCV store, so spot has one provenance across all history."""
    df = store.load(symbol, exchange, "1d")
    if df is None or len(df) == 0:
        return {}
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"], errors="coerce")
    d = d.dropna(subset=["date"])
    return {pd.Timestamp(k).normalize().date().isoformat(): float(v)
            for k, v in zip(d["date"], d["close"])}


def sync_history(symbol: str = "NIFTY", exchange: str = "NSE",
                 days: int = 30, until: Optional[_dt.date] = None,
                 force: bool = False, budget_seconds: float = None) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Walk back `days` calendar days, deriving and storing one metric row per trading day.

    Newest-first, so a partial run still leaves the most recent data present — which is
    what a prediction needs. `budget_seconds` bounds a long backfill: one bhavcopy is
    roughly a megabyte, so 21 years is thousands of requests and must be resumable rather
    than one heroic call.

    Already-stored dates and known non-publication dates are skipped, so re-running is
    cheap and converges instead of re-fetching.
    """
    t0 = _dt.datetime.now()
    end = until or _dt.date.today()
    existing = store.load(symbol, exchange, DERIV_INTERVAL, DERIV_COLUMNS)
    have = set()
    if existing is not None and len(existing):
        have = {pd.Timestamp(d).normalize().date().isoformat()
                for d in pd.to_datetime(existing["date"], errors="coerce").dropna()}

    memo   = _load_memo()
    spots  = _spot_lookup(symbol, exchange)
    # Every requested day lands in exactly one bucket, so the counts add up to `days` and
    # a caller can tell "nothing to fetch" from "nothing worked". Weekends are counted
    # rather than silently skipped, or a run over a quiet fortnight looks like a failure.
    rows, stats = [], {"fetched": 0, "weekends": 0, "notPublished": 0, "skipped": 0,
                       "failed": 0, "noSpot": 0, "budgetHit": False}

    client = _client()
    try:
        _warm(client)
        for i in range(days):
            d = end - _dt.timedelta(days=i)
            key = d.isoformat()
            if d.weekday() >= 5:
                stats["weekends"] += 1                      # never published; never asked
                continue
            if key in memo:
                stats["notPublished"] += 1
                continue
            if not force and key in have:
                stats["skipped"] += 1
                continue
            if budget_seconds and (_dt.datetime.now() - t0).total_seconds() > budget_seconds:
                stats["budgetHit"] = True
                break

            contracts, status = fetch_bhavcopy(d, client=client)
            if status == "not-published":
                memo.add(key)
                stats["notPublished"] += 1
                continue
            if contracts is None:
                stats["failed"] += 1
                continue

            metrics = derive_metrics(contracts, symbol, d, spot=spots.get(key), source=status)
            if metrics is None:
                stats["failed"] += 1
                continue
            if metrics["spot"] is None:
                stats["noSpot"] += 1
            rows.append(metrics)
            stats["fetched"] += 1
    finally:
        client.close()
        _save_memo(memo)

    merged = existing
    if rows:
        merged = store.merge(symbol, pd.DataFrame(rows), exchange, DERIV_INTERVAL,
                             source="nse-bhavcopy", columns=DERIV_COLUMNS)

    info = dict(stats)
    info.update({
        "symbol": symbol, "exchange": exchange, "interval": DERIV_INTERVAL,
        "daysRequested": days, "rows": 0 if merged is None else len(merged),
        "elapsedSeconds": round((_dt.datetime.now() - t0).total_seconds(), 1),
    })
    if merged is not None and len(merged):
        info["firstDate"] = str(pd.Timestamp(merged["date"].iloc[0]).date())
        info["lastDate"]  = str(pd.Timestamp(merged["date"].iloc[-1]).date())
    return merged, info


def load_metrics(symbol: str = "NIFTY", exchange: str = "NSE") -> Optional[pd.DataFrame]:
    """The stored derivative metric series — what the model and backtest read."""
    return store.load(symbol, exchange, DERIV_INTERVAL, DERIV_COLUMNS)


def latest_metrics(symbol: str = "NIFTY", exchange: str = "NSE") -> Optional[dict]:
    """
    The most recent stored metric row, JSON-serialisable.

    Dates are returned as ISO strings and numpy scalars as Python floats, because this
    crosses IPC to the renderer. `pd.Timestamp` and `np.float64` both survive a dict
    comprehension and then fail at `json.dumps`, which would surface as a broken panel
    rather than as a type error here.
    """
    df = load_metrics(symbol, exchange)
    if df is None or len(df) == 0:
        return None
    out = {}
    for k, v in df.iloc[-1].to_dict().items():
        if v is None or (not isinstance(v, (list, tuple, dict)) and pd.isna(v)):
            out[k] = None
        elif isinstance(v, pd.Timestamp):
            out[k] = v.date().isoformat()
        elif isinstance(v, np.generic):
            out[k] = v.item()
        else:
            out[k] = v
    return out


# ── Live option chain (snapshot, NOT backtestable) ────────────────────────────

def option_chain(symbol: str = "NIFTY", expiry: Optional[str] = None,
                 kind: str = "Indices") -> dict:
    """
    The live chain for one expiry.

    `api/option-chain-indices` — the endpoint nearly every tutorial and most wrapper
    libraries still use — is **404 as of this writing**. `option-chain-v3` replaces it and
    **requires an expiry**: without one it returns `{}` with status 200, a silent empty
    that reads as "no options today" rather than "you left out a parameter". So the expiry
    list is fetched first from `option-chain-contract-info`.

    Every result is labelled `backtestable: False`. It describes one moment and cannot be
    re-derived for a past date — that is what `sync_history` is for.
    """
    out = {"symbol": symbol, "backtestable": False, "asOf": None,
           "expiry": expiry, "expiries": [], "spot": None, "error": None}
    client = _client()
    try:
        _warm(client, "/option-chain")
        hdrs = {"Referer": NSE_WWW + "/option-chain", "Accept": "application/json"}

        info = client.get(f"{NSE_WWW}/api/option-chain-contract-info?symbol={symbol}",
                          headers=hdrs)
        if info.status_code == 200:
            payload = info.json()
            out["expiries"] = payload.get("expiryDates") or []
        if not expiry:
            if not out["expiries"]:
                out["error"] = "no expiry list available"
                return out
            expiry = out["expiries"][0]
            out["expiry"] = expiry

        r = client.get(f"{NSE_WWW}/api/option-chain-v3?type={kind}&symbol={symbol}"
                       f"&expiry={expiry.replace(' ', '%20')}", headers=hdrs)
        if r.status_code != 200:
            out["error"] = f"chain HTTP {r.status_code}"
            return out
        data = r.json()
        if not data:
            out["error"] = "empty chain — check the expiry format (DD-MMM-YYYY)"
            return out

        rec  = data.get("records") or {}
        filt = data.get("filtered") or {}
        rows = rec.get("data") or []
        out["asOf"] = rec.get("timestamp")
        out["spot"] = rec.get("underlyingValue")

        strikes, ce_oi, pe_oi = [], [], []
        for r_ in rows:
            s = r_.get("strikePrice")
            if s is None:
                continue
            strikes.append(float(s))
            ce_oi.append(float((r_.get("CE") or {}).get("openInterest") or 0))
            pe_oi.append(float((r_.get("PE") or {}).get("openInterest") or 0))

        ce_tot = float((filt.get("CE") or {}).get("totOI") or sum(ce_oi))
        pe_tot = float((filt.get("PE") or {}).get("totOI") or sum(pe_oi))
        mp, _ = max_pain(strikes, ce_oi, pe_oi)

        out.update({
            "strikes": len(strikes),
            "ceOi": ce_tot, "peOi": pe_tot,
            "pcrOi": round(pe_tot / ce_tot, 5) if ce_tot > 0 else None,
            "ceVolume": float((filt.get("CE") or {}).get("totVol") or 0),
            "peVolume": float((filt.get("PE") or {}).get("totVol") or 0),
            "maxPain": mp,
            "maxCeOiStrike": float(strikes[int(np.argmax(ce_oi))]) if strikes and max(ce_oi) > 0 else None,
            "maxPeOiStrike": float(strikes[int(np.argmax(pe_oi))]) if strikes and max(pe_oi) > 0 else None,
            "oiConcentration": _herfindahl(np.array(ce_oi) + np.array(pe_oi)),
            "note": "Live snapshot. Not reproducible for a past date — use sync_history "
                    "for anything a backtest or a model reads.",
        })
        if mp is not None and out["spot"]:
            out["maxPainDist"] = round((float(out["spot"]) - mp) / float(out["spot"]), 6)
        return out
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    finally:
        client.close()


# ── Institutional flows ───────────────────────────────────────────────────────

def fii_dii_latest() -> dict:
    """
    FII/FPI and DII cash-market buy/sell/net for the most recent published day.

    LATEST DAY ONLY — this endpoint carries no history, so it cannot feed a backtest. For
    a positioning signal that *is* historical, use `participant_oi`, which is published as
    a dated archive file.
    """
    out = {"backtestable": False, "date": None, "flows": [], "error": None}
    client = _client()
    try:
        _warm(client)
        r = client.get(f"{NSE_WWW}/api/fiidiiTradeReact",
                       headers={"Referer": NSE_WWW + "/reports/fii-dii",
                                "Accept": "application/json"})
        if r.status_code != 200:
            out["error"] = f"HTTP {r.status_code}"
            return out
        for e in (r.json() or []):
            try:
                out["flows"].append({
                    "category": e.get("category"),
                    "date":     e.get("date"),
                    "buy":      float(e.get("buyValue") or 0),
                    "sell":     float(e.get("sellValue") or 0),
                    "net":      float(e.get("netValue") or 0),
                })
                out["date"] = e.get("date") or out["date"]
            except Exception:
                continue
        for f in out["flows"]:
            if (f["category"] or "").upper().startswith("FII"):
                out["fiiNet"] = f["net"]
            elif (f["category"] or "").upper().startswith("DII"):
                out["diiNet"] = f["net"]
        return out
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    finally:
        client.close()


def participant_oi(d: Optional[_dt.date] = None, client=None) -> dict:
    """
    Participant-wise open interest — Client, DII, FII, Pro — for one date.

    THIS IS THE FLOW SIGNAL WORTH HAVING. It is a dated archive file, so unlike
    `fiidiiTradeReact` it can be backfilled and therefore backtested. It answers whether
    foreign institutions are net long or short index futures, which `fiidiiTradeReact`'s
    cash number cannot.

    Two parsing traps, both verified: line 1 is a **quoted title**, not the header, and
    several column names carry **trailing spaces**.
    """
    d = d or _dt.date.today()
    out = {"date": d.isoformat(), "backtestable": True, "participants": {}, "error": None}
    own = client is None
    client = client or _client()
    try:
        if own:
            _warm(client)
        url = f"{ARCHIVE}/content/nsccl/fao_participant_oi_{d.strftime('%d%m%Y')}.csv"
        r = client.get(url, headers={"Referer": NSE_WWW + "/all-reports"})
        if r.status_code == 404:
            out["error"] = "not published for this date"
            return out
        if r.status_code != 200:
            out["error"] = f"HTTP {r.status_code}"
            return out

        lines = [ln for ln in r.text.splitlines() if ln.strip()]
        if len(lines) < 3:
            out["error"] = "unexpected file shape"
            return out
        reader = list(csv.reader(lines[1:]))            # line 0 is the title
        header = [h.strip() for h in reader[0]]
        for parts in reader[1:]:
            if not parts or not parts[0].strip():
                continue
            rec = {}
            for h, v in zip(header[1:], parts[1:]):
                try:
                    rec[h] = float(str(v).replace(",", "").strip() or 0)
                except ValueError:
                    rec[h] = None
            out["participants"][parts[0].strip()] = rec

        fii = out["participants"].get("FII") or {}
        long_, short_ = fii.get("Future Index Long"), fii.get("Future Index Short")
        if long_ is not None and short_ is not None:
            out["fiiIndexFutLong"]  = long_
            out["fiiIndexFutShort"] = short_
            out["fiiIndexFutNet"]   = long_ - short_
            # Ratio, not just the difference: the difference scales with total market
            # participation, so it is not comparable across years.
            out["fiiLongShortRatio"] = round(long_ / short_, 5) if short_ else None
        return out
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    finally:
        if own:
            client.close()


def delivery_data(d: Optional[_dt.date] = None, symbol: Optional[str] = None,
                  client=None) -> dict:
    """
    Delivery quantity and percentage from `sec_bhavdata_full`.

    Delivery percentage separates conviction from churn: a rally on 20% delivery is
    intraday positioning, the same rally on 70% is accumulation. Plain CSV, not zipped —
    unlike every other file here.
    """
    d = d or _dt.date.today()
    out = {"date": d.isoformat(), "backtestable": True, "rows": 0, "error": None}
    own = client is None
    client = client or _client()
    try:
        if own:
            _warm(client)
        url = f"{ARCHIVE}/products/content/sec_bhavdata_full_{d.strftime('%d%m%Y')}.csv"
        r = client.get(url, headers={"Referer": NSE_WWW + "/all-reports"})
        if r.status_code == 404:
            out["error"] = "not published for this date"
            return out
        if r.status_code != 200:
            out["error"] = f"HTTP {r.status_code}"
            return out

        # `skipinitialspace=True` IS THE FIX, NOT A TIDY-UP. This file is written with a
        # space after every comma, in the header AND every data row: the column is
        # ` SERIES` and the value is ` EQ`. Handling it at parse time deals with both in
        # one place.
        #
        # The first version stripped values with `if df[c].dtype == object`. On pandas 3
        # text columns are dtype `str`, not `object`, so the branch never ran and `SERIES`
        # kept its leading space — every `== "EQ"` filter matched nothing and RELIANCE
        # looked absent from a file it was plainly in. On pandas 2 the same code works, so
        # it would have shipped and broken on an upgrade. Sniffing dtypes to find text is
        # the bug; parsing correctly is the fix. See Section 67.
        df = pd.read_csv(io.StringIO(r.text), skipinitialspace=True)
        df.columns = [str(c).strip() for c in df.columns]
        for c in ("SYMBOL", "SERIES", "DATE1"):
            if c in df.columns:
                df[c] = df[c].astype(str).str.strip()        # trailing spaces too
        for c in ("DELIV_QTY", "DELIV_PER", "TTL_TRD_QNTY", "CLOSE_PRICE", "NO_OF_TRADES"):
            if c in df.columns:
                # These arrive as text because rows with no delivery carry '-'.
                df[c] = pd.to_numeric(df[c], errors="coerce")
        out["rows"] = int(len(df))

        if symbol:
            sel = df[(df["SYMBOL"] == symbol.upper()) & (df["SERIES"] == "EQ")] \
                if "SERIES" in df.columns else df[df["SYMBOL"] == symbol.upper()]
            if len(sel) == 0:
                out["error"] = f"{symbol} not in this file"
                return out
            row = sel.iloc[0]
            out.update({
                "symbol": symbol.upper(),
                "close": float(row.get("CLOSE_PRICE")) if pd.notna(row.get("CLOSE_PRICE")) else None,
                "tradedQty": float(row.get("TTL_TRD_QNTY")) if pd.notna(row.get("TTL_TRD_QNTY")) else None,
                "deliveryQty": float(row.get("DELIV_QTY")) if pd.notna(row.get("DELIV_QTY")) else None,
                "deliveryPct": float(row.get("DELIV_PER")) if pd.notna(row.get("DELIV_PER")) else None,
                "trades": float(row.get("NO_OF_TRADES")) if pd.notna(row.get("NO_OF_TRADES")) else None,
            })
        else:
            out["frame"] = df
        return out
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    finally:
        if own:
            client.close()


# ── Registry, for the enable/disable panel ────────────────────────────────────

def registry() -> list[dict]:
    """
    Every derivatives source, what it can do, and whether it can be backtested.

    `backtestable` is surfaced as a first-class property because it is the difference
    between a feature a model can learn from and a number on a dashboard, and nothing
    else in the response makes that distinction visible.
    """
    disabled = {s.strip().lower() for s in
                os.environ.get("STOCKMIND_DISABLE_PROVIDERS", "").split(",") if s.strip()}
    src = [
        {"name": "nse_fo_bhavcopy_udiff", "tier": "free", "backtestable": True,
         "covers": "~2024 onward", "provides": "per-contract OI, volume, OHLC, settlement",
         "notes": "Current UDiFF layout on nsearchives.nseindia.com."},
        {"name": "nse_fo_bhavcopy_legacy", "tier": "free", "backtestable": True,
         "covers": "2001 to 2024", "provides": "same fields, legacy column names",
         "notes": "2001 is when index options began trading in India, not an archive limit."},
        {"name": "nse_participant_oi", "tier": "free", "backtestable": True,
         "covers": "dated archive", "provides": "Client/DII/FII/Pro long and short OI",
         "notes": "The historical institutional-positioning signal."},
        {"name": "nse_delivery", "tier": "free", "backtestable": True,
         "covers": "dated archive", "provides": "delivery quantity and percentage",
         "notes": "Separates accumulation from intraday churn."},
        {"name": "nse_option_chain_v3", "tier": "free", "backtestable": False,
         "covers": "live snapshot", "provides": "full chain, per-strike OI and IV",
         "notes": "Requires an explicit expiry; option-chain-indices is 404."},
        {"name": "nse_fii_dii", "tier": "free", "backtestable": False,
         "covers": "latest published day", "provides": "FII/DII cash buy, sell, net",
         "notes": "No history from this endpoint — use participant OI instead."},
    ]
    for s in src:
        s["disabled"] = s["name"].lower() in disabled
        s["available"] = not s["disabled"]
    return src
