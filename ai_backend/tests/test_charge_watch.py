"""
test_charge_watch.py — news triggers a charge re-check, and never a rewrite (Section 116).

Master: *"Rama should have the ability to fetch latest charges info based on any news of price changes.
not every day or some thing like that."*

Three groups of assertion, in order of how much damage their absence would do:

  1. A HEADLINE NEVER WRITES A RATE. `applied` is False on every path, and no announcement is treated as
     an effective date.
  2. DATED RATES. A trade is priced at the rates in force when it happened, not today's, and a period the
     table cannot source is flagged unverified rather than priced silently.
  3. The trigger is narrow enough to mean something — a word list that fires on every market story is a
     schedule with extra steps.

Run from `ai_backend/`:  py -m tests.test_charge_watch
"""

import datetime as dt
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "engine"))
import charge_watch as W   # noqa: E402
import costs as C          # noqa: E402

_pass = 0
_fail = 0


def check(label, ok, detail=""):
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {label}")
    else:
        _fail += 1
        print(f"  FAIL  {label}{(' - ' + str(detail)) if detail else ''}")


print("\ncharge watch - news triggers a re-check, never a rewrite\n")

# ── Dated rates ───────────────────────────────────────────────────────────────
print("  a trade is priced at the rates in force when it happened")
check("the history is ordered oldest first",
      [e["from"] for e in C.RATE_HISTORY] == sorted(e["from"] for e in C.RATE_HISTORY))
check("every entry carries its source", all(len(e["source"]) > 40 for e in C.RATE_HISTORY))
check("every entry is COMPLETE, not a partial overlay",
      all({"stt", "exchangeTxn", "stampDuty", "ipft", "sebiTurnoverPct", "gstPct",
           "dpChargeInr"}.issubset(e) for e in C.RATE_HISTORY))
check("and covers every instrument", all(set(e["stt"]) == set(C.INSTRUMENTS) for e in C.RATE_HISTORY))

old = C.rates_on("2025-06-01")
new = C.rates_on("2026-06-01")
check("a 2025 date resolves to the 2024 rates", old["resolvedFrom"] == "2024-10-01")
check("a 2026 date resolves to the Budget-2026 rates", new["resolvedFrom"] == "2026-04-01")
check("options STT was 0.10% of premium before April 2026", old["stt"][C.OPTIONS]["pct"] == 0.10)
check("and is 0.15% after", new["stt"][C.OPTIONS]["pct"] == 0.15)
check("futures STT was 0.02% before", old["stt"][C.FUTURES]["pct"] == 0.02)
check("and is 0.05% after", new["stt"][C.FUTURES]["pct"] == 0.05)
check("no date means the latest rates", C.rates_on(None)["resolvedFrom"] == C.RATE_HISTORY[-1]["from"])
check("the boundary date itself takes the NEW rates",
      C.rates_on("2026-04-01")["resolvedFrom"] == "2026-04-01")
check("the day before takes the old ones",
      C.rates_on("2026-03-31")["resolvedFrom"] == "2024-10-01")
check("the module constants alias the newest entry, so there is one place a rate is written",
      C.STT is C.RATE_HISTORY[-1]["stt"] and C.GST_PCT == C.RATE_HISTORY[-1]["gstPct"])

print("\n  a period the table cannot vouch for is flagged, not silently priced")
pre = C.rates_on("2019-01-01")
check("a pre-2024 date is marked as an unknown era", pre["unknownEra"] is True)
check("it still returns usable rates rather than nothing", pre["stt"][C.OPTIONS]["pct"] > 0)
check("but says which rates it fell back to", pre["resolvedFrom"] == C.EARLIEST_KNOWN)
check("and warns that they are very likely wrong for that period",
      "very likely wrong" in pre["warning"], pre["warning"])
check("and says to treat the figure as unverified rather than measured",
      "unverified rather than measured" in pre["warning"])
check("a date inside the known range is not flagged", new["unknownEra"] is False)

print("\n  the same trade costs different amounts in different years")
o = C.order_charges(C.OPTIONS, "sell", 200.0, 75, on_date="2025-06-01")
n = C.order_charges(C.OPTIONS, "sell", 200.0, 75, on_date="2026-06-01")
check("options STT on 15,000 premium was 15.00 in 2025", abs(o["stt"] - 15.0) < 0.01, o["stt"])
check("and is 22.50 in 2026", abs(n["stt"] - 22.5) < 0.01, n["stt"])
check("so the 2026 charge is higher", n["total"] > o["total"])
check("each result names the rate era that priced it", o["ratesFrom"] == "2024-10-01")
check("BACKTESTING 2025 AT 2026 RATES OVERSTATED THE COST BY 50% ON STT",
      abs((n["stt"] / o["stt"]) - 1.5) < 0.01)
f25 = C.order_charges(C.FUTURES, "sell", 25000.0, 75, on_date="2025-06-01")
f26 = C.order_charges(C.FUTURES, "sell", 25000.0, 75, on_date="2026-06-01")
check("futures STT went from 375.00 to 937.50 on the same contract",
      abs(f25["stt"] - 375.0) < 0.01 and abs(f26["stt"] - 937.5) < 0.01, (f25["stt"], f26["stt"]))
