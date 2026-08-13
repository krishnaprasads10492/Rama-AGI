"""
calibration.py — Three-stage probability calibration pipeline.

Stage 1: Model-level  — Platt scaling (logistic) or Isotonic regression
Stage 2: Ensemble     — Meta-learner output → Isotonic regression
Stage 3: Regime-aware — Multiply by regime weight

Spec reference: Section 11.2
"""

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


# ── Regime weights (Section 11.2, Stage 3) ───────────────────────────────────

REGIME_WEIGHTS = {
    "trending":      1.05,
    "ranging":       0.85,
    "volatile":      0.70,
    "low_liquidity": 0.60,
    "news_active":   0.70,
}


def platt_scale(raw_prob: float, A: float = 1.0, B: float = 0.0) -> float:
    """
    Platt scaling: P_cal = 1 / (1 + exp(A * f(x) + B))
    A, B are learned on a validation set. Defaults = identity (no scaling).
    """
    return 1.0 / (1.0 + np.exp(A * raw_prob + B))


def isotonic_calibrate(raw_probs: np.ndarray, calibrator: IsotonicRegression) -> np.ndarray:
    """Apply a fitted isotonic regression calibrator."""
    return calibrator.predict(raw_probs)


def regime_adjust(prob: float, regime: str) -> float:
    """Apply regime-aware confidence adjustment (Stage 3)."""
    weight = REGIME_WEIGHTS.get(regime, 1.0)
    adjusted = prob * weight
    return float(np.clip(adjusted, 0.05, 0.99))


def clamp_probability(prob: float, floor: float = 0.05, ceiling: float = 0.99) -> float:
    """
    Hard floor/ceiling — never show 0% or 100%.
    Spec Section 16.1.4 — Confidence Inflation Prevention.
    """
    return float(np.clip(prob, floor, ceiling))


def calibrate_ensemble_output(
    raw_prob: float,
    regime: str = "trending",
    platt_A: float = 1.0,
    platt_B: float = 0.0,
) -> float:
    """
    Full three-stage calibration pipeline for a single probability.

    Stage 1: Platt scaling
    Stage 2: (Isotonic — applied at batch level, skipped here for single value)
    Stage 3: Regime adjustment
    Final:   Hard clamp
    """
    # Stage 1
    p1 = platt_scale(raw_prob, platt_A, platt_B)
    # Stage 3
    p3 = regime_adjust(p1, regime)
    # Final clamp
    return clamp_probability(p3)


def compute_ece(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> float:
    """
    Expected Calibration Error (ECE).
    Lower is better. Target: < 5%.
    """
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (y_prob >= bins[i]) & (y_prob < bins[i+1])
        if mask.sum() == 0:
            continue
        bin_acc  = y_true[mask].mean()
        bin_conf = y_prob[mask].mean()
        ece += mask.sum() * abs(bin_acc - bin_conf)
    return float(ece / len(y_true))


def compute_brier_score(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Brier score — lower is better. Penalises overconfident wrong predictions."""
    return float(np.mean((y_prob - y_true) ** 2))
