#!/usr/bin/env node
'use strict';

/**
 * start.cjs — Rāma AGI staged self-healing launcher.
 *
 * THE MODEL: Rāma wakes the way a brain does — smallest viable part first, then
 * it uses that part to fix its own startup problems, then it brings the rest of
 * itself online. No stage assumes the next one works.
 *
 *   STAGE 0  BRAINSTEM   Zero dependencies. Node check, paths, .env, data dirs,
 *                        scenario memory. Cannot fail on a machine that can run
 *                        `node start.cjs` at all.
 *   STAGE 1  DIAGNOSE    Measure everything: deps, native modules, ports, disk,
 *                        build artefacts. Produces a defect list, fixes nothing.
 *   STAGE 2  SELF-HEAL   Repair each defect using remembered fixes first, then
 *                        generic ones. Every repair is app-scoped — the host
 *                        system is never modified.
 *   STAGE 3  CORE        Express API. Rāma's spinal cord.
 *   STAGE 4  CORTEX      Vite (dev) or the production build.
 *   STAGE 5  SHELL       The Electron window.
 *   STAGE 6  FULL        Verify the genome and report which capabilities are
 *                        actually live, honestly, including what is degraded.
 *
 * SCENARIO MEMORY: every failure and its resolution is written to
 * data/system/startup-scenarios.json. The second time Rāma meets a problem it
 * already knows the fix, so startup gets faster and quieter over time.
 *
 * Usage:
 *   node start.cjs                 Development (Vite HMR + Electron)
 *   node start.cjs --prod          Production (build/ + Electron)
 *   node start.cjs --build         Force a frontend rebuild first
 *   node start.cjs --diagnose      Report only — change nothing, exit
 *   node start.cjs --repair        Heal everything it can, then exit
 *   node start.cjs --probe         Refresh the dependency version probe
 *   node start.cjs --no-electron   Server + Vite only (headless / remote UI)
 *   node start.cjs --no-heal       Diagnose and run, but never auto-install
 *   node start.cjs --help
 */

const { spawn, spawnSync, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const http = require('http');

// ─── Flags ────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const has        = (f) => args.includes(f);
const isProd     = has('--prod');
const isDev      = !isProd;
const doBuild    = has('--build');
const diagnoseOnly = has('--diagnose');
const repairOnly = has('--repair');
const doProbe    = has('--probe');
const noElectron = has('--no-electron');
const noHeal     = has('--no-heal');
const showHelp   = has('--help') || has('-h');

const ROOT   = __dirname;
const isWin  = process.platform === 'win32';
const SERVER_PORT = Number(process.env.PORT      || 4097);
const VITE_PORT   = Number(process.env.VITE_PORT || 5173);

// ─── Output ───────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', violet: '\x1b[35m', blue: '\x1b[34m', gold: '\x1b[38;5;178m',
};

const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const line  = (glyph, colour, msg) =>
  process.stdout.write(`${C.dim}${clock()}${C.reset} ${colour}${glyph}${C.reset} ${msg}\n`);

const ok    = (m) => line('✓', C.green,  m);
const warn  = (m) => line('!', C.yellow, m);
const fail  = (m) => line('✕', C.red,    m);
const info  = (m) => line('·', C.cyan,   m);
const stage = (n, m) => process.stdout.write(
  `\n${C.violet}${C.bold}▸ STAGE ${n}${C.reset}  ${C.bold}${m}${C.reset}\n`);

// ─── Shell helpers ────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, cwd: ROOT, ...opts }).trim();
}
function tryRun(cmd, opts = {}) {
  try { return { ok: true, out: run(cmd, opts) }; }
  catch (e) { return { ok: false, error: e.message ?? String(e), out: e.stdout?.toString?.() ?? '' }; }
}
function runLoud(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', timeout: 15 * 60_000, cwd: ROOT, ...opts });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 0 — BRAINSTEM
// Everything here works with zero installed dependencies.
// ══════════════════════════════════════════════════════════════════════════════

const SYS_DIR       = path.join(ROOT, 'data', 'system');
const SCENARIO_FILE = path.join(SYS_DIR, 'startup-scenarios.json');
const PROBE_FILE    = path.join(SYS_DIR, 'version-probe.json');
const BOOT_LOG      = path.join(SYS_DIR, 'boot-history.json');

/**
 * Windows consoles default to a legacy codepage, which mangles the banner and
 * every ✓/✕ glyph. Switch to UTF-8 for this process only — best effort.
 */
function ensureUtf8Console() {
  if (!isWin) return;
  try { spawnSync('chcp', ['65001'], { stdio: 'ignore', shell: true }); } catch { /* cosmetic only */ }
  try { process.stdout.setDefaultEncoding?.('utf8'); } catch { /* cosmetic only */ }
}

function ensureDirs() {
  const dirs = [
    'data', 'data/system', 'data/system/audit', 'data/logs',
    'data/instances', 'data/knowledge',
  ];
  for (const d of dirs) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}

function checkNode() {
  const parts = process.versions.node.split('.').map(Number);
  const [major, minor] = parts;

  if (major < 18) {
    fail(`Node.js ${process.versions.node} — Rāma needs v18 minimum.`);
    fail('Download: https://nodejs.org/en/download');
    fail('Impact: nothing can start. No changes were made to your system.');
    process.exit(1);
  }

  // Vite 5+ uses crypto.hash on newer lines; warn rather than block
  const modern = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
  if (!modern) {
    warn(`Node.js ${process.versions.node} works, but v22 LTS is recommended.`);
    warn('Older lines can trip Vite on "crypto.hash is not a function".');
  }
  ok(`Node.js ${process.versions.node}`);
  return true;
}

/** Load .env into process.env, creating it from .env.example if absent. */
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  const exPath  = path.join(ROOT, '.env.example');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(exPath)) {
      fs.copyFileSync(exPath, envPath);
      ok('.env created from .env.example');
    } else {
      fs.writeFileSync(envPath, [
        'PORT=4097',
        'VITE_PORT=5173',
        'NODE_ENV=development',
        'RAMA_INSTANCE_TIER=1',
      ].join('\n') + '\n');
      ok('.env created with safe defaults');
    }
  }

  try {
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      // Never let .env override an explicitly exported variable
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    warn(`.env could not be parsed (${e.message}) — using defaults`);
  }
}

// ─── Scenario memory ──────────────────────────────────────────────────────────
// Rāma's recollection of its own startup failures and what fixed them.

