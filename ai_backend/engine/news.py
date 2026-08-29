"""
news.py — free news, classified events, and a sentiment reading that says what it is.

WHY THIS EXISTS (spec Section 70). Master asked Rāma to "read the news, reports of stocks and
generate impact". StockMind had none of it, and worse:
`SentimentModel.predict_proba_from_features` returned `0.5 + np.random.normal(0, 0.04)` — pure
noise — on **every** prediction, because the text path only runs when `news_text` is non-empty
and nothing ever supplied it. One of eight ensemble members was a random number generator,
voting in the blend and inflating `epistemic`.

THE CONSTRAINT THAT SHAPES ALL OF THIS: news has no history. No free feed reaches back more
than about sixteen days, and most cover two. That is the reverse of Section 67, where the NSE
archives went back to 2001. So a news feature **cannot be backfilled**, only accumulated
forward, and it therefore **cannot be a trained-model feature yet** — Section 69's gate needs a
150-row holdout and forward-chaining folds, and sixteen days provides neither.

What that leaves, and what this module is for:

  1. Collect and persist daily, so the feature becomes trainable in some months.
  2. Serve it as context now — headlines, event types and a polarity reading are useful to a
     trader without any claim of predictive power, and that is most of what master asked for.
  3. Expose it as a feature behind an availability flag, so the unchanged Section 69 gate can
     judge it once coverage exists.

It does NOT assert impact. Task 4 measured no directional edge from price features; asserting
one from headline sentiment on sixteen days of data would be unmeasurable by construction.
"""

import json
import logging
import os
import re
import time
import unicodedata
import datetime as _dt
import email.utils as _eut
import xml.etree.ElementTree as ET
from typing import Optional

import numpy as np
import pandas as pd

from . import store

logger = logging.getLogger("stockmind-ai.news")

NEWS_INTERVAL = "news1d"

# One row per symbol per day.
#
# `gdelt_*` ARE SEPARATE COLUMNS FROM `sentiment`, DELIBERATELY (spec Section 72). `sentiment`
# is this module's lexicon over RSS headlines; GDELT tone is a different measure, computed by
# someone else, over a different corpus, on a different scale. Writing both into one column
# would make a feature whose MEANING CHANGES WITH ITS SOURCE — the defect Section 67 removed
# when it stopped spot coming from `UndrlygPric` on some dates and the OHLCV store on others.
# A model would simply learn the date where RSS collection began.
NEWS_COLUMNS = [
    "date", "items", "sources",
    "sentiment", "sentiment_abs", "positive", "negative", "neutral",
    "relevance_mean", "dominant_event", "event_counts", "top_headline",
    # Historical, from GDELT — the only free source with real depth.
    "gdelt_tone", "gdelt_volume", "gdelt_articles",
]

# ── GDELT (spec Section 72) ───────────────────────────────────────────────────

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

# Verified, not assumed: 2015-06 and 2016-06 both return the plain-text body
# "Invalid query start date." — plain text on HTTP 200, so a parser that assumes JSON throws
# instead of reporting. Nine years of depth from here.
GDELT_FLOOR = _dt.date(2017, 1, 1)

# GDELT throttles hard on a burst, and once a pooled keep-alive socket has been reset it stays
# poisoned for every later request. These numbers are the access pattern that actually works.
GDELT_PAUSE_SECONDS = 6.0
GDELT_ATTEMPTS = 3
# Per-request ceiling. A first backfill attempt used 90s and the retry ladder then blew a
# 900-second budget on a single year without persisting anything, because GDELT was
# throttling and every attempt ran to timeout. A refusal that arrives quickly is worth more
# than a response that might arrive eventually.
GDELT_TIMEOUT_SECONDS = 30.0

GDELT_QUERIES = {
    "NIFTY50":   '("nifty" OR "sensex") sourcecountry:IN',
    "NIFTY":     '("nifty" OR "sensex") sourcecountry:IN',
    "BANKNIFTY": '("bank nifty" OR "banking stocks") sourcecountry:IN',
    "SENSEX":    '("sensex" OR "bse") sourcecountry:IN',
    "RELIANCE":  '"reliance industries" sourcecountry:IN',
    "TCS":       '"tata consultancy" sourcecountry:IN',
    "INFY":      '"infosys" sourcecountry:IN',
    "HDFCBANK":  '"hdfc bank" sourcecountry:IN',
    "ICICIBANK": '"icici bank" sourcecountry:IN',
    "SBIN":      '"state bank of india" sourcecountry:IN',
    "GOLD":      '("gold price" OR "bullion") sourcecountry:IN',
    "SILVER":    '"silver price" sourcecountry:IN',
    "CRUDEOIL":  '("crude oil" OR "brent crude")',
}


