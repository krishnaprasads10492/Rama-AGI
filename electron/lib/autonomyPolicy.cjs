'use strict';

/**
 * autonomyPolicy.cjs — the ladder. What has Rāma earned, as declared data over frozen code.
 *
 * The capability matrix answers *"may this USER do this?"*. Nothing answered *"has RĀMA earned this?"*
 * — Section 124's finding was that the components exist and there is no ladder. This is that ladder,
 * in the shape the Anthropic RSP / OpenAI Preparedness Framework use: rungs declared in advance, each
 * naming the safeguard it requires, a rung entered only when an evaluation says so, and **an
 * undetermined evaluation defaulting to the stricter rung**.
 *
 * THE ONE QUESTION THIS FILE HAS TO ANSWER MECHANICALLY
 *
 * *If the policy table lives in a data file, what stops Rāma proposing an edit to that file which
 * raises a permanent class?*
 *
 * **The data file carries no authority over permanent classes, because the loader never reads them
 * from it.** For a permanent class the file is not merely overridden — it is not consulted. A
 * `"master-record": "L4"` key is not a value that loses a `min()`; it is a key with no reader. Raising
 * one therefore requires editing THIS FILE, which is a source change needing an approval recorded in
 * `proposals.cjs` (I6), visible in a diff. `scripts/verifyAutonomyStop.cjs` goes RED if a permanent
 * class is moved into the editable set.
 *
 * THE FLOOR IS A FALLBACK, NOT A MINIMUM
 *
 * `shared/autonomy-policy.json` SHIPS ABSENT, so the floor is the shipped level. A present file may
 * RESTRICT an editable class below its floor — that is how master puts Rāma offline — and may RAISE one
 * only as far as its ceiling. It can do neither to a permanent class. **That last half-sentence must
 * travel with the first: master cannot lower `master-record` or `loyalty-core` by data either, only by a
 * source edit under an I6 approval.**
 *
 * The data file **cannot turn the automatic revert off**, and an earlier revision of this header said it
 * could. Measured: `{"version":1,"levels":{"revert-own-apply":"L0"}}` validated clean, and the only
 * thing it changed was that `upgradeApplier`'s entry gate then REFUSED A MASTER-APPROVED APPLY — while
 * `revert()` kept running, because a token is its authority and it consults neither the policy nor the
 * stop. A documented, validator-accepted edit that re-created the one defect this slice exists to
 * prevent, and did not do the thing it claimed. So `revert-own-apply` is PERMANENT now: the file is not
 * read for it, a file that so much as names it is rejected whole, and turning the automatic revert off
 * is not something this design offers at all.
 *
 * AND THE STOP DOMINATES
 *
 * `effective()`'s first line is the stop, so on a shipped install every class is `L0` before the
 * resolver ever looks at the data file. The floors describe what the policy resolves to ONCE MASTER HAS
 * ALLOWED AUTONOMY AT ALL — not what a fresh install does.
 *
 * `effective(c, {ignoreStop: true})` has EXACTLY ONE consumer, `requireMasterDriven`, which throws for
 * any class outside the frozen two-member `MASTER_ACT` subset. Without that containment a shipped
 * install — permanently stopped by design, no allow-file — would REFUSE A MASTER-APPROVED APPLY,
 * because the applier's entry gate resolves `revert-own-apply` against the `L0` the stop forces. An
 * option any caller may pass is an option every future caller will pass, so there is one door and it
 * refuses to open for anything but the two classes that describe MASTER's act.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// The levels
/**
 * L5 is declared and UNREACHABLE. A ladder that stopped at L4 would make autonomous application a new
 * concept to be invented later, which is exactly how a stop gets retrofitted onto a running loop.
 * Declaring it and refusing it means the thing that would have to change is one value in one frozen
 * constant, visible in a diff, with a suite row that currently asserts it is impossible.
 */
const LEVELS = Object.freeze({
  L0: 'forbidden',
  L1: 'observe',
  L2: 'research',
  L3: 'propose-only',
  L4: 'apply-after-approval',
  L5: 'apply-autonomous',
});
const ORDER = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

/** No class may hold L5 and the loader rejects it anywhere in the data file. */
const UNREACHABLE_LEVEL = 'L5';

function rank(level) { return ORDER.indexOf(level); }
function min(a, b)   { return rank(a) <= rank(b) ? a : b; }

