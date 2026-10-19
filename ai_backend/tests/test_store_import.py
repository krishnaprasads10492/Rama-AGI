"""
test_store_import.py - bars handed in from another process (spec Section 156)

Kite's access token lives in the Electron main process, so the main process fetches candles and hands them to the
engine through `store.import_bars` / `POST /store/import`. The engine must trust none of it:
    the source is on a list     only "kite" may import
    the shape is checked         columns, size, numbers, dates
    contradictions are refused   a batch whose closes fall outside their own bars is stored NOWHERE (Section 154)
    it lands like any provider   same merge, same files, same provenance, intraday keeps its time

Needs pandas; without it this prints SKIP and exits 0. The route is exercised when fastapi's test client exists.
Run:  python -m tests.test_store_import   (from ai_backend/)
"""

from __future__ import annotations

import os
import sys
import tempfile

try:
    import numpy as np
    import pandas as pd
except Exception as _exc:                                           # pragma: no cover - environment dependent
    print(f"SKIP  test_store_import: pandas/numpy are not installed here ({_exc}). Nothing was checked.")
    sys.exit(0)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_TMP = tempfile.mkdtemp(prefix="rama-import-test-")
DATA = os.path.join(_TMP, "history")
os.environ["STOCKMIND_DATA_DIR"] = DATA
os.environ["STOCKMIND_MODELS_DIR"] = os.path.join(_TMP, "models")
from engine import store          # noqa: E402

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


def daily(n=30, start="2026-01-01", base=100.0):
    d = pd.bdate_range(start=start, periods=n)
    return [{"date": str(x.date()), "open": base + i, "high": base + i + 2, "low": base + i - 2, "close": base + i + 1, "volume": 1000 + i} for i, x in enumerate(d)]


def intraday(n=20, day="2026-10-16", start_utc="03:45:00"):
    t0 = pd.Timestamp(f"{day} {start_utc}")
    return [{"date": (t0 + pd.Timedelta(minutes=15 * i)).strftime("%Y-%m-%d %H:%M:%S"), "open": 100 + i, "high": 103 + i, "low": 99 + i, "close": 101 + i, "volume": 500} for i in range(n)]


def written() -> list:
    out = []
    for root, _, files in os.walk(DATA):
        out += [os.path.join(root, f) for f in files]
    return out


print("\ntest_store_import - bars from another process\n")

print("--- a good import lands like any provider ---")
before = written()
r = store.import_bars("RELIANCE", "NSE", "1d", "kite", daily(30))
check("it succeeds and says how many", r["ok"] is True and r["imported"] == 30 and r["bars"] == 30, str(r))
df = store.load("RELIANCE", "NSE", "1d")
check("the bars are in the store, ascending", df is not None and len(df) == 30 and df["date"].is_monotonic_increasing)
check("the provenance names the source", store.meta("RELIANCE", "NSE", "1d")["lastSource"] == "kite")
check("a daily series keeps date-only stamps on disk", open(store.paths("RELIANCE", "NSE", "1d")[0], encoding="utf-8").read().splitlines()[1].split(",")[0] == "2026-01-01")
r2 = store.import_bars("RELIANCE", "NSE", "1d", "kite", daily(30))
check("importing the same bars again changes nothing (idempotent)", r2["ok"] and r2["bars"] == 30 and len(store.load("RELIANCE", "NSE", "1d")) == 30)
r3 = store.import_bars("RELIANCE", "NSE", "1d", "kite", daily(10, "2026-03-02", 200))
check("newer bars extend the series", r3["ok"] and r3["bars"] == 40)
dup = daily(5) + daily(5)
r4 = store.import_bars("DUPCO", "NSE", "1d", "kite", dup)
check("duplicate dates inside one batch are collapsed", r4["ok"] and r4["imported"] == 5 and len(store.load("DUPCO", "NSE", "1d")) == 5)
nov = [{k: v for k, v in b.items() if k != "volume"} for b in daily(5)]
check("a batch with no volume column is stored with zero volume", store.import_bars("NOVOL", "NSE", "1d", "kite", nov)["ok"] and float(store.load("NOVOL", "NSE", "1d")["volume"].sum()) == 0.0)
strs = [{"date": b["date"], "open": str(b["open"]), "high": str(b["high"]), "low": str(b["low"]), "close": str(b["close"]), "volume": "10"} for b in daily(5)]
check("numbers sent as text are accepted", store.import_bars("STRCO", "NSE", "1d", "kite", strs)["ok"])
extra = [dict(b, secret="x", oi=5) for b in daily(5)]
check("unknown fields are ignored, not stored", store.import_bars("EXTRA", "NSE", "1d", "kite", extra)["ok"] and list(store.load("EXTRA", "NSE", "1d").columns) == ["date", "open", "high", "low", "close", "volume"])

