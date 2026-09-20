"""
macro.py — master's transmission chain, as links that can be measured and rejected.

Master's own example, verbatim in structure:

    crude flow blocked -> petro products flow drops -> prices increase -> trouble for companies using
    them as raw material -> expenditure more, profit less -> if persisting more time causes
    stockholders to jitter and cause sell frenzy -> or vice versa.

    "consider it all kind of materials and industries."

WHY THIS IS NOT A SENTIMENT SCORE. That chain has four things a sentiment number does not: an INPUT
(crude), a DIRECTION (up hurts consumers, helps producers), a LAG (costs reach results slowly), and a
PERSISTENCE CONDITION ("if persisting more time"). All four are stated in advance, which is what makes
each link a falsifiable claim rather than a story. Rāma does not have to believe the chain. It measures
whether NIFTY Auto actually underperforms after Brent rises hard over twenty days.

THE DECISION THAT MAKES THIS HONEST: THE SIGN AND THE LAG ARE DECLARED BEFORE MEASUREMENT.
A link whose measured direction is opposite to its declared direction is reported as CONTRADICTED and is
NOT flipped. Flipping a sign to match the data is precisely how noise becomes a finding — and it is the
difference between a pre-registered one-sided test and a fishing expedition. A contradicted link is real
information: it says the economics were misread, and that is worth more than a silently corrected sign.

WHY THIS SERVES MASTER'S STATED PURPOSE. *"Corporates have their algos and setup but our setup is to
level the field for retail traders."* A commodity-to-sector exposure map with measured lags is exactly
what an institutional desk has and a retail trader does not. It is also buildable from free data, which
is why it is the right thing to build before any paid feed exists.

SAMPLING IS NON-OVERLAPPING, deliberately. Forward returns at consecutive dates share almost all of their
window, so overlapping samples make any t-statistic look far stronger than the evidence supports. Stepping
by the lag costs sample size and buys validity. Reported, so the cost is visible.

STDLIB ONLY for every measurement. The fetch and store half uses the existing provider chain and
`store.merge`, so there is no second persistence path — a macro series is stored exactly like any other
instrument, under the `MACRO` exchange so it cannot collide with one of master's own.
"""

from __future__ import annotations

import logging
import math
from typing import Optional

logger = logging.getLogger(__name__)

MACRO_EXCHANGE = "MACRO"

# ── The series ────────────────────────────────────────────────────────────────
#
# Free, and each records what it IS rather than what it is wanted for. `^` and `=` tickers pass through
# `providers.to_yahoo_symbol` untouched, which is why these need no new fetch path.
#
# `unverified: True` on every one until a sync actually resolves it. A ticker written down is not a
# ticker that works, and the difference between "no data" and "never fetched" is the difference
# `ollamaCatalog` also insists on.

SERIES: dict = {
    "crude_brent": {"ticker": "BZ=F", "label": "Brent crude", "unit": "USD/barrel",
                    "why": "India imports roughly 85% of its crude, so this is the single most "
                           "consequential imported input price in the economy"},
    "crude_wti": {"ticker": "CL=F", "label": "WTI crude", "unit": "USD/barrel",
                  "why": "the US benchmark; kept because Brent occasionally has gaps"},
    "usdinr": {"ticker": "USDINR=X", "label": "USD/INR", "unit": "INR per USD",
               "why": "rising means a weaker rupee: good for exporters, bad for importers"},
    "us10y": {"ticker": "^TNX", "label": "US 10-year yield", "unit": "percent",
              "why": "the global discount rate; drives foreign flows into and out of Indian equity"},
    "india_vix": {"ticker": "^INDIAVIX", "label": "India VIX", "unit": "percent",
                  "why": "the market's own priced expectation of movement"},
    "copper": {"ticker": "HG=F", "label": "Copper", "unit": "USD/lb",
               "why": "wiring and motors; the classic industrial-demand read"},
    "gold": {"ticker": "GC=F", "label": "Gold", "unit": "USD/oz",
             "why": "risk aversion, and a real input for Indian jewellery retail"},
    "natgas": {"ticker": "NG=F", "label": "Natural gas", "unit": "USD/MMBtu",
               "why": "feedstock for fertiliser and city gas"},
    "dollar_index": {"ticker": "DX-Y.NYB", "label": "US dollar index", "unit": "index",
                     "why": "a broad dollar move sets the direction for every commodity priced in it"},
}

