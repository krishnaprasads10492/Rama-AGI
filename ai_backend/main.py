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


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("STOCKMIND_PYTHON_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
