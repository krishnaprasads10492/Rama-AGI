"""
outcomes.py — the loop that was never connected: record a prediction, resolve it, learn.

WHAT WAS MISSING (spec Section 68). `ModelRegistry.update_from_outcome` exists.
`StackingMetaLearner.update` implements a real softmax-over-EMA reweighting.
`calibration.compute_ece` and `compute_brier_score` are correct. **Nothing called any of
them.** So the meta-learner's weights stayed `np.ones(n)/n` for the life of every process
while advertising `"online_learning"`, and `/health` reported `ece: null` about a
measurement that had no route to ever being taken.

`adaptiveWeight` was a *request parameter* — the caller was asked to supply the number
that should come out of the engine's own history. That is the shape you get when learning
state cannot survive a restart, and `MODEL_REGISTRY` is an in-memory singleton in a process
`aiProcess.cjs` respawns. Adding a call would not have been enough; the state has to
persist.

A prediction is a claim with a deadline, so the loop needs three moments:

    record the claim  →  wait for the bars  →  score it, then learn

THE RESOLVER USES THE BACKTEST'S SIMULATOR, deliberately. `backtest._simulate_np` encodes
the outcome rules Section 66 settled — stop assumed first on intrabar ambiguity, TIMEOUT
marked to market, each target credited at its own level. Resolving live outcomes by
different rules would make live and backtested numbers incomparable, and comparing them is
the only way to learn whether the backtest predicts anything.
"""

import json
import logging
import os
import time
import datetime as _dt
from typing import Optional

import numpy as np
import pandas as pd

from . import store

logger = logging.getLogger("stockmind-ai.outcomes")

# Below this many resolved outcomes, a measured correction is noise with a decimal point.
MIN_SAMPLES_FOR_WEIGHT = 30
MIN_SAMPLES_FOR_CALIBRATION = 20

# Retention. Records are small; feature vectors are not, so they are pruned with them.
MAX_RECORDS = 50_000

ADAPTIVE_WEIGHT_BOUNDS = (0.5, 2.0)      # the range PredictionRequest already validates


# ── Paths ─────────────────────────────────────────────────────────────────────

def _dir() -> str:
    d = os.path.join(store.store_root(), "_outcomes")
    os.makedirs(d, exist_ok=True)
    return d


def records_path() -> str:
    return os.path.join(_dir(), "predictions.jsonl")


def features_path() -> str:
    return os.path.join(_dir(), "features.jsonl")


def meta_state_path() -> str:
    return os.path.join(_dir(), "meta-learner.json")


# ── JSONL ─────────────────────────────────────────────────────────────────────
#
# JSONL RATHER THAN THE CSV STORE, deliberately (Section 68). The store holds time series:
# one row per date, fixed columns. These are events — several per day, each with a nested
# `modelProbs` dict and a reference to a 100-float vector. Forcing that into CSV means
# either 100+ columns or JSON inside a cell, and the latter is a CSV that is not one.
#
# A torn final line is discarded on read rather than failing the whole file, because the
# process can be killed mid-append and losing the last record is recoverable while losing
# the file is not.

def _read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning(f"[outcomes] discarding a malformed line in {os.path.basename(path)}")
    except Exception as e:
        logger.warning(f"[outcomes] could not read {path}: {e}")
    return out


def _append_jsonl(path: str, rows: list[dict]) -> None:
    if not rows:
        return
    with open(path, "a", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, default=str) + "\n")


def _rewrite_jsonl(path: str, rows: list[dict], attempts: int = 5) -> None:
    """
    Atomic whole-file replace, for updates and pruning.

    RETRIES ON WINDOWS SHARING VIOLATIONS. `os.replace` raises `PermissionError`
    (WinError 5/32) when anything else holds a handle on the destination for an instant —
    an antivirus scan of the file just written is enough, and it showed up here as soon as
    several processes wrote outcome files at once. On POSIX the rename would simply succeed,
    so this is a platform difference rather than a logic error, and a brief backoff is the
    normal remedy. Failing the caller over a transient lock would lose a prediction record
    that had already been assembled.
    """
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, default=str) + "\n")
    last = None
    for i in range(max(1, attempts)):
        try:
            os.replace(tmp, path)
            return
        except PermissionError as e:
            last = e
            time.sleep(0.05 * (i + 1))
    logger.warning(f"[outcomes] could not replace {os.path.basename(path)} after "
                   f"{attempts} attempts: {last}")
    try:
        os.remove(tmp)
    except OSError:
        pass
    raise last


