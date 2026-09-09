'use strict';

/**
 * refreshScheduler.cjs — one place that knows what Rāma does on a timer (spec Section 96).
 *
 * Master: *"Online search is a regular thing at a set interval to keep RAMA up to date… It applies to
 * existing ones and also future ones and even when Rāma creates modules as per master's orders."*
 *
 * WHY A REGISTRY AND NOT A SECOND TIMER SYSTEM. Section 71 already schedules work inside
 * `marketIntel.cjs`, privately, with its own timers and constants. Adding another would mean two
 * places deciding when work happens, two places to disable it, and no single answer to "what is Rāma
 * doing in the background". A module here declares a task; the scheduler owns when it runs.
 *
 * The clock and the store are injected, so every behaviour below is testable without waiting.
 */

const DOMAIN = 'config';
const KEY = 'refreshTasks';

/** Spread due tasks over this window at startup instead of firing them together. */
const STARTUP_SPREAD_MS = 90_000;

/** Random fraction of the interval added to each run, so many installs do not sync up. */
const JITTER_FRAC = 0.1;

/** Consecutive-failure backoff, multiplicative, capped so a broken task still retries eventually. */
const BACKOFF_BASE = 2;
const BACKOFF_MAX_MULT = 32;

const tasks = new Map();        // name → task definition
let injectedStore = null;
let timers = new Map();         // name → timeout handle
let running = false;

function useStore(store) { injectedStore = store; }

function ds() {
  if (injectedStore) return injectedStore;
  return require('../dataStore.cjs');
}

function readState() {
  try {
    const raw = ds().get(DOMAIN, KEY);
    return (raw && typeof raw === 'object') ? raw : {};
  } catch { return {}; }
}

function writeState(state) {
  try {
    ds().set(DOMAIN, KEY, state);
    ds().saveDomain?.(DOMAIN);
  } catch { /* a scheduler that cannot persist still runs; it just re-runs sooner after a restart */ }
}

/**
 * Declare a repeating task.
 *
 * @param {object}   def
 * @param {string}   def.name        stable id; also the persistence key
 * @param {string}   def.label       what master would call it
 * @param {number}   def.intervalMs
 * @param {function} def.run         `() => Promise<{ok:boolean, ...}>`
 * @param {string}   [def.capability] capability the task's action requires
 * @param {boolean}  [def.enabled]
 *
 * `capability` is recorded so a scheduled action cannot quietly exceed what its owning feature is
 * allowed to do when invoked by hand. The scheduler does not itself hold a user, so a task needing a
 * capability must carry its own authorisation decision — recording it here makes that visible in one
 * list rather than buried in each task.
 */
function register(def = {}) {
  const { name, label, intervalMs, run, capability = null, enabled = true } = def;
  if (!name || typeof run !== 'function' || !(intervalMs > 0)) {
    return { ok: false, error: 'name, intervalMs and run are required' };
  }
  tasks.set(name, {
    name,
    label: label || name,
    intervalMs,
    run,
    capability,
    enabled: enabled !== false,
  });
  return { ok: true, name };
}

function unregister(name) {
  const t = timers.get(name);
  if (t) { clearTimeout(t); timers.delete(name); }
  return tasks.delete(name);
}

/** Multiplier applied to the interval after `failures` consecutive failures. */
function backoffMultiplier(failures) {
  if (!failures || failures <= 0) return 1;
  return Math.min(BACKOFF_MAX_MULT, BACKOFF_BASE ** failures);
}

/**
 * When is this task next due?
 *
 * A task that ran an hour ago is NOT due again merely because the process restarted — that is the
 * whole reason last-run times are persisted. Without it, every restart triggers every task, and a
 * machine that is opened and closed often would refresh constantly.
 */
function dueAt(task, state, now) {
  const s = state[task.name] || {};
  const last = Number(s.lastRunAt) || 0;
  const mult = backoffMultiplier(s.failures);
  if (!last) return now;                      // never run: due immediately
  return last + task.intervalMs * mult;
}

function isDue(task, state, now) {
  return dueAt(task, state, now) <= now;
}

/**
 * Run one task now, recording the outcome.
 *
 * Never throws. A background task that can crash the scheduler takes every other task down with it,
 * so a thrown error is recorded as a failure and the loop continues.
 */
