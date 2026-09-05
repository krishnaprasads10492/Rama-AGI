/**
 * cognition.js — Rāma's cognition ladder (spec section 35).
 *
 *   TIER 0  REFLEX   nothing required. Its own state, appearance, navigation,
 *                    system readings, muting. Never calls a model.
 *   TIER 1  LOCAL    a local model (Ollama). Private, free.
 *   TIER 2  CLOUD    a vault API key. Hard reasoning, research, long context.
 *   TIER 3  LEARN    turns a repeatedly-escalated phrasing into a tier-0 reflex,
 *                    proposed through the approval ledger.
 *
 * WHY TIER 0 EXISTS AT ALL: "make the text bigger" is not a language problem.
 * Routing it to a cloud LLM would be slower, cost money, fail offline, and fail
 * while the vault is locked. Anything Rāma can do to *itself* belongs at tier 0
 * by definition — that is what makes it able to improve its own UX on request.
 *
 * Escalation is strictly ordered, and every resolution is recorded with the tier
 * that answered. That record is what tier 3 consumes.
 */

import { matchVoiceToRoute, visiblePages, allCapabilities } from '@config/registry.js';

export const TIERS = { REFLEX: 0, LOCAL: 1, CLOUD: 2, LEARN: 3 };
export const TIER_NAMES = ['REFLEX', 'LOCAL', 'CLOUD', 'LEARN'];

const ipc = () => (typeof window !== 'undefined' ? window.rama : null);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
const any  = (t, ...phrases) => phrases.some(p => t.includes(p));

function pct(n) { return `${Math.round(n * 100)}%`; }

/**
 * Appearance skills need an explicit UI subject, not just a direction word.
 * Without this, "refactor this function to be smaller" matched the zoom-out
 * reflex — a false positive is worse than an escalation, because the user's
 * actual request is silently replaced by an unrelated action.
 */
const UI_SUBJECT = [
  'text', 'font', 'fonts', 'letter', 'letters', 'type', 'typeface',
  'zoom', 'ui', 'interface', 'screen', 'display', 'everything',
];

const hasUiSubject = (t) => UI_SUBJECT.some(s => new RegExp(`\\b${s}\\b`).test(t));

// ─── Tier 0 skill registry ────────────────────────────────────────────────────
/**
 * A skill is declarative: what it matches, what it does, what it says. It never
 * reaches the network and never blocks. The registry is data so tier 3 can extend
 * it and `capabilities()` can enumerate it truthfully.
 *
 * @typedef  {Object} Skill
 * @property {string}   id
 * @property {string}   domain      appearance | navigation | voice | system | self | meta
 * @property {string}   describe    what a user can ask for
 * @property {(t:string)=>boolean} match
 * @property {(ctx:object, t:string)=>Promise<{say:string, action?:object}>} run
 */

