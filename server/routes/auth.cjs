'use strict';

/**
 * auth.cjs — deliberately NOT an authentication provider.
 *
 * WHY THIS FILE IS ALMOST EMPTY:
 *   This module used to be a second, weaker way into Rāma. It kept its own
 *   in-memory user table, seeded a Master account with a hardcoded default
 *   password, and issued a session token from a single POST to
 *   http://localhost:4097/api/auth/login. That bypassed the entire three-gate
 *   design: no store passcode, no access key, one factor, tier 0.
 *
 *   Authentication now has exactly one implementation:
 *     electron/lib/authCore.cjs   the logic
 *     electron/ipc/authEngine.cjs the IPC surface
 *     electron/dataStore.cjs      the AES-256-GCM store the records live in
 *
 *   The Express server runs as a separate process and cannot read the encrypted
 *   store, so it has no basis on which to authenticate anyone. Rather than
 *   approximate it with a weaker scheme, it declines and says why.
 *
 * WHAT REMAINS HERE:
 *   - Honest 501 responses on every auth route, so a stale client gets an
 *     explanation instead of a silent failure or a fake session.
 *   - `requireLocalToken`, a per-boot shared-secret guard for any future route
 *     that must be reachable over HTTP but not by arbitrary local processes.
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

// Tiers come from shared/capabilities.json — the one definition all three
// runtimes read (renderer, Electron main, this server).
const { TIERS, TIER_LABELS, can } = require('../../electron/lib/capability.cjs');

// ─── Per-boot local token ─────────────────────────────────────────────────────
/**
 * The launcher hands the server a random token via RAMA_SERVER_TOKEN. Any HTTP
 * caller that cannot present it is some other process on the machine, not our
 * own UI. When no token is configured the guard fails closed rather than open.
 */
const LOCAL_TOKEN = process.env.RAMA_SERVER_TOKEN || null;

if (!LOCAL_TOKEN) {
  console.warn('[auth] RAMA_SERVER_TOKEN not set — token-guarded routes will refuse all callers');
}

function requireLocalToken(req, res, next) {
  if (!LOCAL_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: 'Server has no boot token configured — refusing rather than trusting the caller',
    });
  }

  const supplied = req.headers['x-rama-token'];
  if (typeof supplied !== 'string' || supplied.length !== LOCAL_TOKEN.length) {
    return res.status(401).json({ ok: false, error: 'Missing or malformed boot token' });
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(LOCAL_TOKEN);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Invalid boot token' });
  }

  return next();
}

// ─── Closed auth surface ──────────────────────────────────────────────────────
const NOT_HERE = {
  ok: false,
  error: 'Authentication happens in the desktop app, not over HTTP. '
       + 'Accounts live in the encrypted store, which only the Electron main '
       + 'process can open.',
  useIpc: 'window.rama.auth.*',
  gates: [
    'passcode — unlocks the AES-256-GCM store',
    'password — Argon2id, returns a 10-minute step token',
    'access key — 12 digits, returns the session token',
  ],
};

for (const route of ['/login', '/login-step1', '/login-step2', '/logout', '/me', '/provision']) {
  router.all(route, (_req, res) => res.status(501).json(NOT_HERE));
}

// The old build also mounted user management under this router. Same answer.
for (const route of ['/', '/:id', '/:id/suspend']) {
  router.all(route, (_req, res) => res.status(501).json({
    ...NOT_HERE,
    error: 'User management happens in the desktop app. Use the Users page.',
    useIpc: 'window.rama.auth.listUsers / createUser / setTier / setActive / deleteUser',
  }));
}

// ─── Public, non-sensitive: what the tier ladder means ────────────────────────
// Useful for documentation and diagnostics. Reveals no accounts and no secrets.
router.get('/tiers', (_req, res) => {
  res.json({
    ok: true,
    data: {
      tiers: TIERS,
      labels: TIER_LABELS,
      note: 'Lower number = higher privilege. Master (0) is provisioned once and is not grantable.',
    },
  });
});

module.exports = router;
module.exports.requireLocalToken = requireLocalToken;
module.exports.TIERS = TIERS;
module.exports.can   = can;
