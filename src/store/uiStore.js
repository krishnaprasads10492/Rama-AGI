import { create } from 'zustand';

/**
 * uiStore — Command palette, voice, navigation, identity state.
 */
export const useUIStore = create((set, get) => ({

  // ── Command Palette ────────────────────────────────────────────────────────
  paletteOpen:   false,
  paletteQuery:  '',
  openPalette:   ()      => set({ paletteOpen: true,  paletteQuery: '' }),
  closePalette:  ()      => set({ paletteOpen: false, paletteQuery: '' }),
  togglePalette: ()      => set(s => ({ paletteOpen: !s.paletteOpen, paletteQuery: '' })),
  setPaletteQuery: (q)   => set({ paletteQuery: q }),

  // ── Recent pages ──────────────────────────────────────────────────────────
  recentPages: [],
  pushRecent: (route, label) => set(s => {
    const filtered = s.recentPages.filter(r => r.route !== route);
    return { recentPages: [{ route, label }, ...filtered].slice(0, 5) };
  }),

  // ── Voice ─────────────────────────────────────────────────────────────────
  voiceActive:    false,   // mic is listening
  voiceWakeReady: false,   // wake word engine ready
  lastVoiceCmd:   '',
  setVoiceActive:    (v)   => set({ voiceActive: v }),
  setVoiceWakeReady: (v)   => set({ voiceWakeReady: v }),
  setLastVoiceCmd:   (cmd) => set({ lastVoiceCmd: cmd }),

  // ── Identity / Consciousness ───────────────────────────────────────────────
  masterAuthenticated: false,
  consciousnessActive: false,
  lastHealthCheck:     null,
  setMasterAuth:       (v)    => set({ masterAuthenticated: v }),
  setConsciousness:    (v)    => set({ consciousnessActive: v }),
  setLastHealthCheck:  (data) => set({ lastHealthCheck: data }),

  // ── Self-modification ─────────────────────────────────────────────────────
  pendingModification: null,   // { files, diff, description, requiresRestart }
  setPendingMod: (mod)  => set({ pendingModification: mod }),
  clearPendingMod: ()   => set({ pendingModification: null }),
}));