/** @type {Skill[]} */
export const SKILLS = [
  // ── Appearance: Rāma acting on its own legibility ──────────────────────────
  {
    id: 'appearance.bigger',
    domain: 'appearance',
    describe: 'make the text bigger / zoom in',
    match: (t) =>
      any(t, 'bigger', 'larger', 'increase', 'enlarge', 'zoom in', 'too small', 'illegible', 'legible')
      && hasUiSubject(t),
    run: async () => {
      const api = ipc()?.appearance;
      if (!api) return { say: 'Scaling needs the desktop app.' };
      const res = await api.nudgeZoom(0.1);
      if (!res?.ok) return { say: `I could not change the scale: ${res?.error ?? 'unknown'}` };
      return {
        say: res.atLimit
          ? `Text is at the maximum scale (${pct(res.zoom)}). I will not go further — the titlebar starts to clip.`
          : `Text scaled up to ${pct(res.zoom)}.`,
        action: { type: 'zoom', zoom: res.zoom },
      };
    },
  },
  {
    id: 'appearance.smaller',
    domain: 'appearance',
    describe: 'make the text smaller / zoom out',
    match: (t) =>
      any(t, 'smaller', 'reduce', 'zoom out', 'shrink', 'decrease', 'too big', 'too large')
      && hasUiSubject(t),
    run: async () => {
      const api = ipc()?.appearance;
      if (!api) return { say: 'Scaling needs the desktop app.' };
      const res = await api.nudgeZoom(-0.1);
      if (!res?.ok) return { say: `I could not change the scale: ${res?.error ?? 'unknown'}` };
      return {
        say: res.atLimit
          ? `Text is at the minimum scale (${pct(res.zoom)}). Going smaller would make the interface unusable.`
          : `Text scaled down to ${pct(res.zoom)}.`,
        action: { type: 'zoom', zoom: res.zoom },
      };
    },
  },
  {
    id: 'appearance.reset',
    domain: 'appearance',
    describe: 'reset the zoom to normal',
    match: (t) => any(t, 'reset zoom', 'reset the zoom', 'default size', 'normal size', 'reset text size', 'reset scale'),
    run: async () => {
      const api = ipc()?.appearance;
      if (!api) return { say: 'Scaling needs the desktop app.' };
      const res = await api.setZoom(1);
      return res?.ok
        ? { say: 'Scale reset to 100%.', action: { type: 'zoom', zoom: 1 } }
        : { say: `I could not reset the scale: ${res?.error ?? 'unknown'}` };
    },
  },

  // ── Navigation ─────────────────────────────────────────────────────────────
  {
    id: 'navigation.open',
    domain: 'navigation',
    describe: 'open a page by name',
    match: (t) => !!matchVoiceToRoute(t),
    run: async (ctx, t) => {
      const hit = matchVoiceToRoute(t);
      return {
        say: `Opening ${hit.page.label}.`,
        action: { type: 'navigate', route: hit.route },
      };
    },
  },

  // ── Voice ──────────────────────────────────────────────────────────────────
  {
    id: 'voice.mute',
    domain: 'voice',
    describe: 'mute or unmute the microphone / stop Rāma speaking',
    match: (t) => any(t, 'mute', 'stop listening', 'stop talking', 'be quiet'),
    run: async (_ctx, t) => {
      const speech = any(t, 'talking', 'quiet', 'speaking', 'voice output');
      return {
        say: speech ? 'I will stay silent.' : 'Microphone muted.',
        action: { type: speech ? 'mute-speech' : 'mute-mic' },
      };
    },
  },

  // ── System readings — measured, no model needed ────────────────────────────
  {
    id: 'system.status',
    domain: 'system',
    describe: 'CPU, memory and uptime',
    match: (t) => any(t, 'cpu', 'memory', 'ram', 'how much memory', 'system load', 'uptime', 'how are you running'),
    run: async () => {
      const api = ipc()?.system;
      if (!api) return { say: 'System readings need the desktop app.' };

      const res = await api.getMetrics();
      if (!res?.ok || !res.data) {
        return { say: `I cannot read system metrics right now: ${res?.error ?? 'unavailable'}` };
      }

      const d = res.data;
      const up = Math.round((d.os?.uptime ?? 0) / 3600);
      return {
        say: `CPU ${d.cpu?.usage ?? '?'}% across ${d.cpu?.cores?.length ?? '?'} cores, `
           + `memory ${d.ram?.usedPct ?? '?'}% used, up ${up}h on ${d.os?.platform ?? 'unknown'}.`,
      };
    },
  },

  // ── Self-knowledge, answered from the registry rather than invented ─────────
  {
    id: 'self.capabilities',
    domain: 'meta',
    describe: 'what can you do',
    match: (t) => any(t, 'what can you do', 'your capabilities', 'what are you able', 'list your abilities', 'help'),
    /**
     * Speaks from the SELF-MODEL (Section 89), not from a second computation.
     *
     * This skill used to answer from `visiblePages` + `allCapabilities` + `SKILLS.length`, which is
     * a different derivation than the one Settings → Self shows — so asking out loud and looking at
     * the panel could give different accounts of the same thing, with nothing to reconcile them.
     * That drift is precisely what the self-model was built to end.
     *
     * It also now says the LIMITS out loud. Answering "what can you do" with strengths only is how
     * a user ends up trusting a capability that is not there.
     *
     * Still tier 0: `self:describe` reaches no model and no network. The old local computation is
     * kept as the fallback for when the IPC is absent — a web build, or a degraded install.
     */
    run: async (ctx) => {
      const local = () => {
        const pages  = visiblePages(ctx?.user).map(p => p.label);
        const caps   = allCapabilities().length;
        const skills = SKILLS.length;
        return `I reach ${pages.length} modules on this account (${pages.slice(0, 6).join(', ')}`
           + `${pages.length > 6 ? `, +${pages.length - 6} more` : ''}), covering ${caps} capabilities. `
           + `${skills} things I handle instantly without any model — appearance, navigation, `
           + `system readings, voice. Anything harder I route to a local model first, then the cloud.`;
      };

      const api = ipc();
      if (!api?.self?.describe) return { say: local() };

      try {
        const res = await api.self.describe({ user: ctx?.user, reflexSkills: SKILLS.length });
        if (!res?.ok) return { say: local() };

        const m = res.data;
        const limits = Array.isArray(m.limits) ? m.limits : [];
        let say = m.summary?.text || local();

        if (limits.length) {
          const top = limits.slice(0, 3).map(l => l.what);
          say += ` Specifically I cannot ${top.join('; nor ')}`;
          say += limits.length > 3 ? `, and ${limits.length - 3} more.` : '.';
          say += ' Settings → Self lists why, and what would change each one.';
        }
        return { say };
      } catch {
        return { say: local() };
      }
    },
  },
  {
    id: 'self.cognition',
    domain: 'meta',
    describe: 'which tier answered / how you think',
    match: (t) => any(t, 'how do you think', 'which model', 'what tier', 'are you using the cloud', 'cognition'),
    run: async () => {
      const state = await describeTiers();
      return { say: state };
    },
  },

  // ── Acting on itself ───────────────────────────────────────────────────────
  {
    id: 'self.reload',
    domain: 'self',
    describe: 'reload the interface',
    match: (t) => any(t, 'reload yourself', 'reload the interface', 'refresh the ui', 'reload the ui'),
    run: async () => {
      setTimeout(() => window.location.reload(), 400);
      return { say: 'Reloading the interface.' };
    },
  },
];

