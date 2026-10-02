'use strict';

/**
 * ollamaCloud.cjs — Rāma on Ollama's KEYED CLOUD API, beside the local daemon.
 *
 * ── TWO AUTH MECHANISMS, KEPT APART BY CONSTRUCTION ──────────────────────────────────────────────
 *
 *   (a) `ollama signin` — the local daemon holds the credential and Rāma holds none; Rāma keeps
 *       talking to http://localhost:11434, which needs no auth at all. That path is NOT changed,
 *       NOT deprecated and NOT made conditional on anything (I11).
 *   (b) an API key — Rāma holds the credential and calls https://ollama.com/api with
 *       `Authorization: Bearer`. This module, and only this module.
 *
 * Conflating them is the principal hazard: a design that blurs the two ends up sending master's
 * Bearer token to a daemon, or expecting a daemon-authenticated call to work with no daemon. They
 * are separated by a distinct module, a distinct provider (`ollama-cloud`), a distinct id namespace
 * (`ollama-cloud/<api-name>` versus `ollama/<daemon-tag>`) and a distinct rate-limit row.
 *
 * ── THE CREDENTIAL IS NEVER SPOKEN ───────────────────────────────────────────────────────────────
 *
 * No return value, no log line and no error message carries the key, any part of it, its length or
 * a hash of it. Every diagnostic reports exactly two states: PRESENT or ABSENT. `credentialState()`
 * and `status()` have FROZEN key sets, asserted literally, so a `prefix` or `length` field cannot be
 * added without the suite going red. `authHeader()` is module-private and is built at the request
 * site so the value has the shortest possible lifetime; it is never assigned to a module-level
 * variable, never cached, and never placed in anything returned.
 *
 * THE VAULT IS THE ONLY STORE. There is no environment-variable source and no `.env` source, and
 * the reason is the opposite of the obvious one: `start.cjs`'s `loadEnv()` (L151) DOES parse `.env`
 * into `process.env` and DOES copy `.env.example` to `.env` when `.env` is absent, and `start.cjs`
 * spawns every child with `env: { ...process.env }`. So a key in `.env` would sit in plaintext on
 * disk AND be inherited by the Vite, server and sandbox children. Rāma reads no credential from
 * `process.env` at all, and that is asserted rather than promised.
 *
 * ── THE HTTP BINDING IS NAMED `http`, DELIBERATELY ───────────────────────────────────────────────
 *
 * `net` is the alias modelRouter.cjs and browserEngine.cjs use for electron/lib/http.cjs, but `net`
 * is ALSO Electron's own HTTP module, whose `net.request` would be a real I9 breach with no circuit
 * breaker, no 429 backoff and no response cap. In a NEW file the name is `http` so the mistake has
 * no foothold.
 *
 * Verified by: scripts/verifyOllamaCloud.cjs.
 */

const egressBoundary = require('./egressBoundary.cjs');
const ollamaCatalog  = require('./ollamaCatalog.cjs');

/** The vault service name. It matches Ollama's own environment-variable convention, which is what
 *  master will recognise — but it is a VAULT SERVICE NAME, not an environment variable Rāma reads. */
const CRED_SERVICE = 'OLLAMA_API_KEY';

const DEFAULT_BASE_URL = 'https://ollama.com';
const ALLOWED_HOSTS    = Object.freeze(['ollama.com', 'api.ollama.com']);
const MAX_BASE_URL_LEN = 200;

const PROVIDER        = 'ollama-cloud';
const SEARCH_PROVIDER = 'ollama-search';
const ID_PREFIX       = 'ollama-cloud/';

const CHAT_PATH = '/api/chat';
const TAGS_PATH = '/api/tags';
/**
 * PROVISIONAL. The hosted-search endpoint path is NOT VERIFIED — the network is unreachable from
 * this workspace and Ollama's live documentation was never loaded. See
 * docs/research/ollama-cloud-build.md, NOT VERIFIED item 3. Correcting this literal is the whole
 * change when the real path is read; the gate above it does not depend on it.
 */
const SEARCH_PATH = '/api/web_search';

const CLOUD_CAP   = 'models.use-cloud';
const FALLBACK_CAP = 'models.use';

const REMEDY = 'Models → Cloud → Ollama Cloud → Add key (unlock the vault first)';

const CRED_REJECT_SUPPRESS_MS = 10 * 60 * 1000;