# ── Recording ─────────────────────────────────────────────────────────────────

def _record_key(rec: dict) -> tuple:
    """
    A claim's identity.

    ONE CLAIM PER BAR PER VARIANT. If the UI polls `/predict` every few seconds, the same
    bar yields hundreds of near-identical predictions. Recording each would count one claim
    hundreds of times, and ECE — an average over predictions — would be dominated by
    whichever bar was polled most. Deduplicating here is what makes every statistic
    computed downstream mean what it says. See Section 68.
    """
    return (rec.get("symbol"), rec.get("instrType"), rec.get("barDate"), rec.get("variant"))


def record_prediction(params: dict, signals: list[dict], ctx: dict) -> dict:
    """
    Persist the claims a `/predict` call just made.

    `ctx` carries what the signal dicts do not: the feature vector, the per-model
    probabilities, and which bar the prediction was computed on. The vector is stored ONCE
    per prediction rather than once per signal — Section 64 established that N signals are
    N geometries over one prediction, so they share it, and at 100 floats times 16 variants
    that is 1,600 stored floats where 100 will do.
    """
    if not signals:
        return {"recorded": 0, "updated": 0, "reason": "no signals"}

    symbol      = (params.get("symbol") or "UNKNOWN").upper()
    exchange    = (params.get("exchange") or "NSE").upper()
    instr_type  = params.get("instrType", "spot")
    interval    = params.get("interval", "1d")
    data_source = ctx.get("dataSource", "unknown")
    bar_date    = ctx.get("barDate")
    prediction_id = ctx.get("predictionId") or os.urandom(8).hex()

    now = _dt.datetime.now().isoformat(timespec="seconds")
    incoming = []
    for s in signals:
        incoming.append({
            "predictionId":  prediction_id,
            "signalId":      s.get("id"),
            "symbol":        symbol,
            "exchange":      exchange,
            "instrType":     instr_type,
            "interval":      interval,
            "barDate":       bar_date,
            "recordedAt":    now,
            "variant":       s.get("variant"),
            "direction":     s.get("type"),
            "entry":         s.get("entryPrice"),
            "sl":            s.get("stopLoss"),
            "t1":            s.get("t1Price"),
            "t2":            s.get("t2Price"),
            "t3":            s.get("t3Price"),
            # The probability ACTUALLY ISSUED, perturbation included — that is the claim
            # that was made and the only one it is fair to score. `rawProbability` keeps
            # the unperturbed value so the two can be separated later (Section 68).
            "probability":     (s.get("probability") or 0) / 100.0,
            "rawProbability":  ctx.get("rawProb"),
            "directionalProbability": (s.get("directionalProbability") or 0) / 100.0,
            "grade":         s.get("grade"),
            "validityBars":  s.get("validityBars"),
            "suppressed":    bool(s.get("suppressed")),
            "regime":        s.get("regime"),
            "dataSource":    data_source,
            "modelProbs":    ctx.get("modelProbs") or {},
            # Resolution state
            "resolved":      False,
            "outcome":       None,
            "exitPrice":     None,
            "pnlPct":        None,
            "won":           None,
            "barsHeld":      None,
            "resolvedAt":    None,
            "learnedAt":     None,
        })

    existing = _read_jsonl(records_path())
    index = {_record_key(r): i for i, r in enumerate(existing)}

    fresh, updated = [], 0
    for rec in incoming:
        k = _record_key(rec)
        if k in index:
            prior = existing[index[k]]
            if prior.get("resolved"):
                # A resolved claim is history. Re-predicting the same bar must not erase
                # the outcome it was already scored against.
                continue
            # Keep the original identifiers and recording time; refresh the claim itself.
            rec["predictionId"] = prior.get("predictionId") or rec["predictionId"]
            rec["recordedAt"]   = prior.get("recordedAt") or rec["recordedAt"]
            existing[index[k]]  = rec
            updated += 1
        else:
            fresh.append(rec)

    if updated:
        _rewrite_jsonl(records_path(), existing + fresh)
    elif fresh:
        _append_jsonl(records_path(), fresh)

    if ctx.get("features") is not None:
        feats = np.asarray(ctx["features"], dtype=float)
        _append_jsonl(features_path(), [{
            "predictionId": prediction_id,
            "symbol": symbol, "barDate": bar_date, "recordedAt": now,
            "features": [round(float(x), 6) for x in feats.tolist()],
            "featureNames": ctx.get("featureNames"),
        }])

    _prune()
    return {"recorded": len(fresh), "updated": updated, "predictionId": prediction_id}


