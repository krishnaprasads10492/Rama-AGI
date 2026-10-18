'use strict';

/**
 * autonomyStop.cjs — the one switch that halts Rāma's autonomous activity.
 *
 * Built FIRST, before anything is autonomous, because a stop retrofitted onto a running loop is the
 * one thing that must not be retrofitted. Section 124's R-L4: *tier-0, tray-reachable, unreachable by
 * any proposal, fail-safe.* SELF_UPGRADE.md §E.2 is the design; this is the narrowed slice of it the
 * orchestrator cut, and what is NOT here is named rather than implied (DEFERRED, below).
 *
 * TWO PREDICATES, AND THE ASYMMETRY IS THE DECISION
 *
 *   isStopped()  governs NEW autonomous action. FAIL-SAFE: absence of configuration means STOPPED.
 *                It has a real consumer: `autonomyGate.fileProposal`, the one chokepoint in this slice.
 *   isHalted()   is the predicate the PRE-EXISTING dispatchers consult (Section 150.2). It is true only
 *                on an EXPLICIT engage (or the env variable), and absence means "exactly the build
 *                master already has". Each of the four named in `PRE_EXISTING[]` returns early from its
 *                SCHEDULED tick while it is true. `PRE_EXISTING[].haltedByEngage` is `true` for each,
 *                and the suite asserts that a halted tick does no work and that every one of them
 *                resumes when the halt is lifted.
 *
 * For autonomy that does not exist yet the safe default is *off*, and absence must mean *off* —
 * nothing is lost because nothing was there. For work that ALREADY RUNS on master's machine the safe
 * default is *unchanged*: `ollama-catalog`, `dependency-review`, the metacognition audit, selfCare's
 * 120-second sweep and marketIntel's two ticks ship and run today, and governing them with the
 * fail-safe predicate would have REMOVED five working behaviours on every install until master
 * hand-created a file nobody had told him about. That is a regression wearing a fail-safe argument,
 * and I11 has no exception for it.
 *
 * WHY A FILE WHOSE PRESENCE GRANTS, RATHER THAN WHOSE PRESENCE FORBIDS
 *
 * A stop-flag means the default state of a fresh install, a wiped profile, a half-written file, a disk
 * error or a permissions change is RUNNING. Fail-safe requires the uncertain state to be the safe one,
 * so the safe state must be the one that needs nothing to be true. `o?.allowed !== true` is strict on
 * purpose: `"true"`, `1`, `{}`, `null`, a directory and a zero-byte file all resolve to stopped.
 *
 * DEPENDENCY-FREE AND SYNCHRONOUS, DELIBERATELY
 *
 * `fs`, `path`, `os` and nothing else at module scope. No `electron`, no `dataStore`, no `cryptoCore`,
 * so this is callable from `before-quit`, from a suite under plain `node`, from a module loaded before
 * the store is unlocked, and from inside a `catch` during a failing boot. A stop that can fail to load
 * is not a stop — `selfRepair.cjs` already made this argument for itself.
 *
 * WHERE THE STATE LIVES, AND WHY OUTSIDE THE REPOSITORY
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
 * HOW THE PRE-EXISTING TIMERS ARE HALTED (Section 150.2): not torn down. They keep firing and each returns
 * early while `isHalted()`, so resuming needs no re-arm and no restart. On-demand IPC handlers are
 * untouched: a stop on what Rāma does by itself is not a stop on what master asks for.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Names, in one place
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

// The two predicates

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

// What each predicate governs. Declared data, printed by the suite

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
          + 'held by every proposals.apply call site sitting inside an ipcMain.handle — two today, '
          + 'electron/ipc/evolutionEngine.cjs and electron/lib/proposals.cjs, with the suite red on a '
          + 'third or on one reached from a timer or a loop. It is NOT an absence of callers: there '
          + 'are two, and the asserted property is where they sit',
  }),
]);

/**
 * The four PRE-EXISTING dispatchers. They ship and run today, so `isStopped()` must never govern them;
 * each consults `isHalted()` in its scheduled tick (Section 150.2). Citations are measured: the suite
 * asserts the symbol still exists (RED if not); a drifted line number is a residual, not a failure.
 */