# Inputs master named that have NO free series. Listed rather than silently proxied, because a proxy
# presented as the thing is the same failure as a fabricated source.
NO_FREE_SERIES = {
    "steel": "No free spot steel series. Sector index NIFTY Metal is a PROXY for producers, not a price.",
    "palm_oil": "Malaysian palm oil futures are not freely available; a real FMCG input with no series.",
    "coal": "Indian coal is largely administered and imported grades are not freely quoted.",
    "freight": "Baltic Dry is free in principle but not through this provider chain; unverified.",
    "cement": "Regional, administered, and not quoted as a tradable series at all.",
}

# Sector indices. Not in `providers.YAHOO_SYMBOLS`, but every one starts with `^` so it passes through
# unchanged. Marked unverified for the same reason as above.
SECTORS: dict = {
    "NIFTY50": {"ticker": "^NSEI", "label": "Nifty 50"},
    "NIFTY_BANK": {"ticker": "^NSEBANK", "label": "Nifty Bank"},
    "NIFTY_IT": {"ticker": "^CNXIT", "label": "Nifty IT"},
    "NIFTY_AUTO": {"ticker": "^CNXAUTO", "label": "Nifty Auto"},
    "NIFTY_FMCG": {"ticker": "^CNXFMCG", "label": "Nifty FMCG"},
    "NIFTY_PHARMA": {"ticker": "^CNXPHARMA", "label": "Nifty Pharma"},
    "NIFTY_METAL": {"ticker": "^CNXMETAL", "label": "Nifty Metal"},
    "NIFTY_ENERGY": {"ticker": "^CNXENERGY", "label": "Nifty Energy"},
    "NIFTY_REALTY": {"ticker": "^CNXREALTY", "label": "Nifty Realty"},
    "NIFTY_INFRA": {"ticker": "^CNXINFRA", "label": "Nifty Infrastructure"},
}

CONSUMER = "consumer"     # the input is a cost: input up, margin down
PRODUCER = "producer"     # the input is revenue: input up, margin up
FLOW = "flow"             # neither; transmits through capital flows or discount rates
CONTROL = "control"       # a link included to test the METHOD, not to trade

# ── The map ───────────────────────────────────────────────────────────────────
#
# Each link is master's chain written out, with a sign and a lag fixed in advance. `evidence` is
# `asserted` for every one — an input-output relationship is an argument, not a measurement, and it
# becomes `measured` only by surviving `measure_link` on real data (Section 112's vocabulary).

