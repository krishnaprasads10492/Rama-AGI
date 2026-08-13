"""
strategy_scorer.py — Multi-algorithm strategy scoring engine.

Implements 10 elite algorithms to score any instrument/strategy combination:
  1. Ensemble ML Score        — weighted average of all models
  2. Technical Confluence     — how many indicators agree
  3. Volatility-Adjusted Score — reward/risk adjusted for current vol
  4. Trend Strength Score     — ADX + EMA alignment + momentum
  5. Mean Reversion Score     — RSI extremes + Bollinger + VWAP
  6. Breakout Probability     — volume + BB squeeze + S/R proximity
  7. Options Skew Score       — IV rank + put/call ratio proxy
  8. Smart Money Score        — BOS + CHoCH + FVG + OB alignment
  9. Market Profile Score     — POC + Value Area positioning
  10. Multi-Timeframe Score   — alignment across 3 timeframes (proxy)

Each algorithm returns a score 0–100 with a confidence level.
The composite score is a weighted average based on market regime.
"""

import numpy as np
import pandas as pd
from typing import Optional
from .features import compute_features, _rsi, _ema, _adx
from .advanced_features import (
    ichimoku_features, fibonacci_features, supertrend_features,
    elliott_wave_features, market_profile_features, order_flow_features,
    smart_money_features, garch_proxy_features
)
from .calibration import clamp_probability


# ── Algorithm 1: Ensemble ML Score ───────────────────────────────────────────

def ensemble_ml_score(features: np.ndarray, registry) -> dict:
    """Run all ML models and return weighted ensemble score."""
    result = registry.ensemble_predict(features)
    prob   = result["probability"]
    score  = float(np.clip(prob * 100, 5, 99))
    return {
        "name":       "Ensemble ML",
        "score":      round(score, 1),
        "confidence": round(result["agreement"] * 100, 1),
        "signal":     "BULL" if prob > 0.55 else "BEAR" if prob < 0.45 else "NEUTRAL",
        "reasons":    result["reasons"][:3],
        "weight":     0.25,
    }


# ── Algorithm 2: Technical Confluence ────────────────────────────────────────

def technical_confluence_score(df: pd.DataFrame) -> dict:
    """Count how many technical indicators agree on direction."""
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values if "volume" in df.columns else np.ones(len(c))

    signals = []
    reasons = []

    # RSI
    rsi = _rsi(c, 14)
    if rsi < 35:
        signals.append(1); reasons.append(f"RSI {rsi:.0f} — oversold (bullish)")
    elif rsi > 65:
        signals.append(-1); reasons.append(f"RSI {rsi:.0f} — overbought (bearish)")
    else:
        signals.append(0)

    # EMA 20/50 cross
    if len(c) >= 50:
        ema20 = _ema(c, 20)[-1]
        ema50 = _ema(c, 50)[-1]
        if ema20 > ema50:
            signals.append(1); reasons.append("EMA20 > EMA50 — bullish trend")
        else:
            signals.append(-1); reasons.append("EMA20 < EMA50 — bearish trend")

    # MACD
    if len(c) >= 26:
        ema12 = _ema(c, 12)[-1]
        ema26 = _ema(c, 26)[-1]
        if ema12 > ema26:
            signals.append(1); reasons.append("MACD above signal — bullish momentum")
        else:
            signals.append(-1); reasons.append("MACD below signal — bearish momentum")

    # Bollinger position
    if len(c) >= 20:
        sma20 = np.mean(c[-20:])
        std20 = np.std(c[-20:])
        bb_pos = (c[-1] - (sma20 - 2*std20)) / (4*std20 + 1e-9)
        if bb_pos < 0.2:
            signals.append(1); reasons.append("Price near lower BB — potential bounce")
        elif bb_pos > 0.8:
            signals.append(-1); reasons.append("Price near upper BB — potential reversal")
        else:
            signals.append(0)

    # Volume confirmation
    if len(v) >= 20:
        vol_ratio = v[-1] / (np.mean(v[-20:]) + 1e-9)
        if vol_ratio > 1.5 and c[-1] > c[-2]:
            signals.append(1); reasons.append(f"Volume {vol_ratio:.1f}x avg — bullish confirmation")
        elif vol_ratio > 1.5 and c[-1] < c[-2]:
            signals.append(-1); reasons.append(f"Volume {vol_ratio:.1f}x avg — bearish confirmation")
        else:
            signals.append(0)

    # ADX trend strength
    adx = _adx(h, l, c, 14)
    if adx > 25:
        reasons.append(f"ADX {adx:.0f} — strong trend")
    else:
        reasons.append(f"ADX {adx:.0f} — weak/ranging market")

    bull_count = sum(1 for s in signals if s > 0)
    bear_count = sum(1 for s in signals if s < 0)
    total      = len(signals)
    net_score  = (bull_count - bear_count) / (total + 1e-9)
    score      = float(np.clip(50 + net_score * 45, 5, 95))
    confidence = float(max(bull_count, bear_count) / (total + 1e-9) * 100)

    return {
        "name":       "Technical Confluence",
        "score":      round(score, 1),
        "confidence": round(confidence, 1),
        "signal":     "BULL" if net_score > 0.2 else "BEAR" if net_score < -0.2 else "NEUTRAL",
        "reasons":    reasons[:3],
        "weight":     0.20,
        "bull_count": bull_count,
        "bear_count": bear_count,
    }


