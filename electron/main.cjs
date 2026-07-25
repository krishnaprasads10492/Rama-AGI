'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');
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
const agentIPC     = require('./ipc/agentOrchestrator.cjs');

// ─── Constants ──────────────────────────────────────────────────────────────
const isDev  = !app.isPackaged;
const VITE_URL = 'http://localhost:5173';
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

  // Load renderer
  if (isDev) {
    mainWindow.loadURL(VITE_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(BUILD_INDEX);
  }

  // Show once ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setupAutoUpdater();
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

// ─── IPC: Native notification ─────────────────────────────────────────────────
ipcMain.handle('notify', async (_e, { title, body }) => {
  new Notification({ title, body }).show();
  return { ok: true };
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
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
  aiIPC.stopAll();
  terminalIPC.destroyAll();
  browserIPC.closeBrowser();
});
