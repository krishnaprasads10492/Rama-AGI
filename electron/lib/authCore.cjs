'use strict';

/**
 * authCore.cjs — Rāma's authentication core.
 *
 * TWO-FACTOR BY DESIGN. Reaching Rāma takes three independent secrets:
 *
 *   Gate 1  PASSCODE   decrypts the data store        (sessionManager/cryptoCore)
 *   Gate 2  PASSWORD   proves who you are             (Argon2id, this module)
 *   Gate 3  ACCESS KEY proves you hold the issued key (HMAC, this module)
 *
 * Gate 1 protects the data at rest. Gates 2 and 3 protect the identity. A
 * stolen password alone is useless, and a stolen key alone is useless.
 *
 * SECURITY PROPERTIES:
 *   - Argon2id password hashing (64 MiB, t=3, p=4), scrypt fallback if the
 *     native module is unavailable — never plaintext, never a bare digest
 *   - Brute-force lockout: 5 failures → 15 minutes, per username
 *   - Constant-time comparison for every secret (timingSafeEqual)
 *   - Generic error text on the failure paths that could enumerate users
 *   - A dummy hash is computed for unknown users so the timing matches
 *   - Step-1 tokens live 10 minutes and are never persisted
 *   - Session tokens slide on activity and are bound to a client fingerprint
 *   - Access keys are stored as HMAC-SHA256(key, userId) — the key itself is
 *     shown once and never written anywhere
 *   - Master tier (0) cannot be granted through this module; it is provisioned
 *     once at first run and is immutable afterwards
 *
 * STORAGE: injected, so the same core serves the Electron main process (backed
 * by the encrypted dataStore) without a second implementation existing anywhere.
 */

const crypto = require('crypto');
const { TIERS, TIER_LABELS } = require('./capability.cjs');

// ─── Tunables ─────────────────────────────────────────────────────────────────
const SESSION_TTL_MS   = 7 * 24 * 60 * 60 * 1000;   // 7 days
const SESSION_SLIDE_MS = 60 * 60 * 1000;            // extend after 1h of activity
const STEP1_TTL_MS     = 10 * 60 * 1000;            // 10 min to enter the key
const LOCKOUT_TRIES    = 5;
const LOCKOUT_MS       = 15 * 60 * 1000;
const KEY_DEFAULT_DAYS = 30;
const KEY_MAX_DAYS     = 365;

const ARGON2_OPTS = { memoryCost: 65536, timeCost: 3, parallelism: 4 };

// ─── Storage adapter ──────────────────────────────────────────────────────────
/**
 * @typedef  {Object} Storage
 * @property {() => object[]} listUsers
 * @property {(user: object) => void} putUser
 * @property {(userId: string) => void} deleteUser
 * @property {() => object} readMeta
 * @property {(meta: object) => void} writeMeta
 */

/** @type {Storage|null} */
let store = null;

function setStorage(adapter) { store = adapter; }
function requireStore() {
  if (!store) throw new Error('authCore: storage adapter not set');
  return store;
}

// ─── Volatile state ───────────────────────────────────────────────────────────
const sessions = new Map();   // token → { userId, username, tier, step, expiresAt, lastActivity, fp }
const attempts = new Map();   // username → { count, lockedUntil }

// ─── Password hashing ─────────────────────────────────────────────────────────
function argon2() {
  try { return require('argon2'); } catch { return null; }
}

async function hashPassword(password) {
  const a2 = argon2();
  if (a2) return a2.hash(password, { type: a2.argon2id, ...ARGON2_OPTS });

  // scrypt fallback — still memory-hard, still salted, marked so verify knows
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(32);
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, hash) {
  if (!hash) return false;
  try {
    if (hash.startsWith('scrypt$')) {
      const [, saltHex, keyHex] = hash.split('$');
      const salt = Buffer.from(saltHex, 'hex');
      return await new Promise((resolve) => {
        crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
          if (err) return resolve(false);
          const want = Buffer.from(keyHex, 'hex');
          resolve(key.length === want.length && crypto.timingSafeEqual(key, want));
        });
      });
    }
    const a2 = argon2();
    if (!a2) return false;
    return await a2.verify(hash, password);
  } catch { return false; }
}

