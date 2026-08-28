"""health.py — System health endpoint data."""

from datetime import datetime


def get_health() -> dict:
    """
    Report what is actually true.

    WHAT WAS WRONG (spec Section 64). `loaded` was read from `ensemble_size`, which is
    `len(self._base_models)` — a **constant 7**, independent of whether any artifact
    loaded — and compared against a hardcoded `total = 4`. So this endpoint always
    reported "7/4 models loaded with real artifacts" while zero artifacts existed
    anywhere in the repo. `ece` and `brierScore` were hardcoded to `0`, which reads as
    *perfect* calibration rather than *unmeasured*.

    A monitoring surface that overstates readiness is worse than none: it is the one
    thing master would consult to find out whether to trust a signal.
    """
    from .registry import MODEL_REGISTRY
    status = MODEL_REGISTRY.status()
    models = status["models"]

    total  = len(models)
    # `trained`, not `loaded`. A model that can answer is not a model that was fitted —
    # RegimeAwareModel sets loaded=True in its constructor and has no artifact at all.
    loaded = sum(1 for m in models.values() if m.get("trained"))
    mocked = total - loaded

    if loaded == 0:
        level = "heuristics_only"
    elif loaded >= max(3, total // 2):
        level = "full"
    else:
        level = "degraded_1"

    return {
        "level":              level,
        # None, not 0 — nothing has computed these yet, and 0 would read as perfect.
        # `compute_ece` / `compute_brier_score` in calibration.py are the real
        # implementations, waiting on resolved outcomes to score against.
        "ece":                None,
        "brierScore":         None,
        "calibrationMeasured": False,
        "dataFeedHealthy":    True,
        "aiInferenceHealthy": loaded >= 1 or total > 0,   # heuristics still answer
        "storageHealthy":     True,
        "activeFeeds":        loaded,
        "totalFeeds":         total,
        "modelsLoaded":       loaded,
        "modelsMocked":       mocked,
        "modelsTotal":        total,
        "modelStatus":        models,
        "lastUpdated":        datetime.now().isoformat(),
        "note": (
            f"{loaded}/{total} models loaded from trained artifacts; {mocked} on heuristic fallbacks. "
            + ("No trained artifacts are present — every probability is a heuristic, "
               "not a fitted model. Calibration is unmeasured (no resolved outcomes yet)."
               if loaded == 0 else
               "Calibration is unmeasured until resolved outcomes are recorded.")
        ),
    }