// ─── The naming table ─────────────────────────────────────────────────────────
/**
 * Two naming schemes exist for the same weights, and both failure directions are bad:
 *
 *   `gemma4:31b-cloud` sent to the KEYED API  → model-not-found; opaque, looks like an outage.
 *   `gemma4:31b`       sent to the DAEMON     → WORSE. That is also a plausible local pull tag, so
 *                                               on a machine with a daemon it can resolve locally
 *                                               or trigger a multi-gigabyte download. A request
 *                                               master believes went to the cloud runs here instead.
 *
 * THE TABLE IS AUTHORITATIVE IN BOTH DIRECTIONS. `apiNameFor` and `daemonTagFor` return null for
 * anything not in it — never a derived guess, because the reverse direction is where a guess becomes
 * a local 480B download. A derivation rule does exist and is used in exactly one place, a test,
 * asserting that every row satisfies it.
 *
 * PROVENANCE DIFFERS BY COLUMN, and that has to be said:
 *   `daemonTag` is ATTESTED  — docs/research/OLLAMA_ONLY.md §D.3–§D.5 probed a real free account.
 *   `apiModel`  is INFERRED  — by the strip-the-suffix rule, for every row except `gemma4:31b`,
 *                              the only cloud-list name this project has on record.
 */
const CLOUD_TAGS = Object.freeze({
  'gemma4:31b':            Object.freeze({ daemonTag: 'gemma4:31b-cloud',            paramsB: 31,   caps: Object.freeze(['analysis']),         usage: 'low' }),
  'gemma4':                Object.freeze({ daemonTag: 'gemma4:cloud',                paramsB: null, caps: Object.freeze([]),                   usage: 'low' }),
  'gpt-oss:120b':          Object.freeze({ daemonTag: 'gpt-oss:120b-cloud',          paramsB: 120,  caps: Object.freeze(['analysis', 'code']), usage: 'medium' }),
  'gpt-oss:20b':           Object.freeze({ daemonTag: 'gpt-oss:20b-cloud',           paramsB: 20,   caps: Object.freeze(['code']),             usage: 'low' }),
  'ministral-3:14b':       Object.freeze({ daemonTag: 'ministral-3:14b-cloud',       paramsB: 14,   caps: Object.freeze(['analysis']),         usage: 'low' }),
  'ministral-3:8b':        Object.freeze({ daemonTag: 'ministral-3:8b-cloud',        paramsB: 8,    caps: Object.freeze([]),                   usage: 'low' }),
  'ministral-3:3b':        Object.freeze({ daemonTag: 'ministral-3:3b-cloud',        paramsB: 3,    caps: Object.freeze(['fast']),             usage: 'low' }),
  'nemotron-3-nano:30b':   Object.freeze({ daemonTag: 'nemotron-3-nano:30b-cloud',   paramsB: 30,   caps: Object.freeze(['analysis']),         usage: 'low' }),
  'qwen3-coder:480b':      Object.freeze({ daemonTag: 'qwen3-coder:480b-cloud',      paramsB: 480,  caps: Object.freeze(['code']),             usage: 'high' }),
  'qwen3-vl:235b':         Object.freeze({ daemonTag: 'qwen3-vl:235b-cloud',         paramsB: 235,  caps: Object.freeze(['vision']),           usage: 'high' }),
  'qwen3-next:80b':        Object.freeze({ daemonTag: 'qwen3-next:80b-cloud',        paramsB: 80,   caps: Object.freeze(['analysis']),         usage: 'medium' }),
  'devstral-2:123b':       Object.freeze({ daemonTag: 'devstral-2:123b-cloud',       paramsB: 123,  caps: Object.freeze(['code']),             usage: 'high' }),
  'devstral-small-2:24b':  Object.freeze({ daemonTag: 'devstral-small-2:24b-cloud',  paramsB: 24,   caps: Object.freeze(['code']),             usage: 'low' }),
  'nemotron-3-super':      Object.freeze({ daemonTag: 'nemotron-3-super:cloud',      paramsB: null, caps: Object.freeze(['analysis']),         usage: 'medium' }),
});

const DAEMON_TO_API = Object.freeze(Object.fromEntries(
  Object.entries(CLOUD_TAGS).map(([api, row]) => [row.daemonTag, api])
));

/** Is this an Ollama CLOUD-LIST name the keyed API accepts? The positive counterpart of
 *  `isDaemonCloudTag`; the two predicates PARTITION the names rather than overlapping. */
const isApiName = (s) => Object.prototype.hasOwnProperty.call(CLOUD_TAGS, String(s));

/** Is this a DAEMON tag? Those must never reach the keyed API — see the table's comment. */
const isDaemonCloudTag = (s) => /[-:]cloud$/.test(String(s));

function apiNameFor(daemonTag) {
  const k = String(daemonTag);
  return Object.prototype.hasOwnProperty.call(DAEMON_TO_API, k) ? DAEMON_TO_API[k] : null;
}

function daemonTagFor(apiModel) {
  const k = String(apiModel);
  return Object.prototype.hasOwnProperty.call(CLOUD_TAGS, k) ? CLOUD_TAGS[k].daemonTag : null;
}

// ─── Injection seams ──────────────────────────────────────────────────────────
// Same idiom as ollamaCatalog.useStore: a module-level injected variable plus a lazy require, so a
// test never loads the real vault, store, HTTP client or orchestrator.

