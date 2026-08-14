'use strict';

/**
 * http.cjs — Unified HTTP client for the Electron main process.
 *
 * CONSOLIDATES (previously duplicated in 5 files):
 *   - modelRouter.cjs      httpsPost/httpPost/httpGet
 *   - evolutionEngine.cjs  httpsGet
 *   - codeRegenEngine.cjs  httpsGet
 *   - intelligenceEngine.cjs fetchDDGAPI + raw https.request
 *   - vectorMemory.cjs     embed() raw https.request
 *
 * Features:
 *   - Timeout with proper socket destroy
 *   - Retry with exponential backoff
 *   - Circuit breaker per origin (4 failures → 20s open)
 *   - Rate-limit (429) aware backoff
 *   - Human-emulation profiles for scraping-resistant endpoints
 *   - JSON convenience helpers
 *   - Response size cap (prevents memory exhaustion)
 */

const https = require('https');
const http  = require('http');

// ─── Config ───────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT   = 15000;
const MAX_RETRIES       = 2;
const RETRY_BASE_MS     = 250;
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;   // 10MB cap
const CIRCUIT_THRESHOLD = 4;
const CIRCUIT_OPEN_MS   = 20000;

// ─── Circuit breaker state ────────────────────────────────────────────────────
const circuits = new Map();   // origin → { failures, openUntil }

function circuitOpen(origin) {
  const c = circuits.get(origin);
  if (!c) return false;
  if (c.openUntil > Date.now()) return true;
  circuits.delete(origin);
  return false;
}

function recordFail(origin) {
  const c = circuits.get(origin) ?? { failures: 0, openUntil: 0 };
  c.failures++;
  if (c.failures >= CIRCUIT_THRESHOLD) c.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  circuits.set(origin, c);
}

function recordOk(origin) { circuits.delete(origin); }

// ─── Human emulation profiles (for endpoints that block bots) ────────────────
const HUMAN_PROFILES = [
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', lang: 'en-US,en;q=0.9' },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', lang: 'en-US,en;q=0.9' },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0', lang: 'en-US,en;q=0.5' },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', lang: 'en-US,en;q=0.9' },
  { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', lang: 'en-US,en;q=0.9' },
];

function humanHeaders() {
  const p = HUMAN_PROFILES[Math.floor(Math.random() * HUMAN_PROFILES.length)];
  return {
    'User-Agent':      p.ua,
    'Accept':          'application/json,text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': p.lang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection':      'keep-alive',
    'Sec-Fetch-Dest':  'document',
    'Sec-Fetch-Mode':  'navigate',
    'Sec-Fetch-Site':  'none',
    'Cache-Control':   'max-age=0',
  };
}

function ramaHeaders() {
  return { 'User-Agent': 'Rama-AGI/1.0', 'Accept': 'application/json' };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Core request ─────────────────────────────────────────────────────────────
/**
 * @param {string} url
 * @param {object} opts { method, headers, body, timeout, human, retries, maxSize }
 * @returns {Promise<{ ok, status, body, headers }>}
 */
async function request(url, opts = {}) {
  const {
    method   = 'GET',
    headers  = {},
    body     = null,
    timeout  = DEFAULT_TIMEOUT,
    human    = false,
    retries  = MAX_RETRIES,
    maxSize  = MAX_RESPONSE_SIZE,
  } = opts;

  let parsed;
  try { parsed = new URL(url); }
  catch { return { ok: false, status: 0, error: `Invalid URL: ${url}` }; }

  const origin = parsed.origin;
  if (circuitOpen(origin)) {
    return { ok: false, status: 503, error: `Circuit open for ${origin}` };
  }

  const baseHeaders = human ? humanHeaders() : ramaHeaders();
  const finalHeaders = { ...baseHeaders, ...headers };
  if (body) finalHeaders['Content-Length'] = Buffer.byteLength(body);

  const mod = parsed.protocol === 'https:' ? https : http;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = mod.request({
          hostname: parsed.hostname,
          port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path:     parsed.pathname + parsed.search,
          method,
          headers:  finalHeaders,
        }, (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', c => {
            size += c.length;
            if (size > maxSize) { req.destroy(); reject(new Error('Response too large')); return; }
            chunks.push(c);
          });
          res.on('end', () => resolve({
            status:  res.statusCode,
            body:    Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }));
        });

        req.on('error', reject);
        req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`Timeout after ${timeout}ms`)); });
        if (body) req.write(body);
        req.end();
      });

      // 429 → backoff and retry
      if (result.status === 429 && attempt < retries) {
        await delay(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500);
        continue;
      }

      // 5xx → retry
      if (result.status >= 500 && attempt < retries) {
        recordFail(origin);
        await delay(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      if (result.status >= 200 && result.status < 400) recordOk(origin);
      else recordFail(origin);

      return { ok: result.status >= 200 && result.status < 400, ...result };

    } catch (err) {
      recordFail(origin);
      if (attempt < retries) {
        await delay(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, status: 0, error: err.message };
    }
  }

  return { ok: false, status: 0, error: 'All retries exhausted' };
}

