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


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("STOCKMIND_PYTHON_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