EXPOSURES: list = [
    {
        "id": "crude_auto",
        "input": "crude_brent", "target": "NIFTY_AUTO", "role": CONSUMER, "sign": -1,
        "chain": ("crude up -> fuel and petro-derived inputs (plastics, rubber, paint, freight) cost "
                  "more -> vehicle running cost rises and input cost rises together -> demand and "
                  "margin are pressured at the same time"),
        "window": 20, "lag": 20,
        "note": "master's own example, at the sector level",
    },
    {
        "id": "crude_fmcg",
        "input": "crude_brent", "target": "NIFTY_FMCG", "role": CONSUMER, "sign": -1,
        "chain": ("crude up -> packaging, surfactants and freight cost more -> gross margin compresses "
                  "on products whose price cannot be raised quickly"),
        "window": 20, "lag": 40,
        "note": "a longer lag than autos: FMCG holds inventory and repricing is slower",
    },
    {
        "id": "crude_index",
        "input": "crude_brent", "target": "NIFTY50", "role": CONSUMER, "sign": -1,
        "chain": ("crude up -> India's import bill rises -> current account deficit widens -> rupee "
                  "pressured and inflation expectations rise -> equity risk premium rises"),
        "window": 60, "lag": 40,
        "note": "the whole-economy version; a long window because the mechanism is a deficit, not a day",
    },
    {
        "id": "crude_energy",
        "input": "crude_brent", "target": "NIFTY_ENERGY", "role": PRODUCER, "sign": 1,
        "chain": "crude up -> upstream producers realise more per barrel",
        "window": 20, "lag": 20,
        "ambiguous": ("Nifty Energy mixes upstream producers with refiners and marketers. High crude "
                      "HELPS the first and HURTS the last two when retail prices are slow to move, so "
                      "this link may measure as contradicted for a real reason rather than a wrong one. "
                      "Resolving it needs constituent-level exposure, which does not exist yet."),
    },
    {
        "id": "copper_metal",
        "input": "copper", "target": "NIFTY_METAL", "role": PRODUCER, "sign": 1,
        "chain": "copper up -> metal producers realise more, and the whole complex reprices with it",
        "window": 20, "lag": 20,
    },
    {
        "id": "copper_auto",
        "input": "copper", "target": "NIFTY_AUTO", "role": CONSUMER, "sign": -1,
        "chain": ("copper up -> wiring harnesses and motors cost more -> input cost rises, and the "
                  "electric-vehicle bill of materials is more copper-intensive than the old one"),
        "window": 20, "lag": 40,
    },
    {
        "id": "rupee_it",
        "input": "usdinr", "target": "NIFTY_IT", "role": PRODUCER, "sign": 1,
        "chain": ("USDINR up means a weaker rupee -> IT services bill in dollars and pay in rupees -> "
                  "realised margin expands with no operational change"),
        "window": 20, "lag": 20,
        "note": "the cleanest exporter link in the Indian market",
    },
    {
        "id": "rupee_pharma",
        "input": "usdinr", "target": "NIFTY_PHARMA", "role": PRODUCER, "sign": 1,
        "chain": "weaker rupee -> export realisations rise; partly offset by imported API costs",
        "window": 20, "lag": 20,
    },
    {
        "id": "rupee_auto",
        "input": "usdinr", "target": "NIFTY_AUTO", "role": CONSUMER, "sign": -1,
        "chain": "weaker rupee -> imported components and capital equipment cost more",
        "window": 20, "lag": 40,
    },
    {
        "id": "us10y_it",
        "input": "us10y", "target": "NIFTY_IT", "role": FLOW, "sign": -1,
        "chain": ("US yields up -> long-duration growth assets reprice down, and US corporate IT "
                  "budgets tighten -> Indian IT services demand and multiple both compress"),
        "window": 20, "lag": 20,
    },
    {
        "id": "us10y_index",
        "input": "us10y", "target": "NIFTY50", "role": FLOW, "sign": -1,
        "chain": ("US yields up -> the risk-free alternative improves -> foreign portfolio flows leave "
                  "emerging equity"),
        "window": 40, "lag": 20,
    },
    {
        "id": "dollar_metal",
        "input": "dollar_index", "target": "NIFTY_METAL", "role": FLOW, "sign": -1,
        "chain": "a stronger dollar makes every dollar-priced commodity dearer in other currencies, "
                 "which suppresses demand and the commodity complex with it",
        "window": 20, "lag": 20,
    },
    # ── Controls. These exist to test the METHOD, not to be traded. ───────────
    {
        "id": "control_vix_index",
        "input": "india_vix", "target": "NIFTY50", "role": CONTROL, "sign": -1,
        "chain": ("POSITIVE CONTROL. VIX rises when the index falls, near-tautologically. If the "
                  "harness cannot find THIS link, the harness is broken and no other result from it "
                  "should be believed."),
        "window": 20, "lag": 5,
        "expect": "supported",
    },
    {
        "id": "control_gold_it",
        "input": "gold", "target": "NIFTY_IT", "role": CONTROL, "sign": 1,
        "chain": ("NEGATIVE CONTROL. There is no mechanism by which the gold price should move Indian "
                  "IT services. If this measures as supported, the method is producing spurious "
                  "findings and every other supported link is suspect."),
        "window": 20, "lag": 20,
        "expect": "not-supported",
    },
]