let injectedVault = null;
let injectedStore = null;
let injectedHttp  = null;
let injectedOrch  = null;

function useVault(stub) { injectedVault = stub; }
function useStore(stub) { injectedStore = stub; egressBoundary.useStore(stub); }
function useHttp(stub)  { injectedHttp = stub; }

const ORCH_METHODS = Object.freeze(['admit', 'reserveSlot', 'releaseSlot', 'recordApiUse']);

/**
 * A stub that drifts from the real instance is the one way a suite can be GREEN about admission
 * while admission does not happen, so a missing method throws here rather than being discovered in
 * production.
 */
function useOrchestrator(stub) {
  if (!stub || typeof stub !== 'object') throw new Error('useOrchestrator needs an object');
  for (const m of ORCH_METHODS) {
    if (typeof stub[m] !== 'function') {
      throw new Error(`useOrchestrator needs ${ORCH_METHODS.join(', ')} — "${m}" is missing`);
    }
  }
  injectedOrch = stub;
}

function vault() {
  if (injectedVault) return injectedVault;
  return require('../ipc/credentialVault.cjs');
}

function storeOf() {
  if (injectedStore) return injectedStore;
  try { return require('../dataStore.cjs'); }
  catch { return null; }
}

/** NAMED `http`, not `net` — see the header. */
function httpClient() {
  if (injectedHttp) return injectedHttp;
  return require('./http.cjs');
}

function orchestrator() {
  if (injectedOrch) return injectedOrch;
  // The INSTANCE, not the module: the instance is what owns the live counters, and I10's monopoly
  // is on the instance.
  return require('../resourceOrchestrator.cjs').orchestrator;
}

function capabilityLib() {
  return require('./capability.cjs');
}

/**
 * The live admission row, read through the one authority (I10) and never written here.
 * Returns null when the orchestrator cannot be loaded, so `status()` degrades rather than throwing.
 */
function limitRow(provider = PROVIDER) {
  try {
    const { API_RATE_LIMITS } = require('../resourceOrchestrator.cjs');
    return Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, provider)
      ? API_RATE_LIMITS[provider] : null;
  } catch { return null; }
}

// ─── Base URL resolution ──────────────────────────────────────────────────────

let baseUrlWarned = false;
let unconfiguredWarned = false;
let lockedWarned = false;
let credRejectedUntil = 0;

/** The six rules, in order, each one a refusal and not a sanitisation. */
const BASE_URL_RULES = Object.freeze([
  'it must parse as a URL',
  'it must be https — a credential never goes over cleartext',
  'it must carry no username or password',
  'it must carry no query string and no fragment',
  `its host must be in ${ALLOWED_HOSTS.join(', ')}, or exactly equal config.ollamaCloudHostAllow`,
  `it must be at most ${MAX_BASE_URL_LEN} characters`,
]);

function configuredHostAllow() {
  try {
    const s = storeOf();
    const v = s ? s.get('config', 'ollamaCloudHostAllow') : null;
    return (typeof v === 'string' && /^[a-z0-9.-]{1,80}$/.test(v)) ? v : null;
  } catch { return null; }
}

/**
 * Validate a candidate base URL. A configurable base is the most dangerous input in this module: a
 * wrong value means sending master's Bearer token to a host of someone else's choosing. So this is
 * a HARD GATE, not a sanitiser — and widening the host allow-list needs its own separate config
 * key, because a single mistyped base URL must not be able to reach a new host.
 */
function validateBase(candidate) {
  const s = String(candidate ?? '');
  if (!s) return { ok: false, why: BASE_URL_RULES[0] };
  if (s.length > MAX_BASE_URL_LEN) return { ok: false, why: BASE_URL_RULES[5] };

  let u;
  try { u = new URL(s); }
  catch { return { ok: false, why: BASE_URL_RULES[0] }; }

  if (u.protocol !== 'https:') return { ok: false, why: `${BASE_URL_RULES[1]} (${u.protocol})` };
  if (u.username || u.password) return { ok: false, why: BASE_URL_RULES[2] };
  if (u.search || u.hash) return { ok: false, why: BASE_URL_RULES[3] };

  const allowed = ALLOWED_HOSTS.includes(u.hostname) || u.hostname === configuredHostAllow();
  if (!allowed) return { ok: false, why: `${BASE_URL_RULES[4]} (${u.hostname})` };

  return { ok: true, url: `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}` };
}

/**
 * Precedence, first hit wins: dataStore config, then process.env, then the frozen default.
 * A rejected override is fatal for CONFIGURATION, not for the process: the known-good default
 * stands so a bad config cannot brick the feature, and `overrideRejected` keeps it from being
 * silent. The hostname and the rule violated are the only things logged — a hostname is not a
 * secret, and the credential is not in scope here at all.
 */
