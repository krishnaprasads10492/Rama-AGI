#!/usr/bin/env node
'use strict';

/**
 * verifyClaimGate.cjs — the output boundary (Section 111).
 *
 * The gate's whole value is what it refuses, so most of this asserts refusal: a fabricated citation,
 * a figure that is not in the cited source, a source that is a search-failure marker, `__proto__` as
 * an id. Two structural assertions matter as much as the behavioural ones — the withheld text must
 * never appear in `body`, and no output may carry a confidence score, which is the failure mode
 * Section 110 named and `intelligenceEngine` already ships.
 *
 * Run: node scripts/verifyClaimGate.cjs   (or npm run verify:claim-gate)
 */

const fs = require('fs');
const path = require('path');
const G = require('../electron/lib/claimGate.cjs');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

const SRC = [
  { id: 's1', domain: 'nseindia.com', title: 'RELIANCE closes at 1402.55', content: 'RELIANCE closed at 1,402.55 on 2026-09-18, up 1.4% for the session.' },
  { id: 's2', domain: 'rbi.org.in', title: 'Policy rate held', content: 'The repo rate was held at 5.50% on 2026-08-06.' },
];
const REFLEX = { positionMath: { name: 'positionMath', qty: 42, risk: 2.5 } };

console.log('\nclaim gate — grounded, reflex, or not emitted\n');

// ─── canonical figures ────────────────────────────────────────────────────────
console.log('  one figure, one string');
check('commas are not part of the number', G.canonNumber('1,402.55') === '1402.55');
check('trailing zeros do not make a different figure', G.canonNumber('0.190') === '0.19');
check('a leading decimal point is the same figure', G.canonNumber('.19') === '0.19');
check('leading zeros are dropped', G.canonNumber('007') === '7');
check('percent is stripped, deliberately', G.canonNumber('12%') === '12');
check('a negative is kept as negative', G.canonNumber('-12.50') === '-12.5');
check('negative zero is zero', G.canonNumber('-0.0') === '0');
check('a non-number is null, not NaN', G.canonNumber('twelve') === null);
check('an empty string is null', G.canonNumber('') === null);
check('a version string is not a number', G.canonNumber('1.2.3') === null);

// ─── what counts as checkable ─────────────────────────────────────────────────
console.log('\n  what a claim commits to');
const t1 = G.checkableTokens('RELIANCE closed at 1,402.55 on 2026-09-18.');
check('figures are extracted canonically', t1.numbers.includes('1402.55'), JSON.stringify(t1.numbers));
check('ISO dates are extracted whole', t1.dates.includes('2026-09-18'));
check('a date\'s parts are not demanded as separate figures',
  !t1.numbers.includes('2026') && !t1.numbers.includes('18'), JSON.stringify(t1.numbers));
check('an all-caps ticker is a name to be grounded', t1.entities.includes('RELIANCE'));

const t2 = G.checkableTokens('Rāma cannot place orders for master.');
check('Rāma naming itself is not a factual claim', t2.entities.length === 0, JSON.stringify(t2.entities));
const t3 = G.checkableTokens('Here are the options worth weighing.');
check('connective prose commits to nothing',
  t3.numbers.length === 0 && t3.dates.length === 0 && t3.entities.length === 0);
const t4 = G.checkableTokens('The NIFTY50 index fell.');
check('a sentence-initial article does not hide a following name', t4.entities.includes('NIFTY50'));
const t5 = G.checkableTokens('1. Reliance reported a profit.');
check('an ordered-list marker is structure, not a figure', t5.numbers.length === 0, JSON.stringify(t5.numbers));
const t6 = G.checkableTokens('Revenue rose 12.4% [s1]');
check('the citation itself is not demanded inside the claim',
  !t6.entities.includes('s1') && t6.numbers.includes('12.4'), JSON.stringify(t6));

// ─── segmentation ─────────────────────────────────────────────────────────────
console.log('\n  segmentation');
check('a decimal is not a sentence break', G.segment('It closed at 1402.55 today.').length === 1);
check('two sentences split', G.segment('It rose. It fell.').length === 2);
check('newlines split', G.segment('one\ntwo').length === 2);
check('empty text yields nothing', G.segment('').length === 0);
check('an abbreviation does not split mid-word', G.segment('The U.S. market rose.').length === 1);

