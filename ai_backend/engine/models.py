"""
models.py — Individual model wrappers for the ensemble.

Each model implements:
    predict_proba(features: np.ndarray) -> float  (calibrated probability 0-1)

Models:
    1. LightGBMModel    — gradient boosting, fast, SHAP-explainable
    2. XGBoostModel     — gradient boosting, alternative to LightGBM
    3. LSTMModel        — sequential, captures temporal patterns (stub — needs torch)
    4. TFTModel         — Temporal Fusion Transformer (stub — needs pytorch-forecasting)
    5. SentimentModel   — FinBERT-based news sentiment (stub — needs transformers)

In production, each model is:
    - Trained offline on 3 years of walk-forward data
    - Saved as a signed, encrypted artifact
    - Loaded once at startup and kept in memory

For now, models return calibrated mock probabilities that degrade gracefully
until real training data and artifacts are available.
"""

import numpy as np
import logging
import os

logger = logging.getLogger("stockmind-ai.models")

# ── Base class ────────────────────────────────────────────────────────────────

class BaseModel:
    """
    TWO DIFFERENT QUESTIONS, previously answered by one flag (spec Section 64).

      `is_available()` — can this model produce a number at all?
      `is_trained()`   — did it load a fitted artifact from disk?

    `loaded` conflated them, and `RegimeAwareModel` sets `loaded = True` in its
    constructor with the comment "Always available (uses other models)". So a purely
    heuristic model counted as a trained one, and `/health` reported an artifact that
    does not exist. Every consumer that wants to know "should master trust this" wants
    `is_trained()`; only the ensemble loop wants `is_available()`.

    A THIRD QUESTION APPEARED once the outcome loop was actually connected
    (spec Section 68): `is_online_fitted()` — has this model been fitted incrementally
    from resolved outcomes, and on how many samples?

    `OnlineSGDModel.partial_fit` used to set `trained = True`, which is false as written:
    `trained` means an artifact was loaded from disk, and one online sample is not that.
    It went unnoticed because nothing ever called `partial_fit`. The moment the loop was
    wired, `/health` began reporting "1/7 models loaded from trained artifacts" after a
    single update. Provenance and state are different claims and now have different flags.
    """
    name: str = "base"
    loaded: bool = False        # can answer
    trained: bool = False       # loaded a fitted artifact from disk
    online_samples: int = 0     # incremental updates absorbed from resolved outcomes

    def predict_proba(self, features: np.ndarray) -> float:
        raise NotImplementedError

    def is_available(self) -> bool:
        return self.loaded

    def is_trained(self) -> bool:
        return bool(self.trained)

    def is_online_fitted(self) -> bool:
        return int(self.online_samples) > 0


# ── 1. LightGBM ───────────────────────────────────────────────────────────────

class LightGBMModel(BaseModel):
    name = "lightgbm"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            import lightgbm as lgb
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/lgbm_direction.txt")
            if os.path.exists(model_path):
                self.model = lgb.Booster(model_file=model_path)
                self.loaded = True
                self.trained = True
                logger.info("[LightGBM] Model loaded from disk")
            else:
                logger.info("[LightGBM] No saved model — will use mock until trained")
        except ImportError:
            logger.warning("[LightGBM] lightgbm not installed — pip install lightgbm")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.model is not None:
            prob = float(self.model.predict(features.reshape(1, -1))[0])
            return np.clip(prob, 0.05, 0.95)
        # Mock: use feature mean as a proxy for signal strength
        signal = float(np.tanh(np.mean(features[:5]) * 2))
        return float(np.clip(0.5 + signal * 0.3 + np.random.normal(0, 0.05), 0.35, 0.90))


# ── 2. XGBoost ────────────────────────────────────────────────────────────────

class XGBoostModel(BaseModel):
    name = "xgboost"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            import xgboost as xgb
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/xgb_direction.json")
            if os.path.exists(model_path):
                self.model = xgb.Booster()
                self.model.load_model(model_path)
                self.loaded = True
                self.trained = True
                logger.info("[XGBoost] Model loaded from disk")
            else:
                logger.info("[XGBoost] No saved model — will use mock until trained")
        except ImportError:
            logger.warning("[XGBoost] xgboost not installed — pip install xgboost")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.model is not None:
            import xgboost as xgb
            dmat = xgb.DMatrix(features.reshape(1, -1))
            prob = float(self.model.predict(dmat)[0])
            return np.clip(prob, 0.05, 0.95)
        signal = float(np.tanh(np.mean(features[5:10]) * 1.8))
        return float(np.clip(0.5 + signal * 0.28 + np.random.normal(0, 0.05), 0.35, 0.90))


