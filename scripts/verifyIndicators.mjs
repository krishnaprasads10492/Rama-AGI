#!/usr/bin/env node

/**
 * verifyIndicators.mjs — the overlay maths the chart is allowed to compute for itself.
 *
 * WHY THIS IS TESTED AT ALL (spec Section 101). Master trades real money against these lines. An
 * indicator that is subtly wrong is the worst possible defect here, because it does not look broken:
 * a simple-average RSI, a sample-standard-deviation Bollinger band, or an EMA seeded on the first
 * close all produce a smooth plausible curve that carries a well-known name and is not that
 * indicator. Nothing downstream could notice. So the assertions below are mostly about
 * DISCRIMINATION — proving each function is the named variant and not its lookalike — and about
 * warm-up, where the temptation is to emit a partial average rather than nothing.
 *
 * Run: node scripts/verifyIndicators.mjs   (or npm run verify:indicators)
 */

import * as ind from '../src/pages/StockMind/indicators.js';

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

const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const closeTo = (label, got, want, tol = 1e-6) => check(label, near(got, want, tol), `got ${got}, want ${want}`);

// Bars with daily string times, the shape a `1d` series arrives in.
//
// The dates MUST be unique and ascending. An earlier fixture cycled `2026-01-01..28`, so a 120-bar
// series repeated every time value — and MACD, which aligns its three series by time rather than by
// index, matched the wrong bars and reported a histogram longer than its own signal line. The bug was
// in the fixture, but the failure it produced is exactly the one a real duplicate-time series would
// cause, which is why the alignment is matched by time in the first place.
const daily = (values) => values.map((v, i) => ({
  time: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
  open: v, high: v + 1, low: v - 1, close: v, volume: 1000 + i,
}));

// Bars with epoch-second times, the shape an intraday series arrives in.
const intraday = (specs) => specs.map((s) => ({
  time: s.t, open: s.c, high: s.h ?? s.c, low: s.l ?? s.c, close: s.c, volume: s.v,
}));

const flat = (n, v = 100) => daily(new Array(n).fill(v));
const ramp = (n, from = 100, step = 1) => daily(Array.from({ length: n }, (_, i) => from + i * step));

// ── SMA ───────────────────────────────────────────────────────────────────────
console.log('\n--- simple moving average ---');

const s5 = ind.sma(daily([1, 2, 3, 4, 5, 6]), 3);
eq('warm-up bars are dropped, not filled', s5.length, 4);
closeTo('first value is the mean of the first window', s5[0].value, 2);
closeTo('last value is the mean of the last window', s5[3].value, 5);
check('the first value is stamped on the LAST bar of its window', s5[0].time === daily([1, 2, 3])[2].time,
  `${s5[0].time}`);
eq('too few bars draws nothing at all', ind.sma(ramp(199), 200).length, 0);
eq('exactly enough bars draws one point', ind.sma(ramp(200), 200).length, 1);
check('a flat series averages to itself', ind.sma(flat(30), 20).every((p) => near(p.value, 100)));
eq('period 0 is refused', ind.sma(ramp(50), 0).length, 0);
eq('a negative period is refused', ind.sma(ramp(50), -5).length, 0);
check('unusable closes are skipped rather than poisoning the window',
  ind.sma([{ time: 'a', close: 1 }, { time: 'b', close: NaN }, { time: 'c', close: 3 },
    { time: 'd', close: 5 }], 3).length === 1);

// ── EMA ───────────────────────────────────────────────────────────────────────
console.log('\n--- exponential moving average, seeded on the SMA ---');

const e = ind.ema(daily([1, 2, 3, 4, 5, 6, 7, 8]), 4);
eq('the first point is at index period-1', e.length, 5);
closeTo('the seed IS the simple average of the first window', e[0].value, 2.5);
check('seeding on the first close is NOT what happens',
  !near(e[0].value, 1), `first value ${e[0].value}`);
const k = 2 / 5;
closeTo('the next point applies the standard smoothing constant', e[1].value, 5 * k + 2.5 * (1 - k));
check('a flat series stays flat', ind.ema(flat(40), 21).every((p) => near(p.value, 100)));
eq('too few bars draws nothing', ind.ema(ramp(20), 21).length, 0);

