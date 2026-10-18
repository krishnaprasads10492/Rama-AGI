"""
test_datasets.py - named candle snapshots (spec Section 153)

`datasets.py` keeps a snapshot of exactly the bars master was looking at, under a name that says what is
inside. It is stdlib only (sqlite3, no pandas), so this runs anywhere. What it guards:

    the name convention      one grammar; hostile names are refused before any SQL or path is built
    a snapshot is exact      what comes back is what went in, bit for bit, in the same order
    overwrite is explicit    an existing name is refused unless master says otherwise
    all or nothing           a save that fails midway leaves no half dataset - and an overwrite that
                             fails leaves the OLD dataset intact
    bounded                  empty and absurd payloads are refused
    snapshots are immutable  changing the list you passed afterwards changes nothing stored
    reads write nothing      listing or loading never creates the database

Run:  python -m tests.test_datasets   (from ai_backend/)
"""

from __future__ import annotations

import datetime as _dt
import os
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import threading

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "engine"))
import datasets as D          # noqa: E402

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


def bars(n: int, start: str = "2026-01-01", intraday: bool = False) -> list:
    out = []
    d = _dt.datetime.strptime(start, "%Y-%m-%d")
    for i in range(n):
        ts = (d + (_dt.timedelta(minutes=15 * i) if intraday else _dt.timedelta(days=i)))
        px = 100.0 + i * 0.1234
        out.append({"date": ts.strftime("%Y-%m-%d %H:%M:%S") if intraday else ts.strftime("%Y-%m-%d"),
                    "open": round(px, 4), "high": round(px + 1.5, 4), "low": round(px - 1.5, 4),
                    "close": round(px + 0.25, 4), "volume": float(1000 + i)})
    return out


def table_count(root: str, table: str) -> int:
    conn = sqlite3.connect(D.db_path(root))
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except sqlite3.OperationalError:
        return 0            # a first save that failed rolled back its CREATE TABLEs too: nothing exists at all
    finally:
        conn.close()


def new_root() -> str:
    return tempfile.mkdtemp(prefix="rama-datasets-test-")


def base_args(**kw):
    a = dict(name="NIFTY50.NSE.1d.20261004.pre-budget", symbol="NIFTY50", exchange="NSE", interval="1d",
             bars=bars(30), source="yahoo")
    a.update(kw)
    return a


