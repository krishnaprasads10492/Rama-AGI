'use strict';

/**
 * repairContract.cjs — the repairs Rāma may author, as one frozen enumerable table (spec Section 137)
 *
 * Follows `autonomyPolicy.cjs`: frozen declared data over frozen code, with every derivable member
 * DERIVED rather than restated, because a second list is how two lists come to disagree. Only two
 * facts about a producer are authored — `producerModule` and `producerFn`; `idOf`, `PRODUCED_BY`,
 * `REACHABLE`, `UNREACHABLE` and `ENTRY_IDS` all fall out of them.
 *
 * ── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────────────────────────────
 *
 * `author()` returns a payload. It does not file, dispatch, apply, or write a byte. `verdict: 'ok'`
 * means *the contract has nothing further to say* — it is not authorisation and nothing reads it as
 * such. I6 is unmoved: Rāma proposes, master approves.
 *
 * ── THE PRODUCERS ARE NAMED AS STRINGS, DELIBERATELY ─────────────────────────────────────────────
 *
 * `electron/ipc/aiProcess.cjs` requires `electron` at module scope. If this module required its
 * producers, it could not load under plain `node`, and a contract that cannot be read without an
 * Electron process is a contract nobody audits. So producers are `{producerModule, producerFn}`
 * strings and resolving them is the verification suite's job.
 *
 * LOAD-TIME REQUIRES ARE EXACTLY: `fs`, `path`, `crypto`, `./autonomyPolicy.cjs`,
 * `./loyaltyGuard.cjs`, `./autonomyGate.cjs`. One module is required LAZILY, inside `weigh()` —
 * `./dependencyAdvisor.cjs`, for its `SENSITIVE` export. That export is READ, never copied: pasting
 * the nine package names here is precisely the restatement this file exists to refuse, and a lazy
 * require keeps the load-time set at three. If the advisor cannot be loaded, `weigh()` decides toward
 * master rather than quietly reporting "not sensitive".
 *
 * ── `author()` IS SINGLE-VERDICT ON THIS INSTALL, AND THERE IS NO POLICY SEAM ─────────────────────
 *
 * `policy.require` reads the fixed `DATA_FILE` and takes no injectable state. Measured here:
 * `effective('dependency-change')` is `'L0'` (`'L1'` with `{ignoreStop: true}`), both below the `'L3'`
 * this table declares it needs — so `author()` can only ever return `verdict: 'refused'`.
 *
 * An `io.policy` seam would make `'ok'` reachable under test. It is NOT offered: an injectable
 * override of the gate that refuses autonomy is a test-only bypass of a security boundary, and a
 * bypass built to make an assertion green is worse than an assertion that states its limit.
 * `VERDICT_REACHABILITY` below therefore declares `'ok'` as `unverifiable-here` WITH THE REASON, and
 * `transform()`, `weigh()`, `verify()`, `validateParams()`, `fencePath()` and `buildChanges()` are
 * exported so each criterion is proved by a named function instead.
 *
 * ── `timeoutMs` IS A DECLARATION, NOT A GUARANTEE ────────────────────────────────────────────────
 *
 * `verifyJsonDependencyCount` is synchronous and `verify()` applies no deadline. `timeoutMs` is
 * DECLARED DATA FOR A FUTURE RUNNER. `render()` prints it as a declaration for exactly that reason: a
 * declared timeout read by nothing would otherwise be believed.
 *
 * I12: `console.warn` / `console.error` only. Every warn site below is a defect in the TABLE, not a
 * caller error, which is why it is warned rather than returned silently.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const policy = require('./autonomyPolicy.cjs');
const guard = require('./loyaltyGuard.cjs');
const gate = require('./autonomyGate.cjs');

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ─── Preconditions, named once so a `why` can quote one verbatim ──────────────
//
// Section 137 / §4: `<which>` in a precondition refusal is VERBATIM one of the entry's declared
// `preconditions` strings, never free prose. These constants are what make that mechanical.

const P_READABLE = 'package.json is readable';
const P_SIZE = 'package.json is at most 1 MiB';
const P_PARSES = 'package.json parses as JSON';
const P_AGREE = 'the located bytes agree with the parsed value';
const P_ONCE = 'name appears exactly once across dependencies + devDependencies';
const P_EXACT = 'version is an exact semver with no range characters';
const P_DIFFERS = 'the value on disk differs from version';

const MAX_TARGET_BYTES = 1024 * 1024;
const UNKNOWN_EDIT_WHY = 'no declared edit produces this remedy';

/** The two sections a dependency member may live in, in the order they are searched. */
const SECTION_KEYS = Object.freeze(['dependencies', 'devDependencies']);

/**
 * A precondition failure carries the DECLARED STRING, not a message built at the throw site, so the
 * caller can format `${editId} preconditions not met: ${precondition}` and the suite can assert
 * `entry.preconditions.some(p => why.endsWith(p))`.
 */
class ContractPreconditionError extends Error {
  constructor(precondition) {
    super(precondition);
    this.name = 'ContractPreconditionError';
    this.precondition = precondition;
  }
}

const preconditionError = (precondition) => new ContractPreconditionError(precondition);

// ─── The table ────────────────────────────────────────────────────────────────

/**
 * ONE reachable entry and five declared-unreachable ones. The five stay because the table is additive
 * (I11): removing them would make a future edit a new concept to be invented rather than a row to be
 * filled, and `blockedOn` is the only honest way to say "named, and reaching nothing".
 *
 * `sensitive` is deliberately NOT in `reads`. The row field is real — measured,
 * `assess({name:'electron', ...}).sensitive === true` — but `fires` does not read it and `weigh()`
 * asks the `SENSITIVE` export instead, which is a property of the package name rather than a field a
 * stale producer could set. Declaring a read nothing reads is a dead declaration, and the suite's own
 * rule would redden it on the first run.
 */
