#!/usr/bin/env node
/**
 * verifyChartDrawings.mjs — master's own marks on the chart (Section 121).
 *
 * Section 120's audit named drawing tools the largest remaining gap. The renderer and the pointer wiring
 * cannot be verified without a screen, so everything that can be is here: the anchor model, the geometry,
 * the Fibonacci and measure maths, and the store.
 *
 * The assertions that matter most:
 *   - anchors are ABSOLUTE EPOCH SECONDS, so a drawing made on daily bars appears on a 30m chart. Storing
 *     the chart's own time type would have made drawings interval-locked — the same two-time-types trap
 *     that caused Sections 117 and 118.
 *   - distance is to the SEGMENT, not the infinite line, or a trendline is selectable from far off its end.
 *   - a corrupt store returns [] rather than throwing inside a render.
 *
 * Run: node scripts/verifyChartDrawings.mjs   (or npm run verify:drawings)
 */

import * as D from '../src/pages/StockMind/chartDrawings.js';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` - ${detail}` : ''}`); }
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// `localStorage` does not exist in node. A minimal stand-in, because the store's behaviour under a
// corrupt or absent backing is exactly what must be tested.
const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  },
};

console.log('\nchart drawings — master\'s marks, not Rāma\'s\n');

// ── Time: one type in the store ───────────────────────────────────────────────
console.log('  anchors are absolute epoch seconds, so a drawing is not interval-locked');
const DAY = Math.floor(Date.parse('2026-09-18T00:00:00Z') / 1000);
check('a daily date string becomes epoch seconds', D.toEpoch('2026-09-18') === DAY);
check('an epoch number passes through', D.toEpoch(DAY) === DAY);
check('a longer stamp is truncated to its date', D.toEpoch('2026-09-18 03:45:00') === DAY);
check('junk is null, never 0 — 0 is a real instant', D.toEpoch('nope') === null);
check('empty is null', D.toEpoch('') === null);
check('null is null', D.toEpoch(null) === null);
check('NaN is null', D.toEpoch(NaN) === null);
check('back out as a date string for a daily chart', D.fromEpoch(DAY, false) === '2026-09-18');
check('and as epoch seconds for an intraday chart', D.fromEpoch(DAY, true) === DAY);
check('the round trip is lossless for dates', D.toEpoch(D.fromEpoch(DAY, false)) === DAY);
check('and for intraday instants',
  D.toEpoch(D.fromEpoch(DAY + 13500, true)) === DAY + 13500);

console.log('\n  THE SAME DRAWING PLACES ON BOTH INTERVAL KINDS');
const tl = D.makeDrawing('trendline', [
  { time: '2026-09-18', price: 100 }, { time: '2026-09-25', price: 110 },
]);
check('a trendline is built from daily anchors', tl !== null && tl.tool === 'trendline');
check('placed on a daily chart it carries date strings',
  typeof D.placed(tl, false).points[0].time === 'string');
check('placed on an intraday chart it carries epoch numbers',
  typeof D.placed(tl, true).points[0].time === 'number');
check('and both describe the same instant',
  D.toEpoch(D.placed(tl, false).points[0].time) === D.placed(tl, true).points[0].time);
check('prices are untouched by either placement',
  D.placed(tl, false).points[1].price === 110 && D.placed(tl, true).points[1].price === 110);

// ── Construction refuses rather than half-builds ──────────────────────────────
console.log('\n  construction refuses rather than half-building');
check('an unknown tool is null', D.makeDrawing('pitchfork', [{ time: '2026-09-18', price: 1 }]) === null);
check('__proto__ is not a tool', D.makeDrawing('__proto__', [{ time: '2026-09-18', price: 1 }]) === null);
check('a two-point tool with one point is null',
  D.makeDrawing('trendline', [{ time: '2026-09-18', price: 100 }]) === null);
check('a one-point tool with one point is fine',
  D.makeDrawing('hline', [{ time: '2026-09-18', price: 100 }]) !== null);
check('a non-finite price is refused',
  D.makeDrawing('hline', [{ time: '2026-09-18', price: NaN }]) === null);
check('an unusable time is refused',
  D.makeDrawing('hline', [{ time: 'later', price: 100 }]) === null);
check('no points at all is refused', D.makeDrawing('trendline', []) === null);
check('null points is refused', D.makeDrawing('trendline', null) === null);
check('extra points beyond the tool are dropped, not kept',
  D.makeDrawing('trendline', [
    { time: '2026-09-18', price: 1 }, { time: '2026-09-19', price: 2 },
    { time: '2026-09-20', price: 3 },
  ]).points.length === 2);
check('ids are unique',
  D.makeDrawing('hline', [{ time: '2026-09-18', price: 1 }]).id
  !== D.makeDrawing('hline', [{ time: '2026-09-18', price: 1 }]).id);
check('a note is capped rather than storing an essay',
  D.makeDrawing('text', [{ time: '2026-09-18', price: 1 }],
    { text: 'x'.repeat(500) }).text.length === 280);
check('width is clamped to something drawable',
  D.makeDrawing('hline', [{ time: '2026-09-18', price: 1 }], { width: 99 }).width === 6);
check('a new drawing is never born locked',
  D.makeDrawing('hline', [{ time: '2026-09-18', price: 1 }]).locked === false);

// ── Geometry ──────────────────────────────────────────────────────────────────
console.log('\n  distance is to the SEGMENT, not the infinite line');
check('a point on the segment is at zero distance',
  near(D.distanceToSegment(5, 5, 0, 0, 10, 10), 0));
check('perpendicular distance is measured correctly',
  near(D.distanceToSegment(0, 10, 0, 0, 10, 0), 10));
check('BEYOND THE END it measures to the ENDPOINT, not to the line',
  near(D.distanceToSegment(20, 0, 0, 0, 10, 0), 10));
check('which the infinite-line shortcut would have called zero',
  D.distanceToSegment(1000, 0, 0, 0, 10, 0) > 900);
check('behind the start likewise', near(D.distanceToSegment(-5, 0, 0, 0, 10, 0), 5));
check('a degenerate segment is a point', near(D.distanceToSegment(3, 4, 0, 0, 0, 0), 5));

console.log('\n  a ray is unbounded forward and bounded behind');
check('far past the second point is still on the ray',
  near(D.distanceToRay(1000, 1000, 0, 0, 10, 10), 0));
check('but behind the first point it measures to that point',
  near(D.distanceToRay(-5, 0, 0, 0, 10, 0), 5));
check('perpendicular distance still works',
  near(D.distanceToRay(500, 10, 0, 0, 10, 0), 10));
check('a degenerate ray is a point', near(D.distanceToRay(3, 4, 1, 1, 1, 1), Math.hypot(2, 3)));

console.log('\n  a zone is grabbed by its border, not its middle');
check('on the left edge', D.nearRectEdge(0, 50, 0, 0, 100, 100, 4) === true);
check('on the bottom edge', D.nearRectEdge(50, 100, 0, 0, 100, 100, 4) === true);
check('NOT in the empty middle', D.nearRectEdge(50, 50, 0, 0, 100, 100, 4) === false);
check('nor outside it', D.nearRectEdge(200, 50, 0, 0, 100, 100, 4) === false);
check('corners drawn in either order behave the same',
  D.nearRectEdge(0, 50, 100, 100, 0, 0, 4) === true);

// ── Hit testing ───────────────────────────────────────────────────────────────
console.log('\n  hit testing');
const project = (p) => ({ x: (p.t - DAY) / 86400 * 10, y: 200 - p.price });
const hline = D.makeDrawing('hline', [{ time: '2026-09-18', price: 100 }]);
// 100px tall, deliberately. A 10px-tall rectangle has no middle that is more than the 6px tolerance from
// an edge, so testing "not through its middle" against one asserts nothing.
const rect = D.makeDrawing('rect', [
  { time: '2026-09-18', price: 200 }, { time: '2026-09-28', price: 100 },
]);
const all = [hline, tl, rect];
// x=200 is past the trendline's second anchor and past the rectangle's right edge, so only the horizontal
// reaches there. At x=40 the trendline is genuinely within tolerance of y=100 and would win on recency —
// correctly, which is why the probe is placed where exactly one drawing lives.
check('a horizontal is found at its price', D.hitTest(all, { x: 200, y: 100 }, project)?.id === hline.id);
check('and not far from it', D.hitTest(all, { x: 200, y: 160 }, project) === null);
check('where two drawings overlap, the newer one wins',
  D.hitTest([hline, tl], { x: 40, y: 100 }, project)?.id === tl.id);
check('the newest match wins, so the last thing drawn is the thing grabbed', (() => {
  const a = D.makeDrawing('hline', [{ time: '2026-09-18', price: 100 }]);
  const b = D.makeDrawing('hline', [{ time: '2026-09-18', price: 100 }]);
  return D.hitTest([a, b], { x: 10, y: 100 }, project)?.id === b.id;
})());
check('a LOCKED drawing is not selectable — that is what locking means',
  D.hitTest(D.toggleLock([hline], hline.id), { x: 40, y: 100 }, project) === null);
check('an unprojectable anchor makes a drawing unselectable rather than selectable at a guess',
  D.hitTest([hline], { x: 40, y: 100 }, () => null) === null);
check('a null projection for one point of two is enough to skip it',
  D.hitTest([tl], { x: 0, y: 100 }, (p) => (p.price === 110 ? null : project(p))) === null);
check('no drawings is null, not a throw', D.hitTest([], { x: 1, y: 1 }, project) === null);
check('a null list is null', D.hitTest(null, { x: 1, y: 1 }, project) === null);
check('a missing projector is null', D.hitTest([hline], { x: 1, y: 1 }, null) === null);
check('a rectangle is found on its edge',
  D.hitTest([rect], { x: 0, y: 50 }, project)?.id === rect.id);
check('and not through its middle', D.hitTest([rect], { x: 50, y: 50 }, project) === null);
check('nor outside it entirely', D.hitTest([rect], { x: 300, y: 50 }, project) === null);

// ── Fibonacci ─────────────────────────────────────────────────────────────────
console.log('\n  Fibonacci: level 0 is the FIRST anchor');
const fib = D.makeDrawing('fib', [
  { time: '2026-09-18', price: 100 }, { time: '2026-09-28', price: 200 },
]);
const lines = D.fibLines(fib);
check('nine levels including the two extensions', lines.length === 9);
check('level 0 sits at the first anchor', near(lines[0].price, 100));
check('level 1 sits at the second', near(lines.find((l) => l.level === 1).price, 200));
check('0.618 is where it should be', near(lines.find((l) => l.level === 0.618).price, 161.8));
check('the golden ratio is labelled as a percentage',
  lines.find((l) => l.level === 0.618).label === '61.8%');
check('a whole level loses its trailing zero', lines.find((l) => l.level === 0.5).label === '50%');
check('extensions are marked as such',
  lines.filter((l) => l.extension).map((l) => l.level).join() === '1.272,1.618');
check('1.618 extends beyond the second anchor',
  near(lines.find((l) => l.level === 1.618).price, 261.8));
check('drawn high-to-low the levels run the other way', (() => {
  const down = D.makeDrawing('fib', [
    { time: '2026-09-18', price: 200 }, { time: '2026-09-28', price: 100 },
  ]);
  return near(D.fibLines(down)[0].price, 200)
    && near(D.fibLines(down).find((l) => l.level === 0.618).price, 138.2);
})());
check('0.5 is included and is NOT claimed to be a Fibonacci ratio',
  D.FIB_LEVELS.includes(0.5));
check('a malformed drawing yields no levels', D.fibLines(null).length === 0);
check('and one point yields none', D.fibLines({ points: [{ t: 1, price: 1 }] }).length === 0);

// ── Measure ───────────────────────────────────────────────────────────────────
console.log('\n  measure reads price, percent, bars and elapsed time');
const m = D.measurement({ t: DAY, price: 100 }, { t: DAY + 7 * 86400, price: 110 }, 5);
check('the price move', near(m.price, 10));
check('the percentage', near(m.pct, 10));
check('the direction', m.up === true);
check('the bar count comes from the CHART, not from elapsed time', m.bars === 5);
check('the text carries all four', /\+10\.00/.test(m.text) && /\+10\.00%/.test(m.text)
  && /5 bars/.test(m.text) && /7\.0d/.test(m.text), m.text);
const down = D.measurement({ t: DAY, price: 110 }, { t: DAY + 3600, price: 99 }, 12);
check('a fall is negative and marked down', down.price < 0 && down.up === false);
check('and its percentage is relative to the start', near(down.pct, -10));
check('an hour reads as an hour', /1\.0h/.test(down.text), down.text);
check('a zero start price reports no percentage rather than Infinity',
  D.measurement({ t: DAY, price: 0 }, { t: DAY + 60, price: 5 }).pct === null);
check('an omitted bar count is null, not 0',
  D.measurement({ t: DAY, price: 1 }, { t: DAY + 60, price: 2 }).bars === null);
check('and is absent from the text rather than shown as "0 bars"',
  !/bars/.test(D.measurement({ t: DAY, price: 1 }, { t: DAY + 60, price: 2 }).text));
check('minutes read as minutes',
  /30m/.test(D.measurement({ t: DAY, price: 1 }, { t: DAY + 1800, price: 2 }).text));
check('a year reads as a year',
  /y/.test(D.measurement({ t: DAY, price: 1 }, { t: DAY + 400 * 86400, price: 2 }).text));

// ── The store ─────────────────────────────────────────────────────────────────
console.log('\n  the store is per SYMBOL, so a level survives a timeframe change');
mem.clear();
D.save('RELIANCE', [tl, hline]);
check('what was saved comes back', D.load('RELIANCE').length === 2);
check('a different symbol is a different store', D.load('TCS').length === 0);
check('the symbol is case-insensitive', D.load('reliance').length === 2);
check('an unknown symbol is empty rather than a throw', D.load(undefined).length === 0);
check('a transient tool is NEVER persisted', (() => {
  const meas = D.makeDrawing('measure', [
    { time: '2026-09-18', price: 1 }, { time: '2026-09-19', price: 2 },
  ]);
  D.save('TEMP', [tl, meas]);
  return D.load('TEMP').length === 1 && D.load('TEMP')[0].tool === 'trendline';
})());

console.log('\n  a corrupt store degrades rather than throwing inside a render');
mem.set('rama.stockmind.drawings.BAD', '{not json');
check('unparseable is empty', D.load('BAD').length === 0);
mem.set('rama.stockmind.drawings.BAD2', '{"a":1}');
check('a non-array is empty', D.load('BAD2').length === 0);
mem.set('rama.stockmind.drawings.BAD3', JSON.stringify([
  { tool: 'trendline', points: [{ t: 1, price: 2 }] },          // too few points
  { tool: 'nope', points: [{ t: 1, price: 2 }, { t: 3, price: 4 }] },
  { tool: 'hline', points: [{ t: 1, price: 'x' }] },            // bad price
  { tool: 'hline', points: [{ t: 1, price: 2 }] },              // the only good one
]));
check('every malformed entry is dropped and the good one kept', D.load('BAD3').length === 1);
check('and the survivor is the valid hline', D.load('BAD3')[0].tool === 'hline');

console.log('\n  editing');
let list = [];
for (let i = 0; i < 5; i += 1) {
  list = D.add(list, D.makeDrawing('hline', [{ time: '2026-09-18', price: 100 + i }]));
}
check('add appends', list.length === 5);
check('add ignores null rather than storing a hole', D.add(list, null).length === 5);
check('remove takes one out by id', D.remove(list, list[2].id).length === 4);
check('removing an unknown id changes nothing', D.remove(list, 'nope').length === 5);
check('undo removes the newest', D.undo(list).length === 4
  && !D.undo(list).some((d) => d.id === list[4].id));
check('lock toggles', D.toggleLock(list, list[0].id)[0].locked === true);
check('and toggles back', D.toggleLock(D.toggleLock(list, list[0].id), list[0].id)[0].locked === false);
check('UNDO SKIPS A LOCKED DRAWING — a lock is master saying "not this"', (() => {
  const locked = D.toggleLock(list, list[4].id);
  const after = D.undo(locked);
  return after.some((d) => d.id === list[4].id) && !after.some((d) => d.id === list[3].id);
})());
check('clear keeps the locked ones', D.clear(D.toggleLock(list, list[1].id)).length === 1);
check('and clears everything when none are locked', D.clear(list).length === 0);
check('undo on an empty list is empty, not a throw', D.undo([]).length === 0);
check('undo when everything is locked changes nothing', (() => {
  let l = list;
  for (const d of list) l = D.toggleLock(l, d.id);
  return D.undo(l).length === 5;
})());

// ── Handles: grabbing an END rather than the body ──────────────────────────────
//
// Until Section 123 a mark could be selected, locked, deleted and undone and could NOT be moved. The
// geometry for it was already here and tested; what was missing was the handle hit-test and the two
// mutators. `project` maps a stored point to x = 10px per day from DAY, y = 200 - price.
console.log('\n  handles: grabbing an END beats grabbing the body');
const tline = D.makeDrawing('trendline', [
  { time: '2026-09-18', price: 100 },   // -> x 0,   y 100
  { time: '2026-09-28', price: 150 },   // -> x 100, y 50
]);
check('the first anchor is found under the pointer', D.handleAt(tline, { x: 0, y: 100 }, project) === 0);
check('and the second', D.handleAt(tline, { x: 100, y: 50 }, project) === 1);
check('within the tolerance', D.handleAt(tline, { x: 6, y: 100 }, project) === 0);
check('but not well outside it', D.handleAt(tline, { x: 30, y: 100 }, project) === null);
check('NULL AT THE MIDPOINT — grabbing the middle must move the whole line, not an end',
  D.handleAt(tline, { x: 50, y: 75 }, project) === null);
check('the NEARER anchor wins when two are both in range', (() => {
  const tight = D.makeDrawing('trendline', [
    { time: DAY, price: 100 }, { time: DAY + 43200, price: 100 },   // 5px apart
  ]);
  return D.handleAt(tight, { x: 3, y: 100 }, project) === 1;
})());
check('a one-point drawing has one handle', D.handleAt(hline, { x: 0, y: 100 }, project) === 0);
check('an unprojectable anchor is not grabbable rather than grabbable at a guess',
  D.handleAt(tline, { x: 0, y: 100 }, () => null) === null);
check('a missing projector is null', D.handleAt(tline, { x: 0, y: 100 }, null) === null);
check('a null drawing is null, not a throw', D.handleAt(null, { x: 0, y: 100 }, project) === null);
check('a non-finite pointer position is null', D.handleAt(tline, { x: NaN, y: 0 }, project) === null);

console.log('\n  THE TOLERANCE IS THE BEHAVIOUR, so it is asserted as a number');
check('HANDLE_TOL is wider than hitTest\'s 6px default — handle beats body',
  D.HANDLE_TOL > 6, String(D.HANDLE_TOL));
check('near an end BOTH tests succeed, which is why the component asks for the handle first', (() => {
  const at = { x: 2, y: 99 };                      // on the segment, 2.2px from the first anchor
  return D.handleAt(tline, at, project) === 0 && D.hitTest([tline], at, project)?.id === tline.id;
})());

console.log('\n  a LOCKED mark cannot be selected, and now cannot be moved either');
const lockedLine = { ...tline, locked: true };
check('handleAt refuses it', D.handleAt(lockedLine, { x: 0, y: 100 }, project) === null);
check('moveDrawing returns it unchanged, by reference',
  D.moveDrawing(lockedLine, 86400, 5) === lockedLine);
check('and so does reshapeDrawing',
  D.reshapeDrawing(lockedLine, 0, { time: '2026-09-20', price: 5 }) === lockedLine);

// ── Moving ────────────────────────────────────────────────────────────────────
console.log('\n  a move translates EVERY anchor by the same delta');
const movedLine = D.moveDrawing(tline, 86400, 5);
check('the first anchor moved', movedLine.points[0].t === tline.points[0].t + 86400
  && movedLine.points[0].price === 105);
check('and the second by exactly the same amount', movedLine.points[1].t === tline.points[1].t + 86400
  && movedLine.points[1].price === 155);
check('the original object is not mutated',
  tline.points[0].price === 100 && tline.points[1].t === D.toEpoch('2026-09-28'));
check('a one-point drawing moves too', (() => {
  const h = D.moveDrawing(hline, -86400, -10);
  return h.points.length === 1 && h.points[0].price === 90 && h.points[0].t === DAY - 86400;
})());
check('a Fibonacci set moves as a whole, both anchors together', (() => {
  const f = D.moveDrawing(fib, 3600, 25);
  return f.points[0].price === 125 && f.points[1].price === 225
    && f.points[1].t === fib.points[1].t + 3600;
})());
check('a zero delta is a legal move, not a refusal', (() => {
  const z = D.moveDrawing(tline, 0, 0);
  return z !== tline && z.points[0].t === tline.points[0].t;
})());

console.log('\n  a reshape replaces ONE anchor and leaves the other bit-identical');
const reshaped = D.reshapeDrawing(tline, 1, { time: '2026-10-05', price: 180 });
check('the named anchor is replaced', reshaped.points[1].t === D.toEpoch('2026-10-05')
  && reshaped.points[1].price === 180);
check('the other is untouched',
  JSON.stringify(reshaped.points[0]) === JSON.stringify(tline.points[0]));
check('index 0 reshapes the first anchor instead', (() => {
  const r = D.reshapeDrawing(tline, 0, { time: '2026-09-15', price: 80 });
  return r.points[0].price === 80 && r.points[1].price === 150;
})());
check('the point arrives in the CHART\'s time type and is stored as epoch seconds', (() => {
  const r = D.reshapeDrawing(tline, 1, { time: DAY + 7 * 86400 + 13500, price: 115 });
  return r.points[1].t === DAY + 7 * 86400 + 13500;
})());
check('the original object is not mutated', tline.points[1].price === 150);

console.log('\n  identity survives both — a move is not a new drawing');
const rich = D.makeDrawing('trendline', [
  { time: '2026-09-18', price: 100 }, { time: '2026-09-28', price: 150 },
], { text: 'mine', color: '#ff00aa', width: 4 });
const sameness = (a, b) => a.id === b.id && a.text === b.text && a.color === b.color
  && a.width === b.width && a.locked === b.locked && a.createdAt === b.createdAt
  && a.tool === b.tool;
check('id, text, color, width, locked and createdAt all survive a move',
  sameness(rich, D.moveDrawing(rich, 60, 1)));
check('and a reshape',
  sameness(rich, D.reshapeDrawing(rich, 0, { time: '2026-09-19', price: 101 })));
check('LOSING createdAt WOULD REORDER MASTER\'S OWN HISTORY, so it is asserted on its own',
  D.moveDrawing(rich, 60, 1).createdAt === rich.createdAt);

console.log('\n  a caller can never store a half-moved mark');
const pt = { time: '2026-09-20', price: 120 };
check('an index past the end is refused', D.reshapeDrawing(tline, 2, pt) === tline);
check('a negative index is refused', D.reshapeDrawing(tline, -1, pt) === tline);
check('a fractional index is refused', D.reshapeDrawing(tline, 0.5, pt) === tline);
check('a null index is refused rather than read as 0', D.reshapeDrawing(tline, null, pt) === tline);
check('a non-finite price is refused',
  D.reshapeDrawing(tline, 0, { time: '2026-09-20', price: NaN }) === tline);
check('an unusable time is refused',
  D.reshapeDrawing(tline, 0, { time: 'later', price: 120 }) === tline);
check('a null point is refused', D.reshapeDrawing(tline, 0, null) === tline);
check('a NaN time delta is refused', D.moveDrawing(tline, NaN, 1) === tline);
check('a NaN price delta is refused', D.moveDrawing(tline, 60, NaN) === tline);
check('a null delta is refused rather than read as zero', D.moveDrawing(tline, null, 1) === tline);
check('an undefined price delta likewise', D.moveDrawing(tline, 60, undefined) === tline);
check('an unknown tool cannot be moved', (() => {
  const bogus = { tool: 'nope', points: [{ t: DAY, price: 1 }] };
  return D.moveDrawing(bogus, 60, 1) === bogus && D.reshapeDrawing(bogus, 0, pt) === bogus;
})());
check('__proto__ is still not a tool here either', (() => {
  const bogus = { tool: '__proto__', points: [{ t: DAY, price: 1 }] };
  return D.moveDrawing(bogus, 60, 1) === bogus;
})());
check('a drawing with a corrupt anchor is refused rather than moved to NaN', (() => {
  const bad = { tool: 'hline', points: [{ t: DAY, price: 'x' }], locked: false };
  return D.moveDrawing(bad, 60, 1) === bad;
})());
check('null and undefined drawings are handled',
  D.moveDrawing(null, 60, 1) === null && D.reshapeDrawing(undefined, 0, pt) === undefined);

console.log('\n  A MEASURE IS NEVER MOVEABLE, because it is never stored');
const meas = D.makeDrawing('measure', [
  { time: '2026-09-18', price: 1 }, { time: '2026-09-19', price: 2 },
]);
check('the move path is not a third way into the store', D.moveDrawing(meas, 86400, 1) === meas);
check('nor the reshape path',
  D.reshapeDrawing(meas, 0, { time: '2026-09-20', price: 5 }) === meas);

console.log('\n  ANCHORS ARE STILL ABSOLUTE EPOCH SECONDS AFTER A MOVE');
const movedDaily = D.moveDrawing(tl, 2 * 86400, 0);
check('the stored anchor is a number, not the chart\'s own time type',
  typeof movedDaily.points[0].t === 'number' && Number.isFinite(movedDaily.points[0].t));
check('it places as a date string on a daily chart',
  D.placed(movedDaily, false).points[0].time === '2026-09-20');
check('and as an epoch number on an intraday one',
  D.placed(movedDaily, true).points[0].time === DAY + 2 * 86400);
check('MOVED ON INTRADAY, IT STILL PLACES ON DAILY — a mark is not interval-locked', (() => {
  const nudged = D.moveDrawing(tl, 1800, 0.5);          // half an hour, as an intraday drag would
  const asDaily = D.placed(nudged, false);
  return typeof asDaily.points[0].time === 'string' && asDaily.points[0].time === '2026-09-18';
})());
check('and a reshape made with an intraday epoch places on daily too', (() => {
  const r = D.reshapeDrawing(tl, 1, { time: DAY + 7 * 86400 + 13500, price: 115 });
  return D.placed(r, false).points[1].time === '2026-09-25'
    && D.placed(r, true).points[1].time === DAY + 7 * 86400 + 13500;
})());

console.log('\n  a reshaped Fibonacci set re-derives every level');
const fibReshaped = D.reshapeDrawing(fib, 0, { time: '2026-09-18', price: 120 });
check('level 0 is still the FIRST anchor', near(D.fibLines(fibReshaped)[0].price, 120));
check('level 1 is still the second', near(D.fibLines(fibReshaped)[6].price, 200));
check('and the levels between come from the NEW pair, not the old one',
  near(D.fibLines(fibReshaped).find((l) => l.level === 0.5).price, 160));

console.log('\n  a move survives save then load');
const movedFib = D.moveDrawing(fib, 86400, 10);
D.save('MOVED', [movedFib]);
const backMoved = D.load('MOVED');
check('one drawing comes back', backMoved.length === 1);
check('with the moved anchors, which the read-time validation accepts',
  backMoved[0].points[0].t === movedFib.points[0].t && backMoved[0].points[0].price === 110);
check('and its identity intact',
  backMoved[0].id === movedFib.id && backMoved[0].createdAt === movedFib.createdAt);

// ── Notes: master's words, edited in place ────────────────────────────────────
console.log('\n  notes are master\'s own words — edited in place, never rewritten');
const noteList = [D.makeDrawing('text', [{ time: '2026-09-18', price: 100 }],
  { text: 'first try' })];
const nid = noteList[0].id;
check('setText replaces the words', D.setText(noteList, nid, 'second try')[0].text === 'second try');
check('it trims', D.setText(noteList, nid, '   spaced   ')[0].text === 'spaced');
check(`it caps at the module's own MAX_NOTE_CHARS (${D.MAX_NOTE_CHARS}), not at a literal in this test`,
  D.setText(noteList, nid, 'y'.repeat(D.MAX_NOTE_CHARS + 120))[0].text.length === D.MAX_NOTE_CHARS);
