'use strict';

/**
 * buildInstaller.cjs — Rāma's self-preparing packaging pipeline.
 *
 * WHY THIS EXISTS: `npm run build:win` is `vite build && electron-builder`, which
 * assumes an already-prepared machine. On a fresh clone there is no `vite`, so the
 * whole thing dies on "'vite' is not recognized" — which looks like a dependency
 * problem and is one, but nothing on the packaging path knew how to fix it.
 * `start.cjs` has diagnosed and repaired its own environment for a long time;
 * this gives packaging the same treatment. See SECTION 45 of the master spec.
 *
 * Stages:
 *   0  TOOLCHAIN     Node, npm, project sanity, free disk
 *   1  DEPENDENCIES  audit against package.json, install through a ladder
 *   2  RENDERER      vite build (always — a release must not ship a stale bundle)
 *   3  ARCHIVER      resolve a *usable* 7-Zip, or decide installers are impossible
 *   4  PACKAGE       electron-builder with the target set stage 3 allows
 *   5  REPORT        what actually landed on disk, and what did not
 *
 * `npm run build:win` is deliberately left untouched as the raw escape hatch.
 *
 * Usage: node scripts/buildInstaller.cjs [--win|--mac|--linux] [--dir]
 *                                        [--skip-install] [--skip-renderer]
 */

const { execSync, spawnSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

// ─── Flags ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has  = (f) => args.includes(f);

const showHelp     = has('--help') || has('-h');
const skipInstall  = has('--skip-install');
const skipRenderer = has('--skip-renderer');
const forceDir     = has('--dir');
// Re-test archivers that were already found to be blocked. Off by default: on a
// machine with endpoint security, every attempt to start the blocked binary
// raises a policy dialog at the master, and re-asking a settled question is not
// worth interrupting them for.
const recheck      = has('--recheck-archiver');
// Report what the machine can do and stop before anything is built. Exists so
// the preparation stages can be verified on a machine where packaging itself is
// blocked by policy — the situation that prompted this script.
const dryRun       = has('--dry-run');
const wantMac      = has('--mac');
const wantLinux    = has('--linux');
const wantWin      = has('--win') || (!wantMac && !wantLinux);

// ─── Output (same vocabulary as start.cjs) ────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', violet: '\x1b[35m',
};

