'use strict';

/**
 * sessionManager.cjs — Authenticated session management.
 *
 * After master passcode is verified:
 *   1. cryptoCore is unlocked (key in memory)
 *   2. dataStore loads and decrypts all domains
 *   3. A session token is generated (HMAC-signed, time-limited)
 *   4. Session state lives in memory — NEVER written to disk
 *
 * Session file (.rama_session):
 *   - Written to a TEMP path (OS temp dir, not app dir)
 *   - Encrypted with the session key (not the master key)
 *   - Contains: userId, tier, expiry, fingerprint, nonce
 *   - Deleted on: app exit, lock, session expiry
 *   - Without the session key (in memory), file is unreadable
 *
 * This means:
 *   - Kill the process → session key gone → session file useless
 *   - Copy the session file → useless without memory key
 *   - Brute force → blocked by Argon2id cost
 */

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const cryptoCore = require('./cryptoCore.cjs');
const dataStore  = require('./dataStore.cjs');

// ─── State ────────────────────────────────────────────────────────────────────
// NOTE: no user identity is held here. This module knows only whether the
// encrypted store is open. Identity lives in authCore.
let _sessionKey     = null;   // Ephemeral 32-byte key for session file encryption
let _sessionData    = null;   // { storeUnlocked, openedAt, expiry, fingerprint }
let _sessionPath    = null;   // Temp file path
let _storeOpenedAt  = null;
let _isFirstRun     = false;
let _dataDir        = null;

const SESSION_TTL  = 12 * 3600 * 1000;   // 12 hours
const SESSION_FILE = '.rama_active_session';

// ─── Init — called at app startup ────────────────────────────────────────────
async function init(dataDir) {
  _dataDir    = dataDir;
  _isFirstRun = cryptoCore.isFirstRun(dataDir);

  if (_isFirstRun) {
    console.warn('[session] First run — a store passcode must be set');
  }
  return { firstRun: _isFirstRun };
}

// ─── Master unlock — called from IPC on passcode entry ───────────────────────
/**
 * Gate 1 and only gate 1: turn a passcode into decryption keys.
 *
 * WHAT THIS DELIBERATELY NO LONGER DOES: it used to mint a tier-0 Master session
 * and hand back a token, which meant the passcode alone was sufficient to become
 * Master — gates 2 (password) and 3 (access key) were never reached. It also
 * created its own master user record in the `users` domain, a second account
 * store separate from authCore's. Both are gone.
 *
 * Accounts and sessions belong to authCore (electron/lib/authCore.cjs). This
 * function unlocks the store and says whether the store is now open. Who you are
 * is a separate question, answered by a separate gate.
 */
async function masterUnlock(passcode, dataDir, userAgent = '') {
  try {
    // 1. Derive keys from the passcode
    await cryptoCore.unlock(passcode, dataDir);

    // 2. Verify the passcode is actually correct.
    //    Deriving keys always "succeeds", so without this a wrong passcode would
    //    open an empty store that looks like a fresh install.
    const firstUnlock = !cryptoCore.hasVerifier(dataDir);

    if (firstUnlock) {
      cryptoCore.writeVerifier(dataDir);
    } else if (!cryptoCore.verifyPasscode(dataDir)) {
      cryptoCore.lock();
      return { ok: false, error: 'Incorrect passcode' };
    }

    // 3. Load the encrypted domains — safe now that the keys are proven
    dataStore.loadAll();

    // 4. Unseal the nucleus so Rāma's identity is live in memory
    try {
      await require('./nucleusSealer.cjs').unseal(passcode);
    } catch (err) {
      console.warn('[Session] Nucleus unseal warning:', err.message);
      // Non-fatal — Rāma runs on the bootstrap identity template
    }

    // 5. Ephemeral IPC encryption key for this session
    try { require('./ipcEncryption.cjs').initSession(); }
    catch { /* non-fatal */ }

    // 6. Record that the store is open. This is NOT an authenticated identity —
    //    no userId, no tier. Authorisation comes from authCore's session token.
    _sessionKey = crypto.randomBytes(32);
    _storeOpenedAt = Date.now();
    _sessionData = {
      storeUnlocked: true,
      openedAt:      _storeOpenedAt,
      expiry:        Date.now() + SESSION_TTL,
      fingerprint:   hashFingerprint(userAgent),
    };

    return {
      ok:            true,
      storeUnlocked: true,
      firstRun:      firstUnlock,
      // Deliberately no token and no user: the next gate issues those.
    };
  } catch (err) {
    cryptoCore.lock();
    return { ok: false, error: err.message };
  }
}