function loadScenarios() {
  try {
    if (fs.existsSync(SCENARIO_FILE)) {
      const db = JSON.parse(fs.readFileSync(SCENARIO_FILE, 'utf8'));
      if (Array.isArray(db.scenarios)) return db;
    }
  } catch { /* corrupt file — start fresh rather than crash the launcher */ }
  return { version: 1, scenarios: [] };
}

/** Normalise an error into a stable key: digits and paths vary, the shape does not. */
function scenarioKey(text) {
  return String(text)
    .replace(/\d+/g, 'N')
    .replace(/[A-Za-z]:\\[^\s'"]+/g, 'PATH')
    .replace(/\/[^\s'"]{6,}/g, 'PATH')
    .slice(0, 90)
    .trim();
}

function remember(errorText, fix, resolved) {
  try {
    const db  = loadScenarios();
    const key = scenarioKey(errorText);
    const hit = db.scenarios.find(s => s.key === key);

    if (hit) {
      hit.seen++;
      hit.fix      = fix;
      hit.resolved = resolved || hit.resolved;
      hit.lastSeen = Date.now();
      if (resolved) hit.fixedCount = (hit.fixedCount ?? 0) + 1;
    } else {
      db.scenarios.push({
        key, sample: String(errorText).slice(0, 300), fix,
        resolved, seen: 1, fixedCount: resolved ? 1 : 0,
        firstSeen: Date.now(), lastSeen: Date.now(),
      });
    }

    if (db.scenarios.length > 300) db.scenarios = db.scenarios.slice(-300);
    if (!fs.existsSync(SYS_DIR)) fs.mkdirSync(SYS_DIR, { recursive: true });
    fs.writeFileSync(SCENARIO_FILE, JSON.stringify(db, null, 2));
  } catch { /* memory is an optimisation, never a requirement */ }
}

function recall(errorText) {
  try {
    const key = scenarioKey(errorText);
    const db  = loadScenarios();
    return db.scenarios.find(s => s.resolved && (s.key === key || key.includes(s.key.slice(0, 40)))) ?? null;
  } catch { return null; }
}

function recordBoot(entry) {
  try {
    let log = [];
    if (fs.existsSync(BOOT_LOG)) {
      const parsed = JSON.parse(fs.readFileSync(BOOT_LOG, 'utf8'));
      if (Array.isArray(parsed)) log = parsed;
    }
    log.unshift({ ts: Date.now(), ...entry });
    fs.writeFileSync(BOOT_LOG, JSON.stringify(log.slice(0, 100), null, 2));
  } catch { /* non-fatal */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 1 — DIAGNOSE
// Measures. Reports defects. Fixes nothing — that is stage 2's job.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Native and optional modules. `required` ones block startup; the rest degrade
 * a capability and are reported honestly rather than silently swallowed.
 */
const MODULES = [
  { name: 'express',           required: true,  gives: 'local API server' },
  { name: 'electron',          required: !noElectron, gives: 'desktop shell' },
  { name: 'vite',              required: isDev, gives: 'dev server / HMR' },
  { name: 'react',             required: true,  gives: 'user interface' },
  { name: 'argon2',            required: false, gives: 'Argon2id password hashing (falls back to scrypt)', native: true },
  { name: 'node-pty',          required: false, gives: 'real terminal (falls back to piped shell)', native: true },
  { name: 'systeminformation', required: false, gives: 'CPU/RAM/thermal sensing' },
  { name: 'simple-git',        required: false, gives: 'git operations and timeline flashbacks' },
  { name: 'playwright',        required: false, gives: 'browser automation (HTTP fetch still works)' },
  { name: 'vectra',            required: false, gives: 'vector memory (falls back to TF-IDF keyword search)' },
];

function moduleState(name) {
  const dir = path.join(ROOT, 'node_modules', name);
  if (!fs.existsSync(dir)) return 'missing';
  try {
    require.resolve(name, { paths: [ROOT] });
    return 'ok';
  } catch (e) {
    // Present on disk but not loadable — almost always a native build mismatch
    return e.code === 'MODULE_NOT_FOUND' ? 'missing' : 'broken';
  }
}

function portInUse(port) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      return out.split('\n').some(l => l.includes(`:${port} `) && l.includes('LISTENING'));
    }
    return tryRun(`lsof -ti tcp:${port}`).ok;
  } catch { return false; }
}

function freeDiskMB() {
  try {
    if (isWin) {
      const drive = ROOT.split(':')[0];
      const out = tryRun(`powershell -NoProfile -Command "(Get-PSDrive ${drive}).Free"`);
      if (out.ok) {
        const bytes = Number(String(out.out).trim());
        if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / 1048576);
      }
      return null;
    }
    const out = tryRun(`df -k "${ROOT}"`);
    if (!out.ok) return null;
    const cols = out.out.trim().split('\n').pop().split(/\s+/);
    return Math.round(Number(cols[3]) / 1024);
  } catch { return null; }
}

/**
 * @returns {{defects: Array, report: Array, degraded: Array}}
 */
function diagnose() {
  const defects  = [];   // { id, severity, detail, fix }
  const report   = [];   // { label, pass, note }
  const degraded = [];   // capabilities that will run in fallback mode

  const add = (label, pass, note = '') => report.push({ label, pass, note });

  // ── Toolchain ───────────────────────────────────────────────────────────────
  add('Node.js', true, process.versions.node);
  const npm = tryRun('npm --version');
  add('npm', npm.ok, npm.ok ? npm.out : 'not found');
  if (!npm.ok) {
    defects.push({
      id: 'npm-missing', severity: 'fatal',
      detail: 'npm is not on PATH',
      fix: 'Reinstall Node.js from nodejs.org (npm ships with it)',
    });
  }

  // ── Disk ────────────────────────────────────────────────────────────────────
  const disk = freeDiskMB();
  if (disk !== null) {
    add('Disk space', disk >= 600, `${disk} MB free`);
    if (disk < 600) {
      defects.push({
        id: 'low-disk', severity: 'warn',
        detail: `only ${disk} MB free`,
        fix: 'Free at least 600MB — npm install and the frontend build need room',
      });
    }
  }

  // ── Dependencies ────────────────────────────────────────────────────────────
  const nodeModules = fs.existsSync(path.join(ROOT, 'node_modules'));
  add('node_modules', nodeModules, nodeModules ? '' : 'will be installed');
  if (!nodeModules) {
    defects.push({
      id: 'deps-missing', severity: 'fatal',
      detail: 'node_modules is absent',
      fix: 'npm install',
    });
  }

  for (const mod of MODULES) {
    const state = moduleState(mod.name);
    add(`  ${mod.name}`, state === 'ok', state === 'ok' ? '' : state);

    if (state === 'ok') continue;

    if (mod.required) {
      defects.push({
        id: `mod-${mod.name}`, severity: 'fatal',
        detail: `${mod.name} ${state} — needed for ${mod.gives}`,
        fix: state === 'broken' && mod.native ? `npm rebuild ${mod.name}` : 'npm install',
      });
    } else {
      degraded.push({ module: mod.name, state, gives: mod.gives });
      defects.push({
        id: `mod-${mod.name}`, severity: 'degrade',
        detail: `${mod.name} ${state} — ${mod.gives}`,
        fix: state === 'broken' && mod.native ? `npm rebuild ${mod.name}` : `npm install ${mod.name}`,
      });
    }
  }

  // ── Config and data ─────────────────────────────────────────────────────────
  add('.env', fs.existsSync(path.join(ROOT, '.env')));
  add('shared/capabilities.json', fs.existsSync(path.join(ROOT, 'shared', 'capabilities.json')));
  add('data/system', fs.existsSync(SYS_DIR));

  if (!fs.existsSync(path.join(ROOT, 'shared', 'capabilities.json'))) {
    defects.push({
      id: 'caps-missing', severity: 'fatal',
      detail: 'shared/capabilities.json is missing — the access matrix cannot load',
      fix: 'Restore the file from git: git checkout shared/capabilities.json',
    });
  }

  // ── Renderer references ─────────────────────────────────────────────────────
  // A store key or bridge call that does not exist is `undefined`, and throws
  // "not a function" somewhere unrelated at runtime. Neither a syntax check nor a
  // build catches it, so it is checked here on every boot.
  try {
    const audit = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'auditRenderer.cjs')], {
      cwd: ROOT, encoding: 'utf8', timeout: 20_000,
    });
    const clean = audit.status === 0;
    add('Renderer references', clean, clean ? '' : 'unresolved — see below');

    if (!clean) {
      const lines = String(audit.stdout ?? '')
        .split('\n').map(l => l.trim())
        .filter(l => l.startsWith('✕') || l.includes('does not define') || l.includes('not exposed'));
      defects.push({
        id: 'renderer-refs', severity: 'warn',
        detail: `Unresolved renderer references: ${lines.slice(0, 4).join(' | ') || 'run npm run audit'}`,
        fix: 'npm run audit    (lists every store key and bridge call that does not resolve)',
      });
    }
  } catch { /* audit script unavailable — not fatal */ }

  // ── Renderer entry ──────────────────────────────────────────────────────────
  // Vite resolves the dev entry as <root>/index.html. This shipped once with the
  // entry inside public/ instead, so the dev server answered on its port but had
  // nothing to serve and the window opened blank. Checked explicitly now.
  const rootEntry   = fs.existsSync(path.join(ROOT, 'index.html'));
  const strayEntry  = fs.existsSync(path.join(ROOT, 'public', 'index.html'));
  add('index.html (root)', rootEntry, rootEntry ? '' : 'missing — Vite has no entry');

  if (!rootEntry) {
    defects.push({
      id: 'entry-missing', severity: 'fatal',
      detail: strayEntry
        ? 'index.html is in public/ instead of the project root — Vite will serve nothing'
        : 'index.html is missing from the project root — Vite has no entry to serve',
      fix: strayEntry
        ? 'git mv public/index.html index.html'
        : 'Restore it from git: git checkout index.html',
    });
  } else if (strayEntry) {
    defects.push({
      id: 'entry-duplicate', severity: 'warn',
      detail: 'a second index.html exists in public/ — it will be copied verbatim into the build',
      fix: 'Delete public/index.html; the root one is the real entry',
    });
  }

  // ── Build artefacts ─────────────────────────────────────────────────────────
  const buildHtml = fs.existsSync(path.join(ROOT, 'build', 'index.html'));
  add('build/index.html', isDev ? true : buildHtml, isDev ? '(dev — the build is a fallback)' : '');
  if (isProd && !buildHtml) {
    defects.push({
      id: 'build-missing', severity: 'fatal',
      detail: 'production build not found',
      fix: 'npm run build',
    });
  }

  // A stale build is worse than a missing one: it loads and renders old code, so
  // source fixes look like they did nothing. Report it in both modes, because dev
  // falls back to the build when the dev server will not serve.
  if (buildHtml) {
    const st = buildStaleness();
    add('build freshness', !st.stale,
      st.stale ? `stale — ${st.reason}` : `up to date (${st.buildAgeMin}m old)`);

    if (st.stale) {
      defects.push({
        id: 'build-stale', severity: 'warn',
        detail: `The build is older than the source (${st.reason}) — the window would render pre-change code`,
        fix: 'npm run build',
      });
    }
  }

  // ── Ports ───────────────────────────────────────────────────────────────────
  const ports = isDev ? [SERVER_PORT, VITE_PORT] : [SERVER_PORT];
  for (const p of ports) {
    const busy = portInUse(p);
    add(`Port ${p}`, !busy, busy ? 'in use — will be freed' : 'free');
    if (busy) {
      defects.push({
        id: `port-${p}`, severity: 'warn',
        detail: `port ${p} is occupied`,
        fix: `free port ${p}`,
      });
    }
  }

  // ── Path hazards ────────────────────────────────────────────────────────────
  const hazard = /[`"|<>]/.test(ROOT);
  add('Project path', !hazard, hazard ? ROOT : '');
  if (hazard) {
    defects.push({
      id: 'path-hazard', severity: 'fatal',
      detail: `project path contains a shell metacharacter: ${ROOT}`,
      fix: 'Move the project to a path without ` " | < > characters',
    });
  }

  // ── Learned memory ──────────────────────────────────────────────────────────
  const db = loadScenarios();
  add('Scenario memory', true, `${db.scenarios.length} remembered, ${db.scenarios.filter(s => s.resolved).length} with known fixes`);

  return { defects, report, degraded };
}

