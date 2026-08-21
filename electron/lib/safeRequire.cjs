'use strict';

/**
 * safeRequire.cjs — load a subsystem without betting the whole app on it.
 *
 * WHY: `main.cjs` opens with ~45 module-scope requires, every one unguarded. A
 * throw from any of them — or from anything they transitively require — kills the
 * process before `app.whenReady()`, which is where every one of Rāma's own
 * diagnostics is registered. One absent transitive package (`debug`, via
 * `simple-git`, via four separate modules) took down an app whose 30-odd other
 * capabilities were perfectly intact.
 *
 * That is the opposite of invariant I11 — "upgrades are additive; every engine
 * has a working fallback". The fallbacks existed *inside* the engines
 * (`sysinfo.cjs` guards `systeminformation`, `vectorMemory` falls back to keyword
 * search) but the require itself was still fatal, so the fallback never got a
 * chance to run. This closes that gap at the loading boundary.
 *
 * WHAT A FAILED LOAD RETURNS: an inert stub, not null. Callers in `whenReady` do
 * `engine.register(ipcMain)` unconditionally, so returning null would convert a
 * missing module into `TypeError: Cannot read properties of null` — the same
 * crash with a worse message. The stub answers any method call with a refusal
 * object shaped like every other IPC response (`{ok:false, error}`), so a
 * degraded engine reports honestly to the renderer instead of exploding.
 *
 * NOT USED FOR: `electron`, `path`, `fs`. If those are broken there is no app to
 * degrade into, and pretending otherwise would hide a genuinely fatal condition.
 */

const failures = [];

// Registered once, before the first guarded require, so a module repaired in a
// previous session is already resolvable this time without any further work.
let repairPathReady = false;
function ensureRepairPath() {
  if (repairPathReady) return;
  repairPathReady = true;
  try { require('./selfRepair.cjs').registerRepairPath(); }
  catch { /* repair is an enhancement; its absence must not break loading */ }
}

/**
 * A stand-in for an engine that could not load.
 *
 * `register` is a no-op so startup completes. Every other property resolves to a
 * function returning a refusal, so an IPC call routed to a dead engine produces a
 * message master can read rather than an unhandled TypeError.
 */
function makeStub(name, reason) {
  const refusal = () => ({
    ok: false,
    error: `${name} is unavailable in this installation (${reason})`,
    degraded: true,
  });

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === '__ramaStub')  return true;
      if (prop === '__ramaError') return reason;
      if (prop === 'register')    return () => undefined;   // startup must continue
      if (prop === 'then')        return undefined;         // never look thenable
      if (typeof prop === 'symbol') return undefined;
      return refusal;
    },
    has() { return true; },
  });
}

/**
 * @param {string} id        module path, as passed to require()
 * @param {string} [label]   human name for reports; defaults to the id's basename
 * @returns {any} the module, or an inert stub that reports its own absence
 */
function safeRequire(id, label) {
  const name = label ?? String(id).replace(/^.*[\\/]/, '').replace(/\.cjs$/, '');
  ensureRepairPath();
  try {
    return require(id);
  } catch (err) {
    const missing = err?.code === 'MODULE_NOT_FOUND'
      ? (String(err.message).match(/cannot find module ['"]([^'"]+)['"]/i)?.[1] ?? null)
      : null;

    const reason = missing ? `missing module "${missing}"` : (err?.message ?? String(err));

    failures.push({
      id, name, reason, missing,
      code: err?.code ?? null,
      requireStack: Array.isArray(err?.requireStack) ? err.requireStack.slice(0, 6) : [],
    });

    // console.warn, not log — this project ships no console.log, and this is a
    // genuine degradation master should be able to see in the terminal.
    console.warn(`[safeRequire] ${name} did not load (${reason}) — continuing without it`);

    // Remembered so the startup doctor can ask selfRepair to fetch it. Repair is
    // deliberately NOT attempted inline here: this runs during the module-scope
    // require chain, before app.whenReady(), where a network round trip would
    // stall startup for every subsequent engine. The app comes up degraded first,
    // then repairs, then reports — which is faster to a usable window and honest
    // about what happened in between.
    return makeStub(name, reason);
  }
}

/**
 * Retry the loads that failed, after repair has had a chance to fetch what was
 * missing. Called by the startup doctor once the app is ready.
 *
 * @returns {{recovered:string[], stillMissing:string[]}}
 */
function retryFailures() {
  const recovered = [];
  const stillMissing = [];
  for (const f of failures) {
    try {
      require(f.id);
      recovered.push(f.name);
    } catch {
      stillMissing.push(f.name);
    }
  }
  return { recovered, stillMissing };
}

/** Everything that failed to load this run. Feeds the startup health report. */
function loadFailures() {
  return failures.slice();
}

/** Did a specific subsystem load? Used by the doctor to describe capability loss. */
function isStub(mod) {
  try { return !!mod?.__ramaStub; } catch { return false; }
}

module.exports = { safeRequire, loadFailures, isStub, retryFailures };
