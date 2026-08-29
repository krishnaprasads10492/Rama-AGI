"""
test_derivatives.py — NSE derivatives: parsing, derivation, and the store generalisation.

Structure mirrors test_store.py: deterministic assertions on constructed inputs first,
then live calls against the exchange. The constructed half must hold with no network; the
live half proves the endpoints in spec Section 67 are still real, because NSE moved its
archive host and changed its bhavcopy format once already and will do it again.
"""

import datetime as _dt
import os
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}" + (f" - {detail}" if detail else ""))


# Point the store at a throwaway directory BEFORE importing, so nothing here can touch
# real stored history.
_TMP = tempfile.mkdtemp(prefix="rama-deriv-test-")
os.environ["STOCKMIND_DATA_DIR"] = _TMP

from engine import derivatives as dv      # noqa: E402
from engine import store                  # noqa: E402


# ── Synthetic bhavcopy frames ─────────────────────────────────────────────────

def udiff_frame(trade="2026-08-28", expiry="2026-09-01", spot=24000.0):
    """A UDiFF-layout F&O bhavcopy: NIFTY options + futures, plus a stock contract."""
    rows = []
    for strike in range(23000, 25001, 500):
        # CE OI falls as strike rises, PE OI rises — a normal chain.
        ce_oi = max(0.0, (25000 - strike) / 100.0) * 1000 + 1000
        pe_oi = max(0.0, (strike - 23000) / 100.0) * 1000 + 1000
        for ot, oi, px in (("CE", ce_oi, max(1.0, spot - strike + 200)),
                           ("PE", pe_oi, max(1.0, strike - spot + 200))):
            rows.append({
                "TradDt": trade, "FinInstrmTp": "IDO", "TckrSymb": "NIFTY",
                "XpryDt": expiry, "StrkPric": float(strike), "OptnTp": ot,
                "OpnPric": px, "HghPric": px * 1.1, "LwPric": px * 0.9,
                "ClsPric": px, "SttlmPric": px,
                "TtlTradgVol": oi / 2, "TtlTrfVal": oi * px,
                "OpnIntrst": oi, "ChngInOpnIntrst": oi * 0.1,
                "UndrlygPric": spot,
            })
    for i, (exp, oi) in enumerate((("2026-09-29", 1_000_000.0),
                                   ("2026-10-27", 250_000.0),
                                   ("2026-11-23", 50_000.0))):
        rows.append({
            "TradDt": trade, "FinInstrmTp": "IDF", "TckrSymb": "NIFTY",
            "XpryDt": exp, "StrkPric": 0.0, "OptnTp": None,
            "OpnPric": spot, "HghPric": spot, "LwPric": spot,
            "ClsPric": spot * (1.004 + i * 0.004), "SttlmPric": spot,
            "TtlTradgVol": 10000.0, "TtlTrfVal": 1e9,
            "OpnIntrst": oi, "ChngInOpnIntrst": 5000.0, "UndrlygPric": spot,
        })
    rows.append({
        "TradDt": trade, "FinInstrmTp": "STO", "TckrSymb": "RELIANCE",
        "XpryDt": expiry, "StrkPric": 1400.0, "OptnTp": "CE",
        "OpnPric": 10.0, "HghPric": 12.0, "LwPric": 9.0, "ClsPric": 11.0,
        "SttlmPric": 11.0, "TtlTradgVol": 500.0, "TtlTrfVal": 5500.0,
        "OpnIntrst": 20000.0, "ChngInOpnIntrst": 100.0, "UndrlygPric": 1395.0,
    })
    return pd.DataFrame(rows)


