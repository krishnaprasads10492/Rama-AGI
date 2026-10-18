'use strict';

/**
 * verifyBrokerAccounts.cjs - several broker API accounts, their IPs, and who may see them (spec Section 152)
 *
 * This is the part of Rāma nearest to money, and the failure that matters is a leak: a secret returned to a
 * window, or the registry shown to an account that should not know it exists. So this drives the REAL handlers
 * with the principal supplied the way main supplies it, and then searches every reply for the secret.
 *
 *   - IP rules: public addresses only, canonical form, IPv4-mapped IPv6 judged as the IPv4 it wraps
 *   - the weekly lock, the cross-distributable rule, the family declaration
 *   - SECRETS: never in any reply, in any state, for any caller, including after edit and failure
 *   - the gate: anonymous, guest, viewer, operator, admin refused with NOTHING else; SuperAdmin and Master pass
 *   - the caller's claimed `user` is ignored; only the validated principal counts
 *   - the generic store:* channels can no longer reach this domain (or `users`)
 *   - the IP-echo detector refuses private/unsafe endpoints and private answers
 *   - preload parity, and nothing that can place an order
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);

const ba = require(path.join(ROOT, 'electron/lib/brokerAccounts.cjs'));
const egress = require(path.join(ROOT, 'electron/lib/egressIp.cjs'));
const principalBinding = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));
const ipc = require(path.join(ROOT, 'electron/ipc/brokerAccounts.cjs'));

const SECRET = 'S3CRETvalue0123456789abcdefXYZ';        // 30 chars
const SECRET2 = 'ANOTHERsecret0123456789abcdefQ';
const KEY = 'abcd1234efgh5678';

const memStore = () => {
  const d = {};
  return { get: (dom, k) => (d[dom] && d[dom][k] !== undefined ? d[dom][k] : null), set: (dom, k, v) => { d[dom] = d[dom] || {}; d[dom][k] = JSON.parse(JSON.stringify(v)); }, raw: d };
};
const SELF = { id: 'inst-self-0001', label: 'Master PC' };
const ctx = (now) => ({ self: SELF, brokerIds: ['kite', 'dhan', 'upstox'], now });
const base = (o = {}) => ({ label: 'Main', brokerId: 'kite', clientId: 'AB1234', apiKey: KEY, secret: SECRET, primaryIp: '103.21.58.10', ...o });
const leaks = (v, s = SECRET) => JSON.stringify(v).includes(s) || JSON.stringify(v).includes(s.slice(0, 12)) || JSON.stringify(v).includes(s.slice(-8));

(async () => {
  console.warn('\nbroker accounts - the registry, its IP rules, and who may see it\n');

  // ═══ IP rules ═══════════════════════════════════════════════════════════════════════════════════
  section('an IP must be one Zerodha can reach');
  const c = ba.classifyIp;
  check('a public IPv4 is accepted as itself', c('103.21.58.10').ok && c('103.21.58.10').ip === '103.21.58.10');
  check('surrounding whitespace and control characters are removed', c('  8.8.8.8 \n').ip === '8.8.8.8');
  for (const bad of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.5', '198.51.100.9', '203.0.113.7', '240.0.0.1', '192.0.0.8']) {
    check(`${bad} is refused (not public)`, c(bad).ok === false, JSON.stringify(c(bad)));
  }
  check('172.32.0.1 is just outside the private block and is accepted', c('172.32.0.1').ok === true);
  check('100.63.255.255 is just outside carrier-grade NAT and is accepted', c('100.63.255.255').ok === true);
  for (const bad of ['', '   ', '8.8.8', '8.8.8.8.8', '256.1.1.1', '01.2.3.4', '1.2.3.4/32', '8.8.8.8; rm -rf', 'localhost', '1e3.1.1.1', '8.8.8.8:80', 'a'.repeat(60), '0x8.8.8.8']) {
    check(`${JSON.stringify(bad).slice(0, 24)} is refused`, c(bad).ok === false);
  }
  check('a public IPv6 is accepted in canonical form', c('2606:4700:4700::1111').ok && c('2606:4700:4700::1111').ip === '2606:4700:4700:0:0:0:0:1111');
  check('two spellings of one IPv6 address compare equal', c('2606:4700:4700::1111').ip === c('2606:4700:4700:0000:0000:0000:0000:1111').ip);
  for (const bad of ['::', '::1', 'fe80::1', 'fd00::1', 'fc12::1', 'ff02::1', '2001:db8::1', 'fe80::1%eth0', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '2606:4700::zz', ':::']) {
    check(`${bad} is refused`, c(bad).ok === false, JSON.stringify(c(bad)));
  }
  check('an IPv4-mapped public address is judged as the IPv4 it wraps', c('::ffff:8.8.8.8').ok && c('::ffff:8.8.8.8').ip === '8.8.8.8' && c('::ffff:8.8.8.8').version === 4);

  section('the IP pair on one account');
  check('primary only is fine', ba.normaliseIps('8.8.8.8', '').ok);
  check('primary and secondary are fine', ba.normaliseIps('8.8.8.8', '1.1.1.1').ok);
  check('a secondary without a primary is refused (Zerodha requires the primary)', ba.normaliseIps('', '1.1.1.1').ok === false);
  check('the same address twice is refused', ba.normaliseIps('8.8.8.8', '8.8.8.8').ok === false);
  check('the same address in two spellings is refused', ba.normaliseIps('::ffff:8.8.8.8', '8.8.8.8').ok === false);
  check('neither IP is allowed (nothing registered yet)', ba.normaliseIps('', '').ok === true);
  check('both errors are reported at once', ba.normaliseIps('10.0.0.1', '192.168.0.1').errors.length === 2);

  // ═══ the weekly lock ════════════════════════════════════════════════════════════════════════════
  section('Zerodha allows one change a week');
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const day = 24 * 3600 * 1000;
  const prev = { primaryIp: '8.8.8.8', secondaryIp: null, ipChangedAt: new Date(t0).toISOString() };
  check('the first time IPs are set there is nothing to lock', ba.checkIpChange({}, { primaryIp: '8.8.8.8' }, t0).ok);
  check('an unchanged set is never blocked', ba.checkIpChange(prev, { primaryIp: '8.8.8.8' }, t0 + day).ok && ba.checkIpChange(prev, { primaryIp: '8.8.8.8' }, t0 + day).unchanged);
  const blocked = ba.checkIpChange(prev, { primaryIp: '1.1.1.1' }, t0 + 3 * day);
  check('a change two days later is refused and says when it clears', blocked.ok === false && blocked.clearsOn === '2026-10-08' && /2026-10-08/.test(blocked.error));
  check('the refusal asks for acknowledgement rather than being final', blocked.needsAcknowledgement === true);
  check('acknowledging records it anyway', ba.checkIpChange(prev, { primaryIp: '1.1.1.1' }, t0 + 3 * day, true).ok);
  check('exactly seven days later it is allowed', ba.checkIpChange(prev, { primaryIp: '1.1.1.1' }, t0 + 7 * day).ok);
  check('six days and 23 hours is still blocked', ba.checkIpChange(prev, { primaryIp: '1.1.1.1' }, t0 + 7 * day - 3600 * 1000).ok === false);
  check('swapping primary and secondary is the same SET, so not a change', ba.checkIpChange({ primaryIp: '8.8.8.8', secondaryIp: '1.1.1.1', ipChangedAt: prev.ipChangedAt }, { primaryIp: '1.1.1.1', secondaryIp: '8.8.8.8' }, t0 + day).unchanged === true);
  check('removing an IP counts as a change', ba.checkIpChange({ primaryIp: '8.8.8.8', secondaryIp: '1.1.1.1', ipChangedAt: prev.ipChangedAt }, { primaryIp: '8.8.8.8' }, t0 + day).ok === false);
  check('an unparseable last-change date does not lock forever', ba.checkIpChange({ primaryIp: '8.8.8.8', ipChangedAt: 'garbage' }, { primaryIp: '1.1.1.1' }, t0).ok);

  // ═══ persistence, conflicts ═════════════════════════════════════════════════════════════════════
  section('saving, the distributable rule, and the family declaration');
  let st = memStore();
  const now = t0;
  const r1 = ba.saveAccount(st, base(), ctx(now));
  check('a valid account saves', r1.ok === true && r1.created === true, JSON.stringify(r1));
  check('it lands on THIS installation by default', r1.account.distributableId === SELF.id);
  check('the reply carries no secret', !leaks(r1));
  check('the stored record holds the secret (encrypted at rest by the store)', JSON.stringify(st.raw).includes(SECRET));
  check('the key is masked in the view', r1.account.apiKeyMasked.startsWith('abcd') && !r1.account.apiKeyMasked.includes('efgh5678'));
  check('hasSecret is true and nothing else about the secret is', r1.account.hasSecret === true && !('secret' in r1.account));
  check('the first IP set stamps the change time', Date.parse(r1.account.ipChangedAt) === now);

  check('a missing label is refused', ba.saveAccount(memStore(), base({ label: '' }), ctx(now)).ok === false);
  check('a missing key is refused for a new account', ba.saveAccount(memStore(), base({ apiKey: '' }), ctx(now)).ok === false);
  check('a missing secret is refused for a new account', ba.saveAccount(memStore(), base({ secret: '' }), ctx(now)).ok === false);
  check('a short secret is refused and the reply does not echo it', (() => { const r = ba.saveAccount(memStore(), base({ secret: 'short' }), ctx(now)); return r.ok === false && !JSON.stringify(r).includes('short"'); })());
  check('a secret with a space is refused', ba.saveAccount(memStore(), base({ secret: 'has a space in the middle of it' }), ctx(now)).ok === false);
  check('an unknown broker is refused', ba.saveAccount(memStore(), base({ brokerId: 'nope' }), ctx(now)).ok === false);
  check('a private IP is refused at save', ba.saveAccount(memStore(), base({ primaryIp: '192.168.1.9' }), ctx(now)).ok === false);
  check('an unknown distributable is refused', ba.saveAccount(memStore(), base({ distributableId: 'dist_nope' }), ctx(now)).ok === false);
  check('a hostile label is stripped of control characters and clipped', (() => { const r = ba.saveAccount(memStore(), base({ label: 'a\u0000b' + 'x'.repeat(100) }), ctx(now)); return r.ok && r.account.label.length <= 60 && !/\u0000/.test(r.account.label); })());

  // update semantics
  const id = r1.account.id;
  const up = ba.saveAccount(st, { id, label: 'Main renamed', apiKey: '', secret: '', primaryIp: '103.21.58.10' }, ctx(now + day));
  check('an update with a blank key and secret keeps both', up.ok && ba.secretFor(st, id) === SECRET && st.raw.brokerAccounts.accounts[0].apiKey === KEY, JSON.stringify(up));
  check('and keeps the change time, since the IPs did not change', Date.parse(up.account.ipChangedAt) === now);
  const rot = ba.saveAccount(st, { id, label: 'Main renamed', secret: SECRET2, primaryIp: '103.21.58.10' }, ctx(now + day));
  check('a new secret replaces the old one', rot.ok && ba.secretFor(st, id) === SECRET2 && !JSON.stringify(st.raw).includes(SECRET));
  check('no reply during rotation contains either secret', !leaks(rot) && !leaks(rot, SECRET2));
  const chg = ba.saveAccount(st, { id, label: 'Main renamed', primaryIp: '1.1.1.1' }, ctx(now + 2 * day));
  check('changing the IP inside the week is refused', chg.ok === false && chg.needsAcknowledgement === true);
  check('and the stored IP is untouched by the refusal', st.raw.brokerAccounts.accounts[0].primaryIp === '103.21.58.10');
  check('acknowledged, it is recorded and re-stamped', (() => { const r = ba.saveAccount(st, { id, label: 'Main renamed', primaryIp: '1.1.1.1', acknowledgeWeeklyLimit: true }, ctx(now + 2 * day)); return r.ok && r.account.primaryIp === '1.1.1.1' && Date.parse(r.account.ipChangedAt) === now + 2 * day; })());
  check('updating an account that does not exist is refused', ba.saveAccount(st, { id: 'ba_gone', label: 'x', apiKey: KEY, secret: SECRET }, ctx(now)).ok === false);

  // distributables and the IP-per-distributable rule
  st = memStore();
  ba.saveAccount(st, base(), ctx(now));
  const d1 = ba.saveDistributable(st, { label: "Ravi's laptop" }, ctx(now));
  check('a distributable can be added', d1.ok === true);
  check('its label must be unique', ba.saveDistributable(st, { label: "ravi's LAPTOP" }, ctx(now)).ok === false);
  check('the installation itself cannot be edited as a distributable', ba.saveDistributable(st, { id: SELF.id, label: 'x' }, ctx(now)).ok === false);
  const dup = ba.saveAccount(st, base({ label: 'Ravi', distributableId: d1.id, secret: SECRET2 }), ctx(now));
  check('the SAME IP on another distributable is refused, with the reason', dup.ok === false && /own IP/.test(dup.error) && /immediate family/.test(dup.error), JSON.stringify(dup));
  check('a different IP on it is accepted', ba.saveAccount(st, base({ label: 'Ravi', distributableId: d1.id, secret: SECRET2, primaryIp: '1.1.1.1' }), ctx(now)).ok === true);
  check('sharing is allowed only when BOTH sides declare it',
    ba.saveAccount(st, base({ label: 'Fam', distributableId: d1.id, secret: SECRET2, primaryIp: '103.21.58.10', sharedWithFamily: true }), ctx(now)).ok === false);
  const st2 = memStore();
  ba.saveAccount(st2, base({ sharedWithFamily: true }), ctx(now));
  const d2 = ba.saveDistributable(st2, { label: 'Spouse PC' }, ctx(now));
  check('and when both declare it, it is allowed and the declaration is recorded',
    (() => { const r = ba.saveAccount(st2, base({ label: 'Spouse', distributableId: d2.id, secret: SECRET2, sharedWithFamily: true }), ctx(now)); return r.ok && r.account.sharedWithFamily === true; })());
  check('a distributable that still has an account cannot be removed', ba.removeDistributable(st, d1.id, ctx(now)).ok === false);
  const acctOnD1 = st.raw.brokerAccounts.accounts.find((a) => a.distributableId === d1.id);
  ba.removeAccount(st, acctOnD1.id);
  check('once empty it can be removed', ba.removeDistributable(st, d1.id, ctx(now)).ok === true);
  check('the installation cannot be removed', ba.removeDistributable(st, SELF.id, ctx(now)).ok === false);
  check('removing an account removes its secret from the store', (() => { const s3 = memStore(); const r = ba.saveAccount(s3, base(), ctx(now)); ba.removeAccount(s3, r.account.id); return !JSON.stringify(s3.raw).includes(SECRET); })());
  check('the registry is bounded', (() => { const s4 = memStore(); for (let i = 0; i < ba.MAX_ACCOUNTS; i += 1) ba.saveAccount(s4, base({ label: `a${i}`, primaryIp: '', secondaryIp: '' }), ctx(now)); return ba.saveAccount(s4, base({ label: 'over', primaryIp: '' }), ctx(now)).ok === false; })());

  section('detected vs registered: a fact about THIS machine only');
  const s5 = memStore();
  const mine = ba.saveAccount(s5, base(), ctx(now)).account;
  const dd = ba.saveDistributable(s5, { label: 'Elsewhere' }, ctx(now));
  const theirs = ba.saveAccount(s5, base({ label: 'Else', distributableId: dd.id, secret: SECRET2, primaryIp: '1.1.1.1' }), ctx(now)).account;
  check('before any detection the local account says it is not checked', ba.snapshot(s5, ctx(now)).accounts.find((a) => a.id === mine.id).ipState === 'not-checked');
  check('a private or junk detection is refused', ba.recordDetected(s5, '192.168.0.4', 'x').ok === false && ba.recordDetected(s5, 'abc', 'x').ok === false);
  ba.recordDetected(s5, '103.21.58.10', 'api.ipify.org', now);
  let sn = ba.snapshot(s5, ctx(now));
  check('a matching address says MATCH', sn.accounts.find((a) => a.id === mine.id).ipState === 'match');
  check('a different distributable is never compared with this machine', sn.accounts.find((a) => a.id === theirs.id).ipState === 'other-machine' && sn.accounts.find((a) => a.id === theirs.id).detectedIp === null);
  ba.recordDetected(s5, '8.8.4.4', 'api.ipify.org', now);
  check('a different address says MISMATCH', ba.snapshot(s5, ctx(now)).accounts.find((a) => a.id === mine.id).ipState === 'mismatch');
  check('the snapshot lists each distributable with its own IPs', (() => { const s = ba.snapshot(s5, ctx(now)); const a = s.distributables.find((d) => d.id === SELF.id); const b = s.distributables.find((d) => d.id === dd.id); return a.ips[0] === '103.21.58.10' && b.ips[0] === '1.1.1.1'; })());
  check('no snapshot, anywhere, contains a secret', !leaks(ba.snapshot(s5, ctx(now))) && !leaks(ba.snapshot(s5, ctx(now)), SECRET2));

  // ═══ the IP-echo detector ═══════════════════════════════════════════════════════════════════════
  section('detecting this machine\'s address');
  const okHttp = (body) => ({ getJson: async () => body });
  check('a public answer is accepted', (await egress.detect(okHttp({ ip: '8.8.8.8' }))).ip === '8.8.8.8');
  check('a private answer is refused, not recorded', (await egress.detect(okHttp({ ip: '10.0.0.4' }))).ok === false);
  check('a service error is passed on as a failure', (await egress.detect(okHttp({ error: 'HTTP 500' }))).ok === false);
  check('an exception is contained', (await egress.detect({ getJson: async () => { throw new Error('boom'); } })).ok === false);
  check('junk is refused', (await egress.detect(okHttp({ ip: '<html>' }))).ok === false && (await egress.detect(okHttp(null))).ok === false);
  for (const bad of ['http://api.ipify.org', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.1/x', 'https://user:pw@api.ipify.org', 'ftp://x', 'not a url', 'https://printer.local/ip']) {
    check(`the endpoint ${bad} is refused before any request`, await (async () => {
      let called = false;
      const r = await egress.detect({ getJson: async () => { called = true; return { ip: '8.8.8.8' }; } }, bad);
      return r.ok === false && called === false;
    })());
  }
  check('the default endpoint is https and public', egress.endpointOk(egress.DEFAULT_URL).ok);

  // ═══ the channels ═══════════════════════════════════════════════════════════════════════════════
  section('the channels: the validated principal is the only thing that counts');
  const handlers = new Map();
  const store = memStore();
  const sent = [];
  ipc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, {
    store, unlocked: () => true, self: () => SELF, brokerIds: () => ['kite', 'dhan', 'upstox'],
    http: { getJson: async (url) => { sent.push(url); return { ip: '203.0.114.9' }; } },
  });
  check('six channels are registered', handlers.size === 6, [...handlers.keys()].join(','));

  const pOf = {};
  principalBinding.useAuth({
    validateSession: (tok) => (pOf[tok] ? { userId: pOf[tok].userId } : null),
    findById: (uid) => Object.values(pOf).find((u) => u.userId === uid) || null,
    publicUser: (u) => ({ ...u, id: u.userId }),
  });
  const mkWin = (wid, tok, acct) => { pOf[tok] = { userId: `acct-${tok}`, username: tok, ...acct }; principalBinding.bind({ id: wid }, tok, 'fp'); return { sender: { id: wid } }; };
  const wins = {
    master: mkWin(801, 'm', { tier: 0 }), superadmin: mkWin(802, 's', { tier: 1 }), admin: mkWin(803, 'a', { tier: 2 }),
    operator: mkWin(804, 'o', { tier: 3 }), viewer: mkWin(805, 'v', { tier: 4 }), guest: mkWin(806, 'g', { tier: 5 }),
  };
  const nobody = { sender: { id: 999 } };
  const call = (ch, win, body) => handlers.get(ch)(win, body);

  const seed = await call('brokerAccounts:save', wins.superadmin, base());
  check('a SuperAdmin can save', seed.ok === true, JSON.stringify(seed));
  check('and master can read', (await call('brokerAccounts:list', wins.master)).ok === true);

  for (const [who, win] of Object.entries({ anonymous: nobody, guest: wins.guest, viewer: wins.viewer, operator: wins.operator, admin: wins.admin })) {
    const r = await call('brokerAccounts:list', win);
    check(`${who} is refused the list`, r.ok === false);
    check(`${who} learns NOTHING from the refusal: no data, no count, no label`, !('data' in r) && !JSON.stringify(r).includes('Main') && !/accounts?":\[/.test(JSON.stringify(r)), JSON.stringify(r));
    for (const ch of ['brokerAccounts:save', 'brokerAccounts:remove', 'brokerAccounts:distributable-save', 'brokerAccounts:distributable-remove', 'brokerAccounts:detect-ip']) {
      const w = await call(ch, win, base({ id: seed.account.id, label: 'x' }));
      check(`${who} is refused ${ch}`, w.ok === false && !('account' in w) && !('data' in w));
    }
  }
  check('nothing was changed by any refused call', store.raw.brokerAccounts.accounts.length === 1 && store.raw.brokerAccounts.accounts[0].label === 'Main');
  check('and no request left the machine for a refused caller', sent.length === 0);

  // The caller's own claim about who they are is ignored.
  const forged = await handlers.get('brokerAccounts:list')(wins.guest, { user: { tier: 0, id: 'x', username: 'master' } });
  check('a guest claiming to be master in the payload is still refused', forged.ok === false);
  const forged2 = await handlers.get('brokerAccounts:save')(wins.viewer, { tier: 0, userId: 'm', ...base() });
  check('and cannot save by claiming a tier', forged2.ok === false);

  // Every reply, for every allowed caller, is searched for the secret.
  const replies = [
    await call('brokerAccounts:list', wins.superadmin),
    await call('brokerAccounts:list', wins.master),
    await call('brokerAccounts:save', wins.superadmin, { id: seed.account.id, label: 'Main', secret: SECRET2, primaryIp: '103.21.58.10' }),
    await call('brokerAccounts:save', wins.superadmin, base({ label: 'Bad', secret: SECRET + ' with space' })),
    await call('brokerAccounts:save', wins.superadmin, base({ label: 'Bad2', primaryIp: '10.0.0.1' })),
    await call('brokerAccounts:detect-ip', wins.superadmin),
    await call('brokerAccounts:distributable-save', wins.superadmin, { label: 'D' }),
  ];
  check('NO reply to an allowed caller ever contains either secret', replies.every((r) => !leaks(r) && !leaks(r, SECRET2)), replies.map((r) => JSON.stringify(r).slice(0, 60)).join(' | '));
  check('no reply contains the unmasked API key', replies.every((r) => !JSON.stringify(r).includes(KEY)));
  check('the list says a secret exists, and that is all', replies[0].data.accounts[0].hasSecret === true && !Object.keys(replies[0].data.accounts[0]).some((k) => /secret$/i.test(k) && k !== 'hasSecret'));

  const dt = replies[5];
  check('detect-ip asks the echo service once and records the answer', dt.ok === true && sent.length === 1 && dt.detected.ip === '203.0.114.9', JSON.stringify(dt));
  check('the field whitelist: unknown fields in a save are not stored', (async () => true)() && (await (async () => {
    await call('brokerAccounts:save', wins.superadmin, { ...base({ label: 'Extra' }), primaryIp: '', isAdmin: true, __proto__: { polluted: 1 }, secretRef: 'x', createdAt: '1999' });
    const rec = store.raw.brokerAccounts.accounts.find((a) => a.label === 'Extra');
    return rec && !('isAdmin' in rec) && !('secretRef' in rec) && rec.createdAt !== '1999' && ({}).polluted === undefined;
  })()));
  const locked = [];
  ipc.register({ handle: (ch, fn) => locked.push([ch, fn]) }, { store: memStore(), unlocked: () => false, self: () => SELF, brokerIds: () => ['kite'], http: httpStub() });
  function httpStub() { return { getJson: async () => ({ ip: '8.8.8.8' }) }; }
  check('with the store locked even SuperAdmin gets a clear refusal', (await locked[0][1](wins.superadmin, {})).ok === false);
  check('a handler that throws returns a failure, not a crash', (await (async () => {
    const h = new Map();
    ipc.register({ handle: (ch, fn) => h.set(ch, fn) }, { store: { get() { throw new Error('disk'); }, set() {} }, unlocked: () => true, self: () => SELF, brokerIds: () => ['kite'], http: httpStub() });
    const r = await h.get('brokerAccounts:list')(wins.superadmin);
    return r.ok === false && /disk/.test(r.error);
  })()));

  // ═══ the generic store channels ═════════════════════════════════════════════════════════════════
  section('the generic store:* channels can no longer reach this domain, or `users`');
  const ds = require(path.join(ROOT, 'electron/dataStore.cjs'));
  const dsHandlers = new Map();
  ds.register({ handle: (ch, fn) => dsHandlers.set(ch, fn) });
  check('brokerAccounts is a real domain of the encrypted store (so a passcode change re-keys it)', ds.DOMAINS.includes('brokerAccounts'));
  for (const ch of ['store:get', 'store:set', 'store:push', 'store:update', 'store:remove', 'store:find']) {
    const forDomain = async (dom) => dsHandlers.get(ch)({}, dom, 'accounts', 'a', 'b');
    const a = await forDomain('brokerAccounts');
    const u = await forDomain('users');
    const cfg = await forDomain('config');
    check(`${ch} refuses brokerAccounts, users and config before touching the store`,
      a.ok === false && /not available to the window/.test(a.error) && u.ok === false && /not available to the window/.test(u.error) && cfg.ok === false && /not available to the window/.test(cfg.error), JSON.stringify([a, u, cfg]));
    const k = await forDomain('knowledge');
    check(`${ch} still reaches knowledge (it passes the guard; the locked store is the only thing in the way)`, !/not available to the window/.test(k.error || ''), JSON.stringify(k));
  }

  // ═══ source: parity, no secret channel, no order ════════════════════════════════════════════════
  section('the wiring: capabilities, preload, and what must not exist');
  const caps = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/capabilities.json'), 'utf8')).capabilities;
  check('view and write are tier 1 (SuperAdmin)', caps['brokers.accounts.view'] === 1 && caps['brokers.accounts.write'] === 1);
  const cap = require(path.join(ROOT, 'electron/lib/capability.cjs'));
  check('tier 1 holds them, tier 2 does not', cap.can({ tier: 1 }, 'brokers.accounts.view') && !cap.can({ tier: 2 }, 'brokers.accounts.view') && !cap.can({ tier: 2 }, 'brokers.accounts.write'));
  const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  const members = { list: 'list', save: 'save', remove: 'remove', distributableSave: 'distributable-save', distributableRemove: 'distributable-remove', detectIp: 'detect-ip' };
  for (const [m, chn] of Object.entries(members)) {
    check(`preload brokerAccounts.${m} -> brokerAccounts:${chn}`, new RegExp(`${m}:\\s*\\([^)]*\\)\\s*=>\\s*ipcRenderer\\.invoke\\('brokerAccounts:${chn}'`).test(pre) && handlers.has(`brokerAccounts:${chn}`));
  }
  const block = pre.slice(pre.indexOf('brokerAccounts: {'), pre.indexOf('brokers: {'));
  check('the preload sends no `user`: main uses the account behind the window', !/user/.test(block.replace(/\/\/.*$/gm, '')));
  check('no member returns or reveals a secret (no reveal/get-secret/show)', !/reveal|getSecret|showSecret|secretFor/i.test(block));
  const ipcSrc = fs.readFileSync(path.join(ROOT, 'electron/ipc/brokerAccounts.cjs'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('no channel calls secretFor: the secret has no way out', !/secretFor/.test(ipcSrc));
  const gateOf = (ch) => { const m = ipcSrc.match(new RegExp("ipcMain\\.handle\\('" + ch + "',\\s*gated\\('([a-z.]+)'")); return m && m[1]; };
  for (const ch of ['brokerAccounts:save', 'brokerAccounts:remove', 'brokerAccounts:distributable-save', 'brokerAccounts:distributable-remove', 'brokerAccounts:detect-ip']) {
    check(`${ch} is gated on brokers.accounts.write (view and write share tier 1 today, so only the source can tell them apart)`, gateOf(ch) === 'brokers.accounts.write', String(gateOf(ch)));
  }
  check('brokerAccounts:list is gated on brokers.accounts.view', gateOf('brokerAccounts:list') === 'brokers.accounts.view');
  check('the channels gate on the validated principal, not on a sent user', /principalBinding\.getPrincipal\(e\)/.test(ipcSrc) && !/\{\s*user\b/.test(ipcSrc));
  const all = ipcSrc + fs.readFileSync(path.join(ROOT, 'electron/lib/brokerAccounts.cjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'electron/lib/egressIp.cjs'), 'utf8');
  check('nothing here can place an order (Section 95)', !/place_?order|placeOrder|submitOrder|\/orders?\b|kite\.place/i.test(all));
  check('and no timer: the IP check is never scheduled', !/setInterval|setTimeout/.test(ipcSrc + fs.readFileSync(path.join(ROOT, 'electron/lib/egressIp.cjs'), 'utf8')));
  check('no console.log in shipped code', !/console\.log/.test(all));

  principalBinding.useAuth(null);
  principalBinding.reset();
  console.warn(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
