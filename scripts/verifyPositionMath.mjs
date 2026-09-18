#!/usr/bin/env node

/**
 * verifyPositionMath.mjs — the arithmetic shown next to a real-money commit button.
 *
 * WHY THIS IS TESTED HARD (spec Section 102). Closing a position used `window.prompt`, which accepted
 * any string and showed no consequence. The replacement shows master what an exit realises before he
 * commits it — and a preview beside a Close button that is wrong is worse than no preview, because it
 * converts his caution into false confidence.
 *
 * The assertion that matters most is the SHORT case. A short's profit runs opposite to a long's, and
 * a sign taken from the exit side rather than from the held quantity inverts the P&L on every short
 * while looking entirely plausible on every long — so it would pass any test written with only long
 * fixtures, and master would see a loss reported as a gain.
 *
 * Run: node scripts/verifyPositionMath.mjs   (or npm run verify:position-math)
 */

import * as pm from '../src/pages/StockMind/positionMath.js';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const closeTo = (label, got, want, tol = 1e-6) => check(label, near(got, want, tol), `got ${got}, want ${want}`);

const LONG = { netQty: 100, avgCost: 2000, thesis: { stopPrice: 1900, targetPrice: 2300 } };
const SHORT = { netQty: -50, avgCost: 500, thesis: { stopPrice: 540, targetPrice: 430 } };

// ── Parsing what a form field actually supplies ───────────────────────────────
console.log('\n--- form values arrive as strings, blanks and junk ---');

eq('a number passes through', pm.num(12.5), 12.5);
eq('a numeric string parses', pm.num(' 2450 '), 2450);
eq('thousands separators are not an error — that is what his platform prints', pm.num('1,20,500'), 120500);
eq('an empty string is not zero', pm.num(''), null);
eq('whitespace is not zero', pm.num('   '), null);
eq('junk is null, never NaN', pm.num('abc'), null);
eq('NaN is null', pm.num(NaN), null);
eq('Infinity is null', pm.num(Infinity), null);
eq('null is null', pm.num(null), null);
eq('an object is null', pm.num({}), null);
eq('zero is a real value and survives', pm.num('0'), 0);
eq('a negative parses', pm.num('-5'), -5);

// ── The long case ─────────────────────────────────────────────────────────────
console.log('\n--- closing a long ---');

const l1 = pm.closePreview(LONG, 2300, '', 0);
check('a blank quantity means the whole position', l1.quantity === 100 && l1.ok);
closeTo('gross is (exit - cost) x qty', l1.gross, (2300 - 2000) * 100);
closeTo('net equals gross when there are no fees', l1.net, 30000);
closeTo('percent is on the cost of what was closed', l1.pctOnCost, (30000 / 200000) * 100);
eq('a full close is not partial', l1.partial, false);
eq('nothing remains', l1.remaining, 0);
eq('direction is reported', l1.direction, 'LONG');

const l2 = pm.closePreview(LONG, 2300, 40, 250);
closeTo('a partial close scales the gross', l2.gross, (2300 - 2000) * 40);
closeTo('fees come off the net, not the gross', l2.net, 12000 - 250);
closeTo('and the gross is untouched by them', l2.gross, 12000);
eq('a partial close says so', l2.partial, true);
eq('the remainder is reported', l2.remaining, 60);

const l3 = pm.closePreview(LONG, 1850, '', 100);
check('a loss is negative, not an absolute value', l3.net < 0, String(l3.net));
closeTo('and it is the full loss plus fees', l3.net, (1850 - 2000) * 100 - 100);

// ── The short case, which is the one a naive implementation gets wrong ────────
console.log('\n--- closing a short: the sign comes from the POSITION ---');

const s1 = pm.closePreview(SHORT, 430, '', 0);
eq('a negative quantity is recognised as a short', s1.direction, 'SHORT');
eq('and the flag is set', s1.isShort, true);
check('buying back BELOW the average cost is a PROFIT', s1.net > 0, String(s1.net));
closeTo('gross is (cost - exit) x qty', s1.gross, (500 - 430) * 50);
check('a long-only implementation would have reported this as a loss',
  !near(s1.gross, (430 - 500) * 50), `${s1.gross}`);