print("\n--- intraday keeps its time (Section 73) ---")
ri = store.import_bars("RELIANCE", "NSE", "15m", "kite", intraday(20))
check("a 15-minute import succeeds", ri["ok"] and ri["imported"] == 20)
di = store.load("RELIANCE", "NSE", "15m")
check("all twenty bars survive (one per bar, not one per day)", len(di) == 20)
check("and the clock time is on disk", "03:45:00" in open(store.paths("RELIANCE", "NSE", "15m")[0], encoding="utf-8").read())

print("\n--- nothing is trusted ---")
files_before = set(written())
for label, args, why in [
    ("an unknown source", ("X", "NSE", "1d", "yahoo", daily(5)), "not an allowed import source"),
    ("a source that merely looks like kite", ("X", "NSE", "1d", "kite ", daily(5)), "not an allowed import source"),
    ("an unknown interval", ("X", "NSE", "7d", "kite", daily(5)), "not an interval"),
    ("a weekly interval", ("X", "NSE", "1wk", "kite", daily(5)), "not an interval"),
    ("no bars", ("X", "NSE", "1d", "kite", []), "no bars"),
    ("bars that are not a list", ("X", "NSE", "1d", "kite", {"a": 1}), "no bars"),
    ("too many bars", ("X", "NSE", "1d", "kite", daily(1) * (store.MAX_IMPORT_BARS + 1)), "more than one import"),
    ("a missing column", ("X", "NSE", "1d", "kite", [{k: v for k, v in b.items() if k != "high"} for b in daily(5)]), "needs date"),
    ("an unreadable price", ("X", "NSE", "1d", "kite", [dict(b, open="abc") for b in daily(5)]), "missing or unreadable"),
    ("an unreadable date", ("X", "NSE", "1d", "kite", [dict(b, date="yesterday") for b in daily(5)]), "missing or unreadable"),
    ("a zero price", ("X", "NSE", "1d", "kite", [dict(b, low=0) for b in daily(5)]), "zero or negative"),
    ("a negative price", ("X", "NSE", "1d", "kite", [dict(b, close=-1) for b in daily(5)]), "zero or negative"),
]:
    res = store.import_bars(*args)
    check(f"{label} is refused", res["ok"] is False and why in res["reason"], str(res))
check("every refusal wrote nothing", set(written()) == files_before)

print("\n--- a batch that contradicts itself is stored nowhere ---")
mixed = [dict(b, close=b["close"] * 0.5) for b in daily(40)]
res = store.import_bars("BADCO", "NSE", "1d", "kite", mixed)
check("closes outside their own bars: refused whole", res["ok"] is False and "contradict" in res["reason"], str(res))
check("and no file exists for it", store.load("BADCO", "NSE", "1d") is None and not any("BADCO" in p for p in written()))
few = daily(1000)
few[3] = dict(few[3], close=few[3]["close"] * 0.1)
check("one bad bar in a thousand is tolerated (under the repair share)", store.import_bars("TOLER", "NSE", "1d", "kite", few)["ok"] is True)

print("\n--- hostile names stay inside the store ---")
res = store.import_bars("../../evil", "NSE", "1d", "kite", daily(5))
check("a path-like symbol is sanitised into the store, never outside it", res["ok"] and all(os.path.abspath(p).startswith(os.path.abspath(DATA)) for p in written()))
res = store.import_bars("X", "../..", "1d", "kite", daily(5))
check("so is a path-like exchange", res["ok"] and all(os.path.abspath(p).startswith(os.path.abspath(DATA)) for p in written()))

print("\n--- the route ---")
try:
    from fastapi.testclient import TestClient
    import main as app_main
    client = TestClient(app_main.app)
except Exception as _exc:                                           # pragma: no cover - environment dependent
    client = None
    print(f"  SKIP  route checks: fastapi test client unavailable here ({type(_exc).__name__})")
if client is not None:
    ok = client.post("/store/import", json={"symbol": "ROUTECO", "exchange": "NSE", "interval": "1d", "source": "kite", "bars": daily(10)})
    check("a valid import over HTTP succeeds", ok.status_code == 200 and ok.json()["ok"] is True and ok.json()["imported"] == 10)
    check("it is in the store afterwards", len(store.load("ROUTECO", "NSE", "1d")) == 10)
    check("an unknown source is rejected by the schema (422)", client.post("/store/import", json={"symbol": "X", "interval": "1d", "source": "yahoo", "bars": daily(3)}).status_code == 422)
    check("an empty batch is rejected by the schema (422)", client.post("/store/import", json={"symbol": "X", "interval": "1d", "source": "kite", "bars": []}).status_code == 422)
    check("an over-long symbol is rejected (422)", client.post("/store/import", json={"symbol": "X" * 40, "interval": "1d", "source": "kite", "bars": daily(3)}).status_code == 422)
    check("a missing field is rejected (422)", client.post("/store/import", json={"symbol": "X", "source": "kite", "bars": daily(3)}).status_code == 422)
    bad = client.post("/store/import", json={"symbol": "ROUTEBAD", "exchange": "NSE", "interval": "1d", "source": "kite", "bars": mixed})
    check("a contradicting batch over HTTP is a clean refusal, not a 500", bad.status_code == 200 and bad.json()["ok"] is False)

print(f"\n  {_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
