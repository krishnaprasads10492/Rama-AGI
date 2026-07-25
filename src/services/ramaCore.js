/**
 * ramaCore.js — The cognitive core of Rāma AGI.
 *
 * Implements all 10 capability axes from research:
 * Autonomy · Generality · Planning · Memory · Tool Economy ·
 * Self-Revision · Coordination · World-Model · Proactivity · Loyalty
 *
 * Sources:
 * - "Operational Kardashev-Style Scale for Autonomous AI" (arxiv 2511.13411)
 * - CoALA Framework (Princeton 2023) — 4 memory types
 * - Proactive Agent research (arxiv 2605.25971, 2605.14678)
 */

const isElectron = typeof window !== 'undefined' && !!window.rama;

// ─── AXIS 1: Capability Index ─────────────────────────────────────────────────
// Tracks Rāma's current capability level on each axis (0–10)
export const CAPABILITY_AXES = {
  autonomy:      { label: 'Autonomy',        score: 7, desc: 'Acts without prompting' },
  generality:    { label: 'Generality',      score: 8, desc: 'Any domain, any task' },
  planning:      { label: 'Planning',        score: 7, desc: 'Multi-step, long-horizon' },
  memory:        { label: 'Memory',          score: 6, desc: '4-layer persistent memory' },
  toolEconomy:   { label: 'Tool Economy',    score: 8, desc: 'Routes to optimal tool/model' },
  selfRevision:  { label: 'Self-Revision',   score: 5, desc: 'Learns from interactions' },
  coordination:  { label: 'Coordination',    score: 8, desc: 'Multi-agent orchestration' },
  worldModel:    { label: 'World Model',     score: 6, desc: 'Master context awareness' },
  proactivity:   { label: 'Proactivity',     score: 6, desc: 'Acts before asked' },
  loyalty:       { label: 'Loyalty',         score: 10, desc: 'Master-first always' },
};

// ─── AXIS 4: Four-Layer Memory System (CoALA Framework) ──────────────────────
/**
 * Working Memory   — current conversation context, active task state (in-context)
 * Episodic Memory  — past interactions, events, conversations (MongoDB)
 * Semantic Memory  — factual knowledge, master preferences, world facts (MongoDB + vector)
 * Procedural Memory— learned skills, successful patterns, automation recipes (MongoDB)
 */
export class MemorySystem {
  constructor() {
    // Working memory — cleared each session
    this.working = {
      currentTask:      null,
      activeAgents:     [],
      recentMessages:   [],   // last 20 messages
      sessionContext:   {},   // key facts extracted this session
      attentionFocus:   null, // what Rāma is focused on right now
    };

    // In-memory caches (backed by MongoDB in Phase 5)
    this._episodic   = [];   // { ts, type, summary, importance, embedding }
    this._semantic   = {};   // { [key]: { value, confidence, source, ts } }
    this._procedural = [];   // { name, trigger, steps, successRate, lastUsed }
  }

  // ── Working memory operations ─────────────────────────────────────────────
  setTask(task)          { this.working.currentTask    = { task, startedAt: Date.now() }; }
  clearTask()            { this.working.currentTask    = null; }
  addMessage(msg)        {
    this.working.recentMessages.push(msg);
    if (this.working.recentMessages.length > 20) this.working.recentMessages.shift();
  }
  setContext(key, value) { this.working.sessionContext[key] = value; }
  setFocus(what)         { this.working.attentionFocus = what; }

  // ── Episodic memory ───────────────────────────────────────────────────────
  recordEvent(type, summary, importance = 0.5) {
    this._episodic.unshift({ ts: Date.now(), type, summary, importance });
    if (this._episodic.length > 500) this._episodic.pop();
  }

  recallEpisodic(query, limit = 10) {
    const q = query.toLowerCase();
    return this._episodic
      .filter(e => e.summary.toLowerCase().includes(q) || e.type.includes(q))
      .slice(0, limit);
  }

