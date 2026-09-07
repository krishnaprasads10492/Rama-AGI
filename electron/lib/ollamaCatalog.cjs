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

// ─── Persistence ──────────────────────────────────────────────────────────────
// Master: *"utilise DB if needed for integrated resources."* The store Rāma already has IS that
// database — `dataStore` is encrypted, per-domain and already the home of every other integrated
// resource (Section 86's workspace registry uses the same idiom). Rejected adding SQLite or Mongo:
// a second store for one cached document would put model metadata outside the vault that protects
// everything else, and would need its own backup, migration and lifecycle for no gain.
//
// Caching matters here beyond speed: once fetched, the catalogue and the retirement schedule are
// queryable OFFLINE. Without that, a machine with no network could not tell master that the model he
// is about to rely on has been retired — which is precisely when he would most want to know.
const DOMAIN = 'config';
const KEY = 'ollamaCatalog';

/** How long a fetched catalogue is trusted before a refresh is advised. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

let injectedStore = null;

/** Inject `dataStore`, so this module never requires Electron and stays testable. */
function useStore(store) { injectedStore = store; }

function ds() {
  if (injectedStore) return injectedStore;
  // Lazy, so a test that injects never loads the real store.
  return require('../dataStore.cjs');
}

/**
 * Persist the fetched library and retirement schedule.
 *
 * `fetchedAt` is recorded rather than inferred, so staleness is a measured fact and not a guess at
 * how long the app has been running.
 */
function saveCatalog({ catalog = {}, schedule = [], source = null, now = new Date() } = {}) {
  const doc = {
    catalog,
    schedule,
    source,
    fetchedAt: now.toISOString(),
    families: Object.keys(catalog).length,
    retirementRows: schedule.length,
  };
  ds().set(DOMAIN, KEY, doc);
  ds().saveDomain?.(DOMAIN);
  return doc;
}

/**
 * Read the cached catalogue.
 *
 * Returns `{catalog, schedule, fetchedAt, ageMs, stale}` — never null, so callers get empty
 * structures rather than having to guard. `stale` is advice, not a refusal: a day-old catalogue is
 * far better than none, and refusing to use it would leave master with no guidance at all whenever
 * the network is down.
 */
function loadCatalog({ now = new Date() } = {}) {
  let doc = null;
  try { doc = ds().get(DOMAIN, KEY); } catch { doc = null; }

  const catalog = (doc && typeof doc.catalog === 'object' && doc.catalog) || {};
  const schedule = Array.isArray(doc?.schedule) ? doc.schedule : [];
  const fetchedAt = doc?.fetchedAt || null;
  const t = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const ageMs = Number.isNaN(t) ? null : Math.max(0, now.getTime() - t);

  return {
    catalog,
    schedule,
    source: doc?.source || null,
    fetchedAt,
    ageMs,
    // Never fetched counts as stale; an unparseable timestamp does too, rather than being trusted.
    stale: ageMs === null || ageMs > STALE_AFTER_MS,
    empty: Object.keys(catalog).length === 0,
  };
}

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

/** Smallest advertised size in billions of parameters, for judging whether a local model fits. */
function smallestSizeB(sizes = []) {
  const nums = sizes
    .map(s => paramsB(`x:${s}`))
    .filter(n => n !== null && Number.isFinite(n));
  return nums.length ? Math.min(...nums) : null;
}

/** Rough resident bytes at 4-bit quantisation — the number that decides if it fits master's disk. */
function q4Bytes(paramsBillions) {
  if (!Number.isFinite(paramsBillions)) return null;
  return paramsBillions * 0.6 * 1024 * 1024 * 1024;
}

/**
 * Should Rāma recommend this model, and how strongly? (Section 92)
 *
 * Master: *"instead of showing entire catalogue, sort through it for better."* So this is a judgement
 * with stated weights, not a listing. Every contribution is reported in `why`, because a ranking
 * master cannot interrogate is just an opinion with a number attached.
 *
 * TWO HARD EXCLUSIONS, not penalties:
 *   - **No tool calling.** Rāma drives an agent loop; a model that cannot call a tool cannot act,
 *     so ranking it lower than a capable model understates the problem — it is unusable, not worse.
 *   - **Retired.** It will stop working, so recommending it at any rank is wrong.
 *
 * THE CORRECTION THAT MATTERS: popularity is used as a RATE, not a total. Pull counts accumulate for
 * as long as a model exists, so ranking by them ranks by age — it would put `llama3.1` (119M pulls,
 * a year old, superseded twice over) above `muse-glimmer` (191K pulls, a week old, purpose-built for
 * local agents). Pulls per month asks the question actually intended: are people adopting this now?
 */