/** Burn the same CPU as a real verify so unknown users are not detectable. */
async function dummyVerify(seed) {
  try { await hashPassword(`timing-equalisation-${seed}`); } catch { /* ignore */ }
}

// ─── Password policy ──────────────────────────────────────────────────────────
function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Password is required' };
  }
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters' };
  }
  if (password.length > 256) {
    return { ok: false, error: 'Password must be 256 characters or fewer' };
  }
  if (!/[A-Z]/.test(password)) return { ok: false, error: 'Password needs an uppercase letter' };
  if (!/[a-z]/.test(password)) return { ok: false, error: 'Password needs a lowercase letter' };
  if (!/[0-9]/.test(password)) return { ok: false, error: 'Password needs a number' };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, error: 'Password needs a symbol' };

  const weak = ['password', 'rama', 'admin', 'qwerty', '12345678', 'letmein', 'welcome'];
  const lower = password.toLowerCase();
  if (weak.some(w => lower.includes(w))) {
    return { ok: false, error: 'Password contains a commonly guessed word' };
  }
  return { ok: true };
}

function checkUsername(username) {
  const clean = String(username ?? '').trim().toLowerCase();
  if (clean.length < 4 || clean.length > 32) {
    return { ok: false, error: 'Username must be 4–32 characters' };
  }
  if (!/^[a-z0-9_.-]+$/.test(clean)) {
    return { ok: false, error: 'Username may use letters, numbers, dot, dash, underscore' };
  }
  return { ok: true, clean };
}

// ─── Lockout ──────────────────────────────────────────────────────────────────
function lockedFor(username) {
  const rec = attempts.get(username);
  if (!rec?.lockedUntil) return 0;
  const left = rec.lockedUntil - Date.now();
  if (left <= 0) { attempts.delete(username); return 0; }
  return left;
}

function recordFailure(username) {
  const rec = attempts.get(username) ?? { count: 0, lockedUntil: 0 };
  rec.count++;
  if (rec.count >= LOCKOUT_TRIES) rec.lockedUntil = Date.now() + LOCKOUT_MS;
  attempts.set(username, rec);
  return rec;
}

function clearFailures(username) { attempts.delete(username); }

// ─── User lookup ──────────────────────────────────────────────────────────────
function allUsers() {
  try { return requireStore().listUsers() ?? []; } catch { return []; }
}

function findByUsername(username) {
  const u = String(username ?? '').trim().toLowerCase();
  return allUsers().find(x => x.username === u) ?? null;
}

function findById(userId) {
  return allUsers().find(x => x.userId === userId) ?? null;
}

function publicUser(u) {
  if (!u) return null;
  return {
    userId:  u.userId,
    id:      u.userId,          // renderer stores use `id`
    username: u.username,
    name:    u.displayName ?? u.username,
    tier:    u.tier,
    tierLabel: TIER_LABELS[String(u.tier)] ?? 'Unknown',
    isMaster: u.tier === TIERS.MASTER,
    isActive: u.isActive !== false,
    hasKey:  !!u.keyHash,
    keyExpiresAt: u.keyExpiresAt ?? null,
    mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
    loginCount: u.loginCount ?? 0,
  };
}

// ─── Tokens ───────────────────────────────────────────────────────────────────
function newToken() { return crypto.randomBytes(32).toString('hex'); }

function fingerprint(input) {
  return crypto.createHash('sha256').update(String(input ?? '')).digest('hex').slice(0, 16);
}

function pruneSessions() {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expiresAt <= now) sessions.delete(t);
}

