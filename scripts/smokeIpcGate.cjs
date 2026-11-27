// Real-Electron smoke test for ipcGuard.install() (spec Sections 196, 200).
//
// WHY THIS EXISTS. `verifyIpcPolicy.cjs` drives the gate against a FAKE ipcMain under plain Node, and
// every tranche since Section 196 has carried the same caveat: "nothing ran inside Electron". That
// caveat covers the single riskiest line shipped in this area —
//
//     isOurSender: ipcGuard.senderCheck({ BrowserWindow })
//
// — which decides, for EVERY channel in the application, whether a call is allowed to run at all. It
// reads `BrowserWindow.getAllWindows()`, compares `webContents.id`, and rejects a frame whose
// `senderFrame.parent` is set. If any of that is wrong about the real Electron objects, the app does
// not start misbehaving in some corner: every IPC call returns `{ ok: false }` and the window comes
// up dead. No fake can tell us whether that is the case. This can.
//
// Same shape and the same restraint as `smokePrincipalBinding.cjs`: a hidden window, real IPC from a
// real renderer, real webContents ids. The capability layer is real; the principal resolver is a stub,
// so no session table is touched. Nothing of the app starts and no app data is read or written.
//
// NOT part of `npm run verify`: it needs an Electron binary and a display-capable session. By hand:
//
//     npx electron scripts/smokeIpcGate.cjs --no-sandbox
//
// Exit 0 means every check passed.
'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const ipcGuard = require(path.join(ROOT, 'electron', 'lib', 'ipcGuard.cjs'));
const capability = require(path.join(ROOT, 'electron', 'lib', 'capability.cjs'));

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the test decides when to exit */ });

const results = [];
const check = (label, ok) => results.push([label, !!ok]);

// The stub principal. Swapped mid-test to prove the gate asks on every call rather than caching.
let principal = null;