def legacy_frame(trade="10-JUN-2020", expiry="11-Jun-2020", spot=10000.0):
    """
    The legacy layout, with its two traps: `OPTION_TYP` is the literal `XX` on futures
    rows, and there is no underlying-price column at all.
    """
    rows = []
    for strike in range(9500, 10501, 250):
        ce_oi = max(0.0, (10500 - strike) / 50.0) * 500 + 500
        pe_oi = max(0.0, (strike - 9500) / 50.0) * 500 + 500
        for ot, oi, px in (("CE", ce_oi, max(1.0, spot - strike + 150)),
                           ("PE", pe_oi, max(1.0, strike - spot + 150))):
            rows.append({
                "INSTRUMENT": "OPTIDX", "SYMBOL": "NIFTY", "EXPIRY_DT": expiry,
                "STRIKE_PR": float(strike), "OPTION_TYP": ot,
                "OPEN": px, "HIGH": px, "LOW": px, "CLOSE": px, "SETTLE_PR": px,
                "CONTRACTS": oi / 2, "VAL_INLAKH": oi * px / 1e5,
                "OPEN_INT": oi, "CHG_IN_OI": oi * 0.05, "TIMESTAMP": trade,
            })
    rows.append({
        "INSTRUMENT": "FUTIDX", "SYMBOL": "NIFTY", "EXPIRY_DT": "25-Jun-2020",
        "STRIKE_PR": 0.0, "OPTION_TYP": "XX",
        "OPEN": spot, "HIGH": spot, "LOW": spot, "CLOSE": spot * 1.006,
        "SETTLE_PR": spot, "CONTRACTS": 5000.0, "VAL_INLAKH": 1e5,
        "OPEN_INT": 800_000.0, "CHG_IN_OI": -1000.0, "TIMESTAMP": trade,
    })
    return pd.DataFrame(rows)


# ── Canonical parsing ─────────────────────────────────────────────────────────
print("\n--- both bhavcopy layouts normalise to one frame ---")

cu = dv.to_canonical(udiff_frame(), "udiff")
cl = dv.to_canonical(legacy_frame(), "legacy")

check("UDiFF parses", cu is not None and len(cu) > 0)
check("legacy parses", cl is not None and len(cl) > 0)
check("both produce identical columns", list(cu.columns) == list(cl.columns))
check("columns are the declared canonical set", list(cu.columns) == dv.CANONICAL)
check("index options classified", set(cu[cu["symbol"] == "NIFTY"]["kind"]) == {"option", "future"})
check("stock option kept and marked as a stock underlying",
      (cu[cu["symbol"] == "RELIANCE"]["underlying_kind"] == "stock").all())
check("expiry is datetime, not text", pd.api.types.is_datetime64_any_dtype(cu["expiry"]))
check("legacy expiry parsed with its DD-Mon-YYYY format",
      str(pd.Timestamp(cl["expiry"].iloc[0]).date()) == "2020-06-11",
      str(cl["expiry"].iloc[0]))

# The trap. `XX` must never survive as an option type.
fut_l = cl[cl["kind"] == "future"]
check("legacy futures row is present", len(fut_l) == 1, str(len(fut_l)))
check("legacy 'XX' option_type became null, not a third option type",
      fut_l["option_type"].isna().all(), str(fut_l["option_type"].tolist()))
check("no 'XX' anywhere in option_type", "XX" not in set(cl["option_type"].dropna()))
check("only CE and PE survive as option types",
      set(cl["option_type"].dropna()) <= {"CE", "PE"})
check("legacy carries no underlying price", cl["underlying_price"].isna().all())
check("UDiFF does carry an underlying price", cu["underlying_price"].notna().any())

check("unrecognised instrument codes are dropped, not guessed",
      dv.to_canonical(pd.DataFrame([{"INSTRUMENT": "WOMBAT", "SYMBOL": "X",
                                     "EXPIRY_DT": "11-Jun-2020", "STRIKE_PR": 1,
                                     "OPTION_TYP": "CE", "OPEN": 1, "HIGH": 1, "LOW": 1,
                                     "CLOSE": 1, "SETTLE_PR": 1, "CONTRACTS": 1,
                                     "VAL_INLAKH": 1, "OPEN_INT": 1, "CHG_IN_OI": 0,
                                     "TIMESTAMP": "10-JUN-2020"}]), "legacy") is None)
check("an empty frame returns None rather than raising",
      dv.to_canonical(pd.DataFrame(), "udiff") is None)


# ── Max pain ──────────────────────────────────────────────────────────────────
print("\n--- max pain ---")

# All OI at one strike: writers lose least exactly there.
mp, pay = dv.max_pain([100, 110, 120], [0, 1000, 0], [0, 1000, 0])
check("single concentrated strike is the max pain", mp == 110, str(mp))
check("payout at that strike is zero", pay == 0, str(pay))