def _prune() -> None:
    """
    Keep the newest MAX_RECORDS claims, and only the feature vectors they reference.

    NEVER RAISES. Pruning is housekeeping, and housekeeping that can break the thing it
    maintains is a liability: a failed prune means the file is a little larger than intended,
    while a propagated error means a prediction that was already computed is lost. Retention
    is the least important guarantee here and it yields first.
    """
    try:
        recs = _read_jsonl(records_path())
        if len(recs) <= MAX_RECORDS:
            return
        recs = sorted(recs, key=lambda r: r.get("recordedAt") or "")[-MAX_RECORDS:]
        _rewrite_jsonl(records_path(), recs)
        keep = {r.get("predictionId") for r in recs}
        feats = [f for f in _read_jsonl(features_path()) if f.get("predictionId") in keep]
        _rewrite_jsonl(features_path(), feats)
        logger.info(f"[outcomes] pruned to {len(recs)} records and {len(feats)} feature vectors")
    except Exception as e:
        logger.warning(f"[outcomes] prune skipped: {type(e).__name__}: {e}")


# ── Resolution ────────────────────────────────────────────────────────────────

def resolve(symbol: Optional[str] = None, max_records: int = 2000) -> dict:
    """
    Score every unresolved claim whose bars have since arrived.

    Uses `backtest._simulate_np`, so a live outcome and a backtested outcome are decided by
    the same rules. Mock-data claims are skipped: resolving a prediction made on a seeded
    random walk against real price would score a claim about one series using another.
    """
    from .backtest import _simulate_np

    recs = _read_jsonl(records_path())
    if not recs:
        return {"checked": 0, "resolved": 0, "reason": "nothing recorded yet"}

    stats = {"checked": 0, "resolved": 0, "pending": 0, "skippedMock": 0,
             "noBars": 0, "noBarDate": 0, "alreadyResolved": 0}
    series_cache: dict = {}
    changed = False

    for rec in recs:
        if rec.get("resolved"):
            stats["alreadyResolved"] += 1
            continue
        if symbol and rec.get("symbol") != symbol.upper():
            continue
        stats["checked"] += 1

        if rec.get("dataSource") == "mock":
            stats["skippedMock"] += 1
            continue
        if not rec.get("barDate"):
            stats["noBarDate"] += 1
            continue

        key = (rec.get("symbol"), rec.get("exchange"), rec.get("interval") or "1d")
        if key not in series_cache:
            df = store.load(key[0], key[1], key[2])
            if df is not None and len(df):
                d = df.copy()
                d["date"] = pd.to_datetime(d["date"], errors="coerce")
                d = d.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
                series_cache[key] = d
            else:
                series_cache[key] = None
        df = series_cache[key]
        if df is None:
            stats["noBars"] += 1
            continue

        try:
            bar_ts = pd.Timestamp(rec["barDate"]).normalize()
        except Exception:
            stats["noBarDate"] += 1
            continue

        after = df[df["date"] > bar_ts]
        horizon = int(rec.get("validityBars") or 10)
        if len(after) < 1:
            stats["pending"] += 1
            continue
        # Only resolve once the full declared horizon has elapsed, OR the trade already
        # closed inside the bars available. Scoring a claim early would mark a signal that
        # still has room to run as a TIMEOUT, which is a loss it never took.
        window = after.head(horizon)
        highs  = window["high"].to_numpy(dtype=float)
        lows   = window["low"].to_numpy(dtype=float)
        closes = window["close"].to_numpy(dtype=float)

        outcome, exit_price, bars_held = _simulate_np(
            rec["entry"], rec["sl"], rec["t1"], rec["t2"], rec["t3"],
            rec["direction"], highs, lows, closes)

        if outcome == "TIMEOUT" and len(window) < horizon:
            stats["pending"] += 1          # the horizon has not run out yet
            continue

        entry = float(rec["entry"] or 0)
        pnl = 0.0
        if entry > 0:
            raw = (exit_price - entry) / entry * 100.0
            pnl = raw if rec["direction"] == "LONG" else -raw

        rec.update({
            "resolved":   True,
            "outcome":    outcome,
            "exitPrice":  round(float(exit_price), 4),
            "pnlPct":     round(float(pnl), 4),
            # Consistent with the backtest's `won`: profit, not "did not stop out".
            "won":        bool(pnl > 0),
            "barsHeld":   int(bars_held),
            "resolvedAt": _dt.datetime.now().isoformat(timespec="seconds"),
        })
        stats["resolved"] += 1
        changed = True
        if stats["resolved"] >= max_records:
            break

    if changed:
        _rewrite_jsonl(records_path(), recs)
    stats["totalRecords"] = len(recs)
    return stats


