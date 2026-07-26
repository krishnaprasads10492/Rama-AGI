import { create } from 'zustand';

/**
 * uiStore — Command palette, voice, navigation, identity state.
 *
 * A few voice preferences persist to localStorage rather than the encrypted
 * store: they are UI preferences, not data, and they have to be readable before
 * the passcode gate has opened the store.
 */
function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* private mode — preference lasts for this session only */ }
}
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
  // Mic mute and speech mute are deliberately independent: silencing Rāma's
  // replies should not also stop it hearing you. See spec section 31.
  voiceActive:    false,          // a capture session is live
  voiceWakeReady: false,          // wake-word engine is viable
  lastVoiceCmd:   '',

  micMode:     loadPref('rama.micMode', 'ptt'),        // off | ptt | hands-free | wake
  micMuted:    loadPref('rama.micMuted', false),       // Rāma cannot hear
  speechMuted: loadPref('rama.speechMuted', false),    // Rāma does not speak

  setVoiceActive:    (v)   => set({ voiceActive: v }),
  setVoiceWakeReady: (v)   => set({ voiceWakeReady: v }),
  setLastVoiceCmd:   (cmd) => set({ lastVoiceCmd: cmd }),

  setMicMode: (mode) => {
    savePref('rama.micMode', mode);
    set({ micMode: mode });
  },

  setMicMuted: (v) => {
    savePref('rama.micMuted', v);
    set({ micMuted: v });
  },

  toggleMicMuted: () => {
    const next = !get().micMuted;
    savePref('rama.micMuted', next);
    set({ micMuted: next });
    return next;
  },

  setSpeechMuted: (v) => {
    savePref('rama.speechMuted', v);
    set({ speechMuted: v });
  },

  toggleSpeechMuted: () => {
    const next = !get().speechMuted;
    savePref('rama.speechMuted', next);
    set({ speechMuted: next });
    return next;
  },

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