# Calls only: writers pay nothing at or below the lowest strike.
mp2, _ = dv.max_pain([100, 110, 120], [500, 500, 500], [0, 0, 0])
check("calls only -> lowest strike", mp2 == 100, str(mp2))
mp3, _ = dv.max_pain([100, 110, 120], [0, 0, 0], [500, 500, 500])
check("puts only -> highest strike", mp3 == 120, str(mp3))

# Symmetric chain: the middle.
mp4, _ = dv.max_pain([100, 110, 120], [300, 200, 100], [100, 200, 300])
check("symmetric chain -> centre strike", mp4 == 110, str(mp4))

check("no open interest gives no answer rather than a fake one",
      dv.max_pain([100, 110], [0, 0], [0, 0]) == (None, None))
check("no strikes gives no answer", dv.max_pain([], [], []) == (None, None))

# Brute force, to prove the vectorised form computes the definition.
def brute(strikes, c, p):
    best, bs = None, None
    for s in strikes:
        tot = sum(c[i] * max(0.0, s - k) for i, k in enumerate(strikes)) + \
              sum(p[i] * max(0.0, k - s) for i, k in enumerate(strikes))
        if best is None or tot < best:
            best, bs = tot, s
    return bs

rng = np.random.default_rng(7)
agree = 0
for _ in range(60):
    ks = sorted(rng.choice(np.arange(20000, 26000, 50), size=25, replace=False).tolist())
    c  = rng.integers(0, 500000, 25).astype(float).tolist()
    p  = rng.integers(0, 500000, 25).astype(float).tolist()
    if dv.max_pain(ks, c, p)[0] == brute(ks, c, p):
        agree += 1
check("vectorised max pain matches the brute-force definition on 60 random chains",
      agree == 60, f"{agree}/60")


# ── Concentration ─────────────────────────────────────────────────────────────
print("\n--- OI concentration ---")
check("all OI at one strike -> 1.0", dv._herfindahl([100, 0, 0, 0]) == 1.0)
check("evenly spread over 4 -> 0.25", abs(dv._herfindahl([25, 25, 25, 25]) - 0.25) < 1e-9)
check("concentrated reads higher than spread",
      dv._herfindahl([90, 5, 5]) > dv._herfindahl([34, 33, 33]))
check("no OI gives None, not 0", dv._herfindahl([0, 0, 0]) is None)


# ── Derived metrics ───────────────────────────────────────────────────────────
print("\n--- derived daily metrics ---")

m = dv.derive_metrics(cu, "NIFTY", "2026-08-28", spot=24000.0, source="udiff")
check("a row is produced", m is not None)
check("every declared column is present", set(m.keys()) == set(dv.DERIV_COLUMNS),
      str(set(dv.DERIV_COLUMNS) ^ set(m.keys())))
check("spot is the value passed in, not the file's", m["spot"] == 24000.0, str(m["spot"]))
check("nearest expiry chosen", m["expiry"] == "2026-09-01", str(m["expiry"]))
check("days to expiry is positive", m["days_to_expiry"] == 4, str(m["days_to_expiry"]))
check("PCR is a ratio of the two OI totals",
      abs(m["pcr_oi"] - m["pe_oi"] / m["ce_oi"]) < 1e-6)
check("max pain is one of the listed strikes", m["max_pain"] in [float(s) for s in range(23000, 25001, 500)],
      str(m["max_pain"]))
check("max pain distance is signed and normalised",
      abs(m["max_pain_dist"] - (24000.0 - m["max_pain"]) / 24000.0) < 1e-9)
check("resistance is the max CE OI strike", m["max_ce_oi_strike"] == 23000.0, str(m["max_ce_oi_strike"]))
check("support is the max PE OI strike", m["max_pe_oi_strike"] == 25000.0, str(m["max_pe_oi_strike"]))
check("straddle is a small positive fraction of spot",
      m["straddle_pct"] is not None and 0 < m["straddle_pct"] < 0.5, str(m["straddle_pct"]))
check("futures basis computed against spot",
      m["fut_basis_pct"] is not None and m["fut_basis_pct"] > 0, str(m["fut_basis_pct"]))
check("near futures OI taken, not the sum of all expiries",
      m["fut_oi"] == 1_000_000.0, str(m["fut_oi"]))
check("rollover is the later-expiry share of futures OI",
      abs(m["rollover_pct"] - 300_000.0 / 1_300_000.0) < 1e-6, str(m["rollover_pct"]))