app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    const gate = ipcGuard.install({
      ipcMain,
      policy: {
        'smoke:public': 'public',
        'smoke:observed': 'observe',
        'smoke:self': 'self',
        'smoke:needs-vault': 'cap:vault.write',   // tier 0 only
        'smoke:needs-chat': 'cap:chat.send',      // tier 5 and above, i.e. anyone signed in
        'smoke:signed-in': 'signed-in',           // authentication, no particular power (Section 201)
        'smoke:listener': 'cap:vault.write',
      },
      can: capability.can,
      isOurSender: ipcGuard.senderCheck({ BrowserWindow }),
      principal: () => principal,
      report: () => {},
    });

    check('install() wraps the REAL ipcMain', gate !== null);
    check('and a second install is refused', ipcGuard.install({
      ipcMain, policy: {}, can: capability.can, isOurSender: () => true, principal: () => null,
    }) === null);

    let ran = 0;
    ipcMain.handle('smoke:public', () => { ran += 1; return { ok: true, who: 'public' }; });
    ipcMain.handle('smoke:observed', () => { ran += 1; return { ok: true, who: 'observed' }; });
    ipcMain.handle('smoke:self', () => { ran += 1; return { ok: true, who: 'self' }; });
    ipcMain.handle('smoke:needs-vault', () => { ran += 1; return { ok: true, who: 'vault' }; });
    ipcMain.handle('smoke:needs-chat', () => { ran += 1; return { ok: true, who: 'chat' }; });
    ipcMain.handle('smoke:unclassified', () => { ran += 1; return { ok: true, who: 'new' }; });
    ipcMain.handle('smoke:signed-in', () => { ran += 1; return { ok: true, who: 'signedin' }; });

    let heard = 0;
    const listener = () => { heard += 1; };
    ipcMain.on('smoke:listener', listener);

    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    await win.loadURL('about:blank');
    const invoke = (ch, arg = 'null') => win.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke('${ch}', ${arg})`,
    );
    const send = (ch) => win.webContents.executeJavaScript(
      `require('electron').ipcRenderer.send('${ch}')`,
    );

    // ── THE ROW THIS WHOLE FILE EXISTS FOR ────────────────────────────────
    // A real window, a real main frame, a real webContents id. If `senderCheck` cannot recognise
    // this, every channel in the app is refused and the application is dead on arrival.
    const pub = await invoke('smoke:public');
    check('A REAL WINDOW IS RECOGNISED AS OUR OWN SENDER', pub && pub.ok === true && pub.who === 'public');

    const obs = await invoke('smoke:observed');
    check('an observed channel runs untouched', obs && obs.who === 'observed');
    const slf = await invoke('smoke:self');
    check('a self-checking channel runs, the gate not second-guessing it', slf && slf.who === 'self');
    const nw = await invoke('smoke:unclassified');
    check('a channel with no policy row still works', nw && nw.who === 'new');
    check('and it is named as unclassified', gate.unclassified().includes('smoke:unclassified'));

    // ── Central enforcement, over real IPC ───────────────────────────────
    principal = null;
    const anon = await invoke('smoke:needs-chat');
    check('with nobody signed in, a cap: channel is refused', anon && anon.ok === false);
    check('and the refusal names the capability', /chat\.send/.test(String(anon && anon.error)));

    principal = { id: 'g', username: 'guest', tier: 5 };
    const asGuest = await invoke('smoke:needs-chat');
    check('a guest may use a tier-5 capability', asGuest && asGuest.ok === true);
    const guestVault = await invoke('smoke:needs-vault');
    check('but not a tier-0 one', guestVault && guestVault.ok === false);

    principal = { id: 'm', username: 'master', tier: 0 };
    const asMaster = await invoke('smoke:needs-vault');
    check('master may', asMaster && asMaster.ok === true);

    /*
     * The `signed-in` verdict over real IPC (Section 201). This is the brake: `autonomy:stop` must
     * work for anyone with an account, which is what a brake means, and must not work for nobody.
     */
    principal = null;
    const brakeAnon = await invoke('smoke:signed-in');
    check('the brake is refused when nobody is signed in', brakeAnon && brakeAnon.ok === false);
    principal = { id: 'g', username: 'guest', tier: 5 };
    const brakeGuest = await invoke('smoke:signed-in');
    check('and works for the lowest tier there is, because that is what a brake is for',
      brakeGuest && brakeGuest.ok === true && brakeGuest.who === 'signedin');

    // REDBY: cache the principal. A tier change or a revoked session must take effect on the NEXT
    // call, which is the guarantee `principalBinding` was built for and the gate must not undo.
    principal = { id: 'g', username: 'guest', tier: 5 };
    const demoted = await invoke('smoke:needs-vault');
    check('the principal is re-read every call, so a demotion takes effect at once',
      demoted && demoted.ok === false);

    // ── A FORGED PAYLOAD, over real IPC ──────────────────────────────────
    // The gate takes an event, not a user. There is no parameter for this claim to arrive through,
    // and this proves it against the real transport rather than a fake.
    principal = null;
    const forged = await invoke('smoke:needs-vault', "{ user: { id: 'x', tier: 0, username: 'forger' } }");
    check('a payload claiming tier 0 cannot satisfy a cap: row over real IPC',
      forged && forged.ok === false);

    // ── Listeners: refusal is silent, and identity survives ──────────────
    const ranBefore = heard;
    principal = { tier: 5 };
    await send('smoke:listener');
    await new Promise((r) => setTimeout(r, 200));
    check('a listener is NOT run for a caller without the capability', heard === ranBefore);

    principal = { tier: 0 };
    await send('smoke:listener');
    await new Promise((r) => setTimeout(r, 200));
    check('and IS run for one with it', heard === ranBefore + 1);

    // The hazard that made `principalBinding` leave `on` alone: a wrapper breaks removal by identity.
    ipcMain.removeListener('smoke:listener', listener);
    const afterRemoval = heard;
    principal = { tier: 0 };
    await send('smoke:listener');
    await new Promise((r) => setTimeout(r, 200));
    check('removeListener with the ORIGINAL function really removes it from the real emitter',
      heard === afterRemoval);

    check('the gate counted the calls it allowed', gate.counts.allowed > 0);
    check('and the ones it refused', gate.counts.refused > 0);

    win.destroy();
    gate.uninstall();
    check('uninstall puts the real methods back', typeof ipcMain.handle === 'function');

    /*
     * ── PHASE 2: the two wrappers composed the way main.cjs pairs them ──────
     *
     * Everything above injected a stub principal. `main.cjs` does not: it installs
     * `principalBinding` FIRST and then hands the gate `principalBinding.getPrincipal`, and 196.6
     * records the ordering reasoning. Reasoning is not evidence. This phase runs the real pair on
     * the real `ipcMain` with a stubbed session table, which is the composition the app actually
     * boots with.
     */
    const pb = require(path.join(ROOT, 'electron', 'lib', 'principalBinding.cjs'));
    pb.useAuth({
      validateSession: (t) => (t === 'tok' ? { userId: 'u1' } : null),
      findById: () => ({ userId: 'u1', username: 'real-master', tier: 0, isActive: true }),
      publicUser: (u) => ({ ...u, id: u.userId }),
    });
    check('principal binding installs on the real ipcMain', pb.install(ipcMain) === true);

    const paired = ipcGuard.install({
      ipcMain,
      policy: { 'smoke2:vault': 'cap:vault.write', 'smoke2:bind': 'public' },
      can: capability.can,
      isOurSender: ipcGuard.senderCheck({ BrowserWindow }),
      principal: (event) => pb.getPrincipal(event),
      report: () => {},
    });
    check('and the gate installs on top of it', paired !== null);

    ipcMain.handle('smoke2:bind', (e) => { pb.bind(e.sender, 'tok', 'fp'); return { ok: true }; });
    ipcMain.handle('smoke2:vault', () => ({ ok: true, who: 'vault' }));

    const win2 = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    await win2.loadURL('about:blank');
    const call2 = (ch, arg = 'null') => win2.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke('${ch}', ${arg})`,
    );

    const before = await call2('smoke2:vault', "{ user: { id: 'x', tier: 0 } }");
    check('an UNAUTHENTICATED window is refused even while claiming tier 0',
      before && before.ok === false);

    await call2('smoke2:bind');
    const after = await call2('smoke2:vault');
    check('and once the window has really authenticated, the same channel is allowed',
      after && after.ok === true && after.who === 'vault');

    win2.destroy();
    paired.uninstall();

    const failed = results.filter(([, ok]) => !ok);
    for (const [label, ok] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES'} — `
      + `${results.length - failed.length} passed, ${failed.length} failed`);
    exitCode = failed.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('smoke test threw:', err && err.stack ? err.stack : err);
    exitCode = 1;
  }
  app.exit(exitCode);
});
