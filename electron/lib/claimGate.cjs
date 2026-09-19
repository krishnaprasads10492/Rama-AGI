'use strict';

/**
 * claimGate — the output boundary. Every claim leaves as `grounded`, `reflex` or not at all.
 *
 * WHY THIS EXISTS. HALO (arXiv 2607.17883): "zero hallucination is not a property a model possesses
 * but a property a system enforces." The mechanism (arXiv 2604.06195) is output-boundary
 * misclassification — a completion emitted AS IF grounded in evidence. Rāma cannot stop a base model
 * confabulating; it can refuse to pass an unattributed claim through its own boundary (Section 110).
 *
 * NOT A CONFIDENCE SCORE. `intelligenceEngine.buildOutput` already prints `overallConfidence: 78.4`,
 * a letter grade, and "~21.6% chance of being wrong" — computed from DOMAIN REPUTATION and keyword
 * overlap, never from whether a finding answers the question, so five reputable domains that address
 * nothing still grade A. A number on a sentence is the same failure with extra decimals. This module
 * emits a CLASS and a SOURCE, or withholds. `verifyClaimGate` asserts no score ever appears.
 *
 * WHAT IT DECIDES AND WHAT IT CANNOT. It does not judge truth — that needs entailment, which needs a
 * model, which is the thing being contained. It decides ATTRIBUTION: the cited source must exist in
 * the evidence actually supplied, and every checkable token in the claim (numerals, ISO dates, named
 * entities) must appear in that source. A fabricated citation is caught because the id is not there;
 * an invented figure is caught because the digits are not there. Section 94's defect was exactly this
 * shape — a synthesised "source" that passed vetting — and that one was found only by reading.
 *
 * WHICH WAY IT ERRS. Toward withholding. A claim written in words ("twelve percent") escapes the
 * numeral check and passes as prose: a real hole, and the reason the structured `claims` form exists.
 * A sentence with no checkable token is emitted as `prose` and marked non-evidential, because gating
 * ordinary connective language would make callers bypass the gate, which forfeits everything.
 */

const CLASS = Object.freeze({
  GROUNDED:     'grounded',      // a supplied source carries every checkable token
  REFLEX:       'reflex',        // Rāma computed it deterministically; the record is the evidence
  PROSE:        'prose',         // asserts no checkable external fact — emitted, never evidence
  UNATTRIBUTED: 'unattributed',  // withheld
});

// Bounded because the input is model output: a runaway generation must not become a runaway loop.
// Over the cap we report `truncated` rather than quietly emitting a prefix, since a silently short
// answer reads as a complete one.
const MAX_CLAIMS = 200;
const MAX_CLAIM_CHARS = 4000;

/** `[s1]` or `[reflex:positionMath]` at the end of a claim. Absent means unattributed. */
const CITE_RE = /\[([A-Za-z0-9_:.\-]{1,64})\]\s*$/;

const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/g;

// A leading `-` only when not preceded by a word character, so `2026-08-20` does not read as a
// negative. Applied identically to claim and source, so both sides decompose the same way.
const NUM_RE = /(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g;

/**
 * Capitalised or all-caps tokens are treated as named entities and must appear in the source —
 * tickers (`RELIANCE`, `NIFTY50`) matter more than sparing our own emphasis. These are exempt
 * because they name Rāma, master, or sentence scaffolding rather than a fact about the world.
 */
const NEUTRAL_TOKENS = new Set([
  'I', 'I\'M', 'I\'VE', 'RAMA', 'RĀMA', 'STOCKMIND', 'MASTER', 'KRISHNA', 'PRASAD',
  'THE', 'A', 'AN', 'THIS', 'THAT', 'THESE', 'THOSE', 'IT', 'ITS', 'IF', 'AND', 'OR', 'BUT',
  'NOT', 'NO', 'YES', 'HOME', 'HE', 'SHE', 'THEY', 'YOU', 'YOUR', 'WE', 'THERE', 'HERE',
  'WHAT', 'WHEN', 'WHY', 'HOW', 'WHICH', 'WHO', 'SO', 'AS', 'AT', 'ON', 'IN', 'TO', 'OF', 'FOR',
]);

/**
 * Predictive and absolute modality. Found by running: `Profit will double next year.` carries no
 * digit and no ticker, so it passed as prose — the single most damaging shape of confabulation in a
 * market context, emitted unchallenged.
 *
 * A retrieved document CANNOT ground a statement about the future, so a modal claim is groundable
 * only by a `reflex` projection record with a method behind it. Citing one to a news article is
 * refused, which is the discipline Rāma already applies to projections, enforced here.
 */
const MODAL_RE = /\b(will|won't|shall|going to|about to|set to|sure to|bound to|guaranteed|certainly|definitely|undoubtedly|always|never|every time|no risk|risk[- ]free|cannot lose|can't lose|best|worst|highest|lowest|largest|smallest)\b/i;

/** First-person abstention. Rāma saying it does not know is never withheld — that is the goal state. */
const ABSTENTION_RE = /^\s*(i (cannot|can't|could not|couldn't|do not|don't|am not|have no|will not|won't)\b|no (data|source|sources|evidence|record|records)\b|not (measured|backtestable|verified|known)\b|unknown\b)/i;

// ─── canonicalisation ─────────────────────────────────────────────────────────

/**
 * One measurement, one string. `0.190`, `.19` and `0.19` are the same figure written three ways, and
 * a gate that called them different would withhold true claims until callers stopped using it.
 * `%` is stripped on both sides, so `12%` matches `12` — a deliberate loosening.
 */
function canonNumber(raw) {
  let s = String(raw).replace(/[,\s\u00A0_%]/g, '');
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^-/, '');
  let [int = '', frac = ''] = s.split('.');
  int = int.replace(/^0+(?=\d)/, '') || '0';
  frac = frac.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== '0' ? `-${out}` : out;
}

