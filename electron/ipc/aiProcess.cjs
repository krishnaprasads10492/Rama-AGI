'use strict';

const { spawn }     = require('child_process');
const path          = require('path');
const fs            = require('fs');
const { app }       = require('electron');

// ─── AI backend process state ─────────────────────────────────────────────────
const processes = {};   // key: 'python' | 'node-server'

/**
 * The engine's last words, kept so a failure can be explained (spec Section 99).
 *
 * A ring buffer rather than the whole log: uvicorn is chatty and the useful part of a fatal error is
 * always at the end, so an unbounded buffer would grow for the life of the process to hold information
 * that is only ever read from the tail.
 */
const STDERR_KEEP = 24;
const lastStderr = [];
let lastExit = null;

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

  // Which interpreter runs the engine, in order (Section 91):
  //
  //   1. RAMA_PYTHON            an explicit choice always wins
  //   2. <userData>/python-env  the venv `scripts/buildInstaller.cjs` creates and populates
  //   3. <repo>/.venv-stockmind a convenience when running from a source checkout
  //   4. python on PATH         the original behaviour, kept as the last resort
  //
  // WHY THE LADDER EXISTS. The pinned requirements are bounded above by `numpy==1.26.4`, which
  // publishes no wheel past CPython 3.12, so the engine usually has to live in a 3.10–3.12 venv
  // while a newer Python owns `python` on PATH. Step 2 means a machine prepared by the build works
  // with NO environment variable to set — the manual `setx RAMA_PYTHON` this used to require was a
  // step master should never have needed. Every rung is additive and step 4 is unchanged, so an
  // install that works today keeps working.
  const configured = (process.env.RAMA_PYTHON || '').trim();
  const venvExe = (dir) => (process.platform === 'win32'
    ? path.join(dir, 'Scripts', 'python.exe')
    : path.join(dir, 'bin', 'python'));

  // SEARCHED, not computed from one name (spec Section 99).
  //
  // `app.getPath('userData')` derives from `app.getName()`, which returns package.json's TOP-LEVEL
  // `productName` — unset here — and so falls back to `name`: "rama-agi". But `buildInstaller` first
  // built the venv from `build.productName`: "Rama AGI". Two fields, two directories, and master ran
  // option 3 successfully only for the app to report the engine missing.
  //
  // Both are checked, because which one is live depends on the launch: electron-builder writes
  // `productName` into a packaged app's metadata, so a packaged run resolves "Rama AGI" while a source
  // run resolves "rama-agi". Searching costs two `existsSync` calls and removes a whole class of
  // "it is installed but not found".
  let managed = null;
  const appData = process.platform === 'win32'
    ? (process.env.APPDATA || '')
    : null;
  const venvRoots = [];
  try { venvRoots.push(app.getPath('userData')); }
  catch { /* getPath can throw before the app is ready */ }
  if (appData) venvRoots.push(path.join(appData, 'rama-agi'), path.join(appData, 'Rama AGI'));

  for (const root of venvRoots) {
    if (!root) continue;
    const candidate = venvExe(path.join(root, 'python-env'));
    try {
      if (fs.existsSync(candidate)) { managed = candidate; break; }
    } catch { /* unreadable path: try the next */ }
  }

  if (!managed) {
    // Running from a checkout: `backendPath` is `<repo>/ai_backend`, so its parent is the repo.
    const local = venvExe(path.join(path.dirname(backendPath), '.venv-stockmind'));
    if (fs.existsSync(local)) managed = local;
  }

  const python = configured
    || managed
    || (process.platform === 'win32' ? 'python' : 'python3');

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
        : 'No Python found (tried "' + python + '"). Run Rama.bat option 3, which creates the '
          + 'engine environment and installs its packages. To do it by hand: install Python 3.10 '
          + 'to 3.12, then python -m pip install -r ai_backend/requirements.txt.')
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
    // RETAINED, not only broadcast (spec Section 99). This used to be sent to open windows and
    // dropped. When the engine died on an ImportError the reason existed for one instant in a log
    // stream nobody was watching, and the only thing master saw was "Backend not reachable" — a
    // connection refusal, which describes the symptom and not the cause.
    if (line) {
      lastStderr.push(line);
      if (lastStderr.length > STDERR_KEEP) lastStderr.shift();
    }
    if (ipcMainRef) {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('ai:log', { stream: 'stderr', line, ts: Date.now() });
      });
    }
  });

  child.on('exit', (code, signal) => {
    // Kept so a later "not reachable" can say the engine STARTED AND DIED, and why — which is a
    // completely different situation from it never having been spawned.
    lastExit = { code, signal, at: Date.now(), interpreter: python };
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
/**
 * Why is the engine not running? (spec Section 99)
 *
 * PURE, so it is testable without spawning anything, and exported for exactly that reason.
 *
 * Turns the retained stderr and exit code into a sentence master can act on. The ordering matters:
 * a missing package is checked before a generic non-zero exit, because "ModuleNotFoundError: fastapi"
 * has an obvious remedy while "exited with code 1" has none.
 */
function diagnoseFailure({ stderr = [], exit = null } = {}) {
  const text = (Array.isArray(stderr) ? stderr : []).join('\n');

  const missing = text.match(/No module named '([^']+)'/);
  if (missing) {
    return {
      reason: `the engine's Python packages are not installed — "${missing[1]}" is missing`,
      remedy: 'Run Rama.bat option 3, which creates the engine environment and installs them. '
        + 'By hand: python -m pip install -r ai_backend/requirements.txt',
    };
  }

  if (/SyntaxError|IndentationError/.test(text)) {
    return {
      reason: 'the engine source failed to parse',
      remedy: 'A Python version mismatch is the usual cause. The pins need Python 3.10 to 3.12.',
    };
  }

  // Windows reports this as `[Errno 10048]` from uvicorn and as "only one usage of each socket
  // address" from the OS; Linux and macOS say "Address already in use". Matching only the literal
  // `WinError 10048` missed the form actually emitted, so all three spellings are accepted.
  if (/Address already in use|Errno 10048|WinError 10048|only one usage of each socket address/i.test(text)) {
    return {
      reason: 'port 8001 is already in use by another process',
      remedy: 'Close whatever holds port 8001, or set STOCKMIND_PYTHON_PORT to a free port.',
    };
  }

  if (/ENOENT|not found on PATH|could not be started/i.test(text)) {
    return {
      reason: 'the Python interpreter could not be started',
      remedy: 'Install Python 3.10-3.12, or set RAMA_PYTHON to a specific python.exe.',
    };
  }

  if (exit && exit.code !== 0 && exit.code !== null) {
    return {
      reason: `the engine exited with code ${exit.code}`
        + (exit.interpreter ? ` (interpreter: ${exit.interpreter})` : ''),
      remedy: 'The ENGINE tab shows the raw output. Rama.bat option 2 checks the runtime.',
    };
  }

  if (!exit && text.length === 0) {
    return {
      reason: 'the engine produced no output and never bound its port',
      remedy: 'Check that Python is installed and that ai_backend/main.py is present.',
    };
  }

  return { reason: 'the engine started but did not answer', remedy: 'See the ENGINE tab for output.' };
}

function getRunningStatus() {
  return {
    python: {
      running: !!processes['python'] && !processes['python'].killed,
      // Surfaced so a caller can explain a failure instead of only reporting one.
      lastStderr: [...lastStderr],
      lastExit,
      diagnosis: (!processes['python'] && (lastExit || lastStderr.length))
        ? diagnoseFailure({ stderr: lastStderr, exit: lastExit })
        : null,
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
  // Exported so the Section 99 diagnosis is tested rather than asserted in a comment.
  diagnoseFailure,
};
