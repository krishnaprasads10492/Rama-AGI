'use strict';

/**
 * gitAuth.cjs (IPC) - add, test, remove and watch the expiry of the GitHub token (spec Sections 157, 158)
 *
 *   gitAuth:status      git.push     is a token stored, which remotes carry a credential, and the expiry notice
 *   gitAuth:set         vault.write  check the token with GitHub, then store it in the vault (service GITHUB_TOKEN)
 *   gitAuth:remove      vault.write  delete it from the vault and forget what was known about it
 *   gitAuth:test        git.push     ask GitHub who the token is; this is also what clears an expiry notice
 *   gitAuth:scrub       git.push     rewrite remotes that carry a credential, without it
 *   gitAuth:expiry      vault.read   the expiry notice (works while the vault is locked: the facts are not in it)
 *   gitAuth:set-expiry  vault.write  the date master reads off github.com/settings/tokens, when GitHub did not say
 *
 * Decided on the principal main validated, never on a `user` the window sent. The token goes in through `set`
 * and is never returned by anything: not here, not in an error (everything passes through `redact`).
 */

const capability = require('../lib/capability.cjs');
const principalBinding = require('../lib/principalBinding.cjs');
const gitAuth = require('../lib/gitAuth.cjs');
const tokenExpiry = require('../lib/tokenExpiry.cjs');

