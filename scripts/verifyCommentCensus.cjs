'use strict';

/**
 * verifyCommentCensus.cjs — the two opposed counters, and `codeView` (spec Sections 137.5, 137.6)
 *
 * MAINTENANCE CONTRACT, in one line: `--pass-audit` guards the twelve `codeView` digests, the frozen
 * suite tails and the `BASE_REF` comment-only comparison — a PASS-TIME INSTRUMENT, not a standing
 * gate, because each of those reddens on any lawful future edit and the cheapest escape from such a
 * red is deleting the assertion.
 *
 * ── WHY THERE ARE TWO COUNTERS, MOVING IN OPPOSITE DIRECTIONS ─────────────────────────────────────
 *
 * A comment-line budget on its own rewards deletion, which is the opposite of what master asked for.
 * So the CEILING (`live <= PRE_PASS[file]`) is paired with a FLOOR (`live >= PRE_KEEP[file][counter]`)
 * over three counters that track reasoning rather than volume: spec pointers, evidence words and trap
 * markers. The only way to satisfy both at once is to remove restatement and keep findings.
 *
 * Both tables were frozen from measurement BEFORE a single comment was edited. That ordering is the
 * whole point: a floor recorded after the pass records whatever the pass left, and so cannot redden on
 * the only pass this task performs.
 *
 * The anchor-by-amending-an-existing-line rule is what keeps the pair satisfiable — a `Section N`
 * token added to a line that is ALREADY THERE raises the floor without raising the ceiling.
 *
 * ── `codeView`: FIVE GUARANTEES GO THROUGH ONE FUNCTION ──────────────────────────────────────────
 *
 * The comment-only proof, the no-restatement proof, the twelve digests, the keep-floor counts and the
 * "no list literal is restated in source" assertion. A tokeniser that is wrong in the quiet direction
 * makes all five wrong in the quiet direction, so it ships with a declared corpus rather than prose.
 *
 * THE PRECEDENT IS `scripts/verifyInvariants.cjs`'s `views(src) -> {raw, code, nc}`, not
 * `verifyChartProjection.mjs` — that file contains no comment stripper at all; its `:455` slices to a
 * marker call, which is a different technique. `views()` is not exported and `verifyInvariants.cjs`
 * sits in the covenant tail, so it is read here for its rules and never modified.
 *
 * WHY `codeView` KEEPS STRING CONTENTS. `views().code` blanks comments AND string contents, so it
 * cannot see a changed string literal — and "the pass changed only comments" is exactly a claim about
 * code outside comments INCLUDING its string literals. Computing that proof through `code` would make
 * it pass while a string literal changed underneath it. `codeView` therefore has `nc` semantics:
 * comments out, string contents in.
 *
 * TWO RULES ADOPTED FROM `views()`:
 *   - an UNPAIRED quote on a line is NOT a string — the one rule that stops JSX prose
 *     (`<p>master's words</p>`) from blanking the real code that follows it;
 *   - newlines survive inside a block comment, so an offset in the view still names the same line.
 *
 * ONE RULE `views()` DOES NOT HAVE: regex literals are tracked, because `/[/*]/` and `/a*\/b/` both
 * contain a sequence a comment scanner would otherwise take for a delimiter.
 *
 * R3 applies to the tokeniser itself: no negated character class may span a structure, so this file
 * uses none. The three forbidden spellings are assembled from pieces below for the same reason —
 * `codeView` keeps string contents, so a needle written whole would find itself.
 *
 * Run: node scripts/verifyCommentCensus.cjs                      (chain mode — counters and rules)
 *      node scripts/verifyCommentCensus.cjs --pass-audit         (adds the three detectors)
 *      node scripts/verifyCommentCensus.cjs --pass-audit --comment-only <ref>
 *      node scripts/verifyCommentCensus.cjs --pass-audit --require-comment-only
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SPEC = 'RAMA_AGI_MASTER_SPEC.md';

/** The branch point of `feat/comment-contract` — measured present. */
const BASE_REF = '21bb12d';

/** The first comment-concision tranche. Frozen so a later pass cannot quietly shrink the evidence. */
const TRANCHE_FILES = Object.freeze([
  'electron/lib/autonomyGate.cjs',
  'electron/lib/upgradeApplier.cjs',
  'scripts/verifyUpgradeApplier.cjs',
  'electron/lib/autonomyPolicy.cjs',
  'electron/lib/autonomyStop.cjs',
  'electron/lib/selfRepair.cjs',
  'electron/ipc/aiProcess.cjs',
  'electron/lib/startupDoctor.cjs',
  'scripts/verifyAutonomyStop.cjs',
  'electron/lib/dependencyAdvisor.cjs',
  'electron/ipc/timeline.cjs',
  'scripts/verifyEngineDiagnosis.cjs',
]);

// ─── The six census patterns, exactly as published in Section 137.6 ───────────
//
// A census number is only reproducible if the pattern is reproduced character for character. Two
// corrections are baked in here rather than left to a reader:
//   - the spec pointer is CASE-INSENSITIVE. PowerShell's `-match` is case-insensitive by default and a
//     Node suite is not, which is why the same "pattern" measured 501 one way and 496 the other. The
//     five differing lines are all OUTSIDE the tranche, so the tranche's 29 is engine-independent.
//   - the banner class is EXACT: U+2500, U+2014, '='. Widening it to the box-drawing block measures
//     1,398 repo-wide rather than 1,304.

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
const BANNER_LINE = /[\u2500\u2014=]{6,}/;
const JSDOC_TAG = /@(param|returns|type|property)\b/;
const SPEC_POINTER = /section \d+/i;
const EVIDENCE_WORD = /\b(measured|verified|benchmark|observed)\b/i;
const TRAP_MARKER = /(DO NOT|must not|refusing|was wrong)/i;

/** The three counters that track reasoning rather than volume. */
const KEEP_COUNTERS = Object.freeze(['pointer', 'evidence', 'trap']);

// ─── The frozen baselines, measured BEFORE any comment was edited ─────────────

/** CEILING. Comment lines per file may only go down. */
const PRE_PASS = Object.freeze({
  'electron/lib/autonomyGate.cjs': 256,
  'electron/lib/upgradeApplier.cjs': 237,
  'scripts/verifyUpgradeApplier.cjs': 197,
  'electron/lib/autonomyPolicy.cjs': 193,
  'electron/lib/autonomyStop.cjs': 192,
  'electron/lib/selfRepair.cjs': 140,
  'electron/ipc/aiProcess.cjs': 118,
  'electron/lib/startupDoctor.cjs': 98,
  'scripts/verifyAutonomyStop.cjs': 83,
  'electron/lib/dependencyAdvisor.cjs': 71,
  'electron/ipc/timeline.cjs': 48,
  'scripts/verifyEngineDiagnosis.cjs': 34,
});