check("all-expiry OI is at least the nearest-expiry OI", m["ce_oi_all"] >= m["ce_oi"])
check("RELIANCE contracts did not leak into NIFTY metrics",
      m["ce_oi"] == cu[(cu["symbol"] == "NIFTY") & (cu["option_type"] == "CE") &
                       (cu["expiry"] == pd.Timestamp("2026-09-01"))]["oi"].sum())

mr = dv.derive_metrics(cu, "RELIANCE", "2026-08-28", spot=1395.0, source="udiff")
check("a stock symbol derives its own row", mr is not None and mr["ce_oi"] == 20000.0)
check("a symbol with no contracts returns None, not an empty row",
      dv.derive_metrics(cu, "NOTLISTED", "2026-08-28", spot=1.0) is None)

# The spot-provenance decision.
print("\n--- spot provenance (Section 67 decision 3) ---")
ml = dv.derive_metrics(cl, "NIFTY", "2020-06-10", spot=10000.0, source="legacy")
check("legacy derives a full row despite having no underlying column", ml is not None)
check("legacy spot came from the caller", ml["spot"] == 10000.0, str(ml["spot"]))
check("legacy source recorded plainly", ml["source"] == "legacy", ml["source"])
check("legacy basis computed", ml["fut_basis_pct"] is not None)

m_nospot = dv.derive_metrics(cu, "NIFTY", "2026-08-28", spot=None, source="udiff")
check("with no spot supplied, UDiFF's own price is the last resort",
      m_nospot["spot"] == 24000.0, str(m_nospot["spot"]))
check("that fallback is recorded in the source, not hidden",
      m_nospot["source"] == "udiff+file-spot", m_nospot["source"])
ml_nospot = dv.derive_metrics(cl, "NIFTY", "2020-06-10", spot=None, source="legacy")
check("legacy with no spot yields no spot rather than inventing one",
      ml_nospot["spot"] is None, str(ml_nospot["spot"]))
check("ratios against spot are null when spot is unknown, not zero",
      ml_nospot["max_pain_dist"] is None and ml_nospot["fut_basis_pct"] is None)
check("absolute OI values still computed without spot", ml_nospot["ce_oi"] > 0)


# ── Store generalisation ──────────────────────────────────────────────────────
print("\n--- the store handles a non-OHLCV series (Section 67 decision 6) ---")

rows = [dv.derive_metrics(cu, "NIFTY", f"2026-08-{d:02d}", spot=24000.0 + d, source="udiff")
        for d in (24, 25, 26, 27, 28)]
saved = store.merge("TESTIDX", pd.DataFrame(rows), "NSE", dv.DERIV_INTERVAL,
                    source="test", columns=dv.DERIV_COLUMNS)
check("a derivative series persists", saved is not None and len(saved) == 5, str(len(saved) if saved is not None else None))
back = store.load("TESTIDX", "NSE", dv.DERIV_INTERVAL, dv.DERIV_COLUMNS)
check("it reads back with the same row count", back is not None and len(back) == 5)
check("it reads back with the declared columns", list(back.columns) == dv.DERIV_COLUMNS)
check("values survive the round trip", abs(float(back["spot"].iloc[-1]) - 24028.0) < 1e-6,
      str(back["spot"].iloc[-1]))
check("string columns survive the round trip", str(back["source"].iloc[0]) == "udiff")

# The properties inherited from store.py must still hold for the new column set.
again = store.merge("TESTIDX", pd.DataFrame(rows[:2]), "NSE", dv.DERIV_INTERVAL,
                    source="test", columns=dv.DERIV_COLUMNS)
check("re-merging a shorter window does not shrink the series", len(again) == 5, str(len(again)))
dup = store.merge("TESTIDX", pd.DataFrame([rows[-1]]), "NSE", dv.DERIV_INTERVAL,
                  source="test", columns=dv.DERIV_COLUMNS)
check("re-merging an existing date de-duplicates rather than appending",
      len(dup) == 5, str(len(dup)))

# A row where every metric is null must still store — that is a real market day with no
# open interest, and `required` is date-only for a derived series.
null_row = {c: None for c in dv.DERIV_COLUMNS}
null_row["date"] = "2026-08-31"
withnull = store.merge("TESTIDX", pd.DataFrame([null_row]), "NSE", dv.DERIV_INTERVAL,
                       source="test", columns=dv.DERIV_COLUMNS)
