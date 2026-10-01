/**
 * chartSessions.js — where one trading day ends and the next begins, on a chart that shows neither.
 *
 * WHY THIS EXISTS (Section 123). Intraday bars from different days sit side by side with nothing
 * between them: the 15:30 IST close of one session is the immediate left neighbour of the next 09:15
 * open. A gap that happened overnight therefore reads as a move that happened in minutes — the same
 * class of error as a mislabelled axis, invisible until master acts on it. A faint band per session
 * makes the boundary a thing on the screen rather than a thing he has to remember is there.
 *
 * THE BOUNDARIES ARE NOT RE-DERIVED HERE, AND MUST NOT BE. `sessionStarts()` in `chartTime.js` already
 * decides which bar begins which session and is covered by that module's 197 assertions. A second
 * opinion about session boundaries living in a second module is exactly how one implicit rule about
 * time produced two separate defects (Sections 117, 118). This module CONSUMES that map and adds the
 * one thing it does not carry: where each session ENDS.
 *
 * AND THE END IS THE LAST STORED BAR, NEVER A CLOCK TIME. Painting to 15:30 when the store holds bars
 * only to 11:45 would draw a session that did not happen. That is the refusal Section 120 already made
 * once, when it declined to synthesise 26 future timestamps so Ichimoku's cloud would look complete: a
 * part-loaded day is drawn as a part-loaded day, and the shortfall stays visible instead of being
 * painted over.
 *
 * THE DAY IS THE UTC CALENDAR DAY, because that is what `sessionStarts` keys on and this module is not
 * entitled to disagree with it. For the NSE and BSE cash session that is the same cut as the IST day:
 * the roll at 00:00 UTC is 05:30 IST, which falls after one 15:30 close and before the next 09:15 open,
 * so no session is ever split by it. A bar stamped outside the cash session — 18:30 UTC is 00:00 IST —
 * is grouped with the UTC day it carries, which is recorded here as a consequence of the rule rather
 * than left to be discovered and "fixed" into an IST-day rule by a later session without deciding to.
 *
 * `scripts/verifyChartSessions.mjs` asserts all of it. Nothing in this file knows about pixels; the
 * pixel conversion is in `ChartSessionLayer.js`, so a misplaced band is one bug or the other.
 */

import { sessionStarts } from './chartTime.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// A `Date` spans ±8.64e15 ms from the epoch, so ±8.64e12 SECONDS. A finite time past that is not a
// late bar, it is junk — and the ISO-string conversion inside `sessionStarts` THROWS on it, inside a
// renderer, which is the one outcome this module may never produce.
const MAX_TIME = 8.64e12;

const usableTime = (v) => finite(v) && Math.abs(v) <= MAX_TIME;

/** 'YYYY-MM-DD' → a day label in the same shape the axis and the crosshair already use. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  // The two-digit day is kept rather than trimmed, because `formatStamp` and the tick formatter both
  // render '18 Sep' and one wording for a date is worth more than a prettier one.
  return month ? `${m[3]} ${month}` : '';
}

/**
 * An injected session-start map, or null when it cannot be trusted.
 *
 * `PriceChart` already builds one for the fill markers, so it can hand the same map over instead of
 * paying for a second pass. A map that is not shaped like `sessionStarts`' output is REFUSED rather
 * than half-used: silently accepting one bad entry would put a band on a boundary nothing measured.
 */
function injectedStarts(starts) {
  if (!(starts instanceof Map) || starts.size === 0) return null;
  for (const [ymd, from] of starts) {
    if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    if (!usableTime(from)) return null;
  }
  return starts;
}

/** The index of the last boundary at or before `t`, or -1 when `t` precedes them all. */
function sessionAt(bounds, t) {
  let lo = 0;
  let hi = bounds.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid].from <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return found;
}

/**
 * One band per trading session actually present in the bars.
 *
 * @param {Array<{time: number|string}>} candles already converted by `toChartTime`
 * @param {{starts?: Map<string, number>}} [opts] `starts` reuses a map the caller already built
 * @returns {Array<{ymd: string, from: number, to: number, index: number}>} ascending, never
 *   overlapping, `from` and `to` the STORED epoch seconds of that session's first and last bar
 */
export function sessionBands(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  // EVERY BAR OR NONE. A mixed series — date strings beside epoch numbers — is the two-time-types trap
  // of Sections 117 and 118, and banding the numeric half of one would be shading a chart that cannot
  // exist. A daily series fails this on its first bar, which is the correct answer for it too: a
  // daily chart needs no bands, because there a day is already one candle. The check also keeps a NaN
  // or absurd time out of `sessionStarts`, where it would throw rather than return.
  for (const c of candles) {
    if (!usableTime(c?.time)) return [];
  }

  let starts;
  try {
    starts = injectedStarts(opts?.starts) || sessionStarts(candles);
  } catch {
    // This function runs inside a render. It may fail to find sessions; it may not take the chart down.
    return [];
  }
  if (!(starts instanceof Map) || starts.size === 0) return [];

  const bounds = [...starts.entries()]
    .filter(([ymd, from]) => typeof ymd === 'string' && usableTime(from))
    .map(([ymd, from]) => ({ ymd, from }))
    .sort((a, b) => a.from - b.from);
  if (bounds.length === 0) return [];

  // The last stored bar of each session. A bar before the first known boundary is skipped rather than
  // attached to a session it is not in — the series is the ordered, de-duplicated one the chart holds,
  // and inventing a boundary for an out-of-order bar is the re-derivation this module refuses.
  const lastSeen = new Array(bounds.length).fill(null);
  for (const c of candles) {
    const t = c.time;
    const i = sessionAt(bounds, t);
    if (i < 0) continue;
    if (lastSeen[i] === null || t > lastSeen[i]) lastSeen[i] = t;
  }

  const out = [];
  for (let i = 0; i < bounds.length; i += 1) {
    const to = lastSeen[i];
    // A ZERO-WIDTH BAND IS OMITTED, not drawn. A session holding one stored bar has nothing to span,
    // and a 1px stripe reads as a rendering artefact rather than as a day — so the returned count is
    // deliberately below the session count when that happens, and the suite asserts the discrepancy.
    if (to === null || to <= bounds[i].from) continue;
    // `index` counts the BANDS RETURNED, not the sessions seen, and the renderer tints the even ones.
    // Alternation is the whole point: the boundary is the information, not the colour. Counting
    // omitted sessions would put two even bands side by side and the boundary between them would
    // vanish, which is the one outcome this feature exists to prevent.
    out.push({ ymd: bounds[i].ymd, from: bounds[i].from, to, index: out.length });
  }
  return out;
}

/**
 * One line for the accessible readout — '3 sessions shaded, 18 Sep to 20 Sep'.
 *
 * '' when there is nothing shaded, never a sentence about zero sessions: a screen reader announcing
 * "0 sessions shaded" on every daily chart is noise master cannot switch off.
 */
export function describeBands(bands) {
  if (!Array.isArray(bands) || bands.length === 0) return '';
  const names = bands.map((b) => dayLabel(b?.ymd)).filter(Boolean);
  if (names.length === 0) return '';
  const first = names[0];
  const last = names[names.length - 1];
  const span = last && last !== first ? `${first} to ${last}` : first;
  return `${bands.length} session${bands.length === 1 ? '' : 's'} shaded, ${span}`;
}
