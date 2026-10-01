#!/usr/bin/env node
/**
 * verifyChartSessions.mjs — the overnight gap, and a half-session that looks like one (Section 123).
 *
 * WHAT THIS SUBSYSTEM IS FOR. Intraday bars from different days sit side by side with nothing between
 * them, so a gap that happened overnight reads as a move that happened in minutes. `sessionBands` is
 * the arithmetic that makes the boundary visible; `ChartSessionLayer.js` turns it into pixels and
 * cannot be tested without a screen, so everything that can be is here.
 *
 * The assertions that matter most:
 *   - A band ENDS AT THE LAST STORED BAR, never at 15:30. Painting an unloaded afternoon would draw a
 *     session that did not happen — the refusal Section 120 already made about Ichimoku's cloud.
 *   - A multi-day gap produces SEPARATE bands. One band spanning the hole is the exact failure the
 *     feature exists to prevent, and it is the headline assertion.
 *   - A daily series returns [] rather than shading calendar days, where a day is already one candle.
 *   - BOUNDARIES ARE NOT RE-DERIVED. `chartTime.js`'s tested `sessionStarts` decides them; this module
 *     adds only where each session ends. Asserted at source level as well as behaviourally.
 *   - Junk returns [] rather than throwing. This runs inside a render.
 *
 * Run: node scripts/verifyChartSessions.mjs   (or npm run verify:sessions)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { sessionBands, describeBands } from '../src/pages/StockMind/chartSessions.js';
import { sessionStarts } from '../src/pages/StockMind/chartTime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = path.join(ROOT, 'src', 'pages', 'StockMind');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` - ${detail}` : ''}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (f) => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Times are built from UTC strings because the STORE speaks UTC (Section 118) and this suite must give
// the same answer on master's machine in IST as it does anywhere else. The NSE and BSE cash session is
// 09:15 to 15:30 IST, which is 03:45 to 10:00 UTC — so every intraday fixture here is a real session.
const utc = (s) => Math.floor(Date.parse(`${s}Z`) / 1000);
const bar = (time, close = 100) => ({ time, open: close, high: close + 2, low: close - 2, close });
/** @param {string} ymd @param {string[]} hhmm UTC times of day */
const session = (ymd, hhmm) => hhmm.map((t, i) => bar(utc(`${ymd}T${t}:00`), 100 + i));

const OPEN = '03:45';      // 09:15 IST
const MID = '06:15';       // 11:45 IST
const CLOSE = '10:00';     // 15:30 IST
const FULL = [OPEN, MID, CLOSE];

const DAY_SECONDS = 86400;
const IST_OFFSET = 19800;  // what a local-offset shift would look like if one had crept in

console.log('\nchart sessions — the boundary is the information\n');

// ── 1. A daily or longer chart has no bands to draw ───────────────────────────
console.log('  a daily chart returns nothing, because there a day is already one candle');
const daily = ['2026-09-18', '2026-09-21', '2026-09-22'].map((d) => ({
  time: d, open: 100, high: 102, low: 98, close: 101,
}));
check('a series of date strings returns an empty array', same(sessionBands(daily), []));
check('and it is an array, not null — the caller maps over it',
  Array.isArray(sessionBands(daily)));
check('one daily bar returns an empty array', same(sessionBands([daily[0]]), []));
check('an empty series returns an empty array', same(sessionBands([]), []));
check('sessionStarts agrees it has nothing to say about a daily series',
  sessionStarts(daily).size === 0);
check('a weekly or monthly series is the same case — still date strings',
  same(sessionBands([{ time: '2026-09-01' }, { time: '2026-10-01' }]), []));

// ── 2. One session ────────────────────────────────────────────────────────────
console.log('\n  one session is one band, from its first stored bar to its LAST stored bar');
const one = session('2026-09-18', FULL);
const oneBands = sessionBands(one);
check('exactly one band', oneBands.length === 1, String(oneBands.length));
check('from is the first stored bar', oneBands[0]?.from === one[0].time);
check('to is the LAST stored bar', oneBands[0]?.to === one[one.length - 1].time);
check('the day is named as a date', oneBands[0]?.ymd === '2026-09-18');
check('the index starts at 0', oneBands[0]?.index === 0);
check('a band carries exactly ymd, from, to and index',
  same(Object.keys(oneBands[0]).sort(), ['from', 'index', 'to', 'ymd']),
  Object.keys(oneBands[0]).join(','));

