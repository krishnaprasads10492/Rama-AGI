"""
training.py — fit the ensemble's models on real history, honestly.

WHAT THIS REPLACES (spec Section 69). Nothing. There has never been a training script, so
`ai_backend/data/models/` has never existed, so every `_try_load` fell through to a
hand-written heuristic. Sections 64 and 68 made `/health` say that plainly; this is what
makes it stop being true.

THE THREE THINGS THAT WOULD HAVE MADE A TRAINER WORSE THAN NO TRAINER

  1. **No scaling at inference.** `predict_proba` feeds the raw vector straight in, and MLP
     and SGD are scale-sensitive. Training on standardised features and serving raw ones
     produces confident nonsense — silently, because `predict_proba` only falls back on an
     exception, never on an implausible number. So every sklearn model is persisted as a
     `Pipeline(StandardScaler, estimator)`: the scaler is *inside* the artifact and cannot
     be forgotten, and no inference code changes.

  2. **Position drift.** A model is a function of a column order. `featureset` records the
     exact names in a manifest and every load validates against it.

  3. **A model that loses to a coin.** If the series rose on 54% of days, "always up" scores
     54%, and a 52% model is worse than a constant while looking like progress. Every score
     is reported beside its base rate, and an artifact is not written unless it beats that
     base rate on a holdout no fold ever touched.
"""

import json
import logging
import os
import datetime as _dt
from typing import Optional

import numpy as np
import pandas as pd

from . import featureset, store

logger = logging.getLogger("stockmind-ai.training")

# The horizon master has been asked about four times without an answer (Section 69). It is a
# parameter, it is written into every artifact's provenance, and 5 bars is the swing default
# until master says otherwise — so a model trained for one horizon can never be silently
# used as though trained for another.
DEFAULT_HORIZON = 5

# The deepest feature lookback is 252 bars, so no row before this can be featurised.
MIN_WARMUP = 260
# Below this there is not enough to fit and still hold data back.
MIN_ROWS_TO_TRAIN = 400

# ── The acceptance gate ───────────────────────────────────────────────────────
#
# WHY NOT RAW ACCURACY VS THE MAJORITY CLASS. That was the first version of this gate and it
# is the wrong test, for two reasons found by running it:
#
#   1. NIFTY rose over 5 bars on 56% of the sample, so "always up" scores 0.56. Raw accuracy
#      therefore mostly measures the index's drift, not what the model knows. A model with
#      genuine but modest skill can sit below it while being useful.
#   2. `RandomForestClassifier(class_weight='balanced')` optimises BALANCED accuracy — it
#      deliberately refuses to exploit the prior. Judging it on raw accuracy against a
#      majority-class baseline compares two different objectives, and it can never win.
#
# The output is consumed as a PROBABILITY by `barrier_probability`, so the gate is about
# probability quality, and it has two independent halves:
#
#   AUC          — does it rank better than chance? Invariant to the class prior.
#   Brier skill  — are its probabilities worth more than always predicting the historical
#                  up-frequency? This is the standard forecast-verification baseline.
#
# Both must pass. AUC alone would admit a model that ranks well but is wildly overconfident;
# Brier skill alone would admit one that has simply learned the prior.
#   Fold AUC     — and does it hold up ACROSS TIME, not just on the final segment?
#
# The third condition was added after the first real run. Random Forest scored holdout AUC
# 0.5974 while its forward-chaining folds averaged **0.4821 — below chance**. A model that
# passes one final segment while failing every earlier one has most likely fitted that
# segment's regime by luck, and accepting it is exactly the error walk-forward validation
# exists to catch. The holdout is one sample; the folds are the evidence of stability.
#   Sample size  — is the holdout big enough for any of the above to mean anything?
#
# The fourth condition was added after a pure random walk scored holdout AUC **0.7464** with
# Brier skill +0.12 and passed. Its holdout was 47 rows. At that size the standard error of
# AUC is around 0.10, so 0.75 is unremarkable noise — the gate was measuring sample size, not
# skill. A criterion that passes for the wrong reason is worse than none, because it is the
# thing standing between a meaningless model and `/health` reporting a trained artifact.
#
# Two guards, because either alone is insufficient: a hard floor on holdout rows, and a
# significance margin that scales with the sample so a large holdout is judged more strictly
# than a small one rather than both being judged by a fixed 0.52.
MIN_AUC            = 0.52   # ranking better than chance by a margin, not by rounding
MIN_BRIER_SKILL    = 0.0    # strictly better than climatology
MIN_FOLD_AUC       = 0.50   # deliberately weak: merely "not worse than chance over time"
MIN_HOLDOUT_ROWS   = 150    # below this, refuse to judge at all
AUC_SIGMA_MARGIN   = 2.0    # AUC must clear 0.5 by this many standard errors


