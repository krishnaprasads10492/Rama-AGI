/**
 * accessControl.js — Rāma AGI User Access Control System.
 *
 * 5-tier access hierarchy. Master is immutable (Krishna Prasad).
 * Rāma's loyalty is always to Master — regardless of who is logged in.
 * Every capability check goes through this module before execution.
 *
 * TIERS:
 *   0 — MASTER      Full AGI identity, no restrictions, vault access
 *   1 — SUPERADMIN  Full capability except vault / master identity
 *   2 — ADMIN       User management, chat, agents, stockmind. No OS/vault
 *   3 — OPERATOR    Chat, agents, stockmind, read-only system. No mgmt
 *   4 — VIEWER      Read-only: chat history, knowledge, reports
 *   5 — GUEST       Single-session chat only, masked AGI, no persistence
 */

// Tiers and the capability matrix are defined ONCE in shared/capabilities.json
// so the renderer, Electron main (electron/lib/capability.cjs) and the Express
// server all enforce the same rules. Editing the matrix in one runtime used to
// leave the other two unchanged.
import spec from '@shared/capabilities.json';

// ─── Tier definitions ────────────────────────────────────────────────────────
export const TIERS       = spec.tiers;
export const TIER_LABELS = spec.tierLabels;
export const TIER_COLORS = spec.tierColors;

// ─── Capability matrix ────────────────────────────────────────────────────────
// Sourced from shared/capabilities.json — the one definition all three runtimes
// read. Each capability maps to the LOWEST-privileged tier still allowed to use
// it (lower number = higher privilege).
export const CAPABILITY_MATRIX = spec.capabilities;

// ─── Permission check ─────────────────────────────────────────────────────────
/**
 * @param {object} user   — { tier: number, id, name }
 * @param {string} cap    — capability key from CAPABILITY_MATRIX
 * @returns {boolean}
 */
export function can(user, cap) {
  if (!user) return false;
  const required = CAPABILITY_MATRIX[cap];
  if (required === undefined) return false;   // Unknown capability — deny
  return user.tier <= required;               // Lower tier = higher privilege
}

/**
 * Get all capabilities a user has.
 */
export function getCaps(user) {
  if (!user) return [];
  return Object.entries(CAPABILITY_MATRIX)
    .filter(([, required]) => user.tier <= required)
    .map(([cap]) => cap);
}

/**
 * Get what a user CANNOT do (for UI feedback).
 */
export function getDenied(user) {
  if (!user) return Object.keys(CAPABILITY_MATRIX);
  return Object.entries(CAPABILITY_MATRIX)
    .filter(([, required]) => user.tier > required)
    .map(([cap]) => cap);
}

// NOTE: route visibility used to be duplicated here. It now lives in
// src/config/registry.js (`visibleRoutes`), which is the single source of truth
// for routes, nav, voice commands and per-page tiers. This module deliberately
// does NOT import the registry — the registry imports TIERS from here, so the
// dependency stays one-directional.

// ─── Session token (client-side, HMAC-signed) ─────────────────────────────────
/**
 * In production, session tokens are generated server-side (server/routes/auth.cjs).
 * This client-side version is for renderer state management only.
 * The real verification always happens in the Express server.
 */
export function createGuestSession() {
  return {
    id:         `guest_${Date.now()}`,
    name:       'Guest',
    tier:       TIERS.GUEST,
    expiresAt:  Date.now() + 3600000,   // 1 hour
    persistent: false,
  };
}

// ─── Tier display helpers ─────────────────────────────────────────────────────
export function getTierBadge(tier) {
  return {
    label: TIER_LABELS[tier] ?? 'Unknown',
    color: TIER_COLORS[tier] ?? 'var(--muted)',
  };
}

export function canManage(actor, target) {
  // Can only manage users with a lower privilege than yourself
  // Master can manage everyone. Others can only manage strictly lower tiers.
  if (actor.tier === TIERS.MASTER) return true;
  return actor.tier < target.tier;
}