console.log('\n  A HALF-SESSION DRAWS AS A HALF-SESSION — the correctness of the whole feature');
const half = session('2026-09-18', [OPEN, MID]);
const halfBands = sessionBands(half);
check('a day loaded only to 11:45 ends at 11:45', halfBands[0]?.to === utc('2026-09-18T06:15:00'));
check('and NOT at the 15:30 close that has not been stored',
  halfBands[0]?.to !== utc('2026-09-18T10:00:00'));
check('the band is shorter than a full session, and visibly so',
  halfBands[0].to - halfBands[0].from < oneBands[0].to - oneBands[0].from);

// ── 3. Three sessions, ordered and non-overlapping ────────────────────────────
console.log('\n  three sessions are three bands, in order, never overlapping');
const three = [
  ...session('2026-09-18', FULL),
  ...session('2026-09-21', FULL),
  ...session('2026-09-22', FULL),
];
const threeBands = sessionBands(three);
check('three bands', threeBands.length === 3, String(threeBands.length));
check('named in time order',
  same(threeBands.map((b) => b.ymd), ['2026-09-18', '2026-09-21', '2026-09-22']));
check('from is ascending across the set',
  threeBands.every((b, i) => i === 0 || threeBands[i - 1].from < b.from));
check('no band overlaps the next — band[i].to <= band[i+1].from',
  threeBands.every((b, i) => i === 0 || threeBands[i - 1].to <= b.from));
check('each band stays inside its own day',
  threeBands.every((b) => b.to - b.from < DAY_SECONDS));
check('indices run 0, 1, 2 so adjacent bands differ in tint',
  same(threeBands.map((b) => b.index), [0, 1, 2]));

// ── 4. THE HEADLINE: a multi-day gap is not one band ──────────────────────────
console.log('\n  a 3-day gap in the middle is a GAP, not a session');
const gapped = [
  ...session('2026-09-18', FULL),
  ...session('2026-09-21', FULL),
  ...session('2026-09-25', FULL),       // 22nd, 23rd and 24th are absent
];
const gapBands = sessionBands(gapped);
check('three bands, not one spanning the hole', gapBands.length === 3, String(gapBands.length));
check('no band is wider than a single day',
  gapBands.every((b) => b.to - b.from < DAY_SECONDS),
  gapBands.map((b) => b.to - b.from).join(','));
check('the band before the gap ends on the 21st',
  gapBands[1]?.ymd === '2026-09-21' && gapBands[1]?.to === utc('2026-09-21T10:00:00'));
check('the band after it starts on the 25th',
  gapBands[2]?.ymd === '2026-09-25' && gapBands[2]?.from === utc('2026-09-25T03:45:00'));
check('and the hole between them is three days of nothing',
  gapBands[2].from - gapBands[1].to > 3 * DAY_SECONDS);
check('no band names a day the series does not contain',
  gapBands.every((b) => gapped.some((c) => sessionStarts([c]).has(b.ymd))));

// ── 5. A session with one bar has nothing to span ─────────────────────────────
console.log('\n  a zero-width band is omitted, because a 1px stripe reads as an artefact');
const sparse = [
  ...session('2026-09-18', FULL),
  ...session('2026-09-21', [MID]),      // one stored bar: nothing to draw
  ...session('2026-09-22', FULL),
];
const sparseBands = sessionBands(sparse);
check('three sessions are present in the bars', sessionStarts(sparse).size === 3);
check('but only two bands come back, and the shortfall is deliberate',
  sparseBands.length === 2, String(sparseBands.length));
check('the one-bar day is the one left out',
  !sparseBands.some((b) => b.ymd === '2026-09-21'));
check('no band is ever zero-width', sparseBands.every((b) => b.to > b.from));
check('THE BAND AFTER AN OMITTED SESSION TAKES THE OPPOSITE PARITY, so the boundary does not vanish',
  sparseBands[0].index % 2 !== sparseBands[1].index % 2);
