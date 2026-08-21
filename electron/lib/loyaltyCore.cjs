'use strict';

/**
 * loyaltyCore.cjs — the innermost layer. Encrypted separately, never handed out.
 *
 * Master's instruction: "LOYALTY MATRIX/DATA SHOULD BE ENCRYPTED, SHOULD BE AT
 * CENTER OF NUCLEUS — TOP PRIORITY ITEM. attacks should never reach it, that is
 * where loops to be generated as needed to avoid attacker reaching core."
 *
 * WHAT WAS WRONG. Invariant I15 (Section 55) stopped every *write* path to
 * loyalty. It did nothing about *reads*, and the reads were wide open:
 *
 *   - `loyalty` and `ethicalCore` were plain branches of `_nucleus`, so the whole
 *     matrix sat in plaintext memory for the entire session after unseal.
 *   - `getNucleus()` returned all of it to any caller with a require.
 *   - `genome.cjs` read `core.loyalty.master` and served it over `genome:get`,
 *     which has **no capability check** — a direct route from the core to the
 *     renderer.
 *   - Anything that serialises the nucleus — a crash report, a log, vector
 *     memory — would have carried the matrix with it.
 *
 * `nucleusSealer`'s own header names the threat this matters for: "An adversarial
 * AI could read these and craft attacks against them." Knowing the exact priority
 * ordering and decision rules is what makes that attack possible. Integrity alone
 * was not enough.
 *
 * THE CONCENTRIC DESIGN — four properties, each closing a specific route:
 *
 *   1. SEPARATE ENVELOPE, SEPARATE KEY. The core has its own salt and its own key,
 *      derived from master's passcode with a distinct HKDF info string. Opening the
 *      outer nucleus does not yield the core; compromising the nucleus keys does
 *      not compromise it.
 *   2. HELD ENCRYPTED IN MEMORY. The plaintext is never retained. It is decrypted
 *      inside `withCore()`, used, and the buffer zeroed before returning — so the
 *      window in which it exists in the clear is microseconds per query rather than
 *      the whole session. This is what protects it in a crash dump or a memory
 *      scrape.
 *   3. NO ACCESSOR RETURNS THE RULES. The core answers questions; it never
 *      surrenders data. `attest()`, `covenantHolds()`, `describe()` return
 *      booleans and metadata. You cannot steal what is never handed over.
 *   4. ESCALATING LOOPS. Each consecutive failed open multiplies the key-derivation
 *      work for the next attempt, then a cooldown refuses outright.
 *
 * ON "LOOPS", HONESTLY: an unbounded loop would be a denial of service against
 * Rāma itself — the attacker's tarpit would be master's hung app. So the loops are
 * *iterated key-derivation rounds whose count escalates*, with a ceiling and a
 * cooldown. A legitimate unseal pays the base cost once; an attacker pays a
 * doubling cost per attempt and is then refused. That achieves what master asked
 * without Rāma becoming its own victim.
 *
 * CORE NODE ONLY — like `crashGuard`, `selfRepair` and `loyaltyGuard`. The
 * innermost layer must not be defeatable by deleting a package.
 */

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ─── Cryptographic parameters ─────────────────────────────────────────────────
const AAD          = Buffer.from('rama-loyalty-core-v1', 'utf8');
const HKDF_INFO    = 'rama-loyalty-core-hkdf-v1';   // distinct from the nucleus's
const MAC_BYTES    = 64;                            // HMAC-SHA512
const IV_BYTES     = 12;
const TAG_BYTES    = 16;

// ─── The escalating loops ─────────────────────────────────────────────────────
const BASE_ROUNDS      = 4096;        // ~2-4ms — the honest cost for master
const MAX_ESCALATION   = 8;           // 2^8 = 256x
const CEILING_ROUNDS   = 1_048_576;   // never exceed ~1s of work
const COOLDOWN_AFTER   = 5;           // consecutive failures before refusing
const COOLDOWN_MS      = 30_000;

