#!/usr/bin/env node
/**
 * verifyBrokerAccountsUi.mjs - what the broker-account panel says and what it must never do (spec Section 152)
 *
 * The main-process half (`verifyBrokerAccounts.cjs`) proves a secret never leaves. This proves the window
 * cannot undo that: the panel renders nothing for an account that may not see it, never binds a stored secret
 * to anything on screen, starts from an empty secret box, and uses only channels the preload really has.
 *
 * Run: node scripts/verifyBrokerAccountsUi.mjs   (or npm run verify:broker-accounts-ui)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/Models/brokerAccountsModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

console.log('\n--- who may see the panel ---');
const caps = { 'brokers.accounts.view': 1, 'brokers.accounts.write': 1 };
const can = (u, cap) => !!u && typeof u.tier === 'number' && caps[cap] !== undefined && u.tier <= caps[cap];
check('SuperAdmin sees it', M.visibleTo(can, { tier: 1 }) && M.mayWrite(can, { tier: 1 }));
check('Master sees it', M.visibleTo(can, { tier: 0 }));
for (const [who, u] of [['admin', { tier: 2 }], ['operator', { tier: 3 }], ['viewer', { tier: 4 }], ['guest', { tier: 5 }], ['nobody', null], ['no tier', {}], ['string tier', { tier: '1' }]]) {
  check(`${who} does not`, M.visibleTo(can, u) === false && M.mayWrite(can, u) === false);
}
check('a missing can() function is a no, not a crash', M.visibleTo(undefined, { tier: 0 }) === false);
check('can() returning something truthy but not true is a no', M.visibleTo(() => 'yes', { tier: 0 }) === false);

console.log('\n--- what it says about an IP ---');
const A = (o) => ({ primaryIp: '103.21.58.10', secondaryIp: '', ...o });
const s1 = M.ipStatus(A({ ipState: 'match', detectedIp: '103.21.58.10' }));
check('a match says so, in green', s1.tone === 'good' && /MATCHES/.test(s1.label));
const s2 = M.ipStatus(A({ ipState: 'mismatch', detectedIp: '8.8.4.4' }));
check('a mismatch is red, names both addresses, and warns that changing it is limited to once a week', s2.tone === 'bad' && /8\.8\.4\.4/.test(s2.text) && /103\.21\.58\.10/.test(s2.text) && /once a week/.test(s2.text));
check('not checked tells master what to press', /Detect/.test(M.ipStatus(A({ ipState: 'not-checked' })).text));
check('another machine is never compared', /says nothing about it/.test(M.ipStatus(A({ ipState: 'other-machine' })).text) && M.ipStatus(A({ ipState: 'other-machine' })).tone === 'muted');
check('no IP says no IP', M.ipStatus({}).label === 'NO IP');
check('junk does not throw', (() => { try { M.ipStatus(null); M.ipStatus('x'); M.changeLock(null); M.groupByDistributable(null); M.draftProblems(null); return true; } catch { return false; } })());
check('the weekly lock names the date it clears', /2026-10-08/.test(M.changeLock({ nextIpChangeOn: '2026-10-08' })) && M.changeLock({ nextIpChangeOn: null }) === null);

console.log('\n--- grouping and the draft ---');
const snap = {
  distributables: [{ id: 'd1', label: 'Master PC', self: true, ips: ['1.1.1.1'] }, { id: 'd2', label: 'Ravi', ips: [] }],
  accounts: [{ id: 'a1', distributableId: 'd1' }, { id: 'a2', distributableId: 'd1' }, { id: 'a3', distributableId: 'd2' }],
};
const g = M.groupByDistributable(snap);
check('each distributable lists its own accounts', g[0].accounts.length === 2 && g[1].accounts.length === 1);
check('and states its IPs, or that it has none yet', /1 registered IP: 1\.1\.1\.1/.test(g[0].sentence) && /No IP registered yet/.test(g[1].sentence));
check('two IPs are counted in the plural', /2 registered IPs/.test(M.groupByDistributable({ distributables: [{ id: 'x', label: 'x', ips: ['1.1.1.1', '8.8.8.8'] }], accounts: [] })[0].sentence));
check('an empty draft lists what is missing', M.draftProblems(M.blankDraft('d1')).length === 3);
check('a secondary without a primary is caught before the round trip', M.draftProblems({ ...M.blankDraft('d1'), label: 'x', apiKey: 'k', secret: 's', secondaryIp: '1.1.1.1' }).some((p) => /primary/.test(p)));
check('the same IP twice is caught', M.draftProblems({ ...M.blankDraft('d1'), label: 'x', apiKey: 'k', secret: 's', primaryIp: '1.1.1.1', secondaryIp: '1.1.1.1' }).some((p) => /same/.test(p)));
check('editing may leave the key and secret blank (they are kept)', M.draftProblems({ ...M.blankDraft('d1'), id: 'a1', label: 'x' }).length === 0);
check('a new account may not', M.draftProblems({ ...M.blankDraft('d1'), label: 'x' }).length === 2);
const edit = M.draftFrom({ id: 'a1', label: 'Main', brokerId: 'kite', clientId: 'AB1', distributableId: 'd1', primaryIp: '1.1.1.1', apiKeyMasked: 'abcd••••', hasSecret: true, secret: 'SHOULD-NEVER-BE-COPIED' });
check('editing starts with an EMPTY secret and an empty key, whatever the view held', edit.secret === '' && edit.apiKey === '' && !JSON.stringify(edit).includes('SHOULD-NEVER-BE-COPIED'));
check('the weekly-lock refusal is recognised so the form can ask instead of failing', M.isWeeklyLock({ ok: false, needsAcknowledgement: true }) && !M.isWeeklyLock({ ok: false }) && !M.isWeeklyLock(null));
const reason = M.REASON.lines.join(' ');
check('the reason is stated: why each distributable needs its own IP, and that Rāma places no orders', /immediate family/.test(reason) && /own machine|someone else/.test(reason) && /places no orders/.test(reason));

console.log('\n--- the component, read as source ---');
const src = fs.readFileSync(path.join(ROOT, 'src/pages/Models/BrokerAccounts.jsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('it renders NOTHING for an account that may not see it', /if \(!allowed\) return null;/.test(code));
check('and the registry is only fetched for one that may', /useEffect\(\(\) => \{ if \(allowed && inBridge\) load\(\); \}, \[allowed, load\]\)/.test(code));
check('the check uses the real can() from accessControl', /import \{ can \} from '@services\/accessControl\.js'/.test(code) && /visibleTo\(can, currentUser\)/.test(code));
check('writes are offered only to a writer', (code.match(/writable &&/g) || []).length >= 4);
check('NOTHING on a stored account is bound to a value, a field or the screen except the masked key and hasSecret',
  !/\ba\.secret\b|\.secret\b(?!\s*:)/.test(code.replace(/draft\.secret/g, '').replace(/hasSecret/g, '')));
check('the only secret on screen is the draft box, bound once', (code.match(/draft\.secret/g) || []).length === 1);
check('that box is a password field that the browser will not autofill or save', /type="password"[^>]*autoComplete="new-password"/.test(code));
check('there is no way to reveal a secret', !/reveal|show ?secret|unmask|getSecret/i.test(code));
check('removing asks first', /window\.confirm\(/.test(code) && code.indexOf('window.confirm(') < code.indexOf('brokerAccounts.remove('));
check('no timer, no polling', !/setInterval|setTimeout|requestAnimationFrame/.test(code));
check('detecting the address is a button, never automatic', /brokerAccounts\.detectIp\(\)/.test(code) && !/useEffect[^]*detectIp/.test(code.slice(0, code.indexOf('const run'))));
check('the detect button says it tells a third party this machine\'s address', /tells the service this machine's address/.test(src));
const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
const used = [...new Set([...code.matchAll(/brokerAccounts\.(\w+)\(/g)].map((m) => m[1]))];
check('every bridge member it calls exists in the preload', used.length >= 5 && used.every((u) => new RegExp(`\\b${u}:\\s*\\(`).test(pre.slice(pre.indexOf('brokerAccounts: {'), pre.indexOf('brokers: {')))), used.join(','));
check('no font size is a literal number', !/fontSize:\s*['"]?\d/.test(code));
check('no console.log', !/console\.log/.test(code));
const models = fs.readFileSync(path.join(ROOT, 'src/pages/Models/Models.jsx'), 'utf8');
check('Models mounts it inside the brokers tab with the signed-in account', /tab === 'brokers'[^]{0,400}<BrokerAccounts currentUser=\{currentUser\} \/>/.test(models) && /import BrokerAccounts from '\.\/BrokerAccounts\.jsx'/.test(models));
const reg = fs.readFileSync(path.join(ROOT, 'src/config/registry.js'), 'utf8');
check('the Models page itself is SuperAdmin-gated, so the tab is reachable by the account that holds the capability', /route:\s*'\/models'[^]{0,200}minTier:\s*TIERS\.SUPERADMIN/.test(reg));


console.log('\n--- Kite: the session, said plainly ---');
const kacct = (session, over = {}) => ({ id: 'k1', brokerId: 'kite', session, ...over });
const live = M.sessionStatus(kacct({ state: 'live', userId: 'AB1234', expiresAt: '2026-10-19T00:30:00.000Z' }));
check('a live session says who, and that it ends at 6 AM IST', live.state === 'live' && live.tone === 'good' && /AB1234/.test(live.text) && /6 AM IST/.test(live.text));
check('an ended session is red and says to log in again', M.sessionStatus(kacct({ state: 'expired' })).tone === 'bad' && /Log in again/.test(M.sessionStatus(kacct({ state: 'expired' })).text));
check('no session says candles need one', M.sessionStatus(kacct({ state: 'none' })).label === 'NOT LOGGED IN' && /live/.test(M.sessionStatus(kacct({ state: 'none' })).text));
check('a missing or junk session is "none", never "live"', M.sessionStatus(null).state === 'none' && M.sessionStatus({}).state === 'none' && M.sessionStatus(kacct(undefined)).state === 'none' && M.sessionStatus(kacct({ state: 'live-ish' })).state === 'none');
check('only Zerodha accounts are Kite accounts', M.isKite(kacct({})) && !M.isKite({ brokerId: 'dhan' }) && !M.isKite(null));
check('the login steps say Rāma never sees the password, and there are three', M.KITE_STEPS.length === 3 && /never sees your password/.test(M.KITE_STEPS[0]) && /address bar/.test(M.KITE_STEPS[2]));
check('the redirect note says nothing has to listen there', /Nothing has to be running/.test(M.KITE_REDIRECT_NOTE));

console.log('\n--- Kite: what can be fetched, and why not ---');
check('the supported intervals', ['1m', '5m', '15m', '30m', '60m', '1h', '1d'].every((i) => M.kiteSupportsInterval(i)) && !M.kiteSupportsInterval('1wk') && !M.kiteSupportsInterval('1mo') && !M.kiteSupportsInterval(''));
const snapK = { accounts: [{ id: 'z', brokerId: 'dhan' }, kacct({ state: 'none' }, { id: 'k0' }), kacct({ state: 'live' }, { id: 'k2' })] };
check('the live Zerodha account is preferred over an idle one', M.pickKiteAccount(snapK).id === 'k2');
check('with no live one the first Zerodha account is returned (so the button can explain)', M.pickKiteAccount({ accounts: [kacct({ state: 'none' }, { id: 'k0' })] }).id === 'k0');
check('with no Zerodha account there is nothing', M.pickKiteAccount({ accounts: [{ brokerId: 'dhan' }] }) === null && M.pickKiteAccount(null) === null);
const okAcct = kacct({ state: 'live' });
check('a live account, a symbol and a supported interval can fetch', M.whyCannotKiteFetch({ account: okAcct, symbol: 'RELIANCE', interval: '1d', busy: false }) === null);
check('no account, no symbol, a weekly interval, no session and busy each give their own sentence', new Set([
  M.whyCannotKiteFetch({ account: null, symbol: 'X', interval: '1d' }), M.whyCannotKiteFetch({ account: okAcct, symbol: '', interval: '1d' }),
  M.whyCannotKiteFetch({ account: okAcct, symbol: 'X', interval: '1wk' }), M.whyCannotKiteFetch({ account: kacct({ state: 'expired' }), symbol: 'X', interval: '1d' }),
  M.whyCannotKiteFetch({ account: okAcct, symbol: 'X', interval: '1d', busy: true })]).size === 5);
check('an expired session points at the login and at 6 AM IST', /Log in to Kite first/.test(M.whyCannotKiteFetch({ account: kacct({ state: 'expired' }), symbol: 'X', interval: '1d' })) && /6 AM IST/.test(M.whyCannotKiteFetch({ account: kacct({ state: 'none' }), symbol: 'X', interval: '1d' })));
const msg = M.kiteFetchMessage({ ok: true, fetched: 250, requests: 1, skipped: 2, stored: { bars: 300, firstBar: '2025-10-16 00:00:00', lastBar: '2026-10-16 00:00:00' } });
check('a fetch reports counts, the store depth and that it was KEPT for analysis', /250 candles in 1 request/.test(msg) && /kept for analysis/.test(msg) && /300 bars/.test(msg) && /2 malformed/.test(msg));
check('a partial fetch says why it stopped', /Stopped early: cap/.test(M.kiteFetchMessage({ ok: true, fetched: 5, requests: 300, partial: 'cap', stored: {} })));
check('a failure shows the engine\'s own sentence', M.kiteFetchMessage({ ok: false, error: 'Kite rejected the session. Log in again.' }) === 'Kite rejected the session. Log in again.');
check('junk does not throw', (() => { try { M.kiteFetchMessage(null); M.kiteFetchMessage({}); M.pickKiteAccount({}); M.sessionStatus('x'); return true; } catch { return false; } })());

console.log('\n--- Kite: the components, read as source ---');
const kf = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/KiteFetch.jsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('the fetch button renders nothing unless the account may write AND a Zerodha account exists', /visibleTo\(can, currentUser\) && mayWrite\(can, currentUser\)/.test(kf) && /if \(!allowed \|\| !inBridge \|\| !account\) return null;/.test(kf));
check('the registry is read only for an allowed account', /useEffect\(\(\) => \{ if \(allowed && inBridge\) load\(\); \}/.test(kf));
check('a fetch happens only on a click: fetchBars is called once, inside run()', (kf.match(/kiteSession\.fetchBars\(/g) || []).length === 1 && /const run = async/.test(kf) && /onClick=\{run\}/.test(kf) && !/useEffect[^]{0,200}fetchBars/.test(kf));
check('the button says it keeps the data and uses the subscription', /keep them for analysis/.test(kf) && /subscription/.test(kf));
check('no timer, no token handling, no console.log', !/setInterval|setTimeout|accessToken|console\.log/.test(kf));
check('no font size is a literal number', !/fontSize:\s*['"]?\d/.test(kf));
const ba = fs.readFileSync(path.join(ROOT, 'src/pages/Models/BrokerAccounts.jsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('the Kite controls appear only on a Zerodha account for a writer', /isKite\(a\) && writable/.test(ba));
check('the login members are called with literal names', /kiteSession\.loginStart\(id\)/.test(ba) && /kiteSession\.loginComplete\(id, redirectText\)/.test(ba) && /kiteSession\.logout\(a\.id\)/.test(ba));
check('the panel never reads a token from an account', !/accessToken|\.session\.token|session\.secret/.test(ba));
check('the pasted address is kept in memory only and cleared after use', /setRedirectText\(''\)/.test(ba) && !/localStorage|sessionStorage/.test(ba));
check('the login opens only when the button is pressed (no effect starts it)', !/useEffect[^]{0,300}loginStart/.test(ba));
const preK = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
const blkK = preK.slice(preK.indexOf('kiteSession: {'), preK.indexOf('brokerAccounts: {'));
check('every kiteSession member the UI calls exists in the preload', [['loginStart', ba], ['loginComplete', ba], ['logout', ba], ['fetchBars', kf]].every(([m, src]) => src.includes(`kiteSession.${m}(`) && new RegExp(`${m}:`).test(blkK)));
const smK = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/StockMind.jsx'), 'utf8');
check('StockMind mounts the fetch button beside the other fetches and reloads from disk afterwards', /<KiteFetch currentUser=\{currentUser\}[^>]*onDone=\{\(\) => loadBars\(false\)\}/.test(smK.replace(/\n\s*/g, ' ')) && /import KiteFetch from '\.\/KiteFetch\.jsx'/.test(smK));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
