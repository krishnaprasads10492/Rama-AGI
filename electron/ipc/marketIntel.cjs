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
}

module.exports = { register, predict, backtest, backtestPresets, strategyScore, health };