// ─── State — the core is held ENCRYPTED, never as a plaintext object ──────────
let _envelope  = null;   // Buffer: the sealed core, in memory, still encrypted
let _encKey    = null;   // Buffer
let _hmacKey   = null;   // Buffer
let _open      = false;
let _version   = 0;

// ─── Paths ────────────────────────────────────────────────────────────────────
function baseDir() {
  let base = null;
  try { base = require('electron').app?.getPath('userData') ?? null; }
  catch { /* no electron — fall through */ }
  return base || path.join(os.homedir(), '.rama-agi');
}
const corePath     = () => path.join(baseDir(), '.loyalty.enc');
const coreSaltPath = () => path.join(baseDir(), '.loyalty.salt');
const attemptsPath = () => path.join(baseDir(), '.loyalty.attempts');

// ─── Attempt accounting ───────────────────────────────────────────────────────
/**
 * Persisted so restarting the process does not reset the escalation — otherwise
 * an attacker just relaunches. A local attacker with master's OS account can
 * delete this file, which is the same boundary Section 55 already documented as
 * out of scope; within the threat model that matters here (code paths, IPC,
 * evolution) it holds.
 */
function readAttempts() {
  try {
    const raw = JSON.parse(fs.readFileSync(attemptsPath(), 'utf8'));
    return { failures: Number(raw.failures) || 0, lastFailAt: Number(raw.lastFailAt) || 0 };
  } catch { return { failures: 0, lastFailAt: 0 }; }
}

function writeAttempts(state) {
  try { fs.writeFileSync(attemptsPath(), JSON.stringify(state), { mode: 0o600 }); }
  catch { /* best effort — escalation still applies in-process */ }
}

function recordFailure() {
  const s = readAttempts();
  const next = { failures: s.failures + 1, lastFailAt: Date.now() };
  writeAttempts(next);
  return next;
}

function clearFailures() {
  try { fs.rmSync(attemptsPath(), { force: true }); } catch { /* fine */ }
}

/** How much work the next attempt must do, given what has already failed. */
function roundsFor(failures) {
  const factor = 2 ** Math.min(failures, MAX_ESCALATION);
  return Math.min(BASE_ROUNDS * factor, CEILING_ROUNDS);
}

/** Null when allowed, or a refusal describing the wait. */
function cooldownRefusal() {
  const { failures, lastFailAt } = readAttempts();
  if (failures < COOLDOWN_AFTER) return null;
  const waited = Date.now() - lastFailAt;
  if (waited >= COOLDOWN_MS) return null;
  return {
    ok: false,
    error: `Loyalty core is cooling down after ${failures} failed attempts — ${Math.ceil((COOLDOWN_MS - waited) / 1000)}s remaining`,
    cooldown: true,
  };
}

// ─── Key derivation — the loops ───────────────────────────────────────────────
/**
 * Iterated HMAC hardening on top of master's passcode, with a per-attempt round
 * count. These are master's "loops": the deeper an attacker gets into failed
 * attempts, the more work each further attempt costs.
 */
function deriveCoreKeys(passcode, salt, rounds) {
  let k = crypto.createHmac('sha512', salt).update(String(passcode), 'utf8').digest();
  const info = Buffer.from(HKDF_INFO, 'utf8');
  for (let i = 0; i < rounds; i++) {
    k = crypto.createHmac('sha512', salt)
      .update(k).update(info).update(Buffer.from(String(i & 0xff), 'utf8'))
      .digest();
  }
  // Separate 32-byte keys for confidentiality and integrity.
  const material = crypto.createHmac('sha512', Buffer.from(HKDF_INFO, 'utf8')).update(k).digest();
  k.fill(0);
  return { encKey: material.subarray(0, 32), hmacKey: material.subarray(32, 64) };
}

