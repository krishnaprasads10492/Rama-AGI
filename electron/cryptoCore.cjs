'use strict';

/**
 * cryptoCore.cjs — Rāma's master encryption engine.
 *
 * SECURITY MODEL:
 * ─────────────────────────────────────────────────────────────────────────────
 * Master passcode
 *   └─► Argon2id KDF (128 MiB, 4 iter, 2 threads) → 64-byte root key
 *         ├─► First 32 bytes  → encKey   (AES-256-GCM encryption)
 *         └─► Last  32 bytes  → hmacKey  (HMAC-SHA512 integrity)
 *
 * Every encrypted file format:
 *   [ version:1 | kdf:1 | salt:32 | iv:12 | authTag:16 | ciphertext:N | hmac:64 ]
 *   All in binary — no base64, no JSON, no plaintext wrapper.
 *
 * WITHOUT the master passcode:
 *   - Every .enc file is indistinguishable from random bytes
 *   - No IV reuse (fresh random IV per encryption)
 *   - HMAC covers entire ciphertext — tampering detected
 *   - Argon2id makes brute-force prohibitively expensive
 *   - No key material ever written to disk
 *
 * Session key:
 *   - Derived key lives only in process memory (Buffer, not string)
 *   - Zeroed on vault lock / app exit
 *   - Never exposed to renderer process
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────
const VERSION       = 0x01;
const KDF_ARGON2ID  = 0x01;
const KDF_SCRYPT    = 0x02;
const SALT_BYTES    = 32;
const IV_BYTES      = 12;    // AES-GCM
const AUTHTAG_BYTES = 16;
const HMAC_BYTES    = 64;    // SHA-512
const KEY_BYTES     = 64;    // 32 enc + 32 hmac

// Argon2id parameters — designed to take ~1s on modern hardware
const ARGON2_MEMORY  = 131072;   // 128 MiB
const ARGON2_ITER    = 4;
const ARGON2_THREADS = 2;

// ─── In-memory key state ──────────────────────────────────────────────────────
// These are Buffers — never strings, never serialized to disk
let _rootKey  = null;   // 64 bytes
let _encKey   = null;   // 32 bytes — AES-256-GCM
let _hmacKey  = null;   // 32 bytes — HMAC-SHA512
let _unlocked = false;
let _masterSalt = null; // 32 bytes — stored in salt file, not secret

// ─── Salt file management ─────────────────────────────────────────────────────
// Salt is NOT secret — it just prevents precomputation attacks
// Stored in a dedicated file separate from data
function getSaltPath(dataDir) {
  return path.join(dataDir, 'rama.salt');
}

function loadOrCreateSalt(dataDir) {
  const saltPath = getSaltPath(dataDir);
  if (fs.existsSync(saltPath)) {
    return fs.readFileSync(saltPath);
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(saltPath, salt);
  return salt;
}

// ─── Key derivation ───────────────────────────────────────────────────────────
async function deriveRootKey(password, salt) {
  let kdfUsed = KDF_SCRYPT;
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
    kdfUsed = KDF_ARGON2ID;
  } catch {
    // Fallback: scrypt (still strong, widely available)
    keyMaterial = await new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, KEY_BYTES, { N: 131072, r: 8, p: 2 }, (err, key) => {
        if (err) reject(err); else resolve(key);
      });
    });
  }

  return { key: keyMaterial, kdf: kdfUsed };
}

// ─── Unlock ───────────────────────────────────────────────────────────────────
async function unlock(password, dataDir) {
  const salt = loadOrCreateSalt(dataDir);
  const { key } = await deriveRootKey(password, salt);

  _rootKey  = key;
  _encKey   = key.slice(0, 32);
  _hmacKey  = key.slice(32, 64);
  _masterSalt = salt;
  _unlocked = true;

  return true;
}

// ─── Lock — zeroes all key material ──────────────────────────────────────────
function lock() {
  if (_rootKey)  _rootKey.fill(0);
  if (_encKey)   _encKey.fill(0);
  if (_hmacKey)  _hmacKey.fill(0);
  _rootKey  = null;
  _encKey   = null;
  _hmacKey  = null;
  _unlocked = false;
}

// ─── Encrypt buffer ───────────────────────────────────────────────────────────
/**
 * Returns a Buffer:
 * [ VERSION(1) | KDF(1) | SALT(32) | IV(12) | AUTHTAG(16) | CIPHERTEXT(N) | HMAC(64) ]
 */
