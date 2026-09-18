"""
Tests for the provider chain and the local historical store (spec Section 65).

The store's guarantees are what make a backtest trustworthy, so they are asserted
directly: never shrink, de-duplicate on date, survive a partial write, record
provenance. Network fetches are attempted but never required — a blocked machine still
verifies the logic.

Run from `ai_backend/`:  python -m tests.test_store
"""

import os
import sys
import json
import shutil
import tempfile
import datetime as _dt

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Point the store at a throwaway directory BEFORE importing it.
_TMP = tempfile.mkdtemp(prefix="rama-store-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP

from engine import store, providers          # noqa: E402
from engine.data_fetcher import get_ohlcv    # noqa: E402

PASS = 0
FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}" + (f" — {detail}" if detail else ""))


def bars(n, start="2020-01-01", price=100.0, seed=1):
    rng   = np.random.default_rng(seed)
    dates = pd.bdate_range(start=start, periods=n)
    close = price * np.cumprod(1 + rng.normal(0.0004, 0.01, n))
    return pd.DataFrame({
        "date": dates, "open": close, "high": close * 1.01,
        "low": close * 0.99, "close": close, "volume": np.full(n, 1e6),
    })


# ── Provider registry: declares itself, respects enable/disable ───────────────
print("\n--- provider registry ---")
reg = providers.registry()
check("providers are registered", len(reg) >= 4, str(len(reg)))
check("every provider declares a tier", all(p["tier"] in ("free", "premium") for p in reg))
check("free providers need no key",
      all(not p["requiresKey"] for p in reg if p["tier"] == "free"),
      str([p["name"] for p in reg if p["tier"] == "free" and p["requiresKey"]]))
check("premium providers name their key variable",
      all(p["keyEnv"] for p in reg if p["tier"] == "premium"))
check("premium providers without a key are unavailable, not errors",
      all(not p["available"] for p in reg
          if p["tier"] == "premium" and not os.environ.get(p["keyEnv"] or "x")))
check("at least one free provider is available with no configuration",
      any(p["available"] for p in reg if p["tier"] == "free"))
check("free is ordered before premium",
      [p.tier for p in providers.active()] == sorted([p.tier for p in providers.active()]))

print("\n--- enable / disable without editing code ---")
os.environ["STOCKMIND_DISABLE_PROVIDERS"] = "yahoo"
check("a named provider can be switched off",
      "yahoo" not in [p.name for p in providers.active()],
      str([p.name for p in providers.active()]))
os.environ.pop("STOCKMIND_DISABLE_PROVIDERS")
check("and switched back on", "yahoo" in [p.name for p in providers.active()])

os.environ["STOCKMIND_ONLY_PROVIDERS"] = "nse_index"
check("an allowlist restricts to exactly that set",
      [p.name for p in providers.active()] == ["nse_index"],
      str([p.name for p in providers.active()]))
os.environ.pop("STOCKMIND_ONLY_PROVIDERS")

print("\n--- symbol mapping ---")
check("NIFTY maps to the Yahoo index ticker", providers.to_yahoo_symbol("NIFTY50") == "^NSEI")
check("an NSE equity gets .NS", providers.to_yahoo_symbol("RELIANCE", "NSE") == "RELIANCE.NS")
check("a BSE equity gets .BO", providers.to_yahoo_symbol("RELIANCE", "BSE") == "RELIANCE.BO")
check("a US equity is unsuffixed", providers.to_yahoo_symbol("AAPL", "NASDAQ") == "AAPL")
check("commodities map to futures tickers", providers.to_yahoo_symbol("GOLD") == "GC=F")
check("an already-Yahoo ticker is untouched", providers.to_yahoo_symbol("^GSPC") == "^GSPC")

# ── Normalisation rejects junk at the boundary ────────────────────────────────
print("\n--- normalisation ---")
check("a frame with no close is rejected",
      providers.normalise(pd.DataFrame({"date": ["2020-01-01"], "open": [1]})) is None)
check("None in, None out", providers.normalise(None) is None)
messy = pd.DataFrame({
    "Date": ["2020-01-02", "2020-01-01", "2020-01-02"],
    "Open": [10, 9, 10], "High": [11, 10, 11], "Low": [9, 8, 9],
    "Adj Close": [10.5, 9.5, 10.6], "Volume": [100, 200, 150],
})
norm = providers.normalise(messy)
check("column names and adj-close are normalised", list(norm.columns) == store.COLUMNS)
check("rows are sorted by date", norm["date"].is_monotonic_increasing)
check("duplicate dates are collapsed, keeping the later row",
      len(norm) == 2 and abs(float(norm["close"].iloc[-1]) - 10.6) < 1e-9)