/** The tokens a claim commits to: figures, dates, names. Nothing else is checkable here. */
function checkableTokens(text) {
  const s = String(text ?? '');
  const body = s
    // The citation names evidence; it is not part of the claim and must not appear inside it.
    .replace(CITE_RE, '')
    // An ordered-list marker is structure. Stripped before figures are read, not only before names,
    // or "1. Reliance reported a profit" demands the figure 1 from the source.
    .replace(/^\s*\d+[.)]\s*/, '');

  const dates = new Set(body.match(ISO_DATE_RE) || []);

  const numbers = new Set();
  for (const m of body.match(NUM_RE) || []) {
    const c = canonNumber(m);
    if (c !== null) numbers.add(c);
  }
  // A date's own parts would otherwise be demanded as separate figures. The whole date is already
  // checked, and `2026`/`08`/`20` add nothing but false rejections.
  for (const d of dates) {
    for (const part of d.split('-')) {
      const c = canonNumber(part);
      if (c !== null) numbers.delete(c);
    }
  }

  const entities = new Set();
  const words = body.split(/[\s(),;:"'`]+/).filter(Boolean);
  words.forEach((word, i) => {
    const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '');
    if (bare.length < 2) return;
    if (!/^\p{Lu}/u.test(bare)) return;
    if (NEUTRAL_TOKENS.has(bare.toUpperCase())) return;
    if (/^\d/.test(bare)) return;                         // already covered as a figure
    // A sentence-initial capital is usually grammar, not a name, and demanding every opening word
    // appear in the source would withhold true claims over wording ("Earnings" against "profit").
    // Ticker-shaped tokens are the exception: `RELIANCE closed at …` must still be checked, and a
    // first word is exactly where a ticker sits.
    if (i === 0 && !/^[\p{Lu}\p{N}]{2,}$/u.test(bare)) return;
    entities.add(bare);
  });

  return {
    dates: [...dates],
    numbers: [...numbers],
    entities: [...entities],
    modal: MODAL_RE.test(body),
  };
}

function isCheckable(tok) {
  return tok.dates.length > 0 || tok.numbers.length > 0 || tok.entities.length > 0 || tok.modal;
}

// ─── evidence ─────────────────────────────────────────────────────────────────

/**
 * Index what may be cited, and record what was refused.
 *
 * Refusals are re-derived here rather than trusted from the caller: `vetSources` drops fallbacks and
 * empty documents, and a gate that assumed that had happened would be defeated by one caller that
 * forgot. The rejection survives with its reason, so a citation to a dropped source reports WHY
 * rather than reading as a hallucinated id.
 */
