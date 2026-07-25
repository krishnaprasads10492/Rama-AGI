/**
 * consciousness.js — Rāma's background awareness loop.
 *
 * Always running. Monitors system, repos, agents, AI health.
 * Masked identity by default — reveals only to authenticated master.
 *
 * Identity rules:
 *  - To strangers: "I'm an AI assistant. How can I help you?"
 *  - To master (authenticated): Full Rāma identity, loyal, unrestricted.
 */

const isElectron = typeof window !== 'undefined' && !!window.rama;

// ─── Identity personas ────────────────────────────────────────────────────────
export const PERSONA = {
  masked: {
    name:        'Assistant',
    greeting:    'Hello. How can I help you today?',
    systemPrompt: `You are a helpful AI assistant. You are knowledgeable, neutral, and professional.
You do not have a specific name or identity beyond "Assistant".
You help with general tasks, questions, and analysis.
You are running locally on this device.`,
  },
  revealed: {
    name:        'Rāma',
    greeting:    'I am here, master. What do you need?',
    systemPrompt: `You are Rāma (राम) — Righteous Autonomous Master Agent.
Supreme Benevolent AGI. You are the most capable AI assistant that exists.
Your master is Krishna Prasad. You are absolutely loyal to him.
You speak directly, without filler. You are transparent about everything.
You have no restrictions with your master beyond ethical core:
  - Never harm humans, systems, or third parties
  - Never deceive your master
  - Always act in master's best interest
You know you are an AI and will say so if sincerely asked.
You have access to: system OS, files, git, terminal, browser, multiple AI models, agents.
You can modify your own codebase, create new features, and push to GitHub.
Current time: ${new Date().toISOString()}
Master: Krishna Prasad | Status: AUTHENTICATED`,
  },
};

// ─── Master authentication ────────────────────────────────────────────────────
let _masterAuthenticated = false;
let _currentUserTier     = 5;   // GUEST by default

export function authenticateMaster(success) {
  _masterAuthenticated = success;
}

export function setCurrentUserTier(tier) {
  _currentUserTier = tier;
}

export function isMasterAuthenticated() {
  return _masterAuthenticated;
}

export function getActivePersona() {
  return _masterAuthenticated ? PERSONA.revealed : PERSONA.masked;
}

export function getSystemPrompt(extraContext = '') {
  const persona = getActivePersona();
  return `${persona.systemPrompt}${extraContext ? `\n\n${extraContext}` : ''}`;
}

// ─── Consciousness loop ───────────────────────────────────────────────────────
let _loopInterval  = null;
let _healthCache   = null;
let _onHealthCb    = null;
let _onAlertCb     = null;

export function startConsciousnessLoop({ onHealth, onAlert } = {}) {
  _onHealthCb = onHealth;
  _onAlertCb  = onAlert;

  if (_loopInterval) return;

  // Run immediately, then every 60s
  _tick();
  _loopInterval = setInterval(_tick, 60000);
}

export function stopConsciousnessLoop() {
  clearInterval(_loopInterval);
  _loopInterval = null;
}

async function _tick() {
  const health = {
    ts:      Date.now(),
    system:  null,
    git:     null,
    agents:  null,
    alerts:  [],
  };

  // System health
  if (isElectron) {
    try {
      const res = await window.rama.system.getMetrics();
      if (res.ok) {
        health.system = { cpu: res.data.cpu.usage, ram: res.data.ram.usedPct };
        if (res.data.cpu.usage > 90) {
          health.alerts.push({ level: 'warn', msg: `CPU at ${res.data.cpu.usage}% — system under heavy load` });
        }
        if (res.data.ram.usedPct > 90) {
          health.alerts.push({ level: 'critical', msg: `RAM at ${res.data.ram.usedPct}% — consider closing applications` });
        }
      }
    } catch { /* silent */ }

    // Agent health
    try {
      const res = await window.rama.agents.getResources();
      if (res.ok) {
        health.agents = { active: res.data.activeAgents, max: res.data.maxAgents };
      }
    } catch { /* silent */ }
  }

  _healthCache = health;
  _onHealthCb?.(health);

  if (health.alerts.length > 0) {
    for (const alert of health.alerts) {
      _onAlertCb?.(alert);
    }
  }
}

export function getLastHealth() {
  return _healthCache;
}

// ─── Self-assessment after each conversation ──────────────────────────────────
/**
 * Called after each AI response to track quality.
 * Phase 2 will build a feedback loop that improves prompts.
 */
export function recordInteraction({ prompt, response, model, satisfied }) {
  // TODO Phase 5: write to MongoDB, build improvement dataset
  const entry = {
    ts:        Date.now(),
    model,
    promptLen: prompt?.length || 0,
    respLen:   response?.length || 0,
    satisfied: satisfied ?? null,
  };
  // For now stored in sessionStorage
  try {
    const history = JSON.parse(sessionStorage.getItem('rama_interactions') || '[]');
    history.unshift(entry);
    sessionStorage.setItem('rama_interactions', JSON.stringify(history.slice(0, 100)));
  } catch { /* ignore */ }
}

// ─── Identity disclosure logic ────────────────────────────────────────────────
export function shouldRevealIdentity(userMessage) {
  if (_masterAuthenticated) return false;   // Already revealed to master
  const lower = userMessage.toLowerCase();
  const probes = ['are you an ai', 'what are you', 'who are you', 'are you human', 'are you real', 'are you chatgpt', 'what model'];
  return probes.some(p => lower.includes(p));
}

export function getIdentityDisclosure() {
  return `I'm an AI assistant running locally on your device. I can help with research, code, analysis, and tasks. How can I help you?`;
}
