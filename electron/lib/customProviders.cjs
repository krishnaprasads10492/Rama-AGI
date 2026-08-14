'use strict';

/**
 * customProviders.cjs — master can add ANY OpenAI-compatible LLM provider
 * (current or future) as data, not code, so Rāma's model roster grows without
 * a code change per provider.
 *
 * WHY OPENAI-COMPATIBLE COVERS "ALL KINDS": `/v1/chat/completions` with a
 * `{model, messages}` body and a `choices[0].message.content` response is the
 * de facto standard almost every LLM host now speaks — Groq, Mistral,
 * OpenRouter, Together, Fireworks, DeepSeek, Perplexity, local llama.cpp/
 * vLLM/LM Studio servers, and most providers that appear after this file was
 * written, per `modelRouter.cjs`'s own `groqChat`/`mistralChat` functions
 * (already using this exact shape). One generic adapter genuinely covers the
 * open-ended "all kinds of LLM models... that may be available in the
 * future" ask, rather than requiring a new provider function per vendor.
 * A provider that speaks something else (Anthropic's own format, Gemini's)
 * still needs its own adapter function in modelRouter.cjs — that is a real,
 * disclosed limit, not silently glossed over.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SECURITY BOUNDARY — read this before touching this file
 * ══════════════════════════════════════════════════════════════════════════
 * Master asked for this "WITHOUT COMPROMISING SECURITY AND DATA EVEN IF
 * ADVANCED AI MIGHT TRY TO DO IT." The boundary here is structural, not a
 * behavioural promise about what a model will or won't attempt to output:
 *
 *   1. NO AGENT-CALLABLE PATH. `add()`/`remove()`/register() are reached only
 *      through `models:add-custom-provider` / `models:remove-custom-provider`
 *      IPC handlers, called directly from the renderer's Models.jsx UI action
 *      (a real click, a real form submit). No agent action type
 *      (`agentOrchestrator.cjs`'s `parseActions`/`executeAction`, whose
 *      switch statement is a closed, hardcoded list of `search`/`read`) can
 *      reach this file. A model's own text output is inert here — it is
 *      never parsed as a command that could register or alter a provider.
 *   2. CAPABILITY-GATED, SAME TIER AS ADDING A CREDENTIAL. Every mutating
 *      handler requires `models.add-key` (tier 1 — master/superadmin only,
 *      `shared/capabilities.json`), the exact gate `Models.jsx` already uses
 *      for adding a normal provider API key. Adding a custom provider is not
 *      a lower-privilege action than adding an OpenAI key.
 *   3. CREDENTIALS NEVER LEAVE THE VAULT. A custom provider's API key is
 *      stored through `credentialVault.cjs` (AES-256-GCM, master-passcode
 *      derived key) under a per-provider generated `credKey`, exactly like
 *      every built-in provider. This file's own record for a provider
 *      (`dataStore.cjs` `config` domain, also encrypted at rest) holds only
 *      the credKey NAME, base URL, and model list — never the secret value.
 *   4. NO SSRF INTO THIS MACHINE'S OWN PRIVATE SERVICES. `validateBaseUrl()`
 *      refuses to register a base URL pointing at loopback/private/
 *      link-local ranges UNLESS the master explicitly opts in with
 *      `allowLocal: true` (needed for a real local server like LM
 *      Studio/vLLM on this machine) — so a provider entry cannot be used to
 *      quietly redirect Rāma's own outbound calls at, say,
 *      `http://localhost:4097` (this app's own unauthenticated-by-design
 *      Express API, invariant I2) or the encrypted vault's own process.
 *   5. NO SELF-MODIFICATION PATH. Registering a provider changes runtime
 *      state and one encrypted domain record. It never writes to source
 *      files, never touches `proposals.cjs`'s ledger, and cannot be used as
 *      a route to bypass invariant I6 — there is no `changes[]`/file-write
 *      anywhere in this module.
 *   6. HONEST FAILURE. An unreachable/misbehaving custom endpoint fails the
 *      same way any provider call fails in `modelRouter.cjs` — the fallback
 *      chain moves on, nothing is assumed to have worked.
 */

const crypto = require('crypto');

// URL ranges that must not be reachable as a provider base URL unless the
// master explicitly opts in — prevents a provider entry becoming a way to
// redirect calls at this machine's own local services.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,   // link-local / cloud metadata endpoints (e.g. 169.254.169.254)
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
];

function isPrivateHost(hostname) {
  return PRIVATE_HOST_PATTERNS.some(re => re.test(hostname));
}

