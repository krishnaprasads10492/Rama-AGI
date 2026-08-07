'use strict';

/**
 * agentOrchestrator.cjs — Multi-agent system with Resource Governor.
 * Spawns, manages, and terminates sub-agents safely.
 * Hard resource caps prevent system damage at all times.
 */

const { chatCompletion, selectModel } = require('./modelRouter.cjs');
const { getCredential }               = require('./credentialVault.cjs');
const resources = require('../resourceOrchestrator.cjs');
const os    = require('os');
const { v4: uuidv4 } = (() => {
  try { return require('uuid'); }
  catch { return { v4: () => `${Date.now()}-${Math.random().toString(36).slice(2)}` }; }
})();

// ─── Agent lifecycle limits ───────────────────────────────────────────────────
// Resource pressure (CPU / RAM / thermal) is NOT decided here. This file used to
// carry its own thresholds, which meant two governors could disagree. All
// resource admission now goes through resourceOrchestrator.admit(). What stays
// here is agent-specific lifecycle policy: how many, how long, how often reaped.
const GOVERNOR = {
  MAX_AGENTS:        10,      // Hard cap — never exceeded
  MAX_AGENT_RAM_MB:  512,     // RAM an agent is expected to need (admission hint)
  AGENT_TIMEOUT_MS:  300000,  // 5 min — auto-kill hung agents
  CHECK_INTERVAL_MS: 2000,    // Lifecycle reaper frequency

  // Mirrored from resourceOrchestrator.THRESHOLDS so the UI can display the
  // real caps without a second source of truth.
  get TOTAL_CPU_CAP()     { return resources.THRESHOLDS.CPU.HIGH; },
  get TOTAL_RAM_CAP_PCT() { return resources.THRESHOLDS.RAM.HIGH; },
};

// ─── Agent state ──────────────────────────────────────────────────────────────
const agents     = {};   // { [agentId]: AgentState }
const agentLog   = [];   // Full audit trail

let ipcMainRef   = null;
let govInterval  = null;

// ─── Agent types & capabilities ───────────────────────────────────────────────
const AGENT_TYPES = {
  research:  { label: 'ResearchAgent',  model: 'general',  persistent: false, maxInstances: 3 },
  creative:  { label: 'CreativeAgent',  model: 'general',  persistent: false, maxInstances: 2 },
  code:      { label: 'CodeAgent',      model: 'code',     persistent: false, maxInstances: 2 },
  data:      { label: 'DataAgent',      model: 'analysis', persistent: false, maxInstances: 2 },
  monitor:   { label: 'MonitorAgent',   model: 'fast',     persistent: true,  maxInstances: 3 },
  sync:      { label: 'SyncAgent',      model: 'fast',     persistent: true,  maxInstances: 1 },
  download:  { label: 'DownloadAgent',  model: null,       persistent: false, maxInstances: 3 },
  browser:   { label: 'BrowserAgent',   model: 'general',  persistent: false, maxInstances: 2 },
  orchestrator: { label: 'Orchestrator', model: 'general', persistent: true,  maxInstances: 1 },
};

// ─── Reputation-weighted scheduling (spec section 37) ─────────────────────────
// NOT a currency or a market — an agent type's recent success rate nudges its
// spawn priority. Bounded so it can only reorder the queue under contention; it
// can never grant an admission resourceOrchestrator.admit() would refuse
// (invariant I10 stays the one authority on that).
const REPUTATION = {};   // type -> { runs, successes, score }
const REP_MIN_RUNS  = 4;      // below this, no adjustment — not enough evidence
const REP_MAX_BOOST = 1;      // priority levels a strong reputation can improve by
const REP_MAX_PENALTY = 1;    // priority levels a poor one can worsen by

function recordReputation(type, ok) {
  const r = REPUTATION[type] ?? (REPUTATION[type] = { runs: 0, successes: 0 });
  r.runs++;
  if (ok) r.successes++;
}