function printReport(report) {
  for (const r of report) {
    const glyph = r.pass ? `${C.green}✓${C.reset}` : `${C.yellow}!${C.reset}`;
    process.stdout.write(`   ${glyph}  ${r.label.padEnd(26)} ${C.dim}${r.note}${C.reset}\n`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2 — SELF-HEAL
// Every repair is scoped to this project directory. The host system is never
// modified: no global installs, no registry writes, no PATH changes.
// ══════════════════════════════════════════════════════════════════════════════

function freePort(port) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      const pids = new Set();
      for (const l of out.split('\n')) {
        if (l.includes(`:${port} `) && l.includes('LISTENING')) {
          const pid = l.trim().split(/\s+/).pop();
          if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
      }
      for (const pid of pids) {
        spawnSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
        warn(`Freed port ${port} (pid ${pid})`);
      }
      return pids.size > 0;
    }

    const r = tryRun(`lsof -ti tcp:${port}`);
    if (!r.ok || !r.out) return false;
    for (const pid of r.out.trim().split('\n')) {
      if (/^\d+$/.test(pid.trim())) {
        tryRun(`kill -9 ${pid.trim()}`);
        warn(`Freed port ${port} (pid ${pid.trim()})`);
      }
    }
    return true;
  } catch { return false; }
}

function installDeps(reason) {
  info(`npm install — ${reason}`);
  try {
    // Streamed with a generous timeout: a cold install on a slow link is normal.
    runLoud('npm install --no-audit --no-fund');
    ok('Dependencies installed');
    remember('node_modules missing', 'npm install --no-audit --no-fund', true);
    return true;
  } catch (e) {
    const msg = e.message ?? '';

    // A timeout that still landed the essentials is a partial success, not a failure
    const essentials = ['express', 'react'].every(m => fs.existsSync(path.join(ROOT, 'node_modules', m)));
    if (essentials) {
      warn('npm install did not finish cleanly, but the essential packages are present.');
      warn('Run "npm install" again in a separate terminal to complete it.');
      remember(msg, 'Partial install accepted — essentials present', true);
      return true;
    }

    fail(`npm install failed: ${msg.slice(0, 160)}`);
    const known = recall(msg);
    if (known) warn(`Remembered fix: ${known.fix}`);
    else warn('Try: npm install --legacy-peer-deps');
    remember(msg, 'npm install --legacy-peer-deps', false);
    return false;
  }
}

/** Native modules are compiled against a specific Electron ABI. */
function rebuildNative(mod) {
  info(`Rebuilding native module: ${mod}`);
  try {
    runLoud(`npm rebuild ${mod}`);
    ok(`${mod} rebuilt`);
    remember(`${mod} native binding failed`, `npm rebuild ${mod}`, true);
    return true;
  } catch (e) {
    warn(`${mod} rebuild failed — running without it (a fallback is in place)`);
    remember(e.message ?? `${mod} rebuild failed`, `npm rebuild ${mod} (needs build tools)`, false);
    return false;
  }
}

function installModule(mod) {
  info(`Installing optional capability: ${mod}`);
  try {
    runLoud(`npm install ${mod} --no-audit --no-fund`);
    ok(`${mod} installed`);
    return true;
  } catch {
    warn(`${mod} could not be installed — the fallback path stays active`);
    return false;
  }
}

/**
 * Is the production build older than the source it was built from?
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS: stage 4 falls back to `build/` when the
 * dev server will not serve. Reusing it unconditionally means a stale bundle gets
 * loaded on every launch, so source fixes appear to have no effect at all — the
 * window keeps rendering the old code and the user reasonably concludes the fix
 * did not work. Staleness must be measured, not assumed.
 *
 * @returns {{stale:boolean, reason?:string, newest?:string, buildAgeMin?:number}}
 */
function buildStaleness() {
  const buildIndex = path.join(ROOT, 'build', 'index.html');
  if (!fs.existsSync(buildIndex)) return { stale: true, reason: 'no build present' };

  let buildTime;
  try { buildTime = fs.statSync(buildIndex).mtimeMs; }
  catch { return { stale: true, reason: 'build/index.html unreadable' }; }

  // Everything the bundle is produced from
  const watched = [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'shared'),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'vite.config.js'),
    path.join(ROOT, 'package.json'),
  ];

  let newestTime = 0;
  let newestPath = null;

  const visit = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }

    if (st.isDirectory()) {
      let entries;
      try { entries = fs.readdirSync(p); } catch { return; }
      for (const e of entries) visit(path.join(p, e));
      return;
    }

    if (st.mtimeMs > newestTime) { newestTime = st.mtimeMs; newestPath = p; }
  };

  for (const w of watched) visit(w);

  const buildAgeMin = Math.round((Date.now() - buildTime) / 60000);

  if (newestTime > buildTime) {
    return {
      stale: true,
      reason: `${path.relative(ROOT, newestPath)} is newer than the build`,
      newest: path.relative(ROOT, newestPath),
      buildAgeMin,
    };
  }

  return { stale: false, buildAgeMin };
}

