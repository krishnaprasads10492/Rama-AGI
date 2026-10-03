/**
 * marketClock.js — whether the market is trading, DERIVED from the schedule and never claimed.
 *
 * WHY THIS IS DERIVED. There is no tick stream anywhere in Rāma: the only websocket in `electron/` is
 * Vite's own HMR origin in `main.cjs`'s CSP. So nothing here observes the market. What can be known is
 * composed from three facts, each carrying its own provenance:
 *
 *   1. SESSION STATE — the NSE and BSE cash session is 09:15 to 15:30 IST with a 09:00 pre-open, and
 *      those are published hours. `weekend`, `before-open`, `pre-open`, `open` and
 *      `closed-for-the-day` are five different answers and get five different sentences, because
 *      "closed" covering all four of them is the kind of flattening that hides a fault.
 *   2. THE AGE OF THE NEWEST STORED BAR, and whether it is the current period.
 *   3. FETCH STATE — one in flight, and when the last reply landed.
 *
 * THE HOLIDAY BLIND SPOT IS A FIELD, NOT A FOOTNOTE. Rāma holds no NSE or BSE holiday calendar, so a
 * trading holiday falls inside the scheduled hours and WILL read as a session. Every state therefore
 * carries `holidayAware: false` and says so. Guessing a holiday list would be worse than the gap: a
 * wrong calendar is a confident wrong answer, where this is a stated limit.
 *
 * STALENESS IS CLAIMED ONLY WHILE THE SESSION IS OPEN. Outside it, an old bar is the correct answer —
 * calling a Sunday's last Friday bar stale would be a false alarm every weekend.
 *
 * NOTHING READ IS NOT NOTHING HAPPENED. Zero bars reads `no bars to age`, never `up to date`; an
 * unrecorded fetch reads `not recorded this session`, never `never fetched`. The two are different
 * statements and only one of them is true.
 *
 * NO SECOND TIME VOCABULARY (plan D6). Every stamp goes through `chartTime.js`'s `formatStamp` and is
 * named by its `zoneLabel`; every bar span comes from `timeframes.js`. No local offset arithmetic, no
 * second chart-time converter and no second session-minutes figure exist here — a drifting copy of any
 * of those is how Section 117's two defects happened. Wall-clock to IST is `Intl.DateTimeFormat`
 * parts, which is the only conversion that handles a zone it was not compiled for.
 *
 * PURE AND SCREENLESS, like `chartEmptyState.js` and `chartProjection.js`: no callbacks in, no JSX
 * out, `now` injectable on every function so the suite never freezes the clock, and junk returns a
 * null-ish or usable value rather than throwing, because all of this runs inside a render.
 */

// The extensions are REQUIRED: `scripts/verifyMarketClock.mjs` imports this under plain node, where
// ESM does no extension resolution.
import { formatStamp, zoneLabel } from './chartTime.js';
import { interval as intervalDef, SESSION_MINUTES, showsClock } from './timeframes.js';

/** The exchange's own zone. Master may be anywhere; the session is always in Kolkata. */
export const EXCHANGE_TZ = 'Asia/Kolkata';

/**
 * The published cash session, as minutes past IST midnight. 540 = 09:00, 555 = 09:15, 930 = 15:30 —
 * which is the same session length `timeframes.js` already states in `SESSION_MINUTES` — imported
 * below rather than restated.
 */
export const SESSION = Object.freeze({ preOpenFrom: 540, open: 555, close: 930 });

const WEEKDAY_INDEX = Object.freeze({
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
});

const HOLIDAY_CAVEAT = 'This state is derived from the scheduled hours alone. Rāma holds no NSE or '
  + 'BSE holiday calendar, so a trading holiday falls inside those hours and will read as a session.';
const DERIVED_CAVEAT = 'Nothing here is observed from the market — there is no tick feed behind it, '
  + 'only the clock and what is already stored.';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const pad = (n) => String(n).padStart(2, '0');

/** A schedule boundary as a clock label, so the sentences quote `SESSION` rather than a literal. */
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Date | epoch ms | parsable string -> Date, or null. A render must survive all three. */
function toDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (finite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  return null;
}