# ── 3. LSTM (stub — requires PyTorch) ─────────────────────────────────────────

class LSTMModel(BaseModel):
    name = "lstm"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            import torch
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/lstm_direction.pt")
            if os.path.exists(model_path):
                self.model = torch.load(model_path, map_location="cpu")
                self.model.eval()
                self.loaded = True
                self.trained = True
                logger.info("[LSTM] Model loaded from disk")
            else:
                logger.info("[LSTM] No saved model — will use mock until trained")
        except ImportError:
            logger.info("[LSTM] torch not installed — install pytorch for LSTM support")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.model is not None:
            import torch
            with torch.no_grad():
                x = torch.FloatTensor(features).unsqueeze(0).unsqueeze(0)
                prob = float(torch.sigmoid(self.model(x)).item())
            return np.clip(prob, 0.05, 0.95)
        # Mock: use momentum-like features
        signal = float(np.tanh(np.mean(features[10:15]) * 2.2))
        return float(np.clip(0.5 + signal * 0.32 + np.random.normal(0, 0.06), 0.35, 0.90))


# ── 4. Sentiment model (stub — requires transformers) ─────────────────────────

class SentimentModel(BaseModel):
    name = "sentiment"

    def __init__(self):
        self.pipeline = None
        self._try_load()

    def _try_load(self):
        try:
            from transformers import pipeline
            logger.info("[Sentiment] Loading FinBERT — this may take a moment on first run...")
            self.pipeline = pipeline(
                "text-classification",
                model="ProsusAI/finbert",
                device=-1,  # CPU
            )
            self.loaded = True
            self.trained = True
            logger.info("[Sentiment] FinBERT loaded")
        except ImportError:
            logger.info("[Sentiment] transformers not installed — pip install transformers torch")
        except Exception as e:
            logger.warning(f"[Sentiment] Failed to load FinBERT: {e}")

    def predict_proba(self, text: str = "") -> float:
        """Returns bullish probability from news text."""
        if self.pipeline and text:
            result = self.pipeline(text[:512])[0]
            if result["label"] == "positive":
                return float(np.clip(0.5 + result["score"] * 0.4, 0.5, 0.90))
            elif result["label"] == "negative":
                return float(np.clip(0.5 - result["score"] * 0.4, 0.10, 0.5))
            return 0.5
        # Mock: neutral sentiment
        return 0.5 + np.random.normal(0, 0.05)

    def predict_proba_from_features(self, features: np.ndarray) -> float:
        """Fallback when no text is available — uses feature proxy."""
        return float(np.clip(0.5 + np.random.normal(0, 0.04), 0.35, 0.65))


# ── 5. Random Forest ──────────────────────────────────────────────────────────

class RandomForestModel(BaseModel):
    name = "random_forest"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            from sklearn.ensemble import RandomForestClassifier
            import joblib
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/rf_direction.pkl")
            if os.path.exists(model_path):
                self.model = joblib.load(model_path)
                self.loaded = True
                self.trained = True
                logger.info("[RandomForest] Model loaded from disk")
            else:
                # Bootstrap an untrained model — will use mock until trained
                self.model = RandomForestClassifier(
                    n_estimators=100, max_depth=8, min_samples_split=20,
                    class_weight='balanced', random_state=42, n_jobs=-1
                )
                logger.info("[RandomForest] No saved model — using mock until trained")
        except ImportError:
            logger.warning("[RandomForest] scikit-learn not installed")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.loaded and self.model is not None:
            try:
                proba = self.model.predict_proba(features.reshape(1, -1))[0]
                return float(np.clip(proba[1] if len(proba) > 1 else proba[0], 0.05, 0.95))
            except Exception:
                pass
        # Mock: tree-inspired — use feature thresholds
        signal = float(np.tanh(np.sum(features[:8]) * 0.15))
        return float(np.clip(0.5 + signal * 0.25 + np.random.normal(0, 0.04), 0.35, 0.90))


# ── 6. MLP Neural Network ─────────────────────────────────────────────────────