function resolveBaseUrl() {
  const candidates = [];
  try {
    const s = storeOf();
    const v = s ? s.get('config', 'ollamaCloudBaseUrl') : null;
    if (v) candidates.push(String(v));
  } catch { /* an unreadable store is not an override */ }
  if (process.env.OLLAMA_CLOUD_BASE_URL) candidates.push(String(process.env.OLLAMA_CLOUD_BASE_URL));

  for (const c of candidates) {
    const v = validateBase(c);
    if (v.ok) return { url: v.url, overrideRejected: false, why: null };
    if (!baseUrlWarned) {
      baseUrlWarned = true;
      console.error(`[ollama-cloud] base URL override rejected: ${v.why} — using ${DEFAULT_BASE_URL}`);
    }
    return { url: DEFAULT_BASE_URL, overrideRejected: true, why: v.why };
  }
  return { url: DEFAULT_BASE_URL, overrideRejected: false, why: null };
}

function baseUrl() { return resolveBaseUrl().url; }

// ─── Credential state ─────────────────────────────────────────────────────────

/**
 * The FOUR keys are the whole contract: `present`, `source`, `vaultUnlocked`, `reason`. No length,
 * no prefix, no suffix, no masked rendering, no hash. The suite asserts this key set LITERALLY,
 * because "no prefix" is only enforceable if the shape is pinned.
 *
 * LOCKED is not ABSENT, and that distinction is carried in `reason` plus `vaultUnlocked` — because
 * modelRouter's `credentialStatus()` flattens both to 'missing-key' one layer up, which would
 * otherwise invite master to re-paste a credential he already gave Rāma.
 */
function credentialState() {
  let unlocked = false;
  let stored = null;
  try {
    const v = vault();
    unlocked = v.isUnlocked() === true;
    stored = unlocked ? v.getCredential(CRED_SERVICE) : null;
  } catch { unlocked = false; stored = null; }

  if (stored) return { present: true, source: 'vault', vaultUnlocked: true, reason: null };
  return {
    present: false,
    source: null,
    vaultUnlocked: unlocked,
    reason: unlocked ? 'no Ollama API key is stored' : 'the vault is locked',
  };
}

function isConfigured() { return credentialState().present === true; }

/**
 * MODULE-PRIVATE, never exported, built at the call site. The returned object is handed straight to
 * the HTTP client and is never stored, logged or returned.
 */
function authHeader() {
  return { Authorization: `Bearer ${vault().getCredential(CRED_SERVICE)}` };
}

/** Which capability key is in force. `models.use-cloud` is specified for master in a PROTECTED
 *  file; until he adds it, cloud calls are gated by `models.use` like any other model, and
 *  `status()` says so out loud rather than the feature being dead. */
function cloudCapability() {
  let dedicated = false;
  try {
    dedicated = Object.prototype.hasOwnProperty.call(capabilityLib().MATRIX, CLOUD_CAP);
  } catch { dedicated = false; }
  return { key: dedicated ? CLOUD_CAP : FALLBACK_CAP, dedicated };
}

function monthlyUsage() {
  const row = limitRow();
  if (row) return { usedTokMonth: row.usedTokMonth ?? 0, monthStartedAt: row.monthStartedAt ?? null };
  try {
    const s = storeOf();
    const saved = s ? s.get('config', 'ollamaCloudUsage') : null;
    if (saved && typeof saved === 'object') {
      return { usedTokMonth: Number(saved.usedTokMonth) || 0, monthStartedAt: saved.monthStartedAt ?? null };
    }
  } catch { /* an unreadable store means no recorded usage, which is the honest answer */ }
  return { usedTokMonth: 0, monthStartedAt: null };
}

/**
 * The ONLY structured self-description of this module. NO FIELD IS DERIVED FROM THE CREDENTIAL
 * VALUE: no length, no prefix, no suffix, no mask, no hash. The suite pins this exact key list, so
 * adding such a field fails the suite rather than shipping.
 *
 * `monthlyBudget` is always null and `monthlyBudgetKnown` always false: Ollama meters free usage in
 * credits that reset monthly from master's signup date, Rāma does not know that date and cannot read
 * the remaining balance. `usedTokMonth` is what RĀMA SPENT, as counted here — never what remains. A
 * guessed budget would be an invented number presented as a measurement.
 */
function status() {
  const cred = credentialState();
  const base = resolveBaseUrl();
  const row = limitRow();
  const usage = monthlyUsage();
  return Object.freeze({
    present: cred.present,
    source: cred.source,
    vaultUnlocked: cred.vaultUnlocked,
    reason: cred.reason,
    remedy: cred.present ? null : REMEDY,
    baseUrl: base.url,
    baseUrlOverrideRejected: base.overrideRejected,
    baseUrlOverrideWhy: base.why,
    cloudCapability: cloudCapability(),
    monthlyBudget: null,
    monthlyBudgetKnown: false,
    usedTokMonth: usage.usedTokMonth,
    monthStartedAt: usage.monthStartedAt,
    inFlight: row ? (row.inFlight ?? null) : null,
    maxConcurrent: row ? (row.maxConcurrent ?? null) : null,
  });
}

