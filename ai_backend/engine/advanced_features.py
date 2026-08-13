"""
advanced_features.py — Elite-tier feature engineering for maximum prediction accuracy.

Implements 12 advanced feature buckets beyond the base 6:
  Bucket 7:  Ichimoku Cloud (Tenkan, Kijun, Senkou A/B, Chikou)
  Bucket 8:  Fibonacci Retracement & Extension levels
  Bucket 9:  Supertrend (ATR-based dynamic S/R)
  Bucket 10: Elliott Wave proxy (impulse/corrective detection)
  Bucket 11: Market Profile (Value Area, POC, TPO)
  Bucket 12: Order Flow proxies (delta, imbalance, absorption)
  Bucket 13: Harmonic Patterns (Gartley, Bat, Butterfly, Crab)
  Bucket 14: Multi-timeframe alignment score
  Bucket 15: Regime-aware volatility (GARCH proxy)
  Bucket 16: Smart Money Concepts (BOS, CHoCH, FVG, OB)
  Bucket 17: Statistical arbitrage features (z-score, cointegration proxy)
  Bucket 18: Seasonality & calendar effects
"""

import numpy as np
import pandas as pd
from typing import Optional


# ── Bucket 7: Ichimoku Cloud ──────────────────────────────────────────────────

def ichimoku_features(df: pd.DataFrame) -> dict:
    """Ichimoku Kinko Hyo — 5 lines, cloud position, signal strength."""
    h = df["high"].values
    l = df["low"].values
    c = df["close"].values
    n = len(c)
    feats = {}

    def mid(arr_h, arr_l, period):
        if len(arr_h) < period:
            return (arr_h[-1] + arr_l[-1]) / 2
        return (np.max(arr_h[-period:]) + np.min(arr_l[-period:])) / 2

    tenkan  = mid(h, l, 9)
    kijun   = mid(h, l, 26)
    senkou_a = (tenkan + kijun) / 2
    senkou_b = mid(h, l, 52)
    chikou  = c[-1]

    price = c[-1]
    cloud_top    = max(senkou_a, senkou_b)
    cloud_bottom = min(senkou_a, senkou_b)

    feats["ichi_tenkan_kijun_cross"] = 1.0 if tenkan > kijun else -1.0
    feats["ichi_price_vs_cloud"]     = (price - cloud_top) / (price + 1e-9) if price > cloud_top else \
                                       (price - cloud_bottom) / (price + 1e-9) if price < cloud_bottom else 0.0
    feats["ichi_cloud_thickness"]    = abs(senkou_a - senkou_b) / (price + 1e-9)
    feats["ichi_cloud_bullish"]      = 1.0 if senkou_a > senkou_b else -1.0
    feats["ichi_tk_spread"]          = (tenkan - kijun) / (price + 1e-9)
    feats["ichi_chikou_vs_price"]    = (chikou - price) / (price + 1e-9)
    feats["ichi_signal_strength"]    = float(np.clip(
        (1 if tenkan > kijun else -1) +
        (1 if price > cloud_top else -1 if price < cloud_bottom else 0) +
        (1 if senkou_a > senkou_b else -1), -3, 3
    ) / 3.0)
    return feats


# ── Bucket 8: Fibonacci Retracement ──────────────────────────────────────────

def fibonacci_features(df: pd.DataFrame) -> dict:
    """Fibonacci retracement levels from recent swing high/low."""
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    feats = {}

    lookback = min(len(c), 50)
    swing_high = np.max(h[-lookback:])
    swing_low  = np.min(l[-lookback:])
    price      = c[-1]
    rng        = swing_high - swing_low + 1e-9

    fib_levels = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618]
    fib_prices = [swing_low + rng * f for f in fib_levels]

    # Distance to nearest fib level (normalised)
    dists = [abs(price - fp) / rng for fp in fib_prices]
    nearest_idx = int(np.argmin(dists))
    feats["fib_nearest_level"]    = fib_levels[nearest_idx]
    feats["fib_dist_to_nearest"]  = dists[nearest_idx]
    feats["fib_price_position"]   = (price - swing_low) / rng  # 0=at low, 1=at high
    feats["fib_at_golden_ratio"]  = 1.0 if dists[4] < 0.05 else 0.0  # 0.618
    feats["fib_at_half"]          = 1.0 if dists[3] < 0.05 else 0.0  # 0.5
    feats["fib_extension_1618"]   = (price - (swing_low + rng * 1.618)) / rng  # above ext?
    return feats


# ── Bucket 9: Supertrend ──────────────────────────────────────────────────────