impossible = pd.DataFrame({"date": ["2020-01-01", "2020-01-02"], "open": [10, 10],
                           "high": [8, 11], "low": [9, 9], "close": [10, 10], "volume": [1, 1]})
check("high < low is dropped as physically impossible", len(providers.normalise(impossible)) == 1)
missing_ohl = pd.DataFrame({"date": ["2020-01-01"] , "close": [50.0]})
filled = providers.normalise(missing_ohl)
check("missing OHL is filled from close", float(filled["open"].iloc[0]) == 50.0)

# ── The store's guarantees ────────────────────────────────────────────────────
print("\n--- store: write, read, provenance ---")
first = bars(300, "2015-01-01", seed=2)
saved = store.merge("TESTSYM", first, "NSE", "1d", source="unit-test")
check("bars are persisted", saved is not None and len(saved) == 300, str(None if saved is None else len(saved)))
back = store.load("TESTSYM", "NSE", "1d")
check("bars round-trip from disk", back is not None and len(back) == 300)
check("dates survive the round-trip as timestamps",
      pd.api.types.is_datetime64_any_dtype(back["date"]))
m = store.meta("TESTSYM", "NSE", "1d")
check("provenance records the source", m.get("lastSource") == "unit-test")
check("provenance records the range", m.get("firstBar") and m.get("lastBar"))
check("provenance records years covered", isinstance(m.get("yearsCovered"), (int, float)))

print("\n--- store: merge is a union, never a truncation ---")
overlap = bars(60, "2016-06-01", seed=3)            # sits inside the existing range
merged = store.merge("TESTSYM", overlap, "NSE", "1d", source="unit-test-2")
check("an overlapping fetch does not duplicate rows",
      merged["date"].duplicated().sum() == 0, str(int(merged["date"].duplicated().sum())))
check("an overlapping fetch does not lose history", len(merged) >= 300, str(len(merged)))

short = bars(10, "2015-01-01", seed=4)              # a bad, tiny response
after_short = store.merge("TESTSYM", short, "NSE", "1d", source="bad-response")
check("a short response cannot shrink the store",
      len(after_short) >= len(merged), f"{len(merged)} -> {len(after_short)}")

newer = bars(40, "2020-01-01", seed=5)              # extends forward
extended = store.merge("TESTSYM", newer, "NSE", "1d", source="unit-test-3")
check("newer bars extend the range forward",
      pd.Timestamp(extended["date"].iloc[-1]) > pd.Timestamp(merged["date"].iloc[-1]))
check("still sorted after extension", extended["date"].is_monotonic_increasing)
check("a later fetch corrects an earlier bar rather than duplicating it",
      extended["date"].duplicated().sum() == 0)

print("\n--- store: staleness is business-day aware ---")
fresh = bars(50, (pd.Timestamp.today() - pd.tseries.offsets.BDay(50)).strftime("%Y-%m-%d"), seed=6)
store.merge("FRESHSYM", fresh, "NSE", "1d", source="unit-test")
check("a store ending today is not stale", not store.is_stale("FRESHSYM", "NSE", "1d"))
check("an old store is stale", store.is_stale("TESTSYM", "NSE", "1d"))
check("an absent symbol is stale", store.is_stale("NEVERSEEN", "NSE", "1d"))

# ── Intraday staleness, which the date-based test could not express (spec Section 101) ──
#
# THE DEFECT THIS COVERS. `is_stale` used to normalise the newest bar to a DATE, so for an
# intraday series it compared today against today and answered "current" — a 5m series fetched
# at 10:00 stayed "current" until midnight and `sync=True` returned the same frozen frame for
# the rest of the session. The chart looked broken while the store believed it was up to date.
print("\n--- store: intraday staleness is clock-based, not date-based ---")


def intraday_bars(n, last_utc, minutes):
    """`n` bars of `minutes` width ending at `last_utc`, stamped naive UTC as the store does."""
    stamps = [last_utc - pd.Timedelta(minutes=minutes * i) for i in range(n - 1, -1, -1)]
    close = np.linspace(100.0, 101.0, n)
    return pd.DataFrame({
        "date": stamps, "open": close, "high": close * 1.002,
        "low": close * 0.998, "close": close, "volume": np.full(n, 1000.0),
    })


_now = pd.Timestamp.now(tz="UTC").tz_localize(None)

# A 5m series whose newest bar is 4 minutes old: inside two bar widths, so not stale.
store.merge("INTRAFRESH", intraday_bars(60, _now - pd.Timedelta(minutes=4), 5),
            "NSE", "5m", source="unit-test")
check("a 5m series with a 4-minute-old bar is current",
      not store.is_stale("INTRAFRESH", "NSE", "5m"))

