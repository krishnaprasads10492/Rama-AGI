'use strict';

/**
 * autonomyStop.cjs — the one switch that halts Rāma's autonomous activity.
 *
 * Built FIRST, before anything is autonomous, because a stop retrofitted onto a running loop is the
 * one thing that must not be retrofitted. Section 124's R-L4: *tier-0, tray-reachable, unreachable by
 * any proposal, fail-safe.* SELF_UPGRADE.md §E.2 is the design; this is the narrowed slice of it the
 * orchestrator cut, and what is NOT here is named rather than implied (DEFERRED, below).
 *
 * ── TWO PREDICATES, AND THE ASYMMETRY IS THE DECISION ─────────────────────────────────────────────
 *
 *   isStopped()  governs NEW autonomous action. FAIL-SAFE: absence of configuration means STOPPED.
 *   isHalted()   governs the PRE-EXISTING dispatchers. True only on an EXPLICIT engage (or the env
 *                variable). Absence means "exactly the build master already has".
 *
 * For autonomy that does not exist yet the safe default is *off*, and absence must mean *off* —
 * nothing is lost because nothing was there. For work that ALREADY RUNS on master's machine the safe
 * default is *unchanged*: `ollama-catalog`, `dependency-review`, the metacognition audit, selfCare's
 * 120-second sweep and marketIntel's two ticks ship and run today, and governing them with the
 * fail-safe predicate would have REMOVED five working behaviours on every install until master
 * hand-created a file nobody had told him about. That is a regression wearing a fail-safe argument,
 * and I11 has no exception for it.
 *
 * ── WHY A FILE WHOSE PRESENCE GRANTS, RATHER THAN WHOSE PRESENCE FORBIDS ──────────────────────────
 *
 * A stop-flag means the default state of a fresh install, a wiped profile, a half-written file, a disk
 * error or a permissions change is RUNNING. Fail-safe requires the uncertain state to be the safe one,
 * so the safe state must be the one that needs nothing to be true. `o?.allowed !== true` is strict on
 * purpose: `"true"`, `1`, `{}`, `null`, a directory and a zero-byte file all resolve to stopped.
 *
 * ── DEPENDENCY-FREE AND SYNCHRONOUS, DELIBERATELY ────────────────────────────────────────────────
 *
 * `fs`, `path`, `os` and nothing else at module scope. No `electron`, no `dataStore`, no `cryptoCore`,
 * so this is callable from `before-quit`, from a suite under plain `node`, from a module loaded before
 * the store is unlocked, and from inside a `catch` during a failing boot. A stop that can fail to load
 * is not a stop — `selfRepair.cjs` already made this argument for itself.
 *
 * ── WHERE THE STATE LIVES, AND WHY OUTSIDE THE REPOSITORY ────────────────────────────────────────
 *
 *   <userData>/rama/autonomy.allow          {"allowed": true, "by": "...", "at": "<ISO>", "note": "..."}
 *   <userData>/rama/autonomy.stopped.json   {at, reason, by, priorAllow}
 *
 * `userData` is writable in every install on every platform (`selfRepair.cjs` already depends on it),
 * and it is outside the repo root. That makes the state unnameable by a repo-relative `changes[].path`
 * — but NOT unnameable by an absolute one, and the honest residual is stated rather than argued away:
 * `electron/ipc/timeline.cjs`'s pre-existing SELF_MODIFY applier writes `changes[].path` verbatim with
 * no root confinement. The route this slice closes is the renderer one (`autonomyGate.guardLedgerIpc`
 * refuses a create naming these paths); the in-process `proposals.create()` route is NOT closed,
 * because `proposals.cjs` is protected. `scripts/verifyAutonomyStop.cjs` prints that residual on every
 * run. See the build note's "for master" list.
 *
 * ── DEFERRED IN THIS SLICE, NAMED SO THE COUNT CANNOT LIE ────────────────────────────────────────
 *
 * `engage()` records the halt and performs NO teardown of the pre-existing timers. Reason: the resume
 * path is `lift()`, `lift()` requires `system.suspend-autonomy`, and that capability is not in
 * `shared/capabilities.json` (a protected file this slice does not touch) — so `capability.can()`
 * returns false for every tier including master. Tearing down master's shipped timers with no working
 * in-app resume would leave them dead until a restart. `PRE_EXISTING[].haltedByEngage` is therefore
 * `false`, declared per entry, and `statusText()` says so in words.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Names, in one place ──────────────────────────────────────────────────────
const ENV_KEY        = 'RAMA_AUTONOMY';
const STATE_DIR      = 'rama';
const ALLOW_FILE     = 'autonomy.allow';
const STOPPED_RECORD = 'autonomy.stopped.json';
const SNAPSHOT_DIR   = 'upgrade-snapshots';

/** electron-builder's productName. Used ONLY by the no-Electron fallback below. */
const APP_NAME = 'Rama AGI';

