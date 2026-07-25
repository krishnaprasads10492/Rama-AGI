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
app.use(helmet({
  contentSecurityPolicy: false,  // disabled for Electron renderer compatibility
}));

app.use(cors({
  origin:      ['http://localhost:5173', 'http://localhost:4097'],
  credentials: true,
}));

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

app.use('/api/ai',     aiRoutes);
app.use('/api/system', systemRoutes);
app.use('/api',        healthRoutes);

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
