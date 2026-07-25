'use strict';

const os   = require('os');
const path = require('path');

// Active PTY sessions
const sessions = {};
let sessionCounter = 0;

let pty;
try {
  pty = require('node-pty');
} catch {
  pty = null;
  console.warn('[terminal.cjs] node-pty not available — terminal will be disabled');
}

// ─── Register all terminal IPC handlers ──────────────────────────────────────
function register(ipcMain) {

  // ── Create PTY session ───────────────────────────────────────────────────
  ipcMain.handle('terminal:create', async (event, opts = {}) => {
    if (!pty) {
      return { ok: false, error: 'node-pty not installed. Run: npm install node-pty' };
    }

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

module.exports = { register, destroyAll };
