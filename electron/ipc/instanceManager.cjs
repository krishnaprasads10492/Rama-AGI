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
  const { role = 'sentinel-lite', label, purpose = '', owner = null, ownerTier = null } = opts;

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
    // The tier of whoever asked for it, as MAIN validated it (Section 150.1). It bounds what the system
    // may express here on its own: an instance never receives a gene more privileged than the account
    // that created it. Null for an instance the system spawned itself or one restored from before this
    // field existed, which is bounded by 'never a tier-0 gene' alone.
    ownerTier:   Number.isInteger(ownerTier) ? ownerTier : null,
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
 * The system as an actor (Section 150.1, D12). `selfCare.checkInstanceFailover` used to call
 * `express(id, gene, null)` and the old code treated a missing user as "system-initiated, no tier gate to
 * bypass" - which was no gate at all: the 120-second sweep could express any of the 31 genes on any
 * sibling, nine of them tier 0, and so could any IPC caller who simply left `user` out.
 *
 * It is a frozen object compared BY IDENTITY, so nothing that arrives over IPC (a structured clone is
 * never this object) can be it. It has no tier of its own; what it may do is defined below.
 */
const SYSTEM_ACTOR = Object.freeze({ system: true, name: 'instance-failover' });

/**
 * May this actor add every gene in `closure` to this instance? Returns a denial or null.
 *
 *   no actor            denied. Absent used to mean allowed.
 *   SYSTEM_ACTOR        every gene must be above tier 0 (the loyalty class is never auto-expressed) and
 *                       no more privileged than the instance's recorded owner tier.
 *   a user account      must hold each gene's capability, as before, now for the whole closure.
 */
function authoriseExpression(actor, inst, closure) {
  const { MATRIX, can, TIER_LABELS } = require('../lib/capability.cjs');
  const tierOf = (gn) => (gn.cap ? MATRIX[gn.cap] : undefined);

  if (actor === SYSTEM_ACTOR) {
    for (const gn of closure) {
      const t = tierOf(gn);
      if (t === undefined) {
        return { ok: false, error: `${gn.id} declares no known capability, so the system will not express it on its own` };
      }
      if (t === 0) {
        return { ok: false, error: `${gn.id} is a tier-0 gene; only master expresses those` };
      }
      if (Number.isInteger(inst.ownerTier) && t < inst.ownerTier) {
        return { ok: false, error: `${gn.id} (tier ${t}) is more privileged than this instance's owner (tier ${inst.ownerTier})` };
      }
    }
    return null;
  }

  if (!actor || typeof actor !== 'object' || typeof actor.tier !== 'number') {
    return { ok: false, error: 'Expressing a gene requires a signed-in account' };
  }
  for (const gn of closure) {
    if (gn.cap && !can(actor, gn.cap)) {
      const who = TIER_LABELS[String(actor.tier)] ?? 'unauthenticated';
      return { ok: false, error: `${who} may not express ${gn.id} (requires "${gn.cap}")` };
    }
  }
  return null;
}

/**
 * Express a dormant gene on a running instance — the mechanism that makes the
 * architecture holonic rather than merely modular.
 */