// ─── grounded ─────────────────────────────────────────────────────────────────
console.log('\n  a claim its source actually carries');
const ok1 = G.gate({ claims: [{ text: 'RELIANCE closed at 1,402.55 on 2026-09-18.', cite: 's1' }], sources: SRC });
check('is emitted', ok1.emitted.length === 1 && ok1.withheld.length === 0, JSON.stringify(ok1.withheld));
check('as grounded', ok1.emitted[0].class === G.CLASS.GROUNDED);
check('naming the source', /RELIANCE closes/.test(ok1.emitted[0].source));
check('ok is true when nothing was withheld', ok1.ok === true);
check('and no notice is invented', ok1.notice === null, String(ok1.notice));
check('formatting differences do not break grounding — 1402.55 against "1,402.55"',
  G.gate({ claims: [{ text: 'It closed at 1402.55.', cite: 's1' }], sources: SRC }).withheld.length === 0);
check('casing is presentation, not fact — a source writing Reliance grounds a claim about RELIANCE',
  G.gate({ claims: [{ text: 'Shares of RELIANCE closed at 1402.55.', cite: 's1' }], sources: SRC }).withheld.length === 0);
check('the trailing-bracket form works without a structured cite',
  G.gate({ text: 'The repo rate was held at 5.50%. [s2]', sources: SRC }).withheld.length === 0);

// ─── the refusals ─────────────────────────────────────────────────────────────
console.log('\n  what must not get through');
const no1 = G.gate({ claims: [{ text: 'RELIANCE will reach 2000 next month.' }], sources: SRC });
check('a checkable claim with no citation is withheld', no1.withheld.length === 1 && no1.emitted.length === 0);
check('and the reason is no-citation', no1.withheld[0].reason === 'no-citation', no1.withheld[0].reason);
check('and the reason names what it asserted', /figure|name|date/.test(no1.withheld[0].detail), no1.withheld[0].detail);

const no2 = G.gate({ claims: [{ text: 'Profit rose 31%.', cite: 's9' }], sources: SRC });
check('a citation to a source never supplied is withheld', no2.withheld.length === 1);
check('and is named as fabricated', no2.withheld[0].reason === 'fabricated-citation', no2.withheld[0].reason);
check('and the detail quotes the invented id', /s9/.test(no2.withheld[0].detail));

const no3 = G.gate({ claims: [{ text: 'RELIANCE closed at 1999.99.', cite: 's1' }], sources: SRC });
check('a figure absent from the cited source is withheld', no3.withheld.length === 1);
check('and is named as unsupported', no3.withheld[0].reason === 'unsupported-figure', no3.withheld[0].reason);
check('and the missing figure is reported, not just the verdict',
  no3.withheld[0].missing.includes('1999.99'), JSON.stringify(no3.withheld[0].missing));

const no4 = G.gate({ claims: [{ text: 'The rate was held on 2026-08-07.', cite: 's2' }], sources: SRC });
check('a date one day off its source is withheld', no4.withheld.length === 1, JSON.stringify(no4.emitted));

const no5 = G.gate({ claims: [{ text: 'TATASTEEL closed at 1402.55.', cite: 's1' }], sources: SRC });
check('a name the cited source never mentions is withheld', no5.withheld.length === 1);

// Section 94's exact defect: a synthesised "source" that read as credible evidence.
const no6 = G.gate({
  claims: [{ text: 'Growth was 8%.', cite: 'sf' }],
  sources: [{ id: 'sf', domain: 'internal', content: '', fallback: true, title: 'No sources found' }],
});
check('a search-failure marker cannot ground anything', no6.withheld.length === 1);
check('and is refused as not-evidence rather than as a bad id',
  no6.withheld[0].reason === 'rejected-source', no6.withheld[0].reason);
check('and the rejection is reported in the evidence account',
  no6.evidence.rejected.length === 1 && /search-failure/.test(no6.evidence.rejected[0].why));
check('a fallback is never counted as accepted evidence', no6.evidence.accepted === 0);

const no7 = G.gate({
  claims: [{ text: 'Growth was 8%.', cite: 'e1' }],
  sources: [{ id: 'e1', domain: 'x.com', content: '   ' }],
});
check('an empty document cannot ground anything', no7.withheld.length === 1);

const no8 = G.gate({
  claims: [{ text: 'Growth was 8%.', cite: 'dup' }],
  sources: [{ id: 'dup', content: 'growth was 8%' }, { id: 'dup', content: 'growth was 3%' }],
});
check('one id over two documents makes grounding unanswerable, so it is refused',
  no8.withheld.length === 1, JSON.stringify(no8.emitted));

