'use strict';

/**
 * capability.cjs — main-process access to the capability matrix.
 *
 * The matrix itself lives in shared/capabilities.json so the renderer, the
 * Electron main process and the Express server all read the SAME definition.
 * Before this existed the tier table was declared three times, which meant a
 * capability could be tightened in one place and stay open in another.
 *
 * Convention: lower tier number = higher privilege. A capability's value is the
 * lowest-privileged tier still permitted to use it.
 */

const spec = require('../../shared/capabilities.json');

const TIERS        = spec.tiers;
const TIER_LABELS  = spec.tierLabels;
const TIER_COLORS  = spec.tierColors;
const MATRIX       = spec.capabilities;

/**
 * @param {{tier:number}|null} user
 * @param {string} cap
 * @returns {boolean} false for unknown capabilities — unknown means denied.
 */
function can(user, cap) {
  if (!user || typeof user.tier !== 'number') return false;
  const required = MATRIX[cap];
  if (required === undefined) return false;
  return user.tier <= required;
}

/** Every capability this user holds. */
function getCaps(user) {
  if (!user) return [];
  return Object.entries(MATRIX)
    .filter(([, required]) => user.tier <= required)
    .map(([cap]) => cap);
}

/** Assert form for guarding IPC handlers. Throws so callers fail closed. */
function require_(user, cap) {
  if (!can(user, cap)) {
    const label = TIER_LABELS[String(user?.tier)] ?? 'unauthenticated';
    throw new Error(`Access denied: "${cap}" is not available to ${label}`);
  }
  return true;
}

function isMaster(user) {
  return user?.tier === TIERS.MASTER;
}

/**
 * Non-throwing gate for the common `{ ok:false, error }` IPC response shape.
 * Returns null when allowed, or the denial object to return immediately when
 * not. Introduced because most IPC files were hand-rolling this exact check
 * inconsistently (some checked, most didn't) — see
 * RAMA_AGI_MASTER_SPEC.md's fix pass for the systemic gap this closes.
 *
 * Usage:
 *   const denied = capability.deny(user, 'fs.write');
 *   if (denied) return denied;
 */
function deny(user, cap) {
  if (can(user, cap)) return null;
  const who = TIER_LABELS[String(user?.tier)] ?? 'This account';
  return { ok: false, error: `${who} may not do this (needs "${cap}")` };
}

module.exports = {
  TIERS, TIER_LABELS, TIER_COLORS, MATRIX,
  can, getCaps, isMaster, deny,
  requireCap: require_,
  version: spec.version,
};