function express(id, geneId, actor = null) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, error: 'Instance not found' };
  if (inst.status === STATUS.TERMINATED) return { ok: false, error: 'Instance is terminated' };

  const gene = genome.geneById.get(geneId);
  if (!gene) return { ok: false, error: `Unknown gene: ${geneId}` };
  if (inst.expressed.includes(geneId)) return { ok: true, data: strip(inst), note: 'already expressed' };

  // EVERYTHING ABOUT TO BE ADDED, not only the gene that was named (Section 150.1, D12). A gene's
  // `requires` are expressed with it, and three genes reach a more privileged one that way: g.store and
  // g.vector (tier 4) pull in g.crypto (tier 0), g.self-model (tier 3) pulls in g.metacognition (tier 0).
  // Checking the named gene alone let a tier-4 request add a tier-0 gene.
  const closure = [];
  const seenGenes = new Set();
  const collect = (gid) => {
    if (seenGenes.has(gid) || inst.expressed.includes(gid)) return;
    seenGenes.add(gid);
    const gn = genome.geneById.get(gid);
    if (!gn) return;
    closure.push(gn);
    gn.requires.forEach(collect);
  };
  collect(geneId);

  const denial = authoriseExpression(actor, inst, closure);
  if (denial) return denial;

  // Dependencies come with the gene so we never activate a half-wired one. THE SAME SET that was just
  // authorised: a second traversal here would let what is checked and what is added drift apart, which
  // is how a tier-4 request came to add a tier-0 gene.
  const toAdd = closure.map((gn) => gn.id);

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
  // THE DECLARED CAPABILITIES, ENFORCED (Section 150.1, D12). `instances.view/spawn/express/terminate`
  // have been in the matrix since the genome layer was built and no channel checked one. The account is
  // the PRINCIPAL main validated, never a user the caller sent, so these cannot be satisfied by claiming
  // a tier. `ensure-prime` and `restore` stay open to a signed-in session: the app calls both at start-up
  // for every tier.
  const principalBinding = require('../lib/principalBinding.cjs');
  const capability = require('../lib/capability.cjs');
  const gated = (cap, fn) => async (e, ...args) => {
    const denied = capability.deny(principalBinding.getPrincipal(e), cap);
    return denied || fn(e, ...args);
  };
  const signedIn = (fn) => async (e, ...args) => {
    const who = principalBinding.getPrincipal(e);
    return who ? fn(e, ...args) : { ok: false, error: 'Sign in first' };
  };

  ipcMain.handle('instance:spawn',     gated('instances.spawn', async (e, opts) => {
    const who = principalBinding.getPrincipal(e);
    // Owner and owner tier are what MAIN knows about the caller, overriding anything in `opts`.
    return spawn({ ...(opts || {}), owner: who.userId, ownerTier: who.tier });
  }));
  ipcMain.handle('instance:list',      gated('instances.view', async (_e, filter) => ({ ok: true, data: list(filter || {}) })));
  ipcMain.handle('instance:get',       gated('instances.view', async (_e, id) => {
    const i = instances.get(id);
    return i ? { ok: true, data: strip(i) } : { ok: false, error: 'Instance not found' };
  }));
  // The actor is the validated principal. The renderer's third argument is ignored: it used to be the
  // whole gate, and omitting it skipped the gate.
  ipcMain.handle('instance:express',   gated('instances.express', async (e, id, geneId) =>
    express(id, geneId, principalBinding.getPrincipal(e))));
  ipcMain.handle('instance:suspend',   gated('instances.terminate', async (_e, id) => suspend(id)));
  ipcMain.handle('instance:resume',    gated('instances.terminate', async (_e, id) => resume(id)));
  ipcMain.handle('instance:terminate', gated('instances.terminate', async (_e, id) => terminate(id)));
  ipcMain.handle('instance:record',    gated('instances.spawn',     async (_e, id, work) => recordWork(id, work || {})));
  ipcMain.handle('instance:stats',     gated('instances.view', async () => ({ ok: true, data: stats() })));
  ipcMain.handle('instance:audit',     gated('instances.view', async (_e, limit) => ({ ok: true, data: audit.slice(0, limit || 100) })));
  ipcMain.handle('instance:failover',  gated('instances.view', async (_e, role) => ({ ok: true, data: failoverCandidates(role) })));

  // Restore persisted instances once the store is unlocked
  ipcMain.handle('instance:restore',   signedIn(async () => ({ ok: true, restored: restore() })));

  // Ensure a prime instance exists — Rāma is always present for its master
  ipcMain.handle('instance:ensure-prime', signedIn(async (e) => {
    const existing = [...instances.values()].find(i => i.role === 'prime' && i.status !== STATUS.TERMINATED);
    if (existing) {
      if (existing.status === STATUS.SUSPENDED) resume(existing.id);
      return { ok: true, data: strip(existing), created: false };
    }
    const who = principalBinding.getPrincipal(e);
    const res = spawn({ role: 'prime', purpose: 'Master-facing Rāma — full genome expressed',
                        owner: who.userId, ownerTier: who.tier });
    return res.ok ? { ...res, created: true } : res;
  }));
}

module.exports = {
  register, spawn, express, suspend, resume, terminate,
  recordWork, list, stats, failoverCandidates, restore,
  STATUS, MAX_INSTANCES, instances, SYSTEM_ACTOR,
};
