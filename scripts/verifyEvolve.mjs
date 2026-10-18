#!/usr/bin/env node
/**
 * verifyEvolve.mjs - what the EVOLVE tab may say, and what it may do on its own (spec Section 151)
 *
 * The engine decides what a candidate IS (demonstrated, unproven, refused). This decides what master is TOLD,
 * and the two failure modes are both in the telling: a profitable-by-luck row read as a recommendation, and a
 * rule's state read as an instruction. So the sentences are made by pure functions (`evolveModel.js`) and
 * driven here with awkward input, and the component is read as source for the few things a render cannot show:
 * that nothing destructive runs unprompted, that no timer exists, and that every channel it calls is real.
 *
 * Run: node scripts/verifyEvolve.mjs   (or npm run verify:evolve)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/StockMind/evolveModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

// Every string reachable in a value, so a forbidden word cannot hide in a nested field.
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const forbidden = (v) => strings(v).filter((s) => M.FORBIDDEN_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)));

const row = (over = {}) => ({
  id: 'livermore_breakout', name: 'Livermore breakout', rank: 1, verdictClass: 'demonstrated',
  claim: { source: 'Lefevre', work: 'Reminiscences', year: 1923, text: 'Trade the break of a pivot on volume', evidence: 'published' },
  measurement: { trades: 74, hitRate: 0.46, expectancyPct: 1.2, payoffRatio: 2.4, profitFactor: 1.9, breakevenWinRate: 0.31, maxDrawdown: 0.12, demonstrated: true, chanceReal: 0.97, nTrials: 2, confidence: 'moderate' },
  hitRate: 0.46, inSampleHitRate: 0.52, hitRateGapPoints: 6, largeGap: false,
  selectionNoiseHitRate: 0.41, exceedsSelectionNoise: true, candidatesCompared: 9,
  foldsScored: 5, foldsPositive: 4, variantsTried: 2, tuned: true, fallbacks: 0, ...over,
});
const run = (over = {}) => ({
  ok: true, runId: 'abc', symbol: 'RELIANCE', exchange: 'NSE', interval: '1d', bars: 5000, firstBar: '2010-01-01', lastBar: '2023-09-09',
  ranked: [row()], insufficient: [], unvalidated: [], excluded: [], familyTrials: 14, refused: [], notes: [],
  costBasis: { source: 'measured', runRoundTripPct: 0.31 }, counts: {}, ...over,
});

// ── what a candidate may be called ────────────────────────────────────────────────────────────────
console.log('\n--- a candidate is called what the engine proved, and no better ---');
check('demonstrated is green and says DEMONSTRATED', M.rankedView(row()).label === 'DEMONSTRATED' && M.rankedView(row()).tone === 'good');
const unp = M.rankedView(row({ verdictClass: 'unproven' }));
check('unproven says NOT DEMONSTRATED, in amber, never green', unp.label === 'NOT DEMONSTRATED' && unp.tone === 'warn');
check('and its sentence says it is listed because profit gates the list, not because it is recommended', /not because it is recommended/.test(unp.sentence));
check('a row the engine did not stamp is treated as the WEAKEST claim, not the strongest', M.rankedView(row({ verdictClass: undefined })).label === 'NOT DEMONSTRATED');
check('so is a row stamped with something unknown', M.rankedView(row({ verdictClass: 'excellent' })).label === 'NOT DEMONSTRATED');
check('"refused" is never presented as a ranked card with a keep button', M.rankedView(row({ verdictClass: 'refused' })).canKeep === false);
check('an unproven row is kept under a label that says so', unp.keepLabel === 'Keep as not demonstrated' && M.rankedView(row()).keepLabel === 'Keep');
check('every card carries the "describes the past" disclaimer', /describes the past/.test(M.rankedView(row()).disclaimer) && /not the chance the next trade wins/.test(M.rankedView(row()).disclaimer));
check('the published claim is labelled as a claim, not a measurement', /Published claim, not measured here/.test(M.rankedView(row()).claim));
check('selection noise is explained against the number of rivals', /luckiest of 9/.test(M.rankedView(row()).selectionNoise) && /beat that/.test(M.rankedView(row()).selectionNoise));
check('failing the selection-noise bar says so', /did not beat that/.test(M.rankedView(row({ exceedsSelectionNoise: false })).selectionNoise));
check('stability is stated as "X of Y stretches"', /4 of 5 stretches/.test(M.rankedView(row()).folds));
check('every stretch positive and none positive are both said plainly',
  /every stretch paid/.test(M.rankedView(row({ foldsPositive: 5 })).folds) && /no stretch paid/.test(M.rankedView(row({ foldsPositive: 0 })).folds));
check('a large in-sample gap says the tuned result was fit to history', /fit to history/.test(M.rankedView(row({ largeGap: true, hitRateGapPoints: 22, inSampleHitRate: 0.7 })).gap));
check('an untuned strategy says it has no tuning to compare against', /no tuning/.test(M.rankedView(row({ tuned: false, inSampleHitRate: null })).gap));
check('trial counts are singular/plural correct', /^1 variant tried/.test(M.rankedView(row({ variantsTried: 1, tuned: false })).trials) && /^2 variants tried/.test(M.rankedView(row()).trials));

console.log('\n--- a missing figure is a dash, never zero ---');
const blank = M.rankedView({ id: 'x', verdictClass: 'demonstrated' });
check('no figures at all renders dashes', blank.hitRate === '—' && blank.trades === '—' && blank.expectancy === '—' && blank.drawdown === '—' && blank.chanceReal === '—');
check('a genuine zero hit rate is 0%, not a dash', M.pct(0) === '0%');
check('NaN and Infinity are dashes', M.pct(NaN) === '—' && M.pct(Infinity) === '—' && M.num(NaN) === '—');
check('junk input does not throw', (() => { try { M.rankedView(null); M.rankedView('x'); M.refusedView(null, 'excluded'); M.runView(null); M.runView({}); M.bookEntryView(null, null); M.signalView(null); M.signalView({}); return true; } catch { return false; } })());

// ── the run ───────────────────────────────────────────────────────────────────────────────────────
console.log('\n--- the headline never oversells ---');
const r1 = M.runView(run());
check('one demonstrated: says so and offers to keep it', /1 of 1 strategies was demonstrated/.test(r1.headline) && r1.canKeepAll && r1.nDemonstrated === 1);
const r0 = M.runView(run({ ranked: [row({ verdictClass: 'unproven' }), row({ id: 'b', verdictClass: 'unproven' })] }));
check('none demonstrated: says NONE was, and that luck also does this', /None of the 2 strategies was demonstrated/.test(r0.headline) && /by luck/.test(r0.headline) && r0.canKeepAll === false);
const rn = M.runView(run({ ranked: [] }));
check('nothing ranked: says that is an answer, not a failure', /Nothing was ranked/.test(rn.headline) && /That is an answer/.test(rn.headline));
const rm = M.runView(run({ ranked: [row(), row({ id: 'b', verdictClass: 'unproven' })] }));
check('a mix says how many are demonstrated and how many are not', /1 of 2/.test(rm.headline) && /not demonstrated/.test(rm.headline));
check('the cost line names the basis', /real brokerage and statutory charges/.test(r1.cost) && /0\.310%/.test(r1.cost));
check('a flat cost basis says it is flat and why', /flat percentages/.test(M.runView(run({ costBasis: { source: 'flat', runRoundTripPct: 0.2, why: 'options are priced on premium' } })).cost));
check('a failed run carries its reason and the bars it had', (() => { const v = M.runView({ ok: false, reason: 'only 100 stored bars', storedBars: 100, needBars: 250 }); return v.ok === false && v.storedBars === 100 && /only 100/.test(v.reason); })());

console.log('\n--- what was not ranked, and why ---');
const ins = M.refusedView({ id: 'tsmom_12m', name: 'Time-series momentum', reason: '9 out-of-sample trades, need 30.', needs: { tradesSoFar: 4, barsHave: 1500, barsNeeded: 6200 } }, 'insufficient');
check('it says how much history it would take', /about 6,200 bars/.test(ins.history) && /1,500 are stored/.test(ins.history), ins.history);
check('and gives the engine\'s reason verbatim', ins.why === '9 out-of-sample trades, need 30.');
check('enough history but too few trades says so instead of asking for more', /should be enough/.test(M.refusedView({ id: 'x', needs: { barsHave: 9000, barsNeeded: 4000 } }, 'insufficient').history));
check('a strategy that never traded says there is no rate to estimate from', /no trades/.test(M.refusedView({ id: 'x', needs: { tradesSoFar: 0 } }, 'insufficient').history));
check('excluded rows are titled for what they are', M.refusedView({ id: 'x' }, 'excluded').title === 'Does not pay after costs');

// ── the book ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n--- a kept strategy: three columns, and a retirement it only proposes ---');
const entry = (over = {}) => ({
  id: 'sid1', template: 'livermore_breakout', name: 'Livermore breakout', symbol: 'RELIANCE', exchange: 'NSE', interval: '1d', status: 'watch', stale: false,
  claim: { source: 'Lefevre', year: 1923, text: 'Trade the break of a pivot' },
  baseline: { measuredOn: '2026-10-01T00:00:00Z', verdictClass: 'demonstrated', outOfSample: { win_rate: 0.46, trades: 74, expectancy_pct: 1.2 } },
  current: { measuredOn: '2026-10-17T00:00:00Z', forwardBars: 200, forwardTrades: 6, verdict: { win_rate: 0.5, expectancy_pct: 0.4 } }, ...over,
});
const b1 = M.bookEntryView(entry(), null);
check('claim, baseline and current are three separate things', /Published, not measured here/.test(b1.claim) && b1.baseline.title === 'When you kept it' && b1.current.title === 'Since then');
check('the baseline and current figures are not merged', b1.baseline.hitRate === '46%' && b1.current.hitRate === '50%' && b1.baseline.trades === '74' && b1.current.trades === '6');
check('under ten forward trades it says how many more are needed', /6 of the 10 trades needed/.test(b1.current.note));
check('a never-measured strategy says so', /Not yet measured/.test(M.bookEntryView(entry({ current: null }), null).current.note));
check('no bars since keeping says to fetch newer bars', /Fetch newer bars/.test(M.bookEntryView(entry({ current: { forwardBars: 0, forwardTrades: 0, verdict: null } }), null).current.note));
const dec = M.bookEntryView(entry({ status: 'decaying' }), null);
check('a decaying strategy is PROPOSED for retirement', dec.proposeRetire === true && /proposes retiring/.test(dec.retireProposal));
check('and the proposal says it has NOT retired it', /has not retired it/.test(dec.retireProposal) && /your decision/.test(dec.retireProposal));
check('a holding strategy proposes nothing', M.bookEntryView(entry({ status: 'holding' }), null).retireProposal === null);
check('an unknown status falls back to watch, never to holding', M.bookEntryView(entry({ status: 'thriving' }), null).status === 'watch');
check('a strategy kept as not demonstrated stays labelled so for as long as it is stored',
  M.bookEntryView(entry({ baseline: { verdictClass: 'unproven', outOfSample: {} } }), null).classLabel === 'NOT DEMONSTRATED');
check('and anything not stamped demonstrated is shown as not demonstrated', M.bookEntryView(entry({ baseline: {} }), null).classLabel === 'NOT DEMONSTRATED');
check('the summary line counts what is kept', M.bookSummary({ counts: { holding: 1, watch: 2, decaying: 1, retired: 3 } }) === '4 kept: 1 holding, 2 on watch, 1 decaying.');
check('an empty book says how to fill it', /Evolve strategies above/.test(M.bookSummary({ counts: {} })) && /Evolve strategies above/.test(M.bookSummary(null)));

console.log('\n--- what the rule says now: a description, never an instruction ---');
const inTrade = M.signalView({ state: 'in-trade', entryDate: '2026-10-10', entryPrice: 2500, stopPrice: 2400, targetPrice: 2700, barsHeld: 4, unrealisedPct: 1.2, units: 40, lots: null, lastBar: '2026-10-15', barAgeDays: 2, interval: '1d' });
check('in a trade: entry, stop, target, bars held and where it stands', inTrade.label === 'IN A TRADE' && /entered 2026-10-10 at 2500\.00/.test(inTrade.text) && /Stop 2400\.00/.test(inTrade.levels) && /\+1\.20%/.test(inTrade.levels));
const cm = M.signalView({ state: 'conditions-met', indicativeStop: 2450, indicativeTarget: 2650, units: 30, lots: 2, lastBar: '2026-10-15', barAgeDays: 2, interval: '1d' });
check('conditions met: says a fill would be at the NEXT open and that the levels are indicative', /next bar open/.test(cm.text) && /indicative/.test(cm.text));
check('futures report lots as well as units', /30 units \(2 lots\)/.test(cm.sizing));
check('a risk budget below one unit says so', /below one unit/.test(M.signalView({ state: 'conditions-met', unsized: true, lastBar: 'x', barAgeDays: 0, interval: '1d' }).sizing));
check('flat is flat', M.signalView({ state: 'flat', lastBar: '2026-10-15', barAgeDays: 1, interval: '1d' }).label === 'FLAT');
check('a flat reading with a reason says it was not read', /Not read: no stored 1d bars/.test(M.signalView({ state: 'flat', reason: 'no stored 1d bars for X', lastBar: null }).text));
check('the age of the bar is always shown when known', /\(2 days old\)/.test(inTrade.age) && /\(1 day old\)/.test(M.signalView({ state: 'flat', lastBar: 'x', barAgeDays: 1, interval: '1d' }).age));
const old = M.signalView({ state: 'flat', lastBar: '2026-09-01', barAgeDays: 40, interval: '1d' });
check('an old bar is flagged as being about the past', old.stale === true && /about the past/.test(old.age));
check('a weekend is not flagged', M.signalView({ state: 'flat', lastBar: 'x', barAgeDays: 3, interval: '1d' }).stale === false);
check('a weekly series tolerates a longer gap than a daily one', M.signalView({ state: 'flat', lastBar: 'x', barAgeDays: 8, interval: '1wk' }).stale === false);
check('an unread rule says it has not been read', M.signalView(null).label === 'NOT READ');

console.log('\n--- NO ORDER LANGUAGE: no buy, no sell, no order, anywhere ---');
const every = [
  M.rankedView(row()), M.rankedView(row({ verdictClass: 'unproven' })), M.runView(run()), M.runView(run({ ranked: [] })),
  M.runView(run({ ranked: [row({ verdictClass: 'unproven' })] })), ins, M.refusedView({ id: 'x' }, 'excluded'),
  M.bookEntryView(entry(), inTrade), M.bookEntryView(entry({ status: 'decaying' }), cm), M.bookEntryView(entry({ status: 'retired' }), null),
  inTrade, cm, old, M.signalView({ state: 'flat' }), M.bookSummary({ counts: { holding: 1 } }), M.CLASS_SENTENCE, M.STATUS_SENTENCE,
  M.whyCannotEvolve({ inBridge: false }), M.whyCannotEvolve({ inBridge: true, canRequest: false }), M.evolveRequest({}),
];
const bad = forbidden(every);
check('across every sentence the tab can produce', bad.length === 0, JSON.stringify(bad));
check('the scanner itself catches the words it is meant to', forbidden(['Time to buy now']).length === 1 && forbidden(['sell at open']).length === 1 && forbidden(['place an order']).length === 1);
check('and does not trip on words that merely contain them', forbidden(['border', 'ordered by hit rate'.replace('ordered', 'sorted')]).length === 0);

console.log('\n--- refreshing on open, and the request ---');
const t = (o) => M.shouldRefreshOnOpen({ canRequest: true, inBridge: true, staleIds: ['a'], busy: false, ...o });
check('refreshes when something is stale and the user may request', t({}) === true);
check('never for a user who may only view', t({ canRequest: false }) === false);
check('never outside the desktop app', t({ inBridge: false }) === false);
check('never when nothing is stale', t({ staleIds: [] }) === false && t({ staleIds: undefined }) === false);
check('never while something else is running', t({ busy: true }) === false);
check('an evolve request needs a symbol', M.evolveRequest({ capital: 1000, riskPct: 1 }).ok === false);
check('capital must be positive', M.evolveRequest({ symbol: 'X', capital: 0, riskPct: 1 }).ok === false && M.evolveRequest({ symbol: 'X', capital: 'abc', riskPct: 1 }).ok === false);
check('risk must be above 0 and at most 10', [0, -1, 11, 'x'].every((r) => M.evolveRequest({ symbol: 'X', capital: 1000, riskPct: r }).ok === false) && M.evolveRequest({ symbol: 'X', capital: 1000, riskPct: 10 }).ok === true);
const q = M.evolveRequest({ symbol: 'RELIANCE', exchange: 'NSE', interval: '1d', capital: '200000', riskPct: '1', side: 'sideways', wider: true });
check('an unknown direction becomes "both"; wider becomes explore=wider; numbers are numbers', q.body.side === 'both' && q.body.explore === 'wider' && q.body.capital === 200000 && q.body.riskPct === 1);
check('the default search is the library as published', M.evolveRequest({ symbol: 'X', capital: 1, riskPct: 1 }).body.explore === 'library');
check('a disabled button always has a reason', [{ inBridge: false }, { inBridge: true, canRequest: false }, { inBridge: true, canRequest: true, busy: true }, { inBridge: true, canRequest: true, symbol: '' }].every((o) => typeof M.whyCannotEvolve(o) === 'string')
  && M.whyCannotEvolve({ inBridge: true, canRequest: true, symbol: 'X' }) === null);

// ── the component, read as source ─────────────────────────────────────────────────────────────────
console.log('\n--- the component: nothing destructive runs unprompted, no timer, every channel real ---');
const src = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/EvolvePanel.jsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('no setInterval, setTimeout or requestAnimationFrame: nothing runs on a timer', !/setInterval|setTimeout|requestAnimationFrame/.test(code));
const effect = code.slice(code.indexOf('useEffect(() => {'), code.indexOf('}, []);') + 6);
check('the open-effect exists and runs once (empty dependency list)', effect.length > 100 && /openedRef/.test(effect));
check('it only reads the book and refreshes the stale', /bookRefresh/.test(effect) && /bookList|loadBook/.test(effect));
check('and calls NOTHING that retires, deletes, restores or keeps', !/bookRetire|bookRemove|bookRestore|bookKeep|strategyEvolve/.test(effect));
check('its refresh is gated by the one function that decides', /shouldRefreshOnOpen\(/.test(effect));
for (const m of ['bookRetire', 'bookRemove', 'bookRestore', 'bookKeep', 'strategyEvolve']) {
  const calls = [...code.matchAll(new RegExp(`marketIntel\\.${m}\\(`, 'g'))].length;
  check(`${m} is called from a click handler only (${calls} call site${calls === 1 ? '' : 's'})`, calls >= 1 && !effect.includes(m));
}
check('deleting asks first', /window\.confirm\(/.test(code) && code.indexOf('window.confirm(') < code.indexOf('bookRemove'));
check('retire and delete are only offered to a user who may request', /canRequest && v\.status !== 'retired'/.test(code) && /canRequest && \(\s*<button[^>]*btn-danger/.test(code));
const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
const used = [...new Set([...code.matchAll(/marketIntel\.(\w+)\(/g)].map((x) => x[1]))];
check('every bridge member the panel calls exists in the preload', used.every((u) => new RegExp(`\\b${u}:\\s*\\(opts\\)`).test(pre)), used.join(','));
const glossary = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/glossary.js'), 'utf8');
const tips = [...code.matchAll(/InfoTip id="(\w+)"/g)].map((x) => x[1]);
check('every term the panel points at is defined', tips.every((id) => new RegExp(`^  ${id}: \\{`, 'm').test(glossary)), tips.join(','));
check('the strings on screen contain no forbidden word', forbidden([...code.matchAll(/>([^<>{}]{12,})</g)].map((x) => x[1])).length === 0,
  JSON.stringify(forbidden([...code.matchAll(/>([^<>{}]{12,})</g)].map((x) => x[1]))));
check('no font size is a literal number (the type scale is the only source)', !/fontSize:\s*['"]?\d/.test(code));
const sm = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/StockMind.jsx'), 'utf8');
check('StockMind lists the EVOLVE sub-tab and renders the panel for it', /\['evolve', 'EVOLVE'/.test(sm) && /strat === 'evolve'[\s\S]{0,80}<EvolvePanel/.test(sm));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
