'use strict';

/**
 * verifyFunctionTracking.cjs — the record master will judge a backtest on (spec Section 138).
 *
 * THE ROW THAT MATTERS MOST is that `record()` FAILS OPEN. Every other gate in this codebase fails
 * closed, and that asymmetry is deliberate: nothing is authorised by a tracking record, so a broken
 * recorder must never break the computation it was only watching. A fail-closed recorder would turn
 * an observability feature into a new way for the app to die.
 *
 * THE SECOND is that the ring is BOUNDED and drops the OLDEST first. An unbounded per-call log grows
 * fastest exactly when the app is busiest, and it makes every autosave of its own domain slower —
 * which would trade master's stated requirement of capability "without losing speed" for a log.
 *
 * Run: node scripts/verifyFunctionTracking.cjs   (or npm run verify:tracking)
 */

const path = require('path');
const ft = require('../electron/lib/functionTracking.cjs');
const dataStore = require('../electron/dataStore.cjs');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const eq = (label, got, want) => check(label, got === want,
  `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/**
 * A fake store with `dataStore`'s shape. The real one needs Electron's `app` and an unlocked crypto
 * core, neither of which exists in a suite — which is exactly why `record`/`query` take the store as
 * an argument instead of requiring it.
 */
function fakeStore() {
  const bags = {};
  let clock = 1000;
  return {
    get: (d) => bags[d],
    set: (d, k, v) => { bags[d] = bags[d] || {}; bags[d][k] = v; },
    push: (d, k, item) => {
      bags[d] = bags[d] || {};
      if (!Array.isArray(bags[d][k])) bags[d][k] = [];
      clock += 1;
      bags[d][k].push({ ...item, _id: `id${clock}`, _ts: clock });
    },
    _bags: bags,
    _at: (t) => { clock = t; },
  };
}

console.log('\nfunction tracking — a measurement, never a cause\n');

// ── normalise: what a record must carry to answer the question it exists for ──
console.log('  normalise');
{
  const ok = ft.normalise({ module: 'projection', fn: 'cone', outcome: 'ok', ms: 12 });
  check('a well-formed record normalises', ok !== null && ok.module === 'projection', JSON.stringify(ok));

  // REDBY for each: drop the corresponding guard in `normalise`.
  // Without module AND fn a record cannot answer "for any module", which is the whole request.
  for (const bad of [
    { fn: 'cone', outcome: 'ok' },
    { module: 'projection', outcome: 'ok' },
    { module: '  ', fn: 'cone', outcome: 'ok' },
    { module: 'projection', fn: 'cone' },
    { module: 'projection', fn: 'cone', outcome: 'fine' },
    { module: 'projection', fn: 'cone', outcome: 'ok', ms: -1 },
    { module: 'projection', fn: 'cone', outcome: 'ok', ms: Number.NaN },
    { module: 'projection', fn: 'cone', outcome: 'ok', sample: -3 },
    null, undefined, 'projection', [],
  ]) {
    check(`${JSON.stringify(bad)} is refused`, ft.normalise(bad) === null,
      JSON.stringify(ft.normalise(bad)));
  }

  // A NEGATIVE DURATION IS A CLOCK PROBLEM, NOT A MEASUREMENT. Storing it would corrupt any later
  // median, which is the one derived number `summarise` reports.
  check('a zero duration is allowed — it is a measurement, unlike a negative one',
    ft.normalise({ module: 'm', fn: 'f', outcome: 'ok', ms: 0 })?.ms === 0);

  // THE WINDOW IS THE AUDITABLE PART: it is what decides, later, whether a backtest was in-sample.
  // REDBY: reinterpret or drop the window.
  const w = ft.normalise({
    module: 'backtest', fn: 'run', outcome: 'ok',
    window: { from: '2020-01-01', to: '2024-12-31' }, sample: 412,
  });
  check('the data window is kept verbatim, because it is what makes a backtest auditable',
    w?.window?.from === '2020-01-01' && w?.window?.to === '2024-12-31' && w?.sample === 412,
    JSON.stringify(w));

  check('a long detail is truncated rather than stored whole',
    ft.normalise({ module: 'm', fn: 'f', outcome: 'ok', detail: 'x'.repeat(5000) }).detail.length === 300);
}

// ── record: appends, and FAILS OPEN ───────────────────────────────────────────
console.log('\n  record — fails open, by design');
{
  const s = fakeStore();
  check('a valid record is stored', ft.record(s, { module: 'm', fn: 'f', outcome: 'ok' }) === true);
  eq('and it landed in the tracking domain', s._bags[ft.DOMAIN][ft.ARRAY_KEY].length, 1);
  check('dataStore stamped it with a time, which is what "at any point of time" needs',
    typeof s._bags[ft.DOMAIN][ft.ARRAY_KEY][0]._ts === 'number');

  // REDBY for all four: let `record` throw instead of returning false.
  for (const [label, store] of [
    ['a null store', null],
    ['a store with no push', { get: () => ({}) }],
    ['a store with no get', { push: () => {} }],
    ['a store whose push throws', { get: () => ({}), push: () => { throw new Error('disk full'); } }],
  ]) {
    let threw = null;
    let out = null;
    try { out = ft.record(store, { module: 'm', fn: 'f', outcome: 'ok' }); }
    catch (e) { threw = e.message; }
    check(`${label} returns false and does NOT throw`, threw === null && out === false,
      threw || String(out));
  }
  check('an invalid record is refused without touching the store',
    ft.record(fakeStore(), { module: 'm' }) === false);
}

// ── prune: bounded, oldest first ──────────────────────────────────────────────
console.log('\n  prune — bounded, and the OLDEST goes');
{
  const s = fakeStore();
  const rows = [];
  for (let i = 0; i < ft.CAP + 25; i += 1) {
    rows.push({ module: 'm', fn: 'f', outcome: 'ok', ms: i, _id: `i${i}`, _ts: 1000 + i });
  }
  s.set(ft.DOMAIN, ft.ARRAY_KEY, rows);
  const dropped = ft.prune(s);
  const kept = s._bags[ft.DOMAIN][ft.ARRAY_KEY];
  eq('exactly the overflow is dropped', dropped, 25);
  eq('and the ring sits at its ceiling', kept.length, ft.CAP);
  // THE DIRECTION IS THE POINT: the recent past is what validates a run. REDBY: slice the other end.
  eq('the OLDEST record went, not the newest', kept[0]._ts, 1025);
  eq('the newest is still there', kept[kept.length - 1]._ts, 1000 + ft.CAP + 24);

  // REDBY: make prune unconditional, and this goes red because an under-cap ring is left alone.
  const small = fakeStore();
  small.set(ft.DOMAIN, ft.ARRAY_KEY, [{ module: 'm', fn: 'f', outcome: 'ok', _ts: 1 }]);
  eq('an under-cap ring is not pruned', ft.prune(small), 0);
}

// ── query: any module, any point in time ──────────────────────────────────────
console.log('\n  query — any module, any window');
{
  const s = fakeStore();
  ft.record(s, { module: 'projection', fn: 'cone', outcome: 'ok', ms: 10 });
  ft.record(s, { module: 'projection', fn: 'cone', outcome: 'error', ms: 99 });
  ft.record(s, { module: 'backtest', fn: 'run', outcome: 'ok', ms: 50 });

  eq('by module', ft.query(s, { module: 'projection' }).length, 2);
  eq('by function', ft.query(s, { fn: 'run' }).length, 1);
  eq('by outcome', ft.query(s, { outcome: 'error' }).length, 1);
  eq('an unknown module matches nothing', ft.query(s, { module: 'nope' }).length, 0);
  eq('no filter returns everything', ft.query(s).length, 3);

  const all = ft.query(s);
  check('newest first, so "what just happened" is the first thing read',
    all[0]._ts > all[all.length - 1]._ts, JSON.stringify(all.map((r) => r._ts)));

  // A TIME WINDOW IS THE "at any point of time" half. REDBY: ignore from/to.
  const tsList = all.map((r) => r._ts).sort((a, b) => a - b);
  eq('a from-bound excludes earlier records', ft.query(s, { from: tsList[1] }).length, 2);
  eq('a to-bound excludes later records', ft.query(s, { to: tsList[0] }).length, 1);

  eq('a limit is honoured', ft.query(s, { limit: 1 }).length, 1);

  // REDBY: return the stored objects instead of copies.
  const got = ft.query(s, { module: 'backtest' });
  got[0].module = 'tampered';
  eq('what a reader gets is a COPY — editing it cannot rewrite the store',
    ft.query(s, { module: 'backtest' }).length, 1);

  check('a broken store yields an empty list rather than throwing',
    Array.isArray(ft.query(null)) && ft.query(null).length === 0);
}

// ── summarise: numbers, never a verdict ───────────────────────────────────────
console.log('\n  summarise — counts and a median, and NO judgement');
{
  const s = fakeStore();
  ft.record(s, { module: 'm', fn: 'f', outcome: 'ok', ms: 10 });
  ft.record(s, { module: 'm', fn: 'f', outcome: 'ok', ms: 30 });
  ft.record(s, { module: 'm', fn: 'f', outcome: 'error' });
  const sum = ft.summarise(s, { module: 'm' });
  eq('every record is counted', sum.records, 3);
  eq('outcomes are tallied', sum.byOutcome.ok, 2);
  eq('and so are the failures', sum.byOutcome.error, 1);
  eq('the median is over the TIMED records only', sum.medianMs, 20);
  eq('and it says how many were timed, so a median is never read as covering all', sum.timed, 2);

  // THE HONESTY ROW. "slow", "degraded" and "healthy" are judgements; a summary that makes one
  // invites the reader to treat correlation as cause, which is the claim this module may not make.
  // REDBY: add a verdict/grade/health/score/impact field to the return.
  const keys = Object.keys(sum).join(',');
  check('the summary carries no verdict, grade, score, health or impact field',
    !/(verdict|grade|score|health|impact|rating)/i.test(keys), keys);

  const empty = ft.summarise(fakeStore(), { module: 'nothing' });
  check('an empty window reports a null median rather than 0, because those are different facts',
    empty.records === 0 && empty.medianMs === null, JSON.stringify(empty));
}

// ── The I14 tie-in: this store is re-keyed BY CONSTRUCTION ────────────────────
console.log('\n  I14 — the domain is inside the re-keyed store');
{
  // REDBY: move tracking into a database of its own, or drop it from DOMAINS. Either leaves the
  // domain unreadable after master changes his passcode, which is the failure this row exists for.
  check('the tracking domain is one of dataStore\'s DOMAINS',
    Array.isArray(dataStore.DOMAINS) && dataStore.DOMAINS.includes(ft.DOMAIN),
    JSON.stringify(dataStore.DOMAINS));
  check('and markAllDirty is exported, which is what the re-key drives',
    typeof dataStore.markAllDirty === 'function');
  check('the module reads a bounded ceiling rather than growing without limit',
    Number.isFinite(ft.CAP) && ft.CAP > 0, String(ft.CAP));
  check('the outcome vocabulary is frozen, so a record stays queryable',
    Object.isFrozen(ft.OUTCOMES) && ft.OUTCOMES.length === 4, JSON.stringify(ft.OUTCOMES));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