// ─── Transcript ───────────────────────────────────────────────────────────────
// Packaging usually happens on a machine that is not the one with the editor
// open, so "it failed" arrives without the output that says why. Everything
// printed here, and everything printed by every command this runs, is also
// written to a plain-text log that can simply be sent as a file.
const LOG_FILE = path.join(ROOT, 'data', 'logs', `build-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
let logStream = null;

function openLog() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    logStream.on('error', () => { logStream = null; });
    logStream.write(`Rāma AGI packaging log\n`);
    logStream.write(`started  ${new Date().toISOString()}\n`);
    logStream.write(`node     ${process.version} on ${process.platform}-${process.arch}\n`);
    logStream.write(`root     ${ROOT}\n`);
    logStream.write(`argv     ${args.join(' ') || '(none)'}\n\n`);
  } catch { logStream = null; }
}

// ANSI escapes are for the terminal; a log file wants them gone.
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

function logWrite(text) {
  if (!logStream) return;
  try { logStream.write(strip(text)); } catch { /* the build matters more */ }
}

function emit(text) {
  process.stdout.write(text);
  logWrite(text);
}

const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const line  = (glyph, colour, msg) =>
  emit(`${C.dim}${clock()}${C.reset} ${colour}${glyph}${C.reset} ${msg}\n`);

const ok    = (m) => line('✓', C.green,  m);
const warn  = (m) => line('!', C.yellow, m);
const fail  = (m) => line('✕', C.red,    m);
const info  = (m) => line('·', C.cyan,   m);
const plain = (m) => emit(`${m}\n`);
const stage = (n, m) => emit(
  `\n${C.violet}${C.bold}▸ STAGE ${n}${C.reset}  ${C.bold}${m}${C.reset}\n`);

// ─── Shell helpers ────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, cwd: ROOT, ...opts }).trim();
}
function tryRun(cmd, opts = {}) {
  try { return { ok: true, out: run(cmd, opts) }; }
  catch (e) { return { ok: false, error: e.message ?? String(e), out: e.stdout?.toString?.() ?? '' }; }
}
/**
 * Run a command, streaming its output live *and* into the transcript.
 *
 * Not execSync with stdio:'inherit', which shows the output but keeps no copy,
 * and not spawnSync with piped stdio, which keeps a copy but shows nothing until
 * the command finishes — unacceptable for a ten-minute npm install. Async spawn
 * with a tee is the only shape that does both.
 *
 * Never rejects: the caller decides what a failure means.
 * @returns {Promise<{ok:boolean, code:number|null, tail:string, error?:string}>}
 */
function runTee(cmd, timeoutMs = 30 * 60_000) {
  return new Promise((resolve) => {
    logWrite(`\n$ ${cmd}\n`);

    let child;
    try {
      child = spawn(cmd, { cwd: ROOT, shell: true, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, code: null, tail: '', error: e.message ?? String(e) });
    }

    // The last few lines are what a failure report needs; the whole output can
    // be megabytes and it is already in the log.
    const recent = [];
    const onData = (buf) => {
      const s = buf.toString();
      emit(s);
      recent.push(s);
      if (recent.length > 40) recent.shift();
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already gone */ }
    }, timeoutMs);

    const tail = () => recent.join('').split(/\r?\n/).filter(Boolean).slice(-12).join('\n');

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, tail: tail(), error: e.message ?? String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, code, tail: tail(), error: `timed out after ${Math.round(timeoutMs / 60000)} minutes` });
        return;
      }
      resolve({ ok: code === 0, code, tail: tail() });
    });
  });
}

// Native modules with working fallbacks: they may fail to compile without
// Visual Studio Build Tools, and Rāma already runs without them (scrypt instead
// of Argon2id, a piped shell instead of a real pty). Degraded, never fatal.
const TOLERATED = new Set(['argon2', 'node-pty']);

let manifest = null;
function pkg() {
  if (manifest) return manifest;
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return manifest;
}
const appVersion = () => pkg().version ?? '0.0.0';

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 0 — TOOLCHAIN
// ══════════════════════════════════════════════════════════════════════════════

function freeDiskMB() {
  try {
    if (isWin) {
      const drive = ROOT.split(':')[0];
      const r = tryRun(`powershell -NoProfile -NonInteractive -Command "(Get-PSDrive ${drive}).Free"`);
      if (!r.ok) return null;
      const bytes = Number(String(r.out).trim());
      return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1048576) : null;
    }
    const r = tryRun(`df -k "${ROOT}"`);
    if (!r.ok) return null;
    const cols = r.out.trim().split('\n').pop().split(/\s+/);
    const kb = Number(cols[3]);
    return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
  } catch { return null; }
}

/** @returns {boolean} false means stop: the environment cannot package anything. */
function checkToolchain() {
  stage(0, 'TOOLCHAIN — can this machine package at all');

  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 18) {
    fail(`Node.js ${process.versions.node} — packaging needs v18 minimum, v22 LTS recommended.`);
    fail('Download: https://nodejs.org/en/download');
    return false;
  }
  ok(`Node.js ${process.versions.node}`);

  const npm = tryRun('npm --version');
  if (!npm.ok) {
    fail('npm is not on PATH. Reinstall Node.js from nodejs.org (npm ships with it).');
    return false;
  }
  ok(`npm ${npm.out}`);

  // Project sanity: running this from the wrong directory would install a
  // stranger's dependencies and package the wrong thing.
  let name;
  try { name = pkg().name; }
  catch (e) {
    fail(`package.json could not be read at ${ROOT} (${e.message})`);
    return false;
  }
  if (name !== 'rama-agi') {
    fail(`This is not the Rāma project root — package.json says "${name}".`);
    return false;
  }
  ok(`Project rama-agi v${appVersion()} at ${ROOT}`);

  const disk = freeDiskMB();
  if (disk === null) {
    warn('Free disk space could not be measured — continuing');
  } else if (disk < 1200) {
    fail(`Only ${disk} MB free. Packaging Electron needs the unpacked tree plus the installer.`);
    fail('Free up space and run this again — nothing has been changed.');
    return false;
  } else if (disk < 3000) {
    warn(`${disk} MB free — tight. Packaging may fail late, near the end.`);
  } else {
    ok(`Disk space ${disk} MB free`);
  }

  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 1 — DEPENDENCIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The expected set is derived from package.json rather than hardcoded, so this
 * check cannot drift as the manifest changes.
 */
function expectedDeps() {
  const p = pkg();
  const all = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
  return Object.keys(all).sort().map(name => ({ name, want: all[name] }));
}

/**
 * Versions are pinned exact (invariant I12), so equality is the correct test.
 * A bare existence check would pass a stale node_modules left from an older
 * manifest — which packages fine and then misbehaves on the master's machine.
 */
function depState(name, want) {
  const pj = path.join(ROOT, 'node_modules', name, 'package.json');
  if (!fs.existsSync(pj)) return { state: 'missing' };
  let got;
  try { got = JSON.parse(fs.readFileSync(pj, 'utf8')).version; }
  catch { return { state: 'broken' }; }
  if (typeof got !== 'string') return { state: 'broken' };
  return { state: got === want ? 'ok' : 'mismatch', got };
}

function auditDeps() {
  const required = [];
  const degraded = [];
  for (const d of expectedDeps()) {
    const s = depState(d.name, d.want);
    if (s.state === 'ok') continue;
    (TOLERATED.has(d.name) ? degraded : required).push({ ...d, ...s });
  }
  return { required, degraded };
}

/** Does a native module's entry point load? Checked out-of-process. */
function nativeLoads(name) {
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(name)})`], {
    cwd: ROOT, timeout: 30_000, encoding: 'utf8', windowsHide: true,
  });
  return r.status === 0;
}

