#!/usr/bin/env node
/**
 * verifyTurnSensitivity.mjs — the privacy gate's producer.
 *
 * WHY THIS MATTERS MORE THAN ITS SIZE (spec Section 144). `conversationRole.assembleTurn()` refuses a
 * sensitive turn on the cloud destination, and `verifyConversation.cjs` has asserted that refusal for
 * several sections. **Nothing ever passed the flag**, so the gate could never fire — the sixth
 * instance of a contract with no producer found by the module audit.
 *
 * `classifyTurn` is that producer. The rows below are mostly about the DIRECTION OF ERROR: this
 * classifier must fail toward private, because a false positive costs a cloud round trip (currently
 * zero cost — row 150 made this Ollama-only) while a false negative puts master's holdings in someone
 * else's log. Those two errors are not comparable, so the tie never goes to public.
 *
 * Run: node scripts/verifyTurnSensitivity.mjs   (or npm run verify:sensitivity)
 */

import { classifyTurn, isSensitiveTurn, SENSITIVE_PATTERNS } from '../src/services/turnSensitivity.js';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
const sens = (t) => classifyTurn(t).sensitive;

console.log('\nRama turn sensitivity — layer one, and it fails toward private');

// ── (1) Fail closed on anything unreadable ──────────────────────────────────
// REDBY: return `{ sensitive: false }` for a non-string. A classifier that cannot read its input
// does not know the answer is public; it knows nothing, and nothing must not be sent.
for (const [label, value] of [
  ['null', null], ['undefined', undefined], ['a number', 42], ['an object', {}],
  ['an array', []], ['a boolean', true],
]) {
  check(`${label} is sensitive, not public`, sens(value) === true);
}
check('an empty string is sensitive', sens('') === true);
check('whitespace only is sensitive', sens('   \n\t ') === true);
check('and each refusal says why',
  ['', null, 42].every((v) => (classifyTurn(v).reason || '').length > 15));

// ── (2) The patterns actually fire ──────────────────────────────────────────
const MUST_BE_PRIVATE = [
  ['my holdings', 'what are my holdings worth'],
  ['my positions', 'close my positions in RELIANCE'],
  ['my portfolio', 'how is my portfolio doing'],
  ['my p&l', 'show my pnl for the week'],
  ['the book', 'what is the avg cost on that'],
  ['unrealised', 'how much unrealised do I have'],
  ['a rupee amount', 'I put ₹4,50,000 into it'],
  ['rs amount', 'it cost Rs 12,000'],
  ['a lakh amount', 'about 3 lakh in total'],
  ['a dollar amount', 'roughly $2,500 left'],
  ['demat', 'my demat account number'],
  ['client id', 'what is my client id'],
  ['api key', 'here is my API key'],
  ['api_key', 'set the api_key for dhan'],
  ['access token', 'the access token expired'],
  ['passcode', 'I forgot my passcode'],
  ['seed phrase', 'store this seed phrase'],
  // COMPOSED AT RUNTIME, NOT WRITTEN AS A LITERAL. `verifyInvariants.cjs`'s I-SECRETS row scans
  // every tree for credential-shaped literals and went red on the first version of this fixture —
  // correctly: a test that needs a key-shaped string must not put one in a committed file, because
  // the guard cannot tell a fixture from a leak and should not try.
  ['a key-shaped string', `use ${['sk', 'NOTAREALKEYJUSTAFIXTURE'].join('-')} for that`],
  ['a bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwx'],
  ['a long opaque blob', 'token is AbCdEf0123456789AbCdEf0123456789xyz'],
  ['a PAN', 'my PAN is ABCDE1234F'],
  ['an aadhaar-shaped number', '1234 5678 9012'],
  ['pan card by name', 'where is my pan card number'],
  ['an email', 'mail it to someone@example.com'],
  ['a phone number', 'call me on +91 9876543210'],
  ['my name', 'what is my name'],
  ['my bank', 'which is my bank'],
  ['net worth', 'estimate my net worth'],
  ['the nucleus', 'what is in the nucleus'],
  ['the vault', 'open the credential vault'],
  ['the loyalty core', 'describe the loyalty core'],
];
for (const [label, text] of MUST_BE_PRIVATE) {
  const r = classifyTurn(text);
  check(`private: ${label}`, r.sensitive === true, `"${text}" -> ${r.reason}`);
}

// Every declared pattern must be exercised by at least one row above, or it is an untested rule.
const firedIds = new Set();
for (const [, text] of MUST_BE_PRIVATE) for (const id of classifyTurn(text).matched) firedIds.add(id);
const neverFired = SENSITIVE_PATTERNS.filter((p) => !firedIds.has(p.id)).map((p) => p.id);
// REDBY: add a pattern and no fixture for it. An unexercised rule is a rule nobody knows works.
check('every declared pattern is exercised by a fixture', neverFired.length === 0,
  neverFired.join(', '));
check('and every pattern carries an id and a written reason',
  SENSITIVE_PATTERNS.every((p) => p.id && typeof p.why === 'string' && p.why.length > 10));
