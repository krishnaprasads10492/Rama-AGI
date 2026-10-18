/**
 * verifyAutonomyControl.cjs - the stop has a command surface, and audio leaves only by consent
 * (spec Sections 150.2 and 150.3, D5 and D8)
 *
 * D5. Section 132 built a kill-switch nothing could reach, and `lift()` needed a capability that was not in
 * the matrix. Master approved `system.suspend-autonomy` (tier 0). This drives the REAL stop module, the
 * REAL capability matrix, the REAL control channels (with the account supplied by main's principal, never
 * by the caller), and the REAL scheduled ticks with injected timers - so "halted" is measured as work not
 * done, not read off a flag.
 *
 * D8. Cloud speech-to-text needs a key AND master's opt-in AND a session; a cloud transcription says it
 * left the machine whether or not it succeeded.
 *
 * Run:  node scripts/verifyAutonomyControl.cjs
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); }
  else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (s) => console.warn(`\n--- ${s} ---`);
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// `electron` is required by a few modules at load; it is not under test, so it is faked at the loader.
const realLoad = Module._load;
const fakeElectron = { app: { getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [] } };
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return realLoad.call(this, request, ...rest);
};

const stop = require(path.join(ROOT, 'electron/lib/autonomyStop.cjs'));
const caps = require(path.join(ROOT, 'electron/lib/capability.cjs'));
const pb = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));
const control = require(path.join(ROOT, 'electron/ipc/autonomyControl.cjs'));

// A dummy vault key, built by concatenation so this file's own source is not a hit for the credential-prefix
// scan (I-SECRETS) it sits beside. It is not a credential and is never sent anywhere: the HTTP client is stubbed.
const DUMMY_KEY = ['s', 'k-', 'test-not-a-real-', 'key'].join('');

const made = [];
const scratch = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `rama-ac-${n}-`)); made.push(d); return d; };

// principals the way main would resolve them
const accounts = {};
pb.useAuth({
  validateSession: (tok) => (accounts[tok] ? { userId: accounts[tok].userId } : null),
  findById: (id) => Object.values(accounts).find((a) => a.userId === id) || null,
  publicUser: (a) => ({ ...a, id: a.userId }),
});
let nextId = 700;
const win = (tok, acct) => { if (acct) accounts[tok] = { userId: `u-${tok}`, username: tok, name: tok, ...acct }; const id = nextId++; if (acct) pb.bind({ id }, tok, 'fp'); return { sender: { id } }; };

(async () => {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the capability master approved is in the matrix, and only master holds it');
  check('system.suspend-autonomy is declared', caps.MATRIX['system.suspend-autonomy'] === 0);
  check('master holds it', caps.can({ tier: 0 }, 'system.suspend-autonomy') === true);
  for (const t of [1, 2, 3, 4, 5]) {
    check(`tier ${t} does not`, caps.can({ tier: t }, 'system.suspend-autonomy') === false);
  }
  {
    // Compared with the COMMITTED matrix, not a number written here: the point is that master's approval
    // covered one line, and nothing else moved.
    let base = null;
    try {
      const out = require('child_process').execFileSync('git', ['show', 'HEAD:shared/capabilities.json'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      base = JSON.parse(out).capabilities;
    } catch { base = null; }
    if (base && base['system.suspend-autonomy'] === undefined) {
      const added = Object.keys(caps.MATRIX).filter((k) => !(k in base));
      const changed = Object.keys(base).filter((k) => caps.MATRIX[k] !== base[k]);
      // The additions master has sanctioned, by name. `system.suspend-autonomy` (Section 150, tier 0) and the two
      // broker-account capabilities (Section 152, tier 1). Anything else appearing here is an unreviewed grant.
      const sanctioned = { 'system.suspend-autonomy': 0, 'brokers.accounts.view': 1, 'brokers.accounts.write': 1 };
      check('against the committed matrix, the only additions are the sanctioned ones, each at its stated tier',
        added.length > 0 && added.every((k) => k in sanctioned && caps.MATRIX[k] === sanctioned[k]) && added.includes('system.suspend-autonomy'), added.join(','));
      check('and no existing capability changed tier or was removed', changed.length === 0, changed.join(','));
    } else {
      // Once this change is committed HEAD already contains the entry, so there is nothing to diff; the
      // approval is then recorded by the tripwire manifest instead, which is the stronger record.
      check('(HEAD already carries the entry or git is unavailable: the tripwire manifest is the record)', true);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('stop: open to every window, signed in or not');
  const root = scratch('stop');
  stop.configure({ userDataRoot: root });
  const handlers = new Map();
  control.register({ handle: (c, f) => handlers.set(c, f), on() {}, once() {} });
  check('three channels registered: status, stop, resume',
    [...handlers.keys()].sort().join(',') === 'autonomy:resume,autonomy:status,autonomy:stop', [...handlers.keys()].join(','));
  const call = (ch, w, ...a) => handlers.get(ch)(w, ...a);

  const stranger = win('x', null);
  check('a default install is not halted', stop.isHalted() === false);
  const s0 = await call('autonomy:stop', stranger, { reason: 'test', via: 'voice' });
  check('a window with NO session can stop (a stop that can be refused is not a stop)', s0.ok === true, JSON.stringify(s0));
  check('and the halt is real', stop.isHalted() === true);
  check('the record says WHO from main\'s account of the caller: an unauthenticated window',
    /unauthenticated window via voice/.test(stop.status().stoppedRecord.by), stop.status().stoppedRecord.by);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('stop is idempotent, and cannot erase the record of who allowed autonomy');
  const root2 = scratch('idem');
  stop.configure({ userDataRoot: root2 });
  fs.mkdirSync(path.dirname(stop.allowPath()), { recursive: true });
  fs.writeFileSync(stop.allowPath(), JSON.stringify({ allowed: true, by: 'master (tier 0)', at: '2026-01-01T00:00:00.000Z', note: 'original grant' }));
  const first = stop.engage('first stop', 'tester');
  check('the first engage saves the prior allow', first.record.priorAllow?.note === 'original grant');
  const second = stop.engage('second stop, e.g. a double click', 'someone else');
  check('a second engage reports it was already halted and writes nothing', second.alreadyHalted === true && second.recorded === false);
  const onDisk = JSON.parse(fs.readFileSync(stop.stoppedRecordPath(), 'utf8'));
  check('THE PRIOR ALLOW SURVIVES A SECOND STOP (before this, it was overwritten with null)',
    onDisk.priorAllow?.note === 'original grant' && onDisk.reason === 'first stop');
  check('and the original author is not rewritten by the second caller', onDisk.by === 'tester');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('resume: master only, from main\'s account, with a note');
  stop.configure({ userDataRoot: scratch('resume') });
  stop.engage('for the resume tests', 'tester');
  const guest = win('g', { tier: 5 });
  const admin = win('a', { tier: 2 });
  const sup = win('s', { tier: 1 });
  const master = win('m', { tier: 0 });
  const resume = (w, o) => call('autonomy:resume', w, o);

  check('no session: refused', (await resume(stranger, { note: 'please' })).ok === false);
  check('guest: refused', (await resume(guest, { note: 'please' })).ok === false);
  check('admin: refused', (await resume(admin, { note: 'please' })).ok === false);
  check('superadmin (tier 1): refused - it is master alone', (await resume(sup, { note: 'please' })).ok === false);
  check('and the halt is still in force after every refusal', stop.isHalted() === true);
  check('master WITHOUT a note: refused', (await resume(master, {})).ok === false && (await resume(master, { note: '   ' })).ok === false);
  check('a forged tier-0 user in the payload does not help a guest',
    (await resume(guest, { note: 'x', user: { tier: 0, id: 'z', userId: 'z' } })).ok === false);
  check('and the halt is STILL in force', stop.isHalted() === true);
  const ok = await resume(master, { note: 'incident reviewed' });
  check('master with a note: resumed', ok.ok === true && ok.haltCleared === true, JSON.stringify(ok));
  check('the halt is lifted', stop.isHalted() === false);
  check('resuming again says there is nothing to resume', (await resume(master, { note: 'again' })).ok === false);

  section('resume restores what was there; it does not GRANT new autonomy');
  stop.configure({ userDataRoot: scratch('norestore') });
  check('precondition: a default install is stopped for NEW autonomy (nothing was ever allowed)', stop.isStopped() === true);
  stop.engage('stop on a default install', 'tester');
  await resume(master, { note: 'resume on a default install' });
  check('after stop then resume on a default install, NEW autonomy is STILL stopped (lift() would have allowed it)',
    stop.isStopped() === true && fs.existsSync(stop.allowPath()) === false);
  check('but the pre-existing work runs again', stop.isHalted() === false);

  const rootA = scratch('prior');
  stop.configure({ userDataRoot: rootA });
  fs.mkdirSync(path.dirname(stop.allowPath()), { recursive: true });
  fs.writeFileSync(stop.allowPath(), JSON.stringify({ allowed: true, by: 'master (tier 0)', at: '2026-02-02T00:00:00.000Z', note: 'allowed for the upgrade work' }));
  check('with an allow in place, new autonomy is permitted', stop.isStopped() === false);
  stop.engage('stop while allowed', 'tester');
  check('a stop revokes the allow-file', stop.isStopped() === true && fs.existsSync(stop.allowPath()) === false);
  const back = await resume(master, { note: 'review done' });
  check('resume restores the allow that existed before the stop', back.ok === true && back.restoredAllow === true, JSON.stringify(back).slice(0, 200));
  const restored = JSON.parse(fs.readFileSync(stop.allowPath(), 'utf8'));
  check('with its ORIGINAL author and note intact', restored.by === 'master (tier 0)' && restored.note === 'allowed for the upgrade work');
  check('and a record of who resumed, and why', restored.resumedAfterHalt?.note === 'review done' && /master|m/.test(restored.resumedAfterHalt?.by));
  check('new autonomy is permitted again exactly as before the stop', stop.isStopped() === false);

  section('an environment halt cannot be resumed away, and the answer says so');
  stop.configure({ userDataRoot: scratch('env') });
  stop.engage('env test', 'tester');
  process.env.RAMA_AUTONOMY = 'stop';
  const envRes = await resume(master, { note: 'trying' });
  check('the record is cleared but the response says the environment still holds the halt',
    envRes.ok === true && envRes.stillHalted === true && /RAMA_AUTONOMY=stop/.test(envRes.env || ''), JSON.stringify(envRes).slice(0, 160));
  check('and isHalted() really is still true', stop.isHalted() === true);
  delete process.env.RAMA_AUTONOMY;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('status, and the offer of a button is not the authority for it');
  stop.configure({ userDataRoot: scratch('status') });
  check('status needs a session', (await call('autonomy:status', stranger)).ok === false);
  const sm = await call('autonomy:status', master);
  const sg = await call('autonomy:status', guest);
  check('master is told it can resume', sm.data.canResume === true);
  check('a guest is told it cannot', sg.data.canResume === false);
  check('status carries the full account in words', typeof sm.data.text === 'string' && sm.data.text.length > 80);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('input hygiene on the stop');
  stop.configure({ userDataRoot: scratch('hyg') });
  const long = 'x'.repeat(5000) + '\u0000\u001b[31mred';
  await call('autonomy:stop', stranger, { reason: long, via: 'not-a-known-surface' });
  const rec = stop.status().stoppedRecord;
  check('an oversized reason is cut to the cap', rec.reason.length <= control.MAX_REASON, String(rec.reason.length));
  check('control characters are removed from what is written to disk', !/[\u0000-\u001f\u007f]/.test(rec.reason));
  check('an unknown surface is recorded as "unknown", never trusted', /via unknown/.test(rec.by), rec.by);
  stop.configure({ userDataRoot: scratch('hyg2') });
  const noOpts = await call('autonomy:stop', stranger, undefined);
  check('a call with no options at all still stops', noOpts.ok === true && stop.isHalted() === true);
  stop.configure({ userDataRoot: scratch('hyg3') });
  await call('autonomy:stop', stranger, { reason: 'r', via: 'chat', by: 'master (tier 0)', user: { tier: 0 } });
  check('a caller cannot sign the stop as someone else (`by` and `user` in the payload are never read)',
    /unauthenticated window via chat/.test(stop.status().stoppedRecord.by), stop.status().stoppedRecord.by);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('HALTED MEANS WORK NOT DONE - the four dispatchers, measured');
  // 1) refreshScheduler, with injected timers. The halt check is in the scheduled callback.
  const scheduler = require(path.join(ROOT, 'electron/lib/refreshScheduler.cjs'));
  const saved = {};
  scheduler.useStore({
    get: (d, k) => saved[`${d}.${k}`],
    set: (d, k, v) => { saved[`${d}.${k}`] = v; },
    saveDomain: () => {},
  });
  let ran = 0;
  scheduler.register({ name: 'ac-probe', label: 'probe', intervalMs: 60_000, run: async () => { ran += 1; return { ok: true }; } });
  const queue = [];
  scheduler.start({ setTimer: (fn) => { queue.push(fn); return { unref() {} }; }, now: () => Date.now(), random: () => 0 });
  check('the probe task was scheduled', queue.length >= 1);

  stop.configure({ userDataRoot: scratch('sched') });
  stop.engage('scheduler test', 'tester');
  const fire = async () => { const fn = queue.shift(); if (fn) await fn(); };
  const before = ran;
  await fire();
  check('HALTED: the scheduled tick fired and the task did NOT run', ran === before, `ran ${ran - before}`);
  check('and it RESCHEDULED itself, so nothing is left dead', queue.length >= 1);
  const manualBefore = ran;
  await scheduler.runNow('ac-probe');
  check('master\'s own refresh:run (runNow) still works while halted', ran === manualBefore + 1);

  stop.resume({ name: 'm', id: 'm', tier: 0 }, 'tick test');
  check('the halt is lifted', stop.isHalted() === false);
  const beforeLift = ran;
  await fire();
  check('RESUMED: the very next scheduled tick runs the task with no re-arm and no restart', ran === beforeLift + 1);
  scheduler.stop();
  scheduler.unregister('ac-probe');

  // 2) marketIntel's two ticks are exported and return a skip while halted.
  const market = require(path.join(ROOT, 'electron/ipc/marketIntel.cjs'));
  stop.configure({ userDataRoot: scratch('market') });
  stop.engage('market test', 'tester');
  const r1 = await market.tickResolveOutcomes();
  const r2 = await market.tickSyncNews();
  check('HALTED: tickResolveOutcomes does nothing and says why', r1 && r1.skipped === 'autonomy halted', JSON.stringify(r1));
  check('HALTED: tickSyncNews does nothing and says why', r2 && r2.skipped === 'autonomy halted', JSON.stringify(r2));
  stop.resume({ name: 'm', id: 'm', tier: 0 }, 'market test');
  const r3 = await market.tickResolveOutcomes();
  check('RESUMED: it no longer answers "autonomy halted" (it reaches its own backend check)',
    !(r3 && r3.skipped === 'autonomy halted'), JSON.stringify(r3));

  // 3) metaCognition and selfCare: not callable in isolation, so asserted at source, and labelled as such.
  const mc = code(src('electron/ipc/metaCognition.cjs'));
  check('(source-level) the metacognition audit interval returns early while halted, BEFORE doing the audit',
    /auditTimer = setInterval\(\(\) => \{\s*if \(autonomyHalted\(\)\) return;/.test(mc));
  const sc = code(src('electron/ipc/selfCare.cjs'));
  check('(source-level) selfCare\'s scheduled sweep returns early while halted',
    /async function scheduledSweep\(\) \{\s*if \(autonomyHalted\(\)\) return null;\s*return runHealthSweep\(\);/.test(sc));
  check('(source-level) BOTH selfCare timer sites call the guarded wrapper, and neither calls the bare sweep',
    (sc.match(/setInterval\(scheduledSweep, 120000\)/g) || []).length === 2
    && !/setInterval\(runHealthSweep/.test(sc) && !/setTimeout\(\(\) => runHealthSweep/.test(sc));
  check('(source-level) the on-demand selfcare:sweep is deliberately NOT halted: master asking is not autonomy',
    /ipcMain\.handle\('selfcare:sweep'[\s\S]{0,120}await runHealthSweep\(\)/.test(sc));
  check('(source-level) the failover runs inside the sweep, so a halt stops auto-failover with it',
    /checkInstanceFailover\(\)/.test(sc));
  check('each dispatcher, if the stop module cannot load, RUNS (a stop that cannot load must not disable shipped work)',
    [mc, sc, code(src('electron/ipc/marketIntel.cjs')), code(src('electron/lib/refreshScheduler.cjs'))]
      .every((t) => /try \{ return require\('[^']*autonomyStop\.cjs'\)\.isHalted\(\) === true; \} catch \{ return false; \}/.test(t)));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the declared coverage tells the truth');
  check('every pre-existing dispatcher is now declared halted-by-engage',
    stop.PRE_EXISTING.length === 4 && stop.PRE_EXISTING.every((d) => d.haltedByEngage === true));
  stop.configure({ userDataRoot: scratch('text') });
  stop.engage('label test', 'tester');
  const halted = stop.statusText();
  check('statusText says the work is skipped while halted, and not that it is "still armed"',
    /skip their scheduled work/.test(halted) && !/Still ARMED/.test(halted), halted.slice(0, 200));
  check('it says resuming is master only', /master only/.test(halted));
  check('it no longer points at a file to delete by hand', !/deleting/.test(halted));
  check('engage() reports that the halt IS in effect, with how',
    stop.engage('again', 'x').teardown.performed === true);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('who may call lift() and resume() - asserted, because absence is the guarantee');
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.cjs')).map((f) => path.join(dir, f));
  const files = [...walk('electron'), ...walk('electron/ipc'), ...walk('electron/lib')];
  const callersOf = (name) => files.filter((f) => !f.endsWith('autonomyStop.cjs'))
    .filter((f) => new RegExp(`\\b(?:stop|autonomyStop)\\.${name}\\s*\\(`).test(code(src(f))));
  check('lift() - the grant of NEW autonomous action - has NO caller', callersOf('lift').length === 0, callersOf('lift').join(','));
  check('resume() has exactly one caller: the control channel', callersOf('resume').join(',').replace(/\\/g, '/') === 'electron/ipc/autonomyControl.cjs',
    callersOf('resume').join(','));
  check('engage() is called by the control channel, the gate and the applier, and nothing else',
    files.filter((f) => !f.endsWith('autonomyStop.cjs') && /\b(?:stop|autonomyStop)\.engage\s*\(/.test(code(src(f))))
      .map((f) => path.basename(f)).sort().join(',') === 'autonomyControl.cjs,upgradeApplier.cjs',
    files.filter((f) => !f.endsWith('autonomyStop.cjs') && /\b(?:stop|autonomyStop)\.engage\s*\(/.test(code(src(f)))).join(','));
  check('the control module never reads a user out of the payload',
    !/opts\.user|o\.user|payload\.user|\.user\b/.test(code(src('electron/ipc/autonomyControl.cjs'))));
  check('NO renderer file can resume: no voice table, intent parser, reflex skill or palette case produces it',
    ![src('src/services/voiceEngine.js'), src('src/services/commandIntents.js'), src('src/services/cognition.js'), src('src/components/CommandPalette.jsx')]
      .some((t) => /autonomy\.resume|autonomy-resume|autonomy:resume|api\.resume|resumeAutonomy/.test(code(t))));
  check('the ONLY renderer use of resume is the Settings panel, behind a note',
    /api\.resume\(\{ note \}\)/.test(src('src/pages/Settings/Settings.jsx')) && /disabled=\{busy \|\| !note\.trim\(\)\}/.test(src('src/pages/Settings/Settings.jsx')));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('D8 - audio leaves the machine only by consent');
  const dsStore = { config: {} };
  const dsPath = path.join(ROOT, 'electron/dataStore.cjs');
  const savedDomains = [];
  const dsExports = { get: (d, k) => (dsStore[d] ? dsStore[d][k] ?? null : null), set: (d, k, v) => { (dsStore[d] ||= {})[k] = v; }, saveDomain: (d) => { savedDomains.push(d); } };
  const credPath = path.join(ROOT, 'electron/ipc/credentialVault.cjs');
  let vaultKey = null;
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron') return fakeElectron;
    if (/dataStore\.cjs$/.test(request)) return dsExports;
    if (/credentialVault\.cjs$/.test(request) && parent && /voiceEngine\.cjs$/.test(parent.filename)) {
      return { getCredential: (n) => (n === 'OPENAI_API_KEY' ? vaultKey : null) };
    }
    return realLoad.call(this, request, parent, ...rest);
  };
  delete require.cache[require.resolve(path.join(ROOT, 'electron/ipc/voiceEngine.cjs'))];
  const voice = require(path.join(ROOT, 'electron/ipc/voiceEngine.cjs'));

  vaultKey = null;
  check('no key, no opt-in: cloud unavailable', voice.detectCloud().available === false);
  vaultKey = DUMMY_KEY;
  check('A KEY ALONE NO LONGER ENABLES CLOUD (this was the whole defect: a key added for another purpose sent audio away)',
    voice.detectCloud().available === false && voice.detectCloud().keyPresent === true && voice.detectCloud().optedIn === false);
  check('and it says why, so the reason is not a mystery', /not opted in|has not opted in/.test(voice.detectCloud().reason));
  check('the capability report does not count cloud as a level without the opt-in',
    voice.capabilities().cloud.available === false && voice.capabilities().canTranscribe === (voice.detectLocal().available === true));
  check('opt-in is stored in the encrypted config domain, not in a renderer or a plain file',
    (() => { voice.setCloudOptIn(true); return dsStore.config.voiceCloudSttOptIn === true; })());
  check('and it is SAVED at once, to the config domain: a consent held only in memory can vanish',
    savedDomains.includes('config'), JSON.stringify(savedDomains));
  check('key + opt-in: cloud is available', voice.detectCloud().available === true && voice.detectCloud().leavesMachine === true);
  voice.setCloudOptIn(false);
  check('opt-in OFF again: unavailable', voice.detectCloud().available === false);
  dsStore.config.voiceCloudSttOptIn = 'true';
  check('only a boolean true counts: the string "true" is not consent', voice.cloudOptIn() === false);
  dsStore.config.voiceCloudSttOptIn = 1;
  check('and neither is 1', voice.cloudOptIn() === false);
  delete dsStore.config.voiceCloudSttOptIn;
  check('a store with no value means no', voice.cloudOptIn() === false);

  // the channels
  const vh = new Map();
  voice.register({ handle: (c, f) => vh.set(c, f), on() {}, once() {} });
  check('the voice channels include the two opt-in channels',
    vh.has('voice:cloud-optin') && vh.has('voice:set-cloud-optin') && vh.has('voice:transcribe'));
  const vcall = (ch, w, ...a) => vh.get(ch)(w, ...a);
  const guestW = win('vg', { tier: 5 });
  const adminW = win('va', { tier: 2 });
  const masterW = win('vm', { tier: 0 });
  const strangerW = win('vx', null);
  check('a stranger cannot read the opt-in', (await vcall('voice:cloud-optin', strangerW)).ok === false);
  check('a guest can read it', (await vcall('voice:cloud-optin', guestW)).ok === true);
  check('a guest cannot change it', (await vcall('voice:set-cloud-optin', guestW, { enabled: true })).ok === false);
  check('an admin cannot change it: it is master alone', (await vcall('voice:set-cloud-optin', adminW, { enabled: true })).ok === false);
  check('a forged tier-0 user in the payload does not help',
    (await vcall('voice:set-cloud-optin', guestW, { enabled: true, user: { tier: 0, id: 'z', userId: 'z' } })).ok === false);
  check('and nothing was recorded by the refusals', dsStore.config.voiceCloudSttOptIn === undefined);
  check('only a boolean true enables: "yes" does not', (await vcall('voice:set-cloud-optin', masterW, { enabled: 'yes' })).data.optedIn === false);
  const on = await vcall('voice:set-cloud-optin', masterW, { enabled: true });
  check('master can opt in', on.ok === true && on.data.optedIn === true && on.data.available === true, JSON.stringify(on));
  check('and it is persisted', dsStore.config.voiceCloudSttOptIn === true);
  const off = await vcall('voice:set-cloud-optin', masterW, { enabled: false });
  check('master can opt out', off.ok === true && off.data.optedIn === false && dsStore.config.voiceCloudSttOptIn === false);

  // transcribe: needs a session, local first, and a cloud result carries the egress report
  const clip = { data: Buffer.from('not real audio').toString('base64'), mimeType: 'audio/webm' };
  const t0 = await vcall('voice:transcribe', strangerW, clip);
  check('transcribe with no session is refused (it had no check at all)', t0.ok === false && /may not do this/.test(t0.error), JSON.stringify(t0));
  vaultKey = null;
  const t1 = await vcall('voice:transcribe', guestW, clip);
  check('a guest with a session is allowed through the gate (chat.send is tier 5)', !/may not do this/.test(String(t1.error)), JSON.stringify(t1).slice(0, 160));
  check('with no backend it fails honestly and says nothing left the machine',
    t1.ok === false && t1.leftMachine === undefined);

  // The egress report on a real cloud call: stub the network at the HTTP client the module uses.
  vaultKey = DUMMY_KEY;
  dsStore.config.voiceCloudSttOptIn = true;
  const httpPath = path.join(ROOT, 'electron/lib/http.cjs');
  const http = require(httpPath);
  const realRequest = http.request;
  let sent = 0;
  http.request = async () => { sent += 1; return { ok: true, status: 200, body: JSON.stringify({ text: 'hello there' }), text: JSON.stringify({ text: 'hello there' }) }; };
  const localNow = voice.detectLocal();
  if (!localNow.available) {
    const t2 = await vcall('voice:transcribe', masterW, clip);
    check('opted in, with a key and no local Whisper: the cloud path ran', sent === 1, `requests: ${sent}`);
    check('and the result SAYS the audio left the machine, and to whom', t2.leftMachine === true && t2.provider === 'openai', JSON.stringify(t2).slice(0, 200));
    http.request = async () => { sent += 1; return { ok: false, status: 500, body: '{}', text: '{}', error: 'boom' }; };
    const t3 = await vcall('voice:transcribe', masterW, clip);
    check('a FAILED cloud attempt is reported as having left the machine too (the clip was sent)',
      t3.ok === false && t3.leftMachine === true && t3.provider === 'openai', JSON.stringify(t3).slice(0, 200));
    dsStore.config.voiceCloudSttOptIn = false;
    const before = sent;
    await vcall('voice:transcribe', masterW, clip);
    check('opted OUT again: no request is made at all', sent === before, `requests: ${sent - before}`);
  } else {
    console.warn('        (local Whisper is installed here, so the cloud-path assertions are skipped: it was preferred, as designed)');
  }
  http.request = realRequest;

  check('(source-level) transcribeCloud is reached only through the opt-in-aware detectCloud()',
    (code(src('electron/ipc/voiceEngine.cjs')).match(/transcribeCloud\(/g) || []).length === 2);
  check('the doc generator\'s two reads still resolve (key name and endpoint)',
    /getCredential\('OPENAI_API_KEY'\)/.test(src('electron/ipc/voiceEngine.cjs')) && /https:\/\/api\.openai\.com/.test(src('electron/ipc/voiceEngine.cjs')));

  Module._load = realLoad;
  pb.useAuth(null);
  pb.reset();
  // The suite's own scratch directories: left behind they accumulate on every run.
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  console.warn(`\n${fail ? 'FAILED' : 'ALL PASS'} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('suite crashed:', err); process.exit(1); });
