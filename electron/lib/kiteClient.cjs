'use strict';

/**
 * kiteClient.cjs - Zerodha Kite Connect, DATA ONLY (spec Section 156)
 *
 * Every call Rāma ever makes to Kite goes through `call()` here, and `call()` refuses anything that is not on a
 * short allowlist: the token exchange, logout, a last-price lookup (used only to learn an instrument token), and
 * historical candles. Zerodha issues no read-only key, so a key that could place an order is in the vault; THE
 * ALLOWLIST IS WHAT KEEPS IT FROM EVER DOING SO (Section 95). It is checked before a request is built, it is
 * independent of what any caller asks for, and `verifyKite.cjs` fails if an order, GTT or basket path is ever
 * accepted.
 *
 * PURE WHERE IT CAN BE. The HTTP client is injected (`lib/http.cjs` in production), so the login URL, the
 * checksum, the redirect parsing, the token expiry, the chunk plan and the candle conversion are all driven in
 * tests with no network and no account.
 *
 * WHAT IS NOT VERIFIED AGAINST THE VENDOR: the maximum days per historical request and the request rate limit
 * are not on the pages read (2026-10-18). They are handled defensively: conservative spans, halved on a
 * "max limit" reply, and at most two requests a second.
 */

const crypto = require('crypto');

const API_BASE = 'https://api.kite.trade';
const LOGIN_BASE = 'https://kite.zerodha.com/connect/login';
const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const MAX_REQUESTS = 300;
const MIN_GAP_MS = 500;

// ─── The allowlist ───────────────────────────────────────────────────────────────────────────────
const KITE_INTERVALS = ['minute', '3minute', '5minute', '10minute', '15minute', '30minute', '60minute', 'day'];
const ALLOWED = [
  { method: 'POST', re: /^\/session\/token$/ },
  { method: 'DELETE', re: /^\/session\/token$/ },
  { method: 'GET', re: /^\/quote\/ltp$/ },
  { method: 'GET', re: new RegExp(`^/instruments/historical/\\d{1,12}/(${KITE_INTERVALS.join('|')})$`) },
];
const ORDER_LIKE = /(^|\/)(orders?|place|trade|trades|gtt|basket|cancel|modify|exit|squareoff|square-off|portfolio|positions|holdings|margins|mf)(\/|$)/i;

/** @returns {{ok:boolean, error?:string}} */
function assertAllowed(method, pathname) {
  const m = String(method || '').toUpperCase();
  const p = String(pathname || '');
  if (ORDER_LIKE.test(p)) return { ok: false, error: `Rāma is data-only: ${p} is not a data path and is never called.` };
  if (!ALLOWED.some((a) => a.method === m && a.re.test(p))) return { ok: false, error: `${m} ${p} is not on the Kite allowlist.` };
  return { ok: true };
}

// ─── Login ───────────────────────────────────────────────────────────────────────────────────────
/** The page master logs in on. `state` rides through `redirect_params` and comes back unchanged. */
function loginUrl(apiKey, state) {
  const u = new URL(LOGIN_BASE);
  u.searchParams.set('v', '3');
  u.searchParams.set('api_key', String(apiKey || ''));
  if (state) u.searchParams.set('redirect_params', `state=${state}`);
  return u.toString();
}

/** SHA-256 of api_key + request_token + api_secret, as the token API requires. */
function checksum(apiKey, requestToken, secret) {
  return crypto.createHash('sha256').update(`${apiKey}${requestToken}${secret}`).digest('hex');
}

/**
 * What master pastes after logging in: the address Kite redirected the browser to (or just its query string).
 * @returns {{ok:boolean, requestToken?:string, state?:string|null, error?:string}}
 */
function parseRedirect(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Paste the address the browser went to after you logged in.' };
  if (raw.length > 2000) return { ok: false, error: 'That is too long to be a redirect address.' };
  let q;
  try {
    q = raw.includes('://') ? new URL(raw).searchParams : new URLSearchParams(raw.replace(/^[^?]*\?/, ''));
  } catch { return { ok: false, error: 'That is not a web address.' }; }
  const status = q.get('status');
  const token = q.get('request_token');
  if (status && status !== 'success') return { ok: false, error: `Kite reported "${status}" instead of success. Log in again.` };
  if (!token) return { ok: false, error: 'The address has no request_token. Copy it from the address bar right after logging in.' };
  if (!/^[A-Za-z0-9]{8,64}$/.test(token)) return { ok: false, error: 'The request_token in that address looks malformed.' };
  return { ok: true, requestToken: token, state: q.get('state') };
}

