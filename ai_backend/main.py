"""
Rama AGI — StockMind prediction engine (trimmed FastAPI backend).

Absorbed from StockMind AI per RAMA_AGI_MASTER_SPEC.md Section 39: the
prediction math only (dispatcher, features, models, calibration, backtest,
strategy scoring, Yahoo OHLCV fetch). No JARVIS-X/AGI-envelope/friday-nexus/
doc-intelligence/theme/self-optimizer routes — those depend on modules that
were deliberately not copied (see Section 39 for the full list and why).

Endpoints:
  GET  /health              — model load status
  POST /predict              — generate signals from OHLCV
  GET  /backtest/presets     — timeframe presets for the backtest UI
  POST /backtest              — walk-forward backtest
  POST /strategy/score        — composite strategy score (10 algorithms)
  GET  /derivatives/sources   — NSE derivative sources, and which are backtestable
  GET  /derivatives/{symbol}  — stored option/future metrics (PCR, max pain, basis)
  POST /derivatives/sync      — backfill derivative metrics from the NSE archives
  GET  /derivatives/chain/{s} — live option chain snapshot (NOT backtestable)
  GET  /flows                 — FII/DII cash, participant-wise OI, delivery %
  GET  /outcomes              — recorded predictions and their resolution state
  GET  /outcomes/stats        — measured win rate, ECE, Brier, adaptive weight
  POST /outcomes/resolve      — score claims whose bars have since arrived
  POST /outcomes/learn        — feed resolved outcomes into the ensemble, once each
  GET  /models                — artifacts, training provenance, feature-contract alignment
  POST /train                 — fit models on stored history, persist only what beats base
  GET  /news/sources          — free feeds, and which are stale
  GET  /news/{symbol}         — headlines with lexicon polarity, event type, relevance
  POST /news/sync             — record today's RSS reading
  POST /news/backfill         — pull historical tone/volume from GDELT (2017 onward)
  GET  /news/coverage/{sym}   — days collected, and whether that is enough to train on
  GET  /ohlcv/{symbol}        — stored bars, for the chart
  GET  /store/inventory       — every symbol held locally, with its depth
  GET  /horizons              — intraday/swing/positional, and display-only intervals
  GET  /predict/multi/{sym}   — one read per horizon, plus what their agreement means
  POST /train/horizons        — fit a model set per horizon, each on its own interval

Started by electron/ipc/aiProcess.cjs (spawn python -u main.py), reached from
the renderer through electron/ipc/marketIntel.cjs — this process itself has
no auth, no user table, and no opinion about identity (invariant I2 applies
to the whole Express server, and by the same logic to this process: it is a
pure function of (symbol, OHLCV, capital, risk%) -> signals, not a second
identity system).

Start standalone for local testing:
  uvicorn main:app --host 127.0.0.1 --port 8001
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Literal
import logging
import os
import time
import uuid

import pandas as pd

from engine.dispatcher import generate_signals
from engine.health import get_health
from engine.backtest import run_backtest, TIMEFRAME_PRESETS, INTERVAL_BARS_PER_DAY
from engine.data_fetcher import get_ohlcv
from engine.strategy_scorer import compute_composite_score
from engine.registry import MODEL_REGISTRY

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rama-ai-backend")

app = FastAPI(
    title="Rama AGI — StockMind Prediction Engine",
    version="1.0.0",
    description="Ensemble ML prediction engine, absorbed from StockMind AI (engine only, no app).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4097"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Request schemas ───────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    symbol:          str   = Field(..., min_length=1, max_length=20)
    exchange:        str   = Field(default="NSE")
    instrType:       Literal["spot", "futures", "options"] = "spot"
    basePrice:       float = Field(..., gt=0)
    capital:         float = Field(..., gt=0)
    riskPct:         float = Field(default=1.5, ge=0.5, le=5.0)
    direction:       Literal["long", "short", "both"] = "both"
    minGrade:        Literal["A+", "A", "B", "C", "D"] = "C"
    predictionMode:  Literal["learning", "realworld", "both"] = "both"
    adaptiveWeight:  float = Field(default=1.0, ge=0.5, le=2.0)
    signalCount:     int   = Field(default=16, ge=1, le=50)
    ohlcv:           Optional[list[dict]] = None
    strike:          Optional[float] = None
    optType:         Optional[Literal["CE", "PE"]] = None
    expiry:          Optional[str] = None
    daysLeft:        Optional[int] = None
    lotSize:         Optional[int] = None
    optionMeta:      Optional[dict] = None
    futuresMeta:     Optional[dict] = None
    isDerivRec:      bool = False
    isIndexDerivRec: bool = False


class BacktestRequest(BaseModel):
    symbol:       str   = Field(..., min_length=1, max_length=20)
    exchange:     str   = Field(default="NSE")
    modelVersion: str   = Field(default="v1.0.0")
    ohlcv:        Optional[list[dict]] = None
    basePrice:    Optional[float] = None
    preset:       Optional[str]  = None   # '1M'|'3M'|'6M'|'1Y'|'2Y'|'3Y'|'5Y'|'MAX'
    fromDate:     Optional[str]  = None   # 'YYYY-MM-DD'
    toDate:       Optional[str]  = None   # 'YYYY-MM-DD'
    interval:     str            = "1d"   # '5m'|'15m'|'1h'|'1d'|'1w'


class StrategyScoreRequest(BaseModel):
    symbol:    str   = Field(..., min_length=1, max_length=20)
    exchange:  str   = Field(default="NSE")
    regime:    str   = Field(default="trending")
    ohlcv:     Optional[list[dict]] = None
    basePrice: Optional[float] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return get_health()


@app.post("/predict")
def predict(req: PredictionRequest):
    try:
        params = req.model_dump()
        signals = generate_signals(params)
        return {
            "requestId":       uuid.uuid4().hex,
            "symbol":          req.symbol,
            "exchange":        req.exchange,
            "generatedAt":     int(time.time() * 1000),
            "modelVersion":    "rama-1.0.0",
            "predictionMode":  req.predictionMode,
            "adaptiveWeight":  req.adaptiveWeight,
            "signals":         signals,
            "suppressedCount": sum(1 for s in signals if s.get("suppressed")),
            "dataSource":      signals[0].get("dataSource", "unknown") if signals else "unknown",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Prediction error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/backtest/presets")
def backtest_presets():
    return {"presets": TIMEFRAME_PRESETS, "intervals": INTERVAL_BARS_PER_DAY}


@app.post("/backtest")
def backtest(req: BacktestRequest):
    try:
        params = req.model_dump()
        df, is_real = get_ohlcv(params)
        if not is_real:
            logger.warning(f"[Backtest] {req.symbol}: using mock OHLCV — results are indicative only")
        result = run_backtest(
            df, req.symbol, req.modelVersion,
            from_date=req.fromDate, to_date=req.toDate,
            preset=req.preset, interval=req.interval,
        )
        result["dataSource"] = "real" if is_real else "mock"
        result["warning"]    = None if is_real else "Mock OHLCV used — provide real data for accurate backtest"
        return result
    except Exception as e:
        logger.error(f"Backtest error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/strategy/score")
def strategy_score(req: StrategyScoreRequest):
    """Run all 10 elite algorithms on a symbol and return a composite score."""
    try:
        params = req.model_dump()
        df, is_real = get_ohlcv(params)

        result = compute_composite_score(df, MODEL_REGISTRY, req.regime)
        result["symbol"]     = req.symbol
        result["exchange"]   = req.exchange
        result["dataSource"] = "real" if is_real else "mock"
        result["timestamp"]  = int(time.time() * 1000)

        if not is_real:
            result["warning"] = "Using estimated data — start backend with real OHLCV for accurate scores"

        return result
    except Exception as e:
        logger.error(f"Strategy score error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Derivatives and flows (spec Section 67) ───────────────────────────────────
#
# `backtestable` is returned on every response here, deliberately. The archive-derived
# metrics can be recomputed for any past day and so can train a model or feed a backtest;
# the live chain and the FII/DII cash number describe one moment and cannot. Without that
# flag on the response, the two are indistinguishable to the caller and someone will
# eventually build a "backtest" on a snapshot.

@app.get("/derivatives/sources")
def derivative_sources():
    from engine.derivatives import registry as deriv_registry
    return {"sources": deriv_registry()}


@app.get("/derivatives/{symbol}")
def derivative_metrics(symbol: str, exchange: str = "NSE", history: int = 0):
    """Stored option/future metrics for a symbol. `history=N` returns the last N rows."""
    try:
        from engine import derivatives as dv
        latest = dv.latest_metrics(symbol, exchange)
        out = {"symbol": symbol.upper(), "exchange": exchange, "backtestable": True,
               "latest": latest, "rows": 0, "history": []}
        df = dv.load_metrics(symbol, exchange)
        if df is not None and len(df):
            out["rows"] = int(len(df))
            out["firstDate"] = str(df["date"].iloc[0])[:10]
            out["lastDate"]  = str(df["date"].iloc[-1])[:10]
            if history > 0:
                tail = df.tail(min(history, 2000)).copy()
                tail["date"] = tail["date"].astype(str).str.slice(0, 10)
                out["history"] = tail.where(tail.notna(), None).to_dict("records")
        if latest is None:
            out["note"] = ("Nothing stored yet for this symbol. POST /derivatives/sync "
                           "to backfill from the NSE archives.")
        return out
    except Exception as e:
        logger.error(f"Derivative metrics error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class DerivativeSyncRequest(BaseModel):
    symbol:   str = "NIFTY"
    exchange: str = "NSE"
    # One bhavcopy is roughly a megabyte, so a deep backfill is thousands of requests.
    # It is bounded and resumable rather than one heroic call: re-running continues.
    days:     int = Field(default=30, ge=1, le=9000)
    budgetSeconds: float = Field(default=120.0, gt=0, le=3600)
    force:    bool = False


@app.post("/derivatives/sync")
def derivative_sync(req: DerivativeSyncRequest):
    """
    Backfill derivative metrics, newest first, within a time budget.

    Newest-first so a partial run still leaves the most recent data present — which is
    what a prediction needs. Re-run to go deeper; stored dates and known holidays are
    skipped, so it converges rather than re-fetching.
    """
    try:
        from engine import derivatives as dv
        _, info = dv.sync_history(req.symbol, req.exchange, days=req.days,
                                  force=req.force, budget_seconds=req.budgetSeconds)
        if info.get("budgetHit"):
            info["note"] = ("Time budget reached — this is normal for a deep backfill. "
                            "Call again to continue from where it stopped.")
        return info
    except Exception as e:
        logger.error(f"Derivative sync error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/derivatives/chain/{symbol}")
def derivative_chain(symbol: str, expiry: Optional[str] = None, kind: str = "Indices"):
    """Live option chain. A snapshot — use /derivatives/{symbol} for anything historical."""
    try:
        from engine.derivatives import option_chain
        return option_chain(symbol.upper(), expiry, kind)
    except Exception as e:
        logger.error(f"Option chain error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/flows")
def institutional_flows(date: Optional[str] = None, symbol: Optional[str] = None):
    """
    Institutional positioning: FII/DII cash, participant-wise OI, and delivery percentage.

    Participant-wise OI is the one worth building on — it is a dated archive file, so it
    can be backfilled, and it says whether foreign institutions are net long or short
    index futures. The FII/DII cash figure is latest-day only and cannot be backfilled
    from this endpoint at all.
    """
    try:
        import datetime as _dt
        from engine import derivatives as dv

        d = None
        if date:
            try:
                d = _dt.date.fromisoformat(date)
            except ValueError:
                raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        if d is None:
            d = _dt.date.today()
            while d.weekday() >= 5:
                d -= _dt.timedelta(days=1)

        out = {"date": d.isoformat(),
               "cash": dv.fii_dii_latest(),
               "participantOi": dv.participant_oi(d)}
        if symbol:
            out["delivery"] = dv.delivery_data(d, symbol=symbol.upper())
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Flows error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── The outcome loop (spec Section 68) ────────────────────────────────────────
#
# Recording happens inside `/predict` automatically. These three exist because the other
# two moments of the loop cannot happen at prediction time: resolution needs bars that do
# not exist yet, and learning needs resolution. Rāma's scheduler calls resolve then learn;
# both are safe to call repeatedly, since resolution skips resolved claims and learning is
# stamped exactly-once.

@app.get("/outcomes")
def outcomes_list(symbol: Optional[str] = None, limit: int = 50,
                  resolvedOnly: bool = False):
    from engine.outcomes import recent
    return {"records": recent(limit=limit, symbol=symbol, resolved_only=resolvedOnly)}


@app.get("/outcomes/stats")
def outcomes_stats(symbol: Optional[str] = None):
    """
    What the engine has actually learned. The counts are separated on purpose: many
    predictions recorded with none resolved looks like a working loop and is not.
    """
    from engine.outcomes import stats
    from engine.registry import MODEL_REGISTRY
    out = stats(symbol)
    out["metaLearner"] = {"updates": MODEL_REGISTRY.meta_update_count(),
                          "weights": MODEL_REGISTRY.meta_weights()}
    return out


class ResolveRequest(BaseModel):
    symbol:     Optional[str] = None
    maxRecords: int = Field(default=2000, ge=1, le=50000)
    learn:      bool = True


@app.post("/outcomes/resolve")
def outcomes_resolve(req: ResolveRequest):
    """
    Score claims whose horizon has elapsed, then learn from them.

    A claim is only scored once its full declared `validityBars` has passed, or it closed
    early inside the bars available. Scoring sooner would book a signal that still has room
    to run as a TIMEOUT — a loss it never took.
    """
    try:
        from engine import outcomes
        result = {"resolve": outcomes.resolve(req.symbol, req.maxRecords)}
        if req.learn:
            result["learn"] = outcomes.learn()
        result["stats"] = outcomes.stats(req.symbol)
        return result
    except Exception as e:
        logger.error(f"Outcome resolution error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/outcomes/learn")
def outcomes_learn():
    """Consume resolved-but-unlearned outcomes. Idempotent — each is learned exactly once."""
    try:
        from engine import outcomes
        return outcomes.learn()
    except Exception as e:
        logger.error(f"Outcome learning error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Training (spec Section 69) ────────────────────────────────────────────────

@app.get("/models")
def models_status():
    """
    What is actually loaded, what it was fitted on, and whether it still lines up.

    `featureContract.aligned` is the one to read. A trained artifact is a function of a
    column order; if the feature set changed since it was fitted, the artifact is refused and
    every model falls back to its heuristic. Reporting that is the difference between "the
    models are not being used" and "the models are quietly wrong".
    """
    try:
        from engine.registry import MODEL_REGISTRY
        from engine.models import artifact_alignment
        from engine.training import load_provenance
        from engine import featureset

        ok, reason = artifact_alignment()
        prov = load_provenance()
        return {
            "featureContract": {
                "aligned": ok, "reason": reason,
                "featuresetVersion": featureset.FEATURESET_VERSION,
                "liveFeatureCount": len(featureset.feature_names()),
                "includeDerivatives": featureset.include_derivatives_default(),
                "manifest": featureset.load_manifest(),
            },
            "registry": MODEL_REGISTRY.status(),
            "training": prov,
            "note": ("No training provenance — nothing has been fitted yet, so every "
                     "probability is a heuristic. POST /train to fit on stored history."
                     if not prov else
                     f"Fitted on {prov.get('symbol')} {prov.get('trainRange', {}).get('first')} "
                     f"→ {prov.get('trainRange', {}).get('last')} at a "
                     f"{prov.get('horizonBars')}-bar horizon."),
        }
    except Exception as e:
        logger.error(f"Models status error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class TrainRequest(BaseModel):
    symbol:   str = "NIFTY50"
    exchange: str = "NSE"
    interval: str = "1d"
    # The horizon master has been asked about four times. It is recorded in the artifact, so
    # a model fitted for one horizon can never be silently served as another.
    horizon:  int = Field(default=5, ge=1, le=250)
    includeDerivatives: bool = False
    models:   Optional[list[str]] = None
    splits:   int = Field(default=4, ge=1, le=12)
    holdoutFrac: float = Field(default=0.2, gt=0.02, le=0.5)
    stride:   int = Field(default=1, ge=1, le=20)
    maxRows:  Optional[int] = None
    dryRun:   bool = False


@app.post("/train")
def train_models(req: TrainRequest):
    """
    Fit on stored history with forward-chaining splits and an untouched holdout.

    A model is persisted only if it beats the holdout's majority-class base rate. A refusal
    is returned as a result with its numbers — shipping a model that loses to always
    guessing the majority would make predictions worse while `/health` reported a trained
    artifact.
    """
    try:
        from engine.training import train as run_training
        report = run_training(
            symbol=req.symbol, exchange=req.exchange, interval=req.interval,
            horizon=req.horizon, include_derivatives=req.includeDerivatives,
            models=req.models, n_splits=req.splits, holdout_frac=req.holdoutFrac,
            stride=req.stride, max_rows=req.maxRows, dry_run=req.dryRun,
        )
        if not report.get("ok"):
            raise HTTPException(status_code=400, detail=report.get("reason", "training failed"))
        return report
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Training error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── News (spec Section 70) ────────────────────────────────────────────────────
#
# Everything here is `backtestable: False`. No free feed reaches back more than about sixteen
# days, so a news series can only be accumulated forward — which is why `/news/sync` exists
# and why `/news/coverage` reports how far off a trainable feature still is. Serving this as
# context to a reader is honest; treating it as a measured edge would not be, because there
# is not yet enough history to measure it either way.

@app.get("/news/sources")
def news_sources():
    from engine.news import registry as news_registry
    return {"sources": news_registry()}


@app.get("/news/{symbol}")
def news_for(symbol: str, limit: int = 40, includeGeneral: bool = True):
    """Current headlines for a symbol: lexicon polarity, event type, relevance."""
    try:
        from engine.news import headlines
        return headlines(symbol.upper(), limit=limit, include_general=includeGeneral)
    except Exception as e:
        logger.error(f"News error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class NewsSyncRequest(BaseModel):
    symbol:   str = "NIFTY50"
    exchange: str = "NSE"
    limit:    int = Field(default=60, ge=5, le=200)


@app.post("/news/sync")
def news_sync(req: NewsSyncRequest):
    """
    Record today's reading so the series accumulates.

    This is the ONLY way news ever becomes a trainable feature: history cannot be fetched, so
    it has to be collected daily from whenever collection starts. Rāma's scheduler should call
    this once a day; not calling it means the feature never becomes possible.
    """
    try:
        from engine.news import sync_today
        _, info = sync_today(req.symbol.upper(), req.exchange, limit=req.limit)
        return info
    except Exception as e:
        logger.error(f"News sync error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class NewsBackfillRequest(BaseModel):
    symbol:   str = "NIFTY50"
    exchange: str = "NSE"
    # GDELT reaches back to 2017, so 9 years is the whole archive.
    years:    int = Field(default=9, ge=1, le=12)
    force:    bool = False
    # Each year needs two paced calls, so a full pull takes minutes. Bounded and resumable.
    budgetSeconds: float = Field(default=600.0, gt=10, le=3600)


@app.post("/news/backfill")
def news_backfill(req: NewsBackfillRequest):
    """
    Pull historical news tone and volume from GDELT — the only free archive with real depth.

    This is what makes news trainable at all. RSS reaches back about sixteen days; GDELT
    reaches 2017, which is roughly 2,250 trading days. Persists after every year, so a run
    that hits its budget keeps what it got, and already-covered years are skipped so
    re-running converges rather than re-fetching.

    GDELT throttles hard. If it starts refusing, wait and call again — the design is built for
    exactly that, and a partial series is still useful.
    """
    try:
        from engine.news import backfill_history
        _, info = backfill_history(req.symbol.upper(), req.exchange, years=req.years,
                                   force=req.force, budget_seconds=req.budgetSeconds)
        return info
    except Exception as e:
        logger.error(f"News backfill error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/news/coverage/{symbol}")
def news_coverage(symbol: str, exchange: str = "NSE"):
    """How many days have been collected, and whether that is yet enough to train on."""
    try:
        from engine.news import coverage
        return coverage(symbol.upper(), exchange)
    except Exception as e:
        logger.error(f"News coverage error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Bars, for the chart (spec Section 71) ─────────────────────────────────────

@app.get("/ohlcv/{symbol}")
def ohlcv(symbol: str, exchange: str = "NSE", interval: str = "1d",
          limit: int = 240, sync: bool = False):
    """
    Stored bars, newest last, for drawing.

    `limit` is the tail, because a chart needs the recent window and the store may hold
    thousands of bars — 4,649 for NIFTY 50. Sending all of them over IPC to render 200
    candles is waste the renderer then has to slice anyway.

    `sync=true` tops the store up first. Off by default so opening a chart does not fire a
    network fetch on every render.
    """
    try:
        from engine import store
        sym = symbol.upper()
        if sync:
            df, info = store.sync(sym, exchange, interval)
        else:
            df, info = store.load(sym, exchange, interval), {"fromStore": True}

        if df is None or len(df) == 0:
            return {"symbol": sym, "exchange": exchange, "interval": interval,
                    "bars": [], "count": 0, "stored": 0,
                    "note": ("Nothing stored for this symbol. Call again with sync=true to "
                             "fetch it, which reaches back as far as the provider chain allows."),
                    "syncInfo": info}

        stored = int(len(df))
        tail = df.tail(max(10, min(limit, 5000))).copy()
        tail["date"] = pd.to_datetime(tail["date"], errors="coerce")
        bars = [{
            "date":   str(r.date.date()),
            "open":   round(float(r.open), 4),
            "high":   round(float(r.high), 4),
            "low":    round(float(r.low), 4),
            "close":  round(float(r.close), 4),
            "volume": float(r.volume or 0),
        } for r in tail.itertuples(index=False)]

        return {
            "symbol": sym, "exchange": exchange, "interval": interval,
            "bars": bars, "count": len(bars), "stored": stored,
            "firstBar": bars[0]["date"], "lastBar": bars[-1]["date"],
            "storedFirstBar": str(pd.Timestamp(df["date"].iloc[0]).date()),
            "meta": store.meta(sym, exchange, interval),
            "syncInfo": info,
        }
    except Exception as e:
        logger.error(f"OHLCV error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/store/inventory")
def store_inventory():
    """Every series held locally, with its depth and provenance."""
    try:
        from engine import store
        return {"inventory": store.inventory(), "root": store.store_root()}
    except Exception as e:
        logger.error(f"Inventory error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Multi-horizon (spec Section 73) ───────────────────────────────────────────

@app.get("/horizons")
def horizons_list():
    """
    The three horizons, and which intervals are display-only.

    A horizon is `(interval, bars)`. "Intraday" cannot be expressed as a count of daily bars,
    which is why the pair is the unit.
    """
    from engine.horizons import registry as h_registry
    return h_registry()


@app.get("/predict/multi/{symbol}")
def predict_multi(symbol: str, exchange: str = "NSE", horizons: Optional[str] = None,
                  sync: bool = False):
    """
    One directional read per horizon, plus what their agreement means.

    NOT AVERAGED, deliberately. A three-hour call and a one-month call answer different
    questions; a blended number would describe neither and would hide the most informative
    case — a short horizon leaning against a long one, which is the shape of a pullback inside
    a trend.
    """
    try:
        from engine.horizons import predict_all
        names = [h.strip() for h in horizons.split(",")] if horizons else None
        return predict_all(symbol.upper(), exchange, names, sync_if_missing=sync)
    except Exception as e:
        logger.error(f"Multi-horizon predict error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class TrainHorizonsRequest(BaseModel):
    symbol:   str = "NIFTY50"
    exchange: str = "NSE"
    horizons: Optional[list[str]] = None
    includeDerivatives: bool = False
    includeNews: bool = False
    models:   Optional[list[str]] = None
    splits:   int = Field(default=3, ge=1, le=12)
    holdoutFrac: float = Field(default=0.2, gt=0.02, le=0.5)
    stride:   int = Field(default=2, ge=1, le=20)
    dryRun:   bool = False
    syncMissing: bool = True


@app.post("/train/horizons")
def train_horizons_route(req: TrainHorizonsRequest):
    """
    Fit a model set per horizon, each on its own bar interval.

    Intraday bars are usually absent because nothing has asked for them before, so this fetches
    them when `syncMissing` — the difference between "no intraday model" and "no intraday data".
    The Section 69 gate is unchanged: three horizons means three verdicts, not a softer bar.
    """
    try:
        from engine.training import train_horizons
        return train_horizons(
            symbol=req.symbol.upper(), exchange=req.exchange, names=req.horizons,
            include_derivatives=req.includeDerivatives, include_news=req.includeNews,
            models=req.models, n_splits=req.splits, holdout_frac=req.holdoutFrac,
            stride=req.stride, dry_run=req.dryRun, sync_missing=req.syncMissing)
    except Exception as e:
        logger.error(f"Horizon training error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Position ledger (spec Section 74) ────────────────────────────────────────
#
# What master actually has on the table, as opposed to what the engine predicts. Every write
# here is master asserting a fact about his own capital, so the Electron side gates all of them
# on `stockmind.config` rather than on the viewer capability.
#
# A bad input is a 400, not a 500: "quantity must be greater than zero" is something master can
# act on, an opaque server error is not.

class ThesisModel(BaseModel):
    direction:   Optional[str] = None
    horizon:     Optional[str] = None
    targetPrice: Optional[float] = None
    stopPrice:   Optional[float] = None
    probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    predictionId: Optional[str] = None
    rationale:   Optional[str] = None


class OpenPositionRequest(BaseModel):
    symbol:    str
    exchange:  str = "NSE"
    instrType: str = "EQUITY"
    side:      str = "BUY"
    quantity:  float = Field(gt=0)
    price:     float = Field(gt=0)
    date:      Optional[str] = None
    fees:      float = Field(default=0.0, ge=0)
    note:      Optional[str] = None
    predictionId: Optional[str] = None
    thesis:    Optional[ThesisModel] = None
    interval:  str = "1d"


class FillRequest(BaseModel):
    positionId: str
    side:       str
    quantity:   float = Field(gt=0)
    price:      float = Field(gt=0)
    date:       Optional[str] = None
    fees:       float = Field(default=0.0, ge=0)
    note:       Optional[str] = None
    predictionId: Optional[str] = None
    interval:   str = "1d"


class ClosePositionRequest(BaseModel):
    positionId: str
    price:      float = Field(gt=0)
    date:       Optional[str] = None
    fees:       float = Field(default=0.0, ge=0)
    note:       Optional[str] = None
    interval:   str = "1d"


class RemoveFillRequest(BaseModel):
    positionId: str
    fillId:     str
    interval:   str = "1d"


class ThesisRequest(BaseModel):
    positionId: str
    thesis:     ThesisModel
    interval:   str = "1d"


class LedgerNoteRequest(BaseModel):
    positionId: str
    text:       str


@app.get("/ledger/positions")
def ledger_positions(status: Optional[str] = None, symbol: Optional[str] = None,
                     interval: str = "1d"):
    """
    Every tracked position, marked to market against stored bars.

    A position whose price could not be resolved carries `unrealisedPnl: null` and a flag
    saying so — it is never marked at its entry price and reported as flat P&L.
    """
    try:
        from engine import ledger
        rows = ledger.positions(status=status, symbol=symbol, interval=interval)
        return {"positions": rows, "count": len(rows),
                "open": sum(1 for r in rows if r["status"] == "open")}
    except Exception as e:
        logger.error(f"Ledger list error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ledger/portfolio")
def ledger_portfolio(interval: str = "1d"):
    """The whole book. `unpricedSymbols` is reported rather than folded into the totals."""
    try:
        from engine import ledger
        return ledger.portfolio(interval=interval)
    except Exception as e:
        logger.error(f"Ledger portfolio error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ledger/position/{position_id}")
def ledger_position(position_id: str, interval: str = "1d"):
    try:
        from engine import ledger
        return ledger.position_detail(position_id, interval=interval)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"no position {position_id}")
    except Exception as e:
        logger.error(f"Ledger detail error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ledger/open")
def ledger_open(req: OpenPositionRequest):
    """
    Record a position master has taken.

    An existing OPEN position in the same symbol and instrument is added to rather than
    duplicated: two rows for one holding would show two different average costs for the same
    money, and neither would reconcile against his broker.
    """
    try:
        from engine import ledger
        return ledger.open_position(
            symbol=req.symbol, exchange=req.exchange, instr_type=req.instrType,
            side=req.side, quantity=req.quantity, price=req.price, date=req.date,
            fees=req.fees, thesis=(req.thesis.model_dump() if req.thesis else None),
            note=req.note, prediction_id=req.predictionId, interval=req.interval)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger open error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ledger/fill")
def ledger_fill(req: FillRequest):
    """Add to or reduce a tracked position — the "buy more / sell more" path."""
    try:
        from engine import ledger
        return ledger.add_fill(
            position_id=req.positionId, side=req.side, quantity=req.quantity,
            price=req.price, date=req.date, fees=req.fees, note=req.note,
            prediction_id=req.predictionId, interval=req.interval)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger fill error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ledger/close")
def ledger_close(req: ClosePositionRequest):
    """Exit the whole open quantity. Writes a closing fill so the exit price is on the record."""
    try:
        from engine import ledger
        return ledger.close_position(
            position_id=req.positionId, price=req.price, date=req.date,
            fees=req.fees, note=req.note, interval=req.interval)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger close error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ledger/fill/remove")
def ledger_fill_remove(req: RemoveFillRequest):
    """Delete a mistyped fill. The removal is recorded in the position's notes."""
    try:
        from engine import ledger
        return ledger.remove_fill(req.positionId, req.fillId, interval=req.interval)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger fill removal error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ledger/thesis")
def ledger_thesis(req: ThesisRequest):
    """Revise why a position is being held. The previous reason is kept."""
    try:
        from engine import ledger
        return ledger.set_thesis(req.positionId, req.thesis.model_dump(),
                                 interval=req.interval)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger thesis error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ledger/note")
def ledger_note(req: LedgerNoteRequest):
    try:
        from engine import ledger
        return ledger.add_note(req.positionId, req.text)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger note error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("STOCKMIND_PYTHON_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
