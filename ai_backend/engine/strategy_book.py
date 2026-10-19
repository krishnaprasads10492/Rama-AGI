"""
strategy_book.py - strategies Rama has found, kept, kept honest, and can read out (spec Section 151.4).

THREE JOBS, one record:

  STORE     a strategy is kept with the CLAIM (what the source said) and the BASELINE (what Rama measured when
            it was stored) as separate fields that are never merged (Section 135.5), a `current` record that
            refresh updates, and the date of each.
  UPDATE    a refresh is a FORWARD TEST: the frozen spec is simulated over the bars AFTER the one it was stored
            on. Those trades happened after the parameters were fixed, so they are genuinely out of sample
            and are judged with n_trials = 1, which is the one case where that is true. Rama NEVER retires or
            deletes on its own: a decaying record is proposed for retirement and master does it.
  UTILISE   `signal_now` reads the strategy against the latest bars: in a trade (with its stop, target and
            unrealised result), conditions met on the last close (a fill would be the NEXT open), or flat. It
            reuses the simulator, so it cannot disagree with the backtest.

NO ORDER PLACEMENT, EVER (Section 95). The words "buy" and "sell" do not appear in anything this module
produces; a state describes what the rule says, not what to do.

STDLIB ONLY. The directory is passed in, so this imports no pandas and the tests never touch real data. Writes
are atomic (tmp + os.replace, retried for Windows).
"""

from __future__ import annotations

import copy
import datetime as _dt
import json
import os
import time
from typing import Optional

try:                                    # pragma: no cover - import shape, not logic
    from . import strategy_eval as _se
    from . import strategy_spec as _ss
except Exception:                       # pragma: no cover
    import strategy_eval as _se
    import strategy_spec as _ss

SCHEMA = 1
FILE = "book.json"
HISTORY_CAP = 40                        # measurements kept per strategy: bounded, newest last
MIN_FORWARD_TRADES = 10                 # below this a forward record is shown but not judged
HOLD_CONFIDENCE = 0.90                  # `holding` needs a positive forward result this unlikely to be luck
STALE_AFTER_DAYS = 1                    # the tab refreshes when the newest measurement is older than this

WATCH = "watch"                         # not enough forward trades to say anything
HOLDING = "holding"
DECAYING = "decaying"
RETIRED = "retired"                     # only ever by master's act
STATUSES = (WATCH, HOLDING, DECAYING, RETIRED)

FLAT = "flat"
CONDITIONS_MET = "conditions-met"
IN_TRADE = "in-trade"


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _dir(root: str) -> str:
    """The book's directory. Only a WRITE creates it: reading an empty book must leave the disk untouched."""
    return os.path.join(root, "_strategies")


def _path(root: str) -> str:
    return os.path.join(_dir(root), FILE)


# ── Persistence ───────────────────────────────────────────────────────────────

def _empty() -> dict:
    return {"schema": SCHEMA, "updatedAt": None, "strategies": []}


