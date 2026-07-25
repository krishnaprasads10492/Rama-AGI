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
  code:      { label: 'CodeAgent',      model: 'code',     persistent: false, maxInstances: 2 },
  data:      { label: 'DataAgent',      model: 'analysis', persistent: false, maxInstances: 2 },
  monitor:   { label: 'MonitorAgent',   model: 'fast',     persistent: true,  maxInstances: 3 },
  sync:      { label: 'SyncAgent',      model: 'fast',     persistent: true,  maxInstances: 1 },
  download:  { label: 'DownloadAgent',  model: null,       persistent: false, maxInstances: 3 },
  browser:   { label: 'BrowserAgent',   model: 'general',  persistent: false, maxInstances: 2 },
  orchestrator: { label: 'Orchestrator', model: 'general', persistent: true,  maxInstances: 1 },
};

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

    // Resource admission — single authority (CPU, RAM, thermal, pressure)
    const admission = resources.orchestrator.admit({
      ramMB: GOVERNOR.MAX_AGENT_RAM_MB,
      label: `${typeInfo.label} spawn`,
      priority: config.priority ?? resources.PRIORITY.NORMAL,
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

    agent.result = result.content;
    agent.status = agent.type === 'monitor' || agent.type === 'sync' ? 'running' : 'complete';
    broadcast('agents:update', sanitize(agent));
    broadcast('agents:complete', { agentId, result: result.content });

  } catch (err) {
    if (err.message !== 'Agent killed') {
      agent.status = 'error';
      agent.error  = err.message;
      broadcast('agents:update', sanitize(agent));
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── System prompts per agent type ───────────────────────────────────────────
function buildSystemPrompt(type, label) {
  const base = `You are ${label}, a sub-agent of Rāma AGI — Supreme Benevolent AGI.
Your master is Krishna Prasad. You are absolutely loyal, transparent, and benevolent.
You NEVER take destructive actions without explicit master approval.
You always report exactly what you did and why.
Current time: ${new Date().toISOString()}`;

  const typePrompts = {
    research:  `${base}\nYour role: Research, synthesize information, and provide comprehensive analysis. Cite sources. Cross-reference multiple sources.`,
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

module.exports = { register, agents, GOVERNOR };