class MLPModel(BaseModel):
    name = "mlp"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            from sklearn.neural_network import MLPClassifier
            import joblib
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/mlp_direction.pkl")
            if os.path.exists(model_path):
                self.model = joblib.load(model_path)
                self.loaded = True
                self.trained = True
                logger.info("[MLP] Model loaded from disk")
            else:
                # Bootstrap architecture — 3 hidden layers
                self.model = MLPClassifier(
                    hidden_layer_sizes=(128, 64, 32),
                    activation='relu', solver='adam',
                    alpha=0.001, max_iter=500, random_state=42
                )
                logger.info("[MLP] No saved model — using mock until trained")
        except ImportError:
            logger.warning("[MLP] scikit-learn not installed")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.loaded and self.model is not None:
            try:
                proba = self.model.predict_proba(features.reshape(1, -1))[0]
                return float(np.clip(proba[1] if len(proba) > 1 else proba[0], 0.05, 0.95))
            except Exception:
                pass
        # Mock: uses higher-order feature interactions
        x = features[:12]
        signal = float(np.tanh(np.dot(x, np.sin(np.arange(1, len(x)+1) * 0.3)) * 0.2))
        return float(np.clip(0.5 + signal * 0.28 + np.random.normal(0, 0.045), 0.35, 0.90))


# ── 7. Online SGD (Incremental learner) ──────────────────────────────────────

class OnlineSGDModel(BaseModel):
    """
    Incremental learner — updates in real-time from each resolved outcome.
    Adapts faster than batch-trained models — ideal for regime changes.
    """
    name = "online_sgd"

    def __init__(self):
        self.model = None
        self.online_samples = 0
        self._classes_seen: set = set()
        self._n_features = None
        self._try_load()

    def _new_estimator(self):
        from sklearn.linear_model import SGDClassifier
        return SGDClassifier(loss='log_loss', penalty='elasticnet',
                             l1_ratio=0.15, alpha=0.0001,
                             learning_rate='optimal', random_state=42)

    def _reset_model(self):
        """Start over: a new estimator and zeroed counters, so nothing stale is claimed."""
        try:
            self.model = self._new_estimator()
        except Exception as e:
            logger.warning(f"[OnlineSGD] could not reset estimator: {e}")
            return
        self.online_samples = 0
        self._classes_seen = set()
        self._n_features = None
        self.trained = False

    def _try_load(self):
        try:
            from sklearn.linear_model import SGDClassifier
            import joblib
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/sgd_direction.pkl")
            if os.path.exists(model_path):
                self.model = joblib.load(model_path)
                self.loaded = True
                self.trained = True
                logger.info("[OnlineSGD] Model loaded from disk")
            else:
                self.model = SGDClassifier(
                    loss='log_loss', penalty='elasticnet',
                    l1_ratio=0.15, alpha=0.0001,
                    learning_rate='optimal', random_state=42
                )
                logger.info("[OnlineSGD] Ready for incremental learning")
        except ImportError:
            logger.warning("[OnlineSGD] scikit-learn not installed")

    # A logistic model fitted on a handful of samples is worse than the heuristic it
    # would replace, and one fitted on a single class is a constant. So the fitted path
    # only takes over once there is enough to beat what it displaces. See Section 68.
    MIN_ONLINE_SAMPLES = 50

    def partial_fit(self, features: np.ndarray, label: int):
        """
        Online update from one resolved outcome.

        DOES NOT SET `trained`. That flag means "an artifact was loaded from disk", and
        this is neither. It sets `online_samples`, and `predict_proba` consults the fitted
        model only past `MIN_ONLINE_SAMPLES` with both classes seen — before that the
        heuristic is the better answer, and switching at sample one would silently make
        every prediction worse the moment the learning loop was connected.

        A CHANGE IN FEATURE WIDTH RESETS THE MODEL rather than being warned about
        repeatedly. sklearn raises on a dimension mismatch, and the first version caught it
        and logged — so if the feature vector ever grew, every online update would fail
        forever, `online_samples` would sit at zero, and the only evidence would be a log
        line nobody reads. That is not hypothetical: adding derivative features is the next
        planned change. Resetting is also the honest response, because coefficients fitted
        against the old columns do not describe the new ones. See Section 68.
        """
        if self.model is None:
            return
        n = int(np.asarray(features).size)
        if self._n_features is not None and n != self._n_features:
            logger.warning(f"[OnlineSGD] feature width changed {self._n_features} -> {n}; "
                           f"discarding {self.online_samples} online samples — coefficients "
                           f"fitted on the old feature set do not describe the new one")
            self._reset_model()
        try:
            self.model.partial_fit(np.asarray(features, dtype=float).reshape(1, -1),
                                   [label], classes=[0, 1])
            self._n_features = n
            self.online_samples += 1
            self._classes_seen.add(int(label))
            self.loaded = True
        except Exception as e:
            logger.warning(f"[OnlineSGD] partial_fit error: {e}")

    def online_ready(self) -> bool:
        return (self.online_samples >= self.MIN_ONLINE_SAMPLES
                and len(self._classes_seen) >= 2)

    def predict_proba(self, features: np.ndarray) -> float:
        use_fitted = self.model is not None and (self.trained or self.online_ready())
        if use_fitted:
            try:
                proba = self.model.predict_proba(features.reshape(1, -1))[0]
                return float(np.clip(proba[1] if len(proba) > 1 else proba[0], 0.05, 0.95))
            except Exception:
                pass
        # Mock: linear combination with recency bias
        signal = float(np.tanh(np.mean(features[-8:]) * 1.5))
        return float(np.clip(0.5 + signal * 0.20 + np.random.normal(0, 0.04), 0.35, 0.88))


