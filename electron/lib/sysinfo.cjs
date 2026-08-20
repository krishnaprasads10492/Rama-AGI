'use strict';

/**
 * sysinfo.cjs — optional `systeminformation`, with a Node-only fallback.
 *
 * THE PROBLEM THIS SOLVES: `systeminformation` is classified by the launcher as a
 * *degrading* dependency — missing it should cost thermal/GPU/process detail, not
 * the app. But it was required at the top of `system.cjs` and
 * `resourceOrchestrator.cjs`, both of which `main.cjs` requires at load. So an
 * absent optional module threw during main-process startup and took everything
 * down. The classification said "degraded" while the code said "fatal".
 *
 * Now the require is guarded, and the metrics that Node can produce on its own
 * (`os`) are still produced. Level 0 of this capability needs nothing installed —
 * the same rule the voice ladder follows (spec section 30).
 *
 * What the fallback can and cannot do, honestly:
 *   CAN  — cpu load (from os.cpus times), core count and per-core load, total and
 *          free memory, platform, release, arch, hostname, uptime
 *   CANNOT — cpu temperature, GPU, battery, per-process list, per-interface
 *          network rates, filesystem throughput. These report null/[] and say so.
 */

const os = require('os');

let _si = null;
let _siError = null;

try {
  _si = require('systeminformation');
  // On Windows, systeminformation shells out to a fresh powershell.exe for
  // most calls (cpuTemperature, battery, osInfo, graphics, fsStats,
  // networkStats) unless a persistent PowerShell session is kept open.
  // Measured on a real machine: 2-13 SECONDS per call without this, vs.
  // 100-800ms once the session is warm. `system.cjs`'s get-metrics fires 8
  // of these calls, polled every 2-5s by the UI — without a persistent
  // session, calls take longer than the poll interval, so results arrive
  // stale and out of order, which is what "resource status doesn't reflect
  // properly" actually was. `si.powerShellRelease()` is intentionally never
  // called — the session is meant to live for the app's lifetime; main.cjs's
  // before-quit handler is the only place this should ever be torn down.
  if (process.platform === 'win32' && typeof _si.powerShellStart === 'function') {
    try { _si.powerShellStart(); }
    catch (err) { console.warn('[sysinfo] powerShellStart failed — falling back to per-call spawn:', err.message); }
  }
} catch (err) {
  _siError = err.message;
  console.warn('[sysinfo] systeminformation unavailable — using the Node fallback:', err.message);
}

/** Called once from main.cjs's before-quit handler — releases the persistent
 * PowerShell session so it doesn't outlive the app. */
function shutdown() {
  if (_si && process.platform === 'win32' && typeof _si.powerShellRelease === 'function') {
    try { _si.powerShellRelease(); } catch { /* best effort on the way out */ }
  }
}

const available = () => _si !== null;

/** @returns {{available:boolean, reason?:string, hint?:string}} */
function status() {
  return available()
    ? { available: true }
    : {
        available: false,
        reason: _siError ?? 'systeminformation not installed',
        hint: 'npm install systeminformation — restores CPU temperature, GPU, battery, '
            + 'process list and per-interface network rates',
      };
}

// ─── CPU load from os.cpus() ──────────────────────────────────────────────────
// os.cpus() gives cumulative tick counters, so load is the delta between two
// samples. A single reading tells you nothing.
//
// WHY THIS TAKES ITS OWN TWO SAMPLES RATHER THAN KEEPING A MODULE-LEVEL BASELINE:
// it used to retain `_prevTicks` in module scope, which looked cheaper and was
// wrong for two measured reasons.
//
//   1. The first call had no baseline, so it returned 0 and set `firstSample:
//      true` — but no caller ever read that flag. `system.cjs` shipped the zero
//      as though it were a reading.
//   2. One baseline was shared by three independent pollers: the titlebar every
//      5s, the System page every 5s, and resourceOrchestrator. Whichever called
//      second saw a `totalDelta` of nearly nothing — often <= 0 — and got 0% per
//      core. With three consumers on one baseline, "CPU 0%" was the *expected*
//      output of this design, not an anomaly.
//
// Sampling a fixed window inside the call is self-contained: no shared state, no
// race between callers, no meaningless first reading. The cost is the sample
// window itself, which is negligible against a 2-5s poll.
const CPU_SAMPLE_MS = 120;