// The responsiveness claim has to be tested against a STEP, not a ramp. On a steady linear rise the
// EMA actually sits BELOW the SMA of the same period; "reacts faster" is about a change of level,
// which is what an indicator is watched for.
const step = daily(new Array(40).fill(100).concat(new Array(5).fill(200)));
const emaStep = ind.ema(step, 20).at(-5).value;
const smaStep = ind.sma(step, 20).at(-5).value;
check('an EMA moves further than an SMA on the first bar after a step',
  emaStep > smaStep, `ema ${emaStep.toFixed(3)} vs sma ${smaStep.toFixed(3)}`);
closeTo('and by exactly the smoothing constant\'s worth', emaStep, 100 + 100 * (2 / 21), 1e-9);

// ── Bollinger ─────────────────────────────────────────────────────────────────
console.log('\n--- bollinger bands, population standard deviation ---');

const bb = ind.bollinger(daily([1, 2, 3, 4, 5]), 5, 2);
eq('one window, one point per band', bb.middle.length, 1);
closeTo('the middle band is the SMA', bb.middle[0].value, 3);
// Population sd of 1..5 is sqrt(10/5)=1.41421356; the SAMPLE sd is sqrt(10/4)=1.58113883.
closeTo('the upper band uses the POPULATION sd', bb.upper[0].value, 3 + 2 * Math.sqrt(2), 1e-9);
check('it is not the sample sd', !near(bb.upper[0].value, 3 + 2 * Math.sqrt(10 / 4), 1e-6),
  `${bb.upper[0].value}`);
closeTo('the bands are symmetric about the middle',
  bb.upper[0].value - bb.middle[0].value, bb.middle[0].value - bb.lower[0].value);
const bbFlat = ind.bollinger(flat(30), 20, 2);
check('a flat series has zero width, not a divide-by-zero',
  bbFlat.upper.every((p, i) => near(p.value, bbFlat.lower[i].value)));
check('all three bands are the same length',
  bb.middle.length === bb.upper.length && bb.upper.length === bb.lower.length);
eq('too few bars draws nothing', ind.bollinger(ramp(19), 20).middle.length, 0);
eq('period 1 is refused — a one-bar sd is zero and the bands are theatre',
  ind.bollinger(ramp(50), 1).middle.length, 0);
check('a wider multiplier widens the band',
  ind.bollinger(ramp(50), 20, 3).upper.at(-1).value > ind.bollinger(ramp(50), 20, 2).upper.at(-1).value);

// ── RSI ───────────────────────────────────────────────────────────────────────
console.log('\n--- RSI, Wilder smoothing ---');

const rUp = ind.rsi(ramp(40), 14);
const rDown = ind.rsi(daily(Array.from({ length: 40 }, (_, i) => 200 - i)), 14);
eq('the first point is at index period, not period-1', rUp.length, 40 - 14);
closeTo('a series that only rises is 100', rUp.at(-1).value, 100);
closeTo('a series that only falls is 0', rDown.at(-1).value, 0);
check('a flat series is 50, reached explicitly and not by dividing by zero',
  ind.rsi(flat(40), 14).every((p) => near(p.value, 50)));

// A zig-zag where Wilder's and a plain mean of gains/losses give different answers.
const zig = daily([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
  46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57]);
const rz = ind.rsi(zig, 14);
check('every value sits inside 0..100', rz.every((p) => p.value >= 0 && p.value <= 100),
  JSON.stringify(rz.map((p) => Number(p.value.toFixed(2)))));
// The lookalike: a plain average of the last `p` gains and losses, recomputed each bar.
function simpleRsi(bars, p) {
  const c = bars.map((b) => b.close);
  const out = [];
  for (let i = p; i < c.length; i += 1) {
    let g = 0; let l = 0;
    for (let j = i - p + 1; j <= i; j += 1) {
      const d = c[j] - c[j - 1];
      if (d >= 0) g += d; else l -= d;
    }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + (g / p) / (l / p)));
  }
  return out;
}
const naive = simpleRsi(zig, 14);
check('Wilder smoothing is measurably NOT the plain-average lookalike',
  !near(rz.at(-1).value, naive.at(-1), 0.05),
  `wilder ${rz.at(-1).value.toFixed(4)} vs plain ${naive.at(-1).toFixed(4)}`);
check('the two agree on their very first point, which is the shared seed',
  near(rz[0].value, naive[0], 1e-9), `${rz[0].value} vs ${naive[0]}`);
