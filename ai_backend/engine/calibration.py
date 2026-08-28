"""
calibration.py — Three-stage probability calibration pipeline.

Stage 1: Model-level  — Platt scaling (logistic) or Isotonic regression
Stage 2: Ensemble     — Meta-learner output → Isotonic regression
Stage 3: Regime-aware — Multiply by regime weight

Spec reference: Section 11.2
"""

import numpy as np

# scikit-learn is imported lazily inside `isotonic_calibrate`. It was imported at
# module scope for three symbols, two of which (`CalibratedClassifierCV`,
# `LogisticRegression`) are never used — which made this module, and therefore the
# whole engine, unimportable without scikit-learn for no benefit.


# ── Regime weights (Section 11.2, Stage 3) ───────────────────────────────────

REGIME_WEIGHTS = {
    "trending":      1.05,
    "ranging":       0.85,
    "volatile":      0.70,
    "low_liquidity": 0.60,
    "news_active":   0.70,
}


def _logit(p: float, eps: float = 1e-6) -> float:
    """Probability → log-odds. Clipped so 0 and 1 do not become infinite."""
    p = float(np.clip(p, eps, 1.0 - eps))
    return float(np.log(p / (1.0 - p)))


def platt_scale(raw_prob: float, A: float = 1.0, B: float = 0.0) -> float:
    """
    Platt scaling, applied to the log-odds of the incoming probability.

    P_cal = sigmoid(A * logit(p) + B)

    At A=1, B=0 this is **genuine identity** — sigmoid(logit(p)) == p.

    WHAT WAS WRONG (spec Section 64). This returned `1 / (1 + exp(A*p + B))`, which its
    own docstring called identity. It is monotonically *decreasing*: p=0.95 → 0.279,
    p=0.05 → 0.488. Two compounding errors — Platt scaling applies to a
    decision-function score, not to a probability, and the sign was inverted. The
    effect end to end was that **reported confidence moved opposite to the ensemble's
    own signal**, and after the regime multiplier the output collapsed to ≈0.29-0.51,
    putting the A+ (>=0.80) and A (>=0.70) grades arithmetically out of reach.

    Fixed by scaling the log-odds, which is what Platt scaling actually operates on, so
    fitted A and B from a validation set will behave correctly when they arrive rather
    than compounding a second error on top of a sign flip.
    """
    return _sigmoid(A * _logit(raw_prob) + B)


def _sigmoid(z: float) -> float:
    # Branch to avoid overflow on large |z|.
    if z >= 0:
        return float(1.0 / (1.0 + np.exp(-z)))
    ez = np.exp(z)
    return float(ez / (1.0 + ez))


def isotonic_calibrate(raw_probs: np.ndarray, calibrator) -> np.ndarray:
    """
    Apply a fitted isotonic regression calibrator.

    `calibrator` is a fitted `sklearn.isotonic.IsotonicRegression`. Typed loosely and
    imported lazily so this module does not require scikit-learn just to be read.
    """
    return calibrator.predict(raw_probs)


def fit_isotonic(y_true: np.ndarray, y_prob: np.ndarray):
    """
    Fit an isotonic calibrator on resolved outcomes.

    Stage 2 of the documented pipeline, which has never been reachable because nothing
    records outcomes to fit against. Provided so the loop can be closed without another
    change here.
    """
    from sklearn.isotonic import IsotonicRegression
    cal = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    cal.fit(np.asarray(y_prob, dtype=float), np.asarray(y_true, dtype=float))
    return cal


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
    y_true = np.asarray(y_true, dtype=float)
    y_prob = np.asarray(y_prob, dtype=float)
    if len(y_true) == 0:
        return 0.0

    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        # The final bin must include its right edge. With a half-open `< bins[i+1]`
        # throughout, a prediction of exactly 1.0 fell into no bin at all and was
        # silently dropped from the score — so a forecaster that said "certain" and was
        # wrong had those cases excluded from its own calibration error. Found by the
        # Section 64 regression test.
        last = (i == n_bins - 1)
        mask = (y_prob >= bins[i]) & ((y_prob <= bins[i+1]) if last else (y_prob < bins[i+1]))
        if mask.sum() == 0:
            continue
        bin_acc  = y_true[mask].mean()
        bin_conf = y_prob[mask].mean()
        ece += mask.sum() * abs(bin_acc - bin_conf)
    return float(ece / len(y_true))


def compute_brier_score(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Brier score — lower is better. Penalises overconfident wrong predictions."""
    return float(np.mean((y_prob - y_true) ** 2))