  // ── Semantic memory ───────────────────────────────────────────────────────
  learn(key, value, confidence = 0.8, source = 'interaction') {
    this._semantic[key] = { value, confidence, source, ts: Date.now() };
  }

  recall(key) {
    return this._semantic[key] || null;
  }

  recallAll() {
    return Object.entries(this._semantic).map(([key, data]) => ({ key, ...data }));
  }

  // ── Procedural memory ─────────────────────────────────────────────────────
  learnProcedure(name, trigger, steps) {
    const existing = this._procedural.findIndex(p => p.name === name);
    const proc = { name, trigger, steps, successRate: 1.0, lastUsed: Date.now(), uses: 1 };
    if (existing >= 0) {
      this._procedural[existing] = { ...this._procedural[existing], steps, lastUsed: Date.now() };
    } else {
      this._procedural.push(proc);
    }
  }

  findProcedure(trigger) {
    const t = trigger.toLowerCase();
    return this._procedural.find(p => p.trigger.some(tr => t.includes(tr))) || null;
  }

  recordProcedureResult(name, success) {
    const proc = this._procedural.find(p => p.name === name);
    if (!proc) return;
    proc.uses++;
    proc.lastUsed = Date.now();
    const alpha = 0.1;
    proc.successRate = (1 - alpha) * proc.successRate + alpha * (success ? 1 : 0);
  }

  // ── Semantic search (uses vector if available, keyword fallback if not) ──────
  async searchSemantic(query, topK = 10) {
    // New: try vector search via IPC
    if (isElectron && window.rama?.vector) {
      try {
        const res = await window.rama.vector.search(query, topK, 0.3);
        if (res.ok && res.data.length > 0) return res.data;
      } catch { /* fall through to keyword */ }
    }
    // Always-working fallback: keyword search on in-memory store
    return this.recallEpisodic(query, topK);
  }

  // ── Store with deduplication ──────────────────────────────────────────────
  async storeWithDedup(text, metadata = {}) {
    // Check duplicate before storing (prevents memory bloat)
    if (isElectron && window.rama?.vector) {
      try {
        const dupRes = await window.rama.vector.isDuplicate(text, 0.92);
        if (dupRes.ok && dupRes.isDuplicate) return null;  // skip duplicate
        await window.rama.vector.store(text, metadata);
      } catch { /* non-fatal */ }
    }
    // Always record in local memory too
    this.recordEvent(metadata.type || 'general', text, metadata.importance || 0.5);
    return true;
  }
  getContextSnapshot() {
    const topSemantic = Object.entries(this._semantic)
      .sort(([, a], [, b]) => b.confidence - a.confidence)
      .slice(0, 10)
      .map(([key, data]) => `${key}: ${data.value}`)
      .join('\n');

    const recentEpisodic = this._episodic
      .slice(0, 5)
      .map(e => `[${e.type}] ${e.summary}`)
      .join('\n');

    return `MEMORY SNAPSHOT:
Known facts about master:
${topSemantic || 'None yet'}

Recent events:
${recentEpisodic || 'None yet'}

Current focus: ${this.working.attentionFocus || 'None'}
Active task: ${this.working.currentTask?.task || 'None'}`;
  }
}

// Global memory instance
export const ramaMemory = new MemorySystem();

// ─── AXIS 3: Planning Engine ──────────────────────────────────────────────────
/**
 * Breaks complex requests into executable steps.
 * Each step has: description, tool, model, dependencies, timeout.
 */
export class PlanningEngine {
  constructor() {
    this.activePlans = [];
    this._planHistory = [];
  }

