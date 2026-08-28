"""
features.py — Feature engineering pipeline.

Implements the 6 feature buckets from the spec (Section 10.6):
  Bucket 1: Price Action
  Bucket 2: Volatility
  Bucket 3: Trend & Momentum
  Bucket 4: Volume
  Bucket 5: Market Context
  Bucket 6: Time-Based

Input:  pandas DataFrame with OHLCV columns
Output: numpy array of ~80-120 features (after selection)
"""

import numpy as np
import pandas as pd

try:
    import ta
    TA_AVAILABLE = True
except ImportError:
    TA_AVAILABLE = False


def compute_features(df: pd.DataFrame) -> np.ndarray:
    """
    Feature vector for the LAST row of `df`, as a 1D float32 array.

    Thin wrapper over `compute_features_dict` — the dict is the single source of truth
    for both the values and their order, so the vector and `get_feature_names()` cannot
    drift apart. See `get_feature_names` for what that used to cost.
    """
    return np.array(list(compute_features_dict(df).values()), dtype=np.float32)


def compute_features_dict(df: pd.DataFrame) -> dict:
    """
    Compute all features for a single instrument, keyed by name.

    Args:
        df: DataFrame with columns [open, high, low, close, volume] and optionally
            `date`, sorted oldest → newest, at least 200 rows recommended.

    Returns:
        Ordered dict of feature name → float, for the LAST row (current bar).
    """
    if len(df) < 20:
        raise ValueError(f"Need at least 20 bars, got {len(df)}")

    feats = {}

    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values if "volume" in df.columns else np.ones(len(c))

    # ── Bucket 1: Price Action ────────────────────────────────────────────────
    feats["log_return_1"]  = np.log(c[-1] / c[-2]) if c[-2] > 0 else 0
    feats["log_return_5"]  = np.log(c[-1] / c[-6]) if len(c) >= 6 and c[-6] > 0 else 0
    feats["log_return_20"] = np.log(c[-1] / c[-21]) if len(c) >= 21 and c[-21] > 0 else 0
    feats["candle_body"]   = (c[-1] - o[-1]) / (h[-1] - l[-1] + 1e-9)
    feats["upper_wick"]    = (h[-1] - max(c[-1], o[-1])) / (h[-1] - l[-1] + 1e-9)
    feats["lower_wick"]    = (min(c[-1], o[-1]) - l[-1]) / (h[-1] - l[-1] + 1e-9)
    feats["gap"]           = (o[-1] - c[-2]) / (c[-2] + 1e-9) if len(c) >= 2 else 0

    # Consecutive direction (streak)
    streak = 0
    for i in range(len(c) - 1, max(len(c) - 11, 0), -1):
        if i == 0:
            break
        if (c[i] > c[i-1]) == (c[-1] > c[-2]):
            streak += 1
        else:
            break
    feats["direction_streak"] = streak * (1 if c[-1] > c[-2] else -1)

    # ── Bucket 2: Volatility ──────────────────────────────────────────────────
    # ATR(14)
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr14 = np.mean(tr[-14:]) if len(tr) >= 14 else np.mean(tr)
    feats["atr14_pct"]  = atr14 / (c[-1] + 1e-9)
    feats["atr5_pct"]   = np.mean(tr[-5:]) / (c[-1] + 1e-9) if len(tr) >= 5 else feats["atr14_pct"]

    # Parkinson volatility (high-low range estimator)
    hl_ratio = np.log(h[-20:] / (l[-20:] + 1e-9)) if len(c) >= 20 else np.log(h / (l + 1e-9))
    feats["parkinson_vol"] = np.sqrt(np.mean(hl_ratio ** 2) / (4 * np.log(2)))

    # Bollinger Band width
    if len(c) >= 20:
        sma20 = np.mean(c[-20:])
        std20 = np.std(c[-20:])
        feats["bb_width"]    = (2 * std20) / (sma20 + 1e-9)
        feats["bb_position"] = (c[-1] - (sma20 - 2 * std20)) / (4 * std20 + 1e-9)
    else:
        feats["bb_width"]    = 0
        feats["bb_position"] = 0.5

    # ── Bucket 3: Trend & Momentum ────────────────────────────────────────────
    for period in [5, 10, 20, 50, 200]:
        if len(c) >= period:
            ema = _ema(c, period)
            feats[f"ema{period}_slope"] = (ema[-1] - ema[-2]) / (ema[-2] + 1e-9) if len(ema) >= 2 else 0
            feats[f"price_vs_ema{period}"] = (c[-1] - ema[-1]) / (ema[-1] + 1e-9)
        else:
            feats[f"ema{period}_slope"]    = 0
            feats[f"price_vs_ema{period}"] = 0

    # RSI(14)
    feats["rsi14"] = _rsi(c, 14) / 100.0  # normalised 0-1

    # MACD histogram
    if len(c) >= 26:
        ema12 = _ema(c, 12)
        ema26 = _ema(c, 26)
        macd  = ema12[-1] - ema26[-1]
        signal = _ema(np.array([ema12[i] - ema26[i] for i in range(len(ema26))]), 9)[-1]
        feats["macd_hist"]     = (macd - signal) / (c[-1] + 1e-9)
        feats["macd_hist_vel"] = feats["macd_hist"] - ((ema12[-2] - ema26[-2]) - signal) / (c[-2] + 1e-9) if len(c) >= 27 else 0
    else:
        feats["macd_hist"]     = 0
        feats["macd_hist_vel"] = 0

    # ADX(14)
    feats["adx14"] = _adx(h, l, c, 14) / 100.0

    # ── Bucket 4: Volume ──────────────────────────────────────────────────────
    if len(v) >= 20 and v[-1] > 0:
        vol_sma20 = np.mean(v[-20:])
        feats["volume_ratio"]   = v[-1] / (vol_sma20 + 1e-9)
        feats["volume_climax"]  = 1.0 if v[-1] > vol_sma20 * 2 else 0.0
        # OBV slope (5-bar)
        obv = np.cumsum(np.where(np.diff(c, prepend=c[0]) > 0, v, -v))
        feats["obv_slope5"] = (obv[-1] - obv[-6]) / (np.abs(obv[-6]) + 1e-9) if len(obv) >= 6 else 0
        # VWAP deviation
        vwap = np.sum(c[-20:] * v[-20:]) / (np.sum(v[-20:]) + 1e-9)
        feats["vwap_dev"] = (c[-1] - vwap) / (vwap + 1e-9)
    else:
        feats["volume_ratio"]  = 1.0
        feats["volume_climax"] = 0.0
        feats["obv_slope5"]    = 0.0
        feats["vwap_dev"]      = 0.0

    # ── Bucket 5: Market Context ──────────────────────────────────────────────
    # Regime detection proxies
    if len(c) >= 50:
        ema50 = _ema(c, 50)
        ema20 = _ema(c, 20)
        # Trend strength: how far price is from long-term EMA
        feats["trend_strength"]  = (c[-1] - ema50[-1]) / (ema50[-1] + 1e-9)
        # EMA crossover signal
        feats["ema_cross_20_50"] = 1.0 if ema20[-1] > ema50[-1] else -1.0
        # Price compression (low volatility = potential breakout)
        feats["price_compression"] = 1.0 if feats["bb_width"] < 0.02 else 0.0
    else:
        feats["trend_strength"]    = 0.0
        feats["ema_cross_20_50"]   = 0.0
        feats["price_compression"] = 0.0

    # Stochastic oscillator %K
    if len(c) >= 14:
        low14  = np.min(l[-14:])
        high14 = np.max(h[-14:])
        feats["stoch_k"] = (c[-1] - low14) / (high14 - low14 + 1e-9)
    else:
        feats["stoch_k"] = 0.5

    # Williams %R
    if len(c) >= 14:
        feats["williams_r"] = (high14 - c[-1]) / (high14 - low14 + 1e-9)
    else:
        feats["williams_r"] = 0.5

    # CCI (Commodity Channel Index)
    if len(c) >= 20:
        typical = (h[-20:] + l[-20:] + c[-20:]) / 3
        cci_mean = np.mean(typical)
        cci_mad  = np.mean(np.abs(typical - cci_mean))
        feats["cci20"] = (typical[-1] - cci_mean) / (0.015 * cci_mad + 1e-9) / 100  # normalised
    else:
        feats["cci20"] = 0.0

    # Price vs 52-week high/low
    if len(c) >= 252:
        feats["pct_from_52w_high"] = (c[-1] - np.max(c[-252:])) / (np.max(c[-252:]) + 1e-9)
        feats["pct_from_52w_low"]  = (c[-1] - np.min(c[-252:])) / (np.min(c[-252:]) + 1e-9)
    else:
        feats["pct_from_52w_high"] = 0.0
        feats["pct_from_52w_low"]  = 0.0
    # ── Bucket 6: Time of the BAR, not of the wall clock ──────────────────────
    # These used `datetime.datetime.now()`, which describes when the request was made
    # rather than when the bar occurred. Harmless while nothing is trained, and fatal
    # the moment anyone fits on history: every historical row would carry today's
    # timestamp, so the model would learn "what time is it now" — a feature that is
    # constant within a training run and unavailable at inference. See Section 64.
    ts = _bar_timestamp(df)
    feats["hour_sin"]    = np.sin(2 * np.pi * ts.hour / 24)
    feats["hour_cos"]    = np.cos(2 * np.pi * ts.hour / 24)
    feats["dow_sin"]     = np.sin(2 * np.pi * ts.weekday() / 5)
    feats["dow_cos"]     = np.cos(2 * np.pi * ts.weekday() / 5)
    feats["month_sin"]   = np.sin(2 * np.pi * ts.month / 12)
    feats["month_cos"]   = np.cos(2 * np.pi * ts.month / 12)

    # ── Bucket 6 Extension: Entropy & Fractality ──────────────────────────────
    # Hurst exponent proxy — >0.5 = trending, <0.5 = mean-reverting
    feats["hurst_exp"]       = _hurst_proxy(c)
    # Approximate entropy of returns — low = predictable, high = chaotic
    feats["return_entropy"]  = _approx_entropy(np.diff(np.log(c[-20:] + 1e-9)))
    # Fractal dimension proxy (Higuchi method, simplified)
    feats["fractal_dim"]     = _fractal_dim_proxy(c[-30:] if len(c) >= 30 else c)
    # Log-return skewness (20-bar)
    rets20 = np.diff(np.log(c[-21:] + 1e-9)) if len(c) >= 21 else np.zeros(1)
    feats["return_skew20"]   = float(np.mean((rets20 - np.mean(rets20))**3) / (np.std(rets20)**3 + 1e-9))
    # Log-return kurtosis (20-bar)
    feats["return_kurt20"]   = float(np.mean((rets20 - np.mean(rets20))**4) / (np.std(rets20)**4 + 1e-9)) - 3.0

    # ── Bucket 7: Cross-timeframe momentum alignment ──────────────────────────
    def mom(n): return (c[-1] - c[-n]) / (c[-n] + 1e-9) if len(c) >= n else 0.0
    feats["mom_3"]  = mom(3)
    feats["mom_5"]  = mom(5)
    feats["mom_10"] = mom(10)
    feats["mom_20"] = mom(20)
    feats["mom_60"] = mom(60) if len(c) >= 60 else 0.0
    # Momentum alignment score — are short and long-term momenta in the same direction?
    moms = [feats["mom_3"], feats["mom_5"], feats["mom_10"], feats["mom_20"]]
    feats["mom_alignment"] = float(np.sign(np.mean(moms)) * np.mean(np.abs(moms)))

    # ── Bucket 8: Microstructure proxies ─────────────────────────────────────
    # High-Low efficiency ratio (how directional is each bar)
    if len(c) >= 10:
        net_move  = abs(c[-1] - c[-10])
        path_len  = np.sum(np.abs(np.diff(c[-10:])))
        feats["efficiency_ratio_10"] = float(net_move / (path_len + 1e-9))
    else:
        feats["efficiency_ratio_10"] = 0.5
    # Spread proxy: (high - low) / close
    feats["spread_proxy"]  = (h[-1] - l[-1]) / (c[-1] + 1e-9)
    # Close position in bar (0=low, 1=high) — buying pressure
    feats["close_in_bar"]  = (c[-1] - l[-1]) / (h[-1] - l[-1] + 1e-9)

    # Coerce to plain floats so callers get a uniform mapping regardless of numpy
    # scalar types leaking through from the indicator helpers.
    return {k: float(v) for k, v in feats.items()}


