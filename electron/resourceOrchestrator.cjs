'use strict';

/**
 * resourceOrchestrator.cjs — Rāma's Dynamic Resource Orchestration Layer.
 *
 * PERFORMANCE FIXES applied:
 *   - Snapshot refresh: 1s → adaptive (3s normal, 8s high pressure, 15s critical)
 *   - Workers adapt to pressure without polling CPU on every tick
 *   - Snapshot cached — multiple callers share one read, not N reads
 */
 *
 * RESOURCES TRACKED:
 *   CPU      — cores, usage %, temperature
 *   RAM      — used/free/available
 *   GPU      — VRAM, usage % (if available)
 *   Network  — bandwidth (rx/tx per second)
 *   Disk I/O — read/write throughput
 *   AI APIs  — per-provider rate limits (req/min, tokens/min)
 *   Agents   — active slot count vs cap
 *   Browser  — active Playwright page count
 *   Threads  — Node.js worker thread pool
 *
 * ORCHESTRATION STRATEGIES:
 *   1. Priority scheduling   — critical > high > normal > low > background
 *   2. Resource-aware routing — task goes to best available resource
 *   3. Backpressure          — queue fills → slow down producers
 *   4. Circuit breakers      — resource at limit → reject new tasks gracefully
 *   5. Work stealing         — idle resources pick up from overloaded ones
 *   6. Adaptive throttling   — CPU temp high → reduce parallel workers
 *   7. Dependency resolution — Task B waits for Task A result automatically
 *   8. Cost optimization     — use local model when API quota near limit
 */

const si     = require('systeminformation');
const os     = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// ─── Priority levels ──────────────────────────────────────────────────────────
const PRIORITY = {
  CRITICAL:   0,   // Master's immediate request — blocks everything
  HIGH:       1,   // Active user session work
  NORMAL:     2,   // Standard background tasks
  LOW:        3,   // Non-urgent processing
  BACKGROUND: 4,   // Evolution, maintenance, pre-fetching
};

// ─── Resource thresholds ──────────────────────────────────────────────────────
const THRESHOLDS = {
  CPU: {
    OPTIMAL:  50,   // Below this: fully open
    MODERATE: 70,   // Throttle background tasks
    HIGH:     85,   // Throttle normal tasks, keep high/critical only
    CRITICAL: 95,   // Kill background, warn user
  },
  RAM: {
    OPTIMAL:  50,
    MODERATE: 70,
    HIGH:     85,
    CRITICAL: 92,
  },
  CPU_TEMP: {
    WARM:     75,   // °C — reduce parallelism
    HOT:      85,   // Stop non-critical work
    CRITICAL: 95,   // Emergency shutdown of non-critical
  },
  NETWORK: {
    MAX_CONCURRENT_REQUESTS: 8,   // Parallel HTTP requests
    RATE_LIMIT_BUFFER:       0.8, // Use only 80% of known rate limits
  },
};

// ─── API rate limit registry ──────────────────────────────────────────────────
// Tracks used capacity per provider per minute
const API_RATE_LIMITS = {
  openai:    { reqPerMin: 500,  tokPerMin: 200000,  usedReq: 0, usedTok: 0, resetAt: 0 },
  anthropic: { reqPerMin: 60,   tokPerMin: 100000,  usedReq: 0, usedTok: 0, resetAt: 0 },
  gemini:    { reqPerMin: 60,   tokPerMin: 1000000, usedReq: 0, usedTok: 0, resetAt: 0 },
  groq:      { reqPerMin: 30,   tokPerMin: 14400,   usedReq: 0, usedTok: 0, resetAt: 0 },
  mistral:   { reqPerMin: 60,   tokPerMin: 100000,  usedReq: 0, usedTok: 0, resetAt: 0 },
  ollama:    { reqPerMin: 9999, tokPerMin: 9999999, usedReq: 0, usedTok: 0, resetAt: 0 },
};

// ─── Task queue ───────────────────────────────────────────────────────────────
class TaskQueue {
  constructor() {
    this._queues = {
      [PRIORITY.CRITICAL]:   [],
      [PRIORITY.HIGH]:       [],
      [PRIORITY.NORMAL]:     [],
      [PRIORITY.LOW]:        [],
      [PRIORITY.BACKGROUND]: [],
    };
    this._running = new Map();   // { taskId → TaskState }
    this._history = [];
  }

  enqueue(task) {
    const p = task.priority ?? PRIORITY.NORMAL;
    this._queues[p].push(task);
  }

