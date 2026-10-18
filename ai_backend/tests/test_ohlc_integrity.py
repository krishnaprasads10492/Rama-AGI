"""
test_ohlc_integrity.py - candles must be one price basis (spec Section 154)

Found on live RELIANCE data: the close was the dividend-ADJUSTED price while open, high and low were raw, so the
close sat outside its own bar on 93% of the history and a strategy judged on those bars changed its verdict.
What this proves:
    one basis        every bar built from a Yahoo chart payload has open, high, low and close from the same
                     (raw, split-adjusted) quote, whatever `adjclose` says
    the check        impossible bars are counted, a tiny share is tolerated, a large share asks for a rebuild
    it heals         a stored series that was written mixed is rebuilt in full on the next sync, not topped up
    it leaves alone  a consistent series is not refetched, and a top-up still asks for one year

Needs pandas; without it this prints SKIP and exits 0. No network: the provider is faked.
Run:  python -m tests.test_ohlc_integrity   (from ai_backend/)
"""
from __future__ import annotations

import os
import sys
import tempfile

try:
    import numpy as np
    import pandas as pd
except Exception as _exc:                                           # pragma: no cover - environment dependent
    print(f"SKIP  test_ohlc_integrity: pandas/numpy are not installed here ({_exc}). Nothing was checked.")
    sys.exit(0)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_TMP = tempfile.mkdtemp(prefix="rama-ohlc-test-")
os.environ["STOCKMIND_DATA_DIR"] = os.path.join(_TMP, "history")
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")
from engine import store, providers          # noqa: E402

_pass = 0
_fail = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {label}")
    else:
        _fail += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


def clean_frame(n=300, start="2024-01-01"):
    d = pd.bdate_range(start=start, periods=n)
    px = 100 + np.arange(n) * 0.3
    return pd.DataFrame({"date": d, "open": px, "high": px + 1.0, "low": px - 1.0, "close": px + 0.2, "volume": 1000.0})


def mixed_frame(n=300, start="2024-01-01", factor=0.8):
    """Raw open/high/low with a dividend-adjusted close: the close drops below the low."""
    f = clean_frame(n, start)
    f["close"] = f["close"] * factor
    return f


print("\ntest_ohlc_integrity - one price basis per bar\n")

# ── the payload ──────────────────────────────────────────────────────────────────────────────────
print("--- bars are built from one basis, whatever adjclose says ---")
payload = {
    "timestamp": [1700000000, 1700086400, 1700172800, 1700259200],
    "indicators": {
        "quote": [{"open": [100, 101, 102, 103], "high": [105, 106, 107, 108], "low": [99, 100, 101, 102],
                   "close": [104, 105, None, 107], "volume": [10, None, 30, 40]}],
        "adjclose": [{"adjclose": [60, 61, 62, 63]}],       # a heavy dividend adjustment that would break every bar
    },
}
rows = providers.chart_rows(payload, intraday=False)
check("a bar with no raw close is dropped, not filled from the adjusted series", len(rows) == 3)
check("the close is the RAW close, never adjclose", [r["close"] for r in rows] == [104, 105, 107])
check("so every close lies inside its own bar", all(r["low"] <= r["close"] <= r["high"] for r in rows))
check("a missing volume is zero", rows[1]["volume"] == 0)
check("daily bars carry a date, not a time", all(type(r["date"]).__name__ == "date" for r in rows))
irows = providers.chart_rows(payload, intraday=True)
check("intraday bars keep their time of day", all(type(r["date"]).__name__ == "datetime" for r in irows) and irows[0]["date"] != irows[1]["date"])
check("a payload with no timestamps is no bars, and junk does not throw", providers.chart_rows({}, False) == [] and providers.chart_rows(None, False) == [] and providers.chart_rows({"timestamp": [1]}, False) == [])
check("a payload with no adjclose at all is unchanged", len(providers.chart_rows({"timestamp": payload["timestamp"], "indicators": {"quote": payload["indicators"]["quote"]}}, False)) == 3)

# ── the check ────────────────────────────────────────────────────────────────────────────────────
print("\n--- impossible bars are counted ---")
check("a consistent series has none", store.ohlc_violations(clean_frame()) == 0)
check("no data is none", store.ohlc_violations(None) == 0 and store.ohlc_violations(clean_frame(0)) == 0)
m = mixed_frame()
check("the dividend-adjusted close mixed with raw bars is caught on every bar", store.ohlc_violations(m) == len(m), str(store.ohlc_violations(m)))
f = clean_frame()
f.loc[10, "high"] = f.loc[10, "close"] - 5
check("a high below the close is one violation", store.ohlc_violations(f) == 1)
f = clean_frame()
f.loc[20, "low"] = f.loc[20, "open"] + 5
check("a low above the open is one violation", store.ohlc_violations(f) == 1)
f = clean_frame()
f.loc[30, "close"] = 0
check("a non-positive price is a violation", store.ohlc_violations(f) >= 1)
f = clean_frame()
f.loc[40, "close"] = float("nan")
check("a missing price is not counted as a violation (it is missing, not impossible)", store.ohlc_violations(f) == 0)
f = clean_frame()
f["high"] = f["high"].where(f.index != 50, f["close"] * (1 - 1e-9))
check("a rounding-sized breach is tolerated", store.ohlc_violations(f) == 0)
check("a doji (open = high = low = close) is valid", store.ohlc_violations(pd.DataFrame({"date": pd.bdate_range("2024-01-01", periods=3), "open": 5.0, "high": 5.0, "low": 5.0, "close": 5.0, "volume": 0.0})) == 0)