check('indices still count the bands returned, 0 then 1',
  same(sparseBands.map((b) => b.index), [0, 1]));
const allSingle = [...session('2026-09-18', [MID]), ...session('2026-09-21', [MID])];
check('a series where every session holds one bar returns no bands at all',
  same(sessionBands(allSingle), []));

// ── 6. Alternation, and parity that does not flip when history loads ──────────
console.log('\n  indices alternate from 0, and a leading PARTIAL session does not shift the parity');
const partialLead = [
  ...session('2026-09-18', [MID, CLOSE]),   // history begins mid-session
  ...session('2026-09-21', FULL),
  ...session('2026-09-22', FULL),
];
const partialBands = sessionBands(partialLead);
check('a partial first session still counts as a session', partialBands.length === 3);
check('it is still index 0 — partialness does not skip it', partialBands[0]?.index === 0);
check('every later day keeps the parity it had with a full first session',
  threeBands.every((b, i) => b.ymd === partialBands[i].ymd
    && b.index % 2 === partialBands[i].index % 2));
check('the partial band still starts at a REAL stored bar, 11:45 rather than 09:15',
  partialBands[0]?.from === utc('2026-09-18T06:15:00'));
check('index equals the band\'s own position, which is what the renderer tints on',
  threeBands.every((b, i) => b.index === i));

// ── 7. UTC is preserved, and the day is the UTC calendar day ──────────────────
console.log('\n  the stored epoch seconds come back unchanged — no local-offset shift');
const istDay = session('2026-09-18', [OPEN, CLOSE]);
const istBands = sessionBands(istDay);
check('the 09:15 IST open bands at 03:45 UTC exactly', istBands[0]?.from === utc('2026-09-18T03:45:00'));
check('the 15:30 IST close bands at 10:00 UTC exactly', istBands[0]?.to === utc('2026-09-18T10:00:00'));
check('open and close are ONE session, not two', istBands.length === 1);
check('from is not shifted by the IST offset in either direction',
  istBands[0].from !== utc('2026-09-18T03:45:00') + IST_OFFSET
  && istBands[0].from !== utc('2026-09-18T03:45:00') - IST_OFFSET);
check('to is not shifted either',
  istBands[0].to !== utc('2026-09-18T10:00:00') + IST_OFFSET
  && istBands[0].to !== utc('2026-09-18T10:00:00') - IST_OFFSET);
check('the band times are identical to the input times, object for object',
  istBands[0].from === istDay[0].time && istBands[0].to === istDay[1].time);
// 23:30 UTC is 05:00 IST the next morning. Keying by a LOCAL date on master's own machine would file
// this bar under the 19th; it belongs to the 18th, and that is true on any machine.
const lateUtc = [...istDay, bar(utc('2026-09-18T23:30:00'))];
check('a 23:30 UTC bar stays in the 18th, so the day is the UTC day on any machine',
  sessionBands(lateUtc).length === 1 && sessionBands(lateUtc)[0].ymd === '2026-09-18');
check('and that bar becomes the session\'s end, because it is the last stored one',
  sessionBands(lateUtc)[0].to === utc('2026-09-18T23:30:00'));
// RECORDED AS A CONSEQUENCE, NOT A PREFERENCE: 18:30 UTC is 00:00 IST, outside the cash session
// entirely, and the UTC day it carries is the day it is filed under — because `sessionStarts` keys on
// the UTC date and this module consumes that decision rather than holding a second opinion. For the
// 09:15-15:30 session the two readings never differ: the roll at 00:00 UTC is 05:30 IST, after one
// close and before the next open. A later session changing this must change `chartTime.js` on purpose.
const midnightIst = [...istDay, bar(utc('2026-09-18T18:30:00'))];
check('an 18:30 UTC bar is filed under the UTC day it carries, not the next IST day',
  sessionBands(midnightIst).length === 1 && sessionBands(midnightIst)[0].ymd === '2026-09-18');
check('the next day\'s 09:15 is unambiguously a new session',
  sessionBands([...istDay, ...session('2026-09-21', FULL)]).length === 2);
