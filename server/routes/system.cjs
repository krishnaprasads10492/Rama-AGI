'use strict';

const express = require('express');
const router  = express.Router();
const si      = require('systeminformation');

// ─── GET /api/system/metrics ──────────────────────────────────────────────────
router.get('/metrics', async (_req, res) => {
  try {
    const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
    return res.json({
      ok: true,
      data: {
        cpu:    Math.round(cpu.currentLoad),
        ram:    Math.round((mem.used / mem.total) * 100),
        ramUsed: mem.used,
        ramTotal: mem.total,
        ts:     Date.now(),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
