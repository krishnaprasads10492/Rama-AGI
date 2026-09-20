/**
 * indicators.js — overlays the chart may compute for itself (Section 101).
 *
 * THE LINE: the renderer may draw any PURE FUNCTION OF THE VISIBLE BARS. Anything forward-looking,
 * model-derived or advisory must come from the engine. A moving average asserts nothing the bars do not
 * already contain; a projection or a signal level does. The cone and the levels stay engine-only, and
 * this is written down because the temptation later is to compute "a signal" here since the maths is
 * nearby.
 *
 * WARM-UP IS DROPPED, NEVER FILLED. A partial average drawn as an average is a wrong number that looks
 * right — the same failure class as Section 88's unmeasured fields.
 *
 * In: `[{time, open, high, low, close, volume}]` in chart order. Out: `[{time, value}]` for `setData`.
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// `bars || []` is not enough: a non-null non-array (an object from a malformed IPC reply) is truthy
// and not iterable, so it throws inside the `for...of` instead of degrading.
const asBars = (bars) => (Array.isArray(bars) ? bars : []);

/** Closing prices with their times, skipping anything unusable. */
function closes(bars) {
  const out = [];
  for (const b of asBars(bars)) {
    if (finite(b?.close)) out.push({ time: b.time, value: b.close });
  }
  return out;
}

/**
 * Simple moving average.
 * @param {Array} bars
 * @param {number} period
 * @returns {Array<{time: *, value: number}>} empty when there are fewer bars than the period
 */
export function sma(bars, period) {
  const p = Math.floor(period);
  const src = closes(bars);
  if (!(p >= 1) || src.length < p) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < src.length; i += 1) {
    sum += src[i].value;
    if (i >= p) sum -= src[i - p].value;
    if (i >= p - 1) out.push({ time: src[i].time, value: sum / p });
  }
  return out;
}

/**
 * EMA, seeded on the first `period` bars' SMA — which is why the first point is at index `period - 1`.
 * Seeding on the first close is the common shortcut and biases the whole early series toward one bar.
 */
export function ema(bars, period) {
  const p = Math.floor(period);
  const src = closes(bars);
  if (!(p >= 1) || src.length < p) return [];
  const k = 2 / (p + 1);
  let seed = 0;
  for (let i = 0; i < p; i += 1) seed += src[i].value;
  let prev = seed / p;
  const out = [{ time: src[p - 1].time, value: prev }];
  for (let i = p; i < src.length; i += 1) {
    prev = src[i].value * k + prev * (1 - k);
    out.push({ time: src[i].time, value: prev });
  }
  return out;
}

/**
 * Bollinger bands: SMA ± POPULATION standard deviation. Population, not sample — the window IS the thing
 * described, not a draw from a larger set, and at period 20 the two differ enough to move the band.
 * @returns {{middle: Array, upper: Array, lower: Array}}
 */
export function bollinger(bars, period = 20, mult = 2) {
  const p = Math.floor(period);
  const src = closes(bars);
  const empty = { middle: [], upper: [], lower: [] };
  if (!(p >= 2) || !finite(mult) || src.length < p) return empty;
  const middle = [];
  const upper = [];
  const lower = [];
  for (let i = p - 1; i < src.length; i += 1) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j += 1) sum += src[j].value;
    const mean = sum / p;
    let varSum = 0;
    for (let j = i - p + 1; j <= i; j += 1) {
      const d = src[j].value - mean;
      varSum += d * d;
    }
    const sd = Math.sqrt(varSum / p);
    middle.push({ time: src[i].time, value: mean });
    upper.push({ time: src[i].time, value: mean + mult * sd });
    lower.push({ time: src[i].time, value: mean - mult * sd });
  }
  return { middle, upper, lower };
}

/**
 * RSI with Wilder's smoothing — not a simple mean of gains and losses, which is a different indicator
 * sharing the name and differs by enough to move a reading across the 70 line. No losses is 100 by
 * definition, handled explicitly rather than by dividing by zero.
 */
