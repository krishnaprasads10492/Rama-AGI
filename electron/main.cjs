'use strict';

// ─── Crash guard — FIRST, before anything else can throw ─────────────────────
// This must precede every other require. The installed app once died on
// `Cannot find module 'debug'` thrown from a module-scope require below, and
// Electron showed its own raw stack dialog because nothing had claimed the
// exception — every one of Rāma's diagnostics is registered inside
// app.whenReady(), hundreds of lines downstream of the throw. A guard installed
// after the require that fails protects nothing. See spec Section 49.
const crashGuard = require('./lib/crashGuard.cjs');
crashGuard.install();

const { safeRequire, loadFailures, isStub, retryFailures, ensureRepairPath, useRequire } = require('./lib/safeRequire.cjs');
// Hand safeRequire this file's `require`, so './ipc/x.cjs' resolves from `electron/`
// where the caller lives, not from `electron/lib/` where safeRequire lives. Without
// this every guarded require failed and every engine became a silent stub — see
// spec Section 63.
useRequire(require);

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
// electron-updater is NOT required here. It was, at module scope, and its
// dependency chain (builder-util-runtime -> debug) is what killed the installed
// app. setupAutoUpdater() guards its *invocation* with `if (isDev) return`, but
// that check sits ~550 lines further down — far too late to prevent a require
// from throwing. It is now loaded lazily, inside the function that uses it.

// ─── IPC Handlers ───────────────────────────────────────────────────────────
// Loaded through safeRequire: a subsystem that cannot load degrades to an inert
// stub that reports its own absence, instead of aborting startup for the other
// thirty capabilities that are perfectly intact. This is invariant I11 applied at
// the loading boundary — the engines already had internal fallbacks, but a fatal
// require meant those fallbacks never got the chance to run.
const systemIPC    = safeRequire('./ipc/system.cjs',            'System sensing');
const fsIPC        = safeRequire('./ipc/filesystem.cjs',        'Filesystem');
const gitIPC       = safeRequire('./ipc/git.cjs',               'Version control');
const terminalIPC  = safeRequire('./ipc/terminal.cjs',          'Terminal');
const appsIPC      = safeRequire('./ipc/appAssimilation.cjs',   'App assimilation');
const aiIPC        = safeRequire('./ipc/aiProcess.cjs',         'AI backend process');
const marketIPC    = safeRequire('./ipc/marketIntel.cjs',       'Market intelligence');
const browserIPC   = safeRequire('./ipc/browserEngine.cjs',     'Browser engine');
const vaultIPC     = safeRequire('./ipc/credentialVault.cjs',   'Credential vault');
const modelIPC     = safeRequire('./ipc/modelRouter.cjs',       'Model router');
const agentIPC         = safeRequire('./ipc/agentOrchestrator.cjs',    'Agent orchestrator');
const intelligenceIPC  = safeRequire('./ipc/intelligenceEngine.cjs',   'Intelligence engine');
const evolutionIPC         = safeRequire('./ipc/evolutionEngine.cjs',  'Evolution engine');
const resourceResearchIPC  = safeRequire('./ipc/resourceResearchEngine.cjs', 'Resource research');
const resourceOrchestrator = safeRequire('./resourceOrchestrator.cjs', 'Resource orchestrator');
// ─── Upgrade layer (additive — wraps existing, never replaces) ───────────────
const vectorMemoryIPC  = safeRequire('./ipc/vectorMemory.cjs',   'Vector memory');
const sandboxIPC       = safeRequire('./ipc/sandboxEngine.cjs',  'Execution sandbox');
const graphIPC         = safeRequire('./ipc/graphReasoner.cjs',  'Graph planner');
const selfCareIPC      = safeRequire('./ipc/selfCare.cjs',       'Self-care monitor');
// ─── Neural Lattice Nexus + Code Intelligence ─────────────────────────────────
const eventBus         = safeRequire('./ramaEventBus.cjs',       'Event bus');
const astIPC           = safeRequire('./ipc/astEngine.cjs',      'Code comprehension');
const codeRegenIPC     = safeRequire('./ipc/codeRegenEngine.cjs','Self-modification');
// ─── Immutable Encryption Foundry ────────────────────────────────────────────
// These two are load-bearing for identity and encryption. They are still loaded
// through safeRequire so the failure is *reported* rather than silent, but the
// startup doctor treats their absence as fatal rather than degraded.
const nucleusSealer    = safeRequire('./nucleusSealer.cjs',      'Nucleus (identity)');
const ipcEncryption    = safeRequire('./ipcEncryption.cjs',      'IPC encryption');
// ─── Shared foundations (one HTTP client, one approval ledger) ────────────────
const proposalLedger   = safeRequire('./lib/proposals.cjs',      'Approval ledger');
// ─── Genome / Instance layer (holonic architecture) ───────────────────────────
const genomeIPC        = safeRequire('./genome.cjs',             'Genome');
const genomeApplier    = safeRequire('./lib/genomeApplier.cjs',  'Genome applier');
const releaseChannel   = safeRequire('./lib/releaseChannel.cjs', 'Release channel');
const localUpdateEngine = safeRequire('./lib/localUpdateEngine.cjs', 'Local self-update');
const publishProposal  = safeRequire('./lib/publishProposal.cjs','Proposal publishing');
const authIPC          = safeRequire('./ipc/authEngine.cjs',     'Authentication');
const instanceIPC      = safeRequire('./ipc/instanceManager.cjs','Instance lifecycle');
const metaCognitionIPC = safeRequire('./ipc/metaCognition.cjs',  'Meta-cognition');
const timelineIPC      = safeRequire('./ipc/timeline.cjs',       'Timeline');
const voiceIPC         = safeRequire('./ipc/voiceEngine.cjs',    'Voice');
const sessionMgr   = safeRequire('./sessionManager.cjs',         'Session manager');
const dataStore    = safeRequire('./dataStore.cjs',              'Encrypted store');
// ─── Floating status badge (always-on-top presence indicator) ────────────────
const badgeWindow  = safeRequire('./badgeWindow.cjs',            'Status badge');
const badgeState   = safeRequire('./lib/badgeState.cjs',         'Badge state');