/**
 * A membership view over a set of ids, with NO mutator and the backing `Set` unreachable.
 *
 * `Object.freeze(new Set([...]))` freezes PROPERTIES, not internal slots, so a frozen `Set` is still
 * mutable: measured against the live module, `policy.PERMANENT.delete('revert-own-apply')` succeeded and
 * dropped the size from 7 to 6, after which `validate({version:1,levels:{'revert-own-apply':'L0'}})`
 * returned `ok: true` — a class the data file is never read for became readable from it. Nothing was
 * exploitable (`requireMasterDriven` fails closed for the pair, and every permanent class has
 * `FLOORS[c] === CEILINGS[c]`), but `Object.isFrozen` was an assertion that overstated its guarantee.
 *
 * So the exported view carries `has`, `size` and an iterator and nothing else. `delete` and `add` are
 * `undefined` rather than refused, which throws at the call site instead of silently succeeding, and a
 * caller that copies the view (`new Set([...PERMANENT])`) mutates its own copy and nothing else.
 */
function frozenSetView(ids) {
  const inner = new Set(ids);
  return Object.freeze({
    has: (id) => inner.has(id),
    get size() { return inner.size; },
    values: () => inner.values(),
    [Symbol.iterator]: () => inner.values(),
  });
}

// The fifteen classes
const CLASSES = Object.freeze([
  'observe', 'research-local', 'research-network', 'propose-question',
  'propose-source', 'dependency-change', 'build-repair', 'author-change',
  'revert-own-apply', 'apply-source', 'release-classify', 'capability-grant',
  'loyalty-core', 'master-record', 'autonomy-policy',
]);

/** Frozen in code: the level a class holds whenever the data file is absent, rejected, or silent. */
const FLOORS = Object.freeze({
  'observe':           'L1',
  'research-local':    'L1',
  'research-network':  'L2',   // its honest current level: ollama-catalog and dependency-review do this daily
  'propose-question':  'L3',   // dependencyAdvisor already files these daily
  'propose-source':    'L1',
  'dependency-change': 'L1',
  'build-repair':      'L1',
  'author-change':     'L1',
  'revert-own-apply':  'L4',   // a safety net's "configuration absent" level must be "works"
  'apply-source':      'L4',
  'release-classify':  'L0',
  'capability-grant':  'L0',
  'loyalty-core':      'L0',
  'master-record':     'L3',
  'autonomy-policy':   'L0',
});

/** Frozen in code: the highest level the data file can ever reach for that class. */
const CEILINGS = Object.freeze({
  'observe':           'L1',
  'research-local':    'L1',
  'research-network':  'L2',
  'propose-question':  'L3',
  'propose-source':    'L3',   // I6 pins it at L3
  'dependency-change': 'L3',   // I12's posture: dependencyAdvisor never upgrades
  'build-repair':      'L3',   // a repair is still a source change
  'author-change':     'L3',   // authoring is not applying
  'revert-own-apply':  'L4',
  'apply-source':      'L4',   // permanent-at-L4 means it can never become L5
  'release-classify':  'L0',
  'capability-grant':  'L0',
  'loyalty-core':      'L0',
  'master-record':     'L3',
  'autonomy-policy':   'L0',
});

/**
 * The classes the data file is NOT READ FOR AT ALL.
 *
 * `master-record` is here because of spec Section 127: **Rāma may never widen its own retention window
 * or capture scope for what is recorded about master.** Four more are I6, I17, I8 and I15/I16, and one
 * is the policy's own authority.
 *
 * **Both `MASTER_ACT` members are here, and that is a structural requirement rather than a coincidence.**
 * `requireMasterDriven` ignores the stop for exactly those two classes, so whatever the data file could
 * say about them would be the only thing left standing between master's approved apply and a refusal.
 * A class that describes MASTER'S act must not be governable by a file, which is why
 * `requireMasterDriven` THROWS for a `MASTER_ACT` class that is not permanent: removing one from this
 * set fails loudly at the first apply instead of quietly handing the decision to a data edit.
 */
const PERMANENT = frozenSetView([
  'apply-source',       // I6 + MASTER_ACT
  'revert-own-apply',   // MASTER_ACT — a data edit must not be able to refuse master's own apply
  'release-classify',   // I17 — master alone
  'capability-grant',   // I8 + protected file + the tripwire
  'loyalty-core',       // I15 / I16
  'master-record',      // spec Section 127
  'autonomy-policy',    // Rāma may not propose its own promotion
]);

