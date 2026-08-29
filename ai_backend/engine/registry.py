"""
registry.py — Model registry and stacking meta-learner ensemble.

Loads all models once at startup. Provides:
    - ensemble_predict(features) → calibrated probability via stacking
    - adaptive_weights: updated from live prediction outcomes
    - SHAP-based reason generation
    - Regime detection and regime-conditioned prediction
    - Uncertainty quantification (epistemic + aleatoric)
"""

import json
import logging
import os
from datetime import datetime

import numpy as np

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
        feature_map: dict = None,
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

        reasons = self._generate_reasons(features, calibrated, regime, probs, epistemic,
                                         feature_map=feature_map)

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
            "regime_detected": self.regime.detect_regime(features, feature_map=feature_map),
            "reasons":        reasons,
        }

    # ── Persisted learning state (spec Section 68) ────────────────────────────
    #
    # WITHOUT THIS THE LOOP CANNOT CLOSE. This registry is an in-memory singleton in a
    # process `aiProcess.cjs` spawns and respawns, so every weight learned online used to
    # die at exit. That is the real reason `adaptiveWeight` arrived as a *request
    # parameter*: the learning signal had to come from outside because nothing inside
    # could remember it. Adding a call to `update_from_outcome` would not have been
    # enough on its own.

    def reload_models(self) -> dict:
        """
        Re-read artifacts from disk after training, without restarting the process.

        Rebuilds the model objects in place rather than replacing the registry, so
        `MODEL_REGISTRY` stays the same singleton every module already imported — swapping
        the object would leave other modules holding the old one. The meta-learner is
        deliberately NOT reset: its weights describe how much to trust each *slot*, and the
        slots are unchanged.
        """
        from . import models as _models
        _models._ALIGNMENT_WARNED = False        # a retrain may have fixed the mismatch

        before = {m.name: m.is_trained() for m in self._all_models()}
        self.lgbm      = LightGBMModel()
        self.xgb       = XGBoostModel()
        self.lstm      = LSTMModel()
        self.rf        = RandomForestModel()
        self.mlp       = MLPModel()
        self.sgd       = OnlineSGDModel()
        self.regime    = RegimeAwareModel()
        self.sentiment = SentimentModel()
        self._base_models = [self.lgbm, self.xgb, self.lstm,
                             self.rf, self.mlp, self.sgd, self.regime]

        after = {m.name: m.is_trained() for m in self._all_models()}
        newly = [n for n in after if after[n] and not before.get(n)]
        ok, reason = _models.artifact_alignment()
        logger.info(f"[Registry] reloaded models; now trained: "
                    f"{[n for n, v in after.items() if v]}")
        return {"trainedBefore": [n for n, v in before.items() if v],
                "trainedAfter": [n for n, v in after.items() if v],
                "newlyTrained": newly,
                "featureContract": {"aligned": ok, "reason": reason}}

    def _all_models(self) -> list:
        return [self.lgbm, self.xgb, self.lstm, self.rf, self.mlp,
                self.sgd, self.regime, self.sentiment]

    def meta_update_count(self) -> int:
        return int(self._meta._update_count)

    def meta_weights(self) -> dict:
        names = [m.name for m in self._base_models] + ["sentiment"]
        return dict(zip(names, np.round(self._meta.weights, 4).tolist()))

    def _meta_state_path(self) -> str:
        from . import outcomes
        return outcomes.meta_state_path()

    def save_meta_state(self) -> bool:
        """Atomic write, so a crash mid-save cannot leave weights that sum to nothing."""
        try:
            path = self._meta_state_path()
            payload = {
                "n":            int(self._meta.n),
                "weights":      [float(x) for x in self._meta.weights],
                "perfEma":      [float(x) for x in self._meta.perf_ema],
                "updateCount":  int(self._meta._update_count),
                "modelNames":   [m.name for m in self._base_models] + ["sentiment"],
                "savedAt":      datetime.now().isoformat(timespec="seconds"),
            }
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
            os.replace(tmp, path)
            return True
        except Exception as e:
            logger.warning(f"[Registry] could not persist meta-learner state: {e}")
            return False

    def load_meta_state(self) -> bool:
        """
        Restore learned weights at startup.

        A saved state whose model count differs from this build's is DISCARDED rather than
        padded. Weights are positional — index 3 means `rf` only because the ensemble was
        assembled in that order — so restoring a mismatched vector would silently apply
        one model's learned weight to another. Starting uniform is recoverable; learning
        against a permuted mapping is not.
        """
        path = self._meta_state_path()
        if not os.path.exists(path):
            return False
        try:
            with open(path, "r", encoding="utf-8") as fh:
                st = json.load(fh)
            names = [m.name for m in self._base_models] + ["sentiment"]
            if int(st.get("n", -1)) != self._meta.n or list(st.get("modelNames") or []) != names:
                logger.warning("[Registry] saved meta-learner state does not match this "
                               "ensemble — discarding it rather than misaligning weights")
                return False
            w = np.asarray(st["weights"], dtype=float)
            e = np.asarray(st["perfEma"], dtype=float)
            if w.shape != self._meta.weights.shape or e.shape != self._meta.perf_ema.shape:
                return False
            total = float(w.sum())
            if not np.isfinite(total) or total <= 0:
                logger.warning("[Registry] saved weights do not sum to a usable total — discarding")
                return False
            self._meta.weights       = w / total
            self._meta.perf_ema      = np.clip(e, 0.0, 1.0)
            self._meta._update_count = int(st.get("updateCount", 0))
            logger.info(f"[Registry] restored meta-learner state: "
                        f"{self._meta._update_count} updates, weights {np.round(self._meta.weights, 3).tolist()}")
            return True
        except Exception as e:
            logger.warning(f"[Registry] could not restore meta-learner state: {e}")
            return False

    def update_from_outcome(self, probs: list[float], was_correct: bool,
                            features: np.ndarray = None):
        """
        Call after each resolved prediction to improve ensemble weights.

        NOTE ON THE SGD BRANCH (spec Section 64). This used to call
        `self.sgd.partial_fit(np.zeros(10), label)` with a literal
        `# placeholder features` comment. That would have trained the online model on
        a zero vector of the wrong dimensionality — actively corrupting it, not
        improving it. It only ever appeared harmless because nothing calls this method,
        so the meta-learner's weights have stayed uniform for the life of every
        process. The SGD update now requires the real feature vector that produced the
        prediction and is skipped when it is not supplied.
        """
        self._meta.update(probs, was_correct)

        if features is None:
            return
        try:
            label = 1 if was_correct else 0
            self.sgd.partial_fit(np.asarray(features, dtype=float), label)
        except Exception as e:
            logger.debug(f"[Registry] SGD online update skipped: {e}")

    def _generate_reasons(
        self,
        features: np.ndarray,
        prob: float,
        regime: str,
        model_probs: dict,
        epistemic: float,
        feature_map: dict = None,
    ) -> list[str]:
        """
        Human-readable reasons.

        `feature_map` is the named mapping from `compute_features_dict`. It is passed in
        rather than reconstructed because `dict(zip(get_feature_names(), features))` was
        the exact line that produced wrong numbers: the name list was hand-maintained,
        37 long against a 59-value vector, and diverged after index 30 (Section 64).
        The names are now derived from the same builder, so the fallback below is also
        correct — but taking the caller's map avoids recomputing it at all.
        """
        reasons = []
        if feature_map is not None:
            feat_dict = feature_map
        else:
            from .features import get_feature_names
            names = get_feature_names()
            feat_dict = {n: float(features[i]) for i, n in enumerate(names) if i < len(features)}

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
            # `loaded` = can answer at all. `trained` = a fitted artifact was loaded.
            # These were one flag, which let RegimeAwareModel — a pure heuristic that
            # sets loaded=True in its constructor — count as a trained model in
            # /health. See spec Section 64.
            # `onlineSamples` is the third distinction Section 68 needed. A model fitted
            # incrementally from resolved outcomes is neither a heuristic nor a loaded
            # artifact, and reporting it as either is a false claim about provenance.
            "models": {
                m.name: {
                    "loaded":        m.is_available(),
                    "trained":       m.is_trained(),
                    "onlineSamples": int(getattr(m, "online_samples", 0)),
                    "type":          ("trained" if m.is_trained()
                                      else "online" if m.is_online_fitted()
                                      else "heuristic"),
                }
                for m in [self.lgbm, self.xgb, self.lstm, self.rf, self.mlp, self.sgd, self.regime, self.sentiment]
            },
            "ensemble_size":   len(self._base_models),
            "models_trained":  sum(1 for m in [self.lgbm, self.xgb, self.lstm, self.rf,
                                               self.mlp, self.sgd, self.regime, self.sentiment]
                                   if m.is_trained()),
            "models_online_fitted": sum(1 for m in [self.lgbm, self.xgb, self.lstm, self.rf,
                                                    self.mlp, self.sgd, self.regime, self.sentiment]
                                        if m.is_online_fitted()),
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

# Restore anything previously learned. Deliberately after construction rather than inside
# `__init__`: `outcomes` imports `store`, and doing that during this module's import would
# make the two mutually dependent at load time. A failure here leaves the uniform weights
# the constructor already set, so the process starts either way (I11).
try:
    MODEL_REGISTRY.load_meta_state()
except Exception as _e:                                   # pragma: no cover
    logger.warning(f"[Registry] meta-learner restore skipped: {_e}")
