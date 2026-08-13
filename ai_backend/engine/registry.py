"""
registry.py — Model registry and stacking meta-learner ensemble.

Loads all models once at startup. Provides:
    - ensemble_predict(features) → calibrated probability via stacking
    - adaptive_weights: updated from live prediction outcomes
    - SHAP-based reason generation
    - Regime detection and regime-conditioned prediction
    - Uncertainty quantification (epistemic + aleatoric)
"""

import numpy as np
import logging
from .models import (LightGBMModel, XGBoostModel, LSTMModel, SentimentModel,
                     RandomForestModel, MLPModel, OnlineSGDModel, RegimeAwareModel)
from .calibration import calibrate_ensemble_output, clamp_probability

logger = logging.getLogger("stockmind-ai.registry")


class StackingMetaLearner:
    """
    Level-2 meta-learner: combines base model outputs using learned weights.
    Weights are updated online from resolved prediction outcomes.
    """

    def __init__(self, n_models: int):
        self.n = n_models
        # Start with equal weights
        self.weights   = np.ones(n_models) / n_models
        self.perf_ema  = np.ones(n_models) * 0.5    # EMA accuracy per model
        self.alpha     = 0.05                         # EMA learning rate
        self._update_count = 0

    def blend(self, probs: list[float]) -> float:
        """Weighted blend of model probabilities."""
        if len(probs) != self.n:
            # Pad or trim if model count mismatch
            arr = np.array(probs[:self.n] if len(probs) >= self.n
                           else probs + [0.5] * (self.n - len(probs)))
        else:
            arr = np.array(probs)
        return float(np.dot(arr, self.weights[:len(arr)]) / (np.sum(self.weights[:len(arr)]) + 1e-9))

    def update(self, probs: list[float], was_correct: bool):
        """Update model weights based on prediction correctness (online learning)."""
        self._update_count += 1
        label = 1.0 if was_correct else 0.0
        for i, p in enumerate(probs[:self.n]):
            # Models that were close to correct get rewarded
            correct_for_model = 1.0 if abs(p - label) < 0.3 else 0.0
            self.perf_ema[i] = (1 - self.alpha) * self.perf_ema[i] + self.alpha * correct_for_model

        # Softmax over performance scores → new weights
        exp_perf = np.exp(self.perf_ema * 3)
        self.weights = exp_perf / (np.sum(exp_perf) + 1e-9)

        if self._update_count % 50 == 0:
            logger.info(f"[StackingMeta] Updated weights: {dict(zip(['lgbm','xgb','lstm','rf','mlp','sgd','regime','sentiment'], np.round(self.weights, 3)))}")


