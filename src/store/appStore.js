import { create } from 'zustand';

/**
 * appStore — Global app-level state.
 * Theme, active page, update notifications, sidebar state.
 */
export const useAppStore = create((set, get) => ({
  // ── Active page ─────────────────────────────────────────────────────────
  activePage: '/',
  setActivePage: (route) => set({ activePage: route }),

  // ── Update state ─────────────────────────────────────────────────────────
  updateAvailable:  false,
  updateDownloaded: false,
  updateInfo:       null,
  setUpdateAvailable:  (info) => set({ updateAvailable: true,  updateInfo: info }),
  setUpdateDownloaded: (info) => set({ updateDownloaded: true, updateInfo: info }),

  // ── Sidebar ──────────────────────────────────────────────────────────────
  sidebarExpanded: false,
  setSidebarExpanded: (v) => set({ sidebarExpanded: v }),

  // ── System metrics (lightweight, titlebar level) ──────────────────────────
  cpu: 0,
  ram: 0,
  setMetrics: ({ cpu, ram }) => set({ cpu, ram }),

  // ── Notification queue (toast-style) ──────────────────────────────────────
  notifications: [],
  pushNotification: (msg) => {
    const id = Date.now();
    set(s => ({ notifications: [{ id, ...msg }, ...s.notifications].slice(0, 10) }));
    setTimeout(() => {
      set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
    }, msg.duration || 5000);
  },
  dismissNotification: (id) =>
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) })),
}));
