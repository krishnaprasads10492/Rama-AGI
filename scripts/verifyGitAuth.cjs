'use strict';
/**
 * verifyGitAuth.cjs - the GitHub token lives in the vault, is added from the UI, and is never in a URL (Section 157)
 *
 * No GitHub, no vault file: the vault, the HTTP client and simple-git are stubs; a real throwaway repository is used
 * for the pieces that must be proven against real git (remote listing, remote rewriting, the one-shot header).
 *
 *   NEVER IN A URL        a remote that carries a credential is reported without it and rewritten without it
 *   NEVER IN A REPLY      the token appears in no reply, error or redacted string, whatever git or GitHub say
 *   ONE-SHOT, ONE HOST    the header is handed to a single command, scoped to github.com, helper off
 *   THE GATE              status/test/scrub need git.push (tier 1); set/remove need vault.write (master)
 *   HONEST                a fine-grained token is never called "can push"
 *
 * Run: node scripts/verifyGitAuth.cjs   (or npm run verify:git-auth)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; } });
const ga = require(path.join(ROOT, 'electron/lib/gitAuth.cjs'));
const principalBinding = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));
const ipc = require(path.join(ROOT, 'electron/ipc/gitAuth.cjs'));
const gitIpc = require(path.join(ROOT, 'electron/ipc/git.cjs'));
const { simpleGit } = require('simple-git');

// Public-shape dummies, built by concatenation so the secret scan has nothing to flag.
const PAT = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const FINE = 'github' + '_pat_' + '11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
const OTHER = 'gh' + 'p_' + 'ZZZZ9999yyyy8888xxxx7777wwww6666vvvv';
const b64 = (t) => Buffer.from('x-access-token:' + t, 'utf8').toString('base64');

(async () => {
  console.warn('\ngitAuth - the token in the vault, never in a URL\n');

  // ═══ shapes ════════════════════════════════════════════════════════════════════════════════════
  section('validateToken');
  check('a classic token is accepted', ga.validateToken(PAT).ok && ga.validateToken(PAT).kind === 'classic');
  check('a fine-grained token is accepted', ga.validateToken(FINE).ok && ga.validateToken(FINE).kind === 'fine-grained');
  check('surrounding whitespace is trimmed', ga.validateToken('  ' + PAT + '\n').token === PAT);
  for (const [name, v] of [['empty', ''], ['spaces only', '   '], ['null', null], ['undefined', undefined], ['a number', 42], ['an object', { a: 1 }], ['a word', 'hello'],
    ['too short', 'gh' + 'p_abc'], ['a space inside', PAT.slice(0, 20) + ' ' + PAT.slice(20)], ['a line break inside', PAT.slice(0, 20) + '\n' + PAT.slice(20)],
    ['wrong prefix', 'xyz_' + 'A'.repeat(40)], ['a URL', 'https://github.com/a/b'], ['a token inside a URL', 'https://x:' + PAT + '@github.com/a/b']]) {
    const r = ga.validateToken(v);
    check(`${name} is refused`, r.ok === false && typeof r.error === 'string' && !('token' in r));
  }
  check('a token with a break in it is told so, not just "does not look like"', /spaces or line breaks/.test(ga.validateToken(PAT.slice(0, 20) + '\n' + PAT.slice(20)).error));
  check('a refusal never repeats what was pasted', !JSON.stringify(ga.validateToken('hello ' + PAT)).includes(PAT));

  section('redact / scrubUrl / hasCredential');
  const urlWith = 'https://' + PAT + '@github.com/krishnaprasads10492/Rama-AGI.git';
  const urlUserPass = 'https://x-access-token:' + PAT + '@github.com/a/b.git';
  check('redact removes a bare classic token', !ga.redact('failed with ' + PAT + ' now').includes(PAT));
  check('redact removes a fine-grained token', !ga.redact('bad ' + FINE).includes('11ABCDEFG0'));
  check('redact removes URL credentials', !ga.redact(urlWith).includes(PAT) && !ga.redact(urlUserPass).includes(PAT) && ga.redact(urlUserPass).includes('github.com/a/b.git'));
  check('redact removes a credential that is not a token shape', !ga.redact('fatal: https://bob:hunter2@example.com/x.git').includes('hunter2'));
  check('redact removes every occurrence', ga.redact(`${PAT} ${PAT} ${OTHER}`).split('<token>').length === 4);
  check('redact leaves ordinary text alone', ga.redact('Everything up-to-date at github.com') === 'Everything up-to-date at github.com');
  check('redact passes null and undefined through', ga.redact(null) === null && ga.redact(undefined) === undefined);
  check('redact turns a non-string into text', ga.redact(12) === '12');
  check('scrubUrl drops user and password', !ga.scrubUrl(urlWith).includes(PAT) && ga.scrubUrl(urlWith) === 'https://github.com/krishnaprasads10492/Rama-AGI.git', ga.scrubUrl(urlWith));
  check('scrubUrl leaves a clean URL exactly as it was', ga.scrubUrl('https://github.com/a/b.git') === 'https://github.com/a/b.git');
  check('scrubUrl on an ssh-style address leaves it alone', ga.scrubUrl('git@github.com:a/b.git') === 'git@github.com:a/b.git', ga.scrubUrl('git@github.com:a/b.git'));
  check('scrubUrl on rubbish never throws and never echoes a token', !ga.scrubUrl('not a url ' + PAT).includes(PAT));
  check('scrubUrl of empty/null is a string', ga.scrubUrl('') === '' && ga.scrubUrl(null) === '');
  check('hasCredential sees user:password and token-as-user', ga.hasCredential(urlWith) && ga.hasCredential(urlUserPass));
  check('hasCredential is false for clean URLs and nothing', !ga.hasCredential('https://github.com/a/b.git') && !ga.hasCredential('') && !ga.hasCredential(null));

  section('authConfig');
  const cfg = ga.authConfig(PAT);
  check('two pairs: helper off, one header', cfg.length === 2 && cfg[0] === 'credential.helper=');
  check('the header is scoped to github.com only', cfg[1].startsWith('http.https://github.com/.extraheader=AUTHORIZATION: basic '));
  check('the header is x-access-token basic auth', cfg[1].endsWith(b64(PAT)));
  check('the token itself is not in the config in the clear', !cfg.join('\n').includes(PAT));
  check('nothing is scoped to another host', !/gitlab|bitbucket|example/.test(cfg.join(' ')));

  section('slugOf');
  check('https remote', ga.slugOf('https://github.com/a-b/c.d.git') === 'a-b/c.d');
  check('no .git', ga.slugOf('https://github.com/a/b') === 'a/b');
  check('trailing slash', ga.slugOf('https://github.com/a/b/') === 'a/b');
  check('ssh remote', ga.slugOf('git@github.com:a/b.git') === 'a/b');
  check('a credentialed remote still gives the slug', ga.slugOf(urlWith) === 'krishnaprasads10492/Rama-AGI');
  check('another host gives null', ga.slugOf('https://gitlab.com/a/b.git') === null);
  check('rubbish and empty give null', ga.slugOf('') === null && ga.slugOf(null) === null && ga.slugOf('hello') === null);

  // ═══ the vault, open() ═════════════════════════════════════════════════════════════════════════
  section('open: the token reaches git only when there is one');
  const mkVault = (o = {}) => {
    const store = new Map(o.store || []);
    return {
      store,
      unlocked: o.unlocked !== false,
      isUnlocked() { return this.unlocked; },
      getCredential: (s) => store.get(s) || null,
      setCredentialDirect: (s, v, meta) => { if (o.failSet) return { ok: false, error: 'disk full ' + PAT }; store.set(s, v); store.meta = meta; return { ok: true }; },
      deleteCredentialDirect: (s) => { if (o.failDel) return { ok: false, error: 'locked ' + PAT }; store.delete(s); return { ok: true }; },
    };
  };
  const seen = [];
  const fakeSg = (...a) => { seen.push(a); return { fake: true }; };
  ga.useVault(mkVault({ store: [[ga.SERVICE, PAT]] }));
  ga.open('/r', fakeSg);
  check('with a stored token the client gets the one-shot config', seen[0][0] === '/r' && Array.isArray(seen[0][1].config) && seen[0][1].config[1].endsWith(b64(PAT)));
  seen.length = 0;
  ga.open(null, fakeSg);
  check('simple-git is told the credential-helper switch-off is deliberate (it refuses it otherwise)', seen[0][0].unsafe && seen[0][0].unsafe.allowUnsafeCredentialHelper === true);
  check('a clone (no path) also gets it', seen[0].length === 1 && Array.isArray(seen[0][0].config));
  seen.length = 0;
  ga.useVault(mkVault());
  ga.open('/r', fakeSg);
  check('with no token the call is exactly as before', seen[0].length === 1 && seen[0][0] === '/r');
  seen.length = 0;
  ga.open(null, fakeSg);
  check('and a clone with no token is called with no arguments', seen[0].length === 1 && seen[0][0] === undefined);
  seen.length = 0;
  ga.useVault(mkVault({ unlocked: false, store: [[ga.SERVICE, PAT]] }));
  ga.open('/r', fakeSg);
  check('a locked vault gives no token (git falls back to what it had)', seen[0].length === 1 && ga.storedToken() === null);
  ga.useVault({ isUnlocked: () => true, getCredential: () => 42 });
  check('a non-string stored value is not a token', ga.storedToken() === null);
  ga.useVault({ isUnlocked: () => true, getCredential: () => '' });
  check('an empty stored value is not a token', ga.storedToken() === null);

  // ═══ real git ══════════════════════════════════════════════════════════════════════════════════
  section('real git: remotes, the one-shot header');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-gitauth-'));
  const sh = (args) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe' }).toString();
  let realGit = true;
  try {
    sh(['init', '-q']);
    sh(['remote', 'add', 'origin', urlWith]);
    sh(['remote', 'add', 'clean', 'https://github.com/a/b.git']);
    sh(['remote', 'add', 'split', 'https://github.com/a/c.git']);
    sh(['remote', 'set-url', '--push', 'split', urlUserPass]);
  } catch (err) { realGit = false; check('git is available for the real-repository checks', false, String(err.message).slice(0, 80)); }
  if (realGit) {
    const r = ga.describeRemotes(await simpleGit(tmp).getRemotes(true));
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    check('describeRemotes flags exactly the credentialed remotes', byName.origin.hadCredential && !byName.clean.hadCredential && byName.split.hadCredential);
    check('and returns none of the credential', !JSON.stringify(r).includes(PAT));
    check('a push-only credential is caught too', byName.split.hadCredential && !byName.split.fetch.includes('@'));

    const res = await ga.scrubRemotes(simpleGit(tmp));
    check('scrubRemotes returns names only', res.ok && res.changed.slice().sort().join() === 'origin,split' && !JSON.stringify(res).includes(PAT), JSON.stringify(res));
    const after = execFileSync('git', ['config', '--get-regexp', '^remote\\..*url$'], { cwd: tmp }).toString();
    check('no remote carries a credential afterwards', !after.includes(PAT) && !/:\/\/[^\/\s]*@/.test(after));
    check('the clean remote was not touched', after.includes('remote.clean.url https://github.com/a/b.git'));
    check('the addresses are otherwise intact', after.includes('remote.origin.url https://github.com/krishnaprasads10492/Rama-AGI.git') && after.includes('remote.split.url https://github.com/a/c.git'));
    const again = await ga.scrubRemotes(simpleGit(tmp));
    check('a second scrub changes nothing', again.ok && again.changed.length === 0);
    check('the config file itself no longer holds the token', !fs.readFileSync(path.join(tmp, '.git', 'config'), 'utf8').includes(PAT));

    // The one-shot header, proven against real git: it is visible to the command it is for and written nowhere.
    ga.useVault(mkVault({ store: [[ga.SERVICE, PAT]] }));
    const withTok = ga.open(tmp, simpleGit);
    const seenHeader = (await withTok.raw(['config', '--get', 'http.https://github.com/.extraheader'])).trim();
    check('git sees the header for github.com on that command', seenHeader === 'AUTHORIZATION: basic ' + b64(PAT));
    const helper = await withTok.raw(['config', '--get-all', 'credential.helper']).catch(() => '');
    // An empty value is last in the list: git reads it as "forget every helper configured before this".
    check('and the credential helper is switched off for it (the last value is the empty reset)', helper.replace(/\r?\n$/, '').split(/\r?\n/).pop() === '', JSON.stringify(helper));
    const plain = simpleGit(tmp);
    const none = await plain.raw(['config', '--get', 'http.https://github.com/.extraheader']).catch(() => '');
    check('a plain client afterwards sees no header', none.trim() === '');
    check('nothing was written to the repository config', !fs.readFileSync(path.join(tmp, '.git', 'config'), 'utf8').includes(b64(PAT)));

    // git:get-remotes through the real handler
    const handlers = new Map();
    gitIpc.register({ handle: (ch, fn) => handlers.set(ch, fn) });
    sh(['remote', 'set-url', 'origin', urlWith]);
    const rep = await handlers.get('git:get-remotes')({}, { user: { tier: 0 }, repoPath: tmp });
    check('git:get-remotes answers with no credential in it', rep.ok && !JSON.stringify(rep).includes(PAT) && !/:\/\/[^\/\s"]*@/.test(JSON.stringify(rep)), JSON.stringify(rep).slice(0, 120));
    check('and says which remote had one', rep.data.find((x) => x.name === 'origin').hadCredential === true);
    check('the old reply shape is kept (name, refs.fetch, refs.push)', rep.data.every((x) => x.name && x.refs && 'fetch' in x.refs && 'push' in x.refs));
    const bad = await handlers.get('git:get-remotes')({}, { user: { tier: 0 }, repoPath: path.join(tmp, 'nope-' + PAT) });
    check('an error reply is redacted too', bad.ok === false && !JSON.stringify(bad).includes(PAT), JSON.stringify(bad).slice(0, 120));
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir cleanup is best effort */ }

  // scrubRemotes against a fake that records exactly what it is told to run
  section('scrubRemotes: only what needs it');
  const ran = [];
  const fake = { getRemotes: async () => [{ name: 'a', refs: { fetch: urlWith, push: urlWith } }, { name: 'b', refs: { fetch: 'https://github.com/x/y.git', push: 'https://github.com/x/y.git' } }], remote: async (args) => { ran.push(args); } };
  const fr = await ga.scrubRemotes(fake);
  check('one set-url for the one credentialed remote', ran.length === 1 && ran[0][0] === 'set-url' && ran[0][1] === 'a' && !ran[0][2].includes(PAT));
  check('the clean remote is not touched', fr.changed.join() === 'a');

  // ═══ probe ═════════════════════════════════════════════════════════════════════════════════════
  section('probe: what GitHub says, said honestly');
  const gh = (script) => {
    const calls = [];
    return { calls, request: async (url, o) => { calls.push({ url, headers: o.headers, expectStatuses: o.expectStatuses }); const r = script(url); if (r instanceof Error) throw r; return { ok: r.status >= 200 && r.status < 400, status: r.status, body: JSON.stringify(r.json || {}), headers: r.headers || {} }; } };
  };
  const classicHttp = gh((u) => (u.endsWith('/user') ? { status: 200, json: { login: 'krishna' }, headers: { 'x-oauth-scopes': 'repo, workflow' } } : { status: 200, json: { permissions: { push: true } } }));
  const pc = await ga.probe(classicHttp, PAT, 'a/b');
  check('a classic token with a visible repository can push', pc.ok && pc.kind === 'classic' && pc.repo.visible && pc.repo.canPush === true);
  check('the login and scopes come back', pc.login === 'krishna' && pc.scopes.join() === 'repo,workflow');
  check('repo + workflow is not "broad"', pc.broad === false && pc.note === null);
  check('the token is sent as a bearer header, only to api.github.com', classicHttp.calls.every((c) => c.url.startsWith('https://api.github.com/') && c.headers.Authorization === 'Bearer ' + PAT));
  check('the reply carries no token', !JSON.stringify(pc).includes(PAT));

  const broadHttp = gh((u) => (u.endsWith('/user') ? { status: 200, json: { login: 'k' }, headers: { 'x-oauth-scopes': 'repo, admin:org, delete_repo' } } : { status: 200, json: { permissions: { push: true } } }));
  const pb = await ga.probe(broadHttp, PAT, null);
  check('admin and delete scopes are flagged as broad', pb.broad === true && /broad/i.test(pb.note));
  check('with no slug there is no repo answer', !('repo' in pb));

  const fineHttp = gh((u) => (u.endsWith('/user') ? { status: 200, json: { login: 'k' }, headers: {} } : { status: 200, json: { permissions: { push: true } } }));
  const pf = await ga.probe(fineHttp, FINE, 'a/b');
  check('a fine-grained token is recognised', pf.ok && pf.kind === 'fine-grained' && pf.scopes === null);
  check('and is NEVER called "can push", even when GitHub says push:true', pf.repo.visible === true && pf.repo.canPush === null);
  check('it says the first push is the real test', /first push/i.test(pf.note) && /Contents/.test(pf.note));

  const hidden = await ga.probe(gh((u) => (u.endsWith('/user') ? { status: 200, json: { login: 'k' }, headers: { 'x-oauth-scopes': 'repo' } } : { status: 404, json: { message: 'Not Found' } })), PAT, 'a/b');
  check('a repository the token cannot see is not visible and not pushable', hidden.repo.visible === false && hidden.repo.canPush === null);
  const rej = await ga.probe(gh(() => ({ status: 401, json: { message: 'Bad credentials' } })), PAT, 'a/b');
  check('401 is "rejected"', rej.ok === false && rej.rejected === true && /revoked|expired|mistyped/.test(rej.error));
  const e500 = await ga.probe(gh(() => ({ status: 500, json: {} })), PAT, null);
  check('another error status is reported, not "rejected"', e500.ok === false && !e500.rejected && /500/.test(e500.error));
  const down = await ga.probe(gh(() => new Error('connect ECONNREFUSED ' + urlWith)), PAT, null);
  check('a network failure is reported and redacted', down.ok === false && /could not be reached/.test(down.error) && !JSON.stringify(down).includes(PAT));
  const junk = await ga.probe({ request: async () => ({ ok: true, status: 200, body: '<html>', headers: { 'x-oauth-scopes': '' } }) }, PAT, null);
  check('a body that is not JSON does not throw', junk.ok === true && junk.login === '');
  const nothing = await ga.probe({ request: async () => null }, PAT, null);
  check('a null reply is treated as rejected, not a crash', nothing.ok === false);

  section('probe: asked once, and "not asked" said as such (Section 160)');
  check('the client is told which statuses are correct answers, so the breaker does not count them',
    classicHttp.calls.length === 2
    && String(classicHttp.calls[0].expectStatuses) === '401'
    && String(classicHttp.calls[1].expectStatuses) === '401,404',
    JSON.stringify(classicHttp.calls.map((c) => c.expectStatuses)));

  // BOTH REQUESTS ARE IN FLIGHT TOGETHER, proven by making the first one unable to finish until the second has
  // been made: a sequential probe cannot get past the gate and the race below times out.
  let releaseUser = null;
  const userGate = new Promise((r) => { releaseUser = r; });
  let repoSeen = false;
  const together = {
    calls: [],
    request: async (url) => {
      together.calls.push(url);
      if (url.endsWith('/user')) { await userGate; return { ok: true, status: 200, body: JSON.stringify({ login: 'k' }), headers: { 'x-oauth-scopes': 'repo' } }; }
      repoSeen = true;
      releaseUser();
      return { ok: true, status: 200, body: JSON.stringify({ permissions: { push: true } }), headers: {} };
    },
  };
  let timer = null;
  const raced = await Promise.race([
    ga.probe(together, PAT, 'a/b'),
    new Promise((r) => { timer = setTimeout(() => r('SEQUENTIAL'), 4000); }),
  ]);
  clearTimeout(timer);
  check('the two calls are issued together, not one after the other', raced !== 'SEQUENTIAL' && repoSeen && raced.ok === true, String(raced === 'SEQUENTIAL' ? 'timed out' : 'ok'));
  check('and the answer is the same as before', raced !== 'SEQUENTIAL' && raced.login === 'k' && raced.repo.visible === true && raced.repo.canPush === true);

  const notAsked = { calls: [], request: async (url) => { notAsked.calls.push(url); return { ok: false, status: 503, circuitOpen: true, error: 'Circuit open for https://api.github.com' }; } };
  const na = await ga.probe(notAsked, PAT, 'a/b');
  check('a breaker that refused locally is reported as NOT ASKED, not as an answer', na.ok === false && na.notAsked === true && !na.rejected);
  check('and it says what to do, in words, without a status code', /not asked/i.test(na.error) && /twenty seconds/i.test(na.error) && !/503/.test(na.error));
  check('"not asked" is never confused with "rejected"', na.rejected === undefined);

  const dead = { calls: [] };
  dead.request = async (url) => {
    dead.calls.push(url);
    return url.endsWith('/user')
      ? { ok: false, status: 401, body: '{}', headers: {} }
      : { ok: false, status: 404, body: '{}', headers: {} };
  };
  let repoDone = false;
  dead.request = async (url) => {
    dead.calls.push(url);
    if (url.endsWith('/user')) return { ok: false, status: 401, body: '{}', headers: {} };
    await new Promise((r) => setImmediate(r));
    repoDone = true;                                      // set only after the reply, so an un-awaited call shows
    return { ok: false, status: 404, body: '{}', headers: {} };
  };
  const rejBoth = await ga.probe(dead, PAT, 'a/b');
  check('a rejected token is still rejected when both calls went out', rejBoth.ok === false && rejBoth.rejected === true);
  check('and the second call is FINISHED before the answer is given: no work left running', dead.calls.length === 2 && repoDone === true);
  const thrower = { request: async (url) => { if (url.endsWith('/user')) throw new Error('connect ETIMEDOUT ' + PAT); return { ok: false, status: 404, body: '{}', headers: {} }; } };
  const thrown = await ga.probe(thrower, PAT, 'a/b');
  check('a thrown user call is reported, redacted, with the repository call still awaited', thrown.ok === false && /could not be reached/.test(thrown.error) && !JSON.stringify(thrown).includes(PAT));
  const halfDown = { request: async (url) => { if (url.endsWith('/user')) return { ok: true, status: 200, body: JSON.stringify({ login: 'k' }), headers: { 'x-oauth-scopes': 'repo' } }; throw new Error('repo call died'); } };
  const half = await ga.probe(halfDown, PAT, 'a/b');
  check('a repository call that throws leaves the token answer intact and the repo unknown', half.ok === true && half.repo.visible === false && half.repo.canPush === null);

  // ═══ the IPC ═══════════════════════════════════════════════════════════════════════════════════
  section('the gate');
  const handlers = new Map();
  const vault = mkVault();
  const probeHttp = gh((u) => (u.endsWith('/user') ? { status: 200, json: { login: 'krishna' }, headers: { 'x-oauth-scopes': 'repo' } } : { status: 200, json: { permissions: { push: true } } }));
  const sgCalls = [];
  const stubGit = (rp) => ({
    getRemotes: async () => { sgCalls.push(['getRemotes', rp]); return [{ name: 'origin', refs: { fetch: urlWith, push: urlWith } }]; },
    remote: async (a) => { sgCalls.push(['remote', ...a]); },
  });
  const records = new Map();
  const fakeStore = { get: (dom, key) => records.get(dom + '/' + key) || null, set: (dom, key, v) => { records.set(dom + '/' + key, v); } };
  ipc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { vault, http: probeHttp, simpleGit: stubGit, store: fakeStore, now: () => Date.parse('2026-10-20T10:00:00Z') });
  check('seven channels', handlers.size === 7 && ['status', 'set', 'remove', 'test', 'scrub', 'expiry', 'set-expiry'].every((c) => handlers.has('gitAuth:' + c)), [...handlers.keys()].join());
  const pOf = {};
  principalBinding.useAuth({
    validateSession: (tok) => (pOf[tok] ? { userId: pOf[tok].userId } : null),
    findById: (uid) => Object.values(pOf).find((u) => u.userId === uid) || null,
    publicUser: (u) => ({ ...u, id: u.userId }),
  });
  const mk = (wid, tok, acct) => { pOf[tok] = { userId: 'acct-' + tok, username: tok, ...acct }; principalBinding.bind({ id: wid }, tok, 'fp'); return { sender: { id: wid } }; };
  const W = { master: mk(701, 'm', { tier: 0 }), sa: mk(702, 's', { tier: 1 }), admin: mk(703, 'a', { tier: 2 }), operator: mk(704, 'o', { tier: 3 }), viewer: mk(705, 'v', { tier: 4 }), guest: mk(706, 'g', { tier: 5 }) };
  const nobody = { sender: { id: 999 } };
  const call = (ch, win, body) => handlers.get('gitAuth:' + ch)(win, body);
  const everything = [];
  const keep = (r) => { everything.push(r); return r; };

  for (const [who, win] of Object.entries({ anonymous: nobody, guest: W.guest, viewer: W.viewer, operator: W.operator, admin: W.admin })) {
    for (const ch of ['status', 'set', 'remove', 'test', 'scrub', 'expiry', 'set-expiry']) {
      const r = keep(await call(ch, win, { token: PAT, repoPath: '/r', date: '2027-01-01' }));
      check(`${who} is refused ${ch}`, r.ok === false && !('hasToken' in r) && !('changed' in r));
    }
  }
  check('nothing was stored, and no git or GitHub call was made, for any refused caller', vault.store.size === 0 && probeHttp.calls.length === 0 && sgCalls.length === 0);
  for (const ch of ['set', 'remove']) {
    const r = keep(await call(ch, W.sa, { token: PAT }));
    check(`a SuperAdmin (tier 1) is refused ${ch}: it is a vault write`, r.ok === false && vault.store.size === 0);
  }
  const forged = await call('set', W.guest, { user: { tier: 0 }, token: PAT });
  check('a guest claiming tier 0 in the payload is still refused', forged.ok === false && vault.store.size === 0);

  section('set / remove / status / test / scrub');
  vault.unlocked = false;
  const locked = keep(await call('set', W.master, { token: PAT }));
  check('a locked vault refuses set and says what to do', locked.ok === false && /unlock/i.test(locked.error) && vault.store.size === 0);
  const lockedRm = keep(await call('remove', W.master, {}));
  check('and refuses remove', lockedRm.ok === false && /unlock/i.test(lockedRm.error));
  const lockedStatus = keep(await call('status', W.sa, {}));
  check('status still answers, saying the vault is locked', lockedStatus.ok && lockedStatus.vaultUnlocked === false && lockedStatus.hasToken === false);
  vault.unlocked = true;

  const bad1 = keep(await call('set', W.master, { token: 'hello' }));
  check('a malformed token is refused and not stored', bad1.ok === false && vault.store.size === 0);
  const bad2 = keep(await call('set', W.master, {}));
  check('no token is refused', bad2.ok === false && vault.store.size === 0);
  const bad3 = keep(await call('set', W.master, undefined));
  check('no body at all is refused', bad3.ok === false);
  const okSet = keep(await call('set', W.master, { token: '  ' + PAT + ' ' }));
  check('master stores a valid token', okSet.ok && okSet.hasToken === true && okSet.kind === 'classic');
  check('it is stored under GITHUB_TOKEN, trimmed', vault.store.get('GITHUB_TOKEN') === PAT);
  check('the reply does not contain the token', !JSON.stringify(okSet).includes(PAT));

  const st = keep(await call('status', W.sa, { repoPath: '/r' }));
  check('status: stored, unlocked, one remote with a credential flagged', st.ok && st.hasToken && st.vaultUnlocked && st.anyCredentialInUrl === true && st.remotes.length === 1 && st.remotes[0].hadCredential === true);
  check('status: the remote is shown without it', !JSON.stringify(st).includes(PAT) && st.remotes[0].fetch === 'https://github.com/krishnaprasads10492/Rama-AGI.git');
  const st0 = keep(await call('status', W.sa, {}));
  check('status with no repository still answers', st0.ok && st0.hasToken && st0.remotes.length === 0 && st0.anyCredentialInUrl === false);

  const t1 = keep(await call('test', W.sa, { repoPath: '/r' }));
  check('test asks GitHub as the stored token and finds the repository', t1.ok && t1.login === 'krishna' && t1.repo && t1.repo.slug === 'krishnaprasads10492/Rama-AGI' && t1.repo.visible);
  check('test sent the stored token to api.github.com only', probeHttp.calls.length === 3 && probeHttp.calls.every((c) => c.url.startsWith('https://api.github.com/') && c.headers.Authorization === 'Bearer ' + PAT));
  check('test reply carries no token', !JSON.stringify(t1).includes(PAT));

  const sc = keep(await call('scrub', W.sa, { repoPath: '/r' }));
  check('scrub rewrites the credentialed remote and returns its name', sc.ok && sc.changed.join() === 'origin' && sgCalls.some((c) => c[0] === 'remote' && c[1] === 'set-url' && c[2] === 'origin' && !c[3].includes(PAT)));
  check('scrub says to revoke at GitHub, since only GitHub can', /github\.com\/settings\/tokens/.test(sc.note) && /only GitHub can/.test(sc.note));
  const scNone = keep(await call('scrub', W.sa, {}));
  check('scrub with no repository is refused', scNone.ok === false);

  const rm = keep(await call('remove', W.master, {}));
  check('master removes it', rm.ok && rm.hasToken === false && vault.store.size === 0);
  const t2 = keep(await call('test', W.sa, { repoPath: '/r' }));
  check('test with nothing stored says so and makes no GitHub call', t2.ok === false && /No token/.test(t2.error) && probeHttp.calls.length === 3);
  const st2 = keep(await call('status', W.sa, {}));
  check('status afterwards: no token', st2.hasToken === false);

  section('a token GitHub could not confirm never displaces one that works (Section 160)');
  // THIS WAS REPRODUCED BEFORE IT WAS FIXED: with the breaker open, `set` stored an unconfirmed token over a
  // working one and wiped the record of it, while telling master "GitHub answered 503".
  {
    const GOOD = 'gh' + 'p_' + 'G'.repeat(36);
    const recs = new Map();
    const store2 = { get: (dom, key) => recs.get(dom + '/' + key) || null, set: (dom, key, v) => { recs.set(dom + '/' + key, v); } };
    const vault2 = (() => { const mm = new Map(); return { mm, isUnlocked: () => true, getCredential: (s) => mm.get(s) || null, setCredentialDirect: (s, v) => { mm.set(s, v); return { ok: true }; }, deleteCredentialDirect: (s) => { mm.delete(s); return { ok: true }; } }; })();
    const silent = { request: async () => ({ ok: false, status: 503, circuitOpen: true, error: 'Circuit open for https://api.github.com' }) };
    const hh = new Map();
    ipc.register({ handle: (ch, fn) => hh.set(ch, fn) }, { vault: vault2, http: silent, simpleGit: () => ({ getRemotes: async () => [] }), store: store2, now: () => 5000 });
    const setIt = (body) => hh.get('gitAuth:set')(W.master, body);

    const firstOffline = keep(await setIt({ token: GOOD }));
    check('the FIRST token still stores with GitHub unreachable, marked unconfirmed', firstOffline.ok === true && firstOffline.verified === false && vault2.mm.get('GITHUB_TOKEN') === GOOD);
    check('and no confirmation was demanded for it (there was nothing to lose)', !firstOffline.needsConfirm);

    recs.set('config/githubToken', { kind: 'classic', login: 'k', savedAt: 1, expiresAt: 9e15, expirySource: 'github', verifiedAt: 2, rejectedAt: null });
    const replace = keep(await setIt({ token: PAT }));
    check('REPLACING it unconfirmed is refused, and asks master instead', replace.ok === false && replace.needsConfirm === true);
    check('the token that works is still the one stored', vault2.mm.get('GITHUB_TOKEN') === GOOD);
    check('and what was known about it was not wiped', recs.get('config/githubToken').verifiedAt === 2 && recs.get('config/githubToken').expirySource === 'github');
    check('the refusal explains itself without a status code or a token', /could not confirm/.test(replace.error) && /already stored/.test(replace.error) && !JSON.stringify(replace).includes(PAT) && !JSON.stringify(replace).includes(GOOD));
    check('a forged confirmation in the payload is the only way through, and it is master\'s to give', (await setIt({ token: PAT, force: 'yes' })).needsConfirm === true && vault2.mm.get('GITHUB_TOKEN') === GOOD);
    const forced = keep(await setIt({ token: PAT, force: true }));
    check('with master\'s confirmation it is stored, and still called unconfirmed', forced.ok === true && forced.verified === false && vault2.mm.get('GITHUB_TOKEN') === PAT);
    check('a token GitHub REFUSES is still never stored, confirmation or not', await (async () => {
      const reject = { request: async () => ({ ok: false, status: 401, body: '{}', headers: {} }) };
      const h2 = new Map();
      ipc.register({ handle: (ch, fn) => h2.set(ch, fn) }, { vault: vault2, http: reject, simpleGit: () => ({ getRemotes: async () => [] }), store: store2, now: () => 6000 });
      const r1 = await h2.get('gitAuth:set')(W.master, { token: OTHER, force: true });
      return r1.ok === false && r1.rejected === true && vault2.mm.get('GITHUB_TOKEN') === PAT;
    })());
  }

  section('failures never leak');
  const leakVault = mkVault({ failSet: true });
  const handlers2 = new Map();
  ipc.register({ handle: (ch, fn) => handlers2.set(ch, fn) }, { vault: leakVault, http: probeHttp, simpleGit: stubGit });
  const f1 = keep(await handlers2.get('gitAuth:set')(W.master, { token: PAT }));
  check('a vault failure on set is reported and redacted', f1.ok === false && !JSON.stringify(f1).includes(PAT) && /disk full/.test(f1.error));
  const leakVault2 = mkVault({ failDel: true, store: [[ga.SERVICE, PAT]] });
  const handlers3 = new Map();
  ipc.register({ handle: (ch, fn) => handlers3.set(ch, fn) }, { vault: leakVault2, http: probeHttp, simpleGit: stubGit });
  const f2 = keep(await handlers3.get('gitAuth:remove')(W.master, {}));
  check('a vault failure on remove is reported and redacted', f2.ok === false && !JSON.stringify(f2).includes(PAT));
  const boom = new Map();
  ipc.register({ handle: (ch, fn) => boom.set(ch, fn) }, { vault: mkVault({ store: [[ga.SERVICE, PAT]] }), http: probeHttp, simpleGit: () => ({ getRemotes: async () => { throw new Error('fatal: ' + urlWith); }, remote: async () => { throw new Error('fatal: ' + urlWith); } }) });
  const f3 = keep(await boom.get('gitAuth:scrub')(W.sa, { repoPath: '/r' }));
  check('a git error on scrub is redacted', f3.ok === false && !JSON.stringify(f3).includes(PAT));
  const f4 = keep(await boom.get('gitAuth:status')(W.sa, { repoPath: '/r' }));
  check('a git error on status is redacted and status still answers', f4.ok === true && !JSON.stringify(f4).includes(PAT) && typeof f4.remotesError === 'string');
  check('across every reply this suite saw, the token never appears', !JSON.stringify(everything).includes(PAT));
  principalBinding.useAuth(null);
  principalBinding.reset();
  ga.useVault(null);

  // ═══ source rules ══════════════════════════════════════════════════════════════════════════════
  section('where it is wired, and what it must not do');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const lib = read('electron/lib/gitAuth.cjs');
  const ipcSrc = read('electron/ipc/gitAuth.cjs');
  const gitSrc = read('electron/ipc/git.cjs');
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const release = read('electron/lib/releaseChannel.cjs');
  const propose = read('electron/lib/publishProposal.cjs');
  check('git push, pull and clone go through gitAuth.open', (gitSrc.match(/gitAuth\.open\(/g) || []).length === 3);
  check('releaseChannel and publishProposal push through it too', /gitAuth\.open\(/.test(release) && /gitAuth\.open\(/.test(propose));
  check('every error reply in git.cjs is redacted', !/error:\s*err\.message/.test(gitSrc) && (gitSrc.match(/gitAuth\.redact\(err\.message\)/g) || []).length >= 12);
  check('the gate is the validated principal, never a payload user', /principalBinding\.getPrincipal\(e\)/.test(ipcSrc) && !/\{\s*user\b/.test(ipcSrc));
  check('set, remove and set-expiry are vault.write; expiry is vault.read; status, test and scrub are git.push', (ipcSrc.match(/gated\('vault\.write'/g) || []).length === 3 && (ipcSrc.match(/gated\('vault\.read'/g) || []).length === 1 && (ipcSrc.match(/gated\('git\.push'/g) || []).length === 3);
  check('the token is never written to a URL, file or environment variable', !/writeFileSync|appendFile|process\.env\[|process\.env\./.test(lib + ipcSrc) && !/remote\(\['(add|set-url)'[^)]*token/i.test(lib + ipcSrc));
  check('there is no console.log', !/console\.log/.test(lib + ipcSrc));
  check('the probe tells the client which statuses are expected, so correct answers do not trip the breaker', /expectStatuses/.test(lib) && /\[401\]/.test(lib) && /\[401, 404\]/.test(lib));
  check('both calls are started before either is awaited', lib.indexOf('const repoCall = slug ?') < lib.indexOf('const first = await userCall'));
  check('a replacement is only stored unconfirmed with an explicit force', /body\.force !== true/.test(ipcSrc) && /needsConfirm: true/.test(ipcSrc));
  check('and the window cannot grant it by sending anything truthy', /force: force === true/.test(preload));
  check('the IPC is registered in main.cjs and in the preload', /gitAuthIPC/.test(main) && /Git credential/.test(main) && /gitAuth:\s*\{/.test(preload) && ['status', 'set', 'remove', 'test', 'scrub', 'expiry', 'set-expiry'].every((c) => preload.includes(`'gitAuth:${c}'`)));
  check('the scrub is a click, not a startup action', !/gitAuth\.scrubRemotes|gitAuth:scrub/.test(main));
  check('the header is scoped to one host', /GITHUB_HOST\s*=\s*'https:\/\/github\.com\/'/.test(lib) && /http\.\$\{GITHUB_HOST\}\.extraheader/.test(lib));
  check('the vault service name is GITHUB_TOKEN', lib.includes("SERVICE = 'GITHUB_TOKEN'"));

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