print("\n--- how much is too much ---")
n = 1000
f = clean_frame(n)
bad = int(n * store.REPAIR_SHARE)
f.loc[:bad - 1, "high"] = f.loc[:bad - 1, "close"] - 5
check("exactly the tolerated share does not ask for a rebuild", store.ohlc_violations(f) == bad and store.needs_repair(f) is False)
f.loc[bad, "high"] = f.loc[bad, "close"] - 5
check("one more does", store.needs_repair(f) is True)
check("a clean series never does, and an empty one does not", store.needs_repair(clean_frame()) is False and store.needs_repair(None) is False)

# ── the healing ──────────────────────────────────────────────────────────────────────────────────
print("\n--- a series stored mixed is rebuilt, not topped up ---")


class Fake:
    def __init__(self, frame):
        self.frame = frame
        self.calls = []

    def __call__(self, symbol, exchange="NSE", years=None, interval="1d"):
        self.calls.append(years)
        return self.frame, "fake"


real_fetch = providers.fetch_history
today = pd.Timestamp.today().normalize()
span = pd.bdate_range(end=today, periods=400)


def series(factor=1.0):
    px = 100 + np.arange(len(span)) * 0.3
    return pd.DataFrame({"date": span, "open": px, "high": px + 1.0, "low": px - 1.0, "close": (px + 0.2) * factor, "volume": 1000.0})


try:
    stored_mixed = series(0.8)
    store.merge("BADCO", stored_mixed, "NSE", "1d", source="old")
    check("the mixed series was stored as written (merge does not judge)", store.ohlc_violations(store.load("BADCO", "NSE", "1d")) == len(span))
    fake = Fake(series(1.0))
    providers.fetch_history = fake
    df, info = store.sync("BADCO", "NSE", "1d")
    check("the next sync rebuilds even though the series is current (its newest bar is today)", info.get("repaired") is True and len(fake.calls) == 1)
    check("and asks for the deep history, not the one-year top-up", fake.calls[0] == 30, str(fake.calls))
    check("afterwards no bar is impossible", store.ohlc_violations(store.load("BADCO", "NSE", "1d")) == 0)
    check("the rebuilt closes are the fetched ones", abs(float(store.load("BADCO", "NSE", "1d")["close"].iloc[-1]) - float(series(1.0)["close"].iloc[-1])) < 1e-6)

    fake2 = Fake(series(1.0))
    providers.fetch_history = fake2
    _, info2 = store.sync("BADCO", "NSE", "1d")
    check("a consistent, current series is NOT refetched", len(fake2.calls) == 0 and info2.get("repaired") is False)

    old = clean_frame(300, "2022-01-03")
    store.merge("OLDCO", old, "NSE", "1d", source="old")
    fake3 = Fake(series(1.0))
    providers.fetch_history = fake3
    _, info3 = store.sync("OLDCO", "NSE", "1d")
    check("a clean but stale series is still a one-year top-up", len(fake3.calls) == 1 and fake3.calls[0] == 1 and info3.get("repaired") is False, str(fake3.calls))

    store.merge("DEAD", mixed_frame(300, "2024-01-01"), "NSE", "1d", source="old")
    providers.fetch_history = lambda *a, **k: (None, "none")
    got, info4 = store.sync("DEAD", "NSE", "1d")
    check("if the provider has nothing, the stored series is returned untouched and the failure is said", got is not None and len(got) == 300 and "no provider" in info4.get("reason", ""))
finally:
    providers.fetch_history = real_fetch

print("\n--- symbols: a hyphen is a currency pair only when a currency follows it (Section 154) ---")
t = providers.to_yahoo_symbol
check("BAJAJ-AUTO is an NSE stock and gets its suffix", t("BAJAJ-AUTO", "NSE") == "BAJAJ-AUTO.NS")
check("and on BSE", t("BAJAJ-AUTO", "BSE") == "BAJAJ-AUTO.BO")
check("MAHINDRA-CIE likewise", t("MAHINDRA-CIE") == "MAHINDRA-CIE.NS")
check("BTC-USD and ETH-USD still pass through", t("BTC-USD") == "BTC-USD" and t("ETH-USD") == "ETH-USD")
check("a currency future still passes through", t("EURINR=X") == "EURINR=X")
check("an index is unchanged", t("NIFTY50") == "^NSEI")
check("the round trip holds for a hyphenated stock", providers.to_yahoo_symbol(*providers.from_yahoo_symbol("BAJAJ-AUTO.NS")) == "BAJAJ-AUTO.NS")
check("a bare hyphen or empty base is not a pair", providers._is_pair("-USD") is False and providers._is_pair("USD") is False and providers._is_pair("") is False)

print(f"\n  {_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
