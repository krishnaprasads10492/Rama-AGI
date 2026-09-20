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

// ─── Display: the store speaks UTC, the screen speaks master's time (Section 118) ──────────────
//
// Master: *"time shown should be client time not utc in the UI."*
//
// The store keeps intraday stamps in UTC deliberately (Section 73) — one provenance, no DST guessing,
// and arithmetic that cannot drift with a machine's locale. That is right for STORAGE and wrong for
// DISPLAY: lightweight-charts renders a UTCTimestamp in UTC, so the 09:15 IST open was labelled 03:45
// and master was reading a chart in a timezone he does not trade in.
//
// SO THE CONVERSION IS AT THE BOUNDARY, NOT IN THE DATA. The epoch values stay true UTC, which keeps
// the session-start lookup, the ordering and the crosshair correct; only the label changes. The
// alternative — shifting every timestamp by the local offset so the library's UTC rendering happens to
// read as local — corrupts the data to fix a label, and would silently break every comparison built on
// those numbers.
//
// A DAILY BAR IS NEVER ZONE-CONVERTED, and this is the subtle half. A daily bar is a CALENDAR DATE in
// the exchange's own reckoning, not an instant. Pushing 2026-09-18 through a timezone can land it on
// the 17th or the 19th, which would mislabel every daily bar for anyone west of UTC. Dates pass
// through untouched; only intraday instants are converted.

/**
 * A short, unambiguous name for the zone being displayed — `GMT+5:30` rather than nothing.
 *
 * SHOWN BECAUSE A BARE TIME IS AMBIGUOUS. "09:15" could be IST or UTC, and that exact ambiguity is
 * what made Section 117's defect hard to see. A time on screen should say which clock it is on.
 *
 * @param {string} [timeZone] IANA name; omitted means the machine's own zone
 */
export function zoneLabel(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    // An invalid zone must not take the chart down with it.
    return '';
  }
}

/**
 * One chart time as master should read it.
 *
 * @param {string|number|null} t a value from `toChartTime` — date string or epoch seconds
 * @param {{timeZone?: string, withTime?: boolean}} [opts] `timeZone` omitted means the machine's own
 * @returns {string} '' when there is nothing to show, never a guess
 */
export function formatStamp(t, { timeZone, withTime = true } = {}) {
  if (t === null || t === undefined || t === '') return '';
  // A calendar date is already in the exchange's reckoning. Converting it could move it a day.
  if (typeof t === 'string') return t;
  if (!Number.isFinite(t)) return '';
  const opts = { timeZone, year: 'numeric', month: 'short', day: '2-digit' };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
    opts.hour12 = false;
  }
  try {
    return new Intl.DateTimeFormat('en-GB', opts).format(new Date(t * 1000));
  } catch {
    return '';
  }
}

/**
 * `lightweight-charts` tick-mark types, by their numeric values.
 *
 * Declared here rather than imported so this module stays free of the charting library and testable
 * without it. The values are part of the library's public enum and `verifyChartTime` pins them.
 */
export const TICK = Object.freeze({ Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 });

/**
 * An axis formatter for `timeScale.tickMarkFormatter`.
 *
 * THE TICK TYPE IS RESPECTED rather than ignored. The library asks for a year, a month, a day or a
 * time depending on zoom, and returning a full date-time for every tick would make the axis a wall of
 * text — so each type gets only the field it asked for, in master's zone.
 */
export function makeTickFormatter(timeZone) {
  const fmt = (d, opts) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone, ...opts }).format(d);
    } catch {
      return '';
    }
  };
  return (time, tickMarkType) => {
    // A business-day string is already what the axis wants, and must not be shifted.
    if (typeof time === 'string') return time.slice(0, 10);
    if (!Number.isFinite(time)) return '';
    const d = new Date(time * 1000);
    switch (tickMarkType) {
      case TICK.Year: return fmt(d, { year: 'numeric' });
      case TICK.Month: return fmt(d, { month: 'short' });
      case TICK.DayOfMonth: return fmt(d, { day: '2-digit', month: 'short' });
      case TICK.TimeWithSeconds:
        return fmt(d, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      default:
        return fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  };
}

/** The crosshair label formatter for `localization.timeFormatter` — the full stamp, in master's zone. */
export function makeTimeFormatter(timeZone) {
  return (time) => formatStamp(time, { timeZone });
}
