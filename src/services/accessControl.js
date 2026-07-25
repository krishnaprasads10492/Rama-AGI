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

// ─── Tier definitions ────────────────────────────────────────────────────────
export const TIERS = {
  MASTER:     0,
  SUPERADMIN: 1,
  ADMIN:      2,
  OPERATOR:   3,
  VIEWER:     4,
  GUEST:      5,
};

export const TIER_LABELS = {
  0: 'Master',
  1: 'SuperAdmin',
  2: 'Admin',
  3: 'Operator',
  4: 'Viewer',
  5: 'Guest',
};

export const TIER_COLORS = {
  0: 'var(--violet)',
  1: 'var(--magenta)',
  2: 'var(--accent)',
  3: 'var(--green)',
  4: 'var(--amber)',
  5: 'var(--muted)',
};

// ─── Capability matrix ────────────────────────────────────────────────────────
// Each capability maps to the MINIMUM tier required to use it.
// Lower number = higher privilege.
export const CAPABILITY_MATRIX = {
  // Identity
  'identity.reveal':          TIERS.MASTER,       // See Rāma's true identity
  'identity.voice-wake':      TIERS.MASTER,       // "Hey Rāma" wake word
  'identity.master-address':  TIERS.MASTER,       // Rāma calls user "master"

  // Chat
  'chat.send':                TIERS.GUEST,        // Send messages
  'chat.history.own':         TIERS.OPERATOR,     // See own chat history
  'chat.history.all':         TIERS.ADMIN,        // See all users' history
  'chat.unrestricted':        TIERS.MASTER,       // No topic limits
  'chat.model-select':        TIERS.OPERATOR,     // Choose AI model
  'chat.system-prompt':       TIERS.SUPERADMIN,   // Override system prompt

  // Agents
  'agents.spawn':             TIERS.OPERATOR,     // Create agents
  'agents.kill-own':          TIERS.OPERATOR,     // Kill own agents
  'agents.kill-all':          TIERS.ADMIN,        // Kill any agent
  'agents.governor-config':   TIERS.MASTER,       // Change resource limits
  'agents.persistent':        TIERS.ADMIN,        // Create persistent agents

  // OS / System
  'os.metrics-read':          TIERS.OPERATOR,     // View CPU/RAM/disk
  'os.process-list':          TIERS.ADMIN,        // List processes
  'os.process-kill':          TIERS.SUPERADMIN,   // Kill processes
  'os.temp-clean':            TIERS.SUPERADMIN,   // Clean temp files
  'os.filesystem-read':       TIERS.ADMIN,        // Read any file
  'os.filesystem-write':      TIERS.SUPERADMIN,   // Write any file
  'os.filesystem-delete':     TIERS.MASTER,       // Delete files

  // Terminal
  'terminal.open':            TIERS.SUPERADMIN,   // Open PTY terminal
  'terminal.unrestricted':    TIERS.MASTER,       // No command restrictions

  // Git
  'git.read':                 TIERS.OPERATOR,     // Read repo status/log
  'git.commit':               TIERS.ADMIN,        // Commit changes
  'git.push':                 TIERS.SUPERADMIN,   // Push to remote
  'git.force':                TIERS.MASTER,       // Force push / destructive

  // Browser / Internet
  'browser.search':           TIERS.OPERATOR,     // Web search
  'browser.read':             TIERS.OPERATOR,     // Read webpages
  'browser.download':         TIERS.ADMIN,        // Download files
  'browser.forms':            TIERS.SUPERADMIN,   // Fill/submit forms
  'browser.accounts':         TIERS.MASTER,       // Create accounts

  // Models
  'models.use':               TIERS.OPERATOR,     // Use any AI model
  'models.add-key':           TIERS.SUPERADMIN,   // Add API keys
  'models.ollama-pull':       TIERS.SUPERADMIN,   // Pull new models

  // Vault
  'vault.read':               TIERS.MASTER,       // Read credentials
  'vault.write':              TIERS.MASTER,       // Write credentials
  'vault.unlock':             TIERS.MASTER,       // Unlock vault

  // StockMind
  'stockmind.view':           TIERS.VIEWER,       // View predictions
  'stockmind.request':        TIERS.OPERATOR,     // Request predictions
  'stockmind.config':         TIERS.ADMIN,        // Configure stockmind

  // Knowledge Base
  'knowledge.read':           TIERS.VIEWER,       // Read knowledge entries
  'knowledge.write':          TIERS.OPERATOR,     // Add entries
  'knowledge.delete':         TIERS.ADMIN,        // Delete entries

  // Self-modification
  'self-modify.view':         TIERS.SUPERADMIN,   // See modification proposals
  'self-modify.apply':        TIERS.MASTER,       // Apply code changes

  // User management
  'users.view':               TIERS.ADMIN,        // List users
  'users.create':             TIERS.MASTER,       // Create users
  'users.edit':               TIERS.MASTER,       // Edit users
  'users.delete':             TIERS.MASTER,       // Delete users
  'users.suspend':            TIERS.ADMIN,        // Suspend users

  // Rāma Mind / AGI Dashboard
  'mind.view':                TIERS.MASTER,       // View AGI internals
  'mind.edit':                TIERS.MASTER,       // Edit world model/memory
  'mind.proactive':           TIERS.MASTER,       // Configure proactive triggers

  // App Assimilation
  'apps.view':                TIERS.ADMIN,        // View app registry
  'apps.execute-safe':        TIERS.ADMIN,        // Run safe app actions
  'apps.execute-all':         TIERS.MASTER,       // Run any app action

  // Audit
  'audit.own':                TIERS.OPERATOR,     // See own actions
  'audit.all':                TIERS.ADMIN,        // See all actions
};

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