# ── Learning ──────────────────────────────────────────────────────────────────

def learn(max_records: int = 5000) -> dict:
    """
    Feed resolved-but-unlearned outcomes into the ensemble, exactly once each.

    EXACTLY ONCE IS THE POINT. `learnedAt` is stamped as each record is consumed, so
    re-running this is safe. Without it, running the resolver twice silently doubles every
    outcome's influence on the weights and there is no way to detect it afterwards — the
    weights are simply wrong.
    """
    from .registry import MODEL_REGISTRY

    recs = _read_jsonl(records_path())
    todo = [r for r in recs
            if r.get("resolved") and not r.get("learnedAt")
            and r.get("dataSource") != "mock"]
    if not todo:
        return {"learned": 0, "reason": "nothing resolved and unlearned",
                "metaUpdates": MODEL_REGISTRY.meta_update_count()}

    features_by_id = {f["predictionId"]: f.get("features")
                      for f in _read_jsonl(features_path())}

    learned = 0
    stamp = _dt.datetime.now().isoformat(timespec="seconds")
    for rec in sorted(todo, key=lambda r: r.get("resolvedAt") or "")[:max_records]:
        probs = list((rec.get("modelProbs") or {}).values())
        if not probs:
            # No per-model probabilities means nothing for the meta-learner to reweight.
            # Stamped anyway, or it is retried forever.
            rec["learnedAt"] = stamp
            continue
        feats = features_by_id.get(rec.get("predictionId"))
        MODEL_REGISTRY.update_from_outcome(
            probs, bool(rec.get("won")),
            features=np.asarray(feats, dtype=float) if feats else None)
        rec["learnedAt"] = stamp
        learned += 1

    _rewrite_jsonl(records_path(), recs)
    MODEL_REGISTRY.save_meta_state()
    return {"learned": learned, "metaUpdates": MODEL_REGISTRY.meta_update_count(),
            "metaWeights": MODEL_REGISTRY.meta_weights()}


# ── Measured statistics ───────────────────────────────────────────────────────

def resolved_frame(symbol: Optional[str] = None) -> pd.DataFrame:
    recs = [r for r in _read_jsonl(records_path())
            if r.get("resolved") and r.get("dataSource") != "mock"]
    if symbol:
        recs = [r for r in recs if r.get("symbol") == symbol.upper()]
    return pd.DataFrame(recs) if recs else pd.DataFrame()


