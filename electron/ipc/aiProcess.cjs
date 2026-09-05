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

  // `RAMA_PYTHON` lets master point the engine at a specific interpreter (Section 91).
  //
  // WHY THIS IS NEEDED. The pinned requirements are bounded above by `numpy==1.26.4`, which
  // publishes no wheel past CPython 3.12, so the engine often has to live in a 3.11/3.12 venv while
  // a newer Python owns `python` on PATH. Without an override the only way to satisfy the engine is
  // to change what `python` means system-wide, which is an unreasonable thing to ask of a machine
  // that has other Python work on it.
  //
  // Falls back to exactly the previous behaviour when unset, so nothing that works today changes.
  const configured = (process.env.RAMA_PYTHON || '').trim();
  const python = configured || (process.platform === 'win32' ? 'python' : 'python3');

  const child = spawn(python, ['-u', mainScript], {
    cwd:   backendPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env:   { ...process.env },
  });

  // WHY THIS EXISTS: `spawn` does not throw synchronously when the interpreter is
  // missing — it emits an 'error' event asynchronously. With no listener that becomes
  // an unhandled exception in the main process, and since crashGuard treats
  // uncaughtException as always fatal, a machine without Python on PATH would kill
  // Rāma rather than report that StockMind is unavailable. The surrounding try/catch in
  // the IPC handler never covered it. See spec Section 64.
  child.on('error', (err) => {
    processes['python'] = null;
    // The upper bound matters as much as the lower one: numpy==1.26.4 has no wheel past CPython
    // 3.12, so "3.11+" alone sends master at a version where pip fails in a C compiler.
    const hint = /ENOENT/.test(err.message)
      ? (configured
        ? `RAMA_PYTHON is set to "${configured}" but that interpreter could not be started.`
        : 'Python was not found on PATH (tried "' + python + '"). Install Python 3.11 or 3.12, '
          + 'run: python -m pip install -r ai_backend/requirements.txt, then reopen Rāma. '
          + 'To use a venv instead, set RAMA_PYTHON to its python.exe.')
      : err.message;
    console.error(`[ai_backend] could not start: ${hint}`);
    try {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('ai:log', {
          stream: 'system',
          line: `[ai_backend] failed to start — ${hint}`,
          ts: Date.now(),
        });
      });
    } catch { /* no windows yet */ }
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

/**
 * Stop the Python backend from inside the main process (spec Section 80).
 *
 * Needed so a local update that pulled new engine code can respawn the backend without
 * relaunching the whole application. Mirrors `startPythonBackendPublic` — the same reason it
 * exists: main-process callers must not have to round-trip through `ipcMain.handle`.
 */
function stopPythonBackendPublic() {
  return stopProcess('python');
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

module.exports = {
  register, stopAll, getRunningStatus,
  startPythonBackendPublic, stopPythonBackendPublic,
};
