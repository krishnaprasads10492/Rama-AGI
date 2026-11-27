'use strict';

/**
 * cryptoCore.cjs — Rāma's master encryption engine.
 * Upgraded to match StockMind fileStore v3 specifications.
 *
 * SECURITY MODEL (upgraded):
 * ─────────────────────────────────────────────────────────────────────────────
 * Master passcode
 *   └─► Argon2id KDF (128 MiB, 4 iter, 2 threads) → 96-byte root material
 *         ├─► First 32 bytes  → encKey   (AES-256-GCM encryption)
 *         └─► Last  64 bytes  → hmacKey  (HMAC-SHA512 integrity)
 *
 * File format v3:
 *   [ VERSION:1 | FLAGS:1 | SALT:32 | IV:12 | AUTHTAG:16 | CIPHERTEXT:N | HMAC-SHA512:64 ]
 *
 * Upgrades from v1:
 *   + AAD (Additional Authenticated Data) — binds ciphertext to its file path
 *   + gzip compression before encryption (~60-80% size reduction)
 *   + LRU read cache (avoids repeated decrypt+HMAC on hot paths)
 *   + Write-through cache (reads after writes are instant)
 *   + DoD 5220.22-M 3-pass secure delete
 *   + 96-byte root key (32 enc + 64 hmac — stronger than v1's 64-byte)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');

// ─── Constants ────────────────────────────────────────────────────────────────
const VERSION_V3    = 0x03;
const FLAG_COMPRESSED = 0x01;
const SALT_BYTES    = 32;
const IV_BYTES      = 12;
const AUTHTAG_BYTES = 16;
const HMAC_BYTES    = 64;    // SHA-512
const KEY_BYTES     = 96;    // 32 enc + 64 hmac

const ARGON2_MEMORY  = 131072;   // 128 MiB
const ARGON2_ITER    = 4;
const ARGON2_THREADS = 2;

// ─── In-memory key state (Buffers only — never strings) ──────────────────────
let _encKey   = null;   // 32 bytes
let _hmacKey  = null;   // 64 bytes
let _salt     = null;   // 32 bytes
let _unlocked = false;

// ─── Simple LRU cache (max 100 entries) ──────────────────────────────────────
const _cache    = new Map();
const _cacheMax = 100;

function cacheGet(key) { return _cache.has(key) ? _cache.get(key) : undefined; }
function cacheSet(key, val) {
  if (_cache.size >= _cacheMax) { _cache.delete(_cache.keys().next().value); }
  _cache.set(key, val);
}
function cacheDel(key) { _cache.delete(key); }
function cacheClear()  { _cache.clear(); }

// ─── Salt file management ─────────────────────────────────────────────────────
function getSaltPath(dataDir) { return path.join(dataDir, 'rama.salt'); }

function loadOrCreateSalt(dataDir) {
  const saltPath = getSaltPath(dataDir);
  if (fs.existsSync(saltPath)) return fs.readFileSync(saltPath);
  const salt = crypto.randomBytes(SALT_BYTES);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(saltPath, salt, { mode: 0o600 });
  return salt;
}

// ─── Key derivation ───────────────────────────────────────────────────────────
async function deriveKeys(password, salt) {
  let keyMaterial;
  try {
    const argon2 = require('argon2');
    keyMaterial = await argon2.hash(password, {
      type:        argon2.argon2id,
      memoryCost:  ARGON2_MEMORY,
      timeCost:    ARGON2_ITER,
      parallelism: ARGON2_THREADS,
      hashLength:  KEY_BYTES,
      salt,
      raw:         true,
    });
    if (!Buffer.isBuffer(keyMaterial)) keyMaterial = Buffer.from(keyMaterial);
  } catch {
    // PBKDF2 fallback
    keyMaterial = await new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, 600000, KEY_BYTES, 'sha512', (err, key) => {
        if (err) reject(err); else resolve(key);
      });
    });
  }
  return { encKey: keyMaterial.slice(0, 32), hmacKey: keyMaterial.slice(32, 96) };
}

// ─── Unlock ───────────────────────────────────────────────────────────────────
async function unlock(password, dataDir) {
  const salt = loadOrCreateSalt(dataDir);
  const { encKey, hmacKey } = await deriveKeys(password, salt);
  _encKey   = encKey;
  _hmacKey  = hmacKey;
  _salt     = salt;
  _unlocked = true;
  return true;
}

// ─── Lock — zero all key material ─────────────────────────────────────────────
function lock() {
  if (_encKey)  _encKey.fill(0);
  if (_hmacKey) _hmacKey.fill(0);
  _encKey = _hmacKey = _salt = null;
  _unlocked = false;
  cacheClear();
}

// ─── Encrypt buffer (v3: AAD + optional gzip) ────────────────────────────────
/**
 * `keys` IS OPTIONAL AND ADDITIVE (Section 202).
 *
 * Omitted — which is every existing caller — this behaves exactly as before: the vault must be
 * unlocked and the module's own key material is used.
 *
 * Supplied as `{ encKey, hmacKey, salt }`, this envelope is used with a key that is not the vault's.
 * Matsya needs that: its backups are encrypted from master's written-down recovery phrase, not from
 * his passcode, because a backup has to open on a machine that has never seen this one (192.5). The
 * alternative was a SECOND AES-256-GCM-plus-HMAC implementation inside Matsya, and two envelopes in
 * one codebase is how one of them quietly becomes the weaker one. So the audited envelope stays the
 * only envelope and the key becomes a parameter.
 */
