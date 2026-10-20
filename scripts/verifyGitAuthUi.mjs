#!/usr/bin/env node
/**
 * verifyGitAuthUi.mjs - what the GitHub token tab says and what it must never do (spec Section 157)
 *
 * The main-process half (`verifyGitAuth.cjs`) proves a token never leaves. This proves the window cannot undo that:
 * the tab holds no stored token, clears the field before the reply, confirms before removing, never claims a
 * fine-grained token "can push", says that only GitHub can revoke, and calls only channels the preload really has.
 *
 * Run: node scripts/verifyGitAuthUi.mjs   (or npm run verify:git-auth-ui)
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

const PAT = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

section('state and headline');
check('nothing known', M.stateOf(null) === 'unknown' && M.stateOf({ ok: false }) === 'unknown' && M.stateOf(undefined) === 'unknown');
check('a stored token', M.stateOf({ ok: true, hasToken: true, vaultUnlocked: true }) === 'has-token');
check('a stored token wins over a locked vault', M.stateOf({ ok: true, hasToken: true, vaultUnlocked: false }) === 'has-token');
check('a locked vault', M.stateOf({ ok: true, hasToken: false, vaultUnlocked: false }) === 'vault-locked');
check('no token', M.stateOf({ ok: true, hasToken: false, vaultUnlocked: true }) === 'no-token');
check('every state has its own sentence', new Set(['has-token', 'vault-locked', 'no-token', 'unknown'].map((s) => M.headline(s === 'has-token' ? { hasToken: true } : s === 'vault-locked' ? { vaultUnlocked: false } : s === 'no-token' ? { vaultUnlocked: true } : null))).size === 4);
check('the no-token sentence says what is used instead', /whatever sign-in this computer already has/.test(M.headline({ vaultUnlocked: true })));

section('details');
check('a credential in a remote is named, hidden, and the fix is named', (() => {
  const d = M.details({ anyCredentialInUrl: true, remotes: [{ name: 'origin', hadCredential: true }, { name: 'up', hadCredential: false }], vaultUnlocked: true });
  return d.length === 1 && /origin/.test(d[0]) && !/up\b/.test(d[0]) && /REMOVE IT FROM THE REMOTE ADDRESS/.test(d[0]);
})());
check('a locked vault says where to unlock it', M.details({ vaultUnlocked: false }).some((d) => /Models > Keys/.test(d)));
check('a remotes error is shown', M.details({ remotesError: 'boom', vaultUnlocked: true }).some((d) => /boom/.test(d)));
check('nothing known gives nothing', M.details(null).length === 0);

section('tokenProblem: a quick check before the round trip');
check('a classic and a fine-grained token pass', M.tokenProblem(PAT) === null && M.tokenProblem('github' + '_pat_' + 'x'.repeat(30)) === null);
check('surrounding whitespace passes', M.tokenProblem(`  ${PAT}\n`) === null);
for (const [n, v] of [['empty', ''], ['spaces', '  '], ['null', null], ['undefined', undefined], ['a number', 7], ['a word', 'hello'], ['a space inside', PAT.slice(0, 10) + ' ' + PAT.slice(10)], ['a URL', 'https://github.com/a/b']]) {
  check(`${n} is a problem`, typeof M.tokenProblem(v) === 'string');
}
check('a problem never repeats what was pasted', !M.tokenProblem('hello ' + PAT).includes(PAT));

section('actions: which buttons');
const has = { ok: true, hasToken: true, vaultUnlocked: true };
const none = { ok: true, hasToken: false, vaultUnlocked: true };
const locked = { ok: true, hasToken: false, vaultUnlocked: false };
let a = M.actions(has, { canWrite: true, canUse: true });
check('master with a token: replace, remove, test', a.save && a.remove && a.test && !a.scrub && a.why === null);
a = M.actions(none, { canWrite: true, canUse: true });
check('master with none: save only', a.save && !a.remove && !a.test);
a = M.actions(locked, { canWrite: true, canUse: true });
check('a locked vault: no save', !a.save && !a.remove);
a = M.actions(has, { canWrite: false, canUse: true });
check('SuperAdmin: test, but no add or remove, and the reason is given', !a.save && !a.remove && a.test && /Master/.test(a.why));
a = M.actions(has, { canWrite: false, canUse: false });
check('someone who cannot push: nothing', !a.save && !a.remove && !a.test && !a.scrub);
a = M.actions({ ...none, anyCredentialInUrl: true }, { canWrite: false, canUse: true });
check('a credentialed remote offers the clean-up to a pusher', a.scrub === true);
a = M.actions({ ...has, anyCredentialInUrl: true }, { canWrite: true, canUse: false });
check('but not to someone who cannot push', a.scrub === false);
check('unknown state offers no save', M.actions(null, { canWrite: true, canUse: true }).save === false);
check('truthy-but-not-true flags are normalised to booleans', typeof M.actions(has, { canWrite: 'yes', canUse: 1 }).save === 'boolean');

section('testSummary: honest');
const fine = M.testSummary({ ok: true, login: 'k', kind: 'fine-grained', repo: { slug: 'a/b', visible: true, canPush: null }, note: 'The first push is the real test.' }).join(' ');
check('a fine-grained token: identified, visible, and no claim it can write', /fine-grained/.test(fine) && /can see a\/b/.test(fine) && !/write access/.test(fine) && /first push/.test(fine));
const classic = M.testSummary({ ok: true, login: 'k', kind: 'classic', repo: { slug: 'a/b', visible: true, canPush: true } }).join(' ');
check('a classic token with write access says so', /classic/.test(classic) && /write access/.test(classic) && !/NO write/.test(classic));
const nopush = M.testSummary({ ok: true, login: 'k', kind: 'classic', repo: { slug: 'a/b', visible: true, canPush: false } }).join(' ');
check('a classic token without it says a push will be refused', /NO write access/.test(nopush));
const hidden = M.testSummary({ ok: true, login: 'k', kind: 'classic', repo: { slug: 'a/b', visible: false, canPush: null } }).join(' ');
check('a repository it cannot see is said plainly', /cannot see a\/b/.test(hidden));
check('a failure is its message', M.testSummary({ ok: false, error: 'GitHub rejected this token' })[0] === 'GitHub rejected this token');
check('a failure with no message still says something', M.testSummary({ ok: false })[0].length > 0);
check('no answer says so', /No answer/.test(M.testSummary(null)[0]));
check('an unnamed account does not print "undefined"', !/undefined/.test(M.testSummary({ ok: true, kind: 'classic' }).join(' ')));

section('scrubSummary and the revoke note');
check('one remote cleaned', /Removed the credential from the remote: origin/.test(M.scrubSummary({ ok: true, changed: ['origin'] })));
check('two remotes cleaned', /from 2 remotes: a, b/.test(M.scrubSummary({ ok: true, changed: ['a', 'b'] })));
check('nothing to clean', M.scrubSummary({ ok: true, changed: [] }) === 'No remote carried a credential.');
check('a failure is its message', M.scrubSummary({ ok: false, error: 'nope' }) === 'nope');
check('a clean-up reminds that only GitHub can revoke', /only GitHub can/.test(M.scrubSummary({ ok: true, changed: ['origin'] })));
check('the revoke note names the page', M.REVOKE_NOTE.includes('github.com/settings/tokens') && /only GitHub can/.test(M.REVOKE_NOTE));
check('the how-to says where the token is kept and where it is not', M.HOW_TO.some((t) => /vault/.test(t)) && M.HOW_TO.some((t) => /never written into the remote address/.test(t)));
check('the how-to names the fine-grained permission that push needs', M.HOW_TO.some((t) => /Contents: Read and write/.test(t)));

section('the component');
const jsx = read('src/pages/GitSync/GitCredential.jsx');
const model = read('src/pages/GitSync/gitCredentialModel.js');
const sync = read('src/pages/GitSync/GitSync.jsx');
const preload = read('electron/preload.cjs');
check('the token field is a password field', /<input[^>]*type="password"/.test(jsx));
check('browser autofill and spellcheck are off for it', /autoComplete="new-password"/.test(jsx) && /spellCheck=\{false\}/.test(jsx));
check('the field is cleared BEFORE the reply is awaited', (() => {
  const i = jsx.indexOf('setToken(\'\')');
  const j = jsx.indexOf('await window.rama.gitAuth.set');
  return i > 0 && j > 0 && i < j;
})());
check('the token is held in no store, no storage and no log', !/localStorage|sessionStorage|useUserStore\(\)\.[a-z]*[tT]oken|console\./.test(jsx + model));
check('the model holds no token value', !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(model + jsx));
check('removing asks first', /window\.confirm\([^)]*Remove the stored GitHub token/.test(jsx));
check('replacing a token GitHub could not confirm asks before it replaces anything (Section 160)',
  /res\?\.needsConfirm/.test(jsx) && /window\.confirm\(`\$\{res\.error\}/.test(jsx) && /gitAuth\.set\(sent, true\)/.test(jsx));
check('and saying no changes nothing, and says so', /Nothing was changed/.test(jsx));
check('the forced retry uses the value already sent, never new state', !/useState\([^)]*sent/.test(jsx) && (jsx.match(/gitAuth\.set\(sent/g) || []).length === 2);
check('the window does not re-decide which states are serious: it obeys the notice', /st\.notice\.persistent \? 'var\(--red\)'/.test(jsx) && !/\['expired', 'rejected', 'unverified'\]/.test(jsx));
check('the confirm comes before the call', jsx.indexOf('window.confirm') < jsx.indexOf('window.rama.gitAuth.remove'));
check('no timers', !/setTimeout|setInterval/.test(jsx));
check('save goes through the quick check first', jsx.indexOf('tokenProblem(token)') > 0 && jsx.indexOf('tokenProblem(token)') < jsx.indexOf('window.rama.gitAuth.set'));
check('buttons come from the model, and are disabled while busy', /actions\(st, \{ canWrite, canUse \}\)/.test(jsx) && (jsx.match(/disabled=\{busy/g) || []).length >= 4);
check('errors are announced (role=alert) and status is polite (role=status)', /role="alert"/.test(jsx) && /role="status"/.test(jsx));
check('the capability checks are vault.write and git.push', /canDo\('vault\.write'\)/.test(jsx) && /canDo\('git\.push'\)/.test(jsx));
const used = [...new Set([...jsx.matchAll(/window\.rama\.gitAuth\.(\w+)/g)].map((m) => m[1]))].sort();
check('it calls status, set, remove, test, scrub and nothing else', used.join() === 'remove,scrub,set,status,test', used.join());
check('every channel it calls exists in the preload', used.every((c) => preload.includes(`'gitAuth:${c}'`)));
check('the preload sends nothing but what the tab passes (no user object)', !/gitAuth:\s*\{[^}]*user/.test(preload));
check('the tab is wired into GitSync', /import GitCredential from '\.\/GitCredential\.jsx'/.test(sync) && /'token'/.test(sync) && /<GitCredential repoPath=\{repoPath\}/.test(sync));
check('and passes the open repository', /tab === 'token' && <GitCredential repoPath=\{repoPath\}/.test(sync));

console.warn(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