// ─── Registry rows ────────────────────────────────────────────────────────────

/**
 * The rows merged into `MODEL_REGISTRY`, built from `CLOUD_TAGS` rather than typed twice.
 *
 * `id` IS ON THE ROW, not only as the object key. In MODEL_REGISTRY the id IS the key, but
 * `modelRoles.evaluate` refuses anything without `model.id` BEFORE it reaches the privacy gate
 * (modelRoles.cjs: `{ fit:'none', reasons:['no model supplied'] }`). Without this field the
 * `narration` refusal would pass for the WRONG reason and prove nothing, and its inverse would
 * fail — so the one defence this design weights highest would ship green and empty.
 *
 * `private: false` is EXPLICIT. `model.private !== true` already refuses `undefined`, but relying on
 * `undefined` is relying on an accident.
 *
 * `ctxK: null` is deliberate: the keyed API exposes no measured context window, and a null makes
 * `modelRoles.evaluate` EXCLUDE these rows from `long-context` with the reason "no context length
 * known" — the correct outcome, and strictly better than a number read from a marketing page.
 */
function toRegistryEntries() {
  const out = {};
  for (const [apiModel, row] of Object.entries(CLOUD_TAGS)) {
    const id = ID_PREFIX + apiModel;
    out[id] = {
      id,
      provider: PROVIDER,
      credKey: CRED_SERVICE,
      type: 'cloud',            // what puts the row in the Models CLOUD tab with an Add-key button
      private: false,           // a cloud model is NOT private — `narration` must refuse it
      ctxK: null,
      ctxVerified: false,
      costTier: 1,              // a free allowance is a budget even with no invoice
      caps: ['general', 'remote', ...row.caps],
      // From the REAL function that judges it, never copied from the table, so the registry can
      // never disagree with `ollamaCatalog.paramsB`.
      paramsB: ollamaCatalog.paramsB(apiModel),
      apiModel,
      daemonTag: row.daemonTag,
      usage: row.usage,
    };
  }
  return out;
}

// ─── The gate that decides whether a cloud call may be made at all ────────────

/**
 * Three cases, kept distinct because conflating them is how a gate becomes decorative.
 *
 *   `user === undefined` — the argument was never threaded. A PROGRAMMING ERROR, not a permissions
 *                          outcome. A missing wire-up must never read as "master lacks permission",
 *                          because that sends the next session looking in shared/capabilities.json
 *                          for a bug that is in a call site.
 *   `user === null`      — an unauthenticated caller. A genuine denial.
 *   a user object        — gated on `models.use-cloud` when the matrix has it, `models.use` otherwise.
 *
 * ZERO HTTP CALLS in the first two cases.
 */
function gateUser(user) {
  if (user === undefined) {
    console.error('[ollama-cloud] no user supplied to a gated cloud call');
    return { ok: false, gateError: true, reason: 'no user supplied to a gated cloud call' };
  }
  const cap = cloudCapability().key;
  const denied = capabilityLib().deny(user, cap);
  if (denied) return { ...denied, denied: true };
  return null;
}

function unconfiguredShape(cred) {
  return {
    ok: false,
    unconfigured: true,
    present: false,
    path: 'cloud',
    reason: cred.reason,
    remedy: REMEDY,
    vaultUnlocked: cred.vaultUnlocked,
  };
}

function noteUnconfigured(cred) {
  if (cred.vaultUnlocked) {
    if (!unconfiguredWarned) {
      unconfiguredWarned = true;
      console.warn('[ollama-cloud] no Ollama API key is stored — cloud models are UNCONFIGURED, not broken');
    }
  } else if (!lockedWarned) {
    lockedWarned = true;
    console.warn('[ollama-cloud] the vault is locked — the stored Ollama key cannot be read until it is unlocked');
  }
}

function clampTimeout(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return 120000;
  return Math.min(300000, Math.max(1000, Math.round(v)));
}

function clampPriority(p, fallback) {
  const v = Number(p);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(4, Math.max(0, Math.round(v)));
}

const NAME_RE = /^[a-z0-9._-]+(:[a-z0-9._-]+)?$/i;

/**
 * Classify an HTTP result from the one client into this module's named failure shapes.
 * `lib/http.cjs` never throws for an HTTP status, so every row here is a branch on a return value.
 */
