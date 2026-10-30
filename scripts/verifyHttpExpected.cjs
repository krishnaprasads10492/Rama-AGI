'use strict';
/**
 * verifyHttpExpected.cjs - a correct answer is not a transport failure (spec Section 160.3, D1)
 *
 * The shared client's circuit breaker exists to stop hammering an origin that is in trouble. It counted EVERY
 * non-2xx as trouble, including 401 ("this token is no good") and 404 ("this token cannot see that repository"),
 * which are accurate replies from a perfectly healthy GitHub. Four of them in a row opened a 20-second local
 * blackout, and the client then answered 503 itself - which is what let a dead token displace a working one
 * (Section 160.1, item 1).
 *
 * No network: `https.request` is replaced for the duration, so the breaker's accounting is driven directly. Each
 * scenario uses its own hostname, because the breaker is keyed by origin.
 *
 * Run: node scripts/verifyHttpExpected.cjs   (or npm run verify:http-expected)
 */
const path = require('path');
const { EventEmitter } = require('events');
const https = require('https');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
const realRequest = https.request;
process.on('exit', () => {
  https.request = realRequest;
  if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; }
});

// ── the socket, replaced ─────────────────────────────────────────────────────────────────────────
let nextStatus = 200;
let served = 0;
https.request = (opts, cb) => {
  served += 1;
  const status = nextStatus;
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.write = () => {};
  req.destroy = () => {};
  req.end = () => {
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = { 'x-from': 'stub' };
      cb(res);
      res.emit('end');
    });
  };
  return req;
};

const http = require(path.join(ROOT, 'electron/lib/http.cjs'));
let host = 0;
const nextHost = () => `https://origin-${++host}.invalid/x`;

(async () => {
  console.warn('\nthe shared client - an expected status is not a transport failure\n');

  section('a listed status never trips the breaker');
  {
    const url = nextHost();
    served = 0;
    nextStatus = 401;
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push(await http.request(url, { retries: 0, expectStatuses: [401] }));
    check('six 401s in a row all reach the origin', served === 6);
    check('none of them is a local refusal', seen.every((r) => !r.circuitOpen && r.status === 401));
    check('and a 401 is still NOT ok (the status means the same as before)', seen.every((r) => r.ok === false));
    check('the body and headers still come back', seen[0].headers && seen[0].headers['x-from'] === 'stub');
  }

  section('an UNLISTED status still trips it, exactly as before');
  {
    const url = nextHost();
    served = 0;
    nextStatus = 401;
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push(await http.request(url, { retries: 0 }));
    check('the origin is asked four times and then no more', served === 4);
    check('the fifth and sixth are refused locally', seen[4].circuitOpen === true && seen[5].circuitOpen === true);
    check('and say so with a flag, not only a message', seen[4].status === 503 && /Circuit open/.test(seen[4].error));
    check('the first four were real answers', seen.slice(0, 4).every((r) => r.status === 401 && !r.circuitOpen));
  }

  section('what the breaker is for still works');
  {
    const url = nextHost();
    served = 0;
    nextStatus = 500;
    const seen = [];
    // A 5xx is origin trouble even when a 401 is expected: `expectStatuses` protects only what it names.
    for (let i = 0; i < 6; i++) seen.push(await http.request(url, { retries: 0, expectStatuses: [401, 404] }));
    check('a 500 is not protected by a list that does not name it', served < 6 && seen.some((r) => r.circuitOpen === true));
  }
  {
    const url = nextHost();
    served = 0;
    for (let i = 0; i < 3; i++) { nextStatus = 401; await http.request(url, { retries: 0 }); }
    nextStatus = 200;
    const good = await http.request(url, { retries: 0 });
    check('a success clears the count', good.ok === true);
    nextStatus = 401;
    const after = [];
    for (let i = 0; i < 3; i++) after.push(await http.request(url, { retries: 0 }));
    check('so three more failures do not open it', after.every((r) => !r.circuitOpen));
  }

  section('a malformed list is treated as no list, never a crash');
  for (const bad of [null, undefined, 'four-oh-one', 401, {}, [], [null]]) {
    const url = nextHost();
    served = 0;
    nextStatus = 401;
    let threw = false;
    let last = null;
    try { for (let i = 0; i < 5; i++) last = await http.request(url, { retries: 0, expectStatuses: bad }); }
    catch { threw = true; }
    check(`expectStatuses = ${JSON.stringify(bad)} does not throw and still answers`, !threw && last !== null);
  }

  section('the option is opt-in: nothing else changed');
  {
    const url = nextHost();
    nextStatus = 200;
    const r = await http.request(url, { retries: 0 });
    check('a 2xx is ok with no option passed', r.ok === true && r.status === 200 && !r.circuitOpen);
    const src = require('fs').readFileSync(path.join(ROOT, 'electron/lib/http.cjs'), 'utf8');
    check('the default is empty, so every existing caller behaves as it did', /expectStatuses = \[\]/.test(src));
    check('only the listed statuses skip the failure count', /else if \(!expected\(result\.status\)\) recordFail\(origin\)/.test(src));
    check('a success and a thrown request still record as before', /if \(result\.status >= 200 && result\.status < 400\) recordOk\(origin\)/.test(src) && /catch \(err\) \{\s*recordFail\(origin\)/.test(src));
    check('there is still ONE client and ONE breaker (I9): no second map, no second request function', (src.match(/const circuits = new Map\(\)/g) || []).length === 1 && (src.match(/^async function request\(/gm) || []).length === 1);
    check('the count is only cleared after a real open window, so it can reach the threshold at all',
      /if \(c\.openUntil > 0\) circuits\.delete\(origin\)/.test(src) && !/if \(c\.openUntil > Date\.now\(\)\) return true;\s*\n\s*circuits\.delete\(origin\);/.test(src));
    check('the documented threshold and window are unchanged', /CIRCUIT_THRESHOLD = 4/.test(src) && /CIRCUIT_OPEN_MS   = 20000/.test(src));
    check('no console.log', !/console\.log/.test(src));
  }

  section('it asks only for what it can read (Section 165)');
  {
    const h = require('fs').readFileSync(path.join(ROOT, 'electron/lib/http.cjs'), 'utf8');
    check('this client decompresses nothing: no zlib, no brotli decoder', !/require\('zlib'\)|createBrotliDecompress|createGunzip|createUnzip/.test(h));
    check('so the human profile asks for identity', /'Accept-Encoding': 'identity'/.test(h));
    check('and nothing in it advertises gzip, deflate or brotli', !/Accept-Encoding['"]?\s*:\s*['"][^'"]*(gzip|deflate|br)\b/.test(h));
    check('the plain profile still sends no Accept-Encoding at all, so it is served identity by default', (() => {
      const i = h.indexOf('function ramaHeaders()');
      const j = h.indexOf('}', i);
      return i > 0 && !h.slice(i, j).includes('Accept-Encoding');
    })());
    check('the reason is recorded where the header is, not only in the spec', /CVE-2026-111497/.test(h));
  }

  https.request = realRequest;
  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { https.request = realRequest; console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
