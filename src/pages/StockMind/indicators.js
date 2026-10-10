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

/**
 * ABSENT IS NOT ZERO, and in this module zero is not a period at all (Section 123).
 *
 * `Number(null) === 0` has shipped as a defect three times — `modelRoles` (Section 112), an explicit lot
 * size swallowed by `int(s.get("lotSize") or 1)` (Section 115), and `clampPxPerBar(null)` returning a
 * one-pixel smear (Section 122). Every period here has a floor of at least 1, so a missing, blank or
 * unparseable value must fall back to THE STUDY'S OWN LITERAL — never to zero, which would read as "no
 * smoothing", and never to the minimum, which would silently become a different indicator.
 *
 * A form field hands back a STRING, so '20' is honoured. An object, an array, a boolean and 'abc' are
 * not numbers at all and therefore mean exactly what `undefined` means: use the default.
 */
function numParam(v, fallback, min, max) {
  const n = typeof v === 'number' ? v
    : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** A whole-bar count. Clamped first, then rounded, so a value just under the floor still lands ON it. */
export function intParam(v, fallback, min, max) {
  return Math.round(numParam(v, fallback, min, max));
}

/** A multiplier, where a fraction is the point. */
export function floatParam(v, fallback, min, max) {
  return numParam(v, fallback, min, max);
}

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
 * PARAMETER RANGES, NAMED ONCE AND READ TWICE — by the schema the input field offers and by the clamp
 * inside `make`. Two independent copies of a bound is how a field comes to offer a period the arithmetic
 * then quietly refuses, so there is one copy of each.
 *
 * The floors are per study family rather than global: a one-bar SMA is legal and pointless, a one-bar RSI
 * divides by a zero-length window, and a σ multiplier is a float where every period here is an integer.
 * The ceilings are where the study stops being readable rather than where the maths breaks — except
 * ADX's, which is lower because its own requirement is 2n+1 bars.
 */
const SPAN = { min: 1, max: 500 };        // a lookback where a single bar is legal, if useless
const WINDOW = { min: 2, max: 500 };      // a lookback that needs two bars to mean anything
const SMOOTH = { min: 1, max: 50 };       // a smoothing pass over an already-computed series
const MULT = { min: 0.1, max: 10 };       // a σ or ATR multiplier — the one float among them
const CYCLE = { min: 2, max: 300 };       // Ichimoku's three nested lookbacks
const TREND = { min: 2, max: 200 };       // ADX: 2n+1 bars, so the ceiling is half the others'
const MACD_FAST = { min: 1, max: 200 };
const MACD_SLOW = { min: 2, max: 400 };

/**
 * The overlay catalogue. `pane: 'oscillator'` needs its own scale — a 0–100 series on a 24,000-point
 * index axis renders as a flat line along the bottom, which is a classic chart bug.
 *
 * EVERY PERIOD IS MASTER'S TO SET (Section 123), and the three properties that make that work are here
 * rather than in a parallel table: `params` is what the menu offers, `need` is how many bars the study
 * wants AT THOSE PARAMETERS, and `labelOf` is what it is called once they change. `make`'s second
 * argument is optional and its fallback IS the literal the study shipped with, so `def.make(candles)` —
 * the call every existing site makes — is value-identical to before. That is asserted, not assumed:
 * `verifyIndicators.mjs` deep-compares `make(bars)` against `make(bars, defaultsFor(id))` for all 22.
 */
export const OVERLAY_DEFS = [
  { id: 'sma20',  label: 'SMA 20',  pane: 'price', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...SPAN, step: 1, default: 20 }],
    need: (p) => p.period, labelOf: (p) => `SMA ${p.period}`,
    make: (b, p) => sma(b, intParam(p?.period, 20, SPAN.min, SPAN.max)) },
  { id: 'sma50',  label: 'SMA 50',  pane: 'price', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...SPAN, step: 1, default: 50 }],
    need: (p) => p.period, labelOf: (p) => `SMA ${p.period}`,
    make: (b, p) => sma(b, intParam(p?.period, 50, SPAN.min, SPAN.max)) },
  { id: 'sma200', label: 'SMA 200', pane: 'price', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...SPAN, step: 1, default: 200 }],
    need: (p) => p.period, labelOf: (p) => `SMA ${p.period}`,
    make: (b, p) => sma(b, intParam(p?.period, 200, SPAN.min, SPAN.max)) },
  { id: 'ema21',  label: 'EMA 21',  pane: 'price', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...SPAN, step: 1, default: 21 }],
    need: (p) => p.period, labelOf: (p) => `EMA ${p.period}`,
    make: (b, p) => ema(b, intParam(p?.period, 21, SPAN.min, SPAN.max)) },
  { id: 'bb',     label: 'Bollinger 20,2', pane: 'price', kind: 'band',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...WINDOW, step: 1, default: 20 },
      { key: 'mult', label: 'σ mult', kind: 'float', ...MULT, step: 0.1, default: 2 }],
    need: (p) => p.period, labelOf: (p) => `Bollinger ${p.period},${p.mult}`,
    make: (b, p) => bollinger(b, intParam(p?.period, 20, WINDOW.min, WINDOW.max),
      floatParam(p?.mult, 2, MULT.min, MULT.max)) },
  { id: 'vwap',   label: 'VWAP',    pane: 'price', kind: 'line', make: (b) => vwap(b),
    params: [], need: () => 1, intradayOnly: true },
  { id: 'rsi14',  label: 'RSI 14',  pane: 'oscillator', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...WINDOW, step: 1, default: 14 }],
    need: (p) => p.period + 1, labelOf: (p) => `RSI ${p.period}`,
    make: (b, p) => rsi(b, intParam(p?.period, 14, WINDOW.min, WINDOW.max)),
    scale: { min: 0, max: 100 }, guides: [30, 70] },
  { id: 'macd',   label: 'MACD',    pane: 'oscillator', kind: 'macd',
    params: [{ key: 'fast', label: 'Fast', kind: 'int', ...MACD_FAST, step: 1, default: 12 },
      { key: 'slow', label: 'Slow', kind: 'int', ...MACD_SLOW, step: 1, default: 26 },
      { key: 'signal', label: 'Signal', kind: 'int', ...SMOOTH, step: 1, default: 9 }],
    // The MACD LINE draws from `slow` bars, but the study is not complete until the SIGNAL has drawn —
    // which is `signal` more of them, less the bar they share.
    need: (p) => p.slow + p.signal - 1,
    labelOf: (p) => `MACD ${p.fast},${p.slow},${p.signal}`,
    make: (b, p) => macd(b, intParam(p?.fast, 12, MACD_FAST.min, MACD_FAST.max),
      intParam(p?.slow, 26, MACD_SLOW.min, MACD_SLOW.max),
      intParam(p?.signal, 9, SMOOTH.min, SMOOTH.max)) },
];

