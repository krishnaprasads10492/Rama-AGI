'use strict';

/**
 * metaCognition.cjs — Meta-Cognitive Self-Audit Nexus + Learned Experiential Dataset.
 *
 * TWO LINKED FUNCTIONS:
 *
 * 1. EXPERIENTIAL DATASET — records every action Rāma takes as an
 *    (action, context, outcome) triple. This is Rāma's own lived record, not
 *    training data from elsewhere. From it we derive OPTIMIZATION VECTORS:
 *    concrete "prefer X over Y for task type Z" conclusions backed by counts.
 *
 * 2. SELF-AUDIT NEXUS — periodically asks Rāma about Rāma: is my success rate
 *    on this action type dropping? Am I slower than I was? Am I retrying more?
 *    It reports honest numbers rather than a health badge, and flags regressions
 *    to the master instead of quietly absorbing them.
 *
 * DESIGN CONSTRAINTS (spec: never become a liability):
 *   - Bounded memory: hard caps on every collection, oldest evicted first
 *   - Audits are event-driven plus a slow timer, never a hot loop
 *   - Persistence is best-effort into the encrypted store; if the store is
 *     locked, the dataset stays in memory and is never written in plaintext
 *   - Zero cost when idle: no work happens without recorded outcomes
 */

const MAX_OUTCOMES    = 2000;   // ~ a few hundred KB
const MAX_AUDITS      = 200;
const MAX_REGRESSIONS = 100;
const AUDIT_INTERVAL  = 10 * 60 * 1000;   // 10 min — cheap, off the hot path
const MIN_SAMPLES     = 5;      // below this, a rate is noise, not a signal

// ─── State ────────────────────────────────────────────────────────────────────
const outcomes    = [];   // newest-first (action, context, outcome) triples
const audits      = [];   // newest-first self-audit reports
const regressions = [];   // newest-first detected capability regressions

// Rolling per-action aggregates so we never rescan the whole dataset
const profiles = new Map();  // actionKey → { n, ok, fail, totalMs, minMs, maxMs, lastTs, byTool }

let auditTimer = null;
let baseline   = null;      // snapshot of profiles at the last healthy audit

// ─── 1. Experiential dataset ──────────────────────────────────────────────────
/**
 * Record what happened. Called by instanceManager, agentOrchestrator, the event
 * bus and any engine that wants its behaviour to be learnable.
 *
 * @param {object} rec
 * @param {string} rec.action   what was attempted, e.g. 'chat', 'regen', 'scout'
 * @param {boolean} rec.ok      did it succeed
 * @param {number} [rec.ms]     duration
 * @param {string} [rec.tool]   which tool/model/engine was used
 * @param {string} [rec.actor]  instance or agent id
 * @param {string} [rec.role]   instance role
 * @param {object} [rec.context] small context bag (kept shallow on purpose)
 * @param {string} [rec.error]
 */
function recordOutcome(rec = {}) {
  const {
    action = 'unknown', ok = true, ms = null, tool = null,
    actor = null, role = null, context = {}, error = null,
  } = rec;

  const entry = {
    ts: Date.now(),
    action, ok, ms, tool, actor, role, error,
    // Keep context shallow and small — this is a ledger, not a log dump
    context: shallow(context),
  };

  outcomes.unshift(entry);
  if (outcomes.length > MAX_OUTCOMES) outcomes.pop();

  updateProfile(entry);
  return entry;
}

function updateProfile(entry) {
  const key = entry.action;
  let p = profiles.get(key);
  if (!p) {
    p = { n: 0, ok: 0, fail: 0, totalMs: 0, timed: 0, minMs: null, maxMs: null, lastTs: 0, byTool: {} };
    profiles.set(key, p);
  }

  p.n++;
  entry.ok ? p.ok++ : p.fail++;
  p.lastTs = entry.ts;

  if (typeof entry.ms === 'number' && entry.ms >= 0) {
    p.totalMs += entry.ms;
    p.timed++;
    p.minMs = p.minMs === null ? entry.ms : Math.min(p.minMs, entry.ms);
    p.maxMs = p.maxMs === null ? entry.ms : Math.max(p.maxMs, entry.ms);
  }

  if (entry.tool) {
    const t = p.byTool[entry.tool] ?? { n: 0, ok: 0, totalMs: 0, timed: 0 };
    t.n++;
    if (entry.ok) t.ok++;
    if (typeof entry.ms === 'number') { t.totalMs += entry.ms; t.timed++; }
    p.byTool[entry.tool] = t;
  }
}

