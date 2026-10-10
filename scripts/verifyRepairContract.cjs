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
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

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

  // ── FEAT-003: the contract module itself ──────────────────────────────────
  Object.freeze({ prefix: 'contract: ', redby: 'require electron, ipcMain, a renderer module or a producer module from the contract; or paste a PROTECTED_FILES / SELF_GOVERNING_PATHS literal into its source; or add an io.policy seam' }),
  Object.freeze({ prefix: 'entry shape: ', redby: 'give an unreachable entry a reads list, a non-zero maxChanges, a transform, or an empty blockedOn.why' }),
  Object.freeze({ prefix: 'derivation: ', redby: "set the authored producerFn to a name the module does not export — assess to assessx (the tautological PRODUCED_BY === idOf form could NOT be reddened this way, which is why it was replaced)" }),
  Object.freeze({ prefix: 'trigger: ', redby: 'make fires() decide on latest instead of jump, or name a corpus case that does not exist' }),
  Object.freeze({ prefix: 'provenance: ', redby: 'return params.version from row.jump — the old value-based check ACCEPTED that, because "patch" is a recorded read' }),
  Object.freeze({ prefix: 'transform: ', redby: 'reserialise with JSON.stringify instead of splicing the located characters, which rewrites the three prose notes' }),
  Object.freeze({ prefix: 'verify: ', redby: 'let a throwing verifier report verified:true, or drop json-parse+dependency-count from the registry' }),
  Object.freeze({ prefix: 'author: ', redby: 'skip policy.require, or reach it with an injected gate, or drop the unverifiable-here declaration for the ok verdict' }),
  Object.freeze({ prefix: 'weigh: ', redby: 'make weigh() return ok with the lockfile present, or treat ENOENT as master-decides instead of absent' }),
  Object.freeze({ prefix: 'bound: ', redby: 'return the built change anyway when changes.length exceeds site.maxChanges' }),
  Object.freeze({ prefix: 'fence: ', redby: 'ask guard.inspectChanges on the RAW spelling instead of normalising first — measured, three spellings then slip through' }),
  // Declared as the mutation that was ACTUALLY DRIVEN. Removing canonicalPath from the spellings
  // namesGovernedPath asks would redden it too, but that is an edit to autonomyGate.cjs — a tranche
  // member — and a REDBY whose mutation was never driven is the thing this table exists to prevent.
  Object.freeze({ prefix: '8.3: ', redby: 'probe AUTONO~1.cjs instead of AUTONO~2.CJS — the first is the GATE on this volume, not a governed file, so the row reddens and proves it really asks the gate' }),
  Object.freeze({ prefix: 'boundary: ', redby: 'move a value in POLICY_SNAPSHOT (equivalently, move the FLOOR or CEILING it pins), give a class L5, add a member to AUTHORING_MODES, declare the create action, or freeze the advisor SENSITIVE export' }),
  Object.freeze({ prefix: 'render: ', redby: 'render an unverifiable-here entry as its kind instead of UNVERIFIED, or drop an entry from render()' }),
  Object.freeze({ prefix: 'LIMIT: ', redby: 'close the gap — each row asserts the gap is still OPEN, so closing it reddens the row and forces the limit to be rewritten rather than left stale' }),
]);

/**
 * Where the authored producer fields live. The contract nests them under `trigger`; `PENDING_ENTRIES`
 * carries them on the entry itself. One resolver rather than two loops.
 */
const triggerOf = (entry) => ((entry && entry.trigger) ? entry.trigger : (entry || {}));

/**
 * Boundary 7.1 — `FLOORS`, `CEILINGS` and `PERMANENT` as measured BEFORE this task, pinned here as a
 * literal so the comparison has an independent side. All fifteen classes, not just the one this
 * contract uses: a snapshot of one row would pass while the other fourteen moved.
 */
const POLICY_SNAPSHOT = Object.freeze({
  floors: Object.freeze({
    'observe': 'L1', 'research-local': 'L1', 'research-network': 'L2', 'propose-question': 'L3',
    'propose-source': 'L1', 'dependency-change': 'L1', 'build-repair': 'L1', 'author-change': 'L1',
    'revert-own-apply': 'L4', 'apply-source': 'L4', 'release-classify': 'L0', 'capability-grant': 'L0',
    'loyalty-core': 'L0', 'master-record': 'L3', 'autonomy-policy': 'L0',
  }),
  ceilings: Object.freeze({
    'observe': 'L1', 'research-local': 'L1', 'research-network': 'L2', 'propose-question': 'L3',
    'propose-source': 'L3', 'dependency-change': 'L3', 'build-repair': 'L3', 'author-change': 'L3',
    'revert-own-apply': 'L4', 'apply-source': 'L4', 'release-classify': 'L0', 'capability-grant': 'L0',
    'loyalty-core': 'L0', 'master-record': 'L3', 'autonomy-policy': 'L0',
  }),
  permanent: Object.freeze(['apply-source', 'revert-own-apply', 'release-classify', 'capability-grant',
    'loyalty-core', 'master-record', 'autonomy-policy']),
  unreachableLevel: 'L5',
});

/**
 * Boundary 7.7 — the advisor's `SENSITIVE` export is a LIVE MUTABLE `Set` (measured:
 * `Object.isFrozen` false, `size` 9). The expectation is pinned HERE rather than drawn from the same
 * object `weigh()` consults, and `dependencyAdvisor.cjs` is NOT changed to freeze it: it is a
 * comment-only tranche member and converting its export shape would breach I11.
 */
const SENSITIVE_PINNED = Object.freeze(['electron', 'electron-builder', 'electron-updater', 'argon2',
  'node-pty', 'playwright', 'vite', 'react', 'react-dom']);

/** Boundary 7.4 — what the contract's comment-stripped source may not contain. */
const FORBIDDEN_IN_SOURCE = Object.freeze([
  'registerApplier', 'ipcMain', 'setInterval', 'setTimeout',
  'modelRouter', 'codeRegenEngine', 'releaseChannel', 'io.policy',
]);

/** The load-time require set the contract declares. A seventh name here is a boundary question. */
const DECLARED_REQUIRES = Object.freeze(['fs', 'path', 'crypto',
  './autonomyPolicy.cjs', './loyaltyGuard.cjs', './autonomyGate.cjs', './dependencyAdvisor.cjs']);

/**
 * The four adjacent gaps, each asserted STILL OPEN against the thing that measures it.
 *
 * A LIMIT row that merely printed prose would stay green after the gap closed, and a stale limit is
 * how a later session comes to "fix" something already fixed. Each row here reddens the day its gap
 * closes, which is the only way a limit can be trusted to be current.
 */
