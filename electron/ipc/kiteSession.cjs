'use strict';

/**
 * kiteSession.cjs (IPC) - log in to Kite and pull candles into the store, DATA ONLY (spec Section 156)
 *
 * Every channel needs `brokers.accounts.write` (SuperAdmin; Master also passes), decided on the principal main
 * validated and never on a `user` the window sent. Nothing here can place an order: every Kite call goes through
 * `kiteClient.call`, whose allowlist has no order path.
 *
 *   kiteSession:login-start     returns the Kite login address (and opens it in the system browser)
 *   kiteSession:login-complete  takes the address master pasted back, checks its `state`, swaps the one-time
 *                               request_token for an access token, stores it encrypted
 *   kiteSession:logout          invalidates the token at Kite (best effort) and forgets it
 *   kiteSession:fetch-bars      candles for one instrument into the working store, through /store/import
 *
 * The access token and the API secret are used inside this module and never appear in a reply.
 */

const crypto = require('crypto');
const capability = require('../lib/capability.cjs');
const principalBinding = require('../lib/principalBinding.cjs');
const accounts = require('../lib/brokerAccounts.cjs');
const kite = require('../lib/kiteClient.cjs');

const PENDING_TTL_MS = 10 * 60 * 1000;
const CAP = 'brokers.accounts.write';

// How far back to go when master gives no start date. Short for fine intervals: a minute series is huge.
const DEFAULT_DAYS = { minute: 30, '3minute': 60, '5minute': 60, '10minute': 60, '15minute': 180, '30minute': 180, '60minute': 365, day: 3650 };