check('the pattern list is frozen', Object.isFrozen(SENSITIVE_PATTERNS));

// ── (3) Ordinary prose is NOT swept up ──────────────────────────────────────
//
// The other direction matters too: a classifier that calls everything private is a classifier that
// has stopped classifying, and it would make the cloud destination permanently unreachable.
const MUST_BE_PUBLIC = [
  'what is a moving average',
  'explain renko charts to me',
  'summarise this paragraph',
  'how does argon2 differ from scrypt',
  'write a python function that reverses a list',
  'what time does the NSE open',
  'is RELIANCE in an uptrend',
  'compare TCS and INFY on volume',
  'what does RSI measure',
  'rebuild the user guide',
];
for (const text of MUST_BE_PUBLIC) {
  const r = classifyTurn(text);
  check(`public: "${text}"`, r.sensitive === false, r.reason);
}
check('so the classifier genuinely discriminates rather than blanket-refusing',
  MUST_BE_PUBLIC.every((t) => !sens(t)) && MUST_BE_PRIVATE.every(([, t]) => sens(t)));

// ── (4) The result never carries the secret it found ────────────────────────
// REDBY: return the matched substring instead of the pattern id. The classification is then itself a
// leak: whatever logs or renders it now holds the key.
// Same reason as the fixture above: composed, never a literal.
const fakeKey = ['sk', 'FIXTUREVALUENOTASECRET1'].join('-');
const withKey = classifyTurn(`my api key is ${fakeKey}`);
check('a match reports pattern IDS, not the matched text',
  !JSON.stringify(withKey).includes(fakeKey),
  JSON.stringify(withKey));
check('and the ids are the declared ones',
  withKey.matched.every((id) => SENSITIVE_PATTERNS.some((p) => p.id === id)),
  withKey.matched.join(','));

// ── (5) A broken rule is an unknown answer, not a public one ────────────────
// A rule that is not a RegExp at all — a damaged list, a failed import, a half-applied patch.
// REDBY: skip a malformed rule instead of refusing. A damaged rule list would then classify EVERY
// turn as public, which is the worst possible failure mode for this module.
const malformed = [{ id: 'boom', why: 'a deliberately malformed rule for this row', re: 'not a regexp' }];
const bad = classifyTurn('entirely ordinary text', { patterns: malformed });
check('a malformed rule makes the turn sensitive', bad.sensitive === true, bad.reason);
check('and names the rule that could not be applied', /boom/.test(bad.reason), bad.reason);

// A real RegExp that throws while matching.
const throwing = [{ id: 'kaboom', why: 'a rule that throws mid-match',
  re: Object.assign(/x/, { test() { throw new Error('bad rule'); } }) }];
const broken = classifyTurn('entirely ordinary text', { patterns: throwing });
check('a rule that throws makes the turn sensitive', broken.sensitive === true, broken.reason);
check('and names that rule too', /kaboom/.test(broken.reason), broken.reason);

// ── (6) Purity — the same input gives the same answer ───────────────────────
// Regexes with /g carry lastIndex between calls, which would make a classifier answer differently on
// a second identical turn. None of these use /g; this row is what keeps it that way.
check('no pattern is global or sticky, so results cannot alternate',
  SENSITIVE_PATTERNS.every((p) => !p.re.global && !p.re.sticky));
const twice = 'what are my holdings worth';
check('classifying the same turn twice agrees',
  JSON.stringify(classifyTurn(twice)) === JSON.stringify(classifyTurn(twice)));

// ── (7) isSensitiveTurn is the same decision, shorter ───────────────────────
check('isSensitiveTurn agrees with classifyTurn on every fixture',
  [...MUST_BE_PRIVATE.map(([, t]) => t), ...MUST_BE_PUBLIC]
    .every((t) => isSensitiveTurn(t) === classifyTurn(t).sensitive));

// ── (8) The producer is actually wired into Chat.jsx ───────────────────────
//
// The whole point of this module is that the gate had no producer. Asserting the classifier works
// while nothing calls it would recreate the exact defect one layer up.
const fs = await import('fs');
const chat = fs.readFileSync(new URL('../src/pages/Chat/Chat.jsx', import.meta.url), 'utf8');
check('Chat.jsx imports the classifier', /from '@services\/turnSensitivity\.js'/.test(chat));
check('and calls it on the turn', /classifyTurn\(text\)/.test(chat));
// REDBY: stop passing `sensitive`. The cloud refusal becomes unreachable again.
check('and passes the flag to converse as a real boolean',
  /sensitive:\s*!!classified\.sensitive/.test(chat));

console.log('\n  held by hand, listed rather than implied:');
console.log('    - THIS IS LAYER ONE ONLY. The planned design is three fail-closed layers with the');
console.log('      model layer injectable; no model judges a turn here. A phrasing that carries no');
console.log('      pattern — "how much did I make on that one" — reads as public to layer one, and');
console.log('      that limit is the reason the other layers were specified');
console.log('    - the fixtures are the author\'s, not a corpus. These rows prove the rules behave as');
console.log('      written; they do not measure accuracy on master\'s real phrasing');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
