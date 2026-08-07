'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
const { autoUpdater } = require('electron-updater');

// ─── IPC Handlers ───────────────────────────────────────────────────────────
const systemIPC    = require('./ipc/system.cjs');
const fsIPC        = require('./ipc/filesystem.cjs');
const gitIPC       = require('./ipc/git.cjs');
const terminalIPC  = require('./ipc/terminal.cjs');
const appsIPC      = require('./ipc/appAssimilation.cjs');
const aiIPC        = require('./ipc/aiProcess.cjs');
const browserIPC   = require('./ipc/browserEngine.cjs');
const vaultIPC     = require('./ipc/credentialVault.cjs');
const modelIPC     = require('./ipc/modelRouter.cjs');
const agentIPC         = require('./ipc/agentOrchestrator.cjs');
const intelligenceIPC  = require('./ipc/intelligenceEngine.cjs');
const evolutionIPC         = require('./ipc/evolutionEngine.cjs');
const resourceOrchestrator = require('./resourceOrchestrator.cjs');
// ─── Upgrade layer (additive — wraps existing, never replaces) ───────────────
const vectorMemoryIPC  = require('./ipc/vectorMemory.cjs');
const sandboxIPC       = require('./ipc/sandboxEngine.cjs');
const graphIPC         = require('./ipc/graphReasoner.cjs');
const selfCareIPC      = require('./ipc/selfCare.cjs');
// ─── Neural Lattice Nexus + Code Intelligence ─────────────────────────────────
const eventBus         = require('./ramaEventBus.cjs');
const astIPC           = require('./ipc/astEngine.cjs');
const codeRegenIPC     = require('./ipc/codeRegenEngine.cjs');
// ─── Immutable Encryption Foundry ────────────────────────────────────────────
const nucleusSealer    = require('./nucleusSealer.cjs');
const ipcEncryption    = require('./ipcEncryption.cjs');
// ─── Shared foundations (one HTTP client, one approval ledger) ────────────────
const proposalLedger   = require('./lib/proposals.cjs');
// ─── Genome / Instance layer (holonic architecture) ───────────────────────────
const genomeIPC        = require('./genome.cjs');
const genomeApplier    = require('./lib/genomeApplier.cjs');
const authIPC          = require('./ipc/authEngine.cjs');
const instanceIPC      = require('./ipc/instanceManager.cjs');
const metaCognitionIPC = require('./ipc/metaCognition.cjs');
const timelineIPC      = require('./ipc/timeline.cjs');
const voiceIPC         = require('./ipc/voiceEngine.cjs');
const sessionMgr   = require('./sessionManager.cjs');
const dataStore    = require('./dataStore.cjs');

// ─── Constants ──────────────────────────────────────────────────────────────
const isDev    = !app.isPackaged;
const isHidden = process.argv.includes('--hidden');   // Launched by auto-start
// The launcher may move the dev server if 5173 is taken, so honour its choice
const VITE_PORT = Number(process.env.RAMA_VITE_PORT) || 5173;
const VITE_URL  = `http://localhost:${VITE_PORT}`;
const BUILD_INDEX = path.join(__dirname, '..', 'build', 'index.html');

let mainWindow = null;
let tray       = null;

// ─── Auto Updater ────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload    = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:update-available', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// ─── Content Security Policy ─────────────────────────────────────────────────
/**
 * CSP is applied as a response header rather than a meta tag in index.html.
 *
 * Two reasons (spec section 29):
 *   1. A header cannot be weakened by injected markup, so it is strictly stronger.
 *   2. Dev needs the Vite origin and ws: for HMR; production must not have them.
 *      One static meta tag cannot be correct for both, and the version that
 *      "works everywhere" is the loosened one.
 *
 * The Monaco CDN is allowed in both because the IDE loads the editor from it.
 * With the old meta policy (`script-src 'self'`) Monaco was silently blocked and
 * the IDE fell back to a plain textarea without saying why.
 */
const MONACO_CDN = 'https://cdn.jsdelivr.net';
const FONTS_CSS  = 'https://fonts.googleapis.com';
const FONTS_FILE = 'https://fonts.gstatic.com';

