/**
 * timeframes.js — which (interval, window) pairs a provider can actually serve (Sections 101, 105, 107).
 *
 * A timeframe is a PAIR: the bar interval and how far back to look. Section 74 locked that unit for
 * horizons; this applies it to the chart. Interval alone cannot say whether master wants three days of
 * 5m bars or a month of them.
 *
 * DUPLICATED FROM `providers.py` INTRADAY_RANGE, deliberately. Serving the matrix from the engine would
 * make the control unrenderable exactly when the engine is down — which is when master most needs to
 * see what is on offer. `scripts/verifyTimeframes.mjs` parses the Python and fails on drift.
 *
 * Master overrode the original "only offer servable pairs" rule (Section 107): every window is now
 * selectable, `allRangesFor` marks the unservable ones, and `shortfallNote` reports what arrived.
 */

// One NSE/BSE session is 09:15–15:30 = 375 minutes. Spans below are in SESSION minutes, not wall-clock,
// so one division works for every interval: daily spans one session, weekly five, monthly twenty-one.
export const SESSION_MINUTES = 375;

export const INTERVALS = [
  { id: '1m',  label: '1m',  group: 'MINUTES', span: 1,                     intraday: true },
  { id: '2m',  label: '2m',  group: 'MINUTES', span: 2,                     intraday: true },
  { id: '5m',  label: '5m',  group: 'MINUTES', span: 5,                     intraday: true },
  { id: '15m', label: '15m', group: 'MINUTES', span: 15,                    intraday: true },
  { id: '30m', label: '30m', group: 'MINUTES', span: 30,                    intraday: true },
  { id: '60m', label: '1H',  group: 'HOURS',   span: 60,                    intraday: true },
  { id: '1d',  label: '1D',  group: 'DAYS',    span: SESSION_MINUTES,       intraday: false },
  { id: '1wk', label: '1W',  group: 'DAYS',    span: SESSION_MINUTES * 5,   intraday: false },
  { id: '1mo', label: '1M',  group: 'DAYS',    span: SESSION_MINUTES * 21,  intraday: false },
];

// `sessions` is trading days, not calendar days: 21 a month, 252 a year. Calendar days would
// overstate every request by the weekends inside it.
export const RANGES = [
  { id: '1D',  label: '1D',  sessions: 1 },
  { id: '5D',  label: '5D',  sessions: 5 },
  { id: '1M',  label: '1M',  sessions: 21 },
  { id: '3M',  label: '3M',  sessions: 63 },
  { id: '6M',  label: '6M',  sessions: 126 },
  { id: '1Y',  label: '1Y',  sessions: 252 },
  { id: '2Y',  label: '2Y',  sessions: 504 },
  { id: '5Y',  label: '5Y',  sessions: 1260 },
  { id: '10Y', label: '10Y', sessions: 2520 },
  { id: 'MAX', label: 'MAX', sessions: null },   // everything the store holds
];

/**
 * Deepest window per interval, in trading sessions. Measured (Section 73), not assumed:
 *   1m, 2m -> 5d | 5m, 15m, 30m -> 1mo | 60m -> 2y | 1d and coarser -> whatever exists
 * `null` = no provider cap; the limit is then the instrument's own history.
 */
export const PROVIDER_CAP_SESSIONS = {
  '1m': 5, '2m': 5, '5m': 21, '15m': 21, '30m': 21, '60m': 504,
  '1d': null, '1wk': null, '1mo': null,
};

// The `range=` string Yahoo is actually sent for each intraday interval. Kept beside the session
// figures so the drift test can compare like with like rather than re-deriving them.
export const PROVIDER_RANGE_STRING = {
  '1m': '5d', '2m': '5d', '5m': '1mo', '15m': '1mo', '30m': '1mo', '60m': '2y',
};

// A DISPLAY floor, deliberately below the engine's 20-bar computation floor: a year of monthly bars is
// twelve, and refusing to draw twelve candles because a model could not be fitted confuses two questions.
export const MIN_USEFUL_BARS = 10;

// MAX is unbounded at the provider but not over IPC — every bar becomes a canvas point. NIFTY's full
// daily history is ~4,650 bars, so this bounds the payload without ever truncating a real series.
export const MAX_BARS = 20000;

const byId = (list, id) => list.find((x) => x.id === id) || null;

export const interval = (id) => byId(INTERVALS, id);
export const range = (id) => byId(RANGES, id);

/**
 * How many bars a (interval, range) pair asks for.
 * @returns {number} a bar count, clamped to MAX_BARS. MAX yields MAX_BARS.
 */
