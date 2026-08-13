"""
dispatcher.py — Routes prediction requests to the correct generator.

Upgrades:
  - Uses real OHLCV from Node.js backend (via data_fetcher)
  - Applies adaptive weight from learning history
  - Supports dual-mode: learning (exploratory) vs realworld (calibrated)
  - Futures meta: basis, lot size, expiry from FuturesPanel
  - Options meta: strike, expiry, IV from OptionsPanel
  - Derivative recommender: scan all strikes for an index
"""

import numpy as np
import uuid
import time
import logging
from typing import Any

from .registry import MODEL_REGISTRY
from .features import compute_features
from .calibration import clamp_probability, regime_adjust
from .data_fetcher import get_ohlcv

logger = logging.getLogger("stockmind-ai.dispatcher")

# ── Black-Scholes ─────────────────────────────────────────────────────────────

def _erf(x):
    t = 1 / (1 + 0.3275911 * abs(x))
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return y if x >= 0 else -y

def _N(x): return 0.5 * (1 + _erf(x / np.sqrt(2)))
def _n(x): return np.exp(-x * x / 2) / np.sqrt(2 * np.pi)

def bs_price(S, K, T, iv, opt_type):
    if T <= 0:
        return max(0, S - K) if opt_type == "CE" else max(0, K - S)
    d1 = (np.log(S / K) + (0.05 + iv**2 / 2) * T) / (iv * np.sqrt(T))
    d2 = d1 - iv * np.sqrt(T)
    if opt_type == "CE":
        return max(0, S * _N(d1) - K * np.exp(-0.05 * T) * _N(d2))
    return max(0, K * np.exp(-0.05 * T) * _N(-d2) - S * _N(-d1))

def bs_greeks(S, K, T, iv, opt_type):
    if T <= 0:
        return {"delta": 1.0 if (opt_type == "CE" and S > K) else -1.0, "gamma": 0, "theta": 0, "vega": 0}
    d1 = (np.log(S / K) + (0.05 + iv**2 / 2) * T) / (iv * np.sqrt(T))
    d2 = d1 - iv * np.sqrt(T)
    delta = _N(d1) if opt_type == "CE" else _N(d1) - 1
    gamma = _n(d1) / (S * iv * np.sqrt(T))
    theta = (-(S * _n(d1) * iv) / (2 * np.sqrt(T)) - 0.05 * K * np.exp(-0.05 * T) * (_N(d2) if opt_type == "CE" else _N(-d2))) / 365
    vega  = S * _n(d1) * np.sqrt(T) / 100
    return {
        "delta": round(delta, 4),
        "gamma": round(gamma, 6),
        "theta": round(theta, 4),
        "vega":  round(vega, 4),
    }

# ── Config ────────────────────────────────────────────────────────────────────