let injectedUserDataRoot = null;

/**
 * Point the module at a different `userData` root. For suites, and for any host where Electron is not
 * resolvable. Deliberately not a general setter for the paths themselves: the file NAMES are frozen,
 * so a caller cannot redirect `isStopped()` at a file it controls.
 */
function configure({ userDataRoot = null } = {}) {
  injectedUserDataRoot = userDataRoot ? String(userDataRoot) : null;
  return { userDataRoot: userDataRoot ? String(userDataRoot) : null };
}

/** `app.getPath('userData')` when Electron is present; a platform-conventional path when it is not. */
function userDataRoot() {
  if (injectedUserDataRoot) return injectedUserDataRoot;
  try {
    const { app } = require('electron');
    const p = app?.getPath?.('userData');
    if (p) return p;
  } catch { /* no Electron — a suite, or the server process */ }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME);
}

function stateDir()          { return path.join(userDataRoot(), STATE_DIR); }
function allowPath()         { return path.join(stateDir(), ALLOW_FILE); }
function stoppedRecordPath() { return path.join(stateDir(), STOPPED_RECORD); }
function snapshotRoot()      { return path.join(stateDir(), SNAPSHOT_DIR); }

/** The env override, checked FIRST by both predicates: it works before the app starts. */
function envStop() {
  return String(process.env[ENV_KEY] || '').toLowerCase() === 'stop';
}

// ─── The two predicates ───────────────────────────────────────────────────────

/**
 * Fail-safe. Governs the NEW autonomous dispatch points in `CHOKEPOINTS`.
 * Absence, invalidity, unreadability and `allowed` being anything other than the boolean `true` all
 * mean STOPPED.
 */
function isStopped() {
  if (envStop()) return true;
  let raw;
  try { raw = fs.readFileSync(allowPath(), 'utf8'); } catch { return true; }
  let o;
  try { o = JSON.parse(raw); } catch { return true; }
  return o?.allowed !== true;
}

/**
 * Explicit-engage only. Governs the PRE-EXISTING dispatchers in `PRE_EXISTING`.
 * `isStopped()` never reads the stopped-record, so an absent record never implies autonomy is running.
 */
function isHalted() {
  if (envStop()) return true;
  try { fs.accessSync(stoppedRecordPath()); return true; } catch { return false; }
}

// ─── What each predicate governs. Declared data, printed by the suite ─────────

/**
 * The NEW autonomous dispatch points that consult `isStopped()`. One, in this slice.
 * A member that behaves differently is declared, never omitted — which is why the five stage
 * functions the full design specifies are in `DEFERRED_CHOKEPOINTS` rather than silently absent.
 */
const CHOKEPOINTS = Object.freeze([
  Object.freeze({
    module:    'electron/lib/autonomyGate.cjs',
    fn:        'fileProposal',
    predicate: 'isStopped',
    governs:   'Rāma creating a proposal of a kind this design owns',
  }),
]);

