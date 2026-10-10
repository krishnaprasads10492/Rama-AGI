#!/usr/bin/env node
/**
 * verifyGhostMode.mjs — the zero-trace wipe, EXERCISED.
 *
 * WHY BEHAVIOURAL AND NOT A SOURCE READ (spec Section 143). Ghost Mode is what master uses before
 * handing over a device he no longer trusts. Reading it looked fine: a prefix scan, a loop, a
 * `removeItem`. The audit measured it instead and found the prefix list was `rama_`/`sm_` while
 * EVERY key this application writes is `rama.`-dotted — eight of eight survived a "complete
 * zero-trace wipe", and the function returned `undefined`, so there was nothing to notice.
 *
 * `verifyReachability.cjs` asserts the prefix list covers every key literal in `src/`, which is the
 * guard against the list going stale again. This suite asserts the WIPE ITSELF: that given a store
 * holding real keys, they are gone afterwards, and that the report says so.
 *
 * It runs against stubbed browser globals — `localStorage`, `sessionStorage`, `document`, `window` —
 * because the module under test is renderer code and this is Node. The stubs are deliberately dumb:
 * a Map with the real API shape, so a removal that does not remove is observable.
 *
 * Run: node scripts/verifyGhostMode.mjs   (or npm run verify:ghost)
 */

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ── A storage stub with the real API shape ──────────────────────────────────
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    _map: map,
  };
}

/** The real keys this application writes, taken from the audit's measurement. */
const REAL_KEYS = {
  'rama.paletteOpen': 'true',
  'rama.micMode': '"ptt"',
  'rama.micMuted': 'false',
  'rama.speechMuted': 'false',
  'rama.ramaSpeaks': 'false',
  'rama.stockmind.chart': '{"chartType":"candles"}',
  'rama.stockmind.drawings:RELIANCE': '[{"kind":"trend"}]',
  'rama.stockmind.workspace': '{"a":1}',
  // Heritage prefixes, which must still be removed.
  'rama_legacy_token': 'x',
  'sm_old_pref': 'y',
  // A key that is NOT Rāma's and must survive — a wipe that takes everything is a different defect.
  'some_other_app_setting': 'keep me',
};

const storage = makeStorage(REAL_KEYS);
const session = makeStorage({ 'rama.session': 'abc', other: 'z' });

let navigated = null;
let domBlanked = false;

globalThis.localStorage = storage;
globalThis.sessionStorage = session;
globalThis.document = {
  cookie: '',
  get body() { return { set innerHTML(_v) { domBlanked = true; } }; },
  get head() { return { set innerHTML(_v) { /* observed via body */ } }; },
  set title(_v) { /* no-op */ },
};
// Node 22 defines `navigator` as a getter-only global, so it is redefined rather than assigned.
// The module only reads `navigator.serviceWorker`, which must be absent for the no-SW path.
Object.defineProperty(globalThis, 'navigator', {
  value: {}, configurable: true, writable: true,
});
globalThis.caches = undefined;
globalThis.window = {
  localStorage: storage,
  sessionStorage: session,
  indexedDB: undefined,
  caches: undefined,
  location: {
    href: 'http://localhost:5173/',
    hostname: 'localhost',
    replace(url) { navigated = url; },
  },
  history: {
    replaceState() { /* accepted */ },
    pushState() { /* accepted */ },
  },
};

const ghost = await import('../src/services/ghostMode.js');

console.log('\nRama Ghost Mode — the wipe, run rather than read');

// ── (1) The report exists at all ────────────────────────────────────────────
// REDBY: return undefined from activateGhostMode. "It ran" and "it wiped nothing" then become the
// same observation, which is how the prefix defect survived.
const result = await ghost.activateGhostMode({ navigate: false });
check('activateGhostMode returns a report', !!result && typeof result === 'object');
check('the report names each step', !!result.steps && typeof result.steps === 'object',
  Object.keys(result.steps || {}).join(','));
eq('and it succeeded', result.ok, true);
eq('with nothing in the failed list', (result.failed || []).length, 0);

// ── (2) THE DEFECT: the dotted keys are actually gone ───────────────────────
const dotted = Object.keys(REAL_KEYS).filter((k) => k.startsWith('rama.'));
check('there were dotted keys to remove in the first place', dotted.length === 8, String(dotted.length));
const survivors = dotted.filter((k) => storage.getItem(k) !== null);
// THE ROW THAT WOULD HAVE CAUGHT IT. REDBY: drop 'rama.' from WIPE_PREFIXES.
eq('every rama.-dotted key is gone', survivors.length, 0);
if (survivors.length) console.log(`        survived: ${survivors.join(', ')}`);

