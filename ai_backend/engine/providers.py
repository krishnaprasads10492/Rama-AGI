"""
providers.py — where market data comes from, in priority order.

WHY THIS EXISTS. `data_fetcher.get_ohlcv` had two branches: OHLCV supplied in the
request, or a seeded random walk. The Yahoo fetcher next to it was `async` while
`get_ohlcv` was synchronous, so nothing ever awaited it — every prediction and every
backtest ran on synthetic data. See spec Section 65.

DESIGN — free first, premium optional, never a hard dependency.

Master's requirement is that Rāma work on free resources and *accommodate* premium
ones, enabled or disabled as needed. So a provider declares what it can do and what it
costs, and the chain walks them in order:

    request-supplied bars  →  local store  →  free providers  →  premium providers  →  mock

Every provider is optional. A missing key disables one silently rather than failing the
request, and `mock` remains the final fallback so the engine always answers — but the
answer is always labelled with where it came from, because a signal computed on
synthetic data must never look like one computed on real bars.

RATE LIMITS ARE PART OF THE DECLARATION, not an afterthought. Alpha Vantage's free tier
is 25 calls/day and a single daily-series call returns 100 points — so ten years of
history would exhaust a month of quota. It is therefore registered as premium-tier
despite having a free plan: treating it as a bulk-history source would be a design
error, not a configuration one.
"""

import os
import io
import csv
import time
import logging
import datetime as _dt
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("stockmind-ai.providers")

COLUMNS = ["date", "open", "high", "low", "close", "volume"]

# ── Symbol mapping ────────────────────────────────────────────────────────────

YAHOO_SYMBOLS = {
    "NIFTY50": "^NSEI", "NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK",
    "SENSEX": "^BSESN", "NIFTYIT": "^CNXIT", "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
    "NIFTYMID": "^NSEMDCP50", "MIDCPNIFTY": "^NSEMDCP50", "INDIAVIX": "^INDIAVIX",
    "BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD", "BNBUSDT": "BNB-USD",
    "SOLUSDT": "SOL-USD", "XRPUSDT": "XRP-USD",
    "GOLD": "GC=F", "SILVER": "SI=F", "CRUDEOIL": "CL=F", "NATURALGAS": "NG=F",
    "COPPER": "HG=F", "ZINC": "ZN=F",
    "SPX": "^GSPC", "NDX": "^NDX", "DJI": "^DJI", "VIX": "^VIX",
    "NIKKEI": "^N225", "HANGSENG": "^HSI", "FTSE": "^FTSE", "DAX": "^GDAXI",
    "USDINR": "USDINR=X", "EURUSD": "EURUSD=X",
}


def to_yahoo_symbol(symbol: str, exchange: str = "NSE") -> str:
    s = (symbol or "").upper().strip()
    if s in YAHOO_SYMBOLS:
        return YAHOO_SYMBOLS[s]
    if s.startswith("^") or "=" in s or "-" in s:
        return s                                    # already a Yahoo ticker
    ex = (exchange or "NSE").upper()
    if ex == "BSE":
        return f"{s}.BO"
    if ex in ("NASDAQ", "NYSE", "AMEX", "US"):
        return s
    return f"{s}.NS"


# ── Normalisation ─────────────────────────────────────────────────────────────

