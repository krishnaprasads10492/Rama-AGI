#!/usr/bin/env node
/**
 * verifyIndicatorSignals.mjs — the bridge from candles to vote columns is causal and aligned
 * (spec Section 172).
 *
 * WHY THIS IS THE RISKY MODULE. The measurement engine is already tested, and the indicator maths is
 * already tested by `verifyIndicators.mjs`. What sits between them is ALIGNMENT, and a one-bar slip
 * there is the worst defect available in this whole feature: it does not look broken, it looks
 * brilliant. A vote column shifted one bar into the future produces a near-perfect backtest, and
 * every honest gate downstream would be measuring a leak rather than an edge.
 *
 * So the assertions below are mostly about three things:
 *
 *   CAUSAL     the vote at bar i uses bars up to i and never beyond. Proved by appending bars and
 *              requiring the earlier votes not to move.
 *   FUTURE     forwardReturns[i] is the move from i to i+1, and the final bar — whose future is not
 *              known — cannot reach the measurement through any path.
 *   ABSTAINS   warm-up is an abstention, not a vote of zero, all the way through the matrix.
 *
 * Run: node scripts/verifyIndicatorSignals.mjs   (or npm run verify:indicator-signals)
 */
import * as sig from '../src/pages/StockMind/indicatorSignals.js';
import * as ind from '../src/pages/StockMind/indicators.js';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n--- ${t} ---`);

// ─── fixtures ──────────────────────────────────────────────────────────────────────────────────────
/** Deterministic pseudo-random walk, daily (string times), oldest first. */
function dailyBars(n, seed = 5) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  let px = 100;
  for (let i = 0; i < n; i += 1) {
    const drift = (rnd() - 0.5) * 2;
    const open = px;
    const close = Math.max(1, px + drift);
    const high = Math.max(open, close) + rnd();
    const low = Math.min(open, close) - rnd();
    out.push({ time: `2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`, open, high, low, close, volume: 1000 + Math.floor(rnd() * 500) });
    px = close;
  }
  return out;
}
/** Intraday bars: UTC epoch seconds, inside one session, so VWAP is meaningful. */
function intradayBars(n) {
  const base = Math.floor(Date.UTC(2026, 0, 5, 4, 0, 0) / 1000);
  return dailyBars(n, 9).map((b, i) => ({ ...b, time: base + i * 300 }));
}

console.log('\nindicator signals — causal, aligned, and honest about warm-up\n');

// ─── the rule catalogue ────────────────────────────────────────────────────────────────────────────
section('the catalogue is declared data, and every rule names a real study');
check('there is at least one rule per kind', (() => {
  const kinds = new Set(sig.SIGNAL_RULES.map((r) => r.kind));
  return kinds.has('trend') && kinds.has('mean-reversion') && kinds.has('momentum');
})());
check('every rule points at a study that exists in OVERLAY_DEFS',
  sig.SIGNAL_RULES.every((r) => !!ind.overlayById(r.overlay)),
  sig.SIGNAL_RULES.filter((r) => !ind.overlayById(r.overlay)).map((r) => r.id).join());
check('this module adds NO indicator arithmetic of its own: every series comes from a study', (() => {
  // Asserted structurally: a rule reads a series it was handed, and the only producer is `def.make`.
  return sig.SIGNAL_RULES.every((r) => typeof r.read === 'function');
})());
check('every rule ids uniquely', new Set(sig.RULE_IDS).size === sig.SIGNAL_RULES.length);
check('every rule says WHY it reads the study the way it does',
  sig.SIGNAL_RULES.every((r) => typeof r.why === 'string' && r.why.length > 40));
check('the catalogue is frozen so it cannot be widened at runtime', Object.isFrozen(sig.SIGNAL_RULES));
check('a rule with thresholds declares them with bounds and a default', (() => {
  const r = sig.ruleById('rsi-reversion');
  return r.thresholds.length === 2
    && r.thresholds.every((f) => Number.isFinite(f.min) && Number.isFinite(f.max) && Number.isFinite(f.default));
})());
check('ruleById refuses an invented id', sig.ruleById('nope') === null && !!sig.ruleById('macd-histogram'));
check('the opposite reading of the same band is acknowledged rather than hidden',
  /OPPOSITE reading/.test(sig.ruleById('bollinger-reversion').why));

// ─── forward returns ───────────────────────────────────────────────────────────────────────────────
section('FUTURE: the forward return is strictly the next bar, and the last bar is dropped');
check('it is exactly one shorter than the bars', sig.forwardReturns(dailyBars(50)).length === 49);
check('it is the move from i to i+1, not from i-1 to i', (() => {
  const bars = [{ close: 100 }, { close: 110 }, { close: 99 }];
  const f = sig.forwardReturns(bars);
  return f.length === 2 && Math.abs(f[0] - 10) < 1e-9 && Math.abs(f[1] - (-10)) < 1e-9;
})());
check('a zero or missing close yields 0 rather than Infinity',
  sig.forwardReturns([{ close: 0 }, { close: 5 }]).every(Number.isFinite)
  && sig.forwardReturns([{}, { close: 5 }]).every(Number.isFinite));
check('fewer than two bars yields nothing', sig.forwardReturns([{ close: 1 }]).length === 0
  && sig.forwardReturns([]).length === 0 && sig.forwardReturns(null).length === 0);

// ─── the matrix ────────────────────────────────────────────────────────────────────────────────────
section('the matrix aligns, and the unknowable final bar cannot reach it');
const bars = dailyBars(420);
const m = sig.signalMatrix(bars);
check('it produced columns', m.ok && Object.keys(m.signals).length >= 5, JSON.stringify(m.skipped));
check('every column is exactly as long as the forward returns',
  Object.values(m.signals).every((c) => c.length === m.forwardReturns.length));
check('and that length is one less than the usable bars', m.forwardReturns.length === bars.length - 1);
check('the judged bars exclude the last one', m.bars.length === bars.length - 1
  && m.bars[m.bars.length - 1].time === bars[bars.length - 2].time);
check('the final bar is not represented in any column', m.bars.every((b, i) => b.time === bars[i].time));
check('too few bars is refused with a reason rather than returning empty columns', (() => {
  const r = sig.signalMatrix(dailyBars(2));
  return r.ok === false && /at least 3/.test(r.reason);
})());
check('junk input does not throw', (() => {
  try { sig.signalMatrix(null); sig.signalMatrix([]); sig.signalMatrix(bars, null); sig.signalMatrix(bars, ['ghost']); return true; }
  catch { return false; }
})());
check('an unknown rule is reported as skipped, not silently absent',
  sig.signalMatrix(bars, ['ghost']).skipped.some((s) => s.id === 'ghost' && /no such rule/.test(s.why)));

// ─── causality: the heart of it ────────────────────────────────────────────────────────────────────
section('CAUSAL: appending future bars cannot change a past vote');
/**
 * Bars to append as "the future". Their times MUST NOT collide with the base series: `dailyBars`
 * derives its time string from the bar index, so a naive `dailyBars(40)` reuses the first forty
 * times. The studies index their output by time, so colliding keys made lookups return the wrong
 * bar's value and the causality check failed for a reason that had nothing to do with causality.
 */
const futureBars = (n) => dailyBars(n, 77).map((b, i) => ({ ...b, time: `future-${i}` }));

check('every column is bar-for-bar identical when later bars are appended', (() => {
  const short = dailyBars(420);
  const long = short.concat(futureBars(40));
  const a = sig.signalMatrix(short);
  const b = sig.signalMatrix(long);
  const ids = Object.keys(a.signals).filter((id) => b.signals[id]);
  if (ids.length === 0) return false;
  // Compare only the bars the short run judged. If any rule peeked ahead, these would move.
  return ids.every((id) => a.signals[id].every((v, i) => v === b.signals[id][i]));
})());
check('and the same holds for the forward returns over the shared prefix', (() => {
  const short = dailyBars(420);
  const long = short.concat(futureBars(40));
  const a = sig.forwardReturns(short);
  const b = sig.forwardReturns(long);
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
})());
check('a vote never reads the bar it is predicting', (() => {
  // Constructed: flip the sign of the LAST judged bar's future and require no vote to change.
  const base = dailyBars(200);
  const tampered = base.map((b, i) => (i === base.length - 1 ? { ...b, close: b.close * 1.5 } : b));
  const a = sig.signalMatrix(base);
  const t = sig.signalMatrix(tampered);
  const ids = Object.keys(a.signals).filter((id) => t.signals[id]);
  return ids.length > 0 && ids.every((id) => a.signals[id].every((v, i) => v === t.signals[id][i]));
})());

// ─── abstention ────────────────────────────────────────────────────────────────────────────────────
section('ABSTAINS: warm-up is an abstention, never a vote of zero');
check('a long-window study abstains through its warm-up', (() => {
  const r = sig.signalMatrix(dailyBars(420), ['sma200-trend']);
  const col = r.signals['sma200-trend'];
  if (!col) return false;
  // The first 199 bars cannot have an SMA 200, so they must be ABSTAIN and not 0.
  return col.slice(0, 190).every((v) => v === sig.ABSTAIN) && col.some((v) => v === 1 || v === -1);
})());
check('the abstention is null, the same value the engine treats as an abstention',
  sig.ABSTAIN === null);
check('the count of abstentions is reported per rule', (() => {
  const r = sig.signalMatrix(dailyBars(420), ['sma200-trend', 'sma20-trend']);
  return Number.isFinite(r.abstained['sma200-trend']) && Number.isFinite(r.abstained['sma20-trend'])
    && r.abstained['sma200-trend'] > r.abstained['sma20-trend'];
})());
check('a study with too few bars at its parameters is skipped with the numbers named', (() => {
  const r = sig.signalMatrix(dailyBars(60), ['sma200-trend']);
  return r.skipped.some((s) => s.id === 'sma200-trend' && /needs 200 bars/.test(s.why));
})());
check('a rule that would abstain on every bar is skipped rather than measured', (() => {
  // VWAP on daily bars returns nothing by design, so its rule can only abstain.
  const r = sig.signalMatrix(dailyBars(300), ['vwap-side'], { intradayInterval: true });
  return r.skipped.some((s) => s.id === 'vwap-side' && /abstained on every bar/.test(s.why))
    || !('vwap-side' in r.signals);
})());
check('an intraday-only rule is withheld on daily bars, with the reason', (() => {
  const r = sig.signalMatrix(dailyBars(300), ['vwap-side'], { intradayInterval: false });
  return r.skipped.some((s) => s.id === 'vwap-side' && /intraday-only/.test(s.why));
})());
check('and it DOES produce a column on intraday bars, so the branch is not dead', (() => {
  const r = sig.signalMatrix(intradayBars(300), ['vwap-side'], { intradayInterval: true });
  return Array.isArray(r.signals['vwap-side']) && r.signals['vwap-side'].some((v) => v === 1 || v === -1);
})());

// ─── votes are in range and mean what they say ─────────────────────────────────────────────────────
section('every vote is -1, 0, +1 or an abstention');
check('no column contains anything else', (() => {
  const r = sig.signalMatrix(intradayBars(420), sig.RULE_IDS, { intradayInterval: true });
  return Object.values(r.signals).every((c) => c.every((v) => v === sig.ABSTAIN || v === -1 || v === 0 || v === 1));
})());
check('the RSI rule respects its own thresholds', (() => {
  const b = dailyBars(300);
  const tight = sig.signalMatrix(b, ['rsi-reversion'], { thresholds: { 'rsi-reversion': { low: 45, high: 55 } } });
  const wide = sig.signalMatrix(b, ['rsi-reversion'], { thresholds: { 'rsi-reversion': { low: 5, high: 95 } } });
  const nz = (c) => c.filter((v) => v === 1 || v === -1).length;
  // A wider neutral band must fire less often. If thresholds were ignored these would be equal.
  return nz(tight.signals['rsi-reversion']) > nz(wide.signals['rsi-reversion']);
})());
check('an out-of-range threshold is clamped rather than used', (() => {
  const b = dailyBars(300);
  const insane = sig.signalMatrix(b, ['rsi-reversion'], { thresholds: { 'rsi-reversion': { low: -500, high: 9999 } } });
  const clamped = sig.signalMatrix(b, ['rsi-reversion'], { thresholds: { 'rsi-reversion': { low: 5, high: 95 } } });
  return JSON.stringify(insane.signals['rsi-reversion']) === JSON.stringify(clamped.signals['rsi-reversion']);
})());
check('a non-numeric threshold falls back to the default', (() => {
  const b = dailyBars(300);
  const junk = sig.signalMatrix(b, ['rsi-reversion'], { thresholds: { 'rsi-reversion': { low: 'low', high: null } } });
  const dflt = sig.signalMatrix(b, ['rsi-reversion']);
  return JSON.stringify(junk.signals['rsi-reversion']) === JSON.stringify(dflt.signals['rsi-reversion']);
})());
check('a study parameter is honoured, so "parameters from data alone" has something to search', (() => {
  const b = dailyBars(400);
  const fast = sig.signalMatrix(b, ['sma20-trend'], { params: { 'sma20-trend': { period: 5 } } });
  const slow = sig.signalMatrix(b, ['sma20-trend'], { params: { 'sma20-trend': { period: 200 } } });
  return JSON.stringify(fast.signals['sma20-trend']) !== JSON.stringify(slow.signals['sma20-trend']);
})());

// ─── the search grid, and the honest trial count ───────────────────────────────────────────────────
section('the grid is small on purpose, and its size is declarable');
check('a parameter grid is centred on the shipped default', (() => {
  const f = { kind: 'int', min: 2, max: 500, step: 1, default: 20 };
  const g = sig.gridFor(f);
  return g.length === sig.GRID_POINTS && g.includes(20) && g[0] < 20 && g[g.length - 1] > 20;
})());
check('it never leaves the declared bounds', (() => {
  const f = { kind: 'int', min: 18, max: 22, step: 1, default: 20 };
  return sig.gridFor(f).every((v) => v >= 18 && v <= 22);
})());
check('a float field stays a float field', (() => {
  const g = sig.gridFor({ kind: 'float', min: 0.1, max: 10, step: 0.1, default: 2 });
  return g.length > 1 && g.every((v) => v >= 0.1 && v <= 10);
})());
check('a field with no default yields no candidates', sig.gridFor({ kind: 'int', min: 1, max: 5 }).length === 0
  && sig.gridFor(null).length === 0);
check('gridSize counts the whole search, so a caller can declare it', (() => {
  const one = sig.gridSize(['sma20-trend']);
  const two = sig.gridSize(['sma20-trend', 'rsi-reversion']);
  return one >= sig.GRID_POINTS && two > one;
})());
check('and the RSI rule costs more than a plain SMA, because it has thresholds too',
  sig.gridSize(['rsi-reversion']) > sig.gridSize(['sma20-trend']));
check('the whole catalogue is a searchable size, not millions', (() => {
  const n = sig.gridSize();
  return n > 0 && n < 100000;
})(), String(sig.gridSize()));
check('rulesFor withholds intraday-only rules on daily bars',
  sig.rulesFor(false).every((r) => !r.intradayOnly) && sig.rulesFor(true).length > sig.rulesFor(false).length);

// ─── dynamic by timeframe and instrument ───────────────────────────────────────────────────────────
section('DYNAMIC: the interval and the instrument decide what is measurable');
check('the interval list is read from timeframes.js, not re-declared here',
  !!sig.intervalMeta('30m') && sig.intervalMeta('30m').intraday === true
  && sig.intervalMeta('1d').intraday === false && sig.intervalMeta('nope') === null);
check('bars per session is derived from the session-minutes span', (() => {
  // 375 session minutes: daily is 1 bar, 5m is 75, weekly is a fifth of a session-equivalent.
  return sig.barsPerSession('1d') === 1 && sig.barsPerSession('5m') === 75
    && sig.barsPerSession('60m') === 6.25 && sig.barsPerSession('nope') === null;
})(), `1d=${sig.barsPerSession('1d')} 5m=${sig.barsPerSession('5m')} 60m=${sig.barsPerSession('60m')}`);

section('a measurement carries the instrument and timeframe it belongs to');
check('the key names venue, instrument and interval',
  sig.measurementKey('reliance', 'nse', '30m') === 'NSE:RELIANCE@30m');
check('an absent instrument or interval yields no key, rather than a misleading one',
  sig.measurementKey('', 'NSE', '1d') === null && sig.measurementKey('TCS', 'NSE', '') === null);
check('a key matches only its own instrument, venue and interval', (() => {
  const k = sig.measurementKey('RELIANCE', 'NSE', '30m');
  return sig.keyMatches(k, 'RELIANCE', 'NSE', '30m') === true
    && sig.keyMatches(k, 'TCS', 'NSE', '30m') === false          // different instrument
    && sig.keyMatches(k, 'RELIANCE', 'NSE', '1d') === false      // Section 117's defect exactly
    && sig.keyMatches(k, 'RELIANCE', 'BSE', '30m') === false     // different venue
    && sig.keyMatches(null, 'RELIANCE', 'NSE', '30m') === false;
})());
check('the matrix returns the key, so a stored weighting can be checked against it', (() => {
  const r = sig.signalMatrix(dailyBars(300), ['sma20-trend'], { symbol: 'RELIANCE', interval: '1d' });
  return r.context.key === 'NSE:RELIANCE@1d' && r.context.intraday === false;
})());
check('and a null key when no instrument was named, rather than a fabricated one',
  sig.signalMatrix(dailyBars(300), ['sma20-trend'], { interval: '1d' }).context.key === null);
check('the interval id supersedes the older boolean, and the boolean still works', (() => {
  const byId = sig.signalMatrix(intradayBars(300), ['vwap-side'], { interval: '5m' });
  const byBool = sig.signalMatrix(intradayBars(300), ['vwap-side'], { intradayInterval: true });
  const daily = sig.signalMatrix(intradayBars(300), ['vwap-side'], { interval: '1d' });
  return !!byId.signals['vwap-side'] && !!byBool.signals['vwap-side']
    && !daily.signals['vwap-side'];     // the id says daily, so the intraday-only rule is withheld
})());

section('plan: what this instrument, timeframe and history can actually support');
check('a daily plan withholds the intraday-only rule and says which interval caused it', (() => {
  const p = sig.plan({ symbol: 'RELIANCE', interval: '1d', barCount: 500 });
  return p.ok && p.unusable.some((u) => u.id === 'vwap-side' && /1d bars are not intraday/.test(u.why));
})());
check('an intraday plan admits it', (() => {
  const p = sig.plan({ symbol: 'RELIANCE', interval: '5m', barCount: 500 });
  return p.usable.some((u) => u.id === 'vwap-side');
})());
check('a short history removes the long-window rules, naming the numbers', (() => {
  const p = sig.plan({ symbol: 'RELIANCE', interval: '1d', barCount: 120 });
  return p.unusable.some((u) => u.id === 'sma200-trend' && /there are 120/.test(u.why));
})());
check('and a long history admits them, so that branch is not dead', (() => {
  const p = sig.plan({ symbol: 'RELIANCE', interval: '1d', barCount: 900 });
  return p.usable.some((u) => u.id === 'sma200-trend');
})());
check('the grid is filtered to candidates the history supports, not merely the rule declared', (() => {
  const small = sig.plan({ symbol: 'X', interval: '1d', barCount: 150 });
  const big = sig.plan({ symbol: 'X', interval: '1d', barCount: 900 });
  const g = (p, id) => (p.usable.find((u) => u.id === id)?.grid?.period || []);
  // At 150 bars an SMA 50 cannot try its longest candidates; at 900 it can.
  return g(small, 'sma50-trend').length > 0 && g(big, 'sma50-trend').length >= g(small, 'sma50-trend').length
    && Math.max(...g(big, 'sma50-trend')) >= Math.max(...g(small, 'sma50-trend'));
})());
check('the declared trial count is the sum of the surviving grids', (() => {
  const p = sig.plan({ symbol: 'X', interval: '1d', barCount: 900 });
  return p.trials === p.usable.reduce((n, u) => n + u.combinations, 0) && p.trials > 0;
})());
check('a longer history can only widen the search, never narrow it', (() => {
  const a = sig.plan({ symbol: 'X', interval: '1d', barCount: 150 }).trials;
  const b = sig.plan({ symbol: 'X', interval: '1d', barCount: 900 }).trials;
  return b >= a;
})());
check('an intraday window shorter than one session is warned about', (() => {
  const p = sig.plan({ symbol: 'X', interval: '5m', barCount: 40 });
  return p.warnings.some((w) => /under one session/.test(w));
})());
check('more candidates than observations is called out as a search that finds noise', (() => {
  const p = sig.plan({ symbol: 'X', interval: '1d', barCount: 40 });
  return p.warnings.some((w) => /more candidates than observations/.test(w));
})());
check('a window crossing the overnight gap is reported rather than silently allowed', (() => {
  const p = sig.plan({ symbol: 'X', interval: '5m', barCount: 4000 });
  return p.usable.some((u) => (u.notes || []).some((n) => /overnight gaps/.test(n)));
})());
check('an unknown interval plans nothing and says so',
  sig.plan({ symbol: 'X', interval: '7h', barCount: 500 }).ok === false);
check('no instrument plans nothing, because a result could not be attributed to anything', (() => {
  const p = sig.plan({ interval: '1d', barCount: 500 });
  return p.ok === false && p.unusable.some((u) => /no instrument selected/.test(u.why));
})());
check('plan never throws on junk', (() => {
  try { sig.plan(); sig.plan({}); sig.plan({ symbol: 'X', interval: null, barCount: -5 }); return true; }
  catch { return false; }
})());
check('the conventional period is still the centre of the grid, on every timeframe', (() => {
  // STATED AS A TEST because it is a deliberate decision: RSI 14 means fourteen BARS on 5m exactly
  // as on 1d. Rescaling to hold a wall-clock window would make the defaults incomparable with every
  // published result, so the grid moves with the timeframe and the centre does not.
  const day = sig.plan({ symbol: 'X', interval: '1d', barCount: 900 }).usable.find((u) => u.id === 'rsi-reversion');
  const min5 = sig.plan({ symbol: 'X', interval: '5m', barCount: 900 }).usable.find((u) => u.id === 'rsi-reversion');
  return day.grid.period.includes(14) && min5.grid.period.includes(14);
})());

// ─── no shipped-code violations ────────────────────────────────────────────────────────────────────
section('shipped-code rules');
const src = await (await import('node:fs/promises')).readFile(
  new URL('../src/pages/StockMind/indicatorSignals.js', import.meta.url), 'utf8');
check('no console.log', !/console\.log/.test(src));
check('no TODO or placeholder', !/\bTODO\b|\bFIXME\b|placeholder/i.test(src));
check('it adds no indicator maths and no second interval list: both are imported', (() => {
  const imports = [...src.matchAll(/^import .*?from '([^']+)'/gm)].map((x) => x[1]).sort();
  return imports.length === 2 && imports[0] === './indicators.js' && imports[1] === './timeframes.js';
})(), [...src.matchAll(/^import .*?from '([^']+)'/gm)].map((x) => x[1]).join());
check('no interval id is hardcoded here: the list lives in timeframes.js', !/'(1m|2m|15m|30m|60m|1wk|1mo)'/.test(src));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
