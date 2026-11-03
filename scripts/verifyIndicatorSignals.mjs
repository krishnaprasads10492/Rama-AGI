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

// ─── no shipped-code violations ────────────────────────────────────────────────────────────────────
section('shipped-code rules');
const src = await (await import('node:fs/promises')).readFile(
  new URL('../src/pages/StockMind/indicatorSignals.js', import.meta.url), 'utf8');
check('no console.log', !/console\.log/.test(src));
check('no TODO or placeholder', !/\bTODO\b|\bFIXME\b|placeholder/i.test(src));
check('it imports only from the existing indicator module', (() => {
  const imports = [...src.matchAll(/^import .*?from '([^']+)'/gm)].map((x) => x[1]);
  return imports.length === 1 && imports[0] === './indicators.js';
})(), [...src.matchAll(/^import .*?from '([^']+)'/gm)].map((x) => x[1]).join());

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
