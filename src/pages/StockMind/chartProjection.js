/**
 * chartProjection.js — the projection drawn as BARS, in the chart type master selected.
 *
 * WHY THIS IS ARITHMETIC AND NOT A FORECAST. A projected bar has no open, high, low and close: those
 * four numbers are what a bar that actually traded left behind. What the engine returns for a future
 * bar is a DISTRIBUTION — `mid` and `sigmaPct`, the horizon sigma for that bar — plus the ±1σ and ±2σ
 * bounds it already computed from them. So the body here is the INTERQUARTILE RANGE of that same
 * distribution and the wicks are the engine's own ±2σ:
 *
 *   open  = q25 = mid·exp(−IQR_Z·s)      close = q75 = mid·exp(+IQR_Z·s)
 *   low   = point.lower2                 high  = point.upper2
 *   centre = point.mid — deliberately NOT in the bar
 *
 * A candle carries four values and the distribution needs five, so the centre stays the line the cone
 * already draws. `open` is ALWAYS the lower of the two, so a projected bar can never read as a down
 * bar — it is a range, and a range has no direction.
 *
 * WHY DERIVE RATHER THAN ASK THE ENGINE. For a lognormal spread the quartiles are mid·exp(±z·s) with
 * z = 0.6744897501960817, which is a restatement of a fact the engine already published under an
 * assumption it already states. Inventing a point-forecast OHLC would be dishonest, and here the
 * arithmetic is testable. Forward compatible rather than placeholder: a point carrying its own `q25`
 * and `q75` is PREFERRED and the row is marked `source: 'engine'`; derived rows are marked
 * `source: 'derived'`, and both branches are exercised by the suite.
 *
 * PURE AND SCREENLESS, like `chartEmptyState.js`: no callbacks in, no JSX out, and junk returns an
 * empty array rather than throwing, because every one of these runs inside a render.
 */

// The extensions are REQUIRED, not stylistic: `scripts/verifyChartProjection.mjs` imports this module
// under plain node, where ESM does no extension resolution.
import { toChartTime, timeTypesMatch } from './chartTime.js';
import { interval as intervalDef, SESSION_MINUTES } from './timeframes.js';

/**
 * The engine's own ceiling, duplicated here deliberately and pinned by a drift test.
 * `ai_backend/engine/projection.py` clamps to this and sets `capped`; the control must not offer a
 * horizon the engine will silently shorten. `verifyChartProjection.mjs` parses the Python and fails
 * on disagreement, the same precedent `verifyTimeframes.mjs` set against `providers.py`.
 */
export const MAX_BARS_AHEAD = 40;

/** The standard-normal quartile: Φ⁻¹(0.75). The body is ±this many sigma, the wicks ±2. */
export const IQR_Z = 0.6744897501960817;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/**
 * What a projection may be drawn AS on this chart type, and why.
 *
 * @param {string} chartType one of PriceChart's CHART_TYPES ids
 * @returns {{mode: 'quantile-candles'|'quantile-bars'|'path'|'refused', reason: string}}
 */