function scoreCandidate(entry = {}, { preferCloud = true, diskBudgetBytes = null, now = new Date(), schedule = [] } = {}) {
  const fam = String(entry.family || '').toLowerCase();
  const why = [];

  const retirement = retirementFor(fam, schedule, now);
  if (retirement) {
    return {
      score: 0,
      excluded: true,
      excludeReason: retirement.retired
        ? `retired by Ollama${retirement.alternative ? ` — use ${retirement.alternative}` : ''}`
        : `retiring${retirement.date ? ` on ${retirement.date}` : ''}${retirement.alternative ? ` — use ${retirement.alternative}` : ''}`,
      why: [],
      retirement,
    };
  }

  if (!entry.tools) {
    return {
      score: 0,
      excluded: true,
      excludeReason: 'no tool calling, so Rāma could not act with it',
      why: [],
      retirement: null,
    };
  }

  let score = 0;
  const add = (points, reason) => { score += points; if (points !== 0) why.push(`${points > 0 ? '+' : ''}${points} ${reason}`); };

  // ── Disk, which is master's stated binding constraint ─────────────────────
  if (entry.cloud) {
    add(preferCloud ? 30 : -10, preferCloud
      ? 'runs in Ollama\'s cloud, so it costs almost no disk'
      : 'runs in the cloud, and local-only was requested');
  } else {
    const smallest = smallestSizeB(entry.sizes);
    const bytes = q4Bytes(smallest);
    if (bytes === null) {
      add(0, 'no advertised size, so disk cost is unknown');
    } else if (diskBudgetBytes && bytes > diskBudgetBytes) {
      // Not excluded: master may free space or accept the cost. But it must not outrank a fit.
      add(-25, `smallest build is about ${Math.round(bytes / 1024 / 1024 / 1024)} GB, over the budget`);
    } else {
      add(12, `smallest build about ${Math.round(bytes / 1024 / 1024 / 1024)} GB, which fits`);
      add(8, 'works with no network and keeps prompts on this machine');
    }
  }

  // ── Capability that an agent actually uses ────────────────────────────────
  if (entry.thinking) add(15, 'reasons before answering, which matters for multi-step work');
  if (entry.vision) add(5, 'can read images and screenshots');

  // ── Recency, because a superseded model is a worse tool at the same size ──
  const days = Number(entry.updatedDaysAgo);
  if (Number.isFinite(days)) {
    if (days <= 30) add(30, 'released or updated within the last month');
    else if (days <= 90) add(22, 'updated within three months');
    else if (days <= 180) add(14, 'updated within six months');
    else if (days <= 365) add(6, 'updated within the year');
    else add(-12, 'over a year old, so almost certainly superseded');
  }

  // ── Adoption RATE, never the raw total ────────────────────────────────────
  const pulls = Number(entry.pulls) || 0;
  if (Number.isFinite(days) && days > 0 && pulls > 0) {
    const perMonth = pulls / Math.max(1, days / 30);
    const points = Math.min(25, Math.round(Math.log10(Math.max(10, perMonth)) * 5));
    add(points, `being adopted at roughly ${Math.round(perMonth).toLocaleString()} pulls a month`);
  }

  // ── Licence, where the description states one ─────────────────────────────
  if (/apache 2\.0|mit license/i.test(entry.description || '')) {
    add(5, 'permissively licensed');
  }

  return { score, excluded: false, excludeReason: null, why, retirement: null };
}

/**
 * The few models worth master's attention — curated, not listed (Section 92).
 *
 * Returns `{ recommended, excluded }` so a rejection is visible rather than a silent omission: if
 * master wonders why a model he read about is absent, the reason is in the payload.
 */