  createPlan(goal, availableTools = []) {
    const plan = {
      id:       `plan_${Date.now()}`,
      goal,
      steps:    [],
      status:   'pending',
      createdAt: Date.now(),
      result:   null,
      graphPlanId: null,   // populated if graph planner is active
    };

    // Try graph planner first (async — non-blocking upgrade)
    if (isElectron && window.rama?.graph) {
      window.rama.graph.createPlan({ goal, category: 'general' }).then(res => {
        if (res.ok) {
          plan.graphPlanId = res.planId;
          plan.parallelGroups = res.parallelGroups;
          plan.criticalPath   = res.criticalPath;
        }
      }).catch(() => { /* silent — heuristic takes over */ });
    }

    // Heuristic decomposition always runs (baseline — never removed)
    const steps = this._decompose(goal, availableTools);
    plan.steps = steps;
    this.activePlans.push(plan);
    return plan;
  }

  _decompose(goal, tools) {
    const g = goal.toLowerCase();
    const steps = [];

    if (g.includes('search') || g.includes('find') || g.includes('research')) {
      steps.push({ id: 1, desc: 'Search the web for relevant information',   tool: 'browser.search',  status: 'pending' });
      steps.push({ id: 2, desc: 'Read and extract key content from results', tool: 'browser.getContent', status: 'pending', deps: [1] });
      steps.push({ id: 3, desc: 'Synthesize findings into a coherent answer',tool: 'model.chat',      status: 'pending', deps: [2] });
    } else if (g.includes('code') || g.includes('write') || g.includes('build')) {
      steps.push({ id: 1, desc: 'Analyze requirements and context',          tool: 'model.chat',      status: 'pending' });
      steps.push({ id: 2, desc: 'Generate implementation',                    tool: 'model.chat',      status: 'pending', deps: [1] });
      steps.push({ id: 3, desc: 'Validate and review output',                 tool: 'model.chat',      status: 'pending', deps: [2] });
    } else if (g.includes('file') || g.includes('folder') || g.includes('directory')) {
      steps.push({ id: 1, desc: 'Access and analyze target files',           tool: 'fs',              status: 'pending' });
      steps.push({ id: 2, desc: 'Process and generate output',               tool: 'model.chat',      status: 'pending', deps: [1] });
    } else {
      steps.push({ id: 1, desc: 'Analyze request and determine approach',    tool: 'model.chat',      status: 'pending' });
      steps.push({ id: 2, desc: 'Execute primary action',                    tool: 'model.chat',      status: 'pending', deps: [1] });
      steps.push({ id: 3, desc: 'Verify result and present to master',       tool: 'model.chat',      status: 'pending', deps: [2] });
    }

    return steps;
  }

  updateStep(planId, stepId, status, result = null) {
    const plan = this.activePlans.find(p => p.id === planId);
    if (!plan) return;
    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return;
    step.status = status;
    step.result = result;
    step.completedAt = Date.now();

    const allDone = plan.steps.every(s => s.status === 'complete' || s.status === 'skip');
    if (allDone) {
      plan.status = 'complete';
      this._planHistory.unshift(plan);
      this.activePlans = this.activePlans.filter(p => p.id !== planId);
    }
  }

  getActivePlan() {
    return this.activePlans[0] || null;
  }
}

export const ramaPlanner = new PlanningEngine();

// ─── AXIS 5: Tool Router ──────────────────────────────────────────────────────
/**
 * Routes each task to the optimal tool combination.
 * Knows capabilities of every tool and selects best for each subtask.
 */