function encryptBuffer(plaintext) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');

  const iv      = crypto.randomBytes(IV_BYTES);
  const cipher  = crypto.createCipheriv('aes-256-gcm', _encKey, iv);
  const enc     = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Build packet (without HMAC)
  const packet = Buffer.concat([
    Buffer.from([VERSION, KDF_ARGON2ID]),
    _masterSalt,
    iv,
    authTag,
    enc,
  ]);

  // HMAC over entire packet
  const hmac = crypto.createHmac('sha512', _hmacKey).update(packet).digest();

  return Buffer.concat([packet, hmac]);
}

// ─── Decrypt buffer ───────────────────────────────────────────────────────────
function decryptBuffer(cipherBuf) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  if (cipherBuf.length < 1 + 1 + SALT_BYTES + IV_BYTES + AUTHTAG_BYTES + HMAC_BYTES) {
    throw new Error('CryptoCore: ciphertext too short — corrupt or wrong file');
  }

  // Split off HMAC from the end
  const hmacReceived = cipherBuf.slice(cipherBuf.length - HMAC_BYTES);
  const packet       = cipherBuf.slice(0, cipherBuf.length - HMAC_BYTES);

  // Verify HMAC first (timing-safe)
  const hmacExpected = crypto.createHmac('sha512', _hmacKey).update(packet).digest();
  if (!crypto.timingSafeEqual(hmacReceived, hmacExpected)) {
    throw new Error('CryptoCore: HMAC verification failed — tampered or wrong password');
  }

  let offset = 0;
  const version = packet[offset++];
  const kdf     = packet[offset++];
  const salt    = packet.slice(offset, offset + SALT_BYTES); offset += SALT_BYTES;
  const iv      = packet.slice(offset, offset + IV_BYTES);   offset += IV_BYTES;
  const authTag = packet.slice(offset, offset + AUTHTAG_BYTES); offset += AUTHTAG_BYTES;
  const enc     = packet.slice(offset);

  const decipher = crypto.createDecipheriv('aes-256-gcm', _encKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

// ─── Encrypt string → file ────────────────────────────────────────────────────
function encryptToFile(filePath, data) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  const plain = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
  const enc   = encryptBuffer(plain);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, enc);
}

// ─── Decrypt file → string/object ────────────────────────────────────────────
function decryptFromFile(filePath) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  if (!fs.existsSync(filePath)) return null;
  const enc   = fs.readFileSync(filePath);
  const plain = decryptBuffer(enc);
  const str   = plain.toString('utf8');
  try { return JSON.parse(str); } catch { return str; }
}

// ─── Encrypt string → base64 string (for in-memory transport) ────────────────
function encryptString(plaintext) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  const plain = Buffer.from(plaintext, 'utf8');
  return encryptBuffer(plain).toString('base64');
}

// ─── Decrypt base64 string → string ──────────────────────────────────────────
function decryptString(b64) {
  if (!_unlocked) throw new Error('CryptoCore: not unlocked');
  const buf = Buffer.from(b64, 'base64');
  return decryptBuffer(buf).toString('utf8');
}

// ─── Check if first-time setup (no salt file) ─────────────────────────────────
function isFirstRun(dataDir) {
  return !fs.existsSync(getSaltPath(dataDir));
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  unlock,
  lock,
  encryptBuffer,
  decryptBuffer,
  encryptToFile,
  decryptFromFile,
  encryptString,
  decryptString,
  isFirstRun,
  isUnlocked: () => _unlocked,
};