// ─── Convenience helpers ──────────────────────────────────────────────────────
async function get(url, opts = {})  { return request(url, { ...opts, method: 'GET' }); }
async function post(url, body, opts = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return request(url, {
    ...opts,
    method:  'POST',
    body:    payload,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

/** GET + JSON parse. Returns parsed object or { error }. */
async function getJson(url, opts = {}) {
  const res = await get(url, opts);
  if (!res.ok) return { error: res.error || `HTTP ${res.status}` };
  try   { return JSON.parse(res.body); }
  catch { return { error: 'Invalid JSON response', raw: res.body?.slice(0, 200) }; }
}

/** POST + JSON parse. */
async function postJson(url, body, opts = {}) {
  const res = await post(url, body, opts);
  if (!res.ok) return { error: res.error || `HTTP ${res.status}`, status: res.status, raw: res.body?.slice(0, 300) };
  try   { return JSON.parse(res.body); }
  catch { return { error: 'Invalid JSON response', raw: res.body?.slice(0, 200) }; }
}

/** GET with human emulation (for search engines and scrape-resistant endpoints). */
async function getHuman(url, opts = {}) { return get(url, { ...opts, human: true }); }
async function getJsonHuman(url, opts = {}) {
  const res = await getHuman(url, opts);
  if (!res.ok) return { error: res.error || `HTTP ${res.status}` };
  try   { return JSON.parse(res.body); }
  catch { return { error: 'Invalid JSON', raw: res.body?.slice(0, 200) }; }
}

function getCircuitStatus() {
  return Object.fromEntries([...circuits.entries()].map(([o, c]) => [o, {
    failures: c.failures,
    isOpen:   c.openUntil > Date.now(),
    opensFor: Math.max(0, c.openUntil - Date.now()),
  }]));
}

/**
 * Streaming POST for endpoints that emit newline-delimited JSON progress
 * before completing (Ollama's /api/pull, /api/chat with stream:true). The
 * plain `request()` above buffers the whole response, which is the wrong
 * shape for a progress callback and would also hold a pull's entire output
 * in memory. No retry/circuit-breaker here — a partially-streamed response
 * cannot be safely retried from the start without the caller possibly
 * double-processing progress events.
 *
 * @param {string} url
 * @param {object} body   JSON-serializable request body
 * @param {(line: object) => void} onLine  called once per parsed JSON line
 * @param {object} opts   { timeout }
 * @returns {Promise<{ ok, status, error? }>}
 */
async function postStreamingJsonLines(url, body, onLine, opts = {}) {
  const { timeout = 120000, headers = {} } = opts;

  let parsed;
  try { parsed = new URL(url); }
  catch { return { ok: false, status: 0, error: `Invalid URL: ${url}` }; }

  const mod = parsed.protocol === 'https:' ? https : http;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);

  return new Promise((resolve) => {
    const req = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', ...ramaHeaders(), ...headers },
    }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try { onLine(JSON.parse(line)); } catch { /* partial/non-JSON line, skip */ }
        }
      });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode }));
    });

    req.on('error',   (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ ok: false, status: 0, error: `Timeout after ${timeout}ms` }); });
    req.write(payload);
    req.end();
  });
}

module.exports = {
  request, get, post, getJson, postJson,
  getHuman, getJsonHuman,
  humanHeaders, ramaHeaders,
  getCircuitStatus, delay,
  postStreamingJsonLines,
  MAX_RESPONSE_SIZE,
};