const ENTRIES = Object.freeze([
  Object.freeze({
    editId: 'pin-version',
    what: 'pin one dependency to an exact version already reported by the registry',

    // ── WHEN ─────────────────────────────────────────────────────────────────
    trigger: Object.freeze({
      producerModule: 'electron/lib/dependencyAdvisor.cjs',   // authored
      producerFn: 'assess',                                   // authored
      reads: Object.freeze([
        Object.freeze({ path: 'name', presence: 'always' }),
        // `always`, measured: the key is emitted even when the input omitted it, valued `undefined`,
        // and it is `JSON.stringify` that hides it. The falsy-`latest` refusal in `fires` is
        // therefore driven by VALUE, never by presence.
        Object.freeze({ path: 'latest', presence: 'always' }),
        Object.freeze({ path: 'jump', presence: 'always' }),
      ]),
      // Which declared read each param came from. A value-based provenance check cannot say WHICH
      // read produced a param — `params.version = row.jump` satisfies "is some recorded value",
      // because `'patch'` is a recorded read. This map is what makes the question answerable.
      paramSources: Object.freeze({ name: 'name', version: 'latest' }),
      fires,
      negative: Object.freeze([
        Object.freeze({ when: "jump === 'current'", case: 'current' }),
        Object.freeze({ when: "jump === 'downgrade'", case: 'downgrade' }),
        Object.freeze({ when: "jump === 'unknown'", case: 'unknown' }),
        Object.freeze({ when: "jump === 'breaking'", case: 'breaking' }),
      ]),
      positive: Object.freeze([
        Object.freeze({ when: "jump === 'patch'", case: 'patch' }),
        Object.freeze({ when: "jump === 'feature'", case: 'feature' }),
      ]),
      // DECLARED DEFENCE IN DEPTH, and declared unreachable rather than exercised. Measured,
      // `classifyJump` returns `'unknown'` whenever `latest` is falsy — both for an absent key and
      // for the empty string — so `fires` always returns at the `jump` guard and the `latest` guard
      // is never the deciding branch. It stays because `fires` is exported and a future caller is not
      // obliged to come through `assess`; it is not listed as a negative trigger, because a case that
      // proves `jump === 'unknown'` twice proves it once.
      declaredUnreachableGuards: Object.freeze([
        Object.freeze({
          guard: 'latest is falsy or not a string',
          why: "classifyJump returns 'unknown' whenever latest is falsy, so the jump guard decides first",
        }),
      ]),
    }),

    // ── WHERE ────────────────────────────────────────────────────────────────
    site: Object.freeze({
      paths: Object.freeze(['package.json']),
      pathKind: 'exact',
      maxChanges: 1,
      // A member of `upgradeApplier.ALLOWED_ACTIONS`, which the suite reads from the export. The
      // applier owns the vocabulary; this table owns which word it may use — and declaring it is what
      // makes a `create` row reddenable instead of merely unwelcome.
      action: 'patch',
    }),

    // ── WHAT ─────────────────────────────────────────────────────────────────
    params: Object.freeze({ name: 'string', version: 'string' }),
    preconditions: Object.freeze([
      P_READABLE, P_SIZE, P_PARSES, P_AGREE, P_ONCE, P_EXACT, P_DIFFERS,
    ]),
    transform,

    // ── HOW VERIFIED ─────────────────────────────────────────────────────────
    verification: Object.freeze({
      kind: 'json-parse+dependency-count',
      // DOCUMENTATION. The registered verifier is the authority; this sentence is what the renderer
      // shows a human. The two are asserted to exist together, never to be each other.
      pass: 'JSON.parse succeeds AND the dependency count is unchanged AND the named package '
        + 'resolves to exactly params.version',
      // Declared data for a future runner. `verify()` does NOT enforce it — see the header.
      timeoutMs: 5000,
      where: 'here',
      whyNotHere: null,
    }),

    // ── WHO DECIDES ──────────────────────────────────────────────────────────
    approvalClass: 'dependency-change',
    needLevel: 'L3',
    cons: Object.freeze([
      'package.json is edited and package-lock.json is NOT. A pinned version changed in one '
      + 'without the other makes a clean install fail outright.',
    ]),

    // ── PROVENANCE ───────────────────────────────────────────────────────────
    provenance: Object.freeze({
      spec: 'Section 137',
      research: 'docs/research/SELF_UPGRADE.md §E.4.2a',
      measured: 'dependencyAdvisor.assess() returns 13 keys and `target` is not one of them '
        + '(measured 2026-07-01 over a 10-case corpus)',
    }),
  }),

  Object.freeze({
    editId: 'add-export',
    what: 'add one named export to a module that another module already imports',
    trigger: null,
    site: Object.freeze({ paths: Object.freeze([]), pathKind: 'none', maxChanges: 0, action: 'patch' }),
    params: Object.freeze({}),
    preconditions: Object.freeze([]),
    transform: null,
    verification: Object.freeze({
      kind: null, pass: null, timeoutMs: null,
      where: 'unverifiable-here',
      whyNotHere: 'no producer reaches this entry',
    }),
    approvalClass: 'dependency-change',
    needLevel: 'L3',
    blockedOn: Object.freeze({
      producerModule: null,
      producerFn: null,
      missingFields: Object.freeze([]),
      why: "no producer emits a structured {editId, params} for it — selfModel's one limit carries a "
        + '`fixable` written as prose for master, and a string written for a human is not a parameter list',
    }),
    provenance: Object.freeze({
      spec: 'Section 137',
      research: 'docs/research/SELF_UPGRADE.md §E.5.3a',
      measured: 'selfModel.describe() resolves limits.length === 1 and that limit\u2019s `fixable` is prose '
        + '(measured 2026-07-01)',
    }),
  }),

  Object.freeze({
    editId: 'add-array-member',
    what: 'add one member to a declared array in a configuration file',
    trigger: null,
    site: Object.freeze({ paths: Object.freeze([]), pathKind: 'none', maxChanges: 0, action: 'patch' }),
    params: Object.freeze({}),
    preconditions: Object.freeze([]),
    transform: null,
    verification: Object.freeze({
      kind: null, pass: null, timeoutMs: null,
      where: 'unverifiable-here',
      whyNotHere: 'no producer reaches this entry',
    }),
    approvalClass: 'dependency-change',
    needLevel: 'L3',
    blockedOn: Object.freeze({
      producerModule: null,
      producerFn: null,
      missingFields: Object.freeze([]),
      why: 'no producer emits a structured {editId, params} for it — the same prose boundary as add-export',
    }),
    provenance: Object.freeze({
      spec: 'Section 137',
      research: 'docs/research/SELF_UPGRADE.md §E.5.3a',
      measured: 'no sensor in this repo emits an array-member remedy as data (measured 2026-07-01)',
    }),
  }),

  Object.freeze({
    editId: 'replace-literal',
    what: 'replace one declared literal value with another the producer already reported',
    trigger: null,
    site: Object.freeze({ paths: Object.freeze([]), pathKind: 'none', maxChanges: 0, action: 'patch' }),
    params: Object.freeze({}),
    preconditions: Object.freeze([]),
    transform: null,
    verification: Object.freeze({
      kind: null, pass: null, timeoutMs: null,
      where: 'unverifiable-here',
      whyNotHere: 'no producer reaches this entry',
    }),
    approvalClass: 'dependency-change',
    needLevel: 'L3',
    blockedOn: Object.freeze({
      producerModule: null,
      producerFn: null,
      missingFields: Object.freeze([]),
      why: 'no producer emits a structured {editId, params} for it — the same prose boundary as add-export',
    }),
    provenance: Object.freeze({
      spec: 'Section 137',
      research: 'docs/research/SELF_UPGRADE.md §E.5.3a',
      measured: 'no sensor in this repo emits a literal-replacement remedy as data (measured 2026-07-01)',
    }),
  }),

  Object.freeze({
    editId: 'install-missing-package',
    what: 'install one dependency a startup probe reported as absent',
    trigger: null,
    site: Object.freeze({ paths: Object.freeze([]), pathKind: 'none', maxChanges: 0, action: 'patch' }),
    params: Object.freeze({}),
    preconditions: Object.freeze([]),
    transform: null,
    verification: Object.freeze({
      kind: null, pass: null, timeoutMs: null,
      where: 'unverifiable-here',
      whyNotHere: 'the repair already happens elsewhere, so there is nothing here to verify',
    }),
    approvalClass: 'dependency-change',
    needLevel: 'L3',
    // The ONE unreachable entry that is not blocked by an absent producer. `startupDoctor.diagnose`
    // does emit stable ids (`dep-<name>`, `renderer-missing`, `caps-missing`, `load-<name>`), and
    // `selfRepair.repairModule` already performs this repair at runtime, lockfile-bounded. This entry
    // declares the boundary so the capability is not reinvented here; it authors nothing.
    blockedOn: Object.freeze({
      producerModule: null,
      producerFn: null,
      missingFields: Object.freeze([]),
      why: 'selfRepair.repairModule already performs this repair at runtime, lockfile-bounded — this '
        + 'entry declares the boundary rather than duplicating the capability (I11)',
    }),
    provenance: Object.freeze({
      spec: 'Section 137',
      research: 'docs/research/SELF_UPGRADE.md §E.5.3a',
      measured: 'startupDoctor.diagnose emits stable ids on fatal[]/degraded[], and report[] carries '
        + '{label, pass, note} instead — two distinct shapes (measured 2026-07-01)',
    }),
  }),

  Object.freeze({
    editId: 'name-engine-cause',
    what: 'attach a stable cause id to an engine start failure',
    trigger: null,
    site: Object.freeze({ paths: Object.freeze([]), pathKind: 'none', maxChanges: 0, action: 'patch' }),
    params: Object.freeze({}),
    preconditions: Object.freeze([]),
    transform: null,
    verification: Object.freeze({
      kind: null, pass: null, timeoutMs: null,
      where: 'unverifiable-here',
      whyNotHere: 'the producer emits no stable id, so there is no value to verify against',
    }),
    approvalClass: 'dependency-change',
    needLevel: 'L3',
    // The INVERTED presence assertion: the suite requires every `missingFields` path to measure
    // `'never'` across the producer's whole corpus. The day `causeId` appears, this row goes red and
    // says the entry is no longer blocked — which is the point.
    blockedOn: Object.freeze({
      producerModule: 'electron/ipc/aiProcess.cjs',
      producerFn: 'diagnoseFailure',
      missingFields: Object.freeze(['causeId']),
      why: 'FR-A32 — eight branches return {reason, remedy} (+ silent on two) and no stable id',
    }),
    provenance: Object.freeze({
      spec: 'Section 137',
      research: 'docs/research/SELF_UPGRADE.md §E.5.3a',
      measured: 'causeId absent from all 8 branches (measured 2026-07-01)',
    }),
  }),
]);

