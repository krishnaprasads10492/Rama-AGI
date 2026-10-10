/**
 * turnSensitivity.js — is this turn about something that must not leave the machine?
 *
 * WHY THIS EXISTS. `conversationRole.assembleTurn()` refuses to send a turn to a cloud model when
 * `sensitive` is true, and that refusal has been asserted by `verifyConversation.cjs` for several
 * sections. **Nothing ever passed the flag.** `Chat.jsx` called `models:converse` without it, so the
 * gate could never fire — a privacy control with no producer, which is the class the module audit
 * found five other instances of (spec Section 144).
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. The planned design is three fail-closed layers with a model layer
 * injectable. **This is layer one only: deterministic pattern matching.** The model layer is not built
 * — Ollama lives on another machine, and asking a third party whether a turn is private would require
 * sending them the turn, which is self-defeating. Layer one alone is worth shipping because a gate
 * with a conservative producer is strictly better than a gate with none.
 *
 * IT ERRS TOWARD PRIVATE, ALWAYS. A false "sensitive" costs a cloud round trip that would have been
 * local anyway — and ledger row 150 made this Ollama-only, so that cost is currently zero. A false
 * "public" puts master's holdings in someone else's log. The two errors are not comparable, so the
 * tie never goes to public: unusable input, an unreadable type, and anything matched by a pattern all
 * return sensitive.
 *
 * PURE AND SYNCHRONOUS. No store, no network, no clock — so `verifyTurnSensitivity.mjs` can assert
 * every branch, and so a classifier failure can never be an outage.
 */

/**
 * The patterns, each with the reason it exists. Named rather than inlined so the suite can assert
 * that every one of them actually fires on something, and that none of them fires on ordinary prose.
 */
export const SENSITIVE_PATTERNS = Object.freeze([
  // ── Master's money ────────────────────────────────────────────────────────
  { id: 'holdings', why: 'his positions and what he owns',
    re: /\b(my|our)\s+(holding|holdings|position|positions|portfolio|portfolios|trade|trades|order|orders|p&l|pnl|profit|loss|exposure|capital)\b/i },
  { id: 'book', why: 'the position book and its figures',
    re: /\b(net\s*qty|avg\s*cost|average\s*cost|unrealised|unrealized|realised|realized)\b/i },
  { id: 'amount', why: 'a currency amount, which is almost always his own',
    re: /(?:₹|\brs\.?\s|\binr\b|\$|\busd\b)\s?[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s?(?:lakh|lakhs|crore|crores)\b/i },
  { id: 'brokerAccount', why: 'a broker or demat account reference',
    re: /\b(demat|broker(?:age)?\s*account|client\s*id|ucc|trading\s*account)\b/i },

  // ── Secrets ───────────────────────────────────────────────────────────────
  { id: 'credential', why: 'a credential, by name',
    re: /\b(api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|passcode|password|passphrase|private[\s_-]?key|seed[\s_-]?phrase|mnemonic|otp|2fa)\b/i },
  { id: 'keyShape', why: 'something shaped like a key, even unnamed',
    re: /\b(?:sk|pk|rk)[-_][A-Za-z0-9]{12,}\b|\bBearer\s+[A-Za-z0-9._-]{16,}\b|\b[A-Za-z0-9_-]{32,}\b/ },

  // ── Identity ──────────────────────────────────────────────────────────────
  { id: 'govId', why: 'a government identifier',
    re: /\b[A-Z]{5}\d{4}[A-Z]\b|\b\d{4}\s?\d{4}\s?\d{4}\b|\b(pan\s*(?:card|no|number)|aadhaar|aadhar|passport\s*(?:no|number))\b/i },
  { id: 'contact', why: 'an email address or a phone number',
    re: /[\w.+-]+@[\w-]+\.[\w.]{2,}|\b(?:\+91[\s-]?)?[6-9]\d{9}\b/ },
  { id: 'selfIdentity', why: 'master asking about his own stored identity',
    re: /\b(my|our)\s+(name|address|email|phone|number|account|bank|salary|income|net\s*worth|tax)\b/i },

  // ── Rāma's own interior ───────────────────────────────────────────────────
  { id: 'nucleus', why: 'the nucleus, the loyalty core and the vault are never cloud topics',
    re: /\b(nucleus|loyalty\s*core|credential\s*vault|master\s*password|seal\s*version)\b/i },
]);

/**
 * @param {string} text the turn master typed
 * @param {{patterns?: ReadonlyArray}} [opts] injection point for the suite; production passes nothing
 * @returns {{sensitive: boolean, reason: string, matched: string[]}}
 *   `matched` carries pattern IDS, never the matched text — returning the matched substring would put
 *   the secret into whatever logs or renders the classification, which is the opposite of the point.
 */
export function classifyTurn(text, opts = {}) {
  const patterns = Array.isArray(opts.patterns) ? opts.patterns : SENSITIVE_PATTERNS;

  // FAIL CLOSED ON ANYTHING UNREADABLE. A classifier that cannot read its input does not know the
  // answer is "public" — it knows nothing, and nothing must not be sent.
  if (typeof text !== 'string') {
    return { sensitive: true, reason: 'the turn is not text, so it cannot be classified', matched: [] };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { sensitive: true, reason: 'an empty turn cannot be classified', matched: [] };
  }

  const matched = [];
  for (const p of patterns) {
    // A MALFORMED RULE IS AN UNKNOWN ANSWER, NOT AN ABSENT ONE. The first version SKIPPED anything
    // that was not a RegExp, which is the wrong direction: a rule list that has been damaged — by a
    // bad edit, a failed import, a half-applied patch — would then quietly classify every turn as
    // public. Refusing is the only safe reading of "I could not apply my own rules".
    if (!(p?.re instanceof RegExp)) {
      return {
        sensitive: true,
        reason: `a classification rule is malformed, so this turn cannot be judged: ${p?.id ?? 'unnamed'}`,
        matched,
      };
    }
    try {
      if (p.re.test(trimmed)) matched.push(p.id);
    } catch {
      // A RegExp that throws while matching — catastrophic backtracking, a hostile input. Same
      // conclusion: the rules did not complete, so the answer is not known.
      return { sensitive: true, reason: `a classification rule failed: ${p.id ?? 'unnamed'}`, matched };
    }
  }

  if (matched.length > 0) {
    return {
      sensitive: true,
      reason: `matched ${matched.length} private pattern(s): ${matched.join(', ')}`,
      matched,
    };
  }
  return {
    sensitive: false,
    reason: 'no private pattern matched — layer one only; no model has judged this turn',
    matched: [],
  };
}

/** The boolean on its own, for a call site that only needs the flag. */
export function isSensitiveTurn(text) {
  return classifyTurn(text).sensitive;
}
