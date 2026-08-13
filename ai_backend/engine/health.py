"""health.py — System health endpoint data."""

from datetime import datetime


def get_health() -> dict:
    from .registry import MODEL_REGISTRY
    status = MODEL_REGISTRY.status()
    loaded = status["ensemble_size"]
    total  = 4  # lgbm, xgb, lstm, sentiment

    return {
        "level":              "full" if loaded >= 3 else "degraded_1" if loaded >= 1 else "heuristics_only",
        "ece":                0,
        "brierScore":         0,
        "dataFeedHealthy":    True,
        "aiInferenceHealthy": loaded >= 1,
        "storageHealthy":     True,
        "activeFeeds":        loaded,
        "totalFeeds":         total,
        "modelsLoaded":       loaded,
        "modelsTotal":        total,
        "modelStatus":        status["models"],
        "lastUpdated":        datetime.now().isoformat(),
        "note": (
            f"{loaded}/{total} models loaded with real artifacts. "
            f"{'All models using calibrated mock predictions.' if loaded == 0 else ''}"
        ),
    }
