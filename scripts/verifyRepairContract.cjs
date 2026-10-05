'use strict';

/**
 * verifyRepairContract.cjs — the shape check, built BEFORE the contract it checks (spec Section 137)
 *
 * This suite exists because a prior design shipped a table whose only usable entry read `row.target`
 * — a field `dependencyAdvisor.assess` has never returned. Nothing caught it, because the fixture was
 * a hand-written object that declared the shape it wanted. So the rule here is:
 *
 *     EVERY FIXTURE IS OBTAINED BY CALLING THE REAL PRODUCER. The corpus below declares inputs and
 *     never outputs.
 *
 * It is deliberately written and driven red before `electron/lib/repairContract.cjs` exists. Until it
 * does, the presence declarations are read from `PENDING_ENTRIES` here; once it does, they are read
 * from the module. The run prints which source it used.
 *
 * `'use strict'` IS LOAD-BEARING. Measured in plain CJS: a write to a frozen object in sloppy mode
 * does not throw, it silently no-ops, so a freeze row would pass on a no-op. `strictWrite` makes the
 * mechanism explicit and the freeze row prints which mechanism proved it.
 *
 * THE TWO GUARD ROWS COME FIRST and are worth more than the rest of the suite:
 *   - a throwing corpus thunk becomes a named FAIL, never an uncaught exception. The review found
 *     `review({pinned, latest})` — which throws `TypeError: entries.map is not a function`, because
 *     `review` takes an ARRAY — by calling it. A crash on case one hides cases two onwards.
 *   - any corpus output whose JSON carries the literal `undefined` FAILs. `safeRequireFailures` is
 *     read as `f.name`/`f.reason`; the design passed `{module, error}`, which missed the branch and
 *     manufactured the id `load-undefined`. A wrong input shape that still returns an object is
 *     otherwise completely silent, and it poisons the presence census it feeds.
 *
 * Run: node scripts/verifyRepairContract.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

/** A write that throws rather than no-ops, so a freeze row proves a freeze (finding 10). */
const strictWrite = (o, k, v) => { 'use strict'; o[k] = v; };

/** An appRoot that is absent by construction, so the renderer-bundle branch is deterministic. */
const ABSENT_ROOT = path.join(os.tmpdir(), 'rama-repair-contract-corpus-absent-root');

// ─── The producers, as inputs only ────────────────────────────────────────────
//
// `module` is a repo-relative string and resolution is the SUITE's job: the contract module names its
// producers as strings too, which is what keeps it loadable under plain node — `aiProcess.cjs`
// requires `electron` at module scope and the contract must never pull that in.
//
// `pick` projects the part of a real output a case samples. It is a projection of a measured value,
// never a declaration of one, and a pick that finds nothing THROWS so the smoke row names it.