// ─── Tier availability ────────────────────────────────────────────────────────
/**
 * Which tiers can actually answer right now? Measured, not assumed — the same
 * rule the genome and the voice ladder follow.
 */
export async function capabilities() {
  const out = {
    reflex: { available: true, skills: SKILLS.length },
    local:  { available: false, reason: 'no local model detected' },
    cloud:  { available: false, reason: 'no provider key in the vault' },
    highest: TIERS.REFLEX,
  };

  const api = ipc();
  if (!api?.models) return out;

  try {
    // `models:check-credentials` returns { [modelId]: 'available' | 'not-installed' | 'missing-key' }
    // where 'available' for an ollama id means the model was actually detected on :11434, not
    // merely that it needs no key — see credentialStatus() in modelRouter.cjs (Section 88).
    const res = await api.models.checkCredentials();
    const status = res?.ok ? res.data : null;
    if (status) {
      const entries = Object.entries(status);
      const localUp = entries.some(([id, s]) => id.startsWith('ollama/') && s === 'available');
      const cloudUp = entries.some(([id, s]) => !id.startsWith('ollama/') && s === 'available');

      if (localUp) { out.local = { available: true }; out.highest = TIERS.LOCAL; }
      if (cloudUp) { out.cloud = { available: true }; out.highest = TIERS.CLOUD; }
    }
  } catch { /* leave the honest defaults */ }

  return out;
}

async function describeTiers() {
  const c = await capabilities();
  const parts = [
    `Tier 0 reflex: ${c.reflex.skills} skills, always available, no model.`,
    `Tier 1 local: ${c.local.available ? 'available' : `unavailable — ${c.local.reason}`}.`,
    `Tier 2 cloud: ${c.cloud.available ? 'available' : `unavailable — ${c.cloud.reason}`}.`,
  ];
  return `${parts.join(' ')} I try them in that order, so the cheap and private path wins whenever it can.`;
}