def compute_full_features_dict(df: pd.DataFrame) -> dict:
    """
    Base features plus the advanced set (Ichimoku, Fibonacci, Supertrend, market
    profile, order-flow proxies, ICT levels, GARCH proxy), keyed by name.

    The advanced buckets were computed by `/strategy/score` but never reached
    `/predict`, because `compute_full_features` — the only thing that joined them —
    had no callers. Now the joined mapping is what the ensemble sees.
    """
    base = compute_features_dict(df)
    try:
        from .advanced_features import compute_advanced_features, get_advanced_feature_names
        adv_vals  = compute_advanced_features(df)
        adv_names = get_advanced_feature_names()
        if len(adv_names) == len(adv_vals):
            base.update({n: float(v) for n, v in zip(adv_names, adv_vals)})
        else:
            # Names and values disagree — attach positionally rather than mislabel.
            base.update({f"adv_{i}": float(v) for i, v in enumerate(adv_vals)})
    except Exception:
        pass
    return base


def compute_full_features(df: pd.DataFrame) -> np.ndarray:
    """Base + advanced features as a single float32 vector."""
    return np.array(list(compute_full_features_dict(df).values()), dtype=np.float32)


def _bar_timestamp(df: pd.DataFrame):
    """
    Timestamp of the last bar, falling back to now when the frame carries no dates.

    The fallback is honest rather than silent: without a `date` column there is no bar
    time to use, and `mock_ohlcv` produces none. Real OHLCV from any provider does.
    """
    import datetime
    if "date" in df.columns:
        try:
            ts = pd.to_datetime(df["date"].iloc[-1])
            if not pd.isna(ts):
                return ts
        except Exception:
            pass
    return datetime.datetime.now()