function buildCsp() {
  const local = "'self'";
  const api   = 'http://localhost:4097 http://localhost:8001';

  // Dev additionally needs the Vite origin and its HMR websocket
  const viteOrigin = isDev ? `${VITE_URL} ws://localhost:${VITE_PORT}` : '';

  return [
    `default-src ${local}`,
    `script-src ${local} 'unsafe-inline' ${MONACO_CDN}`,
    `worker-src ${local} blob:`,
    `style-src ${local} 'unsafe-inline' ${FONTS_CSS} ${MONACO_CDN}`,
    `font-src ${local} ${FONTS_FILE} ${MONACO_CDN} data:`,
    `img-src ${local} data: blob:`,
    `connect-src ${local} ${api} ${MONACO_CDN} ${viteOrigin}`.trim(),
    `object-src 'none'`,
    `base-uri ${local}`,
    `form-action 'none'`,
  ].join('; ');
}

/**
 * Permission policy. Electron's default handler approves most requests, which is
 * more than Rāma needs. Only the microphone is required (push-to-talk voice), and
 * only for our own renderer — everything else is denied.
 */
function applyPermissions() {
  const { session } = require('electron');

  const allowed = new Set(['media', 'clipboard-sanitized-write']);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const granted = allowed.has(permission);
    if (!granted) console.warn(`[main] Denied permission request: ${permission}`);
    callback(granted);
  });

  // Same policy for synchronous checks (getUserMedia consults this)
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // Never allow a renderer to open arbitrary new windows
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
  });
}

function applyCsp() {
  const { session } = require('electron');
  const csp = buildCsp();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

// ─── Renderer resolution ─────────────────────────────────────────────────────
/**
 * Is the Vite dev server actually serving the app? Answering the socket is not
 * the same as serving the entry — a dev server with a missing index.html returns
 * 404 on every request while looking perfectly alive to a port check.
 */
function probeVite(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = require('http').get(
      { host: 'localhost', port: VITE_PORT, path: '/', timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > 8192) { req.destroy(); resolve(body.includes('id="root"')); }
        });
        res.on('end', () => resolve(body.includes('id="root"')));
      }
    );
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * A blank window is never an acceptable outcome. If neither the dev server nor a
 * production build can be loaded, render a diagnostic page that says what was
 * tried, what failed, and the command that fixes it. It is a data URL, so it
 * needs no bundle and cannot itself fail to load.
 */