export function projectionMode(chartType) {
  const id = text(chartType);
  if (id === 'candles') {
    return {
      mode: 'quantile-candles',
      reason: 'the body is the interquartile range of the engine\'s own distribution and the wicks '
        + 'are its ±2σ bounds — hollow and single-hued, because a projected bar has no direction.',
    };
  }
  if (id === 'bars') {
    return {
      mode: 'quantile-bars',
      reason: 'thin single-hued OHLC bars over the same interquartile body, so they cannot be read '
        + 'as the thick green and red bars that actually traded.',
    };
  }
  if (id === 'heikin') {
    return {
      mode: 'refused',
      reason: 'refused on Heikin-Ashi: an HA open and close are averages of real bars, and each HA '
        + 'bar depends on the previous HA close, so a projected HA bar would be an average of a '
        + 'guess compounded forward. The cone\'s lines are still drawn.',
    };
  }
  // THE FOUR PRICE-INDEXED TYPES, REFUSED FOR A STRONGER REASON THAN HEIKIN-ASHI'S.
  //
  // Renko, Kagi, Point & Figure and Line Break advance on PRICE MOVEMENT, not on time: a brick forms
  // when price travels one brick, whether that takes four seconds or four sessions. **Their x-axis is
  // not a clock.** A cone is a statement about where price may be AFTER A GIVEN TIME, so drawing one
  // across these axes would invent a time dimension the chart does not have — and the horizon control
  // master types a period into would be meaningless against it.
  //
  // The band is still useful here, just not as a cone: `bandBoxes()` converts the same sigma edges
  // into a DISTANCE IN BRICKS, which is how these charts are read in the first place. The refusal is
  // therefore not a dead end, and the reason names the alternative instead of just saying no.
  if (id === 'renko' || id === 'kagi' || id === 'pnf' || id === 'linebreak') {
    return {
      mode: 'refused',
      reason: `refused on ${id}: this chart advances on price movement, not time, so its axis is not `
        + 'a clock and a forward cone would invent a time dimension it does not have. The same '
        + 'sigma edges are still available as a distance in bricks — see the band reading.',
    };
  }
  if (id === 'line' || id === 'area' || id === 'baseline') {
    return {
      mode: 'path',
      reason: 'the cone\'s centre line and its bands already are a centre path with a range, and a '
        + 'line chart has no body to put one in — so nothing extra is drawn.',
    };
  }
  return {
    mode: 'path',
    reason: `nothing extra is drawn: ${id || 'this chart type'} is not a type a projected bar has a `
      + 'shape on.',
  };
}

/**
 * The projection as bars for `setData`, or an empty array.
 *
 * @param {object|null} cone the engine's `cone` object, verbatim
 * @param {{chartType?: string, candleTime?: string|number}} [opts] `candleTime` is any chart time
 *   already on the canvas, used only to refuse a time-type mismatch
 * @returns {Array<{time: string|number, open: number, high: number, low: number, close: number,
 *   bar: number, sigmaPct: number, source: 'engine'|'derived'}>}
 */
export function quantileBars(cone, opts) {
  // An explicitly null `opts` skips a default parameter, and a render is exactly where that happens.
  const { chartType = 'candles', candleTime } = (opts && typeof opts === 'object') ? opts : {};
  const { mode } = projectionMode(chartType);
  if (mode !== 'quantile-candles' && mode !== 'quantile-bars') return [];
  if (!cone || typeof cone !== 'object' || cone.ok !== true) return [];
  const points = Array.isArray(cone.points) ? cone.points : [];
  if (points.length === 0) return [];

  // ONE CHART HOLDS ONE TIME TYPE (Section 117). The cone effect already refuses to draw its lines on
  // a mismatch; these bars consume the same tested guard rather than holding a second opinion.
  const coneTime = toChartTime(points[0]?.time);
  if (!timeTypesMatch(candleTime, coneTime)) return [];

  const out = [];
  for (const p of points) {
    if (!p || typeof p !== 'object') continue;
    const time = toChartTime(p.time);
    if (time === null) continue;
    if (!timeTypesMatch(candleTime, time)) continue;
    const mid = Number(p.mid);
    const sigmaPct = Number(p.sigmaPct);
    if (!finite(mid) || mid <= 0 || !finite(sigmaPct) || sigmaPct <= 0) continue;
    const s = sigmaPct / 100;

    // A future engine's own quartiles outrank ours. Both have to be present and the right way round:
    // half a pair, or a pair that disagrees about which is the upper, is not a distribution.
    const hasEngineQuartiles = finite(Number(p.q25)) && finite(Number(p.q75))
      && Number(p.q25) < Number(p.q75);
    const q25 = hasEngineQuartiles ? Number(p.q25) : mid * Math.exp(-IQR_Z * s);
    const q75 = hasEngineQuartiles ? Number(p.q75) : mid * Math.exp(IQR_Z * s);

    // The ±2σ bounds are the engine's, verbatim. The fallback exists only for a reply that omitted
    // them, and it is the same expression the engine uses.
    const high = finite(Number(p.upper2)) ? Number(p.upper2) : mid * Math.exp(2 * s);
    const low = finite(Number(p.lower2)) ? Number(p.lower2) : mid * Math.exp(-2 * s);

    if (![q25, q75, high, low].every(finite)) continue;
    // A body outside its own wicks is not a drawable bar. Asserted numerically rather than reasoned
    // about, because a future engine's quartiles are not under this module's control.
    if (!(low < q25 && q25 < q75 && q75 < high)) continue;

    out.push({
      time,
      open: q25,          // ALWAYS the lower value — a projected bar must never read as a down bar
      high,
      low,
      close: q75,
      bar: finite(Number(p.bar)) ? Number(p.bar) : out.length + 1,
      sigmaPct,
      source: hasEngineQuartiles ? 'engine' : 'derived',
    });
  }
  return out;
}