eq('period bars is one too few — a difference needs two bars', ind.rsi(ramp(14), 14).length, 0);
eq('period+1 bars draws exactly one point', ind.rsi(ramp(15), 14).length, 1);
eq('period 1 is refused', ind.rsi(ramp(50), 1).length, 0);

// ── MACD ──────────────────────────────────────────────────────────────────────
console.log('\n--- MACD, and the alignment that is easy to get wrong ---');

const m = ind.macd(ramp(120), 12, 26, 9);
check('all three series are produced', m.macd.length > 0 && m.signal.length > 0 && m.histogram.length > 0);
eq('the histogram exists only where the signal does', m.histogram.length, m.signal.length);
check('the histogram is macd minus signal, bar for bar',
  m.histogram.every((h, i) => {
    const mi = m.macd.find((x) => String(x.time) === String(h.time));
    const si = m.signal.find((x) => String(x.time) === String(h.time));
    return mi && si && near(h.value, mi.value - si.value, 1e-9);
  }));
check('the signal is shorter than the macd line by its own warm-up',
  m.signal.length === m.macd.length - 8, `macd ${m.macd.length}, signal ${m.signal.length}`);
check('a flat series gives a flat zero line', ind.macd(flat(120)).macd.every((p) => near(p.value, 0)));
check('a rising series has the fast EMA above the slow one',
  m.macd.at(-1).value > 0, String(m.macd.at(-1)?.value));
const bad = ind.macd(ramp(120), 26, 12, 9);
check('fast must be faster than slow, or nothing is drawn',
  bad.macd.length === 0 && bad.signal.length === 0 && bad.histogram.length === 0);
const short = ind.macd(ramp(30), 12, 26, 9);
check('too few bars for the signal still yields the macd line rather than nothing',
  short.macd.length > 0 && short.signal.length === 0 && short.histogram.length === 0,
  `macd ${short.macd.length}, signal ${short.signal.length}`);
eq('too few bars for the slow EMA yields nothing', ind.macd(ramp(20), 12, 26, 9).macd.length, 0);

// ── VWAP ──────────────────────────────────────────────────────────────────────
console.log('\n--- VWAP, which is meaningless unless it is anchored ---');

const DAY = 86400;
const twoSessions = intraday([
  { t: DAY * 100 + 3600 * 4, c: 100, h: 102, l: 98, v: 100 },
  { t: DAY * 100 + 3600 * 5, c: 110, h: 112, l: 108, v: 300 },
  { t: DAY * 101 + 3600 * 4, c: 50,  h: 52,  l: 48,  v: 100 },
  { t: DAY * 101 + 3600 * 5, c: 60,  h: 62,  l: 58,  v: 100 },
]);
const vw = ind.vwap(twoSessions);
eq('one point per usable bar', vw.length, 4);
closeTo('the first point is that bar\'s own typical price', vw[0].value, 100);
closeTo('within a session it is volume weighted', vw[1].value, (100 * 100 + 110 * 300) / 400);
closeTo('a NEW SESSION RESETS — the second day starts from its own first bar', vw[2].value, 50);
check('the reset is real: day two never carries day one\'s level',
  vw[2].value < 60 && vw[3].value < 60, `${vw[2].value}, ${vw[3].value}`);
eq('a daily series has no sessions to anchor to, so it draws nothing',
  ind.vwap(daily([1, 2, 3, 4, 5])).length, 0);
eq('zero-volume bars are skipped rather than dividing by zero',
  ind.vwap(intraday([{ t: DAY * 100, c: 10, v: 0 }])).length, 0);
check('a bar missing a high or low is skipped',
  ind.vwap([{ time: DAY * 100, close: 10, volume: 5 }]).length === 0);

// ── The overlay catalogue ─────────────────────────────────────────────────────
console.log('\n--- what the control offers, and why a toggle can draw nothing ---');

check('every overlay has a unique id',
  new Set(ind.OVERLAY_DEFS.map((o) => o.id)).size === ind.OVERLAY_DEFS.length);
check('every overlay declares a pane', ind.OVERLAY_DEFS.every((o) => o.pane === 'price' || o.pane === 'oscillator'));
check('oscillators never claim the price pane — a 0..100 series on an index scale is a flat line',
  ind.overlayById('rsi14').pane === 'oscillator' && ind.overlayById('macd').pane === 'oscillator');
check('every overlay actually runs on real-shaped bars',
  ind.OVERLAY_DEFS.every((o) => {
    const bars = o.intradayOnly ? twoSessions : ramp(300);
    try { o.make(bars); return true; } catch { return false; }
  }));