check("which is two and a half times, so a dated table is not a nicety",
      abs((f26["stt"] / f25["stt"]) - 2.5) < 0.01)

print("\n  a trade held across a rate change pays both rates")
span = C.round_trip_charges(C.FUTURES, 25000.0, 25500.0, 75,
                            entry_date="2026-03-25", exit_date="2026-04-10")
check("the two legs resolve to different eras", span["ratesChangedMidTrade"] is True)
check("entry at the old rates", span["ratesFrom"]["entry"] == "2024-10-01")
check("exit at the new ones", span["ratesFrom"]["exit"] == "2026-04-01")
check("the exit-side STT is the NEW rate, which is what actually happened",
      abs(span["exit"]["stt"] - (25500.0 * 75 * 0.0005)) < 0.01, span["exit"]["stt"])
inside = C.round_trip_charges(C.FUTURES, 25000.0, 25500.0, 75,
                              entry_date="2026-05-01", exit_date="2026-05-10")
check("a trade wholly inside one era is not flagged", inside["ratesChangedMidTrade"] is False)
check("pricing both legs at entry would have understated the spanning trade",
      span["total"] > C.round_trip_charges(C.FUTURES, 25000.0, 25500.0, 75,
                                           entry_date="2026-03-25",
                                           exit_date="2026-03-26")["total"])
check("an exit date alone defaults to the entry date rather than to today",
      C.round_trip_charges(C.FUTURES, 25000.0, 25000.0, 75,
                           entry_date="2025-01-01")["ratesFrom"]["exit"] == "2024-10-01")
check("no dates at all still works, at current rates",
      C.round_trip_charges(C.FUTURES, 25000.0, 25000.0, 75)["ratesFrom"]["entry"] == "2026-04-01")

# ── The trigger is narrow ─────────────────────────────────────────────────────
print("\n  the trigger fires on a charge change and not on market noise")
sig = W.classify({"title": "Budget 2026 raises STT on futures to 0.05% with effect from 1 April 2026"})
check("a real charge change is a signal", sig["isSignal"] is True, sig["why"])
check("it names the charge it found", "stt" in sig["charge"])
check("and the change word", any(c in ("raises", "raise") for c in sig["change"]), sig["change"])
check("and recognises the Budget as an authority", sig["authority"] == "Union Budget")
check("it captures what the article CLAIMED, without acting on it", "0.05%" in sig["claimedRates"])
check("and the effective date the article stated", sig["effectiveFrom"] == "2026-04-01")

check("a charge mentioned with no change is NOT a signal",
      W.classify({"title": "What is STT? A guide to securities transaction tax"})["isSignal"] is False)
check("and says it reports no change",
      "no change" in W.classify({"title": "STT explained for beginners"})["why"])
check("a change with no charge named is NOT a signal",
      W.classify({"title": "SEBI raises concerns over derivatives volumes"})["isSignal"] is False)
check("and says it names no charge",
      "names no charge" in W.classify({"title": "RBI raises repo rate"})["why"])
check("ordinary market news does not fire",
      W.classify({"title": "Nifty closes higher as IT stocks rally"})["isSignal"] is False)
check("an empty item does not fire", W.classify({})["isSignal"] is False)
check("and says there was nothing to read", W.classify({})["why"] == "no text to read")
check("None does not throw", W.classify(None)["isSignal"] is False)
check("'stt' does not match inside an unrelated word",
      W.classify({"title": "Bharat Petroleum cuts output"})["isSignal"] is False)
check("'cut' does not match inside 'circuit'",
      W.classify({"title": "Stock hits upper circuit"})["isSignal"] is False)
check("commentary without an authority is flagged as possibly not a real change",
      "may be commentary" in W.classify(
          {"title": "Traders say STT hike has reduced volumes"})["why"])

print("\n  effective dates are read in the forms articles actually use")
check("ISO", W.effective_date("effective 2026-04-01") == "2026-04-01")
check("day month year", W.effective_date("with effect from 1 April 2026") == "2026-04-01")
check("month day year", W.effective_date("applicable from April 1, 2026") == "2026-04-01")
check("w.e.f.", W.effective_date("w.e.f. 01 October 2024") == "2024-10-01")
check("AND None WHEN THE TEXT DOES NOT SAY - never today's date",
      W.effective_date("STT on options has been raised to 0.15%") is None)
check("an empty string is None", W.effective_date("") is None)

# ── The rule that matters most ────────────────────────────────────────────────
print("\n  A HEADLINE NEVER WRITES A RATE")
announced = W.classify({"title": "Budget proposes raising STT on options to 0.2%"})
p = W.propose([announced], today=dt.date(2026, 2, 5))
check("a proposal is produced", p["signalCount"] == 1)
check("APPLIED IS FALSE", p["applied"] is False)
check("the signal had no effective date", p["withoutEffectiveDate"] == 1)
check("and the action says it must NOT be applied at all until one is found",
      any("must not be applied" in a.lower() for a in p["actions"]), p["actions"])