function suggestions({
  catalog = {}, installed = [], preferCloud = true, needs = [],
  diskBudgetBytes = null, schedule = [], now = new Date(), limit = 5,
} = {}) {
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
      updatedDaysAgo: Number.isFinite(Number(e.updatedDaysAgo)) ? Number(e.updatedDaysAgo) : null,
      sizes: Array.isArray(e.sizes) ? e.sizes : [],
      description: e.description || null,
    }))
    .filter(r => (needs.includes('vision') ? r.vision : true))
    .map(r => ({ ...r, ...scoreCandidate(r, { preferCloud, diskBudgetBytes, now, schedule }) }));

  const recommended = rows
    .filter(r => !r.excluded)
    .sort((a, b) => b.score - a.score || b.pulls - a.pulls)
    .slice(0, limit);

  const excluded = rows
    .filter(r => r.excluded)
    .map(r => ({ family: r.family, reason: r.excludeReason }));

  return { recommended, excluded };
}

/**
 * What master should actually DO about a retired model (Section 93).
 *
 * `advisories()` reports the problem; this answers the question that follows. For every installed
 * model Ollama has retired or will:
 *
 *   - the replacement Ollama itself names, when the schedule gives one
 *   - whether that replacement is ALREADY INSTALLED, in which case the action is to stop using the
 *     old one rather than to pull anything — telling master to download what he has would be noise
 *   - the exact `ollama pull` command, so the fix is copyable rather than described
 *   - a SCORED SUBSTITUTE from the catalogue when no alternative is named, because "retired, no
 *     replacement, good luck" is not guidance. Chosen by the same `scoreCandidate()` used for
 *     suggestions, so its reasoning is visible and consistent with everything else Rāma recommends.
 *
 * Urgency is DERIVED: already-retired is `critical` because it is broken now, a dated future
 * retirement is `warn`. The status follows the measurement, so it corrects itself when Ollama moves
 * a date rather than needing anyone to remember (Section 88's rule).
 */
function migrationPlan({ installed = [], catalog: lib = {}, schedule = [], now = new Date(), preferCloud = true, diskBudgetBytes = null } = {}) {
  const have = new Set(installed.map(m => familyOf(m.model || m.id || '')));
  const plan = [];

  for (const m of installed) {
    const ret = m.retirement || retirementFor(m.model || m.id, schedule, now);
    if (!ret) continue;

    const named = ret.alternative || null;
    const namedFamily = named ? familyOf(named) : null;
    const alreadyHave = namedFamily ? have.has(namedFamily) : false;

    // No alternative named: pick the best-scoring live candidate so master is not left stranded.
    let substitute = null;
    if (!named) {
      const { recommended } = suggestions({
        catalog: lib, installed, schedule, now, preferCloud, diskBudgetBytes, limit: 1,
      });
      substitute = recommended[0] || null;
    }

    plan.push({
      id: m.id,
      model: m.model || m.id,
      severity: ret.retired ? 'critical' : 'warn',
      retired: ret.retired,
      date: ret.date,
      why: ret.note,
      replacement: named || substitute?.family || null,
      // Distinguishes "Ollama says use this" from "Rāma picked this", which are different claims.
      replacementSource: named ? 'ollama' : (substitute ? 'rama-scored' : null),
      replacementWhy: named
        ? 'named by Ollama as the recommended replacement'
        : (substitute ? substitute.why : null),
      alreadyInstalled: alreadyHave,
      action: alreadyHave
        ? `Stop using ${m.model || m.id} — ${named} is already installed`
        : (named || substitute
          ? `ollama pull ${named || substitute.family}`
          : `No replacement is available for ${m.model || m.id}`),
    });
  }

  // Broken-now before breaking-later, then soonest date first.
  return plan.sort((a, b) => {
    if (a.retired !== b.retired) return a.retired ? -1 : 1;
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
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
  classify, retirementFor, describeInstalled, suggestions, advisories, scoreCandidate, migrationPlan,
  useStore, saveCatalog, loadCatalog,
  familyOf, paramsB, smallestSizeB, q4Bytes,
  CLOUD_MAX_LOCAL_BYTES, CLOUD_MIN_PARAMS_B, EVIDENCE, DOMAIN, KEY, STALE_AFTER_MS,
};