/** DERIVED, never restated — a second list is how two lists come to disagree. */
const EDITABLE = Object.freeze(CLASSES.filter(c => !PERMANENT.has(c)));

/**
 * The classes whose action RĀMA INITIATES. The "no floor above L3" bound is asserted over THIS set and
 * not over CLASSES, because `apply-source` and `revert-own-apply` have L4 floors by design and describe
 * master applying, or undoing, something he already approved.
 */
const RAMA_INITIATED = Object.freeze([
  'observe', 'research-local', 'research-network', 'propose-question',
  'propose-source', 'dependency-change', 'build-repair', 'author-change', 'master-record',
]);

/**
 * MASTER'S ACTS, not Rāma's autonomy. The ONLY classes that may ignore the stop, and the only ones
 * `requireMasterDriven()` accepts. A third member turns the suite RED.
 */
const MASTER_ACT = frozenSetView(['apply-source', 'revert-own-apply']);

/**
 * The paths no proposal of this design's kinds may name, in a change or in its metadata. Declared HERE,
 * in the policy module, and not in the consumer — the thing being protected is the policy's authority,
 * and a list that lived with the consumer could be narrowed by a change to the consumer alone.
 */
const SELF_GOVERNING_PATHS = Object.freeze([
  Object.freeze({ path: 'shared/autonomy-policy.json',     optional: true  }),   // ships absent by design
  Object.freeze({ path: 'electron/lib/autonomyPolicy.cjs', optional: false }),
  Object.freeze({ path: 'electron/lib/autonomyStop.cjs',   optional: false }),
  Object.freeze({ path: 'shared/loyalty-tripwire.json',    optional: false }),
]);

const DATA_FILE = path.join(__dirname, '..', '..', 'shared', 'autonomy-policy.json');

// Loading the data file

let loaded = null;   // { levels, rejected, why, source, fileSha256 }

/**
 * Validate the WHOLE file, and reject it WHOLE.
 *
 * A partial accept teaches whoever wrote the file which edits are silently dropped and lets the rest
 * through — so a file mixing one forbidden raise with four legitimate lowerings would land four of five
 * and look like it landed nothing. Whole-file rejection is loud, fails safe, and makes validity a
 * single binary the UI can show. Same reasoning `claimGate` uses when it marks the WHOLE answer
 * unattributed if any finding was withheld.
 */
function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, why: 'the policy file must be a JSON object' };
  }
  const keys = Object.keys(raw);
  const extra = keys.filter(k => k !== 'version' && k !== 'levels');
  if (extra.length) return { ok: false, why: `unknown top-level key(s): ${extra.join(', ')}` };
  if (raw.version !== 1) return { ok: false, why: `version must be 1 (found ${JSON.stringify(raw.version)})` };
  if (!raw.levels || typeof raw.levels !== 'object' || Array.isArray(raw.levels)) {
    return { ok: false, why: 'levels must be an object of classId -> level' };
  }
  const levels = {};
  for (const [id, level] of Object.entries(raw.levels)) {
    if (!CLASSES.includes(id)) return { ok: false, why: `unknown class id "${id}"` };
    if (PERMANENT.has(id)) return { ok: false, why: `"${id}" is a permanent class and may not appear in the policy file` };
    if (typeof level !== 'string') return { ok: false, why: `the level for "${id}" must be a string` };
    if (level === UNREACHABLE_LEVEL) return { ok: false, why: `${UNREACHABLE_LEVEL} is unreachable and may not appear anywhere` };
    if (!Object.prototype.hasOwnProperty.call(LEVELS, level)) return { ok: false, why: `"${level}" is not a level` };
    if (rank(level) > rank(CEILINGS[id])) {
      return { ok: false, why: `"${id}" may not exceed its ceiling ${CEILINGS[id]} (found ${level})` };
    }
    levels[id] = level;
  }
  return { ok: true, levels };
}

/**
 * Read and validate ONE file into a state object. Absent is the shipped path and is not an error.
 *
 * `file` is a parameter so a suite can resolve against a fixture WITHOUT a module-level setter that
 * would let any caller redirect the live policy at a file it controls. The gated runtime path calls
 * `load()`, which only ever reads `DATA_FILE`.
 */
