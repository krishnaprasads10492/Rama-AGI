"""
data_fetcher.py — Fetch real OHLCV data for the AI backend.

Priority:
  1. OHLCV passed directly in the request (from Node.js backend — preferred)
  2. Yahoo Finance v8 chart API (direct HTTP, no key)
  3. Mock OHLCV (fallback — clearly labelled)

The Node.js backend pre-fetches OHLCV and passes it in the request body,
so the AI backend doesn't need to make its own HTTP calls in most cases.
"""

import numpy as np
import pandas as pd
import logging
from typing import Optional

# httpx is imported lazily inside the fetch functions. At module scope it made the
# entire engine unimportable without httpx — `engine/__init__` imports dispatcher,
# which imports this module — even for callers that only wanted the feature maths.
# Same defect class as scikit-learn in calibration.py. See spec Section 64.

logger = logging.getLogger("stockmind-ai.data")

# ── Symbol mapping (StockMind → Yahoo Finance) ────────────────────────────────

SYMBOL_MAP = {
    "NIFTY50": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN",
    "NIFTYIT": "^CNXIT", "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
    "NIFTYMID": "^NSMIDCP", "NIFTY": "^NSEI", "MIDCPNIFTY": "^NSMIDCP",
    "BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD", "BNBUSDT": "BNB-USD",
    "GOLD": "GC=F", "SILVER": "SI=F", "CRUDEOIL": "CL=F",
    "SPX": "^GSPC", "NDX": "^NDX", "DJI": "^DJI",
}

def to_yahoo_symbol(symbol: str, exchange: str = "NSE") -> str:
    if symbol in SYMBOL_MAP:
        return SYMBOL_MAP[symbol]
    if exchange == "BSE":
        return f"{symbol}.BO"
    return f"{symbol}.NS"


# ── Convert request OHLCV (list of dicts) to DataFrame ───────────────────────

def ohlcv_to_df(ohlcv: list[dict]) -> Optional[pd.DataFrame]:
    """Convert the OHLCV list from the Node.js request to a pandas DataFrame."""
    if not ohlcv or len(ohlcv) < 20:
        return None
    try:
        df = pd.DataFrame(ohlcv)
        df = df.rename(columns={"close": "close", "open": "open", "high": "high",
                                  "low": "low", "volume": "volume"})
        for col in ["open", "high", "low", "close", "volume"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["close"])
        df = df.sort_values("date") if "date" in df.columns else df
        df = df.reset_index(drop=True)
        return df if len(df) >= 20 else None
    except Exception as e:
        logger.warning(f"[DataFetcher] Failed to convert OHLCV: {e}")
        return None


# ── Fetch from Yahoo Finance v8 (direct HTTP) ─────────────────────────────────

async def fetch_ohlcv_yahoo(symbol: str, exchange: str = "NSE", bars: int = 250) -> Optional[pd.DataFrame]:
    """Fetch OHLCV from Yahoo Finance v8 chart API."""
    yahoo_sym = to_yahoo_symbol(symbol, exchange)
    range_map = {60: "3mo", 130: "6mo", 260: "1y", 780: "3y"}
    range_str = next((v for k, v in sorted(range_map.items()) if bars <= k), "5y")

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}?interval=1d&range={range_str}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }

    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        result = data.get("chart", {}).get("result", [{}])[0]
        timestamps = result.get("timestamp", [])
        q = result.get("indicators", {}).get("quote", [{}])[0]
        adj_close = result.get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", q.get("close", []))

        rows = []
        for i, ts in enumerate(timestamps):
            close = adj_close[i] if i < len(adj_close) and adj_close[i] else (q.get("close", [])[i] if i < len(q.get("close", [])) else None)
            if close is None:
                continue
            rows.append({
                "date":   pd.Timestamp(ts, unit="s"),
                "open":   q.get("open",   [])[i] if i < len(q.get("open",   [])) else close,
                "high":   q.get("high",   [])[i] if i < len(q.get("high",   [])) else close,
                "low":    q.get("low",    [])[i] if i < len(q.get("low",    [])) else close,
                "close":  close,
                "volume": q.get("volume", [])[i] if i < len(q.get("volume", [])) else 0,
            })

        if len(rows) < 20:
            return None

        df = pd.DataFrame(rows).tail(bars).reset_index(drop=True)
        logger.info(f"[DataFetcher] Fetched {len(df)} bars for {symbol} from Yahoo")
        return df

    except Exception as e:
        logger.warning(f"[DataFetcher] Yahoo fetch failed for {symbol}: {e}")
        return None