def stats(symbol: Optional[str] = None) -> dict:
    """
    What the engine has actually learned, measured against resolved claims.

    The counts are deliberately separated. "Recorded" is how many claims were made,
    "resolved" how many have an answer, "learned" how many have been consumed. Reporting a
    single number would hide the case that matters: many claims, none resolved, which looks
    like a working loop and is not.
    """
    from .calibration import compute_ece, compute_brier_score

    all_recs = _read_jsonl(records_path())
    if symbol:
        all_recs = [r for r in all_recs if r.get("symbol") == symbol.upper()]

    out = {
        "symbol":       symbol.upper() if symbol else None,
        "recorded":     len(all_recs),
        "resolved":     sum(1 for r in all_recs if r.get("resolved")),
        "learned":      sum(1 for r in all_recs if r.get("learnedAt")),
        "pending":      sum(1 for r in all_recs if not r.get("resolved")
                            and r.get("dataSource") != "mock"),
        "mockExcluded": sum(1 for r in all_recs if r.get("dataSource") == "mock"),
        "calibrationMeasured": False,
        "ece": None, "brierScore": None, "winRatePct": None,
        "meanPredicted": None, "adaptiveWeight": 1.0,
        "adaptiveWeightMeasured": False,
        "minSamplesForCalibration": MIN_SAMPLES_FOR_CALIBRATION,
        "minSamplesForWeight": MIN_SAMPLES_FOR_WEIGHT,
    }

    df = resolved_frame(symbol)
    if len(df) == 0:
        out["note"] = ("No resolved outcomes yet. Record predictions, then POST "
                       "/outcomes/resolve once later bars exist.")
        return out

    y_prob = pd.to_numeric(df["probability"], errors="coerce").fillna(0.5).to_numpy(dtype=float)
    y_true = df["won"].astype(bool).to_numpy().astype(float)
    out["winRatePct"]    = round(float(y_true.mean()) * 100, 2)
    out["meanPredicted"] = round(float(y_prob.mean()), 4)
    out["avgPnlPct"]     = round(float(pd.to_numeric(df["pnlPct"], errors="coerce").mean()), 4)
    out["outcomeCounts"] = df["outcome"].value_counts().to_dict()

    if len(df) >= MIN_SAMPLES_FOR_CALIBRATION:
        out["ece"]   = round(float(compute_ece(y_true, y_prob)), 4)
        out["brierScore"] = round(float(compute_brier_score(y_true, y_prob)), 4)
        out["calibrationMeasured"] = True
    else:
        out["note"] = (f"{len(df)} resolved — calibration is reported from "
                       f"{MIN_SAMPLES_FOR_CALIBRATION}. Fewer than that is noise.")

    if len(df) >= MIN_SAMPLES_FOR_WEIGHT:
        mean_p = float(y_prob.mean())
        if mean_p > 1e-6:
            lo, hi = ADAPTIVE_WEIGHT_BOUNDS
            out["adaptiveWeight"] = round(float(np.clip(float(y_true.mean()) / mean_p, lo, hi)), 4)
            out["adaptiveWeightMeasured"] = True

    # Does a better grade actually win more often? The whole point of grading, and the
    # first thing a real trader will check.
    if "grade" in df.columns:
        by_grade = {}
        for g, sub in df.groupby("grade"):
            by_grade[str(g)] = {"n": int(len(sub)),
                                "winRatePct": round(float(sub["won"].astype(bool).mean()) * 100, 1)}
        out["byGrade"] = by_grade
    return out


def measured_adaptive_weight(symbol: Optional[str] = None) -> tuple[float, bool]:
    """
    @returns (weight, measured). `measured` is False when there is not enough history, and
             the weight is then exactly 1.0 — a correction fitted on nine trades is noise
             with a decimal point.
    """
    s = stats(symbol)
    return float(s.get("adaptiveWeight") or 1.0), bool(s.get("adaptiveWeightMeasured"))


def recent(limit: int = 50, symbol: Optional[str] = None,
           resolved_only: bool = False) -> list[dict]:
    recs = _read_jsonl(records_path())
    if symbol:
        recs = [r for r in recs if r.get("symbol") == symbol.upper()]
    if resolved_only:
        recs = [r for r in recs if r.get("resolved")]
    recs.sort(key=lambda r: r.get("recordedAt") or "", reverse=True)
    # `modelProbs` is for the learner, not for a UI list.
    return [{k: v for k, v in r.items() if k != "modelProbs"} for r in recs[:max(1, limit)]]