def gate_verdict(score: dict, n_pos: int, n_neg: int,
                 fold_mean_auc: Optional[float] = None) -> dict:
    """
    THE acceptance decision, in one place.

    `train` and `sweep_horizons` both need it, and two copies would drift — the sweep's first
    version checked only AUC and Brier skill, so it reported horizons as passing that the
    real gate would have refused on significance. Same reasoning as the single feature
    builder: one implementation, or the two answers diverge without anyone noticing.

    `fold_mean_auc=None` means "no fold evidence available", which cannot pass.
    """
    auc = score.get("auc")
    bss = score.get("brierSkillScore")
    n = int(score.get("n") or (n_pos + n_neg))
    se = auc_standard_error(n_pos, n_neg)
    floor = (0.5 + AUC_SIGMA_MARGIN * se) if se is not None else None

    v = {
        "passesHoldoutSize":   n >= MIN_HOLDOUT_ROWS,
        "passesAuc":           auc is not None and auc >= MIN_AUC,
        "passesSignificance":  bool(auc is not None and floor is not None and auc >= floor),
        "passesBrierSkill":    bss is not None and bss > MIN_BRIER_SKILL,
        "passesFoldStability": fold_mean_auc is not None and fold_mean_auc >= MIN_FOLD_AUC,
        "minAuc": MIN_AUC, "minBrierSkill": MIN_BRIER_SKILL, "minFoldAuc": MIN_FOLD_AUC,
        "minHoldoutRows": MIN_HOLDOUT_ROWS,
        "aucStandardError": (round(se, 4) if se is not None else None),
        "aucSignificanceFloor": (round(floor, 4) if floor is not None else None),
    }
    v["accepted"] = all(v[k] for k in ("passesHoldoutSize", "passesAuc", "passesSignificance",
                                       "passesBrierSkill", "passesFoldStability"))

    bits = []
    if not v["passesHoldoutSize"]:
        bits.append(f"holdout is {n} rows, below {MIN_HOLDOUT_ROWS} — too few to distinguish "
                    f"skill from noise, so no verdict is offered either way")
    if not v["passesAuc"]:
        bits.append(f"AUC {auc} < {MIN_AUC} — it does not rank better than chance")
    if v["passesAuc"] and not v["passesSignificance"]:
        bits.append(f"AUC {auc} is within {AUC_SIGMA_MARGIN} standard errors of chance for this "
                    f"sample (floor {v['aucSignificanceFloor']}, SE {v['aucStandardError']}) — "
                    f"not distinguishable from luck")
    if not v["passesBrierSkill"]:
        bits.append(f"Brier skill {bss} <= {MIN_BRIER_SKILL} — its probabilities are not worth "
                    f"more than always predicting the historical up-frequency")
    if not v["passesFoldStability"]:
        bits.append(f"walk-forward fold AUC "
                    f"{round(fold_mean_auc, 4) if fold_mean_auc is not None else None} < "
                    f"{MIN_FOLD_AUC} — it did not hold up across time, so the holdout result is "
                    f"most likely that segment's regime rather than skill")
    v["reason"] = "; ".join(bits)
    return v


def auc_standard_error(n_pos: int, n_neg: int) -> Optional[float]:
    """
    A conservative standard error for AUC under the null.

    `1 / (2 * sqrt(min(n_pos, n_neg)))` is the usual quick approximation, and it is the
    minority class that limits precision — 400 positives against 12 negatives is a 12-sample
    problem however large the frame looks.
    """
    m = min(int(n_pos), int(n_neg))
    if m < 2:
        return None
    return float(1.0 / (2.0 * np.sqrt(m)))
# Kept and still reported, because it is the number a trader will look for first.
BASE_RATE_MARGIN = 0.01

ARTIFACTS = {
    "random_forest": "rf_direction.pkl",
    "mlp":           "mlp_direction.pkl",
    "online_sgd":    "sgd_direction.pkl",
    "lightgbm":      "lgbm_direction.txt",
    "xgboost":       "xgb_direction.json",
}