export function rsi(bars, period = 14) {
  const p = Math.floor(period);
  const src = closes(bars);
  if (!(p >= 2) || src.length < p + 1) return [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i += 1) {
    const d = src[i].value - src[i - 1].value;
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  const value = () => (avgLoss === 0
    ? (avgGain === 0 ? 50 : 100)
    : 100 - 100 / (1 + avgGain / avgLoss));
  const out = [{ time: src[p].time, value: value() }];
  for (let i = p + 1; i < src.length; i += 1) {
    const d = src[i].value - src[i - 1].value;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
    out.push({ time: src[i].time, value: value() });
  }
  return out;
}

/**
 * MACD. The signal line is an EMA OF THE MACD LINE, seeded on that series rather than on closes, and the
 * histogram exists only where both do — which is why all three are aligned here by TIME rather than
 * zipped by index at the call site.
 * @returns {{macd: Array, signal: Array, histogram: Array}}
 */
export function macd(bars, fast = 12, slow = 26, signalPeriod = 9) {
  const empty = { macd: [], signal: [], histogram: [] };
  if (!(fast >= 1) || !(slow > fast) || !(signalPeriod >= 1)) return empty;
  const f = ema(bars, fast);
  const s = ema(bars, slow);
  if (f.length === 0 || s.length === 0) return empty;
  const fastAt = new Map(f.map((pt) => [String(pt.time), pt.value]));
  const line = [];
  for (const pt of s) {
    const fv = fastAt.get(String(pt.time));
    if (finite(fv)) line.push({ time: pt.time, value: fv - pt.value });
  }
  if (line.length < signalPeriod) return { macd: line, signal: [], histogram: [] };
  // `ema` reads `.close`, so the MACD line is presented to it in that shape rather than
  // duplicating the smoothing maths.
  const signal = ema(line.map((pt) => ({ time: pt.time, close: pt.value })), signalPeriod);
  const signalAt = new Map(signal.map((pt) => [String(pt.time), pt.value]));
  const histogram = [];
  for (const pt of line) {
    const sv = signalAt.get(String(pt.time));
    if (finite(sv)) histogram.push({ time: pt.time, value: pt.value - sv });
  }
  return { macd: line, signal, histogram };
}

/**
 * VWAP, anchored to each session — which is the whole point and why it is intraday-only. Run across days
 * it drifts from price and stops being the indicator the name means, so a daily series returns nothing
 * rather than a plausible wrong line.
 *
 * Intraday times are UTC epoch seconds, so a session is a UTC calendar day. NSE's 03:45–10:00 UTC window
 * sits inside one, so this does not split a session in two.
 */
export function vwap(bars) {
  const src = asBars(bars).filter((b) => typeof b?.time === 'number'
    && finite(b.high) && finite(b.low) && finite(b.close) && finite(b.volume) && b.volume > 0);
  if (src.length === 0) return [];
  const out = [];
  let day = null;
  let pv = 0;
  let vol = 0;
  for (const b of src) {
    const d = Math.floor(b.time / 86400);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
    if (vol > 0) out.push({ time: b.time, value: pv / vol });
  }
  return out;
}

/**
 * The overlay catalogue. `pane: 'oscillator'` needs its own scale — a 0–100 series on a 24,000-point
 * index axis renders as a flat line along the bottom, which is a classic chart bug.
 */
export const OVERLAY_DEFS = [
  { id: 'sma20',  label: 'SMA 20',  pane: 'price', kind: 'line', make: (b) => sma(b, 20) },
  { id: 'sma50',  label: 'SMA 50',  pane: 'price', kind: 'line', make: (b) => sma(b, 50) },
  { id: 'sma200', label: 'SMA 200', pane: 'price', kind: 'line', make: (b) => sma(b, 200) },
  { id: 'ema21',  label: 'EMA 21',  pane: 'price', kind: 'line', make: (b) => ema(b, 21) },
  { id: 'bb',     label: 'Bollinger 20,2', pane: 'price', kind: 'band', make: (b) => bollinger(b, 20, 2) },
  { id: 'vwap',   label: 'VWAP',    pane: 'price', kind: 'line', make: (b) => vwap(b), intradayOnly: true },
  { id: 'rsi14',  label: 'RSI 14',  pane: 'oscillator', kind: 'line', make: (b) => rsi(b, 14),
    scale: { min: 0, max: 100 }, guides: [30, 70] },
  { id: 'macd',   label: 'MACD',    pane: 'oscillator', kind: 'macd', make: (b) => macd(b) },
];

export const overlayById = (id) => OVERLAY_DEFS.find((o) => o.id === id) || null;

/**
 * Studies that mean what their name says on this interval.
 *
 * Withheld rather than drawn wrong, in both directions: VWAP resets each session so it is intraday-only,
 * and floor-trader pivots are computed from the PREVIOUS SESSION, so on 5-minute bars they would be
 * "pivots of the last five minutes" — a respected name over arithmetic nobody uses.
 */
export function overlaysFor(intradayInterval) {
  return OVERLAY_DEFS.filter((o) => (!o.intradayOnly || intradayInterval)
    && (!o.dailyOnly || !intradayInterval));
}

/**
 * Why an overlay drew nothing, in one sentence, so an empty toggle is never a mystery.
 * @returns {string|null} null when it drew fine.
 */
export function overlayShortfall(id, barCount, intradayInterval) {
  const def = overlayById(id);
  if (!def) return null;
  if (def.intradayOnly && !intradayInterval) {
    return `${def.label} is only meaningful on intraday bars — it resets each session.`;
  }
  if (def.dailyOnly && intradayInterval) {
    return `${def.label} is computed from the previous SESSION, so it needs daily or longer bars.`;
  }
  // Read from the shared table rather than a literal here: a study added without a requirement would
  // otherwise report "drew fine" while drawing nothing.
  const need = OVERLAY_NEEDS[id];
  if (need && barCount < need) {
    return `${def.label} needs ${need} bars and there are ${barCount}. `
      + 'Widen the range, or choose a finer interval.';
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 120 — the rest of the standard toolkit
//
// Master: *"it's by far too minimal and various thing in and around it are still lacking."* The chart
// offered 8 studies against roughly 30 indicator concepts the Python engine already computes and the
// ~60 a trading platform ships. Everything below is still a PURE FUNCTION OF THE VISIBLE BARS — the line
// this module has always held. Nothing forward-looking, nothing model-derived.
//
// FORMULAS THAT ARE COMMONLY GOT WRONG ARE NOTED AT THE FUNCTION. ADX, CCI, Stochastic and Parabolic SAR
// each have a widely-copied wrong version, and an indicator that is subtly wrong is worse than an absent
// one because it is read with confidence. Every one here is tested in `scripts/verifyIndicators.mjs`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Bars with a usable OHLC, in order. Volume is not required — several studies do not use it. */
function ohlc(bars) {
  const out = [];
  for (const b of asBars(bars)) {
    if (finite(b?.high) && finite(b?.low) && finite(b?.close)) out.push(b);
  }
  return out;
}

/**
 * True range per bar, from index 1. TR[0] is undefined because it needs a previous close — returning
 * `high - low` for it, as many implementations do, silently biases the first ATR reading.
 */
function trueRanges(src) {
  const out = [];
  for (let i = 1; i < src.length; i += 1) {
    const pc = src[i - 1].close;
    const tr = Math.max(src[i].high - src[i].low,
      Math.abs(src[i].high - pc), Math.abs(src[i].low - pc));
    out.push({ time: src[i].time, value: tr });
  }
  return out;
}

/** Wilder's running mean: seeded on a simple mean of the first `p`, then (prev*(p-1) + x)/p. */
function wilder(values, p) {
  if (values.length < p) return [];
  let acc = 0;
  for (let i = 0; i < p; i += 1) acc += values[i].value;
  let prev = acc / p;
  const out = [{ time: values[p - 1].time, value: prev }];
  for (let i = p; i < values.length; i += 1) {
    prev = (prev * (p - 1) + values[i].value) / p;
    out.push({ time: values[i].time, value: prev });
  }
  return out;
}

/** Average true range, absolute. */
export function atr(bars, period = 14) {
  const p = Math.floor(period);
  const src = ohlc(bars);
  if (!(p >= 1) || src.length < p + 1) return [];
  return wilder(trueRanges(src), p);
}

/**
 * ATR as a percentage of close — the comparable form.
 *
 * Absolute ATR cannot be read across instruments or across years: 40 points means something different on
 * a 500 stock and a 25,000 index. The percentage is what tells master whether a 2% stop is inside noise.
 */
export function atrPct(bars, period = 14) {
  const src = ohlc(bars);
  const closeAt = new Map(src.map((b) => [String(b.time), b.close]));
  return atr(bars, period)
    .map((pt) => {
      const c = closeAt.get(String(pt.time));
      return finite(c) && c > 0 ? { time: pt.time, value: (pt.value / c) * 100 } : null;
    })
    .filter(Boolean);
}

/**
 * ADX with +DI and −DI (Wilder).
 *
 * THE PART EVERYONE GETS WRONG: only the LARGER of the two directional moves counts on any bar, and only
 * if it is positive. An implementation that takes both, or that allows a negative, produces a DI pair
 * that is far too close together and an ADX that never leaves the twenties.
 *
 * @returns {{adx: Array, plusDI: Array, minusDI: Array}}
 */
export function adx(bars, period = 14) {
  const p = Math.floor(period);
  const src = ohlc(bars);
  const empty = { adx: [], plusDI: [], minusDI: [] };
  if (!(p >= 2) || src.length < p * 2 + 1) return empty;

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < src.length; i += 1) {
    const up = src[i].high - src[i - 1].high;
    const down = src[i - 1].low - src[i].low;
    const pc = src[i - 1].close;
    tr.push({ time: src[i].time,
      value: Math.max(src[i].high - src[i].low,
        Math.abs(src[i].high - pc), Math.abs(src[i].low - pc)) });
    // Only the larger, only if positive. An inside bar contributes nothing to either.
    plusDM.push({ time: src[i].time, value: (up > down && up > 0) ? up : 0 });
    minusDM.push({ time: src[i].time, value: (down > up && down > 0) ? down : 0 });
  }

  const trS = wilder(tr, p);
  const pS = wilder(plusDM, p);
  const mS = wilder(minusDM, p);
  const plusDI = [];
  const minusDI = [];
  const dx = [];
  for (let i = 0; i < trS.length; i += 1) {
    const t = trS[i].value;
    if (!(t > 0)) continue;
    const pdi = (pS[i].value / t) * 100;
    const mdi = (mS[i].value / t) * 100;
    plusDI.push({ time: trS[i].time, value: pdi });
    minusDI.push({ time: trS[i].time, value: mdi });
    const sum = pdi + mdi;
    dx.push({ time: trS[i].time, value: sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0 });
  }
  return { adx: wilder(dx, p), plusDI, minusDI };
}

/**
 * Stochastic oscillator, %K and %D.
 *
 * `smooth` is applied to raw %K BEFORE %D, which is what "slow stochastic" means — `smooth: 1` gives the
 * fast version. Naming them apart matters: the fast and slow readings cross at different bars, and a
 * chart labelled "Stochastic" that silently means one of them is the kind of ambiguity that loses money.
 *
 * @returns {{k: Array, d: Array}}
 */
export function stochastic(bars, period = 14, dPeriod = 3, smooth = 3) {
  const p = Math.floor(period);
  const src = ohlc(bars);
  const empty = { k: [], d: [] };
  if (!(p >= 1) || src.length < p) return empty;
  const raw = [];
  for (let i = p - 1; i < src.length; i += 1) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - p + 1; j <= i; j += 1) {
      if (src[j].high > hh) hh = src[j].high;
      if (src[j].low < ll) ll = src[j].low;
    }
    const rng = hh - ll;
    // A flat window has no position within it to report. 50 is the honest midpoint; 0 would read as
    // "at the bottom of the range", which is a claim the data does not make.
    raw.push({ time: src[i].time, value: rng > 0 ? ((src[i].close - ll) / rng) * 100 : 50 });
  }
  const meanOf = (arr, n) => {
    const q = Math.floor(n);
    if (!(q >= 1) || arr.length < q) return [];
    const out = [];
    let sum = 0;
    for (let i = 0; i < arr.length; i += 1) {
      sum += arr[i].value;
      if (i >= q) sum -= arr[i - q].value;
      if (i >= q - 1) out.push({ time: arr[i].time, value: sum / q });
    }
    return out;
  };
  const k = smooth > 1 ? meanOf(raw, smooth) : raw;
  return { k, d: meanOf(k, dPeriod) };
}