function buildFrontend(reason) {
  info(`Building frontend — ${reason}`);
  try {
    runLoud('npm run build');
    ok('Frontend built → build/');
    remember('production build missing', 'npm run build', true);
    return true;
  } catch (e) {
    fail(`Frontend build failed: ${(e.message ?? '').slice(0, 160)}`);
    warn('Falling back to development mode (Vite), which needs no build.');
    remember(e.message ?? 'build failed', 'Run in dev mode, or fix the build error above', false);
    return false;
  }
}

/**
 * Apply repairs for a defect list.
 * @returns {{healed: string[], unhealed: object[], fellBackToDev: boolean}}
 */
function selfHeal(defects) {
  const healed   = [];
  const unhealed = [];
  let fellBackToDev = false;

  if (defects.length === 0) {
    ok('Nothing to heal');
    return { healed, unhealed, fellBackToDev };
  }

  if (noHeal) {
    warn(`--no-heal set: ${defects.length} defect(s) left untouched`);
    return { healed, unhealed: defects, fellBackToDev };
  }

  // Order matters: dependencies before rebuilds before builds.
  const byId = new Map(defects.map(d => [d.id, d]));

  // 1. Unrecoverable environment problems
  for (const id of ['npm-missing', 'path-hazard', 'caps-missing']) {
    const d = byId.get(id);
    if (!d) continue;
    fail(d.detail);
    fail(`Fix: ${d.fix}`);
    unhealed.push(d);
    byId.delete(id);
  }
  if (unhealed.some(d => d.severity === 'fatal')) {
    return { healed, unhealed, fellBackToDev };
  }

  // 2. Install dependencies (this often resolves the module defects too)
  if (byId.has('deps-missing')) {
    if (installDeps('node_modules absent')) healed.push('dependencies installed');
    else unhealed.push(byId.get('deps-missing'));
    byId.delete('deps-missing');
  }

  // 3. Per-module repair — re-check first, the install above may have fixed it
  for (const [id, d] of [...byId.entries()]) {
    if (!id.startsWith('mod-')) continue;
    const name  = id.slice(4);
    const state = moduleState(name);

    if (state === 'ok') { healed.push(`${name} resolved`); byId.delete(id); continue; }

    const mod = MODULES.find(m => m.name === name);
    let fixed = false;

    if (state === 'broken' && mod?.native) fixed = rebuildNative(name);
    else if (mod?.required)                fixed = installDeps(`${name} missing`) && moduleState(name) === 'ok';
    else                                   fixed = installModule(name) && moduleState(name) === 'ok';

    if (fixed) healed.push(`${name} repaired`);
    else       unhealed.push(d);
    byId.delete(id);
  }

  // 4. Ports
  for (const [id, d] of [...byId.entries()]) {
    if (!id.startsWith('port-')) continue;
    const port = Number(id.slice(5));
    if (freePort(port)) healed.push(`port ${port} freed`);
    else unhealed.push(d);
    byId.delete(id);
  }

  // 5. Build
  if (byId.has('build-missing')) {
    if (buildFrontend('no build/ folder found')) healed.push('frontend built');
    else { unhealed.push(byId.get('build-missing')); fellBackToDev = true; }
    byId.delete('build-missing');
  }

  // 6. Anything left is advisory
  for (const d of byId.values()) {
    warn(`${d.detail} — ${d.fix}`);
    unhealed.push(d);
  }

  return { healed, unhealed, fellBackToDev };
}

