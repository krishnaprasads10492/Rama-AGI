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
  if (res.notice) out.push(`${expiryLine(res.notice)}.`);
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

// ─── Expiry (Section 158) ────────────────────────────────────────────────────────────────────────
// The main process decides the STATE (lib/tokenExpiry.cjs); this file only words it. Thresholds are not repeated
// here: the notice says `show`, `persistent` and `autoHideMs`, and the window obeys.

/** Fired on `window` after a save, test, remove or typed date, so the bar re-asks at once instead of in 5 minutes. */
export const EXPIRY_EVENT = 'rama-github-token-changed';
export const EXPIRY_POLL_MS = 5 * 60 * 1000;

/** A moment in the reader's own time zone, with the zone named so it is never ambiguous. */
export function formatWhen(ms, { timeZone, locale = 'en-GB' } = {}) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'an unknown time';
  const o = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
  if (timeZone) o.timeZone = timeZone;
  return new Intl.DateTimeFormat(locale, o).format(new Date(ms));
}

function span(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'under an hour';
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "in 5 days", "in 3 hours", "expired 2 days ago" */
export function remaining(msLeft) {
  if (typeof msLeft !== 'number' || !Number.isFinite(msLeft)) return '';
  return msLeft > 0 ? `in ${span(msLeft)}` : `expired ${span(-msLeft)} ago`;
}

/** The expiry as one sentence, beside the token. */
export function expiryLine(notice, opts) {
  if (!notice || notice.state === 'none') return 'No GitHub token is recorded.';
  if (typeof notice.expiresAt === 'number') {
    const when = formatWhen(notice.expiresAt, opts);
    return (notice.msLeft ?? 1) > 0 ? `Expires ${when} (${remaining(notice.msLeft)})` : `Expired ${when} (${remaining(notice.msLeft)})`;
  }
  if (notice.expirySource === 'none') return 'No expiry: GitHub reports none for this token.';
  return 'Expiry unknown: GitHub did not report one for this token.';
}

export function sourceNote(notice) {
  if (!notice) return '';
  if (notice.expirySource === 'github') return 'Date reported by GitHub.';
  if (notice.expirySource === 'manual') return 'Date entered by hand (GitHub did not report one).';
  return '';
}

export function verifiedLine(notice, opts) {
  if (!notice || notice.state === 'none') return '';
  if (notice.state === 'rejected') return `GitHub refused this token (${formatWhen(notice.rejectedAt, opts)}).`;
  if (notice.verifiedAt) return `Last confirmed by GitHub ${formatWhen(notice.verifiedAt, opts)}.`;
  return 'Not yet confirmed by GitHub.';
}

/**
 * The bar under the title bar, or null for nothing. `persistent` has no dismiss button and no timer.
 * @returns {null|{state:string, persistent:boolean, autoHideMs:number, tone:'warn'|'bad', title:string, text:string}}
 */
export function bannerOf(notice, opts) {
  if (!notice || notice.show !== true) return null;
  const base = { state: notice.state, persistent: notice.persistent === true, autoHideMs: notice.autoHideMs || 0 };
  switch (notice.state) {
    case 'expiring':
      return { ...base, tone: 'warn', title: 'GitHub token expires soon', text: `${expiryLine(notice, opts)}. Replace it in Models > Keys before then.` };
    case 'expired':
      return { ...base, tone: 'bad', title: 'GitHub token has expired', text: `${expiryLine(notice, opts)}. Push, pull and clone will fail. Add a new token in Models > Keys. This stays here until GitHub accepts the new one.` };
    case 'rejected':
      return { ...base, tone: 'bad', title: 'GitHub refused the stored token', text: 'It was revoked, has expired, or is wrong. Add a new token in Models > Keys. This stays here until GitHub accepts the new one.' };
    case 'unverified':
      return { ...base, tone: 'bad', title: 'GitHub token not confirmed', text: 'A token is stored, but GitHub has not confirmed that it works. Unlock the vault and press TEST WITH GITHUB in Git Sync > Token, or add the token again.' };
    default:
      return null;
  }
}

/** What the GitHub row in Models > Keys shows beside the token. */
export function keyRow(notice, { vaultUnlocked, stored } = {}) {
  const state = notice ? notice.state : 'none';
  const hasRecord = state !== 'none';
  const isStored = hasRecord || stored === true;
  let tone = 'idle';
  let label = 'NO TOKEN';
  if (state === 'expired') { tone = 'bad'; label = 'EXPIRED'; }
  else if (state === 'rejected') { tone = 'bad'; label = 'REFUSED'; }
  else if (state === 'unverified') { tone = 'warn'; label = 'NOT CONFIRMED'; }
  else if (state === 'expiring') { tone = 'warn'; label = 'EXPIRES SOON'; }
  else if (hasRecord) { tone = 'good'; label = 'STORED'; }
  else if (stored === true) { tone = 'warn'; label = 'STORED, NO RECORD'; }
  const lines = [];
  if (hasRecord) {
    lines.push(expiryLine(notice));
    const src = sourceNote(notice);
    if (src) lines.push(src);
    lines.push(verifiedLine(notice));
  } else if (stored === true) {
    lines.push('A token is stored, but nothing is recorded about its expiry. Press TEST WITH GITHUB in Git Sync > Token.');
  } else if (vaultUnlocked === false) {
    lines.push('The vault is locked, so a stored token cannot be listed. Any expiry on record is shown above.');
  } else {
    lines.push('No GitHub token is stored.');
  }
  return {
    tone, label, stored: isStored, lines,
    // A typed date is only for a token whose expiry GitHub did not report; GitHub's own date is never overridden.
    canTypeDate: hasRecord && notice.expirySource !== 'github' && notice.expirySource !== 'none',
  };
}

/** The sentence after a save. */
export function saveSummary(res) {
  if (!res || res.ok === false) return (res && res.error) || 'The token was not stored.';
  const kind = res.kind === 'classic' ? 'classic' : 'fine-grained';
  const head = `Stored in the vault (${kind} token).`;
  if (res.verified) return `${head} GitHub confirmed it works. ${expiryLine(res.notice)}`;
  return `${head} GitHub could not confirm it (${res.unverifiedReason || 'no answer'}), so the reminder stays until you press TEST WITH GITHUB.`;
}