/**
 * Is there a compiled binary this platform could actually load?
 *
 * `require()` succeeding is not sufficient evidence, measured here: `node-pty`
 * imports cleanly while `node_modules/node-pty/build` holds no `.node` at all,
 * because it resolves its addon lazily at terminal-construction time. A build
 * would then package a module that cannot work, and the failure would surface on
 * the master's machine as a dead terminal rather than here as a warning.
 *
 * @returns {string|null} the relative path of the matching binary, or null
 */
function nativeBinaryPresent(name) {
  const root   = path.join(ROOT, 'node_modules', name);
  const wanted = `${process.platform}-${process.arch}`;
  let found = null;

  const visit = (dir, depth) => {
    if (found || depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { visit(full, depth + 1); continue; }
      if (!e.name.endsWith('.node')) continue;

      const rel = path.relative(root, full).split(path.sep).join('/');
      // A prebuilds/ tree carries every platform, so only the matching one counts.
      if (rel.includes('prebuilds/')) {
        if (rel.includes(wanted)) { found = rel; return; }
        continue;
      }
      // Anything else (build/Release/*.node) was compiled here, for here.
      found = rel;
      return;
    }
  };

  visit(root, 0);
  return found;
}

function describe(d) {
  if (d.state === 'missing')  return `${d.name} — not installed (want ${d.want})`;
  if (d.state === 'mismatch') return `${d.name} — ${d.got} installed, ${d.want} pinned`;
  return `${d.name} — present but unreadable`;
}

async function installLadder() {
  const hasLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));
  const hasMods = fs.existsSync(path.join(ROOT, 'node_modules'));

  const rungs = [];
  // `npm ci` is lockfile-exact and starts clean, which is what pinned versions
  // want — but it deletes node_modules, so it is only correct when there is
  // nothing there to preserve.
  if (hasLock && !hasMods) rungs.push('npm ci --no-audit --no-fund');
  rungs.push('npm install --no-audit --no-fund');
  rungs.push('npm install --no-audit --no-fund --legacy-peer-deps');
  rungs.push('npm install --no-audit --no-fund --ignore-scripts');

  let lastTail = '';
  for (const cmd of rungs) {
    info(cmd);
    const r = await runTee(cmd);
    if (r.ok) {
      ok(`Dependencies installed via: ${cmd}`);
      return { ok: true, cmd, skippedScripts: cmd.includes('--ignore-scripts') };
    }
    warn(`Failed: ${cmd}${r.error ? ` (${r.error})` : ` (exit ${r.code})`}`);
    lastTail = r.tail || lastTail;
  }
  return { ok: false, tail: lastTail };
}

