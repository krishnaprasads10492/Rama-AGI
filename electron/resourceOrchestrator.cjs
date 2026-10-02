'use strict';

/**
 * resourceOrchestrator.cjs — Rāma's Dynamic Resource Orchestration Layer.
 *
 * PERFORMANCE FIXES applied:
 *   - Snapshot refresh: 1s → adaptive (3s normal, 8s high pressure, 15s critical)
 *   - Workers adapt to pressure without polling CPU on every tick
 *   - Snapshot cached — multiple callers share one read, not N reads
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

// Optional dependency, guarded — see electron/lib/sysinfo.cjs. Requiring
// systeminformation directly made a degrading dependency fatal at startup.
const si     = require('./lib/sysinfo.cjs');
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
/**
 * Used capacity per provider. `reqPerMin`/`tokPerMin` are per-minute counters on a 60-second reset;
 * `maxConcurrent`/`inFlight` are a SLOT COUNT, which is a different kind of limit and cannot be
 * expressed in the per-minute fields.
 *
 * NO FIELD ON ANY ROW MAY EVER DERIVE FROM A CREDENTIAL VALUE. `orchestrator:api-limits` returns
 * this object WHOLESALE and is ungated (see its handler), so that rule is what makes the exposure
 * acceptable. Nothing here derives from a key today, and the suite asserts that no own-property name
 * matches /key|secret|bearer|prefix|hash/i.
 *
 * `tokPerMin: null` means UNCHECKED, never zero — the same `num()` discipline modelRoles.cjs applies
 * to an unknown parameter count. An unknown budget is not a failed one.
 */