/**
 * The clock field of a stamp, in master's own zone.
 *
 * `formatStamp` is the single formatter (D6) and it returns a full stamp; a fetch that landed today is
 * read as a time of day, so this takes that stamp's clock field rather than formatting a second time.
 *
 * @returns {string} '' when there is nothing to show, never a guess
 */
function clockField(seconds, timeZone) {
  const full = formatStamp(seconds, { timeZone, withTime: true });
  return (/(\d{2}:\d{2})(?!.*\d{2}:\d{2})/.exec(full) || [])[1] || '';
}

/**
 * Wall-clock time as the exchange reads it.
 *
 * @param {Date|number|string} [date]
 * @returns {{ymd: string, year: number, month: number, day: number, hour: number, minute: number,
 *   minutes: number, weekday: number, weekdayLabel: string, isWeekend: boolean, clock: string}|null}
 *   null when the date or the zone cannot be read — the caller degrades rather than throwing, as
 *   `chartTime.js`'s own try/catch blocks do.
 */
export function istParts(date = new Date()) {
  const d = toDate(date);
  if (!d) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: EXCHANGE_TZ,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const year = Number(get('year'));
    const month = Number(get('month'));
    const day = Number(get('day'));
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    const weekdayLabel = get('weekday');
    const weekday = WEEKDAY_INDEX[weekdayLabel];
    if (![year, month, day, hour, minute].every(finite) || weekday === undefined) return null;
    const minutes = (hour * 60) + minute;
    return {
      ymd: `${year}-${pad(month)}-${pad(day)}`,
      year,
      month,
      day,
      hour,
      minute,
      minutes,
      weekday,
      weekdayLabel,
      isWeekend: weekday === 0 || weekday === 6,
      clock: hhmm(minutes),
    };
  } catch {
    // An unsupported zone must not take the chart down with it.
    return null;
  }
}

/**
 * Where the exchange is in its published day.
 *
 * @param {Date|number|string} [now] injectable, so the suite needs no frozen clock
 * @returns {{state: 'weekend'|'before-open'|'pre-open'|'open'|'closed-for-the-day'|'unknown',
 *   open: boolean, tone: 'open'|'pre-open'|'closed'|'unknown', phrase: string, chip: string,
 *   sentence: string, holidayAware: false, caveats: string[], zone: string, ist: object|null}}
 */
export function sessionState(now = new Date()) {
  const ist = istParts(now);
  const base = {
    holidayAware: false,
    caveats: [HOLIDAY_CAVEAT, DERIVED_CAVEAT],
    zone: EXCHANGE_TZ,
    ist,
  };

  if (!ist) {
    return {
      ...base,
      state: 'unknown',
      open: false,
      tone: 'unknown',
      phrase: 'market state unknown',
      chip: 'state unknown',
      sentence: 'The clock could not be read in the exchange\'s zone, so Rāma will not say where '
        + 'the session is rather than assume one.',
    };
  }

  if (ist.isWeekend) {
    return {
      ...base,
      state: 'weekend',
      open: false,
      tone: 'closed',
      phrase: 'market closed for the weekend',
      chip: 'weekend',
      sentence: `It is ${ist.weekdayLabel} in the exchange's zone and the cash market holds no `
        + 'session at the weekend, so there was nothing to trade today at all.',
    };
  }

  if (ist.minutes < SESSION.preOpenFrom) {
    return {
      ...base,
      state: 'before-open',
      open: false,
      tone: 'closed',
      phrase: 'market not yet open',
      chip: 'before open',
      sentence: `It is ${ist.clock} in the exchange's zone: pre-open begins at `
        + `${hhmm(SESSION.preOpenFrom)} and the regular session at ${hhmm(SESSION.open)}, so today's `
        + 'trading has not started.',
    };
  }

  if (ist.minutes < SESSION.open) {
    return {
      ...base,
      state: 'pre-open',
      open: false,
      tone: 'pre-open',
      phrase: 'market in pre-open',
      chip: 'pre-open',
      sentence: `Pre-open, ${hhmm(SESSION.preOpenFrom)} to ${hhmm(SESSION.open)} in the exchange's `
        + 'zone: orders are collected and matched into one opening price, so this is not continuous '
        + 'trading and no bar is forming yet.',
    };
  }

  if (ist.minutes <= SESSION.close) {
    return {
      ...base,
      state: 'open',
      open: true,
      tone: 'open',
      phrase: 'market open',
      chip: 'open',
      sentence: `The regular session, ${hhmm(SESSION.open)} to ${hhmm(SESSION.close)} in the `
        + `exchange's zone, is under way — it is ${ist.clock} there now.`,
    };
  }

  return {
    ...base,
    state: 'closed-for-the-day',
    open: false,
    tone: 'closed',
    phrase: 'market closed for the day',
    chip: 'closed',
    sentence: `Today's session ran and has finished: the scheduled close is ${hhmm(SESSION.close)} `
      + `in the exchange's zone and it is ${ist.clock} there now.`,
  };
}

