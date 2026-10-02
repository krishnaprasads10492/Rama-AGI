'use strict';

/**
 * egressBoundary.cjs — the ONE place a cloud request body is assembled, and the gate that
 * decides whether a payload may leave this machine at all.
 *
 * ── WHY THE TRANSPORT OWNS THIS, AND NOT THE ROLE ENGINE OR THE CALLER ───────────────────────────
 *
 * Section 130.8 requires the design to name the chokepoint where an outbound payload is assembled
 * and to show that a classified row cannot pass it EVEN WHEN IT ARRIVES VIA A JOIN. `modelRoles`
 * only ever sees a model, never a payload, so it cannot see a join. Callers get refactored and
 * there will be more of them. The transport is the one place bytes leave the machine, so it is the
 * only place where "nothing classified private crosses this line" can be TRUE rather than
 * CURRENTLY TRUE.
 *
 * "Egress" means OFF THIS MACHINE. It does not mean ollama.com. bing.com is no less of a network,
 * which is why this module is not called cloudBoundary.cjs — a name read as a scope limit is how
 * the next session re-opens a closed finding.
 *
 * ── MESSAGES ARE CLASSIFIED, NOT ONLY PARTS ──────────────────────────────────────────────────────
 *
 * `messages[].content` is the field that actually carries the prompt. An earlier draft of this gate
 * wrote every rule about `parts` and pinned `content` to a plain string, so the primary payload
 * crossed unclassified and `maxLevel` was computed over an empty array and resolved to 'public'.
 * The claim that nothing private can cross was false for the one field every existing caller uses.
 *
 * ── THE ENVELOPE LIVES HERE TOO ──────────────────────────────────────────────────────────────────
 *
 * `model`, `stream` and `options` are assembled here, not at the call site, because the cloud path
 * is asserted to contain no second body constructor (scripts/verifyOllamaCloud.cjs section g). A
 * gate that classifies the parts while the caller builds the envelope is a gate with a hole shaped
 * exactly like the envelope.
 *
 * Verified by: scripts/verifyOllamaCloud.cjs section (g).
 */

/** The classification lattice, lowest first. */
const LEVELS = Object.freeze(['public', 'internal', 'private']);
const RANK   = Object.freeze({ public: 0, internal: 1, private: 2 });

const KINDS       = Object.freeze(['chat', 'search']);
const ROLES       = Object.freeze(['system', 'user', 'assistant']);
const OPTION_KEYS = Object.freeze(['think', 'format']);
const FORMATS     = Object.freeze([null, 'json']);

const MAX_MESSAGES    = 200;
const MAX_PARTS       = 200;
const MAX_BODY_BYTES  = 1024 * 1024;        // a payload nobody sized is a payload nobody reviewed
const MAX_QUERY_CHARS = 400;
const SEARCH_RESULT_MIN = 1;
const SEARCH_RESULT_MAX = 10;

/**
 * Reason strings are part of the contract, because a future reword must not be able to pass a
 * sensitive prompt while sounding right. The suite asserts these exact strings.
 */
const REASON = Object.freeze({
  unclassified: 'an object payload element must carry an explicit classification: public, internal or private',
  shape:        'a payload element must be a string or { text, classification }',
  privateLevel: 'classification "private" never leaves this machine',
  internalLevel: 'classification "internal" needs both allowInternal and config.allowInternalToCloud',
  emptyText:    'a payload element carries no text, so it cannot be represented in a request body',
  badKind:      'kind must be exactly "chat" or "search"',
  chatNeedsModel: 'a /api/chat body needs a model',
  chatNeedsMessages: 'a /api/chat body needs a messages array of 1 to 200 entries',
  badRole:      'a message role must be system, user or assistant',
  searchCarriesChatFields: 'a search envelope carries no model, messages or parts — something is mis-wired',
  chatCarriesQuery: 'a chat envelope carries no query — something is mis-wired',
  searchNeedsQuery: 'a search query must be classified: pass { text, classification }',
  queryTooLong:  `a search query is limited to ${MAX_QUERY_CHARS} characters`,
  queryControl:  'a search query may not contain control characters',
  tooLarge:      `the assembled body exceeds the ${MAX_BODY_BYTES}-byte egress ceiling`,
});

// ─── Store seam ───────────────────────────────────────────────────────────────
// Same idiom as ollamaCatalog.useStore: a module-level injected variable and a lazy require, so a
// test never loads the real dataStore (which requires Electron at module scope).

let injectedStore = null;

function useStore(stub) { injectedStore = stub; }

function storeOf() {
  if (injectedStore) return injectedStore;
  try { return require('../dataStore.cjs'); }
  catch { return null; }
}

/**
 * The SECOND of the two independent switches `internal` needs. One switch gets flipped by a
 * default; two do not.
 */
