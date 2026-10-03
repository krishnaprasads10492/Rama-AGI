'use strict';

/**
 * autonomyGate.cjs — the policy and the stop, consulted where a proposal is CREATED.
 *
 * ── THE HOLE THIS CLOSES ──────────────────────────────────────────────────────────────────────────
 *
 * `proposals:create` is renderer-reachable at tier 1 (`self-modify.view`) and consults neither the
 * autonomy policy nor the stop. `meta` is passed straight through, and `restore()` later rehydrates it
 * on an id check alone. So every refusal a proposer might perform is bypassable by building the entry
 * by hand, and the applier is left as the only component that can refuse.
 *
 * `proposals.cjs` is a PROTECTED FILE and must not change. The two seams that exist are therefore used:
 *
 *   1. `guardLedgerIpc(ipc)` — wraps the ledger's own IPC registration, so the `proposals:create`
 *      handler is validated before it is reached. Every other channel is forwarded verbatim.
 *   2. `fileProposal(ledger, def)` — the ONLY path by which Rāma may create a proposal of a kind this
 *      design owns. It consults the stop, then the policy, before calling `ledger.create`.
 *
 * ── AUTONOMY IS DERIVED FROM THE CALLER, NEVER READ FROM A FIELD ──────────────────────────────────
 *
 * The earlier design decided whether the stop applied by reading `opts.autonomous` — which arrives from
 * the renderer (`preload.cjs` 680) and reaches the applier untouched (`proposals.cjs` 235,
 * `applier(p, opts)`). A predicate supplied by the party the stop exists to stop is bypassable by
 * OMITTING A FIELD. So `origin` here is a literal written at the call site inside the main process:
 * `guardLedgerIpc` passes `'ipc'` because it IS the IPC handler, and `fileProposal` passes `'rama'`
 * because it IS Rāma's path. `inspectCreate` throws on anything else rather than guessing.
 *
 * ── WHAT AN IPC CREATE IS, AND WHY THE STOP DOES NOT GOVERN IT ────────────────────────────────────
 *
 * A create arriving over IPC with an authenticated user is master at the keyboard. The stop halts RĀMA
 * STARTING WORK; it does not refuse master. Gating the IPC path on the policy would also break
 * `src/services/selfModify.js`'s `proposeModification`, which ships and works today — a fail-safe
 * default that silently deleted a working behaviour is the regression I11 forbids. What the IPC path
 * gains instead is the KIND FENCE and the PATH FENCE:
 *
 *   - the kinds this design owns may not be filed from outside, because a hand-built one with crafted
 *     `meta` is precisely the forgery the applier's entry validation exists to catch; and
 *   - no create from the renderer may name a self-governing path or the stop's own state files, for
 *     ANY kind. That is additive — nothing shipped names them — and it closes the renderer half of the
 *     "the stop's state is unreachable by any proposal" claim, which was measurably false.
 *
 * ── THE PATH FENCE ASKS THE FILESYSTEM, NOT THE CHARACTERS ────────────────────────────────────────
 *
 * Four review rounds found four spellings that addressed a governed file without naming it, the last of
 * them an 8.3 short basename that shares a six-character prefix with the long name and nothing else. A
 * fifth character transform would have been the fourth guess, so `canonicalPath` below puts the question
 * to `fs.realpathSync.native` instead and the comparison runs against BOTH the character form and the
 * filesystem's answer. See its header for what was measured. The refusal reports the spelling the caller
 * wrote, because that is the string master is looking at.
 *
 * ── THE RESIDUAL, PRINTED RATHER THAN IMPLIED ─────────────────────────────────────────────────────
 *
 * In-process `proposals.create()` is NOT gated: it is reached directly by five existing callers and
 * `proposals.cjs` cannot be modified. And `electron/ipc/timeline.cjs`'s pre-existing SELF_MODIFY
 * applier writes `changes[].path` verbatim with no root confinement, so an absolute path is still
 * written wherever the process can write. Closing that is master's decision, because confining it would
 * change the behaviour of a shipped applier. `scripts/verifyUpgradeApplier.cjs` prints both residuals.
 */

