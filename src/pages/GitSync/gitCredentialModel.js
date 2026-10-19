/**
 * gitCredentialModel.js - what the "GitHub token" tab says (spec Section 157)
 *
 * Sentences as data, so `scripts/verifyGitAuthUi.mjs` can drive them. The rules this file holds:
 *   - A TOKEN IS NEVER A VALUE IN THIS MODULE. The main process says whether one is stored; that is all there is.
 *   - It does not claim a token CAN push. GitHub cannot say that for a fine-grained token, and said "yes" for one
 *     that was then refused; only the first push is a real test.
 *   - It says plainly that revoking is done at GitHub, not here.
 */

export const REVOKE_WHERE = 'github.com/settings/tokens';

export const REVOKE_NOTE = `Rāma cannot revoke a token: only GitHub can. To revoke one, open ${REVOKE_WHERE}, find it and delete it. Then add a new one here.`;

export const HOW_TO = [
  `Open ${REVOKE_WHERE} and make a token limited to this repository. A fine-grained token needs Contents: Read and write.`,
  'Paste it below and press SAVE. It is stored encrypted in the vault, and Rāma uses it for push, pull and clone from this app.',
  'It is never written into the remote address, a file or the git settings.',
];

/** @returns {'unknown'|'vault-locked'|'no-token'|'has-token'} */
export function stateOf(st) {
  if (!st || st.ok === false) return 'unknown';
  if (st.hasToken) return 'has-token';
  if (st.vaultUnlocked === false) return 'vault-locked';
  return 'no-token';
}

export function headline(st) {
  switch (stateOf(st)) {
    case 'has-token': return 'A GitHub token is stored in the vault.';
    case 'vault-locked': return 'The vault is locked, so a stored token cannot be used or added.';
    case 'no-token': return 'No GitHub token is stored. Push, pull and clone use whatever sign-in this computer already has.';
    default: return 'The token state is not known yet.';
  }
}

export function details(st) {
  const out = [];
  if (!st) return out;
  if (st.anyCredentialInUrl) {
    const names = (st.remotes || []).filter((r) => r.hadCredential).map((r) => r.name).join(', ');
    out.push(`The remote address of ${names || 'a remote'} contains a credential. It is hidden here, but it is still in the repository settings. Press REMOVE IT FROM THE REMOTE ADDRESS.`);
  }
  if (stateOf(st) === 'vault-locked') out.push('Unlock the vault in Models > Keys with the master password.');
  if (st.remotesError) out.push(`The remotes could not be read: ${st.remotesError}`);
  return out;
}

/** Quick client-side shape check before the round trip. The main process checks again. */
export function tokenProblem(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return 'Paste the token first.';
  if (/\s/.test(t)) return 'A token has no spaces or line breaks. Check that it was copied whole.';
  if (!/^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)/.test(t)) return 'That does not look like a GitHub token (it starts with ghp_ or github_pat_).';
  return null;
}

/** Which buttons to show. The main process refuses a caller without the capability regardless. */
export function actions(st, { canWrite, canUse }) {
  const state = stateOf(st);
  return {
    save: !!canWrite && state !== 'unknown' && state !== 'vault-locked',
    remove: !!canWrite && state === 'has-token',
    test: !!canUse && state === 'has-token',
    scrub: !!canUse && !!(st && st.anyCredentialInUrl),
    why: !canWrite ? 'Adding or removing a token needs the vault permission (Master).' : null,
  };
}

/** The result of testing a token, as sentences. Never says "can push" for a fine-grained token. */
export function testSummary(res) {
  if (!res) return ['No answer from GitHub.'];
  if (res.ok === false) return [res.error || 'The test failed.'];
  const out = [`GitHub knows this token as ${res.login || 'an unnamed account'} (${res.kind === 'classic' ? 'classic token' : 'fine-grained token'}).`];
  if (res.repo) {
    out.push(res.repo.visible ? `It can see ${res.repo.slug}.` : `It cannot see ${res.repo.slug}. Check that the token covers this repository.`);
    if (res.repo.canPush === true) out.push('GitHub reports write access to it.');
    if (res.repo.canPush === false) out.push('GitHub reports NO write access to it, so a push will be refused.');
  }
  if (res.note) out.push(res.note);
  return out;
}

export function scrubSummary(res) {
  if (!res) return 'No answer.';
  if (res.ok === false) return res.error || 'The remote could not be cleaned.';
  const n = (res.changed || []).length;
  return n ? `Removed the credential from ${n === 1 ? 'the remote' : `${n} remotes`}: ${res.changed.join(', ')}. ${REVOKE_NOTE}` : 'No remote carried a credential.';
}