export function barsFor(intervalId, rangeId) {
  const iv = interval(intervalId);
  const rg = range(rangeId);
  if (!iv || !rg) return 0;
  if (rg.sessions === null) return MAX_BARS;
  const bars = Math.ceil((rg.sessions * SESSION_MINUTES) / iv.span);
  return Math.max(1, Math.min(MAX_BARS, bars));
}

/**
 * The provider's cap for an interval, expressed as a bar count rather than a window.
 * @returns {number|null} null when there is no provider-side cap.
 */
export function capBarsFor(intervalId) {
  const iv = interval(intervalId);
  if (!iv) return null;
  const cap = PROVIDER_CAP_SESSIONS[intervalId];
  if (cap == null) return null;
  return Math.ceil((cap * SESSION_MINUTES) / iv.span);
}

/**
 * Ranges deep enough to draw and shallow enough to be served. Both ends matter: `1mo` over `1D` is one
 * bar, and `1m` over `1Y` is 94,500 bars Yahoo refuses with a 422 that reads as an empty symbol.
 */
/**
 * EVERY range, flagged. Master's override of Section 101, which offered only servable pairs: the control
 * was refusing on his behalf. The honesty requirement moved rather than vanished — unservable windows
 * are MARKED and selectable, and `shortfallNote` reports what actually arrived.
 *
 * @returns {Array<{...range, beyondCap: boolean, capIsMax: boolean, tooFew: boolean, bars: number}>}
 */
export function allRangesFor(intervalId) {
  const iv = interval(intervalId);
  if (!iv) return [];
  const capSessions = PROVIDER_CAP_SESSIONS[intervalId];
  return RANGES.map((rg) => {
    const bars = barsFor(intervalId, rg.id);
    return {
      ...rg,
      bars,
      // MAX on a capped interval is not "beyond the cap", it is "as much as the cap allows" — which is
      // exactly what master asked to be able to select.
      beyondCap: capSessions != null && rg.sessions !== null && rg.sessions > capSessions,
      capIsMax: capSessions != null && rg.sessions === null,
      tooFew: rg.sessions !== null && bars < MIN_USEFUL_BARS,
    };
  });
}

/**
 * What to tell master when the provider served less than he asked for.
 *
 * @returns {string|null} null when the answer was complete enough to say nothing.
 */
export function shortfallNote(intervalId, requestedRangeId, barsReturned) {
  const iv = interval(intervalId);
  const rg = range(requestedRangeId);
  if (!iv || !rg || !Number.isFinite(barsReturned) || barsReturned <= 0) return null;
  const cap = capBarsFor(intervalId);
  if (cap == null) return null;
  const wanted = rg.sessions === null ? cap : barsFor(intervalId, requestedRangeId);
  if (wanted <= cap) return null;
  return `You asked for ${rg.label} of ${iv.label} bars. Free data for ${iv.label} reaches back about `
    + `${cap.toLocaleString()} bars, and ${barsReturned.toLocaleString()} arrived — so this is the `
    + 'deepest window the provider serves, not the one selected. The limit is theirs, not Rāma\'s.';
}

export function rangesFor(intervalId) {
  const iv = interval(intervalId);
  if (!iv) return [];
  const capSessions = PROVIDER_CAP_SESSIONS[intervalId];
  return RANGES.filter((rg) => {
    if (rg.sessions === null) {
      // MAX only means something where the provider has no window cap. Offering "MAX" for 5m
      // bars would suggest depth that stops at one month.
      return capSessions == null;
    }
    if (capSessions != null && rg.sessions > capSessions) return false;
    return barsFor(intervalId, rg.id) >= MIN_USEFUL_BARS;
  });
}

export function isAllowed(intervalId, rangeId) {
  return rangesFor(intervalId).some((rg) => rg.id === rangeId);
}

// What to show when master switches interval: the deepest range that is still legible, not the
// deepest available. A 10-year view of 1-hour bars is 3,500 candles in 700 pixels.
const PREFERRED_DEFAULT = {
  '1m': '1D', '2m': '1D', '5m': '5D', '15m': '1M', '30m': '1M',
  '60m': '3M', '1d': '1Y', '1wk': '5Y', '1mo': 'MAX',
};

export function defaultRangeFor(intervalId) {
  const allowed = rangesFor(intervalId);
  if (allowed.length === 0) return null;
  const wanted = PREFERRED_DEFAULT[intervalId];
  if (wanted && allowed.some((rg) => rg.id === wanted)) return wanted;
  return allowed[allowed.length - 1].id;
}

/**
 * Keep a range valid across an interval change. 1d/1Y switched to 5m falls to the deepest 5m serves,
 * not to that interval's cosmetic default — master's intent was "as much as possible".
 */
