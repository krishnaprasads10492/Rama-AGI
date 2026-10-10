#!/usr/bin/env node
/**
 * verifyChartTime.mjs — one chart holds one time type (Section 117).
 *
 * This exists because a single implicit rule caused two separate defects. `toChartTime` returns a
 * `'YYYY-MM-DD'` STRING for daily bars and a UTC epoch NUMBER for intraday ones, and lightweight-charts
 * cannot hold both on one chart:
 *
 *   1. The projection cone was requested by named horizon, and only `60m` mapped to an intraday
 *      horizon — so a 30m chart drew numeric candles against a daily, string-timed cone. Section 110
 *      made 30m the DEFAULT interval, so from that commit the projection failed every time.
 *   2. Master's fills carry a date with no time of day, so they are always strings — unplaceable on an
 *      intraday chart.
 *
 * Run: node scripts/verifyChartTime.mjs   (or npm run verify:chart-time)
 */

import {
  toChartTime, timeTypesMatch, sessionStarts, markerTime,
  formatStamp, zoneLabel, makeTickFormatter, makeTimeFormatter, TICK,
} from '../src/pages/StockMind/chartTime.js';
import {
  zoomPlan, visibleBars, pxPerBar, verifyZoom, rangeForPxPerBar, describeZoom, clampPxPerBar,
  densityById, pxForDensity,
  DENSITIES, DEFAULT_DENSITY, MIN_BAR_PX, MAX_BAR_PX, CORRECTION_TOLERANCE, RIGHT_HEADROOM_BARS,
} from '../src/pages/StockMind/chartZoom.js';
import { TOOLS as DRAW_TOOLS } from '../src/pages/StockMind/chartDrawings.js';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` - ${detail}` : ''}`); }
};

console.log('\nchart time — one chart holds one time type\n');

// ── The two types ─────────────────────────────────────────────────────────────
console.log('  daily is a date string, intraday is an epoch number');
check('a bare date stays a string', toChartTime('2026-09-18') === '2026-09-18');
check('and is typed string', typeof toChartTime('2026-09-18') === 'string');
check('an intraday stamp becomes a number', typeof toChartTime('2026-09-18 03:45:00') === 'number');
check('the 09:15 IST open is 03:45 UTC, so it parses as UTC not local',
  toChartTime('2026-09-18 03:45:00') === Math.floor(Date.parse('2026-09-18T03:45:00Z') / 1000));
check('an ISO T separator works too',
  toChartTime('2026-09-18T03:45:00') === toChartTime('2026-09-18 03:45:00'));
check('an explicit Z is not double-suffixed',
  toChartTime('2026-09-18T03:45:00Z') === toChartTime('2026-09-18 03:45:00'));
check('an explicit offset is honoured rather than overridden with Z',
  toChartTime('2026-09-18T09:15:00+05:30') === toChartTime('2026-09-18 03:45:00'));
check('a longer date-time with fractional seconds still parses',
  typeof toChartTime('2026-09-18 03:45:00.000') === 'number');
check('a date with a trailing space is trimmed', toChartTime(' 2026-09-18 ') === '2026-09-18');
check('empty is null, not 0 — 0 is a real epoch', toChartTime('') === null);
check('null is null', toChartTime(null) === null);
check('undefined is null', toChartTime(undefined) === null);
check('junk is null rather than NaN', toChartTime('not a date') === null);
check('a long junk string is null', toChartTime('tomorrow morning please') === null);

// ── THE DEFECT ────────────────────────────────────────────────────────────────
console.log('\n  the mismatch that broke the projection');
const dailyTime = toChartTime('2026-09-22');
const intradayTime = toChartTime('2026-09-18 03:45:00');
check('a daily cone time and an intraday candle time are DIFFERENT TYPES',
  typeof dailyTime !== typeof intradayTime);
check('so timeTypesMatch refuses the pair', timeTypesMatch(intradayTime, dailyTime) === false);
check('two intraday times match', timeTypesMatch(intradayTime, toChartTime('2026-09-18 04:15:00')));
check('two daily times match', timeTypesMatch(dailyTime, toChartTime('2026-09-23')));
check('a null on either side is permitted — nothing to draw is not a mismatch',
  timeTypesMatch(null, dailyTime) && timeTypesMatch(intradayTime, null));
check('undefined on either side is permitted',
  timeTypesMatch(undefined, dailyTime) && timeTypesMatch(intradayTime, undefined));

// ── Session starts ────────────────────────────────────────────────────────────
console.log('\n  the first stored bar of each session');
const t = (s) => toChartTime(s);
const intradayCandles = [
  { time: t('2026-09-18 03:45:00') },
  { time: t('2026-09-18 04:15:00') },
  { time: t('2026-09-18 04:45:00') },
  { time: t('2026-09-19 03:45:00') },
  { time: t('2026-09-19 04:15:00') },
];
const starts = sessionStarts(intradayCandles);
check('one entry per session, not per bar', starts.size === 2, starts.size);
check('and it is the FIRST bar of the session',
  starts.get('2026-09-18') === t('2026-09-18 03:45:00'));
check('for the second session too', starts.get('2026-09-19') === t('2026-09-19 03:45:00'));
check('a daily chart needs no mapping, so the map is empty',
  sessionStarts([{ time: '2026-09-18' }, { time: '2026-09-19' }]).size === 0);
check('an empty candle list is an empty map', sessionStarts([]).size === 0);
check('a null candle list does not throw', sessionStarts(null).size === 0);
check('a non-array does not throw', sessionStarts('bars').size === 0);
check('a malformed candle is skipped rather than throwing',
  sessionStarts([{ time: t('2026-09-18 03:45:00') }, { nope: 1 }, null]).size === 1);
check('out-of-order bars still record the EARLIEST as the session start',
  sessionStarts([{ time: t('2026-09-18 04:45:00') }, { time: t('2026-09-18 03:45:00') }])
    .get('2026-09-18') === t('2026-09-18 04:45:00'),
  'first seen wins — the caller sorts, and that is asserted next');

// ── Fills: derived, never invented ────────────────────────────────────────────
console.log('\n  a fill has a date; an intraday chart has times');
check('on an intraday chart a dated fill lands on that session\'s first bar',
  markerTime('2026-09-19', starts) === t('2026-09-19 03:45:00'));
check('which is a REAL bar, not an invented time of day',
  intradayCandles.some((c) => c.time === markerTime('2026-09-19', starts)));
check('a date with no stored bar is null, not placed in empty space',
  markerTime('2026-09-25', starts) === null);
check('on a daily chart the date is used directly',
  markerTime('2026-09-19', new Map()) === '2026-09-19');
check('a fill that already carries a time is used as-is',
  markerTime('2026-09-19 05:00:00', starts) === t('2026-09-19 05:00:00'));
check('an unusable date is null', markerTime('', starts) === null);
check('null is null', markerTime(null, starts) === null);
check('a missing map does not throw', markerTime('2026-09-19', null) === '2026-09-19');
check('a longer ISO fill date is truncated to the session key',
  markerTime('2026-09-19T00:00:00', starts) !== null);

// ── Display in master's own time (Section 118) ────────────────────────────────
//
// Every assertion passes an EXPLICIT timeZone. Relying on the machine's zone would make this suite
// pass here and fail on master's machine, which is the opposite of what a test is for.
console.log('\n  the screen shows master\'s clock, not UTC');
const openUTC = toChartTime('2026-09-18 03:45:00');   // the 09:15 IST open, as the store keeps it
check('the stored stamp is 03:45 in UTC',
  formatStamp(openUTC, { timeZone: 'UTC' }).includes('03:45'),
  formatStamp(openUTC, { timeZone: 'UTC' }));
check('AND 09:15 IN IST — which is the NSE open master actually sees',
  formatStamp(openUTC, { timeZone: 'Asia/Kolkata' }).includes('09:15'),
  formatStamp(openUTC, { timeZone: 'Asia/Kolkata' }));
check('the date is carried too, not just the time',
  formatStamp(openUTC, { timeZone: 'Asia/Kolkata' }).includes('2026'));
check('a zone west of UTC moves it the other way',
  formatStamp(openUTC, { timeZone: 'America/New_York' }).includes('23:45'),
  formatStamp(openUTC, { timeZone: 'America/New_York' }));
check('and onto the previous day, correctly',
  formatStamp(openUTC, { timeZone: 'America/New_York' }).includes('17'),
  formatStamp(openUTC, { timeZone: 'America/New_York' }));
check('withTime false gives a date alone',
  !formatStamp(openUTC, { timeZone: 'Asia/Kolkata', withTime: false }).includes(':'));

console.log('\n  a DAILY bar is never zone-converted');
check('a date string passes through untouched in IST',
  formatStamp('2026-09-18', { timeZone: 'Asia/Kolkata' }) === '2026-09-18');
check('and untouched in a zone that would have moved it back a day',
  formatStamp('2026-09-18', { timeZone: 'America/New_York' }) === '2026-09-18');
check('which is the point: a daily bar is a calendar date, not an instant',
  formatStamp('2026-09-18', { timeZone: 'Pacific/Kiritimati' }) === '2026-09-18');
check('null formats to empty, never to an epoch', formatStamp(null) === '');
check('undefined formats to empty', formatStamp(undefined) === '');
check('NaN formats to empty rather than "Invalid Date"', formatStamp(NaN) === '');
check('an invalid zone does not throw, it returns empty',
  formatStamp(openUTC, { timeZone: 'Not/AZone' }) === '');

console.log('\n  the zone is named, because a bare time is ambiguous');
check('IST is labelled', zoneLabel('Asia/Kolkata') === 'GMT+5:30', zoneLabel('Asia/Kolkata'));
check('UTC is labelled', zoneLabel('UTC').length > 0, zoneLabel('UTC'));
check('an invalid zone yields an empty label rather than throwing', zoneLabel('Not/AZone') === '');
check('no argument yields the machine\'s own zone label', typeof zoneLabel() === 'string');

console.log('\n  the axis respects what the library asked for');
const tick = makeTickFormatter('Asia/Kolkata');
check('a Time tick is just the time, in IST', tick(openUTC, TICK.Time) === '09:15', tick(openUTC, TICK.Time));
check('a DayOfMonth tick is a day, not a wall of text',
  tick(openUTC, TICK.DayOfMonth) === '18 Sept', tick(openUTC, TICK.DayOfMonth));
check('a Month tick is a month', tick(openUTC, TICK.Month) === 'Sept', tick(openUTC, TICK.Month));
check('a Year tick is a year', tick(openUTC, TICK.Year) === '2026');
check('TimeWithSeconds includes seconds',
  tick(openUTC, TICK.TimeWithSeconds).split(':').length === 3,
  tick(openUTC, TICK.TimeWithSeconds));
check('an unknown tick type falls back to a time rather than empty',
  tick(openUTC, 99) === '09:15');
check('a daily business-day string is returned unshifted',
  tick('2026-09-18', TICK.DayOfMonth) === '2026-09-18');
check('a non-finite time is empty, not "Invalid Date"', tick(NaN, TICK.Time) === '');
check('the tick enum values match the library\'s public enum',
  TICK.Year === 0 && TICK.Month === 1 && TICK.DayOfMonth === 2
  && TICK.Time === 3 && TICK.TimeWithSeconds === 4);

console.log('\n  the crosshair formatter');
const cf = makeTimeFormatter('Asia/Kolkata');
check('gives the full stamp in IST', cf(openUTC).includes('09:15'));
check('and leaves a daily date alone', cf('2026-09-18') === '2026-09-18');

console.log('\n  the underlying value is NOT mutated to fix a label');
check('the epoch is still true UTC after formatting',
  toChartTime('2026-09-18 03:45:00') === openUTC);
check('so the session-start lookup still keys on the UTC date',
  sessionStarts([{ time: openUTC }]).has('2026-09-18'));
check('which is why shifting timestamps by the offset was the wrong fix',
  openUTC === Math.floor(Date.parse('2026-09-18T03:45:00Z') / 1000));

// ── The default zoom, third attempt (Sections 110, 119, 122) ──────────────────
//
// Master reported this wrong three times. What follows asserts the four causes found in Section 122,
// each one named, because the previous two fixes were adjustments to a number that was never the
// problem: there was no ceiling, nothing was ever read back, the fallback undid the fix, and the width
// being measured included the price scale.

console.log('\n  the candle width is master\'s setting, not a number Rāma guesses at');
check('there are several widths to choose from', DENSITIES.length >= 3, DENSITIES.length);
check('each is named by intent and carries a hint, so the choice needs no unit',
  DENSITIES.every((d) => d.id && d.label && d.hint && Number.isFinite(d.px)));
check('they run widest to narrowest, so a picker reads in one direction',
  DENSITIES.every((d, i) => i === 0 || d.px < DENSITIES[i - 1].px));
check('no two offer the same width, which would be two identical buttons',
  new Set(DENSITIES.map((d) => d.px)).size === DENSITIES.length);
check('every one is inside the drawable limits',
  DENSITIES.every((d) => d.px >= MIN_BAR_PX && d.px <= MAX_BAR_PX));
check('the default exists', !!densityById(DEFAULT_DENSITY));
check('and is 12px — a readable body, about where a trading platform opens',
  pxForDensity(DEFAULT_DENSITY) === 12, pxForDensity(DEFAULT_DENSITY));
check('an unknown density is null rather than a guess', densityById('enormous') === null);
check('but asking for its width falls back to the default instead of failing',
  pxForDensity('enormous') === 12);

console.log('\n  a width is clamped BOTH ways — the missing ceiling was the first cause');
check('there is a ceiling at all, which the Section 119 plan did not have',
  Number.isFinite(MAX_BAR_PX) && MAX_BAR_PX <= 40, MAX_BAR_PX);
check('45px per candle — what 20 bars in a 900px pane became — is refused',
  clampPxPerBar(45) === MAX_BAR_PX);
check('and 0.2px, which is a smear rather than a candle, is raised to the floor',
  clampPxPerBar(0.2) === MIN_BAR_PX);
check('a numeric string is accepted, because a stored preference is a string',
  clampPxPerBar('18') === 18);
check('NaN falls back to the default', clampPxPerBar(NaN) === 12);
check('ABSENT IS NOT ZERO: null falls back to the default, not to the 1px floor',
  clampPxPerBar(null) === 12, clampPxPerBar(null));
check('undefined likewise', clampPxPerBar(undefined) === 12);
check('and an empty string likewise, since that is what a cleared input gives',
  clampPxPerBar('') === 12);

console.log('\n  there is no `fit` branch left, and its absence IS the fix');
const deep = zoomPlan(4649);
check('a deep series sets BAR SPACING rather than a bar count', deep.mode === 'spacing');
check('at the default width', deep.barSpacing === 12);
check('and says the rest is scrolling', /scrolling/.test(deep.reason));
check('4,649 bars are NOT squeezed into the pane — that was the Section 79 smear',
  deep.mode !== 'fit');
check('about 75 bars are on screen at 900px, not 4,649',
  visibleBars(900, deep.barSpacing) === 75, visibleBars(900, deep.barSpacing));
check('a wider pane shows more bars at the SAME candle width',
  visibleBars(1800, deep.barSpacing) === 150);

const tiny = zoomPlan(20);
check('20 BARS GET THE SAME 12px CANDLES, NOT 45px ONES — the third cause of "still wrong"',
  tiny.mode === 'spacing' && tiny.barSpacing === 12, `${tiny.mode}/${tiny.barSpacing}`);
check('and the reason says the empty pane is correct rather than a defect',
  /empty/.test(tiny.reason) && /correct/.test(tiny.reason));
check('no count anywhere produces a fit', ![1, 2, 19, 20, 75, 500, 4649]
  .some((n) => zoomPlan(n).mode === 'fit'));

console.log('\n  master\'s chosen width is what gets applied');
check('comfortable gives 18px', zoomPlan(500, pxForDensity('comfortable')).barSpacing === 18);
check('dense gives 3px', zoomPlan(500, pxForDensity('dense')).barSpacing === 3);
check('an omitted target means the default, never nothing',
  zoomPlan(500).barSpacing === 12);
check('A PANE WIDTH PASSED WHERE A CANDLE WIDTH BELONGS IS CLAMPED, not applied — the signature '
  + 'changed in Section 122 and a missed call site must not become a 900px candle',
  zoomPlan(500, 900).barSpacing === MAX_BAR_PX);
check('no bars is no zoom, not a fit of nothing', zoomPlan(0).mode === 'none');
check('a negative count is refused', zoomPlan(-5).mode === 'none');
check('NaN is refused', zoomPlan(NaN).mode === 'none');
check('and nothing to zoom to carries no spacing to apply', zoomPlan(0).barSpacing === null);

console.log('\n  the width is MEASURED off the chart, never restated from what was asked for');
check('75 logical units across 900px is 12px per bar',
  pxPerBar({ from: 0, to: 75 }, 900) === 12);
check('150 across the same pane is 6px', pxPerBar({ from: 0, to: 150 }, 900) === 6);
check('a fractional range measures fractionally',
  Math.abs(pxPerBar({ from: 10.5, to: 85.5 }, 900) - 12) < 1e-9);
check('no range means NULL rather than a guess', pxPerBar(null, 900) === null);
check('no width means null', pxPerBar({ from: 0, to: 75 }, 0) === null);
check('a zero span means null, not a division by zero',
  pxPerBar({ from: 40, to: 40 }, 900) === null);
check('a reversed range means null', pxPerBar({ from: 80, to: 40 }, 900) === null);
check('a NaN bound means null', pxPerBar({ from: NaN, to: 75 }, 900) === null);

console.log('\n  the zoom is VERIFIED, which neither previous attempt did');
check('an exact hit passes', verifyZoom({ from: 0, to: 75 }, 900, 12).ok);
check('and reports the measurement it checked',
  verifyZoom({ from: 0, to: 75 }, 900, 12).actual === 12);
const settled = verifyZoom({ from: 0, to: 75 * 1.1 }, 900, 12);
check('a small drift is left alone rather than fought over', settled.ok, settled.why);
const library = verifyZoom({ from: 0, to: 150 }, 900, 12);
check('THE LIBRARY\'S OWN 6px DEFAULT AGAINST A 12px TARGET IS CAUGHT — which is almost certainly '
  + 'what master was looking at, since Section 110 measured "about 5" while asking for 8',
  library.ok === false, library.why);
check('and the failure names both numbers and says it did not take',
  /6\.0px/.test(library.why) && /12/.test(library.why) && /did not take/.test(library.why));
check('the drift is reported as a fraction, so a caller can decide',
  Math.abs(library.drift - 0.5) < 1e-9);
check('an unreadable range is NOT reported as a pass',
  verifyZoom(null, 900, 12).ok === false);
check('and says so, rather than implying a measurement',
  /unverified/.test(verifyZoom(null, 900, 12).why));
check('the tolerance is a real number and not so wide as to accept anything',
  CORRECTION_TOLERANCE > 0 && CORRECTION_TOLERANCE < 0.25, CORRECTION_TOLERANCE);
check('a null target falls back to the default rather than verifying against 1px',
  verifyZoom({ from: 0, to: 75 }, 900, null).target === 12);

console.log('\n  the correction holds the width instead of stretching to the bars');
const fix = rangeForPxPerBar(4649, 900, 12);
check('a deep series gets a 75-unit span', fix.to - fix.from === 75, fix.to - fix.from);
check('anchored on the newest bar with headroom, not flush against the axis',
  fix.to === 4649 + RIGHT_HEADROOM_BARS);
const shortFix = rangeForPxPerBar(20, 900, 12);
check('A 20-BAR SERIES STILL GETS A 75-UNIT SPAN, so `from` is NEGATIVE — clamping it to 0 pins '
  + '20 bars across 900px at 41px each, which is the very stretch being fixed',
  shortFix.from < 0, shortFix.from);
check('and the span is the pane, not the data', shortFix.to - shortFix.from === 75);
for (const n of [3, 20, 75, 500, 4649]) {
  for (const t of [3, 12, 18]) {
    const round = pxPerBar(rangeForPxPerBar(n, 900, t), 900);
    check(`round trip: ${n} bars at ${t}px measures back within tolerance`,
      round !== null && Math.abs(round - t) / t <= CORRECTION_TOLERANCE, round);
  }
}
check('a 1200px pane at 18px asks for 66 units', rangeForPxPerBar(500, 1200, 18).to
  - rangeForPxPerBar(500, 1200, 18).from === 66);
check('no width means no correction to apply', rangeForPxPerBar(500, 0, 12) === null);
check('no bars means none either', rangeForPxPerBar(0, 900, 12) === null);
check('a span is never below two units, however wide the candles',
  rangeForPxPerBar(500, 10, 40).to - rangeForPxPerBar(500, 10, 40).from === 2);

console.log('\n  and it is finally something master can SEE');
check('the readout gives the width and the bars', describeZoom(12, 4649, 900)
  === '12px/bar · 75 of 4,649 bars', describeZoom(12, 4649, 900));
check('a narrow width keeps a decimal, because 3 and 3.4 are different chart',
  /3\.2px/.test(describeZoom(3.2, 500, 900)));
check('a wide one does not', /18px/.test(describeZoom(18, 500, 900)));
check('an unmeasurable zoom describes NOTHING rather than claiming a number',
  describeZoom(null, 500, 900) === null && describeZoom(0, 500, 900) === null);
check('it never mentions a target, because it is a measurement',
  !/target/i.test(describeZoom(12, 4649, 900)));
check('visibleBars needs a width', visibleBars(0, 12) === null);
check('and a width', visibleBars(900, 0) === null);

// ── The guarantee, asserted against the source ────────────────────────────────
console.log('\n  the rule stays in one place');
const fs = await import('node:fs');
const chart = fs.readFileSync('src/pages/StockMind/PriceChart.jsx', 'utf8');
check('PriceChart imports the conversion rather than redefining it',
  /from '\.\/chartTime\.js'/.test(chart));
check('and defines no second copy of toChartTime',
  !/function\s+toChartTime/.test(chart));
check('the cone effect refuses a type mismatch instead of throwing',
  /timeTypesMatch\(/.test(chart));
check('the fills effect uses the session-start lookup',
  /markerTime\(/.test(chart));
check('and rebuilds when the candles change, or an intraday fill cannot be placed',
  /\[fills, layers\.fills, chartType, candles\]/.test(chart));

const jsx = fs.readFileSync('src/pages/StockMind/StockMind.jsx', 'utf8');
check('the cone is requested on the interval the chart is showing',
  /interval: barInterval/.test(jsx));
check('and the horizon is chosen by whether that interval has a clock',
  /showsClock\(barInterval\)/.test(jsx));

const bridge = fs.readFileSync('electron/ipc/marketIntel.cjs', 'utf8');
check('the bridge forwards the interval', /interval=\$\{encodeURIComponent\(interval\)\}/.test(bridge));

const py = fs.readFileSync('ai_backend/engine/projection.py', 'utf8');
check('the engine accepts an interval override', /interval: Optional\[str\] = None/.test(py));
check('an unfitted interval cannot tilt the centre', /"entitled": False/.test(py));
check('and the mismatch is reported rather than borrowed silently',
  /intervalMismatch/.test(py));
check('the response says which interval was actually measured',
  /measuredInterval/.test(py));

console.log('\n  the chart is wired to the local formatters');
check('the time axis uses the local tick formatter', /tickMarkFormatter: makeTickFormatter\(\)/.test(chart));
check('the crosshair uses the local time formatter',
  /localization: \{ timeFormatter: makeTimeFormatter\(\) \}/.test(chart));
check('the legend shows the time', /formatStamp\(readout\.time\)/.test(chart));
check('and names the zone beside it, so the reading is unambiguous',
  /zoneLabel\(\)/.test(chart));
check('no timestamp is shifted to fake a local rendering',
  !/getTimezoneOffset/.test(chart) && !/getTimezoneOffset/.test(
    fs.readFileSync('src/pages/StockMind/chartTime.js', 'utf8')));

console.log('\n  the zoom decision lives in one place');
check('PriceChart imports the plan rather than recomputing it',
  /from '\.\/chartZoom\.js'/.test(chart));
check('and holds no copy of the target width', !/TARGET_BAR_PX/.test(chart));
check('the candle width is set at CREATION, so the first paint is already right rather than corrected',
  /barSpacing: targetPxRef\.current/.test(chart));
check('and again on every application', /barSpacing: target/.test(chart));
check('NOT as a width-derived logical range — that was the Section 110 defect',
  !/Math\.floor\(width \/ TARGET_BAR_PX\)/.test(chart));
check('the newest bars are scrolled into view', /scrollToRealTime\(\)/.test(chart));
check('there is exactly one application of the plan',
  (chart.match(/function applyLegibleZoom/g) || []).length === 1);
// THREE CALL SITES, PINNED ON THE PLUMBING AND NOT ON THE COUNT ARGUMENT. The earlier form required
// all three to pass `candles.length` verbatim, which went red the moment the data effect started
// passing the DRAWN count instead — correctly, because a price-indexed series has its own length and
// fitting the bar count would set a spacing for a series that is not on screen (Section 139). What
// matters is that every site routes through the one function with the one holder, target and setter;
// WHICH count each passes is the next two rows' business.
check('the data effect, the density control and reset zoom all call that one function',
  (chart.match(/applyLegibleZoom\(chart, [A-Za-z.]+, holder\.current,\s*\n?\s*targetPxRef\.current, setZoom\)/g)
    || []).length === 3,
  (chart.match(/applyLegibleZoom\(/g) || []).length);
check('and no site reaches past it to set a bar spacing of its own',
  (chart.match(/applyLegibleZoom\(/g) || []).length === 4,
  (chart.match(/applyLegibleZoom\(/g) || []).length);
// THE COUNT THAT IS FITTED IS THE ONE THAT IS DRAWN. REDBY: pass `candles.length` in the data effect.
check('the data effect fits the DRAWN count, not the bar count',
  /applyLegibleZoom\(chart, drawnCount, holder\.current/.test(chart));
check('and `drawnCount` starts as the bar count, so a time-indexed chart is unchanged',
  /let drawnCount = candles\.length;/.test(chart));
check('and is replaced by the price-indexed series length when there is one',
  /drawnCount = built\.data\.length;/.test(chart));
check('the 900px width fallback that disagreed with the chart\'s own 600 is gone',
  !/clientWidth \|\| 900/.test(chart));

console.log('\n  the zoom is applied, then CHECKED — the second cause of "still wrong"');
check('the read-back waits for a paint instead of running in the same tick as setData',
  /frame\(\(\) => settle\(1\)\)/.test(chart));
check('and `frame` is a real animation frame where there is one',
  /requestAnimationFrame/.test(chart));
check('the result is verified against the target', /verifyZoom\(range, width, target\)/.test(chart));
check('a drift is corrected by setting the range explicitly',
  /setVisibleLogicalRange\(want\)/.test(chart) && /rangeForPxPerBar\(count, width, target\)/.test(chart));
check('the correction runs ONCE, so a chart that refuses cannot loop',
  /settle\(correctionsLeft - 1\)/.test(chart) && /correctionsLeft <= 0/.test(chart));
check('THERE IS NO `fitContent` FALLBACK — as a fallback it silently restored the behaviour being '
  + 'replaced, which is why two fixes looked applied and were not',
  !/catch\s*\{\s*(try\s*\{\s*)?(ts|chart)[.\w]*\.fitContent/.test(chart));
check('fitContent survives in exactly one place: the `fit all` button master asks for',
  (chart.match(/timeScale\(\)\.fitContent\(\)/g) || []).length === 1,
  (chart.match(/timeScale\(\)\.fitContent\(\)/g) || []).length);
check('an unverified zoom is warned about rather than left looking fine',
  /zoom unverified/.test(chart));

console.log('\n  the width measured is the PLOT, not the container — the fourth cause');
check('the plot width comes from the time scale itself',
  /timeScale\?\.\(\)\?\.width\?\.\(\)/.test(chart));
check('with the container only as a fallback', /return holderEl\?\.clientWidth \|\| 0/.test(chart));
check('and no measurement reads clientWidth directly',
  !/pxPerBar\([^)]*clientWidth/.test(chart) && !/verifyZoom\([^)]*clientWidth/.test(chart));

console.log('\n  and master can see it, set it and keep it');
check('the measured width is rendered', /zoom\.text/.test(chart));
check('the chart reports it on every range change, not only on open',
  /subscribeVisibleLogicalRangeChange/.test(chart));
check('deduped, so a drag does not set state on every frame',
  /lastPxRef/.test(chart));
check('the density picker is in the appearance menu', /DENSITIES\.map/.test(chart));
check('the choice is remembered', /savePrefs\(\{[^}]*density/.test(chart));
check('and restored, falling back to the default when the stored value is unknown',
  /densityById\(want\) \? want : DEFAULT_DENSITY/.test(chart));
check('the bracket keys step it', /k === '\]'/.test(chart) && /k === '\['/.test(chart));
check('and no drawing tool claims a bracket, so nothing is stolen',
  !Object.values(DRAW_TOOLS).some((t) => t.key === '[' || t.key === ']'));
check('the glossary explains the candle width where the control is',
  /InfoTip id="zoom"/.test(chart));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