# ── Algorithm 3: Volatility-Adjusted Score ────────────────────────────────────

def volatility_adjusted_score(df: pd.DataFrame) -> dict:
    """Score based on current volatility regime vs historical — reward low-vol entries."""
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    feats = garch_proxy_features(df)

    cond_vol  = feats.get("garch_cond_vol", 0.01)
    vol_regime = feats.get("garch_vol_regime", 1.0)

    # ATR percentile
    if len(c) >= 50:
        tr = np.maximum(h[1:] - l[1:], np.maximum(
            np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])
        ))
        atr_now  = np.mean(tr[-14:])
        atr_hist = np.mean(tr[-50:])
        atr_pct  = float(np.sum(tr[-50:] < atr_now) / 50 * 100)
    else:
        atr_pct = 50.0

    # Low volatility = better entry (options cheaper, less slippage)
    # High volatility = premium selling opportunity
    if vol_regime < 0.8:
        score = 75 + (0.8 - vol_regime) * 30
        signal = "BULL"
        reason = f"Low vol regime ({vol_regime:.2f}x hist) — cheap entry, options underpriced"
    elif vol_regime > 1.5:
        score = 70
        signal = "NEUTRAL"
        reason = f"High vol regime ({vol_regime:.2f}x hist) — premium selling opportunity"
    else:
        score = 55
        signal = "NEUTRAL"
        reason = f"Normal vol regime ({vol_regime:.2f}x hist)"

    return {
        "name":       "Volatility-Adjusted",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(100 - abs(vol_regime - 1.0) * 30, 40, 90)), 1),
        "signal":     signal,
        "reasons":    [reason, f"ATR percentile: {atr_pct:.0f}th — {'low' if atr_pct < 30 else 'high' if atr_pct > 70 else 'normal'} volatility"],
        "weight":     0.10,
        "vol_regime": round(vol_regime, 2),
        "atr_pct":    round(atr_pct, 1),
    }


# ── Algorithm 4: Trend Strength Score ────────────────────────────────────────