STRIKE_STEPS = {"NIFTY": 50, "BANKNIFTY": 100, "FINNIFTY": 50, "MIDCPNIFTY": 25, "SENSEX": 100, "NIFTY50": 50}
LOT_SIZES    = {"NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 40, "MIDCPNIFTY": 75, "SENSEX": 10, "NIFTY50": 25}

def _step(sym): return STRIKE_STEPS.get(sym.upper().replace("50", "").replace("NIFTY50", "NIFTY"), 50)
def _lot(sym):  return LOT_SIZES.get(sym.upper().replace("50", "").replace("NIFTY50", "NIFTY"), 25)
def _atm(price, sym): s = _step(sym); return round(price / s) * s

# ── Mode-aware probability adjustment ────────────────────────────────────────

def _apply_mode(prob: float, mode: str, adaptive_weight: float = 1.0) -> float:
    """
    Apply prediction mode adjustments:
      - learning:   wider confidence intervals, more exploratory
      - realworld:  tighter, uses adaptive weight from history
      - both:       blend of both
    """
    if mode == "learning":
        # Add noise to explore the probability space
        noise = np.random.normal(0, 0.04)
        return float(np.clip(prob + noise, 0.10, 0.95))
    elif mode == "realworld":
        # Apply adaptive weight from learning history
        adjusted = prob * adaptive_weight
        return float(np.clip(adjusted, 0.05, 0.99))
    else:  # both
        # Blend: 40% learning (noisy), 60% realworld (calibrated)
        learning_p  = float(np.clip(prob + np.random.normal(0, 0.03), 0.10, 0.95))
        realworld_p = float(np.clip(prob * adaptive_weight, 0.05, 0.99))
        return float(np.clip(0.4 * learning_p + 0.6 * realworld_p, 0.05, 0.99))

# ── Signal builder ────────────────────────────────────────────────────────────

def _build_signal(rank, prob, direction, entry, sl, t1, t2, t3, capital, risk_pct, reasons, extra=None):
    max_risk = capital * (risk_pct / 100)
    rr = abs(t1 - entry) / (abs(entry - sl) + 1e-9)
    grade = "A+" if prob >= 0.80 else "A" if prob >= 0.70 else "B" if prob >= 0.60 else "C" if prob >= 0.50 else "D"
    prob_pct = int(round(clamp_probability(prob) * 100))
    return {
        "rank":               rank,
        "id":                 uuid.uuid4().hex,
        "type":               direction,
        "entryPrice":         round(entry, 2),
        "entryZoneLow":       round(entry - abs(entry - sl) * 0.1, 2),
        "entryZoneHigh":      round(entry + abs(entry - sl) * 0.1, 2),
        "t1Price":            round(t1, 2),
        "t2Price":            round(t2, 2),
        "t3Price":            round(t3, 2),
        "stopLoss":           round(sl, 2),
        "immediateOptimalSL": round(sl + (entry - sl) * 0.35, 2),
        "maxRisk":            round(max_risk),
        "riskRewardRatio":    round(rr, 2),
        "validity":           _validity_ts(rank),
        "validityBars":       max(4, 16 - rank),
        "probability":        prob_pct,
        "grade":              grade,
        "t1Probability":      prob_pct,
        "t2Probability":      int(clamp_probability(prob - 0.18) * 100),
        "t3Probability":      int(clamp_probability(prob - 0.38) * 100),
        "slProbability":      int(clamp_probability(1 - prob) * 100),
        "regime":             "trending",
        "reasons":            reasons,
        "suppressed":         False,
        "suppressReason":     None,
        "hmacSignature":      "",
        **(extra or {}),
    }

def _validity_ts(rank):
    import datetime
    dt = datetime.datetime.now() + datetime.timedelta(minutes=(16 - rank) * 15)
    return dt.isoformat()

# ── Main entry point ──────────────────────────────────────────────────────────

def generate_signals(params: dict) -> list[dict]:
    instr_type   = params.get("instrType", "spot")
    is_deriv_rec = params.get("isDerivRec", False) or params.get("isIndexDerivRec", False)

    if is_deriv_rec:
        return _deriv_recommendations(params)
    if instr_type == "futures":
        return _futures_signals(params)
    if instr_type == "options":
        return _options_signals(params)
    return _spot_signals(params)


def _signal_count(params: dict) -> int:
    """Return user-requested signal count, clamped to 1–50. Defaults to 16."""
    n = params.get("signalCount") or params.get("count") or 16
    try:
        return max(1, min(50, int(n)))
    except (TypeError, ValueError):
        return 16


# ── Spot signals ──────────────────────────────────────────────────────────────

def _spot_signals(params: dict) -> list[dict]:
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    direction      = params.get("direction", "both")
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))

    df, is_real = get_ohlcv(params)
    features = compute_features(df)

    if not is_real:
        logger.info(f"[Dispatcher] {symbol}: using mock OHLCV for features")

    count = _signal_count(params)
    signals = []
    for i in range(count):
        result = MODEL_REGISTRY.ensemble_predict(
            features + np.random.normal(0, 0.01, len(features))
        )
        raw_prob = result["probability"]
        prob = _apply_mode(raw_prob, mode, adaptive_weight)

        is_long = direction == "long" or (direction == "both" and i % 3 != 2)
        atr = base * 0.009
        entry = base + np.random.uniform(-atr * 0.3, atr * 0.3)
        sl = entry - atr * 1.3 if is_long else entry + atr * 1.3
        t1 = entry + atr * 1.8 if is_long else entry - atr * 1.8
        t2 = entry + atr * 3.0 if is_long else entry - atr * 3.0
        t3 = entry + atr * 4.5 if is_long else entry - atr * 4.5

        reasons = result["reasons"]
        if not is_real:
            reasons = reasons + ["⚠ Using estimated data — live data unavailable"]

        signals.append(_build_signal(
            i + 1, prob, "LONG" if is_long else "SHORT",
            entry, sl, t1, t2, t3, capital, risk_pct, reasons,
            {"instrType": "spot", "spotPrice": round(base, 2), "dataSource": "real" if is_real else "mock"},
        ))

    signals.sort(key=lambda s: s["probability"], reverse=True)
    for i, s in enumerate(signals): s["rank"] = i + 1
    return signals


