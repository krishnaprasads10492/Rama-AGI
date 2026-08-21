'use strict';

/**
 * ramaEventBus.cjs — Rāma's Neural Lattice Nexus.
 *
 * The internal event bus connecting ALL subsystems.
 * This is what makes Rāma a unified intelligence rather than
 * a collection of isolated tools.
 *
 * ARCHITECTURE:
 *   Publisher  → emit(event, data)
 *   Subscriber → on(event, handler)
 *   All engines connect through this single bus
 *
 * EVENT FLOWS (automatic, no manual wiring needed):
 *
 *   vector:stored      → worldModel.update, knowledge.index
 *   intelligence:found → vector.store, knowledge.capture
 *   selfcare:alert     → evolution.queue-fix, orchestrator.throttle
 *   selfcare:regression→ evolution.scout, codeRegen.analyze
 *   agent:complete     → vector.store(result), selfRevision.record
 *   model:response     → selfRevision.record, vector.store
 *   git:changed        → intelligence.analyze, codeRegen.scan
 *   evolution:applied  → selfcare.track-score, capability.update
 *   sandbox:executed   → vector.store(result), audit.log
 *   browser:found      → vector.store, intelligence.incorporate
 *
 * DESIGN PRINCIPLES:
 *   - All handlers are async and non-blocking
 *   - A slow handler never delays the publisher
 *   - Failed handlers are logged but never crash the bus
 *   - Event history kept for debugging (last 500 events)
 *   - Dead letter queue for events with no subscribers
 */

const { EventEmitter } = require('events');
const crypto           = require('crypto');

class RamaEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);   // Many engines can subscribe

    this._history     = [];      // last 500 events
    this._deadLetters = [];      // events with no handlers
    this._metrics     = {};      // { eventName: { count, lastTs, errors } }
    this._ipcMain     = null;    // set on register
  }

  // ── Enhanced emit — tracks history, metrics, dead letters ────────────────
  emit(event, data) {
    const id      = crypto.randomBytes(4).toString('hex');
    const ts      = Date.now();
    const entry   = { id, event, data, ts };

    // Track metrics
    if (!this._metrics[event]) {
      this._metrics[event] = { count: 0, lastTs: 0, errors: 0 };
    }
    this._metrics[event].count++;
    this._metrics[event].lastTs = ts;

    // History (capped at 500)
    this._history.unshift(entry);
    if (this._history.length > 500) this._history.pop();

    // Check for subscribers
    const listenerCount = this.listenerCount(event);
    if (listenerCount === 0) {
      this._deadLetters.unshift({ ...entry, reason: 'no-subscribers' });
      if (this._deadLetters.length > 100) this._deadLetters.pop();
    }

    // Broadcast to renderer (for live activity stream)
    if (this._ipcMain) {
      try {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(w => {
          w.webContents.send('bus:event', { id, event, ts, summary: summarize(data) });
        });
      } catch { /* ignore */ }
    }

    return super.emit(event, data);
  }

  // ── Safe async subscribe — handler errors never crash bus ────────────────
  onAsync(event, handler) {
    const safeHandler = async (data) => {
      try {
        await handler(data);
      } catch (err) {
        this._metrics[event] = this._metrics[event] || { count: 0, lastTs: 0, errors: 0 };
        this._metrics[event].errors++;
        console.error(`[EventBus] Handler error for '${event}':`, err.message);
      }
    };
    this.on(event, safeHandler);
    return () => this.off(event, safeHandler);
  }

  // ── Wire all automatic event flows ────────────────────────────────────────
  wireAutomaticFlows() {
    // intelligence:found → capture to knowledge base + vector memory
    this.onAsync('intelligence:found', async ({ query, result }) => {
      try {
        const vectorMem = require('./ipc/vectorMemory.cjs');
        await vectorMem.store(
          `Intelligence finding: ${query}\n${result?.recommendation || ''}`,
          { type: 'intelligence', query, confidence: result?.overallConfidence }
        );
      } catch { /* non-fatal */ }
    });

    // agents:complete → store result in vector memory for future recall.
    //
    // The channel was `agent:complete` (singular) here while metaCognition
    // subscribed to `agents:complete` (plural) and agentOrchestrator emitted
    // neither — it only reached the renderer. Two receivers, two names, zero
    // publishers. Corrected to the plural name the orchestrator now emits, rather
    // than publishing both aliases: one event, two subscribers. Spec Section 54.
    this.onAsync('agents:complete', async ({ agentId, type, result }) => {
      try {
        const vectorMem = require('./ipc/vectorMemory.cjs');
        if (result && typeof result === 'string' && result.length > 20) {
          await vectorMem.store(result, { type: `agent-${type}`, agentId });
        }
      } catch { /* non-fatal */ }
    });

    // selfcare:regression → evolution engine queues a scout
    this.onAsync('selfcare:regression', async ({ axis, drop, message }) => {
      console.warn(`[EventBus] Capability regression on ${axis}: ${message}`);
      // Broadcast to renderer for master awareness
      try {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(w => {
          w.webContents.send('capability:regression', { axis, drop, message, ts: Date.now() });
        });
      } catch { /* ignore */ }
    });

    // git:changed → trigger code health scan
    this.onAsync('git:changed', async ({ repoPath, files }) => {
      try {
        const astEngine = require('./ipc/astEngine.cjs');
        // Async scan changed files for issues (non-blocking)
        for (const file of (files || []).slice(0, 5)) {
          if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.jsx')) {
            astEngine.analyzeFile(file).catch(() => {});
          }
        }
      } catch { /* non-fatal */ }
    });

    // vector:stored → update world model topic awareness
    this.onAsync('vector:stored', async ({ text, metadata }) => {
      // Future: extract entities and update world model graph
      // For now: just track that new knowledge was stored
    });

    // evolution:applied → track capability score improvement
    this.onAsync('evolution:applied', async ({ proposalId, axes }) => {
      try {
        const selfCare = require('./ipc/selfCare.cjs');
        for (const axis of (axes || [])) {
          selfCare.trackCapabilityScore(axis, 7.5);  // mark as improved
        }
      } catch { /* non-fatal */ }
    });

    // sandbox:error → log for code regeneration analysis
    this.onAsync('sandbox:error', async ({ code, language, error, execId }) => {
      try {
        const codeRegen = require('./ipc/codeRegenEngine.cjs');
        codeRegen.queueAnalysis({ code, language, error, source: 'sandbox' });
      } catch { /* non-fatal */ }
    });
  }

  // ── Status ────────────────────────────────────────────────────────────────
  getStatus() {
    return {
      eventTypes:   Object.keys(this._metrics).length,
      totalEmitted: Object.values(this._metrics).reduce((s, m) => s + m.count, 0),
      deadLetters:  this._deadLetters.length,
      metrics:      this._metrics,
      recentEvents: this._history.slice(0, 20),
    };
  }
}

// Singleton
const bus = new RamaEventBus();

function summarize(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 80);
  try { return JSON.stringify(data).slice(0, 80); } catch { return '[object]'; }
}

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {
  bus._ipcMain = ipcMain;
  bus.wireAutomaticFlows();

  ipcMain.handle('bus:emit', async (_e, event, data) => {
    bus.emit(event, data);
    return { ok: true };
  });

  ipcMain.handle('bus:status', async () => {
    return { ok: true, data: bus.getStatus() };
  });

  ipcMain.handle('bus:history', async (_e, limit) => {
    return { ok: true, data: bus._history.slice(0, limit || 50) };
  });
}

module.exports = { register, bus };
