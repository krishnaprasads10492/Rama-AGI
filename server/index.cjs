'use strict';

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const crypto      = require('crypto');

const app  = express();
const PORT = process.env.SERVER_PORT || 4097;

// ─── Security middleware ──────────────────────────────────────────────────────
const { threatShield } = require('./middleware/threatShield.cjs');

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin:      ['http://localhost:5173', 'http://localhost:4097'],
  credentials: true,
}));

// ThreatShield runs BEFORE rate limiter — traps attackers before they count against limits
app.use(threatShield);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use(limiter);

// ─── Request ID middleware ────────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.id = crypto.randomBytes(8).toString('hex');
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
const aiRoutes     = require('./routes/ai.cjs');
const systemRoutes = require('./routes/system.cjs');
const healthRoutes = require('./routes/health.cjs');
const authRoutes   = require('./routes/auth.cjs');

app.use('/api/auth',   authRoutes);
app.use('/api/users',  authRoutes);   // user management under same router
app.use('/api/ai',     aiRoutes);
app.use('/api/system', systemRoutes);
app.use('/api',        healthRoutes);

// ─── Ghost Mode — master-only zero-trace wipe ────────────────────────────────
// The previous check ("accept any token from localhost") validated nothing —
// any local process presenting an X-Session-Token header of any value at all
// passed. The real fix is NOT to fabricate a session check here: this server
// cannot open the AES-256-GCM store authCore.cjs's sessions live in (see
// auth.cjs's own docstring on why /api/auth/* is closed) — pretending
// otherwise would be a worse hole than this one. `requireLocalToken` is the
// mechanism this project already built for exactly this situation: a
// per-boot shared secret (RAMA_SERVER_TOKEN) that only the launcher hands to
// the Electron main process and its own renderer, so an arbitrary local
// process can no longer wipe data with a guessed or empty token.
const { requireLocalToken } = require('./routes/auth.cjs');

app.post('/api/ghost/wipe', requireLocalToken, (req, res) => {
  const ip = req.ip || '';
  if (!ip.includes('127.0.0.1') && !ip.includes('::1') && !ip.includes('localhost')) {
    return res.status(403).json({ ok: false, error: 'Ghost mode only available locally' });
  }
  // Signal main process to wipe encrypted data
  console.warn('[GhostMode] ⚠ Server wipe requested — this will delete all encrypted data files');
  return res.json({ ok: true, message: 'Server wipe acknowledged — restart app to reinitialise' });
});

// ─── Threat shield status ─────────────────────────────────────────────────────
app.get('/api/security/threats', (req, res) => {
  const { getThreatStats } = require('./middleware/threatShield.cjs');
  const ip = req.ip || '';
  if (!ip.includes('127.0.0.1') && !ip.includes('::1')) {
    return res.status(403).json({ ok: false });
  }
  return res.json({ ok: true, data: getThreatStats() });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.warn(`[Rama Server] Listening on http://127.0.0.1:${PORT}`);
});

module.exports = app;