# ── 8. Regime-Aware Ensemble ──────────────────────────────────────────────────

class RegimeAwareModel(BaseModel):
    """
    Detects current market regime and selects the best sub-model dynamically.
    Regimes: trending | ranging | volatile | low_liquidity
    """
    name = "regime_aware"

    def __init__(self):
        self.loaded = True  # Always available (uses other models)
        self._regime_params = {
            "trending":      {"weight_trend": 0.6, "weight_reversion": 0.2, "weight_vol": 0.2},
            "ranging":       {"weight_trend": 0.2, "weight_reversion": 0.6, "weight_vol": 0.2},
            "volatile":      {"weight_trend": 0.3, "weight_reversion": 0.2, "weight_vol": 0.5},
            "low_liquidity": {"weight_trend": 0.5, "weight_reversion": 0.3, "weight_vol": 0.2},
        }

    def detect_regime(self, features: np.ndarray, feature_map: dict = None) -> str:
        """
        Detect market regime from named features.

        WHAT WAS WRONG (spec Section 64). This read positional indices with the comment
        "atr14_pct=8, adx14=15, bb_width=10, rsi14=12". **Only index 8 was correct.**
        Index 15 is `ema10_slope`, 10 is `parkinson_vol`, and 12 is `bb_position` — so
        an EMA slope was being tested against an ADX threshold of 0.30 and a Parkinson
        volatility against a Bollinger-width threshold. Every regime decision, and the
        regime-conditioned calibration weight that follows from it, was reading
        unrelated quantities.

        Now resolved by name. `feature_map` is passed by the registry; the positional
        fallback exists only so a bare array still produces a defensible answer, and it
        resolves the indices from `get_feature_names()` rather than guessing them.
        """
        try:
            fm = feature_map
            if fm is None:
                from .features import get_feature_names
                names = get_feature_names()
                fm = {n: float(features[i]) for i, n in enumerate(names) if i < len(features)}

            atr_pct  = float(fm.get("atr14_pct", 0.01))
            adx      = float(fm.get("adx14", 0.25))
            bb_width = float(fm.get("bb_width", 0.02))
        except Exception:
            return "trending"

        if atr_pct > 0.025:   return "volatile"
        if adx > 0.30:        return "trending"
        if bb_width < 0.015:  return "ranging"
        return "trending"

    def predict_proba(self, features: np.ndarray) -> float:
        regime = self.detect_regime(features)
        params = self._regime_params.get(regime, self._regime_params["trending"])

        # Trend signal: momentum features
        trend_sig = float(np.tanh(np.mean(features[3:8]) * 2.0))
        # Reversion signal: oscillator features (RSI area)
        rev_sig   = float(np.tanh(-np.mean(features[11:14]) * 1.5))
        # Volatility signal: vol features
        vol_sig   = float(np.tanh(np.mean(features[8:11]) * 1.2))

        combined = (
            trend_sig   * params["weight_trend"] +
            rev_sig     * params["weight_reversion"] +
            vol_sig     * params["weight_vol"]
        )
        return float(np.clip(0.5 + combined * 0.30 + np.random.normal(0, 0.035), 0.35, 0.92))
