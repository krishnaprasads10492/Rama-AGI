'use strict';

/**
 * engineBootstrap.cjs - make the StockMind engine runnable on THIS machine (spec Section 154)
 *
 * THE GAP. The engine's Python environment was built only by `scripts/buildInstaller.cjs` on the BUILD machine.
 * An installed Rāma on another machine had no environment at all, and the error pointed at `Rama.bat`, which is
 * not packaged. The pinned packages (numpy 1.26.4, pandas 2.2.3, scikit-learn 1.5.2 ...) have wheels only up to
 * CPython 3.12, so "any Python" is not enough: a machine whose only Python is 3.13 or newer cannot install them.
 *
 * WHAT IT DOES, in order, each reported as it happens:
 *   find       a Python between 3.10 and 3.12 (the `py` launcher, known per-user install paths, PATH)
 *   venv       <userData>/python-env, the first place `aiProcess` looks, so nothing else needs configuring
 *   pip        upgrade pip (best effort)
 *   install    ai_backend/requirements.txt, preferring wheels
 *   verify     import every package the engine needs, in the new environment
 *
 * INSTALLING PYTHON ITSELF is a separate, explicit act (`installPython`): on Windows it runs winget for the
 * per-user Python 3.12. It is never started by `run`, because it changes the machine beyond Rāma's own folder.
 *
 * PURE WHERE IT CAN BE: every process start goes through an injected `exec`, so the logic is driven in tests with
 * no Python, no network and no filesystem outside a temp dir.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MIN = [3, 10];
const MAX = [3, 12];
const PROBE_MODULES = ['fastapi', 'uvicorn', 'pydantic', 'numpy', 'pandas', 'sklearn', 'lightgbm', 'xgboost', 'joblib', 'ta', 'httpx'];
const WINGET_ID = 'Python.Python.3.12';
const TAIL = 200;

function parseVersion(text) {
  const m = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

function isSupported(v) {
  if (!v) return false;
  const n = v[0] * 1000 + v[1];
  return n >= MIN[0] * 1000 + MIN[1] && n <= MAX[0] * 1000 + MAX[1];
}

const verText = (v) => (v ? `${v[0]}.${v[1]}${v[2] || v[2] === 0 ? `.${v[2]}` : ''}` : 'unknown');

/** Newest supported minor first: 3.12, then 3.11, then 3.10. */
const preference = (v) => (v ? v[1] : -1);

/** Where a per-user Windows install puts each supported Python. */
function windowsKnownPaths(env) {
  const base = env && env.LOCALAPPDATA;
  if (!base) return [];
  return ['312', '311', '310'].map((n) => path.join(base, 'Programs', 'Python', `Python${n}`, 'python.exe'));
}

function candidatesFor(platform, env) {
  if (platform === 'win32') {
    return [
      ...['3.12', '3.11', '3.10'].map((v) => ({ command: 'py', args: [`-${v}`], label: `py -${v}` })),
      ...windowsKnownPaths(env).map((p) => ({ command: p, args: [], label: p, isPath: true })),
      { command: 'python', args: [], label: 'python' },
      { command: 'python3', args: [], label: 'python3' },
    ];
  }
  return [
    ...['3.12', '3.11', '3.10'].map((v) => ({ command: `python${v}`, args: [], label: `python${v}` })),
    { command: 'python3', args: [], label: 'python3' },
    { command: 'python', args: [], label: 'python' },
  ];
}

/**
 * Find the best supported Python.
 * @param {{exec:Function, platform:string, env:object, exists?:Function}} d
 * @returns {Promise<{ok:boolean, command?:string, args?:string[], version?:string, label?:string, seen:string[], reason?:string}>}
 */
async function findPython(d) {
  const seen = [];
  let best = null;
  for (const c of candidatesFor(d.platform, d.env)) {
    if (c.isPath && d.exists && !d.exists(c.command)) continue;
    let r;
    try { r = await d.exec(c.command, [...c.args, '--version'], { timeoutMs: 15000 }); }
    catch { continue; }
    if (!r || r.code !== 0) continue;
    const v = parseVersion(`${r.stdout || ''} ${r.stderr || ''}`);
    if (!v) continue;
    seen.push(`${c.label}: ${verText(v)}`);
    if (!isSupported(v)) continue;
    if (!best || preference(v) > preference(best.v)) best = { c, v };
    if (v[1] === 12) break;
  }
  if (best) {
    return { ok: true, command: best.c.command, args: best.c.args, version: verText(best.v), label: best.c.label, seen };
  }
  return {
    ok: false, seen,
    reason: seen.length
      ? `Python was found (${seen.join(', ')}) but none is 3.10 to 3.12. The engine's pinned packages publish no wheels for other versions.`
      : 'No Python was found on this machine.',
  };
}