// ─── Appearance (persisted zoom + first-run fit to the display) ──────────────
const appearanceState = require('./lib/appearanceState.cjs');

// ─── Constants ──────────────────────────────────────────────────────────────
const isDev    = !app.isPackaged;
const isHidden = process.argv.includes('--hidden');   // Launched by auto-start
// The launcher may move the dev server if 5173 is taken, so honour its choice
const VITE_PORT = Number(process.env.RAMA_VITE_PORT) || 5173;
const VITE_URL  = `http://localhost:${VITE_PORT}`;
const BUILD_INDEX = path.join(__dirname, '..', 'build', 'index.html');

let mainWindow = null;
let tray       = null;
// Filled by the startup doctor inside whenReady, and exposed to the renderer over
// `health:startup` so the UI can show what degraded instead of leaving master to
// discover it feature by feature.
let startupHealth = null;
// The resolved electron-updater instance, or null when it could not be loaded or
// this is a dev run. Row 70 moved the require inside setupAutoUpdater() so a broken
// dependency chain could not kill startup — but two module-scope call sites (the
// tray's "Check for Updates" and the updater:install-now handler) kept referring to
// the function-local name, so clicking either threw a ReferenceError. Since
// crashGuard treats uncaughtException as always fatal, that killed a working app.
// The lazy require stays; this is where its result is kept. See spec Section 60.
let updater = null;
// What the repair pass obtained and what stayed out of reach, exposed alongside
// the diagnosis so master sees the fix and not only the fault.
let startupRepair = null;
// Subsystems whose register() threw. Every channel they own is absent, so anything
// touching one gets "No handler registered" — this is what turns that into a named
// cause instead of a guess. Surfaced through `health:startup`.
const registrationFailures = [];
// Every channel actually created, recorded as it is created. Electron offers no way
// to ask "is this channel registered", and without that a missing handler can only
// be discovered by a renderer calling it and failing.
const registeredChannels = new Set();
// What the passcode screen needs before it can do anything. If any of these are
// absent, master is looking at a dead gate and no in-app panel can tell him why.
const BOOT_CRITICAL_CHANNELS = [
  'session:is-first-run',
  'session:unlock',
  'session:status',
  'store:get',
];

// ─── Auto Updater ────────────────────────────────────────────────────────────
/** A short notice to master, wherever he can currently see one. */
function notifyUpdater(title, body) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:notice', { title, body, ts: Date.now() });
    }
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch { /* no window, no notifier — the console line at the call site stands */ }
}

/**
 * Master asking for an update check by hand, from the tray.
 *
 * Kept separate from `setupAutoUpdater`'s automatic check because the answers differ:
 * an automatic check that finds nothing should stay quiet, whereas master clicking
 * the item deserves a reply either way. Until a release is tagged the honest reply
 * is "there is no newer version yet", which per master's release policy (Section 60)
 * is the expected state and not a fault.
 */
function checkForUpdatesOnDemand() {
  if (isDev) {
    notifyUpdater('Not available in development', 'Updates apply to an installed build.');
    return;
  }
  if (!updater) {
    notifyUpdater('Updater unavailable', 'Rāma could not load its update component in this run.');
    return;
  }
  Promise.resolve()
    .then(() => updater.checkForUpdates())
    .then((res) => {
      if (!res?.updateInfo) notifyUpdater('Rāma is up to date', 'No newer version has been published.');
    })
    .catch((err) => {
      const msg = String(err?.message ?? err);
      if (/no published versions/i.test(msg)) {
        console.warn('[Updater] no release published yet — expected until master tags one');
        notifyUpdater('No releases published yet', 'This build is the current one. Nothing to update to.');
        return;
      }
      console.error(`[Updater] check failed: ${msg}`);
      notifyUpdater('Update check failed', msg);
    });
}