# ── Futures signals ───────────────────────────────────────────────────────────

def _futures_signals(params: dict) -> list[dict]:
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    direction      = params.get("direction", "both")
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))

    # Use futures meta from FuturesPanel if available
    futures_meta = params.get("futuresMeta") or {}
    lot_size     = futures_meta.get("lotSize") or params.get("lotSize") or _lot(symbol)
    basis        = futures_meta.get("basis") or base * (0.001 + np.random.uniform(0, 0.004))
    fut_base     = futures_meta.get("futuresPrice") or (base + basis)
    days_left    = futures_meta.get("daysLeft", 30)
    series       = futures_meta.get("series", "Near")

    df, is_real = get_ohlcv(params)
    features = compute_features(df)

    count = _signal_count(params)
    signals = []
    for i in range(count):
        result = MODEL_REGISTRY.ensemble_predict(
            features + np.random.normal(0, 0.01, len(features))
        )
        raw_prob = result["probability"]
        prob = _apply_mode(raw_prob, mode, adaptive_weight)

        is_long = direction == "long" or (direction == "both" and i % 3 != 2)
        atr = fut_base * 0.009
        entry = fut_base + np.random.uniform(-atr * 0.2, atr * 0.2)
        sl = entry - atr * 1.3 if is_long else entry + atr * 1.3
        t1 = entry + atr * 1.8 if is_long else entry - atr * 1.8
        t2 = entry + atr * 3.2 if is_long else entry - atr * 3.2
        t3 = entry + atr * 5.0 if is_long else entry - atr * 5.0

        lots = max(1, int((capital * risk_pct / 100) / (abs(entry - sl) * lot_size + 1e-9)))
        max_risk_lots = abs(entry - sl) * lot_size * lots

        reasons = result["reasons"][:3] + [
            f"Futures basis {'+' if basis >= 0 else ''}{basis:.1f} ({basis/base*100:.2f}%) — {series} series",
            f"{lots} lot{'s' if lots > 1 else ''} × {lot_size} = ₹{max_risk_lots:,.0f} max risk",
            f"{days_left}d to expiry",
        ]

        signals.append(_build_signal(
            i + 1, prob, "LONG" if is_long else "SHORT",
            entry, sl, t1, t2, t3, capital, risk_pct, reasons,
            {
                "instrType": "futures", "spotPrice": round(base, 2),
                "lotSize": lot_size, "lotCount": lots,
                "basis": round(basis, 2), "maxRisk": round(max_risk_lots),
                "daysLeft": days_left, "series": series,
                "dataSource": "real" if is_real else "mock",
            },
        ))

    signals.sort(key=lambda s: s["probability"], reverse=True)
    for i, s in enumerate(signals): s["rank"] = i + 1
    return signals


# ── Options signals ───────────────────────────────────────────────────────────