# ── Measurement ───────────────────────────────────────────────────────────────

MIN_OBSERVATIONS = 30        # total non-overlapping samples before anything is reported
MIN_PER_BUCKET = 10
T_THRESHOLD = 2.0
BUCKET_FRAC = 0.33           # terciles: "a sustained move" is the top third of window moves


def _align(input_pairs, target_pairs) -> tuple[list, list, list]:
    """Common dates only, sorted. A date in one series and not the other supports nothing."""
    a = {str(d): float(v) for d, v in input_pairs if v is not None and float(v) > 0}
    b = {str(d): float(v) for d, v in target_pairs if v is not None and float(v) > 0}
    dates = sorted(set(a) & set(b))
    return dates, [a[d] for d in dates], [b[d] for d in dates]


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def _var(xs):
    n = len(xs)
    if n < 2:
        return None
    m = sum(xs) / n
    return sum((x - m) ** 2 for x in xs) / (n - 1)


def measure_link(input_pairs, target_pairs, *, sign: int, window: int, lag: int,
                 bucket_frac: float = BUCKET_FRAC) -> dict:
    """
    Does the target actually respond to the input, in the direction declared in advance?

    `input_pairs` / `target_pairs` are `[(date, close), ...]`. `sign` is +1 or -1 and is NOT inferred.

    The test: take the input's return over `window` days as the persistence measure — master's "if
    persisting more time" — then compare the target's forward return over `lag` days following the
    largest input RISES against those following the largest input FALLS. The declared sign predicts
    which way that difference should go.

    @returns a dict whose `verdict` is `supported` | `not-supported` | `contradicted` | `insufficient`.
    """
    if sign not in (1, -1):
        return {"ok": False, "verdict": "insufficient", "reason": "sign must be +1 or -1, never inferred"}
    if window < 2 or lag < 1:
        return {"ok": False, "verdict": "insufficient", "reason": "window must be >= 2 and lag >= 1"}

    dates, iv, tv = _align(input_pairs, target_pairs)
    n = len(dates)
    base = {"ok": False, "sign": sign, "window": window, "lag": lag,
            "alignedBars": n, "observations": 0}
    if n < window + lag + MIN_OBSERVATIONS:
        return {**base, "verdict": "insufficient",
                "reason": (f"{n} aligned bars; needs at least {window + lag + MIN_OBSERVATIONS} for "
                           f"{MIN_OBSERVATIONS} non-overlapping samples at window {window} and lag {lag}")}

    # NON-OVERLAPPING. Stepping by `lag` means no two forward windows share a bar, so each observation
    # is independent and the t-statistic below means what it claims to. Overlapping samples would
    # inflate it by roughly the square root of the overlap.
    obs = []
    i = window
    while i + lag < n:
        prior = iv[i - window]
        if prior > 0:
            obs.append(((iv[i] / prior) - 1.0, (tv[i + lag] / tv[i]) - 1.0))
        i += lag

    m = len(obs)
    if m < MIN_OBSERVATIONS:
        return {**base, "observations": m, "verdict": "insufficient",
                "reason": f"{m} non-overlapping samples; needs {MIN_OBSERVATIONS}"}

    obs.sort(key=lambda p: p[0])
    k = max(MIN_PER_BUCKET, int(m * bucket_frac))
    if k * 2 > m:
        return {**base, "observations": m, "verdict": "insufficient",
                "reason": f"{m} samples cannot form two buckets of {MIN_PER_BUCKET}"}

    low = [p[1] for p in obs[:k]]          # input fell most
    high = [p[1] for p in obs[-k:]]        # input rose most
    all_fwd = [p[1] for p in obs]

    mean_high, mean_low = _mean(high), _mean(low)
    response = mean_high - mean_low
    v_high, v_low = _var(high), _var(low)
    se = math.sqrt((v_high or 0.0) / len(high) + (v_low or 0.0) / len(low))
    t = (response / se) if se > 0 else None

    # The declared sign predicts the SIGN of `response`: a consumer (-1) should do worse after the
    # input rises than after it falls, so response should be negative.
    direction_matches = (response * sign) > 0

    if t is None:
        verdict, reason = "insufficient", "no variance in forward returns to test against"
    elif abs(t) < T_THRESHOLD:
        verdict = "not-supported"
        reason = (f"the difference is {response * 100:.2f} percentage points with t={t:.2f}, inside "
                  f"the noise band")
    elif direction_matches:
        verdict = "supported"
        reason = (f"after a large input rise the target returns {mean_high * 100:.2f}% over {lag} days "
                  f"against {mean_low * 100:.2f}% after a large fall; t={t:.2f} in the declared "
                  f"direction")
    else:
        # NOT FLIPPED. The economics were misread, or the sector is not what it looks like, and both
        # are findings. Rewriting the sign to match would turn a refutation into a discovery.
        verdict = "contradicted"
        reason = (f"the response is real (t={t:.2f}) but runs OPPOSITE to the declared direction. The "
                  f"sign is not adjusted to fit: a claim that fails is a claim that failed")

    return {
        "ok": True,
        "verdict": verdict,
        "reason": reason,
        "sign": sign, "window": window, "lag": lag,
        "alignedBars": n,
        "observations": m,
        "bucketSize": k,
        "meanForwardAfterRise": mean_high,
        "meanForwardAfterFall": mean_low,
        "unconditionalMean": _mean(all_fwd),
        "response": response,
        "tStat": t,
        "directionMatches": direction_matches,
        "firstDate": dates[0], "lastDate": dates[-1],
        "sampling": (f"non-overlapping: stepped by the {lag}-day lag, so no two forward windows share a "
                     f"bar. {m} independent samples from {n} aligned bars."),
    }