def _canonical_frame(n: int = 260) -> pd.DataFrame:
    """A deterministic synthetic frame, used only to enumerate feature names."""
    rng    = np.random.default_rng(7)
    closes = 100 + np.cumsum(rng.normal(0, 0.5, n))
    opens  = np.concatenate([[100.0], closes[:-1]])
    highs  = np.maximum(opens, closes) + np.abs(rng.normal(0, 0.4, n))
    lows   = np.minimum(opens, closes) - np.abs(rng.normal(0, 0.4, n))
    return pd.DataFrame({
        "date":   pd.date_range("2020-01-01", periods=n, freq="D"),
        "open":   opens,  "high": highs, "low": lows,
        "close":  closes, "volume": np.abs(rng.normal(1e6, 2e5, n)),
    })


_FEATURE_NAMES = None
_FULL_FEATURE_NAMES = None


def get_feature_names() -> list[str]:
    """
    Ordered feature names, **derived from the same builder that produces the vector**.

    WHAT WAS WRONG (spec Section 64). This was a hand-maintained literal returning **37
    names for a 59-value vector**, and it diverged from the real order after index 30 —
    jumping from `vwap_dev` straight to `hour_sin` and skipping `trend_strength`
    onward. `registry._generate_reasons` does `dict(zip(names, features))`, so every
    reason keyed above index 30 was reading an unrelated feature's value, and
    `hurst_exp` was missing from the list entirely, so its branch could never fire.

    Deriving the names from `compute_features_dict` removes the whole class of defect:
    the names and the values come from one dict, so they cannot disagree. Computed once
    and cached — the synthetic frame is deterministic, so the order is stable.
    """
    global _FEATURE_NAMES
    if _FEATURE_NAMES is None:
        _FEATURE_NAMES = list(compute_features_dict(_canonical_frame()).keys())
    return list(_FEATURE_NAMES)