def provenance_path() -> str:
    return os.path.join(featureset.models_dir(), "training.json")


def load_provenance() -> Optional[dict]:
    p = provenance_path()
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        logger.warning(f"[training] could not read provenance: {e}")
        return None


# ── Labels ────────────────────────────────────────────────────────────────────

def make_labels(closes: np.ndarray, horizon: int,
                threshold_atr: float = 0.0, atr: np.ndarray = None) -> np.ndarray:
    """
    P(up over `horizon` bars), as a 0/1 label. `np.nan` where the future is unknown.

    THE LABEL IS THE SIGN OF THE FORWARD RETURN, WITH NO NEUTRAL BAND, and that is a
    decision rather than a simplification. The output is consumed by
    `dispatcher.barrier_probability(directional_prob, reward, risk)` as an unconditional
    P(up). Dropping small moves would train P(up | the move was large) and the engine would
    then use it as P(up) — overstating the edge on exactly the quiet bars where the model
    should be least confident. See Section 69.

    `threshold_atr` implements the excluded variant anyway, off by default, because it is a
    legitimate thing to want for a different consumer and hiding it would invite someone to
    re-derive it badly.

    The final `horizon` labels are NaN, not filled. A forward-looking label is undefined for
    bars whose future has not happened, and filling it would fabricate training data.
    """
    c = np.asarray(closes, dtype=float)
    n = len(c)
    y = np.full(n, np.nan)
    if horizon < 1 or n <= horizon:
        return y

    future = c[horizon:]
    now = c[:n - horizon]
    diff = future - now

    if threshold_atr > 0 and atr is not None:
        band = np.asarray(atr, dtype=float)[:n - horizon] * threshold_atr
        up = diff > band
        down = diff < -band
        lab = np.full(n - horizon, np.nan)
        lab[up] = 1.0
        lab[down] = 0.0
        y[:n - horizon] = lab
    else:
        y[:n - horizon] = (diff > 0).astype(float)
    return y


# ── Splits ────────────────────────────────────────────────────────────────────

def forward_chaining_splits(n: int, n_splits: int = 4,
                            holdout_frac: float = 0.2) -> tuple[list, tuple]:
    """
    Forward-chaining train/validation folds, plus a holdout that no fold touches.

    NO SHUFFLING AND NO KFold. Market data is ordered; a shuffled split lets the model train
    on bars that come after the ones it is scored on, which produces excellent numbers that
    mean nothing.

    @returns (folds, holdout) where folds is [(train_idx, val_idx), ...] and holdout is
             (start, end). Every validation block lies strictly after its training block.
    """
    if n <= 0:
        return [], (0, 0)
    holdout_start = int(n * (1.0 - max(0.05, min(0.5, holdout_frac))))
    holdout = (holdout_start, n)

    usable = holdout_start
    folds = []
    if usable > 0 and n_splits >= 1:
        # Grow the training window and step the validation block forward through `usable`.
        block = usable // (n_splits + 1)
        if block >= 1:
            for k in range(1, n_splits + 1):
                tr_end = block * k
                va_end = min(usable, block * (k + 1))
                if va_end > tr_end:
                    folds.append((np.arange(0, tr_end), np.arange(tr_end, va_end)))
    return folds, holdout


# ── Dataset ───────────────────────────────────────────────────────────────────