def gdelt_query_for(symbol: str) -> str:
    """
    The GDELT query for a symbol.

    OR'd TERMS MUST BE PARENTHESISED. `"a" OR "b"` returns the plain-text error
    `Queries containing OR'd terms must be surrounded by ()`, so every multi-term entry above
    is wrapped and any generated fallback is too.
    """
    s = (symbol or "").upper().strip()
    if s in GDELT_QUERIES:
        return GDELT_QUERIES[s]
    return f'"{s}" sourcecountry:IN'


def gdelt_timeline(query: str, mode: str, start: _dt.date, end: _dt.date) -> tuple[list, Optional[str]]:
    """
    One GDELT timeline call. @returns (points, error).

    A FRESH CLIENT PER CALL WITH `Connection: close` IS NOT AN OPTIMISATION TO UNDO. A shared
    pooled client is the failure mode: GDELT resets the connection after a burst and the
    poisoned socket then breaks every subsequent request, so a run that starts fine keeps
    failing afterwards. See Section 72.
    """
    import httpx

    params = {
        "query": query, "mode": mode, "format": "json",
        "startdatetime": start.strftime("%Y%m%d") + "000000",
        "enddatetime":   end.strftime("%Y%m%d") + "000000",
    }
    last = None
    for attempt in range(GDELT_ATTEMPTS):
        try:
            with httpx.Client(timeout=GDELT_TIMEOUT_SECONDS, follow_redirects=True, headers={
                "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                               "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
                "Accept": "application/json,*/*",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "close",
            }) as client:
                r = client.get(GDELT_URL, params=params)
            body = r.text.strip()
            # GDELT reports its own errors as PLAIN TEXT on HTTP 200 — "Invalid query start
            # date.", "Queries containing OR'd terms must be surrounded by ()". Checking the
            # status code alone would treat those as success and then fail at json.loads.
            if not body.startswith("{"):
                return [], f"GDELT refused: {body[:150]}"
            payload = json.loads(body)
            tl = payload.get("timeline") or []
            return ((tl[0].get("data") or []) if tl else []), None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(GDELT_PAUSE_SECONDS * (attempt + 1))
    return [], last


def _gdelt_points_to_map(points: list) -> dict:
    """`[{date: '20180101T000000Z', value: 0.17}]` → `{'2018-01-01': 0.17}`."""
    out = {}
    for p in points or []:
        raw = str(p.get("date") or "")
        if len(raw) < 8:
            continue
        day = f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
        v = p.get("value")
        if v is None:
            continue
        try:
            out[day] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def _merge_gdelt_rows(symbol: str, exchange: str, rows_by_day: dict):
    """
    Write the GDELT columns for the days gathered so far.

    Only `date` plus the `gdelt_*` columns are set; every other column is left `None` so
    `store.merge` fills it as NaN rather than overwriting an RSS row that already exists for
    that day. The two column groups are disjoint by design (Section 72), which is what lets
    the same date carry both without either erasing the other.
    """
    if not rows_by_day:
        return None
    rows = []
    for day, vals in sorted(rows_by_day.items()):
        row = {c: None for c in NEWS_COLUMNS}
        row["date"] = day
        row.update(vals)
        rows.append(row)
    return store.merge(symbol, pd.DataFrame(rows), exchange, NEWS_INTERVAL,
                       source="gdelt", columns=NEWS_COLUMNS, combine=True)


