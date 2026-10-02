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
  // `user` is forwarded because the keyed cloud path is capability-gated inside the transport, and
  // this is the ONLY models.chat caller in the tree — without it the gate stands shut and every
  // cloud request comes back as a gate error that looks like a policy decision.
  send: async ({ messages, provider, model, sessionId, taskType, user }) => {
    // Real path — IPC to modelRouter which has credential vault access
    if (typeof window !== 'undefined' && window.rama?.models?.chat) {
      try {
        const res = await window.rama.models.chat({ messages, model, taskType: taskType || 'general', user });
        if (res?.ok) {
          return {
            ok:        true,
            sessionId: sessionId || `s_${Date.now()}`,
            message:   { role: 'assistant', content: res.content },
            model:     res.model,
            fallbackFrom: res.fallbackFrom,
            usage:     res.usage,
            // WHICH PATH SERVED THE REQUEST, forwarded rather than discarded: 'cloud' | 'local' |
            // undefined, where undefined means a provider that has only one path. And when a
            // fallback answered, `unconfigured` says WHY the substitution happened — the chain
            // declares both and this is the layer that used to drop one of them.
            unconfigured: res.unconfigured ?? null,
            path:         res.path ?? null,
            endpoint:     res.endpoint ?? null,
            via:          res.via ?? null,
            credentialSource: res.credentialSource ?? null,
          };
        }
        // modelRouter returned an error — surface it, don't silently fall back. ABSENT IS NOT
        // BROKEN: `unconfigured` and `remedy` are the fields that make a missing credential
        // actionable, and deleting them here would make the one useful sentence unreachable.
        return {
          ok:    false,
          error: res?.error || 'Model router returned no content',
          unconfigured: res?.unconfigured ?? null,
          failures:     res?.failures ?? null,
          remedy:       res?.remedy ?? null,
          gateError:    res?.gateError ?? false,
        };
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