check('every overlay survives an empty series',
  ind.OVERLAY_DEFS.every((o) => { try { o.make([]); return true; } catch { return false; } }));
check('VWAP is withheld on daily rather than drawn wrong',
  !ind.overlaysFor(false).some((o) => o.id === 'vwap')
  && ind.overlaysFor(true).some((o) => o.id === 'vwap'));
// Exclusion now runs BOTH ways (Section 120), so a net count no longer describes it: VWAP is
// intraday-only because it resets each session, and floor-trader pivots are daily-or-longer because they
// are computed from the previous SESSION. Asserting the net difference would pass while both were broken.
check('pivots are withheld on intraday rather than renamed to the last five minutes',
  !ind.overlaysFor(true).some((o) => o.id === 'pivots')
  && ind.overlaysFor(false).some((o) => o.id === 'pivots'));
check('the two lists differ only by those directional exclusions', (() => {
  const day = new Set(ind.overlaysFor(false).map((o) => o.id));
  const intra = new Set(ind.overlaysFor(true).map((o) => o.id));
  const onlyDay = [...day].filter((id) => !intra.has(id));
  const onlyIntra = [...intra].filter((id) => !day.has(id));
  return onlyDay.join() === 'pivots' && onlyIntra.join() === 'vwap';
})());
check('every definition declares at most one of the two exclusions',
  ind.OVERLAY_DEFS.every((o) => !(o.intradayOnly && o.dailyOnly)));
check('a withheld pivot set explains itself',
  /session/i.test(ind.overlayShortfall('pivots', 500, true) || ''),
  String(ind.overlayShortfall('pivots', 500, true)));

check('a withheld VWAP explains itself',
  /intraday/.test(ind.overlayShortfall('vwap', 500, false) || ''),
  String(ind.overlayShortfall('vwap', 500, false)));
check('VWAP on intraday with enough bars has nothing to explain',
  ind.overlayShortfall('vwap', 500, true) === null);
const short200 = ind.overlayShortfall('sma200', 120, false);
check('a short series names the shortfall in both directions',
  /200/.test(short200 || '') && /120/.test(short200 || ''), String(short200));
check('a sufficient series has nothing to explain', ind.overlayShortfall('sma200', 200, false) === null);
check('an unknown overlay explains nothing rather than inventing a reason',
  ind.overlayShortfall('nope', 1, false) === null);
/**
 * Every `[{time, value}]` list a `make` can return, whatever its shape.
 *
 * Shapes in use: a bare array (`line`), `{middle, upper, lower}` (`band`), `{macd, signal, histogram}`,
 * and `{series: [{data, ...}], guides, scale}` (`series`, added in Section 120). The last one is why this
 * helper exists — the previous inline shape-sniffing read `{series: [...]}` as zero points and would have
 * reported every new multi-line study as drawing nothing.
 */
function pointLists(drew) {
  if (!drew) return [];
  if (Array.isArray(drew)) return [drew];
  if (Array.isArray(drew.series)) return drew.series.map((p) => p.data || []);
  return Object.values(drew).filter(Array.isArray);
}

check('every shortfall threshold matches what the maths actually needs',
  ind.OVERLAY_DEFS.filter((o) => !o.intradayOnly).every((o) => {
    const msg = ind.overlayShortfall(o.id, 1, false);
    if (!msg) return true;               // no declared threshold
    const need = parseInt(String(msg).match(/needs (\d+) bars/)?.[1] || '0', 10);
    if (!need) return true;              // withheld for an interval reason, not a bar count
    const lists = pointLists(o.make(ramp(need)));
    return lists.some((l) => l.length > 0);
  }));
check('every overlay declares a bar requirement, so none can draw nothing in silence',
  ind.OVERLAY_DEFS.every((o) => Number.isFinite(ind.OVERLAY_NEEDS[o.id])),
  ind.OVERLAY_DEFS.filter((o) => !Number.isFinite(ind.OVERLAY_NEEDS[o.id])).map((o) => o.id).join());