// ─── Derived members, and nothing restated ────────────────────────────────────

/** The producer id, DERIVED from the two authored fields. Never an authored third field. */
function idOf(entry) {
  if (!entry || !entry.trigger) return null;
  return `${path.basename(String(entry.trigger.producerModule), '.cjs')}.${entry.trigger.producerFn}`;
}

const ENTRY_IDS = Object.freeze(ENTRIES.map((e) => e.editId));

const PRODUCED_BY = Object.freeze(Object.fromEntries(
  ENTRIES.map((e) => [e.editId, Object.freeze(idOf(e) ? [idOf(e)] : [])]),
));

// `policy.frozenSetView` is REUSED, never re-implemented. `Object.freeze(new Set(...))` freezes
// properties and not internal slots — `autonomyPolicy.cjs` records that `PERMANENT.delete()` succeeded
// against a "frozen" set — and a second view here is how two implementations come to disagree about
// what frozen means.
const REACHABLE = policy.frozenSetView(ENTRIES.filter((e) => e.trigger).map((e) => e.editId));
const UNREACHABLE = policy.frozenSetView(ENTRIES.filter((e) => !e.trigger).map((e) => e.editId));

/** Exactly one mode. A `'model'` member is a rung climbed, and the suite reddens on it. */
const AUTHORING_MODES = Object.freeze(['template']);

const VERDICTS = Object.freeze(['ok', 'needs-master-decision', 'refused']);