export const overlayById = (id) => OVERLAY_DEFS.find((o) => o.id === id) || null;

/**
 * A study's shipped parameters, frozen so a caller cannot edit the catalogue by reference.
 * @returns {Object} `{}` for a study with no parameters and for an unknown id.
 */
export function defaultsFor(id) {
  const def = overlayById(id);
  const out = {};
  for (const f of def?.params || []) out[f.key] = f.default;
  return Object.freeze(out);
}

/**
 * The defaults, overridden by whatever of `stored` is usable — and nothing else.
 *
 * THE STORE IS NOT TRUSTED. `rama.stockmind.chart` is master's own localStorage and can be stale from an
 * older build or hand-edited, so every value is run through the same clamp the input field uses. A period
 * of 0, of -5, of 1e9 or of 'twenty' cannot reach the arithmetic from here.
 */
export function resolveParams(id, stored) {
  const def = overlayById(id);
  const src = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
  const out = {};
  for (const f of def?.params || []) {
    out[f.key] = f.kind === 'float'
      ? floatParam(src[f.key], f.default, f.min, f.max)
      : intParam(src[f.key], f.default, f.min, f.max);
  }
  return Object.freeze(out);
}

/**
 * Bars this study needs AT THESE PARAMETERS.
 *
 * `OVERLAY_NEEDS` is the defaults row of this function, not the whole truth — a 200-period SMA raised to
 * 300 needs 300 bars, and a requirement that did not move with the setting would report "drew fine" on a
 * line that is drawing nothing.
 * @returns {number|null} null for an unknown id or a study that declares no requirement.
 */