def _options_signals(params: dict) -> list[dict]:
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))

    # Use options meta from OptionsPanel if available
    option_meta = params.get("optionMeta") or {}
    strike      = option_meta.get("strike") or params.get("strike") or _atm(base, symbol)
    opt_type    = option_meta.get("optType") or params.get("optType", "CE")
    days_left   = option_meta.get("daysLeft") or params.get("daysLeft", 14)
    lot_size    = option_meta.get("lotSize") or params.get("lotSize") or _lot(symbol)
    iv_override = option_meta.get("iv")  # IV from OptionsPanel (already in %)
    T = max(0.001, days_left / 365)

    df, is_real = get_ohlcv(params)
    features = compute_features(df)

    # Use IV from OptionsPanel if available, else compute
    if iv_override:
        iv = iv_override / 100.0
    else:
        iv = 0.16 + abs(strike - _atm(base, symbol)) / base * 0.8 + np.random.uniform(0, 0.04)

    premium  = bs_price(base, strike, T, iv, opt_type)
    greeks   = bs_greeks(base, strike, T, iv, opt_type)
    breakeven = strike + premium if opt_type == "CE" else strike - premium
    idx_move  = breakeven - base

    daily_vol  = base * 0.009
    period_vol = daily_vol * np.sqrt(max(1, days_left))
    z_score    = abs(idx_move) / (period_vol + 1e-9)
    prob_reach = float(np.clip(1 - min(0.95, z_score * 0.28), 0.10, 0.90))

    count = _signal_count(params)
    signals = []
    for i in range(count):
        result = MODEL_REGISTRY.ensemble_predict(
            features + np.random.normal(0, 0.01, len(features))
        )
        raw_prob = float(np.clip(result["probability"] * 0.6 + prob_reach * 0.4, 0.10, 0.95))
        prob = _apply_mode(raw_prob, mode, adaptive_weight)

        entry = max(0.5, premium * (0.95 + np.random.uniform(0, 0.1)))
        sl    = max(0.1, entry * (0.40 + np.random.uniform(0, 0.15)))
        t1    = entry * (1.5 + np.random.uniform(0, 0.3))
        t2    = entry * (2.2 + np.random.uniform(0, 0.4))
        t3    = entry * (3.0 + np.random.uniform(0, 0.5))

        lots = max(1, int((capital * risk_pct / 100) / (entry * lot_size + 1e-9)))
        max_risk_lots = (entry - sl) * lot_size * lots

        reasons = [
            f"{opt_type} {strike:.0f} | Spot: ₹{base:.0f} | IV: {iv*100:.1f}% | {days_left}d to expiry",
            f"Δ {greeks['delta']:.3f} | Θ {greeks['theta']:.2f}/day | ν {greeks['vega']:.2f}",
            f"Index needs {idx_move:+.0f} pts → breakeven {breakeven:.0f}",
            f"Prob reach breakeven: {int(prob_reach*100)}%",
            f"{lots} lot{'s' if lots > 1 else ''} × {lot_size} = ₹{entry*lot_size*lots:,.0f} premium",
        ]

        signals.append(_build_signal(
            i + 1, prob, "LONG" if opt_type == "CE" else "SHORT",
            entry, sl, t1, t2, t3, capital, risk_pct, reasons,
            {
                "instrType": "options", "spotPrice": round(base, 2),
                "optType": opt_type, "strike": strike,
                "iv": round(iv * 100, 1), **greeks,
                "lotSize": lot_size, "lotCount": lots,
                "maxRisk": round(max_risk_lots),
                "breakeven": round(breakeven, 2),
                "indexMoveNeeded": round(idx_move, 2),
                "probReachBreakeven": int(prob_reach * 100),
                "dataSource": "real" if is_real else "mock",
            },
        ))

    signals.sort(key=lambda s: s["probability"], reverse=True)
    for i, s in enumerate(signals): s["rank"] = i + 1
    return signals


# ── Derivative recommender ────────────────────────────────────────────────────

