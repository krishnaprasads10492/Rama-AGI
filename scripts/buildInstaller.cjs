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
const os   = require('os');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

// Captured before anything is built, so the report can tell this run's artefacts
// apart from leftovers of a previous one.
const RUN_START = Date.now();

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
// Check whether this machine can produce a good setup, write the verdict to
// data/system/readiness.json, and build nothing. The build then reads that
// verdict and adapts rather than rediscovering the same facts.
const readinessOnly = has('--readiness');
// Package even when readiness says the result would be unusable.
const force         = has('--force');
// On any failure the transcript is shipped to the build-logs branch so it can be
// read from another machine. Opt out for a run you do not want published.
const noShipLog    = has('--no-ship-log');
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

// Set by fail(). Anything that reports a failure — a blocked archiver, a failed
// installer target, a salvage — makes this run worth shipping for later reading.
let sawFailure = false;

const ok    = (m) => line('✓', C.green,  m);
const warn  = (m) => line('!', C.yellow, m);
const fail  = (m) => { sawFailure = true; return line('✕', C.red, m); };
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
    // The wider buffer is what failure *classification* matches against: the
    // decisive line can sit further back than the twelve lines shown to a human.
    const recentText = () => recent.join('');

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, tail: tail(), recentText: recentText(), error: e.message ?? String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false, code, tail: tail(), recentText: recentText(),
          error: `timed out after ${Math.round(timeoutMs / 60000)} minutes`,
        });
        return;
      }
      resolve({ ok: code === 0, code, tail: tail(), recentText: recentText() });
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

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!Number.isFinite(major) || major < 18) {
    fail(`Node.js ${process.versions.node} — packaging needs v18 minimum, v22 LTS recommended.`);
    fail('Download: https://nodejs.org/en/download');
    return false;
  }
  ok(`Node.js ${process.versions.node}`);

  // Same rule start.cjs applies, for the same reason: Vite 5+ calls crypto.hash,
  // which only exists on the newer patch lines. Packaging runs `vite build`, so
  // it is exposed to exactly the same failure — worth naming here rather than
  // letting it surface as an opaque "crypto.hash is not a function".
  const modernLine = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
  if (!modernLine) {
    warn(`Node ${process.versions.node} is an older patch line than Vite 6 prefers.`);
    warn('  If the renderer build fails on "crypto.hash is not a function", that is why —');
    warn('  Node 22 LTS fixes it. Harmless otherwise.');
  }

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

/**
 * Can this account create a symbolic link?
 *
 * WHY PACKAGING CARES: electron-builder extracts its `winCodeSign` bundle during
 * the Windows installer targets, and that archive contains macOS symlinks
 * (`darwin/10.12/lib/libcrypto.dylib` and friends). Creating a symlink on Windows
 * needs SeCreateSymbolicLinkPrivilege, which a standard account does not hold
 * unless Developer Mode is on. Without it 7-Zip fails with "Cannot create
 * symbolic link : A required privilege is not held by the client", four times
 * over, and the installer build dies — after the app tree has already packed,
 * which is what made it look like a packaging problem.
 *
 * @returns {{ok:boolean, code?:string}}
 */
function canCreateSymlink() {
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-symlink-'));
    const target = path.join(dir, 'target.txt');
    fs.writeFileSync(target, 'probe');
    fs.symlinkSync(target, path.join(dir, 'link.txt'), 'file');
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code ?? String(e) };
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ } }
  }
}

/** Does this output carry the winCodeSign symlink-privilege signature? */
function isSymlinkPrivilegeFailure(text) {
  if (!text) return false;
  return /cannot create symbolic link/i.test(text)
      || /required privilege is not held/i.test(text);
}

/**
 * Static checks on the custom NSIS include, before anything is built.
 *
 * WHY THIS EXISTS: `assets/installer.nsh` is compiled by `makensis`, which only
 * runs when the NSIS target runs. On a machine where 7-Zip is blocked that step
 * is never reached, so the file went unchecked for its whole life and shipped two
 * real defects — a non-ASCII body with no BOM, and `${productName}`/`${version}`,
 * which are electron-builder *artifactName* placeholders rather than NSIS
 * defines. Both were invisible here and only surfaced as "electron-builder failed
 * after packing the app tree" on a machine that could reach NSIS.
 *
 * These checks warn rather than block: none of them is *provably* fatal, and a
 * portable build is still worth producing. They run in stage 0 so the warning
 * arrives before ten minutes of installing and building, and they are repeated in
 * the failure report where they are most useful.
 *
 * @returns {string[]} notes, empty when the file looks sane
 */
/**
 * @param {{ok:boolean, code?:string}|null} link result of canCreateSymlink(), passed
 *   in rather than probed here so the readiness verdict can carry the same value
 *   instead of measuring it twice and risking two different answers.
 */