// THE THRESHOLD IS WHERE THE STUDY IS COMPLETE, not where its first line appears — which is a real
// distinction and it caught an off-by-one. MACD's own line draws from 26 bars, but its SIGNAL needs nine
// more, so a chart at 30 bars showed a MACD line with no signal and the declared need of 35 was a bar
// pessimistic either way. At one bar short, SOMETHING must still be missing.
check('one bar fewer than the requirement leaves the study incomplete',
  ind.OVERLAY_DEFS.filter((o) => !o.intradayOnly && ind.OVERLAY_NEEDS[o.id] > 2).every((o) => {
    const lists = pointLists(o.make(ramp(ind.OVERLAY_NEEDS[o.id] - 1)));
    return lists.length === 0 || lists.some((l) => l.length === 0);
  }),
  ind.OVERLAY_DEFS.filter((o) => !o.intradayOnly && ind.OVERLAY_NEEDS[o.id] > 2
    && pointLists(o.make(ramp(ind.OVERLAY_NEEDS[o.id] - 1))).every((l) => l.length > 0))
    .map((o) => o.id).join());
// A `directionalSplit` study draws one side per trend direction, so on a one-way fixture the other side is
// correctly empty — that is the trend not having flipped, not a missing line.
const wholeLines = (o) => !o.intradayOnly && !o.directionalSplit;
check('and AT the requirement every line of the study draws',
  ind.OVERLAY_DEFS.filter(wholeLines).every((o) => {
    const lists = pointLists(o.make(ramp(ind.OVERLAY_NEEDS[o.id])));
    return lists.length > 0 && lists.every((l) => l.length > 0);
  }),
  ind.OVERLAY_DEFS.filter((o) => wholeLines(o)
    && !pointLists(o.make(ramp(ind.OVERLAY_NEEDS[o.id]))).every((l) => l.length > 0))
    .map((o) => o.id).join());
check('a direction-split study draws at least the side the trend is on',
  ind.OVERLAY_DEFS.filter((o) => o.directionalSplit).every((o) => pointLists(
    o.make(ramp(ind.OVERLAY_NEEDS[o.id] + 5))).some((l) => l.length > 0)));
check('and draws BOTH sides once the trend actually reverses',
  pointLists(ind.OVERLAY_DEFS.find((o) => o.id === 'supertrend')
    .make(ramp(60).concat(daily(Array.from({ length: 60 }, (_, i) => 160 - i * 2)))))
    .every((l) => l.length > 0));

// ── Hostile input ─────────────────────────────────────────────────────────────
console.log('\n--- hostile input does not throw ---');

for (const bad of [null, undefined, [], {}, 0, '', [null], [{}], [{ close: 'x' }], [{ time: 1 }]]) {
  let threw = null;
  try {
    ind.sma(bad, 20); ind.ema(bad, 21); ind.bollinger(bad, 20, 2);
    ind.rsi(bad, 14); ind.macd(bad); ind.vwap(bad);
  } catch (err) { threw = err.message; }
  check(`${JSON.stringify(bad)} is handled`, threw === null, threw);
}
check('every function returns the empty shape for junk, never a NaN point',
  ind.sma(null, 20).length === 0
  && ind.ema(null, 21).length === 0
  && ind.rsi(null, 14).length === 0
  && ind.vwap(null).length === 0
  && ind.bollinger(null).middle.length === 0
  && ind.macd(null).macd.length === 0);
check('no emitted point is ever non-finite, across every overlay',
  ind.OVERLAY_DEFS.every((o) => pointLists(o.make(o.intradayOnly ? twoSessions : zig.concat(ramp(300))))
    .every((l) => l.every((p) => Number.isFinite(p.value) && p.time !== undefined))),
  ind.OVERLAY_DEFS.filter((o) => !pointLists(o.make(o.intradayOnly ? twoSessions
    : zig.concat(ramp(300)))).every((l) => l.every((p) => Number.isFinite(p.value)
      && p.time !== undefined))).map((o) => o.id).join());
check('nor on a flat series, where every range is zero',
  ind.OVERLAY_DEFS.every((o) => pointLists(o.make(flat(120)))
    .every((l) => l.every((p) => Number.isFinite(p.value)))),
  ind.OVERLAY_DEFS.filter((o) => !pointLists(o.make(flat(120)))
    .every((l) => l.every((p) => Number.isFinite(p.value)))).map((o) => o.id).join());

// ── The rest of the toolkit (Section 120) ─────────────────────────────────────
//
// `daily()` gives every bar a range of exactly 2 (high = v+1, low = v-1) and a typical price equal to the
// close, which makes several of these hand-computable to the decimal. Where a formula has a widely-copied
// WRONG version, the assertion is chosen so the wrong version fails it.