/**
 * Why the entitlement reads as it does, naming both intervals when that is the cause.
 *
 * The mismatch sentence is composed here rather than taken from the engine's `why` because the
 * renderer has to be able to say WHICH two intervals disagree even when the reply words it loosely.
 */
function entitlementSentence(entitlement) {
  const ent = (entitlement && typeof entitlement === 'object') ? entitlement : null;
  const mismatch = (ent?.intervalMismatch && typeof ent.intervalMismatch === 'object')
    ? ent.intervalMismatch : null;
  if (mismatch) {
    const asked = text(mismatch.asked) || 'the interval asked for';
    const fittedOn = text(mismatch.fittedOn) || 'another interval';
    return `no model is fitted on ${asked} bars — the fitted horizon uses ${fittedOn} bars — so the `
      + `centre stays flat. The width is still measured on ${asked} bars and is unaffected.`;
  }
  const reason = text(ent?.reason);
  if (reason) return reason;
  if (ent?.entitled === true) return 'a model cleared the acceptance gate for this horizon.';
  return 'the reply did not say whether a model is entitled on this horizon, so none is assumed.';
}

/**
 * The projection's own state, composed where a suite can read it.
 *
 * THE BADGE PRINTS A CLASS, NEVER A CONFIDENCE (spec 123.5 item 8). `electron/lib/claimGate.cjs` fixes
 * the vocabulary at grounded | reflex | prose | unattributed: a cone is `reflex` — measured volatility
 * over a stated lookback — and a tilted centre is additionally MODAL, which the gate admits only when
 * it cites a reflex projection record. No percentage appears in anything returned here.
 *
 * @param {object|null} cone the engine's `cone`
 * @param {{entitlement?: object, horizon?: object, caveat?: string}|null} meta the sibling objects of
 *   the forecast reply, which `StockMind.jsx` used to discard
 * @param {{chartType?: string, interval?: string}} [opts]
 */