def backfill_history(symbol: str = "NIFTY50", exchange: str = "NSE",
                     years: int = 9, until: Optional[_dt.date] = None,
                     force: bool = False,
                     budget_seconds: float = 600.0) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Fetch GDELT tone and volume year by year and merge them into the news series.

    A YEAR PER CALL, newest first. Nine years is then nine calls per mode rather than
    hundreds, which matters because each call needs ~6 seconds of spacing. Newest first so a
    partial or budget-stopped run still leaves the most recent data present — the same choice
    `derivatives.sync_history` makes and for the same reason.

    Already-covered years are skipped unless `force`, so re-running converges instead of
    re-fetching.
    """
    t0 = _dt.datetime.now()
    end = until or _dt.date.today()
    query = gdelt_query_for(symbol)

    existing = load_series(symbol, exchange)
    have_years = set()
    if existing is not None and len(existing):
        d = pd.to_datetime(existing["date"], errors="coerce").dropna()
        tone = pd.to_numeric(existing.get("gdelt_tone"), errors="coerce") \
            if "gdelt_tone" in existing.columns else None
        if tone is not None:
            covered = d[tone.reindex(d.index).notna()]
            # A year counts as covered only with real density, or one stray row would block
            # the whole year from ever being fetched.
            for year, grp in covered.groupby(covered.dt.year):
                if len(grp) >= 200:
                    have_years.add(int(year))

    stats = {"symbol": symbol, "yearsRequested": years, "fetched": [], "skipped": [],
             "failed": {}, "tonePoints": 0, "volPoints": 0, "budgetHit": False,
             "floor": GDELT_FLOOR.isoformat()}
    rows_by_day: dict = {}

    for i in range(years):
        year = end.year - i
        # THE FLOOR CHECK COMES FIRST. Ordered the other way round, `y_end <= y_start` was
        # already true for a pre-2017 year (start clamps up to the floor, end clamps down to
        # December of that year) and the loop `continue`d before recording *why* — so a caller
        # asking for 12 years saw an empty `skipped` list and no explanation.
        if year < GDELT_FLOOR.year:
            stats["skipped"].append({"year": year, "why": "before the GDELT floor (2017)"})
            continue
        y_start = max(GDELT_FLOOR, _dt.date(year, 1, 1))
        y_end = min(end, _dt.date(year, 12, 31))
        if y_end <= y_start:
            stats["skipped"].append({"year": year, "why": "empty window"})
            continue
        if not force and year in have_years:
            stats["skipped"].append({"year": year, "why": "already covered"})
            continue
        if (_dt.datetime.now() - t0).total_seconds() > budget_seconds:
            stats["budgetHit"] = True
            break

        tone_pts, tone_err = gdelt_timeline(query, "TimelineTone", y_start, y_end)
        time.sleep(GDELT_PAUSE_SECONDS)
        vol_pts, vol_err = gdelt_timeline(query, "TimelineVol", y_start, y_end)
        time.sleep(GDELT_PAUSE_SECONDS)

        if tone_err and not tone_pts:
            stats["failed"][str(year)] = tone_err
            continue

        tone_map = _gdelt_points_to_map(tone_pts)
        vol_map = _gdelt_points_to_map(vol_pts)
        stats["tonePoints"] += len(tone_map)
        stats["volPoints"] += len(vol_map)
        stats["fetched"].append({"year": year, "tone": len(tone_map), "volume": len(vol_map)})
        if vol_err:
            stats["failed"][f"{year}-volume"] = vol_err

        for day, tone in tone_map.items():
            rows_by_day.setdefault(day, {})["gdelt_tone"] = round(tone, 5)
        for day, vol in vol_map.items():
            rows_by_day.setdefault(day, {})["gdelt_volume"] = round(vol, 6)

        # PERSIST AFTER EVERY YEAR, not once at the end. The first version merged only after
        # the whole loop, so a run that hit its budget or was interrupted kept **nothing** —
        # fifteen minutes of paced requests thrown away. Each year is independently useful,
        # and `store.merge` de-duplicates on date, so writing repeatedly converges.
        merged = _merge_gdelt_rows(symbol, exchange, rows_by_day)

    if merged is None:
        merged = load_series(symbol, exchange)
    stats["rows"] = 0 if merged is None else len(merged)
    stats["elapsedSeconds"] = round((_dt.datetime.now() - t0).total_seconds(), 1)
    if merged is not None and len(merged):
        stats["firstDate"] = str(pd.Timestamp(merged["date"].iloc[0]).date())
        stats["lastDate"] = str(pd.Timestamp(merged["date"].iloc[-1]).date())
        tone_col = pd.to_numeric(merged.get("gdelt_tone"), errors="coerce")
        stats["toneDays"] = int(tone_col.notna().sum()) if tone_col is not None else 0
    stats["note"] = ("GDELT reaches back to 2017 — the only free news archive with real depth. "
                     "Re-run to extend; covered years are skipped.")
    return merged, stats

# A source whose newest item is older than this is reported stale and not merged.
#
# THIS EXISTS BECAUSE OF MONEYCONTROL. Its business feed answers HTTP 200 with well-formed
# XML whose newest item is from April 2024 — over two years old. Nothing about the response
# says so. A staleness check on the newest item is the only thing that catches a feed that
# has quietly stopped, and "the XML parsed" is the check people write instead.
MAX_SOURCE_AGE_DAYS = 7


# ── Sources ───────────────────────────────────────────────────────────────────

def _google_news(query: str) -> str:
    from urllib.parse import quote_plus
    return (f"https://news.google.com/rss/search?q={quote_plus(query)}"
            f"&hl=en-IN&gl=IN&ceid=IN:en")


SOURCES = [
    {"name": "google_news", "kind": "query", "tier": "free",
     "url": None,
     "notes": "Per-query search. Deepest reach of anything free (~16 days) and carries the "
              "publisher name, so duplicate wire copy is visible."},
    {"name": "economic_times", "kind": "feed", "tier": "free",
     "url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
     "notes": "Markets desk."},
    {"name": "business_standard", "kind": "feed", "tier": "free",
     "url": "https://www.business-standard.com/rss/markets-106.rss",
     "notes": "Richest tags of the Indian feeds — category, keywords, section."},
    {"name": "livemint", "kind": "feed", "tier": "free",
     "url": "https://www.livemint.com/rss/markets", "notes": "Markets."},
    {"name": "businessline", "kind": "feed", "tier": "free",
     "url": "https://www.thehindubusinessline.com/markets/feeder/default.rss",
     "notes": "Markets."},
    {"name": "yahoo_ticker", "kind": "ticker", "tier": "free",
     "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US",
     "notes": "US TICKERS ONLY. Verified: RELIANCE.NS and ^NSEI both return 200 with zero "
              "items while AAPL returns 15. Registered so it is available for US symbols and "
              "so nobody re-discovers the gap."},
    # Deliberately NOT registered: moneycontrol's business feed, which is over two years
    # stale while answering 200 with valid XML. Left out with the reason recorded rather than
    # included and silently filtered, so it is not re-added by someone reading the list.
]


def registry() -> list[dict]:
    off = {s.strip().lower() for s in
           os.environ.get("STOCKMIND_DISABLE_NEWS", "").split(",") if s.strip()}
    out = []
    for s in SOURCES:
        d = dict(s)
        d["disabled"] = d["name"].lower() in off
        d["available"] = not d["disabled"]
        # Every news source shares the same limitation, and it is the one that matters.
        d["backtestable"] = False
        d["historyDays"] = "~2-16, accumulate forward"
        out.append(d)
    return out


# ── Symbols and aliases ───────────────────────────────────────────────────────

ALIASES = {
    "NIFTY50":   ["nifty 50", "nifty50", "nifty", "nse index"],
    "NIFTY":     ["nifty 50", "nifty50", "nifty"],
    "BANKNIFTY": ["bank nifty", "banknifty", "nifty bank"],
    "SENSEX":    ["sensex", "bse sensex"],
    "FINNIFTY":  ["finnifty", "nifty financial"],
    "RELIANCE":  ["reliance industries", "reliance", "ril", "mukesh ambani"],
    "TCS":       ["tata consultancy", "tcs"],
    "INFY":      ["infosys", "infy"],
    "HDFCBANK":  ["hdfc bank", "hdfcbank"],
    "ICICIBANK": ["icici bank", "icicibank"],
    "SBIN":      ["state bank of india", "sbi"],
    "GOLD":      ["gold", "gold price", "bullion"],
    "SILVER":    ["silver", "silver price"],
    "CRUDEOIL":  ["crude oil", "brent", "wti"],
}

QUERIES = {
    "NIFTY50":   "NIFTY 50 stock market India",
    "NIFTY":     "NIFTY 50 stock market India",
    "BANKNIFTY": "Bank Nifty banking stocks India",
    "SENSEX":    "BSE Sensex stock market",
    "GOLD":      "gold price MCX",
    "SILVER":    "silver price MCX",
    "CRUDEOIL":  "crude oil price",
}


def aliases_for(symbol: str) -> list:
    s = (symbol or "").upper().strip()
    return ALIASES.get(s, [s.lower()])


def query_for(symbol: str) -> str:
    s = (symbol or "").upper().strip()
    return QUERIES.get(s) or f"{s} share price NSE"


# ── Lexicon ───────────────────────────────────────────────────────────────────
#
# A LEXICON, LABELLED AS ONE (Section 70). `transformers` + `torch` is a very large pinned
# dependency master has not asked for, and FinBERT on CPU is slow per request. The FinBERT
# path in `SentimentModel` is kept for when it happens to be installed; this is the default.
#
# It handles the three things that make naive word counting wrong on financial headlines:
# finance-specific polarity that general lists get backwards, negation, and intensity.

POSITIVE = {
    "surge": 2.0, "surges": 2.0, "soar": 2.0, "soars": 2.0, "jump": 1.6, "jumps": 1.6,
    "rally": 1.6, "rallies": 1.6, "rise": 1.0, "rises": 1.0, "gain": 1.0, "gains": 1.0,
    "climb": 1.0, "climbs": 1.0, "advance": 0.8, "advances": 0.8, "up": 0.6, "higher": 0.9,
    "beat": 1.8, "beats": 1.8, "outperform": 1.5, "upgrade": 2.0, "upgrades": 2.0,
    "upgraded": 2.0, "buy": 1.2, "overweight": 1.4, "bullish": 1.8, "record": 1.2,
    "profit": 1.2, "profits": 1.2, "growth": 1.0, "expands": 0.9, "expansion": 0.9,
    "profitable": 1.3, "profitability": 1.0, "margins": 0.5, "beating": 1.6,
    "dividend": 1.0, "buyback": 1.6, "bonus": 1.0, "wins": 1.5, "win": 1.5, "bags": 1.5,
    "order": 0.8, "orders": 0.8, "approval": 1.4, "approved": 1.4, "sanction": 1.0,
    "strong": 1.2, "robust": 1.2, "boost": 1.3, "boosts": 1.3, "recovery": 1.1,
    "rebound": 1.4, "rebounds": 1.4, "breakout": 1.4, "multibagger": 1.6,
    "inflow": 1.0, "inflows": 1.0, "raises": 0.9, "hikes": 0.6, "top": 0.7,
}

NEGATIVE = {
    "plunge": 2.0, "plunges": 2.0, "crash": 2.2, "crashes": 2.2, "slump": 1.8,
    "slumps": 1.8, "tumble": 1.8, "tumbles": 1.8, "sink": 1.6, "sinks": 1.6,
    "fall": 1.0, "falls": 1.0, "drop": 1.0, "drops": 1.0, "decline": 1.0,
    "declines": 1.0, "slip": 0.8, "slips": 0.8, "down": 0.6, "lower": 0.9,
    "miss": 1.8, "misses": 1.8, "missed": 1.8, "underperform": 1.5,
    "downgrade": 2.0, "downgrades": 2.0, "downgraded": 2.0, "sell": 1.2,
    "underweight": 1.4, "bearish": 1.8, "loss": 1.5, "losses": 1.5, "weak": 1.2,
    "weakness": 1.2, "concern": 1.0, "concerns": 1.0, "worry": 1.0, "worries": 1.0,
    "probe": 1.8, "investigation": 1.8, "fraud": 2.2, "scam": 2.2, "raid": 1.8,
    "penalty": 1.6, "fine": 1.2, "lawsuit": 1.5, "default": 2.0, "downturn": 1.4,
    "impairment": 1.6, "writeoff": 1.6, "write-off": 1.6, "layoff": 1.4,
    "layoffs": 1.4, "resign": 1.2, "resigns": 1.2, "resignation": 1.2, "exit": 0.8,
    "outflow": 1.0, "outflows": 1.0, "cut": 1.0, "cuts": 1.0, "halt": 1.3,
    "halts": 1.3, "suspend": 1.5, "suspended": 1.5, "warning": 1.3, "warns": 1.3,
    "risk": 0.8, "risks": 0.8, "correction": 1.2, "selloff": 1.7, "sell-off": 1.7,
    "drag": 1.0, "drags": 1.0, "pressure": 0.9, "delisting": 1.6,
    "unprofitable": 1.5, "shortfall": 1.4, "downside": 1.0, "insolvency": 2.0,
    "bankruptcy": 2.2, "defaults": 2.0, "derail": 1.4, "stalls": 1.2,
}

# A polarity word inside this many tokens after a negator flips sign. "fails to beat
# estimates" is a miss, and a word-counting reading calls it a beat.
NEGATORS = {"not", "no", "never", "fails", "fail", "failed", "without", "cannot",
            "cant", "can't", "unable", "denies", "denied", "rules out", "despite",
            "misses", "lacks", "halts", "less", "least"}
NEGATION_WINDOW = 3

# ORDER IS THE CLASSIFICATION, and getting it wrong was caught by the tests rather than by
# reading. Three corrections worth keeping visible:
#
#   `rating` now precedes `guidance`, because "cuts price target" is a broker action and the
#   greedy `targets?` in guidance was claiming it first.
#   `guidance` no longer matches a bare "target" for the same reason.
#   `rbi` is NOT in `regulatory`. "RBI holds repo rate" is monetary policy, not enforcement,
#   and bare `rbi` made every rate decision a regulatory story. SEBI, CCI and NCLT stay,
#   since those appear in news precisely when they are acting against someone — and genuine
#   RBI enforcement says penalty, notice or action, which `regulatory` already matches.
EVENT_PATTERNS = [
    ("earnings",    r"\b(q[1-4]|quarter(?:ly)?|results?|earnings|profit|revenue|topline|"
                    r"bottomline|ebitda|margin)\b"),
    ("rating",      r"\b(upgrade[sd]?|downgrade[sd]?|initiate[sd]?\s+coverage|"
                    r"price\s+target|target\s+price|rating|overweight|underweight|"
                    r"buy|sell|hold|accumulate|reduce)\b"),
    ("guidance",    r"\b(guidance|outlook|forecast|projects?|expects?)\b"),
    ("regulatory",  r"\b(sebi|cci|nclt|probe|investigation|penalty|fine[sd]?|"
                    r"lawsuit|court|tribunal|notice|compliance|raid)\b"),
    ("ma",          r"\b(acquisition|acquires?|acquired|merger|merges?|stake\s+sale|"
                    r"takeover|divest|demerger|joint\s+venture|jv)\b"),
    ("capital",     r"\b(dividend|buyback|bonus|split|rights\s+issue|qip|ipo|fpo|"
                    r"fund\s?rais|preferential)\b"),
    ("deal",        r"\b(block\s+deal|bulk\s+deal|open\s+market|pledge[sd]?)\b"),
    ("order_win",   r"\b(order|contract|bags?|wins?|awarded|tender|loi)\b"),
    ("index",       r"\b(index\s+inclusion|index\s+rejig|f&o\s+ban|rebalanc)\b"),
    ("macro",       r"\b(gdp|inflation|cpi|wpi|repo|fed|fomc|tariff|budget|monsoon|"
                    r"crude|rupee|bond\s+yield|jobs\s+data)\b"),
    ("management",  r"\b(ceo|cfo|md|chairman|resign|appoint|steps?\s+down)\b"),
]

_TOKEN = re.compile(r"[a-z][a-z\-']+")


def normalise_text(text: str) -> str:
    """Strip accents and collapse whitespace, so a headline dedupes consistently."""
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t).strip()


def score_text(text: str) -> dict:
    """
    Lexicon polarity for one headline.

    @returns {score: -1..1, positive, negative, matched, negated, tokens}

    The score is normalised by matched *weight*, not by token count, so a long headline with
    one strong word is not diluted into neutrality by its own length.
    """
    t = normalise_text(text).lower()
    tokens = _TOKEN.findall(t)
    pos = neg = 0.0
    matched, negated = [], 0

    for i, tok in enumerate(tokens):
        w_pos = POSITIVE.get(tok)
        w_neg = NEGATIVE.get(tok)
        if w_pos is None and w_neg is None:
            continue
        flip = False
        for j in range(max(0, i - NEGATION_WINDOW), i):
            if tokens[j] in NEGATORS:
                flip = True
                break
        weight = w_pos if w_pos is not None else w_neg
        sign = 1.0 if w_pos is not None else -1.0
        if flip:
            sign = -sign
            negated += 1
        if sign > 0:
            pos += weight
        else:
            neg += weight
        matched.append(tok)

    total = pos + neg
    score = 0.0 if total <= 0 else float((pos - neg) / total)
    return {"score": round(score, 4), "positive": round(pos, 3), "negative": round(neg, 3),
            "matched": matched, "negated": negated, "tokens": len(tokens)}


def classify_event(text: str) -> tuple[Optional[str], list]:
    """
    Which event types a headline mentions, most specific first.

    Reported alongside polarity because "three rating downgrades today" tells a trader
    something that "sentiment -0.2" does not. Order matters: `order_win` is deliberately
    checked after `rating`, since "buy" appears in both and a rating note is the more
    specific reading.
    """
    t = normalise_text(text).lower()
    hits = [name for name, pat in EVENT_PATTERNS if re.search(pat, t)]
    return (hits[0] if hits else None), hits


def relevance(text: str, symbol: str) -> float:
    """
    How much this headline is about `symbol`.

    A headline naming the symbol is worth more than a general market headline, and the daily
    aggregate is weighted by this — otherwise a broad "markets fall" story counts as much as
    an earnings miss for the company being asked about.
    """
    t = normalise_text(text).lower()
    al = aliases_for(symbol)
    best = 0.0
    for a in al:
        if a and a in t:
            # Longer alias matches are more specific: "reliance industries" beats "reliance".
            best = max(best, min(1.0, 0.55 + 0.05 * len(a.split())))
    return round(best, 4)


# ── Fetch ─────────────────────────────────────────────────────────────────────

def _client(timeout: float = 25.0):
    import httpx
    return httpx.Client(timeout=timeout, follow_redirects=True, headers={
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
        "Accept": "application/rss+xml,application/xml,text/xml,*/*",
        # Never brotli — Section 67 records what advertising an undecodable encoding costs.
        "Accept-Encoding": "gzip, deflate",
    })


def _parse_date(raw: str) -> Optional[_dt.datetime]:
    if not raw:
        return None
    try:
        d = _eut.parsedate_to_datetime(raw)
        return d.replace(tzinfo=None) - (d.utcoffset() or _dt.timedelta(0))
    except Exception:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d"):
        try:
            return _dt.datetime.strptime(raw.strip(), fmt).replace(tzinfo=None)
        except ValueError:
            continue
    return None


def _strip_html(s: str) -> str:
    return normalise_text(re.sub(r"<[^>]+>", " ", s or ""))


def fetch_feed(url: str, source_name: str, client=None) -> dict:
    """
    One RSS/Atom feed, parsed.

    @returns {ok, items, newestAge, stale, error}. `stale` is the important one — see
             MAX_SOURCE_AGE_DAYS and the Moneycontrol case.
    """
    own = client is None
    client = client or _client()
    out = {"source": source_name, "ok": False, "items": [], "error": None,
           "stale": False, "newestAgeDays": None}
    try:
        r = client.get(url)
        if r.status_code != 200:
            out["error"] = f"HTTP {r.status_code}"
            return out
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError as e:
            out["error"] = f"XML parse: {e}"
            return out

        nodes = root.findall(".//item") or root.findall(
            ".//{http://www.w3.org/2005/Atom}entry")
        now = _dt.datetime.utcnow()
        items, newest = [], None
        for n in nodes:
            def txt(tag):
                e = n.find(tag)
                if e is None:
                    e = n.find("{http://www.w3.org/2005/Atom}" + tag)
                return (e.text or "").strip() if e is not None and e.text else ""

            title = _strip_html(txt("title"))
            if not title:
                continue
            when = _parse_date(txt("pubDate") or txt("published") or txt("updated"))
            if when and (newest is None or when > newest):
                newest = when
            src = n.find("source")
            items.append({
                "title":     title,
                "summary":   _strip_html(txt("description") or txt("summary"))[:400],
                "link":      txt("link"),
                "published": when.isoformat(timespec="seconds") if when else None,
                "publisher": ((src.text or "").strip() if src is not None and src.text
                              else source_name),
                "source":    source_name,
            })

        out["items"] = items
        out["ok"] = True
        if newest is not None:
            age = (now - newest).total_seconds() / 86400.0
            out["newestAgeDays"] = round(age, 2)
            if age > MAX_SOURCE_AGE_DAYS:
                out["stale"] = True
                out["error"] = (f"newest item is {age:.0f} days old — the feed has stopped "
                                f"publishing but still answers 200 with valid XML")
        return out
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    finally:
        if own:
            client.close()


def _dedupe(items: list) -> list:
    """
    Collapse the same story appearing many times.

    TEN COPIES OF ONE WIRE STORY IS NOT TEN PIECES OF EVIDENCE, and without this the daily
    aggregate is a popularity count of whichever agency was syndicated most.
    """
    seen, out = set(), []
    for it in items:
        key = re.sub(r"[^a-z0-9]+", "", normalise_text(it["title"]).lower())[:110]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def headlines(symbol: str = "NIFTY50", limit: int = 40,
              include_general: bool = True) -> dict:
    """
    Current news for a symbol: scored, classified, relevance-ranked.

    Always labelled `backtestable: False`. No free feed reaches back more than about sixteen
    days, so this describes now and cannot be recomputed for a past date (Section 70).
    """
    out = {"symbol": (symbol or "").upper(), "backtestable": False,
           "asOf": _dt.datetime.now().isoformat(timespec="seconds"),
           "items": [], "sources": {}, "error": None,
           "note": "Lexicon sentiment on headlines, not a language model. Context for a "
                   "human, not a prediction — no free feed has enough history to measure "
                   "whether it predicts anything."}
    disabled = {s.strip().lower() for s in
                os.environ.get("STOCKMIND_DISABLE_NEWS", "").split(",") if s.strip()}
    client = _client()
    raw = []
    try:
        for s in SOURCES:
            if s["name"] in disabled:
                out["sources"][s["name"]] = {"skipped": "disabled"}
                continue
            if s["kind"] == "query":
                url = _google_news(query_for(symbol))
            elif s["kind"] == "ticker":
                # US only — verified: Indian tickers return 200 with zero items.
                out["sources"][s["name"]] = {"skipped": "US tickers only"}
                continue
            else:
                if not include_general:
                    out["sources"][s["name"]] = {"skipped": "general feed excluded"}
                    continue
                url = s["url"]
            res = fetch_feed(url, s["name"], client=client)
            out["sources"][s["name"]] = {
                "ok": res["ok"], "items": len(res["items"]),
                "newestAgeDays": res["newestAgeDays"],
                "stale": res["stale"], "error": res["error"],
            }
            if res["ok"] and not res["stale"]:
                raw.extend(res["items"])
    finally:
        client.close()

    for it in _dedupe(raw):
        text = f"{it['title']} {it['summary']}"[:500]
        sc = score_text(text)
        ev, evs = classify_event(text)
        rel = relevance(text, symbol)
        out["items"].append({**it, "sentiment": sc["score"],
                             "sentimentWords": sc["matched"], "negations": sc["negated"],
                             "event": ev, "events": evs, "relevance": rel})

    # Relevance first, then recency: a directly-about-this-symbol story from yesterday beats
    # a general market story from an hour ago.
    out["items"].sort(key=lambda i: (i["relevance"], i["published"] or ""), reverse=True)
    out["items"] = out["items"][:max(1, limit)]
    out["aggregate"] = aggregate(out["items"], symbol)
    return out


# ── Aggregation ───────────────────────────────────────────────────────────────

def aggregate(items: list, symbol: str) -> dict:
    """One day's reading for one symbol, relevance-weighted."""
    if not items:
        return {"items": 0, "sentiment": None, "note": "no news found"}

    scores = np.array([float(i.get("sentiment") or 0.0) for i in items], dtype=float)
    rels = np.array([float(i.get("relevance") or 0.0) for i in items], dtype=float)
    # A general market story still counts, just less. A floor rather than zero, or a day with
    # no symbol-specific news would report `None` while real market news existed.
    w = np.clip(rels, 0.15, 1.0)

    counted = scores != 0.0
    sent = float(np.sum(scores * w) / np.sum(w)) if w.sum() > 0 else 0.0
    ev_counts: dict = {}
    for i in items:
        for e in (i.get("events") or []):
            ev_counts[e] = ev_counts.get(e, 0) + 1

    top = max(items, key=lambda i: (i.get("relevance") or 0, abs(i.get("sentiment") or 0)))
    return {
        "items":          int(len(items)),
        "sources":        int(len({i.get("source") for i in items})),
        "publishers":     int(len({i.get("publisher") for i in items})),
        "sentiment":      round(sent, 4),
        "sentimentAbs":   round(float(np.mean(np.abs(scores))), 4),
        "positive":       int(np.sum(scores > 0.05)),
        "negative":       int(np.sum(scores < -0.05)),
        "neutral":        int(np.sum(np.abs(scores) <= 0.05)),
        "withPolarity":   int(counted.sum()),
        "relevanceMean":  round(float(np.mean(rels)), 4),
        "dominantEvent":  (max(ev_counts, key=ev_counts.get) if ev_counts else None),
        "eventCounts":    ev_counts,
        "topHeadline":    top.get("title"),
        "note":           ("Relevance-weighted lexicon reading over de-duplicated headlines. "
                           "Not a forecast."),
    }