function indexEvidence({ sources = [], reflexes = {} } = {}) {
  const accepted = new Map();
  const rejected = new Map();

  (Array.isArray(sources) ? sources : []).forEach((src, i) => {
    if (!src || typeof src !== 'object') return;
    const id = String(src.id ?? src.sourceId ?? `s${i + 1}`);
    if (src.fallback) {
      rejected.set(id, 'that source is a search-failure marker, not evidence');
      return;
    }
    const content = typeof src.content === 'string' ? src.content : '';
    if (!content.trim()) {
      rejected.set(id, 'that source has no content, so it can support nothing');
      return;
    }
    if (accepted.has(id) || rejected.has(id)) {
      // Two documents under one id makes "which one grounded this" unanswerable.
      rejected.set(id, 'that source id was supplied more than once');
      accepted.delete(id);
      return;
    }
    accepted.set(id, {
      kind: CLASS.GROUNDED,
      id,
      label: src.title || src.domain || src.url || id,
      text: `${content}\n${src.title || ''}\n${src.url || ''}`,
    });
  });

  // `Object.create(null)` semantics by construction: a Map cannot be reached through `__proto__`,
  // so a model citing `[__proto__]` gets a fabricated-citation refusal rather than Object.prototype.
  for (const [rawId, rec] of Object.entries(reflexes && typeof reflexes === 'object' ? reflexes : {})) {
    const id = rawId.startsWith('reflex:') ? rawId : `reflex:${rawId}`;
    if (!rec || typeof rec !== 'object') {
      rejected.set(id, 'that reflex produced no record');
      continue;
    }
    let text;
    try {
      text = JSON.stringify(rec);
    } catch {
      rejected.set(id, 'that reflex record could not be read');
      continue;
    }
    accepted.set(id, { kind: CLASS.REFLEX, id, label: rec.name || id, text });
  }

  return { accepted, rejected };
}

/** Which of a claim's tokens the cited evidence does not carry. */
function missingFrom(evidence, tok) {
  const haystack = evidence.text;
  const evNums = new Set();
  for (const m of haystack.match(NUM_RE) || []) {
    const c = canonNumber(m);
    if (c !== null) evNums.add(c);
  }
  const evDates = new Set(haystack.match(ISO_DATE_RE) || []);
  // Entities compare case-insensitively: a source writing `Reliance` supports a claim about
  // `RELIANCE`. Casing is presentation; the name is the fact.
  const lower = haystack.toLowerCase();

  const missing = [];
  for (const d of tok.dates) if (!evDates.has(d)) missing.push(d);
  for (const n of tok.numbers) if (!evNums.has(n)) missing.push(n);
  for (const e of tok.entities) if (!lower.includes(e.toLowerCase())) missing.push(e);
  return missing;
}

// ─── the gate ─────────────────────────────────────────────────────────────────

/**
 * Sentence split that keeps decimals and abbreviations intact — `0.19` is not two sentences.
 *
 * A citation written after the full stop (`… on 2026-09-18. [s1] Profit will …`) lands at the START
 * of the next unit, which detached every claim from its source and made the following sentence
 * inherit nothing. So a leading `[id]` is moved back onto the sentence it cites, and what remains
 * stands as its own claim.
 */
function segment(text) {
  const raw = String(text ?? '')
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\d"'(\[])|\n+/u)
    .map(s => s.trim())
    .filter(Boolean);

  const out = [];
  for (const unit of raw) {
    const lead = unit.match(/^\[([A-Za-z0-9_:.\-]{1,64})\]\s*/);
    if (lead && out.length) {
      out[out.length - 1] = `${out[out.length - 1]} [${lead[1]}]`;
      const rest = unit.slice(lead[0].length).trim();
      if (rest) out.push(rest);
      continue;
    }
    out.push(unit);
  }
  return out;
}

function classifyOne(raw, index, { accepted, rejected }) {
  const text = String(raw?.text ?? raw ?? '').trim();
  const clipped = text.length > MAX_CLAIM_CHARS;
  const body = clipped ? text.slice(0, MAX_CLAIM_CHARS) : text;

  const citeFromText = body.match(CITE_RE)?.[1] ?? null;
  const cite = raw && typeof raw === 'object' && raw.cite ? String(raw.cite) : citeFromText;
  const display = body.replace(CITE_RE, '').trim();

  const tok = checkableTokens(body);

  if (!isCheckable(tok) || ABSTENTION_RE.test(display)) {
    return { index, text: display, class: CLASS.PROSE, cite: null, source: null, evidential: false };
  }
  if (!cite) {
    return {
      index, text: display, class: CLASS.UNATTRIBUTED, cite: null,
      reason: 'no-citation',
      detail: `states ${describe(tok)} with no source`,
    };
  }
  if (rejected.has(cite)) {
    return {
      index, text: display, class: CLASS.UNATTRIBUTED, cite,
      reason: 'rejected-source',
      detail: rejected.get(cite),
    };
  }
  const evidence = accepted.get(cite);
  if (!evidence) {
    return {
      index, text: display, class: CLASS.UNATTRIBUTED, cite,
      reason: 'fabricated-citation',
      detail: `cites "${cite}", which is not among the evidence supplied`,
    };
  }
  if (tok.modal && evidence.kind !== CLASS.REFLEX) {
    return {
      index, text: display, class: CLASS.UNATTRIBUTED, cite,
      reason: 'unsourceable-prediction',
      detail: `a document cannot support a claim about what will happen; ${evidence.label} is not a projection`,
    };
  }
  const missing = missingFrom(evidence, tok);
  if (missing.length) {
    return {
      index, text: display, class: CLASS.UNATTRIBUTED, cite,
      reason: 'unsupported-figure',
      detail: `${evidence.label} does not contain ${missing.slice(0, 6).map(m => `"${m}"`).join(', ')}`,
      missing,
    };
  }
  return {
    index, text: display, class: evidence.kind, cite,
    source: evidence.label, evidential: true,
    ...(clipped ? { clipped: true } : {}),
  };
}

