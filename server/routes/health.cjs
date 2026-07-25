'use strict';

const express = require('express');
const router  = express.Router();
const os      = require('os');

router.get('/health', (_req, res) => {
  res.json({
    ok:       true,
    service:  'Rama AGI Server',
    version:  '1.0.0',
    uptime:   process.uptime(),
    memory:   process.memoryUsage(),
    platform: process.platform,
    ts:       Date.now(),
  });
});

module.exports = router;
