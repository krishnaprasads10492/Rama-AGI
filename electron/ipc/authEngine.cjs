'use strict';

/**
 * authEngine.cjs — IPC surface for authentication and provisioning.
 *
 * Binds authCore (the logic) to dataStore (the encrypted storage), so user
 * records live inside the same AES-256-GCM store as everything else. There is no
 * plaintext user file anywhere on disk.
 *
 * BOOT ORDER MATTERS: the store is locked until the passcode is entered, so no
 * user record can be read or written before gate 1 has passed. Every handler
 * here fails closed if the store is locked rather than degrading to an
 * unauthenticated path.
 *
 * THE THREE GATES:
 *   1. passcode  → sessionManager unlocks cryptoCore + dataStore
 *   2. password  → auth:login-step1  (Argon2id)
 *   3. key       → auth:login-step2  (12-digit HMAC)
 *
 * FIRST RUN: if the store unlocks and no user exists, `auth:instance-info`
 * reports `provisioned: false` and the UI shows the setup wizard. The user
 * never has to open the source to configure their instance.
 */

const authCore   = require('../lib/authCore.cjs');
const capability = require('../lib/capability.cjs');

const DOMAIN    = 'instances';    // encrypted domain that also holds instance meta
const USERS_KEY = 'accounts';
const META_KEY  = 'instanceMeta';

let storeReady = false;

// ─── Storage adapter over the encrypted dataStore ─────────────────────────────
function ds() {
  return require('../dataStore.cjs');
}

function storeUnlocked() {
  try { return require('../cryptoCore.cjs').isUnlocked(); }
  catch { return false; }
}

const adapter = {
  listUsers() {
    const rows = ds().get(DOMAIN, USERS_KEY);
    return Array.isArray(rows) ? rows : [];
  },

  putUser(user) {
    const rows = adapter.listUsers();
    const idx  = rows.findIndex(u => u.userId === user.userId);
    if (idx >= 0) rows[idx] = user;
    else rows.push(user);
    ds().set(DOMAIN, USERS_KEY, rows);
    ds().saveDomain?.(DOMAIN);
  },

  deleteUser(userId) {
    ds().set(DOMAIN, USERS_KEY, adapter.listUsers().filter(u => u.userId !== userId));
    ds().saveDomain?.(DOMAIN);
  },

  readMeta() {
    return ds().get(DOMAIN, META_KEY) ?? {};
  },

  writeMeta(meta) {
    ds().set(DOMAIN, META_KEY, meta);
    ds().saveDomain?.(DOMAIN);
  },
};

/** Wire the adapter once the store is actually unlocked. */
function attachStorage() {
  if (storeReady) return true;
  if (!storeUnlocked()) return false;
  authCore.setStorage(adapter);
  storeReady = true;
  return true;
}

function locked() {
  return { ok: false, error: 'Encrypted store is locked — enter the passcode first', locked: true };
}

/** Guard every handler: no store, no auth. */
function withStore(fn) {
  return async (...args) => {
    if (!attachStorage()) return locked();
    try { return await fn(...args); }
    catch (err) { return { ok: false, error: err.message }; }
  };
}

// ─── Session helpers ──────────────────────────────────────────────────────────
/** Resolve a token to an actor, or null. Used to authorise management calls. */
function actorFor(token, fp) {
  return authCore.validateSession(token, fp);
}

function requireCap(token, fp, cap) {
  const actor = actorFor(token, fp);
  if (!actor) return { error: { ok: false, error: 'Session expired — sign in again', reauth: true } };
  if (!capability.can(actor, cap)) {
    const who = capability.TIER_LABELS[String(actor.tier)] ?? 'this account';
    return { error: { ok: false, error: `${who} is not permitted to do this (needs "${cap}")` } };
  }
  return { actor };
}