const LIMITS = Object.freeze([
  Object.freeze({
    id: 'timeline-applier-unconfined',
    whose: "master's decision (I11 — confining a shipped applier is a behaviour change)",
    probe: 'the timeline applier writes change.path verbatim',
  }),
  Object.freeze({
    id: 'hard-link-residual',
    whose: 'the path fence, at apply time',
    probe: 'declared stated-untested-unclosed, with no runtime probe claimed',
  }),
  Object.freeze({
    id: 'policy-file-unprotected',
    whose: "master's action — a protected-file edit and a tripwire re-approval",
    probe: 'the policy data file is self-governing and NOT in the covenant list',
  }),
  Object.freeze({
    id: 'engine-cause-id',
    whose: 'SELF_UPGRADE §E.5.3a option (a) — the mapping lives in a consumer',
    probe: 'causeId measures never across all eight branches',
  }),
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
  let contractMod = null;
  let contractNote = '';
  if (fs.existsSync(contractAbs)) {
    try {
      const mod = require(contractAbs);
      if (Array.isArray(mod.ENTRIES)) { contractEntries = mod.ENTRIES; contractMod = mod; contractNote = CONTRACT_REL; }
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
    const trigger = triggerOf(entry);
    const producerId = producerIdOf(trigger.producerModule, trigger.producerFn);
    for (const read of trigger.reads || []) {
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
      ['POLICY_SNAPSHOT', POLICY_SNAPSHOT],
      ['SENSITIVE_PINNED', SENSITIVE_PINNED],
      ['FORBIDDEN_IN_SOURCE', FORBIDDEN_IN_SOURCE],
      ['DECLARED_REQUIRES', DECLARED_REQUIRES],
      ['LIMITS', LIMITS],
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
  let codeView = null;
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
    if (census && typeof census.codeView === 'function') codeView = census.codeView;
  }

  // ══ THE CONTRACT MODULE ═════════════════════════════════════════════════════
  //
  // Everything above runs whether or not `electron/lib/repairContract.cjs` exists — that ordering is
  // the point of this suite and is preserved. Everything below needs the module, and says so rather
  // than emitting a pass it has not earned.

  if (!contractMod) {
    console.log(`\n  ${CONTRACT_REL} is not present — its rows are not run, and none of them is counted as a pass`);
  } else {
    const contract = contractMod;
    const policy = require(path.join(ROOT, 'electron', 'lib', 'autonomyPolicy.cjs'));
    const guard = require(path.join(ROOT, 'electron', 'lib', 'loyaltyGuard.cjs'));
    const gate = require(path.join(ROOT, 'electron', 'lib', 'autonomyGate.cjs'));
    const applier = require(path.join(ROOT, 'electron', 'lib', 'upgradeApplier.cjs'));
    const advisor = loaded.get('electron/lib/dependencyAdvisor.cjs');
    const pin = contract.entryOf('pin-version');

    // A temp root carrying a package.json fixture and NO lockfile. Hermetic, and the only root any
    // row below reads — nothing in this suite writes to the real tree.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-repair-contract-'));
    const FIXTURE = JSON.stringify({
      name: 'rama-fixture',
      // The lookalike. A prose note that CONTAINS a dependency member spelling, placed outside both
      // dependency sections exactly as the three real `_*Note` keys are.
      _nativeRebuildNote: 'never run a clean install here — it once rewrote "cors": "2.8.5" inside this very note',
      dependencies: { cors: '2.8.5', express: '4.18.2' },
      devDependencies: { vite: '5.0.0' },
    }, null, 2);
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), FIXTURE, 'utf8');
    /**
     * THE TRANSFORM TARGET IS DERIVED FROM DISK, NOT WRITTEN AS A LITERAL (Section 146).
     *
     * This was `version: '2.8.6'` against a `package.json` that pinned `cors` at `2.8.5`. The
     * precondition in `repairContract.transform()` requires the on-disk value to DIFFER from the
     * target — otherwise there is no edit to derive — so the moment `cors` was legitimately upgraded
     * to 2.8.6 the whole suite threw `ContractPreconditionError`. A security upgrade broke a guard
     * that had nothing to do with security.
     *
     * The rows below also require the result to be the SAME LENGTH as the input with EXACTLY ONE
     * character different, which is what proves derivation-by-index rather than regeneration. So the
     * target cannot be an arbitrary string: it is the on-disk version with its last digit rolled
     * forward, which is same-length and one-character-different BY CONSTRUCTION, and can never
     * collide with the pinned value however often `cors` is upgraded.
     *
     * Nothing is written to the real `package.json` — `transform()` is pure and returns a string.
     */
    const corsPinned = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies.cors;
    if (!/\d$/.test(String(corsPinned))) {
      throw new Error(`the cors pin "${corsPinned}" does not end in a digit, so a same-length `
        + 'one-character target cannot be derived from it');
    }
    const PARAMS = Object.freeze({
      name: 'cors',
      version: String(corsPinned).replace(/\d$/, (d) => String((Number(d) + 1) % 10)),
    });

    try {
      // ── The exported surface, and the load boundary ────────────────────────
      console.log('\n  the contract module, and what it may touch');
      {
        const SURFACE = ['ENTRIES', 'ENTRY_IDS', 'PRODUCED_BY', 'REACHABLE', 'UNREACHABLE',
          'AUTHORING_MODES', 'VERDICTS', 'VERDICT_REACHABILITY', 'ADJACENT_GAPS', 'EIGHT_DOT_THREE',
          'VERIFIERS', 'VERIFIER_KINDS', 'idOf', 'entryOf', 'fires', 'locate', 'transform', 'verify',
          'verifyJsonDependencyCount', 'validateParams', 'fenceProbe', 'fencePath', 'buildChanges',
          'lockfileState', 'weigh', 'author', 'render', 'census', 'censusLine'];
        const missing = SURFACE.filter((k) => !own(contract, k));
        check('contract: the exported surface is complete', missing.length === 0, `missing: ${missing.join(', ')}`);

        const src = fs.readFileSync(contractAbs, 'utf8');
        const view = codeView ? codeView(src) : src;
        check('contract: its source is read through codeView, not raw', !!codeView,
          'verifyCommentCensus.cjs did not yield codeView, so every source row below would read comments too');

        // Boundary 7.4. These are COMMENT-STRIPPED matches: a banned name discussed in a comment is
        // fine, a banned name in code is not.
        for (const token of FORBIDDEN_IN_SOURCE) {
          check(`contract: its comment-stripped source contains no ${token}`, !view.includes(token),
            `found: ${around(view, token)}`);
        }

        // Criterion 14 — the lists are READ from the exports, never restated. A literal copy here
        // could be narrowed by editing the copy, which is the whole defect.
        const restated = [...guard.PROTECTED_FILES, ...policy.SELF_GOVERNING_PATHS.map((r) => r.path)]
          .filter((lit) => view.includes(lit));
        check('contract: no PROTECTED_FILES or SELF_GOVERNING_PATHS literal appears in its source',
          restated.length === 0, `restated: ${restated.join(', ')}`);

        // The require set, from the stripped view, so a commented-out require is not counted.
        const found = new Set();
        const re = /require\(\s*'([^']*)'\s*\)/g;
        let m = re.exec(view);
        while (m) { found.add(m[1]); m = re.exec(view); }
        const extra = [...found].filter((r) => !DECLARED_REQUIRES.includes(r));
        const absent = DECLARED_REQUIRES.filter((r) => !found.has(r));
        check('contract: it requires exactly the seven declared modules and nothing else',
          extra.length === 0 && absent.length === 0,
          `unexpected: ${extra.join(', ') || 'none'} / absent: ${absent.join(', ') || 'none'}`);
      }

      // ── The derived members, against an INDEPENDENT source ─────────────────
      //
      // `PRODUCED_BY[e.editId][0] === idOf(e)` is a TAUTOLOGY: both sides are derived from the same
      // two authored fields, so editing `producerFn` moves both identically and the row can never go
      // red. It is replaced by three facts the contract does not own — the corpus knows this producer,
      // the module resolves, and the named function is a function — so `producerFn: 'assessx'`
      // reddens it. The self-comparison survives only as a LENGTH check.
      console.log('\n  the derived members, checked against something that is not themselves');
      for (const entry of contract.ENTRIES) {
        const produced = contract.PRODUCED_BY[entry.editId];
        if (!entry.trigger) {
          check(`derivation: ${entry.editId} derives no producer`,
            Array.isArray(produced) && produced.length === 0, `derived ${JSON.stringify(produced)}`);
          continue;
        }
        const id = contract.idOf(entry);
        const inCorpus = PRODUCERS.some((p) => p.id === id);
        const mod = loaded.get(entry.trigger.producerModule) || null;
        const resolves = !!mod && !mod.__loadError;
        const isFn = resolves && typeof mod[entry.trigger.producerFn] === 'function';
        check(`derivation: ${entry.editId}'s authored producer ${id} is in the corpus, resolves, and exports ${entry.trigger.producerFn}()`,
          inCorpus && resolves && isFn,
          `inCorpus=${inCorpus} resolves=${resolves} typeof ${entry.trigger.producerFn}=${resolves ? typeof mod[entry.trigger.producerFn] : 'unresolvable'}`);
        check(`derivation: ${entry.editId} derives exactly one producer`,
          Array.isArray(produced) && produced.length === 1, `derived ${JSON.stringify(produced)}`);
      }
      check('derivation: ENTRY_IDS is derived from ENTRIES in order',
        contract.ENTRY_IDS.length === contract.ENTRIES.length
        && contract.ENTRY_IDS.every((id, i) => id === contract.ENTRIES[i].editId),
        `ENTRY_IDS=${contract.ENTRY_IDS.join(', ')}`);
      check('derivation: REACHABLE and UNREACHABLE partition the table through policy.frozenSetView',
        contract.REACHABLE.size + contract.UNREACHABLE.size === contract.ENTRIES.length
        && contract.REACHABLE.add === undefined && contract.UNREACHABLE.delete === undefined
        && contract.ENTRIES.every((e) => (e.trigger ? contract.REACHABLE : contract.UNREACHABLE).has(e.editId)),
        `reachable=${contract.REACHABLE.size} unreachable=${contract.UNREACHABLE.size} add=${typeof contract.REACHABLE.add}`);

      // ── The two structural rules ───────────────────────────────────────────
      console.log('\n  the two structural rules every entry obeys');
      {
        const COMMON = ['editId', 'what', 'trigger', 'site', 'params', 'preconditions', 'transform',
          'verification', 'approvalClass', 'needLevel', 'provenance'];
        for (const entry of contract.ENTRIES) {
          const keys = Object.keys(entry);
          check(`entry shape: ${entry.editId} carries the eleven common keys plus exactly one of cons / blockedOn`,
            COMMON.every((k) => own(entry, k)) && (own(entry, 'cons') !== own(entry, 'blockedOn'))
            && keys.length === COMMON.length + 1,
            `keys: ${keys.join(', ')}`);
          if (entry.trigger) {
            check(`entry shape: ${entry.editId} is reachable — reads, a transform, and a bound of at least one`,
              Array.isArray(entry.trigger.reads) && entry.trigger.reads.length > 0
              && typeof entry.transform === 'function' && entry.site.maxChanges >= 1
              && entry.site.paths.length > 0 && entry.site.pathKind !== 'none',
              `reads=${(entry.trigger.reads || []).length} transform=${typeof entry.transform} max=${entry.site.maxChanges}`);
          } else {
            check(`entry shape: ${entry.editId} is unreachable — trigger null, no reads, maxChanges 0, transform null, a non-empty blockedOn.why`,
              entry.trigger === null && !own(entry, 'reads') && entry.site.maxChanges === 0
              && entry.transform === null && entry.site.paths.length === 0
              && entry.site.pathKind === 'none' && !!entry.blockedOn
              && typeof entry.blockedOn.why === 'string' && entry.blockedOn.why.length > 0,
              `trigger=${entry.trigger} max=${entry.site.maxChanges} transform=${entry.transform} why=${entry.blockedOn && entry.blockedOn.why ? 'set' : 'EMPTY'}`);
            check(`entry shape: ${entry.editId}'s blockedOn names a producer and its missing fields together, or neither`,
              (entry.blockedOn.producerModule === null) === (entry.blockedOn.missingFields.length === 0),
              `producerModule=${JSON.stringify(entry.blockedOn.producerModule)} missingFields=${JSON.stringify(entry.blockedOn.missingFields)}`);
          }
        }
      }

      // ── The contract's own tables are frozen, through a strict-mode write ──
      console.log('\n  the contract\u2019s own tables are frozen');
      {
        const probeKey = 'contractFreezeProbe';
        const tables = [
          ['contract.ENTRIES', contract.ENTRIES],
          ['contract.ENTRIES[0]', contract.ENTRIES[0]],
          ['contract.ENTRIES[0].site', contract.ENTRIES[0].site],
          ['contract.ENTRIES[0].trigger', contract.ENTRIES[0].trigger],
          ['contract.ENTRY_IDS', contract.ENTRY_IDS],
          ['contract.PRODUCED_BY', contract.PRODUCED_BY],
          ['contract.AUTHORING_MODES', contract.AUTHORING_MODES],
          ['contract.VERIFIERS', contract.VERIFIERS],
          ['contract.VERDICT_REACHABILITY', contract.VERDICT_REACHABILITY],
          ['contract.ADJACENT_GAPS', contract.ADJACENT_GAPS],
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

      // ── The trigger, both directions ───────────────────────────────────────
      //
      // The read-through proxy lives HERE and nowhere else. It is suite-time only: in shipped code
      // `fires` receives a plain object and every key is reachable, so the production validation is
      // `fires`'s own type guard plus the params validator. A validation that exists only under test
      // is not a validation, and this is the one place that would otherwise have been believed.
      console.log('\n  the trigger, in both directions, through a recording proxy');
      {
        const declaredReads = new Set(pin.trigger.reads.map((r) => r.path));
        const CARVE_OUTS = new Set(['then']);
        const wrap = (value, recorded, prefix) => {
          if (value === null || typeof value !== 'object') return value;
          return new Proxy(value, {
            get(target, prop, receiver) {
              if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
              if (CARVE_OUTS.has(prop)) return Reflect.get(target, prop, receiver);
              const dotted = prefix ? `${prefix}.${String(prop)}` : String(prop);
              const declared = declaredReads.has(dotted)
                || [...declaredReads].some((d) => d.startsWith(`${dotted}.`));
              if (!declared) throw new Error(`${pin.editId} read an undeclared field: ${dotted}`);
              const out = Reflect.get(target, prop, receiver);
              recorded.set(dotted, out);
              return wrap(out, recorded, dotted);
            },
          });
        };

        const fired = new Map();
        const readSeen = new Set();
        for (const row of corpus.get('dependencyAdvisor.assess')) {
          const recorded = new Map();
          let out = null;
          let err = '';
          try { out = pin.trigger.fires(wrap(row.out, recorded, '')); }
          catch (e) { err = e.message; }
          for (const k of recorded.keys()) readSeen.add(k);
          fired.set(row.caseId, { out, recorded, err });
        }

        const threw = [...fired.entries()].filter(([, f]) => f.err);
        check('trigger: fires() read no undeclared field across all ten cases', threw.length === 0,
          threw.map(([id, f]) => `${id}: ${f.err}`).join(' | '));
        const dead = [...declaredReads].filter((d) => !readSeen.has(d));
        check('trigger: every declared read is actually read — no dead declaration',
          dead.length === 0, `declared and never read: ${dead.join(', ')}`);

        const cases = new Set(PRODUCERS.find((p) => p.id === 'dependencyAdvisor.assess').cases.map((c) => c.id));
        const named = [...pin.trigger.negative, ...pin.trigger.positive].map((r) => r.case);
        check('trigger: every declared trigger state names a corpus case that exists',
          named.every((id) => cases.has(id)), `unknown cases: ${named.filter((id) => !cases.has(id)).join(', ')}`);

        for (const neg of pin.trigger.negative) {
          const f = fired.get(neg.case);
          check(`trigger: negative ${neg.when} (case ${neg.case}) yields no repair`,
            !!f && f.out === null, f ? `fires returned ${JSON.stringify(f.out)}` : 'no such case');
        }
        for (const pos of pin.trigger.positive) {
          const f = fired.get(pos.case);
          check(`trigger: positive ${pos.when} (case ${pos.case}) yields exactly one repair`,
            !!f && !!f.out && f.out.editId === 'pin-version' && typeof f.out.params.version === 'string',
            f ? `fires returned ${JSON.stringify(f.out)}` : 'no such case');
        }
        // R2 — the two directions must DIFFER. A predicate that returned the same thing both ways
        // has already shipped green in this repo once.
        check('trigger: the negative and positive directions genuinely differ',
          pin.trigger.negative.every((n) => fired.get(n.case).out === null)
          && pin.trigger.positive.every((p) => fired.get(p.case).out !== null)
          && pin.trigger.negative.length > 0 && pin.trigger.positive.length > 0,
          'one direction did not move');

        // D8 / finding 8 — the `latest` guard is DECLARED UNREACHABLE rather than exercised, and the
        // reason is measured here rather than asserted twice.
        const blanked = advisor.assess({ name: 'cors', pinned: '2.8.5', latest: '' });
        check('trigger: the declared-unreachable latest guard is genuinely unreachable — classifyJump returns unknown whenever latest is falsy',
          blanked.jump === 'unknown' && pin.trigger.fires(blanked) === null
          && pin.trigger.declaredUnreachableGuards.length === 1
          && !pin.trigger.negative.some((n) => n.when.includes('latest')),
          `jump=${blanked.jump}; a negative row naming latest would prove jump==='unknown' twice`);

        // ── Params provenance, per param, per declared read (finding 15) ─────
        //
        // The value-based form `[...recorded.values()].includes(v)` could not say WHICH read produced
        // a param: `params.version = row.jump` satisfied it, because `'patch'` is a recorded read, and
        // only failed later through the semver validator for an unrelated reason.
        const sources = pin.trigger.paramSources;
        for (const pos of pin.trigger.positive) {
          const f = fired.get(pos.case);
          const params = (f && f.out && f.out.params) || {};
          for (const k of Object.keys(params)) {
            const source = own(sources, k) ? sources[k] : null;
            check(`provenance: case ${pos.case} params.${k} traces to the declared read "${source}"`,
              source !== null && f.recorded.has(source) && f.recorded.get(source) === params[k],
              source === null
                ? `params.${k} has no declared paramSource`
                : `params.${k}=${JSON.stringify(params[k])} but recorded ${source}=${JSON.stringify(f.recorded.get(source))}`);
          }
        }
        check('provenance: every paramSource is itself a declared read',
          Object.values(sources).every((s) => declaredReads.has(s)),
          `paramSources=${JSON.stringify(sources)} reads=${[...declaredReads].join(', ')}`);
        check('provenance: every declared param has a paramSource',
          Object.keys(pin.params).every((k) => own(sources, k)),
          `params=${Object.keys(pin.params).join(', ')} sources=${Object.keys(sources).join(', ')}`);
      }

      // ── author(): one verdict here, and the reason the others are not reached ──
      console.log('\n  author() — single-verdict on this install, with no seam that makes it otherwise');
      {
        const REFUSAL = 'autonomy policy: "dependency-change" is L0 (forbidden); '
          + 'L3 (propose-only) required for author';
        const out = contract.author({ editId: 'pin-version', params: PARAMS, io: { repoRoot: tmpRoot } });
        check('author: pin-version refuses with the measured policy reason, character for character',
          out.verdict === 'refused' && out.why === REFUSAL && out.changes.length === 0,
          `verdict=${out.verdict} changes=${out.changes.length} why=${JSON.stringify(out.why)}`);
        check('author: the refusal is the policy module\u2019s own sentence, not a copy',
          out.why === policy.require('dependency-change', 'L3', { action: 'author' }).reason,
          'the contract built its own sentence instead of returning the gate\u2019s');
        // The third parameter is an OPTIONS OBJECT. A positional string destructures to
        // `{action: undefined}` and drops the trailing " for author" — recorded so the next reader
        // does not measure it the wrong way and conclude the sentence changed.
        check('author: the gate is called with an options object, which is why the reason names the action',
          policy.require.length === 2
          && !policy.require('dependency-change', 'L3', 'author').reason.endsWith(' for author')
          && policy.require('dependency-change', 'L3', { action: 'author' }).reason.endsWith(' for author'),
          `require.length=${policy.require.length}`);

        const reach = contract.VERDICT_REACHABILITY;
        const okRow = reach.find((r) => r.verdict === 'ok');
        check('author: the ok verdict is declared unverifiable-here, with its reason stated',
          !!okRow && okRow.where === 'unverifiable-here' && okRow.provedBy === null
          && okRow.why.includes('no injectable policy seam') && okRow.why.includes('L0'),
          okRow ? `where=${okRow.where} provedBy=${JSON.stringify(okRow.provedBy)}` : 'no ok row');
        check('author: every declared verdict has a reachability row, and refused is the one proved here',
          contract.VERDICTS.every((v) => reach.some((r) => r.verdict === v))
          && reach.find((r) => r.verdict === 'refused').where === 'here'
          && reach.find((r) => r.verdict === 'refused').provedBy === 'author'
          && reach.find((r) => r.verdict === 'needs-master-decision').provedBy === 'weigh',
          `rows: ${reach.map((r) => `${r.verdict}=${r.where}`).join(', ')}`);
        check('author: the effective level really is below the declared need, in both stop states',
          policy.effective('dependency-change') === 'L0'
          && policy.effective('dependency-change', { ignoreStop: true }) === 'L1'
          && policy.rank('L1') < policy.rank(pin.needLevel),
          `effective=${policy.effective('dependency-change')} / ${policy.effective('dependency-change', { ignoreStop: true })}`);
        check('author: an unknown editId is refused with the declared sentence',
          contract.author({ editId: 'no-such-edit' }).why === 'no declared edit produces this remedy',
          JSON.stringify(contract.author({ editId: 'no-such-edit' }).why));
        check('author: an unreachable entry is refused with its blockedOn reason',
          contract.author({ editId: 'name-engine-cause' }).why
          === `name-engine-cause has no producer: ${contract.entryOf('name-engine-cause').blockedOn.why}`,
          JSON.stringify(contract.author({ editId: 'name-engine-cause' }).why));
      }

      // ── weigh(): the ENOENT rule, stated and exercised both ways ───────────
      console.log('\n  weigh() — ENOENT is absent, every other error is master\u2019s decision');
      {
        const tmp = contract.weigh({ editId: 'pin-version', params: PARAMS, io: { repoRoot: tmpRoot } });
        check('weigh: a temp root with no lockfile reports absent (the ENOENT branch) and does not ask master',
          tmp.lockfile === 'absent' && tmp.verdict === 'ok' && tmp.why === null,
          `lockfile=${tmp.lockfile} verdict=${tmp.verdict} why=${JSON.stringify(tmp.why)}`);
        check('weigh: the probe really does throw ENOENT for an absent lockfile',
          contract.lockfileState({ repoRoot: tmpRoot }).code === 'ENOENT',
          `code=${JSON.stringify(contract.lockfileState({ repoRoot: tmpRoot }).code)}`);

        const real = contract.weigh({ editId: 'pin-version', params: PARAMS });
        check('weigh: the real root reports needs-master-decision because package-lock.json exists',
          real.lockfile === 'present' && real.verdict === 'needs-master-decision'
          && fs.existsSync(path.join(ROOT, 'package-lock.json')),
          `lockfile=${real.lockfile} verdict=${real.verdict}`);

        const sens = contract.weigh({
          editId: 'pin-version', params: { name: 'electron', version: '32.1.0' }, io: { repoRoot: tmpRoot },
        });
        check('weigh: a package in the advisor\u2019s SENSITIVE export needs master even with no lockfile',
          sens.lockfile === 'absent' && sens.verdict === 'needs-master-decision'
          && sens.weighing.unknowns.some((u) => u.includes('SENSITIVE')),
          `verdict=${sens.verdict} unknowns=${JSON.stringify(sens.weighing.unknowns)}`);

        const warned = [];
        const realWarn = console.warn;
        console.warn = (...a) => { warned.push(a.join(' ')); };
        let hostile;
        try {
          hostile = contract.weigh({
            editId: 'pin-version',
            params: PARAMS,
            io: {
              repoRoot: tmpRoot,
              fs: { statSync: () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; }, readFileSync: fs.readFileSync },
            },
          });
        } finally { console.warn = realWarn; }
        check('weigh: a stat error that is NOT ENOENT decides toward master and warns once with the code named',
          hostile.lockfile === 'unreadable' && hostile.verdict === 'needs-master-decision'
          && warned.length === 1 && warned[0].includes('EACCES'),
          `lockfile=${hostile.lockfile} verdict=${hostile.verdict} warnings=${JSON.stringify(warned)}`);
      }

      // ── transform(): derivation, not generation ────────────────────────────
      console.log('\n  transform() — derivation by index, so every other byte survives');
      {
        const realPkgBytes = fs.readFileSync(path.join(ROOT, 'package.json'));
        const realPkg = realPkgBytes.toString('utf8');
        // Finding 18, recorded as measured. BYTES ON DISK AND CHARACTERS DECODED ARE DIFFERENT
        // NUMBERS, and the transform indexes the DECODED string.
        //   pre-task (21bb12d):  14,235 bytes  /  14,228 characters  /  286 content lines
        //   now:                 14,276 bytes  /  14,269 characters  /  286 content lines
        // The 41-byte move is this task's single-line `verify` chain insertion; the content-line count
        // did not move because that insertion edited an existing line.
        // What is PINNED here is the seven-character divergence and the line count, not the absolute
        // size — a row that reddened on any lawful package.json edit would be deleted rather than read.
        const declaredLines = realPkg.replace(/\n$/, '').split('\n').length;
        console.log(`    package.json: ${realPkgBytes.length} bytes on disk \u00b7 ${realPkg.length} characters decoded \u00b7 ${declaredLines} content lines`);
        // THE ABSOLUTE LINE NUMBERS AND TOTAL WERE PINNED HERE AND SHOULD NOT HAVE BEEN. The comment
        // above states the intent correctly — pin the seven-character divergence, not the absolute
        // size, because "a row that reddened on any lawful package.json edit would be deleted rather
        // than read" — and then the row pinned `declaredLines === 286` and lines 73 and 99 anyway.
        // Adding one `verify:*` script, which is as lawful an edit as this file gets, reddened both
        // rows for a reason that has nothing to do with whether the transform is correct.
        //
        // What is a REAL precondition of `pin-version` is asserted instead: the divergence, that each
        // section literal is UNIQUE (a second occurrence would make `indexOf` ambiguous), that
        // `"dependencies"` precedes `"devDependencies"`, and that the byte and character offsets
        // coincide at the site actually indexed. The live line numbers are PRINTED above for a reader
        // and deliberately not asserted.
        check('transform: bytes on disk and characters decoded differ by seven, and it is the decoded string that is indexed',
          realPkgBytes.length - realPkg.length === 7
          && realPkgBytes.indexOf('"dependencies"') === realPkg.indexOf('"dependencies"'),
          `bytes=${realPkgBytes.length} chars=${realPkg.length} lines=${declaredLines}`
          + ' — the seven multi-byte characters sit AFTER both dependency sections, so the two offsets'
          + ' happen to coincide at this site; that is where those characters are, not a guarantee,'
          + ' which is why the decoded string is what gets indexed');
        check('transform: each section literal occurs exactly once, and in order',
          realPkg.split('"dependencies"').length - 1 === 1
          && realPkg.split('"devDependencies"').length - 1 === 1
          && realPkg.indexOf('"dependencies"') < realPkg.indexOf('"devDependencies"'),
          'a second occurrence of either literal makes indexOf ambiguous, which is a precondition'
          + ' failure rather than a guess');

        const after = contract.transform(realPkg, PARAMS);
        check('transform: it is reproducible — the same bytes and params yield the same bytes',
          sha256(contract.transform(realPkg, PARAMS)) === sha256(after), 'two runs disagreed');
        check('transform: only the located value moved — the length is unchanged and exactly one character differs',
          after.length === realPkg.length
          && [...realPkg].filter((ch, i) => ch !== after[i]).length === 1
          && JSON.parse(after).dependencies.cors === PARAMS.version,
          `delta=${after.length - realPkg.length} differing=${[...realPkg].filter((ch, i) => ch !== after[i]).length}`);
        const notes = ['_buildFilesNote', '_extraResourcesNote', '_nativeRebuildNote'];
        const sectionAt = realPkg.indexOf('"dependencies"');
        check('transform: the three prose notes at lines 7-9 survive byte-identical',
          notes.every((k) => JSON.parse(after)[k] === JSON.parse(realPkg)[k])
          && after.slice(0, sectionAt) === realPkg.slice(0, sectionAt)
          && realPkg.slice(0, sectionAt).includes('_nativeRebuildNote'),
          'a reserialise would have rewritten every byte of them');

        const fixtureAfter = contract.transform(FIXTURE, PARAMS);
        check('transform: a lookalike member inside a prose note outside both sections is not a candidate',
          JSON.parse(fixtureAfter)._nativeRebuildNote === JSON.parse(FIXTURE)._nativeRebuildNote
          && JSON.parse(fixtureAfter).dependencies.cors === PARAMS.version
          && [...FIXTURE].filter((ch, i) => ch !== fixtureAfter[i]).length === 1,
          `differing characters=${[...FIXTURE].filter((ch, i) => ch !== fixtureAfter[i]).length}`);
        check('transform: it finds a member in devDependencies as well as dependencies',
          contract.locate(FIXTURE, { name: 'vite' }).section === 'devDependencies',
          JSON.stringify(contract.locate(FIXTURE, { name: 'vite' })));
        check('transform: braceSpan skips string literals rather than spanning with a negated class',
          (() => {
            const probe = '{"a":{"b":"}}}}"},"c":1}';
            const span = contract.braceSpan(probe, 5);
            return !!span && probe.slice(span.open, span.close + 1) === '{"b":"}}}}"}';
          })(), 'the depth counter was fooled by a brace inside a string');

        // Every precondition failure quotes a DECLARED precondition string, verbatim.
        const preconditionCases = [
          ['malformed JSON', '{ not json', PARAMS],
          ['the value already equals version', FIXTURE, { name: 'cors', version: '2.8.5' }],
          ['no such member', FIXTURE, { name: 'nosuch', version: '1.0.0' }],
          ['a second section literal', FIXTURE.replace('"devDependencies"', '"dependencies"'), PARAMS],
        ];
        for (const [label, bytes, params] of preconditionCases) {
          let err = null;
          try { contract.transform(bytes, params); } catch (e) { err = e; }
          const why = err && err.precondition ? `pin-version preconditions not met: ${err.precondition}` : '';
          check(`transform: ${label} fails with a declared precondition quoted verbatim`,
            !!err && err instanceof contract.ContractPreconditionError
            && pin.preconditions.includes(err.precondition)
            && pin.preconditions.some((p) => why.endsWith(p)),
            err ? `precondition=${JSON.stringify(err.precondition)}` : 'it did not refuse');
        }
      }

      // ── buildChanges(): the declared bound, and nothing written ────────────
      console.log('\n  the declared bound, and the proof that nothing was written');
      {
        const target = path.join(tmpRoot, 'package.json');
        const good = contract.buildChanges({ entry: pin, params: PARAMS, io: { repoRoot: tmpRoot } });
        check('bound: within the bound, exactly one change is built, with the declared action and a baseSha256',
          good.changes.length === 1 && good.why === null
          && good.changes[0].action === pin.site.action && good.changes[0].path === 'package.json'
          && good.changes[0].baseSha256 === sha256(FIXTURE),
          `changes=${good.changes.length} why=${JSON.stringify(good.why)}`);

        // The plant (finding 14). `maxChanges` is 1 and `author()` builds exactly one change, so the
        // comparison was STRUCTURALLY UNREACHABLE and the row passed without exercising the bound.
        // A clone with `maxChanges: 0` is what makes it reachable.
        const clone = {
          ...pin,
          site: Object.freeze({ ...pin.site, maxChanges: 0 }),
        };
        const before = sha256(fs.readFileSync(target));
        const warned = [];
        const realWarn = console.warn;
        console.warn = (...a) => { warned.push(a.join(' ')); };
        let bound;
        try { bound = contract.buildChanges({ entry: clone, params: PARAMS, io: { repoRoot: tmpRoot } }); }
        finally { console.warn = realWarn; }
        const afterSha = sha256(fs.readFileSync(target));
        check('bound: a bound of 0 refuses with the declared sentence and emits no change',
          bound.changes.length === 0
          && bound.why === 'pin-version would exceed its declared bound of 0 changes'
          && warned.length === 1,
          `why=${JSON.stringify(bound.why)} changes=${bound.changes.length} warnings=${warned.length}`);
        check('bound: the target\u2019s sha256 is unchanged across the refusal, so nothing was written',
          afterSha === before, `${before} -> ${afterSha}`);

        const missing = contract.buildChanges({
          entry: pin, params: PARAMS, io: { repoRoot: path.join(tmpRoot, 'no-such-dir') },
        });
        check('bound: an unreadable target refuses with the readable precondition, quoted verbatim',
          missing.changes.length === 0
          && missing.why === 'pin-version preconditions not met: package.json is readable',
          JSON.stringify(missing.why));
      }

      // ── validateParams() ──────────────────────────────────────────────────
      console.log('\n  params validation, inside the module that owns it');
      {
        const rejects = [
          ['a range operator', { name: 'cors', version: '^2.8.6' }, 'version'],
          ['a jump word instead of a version', { name: 'cors', version: 'patch' }, 'version'],
          ['a wildcard', { name: 'cors', version: '2.8.x' }, 'version'],
          ['a non-string', { name: 'cors', version: 3 }, 'version'],
          ['an invalid package name', { name: 'Not A Name', version: '2.8.6' }, 'name'],
        ];
        for (const [label, params, field] of rejects) {
          const bad = contract.validateParams(pin, params);
          check(`provenance: params validation rejects ${label}, naming the field`,
            !!bad && bad.field === field && bad.why.startsWith('pin-version params rejected: '),
            bad ? bad.why : 'it was accepted');
        }
        check('provenance: params validation rejects a forbidden prototype key by name',
          (contract.validateParams(pin, JSON.parse('{"name":"cors","version":"2.8.6","__proto__":{}}')) || {}).why
          === 'pin-version params rejected: forbidden key __proto__',
          JSON.stringify(contract.validateParams(pin, JSON.parse('{"name":"cors","version":"2.8.6","__proto__":{}}'))));
        check('provenance: params validation accepts the measured-correct params',
          contract.validateParams(pin, PARAMS) === null,
          JSON.stringify(contract.validateParams(pin, PARAMS)));
      }

      // ── verify(): executable data, and a throwing verifier ─────────────────
      console.log('\n  verification is executable data, and a throwing verifier is never a pass');
      {
        const after = contract.transform(FIXTURE, PARAMS);
        check('verify: the registered verifier passes on a correct edit',
          contract.verify({ editId: 'pin-version', before: FIXTURE, after, params: PARAMS }).verified === true,
          JSON.stringify(contract.verify({ editId: 'pin-version', before: FIXTURE, after, params: PARAMS })));
        const wrongCount = after.replace('"vite": "5.0.0"', '"vite": "5.0.0", "nanoid": "5.0.0"');
        check('verify: it refuses when the dependency count moved',
          contract.verify({ editId: 'pin-version', before: FIXTURE, after: wrongCount, params: PARAMS }).verified === false,
          JSON.stringify(contract.verify({ editId: 'pin-version', before: FIXTURE, after: wrongCount, params: PARAMS })));
        check('verify: it refuses when the named package does not resolve to params.version',
          contract.verify({ editId: 'pin-version', before: FIXTURE, after, params: { name: 'cors', version: '9.9.9' } }).verified === false,
          'a wrong version was accepted');
        check('verify: malformed after-bytes are refused rather than thrown',
          contract.verify({ editId: 'pin-version', before: FIXTURE, after: '{ broken', params: PARAMS }).verified === false,
          'malformed bytes did not refuse');

        // A verifier that THROWS, made to throw through the REGISTERED runner rather than a stand-in.
        // The registry and the table are both frozen, so a swapped runner is not available — but
        // `params` reaches the runner untouched, and a params object that throws on property access
        // makes the real `verifyJsonDependencyCount` throw past its own inner catches. What is being
        // proved is `verify()`'s catch: never verified:true, and never silence.
        const hostileParams = new Proxy({}, { get() { throw new Error('the verifier itself broke'); } });
        const thrown = contract.verify({ editId: 'pin-version', before: FIXTURE, after, params: hostileParams });
        check('verify: a throwing verifier is caught and reported verified:false with its message, never true and never silence',
          thrown.verified === false && thrown.why === 'the verifier itself broke',
          JSON.stringify(thrown));

        check('verify: an unverifiable-here entry never reports verified:true, and says why not',
          contract.ENTRIES.filter((e) => e.verification.where === 'unverifiable-here').every((e) => {
            const out = contract.verify({ editId: e.editId, before: FIXTURE, after, params: PARAMS });
            return out.verified === false && out.why === e.verification.whyNotHere;
          }), 'an unverifiable entry reported a pass');
        check('verify: every entry either has a registered verifier or is unverifiable-here with a non-empty reason',
          contract.ENTRIES.every((e) => (own(contract.VERIFIERS, e.verification.kind)
            && e.verification.where === 'here' && typeof e.verification.timeoutMs === 'number')
            || (e.verification.where === 'unverifiable-here'
              && typeof e.verification.whyNotHere === 'string' && e.verification.whyNotHere.length > 0)),
          `kinds=${contract.VERIFIER_KINDS.join(', ')}`);
        check('verify: no entry whose site is a .json target declares a node --check verification',
          contract.ENTRIES.every((e) => !(e.site.paths.some((p) => p.endsWith('.json'))
            && String(e.verification.kind || '').includes('node --check'))),
          'node --check was declared for a JSON target');
        check('verify: pass is documentation and the verifier is the authority — both exist, neither is the other',
          typeof pin.verification.pass === 'string' && pin.verification.pass.length > 0
          && typeof contract.VERIFIERS[pin.verification.kind] === 'function'
          && pin.verification.pass !== String(contract.VERIFIERS[pin.verification.kind]),
          'the prose and the function are not distinct');
        // Finding 19 — a declared timeout read by nothing would be believed. So the module carries NO
        // deadline mechanism at all (no timer, no clock), and the renderer says so in words.
        const contractView = codeView ? codeView(fs.readFileSync(contractAbs, 'utf8')) : '';
        check('verify: timeoutMs is declared data for a future runner — the module holds no deadline mechanism and the renderer says so',
          pin.verification.timeoutMs === 5000
          && contract.renderTimeout(pin.verification).includes('verify() enforces no deadline')
          && !contractView.includes('Date.now') && !contractView.includes('setTimeout'),
          `rendered as: ${contract.renderTimeout(pin.verification)}`);
      }

      // ── The path fence ─────────────────────────────────────────────────────
      //
      // THE CORRECTED SPELLING TABLE. The design recorded a single backslash as slipping past
      // `guard.inspectChanges`; measured, it does NOT — it is refused raw. The spellings raw matching
      // actually misses are a TRAILING SPACE, a DOUBLE BACKSLASH and a DOUBLED SEPARATOR. Each row
      // prints both answers, because a row that asserted only the normalised one would imply the raw
      // one never mattered, and a fence recorded as weaker than it is sends a later session to "fix"
      // working code.
      console.log('\n  the path fence — raw versus normalised, per spelling');
      {
        const BS = String.fromCharCode(92);
        const COVENANT = [
          Object.freeze({ id: 'plain', spelling: 'electron/lib/proposals.cjs', rawRefuses: true }),
          Object.freeze({ id: 'dot-slash prefix', spelling: './electron/lib/proposals.cjs', rawRefuses: true }),
          Object.freeze({ id: 'single backslash', spelling: `electron${BS}lib${BS}proposals.cjs`, rawRefuses: true }),
          Object.freeze({ id: 'uppercase', spelling: 'ELECTRON/LIB/PROPOSALS.CJS', rawRefuses: true }),
          Object.freeze({ id: 'trailing space', spelling: 'electron/lib/proposals.cjs ', rawRefuses: false }),
          Object.freeze({ id: 'double backslash', spelling: `electron${BS}${BS}lib${BS}${BS}proposals.cjs`, rawRefuses: false }),
          Object.freeze({ id: 'doubled separator', spelling: 'electron//lib//proposals.cjs', rawRefuses: false }),
        ];
        for (const row of COVENANT) {
          const probe = contract.fenceProbe(row.spelling);
          console.log(`    ${row.id.padEnd(18)} raw.ok=${String(probe.raw.ok).padEnd(5)} normalised.ok=${String(probe.normalised.ok).padEnd(5)} -> ${JSON.stringify(probe.rel)}`);
          check(`fence: covenant spelling "${row.id}" is refused after normalisation, and raw matching ${row.rawRefuses ? 'already refused it' : 'did NOT'}`,
            probe.ok === false && probe.normalised.ok === false
            && probe.raw.ok === !row.rawRefuses
            && probe.why === 'refused: "electron/lib/proposals.cjs" is a protected covenant file',
            `raw.ok=${probe.raw.ok} (declared ${!row.rawRefuses}) normalised.ok=${probe.normalised.ok} why=${JSON.stringify(probe.why)}`);
        }
        check('fence: normalise-first is strictly stronger — three spellings pass raw matching and none passes normalised',
          COVENANT.filter((r) => contract.fenceProbe(r.spelling).raw.ok === true).length === 3
          && COVENANT.every((r) => contract.fenceProbe(r.spelling).normalised.ok === false),
          `raw-passing: ${COVENANT.filter((r) => contract.fenceProbe(r.spelling).raw.ok).map((r) => r.id).join(', ')}`);

        // The governed half. `governedPathsNamed` is asked because it prints WHICH token was named.
        const policyFile = policy.SELF_GOVERNING_PATHS.find((r) => r.optional === true).path;
        const GOVERNED = [policyFile, `./${policyFile}`, policyFile.replace('/', BS),
          'electron/lib/autonomyPolicy.cjs '];
        for (const spelling of GOVERNED) {
          const probe = contract.fenceProbe(spelling);
          check(`fence: governed spelling ${JSON.stringify(spelling)} is named, with its token printed`,
            probe.ok === false && probe.governed.length === 1
            && probe.why === `refused: "${probe.rel}" names ${probe.governed[0].token}, which governs the autonomy policy or the stop`,
            `governed=${JSON.stringify(probe.governed)} why=${JSON.stringify(probe.why)}`);
        }
        check('fence: the declared site path passes the fence, so the fence is not simply refusing everything',
          contract.fenceProbe('package.json').ok === true
          && contract.fencePath(pin, 'package.json') === null,
          'package.json was refused, which would make every row above vacuous');
        check('fence: a path resolving outside the repository root is refused',
          contract.fenceProbe('../outside.json').inside === false
          && contract.fenceProbe('../outside.json').why === 'refused: "../outside.json" resolves outside the repository root',
          JSON.stringify(contract.fenceProbe('../outside.json').why));
        check('fence: the lists come from the exports — the gate\u2019s root is the repository root the suite is running in',
          gate.REPO_ROOT === ROOT && guard.PROTECTED_FILES.length === 7
          && policy.SELF_GOVERNING_PATHS.length === 4,
          `REPO_ROOT=${gate.REPO_ROOT} protected=${guard.PROTECTED_FILES.length} governed=${policy.SELF_GOVERNING_PATHS.length}`);

        // ── 8.3 short names, restated AS MEASURED ────────────────────────────
        console.log('\n  8.3 short names — restated as measured, not as a weakness');
        check('8.3: a short name of an EXISTING governed file is caught — AUTONO~2.CJS resolves to the governed policy module',
          gate.namesGovernedPath('electron/lib/AUTONO~2.CJS') === 'electron/lib/autonomypolicy.cjs',
          `namesGovernedPath returned ${JSON.stringify(gate.namesGovernedPath('electron/lib/AUTONO~2.CJS'))}`);
        check('8.3: the design\u2019s AUTONO~1 probe returned null because that short name is the GATE on this volume, not a governed file',
          gate.namesGovernedPath('electron/lib/AUTONO~1.cjs') === null
          && fs.existsSync(path.join(ROOT, 'electron', 'lib', 'autonomyGate.cjs')),
          'the short name resolved to something else, so the recorded reason needs re-measuring');
        check('8.3: the residual is stated as three named cases, with the apply-time owner named',
          contract.EIGHT_DOT_THREE.residual.length === 3
          && contract.EIGHT_DOT_THREE.residual.some((r) => r.includes('do not exist yet'))
          && contract.EIGHT_DOT_THREE.residual.some((r) => r.includes('generation disabled'))
          && contract.EIGHT_DOT_THREE.residual.some((r) => r.includes('hard link'))
          && contract.EIGHT_DOT_THREE.owner.includes('upgradeApplier'),
          JSON.stringify(contract.EIGHT_DOT_THREE));
      }

      // ── The hard boundary, 7.1-7.7 ────────────────────────────────────────
      console.log('\n  the hard boundary — asserted, not promised');
      {
        const floorsDrift = Object.keys(POLICY_SNAPSHOT.floors)
          .filter((c) => policy.FLOORS[c] !== POLICY_SNAPSHOT.floors[c]);
        const ceilDrift = Object.keys(POLICY_SNAPSHOT.ceilings)
          .filter((c) => policy.CEILINGS[c] !== POLICY_SNAPSHOT.ceilings[c]);
        check('boundary: 7.1 FLOORS is value-identical to its pre-task snapshot, all fifteen classes',
          floorsDrift.length === 0 && Object.keys(policy.FLOORS).length === 15,
          `moved: ${floorsDrift.map((c) => `${c}=${policy.FLOORS[c]}`).join(', ')}`);
        check('boundary: 7.1 CEILINGS is value-identical to its pre-task snapshot, all fifteen classes',
          ceilDrift.length === 0 && Object.keys(policy.CEILINGS).length === 15,
          `moved: ${ceilDrift.map((c) => `${c}=${policy.CEILINGS[c]}`).join(', ')}`);
        check('boundary: 7.1 PERMANENT holds exactly the seven permanent classes',
          policy.PERMANENT.size === 7 && POLICY_SNAPSHOT.permanent.every((c) => policy.PERMANENT.has(c))
          && policy.PERMANENT.add === undefined && policy.PERMANENT.delete === undefined,
          `size=${policy.PERMANENT.size}`);
        check('boundary: 7.1 the one class this contract uses is unmoved — floor L1, ceiling L3',
          policy.FLOORS[pin.approvalClass] === 'L1' && policy.CEILINGS[pin.approvalClass] === 'L3',
          `${pin.approvalClass}: ${policy.FLOORS[pin.approvalClass]}..${policy.CEILINGS[pin.approvalClass]}`);
        check('boundary: 7.2 UNREACHABLE_LEVEL is L5 and no class holds it',
          policy.UNREACHABLE_LEVEL === POLICY_SNAPSHOT.unreachableLevel
          && !Object.values(policy.FLOORS).includes('L5')
          && !Object.values(policy.CEILINGS).includes('L5'),
          `UNREACHABLE_LEVEL=${policy.UNREACHABLE_LEVEL}`);
        check('boundary: 7.3 AUTHORING_MODES is exactly [template]',
          Array.isArray(contract.AUTHORING_MODES) && contract.AUTHORING_MODES.length === 1
          && contract.AUTHORING_MODES[0] === 'template',
          JSON.stringify(contract.AUTHORING_MODES));
        check('boundary: 7.5 every site.action is a member of upgradeApplier.ALLOWED_ACTIONS, read from the export',
          applier.ALLOWED_ACTIONS.length === 2
          && contract.ENTRIES.every((e) => applier.ALLOWED_ACTIONS.includes(e.site.action)),
          `ALLOWED_ACTIONS=${JSON.stringify(applier.ALLOWED_ACTIONS)} actions=${contract.ENTRIES.map((e) => e.site.action).join(', ')}`);
        check('boundary: 7.5 no entry declares the create action',
          contract.ENTRIES.every((e) => e.site.action !== 'create'),
          contract.ENTRIES.filter((e) => e.site.action === 'create').map((e) => e.editId).join(', '));
        check('boundary: every approvalClass is a member of policy.CLASSES and every needLevel of LEVELS',
          contract.ENTRIES.every((e) => policy.CLASSES.includes(e.approvalClass) && own(policy.LEVELS, e.needLevel)),
          contract.ENTRIES.map((e) => `${e.approvalClass}/${e.needLevel}`).join(', '));
        check('boundary: every needLevel ranks at or below its class ceiling',
          contract.ENTRIES.every((e) => policy.rank(e.needLevel) <= policy.rank(policy.CEILINGS[e.approvalClass])),
          contract.ENTRIES.map((e) => `${e.editId}: ${e.needLevel} vs ceiling ${policy.CEILINGS[e.approvalClass]}`).join(' | '));
        check('boundary: 7.7 the advisor\u2019s SENSITIVE export is unchanged — nine members, and still a live mutable Set this suite does not freeze',
          advisor.SENSITIVE.size === 9 && SENSITIVE_PINNED.every((n) => advisor.SENSITIVE.has(n))
          && Object.isFrozen(advisor.SENSITIVE) === false && typeof advisor.SENSITIVE.add === 'function',
          `size=${advisor.SENSITIVE.size} frozen=${Object.isFrozen(advisor.SENSITIVE)}`);
      }

      // ── Rendering ─────────────────────────────────────────────────────────
      console.log('\n  the rendering, derived from ENTRIES with no second copy');
      {
        const rows = contract.render();
        check('render: every entry appears exactly once, with its reachability stated',
          rows.length === contract.ENTRIES.length
          && contract.ENTRIES.every((e) => rows.filter((r) => r.editId === e.editId).length === 1)
          && rows.every((r) => r.reachable === 'yes' || r.reachable === 'no'),
          `rows=${rows.length} entries=${contract.ENTRIES.length}`);
        check('render: an unverifiable-here entry renders as the literal word UNVERIFIED',
          contract.ENTRIES.every((e) => (e.verification.where === 'unverifiable-here')
            === (rows.find((r) => r.editId === e.editId).verification === 'UNVERIFIED')),
          rows.map((r) => `${r.editId}=${r.verification}`).join(', '));
        check('render: the legacy verification value not-run also renders as UNVERIFIED, never as a pass',
          contract.renderVerification('not-run') === 'UNVERIFIED'
          && contract.renderVerification(null) === 'UNVERIFIED'
          && contract.renderVerification({ kind: null, where: 'here' }) === 'UNVERIFIED',
          `not-run rendered as ${contract.renderVerification('not-run')}`);
        check('render: timeoutMs prints as a declaration rather than a guarantee',
          rows.every((r) => r.timeout === 'none declared' || r.timeout.includes('declared')),
          rows.map((r) => r.timeout).join(' | '));
        check('render: the census line names six entries, one reachable and five unreachable',
          contract.censusLine() === 'entries: 6 \u00b7 reachable: 1 \u00b7 unreachable: 5 '
          + '(add-export, add-array-member, replace-literal, install-missing-package, name-engine-cause)',
          contract.censusLine());
        console.log(`    ${contract.censusLine()}`);
      }

      // ── The four adjacent gaps — NAMED, not fixed, each asserted still open ──
      console.log('\n  LIMITS — named, not fixed, and each row reddens the day its gap closes');
      {
        check('LIMIT: the module declares exactly the four adjacent gaps, each with whose decision it is',
          contract.ADJACENT_GAPS.length === 4
          && LIMITS.every((l) => contract.ADJACENT_GAPS.some((g) => g.id === l.id))
          && contract.ADJACENT_GAPS.every((g) => g.whose.length > 0 && g.status.length > 0),
          contract.ADJACENT_GAPS.map((g) => g.id).join(', '));
        for (const limit of LIMITS) {
          const gap = contract.ADJACENT_GAPS.find((g) => g.id === limit.id);
          console.log(`    ${limit.id} \u00b7 ${limit.whose}`);
          console.log(`        ${gap.status} \u00b7 probe: ${limit.probe}`);
        }

        const timelineView = codeView
          ? codeView(fs.readFileSync(path.join(ROOT, 'electron', 'ipc', 'timeline.cjs'), 'utf8')) : '';
        check('LIMIT: the timeline applier still writes change.path verbatim — unconfined, and master\u2019s decision to change',
          timelineView.includes('registerApplier') && timelineView.includes('fs.writeFileSync(change.path')
          && timelineView.includes('fs.rmSync(change.path'),
          'the applier was confined, so this limit is stale and must be rewritten');
        check('LIMIT: the hard link is declared stated-untested-unclosed, with no runtime probe claimed',
          contract.ADJACENT_GAPS.find((g) => g.id === 'hard-link-residual').status === 'stated, untested, unclosed',
          'the status claims more than was measured');
        const policyFile = policy.SELF_GOVERNING_PATHS.find((r) => r.optional === true).path;
        check('LIMIT: the policy data file is self-governing and still NOT in the covenant list',
          !guard.PROTECTED_FILES.includes(policyFile)
          && policy.SELF_GOVERNING_PATHS.some((r) => r.path === policyFile)
          && !fs.existsSync(path.join(ROOT, policyFile))
          && contract.fenceProbe(policyFile).ok === false,
          `the covenant list now holds ${policyFile}, so this limit is closed and must be rewritten`);
        check('LIMIT: diagnoseFailure still emits no causeId, so name-engine-cause stays blocked',
          measure('aiProcess.diagnoseFailure', 'causeId').presence === 'never'
          && measure('aiProcess.diagnoseFailure', 'causeId').total === 8,
          JSON.stringify(measure('aiProcess.diagnoseFailure', 'causeId')));
      }

      // ── The load boundary, proved at runtime ──────────────────────────────
      //
      // Done LAST because it empties two entries from `require.cache`. The advisor's `SENSITIVE`
      // export is READ rather than copied, so one require of it is unavoidable — the guarantee is that
      // it happens on the CALL and not on the LOAD.
      console.log('\n  the load boundary, proved by emptying the cache');
      {
        const advisorAbs = require.resolve(path.join(ROOT, 'electron', 'lib', 'dependencyAdvisor.cjs'));
        const contractResolved = require.resolve(contractAbs);
        delete require.cache[contractResolved];
        delete require.cache[advisorAbs];
        let fresh = null;
        let freshErr = '';
        try { fresh = require(contractResolved); } catch (e) { freshErr = e.message; }
        const advisorAtLoad = own(require.cache, advisorAbs);
        check('contract: it loads under plain node and does not pull in its producers at module scope',
          !freshErr && !!fresh && !advisorAtLoad && Array.isArray(fresh && fresh.ENTRIES),
          freshErr || `the advisor was ${advisorAtLoad ? 'loaded at module scope' : 'not loaded'}`);
        if (fresh) {
          fresh.weigh({ editId: 'pin-version', params: PARAMS, io: { repoRoot: tmpRoot } });
          check('contract: weigh() reads the advisor\u2019s SENSITIVE export lazily, on the call rather than on the load',
            own(require.cache, advisorAbs),
            'weigh() answered without asking the export, which means the list was copied');
        }
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
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
