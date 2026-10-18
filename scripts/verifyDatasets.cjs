'use strict';
/**
 * verifyDatasets.cjs - the main-process half of named candle snapshots (spec Section 153)
 *
 * The Python half is proved by `python -m tests.test_datasets` and `tests.test_store_persist`. This proves the
 * bridge between the window and that backend, with the HTTP client and the process manager stubbed so nothing
 * is started or contacted:
 *
 *   - every dataset channel is registered, on the right gate
 *       reads   (list, load)      stockmind.view
 *       writes  (save, delete)    stockmind.request
 *   - an anonymous caller and a tier below the gate are refused BEFORE the backend is touched
 *   - `persist` reaches the engine only as the boolean false; anything else leaves the default alone
 *   - only the declared save fields are forwarded, and bars never travel: the engine rebuilds the snapshot
 *   - a name is checked against the grammar in the bridge too, so a hostile one never reaches a URL or a body
 *   - booleans that change stored state (overwrite, sync) are true only for the boolean true
 *   - the preload exposes exactly these members, each on the channel the main process registers
 *   - no timer and no trading word in the dataset code
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
// ── stubs: the HTTP client and the process manager ───────────────────────────────────────────────
const sent = [];
const httpStub = {
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
async function call(channel, user, args) {
  sent.length = 0;
  const h = handlers.get(channel);
  return { res: await h({}, user === null ? { ...args } : { user, ...args }), sent: sent.slice() };
}
const GOOD = 'NIFTY50.NSE.1d.20261004.pre-budget';
(async () => {
  console.warn('\ndatasets - the bridge between the window and the snapshot store\n');

  console.warn('--- channels and gates ---');
  const writes = ['market:dataset-save', 'market:dataset-delete'];
  const reads = ['market:dataset-list', 'market:dataset-load'];
  check('every dataset channel is registered', [...writes, ...reads].every((c) => handlers.has(c)));
  for (const ch of writes) {
    const anon = await call(ch, null, { symbol: 'X', label: 'a', name: GOOD });
    const view = await call(ch, VIEWER, { symbol: 'X', label: 'a', name: GOOD });
    check(`${ch}: an anonymous caller is refused and the engine is not touched`, anon.res.ok === false && anon.sent.length === 0);
    check(`${ch}: a viewer (view but not request) is refused and the engine is not touched`,
      view.res.ok === false && /not available/.test(view.res.error || '') && view.sent.length === 0, JSON.stringify(view.res));
  }
  for (const ch of reads) {
    const anon = await call(ch, null, { name: GOOD });
    const view = await call(ch, VIEWER, { name: GOOD });
    check(`${ch}: an anonymous caller is refused`, anon.res.ok === false && anon.sent.length === 0);
    check(`${ch}: a viewer may read`, view.res.ok === true && view.sent.length === 1, JSON.stringify(view.res));
  }

  console.warn('\n--- persist: only the boolean false asks for a view-only fetch ---');
  const urlFor = async (extra) => (await call('market:ohlcv', VIEWER, { symbol: 'nifty50', sync: true, ...extra })).sent[0].url;
  check('persist:false adds persist=false', /[?&]persist=false(&|$)/.test(await urlFor({ persist: false })));
  for (const [label, v] of [['true', true], ['the string "false"', 'false'], ['0', 0], ['null', null], ['undefined', undefined], ['"no"', 'no'], ['an object', {}]]) {
    check(`persist ${label} leaves the default alone (no persist parameter)`, !/persist/.test(await urlFor({ persist: v })));
  }
  const dflt = await urlFor({});
  check('and a call that never mentions it is exactly what it was', /\/ohlcv\/NIFTY50\?exchange=NSE&interval=1d&limit=240&sync=true$/.test(dflt), dflt);
  const sy = (await call('market:ohlcv', VIEWER, { symbol: 'X', sync: true, persist: false })).sent[0];
  check('a sync still gets the long budget', sy.opts.timeout === 90000);

  console.warn('\n--- save: what is forwarded ---');
  const sv = await call('market:dataset-save', MASTER, {
    symbol: 'NIFTY50', exchange: 'NSE', interval: '1d', label: 'pre-budget', name: GOOD, fromDate: '2026-01-01', toDate: '2026-02-01',
    limit: 99999, note: 'n'.repeat(900), overwrite: true, sync: true, expectBars: 120,
    bars: [{ date: '2026-01-01', close: 1 }], shell: 'rm -rf /', spec: { evil: true }, persist: true, user2: 'x', path: '../../x', __proto__x: 1,
  });
  const b = sv.sent[0] && sv.sent[0].body;
  check('save posts to /dataset/save', sv.sent[0] && /\/dataset\/save$/.test(sv.sent[0].url));
  check('it forwards the declared fields', b && b.symbol === 'NIFTY50' && b.name === GOOD && b.label === 'pre-budget' && b.fromDate === '2026-01-01' && b.toDate === '2026-02-01', JSON.stringify(b));
  check('and NOTHING else: no field the route does not declare reaches it',
    b && !('shell' in b) && !('spec' in b) && !('user2' in b) && !('path' in b) && !('__proto__x' in b) && !('user' in b) && !('persist' in b), JSON.stringify(b));
  check('BARS NEVER TRAVEL: the engine rebuilds the snapshot from its own data', b && !('bars' in b));
  check('the limit is clamped to what the chart can draw', b && b.limit === 20000, String(b && b.limit));
  check('the note is bounded', b && b.note.length === 300);
  check('overwrite and sync are carried when they are the boolean true', b && b.overwrite === true && b.sync === true);
  check('expectBars travels as a whole number', b && b.expectBars === 120);
  check('a save has a budget for a view-only re-read', sv.sent[0].opts.timeout === 120000);
  const sv2 = await call('market:dataset-save', MASTER, { symbol: 'NIFTY50', label: 'ok', overwrite: 'true', sync: 1, expectBars: '5', fromDate: '01/02/2026', toDate: '2026-02-30x' });
  const b2 = sv2.sent[0].body;
  check('overwrite is true only for the boolean true: the string "true" cannot overwrite a dataset', b2.overwrite === false);
  check('sync is true only for the boolean true', b2.sync === false);
  check('a non-integer expectBars is dropped', !('expectBars' in b2));
  check('a malformed date is dropped, not forwarded', !('fromDate' in b2) && !('toDate' in b2), JSON.stringify(b2));
  check('without a view-only re-read the budget is the short one', sv2.sent[0].opts.timeout === 60000);
  const sv3 = await call('market:dataset-save', MASTER, { symbol: 'X', label: 'ok', limit: 'many' });
  check('a limit that is not a number falls back to the ceiling', sv3.sent[0].body.limit === 20000);
  check('save without a symbol is refused in the bridge', (await call('market:dataset-save', MASTER, { label: 'a' })).sent.length === 0);

  console.warn('\n--- names and labels are checked here too ---');
  const hostile = ['../x', '..\\x', 'a b', 'NIFTY 50.NSE.1d.20261004.x', 'NIFTY50.N SE.1d.20261004.x', 'NIFTY50.NSE.1 d.20261004.x',
    'NIFTY50.NSE.1d.2026 004.x', 'NIFTY50.NSE.1d.20261004.x y', `${GOOD}/x`, `${GOOD}\\x`, 'NIFTY50.NSE.1d.20261004.x\n', 'NIFTY50.NSE.1d.20261004.\u00e9t\u00e9',
    "NIFTY50.NSE.1d.20261004.x'; DROP TABLE datasets;--", 'NIFTY50.NSE.1d.20261004.', 'nifty50.NSE.1d.20261004.x', 'NIFTY50.NSE.1D.20261004.x',
    'NIFTY50.NSE.1d.20261004.' + 'a'.repeat(41), '', 5, null, ['a'], { toString: () => GOOD }, 'C:\\x', '/etc/passwd'];
  let leaked = 0;
  let accepted = 0;
  for (const h of hostile) {
    for (const [ch, args] of [['market:dataset-load', { name: h }], ['market:dataset-delete', { name: h }], ['market:dataset-save', { symbol: 'NIFTY50', name: h }]]) {
      const r = await call(ch, MASTER, args);
      leaked += r.sent.length;
      if (r.res && r.res.ok !== false) accepted += 1;
    }
  }
  check('a hostile name never reaches the engine, on load, delete or save', leaked === 0, String(leaked));
  check('and every one of them is answered with a refusal, not a pass-through', accepted === 0, String(accepted));
  const badLabel = await call('market:dataset-save', MASTER, { symbol: 'X', label: 'has space' });
  check('a label outside [A-Za-z0-9_-] is refused', badLabel.sent.length === 0 && badLabel.res.ok === false);
  check('so is a 41-character label', (await call('market:dataset-save', MASTER, { symbol: 'X', label: 'a'.repeat(41) })).sent.length === 0);
  check('a 40-character label passes', (await call('market:dataset-save', MASTER, { symbol: 'X', label: 'a'.repeat(40) })).sent.length === 1);
  const ld = await call('market:dataset-load', VIEWER, { name: GOOD });
  check('a good name loads from /dataset/<name>', ld.sent[0] && ld.sent[0].method === 'GET' && ld.sent[0].url.endsWith(`/dataset/${GOOD}`), JSON.stringify(ld.sent[0]));
  const dl = await call('market:dataset-delete', MASTER, { name: GOOD });
  check('a good name deletes through /dataset/delete with the name in the body', dl.sent[0] && /\/dataset\/delete$/.test(dl.sent[0].url) && dl.sent[0].body.name === GOOD && Object.keys(dl.sent[0].body).length === 1);
  const ls = await call('market:dataset-list', VIEWER, {});
  check('list reads /dataset/list', ls.sent[0] && ls.sent[0].url.endsWith('/dataset/list'));

  console.warn('\n--- the preload exposes the same channels ---');
  const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  const members = {
    datasetList: 'market:dataset-list', datasetLoad: 'market:dataset-load',
    datasetSave: 'market:dataset-save', datasetDelete: 'market:dataset-delete',
  };
  for (const [m, ch] of Object.entries(members)) {
    check(`preload ${m} -> ${ch}`, new RegExp(`${m}:\\s*\\(opts\\)\\s*=>\\s*ipcRenderer\\.invoke\\('${ch}'`).test(pre) && handlers.has(ch));
  }
  const exportsOk = ['datasetList', 'datasetLoad', 'datasetSave', 'datasetDelete'].every((n) => typeof mi[n] === 'function');
  check('the four functions are exported from the module', exportsOk);

  console.warn('\n--- gates in source, no timer, no trading word ---');
  const src = fs.readFileSync(path.join(ROOT, 'electron/ipc/marketIntel.cjs'), 'utf8');
  check('save is registered explicitly on stockmind.request',
    /ipcMain\.handle\('market:dataset-save'[\s\S]{0,200}?denyUnless\(user, 'stockmind\.request'\)/.test(src));
  check('delete is registered explicitly on stockmind.request',
    /ipcMain\.handle\('market:dataset-delete'[\s\S]{0,200}?denyUnless\(user, 'stockmind\.request'\)/.test(src));
  const readTable = src.slice(src.indexOf('const readOnly = {'), src.indexOf('};', src.indexOf('const readOnly = {')));
  check('list and load sit in the read-only table (stockmind.view)', /'market:dataset-list':\s+datasetList/.test(readTable) && /'market:dataset-load':\s+datasetLoad/.test(readTable));
  check('and the writes are NOT in the read-only table', !/dataset-save|dataset-delete/.test(readTable));
  const a = src.indexOf('Named candle snapshots (Section 153)');
  const section = src.slice(a, src.indexOf('// Macro transmission (Section 114)')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('the dataset section was found', section.length > 600, String(section.length));
  check('no timer in the dataset code', !/setInterval|setTimeout|schedule/i.test(section));
  check('no trading word in the dataset code', !/\b(buy|sell|order|broker)\b/i.test(section));
  check('and the code never sends a bars field', !/bars\s*:/.test(section));

  console.warn(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
