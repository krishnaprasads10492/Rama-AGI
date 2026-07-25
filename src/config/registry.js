/**
 * registry.js — SINGLE SOURCE OF TRUTH for all pages, routes, nav, voice, access.
 *
 * CONSOLIDATES (previously duplicated in 5 places):
 *   - App.jsx                       route table
 *   - Sidebar.jsx                   NAV_ITEMS
 *   - CommandPalette.jsx            ALL_PAGES
 *   - accessControl.getVisibleRoutes route/tier map
 *   - voiceEngine.VOICE_ROUTES      voice command patterns
 *
 * Add a page ONCE here and it appears in: router, command palette, voice
 * commands, access control, and Rāma's own self-knowledge of its capabilities.
 */

import React from 'react';
import { TIERS } from '@services/accessControl.js';

/**
 * @typedef  {Object} PageDef
 * @property {string}   route      URL path
 * @property {string}   id         stable identifier
 * @property {string}   label      display name
 * @property {string}   icon       single glyph
 * @property {string}   desc       one-line description
 * @property {string}   color      CSS var
 * @property {number}   minTier    minimum access tier (lower = more privileged)
 * @property {string[]} keys       search keywords for the palette
 * @property {string[]} voice      voice command phrases
 * @property {string}   component  lazy import path
 * @property {string[]} capabilities  what Rāma can do on this page
 */