check('AN EMPTY TEXT ON AN EXISTING NOTE IS A REFUSAL, NOT A DELETION',
  D.setText(noteList, nid, '')[0].text === 'first try');
check('whitespace only is the same refusal',
  D.setText(noteList, nid, '   \n  ')[0].text === 'first try');
check('and the refusal returns the SAME list, so storing the result cannot lose the note',
  D.setText(noteList, nid, '') === noteList);
check('a non-string is refused too', D.setText(noteList, nid, null) === noteList
  && D.setText(noteList, nid, 42) === noteList);
check('an unknown id is a no-op', D.setText(noteList, 'nope', 'x') === noteList);
check('an undefined id does not match a drawing with no id',
  D.setText([{ id: undefined, tool: 'text', points: [] }], undefined, 'x').length === 1
  && D.setText([{ id: undefined, tool: 'text', points: [] }], undefined, 'x')[0].text === undefined);
check('a null list is handled', D.setText(null, nid, 'x').length === 0);
check('a LOCKED note is refused — editing is not a way around a lock',
  D.setText(D.toggleLock(noteList, nid), nid, 'x')[0].text === 'first try');
check('the original list is never mutated', noteList[0].text === 'first try');
check('an edited note keeps its id and createdAt', (() => {
  const e = D.setText(noteList, nid, 'again')[0];
  return e.id === nid && e.createdAt === noteList[0].createdAt && e.tool === 'text';
})());

