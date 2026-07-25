'use strict';

/**
 * auth.cjs — Authentication & user management routes.
 *
 * All session tokens are HMAC-SHA256 signed.
 * Passwords hashed with Argon2id (128 MiB, 4 iter).
 * Master account is immutable — cannot be deleted or demoted.
 *
 * Routes:
 *   POST /api/auth/login          — username + password → session token
 *   POST /api/auth/logout         — invalidate token
 *   GET  /api/auth/me             — current user from token
 *   GET  /api/users               — list users (Admin+)
 *   POST /api/users               — create user (Master only)
 *   PUT  /api/users/:id           — edit user (Master only)
 *   PUT  /api/users/:id/suspend   — suspend user (Admin+)
 *   DELETE /api/users/:id         — delete user (Master only)
 */

const express  = require('express');
const crypto   = require('crypto');
const router   = express.Router();

// Tiers come from shared/capabilities.json — the same file the renderer and the
// Electron main process read. Previously this was a hand-kept mirror.
const { TIERS, can } = require('../../electron/lib/capability.cjs');

// ─── In-memory stores (Phase 5: migrate to MongoDB) ───────────────────────────
// Users: { id, name, email, passwordHash, tier, suspended, createdAt, lastLogin }
const users   = new Map();
const sessions = new Map();   // token → { userId, expiresAt, fingerprint }

// ─── Seed master account on startup ──────────────────────────────────────────
let masterSeeded = false;
async function seedMaster() {
  if (masterSeeded) return;
  masterSeeded = true;

  const masterId = 'master_krishnaprasad';
  if (!users.has(masterId)) {
    // Default master password — MUST be changed on first login
    // In production, read from env / vault
    const defaultPwd = process.env.MASTER_PASSWORD || 'RamaMaster#2026';
    const hash = await hashPassword(defaultPwd);
    users.set(masterId, {
      id:           masterId,
      name:         'Krishna Prasad',
      email:        'master@rama-agi.local',
      passwordHash: hash,
      tier:         TIERS.MASTER,
      suspended:    false,
      createdAt:    Date.now(),
      lastLogin:    null,
      isMaster:     true,         // immutable flag
    });
    console.warn('[auth] Master account seeded. Change password on first login.');
  }
}
seedMaster();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const HMAC_SECRET = process.env.HMAC_SECRET || 'rama-agi-hmac-secret-change-this';
const SESSION_TTL = 7 * 24 * 3600 * 1000;   // 7 days

function generateToken(userId, fingerprint) {
  const payload = `${userId}:${Date.now()}:${Math.random()}`;
  const sig     = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyToken(token) {
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    return sessions.get(token) || null;
  } catch {
    return null;
  }
}

async function hashPassword(password) {
  try {
    const argon2 = require('argon2');
    return await argon2.hash(password, {
      type:        argon2.argon2id,
      memoryCost:  131072,   // 128 MiB
      timeCost:    4,
      parallelism: 2,
    });
  } catch {
    // Fallback to scrypt if argon2 not built
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(32);
      crypto.scrypt(password, salt, 64, { N: 16384 }, (err, key) => {
        if (err) reject(err);
        else resolve(`scrypt:${salt.toString('hex')}:${key.toString('hex')}`);
      });
    });
  }
}

