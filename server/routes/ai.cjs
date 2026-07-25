'use strict';

/**
 * ai.cjs — AI chat route.
 *
 * NOTE: In Electron, the renderer should call window.rama.models.chat() directly
 * (goes to modelRouter.cjs in the main process — real provider calls).
 * This HTTP route exists as a fallback for browser dev mode and returns a
 * clear message rather than pretending to work.
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const conversations = {};

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { messages, provider = 'openai', model, sessionId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ ok: false, error: 'messages array required' });
    }

    const sid = sessionId || crypto.randomBytes(16).toString('hex');
    conversations[sid] = messages;

    // This server has no access to the encrypted credential vault
    // (which lives in the Electron main process). Direct the caller to
    // the correct path instead of returning a fake response.
    return res.json({
      ok: true,
      sessionId: sid,
      message: {
        role: 'assistant',
        content:
          'This request came through the HTTP fallback route, which cannot access ' +
          'your encrypted credential vault.\n\n' +
          'In the desktop app, chat routes through window.rama.models.chat() → ' +
          'modelRouter (main process) which has vault access and calls your real ' +
          'AI provider.\n\n' +
          'If you are seeing this message inside the desktop app, the renderer is ' +
          'using ramaClient (HTTP) instead of the IPC bridge.',
      },
      viaFallback: true,
    });
  } catch (err) {
    console.error('[ai/chat]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/history/:sessionId', (req, res) => {
  return res.json({ ok: true, data: conversations[req.params.sessionId] || [] });
});

router.delete('/history/:sessionId', (req, res) => {
  delete conversations[req.params.sessionId];
  return res.json({ ok: true });
});

module.exports = router;
