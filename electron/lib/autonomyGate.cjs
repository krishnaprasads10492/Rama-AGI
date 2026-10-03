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
 * ── THE RESIDUAL, PRINTED RATHER THAN IMPLIED ─────────────────────────────────────────────────────
 *
 * In-process `proposals.create()` is NOT gated: it is reached directly by five existing callers and
 * `proposals.cjs` cannot be modified. And `electron/ipc/timeline.cjs`'s pre-existing SELF_MODIFY
 * applier writes `changes[].path` verbatim with no root confinement, so an absolute path is still
 * written wherever the process can write. Closing that is master's decision, because confining it would
 * change the behaviour of a shipped applier. `scripts/verifyUpgradeApplier.cjs` prints both residuals.
 */

const path   = require('path');

const policy = require('./autonomyPolicy.cjs');
const stop   = require('./autonomyStop.cjs');

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
 */
function normalise(p) {
  const slashed = String(p ?? '').replace(/\\/g, '/');
  if (!slashed) return '';
  return path.posix.normalize(slashed).replace(/^\.\//, '').toLowerCase();
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
 * @returns {string|null} the token it named, or null
 */
function namesGovernedPath(text) {
  const p = normalise(text);
  if (!p) return null;
  for (const rel of selfGoverningRelPaths()) {
    if (p === rel || p.endsWith(`/${rel}`)) return rel;
  }
  for (const name of STOP_STATE_NAMES) {
    if (p === name || p.endsWith(`/${name}`) || p.includes(`/${name}/`)) return name;
  }
  return null;
}

/**
 * Every governed path named by a proposal definition — in `changes[].path` AND anywhere in `meta`.
 * `meta` is scanned because it is persisted, rehydrated on an id check alone, and was the door through
 * which a snapshot directory once became a write destination.
 */
function governedPathsNamed(def) {
  const hits = [];
  for (const change of def?.changes ?? []) {
    const hit = namesGovernedPath(change?.path);
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
 * @param {object} ctx       `{origin}` — a LITERAL written at the call site, never read from `def`
 * @returns {object|null}    a refusal, or null when the create may proceed
 */
function inspectCreate(def, { origin } = {}) {
  if (!ORIGINS.includes(origin)) {
    throw new Error(`autonomyGate.inspectCreate needs a derived origin (${ORIGINS.join(' | ')}) — "${origin}" is not one`);
  }

  const governed = governedPathsNamed(def);
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
  KIND, OWNED_KINDS, SCHEMA, DIFF_CLASSES, ORIGINS, STOP_STATE_NAMES,
  normalise, namesGovernedPath, governedPathsNamed, classFor,
  inspectCreate, fileProposal, guardLedgerIpc,
};