// ══════════════════════════════════════════════════════════════════════════════
// VERSION PROBE — informational only; nothing is auto-upgraded
// ══════════════════════════════════════════════════════════════════════════════

function httpsJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const req = https.get(url, { headers: { 'User-Agent': 'Rama-AGI-Launcher' } }, (res) => {
        let body = '';
        res.on('data', c => { body += c; if (body.length > 2_000_000) req.destroy(); });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

async function probeVersions() {
  info('Probing the npm registry for current stable versions (cached 7 days)...');
  const pkgs = [
    'electron', 'vite', 'react', 'react-dom', 'react-router-dom', 'zustand',
    'express', 'argon2', 'node-pty', 'systeminformation', 'simple-git',
    'playwright', 'vectra', 'electron-builder', 'electron-updater',
  ];

  const results = { npm: {}, probedAt: Date.now() };
  await Promise.all(pkgs.map(async (p) => {
    const d = await httpsJson(`https://registry.npmjs.org/${p}/latest`);
    if (d?.version) results.npm[p] = d.version;
  }));

  try {
    if (!fs.existsSync(SYS_DIR)) fs.mkdirSync(SYS_DIR, { recursive: true });
    fs.writeFileSync(PROBE_FILE, JSON.stringify(results, null, 2));
  } catch { /* non-fatal */ }

  const count = Object.keys(results.npm).length;
  if (count === 0) { warn('Version probe found nothing — offline? Continuing.'); return results; }
  ok(`Version probe complete — ${count} package(s) checked`);

  // Compare against pinned versions. Report only: the spec pins versions on purpose.
  try {
    const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const behind = [];
    for (const [name, latest] of Object.entries(results.npm)) {
      const cur = deps[name]?.replace(/[^0-9.]/g, '');
      if (cur && cur !== latest) behind.push(`${name} ${cur} → ${latest}`);
    }
    if (behind.length) {
      info(`${behind.length} pinned package(s) have newer releases (informational, not applied):`);
      behind.slice(0, 6).forEach(b => process.stdout.write(`      ${C.dim}${b}${C.reset}\n`));
    }
  } catch { /* non-fatal */ }

  return results;
}

function probeAge() {
  try {
    if (!fs.existsSync(PROBE_FILE)) return null;
    const d = JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8'));
    return Date.now() - (d.probedAt ?? 0);
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROCESS SUPERVISION — watch child output, diagnose it, restart with backoff
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns Rāma recognises in its own children's output. Each carries the fix,
 * so a failure is explained at the moment it appears rather than left as a
 * stack trace for the user to interpret.
 */
const ERROR_PATTERNS = [
  { re: /EADDRINUSE/i,                       sev: 'error',  fix: 'Port already in use — the launcher frees it on the next run' },
  { re: /Cannot find module '([^']+)'/,       sev: 'error',  fix: 'Missing package — run: npm install' },
  { re: /ERR_MODULE_NOT_FOUND/,               sev: 'error',  fix: 'Missing package — run: npm install' },
  { re: /was compiled against a different Node/i, sev: 'error', fix: 'Native ABI mismatch — run: npm rebuild' },
  { re: /argon2.*(binding|\.node)/i,          sev: 'warn',   fix: 'Argon2 native build missing — scrypt fallback is active' },
  { re: /node-pty|pty\.node/i,                sev: 'warn',   fix: 'node-pty missing — terminal runs in piped mode' },
  { re: /playwright.*(not installed|Executable doesn't exist)/i, sev: 'warn', fix: 'Run: npx playwright install chromium' },
  { re: /crypto\.hash is not a function/i,    sev: 'error',  fix: 'Node too old for this Vite — upgrade to Node v22 LTS' },
  { re: /failed to load config/i,             sev: 'error',  fix: 'vite.config.js has a syntax error' },
  { re: /ENOMEM|out of memory/i,              sev: 'error',  fix: 'Low memory — close other applications' },
  { re: /ENOSPC|no space left/i,              sev: 'error',  fix: 'Disk full — free space and restart' },
  { re: /EACCES|permission denied/i,          sev: 'warn',   fix: 'Permission problem — check folder ownership' },
  { re: /CryptoCore: not unlocked/i,          sev: 'warn',   fix: 'Expected before the passcode is entered — not a fault' },
  { re: /Nucleus not unsealed/i,              sev: 'warn',   fix: 'Expected before the passcode is entered — not a fault' },
  { re: /window\.rama is undefined/i,         sev: 'error',  fix: 'Preload failed to evaluate — check electron/preload.cjs' },
  { re: /Store locked/i,                      sev: 'warn',   fix: 'Encrypted store is still locked — enter the passcode' },
];

function classify(text) {
  for (const p of ERROR_PATTERNS) {
    if (p.re.test(text)) {
      const known = recall(text);
      return { sev: p.sev, fix: known?.fix ?? p.fix, remembered: !!known };
    }
  }
  return null;
}

const NOISE = [
  'ExperimentalWarning', 'DeprecationWarning', 'npm warn',
  'Debugger attached', 'Debugger listening', 'Most NODE_OPTIONs are not supported',
];
const isNoise = (l) => NOISE.some(n => l.includes(n));

const children = [];          // { name, proc, cmd, argv, restarts }
const crashed  = new Set();

function supervise(name, colour, cmd, argv, opts = {}) {
  // shell:false always — a project path with a space or backtick must not break spawning
  const proc = spawn(cmd, argv, {
    cwd:   ROOT,
    env:   { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...opts,
  });

  const emit = (raw, stream) => {
    String(raw).split('\n').map(s => s.trimEnd()).filter(Boolean).forEach((l) => {
      if (isNoise(l)) return;
      process.stdout.write(`${C.dim}${clock()}${C.reset} ${colour}[${name}]${C.reset} ${l}\n`);
      const c = classify(l);
      if (!c) return;
      const tag = c.remembered ? ' (known)' : '';
      if (c.sev === 'error') fail(`  ↳ ${c.fix}${tag}`);
      else                   warn(`  ↳ ${c.fix}${tag}`);
      remember(l, c.fix, false);
    });
    if (stream === 'err') { /* already routed above */ }
  };

  proc.stdout?.on('data', d => emit(d, 'out'));
  proc.stderr?.on('data', d => emit(d, 'err'));

  proc.on('error', (e) => {
    fail(`[${name}] could not start: ${e.message}`);
    if (e.code === 'ENOENT') fail(`  ↳ "${cmd}" was not found`);
    crashed.add(name);
    remember(e.message, `Check that ${cmd} exists`, false);
  });

  proc.on('exit', (code, signal) => {
    if (code === 0 || code === null || signal === 'SIGTERM') return;

    fail(`[${name}] exited with code ${code}`);
    crashed.add(name);

    const entry = children.find(c => c.name === name);
    if (!entry) return;

    entry.restarts = (entry.restarts ?? 0) + 1;
    if (entry.restarts > 3) {
      fail(`[${name}] failed ${entry.restarts} times — not restarting again`);
      warn('Run "node start.cjs --diagnose" to see what is wrong.');
      return;
    }

    const delay = 1500 * entry.restarts;   // linear backoff, bounded by the retry cap
    warn(`[${name}] restart ${entry.restarts}/3 in ${delay}ms`);
    setTimeout(() => {
      crashed.delete(name);
      entry.proc = supervise(name, colour, cmd, argv, opts);
    }, delay);
  });

  const existing = children.find(c => c.name === name);
  if (existing) existing.proc = proc;
  else children.push({ name, proc, cmd, argv, restarts: 0 });

  return proc;
}

/** Poll a port until something answers. Resolves false on timeout. */
function waitForPort(port, timeoutMs = 25_000, pathname = '/') {
  const started = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 900 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error',   () => retry());
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) resolve(false);
      else setTimeout(attempt, 500);
    };
    attempt();
  });
}

function stopAll(exitCode = 0) {
  process.stdout.write(`\n${C.yellow}Stopping Rāma...${C.reset}\n`);
  for (const { proc } of children) {
    try {
      if (proc && !proc.killed) {
        if (isWin) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        else proc.kill('SIGTERM');
      }
    } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(exitCode), 900);
}

process.on('SIGINT',  () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
process.on('uncaughtException', (e) => {
  fail(`Launcher fault: ${e.message}`);
  remember(e.message, 'Launcher crash — see stack above', false);
  stopAll(1);
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 3/4/5 — CORE, CORTEX, SHELL
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Per-boot token for the local API. Regenerated on every launch and never
 * written to disk, so a token captured from one run is useless in the next.
 * The server refuses token-guarded routes when this is absent rather than
 * falling back to trusting any local caller.
 */
const SERVER_TOKEN = require('crypto').randomBytes(32).toString('hex');

function startServer() {
  info(`Express API on :${SERVER_PORT}`);
  supervise('API', C.cyan, process.execPath, ['server/index.cjs'], {
    env: { ...process.env, FORCE_COLOR: '1', RAMA_SERVER_TOKEN: SERVER_TOKEN },
  });
  return waitForPort(SERVER_PORT, 25_000, '/api/health');
}

/** Resolve Vite without relying on shell PATH expansion. */
function viteInvocation() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(ROOT, 'node_modules', 'vite', 'dist', 'node', 'cli.js'),
  ];
  for (const js of candidates) {
    if (fs.existsSync(js)) {
      return { cmd: process.execPath, argv: [js, '--port', String(VITE_PORT), '--strictPort'] };
    }
  }
  return null;
}

/**
 * Is Vite actually serving the app, or merely answering the socket?
 *
 * `waitForPort` cannot tell the difference: a dev server whose index.html is
 * missing returns 404 on every request while looking completely alive to a port
 * check. That exact case shipped once — index.html was inside publicDir, so the
 * dev server had no entry and the Electron window opened onto nothing.
 * Readiness therefore means HTTP 200 *and* the app entry in the body.
 */
function viteServingApp(timeoutMs = 40_000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(
        { host: '127.0.0.1', port: VITE_PORT, path: '/', timeout: 1200 },
        (res) => {
          if (res.statusCode !== 200) { res.resume(); return retry(`HTTP ${res.statusCode}`); }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
          res.on('end', () => {
            if (body.includes('id="root"')) resolve({ ok: true });
            else retry('served a page without the app entry (id="root")');
          });
        }
      );
      req.on('error',   (e) => retry(e.code || e.message));
      req.on('timeout', ()  => { req.destroy(); retry('timeout'); });
    };

    let lastReason = 'no response';
    const retry = (reason) => {
      lastReason = reason || lastReason;
      if (Date.now() - started > timeoutMs) resolve({ ok: false, reason: lastReason });
      else setTimeout(attempt, 600);
    };

    attempt();
  });
}