/** @returns {Promise<{ok:boolean, degraded:string[]}>} */
async function ensureDependencies() {
  stage(1, 'DEPENDENCIES — what is missing, and installing it');

  const notes = [];
  let audit = auditDeps();
  const total = expectedDeps().length;

  if (audit.required.length === 0) {
    ok(`All ${total} pinned packages present at the pinned versions`);
  } else {
    warn(`${audit.required.length} of ${total} package(s) need installing:`);
    for (const d of audit.required.slice(0, 12)) plain(`      ${describe(d)}`);
    if (audit.required.length > 12) plain(`      … and ${audit.required.length - 12} more`);

    if (skipInstall) {
      fail('--skip-install was passed, so nothing will be installed. Cannot continue.');
      return { ok: false, degraded: notes };
    }

    const installed = await installLadder();
    if (!installed.ok) {
      fail('Every install strategy failed. The most likely causes:');
      fail('  · no internet access, or a proxy that blocks the npm registry');
      fail('  · a corporate registry mirror that needs configuring (npm config get registry)');
      if (installed.tail) {
        plain('');
        plain(`  ${C.bold}Last output from npm:${C.reset}`);
        for (const l of installed.tail.split('\n')) plain(`    ${l}`);
      }
      return { ok: false, degraded: notes };
    }
    if (installed.skippedScripts) {
      notes.push('installed with --ignore-scripts: native modules were not compiled');
    }

    // Re-audit. A half-installed tree packages "successfully" and then fails on
    // the master's machine instead of here, which is strictly worse.
    audit = auditDeps();
    if (audit.required.length > 0) {
      fail(`${audit.required.length} package(s) are still not right after installing:`);
      for (const d of audit.required) plain(`      ${describe(d)}`);
      return { ok: false, degraded: notes };
    }
    ok('Re-checked after install — all required packages resolve');
  }

  for (const d of audit.degraded) {
    warn(`${describe(d)} — optional, Rāma has a fallback for it`);
    notes.push(`${d.name} unavailable (fallback active)`);
  }

  // Present at the right version is not the same as usable, for native code.
  for (const name of TOLERATED) {
    if (audit.degraded.some(d => d.name === name)) continue;

    const binary = nativeBinaryPresent(name);
    if (!binary) {
      warn(`${name} has no compiled binary for ${process.platform}-${process.arch}`);
      warn(`  The packaged app will run on its fallback. To have the real thing:`);
      warn(`  install Visual Studio Build Tools (Desktop development with C++), then npm rebuild ${name}`);
      notes.push(`${name} not compiled (fallback active)`);
      continue;
    }
    if (!nativeLoads(name)) {
      warn(`${name} has a binary (${binary}) but does not load — fallback will be used`);
      notes.push(`${name} binding broken (fallback active)`);
      continue;
    }
    ok(`${name} native binary present — ${binary}`);
  }

  return { ok: true, degraded: notes };
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2 — RENDERER
// ══════════════════════════════════════════════════════════════════════════════

async function buildRenderer() {
  stage(2, 'RENDERER — building the production bundle');

  if (skipRenderer) {
    const index = path.join(ROOT, 'build', 'index.html');
    if (!fs.existsSync(index)) {
      fail('--skip-renderer was passed but build/index.html does not exist.');
      return false;
    }
    warn('--skip-renderer: reusing the existing build/, which may be stale');
    return true;
  }

  // Unconditional, never gated on a staleness heuristic. Ledger row 43 is the
  // record of what shipping a stale bundle costs: every fix looks ineffective.
  info('vite build');
  const r = await runTee('npm run build', 15 * 60_000);
  if (r.ok) {
    ok('Renderer built → build/');
    return true;
  }
  fail(`Renderer build failed${r.error ? `: ${r.error}` : ` (exit ${r.code})`}`);
  fail('Packaging stopped — there is no bundle to package.');
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 3 — ARCHIVER
//
// electron-builder needs a 7-Zip binary for the NSIS payload (`app.7z`), the
// portable target, and any zip/7z target — but NOT for `--dir`. Verified against
// the installed electron-builder@24.13.3:
//   app-builder-lib/out/targets/archive.js:48,173
//   app-builder-lib/out/targets/nsis/NsisTarget.js:217
//   builder-util/out/util.js:336   (SZA_PATH passed to app-builder.exe)
// Every one of them resolves through 7zip-bin's path, which is why that path is
// the single interception point used below.
// ══════════════════════════════════════════════════════════════════════════════

function bundled7zaPath() {
  const dir = path.join(ROOT, 'node_modules', '7zip-bin');
  if (!fs.existsSync(dir)) return null;
  if (isWin)                       return path.join(dir, 'win',   process.arch, '7za.exe');
  if (process.platform === 'darwin') return path.join(dir, 'mac', process.arch, '7za');
  return path.join(dir, 'linux', process.arch, '7za');
}

/**
 * The probe runs in a throwaway child Node process, and the path is passed by
 * environment variable so there is no argv or quoting ambiguity.
 *
 * WHY A CHILD PROCESS AND NOT A DIRECT spawnSync: measured on the work machine,
 * asking Windows to start the policy-blocked 7za.exe does not return an error —
 * it terminates *the process that asked*. Node dies with 0xC0000003 after
 * "AssignProcessToJobObject: (6) The handle is invalid", and nothing after the
 * spawn call ever runs, so no error handling in this file could have caught it.
 * Isolating the attempt means the blocked binary can only kill the probe.
 */
const PROBE_SRC = `
'use strict';
const { spawnSync } = require('child_process');
const exe = process.env.RAMA_PROBE_EXE;
const r = spawnSync(exe, ['i'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
process.stdout.write(JSON.stringify({
  spawnError: r.error ? (r.error.code || r.error.message) : null,
  status: r.status,
  signal: r.signal,
  out: ((r.stdout || '') + (r.stderr || '')).slice(0, 600),
}));
`;

// ─── Remembered verdicts ──────────────────────────────────────────────────────
// Probing means *starting* the binary, and on a machine with endpoint security
// that raises a dialog the master has to dismiss. The answer only changes when
// the binary changes, so it is fingerprinted by size+mtime and remembered.
// Same principle as start.cjs's scenario memory, and it lives beside it.
const MEMO_FILE = path.join(ROOT, 'data', 'system', 'archiver-probe.json');

function loadMemo() {
  try {
    const db = JSON.parse(fs.readFileSync(MEMO_FILE, 'utf8'));
    if (db && typeof db.results === 'object' && db.results !== null) return db;
  } catch { /* absent or corrupt — a fresh memo is always safe */ }
  return { version: 1, results: {} };
}

function saveMemo(db) {
  try {
    fs.mkdirSync(path.dirname(MEMO_FILE), { recursive: true });
    fs.writeFileSync(MEMO_FILE, JSON.stringify(db, null, 2));
  } catch { /* a memo is an optimisation, never a requirement */ }
}

const memoKey = (exe) => (isWin ? exe.toLowerCase() : exe);

function fingerprint(exe) {
  try {
    const st = fs.statSync(exe);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch { return null; }
}

/**
 * Execute the candidate and require it to identify itself as 7-Zip.
 *
 * A name match alone is not evidence — the same shortcut once made Whisper
 * detection "find" C:\Windows\System32\main.cpl (ledger row 38). A non-zero exit
 * from 7-Zip itself is fine: an old 7zr rejects the `i` subcommand but still
 * prints its banner, and "it started and it is 7-Zip" is the capability tested.
 */
function probe7za(exe) {
  if (!exe) return { ok: false, reason: '7zip-bin is not installed' };
  if (path.isAbsolute(exe) && !fs.existsSync(exe)) return { ok: false, reason: 'file is missing' };

  const fp   = fingerprint(exe);
  const key  = memoKey(exe);
  const memo = loadMemo();
  const seen = memo.results[key];

  if (!recheck && seen && fp && seen.fingerprint === fp && seen.verdict) {
    return { ...seen.verdict, remembered: seen.at ?? true };
  }

  const verdict = executeProbe(exe);

  if (fp) {
    memo.results[key] = { fingerprint: fp, verdict, at: new Date().toISOString() };
    saveMemo(memo);
  }
  return verdict;
}

function executeProbe(exe) {
  const child = spawnSync(process.execPath, ['-e', PROBE_SRC], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, RAMA_PROBE_EXE: exe },
  });

  // The probe process itself did not survive: the classic signature of an
  // endpoint-security block, since a merely missing or corrupt file would have
  // come back as a normal spawn error instead.
  if (child.status !== 0 || !child.stdout) {
    const code = child.status === null ? (child.signal ?? 'terminated') : `0x${(child.status >>> 0).toString(16)}`;
    return { ok: false, blocked: true, reason: `blocked before it could start (probe died, ${code})` };
  }

  let r;
  try { r = JSON.parse(child.stdout); }
  catch { return { ok: false, reason: 'the probe returned nothing readable' }; }

  if (r.spawnError) return { ok: false, blocked: true, reason: `could not be started (${r.spawnError})` };
  if (r.status === null) {
    return { ok: false, blocked: true, reason: `terminated without an exit code (${r.signal ?? 'no signal'})` };
  }
  if (!/7-Zip/i.test(r.out ?? '')) return { ok: false, reason: 'ran but did not identify itself as 7-Zip' };

  const m = (r.out ?? '').match(/7-Zip[^\r\n]*?(\d+\.\d+)/);
  return { ok: true, version: m ? m[1] : 'unknown' };
}

/** Self-contained binaries first; 7z.exe needs its DLL carried along. */
function systemCandidates() {
  const found = [];
  const push = (p) => { if (p && fs.existsSync(p) && !found.includes(p)) found.push(p); };

  if (isWin) {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramW6432,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    ].filter(Boolean);

    const dirs = [];
    for (const r of roots) dirs.push(path.join(r, '7-Zip'), path.join(r, 'NanaZip'));

    const reg = tryRun('reg query "HKLM\\SOFTWARE\\7-Zip" /v Path');
    if (reg.ok) {
      const m = reg.out.match(/Path\s+REG_[A-Z_]+\s+(.+)/);
      if (m) dirs.push(m[1].trim());
    }

    for (const d of dirs) for (const n of ['7za.exe', '7z.exe', '7zr.exe']) push(path.join(d, n));

    for (const n of ['7za', '7z', '7zr']) {
      const w = tryRun(`where ${n}`);
      if (w.ok) for (const l of w.out.split('\n')) push(l.trim());
    }
  } else {
    for (const n of ['7za', '7z', '7zr']) {
      const w = tryRun(`command -v ${n}`);
      if (w.ok && w.out.trim()) push(w.out.trim());
    }
  }

  const rank = (p) => {
    const b = path.basename(p).toLowerCase();
    if (b.startsWith('7za')) return 0;   // standalone console, self-contained
    if (b.startsWith('7z.')) return 1;   // full featured, needs 7z.dll beside it
    return 2;                            // 7zr — .7z only, which is all NSIS needs
  };
  return found.sort((a, b) => rank(a) - rank(b));
}

