'use strict';

const os   = require('os');
const path = require('path');
const capability = require('../lib/capability.cjs');

// Active PTY sessions
const sessions = {};
let sessionCounter = 0;

// ─── Loading node-pty, and saying the right thing when it does not load ──────
//
// THE MESSAGE THIS REPLACES SENT MASTER AT THE WRONG FAULT (Section 183). It was
// "node-pty not installed. Run: npm install node-pty" for every failure. On the
// machine that actually hit this, node-pty WAS installed — it failed to COMPILE,
// because the build machine lacks the MSVC v142 Spectre-mitigated libs, so
// `npm install node-pty` either does nothing or fails the same way. The two
// cases need different answers, and only the require error can tell them apart:
// MODULE_NOT_FOUND for the package itself means absent, anything else (a missing
// .node binding, a wrong NODE_MODULE_VERSION) means present but not built.
let pty;
let ptyFailure = null;
try {
  pty = require('node-pty');
} catch (err) {
  pty = null;
  let resolvable = false;
  try { require.resolve('node-pty'); resolvable = true; } catch { /* genuinely absent */ }
  ptyFailure = {
    // `require.resolve` succeeding while `require` throws is the exact signature of a native module
    // whose JavaScript is present and whose binding is not — and it is why the startup diagnosis
    // could report node-pty as healthy on a machine where the terminal does not work at all.
    kind: resolvable ? 'not-built' : 'not-installed',
    error: err && err.message ? err.message : String(err),
  };
  console.warn(`[terminal.cjs] node-pty did not load (${ptyFailure.kind}) — the terminal is `
    + 'DISABLED: no command will run. ' + ptyFailure.error);
}

/**
 * Why the terminal is unavailable, in words master can act on.
 *
 * Kept beside the load rather than inlined at the call site because three handlers need it and a
 * copy in each is how the last wrong version of this message survived two tranches.
 */
function ptyUnavailable() {
  const facts = require('../../shared/nativeModuleFacts.cjs');
  if (ptyFailure && ptyFailure.kind === 'not-built') {
    return {
      ok: false,
      error: 'The terminal is unavailable: node-pty is installed but its native binding was never '
        + 'built, so no command can run. This is a build-machine issue, not a missing package — '
        + '`npm install node-pty` will not fix it.',
      // The command, not advice. Section 176's ruling, applied to the one place master meets this.
      remedy: facts.remedyLines(),
      detail: ptyFailure.error,
    };
  }
  return {
    ok: false,
    error: 'The terminal is unavailable: node-pty is not installed, so no command can run.',
    remedy: ['npm install node-pty', 'Then restart Rāma.'],
    detail: ptyFailure ? ptyFailure.error : null,
  };
}

// ─── Register all terminal IPC handlers ──────────────────────────────────────
// terminal:create is the highest-risk single handler in this codebase — it
// spawns a full interactive shell with the app's own environment. It had NO
// capability check at all before this fix, despite `terminal.open` (tier 1)
// already being defined in shared/capabilities.json for exactly this.
function register(ipcMain) {

  // ── Create PTY session ───────────────────────────────────────────────────
  ipcMain.handle('terminal:create', async (event, { user, ...opts } = {}) => {
    const denied = capability.deny(user, 'terminal.open');
    if (denied) return denied;
    if (!pty) return ptyUnavailable();

    const id   = ++sessionCounter;
    const cols  = opts.cols  || 120;
    const rows  = opts.rows  || 30;
    const cwd   = opts.cwd   || os.homedir();

    // Detect shell per platform
    let shell;
    if (process.platform === 'win32') {
      shell = process.env.COMSPEC || 'cmd.exe';
      // Prefer PowerShell if available
      const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      const { existsSync } = require('fs');
      if (existsSync(psPath)) shell = psPath;
    } else if (process.platform === 'darwin') {
      shell = process.env.SHELL || '/bin/zsh';
    } else {
      shell = process.env.SHELL || '/bin/bash';
    }

    try {
      const term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM:         'xterm-256color',
          COLORTERM:    'truecolor',
          TERM_PROGRAM: 'RamaAGI',
        },
      });

      // Stream data to renderer
      term.onData((data) => {
        event.sender.send(`terminal:data:${id}`, data);
      });

      term.onExit(({ exitCode }) => {
        event.sender.send(`terminal:exit:${id}`, exitCode);
        delete sessions[id];
      });

      sessions[id] = { term, cols, rows };
      return { ok: true, id, shell, cols, rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Write to PTY ─────────────────────────────────────────────────────────
  ipcMain.on('terminal:write', (_e, id, data) => {
    const session = sessions[id];
    if (session) session.term.write(data);
  });

  // ── Resize PTY ────────────────────────────────────────────────────────────
  ipcMain.on('terminal:resize', (_e, id, cols, rows) => {
    const session = sessions[id];
    if (session) {
      session.term.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    }
  });

  // ── Destroy PTY session ───────────────────────────────────────────────────
  ipcMain.handle('terminal:destroy', async (_e, id) => {
    const session = sessions[id];
    if (session) {
      try {
        session.term.kill();
      } catch { /* ignore */ }
      delete sessions[id];
    }
    return { ok: true };
  });
}

// ── Destroy all sessions on app quit ─────────────────────────────────────────
function destroyAll() {
  for (const id of Object.keys(sessions)) {
    try { sessions[id].term.kill(); } catch { /* ignore */ }
    delete sessions[id];
  }
}

/** For system.cjs's own-footprint reporting — real PIDs of open PTY sessions,
 * so their CPU/RAM can be looked up in the live process list rather than
 * estimated or silently omitted from "what Rāma itself is using." */
function getSessionPids() {
  const out = {};
  for (const [id, session] of Object.entries(sessions)) {
    if (session.term?.pid) out[id] = session.term.pid;
  }
  return out;
}

module.exports = { register, destroyAll, getSessionPids };
