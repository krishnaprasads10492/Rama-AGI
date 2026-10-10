'use strict';

/**
 * dataStore.cjs — Rāma's encrypted persistent data store.
 *
 * ALL app data is encrypted at rest using cryptoCore.
 * No plaintext is ever written to disk by this module.
 *
 * Data domains (each stored as a separate .enc file):
 *   users.enc          — user accounts, password hashes, tiers
 *   conversations.enc  — all chat history
 *   knowledge.enc      — knowledge base entries
 *   memory.enc         — Rāma's episodic + semantic + procedural memory
 *   worldmodel.enc     — master's goals, preferences, context
 *   agents.enc         — agent history + audit log
 *   config.enc         — app configuration (provider, model, etc.)
 *
 * Access pattern:
 *   1. On unlock: load all .enc files → decrypt → cache in memory
 *   2. On write:  update in-memory cache → encrypt → write to disk
 *   3. On lock:   zero cache, key is wiped by cryptoCore
 *   4. Auto-save: every 60s if dirty
 */

const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { app } = require('electron');
const cryptoCore = require('./cryptoCore.cjs');

// ─── Data directory ───────────────────────────────────────────────────────────
function getDataDir() {
  const base = app?.getPath('userData') || path.join(require('os').homedir(), '.rama-agi');
  return path.join(base, 'data');
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
const cache  = {};
const dirty  = new Set();
let autoSaveTimer = null;

// `proposals` added in Section 58: the self-change approval ledger was in-memory
// only, so every pending approval and the entire audit trail vanished on restart.
// `tracking` is the Function-tracking domain (Section 138). It is HERE rather than in a store of its
// own precisely because I14 re-keys by iterating this array: a database outside it would be the one
// island left unreadable after a passcode change. Adding a domain is therefore the cheap, safe way
// to add a store, and `verifyInvariants.cjs` asserts markAllDirty/loadAll are driven by this array
// rather than a literal, so the next domain inherits the re-key too.
const DOMAINS = ['users', 'conversations', 'knowledge', 'memory', 'worldmodel', 'agents', 'config', 'instances', 'proposals', 'tracking'];

// ─── Load all domains on unlock ───────────────────────────────────────────────
function loadAll() {
  const dir = getDataDir();
  for (const domain of DOMAINS) {
    const filePath = path.join(dir, `${domain}.enc`);
    try {
      const data = cryptoCore.decryptFromFile(filePath);
      cache[domain] = data || getDefaultData(domain);
    } catch (err) {
      console.error(`[dataStore] Failed to load ${domain}:`, err.message);
      cache[domain] = getDefaultData(domain);
    }
  }
  // Start auto-save
  startAutoSave();
}

/**
 * THE FIRST PRODUCER FOR FUNCTION TRACKING (Section 145, audit H4).
 *
 * `functionTracking.record()` was built in Section 138 with 61 assertions and had **zero call sites**
 * for three sections — a measurement store with nothing measuring. Master asked for it so backtests
 * could be validated rather than trusted; the engine path that answers that needs CPython 3.12, which
 * this machine has never had. Encrypted-save duration needs no engine, happens constantly, and is
 * exactly the kind of cost that degrades invisibly as the store grows.
 *
 * `functionTracking.cjs` requires NOTHING, so this import cannot create a cycle — it takes the store
 * as a parameter precisely so the dependency runs one way.
 */
const tracking = require('./lib/functionTracking.cjs');

/**
 * THE TRACKING DOMAIN IS NEVER MEASURED, and this guard is not an optimisation — without it the
 * feature cannot work at all.
 *
 * `record()` pushes into the `tracking` domain, which marks `tracking` dirty. If saving `tracking`
 * also recorded a measurement, every save of it would create a new record that re-dirties it: the
 * domain could never become clean, and the 60-second autosave would write forever on a completely
 * idle app, each pass growing the ring it was writing. A self-feeding measurement loop.
 *
 * So the recorder does not measure its own storage. That is a real blind spot and it is named here
 * rather than left to be discovered: the cost of persisting tracking itself is NOT in the record.
 */
function measureSave(domain, startedAt, outcome, detail) {
  if (domain === tracking.DOMAIN) return false;
  return tracking.record(module.exports, {
    module: 'dataStore',
    fn: 'saveDomain',
    ms: Date.now() - startedAt,
    outcome,
    // The DOMAIN NAME only. No key, no value, nothing out of the store itself — a measurement of an
    // encrypted write must not become a plaintext copy of what it wrote.
    detail: detail ? `${domain}: ${detail}` : domain,
  });
}

// ─── Save a single domain ─────────────────────────────────────────────────────
function saveDomain(domain) {
  if (!cryptoCore.isUnlocked()) return;
  if (!cache[domain]) return;
  const dir      = getDataDir();
  const filePath = path.join(dir, `${domain}.enc`);
  const startedAt = Date.now();
  try {
    cryptoCore.encryptToFile(filePath, cache[domain]);
    dirty.delete(domain);
    measureSave(domain, startedAt, 'ok', null);
  } catch (err) {
    console.error(`[dataStore] Failed to save ${domain}:`, err.message);
    // A FAILED SAVE IS RECORDED TOO. The outcome vocabulary exists so a reader can ask "how often
    // did this fail", and a record that only ever holds successes cannot answer it.
    measureSave(domain, startedAt, 'error', err.message);
  }
}

// ─── Save all dirty domains ───────────────────────────────────────────────────
function saveAll() {
  for (const domain of dirty) saveDomain(domain);
}

// ─── Auto-save every 60s ──────────────────────────────────────────────────────
function startAutoSave() {
  if (autoSaveTimer) return;
  autoSaveTimer = setInterval(() => {
    if (cryptoCore.isUnlocked() && dirty.size > 0) saveAll();
  }, 60000);
}

function stopAutoSave() {
  clearInterval(autoSaveTimer);
  autoSaveTimer = null;
}

// ─── Get / Set helpers ────────────────────────────────────────────────────────
function get(domain, key = null) {
  if (!cache[domain]) return null;
  if (key === null) return cache[domain];
  return cache[domain][key] ?? null;
}

function set(domain, key, value) {
  if (!cache[domain]) cache[domain] = getDefaultData(domain);
  cache[domain][key] = value;
  dirty.add(domain);
}

function push(domain, arrayKey, item) {
  if (!cache[domain]) cache[domain] = getDefaultData(domain);
  if (!Array.isArray(cache[domain][arrayKey])) cache[domain][arrayKey] = [];
  cache[domain][arrayKey].push({ ...item, _id: generateId(), _ts: Date.now() });
  dirty.add(domain);
  return cache[domain][arrayKey][cache[domain][arrayKey].length - 1];
}

function update(domain, arrayKey, id, changes) {
  if (!cache[domain]?.[arrayKey]) return false;
  const idx = cache[domain][arrayKey].findIndex(x => x._id === id || x.id === id);
  if (idx < 0) return false;
  cache[domain][arrayKey][idx] = { ...cache[domain][arrayKey][idx], ...changes, _updated: Date.now() };
  dirty.add(domain);
  return true;
}

function remove(domain, arrayKey, id) {
  if (!cache[domain]?.[arrayKey]) return false;
  const before = cache[domain][arrayKey].length;
  cache[domain][arrayKey] = cache[domain][arrayKey].filter(x => x._id !== id && x.id !== id);
  if (cache[domain][arrayKey].length < before) dirty.add(domain);
  return true;
}

function find(domain, arrayKey, predicate) {
  return (cache[domain]?.[arrayKey] || []).filter(predicate);
}

// ─── Default data structures ──────────────────────────────────────────────────
function getDefaultData(domain) {
  const defaults = {
    // Function tracking (Section 138). `calls` is a CAPPED ring — `functionTracking.prune` drops the
    // oldest once it passes its ceiling, because an unbounded per-call log grows fastest exactly
    // when the app is busiest and makes every autosave of this domain slower.
    tracking: {
      calls: [],      // { module, fn, outcome, ms?, detail?, window?, sample?, _id, _ts }
    },
    users: {
      accounts: [],   // User objects (passwords hashed by auth.cjs)
      settings: {},
    },
    conversations: {
      sessions:  [],   // { _id, title, messages[], createdAt, userId }
      maxPerUser: 500,
    },
    knowledge: {
      entries:  [],    // { _id, title, content, tags, embedding, ts }
      index:    {},
    },
    memory: {
      episodic:   [],  // { _id, type, summary, importance, ts }
      semantic:   {},  // { [key]: { value, confidence, source, ts } }
      procedural: [],  // { _id, name, trigger, steps, successRate, lastUsed }
    },
    worldmodel: {
      masterPrefs:  {},
      masterGoals:  [],
      systemInfo:   {},
      projects:     [],
      tasksPending: [],
      tasksScheduled: [],
    },
    agents: {
      history:  [],    // Completed agent runs
      auditLog: [],    // All agent actions
    },
    config: {
      primaryModel:  'gpt-4o',
      provider:      'openai',
      theme:         'cyberpunk',
      vaultCreatedAt: null,
      version:       '1.0.0',
      customProviders: [],   // { id, name, baseUrl, models[], credKey, addedAt } — see electron/lib/customProviders.cjs. Never a secret value.
    },
    instances: {
      registry:   [],   // Rāma instances — each carries the full genome
      genomeHash: null, // hash of the genome the instances were created against
    },
    proposals: {
      ledger: [],   // every self-change proposal, newest-first (see lib/proposals.cjs)
      audit:  [],   // every state transition, newest-first — the I6 audit trail
      savedAt: null,
    },
  };
  return defaults[domain] || {};
}

// ─── Generate secure ID ───────────────────────────────────────────────────────
function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

// ─── Flush + clear on lock ────────────────────────────────────────────────────
function flushAndClear() {
  saveAll();
  stopAutoSave();
  for (const domain of DOMAINS) {
    delete cache[domain];
  }
  dirty.clear();
}

// ─── Register IPC handlers ────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Get a domain or key ───────────────────────────────────────────────────
  ipcMain.handle('store:get', async (_e, domain, key) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    return { ok: true, data: get(domain, key) };
  });

  // ── Set a key ─────────────────────────────────────────────────────────────
  ipcMain.handle('store:set', async (_e, domain, key, value) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    set(domain, key, value);
    return { ok: true };
  });

  // ── Push to array ─────────────────────────────────────────────────────────
  ipcMain.handle('store:push', async (_e, domain, arrayKey, item) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    const saved = push(domain, arrayKey, item);
    return { ok: true, data: saved };
  });

  // ── Update array item ─────────────────────────────────────────────────────
  ipcMain.handle('store:update', async (_e, domain, arrayKey, id, changes) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    const ok = update(domain, arrayKey, id, changes);
    return { ok };
  });

  // ── Remove array item ─────────────────────────────────────────────────────
  ipcMain.handle('store:remove', async (_e, domain, arrayKey, id) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    remove(domain, arrayKey, id);
    return { ok: true };
  });

  // ── Query array ───────────────────────────────────────────────────────────
  ipcMain.handle('store:find', async (_e, domain, arrayKey, filter) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    // filter is a plain object — do key-value matching
    const results = find(domain, arrayKey, (item) =>
      Object.entries(filter || {}).every(([k, v]) => item[k] === v)
    );
    return { ok: true, data: results };
  });

  // ── Force save now ────────────────────────────────────────────────────────
  ipcMain.handle('store:save', async () => {
    saveAll();
    return { ok: true };
  });

  // ── Store status ──────────────────────────────────────────────────────────
  ipcMain.handle('store:status', async () => {
    const stats = {};
    for (const domain of DOMAINS) {
      const d = cache[domain];
      stats[domain] = {
        loaded: !!d,
        dirty:  dirty.has(domain),
      };
    }
    return { ok: true, unlocked: cryptoCore.isUnlocked(), domains: stats };
  });

  // ── Export encrypted backup ───────────────────────────────────────────────
  ipcMain.handle('store:export-backup', async (_e, destPath) => {
    if (!cryptoCore.isUnlocked()) return { ok: false, error: 'Store locked' };
    try {
      saveAll();   // flush first
      const dir   = getDataDir();
      const files = DOMAINS.map(d => path.join(dir, `${d}.enc`)).filter(f => fs.existsSync(f));

      // Bundle all .enc files + salt into a single encrypted archive
      const bundle = {};
      for (const f of files) {
        const name = path.basename(f);
        bundle[name] = fs.readFileSync(f).toString('base64');
      }
      const saltPath = path.join(dir, '..', 'rama.salt');
      if (fs.existsSync(saltPath)) {
        bundle['rama.salt'] = fs.readFileSync(saltPath).toString('base64');
      }

      // Re-encrypt the bundle itself
      cryptoCore.encryptToFile(destPath, bundle);
      return { ok: true, path: destPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

/**
 * Mark every domain dirty so the next saveAll() rewrites all of them.
 * Needed by the passcode re-key: the in-memory copy is the only source of the
 * plaintext once the old salt has been destroyed, so every domain must be
 * written back out under the new keys, not just the ones that happened to change.
 */
function markAllDirty() {
  for (const domain of DOMAINS) {
    if (!cache[domain]) cache[domain] = getDefaultData(domain);
    dirty.add(domain);
  }
  return DOMAINS.length;
}

module.exports = {
  register,
  loadAll,
  markAllDirty,
  DOMAINS,
  flushAndClear,
  get,
  set,
  push,
  update,
  remove,
  find,
  saveDomain,
  saveAll,
  getDataDir,
};