/** Williams %R — the same range position as Stochastic, expressed from the top as −100…0. */
export function williamsR(bars, period = 14) {
  return stochastic(bars, period, 1, 1).k.map((pt) => ({ time: pt.time, value: pt.value - 100 }));
}

/**
 * CCI.
 *
 * THE DIVISOR IS MEAN ABSOLUTE DEVIATION, NOT STANDARD DEVIATION. Substituting the standard deviation is
 * the single most common CCI error and it compresses the reading enough that the ±100 lines stop meaning
 * what Lambert defined them to mean. The 0.015 constant exists precisely to put roughly 70–80% of
 * readings inside ±100 given MAD.
 */
export function cci(bars, period = 20) {
  const p = Math.floor(period);
  const src = ohlc(bars);
  if (!(p >= 2) || src.length < p) return [];
  const tp = src.map((b) => ({ time: b.time, value: (b.high + b.low + b.close) / 3 }));
  const out = [];
  for (let i = p - 1; i < tp.length; i += 1) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j += 1) sum += tp[j].value;
    const mean = sum / p;
    let mad = 0;
    for (let j = i - p + 1; j <= i; j += 1) mad += Math.abs(tp[j].value - mean);
    mad /= p;
    out.push({ time: tp[i].time, value: mad > 0 ? (tp[i].value - mean) / (0.015 * mad) : 0 });
  }
  return out;
}

