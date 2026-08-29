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
    # Fitted incrementally from resolved outcomes — neither a heuristic nor a loaded
    # artifact (spec Section 68). Counted separately because calling it either would be a
    # false claim about where the model came from.
    online = sum(1 for m in models.values()
                 if not m.get("trained") and int(m.get("onlineSamples") or 0) > 0)
    mocked = total - loaded - online

    if loaded == 0:
        level = "heuristics_only"
    elif loaded >= max(3, total // 2):
        level = "full"
    else:
        level = "degraded_1"

    # Measured calibration, once resolved outcomes exist (spec Section 68).
    #
    # Still `None` with `calibrationMeasured: False` until then — that stays correct, and
    # it is what the numbers were waiting for rather than a permanent state. Below
    # `MIN_SAMPLES_FOR_CALIBRATION` resolved claims `outcomes.stats` reports None too:
    # an ECE over nine predictions is a number, not a measurement.
    cal = {"ece": None, "brierScore": None, "calibrationMeasured": False,
           "resolvedOutcomes": 0, "recordedPredictions": 0}
    try:
        from .outcomes import stats as outcome_stats
        s = outcome_stats()
        cal.update({
            "ece":                 s.get("ece"),
            "brierScore":          s.get("brierScore"),
            "calibrationMeasured": bool(s.get("calibrationMeasured")),
            "resolvedOutcomes":    int(s.get("resolved") or 0),
            "recordedPredictions": int(s.get("recorded") or 0),
            "measuredWinRatePct":  s.get("winRatePct"),
            "meanPredicted":       s.get("meanPredicted"),
            "adaptiveWeight":      s.get("adaptiveWeight"),
            "adaptiveWeightMeasured": bool(s.get("adaptiveWeightMeasured")),
        })
    except Exception:
        # A health endpoint that fails because a subsystem is unavailable is the one thing
        # it must never do — it is what master consults to find out what is broken.
        cal["outcomeLoop"] = "unavailable"

    return {
        "level":              level,
        "ece":                cal["ece"],
        "brierScore":         cal["brierScore"],
        "calibrationMeasured": cal["calibrationMeasured"],
        "outcomes":           cal,
        "dataFeedHealthy":    True,
        "aiInferenceHealthy": loaded >= 1 or total > 0,   # heuristics still answer
        "storageHealthy":     True,
        "activeFeeds":        loaded,
        "totalFeeds":         total,
        "modelsLoaded":       loaded,
        "modelsOnlineFitted": online,
        "modelsMocked":       mocked,
        "modelsTotal":        total,
        "modelStatus":        models,
        "lastUpdated":        datetime.now().isoformat(),
        "note": (
            f"{loaded}/{total} models loaded from trained artifacts; "
            + (f"{online} fitted online from resolved outcomes; " if online else "")
            + f"{mocked} on heuristic fallbacks. "
            + ("No trained artifacts are present — every probability is a heuristic, "
               "not a fitted model. " if loaded == 0 and online == 0 else "")
            + (f"Calibration measured over {cal['resolvedOutcomes']} resolved outcomes "
               f"(ECE {cal['ece']}, Brier {cal['brierScore']})."
               if cal["calibrationMeasured"] else
               f"Calibration unmeasured: {cal['recordedPredictions']} predictions recorded, "
               f"{cal['resolvedOutcomes']} resolved. POST /outcomes/resolve once later "
               f"bars exist.")
        ),
    }