  // Dequeue highest-priority task that can run given current resources
  dequeue(resourceSnapshot) {
    for (const priority of [PRIORITY.CRITICAL, PRIORITY.HIGH, PRIORITY.NORMAL, PRIORITY.LOW, PRIORITY.BACKGROUND]) {
      const queue = this._queues[priority];
      for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        if (this._canRun(task, priority, resourceSnapshot)) {
          queue.splice(i, 1);
          return task;
        }
      }
    }
    return null;
  }

  _canRun(task, priority, snap) {
    // Critical always runs
    if (priority === PRIORITY.CRITICAL) return true;

    // Check dependencies
    if (task.dependsOn?.length > 0) {
      const allDone = task.dependsOn.every(dep => {
        const hist = this._history.find(h => h.id === dep);
        return hist?.status === 'complete';
      });
      if (!allDone) return false;
    }

    // Resource pressure checks
    if (snap.cpu >= THRESHOLDS.CPU.CRITICAL && priority > PRIORITY.HIGH) return false;
    if (snap.cpu >= THRESHOLDS.CPU.HIGH     && priority > PRIORITY.NORMAL) return false;
    if (snap.ram >= THRESHOLDS.RAM.CRITICAL && priority > PRIORITY.HIGH) return false;
    if (snap.temp >= THRESHOLDS.CPU_TEMP.HOT && priority > PRIORITY.HIGH) return false;

    // API rate limit check
    if (task.aiProvider) {
      const limit = API_RATE_LIMITS[task.aiProvider];
      if (limit) {
        const now = Date.now();
        if (now > limit.resetAt) { limit.usedReq = 0; limit.usedTok = 0; limit.resetAt = now + 60000; }
        const capacity = limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER;
        if (limit.usedReq >= capacity) return false;
      }
    }

    return true;
  }

  addRunning(task) {
    this._running.set(task.id, { ...task, startedAt: Date.now(), status: 'running' });
  }

  complete(taskId, result) {
    const task = this._running.get(taskId);
    if (task) {
      this._running.delete(taskId);
      this._history.unshift({ ...task, status: 'complete', result, completedAt: Date.now() });
      if (this._history.length > 500) this._history.pop();
    }
  }

  fail(taskId, error) {
    const task = this._running.get(taskId);
    if (task) {
      this._running.delete(taskId);
      this._history.unshift({ ...task, status: 'failed', error, completedAt: Date.now() });
    }
  }

  getStats() {
    return {
      queued:   Object.values(this._queues).reduce((s, q) => s + q.length, 0),
      running:  this._running.size,
      byPriority: Object.fromEntries(
        Object.entries(this._queues).map(([p, q]) => [Object.keys(PRIORITY)[p], q.length])
      ),
      history: this._history.slice(0, 10),
    };
  }

  getRunning() { return [...this._running.values()]; }
  getQueued()  { return Object.values(this._queues).flat(); }
  getPendingFor(dep) { return this.getQueued().filter(t => t.dependsOn?.includes(dep)); }
}

