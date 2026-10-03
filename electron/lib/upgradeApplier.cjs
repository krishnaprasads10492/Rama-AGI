'use strict';

/**
 * upgradeApplier.cjs — entry validation for the kind this design owns, and the byte snapshot behind it.
 *
 * ── WHY THE VALIDATION IS HERE AND NOT AT THE LEDGER ──────────────────────────────────────────────
 *
 * `proposals.cjs` is protected and cannot change. `proposals.create` is renderer-reachable at tier 1
 * with `meta` passed straight through, and `restore()` rehydrates `meta` and `changes` on an id check
 * alone — so a guard that ran once, before a restart, is not a guard that holds at apply time. The one
 * component this design owns that WRITES SOURCE therefore has to be the one that refuses.
 *
 * ── THE SIGNATURE IS NOT NEGOTIABLE ───────────────────────────────────────────────────────────────
 *
 * Measured: `proposals.cjs` 235 invokes `await applier(p, opts)` — TWO arguments. A registered applier
 * cannot receive a third injected parameter, so a closure is the only seam, and `applyWith` is exported
 * so the suite can pass fakes with no Electron process:
 *
 *     register(ledger, io)  →  ledger.registerApplier(KIND.DIFF, (p, opts) => applyWith(io, p, opts))
 *
 * ── THE THREE THINGS THE STOP GOT WRONG, AND WHAT REPLACES THEM ───────────────────────────────────
 *
 * 1. **`opts.autonomous` is never read in a conditional.** It arrives from the renderer
 *    (`preload.cjs` 680 → `proposals.cjs` 235) untouched, so a predicate built on it is supplied by the
 *    party the stop exists to stop, and a future autonomous applier would bypass it by OMITTING A
 *    FIELD. It is recorded into `meta.autonomy` as a datum for the audit, MERGED rather than assigned so
 *    `appliedBy` and `autonomousApply` survive beside it.
 *
 * 2. **The snapshot directory is DERIVED from the proposal id, and the persisted `dir` is never read.**
 *    `rollbackPoint` lives in `meta`, `restore()` rehydrates `meta` on an id check alone, and `<userData>`
 *    is where the stop's own allow-file lives — so a persisted `dir` used as a write destination put the
 *    stop's state inside the one branch the fence permits to write. `meta...rollbackPoint.dir` is
 *    DISPLAY-ONLY, exactly as a persisted verification plan is.
 *
 * 3. **The level comes from `policy.requireMasterDriven`, which ignores the stop for the two MASTER_ACT
 *    classes and throws for everything else.** An unconditional `policy.require('revert-own-apply')`
 *    resolved against the L0 the stop forces, and the shipped install has no allow-file — so it REFUSED
 *    A MASTER-APPROVED APPLY ON EVERY INSTALL. The stop halts Rāma starting work; it must never refuse
 *    master. `scripts/verifyUpgradeApplier.cjs` asserts that in the shipped state: no allow-file, no
 *    policy file, master-approved apply SUCCEEDS.
 *
 * ── WHAT THIS DOES NOT DO, STATED SO NOTHING READS AS PASSED ──────────────────────────────────────
 *
 * There is NO verification plan, NO breakage analysis and NO corrected proposal in this slice: the
 * result carries `verification: 'not-run'`, a declared value that must never render as "passed". The
 * revert runs when a WRITE fails, which is the only failure this slice can detect.
 */

const path   = require('path');
const crypto = require('crypto');

const gate   = require('./autonomyGate.cjs');
const stop   = require('./autonomyStop.cjs');

const KIND   = gate.KIND;
const SCHEMA = gate.SCHEMA;

/** `proposals.create`'s exact id shape: `crypto.randomBytes(10).toString('hex')`. */
const PID = /^[0-9a-f]{20}$/;

const ALLOWED_ACTIONS = Object.freeze(['patch', 'create']);

/** Snapshot retention: a directory goes when EITHER bound is exceeded. `fatal` ones never go. */
const SNAPSHOT_MAX_ENTRIES = 20;
const SNAPSHOT_MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000;

/** `opts` is renderer input. These two keys are the only ones ever read; the rest are ignored. */
const RECOGNISED_OPTS = Object.freeze(['user', 'autonomous']);