export function projectionState(cone, meta, opts) {
  const { chartType = 'candles', interval = null } = (opts && typeof opts === 'object') ? opts : {};
  const c = (cone && typeof cone === 'object') ? cone : {};
  const m = (meta && typeof meta === 'object') ? meta : {};
  const horizon = (m.horizon && typeof m.horizon === 'object') ? m.horizon : {};
  const entitlement = (m.entitlement && typeof m.entitlement === 'object') ? m.entitlement : null;
  const { mode, reason: modeReason } = projectionMode(chartType);

  const tilted = c.tilted === true;
  const maxBarsAhead = finite(Number(c.maxBarsAhead)) && Number(c.maxBarsAhead) > 0
    ? Number(c.maxBarsAhead) : MAX_BARS_AHEAD;
  const barsAhead = finite(Number(c.barsAhead)) ? Number(c.barsAhead)
    : (Array.isArray(c.points) ? c.points.length : null);
  // What master ASKED for, which is the number a clamp has to be able to name. `requestedBars` is on
  // the engine's wish list; until it arrives, the horizon's `measuredBars` is the pre-clamp request.
  const requestedBars = finite(Number(c.requestedBars)) ? Number(c.requestedBars)
    : (finite(Number(horizon.measuredBars)) ? Number(horizon.measuredBars) : null);
  const measuredInterval = text(horizon.measuredInterval) || text(c.interval) || null;
  const chartInterval = text(interval) || null;
  const measuredBars = finite(Number(horizon.measuredBars)) ? Number(horizon.measuredBars) : null;
  const entitled = entitlement?.entitled === true;

  const intervalMatches = !measuredInterval || !chartInterval
    ? true : measuredInterval === chartInterval;

  const parts = [`reflex:projection${tilted ? ' · modal' : ''}`];
  if (finite(barsAhead)) parts.push(`${barsAhead} of ${maxBarsAhead} bars ahead`);
  parts.push(measuredInterval ? `measured on ${measuredInterval} bars`
    : 'the reply did not name the interval it measured');
  parts.push(tilted ? 'centre tilted by an entitled model' : 'centre flat');
  if (!intervalMatches) {
    parts.push(`the chart is showing ${chartInterval}, so this cone describes other bars`);
  }
  if (c.capped === true) parts.push(`clamped to the engine's ${maxBarsAhead}-bar ceiling`);

  return {
    classLabel: 'reflex',
    cite: 'reflex:projection',
    modal: tilted,
    tilted,
    tiltReason: text(c.tiltReason) || null,
    entitled,
    entitlementReason: entitlementSentence(entitlement),
    measuredInterval,
    chartInterval,
    intervalMatches,
    measuredBars,
    barsAhead: finite(barsAhead) ? barsAhead : null,
    maxBarsAhead,
    capped: c.capped === true,
    requestedBars,
    mode,
    modeReason,
    text: `${parts.join(' · ')}.`,
  };
}

/**
 * Which classes of fact fed this projection, and which did not.
 *
 * ABSENT IS SAID AS ABSENT. Reporting news or derivatives as "neutral" would claim they were read and
 * found to say nothing; they are not inputs to a volatility cone at all, and that is a different
 * statement. A future engine sending its own `inputs` ledger outranks this inference.
 *
 * @returns {Array<{id: string, label: string, used: boolean, text: string}>}
 */