const PRODUCERS = Object.freeze([
  Object.freeze({
    id: 'dependencyAdvisor.assess',
    module: 'electron/lib/dependencyAdvisor.cjs',
    fn: 'assess',
    async: false,
    cases: Object.freeze([
      Object.freeze({ id: 'patch', args: Object.freeze([{ name: 'cors', pinned: '2.8.5', latest: '2.8.6' }]) }),
      Object.freeze({ id: 'feature', args: Object.freeze([{ name: 'express', pinned: '4.18.2', latest: '4.19.0' }]) }),
      Object.freeze({ id: 'breaking', args: Object.freeze([{ name: 'helmet', pinned: '7.1.0', latest: '8.0.0' }]) }),
      Object.freeze({ id: 'current', args: Object.freeze([{ name: 'uuid', pinned: '9.0.1', latest: '9.0.1' }]) }),
      Object.freeze({ id: 'downgrade', args: Object.freeze([{ name: 'axios', pinned: '1.7.2', latest: '1.6.8' }]) }),
      Object.freeze({ id: 'unknown', args: Object.freeze([{ name: 'chokidar', pinned: 'next', latest: '3.6.0' }]) }),
      // No `latest` AT ALL — the case that proves presence is about keys, not values.
      Object.freeze({ id: 'no-latest', args: Object.freeze([{ name: 'mongodb', pinned: '6.3.0' }]) }),
      Object.freeze({ id: 'sensitive', args: Object.freeze([{ name: 'electron', pinned: '32.0.0', latest: '32.1.0' }]) }),
      Object.freeze({
        id: 'vulnerable',
        args: Object.freeze([{
          name: 'express-rate-limit', pinned: '7.1.5', latest: '7.4.0',
          advisory: { checked: true, found: [{ id: 'GHSA-rama-fixture', fixedIn: '7.4.0' }] },
        }]),
      }),
      Object.freeze({
        id: 'held',
        args: Object.freeze([{
          name: 'vectra', pinned: '0.9.0', latest: '0.10.0',
          signals: [{ claim: 'this release is broken on windows', source: 'issue 41', date: '2026-06-01' }],
        }]),
      }),
    ]),
  }),

  Object.freeze({
    id: 'dependencyAdvisor.review',
    module: 'electron/lib/dependencyAdvisor.cjs',
    fn: 'review',
    async: false,
    // AN ARRAY. `review(entries = [])` does `entries.map(assess)`; the `{pinned, latest}` envelope
    // throws, and `review()` with no argument works, which is what hid it.
    cases: Object.freeze([
      Object.freeze({ id: 'one-row', args: Object.freeze([[{ name: 'cors', pinned: '2.8.5', latest: '2.8.6' }]]) }),
      Object.freeze({
        id: 'rows0',
        args: Object.freeze([[{ name: 'cors', pinned: '2.8.5', latest: '2.8.6' }]]),
        pick: (out) => {
          if (!out || !Array.isArray(out.rows) || out.rows.length === 0) throw new Error('review returned no rows');
          return out.rows[0];
        },
      }),
    ]),
  }),

  Object.freeze({
    id: 'startupDoctor.diagnose',
    module: 'electron/lib/startupDoctor.cjs',
    fn: 'diagnose',
    async: false,
    cases: Object.freeze([
      Object.freeze({ id: 'bare', args: Object.freeze([{}]) }),
      // `{name, reason}`, not `{module, error}`: startupDoctor reads `f.name`/`f.reason`, and the
      // wrong spelling manufactures `{id:'load-undefined', detail:'undefined did not load — undefined'}`.
      Object.freeze({
        id: 'dep-missing',
        args: Object.freeze([{ safeRequireFailures: [{ name: 'simple-git', reason: "Cannot find module 'simple-git'" }] }]),
      }),
      Object.freeze({
        id: 'prev-crash',
        args: Object.freeze([{ crashReports: [{ at: '2026-07-01T00:00:00.000Z', reason: 'renderer gone' }] }]),
      }),
      Object.freeze({ id: 'tmp-root', args: Object.freeze([{ appRoot: ABSENT_ROOT }]) }),
      // TWO DISTINCT ENTRY SHAPES, sampled separately. `report[]` is {label, pass, note}; the stable
      // ids live on `fatal[]`/`degraded[]`. Conflating them is how a declared `{id, detail}` came to
      // be asserted against a `{label, pass, note}` value.
      Object.freeze({
        id: 'report0',
        args: Object.freeze([{}]),
        pick: (out) => {
          if (!out || !Array.isArray(out.report) || out.report.length === 0) throw new Error('diagnose returned no report rows');
          return out.report[0];
        },
      }),
      Object.freeze({
        id: 'degraded0',
        args: Object.freeze([{ appRoot: ABSENT_ROOT }]),
        // By id, not by index: the optional-dependency entries are pushed before the renderer one, so
        // `degraded[0]` depends on what resolves on this machine.
        pick: (out) => {
          const entry = (out && Array.isArray(out.degraded) ? out.degraded : [])
            .find(d => d && d.id === 'renderer-missing');
          if (!entry) throw new Error('no renderer-missing entry on degraded[]');
          return entry;
        },
      }),
    ]),
  }),

  Object.freeze({
    id: 'aiProcess.diagnoseFailure',
    module: 'electron/ipc/aiProcess.cjs',
    fn: 'diagnoseFailure',
    async: false,
    // All EIGHT branches. One sample cannot tell "this producer never emits this field" from "this
    // call did not reach the branch that emits it"; `silent` is on exactly two of the eight.
    cases: Object.freeze([
      Object.freeze({ id: 'missing-package', args: Object.freeze([{ stderr: ["ModuleNotFoundError: No module named 'fastapi'"], exit: { code: 1 } }]) }),
      Object.freeze({ id: 'syntax-error', args: Object.freeze([{ stderr: ['  File "engine/models.py", line 12', 'SyntaxError: invalid syntax'], exit: { code: 1 } }]) }),
      Object.freeze({ id: 'port-bound', args: Object.freeze([{ stderr: ['ERROR: [Errno 10048] error while attempting to bind on address'], exit: { code: 1 } }]) }),
      Object.freeze({ id: 'no-interpreter', args: Object.freeze([{ stderr: ['[ai_backend] could not start: Python was not found on PATH'] }]) }),
      Object.freeze({ id: 'nonzero-exit', args: Object.freeze([{ stderr: ['something unexpected'], exit: { code: 3, interpreter: 'py' } }]) }),
      Object.freeze({ id: 'alive-silent', args: Object.freeze([{ stderr: [], exit: null, running: true, interpreter: 'C:/py/python.exe' }]) }),
      Object.freeze({ id: 'never-spawned', args: Object.freeze([{ stderr: [], exit: null, running: false, interpreter: 'python', backendDir: 'C:/app/resources/ai_backend' }]) }),
      Object.freeze({ id: 'started-no-answer', args: Object.freeze([{ stderr: ['INFO: Started server process'], exit: { code: 0 } }]) }),
    ]),
  }),

  Object.freeze({
    id: 'ollamaCatalog.classify',
    module: 'electron/lib/ollamaCatalog.cjs',
    fn: 'classify',
    async: false,
    // Five cases chosen to cover all four `evidence` values and all three `cloud` values, which is
    // the strongest shape coverage five cases can carry.
    cases: Object.freeze([
      Object.freeze({ id: 'catalog-cloud', args: Object.freeze([{ name: 'kimi-k2:latest', size: 1024 }, { cloud: true }]) }),
      Object.freeze({ id: 'catalog-local', args: Object.freeze([{ name: 'llama3:8b', size: 4000000000 }, { cloud: false }]) }),
      Object.freeze({ id: 'name-marker', args: Object.freeze([{ name: 'qwen3-coder:480b-cloud', size: 2048 }, null]) }),
      Object.freeze({ id: 'size-cloud', args: Object.freeze([{ name: 'minimax-m2:230b', size: 52428800 }, null]) }),
      Object.freeze({ id: 'inconclusive', args: Object.freeze([{ name: 'mystery:latest' }, null]) }),
    ]),
  }),

  Object.freeze({
    id: 'selfModel.describe',
    module: 'electron/lib/selfModel.cjs',
    fn: 'describe',
    // AsyncFunction. Unawaited, every field measures as absent and the whole census is wrong.
    async: true,
    cases: Object.freeze([
      Object.freeze({ id: 'bare', args: Object.freeze([]) }),
      Object.freeze({
        id: 'probed',
        args: Object.freeze([{
          app: () => ({ name: 'Rama', version: '1.0.0', packaged: false }),
          nucleus: () => ({ sealed: true, verified: true }),
          instance: () => ({ role: 'primary', genesExpressed: 40, totalGenes: 42 }),
          serves: () => 'Krishna Prasad',
        }]),
      }),
    ]),
  }),
]);