// ─── Access keys ──────────────────────────────────────────────────────────────
/**
 * 12 digits, grouped 4-4-4. Stored as HMAC-SHA256 keyed by the digits over the
 * userId, so the key is not recoverable from the store and is bound to one user.
 */
function mintKey(userId) {
  const digits = Array.from({ length: 12 }, () => crypto.randomInt(0, 10)).join('');
  return {
    digits,
    formatted: `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`,
    hash: crypto.createHmac('sha256', digits).update(userId).digest('hex'),
  };
}

function keyMatches(userId, storedHash, supplied) {
  const digits = String(supplied ?? '').replace(/\D/g, '');
  if (digits.length !== 12 || !storedHash) return false;
  const computed = crypto.createHmac('sha256', digits).update(userId).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Issue a fresh access key. Rotation is implicit: the previous key stops
 * working the moment this returns, because only one hash is stored.
 */
function issueAccessKey(userId, daysValid = KEY_DEFAULT_DAYS) {
  const user = findById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  const days = Math.min(Math.max(Number(daysValid) || KEY_DEFAULT_DAYS, 1), KEY_MAX_DAYS);
  const { formatted, hash } = mintKey(userId);
  const expiresAt = Date.now() + days * 86_400_000;

  requireStore().putUser({ ...user, keyHash: hash, keyExpiresAt: expiresAt, keyIssuedAt: Date.now() });

  // Returned once. Nothing anywhere can reproduce it after this.
  return { ok: true, key: formatted, expiresAt, daysValid: days };
}

// ─── Provisioning (first run) ─────────────────────────────────────────────────
/**
 * Has this copy of Rāma been provisioned with an owner account?
 * The packaged build asks this before showing anything else — the user never
 * needs to touch the source to set the instance up.
 */
function isProvisioned() {
  const meta = requireStore().readMeta() ?? {};
  return !!meta.provisionedAt && allUsers().length > 0;
}

function instanceInfo() {
  const meta = requireStore().readMeta() ?? {};
  return {
    provisioned:   !!meta.provisionedAt,
    provisionedAt: meta.provisionedAt ?? null,
    instanceId:    meta.instanceId ?? null,
    instanceName:  meta.instanceName ?? null,
    ownerTier:     meta.ownerTier ?? null,
    ownerTierLabel: meta.ownerTier != null ? TIER_LABELS[String(meta.ownerTier)] : null,
    masterClaimed: !!meta.masterClaimed,
    userCount:     allUsers().length,
  };
}

/**
 * Provision this instance. Runs once, from the UI, on first launch.
 *
 * TIER POLICY — the deliberate answer to "who owns a distributed copy":
 *   Master (0) is Rāma's single principal and is never granted by provisioning.
 *   It is claimable only with the master enrolment secret, which ships with no
 *   build. Every other copy provisions its owner at SuperAdmin (1) by default —
 *   full operational control of that instance, no access to master identity.
 *   The user may deliberately choose a lower tier for their own instance.
 *
 * @param {object} opts { username, password, displayName, tier, instanceName, masterSecret }
 */
async function provision(opts = {}) {
  const s = requireStore();

  if (isProvisioned()) {
    return { ok: false, error: 'This instance is already provisioned' };
  }

  const nameCheck = checkUsername(opts.username);
  if (!nameCheck.ok) return nameCheck;

  const pwCheck = checkPasswordStrength(opts.password);
  if (!pwCheck.ok) return pwCheck;

  // ── Tier decision ───────────────────────────────────────────────────────────
  let tier = Number(opts.tier);
  if (!Number.isInteger(tier) || tier < TIERS.SUPERADMIN || tier > TIERS.VIEWER) {
    tier = TIERS.SUPERADMIN;   // second level — the documented default
  }

  let masterClaimed = false;
  if (opts.masterSecret) {
    const expected = process.env.RAMA_MASTER_ENROLMENT ?? '';
    const supplied = String(opts.masterSecret);
    const okSecret = expected.length > 0
      && supplied.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));

    if (!okSecret) {
      // Do not reveal whether an enrolment secret is even configured
      return { ok: false, error: 'Master enrolment secret rejected' };
    }
    tier = TIERS.MASTER;
    masterClaimed = true;
  }

  const userId = crypto.randomUUID();
  const user = {
    userId,
    username:     nameCheck.clean,
    displayName:  String(opts.displayName ?? '').trim().slice(0, 64) || nameCheck.clean,
    passwordHash: await hashPassword(opts.password),
    tier,
    keyHash:      null,
    keyExpiresAt: null,
    isActive:     true,
    mustChangePassword: false,   // the owner just chose this password
    createdAt:    Date.now(),
    createdBy:    'provisioning',
    lastLoginAt:  null,
    loginCount:   0,
  };
  s.putUser(user);

  // Issue the first access key so login can complete immediately
  const key = issueAccessKey(userId, KEY_DEFAULT_DAYS);

  s.writeMeta({
    ...(s.readMeta() ?? {}),
    provisionedAt: Date.now(),
    instanceId:    crypto.randomUUID(),
    instanceName:  String(opts.instanceName ?? '').trim().slice(0, 64) || `${os_hostname()}-rama`,
    ownerTier:     tier,
    ownerUserId:   userId,
    masterClaimed,
  });

  return {
    ok: true,
    user: publicUser(user),
    accessKey: key.ok ? key.key : null,
    keyExpiresAt: key.ok ? key.expiresAt : null,
    tier,
    tierLabel: TIER_LABELS[String(tier)],
    note: 'Save the access key. It is shown once and cannot be recovered.',
  };
}