/** FLOOR. Reasoning may not go down — and this reddens on THIS pass, not only on later ones. */
const PRE_KEEP = Object.freeze({
  'electron/lib/autonomyGate.cjs': Object.freeze({ pointer: 0, evidence: 11, trap: 4 }),
  'electron/lib/upgradeApplier.cjs': Object.freeze({ pointer: 0, evidence: 7, trap: 3 }),
  'scripts/verifyUpgradeApplier.cjs': Object.freeze({ pointer: 0, evidence: 8, trap: 2 }),
  'electron/lib/autonomyPolicy.cjs': Object.freeze({ pointer: 2, evidence: 2, trap: 2 }),
  'electron/lib/autonomyStop.cjs': Object.freeze({ pointer: 1, evidence: 1, trap: 2 }),
  'electron/lib/selfRepair.cjs': Object.freeze({ pointer: 3, evidence: 2, trap: 2 }),
  'electron/ipc/aiProcess.cjs': Object.freeze({ pointer: 15, evidence: 0, trap: 1 }),
  'electron/lib/startupDoctor.cjs': Object.freeze({ pointer: 1, evidence: 1, trap: 0 }),
  'scripts/verifyAutonomyStop.cjs': Object.freeze({ pointer: 0, evidence: 1, trap: 1 }),
  'electron/lib/dependencyAdvisor.cjs': Object.freeze({ pointer: 3, evidence: 1, trap: 0 }),
  'electron/ipc/timeline.cjs': Object.freeze({ pointer: 0, evidence: 0, trap: 0 }),
  'scripts/verifyEngineDiagnosis.cjs': Object.freeze({ pointer: 4, evidence: 0, trap: 3 }),
});

/** What banner reduction is measured against. Banner lines may only go down. */
const PRE_PASS_BANNER = Object.freeze({
  'electron/lib/autonomyGate.cjs': 12,
  'electron/lib/upgradeApplier.cjs': 18,
  'scripts/verifyUpgradeApplier.cjs': 16,
  'electron/lib/autonomyPolicy.cjs': 8,
  'electron/lib/autonomyStop.cjs': 12,
  'electron/lib/selfRepair.cjs': 5,
  'electron/ipc/aiProcess.cjs': 7,
  'electron/lib/startupDoctor.cjs': 6,
  'scripts/verifyAutonomyStop.cjs': 21,
  'electron/lib/dependencyAdvisor.cjs': 5,
  'electron/ipc/timeline.cjs': 6,
  'scripts/verifyEngineDiagnosis.cjs': 5,
});

/** The measured totals the run reproduces, so a silently-shrunk tranche is visible. */
const TRANCHE_TOTALS = Object.freeze({
  files: 12, lines: 6076, comment: 1667, banner: 121, pointer: 29, evidence: 34, trap: 20,
});

/**
 * A ZERO FLOOR CONSTRAINS NOTHING, so what binds those files instead is named rather than left for a
 * reader to wonder about. Asserted: every zero in `PRE_KEEP` appears here, and every entry here is
 * really zero.
 */
const ZERO_FLOORS = Object.freeze([
  Object.freeze({
    file: 'electron/ipc/timeline.cjs',
    counters: Object.freeze(['pointer', 'evidence', 'trap']),
    boundBy: 'its PRE_PASS ceiling of 48, the block-threshold rule (its 3-23 block is one of the three '
      + 'unanchored ones), and its codeView digest',
  }),
  Object.freeze({
    file: 'electron/lib/autonomyGate.cjs',
    counters: Object.freeze(['pointer']),
    boundBy: 'its evidence floor of 11 and its trap floor of 4',
  }),
  Object.freeze({
    file: 'electron/lib/upgradeApplier.cjs',
    counters: Object.freeze(['pointer']),
    boundBy: 'its evidence floor of 7 and its trap floor of 3',
  }),
  Object.freeze({
    file: 'scripts/verifyUpgradeApplier.cjs',
    counters: Object.freeze(['pointer']),
    boundBy: 'its evidence floor of 8, its trap floor of 2, and the SPLIT disposition of its 4-27 block',
  }),
  Object.freeze({
    file: 'scripts/verifyAutonomyStop.cjs',
    counters: Object.freeze(['pointer']),
    boundBy: 'its evidence floor of 1 and its trap floor of 1',
  }),
  Object.freeze({
    file: 'electron/ipc/aiProcess.cjs',
    counters: Object.freeze(['evidence']),
    boundBy: 'its pointer floor of 15 — the highest in the tranche — and its trap floor of 1',
  }),
  Object.freeze({
    file: 'scripts/verifyEngineDiagnosis.cjs',
    counters: Object.freeze(['evidence']),
    boundBy: 'its pointer floor of 4 and its trap floor of 3',
  }),
  Object.freeze({
    file: 'electron/lib/startupDoctor.cjs',
    counters: Object.freeze(['trap']),
    boundBy: 'its pointer floor of 1 and its evidence floor of 1',
  }),
  Object.freeze({
    file: 'electron/lib/dependencyAdvisor.cjs',
    counters: Object.freeze(['trap']),
    boundBy: 'its pointer floor of 3, its evidence floor of 1, and FR-B10: it is the reference case '
      + 'and is expected to lose little or nothing',
  }),
]);

/**
 * THE BLOCK-THRESHOLD RULE: every contiguous comment block of more than 20 lines must carry a
 * provenance token.
 *
 * THRESHOLD 20 HAS A MEASURED REASON, not a chosen one. `dependencyAdvisor.cjs`'s module header is a
 * 14-line block already carrying `(spec Section 96)` at line 8, and that file has NO block over 20 —
 * so the reference case sits under the line and passes unedited. A threshold that reddened the file the
 * rule holds up as the posture to copy would be the wrong threshold.
 */
const BLOCK_THRESHOLD = 20;

const PROVENANCE_TOKENS = Object.freeze([
  SPEC_POINTER,
  /docs\/research\/[A-Za-z0-9_.-]+\.md/,
  EVIDENCE_WORD,
]);

/**
 * The three blocks over the threshold that carry no provenance token, as measured at the freeze, each
 * with the disposition Section 137.6 declares. NONE of the dispositions is "delete".
 *
 * The chain row asserts the live set is a SUBSET of this one, so a NEW unanchored long block reddens it
 * while resolving a declared one does not. The `--pass-audit` row asserts EQUALITY, so the pass that
 * resolves them is forced to update this table rather than leave it describing history as if it were
 * the present.
 */