// ─── Resolution ───────────────────────────────────────────────────────────────
/**
 * Try tier 0 only. Returns null when no reflex matches, which is the signal to
 * escalate. Never throws: a failing skill reports rather than breaking the turn.
 *
 * @param {string} text
 * @param {object} ctx { user }
 */
export async function resolveReflex(text, ctx = {}) {
  const t = norm(text);
  if (!t) return null;

  const skill = SKILLS.find(s => {
    try { return s.match(t); } catch { return false; }
  });
  if (!skill) return null;

  try {
    const result = await skill.run(ctx, t);
    record({ action: 'cognition', ok: true, tool: `reflex:${skill.id}` });
    return { tier: TIERS.REFLEX, tierName: 'REFLEX', skill: skill.id, ...result };
  } catch (err) {
    record({ action: 'cognition', ok: false, tool: `reflex:${skill.id}`, error: err.message });
    return {
      tier: TIERS.REFLEX, tierName: 'REFLEX', skill: skill.id,
      say: `I know how to do that but it failed: ${err.message}`,
    };
  }
}

/**
 * Full ladder. Tier 0, then a model with a preference for local.
 * `sendToModel` is injected so this module never depends on a transport.
 *
 * @param {string} text
 * @param {object} opts { user, sendToModel(preferLocal) }
 */
export async function think(text, opts = {}) {
  const reflex = await resolveReflex(text, opts);
  if (reflex) return reflex;

  if (typeof opts.sendToModel !== 'function') {
    return {
      tier: TIERS.REFLEX, tierName: 'REFLEX', escalated: false,
      say: 'That needs a model, and none is wired into this view.',
    };
  }

  const caps = await capabilities();

  // Local before cloud: private and free before metered.
  const preferLocal = caps.local.available;
  const started = Date.now();
  const res = await opts.sendToModel({ preferLocal });

  const tier = preferLocal ? TIERS.LOCAL : TIERS.CLOUD;
  record({
    action: 'cognition',
    ok: !!res?.ok,
    ms: Date.now() - started,
    tool: `${TIER_NAMES[tier].toLowerCase()}:${res?.model ?? 'unknown'}`,
    error: res?.ok ? null : res?.error,
  });

  return { tier, tierName: TIER_NAMES[tier], escalated: true, ...res };
}

/** Record to the experiential dataset. Tier 3 reads this. Never throws. */
function record(entry) {
  try { ipc()?.meta?.record(entry); } catch { /* meta is optional */ }
}

// ─── Tier 3: competence flowing downward ──────────────────────────────────────
/**
 * Look for phrasings that keep reaching a model when a reflex could serve them.
 * Evidence comes from the experiential dataset, not from guessing.
 *
 * This reports candidates; it does not add skills. Adding one edits Rāma's own
 * source, which must go through the proposal ledger and the master's approval
 * (invariant I6).
 */
export async function findReflexCandidates(user = null) {
  const api = ipc();
  if (!api?.meta) return { ok: false, error: 'Experiential dataset unavailable' };

  // The experiential dataset is `mind.view`, master-only (Section 89). Reading it without a session
  // is refused, so the caller must pass one rather than getting a silent empty result.
  const res = await api.meta.outcomes({ action: 'cognition', limit: 500, user });
  if (!res?.ok) return { ok: false, error: res?.error ?? 'No history' };

  const escalated = res.data.filter(o => o.tool && !o.tool.startsWith('reflex:'));
  const byTool = {};
  for (const o of escalated) byTool[o.tool] = (byTool[o.tool] ?? 0) + 1;

  return {
    ok: true,
    data: {
      totalRecorded: res.data.length,
      reflexServed:  res.data.length - escalated.length,
      escalated:     escalated.length,
      reflexRate:    res.data.length ? Math.round(((res.data.length - escalated.length) / res.data.length) * 100) : 0,
      byTool,
      note: escalated.length < 20
        ? 'Not enough escalations yet to justify a new reflex.'
        : 'Enough escalation history to look for a missing reflex.',
    },
  };
}

export function skillSummary() {
  const byDomain = {};
  for (const s of SKILLS) (byDomain[s.domain] ??= []).push(s.describe);
  return byDomain;
}