export function reconcileRange(intervalId, currentRangeId) {
  const allowed = rangesFor(intervalId);
  if (allowed.length === 0) return null;
  if (allowed.some((rg) => rg.id === currentRangeId)) return currentRangeId;
  const current = range(currentRangeId);
  if (!current) return defaultRangeFor(intervalId);
  // MAX, or anything deeper than the cap, becomes the deepest that is served.
  if (current.sessions === null) return allowed[allowed.length - 1].id;
  const deeperWanted = allowed.filter((rg) => rg.sessions !== null
    && rg.sessions <= current.sessions);
  return (deeperWanted[deeperWanted.length - 1] || allowed[0]).id;
}

/** So a missing range reads as a provider limit, not as something Rāma declined. Null when there is none. */
export function describeLimit(intervalId) {
  const iv = interval(intervalId);
  if (!iv) return null;
  const capSessions = PROVIDER_CAP_SESSIONS[intervalId];
  if (capSessions == null) return null;
  const window = PROVIDER_RANGE_STRING[intervalId];
  const cap = capBarsFor(intervalId);
  return `Free data for ${iv.label} bars reaches back ${window} — about ${cap.toLocaleString()} `
    + 'bars. Deeper windows are refused by the provider, not by Rāma.';
}

/**
 * A preset as the dates it covers (Section 105). The bar count was removed because it was interval ×
 * window restated, and three controls for two facts invited them to disagree.
 *
 * Calendar days out, trading sessions in — `RANGES` is in sessions because the provider caps are, so
 * the conversion uses the ~252-per-365 ratio plus three days of slack for weekends.
 *
 * @param {string} rangeId
 * @param {Date} [now] injectable, so expiry is testable without freezing the clock
 * @returns {{from: string, to: string}|null} `YYYY-MM-DD`; `from` is null for MAX
 */
export function datesForRange(rangeId, now = new Date()) {
  const rg = range(rangeId);
  if (!rg) return null;
  const to = toYmd(now);
  if (rg.sessions === null) return { from: null, to };
  // +3 days of slack so a window ending on a weekend or a holiday still contains the intended number
  // of sessions rather than falling a bar or two short.
  const calendarDays = Math.ceil((rg.sessions * 365) / 252) + 3;
  const start = new Date(now.getTime());
  start.setDate(start.getDate() - calendarDays);
  return { from: toYmd(start), to };
}

/** `YYYY-MM-DD` in local time — what `<input type="date">` expects and returns. */
export function toYmd(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/**
 * Which preset a pair of dates corresponds to, so a hand-typed range shows "custom" rather than leaving
 * a button lit that no longer describes the chart.
 * @returns {string|null} a range id, or null for custom
 */
export function rangeForDates(intervalId, from, to, now = new Date()) {
  if (!from && !to) return null;
  for (const rg of rangesFor(intervalId)) {
    const d = datesForRange(rg.id, now);
    if (!d) continue;
    if (d.from === (from || null) && d.to === (to || d.to)) return rg.id;
  }
  return null;
}

/** Payload ceiling for a date window. The count still exists; master no longer maintains it. */
export function limitForDates(intervalId, from, to) {
  const iv = interval(intervalId);
  if (!iv) return MAX_BARS;
  if (!from) return MAX_BARS;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return MAX_BARS;
  const days = Math.max(1, Math.round((b - a) / 86400000));
  const sessions = Math.ceil((days * 252) / 365) + 2;
  const bars = Math.ceil((sessions * SESSION_MINUTES) / iv.span);
  const cap = capBarsFor(intervalId);
  const ceiling = cap == null ? MAX_BARS : Math.min(MAX_BARS, cap);
  return Math.max(MIN_USEFUL_BARS, Math.min(ceiling, bars));
}

/** Is a bar interval fine enough that the time axis should show a clock? */
export function showsClock(intervalId) {
  const iv = interval(intervalId);
  return !!iv && iv.intraday;
}

/**
 * Bar intervals grouped for a segmented control, in the order a trading platform shows them.
 * @returns {Array<{group: string, items: Array}>}
 */
/**
 * Grouped by PURPOSE, not unit (Section 104). "Minutes/hours/days" is arithmetic; "intraday/swing/long
 * term" is the distinction a trader is making, and is how the platforms' own docs describe the clusters.
 * @returns {Array<{group: string, label: string, items: Array}>}
 */
export function intervalGroups() {
  const order = [
    { group: 'MINUTES', label: 'intraday' },
    { group: 'HOURS',   label: 'swing' },
    { group: 'DAYS',    label: 'long term' },
  ];
  return order.map(({ group, label }) => ({
    group,
    label,
    items: INTERVALS.filter((iv) => iv.group === group),
  })).filter((g) => g.items.length > 0);
}