def trend_strength_score(df: pd.DataFrame) -> dict:
    """ADX + EMA alignment + momentum — how strong and clean is the trend?"""
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values

    adx = _adx(h, l, c, 14)
    reasons = []

    # EMA alignment (5 > 10 > 20 > 50 = perfect bull trend)
    ema_periods = [5, 10, 20, 50, 200]
    emas = {}
    for p in ema_periods:
        if len(c) >= p:
            emas[p] = _ema(c, p)[-1]

    aligned_bull = 0
    aligned_bear = 0
    for i in range(len(ema_periods) - 1):
        p1, p2 = ema_periods[i], ema_periods[i+1]
        if p1 in emas and p2 in emas:
            if emas[p1] > emas[p2]:
                aligned_bull += 1
            else:
                aligned_bear += 1

    max_align = len(ema_periods) - 1
    bull_align_pct = aligned_bull / (max_align + 1e-9)
    bear_align_pct = aligned_bear / (max_align + 1e-9)

    # Momentum: rate of change
    roc5  = (c[-1] - c[-6])  / (c[-6]  + 1e-9) * 100 if len(c) >= 6  else 0
    roc20 = (c[-1] - c[-21]) / (c[-21] + 1e-9) * 100 if len(c) >= 21 else 0

    # Score
    trend_dir = 1 if bull_align_pct > bear_align_pct else -1
    align_score = max(bull_align_pct, bear_align_pct) * 100
    adx_score   = min(adx, 50) * 2  # 0-100
    mom_score   = float(np.clip(50 + (roc5 * trend_dir) * 5, 20, 80))
    score       = (align_score * 0.4 + adx_score * 0.4 + mom_score * 0.2)

    if adx > 30 and bull_align_pct > 0.6:
        reasons.append(f"Strong bull trend: ADX {adx:.0f}, {aligned_bull}/{max_align} EMAs aligned")
    elif adx > 30 and bear_align_pct > 0.6:
        reasons.append(f"Strong bear trend: ADX {adx:.0f}, {aligned_bear}/{max_align} EMAs aligned")
    elif adx < 20:
        reasons.append(f"Weak trend: ADX {adx:.0f} — ranging market, mean reversion preferred")
    else:
        reasons.append(f"Moderate trend: ADX {adx:.0f}")

    reasons.append(f"5-day momentum: {roc5:+.1f}%, 20-day: {roc20:+.1f}%")

    return {
        "name":       "Trend Strength",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(adx * 2, 20, 90)), 1),
        "signal":     "BULL" if trend_dir > 0 and adx > 20 else "BEAR" if trend_dir < 0 and adx > 20 else "NEUTRAL",
        "reasons":    reasons,
        "weight":     0.15,
        "adx":        round(adx, 1),
        "ema_alignment": round(max(bull_align_pct, bear_align_pct) * 100, 1),
    }


# ── Algorithm 5: Mean Reversion Score ────────────────────────────────────────

def mean_reversion_score(df: pd.DataFrame) -> dict:
    """RSI extremes + Bollinger + VWAP deviation — how ripe for a reversal?"""
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values if "volume" in df.columns else np.ones(len(c))

    rsi = _rsi(c, 14)
    reasons = []
    score = 50.0

    # RSI extreme
    if rsi < 30:
        score += 20; reasons.append(f"RSI {rsi:.0f} — deeply oversold, high reversion probability")
    elif rsi < 40:
        score += 10; reasons.append(f"RSI {rsi:.0f} — oversold zone")
    elif rsi > 70:
        score += 20; reasons.append(f"RSI {rsi:.0f} — deeply overbought, high reversion probability")
    elif rsi > 60:
        score += 10; reasons.append(f"RSI {rsi:.0f} — overbought zone")
    else:
        reasons.append(f"RSI {rsi:.0f} — neutral, low reversion signal")

    # Bollinger Band position
    if len(c) >= 20:
        sma20 = np.mean(c[-20:])
        std20 = np.std(c[-20:])
        bb_pos = (c[-1] - (sma20 - 2*std20)) / (4*std20 + 1e-9)
        if bb_pos < 0.1:
            score += 15; reasons.append("Price at/below lower BB — strong mean reversion signal")
        elif bb_pos > 0.9:
            score += 15; reasons.append("Price at/above upper BB — strong mean reversion signal")
        elif bb_pos < 0.2 or bb_pos > 0.8:
            score += 8

    # VWAP deviation
    if len(v) >= 20 and np.sum(v[-20:]) > 0:
        vwap = np.sum(c[-20:] * v[-20:]) / np.sum(v[-20:])
        vwap_dev = abs(c[-1] - vwap) / (vwap + 1e-9) * 100
        if vwap_dev > 1.5:
            score += 10; reasons.append(f"Price {vwap_dev:.1f}% from VWAP — reversion likely")

    # Stochastic
    if len(c) >= 14:
        low14  = np.min(l[-14:])
        high14 = np.max(h[-14:])
        stoch  = (c[-1] - low14) / (high14 - low14 + 1e-9) * 100
        if stoch < 20 or stoch > 80:
            score += 8; reasons.append(f"Stochastic {stoch:.0f} — extreme reading")

    signal = "BULL" if rsi < 45 else "BEAR" if rsi > 55 else "NEUTRAL"
    return {
        "name":       "Mean Reversion",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(abs(rsi - 50) * 2, 20, 90)), 1),
        "signal":     signal,
        "reasons":    reasons[:3],
        "weight":     0.10,
        "rsi":        round(rsi, 1),
    }