export function projectionInputs(cone, meta) {
  const c = (cone && typeof cone === 'object') ? cone : {};
  if (Array.isArray(c.inputs)) {
    const rows = c.inputs
      .filter((r) => r && typeof r === 'object' && text(r.id) && text(r.text))
      .map((r) => ({
        id: text(r.id),
        label: text(r.label) || text(r.id),
        used: r.used === true,
        text: text(r.text),
      }));
    if (rows.length > 0) return rows;
  }

  const vol = (c.volatility && typeof c.volatility === 'object') ? c.volatility : {};
  const m = (meta && typeof meta === 'object') ? meta : {};
  const entitlement = (m.entitlement && typeof m.entitlement === 'object') ? m.entitlement : null;
  const tilted = c.tilted === true;
  const rows = [];

  const lastClose = finite(Number(vol.lastClose)) ? Number(vol.lastClose) : null;
  const barRows = finite(Number(vol.rows)) ? Number(vol.rows) : null;
  const asOf = text(vol.asOf);
  rows.push({
    id: 'price',
    label: 'price',
    used: lastClose !== null,
    text: lastClose !== null
      ? `used — anchored on the last stored close ${lastClose}`
        + `${asOf ? ` as of ${asOf}` : ''}${barRows !== null ? `, from ${barRows} stored bars` : ''}.`
      : 'absent — no stored close was reported, so the cone has no anchor.',
  });

  const sigmaPct = finite(Number(vol.sigmaPct)) ? Number(vol.sigmaPct) : null;
  const atrPct = finite(Number(vol.atrPct)) ? Number(vol.atrPct) : null;
  const lookback = finite(Number(vol.lookback)) ? Number(vol.lookback) : null;
  rows.push({
    id: 'volatility',
    label: 'volatility',
    used: sigmaPct !== null,
    text: sigmaPct !== null
      ? `used — realised sigma ${sigmaPct}% per bar${atrPct !== null ? `, ATR ${atrPct}%` : ''}`
        + `${lookback !== null ? `, measured over a ${lookback}-bar lookback` : ''}. `
        + 'This is the whole of the cone\'s width.'
      : 'absent — volatility could not be measured, so no width was derived.',
  });

  rows.push({
    id: 'model',
    label: 'model',
    used: tilted,
    text: tilted
      ? `used — ${text(c.tiltReason) || 'an entitled model moved the centre off flat'}.`
      : `absent — ${entitlement?.entitled === true
        ? 'no probability was supplied, so nothing moved the centre'
        : 'no model is entitled on this horizon, so none moved the centre'}.`,
  });

  for (const [id, label] of [['news', 'news'], ['macro', 'macro'], ['derivatives', 'derivatives']]) {
    rows.push({
      id,
      label,
      used: false,
      text: 'absent — not an input to this projection.',
    });
  }
  return rows;
}

/** A bar count as a span of time, in the unit the interval is actually read in. */
function spanLabel(bars, iv) {
  const minutes = bars * iv.span;
  if (iv.intraday) {
    if (minutes < 60) return `${minutes} minutes`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
  }
  // Daily and coarser are counted in SESSIONS, because a calendar day is not a bar: a week of weekly
  // bars is five trading sessions however many days the calendar holds.
  const sessions = (bars * iv.span) / SESSION_MINUTES;
  const n = Number.isInteger(sessions) ? sessions : Number(sessions.toFixed(1));
  return `${n} trading session${n === 1 ? '' : 's'}`;
}

/**
 * The horizons the control offers, each labelled with what it is in time.
 *
 * Bar-count presets rather than named horizons, because the engine clamps a BAR COUNT and the cap is
 * the thing master has to be able to see. The last entry is the engine's ceiling and is marked.
 *
 * @param {string} intervalId
 * @returns {Array<{bars: number, label: string, span: string, title: string, atCap: boolean}>}
 */
/**
 * THE PROJECTION, READ IN BRICKS — how the cone combines with a price-indexed chart.
 *
 * `projectionMode` refuses a cone on Renko, Kagi, Point & Figure and Line Break because their axis is
 * not a clock. That refusal is correct and it would be a dead end if it stopped there, because the
 * engine's sigma bounds are **price levels**, and a price level translates into bricks perfectly well.
 *
 * So this answers the question those charts are actually read with: *how many bricks away is the edge
 * of the band?* A Point & Figure trader already thinks in boxes; "the 2σ edge is four boxes up" is the
 * native sentence, where "the 2σ edge is 24,310" is not.
 *
 * WHAT IT IS NOT. It is NOT a forward projection and says so: there is no claim about WHEN price might
 * reach a band edge, because the horizon that would answer that is a time and this chart has no time.
 * It converts a distance, nothing more. **`direction` is deliberately absent** — the band is
 * symmetric around the centre by construction, so naming a side would imply a lean the cone does not
 * have.
 *
 * `bricks` is ROUNDED DOWN, because the honest answer to "how many whole bricks fit in this distance"
 * never rounds up into a brick that has not been travelled.
 *
 * @param {object|null} cone the engine's `cone`, verbatim
 * @param {number} boxSize the brick or box size the chart is drawn with
 * @param {{at?: number}} [opts] the anchor price; defaults to the cone's last stored close
 * @returns {{ok: boolean, boxSize?: number, anchor?: number, edges?: Array<object>, why: string}}
 */