/** @type {PageDef[]} */
export const PAGES = [
  {
    route: '/', id: 'chat', label: 'Chat', icon: '◈',
    desc: 'AGI conversation — full capability', color: 'var(--violet)',
    minTier: TIERS.GUEST,
    keys: ['chat', 'conversation', 'talk', 'message', 'ask'],
    voice: ['open chat', 'new chat', 'go to chat', 'open conversation'],
    component: '@pages/Chat/Chat.jsx',
    capabilities: ['conversation', 'reasoning', 'research', 'code-gen'],
  },
  {
    route: '/home', id: 'home', label: 'Home', icon: '⬡',
    desc: 'Dashboard & system overview', color: 'var(--accent)',
    minTier: TIERS.VIEWER,
    keys: ['home', 'dashboard', 'overview', 'start'],
    voice: ['open home', 'go home', 'dashboard'],
    component: '@pages/Home/Home.jsx',
    capabilities: ['overview', 'quick-nav'],
  },
  {
    route: '/system', id: 'system', label: 'System', icon: '⬢',
    desc: 'OS metrics, process manager, cleaner', color: 'var(--green)',
    minTier: TIERS.OPERATOR,
    keys: ['system', 'monitor', 'cpu', 'ram', 'disk', 'process', 'clean', 'temp'],
    voice: ['open system', 'system stats', 'system monitor', 'open monitor'],
    component: '@pages/System/System.jsx',
    capabilities: ['os-metrics', 'process-kill', 'temp-clean', 'disk-analysis'],
  },
  {
    route: '/terminal', id: 'terminal', label: 'Terminal', icon: '>_',
    desc: 'Real embedded PTY shell', color: 'var(--green)',
    minTier: TIERS.SUPERADMIN,
    keys: ['terminal', 'shell', 'bash', 'cmd', 'powershell', 'console'],
    voice: ['open terminal', 'open shell', 'terminal'],
    component: '@pages/Terminal/Terminal.jsx',
    capabilities: ['shell-exec', 'pty'],
  },
  {
    route: '/git', id: 'git', label: 'Git Sync', icon: '⎇',
    desc: 'Repository sync & version control', color: 'var(--gold)',
    minTier: TIERS.OPERATOR,
    keys: ['git', 'sync', 'commit', 'push', 'pull', 'repo', 'branch', 'diff'],
    voice: ['open git', 'git sync', 'open sync'],
    component: '@pages/GitSync/GitSync.jsx',
    capabilities: ['git-ops', 'version-control', 'multi-machine-sync'],
  },
  {
    route: '/agents', id: 'agents', label: 'Agents', icon: '◎',
    desc: 'Multi-agent orchestration & control', color: 'var(--violet)',
    minTier: TIERS.OPERATOR,
    keys: ['agent', 'agents', 'spawn', 'orchestrate', 'parallel', 'worker'],
    voice: ['open agents', 'show agents', 'agent control'],
    component: '@pages/Agents/Agents.jsx',
    capabilities: ['agent-spawn', 'parallel-execution', 'delegation'],
  },
  {
    route: '/models', id: 'models', label: 'Models', icon: '⋯',
    desc: 'AI model router & API keys', color: 'var(--accent)',
    minTier: TIERS.SUPERADMIN,
    keys: ['model', 'models', 'openai', 'claude', 'gemini', 'ollama', 'api', 'key', 'provider'],
    voice: ['open models', 'show models', 'model router'],
    component: '@pages/Models/Models.jsx',
    capabilities: ['model-routing', 'credential-mgmt', 'local-models'],
  },
  {
    route: '/intel', id: 'intel', label: 'Intelligence', icon: '◬',
    desc: 'Universal prediction — multi-source truth', color: 'var(--green)',
    minTier: TIERS.OPERATOR,
    keys: ['intel', 'intelligence', 'predict', 'analysis', 'research', 'truth', 'source', 'forecast'],
    voice: ['open intelligence', 'intelligence engine', 'analyze', 'predict'],
    component: '@pages/Intelligence/Intelligence.jsx',
    capabilities: ['multi-source-research', 'source-vetting', 'truth-extraction', 'calibrated-prediction'],
  },
  {
    route: '/ide', id: 'ide', label: 'Rāma IDE', icon: '⬢',
    desc: 'AGI code editor — Monaco + AI + research', color: 'var(--violet)',
    minTier: TIERS.OPERATOR,
    keys: ['ide', 'editor', 'code', 'coding', 'develop', 'build', 'create', 'scaffold', 'monaco'],
    voice: ['open ide', 'code editor', 'open editor', 'rama ide'],
    component: '@pages/IDE/IDE.jsx',
    capabilities: ['code-edit', 'ast-analysis', 'ai-pair-programming', 'sandbox-exec', 'online-research'],
  },
  {
    route: '/evolution', id: 'evolution', label: 'Evolution', icon: '⚡',
    desc: 'Self-evolve from public repos', color: 'var(--violet)',
    minTier: TIERS.MASTER,
    keys: ['evolve', 'evolution', 'improve', 'upgrade', 'github', 'self', 'learn', 'scout'],
    voice: ['open evolution', 'self improve', 'evolve'],
    component: '@pages/Evolution/Evolution.jsx',
    capabilities: ['self-evolution', 'repo-scouting', 'license-vetting', 'capability-gap-analysis'],
  },
  {
    route: '/resources', id: 'resources', label: 'Resources', icon: '⬢',
    desc: 'Dynamic resource orchestration', color: 'var(--green)',
    minTier: TIERS.OPERATOR,
    keys: ['resources', 'orchestrator', 'cpu', 'ram', 'workers', 'tasks', 'schedule', 'priority', 'queue'],
    voice: ['open resources', 'resource monitor', 'show workers'],
    component: '@pages/Resources/Resources.jsx',
    capabilities: ['task-scheduling', 'resource-governance', 'rate-limit-mgmt'],
  },
  {
    route: '/mind', id: 'mind', label: 'Rāma Mind', icon: '⊕',
    desc: '10 capability axes · AGI dashboard', color: 'var(--violet)',
    minTier: TIERS.MASTER,
    keys: ['mind', 'agi', 'capabilities', 'consciousness', 'memory', 'self', 'axes', 'genome'],
    voice: ['open mind', 'rama mind', 'show capabilities'],
    component: '@pages/RamaMind/RamaMind.jsx',
    capabilities: ['self-awareness', 'capability-tracking', 'memory-inspection', 'world-model'],
  },
  {
    route: '/genome', id: 'genome', label: 'Genome', icon: '⟠',
    desc: 'Capability genome · instance lattice', color: 'var(--violet)',
    minTier: TIERS.MASTER,
    keys: ['genome', 'gene', 'instance', 'instances', 'holonic', 'role', 'express', 'failover', 'dna'],
    voice: ['open genome', 'show genome', 'show instances', 'instance lattice'],
    component: '@pages/Genome/Genome.jsx',
    capabilities: ['genome-inspection', 'instance-lifecycle', 'gene-expression', 'failover-analysis'],
  },
  {
    route: '/introspect', id: 'introspect', label: 'Introspect', icon: '◍',
    desc: 'Self-audit · experience · timeline', color: 'var(--gold)',
    minTier: TIERS.MASTER,
    keys: ['introspect', 'audit', 'meta', 'regression', 'timeline', 'flashback', 'experience', 'learned', 'performance'],
    voice: ['open introspection', 'self audit', 'show timeline', 'run audit'],
    component: '@pages/Introspect/Introspect.jsx',
    capabilities: ['self-audit', 'experiential-learning', 'regression-detection', 'timeline-replay'],
  },
  {
    route: '/stockmind', id: 'stockmind', label: 'StockMind', icon: '◬',
    desc: 'Stock market AI — 10 algorithms', color: 'var(--magenta)',
    minTier: TIERS.VIEWER,
    keys: ['stock', 'market', 'trading', 'finance', 'stockmind', 'nifty', 'crypto'],
    voice: ['open stockmind', 'stock mind', 'stock market'],
    component: '@pages/StockMind/StockMind.jsx',
    capabilities: ['market-analysis', 'signal-generation'],
  },
  {
    route: '/knowledge', id: 'knowledge', label: 'Knowledge', icon: '◉',
    desc: 'Rāma persistent memory store', color: 'var(--accent)',
    minTier: TIERS.VIEWER,
    keys: ['knowledge', 'memory', 'notes', 'docs', 'facts', 'learn'],
    voice: ['open knowledge', 'knowledge base'],
    component: '@pages/Knowledge/Knowledge.jsx',
    capabilities: ['knowledge-storage', 'semantic-search', 'memory-recall'],
  },
  {
    route: '/users', id: 'users', label: 'Users', icon: '◫',
    desc: 'User management & access control', color: 'var(--gold)',
    minTier: TIERS.ADMIN,
    keys: ['users', 'user', 'access', 'permissions', 'accounts', 'manage', 'tier'],
    voice: ['open users', 'user management', 'manage users'],
    component: '@pages/Users/Users.jsx',
    capabilities: ['user-crud', 'access-control', 'tier-mgmt'],
  },
  {
    route: '/settings', id: 'settings', label: 'Settings', icon: '⚙',
    desc: 'App config, AI providers, security', color: 'var(--muted)',
    minTier: TIERS.ADMIN,
    keys: ['settings', 'config', 'preferences', 'ai', 'provider', 'passcode', 'autostart', 'vault'],
    voice: ['open settings', 'settings', 'preferences'],
    component: '@pages/Settings/Settings.jsx',
    capabilities: ['configuration', 'passcode-change', 'auto-start'],
  },
];