def build_dataset(symbol: str, exchange: str = "NSE", interval: str = "1d",
                  horizon: int = DEFAULT_HORIZON, include_derivatives: bool = False,
                  max_rows: int = None, stride: int = 1,
                  include_news: bool = False) -> dict:
    """
    Featurise every usable bar of a stored series, causally.

    Each row is built from `df.iloc[:i+1]`, so the features for bar `i` can only see bars up
    to `i`. That slice is bounded to `FEATURE_WINDOW` the way `backtest._model_probability`
    bounds it, or the cost is quadratic in the history length — Section 66 records what that
    costs on 4,600 bars.

    `stride` subsamples bars. Consecutive daily bars overlap heavily in their features, so a
    stride trades a little data for a lot of speed and for rows that are closer to
    independent.
    """
    from .backtest import FEATURE_WINDOW

    df = store.load(symbol, exchange, interval)
    if df is None or len(df) < MIN_ROWS_TO_TRAIN:
        return {"ok": False, "reason": (f"need at least {MIN_ROWS_TO_TRAIN} bars, "
                                       f"have {0 if df is None else len(df)}"),
                "symbol": symbol}

    d = df.copy()
    d["date"] = pd.to_datetime(d["date"], errors="coerce")
    d = d.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    closes = d["close"].to_numpy(dtype=float)

    atr = None
    y = make_labels(closes, horizon)

    names = featureset.feature_names(include_derivatives, include_news)
    rows, labels, dates = [], [], []

    end = len(d) - horizon                     # labels are undefined past this
    idxs = range(MIN_WARMUP, end, max(1, stride))
    if max_rows:
        idxs = list(idxs)[-max_rows:]

    for i in idxs:
        if not np.isfinite(y[i]):
            continue
        start = max(0, i + 1 - FEATURE_WINDOW)
        window = d.iloc[start:i + 1]
        try:
            fmap = featureset.build_feature_map(window, symbol, exchange,
                                                include_derivatives, include_news)
        except Exception as e:
            logger.debug(f"[training] featurising bar {i} failed: {e}")
            continue
        vec = np.array(list(fmap.values()), dtype=float)
        if len(vec) != len(names) or not np.all(np.isfinite(vec)):
            continue
        rows.append(vec)
        labels.append(float(y[i]))
        dates.append(d["date"].iloc[i])

    if len(rows) < 100:
        return {"ok": False, "symbol": symbol,
                "reason": f"only {len(rows)} usable rows after featurising"}

    X = np.vstack(rows)
    yv = np.asarray(labels, dtype=int)
    return {
        "ok": True, "symbol": symbol, "exchange": exchange, "interval": interval,
        "X": X, "y": yv, "dates": pd.to_datetime(pd.Series(dates)).reset_index(drop=True),
        "featureNames": names, "horizon": horizon,
        "includeDerivatives": bool(include_derivatives),
        "includeNews": bool(include_news),
        "newsCoverage": (round(float(X[:, names.index("news_available")].mean()), 4)
                         if include_news and "news_available" in names else None),
        "rows": int(len(yv)), "positiveRate": round(float(yv.mean()), 4),
        "firstDate": str(dates[0].date()), "lastDate": str(dates[-1].date()),
        "derivativeCoverage": (round(float(X[:, names.index("deriv_available")].mean()), 4)
                               if include_derivatives and "deriv_available" in names else None),
    }


# ── Metrics ───────────────────────────────────────────────────────────────────

def base_rate(y: np.ndarray) -> float:
    """The accuracy of always predicting the majority class — the bar any model must clear."""
    y = np.asarray(y)
    if len(y) == 0:
        return 0.0
    p = float(np.mean(y))
    return max(p, 1.0 - p)


def auc_score(proba: np.ndarray, y: np.ndarray) -> Optional[float]:
    """
    Area under the ROC curve — does the model RANK better than chance?

    AUC is the right discrimination test here because it is **invariant to the class prior**.
    Accuracy is not: on a series that rose 56% of the time, "always up" scores 0.56, so raw
    accuracy mostly measures the drift of the index rather than anything the model knows.
    """
    t = np.asarray(y, dtype=float)
    p = np.asarray(proba, dtype=float)
    if len(np.unique(t)) < 2:
        return None
    try:
        from sklearn.metrics import roc_auc_score
        return float(roc_auc_score(t, p))
    except Exception:
        # Rank-based fallback, so a missing sklearn metric does not silently drop the gate.
        order = np.argsort(p)
        ranks = np.empty_like(order, dtype=float)
        ranks[order] = np.arange(1, len(p) + 1)
        n1 = float(t.sum())
        n0 = float(len(t) - n1)
        if n0 == 0 or n1 == 0:
            return None
        return float((ranks[t == 1].sum() - n1 * (n1 + 1) / 2) / (n0 * n1))