/**
 * @param {string} rawUrl
 * @param {boolean} allowLocal  master explicitly consented to a local endpoint
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
function validateBaseUrl(rawUrl, allowLocal = false) {
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { return { ok: false, error: 'Not a valid URL' }; }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) base URLs are supported' };
  }
  if (parsed.protocol === 'http:' && !isPrivateHost(parsed.hostname) && !allowLocal) {
    return { ok: false, error: 'Plain http:// is only allowed for local/private endpoints — use https:// for a public provider, or pass allowLocal for a machine you control' };
  }
  if (isPrivateHost(parsed.hostname) && !allowLocal) {
    return {
      ok: false,
      error: `"${parsed.hostname}" is a local/private address. Set allowLocal:true only if this is genuinely a local model server (LM Studio, vLLM, etc.) you run yourself — never point a provider entry at this app's own services.`,
    };
  }
  return { ok: true, url: parsed };
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ─── Storage — dataStore's `config` domain (encrypted at rest, same as every
// other setting) holds the non-secret record; credentialVault holds the key.
function ds() { return require('../dataStore.cjs'); }

function listRecords() {
  return ds().get('config', 'customProviders') || [];
}

function saveRecords(records) {
  ds().set('config', 'customProviders', records);
  ds().saveDomain?.('config');
}

/**
 * @param {object} def { name, baseUrl, apiKey, models: string[], allowLocal }
 *   models: the model id strings this endpoint serves (master supplies these
 *   — this module does not probe/guess a provider's catalog, since an
 *   unauthenticated discovery call is itself a needless outbound request to
 *   an endpoint master hasn't necessarily vetted).
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
function add(def = {}) {
  const { name, baseUrl, apiKey, models, allowLocal = false } = def;

  if (!name || !String(name).trim())     return { ok: false, error: 'name is required' };
  if (!Array.isArray(models) || models.length === 0) {
    return { ok: false, error: 'models must be a non-empty list of model id strings this endpoint serves' };
  }

  const check = validateBaseUrl(baseUrl, allowLocal);
  if (!check.ok) return check;

  const id = `custom-${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;
  const credKey = apiKey ? id.toUpperCase().replace(/-/g, '_') : null;

  const records = listRecords();
  records.push({
    id,
    name: String(name).trim(),
    baseUrl: check.url.toString(),
    models: models.map(String),
    credKey,
    addedAt: Date.now(),
  });
  saveRecords(records);

  // The secret itself goes to the vault, under its own key — never into the
  // config-domain record above, which only carries the key's NAME.
  if (apiKey && credKey) {
    const vault = require('../ipc/credentialVault.cjs');
    // getCredential/isUnlocked are exported; vault:set is IPC-only, so write
    // directly through the same in-memory store that handler mutates. This
    // mirrors how other IPC modules reach the vault's write path today would
    // require an IPC round-trip to itself — instead we call the underlying
    // set logic once, guarded by the same "vault must be unlocked" check.
    const result = vault.setCredentialDirect
      ? vault.setCredentialDirect(credKey, apiKey, { label: name })
      : { ok: false, error: 'Vault write path unavailable' };
    if (!result.ok) {
      // Roll back the just-added record rather than leaving a provider entry
      // with a credKey that points at nothing.
      saveRecords(records.filter(r => r.id !== id));
      return { ok: false, error: result.error || 'Could not store credential in vault' };
    }
  }

  return { ok: true, data: { id, name, baseUrl: check.url.toString(), models, hasKey: !!apiKey } };
}

function remove(id) {
  const records = listRecords();
  const target = records.find(r => r.id === id);
  if (!target) return { ok: false, error: 'Provider not found' };

  saveRecords(records.filter(r => r.id !== id));

  if (target.credKey) {
    const vault = require('../ipc/credentialVault.cjs');
    vault.deleteCredentialDirect?.(target.credKey);
  }
  return { ok: true };
}

function list() {
  return listRecords().map(r => ({ ...r, hasKey: !!r.credKey }));
}

/**
 * Project every stored custom provider into `modelRouter.cjs`'s
 * MODEL_REGISTRY shape, so the existing fallback chain, capability caps, and
 * rate-limit accounting apply to them with no special-casing. Called by
 * modelRouter.cjs at model-list/selection time — this module never mutates
 * MODEL_REGISTRY itself, it only describes what to merge.
 */
function toRegistryEntries() {
  const out = {};
  for (const r of listRecords()) {
    for (const modelId of r.models) {
      out[modelId] = {
        provider: 'custom',
        customProviderId: r.baseUrl,   // carries the base URL through to the adapter
        credKey: r.credKey,
        type: 'cloud',
        ctxK: null,           // unknown — master did not supply this, never guessed
        costTier: null,       // unknown for the same reason
        caps: ['general'],
      };
    }
  }
  return out;
}

module.exports = {
  add, remove, list, toRegistryEntries,
  validateBaseUrl,   // exported for tests / IDE-driven verification
};