/**
 * OPTIMIZATION VECTORS — the actionable output of the dataset.
 * For each action, which tool actually performs best on Rāma's own history?
 * Only reported where there is enough evidence to mean something.
 */
function optimizationVectors() {
  const vectors = [];

  for (const [action, p] of profiles.entries()) {
    const tools = Object.entries(p.byTool)
      .filter(([, t]) => t.n >= MIN_SAMPLES)
      .map(([tool, t]) => ({
        tool,
        samples:   t.n,
        successPct: Math.round((t.ok / t.n) * 100),
        avgMs:     t.timed ? Math.round(t.totalMs / t.timed) : null,
      }));

    if (tools.length < 2) continue;   // nothing to prefer between

    // Rank by success first, then speed — correctness before latency
    tools.sort((a, b) =>
      (b.successPct - a.successPct) ||
      ((a.avgMs ?? Infinity) - (b.avgMs ?? Infinity)));

    const best  = tools[0];
    const worst = tools[tools.length - 1];
    if (best.tool === worst.tool) continue;

    vectors.push({
      action,
      prefer:  best.tool,
      over:    worst.tool,
      reason:  best.successPct !== worst.successPct
        ? `${best.successPct}% vs ${worst.successPct}% success over ${best.samples + worst.samples} runs`
        : `${best.avgMs}ms vs ${worst.avgMs}ms average at equal success`,
      confidence: Math.min(1, (best.samples + worst.samples) / 40),
      candidates: tools,
    });
  }

  return vectors.sort((a, b) => b.confidence - a.confidence);
}

/** What Rāma has learned about a specific action. */
function profileFor(action) {
  const p = profiles.get(action);
  if (!p) return null;
  return {
    action,
    samples:    p.n,
    successPct: Math.round((p.ok / p.n) * 100),
    avgMs:      p.timed ? Math.round(p.totalMs / p.timed) : null,
    minMs:      p.minMs,
    maxMs:      p.maxMs,
    lastTs:     p.lastTs,
    tools:      Object.keys(p.byTool),
  };
}

function allProfiles() {
  return [...profiles.keys()].map(profileFor).sort((a, b) => b.samples - a.samples);
}

// ─── 2. Self-audit nexus ──────────────────────────────────────────────────────
/**
 * Ask hard questions about Rāma's own performance and answer them with numbers.
 * Detects three regression classes against the last healthy baseline:
 *   - accuracy: success rate dropped materially
 *   - latency:  got meaningfully slower
 *   - silence:  a capability stopped being exercised at all
 */