function classifyFailure(res, apiModel) {
  const status = res?.status ?? 0;
  const raw = typeof res?.body === 'string' ? String(res.body) : '';

  if (status === 401 || status === 403) {
    credRejectedUntil = Date.now() + CRED_REJECT_SUPPRESS_MS;
    console.error('[ollama-cloud] Ollama rejected the credential — replace the key in Models → Cloud');
    return { ok: false, credentialRejected: true, status, path: 'cloud',
             reason: 'Ollama rejected the credential' };
  }
  if (status === 402 || /subscription|upgrade|not available on your plan/i.test(raw)) {
    console.warn(`[ollama-cloud] ${apiModel} is not on this plan`);
    return { ok: false, planError: true, status, path: 'cloud', apiModel,
             reason: `${apiModel} is not on this plan` };
  }
  if (status === 404) {
    const hint = daemonTagFor(apiModel)
      ? 'that is the daemon tag'
      : 'not in CLOUD_TAGS — refresh with models:cloud-list';
    console.warn(`[ollama-cloud] ${apiModel} unknown to the keyed API — ${hint}`);
    return { ok: false, modelError: true, status, path: 'cloud', apiModel, hint,
             reason: `${apiModel} is unknown to the keyed API` };
  }
  if (status === 429) {
    return { ok: false, retryable: true, status, path: 'cloud',
             reason: 'Ollama Cloud is rate-limiting; the client already backed off twice' };
  }
  if (status === 503 && /Circuit open/i.test(String(res?.error ?? ''))) {
    return { ok: false, retryable: true, status, path: 'cloud',
             reason: 'Ollama Cloud is circuit-broken for 20s after repeated failures' };
  }
  if (status >= 500) {
    console.warn(`[ollama-cloud] HTTP ${status} from the keyed API`);
    return { ok: false, retryable: true, status, path: 'cloud', reason: `Ollama Cloud HTTP ${status}` };
  }
  if (status === 0) {
    console.warn('[ollama-cloud] the keyed API is unreachable — the LOCAL daemon path is untouched');
    return { ok: false, offline: true, status: 0, path: 'cloud',
             reason: res?.error || 'Ollama Cloud is unreachable' };
  }
  return { ok: false, status, path: 'cloud', reason: res?.error || `Ollama Cloud HTTP ${status}` };
}

function parseOrShapeError(raw) {
  try { return { ok: true, parsed: JSON.parse(raw) }; }
  catch {
    console.warn('[ollama-cloud] the keyed API returned a non-JSON body');
    return { ok: false, shapeError: true, path: 'cloud',
             reason: 'Ollama Cloud returned a non-JSON body',
             raw: String(raw ?? '').slice(0, 200) };
  }
}

// ─── chat ─────────────────────────────────────────────────────────────────────

/**
 * The request path. Every step is a hard gate, in this order:
 *
 *   0. capability        — `user` has NO default, see gateUser()
 *   1. name pre-flight   — a daemon tag never reaches the keyed API, refused BEFORE any request
 *   2. payload boundary  — egressBoundary.assemble is the ONE body constructor
 *   3. credential        — absent is UNCONFIGURED, never a fallback and never an attempt
 *   4. base URL
 *   5. admission         — orchestrator.admit({ aiProvider }), the one authority (I10)
 *   6. slot              — reserveSlot/releaseSlot, released in a finally, unconditionally
 *   7. send              — http.post, which stringifies INSIDE lib/http.cjs (I9)
 *   8. shape
 *   9. record
 */