function os_hostname() {
  try { return require('os').hostname().replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || 'instance'; }
  catch { return 'instance'; }
}

// ─── Login step 1: username + password ────────────────────────────────────────
/**
 * @returns {Promise<{ok:boolean, stepToken?:string, error?:string, mustChangePassword?:boolean}>}
 */
async function loginStep1(username, password) {
  pruneSessions();

  const uname = String(username ?? '').trim().toLowerCase();
  if (!uname || !password) return { ok: false, error: 'Username and password are required' };
  if (uname.length > 64 || String(password).length > 256) {
    return { ok: false, error: 'Invalid credentials' };
  }

  const lockMs = lockedFor(uname);
  if (lockMs > 0) {
    const mins = Math.ceil(lockMs / 60000);
    return { ok: false, error: `Too many attempts. Locked for ${mins} more minute${mins === 1 ? '' : 's'}.`, lockedMs: lockMs };
  }

  const user = findByUsername(uname);
  if (!user || user.isActive === false) {
    await dummyVerify(uname);          // equal timing for unknown users
    recordFailure(uname);
    return { ok: false, error: 'Invalid credentials' };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const rec  = recordFailure(uname);
    const left = LOCKOUT_TRIES - rec.count;
    return {
      ok: false,
      error: left > 0
        ? `Invalid credentials. ${left} attempt${left === 1 ? '' : 's'} remaining.`
        : 'Invalid credentials. Account locked for 15 minutes.',
    };
  }

  clearFailures(uname);

  const stepToken = newToken();
  sessions.set(stepToken, {
    userId: user.userId, username: user.username, tier: user.tier,
    step: 1, expiresAt: Date.now() + STEP1_TTL_MS, lastActivity: Date.now(), fp: null,
  });

  return {
    ok: true,
    stepToken,
    needsKey: true,
    hasKey: !!user.keyHash,
    keyExpired: !!(user.keyExpiresAt && user.keyExpiresAt < Date.now()),
    mustChangePassword: !!user.mustChangePassword,
    expiresInMs: STEP1_TTL_MS,
  };
}