check('and the roll at 00:00 UTC never splits a cash session',
  sessionBands(three).every((b) => new Date(b.from * 1000).toISOString().slice(0, 10) === b.ymd
    && new Date(b.to * 1000).toISOString().slice(0, 10) === b.ymd));

// ── 8. Purity ─────────────────────────────────────────────────────────────────
console.log('\n  a pure function of its input, called twice or not at all');
const snapshot = JSON.stringify(three);
const first = sessionBands(three);
const second = sessionBands(three);
check('two calls on the same bars are deep-equal', same(first, second));
check('but not the same array, so a caller cannot corrupt the next answer', first !== second);
check('the input is not mutated', JSON.stringify(three) === snapshot);
check('no returned band aliases an input bar',
  first.every((b) => !three.includes(b)));
const startsMap = sessionStarts(three);
check('a caller\'s own sessionStarts map is honoured, so one chart builds it once',
  same(sessionBands(three, { starts: startsMap }), first));
check('a junk starts map is refused and the tested one is computed instead',
  same(sessionBands(three, { starts: new Map([['nope', 'nope']]) }), first));
check('an empty starts map falls back rather than returning nothing',
  same(sessionBands(three, { starts: new Map() }), first));
check('junk opts is ignored', same(sessionBands(three, null), first)
  && same(sessionBands(three, 'x'), first));

// ── 9. Junk is survived, not thrown on ────────────────────────────────────────
console.log('\n  this runs inside a render, so junk returns [] and never throws');
const survives = (label, input) => {
  let out;
  try { out = sessionBands(input); } catch (err) { check(label, false, `threw ${err.message}`); return; }
  check(label, Array.isArray(out) && out.length === 0, JSON.stringify(out));
};
survives('null', null);
survives('undefined', undefined);
survives('an empty array', []);
survives('an array of nulls', [null, null]);
survives('an array of empty objects', [{}, {}]);
survives('a mixed array of date strings and epoch numbers', [
  { time: '2026-09-18' }, bar(utc('2026-09-18T03:45:00')), bar(utc('2026-09-18T10:00:00')),
]);
survives('NaN times', [{ time: NaN }, { time: NaN }]);
survives('one NaN among good bars', [...one, { time: NaN }]);
survives('Infinity times', [{ time: Infinity }, { time: -Infinity }]);
survives('a time past what a Date can hold', [bar(1e20), bar(1e20 + 60)]);
survives('numeric strings, which are still not numbers', [{ time: '1758166200' }]);
survives('a plain number instead of a series', 42);
survives('an object instead of a series', { time: 1 });
survives('a string instead of a series', 'nope');
survives('a Map instead of a series', new Map());

// ── 10. The accessible readout ────────────────────────────────────────────────
console.log('\n  one line for a screen reader, and silence when there is nothing to say');
check('three bands read as a span', describeBands(gapBands) === '3 sessions shaded, 18 Sep to 25 Sep',
  describeBands(gapBands));
check('one band is singular and names one day',
  describeBands(oneBands) === '1 session shaded, 18 Sep', describeBands(oneBands));
check('two bands read as a span as well',
  describeBands(sparseBands) === '2 sessions shaded, 18 Sep to 22 Sep', describeBands(sparseBands));
check('no bands is SILENCE, never "0 sessions shaded"', describeBands([]) === '');
check('null is silence', describeBands(null) === '');
check('undefined is silence', describeBands(undefined) === '');
check('a non-array is silence', describeBands('3 sessions') === '');
check('bands with unusable days are silence rather than a half sentence',
  describeBands([{ ymd: 'nope', from: 1, to: 2, index: 0 }]) === '');
check('a daily chart therefore contributes nothing to the readout',
  describeBands(sessionBands(daily)) === '');
check('the month is named, so 09 is never read as a day',
  /Sep/.test(describeBands(oneBands)));

// ── 11. Source-level: the boundaries are not re-derived, and the layer is wired ─
console.log('\n  source-level — what cannot be reached without a screen');
const mod = read(path.join(SM, 'chartSessions.js'));
const layer = read(path.join(SM, 'ChartSessionLayer.js'));
const chart = read(path.join(SM, 'PriceChart.jsx'));
const pkg = read(path.join(ROOT, 'package.json'));