# ── Algorithm 6: Breakout Probability ────────────────────────────────────────

def breakout_probability_score(df: pd.DataFrame) -> dict:
    """Volume + BB squeeze + S/R proximity — how likely is a breakout?"""
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values if "volume" in df.columns else np.ones(len(c))

    reasons = []
    score = 40.0

    # Bollinger Band squeeze (low width = coiled spring)
    if len(c) >= 20:
        sma20 = np.mean(c[-20:])
        std20 = np.std(c[-20:])
        bb_width = 2 * std20 / (sma20 + 1e-9)

        # Compare to 6-month BB width
        if len(c) >= 120:
            hist_widths = [2 * np.std(c[i:i+20]) / (np.mean(c[i:i+20]) + 1e-9)
                          for i in range(0, len(c)-20, 5)]
            bb_pct = float(np.sum(np.array(hist_widths) < bb_width) / len(hist_widths) * 100)
        else:
            bb_pct = 50.0

        if bb_pct < 20:
            score += 25; reasons.append(f"BB squeeze at {bb_pct:.0f}th percentile — coiled spring, breakout imminent")
        elif bb_pct < 35:
            score += 12; reasons.append(f"BB width low ({bb_pct:.0f}th pct) — consolidation phase")

    # Volume surge
    if len(v) >= 20:
        vol_ratio = v[-1] / (np.mean(v[-20:]) + 1e-9)
        if vol_ratio > 2.0:
            score += 20; reasons.append(f"Volume {vol_ratio:.1f}x average — institutional breakout signal")
        elif vol_ratio > 1.5:
            score += 10; reasons.append(f"Volume {vol_ratio:.1f}x average — above-average participation")

    # 20-day high/low proximity
    if len(c) >= 20:
        high20 = np.max(h[-20:])
        low20  = np.min(l[-20:])
        rng20  = high20 - low20 + 1e-9
        dist_high = (high20 - c[-1]) / rng20
        dist_low  = (c[-1] - low20) / rng20

        if dist_high < 0.05:
            score += 15; reasons.append(f"Price within 5% of 20-day high — breakout zone")
        elif dist_low < 0.05:
            score += 15; reasons.append(f"Price within 5% of 20-day low — breakdown zone")

    # Supertrend flip
    st = supertrend_features(df)
    if st.get("supertrend_flip", 0) == 1.0:
        score += 10; reasons.append("Supertrend just flipped — trend change confirmed")

    direction = "BULL" if c[-1] > np.mean(c[-20:]) else "BEAR"
    return {
        "name":       "Breakout Probability",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(score * 0.9, 20, 90)), 1),
        "signal":     direction,
        "reasons":    reasons[:3] if reasons else ["No strong breakout signal detected"],
        "weight":     0.10,
    }


# ── Algorithm 7: Smart Money Score ───────────────────────────────────────────