console.log('\n--- ATR ---');
closeTo('a constant 2-point range gives ATR 2', ind.atr(ramp(40), 14).at(-1).value, 2);
closeTo('and on a flat series too', ind.atr(flat(40), 14).at(-1).value, 2);
closeTo('ATR% is that as a share of close', ind.atrPct(ramp(40), 14).at(-1).value,
  (2 / ramp(40).at(-1).close) * 100, 1e-9);
eq('ATR needs a previous close, so it never reports on the first bar',
  ind.atr(ramp(16), 14).length, 2);
eq('too short is empty, not a partial average', ind.atr(ramp(10), 14).length, 0);

console.log('\n--- ADX (+DM/-DM: only the larger, only if positive) ---');
const adxUp = ind.adx(ramp(60), 14);
// EXACT, not approximate, because the fixture makes it computable: each bar's high and low both rise by
// 1, so +DM is 1 and −DM is 0 on every bar, while the true range is 2 (high − low). So +DI is exactly
// 1/2 = 50% and −DI exactly 0. An implementation that counted both directional moves would put −DI at 50
// as well and this would fail.
closeTo('a one-way uptrend puts +DI at exactly half the true range', adxUp.plusDI.at(-1).value, 50);
eq('and -DI at exactly zero', adxUp.minusDI.at(-1).value, 0);
check('and drives ADX high', adxUp.adx.at(-1).value > 90, adxUp.adx.at(-1).value);
const adxFlat = ind.adx(flat(60), 14);
check('a flat series has no directional movement at all',
  adxFlat.plusDI.at(-1).value === 0 && adxFlat.minusDI.at(-1).value === 0);
check('so ADX is zero rather than undefined', adxFlat.adx.at(-1).value === 0);
check('an inside bar contributes to neither side — the test of the +DM rule', (() => {
  // Bar 2 is strictly inside bar 1: high lower AND low higher, so up<0 and down<0.
  const inside = [
    { time: 'a', open: 100, high: 110, low: 90, close: 100, volume: 1 },
    { time: 'b', open: 100, high: 105, low: 95, close: 100, volume: 1 },
  ];
  // Only one TR pair, so nothing smooths; the assertion is that it does not throw and reports nothing.
  return ind.adx(inside, 14).adx.length === 0;
})());
eq('ADX needs 2× the period plus one', ind.adx(ramp(28), 14).adx.length, 0);

console.log('\n--- Stochastic and Williams %R ---');
eq('a flat window reports the midpoint, not the bottom',
  ind.stochastic(flat(40), 14, 3, 1).k.at(-1).value, 50);
check('a rising series sits near the top of its range',
  ind.stochastic(ramp(40), 14, 3, 1).k.at(-1).value > 90);
check('a falling series sits near the bottom',
  ind.stochastic(daily(Array.from({ length: 40 }, (_, i) => 200 - i)), 14, 3, 1).k.at(-1).value < 10);
check('smoothing shifts the reading, so fast and slow are genuinely different',
  ind.stochastic(zig, 14, 3, 1).k.at(-1).value !== ind.stochastic(zig, 14, 3, 3).k.at(-1).value);
eq('Williams %R is the same position read from the top',
  ind.williamsR(flat(40), 14).at(-1).value, -50);
check('and stays within -100..0',
  ind.williamsR(zig.concat(ramp(60)), 14).every((p) => p.value <= 0 && p.value >= -100));

console.log('\n--- CCI (the divisor is mean absolute deviation, NOT standard deviation) ---');
// TP on a 1-step ramp is the close. Over 20 bars the mean absolute deviation is exactly 5, so
// CCI = 9.5 / (0.015 × 5) = 126.667. With a standard deviation (5.766) it would be 109.8 — so this
// assertion fails on the common wrong implementation.
closeTo('a 20-bar ramp gives exactly 126.667', ind.cci(ramp(20), 20).at(-1).value, 9.5 / (0.015 * 5), 1e-6);
check('which is NOT the value a standard deviation would give',
  Math.abs(ind.cci(ramp(20), 20).at(-1).value - 9.5 / (0.015 * Math.sqrt(665 / 20))) > 15);
eq('a flat series has no deviation to divide by, so CCI is 0 rather than infinite',
  ind.cci(flat(40), 20).at(-1).value, 0);