/**
 * Which verdicts are provable on this install, and by which function. `'ok'` is marked
 * `unverifiable-here` WITH ITS REASON rather than made reachable by a seam — see the header.
 */
const VERDICT_REACHABILITY = Object.freeze([
  Object.freeze({
    verdict: 'refused',
    where: 'here',
    provedBy: 'author',
    why: 'policy.require is the first thing author() asks, and on this install it refuses: measured '
      + "effective('dependency-change') is 'L0' and the table declares it needs 'L3'",
  }),
  Object.freeze({
    verdict: 'needs-master-decision',
    where: 'unverifiable-here',
    provedBy: 'weigh',
    why: 'author() returns at the policy gate before weigh() is consulted, so this verdict is proved '
      + 'through weigh() as an exported function rather than through author()',
  }),
  Object.freeze({
    verdict: 'ok',
    where: 'unverifiable-here',
    provedBy: null,
    why: 'policy.require reads the fixed DATA_FILE and takes no injectable state; measured, the '
      + "effective level is 'L0' ('L1' even with the stop set aside), both below the needed 'L3', so "
      + 'author() can '
      + 'only return refused. There is deliberately no injectable policy seam: an override of the '
      + 'gate that refuses autonomy would be a test-only bypass of a security boundary. transform(), '
      + 'weigh(), verify(), validateParams(), fencePath() and buildChanges() are exported and '
      + 'exercised directly instead.',
  }),
]);

/**
 * The adjacent gaps. NAMED, not fixed, each with whose decision it is — because a gap recorded as
 * closed is worse than a gap recorded as open, and a fence published as weaker than it is sends a
 * later session to "fix" working code.
 */
const ADJACENT_GAPS = Object.freeze([
  Object.freeze({
    id: 'timeline-applier-unconfined',
    what: "electron/ipc/timeline.cjs's SELF_MODIFY applier uses change.path verbatim — no "
      + 'resolve-then-compare, no lstat, no canonicalisation, no repo-root check',
    whose: "master's decision — confining a shipped applier is a behaviour change, and refusing "
      + 'delete would remove a capability the renderer can reach today (I11)',
    status: 'named, not fixed',
  }),
  Object.freeze({
    id: 'hard-link-residual',
    what: 'realpathSync.native answers which PATH a name resolves to, not which FILE — an alias shares '
      + '(dev, ino), reports nlink > 1, resolves to a different canonical path, and is not a symlink',
    whose: 'the path fence, at apply time',
    status: 'stated, untested, unclosed',
  }),
  Object.freeze({
    id: 'policy-file-unprotected',
    what: "the autonomy policy's DATA FILE is named by policy.SELF_GOVERNING_PATHS (optional) but is "
      + 'not in the covenant list, so this contract refuses it and the covenant layer does not',
    whose: "master's action — it is a protected-file edit and a tripwire re-approval",
    status: 'restated from Section 132, not actioned',
  }),
  Object.freeze({
    id: 'engine-cause-id',
    what: 'aiProcess.diagnoseFailure returns {reason, remedy} (+ silent on two of eight branches) '
      + 'keyed on regexes over stderr text, with no stable id',
    whose: 'SELF_UPGRADE §E.5.3a already chose option (a) — the mapping lives in a consumer',
    status: 'gap stated, not closed — the name-engine-cause entry carries it as blockedOn',
  }),
]);

/**
 * The 8.3 short-name limit, restated AS MEASURED. The design recorded 8.3 as unresolved on the
 * strength of `AUTONO~1.cjs` returning `null` — but on this volume that short name is
 * `autonomyGate.cjs`, which is not a governed file. Measured, `AUTONO~2.CJS` IS caught.
 */
const EIGHT_DOT_THREE = Object.freeze({
  resolved: 'short names of EXISTING governed files — namesGovernedPath asks canonicalPath as its '
    + 'second spelling, and AUTONO~2.CJS resolves to the governed policy module',
  residual: Object.freeze([
    'create targets that do not exist yet, so no short name has been generated',
    'volumes with 8.3 name generation disabled',
    'the hard link, which is a different file sharing an inode rather than a different spelling',
  ]),
  owner: 'upgradeApplier.canonicalPathOf / validatePath, at apply time, where the filesystem is '
    + 'actually touched — this module does not re-implement them',
});

// ─── The trigger ──────────────────────────────────────────────────────────────

/**
 * `(row) => {editId, params} | null`. `jump` is the field that decides.
 *
 * `latest` is echoed verbatim from the advisor's input and is a string in every measured case,
 * including `current` and `downgrade`, so a predicate built on `latest` being absent would never reach
 * the negative path. `downgrade` yields `null` because `buildMeaning` reads that state as "the release
 * was withdrawn" — pinning to a withdrawn release on Rāma's own initiative inverts the advisor's
 * posture. `breaking` yields `null` because `classifyJump` reads a major bump as the author signalling
 * an incompatible change, and that is not a repair.
 */
function fires(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.jump !== 'patch' && row.jump !== 'feature') return null;
  // Declared defence in depth, never the deciding branch — see `declaredUnreachableGuards`.
  if (!row.latest || typeof row.latest !== 'string') return null;
  return { editId: 'pin-version', params: { name: row.name, version: row.latest } };
}

// ─── The transform: derivation, not generation ────────────────────────────────

const asText = (bytes) => (typeof bytes === 'string' ? bytes : String(bytes));

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';

/** How many times `literal` occurs in `text`. Counted, because "exactly once" is a precondition. */
function occurrences(text, literal) {
  let n = 0;
  let at = text.indexOf(literal);
  while (at !== -1) { n += 1; at = text.indexOf(literal, at + literal.length); }
  return n;
}

/**
 * The byte span of the object that follows `from`, by DEPTH COUNTING over `{` / `}` while skipping
 * string literals.
 *
 * No negated character class spans this structure. A `[^}]` that cannot cross a brace has already
 * shipped green in this repo once; brace-matching is the rule that replaced it.
 */