def normalise(df: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """
    Coerce any provider's frame into the canonical shape, or return None.

    Every provider returns something slightly different. Normalising once here means
    the engine never has to know which source it is looking at — and it means a
    provider that returns junk is rejected at the boundary rather than producing
    NaN-riddled features 200 lines later.
    """
    if df is None or len(df) == 0:
        return None
    out = df.copy()
    out.columns = [str(c).strip().lower() for c in out.columns]

    renames = {"adj close": "close", "adjclose": "close", "adj_close": "close",
               "timestamp": "date", "datetime": "date", "time": "date",
               "vol": "volume", "shares traded": "volume", "tottrdqty": "volume"}
    out = out.rename(columns={k: v for k, v in renames.items() if k in out.columns})

    if "date" not in out.columns or "close" not in out.columns:
        return None

    out["date"] = pd.to_datetime(out["date"], errors="coerce", utc=False)
    for col in ("open", "high", "low", "close", "volume"):
        if col not in out.columns:
            out[col] = np.nan
        out[col] = pd.to_numeric(out[col], errors="coerce")

    # A bar with no close is not a bar. Missing OHLC is filled from close, which is
    # honest for daily indices where some providers omit them.
    out = out.dropna(subset=["date", "close"])
    for col in ("open", "high", "low"):
        out[col] = out[col].fillna(out["close"])
    out["volume"] = out["volume"].fillna(0.0)

    # Reject physically impossible bars rather than feeding them to the indicators.
    bad = (out["high"] < out["low"]) | (out["close"] <= 0) | (out["high"] <= 0)
    if bad.any():
        logger.warning(f"[providers] dropped {int(bad.sum())} impossible bar(s)")
        out = out[~bad]

    out = (out[COLUMNS]
           .drop_duplicates(subset=["date"], keep="last")
           .sort_values("date")
           .reset_index(drop=True))
    return out if len(out) else None


# ── Provider descriptor ───────────────────────────────────────────────────────

class Provider:
    """
    One source of bars.

    `key_env` names the environment variable holding its credential. When that is
    required and absent the provider reports itself unavailable — it is skipped, not
    an error, so a free-only install behaves normally.
    """

    def __init__(self, name, tier, fetch, key_env=None, max_years=None,
                 markets=(), notes="", rate_note=""):
        self.name      = name
        self.tier      = tier            # 'free' | 'premium'
        self._fetch    = fetch
        self.key_env   = key_env
        self.max_years = max_years
        self.markets   = markets
        self.notes     = notes
        self.rate_note = rate_note

    @property
    def requires_key(self) -> bool:
        return bool(self.key_env)

    def api_key(self) -> Optional[str]:
        return os.environ.get(self.key_env) if self.key_env else None

    def available(self) -> bool:
        if self.disabled():
            return False
        return (not self.requires_key) or bool(self.api_key())

    def disabled(self) -> bool:
        """
        Explicitly switched off, per master's enable/disable requirement.

        `STOCKMIND_DISABLE_PROVIDERS=yahoo,stooq` turns sources off without editing
        code; `STOCKMIND_ONLY_PROVIDERS=nse_bhavcopy` restricts to a chosen set.
        """
        off  = {s.strip().lower() for s in os.environ.get("STOCKMIND_DISABLE_PROVIDERS", "").split(",") if s.strip()}
        only = {s.strip().lower() for s in os.environ.get("STOCKMIND_ONLY_PROVIDERS", "").split(",") if s.strip()}
        if self.name.lower() in off:
            return True
        if only and self.name.lower() not in only:
            return True
        return False

    def fetch(self, symbol, exchange, years, interval="1d") -> Optional[pd.DataFrame]:
        """
        `interval` is passed only to fetchers that accept it, so a provider written before
        Section 73 keeps its old two-positional signature and still works (I11).
        """
        try:
            try:
                raw = self._fetch(symbol, exchange, years, self.api_key(), interval)
            except TypeError:
                raw = self._fetch(symbol, exchange, years, self.api_key())
            return normalise(raw)
        except Exception as e:
            logger.warning(f"[{self.name}] fetch failed for {symbol}: {e}")
            return None

    def describe(self) -> dict:
        return {
            "name": self.name, "tier": self.tier,
            "requiresKey": self.requires_key, "keyEnv": self.key_env,
            "available": self.available(), "disabled": self.disabled(),
            "maxYears": self.max_years, "markets": list(self.markets),
            "notes": self.notes, "rateLimit": self.rate_note,
        }


def _http_get(url: str, headers: dict = None, timeout: float = 15.0):
    import httpx
    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json,text/csv,*/*"}
    hdrs.update(headers or {})
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url, headers=hdrs)
        resp.raise_for_status()
        return resp


# ── FREE: Yahoo Finance chart API ─────────────────────────────────────────────

# The deepest range Yahoo will serve for each intraday interval, measured rather than assumed
# (spec Section 73). Anything beyond these returns HTTP 422:
#   1m -> 5d (1,876 bars) | 5m, 15m, 30m -> 1mo | 60m -> 2y (3,499 bars)
# Only 60m has enough depth to train on; the finer ones are for display.
INTRADAY_RANGE = {
    "1m": "5d", "2m": "5d", "5m": "1mo", "15m": "1mo", "30m": "1mo",
    "60m": "2y", "1h": "2y", "90m": "1mo",
}


def _fetch_yahoo(symbol, exchange, years, _key, interval="1d"):
    """
    Synchronous Yahoo chart fetch — deepest free daily history available without a key.

    The existing implementation was `async` and never awaited (Section 64). This is the
    same endpoint, called from a sync client, so it is actually reachable.
    """
    sym = to_yahoo_symbol(symbol, exchange)

    # EXPLICIT EPOCH WINDOW, NOT `range=max`.
    #
    # `range=max&interval=1d` looks like it asks for every daily bar and does not
    # deliver it — Yahoo downsamples a max-range request, returning roughly monthly
    # bars. Measured: NIFTY 50 came back as 228 bars spanning 18.9 years, about 12 per
    # year. That is useless for daily prediction and, worse, arrives looking like a
    # successful deep-history fetch. `period1`/`period2` with an explicit interval
    # returns true daily bars for the window. See spec Section 65.
    # INTRADAY USES `range=`, DAILY USES EPOCHS (spec Section 73).
    #
    # The two forms are not interchangeable. Yahoo caps intraday windows server-side and those
    # caps are expressed against `range` — asking for `5m` over three months returns **HTTP
    # 422**, verified — so `range` is what an intraday request must send. Daily keeps the
    # explicit epochs because Section 65 measured that `range=max&interval=1d` silently
    # downsamples to roughly monthly bars while looking like a successful deep fetch.
    iv = str(interval or "1d").strip().lower()
    if iv in INTRADAY_RANGE:
        url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
               f"?interval={iv}&range={INTRADAY_RANGE[iv]}")
    else:
        now    = int(time.time())
        span   = int((years or 40) * 365.25 * 86400)
        period1 = max(0, now - span)
        url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
               f"?interval={iv}&period1={period1}&period2={now}&events=div%2Csplit")

    data   = _http_get(url).json()
    result = (data.get("chart") or {}).get("result") or [{}]
    result = result[0] or {}
    stamps = result.get("timestamp") or []
    if not stamps:
        return None

    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0] or {}
    adj   = (((result.get("indicators") or {}).get("adjclose") or [{}])[0] or {}).get("adjclose") or []

    def at(seq, i):
        return seq[i] if i < len(seq) else None

    rows = []
    for i, ts in enumerate(stamps):
        close = at(adj, i) or at(quote.get("close") or [], i)
        if close is None:
            continue
        rows.append({
            # `.date()` on an intraday bar throws away the time and every bar in a session
            # collapses to one timestamp — the same destruction Section 73 fixed in the store.
            "date":   (_dt.datetime.utcfromtimestamp(int(ts))
                       if iv in INTRADAY_RANGE
                       else _dt.datetime.utcfromtimestamp(int(ts)).date()),
            "open":   at(quote.get("open")   or [], i),
            "high":   at(quote.get("high")   or [], i),
            "low":    at(quote.get("low")    or [], i),
            "close":  close,
            "volume": at(quote.get("volume") or [], i) or 0,
        })
    return pd.DataFrame(rows) if rows else None


# ── FREE: NSE Bhavcopy archive (authentic, includes derivatives) ──────────────

def _fetch_nse_index(symbol, exchange, years, _key):
    """
    NSE's own historical index CSV — authentic, free, and published by the exchange.

    Preferred over any scraped source for Indian indices because it *is* the source.
    NSE requires a session cookie, so the index page is touched first.
    """
    sym = (symbol or "").upper().strip()
    index_names = {
        "NIFTY50": "NIFTY 50", "NIFTY": "NIFTY 50", "BANKNIFTY": "NIFTY BANK",
        "FINNIFTY": "NIFTY FINANCIAL SERVICES", "NIFTYIT": "NIFTY IT",
        "MIDCPNIFTY": "NIFTY MIDCAP SELECT", "NIFTYNEXT50": "NIFTY NEXT 50",
    }
    if sym not in index_names:
        return None

    import httpx
    name = index_names[sym]
    end   = _dt.date.today()
    start = end - _dt.timedelta(days=int((years or 25) * 365.25))
    url = ("https://www.nseindia.com/api/historical/indicesHistory"
           f"?indexType={name.replace(' ', '%20')}"
           f"&from={start.strftime('%d-%m-%Y')}&to={end.strftime('%d-%m-%Y')}")

    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json", "Referer": "https://www.nseindia.com/"}
    with httpx.Client(timeout=25.0, follow_redirects=True, headers=hdrs) as client:
        client.get("https://www.nseindia.com/reports-indices-historical-index-data")
        payload = client.get(url).json()

    records = ((payload.get("data") or {}).get("indexCloseOnlineRecords")) or []
    rows = [{
        "date":   r.get("EOD_TIMESTAMP"),
        "open":   r.get("EOD_OPEN_INDEX_VAL"),
        "high":   r.get("EOD_HIGH_INDEX_VAL"),
        "low":    r.get("EOD_LOW_INDEX_VAL"),
        "close":  r.get("EOD_CLOSE_INDEX_VAL"),
        "volume": 0,
    } for r in records]
    return pd.DataFrame(rows) if rows else None


# ── PREMIUM slots ─────────────────────────────────────────────────────────────

def _fetch_alpha_vantage(symbol, exchange, years, key):
    """
    Alpha Vantage daily adjusted.

    Registered PREMIUM despite offering a free key: the free tier is 25 calls/day, and
    one daily-series call returns 100 points, so a decade of history would consume a
    month of quota. Correct as a top-up or a cross-check, wrong as a bulk source.
    """
    if not key:
        return None
    sym = symbol if (exchange or "").upper() in ("NASDAQ", "NYSE", "US") else f"{symbol}.BSE"
    url = ("https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED"
           f"&symbol={sym}&outputsize=full&datatype=csv&apikey={key}")
    text = _http_get(url).text
    if "timestamp" not in text.split("\n")[0].lower():
        return None                                  # quota message or error body
    return pd.read_csv(io.StringIO(text))


def _fetch_eodhd(symbol, exchange, years, key):
    """EODHD end-of-day — 30+ years on paid plans."""
    if not key:
        return None
    suffix = {"NSE": "NSE", "BSE": "BSE", "NASDAQ": "US", "NYSE": "US"}.get((exchange or "NSE").upper(), "NSE")
    end   = _dt.date.today()
    start = end - _dt.timedelta(days=int((years or 30) * 365.25))
    url = (f"https://eodhd.com/api/eod/{symbol}.{suffix}"
           f"?from={start}&to={end}&period=d&fmt=csv&api_token={key}")
    return pd.read_csv(io.StringIO(_http_get(url).text))


def _fetch_twelvedata(symbol, exchange, years, key):
    if not key:
        return None
    url = (f"https://api.twelvedata.com/time_series?symbol={symbol}"
           f"&interval=1day&outputsize=5000&format=CSV&apikey={key}")
    return pd.read_csv(io.StringIO(_http_get(url).text), sep=";")


def _fetch_finnhub(symbol, exchange, years, key):
    if not key:
        return None
    end   = int(time.time())
    start = end - int((years or 5) * 365.25 * 86400)
    url = (f"https://finnhub.io/api/v1/stock/candle?symbol={symbol}"
           f"&resolution=D&from={start}&to={end}&token={key}")
    d = _http_get(url).json()
    if d.get("s") != "ok":
        return None
    return pd.DataFrame({
        "date":   [_dt.datetime.utcfromtimestamp(t).date() for t in d.get("t", [])],
        "open":   d.get("o", []), "high": d.get("h", []),
        "low":    d.get("l", []), "close": d.get("c", []),
        "volume": d.get("v", []),
    })


# ── The registry ──────────────────────────────────────────────────────────────
# Order matters: free and deepest first. `mock` is not registered here — it lives in
# data_fetcher as the explicit last resort so it can never be mistaken for a provider.

PROVIDERS = [
    Provider("yahoo", "free", _fetch_yahoo, max_years=None,
             markets=("NSE", "BSE", "US", "crypto", "commodity", "forex", "index"),
             notes="Deepest free daily history, no key. Unofficial endpoint — can change without notice.",
             rate_note="Undocumented; be polite. Cached locally so history is fetched once."),
    Provider("nse_index", "free", _fetch_nse_index, max_years=25,
             markets=("NSE-index",),
             notes="NSE's own published index history — authentic, exchange-sourced.",
             rate_note="Session-cookie gated; slow. Indices only."),
    Provider("alpha_vantage", "premium", _fetch_alpha_vantage, key_env="ALPHAVANTAGE_API_KEY",
             max_years=20, markets=("US", "BSE"),
             notes="20+ years adjusted daily. Free key exists but is 25 calls/day.",
             rate_note="Free: 25/day. Paid: 75/min."),
    Provider("eodhd", "premium", _fetch_eodhd, key_env="EODHD_API_KEY",
             max_years=30, markets=("NSE", "BSE", "US", "global"),
             notes="30+ years across stocks, ETFs, indices, forex, crypto.",
             rate_note="Plan-dependent."),
    Provider("twelvedata", "premium", _fetch_twelvedata, key_env="TWELVEDATA_API_KEY",
             max_years=5, markets=("US", "global"),
             notes="Intraday down to 1 minute on paid plans.",
             rate_note="Free: 800/day, 8/min."),
    Provider("finnhub", "premium", _fetch_finnhub, key_env="FINNHUB_API_KEY",
             max_years=5, markets=("US",),
             notes="US candles plus news and fundamentals.",
             rate_note="Free: 60/min."),
]


def registry() -> list[dict]:
    """Every provider and its current state — for the UI's enable/disable panel."""
    return [p.describe() for p in PROVIDERS]


def active(tier: str = None) -> list[Provider]:
    out = [p for p in PROVIDERS if p.available()]
    if tier:
        out = [p for p in out if p.tier == tier]
    # Free before premium, so a configured premium key supplements rather than
    # silently replaces a working free source — and never spends quota needlessly.
    return sorted(out, key=lambda p: 0 if p.tier == "free" else 1)


def fetch_history(symbol: str, exchange: str = "NSE", years: int = None,
                  interval: str = "1d") -> tuple[Optional[pd.DataFrame], str]:
    """
    Walk the chain and return the first usable frame, with the provider that supplied it.

    @returns (df, source_name) — (None, 'none') when every provider declined.
    """
    for p in active():
        # Only Yahoo serves intraday. Skipping the rest avoids a pointless call that would
        # return daily bars for an intraday request and quietly mislabel them.
        if interval != "1d" and p.name != "yahoo":
            continue
        df = p.fetch(symbol, exchange, years, interval)
        if df is not None and len(df) >= 20:
            logger.info(f"[providers] {symbol}: {len(df)} bars from {p.name} "
                        f"({df['date'].iloc[0].date()} → {df['date'].iloc[-1].date()})")
            return df, p.name
        if df is not None:
            logger.info(f"[providers] {p.name} returned only {len(df)} bar(s) for {symbol} — too few")
    return None, "none"
