'use strict';

/**
 * modelRoles — what Rāma needs a model FOR, and which model is fit for it.
 *
 * WHY THIS EXISTS. `modelRouter.TASK_ROUTING` is eight hand-written buckets over a capability list,
 * and `FALLBACK_CHAIN` is seven model ids in a fixed order ending at `primaryModel`. So every task
 * that does not match a bucket lands on whatever is first and available — which is how a 397B cloud
 * model ends up parsing a date (Section 110). The base model is a replaceable part; the harness is the
 * durable asset, and the harness has to know what it is replacing a part FOR.
 *
 * TWO KINDS OF EVIDENCE, NEVER CONFLATED.
 *   measured   — from the Ollama daemon and its published library: what is installed, its size, its
 *                parameter count, whether the weights are on this disk (`ollamaCatalog.describeInstalled`).
 *   published  — from leaderboards and release notes: that function-calling reliability collapses below
 *                roughly 7B, that reasoning wants 14B+. Real evidence, but about the family and not
 *                about this machine. Every requirement carries which kind it is, so a recommendation
 *                can never present a leaderboard as a local measurement.
 *
 * DECISION: A ROLE IS A REQUIREMENT, NOT A PREFERENCE. A model that fails a hard requirement is
 * EXCLUDED with a reason, not down-ranked. Down-ranking lets an unfit model win whenever nothing
 * better is present, which is how a model that cannot do tool calling ends up doing tool calling.
 *
 * DECISION: NO SILENT SUBSTITUTION, AND NO SILENT ABSENCE. Selection returns a `fit` of `declared`,
 * `substitute` or `none`. A substitute is allowed — capability is never removed (working agreement) —
 * but it is LABELLED, with what is unverified about it. `none` names the remedy rather than quietly
 * handing the work to the primary model.
 *
 * DECISION: CHEAPEST SUFFICIENT, NOT BEST AVAILABLE. Master's binding constraint is disk, and a
 * cloud call spends a real allowance. Ranking is fit, then privacy where the role is sensitive, then
 * cost, then capability. Size is a tiebreak, never a goal.
 */

const catalog = require('./ollamaCatalog.cjs');

/** Embedding models cannot chat and chat models cannot embed. A hard split, both directions. */
const EMBED_FAMILIES = new Set([
  'nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'bge-m3', 'bge-large',
  'snowflake-arctic-embed', 'snowflake-arctic-embed2', 'paraphrase-multilingual',
]);

/**
 * The roles Rāma needs filled. `minParamsB` and `minCtxK` are PUBLISHED thresholds — they describe
 * where a family's reliability falls off, not a measurement of this install.
 */
const ROLES = Object.freeze({
  extraction: {
    label: 'Extraction',
    why: 'pulling named fields out of text — dates, tickers, figures',
    minParamsB: 3, preferFast: true, sensitive: false,
    note: 'open weights are at parity with the frontier here, so this should never be a cloud call',
  },
  'tool-calling': {
    label: 'Tool calling',
    why: 'choosing a function and filling its arguments',
    minParamsB: 7, sensitive: false,
    note: 'published leaderboards show reliability collapsing below roughly 7B',
  },
  code: {
    label: 'Code',
    why: 'writing and repairing Rāma\'s own modules',
    minParamsB: 7, needCaps: ['code'], sensitive: false,
  },
  reasoning: {
    label: 'Reasoning',
    why: 'multi-step analysis where a wrong intermediate step changes the answer',
    minParamsB: 14, sensitive: false,
  },
  'long-context': {
    label: 'Long context',
    why: 'reading a whole filing or a day of news in one pass',
    minCtxK: 128, sensitive: false,
  },
  multilingual: {
    label: 'Multilingual',
    why: 'reading a source that is not in English',
    minParamsB: 7, noLocalMeasure: true, sensitive: false,
  },
  embedding: {
    label: 'Embedding',
    why: 'vector memory and retrieval',
    needEmbedding: true, sensitive: false,
  },
  vision: {
    label: 'Vision',
    why: 'reading a chart or a screenshot master pastes in',
    needCaps: ['vision'], sensitive: false,
  },
  narration: {
    label: 'Narration about master\'s money',
    why: 'the why/book text that describes real positions',
    minParamsB: 7, sensitive: true,
    note: 'SENSITIVE: the prompt names master\'s holdings, and a prompt that has left this machine '
      + 'cannot be recalled — so a non-private model is refused outright, not ranked lower',
  },
});