async function chat({ messages, apiModel, user, priority, options = null,
                      timeout = 120000, parts = null, allowInternal = false } = {}) {
  const gated = gateUser(user);
  if (gated) return gated;

  const name = String(apiModel ?? '');
  if (!name || name.length > 120 || !NAME_RE.test(name)) {
    console.error(`[ollama-cloud] "${name}" is not a usable model name`);
    return { ok: false, nameError: true, path: 'cloud',
             reason: `"${name}" is not a usable model name for the keyed API` };
  }
  if (isDaemonCloudTag(name)) {
    const api = apiNameFor(name);
    console.error(`[ollama-cloud] ${name} is a daemon tag; the keyed API wants ${api ?? 'a cloud-list name'}`);
    return { ok: false, nameError: true, path: 'cloud',
             reason: `${name} is a daemon tag; the keyed API wants ${api ?? 'a cloud-list name'}` };
  }

  const gate = egressBoundary.assemble({
    kind: 'chat', messages, parts, model: name, stream: false, options, allowInternal,
  });
  if (!gate.ok) {
    console.warn(`[ollama-cloud] payload refused: level=${gate.level} where=${gate.where} index=${gate.index}`);
    return { ok: false, refused: true, path: 'cloud',
             level: gate.level, reason: gate.reason, where: gate.where, index: gate.index };
  }

  const cred = credentialState();
  if (!cred.present) { noteUnconfigured(cred); return unconfiguredShape(cred); }

  if (Date.now() < credRejectedUntil) {
    return { ok: false, credentialRejected: true, suppressed: true, path: 'cloud',
             reason: 'Ollama rejected this credential recently; attempts are suppressed for 10 minutes' };
  }

  const base = resolveBaseUrl();
  const orch = orchestrator();
  const prio = clampPriority(priority, 2);

  const verdict = orch.admit({ aiProvider: PROVIDER, label: 'ollama cloud chat', ramMB: 32, priority: prio });
  if (!verdict.allow) return { ok: false, deferred: true, path: 'cloud', reason: verdict.reason };

  const slot = await orch.reserveSlot(PROVIDER, { priority: prio, waitMs: 20000 });
  if (!slot.ok) {
    if (slot.timedOut) console.warn(`[ollama-cloud] ${slot.reason}`);
    return { ok: false, deferred: true, timedOut: slot.timedOut === true, path: 'cloud', reason: slot.reason };
  }

  try {
    // `gate.body` is used VERBATIM and never amended. `post()` serialises INSIDE lib/http.cjs and
    // spreads these headers over its own Content-Type, so there is no second body constructor and
    // no second HTTP client (I9).
    const res = await httpClient().post(`${base.url}${CHAT_PATH}`, gate.body, {
      headers: authHeader(), timeout: clampTimeout(timeout), retries: 1,
    });

    if (!res?.ok) return classifyFailure(res, name);

    const p = parseOrShapeError(res.body);
    if (!p.ok) return p;
    const parsed = p.parsed;

    if (parsed.error) {
      console.warn('[ollama-cloud] the keyed API reported an error on a 200');
      return { ok: false, path: 'cloud', reason: String(parsed.error).slice(0, 300) };
    }
    if (typeof parsed.message?.content !== 'string') {
      console.warn('[ollama-cloud] the response did not match the /api/chat shape');
      return { ok: false, shapeError: true, path: 'cloud',
               reason: 'response did not match the /api/chat shape (message.content)' };
    }

    const prompt = Number(parsed.prompt_eval_count);
    const evalc = Number(parsed.eval_count);
    const tokens = (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(evalc) ? evalc : 0);
    const usage = (Number.isFinite(prompt) || Number.isFinite(evalc))
      ? { promptTokens: Number.isFinite(prompt) ? prompt : null,
          completionTokens: Number.isFinite(evalc) ? evalc : null,
          totalTokens: tokens }
      : null;
    if (tokens > 0) orch.recordApiUse(PROVIDER, tokens);

    return {
      ok: true,
      content: parsed.message.content,
      usage,
      maxLevel: gate.maxLevel,
      path: 'cloud',
      endpoint: `${base.url}${CHAT_PATH}`,
      apiModel: name,
      via: 'ollama-cloud-keyed',
      credentialSource: 'vault',
    };
  } finally {
    // MANDATORY. A leaked slot on a maxConcurrent:1 row is a permanent outage.
    orch.releaseSlot(PROVIDER);
  }
}

// ─── listModels ───────────────────────────────────────────────────────────────

/**
 * REPORT-ONLY. Unlike `refreshOllamaModels` and `refreshCustomProviders`, which both merge into
 * MODEL_REGISTRY, this NEVER writes the registry, never adds a row and never fills a `daemonTag`
 * the table does not hold. Reconciling an inferred `apiModel` is a SOURCE EDIT to CLOUD_TAGS,
 * reviewed and committed — a runtime-added row would have no attested daemon tag, and
 * `daemonTag: null` where unknown is the honest answer.
 */
async function listModels({ user, timeout = 15000 } = {}) {
  const gated = gateUser(user);
  if (gated) return gated;

  const cred = credentialState();
  if (!cred.present) { noteUnconfigured(cred); return unconfiguredShape(cred); }
  if (Date.now() < credRejectedUntil) {
    return { ok: false, credentialRejected: true, suppressed: true, path: 'cloud',
             reason: 'Ollama rejected this credential recently; attempts are suppressed for 10 minutes' };
  }

  const base = resolveBaseUrl();
  const orch = orchestrator();
  const verdict = orch.admit({ aiProvider: PROVIDER, label: 'ollama cloud catalogue', ramMB: 16, priority: 2 });
  if (!verdict.allow) return { ok: false, deferred: true, path: 'cloud', reason: verdict.reason };

  const slot = await orch.reserveSlot(PROVIDER, { priority: 2, waitMs: 20000 });
  if (!slot.ok) return { ok: false, deferred: true, path: 'cloud', reason: slot.reason };

  try {
    const res = await httpClient().get(`${base.url}${TAGS_PATH}`, {
      headers: authHeader(), timeout: clampTimeout(timeout), retries: 1,
    });
    if (!res?.ok) return classifyFailure(res, '(catalogue)');

    const p = parseOrShapeError(res.body);
    if (!p.ok) return p;
    if (!Array.isArray(p.parsed.models)) {
      return { ok: false, shapeError: true, path: 'cloud',
               reason: 'response did not match the /api/tags shape (models array)' };
    }

    let skipped = 0;
    const models = [];
    for (const row of p.parsed.models) {
      const nm = row?.name ?? row?.model;
      if (typeof nm !== 'string' || !nm) { skipped += 1; continue; }
      models.push({
        apiModel: nm,
        daemonTag: daemonTagFor(nm),       // null where the table does not know it — never a guess
        family: ollamaCatalog.familyOf(nm),
        paramsB: ollamaCatalog.paramsB(nm),
        sized: ollamaCatalog.paramsB(nm) !== null,
        inTable: isApiName(nm),
      });
    }
    return { ok: true, models, skipped, path: 'cloud', endpoint: `${base.url}${TAGS_PATH}`,
             via: 'ollama-cloud-keyed', credentialSource: 'vault' };
  } finally {
    orch.releaseSlot(PROVIDER);
  }
}