function internalAllowedByConfig() {
  try {
    const s = storeOf();
    return !!s && s.get('config', 'allowInternalToCloud') === true;
  } catch { return false; }
}

// ─── Classification ───────────────────────────────────────────────────────────

function refuse(level, reason, where, index = null) {
  return { ok: false, refused: true, level, reason, where, index };
}

/**
 * Classify one payload element and extract its text.
 *
 * A bare primitive string is 'public' — that is what every caller passes today, and refusing them
 * would be a capability regression on day one. Choosing the OBJECT shape is choosing to classify;
 * forgetting to is not a default, so an absent, undefined, null or empty classification is refused
 * with the SAME reason string as an unrecognised value. A typo must fail closed.
 */
function classifyElement(el) {
  if (typeof el === 'string') {
    return el.length ? { ok: true, level: 'public', text: el } : { ok: false, reason: REASON.emptyText };
  }
  if (el === null || typeof el !== 'object' || Array.isArray(el)) {
    return { ok: false, reason: REASON.shape };
  }
  if (typeof el.text !== 'string') return { ok: false, reason: REASON.shape };
  if (!el.text.length) return { ok: false, reason: REASON.emptyText };

  const raw = el.classification;
  if (raw === undefined || raw === null || raw === '' || !LEVELS.includes(raw)) {
    return { ok: false, reason: REASON.unclassified };
  }
  return { ok: true, level: raw, text: el.text };
}

/** Is this level permitted to cross? `private` has no override anywhere, by design. */
function levelPermitted(level, allowInternal) {
  if (level === 'private') return { ok: false, reason: REASON.privateLevel };
  if (level === 'internal') {
    if (allowInternal === true && internalAllowedByConfig()) return { ok: true };
    return { ok: false, reason: REASON.internalLevel };
  }
  return { ok: true };
}

function higher(a, b) { return RANK[b] > RANK[a] ? b : a; }

// ─── Envelope ─────────────────────────────────────────────────────────────────

/**
 * `options` is ENUMERATED, never spread. A passthrough of unknown keys into an outbound body is an
 * unreviewed egress surface with extra steps.
 */
function validateOptions(options) {
  if (options === null || options === undefined) return { ok: true, think: undefined, format: null };
  if (typeof options !== 'object' || Array.isArray(options)) {
    return { ok: false, reason: 'options must be an object of { think, format }' };
  }
  for (const k of Object.keys(options)) {
    if (!OPTION_KEYS.includes(k)) return { ok: false, reason: `unknown option "${k}"` };
  }
  let think;
  if (Object.prototype.hasOwnProperty.call(options, 'think')) {
    if (typeof options.think !== 'boolean') return { ok: false, reason: 'think must be a boolean' };
    think = options.think;
  }
  let format = null;
  if (Object.prototype.hasOwnProperty.call(options, 'format')) {
    if (!FORMATS.includes(options.format)) return { ok: false, reason: 'format must be null or \'json\'' };
    format = options.format;
  }
  return { ok: true, think, format };
}

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function approxBytes(obj) {
  // Measured without serialising the body here: the one-constructor rule is asserted structurally
  // over ollamaCloud.cjs, and this module is where the size ceiling belongs.
  let n = 0;
  const visit = (v) => {
    if (typeof v === 'string') { n += Buffer.byteLength(v, 'utf8'); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { n += k.length; visit(v[k]); } }
  };
  visit(obj);
  return n;
}

// ─── assemble ─────────────────────────────────────────────────────────────────

/**
 * The one constructor of a cloud request body.
 *
 * @returns {{ok:true, body:object, maxLevel:string, counts:{messages:number,parts:number}}}
 *        | {ok:false, refused:true, level:string|null, reason:string, where:string, index:number|null}
 */
function assemble(spec = {}) {
  const {
    kind       = null,
    messages   = null,
    parts      = null,
    query      = null,
    model      = null,
    stream     = false,
    options    = null,
    maxResults = 5,
    allowInternal = false,
  } = spec;

  if (!KINDS.includes(kind)) return refuse(null, REASON.badKind, 'envelope');

  const opt = validateOptions(options);
  if (!opt.ok) return refuse(null, opt.reason, 'envelope');

  if (kind === 'search') {
    if (model !== null || messages !== null || parts !== null) {
      return refuse(null, REASON.searchCarriesChatFields, 'envelope');
    }
    return assembleSearch(query, maxResults, allowInternal);
  }

  if (query !== null) return refuse(null, REASON.chatCarriesQuery, 'envelope');
  return assembleChat({ messages, parts, model, stream, opt, allowInternal });
}