function defaults() {
  return {
    store: require('../dataStore.cjs'),
    http: require('../lib/http.cjs'),
    unlocked: () => require('../cryptoCore.cjs').isUnlocked(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    self: () => {
      let info = {};
      try { info = require('../lib/authCore.cjs').instanceInfo() || {}; } catch { info = {}; }
      return { id: info.instanceId || 'this-installation', label: info.instanceName || 'This installation', createdAt: info.provisionedAt || null };
    },
    openExternal: async (url) => { await require('electron').shell.openExternal(url); },
    importBars: (body) => require('./marketIntel.cjs').postPath('/store/import', body, { timeout: 180000 }),
  };
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

function register(ipcMain, injected = {}) {
  const d = { ...defaults(), ...injected };
  const pending = new Map();          // accountId -> { state, at }
  const busy = new Set();             // accountId with a fetch running

  const gated = (fn) => async (e, body) => {
    const denied = capability.deny(principalBinding.getPrincipal(e), CAP);
    if (denied) return denied;
    if (!d.unlocked()) return { ok: false, error: 'The store is locked. Sign in again.' };
    try { return await fn(body || {}); }
    catch (err) { return { ok: false, error: err.message }; }
  };

  const kiteAccount = (id) => {
    const c = accounts.credentialsFor(d.store, String(id || ''));
    if (!c) return { error: 'That account no longer exists.' };
    if (c.brokerId !== 'kite') return { error: 'That account is not a Zerodha Kite account.' };
    if (!c.apiKey || !c.secret) return { error: 'The account needs both its API key and its API secret before it can log in.' };
    return { creds: c };
  };

  const snapshot = () => accounts.snapshot(d.store, { self: d.self(), brokerIds: ['kite', 'dhan', 'upstox'], now: d.now() });

  ipcMain.handle('kiteSession:login-start', gated(async (body) => {
    const a = kiteAccount(body.accountId);
    if (a.error) return { ok: false, error: a.error };
    const state = crypto.randomBytes(12).toString('hex');
    pending.set(String(body.accountId), { state, at: d.now() });
    const url = kite.loginUrl(a.creds.apiKey, state);
    let opened = false;
    try {
      if (new URL(url).hostname === 'kite.zerodha.com') { await d.openExternal(url); opened = true; }
    } catch { opened = false; }
    return { ok: true, url, opened, expiresInSec: PENDING_TTL_MS / 1000 };
  }));

  ipcMain.handle('kiteSession:login-complete', gated(async (body) => {
    const id = String(body.accountId || '');
    const a = kiteAccount(id);
    if (a.error) return { ok: false, error: a.error };
    const p = pending.get(id);
    if (!p) return { ok: false, error: 'No login is waiting for this account. Press "Open Kite login" first.' };
    if (d.now() - p.at > PENDING_TTL_MS) { pending.delete(id); return { ok: false, error: 'That login timed out (10 minutes). Start it again.' }; }
    const r = kite.parseRedirect(body.redirect);
    if (!r.ok) return { ok: false, error: r.error };
    if (!r.state || r.state !== p.state) {
      pending.delete(id);
      return { ok: false, error: 'This address does not belong to the login Rāma started, so it was refused. Start the login again.' };
    }
    pending.delete(id);                                                   // single use, whatever happens next
    const ex = await kite.exchangeToken(d.http, { apiKey: a.creds.apiKey, secret: a.creds.secret, requestToken: r.requestToken, now: d.now });
    if (!ex.ok) return { ok: false, error: `Kite refused the login: ${ex.message}` };
    accounts.saveSession(d.store, id, ex.session);
    return { ok: true, data: snapshot(), user: ex.session.userId };
  }));

  ipcMain.handle('kiteSession:logout', gated(async (body) => {
    const id = String(body.accountId || '');
    const live = accounts.liveSession(d.store, id, d.now());
    let remote = 'not-needed';
    if (live) {
      const r = await kite.logout(d.http, live);
      remote = r.ok ? 'invalidated' : `not-confirmed: ${r.message}`;
    }
    const cleared = accounts.clearSession(d.store, id);
    if (!cleared.ok) return cleared;
    return { ok: true, remote, data: snapshot() };
  }));

  ipcMain.handle('kiteSession:fetch-bars', gated(async (body) => {
    const id = String(body.accountId || '');
    const a = kiteAccount(id);
    if (a.error) return { ok: false, error: a.error };
    const kInterval = kite.toKiteInterval(body.interval);
    if (!kInterval) return { ok: false, error: `Kite has no ${String(body.interval).slice(0, 8)} candles. Use 1m, 5m, 15m, 30m, 60m or 1d.` };
    const key = kite.instrumentKey(body.symbol, body.exchange);
    if (!key.ok) return { ok: false, error: key.error };
    const live = accounts.liveSession(d.store, id, d.now());
    if (!live) return { ok: false, needsLogin: true, error: 'There is no live Kite session for this account. Log in first (a session ends at 6 AM IST).' };
    if (busy.has(id)) return { ok: false, error: 'A Kite fetch is already running for this account.' };
    busy.add(id);
    try {
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.toDate || '')) ? body.toDate : ymd(d.now());
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fromDate || '')) ? body.fromDate : ymd(d.now() - DEFAULT_DAYS[kInterval] * 86400000);

      const tok = await kite.resolveToken(d.http, live, body.symbol, body.exchange);
      if (!tok.ok) return fail(tok);
      const got = await kite.fetchCandles(d.http, live, { instrumentToken: tok.instrumentToken, interval: body.interval, fromDate: from, toDate: to, sleep: d.sleep, now: d.now });
      if (!got.ok && !(got.bars && got.bars.length)) return fail(got);
      if (!got.bars.length) return { ok: false, error: `Kite returned no candles for ${key.key} between ${from} and ${to}.` };

      const imp = await d.importBars({
        symbol: String(body.symbol).toUpperCase(), exchange: String(body.exchange || 'NSE').toUpperCase(),
        interval: String(body.interval).toLowerCase(), source: 'kite', bars: got.bars,
      });
      if (!imp || imp.ok === false) return { ok: false, error: `Kite sent ${got.bars.length} candles but the engine did not store them: ${(imp && (imp.error || imp.reason)) || 'no answer'}` };
      const stored = imp.data || imp;
      return {
        ok: true, key: key.key, fetched: got.bars.length, skipped: got.skipped, requests: got.requests,
        from, to, partial: got.ok === false ? got.message : null, stored,
      };
    } finally { busy.delete(id); }

    function fail(r) {
      if (r.kind === 'token') accounts.clearSession(d.store, id);
      const hint = {
        token: 'Kite rejected the session (it may have expired at 6 AM IST). Log in again.',
        permission: 'This API key has no historical-data permission. The Kite Connect data subscription is separate from the key.',
        rate: 'Kite is rate limiting this key. Wait a minute and try a shorter range.',
        input: r.message, range: 'Kite refused the range even at one day per request.', limit: r.message,
      }[r.kind] || r.message;
      return { ok: false, kind: r.kind, error: hint, needsLogin: r.kind === 'token' };
    }
  }));
}

module.exports = { register, PENDING_TTL_MS, DEFAULT_DAYS };