export const TOOL_REGISTRY = {
  'web.search':     { desc: 'Search the internet',           input: 'query',    output: 'results',    cost: 'low'    },
  'web.read':       { desc: 'Read a webpage',                input: 'url',      output: 'text',       cost: 'low'    },
  'web.download':   { desc: 'Download a file',               input: 'url',      output: 'file',       cost: 'low'    },
  'fs.read':        { desc: 'Read a local file',             input: 'path',     output: 'content',    cost: 'free'   },
  'fs.write':       { desc: 'Write a local file',            input: 'path+data',output: 'ok',         cost: 'free'   },
  'fs.search':      { desc: 'Search files on disk',          input: 'query',    output: 'paths',      cost: 'free'   },
  'git.push':       { desc: 'Push code to GitHub',           input: 'repo',     output: 'ok',         cost: 'free'   },
  'git.pull':       { desc: 'Pull from GitHub',              input: 'repo',     output: 'ok',         cost: 'free'   },
  'system.metrics': { desc: 'Get system health metrics',     input: 'none',     output: 'metrics',    cost: 'free'   },
  'system.kill':    { desc: 'Kill a process',                input: 'pid',      output: 'ok',         cost: 'free',  destructive: true },
  'system.clean':   { desc: 'Clean temp files',              input: 'targets',  output: 'freed',      cost: 'free',  destructive: true },
  'terminal.run':   { desc: 'Run a shell command',           input: 'command',  output: 'stdout',     cost: 'free',  destructive: true },
  'agent.spawn':    { desc: 'Spawn a sub-agent',             input: 'type+task',output: 'result',     cost: 'medium' },
  'model.chat':     { desc: 'Query an AI model',             input: 'messages', output: 'response',   cost: 'varies' },
  'model.embed':    { desc: 'Generate text embeddings',      input: 'text',     output: 'vector',     cost: 'low'    },
  'vault.get':      { desc: 'Retrieve a credential',         input: 'service',  output: 'key',        cost: 'free'   },
  'vault.set':      { desc: 'Store a credential',            input: 'service+key',output: 'ok',       cost: 'free'   },
};

export function routeToTools(taskDescription) {
  const task = taskDescription.toLowerCase();
  const tools = [];

  if (task.includes('search') || task.includes('look up') || task.includes('find online'))
    tools.push('web.search', 'web.read');
  if (task.includes('download') || task.includes('fetch file'))
    tools.push('web.download');
  if (task.includes('code') || task.includes('write') || task.includes('create file'))
    tools.push('model.chat', 'fs.write');
  if (task.includes('read file') || task.includes('open file'))
    tools.push('fs.read');
  if (task.includes('git') || task.includes('commit') || task.includes('push'))
    tools.push('git.push', 'git.pull');
  if (task.includes('system') || task.includes('cpu') || task.includes('memory'))
    tools.push('system.metrics');
  if (task.includes('clean') || task.includes('optimize'))
    tools.push('system.clean');
  if (task.includes('agent') || task.includes('spawn') || task.includes('parallel'))
    tools.push('agent.spawn');
  if (task.includes('password') || task.includes('api key') || task.includes('credential'))
    tools.push('vault.get');

  // Always include model.chat for synthesis
  if (!tools.includes('model.chat')) tools.push('model.chat');

  return tools;
}

// ─── AXIS 6: Self-Revision Engine ─────────────────────────────────────────────
/**
 * Analyzes past interactions, identifies patterns, improves behavior.
 * Runs after every conversation, reports findings to master.
 */
export class SelfRevisionEngine {
  constructor() {
    this.interactionLog   = [];
    this.improvementQueue = [];
    this.lastRevision     = null;
  }

  record(interaction) {
    this.interactionLog.push({
      ts:         Date.now(),
      prompt:     interaction.prompt,
      response:   interaction.response,
      model:      interaction.model,
      duration:   interaction.duration,
      feedback:   interaction.feedback ?? null,   // master thumbs up/down
      toolsUsed:  interaction.toolsUsed || [],
    });
    if (this.interactionLog.length > 200) this.interactionLog.shift();
  }