// ─── IPC registration ─────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Instance / provisioning ────────────────────────────────────────────────
  // Deliberately answers even while the store is locked so the UI can decide
  // which gate to show without leaking anything about the accounts.
  ipcMain.handle('auth:instance-info', async () => {
    if (!attachStorage()) {
      return { ok: true, data: { storeLocked: true, provisioned: null } };
    }
    return { ok: true, data: { storeLocked: false, ...authCore.instanceInfo() } };
  });

  ipcMain.handle('auth:provision', withStore(async (_e, opts) => {
    const res = await authCore.provision(opts || {});
    if (res.ok) {
      console.warn(`[auth] Instance provisioned — owner tier ${res.tier} (${res.tierLabel})`);
    }
    return res;
  }));

  // ── Login ──────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login-step1', withStore(async (_e, { username, password } = {}) =>
    authCore.loginStep1(username, password)
  ));

  ipcMain.handle('auth:login-step2', withStore(async (_e, { stepToken, key, fingerprint } = {}) =>
    authCore.loginStep2(stepToken, key, fingerprint)
  ));

  ipcMain.handle('auth:logout', withStore(async (_e, token) => authCore.logout(token)));

  ipcMain.handle('auth:me', withStore(async (_e, { token, fingerprint } = {}) => {
    const actor = actorFor(token, fingerprint);
    if (!actor) return { ok: false, error: 'No valid session', reauth: true };
    const user = authCore.findById(actor.userId);
    return { ok: true, user: authCore.publicUser(user), expiresAt: actor.expiresAt };
  }));

  // ── Access keys ────────────────────────────────────────────────────────────
  ipcMain.handle('auth:keygen', withStore(async (_e, { token, fingerprint, password, daysValid } = {}) => {
    const actor = actorFor(token, fingerprint);
    if (!actor) return { ok: false, error: 'Session expired — sign in again', reauth: true };
    return authCore.keygenAuthenticated(actor.userId, password, daysValid);
  }));

  ipcMain.handle('auth:keygen-step', withStore(async (_e, stepToken) =>
    authCore.keygenFromStepToken(stepToken)
  ));

  ipcMain.handle('auth:keygen-credentials', withStore(async (_e, { username, password } = {}) =>
    authCore.keygenFromCredentials(username, password)
  ));

  // Master/superadmin issuing a key on another account's behalf
  ipcMain.handle('auth:issue-key', withStore(async (_e, { token, fingerprint, userId, daysValid } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.edit');
    if (gate.error) return gate.error;
    return authCore.issueAccessKey(userId, daysValid);
  }));

  // ── Passwords ──────────────────────────────────────────────────────────────
  ipcMain.handle('auth:change-password', withStore(async (_e, { token, fingerprint, currentPassword, newPassword } = {}) => {
    const actor = actorFor(token, fingerprint);
    if (!actor) return { ok: false, error: 'Session expired — sign in again', reauth: true };
    return authCore.changePassword(actor.userId, currentPassword, newPassword, false);
  }));

  ipcMain.handle('auth:reset-password', withStore(async (_e, { token, fingerprint, userId, newPassword } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.edit');
    if (gate.error) return gate.error;
    const target = authCore.findById(userId);
    if (!target) return { ok: false, error: 'User not found' };
    if (target.tier === capability.TIERS.MASTER) {
      return { ok: false, error: 'The master password cannot be reset by another account' };
    }
    return authCore.changePassword(userId, null, newPassword, true);
  }));

  ipcMain.handle('auth:check-password', async (_e, password) =>
    ({ ok: true, data: authCore.checkPasswordStrength(String(password ?? '')) })
  );

  // ── User management ────────────────────────────────────────────────────────
  ipcMain.handle('auth:list-users', withStore(async (_e, { token, fingerprint } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.view');
    if (gate.error) return gate.error;
    return { ok: true, data: authCore.listUsers() };
  }));

  ipcMain.handle('auth:create-user', withStore(async (_e, { token, fingerprint, ...fields } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.create');
    if (gate.error) return gate.error;
    return authCore.createUser(gate.actor, fields);
  }));

  ipcMain.handle('auth:set-tier', withStore(async (_e, { token, fingerprint, userId, tier } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.edit');
    if (gate.error) return gate.error;
    return authCore.setUserTier(gate.actor, userId, tier);
  }));

  ipcMain.handle('auth:set-active', withStore(async (_e, { token, fingerprint, userId, isActive } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.suspend');
    if (gate.error) return gate.error;
    return authCore.setActive(gate.actor, userId, isActive);
  }));

  ipcMain.handle('auth:delete-user', withStore(async (_e, { token, fingerprint, userId } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.delete');
    if (gate.error) return gate.error;
    return authCore.deleteUser(gate.actor, userId);
  }));

  // ── Diagnostics ────────────────────────────────────────────────────────────
  ipcMain.handle('auth:sessions', withStore(async (_e, { token, fingerprint } = {}) => {
    const gate = requireCap(token, fingerprint, 'audit.all');
    if (gate.error) return gate.error;
    return { ok: true, data: authCore.activeSessions() };
  }));

  ipcMain.handle('auth:status', withStore(async (_e, { token, fingerprint } = {}) => {
    const gate = requireCap(token, fingerprint, 'users.view');
    if (gate.error) return gate.error;
    return { ok: true, data: authCore.status() };
  }));
}

module.exports = {
  register,
  attachStorage,
  validateSession: (token, fp) => (attachStorage() ? authCore.validateSession(token, fp) : null),
  authCore,
};