// ─── Resource Orchestrator ────────────────────────────────────────────────────
class ResourceOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.queue      = new TaskQueue();
    this.snapshot   = this._emptySnapshot();
    this._interval  = null;
    this._workerCount = 0;
    this._maxWorkers  = Math.max(2, os.cpus().length - 1);
    this._handlers  = {};   // { taskType: async fn(task) }
  }

  // ── Register a task type handler ──────────────────────────────────────────
  registerHandler(type, fn) {
    this._handlers[type] = fn;
  }

  // ── Submit a task ─────────────────────────────────────────────────────────
  submit(taskDef) {
    const task = {
      id:          crypto.randomBytes(8).toString('hex'),
      submittedAt: Date.now(),
      status:      'queued',
      ...taskDef,
    };
    this.queue.enqueue(task);
    this.emit('task:queued', { id: task.id, type: task.type, priority: task.priority });
    this._tick();  // Try to run immediately
    return task.id;
  }

  // ── Start orchestrator loop ───────────────────────────────────────────────
  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), 1000);
    // Use adaptive timeout instead of fixed interval for snapshot
    this._refreshSnapshot();
    // No fixed _snapInterval — it self-schedules adaptively
  }

  stop() {
    clearInterval(this._interval);
    clearTimeout(this._snapInterval);
    this._interval = this._snapInterval = null;
  }

  // ── Main scheduling tick ──────────────────────────────────────────────────
  async _tick() {
    // Don't exceed worker pool
    while (this._workerCount < this._maxWorkers) {
      const task = this.queue.dequeue(this.snapshot);
      if (!task) break;

      const handler = this._handlers[task.type];
      if (!handler) {
        this.queue.fail(task.id, `No handler for task type: ${task.type}`);
        continue;
      }

      this._workerCount++;
      this.queue.addRunning(task);
      this.emit('task:started', { id: task.id, type: task.type });

      // Track API usage if needed
      if (task.aiProvider && API_RATE_LIMITS[task.aiProvider]) {
        API_RATE_LIMITS[task.aiProvider].usedReq++;
        if (task.estimatedTokens) API_RATE_LIMITS[task.aiProvider].usedTok += task.estimatedTokens;
      }

      // Execute async
      handler(task).then(result => {
        this.queue.complete(task.id, result);
        this.emit('task:complete', { id: task.id, type: task.type, result });
        this._workerCount = Math.max(0, this._workerCount - 1);
        this._tick();
      }).catch(err => {
        this.queue.fail(task.id, err.message);
        this.emit('task:failed', { id: task.id, type: task.type, error: err.message });
        this._workerCount = Math.max(0, this._workerCount - 1);
        this._tick();
      });
    }
  }

  // ── Refresh resource snapshot — ADAPTIVE interval ──────────────────────
  async _refreshSnapshot() {
    try {
      const [cpu, mem, temp] = await Promise.all([
        si.currentLoad().catch(() => ({ currentLoad: 0 })),
        si.mem().catch(() => ({ used: 0, total: 1, available: 1 })),
        si.cpuTemperature().catch(() => ({ main: 0 })),
      ]);
      const prev = this.snapshot;
      this.snapshot = {
        cpu:     Math.round(cpu.currentLoad),
        ram:     Math.round((mem.used / mem.total) * 100),
        ramFreeMB: Math.round(mem.available / 1024 / 1024),
        temp:    temp.main || 0,
        ts:      Date.now(),
        pressure: this._computePressure(cpu.currentLoad, (mem.used/mem.total)*100, temp.main || 0),
      };

      if (Math.abs(this.snapshot.cpu - (prev.cpu || 0)) > 10 ||
          Math.abs(this.snapshot.ram - (prev.ram || 0)) > 10) {
        this.emit('resource:update', this.snapshot);
      }

      this._adaptWorkers();

      // Adaptive refresh interval: faster when active, slower under pressure
      if (this._snapInterval) clearTimeout(this._snapInterval);
      const nextMs = this.snapshot.pressure === 'critical' ? 15000
                   : this.snapshot.pressure === 'high'     ? 8000
                   : this._workerCount > 0                 ? 3000
                   : 5000;
      this._snapInterval = setTimeout(() => this._refreshSnapshot(), nextMs);
    } catch { /* ignore snapshot errors */ }
  }

  _computePressure(cpu, ram, temp) {
    if (cpu >= 90 || ram >= 90 || temp >= THRESHOLDS.CPU_TEMP.HOT) return 'critical';
    if (cpu >= 70 || ram >= 75 || temp >= THRESHOLDS.CPU_TEMP.WARM) return 'high';
    if (cpu >= 50 || ram >= 60) return 'moderate';
    return 'optimal';
  }

  _adaptWorkers() {
    const pressure = this.snapshot.pressure;
    const cpuCount = os.cpus().length;
    const maxMap   = {
      optimal:  Math.max(4, cpuCount - 1),
      moderate: Math.max(3, Math.floor(cpuCount * 0.6)),
      high:     Math.max(2, Math.floor(cpuCount * 0.4)),
      critical: 1,
    };
    const newMax = maxMap[pressure] || 2;
    if (newMax !== this._maxWorkers) {
      this._maxWorkers = newMax;
      this.emit('workers:adapted', { pressure, maxWorkers: newMax });
    }
  }

  _emptySnapshot() {
    return { cpu: 0, ram: 0, ramFreeMB: 0, temp: 0, pressure: 'optimal', ts: 0 };
  }

  // ── Select best AI model considering rate limits + current pressure ────────
  selectOptimalModel(taskType, preferLocal = false) {
    const { MODEL_REGISTRY, FALLBACK_CHAIN, checkAvailable } = (() => {
      try { return require('./ipc/modelRouter.cjs'); }
      catch { return { MODEL_REGISTRY: {}, FALLBACK_CHAIN: [], checkAvailable: () => false }; }
    })();

    const pressure = this.snapshot.pressure;
    // Under pressure → prefer local (no API calls = no latency + no cost)
    if (pressure === 'critical' || preferLocal) {
      for (const modelId of FALLBACK_CHAIN) {
        if (MODEL_REGISTRY[modelId]?.type === 'local' && checkAvailable(modelId)) {
          return { model: modelId, reason: 'local-preferred-under-pressure' };
        }
      }
    }

    // Check which providers have capacity
    const now = Date.now();
    for (const modelId of FALLBACK_CHAIN) {
      const info = MODEL_REGISTRY[modelId];
      if (!info || !checkAvailable(modelId)) continue;

      const limit = API_RATE_LIMITS[info.provider];
      if (limit) {
        if (now > limit.resetAt) { limit.usedReq = 0; limit.resetAt = now + 60000; }
        const capacity = limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER;
        if (limit.usedReq < capacity) {
          return { model: modelId, reason: 'rate-limit-ok' };
        }
      } else {
        return { model: modelId, reason: 'no-rate-limit' };
      }
    }

    return { model: 'ollama/phi3', reason: 'fallback-all-limited' };
  }

  // ── Get current orchestration status ─────────────────────────────────────
  getStatus() {
    return {
      snapshot:     this.snapshot,
      queue:        this.queue.getStats(),
      workers:      { current: this._workerCount, max: this._maxWorkers },
      apiLimits:    Object.fromEntries(
        Object.entries(API_RATE_LIMITS).map(([provider, l]) => [provider, {
          used:    l.usedReq,
          cap:     Math.round(l.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER),
          pct:     Math.round((l.usedReq / (l.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER)) * 100),
        }])
      ),
      running:      this.queue.getRunning(),
      thresholds:   THRESHOLDS,
    };
  }
}