function braceSpan(text, from) {
  let i = from;
  while (i < text.length && text[i] !== '{') {
    if (!isSpace(text[i]) && text[i] !== ':') return null;
    i += 1;
  }
  if (i >= text.length) return null;
  const open = i;
  let depth = 0;
  let inString = false;
  for (let j = open; j < text.length; j += 1) {
    const ch = text[j];
    if (inString) {
      if (ch === '\\') { j += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return Object.freeze({ open, close: j });
    }
  }
  return null;
}

/**
 * The string value of the member whose key ends at `from`, or `null` if what follows is not
 * `: "..."`. Requiring the colon is what stops a bare string in an array matching as a member.
 */
function stringValueAt(text, from, limit) {
  let i = from;
  while (i < limit && isSpace(text[i])) i += 1;
  if (text[i] !== ':') return null;
  i += 1;
  while (i < limit && isSpace(text[i])) i += 1;
  if (text[i] !== '"') return null;
  const valueStart = i + 1;
  let j = valueStart;
  while (j < limit) {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === '"') return Object.freeze({ value: text.slice(valueStart, j), valueStart, valueEnd: j });
    j += 1;
  }
  return null;
}

/**
 * Where `params.name`'s version value lives in `bytes`, scoped to the two dependency sections.
 *
 * Returns a frozen `{section, value, valueStart, valueEnd}`, or throws a `ContractPreconditionError`
 * naming a declared precondition.
 */
function locate(bytes, params) {
  const text = asText(bytes);
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { throw preconditionError(P_PARSES); }

  const spans = [];
  for (const section of SECTION_KEYS) {
    const literal = `"${section}"`;
    // Measured on this repo's package.json: each literal occurs EXACTLY ONCE — `"dependencies"` at
    // line 73, `"devDependencies"` at line 99 — and the leading quote is why `"dependencies"` does
    // not match inside `"devDependencies"`. A SECOND occurrence is a precondition failure, not a
    // guess about which one was meant.
    const at = text.indexOf(literal);
    if (at === -1) continue;
    if (occurrences(text, literal) !== 1) throw preconditionError(P_ONCE);
    const span = braceSpan(text, at + literal.length);
    if (!span) throw preconditionError(P_ONCE);
    spans.push(Object.freeze({ section, open: span.open, close: span.close }));
  }
  if (spans.length === 0) throw preconditionError(P_ONCE);

  // Searched ONLY inside the two spans. This is what keeps the three `_*Note` prose keys at lines 7-9
  // out of reach: they sit outside both spans, so a lookalike `"cors": "2.8.5"` inside that prose is
  // never a candidate.
  const member = `"${params.name}"`;
  const hits = [];
  for (const span of spans) {
    let at = text.indexOf(member, span.open);
    while (at !== -1 && at < span.close) {
      const found = stringValueAt(text, at + member.length, span.close);
      if (found) {
        hits.push(Object.freeze({
          section: span.section, value: found.value, valueStart: found.valueStart, valueEnd: found.valueEnd,
        }));
      }
      at = text.indexOf(member, at + member.length);
    }
  }
  if (hits.length !== 1) throw preconditionError(P_ONCE);
  const hit = hits[0];

  // AGREE WITH THE PARSER BEFORE SPLICING. `JSON.parse` is used to validate and to agree, never to
  // emit: a reserialise would rewrite every byte, and the three `_*Note` keys each record a shipped
  // defect in prose that must survive byte-identical.
  const section = parsed[hit.section];
  if (!own(section, params.name) || section[params.name] !== hit.value) throw preconditionError(P_AGREE);
  return hit;
}

/**
 * `(bytes, params) => string`. Replaces ONLY the located value's characters, by index, so key order,
 * indentation and every other character survive.
 *
 * Measured size of the real target: 286 content lines; 14,235 BYTES on disk, 14,228 CHARACTERS
 * decoded (seven multi-byte characters). THIS FUNCTION INDEXES THE DECODED STRING.
 */
function transform(bytes, params) {
  const text = asText(bytes);
  const hit = locate(text, params);
  if (hit.value === params.version) throw preconditionError(P_DIFFERS);
  return text.slice(0, hit.valueStart) + params.version + text.slice(hit.valueEnd);
}

// ─── Verification: executable data, not prose ─────────────────────────────────

/**
 * `(before, after, params) => {verified, why}`. Each distinct failure carries its own `why`, because
 * one shared message is how two causes come to look like one.
 */
function verifyJsonDependencyCount(before, after, params) {
  let b;
  let a;
  try { b = JSON.parse(asText(before)); } catch (err) {
    return { verified: false, why: 'the before bytes do not parse as JSON' };
  }
  try { a = JSON.parse(asText(after)); } catch (err) {
    return { verified: false, why: 'the after bytes do not parse as JSON' };
  }
  const countOf = (doc) => SECTION_KEYS
    .reduce((n, k) => n + Object.keys((doc && doc[k]) || {}).length, 0);
  const bn = countOf(b);
  const an = countOf(a);
  if (an !== bn) return { verified: false, why: `the dependency count moved from ${bn} to ${an}` };

  let resolved = null;
  let found = false;
  for (const k of SECTION_KEYS) {
    if (own(a[k], params && params.name)) { resolved = a[k][params.name]; found = true; break; }
  }
  if (!found) return { verified: false, why: `${params && params.name} is in neither dependency section` };
  if (resolved !== (params && params.version)) {
    return {
      verified: false,
      why: `${params.name} resolves to ${JSON.stringify(resolved)}, not ${JSON.stringify(params.version)}`,
    };
  }
  return { verified: true, why: null };
}

const VERIFIERS = Object.freeze({
  'json-parse+dependency-count': verifyJsonDependencyCount,
});

const VERIFIER_KINDS = Object.freeze(Object.keys(VERIFIERS));

/**
 * `({editId, before, after, params}) => {verified, why}`.
 *
 * A verifier that THROWS is caught and reported `{verified: false, why: <message>}` — never
 * `verified: true`, and never silence. `verification.pass` is the human sentence and is documentation;
 * this function is the authority.
 */