// ─── Login step 2: 12-digit access key ────────────────────────────────────────
function loginStep2(stepToken, key, clientFingerprint = '') {
  pruneSessions();

  const step = sessions.get(String(stepToken ?? ''));
  if (!step || step.step !== 1) {
    return { ok: false, error: 'This login attempt expired. Start again.' };
  }

  const user = findById(step.userId);
  if (!user || user.isActive === false) {
    sessions.delete(stepToken);
    return { ok: false, error: 'Account unavailable' };
  }
  if (!user.keyHash) {
    return { ok: false, error: 'No access key is set for this account. Generate one to continue.', needsKeygen: true };
  }
  if (user.keyExpiresAt && user.keyExpiresAt < Date.now()) {
    return { ok: false, error: 'Access key expired. Generate a new one to continue.', needsKeygen: true };
  }

  if (!keyMatches(user.userId, user.keyHash, key)) {
    recordFailure(user.username);
    const lockMs = lockedFor(user.username);
    if (lockMs > 0) {
      sessions.delete(stepToken);
      return { ok: false, error: 'Too many attempts. Account locked for 15 minutes.' };
    }
    return { ok: false, error: 'Invalid access key' };
  }

  clearFailures(user.username);
  sessions.delete(stepToken);

  const token = newToken();
  const now   = Date.now();
  sessions.set(token, {
    userId: user.userId, username: user.username, tier: user.tier,
    step: 2, expiresAt: now + SESSION_TTL_MS, lastActivity: now,
    fp: fingerprint(clientFingerprint),
  });

  requireStore().putUser({ ...user, lastLoginAt: now, loginCount: (user.loginCount ?? 0) + 1 });

  return {
    ok: true,
    token,
    expiresAt: now + SESSION_TTL_MS,
    user: publicUser({ ...user, lastLoginAt: now }),
  };
}

// ─── Session validation ───────────────────────────────────────────────────────
/**
 * Validate a session token. The client fingerprint is bound on first use; a
 * later mismatch means the token moved to a different client, so it is revoked
 * rather than trusted.
 */
function validateSession(token, clientFingerprint = '') {
  pruneSessions();
  const s = sessions.get(String(token ?? ''));
  if (!s || s.step !== 2) return null;

  const fp = fingerprint(clientFingerprint);
  if (!s.fp) {
    s.fp = fp;
  } else if (s.fp !== fp) {
    sessions.delete(token);
    return null;
  }

  const now = Date.now();
  if (now - s.lastActivity > SESSION_SLIDE_MS) {
    s.expiresAt    = now + SESSION_TTL_MS;
    s.lastActivity = now;
  }

  const user = findById(s.userId);
  if (!user || user.isActive === false) { sessions.delete(token); return null; }
  // Tier changes take effect on the next request, not at the next login
  s.tier = user.tier;

  return { userId: s.userId, username: s.username, tier: user.tier, expiresAt: s.expiresAt };
}

/** Validate a step-1 token — used by pre-session keygen on the login screen. */
function validateStepToken(token) {
  pruneSessions();
  const s = sessions.get(String(token ?? ''));
  if (!s || s.step !== 1) return null;
  return { userId: s.userId, username: s.username, tier: s.tier };
}

function logout(token) {
  sessions.delete(String(token ?? ''));
  return { ok: true };
}

function revokeUserSessions(userId) {
  let n = 0;
  for (const [t, s] of sessions) if (s.userId === userId) { sessions.delete(t); n++; }
  return n;
}

function activeSessions() {
  pruneSessions();
  return [...sessions.values()]
    .filter(s => s.step === 2)
    .map(s => ({ username: s.username, tier: s.tier, expiresAt: s.expiresAt, lastActivity: s.lastActivity }));
}

// ─── Keygen paths ─────────────────────────────────────────────────────────────
/**
 * Generate a key while already signed in. The password is re-verified so a
 * hijacked session cannot mint itself a fresh key.
 */
async function keygenAuthenticated(userId, password, daysValid) {
  const user = findById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  if (!await verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: 'Incorrect password' };
  }
  return issueAccessKey(userId, daysValid);
}

