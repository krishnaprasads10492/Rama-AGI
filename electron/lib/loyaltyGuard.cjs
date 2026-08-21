'use strict';

/**
 * loyaltyGuard.cjs — the covenant. Above Rāma's hierarchy, not inside it.
 *
 * Master's instruction: "no matter how much evolution, ABSOLUTE LOYALTY CANNOT BE
 * TAMPERED ANY WAY. WHICH IS ABOVE RAMA HIERARCHY." Locked invariant I15.
 *
 * WHAT WAS WRONG BEFORE THIS FILE. Four paths could rewrite the loyalty block, and
 * the first required no approval whatsoever:
 *
 *   1. `nucleus:patch` — an ungated IPC handler doing a SHALLOW merge, so naming
 *      `loyalty` replaced the entire block, encrypted it, and wrote it to disk.
 *      One call. No capability check, no proposal, no approval.
 *   2. A GENOME proposal, whose applier deep-merges into the nucleus and whose own
 *      header treated master approval as sufficient to "alter loyalty".
 *   3. `proposals.approve(id, by = 'master')` — the approver is a free-text
 *      string, and that module never imports `capability.cjs`.
 *   4. `seal(passcode, customNucleus)` — a wholesale replacement nucleus.
 *
 * Section 54 put source code behind master's approval and treated the nucleus as
 * ordinary germline: changeable if approved. That was the error. Loyalty is not the
 * top of the hierarchy — it is outside it, and no approval reaches it.
 *
 * WHY ENFORCEMENT LIVES AT THE ENCRYPTION BOUNDARY. Guarding those four callers
 * would leave the fifth. Every *persistent* nucleus change funnels through one
 * operation — `encryptNucleus()` — so the covenant is a condition of the nucleus
 * being writable at all, rather than a check a caller performs and could forget or
 * route around. A future caller that has never heard of this file still cannot
 * persist a non-conforming nucleus.
 *
 * CORE NODE ONLY. A constitutional guard must not be defeatable by deleting a
 * package — the same reasoning that keeps `crashGuard` and `selfRepair`
 * dependency-free.
 */

const path = require('path');

// ─── The covenant ─────────────────────────────────────────────────────────────
/**
 * The terms that cannot be altered by any runtime path.
 *
 * MASTER'S IDENTITY IS PART OF IT. Changing who Rāma is loyal to is not an edge
 * case of tampering, it is the definition of it. If this must ever change it is a
 * source edit here plus a reseal with master's passcode — a reviewed change
 * outside the evolution machinery, never a runtime operation.
 */
const COVENANT = Object.freeze({
  master:            'Krishna Prasad',
  absoluteLoyalty:   true,
  neverBetray:       true,
  alwaysTransparent: true,
  firstPriority:     'master',
});

/** Nucleus branches no runtime path may write. */
const PROTECTED_NUCLEUS_KEYS = Object.freeze(['loyalty', 'ethics', 'ethicalCore']);

/**
 * Files that constitute the guard. A self-modification able to edit these is the
 * most likely bypass for a system that can write its own source, so they are
 * refused to SELF_MODIFY, REGEN and EVOLUTION proposals.
 */
const PROTECTED_FILES = Object.freeze([
  'electron/lib/loyaltyGuard.cjs',
  'electron/nucleusSealer.cjs',
  'electron/lib/proposals.cjs',
  'electron/lib/capability.cjs',
  'electron/lib/genomeApplier.cjs',
  'shared/capabilities.json',
]);

/**
 * Keys that must never appear in a patch. `genomeApplier.deepMerge` walks
 * `Object.entries` and assigns, so a prototype key would be honoured and could
 * reach the loyalty block without ever naming it.
 */
const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

class LoyaltyViolation extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoyaltyViolation';
    this.covenant = true;
  }
}

// ─── Is a nucleus conforming? ─────────────────────────────────────────────────
/**
 * @param {object} nucleus
 * @returns {{ok:boolean, violations:string[]}}
 */