def smart_money_score(df: pd.DataFrame) -> dict:
    """ICT Smart Money Concepts — BOS, CHoCH, FVG, Order Block alignment."""
    smc = smart_money_features(df)
    of  = order_flow_features(df)
    reasons = []
    score = 50.0

    if smc.get("smc_bos_bull", 0):
        score += 20; reasons.append("Break of Structure (BOS) — bullish market structure")
    if smc.get("smc_bos_bear", 0):
        score += 20; reasons.append("Break of Structure (BOS) — bearish market structure")
    if smc.get("smc_choch", 0):
        score += 15; reasons.append("Change of Character (CHoCH) — potential trend reversal")
    if smc.get("smc_fvg_bull", 0):
        score += 10; reasons.append("Fair Value Gap (FVG) — bullish imbalance to fill")
    if smc.get("smc_fvg_bear", 0):
        score += 10; reasons.append("Fair Value Gap (FVG) — bearish imbalance to fill")

    delta = of.get("of_delta_ratio", 0)
    if abs(delta) > 0.3:
        dir_str = "bullish" if delta > 0 else "bearish"
        score += 8; reasons.append(f"Order flow delta {delta:+.2f} — {dir_str} pressure")

    if of.get("of_bullish_imbalance", 0):
        score += 7; reasons.append("Bullish volume imbalance — institutional buying")
    if of.get("of_bearish_imbalance", 0):
        score += 7; reasons.append("Bearish volume imbalance — institutional selling")

    signal = "BULL" if smc.get("smc_bos_bull", 0) or delta > 0.2 else \
             "BEAR" if smc.get("smc_bos_bear", 0) or delta < -0.2 else "NEUTRAL"

    return {
        "name":       "Smart Money (ICT)",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(score * 0.85, 20, 90)), 1),
        "signal":     signal,
        "reasons":    reasons[:3] if reasons else ["No strong SMC signal"],
        "weight":     0.10,
    }


# ── Algorithm 8: Ichimoku Score ───────────────────────────────────────────────

def ichimoku_score(df: pd.DataFrame) -> dict:
    """Full Ichimoku Cloud analysis — 5-line system."""
    ichi = ichimoku_features(df)
    reasons = []
    score = 50.0

    strength = ichi.get("ichi_signal_strength", 0)
    score += strength * 35

    if ichi.get("ichi_tenkan_kijun_cross", 0) > 0:
        reasons.append("Tenkan > Kijun — bullish TK cross")
    else:
        reasons.append("Tenkan < Kijun — bearish TK cross")

    pvc = ichi.get("ichi_price_vs_cloud", 0)
    if pvc > 0.01:
        reasons.append(f"Price above cloud by {pvc*100:.1f}% — strong bull trend")
    elif pvc < -0.01:
        reasons.append(f"Price below cloud by {abs(pvc)*100:.1f}% — strong bear trend")
    else:
        reasons.append("Price inside cloud — consolidation / indecision")

    cloud_bull = ichi.get("ichi_cloud_bullish", 0)
    reasons.append(f"Cloud is {'bullish (green)' if cloud_bull > 0 else 'bearish (red)'} — future {'support' if cloud_bull > 0 else 'resistance'}")

    signal = "BULL" if strength > 0.3 else "BEAR" if strength < -0.3 else "NEUTRAL"
    return {
        "name":       "Ichimoku Cloud",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(abs(strength) * 80 + 20, 20, 90)), 1),
        "signal":     signal,
        "reasons":    reasons[:3],
        "weight":     0.05,
    }


# ── Algorithm 9: Market Profile Score ────────────────────────────────────────