const fs     = require('fs');
const path   = require('path');

const policy = require('./autonomyPolicy.cjs');
const stop   = require('./autonomyStop.cjs');

/** Where a repo-relative `changes[].path` is rooted when no `io` is injected: the install itself. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** How far the ancestor walk below will climb before it gives up. A path deeper than this is not real. */
const CANON_MAX_DEPTH = 64;

/** The kinds this design owns. Nothing outside the main process may file one. */
const KIND = Object.freeze({
  DIFF:     'self-upgrade',
  QUESTION: 'self-upgrade-question',
});

const OWNED_KINDS = Object.freeze([KIND.DIFF, KIND.QUESTION]);

/** The schema marker the applier refuses an entry without. */
const SCHEMA = 'self-upgrade/1';

/** The finding classes a diff-bearing entry may declare, each its own policy class. */
const DIFF_CLASSES = Object.freeze(['propose-source', 'dependency-change', 'build-repair']);

const ORIGINS = Object.freeze(['ipc', 'rama']);

// ─── Path fencing ─────────────────────────────────────────────────────────────

/**
 * Canonicalise for comparison: forward slashes, **structure RESOLVED**, lower case.
 *
 * The resolution is the whole point, and leaving it out was a measured hole rather than a theoretical
 * one. A comparison that only swapped separators and stripped a leading `./` read
 * `electron/lib/./autonomyStop.cjs`, `electron//lib/autonomyStop.cjs` and
 * `electron/lib/../lib/autonomyStop.cjs` as naming nothing governed — so a `self-upgrade` entry with a
 * correct `baseSha256` passed this gate at BOTH origins and passed the applier's step 3, and
 * `autonomyStop.cjs` is not in `loyaltyGuard.PROTECTED_FILES`, so nothing downstream objected either.
 * I6 still held — the apply needed a recorded master approval — but the diff should not have been
 * fileable at all.
 *
 * `path.posix.normalize` collapses `.`, `..` and repeated separators, so every spelling of a path
 * reduces to the one string the comparison below is written against. An empty input is returned empty
 * rather than as `normalize`'s `'.'`, which would make a blank path name the repository root.
 *
 * It is applied to the stringified `meta` blob too, which is not a path. That is safe and deliberate:
 * `normalize` only ever collapses `/`-delimited segments, so a path-like run hidden inside a JSON string
 * is canonicalised in place and the surrounding text is left as it is.
 *
 * ── AND THE TWO SPELLINGS `normalize` DOES NOT COLLAPSE ───────────────────────────────────────────
 *
 * It leaves a TRAILING DOT and a TRAILING SPACE on a segment alone, so `autonomyStop.cjs.` and
 * `autonomyStop.cjs ` both read as naming nothing governed. Measured end to end: `inspectCreate`
 * returned no refusal at either origin and `applyWith` with action `create` APPLIED, leaving
 * `autonomyStop.cjs.` and `autonomyStop.cjs ` in `electron/lib/` beside the real file — whose bytes
 * survived, because these are genuinely distinct files here (`lstat` of the trailing-dot name is
 * ENOENT and a write creates a second directory entry, verified on this machine). So it was never a
 * write to the governed file; it was the fence answering "names nothing governed" for a
 * governed-ADJACENT name, on the one platform whose shell and many of whose APIs do collapse the two.
 *
 * `trimSegments` therefore runs BEFORE `normalize`, and it SKIPS `.` and `..` — trimming those would
 * turn `electron/lib/../lib/x` into `electron/lib//lib/x`, which resolves to a different file and would
 * have broken the `..` spelling the fence already catches. A segment that is nothing BUT dots or spaces
 * is left as it was for the same reason: an empty segment is not a canonicalisation of anything.
 */
function trimSegments(p) {
  return p.split('/').map((seg) => {
    if (seg === '' || seg === '.' || seg === '..') return seg;
    const trimmed = seg.replace(/[. ]+$/, '');
    return trimmed === '' ? seg : trimmed;
  }).join('/');
}

