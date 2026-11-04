'use strict';

// `systeminformation` is optional: the launcher classifies it as degrading, not
// blocking. Requiring it directly here made an absent optional module crash the
// whole main process. lib/sysinfo.cjs guards the require and falls back to Node's
// own `os` for everything Node can answer. See spec section 33.
const si    = require('../lib/sysinfo.cjs');
const os    = require('os');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const capability = require('../lib/capability.cjs');

let streamInterval = null;

// ─── Register all system IPC handlers ────────────────────────────────────────
function register(ipcMain) {

  // ── What Rāma itself is using, separate from total system load ──────────
  // Master asked for the System page to show real machine-wide metrics AND
  // what's due to Rāma specifically, in foreground and background. Two
  // sources, combined honestly rather than guessed:
  //   1. app.getAppMetrics() — Electron's own accounting for every process
  //      IT spawned directly: main, every renderer (foreground window),
  //      GPU, and utility processes. Real per-process CPU%/memory, no
  //      estimation.
  //   2. Rāma's own EXTERNAL child processes that Electron doesn't count
  //      because they're spawned via plain child_process, not Electron's
  //      process model: the Python prediction backend (aiProcess.cjs),
  //      any open terminal PTY sessions (terminal.cjs), and the Playwright
  //      browser (browserEngine.cjs) if launched. Their PIDs are looked up
  //      in the live systeminformation process list for real CPU/RAM
  //      numbers — never estimated, and reported as "process not found"
  //      rather than silently omitted if a PID has already exited.
  ipcMain.handle('system:get-own-footprint', async () => {
    try {
      const { app } = require('electron');
      const electronProcs = app.getAppMetrics().map(m => ({
        pid:     m.pid,
        type:    m.type,             // Browser | Renderer | GPU | Utility | ...
        cpuPct:  m.cpu?.percentCPUUsage ?? null,
        memKB:   m.memory?.workingSetSize ?? null,
        source:  'electron',
      }));

      // External child processes Electron's own accounting doesn't see.
      // Each getter is best-effort and guarded — a module not loaded yet
      // (e.g. no Python backend ever started) must not fail this handler.
      const externalPids = [];
      try {
        const ai = require('./aiProcess.cjs').getRunningStatus?.();
        if (ai?.python?.pid) externalPids.push({ pid: ai.python.pid, label: 'AI backend (Python)' });
      } catch { /* aiProcess not loaded */ }
      try {
        const term = require('./terminal.cjs');
        for (const [id, session] of Object.entries(term.getSessionPids?.() ?? {})) {
          externalPids.push({ pid: session, label: `Terminal ${id}` });
        }
      } catch { /* terminal not loaded */ }
      try {
        const browser = require('./browserEngine.cjs');
        const bpid = browser.getBrowserPid?.();
        if (bpid) externalPids.push({ pid: bpid, label: 'Browser automation (Playwright)' });
      } catch { /* browserEngine not loaded */ }

      let externalProcs = [];
      if (externalPids.length > 0) {
        try {
          const { list } = await si.processes();
          externalProcs = externalPids.map(({ pid, label }) => {
            const found = list.find(p => p.pid === pid);
            return found
              ? { pid, label, cpuPct: parseFloat(found.cpu?.toFixed?.(1) ?? found.cpu ?? 0), memKB: found.memRss ?? null, source: 'external', found: true }
              : { pid, label, cpuPct: null, memKB: null, source: 'external', found: false };
          });
        } catch {
          externalProcs = externalPids.map(({ pid, label }) => ({ pid, label, cpuPct: null, memKB: null, source: 'external', found: null }));
        }
      }

      const all = [...electronProcs, ...externalProcs];
      const totalCpuPct = all.reduce((s, p) => s + (p.cpuPct || 0), 0);
      const totalMemMB  = Math.round(all.reduce((s, p) => s + (p.memKB || 0), 0) / 1024);

      return {
        ok: true,
        data: {
          processes: all,
          totals: { cpuPct: Math.round(totalCpuPct * 10) / 10, memMB: totalMemMB },
          note: 'CPU% here is per-process, not normalized against total system capacity the way the machine-wide gauge is — compare against the machine-wide CPU% for scale, not as an exact fraction of it.',
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Full metrics snapshot ────────────────────────────────────────────────
  ipcMain.handle('system:get-metrics', async () => {
    try {
      /**
       * EVERY PROBE FAILS ALONE (spec Section 98).
       *
       * This used `Promise.all`, so a single rejecting probe discarded the entire snapshot and the
       * titlebar showed no CPU or RAM at all. The flaky ones are precisely the ones that are optional:
       * `battery()` on a desktop with no battery, `cpuTemperature()` and `graphics()` where WMI is
       * restricted by endpoint security — which is the case on this very machine — and `fsStats()`
       * on some volumes.
       *
       * So CPU and RAM, which almost always succeed, were being thrown away because an unrelated GPU
       * or battery reading failed. `allSettled` keeps what worked, and a missing section reports as
       * absent rather than taking the rest down with it — the same rule Section 93 applied to the two
       * Ollama documents.
       */
      const settle = async (label, fn) => {
        try { return { label, ok: true, value: await fn() }; }
        catch (err) { return { label, ok: false, error: err.message, value: null }; }
      };

      const results = await Promise.all([
        settle('cpu', () => si.currentLoad()),
        settle('mem', () => si.mem()),
        settle('temp', () => si.cpuTemperature()),
        settle('battery', () => si.battery()),
        settle('os', () => si.osInfo()),
        settle('graphics', () => si.graphics()),
        settle('net', () => si.networkStats()),
        settle('disk', () => si.fsStats()),
      ]);

      const by = {};
      const probeErrors = [];
      for (const r of results) {
        // `?? {}` so every read below is safe on a failed probe without a guard at each site.
        by[r.label] = r.value ?? {};
        if (!r.ok) probeErrors.push({ probe: r.label, error: r.error });
      }

      const cpu = by.cpu;
      const mem = by.mem;
      const temp = by.temp;
      const battery = by.battery;
      const os_info = by.os;
      const graphics = by.graphics;
      const net = Array.isArray(by.net) ? by.net : [];
      const disk = Array.isArray(by.disk) ? by.disk : (by.disk ?? {});

      return {
        ok: true,
        data: {
          cpu: {
            // null, not 0, when the load could not actually be measured.
            // Math.round(null) is 0, which is indistinguishable from a genuinely
            // idle machine — the UI needs to be able to tell those apart and say
            // "no reading" instead of confidently displaying 0%.
            usage:       typeof cpu.currentLoad === 'number' ? Math.round(cpu.currentLoad) : null,
            cores:       cpu.cpus?.map(c => Math.round(c.load)) ?? [],
            temp:        temp.main ?? null,
            tempCores:   temp.cores ?? [],
          },
          ram: {
            total:     mem.total,
            used:      mem.used,
            available: mem.available,
            swapTotal: mem.swaptotal,
            swapUsed:  mem.swapused,
            // null, not 0 or NaN, when the probe failed. `Math.round(NaN)` is NaN, which React
            // renders as nothing at all — indistinguishable from the pill simply not being there,
            // which is exactly the symptom master reported.
            usedPct:   (typeof mem.used === 'number' && typeof mem.total === 'number' && mem.total > 0)
              ? Math.round((mem.used / mem.total) * 100)
              : null,
          },
          gpu: graphics.controllers?.map(g => ({
            model:    g.model,
            vendor:   g.vendor,
            vram:     g.vram,
            usage:    g.utilizationGpu ?? null,
            temp:     g.temperatureGpu ?? null,
          })) ?? [],
          network: net.map(n => ({
            iface:  n.iface,
            rxSec:  n.rx_sec,
            txSec:  n.tx_sec,
          })),
          disk: {
            readSec:  disk.rx_sec,
            writeSec: disk.wx_sec,
          },
          battery: battery.hasBattery ? {
            percent:    battery.percent,
            charging:   battery.isCharging,
            timeLeft:   battery.timeRemaining,
          } : null,
          os: {
            platform:  os_info.platform,
            distro:    os_info.distro,
            release:   os_info.release,
            arch:      os_info.arch,
            hostname:  os_info.hostname,
            uptime:    Math.floor(os.uptime()),
          },
          // Reported rather than swallowed: "GPU unavailable because WMI is restricted" is a
          // different situation from "this machine has no GPU", and only the probe knows which.
          probeErrors,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Process list ─────────────────────────────────────────────────────────
  // Enumerates every process on the machine (name, pid, owning user) — more
  // sensitive than the aggregate CPU/RAM numbers get-metrics returns, so this
  // gates on os.process-list (tier 2) rather than staying open to Viewer.
  ipcMain.handle('system:get-processes', async (_e, { user } = {}) => {
    const denied = capability.deny(user, 'os.process-list');
    if (denied) return denied;
    try {
      const { list } = await si.processes();
      const sorted = list
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 100)
        .map(p => ({
          pid:    p.pid,
          name:   p.name,
          cpu:    parseFloat(p.cpu.toFixed(1)),
          mem:    parseFloat(p.memRss ? (p.memRss / 1024 / 1024).toFixed(1) : '0'),
          state:  p.state,
          user:   p.user,
        }));
      return { ok: true, data: sorted };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Helpers for the tree-wide scan (spec Section 181) ────────────────────
  //
  // `npm audit` is the only readily available thing that resolves the INSTALLED TREE, which is what
  // the manifest-shaped OSV pass cannot see. It is read-only, and it exits NON-ZERO whenever it
  // finds anything — so a non-zero status is the normal case here and the JSON still arrives on
  // stdout. Treating that exit code as failure is how a tree scan quietly becomes no scan.
  //
  // Passed as ONE command string, not an args array with a shell, per DEP0190 (Section 179).
  const auditReport = () => new Promise((resolve) => {
    exec('npm audit --json', { cwd: path.join(__dirname, '..', '..'), maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000, windowsHide: true }, (_err, stdout) => {
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });

  /**
   * Versions actually on disk, which is what makes a DOWNGRADE detectable.
   *
   * Without this the triage cannot tell an upgrade from npm's occasional suggestion to install an
   * older release, and reports `unknown` rather than guessing — so supplying it is what turns that
   * class of finding from unknown into refused.
   */
  const installedVersions = (own) => {
    const root = path.join(__dirname, '..', '..');
    const out = {};
    const names = new Set([
      ...Object.keys(own.dependencies || {}),
      ...Object.keys(own.devDependencies || {}),
    ]);
    for (const n of names) {
      try {
        out[n] = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version;
      } catch { /* not installed at the top level; the triage reports that honestly */ }
    }
    return out;
  };

  // ── Dependency and vulnerability review (spec Section 180) ───────────────
  //
  // THE HANDLER THAT WAS MISSING. `preload.cjs` has exposed `deps:review` to the renderer since
  // Section 96, and nothing ever answered it: `registrySources.collect` (the OSV advisory lookup)
  // and `dependencyAdvisor.review` (the judgement) were both called only by their test suites. The
  // search and the assessment were built, verified, and unreachable — the same defect as
  // `models:roles` in Section 145 and `functionTracking`'s three sections with no call sites.
  //
  // IT PROPOSES AND NEVER UPGRADES. I12 pins every dependency deliberately, so this reports what is
  // vulnerable, what a fix would cost and what could go wrong, and leaves the decision in the
  // approval ledger. Section 168.2's ruling applies verbatim: "auto-check" means auto-REPORT.
  //
  // Tier 0 only (`system.self-update`): the output names Rāma's own attack surface, which is not a
  // thing to hand to a guest.
  //
  // Both fetchers come from `lib/http.cjs` — the ONE main-process client (I9) — so this inherits its
  // circuit breaker, size cap and timeouts rather than opening a second way out of the process.
  ipcMain.handle('deps:review', async (_e, { user, includeDev = false } = {}) => {
    const denied = capability.deny(user, 'system.self-update');
    if (denied) return denied;
    try {
      const http = require('../lib/http.cjs');
      const sources = require('../lib/registrySources.cjs');
      const advisor = require('../lib/dependencyAdvisor.cjs');

      const own = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
      // devDependencies are opt-in: they do not ship, so their advisories are a build-machine
      // risk rather than an installed-app one, and mixing the two would overstate the exposure.
      const pinned = { ...(own.dependencies || {}) };
      if (includeDev) Object.assign(pinned, own.devDependencies || {});

      const { rows, failures } = await sources.collect({
        pinned,
        getJson: http.getJson,
        // Supplied, so advisories are genuinely CHECKED. Without it `registrySources` leaves them
        // `unchecked`, which the advisor correctly refuses to read as "clean".
        postJson: http.postJson,
      });

      const review = advisor.review(rows);

      // ── COVERAGE, STATED. This scan cannot report "clean" and must not be read that way ───────
      //
      // MEASURED on 2026-11-04, not estimated: `npm audit` found 20 advisories while this pipeline
      // found 0. Two independent reasons, and both are properties of the design rather than bugs:
      //
      //   1. It asks only about DIRECT dependencies — 24 names against 402+ installed packages. Of
      //      the 20 packages npm flagged, 3 were direct and 17 were transitive, so most advisories
      //      are outside the question being asked.
      //   2. OSV answers per PACKAGE. `vectra@0.9.0` has no advisory of its own; the exposure is in
      //      the `openai`/`axios` chain beneath it. So even a direct dependency can come back clean
      //      while being the route to a high-severity finding.
      //
      // A security report whose zero means "I did not look there" is the comfortable lie Section
      // 170 D4 forbids, so the coverage travels WITH the verdict and `clean` is never claimed.
      // Fixing this needs the installed tree rather than the manifest — see Section 180.5.
      const coverage = {
        askedAbout: rows.length,
        directDependencies: Object.keys(pinned).length,
        installedTreeCovered: false,
        transitiveCovered: false,
        meaning: 'Only direct dependencies were asked about, and OSV answers per package rather '
          + 'than per dependency chain. A transitive advisory, or one reached THROUGH a direct '
          + 'dependency, is outside what this scan can see.',
        soZeroMeans: 'No advisory was found for the names asked about. It does NOT mean the '
          + 'installed tree is clean — the tree-wide answer is in `tree` below.',
      };

      // ── The tree-wide answer, which is the one that can say "exposed" (Section 181) ──────────
      //
      // The OSV pass above asks about the MANIFEST. This asks about the installed TREE, via
      // `npm audit`, and triages each advisory into a route: a downgrade npm proposed and we
      // refuse, an `overrides` pin, a breaking bump that is master's decision, or a fix inside the
      // declared ranges. Measured on this machine: the manifest pass found 0 and the tree pass
      // found 20 across 638 packages.
      //
      // The two are kept SEPARATE rather than merged. They answer different questions, they
      // disagree for understandable reasons, and a disagreement between two sources is a finding
      // worth seeing rather than one worth averaging away.
      let tree = { ok: false, reason: 'the tree scan was not attempted', findings: [] };
      try {
        const triage = require('../lib/vulnerabilityTriage.cjs');
        tree = triage.triage({
          report: await auditReport(),
          manifest: own,
          installed: installedVersions(own),
        });
      } catch (err) {
        tree = { ok: false, reason: `the tree scan failed: ${err.message}`, findings: [] };
      }

      return {
        ok: true,
        data: {
          ...review,
          // Carried, not swallowed: a package whose lookup failed is not a package that is fine,
          // and the caller needs to be able to say which ones were not really checked.
          failures,
          scanned: rows.length,
          includedDev: !!includeDev,
          coverage,
          tree,
          // Deliberately NOT a boolean "clean" field. There is no honest value for it here, and a
          // caller that wants one would have to read `coverage` to see why it is absent.
          at: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Kill process ─────────────────────────────────────────────────────────
  ipcMain.handle('system:kill-process', async (_e, { user, pid } = {}) => {
    const denied = capability.deny(user, 'os.process-kill');
    if (denied) return denied;
    try {
      process.kill(pid, 'SIGTERM');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Network active connections ────────────────────────────────────────────
  // Lists every process's network connections — same sensitivity class as
  // the process list.
  ipcMain.handle('system:get-network-stats', async (_e, { user } = {}) => {
    const denied = capability.deny(user, 'os.process-list');
    if (denied) return denied;
    try {
      const [conns, stats] = await Promise.all([
        si.networkConnections(),
        si.networkStats(),
      ]);
      return {
        ok: true,
        data: {
          connections: conns.slice(0, 200).map(c => ({
            protocol:    c.protocol,
            localAddr:   c.localAddress,
            localPort:   c.localPort,
            remoteAddr:  c.peerAddress,
            remotePort:  c.peerPort,
            state:       c.state,
            pid:         c.pid,
            process:     c.process,
          })),
          interfaces: stats.map(n => ({
            iface:  n.iface,
            rxSec:  n.rx_sec,
            txSec:  n.tx_sec,
            rxTotal: n.rx_bytes,
            txTotal: n.tx_bytes,
          })),
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Disk usage ────────────────────────────────────────────────────────────
  ipcMain.handle('system:get-disk-usage', async () => {
    try {
      const drives = await si.fsSize();
      return {
        ok: true,
        data: drives.map(d => ({
          fs:      d.fs,
          type:    d.type,
          size:    d.size,
          used:    d.used,
          avail:   d.available,
          usedPct: d.use,
          mount:   d.mount,
        })),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Temp file targets ─────────────────────────────────────────────────────
  ipcMain.handle('system:get-temp-targets', async () => {
    try {
      const targets = getTempTargets();
      const enriched = await Promise.all(
        targets.map(async (t) => {
          let sizeBytes = 0;
          let fileCount = 0;
          try {
            ({ sizeBytes, fileCount } = await getDirSize(t.path));
          } catch { /* dir may not exist */ }
          return { ...t, sizeBytes, fileCount };
        })
      );
      return { ok: true, data: enriched };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Clean temp files ──────────────────────────────────────────────────────
  ipcMain.handle('system:clean-temp', async (_e, { user, targetPaths } = {}) => {
    const denied = capability.deny(user, 'os.temp-clean');
    if (denied) return denied;
    const results = [];
    for (const p of targetPaths) {
      try {
        const { sizeBytes, fileCount } = await getDirSize(p);
        await cleanDir(p);
        results.push({ path: p, ok: true, freedBytes: sizeBytes, filesRemoved: fileCount });
      } catch (err) {
        results.push({ path: p, ok: false, error: err.message });
      }
    }
    return { ok: true, data: results };
  });

  // ── Streaming metrics ─────────────────────────────────────────────────────
  // Self-paced rather than a fixed setInterval: a fixed timer fires again
  // before a slow si.currentLoad()/si.mem() call returns (observed several
  // seconds per call on a machine without a persistent PowerShell session —
  // see sysinfo.cjs), so calls pile up and results arrive stale/out of
  // order. Scheduling the next tick only after the current one resolves
  // means it can never get further than one call behind reality.
  ipcMain.on('system:start-stream', (event) => {
    if (streamInterval) return;
    let stopped = false;
    streamInterval = { stop: () => { stopped = true; } };

    const tick = async () => {
      if (stopped) return;
      const startedAt = Date.now();
      try {
        const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
        if (stopped) return;
        event.sender.send('system:metrics-stream', {
          cpu:      typeof cpu.currentLoad === 'number' ? Math.round(cpu.currentLoad) : null,
          ram:      mem.total > 0 ? Math.round((mem.used / mem.total) * 100) : null,
          ts:       Date.now(),
          // How long this sample itself took to gather — surfaced so the UI
          // can show "stats may be delayed" honestly instead of pretending
          // a slow sample happened instantly.
          sampleMs: Date.now() - startedAt,
        });
      } catch { /* ignore stream errors */ }
      if (!stopped) setTimeout(tick, Math.max(500, 2000 - (Date.now() - startedAt)));
    };
    tick();
  });

  ipcMain.on('system:stop-stream', () => {
    if (streamInterval) {
      streamInterval.stop();
      streamInterval = null;
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getTempTargets() {
  const platform = process.platform;
  const home = os.homedir();
  const targets = [];

  if (platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData  = process.env.APPDATA      || path.join(home, 'AppData', 'Roaming');
    targets.push(
      { id: 'win-temp',        label: 'Windows Temp (%TEMP%)',            path: process.env.TEMP  || path.join(localApp, 'Temp') },
      { id: 'win-sys-temp',    label: 'Windows System Temp',              path: 'C:\\Windows\\Temp' },
      { id: 'win-prefetch',    label: 'Windows Prefetch',                 path: 'C:\\Windows\\Prefetch' },
      // Browser cache — deliberately narrowed to the Cache/*Cache* subfolder only,
      // never the profile root, and flagged `risky: true` so the UI never
      // pre-selects it. A prior version pointed the Firefox entry at the whole
      // Profiles directory, which co-locates logins.json/cookies.sqlite/
      // places.sqlite (saved logins + history) with the cache in the SAME
      // directory — cleaning it would have signed the user out of every site
      // and erased browsing history, not just freed disk space. Chrome/Edge
      // already isolate Cache/ from Login Data/Cookies/History, but they still
      // sign the user out of sites using session-only cookies, so they stay
      // risky (unchecked by default) rather than "safe temp".
      { id: 'chrome-cache',    label: 'Chrome Cache',                     path: path.join(localApp, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), risky: true, note: 'Cache only — will not touch saved passwords, cookies, or history. May sign you out of some sites.' },
      { id: 'edge-cache',      label: 'Edge Cache',                       path: path.join(localApp, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'), risky: true, note: 'Cache only — will not touch saved passwords, cookies, or history. May sign you out of some sites.' },
      // Firefox has no separate always-present "cache-only, safe to nuke" path
      // that is stable across versions/profiles without parsing profiles.ini,
      // and getting that wrong risks deleting real profile data — so it is not
      // offered as a target at all rather than guessed at.
      { id: 'npm-cache',       label: 'npm Cache',                        path: path.join(appData, 'npm-cache') },
      { id: 'pip-cache',       label: 'pip Cache',                        path: path.join(localApp, 'pip', 'cache') },
      { id: 'win-update',      label: 'Windows Update Cache',             path: 'C:\\Windows\\SoftwareDistribution\\Download' },
      { id: 'vscode-storage',  label: 'VS Code Workspace Storage',        path: path.join(appData, 'Code', 'User', 'workspaceStorage') },
      { id: 'thumbnails',      label: 'Thumbnail Cache',                  path: path.join(localApp, 'Microsoft', 'Windows', 'Explorer') },
    );
  } else if (platform === 'darwin') {
    targets.push(
      { id: 'mac-caches',      label: 'macOS User Caches',                path: path.join(home, 'Library', 'Caches') },
      { id: 'mac-logs',        label: 'macOS User Logs',                  path: path.join(home, 'Library', 'Logs') },
      { id: 'mac-tmp',         label: 'macOS /tmp',                       path: '/private/var/folders' },
      { id: 'npm-cache',       label: 'npm Cache',                        path: path.join(home, '.npm') },
      { id: 'pip-cache',       label: 'pip Cache',                        path: path.join(home, 'Library', 'Caches', 'pip') },
    );
  } else {
    targets.push(
      { id: 'linux-tmp',       label: 'Linux /tmp',                       path: '/tmp' },
      { id: 'linux-cache',     label: 'Linux ~/.cache',                   path: path.join(home, '.cache') },
      { id: 'linux-trash',     label: 'Linux Trash',                      path: path.join(home, '.local', 'share', 'Trash') },
      { id: 'npm-cache',       label: 'npm Cache',                        path: path.join(home, '.npm') },
      { id: 'pip-cache',       label: 'pip Cache',                        path: path.join(home, '.cache', 'pip') },
    );
  }

  return targets;
}

async function getDirSize(dirPath) {
  let sizeBytes = 0;
  let fileCount = 0;

  const walk = async (p) => {
    const entries = await fs.promises.readdir(p, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const stat = await fs.promises.stat(full).catch(() => null);
        if (stat) { sizeBytes += stat.size; fileCount++; }
      }
    }
  };

  await walk(dirPath);
  return { sizeBytes, fileCount };
}

async function cleanDir(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    try {
      if (e.isDirectory()) {
        await fs.promises.rm(full, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(full);
      }
    } catch { /* skip locked files */ }
  }
}

module.exports = { register };