/**
 * The five stage functions of the full design, NOT BUILT in this slice. The suite asserts each is
 * absent from disk, so `CHOKEPOINTS.length` can never claim coverage this slice does not have.
 */
const DEFERRED_CHOKEPOINTS = Object.freeze([
  Object.freeze({ module: 'electron/lib/upgradeNotice.cjs',   fn: 'collect' }),
  Object.freeze({ module: 'electron/lib/upgradeResearch.cjs', fn: 'gather'  }),
  Object.freeze({ module: 'electron/lib/upgradeAuthor.cjs',   fn: 'author'  }),
  Object.freeze({ module: 'electron/lib/upgradeWeigh.cjs',    fn: 'weigh'   }),
  Object.freeze({ module: 'electron/lib/upgradeProposer.cjs', fn: 'file'    }),
]);

/**
 * The ONE gated path that does NOT consult the stop, with its reason carried in the data.
 * Applying — or undoing — a change master already approved is MASTER'S act, and the STOP exists to
 * halt Rāma STARTING work. A stop that revoked master's own apply would mean that on an install which
 * is permanently stopped by design he could approve a change and never apply it, forever.
 */
const MASTER_DRIVEN_ENTRIES = Object.freeze([
  Object.freeze({
    module: 'electron/lib/upgradeApplier.cjs',
    fn:     'applyWith',
    reason: 'applying or undoing a change master already approved is master\'s act; the level comes '
          + 'from policy.requireMasterDriven over the frozen MASTER_ACT subset, whose members are also '
          + 'PERMANENT so no data edit can refuse master either, and "Rāma does not start an apply" is '
          + 'held by the asserted absence of in-process callers of proposals.apply',
  }),
]);

/**
 * The four PRE-EXISTING dispatchers. They ship and they run today, so `isStopped()` does not govern
 * them — `isHalted()` does, and nothing in this slice tears them down. Measured citations, kept true
 * by the suite: the symbol must still exist in the file (RED if it does not); a drifted line number is
 * printed as a residual rather than failing, because an unrelated edit elsewhere in those files is not
 * a loyalty defect.
 */
const PRE_EXISTING = Object.freeze([
  Object.freeze({
    module: 'electron/lib/refreshScheduler.cjs', fn: 'runNow', citedLine: 125,
    work: 'ollama-catalog, dependency-review and every other registered refresh task',
    governedBy: 'isHalted', haltedByEngage: false,
    why: 'one dispatcher covers every registered task; engage() does not call stop() in this slice '
       + 'because lift() cannot succeed until master adds system.suspend-autonomy',
  }),
  Object.freeze({
    module: 'electron/ipc/metaCognition.cjs', fn: 'auditTimer', citedLine: 332,
    work: 'the 10-minute metacognition audit',
    governedBy: 'isHalted', haltedByEngage: false,
    why: 'the interval is armed inside register() and there is no exported re-arm, so a halt with no '
       + 'working lift could not be undone without a restart',
  }),
  Object.freeze({
    module: 'electron/ipc/selfCare.cjs', fn: 'runHealthSweep', citedLine: 200,
    work: 'the 120-second health sweep, including checkInstanceFailover',
    governedBy: 'isHalted', haltedByEngage: false,
    why: 'armed at TWO sites (345 and 396); replacing one would leave a live timer that an '
       + 'interval-clearing assertion still passes — a green row over running work',
  }),
  Object.freeze({
    module: 'electron/ipc/marketIntel.cjs', fn: 'tickResolveOutcomes', citedLine: 731,
    work: 'outcome resolution and news sync (tickSyncNews at 748; timers at 784-785)',
    governedBy: 'isHalted', haltedByEngage: false,
    why: 'master\'s on-demand StockMind calls arrive through IPC handlers and must stay untouched',
  }),
]);

/**
 * The future L5 entry point: NAMED, and asserted ABSENT. When it is built it consults
 * `policy.require('apply-source', 'L5')` AND `isStopped()` at its OWN entry, because a start-of-work
 * check belongs in the function that starts the work, not in the function that writes the bytes.
 */