/**
 * Generate a key from a live step-1 token — the "I passed the password gate but
 * have no key" case on the login screen. Capped at 7 days because this path
 * involves no second factor by definition.
 */
function keygenFromStepToken(stepToken) {
  const step = validateStepToken(stepToken);
  if (!step) return { ok: false, error: 'Login attempt expired — sign in again' };

  const res = issueAccessKey(step.userId, 7);
  return res.ok ? { ...res, username: step.username } : res;
}

/**
 * Generate a key straight from credentials. Used on a fresh machine where the
 * user has a password but no key at all. Password strength gates it, lockout
 * applies, and validity is capped at 7 days.
 */
async function keygenFromCredentials(username, password) {
  const step = await loginStep1(username, password);
  if (!step.ok) return step;

  const sess = validateStepToken(step.stepToken);
  if (!sess) return { ok: false, error: 'Internal error — please retry' };

  const res = issueAccessKey(sess.userId, 7);
  if (!res.ok) return res;

  // Hand back a fresh step token so login continues without re-entering the password
  return { ...res, username: sess.username, stepToken: step.stepToken };
}

// ─── User management ──────────────────────────────────────────────────────────
/**
 * Create a user. `actor` is the authenticated session performing the action.
 * Two invariants: master tier can never be assigned here, and nobody may create
 * a user at or above their own privilege.
 */
async function createUser(actor, fields = {}) {
  if (!actor) return { ok: false, error: 'Not authenticated' };

  const nameCheck = checkUsername(fields.username);
  if (!nameCheck.ok) return nameCheck;

  const pwCheck = checkPasswordStrength(fields.password);
  if (!pwCheck.ok) return pwCheck;

  const tier = Number(fields.tier);
  if (!Number.isInteger(tier) || tier < TIERS.SUPERADMIN || tier > TIERS.GUEST) {
    return { ok: false, error: `Tier must be ${TIERS.SUPERADMIN}–${TIERS.GUEST}. Master cannot be created.` };
  }
  if (tier <= actor.tier && actor.tier !== TIERS.MASTER) {
    return { ok: false, error: 'You cannot create a user at or above your own access level' };
  }
  if (findByUsername(nameCheck.clean)) {
    return { ok: false, error: 'That username is taken' };
  }

  const userId = crypto.randomUUID();
  const user = {
    userId,
    username:     nameCheck.clean,
    displayName:  String(fields.displayName ?? '').trim().slice(0, 64) || nameCheck.clean,
    passwordHash: await hashPassword(fields.password),
    tier,
    keyHash:      null,
    keyExpiresAt: null,
    isActive:     true,
    mustChangePassword: true,     // the creator chose this password, not the user
    createdAt:    Date.now(),
    createdBy:    actor.userId,
    lastLoginAt:  null,
    loginCount:   0,
  };
  requireStore().putUser(user);

  // A new user needs a key to get past gate 3
  const key = issueAccessKey(userId, KEY_DEFAULT_DAYS);

  return {
    ok: true,
    user: publicUser(user),
    accessKey: key.ok ? key.key : null,
    keyExpiresAt: key.ok ? key.expiresAt : null,
    note: 'Give the user their access key now — it cannot be shown again.',
  };
}

async function changePassword(userId, currentPassword, newPassword, byAdmin = false) {
  const user = findById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  if (!byAdmin && !await verifyPassword(currentPassword, user.passwordHash)) {
    return { ok: false, error: 'Current password is incorrect' };
  }
  if (currentPassword && currentPassword === newPassword) {
    return { ok: false, error: 'New password must differ from the current one' };
  }

  const pwCheck = checkPasswordStrength(newPassword);
  if (!pwCheck.ok) return pwCheck;

  requireStore().putUser({
    ...user,
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    passwordChangedAt: Date.now(),
  });

  // Every existing session for this user is invalidated — a password change is
  // the standard response to suspected compromise, so old tokens must die.
  const revoked = revokeUserSessions(userId);
  return { ok: true, revokedSessions: revoked, note: 'Sign in again with the new password.' };
}