/** Measured case counts and distinct key-set counts. A corpus that collapsed to one shape is red. */
const CORPUS_SHAPE = Object.freeze({
  'dependencyAdvisor.assess': Object.freeze({ cases: 10, keySets: 1 }),
  'dependencyAdvisor.review': Object.freeze({ cases: 2, keySets: 2 }),
  'startupDoctor.diagnose': Object.freeze({ cases: 6, keySets: 3 }),
  'aiProcess.diagnoseFailure': Object.freeze({ cases: 8, keySets: 2 }),
  'ollamaCatalog.classify': Object.freeze({ cases: 5, keySets: 1 }),
  'selfModel.describe': Object.freeze({ cases: 2, keySets: 1 }),
});

/**
 * The ONE declared exception to the undefined-literal guard, and the reason it is declared rather
 * than hidden.
 *
 * MEASURED: `assess({name, pinned})` builds its prose with `buildMeaning`, whose fall-through reads
 * `${name} ${pinned} → ${latest}` — so with no `latest` the sentence master would be shown contains
 * the word `undefined`. That is a real defect in shipped prose, not a wrong fixture, and fixing it
 * changes what master sees, which is out of this suite's scope. It is therefore named, scoped to the
 * one field it occurs in, and ASSERTED STILL LIVE: the day the prose is fixed, the staleness row goes
 * red and the exception is removed. An exception that cannot expire is a waiver.
 */