function verify({ editId, before, after, params } = {}) {
  const entry = entryOf(editId);
  if (!entry) return { verified: false, why: UNKNOWN_EDIT_WHY };
  const spec = entry.verification;
  if (!spec || typeof spec !== 'object' || spec.where === 'unverifiable-here') {
    const why = (spec && spec.whyNotHere) || 'this entry declares no verification that runs here';
    return { verified: false, why };
  }
  const runner = own(VERIFIERS, spec.kind) ? VERIFIERS[spec.kind] : null;
  if (typeof runner !== 'function') {
    console.warn(`repairContract: ${String(spec.kind)} has no registered verifier — reporting unverified`);
    return { verified: false, why: `${String(spec.kind)} has no registered verifier` };
  }
  let out;
  try { out = runner(before, after, params); } catch (err) {
    return { verified: false, why: err && err.message ? err.message : String(err) };
  }
  if (!out || typeof out !== 'object' || typeof out.verified !== 'boolean') {
    return { verified: false, why: `${spec.kind} returned no {verified, why}` };
  }
  return { verified: out.verified === true, why: out.why === undefined ? null : out.why };
}

// ─── Input validation, inside this module ─────────────────────────────────────
//
// Every external input is validated HERE and not by a caller, because there is no caller in shipped
// code and a validation that lives in a hypothetical caller is not a validation.

const NAME_RE = /^(?:@[a-z0-9\-*~][a-z0-9\-*._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*$/;
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.\-]+)?$/;
const RANGE_CHARS = Object.freeze(['^', '~', '>', '<', '=', 'x', '*', '|']);
const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/**
 * `(entry, params) => null | {field, rule, why}`. `null` means accepted.
 *
 * `x` is in `RANGE_CHARS` on purpose: `1.2.x` is a range spelled without an operator. The cost is
 * that a prerelease tag containing the letter `x` is refused too, which is the declared rule rather
 * than an oversight.
 */
function validateParams(entry, params) {
  const editId = entry && entry.editId ? entry.editId : 'unknown';
  const reject = (field, rule) => Object.freeze({
    field, rule, why: `${editId} params rejected: ${field} ${rule}`,
  });
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return reject('params', 'must be a plain object');
  }
  for (const k of FORBIDDEN_KEYS) {
    if (own(params, k)) {
      return Object.freeze({
        field: 'forbidden key', rule: k, why: `${editId} params rejected: forbidden key ${k}`,
      });
    }
  }
  for (const field of Object.keys(entry.params || {})) {
    if (typeof params[field] !== 'string') return reject(field, 'must be a string');
  }
  if (typeof params.name === 'string') {
    if (params.name.length > 214) return reject('name', 'must be at most 214 characters');
    if (!NAME_RE.test(params.name)) return reject('name', 'must be a valid package name');
  }
  if (typeof params.version === 'string') {
    if (!EXACT_SEMVER_RE.test(params.version) || RANGE_CHARS.some((c) => params.version.includes(c))
      || /\s/.test(params.version)) {
      return reject('version', 'must be an exact semver with no range characters');
    }
  }
  return null;
}

// ─── The path fence ───────────────────────────────────────────────────────────

const ioFs = (io) => (io && io.fs) || fs;
const ioRoot = (io) => (io && typeof io.repoRoot === 'string' && io.repoRoot) || gate.REPO_ROOT;

/**
 * Normalise FIRST with the gate's own normaliser, then ask BOTH matchers.
 *
 * Measured, and this is why the order is not a style choice: `guard.inspectChanges` folds case and a
 * leading `./` and a SINGLE backslash, but it does NOT fold a trailing space, a DOUBLE backslash or a
 * doubled separator — three spellings it returns `{ok: true}` for. After `gate.normalisePath` all
 * seven spellings are refused. Normalise-first is therefore strictly stronger, and this function
 * reports both answers so a row can record the difference rather than assert the stronger one and
 * imply the weaker one never mattered.
 *
 * `governedPathsNamed` is asked rather than `namesGovernedPath` because it takes the definition shape,
 * returns `[{where, value, token}]` so a refusal can print WHICH token was named, and scans `meta` for
 * free. The LISTS live in the exports and the MATCHING lives in the fence: a restated list can be
 * narrowed by editing the restatement, and a re-implemented matcher is weaker than the one that ships.
 */