/** A Kite access token dies at 06:00 IST the next morning. The next 06:00 IST strictly after `issuedMs`. */
function tokenExpiry(issuedMs) {
  const ist = new Date(issuedMs + IST_MS);
  const dayStartIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  let expiryIst = dayStartIst + 6 * 3600 * 1000;
  if (expiryIst <= ist.getTime()) expiryIst += DAY_MS;
  return expiryIst - IST_MS;
}

/** @returns {'none'|'live'|'expired'} */
function sessionState(session, now = Date.now()) {
  if (!session || !session.accessToken) return 'none';
  const issued = Number(session.issuedAt);
  if (!Number.isFinite(issued)) return 'expired';
  return now < tokenExpiry(issued) ? 'live' : 'expired';
}

const authHeader = (apiKey, accessToken) => `token ${apiKey}:${accessToken}`;

// ─── Instruments, intervals and candles ──────────────────────────────────────────────────────────
const INTERVAL_MAP = { '1m': 'minute', '3m': '3minute', '5m': '5minute', '10m': '10minute', '15m': '15minute', '30m': '30minute', '60m': '60minute', '1h': '60minute', '1d': 'day' };
const toKiteInterval = (ramaInterval) => INTERVAL_MAP[String(ramaInterval || '').toLowerCase()] || null;

// Conservative spans (days). Not the vendor's limits; see the header.
const CHUNK_DAYS = { minute: 30, '3minute': 60, '5minute': 60, '10minute': 60, '15minute': 90, '30minute': 90, '60minute': 180, day: 1000 };

/** Rāma's index names are not Kite's trading symbols. */
const INDEX_SYMBOLS = {
  NIFTY50: ['NSE', 'NIFTY 50'], NIFTY: ['NSE', 'NIFTY 50'], BANKNIFTY: ['NSE', 'NIFTY BANK'], NIFTYBANK: ['NSE', 'NIFTY BANK'],
  FINNIFTY: ['NSE', 'NIFTY FIN SERVICE'], NIFTYNEXT50: ['NSE', 'NIFTY NEXT 50'], NIFTYIT: ['NSE', 'NIFTY IT'],
  MIDCPNIFTY: ['NSE', 'NIFTY MID SELECT'], SENSEX: ['BSE', 'SENSEX'],
};

/** `EXCHANGE:TRADINGSYMBOL`, the key the quote API takes. */
function instrumentKey(symbol, exchange) {
  const s = String(symbol || '').toUpperCase().trim();
  if (!s || !/^[A-Z0-9&_.\- ]{1,40}$/.test(s)) return { ok: false, error: `"${String(symbol || '').slice(0, 20)}" is not a symbol Kite can look up.` };
  if (INDEX_SYMBOLS[s]) return { ok: true, key: `${INDEX_SYMBOLS[s][0]}:${INDEX_SYMBOLS[s][1]}` };
  const ex = String(exchange || 'NSE').toUpperCase();
  if (!['NSE', 'BSE'].includes(ex)) return { ok: false, error: `Kite fetch supports NSE and BSE cash instruments, not ${ex}.` };
  return { ok: true, key: `${ex}:${s}` };
}

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };

/**
 * Split [fromDate, toDate] (inclusive, yyyy-mm-dd) into spans of at most `chunkDays` days.
 * @returns {{ok:boolean, chunks?:Array<{from:string,to:string}>, error?:string}}
 */
function planChunks(fromDate, toDate, chunkDays) {
  const a = parseYmd(fromDate);
  const b = parseYmd(toDate);
  if (a === null || b === null) return { ok: false, error: 'Both dates must be yyyy-mm-dd.' };
  if (b < a) return { ok: false, error: 'The end date is before the start date.' };
  const span = Math.max(1, Math.floor(chunkDays || 1));
  const chunks = [];
  for (let start = a; start <= b; start += span * DAY_MS) {
    const end = Math.min(b, start + (span - 1) * DAY_MS);
    chunks.push({ from: `${ymdOf(start)} 00:00:00`, to: `${ymdOf(end)} 23:59:59` });
    if (chunks.length > 5000) return { ok: false, error: 'That range needs too many requests.' };
  }
  return { ok: true, chunks };
}

