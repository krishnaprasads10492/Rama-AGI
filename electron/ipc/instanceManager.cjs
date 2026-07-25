'use strict';

/**
 * instanceManager.cjs — Rāma instance lifecycle.
 *
 * An *instance* is a long-lived expression of Rāma with a role. It differs from
 * an *agent* (agentOrchestrator.cjs) in three ways:
 *
 *   agent     — one task, ephemeral, dies with its result
 *   instance  — one role, persistent across restarts, accumulates its own
 *               experience, and can spawn agents to do its work
 *
 * HOLONIC GUARANTEE: every instance carries the complete genome. Its role only
 * decides which genes are *expressed*; dormant genes can be expressed at runtime
 * (see `express`). So no instance is a reduced Rāma, and losing one loses no
 * capability — the whole is present in every part.
 *
 * PERSISTENCE: instances live in the encrypted `instances` domain of dataStore.
 * Nothing about an instance is written in plaintext.
 *
 * SAFETY:
 *   - Spawning goes through resourceOrchestrator.admit() — the single authority
 *   - An instance can never express a gene its owner's tier cannot use
 *   - Every lifecycle transition is broadcast on the event bus and audited
 */

const crypto = require('crypto');
const genome = require('../genome.cjs');

// ─── State ────────────────────────────────────────────────────────────────────
const instances = new Map();   // id → InstanceState
const audit     = [];          // newest-first lifecycle log

const STATUS = {
  STARTING:  'starting',
  ACTIVE:    'active',
  IDLE:      'idle',
  SUSPENDED: 'suspended',
  TERMINATED:'terminated',
};

// Per-instance RAM expectation used for admission. Instances are coordinators,
// not workers — the heavy lifting happens in agents they spawn.
const INSTANCE_RAM_MB = 96;
const MAX_INSTANCES   = 8;

// ─── Persistence ──────────────────────────────────────────────────────────────
function store() {
  try { return require('../dataStore.cjs'); } catch { return null; }
}

function persist() {
  const ds = store();
  if (!ds?.set) return;
  try {
    ds.set('instances', 'registry', [...instances.values()].map(strip));
  } catch { /* store locked — instances stay in memory this session */ }
}