async function verifyPassword(password, hash) {
  try {
    if (hash.startsWith('scrypt:')) {
      const [, saltHex, keyHex] = hash.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      return new Promise((resolve) => {
        crypto.scrypt(password, salt, 64, { N: 16384 }, (err, key) => {
          if (err) resolve(false);
          else resolve(crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex')));
        });
      });
    }
    const argon2 = require('argon2');
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(minTier = TIERS.GUEST) {
  return (req, res, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || req.cookies?.rama_token;
    if (!token) return res.status(401).json({ ok: false, error: 'No token' });

    const session = verifyToken(token);
    if (!session) return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      return res.status(401).json({ ok: false, error: 'Session expired' });
    }

    const user = users.get(session.userId);
    if (!user) return res.status(401).json({ ok: false, error: 'User not found' });
    if (user.suspended) return res.status(403).json({ ok: false, error: 'Account suspended' });
    if (user.tier > minTier) return res.status(403).json({ ok: false, error: 'Insufficient access level' });

    req.user  = user;
    req.token = token;
    next();
  };
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password, fingerprint } = req.body;
  if (!username || !password) return res.status(400).json({ ok: false, error: 'username and password required' });

  // Find user by name or email
  const user = Array.from(users.values()).find(u =>
    u.name.toLowerCase() === username.toLowerCase() ||
    u.email.toLowerCase() === username.toLowerCase()
  );

  if (!user) {
    // Constant-time failure to prevent user enumeration
    await hashPassword('dummy-timing-equalization');
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  if (user.suspended) return res.status(403).json({ ok: false, error: 'Account suspended' });

  const token     = generateToken(user.id, fingerprint || '');
  const expiresAt = Date.now() + SESSION_TTL;
  sessions.set(token, { userId: user.id, expiresAt, fingerprint: fingerprint || '' });

  // Update last login
  user.lastLogin = Date.now();

  return res.json({
    ok: true,
    token,
    expiresAt,
    user: sanitizeUser(user),
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', requireAuth(), (req, res) => {
  sessions.delete(req.token);
  return res.json({ ok: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth(), (req, res) => {
  return res.json({ ok: true, user: sanitizeUser(req.user) });
});

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', requireAuth(TIERS.ADMIN), (req, res) => {
  const list = Array.from(users.values()).map(sanitizeUser);
  return res.json({ ok: true, data: list });
});

// ─── POST /api/users — create user (Master only) ─────────────────────────────
router.post('/', requireAuth(TIERS.MASTER), async (req, res) => {
  const { name, email, password, tier } = req.body;
  if (!name || !email || !password) return res.status(400).json({ ok: false, error: 'name, email, password required' });
  if (tier === undefined || tier < TIERS.SUPERADMIN) {  // Can't create another master
    // Allow tier 1-5
  }
  // Validate tier — cannot create another Master
  const requestedTier = parseInt(tier);
  if (isNaN(requestedTier) || requestedTier < TIERS.SUPERADMIN || requestedTier > TIERS.GUEST) {
    return res.status(400).json({ ok: false, error: `Invalid tier. Must be ${TIERS.SUPERADMIN}–${TIERS.GUEST}` });
  }

  const existing = Array.from(users.values()).find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(409).json({ ok: false, error: 'Email already in use' });

  const id   = `user_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const hash = await hashPassword(password);
  const user = { id, name, email, passwordHash: hash, tier: requestedTier, suspended: false, createdAt: Date.now(), lastLogin: null, isMaster: false };
  users.set(id, user);

  return res.status(201).json({ ok: true, user: sanitizeUser(user) });
});

// ─── PUT /api/users/:id — edit user (Master only) ────────────────────────────
router.put('/:id', requireAuth(TIERS.MASTER), async (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (user.isMaster) return res.status(403).json({ ok: false, error: 'Master account cannot be edited via API' });

  const { name, email, tier, password } = req.body;
  if (name)  user.name  = name;
  if (email) user.email = email;
  if (tier !== undefined) {
    const t = parseInt(tier);
    if (!isNaN(t) && t >= TIERS.SUPERADMIN && t <= TIERS.GUEST) user.tier = t;
  }
  if (password) user.passwordHash = await hashPassword(password);

  return res.json({ ok: true, user: sanitizeUser(user) });
});

// ─── PUT /api/users/:id/suspend ───────────────────────────────────────────────
router.put('/:id/suspend', requireAuth(TIERS.ADMIN), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (user.isMaster) return res.status(403).json({ ok: false, error: 'Cannot suspend master' });

  // Admins can only suspend tiers lower than their own
  if (req.user.tier >= user.tier) return res.status(403).json({ ok: false, error: 'Cannot suspend user with equal or higher access' });

  user.suspended = !user.suspended;

  // Invalidate all their sessions
  for (const [token, sess] of sessions.entries()) {
    if (sess.userId === user.id) sessions.delete(token);
  }

  return res.json({ ok: true, suspended: user.suspended, user: sanitizeUser(user) });
});

// ─── DELETE /api/users/:id — delete user (Master only) ───────────────────────
router.delete('/:id', requireAuth(TIERS.MASTER), (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (user.isMaster) return res.status(403).json({ ok: false, error: 'Master cannot be deleted' });

  // Invalidate all sessions
  for (const [token, sess] of sessions.entries()) {
    if (sess.userId === user.id) sessions.delete(token);
  }
  users.delete(req.params.id);

  return res.json({ ok: true });
});

// ─── Sanitize user (never expose password hash) ───────────────────────────────
function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.TIERS = TIERS;