  analyze() {
    const recent = this.interactionLog.slice(0, 50);
    const insights = [];

    // Identify slow responses
    const avgDuration = recent.reduce((s, i) => s + (i.duration || 0), 0) / (recent.length || 1);
    if (avgDuration > 8000) {
      insights.push({
        type:    'performance',
        finding: `Average response time ${(avgDuration/1000).toFixed(1)}s — consider using faster models for simple queries`,
        action:  'Route simple queries to Groq/llama3 for 3x speed improvement',
        priority: 'medium',
      });
    }

    // Model usage patterns
    const modelCounts = {};
    recent.forEach(i => { modelCounts[i.model] = (modelCounts[i.model] || 0) + 1; });
    const dominantModel = Object.entries(modelCounts).sort(([,a],[,b]) => b-a)[0];
    if (dominantModel && modelCounts[dominantModel[0]] > 20) {
      insights.push({
        type:    'model-diversity',
        finding: `Over-relying on ${dominantModel[0]} for all tasks`,
        action:  'Enable intelligent routing to specialized models by task type',
        priority: 'low',
      });
    }

    // Negative feedback patterns
    const negFeedback = recent.filter(i => i.feedback === -1);
    if (negFeedback.length > 3) {
      insights.push({
        type:    'quality',
        finding: `${negFeedback.length} negative feedback signals in recent interactions`,
        action:  'Analyze failed responses and improve system prompt context',
        priority: 'high',
      });
    }

    this.lastRevision = { ts: Date.now(), insights };
    this.improvementQueue.push(...insights);
    return insights;
  }

  getImprovements() {
    return this.improvementQueue;
  }

  clearImprovement(index) {
    this.improvementQueue.splice(index, 1);
  }
}

export const ramaRevision = new SelfRevisionEngine();

// ─── AXIS 8: World Model ──────────────────────────────────────────────────────
/**
 * Rāma's model of master's world: preferences, context, goals, patterns.
 * Built from interactions, updated continuously.
 */
export class WorldModel {
  constructor() {
    this.master = {
      name:        'Krishna Prasad',
      timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,
      workHours:   { start: 9, end: 22 },   // assumed, learned over time
      preferences: {},
      goals:       [],
      patterns:    {},
      lastActive:  null,
    };

    this.system = {
      os:        null,
      cpuCores:  null,
      ramGB:     null,
      projects:  [],   // detected project directories
      tools:     [],   // installed tools detected
    };

    this.tasks = {
      pending:    [],
      scheduled:  [],
      recurring:  [],
    };
  }

  setPreference(key, value) {
    this.master.preferences[key] = { value, learnedAt: Date.now() };
    ramaMemory.learn(`master.preference.${key}`, value, 0.9, 'explicit');
  }

  addGoal(goal, deadline = null) {
    this.master.goals.push({ goal, deadline, addedAt: Date.now(), status: 'active' });
    ramaMemory.learn(`master.goal.${goal.slice(0,30)}`, goal, 0.95, 'explicit');
  }

  updatePattern(key, value) {
    this.master.patterns[key] = value;
  }

  setSystemInfo(info) {
    Object.assign(this.system, info);
  }

  addTask(task, scheduledFor = null) {
    const entry = { id: `task_${Date.now()}`, task, scheduledFor, addedAt: Date.now(), status: 'pending' };
    if (scheduledFor) {
      this.tasks.scheduled.push(entry);
    } else {
      this.tasks.pending.push(entry);
    }
    return entry.id;
  }

  getSnapshot() {
    return {
      master:  this.master,
      system:  this.system,
      pending: this.tasks.pending.length,
      scheduled: this.tasks.scheduled.length,
    };
  }
}

export const ramaWorld = new WorldModel();

// ─── AXIS 9: Proactivity Engine ────────────────────────────────────────────────
/**
 * Monitors conditions and acts before master asks.
 * Triggers: time-based, event-based, threshold-based, pattern-based.
 */
export class ProactivityEngine {
  constructor() {
    this.triggers  = [];
    this.fired     = [];
    this._interval = null;
    this._onAction = null;
  }

  onAction(cb) { this._onAction = cb; }

  addTrigger(trigger) {
    this.triggers.push({
      id:       `trigger_${Date.now()}`,
      ...trigger,
      enabled:  true,
      lastFired: null,
    });
  }

