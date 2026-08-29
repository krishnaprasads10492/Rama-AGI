"""
horizons.py — intraday, swing and positional as first-class, separately-fitted horizons.

WHY THIS EXISTS (spec Section 73). Master, asked five times which horizon to target, answered
all three. `DEFAULT_HORIZON = 5` was five *daily* bars, and "intraday" cannot be expressed
that way at all: on daily bars the smallest possible horizon is one day.

So a horizon is a PAIR — the bar interval and how many of those bars ahead the label looks —
and each one is trained, persisted and reported separately.

INTRADAY MEANS HOURLY, AND THAT IS A DATA FACT RATHER THAN A PREFERENCE. Measured against
Yahoo: 1m caps at 5 days, 5m/15m/30m at one month (three months returns HTTP 422), and only
60m reaches two years — 3,499 bars. Section 69's gate needs a 150-row holdout and
forward-chaining folds, which a thirty-day series cannot supply, and thirty days is one market
regime anyway. Five-minute bars remain fetchable for a chart; they are not trainable, and
saying so is better than shipping a model whose validation cannot mean anything.

THE THREE ANSWERS ARE NEVER AVERAGED. A three-hour call and a one-month call are claims about
different questions; blending them yields a number describing neither, and it would bury the
case that matters most — when the horizons DISAGREE. Intraday bearish against positional
bullish is not noise to smooth away, it is the shape of a pullback inside an uptrend, and it
is what decides whether to hold, trim or wait.
"""

import logging
import os
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("stockmind-ai.horizons")


class Horizon:
    """One horizon: a bar interval, a lookahead in those bars, and whether it can be trained."""

    def __init__(self, name, interval, bars, label, trainable=True,
                 min_bars=400, notes=""):
        self.name = name
        self.interval = interval
        self.bars = int(bars)
        self.label = label
        self.trainable = bool(trainable)
        self.min_bars = int(min_bars)
        self.notes = notes

    @property
    def key(self) -> str:
        """The suffix that scopes artifacts and provenance to this horizon."""
        return f"{self.interval}_h{self.bars}"

    def describe(self) -> dict:
        return {
            "name": self.name, "interval": self.interval, "bars": self.bars,
            "key": self.key, "label": self.label, "trainable": self.trainable,
            "minBars": self.min_bars, "notes": self.notes,
        }

    def __repr__(self):
        return f"<Horizon {self.name} {self.key}>"


HORIZONS = {
    "intraday": Horizon(
        "intraday", "60m", 3, "~3 hours, inside one session",
        trainable=True, min_bars=800,
        notes="Hourly bars. Yahoo serves 2 years of 60m (~3,499 bars) — the only intraday "
              "interval with enough depth for the gate. 5m and 15m cap at one month."),
    "swing": Horizon(
        "swing", "1d", 5, "about a week",
        trainable=True, min_bars=400,
        notes="The historical default, unchanged, so every existing caller behaves the same."),
    "positional": Horizon(
        "positional", "1d", 20, "about a month",
        trainable=True, min_bars=400,
        notes="Section 69's sweep found the strongest (though still gate-failing) signal near "
              "20 bars, so this is the horizon most likely to carry something."),
}

# Fetchable for a chart, deliberately NOT trainable. Recorded here rather than omitted so
# nobody re-discovers the limit and assumes it was an oversight.
DISPLAY_ONLY = {
    "5m":  "Yahoo caps 5m at one month (~1,726 bars). Holdout would fall under the 150-row "
           "floor and one month is a single regime.",
    "15m": "Yahoo caps 15m at one month (~576 bars). Same reason.",
    "1m":  "Yahoo caps 1m at five days (~1,876 bars). Five days cannot be validated forward.",
}

DEFAULT_ORDER = ["intraday", "swing", "positional"]


def get(name: str) -> Optional[Horizon]:
    return HORIZONS.get(str(name or "").strip().lower())


def resolve(names=None) -> list:
    """The requested horizons, in a stable order, unknown names dropped."""
    if not names:
        return [HORIZONS[n] for n in DEFAULT_ORDER]
    out = []
    for n in names:
        h = get(n)
        if h and h not in out:
            out.append(h)
    return out or [HORIZONS[n] for n in DEFAULT_ORDER]


def registry() -> dict:
    return {
        "horizons": [HORIZONS[n].describe() for n in DEFAULT_ORDER],
        "displayOnly": DISPLAY_ONLY,
        "note": "A horizon is (interval, bars). The three answers are reported separately and "
                "never averaged — a 3-hour call and a 1-month call are different questions, "
                "and their disagreement is information rather than noise.",
    }


# ── Artifact scoping ──────────────────────────────────────────────────────────

def artifact_name(base_filename: str, horizon: Optional[Horizon]) -> str:
    """
    `rf_direction.pkl` + swing → `rf_direction__1d_h5.pkl`.

    A horizon of None returns the unsuffixed legacy name, which is what an install trained
    before Section 73 already has on disk (I11).
    """
    if horizon is None:
        return base_filename
    stem, ext = os.path.splitext(base_filename)
    return f"{stem}__{horizon.key}{ext}"