const API_RATE_LIMITS = {
  openai:    { reqPerMin: 500,  tokPerMin: 200000,  maxConcurrent: 8, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  anthropic: { reqPerMin: 60,   tokPerMin: 100000,  maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  gemini:    { reqPerMin: 60,   tokPerMin: 1000000, maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  groq:      { reqPerMin: 30,   tokPerMin: 14400,   maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  mistral:   { reqPerMin: 60,   tokPerMin: 100000,  maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },

  // A LOCAL daemon: unmetered, bounded only by the machine, which admit() already governs.
  ollama:    { reqPerMin: 9999, tokPerMin: 9999999, maxConcurrent: 2, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },

  // KEYED CLOUD, FREE TIER. The binding constraint is ONE CONCURRENT REQUEST, not a rate.
  // `reqPerMin` is a courtesy ceiling so a loop cannot queue a thousand requests behind the one
  // slot; the slot is what is actually enforced. RATE_LIMIT_BUFFER is applied to reqPerMin, so the
  // ENFORCED ceiling is 16/min, not the 20 in this table — and it is deliberately NOT applied to
  // maxConcurrent, because Math.floor(1 * 0.8) is 0 and would deadlock.
  // `tokPerMin: null` because a per-minute token budget is not something Ollama publishes, and
  // inventing one would be a fabricated limit presented as a measurement.
  'ollama-cloud':  { reqPerMin: 20, tokPerMin: null, maxConcurrent: 1, inFlight: 0,
                     usedReq: 0, usedTok: 0, resetAt: 0,
                     monthlyTokenBudget: null, usedTokMonth: 0, monthStartedAt: null,
                     note: 'free tier: one concurrent request; the monthly credit pool is not exposed to the API' },

  // Hosted web search shares the credential, NOT the inference slot. A page of search traffic must
  // not be able to consume the single concurrent slot inference needs.
  'ollama-search': { reqPerMin: 10, tokPerMin: null, maxConcurrent: 1, inFlight: 0,
                     usedReq: 0, usedTok: 0, resetAt: 0 },

  // Master-registered OpenAI-compatible providers. Conservative, because their real limits are
  // unknown. Present so that refuse-by-default below cannot break a shipped capability.
  custom:    { reqPerMin: 20, tokPerMin: null, maxConcurrent: 2, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
};

/**
 * `'__proto__'` resolves through the prototype chain on a plain object literal, and
 * Object.prototype is TRUTHY — so a bare `if (API_RATE_LIMITS[p])` guard PASSES for it and the
 * write lands on Object.prototype, polluting every plain object in the process from one free-text
 * UI field. Ownership, not truthiness, is the guard. Used by _canRun, _tick, admit and recordApiUse.
 */
function limitFor(provider) {
  return Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, provider)
    ? API_RATE_LIMITS[provider] : null;
}

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
      const limit = limitFor(task.aiProvider);
      // A provider with no declared limit is REFUSED, not waved through. An unknown budget is not
      // an unlimited one, and the old `if (limit)` with no else admitted an unregistered provider's
      // traffic unmetered. The assertion that every shipped provider HAS a row is what makes
      // refusing here safe rather than a capability regression.
      //
      // This stays as DEFENCE IN DEPTH: submit() now refuses an unknown provider where it is ASKED
      // FOR, because `_canRun` returning false means "not this tick", and "not this tick" is the
      // wrong answer to "this provider does not exist".
      if (!limit) return false;
      const now = Date.now();
      if (now > limit.resetAt) { limit.usedReq = 0; limit.usedTok = 0; limit.resetAt = now + 60000; }
      const capacity = limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER;
      if (limit.usedReq >= capacity) return false;
      // An unknown token budget is UNCHECKED, never failed and never cleared.
      if (Number.isFinite(limit.tokPerMin)
          && limit.usedTok >= limit.tokPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER) return false;
      if (limit.inFlight >= limit.maxConcurrent) return false;
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
    // AN UNKNOWN PROVIDER IS REFUSED WHERE IT IS ASKED FOR. `aiProvider` is free text from the UI
    // (src/pages/Resources/Resources.jsx submits the input verbatim), so a typo like `opanai` would
    // otherwise sit in the queue permanently and say nothing.
    //
    // THROWN rather than returned because submit()'s success contract is a bare id STRING and its
    // one caller wraps it as { ok: true, id }. Changing the return type would break that wrap,
    // which is the opposite of additive.
    if (task.aiProvider && !limitFor(task.aiProvider)) {
      throw new Error(`unknown AI provider "${task.aiProvider}" — no rate-limit row, so it cannot be metered`);
    }
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

      // Track API usage if needed. `limitFor` and not a bracket read: the old guard tested
      // TRUTHINESS, and API_RATE_LIMITS['__proto__'] resolves through the prototype chain to
      // Object.prototype, which IS truthy — so the guard passed and `.usedReq++` wrote NaN onto
      // Object.prototype. Prototype pollution from a free-text UI field, with the symptom appearing
      // nowhere near the cause.
      const tickLimit = task.aiProvider ? limitFor(task.aiProvider) : null;
      if (tickLimit) {
        tickLimit.usedReq++;
        if (task.estimatedTokens) tickLimit.usedTok += task.estimatedTokens;
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

      const limit = limitFor(info.provider);
      // A model whose provider has no row is SKIPPED, not SELECTED. The old `else` branch returned
      // it with reason 'no-rate-limit', i.e. a missing entry was an affirmative selection of an
      // unmeterable provider.
      if (!limit) continue;
      if (now > limit.resetAt) { limit.usedReq = 0; limit.resetAt = now + 60000; }
      const capacity = limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER;
      if (limit.usedReq < capacity) {
        return { model: modelId, reason: 'rate-limit-ok' };
      }
    }

    return { model: 'ollama/phi3', reason: 'fallback-all-limited' };
  }

  // ── The concurrency slot, inside the one authority (I10) ──────────────────
  /**
   * Reserve one of a provider's concurrent request slots.
   *
   * `PRIORITY.CRITICAL` WAITS for the slot; it does NOT bypass it. One concurrent request is a
   * PHYSICAL limit of the free tier — bypassing it does not produce a faster answer for master, it
   * produces a 429 and spends an attempt. Waiting honours "loyalty outranks throttling" in the only
   * way the endpoint permits. The wait is BOUNDED, because an unbounded await on a leaked slot is
   * an invisible hang, which is worse than an honest refusal.
   *
   * Non-critical priorities do NOT wait: they are refused immediately, because a queue of waiters
   * on a one-slot row is a latency trap that looks like a hang.
   *
   * THE TEST AND THE INCREMENT HAPPEN IN THE SAME SYNCHRONOUS TURN, so exactly one waiter wins per
   * release. An event wait with no re-check would let two CRITICAL waiters both resolve on one
   * `slot:released` and both take a maxConcurrent:1 row — the exact limit this method exists to
   * honour, broken by the mechanism added to honour it.
   */
  async reserveSlot(provider, { priority = PRIORITY.NORMAL, waitMs = 20000 } = {}) {
    const limit = limitFor(provider);
    if (!limit) {
      return { ok: false, deferred: true,
               reason: `no rate-limit row for provider "${provider}" — it cannot be metered` };
    }

    if (limit.inFlight < limit.maxConcurrent) { limit.inFlight++; return { ok: true, waited: false }; }

    if (priority !== PRIORITY.CRITICAL) {
      return { ok: false, deferred: true,
               reason: `${provider} is at its ${limit.maxConcurrent}-request concurrency limit` };
    }

    const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
    for (;;) {
      if (limit.inFlight < limit.maxConcurrent) { limit.inFlight++; return { ok: true, waited: true }; }
      const left = deadline - Date.now();
      if (left <= 0) {
        return { ok: false, deferred: true, timedOut: true,
                 reason: `${provider}'s single slot did not free within ${waitMs}ms` };
      }
      await this._onceOrTimeout('slot:released', left);
    }
  }

  /** Release one slot. Floored at zero so a double-release cannot create free capacity. */
  releaseSlot(provider) {
    const limit = limitFor(provider);
    if (!limit) return false;
    limit.inFlight = Math.max(0, limit.inFlight - 1);
    this.emit('slot:released', { provider, inFlight: limit.inFlight });
    return true;
  }

  /** Resolve on the next `event`, or on the timeout, whichever comes first. Never rejects. */
  _onceOrTimeout(event, ms) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.removeListener(event, onEvent);
        resolve(false);
      }, ms);
      const onEvent = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      };
      this.once(event, onEvent);
    });
  }

  /**
   * Record what a provider actually spent. ONE implementation: the
   * `orchestrator:record-api-use` handler calls this rather than carrying its own copy.
   *
   * `usedTokMonth` is what RĀMA SPENT, as counted here — never what remains. Ollama does not expose
   * the remaining free balance, so a budget is never modelled.
   */
  recordApiUse(provider, tokens = 0) {
    const limit = limitFor(provider);
    if (!limit) return false;
    const now = Date.now();
    if (now > limit.resetAt) { limit.usedReq = 0; limit.usedTok = 0; limit.resetAt = now + 60000; }
    limit.usedReq++;
    const n = Number(tokens);
    if (Number.isFinite(n) && n > 0) limit.usedTok += n;

    if (Object.prototype.hasOwnProperty.call(limit, 'usedTokMonth')) {
      const MONTH_MS = 31 * 24 * 60 * 60 * 1000;
      if (!limit.monthStartedAt || now - limit.monthStartedAt > MONTH_MS) {
        limit.monthStartedAt = now;
        limit.usedTokMonth = 0;
      }
      if (Number.isFinite(n) && n > 0) limit.usedTokMonth += n;
      try {
        require('./dataStore.cjs').set('config', 'ollamaCloudUsage', {
          usedTokMonth: limit.usedTokMonth, monthStartedAt: limit.monthStartedAt,
        });
      } catch { /* the counter is still correct in memory; persistence is a convenience */ }
    }
    return true;
  }

  /**
   * Admission control — the SINGLE authority on "may this workload start?".
   *
   * agentOrchestrator (agent spawns), sandboxEngine (code execution) and the
   * evolution/regen engines all used to make their own os.freemem()/CPU
   * judgements with different thresholds. They now all ask here, so one policy
   * governs the whole process and there is one place to tune it.
   *
   * @param {object} req { ramMB, label, priority, allowUnderPressure, aiProvider }
   * @returns {{ allow: boolean, reason: string, snapshot: object }}
   */
  admit(req = {}) {
    const {
      ramMB    = 128,
      label    = 'workload',
      priority = PRIORITY.NORMAL,
      allowUnderPressure = false,
      // Default null → byte-identical behaviour for the three existing call sites
      // (agentOrchestrator, instanceManager, sandboxEngine), which is what keeps this additive.
      aiProvider = null,
    } = req;

    const snap = this.snapshot.ts ? this.snapshot : this._liveSnapshot();

    // Master's critical work is never blocked — loyalty outranks throttling.
    if (priority === PRIORITY.CRITICAL) {
      return { allow: true, reason: 'critical-priority-bypass', snapshot: snap };
    }

    if (snap.ramFreeMB > 0 && snap.ramFreeMB < ramMB) {
      return {
        allow:  false,
        reason: `Insufficient free RAM for ${label}: ${snap.ramFreeMB}MB free, needs ${ramMB}MB`,
        snapshot: snap,
      };
    }

    if (snap.ram >= THRESHOLDS.RAM.CRITICAL) {
      return { allow: false, reason: `RAM at ${snap.ram}% — above critical threshold`, snapshot: snap };
    }

    if (snap.cpu >= THRESHOLDS.CPU.CRITICAL) {
      return { allow: false, reason: `CPU at ${snap.cpu}% — above critical threshold`, snapshot: snap };
    }

    if (snap.temp && snap.temp >= THRESHOLDS.CPU_TEMP.CRITICAL) {
      return { allow: false, reason: `CPU temperature ${snap.temp}°C — thermal protection`, snapshot: snap };
    }

    if (snap.pressure === 'critical' && !allowUnderPressure && priority > PRIORITY.HIGH) {
      return { allow: false, reason: `System under critical pressure — ${label} deferred`, snapshot: snap };
    }

    // THIS IS THE ONLY PLACE THE CLOUD PATH IS METERED. ollamaCloud.chat() calls admit() then
    // reserveSlot() and never touches TaskQueue._canRun or selectOptimalModel — so a ceiling
    // asserted against those two is a ceiling that is not enforced on the one path that spends
    // master's allowance. Three NAMED reasons, not one, so master can tell them apart.
    if (aiProvider) {
      const limit = limitFor(aiProvider);
      if (!limit) {
        return { allow: false, snapshot: snap,
                 reason: `no rate-limit row for provider "${aiProvider}" — it cannot be metered` };
      }
      const now = Date.now();
      if (now > limit.resetAt) { limit.usedReq = 0; limit.usedTok = 0; limit.resetAt = now + 60000; }
      const ceiling = Math.floor(limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER);
      if (limit.usedReq >= ceiling) {
        return { allow: false, snapshot: snap,
                 reason: `${aiProvider} is at its ${ceiling}/min courtesy ceiling` };
      }
      if (limit.inFlight >= limit.maxConcurrent) {
        return { allow: false, snapshot: snap,
                 reason: `${aiProvider} is at its ${limit.maxConcurrent}-request concurrency limit` };
      }
    }

    return { allow: true, reason: 'ok', snapshot: snap };
  }

  /** Synchronous fallback snapshot for the first call before si resolves. */
  _liveSnapshot() {
    const total = os.totalmem();
    const free  = os.freemem();
    const ram   = Math.round(((total - free) / total) * 100);
    return {
      cpu: 0, ram, ramFreeMB: Math.round(free / 1024 / 1024),
      temp: 0, pressure: this._computePressure(0, ram, 0), ts: Date.now(),
    };
  }

  /** Read-only snapshot for other engines — no duplicate os/si polling. */
  getSnapshot() {
    return this.snapshot.ts ? { ...this.snapshot } : this._liveSnapshot();
  }

  // ── Get current orchestration status ─────────────────────────────────────
  getStatus() {
    return {
      snapshot:     this.snapshot,
      queue:        this.queue.getStats(),
      workers:      { current: this._workerCount, max: this._maxWorkers },
      // An EXPLICIT projection, deliberately narrower than the row. The monthly counters are
      // reported through ollamaCloud.status() instead, which is the surface whose key set is frozen
      // and asserted — so there is one definition of what may be said about the cloud path.
      apiLimits:    Object.fromEntries(
        Object.entries(API_RATE_LIMITS).map(([provider, l]) => [provider, {
          used:    l.usedReq,
          cap:     Math.round(l.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER),
          pct:     Math.round((l.usedReq / (l.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER)) * 100),
          inFlight:      l.inFlight,
          maxConcurrent: l.maxConcurrent,
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
  // submit() throws on a provider it cannot meter, so the refusal becomes something the renderer
  // can render instead of a task that sits in the queue forever saying nothing.
  ipcMain.handle('orchestrator:submit', async (_e, task) => {
    try { return { ok: true, id: orchestrator.submit(task) }; }
    catch (e) { return { ok: false, error: e.message }; }
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
  // This returns API_RATE_LIMITS WHOLESALE and is UNGATED — it was before this change and still is.
  // That is acceptable only because no field on any row derives from a credential value, which is
  // the rule written at the table's declaration and asserted by the suite. getStatus().apiLimits
  // keeps its explicit narrower projection; the monthly counters are reported through
  // ollamaCloud.status(), whose key set is frozen.
  ipcMain.handle('orchestrator:api-limits', async () => {
    return { ok: true, data: API_RATE_LIMITS };
  });

  // ── Record API usage (called by modelRouter after each call) ─────────────
  // Delegates to the instance method so there is ONE implementation of what "a recorded use" means.
  ipcMain.handle('orchestrator:record-api-use', async (_e, provider, tokens) => {
    return { ok: orchestrator.recordApiUse(provider, tokens) };
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