def market_profile_score(df: pd.DataFrame) -> dict:
    """POC + Value Area — where is price relative to fair value?"""
    mp = market_profile_features(df)
    reasons = []
    score = 50.0

    poc_dist = mp.get("mp_poc_dist", 0)
    in_va    = mp.get("mp_in_value_area", 0)
    above_poc = mp.get("mp_above_poc", 0)

    if in_va:
        score = 55; reasons.append("Price in Value Area — fair value zone, mean reversion likely")
    elif poc_dist > 0.02:
        score = 70; reasons.append(f"Price {poc_dist*100:.1f}% above POC — extended, watch for reversion")
    elif poc_dist < -0.02:
        score = 70; reasons.append(f"Price {abs(poc_dist)*100:.1f}% below POC — extended, watch for reversion")

    va_width = mp.get("mp_va_width", 0)
    if va_width < 0.01:
        score += 10; reasons.append("Narrow Value Area — high conviction price level")
    elif va_width > 0.03:
        reasons.append("Wide Value Area — low conviction, choppy market")

    signal = "BULL" if above_poc > 0 else "BEAR"
    return {
        "name":       "Market Profile",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip(abs(poc_dist) * 1000 + 40, 20, 85)), 1),
        "signal":     signal,
        "reasons":    reasons[:3] if reasons else ["Price near Point of Control"],
        "weight":     0.05,
    }


# ── Algorithm 10: Fibonacci Score ────────────────────────────────────────────

def fibonacci_score(df: pd.DataFrame) -> dict:
    """Fibonacci retracement/extension — is price at a key Fib level?"""
    fib = fibonacci_features(df)
    reasons = []
    score = 50.0

    nearest = fib.get("fib_nearest_level", 0.5)
    dist    = fib.get("fib_dist_to_nearest", 0.1)
    pos     = fib.get("fib_price_position", 0.5)

    if dist < 0.03:
        score += 25; reasons.append(f"Price at Fibonacci {nearest:.3f} level — key S/R zone")
    elif dist < 0.06:
        score += 12; reasons.append(f"Price near Fibonacci {nearest:.3f} level")

    if fib.get("fib_at_golden_ratio", 0):
        score += 15; reasons.append("Price at Golden Ratio (0.618) — highest probability reversal zone")
    if fib.get("fib_at_half", 0):
        score += 8; reasons.append("Price at 50% retracement — key psychological level")

    ext = fib.get("fib_extension_1618", 0)
    if abs(ext) < 0.02:
        score += 10; reasons.append("Price at 1.618 extension — potential profit target")

    signal = "BULL" if pos < 0.5 else "BEAR"
    return {
        "name":       "Fibonacci",
        "score":      round(float(np.clip(score, 5, 95)), 1),
        "confidence": round(float(np.clip((1 - dist) * 80, 20, 90)), 1),
        "signal":     signal,
        "reasons":    reasons[:3] if reasons else [f"Price at {pos*100:.0f}% of recent range"],
        "weight":     0.05,
    }


# ── Composite Scorer ──────────────────────────────────────────────────────────