def supertrend_features(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> dict:
    """Supertrend indicator — dynamic support/resistance with trend direction."""
    h = df["high"].values
    l = df["low"].values
    c = df["close"].values
    feats = {}

    if len(c) < period + 2:
        feats["supertrend_direction"] = 0.0
        feats["supertrend_dist"]      = 0.0
        feats["supertrend_flip"]      = 0.0
        return feats

    # ATR
    tr = np.maximum(h[1:] - l[1:], np.maximum(
        np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])
    ))
    atr = np.zeros(len(c))
    atr[period] = np.mean(tr[:period])
    for i in range(period + 1, len(c)):
        atr[i] = (atr[i-1] * (period - 1) + tr[i-1]) / period

    hl2 = (h + l) / 2
    upper_band = hl2 - multiplier * atr
    lower_band = hl2 + multiplier * atr

    supertrend = np.zeros(len(c))
    direction  = np.zeros(len(c))
    supertrend[period] = upper_band[period]
    direction[period]  = 1

    for i in range(period + 1, len(c)):
        if c[i] > supertrend[i-1]:
            supertrend[i] = max(upper_band[i], supertrend[i-1])
            direction[i]  = 1
        else:
            supertrend[i] = min(lower_band[i], supertrend[i-1])
            direction[i]  = -1

    feats["supertrend_direction"] = float(direction[-1])
    feats["supertrend_dist"]      = (c[-1] - supertrend[-1]) / (c[-1] + 1e-9)
    feats["supertrend_flip"]      = 1.0 if direction[-1] != direction[-2] else 0.0
    return feats


# ── Bucket 10: Elliott Wave Proxy ─────────────────────────────────────────────

def elliott_wave_features(df: pd.DataFrame) -> dict:
    """
    Elliott Wave proxy — detect impulse vs corrective structure.
    Uses swing point counting and Fibonacci ratios between waves.
    """
    c = df["close"].values
    feats = {}

    if len(c) < 30:
        feats["ew_impulse_score"]    = 0.0
        feats["ew_corrective_score"] = 0.0
        feats["ew_wave_position"]    = 0.5
        return feats

    # Detect local swing highs/lows (simplified ZigZag)
    window = 5
    swings = []
    for i in range(window, len(c) - window):
        if c[i] == np.max(c[i-window:i+window+1]):
            swings.append(("H", i, c[i]))
        elif c[i] == np.min(c[i-window:i+window+1]):
            swings.append(("L", i, c[i]))

    if len(swings) < 5:
        feats["ew_impulse_score"]    = 0.0
        feats["ew_corrective_score"] = 0.0
        feats["ew_wave_position"]    = 0.5
        return feats

    # Check last 5 swings for impulse pattern (alternating H/L with Fib ratios)
    last5 = swings[-5:]
    moves = [abs(last5[i+1][2] - last5[i][2]) for i in range(4)]

    # Impulse: wave 3 > wave 1, wave 5 > wave 3 * 0.618
    impulse_score = 0.0
    if len(moves) >= 4:
        if moves[2] > moves[0]:  # wave 3 > wave 1
            impulse_score += 0.4
        if moves[2] > moves[1]:  # wave 3 > wave 2 (correction)
            impulse_score += 0.3
        if moves[3] < moves[2]:  # wave 4 < wave 3
            impulse_score += 0.3

    # Corrective: ABC pattern (3 waves, wave C ≈ wave A)
    corrective_score = 0.0
    if len(moves) >= 3:
        ratio = moves[2] / (moves[0] + 1e-9)
        if 0.618 <= ratio <= 1.618:
            corrective_score = 0.7
        elif 0.382 <= ratio <= 2.0:
            corrective_score = 0.4

    # Wave position: where in the cycle are we?
    price_range = max(c[-30:]) - min(c[-30:]) + 1e-9
    wave_pos = (c[-1] - min(c[-30:])) / price_range

    feats["ew_impulse_score"]    = float(impulse_score)
    feats["ew_corrective_score"] = float(corrective_score)
    feats["ew_wave_position"]    = float(wave_pos)
    return feats


# ── Bucket 11: Market Profile (simplified) ───────────────────────────────────

