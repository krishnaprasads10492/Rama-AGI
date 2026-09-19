#!/usr/bin/env node

/**
 * verifyTimeframes.mjs — the (interval, range) matrix, and the drift it is allowed to have.
 *
 * Two things are worth testing hard here (spec Section 101).
 *
 * First, an OFFERED-BUT-UNSERVABLE combination is the failure this module exists to prevent. Yahoo
 * answers an over-deep intraday window with HTTP 422, which reaches the UI as zero bars — visually
 * identical to a misspelt symbol. So a control that offers "1m over 1 year" does not merely fail,
 * it fails while pointing master at the wrong cause.
 *
 * Second, the caps are DUPLICATED from `ai_backend/engine/providers.py`. That duplication is a
 * deliberate decision (the control must render with the engine down), which means the only thing
 * standing between it and silent divergence is this file.
 *
 * Run: node scripts/verifyTimeframes.mjs   (or npm run verify:timeframes)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as tf from '../src/pages/StockMind/timeframes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── The tables themselves ─────────────────────────────────────────────────────
console.log('\n--- the tables are well formed ---');

const ivIds = tf.INTERVALS.map((x) => x.id);
const rgIds = tf.RANGES.map((x) => x.id);
check('interval ids are unique', new Set(ivIds).size === ivIds.length, ivIds.join(','));
check('range ids are unique', new Set(rgIds).size === rgIds.length, rgIds.join(','));
check('every interval has a cap entry, even if null',
  ivIds.every((id) => id in tf.PROVIDER_CAP_SESSIONS),
  ivIds.filter((id) => !(id in tf.PROVIDER_CAP_SESSIONS)).join(','));
check('exactly one range means "everything"',
  tf.RANGES.filter((r) => r.sessions === null).length === 1);
check('ranges are ordered shallow to deep',
  tf.RANGES.every((r, i, a) => i === 0 || r.sessions === null
    || a[i - 1].sessions === null || r.sessions > a[i - 1].sessions));
check('intervals are ordered fine to coarse',
  tf.INTERVALS.every((v, i, a) => i === 0 || v.span > a[i - 1].span));
check('master asked for one minute to one month, and both ends exist',
  ivIds.includes('1m') && ivIds.includes('1mo'));

// ── Bar arithmetic ────────────────────────────────────────────────────────────
console.log('\n--- a bar count is sessions x session-minutes / bar span ---');

eq('one session of 1m bars is one NSE session', tf.barsFor('1m', '1D'), 375);
eq('five sessions of 5m bars is 375 bars', tf.barsFor('5m', '5D'), 375);
eq('a year of daily bars is 252', tf.barsFor('1d', '1Y'), 252);
eq('a year of monthly bars is 12', tf.barsFor('1mo', '1Y'), 12);
eq('a month of 1d bars is 21', tf.barsFor('1d', '1M'), 21);
check('MAX is bounded, because every bar crosses an IPC boundary',
  tf.barsFor('1d', 'MAX') === tf.MAX_BARS && tf.MAX_BARS > 0);
eq('an unknown interval asks for nothing', tf.barsFor('7s', '1D'), 0);
eq('an unknown range asks for nothing', tf.barsFor('1d', '42Y'), 0);
check('deeper ranges never ask for fewer bars',
  tf.rangesFor('1d').every((rg, i, a) => i === 0
    || tf.barsFor('1d', rg.id) >= tf.barsFor('1d', a[i - 1].id)));
check('finer intervals never ask for fewer bars over the same window',
  tf.barsFor('5m', '1M') > tf.barsFor('15m', '1M')
  && tf.barsFor('15m', '1M') > tf.barsFor('60m', '1M'));

// ── The combinations that must NOT be offered ─────────────────────────────────
console.log('\n--- an unservable pair is never offered ---');

const allowedFor = (id) => tf.rangesFor(id).map((r) => r.id);

check('1m stops at five days', JSON.stringify(allowedFor('1m')) === JSON.stringify(['1D', '5D']),
  allowedFor('1m').join(','));
check('1m over a year is refused', !tf.isAllowed('1m', '1Y'));
check('1m over MAX is refused', !tf.isAllowed('1m', 'MAX'));
check('5m reaches one month and no further',
  tf.isAllowed('5m', '1M') && !tf.isAllowed('5m', '3M'));
check('MAX is only offered where the provider has no window cap',
  !tf.isAllowed('5m', 'MAX') && !tf.isAllowed('60m', 'MAX') && tf.isAllowed('1d', 'MAX'));
check('60m reaches two years, which is its measured cap',
  tf.isAllowed('60m', '2Y') && !tf.isAllowed('60m', '5Y'));
check('every offered pair is within its cap',
  tf.INTERVALS.every((iv) => {
    const cap = tf.capBarsFor(iv.id);
    if (cap == null) return true;
    return tf.rangesFor(iv.id).every((rg) => tf.barsFor(iv.id, rg.id) <= cap);
  }));
check('no offered pair draws fewer than the display floor',
  tf.INTERVALS.every((iv) => tf.rangesFor(iv.id)
    .every((rg) => tf.barsFor(iv.id, rg.id) >= tf.MIN_USEFUL_BARS)));
check('a one-bar chart is not offered — monthly bars over one month',
  !tf.isAllowed('1mo', '1M') && !tf.isAllowed('1mo', '1D'));
check('but a year of monthly bars IS offered, which master asked for by name',
  tf.isAllowed('1mo', '1Y'));
check('every interval offers at least one range',
  tf.INTERVALS.every((iv) => tf.rangesFor(iv.id).length > 0),
  tf.INTERVALS.filter((iv) => tf.rangesFor(iv.id).length === 0).map((i) => i.id).join(','));
eq('an unknown interval offers nothing rather than everything', tf.rangesFor('nonsense').length, 0);

// ── Switching interval must not strand master on an invalid range ─────────────
console.log('\n--- reconciling a range across an interval change ---');

eq('a still-valid range survives the switch', tf.reconcileRange('15m', '1M'), '1M');
eq('1d/1Y switched to 5m falls to the deepest 5m can serve',
  tf.reconcileRange('5m', '1Y'), '1M');
eq('1d/MAX switched to 1m falls to the deepest 1m can serve',
  tf.reconcileRange('1m', 'MAX'), '5D');
check('the reconciled range is always allowed',
  tf.INTERVALS.every((iv) => tf.RANGES.every((rg) => {
    const got = tf.reconcileRange(iv.id, rg.id);
    return got !== null && tf.isAllowed(iv.id, got);
  })));
// Deepening is permitted in exactly one situation: the asked-for window is shallower than the
// SHALLOWEST this interval can usefully draw — a 1D window of monthly bars is one candle, so there
// is nothing to fall back to and the shallowest offered range is the only honest answer.
check('reconciling only deepens when nothing shallower is drawable',
  tf.INTERVALS.every((iv) => tf.RANGES.every((rg) => {
    if (rg.sessions === null) return true;
    const got = tf.range(tf.reconcileRange(iv.id, rg.id));
    if (got.sessions === null) return false;
    if (got.sessions <= rg.sessions) return true;
    const shallowest = tf.rangesFor(iv.id)[0];
    return got.id === shallowest.id;
  })));
check('an unknown range still yields something valid',
  tf.isAllowed('1d', tf.reconcileRange('1d', 'nonsense')));
eq('an unknown interval reconciles to nothing', tf.reconcileRange('nonsense', '1Y'), null);
check('every default is allowed for its own interval',
  tf.INTERVALS.every((iv) => tf.isAllowed(iv.id, tf.defaultRangeFor(iv.id))),
  tf.INTERVALS.filter((iv) => !tf.isAllowed(iv.id, tf.defaultRangeFor(iv.id))).map((i) => i.id).join(','));
// MAX is excluded: its bar count is the IPC ceiling, not a prediction of what will arrive. The
// deepest monthly series that exists is a few hundred bars, so MAX is legible by construction —
// measuring it against MAX_BARS would be measuring the wrong number.
check('defaults stay legible — no bounded default asks for more than 4,000 bars',
  tf.INTERVALS.every((iv) => {
    const d = tf.defaultRangeFor(iv.id);
    return tf.range(d).sessions === null || tf.barsFor(iv.id, d) <= 4000;
  }),
  tf.INTERVALS.map((iv) => `${iv.id}:${tf.barsFor(iv.id, tf.defaultRangeFor(iv.id))}`).join(' '));
check('only the coarsest intervals default to MAX',
  tf.INTERVALS.filter((iv) => tf.range(tf.defaultRangeFor(iv.id)).sessions === null)
    .every((iv) => iv.span >= tf.SESSION_MINUTES * 21));

// ── What master is told when a range is missing ───────────────────────────────
console.log('\n--- a missing range reads as a provider limit, not a refusal ---');

const note1m = tf.describeLimit('1m');
check('a capped interval explains itself', typeof note1m === 'string' && note1m.length > 20, String(note1m));
check('the explanation names the window Yahoo is actually sent', note1m.includes('5d'), note1m);
check('the explanation says the limit is not Rama\'s', /not by R/.test(note1m), note1m);
check('an uncapped interval has nothing to explain', tf.describeLimit('1d') === null);
check('an unknown interval has nothing to explain', tf.describeLimit('nope') === null);
// ── Dates, which replaced the bar-count field (Section 105) ───────────────────
console.log('\n--- a window is the dates it covers ---');

const NOW = new Date('2026-06-15T12:00:00');
eq('the window ends today', tf.datesForRange('1Y', NOW).to, '2026-06-15');
check('a year back is about a year of calendar days',
  (() => {
    const d = tf.datesForRange('1Y', NOW);
    const days = Math.round((new Date(d.to) - new Date(d.from)) / 86400000);
    return days >= 363 && days <= 375;
  })(), JSON.stringify(tf.datesForRange('1Y', NOW)));
check('five sessions is about a calendar week, not five calendar days',
  (() => {
    const d = tf.datesForRange('5D', NOW);
    const days = Math.round((new Date(d.to) - new Date(d.from)) / 86400000);
    return days >= 7 && days <= 12;
  })(), JSON.stringify(tf.datesForRange('5D', NOW)));
eq('MAX has no start date, because there is no start to name',
  tf.datesForRange('MAX', NOW).from, null);
eq('an unknown range yields no dates', tf.datesForRange('42Y', NOW), null);
check('deeper presets start earlier',
  new Date(tf.datesForRange('5Y', NOW).from) < new Date(tf.datesForRange('1Y', NOW).from));
check('every offered preset produces usable dates for its interval',
  tf.INTERVALS.every((iv) => tf.rangesFor(iv.id).every((rg) => {
    const d = tf.datesForRange(rg.id, NOW);
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d.to) && (d.from === null || /^\d{4}-\d{2}-\d{2}$/.test(d.from));
  })));

eq('a date formatter pads single digits', tf.toYmd(new Date('2026-01-05T00:00:00')), '2026-01-05');
eq('junk formats to empty rather than to "NaN-NaN-NaN"', tf.toYmd('not a date'), '');

eq('dates round-trip back to their own preset', tf.rangeForDates('1d', ...(() => {
  const d = tf.datesForRange('1Y', NOW);
  return [d.from, d.to];
})(), NOW), '1Y');
eq('a hand-typed range matches no preset, so nothing is falsely highlighted',
  tf.rangeForDates('1d', '2021-03-07', '2023-08-19', NOW), null);
eq('no dates at all matches no preset', tf.rangeForDates('1d', null, null, NOW), null);

console.log('\n--- the bar count still exists, it is just derived ---');
check('a year of daily bars is about 252',
  (() => {
    const d = tf.datesForRange('1Y', NOW);
    const n = tf.limitForDates('1d', d.from, d.to);
    return n >= 250 && n <= 262;
  })(), String(tf.limitForDates('1d', tf.datesForRange('1Y', NOW).from, '2026-06-15')));
check('the derived count never exceeds the provider cap',
  tf.INTERVALS.every((iv) => {
    const cap = tf.capBarsFor(iv.id);
    if (cap == null) return true;
    return tf.limitForDates(iv.id, '2000-01-01', '2026-06-15') <= cap;
  }),
  tf.INTERVALS.filter((iv) => {
    const cap = tf.capBarsFor(iv.id);
    return cap != null && tf.limitForDates(iv.id, '2000-01-01', '2026-06-15') > cap;
  }).map((i) => i.id).join(','));
check('the derived count is never below the display floor',
  tf.limitForDates('1d', '2026-06-14', '2026-06-15') >= tf.MIN_USEFUL_BARS);
eq('no start date means the payload ceiling', tf.limitForDates('1d', null, null), tf.MAX_BARS);
eq('reversed dates fall back to the ceiling rather than a negative count',
  tf.limitForDates('1d', '2026-06-15', '2020-01-01'), tf.MAX_BARS);
eq('an unknown interval falls back to the ceiling', tf.limitForDates('nope', '2020-01-01', '2026-01-01'),
  tf.MAX_BARS);
check('a finer interval derives more bars over the same dates',
  tf.limitForDates('5m', '2026-06-01', '2026-06-15')
  > tf.limitForDates('60m', '2026-06-01', '2026-06-15'));

for (const bad of [null, undefined, 0, '', {}, [], 'x']) {
  let threw = null;
  try {
    tf.datesForRange(bad, bad);
    tf.toYmd(bad);
    tf.rangeForDates(bad, bad, bad, bad);
    tf.limitForDates(bad, bad, bad);
  } catch (e) { threw = e.message; }
  check(`date helpers handle ${JSON.stringify(bad)}`, threw === null, threw);
}

check('the clock shows for intraday and not for daily',
  tf.showsClock('1m') && tf.showsClock('60m') && !tf.showsClock('1d') && !tf.showsClock('1mo'));
check('an unknown interval does not claim a clock', !tf.showsClock('nope'));

const groups = tf.intervalGroups();
check('groups cover every interval exactly once',
  groups.reduce((n, g) => n + g.items.length, 0) === tf.INTERVALS.length);
check('no group is empty', groups.every((g) => g.items.length > 0));

// ── The drift detector ────────────────────────────────────────────────────────
//
// This is the assertion that earns the duplication. `providers.INTRADAY_RANGE` is the thing that
// actually shapes the HTTP request; if it moves and this table does not, master gets offered a
// window the engine will not fetch — and nothing else in the toolchain can see across the two
// languages.
console.log('\n--- the JS table still agrees with the Python it duplicates ---');

const PROVIDERS_PY = path.join(ROOT, 'ai_backend', 'engine', 'providers.py');
let pyText = '';
try {
  pyText = fs.readFileSync(PROVIDERS_PY, 'utf8');
} catch (e) {
  pyText = '';
}
check('providers.py is readable', pyText.length > 0, PROVIDERS_PY);

function parseIntradayRange(text) {
  const start = text.indexOf('INTRADAY_RANGE');
  if (start < 0) return null;
  const open = text.indexOf('{', start);
  const close = text.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const body = text.slice(open + 1, close);
  const out = {};
  for (const m of body.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) {
    out[m[1]] = m[2];
  }
  return Object.keys(out).length > 0 ? out : null;
}

const py = parseIntradayRange(pyText);
check('INTRADAY_RANGE was found and parsed', py !== null,
  'the dict moved or changed shape — re-point the parser, do not delete the check');

if (py) {
  // Python may legitimately hold MORE intervals than the UI offers (90m, 1h, 4h are fetchable but
  // not on the control). The UI holding one Python does not is the defect.
  const uiIntraday = tf.INTERVALS.filter((iv) => iv.intraday).map((iv) => iv.id);
  const missingInPy = uiIntraday.filter((id) => !(id in py));
  check('every intraday interval the UI offers is fetchable by the engine',
    missingInPy.length === 0, missingInPy.join(','));

  const mismatched = Object.keys(tf.PROVIDER_RANGE_STRING)
    .filter((id) => id in py && py[id] !== tf.PROVIDER_RANGE_STRING[id])
    .map((id) => `${id}: py=${py[id]} ui=${tf.PROVIDER_RANGE_STRING[id]}`);
  check('the declared window strings match Python exactly', mismatched.length === 0,
    mismatched.join(' | '));

  // And the session figures must be the same fact as the window strings, not a second opinion.
  const WINDOW_SESSIONS = { '5d': 5, '1mo': 21, '3mo': 63, '6mo': 126, '1y': 252, '2y': 504 };
  const inconsistent = Object.entries(tf.PROVIDER_RANGE_STRING)
    .filter(([id, w]) => WINDOW_SESSIONS[w] !== tf.PROVIDER_CAP_SESSIONS[id])
    .map(([id, w]) => `${id}: ${w} is ${WINDOW_SESSIONS[w]} sessions but cap says ${tf.PROVIDER_CAP_SESSIONS[id]}`);
  check('the session caps are the window strings, restated', inconsistent.length === 0,
    inconsistent.join(' | '));

  const uiOnly = Object.keys(tf.PROVIDER_RANGE_STRING).filter((id) => !(id in py));
  check('the UI declares no window Python has never heard of', uiOnly.length === 0, uiOnly.join(','));
}

// ── Hostile input ─────────────────────────────────────────────────────────────
console.log('\n--- hostile input does not throw ---');

for (const bad of [null, undefined, 0, '', {}, [], NaN, '1m ', '1M', '__proto__', 'constructor']) {
  let threw = null;
  try {
    tf.barsFor(bad, bad);
    tf.rangesFor(bad);
    tf.capBarsFor(bad);
    tf.reconcileRange(bad, bad);
    tf.describeLimit(bad);
    tf.showsClock(bad);
    tf.isAllowed(bad, bad);
  } catch (e) {
    threw = e.message;
  }
  check(`${JSON.stringify(bad)} is handled`, threw === null, threw);
}
check('case matters — "1M" the range is not "1m" the interval',
  tf.interval('1M') === null && tf.range('1m') === null);
check('prototype keys do not resolve as intervals',
  tf.interval('__proto__') === null && tf.capBarsFor('__proto__') === null);

// ── Result ────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
