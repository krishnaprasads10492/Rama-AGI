import { create } from 'zustand';
import { TIERS, can } from '@services/accessControl.js';
import { visibleRoutes as registryVisibleRoutes, capabilitiesForTier } from '@config/registry.js';

/**
 * userStore — Active session + user management state.
 * The current session user is what gates all UI capabilities.
 */
export const useUserStore = create((set, get) => ({

  // ── Current session ────────────────────────────────────────────────────────
  currentUser: null,       // { id, name, tier, email, avatar, expiresAt }
  sessionToken: null,      // HMAC-signed token from server
  sessionExpiry: null,

  // ── User list (admin view) ─────────────────────────────────────────────────
  users: [],
  usersLoading: false,

  // ── Auth state ────────────────────────────────────────────────────────────
  authLoading: false,
  authError:   null,

  // ── Login ─────────────────────────────────────────────────────────────────
  setSession: (user, token) => {
    set({
      currentUser:   user,
      sessionToken:  token,
      sessionExpiry: user?.expiresAt ?? null,
      authError:     null,
    });
  },

  clearSession: () => {
    set({ currentUser: null, sessionToken: null, sessionExpiry: null });
  },

  // ── Convenience checks ────────────────────────────────────────────────────
  isMaster: () => get().currentUser?.tier === TIERS.MASTER,

  canDo: (capability) => {
    const user = get().currentUser;
    return can(user, capability);
  },

  visibleRoutes: () => registryVisibleRoutes(get().currentUser),

  // Page-level capabilities the current session can actually reach
  sessionCapabilities: () => capabilitiesForTier(get().currentUser),

  // ── User management ────────────────────────────────────────────────────────
  setUsers: (users) => set({ users }),
  addUser:  (user)  => set(s => ({ users: [...s.users, user] })),

  updateUser: (id, changes) => set(s => ({
    users: s.users.map(u => u.id === id ? { ...u, ...changes } : u),
  })),

  removeUser: (id) => set(s => ({
    users: s.users.filter(u => u.id !== id),
  })),

  setAuthLoading: (v)   => set({ authLoading: v }),
  setAuthError:   (err) => set({ authError: err }),
}));