def measure_all(series_loader, *, only: Optional[list] = None) -> dict:
    """
    Every declared link, measured, with the multiple-comparison cost stated.

    `series_loader(key)` returns `[(date, close), ...]` for a macro key or a sector key, or None.

    THE COUNT IS REPORTED BECAUSE IT HAS TO BE. Testing many links means some clear t=2 by chance. The
    signs here are PRE-REGISTERED, so each is a one-sided test and the expected number of false
    positives is about 2.5% of the links tested rather than 5% — better, but not zero, and the number is
    printed rather than left for master to work out.
    """
    rows = []
    missing = []
    for ex in EXPOSURES:
        if only and ex["id"] not in only:
            continue
        iv = series_loader(ex["input"])
        tv = series_loader(ex["target"])
        if not iv or not tv:
            missing.append({"id": ex["id"],
                            "why": f"no stored series for "
                                   f"{ex['input'] if not iv else ''}{' and ' if not iv and not tv else ''}"
                                   f"{ex['target'] if not tv else ''}".strip()})
            continue
        m = measure_link(iv, tv, sign=ex["sign"], window=ex["window"], lag=ex["lag"])
        rows.append({**{k: ex[k] for k in ("id", "input", "target", "role", "sign", "chain")},
                     "ambiguous": ex.get("ambiguous"),
                     "expect": ex.get("expect"),
                     "measurement": m,
                     # Only a surviving link is measured evidence. Everything else stays an assertion.
                     "evidence": "measured" if m.get("verdict") == "supported" else "asserted"})

    tested = len(rows)
    supported = [r for r in rows if r["measurement"].get("verdict") == "supported"]
    contradicted = [r for r in rows if r["measurement"].get("verdict") == "contradicted"]

    controls = {r["id"]: r["measurement"].get("verdict") for r in rows if r["role"] == CONTROL}
    control_notes = []
    for ex in EXPOSURES:
        if ex["role"] != CONTROL or ex["id"] not in controls:
            continue
        got, want = controls[ex["id"]], ex["expect"]
        if got != want:
            control_notes.append(
                f"CONTROL FAILED: {ex['id']} was expected to measure '{want}' and measured '{got}'. "
                + ("A positive control that does not register means the measurement itself is broken, "
                   "and no other result here should be believed."
                   if want == "supported" else
                   "A negative control that registers means the method is producing spurious findings, "
                   "so every supported link above is suspect."))

    return {
        "linksTested": tested,
        "supported": len(supported),
        "contradicted": len(contradicted),
        "missingSeries": missing,
        "rows": rows,
        "controls": controls,
        # Reported rather than assumed clean: a control is only worth running if its failure is loud.
        "controlWarnings": control_notes,
        "multipleComparisons": (
            f"{tested} links tested. Each sign and lag was declared BEFORE measurement, so these are "
            f"one-sided pre-registered tests and roughly {tested * 0.025:.1f} of them would be expected "
            f"to clear t={T_THRESHOLD} by chance alone. Treat a single supported link with that in mind; "
            f"a link is worth more when its mechanism was stated first, which is why the chain is "
            f"recorded beside every one."),
        "note": ("A supported link says the sector HAS responded to the input at this lag over this "
                 "history. It does not say it will continue to, and it is not a signal on its own — "
                 "it is an exposure."),
    }