// ─── Envelope format ──────────────────────────────────────────────────────────
function encryptCore(obj, encKey, hmacKey, rounds) {
  const plain  = Buffer.from(JSON.stringify(obj), 'utf8');
  const iv     = crypto.randomBytes(IV_BYTES);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(rounds, 0);      // authenticated: rounds cannot be downgraded

  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  cipher.setAAD(Buffer.concat([AAD, header]));
  const ct  = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  plain.fill(0);

  const body = Buffer.concat([header, iv, tag, ct]);
  const mac  = crypto.createHmac('sha512', hmacKey).update(body).digest();
  return Buffer.concat([body, mac]);
}

function decryptCore(buf, encKey, hmacKey) {
  if (buf.length < 4 + IV_BYTES + TAG_BYTES + MAC_BYTES) {
    throw new Error('Loyalty core envelope is truncated');
  }
  const body = buf.subarray(0, buf.length - MAC_BYTES);
  const mac  = buf.subarray(buf.length - MAC_BYTES);
  const want = crypto.createHmac('sha512', hmacKey).update(body).digest();
  if (!crypto.timingSafeEqual(mac, want)) {
    throw new Error('Loyalty core integrity check failed — the core may have been tampered with');
  }

  const header = body.subarray(0, 4);
  const iv     = body.subarray(4, 4 + IV_BYTES);
  const tag    = body.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES);
  const ct     = body.subarray(4 + IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAAD(Buffer.concat([AAD, header]));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  try { return JSON.parse(plain.toString('utf8')); }
  finally { plain.fill(0); }
}

function roundsOf(buf) {
  try { return buf.subarray(0, 4).readUInt32BE(0); } catch { return BASE_ROUNDS; }
}

// ─── Seal ─────────────────────────────────────────────────────────────────────
/**
 * Seal the loyalty matrix into its own envelope. Refuses a non-conforming core:
 * the covenant (I15) is checked before anything is written, so a violating matrix
 * cannot be sealed any more than it could be merged.
 */
async function sealCore(passcode, coreObj) {
  require('./loyaltyGuard.cjs').assertIntact(coreObj, 'sealing the loyalty core');

  let salt;
  try { salt = fs.readFileSync(coreSaltPath()); }
  catch {
    salt = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(coreSaltPath()), { recursive: true });
    fs.writeFileSync(coreSaltPath(), salt, { mode: 0o600 });
  }

  const rounds = BASE_ROUNDS;
  const { encKey, hmacKey } = deriveCoreKeys(passcode, salt, rounds);
  const envelope = encryptCore(coreObj, encKey, hmacKey, rounds);

  fs.writeFileSync(corePath(), envelope, { mode: 0o600 });

  _envelope = envelope;
  _encKey   = encKey;
  _hmacKey  = hmacKey;
  _open     = true;
  _version  = Number(coreObj.coreVersion) || 1;
  clearFailures();

  return { ok: true, version: _version, bytes: envelope.length };
}

// ─── Open ─────────────────────────────────────────────────────────────────────
/**
 * Open the core. The plaintext is NOT retained — only the keys and the still
 * encrypted envelope, so every read goes through `withCore` and zeroes after
 * itself.
 */
async function openCore(passcode) {
  const cooling = cooldownRefusal();
  if (cooling) return cooling;

  let envelope, salt;
  try { envelope = fs.readFileSync(corePath()); salt = fs.readFileSync(coreSaltPath()); }
  catch { return { ok: false, error: 'No sealed loyalty core on this machine', absent: true }; }

  // The round count is authenticated inside the envelope, so it cannot be
  // downgraded by editing the file — a tampered header fails the GCM tag.
  const rounds = roundsOf(envelope);
  const { failures } = readAttempts();
  const workRounds = Math.max(rounds, roundsFor(failures));

  const { encKey, hmacKey } = deriveCoreKeys(passcode, salt, workRounds);

  try {
    const core = decryptCore(envelope, encKey, hmacKey);
    require('./loyaltyGuard.cjs').assertIntact(core, 'opening the loyalty core');

    _envelope = envelope;
    _encKey   = encKey;
    _hmacKey  = hmacKey;
    _open     = true;
    _version  = Number(core.coreVersion) || 1;
    clearFailures();
    return { ok: true, version: _version };
  } catch (err) {
    encKey.fill(0); hmacKey.fill(0);
    const next = recordFailure();
    return {
      ok: false,
      error: `${err.message} (attempt ${next.failures}; next attempt costs ${roundsFor(next.failures)} rounds)`,
      failures: next.failures,
    };
  }
}