function register(ipcMain, injected = {}) {
  const d = {
    vault: injected.vault || require('./credentialVault.cjs'),
    http: injected.http || require('../lib/http.cjs'),
    simpleGit: injected.simpleGit || require('simple-git').simpleGit,
    store: injected.store || null,
    now: injected.now || Date.now,
  };
  gitAuth.useVault(d.vault);
  if (d.store) gitAuth.useStore(d.store);

  const gated = (cap, fn) => async (e, body) => {
    const denied = capability.deny(principalBinding.getPrincipal(e), cap);
    if (denied) return denied;
    try { return await fn(body || {}); }
    catch (err) { return { ok: false, error: gitAuth.redact(err.message) }; }
  };
  const repo = (body) => (typeof body.repoPath === 'string' && body.repoPath ? body.repoPath : null);
  const unlocked = () => !!(d.vault.isUnlocked && d.vault.isUnlocked());
  const notice = () => tokenExpiry.noticeOf(gitAuth.readRecord(), d.now());

  ipcMain.handle('gitAuth:status', gated('git.push', async (body) => {
    const out = { ok: true, vaultUnlocked: unlocked(), hasToken: !!gitAuth.storedToken(), remotes: [], anyCredentialInUrl: false, notice: notice() };
    const rp = repo(body);
    if (rp) {
      try {
        const remotes = gitAuth.describeRemotes(await d.simpleGit(rp).getRemotes(true));
        out.remotes = remotes;
        out.anyCredentialInUrl = remotes.some((r) => r.hadCredential);
      } catch (err) { out.remotesError = gitAuth.redact(err.message); }
    }
    return out;
  }));

  ipcMain.handle('gitAuth:set', gated('vault.write', async (body) => {
    if (!unlocked()) return { ok: false, error: 'The vault is locked. Unlock it first (Models > Keys), then add the token.' };
    const v = gitAuth.validateToken(body.token);
    if (!v.ok) return { ok: false, error: v.error };

    // ASK GITHUB BEFORE STORING (Section 158.3, D3). A token GitHub refuses is not stored, so a mistyped or already
    // dead replacement can never overwrite the one that still works, or silence the notice about the old one.
    const check = await gitAuth.probe(d.http, v.token, null, d.now);
    if (check.rejected) {
      return { ok: false, rejected: true, error: 'GitHub rejected this token (revoked, expired or mistyped). Nothing was changed: any token already stored is kept.' };
    }
    const verified = check.ok === true;

    const saved = d.vault.setCredentialDirect(gitAuth.SERVICE, v.token, { kind: v.kind, via: 'git-sync' });
    if (!saved || saved.ok === false) return { ok: false, error: gitAuth.redact((saved && saved.error) || 'The vault did not accept it.') };

    const now = d.now();
    gitAuth.writeRecord(tokenExpiry.recordSaved({ kind: v.kind, login: verified ? check.login : '', parsed: verified ? check.expiry : null, verified, now }));
    return {
      ok: true, kind: v.kind, hasToken: true, verified,
      // Why it is not verified, so the window can say it. Never a token: probe redacts its own errors.
      unverifiedReason: verified ? null : (check.error || 'GitHub did not confirm the token.'),
      notice: notice(),
    };
  }));

  ipcMain.handle('gitAuth:remove', gated('vault.write', async () => {
    if (!unlocked()) return { ok: false, error: 'The vault is locked. Unlock it first.' };
    const r = d.vault.deleteCredentialDirect(gitAuth.SERVICE);
    if (!r || r.ok === false) return { ok: false, error: gitAuth.redact((r && r.error) || 'The vault did not remove it.') };
    gitAuth.writeRecord(null);
    return { ok: true, hasToken: false, notice: notice() };
  }));

  ipcMain.handle('gitAuth:test', gated('git.push', async (body) => {
    const token = gitAuth.storedToken();
    if (!token) return { ok: false, error: 'No token is stored (or the vault is locked).' };
    let slug = null;
    const rp = repo(body);
    if (rp) {
      try {
        const remotes = await d.simpleGit(rp).getRemotes(true);
        const origin = remotes.find((r) => r.name === 'origin') || remotes[0];
        slug = origin ? gitAuth.slugOf(origin.refs && origin.refs.fetch) : null;
      } catch { slug = null; }
    }
    const res = await gitAuth.probe(d.http, token, slug, d.now);
    // What GitHub just said is the freshest fact there is, so it is recorded: accepted clears a standing notice,
    // a refusal raises one. A failure to REACH GitHub says nothing about the token and changes nothing.
    const prev = gitAuth.readRecord();
    const now = d.now();
    const kind = gitAuth.validateToken(token).kind || 'fine-grained';      // the prefix decides, not a header
    if (res.ok) {
      const facts = { kind, login: res.login, parsed: res.expiry, now };
      gitAuth.writeRecord(prev ? tokenExpiry.recordAccepted(prev, facts) : tokenExpiry.recordSaved({ ...facts, verified: true }));
    } else if (res.rejected) {
      gitAuth.writeRecord(tokenExpiry.recordRejected(prev || tokenExpiry.recordSaved({ kind, verified: false, now }), now));
    }
    return { ...res, notice: notice() };
  }));

  ipcMain.handle('gitAuth:scrub', gated('git.push', async (body) => {
    const rp = repo(body);
    if (!rp) return { ok: false, error: 'Choose a repository first.' };
    const r = await gitAuth.scrubRemotes(d.simpleGit(rp));
    return { ok: true, changed: r.changed, note: r.changed.length ? 'The credential was removed from the remote address. If it was a real token, revoke it at github.com/settings/tokens: only GitHub can.' : 'No remote carried a credential.' };
  }));

  // The expiry notice is read from the app store, not the vault, so it can be announced at login while the vault is
  // still locked. `stored` is therefore null (unknown) when the vault is locked rather than a guess.
  ipcMain.handle('gitAuth:expiry', gated('vault.read', async () => ({
    ok: true,
    vaultUnlocked: unlocked(),
    stored: unlocked() ? !!gitAuth.storedToken() : null,
    notice: notice(),
  })));

  ipcMain.handle('gitAuth:set-expiry', gated('vault.write', async (body) => {
    const prev = gitAuth.readRecord();
    if (!prev) return { ok: false, error: 'Store a token first.' };
    const parsed = tokenExpiry.parseManualDate(body.date, d.now());
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const next = tokenExpiry.recordManual(prev, parsed.ms);
    if (!next.ok) return { ok: false, error: next.error };
    if (!gitAuth.writeRecord(next.record)) return { ok: false, error: 'The date could not be saved.' };
    return { ok: true, notice: notice() };
  }));
}

module.exports = { register };
