'use strict';

/**
 * verifyStrategyBook.cjs - the main-process half of the strategy book (spec Section 151)
 *
 * The Python half is proved by `npm run verify:strategy`. This proves the bridge between the window and that
 * backend, with the HTTP client and the process manager stubbed so nothing is started or contacted:
 *
 *   - every book channel is registered, on the right gate
 *       reads   (list, signals)                                  stockmind.view
 *       writes  (evolve, keep, refresh, retire, restore, remove) stockmind.request
 *   - an anonymous caller and a tier below the gate are refused BEFORE the backend is touched
 *   - only the fields the backend route declares are forwarded (nothing else reaches the route)
 *   - required fields are checked in the bridge, not left for the backend to trip over
 *   - the long-running calls carry long timeouts, and the quick ones do not
 *   - the preload exposes exactly these members, each on the channel the main process registers
 *   - no book channel orders anything and no code here schedules a refresh
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

// ── stubs: the HTTP client and the process manager ───────────────────────────────────────────────
const sent = [];
const httpStub = {
  // The readiness poll is not part of what is being measured, so it is answered and not recorded.
  getJson: async (url, opts) => { if (!/\/health$/.test(url)) sent.push({ method: 'GET', url, opts }); return { fake: true }; },
  postJson: async (url, body, opts) => { sent.push({ method: 'POST', url, body, opts }); return { fake: true }; },
  delay: async () => {},
};
const procStub = { getRunningStatus: async () => ({ python: { running: true } }), startPythonBackendPublic: async () => ({ ok: true }) };

const libHttp = require.resolve(path.join(ROOT, 'electron/lib/http.cjs'));
const proc = require.resolve(path.join(ROOT, 'electron/ipc/aiProcess.cjs'));
require.cache[libHttp] = { id: libHttp, filename: libHttp, loaded: true, exports: httpStub };
require.cache[proc] = { id: proc, filename: proc, loaded: true, exports: procStub };

const mi = require(path.join(ROOT, 'electron/ipc/marketIntel.cjs'));

const handlers = new Map();
mi.register({ handle: (ch, fn) => handlers.set(ch, fn), handleOnce: (ch, fn) => handlers.set(ch, fn) });

const MASTER = { username: 'master', tier: 1 };
const VIEWER = { username: 'v', tier: 4 };       // stockmind.view (4) but not stockmind.request (3)
const NOBODY = null;

async function call(channel, user, args) {
  sent.length = 0;
  const h = handlers.get(channel);
  return { res: await h({}, user === null ? { ...args } : { user, ...args }), sent: sent.slice() };
}

(async () => {
  console.warn('\nstrategy book - the bridge between the window and the engine\n');

  console.warn('--- channels and gates ---');
  const writes = ['market:strategy-evolve', 'market:book-keep', 'market:book-refresh', 'market:book-retire', 'market:book-restore', 'market:book-remove'];
  const reads = ['market:book-list', 'market:book-signals'];
  check('every book channel is registered', [...writes, ...reads].every((c) => handlers.has(c)));

  for (const ch of writes) {
    const anon = await call(ch, NOBODY, { symbol: 'X', runId: 'r', id: 'i' });
    const view = await call(ch, VIEWER, { symbol: 'X', runId: 'r', id: 'i' });
    check(`${ch}: an anonymous caller is refused and the engine is not touched`, anon.res.ok === false && anon.sent.length === 0);
    check(`${ch}: a viewer (view but not request) is refused and the engine is not touched`,
      view.res.ok === false && /not available/.test(view.res.error || '') && view.sent.length === 0, JSON.stringify(view.res));
  }
  for (const ch of reads) {
    const anon = await call(ch, NOBODY, {});
    const view = await call(ch, VIEWER, {});
    check(`${ch}: an anonymous caller is refused`, anon.res.ok === false && anon.sent.length === 0);
    check(`${ch}: a viewer may read`, view.res.ok === true && view.sent.length === 1);
  }

  console.warn('\n--- what is forwarded ---');
  const ev = await call('market:strategy-evolve', MASTER, {
    symbol: 'RELIANCE', exchange: 'NSE', interval: '1d', capital: 200000, riskPct: 1, side: 'long', explore: 'wider',
    folds: 5, templates: ['livermore_breakout'], __proto__x: 1, shell: 'rm -rf /', spec: { evil: true }, sweep: { a: 1 },
  });
  const evb = ev.sent[0] && ev.sent[0].body;
  check('evolve posts to /strategy/evolve', ev.sent[0] && /\/strategy\/evolve$/.test(ev.sent[0].url));
  check('it forwards the declared fields', evb && evb.symbol === 'RELIANCE' && evb.capital === 200000 && evb.explore === 'wider' && evb.templates[0] === 'livermore_breakout');
  check('and NOTHING else: no field the route does not declare reaches it',
    evb && !('shell' in evb) && !('spec' in evb) && !('sweep' in evb) && !('__proto__x' in evb) && !('user' in evb), JSON.stringify(evb));
  check('evolve has a long timeout (minutes of work)', ev.sent[0].opts.timeout >= 600000, String(ev.sent[0].opts.timeout));
  const noSym = await call('market:strategy-evolve', MASTER, {});
  check('evolve without a symbol is refused in the bridge', noSym.res.ok === false && noSym.sent.length === 0);

  const kp = await call('market:book-keep', MASTER, { runId: 'abc', demonstrated: true, ids: ['x', 5], trust: 'me' });
  check('keep posts the run id, the ids as strings and the flag', kp.sent[0].body.runId === 'abc' && kp.sent[0].body.demonstrated === true &&
    JSON.stringify(kp.sent[0].body.ids) === JSON.stringify(['x', '5']));
  check('keep forwards nothing about verdict or rows: the backend reads rows from its own cache',
    !('rows' in kp.sent[0].body) && !('verdictClass' in kp.sent[0].body) && !('trust' in kp.sent[0].body));
  const kp2 = await call('market:book-keep', MASTER, { runId: 'abc', demonstrated: 'yes' });
  check('`demonstrated` is true only for the boolean true', kp2.sent[0].body.demonstrated === false);
  check('keep without a run id is refused in the bridge', (await call('market:book-keep', MASTER, {})).res.ok === false);

  const rf = await call('market:book-refresh', MASTER, {});
  check('refresh defaults to ONLY the stale ones', rf.sent[0].body.onlyStale === true && !('ids' in rf.sent[0].body));
  const rf2 = await call('market:book-refresh', MASTER, { ids: ['a'], onlyStale: false });
  check('a named refresh can force', rf2.sent[0].body.onlyStale === false && rf2.sent[0].body.ids[0] === 'a');

  for (const [ch, p] of [['market:book-retire', 'retire'], ['market:book-restore', 'restore'], ['market:book-remove', 'remove']]) {
    const r = await call(ch, MASTER, { id: 'sid1', reason: 'x'.repeat(500) });
    check(`${ch} posts to /strategy/book/${p} with the id`, r.sent[0] && r.sent[0].url.endsWith(`/strategy/book/${p}`) && r.sent[0].body.id === 'sid1');
    check(`${ch}: the free-text reason is bounded`, r.sent[0].body.reason.length <= 300);
    check(`${ch} without an id is refused in the bridge`, (await call(ch, MASTER, {})).res.ok === false);
  }

  const ls = await call('market:book-list', VIEWER, { includeRetired: 'true' });
  check('list sends includeRetired only for the boolean true', /includeRetired=false/.test(ls.sent[0].url));
  const ls2 = await call('market:book-list', VIEWER, { includeRetired: true });
  check('and true when it is true', /includeRetired=true/.test(ls2.sent[0].url));
  const sg = await call('market:book-signals', VIEWER, {});
  check('signals reads /strategy/book/signals', /\/strategy\/book\/signals$/.test(sg.sent[0].url));

  console.warn('\n--- the preload exposes the same channels ---');
  const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  const members = {
    strategyEvolve: 'market:strategy-evolve', bookList: 'market:book-list', bookSignals: 'market:book-signals',
    bookKeep: 'market:book-keep', bookRefresh: 'market:book-refresh', bookRetire: 'market:book-retire',
    bookRestore: 'market:book-restore', bookRemove: 'market:book-remove',
  };
  for (const [m, ch] of Object.entries(members)) {
    check(`preload ${m} -> ${ch}`, new RegExp(`${m}:\\s*\\(opts\\)\\s*=>\\s*ipcRenderer\\.invoke\\('${ch}'`).test(pre) && handlers.has(ch));
  }

  console.warn('\n--- no order, no timer ---');
  const src = fs.readFileSync(path.join(ROOT, 'electron/ipc/marketIntel.cjs'), 'utf8');
  const a = src.indexOf('The strategy book (Section 151)');
  // Code only: the comments say "nothing here places an order", which is the claim, not a call.
  const section = src.slice(a, src.indexOf('async function costsRegistry')).split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('the book bridge has no order or broker call', !/order|broker|placeOrder|\/orders?\b/i.test(section));
  check('and no timer: no setInterval, no setTimeout, no scheduler', !/setInterval|setTimeout|schedule/i.test(section));

  console.warn(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