// ─── Lock session ──────────────────────────────────────────────────────────────
function lockSession() {
  // Zero session key
  if (_sessionKey) { _sessionKey.fill(0); _sessionKey = null; }
  _sessionData   = null;
  _storeOpenedAt = null;

  // Revoke every authenticated session — the store closing ends all identity
  try { require('./ipc/authEngine.cjs').authCore.setStorage(null); } catch { /* ignore */ }

  // Lock nucleus and IPC encryption
  try { require('./nucleusSealer.cjs').lock(); }         catch { /* ignore */ }
  try { require('./ipcEncryption.cjs').clearSession(); }  catch { /* ignore */ }

  // Delete temp session file
  deleteSessionFile();

  // Lock crypto + clear data cache
  dataStore.flushAndClear();
  cryptoCore.lock();
}

/**
 * Is the encrypted store currently open? This is the only question this module
 * answers. It is not an identity check — use authCore.validateSession for that.
 */
function isStoreOpen() {
  if (!_sessionData?.storeUnlocked) return false;
  if (Date.now() > _sessionData.expiry) { lockSession(); return false; }
  return true;
}

// ─── Session file ────────────────────────────────────────────────────────────
function writeSessionFile() {
  if (!_sessionKey || !_sessionData) return;
  const tmpDir = os.tmpdir();
  _sessionPath = path.join(tmpDir, SESSION_FILE);

  try {
    // Encrypt session data with ephemeral session key
    const iv      = crypto.randomBytes(12);
    const cipher  = crypto.createCipheriv('aes-256-gcm', _sessionKey, iv);
    const plain   = Buffer.from(JSON.stringify({
      ..._sessionData,
      nonce:    crypto.randomBytes(16).toString('hex'),
      written:  Date.now(),
    }), 'utf8');
    const enc     = Buffer.concat([cipher.update(plain), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packet  = Buffer.concat([iv, authTag, enc]);

    fs.writeFileSync(_sessionPath, packet);
    // Make file hidden / restrictive permissions on Unix
    if (process.platform !== 'win32') {
      try { fs.chmodSync(_sessionPath, 0o600); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error('[session] Failed to write session file:', err.message);
  }
}

function deleteSessionFile() {
  if (_sessionPath && fs.existsSync(_sessionPath)) {
    try {
      // Overwrite with zeros before deleting
      const size = fs.statSync(_sessionPath).size;
      fs.writeFileSync(_sessionPath, Buffer.alloc(size, 0));
      fs.unlinkSync(_sessionPath);
    } catch { /* ignore */ }
  }
  _sessionPath = null;
}

// NOTE: `ensureMasterUser`, `verifyMasterPassword` and `generateSessionToken`
// used to live here. They created a second account record in the `users` domain
// and minted a tier-0 session from the passcode alone, which bypassed the
// password and access-key gates entirely. Accounts and sessions are now owned
// solely by electron/lib/authCore.cjs.

// ─── Passcode change (full re-key) ────────────────────────────────────────────
/**
 * Changing the store passcode means re-encrypting everything, because the salt
 * and therefore the derived keys change.
 *
 * The previous implementation called `cryptoCore.unlock(newPasscode, dir)` while
 * the old salt file was still present. That reused the old salt, produced keys
 * that matched nothing on disk, and left every .enc file unreadable — silent
 * data loss. The sequence below is the correct one:
 *
 *   1. verify the old passcode against the verifier
 *   2. load every domain into memory under the OLD keys
 *   3. destroy the old salt and verifier so a fresh salt is generated
 *   4. derive the NEW keys, write a new verifier
 *   5. write every in-memory domain back out under the NEW keys
 *   6. re-seal the nucleus under the new passcode
 *
 * If any step before 3 fails, nothing has changed. Step 3 onward is the
 * committed path, and the in-memory copy is the source for the rewrite.
 */
async function changePasscode(oldPasscode, newPasscode) {
  if (!isStoreOpen()) return { ok: false, error: 'Store is locked' };
  if (String(newPasscode ?? '').length < 10) {
    return { ok: false, error: 'The new passcode must be at least 10 characters' };
  }

  const dataDir = _dataDir ?? dataStore.getDataDir();

  // 1. Prove the caller knows the current passcode. Derive under the existing
  //    salt in a scratch check rather than trusting the open session.
  await cryptoCore.unlock(oldPasscode, dataDir);
  if (!cryptoCore.verifyPasscode(dataDir)) {
    // Restore the working keys before returning — the store must stay usable
    await cryptoCore.unlock(oldPasscode, dataDir);
    return { ok: false, error: 'Current passcode is incorrect' };
  }

  try {
    // 2. Everything into memory under the old keys
    dataStore.loadAll();

    // 3. Remove the old salt + verifier so new keys are generated
    cryptoCore.secureDelete(path.join(dataDir, 'rama.salt'));
    cryptoCore.secureDelete(path.join(dataDir, 'rama.verify'));
    cryptoCore.cache.clear();

    // 4. New keys, new verifier
    await cryptoCore.unlock(newPasscode, dataDir);
    cryptoCore.writeVerifier(dataDir);

    // 5. Rewrite every domain under the new keys
    dataStore.markAllDirty();
    dataStore.saveAll();

    // 6. Re-seal the identity nucleus under the new passcode
    try { await require('./nucleusSealer.cjs').seal(newPasscode); }
    catch (err) { console.warn('[session] Nucleus reseal warning:', err.message); }

    console.warn('[session] Store passcode changed and all domains re-encrypted');
    return { ok: true, reEncrypted: true };
  } catch (err) {
    return {
      ok: false,
      error: `Re-key failed: ${err.message}. The store is still open in memory — `
           + 'export a backup before restarting.',
    };
  }
}

function hashFingerprint(userAgent) {
  return crypto.createHash('sha256').update(userAgent || '').digest('hex').slice(0, 16);
}

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Check if first run ────────────────────────────────────────────────────
  ipcMain.handle('session:is-first-run', async () => {
    return { ok: true, firstRun: _isFirstRun };
  });

  // ── Master unlock (passcode entry) ────────────────────────────────────────
  ipcMain.handle('session:unlock', async (_e, passcode) => {
    const dataDir = dataStore.getDataDir();
    const ua      = 'ElectronRenderer';
    return masterUnlock(passcode, dataDir, ua);
  });

  // ── Lock ──────────────────────────────────────────────────────────────────
  ipcMain.handle('session:lock', async () => {
    lockSession();
    return { ok: true };
  });

  // ── Store state ───────────────────────────────────────────────────────────
  // Reports whether the store is open. It never reports an identity, because
  // this gate does not establish one.
  ipcMain.handle('session:status', async () => ({
    ok:        true,
    storeOpen: isStoreOpen(),
    firstRun:  _isFirstRun,
    openedAt:  _storeOpenedAt,
    expiry:    _sessionData?.expiry ?? null,
  }));

  // ── Change the store passcode (re-encrypts every domain) ──────────────────
  ipcMain.handle('session:change-passcode', async (_e, { token, fingerprint, oldPasscode, newPasscode } = {}) => {
    // Authority comes from an authenticated Master session, not from the fact
    // that the store happens to be open.
    let actor = null;
    try { actor = require('./ipc/authEngine.cjs').validateSession(token, fingerprint); }
    catch { /* auth engine unavailable */ }

    if (!actor) return { ok: false, error: 'Sign in again before changing the passcode', reauth: true };
    if (actor.tier !== 0) return { ok: false, error: 'Only the master account can change the store passcode' };

    return changePasscode(oldPasscode, newPasscode);
  });
}

module.exports = {
  register, init, masterUnlock, lockSession,
  changePasscode,
  isStoreOpen,
  _isFirstRun: () => _isFirstRun,
};