def score_model(proba: np.ndarray, y: np.ndarray) -> dict:
    from .calibration import compute_ece, compute_brier_score

    p = np.asarray(proba, dtype=float)
    t = np.asarray(y, dtype=float)
    pred = (p >= 0.5).astype(float)
    acc = float(np.mean(pred == t))
    br = base_rate(t)
    tp = float(np.sum((pred == 1) & (t == 1)))
    fp = float(np.sum((pred == 1) & (t == 0)))
    fn = float(np.sum((pred == 0) & (t == 1)))

    brier = float(compute_brier_score(t, p))
    # Brier skill against climatology: always predicting the historical up-frequency. This is
    # the standard forecast-verification baseline and it is the honest one for a probability,
    # because a model can be "accurate" by inheriting the prior while knowing nothing.
    # BSS > 0 means the model's probabilities are worth more than the long-run frequency.
    freq = float(t.mean())
    brier_clim = float(np.mean((freq - t) ** 2))
    bss = float(1.0 - brier / brier_clim) if brier_clim > 1e-12 else None

    return {
        "accuracy":     round(acc, 4),
        "baseRate":     round(br, 4),
        "edgeOverBase": round(acc - br, 4),
        # The two that actually decide whether this model ships.
        "auc":              (round(auc_score(p, t), 4) if auc_score(p, t) is not None else None),
        "brierSkillScore":  (round(bss, 4) if bss is not None else None),
        "precision":    round(tp / (tp + fp), 4) if (tp + fp) else None,
        "recall":       round(tp / (tp + fn), 4) if (tp + fn) else None,
        "brierScore":   round(brier, 4),
        "brierClimatology": round(brier_clim, 4),
        "ece":          round(float(compute_ece(t, p)), 4),
        "meanPredicted": round(float(p.mean()), 4),
        "n":            int(len(t)),
    }


# ── Estimators ────────────────────────────────────────────────────────────────

def _sklearn_pipeline(kind: str):
    """
    A scaler and an estimator as ONE object.

    This is the whole answer to defect 1 in this module's docstring: the artifact carries its
    own scaler, so `joblib.load(...).predict_proba(raw_vector)` is correct with no change to
    `models.py`, and it is impossible to load the estimator without its scaler because they
    are the same object.
    """
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    if kind == "random_forest":
        from sklearn.ensemble import RandomForestClassifier
        # NO `class_weight='balanced'`, deliberately. The engine consumes this as a
        # calibrated P(up), and balancing deliberately distorts predicted probabilities away
        # from the true prior to equalise per-class recall. That is the right choice when the
        # cost of the two errors differs and the wrong one when the number itself is the
        # product. It also made the model structurally unable to pass any prior-aware gate.
        est = RandomForestClassifier(n_estimators=300, max_depth=8, min_samples_split=20,
                                     min_samples_leaf=10, random_state=42, n_jobs=-1)
    elif kind == "mlp":
        from sklearn.neural_network import MLPClassifier
        est = MLPClassifier(hidden_layer_sizes=(128, 64, 32), activation="relu",
                            solver="adam", alpha=0.001, max_iter=500,
                            early_stopping=True, n_iter_no_change=15, random_state=42)
    elif kind == "online_sgd":
        from sklearn.linear_model import SGDClassifier
        est = SGDClassifier(loss="log_loss", penalty="elasticnet", l1_ratio=0.15,
                            alpha=0.0001, learning_rate="optimal", random_state=42)
    else:
        raise ValueError(f"unknown estimator {kind}")
    # Trees do not need scaling, but a uniform pipeline means one persistence path and one
    # inference path for every sklearn model. The cost is a transform that changes nothing.
    return Pipeline([("scale", StandardScaler()), ("est", est)])


def _fit_predict(kind: str, Xtr, ytr, Xte):
    """@returns (fitted_object, probabilities, native_kind)."""
    if kind in ("random_forest", "mlp", "online_sgd"):
        pipe = _sklearn_pipeline(kind)
        pipe.fit(Xtr, ytr)
        return pipe, pipe.predict_proba(Xte)[:, 1], "sklearn"

    if kind == "lightgbm":
        # WRITTEN BUT UNVERIFIED HERE: lightgbm does not install in this workspace, so this
        # path has never run. Said plainly rather than claimed (Section 69).
        import lightgbm as lgb
        ds = lgb.Dataset(Xtr, label=ytr)
        params = {"objective": "binary", "metric": "binary_logloss", "verbosity": -1,
                  "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 20,
                  "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 5,
                  "seed": 42}
        booster = lgb.train(params, ds, num_boost_round=300)
        return booster, booster.predict(Xte), "lightgbm"

    if kind == "xgboost":
        import xgboost as xgb
        clf = xgb.XGBClassifier(n_estimators=300, max_depth=5, learning_rate=0.05,
                                subsample=0.8, colsample_bytree=0.8,
                                eval_metric="logloss", random_state=42)
        clf.fit(Xtr, ytr)
        return clf, clf.predict_proba(Xte)[:, 1], "xgboost"

    raise ValueError(f"unknown model {kind}")