function checkInstallerScript(link = null) {
  if (!wantWin) return [];

  const notesOut = [];

  if (isWin && link) {
    if (link.ok) {
      ok('Symlink privilege present — winCodeSign will extract cleanly');
    } else {
      warn(`This account cannot create symbolic links (${link.code})`);
      warn('  electron-builder extracts winCodeSign during the installer targets, and');
      warn('  that archive holds macOS symlinks — so the installer step will fail with');
      warn('  "A required privilege is not held by the client" unless this is fixed.');
      warn('  The build still produces an installer, by skipping the step that brands');
      warn('  the executable. Be clear about what that costs: rcedit is part of that');
      warn('  step, so the app ships with Electron\'s default icon — on the .exe, on');
      warn('  the desktop shortcut and in the Start Menu. Not just metadata.');
      warn('  Either of these fixes it properly, and is needed only once:');
      warn('    · Settings > Privacy & security > For developers > Developer Mode = On');
      warn('    · or, in an Administrator terminal:');
      warn('      reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock"' +
           ' /t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1');
      notesOut.push(`no symlink privilege (${link.code}) — blocks winCodeSign, costs the app icon`);
    }
  }

  const file = path.join(ROOT, 'assets', 'installer.nsh');
  if (!fs.existsSync(file)) return notesOut;

  const rel = path.relative(ROOT, file);
  let buf;
  try { buf = fs.readFileSync(file); }
  catch (e) {
    warn(`${rel} could not be read (${e.message}) — NSIS will fail on it`);
    return [`${rel} unreadable`];
  }

  const notes = [];

  const hasBom   = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  let nonAscii = 0;
  for (const b of buf) if (b > 127) nonAscii++;

  if (nonAscii > 0 && !hasBom) {
    warn(`${rel} has ${nonAscii} non-ASCII byte(s) and no BOM`);
    warn('  NSIS reads an included script in the system codepage unless a BOM says');
    warn('  otherwise, so those bytes are mangled when makensis compiles it.');
    warn('  Keep this file ASCII, or save it as UTF-8 with a BOM.');
    notes.push(`${rel}: ${nonAscii} non-ASCII byte(s) without a BOM`);
  }

  // Comment lines are dropped first: this file documents the wrong spellings on
  // purpose, and flagging its own explanation would be noise.
  const code = buf.toString('utf8')
    .split(/\r?\n/)
    .filter(l => !/^\s*[;#]/.test(l))
    .join('\n');

  // electron-builder's NSIS defines are all UPPER_SNAKE_CASE. Anything else in
  // ${...} is almost always an artifactName placeholder used by mistake, which
  // NSIS leaves unexpanded — it writes the literal text and only warns.
  const suspicious = new Set();
  for (const m of code.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (!/^[A-Z0-9_]+$/.test(m[1])) suspicious.add(m[1]);
  }
  if (suspicious.size > 0) {
    warn(`${rel} references ${suspicious.size} symbol(s) NSIS will not expand:`);
    for (const s of suspicious) plain(`      \${${s}}`);
    warn('  electron-builder defines PRODUCT_NAME, PRODUCT_FILENAME and VERSION');
    warn('  (upper case). Lower-case spellings are artifactName placeholders and');
    warn('  are not NSIS symbols — they end up in the installer as literal text.');
    notes.push(`${rel}: unexpandable symbol(s) ${[...suspicious].join(', ')}`);
  }

  const opens  = (code.match(/^\s*!macro\b/gm)    ?? []).length;
  const closes = (code.match(/^\s*!macroend\b/gm) ?? []).length;
  if (opens !== closes) {
    warn(`${rel} has ${opens} !macro and ${closes} !macroend — unbalanced, makensis will fail`);
    notes.push(`${rel}: ${opens} !macro vs ${closes} !macroend`);
  }

  if (notes.length === 0) ok(`${rel} checks out (ASCII, symbols resolvable, macros balanced)`);
  return notes;
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

/**
 * The dependency picture as it stands, installing nothing.
 *
 * Readiness has to measure without changing: if checking whether the machine is
 * ready also installed the things that make it ready, the answer would always be
 * yes and the check would be worthless.
 *
 * @returns {{ok:boolean, degraded:string[]}}
 */
function auditForReadiness() {
  stage(1, 'DEPENDENCIES — measuring only, installing nothing');

  const audit = auditDeps();
  const total = expectedDeps().length;
  const notes = [];

  if (audit.required.length === 0) {
    ok(`All ${total} pinned packages present at the pinned versions`);
  } else {
    warn(`${audit.required.length} of ${total} package(s) missing or mismatched:`);
    for (const d of audit.required.slice(0, 10)) plain(`      ${describe(d)}`);
    if (audit.required.length > 10) plain(`      … and ${audit.required.length - 10} more`);
    info('A build would install these automatically; readiness reports them as-is.');
  }

  for (const d of audit.degraded) {
    warn(`${describe(d)} — optional, Rāma has a fallback`);
    notes.push(`${d.name} unavailable (fallback active)`);
  }

  for (const name of TOLERATED) {
    if (audit.degraded.some(d => d.name === name)) continue;
    const binary = nativeBinaryPresent(name);
    if (!binary) {
      warn(`${name} has no compiled binary for ${process.platform}-${process.arch}`);
      notes.push(`${name} not compiled (the packaged app will use its fallback)`);
    } else {
      ok(`${name} native binary present — ${binary}`);
    }
  }

  notes.push(...probePythonRuntime());

  // Missing-but-installable is not a blocker for readiness: the build installs it.
  return { ok: true, degraded: notes, pendingInstall: audit.required.length };
}

/**
 * Is the Python side of StockMind actually usable on this machine? (Section 91)
 *
 * WHY THIS IS A NOTE AND NEVER A BLOCKER. Packaging does not run Python — `electron-builder` copies
 * `ai_backend/` in as files. So a machine with no Python can still produce a perfectly good
 * installer, and failing the build over it would be wrong.
 *
 * WHY IT IS REPORTED AT ALL. `npm` covers Node, and NOTHING covers Python: neither `Rama.bat` nor
 * this script has ever touched `ai_backend/requirements.txt`. The packaged app spawns bare `python`
 * from PATH and runs `main.py` directly — no venv, no requirements check. A missing interpreter is
 * handled (Section 64 added the `child.on('error')` listener so it reports instead of killing the
 * app), but **Python present with the requirements missing** just dies on an ImportError inside a
 * log stream. That is the silent case this probe exists to make loud, BEFORE master builds and
 * installs and then wonders why StockMind is empty.
 *
 * Note also that the BUILD machine's Python is not the INSTALL machine's Python. This measures where
 * it runs, which is why installing the requirements here is deliberately not attempted.
 */
/**
 * Import names, not distribution names — `scikit-learn` installs as `sklearn`, and checking the
 * distribution name would report a working install as broken. These are the modules the engine's
 * own files import (Section 39), so this list is the honest precondition for `main.py` starting.
 */
const ENGINE_MODULES = [
  'fastapi', 'uvicorn', 'pydantic', 'numpy', 'pandas', 'scipy',
  'sklearn', 'lightgbm', 'xgboost', 'statsmodels', 'ta', 'httpx', 'joblib',
];

function probePythonRuntime() {
  const notes = [];

  // MUST resolve the interpreter exactly as `aiProcess.cjs` does, or the two disagree: master sets
  // RAMA_PYTHON to a working venv, the app is satisfied, and readiness still complains about
  // whatever `python` happens to be on PATH. A diagnostic that contradicts the runtime is worse
  // than none, because it sends master to fix something that is not broken.
  const configured = (process.env.RAMA_PYTHON || '').trim();
  const exe = configured || (process.platform === 'win32' ? 'python' : 'python3');
  const via = configured ? ' (via RAMA_PYTHON)' : '';

  const ver = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 15_000 });
  if (ver.error || ver.status !== 0) {
    warn(`StockMind runtime${via}: "${exe}" is not usable — the market engine cannot start`);
    plain('      Packaging is unaffected; the produced app will report StockMind unavailable.');
    plain('      Fix on the machine that RUNS Rāma: install Python 3.11 or 3.12, then');
    plain('        python -m pip install -r ai_backend\\requirements.txt');
    plain('      Or set RAMA_PYTHON to a venv python.exe if PATH must keep another version.');
    notes.push('Python not on PATH (StockMind will not start in the produced app)');
    return notes;
  }

  const version = String(ver.stdout || ver.stderr).trim();

  // THE PINS DEFINE A WINDOW, AND SAYING "install Python 3.11+" WITHOUT AN UPPER BOUND IS WRONG.
  // The binding constraint is `numpy==1.26.4`, which publishes no wheel above CPython 3.12; scipy
  // 1.14.1 and pandas 2.2.3 stop at 3.13. On a newer interpreter `pip install -r requirements.txt`
  // does not fail cleanly — it falls back to building numpy from source and dies in a compiler,
  // which reads as a broken machine rather than a wrong Python. Measured here: 3.14.4 on PATH.
  const m = version.match(/(\d+)\.(\d+)/);
  if (m) {
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const tooNew = major > 3 || (major === 3 && minor > 12);
    const tooOld = major < 3 || (major === 3 && minor < 10);
    if (tooNew || tooOld) {
      warn(`StockMind runtime${via}: ${version} is outside the range the pinned requirements support`);
      plain('      numpy==1.26.4 publishes no wheel above CPython 3.12, so pip would try to');
      plain('      compile it from source and fail in a C compiler — which looks like a broken');
      plain('      machine rather than the wrong interpreter.');
      plain('      Use Python 3.11 or 3.12 for the engine. A dedicated venv keeps it off PATH:');
      plain('        py -3.12 -m venv .venv-stockmind');
      plain('        .venv-stockmind\\Scripts\\python -m pip install -r ai_backend\\requirements.txt');
      plain('      Then point Rāma at it, since the app otherwise spawns bare "python" from PATH:');
      plain('        setx RAMA_PYTHON "<full path>\\.venv-stockmind\\Scripts\\python.exe"');
      notes.push(`Python ${major}.${minor} is outside the supported 3.10–3.12 range for the engine`);
      // Deliberately does NOT return. The version is the root cause, but whether the packages are
      // present there is still true and still useful — "wrong Python, and nothing installed in it
      // either" is a different job from "wrong Python, but otherwise ready". Returning here also
      // left the import probe unreachable on any machine whose only Python is out of range, which
      // is the machine this was written on.
    }
  }

  // EVERY module is tried SEPARATELY, and this is the whole point of the loop.
  //
  // The first version ran `import fastapi, uvicorn, pandas, ...` as one statement. Python aborts
  // that at the FIRST failure, so it reported "missing fastapi" on a machine where nothing at all
  // was installed — master fixes fastapi, re-runs, is told uvicorn is missing, and so on for ten
  // rounds. Master hit exactly that. The cost is identical (each module is imported once either
  // way); the difference is that the report is complete.
  //
  // A real import rather than `importlib.util.find_spec`: find_spec answers "is it installed",
  // and the question that matters is "will main.py start". A wheel that installed but whose native
  // binary is broken — the usual scipy/lightgbm failure — passes find_spec and fails on import.
  const py = [
    'import importlib',
    `mods = [${ENGINE_MODULES.map(m => `"${m}"`).join(',')}]`,
    'bad = []',
    'for m in mods:',
    '    try:',
    '        importlib.import_module(m)',
    '    except Exception:',
    '        bad.append(m)',
    'print("RAMA_MISSING:" + ",".join(bad))',
  ].join('\n');

  const probe = spawnSync(exe, ['-c', py], { encoding: 'utf8', timeout: 300_000 });

  const line = String(probe.stdout || '').split(/\r?\n/).find(l => l.startsWith('RAMA_MISSING:'));
  if (!line) {
    // The probe itself could not run — report that rather than inventing a package list.
    warn(`StockMind runtime${via}: ${version} found, but the import probe did not complete`);
    plain(`      ${String(probe.stderr || probe.error?.message || 'no output').trim().split('\n')[0]}`);
    notes.push('Python present but the engine import probe failed to run');
    return notes;
  }

  const missing = line.slice('RAMA_MISSING:'.length).split(',').filter(Boolean);
  if (missing.length === 0) {
    ok(`StockMind runtime${via}: ${version}, all ${ENGINE_MODULES.length} engine packages importable`);
    return notes;
  }

  // All-missing and some-missing are different situations and deserve different words. Listing ten
  // names when the answer is "nothing is installed" buries the actual instruction.
  const all = missing.length === ENGINE_MODULES.length;
  if (all) {
    warn(`StockMind runtime${via}: ${version} found, but NONE of the engine packages are installed in it`);
  } else {
    warn(`StockMind runtime${via}: ${version} found, ${missing.length} of ${ENGINE_MODULES.length} `
      + `engine packages missing — ${missing.join(', ')}`);
  }
  plain('      Packaging is unaffected. Without these the engine starts and immediately exits,');
  plain('      surfacing only as an ImportError in the log rather than a clear message.');
  plain('      Fix on the machine that RUNS Rāma:');
  plain('        python -m pip install -r ai_backend\\requirements.txt');
  plain('      Or set RAMA_PYTHON to a venv python.exe if PATH must keep another version.');
  notes.push(all
    ? 'No engine packages installed in the Python on PATH — StockMind will not start'
    : `Python packages missing (${missing.join(', ')}) — StockMind will not start`);
  return notes;
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

  // Reported here too, so a build that never ran readiness still says it. Never installs and never
  // blocks: packaging does not run Python, and the build machine's Python is not the install
  // machine's Python anyway (Section 91).
  notes.push(...probePythonRuntime());

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

/**
 * Find something that can stand in for the bundled archiver.
 *
 * WHY NOT RAR — asked, and worth answering here because it will be asked again.
 * A substitute has to satisfy three constraints, and RAR fails all three:
 *
 *   1. CLI COMPATIBILITY, not just format support. electron-builder builds
 *      7-Zip's own method switches — `-mx=9`, `-md=64m`, `-ms=off`, `-mhc=off`,
 *      `-mtc=off`, `-mf=BCJ2` (see app-builder-lib/out/targets/archive.js's
 *      compute7zCompressArgs). `rar.exe` uses an entirely different syntax. So a
 *      candidate must speak 7-Zip's command line, which means being 7-Zip or a
 *      fork of it — not merely a program that can compress.
 *   2. THE INSTALLER MUST BE ABLE TO UNPACK IT. The NSIS payload is `app.7z`,
 *      and the NSIS stub has a 7z decompressor built in. It has no unrar engine,
 *      so a .rar payload could not be extracted by the installer we ship.
 *   3. LICENCE. The RAR *compressor* is proprietary — WinRAR is paid software, and
 *      the unrar source licence explicitly forbids using it to build a RAR
 *      compressor. Bundling one is not legally available to us, and requiring
 *      master to buy WinRAR to build his own app would be absurd. 7-Zip is free
 *      and redistributable, which is precisely why electron-builder bundles it.
 *
 * And it would not have helped: the failures here were a policy flagging 7-Zip
 * *21.07 as a vulnerable version*, and a winCodeSign archive containing macOS
 * symlinks that need a Windows privilege. Neither is a property of the format.
 *
 * What DOES help is looking beyond the one binary `7zip-bin` ships. NanaZip is a
 * current, MIT-licensed 7-Zip fork that installs per-user from the Store — so it
 * needs no administrator rights, and being current it is not the flagged 21.07.
 * On a machine where the bundled archiver is blocked by version, it is the most
 * likely way to get real installers back.
 */
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
    for (const r of roots) {
      dirs.push(path.join(r, '7-Zip'), path.join(r, 'NanaZip'), path.join(r, '7-Zip-Zstandard'));
    }
    // NanaZip ships as an MSIX package, so its real install root is under
    // WindowsApps rather than Program Files.
    if (process.env.LOCALAPPDATA) {
      dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'));
    }

    for (const hive of ['HKLM\\SOFTWARE\\7-Zip', 'HKCU\\SOFTWARE\\7-Zip']) {
      const reg = tryRun(`reg query "${hive}" /v Path`);
      if (!reg.ok) continue;
      const m = reg.out.match(/Path\s+REG_[A-Z_]+\s+(.+)/);
      if (m) dirs.push(m[1].trim());
    }

    // Every name here is 7-Zip or a fork speaking 7-Zip's command line.
    const names = ['7za.exe', '7z.exe', '7zr.exe', '7zz.exe', 'NanaZipC.exe'];
    for (const d of dirs) for (const n of names) push(path.join(d, n));

    for (const n of ['7za', '7z', '7zr', '7zz', 'NanaZipC']) {
      const w = tryRun(`where ${n}`);
      if (w.ok) for (const l of w.out.split('\n')) push(l.trim());
    }
  } else {
    // 7zz/7zzs are the official 7-Zip builds for Linux/macOS; 7z is p7zip's.
    for (const n of ['7zz', '7zzs', '7za', '7z', '7zr']) {
      const w = tryRun(`command -v ${n}`);
      if (w.ok && w.out.trim()) push(w.out.trim());
    }
  }

  const rank = (p) => {
    const b = path.basename(p).toLowerCase();
    if (b.startsWith('7za'))     return 0;   // standalone console, self-contained
    if (b.startsWith('7zz'))     return 1;   // official modern standalone build
    if (b.startsWith('nanazip')) return 2;   // current MIT fork, per-user install
    if (b.startsWith('7z.'))     return 3;   // full featured, needs 7z.dll beside it
    return 4;                                // 7zr — .7z only, which is all NSIS needs
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

    // 7z.exe is a thin front end over 7z.dll and cannot run without it. Other
    // builds (7za, 7zz) are self-contained. Copy the DLL whenever one sits beside
    // the source rather than keying on the filename, so a fork that also needs it
    // is handled without another special case.
    const base = path.basename(src).toLowerCase();
    const dll  = path.join(path.dirname(src), '7z.dll');
    if (fs.existsSync(dll)) {
      fs.copyFileSync(dll, path.join(dir, '7z.dll'));
    } else if (base === '7z.exe') {
      return { ok: false, reason: '7z.exe found without its 7z.dll' };
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
// READINESS — can this machine produce a setup worth installing, and what kind
// ══════════════════════════════════════════════════════════════════════════════

const READINESS_FILE = path.join(ROOT, 'data', 'system', 'readiness.json');
const MANIFEST_FILE  = path.join(ROOT, 'shared', 'buildManifest.json');

/**
 * Turn the individual checks into one verdict plus a prediction.
 *
 * WHY A PREDICTION AND NOT JUST A PASS/FAIL: the interesting outcomes here are not
 * "works" and "broken" but three shades of working — a fully branded installer, an
 * installer whose .exe carries Electron's icon, and a portable archive with no
 * installer at all. Master deciding whether to spend ten minutes on a build wants
 * to know *which* of those they are about to get, before it happens rather than
 * after.
 *
 * @returns {object} the verdict, also written to data/system/readiness.json
 */
function computeReadiness({ toolchainOk, deps, archiver, link, nsisNotes, rendererPresent }) {
  const blocking = [];
  const limits   = [];

  if (!toolchainOk) {
    blocking.push('The toolchain cannot package at all — see the stage 0 report above.');
  }
  if (deps && !deps.ok) {
    blocking.push('Required dependencies are missing and could not be installed.');
  }

  // Archiver decides whether an installer is even reachable.
  const archiverUsable = archiver && archiver.level !== 2;
  if (!archiverUsable) {
    limits.push('No usable 7-Zip: NSIS and portable-exe targets are unreachable, so only a portable zip can be produced.');
  }

  // Symlink privilege decides whether the .exe can be branded.
  const canBrand = !isWin || (link && link.ok);
  if (!canBrand) {
    limits.push('No symlink privilege: winCodeSign cannot be unpacked, so the .exe will carry Electron\'s default icon.');
  }

  for (const n of nsisNotes ?? []) limits.push(`Installer script: ${n}`);
  for (const d of deps?.degraded ?? []) limits.push(`Capability degraded in the build: ${d}`);

  if (!rendererPresent && skipRenderer) {
    blocking.push('--skip-renderer was requested but build/index.html does not exist.');
  }

  // What master will actually end up holding.
  let predicted;
  if (blocking.length > 0)         predicted = 'nothing — the build cannot complete';
  else if (!archiverUsable)        predicted = 'portable zip only (no installer)';
  else if (!canBrand)              predicted = 'NSIS installer + portable exe, unbranded .exe';
  else                             predicted = 'NSIS installer + portable exe, fully branded';

  const verdict = blocking.length > 0
    ? 'not-ready'
    : limits.length > 0 ? 'ready-with-limits' : 'ready';

  const readiness = {
    verdict,
    predicted,
    at: new Date().toISOString(),
    version: appVersion(),
    platform: `${process.platform}-${process.arch}`,
    node: process.versions.node,
    checks: {
      toolchain:        !!toolchainOk,
      dependencies:     !!deps?.ok,
      archiverLevel:    archiver?.level ?? null,
      archiverVersion:  archiver?.version ?? null,
      symlinkPrivilege: canBrand,
      installerScript:  (nsisNotes ?? []).length === 0,
      rendererPresent:  !!rendererPresent,
    },
    blocking,
    limits,
    degraded: deps?.degraded ?? [],
  };

  try {
    fs.mkdirSync(path.dirname(READINESS_FILE), { recursive: true });
    fs.writeFileSync(READINESS_FILE, JSON.stringify(readiness, null, 2));
  } catch { /* the verdict is still usable in memory this run */ }

  return readiness;
}

/** The last written verdict, if it is recent enough to still describe this machine. */
function loadReadiness(maxAgeMinutes = 120) {
  try {
    const r = JSON.parse(fs.readFileSync(READINESS_FILE, 'utf8'));
    const ageMin = (Date.now() - new Date(r.at).getTime()) / 60000;
    return { ...r, ageMinutes: Math.round(ageMin), fresh: ageMin <= maxAgeMinutes };
  } catch { return null; }
}

function printReadiness(r) {
  const colour = r.verdict === 'ready' ? C.green : r.verdict === 'ready-with-limits' ? C.yellow : C.red;
  plain('');
  plain(`  ${C.bold}READINESS${C.reset}  ${colour}${r.verdict.toUpperCase()}${C.reset}`);
  plain(`  Would produce   ${r.predicted}`);
  plain('');

  for (const [k, v] of Object.entries(r.checks)) {
    const label = k.replace(/([A-Z])/g, ' $1').toLowerCase();
    const mark = v === true ? `${C.green}✓${C.reset}` : v === false ? `${C.red}✕${C.reset}` : `${C.dim}·${C.reset}`;
    plain(`    ${mark} ${label.padEnd(20)} ${C.dim}${v === true ? '' : v === false ? 'no' : v}${C.reset}`);
  }

  if (r.blocking.length) {
    plain('');
    plain(`  ${C.bold}${C.red}Blocking — a build cannot succeed until these are fixed:${C.reset}`);
    for (const b of r.blocking) plain(`    ${C.red}✕${C.reset} ${b}`);
  }
  if (r.limits.length) {
    plain('');
    plain(`  ${C.bold}${C.yellow}Limits — the build will succeed, with these consequences:${C.reset}`);
    for (const l of r.limits) plain(`    ${C.yellow}!${C.reset} ${l}`);
  }
  plain('');
  plain(`  ${C.dim}Verdict saved to ${path.relative(ROOT, READINESS_FILE)} — the build reads it and adapts.${C.reset}`);
  plain('');
}

/**
 * Record, inside the packaged app, what was true when it was built.
 *
 * WHY THIS SHIPS: `startupDoctor` reports at runtime that (say) node-pty is
 * unavailable, but it cannot tell whether that is a broken installation or a known
 * property of how this build was made. Without that distinction every degradation
 * looks like damage, and master cannot tell a real fault from an accepted
 * trade-off. `shared/` is packaged, so the manifest travels with the app.
 */
function writeBuildManifest(readiness, extra = {}) {
  const manifest = {
    version:   appVersion(),
    builtAt:   new Date().toISOString(),
    builtOn:   `${process.platform}-${process.arch}`,
    nodeAtBuild: process.versions.node,
    readiness: {
      verdict:   readiness.verdict,
      predicted: readiness.predicted,
      limits:    readiness.limits,
      degraded:  readiness.degraded,
      checks:    readiness.checks,
    },
    ...extra,
  };
  try {
    fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (e) {
    warn(`Build manifest could not be written (${e.message}) — the app will not know its own build limits`);
    return null;
  }
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

async function packageApp(dirOnly, { noSignEdit = false } = {}) {
  stage(4, dirOnly
    ? 'PACKAGE — unpacked application tree'
    : `PACKAGE — installer${noSignEdit ? ' (executable branding disabled)' : ''}`);

  const flags = platformFlags();

  // Disabling sign/edit-executable is what keeps electron-builder from fetching
  // and extracting winCodeSign, which is the step needing a symlink privilege this
  // account may not have. Verified: with this flag the download does not happen.
  //
  // Computed once and pushed once. It was previously pushed by both the noSignEdit
  // branch and the dirOnly branch, and a repeated `-c.x=y` makes electron-builder
  // parse the value as an array — "configuration.win.signAndEditExecutable should
  // be a boolean". Two independent reasons to set the same flag is not a reason to
  // set it twice.
  const skipSignEdit = wantWin && (noSignEdit || dirOnly);
  if (skipSignEdit) flags.push('-c.win.signAndEditExecutable=false');

  // MEASURED, not assumed: `--dir` alone is not enough on a machine where 7za is
  // blocked. After the app tree is packed, electron-builder downloads
  // winCodeSign-2.6.0.7z and extracts it *with 7za* for the sign/edit-executable
  // step — even with no certificate configured — and fails four times over. That
  // is why `skipSignEdit` above includes dirOnly, and why the flag is not optional
  // on that path. The cost is stated rather than hidden: the launcher .exe keeps
  // Electron's default icon, because rcedit is part of the skipped step.
  if (dirOnly) flags.push('--dir');

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
  // recentText must be carried through: the caller classifies the failure from
  // it to decide whether the retry rung applies. Returning only `tail` left that
  // classification permanently false.
  return { ok: false, tail: r.tail, recentText: r.recentText };
}

/**
 * Read the artefact back and confirm it can resolve what it will load.
 *
 * WHY THIS IS A BUILD STAGE AND NOT A MANUAL STEP: an installed build once died on
 * launch with `Cannot find module 'debug'`, and every part of the build had
 * reported success — electron-builder packaged exactly what `build.files` told it
 * to, the installer was produced, the report was green. The only place the fault
 * existed was in the artefact, so that is where it has to be checked. See
 * `scripts/auditPackage.cjs` and spec Section 48.
 *
 * @returns {Promise<{ok:boolean, ran:boolean, tail:string}>}
 */
async function auditPackagedApp() {
  const script = path.join(__dirname, 'auditPackage.cjs');
  if (!fs.existsSync(script)) return { ok: true, ran: false, tail: '' };

  info('verifying the packaged app can resolve its dependencies');
  const r = await runTee(`node ${JSON.stringify(script)}`, 10 * 60_000);
  return { ok: r.ok, ran: true, tail: r.tail ?? '' };
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

function report({ archiver, dirOnly, degraded, archive, salvaged, failureTail, nsisNotes = [], unbranded = false, symlinkCause = false }) {
  stage(5, 'REPORT — what is on disk');

  const outDir = path.join(ROOT, 'dist-electron');
  let entries = [];
  try { entries = fs.readdirSync(outDir); } catch { /* reported below */ }

  // Anything older than this run is left over from a previous one. Listing it
  // unqualified invites shipping a stale artefact: the salvaged portable zip from
  // an earlier failed run sat in this list looking like current output.
  const artifacts = [];
  let stale = 0;
  for (const name of entries) {
    const full = path.join(outDir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }

    const old = st.mtimeMs < RUN_START - 1000;

    if (st.isDirectory()) {
      if (!name.endsWith('-unpacked')) continue;
      artifacts.push({
        name: `${name}/`,
        note: old ? 'from an earlier run' : 'unpacked app — run the .exe inside',
        old,
      });
      if (old) stale++;
      continue;
    }
    if (/\.(exe|msi|zip|7z|dmg|appimage|deb|tar\.gz)$/i.test(name)) {
      artifacts.push({ name, note: `${MB(st.size)}${old ? '  (from an earlier run)' : ''}`, old });
      if (old) stale++;
    }
  }

  if (artifacts.length === 0) {
    fail('No artifacts were produced.');
    return false;
  }

  plain('');
  plain(`  ${C.bold}dist-electron/${C.reset}`);
  for (const a of artifacts) {
    const colour = a.old ? C.dim : C.reset;
    plain(`    ${colour}${a.name.padEnd(46)}${C.reset} ${C.dim}${a.note}${C.reset}`);
  }
  if (stale > 0) {
    plain(`    ${C.yellow}${stale} item(s) above predate this run — do not ship them by mistake.${C.reset}`);
  }
  plain('');

  const rung = {
    0: `bundled 7-Zip ${archiver.version ?? ''}`.trim(),
    1: `system 7-Zip ${archiver.version ?? ''}`.trim(),
    2: 'none available',
  };
  plain(`  Archiver        ${rung[archiver.level]}`);
  plain(`  Output type     ${dirOnly ? 'portable only (no installer)' : 'installer + portable'}`);
  if (salvaged)  plain(`  Installer       attempted and failed — salvaged as portable`);
  if (unbranded) plain(`  Installer       built, but the .exe is unbranded (no symlink privilege)`);

  if (degraded.length > 0) {
    plain(`  Degraded        ${degraded[0]}`);
    for (const d of degraded.slice(1)) plain(`                  ${d}`);
  }
  plain('');

  if (salvaged) {
    // Distinct from the no-archiver case: 7-Zip worked, the app tree packed
    // cleanly, and electron-builder then failed building the installer targets.
    // Blaming the archiver here sent the master chasing a non-existent problem.
    fail('The installer targets failed. The archiver is NOT the cause —');
    fail(`  this machine has a working ${rung[archiver.level]}, and the app tree packed fine.`);
    fail('  What was salvaged is the unpacked app, zipped into a portable archive.');
    if (failureTail) {
      plain('');
      plain(`  ${C.bold}Why electron-builder failed (last lines):${C.reset}`);
      for (const l of failureTail.split('\n')) plain(`    ${C.red}${l}${C.reset}`);
    }
    if (symlinkCause || isSymlinkPrivilegeFailure(failureTail)) {
      plain('');
      plain(`  ${C.bold}This is the winCodeSign symlink-privilege problem.${C.reset}`);
      plain('  electron-builder unpacks a bundle containing macOS symlinks, and Windows');
      plain('  needs a privilege for that which a standard account does not hold.');
      plain('  Nothing in Rama\'s source causes it and no source change can grant it.');
      plain('');
      plain(`  ${C.bold}Pick either fix, then run this again:${C.reset}`);
      plain('    1. Settings > Privacy & security > For developers > Developer Mode = On');
      plain('    2. or, in an Administrator terminal, one line:');
      plain(`       ${C.cyan}reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock" ` +
            `/t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1${C.reset}`);
      plain('    Either grants the privilege for good; this is not needed again.');
    }
    if (nsisNotes.length > 0) {
      plain('');
      plain(`  ${C.bold}Also flagged before the build started:${C.reset}`);
      for (const n of nsisNotes) plain(`    ${C.yellow}${n}${C.reset}`);
    }
    plain('');
    if (archive) {
      ok(`Usable now: unzip ${path.basename(archive)} and run "Rama AGI.exe"`);
    }
  } else if (dirOnly) {
    warn('No installer was produced, and this is not a source problem:');
    warn(`  ${archiver.reason ?? 'no usable 7-Zip'}`);
    warn('  electron-builder needs 7-Zip for the NSIS payload, the portable .exe,');
    warn('  and even for unpacking its own code-signing tools.');
    warn('  To get installers on this machine, in order of least friction:');
    warn('    · install NanaZip from the Microsoft Store — a current, MIT-licensed');
    warn('      7-Zip fork, per-user so it needs no admin rights, and not the 21.07');
    warn('      version that policies flag. Found automatically on the next run.');
    warn('    · or install 7-Zip machine-wide (any current version)');
    warn('    · or have the policy allow node_modules/7zip-bin/win/x64/7za.exe');
    warn('  RAR is not an alternative: electron-builder emits 7-Zip method switches,');
    warn('  the NSIS stub can only unpack 7z, and the RAR compressor is proprietary.');
    warn('  This build also has Electron\'s default .exe icon and metadata, because');
    warn('  branding the executable is part of the step that had to be skipped.');
    if (archive) {
      ok(`Distributable regardless: unzip ${path.basename(archive)} and run "Rama AGI.exe"`);
    }
  } else {
    ok('Installer build complete.');
    plain('  Run the Setup .exe to install; the portable .exe runs without installing.');
    if (unbranded) {
      plain('');
      warn('The .exe carries Electron\'s default icon and version metadata.');
      warn('  Branding it needs the sign/edit-executable step, which had to be skipped:');
      warn('  this account cannot create symbolic links, so electron-builder could not');
      warn('  unpack winCodeSign. The installer itself is complete and correct.');
      warn('  That means the app shows Electron\'s icon on the .exe, the desktop');
      warn('  shortcut and the Start Menu entry — worth fixing before distributing.');
      warn('  Grant the privilege once, then run this again:');
      warn('    Settings > Privacy & security > For developers > Developer Mode = On');
      warn('    or, in an Administrator terminal:');
      warn('    reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock"' +
           ' /t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1');
    }
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
  node scripts/buildInstaller.cjs --readiness Verify readiness to build a setup,
                                             write the verdict, build nothing
  node scripts/buildInstaller.cjs --force     Package even if readiness says no
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

  const toolchainOk = checkToolchain();
  // Probed once, here, so stage 0's warning and the readiness verdict can never
  // disagree about the same machine.
  const link = isWin ? canCreateSymlink() : { ok: true };
  const nsisNotes = checkInstallerScript(link);

  if (!toolchainOk && !readinessOnly) return 1;

  // In readiness mode nothing is installed — the question is what this machine can
  // do as it stands, and installing would change the answer while measuring it.
  const deps = readinessOnly
    ? auditForReadiness()
    : await ensureDependencies();
  if (!deps.ok && !readinessOnly) return 1;

  if (readinessOnly) {
    const archiverProbe = resolveArchiver();
    const readiness = computeReadiness({
      toolchainOk, deps, archiver: archiverProbe, link, nsisNotes,
      rendererPresent: fs.existsSync(path.join(ROOT, 'build', 'index.html')),
    });
    printReadiness(readiness);
    return readiness.verdict === 'not-ready' ? 1 : 0;
  }

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

  // ── Readiness feeds the build, rather than the build rediscovering it ───────
  const readiness = computeReadiness({
    toolchainOk, deps, archiver, link, nsisNotes,
    rendererPresent: fs.existsSync(path.join(ROOT, 'build', 'index.html')),
  });

  if (readiness.verdict === 'not-ready' && !force) {
    stage(4, 'PACKAGE — refused');
    fail('Readiness says this build cannot produce anything usable:');
    for (const b of readiness.blocking) fail(`  ${b}`);
    fail('Nothing was packaged. Fix the above, or pass --force to try anyway.');
    return 1;
  }

  // The actual handling master asked for: when readiness already knows the .exe
  // cannot be branded, do not spend four minutes on an installer attempt whose
  // failure is a foregone conclusion. Go straight to the rung that works.
  const brandingImpossible = isWin && !readiness.checks.symlinkPrivilege;
  if (brandingImpossible && !dirOnly) {
    info('Readiness: no symlink privilege, so the branded attempt would fail at winCodeSign.');
    info('  Skipping it and building the installer with branding disabled directly.');
  }

  // Record what was true at build time, inside the app, before it is packaged.
  writeBuildManifest(readiness, {
    archiver: { level: archiver.level, version: archiver.version ?? null },
    branded: !brandingImpossible && !dirOnly,
    outputs: dirOnly ? ['portable-zip'] : ['nsis-installer', 'portable-exe'],
  });
  ok(`Build manifest written — the app will know its own limits at runtime`);

  let packaged = await packageApp(dirOnly, { noSignEdit: brandingImpossible });
  let unbranded = brandingImpossible && !dirOnly;

  // Rung between "installer" and "give up on installers": the winCodeSign
  // symlink-privilege failure is entirely avoidable, because the only reason
  // winCodeSign is fetched is the sign/edit-executable step. Turning that off
  // costs the .exe its icon and version metadata and yields a real, working
  // installer — far better than dropping to a portable archive.
  if (!packaged.ok && !dirOnly && isSymlinkPrivilegeFailure(packaged.recentText)) {
    warn('That is the known winCodeSign symlink-privilege failure, not a code fault.');
    warn('  Retrying the installer with executable branding disabled, which stops');
    warn('  electron-builder fetching winCodeSign at all.');
    const second = await packageApp(false, { noSignEdit: true });
    if (second.ok) {
      packaged  = second;
      unbranded = true;
    } else {
      packaged = { ...second, tail: second.tail || packaged.tail };
    }
  }

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
      // The archiver verdict is passed through unchanged. Overwriting it with
      // level 2 here was wrong: it made the report blame 7-Zip and print advice
      // about installing it on a machine whose 7-Zip worked perfectly well.
      return report({
        archiver,
        dirOnly: true,
        salvaged: true,
        failureTail: packaged.tail,
        // Classified from the wider buffer, not the twelve displayed lines.
        symlinkCause: isSymlinkPrivilegeFailure(packaged.recentText ?? packaged.tail),
        degraded: deps.degraded,
        archive,
        nsisNotes,
      }) ? 0 : 1;
    }
    return 1;
  }

  // Before anything is zipped or handed over, prove the artefact is loadable.
  // A missing dependency is not a warning: the app cannot start, so shipping it
  // is worse than failing here.
  const audit = await auditPackagedApp();
  if (audit.ran && !audit.ok) {
    fail('The packaged app is missing dependencies it needs to start.');
    fail('  Not shipping a build that cannot launch — see the list above.');
    return 1;
  }
  if (audit.ran) ok('Packaged app resolves every dependency on its load path');

  const archive = dirOnly ? await zipUnpacked() : null;

  return report({ archiver, dirOnly, degraded: deps.degraded, archive, unbranded, nsisNotes }) ? 0 : 1;
}

/** Flush and close the transcript, so whatever reads it next sees a whole file. */
function closeLog() {
  return new Promise((resolve) => {
    if (!logStream) return resolve();
    const s = logStream;
    logStream = null;                 // further logWrite() calls become no-ops
    s.once('finish', resolve);
    s.once('error', resolve);
    try { s.end(); } catch { resolve(); }
  });
}

/**
 * Ship the transcript after a failed run.
 *
 * Runs as a child process on purpose: shipping touches git, and a fault in it
 * must not change this build's exit code or throw past the reporting that already
 * happened. The transcript is closed first so the shipped copy is complete.
 */
function shipTranscript() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'shipLog.cjs'), '--file', LOG_FILE], {
      cwd: ROOT, shell: false, windowsHide: true,
    });
    child.stdout?.on('data', (b) => process.stdout.write(b.toString()));
    child.stderr?.on('data', (b) => process.stdout.write(b.toString()));
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

(async () => {
  let code = 1;
  try {
    code = await main();
  } catch (e) {
    fail(`Packaging aborted: ${e.message ?? String(e)}`);
    logWrite(`${e.stack ?? ''}\n`);
    console.error(e.stack ?? '');
    code = 1;
  }

  const hadLog = logStream !== null;
  if (hadLog) {
    plain(`  ${C.dim}Full transcript: ${path.relative(ROOT, LOG_FILE)}${C.reset}`);
    if (sawFailure && !noShipLog) {
      plain(`  ${C.dim}Shipping it to the build-logs branch — readable from any machine.${C.reset}`);
    }
    plain('');
  }

  await closeLog();

  if (hadLog && sawFailure && !noShipLog && !dryRun) await shipTranscript();

  process.exitCode = code;
})();