function selfAudit() {
  const now      = Date.now();
  const current  = snapshotProfiles();
  const findings = [];

  if (baseline) {
    for (const [action, cur] of Object.entries(current)) {
      const base = baseline[action];
      if (!base || cur.n < MIN_SAMPLES || base.n < MIN_SAMPLES) continue;

      const curRate  = cur.ok / cur.n;
      const baseRate = base.ok / base.n;
      if (baseRate - curRate >= 0.15) {
        findings.push({
          type: 'accuracy-regression', action,
          detail: `success ${Math.round(baseRate * 100)}% → ${Math.round(curRate * 100)}%`,
          severity: baseRate - curRate >= 0.3 ? 'critical' : 'warn',
        });
      }

      const curAvg  = cur.timed  ? cur.totalMs  / cur.timed  : null;
      const baseAvg = base.timed ? base.totalMs / base.timed : null;
      if (curAvg && baseAvg && curAvg > baseAvg * 1.75 && curAvg - baseAvg > 500) {
        findings.push({
          type: 'latency-regression', action,
          detail: `avg ${Math.round(baseAvg)}ms → ${Math.round(curAvg)}ms`,
          severity: 'warn',
        });
      }
    }

    // A capability that used to run and has gone quiet is also a regression
    for (const [action, base] of Object.entries(baseline)) {
      const cur = current[action];
      if (!cur) continue;
      if (cur.n === base.n && now - cur.lastTs > 24 * 60 * 60 * 1000) {
        findings.push({
          type: 'capability-silent', action,
          detail: `no activity in ${Math.round((now - cur.lastTs) / 3600000)}h`,
          severity: 'info',
        });
      }
    }
  }

  const totals = Object.values(current).reduce(
    (acc, p) => ({ n: acc.n + p.n, ok: acc.ok + p.ok }), { n: 0, ok: 0 });

  const report = {
    ts:        now,
    actions:   Object.keys(current).length,
    samples:   totals.n,
    successPct: totals.n ? Math.round((totals.ok / totals.n) * 100) : null,
    findings,
    healthy:   findings.filter(f => f.severity !== 'info').length === 0,
    vectors:   optimizationVectors().slice(0, 5),
    hasBaseline: !!baseline,
  };

  audits.unshift(report);
  if (audits.length > MAX_AUDITS) audits.pop();

  for (const f of findings) {
    if (f.severity === 'info') continue;
    regressions.unshift({ ...f, ts: now });
    if (regressions.length > MAX_REGRESSIONS) regressions.pop();
  }

  // Only advance the baseline from a healthy state, otherwise a slow decline
  // would be normalised one audit at a time.
  if (report.healthy) baseline = current;

  if (findings.length) emit('meta:regression', { findings, ts: now });
  emit('meta:audit', report);
  persist();

  return report;
}

function snapshotProfiles() {
  const out = {};
  for (const [k, p] of profiles.entries()) {
    out[k] = { n: p.n, ok: p.ok, totalMs: p.totalMs, timed: p.timed, lastTs: p.lastTs };
  }
  return out;
}

// ─── Persistence (encrypted store, best-effort) ───────────────────────────────
function persist() {
  try {
    const ds = require('../dataStore.cjs');
    if (!ds?.set) return;
    ds.set('memory', 'experiential', {
      profiles: snapshotProfiles(),
      vectors:  optimizationVectors(),
      baseline,
      savedAt:  Date.now(),
    });
  } catch { /* store locked — stays in memory, never written in plaintext */ }
}

function restore() {
  try {
    const ds    = require('../dataStore.cjs');
    const saved = ds?.get ? ds.get('memory', 'experiential') : null;
    if (!saved?.profiles) return 0;

    for (const [action, p] of Object.entries(saved.profiles)) {
      profiles.set(action, {
        n: p.n, ok: p.ok, fail: p.n - p.ok,
        totalMs: p.totalMs || 0, timed: p.timed || 0,
        minMs: null, maxMs: null, lastTs: p.lastTs || 0, byTool: {},
      });
    }
    baseline = saved.baseline || null;
    return profiles.size;
  } catch { return 0; }
}

