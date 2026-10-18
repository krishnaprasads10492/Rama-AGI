// Real-Electron smoke test for principalBinding.install() (spec Section 150.1).
//
// Everything in verifyPrincipalBinding.cjs runs against a FAKE ipcMain under plain Node. The riskiest line
// in that change is the one that replaces methods on the REAL Electron `ipcMain`, so this runs it there: a
// hidden window, real IPC from a real renderer, real webContents ids and the real 'destroyed' event. The
// session table is stubbed, nothing of the app starts, and no app data is read or written.
//
// NOT part of `npm run verify`: it needs an Electron binary and a display-capable session. Run it by hand:
//
//     npx electron scripts/smokePrincipalBinding.cjs --no-sandbox
//
// Exit 0 means every check passed.
'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const pb = require(path.join(__dirname, '..', 'electron', 'lib', 'principalBinding.cjs'));

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the test decides when to exit */ });

const results = [];
const check = (label, ok) => results.push([label, !!ok]);

app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    pb.useAuth({
      validateSession: (t) => (t === 'tok' ? { userId: 'u1' } : null),
      findById: () => ({ userId: 'u1', username: 'real-guest', tier: 5, isActive: true }),
      publicUser: (u) => ({ ...u, id: u.userId }),
    });
    check('install() wraps the REAL ipcMain', pb.install(ipcMain) === true);
    check('and a second install does nothing', pb.install(ipcMain) === false);

    let seen = null;
    ipcMain.handle('t:echo', (e, payload) => { seen = payload; return { ok: true }; });
    ipcMain.handle('t:bind', (e) => { pb.bind(e.sender, 'tok', 'fp'); return { id: e.sender.id }; });
    ipcMain.handle('t:pos', (e, u, extra) => { seen = [u, extra]; return { ok: true }; });
    ipcMain.handleOnce('t:once', (e, payload) => { seen = payload; return { ok: true }; });

    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    await win.loadURL('about:blank');
    const invoke = (code) => win.webContents.executeJavaScript(code);
    const FORGED = "{ user: { tier: 0, id: 'x', userId: 'x', username: 'forger' }, text: 'hi' }";

    await invoke(`require('electron').ipcRenderer.invoke('t:echo', ${FORGED})`);
    check('real IPC, unbound window: the forged tier-0 user arrives as null', seen && seen.user === null && seen.text === 'hi');

    const bound = await invoke("require('electron').ipcRenderer.invoke('t:bind')");
    check('the handler saw a real webContents id', typeof bound.id === 'number' && bound.id === win.webContents.id);

    await invoke(`require('electron').ipcRenderer.invoke('t:echo', ${FORGED})`);
    check('real IPC, bound window: the forged user is replaced by the validated guest',
      seen && seen.user && seen.user.tier === 5 && seen.user.username === 'real-guest' && seen.text === 'hi');

    await invoke("require('electron').ipcRenderer.invoke('t:pos', { tier: 0, id: 'x' }, 'kept')");
    check('a POSITIONAL user over real IPC is replaced and the other argument is kept',
      seen && seen[0] && seen[0].tier === 5 && seen[1] === 'kept');

    await invoke("require('electron').ipcRenderer.invoke('t:echo', { plain: 1 })");
    check('a payload with no user is delivered unchanged', JSON.stringify(seen) === JSON.stringify({ plain: 1 }));

    await invoke(`require('electron').ipcRenderer.invoke('t:once', ${FORGED})`);
    check('handleOnce is wrapped as well', seen && seen.user && seen.user.tier === 5);

    check('one window is bound', pb.boundCount() === 1);
    win.destroy();
    await new Promise((r) => setTimeout(r, 300));
    check('destroying the window removes its binding (the real "destroyed" event fired)', pb.boundCount() === 0);

    exitCode = results.every(([, ok]) => ok) ? 0 : 1;
  } catch (err) {
    check(`crashed: ${err && err.message}`, false);
  }
  for (const [label, ok] of results) process.stderr.write(`  ${ok ? 'PASS' : 'FAIL'}  ${label}\n`);
  const passed = results.filter(([, o]) => o).length;
  process.stderr.write(`\n${exitCode === 0 ? 'ALL PASS' : 'FAILED'} - ${passed} passed, ${results.length - passed} failed\n`);
  app.exit(exitCode);
});
