'use strict';

/**
 * start.cjs — Rāma AGI Master Startup (CommonJS)
 *
 * Single entry point for development.
 * Production: users launch via the installed .exe / .app / AppImage.
 *
 * Usage:
 *   node start.cjs          → dev mode (Vite + server + Electron)
 *   node start.cjs --prod   → prod mode (uses build/ folder)
 *
 * What happens on first install (production):
 *   1. NSIS installer runs → installs to Program Files
 *   2. Creates desktop + Start Menu shortcuts
 *   3. Registers for auto-start on login (optional, user chooses)
 *   4. User clicks "Rāma AGI" → electron/main.cjs boots
 *   5. Unlock screen shown → master enters passcode
 *   6. All data decrypted → app fully loads
 */

const { spawn }    = require('child_process');
const { existsSync } = require('fs');
const path         = require('path');
const os           = require('os');

const isProd = process.argv.includes('--prod');
const isWin  = process.platform === 'win32';

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', violet: '\x1b[35m',
  dim: '\x1b[2m', bold: '\x1b[1m',
};

function log(level, msg) {
  const col = { info: C.cyan, ok: C.green, warn: C.yellow, err: C.red, step: C.violet };
  const pre = { info: '◈', ok: '✓', warn: '⚠', err: '✕', step: '⬢' };
  console.log(`${col[level]||''}${pre[level]||'·'} ${msg}${C.reset}`);
}

function banner() {
  console.log(`
${C.violet}${C.bold}  ██████╗  █████╗ ███╗   ███╗ █████╗${C.reset}
${C.violet}  ██╔══██╗██╔══██╗████╗ ████║██╔══██╗${C.reset}
${C.cyan}  ██████╔╝███████║██╔████╔██║███████║${C.reset}
${C.cyan}  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══██║${C.reset}
${C.violet}  ██║  ██║██║  ██║██║ ╚═╝ ██║██║  ██║${C.reset}
${C.violet}  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝  ${C.cyan}AGI${C.reset}

${C.dim}  Righteous Autonomous Master Agent${C.reset}
${C.dim}  Mode: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} | Node ${process.version}${C.reset}
`);
}

// ─── Validation ───────────────────────────────────────────────────────────────
function check() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) { log('err', `Node 18+ required (got ${process.versions.node})`); process.exit(1); }
  log('ok', `Node.js ${process.versions.node}`);

  if (!existsSync(path.join(__dirname, 'node_modules'))) {
    log('err', 'node_modules missing — run: npm install');
    process.exit(1);
  }
  log('ok', 'Dependencies present');

  if (isProd && !existsSync(path.join(__dirname, 'build', 'index.html'))) {
    log('err', 'Production build missing — run: npm run build');
    process.exit(1);
  }
  if (isProd) log('ok', 'Production build found');
}

// ─── Spawn child process ──────────────────────────────────────────────────────
function spawnChild(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio:  ['ignore', 'pipe', 'pipe'],
    cwd:    __dirname,
    env:    { ...process.env },
    shell:  isWin,
    ...opts,
  });
}

// ─── Start Express server ─────────────────────────────────────────────────────
function startServer() {
  return new Promise(resolve => {
    log('step', 'Starting API server (port 4097)...');
    const srv = spawnChild(process.execPath, ['server/index.cjs']);
    let ok = false;

    srv.stdout.on('data', d => {
      if (!ok && (d.toString().includes('4097') || d.toString().includes('Listening'))) {
        ok = true;
        log('ok', 'API server ready on :4097');
        resolve(srv);
      }
    });
    srv.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line && !line.includes('ExperimentalWarning') && !line.includes('DeprecationWarning')) {
        process.stderr.write(`${C.dim}  [server] ${line}${C.reset}\n`);
      }
    });
    srv.on('error', err => { log('warn', `Server start failed: ${err.message} — continuing`); resolve(null); });
    setTimeout(() => { if (!ok) { log('warn', 'Server timeout — continuing'); resolve(srv); } }, 4000);
  });
}

// ─── Start Vite ───────────────────────────────────────────────────────────────
function startVite() {
  return new Promise(resolve => {
    log('step', 'Starting Vite dev server (port 5173)...');
    const bin  = isWin ? 'npx.cmd' : 'npx';
    const vite = spawnChild(bin, ['vite', '--port', '5173']);
    let ok = false;

    vite.stdout.on('data', d => {
      const line = d.toString();
      if (!ok && (line.includes('5173') || line.includes('Local:'))) {
        ok = true;
        log('ok', 'Vite ready on :5173');
        resolve(vite);
      }
    });
    vite.on('error', err => { log('err', `Vite failed: ${err.message}`); resolve(null); });
    setTimeout(() => { if (!ok) { log('warn', 'Vite timeout — launching Electron anyway'); resolve(vite); } }, 20000);
  });
}

// ─── Launch Electron ──────────────────────────────────────────────────────────
function startElectron() {
  return new Promise((resolve, reject) => {
    log('step', 'Launching Electron window...');

    const electronBin = path.join(
      __dirname, 'node_modules', '.bin',
      isWin ? 'electron.cmd' : 'electron'
    );

    const proc = spawn(electronBin, ['.'], {
      stdio: 'inherit',
      cwd:   __dirname,
      env:   { ...process.env, RAMA_DEV: isProd ? '0' : '1' },
      shell: isWin,
    });

    proc.on('close', resolve);
    proc.on('error', reject);
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
const children = [];
function shutdown() {
  log('info', 'Shutting down Rāma AGI...');
  children.forEach(c => { try { c?.kill('SIGTERM'); } catch { /* ignore */ } });
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('exit',    () => children.forEach(c => { try { c?.kill(); } catch { /* ignore */ } }));

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner();
  check();

  const server = await startServer();
  if (server) children.push(server);

  if (!isProd) {
    const vite = await startVite();
    if (vite) children.push(vite);
    // Give Vite time to compile
    await new Promise(r => setTimeout(r, 2000));
  }

  log('info', '');
  log('info', `${C.cyan}All data encrypted · AES-256-GCM + Argon2id${C.reset}`);
  log('info', `${C.cyan}Master passcode required to unlock${C.reset}`);
  log('info', '');

  const code = await startElectron();
  children.forEach(c => { try { c?.kill(); } catch { /* ignore */ } });
  process.exit(code || 0);
}

main().catch(err => {
  log('err', `Fatal: ${err.message}`);
  process.exit(1);
});
