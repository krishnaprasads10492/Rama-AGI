'use strict';

/**
 * brokerAccounts.cjs (IPC) - the channels for the broker-account registry (spec Section 152)
 *
 * EVERY CHANNEL IS GATED ON THE PRINCIPAL MAIN VALIDATED, not on a `user` the window sent: `brokers.accounts.view`
 * to read, `brokers.accounts.write` to change (both SuperAdmin, tier 1; Master also passes, as for every tier-1
 * capability). A caller that is refused receives the refusal and NOTHING else: no counts, no labels, no hint
 * that accounts exist.
 *
 * The API secret goes in and never comes out. There is no channel that returns it.
 */

const capability = require('../lib/capability.cjs');
const principalBinding = require('../lib/principalBinding.cjs');
const accounts = require('../lib/brokerAccounts.cjs');
const egressIp = require('../lib/egressIp.cjs');

const FIELDS = ['id', 'brokerId', 'label', 'clientId', 'apiKey', 'secret', 'distributableId',
  'primaryIp', 'secondaryIp', 'sharedWithFamily', 'notes', 'acknowledgeWeeklyLimit'];

const pick = (src, keys) => {
  const out = {};
  for (const k of keys) if (src && Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  return out;
};

function defaults() {
  return {
    store: require('../dataStore.cjs'),
    http: require('../lib/http.cjs'),
    unlocked: () => require('../cryptoCore.cjs').isUnlocked(),
    self: () => {
      let info = {};
      try { info = require('../lib/authCore.cjs').instanceInfo() || {}; } catch { info = {}; }
      return { id: info.instanceId || 'this-installation', label: info.instanceName || 'This installation', createdAt: info.provisionedAt || null };
    },
    brokerIds: () => require('../lib/brokerConnectors.cjs').ids(),
  };
}

function register(ipcMain, injected = {}) {
  const d = { ...defaults(), ...injected };
  const gated = (cap, fn) => async (e, body) => {
    const denied = capability.deny(principalBinding.getPrincipal(e), cap);
    if (denied) return denied;
    if (!d.unlocked()) return { ok: false, error: 'The store is locked. Sign in again.' };
    try { return await fn(body || {}, e); }
    catch (err) { return { ok: false, error: err.message }; }
  };
  const ctx = () => ({ self: d.self(), brokerIds: d.brokerIds() });

  ipcMain.handle('brokerAccounts:list', gated('brokers.accounts.view', async () => ({
    ok: true, data: accounts.snapshot(d.store, ctx()),
  })));

  ipcMain.handle('brokerAccounts:save', gated('brokers.accounts.write', async (body) =>
    accounts.saveAccount(d.store, pick(body, FIELDS), ctx())));

  ipcMain.handle('brokerAccounts:remove', gated('brokers.accounts.write', async (body) =>
    accounts.removeAccount(d.store, String(body.id || ''))));

  ipcMain.handle('brokerAccounts:distributable-save', gated('brokers.accounts.write', async (body) =>
    accounts.saveDistributable(d.store, pick(body, ['id', 'label', 'notes']), ctx())));

  ipcMain.handle('brokerAccounts:distributable-remove', gated('brokers.accounts.write', async (body) =>
    accounts.removeDistributable(d.store, String(body.id || ''), ctx())));

  // A request to a third party, so it needs the write capability and is never called on a timer.
  ipcMain.handle('brokerAccounts:detect-ip', gated('brokers.accounts.write', async () => {
    const found = await egressIp.detect(d.http);
    if (!found.ok) return found;
    const saved = accounts.recordDetected(d.store, found.ip, found.source);
    return saved.ok ? { ok: true, data: accounts.snapshot(d.store, ctx()), detected: saved.detected } : saved;
  }));
}

module.exports = { register, FIELDS };
