'use strict';

const { exec, execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const execAsync = promisify(exec);

// ─── In-memory state ─────────────────────────────────────────────────────────
let appRegistry  = [];        // All detected installed apps
let whitelist    = [];        // Apps allowed for full assimilation
let blacklist    = [];        // Apps blocked from assimilation
const auditLog   = [];        // All assimilation actions

// ─── Register all app assimilation IPC handlers ───────────────────────────────
function register(ipcMain) {

  // ── Scan installed apps ────────────────────────────────────────────────────
  ipcMain.handle('apps:scan-installed', async () => {
    try {
      appRegistry = await scanInstalledApps();
      return { ok: true, data: appRegistry };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get registry ───────────────────────────────────────────────────────────
  ipcMain.handle('apps:get-registry', async () => {
    if (appRegistry.length === 0) {
      appRegistry = await scanInstalledApps().catch(() => []);
    }
    return { ok: true, data: appRegistry };
  });

  // ── Get capabilities for a specific app ───────────────────────────────────
  ipcMain.handle('apps:get-capabilities', async (_e, appId) => {
    const app = appRegistry.find(a => a.id === appId);
    if (!app) return { ok: false, error: 'App not found in registry' };
    return { ok: true, data: app };
  });

  // ── Execute an assimilation action ────────────────────────────────────────
  // ALL destructive actions must be pre-confirmed by master in the renderer
  ipcMain.handle('apps:execute', async (_e, appId, action, params = {}) => {
    const app = appRegistry.find(a => a.id === appId);
    if (!app) return { ok: false, error: 'App not found in registry' };

    // Blacklist check
    if (blacklist.includes(appId)) {
      return { ok: false, error: 'App is blacklisted from assimilation' };
    }

    // Audit log entry
    const entry = {
      ts:      Date.now(),
      appId,
      appName: app.name,
      action,
      params,
      result:  null,
    };

    try {
      let result;
      switch (action) {
        case 'launch':
          result = await launchApp(app, params);
          break;
        case 'query':
          result = await queryApp(app, params);
          break;
        case 'spawn-cli':
          result = await spawnCli(app, params);
          break;
        default:
          return { ok: false, error: `Unknown action: ${action}` };
      }
      entry.result = { ok: true };
      auditLog.unshift(entry);
      if (auditLog.length > 500) auditLog.pop();
      return { ok: true, data: result };
    } catch (err) {
      entry.result = { ok: false, error: err.message };
      auditLog.unshift(entry);
      if (auditLog.length > 500) auditLog.pop();
      return { ok: false, error: err.message };
    }
  });

  // ── Get audit log ─────────────────────────────────────────────────────────
  ipcMain.handle('apps:get-audit-log', async () => {
    return { ok: true, data: auditLog };
  });

  // ── Set whitelist ─────────────────────────────────────────────────────────
  ipcMain.handle('apps:set-whitelist', async (_e, list) => {
    whitelist = Array.isArray(list) ? list : [];
    return { ok: true };
  });

  // ── Set blacklist ─────────────────────────────────────────────────────────
  ipcMain.handle('apps:set-blacklist', async (_e, list) => {
    blacklist = Array.isArray(list) ? list : [];
    return { ok: true };
  });
}

// ─── App scanning per platform ────────────────────────────────────────────────
async function scanInstalledApps() {
  const platform = process.platform;
  let apps = [];

  if (platform === 'win32') {
    apps = await scanWindows();
  } else if (platform === 'darwin') {
    apps = await scanMacOS();
  } else {
    apps = await scanLinux();
  }

  // Assign capability tiers
  return apps.map(app => ({
    ...app,
    tier: detectCapabilityTier(app),
  }));
}

async function scanWindows() {
  const apps = [];
  // Read from registry via PowerShell — most reliable method on Windows
  const psScript = `
    Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,
                     HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,
                     HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* |
    Where-Object { $_.DisplayName -ne $null } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation |
    ConvertTo-Json -Compress
  `.trim();

  try {
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
      timeout: 15000,
    });
    const parsed = JSON.parse(stdout);
    const list   = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item.DisplayName) continue;
      apps.push({
        id:       toId(item.DisplayName),
        name:     item.DisplayName,
        version:  item.DisplayVersion || null,
        vendor:   item.Publisher      || null,
        location: item.InstallLocation || null,
        platform: 'win32',
        hasCli:   false,
        hasCom:   detectComCapability(item.DisplayName),
      });
    }
  } catch { /* registry scan failed — return empty */ }

  return apps;
}