function layout({ userData, backendPath, platform }) {
  const venvDir = path.join(userData, 'python-env');
  const venvPython = platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
  return { venvDir, venvPython, requirements: path.join(backendPath, 'requirements.txt') };
}

const probeArgs = () => ['-c', PROBE_MODULES.map((m) => `import ${m}`).join('; ')];

// ─── State: one setup at a time ─────────────────────────────────────────────────────────────────
const state = { running: false, stage: null, lines: [], startedAt: null, finishedAt: null, result: null };

function resetState() {
  Object.assign(state, { running: false, stage: null, lines: [], startedAt: null, finishedAt: null, result: null });
}

function push(line) {
  const t = String(line || '').replace(/\u001b\[[0-9;]*m/g, '').trimEnd();
  if (!t) return;
  state.lines.push(t.length > 300 ? `${t.slice(0, 300)}…` : t);
  if (state.lines.length > TAIL) state.lines.splice(0, state.lines.length - TAIL);
}

function snapshotState() {
  return { running: state.running, stage: state.stage, lines: state.lines.slice(-60), startedAt: state.startedAt, finishedAt: state.finishedAt, result: state.result };
}

// ─── The real process runner ────────────────────────────────────────────────────────────────────
/** Run a command without a shell, streaming each output line. Resolves; never rejects on a non-zero exit. */
function realExec(command, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    let out = '';
    let err = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    try {
      child = spawn(command, args, {
        cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1' },
      });
    } catch (e) { resolve({ code: -1, stdout: '', stderr: e.message }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } done({ code: -2, stdout: out, stderr: `${err}\ntimed out after ${Math.round((opts.timeoutMs || 0) / 1000)} s` }); }, opts.timeoutMs || 1200000);
    const feed = (buf, which) => {
      const s = buf.toString();
      if (which === 'out') out += s; else err += s;
      if (opts.onLine) s.split(/\r?\n/).forEach((l) => { if (l.trim()) opts.onLine(l); });
    };
    child.stdout.on('data', (b) => feed(b, 'out'));
    child.stderr.on('data', (b) => feed(b, 'err'));
    child.on('error', (e) => done({ code: -1, stdout: out, stderr: e.message }));
    child.on('close', (code) => done({ code: code === null ? -1 : code, stdout: out, stderr: err }));
  });
}

// ─── Status ─────────────────────────────────────────────────────────────────────────────────────
/**
 * What is true now: is there a usable Python, is there an environment, does it import everything.
 * Cheap enough to call on opening the tab.
 */