const UNANCHORED_AT_FREEZE = Object.freeze([
  Object.freeze({
    file: 'electron/lib/autonomyStop.cjs', from: 295, to: 327, lines: 33,
    disposition: 'ANCHOR IN PLACE — keep the capability-absence and write-then-unlink paragraphs, '
      + 'reduce the banner sub-rule to a label, add a Section 132 token to a line that already exists',
  }),
  Object.freeze({
    file: 'scripts/verifyUpgradeApplier.cjs', from: 4, to: 27, lines: 24,
    disposition: 'SPLIT — keep and anchor the two measured sentences, move the two residual paragraphs '
      + 'to Section 137.2 behind one pointer line',
  }),
  Object.freeze({
    file: 'electron/ipc/timeline.cjs', from: 3, to: 23, lines: 21,
    disposition: 'REDUCE — cut the four-bullet MARKERS/FLASHBACK/DIFF/RESTORE list that restates four '
      + 'exported names, keep the SAFETY paragraph and anchor it with a Section 137.2 pointer',
  }),
]);

/**
 * D7 / finding 16, recorded as data rather than as an intention. Measured: both of `selfRepair.cjs`'s
 * blocks over 20 lines are ALREADY ANCHORED, so no rule forces a move. It is limited to banner
 * reduction and `@param` restatement removal and removed from the move list.
 */
const LIMITED_TO_BANNER_AND_PARAMS = Object.freeze([
  Object.freeze({
    file: 'electron/lib/selfRepair.cjs',
    why: 'both of its long blocks (3-40 and 80-119) are already anchored, so no rule forces a move; '
      + 'a fabricated disposition would be worse than none',
    keeps: Object.freeze([':25 — 745 packages with EXACT versions (K1)',
      ':83 — DO NOT CALL Module._initPaths() HERE (K3)']),
  }),
]);

// ─── The three change-detectors, behind --pass-audit (D4 / finding 13) ────────

/**
 * `sha256(codeView(src))` per tranche file, frozen at the point the baselines were frozen. THIS is the
 * digest that SHOULD be stable across a comment-only pass, and it reddens the moment the pass touches
 * code. Raw byte digests would be falsified by the pass itself, which is why they are not used.
 */
const CODEVIEW_DIGESTS = Object.freeze({
  'electron/lib/autonomyGate.cjs': '8f318c7707fa2689d848a77456b71243d75219894b8af79a3eff3adb74ca15f5',
  'electron/lib/upgradeApplier.cjs': '8635a72769ab3080ee1a906b375bdc0293dc7ce18d01459f9b9073b68673b02a',
  'scripts/verifyUpgradeApplier.cjs': '617bfa090083473a954a9b07b6498daa0f999d1d9dbde878c5d5e3e385ec1d71',
  'electron/lib/autonomyPolicy.cjs': '9738ce98636e1b1870ce01b9870d173ab64cc3620751b0317bd4778b3effbfca',
  'electron/lib/autonomyStop.cjs': '36dc8ffd3be0b02ada0e0bfaffb3ab1066c55f7bd2983e337716cc9c242aecd9',
  'electron/lib/selfRepair.cjs': '5c2759fc8e9dd3eba0a5f3ea3794fcf4372aa305938406b29b39594920e74d31',
  'electron/ipc/aiProcess.cjs': '769ecde84f24dc966740ad7968b6cf3903fba38086dfc5fd61f365c94bb55ab7',
  'electron/lib/startupDoctor.cjs': '1931080189f86d335c60df3c0634d31fd124fb2e43726dba3228dd52acfbe1d0',
  'scripts/verifyAutonomyStop.cjs': 'e9ebe64ffb5ca4ff7a73ba8b1b4a0b79c84872544630e8b3595c20c4f98e0043',
  'electron/lib/dependencyAdvisor.cjs': '915363560496fab150e0d216bf62f37cf69eda9198f3a9d24a51029f1e59f4b8',
  'electron/ipc/timeline.cjs': 'a59fcd7bf17167ac0a5eff28be2b5627907b4eae94d8a2f30ead9a121faf66d3',
  'scripts/verifyEngineDiagnosis.cjs': '2ccee0db349469740922c0406053d51545c08a2f7787fba6d45d57f187165f8c',
});

/**
 * The frozen tails. ONE added assertion in any of these — an additive act I11 positively encourages —
 * reddens the row for a reason that has nothing to do with what this suite guards, which is exactly
 * why it is a pass-time instrument and not a standing gate.
 */
const SUITE_TAILS = Object.freeze({
  'scripts/verifyAutonomyStop.cjs': '197 passed, 0 failed',
  'scripts/verifyUpgradeApplier.cjs': '483 passed, 0 failed',
  'scripts/verifyEngineDiagnosis.cjs': '34 passed, 0 failed',
});

// ─── The scanner ──────────────────────────────────────────────────────────────

const WORD = /[A-Za-z0-9_$]/;
const SPACE = /\s/;
const TRAILING = /[ \t\r]+$/;

/**
 * A `/` here opens a regex literal only in an operand position. These are the characters and the
 * keywords after which an operand is expected; after an identifier, a number, a `)` or a `]` the
 * same character is division.
 */
const REGEX_AFTER_CHAR = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '/']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await', 'throw']);

/** Where does the quote opened at `from` close on this line? -1 when it does not. */
function closesOnLine(chars, from, quote) {
  for (let k = from + 1; k < chars.length; k += 1) {
    if (chars[k] === '\n') return -1;
    if (chars[k] === '\\') { k += 1; continue; }
    if (chars[k] === quote) return k;
  }
  return -1;
}

/**
 * The last significant character before `from`, skipping whitespace and anything already blanked,
 * plus the identifier it belongs to. Computed on demand rather than tracked, because a tracked
 * "previous token" is one more piece of state that can disagree with the text.
 */
function prevSignificant(chars, blank, from) {
  let k = from - 1;
  while (k >= 0 && (blank[k] || SPACE.test(chars[k]))) k -= 1;
  if (k < 0) return { ch: '', word: '' };
  const ch = chars[k];
  if (!WORD.test(ch)) return { ch, word: '' };
  const end = k;
  while (k >= 0 && !blank[k] && WORD.test(chars[k])) k -= 1;
  return { ch, word: chars.slice(k + 1, end + 1).join('') };
}

function regexAllowed(prev) {
  if (prev.ch === '') return true;
  if (WORD.test(prev.ch)) return REGEX_AFTER_WORD.has(prev.word);
  return REGEX_AFTER_CHAR.has(prev.ch);
}

/**
 * The index just past the regex literal opened at `from`, or -1 when it does not close on this line.
 * `[` ... `]` is tracked because an unescaped `/` is legal inside a character class.
 */
function endOfRegex(chars, from) {
  let k = from + 1;
  let inClass = false;
  let closed = false;
  while (k < chars.length) {
    const c = chars[k];
    if (c === '\n') break;
    if (c === '\\') { k += 2; continue; }
    if (inClass) { if (c === ']') inClass = false; k += 1; continue; }
    if (c === '[') { inClass = true; k += 1; continue; }
    if (c === '/') { k += 1; closed = true; break; }
    k += 1;
  }
  if (!closed) return -1;
  while (k < chars.length && WORD.test(chars[k])) k += 1;
  return k;
}

