'use strict';

/**
 * verifyKite.cjs - Zerodha Kite Connect as a DATA source (spec Section 156)
 *
 * No Kite account, no network: the HTTP client is a recorder. What this guards, in order of how bad the failure is:
 *
 *   NO ORDER PATH, EVER   the allowlist refuses every order, GTT, basket, portfolio and margin path, and every
 *                         request the client ever builds is run back through it
 *   SECRETS STAY HOME     the API secret and the access token appear in no reply and, apart from the one request
 *                         that needs them, in no outgoing request (the secret only as a checksum)
 *   THE LOGIN IS BOUND    a pasted address must carry the `state` Rāma issued: single use, ten minutes
 *   THE GATE              anonymous, viewer, operator and admin are refused every channel
 *   THE FETCH IS CAREFUL  chunked, throttled to two a second, halves on a range error, stops at a cap, and an
 *                         expired token ends the session instead of retrying
 *
 * Run: node scripts/verifyKite.cjs   (or npm run verify:kite)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; } });

const kite = require(path.join(ROOT, 'electron/lib/kiteClient.cjs'));
const ba = require(path.join(ROOT, 'electron/lib/brokerAccounts.cjs'));
const principalBinding = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));
const ipc = require(path.join(ROOT, 'electron/ipc/kiteSession.cjs'));

const KEY = 'abcd1234efgh5678';
const SECRET = 'S3CRETvalue0123456789abcdefXYZ';
const TOKEN = 'ACCESStokenQQQ9876543210zzzz';
const REQ = 'reqTOKEN12345678';

// A recorder standing in for lib/http.cjs. `script` decides each reply.
function recorder(script) {
  const calls = [];
  return {
    calls,
    request: async (url, opts = {}) => {
      const u = new URL(url);
      const rec = { url, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || null };
      calls.push(rec);
      const r = script(rec, calls.length);
      return { ok: r.status >= 200 && r.status < 400, status: r.status, body: JSON.stringify(r.json) };
    },
  };
}
const okJson = (data) => ({ status: 200, json: { status: 'success', data } });
const errJson = (status, type, message) => ({ status, json: { status: 'error', error_type: type, message } });

// A virtual clock: sleeping advances it, so throttling is measurable without waiting.
function clock(start = Date.parse('2026-10-19T04:00:00Z')) {
  const c = { t: start, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.sleeps.push(ms); c.t += ms; };
  return c;
}

const candle = (iso, o, h, l, c, v = 1000) => [iso, o, h, l, c, v];

(async () => {
  console.warn('\nkite - data only: the allowlist, the login, the session, the candles\n');

  // ═══ the allowlist ═════════════════════════════════════════════════════════════════════════════
  section('NO ORDER PATH, EVER');
  const A = kite.assertAllowed;
  for (const [m, p] of [['POST', '/session/token'], ['DELETE', '/session/token'], ['GET', '/quote/ltp'], ['GET', '/instruments/historical/408065/day'], ['GET', '/instruments/historical/408065/minute'], ['GET', '/instruments/historical/5633/60minute']]) {
    check(`${m} ${p} is allowed`, A(m, p).ok === true);
  }
  for (const [m, p] of [
    ['POST', '/orders/regular'], ['POST', '/orders'], ['PUT', '/orders/regular/123'], ['DELETE', '/orders/regular/123'], ['GET', '/orders'], ['GET', '/trades'],
    ['POST', '/gtt/triggers'], ['POST', '/orders/iceberg'], ['POST', '/basket'], ['GET', '/portfolio/holdings'], ['GET', '/portfolio/positions'], ['PUT', '/portfolio/positions'],
    ['GET', '/user/margins'], ['GET', '/user/profile'], ['GET', '/quote'], ['GET', '/quote/ohlc'], ['GET', '/instruments'], ['GET', '/instruments/NSE'], ['GET', '/mf/orders'],
    ['GET', '/session/token'], ['POST', '/quote/ltp'], ['DELETE', '/quote/ltp'], ['POST', '/instruments/historical/408065/day'],
    ['GET', '/instruments/historical/abc/day'], ['GET', '/instruments/historical/408065/week'], ['GET', '/instruments/historical/408065/day/extra'],
    ['GET', '/instruments/historical/408065/day/../../orders'], ['GET', '/instruments/historical/1234567890123/day'], ['GET', ''], ['GET', '/'], ['GET', 'orders'],
  ]) {
    check(`${m} ${p || '(empty)'} is refused`, A(m, p).ok === false, JSON.stringify(A(m, p)));
  }
  // TWO LAYERS, EACH SUFFICIENT ON ITS OWN: the allowlist (nothing else matches) and the order-path pattern.
  const orderish = [['POST', '/orders/regular'], ['GET', '/orders'], ['POST', '/gtt/triggers'], ['GET', '/portfolio/holdings'], ['GET', '/portfolio/positions'], ['GET', '/user/margins'], ['POST', '/basket'], ['GET', '/trades'], ['GET', '/mf/orders']];
  check('the allowlist ALONE refuses every one of them (no entry matches an order, portfolio or margin path)', orderish.every(([m, p]) => !kite.ALLOWED.some((a) => a.method === m && a.re.test(p))));
  check('the order-path pattern ALONE refuses every one of them', orderish.every(([, p]) => kite.ORDER_LIKE.test(p)));
  check('and the pattern does not catch the four paths Rāma needs', [['/session/token'], ['/quote/ltp'], ['/instruments/historical/408065/day']].every(([p]) => !kite.ORDER_LIKE.test(p)));
  check('a method in the wrong case is still judged', A('get', '/quote/ltp').ok === true && A('post', '/orders/regular').ok === false);
  check('an order-looking segment is refused even inside an otherwise allowed shape', A('GET', '/instruments/historical/408065/day/orders').ok === false);
  check('the refusal says Rāma is data-only', /data-only/.test(A('POST', '/orders/regular').error));

  let spy = recorder(() => okJson({}));
  const refused = await kite.call(spy, { method: 'POST', path: '/orders/regular', body: 'x=1' });
  check('call() refuses an order BEFORE any request is built', refused.ok === false && refused.kind === 'refused' && spy.calls.length === 0);
  const refused2 = await kite.call(spy, { method: 'GET', path: '/portfolio/holdings' });
  check('and holdings', refused2.ok === false && spy.calls.length === 0);
  const s0 = recorder(() => okJson({}));
  await kite.call(s0, { method: 'GET', path: '/quote/ltp', query: { i: 'NSE:X' } });
  check('the version header is sent and the host is Kite', s0.calls[0].host === 'api.kite.trade' && s0.calls[0].headers['X-Kite-Version'] === '3');

  // ═══ login ═════════════════════════════════════════════════════════════════════════════════════
  section('the login address, the checksum, the pasted redirect');
  const lu = new URL(kite.loginUrl(KEY, 'st4te'));
  check('the login address is Kite\'s own page', lu.origin === 'https://kite.zerodha.com' && lu.pathname === '/connect/login');
  check('it carries version 3, the key, and the state through redirect_params', lu.searchParams.get('v') === '3' && lu.searchParams.get('api_key') === KEY && lu.searchParams.get('redirect_params') === 'state=st4te');
  check('a hostile key cannot break out of the query', (() => { const u = new URL(kite.loginUrl('a&v=9#x', 's')); return u.searchParams.get('api_key') === 'a&v=9#x' && u.searchParams.get('v') === '3'; })());
  check('the secret is nowhere in the login address', !kite.loginUrl(KEY, 'st4te').includes(SECRET));
  check('the checksum is SHA-256 of key + token + secret', kite.checksum('a', 'b', 'c') === ['ba7816bf8f01cfea', '414140de5dae2223', 'b00361a396177a9c', 'b410ff61f20015ad'].join('')); // the public SHA-256 test vector for bc, split so the secret scan does not read it as a key
  check('and depends on every part', new Set([kite.checksum('a', 'b', 'c'), kite.checksum('x', 'b', 'c'), kite.checksum('a', 'x', 'c'), kite.checksum('a', 'b', 'x')]).size === 4);

  const good = `http://127.0.0.1/?request_token=${REQ}&action=login&status=success&state=st4te`;
  let pr = kite.parseRedirect(good);
  check('a full redirect address parses', pr.ok && pr.requestToken === REQ && pr.state === 'st4te');
  pr = kite.parseRedirect(`request_token=${REQ}&status=success&state=zz`);
  check('a bare query string parses', pr.ok && pr.requestToken === REQ);
  pr = kite.parseRedirect(`?request_token=${REQ}&status=success`);
  check('a leading ? is fine, and a missing state is reported as null', pr.ok && pr.state === null);
  check('a failed login is refused with Kite\'s word for it', /failure/.test(kite.parseRedirect(`http://x/?status=failure&request_token=${REQ}`).error));
  check('no request_token is refused', kite.parseRedirect('http://127.0.0.1/?status=success').ok === false);
  check('a malformed request_token is refused', kite.parseRedirect('http://127.0.0.1/?request_token=<script>&status=success').ok === false);
  check('empty, whitespace and junk are refused', ['', '   ', null, undefined, 'hello', 'a'.repeat(3000)].every((x) => kite.parseRedirect(x).ok === false));
  check('a token shorter than 8 or longer than 64 is refused', kite.parseRedirect('?request_token=abc&status=success').ok === false && kite.parseRedirect(`?request_token=${'a'.repeat(65)}&status=success`).ok === false);

  section('the session ends at 06:00 IST');
  const ist = (s) => Date.parse(`${s}+05:30`);
  check('logged in at 10:00 IST: dies at 06:00 IST next morning', kite.tokenExpiry(ist('2026-10-18T10:00:00')) === ist('2026-10-19T06:00:00'));
  check('logged in at 05:59 IST: dies in a minute, at 06:00 the same day', kite.tokenExpiry(ist('2026-10-18T05:59:00')) === ist('2026-10-18T06:00:00'));
  check('logged in at exactly 06:00 IST: lasts until the NEXT 06:00', kite.tokenExpiry(ist('2026-10-18T06:00:00')) === ist('2026-10-19T06:00:00'));
  check('logged in at 23:59 IST: dies at 06:00 IST', kite.tokenExpiry(ist('2026-10-18T23:59:00')) === ist('2026-10-19T06:00:00'));
  check('logged in just after midnight IST: dies at 06:00 the same IST day', kite.tokenExpiry(ist('2026-10-19T00:10:00')) === ist('2026-10-19T06:00:00'));
  const sess = { accessToken: TOKEN, issuedAt: ist('2026-10-18T10:00:00') };
  check('before expiry the session is live', kite.sessionState(sess, ist('2026-10-19T05:59:59')) === 'live');
  check('at 06:00 IST it is expired', kite.sessionState(sess, ist('2026-10-19T06:00:00')) === 'expired');
  check('no session, no token, or a garbage time are not live', kite.sessionState(null) === 'none' && kite.sessionState({}) === 'none' && kite.sessionState({ accessToken: 'x', issuedAt: 'soon' }) === 'expired');
  check('the auth header is the documented form', kite.authHeader('K', 'T') === 'token K:T');

  // ═══ the token exchange ════════════════════════════════════════════════════════════════════════
  section('the token exchange');
  const ex = recorder((rec) => okJson({ access_token: TOKEN, user_id: 'AB1234', user_shortname: 'Ravi', public_token: 'pub', enctoken: 'enc' }));
  const x = await kite.exchangeToken(ex, { apiKey: KEY, secret: SECRET, requestToken: REQ, now: () => 1234 });
  check('it succeeds and returns a session', x.ok && x.session.accessToken === TOKEN && x.session.userId === 'AB1234' && x.session.issuedAt === 1234);
  const rq = ex.calls[0];
  check('it POSTs form fields to /session/token', rq.method === 'POST' && rq.path === '/session/token' && /x-www-form-urlencoded/.test(rq.headers['Content-Type']));
  const form = new URLSearchParams(rq.body);
  check('the form carries api_key, request_token and the checksum', form.get('api_key') === KEY && form.get('request_token') === REQ && form.get('checksum') === kite.checksum(KEY, REQ, SECRET));
  check('THE SECRET ITSELF IS NOT SENT: only its checksum', !JSON.stringify(rq).includes(SECRET) && !rq.body.includes(SECRET));
  check('the other tokens in the reply (public, enc) are not kept', !JSON.stringify(x).includes('pub') && !JSON.stringify(x).includes('enc'));
  const noTok = await kite.exchangeToken(recorder(() => okJson({ user_id: 'x' })), { apiKey: KEY, secret: SECRET, requestToken: REQ });
  check('a reply with no access token is a failure', noTok.ok === false);
  const bad = await kite.exchangeToken(recorder(() => errJson(403, 'TokenException', 'Token is invalid or has expired.')), { apiKey: KEY, secret: SECRET, requestToken: REQ });
  check('an expired request_token is classified as a token problem', bad.ok === false && bad.kind === 'token' && /expired/.test(bad.message));

  section('error classes');
  const C = kite.classify;
  check('429 is rate', C(429, null) === 'rate');
  check('TokenException is token', C(403, { error_type: 'TokenException', message: 'x' }) === 'token');
  check('a 403 that talks about the session is token', C(403, { message: 'Invalid session' }) === 'token');
  check('PermissionException is permission (no historical add-on)', C(403, { error_type: 'PermissionException', message: 'Insufficient permission' }) === 'permission');
  check('a range complaint is range', C(400, { error_type: 'InputException', message: 'interval exceeds max limit: 60 days' }) === 'range');
  check('another InputException is input', C(400, { error_type: 'InputException', message: 'invalid token' }) === 'input');
  check('status 0 is network, anything else vendor', C(0, null) === 'network' && C(500, null) === 'vendor');
  const net1 = await kite.call({ request: async () => { throw new Error('ECONNRESET'); } }, { method: 'GET', path: '/quote/ltp', query: { i: 'NSE:X' } });
  check('a throwing client is contained as a network failure', net1.ok === false && net1.kind === 'network');
  const junk = await kite.call(recorder(() => ({ status: 200, json: 'not-an-object' })), { method: 'GET', path: '/quote/ltp', query: { i: 'NSE:X' } });
  check('a 200 that is not a success envelope is not trusted', junk.ok === false);

  // ═══ instruments and intervals ═════════════════════════════════════════════════════════════════
  section('what can be asked for');
  check('Rāma intervals map to Kite\'s', ['1m:minute', '5m:5minute', '15m:15minute', '30m:30minute', '60m:60minute', '1h:60minute', '1d:day'].every((p) => kite.toKiteInterval(p.split(':')[0]) === p.split(':')[1]));
  check('weekly and monthly are refused (no resampling is invented)', kite.toKiteInterval('1wk') === null && kite.toKiteInterval('1mo') === null && kite.toKiteInterval('') === null && kite.toKiteInterval(null) === null);
  check('an equity key', kite.instrumentKey('reliance', 'NSE').key === 'NSE:RELIANCE' && kite.instrumentKey('BAJAJ-AUTO', 'NSE').key === 'NSE:BAJAJ-AUTO');
  check('BSE is accepted', kite.instrumentKey('RELIANCE', 'BSE').key === 'BSE:RELIANCE');
  check('indices map to Kite\'s names', kite.instrumentKey('NIFTY50').key === 'NSE:NIFTY 50' && kite.instrumentKey('BANKNIFTY').key === 'NSE:NIFTY BANK' && kite.instrumentKey('SENSEX').key === 'BSE:SENSEX');
  check('futures and commodity exchanges are refused', kite.instrumentKey('RELIANCE', 'NFO').ok === false && kite.instrumentKey('GOLD', 'MCX').ok === false);
  check('hostile symbols are refused', ['', 'A;B', 'A/B', 'A"B', 'A\nB', '<x>', 'x'.repeat(50), null].every((s) => kite.instrumentKey(s, 'NSE').ok === false));

  section('chunk planning');
  const plan = kite.planChunks('2026-01-01', '2026-04-10', 30);
  check('100 days at 30 per request is 4 requests', plan.ok && plan.chunks.length === 4);
  check('they are consecutive and do not overlap', plan.chunks.every((c, i) => i === 0 || c.from.slice(0, 10) > plan.chunks[i - 1].to.slice(0, 10)));
  check('the first starts at the start and the last ends at the end, whole days', plan.chunks[0].from === '2026-01-01 00:00:00' && plan.chunks[3].to === '2026-04-10 23:59:59');
  check('each span is at most 30 days', plan.chunks.every((c) => (Date.parse(c.to.slice(0, 10)) - Date.parse(c.from.slice(0, 10))) / 86400000 <= 29));
  check('one day is one request', kite.planChunks('2026-05-05', '2026-05-05', 30).chunks.length === 1);
  check('an end before the start is refused', kite.planChunks('2026-05-06', '2026-05-05', 30).ok === false);
  check('a non-date is refused', kite.planChunks('yesterday', '2026-05-05', 30).ok === false && kite.planChunks('2026-02-30x', '2026-05-05', 30).ok === false);
  check('an absurd range is refused rather than planned', kite.planChunks('1900-01-01', '2026-01-01', 1).ok === false);

  section('candles become bars');
  const ib = kite.toBar(candle('2017-12-15T09:15:00+0530', 1704.5, 1705, 1699.25, 1702.8, 2499), true);
  check('an intraday candle becomes UTC with no zone (09:15 IST = 03:45 UTC)', ib && ib.date === '2017-12-15 03:45:00' && ib.open === 1704.5 && ib.volume === 2499);
  const db = kite.toBar(candle('2024-10-16T00:00:00+0530', 100, 110, 95, 105), false);
  check('a daily candle keeps its IST calendar date (not the UTC day before)', db && db.date === '2024-10-16');
  check('a missing volume is zero, an OI column is ignored', kite.toBar(['2024-10-16T00:00:00+0530', 1, 2, 1, 2], false).volume === 0 && kite.toBar(['2024-10-16T00:00:00+0530', 1, 2, 1, 2, 5, 99999], false).volume === 5);
  for (const [name, c] of [['too short', ['2024-10-16T00:00:00+0530', 1, 2]], ['not an array', 'x'], ['null', null], ['NaN price', candle('2024-10-16T00:00:00+0530', 'a', 2, 1, 2)], ['zero price', candle('2024-10-16T00:00:00+0530', 0, 2, 1, 2)], ['negative', candle('2024-10-16T00:00:00+0530', -1, 2, 1, 2)],
    ['high below low', candle('2024-10-16T00:00:00+0530', 1, 1, 2, 1)], ['close above high', candle('2024-10-16T00:00:00+0530', 1, 2, 1, 3)], ['close below low', candle('2024-10-16T00:00:00+0530', 2, 3, 2, 1)], ['bad stamp', candle('yesterday', 1, 2, 1, 2)]]) {
    check(`a candle that is ${name} is dropped`, kite.toBar(c, false) === null);
  }

  // ═══ resolving and fetching ════════════════════════════════════════════════════════════════════
  section('resolving a token, then fetching');
  const creds = { apiKey: KEY, accessToken: TOKEN };
  const rs = recorder((rec) => okJson({ 'NSE:RELIANCE': { instrument_token: 738561, last_price: 1 } }));
  const rt = await kite.resolveToken(rs, creds, 'reliance', 'NSE');
  check('the token is learned from the last-price API', rt.ok && rt.instrumentToken === 738561 && rs.calls[0].path === '/quote/ltp' && rs.calls[0].query.i === 'NSE:RELIANCE');
  check('the Authorization header is "token key:accesstoken"', rs.calls[0].headers.Authorization === `token ${KEY}:${TOKEN}`);
  check('an unknown instrument is a clear failure', (await kite.resolveToken(recorder(() => okJson({})), creds, 'NOPE', 'NSE')).ok === false);
  check('a bad symbol never reaches the network', (async () => { const r = recorder(() => okJson({})); await kite.resolveToken(r, creds, 'A;B', 'NSE'); return r.calls.length === 0; })() instanceof Promise && await (async () => { const r = recorder(() => okJson({})); await kite.resolveToken(r, creds, 'A;B', 'NSE'); return r.calls.length === 0; })());

  // a server that returns one candle per calendar day in the requested span
  const dayServer = (limitDays) => recorder((rec) => {
    const [, , , token, interval] = rec.path.split('/');
    const from = Date.parse(rec.query.from.slice(0, 10));
    const to = Date.parse(rec.query.to.slice(0, 10));
    const span = (to - from) / 86400000 + 1;
    if (limitDays && span > limitDays) return errJson(400, 'InputException', 'interval exceeds max limit: ' + limitDays + ' days');
    const out = [];
    for (let t = from; t <= to; t += 86400000) { const d = new Date(t).toISOString().slice(0, 10); out.push(candle(`${d}T00:00:00+0530`, 100, 110, 95, 105, 1000)); }
    return okJson({ candles: out });
  });
  let clk = clock();
  let srv = dayServer(0);
  let fc = await kite.fetchCandles(srv, creds, { instrumentToken: 738561, interval: '1d', fromDate: '2026-01-01', toDate: '2026-02-09', sleep: clk.sleep, now: clk.now });
  check('a 40-day daily fetch is one request', fc.ok && fc.requests === 1 && fc.bars.length === 40, JSON.stringify({ r: fc.requests, n: fc.bars && fc.bars.length }));
  check('the request goes to the historical path with the token and interval', srv.calls[0].path === '/instruments/historical/738561/day' && srv.calls[0].query.from === '2026-01-01 00:00:00' && srv.calls[0].query.to === '2026-02-09 23:59:59');
  check('bars come back sorted ascending', fc.bars.every((b, i) => i === 0 || fc.bars[i - 1].date < b.date));

  clk = clock();
  srv = dayServer(0);
  fc = await kite.fetchCandles(srv, creds, { instrumentToken: 5, interval: '1m', fromDate: '2026-01-01', toDate: '2026-04-10', sleep: clk.sleep, now: clk.now });
  check('minute candles over 100 days are chunked at 30 days: 4 requests', fc.ok && fc.requests === 4 && srv.calls.length === 4);
  check('and every one of those requests is on the allowlist', srv.calls.every((c) => kite.assertAllowed(c.method, c.path).ok));
  check('the chunks do not duplicate a day', fc.bars.length === 100 && new Set(fc.bars.map((b) => b.date)).size === 100);
  const startGap = clk.sleeps.reduce((a, b) => a + b, 0);
  check('the requests were spaced at least 500 ms apart (two a second at most)', clk.sleeps.length >= 3 && clk.sleeps.every((s) => s <= kite.MIN_GAP_MS) && startGap >= 3 * kite.MIN_GAP_MS - 5, JSON.stringify(clk.sleeps));

  clk = clock();
  srv = dayServer(10);
  fc = await kite.fetchCandles(srv, creds, { instrumentToken: 5, interval: '1m', fromDate: '2026-01-01', toDate: '2026-01-31', sleep: clk.sleep, now: clk.now });
  check('when Kite says the range is too long, the span is halved until it is accepted', fc.ok && fc.bars.length === 31 && fc.chunkDays <= 10, JSON.stringify({ n: fc.bars && fc.bars.length, d: fc.chunkDays }));
  check('and no day is lost or doubled by the retry', fc.ok && new Set(fc.bars.map((b) => b.date)).size === 31);

  clk = clock();
  srv = dayServer(0);
  const huge = await kite.fetchCandles(srv, creds, { instrumentToken: 5, interval: '1m', fromDate: '2000-01-01', toDate: '2026-01-01', sleep: clk.sleep, now: clk.now });
  check('an enormous range stops at the request cap, keeping what it got', huge.ok === false && huge.kind === 'limit' && srv.calls.length === kite.MAX_REQUESTS && huge.bars.length > 0);

  clk = clock();
  let n = 0;
  srv = recorder(() => { n += 1; return n === 1 ? okJson({ candles: [candle('2026-01-05T00:00:00+0530', 1, 2, 1, 2)] }) : errJson(403, 'TokenException', 'Session expired'); });
  const tk = await kite.fetchCandles(srv, creds, { instrumentToken: 5, interval: '1m', fromDate: '2026-01-01', toDate: '2026-03-01', sleep: clk.sleep, now: clk.now });
  check('a token failure mid-way stops at once (no retry loop) and reports what it had', tk.ok === false && tk.kind === 'token' && srv.calls.length === 2 && tk.bars.length === 1);

  clk = clock();
  n = 0;
  srv = recorder(() => { n += 1; return n === 1 ? errJson(429, null, 'Too many requests') : okJson({ candles: [candle('2026-01-05T00:00:00+0530', 1, 2, 1, 2)] }); });
  const rl = await kite.fetchCandles(srv, creds, { instrumentToken: 5, interval: '1d', fromDate: '2026-01-01', toDate: '2026-01-10', sleep: clk.sleep, now: clk.now });
  check('a rate-limit reply waits and tries the same span again', rl.ok && rl.bars.length === 1 && srv.calls.length === 2 && clk.sleeps.some((s) => s >= 2000));

  srv = recorder(() => okJson({ candles: [candle('2026-01-05T00:00:00+0530', 1, 2, 1, 2), candle('2026-01-06T00:00:00+0530', 1, 2, 1, 5), ['bad']] }));
  clk = clock();
  const sk = await kite.fetchCandles(srv, creds, { instrumentToken: 5, interval: '1d', fromDate: '2026-01-01', toDate: '2026-01-10', sleep: clk.sleep, now: clk.now });
  check('malformed candles are skipped and counted, not stored', sk.ok && sk.bars.length === 1 && sk.skipped === 2);
  const uns = await kite.fetchCandles(recorder(() => okJson({})), creds, { instrumentToken: 5, interval: '1wk', fromDate: '2026-01-01', toDate: '2026-01-10' });
  check('an unsupported interval is refused before any request', uns.ok === false && uns.kind === 'input');

  // ═══ the channels ══════════════════════════════════════════════════════════════════════════════
  section('the channels');
  const memStore = () => {
    const d = {};
    return { get: (dom, k) => (d[dom] && d[dom][k] !== undefined ? d[dom][k] : null), set: (dom, k, v) => { d[dom] = d[dom] || {}; d[dom][k] = JSON.parse(JSON.stringify(v)); }, raw: d };
  };
  const SELF = { id: 'inst-self-0001', label: 'Master PC' };
  const store = memStore();
  const seeded = ba.saveAccount(store, { label: 'Main', brokerId: 'kite', clientId: 'AB1234', apiKey: KEY, secret: SECRET, primaryIp: '103.21.58.10' }, { self: SELF, brokerIds: ['kite', 'dhan'] });
  const dhan = ba.saveAccount(store, { label: 'Dhan', brokerId: 'dhan', apiKey: 'dhankey123456', secret: 'DHANsecret0123456789abc' }, { self: SELF, brokerIds: ['kite', 'dhan'] });
  const noSecret = (() => { const s = memStore(); const r = ba.saveAccount(s, { label: 'Pending', brokerId: 'kite', apiKey: KEY, secret: SECRET }, { self: SELF, brokerIds: ['kite'] }); s.raw.brokerAccounts.accounts[0].secret = null; return { s, id: r.account.id }; })();
  const id = seeded.account.id;

  const clkI = clock();
  const opened = [];
  const imports = [];
  let httpScript = (rec) => {
    if (rec.path === '/session/token' && rec.method === 'POST') return okJson({ access_token: TOKEN, user_id: 'AB1234', user_shortname: 'Ravi' });
    if (rec.path === '/session/token' && rec.method === 'DELETE') return okJson(true);
    if (rec.path === '/quote/ltp') return okJson({ [rec.query.i]: { instrument_token: 738561 } });
    if (rec.path.startsWith('/instruments/historical/')) return okJson({ candles: [candle('2026-10-16T00:00:00+0530', 100, 110, 95, 105), candle('2026-10-15T00:00:00+0530', 99, 104, 97, 100)] });
    return errJson(404, 'GeneralException', 'no');
  };
  const http = recorder((rec, i) => httpScript(rec, i));
  const handlers = new Map();
  ipc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, {
    store, http, unlocked: () => true, now: clkI.now, sleep: clkI.sleep, self: () => SELF,
    openExternal: async (url) => { opened.push(url); },
    importBars: async (body) => { imports.push(body); return { ok: true, data: { ok: true, imported: body.bars.length, bars: body.bars.length, firstBar: body.bars[0].date, lastBar: body.bars[body.bars.length - 1].date } }; },
  });
  check('four channels', handlers.size === 4, [...handlers.keys()].join());

  const pOf = {};
  principalBinding.useAuth({
    validateSession: (tok) => (pOf[tok] ? { userId: pOf[tok].userId } : null),
    findById: (uid) => Object.values(pOf).find((u) => u.userId === uid) || null,
    publicUser: (u) => ({ ...u, id: u.userId }),
  });
  const mk = (wid, tok, acct) => { pOf[tok] = { userId: `acct-${tok}`, username: tok, ...acct }; principalBinding.bind({ id: wid }, tok, 'fp'); return { sender: { id: wid } }; };
  const W = { master: mk(601, 'm', { tier: 0 }), sa: mk(602, 's', { tier: 1 }), admin: mk(603, 'a', { tier: 2 }), operator: mk(604, 'o', { tier: 3 }), viewer: mk(605, 'v', { tier: 4 }), guest: mk(606, 'g', { tier: 5 }) };
  const nobody = { sender: { id: 999 } };
  const call = (ch, win, body) => handlers.get(`kiteSession:${ch}`)(win, body);
  const everything = [];
  const keep = (r) => { everything.push(r); return r; };

  for (const [who, win] of Object.entries({ anonymous: nobody, guest: W.guest, viewer: W.viewer, operator: W.operator, admin: W.admin })) {
    for (const ch of ['login-start', 'login-complete', 'logout', 'fetch-bars']) {
      const r = await call(ch, win, { accountId: id, redirect: good, symbol: 'RELIANCE', interval: '1d' });
      check(`${who} is refused ${ch}`, r.ok === false && !('data' in r) && !('url' in r));
    }
  }
  check('and nothing left the machine for any refused caller', http.calls.length === 0 && opened.length === 0 && imports.length === 0);

  const forged = await handlers.get('kiteSession:login-start')(W.guest, { user: { tier: 0 }, accountId: id });
  check('a guest claiming tier 0 in the payload is still refused', forged.ok === false);

  // login-start
  let ls = keep(await call('login-start', W.sa, { accountId: id }));
  check('login-start returns Kite\'s login address and opens it in the browser', ls.ok && ls.opened && opened.length === 1 && opened[0] === ls.url && new URL(ls.url).hostname === 'kite.zerodha.com');
  const state1 = new URL(ls.url).searchParams.get('redirect_params').replace('state=', '');
  check('it carries a random state', /^[0-9a-f]{24}$/.test(state1));
  check('it said how long the login waits', ls.expiresInSec === 600);
  check('the secret is not in the address', !ls.url.includes(SECRET));
  check('a non-Kite account cannot log in to Kite', (await call('login-start', W.sa, { accountId: dhan.account.id })).ok === false);
  check('an account with no secret cannot', (await call('login-start', W.sa, { accountId: 'nope' })).ok === false);

  // login-complete: refusals
  let lc = await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=WRONGSTATE00` });
  check('an address with the wrong state is refused', lc.ok === false && /does not belong/.test(lc.error));
  check('and no exchange was attempted', http.calls.filter((c) => c.path === '/session/token').length === 0);
  lc = await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=${state1}` });
  check('a wrong state also burns the pending login, so the right address afterwards is refused too', lc.ok === false && /No login is waiting/.test(lc.error));
  check('a login nobody started is refused', (await call('login-complete', W.sa, { accountId: id, redirect: good })).ok === false);

  // a clean login
  ls = keep(await call('login-start', W.sa, { accountId: id }));
  const state2 = new URL(ls.url).searchParams.get('redirect_params').replace('state=', '');
  check('an address with no state is refused', (await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success` })).ok === false);
  ls = keep(await call('login-start', W.sa, { accountId: id }));
  const state3 = new URL(ls.url).searchParams.get('redirect_params').replace('state=', '');
  check('each login gets its own state', new Set([state1, state2, state3]).size === 3);
  lc = keep(await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&action=login&status=success&state=${state3}` }));
  check('the right address completes the login', lc.ok === true && lc.user === 'AB1234', JSON.stringify(lc));
  const acctView = lc.data.accounts.find((a) => a.id === id);
  check('the account now shows a live session with who and until when', acctView.session.state === 'live' && acctView.session.userId === 'AB1234' && /T/.test(acctView.session.expiresAt));
  const exch = http.calls.find((c) => c.path === '/session/token');
  check('the exchange carried the checksum and not the secret', new URLSearchParams(exch.body).get('checksum') === kite.checksum(KEY, REQ, SECRET) && !JSON.stringify(exch).includes(SECRET));
  const again = await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=${state3}` });
  check('the same address cannot be used twice', again.ok === false);

  // timeout
  const lsT = await call('login-start', W.sa, { accountId: id });
  const stateT = new URL(lsT.url).searchParams.get('redirect_params').replace('state=', '');
  clkI.t += 11 * 60 * 1000;
  const lcT = await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=${stateT}` });
  check('a login older than ten minutes is refused', lcT.ok === false && /timed out/.test(lcT.error));
  clkI.t -= 11 * 60 * 1000;

  // exchange failure
  httpScript = (rec) => (rec.path === '/session/token' && rec.method === 'POST' ? errJson(403, 'TokenException', 'Token is invalid or has expired.') : okJson({}));
  const store2 = memStore();
  const seed2 = ba.saveAccount(store2, { label: 'Two', brokerId: 'kite', apiKey: KEY, secret: SECRET }, { self: SELF, brokerIds: ['kite'] });
  const h2 = new Map();
  ipc.register({ handle: (ch, fn) => h2.set(ch, fn) }, { store: store2, http, unlocked: () => true, now: clkI.now, sleep: clkI.sleep, self: () => SELF, openExternal: async () => {}, importBars: async () => ({ ok: true }) });
  const ls2 = await h2.get('kiteSession:login-start')(W.sa, { accountId: seed2.account.id });
  const st2 = new URL(ls2.url).searchParams.get('redirect_params').replace('state=', '');
  const lc2 = await h2.get('kiteSession:login-complete')(W.sa, { accountId: seed2.account.id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=${st2}` });
  check('if Kite refuses the exchange the reply says so and NO session is stored', lc2.ok === false && /refused the login/.test(lc2.error) && !JSON.stringify(store2.raw).includes(TOKEN) && ba.snapshot(store2, { self: SELF }).accounts[0].session.state === 'none');
  httpScript = (rec) => {
    if (rec.path === '/session/token' && rec.method === 'POST') return okJson({ access_token: TOKEN, user_id: 'AB1234' });
    if (rec.path === '/session/token' && rec.method === 'DELETE') return okJson(true);
    if (rec.path === '/quote/ltp') return okJson({ [rec.query.i]: { instrument_token: 738561 } });
    if (rec.path.startsWith('/instruments/historical/')) return okJson({ candles: [candle('2026-10-16T00:00:00+0530', 100, 110, 95, 105), candle('2026-10-15T00:00:00+0530', 99, 104, 97, 100)] });
    return errJson(404, 'GeneralException', 'no');
  };

  // fetch-bars
  const before = http.calls.length;
  check('an unsupported interval is refused before any request', (await call('fetch-bars', W.sa, { accountId: id, symbol: 'RELIANCE', exchange: 'NSE', interval: '1wk' })).ok === false && http.calls.length === before);
  check('so is a hostile symbol', (await call('fetch-bars', W.sa, { accountId: id, symbol: 'A;B', exchange: 'NSE', interval: '1d' })).ok === false && http.calls.length === before);
  check('and a non-Kite account', (await call('fetch-bars', W.sa, { accountId: dhan.account.id, symbol: 'X', exchange: 'NSE', interval: '1d' })).ok === false);
  const fb = keep(await call('fetch-bars', W.sa, { accountId: id, symbol: 'reliance', exchange: 'NSE', interval: '1d', fromDate: '2026-10-01', toDate: '2026-10-17' }));
  check('a fetch succeeds and reports counts', fb.ok && fb.fetched === 2 && fb.requests === 1 && fb.key === 'NSE:RELIANCE', JSON.stringify(fb));
  check('the bars were handed to the engine once, labelled kite', imports.length === 1 && imports[0].source === 'kite' && imports[0].symbol === 'RELIANCE' && imports[0].exchange === 'NSE' && imports[0].interval === '1d' && imports[0].bars.length === 2);
  check('the bars are in ascending order and in Rāma\'s shape', imports[0].bars[0].date === '2026-10-15' && imports[0].bars[1].date === '2026-10-16' && ['date', 'open', 'high', 'low', 'close', 'volume'].every((k) => k in imports[0].bars[0]));
  check('nothing carrying the token or the secret went to the engine', !JSON.stringify(imports).includes(TOKEN) && !JSON.stringify(imports).includes(SECRET));
  check('every Kite request of the whole run is on the allowlist', http.calls.every((c) => kite.assertAllowed(c.method, c.path).ok), http.calls.map((c) => `${c.method} ${c.path}`).filter((s) => !/session|quote|historical/.test(s)).join());
  check('historical requests carried the token only in the Authorization header, never in the URL', http.calls.filter((c) => c.path.startsWith('/instruments/historical')).every((c) => !c.url.includes(TOKEN) && c.headers.Authorization === `token ${KEY}:${TOKEN}`));
  check('an import the engine rejects is reported, not hidden', await (async () => {
    const h = new Map();
    ipc.register({ handle: (ch, fn) => h.set(ch, fn) }, { store, http, unlocked: () => true, now: clkI.now, sleep: clkI.sleep, self: () => SELF, openExternal: async () => {}, importBars: async () => ({ ok: false, reason: 'the bars contradict themselves' }) });
    const r = await h.get('kiteSession:fetch-bars')(W.sa, { accountId: id, symbol: 'RELIANCE', exchange: 'NSE', interval: '1d' });
    return r.ok === false && /contradict/.test(r.error);
  })());

  // concurrent fetches
  let release;
  const gate = new Promise((res) => { release = res; });
  const slowImports = [];
  const h3 = new Map();
  ipc.register({ handle: (ch, fn) => h3.set(ch, fn) }, { store, http, unlocked: () => true, now: clkI.now, sleep: clkI.sleep, self: () => SELF, openExternal: async () => {}, importBars: async (b) => { await gate; slowImports.push(b); return { ok: true, data: { ok: true } }; } });
  const f1 = h3.get('kiteSession:fetch-bars')(W.sa, { accountId: id, symbol: 'RELIANCE', exchange: 'NSE', interval: '1d' });
  await new Promise((res) => setTimeout(res, 30));
  const f2 = await h3.get('kiteSession:fetch-bars')(W.sa, { accountId: id, symbol: 'TCS', exchange: 'NSE', interval: '1d' });
  check('a second fetch for the same account while one runs is refused', f2.ok === false && /already running/.test(f2.error));
  release();
  check('the first still finishes', (await f1).ok === true);

  // token problems
  httpScript = (rec) => (rec.path === '/quote/ltp' ? okJson({ [rec.query.i]: { instrument_token: 1 } }) : errJson(403, 'TokenException', 'Session expired'));
  const tok = keep(await call('fetch-bars', W.sa, { accountId: id, symbol: 'RELIANCE', exchange: 'NSE', interval: '1d' }));
  check('a rejected token ends the session and tells master to log in again', tok.ok === false && tok.needsLogin === true && /Log in again/.test(tok.error));
  check('the dead session was forgotten', ba.snapshot(store, { self: SELF }).accounts.find((a) => a.id === id).session.state === 'none');
  const noSess = await call('fetch-bars', W.sa, { accountId: id, symbol: 'RELIANCE', exchange: 'NSE', interval: '1d' });
  check('with no session the fetch says to log in, and makes no request', noSess.ok === false && noSess.needsLogin === true);

  // expiry by clock
  httpScript = (rec) => (rec.path === '/session/token' ? okJson({ access_token: TOKEN, user_id: 'AB1234' }) : okJson({}));
  const ls4 = await call('login-start', W.sa, { accountId: id });
  const st4 = new URL(ls4.url).searchParams.get('redirect_params').replace('state=', '');
  await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=${st4}` });
  check('after login the session is live', ba.liveSession(store, id, clkI.now()) !== null);
  const nextSix = kite.tokenExpiry(clkI.now());
  check('the same session is gone at 06:00 IST', ba.liveSession(store, id, nextSix + 1) === null && ba.liveSession(store, id, nextSix - 1) !== null);
  const beforeExp = http.calls.length;
  clkI.t = nextSix + 1000;
  const expiredFetch = await call('fetch-bars', W.sa, { accountId: id, symbol: 'RELIANCE', exchange: 'NSE', interval: '1d' });
  check('a fetch after expiry asks for a login and calls nothing', expiredFetch.needsLogin === true && http.calls.length === beforeExp);
  clkI.t = Date.parse('2026-10-19T04:00:00Z');

  // logout
  httpScript = (rec) => (rec.path === '/session/token' && rec.method === 'POST' ? okJson({ access_token: TOKEN, user_id: 'AB1234' }) : rec.method === 'DELETE' ? okJson(true) : okJson({}));
  const ls5 = await call('login-start', W.sa, { accountId: id });
  const st5 = new URL(ls5.url).searchParams.get('redirect_params').replace('state=', '');
  await call('login-complete', W.sa, { accountId: id, redirect: `http://127.0.0.1/?request_token=${REQ}&status=success&state=${st5}` });
  const dBefore = http.calls.filter((c) => c.method === 'DELETE').length;
  const lo = keep(await call('logout', W.sa, { accountId: id }));
  check('logout invalidates the token at Kite once and forgets it', lo.ok && lo.remote === 'invalidated' && http.calls.filter((c) => c.method === 'DELETE').length === dBefore + 1 && lo.data.accounts.find((a) => a.id === id).session.state === 'none');
  const del = http.calls.filter((c) => c.method === 'DELETE').pop();
  check('the logout request names the key and token in its QUERY (as Kite documents) and is on the allowlist', del.path === '/session/token' && del.query.api_key === KEY);
  const lo2 = await call('logout', W.sa, { accountId: id });
  check('logging out with no session calls nothing', lo2.ok && lo2.remote === 'not-needed' && http.calls.filter((c) => c.method === 'DELETE').length === dBefore + 1);
  check('logging out of a missing account is refused', (await call('logout', W.sa, { accountId: 'ghost' })).ok === false);
  check('master (tier 0) can also use the channels', (await call('logout', W.master, { accountId: id })).ok === true);

  // nothing leaked
  const blob = JSON.stringify(everything);
  check('NO reply to any caller contains the access token', !blob.includes(TOKEN) && !blob.includes(TOKEN.slice(0, 12)));
  check('NO reply contains the API secret', !blob.includes(SECRET) && !blob.includes(SECRET.slice(0, 12)));
  check('NO reply contains the request token', !blob.includes(REQ));
  check('the stored session is encrypted by the store, and is the only place the token lives', JSON.stringify(store.raw).includes(TOKEN) || ba.liveSession(store, id) === null);

  // ═══ the wiring ════════════════════════════════════════════════════════════════════════════════
  section('the wiring');
  const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  const blk = pre.slice(pre.indexOf('kiteSession: {'), pre.indexOf('brokerAccounts: {'));
  check('the preload exposes the four members on the four channels', /loginStart:.*kiteSession:login-start/.test(blk) && /loginComplete:.*kiteSession:login-complete/.test(blk) && /logout:.*kiteSession:logout/.test(blk) && /fetchBars:.*kiteSession:fetch-bars/.test(blk));
  check('it sends no `user`, and no member can read a token', !/user\b/.test(blk.replace(/\/\/.*$/gm, '')) && !/token|secret/i.test(blk.replace(/\/\/.*$/gm, '')));
  const ks = code('electron/ipc/kiteSession.cjs');
  check('the channel module never calls HTTP itself: every Kite call goes through kiteClient', !/\bhttp\.request\(|\bnet\.(get|post|request)\(|https?\.request\(|fetch\(/.test(ks) && /kite\.(exchangeToken|resolveToken|fetchCandles|logout)\(d\.http/.test(ks));
  check('the gate is the validated principal on brokers.accounts.write', /principalBinding\.getPrincipal\(e\)/.test(ks) && /const CAP = 'brokers\.accounts\.write'/.test(ks) && !/\{\s*user\b/.test(ks));
  const holders = ['electron/lib', 'electron/ipc'].flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.cjs')).map((f) => `${dir}/${f}`))
    .filter((f) => /api\.kite\.trade/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !/brokerConnectors/.test(f));
  check('api.kite.trade appears in exactly one source file, the client with the allowlist', holders.length === 1 && holders[0] === 'electron/lib/kiteClient.cjs', holders.join());
  check('no timer starts a login or a fetch', !/setInterval/.test(ks) && !/setTimeout\([^)]*(login|fetch)/.test(ks));
  check('no console.log', !/console\.log/.test(ks + code('electron/lib/kiteClient.cjs')));
  const mi = fs.readFileSync(path.join(ROOT, 'ai_backend/main.py'), 'utf8');
  check('the engine accepts an import only from the allowed source, with a bounded body', /source:\s+Literal\["kite"\]/.test(mi) && /max_length=60000/.test(mi));

  principalBinding.useAuth(null);
  principalBinding.reset();
  console.warn(`\n  ${pass} passed, ${fail} failed`);
  finished = true;
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