const ROLE_IDS = Object.freeze(Object.keys(ROLES));

/**
 * A number, or null for "not known".
 *
 * Found by running: `Number(null)` is `0`, so a model with no reported parameter count was excluded as
 * "0B is below the 7B floor" and a model with no reported size silently CLEARED the disk budget. Zero
 * is a value that passes or fails a threshold confidently; unknown must do neither.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Rough resident bytes, preferring what Ollama reported over what the parameter count implies. */
function residentBytes(model) {
  const reported = num(model?.sizeBytes);
  if (reported !== null && reported > 0) return reported;
  const params = num(model?.paramsB);
  return params === null ? null : catalog.q4Bytes(params);
}

function familyOf(model) {
  try {
    return catalog.familyOf(model?.id ?? '') ?? String(model?.id ?? '').split(':')[0];
  } catch {
    return String(model?.id ?? '').split(':')[0];
  }
}

function isEmbeddingModel(model) {
  const fam = String(familyOf(model)).toLowerCase();
  if (EMBED_FAMILIES.has(fam)) return true;
  // Names carry this reliably enough to act on, and the cost of a miss is a role left unfilled with a
  // reason rather than an embedding call answered by a chat model.
  return /embed|minilm|\bbge\b/i.test(`${model?.id ?? ''} ${model?.description ?? ''}`);
}

/**
 * Is one model fit for one role?
 *
 * @returns {{fit:'declared'|'substitute'|'none', reasons:string[], unverified:string[]}}
 *   `reasons` are the hard failures when `fit` is `none`, and otherwise empty.
 */
function evaluate(roleId, model, { diskBudgetBytes = null, requirePrivate = false } = {}) {
  const role = ROLES[Object.prototype.hasOwnProperty.call(ROLES, roleId) ? roleId : ''];
  if (!role) return { fit: 'none', reasons: [`"${roleId}" is not a declared role`], unverified: [] };
  if (!model || typeof model !== 'object' || !model.id) {
    return { fit: 'none', reasons: ['no model supplied'], unverified: [] };
  }

  const reasons = [];
  const unverified = [];

  // A retired model is not a candidate whatever else it satisfies — it is scheduled to stop working,
  // and `ollamaCatalog` already names its replacement.
  if (model.retirement?.retired) {
    reasons.push(`retired${model.retirement.replacement ? `; use ${model.retirement.replacement}` : ''}`);
  }

  const embed = isEmbeddingModel(model);
  if (role.needEmbedding && !embed) reasons.push('not an embedding model — a chat model cannot produce vectors');
  if (!role.needEmbedding && embed) reasons.push('an embedding model cannot generate text');

  // Sensitivity is a hard gate, not a ranking. `private === false` means the weights are not on this
  // disk, so the prompt leaves the machine.
  if ((role.sensitive || requirePrivate) && model.private !== true) {
    reasons.push('not private — this role\'s prompt names master\'s holdings and must not leave the machine');
  }

  if (Number.isFinite(role.minParamsB)) {
    const p = num(model.paramsB);
    if (p === null) unverified.push(`parameter count unknown, so the ${role.minParamsB}B floor is unchecked`);
    else if (p < role.minParamsB) reasons.push(`${p}B is below the ${role.minParamsB}B floor published for this role`);
  }

  for (const cap of role.needCaps ?? []) {
    if (!Array.isArray(model.caps) || !model.caps.includes(cap)) reasons.push(`does not report "${cap}"`);
  }

  if (Number.isFinite(role.minCtxK)) {
    const ctx = num(model.ctxK);
    if (ctx === null) reasons.push(`no context length known, and this role needs ${role.minCtxK}K`);
    else if (ctx < role.minCtxK) reasons.push(`${ctx}K context is below the ${role.minCtxK}K this role needs`);
    // Ollama truncates to num_ctx regardless of what the family supports, so a claimed window is a
    // claim. It can carry the role as a substitute; it cannot be presented as fit.
    else if (model.ctxVerified !== true) unverified.push(`${ctx}K context is the family's claim, never measured here`);
  }

  if (Number.isFinite(diskBudgetBytes) && model.private === true) {
    const bytes = residentBytes(model);
    if (bytes === null) unverified.push('resident size unknown, so the disk budget is unchecked');
    else if (bytes > diskBudgetBytes) {
      reasons.push(`needs about ${gb(bytes)} on disk against a ${gb(diskBudgetBytes)} budget`);
    }
  }

  // Rāma has no local test for this role, so no install can be called fit on evidence.
  if (role.noLocalMeasure) unverified.push('Rāma has no local measurement of this ability — selection is by family reputation');

  if (reasons.length) return { fit: 'none', reasons, unverified };
  return { fit: unverified.length ? 'substitute' : 'declared', reasons: [], unverified };
}