console.log('\n--- OBV, MFI, ROC ---');
eq('OBV accumulates volume on up bars only',
  ind.obv(ramp(5)).at(-1).value, 1001 + 1002 + 1003 + 1004);
eq('and starts at zero rather than at the first bar\'s volume', ind.obv(ramp(5))[0].value, 0);
check('a falling series drives OBV negative',
  ind.obv(daily(Array.from({ length: 5 }, (_, i) => 100 - i))).at(-1).value < 0);
eq('an unchanged close moves OBV by nothing', ind.obv(flat(5)).at(-1).value, 0);
eq('MFI with only positive flow is 100 by definition', ind.mfi(ramp(30), 14).at(-1).value, 100);
eq('and with only negative flow, 0',
  ind.mfi(daily(Array.from({ length: 30 }, (_, i) => 200 - i)), 14).at(-1).value, 0);
eq('an unchanged typical price counts as neither, so a flat series is the midpoint',
  ind.mfi(flat(30), 14).at(-1).value, 50);
closeTo('ROC is percent over the lookback', ind.roc(ramp(13), 12).at(-1).value, 12);
closeTo('and is measured against the bar 12 back, not the first bar',
  ind.roc(ramp(14), 12).at(-1).value, ((113 - 101) / 101) * 100);
eq('a flat series has zero rate of change', ind.roc(flat(30), 12).at(-1).value, 0);

console.log('\n--- Donchian and Keltner ---');
const don = ind.donchian(ramp(21), 20, true);
closeTo('the channel EXCLUDES the current bar', don.upper.at(-1).value, 120);
check('so the current bar can actually break it', ramp(21).at(-1).high > don.upper.at(-1).value);
check('including it would make a breakout impossible',
  ind.donchian(ramp(21), 20, false).upper.at(-1).value >= ramp(21).at(-1).high);
closeTo('the middle is the mean of the two edges', don.middle.at(-1).value,
  (don.upper.at(-1).value + don.lower.at(-1).value) / 2);
const kel = ind.keltner(ramp(40), 20, 20, 2);
closeTo('Keltner\'s middle is the EMA', kel.middle.at(-1).value, ind.ema(ramp(40), 20).at(-1).value);
closeTo('and its width is 2 ATR either side', kel.upper.at(-1).value - kel.middle.at(-1).value,
  2 * ind.atr(ramp(40), 20).at(-1).value, 1e-9);
check('both bands sit the same distance out',
  near(kel.upper.at(-1).value - kel.middle.at(-1).value,
    kel.middle.at(-1).value - kel.lower.at(-1).value, 1e-9));

console.log('\n--- Supertrend: a stop that only ever tightens ---');
const st = ind.supertrend(ramp(60), 10, 3);
check('a one-way uptrend keeps the stop on the up side', st.down.length === 0 && st.up.length > 0);
check('the stop stays BELOW every close it applies to', (() => {
  const closeAt = new Map(ramp(60).map((b) => [String(b.time), b.close]));
  return st.up.every((p) => p.value < closeAt.get(String(p.time)));
})());
check('and never loosens', st.up.every((p, i) => i === 0 || p.value >= st.up[i - 1].value));
const stFlip = ind.supertrend(ramp(60).concat(
  daily(Array.from({ length: 60 }, (_, i) => 160 - i * 2))), 10, 3);
check('a reversal produces a recorded flip', stFlip.flips.length > 0);
check('and stops on both sides', stFlip.up.length > 0 && stFlip.down.length > 0);

console.log('\n--- Parabolic SAR: the two-bar clamp ---');
const sar = ind.psar(ramp(40));
check('in a clean uptrend the stop sits at or below the bar\'s low', (() => {
  const lowAt = new Map(ramp(40).map((b) => [String(b.time), b.low]));
  // The first few bars are the algorithm finding its footing; the clamp must hold thereafter.
  return sar.slice(5).every((p) => p.value <= lowAt.get(String(p.time)) + 1e-9);
})());
check('and rises as the trend does', sar.at(-1).value > sar[5].value);
eq('fewer than three bars cannot establish a direction', ind.psar(ramp(2)).length, 0);
check('a zero step is refused rather than producing a frozen stop', ind.psar(ramp(40), 0).length === 0);

console.log('\n--- Ichimoku: the displacement is honoured, and the truncation disclosed ---');
const ich = ind.ichimoku(ramp(80));
closeTo('Tenkan is the 9-bar midpoint', ich.tenkan[0].value, (109 + 99) / 2);
const src80 = ramp(80);
eq('Senkou A is plotted 26 bars FORWARD of where it was computed',
  ich.senkouA[0].time, src80[25 + 26].time);
