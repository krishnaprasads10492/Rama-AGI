'use strict';

/**
 * gitAuth.cjs - a GitHub token that lives in the vault and never in a URL (spec Section 157)
 *
 * WHY. A personal access token was found embedded in the `origin` URL in `.git/config`. Every surface that prints
 * a remote then prints the token: `git:get-remotes` returned it to the window, git's own error text echoed it, and
 * nothing the app could do would revoke it. So:
 *
 *   - the token is kept in the vault under `GITHUB_TOKEN` (the name the Models key list already offers);
 *   - it is handed to git PER COMMAND as a one-shot header (`-c http.<url>.extraheader=...`), scoped to github.com so
 *     it is never offered to another host, with the credential helper disabled for that command;
 *   - it is never written to a URL, a file, an environment variable or git config;
 *   - `redact()` removes token shapes and URL credentials from any text before it leaves the main process;
 *   - a remote that already carries a credential is reported (scrubbed) and can be cleaned on request.
 *
 * Revoking a token is GitHub's act: there is no API for it, so this module cannot do it (Section 157.2).
 *
 * PURE where it can be: the vault, the HTTP client and simple-git are injected, so every rule is driven in tests
 * with no network, no repository and no vault.
 */

const tokenExpiry = require('./tokenExpiry.cjs');

const GITHUB_HOST = 'https://github.com/';
const SERVICE = 'GITHUB_TOKEN';
// Where the non-secret facts about the token live: the encrypted app store, which is open at login while the vault
// usually is not (Section 158.3, D1).
const RECORD_DOMAIN = 'config';
const RECORD_KEY = 'githubToken';

// ─── Shapes ──────────────────────────────────────────────────────────────────────────────────────
const CLASSIC = /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}$/;
const FINE = /^github_pat_[A-Za-z0-9_]{22,255}$/;
const SHAPES_G = /(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})/g;
const URL_CRED_G = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\/\s@:]+(?::[^\/\s@]*)?)@/gi;

/** Remove token shapes and URL credentials from any text. */
function redact(text) {
  if (text === null || text === undefined) return text;
  return String(text).replace(SHAPES_G, '<token>').replace(URL_CRED_G, '$1<credential>@');
}

/** A URL without its user:password part. A string that is not a URL is returned redacted. */
function scrubUrl(url) {
  const s = String(url || '');
  try {
    const u = new URL(s);
    if (!u.username && !u.password) return s;
    u.username = '';
    u.password = '';
    return u.toString();
  } catch { return redact(s); }
}

function hasCredential(url) {
  try { const u = new URL(String(url || '')); return !!(u.username || u.password); } catch { return /:\/\/[^\/\s]*@/.test(String(url || '')); }
}

/**
 * @returns {{ok:boolean, token?:string, kind?:'classic'|'fine-grained', error?:string}}
 */
function validateToken(raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return { ok: false, error: 'Paste the token first.' };
  if (/\s/.test(t)) return { ok: false, error: 'A token has no spaces or line breaks. Check that it was copied whole.' };
  if (CLASSIC.test(t)) return { ok: true, token: t, kind: 'classic' };
  if (FINE.test(t)) return { ok: true, token: t, kind: 'fine-grained' };
  return { ok: false, error: 'That does not look like a GitHub personal access token (it should start with ghp_ or github_pat_).' };
}

/** `-c` pairs for ONE git command. Scoped to github.com; the credential helper is switched off for the command. */
function authConfig(token) {
  const b64 = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return ['credential.helper=', `http.${GITHUB_HOST}.extraheader=AUTHORIZATION: basic ${b64}`];
}

// ─── The vault, injected ─────────────────────────────────────────────────────────────────────────
let vault = null;
function useVault(v) { vault = v || null; }
function theVault() {
  if (vault) return vault;
  try { return require('../ipc/credentialVault.cjs'); } catch { return null; }
}

/** The stored token, or null (not stored, or the vault is locked). */
function storedToken() {
  const v = theVault();
  if (!v || !v.isUnlocked || !v.isUnlocked()) return null;
  const t = v.getCredential(SERVICE);
  return typeof t === 'string' && t ? t : null;
}

// ─── The record of what is known about the token (no secret in it) ───────────────────────────────
let store = null;
function useStore(s) { store = s || null; }
function theStore() {
  if (store) return store;
  try { return require('../dataStore.cjs'); } catch { return null; }
}
function readRecord() {
  const s = theStore();
  try { const r = s && s.get(RECORD_DOMAIN, RECORD_KEY); return r && typeof r === 'object' ? r : null; } catch { return null; }
}
/** @returns {boolean} whether it was written */
function writeRecord(record) {
  const s = theStore();
  if (!s) return false;
  try { s.set(RECORD_DOMAIN, RECORD_KEY, record || null); return true; } catch { return false; }
}

/**
 * A git command failed. If it failed in GitHub's words for a refused credential AND the stored token was the one in
 * use, the token is marked rejected, so a token revoked early raises the standing notice without waiting for the
 * date (Section 158.3, D7). A bare 403 is not treated this way: a token without write access gets one.
 */
function noteAuthFailure(text, now = Date.now()) {
  if (!tokenExpiry.looksLikeAuthFailure(text)) return false;
  const token = storedToken();
  if (!token) return false;
  // A token stored by an older path has no record. Dropping the refusal there left the standing notice unraised
  // while `gitAuth:test` created a record in the same situation, so the two paths disagreed (Section 160.3, D6).
  const rec = readRecord()
    || tokenExpiry.recordSaved({ kind: validateToken(token).kind || 'fine-grained', verified: false, now });
  return writeRecord(tokenExpiry.recordRejected(rec, now));
}