const s2 = pm.closePreview(SHORT, 560, '', 0);
check('buying back ABOVE the average cost is a LOSS', s2.net < 0, String(s2.net));
closeTo('of the right size', s2.net, (500 - 560) * 50);

const s3 = pm.closePreview(SHORT, 430, 20, 50);
eq('quantity is taken as a magnitude, so 20 closes 20 of the 50', s3.quantity, 20);
closeTo('on the short side too', s3.net, (500 - 430) * 20 - 50);
eq('and the remainder is the rest of the short', s3.remaining, 30);
const s4 = pm.closePreview(SHORT, 430, -20, 0);
eq('a negative quantity typed by hand is read as a magnitude', s4.quantity, 20);
check('and gives the same answer as the positive form',
  near(s4.gross, pm.closePreview(SHORT, 430, 20, 0).gross));

// ── Refusals, each with a reason ──────────────────────────────────────────────
console.log('\n--- every refusal names its cause ---');

const refusals = [
  ['no price', pm.closePreview(LONG, '', '', 0)],
  ['zero price', pm.closePreview(LONG, 0, '', 0)],
  ['negative price', pm.closePreview(LONG, -10, '', 0)],
  ['junk price', pm.closePreview(LONG, 'abc', '', 0)],
  ['zero quantity', pm.closePreview(LONG, 2300, 0, 0)],
  ['over-close', pm.closePreview(LONG, 2300, 150, 0)],
  ['negative fees', pm.closePreview(LONG, 2300, 10, -5)],
  ['no open quantity', pm.closePreview({ netQty: 0, avgCost: 100 }, 110, '', 0)],
  ['no average cost', pm.closePreview({ netQty: 10 }, 110, '', 0)],
  ['no position at all', pm.closePreview(null, 110, '', 0)],
];
for (const [label, r] of refusals) {
  check(`${label} is refused with a reason`,
    r.ok === false && typeof r.reason === 'string' && r.reason.length > 8, JSON.stringify(r.reason));
  check(`${label} reports no numbers at all`,
    r.net === null && r.gross === null && r.pctOnCost === null,
    `net ${r.net}, gross ${r.gross}`);
}
check('over-closing explains what it would actually be',
  /new position/.test(pm.closePreview(LONG, 2300, 150, 0).reason || ''));
check('a valid preview carries no reason', pm.closePreview(LONG, 2300, 10, 0).reason === null);

// ── Against master's own recorded thesis ──────────────────────────────────────
console.log('\n--- the exit compared against his own declarations ---');

const atTargetLong = pm.closeAgainstThesis(LONG, 2350);
check('a long at or beyond target reads as good',
  atTargetLong.some((n) => n.tone === 'good' && /target/.test(n.text)),
  JSON.stringify(atTargetLong));
check('a long below target is info, not a warning',
  pm.closeAgainstThesis(LONG, 2100).every((n) => n.tone !== 'good'),
  JSON.stringify(pm.closeAgainstThesis(LONG, 2100)));
check('a long at or past its stop warns',
  pm.closeAgainstThesis(LONG, 1880).some((n) => n.tone === 'warn' && /stop/.test(n.text)));
check('a short at or BELOW target reads as good — the comparison inverts',
  pm.closeAgainstThesis(SHORT, 420).some((n) => n.tone === 'good'));
check('a short above target is not good',
  pm.closeAgainstThesis(SHORT, 480).every((n) => n.tone !== 'good'));
check('a short at or ABOVE its stop warns',
  pm.closeAgainstThesis(SHORT, 550).some((n) => n.tone === 'warn'));
check('a short below its stop does not warn',
  pm.closeAgainstThesis(SHORT, 450).every((n) => n.tone !== 'warn'));
check('no thesis says there is nothing to compare, rather than staying silent',
  pm.closeAgainstThesis({ netQty: 10, avgCost: 100 }, 120)
    .some((n) => /nothing to compare/.test(n.text)));
