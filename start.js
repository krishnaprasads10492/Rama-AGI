/**
 * start.js — Rāma AGI Master Startup
 *
 * Single entry point. Run with:  node start.js
 *
 * Startup sequence:
 *   1. Check environment
 *   2. Start Express API server (background)
 *   3. Wait for Vite dev server (dev mode) or verify build exists (prod)
 *   4. Launch Electron
 *   5. Electron initializes crypto, waits for master passcode
 *   6. On passcode entry: unlock vault → decrypt data → app ready
 *
 * Dev:  node start.js
 * Prod: node start.js --prod
 *       (serves from build/ instead of Vite dev server)
 */

import { spawn, exec } from 'child_process';
import { existsSync }  from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd    = process.argv.includes('--prod');
const isWin     = process.platform === 'win32';

// ANSI colors for terminal output
const C = {
  reset:  '\x1b[0m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  violet: '\x1b[35m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
};

function log(level, msg) {
  const colors = { info: C.cyan, ok: C.green, warn: C.yellow, err: C.red, step: C.violet };
  const prefix = { info: '◈', ok: '✓', warn: '⚠', err: '✕', step: '⬢' };
  console.log(`${colors[level] || ''}${prefix[level] || '·'} ${msg}${C.reset}`);
}

function banner() {
  console.log(`
${C.violet}${C.bold}  ██████╗  █████╗ ███╗   ███╗ █████╗     █████╗  ██████╗ ██╗${C.reset}
${C.violet}  ██╔══██╗██╔══██╗████╗ ████║██╔══██╗   ██╔══██╗██╔════╝ ██║${C.reset}
${C.cyan}  ██████╔╝███████║██╔████╔██║███████║   ███████║██║  ███╗██║${C.reset}
${C.cyan}  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══██║   ██╔══██║██║   ██║██║${C.reset}
${C.violet}  ██║  ██║██║  ██║██║ ╚═╝ ██║██║  ██║   ██║  ██║╚██████╔╝██║${C.reset}
${C.violet}  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝${C.reset}

${C.dim}  Righteous Autonomous Master Agent — Supreme Benevolent AGI${C.reset}
${C.dim}  Master: Krishna Prasad · Mode: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}${C.reset}
`);
}

// ─── Check Node version ───────────────────────────────────────────────────────
function checkNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    log('err', `Node.js 18+ required. Current: ${process.versions.node}`);
    process.exit(1);
  }
  log('ok', `Node.js ${process.versions.node}`);
}

// ─── Check if npm deps are installed ─────────────────────────────────────────
function checkDeps() {
  if (!existsSync(path.join(__dirname, 'node_modules'))) {
    log('err', 'node_modules not found. Run: npm install');
    process.exit(1);
  }
  log('ok', 'Dependencies present');
}

// ─── Check build exists (prod mode) ──────────────────────────────────────────
function checkBuild() {
  if (!existsSync(path.join(__dirname, 'build', 'index.html'))) {
    log('err', 'Production build not found. Run: npm run build');
    process.exit(1);
  }
  log('ok', 'Production build found');
}

// ─── Start Express server ─────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    log('step', 'Starting Rāma server (port 4097)...');

    const serverPath = path.join(__dirname, 'server', 'index.cjs');
    if (!existsSync(serverPath)) {
      log('warn', 'server/index.cjs not found — skipping server');
      return resolve(null);
    }

    const server = spawn(
      process.execPath,
      [serverPath],
      {
        stdio:       ['ignore', 'pipe', 'pipe'],
        env:         { ...process.env },
        cwd:         __dirname,
        detached:    false,
      }
    );

    let started = false;
    server.stdout.on('data', (d) => {
      const line = d.toString().trim();
      if (line.includes('Listening') || line.includes('4097')) {
        if (!started) { started = true; log('ok', 'Server running on :4097'); resolve(server); }
      }
    });
    server.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line && !line.includes('ExperimentalWarning')) console.error(`${C.dim}  [server] ${line}${C.reset}`);
    });
    server.on('error', (err) => {
      log('err', `Server failed to start: ${err.message}`);
      resolve(null);   // Non-fatal — Electron can still start
    });

    // Resolve after 3s even if no confirmation
    setTimeout(() => {
      if (!started) { log('warn', 'Server start timeout — continuing anyway'); resolve(server); }
    }, 3000);
  });
}

// ─── Start Vite dev server ────────────────────────────────────────────────────
function startVite() {
  return new Promise((resolve, reject) => {
    log('step', 'Starting Vite dev server (port 5173)...');

    const vite = spawn(
      isWin ? 'npx.cmd' : 'npx',
      ['vite', '--port', '5173'],
      {
        stdio:    ['ignore', 'pipe', 'pipe'],
        cwd:      __dirname,
        env:      { ...process.env },
        shell:    isWin,
      }
    );

    let started = false;
    vite.stdout.on('data', (d) => {
      const line = d.toString();
      if ((line.includes('5173') || line.includes('Local:')) && !started) {
        started = true;
        log('ok', 'Vite dev server running on :5173');
        resolve(vite);
      }
    });
    vite.stderr.on('data', (d) => {
      // Vite sometimes logs to stderr normally
    });
    vite.on('error', reject);

    setTimeout(() => {
      if (!started) { log('warn', 'Vite timeout — launching Electron anyway'); resolve(vite); }
    }, 15000);
  });
}

// ─── Wait for URL to respond ───────────────────────────────────────────────────
function waitForUrl(url, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const mod = url.startsWith('https') ? await import('https') : await import('http');
      // Simple polling with setTimeout
      import('http').then(({ get }) => {
        try {
          get(url, (res) => {
            if (res.statusCode < 500) { resolve(true); return; }
            retry();
          }).on('error', retry);
        } catch { retry(); }
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

// ─── Start Electron ───────────────────────────────────────────────────────────
function startElectron() {
  return new Promise((resolve, reject) => {
    log('step', 'Launching Electron...');

    const electronPath = path.join(__dirname, 'node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');
    const electron = spawn(
      electronPath,
      ['.'],
      {
        stdio: 'inherit',
        cwd:   __dirname,
        env:   {
          ...process.env,
          RAMA_DEV: isProd ? '0' : '1',
        },
        shell: isWin,
      }
    );

    electron.on('close', (code) => {
      log('info', `Electron exited with code ${code}`);
      resolve(code);
    });
    electron.on('error', reject);
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const children = [];
function shutdown() {
  log('info', 'Shutting down Rāma AGI...');
  for (const child of children) {
    try { child?.kill(); } catch { /* ignore */ }
  }
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  checkNodeVersion();
  checkDeps();

  if (isProd) {
    checkBuild();
  }

  // Start server
  const server = await startServer();
  if (server) children.push(server);

  // Start Vite (dev only)
  if (!isProd) {
    const vite = await startVite();
    if (vite) children.push(vite);
    // Small delay for Vite to stabilize
    await new Promise(r => setTimeout(r, 1500));
  }

  log('step', 'Initializing Rāma AGI...');
  log('info', '');
  log('info', `${C.cyan}  All data encrypted with AES-256-GCM + Argon2id${C.reset}`);
  log('info', `${C.cyan}  Master passcode required to unlock${C.reset}`);
  log('info', '');

  // Launch Electron and wait for it to exit
  const exitCode = await startElectron();

  // Clean up children
  for (const child of children) {
    try { child?.kill(); } catch { /* ignore */ }
  }

  process.exit(exitCode || 0);
}

main().catch(err => {
  log('err', `Fatal startup error: ${err.message}`);
  process.exit(1);
});