/** "2017-12-15T09:15:00+0530" -> epoch ms, or NaN. */
function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(s || ''));
  if (!m) return NaN;
  let off = 0;
  if (m[7] && m[7] !== 'Z') { const sign = m[7][0] === '-' ? -1 : 1; const digits = m[7].slice(1).replace(':', ''); off = sign * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4)) * 60000; }
  else if (!m[7]) off = 5.5 * 3600 * 1000;       // Kite's own stamps carry +0530; a bare one is read as IST
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off;
}

/**
 * One Kite candle as a Rāma bar. Intraday: UTC, no zone (Section 73). Daily: the IST calendar date.
 * @returns {object|null} null for a candle that is malformed or physically impossible
 */
function toBar(candle, intraday) {
  if (!Array.isArray(candle) || candle.length < 5) return null;
  const ms = parseStamp(candle[0]);
  const [o, h, l, c] = [candle[1], candle[2], candle[3], candle[4]].map(Number);
  const v = Number(candle[5] ?? 0);
  if (!Number.isFinite(ms) || ![o, h, l, c].every(Number.isFinite)) return null;
  if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l || h < Math.max(o, c) * (1 - 1e-6) || l > Math.min(o, c) * (1 + 1e-6)) return null;
  const date = intraday ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : ymdOf(ms + IST_MS);
  return { date, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) && v > 0 ? v : 0 };
}

// ─── Requests ────────────────────────────────────────────────────────────────────────────────────
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keeps at least `gapMs` between starts. */
function rateLimiter(gapMs = MIN_GAP_MS, sleep = defaultSleep, now = Date.now) {
  let last = 0;
  return async () => {
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}

/** Map a Kite error reply to a kind the caller can act on. */
function classify(status, body) {
  const type = body && body.error_type;
  const msg = (body && body.message) || '';
  if (status === 429) return 'rate';
  if (type === 'TokenException' || (status === 403 && /token|session|login/i.test(msg))) return 'token';
  if (type === 'PermissionException') return 'permission';
  if (type === 'InputException' && /interval|limit|days/i.test(msg)) return 'range';
  if (type === 'InputException') return 'input';
  if (status === 0) return 'network';
  return 'vendor';
}

/**
 * One allowlisted call.
 * @param {{request:Function}} http  lib/http.cjs
 * @returns {Promise<{ok:true, data:any} | {ok:false, kind:string, status:number, message:string}>}
 */
async function call(http, { method, path, query, headers, body }) {
  const allowed = assertAllowed(method, path);
  if (!allowed.ok) return { ok: false, kind: 'refused', status: 0, message: allowed.error };
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  let res;
  try {
    res = await http.request(`${API_BASE}${path}${qs}`, {
      method, body: body || null, retries: 1, timeout: 30000,
      headers: { 'X-Kite-Version': '3', Accept: 'application/json', ...(headers || {}) },
    });
  } catch (err) { return { ok: false, kind: 'network', status: 0, message: err.message }; }
  let parsed = null;
  try { parsed = res && res.body ? JSON.parse(res.body) : null; } catch { parsed = null; }
  if (res && res.ok && parsed && parsed.status === 'success') return { ok: true, data: parsed.data };
  const status = (res && res.status) || 0;
  const message = (parsed && parsed.message) || (res && res.error) || `HTTP ${status}`;
  return { ok: false, kind: classify(status, parsed), status, message: String(message).slice(0, 300) };
}

/** Exchange a request_token for a session. The secret is used here and nowhere else. */
async function exchangeToken(http, { apiKey, secret, requestToken, now = Date.now }) {
  const form = new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum: checksum(apiKey, requestToken, secret) }).toString();
  const r = await call(http, { method: 'POST', path: '/session/token', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) return r;
  const d = r.data || {};
  if (!d.access_token) return { ok: false, kind: 'vendor', status: 200, message: 'Kite answered without an access token.' };
  return { ok: true, session: { accessToken: String(d.access_token), userId: String(d.user_id || ''), userName: String(d.user_shortname || d.user_name || ''), issuedAt: now() } };
}