/**
 * The file with comment TEXT removed and everything else — string contents included — intact.
 *
 * Each line is right-trimmed and blank lines are dropped, so removing a whole comment line does not
 * shift the view and a digest over it is stable against pure comment edits.
 *
 * @param {string} src
 * @returns {string}
 */
function codeView(src) {
  const chars = String(src === undefined || src === null ? '' : src).split('');
  const n = chars.length;
  const blank = new Array(n).fill(false);
  /** 'tmpl' for template literal text; a number for the brace depth inside a `${ }` substitution. */
  const stack = [];
  let i = 0;

  const inTemplateText = () => stack.length > 0 && stack[stack.length - 1] === 'tmpl';

  while (i < n) {
    const c = chars[i];
    const d = i + 1 < n ? chars[i + 1] : '';

    if (inTemplateText()) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i += 1; continue; }
      if (c === '$' && d === '{') { stack.push(0); i += 2; continue; }
      i += 1;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < n && chars[i] !== '\n') { blank[i] = true; i += 1; }
      continue;
    }

    if (c === '/' && d === '*') {
      blank[i] = true;
      blank[i + 1] = true;
      i += 2;
      while (i < n) {
        if (chars[i] === '*' && chars[i + 1] === '/') {
          blank[i] = true;
          blank[i + 1] = true;
          i += 2;
          break;
        }
        if (chars[i] !== '\n') blank[i] = true;   // the newline survives, so lines still line up
        i += 1;
      }
      continue;
    }

    if (c === '`') { stack.push('tmpl'); i += 1; continue; }

    if (c === "'" || c === '"') {
      const close = closesOnLine(chars, i, c);
      // UNPAIRED ON THIS LINE => NOT A STRING (the `views()` rule).
      if (close === -1) { i += 1; continue; }
      i = close + 1;
      continue;
    }

    if (c === '/' && regexAllowed(prevSignificant(chars, blank, i))) {
      const end = endOfRegex(chars, i);
      if (end !== -1) { i = end; continue; }
      i += 1;
      continue;
    }

    if (stack.length > 0 && typeof stack[stack.length - 1] === 'number') {
      if (c === '{') stack[stack.length - 1] += 1;
      else if (c === '}') {
        if (stack[stack.length - 1] === 0) stack.pop();          // back into the template text
        else stack[stack.length - 1] -= 1;
      }
    }

    i += 1;
  }

  const kept = new Array(n);
  for (let k = 0; k < n; k += 1) kept[k] = blank[k] ? ' ' : chars[k];

  const lines = kept.join('').split('\n');
  const out = [];
  for (const line of lines) {
    const trimmed = line.replace(TRAILING, '');
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out.join('\n');
}

// ─── The declared corpus (finding 17) ─────────────────────────────────────────

const CODEVIEW_CASES = Object.freeze([
  Object.freeze({
    id: 'slash-slash-inside-a-string',
    why: 'a URL is not a comment',
    src: "const u = 'http://example.com/a';\nconst v = 1; // tail",
    expect: "const u = 'http://example.com/a';\nconst v = 1;",
  }),
  Object.freeze({
    id: 'slash-star-inside-a-string',
    why: 'both block delimiters are legal string content',
    src: "const open = '/*';\nconst close = \"*/\";\nconst a = 1;",
    expect: "const open = '/*';\nconst close = \"*/\";\nconst a = 1;",
  }),
  Object.freeze({
    id: 'regex-literal-with-slash-and-star',
    why: 'the one rule views() does not have',
    src: 'const re = /a*\\/b/;\nconst cls = /[/*]/.source;\nconst n = 6 / 2;',
    expect: 'const re = /a*\\/b/;\nconst cls = /[/*]/.source;\nconst n = 6 / 2;',
  }),
  Object.freeze({
    id: 'template-literal',
    why: 'a substitution returns to code and the text after it returns to string content',
    src: 'const t = `a // b ${x} /* c */`;',
    expect: 'const t = `a // b ${x} /* c */`;',
  }),
  Object.freeze({
    id: 'apostrophe-inside-a-comment',
    why: 'the quote must not outlive the comment that held it',
    src: "// master's words\nconst a = 1;",
    expect: 'const a = 1;',
  }),
  Object.freeze({
    id: 'multi-line-comment',
    why: 'a whole narrative block leaves nothing behind',
    src: '/*\n * narrative\n */\nconst a = 1;',
    expect: 'const a = 1;',
  }),
  Object.freeze({
    id: 'crlf',
    why: 'the carriage return is trailing whitespace, not content',
    src: 'const a = 1; // x\r\nconst b = 2;\r\n',
    expect: 'const a = 1;\nconst b = 2;',
  }),
  Object.freeze({
    id: 'inline-block-comment-keeps-the-offsets',
    why: 'blanking in place is what keeps a column offset meaning the same thing',
    src: 'const a = f(/* why */ 1);',
    expect: `const a = f(${' '.repeat(9)} 1);`,
  }),
  Object.freeze({
    id: 'unpaired-quote-is-not-a-string',
    why: 'without this rule the apostrophe swallows the next line and its comment survives',
    src: "const el = <p>master's words</p>;\nconst a = 1; // tail",
    expect: "const el = <p>master's words</p>;\nconst a = 1;",
  }),
  Object.freeze({
    id: 'comment-only-source',
    why: 'nothing left is the empty string, not a blank line',
    src: '// a\n/* b */\n',
    expect: '',
  }),
]);

/**
 * Every assertion carries the mutation that would turn it red, and each one below was DRIVEN red by
 * exactly that mutation and restored (recorded in spec Sections 137.3 and 137.7). A label with no
 * entry FAILs.
 */