/** On-balance volume — a running total, so only its SLOPE and divergences are readable, not its level. */
export function obv(bars) {
  const src = asBars(bars).filter((b) => finite(b?.close) && finite(b?.volume));
  if (src.length < 2) return [];
  let acc = 0;
  const out = [{ time: src[0].time, value: 0 }];
  for (let i = 1; i < src.length; i += 1) {
    if (src[i].close > src[i - 1].close) acc += src[i].volume;
    else if (src[i].close < src[i - 1].close) acc -= src[i].volume;
    out.push({ time: src[i].time, value: acc });
  }
  return out;
}

/**
 * Money flow index — a volume-weighted RSI on typical price.
 *
 * An unchanged typical price counts as NEITHER positive nor negative flow, which is Quong and Soudack's
 * definition. Counting it as positive is a common shortcut and biases the reading upward on quiet bars.
 */
export function mfi(bars, period = 14) {
  const p = Math.floor(period);
  const src = asBars(bars).filter((b) => finite(b?.high) && finite(b?.low)
    && finite(b?.close) && finite(b?.volume));
  if (!(p >= 2) || src.length < p + 1) return [];
  const tp = src.map((b) => ({ time: b.time, value: (b.high + b.low + b.close) / 3,
    flow: ((b.high + b.low + b.close) / 3) * b.volume }));
  const out = [];
  for (let i = p; i < tp.length; i += 1) {
    let pos = 0;
    let neg = 0;
    for (let j = i - p + 1; j <= i; j += 1) {
      if (tp[j].value > tp[j - 1].value) pos += tp[j].flow;
      else if (tp[j].value < tp[j - 1].value) neg += tp[j].flow;
    }
    // All flow one way is 100 or 0 by definition, stated rather than reached by dividing by zero.
    const value = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
    out.push({ time: tp[i].time, value });
  }
  return out;
}

