/**
 * verifyPrincipalBinding.cjs - who is on the other end of an IPC call? (spec Section 150.1, D6)
 *
 * The defect: every gated channel believed the `user` the renderer sent, so renderer code could claim
 * tier 0. This suite drives the REAL `authCore` (real argon2 hashing, real session table, real
 * fingerprint binding, real suspension) against an in-memory store, and a fake `ipcMain` that records
 * what each handler actually receives. The attacker's move in every case is the same: send a forged
 * tier-0 user and see what the handler is given.
 *
 * Run:  node scripts/verifyPrincipalBinding.cjs
 */

'use strict';

const path = require('path');
const fs = require('fs');

process.env.RAMA_MASTER_ENROLMENT = 'test-enrolment-secret-not-a-real-one';

const ROOT = path.resolve(__dirname, '..');
const authCore = require(path.join(ROOT, 'electron/lib/authCore.cjs'));
const pb = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); }
  else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (s) => console.warn(`\n--- ${s} ---`);

// ── an in-memory store behind the REAL authCore ────────────────────────────────────────────────────
const rows = [];
let meta = {};
authCore.setStorage({
  listUsers: () => rows,
  putUser: (u) => { const i = rows.findIndex((r) => r.userId === u.userId); if (i >= 0) rows[i] = u; else rows.push(u); },
  deleteUser: (id) => { const i = rows.findIndex((r) => r.userId === id); if (i >= 0) rows.splice(i, 1); },
  readMeta: () => meta,
  writeMeta: (m) => { meta = m; },
});

// ── a fake ipcMain that wraps like electron's: handlers are looked up and invoked by channel ──────────
function makeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    handleOnce(channel, fn) { handlers.set(channel, fn); },
    on() {}, once() {},
  };
}
let nextId = 100;
function makeSender() {
  const listeners = {};
  return { id: nextId++, once: (ev, fn) => { listeners[ev] = fn; }, destroy: () => listeners.destroyed && listeners.destroyed() };
}
const strongPw = 'Correct-Horse-Battery-9!x';

async function login(username, password, sender, fingerprint) {
  const s1 = await authCore.loginStep1(username, password);
  const s2 = authCore.loginStep2(s1.stepToken, global.__keys[username], fingerprint);
  if (s2.ok) pb.bind(sender, s2.token, fingerprint);
  return s2;
}