const no9 = G.gate({ claims: [{ text: 'Growth was 8%.', cite: '__proto__' }], sources: SRC });
check('__proto__ is a fabricated id, not a reachable object',
  no9.withheld.length === 1 && no9.withheld[0].reason === 'fabricated-citation', no9.withheld[0].reason);
const no10 = G.gate({ claims: [{ text: 'Growth was 8%.', cite: 'constructor' }], sources: SRC });
check('constructor is likewise not evidence', no10.withheld[0].reason === 'fabricated-citation');

// Found by running: this carries no digit and no ticker, so it passed as prose.
console.log('\n  a document cannot contain the future');
const f1 = G.gate({ text: 'Profit will double next year.', sources: SRC });
check('a prediction with no figures is still withheld', f1.withheld.length === 1, JSON.stringify(f1.emitted));
check('and the reason is no-citation when nothing is cited', f1.withheld[0].reason === 'no-citation');
check('and the detail names it as a prediction', /prediction|absolute/.test(f1.withheld[0].detail), f1.withheld[0].detail);
const f2 = G.gate({ claims: [{ text: 'RELIANCE will keep rising.', cite: 's1' }], sources: SRC });
check('a news article cannot ground a prediction', f2.withheld.length === 1);
check('and is refused as unsourceable, not as a missing figure',
  f2.withheld[0].reason === 'unsourceable-prediction', f2.withheld[0].reason);
const f3 = G.gate({ claims: [{ text: 'This trade is risk-free.', cite: 's1' }], sources: SRC });
check('an absolute is refused the same way', f3.withheld[0].reason === 'unsourceable-prediction');
const f4 = G.gate({ claims: [{ text: 'It is the best performer.', cite: 's1' }], sources: SRC });
check('a superlative is an absolute', f4.withheld[0].reason === 'unsourceable-prediction');
const f5 = G.gate({
  claims: [{ text: 'The projection puts it at 42.', cite: 'reflex:proj' }],
  reflexes: { proj: { name: 'projection', method: 'walk-forward', target: 42 } },
});
check('a projection record can ground a forward claim', f5.withheld.length === 0, JSON.stringify(f5.withheld));
check('a prediction is checkable content by definition', G.checkableTokens('It will rise.').modal === true);
check('ordinary past-tense prose is not modal', G.checkableTokens('It rose.').modal === false);

// ─── reflex ───────────────────────────────────────────────────────────────────
console.log('\n  what Rāma computed itself');
const r1 = G.gate({ claims: [{ text: 'The position is 42 units at 2.5 risk.', cite: 'reflex:positionMath' }], reflexes: REFLEX });
check('a deterministic record grounds its own claim', r1.withheld.length === 0, JSON.stringify(r1.withheld));
check('and is classed reflex, not grounded', r1.emitted[0].class === G.CLASS.REFLEX);
check('the reflex: prefix is optional when keying', G.indexEvidence({ reflexes: REFLEX }).accepted.has('reflex:positionMath'));
const r2 = G.gate({ claims: [{ text: 'The position is 99 units.', cite: 'reflex:positionMath' }], reflexes: REFLEX });
check('a figure the record does not contain is still withheld', r2.withheld.length === 1);
const r3 = G.gate({ claims: [{ text: 'The position is 42 units.', cite: 'reflex:unknownSkill' }], reflexes: REFLEX });
check('an unknown reflex is a fabricated citation', r3.withheld[0].reason === 'fabricated-citation');
const r4 = G.indexEvidence({ reflexes: { broken: null } });
check('a reflex with no record is rejected, not accepted', r4.rejected.has('reflex:broken') && r4.accepted.size === 0);

// ─── prose and abstention ─────────────────────────────────────────────────────
console.log('\n  prose is emitted but is never evidence');
const p1 = G.gate({ text: 'Here is what the sources support.', sources: SRC });
check('a sentence asserting no checkable fact passes', p1.emitted.length === 1 && p1.withheld.length === 0);
check('classed prose', p1.emitted[0].class === G.CLASS.PROSE);
check('and explicitly non-evidential', p1.emitted[0].evidential === false);
check('grounded count excludes prose', p1.evidence.grounded === 0);
const p2 = G.gate({ text: 'I do not know what RELIANCE will do.', sources: SRC });
check('Rāma saying it does not know is never withheld', p2.withheld.length === 0, JSON.stringify(p2.withheld));
const p3 = G.gate({ text: 'Not backtestable: the 12% figure has no free history.', sources: SRC });
check('an explicit abstention carrying a figure is still not a claim', p3.withheld.length === 0);