async function runNow(name, { now = Date.now() } = {}) {
  const task = tasks.get(name);
  if (!task) return { ok: false, error: `no task named ${name}` };

  const state = readState();
  const prev = state[name] || {};
  let result;
  try {
    result = await task.run();
    if (!result || result.ok !== false) {
      state[name] = {
        lastRunAt: now,
        lastOk: true,
        failures: 0,
        lastNote: result?.note ?? null,
      };
    } else {
      state[name] = {
        lastRunAt: now,
        lastOk: false,
        failures: (Number(prev.failures) || 0) + 1,
        lastError: result.error || 'task reported failure',
      };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
    state[name] = {
      lastRunAt: now,
      lastOk: false,
      failures: (Number(prev.failures) || 0) + 1,
      lastError: err.message,
    };
  }
  writeState(state);
  return result;
}

/**
 * Start the schedule.
 *
 * @param {object}   opts
 * @param {function} [opts.setTimer]  injected `setTimeout`, for tests
 * @param {function} [opts.now]
 * @param {function} [opts.random]    injected for deterministic jitter in tests
 *
 * DUE TASKS ARE SPREAD, NOT FIRED TOGETHER. Ten tasks all due at launch would mean ten simultaneous
 * network calls the moment Rāma opens: slow, indistinguishable from abuse to a rate limiter, and it
 * makes unrelated startup failures interdependent.
 */
function start({ setTimer = setTimeout, now = Date.now, random = Math.random } = {}) {
  if (running) return { ok: true, already: true };
  if (process.env.RAMA_DISABLE_REFRESH === '1') {
    return { ok: false, disabled: true, reason: 'RAMA_DISABLE_REFRESH=1' };
  }
  running = true;

  const state = readState();
  const enabled = [...tasks.values()].filter(t => t.enabled);
  const dueCount = enabled.filter(t => isDue(t, state, now())).length;
  let placed = 0;

  for (const task of enabled) {
    const t0 = now();
    let delay;
    if (isDue(task, state, t0)) {
      // Spread across the startup window, evenly by position, so the order is stable.
      const slot = dueCount > 1 ? (placed / (dueCount - 1)) : 0;
      delay = Math.round(slot * STARTUP_SPREAD_MS);
      placed += 1;
    } else {
      delay = Math.max(0, dueAt(task, state, t0) - t0);
    }
    // Jitter, so many installs do not converge on the same second.
    delay += Math.round(task.intervalMs * JITTER_FRAC * random());
    schedule(task.name, delay, { setTimer, now, random });
  }

  return { ok: true, tasks: enabled.length, due: dueCount };
}

function schedule(name, delay, deps) {
  const handle = deps.setTimer(async () => {
    await runNow(name, { now: deps.now() });
    const task = tasks.get(name);
    if (!task || !task.enabled || !running) return;
    const state = readState();
    const s = state[name] || {};
    const next = task.intervalMs * backoffMultiplier(s.failures)
      + Math.round(task.intervalMs * JITTER_FRAC * deps.random());
    schedule(name, next, deps);
  }, delay);
  if (handle && typeof handle.unref === 'function') handle.unref();
  timers.set(name, handle);
}

function stop() {
  for (const h of timers.values()) clearTimeout(h);
  timers = new Map();
  running = false;
  return { ok: true };
}

/**
 * What is Rāma doing on a timer, and is any of it failing?
 *
 * Failure counts are reported rather than left in logs, so "this has failed 40 times" is a visible
 * fact. `staleness` is the honest question master would ask: how long since this last succeeded.
 */
function status({ now = Date.now() } = {}) {
  const state = readState();
  return {
    running,
    tasks: [...tasks.values()].map(t => {
      const s = state[t.name] || {};
      return {
        name: t.name,
        label: t.label,
        capability: t.capability,
        enabled: t.enabled,
        intervalMs: t.intervalMs,
        lastRunAt: s.lastRunAt ?? null,
        lastOk: s.lastOk ?? null,
        failures: Number(s.failures) || 0,
        lastError: s.lastError ?? null,
        nextDueAt: dueAt(t, state, now),
        overdue: isDue(t, state, now),
        // A task backing off is a different state from one simply not yet due.
        backingOff: backoffMultiplier(s.failures) > 1,
      };
    }),
  };
}

/** Test seam: forget every task and every timer. */
function reset() {
  stop();
  tasks.clear();
}

module.exports = {
  register, unregister, start, stop, runNow, status, reset, useStore,
  dueAt, isDue, backoffMultiplier,
  DOMAIN, KEY, STARTUP_SPREAD_MS, JITTER_FRAC, BACKOFF_MAX_MULT,
};