# The same series aged past two bar widths. The cooldown is keyed on `lastFetchedAt`, which the
# merge above has just written, so it is rewritten into the past to reach the stale branch.
store.merge("INTRASTALE", intraday_bars(60, _now - pd.Timedelta(hours=3), 5),
            "NSE", "5m", source="unit-test")
_stale_meta_path = store.paths("INTRASTALE", "NSE", "5m")[1]
_rec = json.load(open(_stale_meta_path, encoding="utf-8"))
_rec["lastFetchedAt"] = (_dt.datetime.now() - _dt.timedelta(hours=3)).isoformat(timespec="seconds")
json.dump(_rec, open(_stale_meta_path, "w", encoding="utf-8"))
check("a 5m series three hours behind IS stale",
      store.is_stale("INTRASTALE", "NSE", "5m"))

# The same bars, still three hours old, but fetched a moment ago: the cooldown holds. Without
# this, an out-of-hours request would re-fetch on every single call all night.
store.merge("INTRACOOL", intraday_bars(60, _now - pd.Timedelta(hours=3), 5),
            "NSE", "5m", source="unit-test")
check("a just-fetched series is not re-fetched merely because the market is shut",
      not store.is_stale("INTRACOOL", "NSE", "5m"))

# An unparseable fetch stamp must fail toward "stale", which is the recoverable direction.
_rec["lastFetchedAt"] = "not-a-timestamp"
json.dump(_rec, open(_stale_meta_path, "w", encoding="utf-8"))
check("an unparseable fetch stamp does not make a series permanently fresh",
      store.is_stale("INTRASTALE", "NSE", "5m"))

# Coarse intervals: a weekly bar is not late until a whole week could have closed.
_two_days_back = (pd.Timestamp.today() - pd.tseries.offsets.BDay(2)).normalize()
store.merge("WEEKLYSYM",
            pd.DataFrame({
                "date": pd.date_range(end=_two_days_back, periods=60, freq="7D"),
                "open": np.full(60, 100.0), "high": np.full(60, 101.0),
                "low": np.full(60, 99.0), "close": np.full(60, 100.5),
                "volume": np.full(60, 1000.0),
            }), "NSE", "1wk", source="unit-test")
check("a weekly series two sessions behind is not stale",
      not store.is_stale("WEEKLYSYM", "NSE", "1wk"))
check("but a daily series two sessions behind is",
      store.is_stale("TESTSYM", "NSE", "1d"))

# ── Symbol search must only offer names the fetcher can use (spec Section 102) ──
#
# The picker is now backed by the provider's own search, which returns already-suffixed Yahoo tickers
# for every market. If `from_yahoo_symbol` does not round-trip, the picker offers master a name and the
# fetcher turns it into something else — `RWC.AX` became `RWC.AX.NS` before the suffix branch existed,
# which is precisely the "offers something it cannot resolve" failure the picker was meant to remove.
print("\n--- symbol search: every offerable name round-trips ---")

for _y, _disp in [
    ("RELIANCE.NS", "NSE"), ("TCS.NS", "NSE"), ("RELIANCE.BO", "BSE"),
    ("^NSEI", "NSE"), ("^GSPC", "SNP"), ("^N225", "Osaka"),
    ("AAPL", "NASDAQ"), ("RS", "NYSE"),
    ("RWC.AX", "Australian"), ("RIGD.IL", "International Orderbook - London"),
    ("BTC-USD", "CCC"), ("GC=F", "COMEX"), ("USDINR=X", "CCY"),
]:
    _sym, _ex = providers.from_yahoo_symbol(_y, _disp)
    _back = providers.to_yahoo_symbol(_sym, _ex)
    check(f"{_y} round-trips via ({_sym}, {_ex})", _back == _y, f"got {_back}")

check("a mapped index comes back as Rama's canonical name, not the Yahoo ticker",
      providers.from_yahoo_symbol("^NSEI", "NSE")[0] == "NIFTY50",
      str(providers.from_yahoo_symbol("^NSEI", "NSE")))
check("an alias never wins over the canonical name",
      providers.YAHOO_TO_RAMA.get("^NSEI") == "NIFTY50",
      str(providers.YAHOO_TO_RAMA.get("^NSEI")))
check("a bare ticker from an unnameable exchange is not given .NS",
      providers.from_yahoo_symbol("XYZ", "Some Exchange")[1] == "US",
      str(providers.from_yahoo_symbol("XYZ", "Some Exchange")))
check("an empty ticker degrades rather than throwing",
      providers.from_yahoo_symbol("", "")[0] == "")
check("every Yahoo value in the forward map round-trips through the reverse map",
      all(providers.to_yahoo_symbol(*providers.from_yahoo_symbol(_v)) == _v
          for _v in providers.YAHOO_SYMBOLS.values()),
      str([_v for _v in providers.YAHOO_SYMBOLS.values()
           if providers.to_yahoo_symbol(*providers.from_yahoo_symbol(_v)) != _v]))