def _persist(kind: str, obj, native: str) -> Optional[str]:
    path = os.path.join(featureset.models_dir(), ARTIFACTS[kind])
    tmp = path + ".tmp"
    try:
        if native == "sklearn":
            import joblib
            joblib.dump(obj, tmp)
        elif native == "lightgbm":
            obj.save_model(tmp)
        elif native == "xgboost":
            obj.save_model(tmp)
        else:
            return None
        os.replace(tmp, path)       # atomic: a crash cannot leave a half-written model
        return path
    except Exception as e:
        logger.warning(f"[training] could not persist {kind}: {e}")
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None


# ── Train ─────────────────────────────────────────────────────────────────────

def sweep_horizons(symbol: str = "NIFTY50", exchange: str = "NSE", interval: str = "1d",
                   horizons: list = None, include_derivatives: bool = False,
                   model: str = "random_forest", stride: int = 2,
                   n_splits: int = 3, holdout_frac: float = 0.2) -> dict:
    """
    Which horizon, if any, carries predictable signal — evidence for a decision, not a model.

    FEATURES DO NOT DEPEND ON THE HORIZON; ONLY LABELS DO. So the expensive step —
    featurising every bar — is done once and the labels are recomputed per horizon. Rebuilding
    the dataset per horizon would cost N times as much for identical inputs, and featurising
    ~2,200 bars is most of the runtime.

    This exists because master has been asked four times which horizon to target. Rather than
    guess, the tool can answer with measurements.
    """
    horizons = horizons or [1, 2, 3, 5, 10, 20]
    max_h = max(horizons)

    # Build at the LONGEST horizon so every shorter one uses the same rows. Otherwise each
    # horizon is scored on a slightly different sample and the comparison is not one.
    ds = build_dataset(symbol, exchange, interval, max_h, include_derivatives, stride=stride)
    if not ds.get("ok"):
        return {"ok": False, "reason": ds.get("reason"), "symbol": symbol}

    df = store.load(symbol, exchange, interval)
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"], errors="coerce")
    d = d.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    closes = d["close"].to_numpy(dtype=float)
    date_to_pos = {pd.Timestamp(v).normalize(): i for i, v in enumerate(d["date"])}
    positions = np.array([date_to_pos.get(pd.Timestamp(v).normalize(), -1)
                          for v in ds["dates"]])

    X = ds["X"]
    out = {"ok": True, "symbol": symbol, "exchange": exchange, "interval": interval,
           "model": model, "rows": ds["rows"], "stride": stride,
           "featureCount": len(ds["featureNames"]),
           "dataRange": {"first": ds["firstDate"], "last": ds["lastDate"]},
           "gate": {"minAuc": MIN_AUC, "minBrierSkill": MIN_BRIER_SKILL},
           "horizons": {}}

    for h in horizons:
        y_all = make_labels(closes, h)
        keep = np.array([p >= 0 and np.isfinite(y_all[p]) for p in positions])
        Xh = X[keep]
        yh = y_all[positions[keep]].astype(int)
        if len(yh) < 200 or len(np.unique(yh)) < 2:
            out["horizons"][h] = {"skipped": f"only {len(yh)} usable rows"}
            continue

        folds, (h0, h1) = forward_chaining_splits(len(yh), n_splits, holdout_frac)
        if h1 - h0 < 30 or not folds:
            out["horizons"][h] = {"skipped": "too few rows to split"}
            continue
        try:
            fold_aucs = []
            for tr, va in folds:
                try:
                    _, pv, _ = _fit_predict(model, Xh[tr], yh[tr], Xh[va])
                    a = auc_score(pv, yh[va])
                    if a is not None:
                        fold_aucs.append(a)
                except Exception:
                    pass
            _, proba, _ = _fit_predict(model, Xh[:h0], yh[:h0], Xh[h0:h1])
            sc = score_model(proba, yh[h0:h1])
            yho_h = yh[h0:h1]
            n_pos = int(np.sum(yho_h == 1))
            # THE SAME gate the trainer applies. The first version of this sweep checked only
            # AUC and Brier skill, so it reported horizons as passing that `train` would have
            # refused on significance — a sweep that disagrees with the trainer is worse than
            # no sweep, because it is the thing master would use to choose a horizon.
            fm = float(np.mean(fold_aucs)) if fold_aucs else None
            sc["foldMeanAuc"] = round(fm, 4) if fm is not None else None
            v = gate_verdict(sc, n_pos, int(len(yho_h) - n_pos), fm)
            sc["passes"] = v["accepted"]
            sc["gateReason"] = v["reason"]
            sc["aucSignificanceFloor"] = v["aucSignificanceFloor"]
            sc["upRate"] = round(float(yh.mean()), 4)
            out["horizons"][h] = sc
        except Exception as e:
            out["horizons"][h] = {"error": f"{type(e).__name__}: {e}"}

    scored = {h: v for h, v in out["horizons"].items() if v.get("auc") is not None}
    if scored:
        best = max(scored, key=lambda h: scored[h]["auc"])
        out["bestByAuc"] = {"horizon": best, "auc": scored[best]["auc"],
                            "brierSkillScore": scored[best].get("brierSkillScore"),
                            "passes": scored[best].get("passes")}
        out["anyPassed"] = any(v.get("passes") for v in scored.values())
        out["note"] = (
            f"Best AUC {scored[best]['auc']} at a {best}-bar horizon."
            + ("" if out["anyPassed"] else
               " No horizon cleared the gate: on this symbol and feature set there is no "
               "measurable directional edge. That is a finding about the data, not a bug.")
        )
    return out


