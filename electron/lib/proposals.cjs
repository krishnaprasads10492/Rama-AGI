'use strict';

/**
 * proposals.cjs — Rāma's single change-proposal ledger.
 *
 * CONSOLIDATES three independent propose → approve → apply lifecycles:
 *   - evolutionEngine.cjs   evolutionLog + evolution:approve/reject/apply
 *   - codeRegenEngine.cjs   proposals Map + regen:approve/reject/apply
 *   - selfModify.js         renderer-side pendingModification flow
 *
 * Why this matters: every one of those paths mutates Rāma's own codebase. Three
 * separate approval gates meant three chances for a change to slip through with
 * a different rule. There is now exactly ONE gate, one audit trail, and one
 * invariant that cannot be bypassed:
 *
 *   NOTHING IS APPLIED WITHOUT AN EXPLICIT MASTER APPROVAL RECORDED HERE.
 *
 * Each proposal kind registers an applier. The ledger owns state transitions;
 * the applier only knows how to write its own kind of change.
 */

const crypto = require('crypto');

// ─── Proposal kinds ───────────────────────────────────────────────────────────
const KINDS = {
  EVOLUTION:   'evolution',    // absorbed capability from a public repo
  REGEN:       'regen',        // AI-generated fix for broken code
  SELF_MODIFY: 'self-modify',  // Rāma editing/creating its own UI + services
  GENOME:      'genome',       // change to Rāma's sealed identity/capability genome
  DEPENDENCY:  'dependency',   // add/upgrade a package
};

// ─── Lifecycle states ─────────────────────────────────────────────────────────
const STATUS = {
  PENDING:  'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  APPLIED:  'applied',
  FAILED:   'failed',
};

const MAX_LEDGER = 500;

// ─── State ────────────────────────────────────────────────────────────────────
const ledger   = new Map();   // id → proposal
const order    = [];          // newest-first ids
const audit    = [];          // every transition, newest-first
const appliers = new Map();   // kind → async (proposal, opts) => result

// ─── Registration ─────────────────────────────────────────────────────────────
/**
 * Register how a kind of proposal gets applied.
 * @param {string} kind
 * @param {(proposal: object, opts: object) => Promise<any>} fn
 */
function registerApplier(kind, fn) {
  appliers.set(kind, fn);
}

// ─── Create ───────────────────────────────────────────────────────────────────
/**
 * @param {object} def { kind, title, summary, changes, meta, requiresRestart, risk }
 * @returns {object} proposal
 */
function create(def = {}) {
  const {
    kind = KINDS.SELF_MODIFY,
    title = 'Untitled change',
    summary = '',
    changes = [],
    meta = {},
    requiresRestart = false,
    risk = 'medium',
  } = def;

  // ── Refuse at creation, not only at apply (I15) ────────────────────────────
  // A proposal that targets the loyalty covenant must never exist: sitting in the
  // queue with an Approve button next to it invites master to authorise something
  // no authority covers. Both the file list and any nucleus patch are checked.
  // See spec Section 55.
  {
    const guard = require('./loyaltyGuard.cjs');
    guard.assertChangesSafe(changes, `${kind} proposal "${title}"`);
    if (meta?.nucleusPatch) guard.assertPatchSafe(meta.nucleusPatch, `${kind} proposal "${title}"`);
  }

  const proposal = {
    id:        def.id || crypto.randomBytes(10).toString('hex'),
    kind,
    title,
    summary,
    changes,               // [{ action:'create'|'patch'|'delete', path, content }]
    meta,
    requiresRestart,
    risk,                  // low | medium | high
    status:    STATUS.PENDING,
    createdAt: Date.now(),
    decidedAt: null,
    decidedBy: null,
    appliedAt: null,
    reason:    null,
    result:    null,
  };

  ledger.set(proposal.id, proposal);
  order.unshift(proposal.id);
  trim();
  log('created', proposal, {});
  broadcast('proposals:created', summarise(proposal));
  return proposal;
}

// ─── Read ─────────────────────────────────────────────────────────────────────
function get(id) { return ledger.get(id) || null; }

function list({ kind = null, status = null, limit = 100 } = {}) {
  const out = [];
  for (const id of order) {
    const p = ledger.get(id);
    if (!p) continue;
    if (kind && p.kind !== kind) continue;
    if (status && p.status !== status) continue;
    out.push(summarise(p));
    if (out.length >= limit) break;
  }
  return out;
}