/**
 * Put `src` where 7zip-bin says the archiver lives, preserving the original once.
 *
 * Why not USE_SYSTEM_7ZA=true, which 7zip-bin documents: it makes path7za the
 * bare string "7za", and builder-util/out/7za.js:7 then calls chmod() on it.
 * On Windows that resolves against the CWD, finds no file literally named "7za",
 * and throws ENOENT. The flag is unusable here.
 */
function stage7za(src) {
  const target = bundled7zaPath();
  if (!target) return { ok: false, reason: '7zip-bin is not installed' };

  const dir  = path.dirname(target);
  const keep = `${target}.bundled`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(target) && !fs.existsSync(keep)) fs.copyFileSync(target, keep);

    if (path.basename(src).toLowerCase() === '7z.exe') {
      const dll = path.join(path.dirname(src), '7z.dll');
      if (!fs.existsSync(dll)) return { ok: false, reason: '7z.exe found without its 7z.dll' };
      fs.copyFileSync(dll, path.join(dir, '7z.dll'));
    }

    fs.copyFileSync(src, target);
    if (!isWin) fs.chmodSync(target, 0o755);
    return { ok: true, target };
  } catch (e) {
    return { ok: false, reason: e.message ?? String(e) };
  }
}

function restoreBundled7za() {
  const target = bundled7zaPath();
  if (!target) return;
  const keep = `${target}.bundled`;
  if (!fs.existsSync(keep)) return;
  try { fs.copyFileSync(keep, target); } catch { /* best effort — L2 does not need it */ }
}

