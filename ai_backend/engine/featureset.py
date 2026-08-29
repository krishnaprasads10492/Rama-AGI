"""
featureset.py — the one feature builder, and the manifest that keeps models aligned to it.

WHY THIS EXISTS (spec Section 69). A trained model is a function of a **vector position
order**. `compute_full_features_dict` returns 100 features today; add, remove or reorder one
and every column shifts, after which a loaded artifact predicts from misaligned inputs and
nothing complains.

That failure class has now appeared three times in this codebase: Section 64's 37 feature
names zipped against a 59-value vector, Section 68's positional meta-learner weights, and
this. It is handled the same way each time — **refuse rather than guess**.

So there is exactly one builder, used by both the trainer and the dispatcher, and a manifest
recording the names it produced. Two code paths assembling "the same" vector is how
alignment rots; one builder plus a checked manifest is how it cannot.
"""

import json
import logging
import os
import datetime as _dt
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("stockmind-ai.featureset")

# Bump when the meaning of any existing feature changes. Adding features changes the name
# list, which the manifest already catches; a *redefinition* does not, so it needs a version.
FEATURESET_VERSION = 2

# Derivative columns joined from the Section 67 store, in a fixed order.
#
# `deriv_available` is part of the vector on purpose. The columns are always present so the
# width is constant, and where a bar has no metric row they carry a neutral value — the flag
# is what lets the model tell "neutral because the market was neutral" from "neutral because
# we had no data". Without it those two are the same input, and the model would learn that
# missing derivative data means a balanced option chain.
DERIV_FEATURES = [
    "pcr_oi", "pcr_volume", "pcr_oi_all",
    "max_pain_dist", "resistance_dist", "support_dist",
    "oi_concentration", "straddle_pct",
    "ce_oi_chg_norm", "pe_oi_chg_norm",
    "fut_basis_pct", "fut_oi_chg_norm", "rollover_pct",
    "days_to_expiry_norm",
    "deriv_available",
]

# Neutral values, chosen so an absent row is not read as a signal. A put/call ratio of 1.0
# is balanced; every distance and change is 0.0 = "at the money" / "no change".
DERIV_NEUTRAL = {
    "pcr_oi": 1.0, "pcr_volume": 1.0, "pcr_oi_all": 1.0,
    "max_pain_dist": 0.0, "resistance_dist": 0.0, "support_dist": 0.0,
    "oi_concentration": 0.0, "straddle_pct": 0.0,
    "ce_oi_chg_norm": 0.0, "pe_oi_chg_norm": 0.0,
    "fut_basis_pct": 0.0, "fut_oi_chg_norm": 0.0, "rollover_pct": 0.0,
    "days_to_expiry_norm": 0.0, "deriv_available": 0.0,
}


# ── Manifest ──────────────────────────────────────────────────────────────────

def models_dir() -> str:
    d = os.environ.get("STOCKMIND_MODELS_DIR")
    if not d:
        d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "data", "models")
    os.makedirs(d, exist_ok=True)
    return d


def manifest_path() -> str:
    return os.path.join(models_dir(), "featureset.json")


def save_manifest(names: list, include_derivatives: bool, extra: dict = None) -> bool:
    payload = {
        "featuresetVersion": FEATURESET_VERSION,
        "includeDerivatives": bool(include_derivatives),
        "featureCount": len(names),
        "featureNames": list(names),
        "savedAt": _dt.datetime.now().isoformat(timespec="seconds"),
    }
    payload.update(extra or {})
    try:
        tmp = manifest_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        os.replace(tmp, manifest_path())
        return True
    except Exception as e:
        logger.warning(f"[featureset] could not write manifest: {e}")
        return False


def load_manifest() -> Optional[dict]:
    p = manifest_path()
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as fh:
            m = json.load(fh)
        if not isinstance(m.get("featureNames"), list) or not m["featureNames"]:
            return None
        return m
    except Exception as e:
        logger.warning(f"[featureset] could not read manifest: {e}")
        return None


def include_derivatives_default() -> bool:
    """
    Whether inference should join derivative columns.

    Read from the manifest, so the dispatcher automatically builds whatever the trained
    artifacts were fitted on. With no manifest this is False — exactly the behaviour before
    any training happened, so nothing changes for an untrained install (I11).
    """
    m = load_manifest()
    return bool(m.get("includeDerivatives")) if m else False


def validate_against_live(names_from_artifact: list, include_derivatives: bool) -> tuple[bool, str]:
    """
    Does an artifact's feature contract still match what this build produces?

    @returns (ok, reason). Compares names AND order — a set comparison would pass a
             permutation, which is the exact failure this exists to prevent.
    """
    live = feature_names(include_derivatives)
    if len(names_from_artifact) != len(live):
        return False, (f"feature count changed: artifact has {len(names_from_artifact)}, "
                       f"this build produces {len(live)}")
    if list(names_from_artifact) != list(live):
        diffs = [(i, a, b) for i, (a, b) in enumerate(zip(names_from_artifact, live)) if a != b]
        first = diffs[0] if diffs else None
        return False, (f"feature order changed at position {first[0]}: "
                       f"artifact '{first[1]}' vs live '{first[2]}'" if first
                       else "feature names differ")
    return True, "aligned"


# ── Derivative join ───────────────────────────────────────────────────────────