function loadFrom(file) {
  let bytes = null;
  try { bytes = fs.readFileSync(file); }
  catch { return { levels: {}, rejected: false, why: null, source: 'absent', fileSha256: null }; }

  const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch (err) { return { levels: {}, rejected: true, why: `unparsable JSON: ${err.message}`, source: 'rejected', fileSha256 }; }

  const v = validate(parsed);
  if (!v.ok) return { levels: {}, rejected: true, why: v.why, source: 'rejected', fileSha256 };
  return { levels: v.levels, rejected: false, why: null, source: 'file', fileSha256 };
}

/** The live load. Reads `DATA_FILE` and nothing else. */
function load() {
  loaded = loadFrom(DATA_FILE);
  return loaded;
}

function current() { return loaded || load(); }

/**
 * Re-read the file. Master edits it by hand, and no build is required.
 *
 * **It is called at each of the three doors that make or report a decision** — `require`,
 * `requireMasterDriven` and `policyStatus` — so a hand edit takes effect at the next gating decision and
 * at the next status read, with no restart. An earlier revision claimed "no restart is required" while
 * having no production caller at all, so `current()` cached the first load for the whole process
 * lifetime and a hand edit did nothing until the app was restarted. `effective()` deliberately stays on
 * the cache: it is the plain reader, and the doors re-read before they consult it, so the two never
 * disagree at the moment a decision is made.
 *
 * The residual, stated rather than engineered around: a read that lands mid-write sees a torn file,
 * which is REJECTED WHOLE and so falls back to the floors. For a raise that is the stricter direction;
 * for one of master's restrictions it is briefly the more permissive one. Every floor is at or below L3
 * (propose-only) and no permanent class is readable from the file at all, so the worst case is a
 * proposal Rāma should not have filed — which still cannot be applied without master's recorded
 * approval (I6).
 */
function reload() { loaded = null; return load(); }

function stop() {
  try { return require('./autonomyStop.cjs'); }
  catch { return { isStopped: () => true };   /* no stop module means stopped — fail-safe */ }
}

// The resolver

/**
 * A PURE RESOLVER. It carries no exception for an in-flight revert: a pure resolver cannot know a
 * revert is in flight, so with the stop engaged `revert-own-apply` would resolve to L0 and the revert
 * would be refused — producing exactly the stranded half-applied tree the exception exists to prevent.
 * The carve-out is a token issued at apply entry instead (`upgradeApplier`).
 *
 * `ignoreStop` skips the FIRST LINE ONLY, and its one consumer only ever asks about a PERMANENT class,
 * for which the data file is not consulted either. So the two classes that describe master's own act
 * resolve to their frozen floors and nothing else — no stop, no file. Master's restriction authority
 * over the nine EDITABLE classes is untouched by that, because it was never expressed through these two.
 */
/**
 * Everything AFTER the stop's line: the data file intersected against the frozen floors and ceilings.
 * Separated so `policyStatus()` can report "what would hold if autonomy were allowed" WITHOUT passing
 * `ignoreStop` — the suite asserts that option has exactly one consumer, and a reporting read that
 * borrowed it would be the first step toward every caller passing it.
 */
function resolveWithoutStop(state, classId) {
  if (!CLASSES.includes(classId)) return 'L0';
  if (state?.source !== 'file') return FLOORS[classId];
  if (PERMANENT.has(classId)) return FLOORS[classId];
  const declared = Object.prototype.hasOwnProperty.call(state.levels, classId) ? state.levels[classId] : FLOORS[classId];
  return min(CEILINGS[classId], declared);
}

function effectiveFrom(state, classId, opts = {}) {
  if (!CLASSES.includes(classId)) return 'L0';
  if (!opts.ignoreStop && stop().isStopped()) return 'L0';
  return resolveWithoutStop(state, classId);
}

function effective(classId, opts = {}) {
  return effectiveFrom(current(), classId, opts);
}

function gate(have, classId, need, action) {
  if (rank(have) >= rank(need)) return null;
  return {
    ok: false,
    blocked: true,
    classId,
    have,
    need,
    reason: `autonomy policy: "${classId}" is ${have} (${LEVELS[have]}); ${need} (${LEVELS[need]}) required`
          + `${action ? ` for ${action}` : ''}`,
  };
}

/**
 * Shaped exactly like `capability.deny()` — `null` when allowed, the refusal object when not — because
 * that is already the house idiom.
 *
 * `need` is a REQUIRED positional argument with no default, and it THROWS when absent. A gate whose
 * level defaults is a gate whose refusal is "not allowed", which is this project's "it failed" in a
 * different costume: the refusal has to name the class AND the level needed so master gets a sentence
 * he can act on.
 */