/** @returns {{level:0|1|2, version?:string, source?:string, reason?:string}} */
function resolveArchiver() {
  stage(3, 'ARCHIVER — is a usable 7-Zip actually reachable');

  const bundled = bundled7zaPath();

  const l0 = probe7za(bundled);
  const recalled = (v) => (typeof v.remembered === 'string'
    ? ` (remembered from ${v.remembered.slice(0, 16).replace('T', ' ')})`
    : v.remembered ? ' (remembered)' : '');

  if (l0.ok) {
    ok(`L0 bundled 7-Zip ${l0.version}${recalled(l0)} — installer targets available`);
    return { level: 0, version: l0.version, source: bundled };
  }
  warn(`Bundled 7-Zip is unusable: ${l0.reason}${recalled(l0)}`);
  if (l0.blocked) {
    warn('  A binary that exists but will not start is normally endpoint security,');
    warn('  not a broken file. 7zip-bin ships 7-Zip 21.07, which some policies flag.');
  }
  if (l0.remembered) {
    info('  Not retried, so no policy dialog is raised. Force one: --recheck-archiver');
  }

  const candidates = systemCandidates();
  if (candidates.length === 0) {
    info('No system 7-Zip found to fall back to');
  }
  for (const cand of candidates) {
    const p = probe7za(cand);
    if (!p.ok) { info(`${cand} — ${p.reason}${recalled(p)}`); continue; }

    ok(`L1 system 7-Zip ${p.version} at ${cand}`);
    const staged = stage7za(cand);
    if (!staged.ok) { warn(`  Could not stage it: ${staged.reason}`); continue; }

    const after = probe7za(bundled);
    if (after.ok) {
      ok(`Staged over ${path.relative(ROOT, staged.target)} — installer targets available`);
      return { level: 1, version: after.version, source: cand };
    }
    warn(`  The staged copy will not start either: ${after.reason}`);
    restoreBundled7za();
  }

  warn('L2 no usable 7-Zip — NSIS and portable-exe targets are not reachable here.');
  warn('  Building the unpacked app instead and zipping it without an external archiver.');
  return { level: 2, reason: l0.reason };
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 4 — PACKAGE
// ══════════════════════════════════════════════════════════════════════════════

function platformFlags() {
  const f = [];
  if (wantWin)   f.push('--win');
  if (wantMac)   f.push('--mac');
  if (wantLinux) f.push('--linux');
  if (wantWin && !wantMac && !wantLinux) f.push('--x64');
  return f;
}

async function packageApp(dirOnly) {
  stage(4, dirOnly ? 'PACKAGE — unpacked application tree' : 'PACKAGE — installer');

  const flags = platformFlags();
  if (dirOnly) {
    flags.push('--dir');
    // MEASURED, not assumed: `--dir` alone is still not enough on a machine where
    // 7za is blocked. After the app tree is packed, electron-builder downloads
    // winCodeSign-2.6.0.7z and extracts it *with 7za* for the sign/edit-executable
    // step — even with no certificate configured — and fails there four times over.
    // Turning that step off is what makes this rung reachable at all.
    //
    // The cost, stated rather than hidden: the launcher .exe keeps Electron's
    // default icon and version metadata, because rcedit is part of the step being
    // skipped. The application itself is complete and runs normally.
    if (wantWin) flags.push('-c.win.signAndEditExecutable=false');
  }

  // electron-builder directly, not `npm run build:win` — that would run
  // `vite build` a second time.
  const cmd = `npx electron-builder ${flags.join(' ')}`;
  info(cmd);
  const r = await runTee(cmd);
  if (r.ok) {
    ok(dirOnly ? 'Unpacked application built' : 'electron-builder finished');
    return { ok: true };
  }

  fail(`electron-builder failed${r.error ? `: ${r.error}` : ` (exit ${r.code})`}`);
  if (r.tail) {
    plain('');
    plain(`  ${C.bold}Last output from electron-builder:${C.reset}`);
    for (const l of r.tail.split('\n')) plain(`    ${l}`);
    plain('');
  }
  return { ok: false, tail: r.tail };
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Zip the unpacked tree with no external archiver: .NET's ZipFile on Windows
 * (present on every supported Windows, nothing for a policy to block), zip/tar
 * elsewhere. This is what makes L2 still produce something distributable.
 */
async function zipUnpacked() {
  const outDir = path.join(ROOT, 'dist-electron');
  let unpacked = [];
  try {
    unpacked = fs.readdirSync(outDir)
      .filter(n => n.endsWith('-unpacked'))
      .map(n => path.join(outDir, n))
      .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch {
    fail('dist-electron/ does not exist — nothing was packaged');
    return null;
  }
  if (unpacked.length === 0) {
    fail('No *-unpacked directory in dist-electron/ — nothing to zip');
    return null;
  }

  const src = unpacked[0];
  const zip = path.join(outDir, `Rama-AGI-${appVersion()}-${path.basename(src)}-portable.zip`);
  if (fs.existsSync(zip)) {
    try { fs.rmSync(zip); } catch { /* overwritten or reported below */ }
  }

  info(`Zipping ${path.basename(src)} → ${path.basename(zip)} (this takes a minute)`);

  let r;
  let produced = zip;
  if (isWin) {
    r = await runTee(
      'powershell -NoProfile -NonInteractive -Command ' +
      `"Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(src)}, ${psQuote(zip)}, ` +
      `[System.IO.Compression.CompressionLevel]::Optimal, $true)"`,
    );
  } else if (tryRun('command -v zip').ok) {
    r = await runTee(`cd "${outDir}" && zip -r -q "${path.basename(zip)}" "${path.basename(src)}"`);
  } else {
    produced = zip.replace(/\.zip$/, '.tar.gz');
    r = await runTee(`tar -czf "${produced}" -C "${outDir}" "${path.basename(src)}"`);
  }

  if (!r.ok) {
    fail(`Archiving failed${r.error ? `: ${r.error}` : ` (exit ${r.code})`}`);
    warn(`The unpacked app is still usable directly: ${path.relative(ROOT, src)}`);
    return null;
  }
  if (produced !== zip) {
    ok(`Archive written → ${path.relative(ROOT, produced)}`);
    return produced;
  }

  if (!fs.existsSync(zip)) {
    fail('The archiver reported success but no file was written');
    return null;
  }
  ok(`Archive written → ${path.relative(ROOT, zip)}`);
  return zip;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 5 — REPORT
// ══════════════════════════════════════════════════════════════════════════════

const MB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

function report({ archiver, dirOnly, degraded, archive }) {
  stage(5, 'REPORT — what is on disk');

  const outDir = path.join(ROOT, 'dist-electron');
  let entries = [];
  try { entries = fs.readdirSync(outDir); } catch { /* reported below */ }

  const artifacts = [];
  for (const name of entries) {
    const full = path.join(outDir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (name.endsWith('-unpacked')) artifacts.push({ name: `${name}/`, note: 'unpacked app — run the .exe inside' });
      continue;
    }
    if (/\.(exe|msi|zip|7z|dmg|appimage|deb|tar\.gz)$/i.test(name)) {
      artifacts.push({ name, note: MB(st.size) });
    }
  }

  if (artifacts.length === 0) {
    fail('No artifacts were produced.');
    return false;
  }

  plain('');
  plain(`  ${C.bold}dist-electron/${C.reset}`);
  for (const a of artifacts) plain(`    ${a.name.padEnd(46)} ${C.dim}${a.note}${C.reset}`);
  plain('');

  const rung = { 0: 'bundled 7-Zip', 1: `system 7-Zip ${archiver.version ?? ''}`.trim(), 2: 'none available' };
  plain(`  Archiver        ${rung[archiver.level]}`);
  plain(`  Output type     ${dirOnly ? 'portable only (no installer)' : 'installer + portable'}`);

  if (degraded.length > 0) {
    plain(`  Degraded        ${degraded[0]}`);
    for (const d of degraded.slice(1)) plain(`                  ${d}`);
  }
  plain('');

  if (dirOnly) {
    warn('No installer was produced, and this is not a source problem:');
    warn(`  ${archiver.reason ?? 'no usable 7-Zip'}`);
    warn('  electron-builder needs 7-Zip for the NSIS payload, the portable .exe,');
    warn('  and even for unpacking its own code-signing tools.');
    warn('  To get installers on this machine, one of:');
    warn('    · install 7-Zip machine-wide (a current version — 21.07 is what gets flagged);');
    warn('      this script finds it automatically on the next run');
    warn('    · have the security policy allow node_modules/7zip-bin/win/x64/7za.exe');
    warn('    · build on a machine without that restriction');
    warn('  This build also has Electron\'s default .exe icon and metadata, because');
    warn('  branding the executable is part of the step that had to be skipped.');
    if (archive) {
      ok(`Distributable regardless: unzip ${path.basename(archive)} and run "Rama AGI.exe"`);
    }
  } else {
    ok('Installer build complete.');
    plain('  Run the Setup .exe to install; the portable .exe runs without installing.');
  }

  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

function help() {
  process.stdout.write(`
${C.bold}Rāma AGI — build from source, anywhere${C.reset}

  node scripts/buildInstaller.cjs             Prepare the machine, then build
  node scripts/buildInstaller.cjs --win       Windows targets (default here)
  node scripts/buildInstaller.cjs --mac       macOS targets
  node scripts/buildInstaller.cjs --linux     Linux targets
  node scripts/buildInstaller.cjs --dir       Unpacked + portable zip only
  node scripts/buildInstaller.cjs --dry-run   Check the machine, build nothing
  node scripts/buildInstaller.cjs --skip-install    Fail instead of installing
  node scripts/buildInstaller.cjs --skip-renderer   Reuse the existing build/
  node scripts/buildInstaller.cjs --recheck-archiver  Re-test a blocked 7-Zip
  node scripts/buildInstaller.cjs --help

${C.bold}If a security policy blocks 7-Zip${C.reset}

  The verdict is remembered in data/system/archiver-probe.json, so the blocked
  binary is not started again and no further policy dialogs are raised. Rāma
  falls back to an unpacked build plus a portable zip, which needs no archiver.
  Install a current 7-Zip machine-wide and it is picked up automatically; pass
  --recheck-archiver to re-test the bundled one on purpose.

${C.bold}What it does${C.reset}

  Stage 0  Toolchain      Node, npm, project root, free disk
  Stage 1  Dependencies   audit against package.json; install if anything is missing
  Stage 2  Renderer       vite build, always
  Stage 3  Archiver       find a 7-Zip that actually runs, or decide it cannot
  Stage 4  Package        electron-builder with the targets stage 3 allows
  Stage 5  Report         what landed in dist-electron/, and what did not

  Nothing outside this project directory is modified. Requires only source +
  Node.js + internet for the first install.
`);
}

async function main() {
  if (showHelp) { help(); return 0; }

  openLog();
  emit(`\n${C.violet}${C.bold}  ⬢ Rāma AGI — packaging${C.reset} ${C.dim}v${(() => {
    try { return appVersion(); } catch { return '?'; }
  })()}${C.reset}\n`);

  if (!checkToolchain()) return 1;

  const deps = await ensureDependencies();
  if (!deps.ok) return 1;

  if (dryRun) {
    const probe = resolveArchiver();
    plain('');
    plain(`  ${C.bold}Dry run — nothing was built.${C.reset}`);
    plain(`  Dependencies    ${deps.degraded.length === 0 ? 'complete' : `complete, ${deps.degraded.length} degraded`}`);
    plain(`  Archiver        ${probe.level === 2 ? 'none usable — this machine can produce a portable zip only' : `level L${probe.level}, 7-Zip ${probe.version}`}`);
    plain(`  Would produce   ${probe.level === 2 ? 'unpacked app + portable zip' : 'NSIS installer + portable exe'}`);
    plain('');
    return 0;
  }

  if (!(await buildRenderer())) return 1;

  const archiver = forceDir ? { level: 2, reason: '--dir was requested' } : resolveArchiver();
  if (forceDir) {
    stage(3, 'ARCHIVER — skipped');
    info('--dir was requested, so no installer is attempted');
  }

  const dirOnly = archiver.level === 2;

  const packaged = await packageApp(dirOnly);
  if (!packaged.ok) {
    // A full installer run can still fail after the app tree is packed — the
    // archive step, code signing, or a target-specific download. The unpacked
    // tree is already on disk at that point, so salvaging it into a portable
    // archive turns a total loss into a usable, clearly-labelled artefact.
    if (!dirOnly) {
      warn('Retrying as an unpacked build so this run still produces something.');
      const retry = await packageApp(true);
      if (!retry.ok) return 1;
      const archive = await zipUnpacked();
      return report({
        archiver: { ...archiver, level: 2, reason: 'electron-builder failed after packing the app tree' },
        dirOnly: true, degraded: deps.degraded, archive,
      }) ? 0 : 1;
    }
    return 1;
  }

  const archive = dirOnly ? await zipUnpacked() : null;

  return report({ archiver, dirOnly, degraded: deps.degraded, archive }) ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    fail(`Packaging aborted: ${e.message ?? String(e)}`);
    logWrite(`${e.stack ?? ''}\n`);
    console.error(e.stack ?? '');
    process.exitCode = 1;
  })
  .finally(() => {
    if (!logStream) return;
    plain(`  ${C.dim}Full transcript: ${path.relative(ROOT, LOG_FILE)}${C.reset}`);
    plain(`  ${C.dim}Send that file if a build fails somewhere else.${C.reset}`);
    plain('');
    try { logStream.end(); } catch { /* nothing left to do */ }
  });