async function status(d) {
  const lay = layout(d);
  const exists = d.exists || ((p) => fs.existsSync(p));
  const venvExists = exists(lay.venvPython);
  let depsOk = false;
  if (venvExists) {
    const r = await d.exec(lay.venvPython, probeArgs(), { timeoutMs: 60000 });
    depsOk = r.code === 0;
  }
  const found = await findPython(d);
  let wingetAvailable = false;
  if (d.platform === 'win32' && !found.ok) {
    const w = await d.exec('winget', ['--version'], { timeoutMs: 15000 });
    wingetAvailable = w.code === 0;
  }
  return {
    ready: venvExists && depsOk,
    venvExists, depsOk, venvDir: lay.venvDir,
    python: found,
    canInstallPython: !found.ok && wingetAvailable,
    pythonInstallNote: !found.ok && !wingetAvailable
      ? (d.platform === 'win32'
        ? 'winget is not available here. Install Python 3.12 from python.org (tick "Add python.exe to PATH"), then press Set up again.'
        : 'Install Python 3.10 to 3.12 with your package manager (for example apt install python3.12-venv), then press Set up again.')
      : null,
    setup: snapshotState(),
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────────────────────────
function fail(stage, message) {
  state.result = { ok: false, stage, error: message };
  state.running = false;
  state.finishedAt = Date.now();
  push(`FAILED at ${stage}: ${message}`);
  return state.result;
}

/**
 * Build the engine environment. Single-flight: a second call while one runs is refused.
 * @param {{exec:Function, platform:string, env:object, userData:string, backendPath:string, exists?:Function, mkdirp?:Function}} d
 */
async function run(d) {
  if (state.running) return { ok: false, error: 'A setup is already running.', setup: snapshotState() };
  resetState();
  state.running = true;
  state.startedAt = Date.now();
  const lay = layout(d);
  const onLine = push;
  const exists = d.exists || ((p) => fs.existsSync(p));

  try {
    state.stage = 'find';
    push('Looking for Python 3.10 to 3.12 ...');
    const found = await findPython(d);
    if (!found.ok) return fail('find', found.reason);
    push(`Using ${found.label} (Python ${found.version}).`);

    if (!exists(lay.requirements)) return fail('find', `requirements.txt was not found at ${lay.requirements}.`);

    state.stage = 'venv';
    if (exists(lay.venvPython)) {
      push('An engine environment already exists; reusing it.');
    } else {
      push(`Creating the engine environment at ${lay.venvDir} ...`);
      (d.mkdirp || ((p) => fs.mkdirSync(p, { recursive: true })))(path.dirname(lay.venvDir));
      const v = await d.exec(found.command, [...found.args, '-m', 'venv', lay.venvDir], { onLine, timeoutMs: 300000 });
      if (v.code !== 0) {
        return fail('venv', /ensurepip|No module named venv/i.test(`${v.stderr}`)
          ? 'This Python has no venv support. On Debian or Ubuntu install python3.12-venv, then run Set up again.'
          : `python -m venv exited with ${v.code}. ${String(v.stderr).split('\n').slice(-3).join(' ').trim()}`);
      }
    }

    state.stage = 'pip';
    push('Updating pip ...');
    const up = await d.exec(lay.venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { onLine, timeoutMs: 300000 });
    if (up.code !== 0) push('pip could not be updated; continuing with the version that came with Python.');

    state.stage = 'install';
    push('Installing the engine packages. This downloads several hundred megabytes and can take a few minutes ...');
    const inst = await d.exec(lay.venvPython, ['-m', 'pip', 'install', '--prefer-binary', '-r', lay.requirements], { onLine, timeoutMs: 2400000 });
    if (inst.code !== 0) {
      return fail('install', `pip install exited with ${inst.code}. ${String(inst.stderr).split('\n').filter(Boolean).slice(-3).join(' ').trim()}`);
    }

    state.stage = 'verify';
    push('Checking that every package imports ...');
    const probe = await d.exec(lay.venvPython, probeArgs(), { onLine, timeoutMs: 120000 });
    if (probe.code !== 0) return fail('verify', `An engine package does not import: ${String(probe.stderr).split('\n').filter(Boolean).slice(-1)[0] || 'unknown error'}`);

    push('The engine environment is ready. It starts the next time StockMind needs it.');
    state.result = { ok: true, stage: 'done', python: found.version, venvDir: lay.venvDir };
    state.stage = 'done';
    state.running = false;
    state.finishedAt = Date.now();
    return state.result;
  } catch (err) {
    return fail(state.stage || 'find', err.message);
  }
}

/** Windows only, explicit: per-user Python 3.12 through winget. */
async function installPython(d) {
  if (d.platform !== 'win32') return { ok: false, error: 'Automatic Python install is only offered on Windows. Install Python 3.12 with your package manager.' };
  if (state.running) return { ok: false, error: 'A setup is already running.', setup: snapshotState() };
  const w = await d.exec('winget', ['--version'], { timeoutMs: 15000 });
  if (w.code !== 0) return { ok: false, error: 'winget is not available on this machine. Install Python 3.12 from python.org.' };
  resetState();
  state.running = true;
  state.stage = 'python';
  state.startedAt = Date.now();
  push('Installing Python 3.12 for this user with winget ...');
  const r = await d.exec('winget', ['install', '--id', WINGET_ID, '--scope', 'user', '--silent',
    '--accept-package-agreements', '--accept-source-agreements'], { onLine: push, timeoutMs: 900000 });
  state.running = false;
  state.finishedAt = Date.now();
  if (r.code !== 0) {
    // winget exits non-zero when the package is already installed and current; that is success for our purpose.
    const already = /already installed|No available upgrade|No newer package/i.test(`${r.stdout}${r.stderr}`);
    if (!already) {
      state.result = { ok: false, stage: 'python', error: `winget exited with ${r.code}.` };
      push(`FAILED: winget exited with ${r.code}.`);
      return state.result;
    }
  }
  const found = await findPython(d);
  state.result = found.ok
    ? { ok: true, stage: 'python', python: found.version }
    : { ok: false, stage: 'python', error: 'Python installed, but it is not visible yet. Close and reopen Rāma, then press Set up.' };
  push(state.result.ok ? `Python ${found.version} is ready. Press Set up the engine to continue.` : state.result.error);
  return state.result;
}

module.exports = {
  parseVersion, isSupported, findPython, layout, status, run, installPython, realExec, snapshotState,
  candidatesFor, windowsKnownPaths, probeArgs, resetState, state,
  MIN, MAX, PROBE_MODULES, WINGET_ID,
};
