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
const capability = require('../lib/capability.cjs');

// ─── Vault state ──────────────────────────────────────────────────────────────
let vaultKey      = null;   // 32-byte AES key derived from master password
let vaultData     = {};     // Decrypted in-memory store { [service]: { key, meta, addedAt } }
let vaultUnlocked = false;
/**
 * Whether the ciphertext on disk was actually READ. False means either there is
 * nothing stored yet (fine) or there is something we could not decrypt (not
 * fine) — `vaultCorrupt` separates the two, and `saveVault` refuses to write
 * over ciphertext it could not read. See Section 141.
 */
let vaultReadable = false;
let vaultCorrupt  = false;

const VAULT_VERSION = 1;
const ARGON_MEMORY  = 65536;   // 64 MiB (lighter than StockMind 128MiB for faster unlock)
const ARGON_ITER    = 3;
const ARGON_THREADS = 2;

/* The verifier proves the derived key is the RIGHT key before anything is
   decrypted with it. Fixed string, HMAC'd under the vault key — it reveals
   nothing about the password and nothing about the contents. */
const VERIFIER_MESSAGE = 'rama-vault-verifier-v1';

// ─── Vault file path ──────────────────────────────────────────────────────────
function vaultDir() {
  const base = app?.getPath('userData') || path.join(require('os').homedir(), '.rama-agi');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function getVaultPath() {
  return path.join(vaultDir(), 'rama_vault.enc');
}

/**
 * THE SALT LIVES IN ITS OWN FILE, and that is a fix rather than a preference.
 *
 * It used to be a field inside `rama_vault.enc`, while `saveVault()` wrote that
 * file as `JSON.stringify({ enc, hmac })` — so THE FIRST CREDENTIAL MASTER
 * SAVED DELETED THE SALT. On the next unlock the handler found no salt,
 * generated a fresh random one, derived a different key, failed the HMAC check,
 * swallowed the error and reported `{ ok: true }` with an EMPTY vault. Every
 * stored credential became unrecoverable, and the new salt was written back
 * over the file, so even correct code could not recover it afterwards.
 *
 * A separate file removes the whole class: no future writer of the vault blob
 * can drop it. `cryptoCore.cjs` already does exactly this with `rama.salt` and
 * has never had the bug — this adopts the pattern that is already proven here.
 */
function getSaltPath() {
  return path.join(vaultDir(), 'rama_vault.salt');
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

/** The key's own fingerprint, used to reject a wrong password before decrypting. */
function verifierFor(key) {
  return crypto.createHmac('sha512', key).update(VERIFIER_MESSAGE).digest('hex');
}

/** Constant-time compare that cannot throw on a length mismatch. */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Save vault to disk ───────────────────────────────────────────────────────
function saveVault() {
  if (!vaultKey) return { ok: false, error: 'Vault locked' };
  // REFUSES TO WRITE OVER CIPHERTEXT IT COULD NOT READ. Losing the key to a
  // vault is recoverable in principle; overwriting the vault is not, and the
  // old code did exactly that — an unlock that failed to decrypt still reported
  // success with an empty store, so the next `vault:set` replaced master's
  // credentials with a one-entry file encrypted under the wrong key.
  if (vaultCorrupt) {
    return { ok: false, error: 'Refusing to write: the stored vault could not be decrypted, and '
      + 'overwriting it would destroy it. Unlock with the correct master password first.' };
  }
  const payload   = JSON.stringify({ version: VAULT_VERSION, data: vaultData, ts: Date.now() });
  const encrypted = encrypt(vaultKey, payload);
  const hmac      = crypto.createHmac('sha512', vaultKey).update(encrypted).digest('hex');
  // `verifier` travels with the blob; the SALT no longer does, and must not be
  // reintroduced here — see getSaltPath() for what that cost.
  fs.writeFileSync(getVaultPath(),
    JSON.stringify({ version: VAULT_VERSION, enc: encrypted, hmac, verifier: verifierFor(vaultKey) }),
    { encoding: 'utf8', mode: 0o600 });
  return { ok: true };
}

// ─── Load vault from disk ─────────────────────────────────────────────────────
/**
 * THREE OUTCOMES, NEVER TWO. The old version returned `{}` for "there is no
 * vault yet", for "the password is wrong" and for "the file is damaged" alike,
 * so the caller could not tell an empty vault from an unreadable one — which is
 * precisely how a wrong password came to report success.
 *
 * @returns {{state:'empty'|'ok'|'unreadable', data:object, why:string|null}}
 */
function loadVault() {
  const vaultPath = getVaultPath();
  if (!fs.existsSync(vaultPath)) return { state: 'empty', data: {}, why: null };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  } catch (err) {
    return { state: 'unreadable', data: {}, why: `the vault file is not readable JSON: ${err.message}` };
  }

  // A file holding only a salt is what the pre-Section-141 code wrote on a first
  // unlock before anything was stored. There is no ciphertext to fail on.
  if (typeof raw.enc !== 'string' || raw.enc.length === 0) {
    return { state: 'empty', data: {}, why: null };
  }

  if (typeof raw.verifier === 'string' && !sameDigest(raw.verifier, verifierFor(vaultKey))) {
    return { state: 'unreadable', data: {}, why: 'wrong master password' };
  }

  try {
    const hmac = crypto.createHmac('sha512', vaultKey).update(raw.enc).digest('hex');
    if (!sameDigest(hmac, String(raw.hmac))) {
      // No verifier means a vault written before Section 141, so a wrong
      // password and a tampered file are genuinely indistinguishable here. The
      // message says both rather than picking the flattering one.
      return { state: 'unreadable', data: {},
        why: raw.verifier
          ? 'the vault file failed its integrity check — it may have been tampered with'
          : 'wrong master password, or the vault file has been tampered with' };
    }
    const plain = decrypt(vaultKey, raw.enc);
    return { state: 'ok', data: JSON.parse(plain).data || {}, why: null };
  } catch (err) {
    return { state: 'unreadable', data: {}, why: `the vault could not be decrypted: ${err.message}` };
  }
}

// ─── Register IPC handlers ────────────────────────────────────────────────────
// Every handler below gates on vault.read/vault.write/vault.unlock, which are
// all tier 0 (master-only) in shared/capabilities.json. Before this pass none
// of them checked the caller's tier at all — any signed-in user (Guest
// included) could unlock, read, write, or delete ANY stored credential,
// including other providers' API keys. That contradicted the capability
// matrix's own definition and RAMA_AGI_MASTER_SPEC.md's "master-only" vault
// design; this closes the gap rather than changing the intended policy.
function register(ipcMain) {

  // ── Unlock vault ──────────────────────────────────────────────────────────
  ipcMain.handle('vault:unlock', async (_e, { user, password } = {}) => {
    const denied = capability.deny(user, 'vault.unlock');
    if (denied) return denied;
    if (typeof password !== 'string' || password.length === 0) {
      return { ok: false, error: 'A master password is required to unlock the vault.' };
    }
    try {
      const saltPath  = getSaltPath();
      const vaultPath = getVaultPath();
      let salt = null;

      // 1. The salt file is the only place the salt is written from now on.
      if (fs.existsSync(saltPath)) {
        const s = fs.readFileSync(saltPath, 'utf8').trim();
        if (/^[0-9a-f]{64}$/i.test(s)) salt = s;
      }

      // 2. MIGRATION, not a second source of truth: a vault written before
      //    Section 141 may still carry its salt inside the blob. If it does, it
      //    is adopted and copied out — that is the only case where an existing
      //    vault is still recoverable, so it is worth handling.
      if (!salt && fs.existsSync(vaultPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
          if (typeof raw.salt === 'string' && /^[0-9a-f]{64}$/i.test(raw.salt)) {
            salt = raw.salt;
            fs.writeFileSync(saltPath, salt, { encoding: 'utf8', mode: 0o600 });
          }
        } catch { /* unreadable JSON is handled by loadVault below */ }
      }

      // 3. A NEW SALT IS ONLY EVER MINTED WHEN THERE IS NO CIPHERTEXT TO LOSE.
      //    Minting one for an existing vault is what made the old vault
      //    permanently undecryptable, so that path now refuses instead.
      if (!salt) {
        let hasCiphertext = false;
        if (fs.existsSync(vaultPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
            hasCiphertext = typeof raw.enc === 'string' && raw.enc.length > 0;
          } catch { hasCiphertext = true; }   // unparseable but present: assume it matters
        }
        if (hasCiphertext) {
          vaultKey = null; vaultData = {}; vaultUnlocked = false;
          vaultReadable = false; vaultCorrupt = true;
          return { ok: false, unreadable: true,
            error: 'This vault has ciphertext but no salt, so no password can derive its key. '
              + 'It was written by a version that deleted the salt on first save (Section 141). '
              + 'The stored keys cannot be recovered; the file is left untouched so nothing further '
              + 'is lost. Re-enter the provider keys to start a new vault.' };
        }
        salt = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(saltPath, salt, { encoding: 'utf8', mode: 0o600 });
      }

      const key = await deriveKey(password, salt);

      // 4. VERIFY BEFORE COMMITTING. The old handler assigned the key and set
      //    `unlocked = true` unconditionally, so ANY password "worked" and left
      //    an empty vault that the next write would persist over the real one.
      //    `loadVault` reads the module-scope key, so it is set first and
      //    cleared again below if the read fails. Nothing is exposed in between:
      //    `vaultUnlocked` stays false until the read has succeeded, and every
      //    read/write handler gates on that flag rather than on the key.
      vaultKey = key;
      const loaded = loadVault();
      if (loaded.state === 'unreadable') {
        vaultKey = null; vaultData = {}; vaultUnlocked = false;
        vaultReadable = false; vaultCorrupt = true;
        return { ok: false, unreadable: true, error: `Vault not unlocked — ${loaded.why}.` };
      }

      vaultKey      = key;
      vaultData     = loaded.data;
      vaultUnlocked = true;
      vaultReadable = true;
      vaultCorrupt  = false;
      return { ok: true, entries: Object.keys(vaultData).length, fresh: loaded.state === 'empty' };
    } catch (err) {
      vaultKey = null; vaultData = {}; vaultUnlocked = false; vaultReadable = false;
      return { ok: false, error: err.message };
    }
  });

  // ── Lock vault ────────────────────────────────────────────────────────────
  ipcMain.handle('vault:lock', async (_e, { user } = {}) => {
    const denied = capability.deny(user, 'vault.unlock');
    if (denied) return denied;
    vaultKey      = null;
    vaultData     = {};
    vaultUnlocked = false;
    vaultReadable = false;
    // `vaultCorrupt` is deliberately NOT cleared here. It is a fact about the
    // file on disk, not about this session, and clearing it on lock would let a
    // lock/unlock cycle re-arm the overwrite that saveVault refuses.
    return { ok: true };
  });

  // ── Check vault status ────────────────────────────────────────────────────
  // Whether the vault is locked/unlocked and how many entries it holds is not
  // itself a secret (no values, no service names) — left open like
  // os.metrics-read so the UI can show vault state before master authenticates.
  ipcMain.handle('vault:status', async () => {
    const exists = fs.existsSync(getVaultPath());
    return {
      ok: true,
      unlocked: vaultUnlocked,
      entries: Object.keys(vaultData).length,
      // `exists` plus `unreadable` is what lets the UI tell master the three
      // states apart: nothing stored yet, locked but present, or present and
      // undecryptable. Neither is a secret — no values, no service names.
      exists,
      unreadable: vaultCorrupt,
    };
  });

  // ── Store credential ──────────────────────────────────────────────────────
  ipcMain.handle('vault:set', async (_e, { user, service, value, meta = {} } = {}) => {
    const denied = capability.deny(user, 'vault.write');
    if (denied) return denied;
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    if (typeof service !== 'string' || service.length === 0) {
      return { ok: false, error: 'A service name is required.' };
    }
    // THE WRITE IS ATTEMPTED BEFORE THE IN-MEMORY STORE IS MUTATED, so a refusal
    // (see saveVault) does not leave the process holding a credential it did not
    // persist — which would read back as stored until the next lock.
    const previous = Object.prototype.hasOwnProperty.call(vaultData, service)
      ? vaultData[service] : undefined;
    vaultData[service] = { value, meta, addedAt: Date.now() };
    const saved = saveVault();
    if (!saved.ok) {
      if (previous === undefined) delete vaultData[service];
      else vaultData[service] = previous;
      return saved;
    }
    return { ok: true };
  });

  // ── Get credential ────────────────────────────────────────────────────────
  ipcMain.handle('vault:get', async (_e, { user, service } = {}) => {
    const denied = capability.deny(user, 'vault.read');
    if (denied) return denied;
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    const entry = vaultData[service];
    if (!entry) return { ok: false, error: 'Not found' };
    return { ok: true, value: entry.value, meta: entry.meta };
  });

  // ── List services (no values exposed) ────────────────────────────────────
  ipcMain.handle('vault:list', async (_e, { user } = {}) => {
    const denied = capability.deny(user, 'vault.read');
    if (denied) return denied;
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
  ipcMain.handle('vault:delete', async (_e, { user, service } = {}) => {
    const denied = capability.deny(user, 'vault.write');
    if (denied) return denied;
    if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
    const previous = Object.prototype.hasOwnProperty.call(vaultData, service)
      ? vaultData[service] : undefined;
    delete vaultData[service];
    const saved = saveVault();
    if (!saved.ok) {
      if (previous !== undefined) vaultData[service] = previous;
      return saved;
    }
    return { ok: true };
  });

  // ── Check if service has credential ──────────────────────────────────────
  // Existence-only, no value — same sensitivity class as vault:status, so it
  // stays on vault.read but degrades to `has:false` rather than an error when
  // locked, since callers (e.g. Models.jsx provider cards) use this to decide
  // what to render before the vault may even be unlocked.
  ipcMain.handle('vault:has', async (_e, { user, service } = {}) => {
    const denied = capability.deny(user, 'vault.read');
    if (denied) return denied;
    if (!vaultUnlocked) return { ok: true, has: false };
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

/**
 * Direct (non-IPC) write/delete for other main-process modules that need to
 * store a credential as part of a larger operation (e.g.
 * customProviders.cjs's add(), which must roll back its own record if the
 * vault write fails). Same unlocked-check and storage path as `vault:set`/
 * `vault:delete` — this is not a second, looser write path, it is the one
 * path called either from IPC or directly within the main process.
 */
function setCredentialDirect(service, value, meta = {}) {
  if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
  const previous = Object.prototype.hasOwnProperty.call(vaultData, service)
    ? vaultData[service] : undefined;
  vaultData[service] = { value, meta, addedAt: Date.now() };
  // The refusal is PROPAGATED, not swallowed. `customProviders.add()` rolls its
  // own record back on a failed vault write, which it can only do if it is told.
  const saved = saveVault();
  if (!saved.ok) {
    if (previous === undefined) delete vaultData[service];
    else vaultData[service] = previous;
    return saved;
  }
  return { ok: true };
}

function deleteCredentialDirect(service) {
  if (!vaultUnlocked) return { ok: false, error: 'Vault locked' };
  const previous = Object.prototype.hasOwnProperty.call(vaultData, service)
    ? vaultData[service] : undefined;
  delete vaultData[service];
  const saved = saveVault();
  if (!saved.ok) {
    if (previous !== undefined) vaultData[service] = previous;
    return saved;
  }
  return { ok: true };
}

module.exports = {
  register, getCredential, isUnlocked,
  setCredentialDirect, deleteCredentialDirect,
};
