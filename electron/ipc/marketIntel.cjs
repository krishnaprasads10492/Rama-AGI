'use strict';

/**
 * marketIntel.cjs — IPC surface for the absorbed StockMind prediction engine.
 *
 * WHAT THIS IS: the renderer-facing bridge to the Python FastAPI backend in
 * `ai_backend/` (absorbed from StockMind AI — see RAMA_AGI_MASTER_SPEC.md
 * Section 39: "absorb the engine, not the app"). This file adds no new HTTP
 * client (invariant I9 — `lib/http.cjs` is the one main-process client) and
 * no new process-spawn mechanism (`aiProcess.cjs`, built ahead of this task,
 * already owns starting/stopping the Python process).
 *
 * Every handler here:
 *   1. gates on `stockmind.*` from shared/capabilities.json via capability.cjs
 *      (deny-by-default — an unknown/missing user is refused, matching
 *      releaseChannel.cjs's pattern),
 *   2. ensures the backend is running (auto-starts it on first use so master
 *      never has to remember a separate "start backend" step),
 *   3. calls it through lib/http.cjs's postJson/getJson — the same client
 *      every other engine in this project uses.
 *
 * This process has no auth of its own (it is a pure function of
 * (symbol, OHLCV, capital, risk%) -> signals), so it is not a second
 * identity system — invariants I1-I5 are untouched by this file.
 */

const net        = require('../lib/http.cjs');
const capability = require('../lib/capability.cjs');
const aiProcess  = require('./aiProcess.cjs');

const PYTHON_PORT = process.env.STOCKMIND_PYTHON_PORT || '8001';
const BASE_URL    = `http://127.0.0.1:${PYTHON_PORT}`;

// ─── Backend lifecycle ────────────────────────────────────────────────────────
/**
 * Ensure the Python backend is up before calling it. Auto-starts it on first
 * use rather than requiring a separate action from master. Polls /health for
 * up to ~8s after spawning, since uvicorn needs a moment to bind the port.
 */
async function ensureBackendRunning() {
  const status = await aiProcess.getRunningStatus?.();
  const alreadyRunning = status?.python?.running;

  if (!alreadyRunning) {
    const started = await aiProcess.startPythonBackendPublic?.();
    if (started && started.ok === false) {
      return { ok: false, error: started.error || 'Could not start ai_backend' };
    }
  }

  // Poll /health — covers both "just spawned" and "already running but not
  // yet answering" (e.g. still importing the ensemble models).
  const deadline = Date.now() + 8000;
  let lastError = 'Backend did not respond to /health';
  while (Date.now() < deadline) {
    const res = await net.getJson(`${BASE_URL}/health`, { timeout: 1500, retries: 0 });
    if (!res.error) return { ok: true };
    lastError = res.error;
    await net.delay(400);
  }
  return { ok: false, error: `Backend not reachable at ${BASE_URL}: ${lastError}` };
}

// ─── Capability gate ──────────────────────────────────────────────────────────
function denyUnless(user, cap) {
  if (!user || !capability.can(user, cap)) {
    const who = capability.TIER_LABELS[String(user?.tier)] ?? 'unauthenticated';
    return { ok: false, error: `Access denied: "${cap}" is not available to ${who}` };
  }
  return null;
}

// ─── Requests ─────────────────────────────────────────────────────────────────
async function predict(body) {
  const gate = await ensureBackendRunning();
  if (!gate.ok) return gate;
  const res = await net.postJson(`${BASE_URL}/predict`, body);
  return res.error ? { ok: false, error: res.error, raw: res.raw } : { ok: true, data: res };
}

async function backtest(body) {
  const gate = await ensureBackendRunning();
  if (!gate.ok) return gate;
  const res = await net.postJson(`${BASE_URL}/backtest`, body);
  return res.error ? { ok: false, error: res.error, raw: res.raw } : { ok: true, data: res };
}

async function backtestPresets() {
  const gate = await ensureBackendRunning();
  if (!gate.ok) return gate;
  const res = await net.getJson(`${BASE_URL}/backtest/presets`);
  return res.error ? { ok: false, error: res.error } : { ok: true, data: res };
}

