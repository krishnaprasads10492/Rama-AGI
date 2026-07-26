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

let streamInterval = null;

// ─── Register all system IPC handlers ────────────────────────────────────────
function register(ipcMain) {

  // ── Full metrics snapshot ────────────────────────────────────────────────
  ipcMain.handle('system:get-metrics', async () => {
    try {
      const [cpu, mem, temp, battery, os_info, graphics] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.cpuTemperature(),
        si.battery(),
        si.osInfo(),
        si.graphics(),
      ]);

      const [net, disk] = await Promise.all([
        si.networkStats(),
        si.fsStats(),
      ]);

      return {
        ok: true,
        data: {
          cpu: {
            usage:       Math.round(cpu.currentLoad),
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
            usedPct:   Math.round((mem.used / mem.total) * 100),
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
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Process list ─────────────────────────────────────────────────────────
  ipcMain.handle('system:get-processes', async () => {
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

  // ── Kill process ─────────────────────────────────────────────────────────
  ipcMain.handle('system:kill-process', async (_e, pid) => {
    try {
      process.kill(pid, 'SIGTERM');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Network active connections ────────────────────────────────────────────
  ipcMain.handle('system:get-network-stats', async () => {
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
  ipcMain.handle('system:clean-temp', async (_e, targetPaths) => {
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
  ipcMain.on('system:start-stream', (event) => {
    if (streamInterval) return;
    streamInterval = setInterval(async () => {
      try {
        const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
        event.sender.send('system:metrics-stream', {
          cpu:    Math.round(cpu.currentLoad),
          ram:    Math.round((mem.used / mem.total) * 100),
          ts:     Date.now(),
        });
      } catch { /* ignore stream errors */ }
    }, 2000);
  });

  ipcMain.on('system:stop-stream', () => {
    if (streamInterval) {
      clearInterval(streamInterval);
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
      { id: 'chrome-cache',    label: 'Chrome Cache',                     path: path.join(localApp, 'Google', 'Chrome', 'User Data', 'Default', 'Cache') },
      { id: 'edge-cache',      label: 'Edge Cache',                       path: path.join(localApp, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache') },
      { id: 'firefox-cache',   label: 'Firefox Cache',                    path: path.join(localApp, 'Mozilla', 'Firefox', 'Profiles') },
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