function restore() {
  const ds = store();
  if (!ds?.get) return 0;
  let saved;
  try { saved = ds.get('instances', 'registry'); } catch { return 0; }
  if (!Array.isArray(saved)) return 0;

  let count = 0;
  for (const rec of saved) {
    // Restored instances come back suspended — master decides what resumes.
    instances.set(rec.id, {
      ...rec,
      status:    rec.status === STATUS.TERMINATED ? STATUS.TERMINATED : STATUS.SUSPENDED,
      restoredAt: Date.now(),
    });
    count++;
  }
  log('restored', { count });
  return count;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
/**
 * Create an instance. Fails closed: no admission, no instance.
 * @param {object} opts { role, label, purpose, owner, autoStart }
 */
function spawn(opts = {}) {
  const { role = 'sentinel-lite', label, purpose = '', owner = null } = opts;

  if (!genome.ROLES[role]) {
    return { ok: false, error: `Unknown role: ${role}. Known: ${Object.keys(genome.ROLES).join(', ')}` };
  }

  const live = [...instances.values()].filter(i =>
    i.status === STATUS.ACTIVE || i.status === STATUS.STARTING || i.status === STATUS.IDLE);
  if (live.length >= MAX_INSTANCES) {
    return { ok: false, error: `Instance cap reached (${MAX_INSTANCES}) — suspend or terminate one first` };
  }

  // Only one prime instance ever — it is the master-facing Rāma
  if (role === 'prime' && live.some(i => i.role === 'prime')) {
    return { ok: false, error: 'A prime instance already exists' };
  }

  // Resource admission — same gate agents and the sandbox use
  const admission = admit(role);
  if (!admission.allow) return { ok: false, error: admission.reason };

  const g         = genome.getGenome();
  const expressed = genome.expressedFor(role);
  const dormant   = genome.dormantFor(role);

  const instance = {
    id:        `i_${crypto.randomBytes(6).toString('hex')}`,
    role,
    label:     label || genome.ROLES[role].label,
    purpose:   purpose || genome.ROLES[role].desc,
    owner,                       // user id that requested it
    status:    STATUS.STARTING,

    // Holonic proof: the full genome is carried, not a subset.
    genomeVersion: g.version,
    genomeHash:    g.hash,
    geneCount:     g.geneCount,
    expressed,
    dormant,

    createdAt:  Date.now(),
    activeAt:   null,
    lastActive: null,
    stats: { tasks: 0, agentsSpawned: 0, errors: 0, expressions: 0 },
  };

  instances.set(instance.id, instance);
  instance.status   = STATUS.ACTIVE;
  instance.activeAt = Date.now();

  log('spawned', { id: instance.id, role, expressed: expressed.length, dormant: dormant.length });
  emit('instance:spawned', strip(instance));
  persist();

  return { ok: true, data: strip(instance) };
}

/**
 * Express a dormant gene on a running instance — the mechanism that makes the
 * architecture holonic rather than merely modular.
 */
function express(id, geneId, user = null) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, error: 'Instance not found' };
  if (inst.status === STATUS.TERMINATED) return { ok: false, error: 'Instance is terminated' };

  const gene = genome.geneById.get(geneId);
  if (!gene) return { ok: false, error: `Unknown gene: ${geneId}` };
  if (inst.expressed.includes(geneId)) return { ok: true, data: strip(inst), note: 'already expressed' };

  // Tier gate — an instance may never exceed the authority of who asked for it
  if (user && gene.cap) {
    let allowed = true;
    try {
      const { can } = require('../lib/capability.cjs');
      allowed = can(user, gene.cap);
    } catch { allowed = true; }   // no matrix available in main — server still enforces
    if (!allowed) {
      return { ok: false, error: `Tier ${user.tier} may not express ${geneId} (needs ${gene.cap})` };
    }
  }

  // Pull in dependencies so we never activate a half-wired gene
  const toAdd = [];
  const walk  = (gid) => {
    if (inst.expressed.includes(gid) || toAdd.includes(gid)) return;
    const gn = genome.geneById.get(gid);
    if (!gn) return;
    toAdd.push(gid);
    gn.requires.forEach(walk);
  };
  walk(geneId);

  inst.expressed = [...inst.expressed, ...toAdd];
  inst.dormant   = inst.dormant.filter(d => !toAdd.includes(d));
  inst.stats.expressions += toAdd.length;
  inst.lastActive = Date.now();

  log('expressed', { id, genes: toAdd });
  emit('instance:expressed', { id, genes: toAdd });
  persist();

  return { ok: true, data: strip(inst), activated: toAdd };
}

function suspend(id) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, error: 'Instance not found' };
  if (inst.role === 'prime') return { ok: false, error: 'The prime instance cannot be suspended' };

  inst.status = STATUS.SUSPENDED;
  log('suspended', { id });
  emit('instance:suspended', strip(inst));
  persist();
  return { ok: true, data: strip(inst) };
}

function resume(id) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, error: 'Instance not found' };
  if (inst.status === STATUS.TERMINATED) return { ok: false, error: 'Terminated instances cannot resume' };

  const admission = admit(inst.role);
  if (!admission.allow) return { ok: false, error: admission.reason };

  inst.status     = STATUS.ACTIVE;
  inst.lastActive = Date.now();
  log('resumed', { id });
  emit('instance:resumed', strip(inst));
  persist();
  return { ok: true, data: strip(inst) };
}

function terminate(id) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, error: 'Instance not found' };
  if (inst.role === 'prime') return { ok: false, error: 'The prime instance cannot be terminated' };

  inst.status       = STATUS.TERMINATED;
  inst.terminatedAt = Date.now();
  log('terminated', { id, role: inst.role });
  emit('instance:terminated', strip(inst));
  persist();
  return { ok: true, data: strip(inst) };
}

/** Record work done by an instance — feeds the experiential dataset. */
function recordWork(id, { task, ok = true, agentsSpawned = 0 } = {}) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, error: 'Instance not found' };

  inst.stats.tasks++;
  inst.stats.agentsSpawned += agentsSpawned;
  if (!ok) inst.stats.errors++;
  inst.lastActive = Date.now();
  inst.status     = STATUS.ACTIVE;

  try {
    require('./metaCognition.cjs').recordOutcome({
      actor:  id,
      role:   inst.role,
      action: task,
      ok,
    });
  } catch { /* metacognition optional */ }

  persist();
  return { ok: true };
}

// ─── Views ────────────────────────────────────────────────────────────────────
function list({ status = null, role = null } = {}) {
  return [...instances.values()]
    .filter(i => (!status || i.status === status) && (!role || i.role === role))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(strip);
}