const DECLARED_UNDEFINED_LITERALS = Object.freeze([Object.freeze({
  producerId: 'dependencyAdvisor.assess',
  caseId: 'no-latest',
  field: 'meaning',
  why: 'buildMeaning interpolates an absent `latest` into master-facing prose '
    + '(dependencyAdvisor.cjs buildMeaning fall-through) — a shipped prose defect, named not waived',
})]);

/**
 * The presence declarations, until `electron/lib/repairContract.cjs` exists.
 *
 * Only the two entries that NAME a producer appear here. The other four unreachable entries name no
 * producer at all, so they contribute no presence row — and listing them with an empty `blockedOn`
 * would be a second list, which is how two lists come to disagree.
 */
const PENDING_ENTRIES = Object.freeze([
  Object.freeze({
    editId: 'pin-version',
    producerModule: 'electron/lib/dependencyAdvisor.cjs',
    producerFn: 'assess',
    reads: Object.freeze([
      Object.freeze({ path: 'name', presence: 'always' }),
      // `always`, measured: the key is emitted even when the input omitted it, valued `undefined`.
      // The falsy-`latest` refusal in `fires` is therefore driven by VALUE, not by presence.
      Object.freeze({ path: 'latest', presence: 'always' }),
      Object.freeze({ path: 'jump', presence: 'always' }),
    ]),
  }),
  Object.freeze({
    editId: 'name-engine-cause',
    trigger: null,
    blockedOn: Object.freeze({
      producerModule: 'electron/ipc/aiProcess.cjs',
      producerFn: 'diagnoseFailure',
      missingFields: Object.freeze(['causeId']),
      why: 'FR-A32 — eight branches return {reason, remedy} (+ silent on two) and no stable id',
    }),
  }),
]);

/**
 * Presence witnesses: measured facts about the corpus that no entry declares, pinned with their exact
 * counts so the census cannot drift quietly.
 */
const WITNESSES = Object.freeze([
  Object.freeze({
    producerId: 'aiProcess.diagnoseFailure', dottedPath: 'silent',
    presence: 'sometimes', hits: 2, total: 8,
    why: 'two of eight branches are the silent ones — one sample would have read this as never or always',
  }),
  Object.freeze({
    producerId: 'dependencyAdvisor.assess', dottedPath: 'latest',
    presence: 'always', hits: 10, total: 10,
    why: 'rule 1 — an own key valued undefined counts PRESENT, so no-latest still measures present',
  }),
  Object.freeze({
    producerId: 'dependencyAdvisor.assess', dottedPath: 'security.state',
    presence: 'always', hits: 10, total: 10,
    why: 'the dotted path walks into a nested object',
  }),
  Object.freeze({
    producerId: 'dependencyAdvisor.assess', dottedPath: 'target',
    presence: 'never', hits: 0, total: 10,
    why: 'the field the prior table read — absent from all ten cases, which is the whole reason for this suite',
  }),
  Object.freeze({
    producerId: 'selfModel.describe', dottedPath: 'identity.name.why',
    presence: 'sometimes', hits: 1, total: 2,
    why: 'unmeasured() carries a why, fact() does not — the same field is two shapes',
  }),
  Object.freeze({
    producerId: 'startupDoctor.diagnose', dottedPath: 'label',
    presence: 'sometimes', hits: 1, total: 6,
    why: 'report[] is {label, pass, note} and degraded[] is {id, detail, remedy} — two distinct shapes',
  }),
]);