check('chartSessions.js imports sessionStarts from the tested module',
  /import \{ sessionStarts \} from '\.\/chartTime\.js'/.test(mod));
check('IT DOES NOT RE-DERIVE A DAY — no date-from-timestamp arithmetic of its own',
  !/toISOString/.test(mod) && !/getUTCDate|getDate\(/.test(mod));
check('and it touches no charting library, so it stays testable without one',
  !/lightweight-charts/.test(mod));
check('no console.log in the model', !/console\.log/.test(mod));

check('the layer is a series primitive with the drawing layer\'s shape',
  /attached\(param\)/.test(layer) && /detached\(\)/.test(layer)
  && /paneViews\(\)/.test(layer) && /updateAllViews\(\)/.test(layer));
check('BANDS SIT AT THE BOTTOM, under candles, volume and every drawing',
  /zOrder: \(\) => 'bottom'/.test(layer));
check('it fills in bitmap space, like the drawing layer',
  /useBitmapCoordinateSpace/.test(layer)
  && /horizontalPixelRatio/.test(layer) && /bitmapSize/.test(layer));
check('x comes from the time scale, and its null for an off-data time is honoured',
  /timeScale\(\)\.timeToCoordinate/.test(layer) && /return finite\(x\) \? x : null/.test(layer));
check('it never asks for a price coordinate, so it cannot be wrong about one',
  !/priceToCoordinate/.test(layer));
check('only even indices are tinted, so the boundary is the information',
  /b\.index % 2 !== 0/.test(layer));
check('no console.log in the layer', !/console\.log/.test(layer));

check('PriceChart imports the model and the layer',
  /import \{ sessionBands, describeBands \} from '\.\/chartSessions\.js'/.test(chart)
  && /import \{ createSessionLayer \} from '\.\/ChartSessionLayer\.js'/.test(chart));
check('and attaches it to the price series as a second primitive',
  /createSessionLayer\(/.test(chart) && (chart.match(/attachPrimitive\(/g) || []).length === 2);
check('the bands are computed from the hoisted sessionStarts map, not a second pass',
  /sessionBands\(candles, \{ starts \}\)/.test(chart));
check('the toggle lives in the existing layers state and defaults on',
  /sessions: typeof prefs\.current\?\.sessions === 'boolean'/.test(chart));
check('and is persisted inside the existing chart preferences key',
  /sessions: layers\.sessions,/.test(chart) && /savePrefs\(\{/.test(chart));
check('the chip is HIDDEN when there are no bands, so a daily chart never shows it',
  /\{bands\.length > 0 && \(/.test(chart));
check('the chip is a pressed-state toggle like the other layer chips',
  /onClick=\{\(\) => toggle\('sessions'\)\}/.test(chart)
  && /aria-pressed=\{layers\.sessions\}/.test(chart));
check('exactly one InfoTip names the glossary term',
  (chart.match(/id="sessionBand"/g) || []).length === 1);
check('the accessible label carries describeBands\' sentence',
  /layers\.sessions && bandNote/.test(chart));
check('the layer reads live state on every draw, as the drawing layer does',
  /sessionStateRef\.current/.test(chart) && /sessionLayerRef\.current\?\.redraw\(\)/.test(chart));
check('StockMind.jsx is not involved — no call site changed',
  !/sessionBands/.test(read(path.join(SM, 'StockMind.jsx'))));
check('nor is PopoutPanel.jsx',
  !/sessionBands/.test(read(path.join(SM, 'PopoutPanel.jsx'))));

check('package.json has a verify:sessions script',
  /"verify:sessions": "node scripts\/verifyChartSessions\.mjs"/.test(pkg));
check('and the verify chain runs it immediately after the drawings suite',
  /verifyChartDrawings\.mjs && node scripts\/verifyChartSessions\.mjs/.test(pkg));
check('lightweight-charts is still pinned and no dependency was added',
  /"lightweight-charts": "5\.2\.1"/.test(pkg) && !/[\^~]\d/.test(pkg));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