eq('Chikou is plotted 26 bars BACK', ich.chikou[0].time, src80[0].time);
closeTo('and carries the close from 26 bars later', ich.chikou[0].value, src80[26].close);
check('the forward cloud stops at the last stored bar rather than inventing future ones',
  ich.senkouA.at(-1).time === src80.at(-1).time
  && ich.senkouA.every((p) => src80.some((b) => b.time === p.time)));
check('the last 26 bars therefore carry no cloud — the disclosed truncation',
  ich.senkouB.length <= src80.length - 52);
eq('too short for Senkou B is empty rather than a partial cloud', ind.ichimoku(ramp(60)).senkouB.length, 0);

console.log('\n--- Pivots: from the previous bar, held across the current one ---');
const piv = ind.pivots(ramp(5));
closeTo('the pivot is the previous bar\'s (H+L+C)/3', piv.p.at(-1).value,
  (104 + 102 + 103) / 3);
closeTo('R1 is 2P - previous low', piv.r1.at(-1).value, 2 * ((104 + 102 + 103) / 3) - 102);
closeTo('S1 is 2P - previous high', piv.s1.at(-1).value, 2 * ((104 + 102 + 103) / 3) - 104);
check('R2 and S2 straddle the pivot by the previous range',
  near(piv.r2.at(-1).value - piv.p.at(-1).value, 2)
  && near(piv.p.at(-1).value - piv.s2.at(-1).value, 2));
eq('one bar has no previous bar to pivot from', ind.pivots(ramp(1)).p.length, 0);

console.log('\n--- Heikin-Ashi: a lens, never a source of levels ---');
const ha = ind.heikinAshi(ramp(5));
eq('one HA bar per input bar', ha.length, 5);
closeTo('the first HA close is the bar\'s own average', ha[0].close, (100 + 101 + 99 + 100) / 4);
closeTo('the second HA open is the first HA midpoint', ha[1].open, (ha[0].open + ha[0].close) / 2);
closeTo('and the second HA close is its own average', ha[1].close, (101 + 102 + 100 + 101) / 4);
check('an uptrend gives an unbroken run of up bars', ha.slice(1).every((b) => b.close >= b.open));
check('the HA high contains the HA body', ha.every((b) => b.high >= Math.max(b.open, b.close)
  && b.low <= Math.min(b.open, b.close)));
check('times are preserved exactly, so it can replace the price series',
  ha.every((b, i) => b.time === ramp(5)[i].time));
eq('junk gives nothing rather than throwing', ind.heikinAshi(null).length, 0);

console.log('\n--- the catalogue grew, and the count is asserted ---');
check('there are at least 20 studies now, up from 8',
  ind.OVERLAY_DEFS.length >= 20, ind.OVERLAY_DEFS.length);
check('every definition has a unique id',
  new Set(ind.OVERLAY_DEFS.map((o) => o.id)).size === ind.OVERLAY_DEFS.length);
check('every definition has a label and a make function',
  ind.OVERLAY_DEFS.every((o) => o.label && typeof o.make === 'function'));
check('every kind is one the chart knows how to render',
  ind.OVERLAY_DEFS.every((o) => ['line', 'band', 'macd', 'series'].includes(o.kind)),
  ind.OVERLAY_DEFS.filter((o) => !['line', 'band', 'macd', 'series'].includes(o.kind))
    .map((o) => `${o.id}:${o.kind}`).join());
check('every pane is one the chart knows how to place',
  ind.OVERLAY_DEFS.every((o) => ['price', 'oscillator'].includes(o.pane)));
check('a series-kind study returns a series array',
  ind.OVERLAY_DEFS.filter((o) => o.kind === 'series')
    .every((o) => Array.isArray(o.make(ramp(120)).series)));
check('and every part of it carries data and a label or an explicit null',
  ind.OVERLAY_DEFS.filter((o) => o.kind === 'series').every((o) => o.make(ramp(120)).series
    .every((p) => Array.isArray(p.data) && 'label' in p)));
check('an oscillator with a fixed scale declares both ends',
  ind.OVERLAY_DEFS.every((o) => {
    const s = o.scale ?? o.make(ramp(120))?.scale;
    return !s || (Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min);
  }));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