console.log('\n  one meaning of "no words", so the editor and the model cannot disagree');
const atOne = [{ time: '2026-09-18', price: 1 }];
check('an empty text at construction is null, never an empty string',
  D.makeDrawing('text', atOne, { text: '' }).text === null);
check('whitespace at construction likewise', D.makeDrawing('text', atOne, { text: '  \n ' }).text === null);
check('words are trimmed at construction too',
  D.makeDrawing('text', atOne, { text: '  why  ' }).text === 'why');
check('a non-string is null rather than coerced', D.makeDrawing('text', atOne, { text: 7 }).text === null);
check('and the cap is the same constant',
  D.makeDrawing('text', atOne, { text: 'z'.repeat(400) }).text.length === D.MAX_NOTE_CHARS);
check('AN EMPTY NOTE IS STILL NEVER A SENTENCE — the component refuses to create one at all',
  D.makeDrawing('text', atOne, { text: '' }).text === null);

console.log('\n  words survive the store');
const fullNote = 'q'.repeat(D.MAX_NOTE_CHARS);
const awkward = 'he said "sell" — I did not,\nso this is here';
D.save('NOTED', [
  D.makeDrawing('text', atOne, { text: fullNote }),
  D.makeDrawing('text', atOne, { text: awkward }),
]);
const backNotes = D.load('NOTED');
check('both notes come back', backNotes.length === 2);
check('a full-length note survives save then load', backNotes[0].text === fullNote);
check('and one with quotes, an em dash and a newline', backNotes[1].text === awkward);
check('an edit survives save then load', (() => {
  D.save('NOTED', D.setText(backNotes, backNotes[1].id, 'rewritten by master, not by Rāma'));
  return D.load('NOTED')[1].text === 'rewritten by master, not by Rāma';
})());