check("a row with no metrics still stores (required is date-only for derived series)",
      len(withnull) == 6, str(len(withnull)))

# And the OHLCV default must be completely unchanged.
bars = pd.DataFrame({
    "date": pd.date_range("2024-01-01", periods=10, freq="B"),
    "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "volume": 1000.0,
})
ob = store.merge("TESTBARS", bars, "NSE", "1d", source="test")
check("OHLCV callers are untouched by the generalisation", ob is not None and len(ob) == 10)
check("OHLCV still projects to the classic six columns", list(ob.columns) == store.COLUMNS)
half = bars.copy()
half["close"] = np.nan
kept = store.merge("TESTBARS", half, "NSE", "1d", source="test")
check("a bar with no close is still rejected for OHLCV", len(kept) == 10, str(len(kept)))


# ── Registry ──────────────────────────────────────────────────────────────────
print("\n--- registry declares what is backtestable ---")
reg = dv.registry()
check("every source is described", len(reg) == 6, str(len(reg)))
check("archive sources are marked backtestable",
      all(s["backtestable"] for s in reg if "bhavcopy" in s["name"]))
check("the live chain is marked NOT backtestable",
      not [s for s in reg if s["name"] == "nse_option_chain_v3"][0]["backtestable"])
check("FII/DII latest is marked NOT backtestable",
      not [s for s in reg if s["name"] == "nse_fii_dii"][0]["backtestable"])
check("participant OI is marked backtestable",
      [s for s in reg if s["name"] == "nse_participant_oi"][0]["backtestable"])
check("every source is free", all(s["tier"] == "free" for s in reg))

os.environ["STOCKMIND_DISABLE_PROVIDERS"] = "nse_delivery"
check("a source can be disabled by environment",
      [s for s in dv.registry() if s["name"] == "nse_delivery"][0]["disabled"])
check("disabling one leaves the others available",
      [s for s in dv.registry() if s["name"] == "nse_participant_oi"][0]["available"])
os.environ.pop("STOCKMIND_DISABLE_PROVIDERS", None)


# ── Non-publication memo ──────────────────────────────────────────────────────
print("\n--- holidays are 'not published', not failures ---")
dv._save_memo({"2026-01-15", "2026-08-30"})
memo = dv._load_memo()
check("the memo persists", memo == {"2026-01-15", "2026-08-30"}, str(memo))
import json as _json                                     # noqa: E402
with open(dv._memo_path(), "r", encoding="utf-8") as _fh:
    _memo_doc = _json.load(_fh)
check("the memo records why those dates are absent, not just that they are",
      "note" in _memo_doc and "holiday" in _memo_doc["note"].lower(), str(_memo_doc.keys()))
check("the memo is timestamped", "updatedAt" in _memo_doc)
check("a corrupt memo file degrades to empty rather than raising",
      (open(dv._memo_path(), "w", encoding="utf-8").write("{not json"),
       dv._load_memo() == set())[1])
dv._save_memo(set())


# ── LIVE ──────────────────────────────────────────────────────────────────────
print("\n--- LIVE: the exchange endpoints in Section 67 ---")
if os.environ.get("STOCKMIND_SKIP_LIVE"):
    print("  SKIPPED (STOCKMIND_SKIP_LIVE set)")