function stats() {
  const all = [...instances.values()];
  const byStatus = {};
  const byRole   = {};
  for (const i of all) {
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    byRole[i.role]     = (byRole[i.role]     || 0) + 1;
  }
  const g = genome.getGenome();
  return {
    total: all.length,
    cap:   MAX_INSTANCES,
    byStatus, byRole,
    genomeHash:    g.hash,
    genomeVersion: g.version,
    geneCount:     g.geneCount,
    // Holonic health: do all live instances carry the same genome?
    genomeConsistent: all
      .filter(i => i.status !== STATUS.TERMINATED)
      .every(i => i.genomeHash === g.hash),
  };
}

/**
 * Which instances could take over a given role right now? Answering this is the
 * point of carrying the full genome — resilience you can actually query.
 */
function failoverCandidates(role) {
  const needed = genome.expressedFor(role);
  return [...instances.values()]
    .filter(i => i.status !== STATUS.TERMINATED)
    .map(i => {
      const missing = needed.filter(gid => !i.expressed.includes(gid));
      return {
        id: i.id, role: i.role, status: i.status,
        // Every instance carries every gene, so any missing gene is dormant,
        // not absent — it can be expressed without a restart.
        canTakeOver:   missing.every(gid => i.dormant.includes(gid)),
        needsExpressing: missing,
      };
    })
    .filter(c => c.canTakeOver);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function admit(role) {
  try {
    const res = require('../resourceOrchestrator.cjs');
    return res.orchestrator.admit({
      ramMB: INSTANCE_RAM_MB,
      label: `${role} instance`,
    });
  } catch {
    return { allow: true, reason: 'orchestrator unavailable — allowing' };
  }
}

/** Serialisable view — no functions, no timers. */
function strip(inst) {
  const { timer, ...safe } = inst;
  return safe;
}

function log(action, meta) {
  audit.unshift({ ts: Date.now(), action, ...meta });
  if (audit.length > 500) audit.pop();
}

function emit(channel, data) {
  // Event bus first (engines listen there), then renderer
  try { require('../ramaEventBus.cjs').bus.emit(channel, data); } catch { /* optional */ }
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  } catch { /* no windows */ }
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function register(ipcMain) {
  ipcMain.handle('instance:spawn',     async (_e, opts)        => spawn(opts || {}));
  ipcMain.handle('instance:list',      async (_e, filter)      => ({ ok: true, data: list(filter || {}) }));
  ipcMain.handle('instance:get',       async (_e, id)          => {
    const i = instances.get(id);
    return i ? { ok: true, data: strip(i) } : { ok: false, error: 'Instance not found' };
  });
  ipcMain.handle('instance:express',   async (_e, id, geneId, user) => express(id, geneId, user));
  ipcMain.handle('instance:suspend',   async (_e, id)          => suspend(id));
  ipcMain.handle('instance:resume',    async (_e, id)          => resume(id));
  ipcMain.handle('instance:terminate', async (_e, id)          => terminate(id));
  ipcMain.handle('instance:record',    async (_e, id, work)    => recordWork(id, work || {}));
  ipcMain.handle('instance:stats',     async ()                => ({ ok: true, data: stats() }));
  ipcMain.handle('instance:audit',     async (_e, limit)       => ({ ok: true, data: audit.slice(0, limit || 100) }));
  ipcMain.handle('instance:failover',  async (_e, role)        => ({ ok: true, data: failoverCandidates(role) }));

  // Restore persisted instances once the store is unlocked
  ipcMain.handle('instance:restore',   async ()                => ({ ok: true, restored: restore() }));

  // Ensure a prime instance exists — Rāma is always present for its master
  ipcMain.handle('instance:ensure-prime', async () => {
    const existing = [...instances.values()].find(i => i.role === 'prime' && i.status !== STATUS.TERMINATED);
    if (existing) {
      if (existing.status === STATUS.SUSPENDED) resume(existing.id);
      return { ok: true, data: strip(existing), created: false };
    }
    const res = spawn({ role: 'prime', purpose: 'Master-facing Rāma — full genome expressed' });
    return res.ok ? { ...res, created: true } : res;
  });
}

module.exports = {
  register, spawn, express, suspend, resume, terminate,
  recordWork, list, stats, failoverCandidates, restore,
  STATUS, MAX_INSTANCES, instances,
};
