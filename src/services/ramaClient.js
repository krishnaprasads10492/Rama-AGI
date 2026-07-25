/**
 * ramaClient.js — HTTP client for Rama's local Express server (/api/*)
 * and future AI provider routing.
 * All calls go through localhost — nothing leaves the machine.
 */

const BASE = 'http://localhost:4097';

// ─── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, error: body.error || res.statusText };
    }

    const data = await res.json();
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────
export const health = {
  ping: () => apiFetch('/api/health'),
};

// ─── AI Chat ──────────────────────────────────────────────────────────────────
export const ramaChat = {
  send: ({ messages, provider, model, sessionId }) =>
    apiFetch('/api/ai/chat', {
      method: 'POST',
      body:   JSON.stringify({ messages, provider, model, sessionId }),
    }),

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