else:
    def recent_weekday(back=1):
        d = _dt.date.today() - _dt.timedelta(days=back)
        while d.weekday() >= 5:
            d -= _dt.timedelta(days=1)
        return d

    got, used_date, layout = None, None, None
    for b in range(0, 8):
        d = recent_weekday(b)
        c, status = dv.fetch_bhavcopy(d)
        if c is not None:
            got, used_date, layout = c, d, status
            break
    check("a recent F&O bhavcopy downloads and parses", got is not None,
          "no trading day in the last 8 answered")

    if got is not None:
        print(f"  ({used_date} via {layout}, {len(got)} contracts)")
        check("it contains thousands of contracts", len(got) > 5000, str(len(got)))
        check("NIFTY is present", (got["symbol"] == "NIFTY").any())
        check("both options and futures are present",
              {"option", "future"} <= set(got["kind"]))
        check("both CE and PE are present", {"CE", "PE"} <= set(got["option_type"].dropna()))
        check("open interest is populated", got["oi"].notna().sum() > 1000)
        check("no futures row is labelled CE or PE",
              got[got["kind"] == "future"]["option_type"].isna().all())

        spot = None
        up = got[got["symbol"] == "NIFTY"]["underlying_price"].dropna()
        if len(up):
            spot = float(up.median())
        live_m = dv.derive_metrics(got, "NIFTY", used_date, spot=spot, source=layout)
        check("metrics derive from real exchange data", live_m is not None)
        if live_m:
            print(f"  (spot={live_m['spot']} expiry={live_m['expiry']} "
                  f"pcr={live_m['pcr_oi']} maxPain={live_m['max_pain']})")
            check("PCR is in a plausible range", live_m["pcr_oi"] and 0.1 < live_m["pcr_oi"] < 10,
                  str(live_m["pcr_oi"]))
            check("real chains have many strikes", live_m["strikes_count"] > 20,
                  str(live_m["strikes_count"]))
            check("max pain lands within 20% of spot",
                  live_m["max_pain"] and abs(live_m["max_pain_dist"]) < 0.20,
                  str(live_m["max_pain_dist"]))
            check("support sits below resistance",
                  live_m["max_pe_oi_strike"] <= live_m["max_ce_oi_strike"],
                  f"{live_m['max_pe_oi_strike']} vs {live_m['max_ce_oi_strike']}")
            check("futures OI is populated", live_m["fut_oi"] and live_m["fut_oi"] > 0)
            check("futures basis is small — it is a near-month index future",
                  live_m["fut_basis_pct"] is not None and abs(live_m["fut_basis_pct"]) < 0.05,
                  str(live_m["fut_basis_pct"]))
            check("days to expiry is not negative", live_m["days_to_expiry"] >= 0,
                  str(live_m["days_to_expiry"]))

    # A weekend must report not-published rather than failing.
    sat = _dt.date.today()
    while sat.weekday() != 5:
        sat -= _dt.timedelta(days=1)
    _, wknd = dv.fetch_bhavcopy(sat)
    check("a Saturday reports 'not-published', not 'failed'", wknd == "not-published", wknd)

    # Both formats, proving the 2024 boundary is really spanned.
    old, old_status = dv.fetch_bhavcopy(_dt.date(2020, 6, 10))
    check("a 2020 date resolves through the legacy archive", old_status == "legacy", old_status)
    if old is not None:
        check("the 2020 file parses to the same canonical columns",
              list(old.columns) == dv.CANONICAL)
        om = dv.derive_metrics(old, "NIFTY", _dt.date(2020, 6, 10), spot=9955.0, source="legacy")
        check("2020 metrics derive", om is not None and om["pcr_oi"] is not None,
              str(om.get("pcr_oi") if om else None))
        if om:
            print(f"  (2020-06-10 pcr={om['pcr_oi']} maxPain={om['max_pain']})")

    print("\n--- LIVE: option chain, flows, delivery ---")
    oc = dv.option_chain("NIFTY")
    check("the live option chain answers", oc.get("error") is None, str(oc.get("error")))
    if oc.get("error") is None:
        print(f"  (spot={oc.get('spot')} pcr={oc.get('pcrOi')} maxPain={oc.get('maxPain')})")
        check("it lists expiries", len(oc.get("expiries") or []) > 0)
        check("it is labelled NOT backtestable", oc["backtestable"] is False)
        check("it reports a spot", oc.get("spot"))
        check("it reports PCR", oc.get("pcrOi"))
        check("it computes max pain from the live chain", oc.get("maxPain"))

    po = dv.participant_oi(used_date or recent_weekday(1))
    check("participant-wise OI answers", po.get("error") is None, str(po.get("error")))
    if po.get("error") is None:
        print(f"  (FII index fut L/S ratio={po.get('fiiLongShortRatio')})")
        check("it is labelled backtestable", po["backtestable"] is True)
        check("all four participant classes plus TOTAL are parsed",
              {"Client", "DII", "FII", "Pro", "TOTAL"} <= set(po["participants"].keys()),
              str(list(po["participants"].keys())))
        check("FII index futures long and short are numbers",
              isinstance(po.get("fiiIndexFutLong"), float) and
              isinstance(po.get("fiiIndexFutShort"), float))
        check("the long/short ratio is positive", po.get("fiiLongShortRatio", 0) > 0)
        tot = po["participants"].get("TOTAL") or {}
        check("TOTAL long equals TOTAL short — the market is closed at zero",
              abs((tot.get("Total Long Contracts") or 0) -
                  (tot.get("Total Short Contracts") or 0)) < 1,
              f"{tot.get('Total Long Contracts')} vs {tot.get('Total Short Contracts')}")

    dd = dv.delivery_data(used_date or recent_weekday(1), symbol="RELIANCE")
    check("delivery data answers", dd.get("error") is None, str(dd.get("error")))
    if dd.get("error") is None:
        print(f"  (RELIANCE delivery={dd.get('deliveryPct')}%)")
        check("delivery percentage is a percentage",
              dd.get("deliveryPct") is not None and 0 <= dd["deliveryPct"] <= 100,
              str(dd.get("deliveryPct")))
        check("delivery quantity does not exceed traded quantity",
              dd["deliveryQty"] <= dd["tradedQty"],
              f"{dd['deliveryQty']} vs {dd['tradedQty']}")
        check("it is labelled backtestable", dd["backtestable"] is True)

    fd = dv.fii_dii_latest()
    check("FII/DII cash flows answer", fd.get("error") is None, str(fd.get("error")))
    if fd.get("error") is None:
        print(f"  (FII net={fd.get('fiiNet')} DII net={fd.get('diiNet')})")
        check("both categories are present", len(fd["flows"]) >= 2, str(len(fd["flows"])))
        check("it is labelled NOT backtestable", fd["backtestable"] is False)
        check("net reconciles with buy minus sell",
              all(abs((f["buy"] - f["sell"]) - f["net"]) < 1.0 for f in fd["flows"]),
              str(fd["flows"]))

    print("\n--- LIVE: a short backfill into the store ---")
    merged, info = dv.sync_history("NIFTY", "NSE", days=12, budget_seconds=100)
    print(f"  {info}")
    check("the backfill stored rows", merged is not None and len(merged) > 0,
          str(info))
    if merged is not None and len(merged):
        check("it fetched at least a few trading days", info["fetched"] >= 3, str(info["fetched"]))
        check("nothing was recorded as a failure", info["failed"] == 0, str(info))
        # Every requested day must land in exactly one bucket, or the report cannot
        # distinguish "nothing to fetch" from "nothing worked".
        check("weekends are counted, not silently skipped", info["weekends"] > 0, str(info))
        check("the buckets account for every requested day",
              info["fetched"] + info["weekends"] + info["notPublished"] +
              info["skipped"] + info["failed"] == info["daysRequested"], str(info))
        check("stored rows carry the declared columns", list(merged.columns) == dv.DERIV_COLUMNS)
        check("dates are unique", merged["date"].nunique() == len(merged))
        check("dates are sorted ascending", list(merged["date"]) == sorted(merged["date"]))
        pcr = pd.to_numeric(merged["pcr_oi"], errors="coerce").dropna()
        check("every stored PCR is plausible", len(pcr) and ((pcr > 0.1) & (pcr < 10)).all(),
              str(pcr.tolist()))
        latest = dv.latest_metrics("NIFTY") or {}
        check("latest_metrics returns the last stored row",
              latest.get("date") == pd.Timestamp(merged["date"].iloc[-1]).date().isoformat(),
              f"{latest.get('date')} vs {merged['date'].iloc[-1]}")
        # It crosses IPC to the renderer, so it has to survive json.dumps. A Timestamp or
        # an np.float64 passes a dict comprehension and fails there instead.
        import json as _j                                  # noqa: E402
        try:
            _j.dumps(latest)
            serialisable = True
        except TypeError as e:
            serialisable = False
            print(f"        ({e})")
        check("latest_metrics is JSON-serialisable", serialisable)
        check("its date is an ISO string, not a Timestamp",
              isinstance(latest.get("date"), str), str(type(latest.get("date"))))

        # Re-running must be nearly free — that is the point of the memo and the skip.
        _, info2 = dv.sync_history("NIFTY", "NSE", days=12, budget_seconds=100)
        check("re-running skips what is already stored", info2["skipped"] > 0, str(info2))
        check("re-running fetches nothing new", info2["fetched"] == 0, str(info2))
        check("re-running is fast", info2["elapsedSeconds"] < 15, str(info2["elapsedSeconds"]))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