// ─── Derived views (all computed from PAGES — never hand-maintained) ─────────

/** Pages visible to a given user tier. */
export function visiblePages(user) {
  const tier = user?.tier ?? TIERS.GUEST;
  return PAGES.filter(p => tier <= p.minTier);
}

/** Routes visible to a tier — replaces accessControl.getVisibleRoutes. */
export function visibleRoutes(user) {
  return visiblePages(user).map(p => p.route);
}

/** Does a page match a search query? Shared matcher — used by palette + voice. */
export function pageMatches(page, query) {
  const q = String(query).toLowerCase().trim();
  if (!q) return false;
  return page.label.toLowerCase().includes(q)
      || page.desc.toLowerCase().includes(q)
      || page.keys.some(k => k.includes(q));
}

/** Command palette search over an explicit page list (defaults to tier-visible). */
export function searchPages(query, userOrPages) {
  const list = Array.isArray(userOrPages) ? userOrPages : visiblePages(userOrPages);
  if (!String(query).trim()) return [];
  return list.filter(p => pageMatches(p, query));
}

/** Voice command → route resolution. Replaces voiceEngine.VOICE_ROUTES. */
export function matchVoiceToRoute(transcript) {
  const t = transcript.toLowerCase().trim();
  for (const page of PAGES) {
    if (page.voice.some(phrase => t.includes(phrase))) {
      return { route: page.route, page };
    }
  }
  return null;
}