// ─── the body must be safe to show ────────────────────────────────────────────
console.log('\n  the emitted body');
const mixed = G.gate({
  text: 'Here is the summary. RELIANCE closed at 1,402.55 on 2026-09-18. [s1] Profit will double next year.',
  sources: SRC,
});
check('the withheld sentence is absent from the body',
  !/double/.test(mixed.body), mixed.body);
check('the grounded sentence is present', /1,402.55/.test(mixed.body));
check('the prose is present', /Here is the summary/.test(mixed.body));
check('the citation bracket is not shown to master', !/\[s1\]/.test(mixed.body), mixed.body);
check('a notice reports the withholding', typeof mixed.notice === 'string' && /Withheld 1/.test(mixed.notice), String(mixed.notice));
check('the notice says why in words, not a score',
  /no source/.test(mixed.notice), String(mixed.notice));
check('ok is false when anything was withheld', mixed.ok === false);

const allGone = G.gate({ text: 'RELIANCE will hit 5000. Profit triples in 2027.', sources: [] });
check('when nothing survives, the body is empty', allGone.body === '');
check('and that is stated rather than left to read as "no answer"',
  /could be attributed/.test(allGone.notice), String(allGone.notice));
const noEv = G.gate({ text: 'Here is a thought about it.', sources: [] });
check('prose with no evidence supplied says so', /No evidence was supplied/.test(noEv.notice || ''), String(noEv.notice));

// ─── bounds and purity ────────────────────────────────────────────────────────
console.log('\n  bounds, purity, and the one thing it must not become');
const many = G.gate({ claims: Array.from({ length: G.MAX_CLAIMS + 25 }, () => ({ text: 'A thought.' })) });
check('claim count is bounded', many.emitted.length <= G.MAX_CLAIMS);
check('truncation is reported, not silent', many.truncated === true && /first \d+ statements/.test(many.notice));
check('truncation alone makes ok false', many.ok === false);

const longClaim = G.gate({ claims: [{ text: `x `.repeat(G.MAX_CLAIM_CHARS) + 'RELIANCE 1402.55', cite: 's1' }], sources: SRC });
check('an overlong claim is clipped rather than looped over', typeof longClaim.body === 'string');

const frozenSrc = [{ id: 's1', content: 'value 5' }];
const before = JSON.stringify(frozenSrc);
G.gate({ claims: [{ text: 'The value is 5.', cite: 's1' }], sources: frozenSrc });
check('the caller\'s sources are not mutated', JSON.stringify(frozenSrc) === before);

check('no arguments at all does not throw', (() => { try { G.gate(); return true; } catch { return false; } })());
check('null sources does not throw', (() => { try { G.gate({ text: 'hi', sources: null }); return true; } catch { return false; } })());
check('a bare string claim is accepted', G.gate({ claims: ['A thought.'] }).emitted.length === 1);

const attested = G.attest(mixed);
check('the attestation records the reasons', attested.withheld[0]?.reason === 'no-citation',
  JSON.stringify(attested.withheld));
check('and does NOT keep the confabulated text',
  !JSON.stringify(attested).includes('double'), JSON.stringify(attested));

// The failure Section 110 named: a number on a sentence is "emitted as if grounded" with decimals.
const shapes = [mixed, ok1, r1, no1, allScoreFree(allGone)];
function allScoreFree(x) { return x; }
const SCORE_KEY = /confidence|probability|certainty|score|grade|likelihood/i;
check('no output object carries a confidence score', shapes.every(s => !hasScoreKey(s)), firstScoreKey(shapes));
function hasScoreKey(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return false;
  for (const [k, v] of Object.entries(obj)) {
    if (SCORE_KEY.test(k)) return true;
    if (hasScoreKey(v, depth + 1)) return true;
  }
  return false;
}
function firstScoreKey(list) {
  for (const s of list) if (hasScoreKey(s)) return JSON.stringify(Object.keys(s));
  return '';
}

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'lib', 'claimGate.cjs'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
check('the module computes no score of its own',
  !/\b(confidence|probability|likelihood)\s*[=:]/i.test(code));
check('it requires no Electron, so it stays testable', !/require\(['"]electron['"]\)/.test(code));
check('it persists nothing — an audit trail is the caller\'s to keep',
  !/writeFile|dataStore|localStorage/.test(code));
check('it makes no capability decision — attribution is not authorisation',
  !/capability|\.can\(|tier/i.test(code));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