console.log('\n  the cap is bounded, and drops the OLDEST');
let many = [];
for (let i = 0; i < D.MAX_PER_SYMBOL + 30; i += 1) {
  many = D.add(many, D.makeDrawing('hline', [{ time: '2026-09-18', price: i }]));
}
check(`never more than ${D.MAX_PER_SYMBOL}`, many.length === D.MAX_PER_SYMBOL);
check('THE NEWEST SURVIVES — the one just drawn is never the one dropped',
  many[many.length - 1].points[0].price === D.MAX_PER_SYMBOL + 29);
check('and the oldest is gone', !many.some((d) => d.points[0].price === 0));

// ── The palette ───────────────────────────────────────────────────────────────
console.log('\n  the palette');
check('eight tools, not eleven that all look alike', D.TOOL_IDS.length === 8, D.TOOL_IDS.length);
check('every tool has a label, a hint and a point count',
  D.TOOL_IDS.every((id) => D.TOOLS[id].label && D.TOOLS[id].hint && D.TOOLS[id].points >= 1));
check('every keyboard shortcut is unique',
  new Set(D.TOOL_IDS.map((id) => D.TOOLS[id].key)).size === D.TOOL_IDS.length);
check('no shortcut collides with the chart-type or view keys',
  D.TOOL_IDS.every((id) => !'123456flrv'.includes(D.TOOLS[id].key)),
  D.TOOL_IDS.filter((id) => '123456flrv'.includes(D.TOOLS[id].key)).join());