const REDBY = Object.freeze([
  Object.freeze({
    prefix: 'codeView case ',
    redby: "change that case's `expect` by one character — `6 / 2` to `6 / 3` on the regex case reddens it alone",
  }),
  Object.freeze({
    prefix: 'codeView is idempotent on ',
    redby: 'drop blank lines BEFORE right-trimming instead of after, so a stripped comment line leaves '
      + 'an empty line in the view that a second pass then removes (12 of 12 files redden)',
  }),
  Object.freeze({
    prefix: 'codeView strips ',
    redby: 'return `src` unchanged from codeView',
  }),
  Object.freeze({
    prefix: 'codeView keeps ',
    redby: 'blank the characters between the quotes, which is the views().code behaviour',
  }),
  Object.freeze({
    prefix: 'the tokeniser uses no ',
    redby: 'add a regex literal containing a negated class that spans a structure',
  }),
  Object.freeze({
    prefix: 'REDBY ',
    redby: 'add an assertion whose label matches no declared prefix',
  }),

  // ── FEAT-004: the counters, the rules and the detectors ───────────────────
  Object.freeze({
    prefix: 'baseline: ',
    redby: 'set BASELINE equal to a live count instead of the frozen measurement, or drop a file from '
      + 'PRE_PASS / PRE_KEEP / PRE_PASS_BANNER so the three tables stop covering the same twelve files',
  }),
  Object.freeze({
    prefix: 'ceiling: ',
    redby: 'ADD a comment line to any tranche file — the ceiling is the half that makes concision '
      + 'measurable, and it is the only counter a growing file reddens',
  }),
  Object.freeze({
    prefix: 'floor: ',
    redby: 'delete one Section N line, one evidence word or one trap marker from any tranche file — '
      + 'this is the half that reddens on THIS pass rather than only on later ones',
  }),
  Object.freeze({
    prefix: 'banner: ',
    redby: 'add a banner line to any tranche file',
  }),
  Object.freeze({
    prefix: 'zero floor: ',
    redby: 'leave a zero in PRE_KEEP unnamed in ZERO_FLOORS, or name a counter there that is not '
      + 'actually zero — a zero floor constrains nothing, so what binds the file has to be stated',
  }),
  Object.freeze({
    prefix: 'pointer resolves: ',
    redby: "change a tranche pointer token to 'Section 999'",
  }),
  Object.freeze({
    prefix: 'block threshold: ',
    redby: 'strip the provenance token out of any comment block over 20 lines, which adds a block to '
      + 'the live unanchored set that the declared set does not contain',
  }),
  Object.freeze({
    prefix: 'disposition: ',
    redby: 'declare a disposition of DELETE, or point one at a block whose measured length is not what '
      + 'it claims',
  }),
  Object.freeze({
    prefix: 'threshold reason: ',
    redby: "lower BLOCK_THRESHOLD below 14 — dependencyAdvisor.cjs's anchored 14-line header would "
      + 'then be judged by a rule the file the posture is copied from cannot satisfy unedited',
  }),
  Object.freeze({
    prefix: 'pass-audit is off ',
    redby: 'run one of the three detectors unconditionally, which is what turns a pass-time instrument '
      + 'into a standing gate that reddens on lawful edits',
  }),
  Object.freeze({
    prefix: 'digest: ',
    redby: 'change one NON-comment byte in that tranche file — a comment-only edit must NOT move it',
  }),
  Object.freeze({
    prefix: 'suite tail: ',
    redby: 'add or remove one assertion in that suite',
  }),
  Object.freeze({
    prefix: 'comment-only: ',
    redby: 'change one non-comment byte in that tranche file, so its codeView stops matching the base ref',
  }),
  Object.freeze({
    prefix: 'skip: ',
    redby: 'let an unavailable ref print PASS instead of SKIP, or stop counting skips separately — a '
      + 'silently-not-run check is the shape of a green suite that proves nothing',
  }),
  Object.freeze({
    prefix: 'census: ',
    redby: 'widen the banner class to the box-drawing block (1,304 becomes 1,398), or make the spec '
      + 'pointer case-sensitive (501 becomes 496)',
  }),
]);

// ─── Measurement ──────────────────────────────────────────────────────────────

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Lines with CRLF folded and a single trailing newline dropped, so a count is a count. */
function linesOf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

/** The six patterns applied to one file's lines. Comment lines only, as published. */
function countLines(lines) {
  const c = { lines: lines.length, comment: 0, banner: 0, jsdoc: 0, pointer: 0, evidence: 0, trap: 0 };
  for (const line of lines) {
    if (!COMMENT_LINE.test(line)) continue;
    c.comment += 1;
    if (BANNER_LINE.test(line)) c.banner += 1;
    if (JSDOC_TAG.test(line)) c.jsdoc += 1;
    if (SPEC_POINTER.test(line)) c.pointer += 1;
    if (EVIDENCE_WORD.test(line)) c.evidence += 1;
    if (TRAP_MARKER.test(line)) c.trap += 1;
  }
  return c;
}

/** Contiguous runs of comment lines, as 1-based inclusive ranges. */
function commentBlocks(lines) {
  const blocks = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i += 1) {
    const isComment = i < lines.length && COMMENT_LINE.test(lines[i]);
    if (isComment && start === -1) start = i;
    if (!isComment && start !== -1) {
      blocks.push({ from: start + 1, to: i, lines: i - start });
      start = -1;
    }
  }
  return blocks;
}

const isAnchored = (body) => PROVENANCE_TOKENS.some((re) => re.test(body));

/** Every `section N` / `section N.M` token in a file's COMMENT lines. */
function pointerTokens(lines) {
  const found = [];
  for (const [i, line] of lines.entries()) {
    if (!COMMENT_LINE.test(line)) continue;
    const re = /section (\d+(?:\.\d+)?)/gi;
    let m = re.exec(line);
    while (m) { found.push({ token: m[1], line: i + 1 }); m = re.exec(line); }
  }
  return found;
}

// ─── The suite ────────────────────────────────────────────────────────────────

