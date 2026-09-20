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
          fromDate: Optional[str] = None, toDate: Optional[str] = None,
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
        window = df.copy()
        window["date"] = pd.to_datetime(window["date"], errors="coerce")
        window = window.dropna(subset=["date"])

        # ── A DATE RANGE, NOT ONLY A TAIL (spec Section 105) ──────────────────
        #
        # Master removed the bar-count field: a count is a consequence of interval and window, not an
        # independent choice, so the window is now expressed as the dates it actually covers. `limit`
        # stays as a CEILING on the payload — every bar crosses an IPC boundary and then becomes a
        # canvas point — but it no longer defines the window.
        clipped = False
        if fromDate:
            try:
                start = pd.Timestamp(fromDate)
                before = len(window)
                window = window[window["date"] >= start]
                clipped = clipped or len(window) != before
            except (ValueError, TypeError):
                pass          # an unparseable date is ignored rather than emptying the chart
        if toDate:
            try:
                # Inclusive of the whole closing day: a `toDate` of 2026-03-31 must include that
                # session's bars, and an intraday stamp of 2026-03-31 09:15 is NOT <= midnight.
                end = pd.Timestamp(toDate) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
                before = len(window)
                window = window[window["date"] <= end]
                clipped = clipped or len(window) != before
            except (ValueError, TypeError):
                pass

        matched = int(len(window))
        if matched == 0:
            return {"symbol": sym, "exchange": exchange, "interval": interval,
                    "bars": [], "count": 0, "stored": stored,
                    "storedFirstBar": str(pd.Timestamp(df["date"].iloc[0]).date()),
                    "note": (f"{stored} {interval} bars are stored, but none fall between "
                             f"{fromDate or 'the start'} and {toDate or 'now'}. Widen the dates, or "
                             f"fetch more history."),
                    "meta": store.meta(sym, exchange, interval), "syncInfo": info}

        tail = window.tail(max(10, min(limit, 20000)))

        # ── INTRADAY BARS KEPT THEIR TIME (spec Section 105) ──────────────────
        #
        # THIS ROUTE WAS THROWING THE CLOCK AWAY. `str(r.date.date())` serialises 2026-03-31 09:15 as
        # "2026-03-31", so every bar in a session arrived at the renderer with the same stamp — and
        # `PriceChart.toChartTime` treats a 10-character string as a whole day, collapsing a session's
        # bars onto one point. The store was fixed for exactly this in Section 73; the ROUTE was not,
        # so every intraday chart was silently one candle per day whatever interval master picked.
        intraday = store.is_intraday(interval)
        stamp = ((lambda d: d.strftime("%Y-%m-%d %H:%M:%S")) if intraday
                 else (lambda d: str(d.date())))
        bars = [{
            "date":   stamp(r.date),
            "open":   round(float(r.open), 4),
            "high":   round(float(r.high), 4),
            "low":    round(float(r.low), 4),
            "close":  round(float(r.close), 4),
            "volume": float(r.volume or 0),
        } for r in tail.itertuples(index=False)]

        return {
            "symbol": sym, "exchange": exchange, "interval": interval,
            "bars": bars, "count": len(bars), "stored": stored,
            "matched": matched,
            "requestedFrom": fromDate, "requestedTo": toDate,
            "truncated": len(bars) < matched,
            "firstBar": bars[0]["date"], "lastBar": bars[-1]["date"],
            "storedFirstBar": str(pd.Timestamp(df["date"].iloc[0]).date()),
            "storedLastBar": str(pd.Timestamp(df["date"].iloc[-1]).date()),
            "note": (None if len(bars) >= matched else
                     f"{matched} bars match those dates; the newest {len(bars)} were sent to keep the "
                     f"payload bounded."),
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


# ── Composable strategies (spec Section 103) ───────────────────────────────────
#
# THE GAP THESE ROUTES CLOSE. `strategy_eval.py` was built in Section 95 with 64 assertions and was
# reachable from nothing — no route, no IPC, no caller. The harness that decides whether a strategy
# found an edge or found noise sat outside the product from the day it was written. A judge nobody can
# call does not judge anything.

@app.get("/strategy/blocks")
def strategy_blocks():
    """The block catalogue, for the builder. Includes which blocks a backtest will refuse, and why."""
    from engine import strategy_spec
    return strategy_spec.catalogue()


class StrategySpecRequest(BaseModel):
    spec: dict


@app.post("/strategy/validate")
def strategy_validate(req: StrategySpecRequest):
    """
    Normalise a spec and report every fault at once, plus the trial count.

    The trial count is returned BEFORE any backtest runs, because it is what determines whether a
    result could mean anything — and master should see "this searches 1,296 variants" while he is still
    choosing, not afterwards.
    """
    from engine import strategy_spec
    return strategy_spec.validate_spec(req.spec)


class StrategyBacktestRequest(BaseModel):
    spec:        dict
    holdoutFrac: float = Field(default=0.30, ge=0.1, le=0.6)
    minBars:     int   = Field(default=200, ge=50, le=100000)


@app.post("/strategy/backtest")
def strategy_backtest(req: StrategyBacktestRequest):
    """
    Search the spec's variants on one window, then judge the winner on data the search never saw.

    `search_and_judge` owns that structure so this route cannot accidentally peek: the ranking sees
    `[0, search_end)` and exactly one variant is ever run against the holdout.
    """
    try:
        from engine import store, strategy_spec, strategy_eval

        v = strategy_spec.validate_spec(req.spec)
        if not v["ok"]:
            return {"ok": False, "reason": "; ".join(v["errors"]), "errors": v["errors"],
                    "warnings": v["warnings"], "trials": v["trials"]}
        if v["blocked"]:
            return {
                "ok": False,
                "reason": "cannot be backtested: "
                          + ", ".join(b["label"] for b in v["blocked"]),
                "blocked": v["blocked"], "trials": v["trials"], "warnings": v["warnings"],
            }

        clean = v["spec"]
        df = store.load(clean["symbol"], clean["exchange"], clean["interval"])
        if df is None or len(df) < req.minBars:
            have = 0 if df is None else len(df)
            return {
                "ok": False,
                "reason": (f"only {have} stored {clean['interval']} bars for {clean['symbol']}; "
                           f"at least {req.minBars} are needed to split a search window from a "
                           f"holdout. Fetch more history first."),
                "trials": v["trials"], "storedBars": have,
            }

        bars = [
            {"date": str(r["date"]), "open": float(r["open"]), "high": float(r["high"]),
             "low": float(r["low"]), "close": float(r["close"]),
             "volume": float(r["volume"]) if r.get("volume") is not None else 0.0}
            for _, r in df.iterrows()
        ]

        c = clean["costs"]

        # ── The verdict is judged against REAL charges where they can be computed (Section 115) ──
        #
        # `CostModel` speaks only in percentages, so the bridge needs a representative notional: the
        # quantity this strategy would actually take at the last stored price. Without one, a flat ₹20
        # brokerage cannot be expressed at all, and the flat default flatters small trades by the exact
        # amount that kills them.
        #
        # DECOMPOSITION, stated rather than blended: `costs.py` covers brokerage and every statutory
        # charge, so it replaces the COMMISSION term. Slippage and spread are NOT broker charges and
        # `costs.py` does not model them, so master's own estimates for those stand untouched.
        cost_basis = {"source": "flat", "why": "no instrument on the spec, so the flat percentages stand"}
        commission = c["commissionPct"]
        try:
            from engine import costs as costs_mod
            instrument = clean.get("instrument")
            rep_price = float(bars[-1]["close"])
            raw_qty = strategy_spec.position_size(clean, rep_price)
            lot = max(1, int(clean.get("lotSize") or 1))
            rep_qty = (raw_qty // lot) * lot
            if instrument and instrument != "options" and rep_qty > 0:
                eff = costs_mod.effective_round_trip_pct(instrument, rep_price, rep_qty)
                if eff.get("ok"):
                    commission = eff["pct"] / 2.0     # round_trip = 2*(comm + slip) + spread
                    cost_basis = {
                        "source": "measured", "instrument": instrument,
                        "roundTripPct": eff["pct"],
                        "assumedPrice": eff["assumedPrice"], "assumedQuantity": eff["assumedQuantity"],
                        "assumedNotional": eff["assumedNotional"],
                        "why": ("brokerage and statutory charges computed for this instrument at the "
                                "quantity the strategy would take; slippage and spread remain master's "
                                "own estimates because they are not broker charges"),
                        "provenance": eff["provenance"],
                    }
            elif instrument == "options":
                cost_basis = {"source": "flat", "instrument": instrument,
                              "why": "options are priced on premium and there is no premium history"}
            elif instrument and rep_qty <= 0:
                cost_basis = {"source": "flat", "instrument": instrument,
                              "why": (f"the risk budget sizes below one lot of {lot} units at "
                                      f"{rep_price:g}, so there is no quantity to price charges on")}
        except Exception as e:                       # a charge model fault must not lose the backtest
            logger.warning(f"Real charge basis unavailable: {e}")
            cost_basis = {"source": "flat", "why": f"charge model unavailable: {e}"}

        costs = strategy_eval.CostModel(
            commission_pct=commission, slippage_pct=c["slippagePct"],
            spread_pct=c["spreadPct"],
        )
        variants = strategy_spec.expand_sweep(clean)
        result = strategy_eval.search_and_judge(
            variants,
            lambda variant, a, b: strategy_spec.simulate(variant, bars, a, b),
            n=len(bars),
            holdout_frac=req.holdoutFrac,
            cost_model=costs,
            provenance={
                "symbol": clean["symbol"], "exchange": clean["exchange"],
                "interval": clean["interval"], "specHash": v["specHash"],
                "bars": len(bars), "firstBar": bars[0]["date"], "lastBar": bars[-1]["date"],
                "generator": "strategy_spec", "side": clean["side"],
            },
        )
        if not result.get("ok"):
            return {**result, "warnings": v["warnings"], "trials": result.get("trials", v["trials"])}

        # The winning variant's money outcome, on the HOLDOUT only. Quoting a currency figure from the
        # search window would be quoting the number the search was optimising.
        search_end, total = strategy_eval.holdout_split(len(bars), req.holdoutFrac)
        best = result["variant"]
        holdout_trades = strategy_spec.simulate(best, bars, search_end, total)
        money = strategy_spec.money_summary(best, holdout_trades, costs.round_trip_pct())

        return {
            **result,
            "spec": best,
            "specHash": strategy_spec.spec_hash(best),
            "warnings": v["warnings"],
            "bars": len(bars),
            "window": {"searchBars": search_end, "holdoutBars": total - search_end,
                       "firstBar": bars[0]["date"], "lastBar": bars[-1]["date"]},
            "holdoutTrades": holdout_trades,
            "money": money,
            # Which cost assumption produced the verdict. A verdict without this is a verdict whose
            # most consequential input is invisible.
            "costBasis": cost_basis,
        }
    except Exception as e:
        logger.error(f"Strategy backtest failed: {e}", exc_info=True)
        return {"ok": False, "reason": str(e)}


class StrategyCodeRequest(BaseModel):
    spec:    dict
    verdict: Optional[dict] = None
    trials:  int = Field(default=1, ge=1)


@app.post("/strategy/code")
def strategy_code(req: StrategyCodeRequest):
    """
    Emit the standalone Python for a spec.

    The verdict travels in the header. A generated strategy file that does not carry what Rāma
    concluded would look like an endorsement, get kept, and be run months later with no record of
    whether it ever passed.
    """
    try:
        from engine import strategy_codegen, strategy_spec
        name = "".join(ch if ch.isalnum() else "_"
                       for ch in str(req.spec.get("name") or "strategy")).strip("_").lower()
        out = strategy_codegen.to_python(
            req.spec, verdict=req.verdict, trials=req.trials,
            filename=f"{name or 'strategy'}.py",
        )
        out["trials"] = req.trials
        out["catalogueVersion"] = strategy_spec.spec_hash(
            {k: v["label"] for k, v in strategy_spec.BLOCKS.items()})
        return out
    except Exception as e:
        logger.error(f"Strategy codegen failed: {e}", exc_info=True)
        return {"ok": False, "reason": str(e), "code": None}


# ── The literature, and what a trade really costs (spec Section 113) ──────────
#
# ROUTED IMMEDIATELY, not later. Section 95's recorded lesson is that `strategy_eval.py` was built with
# 64 assertions and was reachable from nothing — no route, no IPC, no caller — so the harness that
# decides whether a strategy found an edge sat outside the product from the day it was written. A
# library nobody can open is the same defect with a different module name.

@app.get("/strategy/instruments")
def strategy_instruments():
    """
    The instrument types, for master's per-instrument tabs (Section 115).

    Carries `backtestable` per instrument, because a tab that looks identical to the others while being
    unable to produce a verdict is the worst of the four. Options say so on the tab itself.
    """
    from engine import costs, strategy_spec
    labels = costs.INSTRUMENT_LABELS
    return {
        "ok": True,
        "instruments": [
            {
                "id": i,
                "label": labels.get(i, i),
                "backtestable": i != "options",
                "why": (None if i != "options" else
                        "Option charges apply to the premium and there is no per-strike premium "
                        "history, so a strategy here can be specified and watched forward but not "
                        "backtested."),
                "needsLotSize": i in ("futures", "options"),
                "sttPct": costs.STT[i]["pct"], "sttSide": costs.STT[i]["side"],
                "sttBasis": costs.STT[i]["basis"],
            }
            for i in strategy_spec.INSTRUMENTS
        ],
        "derivation": ("When no instrument is chosen, daily-or-longer bars are priced as delivery and "
                       "intraday bars as intraday, and the spec records that it was derived."),
        "provenance": costs.provenance(),
    }


@app.get("/strategy/library")
def strategy_library_catalogue():
    """
    Book- and paper-derived strategies, what each author claimed, and what would disprove it.

    Carries `winRateWarning` deliberately: master asked for strategies at "80% and above", and the
    honest answer travels with the thing he asked for rather than being filed elsewhere.
    """
    from engine import strategy_library
    return strategy_library.catalogue()


@app.get("/strategy/library/{template_id}")
def strategy_library_build(template_id: str, symbol: str, exchange: str = "NSE",
                           interval: str = "1d", capital: float = 100000.0,
                           riskPct: float = 1.0, includeSweep: bool = True):
    """
    One template completed into a spec, validated, with its provenance and expected shape.

    Returns a spec for `/strategy/backtest` rather than backtesting here, so a template goes through
    exactly the same judge as a hand-built strategy. A library with its own private scoring path would
    be a second definition of "passed".
    """
    try:
        from engine import strategy_library, strategy_spec
        spec = strategy_library.build(
            template_id, symbol=symbol, exchange=exchange, interval=interval,
            capital=capital, risk_pct=riskPct, include_sweep=includeSweep,
        )
        v = strategy_spec.validate_spec(spec)
        return {
            "ok": v["ok"],
            "spec": v["spec"],
            "trials": v["trials"],
            "warnings": v["warnings"],
            "errors": v["errors"],
            "provenance": strategy_library.provenance(template_id),
            "expectedShape": strategy_library.expected_shape(template_id),
            # Said on the way out as well as in the catalogue: the author's claim is not a result.
            "note": ("This is the author's strategy as stated, not a verdict. Backtest it to find out "
                     "whether it works on this instrument."),
        }
    except KeyError as e:
        return {"ok": False, "reason": str(e)}
    except Exception as e:
        logger.error(f"Strategy library build failed: {e}", exc_info=True)
        return {"ok": False, "reason": str(e)}


@app.get("/costs/registry")
def costs_registry():
    """Which instruments Rāma can price, at what rates, from which source — and what it does not model."""
    from engine import costs
    return costs.registry()


class CostQuoteRequest(BaseModel):
    instrument:   str
    entryPrice:   float = Field(gt=0)
    exitPrice:    Optional[float] = None
    quantity:     float = Field(gt=0)
    side:         str = "long"
    trades:       int = Field(default=1, ge=1)


@app.post("/costs/quote")
def costs_quote(req: CostQuoteRequest):
    """
    What a round trip costs in rupees, and what that is across a number of trades.

    `trades` answers master's *"charges for no. of trades suggested and actually taken"* — the same
    round trip repeated, because a strategy's cost is per trade and a hundred trades is a hundred times
    the drag. Reported as a total AND as a share of capital, since the second is what decides whether an
    edge survives.
    """
    try:
        from engine import costs
        rt = costs.round_trip_charges(
            req.instrument, req.entryPrice, req.exitPrice or req.entryPrice,
            req.quantity, side=req.side,
        )
        if not rt.get("ok"):
            return rt
        notional = req.entryPrice * req.quantity
        return {
            **rt,
            "trades": req.trades,
            "totalAcrossTrades": rt["total"] * req.trades,
            "pctAcrossTrades": (rt["total"] * req.trades / notional * 100.0) if notional > 0 else None,
            "notional": notional,
            "provenance": costs.provenance(),
        }
    except Exception as e:
        logger.error(f"Cost quote failed: {e}", exc_info=True)
        return {"ok": False, "reason": str(e)}


# ── Macro transmission (spec Section 114) ─────────────────────────────────────

@app.get("/macro/registry")
def macro_registry():
    """
    The exposure map, the method, and what has no free series — master's transmission chain declared.

    Reads as a set of HYPOTHESES. Every sign and lag is declared here before anything is measured, which
    is what makes `/macro/measure` a pre-registered test rather than a search.
    """
    from engine import macro
    return macro.registry()


@app.post("/macro/sync")
def macro_sync(keys: Optional[str] = None, years: int = 12):
    """
    Fetch and store the macro and sector series through the provider chain already in use.

    Reports which tickers RESOLVED. A ticker written into the registry is not a ticker that works, and
    "no data" must stay distinguishable from "never fetched".
    """
    try:
        from engine import macro
        wanted = [k.strip() for k in keys.split(",")] if keys else None
        return {"ok": True, **macro.sync(wanted, years=years)}
    except Exception as e:
        logger.error(f"Macro sync failed: {e}", exc_info=True)
        return {"ok": False, "reason": str(e)}


@app.get("/macro/measure")
def macro_measure(only: Optional[str] = None):
    """
    Measure every declared link against stored history.

    A link measuring opposite to its declared direction comes back `contradicted` and is NOT flipped.
    The control results travel with the answer: if the positive control fails, nothing else here is
    believable, and that is stated rather than left for the reader to notice.
    """
    try:
        from engine import macro
        ids = [k.strip() for k in only.split(",")] if only else None
        return {"ok": True, **macro.measure_all(macro.load_series, only=ids)}
    except Exception as e:
        logger.error(f"Macro measure failed: {e}", exc_info=True)
        return {"ok": False, "reason": str(e)}


@app.get("/symbols/search")
def symbols_search(q: str, limit: int = 12):
    """
    Search the provider for an instrument by name or ticker (spec Section 102).

    Master's objection to the previous picker was exact: nobody can know every stock and index in
    every market, so a curated list beside a bare text box is not a picker. This is the honest
    answer — ask the provider, which is what a trading platform does.

    A FAILURE IS REPORTED, NEVER RETURNED AS "NOTHING MATCHED". The renderer falls back to its own
    offline list when this route cannot answer, and it can only choose to do that if it can tell the
    two apart. `{results: [], ok: true}` means the provider has no such instrument;
    `{ok: false, reason}` means Rāma could not ask.
    """
    try:
        from engine import providers
        return {"ok": True, "query": q, "results": providers.search_symbols(q, limit)}
    except Exception as e:
        logger.warning(f"Symbol search failed for {q!r}: {e}")
        return {"ok": False, "query": q, "results": [], "reason": str(e)}


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
    # Part of the position key (Section 77): an intraday scalp in a symbol master also holds for
    # delivery is a separate position, not an addition to the holding.
    tradeStyle: Optional[str] = None
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


class StyleRequest(BaseModel):
    positionId: str
    tradeStyle: str
    interval:   str = "1d"


@app.post("/ledger/style")
def ledger_style(req: StyleRequest):
    """
    Correct a mis-recorded trade style. Recorded in the position's notes, not overwritten
    quietly — the style drives the intraday square-off alert, so changing it changes what Rāma
    will warn about.
    """
    try:
        from engine import ledger
        return ledger.set_style(req.positionId, req.tradeStyle, interval=req.interval)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Ledger style error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ledger/positions")
def ledger_positions(status: Optional[str] = None, symbol: Optional[str] = None,
                     interval: str = "1d", tradeStyle: Optional[str] = None):
    """
    Every tracked position, marked to market against stored bars.

    A position whose price could not be resolved carries `unrealisedPnl: null` and a flag
    saying so — it is never marked at its entry price and reported as flat P&L.
    """
    try:
        from engine import ledger
        rows = ledger.positions(status=status, symbol=symbol, interval=interval,
                                trade_style=tradeStyle)
        return {"positions": rows, "count": len(rows),
                "open": sum(1 for r in rows if r["status"] == "open"),
                "styles": list(ledger.TRADE_STYLES)}
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
            note=req.note, prediction_id=req.predictionId, interval=req.interval,
            trade_style=req.tradeStyle)
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


# ── Alerts (spec Section 75) ─────────────────────────────────────────────────

@app.get("/alerts")
def alerts_for_book(symbol: Optional[str] = None, includePrediction: bool = False,
                    interval: str = "1d"):
    """
    When to leave, reduce, or add — with the evidence that entitles each answer.

    Every alert carries an `evidence` class and an `actionable` flag. `DECLARED` (master's own
    stop or target) and `MEASURED` (arithmetic over his fills and stored bars) can be acted on.
    `MODEL` can only be acted on if that horizon cleared Section 69's gate — none currently do,
    so those come back with `actionable: false` and the recorded refusal reason rather than
    being either hidden or promoted into advice.

    A stale price disqualifies every alert that compares a price, because an exit fired on last
    week's close carries the authority of a system that looks current.
    """
    try:
        from engine import alerts
        return alerts.evaluate(symbol=symbol, include_prediction=includePrediction,
                               interval=interval)
    except Exception as e:
        logger.error(f"Alert evaluation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/alerts/entitlement")
def alerts_entitlement():
    """Which horizons have a model entitled to influence an alert, read from provenance."""
    try:
        from engine import alerts
        from engine import horizons as _h
        ent = {n: alerts.model_entitlement(n) for n in _h.DEFAULT_ORDER}
        entitled = [n for n, e in ent.items() if e["entitled"]]
        return {"entitlements": ent, "entitled": entitled,
                "anyEntitled": bool(entitled),
                "note": ("A horizon with no gate-passing model cannot make an alert "
                         "actionable. This is read from the per-horizon training record, "
                         "not assumed." if not entitled else
                         f"actionable model readings available for: {', '.join(entitled)}")}
    except Exception as e:
        logger.error(f"Entitlement error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Justification and warnings (spec Section 76) ──────────────────────────────

@app.get("/explain/{symbol}")
def explain_symbol(symbol: str, exchange: str = "NSE", includePrediction: bool = True,
                   includeLive: bool = False, interval: str = "1d",
                   includePositions: bool = True):
    """
    Bullets justifying a reading, and the pitfalls that could cost master capital.

    Each bullet carries a `basis`: `observation` (a measured fact), `convention` (how the
    market conventionally reads it — not validated here), `forecast` (a model's output) or
    `gate` (whether that forecast may be believed). They are never merged: "RSI is 72.4" is a
    fact, "RSI is 72.4 therefore it will fall" is a claim StockMind has not earned.

    **The gate bullet is emitted before the probability it qualifies**, and `caveat` travels in
    the payload rather than being left for a UI to add, so bullets cannot be rendered without it.

    A check that could not run appears as a warning with `checked: false`. An empty warning list
    means "checked and clear", never "could not look". `includeLive` adds delivery percentage
    and event risk, both of which need the network and are therefore off by default.
    """
    try:
        from engine import explain
        return explain.brief(symbol, exchange, include_prediction=includePrediction,
                             include_live=includeLive, interval=interval,
                             include_positions=includePositions)
    except Exception as e:
        logger.error(f"Explain error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/explain/{symbol}/correlations")
def explain_correlations(symbol: str, exchange: str = "NSE", against: Optional[str] = None,
                         lookback: int = 120):
    """
    Return correlation against held positions, measured from stored bars.

    No sector table: a hardcoded symbol→sector map would be a guess that rots, and it would
    miss an index against its own heavyweight constituent, which is correlated by construction.
    """
    try:
        from engine import explain, ledger
        peers = [p.strip().upper() for p in (against or "").split(",") if p.strip()]
        if not peers:
            peers = [p["symbol"] for p in ledger.positions(status=ledger.STATUS_OPEN)]
        return explain.correlations(list({symbol.upper(), *peers}), exchange, lookback)
    except Exception as e:
        logger.error(f"Correlation error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Projection cone and risk ruler (spec Section 78) ──────────────────────────

@app.get("/forecast/{symbol}")
def forecast_symbol(symbol: str, exchange: str = "NSE", horizon: str = "swing",
                    probability: Optional[float] = None, stop: Optional[float] = None,
                    target: Optional[float] = None, entry: Optional[float] = None,
                    lookback: int = 120):
    """
    The forward cone and the risk ruler, for drawing on a chart.

    A CONE, NEVER A PATH: a single predicted line would imply Rāma knows the path. The cone's
    **width** is this instrument's own measured volatility scaled by √h — a fact. Its **centre**
    is flat unless that horizon's model cleared the gate, and `cone.tilted` says which.

    `risk` is the ruler: whether master's stop sits inside one bar of ordinary noise (so it will
    be hit by movement rather than by being wrong), and whether his target sits inside one
    horizon-sigma (so reaching it needs no edge). Both are arithmetic, so both are usable today.
    """
    try:
        from engine import projection
        return projection.forecast(symbol, exchange, horizon, probability, stop, target,
                                   entry, lookback)
    except Exception as e:
        logger.error(f"Forecast error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/volatility/{symbol}")
def volatility_symbol(symbol: str, exchange: str = "NSE", interval: str = "1d",
                      lookback: int = 120):
    """Realised volatility and ATR, measured on the interval given — not scaled from daily."""
    try:
        from engine import projection
        return projection.volatility(symbol, exchange, interval, lookback)
    except Exception as e:
        logger.error(f"Volatility error for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("STOCKMIND_PYTHON_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