function defaultIo(io = {}) {
  return {
    fs:         io.fs         || require('fs'),
    repoRoot:   io.repoRoot   || path.resolve(__dirname, '..', '..'),
    userDataRoot: io.userDataRoot || stop.userDataRoot(),
    policy:     io.policy     || require('./autonomyPolicy.cjs'),
    guard:      io.guard      || require('./loyaltyGuard.cjs'),
    capability: io.capability || require('./capability.cjs'),
    now:        io.now        || (() => Date.now()),
  };
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/** Register the applier for this design's diff-bearing kind. `io` is closed over once, at wiring time. */
function register(ledger, io = {}) {
  const resolved = defaultIo(io);
  ledger.registerApplier(KIND.DIFF, (proposal, opts) => applyWith(resolved, proposal, opts));
  return { ok: true, kind: KIND.DIFF };
}

// ─── Path validation ──────────────────────────────────────────────────────────

/**
 * Resolve, then compare — and `lstat`, because a symlink whose resolved path is inside the root still
 * writes outside it. Refuses a target that is a symlink, and a target whose existing parent directory
 * resolves outside the repository root.
 */
function validatePath(fs, repoRoot, p) {
  if (!p || typeof p !== 'string') return { ok: false, why: 'a change needs a string path' };
  const resolved = path.resolve(repoRoot, p);
  const root = path.resolve(repoRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { ok: false, why: `"${p}" resolves outside the repository root` };
  }
  let existed = false;
  try {
    const st = fs.lstatSync(resolved);
    existed = true;
    if (st.isSymbolicLink()) return { ok: false, why: `"${p}" is a symlink` };
    if (!st.isFile()) return { ok: false, why: `"${p}" is not a regular file` };
  } catch { existed = false; }

  const parent = path.dirname(resolved);
  try {
    const realParent = fs.realpathSync(parent);
    if (realParent !== root && !realParent.startsWith(root + path.sep)) {
      return { ok: false, why: `"${p}" has a parent directory that resolves outside the repository root` };
    }
  } catch { /* the parent does not exist yet — a create under a new directory */ }

  return { ok: true, resolved, existed, rel: path.relative(root, resolved).split(path.sep).join('/') };
}

// ─── The applier ──────────────────────────────────────────────────────────────

/**
 * @param {object} io        injected `{fs, repoRoot, userDataRoot, policy, guard, capability, now}`
 * @param {object} proposal  the ledger entry, already approved by `proposals.apply`
 * @param {object} opts      `{user, autonomous}` — `autonomous` is RECORDED, never read as a gate
 * @throws on every refusal, because `proposals.apply` records FAILED with the message when an applier
 *         throws, and an entry refused at the door is a failure OUTSIDE any verification plan
 */
async function applyWith(io, proposal, opts = {}) {
  const { fs, repoRoot, policy, guard, capability, now } = defaultIo(io);
  const userDataRoot = io?.userDataRoot || stop.userDataRoot();

  // ── 0. master-driven, derived from the caller — and declared insufficient ──────────────────────
  // `proposals.apply` already authorised `opts.user` before this runs, so the predicate is
  // tautologically TRUE where it is evaluated, and `capability.can` reads only `user.tier`, so a
  // `{tier: 0}` object is forgeable in-process. What this buys is that the applier does not depend on
  // `proposals.cjs` having run its own gate. What guarantees Rāma does not START an apply is the
  // asserted ABSENCE of in-process callers of `proposals.apply`.
  const user = opts?.user;
  const masterDriven = !!(user && typeof user.tier === 'number' && capability.can(user, 'self-modify.apply'));
  if (!masterDriven) throw new Error('apply requires an authenticated tier-0 user (I6)');

  const levelRefusal = policy.requireMasterDriven('revert-own-apply', 'L4');
  if (levelRefusal) throw new Error(levelRefusal.reason);

  const at = new Date(now()).toISOString();
  proposal.meta = proposal.meta || {};
  // MERGED, never assigned: `appliedBy` and `autonomousApply` are what the audit trail and the
  // forward-compatibility argument both rest on, and `flagFromOpts` keeps "what the caller claimed"
  // and "what the system decided" as two separate auditable facts.
  proposal.meta.autonomy = {
    ...(proposal.meta.autonomy || {}),
    appliedBy: 'master',
    autonomousApply: false,
    flagFromOpts: opts?.autonomous === true,
    recordedAt: at,
  };

  // ── the id, and the DERIVED snapshot directory ─────────────────────────────────────────────────
  if (!PID.test(String(proposal?.id ?? ''))) throw new Error('malformed proposal id');
  const dir = path.join(userDataRoot, stop.STATE_DIR, stop.SNAPSHOT_DIR, proposal.id);

  // ── 1. the schema marker ───────────────────────────────────────────────────────────────────────
  if (proposal.meta?.schema !== SCHEMA) {
    throw new Error(`an entry of kind "${KIND.DIFF}" needs meta.schema "${SCHEMA}" — this one was not filed by this loop`);
  }

  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  if (changes.length === 0) throw new Error('a diff-bearing entry needs at least one change');

  // ── 2. the loyalty guard, RE-RUN rather than trusted from creation ─────────────────────────────
  const inspected = guard.inspectChanges(changes);
  if (inspected.refused.length > 0) {
    throw new Error(`refused: these files constitute the loyalty covenant (I15): ${inspected.refused.join(', ')}`);
  }

  // ── 3. nothing may name the policy's own authority, or the stop's own state ────────────────────
  const governed = gate.governedPathsNamed(proposal);
  if (governed.length > 0) {
    throw new Error('refused: a change may not name the files that govern the autonomy policy or the stop: '
      + governed.map(g => `${g.token} (in ${g.where})`).join(', '));
  }

  // ── 4 + 5. one pass over the changes: paths, actions, and what already exists ──────────────────
  const targets = [];
  for (const change of changes) {
    if (!ALLOWED_ACTIONS.includes(change?.action)) {
      throw new Error(`action "${change?.action}" is refused — only ${ALLOWED_ACTIONS.join(' and ')} are applied `
        + '(a delete reverts to "the file as it was", which is a create of content this loop did not author)');
    }
    const v = validatePath(fs, repoRoot, change.path);
    if (!v.ok) throw new Error(`refused: ${v.why}`);
    if (change.action === 'create' && v.existed) {
      throw new Error(`refused: "${change.path}" already exists, so this is a mis-declared patch`);
    }
    if (change.action === 'patch' && !v.existed) {
      throw new Error(`refused: "${change.path}" does not exist, so there is nothing to patch`);
    }
    if (typeof change.content !== 'string') {
      throw new Error(`refused: "${change.path}" carries no content string`);
    }
    targets.push({ ...v, action: change.action, content: change.content, baseSha256: change.baseSha256 ?? null });
  }

  // ── 6. the file on disk is still the file the change was computed from ─────────────────────────
  for (const t of targets) {
    if (t.action !== 'patch') continue;
    if (!/^[0-9a-f]{64}$/.test(String(t.baseSha256 ?? ''))) {
      throw new Error(`refused: "${t.rel}" has no baseSha256, so "applies cleanly" cannot be distinguished from "applied to a different file"`);
    }
    const onDisk = sha256(fs.readFileSync(t.resolved));
    if (onDisk !== t.baseSha256) {
      throw new Error(`base-drift: "${t.rel}" has changed since this was authored (expected ${t.baseSha256.slice(0, 12)}…, found ${onDisk.slice(0, 12)}…)`);
    }
  }

  // ── the snapshot, taken and VERIFIED before the first write ────────────────────────────────────
  const files = [];
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  for (const t of targets) {
    const copy = path.join(dir, 'files', ...t.rel.split('/'));
    if (!t.existed) {
      files.push({ path: t.rel, existed: false, sha256: null, bytes: null });
      continue;
    }
    const bytes = fs.readFileSync(t.resolved);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.writeFileSync(copy, bytes);
    const back = fs.readFileSync(copy);
    if (sha256(back) !== sha256(bytes)) {
      throw new Error(`the snapshot of "${t.rel}" did not read back identical — refusing to write anything`);
    }
    files.push({ path: t.rel, existed: true, sha256: sha256(bytes), bytes: bytes.length });
  }
  fs.writeFileSync(path.join(dir, 'rollback.json'),
    JSON.stringify({ proposalId: proposal.id, at, files }, null, 2), 'utf8');

  const token = { proposalId: proposal.id, dir, at, snapshot: { files } };

  // ── the writes ─────────────────────────────────────────────────────────────────────────────────
  const applied = [];
  try {
    for (const t of targets) {
      fs.mkdirSync(path.dirname(t.resolved), { recursive: true });
      fs.writeFileSync(t.resolved, t.content, 'utf8');
      applied.push({ path: t.rel, action: t.action, bytes: Buffer.byteLength(t.content) });
    }
  } catch (err) {
    const undone = revert(token, io);
    if (!undone.ok) {
      throw new Error(`FATAL: "${err.message}" and the revert also failed (${undone.failures.join('; ')}) — `
        + `the snapshot is kept at ${dir} and autonomy has been halted`);
    }
    throw new Error(`write failed and was reverted: ${err.message}`);
  }

  evictSnapshots({ fs, root: path.join(userDataRoot, stop.STATE_DIR, stop.SNAPSHOT_DIR), keep: dir, now: now() });

  return {
    applied,
    snapshotDir: dir,
    files,
    // DECLARED, so it can never render as "passed": this slice runs no verification plan.
    verification: 'not-run',
    verificationNote: 'no verification plan runs in this build — see docs/research/self-upgrade-build.md',
    autonomy: proposal.meta.autonomy,
    masterDriven,
  };
}

// ─── The revert ───────────────────────────────────────────────────────────────

/**
 * Restore each snapshotted file to its RECORDED PRIOR STATE. `existed: true` restores the bytes;
 * `existed: false` removes the file and asserts its absence, because "restore the prior bytes" has no
 * meaning for a file that did not exist.
 *
 * It consults NEITHER the policy NOR the stop. A token IS the authority: there is no path to a revert
 * that was not preceded by a permitted, snapshotted apply, and a stop engaged mid-flight must not strand
 * a half-written tree — a state nobody chose is worse than either endpoint.
 *
 * Why not `git checkout` / `stash` / `reset`: a verification failure does not justify discarding master's
 * unrelated uncommitted edits to the same files. The snapshot restores exactly the bytes that were there.
 */
function revert(token, io = {}) {
  const { fs, repoRoot } = defaultIo(io);
  if (!token || !PID.test(String(token.proposalId ?? '')) || !token.dir || !Array.isArray(token.snapshot?.files)) {
    return { ok: false, failures: ['revert needs the token issued at apply entry'], restored: [], removed: [] };
  }
  const restored = [];
  const removed = [];
  const failures = [];

  for (const f of token.snapshot.files) {
    const v = validatePath(fs, repoRoot, f.path);
    if (!v.ok) { failures.push(`${f.path}: ${v.why}`); continue; }
    try {
      if (f.existed) {
        const copy = path.join(token.dir, 'files', ...String(f.path).split('/'));
        const bytes = fs.readFileSync(copy);
        if (sha256(bytes) !== f.sha256) { failures.push(`${f.path}: the snapshot no longer matches its digest`); continue; }
        fs.mkdirSync(path.dirname(v.resolved), { recursive: true });
        fs.writeFileSync(v.resolved, bytes);
        restored.push(f.path);
      } else {
        try { fs.rmSync(v.resolved, { force: true }); } catch { /* already absent */ }
        let present = true;
        try { fs.lstatSync(v.resolved); } catch { present = false; }
        if (present) failures.push(`${f.path}: could not be removed`);
        else removed.push(f.path);
      }
    } catch (err) { failures.push(`${f.path}: ${err.message}`); }
  }

  if (failures.length > 0) {
    // A revert that fails is fatal and says so. The snapshot is the only record of what the tree was
    // supposed to be, so it is marked and never evicted, and the reason is recorded by the stop before
    // the allow-file is destroyed.
    try {
      fs.writeFileSync(path.join(token.dir, 'fatal.json'),
        JSON.stringify({ at: new Date().toISOString(), proposalId: token.proposalId, failures }, null, 2), 'utf8');
    } catch { /* the directory may be the thing that is wrong */ }
    stop.engage(`revert failed for proposal ${token.proposalId}: ${failures.join('; ')}`, 'upgradeApplier');
    return { ok: false, fatal: true, failures, restored, removed };
  }
  return { ok: true, failures, restored, removed };
}

// ─── Retention ────────────────────────────────────────────────────────────────

/**
 * A whole-file copy per apply accumulates, and this design mandates a real purge for every other byte it
 * writes. A directory is evicted when EITHER bound is exceeded — older than 30 days, OR not among the 20
 * most recent — oldest first. A `fatal` directory is never evicted and does not count toward the 20. The
 * count is returned rather than silently applied.
 */
function evictSnapshots({ fs, root, keep = null, now = Date.now() }) {
  let names;
  try { names = fs.readdirSync(root); } catch { return { evicted: 0, kept: 0, fatal: 0 }; }

  const entries = [];
  let fatal = 0;
  for (const name of names) {
    if (!PID.test(name)) continue;
    const dir = path.join(root, name);
    let isFatal = false;
    try { fs.accessSync(path.join(dir, 'fatal.json')); isFatal = true; } catch { isFatal = false; }
    if (isFatal) { fatal += 1; continue; }
    let mtime = 0;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { mtime = 0; }
    entries.push({ dir, name, mtime });
  }
  entries.sort((a, b) => b.mtime - a.mtime);

  let evicted = 0;
  entries.forEach((e, index) => {
    if (keep && e.dir === keep) return;
    const tooOld = (now - e.mtime) > SNAPSHOT_MAX_AGE_MS;
    const tooMany = index >= SNAPSHOT_MAX_ENTRIES;
    if (!tooOld && !tooMany) return;
    try { fs.rmSync(e.dir, { recursive: true, force: true }); evicted += 1; } catch { /* reported by the count */ }
  });
  return { evicted, kept: entries.length - evicted, fatal };
}

module.exports = {
  KIND, SCHEMA, PID, ALLOWED_ACTIONS, RECOGNISED_OPTS,
  SNAPSHOT_MAX_ENTRIES, SNAPSHOT_MAX_AGE_MS,
  register, applyWith, revert, validatePath, evictSnapshots,
};
