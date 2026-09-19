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

/** VWAP is withheld on daily rather than drawn wrong — a well-known name that does not mean what it says. */
export function overlaysFor(intradayInterval) {
  return OVERLAY_DEFS.filter((o) => !o.intradayOnly || intradayInterval);
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
  const NEED = { sma20: 20, sma50: 50, sma200: 200, ema21: 21, bb: 20, rsi14: 15, macd: 35 };
  const need = NEED[id];
  if (need && barCount < need) {
    return `${def.label} needs ${need} bars and there are ${barCount}. `
      + 'Widen the range, or choose a finer interval.';
  }
  return null;
}
