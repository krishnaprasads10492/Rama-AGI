'use strict';

/**
 * tokenExpiry.cjs - what is known about when the GitHub token stops working (spec Section 158)
 *
 * PURE. No clock of its own (every function takes `now`), no store, no network: the facts come in, one record and
 * one verdict come out. The record holds NO secret - not the token, not a hash of it - so it can live in the
 * encrypted app store, which is open at login while the vault usually is not.
 *
 * Record: { kind, login, savedAt, expiresAt, expirySource, verifiedAt, rejectedAt }
 *   expiresAt     ms since epoch, or null
 *   expirySource  'github' (the response header)  |  'manual' (a date master typed)  |  'none' (GitHub reports no
 *                 expiry)  |  'unknown' (GitHub did not say, or said something that cannot be trusted)
 *   verifiedAt    last time GitHub accepted THIS token, or null
 *   rejectedAt    last time GitHub (or a git command) refused it, or null
 */

const DAY = 86400000;
const WARN_DAYS = 14;
const WARN_MS = WARN_DAYS * DAY;
const AUTO_HIDE_MS = 10000;
// A header this close to the moment of the call is the "current time instead of the expiry" report
// (google/go-github #3708), not an expiry: nobody mints a token that dies in two minutes.
const UNRELIABLE_MS = 120000;
const HEADER = 'github-authentication-token-expiration';

const PERSISTENT = new Set(['expired', 'rejected', 'unverified']);

// ─── Reading what GitHub says ────────────────────────────────────────────────────────────────────
/**
 * @param {*} value  the header, as the HTTP client gave it
 * @param {number} callMs  when the call was made
 * @returns {{kind:'none'|'known'|'unreliable'|'unparsable', ms?:number}}
 */
function parseExpiryHeader(value, callMs) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || String(raw).trim() === '') return { kind: 'none' };
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})$/i.exec(String(raw).trim());
  if (!m) return { kind: 'unparsable' };
  const [, y, mo, d, h, mi, s, tz] = m;
  // Range-checked, because Date.UTC rolls over silently: "10:99:00" became 11:39 and was recorded as the expiry
  // (Section 160.3, D7). The month and day check below cannot see that, since the date does not change.
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return { kind: 'unparsable' };
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!Number.isFinite(ms)) return { kind: 'unparsable' };
  const probe = new Date(ms);
  if (probe.getUTCMonth() !== Number(mo) - 1 || probe.getUTCDate() !== Number(d)) return { kind: 'unparsable' };   // 2026-02-31 and the like
  if (!/^(UTC|Z)$/i.test(tz)) {
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.replace(/[^0-9]/g, '');
    const off = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
    ms -= sign * off * 60000;
  }
  if (Number.isFinite(callMs) && Math.abs(ms - callMs) <= UNRELIABLE_MS) return { kind: 'unreliable' };
  return { kind: 'known', ms };
}

/**
 * A date master typed (YYYY-MM-DD), as the END of that day in UTC: a token cannot be alive past the date GitHub
 * shows, so a warning built on it is never late.
 * @returns {{ok:boolean, ms?:number, error?:string}}
 */
function parseManualDate(text, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!m) return { ok: false, error: 'Enter the date as YYYY-MM-DD, as github.com/settings/tokens shows it.' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d, 23, 59, 59);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return { ok: false, error: 'That date does not exist.' };
  if (y < 2020) return { ok: false, error: 'That date is too far in the past to be a token expiry.' };
  if (Number.isFinite(now) && ms - now > 10 * 365 * DAY) return { ok: false, error: 'That date is more than ten years away; check it.' };
  return { ok: true, ms };
}

/** GitHub's wording when it refuses a credential. A bare 403 is NOT here: a token without write access gets one. */
function looksLikeAuthFailure(text) {
  return /authentication failed|bad credentials|invalid username or password|http basic: access denied|invalid credentials|token (?:is |has |has been )?(?:expired|revoked)/i.test(String(text || ''));
}