function gb(bytes) {
  return `${(Number(bytes) / (1024 ** 3)).toFixed(1)}GB`;
}

/**
 * Pick one model for one role.
 *
 * Ranking after fitness: a declared fit beats a substitute; private beats cloud (a local model spends
 * no allowance and leaks nothing); cheaper beats dearer; `fast` beats slow where the role asked for it;
 * and only then does capability break the tie. Size last, because bigger is a cost master pays.
 */
function selectForRole(roleId, models = [], opts = {}) {
  const role = ROLES[Object.prototype.hasOwnProperty.call(ROLES, roleId) ? roleId : ''];
  if (!role) {
    return { role: roleId, model: null, fit: 'none', why: `"${roleId}" is not a declared role`, candidates: [], excluded: [] };
  }

  const candidates = [];
  const excluded = [];
  for (const m of Array.isArray(models) ? models : []) {
    const verdict = evaluate(roleId, m, opts);
    if (verdict.fit === 'none') excluded.push({ id: m?.id ?? '(unnamed)', why: verdict.reasons.join('; ') });
    else candidates.push({ model: m, ...verdict });
  }

  candidates.sort((a, b) => {
    const fitRank = x => (x.fit === 'declared' ? 0 : 1);
    if (fitRank(a) !== fitRank(b)) return fitRank(a) - fitRank(b);
    const priv = x => (x.model.private === true ? 0 : 1);
    if (priv(a) !== priv(b)) return priv(a) - priv(b);
    // An unknown cost sorts last, not first: unknown must never look like free.
    const cost = x => (num(x.model.costTier) ?? 9);
    if (cost(a) !== cost(b)) return cost(a) - cost(b);
    if (role.preferFast) {
      const fast = x => (x.model.caps?.includes('fast') ? 0 : 1);
      if (fast(a) !== fast(b)) return fast(a) - fast(b);
    }
    const p = x => (num(x.model.paramsB) ?? 0);
    // For a role with a floor, the smallest model that clears it is the cheapest correct answer.
    return Number.isFinite(role.minParamsB) ? p(a) - p(b) : p(b) - p(a);
  });

  const top = candidates[0] ?? null;
  if (!top) {
    return {
      role: roleId, label: role.label, model: null, fit: 'none',
      // An unfilled role reports the absence. It does NOT hand the work to whatever is first and
      // available, which is the behaviour this module exists to replace.
      why: excluded.length
        ? `nothing available is fit for ${role.label.toLowerCase()} — ${excluded.length} model${excluded.length > 1 ? 's' : ''} checked and each failed a requirement`
        : `no models are available at all, so ${role.label.toLowerCase()} is unfilled`,
      candidates: [], excluded,
    };
  }

  return {
    role: roleId,
    label: role.label,
    model: top.model.id,
    fit: top.fit,
    why: top.fit === 'declared'
      ? `fit for ${role.label.toLowerCase()} on every declared requirement`
      : `carries ${role.label.toLowerCase()} as a SUBSTITUTE: ${top.unverified.join('; ')}`,
    unverified: top.unverified,
    private: top.model.private === true,
    costTier: top.model.costTier ?? null,
    candidates: candidates.map(c => ({ id: c.model.id, fit: c.fit })),
    excluded,
  };
}