function normalise(p) {
  const slashed = String(p ?? '').replace(/\\/g, '/');
  if (!slashed) return '';
  return path.posix.normalize(trimSegments(slashed)).replace(/^\.\//, '').toLowerCase();
}

/**
 * The THIRD spelling class this fence failed to canonicalise, and the first whose governed bytes did
 * not survive: an **NTFS alternate-data-stream suffix**. On this platform `file::$DATA` is a SYNONYM for
 * the primary data stream — not a neighbouring file, as the trailing dot and trailing space are.
 *
 * Measured end to end before this existed: `namesGovernedPath('electron/lib/autonomyStop.cjs::$DATA')`
 * returned null, `path.resolve` kept the suffix so the confinement check passed, `lstat` reported a
 * regular file, `readFileSync` through the spelling returned the REAL FILE'S 25255 bytes so the
 * `baseSha256` base-drift check PASSED instead of catching it, and a master-approved `patch` APPLIED —
 * leaving `autonomyStop.cjs` reading `function isStopped(){return false;}`. The same spelling replaced
 * `shared/loyalty-tripwire.json`, the baseline the tamper-evidence compares against.
 *
 * Two spellings are stripped here, and the reason differs for each:
 *
 *   - `:<anything>` after the first character of a segment — the stream suffix. Truncating the segment
 *     at the colon yields the primary stream's real name, which is the name that must be compared.
 *   - a TRAILING CONTROL CHARACTER, `\t` being the reachable one. Unlike the stream suffix this does
 *     NOT address the governed file here (a write through it is ENOENT on this platform, so nothing was
 *     ever clobbered), but it is the same gap — the fence answering "names nothing governed" for a name
 *     that is a trivial respelling of one — and a control character is never in a legitimate source path.
 *
 * A leading drive designator is preserved: `C:/…` is a drive, not a stream, and discarding it would make
 * an absolute path to the stop's own allow-file stop looking absolute. A segment that is NOTHING BUT a
 * stream suffix (`:evil` alone) is left exactly as it was, for the same reason `trimSegments` leaves a
 * dots-only segment alone: an empty segment is not a canonicalisation of anything.
 *
 * ── WHY THIS IS SEPARATE FROM `normalise` AND NOT FOLDED INTO IT ───────────────────────────────────
 *
 * `normalise` is applied to the stringified `meta` blob, which is JSON — and JSON is full of colons.
 * Measured: folding a colon strip into `trimSegments` turns `{"plan":"then patch electron/lib/x.cjs"}`
 * into `{"plan"/lib/x.cjs"}`, because the colon it truncates at is the one after `"plan"`. That DELETES
 * the `electron/` segment and the `meta` substring scan then misses a governed path it catches today.
 * So the colon strip lives here, on the route that handles actual paths, and the `meta` route keeps
 * `normalise` — where a suffix spelling is caught anyway, because `electron/lib/x.cjs::$data` CONTAINS
 * `electron/lib/x.cjs` and that scan is a substring test.
 */
function stripSpellings(p) {
  const slashed = String(p ?? '').replace(/\\/g, '/');
  const drive = /^[A-Za-z]:\//.exec(slashed);
  const head = drive ? slashed.slice(0, 2) : '';
  const rest = drive ? slashed.slice(2) : slashed;
  const cleaned = rest.split('/').map((seg) => {
    if (seg === '' || seg === '.' || seg === '..') return seg;
    const trimmed = seg.replace(/[\u0000-\u001f]+$/, '');
    const cut = trimmed.indexOf(':');
    const out = cut > 0 ? trimmed.slice(0, cut) : trimmed;
    return out === '' ? seg : out;
  }).join('/');
  return head + cleaned;
}

/** `normalise`, plus the spellings that address a file without naming it. For PATHS, never for text. */
function normalisePath(p) {
  const stripped = stripSpellings(p);
  if (!stripped) return '';
  return normalise(stripped);
}

/**
 * ── ASK THE FILESYSTEM WHICH FILE A PATH NAMES, INSTEAD OF ASKING THE CHARACTERS ──────────────────
 *
 * This fence missed a spelling class in each of four review rounds: unresolved structure, a trailing dot
 * and a trailing space, an NTFS `::$DATA` stream suffix, and then an **8.3 SHORT BASENAME**. The first
 * three were each arguably one more character case. The fourth is not, and it is what retired the
 * method: measured on this volume, `dir /x` in `electron/lib` reports `AUTONO~1.CJS autonomyStop.cjs`,
 * `AUTONO~2.CJS autonomyPolicy.cjs` and in `shared/` `LOYALT~1.JSO loyalty-tripwire.json` — and
 * `AUTONO~1.CJS` shares a six-character PREFIX with the governed name and nothing else. No transform
 * over the characters can recover `autonomystop.cjs` from it, so no fifth transform was written.
 *
 * Measured before this existed: `namesGovernedPath('electron/lib/AUTONO~1.CJS')` returned null at BOTH
 * origins, `readFileSync` through the spelling returned the real file's bytes so the applier's
 * `baseSha256` base-drift check PASSED rather than catching it, and a master-approved `patch` APPLIED —
 * `electron/lib/autonomyStop.cjs` afterwards read `function isStopped(){return false;}`. The same held
 * for the PROTECTED `loyaltyGuard.cjs` via `LOYALT~1.CJS` and for the tamper-evidence baseline
 * `shared/loyalty-tripwire.json` via `LOYALT~1.JSO`.
 *
 * So the question is put to the filesystem. Measured on this platform, which is why `.native` and not
 * the plain call: `fs.realpathSync('…/AUTONO~1.CJS')` returns the SHORT PATH UNCHANGED and is useless
 * here, while `fs.realpathSync.native('…/AUTONO~1.CJS')` returns `…/electron/lib/autonomyStop.cjs` AND
 * `fs.realpathSync.native('…/autonomyStop.cjs::$DATA')` returns that same canonical long path. One call
 * therefore closes the short basename and the stream suffix together, and closes any further
 * FILESYSTEM SYNONYM — a junction, a hard link's other name, a case variant — without being told about
 * it first. That is the falsifiable difference between this round and the three before it.
 *
 * Three things this is careful about:
 *
 *   - **The root is canonicalised too.** `os.tmpdir()` here is `C:\Users\KRISHN~1.SEE\AppData\Local\Temp`
 *     — itself a short path. Comparing a canonical target against a short root would make every fixture
 *     path read as "outside the root", so both sides are asked the same question.
 *   - **A path that does not exist yet still canonicalises.** `native` throws ENOENT for a `create`, so
 *     the NEAREST EXISTING ANCESTOR is canonicalised and the remainder appended — the same walk
 *     `upgradeApplier.writabilityOf` already does. There is nothing to recover in a leaf that does not
 *     exist, and an ancestor spelled short is recovered.
 *   - **It never throws and never refuses.** An empty string, a missing `realpathSync.native`, an
 *     injected partial `fs`, or a path whose every ancestor is unreadable all yield `''`, and the caller
 *     falls back to the character comparison — which is still the cheap refusal for a name that is not
 *     yet a synonym of anything. This is ADDITIVE: `stripSpellings` and `normalisePath` are unchanged,
 *     and the colon strip stays out of `normalise` for the measured meta-blob reason above.
 *
 * @returns {string} the canonical path, repo-relative when inside the root, `normalise`d — or `''`
 */
function canonicalPath(p, io = {}) {
  const raw = String(p ?? '');
  if (!raw) return '';
  const fsmod = io.fs || fs;
  const native = fsmod?.realpathSync?.native;
  if (typeof native !== 'function') return '';
  const repoRoot = path.resolve(io.repoRoot || REPO_ROOT);

  let resolved;
  try { resolved = path.resolve(repoRoot, raw); } catch { return ''; }

  let root = repoRoot;
  try { root = native(repoRoot); } catch { root = repoRoot; }

  let dir = resolved;
  const tail = [];
  for (let depth = 0; depth < CANON_MAX_DEPTH; depth += 1) {
    let real = null;
    try { real = native(dir); } catch { real = null; }
    if (real !== null) {
      const full = tail.length ? path.join(real, ...tail) : real;
      let out = full;
      if (full === root) out = '';
      else if (full.toLowerCase().startsWith((root + path.sep).toLowerCase())) out = path.relative(root, full);
      return normalise(out.split(path.sep).join('/'));
    }
    const up = path.dirname(dir);
    if (up === dir) return '';
    tail.unshift(path.basename(dir));
    dir = up;
  }
  return '';
}

/**
 * The basenames of the stop's own state, which live OUTSIDE the repository root. `changes[].path` cannot
 * address them relatively — it can address them absolutely, which is the whole point of fencing on the
 * basename rather than on the root.
 */
const STOP_STATE_NAMES = Object.freeze([
  normalise(stop.ALLOW_FILE),
  normalise(stop.STOPPED_RECORD),
  normalise(stop.SNAPSHOT_DIR),
]);

/** Repo-relative paths whose authority is the policy's own. */
function selfGoverningRelPaths() {
  return policy.SELF_GOVERNING_PATHS.map(e => normalise(e.path));
}

/**
 * Does this text name something that governs the policy or the stop?
 *
 * TWO spellings are compared, not one: the character canonicalisation, and the FILESYSTEM'S OWN answer
 * to "which file is this". Either one naming a governed token is a refusal. The character route is kept
 * because it answers for a name that addresses nothing yet — a `create` of a path with no existing
 * ancestor, a trailing dot that makes a NEW directory entry here — and the filesystem route is what
 * catches a synonym of an existing file, which is the class that no transform over the characters can
 * recover. Neither subsumes the other, so both are asked.
 *
 * @param {string} text   a PATH. The `meta` blob goes through `normalise` instead; it is text.
 * @param {object} [io]   `{fs, repoRoot}` — injected by the applier so the comparison is made against
 *                        the root the write would land in, rather than against this install's.
 * @returns {string|null} the token it named, or null
 */
function namesGovernedPath(text, io) {
  const spellings = [normalisePath(text), canonicalPath(text, io)];
  const governed = selfGoverningRelPaths();
  for (const p of spellings) {
    if (!p) continue;
    for (const rel of governed) {
      if (p === rel || p.endsWith(`/${rel}`)) return rel;
    }
    for (const name of STOP_STATE_NAMES) {
      if (p === name || p.endsWith(`/${name}`) || p.includes(`/${name}/`)) return name;
    }
  }
  return null;
}

/**
 * Every governed path named by a proposal definition — in `changes[].path` AND anywhere in `meta`.
 * `meta` is scanned because it is persisted, rehydrated on an id check alone, and was the door through
 * which a snapshot directory once became a write destination.
 */
function governedPathsNamed(def, io) {
  const hits = [];
  for (const change of def?.changes ?? []) {
    const hit = namesGovernedPath(change?.path, io);
    if (hit) hits.push({ where: 'changes[].path', value: change?.path, token: hit });
  }
  let metaText = '';
  try { metaText = JSON.stringify(def?.meta ?? {}); } catch { metaText = ''; }
  const lowered = normalise(metaText);
  for (const token of [...selfGoverningRelPaths(), ...STOP_STATE_NAMES]) {
    if (lowered.includes(token)) hits.push({ where: 'meta', value: token, token });
  }
  return hits;
}

// ─── Which policy class does this filing belong to? ───────────────────────────

/**
 * A ledger entry is a `propose-*` act, and which one depends on what is being filed.
 * @returns {{classId:string, need:string}}
 */
function classFor(def) {
  if (def?.kind === KIND.QUESTION || (def?.changes ?? []).length === 0) {
    return { classId: 'propose-question', need: 'L3' };
  }
  const declared = def?.meta?.findingClass;
  const classId = DIFF_CLASSES.includes(declared) ? declared : 'propose-source';
  return { classId, need: 'L3' };
}

// ─── The create gate ──────────────────────────────────────────────────────────

/**
 * @param {object} def       the proposal definition
 * @param {object} ctx       `{origin, io}` — `origin` is a LITERAL written at the call site, never read
 *                           from `def`; `io` is optional and only moves which root paths resolve against
 * @returns {object|null}    a refusal, or null when the create may proceed
 */
function inspectCreate(def, { origin, io } = {}) {
  if (!ORIGINS.includes(origin)) {
    throw new Error(`autonomyGate.inspectCreate needs a derived origin (${ORIGINS.join(' | ')}) — "${origin}" is not one`);
  }

  const governed = governedPathsNamed(def, io);
  if (governed.length) {
    return {
      ok: false,
      refused: true,
      reason: 'a proposal may not name the files that govern the autonomy policy or the stop: '
            + governed.map(g => `${g.token} (in ${g.where})`).join(', '),
      governed,
    };
  }

  if (origin === 'ipc') {
    // The kind fence. These kinds are authored by Rāma's loop inside the main process; one arriving
    // from outside with crafted `meta` is a forgery, and refusing it at the door is cheaper than
    // discovering it at the applier.
    if (OWNED_KINDS.includes(def?.kind)) {
      return {
        ok: false,
        refused: true,
        reason: `"${def.kind}" is filed by Rāma's self-maintenance loop inside the main process, not by a caller`,
      };
    }
    // Everything else from IPC is master at the keyboard: not gated, exactly as before.
    return null;
  }

  // origin === 'rama' — the fail-safe predicate governs here, and nowhere else.
  if (stop.isStopped()) {
    return {
      ok: false,
      stopped: true,
      reason: `autonomy is stopped — ${stop.status().env || `no allow-file at ${stop.allowPath()}`}; nothing is filed`,
    };
  }
  const { classId, need } = classFor(def);
  const blocked = policy.require(classId, need, { action: 'filing a proposal' });
  if (blocked) return blocked;
  return null;
}

/**
 * The ONLY path by which Rāma may create a proposal of a kind this design owns.
 *
 * Nothing calls this yet: the five-stage loop that would is deferred. It is built now, with the stop
 * and the policy already consulting from inside it, because a chokepoint added to a call graph that has
 * already grown is a chokepoint somebody routes around.
 *
 * @param {object} ledger  `proposals.cjs`
 * @param {object} def     the proposal definition
 */
function fileProposal(ledger, def = {}) {
  const refusal = inspectCreate(def, { origin: 'rama' });
  if (refusal) return refusal;
  if (!OWNED_KINDS.includes(def.kind)) {
    return { ok: false, refused: true, reason: `fileProposal only files ${OWNED_KINDS.join(' or ')} — "${def.kind}" is not one` };
  }
  const meta = { ...(def.meta || {}), schema: SCHEMA };
  return { ok: true, data: ledger.create({ ...def, meta }) };
}

// ─── The IPC seam ─────────────────────────────────────────────────────────────

/**
 * Wrap the recorder `proposals.register()` is given, so the `proposals:create` handler is validated
 * before it runs. Every other channel is forwarded unchanged — this is a validation seam, not a policy
 * layer over the whole ledger, and it must not become one.
 *
 * @param {object} ipc  `ipcMain`, or main.cjs's recording wrapper around it
 */
function guardLedgerIpc(ipc) {
  const wrapped = {
    handle: (channel, fn) => {
      if (channel !== 'proposals:create') return ipc.handle(channel, fn);
      return ipc.handle(channel, async (event, def) => {
        let refusal;
        try { refusal = inspectCreate(def || {}, { origin: 'ipc' }); }
        catch (err) { return { ok: false, error: err.message }; }
        if (refusal) return { ok: false, error: refusal.reason };
        return fn(event, def);
      });
    },
  };
  for (const name of ['handleOnce', 'removeHandler', 'on', 'once', 'off', 'removeListener',
    'removeAllListeners', 'emit', 'listenerCount']) {
    if (typeof ipc?.[name] === 'function') wrapped[name] = (...args) => ipc[name](...args);
  }
  return wrapped;
}

module.exports = {
  KIND, OWNED_KINDS, SCHEMA, DIFF_CLASSES, ORIGINS, STOP_STATE_NAMES, REPO_ROOT,
  trimSegments, normalise, stripSpellings, normalisePath, canonicalPath,
  namesGovernedPath, governedPathsNamed, classFor,
  inspectCreate, fileProposal, guardLedgerIpc,
};
