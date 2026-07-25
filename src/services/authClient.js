/**
 * authClient.js — Auth API calls + session management.
 */

// All server calls go through apiClient.serverJson — one circuit breaker,
// one retry policy, one place that injects the session token.
import { serverJson as apiFetch } from '@services/apiClient.js';

// ─── Device fingerprint (for session binding) ─────────────────────────────────
function getFingerprint() {
  try {
    const fp = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join('|');
    return btoa(fp).slice(0, 32);
  } catch {
    return 'unknown';
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────
const SESSION_KEY = 'rama_session';

export function saveSession(token, user) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user, ts: Date.now() })); } catch { /* ignore */ }
}

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { token, user, ts } = JSON.parse(raw);
    if (user?.expiresAt && Date.now() > user.expiresAt) { clearSession(); return null; }
    return { token, user };
  } catch {
    return null;
  }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ─── Auth API ─────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username, password) => apiFetch('/api/auth/login', {
    method: 'POST',
    body:   JSON.stringify({ username, password, fingerprint: getFingerprint() }),
  }),

  logout: (token) => apiFetch('/api/auth/logout', { method: 'POST' }, token),

  me: (token) => apiFetch('/api/auth/me', {}, token),
};

// ─── User management API ──────────────────────────────────────────────────────
export const usersApi = {
  list: (token) => apiFetch('/api/users', {}, token),

  create: (token, data) => apiFetch('/api/users', {
    method: 'POST',
    body:   JSON.stringify(data),
  }, token),

  update: (token, id, data) => apiFetch(`/api/users/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(data),
  }, token),

  suspend: (token, id) => apiFetch(`/api/users/${id}/suspend`, { method: 'PUT' }, token),

  delete: (token, id) => apiFetch(`/api/users/${id}`, { method: 'DELETE' }, token),
};
