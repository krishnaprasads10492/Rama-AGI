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

const path = require('path');
const { createRequire } = require('module');

const failures = [];

/**
 * WHERE RELATIVE PATHS RESOLVE FROM — the bug that broke every launch.
 *
 * `main.cjs` calls `safeRequire('./ipc/system.cjs')`. That path is relative to
 * `electron/`, because that is where the caller lives. But this file is in
 * `electron/lib/`, and a bare `require(id)` inside it resolves relative to **this**
 * file — so it looked for `electron/lib/ipc/system.cjs` and found nothing.
 *
 * Every one of the 39 guarded requires therefore failed, and because a failed load
 * returns an inert stub whose `register()` is a silent no-op, the app started with 13
 * IPC channels instead of ~257 and no `session:*` at all. The visible symptom was
 * "No handler registered for 'session:unlock'".
 *
 * It had been broken since the refactor that introduced this file, and stayed hidden
 * because nothing verified that the app actually launched afterwards — every ledger
 * row since carries the note "not verified: that the installed app launches". A
 * guard that silently swallows its own misuse is worse than no guard: the stubs made
 * a total failure look like a partial one.
 *
 * Resolution is now anchored to `electron/`, and `main.cjs` additionally hands over
 * its own `require` so the anchor is the caller's rather than an assumption.
 */
let _require = createRequire(path.join(__dirname, '..', 'main.cjs'));

/**
 * Adopt the caller's `require`, so relative ids resolve from the caller's directory.
 * @param {NodeRequire} callerRequire
 */
function useRequire(callerRequire) {
  if (typeof callerRequire === 'function') _require = callerRequire;
}

/**
 * Make previously-repaired modules resolvable.
 *
 * DELIBERATELY NOT CALLED FROM `safeRequire`. It used to be, on the reasoning that a
 * module repaired in a previous session should already be resolvable — which is
 * true, but doing module-path surgery in the middle of `main.cjs`'s require chain
 * turned out to be how a packaged build lost every one of its engines: the old
 * implementation called `Module._initPaths()`, which recomputes search paths from
 * scratch and discards Electron's asar-aware entries, so every require after the
 * first one failed. See Section 62.
 *
 * The implementation is now non-destructive, but the timing was the second half of
 * the mistake and is not being reinstated. This is invoked once from `whenReady`,
 * after every engine has already loaded, where a repaired module is picked up by
 * `retryFailures()` anyway.
 */
function ensureRepairPath() {
  try { return require('./selfRepair.cjs').registerRepairPath(); }
  catch (e) { return { ok: false, error: e.message }; }
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
  // No module-path manipulation here — see ensureRepairPath's note. This function
  // runs dozens of times during the module-scope require chain and must do nothing
  // but require and catch.
  try {
    return _require(id);
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
      _require(f.id);
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

module.exports = { safeRequire, loadFailures, isStub, retryFailures, ensureRepairPath, useRequire };