function assembleChat({ messages, parts, model, stream, opt, allowInternal }) {
  if (typeof model !== 'string' || !model.trim()) {
    return refuse(null, REASON.chatNeedsModel, 'envelope');
  }
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    return refuse(null, REASON.chatNeedsMessages, 'envelope');
  }
  if (parts !== null && (!Array.isArray(parts) || parts.length > MAX_PARTS)) {
    return refuse(null, 'parts must be an array of at most 200 elements', 'envelope');
  }

  // THE JOIN IS VISIBLE ONLY HERE. maxLevel is computed across messages AND parts together, so a
  // payload assembled from fifty public rows and one private row refuses AS A WHOLE, wherever the
  // private one sits.
  let maxLevel = 'public';
  const normalised = [];

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m || typeof m !== 'object' || Array.isArray(m)) return refuse(null, REASON.shape, 'messages', i);
    if (!ROLES.includes(m.role)) return refuse(null, REASON.badRole, 'messages', i);

    const c = classifyElement(m.content);
    if (!c.ok) return refuse(null, c.reason, 'messages', i);
    const permitted = levelPermitted(c.level, allowInternal);
    if (!permitted.ok) return refuse(c.level, permitted.reason, 'messages', i);

    maxLevel = higher(maxLevel, c.level);
    normalised.push({ role: m.role, content: c.text });
  }

  const appended = [];
  const list = Array.isArray(parts) ? parts : [];
  for (let i = 0; i < list.length; i += 1) {
    const c = classifyElement(list[i]);
    if (!c.ok) return refuse(null, c.reason, 'parts', i);
    const permitted = levelPermitted(c.level, allowInternal);
    if (!permitted.ok) return refuse(c.level, permitted.reason, 'parts', i);

    maxLevel = higher(maxLevel, c.level);
    // Each accepted part becomes its OWN system message, appended AFTER the caller's messages, in
    // the order given — so a context store's rows arrive AS CONTEXT rather than being spliced into
    // master's words. Nothing is dropped and nothing is truncated: a silently shortened prompt is
    // a wrong answer dressed as a right one.
    appended.push({ role: 'system', content: c.text });
  }

  const body = { model, messages: [...normalised, ...appended], stream: stream === true };
  if (opt.think !== undefined) body.think = opt.think;
  if (opt.format !== null) body.format = opt.format;

  if (approxBytes(body) > MAX_BODY_BYTES) return refuse(maxLevel, REASON.tooLarge, 'envelope');

  return { ok: true, body, maxLevel, counts: { messages: normalised.length, parts: appended.length } };
}

/**
 * The search body.
 *
 * PROVISIONAL, and labelled as such: the hosted-search endpoint's request shape is NOT VERIFIED
 * (docs/research/ollama-cloud-build.md, NOT VERIFIED item 3). The only permitted change when the
 * real shape is read is the FIELD NAMES INSIDE THIS FUNCTION. The structural rule — the body is
 * assembled here and nowhere else — holds whatever the names turn out to be, and the suite asserts
 * that an accepted search body carries no key outside { query, max_results } and that its only
 * caller-derived value is query.text.
 */
function assembleSearch(query, maxResults, allowInternal) {
  // THERE IS NO BARE-STRING ALLOWANCE FOR A QUERY. Rule 1's bare-string 'public' exists to protect
  // existing chat callers; a search query is the single most likely route for master's private
  // context to leave the machine, and search has no legacy callers at all, so the migration cost of
  // requiring classification is zero.
  if (typeof query === 'string' || query === null || query === undefined
      || typeof query !== 'object' || Array.isArray(query)) {
    return refuse(null, REASON.searchNeedsQuery, 'query');
  }
  if (typeof query.text !== 'string' || !query.text.trim()) {
    return refuse(null, REASON.searchNeedsQuery, 'query');
  }
  if (query.text.length > MAX_QUERY_CHARS) return refuse(null, REASON.queryTooLong, 'query');
  if (/[\u0000-\u001f\u007f]/.test(query.text)) return refuse(null, REASON.queryControl, 'query');

  const c = classifyElement(query);
  if (!c.ok) return refuse(null, REASON.searchNeedsQuery, 'query');
  const permitted = levelPermitted(c.level, allowInternal);
  if (!permitted.ok) return refuse(c.level, permitted.reason, 'query');

  return {
    ok: true,
    maxLevel: c.level,
    counts: { messages: 0, parts: 0 },
    body: { query: c.text, max_results: clamp(maxResults, SEARCH_RESULT_MIN, SEARCH_RESULT_MAX) },
  };
}

module.exports = {
  assemble, useStore,
  LEVELS, REASON, OPTION_KEYS, FORMATS,
  MAX_MESSAGES, MAX_PARTS, MAX_BODY_BYTES, MAX_QUERY_CHARS,
};