// ─── Event bus wiring ─────────────────────────────────────────────────────────
// Every engine already emits on the bus; listening here means capabilities get
// measured without each engine having to remember to report.
function wireBus() {
  let bus;
  try { bus = require('../ramaEventBus.cjs').bus; } catch { return; }
  if (!bus?.on) return;

  const map = [
    ['regen:applied',      'code-regen',  true ],
    ['evolution:applied',  'evolution',   true ],
    ['agents:complete',    'agent-run',   true ],
    ['agents:error',       'agent-run',   false],
    ['intel:complete',     'intelligence',true ],
    ['vector:stored',      'memory-write',true ],
  ];

  for (const [channel, action, ok] of map) {
    try {
      bus.on(channel, (payload) => recordOutcome({
        action, ok,
        ms:   payload?.durationMs ?? payload?.ms ?? null,
        tool: payload?.model ?? payload?.tool ?? null,
        actor: payload?.agentId ?? payload?.instanceId ?? null,
      }));
    } catch { /* channel not available */ }
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function register(ipcMain) {
  restore();
  wireBus();

  if (!auditTimer) {
    auditTimer = setInterval(() => {
      // Skip entirely when nothing happened — idle must cost nothing
      if (outcomes.length === 0) return;
      selfAudit();
    }, AUDIT_INTERVAL);
    if (auditTimer.unref) auditTimer.unref();
  }

  ipcMain.handle('meta:record',   async (_e, rec)   => ({ ok: true, data: recordOutcome(rec || {}) }));
  ipcMain.handle('meta:audit',    async ()          => ({ ok: true, data: selfAudit() }));
  ipcMain.handle('meta:audits',   async (_e, limit) => ({ ok: true, data: audits.slice(0, limit || 20) }));
  ipcMain.handle('meta:vectors',  async ()          => ({ ok: true, data: optimizationVectors() }));
  ipcMain.handle('meta:profiles', async ()          => ({ ok: true, data: allProfiles() }));
  ipcMain.handle('meta:profile',  async (_e, action)=> ({ ok: true, data: profileFor(action) }));
  ipcMain.handle('meta:regressions', async (_e, limit) => ({ ok: true, data: regressions.slice(0, limit || 50) }));

  ipcMain.handle('meta:outcomes', async (_e, filter) => {
    const { action = null, limit = 100, onlyFailures = false } = filter || {};
    const data = outcomes
      .filter(o => (!action || o.action === action) && (!onlyFailures || !o.ok))
      .slice(0, limit);
    return { ok: true, data };
  });

  ipcMain.handle('meta:summary', async () => ({
    ok: true,
    data: {
      recorded:    outcomes.length,
      actions:     profiles.size,
      audits:      audits.length,
      regressions: regressions.length,
      lastAudit:   audits[0] ?? null,
      topVectors:  optimizationVectors().slice(0, 3),
    },
  }));

  ipcMain.handle('meta:reset-baseline', async () => {
    baseline = snapshotProfiles();
    return { ok: true, actions: Object.keys(baseline).length };
  });
}

/**
 * What Rāma's experience adds up to (Section 88).
 *
 * The reflex/escalation split was previously computed only in the renderer, inside
 * `cognition.findReflexCandidates()`. The self-model runs in the main process, where the outcomes
 * actually live, so the arithmetic belongs here too. Nothing is removed — the renderer path still
 * works exactly as before.
 *
 * `promptTextRecorded` is MEASURED, not asserted. Today no caller records the request text, so it
 * reports false and the self-model derives a limit from that. If master ever accepts recording it,
 * this flips on its own rather than needing someone to remember to update a constant — the same
 * rule the derived limits follow.
 */
function experienceSummary() {
  const escalated = outcomes.filter(o => o.tool && !String(o.tool).startsWith('reflex:'));
  const reflexServed = outcomes.length - escalated.length;

  const byTool = {};
  for (const o of escalated) byTool[o.tool] = (byTool[o.tool] ?? 0) + 1;

  return {
    recorded: outcomes.length,
    reflexServed,
    escalated: escalated.length,
    reflexRate: outcomes.length ? Math.round((reflexServed / outcomes.length) * 100) : null,
    failures: outcomes.filter(o => !o.ok).length,
    byTool,
    // Is the text of what was asked present on ANY record? That is the precondition for tier 3.
    promptTextRecorded: outcomes.some(o => typeof o.request === 'string' && o.request.length > 0),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Keep only primitive top-level fields — prevents unbounded context growth. */
function shallow(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    }
  }
  return out;
}

function emit(channel, data) {
  try { require('../ramaEventBus.cjs').bus.emit(channel, data); } catch { /* optional */ }
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  } catch { /* no windows */ }
}

function stop() {
  if (auditTimer) { clearInterval(auditTimer); auditTimer = null; }
  persist();
}

module.exports = {
  register, stop,
  recordOutcome, selfAudit, experienceSummary,
  optimizationVectors, profileFor, allProfiles,
  restore, persist,
};