# ── Persistence ───────────────────────────────────────────────────────────────

def sync_today(symbol: str = "NIFTY50", exchange: str = "NSE",
               limit: int = 60) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Record today's reading so the series accumulates.

    THIS IS THE ONLY WAY NEWS EVER BECOMES A TRAINABLE FEATURE. History cannot be fetched —
    sixteen days is the ceiling — so it has to be collected one day at a time from whenever
    collection starts. Running this daily is what makes a news feature possible in months;
    not running it means it never is.

    Items are also bucketed by their own publication date, not all stamped today, so a single
    run seeds whatever recent days the feeds happen to cover.
    """
    res = headlines(symbol, limit=limit)
    if not res["items"]:
        return load_series(symbol, exchange), {
            "symbol": symbol, "recorded": 0, "reason": "no items returned",
            "sources": res["sources"]}

    by_day: dict = {}
    for it in res["items"]:
        day = (it.get("published") or "")[:10] or _dt.date.today().isoformat()
        by_day.setdefault(day, []).append(it)

    rows = []
    for day, day_items in sorted(by_day.items()):
        agg = aggregate(day_items, symbol)
        rows.append({
            "date":            day,
            "items":           agg["items"],
            "sources":         agg["sources"],
            "sentiment":       agg["sentiment"],
            "sentiment_abs":   agg["sentimentAbs"],
            "positive":        agg["positive"],
            "negative":        agg["negative"],
            "neutral":         agg["neutral"],
            "relevance_mean":  agg["relevanceMean"],
            "dominant_event":  agg["dominantEvent"],
            "event_counts":    ";".join(f"{k}={v}" for k, v in sorted(agg["eventCounts"].items())),
            "top_headline":    (agg["topHeadline"] or "")[:200],
        })

    merged = store.merge(symbol, pd.DataFrame(rows), exchange, NEWS_INTERVAL,
                         source="rss", columns=NEWS_COLUMNS, combine=True)
    info = {"symbol": symbol, "exchange": exchange, "recorded": len(rows),
            "days": [r["date"] for r in rows],
            "rows": 0 if merged is None else len(merged),
            "sources": res["sources"],
            "note": "News cannot be backfilled. Run this daily to accumulate a series."}
    if merged is not None and len(merged):
        info["firstDate"] = str(pd.Timestamp(merged["date"].iloc[0]).date())
        info["lastDate"] = str(pd.Timestamp(merged["date"].iloc[-1]).date())
    return merged, info


def load_series(symbol: str = "NIFTY50", exchange: str = "NSE") -> Optional[pd.DataFrame]:
    return store.load(symbol, exchange, NEWS_INTERVAL, NEWS_COLUMNS)


def coverage(symbol: str = "NIFTY50", exchange: str = "NSE") -> dict:
    """
    How much news history exists — the number that decides whether it can be a feature.

    Reported explicitly because Section 69's gate needs a 150-row holdout, and until this
    series is long enough a news feature cannot be judged at all, let alone trusted.
    """
    df = load_series(symbol, exchange)
    if df is None or len(df) == 0:
        return {"symbol": symbol, "days": 0, "trainable": False,
                "note": "Nothing collected yet. POST /news/sync daily to accumulate."}
    d = pd.to_datetime(df["date"], errors="coerce").dropna()
    days = int(len(d))
    return {
        "symbol": symbol, "days": days,
        "firstDate": str(d.iloc[0].date()), "lastDate": str(d.iloc[-1].date()),
        "spanDays": int((d.iloc[-1] - d.iloc[0]).days),
        # A generous floor: enough for a 150-row holdout at a 20% split plus folds.
        "trainable": days >= 800,
        "note": (f"{days} days collected. A news feature needs roughly 800 before Section "
                 f"69's gate can judge it — collect daily and revisit."),
    }