def provenance_name(horizon: Optional[Horizon]) -> str:
    return "training.json" if horizon is None else f"training__{horizon.key}.json"


# ── Multi-horizon prediction ──────────────────────────────────────────────────

def _bars_for(horizon: Horizon, symbol: str, exchange: str,
              sync_if_missing: bool = False):
    from . import store
    df = store.load(symbol, exchange, horizon.interval)
    if (df is None or len(df) < 120) and sync_if_missing:
        try:
            df, _ = store.sync(symbol, exchange, horizon.interval)
        except Exception as e:
            logger.warning(f"[horizons] could not sync {symbol} {horizon.interval}: {e}")
    return df


def predict_all(symbol: str, exchange: str = "NSE", names=None,
                sync_if_missing: bool = False) -> dict:
    """
    One directional probability per horizon, each from its own interval's bars.

    @returns {horizons: {name: {...}}, agreement: {...}}

    Each horizon is answered from ITS OWN bar series. Running a 3-hour question against daily
    bars would produce a number, and the number would be about something else.
    """
    from .featureset import build_feature_map
    from .registry import MODEL_REGISTRY

    out = {"symbol": symbol.upper(), "exchange": exchange, "horizons": {}}
    for h in resolve(names):
        entry = {**h.describe(), "probability": None, "direction": None,
                 "bars": None, "asOf": None, "error": None}
        df = _bars_for(h, symbol, exchange, sync_if_missing)
        if df is None or len(df) < 120:
            entry["error"] = (f"need at least 120 {h.interval} bars, have "
                              f"{0 if df is None else len(df)}"
                              + ("" if sync_if_missing else " — fetch them first"))
            out["horizons"][h.name] = entry
            continue
        try:
            from .backtest import FEATURE_WINDOW
            window = df.tail(FEATURE_WINDOW)
            fmap = build_feature_map(window, symbol, exchange)
            vec = np.array(list(fmap.values()), dtype=np.float32)
            res = MODEL_REGISTRY.ensemble_predict(vec, feature_map=fmap,
                                                  horizon_key=h.key)
            p = float(res["probability"])
            entry.update({
                "probability": round(p, 4),
                "direction": "LONG" if p >= 0.5 else "SHORT",
                "conviction": round(abs(p - 0.5) * 2, 4),
                "bars": int(len(df)),
                "asOf": str(pd.Timestamp(df["date"].iloc[-1])),
                "regime": res.get("regime_detected"),
                "uncertainty": res.get("uncertainty"),
                "epistemic": res.get("epistemic"),
                "suppressed": bool(res.get("suppressed")),
                "modelSource": res.get("horizonModels") or "shared",
                "reasons": (res.get("reasons") or [])[:4],
            })
        except Exception as e:
            entry["error"] = f"{type(e).__name__}: {e}"
            logger.warning(f"[horizons] {h.name} failed for {symbol}: {e}")
        out["horizons"][h.name] = entry

    out["agreement"] = agreement(out["horizons"])
    return out


def agreement(by_horizon: dict) -> dict:
    """
    Do the horizons agree, and what does the disagreement mean?

    THIS IS REPORTED INSTEAD OF A BLENDED PROBABILITY (Section 73). A single averaged number
    would hide the most informative case there is — a short horizon leaning against a long one
    is the signature of a pullback inside a trend, and a trader needs to see that rather than
    its average.
    """
    live = {k: v for k, v in (by_horizon or {}).items()
            if v.get("probability") is not None}
    if not live:
        return {"state": "unknown", "answered": 0,
                "note": "No horizon produced a probability."}

    dirs = {k: v["direction"] for k, v in live.items()}
    longs = [k for k, d in dirs.items() if d == "LONG"]
    shorts = [k for k, d in dirs.items() if d == "SHORT"]
    probs = np.array([v["probability"] for v in live.values()], dtype=float)

    if not shorts:
        state, note = "aligned-long", "Every answered horizon leans long."
    elif not longs:
        state, note = "aligned-short", "Every answered horizon leans short."
    else:
        state = "split"
        short_h = "intraday" in shorts and "positional" in longs
        long_h = "intraday" in longs and "positional" in shorts
        if short_h:
            note = ("Near-term leans short while the longer horizon leans long — the shape of "
                    "a pullback inside an uptrend. Adding on weakness and cutting on strength "
                    "are opposite trades here; decide which horizon you are trading.")
        elif long_h:
            note = ("Near-term leans long while the longer horizon leans short — the shape of "
                    "a bounce inside a downtrend. Rallies in this configuration are the ones "
                    "that trap buyers.")
        else:
            note = (f"Horizons disagree: long {sorted(longs)}, short {sorted(shorts)}. "
                    f"No single answer covers both.")

    return {
        "state": state,
        "answered": int(len(live)),
        "long": sorted(longs),
        "short": sorted(shorts),
        "spread": round(float(probs.max() - probs.min()), 4),
        # Conviction is only meaningful within a horizon, so the cross-horizon figure is the
        # weakest one — the strongest reading cannot vouch for the others.
        "weakestConviction": round(float(min(abs(p - 0.5) * 2 for p in probs)), 4),
        "note": note,
    }