check('measure is the only transient tool',
  D.TOOL_IDS.filter((id) => D.TOOLS[id].transient).join() === 'measure');
check('the table is frozen', Object.isFrozen(D.TOOLS));

console.log('\n  descriptions, for the list and for a screen reader');
check('a two-point drawing names both ends',
  /from .* to /.test(D.describe(tl, false)), D.describe(tl, false));
check('a one-point drawing names one', /at /.test(D.describe(hline, false)));
check('a note quotes its text', /"why"/.test(D.describe(
  D.makeDrawing('text', [{ time: '2026-09-18', price: 1 }], { text: 'why' }), false)));
check('the dates read in the chart\'s own type', /2026-09-18/.test(D.describe(hline, false)));
check('an unknown drawing says so rather than throwing',
  D.describe({ tool: 'nope' }, false) === 'unknown drawing');

// ── The wiring, asserted against the source ───────────────────────────────────
//
// The renderer and the pointer cannot be exercised without a screen, so what CAN be checked is that they
// are connected the way the design says and that the invariants survive a later edit.
console.log('\n  the wiring');
const fs = await import('node:fs');
const chart = fs.readFileSync('src/pages/StockMind/PriceChart.jsx', 'utf8');
const layer = fs.readFileSync('src/pages/StockMind/ChartDrawingLayer.js', 'utf8');