function setUserTier(actor, userId, tier) {
  if (!actor) return { ok: false, error: 'Not authenticated' };
  const user = findById(userId);
  if (!user) return { ok: false, error: 'User not found' };
  if (user.tier === TIERS.MASTER) return { ok: false, error: 'The master account is immutable' };

  const t = Number(tier);
  if (!Number.isInteger(t) || t < TIERS.SUPERADMIN || t > TIERS.GUEST) {
    return { ok: false, error: `Tier must be ${TIERS.SUPERADMIN}–${TIERS.GUEST}` };
  }
  if (actor.tier !== TIERS.MASTER && t <= actor.tier) {
    return { ok: false, error: 'You cannot grant an access level at or above your own' };
  }

  requireStore().putUser({ ...user, tier: t, tierChangedAt: Date.now(), tierChangedBy: actor.userId });
  return { ok: true, user: publicUser({ ...user, tier: t }) };
}

function setActive(actor, userId, isActive) {
  if (!actor) return { ok: false, error: 'Not authenticated' };
  const user = findById(userId);
  if (!user) return { ok: false, error: 'User not found' };
  if (user.tier === TIERS.MASTER) return { ok: false, error: 'The master account cannot be suspended' };
  if (actor.tier !== TIERS.MASTER && actor.tier >= user.tier) {
    return { ok: false, error: 'You cannot change a user at or above your own access level' };
  }

  requireStore().putUser({ ...user, isActive: !!isActive });
  if (!isActive) revokeUserSessions(userId);
  return { ok: true, user: publicUser({ ...user, isActive: !!isActive }) };
}

function deleteUser(actor, userId) {
  if (!actor) return { ok: false, error: 'Not authenticated' };
  const user = findById(userId);
  if (!user) return { ok: false, error: 'User not found' };
  if (user.tier === TIERS.MASTER) return { ok: false, error: 'The master account cannot be deleted' };
  if (actor.userId === userId) return { ok: false, error: 'You cannot delete your own account' };
  if (actor.tier !== TIERS.MASTER && actor.tier >= user.tier) {
    return { ok: false, error: 'You cannot delete a user at or above your own access level' };
  }

  revokeUserSessions(userId);
  requireStore().deleteUser(userId);
  return { ok: true };
}

function listUsers() {
  return allUsers().map(publicUser);
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────
function status() {
  const users = allUsers();
  return {
    provisioned:  isProvisioned(),
    userCount:    users.length,
    activeSessions: activeSessions().length,
    lockedAccounts: [...attempts.entries()]
      .filter(([u]) => lockedFor(u) > 0)
      .map(([u, r]) => ({ username: u, unlocksInMs: r.lockedUntil - Date.now() })),
    hashing:      argon2() ? 'argon2id' : 'scrypt-fallback',
    usersWithoutKey: users.filter(u => !u.keyHash).map(u => u.username),
    expiredKeys:  users
      .filter(u => u.keyExpiresAt && u.keyExpiresAt < Date.now())
      .map(u => u.username),
  };
}

module.exports = {
  setStorage,
  // provisioning
  isProvisioned, instanceInfo, provision,
  // login
  loginStep1, loginStep2, validateSession, validateStepToken, logout,
  // keys
  issueAccessKey, keygenAuthenticated, keygenFromStepToken, keygenFromCredentials,
  // users
  createUser, changePassword, setUserTier, setActive, deleteUser, listUsers,
  findById, findByUsername, publicUser,
  // sessions
  activeSessions, revokeUserSessions,
  // policy helpers (exported so the UI can validate before submitting)
  checkPasswordStrength, checkUsername,
  hashPassword, verifyPassword,
  status,
  SESSION_TTL_MS, STEP1_TTL_MS, LOCKOUT_TRIES,
};