eq('no price yields no notes', pm.closeAgainstThesis(LONG, '').length, 0);
eq('no position yields no notes', pm.closeAgainstThesis(null, 100).length, 0);

// ── Risk in money ─────────────────────────────────────────────────────────────
console.log('\n--- RISK % turned into an amount, and into a position size ---');

const r1 = pm.riskBudget(100000, 1.5, null, null);
check('the budget is computed', r1.ok);
closeTo('1.5% of 100,000 is 1,500', r1.amount, 1500);
eq('without a stop the size is unknown, not guessed', r1.units, null);
eq('and so is the per-unit risk', r1.perUnit, null);

const r2 = pm.riskBudget(100000, 1.5, 2000, 1900);
closeTo('the per-unit risk is the distance to the stop', r2.perUnit, 100);
eq('the size is the budget divided by it, floored to whole units', r2.units, 15);
check('a fractional unit is never offered', Number.isInteger(r2.units));
const r3 = pm.riskBudget(100000, 1.5, 1900, 2000);
closeTo('a stop above the price works too — distance is absolute', r3.perUnit, 100);
eq('a stop equal to the price gives no size rather than infinity',
  pm.riskBudget(100000, 1.5, 2000, 2000).units, null);
check('capital and percent are echoed back so the caller need not re-parse',
  r1.capital === 100000 && r1.pct === 1.5);
for (const [label, r] of [
  ['no capital', pm.riskBudget('', 1.5)],
  ['zero capital', pm.riskBudget(0, 1.5)],
  ['negative capital', pm.riskBudget(-10, 1.5)],
  ['no percent', pm.riskBudget(100000, '')],
  ['zero percent', pm.riskBudget(100000, 0)],
]) {
  check(`${label} is refused with a reason`,
    r.ok === false && typeof r.reason === 'string' && r.amount === null, JSON.stringify(r.reason));
}
check('string inputs work, because that is what the fields hold',
  near(pm.riskBudget('100000', '1.5').amount, 1500));

// ── Why a button is disabled ──────────────────────────────────────────────────
console.log('\n--- a disabled button always has a stated cause ---');

const ready = { inElectron: true, canRequest: true, busy: false, symbol: 'NIFTY50',
  capital: '100000', riskPct: '1.5', lastClose: 24000 };
eq('a ready state gives no reason', pm.whyCannotPredict(ready), null);
const cases = [
  ['no bridge', { ...ready, inElectron: false }, /desktop app/],
  ['wrong tier', { ...ready, canRequest: false }, /Operator tier/],
  ['already running', { ...ready, busy: true }, /already running/],
  ['no symbol', { ...ready, symbol: '  ' }, /instrument/],
  ['no capital', { ...ready, capital: '' }, /capital/],
  ['zero capital', { ...ready, capital: '0' }, /capital/],
  ['no risk', { ...ready, riskPct: '' }, /risk/],
  ['no history', { ...ready, lastClose: null }, /price history/],
];
for (const [label, state, re] of cases) {
  const why = pm.whyCannotPredict(state);
  check(`${label} explains itself`, typeof why === 'string' && re.test(why), String(why));
}
check('the bridge is checked before the tier, because it blocks everything',
  /desktop app/.test(pm.whyCannotPredict({ inElectron: false, canRequest: false }) || ''));
check('an empty state still returns a reason rather than claiming readiness',
  typeof pm.whyCannotPredict({}) === 'string');
check('no arguments at all does not throw', typeof pm.whyCannotPredict() === 'string');

// ── Hostile input ─────────────────────────────────────────────────────────────
console.log('\n--- hostile input does not throw ---');

for (const bad of [null, undefined, 0, '', {}, [], NaN, 'x', { netQty: 'x', avgCost: 'y' }]) {
  let threw = null;
  try {
    pm.closePreview(bad, bad, bad, bad);
    pm.closeAgainstThesis(bad, bad);
    pm.riskBudget(bad, bad, bad, bad);
    pm.whyCannotPredict(bad);
  } catch (e) { threw = e.message; }
  check(`${JSON.stringify(bad)} is handled`, threw === null, threw);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