# The search itself needs network, so it is attempted and not required — same rule as the fetch below.
try:
    _hits = providers.search_symbols("reliance", limit=6)
    check("search returned usable rows", len(_hits) > 0, "network may be blocked")
    if _hits:
        check("every hit carries a symbol and an exchange",
              all(h.get("symbol") and h.get("exchange") for h in _hits))
        check("every hit is fetchable — its symbol resolves back to its own Yahoo ticker",
              all(providers.to_yahoo_symbol(h["symbol"], h["exchange"]) == h["yahooSymbol"]
                  for h in _hits),
              str([h for h in _hits
                   if providers.to_yahoo_symbol(h["symbol"], h["exchange"]) != h["yahooSymbol"]]))
        check("no option contracts are offered — no history can be drawn for one",
              all(h.get("kind") != "Option" for h in _hits))
        check("hits are unique on (symbol, exchange)",
              len({(h["symbol"], h["exchange"]) for h in _hits}) == len(_hits))
except Exception as _e:
    print(f"  SKIP  live symbol search unavailable ({_e})")

check("an empty query asks the provider nothing", providers.search_symbols("") == [])
check("a whitespace query asks the provider nothing", providers.search_symbols("   ") == [])

print("\n--- store: empty and malformed inputs ---")
check("merging nothing returns what was there",
      len(store.merge("TESTSYM", None, "NSE", "1d")) == len(extended))
check("merging an empty frame is a no-op",
      len(store.merge("TESTSYM", pd.DataFrame(), "NSE", "1d")) == len(extended))
check("loading an unknown symbol returns None", store.load("NOPE", "NSE", "1d") is None)
check("meta for an unknown symbol is empty", store.meta("NOPE", "NSE", "1d") == {})

print("\n--- inventory ---")
inv = store.inventory()
check("inventory lists stored symbols", len(inv) >= 2, str(len(inv)))
check("inventory entries carry depth", all("bars" in e and "firstBar" in e for e in inv))

# ── get_ohlcv wiring ──────────────────────────────────────────────────────────
print("\n--- get_ohlcv honours the priority order ---")
supplied = [{"date": str(d.date()), "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}
            for d in pd.bdate_range("2021-01-01", periods=40)]
df, is_real = get_ohlcv({"symbol": "ANY", "ohlcv": supplied, "basePrice": 100})
check("request-supplied bars win and are marked real", is_real and len(df) == 40)

df, is_real = get_ohlcv({"symbol": "TESTSYM", "exchange": "NSE", "basePrice": 100, "noNetwork": True})
check("with no network it falls back to mock, marked not-real", not is_real)
check("the mock fallback still returns usable bars", len(df) >= 200)
check("mock bars carry dates so date filtering works", "date" in df.columns)

# ── A live fetch, attempted but not required ──────────────────────────────────
print("\n--- live provider fetch (network permitting) ---")
live, source = providers.fetch_history("NIFTY50", "NSE", years=30)
if live is None:
    print("  SKIP  no provider reachable from this machine — logic above is unaffected")
else:
    span = (live["date"].iloc[-1] - live["date"].iloc[0]).days / 365.25
    print(f"        {source}: {len(live)} bars, {live['date'].iloc[0].date()} → {live['date'].iloc[-1].date()} ({span:.1f}y)")
    check("live fetch returns a usable series", len(live) >= 200)
    check("live fetch is normalised", list(live.columns) == store.COLUMNS)
    check("live fetch is chronological", live["date"].is_monotonic_increasing)
    check("live fetch has no duplicate dates", live["date"].duplicated().sum() == 0)
    check("live history is genuinely deep (>5y)", span > 5, f"{span:.1f} years")

    # THE ASSERTION THAT CAUGHT range=max SILENTLY RETURNING MONTHLY BARS.
    # A count alone is not enough: 228 bars over 18.9 years passed a ">= 200" check
    # while being monthly data. Density is the property that actually matters.
    per_year = len(live) / max(span, 0.01)
    check("bars are DAILY, not silently downsampled (>=150/year)",
          per_year >= 150, f"{per_year:.1f} bars/year over {span:.1f}y — monthly data masquerading as daily")

    gaps = live["date"].diff().dt.days.dropna()
    check("the median gap between bars is a few days, not a month",
          float(gaps.median()) <= 5, f"median gap {float(gaps.median()):.1f} days")
    synced, info = store.sync("NIFTY50", "NSE", "1d", years=30)
    check("a live fetch lands in the store", synced is not None and len(synced) >= len(live))
    check("sync reports its source", info.get("source") == source)

print(f"\n{PASS} passed, {FAIL} failed")
shutil.rmtree(_TMP, ignore_errors=True)
sys.exit(1 if FAIL else 0)