# ── News: what it adds, and what it does not ──────────────────────────────────

def persistence_hint(events: Optional[list] = None) -> dict:
    """
    What news adds to a macro move: not the price, but whether the cause is likely to PERSIST.

    Master: *"in combo with news gives more clarity about fall/rise of index or stock and their
    derivatives."* Exactly right, and the reason is specific. The price series says crude rose 12%. It
    cannot say whether that was a supply disruption, which persists, or a positioning unwind, which does
    not. Master's own chain turns on this: *"if persisting more time causes stockholders to jitter."*

    WHAT IS HONEST TODAY: `news.EVENT_PATTERNS` already carries a `macro` pattern (tariff, crude, repo,
    fed, fomc, budget, monsoon, rupee, bond yield), and GDELT gives roughly nine years of tone and
    volume. So the CLASSIFICATION exists. What does not exist is any measurement that a
    supply-disruption headline predicts a longer-lived move than a demand headline — that needs the
    event history joined to the price history, and it has never been run.

    So this returns a classification and marks it `measured: False`. A persistence estimate presented as
    measured would be the "emitted as if grounded" failure Section 111 exists to prevent.
    """
    supply_words = ("blocked", "sanction", "embargo", "outage", "strike", "war", "attack", "disruption",
                    "shutdown", "hurricane", "opec", "cut", "ban", "export curb", "shortage")
    demand_words = ("demand", "slowdown", "recession", "inventory", "stockpile", "forecast", "revision")
    out = {"classified": [], "measured": False,
           "note": ("Classification only. Whether a supply-driven move actually persists longer than a "
                    "demand-driven one has NOT been measured against price history, so this must not be "
                    "presented as a persistence estimate."),
           "toMeasure": ("join macro event dates to the input series and test whether the input's move "
                         "decays more slowly after supply-classified events. That is a measurable claim "
                         "and it is the next thing to run once the series are stored.")}
    for e in (events or []):
        text = f"{(e or {}).get('title') or ''} {(e or {}).get('summary') or ''}".lower()
        if not text.strip():
            continue
        hits_supply = [w for w in supply_words if w in text]
        hits_demand = [w for w in demand_words if w in text]
        out["classified"].append({
            "title": (e or {}).get("title"),
            "kind": ("supply" if hits_supply and not hits_demand else
                     "demand" if hits_demand and not hits_supply else
                     "mixed" if hits_supply and hits_demand else "unclassified"),
            "matched": hits_supply + hits_demand,
        })
    return out


# ── Fetch and store: the existing path, nothing new ───────────────────────────

