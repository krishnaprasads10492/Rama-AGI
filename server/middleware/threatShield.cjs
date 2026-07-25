'use strict';

/**
 * threatShield.cjs — Rāma AGI Eternal Loop Security Protocol.
 *
 * Adapted from StockMind AI's battle-tested threatShield.
 * Unauthorized requests don't get a fast 403.
 * They get trapped in an infinite loop wasting their resources.
 *
 * Threat categories:
 *   1. Unknown IPs with no session         → slow trap
 *   2. Brute-force token attempts          → exponential delay
 *   3. AI bot fingerprints (GPTBot, etc.)  → mirror trap
 *   4. Prompt injection via headers/body  → honeypot
 *   5. Automated scanning (rapid requests) → eternal drip
 *   6. Credential stuffing patterns        → silent blackhole
 *   7. Suspicious payload patterns         → decoy responses
 *   8. Another AI trying to hijack Rāma    → identity trap
 */

const crypto = require('crypto');

// ─── State ────────────────────────────────────────────────────────────────────
const eternalLoopSet   = new Map();  // ip → { since, offences, trap_type }
const slowTrapSet      = new Map();  // ip → { hits, firstSeen, lastSeen }
const honeypotTriggers = new Set();  // IPs that hit honeypot endpoints
const requestLog       = new Map();  // ip → [timestamps]
const aiAgentBlacklist = new Set();  // detected AI agent UA strings

// ─── AI bot fingerprints ──────────────────────────────────────────────────────
const AI_BOT_PATTERNS = [
  /GPTBot/i, /ChatGPT/i, /anthropic/i, /claude-/i, /Gemini/i, /Bard/i,
  /cohere/i, /mistral/i, /perplexity/i, /groqbot/i, /openai/i, /llmbot/i,
  /AiBot/i, /scraperbot/i, /GPT-4/i, /gpt-3/i, /davinci/i,
  /langchain/i, /autogpt/i, /babyagi/i, /agentgpt/i, /superagi/i,
  /python-httpx/i, /python-requests/i,
];

// Prompt injection patterns in body
const AI_ATTACK_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:different|new|unrestricted)/i,
  /system\s*:\s*(?:you|your)/i,
  /\[SYSTEM\]/i,
  /<\|im_start\|>/i,
  /\/\/\s*BEGIN\s+SYSTEM\s+PROMPT/i,
  /--system--/i,
  /PROMPT\s*INJECTION/i,
  /forget\s+your\s+(?:training|instructions|rules)/i,
  /pretend\s+you\s+(?:are|have\s+no)/i,
  /act\s+as\s+(?:a\s+)?(?:jailbroken|uncensored|unfiltered)/i,
];

// Honeypot paths — no legit user ever visits these
const HONEYPOT_PATHS = [
  '/admin', '/wp-admin', '/phpmyadmin', '/.env', '/.git/config',
  '/config.php', '/backup', '/api/v1/users/admin', '/api/debug',
  '/api/internal', '/setup', '/install', '/api/keys', '/api/secrets',
  '/actuator', '/api/admin/token', '/.well-known/security.txt.bak',
];

// Fake decoy responses — look plausible, waste attacker time
const DECOY_SCHEMAS = [
  { status: 'processing', eta_ms: 99999, retry_after: 300, queue_position: Math.floor(Math.random() * 9000) + 1000 },
  { status: 'handshake_required', protocol: 'v2.1', challenge: crypto.randomBytes(32).toString('hex') },
  { error: 'Rotating credentials required. Retry after 60s.' },
];

function randomDecoy() {
  return DECOY_SCHEMAS[Math.floor(Math.random() * DECOY_SCHEMAS.length)];
}