async function strategyScore(body) {
  const gate = await ensureBackendRunning();
  if (!gate.ok) return gate;
  const res = await net.postJson(`${BASE_URL}/strategy/score`, body);
  return res.error ? { ok: false, error: res.error, raw: res.raw } : { ok: true, data: res };
}

async function health() {
  const res = await net.getJson(`${BASE_URL}/health`, { timeout: 2000, retries: 0 });
  return res.error ? { ok: false, error: res.error } : { ok: true, data: res };
}

// ─── Read-only surfaces added for the chart and the panels (Section 71) ────────
//
// One helper rather than five near-identical functions. Every one of these is a GET that
// starts the backend if needed and normalises the response the same way, and five copies of
// that would drift — the same reasoning as the single feature builder in Section 69.
//
// `encodeURIComponent` on every path segment is not decoration: the symbol comes from a text
// input the master types, and `^NSEI` or a stray slash would otherwise change which route is
// hit.
async function getPath(path, { timeout = 20000 } = {}) {
  const gate = await ensureBackendRunning();
  if (!gate.ok) return gate;
  const res = await net.getJson(`${BASE_URL}${path}`, { timeout });
  return res.error ? { ok: false, error: res.error } : { ok: true, data: res };
}

async function postPath(path, body, { timeout = 120000 } = {}) {
  const gate = await ensureBackendRunning();
  if (!gate.ok) return gate;
  const res = await net.postJson(`${BASE_URL}${path}`, body || {}, { timeout });
  return res.error ? { ok: false, error: res.error, raw: res.raw } : { ok: true, data: res };
}

const sym = (s) => encodeURIComponent(String(s || '').trim().toUpperCase());

async function ohlcv({ symbol, exchange = 'NSE', interval = '1d', limit = 240, sync = false } = {}) {
  return getPath(`/ohlcv/${sym(symbol)}?exchange=${encodeURIComponent(exchange)}`
    + `&interval=${encodeURIComponent(interval)}&limit=${Number(limit) || 240}`
    // A sync reaches out to the provider chain, so it needs a longer budget than a read.
    + `&sync=${sync ? 'true' : 'false'}`, { timeout: sync ? 90000 : 20000 });
}

async function inventory() {
  return getPath('/store/inventory');
}

async function news({ symbol, limit = 30 } = {}) {
  return getPath(`/news/${sym(symbol)}?limit=${Number(limit) || 30}`, { timeout: 45000 });
}

async function newsCoverage({ symbol, exchange = 'NSE' } = {}) {
  return getPath(`/news/coverage/${sym(symbol)}?exchange=${encodeURIComponent(exchange)}`);
}

async function derivatives({ symbol, exchange = 'NSE', history = 0 } = {}) {
  return getPath(`/derivatives/${sym(symbol)}?exchange=${encodeURIComponent(exchange)}`
    + `&history=${Number(history) || 0}`);
}

async function optionChain({ symbol, expiry = null } = {}) {
  return getPath(`/derivatives/chain/${sym(symbol)}`
    + (expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''), { timeout: 45000 });
}

async function outcomeStats({ symbol = null } = {}) {
  return getPath(`/outcomes/stats${symbol ? `?symbol=${sym(symbol)}` : ''}`);
}

async function modelsStatus() {
  return getPath('/models');
}