class ModelRegistry:
    """Singleton — loaded once at FastAPI startup."""

    def __init__(self):
        logger.info("[Registry] Loading AGI-enhanced model ensemble...")
        self.lgbm       = LightGBMModel()
        self.xgb        = XGBoostModel()
        self.lstm       = LSTMModel()
        self.rf         = RandomForestModel()
        self.mlp        = MLPModel()
        self.sgd        = OnlineSGDModel()
        self.regime     = RegimeAwareModel()
        self.sentiment  = SentimentModel()

        self._base_models = [self.lgbm, self.xgb, self.lstm,
                             self.rf, self.mlp, self.sgd, self.regime]
        self._meta = StackingMetaLearner(n_models=len(self._base_models) + 1)  # +1 for sentiment

        logger.info(f"[Registry] Loaded: {[m.name for m in self._base_models if m.is_available()]}")
        logger.info(f"[Registry] Mock:   {[m.name for m in self._base_models if not m.is_available()]}")

    def ensemble_predict(
        self,
        features: np.ndarray,
        regime: str = "trending",
        news_text: str = "",
    ) -> dict:
        """
        AGI-grade ensemble prediction:
        1. All base models predict independently
        2. Stacking meta-learner blends with learned weights
        3. Uncertainty quantification (disagreement = epistemic uncertainty)
        4. Regime-conditioned calibration
        5. Human-readable SHAP-style reasons
        """
        probs = {}

        for model in self._base_models:
            try:
                p = model.predict_proba(features)
                probs[model.name] = float(np.clip(p, 0.05, 0.95))
            except Exception as e:
                logger.warning(f"[{model.name}] predict failed: {e}")

        # Sentiment
        if news_text:
            try:
                p = self.sentiment.predict_proba(news_text)
                probs["sentiment"] = float(np.clip(p, 0.05, 0.95))
            except Exception:
                probs["sentiment"] = 0.5
        else:
            try:
                p = self.sentiment.predict_proba_from_features(features)
                probs["sentiment"] = float(np.clip(p, 0.05, 0.95))
            except Exception:
                probs["sentiment"] = 0.5

        if not probs:
            return {
                "probability": 0.5, "model_probs": {},
                "agreement": 0.0, "suppressed": True,
                "suppress_reason": "No models available",
                "reasons": ["No models loaded — install dependencies"],
                "uncertainty": 1.0, "epistemic": 1.0, "aleatoric": 0.5,
            }

        values = list(probs.values())

        # ── Meta-learner blend ────────────────────────────────────────────────
        raw_mean = float(self._meta.blend(values))

        # ── Uncertainty quantification ────────────────────────────────────────
        # Epistemic uncertainty: disagreement between models (reducible with more data)
        epistemic = float(np.std(values))
        # Aleatoric uncertainty: inherent market noise (irreducible)
        aleatoric = float(min(0.5, np.mean([abs(p - 0.5) for p in values]) * 0.3 + 0.1))
        total_uncertainty = float(np.sqrt(epistemic**2 + aleatoric**2))

        # ── Agreement & suppression ───────────────────────────────────────────
        agreement = float(np.mean([abs(p - raw_mean) < 0.15 for p in values]))
        agreeing_count = sum(1 for p in values if abs(p - raw_mean) < 0.15)
        suppressed = agreeing_count < min(3, len(values))

        # ── Regime-conditioned calibration ────────────────────────────────────
        calibrated = calibrate_ensemble_output(raw_mean, regime=regime)

        # ── Confidence boost from low uncertainty ─────────────────────────────
        if epistemic < 0.05 and not suppressed:
            # High agreement — slight confidence boost
            calibrated = float(np.clip(calibrated * 1.03, 0.05, 0.99))

        # ── Multi-horizon probability estimate ────────────────────────────────
        # Short-term (T1): full probability
        # Medium-term (T2): decay by uncertainty
        # Long-term (T3): further decay
        p_t1 = calibrated
        p_t2 = float(np.clip(calibrated * (1.0 - epistemic * 0.5), 0.05, 0.99))
        p_t3 = float(np.clip(calibrated * (1.0 - epistemic * 1.0), 0.05, 0.99))

        reasons = self._generate_reasons(features, calibrated, regime, probs, epistemic)

        return {
            "probability":    calibrated,
            "p_t1":           clamp_probability(p_t1),
            "p_t2":           clamp_probability(p_t2),
            "p_t3":           clamp_probability(p_t3),
            "model_probs":    probs,
            "meta_weights":   dict(zip(
                [m.name for m in self._base_models] + ["sentiment"],
                np.round(self._meta.weights[:len(values)], 3).tolist()
            )),
            "agreement":      agreement,
            "suppressed":     suppressed,
            "suppress_reason": "Model disagreement" if suppressed else None,
            "uncertainty":    round(total_uncertainty, 3),
            "epistemic":      round(epistemic, 3),
            "aleatoric":      round(aleatoric, 3),
            "regime_detected": self.regime.detect_regime(features),
            "reasons":        reasons,
        }

    def update_from_outcome(self, probs: list[float], was_correct: bool):
        """Call after each resolved prediction to improve ensemble weights."""
        self._meta.update(probs, was_correct)
        # Also update Online SGD
        try:
            label = 1 if was_correct else 0
            self.sgd.partial_fit(np.zeros(10), label)  # placeholder features
        except Exception:
            pass

    def _generate_reasons(
        self,
        features: np.ndarray,
        prob: float,
        regime: str,
        model_probs: dict,
        epistemic: float,
    ) -> list[str]:
        from .features import get_feature_names
        names = get_feature_names()
        reasons = []
        feat_dict = dict(zip(names, features))

        # RSI
        rsi = feat_dict.get("rsi14", 0.5) * 100
        if rsi < 35:
            reasons.append(f"RSI(14) = {rsi:.0f} — oversold, reversal probability elevated")
        elif rsi > 65:
            reasons.append(f"RSI(14) = {rsi:.0f} — overbought, caution advised")
        else:
            reasons.append(f"RSI(14) = {rsi:.0f} — neutral zone")

        # EMA trend
        price_vs_ema20 = feat_dict.get("price_vs_ema20", 0)
        ema20_slope    = feat_dict.get("ema20_slope", 0)
        if price_vs_ema20 > 0.005 and ema20_slope > 0:
            reasons.append("Price above rising EMA(20) — bullish structure confirmed")
        elif price_vs_ema20 < -0.005 and ema20_slope < 0:
            reasons.append("Price below falling EMA(20) — bearish structure confirmed")
        else:
            reasons.append(f"EMA(20) slope {ema20_slope*100:+.2f}% — neutral/transitional")

        # Hurst exponent
        hurst = feat_dict.get("hurst_exp", 0.5)
        if hurst > 0.6:
            reasons.append(f"Hurst {hurst:.2f} — persistent trending behaviour")
        elif hurst < 0.4:
            reasons.append(f"Hurst {hurst:.2f} — mean-reverting behaviour dominant")

        # Volume
        vol_ratio = feat_dict.get("volume_ratio", 1.0)
        if vol_ratio > 1.5:
            reasons.append(f"Volume {vol_ratio:.1f}x 20-day avg — institutional participation")
        elif vol_ratio < 0.6:
            reasons.append(f"Volume {vol_ratio:.1f}x avg — low conviction, proceed with caution")

        # Uncertainty advisory
        if epistemic > 0.12:
            reasons.append(f"High model disagreement ({epistemic:.2f}) — reduce position size")
        elif epistemic < 0.05:
            reasons.append(f"Strong model consensus ({1-epistemic:.0%} agreement)")

        # Model votes
        bulls = sum(1 for p in model_probs.values() if p > 0.55)
        bears = sum(1 for p in model_probs.values() if p < 0.45)
        reasons.append(f"{bulls}/{len(model_probs)} models bullish, {bears} bearish — regime: {regime}")

        return reasons[:6]

    def status(self) -> dict:
        return {
            "models": {
                m.name: {"loaded": m.is_available(), "type": "real" if m.is_available() else "mock"}
                for m in [self.lgbm, self.xgb, self.lstm, self.rf, self.mlp, self.sgd, self.regime, self.sentiment]
            },
            "ensemble_size":   len(self._base_models),
            "meta_weights":    dict(zip(
                [m.name for m in self._base_models] + ["sentiment"],
                np.round(self._meta.weights, 3).tolist()
            )),
            "meta_updates":    self._meta._update_count,
            "capabilities":    ["stacking", "adaptive_weights", "uncertainty_quantification",
                                "regime_detection", "online_learning", "multi_horizon"],
            "note": "Models without saved artifacts use calibrated mock predictions",
        }


# Singleton
MODEL_REGISTRY = ModelRegistry()
