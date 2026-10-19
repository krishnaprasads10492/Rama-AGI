#!/usr/bin/env node
/**
 * verifyTokenExpiryUi.mjs - what the expiry bar and the Keys row say, and what they must never do (spec Section 158)
 *
 * The main-process half (`verifyTokenExpiry.cjs`) decides the state. This proves the window words it truthfully,
 * obeys it (10 seconds for a warning, no way out for an expired token), shows the date beside the token, and holds
 * no token.
 *
 * Run: node scripts/verifyTokenExpiryUi.mjs   (or npm run verify:token-expiry-ui)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/GitSync/gitCredentialModel.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const section = (t) => console.warn(`\n--- ${t} ---`);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const UTC = { timeZone: 'UTC' };
const DAY = 86400000;
const HOUR = 3600000;

const base = { state: 'ok', persistent: false, autoHideMs: 0, show: false, kind: 'classic', login: 'k', expiresAt: null, msLeft: null, expirySource: 'github', savedAt: 1, verifiedAt: 1, rejectedAt: null, warnDays: 14 };
const N = (o) => ({ ...base, ...o });
const T0 = Date.parse('2026-11-20T14:30:00Z');

section('remaining / formatWhen');
check('in days', M.remaining(5 * DAY + 3 * HOUR) === 'in 5 days');
check('one day is singular', M.remaining(1 * DAY + HOUR) === 'in 1 day' || M.remaining(1 * DAY + HOUR) === 'in 25 hours');
check('under 48 hours is counted in hours', M.remaining(30 * HOUR) === 'in 30 hours');
check('one hour is singular', M.remaining(HOUR + 5) === 'in 1 hour');
check('under an hour', M.remaining(20 * 60000) === 'in under an hour');
check('already past', M.remaining(-3 * DAY - HOUR) === 'expired 3 days ago');
check('just past', M.remaining(-60000) === 'expired under an hour ago');
check('zero is past, not "in"', M.remaining(0).startsWith('expired'));
check('non-numbers say nothing', M.remaining(undefined) === '' && M.remaining(NaN) === '' && M.remaining('5') === '');
check('formatWhen names the zone, the date and the time', (() => { const w = M.formatWhen(T0, UTC); return /20 Nov 2026/.test(w) && /14:30/.test(w) && /UTC|GMT/.test(w); })(), M.formatWhen(T0, UTC));
check('formatWhen of nonsense is not "Invalid Date"', M.formatWhen(undefined) === 'an unknown time' && M.formatWhen(NaN) === 'an unknown time');

section('expiryLine: beside the token');
check('no record', M.expiryLine(null) === 'No GitHub token is recorded.' && M.expiryLine(N({ state: 'none' })) === 'No GitHub token is recorded.');
check('a future date, with the time left', (() => { const l = M.expiryLine(N({ state: 'ok', expiresAt: T0, msLeft: 9 * DAY }), UTC); return /^Expires /.test(l) && /20 Nov 2026/.test(l) && /in 9 days/.test(l); })());
check('a past date says Expired, with how long ago', (() => { const l = M.expiryLine(N({ state: 'expired', expiresAt: T0, msLeft: -2 * DAY }), UTC); return /^Expired /.test(l) && /expired 2 days ago/.test(l); })());
check('GitHub reporting none is said as such', /No expiry/.test(M.expiryLine(N({ expirySource: 'none' }))));
check('an unknown expiry is said as unknown, not as "never"', /unknown/i.test(M.expiryLine(N({ expirySource: 'unknown' }))) && !/never/i.test(M.expiryLine(N({ expirySource: 'unknown' }))));
check('where the date came from', /GitHub/.test(M.sourceNote(N({ expirySource: 'github' }))) && /by hand/.test(M.sourceNote(N({ expirySource: 'manual' }))) && M.sourceNote(N({ expirySource: 'unknown' })) === '' && M.sourceNote(null) === '');
check('last confirmed', /Last confirmed by GitHub/.test(M.verifiedLine(N({ verifiedAt: T0 }), UTC)));
check('never confirmed', M.verifiedLine(N({ verifiedAt: null, state: 'unverified' })) === 'Not yet confirmed by GitHub.');
check('refused', /GitHub refused this token/.test(M.verifiedLine(N({ state: 'rejected', rejectedAt: T0 }), UTC)));
check('nothing for no token', M.verifiedLine(null) === '' && M.verifiedLine(N({ state: 'none' })) === '');

section('bannerOf: when, how long, and whether it can be dismissed');
check('nothing to show: no banner', M.bannerOf(null) === null && M.bannerOf(N({ state: 'ok', show: false })) === null && M.bannerOf(N({ state: 'no-expiry' })) === null && M.bannerOf(N({ state: 'unknown-expiry' })) === null);
const warn = M.bannerOf(N({ state: 'expiring', show: true, autoHideMs: 10000, expiresAt: T0, msLeft: 6 * DAY }), UTC);
check('expiring: a warning for 10 seconds, dismissible', warn && warn.persistent === false && warn.autoHideMs === 10000 && warn.tone === 'warn');
check('and it names the date, the time left, and where to replace it', /20 Nov 2026/.test(warn.text) && /in 6 days/.test(warn.text) && /Models > Keys/.test(warn.text));
for (const [st, o] of [['expired', { expiresAt: T0, msLeft: -1000 }], ['rejected', {}], ['unverified', { verifiedAt: null }]]) {
  const b = M.bannerOf(N({ state: st, show: true, persistent: true, ...o }), UTC);
  check(`${st}: persistent, no timer, red`, b && b.persistent === true && b.autoHideMs === 0 && b.tone === 'bad');
}
const exp = M.bannerOf(N({ state: 'expired', show: true, persistent: true, expiresAt: T0, msLeft: -DAY }), UTC);
check('expired: says it stays until GitHub accepts a new token', /stays here until GitHub accepts/.test(exp.text) && /Models > Keys/.test(exp.text));
check('refused: says why it might be, and the same remedy', /revoked|expired|wrong/.test(M.bannerOf(N({ state: 'rejected', show: true, persistent: true })).text));
check('not confirmed: says how to confirm it', /TEST WITH GITHUB/.test(M.bannerOf(N({ state: 'unverified', show: true, persistent: true })).text));
check('the window obeys the notice: show:false hides even a persistent-looking state', M.bannerOf(N({ state: 'expired', show: false, persistent: true })) === null);
check('persistence comes from the notice, not from the state name', M.bannerOf(N({ state: 'expiring', show: true, persistent: false, autoHideMs: 10000 })).persistent === false);
check('an unknown state shows nothing', M.bannerOf(N({ state: 'mystery', show: true })) === null);

section('keyRow: the GitHub row in Models > Keys');
const K = (n, ctx) => M.keyRow(n, ctx);
check('no token, vault open', (() => { const r = K(N({ state: 'none' }), { vaultUnlocked: true, stored: false }); return r.label === 'NO TOKEN' && r.tone === 'idle' && r.stored === false && /No GitHub token is stored/.test(r.lines.join(' ')); })());
check('no record and a locked vault says it cannot list, not "none"', (() => { const r = K(null, { vaultUnlocked: false, stored: null }); return /locked/.test(r.lines.join(' ')) && !/No GitHub token is stored/.test(r.lines.join(' ')); })());
check('stored with no record: says so and how to fix', (() => { const r = K(N({ state: 'none' }), { vaultUnlocked: true, stored: true }); return r.label === 'STORED, NO RECORD' && r.tone === 'warn' && r.stored && /TEST WITH GITHUB/.test(r.lines.join(' ')); })());
check('ok: STORED, green, with the date, its source and the last confirmation', (() => { const r = K(N({ state: 'ok', expiresAt: T0, msLeft: 40 * DAY, verifiedAt: T0 }), { stored: true }); return r.label === 'STORED' && r.tone === 'good' && r.lines.length === 3 && /^Expires/.test(r.lines[0]) && /GitHub/.test(r.lines[1]) && /confirmed/.test(r.lines[2]); })());
check('expiring: EXPIRES SOON, amber', (() => { const r = K(N({ state: 'expiring', expiresAt: T0, msLeft: 3 * DAY }), {}); return r.label === 'EXPIRES SOON' && r.tone === 'warn'; })());
check('expired: EXPIRED, red', (() => { const r = K(N({ state: 'expired', expiresAt: T0, msLeft: -DAY }), {}); return r.label === 'EXPIRED' && r.tone === 'bad'; })());
check('refused: REFUSED, red', K(N({ state: 'rejected', rejectedAt: T0 }), {}).label === 'REFUSED' && K(N({ state: 'rejected', rejectedAt: T0 }), {}).tone === 'bad');
check('unverified: NOT CONFIRMED, amber', K(N({ state: 'unverified', verifiedAt: null }), {}).label === 'NOT CONFIRMED' && K(N({ state: 'unverified', verifiedAt: null }), {}).tone === 'warn');
check('the state is in WORDS, never colour alone', ['none', 'ok', 'expiring', 'expired', 'rejected', 'unverified', 'no-expiry', 'unknown-expiry'].every((st) => K(N({ state: st }), {}).label.length > 3));
check('a date can be typed only when GitHub did not report one', K(N({ expirySource: 'unknown', state: 'unknown-expiry' }), {}).canTypeDate === true && K(N({ expirySource: 'manual', state: 'ok' }), {}).canTypeDate === true && K(N({ expirySource: 'github' }), {}).canTypeDate === false && K(N({ expirySource: 'none', state: 'no-expiry' }), {}).canTypeDate === false && K(null, {}).canTypeDate === false);

section('saveSummary');
check('confirmed: says so, and the expiry', (() => { const t = M.saveSummary({ ok: true, kind: 'classic', verified: true, notice: N({ state: 'ok', expiresAt: T0, msLeft: 30 * DAY }) }); return /GitHub confirmed it works/.test(t) && /Expires/.test(t); })());
check('not confirmed: says why, and that the reminder stays', (() => { const t = M.saveSummary({ ok: true, kind: 'fine-grained', verified: false, unverifiedReason: 'GitHub could not be reached', notice: N({ state: 'unverified' }) }); return /could not confirm/.test(t) && /could not be reached/.test(t) && /reminder stays/.test(t); })());
check('a refusal is its message', M.saveSummary({ ok: false, error: 'GitHub rejected this token' }) === 'GitHub rejected this token');
check('nothing at all still says something', M.saveSummary(null).length > 0);
check('the test summary now carries the expiry', M.testSummary({ ok: true, login: 'k', kind: 'classic', notice: N({ state: 'ok', expiresAt: T0, msLeft: 9 * DAY }) }).some((l) => /Expires/.test(l)));
check('and is unchanged when there is no notice', !M.testSummary({ ok: true, login: 'k', kind: 'classic' }).some((l) => /Expire/.test(l)));
check('the numbers the window uses are exported', M.EXPIRY_EVENT === 'rama-github-token-changed' && M.EXPIRY_POLL_MS === 300000);

section('the bar: TokenExpiryNotice.jsx');
const bar = read('src/components/TokenExpiryNotice.jsx');
const shell = read('src/components/AppShell.jsx');
const preload = read('electron/preload.cjs');
const barCode = bar.replace(/\/\*[\s\S]*?\*\//g, '');
check('it is mounted in the shell, under the title bar', /<Titlebar \/>\s*<TokenExpiryNotice \/>/.test(shell) && /import TokenExpiryNotice/.test(shell));
check('only those who can act on it see it (vault.read)', /canDo\('vault\.read'\)/.test(bar) && /if \(!allowed \|\| !plan\) return null/.test(bar));
check('the state comes from the main process, never computed here', /window\.rama\.gitAuth\.expiry\(\)/.test(bar) && !/Date\.now|new Date\(/.test(barCode) && !/WARN|warnDays|\bDAY\b/.test(barCode));
check('the 10 seconds come from the notice, not a literal', /setTimeout\(\(\) => setExpiringDone\(true\), hideAfter\)/.test(bar) && !/\b10000\b/.test(bar));
check('a persistent notice has no dismiss button', /\{!plan\.persistent && \(\s*<button[^>]*onClick=\{\(\) => setExpiringDone\(true\)\}/.test(bar));
check('and its timer cannot run for it (the timer only starts for the warning)', /if \(!expiring\) \{[\s\S]*?return;\s*\}/.test(bar) && /const expiring = !!plan && !plan\.persistent/.test(bar));
check('a persistent notice is announced as an alert, the warning as a status', /role=\{plan\.persistent \? 'alert' : 'status'\}/.test(bar));
check('it re-asks every 5 minutes, and at once when told', /setInterval\(refresh, EXPIRY_POLL_MS\)/.test(bar) && /addEventListener\(EXPIRY_EVENT, refresh\)/.test(bar));
check('and cleans up both, and the timer', /clearInterval\(id\)/.test(bar) && /removeEventListener\(EXPIRY_EVENT, refresh\)/.test(bar) && /clearTimeout\(timer\.current\)/.test(bar));
check('the warning\'s clock restarts only if it went away and came back', /timed\.current = false/.test(bar) && /if \(timed\.current\) return;/.test(bar));
check('the button takes master to Models > Keys', /navigate\('\/models', \{ state: \{ tab: 'keys' \} \}\)/.test(bar));
check('state is also in words and a symbol, not colour alone', /<strong>\{plan\.title\}\.<\/strong>/.test(bar) && /⚠/.test(bar));
check('it holds no token and does not use the (unrendered) toast queue', !/token\b.*useState|localStorage|sessionStorage|pushNotification/.test(barCode));
check('no console.log', !/console\.log/.test(bar));
check('the preload has both new channels and sends only the date', /expiry: \(\)\s*=> ipcRenderer\.invoke\('gitAuth:expiry'\)/.test(preload) && /setExpiry: \(date\)\s*=> ipcRenderer\.invoke\('gitAuth:set-expiry', \{ date \}\)/.test(preload));

section('the Keys row: GitHubKeyFacts.jsx and Models.jsx');
const facts = read('src/pages/Models/GitHubKeyFacts.jsx');
const models = read('src/pages/Models/Models.jsx');
check('the facts come from the model, not from the vault', /keyRow\(data\?\.notice/.test(facts) && !/vault\./.test(facts));
check('the state is shown as text', /\{row\.label\}/.test(facts));
check('the date field exists only when allowed AND the user may write', /row\.canTypeDate && canWrite/.test(facts) && /type="date"/.test(facts));
check('the date field is labelled', /htmlFor="gh-expiry-date"/.test(facts) && /id="gh-expiry-date"/.test(facts));
check('saving a date tells the bar', /dispatchEvent\(new Event\(EXPIRY_EVENT\)\)/.test(facts));
check('a refusal is announced', /role="alert"/.test(facts));
check('Models reads the expiry with the page', /window\.rama\.gitAuth\?\.expiry \? window\.rama\.gitAuth\.expiry\(\)/.test(models) && /setGitExpiry\(gRes\)/.test(models));
check('the GitHub row shows the facts beside the token, and only that row', /\{isGit && <GitHubKeyFacts data=\{gitExpiry\}/.test(models) && (models.match(/<GitHubKeyFacts/g) || []).length === 1);
check('the row\'s dot reflects the state for GitHub and is unchanged for the others', /background: gitRow \? TONE\[gitRow\.tone\] : 'var\(--border\)'/.test(models));
check('the GitHub token is saved through gitAuth:set (GitHub is asked first)', /credKey === 'GITHUB_TOKEN'\s*\?\s*await window\.rama\.gitAuth\.set\(value\)/.test(models));
check('other keys still go to the vault', /await window\.rama\.vault\.set\(currentUser, credKey, value/.test(models));
check('a refused save keeps the dialog open and says why', /res && res\.ok === false\) \{ setError/.test(models) && /\{error && <div role="alert"/.test(models));
check('saving the GitHub token tells the bar', /if \(credKey === 'GITHUB_TOKEN'\) window\.dispatchEvent\(new Event\(EXPIRY_EVENT\)\)/.test(models));
check('the page opens on the tab the bar asks for', /useState\(\(\) => location\.state\?\.tab \|\| 'cloud'\)/.test(models) && /if \(location\.state\?\.tab\) setTab\(location\.state\.tab\)/.test(models));
check('the page re-reads when told, and stops listening', /addEventListener\(EXPIRY_EVENT, load\)/.test(models) && /removeEventListener\(EXPIRY_EVENT, load\)/.test(models));
const jsx = read('src/pages/GitSync/GitCredential.jsx');
check('the Git Sync tab tells the bar after each action and shows the expiry', /tellExpiryBar\(\)/.test(jsx) && (jsx.match(/tellExpiryBar\(\)/g) || []).length >= 2 && /if \(after\) after\(res\);\s*tellExpiryBar\(\)/.test(jsx) && /expiryLine\(st\.notice\)/.test(jsx));
check('the save sentence comes from the model', /setNote\(saveSummary\(res\)\)/.test(jsx));
check('no component holds a token value after sending', !/localStorage|sessionStorage/.test(facts + bar + jsx));

console.warn(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
