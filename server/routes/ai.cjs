'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

// ── In-memory conversation store (Phase 2 will migrate to MongoDB) ────────────
const conversations = {};

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Proxy chat requests to the configured AI provider
router.post('/chat', async (req, res) => {
  try {
    const { messages, provider = 'openai', model, sessionId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ ok: false, error: 'messages array required' });
    }

    // Store conversation
    const sid = sessionId || crypto.randomBytes(16).toString('hex');
    conversations[sid] = messages;

    // TODO Phase 2: route to actual AI provider (OpenAI, Anthropic, Ollama)
    // For now return a structured placeholder so the UI works end-to-end
    const reply = {
      role:    'assistant',
      content: `[Rāma] AI backend not yet connected. Provider: ${provider}, Model: ${model || 'default'}. Phase 2 will wire this to your configured AI provider.`,
    };

    return res.json({ ok: true, sessionId: sid, message: reply });
  } catch (err) {
    console.error('[ai/chat]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/ai/history/:sessionId ──────────────────────────────────────────
router.get('/history/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const history = conversations[sessionId] || [];
  return res.json({ ok: true, data: history });
});

// ─── DELETE /api/ai/history/:sessionId ───────────────────────────────────────
router.delete('/history/:sessionId', (req, res) => {
  delete conversations[req.params.sessionId];
  return res.json({ ok: true });
});

module.exports = router;