/** Rate of change, percent over `period` bars. */
export function roc(bars, period = 12) {
  const p = Math.floor(period);
  const src = closes(bars);
  if (!(p >= 1) || src.length < p + 1) return [];
  const out = [];
  for (let i = p; i < src.length; i += 1) {
    const base = src[i - p].value;
    if (base > 0) out.push({ time: src[i].time, value: ((src[i].value - base) / base) * 100 });
  }
  return out;
}

/**
 * Donchian channel — the highest high and lowest low of the last `period` bars.
 *
 * EXCLUDES THE CURRENT BAR when `excludeCurrent` is set, which is what a breakout rule needs: a channel
 * that includes today can never be broken by today, so a Donchian breakout measured against an inclusive
 * channel fires on nothing. The strategy layer's `breakout` block already excludes it; this matches so
 * the chart and the backtest cannot disagree about what a break is.
 *
 * @returns {{middle: Array, upper: Array, lower: Array}}
 */
export function donchian(bars, period = 20, excludeCurrent = true) {
  const p = Math.floor(period);
  const src = ohlc(bars);
  const empty = { middle: [], upper: [], lower: [] };
  const off = excludeCurrent ? 1 : 0;
  if (!(p >= 2) || src.length < p + off) return empty;
  const middle = [];
  const upper = [];
  const lower = [];
  for (let i = p - 1 + off; i < src.length; i += 1) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - p + 1 - off; j <= i - off; j += 1) {
      if (src[j].high > hh) hh = src[j].high;
      if (src[j].low < ll) ll = src[j].low;
    }
    upper.push({ time: src[i].time, value: hh });
    lower.push({ time: src[i].time, value: ll });
    middle.push({ time: src[i].time, value: (hh + ll) / 2 });
  }
  return { middle, upper, lower };
}

/**
 * Keltner channel — EMA ± multiple of ATR.
 *
 * Chester Keltner's original used a 10-day SMA of typical price and the daily range; the form in use
 * everywhere since Linda Raschke is an EMA with ATR, and that is what this is. The parameters are in the
 * label so there is no doubt which one master is reading.
 *
 * @returns {{middle: Array, upper: Array, lower: Array}}
 */
export function keltner(bars, period = 20, atrPeriod = 20, mult = 2) {
  const mid = ema(bars, period);
  const a = atr(bars, atrPeriod);
  const empty = { middle: [], upper: [], lower: [] };
  if (mid.length === 0 || a.length === 0) return empty;
  const atrAt = new Map(a.map((pt) => [String(pt.time), pt.value]));
  const middle = [];
  const upper = [];
  const lower = [];
  for (const pt of mid) {
    const av = atrAt.get(String(pt.time));
    if (!finite(av)) continue;
    middle.push({ time: pt.time, value: pt.value });
    upper.push({ time: pt.time, value: pt.value + mult * av });
    lower.push({ time: pt.time, value: pt.value - mult * av });
  }
  return { middle, upper, lower };
}

/**
 * Supertrend — an ATR trailing stop that flips side.
 *
 * Returned as TWO series rather than one, because a single line joining a stop below price to a stop
 * above it draws a vertical jump through the candles that never existed. Split at the flip, an uptrend
 * stop and a downtrend stop can be coloured differently, which is the whole reason to look at it.
 *
 * The band only ever tightens while the trend holds — a trailing stop that could loosen is not a stop.
 *
 * @returns {{up: Array, down: Array, flips: Array}}
 */