const PRE_EXISTING = Object.freeze([
  Object.freeze({
    module: 'electron/lib/refreshScheduler.cjs', fn: 'schedule', citedLine: 205,
    work: 'ollama-catalog, dependency-review and every other registered refresh task',
    governedByWhenBuilt: 'isHalted', haltedByEngage: true,
    why: 'the check is in the scheduled timer callback, NOT in runNow, so master\'s own refresh:run still '
       + 'works while autonomy is halted; the next run is rescheduled as normal, so lifting needs no re-arm',
  }),
  Object.freeze({
    module: 'electron/ipc/metaCognition.cjs', fn: 'auditTimer', citedLine: 332,
    work: 'the 10-minute metacognition audit',
    governedByWhenBuilt: 'isHalted', haltedByEngage: true,
    why: 'the interval keeps firing and returns early while halted, so no exported re-arm is needed',
  }),
  Object.freeze({
    module: 'electron/ipc/selfCare.cjs', fn: 'runHealthSweep', citedLine: 203,
    work: 'the 120-second health sweep, including checkInstanceFailover',
    governedByWhenBuilt: 'isHalted', haltedByEngage: true,
    why: 'armed at TWO sites, and both go through the same guarded wrapper; the on-demand selfcare:sweep '
       + 'calls the sweep directly and is deliberately not halted',
  }),
  Object.freeze({
    module: 'electron/ipc/marketIntel.cjs', fn: 'tickResolveOutcomes', citedLine: 731,
    work: 'outcome resolution and news sync (tickSyncNews at 748; timers at 784-785)',
    governedByWhenBuilt: 'isHalted', haltedByEngage: true,
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

// Engaging

/** What "halted" means for the pre-existing work, in one sentence, so every report says the same thing. */
const HALT_HOW = 'the four background dispatchers skip their scheduled work while halted; nothing is '
  + 'torn down, so lifting the halt resumes them without a restart. Your own requests still work.';

/**
 * Engage the halt. No capability check and no `user`: a stop that can be refused is not a stop. It records
 * BEFORE it destroys, so a crash leaves a reason and a still-present allow-file (recoverable).
 * @param {string} reason  why
 * @param {string} by      who or what engaged it
 */
function engage(reason, by = 'unknown') {
  const why = String(reason || '').trim() || 'no reason given';

  // Already halted: a second write would replace `priorAllow` (the only record of who allowed autonomy)
  // with null. A stop any window can reach must not erase that by being pressed twice.
  try {
    const existing = JSON.parse(fs.readFileSync(stoppedRecordPath(), 'utf8'));
    if (existing && typeof existing === 'object') {
      return {
        ok: true, recorded: false, alreadyHalted: true, revoked: false,
        record: existing,
        teardown: { performed: true, how: HALT_HOW },
      };
    }
  } catch { /* no record yet: this is the first engage */ }

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
    teardown: { performed: true, how: HALT_HOW },
  };
}

// Lifting — the only gated direction, and it degrades honestly

/**
 * The ONLY writer of `allowed: true` (spec Section 132): the explicit grant of NEW autonomous action.
 * Refuses, in order: a string `user`, a `user` with no numeric tier, a user without
 * `system.suspend-autonomy` (master only, Section 150.2), an empty note. Nothing calls it: undoing a stop
 * is `resume()`, which grants nothing.
 *
 * ORDERING: allow-file written FIRST, stopped-record removed SECOND, so a crash leaves "allowed but still
 * halted", the recoverable direction. `{capability}` is injectable so the suite runs the real success
 * path; that adds no reach, since `isStopped()` reads a plain file anything in-process could write.
 */
function authoriseLift(user, note, injectedCapability) {
  if (typeof user === 'string') {
    return { refusal: { ok: false, error: `Lifting the stop requires an authenticated user — "${user}" is a label, not an identity` } };
  }
  if (!user || typeof user.tier !== 'number') {
    return { refusal: { ok: false, error: 'Lifting the stop requires an authenticated user' } };
  }
  let capability = injectedCapability;
  if (!capability) {
    try { capability = require('./capability.cjs'); }
    catch { return { refusal: { ok: false, error: 'Lifting the stop requires the capability matrix, which could not be loaded' } }; }
  }

  const denied = capability.deny(user, 'system.suspend-autonomy');
  if (denied) {
    return { refusal: {
      ok: false,
      error: `${denied.error} — lifting the stop needs "system.suspend-autonomy", which only master holds.`,
      missingCapability: 'system.suspend-autonomy',
    } };
  }
  const text = String(note || '').trim();
  if (!text) return { refusal: { ok: false, error: 'Lifting the stop requires a note saying why' } };
  return { text };
}

function lift(user, note, { capability: injectedCapability = null } = {}) {
  const gate = authoriseLift(user, note, injectedCapability);
  if (gate.refusal) return gate.refusal;
  const text = gate.text;

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

/**
 * End a halt WITHOUT granting anything new (Section 150.2). `lift()` writes `allowed: true`, so using it
 * to undo a stop on a default install would move Rāma from "new autonomy stopped" to "allowed". This
 * clears the halt and restores the allow-file ONLY from `priorAllow` (saved by `engage()`), author and
 * note intact; with none, it writes none. Same gate as `lift()` (`authoriseLift`). Restore first, remove
 * the record second, so a crash leaves "allowed but still halted".
 */
function resume(user, note, { capability: injectedCapability = null } = {}) {
  const gate = authoriseLift(user, note, injectedCapability);
  if (gate.refusal) return gate.refusal;

  let record = null;
  try { record = JSON.parse(fs.readFileSync(stoppedRecordPath(), 'utf8')); } catch { record = null; }
  if (!record) {
    return { ok: false, error: 'Autonomy is not halted, so there is nothing to resume',
      notHalted: true, env: envStop() ? `${ENV_KEY}=stop` : null };
  }

  let restored = null;
  const prior = record.priorAllow;
  if (prior && typeof prior === 'object' && prior.allowed === true) {
    restored = {
      ...prior,
      resumedAfterHalt: { by: `${user.name || user.id || 'user'} (tier ${user.tier})`, at: new Date().toISOString(), note: gate.text },
    };
    try {
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.writeFileSync(allowPath(), JSON.stringify(restored, null, 2), 'utf8');
    } catch (err) {
      return { ok: false, error: `could not restore the allow-file: ${err.message}` };
    }
  }

  let haltCleared = false;
  try { fs.unlinkSync(stoppedRecordPath()); haltCleared = true; } catch { haltCleared = false; }

  return {
    ok: true, haltCleared, restoredAllow: restored !== null, allow: restored,
    // The environment variable is outside this module's reach: if it is set the halt is still in force.
    stillHalted: isHalted(), env: envStop() ? `${ENV_KEY}=stop` : null,
  };
}

// Reporting

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
      + `These skip their scheduled work while it lasts: ${names}. ${HALT_HOW}`
    : `Still running on their own schedule, exactly as before: ${names}.`;

  const third = 'Resuming is master only: it needs the "system.suspend-autonomy" capability and a written '
    + 'note, from a signed-in session.';

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
  engage, lift, resume,
  // reporting
  gateLoaded, status, statusText,
};