/**
 * Every assertion carries the mutation that would turn it red, and each one below was DRIVEN red by
 * exactly that mutation and restored (recorded in spec Section 137.3). A label with no entry FAILs.
 */
const REDBY = Object.freeze([
  Object.freeze({ prefix: 'producer ', redby: 'set `fn` to a name the module does not export — assess to assessx' }),
  Object.freeze({ prefix: 'smoke: ', redby: 'restore the review({pinned, latest}) envelope; review takes an ARRAY, so it throws `entries.map is not a function`' }),
  Object.freeze({ prefix: 'no-undefined: ', redby: 'restore safeRequireFailures: [{module, error}] on the dep-missing case' }),
  Object.freeze({ prefix: 'declared undefined exception ', redby: 'point the exception at a case that carries no such literal — which is what fixing buildMeaning would do' }),
  Object.freeze({ prefix: 'corpus: ', redby: "delete a case from that producer's case list" }),
  Object.freeze({ prefix: 'presence rule ', redby: 'make pathPresent test truthiness instead of hasOwnProperty' }),
  Object.freeze({ prefix: 'entry read presence: ', redby: 'declare a reads path the producer never returns, e.g. target' }),
  Object.freeze({ prefix: 'blockedOn inversion: ', redby: 'declare a missingFields path the producer DOES return (silent) — what adding causeId to diagnoseFailure would do' }),
  Object.freeze({ prefix: 'witness: ', redby: "change that witness's declared hits by one" }),
  Object.freeze({ prefix: 'frozen: ', redby: 'drop the Object.freeze from that declared table' }),
  Object.freeze({ prefix: 'declaration source ', redby: 'fall back to [] instead of PENDING_ENTRIES when the contract module is absent' }),
  Object.freeze({ prefix: 'codeView is requirable ', redby: 'print from verifyCommentCensus.cjs at require time, which is what removing its require.main guard does' }),
  Object.freeze({ prefix: 'REDBY ', redby: 'add an assertion whose label matches no declared prefix' }),
]);

// ─── Measurement ──────────────────────────────────────────────────────────────

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Does `dottedPath` EXIST on `value`? Key presence, never truthiness. */
function pathPresent(value, segments) {
  let cur = value;
  for (let i = 0; i < segments.length; i += 1) {
    if (cur === null || (typeof cur !== 'object' && typeof cur !== 'function')) return false;
    if (!own(cur, segments[i])) return false;
    if (i === segments.length - 1) return true;
    cur = cur[segments[i]];
  }
  return false;
}

/** `editId`-independent producer id, DERIVED from the two authored fields rather than restated. */
function producerIdOf(moduleRel, fn) {
  if (!moduleRel || !fn) return null;
  return `${path.basename(String(moduleRel), '.cjs')}.${fn}`;
}

/**
 * The window around the first occurrence of `needle`, so the failure shows the manufactured value
 * rather than the first 200 characters of an output that happens to be long.
 */
function around(text, needle, span = 110) {
  const s = String(text);
  const at = s.indexOf(needle);
  if (at === -1) return s.slice(0, span * 2);
  const from = Math.max(0, at - span);
  const to = Math.min(s.length, at + needle.length + span);
  return `${from > 0 ? '...' : ''}${s.slice(from, to)}${to < s.length ? '...' : ''}`;
}

function keySetOf(value) {
  if (value === null || typeof value !== 'object') return `<${typeof value}>`;
  return Object.keys(value).sort().join(',');
}

// ─── The suite ────────────────────────────────────────────────────────────────