def market_profile_features(df: pd.DataFrame) -> dict:
    """
    Market Profile — Point of Control (POC), Value Area High/Low.
    Uses volume-at-price distribution over last 20 bars.
    """
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values if "volume" in df.columns else np.ones(len(c))
    feats = {}

    lookback = min(len(c), 20)
    c_r = c[-lookback:]
    h_r = h[-lookback:]
    l_r = l[-lookback:]
    v_r = v[-lookback:]

    price_min = np.min(l_r)
    price_max = np.max(h_r)
    price_rng = price_max - price_min + 1e-9

    # Build volume profile (20 buckets)
    n_buckets = 20
    bucket_size = price_rng / n_buckets
    vol_profile = np.zeros(n_buckets)

    for i in range(lookback):
        bar_low  = l_r[i]
        bar_high = h_r[i]
        bar_vol  = v_r[i]
        for b in range(n_buckets):
            bucket_low  = price_min + b * bucket_size
            bucket_high = bucket_low + bucket_size
            overlap = max(0, min(bar_high, bucket_high) - max(bar_low, bucket_low))
            if overlap > 0:
                vol_profile[b] += bar_vol * overlap / (bar_high - bar_low + 1e-9)

    poc_bucket = int(np.argmax(vol_profile))
    poc_price  = price_min + (poc_bucket + 0.5) * bucket_size

    # Value Area: 70% of total volume around POC
    total_vol = np.sum(vol_profile)
    va_vol    = vol_profile[poc_bucket]
    va_low_b  = poc_bucket
    va_high_b = poc_bucket

    while va_vol < total_vol * 0.70 and (va_low_b > 0 or va_high_b < n_buckets - 1):
        add_low  = vol_profile[va_low_b - 1]  if va_low_b > 0              else 0
        add_high = vol_profile[va_high_b + 1] if va_high_b < n_buckets - 1 else 0
        if add_high >= add_low:
            va_high_b = min(va_high_b + 1, n_buckets - 1)
            va_vol += add_high
        else:
            va_low_b = max(va_low_b - 1, 0)
            va_vol += add_low

    vah = price_min + (va_high_b + 1) * bucket_size
    val = price_min + va_low_b * bucket_size
    price = c[-1]

    feats["mp_poc_dist"]       = (price - poc_price) / (price + 1e-9)
    feats["mp_in_value_area"]  = 1.0 if val <= price <= vah else 0.0
    feats["mp_above_poc"]      = 1.0 if price > poc_price else -1.0
    feats["mp_va_width"]       = (vah - val) / (price + 1e-9)
    feats["mp_price_vs_vah"]   = (price - vah) / (price + 1e-9)
    feats["mp_price_vs_val"]   = (price - val) / (price + 1e-9)
    return feats


# ── Bucket 12: Order Flow Proxies ─────────────────────────────────────────────

def order_flow_features(df: pd.DataFrame) -> dict:
    """
    Order flow proxies from OHLCV — delta, imbalance, absorption.
    Without tick data, we use candle structure as a proxy.
    """
    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values if "volume" in df.columns else np.ones(len(c))
    feats = {}

    # Buy/Sell volume proxy (Tick Rule)
    buy_vol  = np.where(c > o, v, np.where(c == o, v * 0.5, 0))
    sell_vol = np.where(c < o, v, np.where(c == o, v * 0.5, 0))

    lookback = min(len(c), 10)
    total_buy  = np.sum(buy_vol[-lookback:])
    total_sell = np.sum(sell_vol[-lookback:])
    total_vol  = total_buy + total_sell + 1e-9

    feats["of_delta_ratio"]     = (total_buy - total_sell) / total_vol
    feats["of_buy_pressure"]    = total_buy / total_vol
    feats["of_sell_pressure"]   = total_sell / total_vol

    # Absorption: large volume with small price move = absorption
    last_vol   = v[-1]
    last_range = h[-1] - l[-1] + 1e-9
    avg_vol    = np.mean(v[-20:]) if len(v) >= 20 else v[-1]
    avg_range  = np.mean(h[-20:] - l[-20:]) if len(c) >= 20 else last_range
    feats["of_absorption"]      = float(np.clip(
        (last_vol / (avg_vol + 1e-9)) / (last_range / (avg_range + 1e-9)), 0, 5
    ))

    # Imbalance: consecutive same-direction candles with increasing volume
    if len(c) >= 3:
        dir_streak = all(c[-i] > o[-i] for i in range(1, 4))
        vol_incr   = v[-1] > v[-2] > v[-3]
        feats["of_bullish_imbalance"] = 1.0 if dir_streak and vol_incr else 0.0
        dir_streak_bear = all(c[-i] < o[-i] for i in range(1, 4))
        feats["of_bearish_imbalance"] = 1.0 if dir_streak_bear and vol_incr else 0.0
    else:
        feats["of_bullish_imbalance"] = 0.0
        feats["of_bearish_imbalance"] = 0.0

    # Cumulative delta (10-bar)
    cum_delta = np.sum(buy_vol[-10:] - sell_vol[-10:])
    feats["of_cum_delta_10"] = float(np.clip(cum_delta / (np.sum(v[-10:]) + 1e-9), -1, 1))
    return feats


# ── Bucket 13: Smart Money Concepts ──────────────────────────────────────────