function fenceProbe(declaredPath, action = 'patch', io = {}) {
  const declared = String(declaredPath);
  const rawSeen = guard.inspectChanges([{ action, path: declared, content: '' }]);
  const rel = gate.normalisePath(declared);
  const governed = gate.governedPathsNamed({ changes: [{ action, path: rel }], meta: {} }, io);
  const covenant = guard.inspectChanges([{ action, path: rel, content: '' }]);

  const root = ioRoot(io);
  const resolved = path.resolve(root, rel);
  const inside = resolved === root
    || resolved.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`);

  let why = null;
  if (!inside) why = `refused: "${rel}" resolves outside the repository root`;
  else if (governed.length) {
    why = `refused: "${rel}" names ${governed[0].token}, which governs the autonomy policy or the stop`;
  } else if (covenant.ok !== true) {
    why = `refused: "${covenant.refused[0]}" is a protected covenant file`;
  }

  return Object.freeze({
    declared,
    rel,
    inside,
    raw: Object.freeze({
      ok: rawSeen.ok === true,
      refused: Object.freeze([...(rawSeen.refused || [])]),
    }),
    normalised: Object.freeze({
      ok: covenant.ok === true,
      refused: Object.freeze([...(covenant.refused || [])]),
    }),
    governed: Object.freeze(governed.map((g) => Object.freeze({ ...g }))),
    ok: why === null,
    why,
  });
}

/** `(entry, declaredPath, io) => null | string`. `null` means the path passed the fence. */
function fencePath(entry, declaredPath, io = {}) {
  const action = entry && entry.site ? entry.site.action : 'patch';
  const probe = fenceProbe(declaredPath, action, io);
  if (probe.ok) return null;
  console.warn(`repairContract: ${probe.why}`);
  return probe.why;
}

// ─── Building the change, and the declared bound ──────────────────────────────

/** `(editId) => entry | null`, by identity over the frozen table. */
function entryOf(editId) {
  return ENTRIES.find((e) => e.editId === editId) || null;
}

/**
 * `({entry, params, io}) => {changes, why}`. Reads, transforms, and enforces `site.maxChanges`.
 *
 * It WRITES NOTHING. The bound refusal returns `{changes: []}` rather than a partial edit, and the
 * suite proves nothing was written by comparing the target's sha256 across the call.
 */
function buildChanges({ entry, params, io = {} }) {
  const refuse = (why) => ({ changes: [], why, before: null });
  const precondition = (which) => refuse(`${entry.editId} preconditions not met: ${which}`);

  const target = entry.site.paths[0];
  const abs = path.join(ioRoot(io), target);
  const io_fs = ioFs(io);

  let stat;
  try { stat = io_fs.statSync(abs); } catch (err) { return precondition(P_READABLE); }
  if (!stat || typeof stat.size !== 'number') return precondition(P_READABLE);
  if (stat.size > MAX_TARGET_BYTES) return precondition(P_SIZE);

  let before;
  try { before = io_fs.readFileSync(abs, 'utf8'); } catch (err) { return precondition(P_READABLE); }

  let after;
  try { after = transform(before, params); } catch (err) {
    if (err instanceof ContractPreconditionError) return precondition(err.precondition);
    throw err;
  }

  const changes = [{
    action: entry.site.action,
    path: target,
    content: after,
    baseSha256: sha256(before),
  }];

  // The emitted action must equal the DECLARED action. The applier owns the vocabulary; a change
  // built with a different word is a table defect, which is why it is warned rather than returned
  // silently.
  const wrong = changes.find((c) => c.action !== entry.site.action);
  if (wrong) {
    console.warn(`repairContract: ${entry.editId} built a change with action "${wrong.action}"`);
    return refuse(`refused: "${wrong.path}" action "${wrong.action}" is not the declared "${entry.site.action}"`);
  }

  if (changes.length > entry.site.maxChanges) {
    console.warn(`repairContract: ${entry.editId} built ${changes.length} changes against a bound of ${entry.site.maxChanges}`);
    return refuse(`${entry.editId} would exceed its declared bound of ${entry.site.maxChanges} changes`);
  }

  return { changes, why: null, before };
}

// ─── Weighing: the lockfile rule, stated ──────────────────────────────────────

/**
 * `({editId, params, io}) => {verdict, lockfile, weighing, why}`.
 *
 * THE LOCKFILE RULE, measured: `statSync` on an absent file throws with `err.code === 'ENOENT'`, and
 * THAT IS THE NO-LOCKFILE CASE. An earlier rule of "any stat error means master decides" therefore
 * made the absent case decide the wrong way. So: `ENOENT` is `'absent'`, and EVERY OTHER error is
 * master's decision — warned once with the code named, because an unreadable filesystem resolving to
 * "fine" is the shape of defect the stop exists to refuse.
 *
 * Measured here, `package-lock.json` EXISTS, so the real root yields `needs-master-decision`; so does
 * any package in the advisor's `SENSITIVE` export.
 */
function lockfileState(io = {}) {
  const abs = path.join(ioRoot(io), 'package-lock.json');
  try {
    const stat = ioFs(io).statSync(abs);
    const isFile = stat && typeof stat.isFile === 'function' ? stat.isFile() : true;
    return Object.freeze({ state: isFile ? 'present' : 'absent', code: null });
  } catch (err) {
    if (err && err.code === 'ENOENT') return Object.freeze({ state: 'absent', code: 'ENOENT' });
    const code = err && err.code ? err.code : 'an unnamed error';
    console.warn(`repairContract: the package-lock.json probe failed with ${code} — deciding toward master`);
    return Object.freeze({ state: 'unreadable', code });
  }
}

/**
 * Is `name` sensitive? READ from the advisor's export, never copied.
 *
 * The export is a LIVE MUTABLE `Set` (measured: `Object.isFrozen` false, size 9). Pinning the
 * expectation is the verification suite's job; converting the advisor's export shape is not this
 * module's business (I11). If the advisor cannot be loaded, the answer is `null` — unknown — and
 * `weigh()` decides toward master rather than reporting "not sensitive".
 */
function sensitiveByExport(name) {
  let advisor;
  try { advisor = require('./dependencyAdvisor.cjs'); } catch (err) {
    console.warn(`repairContract: the dependency advisor did not load (${err && err.message ? err.message : err}) — deciding toward master`);
    return null;
  }
  const set = advisor && advisor.SENSITIVE;
  if (!set || typeof set.has !== 'function') {
    console.warn('repairContract: the dependency advisor exports no SENSITIVE membership — deciding toward master');
    return null;
  }
  return set.has(name) === true;
}

function weigh({ editId, params = {}, io = {} } = {}) {
  const entry = entryOf(editId);
  if (!entry) {
    return { verdict: 'needs-master-decision', lockfile: 'unknown', weighing: null, why: UNKNOWN_EDIT_WHY };
  }

  const lock = lockfileState(io);
  const sensitive = sensitiveByExport(params && params.name);

  const pros = [`${entry.editId}: ${entry.what}`];
  const cons = [...(entry.cons || [])];
  const unknowns = [];
  // Exactly the reasons master is being asked, so the `why` quotes them rather than restating them.
  const asks = [];

  if (lock.state === 'present') {
    const con = 'package-lock.json is present and this edit does not touch it';
    cons.push(con);
    asks.push(con);
  } else if (lock.state === 'unreadable') {
    const unknown = `the package-lock.json probe failed with ${lock.code}`;
    unknowns.push(unknown);
    asks.push(unknown);
  }
  if (sensitive === true) {
    const unknown = `${params.name} is in the advisor's SENSITIVE set`;
    unknowns.push(unknown);
    asks.push(unknown);
  }
  if (sensitive === null) {
    const unknown = 'the advisor could not be asked whether this package is sensitive';
    unknowns.push(unknown);
    asks.push(unknown);
  }

  const decide = asks.length > 0;
  const why = decide ? `${entry.editId} needs master: ${asks.join('; ')}` : null;

  return {
    verdict: decide ? 'needs-master-decision' : 'ok',
    lockfile: lock.state,
    weighing: Object.freeze({
      pros: Object.freeze(pros), cons: Object.freeze(cons), unknowns: Object.freeze(unknowns),
    }),
    why,
  };
}