def get_full_feature_names() -> list[str]:
    """Ordered names for the base + advanced vector."""
    global _FULL_FEATURE_NAMES
    if _FULL_FEATURE_NAMES is None:
        _FULL_FEATURE_NAMES = list(compute_full_features_dict(_canonical_frame()).keys())
    return list(_FULL_FEATURE_NAMES)


# ── Math helpers ──────────────────────────────────────────────────────────────

def _ema(arr: np.ndarray, period: int) -> np.ndarray:
    k = 2 / (period + 1)
    ema = np.zeros(len(arr))
    ema[0] = arr[0]
    for i in range(1, len(arr)):
        ema[i] = arr[i] * k + ema[i-1] * (1 - k)
    return ema


def _rsi(arr: np.ndarray, period: int = 14) -> float:
    if len(arr) < period + 1:
        return 50.0
    deltas = np.diff(arr[-(period+1):])
    gains  = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains)
    avg_loss = np.mean(losses)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _adx(h: np.ndarray, l: np.ndarray, c: np.ndarray, period: int = 14) -> float:
    if len(c) < period + 1:
        return 25.0
    h, l, c = h[-(period+2):], l[-(period+2):], c[-(period+2):]
    tr  = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    pdm = np.where((h[1:] - h[:-1]) > (l[:-1] - l[1:]), np.maximum(h[1:] - h[:-1], 0), 0)
    ndm = np.where((l[:-1] - l[1:]) > (h[1:] - h[:-1]), np.maximum(l[:-1] - l[1:], 0), 0)
    atr = np.mean(tr)
    pdi = 100 * np.mean(pdm) / (atr + 1e-9)
    ndi = 100 * np.mean(ndm) / (atr + 1e-9)
    dx  = 100 * abs(pdi - ndi) / (pdi + ndi + 1e-9)
    return float(dx)


