'use strict';
/**
 * verifyTokenExpiry.cjs - the GitHub token's expiry: read, recorded, judged and announced (spec Section 158)
 *
 * No GitHub, no vault file, no app store: all three are stubs, and the clock is a variable the suite moves.
 *
 *   THE JUDGEMENT   one pure function decides the state; the boundaries are tested at the millisecond
 *   NOT BELIEVED    a header that equals "now" is the known GitHub bug, not an expiry
 *   NOT CLEARED     an expired/refused/unconfirmed token is cleared only by GitHub accepting a token
 *   NOT STORED      a token GitHub rejects never replaces the one that is stored
 *   NO SECRET       the record in the app store holds no token and no encoding of one
 *   THE GATE        the notice is master's: vault.read; a typed date is vault.write
 *
 * Run: node scripts/verifyTokenExpiry.cjs   (or npm run verify:token-expiry)
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
let finished = false;
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; } });
const te = require(path.join(ROOT, 'electron/lib/tokenExpiry.cjs'));
const ga = require(path.join(ROOT, 'electron/lib/gitAuth.cjs'));
const principalBinding = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));
const ipc = require(path.join(ROOT, 'electron/ipc/gitAuth.cjs'));

const PAT = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const PAT2 = 'gh' + 'p_' + 'ZZZZ9999yyyy8888xxxx7777wwww6666vvvv';
const FINE = 'github' + '_pat_' + '11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
const DAY = 86400000;
const NOW = Date.parse('2026-10-20T10:00:00Z');

(async () => {
  console.warn('\ntoken expiry - read, recorded, judged, announced\n');

  // ═══ reading what GitHub says ══════════════════════════════════════════════════════════════════
  section('parseExpiryHeader');
  const P = (v, call = NOW) => te.parseExpiryHeader(v, call);
  check('the documented format (UTC)', P('2026-11-20 14:30:00 UTC').kind === 'known' && P('2026-11-20 14:30:00 UTC').ms === Date.parse('2026-11-20T14:30:00Z'));
  check('with a numeric offset (+0500)', P('2026-11-20 14:30:00 +0500').ms === Date.parse('2026-11-20T09:30:00Z'));
  check('with a colon offset (-05:30)', P('2026-11-20 14:30:00 -05:30').ms === Date.parse('2026-11-20T20:00:00Z'));
  check('ISO with a T and Z', P('2026-11-20T14:30:00Z').ms === Date.parse('2026-11-20T14:30:00Z'));
  check('an array (repeated header) uses the first', P(['2026-11-20 14:30:00 UTC', 'x']).kind === 'known');
  check('surrounding spaces are fine', P('  2026-11-20 14:30:00 UTC  ').kind === 'known');
  for (const [n, v] of [['undefined', undefined], ['null', null], ['empty', ''], ['spaces', '   ']]) check(`${n} is "none"`, P(v).kind === 'none');
  for (const [n, v] of [['words', 'soon'], ['no zone', '2026-11-20 14:30:00'], ['month 13', '2026-13-20 14:30:00 UTC'], ['31 February', '2026-02-31 10:00:00 UTC'], ['a date only', '2026-11-20'], ['a number', 12345], ['an object', {}]]) {
    check(`${n} is unparsable`, P(v).kind === 'unparsable', JSON.stringify(P(v)));
  }
  const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  check('the call time itself is the "current time" bug, not an expiry', P(fmt(NOW)).kind === 'unreliable');
  check('119 s after the call is still unreliable', P(fmt(NOW + 119000)).kind === 'unreliable');
  check('119 s before the call is unreliable too (a clock a little off)', P(fmt(NOW - 119000)).kind === 'unreliable');
  check('three minutes on is believed', P(fmt(NOW + 180000)).kind === 'known');
  for (const bad of ['2026-11-20 24:00:00 UTC', '2026-11-20 10:99:00 UTC', '2026-11-20 10:00:60 UTC', '2026-11-20 99:99:99 UTC']) {
    check(`"${bad}" is refused rather than rolled over`, P(bad).kind === 'unparsable', JSON.stringify(P(bad)));
  }
  check('the last valid second of a day is accepted', P('2026-11-20 23:59:59 UTC').kind === 'known' && P('2026-11-20 23:59:59 UTC').ms === Date.parse('2026-11-20T23:59:59Z'));
  check('without a call time nothing is called unreliable', te.parseExpiryHeader(fmt(NOW), undefined).kind === 'known');

  section('parseManualDate');
  const D = (v) => te.parseManualDate(v, NOW);
  check('a date is taken as the END of that day in UTC', D('2026-11-20').ok && D('2026-11-20').ms === Date.parse('2026-11-20T23:59:59Z'));
  check('surrounding spaces are fine', D(' 2026-11-20 ').ok);
  for (const [n, v] of [['empty', ''], ['null', null], ['a number', 5], ['d/m/y', '20/11/2026'], ['no zero padding', '2026-1-5'], ['a time', '2026-11-20 10:00'], ['30 February', '2026-02-30'], ['month 13', '2026-13-01'], ['day 0', '2026-11-00']]) {
    const r = D(v);
    check(`${n} is refused with a reason`, r.ok === false && typeof r.error === 'string' && r.ms === undefined);
  }
  check('before 2020 is refused', D('2019-12-31').ok === false);
  check('more than ten years away is refused', D('2037-01-01').ok === false);
  check('just under ten years is accepted', D('2036-10-01').ok === true);
  check('a past date is accepted (it records an expired token)', D('2026-01-01').ok === true);

  section('looksLikeAuthFailure');
  for (const t of ['remote: Invalid username or password.', 'fatal: Authentication failed for \'https://github.com/a/b.git/\'', 'remote: Bad credentials', 'HTTP Basic: Access denied', 'Invalid credentials', 'The token has expired', 'token revoked']) {
    check(`"${t.slice(0, 40)}" is a refused credential`, te.looksLikeAuthFailure(t) === true);
  }
  for (const t of ['fatal: unable to access: The requested URL returned error: 403', 'Permission denied', 'rate limit exceeded', 'Everything up-to-date', '', null, undefined]) {
    check(`${JSON.stringify(t)} is not`, te.looksLikeAuthFailure(t) === false);
  }

  // ═══ the record ════════════════════════════════════════════════════════════════════════════════
  section('the record');
  const known = { kind: 'known', ms: NOW + 30 * DAY };
  const sv = (o) => te.recordSaved({ kind: 'classic', login: 'k', parsed: known, verified: true, now: NOW, ...o });
  let r = sv();
  check('a classic token with a header: GitHub is the source', r.expirySource === 'github' && r.expiresAt === NOW + 30 * DAY && r.verifiedAt === NOW && r.rejectedAt === null);
  check('a classic token with NO header: GitHub reports no expiry', sv({ parsed: { kind: 'none' } }).expirySource === 'none' && sv({ parsed: { kind: 'none' } }).expiresAt === null);
  check('a fine-grained token with NO header: nothing was said (unknown, not "none")', sv({ kind: 'fine-grained', parsed: { kind: 'none' } }).expirySource === 'unknown');
  check('an unreliable header is not an expiry', sv({ parsed: { kind: 'unreliable' } }).expirySource === 'unknown' && sv({ parsed: { kind: 'unreliable' } }).expiresAt === null);
  check('an unparsable header is not an expiry', sv({ parsed: { kind: 'unparsable' } }).expirySource === 'unknown');
  check('a missing parse (GitHub unreachable) is unknown', sv({ parsed: null, verified: false }).expirySource === 'unknown' && sv({ parsed: null, verified: false }).verifiedAt === null);
  check('an unverified save has no verifiedAt', sv({ verified: false }).verifiedAt === null);
  check('the kind is one of two words', sv({ kind: 'weird' }).kind === 'fine-grained' && sv().kind === 'classic');
  check('a login that is not text becomes empty', sv({ login: 42 }).login === '');
  check('the record has exactly the documented fields', Object.keys(r).sort().join() === 'expiresAt,expirySource,kind,login,rejectedAt,savedAt,verifiedAt');

  const later = NOW + 5 * DAY;
  let a = te.recordAccepted(r, { kind: 'classic', login: 'k', parsed: { kind: 'known', ms: NOW + 40 * DAY }, now: later });
  check('accepted again: verified now, refusal cleared, GitHub\'s newer date used', a.verifiedAt === later && a.rejectedAt === null && a.expiresAt === NOW + 40 * DAY);
  const refused = te.recordRejected(r, later);
  check('refused: rejectedAt set, nothing else lost', refused.rejectedAt === later && refused.verifiedAt === r.verifiedAt && refused.expiresAt === r.expiresAt);
  a = te.recordAccepted(refused, { kind: 'classic', login: '', parsed: { kind: 'known', ms: r.expiresAt }, now: later + 1000 });
  check('accepted after a refusal clears it', a.rejectedAt === null && a.verifiedAt === later + 1000);
  check('an odd reply (unreliable) keeps what was known', te.recordAccepted(r, { kind: 'classic', parsed: { kind: 'unreliable' }, now: later }).expiresAt === r.expiresAt);
  check('an odd reply (unparsable) keeps what was known', te.recordAccepted(r, { kind: 'classic', parsed: { kind: 'unparsable' }, now: later }).expirySource === 'github');
  check('but "no header" from a CLASSIC token is GitHub saying there is no expiry', te.recordAccepted(r, { kind: 'classic', parsed: { kind: 'none' }, now: later }).expirySource === 'none');
  check('and "no header" from a fine-grained token keeps what was known', te.recordAccepted({ ...r, kind: 'fine-grained' }, { kind: 'fine-grained', parsed: { kind: 'none' }, now: later }).expiresAt === r.expiresAt);
  check('accepted/rejected with no record give null', te.recordAccepted(null, { now: 1 }) === null && te.recordRejected(null, 1) === null);

  const unk = sv({ kind: 'fine-grained', parsed: { kind: 'unreliable' } });
  const m1 = te.recordManual(unk, NOW + 9 * DAY);
  check('a typed date is accepted when GitHub did not report one', m1.ok && m1.record.expirySource === 'manual' && m1.record.expiresAt === NOW + 9 * DAY);
  check('and survives an odd reply from GitHub', te.recordAccepted(m1.record, { kind: 'fine-grained', parsed: { kind: 'unreliable' }, now: later }).expirySource === 'manual');
  check('but GitHub\'s real date overrides it', te.recordAccepted(m1.record, { kind: 'fine-grained', parsed: { kind: 'known', ms: NOW + 60 * DAY }, now: later }).expirySource === 'github');
  check('a typed date over GitHub\'s own is refused', te.recordManual(r, NOW + DAY).ok === false);
  check('a typed date with no record is refused', te.recordManual(null, NOW).ok === false);
  check('a NEW token drops everything about the old one', sv({ parsed: { kind: 'none' } }).expiresAt === null && te.recordSaved({ kind: 'classic', parsed: { kind: 'none' }, verified: true, now: later }).savedAt === later);

  // ═══ the judgement ═════════════════════════════════════════════════════════════════════════════
  section('stateOf: the boundaries');
  const S = (o, now = NOW) => te.stateOf({ kind: 'classic', savedAt: 1, expiresAt: null, expirySource: 'unknown', verifiedAt: 1, rejectedAt: null, ...o }, now);
  check('no record: none', te.stateOf(null, NOW) === 'none' && te.stateOf(undefined, NOW) === 'none' && te.stateOf('x', NOW) === 'none' && te.stateOf(5, NOW) === 'none');
  check('far away: ok', S({ expiresAt: NOW + 15 * DAY }) === 'ok');
  check('exactly 14 days left: expiring', S({ expiresAt: NOW + 14 * DAY }) === 'expiring');
  check('14 days and 1 ms left: ok', S({ expiresAt: NOW + 14 * DAY + 1 }) === 'ok');
  check('1 ms left: expiring', S({ expiresAt: NOW + 1 }) === 'expiring');
  check('at the instant: expired', S({ expiresAt: NOW }) === 'expired');
  check('1 ms past: expired', S({ expiresAt: NOW - 1 }) === 'expired');
  check('expiry zero is a real (long past) date, not "none"', S({ expiresAt: 0 }) === 'expired');
  check('GitHub says no expiry: no-expiry', S({ expirySource: 'none' }) === 'no-expiry');
  check('GitHub said nothing: unknown-expiry', S({ expirySource: 'unknown' }) === 'unknown-expiry');
  check('never confirmed: unverified', S({ verifiedAt: null, expiresAt: NOW + 30 * DAY }) === 'unverified');
  check('expired outranks unverified', S({ verifiedAt: null, expiresAt: NOW - 5 }) === 'expired');
  check('refused outranks everything', S({ rejectedAt: 5, verifiedAt: 1, expiresAt: NOW - 5 }) === 'rejected');
  check('refused at the same instant as verified is still refused', S({ rejectedAt: 7, verifiedAt: 7, expiresAt: NOW + 30 * DAY }) === 'rejected');
  check('verified AFTER the refusal is not refused', S({ rejectedAt: 5, verifiedAt: 9, expiresAt: NOW + 30 * DAY }) === 'ok');
  check('refused and never verified is refused', S({ rejectedAt: 5, verifiedAt: null }) === 'rejected');
  check('expiresAt that is not a number is not an expiry', S({ expiresAt: '2030-01-01' }) === 'unknown-expiry');

  section('noticeOf: what the window is told');
  const N = (o, now = NOW) => te.noticeOf({ kind: 'classic', login: 'k', savedAt: 1, expiresAt: null, expirySource: 'unknown', verifiedAt: 1, rejectedAt: null, ...o }, now);
  const exp = N({ expiresAt: NOW + 3 * DAY, expirySource: 'github' });
  check('expiring: shown, not persistent, hides after 10 seconds', exp.state === 'expiring' && exp.show && !exp.persistent && exp.autoHideMs === 10000);
  for (const [st, o] of [['expired', { expiresAt: NOW - 1 }], ['rejected', { rejectedAt: 9 }], ['unverified', { verifiedAt: null }]]) {
    const n = N(o);
    check(`${st}: shown, persistent, no timer`, n.state === st && n.show && n.persistent && n.autoHideMs === 0);
  }
  for (const [st, o] of [['ok', { expiresAt: NOW + 90 * DAY }], ['no-expiry', { expirySource: 'none' }], ['unknown-expiry', {}]]) {
    const n = N(o);
    check(`${st}: no bar`, n.state === st && !n.show && !n.persistent && n.autoHideMs === 0);
  }
  check('none: no bar and no facts', (() => { const n = te.noticeOf(null, NOW); return n.state === 'none' && !n.show && n.expiresAt === null && n.msLeft === null && n.kind === null; })());
  check('msLeft is the time remaining, negative once expired', exp.msLeft === 3 * DAY && N({ expiresAt: NOW - 1000 }).msLeft === -1000);
  check('the notice names only these fields (no secret can ride along)', Object.keys(exp).sort().join() === 'autoHideMs,expiresAt,expirySource,kind,login,msLeft,persistent,rejectedAt,savedAt,show,state,verifiedAt,warnDays');

  // ═══ through the IPC, with a clock ═════════════════════════════════════════════════════════════
  section('the lifecycle, through the IPC');
  let T = NOW;
  const records = new Map();
  const store = { get: (d, k) => records.get(`${d}/${k}`) || null, set: (d, k, v) => { records.set(`${d}/${k}`, v); } };
  const vault = (() => {
    const m = new Map();
    return { m, unlocked: true, isUnlocked() { return this.unlocked; }, getCredential: (s) => m.get(s) || null, setCredentialDirect: (s, v) => { m.set(s, v); return { ok: true }; }, deleteCredentialDirect: (s) => { m.delete(s); return { ok: true }; } };
  })();
  // GitHub, scripted: `answer` is what /user says next.
  const gh = { answer: null, calls: 0 };
  const http = {
    request: async (url) => {
      gh.calls += 1;
      const a = gh.answer;
      if (a instanceof Error) throw a;
      if (url.endsWith('/user')) return { ok: a.status < 400, status: a.status, body: JSON.stringify({ login: 'krishna' }), headers: a.headers || {} };
      return { ok: true, status: 200, body: JSON.stringify({ permissions: { push: true } }), headers: {} };
    },
  };
  const handlers = new Map();
  ipc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { vault, http, simpleGit: () => ({ getRemotes: async () => [] }), store, now: () => T });
  const pOf = {};
  principalBinding.useAuth({
    validateSession: (tok) => (pOf[tok] ? { userId: pOf[tok].userId } : null),
    findById: (uid) => Object.values(pOf).find((u) => u.userId === uid) || null,
    publicUser: (u) => ({ ...u, id: u.userId }),
  });
  const mk = (wid, tok, acct) => { pOf[tok] = { userId: 'acct-' + tok, username: tok, ...acct }; principalBinding.bind({ id: wid }, tok, 'fp'); return { sender: { id: wid } }; };
  const W = { master: mk(801, 'm', { tier: 0 }), sa: mk(802, 's', { tier: 1 }), admin: mk(803, 'a', { tier: 2 }), operator: mk(804, 'o', { tier: 3 }), viewer: mk(805, 'v', { tier: 4 }), guest: mk(806, 'g', { tier: 5 }) };
  const call = (ch, win, body) => handlers.get('gitAuth:' + ch)(win, body);
  const everything = [];
  const keep = (x) => { everything.push(x); return x; };
  const hdr = (ms) => ({ 'x-oauth-scopes': 'repo', 'github-authentication-token-expiration': fmt(ms) });
  const stateNow = async () => (await call('expiry', W.master, {})).notice;

  const nothing = keep(await call('expiry', W.master, {}));
  check('before any token: state none, no bar', nothing.ok && nothing.notice.state === 'none' && !nothing.notice.show && nothing.stored === false);

  // 1. save a token that expires in 16 days
  gh.answer = { status: 200, headers: hdr(NOW + 16 * DAY) };
  let s1 = keep(await call('set', W.master, { token: PAT }));
  check('saved and confirmed by GitHub', s1.ok && s1.verified === true && s1.unverifiedReason === null && s1.notice.state === 'ok');
  check('GitHub was asked before it was stored', gh.calls === 1);
  check('the token went to the vault', vault.m.get('GITHUB_TOKEN') === PAT);
  const rec1 = records.get('config/githubToken');
  check('the record holds the expiry from GitHub', rec1.expiresAt === NOW + 16 * DAY && rec1.expirySource === 'github' && rec1.kind === 'classic' && rec1.login === 'krishna');
  check('the record holds no token and no encoding of one', !JSON.stringify(rec1).includes(PAT) && !JSON.stringify(rec1).includes(Buffer.from('x-access-token:' + PAT).toString('base64')) && !/gh[pousr]_|github_pat_/.test(JSON.stringify(rec1)));

  // 2. three days later: inside the warning window
  T = NOW + 3 * DAY;
  let n = await stateNow();
  check('13 days left: expiring, shown for 10 seconds, not persistent', n.state === 'expiring' && n.show && !n.persistent && n.autoHideMs === 10000 && n.msLeft === 13 * DAY);
  vault.unlocked = false;
  const locked = keep(await call('expiry', W.master, {}));
  check('with the vault LOCKED the notice still answers (it is not in the vault)', locked.ok && locked.notice.state === 'expiring' && locked.vaultUnlocked === false && locked.stored === null);
  vault.unlocked = true;

  // 3. after the expiry
  T = NOW + 17 * DAY;
  n = await stateNow();
  check('past the date: expired, persistent, no timer', n.state === 'expired' && n.persistent && n.autoHideMs === 0 && n.msLeft < 0);

  // 4. a replacement GitHub rejects is NOT stored
  gh.answer = { status: 401, headers: {} };
  const bad = keep(await call('set', W.master, { token: PAT2 }));
  check('GitHub rejecting the new token refuses the save', bad.ok === false && bad.rejected === true && /rejected/i.test(bad.error));
  check('the old token is still the one stored', vault.m.get('GITHUB_TOKEN') === PAT);
  check('and the notice is still EXPIRED (the failed attempt cleared nothing)', (await stateNow()).state === 'expired');

  // 5. a replacement GitHub cannot be reached for: stored, but the notice STAYS
  gh.answer = new Error('connect ETIMEDOUT');
  const guard = keep(await call('set', W.master, { token: PAT2 }));
  check('replacing a stored token while GitHub is unreachable is refused, and asks master (Section 160)', guard.ok === false && guard.needsConfirm === true && vault.m.get('GITHUB_TOKEN') === PAT);
  check('and the notice is untouched by the refused attempt', (await stateNow()).state === 'expired');
  const off = keep(await call('set', W.master, { token: PAT2, force: true }));
  check('GitHub unreachable: stored, but reported as not confirmed', off.ok && off.verified === false && typeof off.unverifiedReason === 'string' && off.unverifiedReason.length > 0);
  check('the new token is in the vault', vault.m.get('GITHUB_TOKEN') === PAT2);
  n = await stateNow();
  check('and the bar STAYS (unverified), with no expiry carried over from the old token', n.state === 'unverified' && n.persistent && n.expiresAt === null);

  // 6. TEST: GitHub accepts it -> the bar goes
  T += 1000;
  gh.answer = { status: 200, headers: hdr(NOW + 400 * DAY) };
  const t1 = keep(await call('test', W.sa, { repoPath: null }));
  check('TEST accepted: the notice clears', t1.ok && t1.notice.state === 'ok' && !t1.notice.persistent);
  check('and records GitHub\'s date', (await stateNow()).expiresAt === NOW + 400 * DAY);

  // 7. refused later by GitHub: the bar returns, until accepted again
  T += 1000;
  gh.answer = { status: 401, headers: {} };
  const t2 = keep(await call('test', W.sa, { repoPath: null }));
  check('TEST refused: the persistent notice returns', t2.ok === false && t2.rejected === true && t2.notice.state === 'rejected' && t2.notice.persistent);
  T += 1000;
  gh.answer = new Error('connect ECONNRESET');
  const t3 = keep(await call('test', W.sa, { repoPath: null }));
  check('GitHub unreachable during TEST changes nothing (still refused)', t3.ok === false && t3.notice.state === 'rejected');
  T += 1000;
  gh.answer = { status: 200, headers: hdr(NOW + 400 * DAY) };
  const t4 = keep(await call('test', W.sa, { repoPath: null }));
  check('accepted again: cleared', t4.ok && t4.notice.state === 'ok');

  // 8. a git command GitHub refuses marks it
  T += 1000;
  check('a refused credential in a git error marks the token', ga.noteAuthFailure('remote: Invalid username or password.', T) === true && (await stateNow()).state === 'rejected');
  gh.answer = { status: 200, headers: hdr(NOW + 400 * DAY) };
  T += 1000;
  await call('test', W.sa, { repoPath: null });
  check('and a good TEST clears it again', (await stateNow()).state === 'ok');
  // A token stored by an older path has no record. The refusal used to be dropped, so the notice never appeared.
  records.delete('config/githubToken');
  T += 1000;
  check('a refused credential with NO record on file creates one and raises the notice', ga.noteAuthFailure('remote: Invalid username or password.', T) === true && (await stateNow()).state === 'rejected');
  check('the record it creates says the token was never confirmed', records.get('config/githubToken').verifiedAt === null && typeof records.get('config/githubToken').savedAt === 'number');
  gh.answer = { status: 200, headers: hdr(NOW + 400 * DAY) };
  T += 1000;
  await call('test', W.sa, { repoPath: null });
  check('and a good TEST still clears that one', (await stateNow()).state === 'ok');
  check('a bare 403 does not (a token without write access gets one)', ga.noteAuthFailure('The requested URL returned error: 403', T) === false && (await stateNow()).state === 'ok');
  vault.unlocked = false;
  check('with the vault locked the stored token was not what git used: nothing is marked', ga.noteAuthFailure('remote: Bad credentials', T) === false);
  vault.unlocked = true;

  // 9. a fine-grained token whose header is "now": not believed
  gh.answer = { status: 200, headers: { 'github-authentication-token-expiration': fmt(T) } };
  const f1 = keep(await call('set', W.master, { token: FINE }));
  check('a fine-grained token whose header equals now: saved, expiry NOT believed', f1.ok && f1.verified && f1.notice.state === 'unknown-expiry' && f1.notice.expiresAt === null && f1.notice.expirySource === 'unknown');
  check('no bar for it (nothing known to warn about)', !f1.notice.show);

  // 10. the typed date
  const tenDays = new Date(T + 10 * DAY).toISOString().slice(0, 10);
  const d1 = keep(await call('set-expiry', W.master, { date: tenDays }));
  check('a typed date is recorded as the end of that day', d1.ok && d1.notice.expirySource === 'manual' && d1.notice.expiresAt === Date.parse(tenDays + 'T23:59:59Z'));
  check('and drives the warning (about 10 days left: expiring)', d1.notice.state === 'expiring' && d1.notice.autoHideMs === 10000, d1.notice.state);
  check('a bad date is refused with a reason and changes nothing', (await call('set-expiry', W.master, { date: '30/10/2026' })).ok === false && (await stateNow()).expirySource === 'manual');
  check('an impossible date is refused', (await call('set-expiry', W.master, { date: '2026-02-30' })).ok === false);
  check('no body is refused', (await call('set-expiry', W.master, undefined)).ok === false);
  const d2 = keep(await call('set-expiry', W.master, { date: '2027-06-01' }));
  check('a date can be changed', d2.ok && d2.notice.state === 'ok');
  gh.answer = { status: 200, headers: { 'github-authentication-token-expiration': fmt(T) } };
  T += 1000;
  await call('test', W.sa, { repoPath: null });
  check('an odd reply from GitHub does not erase the typed date', (await stateNow()).expirySource === 'manual');

  // 11. GitHub's own date cannot be overridden by hand
  gh.answer = { status: 200, headers: hdr(NOW + 500 * DAY) };
  T += 1000;
  await call('test', W.sa, { repoPath: null });
  const d3 = keep(await call('set-expiry', W.master, { date: '2026-11-01' }));
  check('once GitHub reports it, a typed date is refused', d3.ok === false && /already reports/.test(d3.error) && (await stateNow()).expirySource === 'github');

  // 12. a classic token with no expiry
  gh.answer = { status: 200, headers: { 'x-oauth-scopes': 'repo' } };
  const c1 = keep(await call('set', W.master, { token: PAT }));
  check('a classic token with no header: "no expiry", no bar', c1.ok && c1.notice.state === 'no-expiry' && !c1.notice.show);

  // 13. remove
  const rm = keep(await call('remove', W.master, {}));
  check('removing forgets everything about it', rm.ok && rm.notice.state === 'none' && records.get('config/githubToken') === null && !vault.m.has('GITHUB_TOKEN'));
  check('a typed date with no token is refused', (await call('set-expiry', W.master, { date: '2027-01-01' })).ok === false);
  check('TEST with no token makes no GitHub call', await (async () => { const before = gh.calls; const r2 = await call('test', W.sa, {}); return r2.ok === false && gh.calls === before; })());

  // 14. a token stored by an older path has no record: TEST creates one
  vault.m.set('GITHUB_TOKEN', PAT);
  gh.answer = { status: 200, headers: hdr(NOW + 100 * DAY) };
  T += 1000;
  const old = keep(await call('test', W.sa, { repoPath: null }));
  check('a stored token with no record gets one from TEST', old.ok && old.notice.state === 'ok' && records.get('config/githubToken').expiresAt === NOW + 100 * DAY);
  check('without a record the Keys list can still say "stored" (stored is true)', (await call('expiry', W.master, {})).stored === true);

  // 15. a vault that refuses the write
  const vault2 = { isUnlocked: () => true, getCredential: () => null, setCredentialDirect: () => ({ ok: false, error: 'disk full ' + PAT }), deleteCredentialDirect: () => ({ ok: true }) };
  const h2 = new Map();
  records.clear();
  ipc.register({ handle: (ch, fn) => h2.set(ch, fn) }, { vault: vault2, http, simpleGit: () => ({ getRemotes: async () => [] }), store, now: () => T });
  gh.answer = { status: 200, headers: hdr(NOW + 100 * DAY) };
  const vf = keep(await h2.get('gitAuth:set')(W.master, { token: PAT }));
  check('a vault that refuses the write leaves NO record behind', vf.ok === false && !JSON.stringify(vf).includes(PAT) && records.get('config/githubToken') === undefined);

  // ═══ the gate ══════════════════════════════════════════════════════════════════════════════════
  section('the gate');
  // A record that a typed date WOULD change, so a caller who got through would be visible in the result.
  records.set('config/githubToken', te.recordSaved({ kind: 'fine-grained', login: 'k', parsed: { kind: 'unreliable' }, verified: true, now: T }));
  for (const [who, win] of Object.entries({ superadmin: W.sa, admin: W.admin, operator: W.operator, viewer: W.viewer, guest: W.guest, anonymous: { sender: { id: 999 } } })) {
    const e = keep(await call('expiry', win, {}));
    check(`${who} cannot read the expiry notice`, e.ok === false && !('notice' in e));
    const sd = keep(await call('set-expiry', win, { date: '2027-01-01' }));
    check(`${who} cannot type an expiry date`, sd.ok === false);
  }
  check('no refused caller changed the record', records.get('config/githubToken').expirySource === 'unknown' && records.get('config/githubToken').expiresAt === null);
  check('master can, on the same record', (await call('set-expiry', W.master, { date: '2027-01-01' })).ok === true);
  check('a forged tier in the payload changes nothing', (await call('expiry', W.guest, { user: { tier: 0 } })).ok === false);
  check('the status reply (git.push) carries the notice for a SuperAdmin', (await call('status', W.sa, {})).notice !== undefined);
  check('across every reply this suite saw, no token appears', !JSON.stringify(everything).includes(PAT) && !JSON.stringify(everything).includes(PAT2) && !JSON.stringify(everything).includes(FINE));
  principalBinding.useAuth(null);
  principalBinding.reset();
  ga.useVault(null);
  ga.useStore(null);

  // ═══ wiring ════════════════════════════════════════════════════════════════════════════════════
  section('where it is wired');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const lib = read('electron/lib/tokenExpiry.cjs');
  const gitSrc = read('electron/ipc/git.cjs');
  const ipcSrc = read('electron/ipc/gitAuth.cjs');
  const libGa = read('electron/lib/gitAuth.cjs');
  check('push, pull and clone all report a refused credential', (gitSrc.match(/gitAuth\.noteAuthFailure\(err\.message\)/g) || []).length === 3);
  check('the facts live in the app store, config.githubToken, not in the vault', /RECORD_DOMAIN = 'config'/.test(libGa) && /RECORD_KEY = 'githubToken'/.test(libGa));
  check('saving asks GitHub BEFORE it writes to the vault', ipcSrc.indexOf('gitAuth.probe(d.http, v.token') > 0 && ipcSrc.indexOf('gitAuth.probe(d.http, v.token') < ipcSrc.indexOf('setCredentialDirect'));
  check('a rejected token returns before the vault write', ipcSrc.indexOf('if (check.rejected)') < ipcSrc.indexOf('setCredentialDirect'));
  check('tokenExpiry is pure: no clock of its own, no store, no network, no console', !/Date\.now|new Date\(\)|require\(|console\./.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('the warning window is 14 days and the auto-hide 10 seconds', /WARN_DAYS = 14/.test(lib) && /AUTO_HIDE_MS = 10000/.test(lib));
  check('there is no console.log', !/console\.log/.test(lib + ipcSrc + libGa));

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