def _deriv_recommendations(params: dict) -> list[dict]:
    """Scan all nearby strikes + futures, rank by profit potential."""
    symbol         = params["symbol"]
    base           = params["basePrice"]
    capital        = params["capital"]
    risk_pct       = params["riskPct"]
    direction      = params.get("direction", "both")
    mode           = params.get("predictionMode", "both")
    adaptive_weight = float(params.get("adaptiveWeight", 1.0))
    step           = _step(symbol)
    atm            = _atm(base, symbol)
    lot_size       = _lot(symbol)
    T              = 0.04 + np.random.uniform(0, 0.06)
    iv_base        = 0.16 + np.random.uniform(0, 0.06)

    df, is_real = get_ohlcv(params)
    features = compute_features(df)

    candidates = []

    # Futures
    basis    = base * (0.001 + np.random.uniform(0, 0.003))
    fut_base = base + basis
    atr      = fut_base * 0.009
    result   = MODEL_REGISTRY.ensemble_predict(features)
    fut_prob = _apply_mode(result["probability"], mode, adaptive_weight)
    candidates.append({
        "label": f"{symbol} Futures", "instrType": "futures",
        "symbol": f"{symbol}FUT", "prob": fut_prob,
        "entry": fut_base, "sl": fut_base - atr * 1.3,
        "t1": fut_base + atr * 2.0, "t2": fut_base + atr * 3.5, "t3": fut_base + atr * 5.5,
        "rr": (atr * 2.0) / (atr * 1.3), "score": fut_prob * 1.54 * 0.8,
        "lotSize": lot_size, "basis": round(basis, 2),
        "reasons": result["reasons"][:3] + [f"Futures basis +{basis:.1f}"],
    })

    # Options: ATM ± 4 strikes
    for n in range(-4, 5):
        strike = atm + n * step
        for opt_type in ["CE", "PE"]:
            if direction == "long"  and opt_type == "PE": continue
            if direction == "short" and opt_type == "CE": continue

            iv = iv_base + abs(n) * 0.02
            premium = bs_price(base, strike, T, iv, opt_type)
            if premium < 1: continue

            greeks = bs_greeks(base, strike, T, iv, opt_type)
            sl = max(0.5, premium * 0.45)
            t1 = premium * 1.6
            rr = (t1 - premium) / (premium - sl + 1e-9)

            result = MODEL_REGISTRY.ensemble_predict(
                features + np.random.normal(0, 0.02, len(features))
            )
            raw_prob = float(np.clip(result["probability"] * 0.7 + abs(greeks["delta"]) * 0.3, 0.10, 0.95))
            prob = _apply_mode(raw_prob, mode, adaptive_weight)
            cap_eff = (t1 - premium) / (premium + 1e-9)
            score = prob * rr * cap_eff * (1.0 if opt_type == "CE" else 0.95)

            moneyness = "ATM" if n == 0 else (
                f"OTM +{n*step}" if (opt_type == "CE" and n > 0) or (opt_type == "PE" and n < 0)
                else f"ITM {abs(n)*step}"
            )

            candidates.append({
                "label": f"{symbol} {strike:.0f} {opt_type} ({moneyness})",
                "instrType": "options", "symbol": f"{symbol}{strike:.0f}{opt_type}",
                "optType": opt_type, "strike": strike, "prob": prob,
                "entry": round(premium, 2), "sl": round(sl, 2),
                "t1": round(t1, 2), "t2": round(premium * 2.4, 2), "t3": round(premium * 3.5, 2),
                "rr": round(rr, 2), "score": score, "iv": round(iv * 100, 1),
                "lotSize": lot_size, **greeks,
                "reasons": [
                    f"{opt_type} {strike:.0f} ({moneyness}) | IV: {iv*100:.1f}%",
                    f"Δ {greeks['delta']:.3f} | Θ {greeks['theta']:.2f}/day",
                    f"Premium ₹{premium:.1f} | R:R 1:{rr:.2f}",
                    f"Capital efficiency: {cap_eff*100:.0f}% gain at T1",
                ],
            })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    count = _signal_count(params)
    top_n = candidates[:count]

    signals = []
    for i, c in enumerate(top_n):
        lots = max(1, int((capital * risk_pct / 100) / (abs(c["entry"] - c["sl"]) * c["lotSize"] + 1e-9)))
        signals.append(_build_signal(
            i + 1, c["prob"],
            "SHORT" if c.get("optType") == "PE" else "LONG",
            c["entry"], c["sl"], c["t1"], c["t2"], c["t3"],
            capital, risk_pct, c["reasons"],
            {
                "instrType":  c["instrType"],
                "spotPrice":  round(base, 2),
                "derivLabel": c["label"],
                "symbol":     c["symbol"],
                "optType":    c.get("optType"),
                "strike":     c.get("strike"),
                "iv":         c.get("iv"),
                "delta":      c.get("delta"),
                "gamma":      c.get("gamma"),
                "theta":      c.get("theta"),
                "vega":       c.get("vega"),
                "lotSize":    c["lotSize"],
                "lotCount":   lots,
                "basis":      c.get("basis"),
                "score":      round(c["score"], 2),
                "maxRisk":    round(abs(c["entry"] - c["sl"]) * c["lotSize"] * lots),
                "dataSource": "real" if is_real else "mock",
            },
        ))

    return signals