export function needsFor(id, params) {
  const def = overlayById(id);
  if (!def || typeof def.need !== 'function') return null;
  return def.need(resolveParams(id, params));
}

/**
 * What the study is called once its parameters change — 'SMA 20' becomes 'SMA 50'.
 *
 * A LABEL THAT STILL READS 'SMA 20' WHILE A 50-PERIOD AVERAGE IS DRAWN IS WORSE THAN NO PARAMETER
 * EDITING AT ALL, because it is a wrong number that looks right. At defaults the shipped label is
 * returned verbatim rather than regenerated, so 'Bollinger 20,2' can never drift to 'Bollinger 20,2.0'
 * because a formatter rounded differently.
 */
export function labelFor(def, params) {
  const d = typeof def === 'string' ? overlayById(def) : def;
  if (!d) return '';
  if (typeof d.labelOf !== 'function') return d.label;
  const p = resolveParams(d.id, params);
  const dflt = defaultsFor(d.id);
  const unchanged = Object.keys(dflt).every((k) => p[k] === dflt[k]);
  return unchanged ? d.label : d.labelOf(p);
}

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
 *
 * `params` is OPTIONAL and omitting it means the shipped defaults, so the existing call sites need no
 * change. Supplied, both the requirement and the label move with it — a raised period that empties a line
 * must say so with the raised number, not the shipped one.
 * @returns {string|null} null when it drew fine.
 */
