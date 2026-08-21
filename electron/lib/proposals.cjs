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

const crypto     = require('crypto');
const capability = require('./capability.cjs');

/**
 * Who is allowed to decide — enforced here, not at each channel (Section 57).
 *
 * `approve(id, by = 'master')` used to take the approver as a **free-text string**,
 * and three separate IPC handlers hardcoded `'master'`. So I6's approval gate was a
 * real state machine with no authorization behind it: anything that could reach
 * `evolution:approve`, `regen:approve` or `proposals:approve` was master as far as
 * the ledger was concerned.
 *
 * Six channels funnel into these three functions, so the check lives in the
 * functions. Same reasoning as the loyalty covenant at the encryption boundary:
 * gating six callers leaves the seventh, gating the chokepoint cannot be routed
 * around. A string is refused outright — a name is not an identity.
 *
 * @returns {{denied?:object, by?:string}}
 */
function authorise(user, cap, action) {
  if (typeof user === 'string') {
    return { denied: { ok: false, error: `${action} requires an authenticated user — "${user}" is a label, not an identity (I6)` } };
  }
  if (!user || typeof user.tier !== 'number') {
    return { denied: { ok: false, error: `${action} requires an authenticated user (I6)` } };
  }
  const denied = capability.deny(user, cap);
  if (denied) return { denied };
  return { by: `${user.name || user.id || 'user'} (tier ${user.tier})` };
}

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
function approve(id, user) {
  const auth = authorise(user, 'self-modify.apply', 'Approving a change');
  if (auth.denied) return auth.denied;
  const by = auth.by;

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

function reject(id, user, reason = '') {
  const auth = authorise(user, 'self-modify.apply', 'Rejecting a change');
  if (auth.denied) return auth.denied;
  const by = auth.by;

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
  // Applying is the moment Rāma's own source changes, so it carries the same
  // authorization as approving — an approved proposal is not a bearer token.
  const auth = authorise(opts.user, 'self-modify.apply', 'Applying a change');
  if (auth.denied) return auth.denied;

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
  // Reading the ledger is `self-modify.view` (tier 1); deciding is
  // `self-modify.apply` (tier 0) and is enforced inside approve/reject/apply so it
  // holds for the evolution: and regen: channels too. See Section 57.
  const canView = (user) => capability.deny(user, 'self-modify.view');

  ipcMain.handle('proposals:list',    async (_e, filter) => {
    const denied = canView(filter?.user); if (denied) return denied;
    return { ok: true, data: list(filter || {}) };
  });
  ipcMain.handle('proposals:get',     async (_e, id, user) => {
    const denied = canView(user); if (denied) return denied;
    const p = get(id);
    return p ? { ok: true, data: p } : { ok: false, error: 'Proposal not found' };
  });
  ipcMain.handle('proposals:approve', async (_e, id, user)      => approve(id, user));
  ipcMain.handle('proposals:reject',  async (_e, id, user, why) => reject(id, user, why));
  ipcMain.handle('proposals:apply',   async (_e, id, opts)      => apply(id, opts || {}));
  ipcMain.handle('proposals:stats',   async (_e, user) => {
    const denied = canView(user); if (denied) return denied;
    return { ok: true, data: stats() };
  });
  ipcMain.handle('proposals:audit',   async (_e, limit, user) => {
    const denied = canView(user); if (denied) return denied;
    return { ok: true, data: audit.slice(0, limit || 100) };
  });
  // Creating a proposal is intent, not authority — Rāma's own engines call
  // `create()` directly with no user, and apply() is what is gated. A
  // renderer-initiated create still needs the view capability so it cannot be
  // used to flood the queue anonymously.
  ipcMain.handle('proposals:create',  async (_e, def) => {
    const denied = canView(def?.user); if (denied) return denied;
    return { ok: true, data: summarise(create(def || {})) };
  });
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
