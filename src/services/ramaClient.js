/**
 * ramaClient.js — HTTP client for Rama's local Express server (/api/*)
 * and future AI provider routing.
 * All calls go through localhost — nothing leaves the machine.
 */

// Shared transport — circuit breaker, retry/backoff, token injection.
import { serverJson as apiFetch } from '@services/apiClient.js';

// ─── Health ───────────────────────────────────────────────────────────────────
export const health = {
  ping: () => apiFetch('/api/health'),
};

// ─── AI Chat ──────────────────────────────────────────────────────────────────
// PRIMARY PATH: window.rama.models.chat() → modelRouter (main process, vault access)
// FALLBACK:     HTTP /api/ai/chat (browser dev mode only — no vault access)
export const ramaChat = {
  send: async ({ messages, provider, model, sessionId, taskType }) => {
    // Real path — IPC to modelRouter which has credential vault access
    if (typeof window !== 'undefined' && window.rama?.models?.chat) {
      try {
        const res = await window.rama.models.chat({ messages, model, taskType: taskType || 'general' });
        if (res?.ok) {
          return {
            ok:        true,
            sessionId: sessionId || `s_${Date.now()}`,
            message:   { role: 'assistant', content: res.content },
            model:     res.model,
            fallbackFrom: res.fallbackFrom,
            usage:     res.usage,
          };
        }
        // modelRouter returned an error — surface it, don't silently fall back
        return { ok: false, error: res?.error || 'Model router returned no content' };
      } catch (err) {
        return { ok: false, error: `IPC error: ${err.message}` };
      }
    }

    // Browser dev-mode fallback — no vault, so provider keys must come from .env
    return apiFetch('/api/ai/chat', {
      method: 'POST',
      body:   JSON.stringify({ messages, provider, model, sessionId }),
    });
  },

  getHistory: (sessionId) =>
    apiFetch(`/api/ai/history/${sessionId}`),

  deleteHistory: (sessionId) =>
    apiFetch(`/api/ai/history/${sessionId}`, { method: 'DELETE' }),
};

// ─── System metrics via HTTP (alternative to IPC) ─────────────────────────────
export const systemHttp = {
  getMetrics: () => apiFetch('/api/system/metrics'),
};

// ─── Format bytes utility ─────────────────────────────────────────────────────
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k     = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

// ─── Format uptime ────────────────────────────────────────────────────────────
export function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