function main(argv = []) {
  const passAudit = argv.includes('--pass-audit');
  const requireCommentOnly = argv.includes('--require-comment-only');
  const refAt = argv.indexOf('--comment-only');
  const ref = refAt !== -1 && argv[refAt + 1] ? argv[refAt + 1] : BASE_REF;

  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const emitted = [];
  let skipWasFatal = false;

  function check(label, ok, detail) {
    emitted.push(label);
    if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
    else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
  }

  /** A SKIP is LOUD, counted separately, and is NEVER a PASS. */
  function skip(label, why) {
    emitted.push(label);
    skipped += 1;
    console.log(`  SKIP  ${label} - ${why}`);
    if (requireCommentOnly) skipWasFatal = true;
  }

  console.log('\ncomment census — two counters, moving in opposite directions'
    + `${passAudit ? '  [--pass-audit]' : '  [chain mode]'}\n`);

  // ── codeView: the corpus and both halves of the semantics ──────────────────
  console.log('  the declared corpus');
  for (const c of CODEVIEW_CASES) {
    const got = codeView(c.src);
    check(`codeView case ${c.id} (${c.why})`, got === c.expect,
      `expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  }

  console.log('\n  idempotence over the tranche');
  const source = new Map();
  for (const rel of TRANCHE_FILES) {
    let src = null;
    try { src = fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (e) { check(`codeView is idempotent on ${rel}`, false, `unreadable: ${e.message}`); }
    if (src === null) continue;
    source.set(rel, src);
    const once = codeView(src);
    check(`codeView is idempotent on ${rel}`, once === codeView(once),
      `${once.length} chars became ${codeView(once).length}`);
  }

  console.log('\n  both halves of the semantics, on one real file');
  {
    const rel = 'electron/lib/dependencyAdvisor.cjs';
    const view = codeView(source.get(rel) || '');
    check(`codeView strips comment text from ${rel}`,
      !view.includes('THE MOST TEMPTING DISHONESTY'),
      'a comment phrase survived into the code view');
    check(`codeView keeps string contents in ${rel}`,
      view.includes("'electron-builder'"),
      'a string literal was blanked, which is the views().code behaviour this must not copy');
  }

  console.log('\n  R3, applied to the tokeniser itself');
  {
    // Assembled from pieces: codeView keeps string contents, so a needle written whole would be
    // found in this very line and the row would fail on a correct file.
    const forbidden = [
      ['brace', `[${'^'}}]`],
      ['paren', `[${'^'})]`],
      ['bracket', `[${'^'}\\]]`],
    ];
    const ownView = codeView(fs.readFileSync(__filename, 'utf8'));
    for (const [name, needle] of forbidden) {
      check(`the tokeniser uses no ${name} negated class`, !ownView.includes(needle),
        `${JSON.stringify(needle)} spans a structure and is the R1/R3 vacuity class`);
    }
  }

  // ── The baselines cover the same twelve files, and are frozen ──────────────
  console.log('\n  the frozen baselines');
  {
    const tables = [['PRE_PASS', PRE_PASS], ['PRE_KEEP', PRE_KEEP], ['PRE_PASS_BANNER', PRE_PASS_BANNER],
      ['CODEVIEW_DIGESTS', CODEVIEW_DIGESTS]];
    for (const [name, table] of tables) {
      const keys = Object.keys(table);
      const missing = TRANCHE_FILES.filter((f) => !own(table, f));
      const extra = keys.filter((k) => !TRANCHE_FILES.includes(k));
      check(`baseline: ${name} covers exactly the twelve tranche files`,
        Object.isFrozen(table) && missing.length === 0 && extra.length === 0,
        `frozen=${Object.isFrozen(table)} missing=${missing.join(', ') || 'none'} extra=${extra.join(', ') || 'none'}`);
    }
    check('baseline: the declared tranche totals equal the sum of the per-file tables',
      TRANCHE_FILES.reduce((n, f) => n + PRE_PASS[f], 0) === TRANCHE_TOTALS.comment
      && TRANCHE_FILES.reduce((n, f) => n + PRE_PASS_BANNER[f], 0) === TRANCHE_TOTALS.banner
      && KEEP_COUNTERS.every((c) => TRANCHE_FILES.reduce((n, f) => n + PRE_KEEP[f][c], 0) === TRANCHE_TOTALS[c])
      && TRANCHE_FILES.length === TRANCHE_TOTALS.files,
      'a per-file table and the published total disagree, so one of them is wrong');
  }

  // ── The live census, and the two opposed counters ──────────────────────────
  console.log('\n  the live census, per file  (comment <= ceiling, keep counters >= floor)');
  const live = new Map();
  const totals = { files: 0, lines: 0, comment: 0, banner: 0, jsdoc: 0, pointer: 0, evidence: 0, trap: 0 };
  for (const rel of TRANCHE_FILES) {
    const c = countLines(linesOf(source.get(rel) || ''));
    live.set(rel, c);
    totals.files += 1;
    for (const k of ['lines', 'comment', 'banner', 'jsdoc', 'pointer', 'evidence', 'trap']) totals[k] += c[k];
    console.log(`    ${rel.padEnd(36)} lines ${String(c.lines).padStart(4)}`
      + `  comment ${String(c.comment).padStart(4)}/${String(PRE_PASS[rel]).padEnd(4)}`
      + `  banner ${String(c.banner).padStart(3)}/${String(PRE_PASS_BANNER[rel]).padEnd(3)}`
      + `  ptr ${c.pointer}/${PRE_KEEP[rel].pointer}`
      + `  ev ${c.evidence}/${PRE_KEEP[rel].evidence}`
      + `  trap ${c.trap}/${PRE_KEEP[rel].trap}`);
  }

  console.log('');
  for (const rel of TRANCHE_FILES) {
    const c = live.get(rel);
    check(`ceiling: ${rel} comment lines ${c.comment} <= ${PRE_PASS[rel]}`,
      c.comment <= PRE_PASS[rel], `grew by ${c.comment - PRE_PASS[rel]}`);
  }
  console.log('');
  for (const rel of TRANCHE_FILES) {
    for (const counter of KEEP_COUNTERS) {
      const floor = PRE_KEEP[rel][counter];
      check(`floor: ${rel} ${counter} ${live.get(rel)[counter]} >= ${floor}`,
        live.get(rel)[counter] >= floor,
        `reasoning went down by ${floor - live.get(rel)[counter]} — MOVE it to the spec behind a pointer, never delete it`);
    }
  }
  console.log('');
  for (const rel of TRANCHE_FILES) {
    check(`banner: ${rel} banner lines ${live.get(rel).banner} <= ${PRE_PASS_BANNER[rel]}`,
      live.get(rel).banner <= PRE_PASS_BANNER[rel],
      `grew by ${live.get(rel).banner - PRE_PASS_BANNER[rel]}`);
  }

  // ── The zero floors, named as zero ────────────────────────────────────────
  console.log('\n  the zero floors, named rather than hidden');
  {
    const declared = new Map();
    for (const z of ZERO_FLOORS) for (const c of z.counters) declared.set(`${z.file}|${c}`, z);
    const actualZeros = [];
    for (const rel of TRANCHE_FILES) {
      for (const counter of KEEP_COUNTERS) if (PRE_KEEP[rel][counter] === 0) actualZeros.push(`${rel}|${counter}`);
    }
    const unnamed = actualZeros.filter((k) => !declared.has(k));
    const wrong = [...declared.keys()].filter((k) => !actualZeros.includes(k));
    check('zero floor: every zero in PRE_KEEP is named in ZERO_FLOORS, and every entry there is really zero',
      unnamed.length === 0 && wrong.length === 0,
      `unnamed: ${unnamed.join(', ') || 'none'} / not actually zero: ${wrong.join(', ') || 'none'}`);
    for (const z of ZERO_FLOORS) {
      console.log(`    ${z.file} \u00b7 zero on ${z.counters.join(', ')}`);
      console.log(`        bound instead by ${z.boundBy}`);
    }
  }

  // ── Every pointer resolves to a heading that exists ───────────────────────
  console.log('\n  every spec pointer in the tranche resolves');
  {
    let spec = '';
    try { spec = fs.readFileSync(path.join(ROOT, SPEC), 'utf8').replace(/\r\n/g, '\n'); }
    catch (e) { spec = ''; }
    const sections = new Set((spec.match(/^## SECTION (\d+)/gm) || []).map((m) => m.replace('## SECTION ', '')));
    const subs = new Set((spec.match(/^### (\d+)\.(\d+)/gm) || []).map((m) => m.replace('### ', '')));
    check('pointer resolves: the spec was readable and its headings were found',
      sections.size > 0 && subs.size > 0, `${sections.size} sections, ${subs.size} sub-sections`);

    const sites = new Map();
    for (const rel of TRANCHE_FILES) {
      for (const t of pointerTokens(linesOf(source.get(rel) || ''))) {
        if (!sites.has(t.token)) sites.set(t.token, []);
        sites.get(t.token).push(`${rel}:${t.line}`);
      }
    }
    const ordered = [...sites.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
    for (const token of ordered) {
      const resolves = token.includes('.') ? subs.has(token) : sections.has(token);
      check(`pointer resolves: Section ${token} names a heading that exists (${sites.get(token).length} site${sites.get(token).length === 1 ? '' : 's'})`,
        resolves, `no "## SECTION ${token}" or "### ${token}" heading — cited at ${sites.get(token).slice(0, 3).join(', ')}`);
    }
    console.log(`    ${ordered.length} distinct tokens: ${ordered.map((t) => `Section ${t}`).join(', ')}`);
  }

  // ── The block-threshold rule ──────────────────────────────────────────────
  console.log(`\n  every comment block over ${BLOCK_THRESHOLD} lines carries a provenance token`);
  {
    const liveUnanchored = [];
    let over = 0;
    for (const rel of TRANCHE_FILES) {
      const lines = linesOf(source.get(rel) || '');
      for (const b of commentBlocks(lines)) {
        if (b.lines <= BLOCK_THRESHOLD) continue;
        over += 1;
        if (!isAnchored(lines.slice(b.from - 1, b.to).join('\n'))) {
          liveUnanchored.push({ file: rel, from: b.from, to: b.to, lines: b.lines });
        }
      }
    }
    const key = (b) => `${b.file} ${b.from}-${b.to}`;
    const declaredKeys = new Set(UNANCHORED_AT_FREEZE.map(key));
    const unexpected = liveUnanchored.filter((b) => !declaredKeys.has(key(b)));

    console.log(`    ${over} blocks over ${BLOCK_THRESHOLD} lines, ${liveUnanchored.length} of them unanchored`);
    for (const b of liveUnanchored) console.log(`      ${key(b)} (${b.lines} lines)`);

    // CHAIN ROW: a subset. A NEW unanchored long block reddens it; resolving a declared one does not.
    check('block threshold: no comment block over the threshold is unanchored beyond the three declared at the freeze',
      unexpected.length === 0,
      `undeclared unanchored blocks: ${unexpected.map((b) => `${key(b)} (${b.lines} lines)`).join(', ')}`);

    check('disposition: each declared block has a measured length and a disposition that is not DELETE',
      UNANCHORED_AT_FREEZE.length === 3
      && UNANCHORED_AT_FREEZE.every((d) => d.lines === d.to - d.from + 1
        && d.disposition.length > 0 && !/^DELETE/.test(d.disposition)),
      UNANCHORED_AT_FREEZE.map((d) => `${key(d)} -> ${d.disposition.slice(0, 24)}`).join(' | '));
    for (const d of UNANCHORED_AT_FREEZE) {
      console.log(`    ${key(d)} (${d.lines} lines)`);
      console.log(`        ${d.disposition}`);
    }

    // The threshold's MEASURED reason, asserted rather than asserted-about.
    const refRel = 'electron/lib/dependencyAdvisor.cjs';
    const refLines = linesOf(source.get(refRel) || '');
    const refBlocks = commentBlocks(refLines);
    const header = refBlocks[0];
    check(`threshold reason: ${refRel}'s header is a ${header ? header.lines : 0}-line anchored block and the file has none over ${BLOCK_THRESHOLD}`,
      !!header && header.lines === 14 && header.lines <= BLOCK_THRESHOLD
      && isAnchored(refLines.slice(header.from - 1, header.to).join('\n'))
      && refBlocks.every((b) => b.lines <= BLOCK_THRESHOLD),
      `header ${header ? `${header.from}-${header.to} (${header.lines} lines)` : 'absent'}; `
      + `largest block ${Math.max(...refBlocks.map((b) => b.lines))} — the reference case must pass unedited`);

    check('disposition: selfRepair.cjs is limited to banner and @param work because both its long blocks are already anchored',
      LIMITED_TO_BANNER_AND_PARAMS.length === 1
      && (() => {
        const rel = LIMITED_TO_BANNER_AND_PARAMS[0].file;
        const lines = linesOf(source.get(rel) || '');
        const long = commentBlocks(lines).filter((b) => b.lines > BLOCK_THRESHOLD);
        return long.length === 2
          && long.every((b) => isAnchored(lines.slice(b.from - 1, b.to).join('\n')))
          && !UNANCHORED_AT_FREEZE.some((d) => d.file === rel);
      })(),
      'its long blocks are not both anchored, so D7\u2019s measured reason no longer holds');
  }

  // ── The published census, reproduced ──────────────────────────────────────
  console.log('\n  the published census, reproduced');
  {
    const line = `tranche: ${TRANCHE_TOTALS.files} files \u00b7 ${thousands(totals.lines)} lines`
      + ` \u00b7 ${thousands(totals.comment)} comment \u00b7 ${totals.banner} banner`
      + ` \u00b7 ${totals.pointer} pointer \u00b7 ${totals.evidence} evidence \u00b7 ${totals.trap} trap`;
    console.log(`    ${line}`);
    // MEASURED AT THE BASE REF, NOT IN THE WORKING TREE, and the distinction is the whole point.
    //
    // This row exists to prove the six published patterns still reproduce the published figures — its
    // REDBY is widening the banner class or making the pointer case-sensitive. Measured against the
    // LIVE tree it proved something else entirely: that no comment had moved yet. So it could only
    // ever pass BEFORE the pass it was written to accompany, and the pass itself reddened it
    // (1,654 comment / 85 banner against the frozen 1,667 / 121 after five of twelve files).
    //
    // The cheapest escape from that red was to re-freeze TRANCHE_TOTALS to whatever the pass had
    // left — which is exactly the practice this file's own header condemns in the floors: a baseline
    // recorded after the pass records the pass's own output and can no longer redden. A row whose
    // easiest satisfaction is the wrong act is not a safeguard.
    //
    // The base ref is immutable, so counting there is stable against any lawful pass, partial or
    // complete, while still failing the instant a pattern changes. The live totals stay on the
    // printed line above, where a reader can watch the pass move them. An unavailable ref SKIPs
    // loudly and is never a PASS.
    {
      const label = 'census: the published patterns reproduce the published totals at ' + BASE_REF;
      let usable = true;
      try { execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${BASE_REF}^{commit}`], { encoding: 'utf8', stdio: 'pipe' }); }
      catch (e) { usable = false; }
      if (!usable) skip(label, `git could not verify the base ref "${BASE_REF}"`);
      else {
        const base = { files: 0, lines: 0, comment: 0, banner: 0, pointer: 0, evidence: 0, trap: 0 };
        let unreadable = '';
        for (const rel of TRANCHE_FILES) {
          let text = null;
          try { text = execFileSync('git', ['-C', ROOT, 'show', `${BASE_REF}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28 }); }
          catch (e) { unreadable = rel; break; }
          const c = countLines(linesOf(text));
          base.files += 1;
          for (const k of ['lines', 'comment', 'banner', 'pointer', 'evidence', 'trap']) base[k] += c[k];
        }
        if (unreadable) skip(label, `"${unreadable}" is not in ${BASE_REF}`);
        else {
          check(label,
            base.files === TRANCHE_TOTALS.files && base.lines === TRANCHE_TOTALS.lines
            && base.comment === TRANCHE_TOTALS.comment && base.banner === TRANCHE_TOTALS.banner
            && base.pointer === TRANCHE_TOTALS.pointer && base.evidence === TRANCHE_TOTALS.evidence
            && base.trap === TRANCHE_TOTALS.trap,
            `measured ${JSON.stringify(base)} at ${BASE_REF} against the published ${JSON.stringify(TRANCHE_TOTALS)}`);
        }
      }
    }

    // The two pattern corrections, asserted on real text rather than described.
    const banner = '// \u2500\u2500\u2500\u2500\u2500\u2500 label';
    const wide = '// \u2554\u2554\u2554\u2554\u2554\u2554 label';
    check('census: the banner class is the exact three characters, so the wide box-drawing block does not match',
      BANNER_LINE.test(banner) && !BANNER_LINE.test(wide),
      'widening the class measures 1,398 repo-wide rather than 1,304');
    check('census: the spec pointer is case-insensitive, which is the 501-versus-496 correction',
      SPEC_POINTER.test('// see SECTION 137') && SPEC_POINTER.test('// see Section 137')
      && SPEC_POINTER.test('// see section 137'),
      'a case-sensitive pointer measures 496 where the published figure is 501');
  }

  // ── The three change-detectors (D4 / finding 13) ──────────────────────────
  if (!passAudit) {
    console.log('\n  the three change-detectors are OFF in chain mode');
    console.log('    --pass-audit turns on: the twelve codeView digests, the frozen suite tails,');
    console.log(`    and the comment-only comparison against ${BASE_REF}.`);
    console.log('    They redden on any LAWFUL edit, and the cheapest escape from such a red is');
    console.log('    deleting the assertion — so they are a pass-time instrument, not a standing gate.');
    // Asserted over what this run ACTUALLY EMITTED, not over the flag that chose this branch. The
    // obvious form — `check(..., !passAudit)` inside `if (!passAudit)` — is a tautology: both sides
    // come from the same variable, so no mutation of the suite could redden it. Moving any detector
    // loop out of the `--pass-audit` branch reddens this.
    const detectorPrefixes = ['digest: ', 'suite tail: ', 'comment-only: '];
    const leaked = emitted.filter((l) => detectorPrefixes.some((p) => l.startsWith(p)));
    check('pass-audit is off unless asked for — chain mode emitted no detector row',
      leaked.length === 0, `these ran without --pass-audit: ${leaked.join(' | ')}`);
  } else {
    console.log('\n  --pass-audit 1 of 3: the twelve codeView digests');
    for (const rel of TRANCHE_FILES) {
      const got = sha256(codeView(source.get(rel) || ''));
      check(`digest: ${rel}`, got === CODEVIEW_DIGESTS[rel],
        `measured ${got.slice(0, 16)}… against frozen ${String(CODEVIEW_DIGESTS[rel]).slice(0, 16)}… — a comment-only edit must not move this`);
    }

    console.log('\n  --pass-audit 2 of 3: the frozen suite tails');
    for (const [rel, tail] of Object.entries(SUITE_TAILS)) {
      let out = '';
      let code = 0;
      try { out = execFileSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8' }); }
      catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status === undefined ? 1 : e.status; }
      const got = ((out.match(/^ {2}\d+ passed, \d+ failed$/m) || [''])[0] || '').trim();
      check(`suite tail: ${rel} exits 0 and reports "${tail}"`, code === 0 && got === tail,
        `exit=${code} tail=${JSON.stringify(got)}`);
    }

    console.log(`\n  --pass-audit 3 of 3: comment-only against ${ref}`);
    let refUsable = true;
    let refWhy = '';
    try { execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { refUsable = false; refWhy = `git could not verify the ref "${ref}"`; }
    for (const rel of TRANCHE_FILES) {
      const label = `comment-only: ${rel} differs from ${ref} in comments only`;
      if (!refUsable) { skip(label, refWhy); continue; }
      let base = null;
      try { base = execFileSync('git', ['-C', ROOT, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28 }); }
      catch (e) { skip(label, `"${rel}" is not in ${ref}`); continue; }
      const baseView = codeView(base);
      const liveView = codeView(source.get(rel) || '');
      check(label, baseView === liveView,
        `the code view moved: ${baseView.length} chars at ${ref} against ${liveView.length} live — a NON-comment byte changed`);
    }
    if (!refUsable) {
      console.log(`    ${refWhy} — every comment-only row above is a SKIP, counted separately, and NONE is a PASS`);
      console.log(`    exit stays 0 unless --require-comment-only was passed (it was ${requireCommentOnly ? '' : 'NOT '}passed)`);
    }
    check('skip: an unavailable ref produces SKIP rows that are counted separately and never a PASS',
      refUsable ? skipped === 0 : skipped === TRANCHE_FILES.length,
      `refUsable=${refUsable} skipped=${skipped} of ${TRANCHE_FILES.length}`);
  }

  // ── Every assertion has a recorded mutation ───────────────────────────────
  console.log('\n  every assertion has a recorded mutation');
  {
    const label = 'REDBY covers every label this run emitted';
    const uncovered = [...emitted, label]
      .filter((l) => !REDBY.some((r) => l.startsWith(r.prefix)));
    check(label, uncovered.length === 0, `uncovered: ${uncovered.join(' | ')}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}\n`);
  if (skipped && !skipWasFatal) {
    console.log(`  ${skipped} skipped row${skipped === 1 ? '' : 's'} proved NOTHING. `
      + 'Pass --require-comment-only to make that fatal.\n');
  }
  return fail > 0 || skipWasFatal ? 1 : 0;
}

module.exports = {
  codeView,
  CODEVIEW_CASES,
  TRANCHE_FILES,
  REDBY,
  BASE_REF,
  BLOCK_THRESHOLD,
  PRE_PASS,
  PRE_KEEP,
  PRE_PASS_BANNER,
  PRE_PASS_TOTALS: TRANCHE_TOTALS,
  CODEVIEW_DIGESTS,
  SUITE_TAILS,
  UNANCHORED_AT_FREEZE,
  ZERO_FLOORS,
  countLines,
  commentBlocks,
  linesOf,
  main,
};

// The guard `scripts/auditRenderer.cjs:409` already uses, so verifyRepairContract.cjs can require
// `codeView` without running the census.
if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
