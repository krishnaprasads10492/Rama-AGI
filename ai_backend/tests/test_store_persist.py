"""
test_store_persist.py - view-only fetch, and the store's write path (spec Section 153)

Needs pandas (the store is a pandas module). Without it this prints SKIP and exits 0, so a chain such as
`npm run verify:strategy` does not break on a machine that lacks the data stack. The routes are exercised
too when fastapi's test client is importable.

No network: `providers.fetch_history` is replaced by a fake that returns what the test says.

What it proves:
    persist=False writes nothing   no csv, no meta, no temp file, no directory - and still returns the union
    the view is the keep           the union a view returns equals what a persisting merge would have stored
    persist=True is unchanged      writes the csv and the meta, tops up, reports what it added
    the cooldown holds             a repeat view fetch inside the window does not reach the provider
    merges serialise               concurrent merges into one series lose nothing and leave no temp files
    looking does not write         load / meta / is_stale / paths(create=False) create no directory

Run:  python -m tests.test_store_persist   (from ai_backend/)
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import shutil
import sys
import tempfile
import threading

try:
    import pandas as pd
    import numpy as np
except Exception as _exc:                                           # pragma: no cover - environment dependent
    print(f"SKIP  test_store_persist: pandas/numpy are not installed here ({_exc}). Nothing was checked.")
    sys.exit(0)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_TMP = tempfile.mkdtemp(prefix="rama-persist-test-")
DATA = os.path.join(_TMP, "not-yet-created")             # deliberately absent: creating it is a write
os.environ["STOCKMIND_DATA_DIR"] = DATA
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


def frame(start: str, n: int, freq: str = "B", base: float = 100.0, bump: float = 0.0) -> pd.DataFrame:
    dates = pd.date_range(start=start, periods=n, freq=freq)
    px = base + np.arange(n) * 0.5 + bump
    return pd.DataFrame({"date": dates, "open": px, "high": px + 1, "low": px - 1, "close": px + 0.25, "volume": 1000.0})


class FakeProvider:
    def __init__(self):
        self.calls = 0
        self.reply = None
        self.source = "fake"

    def __call__(self, symbol, exchange="NSE", years=None, interval="1d"):
        self.calls += 1
        return (None if self.reply is None else self.reply.copy()), self.source


FAKE = FakeProvider()
providers.fetch_history = FAKE


def tree(root: str) -> list:
    out = []
    for d, _dirs, files in os.walk(root):
        out.append(os.path.relpath(d, root))
        out.extend(os.path.relpath(os.path.join(d, f), root) for f in files)
    return sorted(out)


def snapshot_bytes(root: str) -> dict:
    snap = {}
    for d, _dirs, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            with open(p, "rb") as fh:
                snap[os.path.relpath(p, root)] = (fh.read(), os.path.getmtime(p))
    return snap


def age_meta(symbol: str, exchange: str, interval: str) -> None:
    """Pretend the last persisted fetch was a day ago, so the intraday cooldown has expired."""
    mp = store.paths(symbol, exchange, interval)[1]
    m = json.load(open(mp, encoding="utf-8"))
    m["lastFetchedAt"] = (_dt.datetime.now() - _dt.timedelta(days=1)).isoformat(timespec="seconds")
    json.dump(m, open(mp, "w", encoding="utf-8"))


def reset() -> None:
    shutil.rmtree(DATA, ignore_errors=True)
    store.clear_view_cache()
    FAKE.calls = 0
    FAKE.reply = None


def stale_daily(sym: str, ex: str = "NSE", n: int = 30) -> pd.DataFrame:
    """Daily bars ending ~2 months ago: stale for any weekday, so sync wants to fetch."""
    end = pd.Timestamp.today().normalize() - pd.Timedelta(days=70)
    return frame(str((end - pd.offsets.BDay(n)).date()), n)


def recent_daily(last_back_days: int, n: int) -> pd.DataFrame:
    end = pd.Timestamp.today().normalize() - pd.Timedelta(days=last_back_days)
    return frame(str((end - pd.offsets.BDay(n - 1)).date()), n, base=150.0)


print("\nstore - view-only fetch, serialised writes, reads that write nothing\n")
try:
    # ═══ looking does not write ═══════════════════════════════════════════════════════════════════
    print("--- reading never creates a directory ---")
    reset()
    check("load of an unknown series is None", store.load("GHOST", "NSE", "1d") is None)
    check("meta of an unknown series is empty", store.meta("GHOST", "NSE", "1d") == {})
    check("is_stale of an unknown series is True", store.is_stale("GHOST", "NSE", "1d") is True)
    p = store.paths("GHOST", "NSE", "1d")
    check("paths() returns locations without creating them", not os.path.exists(DATA) and p[0].endswith("GHOST__1D.csv"), str(p))
    check("none of that created even the data root", not os.path.exists(DATA))
    store.paths("GHOST", "NSE", "1d", create=True)
    check("create=True is the write path and does create the exchange directory", os.path.isdir(os.path.join(DATA, "NSE")))
    reset()

    # ═══ persist=False writes nothing ═════════════════════════════════════════════════════════════
    print("\n--- persist=False on an empty store ---")
    FAKE.reply = frame("2026-01-01", 40)
    df, info = store.sync("VIEWONLY", "NSE", "1d", persist=False)
    check("it returns the fetched bars", df is not None and len(df) == 40, str(None if df is None else len(df)))
    check("it asked the provider once", FAKE.calls == 1)
    check("it reports that nothing was saved", info["persisted"] is False and info["unsaved"] is True and info["fetched"] is True, str(info))
    check("no csv, no meta, no temp file, no directory: the data root does not exist", not os.path.exists(DATA), str(tree(_TMP)))
    check("the store still says there is nothing", store.load("VIEWONLY", "NSE", "1d") is None)

    print("\n--- persist=False on a populated store ---")
    reset()
    old = stale_daily("TWIN")
    store.merge("TWIN", old, "NSE", "1d", source="seed")
    store.merge("TWIN", old, "BSE", "1d", source="seed")           # an identical twin to apply a real merge to
    before = snapshot_bytes(DATA)
    new = pd.concat([old.iloc[-5:].assign(close=lambda d: d["close"] + 7.0), recent_daily(1, 12)], ignore_index=True)
    FAKE.reply = new
    view, vinfo = store.sync("TWIN", "NSE", "1d", persist=False)
    after = snapshot_bytes(DATA)
    check("the on-disk files are byte-identical and untouched (same mtimes)", before == after)
    check("no temp files appeared", not any(k.endswith(".tmp") for k in after))
    check("the view is longer than what is stored", len(view) > len(old), f"{len(view)} vs {len(old)}")
    check("info says the bars are unsaved and reports what was added", vinfo["unsaved"] is True and vinfo["barsAdded"] == len(view) - len(old), str(vinfo))
    check("the stored series is unchanged when read back", len(store.load("TWIN", "NSE", "1d")) == len(old))
    kept = store.merge("TWIN", new, "BSE", "1d", source="fake")          # what persisting the same fetch keeps
    v2 = view.reset_index(drop=True)
    k2 = kept.reset_index(drop=True)
    check("THE VIEW IS THE KEEP: the union a view returned equals what a persisting merge stored",
          len(v2) == len(k2) and np.allclose(v2[["open", "high", "low", "close", "volume"]].values, k2[["open", "high", "low", "close", "volume"]].values)
          and (v2["date"].values == k2["date"].values).all())
    over = view[view["date"].isin(old.iloc[-5:]["date"])]
    check("a re-fetched date takes the newer value, once (keep='last')", len(over) == 5 and np.allclose(over["close"].values, old.iloc[-5:]["close"].values + 7.0))
    check("there is exactly one row per date", view["date"].is_unique)

    print("\n--- a short answer cannot shrink the view ---")
    reset()
    store.merge("SHORT", stale_daily("SHORT", n=60), "NSE", "1d", source="seed")
    FAKE.reply = recent_daily(1, 4)
    sv, _ = store.sync("SHORT", "NSE", "1d", persist=False)
    check("60 stored + 4 fetched is at least 60", len(sv) >= 60 and len(sv) == 64, str(len(sv)))
    reset()
    store.merge("SHORT", stale_daily("SHORT", n=60), "NSE", "1d", source="seed")
    FAKE.reply = stale_daily("SHORT", n=60).iloc[10:20]
    sv, _ = store.sync("SHORT", "NSE", "1d", persist=False, force=True)
    check("a fetch that is a strict subset of what is stored returns all of what is stored", len(sv) == 60, str(len(sv)))

    print("\n--- an intraday view keeps the time of day ---")
    reset()
    stamps = pd.date_range(end=pd.Timestamp.now(tz="UTC").tz_localize(None).floor("h") - pd.Timedelta(hours=40), periods=30, freq="h")
    seed = pd.DataFrame({"date": stamps, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "volume": 10.0})
    store.merge("INTRA", seed, "NSE", "60m", source="seed")
    store.merge("INTRA", seed, "BSE", "60m", source="seed")
    age_meta("INTRA", "NSE", "60m")
    age_meta("INTRA", "BSE", "60m")
    fresh = pd.date_range(end=pd.Timestamp.now(tz="UTC").tz_localize(None).floor("h"), periods=20, freq="h")
    FAKE.reply = pd.DataFrame({"date": fresh, "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.5, "volume": 20.0})
    before = snapshot_bytes(DATA)
    iv, iinfo = store.sync("INTRA", "NSE", "60m", persist=False)
    check("it wrote nothing", before == snapshot_bytes(DATA))
    check("hourly bars on the same day are all kept, not collapsed to one per day", len(iv) > 30 and iv["date"].dt.date.nunique() < len(iv), str(len(iv)))
    check("the time component is present", iv["date"].dt.hour.nunique() > 1)
    ik = store.merge("INTRA", FAKE.reply, "BSE", "60m", source="fake")
    check("and equals what persisting the same fetch keeps", (iv["date"].values == ik["date"].values).all() and len(iv) == len(ik))

    # ═══ the cooldown ═════════════════════════════════════════════════════════════════════════════
    print("\n--- the cooldown: a view fetch must not hammer the provider ---")
    FAKE.calls = 0
    v1, i1 = store.sync("INTRA", "NSE", "60m", persist=False)
    check("a second view fetch inside the cooldown does not reach the provider", FAKE.calls == 0 and i1.get("reusedView") is True, str(i1))
    check("it returns the same candles as the first view, not a shorter stored series", len(v1) == len(iv) and (v1["date"].values == iv["date"].values).all())
    check("and says it reused a fetch, without claiming a new one", i1["fetched"] is False and "reused" in i1["reason"], i1["reason"])
    check("the persisted cooldown stamp was not touched by viewing", store.meta("INTRA", "NSE", "60m").get("lastSource") == "seed")
    store.clear_view_cache()
    store.sync("INTRA", "NSE", "60m", persist=False)
    check("after the window (cache cleared) it fetches again", FAKE.calls == 1)
    FAKE.calls = 0
    store.sync("INTRA", "NSE", "60m", persist=False, force=True)
    check("force bypasses the cooldown", FAKE.calls == 1)
    FAKE.calls = 0
    sp, pinfo = store.sync("INTRA", "NSE", "60m", persist=True)
    check("a persisting sync is not served by the view cache: it fetches and writes", FAKE.calls == 1 and pinfo["fetched"] is True and pinfo["persisted"] is True and pinfo["unsaved"] is False, str(pinfo))
    check("and it did write", store.meta("INTRA", "NSE", "60m").get("lastSource") == "fake")

    print("\n--- a failed fetch is not remembered ---")
    reset()
    FAKE.reply = None
    d1, f1 = store.sync("DOWN", "NSE", "1d", persist=False)
    d2, f2 = store.sync("DOWN", "NSE", "1d", persist=False)
    check("an offline provider returns nothing, and says so", d1 is None and f1["reason"] == "no provider returned data", str(f1))
    check("and the next click tries again (a blip must be retryable)", FAKE.calls == 2)
    check("with nothing written", not os.path.exists(DATA))

    print("\n--- a current store needs no fetch, view or not ---")
    reset()
    store.merge("CUR", recent_daily(0, 30), "NSE", "1d", source="seed")
    FAKE.calls = 0
    cv, cinfo = store.sync("CUR", "NSE", "1d", persist=False)
    check("no provider call, the stored series back, nothing unsaved", FAKE.calls == 0 and len(cv) == 30 and cinfo["unsaved"] is False and cinfo["reason"] == "store is current", str(cinfo))

    # ═══ persist=True unchanged ═══════════════════════════════════════════════════════════════════
    print("\n--- persist=True behaves as it always did ---")
    reset()
    FAKE.reply = frame("2026-01-01", 50)
    pdf, pi = store.sync("KEEP", "NSE", "1d")
    csv_path, meta_path = store.paths("KEEP", "NSE", "1d")
    check("the default is persist=True and it writes the csv and the meta", os.path.exists(csv_path) and os.path.exists(meta_path))
    check("it returns the merged frame and the old info keys", len(pdf) == 50 and pi["fetched"] is True and pi["source"] == "fake" and pi["bars"] == 50 and pi["barsAdded"] == 50 and pi["reason"] == "fetched deep history", str(pi))
    m = json.load(open(meta_path, encoding="utf-8"))
    check("the provenance record is valid JSON with the usual fields", m["bars"] == 50 and m["lastSource"] == "fake" and m["firstBar"] == "2026-01-01" and "lastFetchedAt" in m and "yearsCovered" in m)
    check("no temp files are left", not [f for f in tree(DATA) if f.endswith(".tmp")])
    check("what is on disk reads back identically", len(store.load("KEEP", "NSE", "1d")) == 50)
    FAKE.calls = 0
    FAKE.reply = frame("2026-01-01", 50).iloc[:10]
    again = store.merge("KEEP", FAKE.reply, "NSE", "1d", source="fake2")
    check("a shorter re-merge still never shrinks", len(again) == 50)
    check("an empty merge returns what is stored", len(store.merge("KEEP", pd.DataFrame(columns=store.COLUMNS), "NSE", "1d")) == 50)
    check("a merge into nothing with nothing returns None", store.merge("NOPE", None, "NSE", "1d") is None and store.load("NOPE", "NSE", "1d") is None)
    check("a frame with no usable dates is refused rather than raising", store.merge("BADD", pd.DataFrame({"date": ["x", "y"], "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}), "NSE", "1d") is None)

    # ═══ concurrency ══════════════════════════════════════════════════════════════════════════════
    print("\n--- concurrent merges into one series ---")
    reset()
    blocks = [frame(str((pd.Timestamp("2020-01-01") + pd.Timedelta(days=40 * i)).date()), 20, freq="D", base=100.0 + i) for i in range(10)]
    errs = []

    def writer(b):
        try:
            for _ in range(3):
                store.merge("RACE", b, "NSE", "1d", source="t")
        except Exception as exc:
            errs.append(repr(exc))

    ts = [threading.Thread(target=writer, args=(b,)) for b in blocks]
    [t.start() for t in ts]
    [t.join() for t in ts]
    got = store.load("RACE", "NSE", "1d")
    check("no merge raised", not errs, str(errs))
    check("every block survived: 10 blocks of 20 bars, none lost to a racing writer", got is not None and len(got) == 200, str(None if got is None else len(got)))
    check("sorted, de-duplicated", got["date"].is_monotonic_increasing and got["date"].is_unique)
    check("no temp files are left behind", not [f for f in tree(DATA) if f.endswith(".tmp")], str(tree(DATA)))
    mj = json.load(open(store.paths("RACE", "NSE", "1d")[1], encoding="utf-8"))
    check("the provenance file is whole JSON that agrees with the csv", mj["bars"] == 200)
    check("two merges of DIFFERENT series do not share a lock", store._lock_for(store.paths("A", "NSE", "1d")[0]) is not store._lock_for(store.paths("B", "NSE", "1d")[0]))
    check("and the same series always gets the same lock", store._lock_for(store.paths("A", "NSE", "1d")[0]) is store._lock_for(store.paths("A", "NSE", "1d")[0]))
    reset()
    store.merge("ATOM", frame("2026-01-01", 30), "NSE", "1d", source="seed")
    mp = store.paths("ATOM", "NSE", "1d")[1]
    cp = store.paths("ATOM", "NSE", "1d")[0]
    check("meta.json is written through a unique temp name, replaced atomically (no fixed .tmp)", not os.path.exists(mp + ".tmp") and not os.path.exists(cp + ".tmp"))

    print("\n--- writers that share no lock still cannot trample each other's temp files ---")
    # The per-series lock covers one process. The unique temp name is what keeps two writers apart when the
    # lock is not between them (a second backend process, or a caller that goes around `merge`), so it is
    # exercised directly: with a fixed name one writer renames the other's half-written file away.
    reset()
    store.merge("TMPRACE", frame("2026-01-01", 20), "NSE", "1d", source="seed")
    wl = [frame("2026-01-01", 20 + 5 * i) for i in range(5)]
    werrs = []

    def raw_writer(f):
        try:
            for _ in range(4):
                store._write_series(f, "TMPRACE", "NSE", "1d", "t", 20, None)
        except Exception as exc:
            werrs.append(repr(exc))

    ts = [threading.Thread(target=raw_writer, args=(f,)) for f in wl]
    [t.start() for t in ts]
    [t.join() for t in ts]
    final = store.load("TMPRACE", "NSE", "1d")
    check("no unlocked writer raised", not werrs, str(werrs[:2]))
    check("the file on disk is one writer's complete frame, never a mixture", final is not None and len(final) in {len(f) for f in wl}, str(None if final is None else len(final)))
    check("and no temp file is left", not [f for f in tree(DATA) if f.endswith(".tmp")], str(tree(DATA)))

    print("\n--- the union never returns fewer rows than it was given ---")
    held = frame("2026-01-01", 30)
    damaged = held.copy()
    damaged.loc[5, "close"] = np.nan                 # a stored row with no close: dropped by the required-column rule
    out = store.union_frames(damaged, held.iloc[:2])      # overlaps held rows, so nothing offsets the dropped one
    check("a union that would lose a row refuses and hands back what was held", out is damaged and len(out) == 30)
    check("an ordinary union grows", len(store.union_frames(held, frame("2026-03-01", 5))) == 35)
    check("an empty incoming frame returns what was held, unchanged", store.union_frames(held, pd.DataFrame(columns=store.COLUMNS)) is held and store.union_frames(held, None) is held)
    reset()
    store.merge("DMG", held, "NSE", "1d", source="seed")
    cp = store.paths("DMG", "NSE", "1d")[0]
    raw = pd.read_csv(cp)
    raw.loc[5, "close"] = np.nan
    raw.to_csv(cp, index=False)
    bytes_before = open(cp, "rb").read()
    kept_rows = store.merge("DMG", held.iloc[:2], "NSE", "1d", source="t")
    check("merge applies the same refusal: nothing is written when the union would shrink", len(kept_rows) == 30 and open(cp, "rb").read() == bytes_before)

    # ═══ the routes ═══════════════════════════════════════════════════════════════════════════════
    print("\n--- the routes (needs fastapi's test client) ---")
    try:
        from fastapi.testclient import TestClient
        import main as M
        client = TestClient(M.app)
        have_routes = True
    except Exception as exc:
        have_routes = False
        print(f"  SKIP  route checks: fastapi test client or main.py could not be imported ({exc!r}). UNVERIFIED.")

    if have_routes:
        reset()
        old = stale_daily("RT")
        store.merge("RT", old, "NSE", "1d", source="seed")
        FAKE.reply = pd.concat([old, recent_daily(1, 10)], ignore_index=True)
        before = snapshot_bytes(DATA)
        r = client.get("/ohlcv/RT", params={"exchange": "NSE", "interval": "1d", "sync": "true", "persist": "false", "limit": 20000}).json()
        check("GET /ohlcv with persist=false returns the union", r["count"] == r["matched"] and r["count"] > len(old), str({k: r.get(k) for k in ("count", "stored")}))
        check("and says persisted:false", r["persisted"] is False)
        check("and wrote nothing", before == snapshot_bytes(DATA))
        d = client.get("/ohlcv/RT", params={"sync": "false"}).json()
        check("a plain disk read afterwards is still the OLD series, persisted:true", d["stored"] == len(old) and d["persisted"] is True)
        w = client.get("/ohlcv/RT", params={"sync": "true", "limit": 20000}).json()
        check("the default (persist omitted) keeps today's behaviour: it writes", w["persisted"] is True and w["stored"] > len(old) and len(store.load("RT", "NSE", "1d")) == w["stored"], str(w["stored"]))
        check("the bars keep the /ohlcv shape", set(w["bars"][0]) == {"date", "open", "high", "low", "close", "volume"})
        wn = client.get("/ohlcv/RT", params={"fromDate": w["bars"][3]["date"], "toDate": w["bars"][8]["date"]}).json()
        check("date windowing is unchanged (inclusive of both days)", wn["count"] == 6 and wn["firstBar"] == w["bars"][3]["date"] and wn["lastBar"] == w["bars"][8]["date"], str(wn["count"]))

        print("\n--- dataset routes ---")
        reset()
        old = stale_daily("DS")
        store.merge("DS", old, "NSE", "1d", source="seed")
        FAKE.reply = pd.concat([old, recent_daily(1, 10)], ignore_index=True)
        store.clear_view_cache()
        shown = client.get("/ohlcv/DS", params={"sync": "true", "persist": "false", "limit": 20000}).json()
        disk_before = len(store.load("DS", "NSE", "1d"))
        files_before = {k: v for k, v in snapshot_bytes(DATA).items() if "_datasets" not in k}
        sv = client.post("/dataset/save", json={"symbol": "DS", "exchange": "NSE", "interval": "1d", "label": "view", "sync": True, "expectBars": shown["count"]}).json()
        check("save succeeds under the suggested name", sv["ok"] is True and sv["name"].startswith("DS.NSE.1d.") and sv["name"].endswith(".view"), str(sv))
        check("the server built the snapshot from the SAME bars the chart showed", sv["bars"] == shown["count"] and "note" not in sv, str(sv))
        check("the working store was not touched by the save", len(store.load("DS", "NSE", "1d")) == disk_before and files_before == {k: v for k, v in snapshot_bytes(DATA).items() if "_datasets" not in k})
        ld = client.get(f"/dataset/{sv['name']}").json()
        check("GET /dataset/{name} returns exactly the bars the chart showed", ld["ok"] and ld["bars"] == shown["bars"] and ld["readOnly"] is True, str(ld.get("reason")))
        check("with the meta and the /ohlcv-shaped envelope", ld["dataset"]["source"] == "fake" and ld["count"] == len(ld["bars"]) and ld["symbol"] == "DS")
        lst = client.get("/dataset/list").json()
        check("it is listed", lst["ok"] and [x["name"] for x in lst["datasets"]] == [sv["name"]])
        again = client.post("/dataset/save", json={"symbol": "DS", "label": "view", "sync": False}).json()
        check("a second save under the same name is refused as a value (HTTP 200)", again["ok"] is False and again["code"] == "exists")
        ov = client.post("/dataset/save", json={"symbol": "DS", "label": "view", "sync": False, "overwrite": True}).json()
        check("overwrite replaces it, now from the disk read (fewer bars: the unsaved ones are gone)", ov["ok"] and ov["overwritten"] is True and ov["bars"] == disk_before, str(ov))
        win = client.post("/dataset/save", json={"symbol": "DS", "label": "win", "fromDate": shown["bars"][2]["date"], "toDate": shown["bars"][6]["date"]}).json()
        check("a dated window saves exactly that window", win["ok"] and win["bars"] == 5 and win["firstBar"] == shown["bars"][2]["date"], str(win))
        for hostile in ("../x", "a b", "DS.NSE.1d.20260101.x'; DROP TABLE datasets;--"):
            h = client.post("/dataset/save", json={"symbol": "DS", "name": hostile}).json()
            check(f"hostile name {hostile!r} is refused as a value", h["ok"] is False and h["code"] == "bad-name", str(h))
        check("a bad label is refused", client.post("/dataset/save", json={"symbol": "DS", "label": "no good"}).json()["code"] == "bad-label")
        check("a missing label is refused", client.post("/dataset/save", json={"symbol": "DS"}).json()["ok"] is False)
        check("a name for another symbol is refused", client.post("/dataset/save", json={"symbol": "DS", "name": "OTHER.NSE.1d.20260101.x"}).json()["code"] == "name-mismatch")
        check("bars are rounded to four places from the stored values, not passed through raw",
              abs(shown["bars"][0]["close"] - round(float(old.iloc[0]["close"]), 4)) < 1e-12 and shown["bars"][0]["volume"] == float(old.iloc[0]["volume"]))
        tiny = client.get("/ohlcv/DS", params={"limit": 3}).json()
        check("the payload ceiling has a floor of 10 bars, as before", tiny["count"] == 10, str(tiny["count"]))
        moved = client.post("/dataset/save", json={"symbol": "DS", "label": "moved", "sync": False, "expectBars": 3}).json()
        check("if the data moved under the chart, the save says so rather than staying quiet", moved["ok"] and "moved on" in moved.get("note", ""), str(moved))
        capd = client.post("/dataset/save", json={"symbol": "DS", "label": "capped", "limit": 10}).json()
        check("the limit is the same ceiling the chart uses (newest N bars)", capd["ok"] and capd["bars"] == 10, str(capd))
        check("a symbol with no bars is refused", client.post("/dataset/save", json={"symbol": "NOBARS", "label": "x"}).json()["code"] == "empty")
        check("loading an unknown name is a refusal, not a 500", client.get("/dataset/DS.NSE.1d.20260101.nothing").json()["ok"] is False)
        check("loading a hostile name is a refusal, not a 500", client.get("/dataset/..%2Fx").json().get("ok") is not True)
        dl = client.post("/dataset/delete", json={"name": sv["name"]}).json()
        check("delete removes it", dl["ok"] is True and [x["name"] for x in client.get("/dataset/list").json()["datasets"]] != [] and sv["name"] not in [x["name"] for x in client.get("/dataset/list").json()["datasets"]])
        check("delete of a hostile name is a refusal", client.post("/dataset/delete", json={"name": "../x"}).json()["ok"] is False)
        check("deleting a dataset never touched the working store", len(store.load("DS", "NSE", "1d")) == disk_before)
finally:
    shutil.rmtree(_TMP, ignore_errors=True)

print(f"\n  {_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