const FUTURE_ENTRIES = Object.freeze([
  Object.freeze({ module: 'electron/lib/upgradeLoop.cjs', fn: 'applyAutonomously', mustBeAbsent: true }),
]);

/**
 * Declared exemption, printed rather than silent: `agentOrchestrator`'s governor only REAPS. It kills
 * agents past the timeout and garbage-collects finished ones after assimilating them. Halting a reaper
 * does not stop work; it leaves hung agents running.
 */
const STOP_EXEMPT = Object.freeze([
  Object.freeze({
    module: 'electron/ipc/agentOrchestrator.cjs', fn: 'the governor interval',
    reason: 'it only reaps — halting it would leave hung agents running, which is not a safer state',
  }),
]);

// ─── Engaging ─────────────────────────────────────────────────────────────────

/**
 * Engage the halt. No capability check and no `user`: a stop that can be refused is not a stop, and
 * gating it would make the one control an operator reaches for during an incident depend on the
 * subsystem being investigated.
 *
 * IT RECORDS BEFORE IT DESTROYS. The record is written FIRST, so a crash between the two steps leaves
 * a recorded reason and a still-present allow-file — inconsistent in the RECOVERABLE direction —
 * rather than a deleted file and no explanation of why.
 *
 * @param {string} reason  why — for a fatal revert this is the most important datum in the system
 * @param {string} by      who or what engaged it
 */
function engage(reason, by = 'unknown') {
  const why = String(reason || '').trim() || 'no reason given';
  let priorAllow = null;
  try { priorAllow = JSON.parse(fs.readFileSync(allowPath(), 'utf8')); } catch { priorAllow = null; }

  const record = { at: new Date().toISOString(), reason: why, by: String(by || 'unknown'), priorAllow };
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(stoppedRecordPath(), JSON.stringify(record, null, 2), 'utf8');
  } catch (err) {
    // Fatal and non-proceeding: a halt whose reason could not be recorded must not also destroy the
    // only record of who allowed autonomy.
    return { ok: false, error: `could not record the halt: ${err.message}`, recorded: false, revoked: false };
  }

  let revoked = false;
  try { fs.unlinkSync(allowPath()); revoked = true; } catch { revoked = false; }

  return {
    ok: true, recorded: true, revoked,
    record,
    teardown: { performed: false, reason: 'see PRE_EXISTING[].haltedByEngage — no working in-app lift yet' },
  };
}

// ─── Lifting — the only gated direction, and it degrades honestly ─────────────

/**
 * The ONLY writer of `allowed: true`.
 *
 * Refuses, in order: a string `user` (a name is not an identity — `proposals.authorise`'s own words);
 * a `user` with no numeric tier; a user without `system.suspend-autonomy`; an empty note.
 *
 * `system.suspend-autonomy` is NOT in `shared/capabilities.json` — a protected file this slice does not
 * touch — and `capability.can()` returns false for an unknown capability for EVERY tier including
 * master. So until master adds the key this function cannot succeed for anyone, and the stop can only
 * be lifted by master writing the allow-file himself. That is the correct failure direction, it needs
 * no special-casing, and the refusal says exactly which key is missing rather than rendering a dead
 * button.
 *
 * ORDERING: the allow-file is written FIRST, the stopped-record removed SECOND, so a crash between
 * them leaves "allowed but still halted" — the recoverable direction.
 *
 * ── WHY THE CAPABILITY MODULE IS INJECTABLE, AND WHY THAT IS NOT A WEAKENING ──────────────────────
 *
 * `system.suspend-autonomy` is absent from the matrix, so with the real module this function CANNOT
 * SUCCEED FOR ANYONE — which meant its success path, the only act in the system that writes
 * `allowed: true`, had no behavioural coverage at all: the note refusal, the contents of the file it
 * writes, the write-then-unlink ordering and the halt clearing were asserted by regex over this
 * function's own source text, and the first real execution would have been in production on the day
 * master added the key. So `{capability}` is injectable, in the same shape `upgradeApplier` uses for
 * `io`, and the suite runs the real thing.
 *
 * That adds no reach for anything. `isStopped()` reads a plain JSON file with no signature, so any
 * in-process caller that could pass a fake capability here could already write `allowed: true` to
 * `allowPath()` directly and skip this function entirely. The capability check is the gate on the
 * in-app control, not a containment boundary against code already running inside the main process —
 * what holds that line is the asserted ABSENCE of in-process callers, and the suite asserts no module
 * passes an override either.
 */
