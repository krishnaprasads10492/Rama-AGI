'use strict';

/**
 * ollamaCatalog.cjs — what Ollama can actually run for master, and what it costs him (Section 92).
 *
 * Three problems this exists to solve, all found by measurement rather than assumed:
 *
 *   A. `MODEL_REGISTRY` was a hardcoded allowlist of four names, so anything master pulled was
 *      detected, displayed, and unroutable. Discovery replaces declaration.
 *
 *   B. Ollama serves CLOUD models through the same `localhost:11434` as local ones. They need
 *      almost no disk, which is exactly why master wants them — but they execute on Ollama's
 *      servers. Reported as `local/free/offline` they would tell master his prompt stayed on the
 *      machine when it did not.
 *
 *   C. Ollama RETIRES cloud models on a published schedule, naming a replacement for each. A
 *      hardcoded list does not go stale so much as break, with nothing able to say why.
 *
 * EVERY FUNCTION HERE IS PURE. Tags, catalogue and retirement schedule are passed in, so the whole
 * module is testable with no daemon and no network. Fetching lives in the caller.
 */

/** A cloud model's weights are not on disk, so anything this small cannot be running locally. */
const CLOUD_MAX_LOCAL_BYTES = 512 * 1024 * 1024;   // 512 MB

/** Below this parameter count the size test is meaningless — small models really are small. */
const CLOUD_MIN_PARAMS_B = 8;

/** Classification confidence, strongest first. Order matters: `why` reports the winner. */
const EVIDENCE = ['catalog', 'name', 'size', 'none'];

/** `qwen3.5:27b` → `qwen3.5`. Ollama's library is keyed by family, tags carry the size. */
function familyOf(id) {
  return String(id || '').split(':')[0].trim().toLowerCase();
}

/**
 * Parameter count in billions from a tag, or null.
 *
 * Handles `27b`, `0.8b`, `397b`, `1.7b`, `350m` (→0.35) and MoE spellings like `16x17b`, which is
 * read as its TOTAL (272B) because total parameters are what would have to sit on disk — and disk is
 * the whole question being asked here.
 */
function paramsB(id) {
  const tag = String(id || '').split(':')[1];
  if (!tag) return null;

  const moe = tag.match(/^(\d+)x([\d.]+)b/i);
  if (moe) return Number(moe[1]) * Number(moe[2]);

  const b = tag.match(/^([\d.]+)b/i);
  if (b) return Number(b[1]);

  const m = tag.match(/^([\d.]+)m/i);
  if (m) return Number(m[1]) / 1000;

  return null;
}

/**
 * Is this model executed on Ollama's servers rather than on this machine?
 *
 * @param {object} tag           one `/api/tags` entry: `{name, size, details}`
 * @param {object} catalogEntry  matching library entry `{cloud:boolean}` when one was fetched
 * @returns {{cloud:boolean|null, why:string, evidence:string}}
 *
 * `cloud:null` means UNKNOWN, and unknown is never collapsed into local. The failure is asymmetric:
 * calling a cloud model local tells master his data stayed home when it did not, while calling a
 * local model unknown costs one line of UI.
 */
function classify(tag = {}, catalogEntry = null) {
  const id = String(tag.name || '');

  // 1. The library itself says so. Strongest evidence available.
  if (catalogEntry && typeof catalogEntry.cloud === 'boolean') {
    return catalogEntry.cloud
      ? { cloud: true, evidence: 'catalog', why: 'the model library marks this model as cloud' }
      : { cloud: false, evidence: 'catalog', why: 'the model library lists this as a local model' };
  }

  // 2. An explicit marker in the name.
  if (/[-:]cloud\b/i.test(id)) {
    return { cloud: true, evidence: 'name', why: 'the model name carries a cloud marker' };
  }

  // 3. Weights that are not on disk cannot be executing here.
  const params = paramsB(id);
  const size = Number(tag.size);
  if (Number.isFinite(size) && params !== null && params >= CLOUD_MIN_PARAMS_B) {
    if (size <= CLOUD_MAX_LOCAL_BYTES) {
      return {
        cloud: true,
        evidence: 'size',
        why: `${params}B parameters but only ${Math.round(size / 1024 / 1024)} MB on disk, `
          + 'so the weights are not here',
      };
    }
    return {
      cloud: false,
      evidence: 'size',
      why: `${Math.round(size / 1024 / 1024 / 1024)} GB of weights present on this machine`,
    };
  }

  return {
    cloud: null,
    evidence: 'none',
    why: 'no catalogue entry, no cloud marker, and the size is not conclusive',
  };
}

/**
 * Has this model been retired, or is it about to be?
 *
 * @param {string} id        e.g. `kimi-k2.5:latest`
 * @param {Array}  schedule  `[{ model, alternative, date, past }]` from Ollama's docs
 * @param {Date}   now
 *
 * Matches the family as well as the exact id, because the schedule lists both bare families
 * (`minimax-m2.5`) and specific tags (`qwen3-coder:480b`), and a master running `minimax-m2.5:latest`
 * is affected by a row that names only `minimax-m2.5`.
 */
function retirementFor(id, schedule = [], now = new Date()) {
  const want = String(id || '').toLowerCase();
  const fam = familyOf(id);

  for (const row of schedule) {
    const listed = String(row.model || '').toLowerCase();
    if (!listed) continue;
    if (listed !== want && listed !== fam && familyOf(listed) !== fam) continue;

    const when = row.date ? new Date(row.date) : null;
    const past = row.past === true || (when && !Number.isNaN(when.getTime()) && when <= now);

    return {
      retired: !!past,
      date: row.date || null,
      alternative: row.alternative || null,
      // Stated rather than left for the caller to phrase, so every surface says the same thing.
      note: past
        ? `Retired${row.date ? ` on ${row.date}` : ''}. `
          + (row.alternative ? `Ollama's recommended replacement is ${row.alternative}.` : 'No replacement was named.')
        : `Scheduled for retirement${row.date ? ` on ${row.date}` : ''}. `
          + (row.alternative ? `Move to ${row.alternative} before then.` : 'No replacement named yet.'),
    };
  }
  return null;
}