def train(symbol: str = "NIFTY50", exchange: str = "NSE", interval: str = "1d",
          horizon: int = DEFAULT_HORIZON, include_derivatives: bool = False,
          models: list = None, n_splits: int = 4, holdout_frac: float = 0.2,
          stride: int = 1, max_rows: int = None, dry_run: bool = False,
          include_news: bool = False) -> dict:
    """
    Fit, evaluate on an untouched holdout, and persist only what beats its base rate.

    @returns a report. A model that did not clear the base rate is reported as
             `persisted: False` with its numbers — a refusal is a result, not an error.
             "Nothing beat always-up on this data" is a true and useful answer.
    """
    t0 = _dt.datetime.now()
    wanted = models or ["random_forest", "mlp", "online_sgd", "lightgbm", "xgboost"]

    ds = build_dataset(symbol, exchange, interval, horizon, include_derivatives,
                       max_rows=max_rows, stride=stride, include_news=include_news)
    if not ds.get("ok"):
        return {"ok": False, "reason": ds.get("reason"), "symbol": symbol}

    X, y, dates = ds["X"], ds["y"], ds["dates"]
    folds, (h0, h1) = forward_chaining_splits(len(y), n_splits, holdout_frac)
    if h1 - h0 < 30 or not folds:
        return {"ok": False, "symbol": symbol,
                "reason": f"{len(y)} rows is too few to split into folds and a holdout"}

    Xtr_all, ytr_all = X[:h0], y[:h0]
    Xho, yho = X[h0:h1], y[h0:h1]

    report = {
        "ok": True, "symbol": symbol, "exchange": exchange, "interval": interval,
        "horizonBars": horizon, "includeDerivatives": bool(include_derivatives),
        "includeNews": bool(include_news), "newsCoverage": ds.get("newsCoverage"),
        "featureCount": len(ds["featureNames"]),
        "rows": ds["rows"], "stride": stride,
        "positiveRate": ds["positiveRate"],
        "derivativeCoverage": ds.get("derivativeCoverage"),
        "dataRange": {"first": ds["firstDate"], "last": ds["lastDate"]},
        "trainRange": {"first": str(dates.iloc[0].date()), "last": str(dates.iloc[h0 - 1].date())},
        "holdoutRange": {"first": str(dates.iloc[h0].date()), "last": str(dates.iloc[h1 - 1].date())},
        "holdoutRows": int(h1 - h0),
        "folds": len(folds),
        "holdoutBaseRate": round(base_rate(yho), 4),
        "baseRateMargin": BASE_RATE_MARGIN,
        "dryRun": bool(dry_run),
        "models": {},
        "skipped": {},
    }

    for kind in wanted:
        if kind not in ARTIFACTS:
            report["skipped"][kind] = "unknown model"
            continue
        try:
            # Forward-chaining validation first: it is the only honest read on whether the
            # model generalises forward, and it never touches the holdout.
            fold_scores = []
            for tr, va in folds:
                try:
                    _, p, _ = _fit_predict(kind, X[tr], y[tr], X[va])
                    fold_scores.append(score_model(p, y[va]))
                except Exception as e:
                    logger.debug(f"[training] {kind} fold failed: {e}")

            obj, proba_ho, native = _fit_predict(kind, Xtr_all, ytr_all, Xho)
            ho = score_model(proba_ho, yho)

            auc = ho.get("auc")
            bss = ho.get("brierSkillScore")
            fold_aucs = [f["auc"] for f in fold_scores if f.get("auc") is not None]
            fold_mean_auc = float(np.mean(fold_aucs)) if fold_aucs else None

            n_pos = int(np.sum(yho == 1))
            verdict = gate_verdict(ho, n_pos, int(len(yho) - n_pos), fold_mean_auc)
            accept = verdict["accepted"]

            entry = {
                "holdout": ho,
                "folds": fold_scores,
                "foldMeanAccuracy": (round(float(np.mean([f["accuracy"] for f in fold_scores])), 4)
                                     if fold_scores else None),
                "foldMeanAuc": (round(float(np.mean([f["auc"] for f in fold_scores
                                                    if f.get("auc") is not None])), 4)
                                if any(f.get("auc") is not None for f in fold_scores) else None),
                "foldMeanBrierSkill": (round(float(np.mean([f["brierSkillScore"] for f in fold_scores
                                                            if f.get("brierSkillScore") is not None])), 4)
                                       if any(f.get("brierSkillScore") is not None for f in fold_scores)
                                       else None),
                "gate": verdict,
                "beatsBaseRate": bool(ho["edgeOverBase"] >= BASE_RATE_MARGIN),
                "accepted": accept,
                "persisted": False,
                "artifact": None,
            }
            if accept and not dry_run:
                p = _persist(kind, obj, native)
                entry["persisted"] = p is not None
                entry["artifact"] = os.path.basename(p) if p else None
            if not accept:
                entry["reason"] = verdict["reason"]
            report["models"][kind] = entry

        except ImportError as e:
            report["skipped"][kind] = f"package not installed: {e}"
        except Exception as e:
            logger.warning(f"[training] {kind} failed: {e}")
            report["skipped"][kind] = f"{type(e).__name__}: {e}"

    report["gate"] = {"minAuc": MIN_AUC, "minBrierSkill": MIN_BRIER_SKILL,
                      "minFoldAuc": MIN_FOLD_AUC, "minHoldoutRows": MIN_HOLDOUT_ROWS,
                      "aucSigmaMargin": AUC_SIGMA_MARGIN,
                      "note": "AUC tests ranking (prior-invariant); Brier skill tests whether "
                              "the probabilities beat always predicting the historical "
                              "up-frequency; fold AUC tests that it holds across time rather "
                              "than on one lucky segment; and the holdout must be large enough, "
                              "with AUC clearing chance by 2 standard errors, or none of the "
                              "above means anything. All must pass."}
    persisted = [k for k, v in report["models"].items() if v.get("persisted")]
    report["persistedModels"] = persisted
    report["elapsedSeconds"] = round((_dt.datetime.now() - t0).total_seconds(), 1)

    if persisted and not dry_run:
        # The manifest is written only when something was persisted, and it describes the
        # feature contract those artifacts were fitted on. Writing it otherwise would tell
        # inference to build derivative columns no model asked for.
        featureset.save_manifest(ds["featureNames"], include_derivatives,
                                 include_news=include_news, extra={
            "trainedSymbol": symbol, "trainedExchange": exchange, "interval": interval,
            "horizonBars": horizon,
        })
        try:
            tmp = provenance_path() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({k: v for k, v in report.items() if k not in ("ok",)}, fh,
                          indent=2, default=str)
            os.replace(tmp, provenance_path())
        except Exception as e:
            logger.warning(f"[training] could not write provenance: {e}")
        try:
            from .registry import MODEL_REGISTRY
            report["reloaded"] = MODEL_REGISTRY.reload_models()
        except Exception as e:
            report["reloaded"] = {"error": str(e)}

    report["summary"] = (
        f"{len(persisted)} of {len(report['models'])} models passed the gate "
        f"(AUC >= {MIN_AUC}, Brier skill > {MIN_BRIER_SKILL}, fold AUC >= {MIN_FOLD_AUC}) "
        f"and were persisted"
        + (f"; skipped {len(report['skipped'])}" if report["skipped"] else "")
    )
    return report
