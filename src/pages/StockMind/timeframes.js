/**
 * timeframes.js — the one place that knows which (interval, range) pairs a provider can serve.
 *
 * WHY THIS EXISTS (spec Section 101). The chart offered two intervals, `1d` and `60m`, beside a
 * free-text bar count. Master asked for "1 minute to 1 month/6 months/1 year". The engine could
 * already do it — `store.INTRADAY_INTERVALS` holds nine intervals, `providers.INTRADAY_RANGE`
 * holds measured per-interval caps, and the daily branch passes any interval straight through —
 * so the limit was entirely in the dropdown.
 *
 * But interval and lookback are NOT independent. Yahoo caps intraday windows server-side and
 * answers an over-deep request with HTTP 422, which arrives at the UI as "no bars" — the same
 * thing a misspelt symbol produces. So "1m over 3 years", which is a reasonable sentence in
 * English, must not be an offerable combination: it would promise depth no free provider serves
 * and then fail in a way that looks like a broken symbol.
 *
 * A timeframe is therefore a PAIR — the bar interval and how far back to look — which is the same
 * unit Section 74 locked for horizons, applied to the chart.
 *
 * THIS TABLE IS A DUPLICATE OF `ai_backend/engine/providers.py` `INTRADAY_RANGE`, DELIBERATELY.
 * Two alternatives were rejected. Serving the matrix from the engine makes the control unrenderable
 * exactly when the engine is down, which is when master most needs to see what is on offer. Leaving
 * the renderer permissive and letting the 422 teach it turns a provider limit into an unexplained
 * empty chart. The duplication is real, so `scripts/verifyTimeframes.mjs` parses the Python and
 * fails the suite if the two ever disagree.
 */

// One NSE/BSE session is 09:15–15:30 = 375 minutes. Every bar span below is expressed in SESSION
// minutes rather than wall-clock minutes, which is what makes one division work for every
// interval: a daily bar spans one session, a weekly bar five, a monthly bar twenty-one.
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
 * The deepest window each interval can actually be served over, in trading sessions.
 *
 * Measured, not assumed — these are Section 73's figures, restated here in sessions so they can be
 * compared against `RANGES`:
 *   1m, 2m -> 5d | 5m, 15m, 30m -> 1mo | 60m -> 2y | 1d and coarser -> whatever exists
 * `null` means no provider-side cap; the real limit is then how much history the instrument has.
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

// Below this, a chart is a table with axes. This is a DISPLAY floor and is deliberately lower than
// the engine's 20-bar floor for computation (`ohlcv_to_df`, `providers.fetch_history`): master asked
// to see a year of monthly bars, which is twelve, and refusing to draw twelve candles because a
// model could not be fitted on them would confuse two different questions.
export const MIN_USEFUL_BARS = 10;

// MAX is unbounded at the provider but not over IPC: every bar crosses a process boundary and then
// becomes a canvas point. NIFTY's full daily history is ~4,650 bars, so this is roughly four times
// the deepest series that exists and still bounds the payload.
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
 * The ranges worth offering for an interval: deep enough to draw, shallow enough to be served.
 *
 * Both ends matter. `1mo` bars over `1D` is one bar — technically valid, visually nothing. `1m`
 * bars over `1Y` is 94,500 bars Yahoo will refuse with a 422 that reads as an empty symbol.
 */
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
 * Keep a range valid across an interval change, without silently jumping somewhere unrelated.
 *
 * Switching 1d/1Y to 5m cannot keep 1Y. It falls to the deepest range 5m can serve rather than to
 * that interval's cosmetic default, because master's expressed intent was "as much as possible".
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

/**
 * The sentence printed under the control, so a missing range reads as a provider limit rather than
 * as something Rāma declined to do.
 * @returns {string|null} null when there is nothing to explain.
 */
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

/** Is a bar interval fine enough that the time axis should show a clock? */
export function showsClock(intervalId) {
  const iv = interval(intervalId);
  return !!iv && iv.intraday;
}

/**
 * Bar intervals grouped for a segmented control, in the order a trading platform shows them.
 * @returns {Array<{group: string, items: Array}>}
 */
export function intervalGroups() {
  const order = ['MINUTES', 'HOURS', 'DAYS'];
  return order.map((group) => ({
    group,
    items: INTERVALS.filter((iv) => iv.group === group),
  })).filter((g) => g.items.length > 0);
}