// ─── The one entry point ──────────────────────────────────────────────────────

/**
 * `({editId, params, io}) => {editId, changes, why, verdict, weighing}`.
 *
 * SINGLE-VERDICT ON THIS INSTALL. `policy.require` is called FIRST and directly — note the third
 * parameter is an OPTIONS OBJECT (`require.length === 2`), not a positional string; a positional
 * string destructures to `{action: undefined}` and yields a reason without the trailing `" for
 * author"`. Measured, it refuses, so every call here returns `verdict: 'refused'`. The stages past
 * the gate are exported individually so they can be proved without a seam that bypasses it.
 */
function author({ editId, params = {}, io = {} } = {}) {
  const entry = entryOf(editId);
  if (!entry) {
    return { editId: editId === undefined ? null : editId, changes: [], why: UNKNOWN_EDIT_WHY, verdict: 'refused', weighing: null };
  }
  if (!entry.trigger) {
    const why = `${entry.editId} has no producer: ${entry.blockedOn.why}`;
    return { editId: entry.editId, changes: [], why, verdict: 'refused', weighing: null };
  }

  // POLICY FIRST.
  const refusal = policy.require(entry.approvalClass, entry.needLevel, { action: 'author' });
  if (refusal) {
    return { editId: entry.editId, changes: [], why: refusal.reason, verdict: 'refused', weighing: null };
  }

  // PATH FENCE SECOND.
  for (const declared of entry.site.paths) {
    const refused = fencePath(entry, declared, io);
    if (refused) return { editId: entry.editId, changes: [], why: refused, verdict: 'refused', weighing: null };
  }

  // PARAMS THIRD.
  const bad = validateParams(entry, params);
  if (bad) return { editId: entry.editId, changes: [], why: bad.why, verdict: 'refused', weighing: null };

  // THEN READ AND TRANSFORM.
  const built = buildChanges({ entry, params, io });
  if (built.why) return { editId: entry.editId, changes: [], why: built.why, verdict: 'refused', weighing: null };

  const weighed = weigh({ editId: entry.editId, params, io });
  return {
    editId: entry.editId,
    changes: built.changes,
    why: weighed.why,
    verdict: weighed.verdict,
    weighing: weighed.weighing,
  };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * `verification.where === 'unverifiable-here'`, a `null` kind, and the LEGACY string value
 * `'not-run'` all render as the literal word `UNVERIFIED`. None of them may ever render as a pass —
 * `upgradeApplier` already records `verification: 'not-run'` as "a declared value that must never
 * render as passed", and this is that rule, kept.
 */
const UNVERIFIED = 'UNVERIFIED';

function renderVerification(spec) {
  if (spec === null || spec === undefined) return UNVERIFIED;
  if (typeof spec !== 'object') return UNVERIFIED;
  if (spec.where === 'unverifiable-here') return UNVERIFIED;
  if (!spec.kind) return UNVERIFIED;
  return String(spec.kind);
}

function renderTimeout(spec) {
  if (!spec || typeof spec !== 'object' || spec.timeoutMs === null || spec.timeoutMs === undefined) {
    return 'none declared';
  }
  return `${spec.timeoutMs} ms declared (a declaration for a future runner; verify() enforces no deadline)`;
}

/** DERIVED from ENTRIES. There is no second hand-maintained copy for the renderer to drift from. */
function render() {
  return Object.freeze(ENTRIES.map((e) => Object.freeze({
    editId: e.editId,
    producer: idOf(e) || 'none',
    trigger: e.trigger
      ? `${e.trigger.positive.map((p) => p.when).join(' or ')} (reads ${e.trigger.reads.map((r) => r.path).join(', ')})`
      : `blocked: ${e.blockedOn.why}`,
    scope: e.site.paths.length ? `${e.site.paths.join(', ')} [${e.site.pathKind}]` : 'none',
    action: `${e.site.action} \u00b7 max ${e.site.maxChanges}`,
    transform: typeof e.transform === 'function' ? 'transform()' : 'none',
    verification: renderVerification(e.verification),
    timeout: renderTimeout(e.verification),
    approval: `${e.approvalClass} \u00b7 needs ${e.needLevel}`,
    reachable: e.trigger ? 'yes' : 'no',
    provenance: `${e.provenance.spec} \u00b7 ${e.provenance.research}`,
  })));
}

function census() {
  const unreachable = ENTRIES.filter((e) => !e.trigger).map((e) => e.editId);
  return Object.freeze({
    entries: ENTRIES.length,
    reachable: ENTRIES.length - unreachable.length,
    unreachable: unreachable.length,
    unreachableIds: Object.freeze(unreachable),
  });
}

/**
 * `entries: 6 · reachable: 1 · unreachable: 5 (...)`, printed every run.
 *
 * A table of six transforms that one sensor can address is not six capabilities, and the run says so
 * rather than leaving a reader to count.
 */
function censusLine() {
  const c = census();
  return `entries: ${c.entries} \u00b7 reachable: ${c.reachable} \u00b7 unreachable: ${c.unreachable}`
    + ` (${c.unreachableIds.join(', ')})`;
}

module.exports = {
  ENTRIES,
  ENTRY_IDS,
  PRODUCED_BY,
  REACHABLE,
  UNREACHABLE,
  AUTHORING_MODES,
  VERDICTS,
  VERDICT_REACHABILITY,
  ADJACENT_GAPS,
  EIGHT_DOT_THREE,
  SECTION_KEYS,
  MAX_TARGET_BYTES,
  UNVERIFIED,
  VERIFIERS,
  VERIFIER_KINDS,
  ContractPreconditionError,
  idOf,
  entryOf,
  fires,
  locate,
  braceSpan,
  transform,
  verify,
  verifyJsonDependencyCount,
  validateParams,
  fenceProbe,
  fencePath,
  buildChanges,
  lockfileState,
  weigh,
  author,
  renderVerification,
  renderTimeout,
  render,
  census,
  censusLine,
};