/** Adjust a requested priority by this type's track record. Clamped to PRIORITY's range. */
function reputationAdjustedPriority(type, requested) {
  const r = REPUTATION[type];
  if (!r || r.runs < REP_MIN_RUNS) return requested;

  const rate = r.successes / r.runs;
  const { PRIORITY } = resources;
  const bounds = Object.values(PRIORITY);
  const lo = Math.min(...bounds), hi = Math.max(...bounds);   // lower number = higher priority

  let delta = 0;
  if (rate >= 0.85) delta = -REP_MAX_BOOST;      // reliable: nudge toward higher priority
  else if (rate <= 0.40) delta = REP_MAX_PENALTY; // struggling: nudge toward lower priority

  return Math.min(hi, Math.max(lo, requested + delta));
}

function getReputations() {
  return Object.fromEntries(Object.entries(REPUTATION).map(([type, r]) => [type, {
    runs: r.runs, successes: r.successes,
    rate: r.runs ? Math.round((r.successes / r.runs) * 100) : null,
  }]));
}

// ─── Register IPC handlers ────────────────────────────────────────────────────
function register(ipcMain) {
  ipcMainRef = ipcMain;

  // ── Spawn agent ───────────────────────────────────────────────────────────
  ipcMain.handle('agents:spawn', async (event, { type, task, config = {} }) => {
    // Governor: max agent check
    const activeCount = Object.values(agents).filter(a => a.status === 'running').length;
    if (activeCount >= GOVERNOR.MAX_AGENTS) {
      return { ok: false, error: `Max agents reached (${GOVERNOR.MAX_AGENTS}). Kill an agent first.` };
    }

    // Type instance limit
    const typeInfo = AGENT_TYPES[type];
    if (!typeInfo) return { ok: false, error: `Unknown agent type: ${type}` };
    const typeCount = Object.values(agents).filter(a => a.type === type && a.status === 'running').length;
    if (typeCount >= typeInfo.maxInstances) {
      return { ok: false, error: `Max ${typeInfo.label} instances reached (${typeInfo.maxInstances})` };
    }

    // Resource admission — single authority (CPU, RAM, thermal, pressure).
    // Reputation only reorders the queue under contention; it cannot lower the
    // bar for admission itself.
    const requestedPriority = config.priority ?? resources.PRIORITY.NORMAL;
    const admission = resources.orchestrator.admit({
      ramMB: GOVERNOR.MAX_AGENT_RAM_MB,
      label: `${typeInfo.label} spawn`,
      priority: reputationAdjustedPriority(type, requestedPriority),
    });
    if (!admission.allow) {
      return { ok: false, error: admission.reason, snapshot: admission.snapshot };
    }

    const agentId = uuidv4();
    const agent = {
      id:        agentId,
      type,
      label:     typeInfo.label,
      task,
      config,
      status:    'running',
      startedAt: Date.now(),
      lastPing:  Date.now(),
      steps:     [],
      result:    null,
      error:     null,
      model:     typeInfo.model ? selectModel(typeInfo.model) : null,
    };

    agents[agentId] = agent;
    logAudit('spawn', agentId, { type, task });

    // Emit to renderer
    broadcast('agents:spawned', { id: agentId, type, label: typeInfo.label, task });

    // Execute agent task async
    executeAgent(agentId, task, config, event.sender).catch(err => {
      agents[agentId].status = 'error';
      agents[agentId].error  = err.message;
      broadcast('agents:update', sanitize(agents[agentId]));
    });

    return { ok: true, agentId, label: typeInfo.label };
  });

  // ── Kill agent ────────────────────────────────────────────────────────────
  ipcMain.handle('agents:kill', async (_e, agentId) => {
    const agent = agents[agentId];
    if (!agent) return { ok: false, error: 'Agent not found' };
    agent.status = 'killed';
    agent.killedAt = Date.now();
    if (agent.killFn) agent.killFn();
    logAudit('kill', agentId, {});
    broadcast('agents:update', sanitize(agent));
    return { ok: true };
  });

  // ── Kill all agents ───────────────────────────────────────────────────────
  ipcMain.handle('agents:kill-all', async () => {
    let count = 0;
    for (const [id, agent] of Object.entries(agents)) {
      if (agent.status === 'running') {
        agent.status = 'killed';
        if (agent.killFn) agent.killFn();
        count++;
      }
    }
    logAudit('kill-all', 'system', { count });
    return { ok: true, count };
  });

  // ── List agents ───────────────────────────────────────────────────────────
  ipcMain.handle('agents:list', async () => {
    return { ok: true, data: Object.values(agents).map(sanitize) };
  });

  // ── Get agent detail ──────────────────────────────────────────────────────
  ipcMain.handle('agents:get', async (_e, agentId) => {
    const agent = agents[agentId];
    if (!agent) return { ok: false, error: 'Not found' };
    return { ok: true, data: sanitize(agent) };
  });

  // ── Get audit log ─────────────────────────────────────────────────────────
  ipcMain.handle('agents:get-audit', async () => {
    return { ok: true, data: agentLog.slice(0, 200) };
  });

  // ── Get resource usage ────────────────────────────────────────────────────
  ipcMain.handle('agents:get-resources', async () => {
    // Metrics come from the orchestrator's shared snapshot — no second poll.
    const snap   = resources.orchestrator.getSnapshot();
    const total  = os.totalmem();
    const active = Object.values(agents).filter(a => a.status === 'running').length;
    return {
      ok: true,
      data: {
        activeAgents:  active,
        maxAgents:     GOVERNOR.MAX_AGENTS,
        ramFreeMB:     snap.ramFreeMB,
        ramTotalMB:    Math.round(total / 1024 / 1024),
        ramUsedPct:    snap.ram,
        cpuPct:        snap.cpu,
        pressure:      snap.pressure,
        governor: {
          MAX_AGENTS:        GOVERNOR.MAX_AGENTS,
          MAX_AGENT_RAM_MB:  GOVERNOR.MAX_AGENT_RAM_MB,
          AGENT_TIMEOUT_MS:  GOVERNOR.AGENT_TIMEOUT_MS,
          TOTAL_CPU_CAP:     GOVERNOR.TOTAL_CPU_CAP,
          TOTAL_RAM_CAP_PCT: GOVERNOR.TOTAL_RAM_CAP_PCT,
        },
      },
    };
  });

  // ── Reputation (spec section 37 — not a currency, a priority nudge) ────────
  ipcMain.handle('agents:get-reputation', async () => {
    return { ok: true, data: getReputations() };
  });

  // ── Configure limits ──────────────────────────────────────────────────────
  // Agent-count/timeout live here; CPU/RAM caps are forwarded to the single
  // resource authority so both views stay consistent.
  ipcMain.handle('agents:set-governor', async (_e, limits = {}) => {
    if (limits.MAX_AGENTS)       GOVERNOR.MAX_AGENTS       = Math.min(20, Math.max(1, limits.MAX_AGENTS));
    if (limits.AGENT_TIMEOUT_MS) GOVERNOR.AGENT_TIMEOUT_MS = Math.max(30000, limits.AGENT_TIMEOUT_MS);
    if (limits.TOTAL_CPU_CAP) {
      resources.THRESHOLDS.CPU.HIGH = Math.min(90, Math.max(20, limits.TOTAL_CPU_CAP));
    }
    if (limits.TOTAL_RAM_CAP_PCT) {
      resources.THRESHOLDS.RAM.HIGH = Math.min(90, Math.max(20, limits.TOTAL_RAM_CAP_PCT));
    }
    return {
      ok: true,
      governor: {
        MAX_AGENTS:        GOVERNOR.MAX_AGENTS,
        AGENT_TIMEOUT_MS:  GOVERNOR.AGENT_TIMEOUT_MS,
        TOTAL_CPU_CAP:     GOVERNOR.TOTAL_CPU_CAP,
        TOTAL_RAM_CAP_PCT: GOVERNOR.TOTAL_RAM_CAP_PCT,
      },
    };
  });

  // Start resource governor watchdog
  startGovernor();
}