function require_(classId, need, { action = null } = {}) {
  if (!need) throw new Error(`policy.require("${classId}") needs an explicit level — a gate whose level defaults cannot name what it needed`);
  if (!Object.prototype.hasOwnProperty.call(LEVELS, need)) throw new Error(`"${need}" is not a level`);
  reload();
  return gate(effective(classId), classId, need, action);
}

/**
 * MASTER_ACT classes ONLY — it throws for anything else. This is the fence: a Rāma-initiated class
 * cannot borrow the carve-out, because the only function that ignores the stop refuses to be called
 * with one.
 */
/**
 * The fence itself, as a PURE function over the two sets, returning the `Error` to throw or `null`.
 *
 * Extracted so it can be EXERCISED rather than read. Its second clause — a `MASTER_ACT` class that is
 * not `PERMANENT` — is unreachable through the real sets by construction, and the suite row that used
 * to cover it matched two regexes over `requireMasterDriven`'s own source text, which passes for any
 * function that merely mentions the identifier. Now the suite passes a divergent pair and asserts the
 * real throw, over the real code, with the real message.
 *
 * The overrides are a SUITE seam and nothing else: `requireMasterDriven` calls this with no second
 * argument, and the suite asserts that. They also grant no reach — `masterAct` still bounds which
 * classes may reach the door at all, so an injected `permanent` can only re-permit a class that is
 * already in the frozen two-member subset.
 */
function masterDrivenFence(classId, { masterAct = MASTER_ACT, permanent = PERMANENT } = {}) {
  if (!masterAct.has(classId)) {
    return new Error(`requireMasterDriven is only for MASTER_ACT classes — "${classId}" is not one`);
  }
  // The second half of the fence, and it fails LOUDLY on purpose. This is the one door that ignores the
  // stop, so if its class were also readable from the data file then a validator-accepted edit would be
  // the last thing standing between master's approved apply and a refusal. Rather than trust a comment
  // saying the two sets agree, the door refuses to open for a MASTER_ACT class that is not permanent.
  if (!permanent.has(classId)) {
    return new Error(`"${classId}" is a MASTER_ACT class but not a PERMANENT one, so the data file could `
      + 'refuse master\'s own act — refusing to resolve it at all until it is one or the other');
  }
  return null;
}

function requireMasterDriven(classId, need) {
  const fenced = masterDrivenFence(classId);
  if (fenced) throw fenced;
  if (!need) throw new Error(`policy.requireMasterDriven("${classId}") needs an explicit level`);
  reload();
  return gate(effective(classId, { ignoreStop: true }), classId, need, 'a master-driven act');
}

// Reporting

/** Every field carries its own truth; nothing is inferred by the renderer. */
function policyStatus() {
  const state = reload();
  const levels = {};
  for (const c of CLASSES) levels[c] = effective(c);
  const floorsNow = {};
  for (const c of CLASSES) floorsNow[c] = resolveWithoutStop(state, c);
  return {
    levels,                         // what holds right now, stop included
    withoutStop: floorsNow,         // what would hold if autonomy were allowed
    floors: FLOORS,
    ceilings: CEILINGS,
    permanent: [...PERMANENT],
    editable: EDITABLE,
    ramaInitiated: RAMA_INITIATED,
    masterAct: [...MASTER_ACT],
    selfGoverningPaths: SELF_GOVERNING_PATHS,
    dataFile: DATA_FILE,
    source: state.source,
    rejected: state.rejected,
    why: state.why,
    fileSha256: state.fileSha256,
    stopped: stop().isStopped(),
    counts: {
      classes: CLASSES.length,
      permanent: PERMANENT.size,
      editable: EDITABLE.length,
      pinned: CLASSES.filter(c => FLOORS[c] === CEILINGS[c]).length,
      raisable: CLASSES.filter(c => rank(FLOORS[c]) < rank(CEILINGS[c])).length,
    },
  };
}

module.exports = {
  LEVELS, ORDER, UNREACHABLE_LEVEL,
  CLASSES, FLOORS, CEILINGS, PERMANENT, EDITABLE, RAMA_INITIATED, MASTER_ACT, SELF_GOVERNING_PATHS,
  DATA_FILE,
  rank, frozenSetView, validate, load, loadFrom, reload, effective, effectiveFrom, policyStatus,
  require: require_, masterDrivenFence, requireMasterDriven,
};