check("naming the announcement-to-effect gap as the reason",
      any("announcement is not law" in a for a in p["actions"]))
check("the rates in force are named, so master can see what would change",
      p["currentRatesFrom"] == "2026-04-01")
check("authoritative sources to check are listed", len(p["verifySources"]) >= 4)
check("including master's own contract note",
      any("contract note" in s for s in p["verifySources"]))
check("the guarantee is stated in words, not implied",
      "does not rewrite a charge rate from a news article" in p["guarantee"])
check("an empty signal list proposes nothing to do",
      any("Nothing to do" in a for a in W.propose([])["actions"]))
check("and still reports applied false", W.propose([])["applied"] is False)
check("a non-signal passed in is filtered out rather than acted on",
      W.propose([{"isSignal": False, "title": "x"}])["signalCount"] == 0)

print("\n  a FUTURE effective date is added forward, not applied now")
future = W.classify({"title": "SEBI circular: transaction charges revised with effect from 1 July 2027"})
pf = W.propose([future], today=dt.date(2026, 9, 20))
check("the future date is recognised", pf["takingEffectLater"] == ["2027-07-01"])
check("and the action says to key it by that date", any("keyed by that date" in a for a in pf["actions"]))
check("and NOT to apply it now", any("do NOT apply them now" in a for a in pf["actions"]))
check("naming the harm: trades priced at a rate they were never charged",
      any("never charged" in a for a in pf["actions"]))
check("still not applied", pf["applied"] is False)

print("\n  a new entry is added, never an edit in place")
check("editing a shipped entry is listed as something it never does",
      any("in place" in n for n in W.registry()["neverDoes"]))
check("nor writing a rate from a headline",
      any("from a headline" in n for n in W.registry()["neverDoes"]))
check("nor treating an announcement as an effective date",
      any("announcement date" in n for n in W.registry()["neverDoes"]))

# ── Fetch is injected and its failures are kept ───────────────────────────────
print("\n  fetching is injected, so a failure is recorded rather than swallowed")
pf2 = W.propose([announced], fetch_text=lambda url: "STT is 0.15% on premium", today=dt.date(2026, 5, 1))
check("a fetched page is recorded with what it claimed", len(pf2["fetched"]) >= 4)
check("and the rates that page stated", any("0.15%" in f["claimedRates"] for f in pf2["fetched"]))
check("still not applied even with the pages in hand", pf2["applied"] is False)


def boom(url):
    raise TimeoutError("unreachable")


pe = W.propose([announced], fetch_text=boom, today=dt.date(2026, 5, 1))
check("a failed fetch is recorded, not swallowed", len(pe["fetchErrors"]) >= 4)
check("with the reason", "TimeoutError" in pe["fetchErrors"][0]["why"])
check("and nothing is marked fetched", pe["fetched"] == [])
check("working offline still produces the useful half",
      len(W.propose([announced], today=dt.date(2026, 5, 1))["verifySources"]) >= 4)

# ── Scanning, and the backstop ────────────────────────────────────────────────
print("\n  scanning a batch, and the difference between quiet and unread")
s = W.scan([
    {"title": "Budget 2026 raises STT on futures to 0.05% effective 1 April 2026"},
    {"title": "Nifty ends flat"},
    {"title": "Traders say the STT hike has reduced volumes"},
])
check("the real change and the commentary both signal; the market story does not",
      len(s["signals"]) == 2, s["signals"])
check("it says a re-fetch is warranted", s["shouldRefetch"] is True)
check("and counts how many cite an authority", s["authoritativeSignals"] == 1)
empty = W.scan([])
check("an empty scan does not warrant a re-fetch", empty["shouldRefetch"] is False)
check("AND SAYS THAT IS 'NOTHING WAS READ', NOT 'NO CHANGE HAPPENED'",
      "not 'no change happened'" in empty["note"], empty["note"])
check("None does not throw", W.scan(None)["scanned"] == 0)
quiet = W.scan([{"title": "Nifty ends flat"}])
check("a quiet batch that WAS read says so differently",
      "of 1 items" in quiet["note"] or "0 of 1" in quiet["note"], quiet["note"])

print("\n  the backstop, because a trigger can miss")
reg = W.registry()
check("the trigger is news, not a schedule", reg["trigger"] == "news, not a schedule")
check("and the reason is that charges move a handful of times a decade",
      "handful of times a decade" in reg["why"])
check("a daily poll is named as the wrong tool", "thousand pointless requests" in reg["why"])
check("BUT STALENESS REMAINS THE SECOND LINE", "staleness()" in reg["backstop"])
check("and the failure mode is named: only looking when a word list matches",
      "which is not the same as looking" in reg["backstop"])
check("a proposal carries the staleness reading too",
      W.propose([announced], today=dt.date(2026, 5, 1))["staleness"]["asOf"] == C.TABLE_AS_OF)
check("both halves are required for a signal, and that is documented",
      "both a charge term and a change term" in reg["requires"])

print(f"\n  {_pass} passed, {_fail} failed\n")
sys.exit(1 if _fail else 0)