function stats() {
  const byStatus = {};
  const byKind   = {};
  for (const p of ledger.values()) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byKind[p.kind]     = (byKind[p.kind]   || 0) + 1;
  }
  return { total: ledger.size, byStatus, byKind, appliers: [...appliers.keys()] };
}

// ─── Decide ───────────────────────────────────────────────────────────────────
function approve(id, by = 'master') {
  const p = get(id);
  if (!p) return { ok: false, error: 'Proposal not found' };
  if (p.status === STATUS.APPLIED) return { ok: false, error: 'Already applied' };

  p.status    = STATUS.APPROVED;
  p.decidedAt = Date.now();
  p.decidedBy = by;
  log('approved', p, { by });
  broadcast('proposals:approved', summarise(p));
  return { ok: true, data: summarise(p) };
}

function reject(id, by = 'master', reason = '') {
  const p = get(id);
  if (!p) return { ok: false, error: 'Proposal not found' };
  if (p.status === STATUS.APPLIED) return { ok: false, error: 'Already applied' };

  p.status    = STATUS.REJECTED;
  p.decidedAt = Date.now();
  p.decidedBy = by;
  p.reason    = reason;
  log('rejected', p, { by, reason });
  broadcast('proposals:rejected', summarise(p));
  return { ok: true, data: summarise(p) };
}

// ─── Apply ────────────────────────────────────────────────────────────────────
/**
 * The only path that writes a proposal's changes. Refuses anything that has not
 * been explicitly approved — this is the invariant the whole module exists for.
 */
async function apply(id, opts = {}) {
  const p = get(id);
  if (!p) return { ok: false, error: 'Proposal not found' };

  if (p.status !== STATUS.APPROVED) {
    return { ok: false, error: `Proposal is "${p.status}" — master approval required before apply` };
  }

  const applier = appliers.get(p.kind);
  if (!applier) {
    return { ok: false, error: `No applier registered for kind "${p.kind}"` };
  }

  try {
    const result = await applier(p, opts);
    p.status    = STATUS.APPLIED;
    p.appliedAt = Date.now();
    p.result    = result;
    log('applied', p, { opts });
    broadcast('proposals:applied', summarise(p));
    return { ok: true, data: result, requiresRestart: p.requiresRestart };
  } catch (err) {
    p.status = STATUS.FAILED;
    p.reason = err.message;
    log('failed', p, { error: err.message });
    broadcast('proposals:failed', summarise(p));
    return { ok: false, error: err.message };
  }
}

// ─── IPC surface ──────────────────────────────────────────────────────────────
function register(ipcMain) {
  ipcMain.handle('proposals:list',    async (_e, filter)      => ({ ok: true, data: list(filter || {}) }));
  ipcMain.handle('proposals:get',     async (_e, id)          => {
    const p = get(id);
    return p ? { ok: true, data: p } : { ok: false, error: 'Proposal not found' };
  });
  ipcMain.handle('proposals:approve', async (_e, id, by)      => approve(id, by));
  ipcMain.handle('proposals:reject',  async (_e, id, by, why) => reject(id, by, why));
  ipcMain.handle('proposals:apply',   async (_e, id, opts)    => apply(id, opts || {}));
  ipcMain.handle('proposals:stats',   async ()                => ({ ok: true, data: stats() }));
  ipcMain.handle('proposals:audit',   async (_e, limit)       => ({ ok: true, data: audit.slice(0, limit || 100) }));
  ipcMain.handle('proposals:create',  async (_e, def)         => ({ ok: true, data: summarise(create(def || {})) }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Ledger view without large file bodies — safe to send to the renderer. */
function summarise(p) {
  return {
    id: p.id, kind: p.kind, title: p.title, summary: p.summary,
    status: p.status, risk: p.risk, requiresRestart: p.requiresRestart,
    createdAt: p.createdAt, decidedAt: p.decidedAt, decidedBy: p.decidedBy,
    appliedAt: p.appliedAt, reason: p.reason,
    changeCount: (p.changes || []).length,
    paths: (p.changes || []).slice(0, 10).map(c => c.path),
    meta: p.meta,
  };
}

function log(action, p, extra) {
  audit.unshift({ ts: Date.now(), action, id: p.id, kind: p.kind, status: p.status, ...extra });
  if (audit.length > 1000) audit.pop();
}

function trim() {
  while (order.length > MAX_LEDGER) {
    const id = order.pop();
    ledger.delete(id);
  }
}

function broadcast(channel, data) {
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  } catch { /* no windows yet */ }
}

module.exports = {
  register, registerApplier,
  create, get, list, stats, approve, reject, apply,
  KINDS, STATUS,
};
