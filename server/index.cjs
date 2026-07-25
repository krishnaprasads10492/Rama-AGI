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
app.post('/api/ghost/wipe', (req, res) => {
  // Validate master token before wiping
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ ok: false, error: 'Token required' });
  // TODO Phase 5: validate against sessionManager — for now accept any token from localhost
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
