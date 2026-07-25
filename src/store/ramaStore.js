import { create } from 'zustand';

/**
 * ramaStore — Rāma AI state.
 * Conversations, provider config, memory, activity state.
 */
export const useRamaStore = create((set, get) => ({
  // ── AI Provider config ────────────────────────────────────────────────────
  provider: 'openai',          // 'openai' | 'anthropic' | 'ollama' | 'gemini'
  model:    'gpt-4o',
  apiKey:   '',                // stored encrypted in Phase 2
  setProvider: (provider) => set({ provider }),
  setModel:    (model)    => set({ model }),
  setApiKey:   (apiKey)   => set({ apiKey }),

  // ── Activity ──────────────────────────────────────────────────────────────
  isThinking: false,           // true while awaiting AI response
  setThinking: (v) => set({ isThinking: v }),

  // ── Conversations (keyed by session ID) ───────────────────────────────────
  sessions: {},                // { [sessionId]: { id, title, messages[], createdAt } }
  activeSessionId: null,

  createSession: () => {
    const id  = `session_${Date.now()}`;
    const session = {
      id,
      title:     'New Conversation',
      messages:  [],
      createdAt: Date.now(),
    };
    set(s => ({
      sessions:        { ...s.sessions, [id]: session },
      activeSessionId: id,
    }));
    return id;
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  deleteSession: (id) => set(s => {
    const sessions = { ...s.sessions };
    delete sessions[id];
    const ids = Object.keys(sessions);
    return {
      sessions,
      activeSessionId: s.activeSessionId === id
        ? (ids[ids.length - 1] ?? null)
        : s.activeSessionId,
    };
  }),

  // Add message to active session
  addMessage: (message) => {
    const { activeSessionId, sessions } = get();
    if (!activeSessionId) return;
    const session  = sessions[activeSessionId];
    if (!session) return;
    const updated  = {
      ...session,
      messages: [...session.messages, { ...message, id: Date.now() }],
      // Auto-title from first user message
      title: session.messages.length === 0 && message.role === 'user'
        ? message.content.slice(0, 60)
        : session.title,
    };
    set(s => ({ sessions: { ...s.sessions, [activeSessionId]: updated } }));
  },

  clearSession: (id) => {
    const { sessions } = get();
    const session = sessions[id];
    if (!session) return;
    set(s => ({
      sessions: { ...s.sessions, [id]: { ...session, messages: [] } },
    }));
  },

  // ── Knowledge (persistent context injected into every prompt) ─────────────
  knowledgeSummary: '',
  setKnowledgeSummary: (v) => set({ knowledgeSummary: v }),

  // ── Backend status ────────────────────────────────────────────────────────
  backendRunning: false,
  setBackendRunning: (v) => set({ backendRunning: v }),
}));
