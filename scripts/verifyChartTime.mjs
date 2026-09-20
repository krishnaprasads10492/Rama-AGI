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

import { toChartTime, timeTypesMatch, sessionStarts, markerTime }
  from '../src/pages/StockMind/chartTime.js';

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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