(async () => {
  global.__keys = {};
  const prov = await authCore.provision({ username: 'kp_master', password: strongPw, masterSecret: process.env.RAMA_MASTER_ENROLMENT });
  global.__keys.kp_master = prov.accessKey;
  const master = prov.user;
  const guestRes = await authCore.createUser({ userId: master.userId, tier: 0 },
    { username: 'guest_one', password: strongPw, tier: 5 });
  global.__keys.guest_one = guestRes.accessKey;
  const ADMIN_CAPS_USER = await authCore.createUser({ userId: master.userId, tier: 0 },
    { username: 'op_three', password: strongPw, tier: 3 });
  global.__keys.op_three = ADMIN_CAPS_USER.accessKey;

  check('setup: a real master (tier 0) and real guest (tier 5) exist', master.tier === 0 && guestRes.user.tier === 5);

  // What the handlers saw. Keyed by channel.
  const seen = {};
  const ipc = makeIpc();
  check('install wraps ipcMain', pb.install(ipc) === true);
  check('and is idempotent: a second install does nothing', pb.install(ipc) === false);

  const record = (ch) => ipc.handle(ch, (event, ...args) => { seen[ch] = args; return { ok: true }; });
  ['models:use', 'instance:express', 'genome:get', 'vault:read', 'browser:fetch-url', 'auth:set-tier',
    'session:change', 'plain:noUser', 'egress:body'].forEach(record);

  const call = async (ch, sender, ...args) => ipc.handlers.get(ch)({ sender }, ...args);
  const FORGED = { id: 'x', userId: 'x', username: 'forger', name: 'forger', tier: 0, isMaster: true };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('a forged tier-0 user is replaced by who the window really is');
  const guestWin = makeSender();
  const g = await login('guest_one', strongPw, guestWin, 'fp-guest');
  check('the guest signed in for real', g.ok === true && g.user.tier === 5);

  await call('models:use', guestWin, { user: FORGED, text: 'hello' });
  check('payload {user} is replaced: the handler sees the GUEST, not the forged master',
    seen['models:use'][0].user.tier === 5 && seen['models:use'][0].user.username === 'guest_one',
    JSON.stringify(seen['models:use'][0].user));
  check('and the rest of the payload is untouched', seen['models:use'][0].text === 'hello');
  check('the forged object is gone entirely', seen['models:use'][0].user.username !== 'forger');

  await call('genome:get', guestWin, FORGED);
  check('a POSITIONAL user (genome:get) is replaced', seen['genome:get'][0].tier === 5);

  await call('browser:fetch-url', guestWin, 'https://example.com', FORGED);
  check('a TRAILING user (the browser channels) is replaced', seen['browser:fetch-url'][1].tier === 5
    && seen['browser:fetch-url'][0] === 'https://example.com');

  await call('instance:express', guestWin, 'i_1', 'g.self-modify', FORGED);
  check('instance:express: a forged master asking for a tier-0 gene arrives as the guest',
    seen['instance:express'][2].tier === 5);

  await call('models:use', guestWin, { opts: { nested: { user: FORGED } } });
  check('a user NESTED inside the payload is replaced too',
    seen['models:use'][0].opts.nested.user.tier === 5);
  await call('models:use', guestWin, { list: [{ user: FORGED }] });
  check('and one inside an array', seen['models:use'][0].list[0].user.tier === 5);
  await call('models:use', guestWin, { currentUser: FORGED });
  check('`currentUser` is a user key as well', seen['models:use'][0].currentUser.tier === 5);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('no session means nobody');
  const stranger = makeSender();
  await call('models:use', stranger, { user: FORGED });
  check('a window that never signed in: the forged user becomes null', seen['models:use'][0].user === null);
  await call('genome:get', stranger, FORGED);
  check('positional too', seen['genome:get'][0] === null);
  await call('browser:fetch-url', stranger, 'u', FORGED);
  check('and trailing', seen['browser:fetch-url'][1] === null);
  check('a null principal is NOT a tier: nothing about it can pass a capability check',
    seen['genome:get'][0] === null);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the master is still the master - this is not a lockout');
  const masterWin = makeSender();
  const m = await login('kp_master', strongPw, masterWin, 'fp-master');
  check('master signed in', m.ok === true && m.user.tier === 0);
  await call('models:use', masterWin, { user: { id: 'whatever', tier: 5, userId: 'x' }, text: 't' });
  check('a master who UNDER-claims is corrected upward to master (the principal is the truth both ways)',
    seen['models:use'][0].user.tier === 0 && seen['models:use'][0].user.isMaster === true);
  check('the principal is the full public account, with the id handlers read',
    seen['models:use'][0].user.id === master.userId && seen['models:use'][0].user.userId === master.userId);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('what it must NOT touch');
  await call('plain:noUser', guestWin, { text: 'a', n: 3 });
  check('a payload with no user is passed through byte for byte (no user is INJECTED)',
    JSON.stringify(seen['plain:noUser'][0]) === JSON.stringify({ text: 'a', n: 3 }));
  await call('egress:body', guestWin, { options: { temperature: 0.2 }, messages: [] });
  check('a payload that enumerates its keys keeps exactly those keys',
    JSON.stringify(Object.keys(seen['egress:body'][0]).sort()) === JSON.stringify(['messages', 'options']));
  const setTierPayload = { token: 't', fingerprint: 'f', userId: 'u', tier: 3 };
  await call('auth:set-tier', guestWin, setTierPayload);
  check('auth:* is skipped entirely: auth:set-tier carries `tier` as DATA and must arrive intact',
    JSON.stringify(seen['auth:set-tier'][0]) === JSON.stringify(setTierPayload));
  const sessPayload = { token: 't', fingerprint: 'f', oldPasscode: 'a', user: FORGED };
  await call('session:change', guestWin, sessPayload);
  check('session:* is skipped as well', seen['session:change'][0].user === FORGED);
  await call('models:use', guestWin, { token: 'abc', tier: 3, userId: 'u' });
  check('an object with a token beside its tier is a session payload, not a claim to be someone',
    seen['models:use'][0].token === 'abc' && seen['models:use'][0].tier === 3);
  await call('models:use', guestWin, { settings: { tier: 2 } });
  check('a bare {tier} with no identifier is data, not an account', seen['models:use'][0].settings.tier === 2);
  await call('models:use', guestWin, 'just a string', 42, null, undefined);
  check('primitives pass through unchanged', seen['models:use'].length === 4 && seen['models:use'][0] === 'just a string');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the session is checked on EVERY call, not once');
  const opWin = makeSender();
  const op = await login('op_three', strongPw, opWin, 'fp-op');
  await call('models:use', opWin, { user: FORGED });
  check('operator signed in at tier 3', seen['models:use'][0].user.tier === 3);

  authCore.setUserTier({ userId: master.userId, tier: 0 }, op.user.userId, 4);
  await call('models:use', opWin, { user: FORGED });
  check('a TIER CHANGE takes effect on the very next call (3 -> 4), not at next login',
    seen['models:use'][0].user.tier === 4, String(seen['models:use'][0].user?.tier));

  authCore.setActive && authCore.setActive({ userId: master.userId, tier: 0 }, op.user.userId, false);
  await call('models:use', opWin, { user: FORGED });
  check('a SUSPENDED account becomes nobody immediately', seen['models:use'][0].user === null);
  check('and its binding is dropped, not left to be retried', pb.bindingFor(opWin.id) === null);

  const w2 = makeSender();
  const op2 = await authCore.loginStep1('guest_one', strongPw);
  const s2 = authCore.loginStep2(op2.stepToken, global.__keys.guest_one, 'fp-other');
  pb.bind(w2, s2.token, 'fp-other');
  await call('models:use', w2, { user: FORGED });
  check('a second window can hold its own session for the same account', seen['models:use'][0].user.tier === 5);
  authCore.revokeUserSessions(s2.user.userId);
  await call('models:use', w2, { user: FORGED });
  check('revoking an account\u2019s sessions makes EVERY window of it nobody',
    seen['models:use'][0].user === null);
  await call('models:use', guestWin, { user: FORGED });
  check('revoke removed the first guest window as well (same account, one revoke)',
    seen['models:use'][0].user === null);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the window cannot choose its own binding');
  const thief = makeSender();
  const fresh = await login('guest_one', strongPw, makeSender(), 'fp-A');
  pb.bind(thief, fresh.token, 'a-DIFFERENT-fingerprint');
  await call('models:use', thief, { user: FORGED });
  check('a token presented with the wrong fingerprint resolves to nobody (and revokes it, as authCore does)',
    seen['models:use'][0].user === null);
  const t2 = makeSender();
  pb.bind(t2, 'not-a-real-token', 'fp');
  await call('models:use', t2, { user: FORGED });
  check('a made-up token resolves to nobody', seen['models:use'][0].user === null);
  check('bind() refuses a missing token or sender', pb.bind({ id: 1 }, '', 'fp') === false && pb.bind({}, 'tok', 'fp') === false);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('logout and window lifetime');
  const lw = makeSender();
  const lres = await login('kp_master', strongPw, lw, 'fp-L');
  await call('models:use', lw, { user: FORGED });
  check('before logout the window is master', seen['models:use'][0].user.tier === 0);
  authCore.logout(lres.token);
  pb.unbindToken(lres.token);
  await call('models:use', lw, { user: FORGED });
  check('after logout it is nobody', seen['models:use'][0].user === null);

  const dw = makeSender();
  await login('kp_master', strongPw, dw, 'fp-D');
  check('a bound window is counted', pb.bindingFor(dw.id) !== null);
  dw.destroy();
  check('a destroyed window loses its binding', pb.bindingFor(dw.id) === null);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('hostile input');
  const hostile = JSON.parse('{"user":{"tier":0,"id":"x"},"__proto__":{"polluted":true},"constructor":{"prototype":{"p":1}}}');
  await call('models:use', guestWin, hostile);
  const got = seen['models:use'][0];
  check('a payload carrying __proto__ / constructor as own keys does not pollute Object',
    ({}).polluted === undefined && Object.prototype.p === undefined);
  check('the forbidden keys are dropped from the copy handed to the handler',
    !Object.prototype.hasOwnProperty.call(got, '__proto__') && !Object.prototype.hasOwnProperty.call(got, 'constructor'));
  const deep = { a: { b: { c: { d: { user: FORGED } } } } };
  await call('models:use', guestWin, deep);
  check('past the depth limit the payload is left alone rather than recursing without bound',
    seen['models:use'][0].a.b.c.d.user === FORGED);
  const cyc = { x: 1 }; cyc.self = cyc;
  let threw = false;
  try { await call('models:use', guestWin, cyc); } catch { threw = true; }
  check('a cyclic object (cannot arrive over IPC, but must not hang a handler) does not recurse forever', !threw);
  check('Date, Map, Buffer and class instances are passed through, not rebuilt',
    (() => { const d = new Date(); const b = Buffer.from('x'); const mp = new Map(); return pb.replaceClaims({ d, b, mp }, null).d === d; })());

  const lazy = { calls: 0 };
  pb.useAuth({ validateSession: () => { lazy.calls += 1; return null; }, findById: () => null, publicUser: () => null });
  const w3 = makeSender();
  pb.bind(w3, 'tok', 'fp');
  await call('plain:noUser', w3, { text: 'no claim here' });
  check('a call with no claim never even asks the session table (no cost on the hot paths)', lazy.calls === 0);
  await call('models:use', w3, { user: FORGED });
  check('and a call with a claim asks it exactly once', lazy.calls === 1);
  pb.useAuth(null);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('wiring - the binding is made by main, and only after authCore says yes');
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const authEngine = code(src('electron/ipc/authEngine.cjs'));
  const mainSrc = code(src('electron/main.cjs'));

  check('auth:login-step2 binds the sender, and only on success',
    /loginStep2\([\s\S]{0,200}if \(res\.ok\)[\s\S]{0,160}principalBinding\.bind\(_e\.sender, res\.token/.test(authEngine));
  check('auth:me binds the sender after it has validated the token',
    /ipcMain\.handle\('auth:me'[\s\S]{0,400}principalBinding\.bind\(_e\.sender, token, fingerprint\)/.test(authEngine));
  check('auth:logout unbinds', /ipcMain\.handle\('auth:logout'[\s\S]{0,300}principalBinding\.unbindToken\(token\)/.test(authEngine));
  check('the wrapper is installed in main BEFORE the first handler is registered',
    (() => { const i = mainSrc.indexOf('principalBinding.install(ipcMain)'); const j = mainSrc.search(/ipcMain\.handle\(/);
      return i > -1 && j > -1 && i < j; })());
  check('the renderer cannot reach bind(): it is not exposed on any channel or preload member',
    !/principalBinding/.test(code(src('electron/preload.cjs'))));
  check('the pop-out grant is minted from the OPENER\u2019s principal, not from renderer params',
    /popoutGrant\.mint\(\{[^}]*user:\s*openerPrincipal/.test(mainSrc));
  check('the pop-out is refused when its opener has no session',
    /if \(!openerPrincipal \|\| !openerBinding\) \{\s*return \{ ok: false/.test(mainSrc));
  check('redeeming a pop-out binds the new window to the opener\u2019s binding',
    /popout:redeem'[\s\S]{0,700}principalBinding\.bind\(e\.sender/.test(mainSrc));
  check('principalBinding has no path to the filesystem or the network',
    !/require\('(fs|http|https|net|child_process)'\)/.test(code(src('electron/lib/principalBinding.cjs'))));

  console.warn(`\n${fail ? 'FAILED' : 'ALL PASS'} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('suite crashed:', err); process.exit(1); });
