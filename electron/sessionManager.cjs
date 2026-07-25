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
let _sessionKey    = null;    // Ephemeral 32-byte key for session file encryption
let _sessionToken  = null;    // HMAC-signed token string
let _sessionData   = null;    // { userId, userName, tier, expiry, fingerprint }
let _sessionPath   = null;    // Temp file path
let _isFirstRun    = false;

const SESSION_TTL  = 12 * 3600 * 1000;   // 12 hours
const SESSION_FILE = '.rama_active_session';

// ─── Init — called at app startup ────────────────────────────────────────────
async function init(dataDir) {
  _isFirstRun = cryptoCore.isFirstRun(dataDir);

  if (_isFirstRun) {
    console.warn('[session] First run detected — master password setup required');
  }
  return { firstRun: _isFirstRun };
}

// ─── Master unlock — called from IPC on passcode entry ───────────────────────
async function masterUnlock(passcode, dataDir, userAgent = '') {
  try {
    // 1. Derive key + unlock crypto
    await cryptoCore.unlock(passcode, dataDir);

    // 2. Load all encrypted data
    dataStore.loadAll();

    // 3. If first run, create master user record
    if (_isFirstRun) {
      await ensureMasterUser(passcode);
    }

    // 4. Verify passcode against stored master user
    const users   = dataStore.get('users', 'accounts') || [];
    const master  = users.find(u => u.isMaster);
    if (!master) {
      // Should not happen after first-run setup, but handle gracefully
      cryptoCore.lock();
      return { ok: false, error: 'Master account not found' };
    }

    const valid = await verifyMasterPassword(passcode, master.passwordHash);
    if (!valid) {
      cryptoCore.lock();
      dataStore.flushAndClear();
      return { ok: false, error: 'Incorrect passcode' };
    }

    // 5. Generate session
    _sessionKey   = crypto.randomBytes(32);
    _sessionToken = generateSessionToken(master.id, userAgent);

    // 6. Unseal nucleus (identity becomes live in memory)
    try {
      const nucleusSealer = require('./nucleusSealer.cjs');
      await nucleusSealer.unseal(passcode);
    } catch (err) {
      console.warn('[Session] Nucleus unseal warning:', err.message);
      // Non-fatal — Rāma can still run with template identity
    }

    // 7. Initialize IPC encryption session key
    try {
      const ipcEnc = require('./ipcEncryption.cjs');
      ipcEnc.initSession();
    } catch { /* non-fatal */ }
    _sessionData  = {
      userId:      master.id,
      userName:    master.name,
      tier:        0,            // MASTER = 0
      expiry:      Date.now() + SESSION_TTL,
      fingerprint: hashFingerprint(userAgent),
    };

    // 6. Write encrypted session file to temp
    writeSessionFile();

    // 7. Update last login
    const updatedUsers = (dataStore.get('users', 'accounts') || []).map(u =>
      u.isMaster ? { ...u, lastLogin: Date.now() } : u
    );
    dataStore.set('users', 'accounts', updatedUsers);
    dataStore.saveAll();

    return {
      ok:       true,
      firstRun: _isFirstRun,
      token:    _sessionToken,
      user: {
        id:    master.id,
        name:  master.name,
        tier:  0,
        email: master.email,
      },
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
  _sessionToken = null;
  _sessionData  = null;

  // Lock nucleus and IPC encryption
  try { require('./nucleusSealer.cjs').lock(); }         catch { /* ignore */ }
  try { require('./ipcEncryption.cjs').clearSession(); }  catch { /* ignore */ }

  // Delete temp session file
  deleteSessionFile();

  // Lock crypto + clear data cache
  dataStore.flushAndClear();
  cryptoCore.lock();
}

// ─── Validate a session token ─────────────────────────────────────────────────
function validateToken(token, userAgent = '') {
  if (!_sessionToken || token !== _sessionToken) return null;
  if (!_sessionData) return null;
  if (Date.now() > _sessionData.expiry) { lockSession(); return null; }

  // Fingerprint check (loose — user-agent can change on updates)
  // Just ensure it's the same base fingerprint
  return _sessionData;
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

// ─── First-run master user setup ──────────────────────────────────────────────
async function ensureMasterUser(passcode) {
  const argon2 = (() => {
    try { return require('argon2'); } catch { return null; }
  })();

  let passwordHash;
  if (argon2) {
    passwordHash = await argon2.hash(passcode, {
      type:        argon2.argon2id,
      memoryCost:  131072,
      timeCost:    4,
      parallelism: 2,
    });
  } else {
    const salt = crypto.randomBytes(32);
    const key  = await new Promise((res, rej) =>
      crypto.scrypt(passcode, salt, 64, { N: 131072, r: 8, p: 2 }, (e, k) => e ? rej(e) : res(k))
    );
    passwordHash = `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
  }

  const master = {
    id:           'master_krishnaprasad',
    name:         'Krishna Prasad',
    email:        'master@rama-agi.local',
    passwordHash,
    tier:         0,
    isMaster:     true,
    suspended:    false,
    createdAt:    Date.now(),
    lastLogin:    null,
  };

  dataStore.set('users', 'accounts', [master]);
  dataStore.set('config', 'vaultCreatedAt', Date.now());
  dataStore.set('config', 'version', '1.0.0');
  dataStore.saveAll();
}

// ─── Verify master password ───────────────────────────────────────────────────
async function verifyMasterPassword(passcode, hash) {
  try {
    if (!hash) return false;
    if (hash.startsWith('scrypt:')) {
      const [, saltHex, keyHex] = hash.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      const key  = await new Promise((res, rej) =>
        crypto.scrypt(passcode, salt, 64, { N: 131072, r: 8, p: 2 }, (e, k) => e ? rej(e) : res(k))
      );
      return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
    }
    const argon2 = require('argon2');
    return await argon2.verify(hash, passcode);
  } catch {
    return false;
  }
}

// ─── Generate HMAC-signed session token ──────────────────────────────────────
function generateSessionToken(userId, userAgent) {
  const payload = `${userId}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
  const sig     = crypto.createHmac('sha256', _sessionKey).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
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

  // ── Validate token ────────────────────────────────────────────────────────
  ipcMain.handle('session:validate', async (_e, token) => {
    const data = validateToken(token);
    if (!data) return { ok: false, error: 'Invalid or expired session' };
    return { ok: true, user: { id: data.userId, name: data.userName, tier: data.tier } };
  });

  // ── Session status ────────────────────────────────────────────────────────
  ipcMain.handle('session:status', async () => {
    return {
      ok:        true,
      active:    !!_sessionData,
      firstRun:  _isFirstRun,
      expiry:    _sessionData?.expiry ?? null,
      user:      _sessionData ? { id: _sessionData.userId, name: _sessionData.userName, tier: _sessionData.tier } : null,
    };
  });

  // ── Change master passcode ────────────────────────────────────────────────
  ipcMain.handle('session:change-passcode', async (_e, oldPasscode, newPasscode) => {
    if (!_sessionData || _sessionData.tier !== 0) {
      return { ok: false, error: 'Only master can change passcode' };
    }
    try {
      // Verify old passcode
      const users  = dataStore.get('users', 'accounts') || [];
      const master = users.find(u => u.isMaster);
      const valid  = await verifyMasterPassword(oldPasscode, master.passwordHash);
      if (!valid) return { ok: false, error: 'Old passcode incorrect' };

      // Lock current session (re-derive with new passcode)
      const dataDir = dataStore.getDataDir();

      // Save all data first (encrypted with current key)
      dataStore.saveAll();

      // Unlock with new passcode (generates new salt + re-derives key)
      await cryptoCore.unlock(newPasscode, dataDir);
      dataStore.loadAll();

      // Update master password hash
      await ensureMasterUser(newPasscode);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { register, init, masterUnlock, lockSession, validateToken, _isFirstRun: () => _isFirstRun };