async function scanMacOS() {
  const apps = [];
  try {
    const { stdout } = await execAsync('ls /Applications', { timeout: 5000 });
    const names = stdout.split('\n').filter(n => n.endsWith('.app'));
    for (const name of names) {
      const displayName = name.replace('.app', '');
      apps.push({
        id:       toId(displayName),
        name:     displayName,
        location: path.join('/Applications', name),
        platform: 'darwin',
        hasCli:   false,
        hasAppleScript: true,
      });
    }
  } catch { /* ignore */ }
  return apps;
}

async function scanLinux() {
  const apps = [];
  // Read .desktop files from standard locations
  const dirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(os.homedir(), '.local', 'share', 'applications'),
  ];

  for (const dir of dirs) {
    try {
      const files = await fs.promises.readdir(dir).catch(() => []);
      for (const f of files) {
        if (!f.endsWith('.desktop')) continue;
        try {
          const content = await fs.promises.readFile(path.join(dir, f), 'utf-8');
          const name    = (content.match(/^Name=(.+)/m) || [])[1];
          const exec_   = (content.match(/^Exec=(.+)/m) || [])[1];
          if (name) {
            apps.push({
              id:       toId(name),
              name,
              execLine: exec_ || null,
              platform: 'linux',
              hasCli:   !!exec_,
            });
          }
        } catch { /* skip malformed .desktop */ }
      }
    } catch { /* dir doesn't exist */ }
  }
  return apps;
}

function detectCapabilityTier(app) {
  const name = (app.name || '').toLowerCase();
  // Apps with well-known automation interfaces
  if (['microsoft outlook', 'outlook', 'excel', 'word', 'powerpoint', 'onenote', 'access'].some(n => name.includes(n))) {
    return 'full-control'; // COM automation available
  }
  if (['google chrome', 'chromium', 'microsoft edge', 'brave'].some(n => name.includes(n))) {
    return 'full-control'; // CDP available
  }
  if (app.hasCli || app.execLine) return 'spawn-only';
  return 'data-only';
}

function detectComCapability(name) {
  const n = (name || '').toLowerCase();
  return ['outlook', 'excel', 'word', 'powerpoint', 'onenote'].some(k => n.includes(k));
}

async function launchApp(app, params) {
  if (process.platform === 'win32' && app.location) {
    const exeFiles = await fs.promises.readdir(app.location).catch(() => []);
    const exe = exeFiles.find(f => f.endsWith('.exe'));
    if (exe) {
      spawn(path.join(app.location, exe), [], { detached: true, stdio: 'ignore' });
      return { launched: true };
    }
  }
  if (process.platform === 'darwin') {
    await execAsync(`open -a "${app.name}"`);
    return { launched: true };
  }
  if (process.platform === 'linux' && app.execLine) {
    const cmd = app.execLine.split('%')[0].trim();
    spawn(cmd, [], { detached: true, stdio: 'ignore' });
    return { launched: true };
  }
  throw new Error('Cannot determine how to launch this app');
}

async function queryApp(app, params) {
  // Platform-specific read-only data extraction
  if (process.platform === 'win32' && app.hasCom) {
    // Future: use node-ffi-napi or PowerShell COM bridge
    const script = params.psScript;
    if (!script) throw new Error('No psScript provided for COM query');
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`, { timeout: 20000 });
    return { output: stdout.trim() };
  }
  throw new Error('query not yet implemented for this app/platform');
}

async function spawnCli(app, params) {
  const { command, args = [], timeout = 30000 } = params;
  const { stdout, stderr } = await execAsync(`"${command}" ${args.join(' ')}`, { timeout });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

function toId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { register };