export function bandBoxes(cone, boxSize, opts) {
  const size = Number(boxSize);
  if (!finite(size) || size <= 0) {
    return { ok: false, why: 'a brick size is needed before a distance can be counted in bricks.' };
  }
  const c = (cone && typeof cone === 'object') ? cone : null;
  if (!c || c.ok !== true) {
    return { ok: false, why: 'no projection is available, so there is no band to measure.' };
  }
  const points = Array.isArray(c.points) ? c.points : [];
  if (points.length === 0) {
    return { ok: false, why: 'the projection carries no points, so it has no band edges.' };
  }

  const o = (opts && typeof opts === 'object') ? opts : {};
  const vol = (c.volatility && typeof c.volatility === 'object') ? c.volatility : {};
  const anchor = finite(Number(o.at)) ? Number(o.at)
    : (finite(Number(vol.lastClose)) ? Number(vol.lastClose) : null);
  if (anchor === null || anchor <= 0) {
    return { ok: false, why: 'no anchor price is known, so a distance cannot be measured from it.' };
  }

  // THE FAR END of the band is what a distance question is about — the widest the projection gets.
  const last = points[points.length - 1];
  const edges = [];
  for (const [key, label] of [['upper2', '+2σ'], ['upper1', '+1σ'], ['lower1', '−1σ'], ['lower2', '−2σ']]) {
    const px = Number(last?.[key]);
    if (!finite(px) || px <= 0) continue;
    const distance = Math.abs(px - anchor);
    edges.push({
      edge: label,
      price: px,
      distance,
      // FLOOR: whole bricks travelled, never a brick rounded up into existence.
      bricks: Math.floor(distance / size),
      // Stated so a reader is not left inferring it from the sign of a subtraction.
      above: px > anchor,
    });
  }
  if (edges.length === 0) {
    return { ok: false, why: 'the projection\'s final point carries no sigma bounds to measure.' };
  }

  return {
    ok: true,
    boxSize: size,
    anchor,
    edges,
    why: `measured from ${anchor} at the projection's far point, in bricks of ${size}. This is a `
      + 'DISTANCE, not a forecast: it says how far the band edges sit, and nothing about when or '
      + 'whether price reaches them.',
  };
}

/**
 * The horizon for a period MASTER CHOSE, in whatever unit he chose it in.
 *
 * `horizonChoices` offers four bar-count presets and stays, because a preset is one click. But a
 * preset list is not a period master selected, and the engine never required one: `projection.py`'s
 * `cone(bars_ahead=...)` takes any integer and clamps it itself at :165
 * (`n = max(1, min(int(bars_ahead or 1), MAX_BARS_AHEAD))`). **The fixed horizons were a renderer
 * limitation, not an engine one** — which is why this is additive and needs no engine change.
 *
 * A PERIOD IS CONVERTED TO BARS, NOT GUESSED AT. `minutes` and `hours` are wall-clock; `sessions` is
 * trading sessions, which is the only honest unit for daily and coarser bars because a calendar day
 * is not a bar. The conversion ROUNDS UP: asking for 90 minutes on a 15m chart is 6 bars, and asking
 * for 100 minutes is 7 — covering the period asked for rather than stopping short of it.
 *
 * WHAT IT REFUSES, rather than quietly fixing: a period that is not a positive finite number, and an
 * interval it cannot measure. A zero or negative horizon is not clamped up to 1, because "project
 * nothing" and "project one bar" are different requests and only one of them was made.
 *
 * THE CAP IS REPORTED, NEVER HIDDEN. Over 40 bars the result carries `capped: true`, the pre-clamp
 * `requestedBars`, and a `why` that names both numbers and the period actually covered — the same
 * contract `projectionState` already honours, so the existing cap sentence in `PriceChart.jsx` keeps
 * working without change.
 *
 * @param {{bars?: number, minutes?: number, hours?: number, sessions?: number}} want
 * @param {string} intervalId
 * @returns {{ok: boolean, bars: number|null, requestedBars: number|null, capped: boolean,
 *   span: string, label: string, why: string}}
 */
