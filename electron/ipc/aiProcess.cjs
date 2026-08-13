'use strict';

const { spawn }     = require('child_process');
const path          = require('path');
const fs            = require('fs');
const { app }       = require('electron');

// ─── AI backend process state ─────────────────────────────────────────────────
const processes = {};   // key: 'python' | 'node-server'

let ipcMainRef  = null;

// ─── Register all AI process IPC handlers ────────────────────────────────────
function register(ipcMain) {
  ipcMainRef = ipcMain;

  // ── Start Python AI backend ────────────────────────────────────────────────
  ipcMain.handle('ai:start-backend', async () => {
    if (processes['python']?.killed === false) {
      return { ok: true, message: 'already running', pid: processes['python'].pid };
    }
    try {
      const result = await startPythonBackend();
      return result;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Stop Python AI backend ────────────────────────────────────────────────
  ipcMain.handle('ai:stop-backend', async () => {
    return stopProcess('python');
  });

  // ── Get status ────────────────────────────────────────────────────────────
  ipcMain.handle('ai:get-status', async () => {
    return {
      ok: true,
      data: {
        python: {
          running: !!processes['python'] && !processes['python'].killed,
          pid:     processes['python']?.pid ?? null,
        },
      },
    };
  });
}

// ─── Start Python FastAPI backend ─────────────────────────────────────────────
async function startPythonBackend() {
  const backendPath = resolveBackendPath();
  if (!backendPath) {
    return { ok: false, error: 'ai_backend directory not found' };
  }

  const mainScript = path.join(backendPath, 'main.py');
  if (!fs.existsSync(mainScript)) {
    return { ok: false, error: `main.py not found at ${mainScript}` };
  }

  const python = process.platform === 'win32' ? 'python' : 'python3';

  const child = spawn(python, ['-u', mainScript], {
    cwd:   backendPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env:   { ...process.env },
  });

  child.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (ipcMainRef) {
      // Broadcast to all renderer windows
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('ai:log', { stream: 'stdout', line, ts: Date.now() });
      });
    }
  });

  child.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (ipcMainRef) {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('ai:log', { stream: 'stderr', line, ts: Date.now() });
      });
    }
  });

  child.on('exit', (code, signal) => {
    processes['python'] = null;
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('ai:log', {
        stream: 'system',
        line: `[ai_backend] process exited — code ${code}, signal ${signal}`,
        ts: Date.now(),
      });
    });
  });

  processes['python'] = child;
  return { ok: true, pid: child.pid };
}

function stopProcess(key) {
  const child = processes[key];
  if (!child) return { ok: true, message: 'not running' };
  try {
    child.kill('SIGTERM');
    processes[key] = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function resolveBackendPath() {
  // Packaged: resources/ai_backend
  const packed = path.join(process.resourcesPath || '', 'ai_backend');
  if (fs.existsSync(packed)) return packed;

  // Dev: sibling directory
  const devPath = path.join(app.getAppPath(), '..', 'ai_backend');
  if (fs.existsSync(devPath)) return devPath;

  // Same root
  const samePath = path.join(app.getAppPath(), 'ai_backend');
  if (fs.existsSync(samePath)) return samePath;

  return null;
}

function stopAll() {
  for (const key of Object.keys(processes)) {
    stopProcess(key);
  }
}

// ─── Direct (non-IPC) access for other main-process modules ─────────────────
// marketIntel.cjs calls these to auto-start the backend on first use without
// round-tripping through ipcMain.handle from inside the main process itself.
function getRunningStatus() {
  return {
    python: {
      running: !!processes['python'] && !processes['python'].killed,
      pid:     processes['python']?.pid ?? null,
    },
  };
}

async function startPythonBackendPublic() {
  if (processes['python']?.killed === false) {
    return { ok: true, message: 'already running', pid: processes['python'].pid };
  }
  try {
    return await startPythonBackend();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { register, stopAll, getRunningStatus, startPythonBackendPublic };