/** Find a page by route. */
export function pageByRoute(route) {
  return PAGES.find(p => p.route === route) ?? null;
}

/** All capabilities across all pages — Rāma's self-knowledge of what it can do. */
export function allCapabilities() {
  return [...new Set(PAGES.flatMap(p => p.capabilities))].sort();
}

/** Capabilities available to a specific tier. */
export function capabilitiesForTier(user) {
  return [...new Set(visiblePages(user).flatMap(p => p.capabilities))].sort();
}

// ─── Lazy component loaders ──────────────────────────────────────────────────
// Kept as static import() expressions so Vite/Rollup can code-split them.
// The `component` field on each PageDef is the human/AGI-readable mirror of
// this map — selfModify.js reads it when generating a new page.
const LOADERS = {
  chat:        () => import('@pages/Chat/Chat.jsx'),
  home:        () => import('@pages/Home/Home.jsx'),
  system:      () => import('@pages/System/System.jsx'),
  terminal:    () => import('@pages/Terminal/Terminal.jsx'),
  git:         () => import('@pages/GitSync/GitSync.jsx'),
  agents:      () => import('@pages/Agents/Agents.jsx'),
  models:      () => import('@pages/Models/Models.jsx'),
  intel:       () => import('@pages/Intelligence/Intelligence.jsx'),
  ide:         () => import('@pages/IDE/IDE.jsx'),
  evolution:   () => import('@pages/Evolution/Evolution.jsx'),
  resources:   () => import('@pages/Resources/Resources.jsx'),
  mind:        () => import('@pages/RamaMind/RamaMind.jsx'),
  genome:      () => import('@pages/Genome/Genome.jsx'),
  introspect:  () => import('@pages/Introspect/Introspect.jsx'),
  stockmind:   () => import('@pages/StockMind/StockMind.jsx'),
  knowledge:   () => import('@pages/Knowledge/Knowledge.jsx'),
  users:       () => import('@pages/Users/Users.jsx'),
  settings:    () => import('@pages/Settings/Settings.jsx'),
};

const LAZY_CACHE = new Map();

/**
 * React.lazy component for a page id. Memoised so React does not remount
 * on every render of the router.
 * @returns {React.LazyExoticComponent|null}
 */
export function lazyFor(id) {
  if (LAZY_CACHE.has(id)) return LAZY_CACHE.get(id);
  const loader = LOADERS[id];
  if (!loader) return null;
  const component = React.lazy(loader);
  LAZY_CACHE.set(id, component);
  return component;
}

/** Every page that has a real loader — what the router should mount. */
export function routablePages() {
  return PAGES.filter(p => LOADERS[p.id]);
}

/** Registry integrity check — surfaces a page defined without a loader. */
export function registryIssues() {
  const issues = [];
  const seen = new Set();
  for (const p of PAGES) {
    if (!LOADERS[p.id]) issues.push(`page "${p.id}" has no loader`);
    if (seen.has(p.route)) issues.push(`duplicate route "${p.route}"`);
    seen.add(p.route);
  }
  return issues;
}