def load(root: str) -> dict:
    """The whole book. A missing file is an empty book; a CORRUPT one is reported, not silently emptied."""
    p = _path(root)
    if not os.path.exists(p):
        return _empty()
    try:
        with open(p, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:
        # Do not return an empty book here: the next save would overwrite master's strategies with nothing.
        raise BookCorrupt(f"{p} could not be read: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("strategies"), list):
        raise BookCorrupt(f"{p} is not a strategy book")
    if data.get("schema", 0) > SCHEMA:
        raise BookCorrupt(f"{p} was written by a newer version (schema {data.get('schema')})")
    return data


class BookCorrupt(Exception):
    """The file exists and cannot be trusted. Saving over it would destroy it."""


def _save(root: str, book: dict) -> None:
    book["updatedAt"] = _now_iso()
    os.makedirs(_dir(root), exist_ok=True)
    p = _path(root)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(book, fh, ensure_ascii=False, indent=2, default=str)
    last = None
    for i in range(5):
        try:
            os.replace(tmp, p)
            return
        except PermissionError as exc:           # Windows: a scanner holding the target for a moment
            last = exc
            time.sleep(0.05 * (i + 1))
    raise last if last else OSError("could not replace the book")


def _frozen(spec: dict) -> dict:
    """One variant, no sweep: what is stored is exactly what will be run, so a result ties to it."""
    s = copy.deepcopy(spec)
    s["sweep"] = {}
    return s


def strategy_id(spec: dict) -> str:
    """Identity of the FROZEN rule. A changed parameter is a different strategy, never a silent rewrite."""
    return _ss.spec_hash(_frozen(spec))


def _brief(verdict: Optional[dict]) -> Optional[dict]:
    """The figures that identify a measurement, small enough to keep a history of."""
    if not verdict:
        return None
    keys = ("trades", "win_rate", "expectancy_pct", "payoff_ratio", "profit_factor", "breakeven_win_rate",
            "max_drawdown", "passed", "deflated", "n_trials", "confidence", "per_trade_sharpe")
    return {k: verdict.get(k) for k in keys}


# ── Store ─────────────────────────────────────────────────────────────────────

def upsert_from_evolution(root: str, row: dict, *, symbol: str, exchange: str, interval: str,
                          bars: int, last_bar: str, measured_on: Optional[str] = None) -> dict:
    """
    Keep a ranked candidate. Re-evolving the SAME frozen strategy updates its baseline; a changed parameter is a
    different id and so a new record, and the old one is left exactly as it was.

    Only a row the factory ranked (`verdictClass` demonstrated or unproven) can be stored, and the class is
    stored with it, so the book can never display a candidate as more than the factory said it was.
    """
    if row.get("verdictClass") not in ("demonstrated", "unproven"):
        return {"ok": False, "reason": f"{row.get('id')} was not ranked ({row.get('verdictClass')}), so it is not kept"}
    spec = row.get("stored")
    if not spec:
        return {"ok": False, "reason": "the candidate carries no parameters to keep"}

    book = load(root)
    sid = strategy_id(spec)
    now = measured_on or _now_iso()
    m = row.get("measurement") or {}
    entry = next((e for e in book["strategies"] if e["id"] == sid), None)
    baseline = {
        "measuredOn": now, "lastBar": last_bar, "bars": bars,
        "outOfSample": _brief(row.get("measurement") and {
            "trades": m.get("trades"), "win_rate": m.get("hitRate"), "expectancy_pct": m.get("expectancyPct"),
            "payoff_ratio": m.get("payoffRatio"), "profit_factor": m.get("profitFactor"),
            "breakeven_win_rate": m.get("breakevenWinRate"), "max_drawdown": m.get("maxDrawdown"),
            "passed": m.get("demonstrated"), "deflated": m.get("chanceReal"), "n_trials": m.get("nTrials"),
            "confidence": m.get("confidence")}),
        "inSampleHitRate": row.get("inSampleHitRate"), "hitRateGapPoints": row.get("hitRateGapPoints"),
        "verdictClass": row["verdictClass"], "foldsPositive": row.get("foldsPositive"),
        "foldsScored": row.get("foldsScored"), "variantsTried": row.get("variantsTried"),
        "tuned": row.get("tuned"), "candidatesCompared": row.get("candidatesCompared"),
        "selectionNoiseHitRate": row.get("selectionNoiseHitRate"),
        "exceedsSelectionNoise": row.get("exceedsSelectionNoise"),
    }
    if entry is None:
        entry = {
            "id": sid, "template": row.get("template") or row.get("id"), "name": row.get("name"),
            "symbol": symbol, "exchange": exchange, "interval": interval,
            "spec": _frozen(spec),
            "claim": row.get("claim"),                    # what the source said: a hypothesis, never edited
            "baseline": baseline,                         # what was measured when stored: the "basic column"
            "current": None,                              # what refresh last found: the "updated column"
            "status": WATCH, "storedAt": now, "storedOnBar": last_bar, "updatedAt": now,
            "history": [{"at": now, "kind": "stored", "verdictClass": row["verdictClass"],
                         "outOfSample": baseline["outOfSample"]}],
            "notes": "",
        }
        book["strategies"].append(entry)
        action = "stored"
    else:
        entry["baseline"] = baseline
        entry["updatedAt"] = now
        entry["history"].append({"at": now, "kind": "re-evolved", "verdictClass": row["verdictClass"],
                                 "outOfSample": baseline["outOfSample"]})
        entry["history"] = entry["history"][-HISTORY_CAP:]
        action = "updated"
    _save(root, book)
    return {"ok": True, "id": sid, "action": action, "status": entry["status"]}


def list_all(root: str, *, include_retired: bool = False) -> list:
    book = load(root)
    out = book["strategies"]
    return out if include_retired else [e for e in out if e["status"] != RETIRED]


def get(root: str, sid: str) -> Optional[dict]:
    return next((e for e in load(root)["strategies"] if e["id"] == sid), None)


def retire(root: str, sid: str, reason: str = "") -> dict:
    """Master's act. Nothing in this module calls it on its own."""
    book = load(root)
    e = next((x for x in book["strategies"] if x["id"] == sid), None)
    if not e:
        return {"ok": False, "reason": "no such strategy"}
    e["status"] = RETIRED
    e["updatedAt"] = _now_iso()
    e["notes"] = (str(reason or "").strip()[:300] or e.get("notes", ""))
    e["history"].append({"at": e["updatedAt"], "kind": "retired", "note": e["notes"]})
    e["history"] = e["history"][-HISTORY_CAP:]
    _save(root, book)
    return {"ok": True, "id": sid, "status": RETIRED}


def restore(root: str, sid: str) -> dict:
    book = load(root)
    e = next((x for x in book["strategies"] if x["id"] == sid), None)
    if not e:
        return {"ok": False, "reason": "no such strategy"}
    e["status"] = WATCH
    e["updatedAt"] = _now_iso()
    e["history"].append({"at": e["updatedAt"], "kind": "restored"})
    _save(root, book)
    return {"ok": True, "id": sid, "status": WATCH}


def remove(root: str, sid: str) -> dict:
    """Deleting is a separate act from retiring, and only master's. A retired record is kept for the history."""
    book = load(root)
    before = len(book["strategies"])
    book["strategies"] = [x for x in book["strategies"] if x["id"] != sid]
    if len(book["strategies"]) == before:
        return {"ok": False, "reason": "no such strategy"}
    _save(root, book)
    return {"ok": True, "id": sid}


# ── Update: the forward test ──────────────────────────────────────────────────

def _index_after(bars: list, stored_on_bar: str) -> Optional[int]:
    """The first bar index strictly AFTER the bar the strategy was stored on, or None if there is none."""
    for i, b in enumerate(bars):
        if str(b.get("date") or "") > stored_on_bar:
            return i
    return None


def forward_test(entry: dict, bars: list, cost: "_se.CostModel") -> dict:
    """
    The frozen strategy over bars it could not have been fitted to.

    Trades are those OPENED strictly after the stored-on bar. Entry on the first forward bar needs a signal
    from the bar before it, which is a bar the strategy had already seen, and that is allowed: a signal is
    computed from the past by construction. What is not allowed is a trade whose entry bar is at or before the
    stored-on bar, and that is excluded here and asserted in the tests.
    """
    first = _index_after(bars, entry["storedOnBar"])
    if first is None:
        return {"ok": True, "forwardBars": 0, "trades": 0, "verdict": None, "note": "no bars newer than the one it was stored on"}
    trades = [t for t in _ss.simulate(entry["spec"], bars) if t["entryIndex"] >= first]
    verdict = _se.evaluate([t["grossPct"] for t in trades], n_trials=1, cost_model=cost, is_holdout=True,
                           provenance={"template": entry.get("template"), "procedure": "forward test, frozen parameters",
                                       "storedOnBar": entry["storedOnBar"], "forwardBars": len(bars) - first}).to_dict()
    return {"ok": True, "forwardBars": len(bars) - first, "trades": len(trades), "verdict": verdict,
            "firstForwardBar": bars[first]["date"], "lastBar": bars[-1]["date"]}


def classify(forward: dict) -> str:
    """
    watch / holding / decaying from a forward test. NEVER retired: that is master's act.

    `decaying` needs enough forward trades to mean something AND a non-positive expectancy after costs. One
    bad month is not decay, so under MIN_FORWARD_TRADES the answer is `watch` whatever the sign. `holding`
    needs more than a positive sign: a coin flip is positive half the time, so the forward probabilistic
    Sharpe must reach HOLD_CONFIDENCE, otherwise it stays `watch`.
    """
    v = forward.get("verdict")
    if not v or (v.get("trades") or 0) < MIN_FORWARD_TRADES:
        return WATCH
    exp = v.get("expectancy_pct")
    if exp is None or exp <= 0:
        return DECAYING
    conf = v.get("deflated")
    if conf is None or conf < HOLD_CONFIDENCE:
        return WATCH            # pays so far, but not distinguishable from luck: not "holding"
    return HOLDING


def refresh(root: str, sid: str, bars: list, cost: "_se.CostModel", *, measured_on: Optional[str] = None) -> dict:
    """Run the forward test for one strategy and record it. A retired strategy is not refreshed."""
    book = load(root)
    e = next((x for x in book["strategies"] if x["id"] == sid), None)
    if not e:
        return {"ok": False, "reason": "no such strategy"}
    if e["status"] == RETIRED:
        return {"ok": False, "reason": "retired", "id": sid}
    fwd = forward_test(e, bars, cost)
    now = measured_on or _now_iso()
    prior = e["status"]
    status = classify(fwd)
    e["current"] = {"measuredOn": now, "lastBar": bars[-1]["date"] if bars else None,
                    "forwardBars": fwd["forwardBars"], "forwardTrades": fwd["trades"],
                    "verdict": _brief(fwd.get("verdict")), "firstForwardBar": fwd.get("firstForwardBar")}
    e["status"] = status
    e["updatedAt"] = now
    e["history"].append({"at": now, "kind": "forward-test", "status": status, "forwardTrades": fwd["trades"],
                         "expectancyPct": (fwd.get("verdict") or {}).get("expectancy_pct")})
    e["history"] = e["history"][-HISTORY_CAP:]
    _save(root, book)
    return {"ok": True, "id": sid, "status": status, "changedFrom": prior if prior != status else None,
            "forward": {k: fwd[k] for k in ("forwardBars", "trades") if k in fwd},
            "proposeRetire": status == DECAYING}


def is_stale(entry: dict, today: Optional[_dt.date] = None) -> bool:
    """Has this strategy gone more than a day without a measurement? The tab uses it to decide to refresh."""
    at = (entry.get("current") or {}).get("measuredOn") or entry.get("storedAt")
    if not at:
        return True
    try:
        then = _dt.datetime.fromisoformat(str(at).replace("Z", "+00:00")).date()
    except Exception:
        return True
    # UTC on BOTH sides: the stamps are written in UTC, so comparing them with the machine's LOCAL date made a
    # measurement taken a minute ago read a day old for the hours when the two dates differ (found when a test
    # failed only in the evening, Section 156).
    return ((today or _dt.datetime.now(_dt.timezone.utc).date()) - then).days >= STALE_AFTER_DAYS


# ── Utilise: what the rule says right now ─────────────────────────────────────

def signal_now(entry: dict, bars: list) -> dict:
    """
    One of `in-trade`, `conditions-met`, `flat`, described. Reuses `simulate` and `entry_signals`.

    It reports the STATE OF THE RULE. It does not say to act: the vocabulary is "conditions met on the last
    close", and a fill would be the next bar's open. How old the last bar is travels with it, because a state
    read off stale bars is a state about the past.
    """
    if not bars:
        return {"state": FLAT, "reason": "no bars", "lastBar": None}
    spec = entry["spec"]
    open_list: list = []
    _ss.simulate(spec, bars, 0, None, open_list)
    last = bars[-1]
    base = {"lastBar": last["date"], "lastClose": last["close"], "side": spec["side"], "interval": spec["interval"]}

    if open_list:
        o = open_list[-1]
        # An "open" trade from the distant past (a signal long ago that never reached an exit) is not a live
        # position: the strategy would have been stopped out or timed out. It is only in a trade if the
        # entry is recent enough that a time exit has not passed.
        max_bars = int(spec["exit"].get("maxBars") or 0)
        if not max_bars or o["barsHeld"] <= max_bars:
            units = _ss.position_size(spec, o["entryPrice"])
            lot = max(1, int(spec.get("lotSize") or 1))
            return dict(base, state=IN_TRADE, entryDate=o["entryDate"], entryPrice=o["entryPrice"],
                        stopPrice=o["stopPrice"], targetPrice=o["targetPrice"], barsHeld=o["barsHeld"],
                        unrealisedPct=o["unrealisedPct"], units=units, lots=units // lot if lot > 1 else None)

    sig = _ss.entry_signals(spec, bars)
    if sig and sig[-1]:
        ref = float(last["close"])
        units = _ss.position_size(spec, ref)
        lot = max(1, int(spec.get("lotSize") or 1))
        stop = spec["exit"].get("stopPct")
        target = spec["exit"].get("targetPct")
        long_side = spec["side"] == "long"
        return dict(base, state=CONDITIONS_MET,
                    note="Conditions hold on the last close. A fill would be the NEXT bar's open, so these levels are indicative.",
                    indicativeStop=(ref * (1 - stop / 100.0) if long_side else ref * (1 + stop / 100.0)) if stop else None,
                    indicativeTarget=(ref * (1 + target / 100.0) if long_side else ref * (1 - target / 100.0)) if target else None,
                    units=units, lots=units // lot if lot > 1 else None,
                    unsized=(units <= 0))
    return dict(base, state=FLAT)