export function horizonFor(want, intervalId) {
  const refuse = (why) => ({
    ok: false, bars: null, requestedBars: null, capped: false, span: '', label: '', why,
  });

  const iv = intervalDef(text(intervalId));
  if (!iv || !finite(Number(iv.span)) || Number(iv.span) <= 0) {
    return refuse(`no bar span is known for ${text(intervalId) || 'this interval'}, so a period `
      + 'cannot be converted to bars.');
  }
  const w = (want && typeof want === 'object' && !Array.isArray(want)) ? want : {};

  // Exactly one unit, so an ambiguous request is refused rather than silently ranked.
  const given = ['bars', 'minutes', 'hours', 'sessions'].filter((k) => w[k] !== undefined && w[k] !== null);
  if (given.length === 0) return refuse('no period was given.');
  if (given.length > 1) {
    return refuse(`a period was given in ${given.length} units at once (${given.join(', ')}); `
      + 'name one.');
  }

  const unit = given[0];
  const value = Number(w[unit]);
  if (!finite(value) || value <= 0) {
    return refuse(`${unit} must be a positive number — ${JSON.stringify(w[unit])} is not a period.`);
  }

  // Minutes of wall-clock the request covers. SESSION_MINUTES is imported rather than restated, so a
  // session here is the same length `timeframes.js` uses everywhere else.
  let minutes;
  if (unit === 'bars') minutes = value * iv.span;
  else if (unit === 'minutes') minutes = value;
  else if (unit === 'hours') minutes = value * 60;
  else minutes = value * SESSION_MINUTES;

  const requestedBars = unit === 'bars' ? Math.ceil(value) : Math.ceil(minutes / iv.span);
  // DECLARED UNREACHABLE for any positive finite period, and asserted as such: rounding UP means
  // even a fraction of a bar covers to 1. Kept as defence against a future unit whose conversion
  // could yield zero — not as a live branch. A suite row that claimed this REFUSED went red.
  if (!finite(requestedBars) || requestedBars < 1) {
    return refuse(`that period is shorter than one ${iv.label} bar.`);
  }

  const bars = Math.min(requestedBars, MAX_BARS_AHEAD);
  const capped = requestedBars > MAX_BARS_AHEAD;
  const span = spanLabel(bars, iv);

  return {
    ok: true,
    bars,
    requestedBars,
    capped,
    span,
    label: `${bars} bars`,
    why: capped
      ? `${requestedBars} ${iv.label} bars is past the engine's ${MAX_BARS_AHEAD}-bar ceiling, so the `
        + `projection covers ${bars} bars — about ${span} — and stops there.`
      : `${bars} ${iv.label} bar${bars === 1 ? '' : 's'} ahead — about ${span}.`,
  };
}

export function horizonChoices(intervalId) {
  const iv = intervalDef(text(intervalId));
  if (!iv || !finite(Number(iv.span)) || Number(iv.span) <= 0) return [];
  const counts = [5, 10, 20, MAX_BARS_AHEAD]
    .filter((n) => finite(n) && n > 0 && n <= MAX_BARS_AHEAD)
    .filter((n, i, a) => a.indexOf(n) === i)
    .sort((a, b) => a - b);
  return counts.map((bars, i) => {
    const span = spanLabel(bars, iv);
    const atCap = i === counts.length - 1;
    return {
      bars,
      label: `${bars} bars`,
      span,
      title: `${bars} ${iv.label} bars ahead — about ${span}`
        + (atCap ? `. ${MAX_BARS_AHEAD} bars is the engine's ceiling; it will not project further.`
          : '.'),
      atCap,
    };
  });
}

export default quantileBars;