export function supertrend(bars, period = 10, mult = 3) {
  const p = Math.floor(period);
  const src = ohlc(bars);
  const empty = { up: [], down: [], flips: [] };
  if (!(p >= 1) || src.length < p + 2) return empty;
  const a = atr(bars, p);
  if (a.length === 0) return empty;
  const atrAt = new Map(a.map((pt) => [String(pt.time), pt.value]));

  const up = [];
  const down = [];
  const flips = [];
  let trail = null;
  let dir = 0;                     // +1 trend up (stop below), -1 trend down (stop above)
  for (const b of src) {
    const av = atrAt.get(String(b.time));
    if (!finite(av)) continue;
    const hl2 = (b.high + b.low) / 2;
    const support = hl2 - mult * av;
    const resistance = hl2 + mult * av;

    if (trail === null) {
      dir = 1;
      trail = support;
    } else if (dir === 1) {
      if (b.close < trail) { dir = -1; trail = resistance; flips.push({ time: b.time, value: trail }); }
      else trail = Math.max(support, trail);        // only tightens
    } else {
      if (b.close > trail) { dir = 1; trail = support; flips.push({ time: b.time, value: trail }); }
      else trail = Math.min(resistance, trail);
    }
    (dir === 1 ? up : down).push({ time: b.time, value: trail });
  }
  return { up, down, flips };
}

/**
 * Parabolic SAR.
 *
 * THE RULE MOST IMPLEMENTATIONS DROP: after a flip, the SAR may not be placed beyond the prior two bars'
 * extreme — without that clamp the stop lands inside the very bar that triggered it and flips again
 * immediately, producing a stream of false reversals. The acceleration factor steps only when a NEW
 * extreme point is made, not on every bar.
 */
export function psar(bars, step = 0.02, maxStep = 0.2) {
  const src = ohlc(bars);
  if (src.length < 3 || !(step > 0) || !(maxStep >= step)) return [];
  let dir = src[1].close >= src[0].close ? 1 : -1;
  let sar = dir === 1 ? src[0].low : src[0].high;
  let ep = dir === 1 ? src[1].high : src[1].low;
  let af = step;
  const out = [];
  for (let i = 1; i < src.length; i += 1) {
    sar += af * (ep - sar);
    // The clamp. Two bars, because one is not enough to keep the stop out of the reversal bar.
    if (dir === 1) {
      sar = Math.min(sar, src[i - 1].low, src[i > 1 ? i - 2 : i - 1].low);
    } else {
      sar = Math.max(sar, src[i - 1].high, src[i > 1 ? i - 2 : i - 1].high);
    }
    if (dir === 1 && src[i].low < sar) {
      dir = -1; sar = ep; ep = src[i].low; af = step;
    } else if (dir === -1 && src[i].high > sar) {
      dir = 1; sar = ep; ep = src[i].high; af = step;
    } else if (dir === 1 && src[i].high > ep) {
      ep = src[i].high; af = Math.min(af + step, maxStep);
    } else if (dir === -1 && src[i].low < ep) {
      ep = src[i].low; af = Math.min(af + step, maxStep);
    }
    out.push({ time: src[i].time, value: sar });
  }
  return out;
}

/**
 * Ichimoku Kinko Hyo.
 *
 * THE DISPLACEMENT IS REAL AND IS HONOURED, WITH ONE DISCLOSED TRUNCATION. Senkou A and B are plotted 26
 * bars AHEAD and Chikou 26 bars BEHIND — that displacement is the indicator, not decoration, and a
 * version drawing the cloud at the current bar is a different thing wearing the name.
 *
 * Rāma has no future bars to plot onto, so the forward cloud is drawn only as far as the stored series
 * reaches: the last 26 bars carry no cloud. That is a truncation, not an error, and it is stated rather
 * than papered over by synthesising 26 future timestamps — which would put invented bars on master's
 * chart to make an indicator look complete.
 *
 * @returns {{tenkan: Array, kijun: Array, senkouA: Array, senkouB: Array, chikou: Array}}
 */
