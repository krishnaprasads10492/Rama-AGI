/**
 * authClient.js — renderer side of the three-gate login.
 *
 *   Gate 1  passcode → unlocks the encrypted store   (see Unlock.jsx)
 *   Gate 2  password → step token                    (loginStep1)
 *   Gate 3  12-digit access key → session token      (loginStep2)
 *
 * TRANSPORT: IPC to the Electron main process is the real path — that is where
 * the encrypted user store lives. The HTTP path exists only for browser dev
 * mode, where there is no store and no accounts, and it says so plainly rather
 * than pretending to authenticate.
 */

import { serverJson } from '@services/apiClient.js';

const ipc = () => (typeof window !== 'undefined' ? window.rama?.auth : null);
const inElectron = () => !!ipc();

const noIpc = (what) => ({
  ok: false,
  error: `${what} needs the desktop app — accounts live in the encrypted store, which the browser cannot open.`,
  browserOnly: true,
});

// ─── Device fingerprint ───────────────────────────────────────────────────────
/**
 * Stable per-browser/per-machine value. Session tokens are bound to it, so a
 * stolen token cannot be replayed from somewhere else.
 */
export function getFingerprint() {
  try {
    const parts = [
      navigator.userAgent,
      navigator.language,
      String(screen.width), String(screen.height),
      String(new Date().getTimezoneOffset()),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ];
    return btoa(parts.join('|')).slice(0, 44);
  } catch {
    return 'unknown-client';
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────
const SESSION_KEY = 'rama_session';

export function saveSession(token, user) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user, ts: Date.now() }));
  } catch { /* private mode — session lives in memory only */ }
}

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { token, user, ts } = JSON.parse(raw);
    if (!token || !user) return null;
    if (user.expiresAt && Date.now() > user.expiresAt) { clearSession(); return null; }
    return { token, user, ts };
  } catch {
    return null;
  }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ─── Instance provisioning (first run) ────────────────────────────────────────
export const instanceApi = {
  /** Which gate should the UI show? Answers even while the store is locked. */
  info: async () => {
    const api = ipc();
    if (!api) return { ok: true, data: { storeLocked: false, provisioned: false, browserOnly: true } };
    return api.instanceInfo();
  },

  /**
   * Create the owner account for this copy of Rāma.
   * Tier defaults to SuperAdmin (1); Master (0) requires the enrolment secret.
   */
  provision: async ({ username, password, displayName, tier, instanceName, masterSecret }) => {
    const api = ipc();
    if (!api) return noIpc('Provisioning');
    return api.provision({ username, password, displayName, tier, instanceName, masterSecret });
  },
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  /** Gate 2 — returns a short-lived step token, never a session. */
  step1: async (username, password) => {
    const api = ipc();
    if (!api) return noIpc('Sign-in');
    return api.loginStep1({ username: String(username).trim(), password });
  },

  /** Gate 3 — exchanges the step token plus the access key for a session. */
  step2: async (stepToken, key) => {
    const api = ipc();
    if (!api) return noIpc('Sign-in');
    return api.loginStep2({ stepToken, key, fingerprint: getFingerprint() });
  },

  logout: async (token) => {
    const api = ipc();
    clearSession();
    if (!api) return { ok: true };
    return api.logout(token);
  },

  me: async (token) => {
    const api = ipc();
    if (!api) return noIpc('Session lookup');
    return api.me({ token, fingerprint: getFingerprint() });
  },

  checkPassword: async (password) => {
    const api = ipc();
    if (!api) return { ok: true, data: { ok: true } };
    return api.checkPassword(password);
  },

  changePassword: async (token, currentPassword, newPassword) => {
    const api = ipc();
    if (!api) return noIpc('Password change');
    return api.changePassword({ token, fingerprint: getFingerprint(), currentPassword, newPassword });
  },
};

// ─── Access keys ──────────────────────────────────────────────────────────────
export const keyApi = {
  /** Signed-in rotation — re-verifies the password before minting. */
  rotate: async (token, password, daysValid = 30) => {
    const api = ipc();
    if (!api) return noIpc('Key generation');
    return api.keygen({ token, fingerprint: getFingerprint(), password, daysValid });
  },

  /** From a live step token: password already proven, no key on file. */
  fromStepToken: async (stepToken) => {
    const api = ipc();
    if (!api) return noIpc('Key generation');
    return api.keygenFromStep(stepToken);
  },

  /** From credentials: for a machine where the user has no key at all. */
  fromCredentials: async (username, password) => {
    const api = ipc();
    if (!api) return noIpc('Key generation');
    return api.keygenFromCreds({ username: String(username).trim(), password });
  },

  /** Admin issuing a key for another account. */
  issueFor: async (token, userId, daysValid = 30) => {
    const api = ipc();
    if (!api) return noIpc('Key generation');
    return api.issueKey({ token, fingerprint: getFingerprint(), userId, daysValid });
  },
};

// ─── User management ──────────────────────────────────────────────────────────
export const usersApi = {
  list: async (token) => {
    const api = ipc();
    if (!api) return noIpc('User management');
    return api.listUsers({ token, fingerprint: getFingerprint() });
  },

  create: async (token, fields) => {
    const api = ipc();
    if (!api) return noIpc('User management');
    return api.createUser({ token, fingerprint: getFingerprint(), ...fields });
  },

  setTier: async (token, userId, tier) => {
    const api = ipc();
    if (!api) return noIpc('User management');
    return api.setTier({ token, fingerprint: getFingerprint(), userId, tier });
  },

  setActive: async (token, userId, isActive) => {
    const api = ipc();
    if (!api) return noIpc('User management');
    return api.setActive({ token, fingerprint: getFingerprint(), userId, isActive });
  },

  remove: async (token, userId) => {
    const api = ipc();
    if (!api) return noIpc('User management');
    return api.deleteUser({ token, fingerprint: getFingerprint(), userId });
  },

  resetPassword: async (token, userId, newPassword) => {
    const api = ipc();
    if (!api) return noIpc('User management');
    return api.resetPassword({ token, fingerprint: getFingerprint(), userId, newPassword });
  },

  sessions: async (token) => {
    const api = ipc();
    if (!api) return noIpc('Session audit');
    return api.sessions({ token, fingerprint: getFingerprint() });
  },

  status: async (token) => {
    const api = ipc();
    if (!api) return noIpc('Auth status');
    return api.status({ token, fingerprint: getFingerprint() });
  },
};

// ─── Server health (the one thing the browser path is genuinely useful for) ────
export const serverApi = {
  health: () => serverJson('/api/health'),
};

export { inElectron };