print("\ndatasets - named, immutable candle snapshots\n")
ROOTS = []
try:
    # ═══ the name convention ══════════════════════════════════════════════════════════════════════
    print("--- the name convention ---")
    n = D.suggest_name("nifty50", "nse", "1D", "pre-budget", _dt.date(2026, 10, 4))
    check("a name is SYMBOL.EXCHANGE.INTERVAL.YYYYMMDD.label", n == "NIFTY50.NSE.1d.20261004.pre-budget", n)
    check("a suggested name passes its own validator", D.validate_name(n)["ok"] is True)
    parts = D.validate_name(n)["parts"]
    check("the validator hands back the parts", parts["symbol"] == "NIFTY50" and parts["interval"] == "1d" and parts["label"] == "pre-budget")
    awk = D.suggest_name("M&M", "NSE", "5m", "my label!", _dt.date(2026, 1, 2))
    check("a symbol with an ampersand is made safe, not carried into the name", awk == "M_M.NSE.5m.20260102.my-label-", awk)
    check("and that name is valid", D.validate_name(awk)["ok"] is True)
    dotted = D.suggest_name("RELIANCE.NS", "NSE", "1d", "x", _dt.date(2026, 1, 2))
    check("a dot in the symbol cannot add a field", dotted.count(".") == 4 and D.validate_name(dotted)["ok"], dotted)
    check("a 40-character label is accepted", D.validate_name("A.NSE.1d.20260101." + "a" * 40)["ok"] is True)
    check("a 41-character label is refused", D.validate_name("A.NSE.1d.20260101." + "a" * 41)["ok"] is False)
    check("an empty label is refused", D.validate_name("A.NSE.1d.20260101.")["ok"] is False)
    check("an unrealistic label is shortened when suggested, not refused", len(D.suggest_name("A", "NSE", "1d", "q" * 90, _dt.date(2026, 1, 1)).split(".")[-1]) == 40)
    hostile = ["../x", "..\\x", "a b", "NIFTY50.NSE.1d.20261004.a/b", "NIFTY50.NSE.1d.20261004.a\\b",
               "NIFTY50.NSE.1d.20261004.a b", "NIFTY50.NSE.1d.20261004.\u00e9t\u00e9",
               "NIFTY50.NSE.1d.20261004.\u0661\u0662", "NIFTY50.NSE.1d.\u0662\u0660\u0662\u0666\u0661\u0660\u0660\u0664.x",
               "NIFTY50.NSE.1d.20261004.x'; DROP TABLE datasets;--", "NIFTY50.NSE.1d.20261004.x\" OR \"1\"=\"1",
               "NIFTY50.NSE.1d.20261004.x\n", "NIFTY50.NSE.1d.20261004.x\x00", "NIFTY50.NSE.1d.20261004.%s%s",
               "NIFTY50.NSE.1d.20261004.x*", "NIFTY50.NSE.1d.20261004.x;", "NIFTY50.NSE.1d.20261304.x",
               "NIFTY50.NSE.1d.20260230.x", "NIFTY50.NSE.1d.2026-10-04.x", "nifty50.NSE.1d.20261004.x",
               "NIFTY50.NSE.1D.20261004.x", "NIFTY50.NSE.1d.20261004", ".NSE.1d.20261004.x", "", " ", None, 5, ["a"],
               "C:\\evil\\x", "/etc/passwd", "CON", "x" * 400]
    bad = [h for h in hostile if D.validate_name(h).get("ok")]
    check("hostile names are all refused: traversal, spaces, unicode digits, quotes, newline, NUL, SQL", not bad, repr(bad))
    root = new_root(); ROOTS.append(root)
    refused = [D.save(root, **base_args(name=h)) for h in hostile]
    check("save refuses every hostile name, as a value, without raising",
          all(r["ok"] is False and r.get("code") == "bad-name" for r in refused), str([r for r in refused if r.get("code") != "bad-name"][:2]))
    check("and a refused name creates nothing on disk", not os.path.exists(os.path.join(root, D.DIR)))
    check("a name for another symbol cannot hold these bars",
          D.save(root, **base_args(name="RELIANCE.NSE.1d.20261004.x"))["code"] == "name-mismatch")
    check("nor can another interval",
          D.save(root, **base_args(name="NIFTY50.NSE.5m.20261004.x"))["code"] == "name-mismatch")
    check("a label alone is validated too", D.validate_label("ok-label_1")["ok"] and not D.validate_label("no good")["ok"] and not D.validate_label("")["ok"])

    # ═══ round trip ═══════════════════════════════════════════════════════════════════════════════
    print("\n--- save, list, load, delete ---")
    root = new_root(); ROOTS.append(root)
    check("listing before anything is saved is empty, and writes nothing",
          D.list_datasets(root) == {"ok": True, "datasets": []} and not os.path.exists(os.path.join(root, D.DIR)))
    check("loading before anything is saved is a refusal, and writes nothing",
          D.load(root, "NIFTY50.NSE.1d.20261004.pre-budget")["ok"] is False and not os.path.exists(os.path.join(root, D.DIR)))
    check("deleting before anything is saved is a refusal, and writes nothing",
          D.delete(root, "NIFTY50.NSE.1d.20261004.pre-budget")["ok"] is False and not os.path.exists(os.path.join(root, D.DIR)))
    src = bars(40)
    r = D.save(root, **base_args(bars=src, note="before the budget", window_from="2026-01-01", window_to="2026-02-09"))
    check("a save reports ok, the count and the span", r["ok"] and r["bars"] == 40 and r["firstBar"] == "2026-01-01" and r["lastBar"] == "2026-02-09", str(r))
    check("it was not an overwrite", r["overwritten"] is False)
    check("the database sits at <root>/_datasets/datasets.db", os.path.exists(os.path.join(root, "_datasets", "datasets.db")))
    ls = D.list_datasets(root)
    check("it is listed with its provenance",
          ls["ok"] and len(ls["datasets"]) == 1 and ls["datasets"][0]["name"] == "NIFTY50.NSE.1d.20261004.pre-budget"
          and ls["datasets"][0]["bars"] == 40 and ls["datasets"][0]["source"] == "yahoo"
          and ls["datasets"][0]["symbol"] == "NIFTY50" and ls["datasets"][0]["interval"] == "1d"
          and ls["datasets"][0]["note"] == "before the budget" and ls["datasets"][0]["windowFrom"] == "2026-01-01"
          and ls["datasets"][0]["savedAt"].endswith("Z"), str(ls))
    ld = D.load(root, "NIFTY50.NSE.1d.20261004.pre-budget")
    check("it loads", ld["ok"] and ld["meta"]["bars"] == 40)
    check("the bars are IDENTICAL after the round trip, in order", ld["bars"] == src)
    check("each bar has exactly the /ohlcv keys", all(set(b) == {"date", "open", "high", "low", "close", "volume"} for b in ld["bars"]))
    intra = bars(60, intraday=True)
    D.save(root, **base_args(name="NIFTY50.NSE.5m.20261004.intra", interval="5m", bars=intra))
    check("an intraday snapshot keeps its time component", D.load(root, "NIFTY50.NSE.5m.20261004.intra")["bars"] == intra)
    check("both datasets are listed", len(D.list_datasets(root)["datasets"]) == 2)
    check("delete removes it", D.delete(root, "NIFTY50.NSE.1d.20261004.pre-budget") == {"ok": True, "name": "NIFTY50.NSE.1d.20261004.pre-budget"})
    check("it is gone from the list and from load", [d["name"] for d in D.list_datasets(root)["datasets"]] == ["NIFTY50.NSE.5m.20261004.intra"]
          and D.load(root, "NIFTY50.NSE.1d.20261004.pre-budget")["ok"] is False)
    check("its bars went with it (the cascade), the other's did not", table_count(root, "dataset_bars") == 60, str(table_count(root, "dataset_bars")))
    check("deleting twice is a refusal, not an error", D.delete(root, "NIFTY50.NSE.1d.20261004.pre-budget")["code"] == "missing")

    # ═══ overwrite ════════════════════════════════════════════════════════════════════════════════
    print("\n--- a name that exists is refused unless master says overwrite ---")
    root = new_root(); ROOTS.append(root)
    D.save(root, **base_args(bars=bars(10)))
    again = D.save(root, **base_args(bars=bars(25)))
    check("a second save under the same name is refused", again["ok"] is False and again["code"] == "exists", str(again))
    check("the original is untouched", D.load(root, base_args()["name"])["meta"]["bars"] == 10)
    case = D.save(root, **base_args(name="NIFTY50.NSE.1d.20261004.PRE-BUDGET", bars=bars(25)))
    check("a name differing only in case is the same name (Windows folds case)", case["ok"] is False and case["code"] == "exists", str(case))
    over = D.save(root, **base_args(bars=bars(25), overwrite=True))
    check("overwrite=True replaces it", over["ok"] and over["overwritten"] is True)
    check("with the new bars, and no leftovers of the old", D.load(root, base_args()["name"])["meta"]["bars"] == 25 and table_count(root, "dataset_bars") == 25)
    check("overwrite=True on a NEW name is just a save", D.save(root, **base_args(name="NIFTY50.NSE.1d.20261004.other", overwrite=True))["overwritten"] is False)
    check("only the boolean True overwrites", D.save(root, **base_args(bars=bars(7), overwrite=None))["ok"] is False)

    # ═══ all or nothing ═══════════════════════════════════════════════════════════════════════════
    print("\n--- a failed save leaves nothing ---")
    root = new_root(); ROOTS.append(root)
    real_insert = D._insert_bars

    def half_then_die(conn, name, rows):
        real_insert(conn, name, rows[: len(rows) // 2])
        raise RuntimeError("disk went away")

    D._insert_bars = half_then_die
    try:
        failed = D.save(root, **base_args(bars=bars(100)))
    finally:
        D._insert_bars = real_insert
    check("a failure mid-insert is reported as a value", failed["ok"] is False and failed["code"] == "io" and "disk went away" in failed["reason"], str(failed))
    check("no dataset row was left", table_count(root, "datasets") == 0)
    check("and no half of its bars", table_count(root, "dataset_bars") == 0, str(table_count(root, "dataset_bars")))
    check("the name is free to use afterwards", D.save(root, **base_args(bars=bars(100)))["ok"] is True)
    D._insert_bars = half_then_die
    try:
        failed2 = D.save(root, **base_args(bars=bars(60), overwrite=True))
    finally:
        D._insert_bars = real_insert
    check("a failed OVERWRITE is reported", failed2["ok"] is False)
    kept = D.load(root, base_args()["name"])
    check("and the OLD dataset is still whole", kept["ok"] and kept["meta"]["bars"] == 100 and kept["bars"] == bars(100), str(kept.get("meta")))
    check("with no stray rows", table_count(root, "dataset_bars") == 100)

    # ═══ bounded ══════════════════════════════════════════════════════════════════════════════════
    print("\n--- empty and absurd payloads ---")
    root = new_root(); ROOTS.append(root)
    check("no bars is refused", D.save(root, **base_args(bars=[]))["code"] == "empty")
    check("None is refused", D.save(root, **base_args(bars=None))["code"] == "empty")
    check("a string is refused", D.save(root, **base_args(bars="abc"))["code"] == "empty")
    big = D.save(root, **base_args(bars=bars(D.MAX_BARS + 1)))
    check("more than 50,000 bars is refused, naming the limit", big["code"] == "too-many" and "50000" in big["reason"], str(big)[:120])
    check("exactly 50,000 is allowed", D.save(root, **base_args(bars=bars(D.MAX_BARS)))["ok"] is True)
    root = new_root(); ROOTS.append(root)
    mal = [("a bar that is not a dict", [1]), ("no date", [{"open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}]),
           ("a bad date", [dict(bars(1)[0], date="yesterday")]),
           ("a date with a trailing newline", [dict(bars(1)[0], date="2026-01-01\n")]),
           ("a missing close", [{k: v for k, v in bars(1)[0].items() if k != "close"}]),
           ("a NaN", [dict(bars(1)[0], close=float("nan"))]), ("an infinity", [dict(bars(1)[0], high=float("inf"))]),
           ("a string price", [dict(bars(1)[0], open="100")]), ("a boolean price", [dict(bars(1)[0], open=True)]),
           ("out of order", [bars(2)[1], bars(2)[0]]), ("a repeated stamp", [bars(1)[0], bars(1)[0]])]
    for label, payload in mal:
        res = D.save(root, **base_args(bars=payload))
        check(f"{label} is refused as bad-bars", res["ok"] is False and res["code"] == "bad-bars", str(res))
    check("none of those left a database behind", not os.path.exists(D.db_path(root)) or table_count(root, "datasets") == 0)

    # ═══ immutability and coexistence ═════════════════════════════════════════════════════════════
    print("\n--- a snapshot is immutable; datasets coexist ---")
    root = new_root(); ROOTS.append(root)
    payload = bars(20)
    frozen = [dict(b) for b in payload]
    D.save(root, **base_args(bars=payload))
    payload[0]["close"] = 99999.0
    payload.append(dict(payload[-1], date="2027-01-01"))
    check("changing the list afterwards changes nothing stored", D.load(root, base_args()["name"])["bars"] == frozen)
    first = D.load(root, base_args()["name"])
    first["bars"][0]["close"] = -1.0
    check("nor does changing what was loaded", D.load(root, base_args()["name"])["bars"] == frozen)
    jan = bars(15, "2026-01-01")
    jun = bars(25, "2026-06-01")
    check("two datasets for the same symbol and interval on different dates coexist",
          D.save(root, **base_args(name="NIFTY50.NSE.1d.20260201.jan", bars=jan))["ok"]
          and D.save(root, **base_args(name="NIFTY50.NSE.1d.20260701.jun", bars=jun))["ok"])
    check("each loads its own bars", D.load(root, "NIFTY50.NSE.1d.20260201.jan")["bars"] == jan
          and D.load(root, "NIFTY50.NSE.1d.20260701.jun")["bars"] == jun)
    check("and all three are listed", len(D.list_datasets(root)["datasets"]) == 3)
    D.delete(root, "NIFTY50.NSE.1d.20260201.jan")
    check("deleting one leaves the others whole", D.load(root, "NIFTY50.NSE.1d.20260701.jun")["bars"] == jun and D.load(root, base_args()["name"])["bars"] == frozen)
    long_meta = (D.save(root, **base_args(name="NIFTY50.NSE.1d.20260801.long", note="n" * 5000, source="s" * 500))["ok"]
                 and D.load(root, "NIFTY50.NSE.1d.20260801.long")["meta"])
    check("the free-text fields are bounded (note 300, source 60)",
          bool(long_meta) and len(long_meta["note"]) == D.MAX_NOTE and len(long_meta["source"]) == D.MAX_SOURCE, str(long_meta))
    check("SQL metacharacters in the free text are data, not statements",
          D.save(root, **base_args(name="NIFTY50.NSE.1d.20260802.sql", note="x'); DROP TABLE datasets;--"))["ok"]
          and D.load(root, "NIFTY50.NSE.1d.20260802.sql")["meta"]["note"] == "x'); DROP TABLE datasets;--"
          and table_count(root, "datasets") >= 4)
    conn = sqlite3.connect(D.db_path(root))
    fk = conn.execute("PRAGMA foreign_key_list(dataset_bars)").fetchall()
    idx = [r[1] for r in conn.execute("PRAGMA index_list(dataset_bars)").fetchall()]
    conn.close()
    check("the bars table references the dataset with ON DELETE CASCADE", fk and fk[0][2] == "datasets" and fk[0][6] == "CASCADE", str(fk))
    check("and is indexed by name and time", len(idx) >= 1)

    # ═══ concurrency ══════════════════════════════════════════════════════════════════════════════
    print("\n--- concurrent saves ---")
    root = new_root(); ROOTS.append(root)
    results, errors = {}, []

    def saver(i: int):
        try:
            results[i] = D.save(root, **base_args(name=f"NIFTY50.NSE.1d.20261004.t{i}", bars=bars(200 + i)))
        except Exception as exc:                    # a save must never raise
            errors.append(exc)

    ts = [threading.Thread(target=saver, args=(i,)) for i in range(12)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    check("no save raised", not errors, str(errors))
    check("twelve concurrent saves under twelve names all succeeded", all(r["ok"] for r in results.values()) and len(results) == 12, str([r for r in results.values() if not r["ok"]][:2]))
    check("every dataset holds exactly its own bars", all(D.load(root, f"NIFTY50.NSE.1d.20261004.t{i}")["bars"] == bars(200 + i) for i in range(12)))
    check("no bars were lost or duplicated", table_count(root, "dataset_bars") == sum(200 + i for i in range(12)))
    root = new_root(); ROOTS.append(root)
    results.clear()

    def racer(i: int):
        results[i] = D.save(root, **base_args(bars=bars(10 + i)))

    ts = [threading.Thread(target=racer, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    wins = [i for i, r in results.items() if r["ok"]]
    check("eight threads racing for ONE name: exactly one wins", len(wins) == 1, str(wins))
    check("the others are told the name exists", all(r["code"] == "exists" for i, r in results.items() if i not in wins))
    check("and what was stored is the winner's bars, whole", D.load(root, base_args()["name"])["bars"] == bars(10 + wins[0]))

    # ═══ reads write nothing ══════════════════════════════════════════════════════════════════════
    print("\n--- reading never writes ---")
    root = new_root(); ROOTS.append(root)
    D.list_datasets(root); D.load(root, base_args()["name"]); D.delete(root, base_args()["name"])
    check("list, load and delete on an empty root create no directory", os.listdir(root) == [])
    D.save(root, **base_args())
    before = os.path.getmtime(D.db_path(root))
    D.list_datasets(root); D.load(root, base_args()["name"])
    check("list and load leave the file unmodified", os.path.getmtime(D.db_path(root)) == before)
    code = "\n".join(l for l in open(D.__file__, encoding="utf-8").read().splitlines() if l.lstrip().startswith(("import ", "from ")))
    check("the module imports no pandas or numpy (stdlib only)", "pandas" not in code and "numpy" not in code, code)
    check("only the boolean True overwrites; the string 'yes' does not",
          D.save(root, **base_args(bars=bars(3), overwrite="yes"))["code"] == "exists")
finally:
    for r in ROOTS:
        shutil.rmtree(r, ignore_errors=True)

print(f"\n  {_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