# ── Mock OHLCV (deterministic, seeded by price) ───────────────────────────────

def mock_ohlcv(base_price: float, n: int = 250) -> pd.DataFrame:
    """
    Generate deterministic mock OHLCV.
    Used only when real data is unavailable.
    Clearly labelled in logs.
    """
    logger.info(f"[DataFetcher] Using mock OHLCV for base_price={base_price:.2f} (n={n})")

    # A LOCAL generator, not `np.random.seed`. The global reseed made every unrelated
    # numpy draw in the process deterministic as a side effect of asking for mock bars —
    # so any randomness elsewhere silently became a function of the price master typed.
    # Deterministic mock data is the intent; deterministic *everything else* was not.
    # See spec Section 64.
    rng = np.random.default_rng(int(base_price) % 10000)

    returns  = rng.normal(0.0002, 0.012, n)
    closes   = base_price * np.cumprod(1 + returns)
    opens    = np.roll(closes, 1)
    opens[0] = base_price
    highs    = closes * (1 + np.abs(rng.normal(0, 0.005, n)))
    lows     = closes * (1 - np.abs(rng.normal(0, 0.005, n)))
    volumes  = np.abs(rng.normal(1e6, 3e5, n))

    # A `date` column, which mock data never had. Without it `filter_by_date_range`
    # returns the frame untouched, so `preset`, `fromDate`, `toDate` and `interval` were
    # all silently ignored by /backtest on mock data — and the bar-time features had
    # nothing to read.
    dates = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)

    return pd.DataFrame({
        "date": dates,
        "open": opens, "high": highs, "low": lows,
        "close": closes, "volume": volumes,
    })


# ── Main entry point ──────────────────────────────────────────────────────────

def get_ohlcv(params: dict) -> tuple[pd.DataFrame, bool]:
    """
    Get OHLCV for a request, in order of preference.

        1. bars supplied in the request
        2. the local historical store, topped up from the provider chain
        3. mock — explicitly last, and always labelled

    WHAT THIS REPLACES (spec Section 65). There used to be only steps 1 and 3: the
    Yahoo fetcher beside this function was `async` while this function is synchronous,
    so nothing ever awaited it. The renderer never sends `ohlcv` either, so **every
    prediction and every backtest ran on a random walk seeded by the typed price.**

    Returns:
        (df, is_real)
    """
    # 1. Bars supplied by the caller.
    if params.get("ohlcv"):
        df = ohlcv_to_df(params["ohlcv"])
        if df is not None and len(df) >= 20:
            return df, True

    # 2. The local store, extended by the provider chain when it has fallen behind.
    symbol   = params.get("symbol")
    exchange = params.get("exchange", "NSE")
    if symbol and not params.get("noNetwork"):
        try:
            from . import store
            df, info = store.sync(symbol, exchange, "1d",
                                  years=params.get("historyYears"))
            if df is not None and len(df) >= 20:
                logger.info(f"[DataFetcher] {symbol}: {len(df)} bars "
                            f"({info.get('firstBar')} → {info.get('lastBar')}) via {info.get('source')}")
                return df, True
            logger.warning(f"[DataFetcher] {symbol}: store/providers gave nothing usable — {info.get('reason')}")
        except Exception as e:
            logger.warning(f"[DataFetcher] {symbol}: history lookup failed ({e})")

    # 3. Mock, last resort, always labelled as such by the caller.
    base_price = params.get("basePrice", 100.0)
    return mock_ohlcv(base_price, 250), False