// ─── Singleton instance ───────────────────────────────────────────────────────
const orchestrator = new ResourceOrchestrator();

// ─── Register IPC handlers ────────────────────────────────────────────────────
function register(ipcMain) {
  orchestrator.start();

  // Forward events to renderer
  orchestrator.on('task:queued',    (d) => broadcast('orchestrator:task-queued',    d));
  orchestrator.on('task:started',   (d) => broadcast('orchestrator:task-started',   d));
  orchestrator.on('task:complete',  (d) => broadcast('orchestrator:task-complete',  d));
  orchestrator.on('task:failed',    (d) => broadcast('orchestrator:task-failed',    d));
  orchestrator.on('resource:update',(d) => broadcast('orchestrator:resource-update',d));
  orchestrator.on('workers:adapted',(d) => broadcast('orchestrator:workers-adapted',d));

  // ── Submit a task ─────────────────────────────────────────────────────────
  ipcMain.handle('orchestrator:submit', async (_e, task) => {
    const id = orchestrator.submit(task);
    return { ok: true, id };
  });

  // ── Get status ────────────────────────────────────────────────────────────
  ipcMain.handle('orchestrator:status', async () => {
    return { ok: true, data: orchestrator.getStatus() };
  });

  // ── Select optimal model for a task ──────────────────────────────────────
  ipcMain.handle('orchestrator:optimal-model', async (_e, taskType, preferLocal) => {
    const result = orchestrator.selectOptimalModel(taskType, preferLocal);
    return { ok: true, data: result };
  });

  // ── Set resource limits (master override) ─────────────────────────────────
  ipcMain.handle('orchestrator:set-limits', async (_e, limits) => {
    if (limits.cpu?.critical)  THRESHOLDS.CPU.CRITICAL  = limits.cpu.critical;
    if (limits.cpu?.high)      THRESHOLDS.CPU.HIGH      = limits.cpu.high;
    if (limits.ram?.critical)  THRESHOLDS.RAM.CRITICAL  = limits.ram.critical;
    if (limits.maxWorkers)     orchestrator._maxWorkers = limits.maxWorkers;
    return { ok: true, thresholds: THRESHOLDS };
  });

  // ── Get API rate limit status ─────────────────────────────────────────────
  ipcMain.handle('orchestrator:api-limits', async () => {
    return { ok: true, data: API_RATE_LIMITS };
  });

  // ── Record API usage (called by modelRouter after each call) ─────────────
  ipcMain.handle('orchestrator:record-api-use', async (_e, provider, tokens) => {
    const limit = API_RATE_LIMITS[provider];
    if (!limit) return { ok: false };
    const now = Date.now();
    if (now > limit.resetAt) { limit.usedReq = 0; limit.usedTok = 0; limit.resetAt = now + 60000; }
    limit.usedReq++;
    if (tokens) limit.usedTok += tokens;
    return { ok: true };
  });

  // ── Cancel a queued task ──────────────────────────────────────────────────
  ipcMain.handle('orchestrator:cancel', async (_e, taskId) => {
    orchestrator.queue.fail(taskId, 'Cancelled by master');
    return { ok: true };
  });
}

function broadcast(channel, data) {
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  } catch { /* ignore */ }
}

module.exports = { register, orchestrator, PRIORITY, THRESHOLDS, API_RATE_LIMITS };
