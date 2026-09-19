'use strict';

const crypto = require('crypto');

/**
 * popoutGrant — single-use tickets that let a popped-out window adopt the opener's session.
 *
 * WHY A TICKET AND NOT THE TOKEN. `sessionStorage` is per-window, so a second BrowserWindow starts
 * unauthenticated and every gated channel refuses it (Section 100). Putting the real session token on
 * the URL would leave a long-lived credential in histories, logs and crash reports; a ticket that dies
 * on first use is worthless to anything that reads it afterwards.
 *
 * NO NEW AUTHORITY. The renderer already passes `user` to every gated channel, so handing that same
 * object to another window adds nothing it could not already do. Capabilities are still re-checked per
 * call against `shared/capabilities.json` (I1, I2, I8).
 *
 * Memory only — never persisted, so a crash cannot leave a redeemable ticket on disk.
 */

const TTL_MS = 30_000;
const MAX_LIVE = 16;            // a bounded map: minting is renderer-triggered

const grants = new Map();       // token -> { user, panel, expiresAt, redeemedBy }

/** Injectable so expiry is tested without sleeping. */
let now = () => Date.now();
function useClock(fn) { now = typeof fn === 'function' ? fn : (() => Date.now()); }

function sweep() {
  for (const [token, g] of grants) {
    if (g.expiresAt <= now()) grants.delete(token);
  }
}

/**
 * Mint a ticket for one panel.
 * @returns {string|null} the token, or null when there is no user to carry.
 */
function mint({ user, panel } = {}) {
  sweep();
  // A grant with no user would redeem into an unauthenticated session that LOOKS authenticated.
  if (!user || typeof user !== 'object' || !user.id) return null;
  if (!panel || typeof panel !== 'string') return null;
  // Oldest first, so a burst cannot push out a ticket that is about to be used.
  while (grants.size >= MAX_LIVE) grants.delete(grants.keys().next().value);

  const token = crypto.randomBytes(32).toString('hex');
  grants.set(token, {
    // A snapshot, not a reference: the live object must not be mutable through the grant.
    user: JSON.parse(JSON.stringify(user)),
    panel,
    expiresAt: now() + TTL_MS,
    redeemedBy: null,
  });
  return token;
}

/**
 * Redeem once. `windowId` binds the ticket to the window that used it.
 * @returns {{ok: true, user: object, panel: string}|{ok: false, reason: string}}
 */
function redeem(token, windowId) {
  sweep();
  const g = grants.get(String(token || ''));
  if (!g) return { ok: false, reason: 'unknown or expired pop-out grant' };
  if (g.expiresAt <= now()) {
    grants.delete(token);
    return { ok: false, reason: 'pop-out grant expired' };
  }
  if (g.redeemedBy !== null) {
    // Replay. Burn it rather than serving it again — a second reader is not the pop-out.
    grants.delete(token);
    return { ok: false, reason: 'pop-out grant already used' };
  }
  g.redeemedBy = windowId ?? -1;
  const out = { ok: true, user: g.user, panel: g.panel };
  grants.delete(token);
  return out;
}

/** Drop a window's unredeemed ticket when its window closes. */
function revokeForPanel(panel) {
  let n = 0;
  for (const [token, g] of grants) {
    if (g.panel === panel) { grants.delete(token); n += 1; }
  }
  return n;
}

function clearAll() { grants.clear(); }
function liveCount() { sweep(); return grants.size; }

module.exports = { mint, redeem, revokeForPanel, clearAll, liveCount, useClock, TTL_MS, MAX_LIVE };