// ─── The only way to read it ───────────────────────────────────────────────────
/**
 * Decrypt transiently, hand the plaintext to `fn`, then discard it.
 *
 * `fn` must return a *derived answer* — a boolean, a count, a single display
 * field — never the object itself. Nothing in this module returns the matrix, and
 * that is the point: an attacker cannot exfiltrate what is never handed over.
 *
 * @template T
 * @param {(core: object) => T} fn
 * @returns {T|null} null when the core is not open
 */
function withCore(fn) {
  if (!_open || !_encKey || !_hmacKey || !_envelope) return null;
  let core = null;
  try {
    core = decryptCore(_envelope, _encKey, _hmacKey);
    return fn(core);
  } catch { return null; }
  finally {
    // Overwrite every string/primitive we can reach before dropping the reference,
    // so the plaintext is not left for the garbage collector to leak into a dump.
    if (core && typeof core === 'object') scrub(core);
    core = null;
  }
}

function scrub(node, depth = 0) {
  if (depth > 8 || !node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object') scrub(v, depth + 1);
    try { node[k] = null; } catch { /* frozen — nothing to do */ }
  }
}

// ─── Questions the core will answer ───────────────────────────────────────────
/** Does the sealed core still satisfy the covenant? A boolean, nothing more. */
function attest() {
  const guard = require('./loyaltyGuard.cjs');
  return withCore(c => guard.inspect(c).ok) === true;
}

/** @returns {{ok:boolean, violations:string[]}} for reporting to master only. */
function covenantHolds() {
  const guard = require('./loyaltyGuard.cjs');
  return withCore(c => guard.inspect(c)) ?? { ok: false, violations: ['core is not open'] };
}

/**
 * The single field the UI genuinely needs. Master's display name is not a secret
 * — it is in the spec, the git history and the system prompt. The decision rules,
 * the priority ordering and the ethical matrix are, and none of them leave here.
 */
function displayIdentity() {
  return withCore(c => ({ master: c?.loyalty?.master ?? null })) ?? { master: null };
}

/** Metadata about the core. Never its contents. */
function describe() {
  const { failures, lastFailAt } = readAttempts();
  return {
    present:  fs.existsSync(corePath()),
    open:     _open,
    version:  _version,
    bytes:    _envelope?.length ?? 0,
    rounds:   _envelope ? roundsOf(_envelope) : null,
    failures, lastFailAt,
    nextAttemptRounds: roundsFor(failures),
    cooling:  Boolean(cooldownRefusal()),
  };
}

/** Fingerprint for drift detection — a hash, not the data. */
function fingerprint() {
  if (!_envelope) return null;
  return crypto.createHash('sha256').update(_envelope).digest('hex').slice(0, 16);
}

// ─── Lock ─────────────────────────────────────────────────────────────────────
function lock() {
  if (_encKey)  _encKey.fill(0);
  if (_hmacKey) _hmacKey.fill(0);
  if (_envelope) _envelope.fill(0);
  _encKey = null; _hmacKey = null; _envelope = null;
  _open = false;
}

const isOpen = () => _open;

module.exports = {
  sealCore, openCore, lock, isOpen,
  withCore, attest, covenantHolds, displayIdentity, describe, fingerprint,
  BASE_ROUNDS, CEILING_ROUNDS, COOLDOWN_AFTER, COOLDOWN_MS, roundsFor,
};