// ─── Register IPC ───────────────────────────────────────────────────────────
function register(ipcMain) {
  ipcMain.handle('market:predict', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.request');
    if (denied) return denied;
    try { return await predict(body); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:backtest', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.request');
    if (denied) return denied;
    try { return await backtest(body); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:backtest-presets', async (_e, { user } = {}) => {
    const denied = denyUnless(user, 'stockmind.view');
    if (denied) return denied;
    try { return await backtestPresets(); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:strategy-score', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.request');
    if (denied) return denied;
    try { return await strategyScore(body); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:health', async (_e, { user } = {}) => {
    const denied = denyUnless(user, 'stockmind.view');
    if (denied) return denied;
    try { return await health(); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Read-only surfaces (Section 71) ─────────────────────────────────────────
  //
  // All gated on `stockmind.view`, not `stockmind.request`: these read data that is already
  // held or already public, and none of them produce a trade signal. `market:ohlcv` with
  // `sync: true` is the one that reaches the network, and it still only fetches public price
  // history into the local store.
  //
  // CHANNEL PREFIX IS `market:`, NOT `stockmind:`. The `stockmind:` prefix is allowlisted in
  // preload.cjs and unused; adding it here would split one subsystem across two prefixes
  // while `marketIntel` remains the single bridge object. Ledger row 19 exists because
  // subsystems were once duplicated that way.
  const readOnly = {
    'market:ohlcv':           ohlcv,
    'market:inventory':       inventory,
    'market:news':            news,
    'market:news-coverage':   newsCoverage,
    'market:derivatives':     derivatives,
    'market:option-chain':    optionChain,
    'market:outcome-stats':   outcomeStats,
    'market:models':          modelsStatus,
  };
  for (const [channel, fn] of Object.entries(readOnly)) {
    ipcMain.handle(channel, async (_e, { user, ...args } = {}) => {
      const denied = denyUnless(user, 'stockmind.view');
      if (denied) return denied;
      try { return await fn(args); }
      catch (err) { return { ok: false, error: err.message }; }
    });
  }

  // Writing actions keep the stricter gate: they cost quota, CPU, or change stored state.
  ipcMain.handle('market:news-sync', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.request');
    if (denied) return denied;
    try { return await postPath('/news/sync', body, { timeout: 90000 }); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:resolve-outcomes', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.request');
    if (denied) return denied;
    try { return await postPath('/outcomes/resolve', body, { timeout: 120000 }); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:derivatives-sync', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.request');
    if (denied) return denied;
    try { return await postPath('/derivatives/sync', body, { timeout: 300000 }); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // Training gets the STRICTEST existing StockMind gate — `stockmind.config` (tier 2), not
  // `stockmind.request` (tier 3). It rewrites the artifacts every prediction then loads, so a
  // bad retrain changes what the whole engine answers, which is a configuration change rather
  // than a request. No new capability is invented for it: I8 says the matrix is defined once
  // in shared/capabilities.json, and this fits an entry that is already there.
  ipcMain.handle('market:train', async (_e, { user, ...body } = {}) => {
    const denied = denyUnless(user, 'stockmind.config');
    if (denied) return denied;
    try { return await postPath('/train', body, { timeout: 900000 }); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('market:scheduler-status', async (_e, { user } = {}) => {
    const denied = denyUnless(user, 'stockmind.view');
    if (denied) return denied;
    try { return { ok: true, data: schedulerStatus() }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
}

// ─── The scheduler that makes the loops actually run (Section 71) ─────────────
//
// Sections 68 and 70 both end with the same outstanding item: `/outcomes/resolve` and
// `/news/sync` exist and nothing calls them. Without a schedule, the learning loop never
// resolves a claim and the news series never accumulates a second day — both features are
// built, neither functions. Master's standing instruction is that the installed app should
// take care of itself, so this closes it here.
//
// NO CAPABILITY GATE, DELIBERATELY, AND IT IS NOT A HOLE. `denyUnless` protects the RENDERER
// boundary: it stops a low-tier UI caller reaching a privileged action. This is main-process
// housekeeping with no session behind it, calling the same read-and-store endpoints. Passing
// a fabricated user object to satisfy a gate would be the actual hole — inventing an identity
// is exactly what `server/index.cjs` was corrected for in Section 59.
//
// What it will and will not do:
//   - It only calls endpoints that read public data into the local store, plus outcome
//     resolution, which is arithmetic over bars already held.
//   - It never trains, never predicts, and never touches money or credentials.
//   - It does not start the backend. `ensureBackendRunning` would spawn Python on a timer
//     even if master never opened StockMind, which is not housekeeping, it is a decision.
//     So each tick checks whether the backend is ALREADY up and returns quietly if not.

let timers = [];
let lastRun = { resolve: null, news: null };

const SCHEDULE = {
  // Outcomes first and more often: resolution is local arithmetic over stored bars, it costs
  // nothing external, and until a claim resolves nothing can be learned from it.
  resolveEveryMs: 6 * 60 * 60 * 1000,
  // Once a day is the right cadence for news: the series is keyed by date, so a second run
  // on the same day re-fetches the same headlines and merges into the same row.
  newsEveryMs:    24 * 60 * 60 * 1000,
  // Long enough after launch that startup is finished and master's first interaction is not
  // competing with a background fetch.
  firstDelayMs:   5 * 60 * 1000,
  newsSymbols:    ['NIFTY50', 'BANKNIFTY'],
};

async function backendAlreadyUp() {
  const status = await aiProcess.getRunningStatus?.();
  if (!status?.python?.running) return false;
  const res = await net.getJson(`${BASE_URL}/health`, { timeout: 1500, retries: 0 });
  return !res.error;
}

async function tickResolveOutcomes() {
  if (!await backendAlreadyUp()) return { skipped: 'backend not running' };
  const res = await net.postJson(`${BASE_URL}/outcomes/resolve`,
    { learn: true }, { timeout: 120000 });
  lastRun.resolve = new Date().toISOString();
  if (res.error) {
    console.warn(`[marketIntel] scheduled outcome resolution failed: ${res.error}`);
    return { error: res.error };
  }
  const r = res.resolve || {};
  const l = res.learn || {};
  if (r.resolved || l.learned) {
    console.warn(`[marketIntel] resolved ${r.resolved || 0} outcome(s), learned ${l.learned || 0}`);
  }
  return { resolved: r.resolved || 0, learned: l.learned || 0 };
}

async function tickSyncNews() {
  if (!await backendAlreadyUp()) return { skipped: 'backend not running' };
  const out = [];
  for (const symbol of SCHEDULE.newsSymbols) {
    const res = await net.postJson(`${BASE_URL}/news/sync`, { symbol }, { timeout: 90000 });
    out.push(res.error ? { symbol, error: res.error } : { symbol, recorded: res.recorded });
    // Spaced so several symbols do not hit the same feeds simultaneously.
    await net.delay(2000);
  }
  lastRun.news = new Date().toISOString();
  return { symbols: out };
}

/**
 * Start the background loops. Idempotent — calling twice does not double the timers, which
 * would double every outcome's influence on the learned weights (Section 68's exactly-once
 * property protects the records, not the schedule).
 */
function startScheduler() {
  if (timers.length) return { ok: true, alreadyRunning: true };
  if (process.env.RAMA_DISABLE_MARKET_SCHEDULER === '1') {
    return { ok: true, disabled: 'RAMA_DISABLE_MARKET_SCHEDULER=1' };
  }

  const safely = (label, fn) => async () => {
    try { await fn(); }
    catch (err) { console.warn(`[marketIntel] scheduled ${label} threw: ${err.message}`); }
  };

  const kick = setTimeout(() => {
    safely('outcome resolution', tickResolveOutcomes)();
    safely('news sync', tickSyncNews)();
  }, SCHEDULE.firstDelayMs);
  // `unref` so a pending timer can never hold the app open on quit.
  kick.unref?.();

  const t1 = setInterval(safely('outcome resolution', tickResolveOutcomes), SCHEDULE.resolveEveryMs);
  const t2 = setInterval(safely('news sync', tickSyncNews), SCHEDULE.newsEveryMs);
  t1.unref?.();
  t2.unref?.();
  timers = [kick, t1, t2];

  console.warn(`[marketIntel] scheduler armed — outcomes every `
    + `${SCHEDULE.resolveEveryMs / 3600000}h, news every ${SCHEDULE.newsEveryMs / 3600000}h, `
    + `first run in ${SCHEDULE.firstDelayMs / 60000} min`);
  return { ok: true, schedule: SCHEDULE };
}

function stopScheduler() {
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  timers = [];
  return { ok: true };
}

function schedulerStatus() {
  return {
    running: timers.length > 0,
    disabled: process.env.RAMA_DISABLE_MARKET_SCHEDULER === '1',
    lastRun,
    schedule: SCHEDULE,
  };
}

module.exports = {
  register, predict, backtest, backtestPresets, strategyScore, health,
  ohlcv, inventory, news, newsCoverage, derivatives, optionChain,
  outcomeStats, modelsStatus,
  startScheduler, stopScheduler, schedulerStatus,
  tickResolveOutcomes, tickSyncNews,
};
