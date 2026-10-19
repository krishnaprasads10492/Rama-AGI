'use strict';

/**
 * gitAuth.cjs (IPC) - add, test and remove the GitHub token from the UI (spec Section 157)
 *
 *   gitAuth:status   git.push        is a token stored, and does any remote carry a credential in its URL
 *   gitAuth:set      vault.write     validate and store the token in the vault (service GITHUB_TOKEN)
 *   gitAuth:remove   vault.write     delete it from the vault
 *   gitAuth:test     git.push        ask GitHub who the token is and whether it can see the repository
 *   gitAuth:scrub    git.push        rewrite remotes that carry a credential, without it
 *
 * Decided on the principal main validated, never on a `user` the window sent. The token goes in through `set`
 * and is never returned by anything: not here, not in an error (everything passes through `redact`).
 */

const capability = require('../lib/capability.cjs');
const principalBinding = require('../lib/principalBinding.cjs');
const gitAuth = require('../lib/gitAuth.cjs');

function defaults() {
  return {
    vault: require('./credentialVault.cjs'),
    http: require('../lib/http.cjs'),
    simpleGit: require('simple-git').simpleGit,
  };
}

function register(ipcMain, injected = {}) {
  const d = { ...defaults(), ...injected };
  gitAuth.useVault(d.vault);

  const gated = (cap, fn) => async (e, body) => {
    const denied = capability.deny(principalBinding.getPrincipal(e), cap);
    if (denied) return denied;
    try { return await fn(body || {}); }
    catch (err) { return { ok: false, error: gitAuth.redact(err.message) }; }
  };
  const repo = (body) => (typeof body.repoPath === 'string' && body.repoPath ? body.repoPath : null);

  ipcMain.handle('gitAuth:status', gated('git.push', async (body) => {
    const unlocked = !!(d.vault.isUnlocked && d.vault.isUnlocked());
    const out = { ok: true, vaultUnlocked: unlocked, hasToken: !!gitAuth.storedToken(), remotes: [], anyCredentialInUrl: false };
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
    if (!(d.vault.isUnlocked && d.vault.isUnlocked())) return { ok: false, error: 'The vault is locked. Unlock it first (Models > Keys), then add the token.' };
    const v = gitAuth.validateToken(body.token);
    if (!v.ok) return { ok: false, error: v.error };
    const saved = d.vault.setCredentialDirect(gitAuth.SERVICE, v.token, { kind: v.kind, via: 'git-sync' });
    if (!saved || saved.ok === false) return { ok: false, error: gitAuth.redact((saved && saved.error) || 'The vault did not accept it.') };
    return { ok: true, kind: v.kind, hasToken: true };
  }));

  ipcMain.handle('gitAuth:remove', gated('vault.write', async () => {
    if (!(d.vault.isUnlocked && d.vault.isUnlocked())) return { ok: false, error: 'The vault is locked. Unlock it first.' };
    const r = d.vault.deleteCredentialDirect(gitAuth.SERVICE);
    if (!r || r.ok === false) return { ok: false, error: gitAuth.redact((r && r.error) || 'The vault did not remove it.') };
    return { ok: true, hasToken: false };
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
    return gitAuth.probe(d.http, token, slug);
  }));

  ipcMain.handle('gitAuth:scrub', gated('git.push', async (body) => {
    const rp = repo(body);
    if (!rp) return { ok: false, error: 'Choose a repository first.' };
    const r = await gitAuth.scrubRemotes(d.simpleGit(rp));
    return { ok: true, changed: r.changed, note: r.changed.length ? 'The credential was removed from the remote address. If it was a real token, revoke it at github.com/settings/tokens: only GitHub can.' : 'No remote carried a credential.' };
  }));
}

module.exports = { register };