/**
 * Turn what Ollama reports into models Rāma can route to and describe truthfully.
 *
 * @param {object} input
 * @param {Array}  input.tags      `/api/tags` entries
 * @param {object} input.catalog   `{ family: {cloud, tools, thinking, vision, description} }`
 * @param {Array}  input.schedule  retirement rows
 * @param {object} input.seed      `MODEL_REGISTRY`-shaped known metadata, by `ollama/<family>`
 * @param {Date}   input.now
 *
 * WHY CAPABILITIES ARE REBUILT RATHER THAN COPIED FROM THE SEED: the seed marks every ollama entry
 * `offline` and `costTier: 0`. For a cloud model both are false, and inheriting them is exactly how
 * defect B would survive a rewrite.
 */
function describeInstalled({ tags = [], catalog = {}, schedule = [], seed = {}, now = new Date() } = {}) {
  const out = [];

  for (const tag of tags) {
    const id = String(tag.name || '').trim();
    if (!id) continue;

    const fam = familyOf(id);
    const entry = catalog[fam] || null;
    const cls = classify(tag, entry);
    const known = seed[`ollama/${fam}`] || seed[`ollama/${id}`] || null;

    const caps = new Set();
    // From the catalogue where we have it, else from what the seed knew.
    if (entry?.tools || known?.caps?.includes('code')) caps.add('code');
    if (entry?.vision) caps.add('vision');
    if (entry?.thinking) caps.add('analysis');
    caps.add('general');

    // The honest part. A cloud model cannot answer with the network down, and a local one can.
    if (cls.cloud === true) caps.add('remote');
    else if (cls.cloud === false) caps.add('offline');

    const params = paramsB(id);
    if (params !== null && params <= 4) caps.add('fast');

    out.push({
      id: `ollama/${id}`,
      model: id,
      family: fam,
      provider: 'ollama',
      credKey: null,
      // `local` only when measured local. `unknown` is its own state, never folded into local.
      type: cls.cloud === true ? 'cloud-ollama' : cls.cloud === false ? 'local' : 'unknown',
      cloud: cls.cloud,
      cloudEvidence: cls.evidence,
      cloudWhy: cls.why,
      // Explicit, because "reached via localhost" stopped meaning "stayed on this machine".
      private: cls.cloud === false,
      // Not 0 for cloud: a free account has an allowance, which is a budget even with no invoice.
      costTier: cls.cloud === true ? 1 : 0,
      // Ollama truncates to num_ctx regardless of what the family supports, so this is what the
      // seed claimed and is marked as unverified rather than presented as measured.
      ctxK: known?.ctxK ?? null,
      ctxVerified: false,
      caps: [...caps],
      sizeBytes: Number.isFinite(Number(tag.size)) ? Number(tag.size) : null,
      paramsB: params,
      description: entry?.description || null,
      retirement: retirementFor(id, schedule, now),
      discovered: true,
    });
  }

  return out;
}

/**
 * Models master could enable, that he has not pulled yet — the "give master the list" half.
 *
 * Cloud entries are offered first when `preferCloud`, because master's binding constraint is disk
 * and a cloud model costs him almost none. Sorted by pulls within each group, since popularity is
 * the only quality signal available without benchmarking every candidate ourselves.
 */
function suggestions({ catalog = {}, installed = [], preferCloud = true, needs = [], limit = 12 } = {}) {
  const have = new Set(installed.map(m => familyOf(m.model || m.id || '')));

  const rows = Object.entries(catalog)
    .filter(([fam]) => !have.has(fam))
    .map(([fam, e]) => ({
      family: fam,
      cloud: !!e.cloud,
      tools: !!e.tools,
      thinking: !!e.thinking,
      vision: !!e.vision,
      pulls: Number(e.pulls) || 0,
      sizes: Array.isArray(e.sizes) ? e.sizes : [],
      description: e.description || null,
      retirement: retirementFor(fam, [], new Date()),
    }))
    // A model Rāma is going to drive needs tool calling; without it the agent loop cannot act.
    .filter(r => (needs.includes('tools') ? r.tools : true))
    .filter(r => (needs.includes('vision') ? r.vision : true));

  rows.sort((a, b) => {
    if (preferCloud && a.cloud !== b.cloud) return a.cloud ? -1 : 1;
    if (!preferCloud && a.cloud !== b.cloud) return a.cloud ? 1 : -1;
    return b.pulls - a.pulls;
  });

  return rows.slice(0, limit);
}

/** Anything installed that Ollama has retired or will — what master must be told without asking. */
function advisories(models = []) {
  return models
    .filter(m => m.retirement)
    .map(m => ({
      id: m.id,
      severity: m.retirement.retired ? 'critical' : 'warn',
      what: m.retirement.retired
        ? `${m.model} has been retired by Ollama and will stop working`
        : `${m.model} is scheduled for retirement`,
      why: m.retirement.note,
      alternative: m.retirement.alternative,
    }));
}

module.exports = {
  classify, retirementFor, describeInstalled, suggestions, advisories,
  familyOf, paramsB,
  CLOUD_MAX_LOCAL_BYTES, CLOUD_MIN_PARAMS_B, EVIDENCE,
};
