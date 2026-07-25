/**
 * apiClient.js — Rāma AGI base API client.
 *
 * Ported from StockMind's battle-tested implementation with upgrades:
 *   - Circuit breaker (4 failures → 20s open state)
 *   - Exponential backoff retry (2 retries)
 *   - Request timeout with AbortController (8s default)
 *   - Auto-inject session token from sessionStorage
 *   - Rate limit (429) handling with backoff
 *   - Auto-clear session on 401
 *   - Structured ApiError with status + url
 */

const DEFAULT_TIMEOUT_MS        = 8000;
const MAX_RETRIES               = 2;
const RETRY_BASE_DELAY          = 200;
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_OPEN_DURATION_MS  = 20000;
const TOKEN_KEY                 = 'rama_session';

// ─── Circuit breaker state ─────────────────────────────────────────────────
const circuitState = new Map();  // origin → { failures, openUntil }

function getStoredToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token ?? null;
  } catch { return null; }
}

function toAbsolute(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:4097';
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function getOrigin(url) {
  try { return new URL(toAbsolute(url)).origin; } catch { return url; }
}

function isCircuitOpen(origin) {
  const state = circuitState.get(origin);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true;
  circuitState.delete(origin);
  return false;
}

function recordFailure(origin) {
  const state = circuitState.get(origin) ?? { failures: 0, openUntil: 0 };
  state.failures++;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
    console.warn(`[apiClient] Circuit open for ${origin} — ${state.failures} failures`);
  }
  circuitState.set(origin, state);
}

function recordSuccess(origin) {
  circuitState.delete(origin);
}

function backoff(attempt) {
  return new Promise(r => setTimeout(r, RETRY_BASE_DELAY * Math.pow(2, attempt)));
}

// ─── Core fetch with circuit breaker + retry ──────────────────────────────────
export async function apiFetch(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const origin = getOrigin(url);

  if (isCircuitOpen(origin)) {
    throw new ApiError('Service temporarily unavailable', 503, url);
  }

  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token    = getStoredToken();
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
          ...fetchOptions.headers,
        },
      });

      clearTimeout(timer);

      // 429 → backoff and retry
      if (response.status === 429) {
        recordFailure(origin);
        await backoff(attempt);
        continue;
      }

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.clone().json();
          if (body.error) message = body.error;
        } catch { /* ignore */ }

        // 401 → clear session so user gets redirected to unlock
        if (response.status === 401) {
          try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        }

        throw new ApiError(message, response.status, url);
      }

      recordSuccess(origin);
      return response;

    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      // Don't retry 4xx client errors
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        recordFailure(origin);
        throw err;
      }

      recordFailure(origin);
      if (attempt < MAX_RETRIES - 1) await backoff(attempt);
    }
  }

  throw lastError ?? new ApiError('Request failed', 0, url);
}

// ─── Local Rāma server helper ─────────────────────────────────────────────────
// Single entry point for every renderer → Express call. authClient.js and
// ramaClient.js used to each carry their own `apiFetch` with a hardcoded base
// URL and no circuit breaker; they now both route through here.
export const SERVER_BASE = 'http://localhost:4097';

/**
 * Call the local Rāma server and return parsed JSON.
 * Never throws — resolves to `{ ok: false, error, status }` on failure so
 * callers can render an error state instead of crashing a page.
 */
export async function serverJson(path, opts = {}, token = null) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await apiFetch(`${SERVER_BASE}${path}`, { ...opts, headers });
    return await res.json().catch(() => ({ ok: true }));
  } catch (err) {
    return { ok: false, error: err.message, status: err.status ?? 0 };
  }
}

// ─── JSON fetch shorthand ─────────────────────────────────────────────────────
export async function apiJson(url, options = {}) {
  const res  = await apiFetch(url, options);
  const data = await res.json();
  return data;
}

// ─── POST shorthand ───────────────────────────────────────────────────────────
export async function apiPost(url, body, options = {}) {
  return apiFetch(url, {
    method: 'POST',
    body:   JSON.stringify(body),
    ...options,
  });
}

export class ApiError extends Error {
  constructor(message, status, url) {
    super(message);
    this.name   = 'ApiError';
    this.status = status;
    this.url    = url;
  }
}

// ─── Circuit breaker status (for UI diagnostics) ──────────────────────────────
export function getCircuitStatus() {
  return Object.fromEntries(
    [...circuitState.entries()].map(([origin, state]) => [
      origin,
      { failures: state.failures, openUntil: state.openUntil, isOpen: state.openUntil > Date.now() },
    ])
  );
}