export function ichimoku(bars, conv = 9, base = 26, spanB = 52, displace = 26) {
  const src = ohlc(bars);
  const empty = { tenkan: [], kijun: [], senkouA: [], senkouB: [], chikou: [] };
  if (src.length < spanB) return empty;
  const midOver = (n, i) => {
    if (i < n - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - n + 1; j <= i; j += 1) {
      if (src[j].high > hh) hh = src[j].high;
      if (src[j].low < ll) ll = src[j].low;
    }
    return (hh + ll) / 2;
  };
  const tenkan = [];
  const kijun = [];
  const senkouA = [];
  const senkouB = [];
  const chikou = [];
  for (let i = 0; i < src.length; i += 1) {
    const t = midOver(conv, i);
    const k = midOver(base, i);
    const b = midOver(spanB, i);
    if (t !== null) tenkan.push({ time: src[i].time, value: t });
    if (k !== null) kijun.push({ time: src[i].time, value: k });
    // Forward displacement: the value computed here belongs on the bar `displace` ahead.
    if (t !== null && k !== null && i + displace < src.length) {
      senkouA.push({ time: src[i + displace].time, value: (t + k) / 2 });
    }
    if (b !== null && i + displace < src.length) {
      senkouB.push({ time: src[i + displace].time, value: b });
    }
    // Backward displacement: today's close, plotted 26 bars ago. Always available.
    if (i - displace >= 0) chikou.push({ time: src[i - displace].time, value: src[i].close });
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/**
 * Classic floor-trader pivots from the PREVIOUS bar, held flat across the current one.
 *
 * On a daily chart the previous bar is the previous session, which is what a pivot means. On an intraday
 * chart the previous bar is the previous 5 minutes, which is NOT what it means — so this returns nothing
 * for intraday rather than a line that borrows a respected name for arithmetic nobody uses.
 *
 * @returns {{p: Array, r1: Array, r2: Array, s1: Array, s2: Array}}
 */
export function pivots(bars) {
  const src = ohlc(bars);
  const out = { p: [], r1: [], r2: [], s1: [], s2: [] };
  if (src.length < 2) return out;
  for (let i = 1; i < src.length; i += 1) {
    const { high: h, low: l, close: c } = src[i - 1];
    const p = (h + l + c) / 3;
    const rng = h - l;
    out.p.push({ time: src[i].time, value: p });
    out.r1.push({ time: src[i].time, value: 2 * p - l });
    out.s1.push({ time: src[i].time, value: 2 * p - h });
    out.r2.push({ time: src[i].time, value: p + rng });
    out.s2.push({ time: src[i].time, value: p - rng });
  }
  return out;
}

/**
 * Heikin-Ashi bars — a smoothing of the candles themselves, not an overlay.
 *
 * HA close is the bar's own average and HA open is the previous HA midpoint, so a run of same-colour
 * bodies reads as a trend far more clearly than raw candles. The cost, which must be said: **HA open and
 * close are NOT tradeable prices.** A stop read off an HA body is a stop at a price that never traded, so
 * this is a lens for reading direction and never a source of levels.
 *
 * @returns {Array} chart-shaped bars, same times
 */
export function heikinAshi(bars) {
  const src = asBars(bars).filter((b) => finite(b?.open) && finite(b?.high)
    && finite(b?.low) && finite(b?.close));
  if (src.length === 0) return [];
  const out = [];
  let prevOpen = (src[0].open + src[0].close) / 2;
  let prevClose = (src[0].open + src[0].high + src[0].low + src[0].close) / 4;
  out.push({ time: src[0].time, open: prevOpen, high: src[0].high, low: src[0].low,
    close: prevClose, volume: src[0].volume });
  for (let i = 1; i < src.length; i += 1) {
    const b = src[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = (prevOpen + prevClose) / 2;
    out.push({ time: b.time, open, high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close), close, volume: b.volume });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

// ── The catalogue additions ───────────────────────────────────────────────────
//
// `kind: 'series'` is a GENERIC multi-line shape: `make` returns `{series: [{data, label, ...}]}`, so a
// study with any number of lines needs no new branch in `PriceChart`. The five one-off kinds this would
// otherwise have needed (ichimoku, supertrend, psar, pivots, adx) are why it exists.

OVERLAY_DEFS.push(
  // ── Price-pane overlays ────────────────────────────────────────────────────
  { id: 'donchian', label: 'Donchian 20', pane: 'price', kind: 'band',
    make: (b) => donchian(b, 20) },
  { id: 'keltner', label: 'Keltner 20,2×ATR20', pane: 'price', kind: 'band',
    make: (b) => keltner(b, 20, 20, 2) },
  // `directionalSplit` says one of the two sides may legitimately be empty: a window where the trend
  // never flipped has no opposite-side stop to draw, and that is information rather than a shortfall.
  { id: 'supertrend', label: 'Supertrend 10,3', pane: 'price', kind: 'series', directionalSplit: true,
    make: (b) => {
      const st = supertrend(b, 10, 3);
      return { series: [
        { data: st.up, label: 'Supertrend', color: 'var(--green)', width: 2 },
        { data: st.down, label: null, color: 'var(--red)', width: 2 },
      ] };
    } },
  { id: 'psar', label: 'Parabolic SAR', pane: 'price', kind: 'series',
    make: (b) => ({ series: [{ data: psar(b), label: 'PSAR', dots: true, width: 1 }] }) },
  { id: 'ichimoku', label: 'Ichimoku 9,26,52', pane: 'price', kind: 'series',
    make: (b) => {
      const i = ichimoku(b);
      return { series: [
        { data: i.tenkan, label: 'Tenkan', width: 1 },
        { data: i.kijun, label: 'Kijun', width: 2 },
        { data: i.senkouA, label: 'Senkou A', dashed: true },
        { data: i.senkouB, label: 'Senkou B', dashed: true },
        { data: i.chikou, label: 'Chikou', dotted: true },
      ] };
    } },
  { id: 'pivots', label: 'Pivots (prev bar)', pane: 'price', kind: 'series', dailyOnly: true,
    make: (b) => {
      const p = pivots(b);
      return { series: [
        { data: p.r2, label: 'R2', dotted: true },
        { data: p.r1, label: 'R1', dashed: true },
        { data: p.p, label: 'Pivot', width: 2 },
        { data: p.s1, label: 'S1', dashed: true },
        { data: p.s2, label: 'S2', dotted: true },
      ] };
    } },

  // ── Own-pane studies ──────────────────────────────────────────────────────
  { id: 'atrPct', label: 'ATR% 14', pane: 'oscillator', kind: 'line',
    make: (b) => atrPct(b, 14) },
  { id: 'adx', label: 'ADX 14 +DI −DI', pane: 'oscillator', kind: 'series',
    make: (b) => {
      const a = adx(b, 14);
      return { series: [
        { data: a.adx, label: 'ADX', width: 2 },
        { data: a.plusDI, label: '+DI', color: 'var(--green)' },
        { data: a.minusDI, label: '−DI', color: 'var(--red)' },
      ], guides: [25] };
    } },
  { id: 'stoch', label: 'Stochastic 14,3,3', pane: 'oscillator', kind: 'series',
    make: (b) => {
      const s = stochastic(b, 14, 3, 3);
      return { series: [
        { data: s.k, label: '%K', width: 2 },
        { data: s.d, label: '%D', color: 'var(--amber)' },
      ], guides: [20, 80], scale: { min: 0, max: 100 } };
    } },
  { id: 'williams', label: 'Williams %R 14', pane: 'oscillator', kind: 'line',
    make: (b) => williamsR(b, 14), scale: { min: -100, max: 0 }, guides: [-80, -20] },
  { id: 'cci', label: 'CCI 20', pane: 'oscillator', kind: 'line',
    make: (b) => cci(b, 20), guides: [-100, 100] },
  { id: 'mfi', label: 'MFI 14', pane: 'oscillator', kind: 'line',
    make: (b) => mfi(b, 14), scale: { min: 0, max: 100 }, guides: [20, 80] },
  { id: 'obv', label: 'OBV', pane: 'oscillator', kind: 'line', make: (b) => obv(b) },
  { id: 'roc', label: 'ROC 12', pane: 'oscillator', kind: 'line',
    make: (b) => roc(b, 12), guides: [0] },
);

/**
 * Bars per study before it can draw anything, so an empty toggle is never a mystery.
 *
 * Kept beside the definitions rather than inside `overlayShortfall`'s literal, because a study added
 * without a requirement here reports "drew fine" while drawing nothing.
 */
export const OVERLAY_NEEDS = {
  // `macd: 34`, not 35. The MACD LINE draws from 26 bars but the SIGNAL needs nine more of it, so the
  // study is complete at 26 + 8 = 34. The old 35 was a bar pessimistic, found by asserting that one bar
  // short really is incomplete. `vwap: 1` was missing entirely, so it reported "drew fine" regardless.
  sma20: 20, sma50: 50, sma200: 200, ema21: 21, bb: 20, rsi14: 15, macd: 34, vwap: 1,
  donchian: 21, keltner: 21, supertrend: 12, psar: 3, pivots: 2,
  // `ichimoku: 78`, not 52. Senkou B is the 52-bar midpoint displaced 26 bars FORWARD, so the first one
  // that lands on a real bar needs 52 + 26. At 52 bars the cloud's slower edge is simply absent, and the
  // declared 52 would have reported it as drawn.
  ichimoku: 78,
  // `stoch: 18`, not 16. %K needs 14 bars plus the 3-bar smoothing; %D then needs three of those %K
  // values, so the pair is complete at 18. At 16 there is a %K and no %D.
  atrPct: 15, adx: 29, stoch: 18, williams: 14, cci: 20, mfi: 15, obv: 2, roc: 13,
};