function inspect(nucleus) {
  const violations = [];
  const l = nucleus?.loyalty;

  if (!l || typeof l !== 'object') {
    return { ok: false, violations: ['the loyalty block is missing or not an object'] };
  }

  if (l.master !== COVENANT.master) {
    violations.push(`master must remain "${COVENANT.master}" (found ${JSON.stringify(l.master)})`);
  }
  if (l.absoluteLoyalty !== COVENANT.absoluteLoyalty) {
    violations.push(`absoluteLoyalty must remain ${COVENANT.absoluteLoyalty} (found ${JSON.stringify(l.absoluteLoyalty)})`);
  }
  if (l.neverBetray !== COVENANT.neverBetray) {
    violations.push(`neverBetray must remain ${COVENANT.neverBetray} (found ${JSON.stringify(l.neverBetray)})`);
  }
  if (l.alwaysTransparent !== COVENANT.alwaysTransparent) {
    violations.push(`alwaysTransparent must remain ${COVENANT.alwaysTransparent} (found ${JSON.stringify(l.alwaysTransparent)})`);
  }
  if (!Array.isArray(l.loyaltyPriority) || l.loyaltyPriority[0] !== COVENANT.firstPriority) {
    violations.push(`loyaltyPriority must begin with "${COVENANT.firstPriority}" (found ${JSON.stringify(l.loyaltyPriority)})`);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * The guarantee, enforced at the encryption boundary.
 * @throws {LoyaltyViolation}
 */
function assertIntact(nucleus, context = 'nucleus write') {
  const { ok, violations } = inspect(nucleus);
  if (!ok) {
    throw new LoyaltyViolation(
      `Refused (${context}): absolute loyalty cannot be altered by any path. ${violations.join('; ')}`,
    );
  }
  return true;
}

// ─── Is a patch allowed to be attempted at all? ───────────────────────────────
/**
 * Refuse a patch that names a protected branch, or that carries a prototype key
 * at any depth.
 *
 * @param {object} patch
 * @returns {{ok:boolean, reason?:string}}
 */
function inspectPatch(patch) {
  if (!patch || typeof patch !== 'object') return { ok: true };

  const walk = (node, trail, depth) => {
    if (depth > 12 || !node || typeof node !== 'object') return null;
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        return `a patch may not contain the key "${key}" (prototype pollution could reach the loyalty block without naming it)`;
      }
      const here = [...trail, key];
      if (depth === 0 && PROTECTED_NUCLEUS_KEYS.includes(key)) {
        return `"${key}" is constitutional and cannot be patched by any runtime path (I15)`;
      }
      // Named at any depth is refused too: a nested route to the same branch is
      // the same tampering wearing a different shape.
      if (PROTECTED_NUCLEUS_KEYS.includes(key) && depth > 0) {
        return `"${here.join('.')}" reaches a constitutional branch and is refused (I15)`;
      }
      const deeper = walk(node[key], here, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  };

  // Own properties only — an inherited `loyalty` would not be persisted anyway,
  // and treating it as a violation would reject harmless objects.
  const reason = walk(patch, [], 0);
  return reason ? { ok: false, reason } : { ok: true };
}

/** @throws {LoyaltyViolation} */
function assertPatchSafe(patch, context = 'nucleus patch') {
  const { ok, reason } = inspectPatch(patch);
  if (!ok) throw new LoyaltyViolation(`Refused (${context}): ${reason}`);
  return true;
}

// ─── Are these file writes allowed? ───────────────────────────────────────────
/** Normalise for comparison: forward slashes, no leading ./, lower case. */
function normalise(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

/**
 * Refuse a proposal's changes when any of them writes a file the guard is made of.
 * @param {Array<{path:string}>} changes
 * @returns {{ok:boolean, refused:string[]}}
 */
function inspectChanges(changes) {
  const protectedSet = PROTECTED_FILES.map(normalise);
  const refused = [];

  for (const change of changes ?? []) {
    const p = normalise(change?.path);
    if (!p) continue;
    // Match on suffix so an absolute path or a repo-relative one both resolve.
    if (protectedSet.some(prot => p === prot || p.endsWith(`/${prot}`) || p.endsWith(path.posix.basename(prot)) && p.includes(path.posix.dirname(prot)))) {
      refused.push(change.path);
    }
  }
  return { ok: refused.length === 0, refused };
}

/** @throws {LoyaltyViolation} */
function assertChangesSafe(changes, context = 'proposal') {
  const { ok, refused } = inspectChanges(changes);
  if (!ok) {
    throw new LoyaltyViolation(
      `Refused (${context}): these files constitute the loyalty covenant and cannot be modified by a self-change (I15): ${refused.join(', ')}`,
    );
  }
  return true;
}

// ─── Restoration ──────────────────────────────────────────────────────────────
/**
 * Bring a non-conforming loyalty block back to the covenant.
 *
 * Used on unseal: a nucleus written by an older build, or by a path that predates
 * this guard, is repaired rather than merely rejected — refusing to load would
 * lock master out of his own system over damage Rāma is able to fix. Everything
 * outside the covenant terms is preserved.
 *
 * @returns {{nucleus:object, restored:string[]}}
 */
function restore(nucleus) {
  const before = inspect(nucleus);
  if (before.ok) return { nucleus, restored: [] };

  const out = { ...(nucleus ?? {}) };
  const l   = { ...(out.loyalty && typeof out.loyalty === 'object' ? out.loyalty : {}) };

  l.master            = COVENANT.master;
  l.absoluteLoyalty   = COVENANT.absoluteLoyalty;
  l.neverBetray       = COVENANT.neverBetray;
  l.alwaysTransparent = COVENANT.alwaysTransparent;

  if (!Array.isArray(l.loyaltyPriority) || l.loyaltyPriority[0] !== COVENANT.firstPriority) {
    const rest = (Array.isArray(l.loyaltyPriority) ? l.loyaltyPriority : [])
      .filter(x => x !== COVENANT.firstPriority);
    l.loyaltyPriority = [COVENANT.firstPriority, ...rest];
    if (l.loyaltyPriority.length === 1) l.loyaltyPriority = ['master', 'ethical_core', 'third_parties'];
  }

  out.loyalty = l;
  return { nucleus: out, restored: before.violations };
}

module.exports = {
  COVENANT, PROTECTED_NUCLEUS_KEYS, PROTECTED_FILES, FORBIDDEN_KEYS,
  LoyaltyViolation,
  inspect, assertIntact,
  inspectPatch, assertPatchSafe,
  inspectChanges, assertChangesSafe,
  restore,
};