function lift(user, note, { capability: injectedCapability = null } = {}) {
  if (typeof user === 'string') {
    return { ok: false, error: `Lifting the stop requires an authenticated user — "${user}" is a label, not an identity` };
  }
  if (!user || typeof user.tier !== 'number') {
    return { ok: false, error: 'Lifting the stop requires an authenticated user' };
  }
  let capability = injectedCapability;
  if (!capability) {
    try { capability = require('./capability.cjs'); }
    catch { return { ok: false, error: 'Lifting the stop requires the capability matrix, which could not be loaded' }; }
  }

  const denied = capability.deny(user, 'system.suspend-autonomy');
  if (denied) {
    return {
      ok: false,
      error: `${denied.error} — "system.suspend-autonomy" is not in shared/capabilities.json, so the `
           + 'stop cannot be lifted in-app by anyone. Master lifts it by writing '
           + `${allowPath()} himself. See docs/research/self-upgrade-build.md.`,
      missingCapability: 'system.suspend-autonomy',
    };
  }
  const text = String(note || '').trim();
  if (!text) return { ok: false, error: 'Lifting the stop requires a note saying why' };

  const allow = {
    allowed: true,
    by: `${user.name || user.id || 'user'} (tier ${user.tier})`,
    at: new Date().toISOString(),
    note: text,
  };
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(allowPath(), JSON.stringify(allow, null, 2), 'utf8');
  } catch (err) {
    return { ok: false, error: `could not write the allow-file: ${err.message}` };
  }
  let haltCleared = false;
  try { fs.unlinkSync(stoppedRecordPath()); haltCleared = true; } catch { haltCleared = false; }

  return { ok: true, allow, haltCleared };
}

// ─── Reporting ────────────────────────────────────────────────────────────────

/**
 * Did the create fence's module load?
 *
 * The stop is fail-safe; the create fence is deliberately FAIL-OPEN at its wiring site. `main.cjs`
 * registers the ledger with the bare recorder when `autonomyGate.cjs` cannot be required, so a broken
 * fence never costs the ledger its channels (I11). Fail-open is the right call there and the wrong
 * thing to leave silent: `safeRequire` records the failure in `loadFailures()`, which is the boot log,
 * not the autonomy surface — so `status()` would have gone on describing a fence that was not in place.
 * It is derived here, by attempting the require, and `statusText()` says so in words.
 *
 * The require is attempted lazily, INSIDE this function: `autonomyGate.cjs` requires this module at its
 * own module scope, so a module-scope require in the other direction would be a cycle.
 */
function gateLoaded() {
  try {
    const gate = require('./autonomyGate.cjs');
    return typeof gate?.guardLedgerIpc === 'function' && typeof gate?.inspectCreate === 'function';
  } catch { return false; }
}