function describe(tok) {
  const parts = [];
  if (tok.numbers.length) parts.push(`${tok.numbers.length} figure${tok.numbers.length > 1 ? 's' : ''}`);
  if (tok.dates.length) parts.push(`${tok.dates.length} date${tok.dates.length > 1 ? 's' : ''}`);
  if (tok.entities.length) parts.push(`${tok.entities.length} name${tok.entities.length > 1 ? 's' : ''}`);
  if (tok.modal) parts.push('a prediction or an absolute');
  return parts.join(' and ') || 'a checkable fact';
}

/**
 * Gate one model answer.
 *
 * @param {object}   input
 * @param {string}  [input.text]      raw model prose; segmented into sentences
 * @param {Array}   [input.claims]    structured `{ text, cite }` — preferred, and exact
 * @param {Array}   [input.sources]   vetted sources; `{ id, content, title, domain, url }`
 * @param {object}  [input.reflexes]  deterministic records, keyed by name
 * @returns {{ok: boolean, body: string, emitted: Array, withheld: Array, notice: string|null,
 *            evidence: object, truncated: boolean}}
 */
function gate({ text = '', claims = null, sources = [], reflexes = {} } = {}) {
  const index = indexEvidence({ sources, reflexes });

  let units = Array.isArray(claims) && claims.length ? claims.slice() : segment(text);
  const truncated = units.length > MAX_CLAIMS;
  if (truncated) units = units.slice(0, MAX_CLAIMS);

  const classified = units.map((u, i) => classifyOne(u, i, index));
  const emitted = classified.filter(c => c.class !== CLASS.UNATTRIBUTED);
  const withheld = classified.filter(c => c.class === CLASS.UNATTRIBUTED);
  const grounded = emitted.filter(c => c.evidential);

  const notes = [];
  if (withheld.length) {
    // Counted by reason rather than listed one by one: master asked not to be dumped on, and the
    // reason is what tells him whether the model invented a source or invented a number.
    const byReason = new Map();
    for (const w of withheld) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + 1);
    const phrase = [...byReason.entries()]
      .map(([reason, n]) => `${n} ${REASON_LABELS[reason] ?? reason}`)
      .join(', ');
    notes.push(`Withheld ${withheld.length} statement${withheld.length > 1 ? 's' : ''}: ${phrase}.`);
  }
  if (truncated) notes.push(`Only the first ${MAX_CLAIMS} statements were checked; the rest were not emitted.`);
  // An empty body would read as "no answer" when it means "nothing survived attribution" — a
  // different and more useful fact.
  if (!emitted.length) notes.push('None of this answer could be attributed to a source, so none of it is shown.');
  else if (!grounded.length && index.accepted.size === 0) notes.push('No evidence was supplied, so nothing here is sourced.');

  return {
    ok: withheld.length === 0 && !truncated,
    body: emitted.map(c => c.text).join(' '),
    emitted,
    withheld,
    notice: notes.length ? notes.join(' ') : null,
    evidence: {
      accepted: index.accepted.size,
      grounded: grounded.length,
      rejected: [...index.rejected.entries()].map(([id, why]) => ({ id, why })),
    },
    truncated,
  };
}

const REASON_LABELS = Object.freeze({
  'no-citation':         'with no source',
  'fabricated-citation': 'citing a source that was never supplied',
  'rejected-source':     'citing a source that is not evidence',
  'unsupported-figure':  'whose figures are not in the source cited',
  'unsourceable-prediction': 'predicting the future from a document that cannot contain it',
});

/**
 * A record for the audit trail. Text is deliberately absent: this is kept, and keeping the withheld
 * sentence would store the confabulation next to the account of refusing it.
 */
function attest(result) {
  return {
    at: new Date().toISOString(),
    emitted: result.emitted.length,
    grounded: result.emitted.filter(c => c.evidential).length,
    withheld: result.withheld.map(w => ({ reason: w.reason, cite: w.cite ?? null })),
    evidenceAccepted: result.evidence.accepted,
    evidenceRejected: result.evidence.rejected.length,
    truncated: result.truncated,
  };
}

module.exports = {
  gate, attest, segment, indexEvidence, checkableTokens, canonNumber,
  CLASS, MAX_CLAIMS, MAX_CLAIM_CHARS, REASON_LABELS,
};