check('the chart attaches a primitive — the capability Section 120 found unused',
  /attachPrimitive\(/.test(chart));
check('and it is attached to the SERIES, which is what gives it price coordinates',
  /price\.attachPrimitive\(/.test(chart));
check('a failed attach is reported rather than leaving drawings silently absent',
  /drawing layer unavailable/.test(chart));
check('drawings are loaded per symbol', /DRAW\.load\(symbol\)/.test(chart));
check('and saved on change rather than on unmount, so a crash loses nothing',
  /DRAW\.save\(symbol, drawings\)/.test(chart));
check('the layer renders from a REF, so a redraw never waits on a React render',
  /drawStateRef\.current/.test(chart) && /getState\(\)/.test(layer));
check('pan and zoom are disabled only while a two-point drag is in progress',
  /handleScroll: false, handleScale: false/.test(chart)
  && /handleScroll: true, handleScale: true/.test(chart));
check('the pointer listens on the holder, not the document',
  /el\.addEventListener\('mousedown'/.test(chart));
check('Escape abandons a half-drawn mark', /setDraft\(null\)/.test(chart));
check('the cursor says which mode the chart is in', /cursor: tool \? 'crosshair'/.test(chart));
check('a transient tool is refused at the commit point too, not only in the store',
  /transient\) return;/.test(chart));
check('the layer honours a null from timeToCoordinate rather than clamping to an edge',
  /timeToCoordinate/.test(layer) && /finite\(x\) && finite\(y\)/.test(layer));
check('and a null from coordinateToTime on the way back',
  /coordinateToTime/.test(layer) && /time !== null && time !== undefined/.test(layer));
check('measure counts BARS from the logical scale, never from elapsed time',
  /coordinateToLogical/.test(layer) && /logicalAt/.test(chart));
check('the layer holds no model logic — anchors and hit tests stay in the tested module',
  !/localStorage/.test(layer) && !/hitTest/.test(layer));
check('master\'s marks use a colour that is not one of Rāma\'s',
  /theme\.magenta/.test(layer));
check('the workspace chart now fills its panel', (() => {
  const sm = fs.readFileSync('src/pages/StockMind/StockMind.jsx', 'utf8');
  return /fillHeight/.test(sm);
})());
check('and fillHeight falls back to the height prop until the container is measured',
  /fitted > 120 \? fitted : height/.test(chart));

// The inline editor and the drag wiring, asserted the same way and for the same reason: the behaviour
// needs a screen, but the removal of a prompt and the shape of the wiring do not.
console.log('\n  the editing wiring');
check('THE CHART CONTAINS NO window.prompt — the removal is permanent, not a preference',
  !/window\.prompt/.test(chart));
check('a note is edited through the tested mutator rather than in the component',
  /DRAW\.setText\(/.test(chart));
check('an existing note is reopened by double-click, read off the event rather than a new listener',
  /e\.detail >= 2/.test(chart) && !/addEventListener\('dblclick'/.test(chart));
check('the editor\'s own keydown stops propagating, so typing is not read as chart shortcuts',
  /ev\.stopPropagation\(\)/.test(chart));
check('and its Escape abandons the note rather than also leaving fullscreen',
  /ev\.key === 'Escape'/.test(chart) && /settleNote\(false\)/.test(chart));
check('the input is capped by the model\'s own constant, not a second literal',
  /maxLength=\{DRAW\.MAX_NOTE_CHARS\}/.test(chart));
check('a handle starts a RESHAPE and a body starts a MOVE',
  /DRAW\.handleAt\(/.test(chart) && /mode: 'reshape'/.test(chart) && /mode: 'move'/.test(chart));
check('both run through the tested mutators',
  /DRAW\.reshapeDrawing\(/.test(chart) && /DRAW\.moveDrawing\(/.test(chart));
check('a drag commits ONCE, at mouse up, rather than writing the store per mouse-move',
  /ONE commit per drag/.test(chart));
check('Escape mid-drag drops the working copy and leaves the stored mark standing',
  /editing \|\| pointer\.current/.test(chart));
check('the cursor says whether a drag would move the mark or reshape an end',
  /nwse-resize/.test(chart) && /hoverEdit === 'move'/.test(chart));
check('the pointer handlers read the STORED list, whose anchors are epoch seconds',
  /drawingsRef\.current/.test(chart));
// A SEAM BETWEEN TWO FEATURES, pinned so it cannot come back. The indicators menu and the note editor
// were added one after the other, and the menu's shortfall sentence was briefly a local called `note`
// shadowing the editor's state of the same name in the same 2250-line component. Behaviour was right
// and the next reader would not have been, so `note` is reserved for the editor by assertion.
check('`note` names the editor\'s state and nothing else in the component',
  /const \[note, setNote\]/.test(chart) && !/\bconst note\b/.test(chart));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