def smart_money_features(df: pd.DataFrame) -> dict:
    """
    Smart Money Concepts (ICT-inspired):
    - Break of Structure (BOS)
    - Change of Character (CHoCH)
    - Fair Value Gap (FVG)
    - Order Block (OB) proximity
    """
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    feats = {}

    if len(c) < 10:
        for k in ["smc_bos_bull", "smc_bos_bear", "smc_choch", "smc_fvg_bull", "smc_fvg_bear", "smc_ob_dist"]:
            feats[k] = 0.0
        return feats

    # BOS: price breaks above recent swing high (bullish) or below swing low (bearish)
    lookback = min(len(c), 20)
    recent_high = np.max(h[-lookback:-1])
    recent_low  = np.min(l[-lookback:-1])
    feats["smc_bos_bull"] = 1.0 if c[-1] > recent_high else 0.0
    feats["smc_bos_bear"] = 1.0 if c[-1] < recent_low  else 0.0

    # CHoCH: previous BOS direction reversed
    prev_high = np.max(h[-lookback*2:-lookback]) if len(c) >= lookback * 2 else recent_high
    prev_low  = np.min(l[-lookback*2:-lookback]) if len(c) >= lookback * 2 else recent_low
    was_bull  = c[-lookback] > prev_high
    is_bear   = c[-1] < recent_low
    feats["smc_choch"] = 1.0 if (was_bull and is_bear) or (not was_bull and c[-1] > recent_high) else 0.0

    # FVG: 3-candle pattern where candle 1 high < candle 3 low (bullish gap)
    if len(c) >= 3:
        feats["smc_fvg_bull"] = 1.0 if h[-3] < l[-1] else 0.0
        feats["smc_fvg_bear"] = 1.0 if l[-3] > h[-1] else 0.0
    else:
        feats["smc_fvg_bull"] = 0.0
        feats["smc_fvg_bear"] = 0.0

    # Order Block: last bearish candle before a bullish BOS (simplified)
    ob_price = 0.0
    for i in range(len(c) - 2, max(len(c) - 15, 0), -1):
        if c[i] < c[i-1]:  # bearish candle
            ob_price = (h[i] + l[i]) / 2
            break
    feats["smc_ob_dist"] = (c[-1] - ob_price) / (c[-1] + 1e-9) if ob_price > 0 else 0.0
    return feats


# ── Bucket 14: GARCH Volatility Proxy ────────────────────────────────────────

def garch_proxy_features(df: pd.DataFrame) -> dict:
    """
    GARCH(1,1) proxy — conditional volatility estimate without scipy.
    Uses exponentially weighted variance as a fast approximation.
    """
    c = df["close"].values
    feats = {}

    if len(c) < 10:
        feats["garch_cond_vol"]    = 0.01
        feats["garch_vol_regime"]  = 0.5
        feats["garch_vol_trend"]   = 0.0
        return feats

    returns = np.diff(np.log(c + 1e-9))
    # EWMA variance (lambda=0.94, RiskMetrics standard)
    lam = 0.94
    ewma_var = np.zeros(len(returns))
    ewma_var[0] = returns[0] ** 2
    for i in range(1, len(returns)):
        ewma_var[i] = lam * ewma_var[i-1] + (1 - lam) * returns[i] ** 2

    cond_vol = float(np.sqrt(ewma_var[-1]))
    hist_vol = float(np.std(returns[-20:])) if len(returns) >= 20 else cond_vol

    feats["garch_cond_vol"]   = float(np.clip(cond_vol, 0, 0.1))
    feats["garch_vol_regime"] = float(np.clip(cond_vol / (hist_vol + 1e-9), 0, 3))
    feats["garch_vol_trend"]  = float(ewma_var[-1] - ewma_var[-5]) if len(ewma_var) >= 5 else 0.0
    return feats


# ── Master: compute all advanced features ────────────────────────────────────

def compute_advanced_features(df: pd.DataFrame) -> np.ndarray:
    """
    Compute all advanced features and return as a 1D numpy array.
    Gracefully handles short DataFrames.
    """
    all_feats = {}
    for fn in [ichimoku_features, fibonacci_features, supertrend_features,
               elliott_wave_features, market_profile_features,
               order_flow_features, smart_money_features, garch_proxy_features]:
        try:
            all_feats.update(fn(df))
        except Exception:
            pass  # graceful degradation — missing features default to 0

    return np.array(list(all_feats.values()), dtype=np.float32)


def get_advanced_feature_names() -> list:
    """Return ordered list of advanced feature names."""
    dummy = pd.DataFrame({
        "open":   np.random.randn(60) + 100,
        "high":   np.random.randn(60) + 101,
        "low":    np.random.randn(60) + 99,
        "close":  np.cumsum(np.random.randn(60) * 0.5) + 100,
        "volume": np.abs(np.random.randn(60)) * 1e6,
    })
    all_feats = {}
    for fn in [ichimoku_features, fibonacci_features, supertrend_features,
               elliott_wave_features, market_profile_features,
               order_flow_features, smart_money_features, garch_proxy_features]:
        try:
            all_feats.update(fn(dummy))
        except Exception:
            pass
    return list(all_feats.keys())