def _deriv_row_for(symbol: str, exchange: str, bar_date) -> Optional[dict]:
    """
    The stored derivative metrics for one symbol on one date, or None.

    **As-of, never after.** The row must be dated on or before the bar being featurised, or
    the feature would carry information from a session that had not happened — the same
    lookahead Section 66 removed from the backtest's grading.
    """
    try:
        from . import derivatives as dv
        df = dv.load_metrics(symbol, exchange)
        if df is None or len(df) == 0:
            return None
        d = df.copy()
        d["date"] = pd.to_datetime(d["date"], errors="coerce")
        d = d.dropna(subset=["date"]).sort_values("date")
        upto = d[d["date"] <= pd.Timestamp(bar_date).normalize()]
        if len(upto) == 0:
            return None
        return upto.iloc[-1].to_dict()
    except Exception as e:
        logger.debug(f"[featureset] derivative lookup failed for {symbol}: {e}")
        return None


def _norm_oi_change(change, level) -> float:
    """
    Open-interest change as a fraction of the level it changed from.

    RAW OI CHANGE IS UNUSABLE AS A FEATURE. It is measured in contracts, so it grows with
    the market: a 300,000-contract change means something different in 2008 than in 2026.
    Standardising it against the standing OI makes it comparable across two decades, which
    is the whole span the model is fitted on.
    """
    try:
        c, l = float(change), float(level)
        if not np.isfinite(c) or not np.isfinite(l) or abs(l) < 1e-9:
            return 0.0
        return float(np.clip(c / l, -5.0, 5.0))
    except Exception:
        return 0.0


def derivative_features(symbol: str, exchange: str, bar_date) -> dict:
    """
    The fixed-width derivative block for one bar. Always the same keys, in DERIV_FEATURES
    order, neutral-filled with `deriv_available = 0` when there is nothing to join.
    """
    out = {k: DERIV_NEUTRAL[k] for k in DERIV_FEATURES}
    row = _deriv_row_for(symbol, exchange, bar_date) if symbol else None
    if not row:
        return out

    def num(key, default=None):
        v = row.get(key)
        try:
            f = float(v)
            return f if np.isfinite(f) else default
        except (TypeError, ValueError):
            return default

    for key in ("pcr_oi", "pcr_volume", "pcr_oi_all"):
        v = num(key)
        if v is not None and v > 0:
            out[key] = float(np.clip(v, 0.0, 10.0))
    for key in ("max_pain_dist", "resistance_dist", "support_dist",
                "oi_concentration", "straddle_pct", "fut_basis_pct", "rollover_pct"):
        v = num(key)
        if v is not None:
            out[key] = float(np.clip(v, -5.0, 5.0))

    out["ce_oi_chg_norm"]  = _norm_oi_change(num("ce_oi_chg", 0.0), num("ce_oi", 0.0))
    out["pe_oi_chg_norm"]  = _norm_oi_change(num("pe_oi_chg", 0.0), num("pe_oi", 0.0))
    out["fut_oi_chg_norm"] = _norm_oi_change(num("fut_oi_chg", 0.0), num("fut_oi", 0.0))

    dte = num("days_to_expiry")
    if dte is not None:
        # Scaled by a month, so the model sees "how close to expiry" rather than a raw
        # count that means different things for weekly and monthly series.
        out["days_to_expiry_norm"] = float(np.clip(dte / 30.0, 0.0, 12.0))

    out["deriv_available"] = 1.0
    return out


# ── The builder ───────────────────────────────────────────────────────────────

def build_feature_map(df: pd.DataFrame, symbol: str = None, exchange: str = "NSE",
                      include_derivatives: bool = None) -> dict:
    """
    THE feature vector, as an ordered mapping. Used by the trainer and by the dispatcher.

    `include_derivatives=None` reads the manifest, so inference automatically matches
    whatever the artifacts were fitted on.

    Order is: the 100 price/volume features exactly as `compute_full_features_dict` produces
    them, then the derivative block. Appending rather than interleaving means enabling
    derivatives cannot move an existing column, so a manifest mismatch is a clean
    "count changed" rather than a silent shift.
    """
    from .features import compute_full_features_dict

    if include_derivatives is None:
        include_derivatives = include_derivatives_default()

    fmap = dict(compute_full_features_dict(df))

    if include_derivatives:
        bar_date = None
        try:
            if df is not None and len(df) and "date" in df.columns:
                bar_date = pd.Timestamp(df["date"].iloc[-1]).normalize()
        except Exception:
            bar_date = None
        if bar_date is not None and symbol:
            fmap.update(derivative_features(symbol, exchange, bar_date))
        else:
            fmap.update({k: DERIV_NEUTRAL[k] for k in DERIV_FEATURES})
    return fmap


def build_vector(df: pd.DataFrame, symbol: str = None, exchange: str = "NSE",
                 include_derivatives: bool = None) -> tuple[np.ndarray, dict]:
    fmap = build_feature_map(df, symbol, exchange, include_derivatives)
    return np.array(list(fmap.values()), dtype=np.float32), fmap


def feature_names(include_derivatives: bool = None) -> list:
    """
    The names this build produces, without computing anything.

    Derived from `get_full_feature_names()` rather than maintained by hand — Section 64
    removed a hand-kept list for exactly this reason, and re-introducing one here would
    resurrect the drift it killed.
    """
    from .features import get_full_feature_names

    if include_derivatives is None:
        include_derivatives = include_derivatives_default()
    names = list(get_full_feature_names())
    if include_derivatives:
        names += list(DERIV_FEATURES)
    return names
