/**
 * chartTime.js — one chart holds one time type, and this is the only place that decides which.
 *
 * WHY THIS IS ITS OWN MODULE. `toChartTime` lived inside `PriceChart.jsx` and produced TWO different
 * types: a `'YYYY-MM-DD'` string for daily bars and a UTC epoch NUMBER for intraday ones.
 * lightweight-charts cannot hold both on one chart, and that mismatch has now caused two separate
 * defects (Section 117):
 *
 *   1. THE PROJECTION. The cone was requested by named horizon, and only `60m` mapped to an intraday
 *      horizon — so a 30m chart drew 30m candles (numbers) against a cone measured on daily bars
 *      (strings). Section 110 made 30m the DEFAULT interval, so from that commit the projection failed
 *      every single time.
 *   2. MASTER'S FILLS. The ledger records a date with no time of day, so a fill is always a string —
 *      unplaceable on an intraday chart, and it would take the candles down with it.
 *
 * Two defects from one implicit rule is the definition of a rule that should be explicit and tested.
 * `scripts/verifyChartTime.mjs` asserts the behaviour; `PriceChart.jsx` imports rather than redefines.
 *
 * WHY THE TWO TYPES EXIST AT ALL, rather than normalising everything to epoch seconds: a
 * `'YYYY-MM-DD'` string tells lightweight-charts the point is a WHOLE DAY, which is what puts daily
 * bars on a business-day scale with no weekend gaps. Converting daily bars to epoch numbers would put
 * them on a continuous clock and reintroduce the weekend holes. The two types are correct; what was
 * missing was anything enforcing that one chart uses one of them.
 */

/**
 * A stored stamp as lightweight-charts wants it.
 *
 * @param {string} raw `'YYYY-MM-DD'` or `'YYYY-MM-DD HH:MM:SS'` (the store keeps intraday in UTC)
 * @returns {string|number|null} a date string for daily, epoch seconds for intraday, null if unusable
 */
export function toChartTime(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // A bare date is a whole day — but it has to BE a date. Length alone was the test, and
  // `'not a date'` is exactly ten characters, so junk was passed through to lightweight-charts as a
  // business day. Found by the suite, not on screen.
  const bare = s.slice(0, 10);
  if (s.length <= 10) return /^\d{4}-\d{2}-\d{2}$/.test(bare) ? bare : null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  // The store keeps intraday stamps in UTC, so an absent zone means UTC rather than local. Without the
  // appended 'Z' every bar would shift by the machine's offset — 5h30m in IST.
  const ms = Date.parse(iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Whether two chart times can coexist on one chart. */
export function timeTypesMatch(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return true;
  return typeof a === typeof b;
}

/**
 * The first stored bar of each session, keyed by date.
 *
 * Empty for a daily chart, because a daily chart needs no mapping — its times are already dates.
 *
 * @param {Array<{time: string|number}>} candles already converted by `toChartTime`
 * @returns {Map<string, number>} 'YYYY-MM-DD' → epoch seconds of that session's first bar
 */
export function sessionStarts(candles) {
  const out = new Map();
  if (!Array.isArray(candles) || typeof candles[0]?.time !== 'number') return out;
  for (const c of candles) {
    if (typeof c?.time !== 'number') continue;
    const ymd = new Date(c.time * 1000).toISOString().slice(0, 10);
    if (!out.has(ymd)) out.set(ymd, c.time);
  }
  return out;
}

/**
 * Where a DATE-ONLY event belongs on this chart.
 *
 * DERIVED, NOT INVENTED. Master's ledger does not record when in the session he filled, so on an
 * intraday chart the marker sits at that session's FIRST STORED BAR — a real bar, taken from the data
 * on hand. Choosing a plausible time of day would be a number Rāma made up about master's own trade.
 *
 * A date with no stored bar returns null, because a marker at a time that has no candle is a marker in
 * empty space.
 */
export function markerTime(raw, starts) {
  const t = toChartTime(raw);
  if (t === null) return null;
  if (typeof t === 'number') return t;               // already precise
  if (!starts || starts.size === 0) return t;        // daily chart: a date is what it wants
  return starts.get(String(raw).slice(0, 10)) ?? null;
}