function setupAutoUpdater() {
  if (isDev) return;

  // Lazily required, and guarded. For an installed app the updater is the ONLY
  // real repair channel — a corrected build can replace a broken one — so losing
  // it is a genuine degradation worth reporting. But it must never be the reason
  // the app cannot start, which is exactly what happened when this was a
  // module-scope require.
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn(`[Updater] unavailable (${err.message}) — Rāma cannot self-update this install`);
    return;
  }
  if (!autoUpdater) return;
  updater = autoUpdater;   // the one reference the rest of the process may use

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

  // `checkForUpdatesAndNotify()` returns a promise, and the 'error' event above
  // does NOT catch its rejection — both fire. Without this .catch() the rejection
  // was unhandled, and once crashGuard started claiming unhandledRejection it
  // became fatal for an app that had already started successfully.
  //
  // "No published versions on GitHub" is the EXPECTED state here, not a fault:
  // ledger row 53 records that no release has ever been tagged, so the releases
  // feed is legitimately empty. Reporting that as an error would train master to
  // ignore updater messages, so it is stated as information instead.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    const msg = String(err?.message ?? err);
    if (/no published versions/i.test(msg)) {
      console.warn('[Updater] No release has been published yet — nothing to update to. This is expected until a version is tagged.');
      return;
    }
    // Anything else is a real failure of the update channel. Worth saying, and
    // never worth killing a running app over — self-update is a capability, not a
    // prerequisite.
    console.error(`[Updater] Update check failed: ${msg}`);
  });
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
async function probeVite(timeoutMs = 1500) {
  // Routed through lib/http.cjs (invariant I9 — one main-process HTTP
  // client) rather than a raw require('http').get. maxSize keeps this cheap
  // even if the dev server ever answered with something huge.
  const net = require('./lib/http.cjs');
  const res = await net.get(`http://localhost:${VITE_PORT}/`, {
    timeout: timeoutMs, retries: 0, maxSize: 16384,
  });
  if (!res.ok || res.status !== 200) return false;
  return (res.body || '').includes('id="root"');
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

// ─── Local self-update (master's own git repo → install → build → apply) ────
/**
 * Master-triggered local CI/CD: pull the configured repo, install/build only
 * what changed, and apply the result to THIS running instance. No external
 * pipeline — see RAMA_AGI_MASTER_SPEC.md Section 40. Gated by tier, not by
 * proposals.cjs (I6 governs Rāma authoring its own changes; this is master
 * fetching commits that already exist in their own git history).
 */
function registerLocalUpdate(ipcMain) {
  const capability = require('./lib/capability.cjs');

  ipcMain.handle('update:check', async (_e, { repoPath } = {}) => {
    return localUpdateEngine.checkForUpdates(repoPath);
  });

  ipcMain.handle('update:pull-build', async (event, { user, repoPath, force } = {}) => {
    if (!capability.can(user, 'system.self-update')) {
      const who = capability.TIER_LABELS[String(user?.tier)] ?? 'This account';
      return { ok: false, error: `${who} may not trigger a local update (needs "system.self-update")` };
    }
    return localUpdateEngine.pullBuildApply({
      repoPath, force,
      onLog: (chunk) => event.sender.send('update:log', chunk),
    });
  });

  // Reload just the window — safe when only the renderer changed
  ipcMain.handle('update:reload-window', async (_e, { user } = {}) => {
    if (!capability.can(user, 'system.self-update')) return { ok: false, error: 'Not permitted' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    mainWindow.webContents.reloadIgnoringCache();
    return { ok: true };
  });

  // Full relaunch — needed when electron/server/deps changed. Uses Electron's
  // own relaunch, so this respects the same lifecycle a manual restart would
  // (session locks, tray cleanup via 'before-quit' handlers already wired).
  ipcMain.handle('update:restart-app', async (_e, { user } = {}) => {
    if (!capability.can(user, 'system.self-update')) return { ok: false, error: 'Not permitted' };
    app.relaunch();
    app.isQuiting = true;
    app.exit(0);
    return { ok: true };
  });
}

/**
 * Badge control — enable/disable (clickability), status is read-only from
 * the renderer's side (driven by actual main-process state above), and the
 * "bring everything to front" action voice/UI both call into. No capability
 * gate: same sensitivity class as window minimize/maximize (pure UI
 * visibility, not data or execution access) — any signed-in tier may do this
 * to their own visible instance.
 */
function registerBadgeIpc(ipcMain) {
  ipcMain.handle('badge:set-enabled', async (_e, enabled) => {
    badgeWindow.setEnabled(!!enabled);
    return { ok: true, enabled: !!enabled };
  });

  ipcMain.handle('badge:get-enabled', async () => {
    return { ok: true, enabled: badgeWindow.isEnabled() };
  });

  ipcMain.handle('badge:bring-to-front', async () => {
    bringToFront();
    return { ok: true };
  });

  ipcMain.handle('badge:set-hide-tray', async (_e, hide) => {
    const current = badgeState.load();
    badgeState.save({ ...current, hideTray: !!hide });
    if (hide && tray) { tray.destroy(); tray = null; }
    else if (!hide && !tray) { createTray(); }
    return { ok: true, hideTray: !!hide };
  });
}

/**
 * Apply the zoom this display deserves, once the renderer has loaded.
 *
 * Must run after load: `setZoomFactor` is per-webContents and is reset by a
 * navigation, so setting it at window-creation time would be silently undone by
 * `loadRenderer`. Called from `did-finish-load`, which fires for the dev server,
 * the built bundle and the diagnostic page alike.
 */
function applyResolvedZoom(reason = 'load') {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const resolved = appearanceState.resolveZoom(display.workAreaSize, display.scaleFactor);
    mainWindow.webContents.setZoomFactor(resolved.zoom);
    if (resolved.fitted) {
      console.warn(
        `[appearance] fitted zoom ${resolved.zoom} to ${display.workAreaSize.width}x${display.workAreaSize.height} DIP `
        + `(scaleFactor ${display.scaleFactor}) — ${reason}`,
      );
    }
    return resolved;
  } catch (err) {
    console.warn('[appearance] could not resolve zoom:', err.message);
    return null;
  }
}

/**
 * Startup health, readable from the UI.
 *
 * No capability gate: this is the same sensitivity class as the aggregate CPU/RAM
 * numbers the Home dashboard already shows to any signed-in tier, and withholding
 * "your installation is incomplete" from the person looking at a broken feature
 * would be the opposite of useful. It reports absence, never contents.
 */
function registerHealthIpc(ipcMain) {
  ipcMain.handle('health:startup', async () => {
    if (!startupHealth) return { ok: false, error: 'Startup diagnosis has not run yet' };
    return {
      ok: true,
      data: {
        healthy:       startupHealth.ok,
        fatal:         startupHealth.fatal,
        degraded:      startupHealth.degraded,
        checks:        startupHealth.report,
        previousCrash: startupHealth.previousCrash,
        buildManifest: startupHealth.buildManifest,
        packaged:      app.isPackaged,
        // Subsystems whose IPC never registered. Without this, a missing channel is
        // only ever visible as "No handler registered" at the call site.
        registrationFailures,
        repair:        startupRepair && {
          attempted: startupRepair.attempted,
          repaired:  startupRepair.repaired,
          recovered: startupRepair.recoveredSubsystems,
          remaining: startupRepair.stillMissing,
          notes:     startupRepair.notes,
        },
      },
    };
  });

  // Repair on demand, for when master would rather not wait for a relaunch.
  ipcMain.handle('health:repair', async () => {
    if (!startupHealth) return { ok: false, error: 'Startup diagnosis has not run yet' };
    const doctor = require('./lib/startupDoctor.cjs');
    const outcome = await doctor.repair(startupHealth, {
      safeRequireFailures: loadFailures(),
      crashReports:        crashGuard.recentReports(3),
      appRoot:             path.join(__dirname, '..'),
      retryFailures,
    });
    startupRepair = outcome;
    if (outcome.rediagnosed) startupHealth = outcome.rediagnosed;
    return { ok: true, data: outcome };
  });

  // Past crashes, so a fault that killed a previous launch is visible now rather
  // than only in a file master would have to know to look for.
  ipcMain.handle('health:crash-reports', async (_e, limit) => {
    return { ok: true, data: crashGuard.recentReports(Number(limit) || 5) };
  });

  ipcMain.handle('health:crash-dir', async () => {
    return { ok: true, data: crashGuard.reportDir() };
  });
}

function registerAppearance(ipcMain) {
  // A zoom master sets by hand is remembered and stops the automatic fit from
  // ever overriding it again. Previously nothing was written down at all, so the
  // value reverted to 1.0 on the next launch and the setting looked broken.
  ipcMain.handle('appearance:set-zoom', async (_e, factor) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    const z = clampZoom(factor);
    mainWindow.webContents.setZoomFactor(z);
    appearanceState.rememberMasterZoom(z);
    return { ok: true, zoom: z, min: ZOOM_MIN, max: ZOOM_MAX, source: 'master' };
  });

  ipcMain.handle('appearance:get-zoom', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    const state = appearanceState.load();
    return {
      ok: true,
      zoom: mainWindow.webContents.getZoomFactor(),
      min: ZOOM_MIN, max: ZOOM_MAX,
      source: state.source,
      fittedFor: state.fittedFor,
    };
  });

  // Nudge by a step — what "make the text bigger" resolves to at tier 0
  ipcMain.handle('appearance:nudge-zoom', async (_e, delta) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    const current = mainWindow.webContents.getZoomFactor();
    const z = clampZoom(current + (Number(delta) || 0));
    mainWindow.webContents.setZoomFactor(z);
    appearanceState.rememberMasterZoom(z);
    return {
      ok: true, zoom: z, min: ZOOM_MIN, max: ZOOM_MAX, source: 'master',
      atLimit: z === ZOOM_MIN || z === ZOOM_MAX,
    };
  });

  // Hand control back to the automatic fit — the way out of a zoom master no
  // longer wants, without having to guess what this display's default was.
  ipcMain.handle('appearance:reset-zoom', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
    appearanceState.clearMasterZoom();
    const resolved = applyResolvedZoom('reset');
    return {
      ok: true,
      zoom: resolved?.zoom ?? mainWindow.webContents.getZoomFactor(),
      min: ZOOM_MIN, max: ZOOM_MAX, source: 'auto',
    };
  });

  // What the fit would choose for the current display, without applying it.
  ipcMain.handle('appearance:display-info', async () => {
    try {
      const { screen } = require('electron');
      const d = screen.getPrimaryDisplay();
      return {
        ok: true,
        workArea: d.workAreaSize,
        scaleFactor: d.scaleFactor,
        suggestedZoom: appearanceState.fitZoomFor(d.workAreaSize),
        reference: { width: appearanceState.REF_WIDTH, height: appearanceState.REF_HEIGHT },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
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

  // Zoom is per-webContents and a navigation resets it, so it is applied after
  // every load rather than once at creation — otherwise loadRenderer's own
  // navigation would silently undo it.
  mainWindow.webContents.on('did-finish-load', () => applyResolvedZoom('did-finish-load'));

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

  // Minimize to tray instead of taskbar close. The badge tracks this: full
  // window visible → 'live', minimized/hidden (badge is the only visible
  // presence) → 'paused'. It never goes fully invisible on its own — only
  // an explicit "disable badge" (click-through) or app quit changes that.
  mainWindow.on('minimize', () => {
    mainWindow.setSkipTaskbar(true);
    badgeWindow.setStatus('paused');
  });
  mainWindow.on('restore', () => {
    mainWindow.setSkipTaskbar(false);
    badgeWindow.setStatus('live');
  });
  mainWindow.on('show', () => {
    mainWindow.setSkipTaskbar(false);
    badgeWindow.setStatus('live');
  });
  mainWindow.on('hide', () => {
    mainWindow.setSkipTaskbar(true);
    badgeWindow.setStatus('paused');
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

/**
 * Bring the whole app forward regardless of current visibility state — the
 * voice "come back"/"bring rama forward" action, and the badge's click
 * handler when enabled. Restores the tray icon too if it had been hidden,
 * since a hidden tray with a hidden window would otherwise leave no way
 * back in short of the badge itself.
 */
function bringToFront() {
  if (badgeState.load().hideTray && !tray) createTray();
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(); return; }
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
  badgeWindow.setStatus('live');
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
      click: () => { checkForUpdatesOnDemand(); },
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
  if (!updater) {
    // Previously this threw a ReferenceError, which crashGuard turns into a fatal
    // dialog. There is nothing to install if the updater never loaded.
    console.warn('[Updater] install requested but the updater is not available in this run');
    notifyUpdater('Nothing to install', 'The updater is not available in this run.');
    return;
  }
  app.isQuiting = true;
  try { updater.quitAndInstall(); }
  catch (err) {
    app.isQuiting = false;
    console.error(`[Updater] install failed: ${err.message}`);
    notifyUpdater('Update could not be installed', err.message);
  }
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
  // ── Self-diagnosis, in the app, before anything depends on it ──────────────
  // The packaged equivalent of start.cjs's diagnose stage, which does not ship.
  // Runs first so the findings are available to everything after it, and so a
  // fatally incomplete installation is reported by Rāma rather than discovered by
  // master when a feature silently does nothing. See spec Section 49.
  const doctor = require('./lib/startupDoctor.cjs');
  startupHealth = doctor.diagnose({
    safeRequireFailures: loadFailures(),
    crashReports:        crashGuard.recentReports(3),
    appRoot:             path.join(__dirname, '..'),
  });

  console.warn(`[doctor] startup ${doctor.summarise(startupHealth)}`);
  for (const f of startupHealth.fatal)    console.error(`[doctor] FATAL: ${f.detail}`);
  for (const d of startupHealth.degraded) console.warn(`[doctor] degraded: ${d.detail}`);

  if (startupHealth.previousCrash) {
    console.warn(`[doctor] the previous run ended in a crash: ${startupHealth.previousCrash.message}`);
  }

  // ── Self-repair, deferred until after the window exists ────────────────────
  // Scheduled rather than awaited: fetching a package is network-bound, and an
  // app that shows nothing until the network answers looks broken in exactly the
  // way this is supposed to prevent. Master gets a usable window immediately and
  // the repair lands underneath it, then `health:startup` reports what changed.
  // See spec Section 53.
  if (!startupHealth.ok || startupHealth.degraded.some(d => !d.expected)) {
    setTimeout(() => {
      // Make anything repaired in a previous session resolvable. Done HERE, after
      // every engine has loaded — never during the require chain, which is what
      // cost a packaged build all of its engines (Section 62).
      ensureRepairPath();
      doctor.repair(startupHealth, {
        safeRequireFailures: loadFailures(),
        crashReports:        crashGuard.recentReports(3),
        appRoot:             path.join(__dirname, '..'),
        retryFailures,
      }).then((outcome) => {
        startupRepair = outcome;
        if (outcome.repaired.length > 0) {
          console.warn(`[repair] obtained ${outcome.repaired.join(', ')}`);
        }
        if (outcome.recoveredSubsystems.length > 0) {
          console.warn(`[repair] back online: ${outcome.recoveredSubsystems.join(', ')}`);
        }
        for (const n of outcome.notes) console.warn(`[repair] ${n}`);
        if (outcome.stillMissing.length > 0) {
          console.error(`[repair] beyond reach: ${outcome.stillMissing.join(', ')}`);
        }

        // The re-diagnosis is the current truth; keep it so the UI stops showing
        // faults that have since been fixed.
        if (outcome.rediagnosed) {
          startupHealth = outcome.rediagnosed;
          console.warn(`[doctor] after repair: ${doctor.summarise(startupHealth)}`);
        }

        // Tell the window, if it is listening, so master sees recovery happen
        // rather than having to reopen a panel to find out.
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('health:repaired', {
              repaired:  outcome.repaired,
              recovered: outcome.recoveredSubsystems,
              remaining: outcome.stillMissing,
            });
          }
        } catch { /* the window may not be ready; the IPC handler still has it */ }
      }).catch((e) => {
        console.error(`[repair] repair pass failed: ${e.message}`);
      });
    }, 2_000);
  }

  // Initialize session manager (check first-run, etc.)
  const dataDir = dataStore.getDataDir();
  await sessionMgr.init(dataDir);

  // ── Register all IPC handlers, each one independently ──────────────────────
  // WHY A LOOP AND NOT 40 BARE CALLS: these were 40 unguarded statements, so the
  // first one to throw abandoned every later `register()` — and `whenReady` has no
  // `.catch()`, so the window still opened with a silently incomplete IPC surface.
  // The symptom is "No handler registered for 'x'" on whichever channel master
  // happens to touch first, with nothing anywhere saying why. That is the same
  // failure shape `safeRequire` was built for at the *loading* boundary (Section
  // 49), left wide open at the *registration* boundary. `sessionMgr` is third from
  // last here, so a throw almost anywhere took the sign-in screen down with it.
  //
  // Every module receives this instead of `ipcMain`, so channel creation is
  // observable. It forwards to the real ipcMain and only records names — it is not
  // a policy layer and must not become one.
  const ipcRec = {
    handle: (ch, fn) => { registeredChannels.add(ch); return ipcMain.handle(ch, fn); },
    handleOnce: (ch, fn) => { registeredChannels.add(ch); return ipcMain.handleOnce(ch, fn); },
    removeHandler: (ch) => { registeredChannels.delete(ch); return ipcMain.removeHandler(ch); },
    on: (...a) => ipcMain.on(...a),
    once: (...a) => ipcMain.once(...a),
    off: (...a) => ipcMain.off(...a),
    removeListener: (...a) => ipcMain.removeListener(...a),
    removeAllListeners: (...a) => ipcMain.removeAllListeners(...a),
    emit: (...a) => ipcMain.emit(...a),
    listenerCount: (...a) => ipcMain.listenerCount(...a),
  };

  // Order is preserved exactly — several entries depend on it, noted inline.
  const REGISTRATIONS = [
    ['System sensing',        () => systemIPC.register(ipcRec)],
    ['Filesystem',            () => fsIPC.register(ipcRec)],
    ['Version control',       () => gitIPC.register(ipcRec)],
    ['Terminal',              () => terminalIPC.register(ipcRec, mainWindow)],
    ['App assimilation',      () => appsIPC.register(ipcRec)],
    ['AI backend process',    () => aiIPC.register(ipcRec)],
    ['Market intelligence',   () => marketIPC.register(ipcRec)],
    ['Browser engine',        () => browserIPC.register(ipcRec)],
    ['Credential vault',      () => vaultIPC.register(ipcRec)],
    ['Model router',          () => modelIPC.register(ipcRec)],
    ['Agent orchestrator',    () => agentIPC.register(ipcRec)],
    ['Intelligence engine',   () => intelligenceIPC.register(ipcRec)],
    ['Evolution engine',      () => evolutionIPC.register(ipcRec)],
    ['Resource research',     () => resourceResearchIPC.register(ipcRec)],
    ['Resource orchestrator', () => resourceOrchestrator.register(ipcRec)],
    // Upgrade layer
    ['Vector memory',         () => vectorMemoryIPC.register(ipcRec)],
    ['Execution sandbox',     () => sandboxIPC.register(ipcRec)],
    ['Graph planner',         () => graphIPC.register(ipcRec)],
    ['Self-care monitor',     () => selfCareIPC.register(ipcRec)],
    ['Event bus',             () => eventBus.register(ipcRec)],
    ['Code comprehension',    () => astIPC.register(ipcRec)],
    ['Self-modification',     () => codeRegenIPC.register(ipcRec)],
    ['Nucleus (identity)',    () => nucleusSealer.register(ipcRec)],
    ['IPC encryption',        () => ipcEncryption.register(ipcRec)],
    ['Approval ledger',       () => proposalLedger.register(ipcRec)],
    // Closes the gap where GENOME proposals could not be applied
    ['Genome applier',        () => genomeApplier.register()],
    // Dormant until master declares baseline and cuts a release — Sections 39, 60
    ['Release channel',       () => releaseChannel.register(ipcRec)],
    // local pull → install → build → apply — Section 40
    ['Local self-update',     () => registerLocalUpdate(ipcRec)],
    // applied self-modify proposals → a new branch, never dev/source directly
    ['Proposal publishing',   () => publishProposal.register(ipcRec)],
    ['Appearance',            () => registerAppearance(ipcRec)],
    // The loops from Sections 68 and 70 exist but nothing called them — resolution never
    // ran and the news series never gained a second day. Armed here; it declines to start
    // the Python backend itself, so it is silent until master has used StockMind at least
    // once. `RAMA_DISABLE_MARKET_SCHEDULER=1` turns it off.
    ['Market scheduler',      () => marketIPC.startScheduler?.()],
    // startup diagnosis + past crashes, readable from the UI
    ['Startup health',        () => registerHealthIpc(ipcRec)],
    // Genome layer — after the engines it describes, so verify() is honest
    ['Genome',                () => genomeIPC.register(ipcRec)],
    ['Instance lifecycle',    () => instanceIPC.register(ipcRec)],
    ['Meta-cognition',        () => metaCognitionIPC.register(ipcRec)],
    ['Timeline',              () => timelineIPC.register(ipcRec)],
    ['Voice',                 () => voiceIPC.register(ipcRec)],
    ['Session manager',       () => sessionMgr.register(ipcRec)],
    ['Encrypted store',       () => dataStore.register(ipcRec)],
    // Auth is registered after the store so its adapter can attach on unlock
    ['Authentication',        () => authIPC.register(ipcRec)],
  ];

  for (const [label, run] of REGISTRATIONS) {
    try {
      run();
    } catch (err) {
      registrationFailures.push({ label, error: err.message });
      // console.error, not a throw: one broken engine must not cost every later
      // engine its channels. Named explicitly so the cause is in the log rather
      // than inferred from a missing channel.
      console.error(`[main] IPC registration failed for ${label}: ${err.message}`);
    }
  }

  if (registrationFailures.length > 0) {
    console.error(`[main] ${registrationFailures.length} subsystem(s) did not register their IPC channels — features depending on them will report "No handler registered"`);
  }

  // ── Did the channels the first screen needs actually appear? ────────────────
  // A subsystem that failed to *load* is replaced by an inert stub whose
  // `register()` is a silent no-op (safeRequire, Section 49). Nothing throws, so
  // the loop above reports nothing, and the only symptom is "No handler registered
  // for 'session:unlock'" on the passcode screen — with Rāma's own diagnostics
  // sitting behind the very gate that will not open. That is the same trap as
  // `bootFailurePage` being unreachable because every call site was downstream of
  // the failure (Section 49). So the boot path is checked here, and reported with a
  // native dialog, because at this point the renderer cannot be relied on.
  const missingBootChannels = BOOT_CRITICAL_CHANNELS.filter(c => !registeredChannels.has(c));
  const stubbedCritical = [
    ['Session manager',  sessionMgr],
    ['Encrypted store',  dataStore],
    ['Authentication',   authIPC],
  ].filter(([, mod]) => isStub(mod)).map(([name]) => name);

  if (missingBootChannels.length > 0 || stubbedCritical.length > 0) {
    const detail = [
      stubbedCritical.length ? `Did not load: ${stubbedCritical.join(', ')}` : null,
      missingBootChannels.length ? `Missing channels: ${missingBootChannels.join(', ')}` : null,
      registrationFailures.length ? `Registration errors: ${registrationFailures.map(f => `${f.label} (${f.error})`).join('; ')}` : null,
      ...loadFailures().map(f => `Load failure: ${f.name} — ${f.reason}`),
    ].filter(Boolean).join('\n');

    console.error(`[main] boot path incomplete\n${detail}`);
    try {
      crashGuard.record(
        new Error(`Boot path incomplete: ${missingBootChannels.join(', ') || stubbedCritical.join(', ')}`),
        {
          origin: 'boot-check',
          fatalKind: 'boot-incomplete',
          // The reasons travel with the report, so `ship-log` carries the actual
          // cause instead of only the symptom.
          details: {
            stubbed: stubbedCritical,
            missingChannels: missingBootChannels,
            registrationFailures,
            loadFailures: loadFailures().map(f => ({
              name: f.name, reason: f.reason, missing: f.missing,
              code: f.code, requireStack: f.requireStack,
            })),
            channelsRegistered: registeredChannels.size,
          },
        },
      );
    } catch { /* best effort */ }

    // A packaged app has no console, and a dialog cannot be copied out of. Write
    // the full untruncated reasons to a file and name it — see lib/bootReport.cjs.
    let reportPaths = [];
    try {
      reportPaths = require('./lib/bootReport.cjs').write({
        phase: 'boot-check',
        loadFailures: loadFailures(),
        registrationFailures,
        missingChannels: missingBootChannels,
        stubbed: stubbedCritical,
        registeredChannels,
      }).written;
    } catch (e) { console.error(`[main] could not write the boot report: ${e.message}`); }

    try {
      dialog.showMessageBox({
        type:    'error',
        title:   'Rāma cannot reach its own sign-in',
        message: 'Part of Rāma did not start, so the passcode screen has nothing to talk to.',
        detail:  `${detail}\n\nFull report written to:\n${reportPaths.join('\n') || '(could not write a report file)'}\n\nSend that file — it names every missing module and contains no secrets.`,
        buttons: ['Continue anyway', 'Open report', 'Quit'],
        defaultId: 1,
      }).then((res) => {
        if (res.response === 1 && reportPaths[0]) shell.openPath(reportPaths[0]).catch(() => {});
        if (res.response === 2) { app.isQuiting = true; app.quit(); }
      }).catch(() => { /* dialog unavailable */ });
    } catch { /* dialog unavailable */ }
  } else {
    console.warn(`[main] boot path ready — ${registeredChannels.size} IPC channels registered`);
  }

  // CSP and permission policy must be installed before the window makes requests
  applyCsp();
  applyPermissions();

  createMainWindow();

  // Tray is skippable — master can voice-disable it while keeping the app
  // running in the background; "come back" (bringToFront) restores it.
  if (!badgeState.load().hideTray) createTray();

  // The badge is the "always present from boot till close" piece — created
  // once here, independent of the main window's own show/hide lifecycle.
  badgeWindow.create({ onClick: bringToFront });
  registerBadgeIpc(ipcMain);
}).catch((err) => {
  // WHY THIS EXISTS: `whenReady` had no rejection handler at all, so anything
  // throwing in the ~150 lines above abandoned the rest of startup silently. The
  // window could still be open from an earlier line while every IPC channel after
  // the throw was missing, and the only visible symptom was "No handler registered
  // for 'session:unlock'" — a message that names the victim, never the cause.
  //
  // crashGuard is deliberately not asked to kill the app: a partly-started Rāma
  // that can still show master what went wrong is more useful than one that exits.
  // But it must never be silent, which is what it was.
  console.error(`[main] startup did not complete: ${err.message}`);
  console.error(err.stack);

  try { crashGuard.record(err, { origin: 'whenReady', fatalKind: 'startup-incomplete' }); }
  catch { /* recording is best-effort; the console lines above still stand */ }

  let paths = [];
  try {
    paths = require('./lib/bootReport.cjs').write({
      phase: 'whenReady',
      error: err,
      loadFailures: loadFailures(),
      registrationFailures,
      registeredChannels,
    }).written;
  } catch { /* best effort */ }

  try {
    const { dialog: d } = require('electron');
    d.showMessageBox({
      type:    'error',
      title:   'Rāma did not finish starting',
      message: 'Some of Rāma failed to start, so parts of the app will not respond.',
      detail:  `${err.message}\n\nWhat did not start: ${registrationFailures.map(f => f.label).join(', ') || 'startup stopped before IPC registration'}\n\nFull report written to:\n${paths.join('\n') || '(could not write a report file)'}`,
      buttons: ['Continue anyway', 'Open report', 'Quit'],
      defaultId: 1,
    }).then((res) => {
      if (res.response === 1 && paths[0]) shell.openPath(paths[0]).catch(() => {});
      if (res.response === 2) { app.isQuiting = true; app.quit(); }
    }).catch(() => { /* no dialog available */ });
  } catch { /* electron dialog unavailable */ }
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
  require('./lib/sysinfo.cjs').shutdown();   // release the persistent PowerShell session (Windows)
  aiIPC.stopAll();
  terminalIPC.destroyAll();
  browserIPC.closeBrowser();
  badgeWindow.destroy();       // the one case the badge actually goes away — real app exit
});
