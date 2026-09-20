"""
charge_watch.py — Rāma notices when trading charges change, and proposes rather than rewrites.

Master: *"Rama should have the ability to fetch latest charges info based on any news of price changes.
not every day or some thing like that."*

WHY A TRIGGER AND NOT A SCHEDULE. Indian trading charges move at a Union Budget, a SEBI circular or an
exchange circular — a handful of times a decade, on dates nobody can predict. A daily poll is a thousand
pointless requests a year and still misses the day it matters if the fetch fails. An event trigger looks
exactly when there is a reason to. Master is right, and `refreshScheduler`'s interval registry is the
wrong tool for this one thing.

THE RULE THAT MATTERS MOST: A HEADLINE NEVER REWRITES A RATE.

Three independent reasons, and the third is the one that would corrupt data silently:

  1. Headlines are wrong, and rounded. "STT doubled" is not a rate.
  2. Most charge news is a PROPOSAL. A Budget speech in February is not law, and several announced
     changes have been amended before taking effect. Acting on the announcement means being wrong for
     six weeks and confident throughout.
  3. **THE ANNOUNCEMENT DATE IS NOT THE EFFECTIVE DATE.** Budget 2026 was presented in February and its
     rates took effect on 1 April 2026. A rate written into the table on the announcement date would be
     applied to six weeks of trades that were charged the OLD rate — silently making every backtest over
     that window wrong, in the flattering direction for shorts and the punishing direction for longs.
     `costs.RATE_HISTORY` is keyed by effective date precisely so this cannot happen.

So the flow is: **news detects → Rāma fetches the authoritative pages → a PROPOSAL is produced → master
approves.** `propose()` returns `applied: False` always, and there is no code path here that writes a
rate. The same discipline as `dependencyAdvisor`, which proposes and never upgrades (I12).

THE BACKSTOP, because a trigger can miss. If no headline ever matches, or the news fetch fails, nothing
fires and the table silently ages. So `costs.staleness()` remains the second line: past a budget cycle it
says so regardless of whether any news arrived. A trigger with no backstop means "we only look when a
headline happens to match our word list", which is not the same as looking.

STDLIB ONLY for the detection and the proposal. The fetch half is injected, so the decision logic is
testable with no network — and so that what Rāma *concludes* from a page can be tested separately from
whether it could reach it.
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import Callable, Optional

try:                                    # pragma: no cover - import shape, not logic
    from engine import costs as _costs
except Exception:                       # pragma: no cover
    try:
        import costs as _costs
    except Exception:
        _costs = None


# ── What counts as a charge-change signal ─────────────────────────────────────
#
# Deliberately NARROW. A word list that fires on every market story would make the trigger a schedule
# with extra steps, and a trigger that fires constantly gets ignored — the "alarm nobody reads" failure.
# Both a CHARGE term and a CHANGE term must appear.

CHARGE_TERMS = (
    "stt", "securities transaction tax", "ctt", "commodity transaction tax",
    "transaction charge", "transaction charges", "turnover fee", "turnover charges",
    "stamp duty", "brokerage", "dp charge", "depository charge", "gst on brokerage",
    "sebi fee", "exchange charges", "ipft", "investor protection fund",
)

CHANGE_TERMS = (
    "raise", "raised", "raises", "raising",
    "hike", "hiked", "hikes", "hiking",
    "increase", "increased", "increases", "increasing",
    "cut", "cuts", "cutting",
    "reduce", "reduced", "reduces", "reducing",
    "revise", "revised", "revises", "revising", "revision",
    "slash", "slashed", "double", "doubled", "doubling", "halve", "halved", "halving",
    "change", "changed", "changes", "new rate", "rate change",
    "effective from", "with effect from", "w.e.f",
    "levy", "levied", "levying", "abolish", "abolished", "waive", "waived", "waiver",
    # THE ANNOUNCEMENT FORMS MATTER MOST, and they were the ones missing. "Budget PROPOSES RAISING STT"
    # is the exact shape of the case this module exists for — a change that is not yet law and must not
    # be applied — and it matched nothing until these were added. Found by running.
    "propose", "proposes", "proposed", "proposal", "announce", "announces", "announced",
)

# A charge change practically always arrives through one of these. Named so a match can be reported as
# what it is — a Budget line is stronger evidence than a market commentary piece.
AUTHORITY_TERMS = {
    "budget": "Union Budget",
    "finance bill": "Finance Bill",
    "finance act": "Finance Act",
    "sebi": "SEBI circular",
    "circular": "circular",
    "nse": "exchange notice",
    "bse": "exchange notice",
    "cbdt": "CBDT notification",
    "notification": "notification",
    "gazette": "Gazette notification",
}

# Where the authoritative numbers actually live. A proposal carries these so master is never asked to
# trust a headline.
VERIFY_SOURCES = (
    "https://zerodha.com/charges/",
    "https://www.nseindia.com/regulations/exchange-communication-circulars",
    "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0",
    "https://incometaxindia.gov.in/pages/acts/securities-transaction-tax.aspx",
    "master's own contract note, which is the only authority that describes HIS charges",
)

# `0.15%`, `0.1 %`, `15 bps`. Captured to show master what the article claimed, NEVER to write a rate.
_PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|per\s?cent|percent)", re.I)
_BPS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:bps|basis\s+points)", re.I)

# "effective from 1 April 2026", "with effect from 01-04-2026", "from April 1, 2026".
_MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august",
           "september", "october", "november", "december")
_EFF_ISO = re.compile(r"(?:effective|with effect|w\.e\.f\.?|applicable)\D{0,20}"
                      r"(\d{4})-(\d{2})-(\d{2})", re.I)
_EFF_DMY = re.compile(r"(?:effective|with effect|w\.e\.f\.?|applicable|from)\D{0,20}"
                      r"(\d{1,2})\D{0,3}(" + "|".join(_MONTHS) + r")\D{0,3}(\d{4})", re.I)
_EFF_MDY = re.compile(r"(?:effective|with effect|w\.e\.f\.?|applicable|from)\D{0,20}"
                      r"(" + "|".join(_MONTHS) + r")\D{0,3}(\d{1,2})\D{0,4}(\d{4})", re.I)


def _text_of(item: dict) -> str:
    return f"{(item or {}).get('title') or ''} {(item or {}).get('summary') or ''}".strip()


def effective_date(text: str) -> Optional[str]:
    """
    The date a change TAKES EFFECT, as stated in the text. `None` when the text does not say.

    `None` is the important return. A change with no stated effective date must NOT default to today —
    that is the announcement-versus-effective confusion this module exists to prevent, and defaulting
    would apply a rate to trades that were never charged it.
    """
    t = str(text or "")
    m = _EFF_ISO.search(t)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = _EFF_DMY.search(t)
    if m:
        return f"{int(m.group(3)):04d}-{_MONTHS.index(m.group(2).lower()) + 1:02d}-{int(m.group(1)):02d}"
    m = _EFF_MDY.search(t)
    if m:
        return f"{int(m.group(3)):04d}-{_MONTHS.index(m.group(1).lower()) + 1:02d}-{int(m.group(2)):02d}"
    return None


def classify(item: dict) -> dict:
    """
    Is one news item a charge-change signal?

    @returns `{isSignal, charge[], change[], authority, claimedRates[], effectiveFrom, confidenceWords}`
             — words, never a score. A number attached to a sentence is the failure Section 111 named.
    """
    text = _text_of(item)
    low = text.lower()
    out = {"title": (item or {}).get("title"), "isSignal": False, "charge": [], "change": [],
           "authority": None, "claimedRates": [], "effectiveFrom": None, "why": None}
    if not low:
        out["why"] = "no text to read"
        return out

    # Word boundaries, or "stt" matches inside unrelated words and "cut" inside "circuit".
    out["charge"] = [t for t in CHARGE_TERMS if re.search(rf"\b{re.escape(t)}\b", low)]
    out["change"] = [t for t in CHANGE_TERMS if re.search(rf"\b{re.escape(t)}\b", low)]

    for key, label in AUTHORITY_TERMS.items():
        if re.search(rf"\b{re.escape(key)}\b", low):
            out["authority"] = label
            break

    # BOTH halves required. "STT explained" is not a change and "SEBI raises concerns" is not a charge.
    if not out["charge"]:
        out["why"] = "names no charge, so a change in it cannot be what this is about"
        return out
    if not out["change"]:
        out["why"] = "names a charge but reports no change to it"
        return out

    out["claimedRates"] = ([f"{v}%" for v in _PCT_RE.findall(text)]
                           + [f"{v}bps" for v in _BPS_RE.findall(text)])
    out["effectiveFrom"] = effective_date(text)
    out["isSignal"] = True
    out["why"] = (f"names {out['charge'][0]} and reports a change"
                  + (f", per a {out['authority']}" if out["authority"] else
                     " — but no Budget, circular or notification is named, so this may be commentary "
                     "rather than an actual change"))
    return out


def scan(items: Optional[list] = None) -> dict:
    """
    Which of these news items, if any, mean the charge table should be re-checked.

    NOTHING FIRES ON AN EMPTY LIST, and that is reported as "nothing found" rather than "all clear" —
    an empty news fetch and a quiet week look identical from here and mean opposite things.
    """
    rows = [classify(i) for i in (items or [])]
    signals = [r for r in rows if r["isSignal"]]
    authoritative = [r for r in signals if r["authority"]]
    return {
        "scanned": len(rows),
        "signals": signals,
        "shouldRefetch": len(signals) > 0,
        "authoritativeSignals": len(authoritative),
        "note": ("Nothing scanned, so this is 'nothing was read' and not 'no change happened'."
                 if not rows else
                 f"{len(signals)} of {len(rows)} items name a charge AND a change to it."
                 + ("" if authoritative else
                    " None cites a Budget, circular or notification, so treat them as commentary until "
                    "an authority is found.")),
    }


def propose(signals: list, fetch_text: Optional[Callable[[str], str]] = None,
            today: Optional[_dt.date] = None) -> dict:
    """
    Turn charge-change signals into a PROPOSAL master approves or rejects. Never an applied change.

    `fetch_text(url)` is injected so the decision logic is testable with no network. When it is absent,
    the proposal still carries everything master needs to check by hand — which is the useful half, and
    it is the half that works offline.

    @returns a dict whose `applied` is **always False**. There is no code path in this module that writes
             a rate: `costs.RATE_HISTORY` is source, reviewed in git, and a master-approved addition is a
             separate, dated, attributed entry — never an in-place edit of a shipped one.
    """
    d = today or _dt.date.today()
    sigs = [s for s in (signals or []) if s.get("isSignal")]
    current = _costs.rates_on(None) if _costs else {}
    fetched = []
    fetch_errors = []

    if fetch_text:
        for url in VERIFY_SOURCES:
            if not str(url).startswith("http"):
                continue
            try:
                body = fetch_text(url)
                fetched.append({"url": url, "bytes": len(body or ""),
                                "claimedRates": [f"{v}%" for v in _PCT_RE.findall(body or "")][:20]})
            except Exception as e:
                # Recorded, not swallowed. A page that could not be read is not a page that agrees.
                fetch_errors.append({"url": url, "why": f"{type(e).__name__}: {e}"})

    # The effective dates the articles themselves stated. A signal with none is the dangerous case.
    dated = [s for s in sigs if s.get("effectiveFrom")]
    undated = [s for s in sigs if not s.get("effectiveFrom")]
    future = [s for s in dated if s["effectiveFrom"] > d.isoformat()]

    actions = []
    if not sigs:
        actions.append("Nothing to do: no item named both a charge and a change to it.")
    else:
        actions.append(f"Re-read {len(VERIFY_SOURCES)} authoritative sources and compare against the "
                       f"rates in force from {current.get('resolvedFrom', 'unknown')}.")
        if future:
            actions.append(
                f"{len(future)} change(s) take effect in the FUTURE "
                f"({', '.join(sorted({s['effectiveFrom'] for s in future}))}). Add them to "
                f"RATE_HISTORY keyed by that date — do NOT apply them now, or every trade between "
                f"today and then is priced at a rate it was never charged.")
        if undated:
            actions.append(
                f"{len(undated)} signal(s) state no effective date. **These must not be applied at "
                f"all** until one is found: a Budget announcement is not law, and the gap between "
                f"announcement and effect has been six weeks or more.")
        actions.append("A new RATE_HISTORY entry is COMPLETE, not a partial overlay, and carries its "
                       "source. Master approves; Rāma does not write rates.")

    return {
        "applied": False,
        "proposedAt": d.isoformat(),
        "signals": sigs,
        "signalCount": len(sigs),
        "withEffectiveDate": len(dated),
        "withoutEffectiveDate": len(undated),
        "takingEffectLater": [s["effectiveFrom"] for s in future],
        "currentRatesFrom": current.get("resolvedFrom"),
        "verifySources": list(VERIFY_SOURCES),
        "fetched": fetched,
        "fetchErrors": fetch_errors,
        "actions": actions,
        "staleness": _costs.staleness(d) if _costs else None,
        "guarantee": ("Rāma does not rewrite a charge rate from a news article. This is a proposal: it "
                      "names what changed, where to verify it, and the date it takes effect. Master "
                      "approves the change, and it is recorded as a new dated entry with its source."),
    }


def registry() -> dict:
    """What triggers a re-check, what it will never do on its own, and the backstop if nothing fires."""
    return {
        "trigger": "news, not a schedule",
        "why": ("Charges move at a Budget or a circular, a handful of times a decade, on dates nobody "
                "can predict. A daily poll is a thousand pointless requests a year and still misses the "
                "day it matters if the fetch fails."),
        "requires": "both a charge term and a change term in the same item",
        "chargeTerms": list(CHARGE_TERMS),
        "changeTerms": list(CHANGE_TERMS),
        "authorities": sorted(set(AUTHORITY_TERMS.values())),
        "verifySources": list(VERIFY_SOURCES),
        "neverDoes": [
            "write a rate from a headline",
            "treat an announcement date as an effective date",
            "apply a change with no stated effective date",
            "edit a shipped RATE_HISTORY entry in place",
        ],
        "backstop": ("A trigger can miss: no headline may match, or the news fetch may fail. So "
                     "costs.staleness() remains the second line and reports the table's age regardless "
                     "of whether any news arrived. A trigger with no backstop means 'we only look when a "
                     "headline happens to match our word list', which is not the same as looking."),
    }