def sync(keys: Optional[list] = None, years: int = 12) -> dict:
    """
    Fetch and store the macro and sector series through the provider chain already in use.

    Stored under the `MACRO` exchange so a macro series can never collide with one of master's own
    instruments, and read back with the ordinary `store.load`. No second persistence path exists.

    Reports per series whether it RESOLVED. A ticker written into `SERIES` is not a ticker that works,
    and "no data" must stay distinguishable from "never fetched".
    """
    from engine import providers, store

    wanted = keys or (list(SERIES) + list(SECTORS))
    out = {"fetched": [], "failed": [], "years": years}
    for key in wanted:
        meta = SERIES.get(key) or SECTORS.get(key)
        if not meta:
            out["failed"].append({"key": key, "why": "not a declared macro or sector series"})
            continue
        try:
            df, source = providers.fetch_history(meta["ticker"], MACRO_EXCHANGE, years, "1d")
            if df is None or len(df) == 0:
                out["failed"].append({"key": key, "ticker": meta["ticker"],
                                      "why": "every provider declined; the ticker may not resolve"})
                continue
            store.merge(key, df, MACRO_EXCHANGE, "1d", source=source)
            out["fetched"].append({"key": key, "ticker": meta["ticker"], "bars": len(df),
                                   "source": source})
        except Exception as e:
            out["failed"].append({"key": key, "ticker": meta["ticker"], "why": f"{type(e).__name__}: {e}"})
    return out


def load_series(key: str) -> Optional[list]:
    """`[(date, close), ...]` for one macro or sector key, or None when nothing is stored."""
    from engine import store

    df = store.load(key, MACRO_EXCHANGE, "1d")
    if df is None or len(df) == 0:
        return None
    return [(str(d)[:10], float(c)) for d, c in zip(df["date"], df["close"])
            if c is not None and float(c) > 0]


def registry() -> dict:
    """What Rāma can measure, what it cannot, and why — for the UI and for a cold session."""
    return {
        "series": [{"key": k, **v, "unverified": True} for k, v in SERIES.items()],
        "sectors": [{"key": k, **v, "unverified": True} for k, v in SECTORS.items()],
        "exposures": [{k: ex.get(k) for k in
                       ("id", "input", "target", "role", "sign", "chain", "window", "lag",
                        "ambiguous", "expect", "note")} for ex in EXPOSURES],
        "noFreeSeries": [{"input": k, "why": v} for k, v in NO_FREE_SERIES.items()],
        "roles": {CONSUMER: "the input is a cost", PRODUCER: "the input is revenue",
                  FLOW: "transmits through capital flows or discount rates",
                  CONTROL: "included to test the method, never to trade"},
        "method": {
            "preRegistered": ("Every sign and lag is declared before measurement. A link measuring the "
                              "opposite way is reported as CONTRADICTED and never flipped."),
            "sampling": ("Non-overlapping: stepped by the lag, so no two forward windows share a bar. "
                         "Costs sample size, buys a t-statistic that means what it says."),
            "buckets": f"Terciles of the {int(BUCKET_FRAC * 100)}% largest input moves over the window, "
                       f"rises against falls.",
            "thresholds": {"minObservations": MIN_OBSERVATIONS, "minPerBucket": MIN_PER_BUCKET,
                           "tStat": T_THRESHOLD},
            "controls": ("One positive control (VIX against the index, which must register) and one "
                         "negative control (gold against IT, which must not). A control failure "
                         "invalidates every other result rather than being noted and ignored."),
        },
        "purpose": ("Master: 'corporates have their algos and setup but our setup is to level the field "
                    "for retail traders.' A commodity-to-sector exposure map with measured lags is what "
                    "an institutional desk has and a retail trader does not — and it is buildable from "
                    "free data, which is why it comes before any paid feed."),
        "limits": [
            "Index level only. A sector index averages companies with opposite exposures, which is why "
            "crude against Nifty Energy is marked ambiguous. Stock-level exposure needs a constituent "
            "map that does not exist yet.",
            "An exposure is not a signal. It says what a sector has responded to, not what to do.",
            "News classification exists; a measured persistence estimate does not.",
        ],
    }