function startVite() {
  const inv = viteInvocation();
  if (!inv) {
    fail('Vite could not be located in node_modules.');
    fail('Fix: npm install     (or run with --prod to use the build/ folder)');
    crashed.add('VITE');
    return Promise.resolve(false);
  }
  info(`Vite dev server on :${VITE_PORT}`);
  supervise('VITE', C.blue, inv.cmd, inv.argv);
  return viteServingApp(40_000);
}

/**
 * The shell needs *a* renderer, not specifically Vite. When the dev server does
 * not come up, build the frontend and tell Electron to use the built files
 * instead of opening a window onto nothing.
 * @returns {'vite'|'build'|'none'}
 */
function resolveRenderer(viteResult) {
  if (viteResult?.ok) return 'vite';

  warn(`Vite is not serving the app: ${viteResult?.reason ?? 'unknown'}`);
  remember(`vite not serving: ${viteResult?.reason ?? ''}`, 'Fell back to the production build', true);

  // Never hand the window a stale bundle: it would render pre-fix code and make
  // every source change look like it had no effect.
  const staleness = buildStaleness();

  if (!staleness.stale) {
    ok(`Using the existing production build (${staleness.buildAgeMin}m old, up to date)`);
    return 'build';
  }

  if (noHeal) {
    fail(`The build is stale (${staleness.reason}) and --no-heal was given.`);
    warn('Run "npm run build" to refresh it.');
    return fs.existsSync(path.join(ROOT, 'build', 'index.html')) ? 'build' : 'none';
  }

  warn(`Build is stale — ${staleness.reason}`);
  return buildFrontend('dev server unavailable and the build is out of date') ? 'build' : 'none';
}