function encryptBuffer(plaintext, aad = '', keys = null) {
  const encKey  = keys ? keys.encKey  : _encKey;
  const hmacKey = keys ? keys.hmacKey : _hmacKey;
  const salt    = keys ? keys.salt    : _salt;
  if (!keys && !_unlocked) throw new Error('CryptoCore: not unlocked');
  if (keys && !(Buffer.isBuffer(encKey) && encKey.length === 32
    && Buffer.isBuffer(hmacKey) && hmacKey.length === 64
    && Buffer.isBuffer(salt) && salt.length === SALT_BYTES)) {
    throw new Error('CryptoCore: injected keys must be { encKey:32, hmacKey:64, salt:32 }');
  }

  let payload = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  let flags   = 0x00;

  // Compress payloads > 512 bytes
  if (payload.length > 512) {
    try {
      payload = zlib.gzipSync(payload, { level: 6 });
      flags |= FLAG_COMPRESSED;
    } catch { /* fall back to uncompressed */ }
  }

  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));

  const enc     = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const core = Buffer.concat([
    Buffer.from([VERSION_V3, flags]),
    salt,
    iv, authTag, enc,
  ]);

  const mac = crypto.createHmac('sha512', hmacKey).update(core).digest();
  return Buffer.concat([core, mac]);
}

/**
 * The salt out of a ciphertext header, without a key.
 *
 * A restore has a chicken-and-egg problem: the key is derived from the phrase AND a salt, and the
 * salt lives in the blob. Section 193 claimed the ciphertext is "self-describing and restorable on a
 * machine that has never seen this one", and this is the function that makes that true rather than
 * aspirational — read the salt, derive the key, then decrypt.
 *
 * Returns null for anything too short to contain one, so a truncated file reads as unopenable rather
 * than as a header of zeroes.
 */
function saltOf(cipherBuf) {
  if (!Buffer.isBuffer(cipherBuf) || cipherBuf.length < 2 + SALT_BYTES) return null;
  return cipherBuf.slice(2, 2 + SALT_BYTES);
}

// ─── Decrypt buffer ───────────────────────────────────────────────────────────
function decryptBuffer(cipherBuf, aad = '', keys = null) {
  const encKey  = keys ? keys.encKey  : _encKey;
  const hmacKey = keys ? keys.hmacKey : _hmacKey;
  if (!keys && !_unlocked) throw new Error('CryptoCore: not unlocked');
  if (cipherBuf.length < 2 + SALT_BYTES + IV_BYTES + AUTHTAG_BYTES + HMAC_BYTES) {
    throw new Error('CryptoCore: ciphertext too short');
  }

  // Split HMAC from end
  const mac      = cipherBuf.slice(cipherBuf.length - HMAC_BYTES);
  const core     = cipherBuf.slice(0, cipherBuf.length - HMAC_BYTES);
  const expected = crypto.createHmac('sha512', hmacKey).update(core).digest();
  if (!crypto.timingSafeEqual(mac, expected)) {
    throw new Error('CryptoCore: HMAC verification failed — tampered or wrong password');
  }

  let offset   = 0;
  const version = core[offset++];
  const flags   = core[offset++];
  offset += SALT_BYTES;   // skip salt
  const iv      = core.slice(offset, offset + IV_BYTES);    offset += IV_BYTES;
  const authTag = core.slice(offset, offset + AUTHTAG_BYTES); offset += AUTHTAG_BYTES;
  const enc     = core.slice(offset);

  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(authTag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));

  let payload = Buffer.concat([decipher.update(enc), decipher.final()]);
  if (flags & FLAG_COMPRESSED) {
    payload = zlib.gunzipSync(payload);
  }

  return payload;
}

// ─── Encrypt to file (with AAD = relative path for binding) ──────────────────
function encryptToFile(filePath, data, relPath) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  const aad   = relPath || path.basename(filePath);
  const plain = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
  const enc   = encryptBuffer(plain, aad);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, enc, { mode: 0o600 });
  if (relPath) cacheSet(relPath, data);  // write-through cache
}