eq('the rama_ heritage key is gone too', storage.getItem('rama_legacy_token'), null);
eq('and the sm_ one', storage.getItem('sm_old_pref'), null);

// ── (3) It does NOT take what is not Rāma's ─────────────────────────────────
// A wipe that clears the whole store would pass every row above and be a different defect.
eq('an unrelated application\'s key is left alone',
  storage.getItem('some_other_app_setting'), 'keep me');

// ── (4) The report lists what it removed, by name and not by value ──────────
const ls = result.steps.localStorage;
eq('the localStorage step reports success', ls.ok, true);
eq('it lists all ten of Rāma\'s keys as removed', ls.removed.length, 10);
check('each reported key really is absent now',
  ls.removed.every((k) => storage.getItem(k) === null));
check('the report carries key NAMES and no stored values',
  !JSON.stringify(ls).includes('keep me') && !JSON.stringify(ls).includes('"ptt"'));

// ── (5) Session storage ─────────────────────────────────────────────────────
eq('session storage is cleared entirely', session.length, 0);
eq('and that step reports success', result.steps.sessionStorage.ok, true);

// ── (6) navigate:false really did not navigate or blank the DOM ─────────────
// This matters: blanking the document before the caller reads the report would make the report
// unreachable by construction — the same mistake in a new shape.
eq('navigate:false did not jump to about:blank', navigated, null);
eq('and did not blank the DOM', domBlanked, false);

// ── (7) The absent-API path is handled, not thrown through ──────────────────
check('an absent indexedDB is reported as ok rather than throwing',
  result.steps.indexedDB.ok === true);
check('an absent Cache API too', result.steps.caches.ok === true);
check('and absent service workers', result.steps.serviceWorkers.ok === true);

// ── (8) A storage that refuses removal is REPORTED, not assumed away ────────
const stubborn = makeStorage({ 'rama.stuck': '1' });
stubborn.removeItem = () => { /* silently does nothing, like a quota-locked store */ };
globalThis.localStorage = stubborn;
globalThis.window.localStorage = stubborn;
const second = await ghost.activateGhostMode({ navigate: false });
// REDBY: go back to assuming removeItem worked. A removal that silently did nothing was exactly the
// failure mode here, so the verification re-read is the row that matters.
eq('a removal that silently fails is reported as failed', second.steps.localStorage.ok, false);
check('the key is named in the failed list',
  second.steps.localStorage.failed.includes('rama.stuck'),
  JSON.stringify(second.steps.localStorage.failed));
eq('and the overall report is not ok', second.ok, false);
check('with localStorage named as the failing step', second.failed.includes('localStorage'),
  JSON.stringify(second.failed));

// ── (9) The server half is honest about not being implemented ───────────────
//
// Asserted over the route source: the endpoint used to return `ok:true, 'Server wipe acknowledged'`
// after only a console.warn, under a comment claiming it signalled the main process.
const fs = await import('fs');
const route = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
const wipeBlock = /app\.post\('\/api\/ghost\/wipe'[\s\S]{0,1800}?\n\}\);/.exec(route)?.[0] || '';
check('the ghost wipe route was found', wipeBlock.length > 100, String(wipeBlock.length));
// Asserted on the RETURN EXPRESSION, not on a substring. The first version tested `!/ok:\s*true/`
// over the whole block and went red against the comment that DESCRIBES the old behaviour — the same
// trap as a pattern matching prose rather than code, which this project has now hit three times.
check('it no longer returns a success payload',
  !/res\.json\(\s*\{\s*ok:\s*true/.test(wipeBlock)
  && !/json\(\{\s*ok:\s*true/.test(wipeBlock));
check('and the payload it does return is explicitly not ok',
  /status\(501\)\.json\(\{[\s\S]{0,80}ok:\s*false/.test(wipeBlock));
check('it answers 501, so a caller can detect the server half did not happen',
  /status\(501\)/.test(wipeBlock));
check('and says plainly that nothing was deleted',
  /Nothing was deleted here/.test(wipeBlock));
check('it still requires the per-boot local token', /requireLocalToken/.test(route));

console.log('\n  held by hand, listed rather than implied:');
console.log('    - the browser APIs are STUBS. That IndexedDB, the Cache API, service workers and');
console.log('      cookies are really cleared by a real browser is not asserted here and cannot be:');
console.log('      what is asserted is that each step is attempted and its outcome reported');
console.log('    - Ghost Mode still has NO CALLER in the UI (audit H3). This suite proves it works');
console.log('      when invoked; nothing invokes it. Exposing it needs a master-only action and, for');
console.log('      the server half, a way to hand the renderer the per-boot token — which widens the');
console.log('      attack surface and is master\'s decision, not a fix');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