function sampleTicks() {
  return os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

async function cpuLoadFallback() {
  const before = sampleTicks();
  await new Promise(r => setTimeout(r, CPU_SAMPLE_MS));
  const after = sampleTicks();

  if (before.length !== after.length || after.length === 0) {
    // Core count changed under us, or os.cpus() gave nothing. Say so rather
    // than reporting a fabricated zero that looks like an idle machine.
    return { currentLoad: null, cpus: [], measured: false };
  }

  const cores = after.map((c, i) => {
    const idleDelta  = c.idle  - before[i].idle;
    const totalDelta = c.total - before[i].total;
    // A window this short can legitimately record no ticks on an idle core.
    if (totalDelta <= 0) return { load: 0 };
    return { load: Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100)) };
  });

  const avg = cores.reduce((a, c) => a + c.load, 0) / cores.length;
  return { currentLoad: avg, cpus: cores, measured: true };
}

// ─── Uniform accessors ────────────────────────────────────────────────────────
// Each mirrors the systeminformation call it replaces, so callers need no branch.

async function currentLoad() {
  if (_si) return _si.currentLoad().catch(() => cpuLoadFallback());
  return cpuLoadFallback();
}

async function mem() {
  if (_si) {
    return _si.mem().catch(() => memFallback());
  }
  return memFallback();
}

function memFallback() {
  const total = os.totalmem();
  const free  = os.freemem();
  return {
    total,
    free,
    used:      total - free,
    available: free,
    swaptotal: 0,   // not exposed by Node
    swapused:  0,
  };
}

async function cpuTemperature() {
  if (_si) return _si.cpuTemperature().catch(() => ({ main: null, cores: [] }));
  return { main: null, cores: [] };   // genuinely unavailable without a native probe
}

async function battery() {
  if (_si) return _si.battery().catch(() => ({ hasBattery: false }));
  return { hasBattery: false };
}

async function osInfo() {
  if (_si) return _si.osInfo().catch(() => osInfoFallback());
  return osInfoFallback();
}

function osInfoFallback() {
  return {
    platform: os.platform(),
    distro:   os.type(),
    release:  os.release(),
    arch:     os.arch(),
    hostname: os.hostname(),
  };
}

async function graphics() {
  if (_si) return _si.graphics().catch(() => ({ controllers: [] }));
  return { controllers: [] };
}

async function networkStats() {
  if (_si) return _si.networkStats().catch(() => []);
  return [];   // Node exposes interfaces but not throughput
}

async function fsStats() {
  if (_si) return _si.fsStats().catch(() => ({ rx_sec: null, wx_sec: null }));
  return { rx_sec: null, wx_sec: null };
}

async function fsSize() {
  if (_si) return _si.fsSize().catch(() => []);
  return [];
}

async function processes() {
  if (_si) return _si.processes().catch(() => ({ list: [] }));
  return { list: [] };   // no portable way to enumerate processes from Node alone
}

async function networkConnections() {
  if (_si) return _si.networkConnections().catch(() => []);
  return [];   // requires netstat parsing; not attempted in the fallback
}

/** Interfaces are answerable from Node even without systeminformation. */
function networkInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces() ?? {})) {
    for (const a of addrs ?? []) {
      if (a.internal) continue;
      out.push({ iface: name, ip4: a.family === 'IPv4' ? a.address : null, mac: a.mac });
    }
  }
  return out;
}

/** Static CPU description — always answerable from Node. */
function cpuInfo() {
  const cpus = os.cpus();
  return {
    cores:  cpus.length,
    model:  cpus[0]?.model?.trim() ?? 'unknown',
    speed:  cpus[0]?.speed ?? 0,
    loadavg: os.loadavg(),
  };
}

module.exports = {
  available, status, shutdown,
  currentLoad, mem, cpuTemperature, battery, osInfo,
  graphics, networkStats, networkConnections, networkInterfaces,
  fsStats, fsSize, processes,
  cpuInfo, uptime: () => Math.floor(os.uptime()),
  // Escape hatch for the few call sites that need something not wrapped above.
  raw: () => _si,
};