/** Every role at once — the one table master reads instead of nine questions. */
function plan(models = [], opts = {}) {
  const rows = ROLE_IDS.map(id => selectForRole(id, models, opts));
  return {
    rows,
    filled: rows.filter(r => r.fit === 'declared').length,
    substituted: rows.filter(r => r.fit === 'substitute').length,
    unfilled: rows.filter(r => r.fit === 'none').map(r => r.role),
    // Distinguishes "checked and nothing fits" from "nothing was ever discovered", which read the
    // same in the old chain and mean opposite things.
    discovered: Array.isArray(models) ? models.length : 0,
  };
}

/**
 * What would fill the gaps — the research half of master's request.
 *
 * Recommendations come from the FETCHED catalogue only. Rāma does not know about models from memory,
 * and a list produced without the catalogue would be exactly the fabrication Section 94 removed. With
 * no catalogue loaded this says so and recommends nothing.
 */
function researchPlan(models = [], { catalogData = null, schedule = [], diskBudgetBytes = null, preferCloud = true } = {}) {
  const current = plan(models, { diskBudgetBytes });
  const gaps = [...current.unfilled, ...current.rows.filter(r => r.fit === 'substitute').map(r => r.role)];

  if (!catalogData || !Object.keys(catalogData).length) {
    return {
      gaps,
      recommendations: [],
      // The distinction that matters: nothing to recommend, versus never looked.
      blocked: 'the model catalogue has not been fetched, so there is nothing to recommend from — '
        + 'run models:refresh-catalog first',
    };
  }

  const recommendations = [];
  for (const roleId of gaps) {
    const role = ROLES[roleId];
    if (!role) continue;
    const needs = [];
    if (role.needCaps?.includes('code')) needs.push('code');
    if (role.needCaps?.includes('vision')) needs.push('vision');
    if (role.needEmbedding) needs.push('embedding');

    let picks = [];
    try {
      const { recommended } = catalog.suggestions({
        catalog: catalogData, schedule, installed: models,
        preferCloud, needs, diskBudgetBytes, limit: 3,
      });
      picks = recommended ?? [];
    } catch { picks = []; }

    recommendations.push({
      role: roleId,
      label: role.label,
      why: role.why,
      requirement: describeRequirement(role),
      candidates: picks.map(p => ({ id: p.id ?? p.name ?? null, note: p.why ?? p.reason ?? null })),
      // Said rather than left as an empty array, which would read as "nothing needed".
      note: picks.length ? null : 'the catalogue holds nothing that meets this role\'s requirements',
    });
  }

  return { gaps, recommendations, blocked: null };
}

function describeRequirement(role) {
  const parts = [];
  if (Number.isFinite(role.minParamsB)) parts.push(`at least ${role.minParamsB}B parameters (published threshold)`);
  if (Number.isFinite(role.minCtxK)) parts.push(`at least ${role.minCtxK}K context`);
  for (const c of role.needCaps ?? []) parts.push(`reports "${c}"`);
  if (role.needEmbedding) parts.push('is an embedding model, not a chat model');
  if (role.sensitive) parts.push('runs locally — this prompt must not leave the machine');
  return parts.join('; ') || 'no hard requirement beyond being usable';
}

module.exports = {
  ROLES, ROLE_IDS, evaluate, selectForRole, plan, researchPlan,
  isEmbeddingModel, residentBytes, describeRequirement, num, EMBED_FAMILIES,
};
