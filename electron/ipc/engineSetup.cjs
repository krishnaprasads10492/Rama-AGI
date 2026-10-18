'use strict';

/**
 * engineSetup.cjs (IPC) - the channels that make the StockMind engine runnable on this machine (spec Section 154)
 *
 * Gated on the PRINCIPAL main validated, never on a `user` the window sent:
 *   status        stockmind.view     reads: is there a Python, an environment, do the packages import
 *   run           stockmind.config   builds <userData>/python-env and downloads packages (network, disk)
 *   installPython stockmind.config   Windows only; installs Python 3.12 for this user through winget
 *
 * `run` and `installPython` are explicit acts and are never started from `status`, from a timer, or at launch.
 * The renderer polls `status` while a setup runs, so there is no push channel to allow-list.
 */

const path = require('path');
const capability = require('../lib/capability.cjs');
const principalBinding = require('../lib/principalBinding.cjs');
const bootstrap = require('../lib/engineBootstrap.cjs');

function defaults() {
  return {
    exec: bootstrap.realExec,
    platform: process.platform,
    env: process.env,
    userData: () => require('electron').app.getPath('userData'),
    backendPath: () => require('./aiProcess.cjs').resolveBackendPath(),
  };
}

function register(ipcMain, injected = {}) {
  const d = { ...defaults(), ...injected };
  const gated = (cap, fn) => async (e) => {
    const denied = capability.deny(principalBinding.getPrincipal(e), cap);
    if (denied) return denied;
    try { return await fn(); }
    catch (err) { return { ok: false, error: err.message }; }
  };
  const ctx = () => {
    const backendPath = d.backendPath();
    if (!backendPath) return { error: 'The engine files (ai_backend) were not found, so there is nothing to set up.' };
    return {
      exec: d.exec, platform: d.platform, env: d.env, exists: d.exists,
      userData: d.userData(), backendPath: path.resolve(backendPath),
    };
  };

  ipcMain.handle('engineSetup:status', gated('stockmind.view', async () => {
    const c = ctx();
    if (c.error) return { ok: false, error: c.error };
    return { ok: true, data: await bootstrap.status(c) };
  }));

  ipcMain.handle('engineSetup:run', gated('stockmind.config', async () => {
    const c = ctx();
    if (c.error) return { ok: false, error: c.error };
    // Not awaited to completion by the window: a setup is minutes long. The reply says it began, and the
    // window follows it through `status`. A refusal (already running) is returned at once.
    if (bootstrap.snapshotState().running) return { ok: false, error: 'A setup is already running.' };
    bootstrap.run(c).catch(() => { /* recorded in the state by run() itself */ });
    return { ok: true, started: true };
  }));

  ipcMain.handle('engineSetup:install-python', gated('stockmind.config', async () => {
    const c = ctx();
    if (c.error) return { ok: false, error: c.error };
    if (bootstrap.snapshotState().running) return { ok: false, error: 'A setup is already running.' };
    bootstrap.installPython(c).catch(() => { /* recorded in the state */ });
    return { ok: true, started: true };
  }));
}

module.exports = { register };