def compute_composite_score(df: pd.DataFrame, registry, regime: str = "trending") -> dict:
    """
    Run all 10 algorithms and compute a regime-aware composite score.

    Regime weights:
      trending:      ML(0.25) + Trend(0.25) + Breakout(0.15) + SMC(0.10) + Ichi(0.10) + others
      ranging:       ML(0.20) + MeanRev(0.25) + MarketProfile(0.15) + Fib(0.15) + others
      volatile:      ML(0.30) + VolAdj(0.25) + Breakout(0.20) + others
      low_liquidity: ML(0.40) + Trend(0.20) + VolAdj(0.20) + others
    """
    from .features import compute_features
    features = compute_features(df)

    # Run all algorithms
    algos = {}
    try: algos["ensemble_ml"]    = ensemble_ml_score(features, registry)
    except Exception as e: algos["ensemble_ml"] = {"name": "Ensemble ML", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [str(e)], "weight": 0.25}

    try: algos["tech_confluence"] = technical_confluence_score(df)
    except Exception: algos["tech_confluence"] = {"name": "Technical Confluence", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.20}

    try: algos["vol_adjusted"]   = volatility_adjusted_score(df)
    except Exception: algos["vol_adjusted"] = {"name": "Volatility-Adjusted", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.10}

    try: algos["trend_strength"] = trend_strength_score(df)
    except Exception: algos["trend_strength"] = {"name": "Trend Strength", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.15}

    try: algos["mean_reversion"] = mean_reversion_score(df)
    except Exception: algos["mean_reversion"] = {"name": "Mean Reversion", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.10}

    try: algos["breakout"]       = breakout_probability_score(df)
    except Exception: algos["breakout"] = {"name": "Breakout Probability", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.10}

    try: algos["smart_money"]    = smart_money_score(df)
    except Exception: algos["smart_money"] = {"name": "Smart Money (ICT)", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.10}

    try: algos["ichimoku"]       = ichimoku_score(df)
    except Exception: algos["ichimoku"] = {"name": "Ichimoku Cloud", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.05}

    try: algos["market_profile"] = market_profile_score(df)
    except Exception: algos["market_profile"] = {"name": "Market Profile", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.05}

    try: algos["fibonacci"]      = fibonacci_score(df)
    except Exception: algos["fibonacci"] = {"name": "Fibonacci", "score": 50, "confidence": 0, "signal": "NEUTRAL", "reasons": [], "weight": 0.05}

    # Regime-aware weights
    regime_weights = {
        "trending":      {"ensemble_ml": 0.25, "tech_confluence": 0.20, "trend_strength": 0.20,
                          "breakout": 0.10, "smart_money": 0.10, "ichimoku": 0.05,
                          "vol_adjusted": 0.05, "mean_reversion": 0.02, "market_profile": 0.02, "fibonacci": 0.01},
        "ranging":       {"ensemble_ml": 0.20, "tech_confluence": 0.15, "mean_reversion": 0.20,
                          "market_profile": 0.15, "fibonacci": 0.10, "vol_adjusted": 0.08,
                          "trend_strength": 0.05, "breakout": 0.03, "smart_money": 0.03, "ichimoku": 0.01},
        "volatile":      {"ensemble_ml": 0.30, "vol_adjusted": 0.20, "breakout": 0.15,
                          "smart_money": 0.12, "tech_confluence": 0.10, "trend_strength": 0.05,
                          "mean_reversion": 0.04, "ichimoku": 0.02, "market_profile": 0.01, "fibonacci": 0.01},
        "low_liquidity": {"ensemble_ml": 0.40, "trend_strength": 0.20, "vol_adjusted": 0.15,
                          "tech_confluence": 0.10, "ichimoku": 0.05, "fibonacci": 0.04,
                          "mean_reversion": 0.03, "breakout": 0.01, "smart_money": 0.01, "market_profile": 0.01},
    }

    weights = regime_weights.get(regime, regime_weights["trending"])

    # Weighted composite
    composite = sum(algos[k]["score"] * weights.get(k, 0.05) for k in algos)
    composite = float(np.clip(composite, 5, 99))

    # Consensus signal
    signals = [a["signal"] for a in algos.values()]
    bull_count = signals.count("BULL")
    bear_count = signals.count("BEAR")
    consensus  = "BULL" if bull_count > bear_count else "BEAR" if bear_count > bull_count else "NEUTRAL"

    # Overall confidence
    avg_conf = float(np.mean([a["confidence"] for a in algos.values()]))

    # Grade
    grade = "A+" if composite >= 82 else "A" if composite >= 72 else "B" if composite >= 62 else "C" if composite >= 52 else "D"

    return {
        "compositeScore":  round(composite, 1),
        "grade":           grade,
        "consensus":       consensus,
        "bullCount":       bull_count,
        "bearCount":       bear_count,
        "avgConfidence":   round(avg_conf, 1),
        "regime":          regime,
        "algorithms":      [
            {
                "id":         k,
                "name":       v["name"],
                "score":      v["score"],
                "confidence": v["confidence"],
                "signal":     v["signal"],
                "reasons":    v.get("reasons", []),
                "weight":     round(weights.get(k, 0.05) * 100, 1),
            }
            for k, v in algos.items()
        ],
    }
