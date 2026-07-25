'use strict';

/**
 * credentialVault.cjs — AES-256-GCM encrypted credential store.
 * All API keys, tokens, passwords stored here — never in plaintext.
 * Master password → Argon2id KDF → encryption key.
 * Vault file lives at: userData/rama_vault.enc
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { app } = require('electron');

// ─── Vault state ──────────────────────────────────────────────────────────────
let vaultKey      = null;   // 32-byte AES key derived from master password
let vaultData     = {};     // Decrypted in-memory store { [service]: { key, meta, addedAt } }
let vaultUnlocked = false;

const VAULT_VERSION = 1;
const ARGON_MEMORY  = 65536;   // 64 MiB (lighter than StockMind 128MiB for faster unlock)
const ARGON_ITER    = 3;
const ARGON_THREADS = 2;

// ─── Vault file path ──────────────────────────────────────────────────────────
function getVaultPath() {
  const base = app?.getPath('userData') || path.join(require('os').homedir(), '.rama-agi');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'rama_vault.enc');
}

// ─── AES-256-GCM encrypt ──────────────────────────────────────────────────────
function encrypt(key, plaintext) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// ─── AES-256-GCM decrypt ──────────────────────────────────────────────────────
function decrypt(key, ciphertext) {
  const buf      = Buffer.from(ciphertext, 'base64');
  const iv       = buf.slice(0, 12);
  const authTag  = buf.slice(12, 28);
  const data     = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
}

// ─── Derive key from master password (scrypt as Argon2 fallback) ──────────────
async function deriveKey(password, salt) {
  // Try Argon2id first (if argon2 native module available)
  try {
    const argon2 = require('argon2');
    const hash   = await argon2.hash(password, {
      type:         argon2.argon2id,
      memoryCost:   ARGON_MEMORY,
      timeCost:     ARGON_ITER,
      parallelism:  ARGON_THREADS,
      hashLength:   32,
      salt:         Buffer.from(salt, 'hex'),
      raw:          true,
    });
    return hash;
  } catch {
    // Fallback to scrypt if argon2 native not built
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err); else resolve(key);
      });
    });
  }
}

// ─── Save vault to disk ───────────────────────────────────────────────────────
function saveVault() {
  if (!vaultKey) return;
  const vaultPath = getVaultPath();
  const payload   = JSON.stringify({ version: VAULT_VERSION, data: vaultData, ts: Date.now() });
  const encrypted = encrypt(vaultKey, payload);

  // HMAC integrity
  const hmac = crypto.createHmac('sha512', vaultKey).update(encrypted).digest('hex');
  fs.writeFileSync(vaultPath, JSON.stringify({ enc: encrypted, hmac }), 'utf8');
}

// ─── Load vault from disk ─────────────────────────────────────────────────────
function loadVault() {
  const vaultPath = getVaultPath();
  if (!fs.existsSync(vaultPath)) return {};
  try {
    const raw    = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    const hmac   = crypto.createHmac('sha512', vaultKey).update(raw.enc).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(raw.hmac))) {
      throw new Error('Vault HMAC verification failed — file may be tampered');
    }
    const plain = decrypt(vaultKey, raw.enc);
    return JSON.parse(plain).data || {};
  } catch (err) {
    console.error('[vault] Load error:', err.message);
    return {};
  }
}

// ─── Register IPC handlers ────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Unlock vault ──────────────────────────────────────────────────────────
  ipcMain.handle('vault:unlock', async (_e, password) => {
    try {
      const vaultPath = getVaultPath();
      let salt;
      if (fs.existsSync(vaultPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
          salt = raw.salt || null;
        } catch { salt = null; }
      }
      if (!salt) {
        salt = crypto.randomBytes(32).toString('hex');
        // Store salt alongside vault (salt is not secret)
        const existing = fs.existsSync(vaultPath)
          ? JSON.parse(fs.readFileSync(vaultPath, 'utf8'))
          : {};
        fs.writeFileSync(vaultPath, JSON.stringify({ ...existing, salt }), 'utf8');
      }
      vaultKey      = await deriveKey(password, salt);
      vaultData     = loadVault();
      vaultUnlocked = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Lock vault ────────────────────────────────────────────────────────────
  ipcMain.handle('vault:lock', async () => {
    vaultKey      = null;
    vaultData     = {};
    vaultUnlocked = false;
    return { ok: true };
  });

  // ── Check vault status ────────────────────────────────────────────────────
  ipcMain.handle('vault:status', async () => {
    return { ok: true, unlocked: vaultUnlocked, entries: Object.keys(vaultData).length };
  });

  // ── Store credential ──────────────────────────────────────────────────────
  ipcMain.handle('vault:set', async (_e, service, value, meta = {}) => {
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    vaultData[service] = { value, meta, addedAt: Date.now() };
    saveVault();
    return { ok: true };
  });

  // ── Get credential ────────────────────────────────────────────────────────
  ipcMain.handle('vault:get', async (_e, service) => {
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    const entry = vaultData[service];
    if (!entry) return { ok: false, error: 'Not found' };
    return { ok: true, value: entry.value, meta: entry.meta };
  });

  // ── List services (no values exposed) ────────────────────────────────────
  ipcMain.handle('vault:list', async () => {
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    const list = Object.entries(vaultData).map(([service, entry]) => ({
      service,
      meta:    entry.meta,
      addedAt: entry.addedAt,
      hasValue: !!entry.value,
    }));
    return { ok: true, data: list };
  });

  // ── Delete credential ─────────────────────────────────────────────────────
  ipcMain.handle('vault:delete', async (_e, service) => {
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    delete vaultData[service];
    saveVault();
    return { ok: true };
  });

  // ── Check if service has credential ──────────────────────────────────────
  ipcMain.handle('vault:has', async (_e, service) => {
    if (!vaultUnlocked) return { ok: false, has: false };
    return { ok: true, has: !!vaultData[service]?.value };
  });
}

// ─── Internal access (for other IPC modules) ──────────────────────────────────
function getCredential(service) {
  if (!vaultUnlocked) return null;
  return vaultData[service]?.value || null;
}

function isUnlocked() {
  return vaultUnlocked;
}

module.exports = { register, getCredential, isUnlocked };