async function main() {
  let pass = 0;
  let fail = 0;
  const emitted = [];

  function check(label, ok, detail) {
    emitted.push(label);
    if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
    else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
  }

  console.log('\nthe repair contract — fixtures built by calling the real producer\n');

  // ── Resolve the producer modules ────────────────────────────────────────────
  //
  // The electron stub from verifyEngineDiagnosis.cjs, reused as written: patch the resolver, seed the
  // cache, require by path, restore. `aiProcess.cjs` requires `electron` at module scope.
  const realResolve = Module._resolveFilename;
  Module._resolveFilename = function patched(request, ...rest) {
    if (request === 'electron') return 'electron-stub';
    return realResolve.call(this, request, ...rest);
  };
  require.cache['electron-stub'] = {
    id: 'electron-stub', filename: 'electron-stub', loaded: true,
    exports: { app: { getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] } },
  };

  const loaded = new Map();
  for (const p of PRODUCERS) {
    if (loaded.has(p.module)) continue;
    try { loaded.set(p.module, require(path.join(ROOT, p.module))); }
    catch (e) { loaded.set(p.module, { __loadError: e.message }); }
  }
  Module._resolveFilename = realResolve;

  console.log('  the producers resolve, and the named function is a function');
  for (const p of PRODUCERS) {
    const mod = loaded.get(p.module);
    const err = mod && mod.__loadError;
    check(`producer ${p.id} resolves ${p.module} and exports ${p.fn}()`,
      !err && !!mod && typeof mod[p.fn] === 'function',
      err ? `load failed: ${err}` : `typeof ${p.fn} is ${mod ? typeof mod[p.fn] : 'unresolvable'}`);
  }

  // ── GUARD ROW 1: a throwing thunk is a named FAIL, never an uncaught exception ──
  console.log('\n  guard 1 — every corpus thunk returns without throwing');
  /** Map<producerId, Array<{caseId, out, ok}>> */
  const corpus = new Map();
  for (const p of PRODUCERS) {
    const mod = loaded.get(p.module);
    const rows = [];
    for (const c of p.cases) {
      let out = null;
      let ok = false;
      let detail = '';
      try {
        const thunk = () => mod[p.fn](...c.args);
        const raw = p.async ? await thunk() : thunk();
        out = c.pick ? c.pick(raw) : raw;
        ok = true;
      } catch (e) { detail = `threw: ${e.message}`; }
      check(`smoke: ${p.id} case ${c.id} returns without throwing`, ok, detail);
      if (ok) rows.push({ caseId: c.id, out });
    }
    corpus.set(p.id, rows);
  }

  // ── GUARD ROW 2: no corpus output carries the literal `undefined` ──
  console.log('\n  guard 2 — no corpus output carries the literal "undefined"');
  for (const p of PRODUCERS) {
    for (const row of corpus.get(p.id)) {
      const json = JSON.stringify(row.out);
      const carries = typeof json === 'string' && json.includes('undefined');
      const allowed = DECLARED_UNDEFINED_LITERALS
        .find(x => x.producerId === p.id && x.caseId === row.caseId);
      if (!carries) {
        check(`no-undefined: ${p.id} case ${row.caseId} output has no literal "undefined"`, true);
        continue;
      }
      if (!allowed) {
        check(`no-undefined: ${p.id} case ${row.caseId} output has no literal "undefined"`, false,
          `output contains the literal "undefined": ${around(json, 'undefined')}`);
        continue;
      }
      // Declared — but only in the one field it was declared for, and nowhere else.
      const rest = { ...row.out };
      delete rest[allowed.field];
      const restJson = JSON.stringify(rest);
      check(`no-undefined: ${p.id} case ${row.caseId} carries it only in the declared field "${allowed.field}"`,
        typeof restJson === 'string' && !restJson.includes('undefined'),
        `the literal also appears outside ${allowed.field}: ${around(restJson, 'undefined')}`);
      console.log(`        declared exception: ${allowed.why}`);
    }
  }

  console.log('\n  guard 2 — each declared exception is still live');
  for (const x of DECLARED_UNDEFINED_LITERALS) {
    const row = (corpus.get(x.producerId) || []).find(r => r.caseId === x.caseId);
    const json = row ? JSON.stringify(row.out) : undefined;
    check(`declared undefined exception ${x.producerId}/${x.caseId} still reproduces`,
      typeof json === 'string' && json.includes('undefined'),
      'the literal is gone — the defect was fixed, so delete the exception');
  }

  // ── The corpus census, printed every run ───────────────────────────────────
  console.log('\n  corpus census');
  for (const p of PRODUCERS) {
    const rows = corpus.get(p.id);
    const sets = new Map();
    for (const row of rows) {
      const k = keySetOf(row.out);
      if (!sets.has(k)) sets.set(k, []);
      sets.get(k).push(row.caseId);
    }
    console.log(`\n    ${p.id} -> ${rows.length} cases -> ${sets.size} distinct key sets`);
    for (const [k, ids] of sets) console.log(`        [${k}]  <- ${ids.join(', ')}`);
    const want = CORPUS_SHAPE[p.id];
    check(`corpus: ${p.id} produced ${want.cases} cases`, rows.length === want.cases,
      `measured ${rows.length}`);
    check(`corpus: ${p.id} produced ${want.keySets} distinct key sets`, sets.size === want.keySets,
      `measured ${sets.size}: ${[...sets.keys()].join(' | ')}`);
  }

  // ── presenceOf, and its three rules ────────────────────────────────────────

  /** `'always' | 'sometimes' | 'never'` over a producer's whole corpus. */
  function presenceOf(producerId, dottedPath) {
    return measure(producerId, dottedPath).presence;
  }

  function measure(producerId, dottedPath) {
    const rows = corpus.get(producerId) || [];
    const segments = String(dottedPath).split('.');
    let hits = 0;
    for (const row of rows) if (pathPresent(row.out, segments)) hits += 1;
    const total = rows.length;
    const presence = hits === 0 ? 'never' : (hits === total ? 'always' : 'sometimes');
    return { presence, hits, total };
  }

  console.log('\n  rule 1 — key presence, never truthiness');
  {
    const row = (corpus.get('dependencyAdvisor.assess') || []).find(r => r.caseId === 'no-latest');
    const jsonOmitsIt = row ? !JSON.stringify(row.out).includes('"latest"') : false;
    const ownKeyPresent = row ? own(row.out, 'latest') : false;
    const valueIsUndefined = row ? row.out.latest === undefined : false;
    check('presence rule 1: an own key valued undefined counts PRESENT',
      ownKeyPresent && valueIsUndefined && presenceOf('dependencyAdvisor.assess', 'latest') === 'always',
      `own=${ownKeyPresent} value=${String(row && row.out.latest)} presence=${presenceOf('dependencyAdvisor.assess', 'latest')}`);
    check('presence rule 1: JSON.stringify hides exactly that case, which is why hasOwnProperty is used',
      jsonOmitsIt, 'the serialised form kept the key, so this row no longer shows the difference');
  }

  // Which declarations is this run reading? Before the contract module exists, the pending table.
  const CONTRACT_REL = 'electron/lib/repairContract.cjs';
  const contractAbs = path.join(ROOT, CONTRACT_REL);
  let contractEntries = null;
  let contractNote = '';
  if (fs.existsSync(contractAbs)) {
    try {
      const mod = require(contractAbs);
      if (Array.isArray(mod.ENTRIES)) { contractEntries = mod.ENTRIES; contractNote = CONTRACT_REL; }
      else contractNote = `${CONTRACT_REL} exports no ENTRIES array`;
    } catch (e) { contractNote = `${CONTRACT_REL} failed to load: ${e.message}`; }
  } else {
    contractNote = `${CONTRACT_REL} does not exist yet`;
  }
  const ENTRIES = contractEntries || PENDING_ENTRIES;
  const sourceName = contractEntries ? CONTRACT_REL : 'PENDING_ENTRIES in this suite';

  console.log(`\n  declarations read from: ${sourceName}  (${contractNote})`);
  check(`declaration source resolved: ${sourceName}`,
    Array.isArray(ENTRIES) && ENTRIES.length > 0,
    'neither the contract module nor the pending table yielded entries');

  console.log('\n  rule 2 and rule 3 — entry -> producer -> path -> declared -> measured');
  for (const entry of ENTRIES) {
    const producerId = producerIdOf(entry.producerModule, entry.producerFn);
    for (const read of entry.reads || []) {
      const m = measure(producerId, read.path);
      console.log(`    ${entry.editId} -> ${producerId} -> ${read.path} -> ${read.presence} -> ${m.presence} (${m.hits} of ${m.total})`);
      check(`entry read presence: ${entry.editId} -> ${producerId} -> ${read.path}`,
        m.presence !== 'never' && m.presence === read.presence,
        m.presence === 'never'
          ? `${producerId} has no field "${read.path}" in ${m.total} of ${m.total} cases`
          : `declared ${read.presence}, measured ${m.presence} (${m.hits} of ${m.total})`);
    }
  }

  console.log('\n  the inverted rule — a blocked entry stays blocked only while the field is absent');
  for (const entry of ENTRIES) {
    const blocked = entry.blockedOn;
    if (!blocked) continue;
    const producerId = producerIdOf(blocked.producerModule, blocked.producerFn);
    for (const field of blocked.missingFields || []) {
      const m = measure(producerId, field);
      console.log(`    ${producerId} \u00b7 ${field} \u00b7 ${m.presence} (${m.hits} of ${m.total})`);
      check(`blockedOn inversion: ${entry.editId} -> ${producerId} -> ${field} is absent`,
        m.presence === 'never',
        `${entry.editId} is no longer blocked: ${field} measured ${m.presence} (${m.hits} of ${m.total})`);
    }
  }

  console.log('\n  presence witnesses');
  for (const w of WITNESSES) {
    const m = measure(w.producerId, w.dottedPath);
    console.log(`    ${w.producerId} \u00b7 ${w.dottedPath} \u00b7 ${m.presence} (${m.hits} of ${m.total})`);
    check(`witness: ${w.producerId} \u00b7 ${w.dottedPath} \u00b7 ${w.presence} (${w.hits} of ${w.total})`,
      m.presence === w.presence && m.hits === w.hits && m.total === w.total,
      `measured ${m.presence} (${m.hits} of ${m.total}) — ${w.why}`);
  }

  // ── The declared tables are frozen, proved through a strict-mode write ─────
  console.log('\n  the declared tables are frozen');
  {
    const probeKey = 'suiteFreezeProbe';
    const tables = [
      ['PRODUCERS', PRODUCERS],
      ['CORPUS_SHAPE', CORPUS_SHAPE],
      ['PENDING_ENTRIES', PENDING_ENTRIES],
      ['WITNESSES', WITNESSES],
      ['DECLARED_UNDEFINED_LITERALS', DECLARED_UNDEFINED_LITERALS],
      ['REDBY', REDBY],
    ];
    for (const [name, table] of tables) {
      let mechanism = 'a sloppy-mode write, which would have no-opped silently';
      let threw = false;
      try { strictWrite(table, probeKey, 'mutated by the suite'); }
      catch (e) { threw = true; mechanism = `a strict-mode write threw ${e.constructor.name}`; }
      const unchanged = !own(table, probeKey);
      check(`frozen: ${name} refused a write (${mechanism})`,
        Object.isFrozen(table) && threw && unchanged,
        `isFrozen=${Object.isFrozen(table)} threw=${threw} unchanged=${unchanged}`);
    }
  }

  // ── codeView is requirable without running its census ─────────────────────
  console.log('\n  codeView can be borrowed without running the census');
  {
    const logged = [];
    const realLog = console.log;
    let census = null;
    let censusErr = '';
    console.log = (...a) => { logged.push(a.join(' ')); };
    try { census = require(path.join(ROOT, 'scripts', 'verifyCommentCensus.cjs')); }
    catch (e) { censusErr = e.message; }
    finally { console.log = realLog; }
    check('codeView is requirable and silent (the require.main guard holds)',
      !censusErr && !!census && typeof census.codeView === 'function' && logged.length === 0,
      censusErr || `codeView is ${census ? typeof census.codeView : 'unresolvable'}; ${logged.length} lines printed on require`);
  }

  // ── Every assertion has a recorded mutation ───────────────────────────────
  console.log('\n  every assertion has a recorded mutation');
  {
    const label = 'REDBY covers every label this run emitted';
    const uncovered = [...emitted, label].filter(l => !REDBY.some(r => l.startsWith(r.prefix)));
    check(label, uncovered.length === 0, `uncovered: ${uncovered.join(' | ')}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  return fail;
}

main().then((fail) => process.exit(fail ? 1 : 0), (e) => {
  console.error(`  FAIL  the suite itself threw - ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