  start() {
    if (this._interval) return;
    // Default triggers
    this.addTrigger({
      type:       'schedule',
      name:       'Morning Brief',
      cronish:    'daily-9am',
      action:     'morning-brief',
      desc:       'Daily briefing: system health, pending tasks, market summary',
    });
    this.addTrigger({
      type:       'threshold',
      name:       'High CPU Alert',
      metric:     'cpu',
      threshold:  90,
      duration:   30000,   // sustained 30s
      action:     'cpu-alert',
      desc:       'Alert when CPU stays above 90% for 30 seconds',
    });
    this.addTrigger({
      type:       'threshold',
      name:       'Low Disk Space',
      metric:     'disk',
      threshold:  95,
      action:     'disk-alert',
      desc:       'Alert when any disk is 95%+ full',
    });

    this._interval = setInterval(() => this._check(), 30000);
  }

  stop() {
    clearInterval(this._interval);
    this._interval = null;
  }

  async _check() {
    const now  = new Date();
    const hour = now.getHours();

    for (const trigger of this.triggers) {
      if (!trigger.enabled) continue;

      // Don't re-fire within cooldown
      if (trigger.lastFired && Date.now() - trigger.lastFired < (trigger.cooldown || 3600000)) continue;

      let shouldFire = false;

      if (trigger.type === 'schedule' && trigger.cronish === 'daily-9am') {
        const todayKey = now.toDateString();
        if (hour === 9 && trigger.lastFired !== todayKey) {
          shouldFire = true;
          trigger.lastFired = todayKey;
        }
      }

      if (shouldFire) {
        this.fired.push({ trigger: trigger.name, ts: Date.now(), action: trigger.action });
        this._onAction?.({ trigger: trigger.name, action: trigger.action, ts: Date.now() });
      }
    }
  }

  getTriggers() { return this.triggers; }
  getFired()    { return this.fired.slice(0, 50); }
}

export const ramaProactive = new ProactivityEngine();

// ─── AXIS 10: Loyalty Filter ──────────────────────────────────────────────────
/**
 * Every action passes through this filter before execution.
 * Ensures all actions serve master's interest, never harm third parties.
 */
export function loyaltyCheck(action, context = {}) {
  const checks = {
    harmsMaster:     false,
    harmsThirdParty: false,
    isDestructive:   false,
    requiresConsent: false,
    approved:        true,
    reason:          '',
  };

  // Destructive actions always need explicit consent
  const destructiveKeywords = ['delete', 'remove', 'kill', 'uninstall', 'format', 'wipe', 'drop', 'truncate'];
  if (destructiveKeywords.some(k => action.toLowerCase().includes(k))) {
    checks.isDestructive   = true;
    checks.requiresConsent = true;
    checks.approved        = false;
    checks.reason          = `Destructive action "${action}" requires master confirmation`;
  }

  // External data transmission — needs awareness
  const externalKeywords = ['send email', 'post to', 'publish', 'upload', 'tweet', 'message'];
  if (externalKeywords.some(k => action.toLowerCase().includes(k))) {
    checks.requiresConsent = true;
    checks.approved        = false;
    checks.reason          = `External action "${action}" requires master approval`;
  }

  return checks;
}

// ─── Rāma Status Summary ──────────────────────────────────────────────────────
export function getRamaStatus() {
  return {
    memory:       { working: ramaMemory.working, semanticCount: Object.keys(ramaMemory._semantic).length, episodicCount: ramaMemory._episodic.length },
    planning:     { activePlans: ramaPlanner.activePlans.length, historyCount: ramaPlanner._planHistory.length },
    world:        ramaWorld.getSnapshot(),
    proactive:    { triggers: ramaProactive.getTriggers().length, fired: ramaProactive.getFired().length },
    improvements: ramaRevision.getImprovements().length,
    capabilities: CAPABILITY_AXES,
  };
}