function bootFailurePage(attempts) {
  const rows = attempts.map(a =>
    `<li><span class="${a.ok ? 'ok' : 'no'}">${a.ok ? '✓' : '✕'}</span> ${a.what}<em>${a.detail}</em></li>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rāma AGI — startup</title>
<style>
  :root{--bg:#030810;--fg:#c9d6e2;--dim:#6d8296;--cyan:#00c8ff;--gold:#d4a940;--red:#ff3b5c}
  *{box-sizing:border-box}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(0,120,200,.18),transparent 60%),var(--bg);
       color:var(--fg);font:13px/1.7 "JetBrains Mono",Consolas,monospace}
  .card{width:640px;max-width:92vw;padding:34px;border:1px solid rgba(0,200,255,.22);border-radius:10px;
        background:rgba(8,16,28,.72)}
  h1{margin:0 0 4px;font-size:17px;letter-spacing:.14em;color:var(--cyan)}
  .sub{color:var(--dim);font-size:11px;margin-bottom:22px}
  ul{list-style:none;padding:0;margin:0 0 22px}
  li{padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06)}
  li em{display:block;color:var(--dim);font-style:normal;font-size:11px;margin-left:22px}
  .ok{color:#28d17c;margin-right:8px}.no{color:var(--red);margin-right:8px}
  .fix{padding:13px 15px;border:1px solid rgba(212,169,64,.3);background:rgba(212,169,64,.07);
       border-radius:6px;color:var(--gold);font-size:12px}
  code{display:block;margin-top:7px;color:var(--fg);user-select:all}
  button{margin-top:22px;width:100%;padding:11px;cursor:pointer;font:inherit;letter-spacing:.1em;
         color:var(--cyan);background:rgba(0,200,255,.09);border:1px solid rgba(0,200,255,.4);border-radius:6px}
  button:hover{background:rgba(0,200,255,.16)}
</style></head><body><div class="card">
  <h1>RĀMA AGI</h1>
  <div class="sub">The interface could not be loaded. Rāma's engines are running — only the window is empty.</div>
  <ul>${rows}</ul>
  <div class="fix">Build the interface, then reopen:<code>npm install &amp;&amp; npm run build &amp;&amp; node start.cjs --prod</code></div>
  <button onclick="location.reload()">Retry</button>
</div></body></html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Resolve what to load, in order of preference, and always end up with something
 * on screen. `RAMA_UI_MODE=build` lets the launcher force the built files after
 * it has decided the dev server is not viable.
 */
async function loadRenderer(win) {
  const attempts = [];
  const forceBuild = process.env.RAMA_UI_MODE === 'build';

  if (isDev && !forceBuild) {
    if (await probeVite()) {
      attempts.push({ ok: true, what: 'Vite dev server', detail: VITE_URL });
      await win.loadURL(VITE_URL);
      win.webContents.openDevTools({ mode: 'detach' });
      return { source: 'vite', attempts };
    }
    attempts.push({
      ok: false,
      what: 'Vite dev server',
      detail: 'not serving the app entry on :5173 — falling back to the build',
    });
  } else if (forceBuild) {
    attempts.push({ ok: true, what: 'Mode', detail: 'launcher selected the production build' });
  }

  if (fs.existsSync(BUILD_INDEX)) {
    attempts.push({ ok: true, what: 'Production build', detail: BUILD_INDEX });
    await win.loadFile(BUILD_INDEX);
    return { source: 'build', attempts };
  }

  attempts.push({ ok: false, what: 'Production build', detail: `not found at ${BUILD_INDEX}` });
  console.error('[main] No renderer available — showing the startup diagnostic page');
  await win.loadURL(bootFailurePage(attempts));
  return { source: 'diagnostic', attempts };
}

// ─── Appearance ──────────────────────────────────────────────────────────────
/**
 * Whole-surface scaling. The interface is built from hundreds of inline
 * `fontSize` values, which no CSS rule can raise — `setZoomFactor` is the only
 * mechanism that scales every pixel including inline styles, which is exactly the
 * problem it exists for. See spec section 35.
 *
 * Bounds are deliberate: below 0.6 the chrome becomes unusable, above 2.0 the
 * fixed-height titlebar clips. The value is clamped rather than rejected so a
 * voice or chat command can never render Rāma unusable.
 */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.0;

function clampZoom(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

function registerAppearance(ipcMain) {
  ipcMain.handle('appearance:set-zoom', async (_e, factor) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    const z = clampZoom(factor);
    mainWindow.webContents.setZoomFactor(z);
    return { ok: true, zoom: z, min: ZOOM_MIN, max: ZOOM_MAX };
  });

  ipcMain.handle('appearance:get-zoom', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    return { ok: true, zoom: mainWindow.webContents.getZoomFactor(), min: ZOOM_MIN, max: ZOOM_MAX };
  });

  // Nudge by a step — what "make the text bigger" resolves to at tier 0
  ipcMain.handle('appearance:nudge-zoom', async (_e, delta) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    const current = mainWindow.webContents.getZoomFactor();
    const z = clampZoom(current + (Number(delta) || 0));
    mainWindow.webContents.setZoomFactor(z);
    return {
      ok: true, zoom: z, min: ZOOM_MIN, max: ZOOM_MAX,
      atLimit: z === ZOOM_MIN || z === ZOOM_MAX,
    };
  });
}

// ─── Live reload (build mode) ────────────────────────────────────────────────
/**
 * Reload the window when the launcher signals that a COMPLETE build is ready.
 *
 * The signal is a marker file the launcher writes *after* `vite build` exits
 * cleanly — deliberately not a watcher on `build/` itself, because Vite empties
 * that directory first and the window would reload onto a half-written bundle.
 *
 * `fs.watchFile` (polling) rather than `fs.watch`: on Windows a file replaced by
 * rename loses an `fs.watch` handle. One polled file every 500ms costs nothing.
 * Only installed when the window is actually loaded from the build — under Vite,
 * HMR already handles this. See spec section 34.
 */
let reloadWatcherActive = false;

function watchForRebuilds(win) {
  if (reloadWatcherActive) return;

  const marker = path.join(__dirname, '..', 'build', '.reload');
  let lastSeen = 0;

  try {
    if (fs.existsSync(marker)) lastSeen = fs.statSync(marker).mtimeMs;
  } catch { /* first run — no marker yet */ }

  fs.watchFile(marker, { interval: 500 }, (curr) => {
    if (!curr.mtimeMs || curr.mtimeMs === lastSeen) return;
    lastSeen = curr.mtimeMs;

    if (win.isDestroyed()) return;
    console.warn('[main] New build detected — reloading the window');
    // IgnoringCache so a same-named chunk cannot be served from memory
    win.webContents.reloadIgnoringCache();
  });

  reloadWatcherActive = true;
}

// ─── Main Window ─────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        900,
    minHeight:       600,
    frame:           false,       // custom titlebar
    transparent:     false,
    backgroundColor: '#020408',   // --bg from design tokens
    show:            false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  // Resolve the renderer: dev server → production build → diagnostic page.
  // Always ends with something on screen; never a blank window.
  loadRenderer(mainWindow).then(({ source }) => {
    console.warn(`[main] Renderer loaded from: ${source}`);
    // Under Vite, HMR already applies renderer changes; only the build path needs
    // an explicit reload signal.
    if (source === 'build' && isDev) watchForRebuilds(mainWindow);
  }).catch((err) => {
    console.error('[main] Renderer load failed:', err.message);
    mainWindow?.loadURL(bootFailurePage([
      { ok: false, what: 'Renderer', detail: err.message },
    ]));
  });

  // A load failure after this point (dev server dying mid-session, for example)
  // must also surface in the window rather than leaving it blank.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;   // -3 = aborted, normal on navigation
    console.error(`[main] did-fail-load ${code} ${desc} ${url}`);
    mainWindow?.loadURL(bootFailurePage([
      { ok: false, what: 'Renderer', detail: `${desc} (${code}) — ${url}` },
    ]));
  });

  // Show once ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    // If launched via auto-start (--hidden), start in tray only
    if (!isHidden) {
      mainWindow.show();
    }
    setupAutoUpdater();
  });

  // A broken bridge breaks everything downstream, and the renderer cannot report
  // it once window.rama is gone. Surface it in the terminal and in the window.
  ipcMain.removeAllListeners('app:preload-error');
  ipcMain.on('app:preload-error', (_e, failures) => {
    const list = Array.isArray(failures) ? failures : [String(failures)];
    console.error('[main] Preload bridge failed:', list.join(' | '));
    mainWindow?.loadURL(bootFailurePage([
      { ok: false, what: 'Preload bridge', detail: list.join(' — ') },
      { ok: true,  what: 'Engines',        detail: 'running; only the bridge to the UI is broken' },
    ]));
  });

  // Window controls via IPC
  ipcMain.on('window:minimize',     () => mainWindow?.minimize());
  ipcMain.on('window:maximize',     () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close',        () => mainWindow?.close());
  ipcMain.on('window:is-maximized', (e) => {
    e.returnValue = mainWindow?.isMaximized() ?? false;
  });

  // Maximize state changes → notify renderer
  mainWindow.on('maximize',   () => mainWindow?.webContents.send('window:maximized',   true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));

  // Minimize to tray instead of taskbar close
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  // Use a blank 16x16 nativeImage if no icon present (icon.png added in Phase 6)
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'icon.png'));
    icon = icon.resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Rāma AGI — Supreme Benevolent AGI');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '⚡ Open Rāma',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '💬 New Conversation',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.webContents.send('nav:goto', '/');
      },
    },
    {
      label: '📊 System Status',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.webContents.send('nav:goto', '/system');
      },
    },
    {
      label: '🔄 Git Sync',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.webContents.send('nav:goto', '/git');
      },
    },
    { type: 'separator' },
    {
      label: '🔄 Check for Updates',
      click: () => {
        if (!isDev) autoUpdater.checkForUpdates();
      },
    },
    { type: 'separator' },
    {
      label: '✕ Quit Rāma',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ─── IPC: Updater controls ───────────────────────────────────────────────────
ipcMain.on('updater:install-now', () => {
  app.isQuiting = true;
  autoUpdater.quitAndInstall();
});

// ─── IPC: Open external links safely ─────────────────────────────────────────
ipcMain.handle('shell:open-external', async (_e, url) => {
  const safe = url.startsWith('https://') || url.startsWith('http://');
  if (!safe) return { error: 'Blocked non-http URL' };
  await shell.openExternal(url);
  return { ok: true };
});

// ─── IPC: Auto-start on login ─────────────────────────────────────────────────
ipcMain.handle('app:set-login-item', (_e, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    name: 'Rama AGI',
    args: ['--hidden'],
  });
  return { ok: true, enabled };
});

ipcMain.handle('app:get-login-item', () => {
  const settings = app.getLoginItemSettings();
  return { ok: true, openAtLogin: settings.openAtLogin };
});

ipcMain.handle('app:get-version', () => app.getVersion());

// ─── IPC: Native notification ─────────────────────────────────────────────────
ipcMain.handle('notify', async (_e, { title, body }) => {
  new Notification({ title, body }).show();
  return { ok: true };
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize session manager (check first-run, etc.)
  const dataDir = dataStore.getDataDir();
  await sessionMgr.init(dataDir);

  // Register all IPC handlers
  systemIPC.register(ipcMain);
  fsIPC.register(ipcMain);
  gitIPC.register(ipcMain);
  terminalIPC.register(ipcMain, mainWindow);
  appsIPC.register(ipcMain);
  aiIPC.register(ipcMain);
  browserIPC.register(ipcMain);
  vaultIPC.register(ipcMain);
  modelIPC.register(ipcMain);
  agentIPC.register(ipcMain);
  intelligenceIPC.register(ipcMain);
  evolutionIPC.register(ipcMain);
  resourceOrchestrator.register(ipcMain);
  // Upgrade layer
  vectorMemoryIPC.register(ipcMain);
  sandboxIPC.register(ipcMain);
  graphIPC.register(ipcMain);
  selfCareIPC.register(ipcMain);
  eventBus.register(ipcMain);
  astIPC.register(ipcMain);
  codeRegenIPC.register(ipcMain);
  nucleusSealer.register(ipcMain);
  ipcEncryption.register(ipcMain);
  proposalLedger.register(ipcMain);
  genomeApplier.register();   // closes the gap: GENOME proposals could not be applied
  registerAppearance(ipcMain);
  // Genome layer — registered after the engines it describes so verify() is honest
  genomeIPC.register(ipcMain);
  instanceIPC.register(ipcMain);
  metaCognitionIPC.register(ipcMain);
  timelineIPC.register(ipcMain);
  voiceIPC.register(ipcMain);
  sessionMgr.register(ipcMain);
  dataStore.register(ipcMain);
  // Auth is registered after the store so its adapter can attach on unlock
  authIPC.register(ipcMain);

  // CSP and permission policy must be installed before the window makes requests
  applyCsp();
  applyPermissions();

  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep alive in tray — only quit via tray menu
  if (process.platform !== 'darwin') {
    // intentionally do NOT call app.quit() here
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
  sessionMgr.lockSession();   // zero all key material
  nucleusSealer.lock();        // zero nucleus key
  ipcEncryption.clearSession(); // zero IPC session key
  aiIPC.stopAll();
  terminalIPC.destroyAll();
  browserIPC.closeBrowser();
});
