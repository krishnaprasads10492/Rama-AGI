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
eq('the daily list is exactly one shorter', ind.overlaysFor(true).length - ind.overlaysFor(false).length, 1);

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
check('every shortfall threshold matches what the maths actually needs',
  ind.OVERLAY_DEFS.filter((o) => !o.intradayOnly).every((o) => {
    const msg = ind.overlayShortfall(o.id, 1, false);
    if (!msg) return true;               // no declared threshold
    const need = parseInt(String(msg).match(/needs (\d+) bars/)?.[1] || '0', 10);
    const drew = o.make(ramp(need));
    const n = Array.isArray(drew) ? drew.length : drew.middle?.length ?? drew.macd?.length ?? 0;
    return n > 0;
  }));

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
  ind.OVERLAY_DEFS.every((o) => {
    const drew = o.make(o.intradayOnly ? twoSessions : zig.concat(ramp(300)));
    const lists = Array.isArray(drew) ? [drew] : Object.values(drew);
    return lists.every((l) => l.every((p) => Number.isFinite(p.value) && p.time !== undefined));
  }));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