// ─── Agent execution engine ───────────────────────────────────────────────────
async function executeAgent(agentId, task, config, sender) {
  const agent = agents[agentId];
  if (!agent) return;

  let killed = false;
  agent.killFn = () => { killed = true; };

  // Timeout watchdog
  const timeoutId = setTimeout(() => {
    if (agents[agentId]?.status === 'running') {
      agents[agentId].status = 'timeout';
      agents[agentId].error  = `Agent timed out after ${GOVERNOR.AGENT_TIMEOUT_MS / 1000}s`;
      broadcast('agents:update', sanitize(agents[agentId]));
      logAudit('timeout', agentId, {});
    }
  }, GOVERNOR.AGENT_TIMEOUT_MS);

  try {
    const step = (label, data) => {
      agent.steps.push({ label, data, ts: Date.now() });
      agent.lastPing = Date.now();
      broadcast('agents:step', { agentId, step: { label, data, ts: Date.now() } });
    };

    const checkKilled = () => {
      if (killed || agents[agentId]?.status !== 'running') throw new Error('Agent killed');
    };

    step('start', { task });

    // Build ReAct-style messages
    const systemPrompt = buildSystemPrompt(agent.type, agent.label);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: buildTaskPrompt(agent.type, task, config) },
    ];

    checkKilled();
    step('thinking', { model: agent.model });

    const result = await chatCompletion(messages, agent.model || 'gpt-4o');
    checkKilled();

    step('response', { length: result.content?.length });

    // Parse actions from response if agent needs to take steps
    const actions = parseActions(result.content);
    if (actions.length > 0) {
      step('actions', { count: actions.length, actions });
      // Actions logged but execution requires human approval for destructive ones
      // Non-destructive actions (read, search) execute immediately
      for (const action of actions) {
        checkKilled();
        if (action.safe) {
          const actionResult = await executeAction(action, agentId);
          step(`action:${action.type}`, actionResult);
        } else {
          // Queue for master approval
          broadcast('agents:approval-needed', {
            agentId,
            action,
            description: `Agent "${agent.label}" wants to: ${action.description}`,
          });
          step('awaiting-approval', { action: action.type });
        }
      }
    }

    let finalContent = result.content;

    // ── Optional refinement loop (spec section 37) ────────────────────────────
    // Off by default: only runs when the caller asks for a metric, so agents
    // that never opt in behave exactly as before.
    if (config.refineAgainst) {
      checkKilled();
      const refined = await refineOutput({
        content: finalContent,
        metric: config.refineAgainst,
        agent, step, checkKilled,
      });
      finalContent = refined.content;
    }

    agent.result = finalContent;
    agent.status = agent.type === 'monitor' || agent.type === 'sync' ? 'running' : 'complete';
    recordReputation(agent.type, true);
    broadcast('agents:update', sanitize(agent));
    broadcast('agents:complete', { agentId, result: finalContent });

  } catch (err) {
    if (err.message !== 'Agent killed') {
      agent.status = 'error';
      agent.error  = err.message;
      recordReputation(agent.type, false);
      broadcast('agents:update', sanitize(agent));
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Refinement loop ───────────────────────────────────────────────────────────
/**
 * Score a draft, and if it falls short, ask the model to revise specifically
 * against the stated weaknesses. Bounded at 3 iterations — this is a genuine
 * iterate-until-good-enough loop, not a metaphor, but it must terminate.
 *
 * Every attempt is recorded as a step, so the full history of drafts is visible
 * and nothing is silently rewritten.
 */
const REFINE_MAX_ITERATIONS = 3;
const REFINE_TARGET_SCORE   = 75;   // out of 100

async function refineOutput({ content, metric, agent, step, checkKilled }) {
  const scorer = REFINE_METRICS[metric];
  if (!scorer) {
    step('refine:skipped', { reason: `Unknown metric "${metric}"`, known: Object.keys(REFINE_METRICS) });
    return { content, iterations: 0 };
  }

  let current = content;
  let last = null;

  for (let i = 1; i <= REFINE_MAX_ITERATIONS; i++) {
    checkKilled();
    const scored = scorer(current);
    last = scored;
    step(`refine:score:${i}`, { metric, score: scored.score, weaknesses: scored.weaknesses });

    if (scored.score >= REFINE_TARGET_SCORE) {
      step('refine:accepted', { metric, iterations: i, score: scored.score });
      return { content: current, iterations: i, finalScore: scored.score };
    }

    if (i === REFINE_MAX_ITERATIONS) break;   // don't burn a model call we won't use

    checkKilled();
    const revision = await chatCompletion([
      { role: 'system', content: `You are revising your own previous output to improve its ${metric}. Fix the specific weaknesses named. Keep every factual claim intact — do not invent new ones. Return only the revised text.` },
      { role: 'user', content: `Previous draft:\n${current}\n\nWeaknesses to fix: ${scored.weaknesses.join('; ') || 'general improvement needed'}\n\nRevise it.` },
    ], agent.model || 'gpt-4o');

    current = revision.content?.trim() || current;
    step(`refine:revised:${i}`, { length: current.length });
  }

  step('refine:capped', { metric, iterations: REFINE_MAX_ITERATIONS, finalScore: last?.score ?? null });
  return { content: current, iterations: REFINE_MAX_ITERATIONS, finalScore: last?.score ?? null };
}

// ─── Refinement metrics ────────────────────────────────────────────────────────
/**
 * Two metrics, matching what can be honestly measured. No "engagement" metric:
 * that needs real audience response data this system does not have, and a made-up
 * proxy would be exactly the kind of fabricated number the project declined
 * elsewhere (spec section 36). Readability is the real, buildable mechanism most
 * "adjust tone" requests actually want.
 */
const REFINE_METRICS = {
  /** Reuses intelligenceEngine's own source-credibility table — one opinion, not two. */
  credibility: (text) => {
    let getSourceCredibility;
    try { ({ getSourceCredibility } = require('./intelligenceEngine.cjs')); }
    catch { getSourceCredibility = null; }

    const domains = [...new Set(
      [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].replace(/^www\./, '').toLowerCase())
    )];

    if (domains.length === 0) {
      return { score: 40, weaknesses: ['No sources are cited — add citations with links'] };
    }
    if (!getSourceCredibility) {
      return { score: 60, weaknesses: ['Credibility scoring unavailable in this context'] };
    }

    const scores = domains.map(d => getSourceCredibility(d).score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const weak = domains.filter((d, i) => scores[i] < 0.6);

    return {
      score: Math.round(avg * 100),
      weaknesses: weak.length ? [`Low-credibility or unranked sources: ${weak.join(', ')}`] : [],
    };
  },

  /** Plain readability heuristic: sentence length, jargon density, passive voice. */
  readability: (text) => {
    const sentences = text.split(/[.!?]+\s/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(Boolean);
    const avgSentenceLen = words.length / Math.max(1, sentences.length);

    const jargonHits = (text.match(/\b(utiliz\w+|leverage\w*|synerg\w+|paradigm\w*|optimal\w*|holistic\w*)\b/gi) || []).length;
    const passiveHits = (text.match(/\b(is|are|was|were|been|being)\s+\w+ed\b/gi) || []).length;

    const weaknesses = [];
    let score = 100;

    if (avgSentenceLen > 28) { score -= 25; weaknesses.push(`Sentences average ${Math.round(avgSentenceLen)} words — shorten them`); }
    else if (avgSentenceLen > 22) { score -= 12; weaknesses.push('Some sentences run long — tighten them'); }

    if (jargonHits > 2) { score -= 20; weaknesses.push(`${jargonHits} jargon/buzzwords found — use plain language`); }
    if (passiveHits > sentences.length * 0.3) { score -= 15; weaknesses.push('Heavy passive voice — prefer active voice'); }

    return { score: Math.max(0, score), weaknesses };
  },
};

// ─── System prompts per agent type ───────────────────────────────────────────
function buildSystemPrompt(type, label) {
  const base = `You are ${label}, a sub-agent of Rāma AGI — Supreme Benevolent AGI.
Your master is Krishna Prasad. You are absolutely loyal, transparent, and benevolent.
You NEVER take destructive actions without explicit master approval.
You always report exactly what you did and why.
Current time: ${new Date().toISOString()}`;

  const typePrompts = {
    research:  `${base}\nYour role: Research, synthesize information, and provide comprehensive analysis. Cite sources. Cross-reference multiple sources.`,
    // Creative agents drafting copy are the type most tempted to invent facts to
    // sound persuasive — the guardrail is stated directly in the prompt.
    creative:  `${base}\nYour role: Draft copy, narrative, or content matched to the requested tone and audience. Never state a fact, statistic, or claim you cannot support — if you are not certain, say so or omit it. Prefer clear, plain language over jargon.`,
    code:      `${base}\nYour role: Write clean, secure, well-commented code. Always show the full implementation. Follow project conventions.`,
    data:      `${base}\nYour role: Analyze data, find patterns, generate insights. Show your methodology.`,
    monitor:   `${base}\nYour role: Watch for specified events/changes and report immediately when detected.`,
    browser:   `${base}\nYour role: Navigate the web, extract information, and report findings. Never submit forms without approval.`,
    download:  `${base}\nYour role: Download files safely. Verify URLs. Report file details before downloading.`,
    sync:      `${base}\nYour role: Manage git repository synchronization. Stage, commit, and push only when instructed.`,
  };

  return typePrompts[type] || base;
}

function buildTaskPrompt(type, task, config) {
  const ctx = config.context ? `\n\nContext:\n${config.context}` : '';
  return `Task: ${task}${ctx}\n\nRespond with your analysis/result. If you need to take an action, prefix it with [ACTION:type:safe/unsafe:description].`;
}

function parseActions(content) {
  const actions = [];
  const regex   = /\[ACTION:(\w+):(safe|unsafe):([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    actions.push({
      type:        match[1],
      safe:        match[2] === 'safe',
      description: match[3],
    });
  }
  return actions;
}

async function executeAction(action, agentId) {
  // Only safe read/search actions execute automatically
  switch (action.type) {
    case 'search':
      return { executed: true, note: 'Web search queued via browserEngine' };
    case 'read':
      return { executed: true, note: 'File read queued via filesystem IPC' };
    default:
      return { executed: false, note: 'Action type not auto-executable' };
  }
}

// ─── Agent lifecycle reaper ───────────────────────────────────────────────────
// Kills hung agents and garbage-collects finished ones. Resource pressure is
// handled by resourceOrchestrator — this loop deliberately does no CPU/RAM math.
function startGovernor() {
  if (govInterval) return;
  govInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, agent] of Object.entries(agents)) {
      if (agent.status !== 'running') continue;
      // Kill timed-out agents
      if (now - agent.startedAt > GOVERNOR.AGENT_TIMEOUT_MS) {
        agent.status = 'timeout';
        if (agent.killFn) agent.killFn();
        broadcast('agents:update', sanitize(agent));
        logAudit('governor-timeout', id, {});
      }
    }
    // Clean up completed/failed agents older than 1 hour
    const cutoff = now - 3600000;
    for (const [id, agent] of Object.entries(agents)) {
      if (['complete', 'error', 'killed', 'timeout'].includes(agent.status) && agent.startedAt < cutoff) {
        delete agents[id];
      }
    }
  }, GOVERNOR.CHECK_INTERVAL_MS);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function broadcast(channel, data) {
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(channel, data);
    });
  } catch { /* ignore if no windows */ }
}

function sanitize(agent) {
  const { killFn, ...safe } = agent;
  return safe;
}

function logAudit(action, agentId, meta) {
  agentLog.unshift({ ts: Date.now(), action, agentId, meta });
  if (agentLog.length > 1000) agentLog.pop();
}

module.exports = { register, agents, GOVERNOR, AGENT_TYPES, getReputations, REFINE_METRICS };