async function logout(http, { apiKey, accessToken }) {
  return call(http, { method: 'DELETE', path: '/session/token', query: { api_key: apiKey, access_token: accessToken } });
}

/** Learn an instrument's token from its key, through the last-price API (no instruments dump needed). */
async function resolveToken(http, { apiKey, accessToken }, symbol, exchange) {
  const k = instrumentKey(symbol, exchange);
  if (!k.ok) return { ok: false, kind: 'input', status: 0, message: k.error };
  const r = await call(http, { method: 'GET', path: '/quote/ltp', query: { i: k.key }, headers: { Authorization: authHeader(apiKey, accessToken) } });
  if (!r.ok) return r;
  const hit = r.data && r.data[k.key];
  if (!hit || !hit.instrument_token) return { ok: false, kind: 'input', status: 200, message: `Kite has no instrument ${k.key}.` };
  return { ok: true, instrumentToken: Number(hit.instrument_token), key: k.key };
}

/**
 * Historical candles for a date range, chunked, throttled, and adaptive.
 * @returns {Promise<{ok:true, bars:object[], requests:number, skipped:number, chunkDays:number} | {ok:false, kind:string, message:string, bars?:object[]}>}
 */
async function fetchCandles(http, creds, { instrumentToken, interval, fromDate, toDate, sleep = defaultSleep, now = Date.now, onProgress }) {
  const kiteInterval = toKiteInterval(interval);
  if (!kiteInterval) return { ok: false, kind: 'input', message: `Kite has no ${interval} candles. Use 1m, 3m, 5m, 10m, 15m, 30m, 60m or 1d.` };
  let chunkDays = CHUNK_DAYS[kiteInterval];
  const plan = planChunks(fromDate, toDate, chunkDays);
  if (!plan.ok) return { ok: false, kind: 'input', message: plan.error };
  const wait = rateLimiter(MIN_GAP_MS, sleep, now);
  const intraday = kiteInterval !== 'day';
  const byDate = new Map();
  let requests = 0;
  let skipped = 0;
  let queue = plan.chunks.slice();

  while (queue.length) {
    if (requests >= MAX_REQUESTS) return { ok: false, kind: 'limit', message: `Stopped after ${MAX_REQUESTS} requests. Ask for a shorter range.`, bars: [...byDate.values()] };
    const ch = queue.shift();
    await wait();
    requests += 1;
    const r = await call(http, {
      method: 'GET', path: `/instruments/historical/${instrumentToken}/${kiteInterval}`,
      query: { from: ch.from, to: ch.to }, headers: { Authorization: authHeader(creds.apiKey, creds.accessToken) },
    });
    if (!r.ok) {
      if (r.kind === 'range' && chunkDays > 1) {
        chunkDays = Math.max(1, Math.floor(chunkDays / 2));
        const re = planChunks(ch.from.slice(0, 10), ch.to.slice(0, 10), chunkDays);
        queue = (re.ok ? re.chunks : []).concat(queue);
        continue;
      }
      if (r.kind === 'rate') { await sleep(2000); queue.unshift(ch); continue; }
      return { ok: false, kind: r.kind, message: r.message, bars: [...byDate.values()] };
    }
    for (const c of (r.data && r.data.candles) || []) {
      const bar = toBar(c, intraday);
      if (!bar) { skipped += 1; continue; }
      byDate.set(bar.date, bar);
    }
    if (onProgress) onProgress({ requests, bars: byDate.size, chunksLeft: queue.length });
  }
  const bars = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  return { ok: true, bars, requests, skipped, chunkDays };
}

module.exports = {
  API_BASE, LOGIN_BASE, MAX_REQUESTS, MIN_GAP_MS, KITE_INTERVALS, CHUNK_DAYS, INDEX_SYMBOLS,
  ALLOWED, ORDER_LIKE, assertAllowed, loginUrl, checksum, parseRedirect, tokenExpiry, sessionState, authHeader,
  toKiteInterval, instrumentKey, planChunks, parseStamp, toBar, rateLimiter, classify,
  call, exchangeToken, logout, resolveToken, fetchCandles,
};