export function overlayShortfall(id, barCount, intradayInterval, params) {
  const def = overlayById(id);
  if (!def) return null;
  const label = labelFor(def, params);
  if (def.intradayOnly && !intradayInterval) {
    return `${label} is only meaningful on intraday bars — it resets each session.`;
  }
  if (def.dailyOnly && intradayInterval) {
    return `${label} is computed from the previous SESSION, so it needs daily or longer bars.`;
  }
  // A combination the arithmetic refuses outright, rather than one it can draw from more bars. MACD's own
  // guard returns nothing when the fast EMA is not faster than the slow one, and that silence is only
  // reachable now that master can set the two — so it is named here rather than left as an empty pane.
  const p = resolveParams(id, params);
  if (id === 'macd' && !(p.slow > p.fast)) {
    return `${label} needs its fast length BELOW its slow one — ${p.fast} and ${p.slow} describe no gap.`;
  }
  // Read from the study's own requirement rather than a literal here: a study added without one would
  // otherwise report "drew fine" while drawing nothing.
  const need = needsFor(id, params);
  if (need && barCount < need) {
    return `${label} needs ${need} bars and there are ${barCount}. `
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

// ── PRICE-INDEXED CHART TYPES: Renko, Line Break, Kagi, Point & Figure ───────
//
// WHAT MAKES THESE FOUR DIFFERENT FROM EVERY OTHER TYPE HERE, and it governs how they may be used:
// **they are indexed by PRICE MOVEMENT, not by time.** A Renko brick forms when price travels one
// brick, whether that takes four seconds or four sessions. So the x-axis of a Renko chart is NOT a
// clock, and three consequences follow that the renderer and the projection both have to respect:
//
//   1. Consecutive outputs can be minutes or weeks apart. Every function below therefore carries the
//      source bar's `time` on each output purely so a chart library can place it, and ALSO returns
//      `spanBars` — how many source bars that output consumed — because that is the honest measure of
//      how long it took. A reader who treats the spacing as uniform will misread the chart.
//   2. **The prices are DERIVED THRESHOLDS, not traded prices** — the same warning `heikinAshi`
//      carries. A brick top is "one brick above the last brick top", which may be a price that never
//      printed. A stop read off a brick edge is a stop at a fiction.
//   3. A FORWARD-IN-TIME projection is meaningless on them. See `chartProjection.projectionMode`,
//      which refuses all four for that reason rather than drawing a cone over an axis that is not a
//      clock.
//
// Every one is a pure function of stored bars: no network, no engine, no new dependency. That is why
// the competitive research put them in the free bucket — four chart types TradingView charges for,
// excluded even from the library edition several Indian brokers embed.

/** A positive finite size, or null. Shared by all four so one bad input behaves identically. */
function sizeOf(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Usable OHLC bars, in order, with the junk dropped. */
function cleanBars(bars) {
  return asBars(bars).filter((b) => finite(b?.open) && finite(b?.high)
    && finite(b?.low) && finite(b?.close));
}

/**
 * The Average True Range over `period` source bars, used only to SUGGEST a brick or box size.
 *
 * Offered because a fixed brick size in rupees is meaningless across symbols at different price
 * levels, and a suggestion derived from the series beats a constant someone guessed.
 *
 * @returns {number|null} null when there are too few bars to measure, never a fallback guess
 */
export function atrSize(bars, period = 14) {
  const src = cleanBars(bars);
  const p = Math.max(1, Math.floor(Number(period) || 14));
  if (src.length < p + 1) return null;
  let sum = 0;
  for (let i = src.length - p; i < src.length; i += 1) {
    const prev = src[i - 1];
    const b = src[i];
    sum += Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
  }
  const atr = sum / p;
  return atr > 0 ? atr : null;
}

/**
 * RENKO — fixed-size bricks, each one brick of price movement.
 *
 * A brick is appended only when the close has travelled a full `brick` from the last brick's close.
 * A REVERSAL COSTS TWO BRICKS, which is the rule most descriptions omit: to turn around, price must
 * travel back across the current brick and then one more. That is why a Renko chart suppresses noise,
 * and getting it wrong produces a chart that flips on every tick.
 *
 * @param {Array} bars source OHLC
 * @param {number} brick brick size in price
 * @returns {Array<{time, open, high, low, close, dir, spanBars}>} candle-shaped, `dir` +1/-1
 */
export function renko(bars, brick) {
  const size = sizeOf(brick);
  const src = cleanBars(bars);
  if (!size || src.length === 0) return [];

  const out = [];
  // `last` is the CLOSE of the most recent brick, anchored to a brick boundary so the grid does not
  // depend on where the data happens to start.
  //
  // TRACKING THE LAST CLOSE RATHER THAN A FLOATING BASE IS WHAT MAKES THE INNER LOOP TERMINATE. A
  // first version advanced a `base` to `close - size`, which is the same value it started from, so a
  // gap spun forever and the suite died with a V8 out-of-memory rather than a failed assertion. Every
  // branch below moves `last` by at least one brick TOWARDS the close that triggered it, and each
  // condition requires the close to be at least that far away — so the loop strictly converges.
  let last = Math.floor(src[0].close / size) * size;
  let dir = 0;
  let consumed = 0;

  for (const b of src) {
    consumed += 1;
    // A LOOP, because one source bar can complete several bricks in a gap or a fast move. Dropping
    // the extras would silently flatten exactly the moves this chart exists to show.
    for (;;) {
      if (dir >= 0 && b.close >= last + size) {
        const open = last;
        const close = last + size;
        out.push({ time: b.time, open, high: close, low: open, close, dir: 1, spanBars: consumed });
        last = close;
        dir = 1;
        consumed = 0;
      } else if (dir <= 0 && b.close <= last - size) {
        const open = last;
        const close = last - size;
        out.push({ time: b.time, open, high: open, low: close, close, dir: -1, spanBars: consumed });
        last = close;
        dir = -1;
        consumed = 0;
      } else if (dir > 0 && b.close <= last - 2 * size) {
        // A REVERSAL COSTS TWO BRICKS: back across the current brick, then one more.
        const open = last - size;
        const close = last - 2 * size;
        out.push({ time: b.time, open, high: open, low: close, close, dir: -1, spanBars: consumed });
        last = close;
        dir = -1;
        consumed = 0;
      } else if (dir < 0 && b.close >= last + 2 * size) {
        const open = last + size;
        const close = last + 2 * size;
        out.push({ time: b.time, open, high: close, low: open, close, dir: 1, spanBars: consumed });
        last = close;
        dir = 1;
        consumed = 0;
      } else break;
    }
  }
  return out;
}

/**
 * LINE BREAK — a new line only when the close breaks the extreme of the previous `lines` lines.
 *
 * Three-line break is the common setting and is the default. The rule is directional: to extend, beat
 * the last line's close; to REVERSE, beat the extreme of the last `lines` lines, which is what makes
 * a reversal rare.
 *
 * @returns {Array<{time, open, high, low, close, dir, spanBars}>}
 */
export function lineBreak(bars, lines = 3) {
  const src = cleanBars(bars);
  const n = Math.max(1, Math.floor(Number(lines) || 3));
  if (src.length === 0) return [];

  const out = [];
  let consumed = 0;
  for (const b of src) {
    consumed += 1;
    if (out.length === 0) {
      out.push({ time: b.time, open: b.open, high: Math.max(b.open, b.close),
        low: Math.min(b.open, b.close), close: b.close,
        dir: b.close >= b.open ? 1 : -1, spanBars: consumed });
      consumed = 0;
      continue;
    }
    const last = out[out.length - 1];
    const recent = out.slice(-n);
    const hi = Math.max(...recent.map((r) => Math.max(r.open, r.close)));
    const lo = Math.min(...recent.map((r) => Math.min(r.open, r.close)));

    let dir = 0;
    if (last.dir > 0) {
      if (b.close > last.close) dir = 1;
      else if (b.close < lo) dir = -1;
    } else {
      if (b.close < last.close) dir = -1;
      else if (b.close > hi) dir = 1;
    }
    if (dir === 0) continue;

    const open = last.close;
    out.push({ time: b.time, open, high: Math.max(open, b.close), low: Math.min(open, b.close),
      close: b.close, dir, spanBars: consumed });
    consumed = 0;
  }
  return out;
}

/**
 * KAGI — one continuous line that reverses only after `reversal` of adverse movement.
 *
 * `thick` is the yang/yin distinction and it is the whole point of a Kagi chart: the line thickens
 * when it breaks the previous shoulder and thins when it breaks the previous waist. Returned as a
 * flag per segment rather than as a colour, because a pure function has no business choosing one.
 *
 * @returns {Array<{time, price, dir, thick, spanBars}>} a polyline, NOT candles
 */
export function kagi(bars, reversal) {
  const size = sizeOf(reversal);
  const src = cleanBars(bars);
  if (!size || src.length === 0) return [];

  const out = [{ time: src[0].time, price: src[0].close, dir: 0, thick: false, spanBars: 1 }];
  let dir = 0;
  let extreme = src[0].close;
  let shoulder = src[0].close;
  let thick = false;
  let consumed = 0;

  for (let i = 1; i < src.length; i += 1) {
    const c = src[i].close;
    consumed += 1;
    if (dir >= 0 && c > extreme) {
      extreme = c;
      if (c > shoulder) thick = true;
    } else if (dir <= 0 && c < extreme) {
      extreme = c;
      if (c < shoulder) thick = false;
    } else if (dir >= 0 && c <= extreme - size) {
      shoulder = extreme;
      dir = -1;
      extreme = c;
    } else if (dir <= 0 && c >= extreme + size) {
      shoulder = extreme;
      dir = 1;
      extreme = c;
    } else continue;

    const prev = out[out.length - 1];
    if (prev.price === extreme && prev.dir === dir) {
      prev.spanBars += consumed;
    } else {
      out.push({ time: src[i].time, price: extreme, dir: dir || 1, thick, spanBars: consumed });
    }
    consumed = 0;
  }
  return out;
}

/**
 * POINT & FIGURE — columns of X (rising) and O (falling).
 *
 * `box` is the quantum and `reversal` is how many boxes against the column are needed to start a new
 * one; three is the classical setting. **A column records a RANGE of boxes, not a single price**, so
 * the output is per-column with `from`/`to` in boxes and in price — which is what a renderer needs to
 * draw a stack of marks rather than a line.
 *
 * @returns {Array<{time, mark, from, to, fromPrice, toPrice, boxes, spanBars}>}
 */
export function pointAndFigure(bars, box, reversal = 3) {
  const size = sizeOf(box);
  const rev = Math.max(1, Math.floor(Number(reversal) || 3));
  const src = cleanBars(bars);
  if (!size || src.length === 0) return [];

  const lvl = (p) => Math.floor(p / size);
  const out = [];
  let mark = null;
  let from = lvl(src[0].close);
  let to = from;
  let consumed = 0;

  const flush = (time) => {
    if (mark === null) return;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    out.push({
      time, mark, from, to,
      fromPrice: lo * size, toPrice: (hi + 1) * size,
      boxes: hi - lo + 1, spanBars: consumed,
    });
    consumed = 0;
  };

  for (const b of src) {
    consumed += 1;
    // High then low within one source bar: the classical resolution of an ambiguous bar, declared
    // rather than left implicit, because the opposite order yields a different chart on the same data.
    const up = lvl(b.high);
    const down = lvl(b.low);
    if (mark === null) {
      if (up > from) { mark = 'X'; to = up; }
      else if (down < from) { mark = 'O'; to = down; }
      continue;
    }
    if (mark === 'X') {
      if (up > to) to = up;
      else if (down <= to - rev) {
        flush(b.time);
        from = to - 1;
        to = down;
        mark = 'O';
      }
    } else if (down < to) to = down;
    else if (up >= to + rev) {
      flush(b.time);
      from = to + 1;
      to = up;
      mark = 'X';
    }
  }
  flush(src[src.length - 1].time);
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
    params: [{ key: 'period', label: 'Period', kind: 'int', ...WINDOW, step: 1, default: 20 }],
    // +1 because the channel EXCLUDES the current bar, so it needs one bar more than its own window.
    need: (p) => p.period + 1, labelOf: (p) => `Donchian ${p.period}`,
    make: (b, p) => donchian(b, intParam(p?.period, 20, WINDOW.min, WINDOW.max)) },
  { id: 'keltner', label: 'Keltner 20,2×ATR20', pane: 'price', kind: 'band',
    params: [{ key: 'ema', label: 'EMA', kind: 'int', ...SPAN, step: 1, default: 20 },
      { key: 'atr', label: 'ATR', kind: 'int', ...SPAN, step: 1, default: 20 },
      { key: 'mult', label: 'ATR mult', kind: 'float', ...MULT, step: 0.1, default: 2 }],
    // Both legs must have drawn, and the ATR leg needs a previous close — hence the +1 on the longer.
    need: (p) => Math.max(p.ema, p.atr) + 1,
    labelOf: (p) => `Keltner ${p.ema},${p.mult}×ATR${p.atr}`,
    make: (b, p) => keltner(b, intParam(p?.ema, 20, SPAN.min, SPAN.max),
      intParam(p?.atr, 20, SPAN.min, SPAN.max), floatParam(p?.mult, 2, MULT.min, MULT.max)) },
  // `directionalSplit` says one of the two sides may legitimately be empty: a window where the trend
  // never flipped has no opposite-side stop to draw, and that is information rather than a shortfall.
  { id: 'supertrend', label: 'Supertrend 10,3', pane: 'price', kind: 'series', directionalSplit: true,
    params: [{ key: 'atr', label: 'ATR', kind: 'int', ...SPAN, step: 1, default: 10 },
      { key: 'mult', label: 'ATR mult', kind: 'float', ...MULT, step: 0.1, default: 3 }],
    need: (p) => p.atr + 2, labelOf: (p) => `Supertrend ${p.atr},${p.mult}`,
    make: (b, p) => {
      const st = supertrend(b, intParam(p?.atr, 10, SPAN.min, SPAN.max),
        floatParam(p?.mult, 3, MULT.min, MULT.max));
      return { series: [
        { data: st.up, label: 'Supertrend', color: 'var(--green)', width: 2 },
        { data: st.down, label: null, color: 'var(--red)', width: 2 },
      ] };
    } },
  // PSAR's acceleration factor and its ceiling are Wilder's own constants, not a window length, and a
  // chart that let them be nudged would invite master to tune a stop rule by eye. Left as shipped.
  { id: 'psar', label: 'Parabolic SAR', pane: 'price', kind: 'series', params: [], need: () => 3,
    make: (b) => ({ series: [{ data: psar(b), label: 'PSAR', dots: true, width: 1 }] }) },
  { id: 'ichimoku', label: 'Ichimoku 9,26,52', pane: 'price', kind: 'series',
    params: [{ key: 'tenkan', label: 'Tenkan', kind: 'int', ...CYCLE, step: 1, default: 9 },
      { key: 'kijun', label: 'Kijun', kind: 'int', ...CYCLE, step: 1, default: 26 },
      { key: 'senkouB', label: 'Senkou B', kind: 'int', ...CYCLE, step: 1, default: 52 }],
    // Senkou B is the slowest midpoint displaced FORWARD by the Kijun length, so the first one that
    // lands on a real bar needs both — 52 + 26 at the shipped settings.
    need: (p) => p.senkouB + p.kijun,
    labelOf: (p) => `Ichimoku ${p.tenkan},${p.kijun},${p.senkouB}`,
    make: (b, p) => {
      // THE DISPLACEMENT FOLLOWS KIJUN rather than being a fourth field. In Ichimoku the cloud is shifted
      // by the base period; a displacement set apart from it would draw a cloud of no defined indicator.
      const kijun = intParam(p?.kijun, 26, CYCLE.min, CYCLE.max);
      const i = ichimoku(b, intParam(p?.tenkan, 9, CYCLE.min, CYCLE.max), kijun,
        intParam(p?.senkouB, 52, CYCLE.min, CYCLE.max), kijun);
      return { series: [
        { data: i.tenkan, label: 'Tenkan', width: 1 },
        { data: i.kijun, label: 'Kijun', width: 2 },
        { data: i.senkouA, label: 'Senkou A', dashed: true },
        { data: i.senkouB, label: 'Senkou B', dashed: true },
        { data: i.chikou, label: 'Chikou', dotted: true },
      ] };
    } },
  // Floor-trader pivots are the previous bar's own high, low and close. There is nothing to set.
  { id: 'pivots', label: 'Pivots (prev bar)', pane: 'price', kind: 'series', dailyOnly: true,
    params: [], need: () => 2,
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
    params: [{ key: 'period', label: 'Period', kind: 'int', ...SPAN, step: 1, default: 14 }],
    // +1 because a true range needs a previous close, so the first bar never reports.
    need: (p) => p.period + 1, labelOf: (p) => `ATR% ${p.period}`,
    make: (b, p) => atrPct(b, intParam(p?.period, 14, SPAN.min, SPAN.max)) },
  { id: 'adx', label: 'ADX 14 +DI −DI', pane: 'oscillator', kind: 'series',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...TREND, step: 1, default: 14 }],
    // Wilder smooths twice: once into the DI pair, again into ADX itself — hence 2n, plus the bar the
    // first true range consumes.
    need: (p) => p.period * 2 + 1, labelOf: (p) => `ADX ${p.period} +DI −DI`,
    make: (b, p) => {
      const a = adx(b, intParam(p?.period, 14, TREND.min, TREND.max));
      return { series: [
        { data: a.adx, label: 'ADX', width: 2 },
        { data: a.plusDI, label: '+DI', color: 'var(--green)' },
        { data: a.minusDI, label: '−DI', color: 'var(--red)' },
      ], guides: [25] };
    } },
  { id: 'stoch', label: 'Stochastic 14,3,3', pane: 'oscillator', kind: 'series',
    params: [{ key: 'k', label: '%K', kind: 'int', ...WINDOW, step: 1, default: 14 },
      { key: 'smoothK', label: 'Smooth', kind: 'int', ...SMOOTH, step: 1, default: 3 },
      { key: 'd', label: '%D', kind: 'int', ...SMOOTH, step: 1, default: 3 }],
    // Three windows in series, each sharing its first bar with the one before: k + smoothK + d − 2.
    need: (p) => p.k + p.smoothK + p.d - 2,
    labelOf: (p) => `Stochastic ${p.k},${p.smoothK},${p.d}`,
    make: (b, p) => {
      const s = stochastic(b, intParam(p?.k, 14, WINDOW.min, WINDOW.max),
        intParam(p?.d, 3, SMOOTH.min, SMOOTH.max), intParam(p?.smoothK, 3, SMOOTH.min, SMOOTH.max));
      return { series: [
        { data: s.k, label: '%K', width: 2 },
        { data: s.d, label: '%D', color: 'var(--amber)' },
      ], guides: [20, 80], scale: { min: 0, max: 100 } };
    } },
  { id: 'williams', label: 'Williams %R 14', pane: 'oscillator', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...WINDOW, step: 1, default: 14 }],
    need: (p) => p.period, labelOf: (p) => `Williams %R ${p.period}`,
    make: (b, p) => williamsR(b, intParam(p?.period, 14, WINDOW.min, WINDOW.max)),
    scale: { min: -100, max: 0 }, guides: [-80, -20] },
  { id: 'cci', label: 'CCI 20', pane: 'oscillator', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...WINDOW, step: 1, default: 20 }],
    need: (p) => p.period, labelOf: (p) => `CCI ${p.period}`,
    make: (b, p) => cci(b, intParam(p?.period, 20, WINDOW.min, WINDOW.max)), guides: [-100, 100] },
  { id: 'mfi', label: 'MFI 14', pane: 'oscillator', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...WINDOW, step: 1, default: 14 }],
    // +1 because the flow of a bar is signed by the previous bar's typical price.
    need: (p) => p.period + 1, labelOf: (p) => `MFI ${p.period}`,
    make: (b, p) => mfi(b, intParam(p?.period, 14, WINDOW.min, WINDOW.max)),
    scale: { min: 0, max: 100 }, guides: [20, 80] },
  // OBV is a running total of every bar there is. It has no window to set.
  { id: 'obv', label: 'OBV', pane: 'oscillator', kind: 'line', params: [], need: () => 2,
    make: (b) => obv(b) },
  { id: 'roc', label: 'ROC 12', pane: 'oscillator', kind: 'line',
    params: [{ key: 'period', label: 'Period', kind: 'int', ...SPAN, step: 1, default: 12 }],
    // +1 because the rate is measured against the bar `period` back, which must itself exist.
    need: (p) => p.period + 1, labelOf: (p) => `ROC ${p.period}`,
    make: (b, p) => roc(b, intParam(p?.period, 12, SPAN.min, SPAN.max)), guides: [0] },
);

/**
 * Bars per study before it can draw anything, so an empty toggle is never a mystery.
 *
 * Kept beside the definitions rather than inside `overlayShortfall`'s literal, because a study added
 * without a requirement here reports "drew fine" while drawing nothing.
 *
 * SINCE SECTION 123 THIS IS THE DEFAULTS ROW OF `needsFor`, NOT THE WHOLE TRUTH — periods are master's to
 * set and the requirement moves with them. It stays exported and exact because the three corrections
 * recorded below were each earned by measurement, and `verifyIndicators.mjs` pins every `need` formula
 * against this table at defaults rather than against a copied number.
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