/**
 * @param {'vite'|'build'|'none'} uiMode which renderer the shell should load
 */
function startElectron(uiMode = 'vite') {
  const bin = isWin
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

  const target = fs.existsSync(bin) ? bin : null;
  if (!target) {
    fail('Electron binary not found in node_modules/electron/dist.');
    fail('Fix: npm install electron');
    warn(`The UI is still reachable in a browser at http://localhost:${isDev ? VITE_PORT : SERVER_PORT}`);
    return null;
  }

  info(`Opening the Rāma window (renderer: ${uiMode})`);
  const proc = spawn(target, ['.'], {
    cwd:   ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      RAMA_DEV:          isDev ? '1' : '0',
      RAMA_VITE_PORT:    String(VITE_PORT),
      // Tells main.cjs which renderer to load. Without this the shell would keep
      // trying the dev server that we already know is not serving the app.
      RAMA_UI_MODE:      uiMode,
      // Same per-boot token the API got, so the shell can reach guarded routes
      RAMA_SERVER_TOKEN: SERVER_TOKEN,
    },
    shell: false,
  });
  children.push({ name: 'SHELL', proc, cmd: target, argv: ['.'], restarts: 0 });
  return proc;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 6 — FULL CAPABILITY REPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Ask the genome what is actually live. This is measured, not claimed: the
 * genome resolves each gene's engine module on this machine.
 */
function capabilityReport(degraded) {
  let genome = null;
  try {
    const g = require('./electron/genome.cjs');
    genome = g.verify();
  } catch (e) {
    warn(`Genome verification unavailable: ${e.message.slice(0, 80)}`);
  }

  process.stdout.write(`\n${C.violet}${C.bold}  CAPABILITY STATUS${C.reset}\n`);

  if (genome) {
    const colour = genome.degraded === 0 ? C.green : C.yellow;
    process.stdout.write(`   ${colour}${genome.live}/${genome.total} genes live${C.reset}\n`);
    for (const gene of genome.genes.filter(x => !x.live)) {
      process.stdout.write(`   ${C.red}✕${C.reset} ${gene.id} — ${gene.note}\n`);
    }
  }

  if (degraded.length === 0) {
    process.stdout.write(`   ${C.green}All optional subsystems present${C.reset}\n`);
  } else {
    for (const d of degraded) {
      process.stdout.write(`   ${C.yellow}◐${C.reset} ${d.module} ${d.state} — ${d.gives}\n`);
    }
    process.stdout.write(`   ${C.dim}Degraded subsystems run on their fallback path. No capability is lost outright.${C.reset}\n`);
  }

  return genome;
}

// ══════════════════════════════════════════════════════════════════════════════
// BANNER + HELP
// ══════════════════════════════════════════════════════════════════════════════

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
}

function banner() {
  const db = loadScenarios();
  process.stdout.write(`
${C.violet}${C.bold}  ██████╗  █████╗ ███╗   ███╗ █████╗${C.reset}
${C.violet}  ██╔══██╗██╔══██╗████╗ ████║██╔══██╗${C.reset}
${C.cyan}  ██████╔╝███████║██╔████╔██║███████║${C.reset}
${C.cyan}  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══██║${C.reset}
${C.violet}  ██║  ██║██║  ██║██║ ╚═╝ ██║██║  ██║${C.reset}
${C.violet}  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝${C.reset}  ${C.cyan}${C.bold}AGI${C.reset} ${C.dim}v${version()}${C.reset}

${C.dim}  Righteous Autonomous Master Agent · staged self-healing boot${C.reset}
${C.dim}  Mode ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} · Node ${process.versions.node} · ${db.scenarios.length} remembered startup scenarios${C.reset}
`);
}