// ─── webSearch ────────────────────────────────────────────────────────────────

/**
 * Hosted web search, behind the SAME credential and its OWN admission row.
 *
 * The query must be CLASSIFIED — there is no bare-string allowance, because a search query is the
 * single most likely route for master's private context to leave the machine and search has no
 * legacy callers to protect. The body is assembled by `egressBoundary.assemble` and used verbatim.
 *
 * The endpoint path, the request body and the response shape are NOT VERIFIED. See
 * docs/research/ollama-cloud-build.md.
 */
async function webSearch({ query, maxResults = 5, user, timeout = 30000, allowInternal = false } = {}) {
  const gated = gateUser(user);
  if (gated) return gated;

  const gate = egressBoundary.assemble({ kind: 'search', query, maxResults, allowInternal });
  if (!gate.ok) {
    console.warn(`[ollama-cloud] search refused: level=${gate.level} where=${gate.where}`);
    return { ok: false, refused: true, path: 'cloud',
             level: gate.level, reason: gate.reason, where: gate.where, index: gate.index };
  }

  const cred = credentialState();
  if (!cred.present) { noteUnconfigured(cred); return unconfiguredShape(cred); }

  const base = resolveBaseUrl();
  const orch = orchestrator();
  const verdict = orch.admit({ aiProvider: SEARCH_PROVIDER, label: 'ollama hosted search', ramMB: 16, priority: 2 });
  if (!verdict.allow) return { ok: false, deferred: true, path: 'cloud', reason: verdict.reason };

  const slot = await orch.reserveSlot(SEARCH_PROVIDER, { priority: 2, waitMs: 20000 });
  if (!slot.ok) return { ok: false, deferred: true, path: 'cloud', reason: slot.reason };

  try {
    const res = await httpClient().post(`${base.url}${SEARCH_PATH}`, gate.body, {
      headers: authHeader(), timeout: clampTimeout(timeout), retries: 1,
    });
    if (!res?.ok) return classifyFailure(res, '(search)');

    const p = parseOrShapeError(res.body);
    if (!p.ok) return p;

    const rows = Array.isArray(p.parsed.results) ? p.parsed.results : null;
    if (!rows) {
      return { ok: false, shapeError: true, path: 'cloud',
               reason: 'the hosted search response did not carry a results array' };
    }
    let dropped = 0;
    const results = [];
    for (const r of rows) {
      let href = null;
      try { href = /^https?:$/.test(new URL(String(r?.url)).protocol) ? String(r.url) : null; }
      catch { href = null; }
      if (!href) { dropped += 1; continue; }
      results.push({ title: String(r.title ?? ''), url: href, snippet: String(r.snippet ?? r.content ?? '') });
    }
    orch.recordApiUse(SEARCH_PROVIDER, 0);
    return { ok: true, results, dropped, path: 'cloud', via: 'ollama-cloud-keyed',
             credentialSource: 'vault', endpoint: `${base.url}${SEARCH_PATH}` };
  } finally {
    orch.releaseSlot(SEARCH_PROVIDER);
  }
}

/** Test-only reset of the once-per-process log flags and the 401 suppression window. */
function _resetNotices() {
  baseUrlWarned = false;
  unconfiguredWarned = false;
  lockedWarned = false;
  credRejectedUntil = 0;
}

module.exports = {
  // configuration + state, never values
  baseUrl, resolveBaseUrl, credentialState, isConfigured, status,
  // naming
  CLOUD_TAGS, apiNameFor, daemonTagFor, isDaemonCloudTag, isApiName,
  // registry
  toRegistryEntries,
  // transport
  chat, listModels, webSearch,
  // seams for tests
  useVault, useStore, useHttp, useOrchestrator, _resetNotices,
  // constants
  DEFAULT_BASE_URL, ALLOWED_HOSTS, CRED_SERVICE, PROVIDER, SEARCH_PROVIDER, ID_PREFIX, REMEDY,
  CHAT_PATH, TAGS_PATH, SEARCH_PATH,
};