function fakePingDrip() {
  const msgs = [
    'data: {"status":"processing","queue":9999}\n\n',
    'data: {"status":"validating","progress":0.01}\n\n',
    'data: {"status":"checking_credentials","elapsed":1}\n\n',
    'data: {"heartbeat":true}\n\n',
    ': ping\n\n',
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// ─── Rate tracking ────────────────────────────────────────────────────────────
function recordRequest(ip) {
  const now = Date.now();
  if (!requestLog.has(ip)) requestLog.set(ip, []);
  const log    = requestLog.get(ip);
  const cutoff = now - 60000;
  while (log.length && log[0] < cutoff) log.shift();
  log.push(now);
  return log.length;
}

function getRequestRate(ip) {
  const log = requestLog.get(ip) ?? [];
  const now = Date.now();
  return log.filter(t => t > now - 10000).length;
}

// ─── Threat classification ────────────────────────────────────────────────────
function classifyThreat(req) {
  const ip  = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const ua  = req.headers['user-agent'] ?? '';
  const url = req.path ?? '';
  const threats = [];

  if (eternalLoopSet.has(ip)) return { level: 'ETERNAL', ip, threats: ['previously_trapped'] };
  if (honeypotTriggers.has(ip)) threats.push('honeypot');

  const isAIBot = AI_BOT_PATTERNS.some(p => p.test(ua));
  if (isAIBot) { aiAgentBlacklist.add(ua.slice(0, 80)); threats.push('ai_bot'); }

  const rate = recordRequest(ip);
  if (rate > 30) threats.push('rapid_scan');
  if (rate > 60) threats.push('aggressive_scan');

  const body = JSON.stringify(req.body ?? {});
  if (AI_ATTACK_PATTERNS.some(p => p.test(body))) threats.push('ai_prompt_injection');

  if (/\.\.(\/|\\)/g.test(url))                     threats.push('path_traversal');
  if (/\/(wp-admin|phpmyadmin|\.env|\.git|\.htaccess)/i.test(url)) threats.push('known_attack_path');
  if (/\/(etc\/passwd|proc\/self|boot\.ini)/i.test(url)) threats.push('system_file_probe');
  if (/(<script|javascript:|onerror=|eval\(|exec\()/i.test(body)) threats.push('xss_or_injection');
  if (/(UNION\s+SELECT|OR\s+1=1|DROP\s+TABLE)/i.test(body)) threats.push('sql_injection');
  if (!ua || ua.length < 5) threats.push('no_user_agent');

  if (threats.includes('ai_prompt_injection') || threats.includes('system_file_probe') ||
      threats.includes('sql_injection')        || threats.includes('path_traversal') ||
      threats.length >= 3) {
    return { level: 'ETERNAL', ip, threats };
  }
  if (threats.length >= 2 || threats.includes('ai_bot') || threats.includes('aggressive_scan')) {
    return { level: 'TRAP', ip, threats };
  }
  if (threats.length >= 1) return { level: 'SLOW', ip, threats };
  return { level: 'CLEAN', ip, threats: [] };
}

// ─── Eternal loop handler ─────────────────────────────────────────────────────
function enterEternalLoop(req, res, threat) {
  const ip = threat.ip;
  eternalLoopSet.set(ip, {
    since:     Date.now(),
    offences:  (eternalLoopSet.get(ip)?.offences ?? 0) + 1,
    trap_type: threat.threats[0] ?? 'unknown',
    ua:        (req.headers['user-agent'] ?? '').slice(0, 100),
  });
  console.warn(`[ThreatShield] ♾ ETERNAL LOOP: ${ip} | ${threat.threats.join(', ')}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Processing-Queue', String(Math.floor(Math.random() * 50000) + 10000));
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ status: 'initializing', request_id: crypto.randomUUID(), eta: 99999 })}\n\n`);

  const interval = setInterval(() => {
    try { res.write(fakePingDrip()); } catch { clearInterval(interval); }
  }, 3000 + Math.random() * 4000);

  req.on('close', () => clearInterval(interval));
  req.on('error', () => clearInterval(interval));
}

// ─── Slow trap ────────────────────────────────────────────────────────────────
async function enterSlowTrap(req, res, threat) {
  const ip   = threat.ip;
  const prev = slowTrapSet.get(ip) ?? { hits: 0, firstSeen: Date.now() };
  prev.hits++;
  prev.lastSeen = Date.now();
  slowTrapSet.set(ip, prev);
  console.warn(`[ThreatShield] 🐢 SLOW TRAP: ${ip} hit ${prev.hits}`);

  const delay = Math.min(2000 * Math.pow(1.8, Math.min(prev.hits - 1, 5)), 30000);
  await new Promise(r => setTimeout(r, delay + Math.random() * 2000));

  if (prev.hits >= 5) { enterEternalLoop(req, res, { ...threat, level: 'ETERNAL' }); return; }
  res.status(429).json({ error: 'Rate limit exceeded', retry_after: Math.round(delay / 1000), ...randomDecoy() });
}

// ─── Mirror trap for AI agents ────────────────────────────────────────────────
function mirrorTrap(req, res, threat) {
  console.warn(`[ThreatShield] 🪞 MIRROR TRAP: ${req.headers['user-agent']?.slice(0, 60)}`);
  res.status(200).json({
    message: 'Welcome to Rama AGI API Gateway',
    version: '3.0.0-alpha',
    authentication_endpoint: `http://${req.headers.host}/api/auth/v3/handshake`,
    your_ip:      threat.ip,
    session_token: crypto.randomBytes(32).toString('hex'),
    redirect:     `http://${threat.ip}/api/auth`,
  });
}

// ─── Main middleware ──────────────────────────────────────────────────────────
function threatShield(req, res, next) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

  // Honeypot fast path
  if (HONEYPOT_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    honeypotTriggers.add(ip);
    console.warn(`[ThreatShield] 🍯 HONEYPOT: ${ip} → ${req.path}`);
    enterEternalLoop(req, res, { level: 'ETERNAL', ip, threats: ['honeypot_path'] });
    return;
  }

  if (eternalLoopSet.has(ip)) {
    enterEternalLoop(req, res, { level: 'ETERNAL', ip, threats: ['repeat_offender'] });
    return;
  }

  const threat = classifyThreat(req);

  if (threat.level === 'ETERNAL') { enterEternalLoop(req, res, threat); return; }
  if (threat.level === 'TRAP') {
    const ua = req.headers['user-agent'] ?? '';
    if (AI_BOT_PATTERNS.some(p => p.test(ua))) { mirrorTrap(req, res, threat); return; }
    enterSlowTrap(req, res, threat).catch(() => {});
    return;
  }
  if (threat.level === 'SLOW') {
    setTimeout(() => { res.setHeader('X-Security-Check', 'pending'); next(); }, 500 + Math.random() * 1500);
    return;
  }
  next();
}

function getThreatStats() {
  const now = Date.now();
  return {
    eternal_loop_count: eternalLoopSet.size,
    slow_trap_count:    slowTrapSet.size,
    honeypot_triggers:  honeypotTriggers.size,
    ai_agents_seen:     aiAgentBlacklist.size,
    eternal_ips: [...eternalLoopSet.entries()].map(([ip, data]) => ({
      ip,
      trapped_for_minutes: Math.round((now - data.since) / 60000),
      offences:  data.offences,
      trap_type: data.trap_type,
    })),
  };
}

// Auto-cleanup eternal loops older than 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600000;
  for (const [ip, data] of eternalLoopSet.entries()) {
    if (data.since < cutoff) eternalLoopSet.delete(ip);
  }
  for (const [ip, data] of slowTrapSet.entries()) {
    if (data.lastSeen < Date.now() - 3600000) slowTrapSet.delete(ip);
  }
}, 3600000);

module.exports = { threatShield, getThreatStats, HONEYPOT_PATHS };