function help() {
  process.stdout.write(`
${C.bold}Rāma AGI launcher${C.reset}

  node start.cjs                 Development — Vite HMR + API + Electron
  node start.cjs --prod          Production — build/ + API + Electron
  node start.cjs --build         Rebuild the frontend, then start
  node start.cjs --diagnose      Report health and exit (changes nothing)
  node start.cjs --repair        Heal what it can, then exit
  node start.cjs --probe         Refresh the dependency version probe
  node start.cjs --no-electron   API + Vite only (headless)
  node start.cjs --no-heal       Diagnose and run, never auto-install
  node start.cjs --help

${C.bold}How it boots${C.reset}

  Stage 0  Brainstem   zero-dependency checks, .env, data dirs, memory
  Stage 1  Diagnose    measure deps, native modules, ports, disk, build
  Stage 2  Self-heal   install / rebuild / free ports / build — app-scoped only
  Stage 3  Core        Express API
  Stage 4  Cortex      Vite or production build
  Stage 5  Shell       Electron window
  Stage 6  Full        verify the genome, report live vs degraded capability

  Failures and their fixes are remembered in
  data/system/startup-scenarios.json, so repeat problems are recognised
  and resolved without asking you.
`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  if (showHelp) { help(); return; }

  const t0 = Date.now();

  // ── Stage 0 — Brainstem ─────────────────────────────────────────────────────
  ensureUtf8Console();
  banner();
  stage(0, 'BRAINSTEM — minimal viable boot');
  checkNode();
  ensureDirs();
  ok('Data directories ready');
  loadEnv();
  ok('Environment loaded');

  // ── Version probe (first run, stale cache, or explicit) ─────────────────────
  const age = probeAge();
  if (doProbe || age === null || age > 7 * 86_400_000) {
    await probeVersions();
  }

  // ── Stage 1 — Diagnose ──────────────────────────────────────────────────────
  stage(1, 'DIAGNOSE — measuring the environment');
  let { defects, report, degraded } = diagnose();
  printReport(report);

  const fatal = defects.filter(d => d.severity === 'fatal');
  const warns = defects.filter(d => d.severity === 'warn');
  const degs  = defects.filter(d => d.severity === 'degrade');

  process.stdout.write(`\n   ${fatal.length ? C.red : C.green}${fatal.length} blocking${C.reset}` +
                       ` · ${warns.length ? C.yellow : C.dim}${warns.length} warning${C.reset}` +
                       ` · ${degs.length ? C.yellow : C.dim}${degs.length} degraded${C.reset}\n`);

  if (diagnoseOnly) {
    for (const d of defects) {
      const glyph = d.severity === 'fatal' ? `${C.red}✕` : `${C.yellow}!`;
      process.stdout.write(`   ${glyph}${C.reset} ${d.detail}\n      ${C.dim}fix: ${d.fix}${C.reset}\n`);
    }
    process.stdout.write(`\n   ${C.dim}Run "node start.cjs --repair" to let Rāma fix these.${C.reset}\n\n`);
    return;
  }

  // ── Stage 2 — Self-heal ─────────────────────────────────────────────────────
  let fellBackToDev = false;
  if (defects.length > 0) {
    stage(2, 'SELF-HEAL — resolving its own startup defects');
    const healResult = selfHeal(defects);
    fellBackToDev = healResult.fellBackToDev;

    for (const h of healResult.healed) ok(h);

    const stillFatal = healResult.unhealed.filter(d => d.severity === 'fatal');
    if (stillFatal.length > 0) {
      process.stdout.write(`\n${C.red}${C.bold}  Cannot continue — ${stillFatal.length} blocking issue(s):${C.reset}\n`);
      for (const d of stillFatal) {
        process.stdout.write(`   ${C.red}✕${C.reset} ${d.detail}\n      ${C.dim}fix: ${d.fix}${C.reset}\n`);
      }
      recordBoot({ ok: false, stage: 'self-heal', blocking: stillFatal.map(d => d.id) });
      process.exit(1);
    }

    // Re-measure so the capability report reflects reality after healing
    const after = diagnose();
    degraded = after.degraded;
  } else {
    stage(2, 'SELF-HEAL — nothing to repair');
    ok('Environment already healthy');
  }

  if (repairOnly) {
    process.stdout.write(`\n   ${C.green}Repair pass complete.${C.reset} ${C.dim}Run "node start.cjs" to launch.${C.reset}\n\n`);
    recordBoot({ ok: true, stage: 'repair-only' });
    return;
  }

  // An explicit --build request outside of the defect path
  if (doBuild) {
    stage(2.5, 'BUILD — rebuilding the frontend on request');
    if (!buildFrontend('--build requested') && isProd) {
      fail('Production mode needs a build. Falling back to development mode.');
      fellBackToDev = true;
    }
  }

  const useDev = isDev || fellBackToDev;

  // ── Stage 3 — Core ──────────────────────────────────────────────────────────
  stage(3, 'CORE — local API');
  const apiUp = await startServer();
  if (apiUp) ok(`API ready → http://localhost:${SERVER_PORT}/api/health`);
  else warn('API did not answer in time — continuing; the desktop app works over IPC regardless');

  // ── Stage 4 — Cortex ────────────────────────────────────────────────────────
  // The goal is a renderer, not specifically Vite. If the dev server will not
  // serve the app, fall back to the build so the window still has something to
  // show — a blank window is never an acceptable outcome.
  let uiPort = SERVER_PORT;
  let uiMode = 'build';

  if (useDev) {
    stage(4, 'CORTEX — Vite development server');
    const viteResult = await startVite();
    uiMode = resolveRenderer(viteResult);

    if (uiMode === 'vite') {
      ok(`Vite ready → http://localhost:${VITE_PORT}`);
      uiPort = VITE_PORT;
    } else if (uiMode === 'build') {
      warn('Running the window against the production build instead of HMR');
      warn(`Fix HMR by resolving the [VITE] output above, then restart`);
    } else {
      fail('No renderer is available — the window will show a startup diagnostic.');
      warn(`The API is still available at http://localhost:${SERVER_PORT}/api/health`);
    }
  } else {
    stage(4, 'CORTEX — production build');
    const staleness = buildStaleness();

    if (!staleness.stale) {
      ok(`Serving the prebuilt frontend from build/ (${staleness.buildAgeMin}m old, up to date)`);
    } else if (noHeal) {
      warn(`Build is stale — ${staleness.reason}. Run "npm run build".`);
      uiMode = fs.existsSync(path.join(ROOT, 'build', 'index.html')) ? 'build' : 'none';
    } else {
      warn(`Build is stale — ${staleness.reason}`);
      uiMode = buildFrontend('the build is out of date') ? 'build' : 'none';
      if (uiMode === 'none') fail('No usable build — the window will show a startup diagnostic.');
    }
  }

  // ── Stage 5 — Shell ─────────────────────────────────────────────────────────
  let shell = null;
  if (!noElectron) {
    stage(5, 'SHELL — desktop window');
    shell = startElectron(uiMode);
  } else {
    stage(5, 'SHELL — skipped (--no-electron)');
    info(`Open the UI in a browser: http://localhost:${uiPort}`);
  }

  // ── Stage 6 — Full capability ───────────────────────────────────────────────
  stage(6, 'FULL — capability verification');
  const genome = capabilityReport(degraded);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  // A Vite crash is no longer unhealthy on its own — the build fallback covers
  // it. What matters is that a renderer exists and the API answered.
  const healthy = !crashed.has('API') && uiMode !== 'none';

  process.stdout.write(`
${healthy ? `${C.green}${C.bold}  ✓ Rāma is awake${C.reset}` : `${C.yellow}${C.bold}  ◐ Rāma is awake with reduced capability${C.reset}`}

  ${C.cyan}${C.bold}UI${C.reset}        ${noElectron ? `http://localhost:${uiPort}` : 'desktop window'}
  ${C.cyan}API${C.reset}       http://localhost:${SERVER_PORT}/api/health
  ${C.cyan}Boot${C.reset}      ${elapsed}s · stage 6/6
  ${C.cyan}Security${C.reset}  AES-256-GCM + Argon2id · passcode required to unlock

  ${C.dim}Ctrl+C to stop · node start.cjs --diagnose for a health report${C.reset}
`);

  recordBoot({
    ok: healthy, stage: 'full', elapsedMs: Date.now() - t0,
    degraded: degraded.map(d => d.module),
    genes: genome ? `${genome.live}/${genome.total}` : null,
  });

  // Keep the launcher alive: it is the supervisor for every child process.
  if (shell) {
    shell.on('close', (code) => {
      info('Window closed — shutting the rest of Rāma down');
      stopAll(code ?? 0);
    });
  }
}

main().catch((e) => {
  fail(`Fatal startup error: ${e.message}`);
  remember(e.message ?? 'startup crash', 'See the error above; restart to retry the auto-repair', false);
  recordBoot({ ok: false, stage: 'fatal', error: e.message });
  process.exit(1);
});