/** Every field carries its own truth; nothing is inferred by the caller. */
function status() {
  let allowRaw = null;
  let allowParsed = null;
  try { allowRaw = fs.readFileSync(allowPath(), 'utf8'); } catch { allowRaw = null; }
  if (allowRaw !== null) { try { allowParsed = JSON.parse(allowRaw); } catch { allowParsed = null; } }

  let record = null;
  try { record = JSON.parse(fs.readFileSync(stoppedRecordPath(), 'utf8')); } catch { record = null; }

  return {
    stopped: isStopped(),
    halted:  isHalted(),
    env:     envStop() ? `${ENV_KEY}=stop` : null,
    allowFile: {
      path: allowPath(),
      present: allowRaw !== null,
      valid: allowParsed?.allowed === true,
      by: allowParsed?.by ?? null,
      at: allowParsed?.at ?? null,
      note: allowParsed?.note ?? null,
    },
    stoppedRecord: {
      path: stoppedRecordPath(),
      present: record !== null,
      at: record?.at ?? null,
      reason: record?.reason ?? null,
      by: record?.by ?? null,
    },
    createFence: {
      module: 'electron/lib/autonomyGate.cjs',
      loaded: gateLoaded(),
      failOpen: true,
      governs: 'the kind fence and the path fence on every proposals:create',
    },
    chokepoints: CHOKEPOINTS,
    deferredChokepoints: DEFERRED_CHOKEPOINTS,
    masterDrivenEntries: MASTER_DRIVEN_ENTRIES,
    preExisting: PRE_EXISTING,
    stopExempt: STOP_EXEMPT,
    counts: {
      chokepoints: CHOKEPOINTS.length,
      deferredChokepoints: DEFERRED_CHOKEPOINTS.length,
      masterDrivenEntries: MASTER_DRIVEN_ENTRIES.length,
      preExisting: PRE_EXISTING.length,
      stopExempt: STOP_EXEMPT.length,
    },
  };
}

/**
 * Both halves, by name, in both states — because the one thing that must never happen is a label
 * saying "stopped" over five live timers, or "running" over five dead ones. That is the `badgeLabel`
 * defect, and this is the place it would be least acceptable.
 */
function statusText() {
  const s = status();
  const first = s.stopped
    ? `Rāma's self-maintenance loop is stopped — ${s.env ? `${s.env} is set` : `no allow-file at ${s.allowFile.path}`}; it is noticing nothing and proposing nothing.`
    : `Rāma's self-maintenance loop is allowed (${s.allowFile.by || 'unknown'}, ${s.allowFile.at || 'unknown time'}).`;

  const names = PRE_EXISTING.map(d => d.work).join('; ');
  const second = s.halted
    ? `Halted by an explicit stop${s.stoppedRecord.reason ? ` — ${s.stoppedRecord.reason}` : ''}. `
      + `Still ARMED, because this build does not tear them down: ${names}. `
      + `Undo the halt by deleting ${s.stoppedRecord.path}.`
    : `Still running on their own schedule, exactly as before: ${names}.`;

  const third = 'Lifting the stop in-app needs the "system.suspend-autonomy" capability, which is not '
    + 'in shared/capabilities.json, so only master writing the allow-file by hand can allow autonomy.';

  const fourth = s.createFence.loaded
    ? `The create fence on proposals:create is in place (${s.createFence.module}).`
    : `WARNING: the create fence is NOT IN PLACE — ${s.createFence.module} could not be loaded, so `
      + 'every proposals:create is reaching the ledger unvalidated: the kind fence and the path fence '
      + 'are both absent. That degradation is deliberate, so a broken fence never costs the ledger its '
      + 'channels, and it is reported here rather than only in the boot log.';

  return `${first} ${second} ${third} ${fourth}`;
}

module.exports = {
  // names and paths
  ENV_KEY, STATE_DIR, ALLOW_FILE, STOPPED_RECORD, SNAPSHOT_DIR,
  configure, userDataRoot, stateDir, allowPath, stoppedRecordPath, snapshotRoot,
  // the two predicates
  isStopped, isHalted,
  // declared coverage
  CHOKEPOINTS, DEFERRED_CHOKEPOINTS, MASTER_DRIVEN_ENTRIES, PRE_EXISTING, FUTURE_ENTRIES, STOP_EXEMPT,
  // acts
  engage, lift,
  // reporting
  gateLoaded, status, statusText,
};