def _hurst_proxy(c: np.ndarray, lags: int = 20) -> float:
    """Fast Hurst exponent via R/S analysis. 0.5=random, >0.5=trending, <0.5=mean-reverting."""
    if len(c) < lags + 2:
        return 0.5
    try:
        rets = np.diff(np.log(c + 1e-9))
        rs_vals = []
        for lag in range(2, min(lags, len(rets) // 2)):
            sub = rets[-lag*2:-lag] if len(rets) >= lag * 2 else rets[-lag:]
            if len(sub) < 2:
                continue
            mean_sub = np.mean(sub)
            dev  = np.cumsum(sub - mean_sub)
            R    = np.max(dev) - np.min(dev)
            S    = np.std(sub)
            if S > 0:
                rs_vals.append(np.log(R / S + 1e-9) / np.log(lag))
        return float(np.clip(np.mean(rs_vals) if rs_vals else 0.5, 0.0, 1.0))
    except Exception:
        return 0.5


def _approx_entropy(series: np.ndarray, m: int = 2, r_ratio: float = 0.2) -> float:
    """Approximate entropy — lower means more predictable/regular."""
    if len(series) < m + 2:
        return 0.5
    try:
        r = r_ratio * float(np.std(series))
        if r <= 0:
            return 0.0
        N = len(series)
        def phi(m_):
            templates = np.array([series[i:i+m_] for i in range(N - m_)])
            counts = np.array([np.sum(np.max(np.abs(templates - t), axis=1) <= r) for t in templates])
            return np.mean(np.log(counts / (N - m_) + 1e-9))
        return float(np.abs(phi(m) - phi(m + 1)))
    except Exception:
        return 0.5


def _fractal_dim_proxy(c: np.ndarray) -> float:
    """Simplified Higuchi fractal dimension proxy (normalised 1-2)."""
    if len(c) < 4:
        return 1.5
    try:
        n = len(c)
        k_max = min(8, n // 2)
        lk = []
        for k in range(1, k_max + 1):
            lengths = []
            for m in range(1, k + 1):
                idxs = np.arange(m - 1, n, k)
                vals = c[idxs]
                if len(vals) < 2:
                    continue
                length = np.sum(np.abs(np.diff(vals))) * (n - 1) / (k * len(vals))
                lengths.append(length)
            if lengths:
                lk.append((np.log(k), np.log(np.mean(lengths) + 1e-9)))
        if len(lk) < 2:
            return 1.5
        ks, ls = zip(*lk)
        slope = np.polyfit(ks, ls, 1)[0]
        return float(np.clip(-slope, 1.0, 2.0))
    except Exception:
        return 1.5