// ─── The record ──────────────────────────────────────────────────────────────────────────────────
function expiryFrom(parsed, kind, prev) {
  if (parsed && parsed.kind === 'known') return { expiresAt: parsed.ms, expirySource: 'github' };
  // No header from a classic token means GitHub reports no expiry. From a fine-grained token it means nothing was said.
  if (parsed && parsed.kind === 'none' && kind === 'classic') return { expiresAt: null, expirySource: 'none' };
  // GitHub said nothing usable this time: what was known for the SAME token (its earlier header, or a date master
  // typed) still stands rather than being forgotten because one reply was odd.
  if (prev && typeof prev.expiresAt === 'number') return { expiresAt: prev.expiresAt, expirySource: prev.expirySource };
  return { expiresAt: null, expirySource: 'unknown' };
}

/**
 * A NEW token was stored. Everything about the old one is dropped: a new token is a new fact.
 * @param {{kind:string, login?:string, parsed?:object, verified:boolean, now:number}} e
 */
function recordSaved(e) {
  const x = expiryFrom(e.parsed, e.kind, null);
  return {
    kind: e.kind === 'classic' ? 'classic' : 'fine-grained',
    login: typeof e.login === 'string' ? e.login : '',
    savedAt: e.now,
    expiresAt: x.expiresAt,
    expirySource: x.expirySource,
    verifiedAt: e.verified ? e.now : null,
    rejectedAt: null,
  };
}

/** GitHub accepted the stored token again (TEST). */
function recordAccepted(prev, e) {
  if (!prev) return null;
  const x = expiryFrom(e.parsed, e.kind || prev.kind, prev);
  return { ...prev, kind: e.kind || prev.kind, login: typeof e.login === 'string' && e.login ? e.login : prev.login, expiresAt: x.expiresAt, expirySource: x.expirySource, verifiedAt: e.now, rejectedAt: null };
}

/** GitHub, or a git command, refused the stored token. */
function recordRejected(prev, now) {
  if (!prev) return null;
  return { ...prev, rejectedAt: now };
}

/** Master typed the date GitHub's page shows. Refused when GitHub already reports the expiry. */
function recordManual(prev, ms) {
  if (!prev) return { ok: false, error: 'No token is stored yet.' };
  if (prev.expirySource === 'github') return { ok: false, error: 'GitHub already reports this token\'s expiry, so a typed date is not needed.' };
  return { ok: true, record: { ...prev, expiresAt: ms, expirySource: 'manual' } };
}

// ─── The verdict ─────────────────────────────────────────────────────────────────────────────────
/** @returns {'none'|'rejected'|'expired'|'unverified'|'expiring'|'ok'|'no-expiry'|'unknown-expiry'} */
function stateOf(record, now) {
  if (!record || typeof record !== 'object') return 'none';
  if (record.rejectedAt && (!record.verifiedAt || record.rejectedAt >= record.verifiedAt)) return 'rejected';
  const known = typeof record.expiresAt === 'number';
  if (known && record.expiresAt <= now) return 'expired';
  if (!record.verifiedAt) return 'unverified';
  if (known) return record.expiresAt - now <= WARN_MS ? 'expiring' : 'ok';
  return record.expirySource === 'none' ? 'no-expiry' : 'unknown-expiry';
}

/** What the window is told. Contains no secret. */
function noticeOf(record, now) {
  const state = stateOf(record, now);
  const known = !!record && typeof record.expiresAt === 'number';
  return {
    state,
    persistent: PERSISTENT.has(state),
    autoHideMs: state === 'expiring' ? AUTO_HIDE_MS : 0,
    show: PERSISTENT.has(state) || state === 'expiring',
    kind: record ? record.kind : null,
    login: record ? record.login || '' : '',
    expiresAt: known ? record.expiresAt : null,
    msLeft: known ? record.expiresAt - now : null,
    expirySource: record ? record.expirySource : null,
    savedAt: record ? record.savedAt || null : null,
    verifiedAt: record ? record.verifiedAt || null : null,
    rejectedAt: record ? record.rejectedAt || null : null,
    warnDays: WARN_DAYS,
  };
}

module.exports = {
  DAY, WARN_DAYS, AUTO_HIDE_MS, UNRELIABLE_MS, HEADER,
  parseExpiryHeader, parseManualDate, looksLikeAuthFailure,
  recordSaved, recordAccepted, recordRejected, recordManual,
  stateOf, noticeOf,
};