// ─── Decrypt from file ────────────────────────────────────────────────────────
function decryptFromFile(filePath, relPath) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  if (!fs.existsSync(filePath)) return null;

  // Check cache first
  if (relPath) {
    const cached = cacheGet(relPath);
    if (cached !== undefined) return cached;
  }

  const enc   = fs.readFileSync(filePath);
  const aad   = relPath || path.basename(filePath);
  const plain = decryptBuffer(enc, aad);
  const str   = plain.toString('utf8');

  let result;
  try   { result = JSON.parse(str); }
  catch { result = str; }

  if (relPath) cacheSet(relPath, result);
  return result;
}

// ─── DoD 5220.22-M secure delete (3-pass) ────────────────────────────────────
function secureDelete(filePath) {
  cacheDel(path.basename(filePath));
  if (!fs.existsSync(filePath)) return;
  try {
    const size = fs.statSync(filePath).size;
    const fd   = fs.openSync(filePath, 'r+');
    fs.writeSync(fd, Buffer.alloc(size, 0x00), 0, size, 0); fs.fsyncSync(fd);
    fs.writeSync(fd, Buffer.alloc(size, 0xFF), 0, size, 0); fs.fsyncSync(fd);
    fs.writeSync(fd, crypto.randomBytes(size), 0, size, 0); fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch { /* best-effort */ }
  fs.unlinkSync(filePath);
}

// ─── String encrypt/decrypt (for in-memory transport) ────────────────────────
function encryptString(plaintext) {
  return encryptBuffer(Buffer.from(plaintext, 'utf8')).toString('base64');
}

function decryptString(b64) {
  return decryptBuffer(Buffer.from(b64, 'base64')).toString('utf8');
}

// ─── First-run check ──────────────────────────────────────────────────────────
function isFirstRun(dataDir) {
  return !fs.existsSync(getSaltPath(dataDir));
}

// ─── Passcode verification ────────────────────────────────────────────────────
/**
 * WHY THIS EXISTS: `unlock()` only derives keys — it cannot tell a correct
 * passcode from an incorrect one, because any passcode derives *some* key. The
 * failure only shows up later, when a decrypt fails its HMAC. Since dataStore
 * falls back to empty defaults on a domain that will not decrypt, a wrong
 * passcode used to look exactly like a fresh install: no data, no accounts,
 * ready to re-provision. That is an authentication bypass, not a UX wrinkle.
 *
 * The verifier closes it. A tiny known-plaintext blob is written under the
 * current keys on first unlock. On every later unlock it must decrypt and match,
 * which it can only do if the derived keys — and therefore the passcode — are
 * the same. The blob reveals nothing: it is a constant, not a secret.
 */
const VERIFIER_MAGIC = 'rama-nucleus-verifier-v1';

function getVerifierPath(dataDir) { return path.join(dataDir, 'rama.verify'); }

function hasVerifier(dataDir) { return fs.existsSync(getVerifierPath(dataDir)); }

/** Write the verifier under the currently-derived keys. First unlock only. */
function writeVerifier(dataDir) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  const filePath = getVerifierPath(dataDir);
  const payload  = JSON.stringify({ magic: VERIFIER_MAGIC, createdAt: Date.now() });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, encryptBuffer(Buffer.from(payload, 'utf8'), 'rama.verify'), { mode: 0o600 });
}

/**
 * @returns {boolean} true only when the current keys decrypt the verifier.
 * Any failure — bad HMAC, bad auth tag, corrupt file — reads as false.
 */
function verifyPasscode(dataDir) {
  if (!_unlocked) return false;
  const filePath = getVerifierPath(dataDir);
  if (!fs.existsSync(filePath)) return false;
  try {
    const plain  = decryptBuffer(fs.readFileSync(filePath), 'rama.verify');
    const parsed = JSON.parse(plain.toString('utf8'));
    return parsed?.magic === VERIFIER_MAGIC;
  } catch {
    return false;
  }
}

/** Re-key the verifier after a passcode change (keys must already be the new ones). */
function rewriteVerifier(dataDir) {
  const filePath = getVerifierPath(dataDir);
  if (fs.existsSync(filePath)) secureDelete(filePath);
  writeVerifier(dataDir);
}

module.exports = {
  unlock, lock, encryptBuffer, decryptBuffer, saltOf,
  encryptToFile, decryptFromFile, secureDelete,
  encryptString, decryptString, isFirstRun,
  hasVerifier, writeVerifier, verifyPasscode, rewriteVerifier,
  isUnlocked: () => _unlocked,
  cache: { get: cacheGet, set: cacheSet, del: cacheDel, clear: cacheClear },
};