/** A simple-git client; with the stored token it carries the one-shot header, otherwise it is exactly as before. */
function open(repoPath, simpleGit) {
  const sg = simpleGit || require('simple-git').simpleGit;
  const token = storedToken();
  // simple-git refuses `credential.helper` in config unless told it is deliberate. It is: the value is the constant
  // `credential.helper=` (switch every helper off for this command), never anything the window supplied.
  const opts = token ? { config: authConfig(token), unsafe: { allowUnsafeCredentialHelper: true } } : undefined;
  return repoPath === undefined || repoPath === null ? sg(opts) : (opts ? sg(repoPath, opts) : sg(repoPath));
}

// ─── Remotes ─────────────────────────────────────────────────────────────────────────────────────
/** Remotes with credentials removed, and a flag for each that had one. */
function describeRemotes(remotes) {
  return (remotes || []).map((r) => ({
    name: r.name,
    fetch: scrubUrl(r.refs && r.refs.fetch),
    push: scrubUrl(r.refs && r.refs.push),
    hadCredential: hasCredential(r.refs && r.refs.fetch) || hasCredential(r.refs && r.refs.push),
  }));
}

/** `owner/repo` from a GitHub remote, or null. */
function slugOf(url) {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(scrubUrl(url));
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Rewrite every remote that carries a credential without it. Only on request.
 * @returns {Promise<{ok:boolean, changed:string[], error?:string}>} names only: never a URL, never a token
 */
async function scrubRemotes(git) {
  const remotes = await git.getRemotes(true);
  const changed = [];
  for (const r of remotes) {
    const f = r.refs && r.refs.fetch;
    const p = r.refs && r.refs.push;
    if (hasCredential(f)) { await git.remote(['set-url', r.name, scrubUrl(f)]); changed.push(r.name); }
    if (hasCredential(p) && scrubUrl(p) !== scrubUrl(f)) { await git.remote(['set-url', '--push', r.name, scrubUrl(p)]); if (!changed.includes(r.name)) changed.push(r.name); }
  }
  return { ok: true, changed };
}

// ─── Testing a token ─────────────────────────────────────────────────────────────────────────────
/**
 * Ask GitHub who a token is and whether it can see the repository.
 *
 * `permissions.push` on a repository describes the USER, not a fine-grained token: a token with read-only contents
 * access reported `push: true` and was then refused with a 403 (Section 156 session). So for a fine-grained token
 * the answer is "visible", never "can push", and the panel says the first push is the real test.
 */
async function probe(http, token, slug, now = Date.now) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const callMs = now();
  const ask = (url, expectStatuses) => http.request(url, { method: 'GET', headers, retries: 0, timeout: 15000, expectStatuses });
  // BOTH AT ONCE (Section 160.3, D4). The repository reply is only INTERPRETED after the user reply, so what is
  // reported is unchanged; issuing them together halves the wait, and the one extra request on the rejected path
  // costs the circuit breaker nothing now that an expected status is not a failure.
  const userCall = ask('https://api.github.com/user', [401]).then((r) => ({ r }), (err) => ({ err }));
  const repoCall = slug ? ask(`https://api.github.com/repos/${slug}`, [401, 404]).then((r) => r, () => null) : null;
  const first = await userCall;
  if (first.err) {
    if (repoCall) await repoCall;                                   // never leave a request unobserved
    return { ok: false, error: `GitHub could not be reached: ${redact(first.err.message)}` };
  }
  const me = first.r;
  // "Not asked" is not an answer: the breaker in lib/http.cjs refused locally, so nothing is known about the token.
  if (me && me.circuitOpen) {
    if (repoCall) await repoCall;
    return { ok: false, notAsked: true, error: 'GitHub was not asked: too many failed attempts in the last few seconds. Wait about twenty seconds and try again.' };
  }
  if (!me || me.status === 401) {
    if (repoCall) await repoCall;
    return { ok: false, rejected: true, error: 'GitHub rejected this token (revoked, expired or mistyped).' };
  }
  if (!me.ok) {
    if (repoCall) await repoCall;
    return { ok: false, error: `GitHub answered ${me.status || 'with an error'}.` };
  }
  let user = {};
  try { user = JSON.parse(me.body); } catch { user = {}; }
  const scopes = me.headers && me.headers['x-oauth-scopes'] !== undefined ? String(me.headers['x-oauth-scopes']).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const kind = scopes === null ? 'fine-grained' : 'classic';
  const expiry = tokenExpiry.parseExpiryHeader(me.headers && me.headers[tokenExpiry.HEADER], callMs);
  const out = { ok: true, expiry, login: String(user.login || ''), kind, scopes: scopes ? scopes.slice(0, 40) : null, broad: !!(scopes && scopes.some((s) => /^(admin:|delete_repo|write:packages|delete:packages)/.test(s))) };
  if (slug) {
    const repo = await repoCall;
    let r = {};
    try { r = repo && repo.body ? JSON.parse(repo.body) : {}; } catch { r = {}; }
    out.repo = { slug, visible: !!(repo && repo.ok), canPush: kind === 'classic' && repo && repo.ok ? !!(r.permissions && r.permissions.push) : null };
  }
  out.note = kind === 'fine-grained'
    ? 'GitHub cannot say whether a fine-grained token may write to the repository. The first push is the real test; it needs Contents: Read and write.'
    : (out.broad ? 'This token carries very broad permissions (admin or delete). Make one limited to this repository.' : null);
  return out;
}

module.exports = {
  SERVICE, GITHUB_HOST,
  redact, scrubUrl, hasCredential, validateToken, authConfig, useVault, storedToken, open,
  describeRemotes, slugOf, scrubRemotes, probe,
  useStore, readRecord, writeRecord, noteAuthFailure,
};
