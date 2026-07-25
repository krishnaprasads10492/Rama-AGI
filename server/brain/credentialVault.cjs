'use strict';

/**
 * credentialVault.cjs — AES-256-GCM encrypted credential store.
 * All secrets are encrypted at rest. Never stored or logged in plaintext.
 * Key derived from master password via Argon2id.
 *
 * Storage: credentials.vault.json (encrypted blob, safe to commit if needed)
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// Vault file location — in user's app data dir
const VAULT_DIR  = path.join(os.homedir(), '.rama-agi');
const VAULT_FILE = path.join(VAULT_DIR, 'credentials.vault.json');

// In-memory cache after unlock
let masterKey    = null;   // 32-byte Buffer derived from master password
let vaultCache   = null;   // decrypted vault object

// ─── Key derivation ───────────────────────────────────────────────────────────
function deriveKey(password, salt) {
  // PBKDF2 as synchronous KDF (Argon2id is in Phase 2 via argon2 native module)
  // Using 310,000 iterations per OWASP 2023 recommendation
  return crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha512');
}

// ─── Encryption ───────────────────────────────────────────────────────────────
function encrypt(plaintext, key) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return {
    iv:      iv.toString('hex'),
    data:    encrypted.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

// ─── Decryption ───────────────────────────────────────────────────────────────
function decrypt(encObj, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encObj.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encObj.authTag, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encObj.data, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

// ─── Vault file I/O ───────────────────────────────────────────────────────────
function loadVaultFile() {
  if (!fs.existsSync(VAULT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveVaultFile(encrypted) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_FILE, JSON.stringify(encrypted, null, 2), 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize vault with master password.
 * If vault doesn't exist yet, creates it.
 * Returns { ok, isNew } 
 */
function initialize(password) {
  if (!password || password.length < 8) {
    return { ok: false, error: 'Master password must be at least 8 characters' };
  }

  const vaultFile = loadVaultFile();

  if (!vaultFile) {
    // First time — create new vault
    const salt = crypto.randomBytes(32).toString('hex');
    masterKey  = deriveKey(password, salt);
    vaultCache = {};

    const encrypted = encrypt(JSON.stringify({}), masterKey);
    saveVaultFile({ salt, ...encrypted });
    return { ok: true, isNew: true };
  }

  // Existing vault — derive key from stored salt and try to decrypt
  try {
    const key  = deriveKey(password, vaultFile.salt);
    const json = decrypt(vaultFile, key);
    vaultCache = JSON.parse(json);
    masterKey  = key;
    return { ok: true, isNew: false };
  } catch {
    return { ok: false, error: 'Invalid master password' };
  }
}

/** Check if vault is unlocked */
function isUnlocked() {
  return masterKey !== null && vaultCache !== null;
}

/** Lock vault (clear in-memory key and cache) */
function lock() {
  masterKey  = null;
  vaultCache = null;
}

/**
 * Store a credential.
 * @param {string} service  - e.g. 'openai', 'serper', 'github'
 * @param {string} key      - e.g. 'api_key', 'password', 'token'
 * @param {string} value    - plaintext secret
 */
function set(service, key, value) {
  if (!isUnlocked()) return { ok: false, error: 'Vault is locked' };

  if (!vaultCache[service]) vaultCache[service] = {};
  vaultCache[service][key] = value;

  _persist();
  return { ok: true };
}

/**
 * Retrieve a credential value.
 */
function get(service, key) {
  if (!isUnlocked()) return null;
  return vaultCache?.[service]?.[key] ?? null;
}

/**
 * Check if a credential exists.
 */
function has(service, key) {
  if (!isUnlocked()) return false;
  return !!(vaultCache?.[service]?.[key]);
}

/**
 * Delete a credential.
 */
function remove(service, key) {
  if (!isUnlocked()) return { ok: false, error: 'Vault is locked' };
  if (vaultCache[service]) {
    delete vaultCache[service][key];
    if (Object.keys(vaultCache[service]).length === 0) {
      delete vaultCache[service];
    }
  }
  _persist();
  return { ok: true };
}

/**
 * List all services and their keys (NOT values).
 */
function listServices() {
  if (!isUnlocked()) return [];
  return Object.entries(vaultCache).map(([service, keys]) => ({
    service,
    keys: Object.keys(keys),
  }));
}

/**
 * Get all credentials for a service (for display in vault UI — values masked).
 */
function getServiceSummary(service) {
  if (!isUnlocked()) return null;
  const svc = vaultCache[service];
  if (!svc) return null;
  return Object.fromEntries(
    Object.keys(svc).map(k => [k, '••••••••'])
  );
}

// ─── Internal ─────────────────────────────────────────────────────────────────
function _persist() {
  const encrypted = encrypt(JSON.stringify(vaultCache), masterKey);
  const vaultFile = loadVaultFile();
  saveVaultFile({ salt: vaultFile.salt, ...encrypted });
}

module.exports = {
  initialize,
  isUnlocked,
  lock,
  set,
  get,
  has,
  remove,
  listServices,
  getServiceSummary,
  VAULT_FILE,
};