/** Trading days strictly after `fromYmd` up to and including `toYmd`, weekends excluded. */
function weekdaysBetween(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  // PURE CALENDAR ARITHMETIC, deliberately in UTC: a daily bar is a calendar date in the exchange's
  // own reckoning and is never zone-shifted (Section 118), so both ends are treated as plain dates.
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  if (!finite(from) || !finite(to)) return null;
  const days = Math.round((to - from) / 86400000);
  if (days <= 0) return 0;
  // Bounded rather than unbounded: a decade-old bar should not cost a render ten thousand iterations,
  // and beyond that depth the exact weekday count is not what the reading turns on.
  if (days > 2000) return Math.round((days * 5) / 7);
  let count = 0;
  for (let i = 1; i <= days; i += 1) {
    const day = new Date(from + (i * 86400000)).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/**
 * How old the newest stored bar is, in the unit its own chart time is kept in.
 *
 * BOTH CHART TIME TYPES (Section 117). An epoch NUMBER is an intraday instant and ages in minutes; a
 * `'YYYY-MM-DD'` STRING is a calendar date for daily and coarser bars and ages in trading sessions,
 * never zone-shifted.
 *
 * @param {number|string|null} newest a chart time, exactly as `chartTime.js` produced it
 * @param {{interval?: string, now?: Date|number|string}} [opts]
 * @returns {{unit: 'minutes'|'sessions', age: number, span: number, isCurrentPeriod: boolean,
 *   stale: boolean, sessionOpen: boolean, text: string}|null} null when there is no age to report
 */
export function barAge(newest, opts) {
  const { interval = null, now = new Date() } = (opts && typeof opts === 'object') ? opts : {};
  const iv = intervalDef(typeof interval === 'string' ? interval.trim() : '');
  // An age with no bar span cannot say whether it is the current bar or two spans behind, and a
  // half-answer here would be read as a whole one.
  if (!iv || !finite(iv.span) || iv.span <= 0) return null;
  const at = toDate(now);
  if (!at) return null;
  const session = sessionState(at);
  const sessionOpen = session.state === 'open';

  if (finite(newest)) {
    // Chart times are epoch SECONDS, which is what `chartTime.js` returns for an intraday bar.
    const age = Math.floor(((at.getTime() / 1000) - newest) / 60);
    if (!finite(age)) return null;
    const span = iv.span;
    const isCurrentPeriod = age < span;
    return {
      unit: 'minutes',
      age,
      span,
      isCurrentPeriod,
      // ONLY WHILE OPEN. Outside a session an old bar is the expected answer (D4).
      stale: sessionOpen && age > (2 * span),
      sessionOpen,
      text: age <= 0 ? 'less than a minute old'
        : `${age} minute${age === 1 ? '' : 's'} old`,
    };
  }

  if (typeof newest === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(newest.trim())) {
    const ist = istParts(at);
    if (!ist) return null;
    const age = weekdaysBetween(newest.trim(), ist.ymd);
    if (age === null) return null;
    // Daily and coarser spans are in SESSION minutes, so one bar is this many sessions.
    const span = Math.max(1, Math.round(iv.span / SESSION_MINUTES));
    const isCurrentPeriod = newest.trim() === ist.ymd;
    return {
      unit: 'sessions',
      age,
      span,
      isCurrentPeriod,
      stale: sessionOpen && age > (2 * span),
      sessionOpen,
      // A zero age is two different facts: today's bar, or the last session's bar read on a day that
      // has not traded. "Dated today" for the second would be wrong by a day or by a weekend.
      text: age <= 0
        ? (isCurrentPeriod ? 'dated today' : 'from the most recent session')
        : `${age} trading session${age === 1 ? '' : 's'} old`,
    };
  }

  return null;
}

/**
 * One plain reading of the three facts, composed where a suite can assert every clause.
 *
 * A sentence built inside JSX is a sentence no suite can test, which is why this returns the words and
 * `PriceChart.jsx` only paints them.
 *
 * @param {{newest?: number|string|null, barCount?: number, interval?: string,
 *   now?: Date|number|string, busy?: boolean, fetchedAt?: number|null}} [args]
 *   `fetchedAt` is epoch MILLISECONDS — `Date.now()` at the call site
 * @returns {{state: string, tone: string, chip: string, text: string, caveats: string[],
 *   holidayAware: false, sentence: string, age: object|null, fetch: object}}
 */
export function liveReading(args) {
  const a = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  const {
    newest = null, barCount = 0, interval = null, now = new Date(),
    busy = false, fetchedAt = null,
  } = a;
  const session = sessionState(now);
  const iv = intervalDef(typeof interval === 'string' ? interval.trim() : '');
  const count = finite(barCount) && barCount > 0 ? Math.floor(barCount) : 0;
  const age = count > 0 ? barAge(newest, { interval, now }) : null;
  const caveats = [...session.caveats];

  // ── The bar clause. Nothing read must never render as nothing happened. ──
  let barClause;
  if (count === 0) {
    barClause = 'no bars to age';
    caveats.push('No bars are loaded for this symbol and interval, so there is no age to report — '
      + 'that is a gap in what Rāma holds, not a quiet market.');
  } else if (!age) {
    barClause = 'newest bar cannot be dated';
    caveats.push(`${count.toLocaleString()} bars are loaded, but the newest one's time or its `
      + 'interval could not be read, so its age is unknown rather than zero.');
  } else {
    const label = iv ? iv.label : 'newest';
    barClause = age.isCurrentPeriod
      ? `newest ${label} bar is ${age.text} and is still the current bar`
      : `newest ${label} bar is ${age.text}`;
    if (age.stale) {
      caveats.push(`The session is inside its scheduled hours and the newest bar is older than two `
        + `${label} bars, so what is drawn is behind the market — fetch again.`);
    } else if (!age.sessionOpen) {
      caveats.push('The session is not open, so an older bar is the expected answer and nothing '
        + 'here calls it behind.');
    }
  }

  // ── The fetch clause. In flight is not freshness, and unrecorded is not never. ──
  const fetchSeconds = finite(fetchedAt) && fetchedAt > 0 ? Math.floor(fetchedAt / 1000) : null;
  const zone = showsClock(interval) && zoneLabel() ? ` ${zoneLabel()}` : '';
  let fetchClause;
  if (busy === true) {
    // Deliberately says nothing about freshness: a fetch in flight has not landed yet.
    fetchClause = 'a fetch is in flight now';
  } else if (fetchSeconds === null) {
    fetchClause = 'last fetch not recorded this session';
    caveats.push('When the last reply landed was not recorded in this window, so the time is '
      + 'unknown — it does not mean no fetch ever happened.');
  } else {
    const sameDay = formatStamp(fetchSeconds, { withTime: false })
      === formatStamp(Math.floor((toDate(now) || new Date()).getTime() / 1000), { withTime: false });
    const clock = clockField(fetchSeconds);
    const stamp = sameDay && clock ? clock : formatStamp(fetchSeconds);
    fetchClause = stamp ? `last fetched ${stamp}${zone}` : 'last fetch time could not be read';
  }

  const text = `${session.phrase} · ${barClause} · ${fetchClause}.`;

  return {
    state: session.state,
    tone: session.tone,
    chip: session.chip,
    text,
    sentence: session.sentence,
    caveats,
    holidayAware: false,
    age,
    fetch: { busy: busy === true, at: fetchSeconds, recorded: fetchSeconds !== null },
  };
}

export default liveReading;
