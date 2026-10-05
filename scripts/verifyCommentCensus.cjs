'use strict';

/**
 * verifyCommentCensus.cjs — `codeView`, and the corpus that says what it does (spec Section 137)
 *
 * Five later guarantees are computed THROUGH this one function: the comment-only proof, the
 * no-restatement proof, the twelve code-view digests, the keep-floor counts and the "no list literal
 * is restated in source" assertion. A tokeniser that is wrong in the quiet direction makes all five
 * wrong in the quiet direction, so it ships with a declared corpus rather than with prose.
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
 * Run: node scripts/verifyCommentCensus.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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
 * exactly that mutation and restored (recorded in spec Section 137.3). A label with no entry FAILs.
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
]);

// ─── The suite ────────────────────────────────────────────────────────────────

function main() {
  let pass = 0;
  let fail = 0;
  const emitted = [];

  function check(label, ok, detail) {
    emitted.push(label);
    if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
    else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
  }

  console.log('\ncodeView — comments out, string contents in\n');

  console.log('  the declared corpus');
  for (const c of CODEVIEW_CASES) {
    const got = codeView(c.src);
    check(`codeView case ${c.id} (${c.why})`, got === c.expect,
      `expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  }

  console.log('\n  idempotence over the tranche');
  for (const rel of TRANCHE_FILES) {
    const abs = path.join(ROOT, rel);
    let src = null;
    try { src = fs.readFileSync(abs, 'utf8'); }
    catch (e) { src = null; check(`codeView is idempotent on ${rel}`, false, `unreadable: ${e.message}`); }
    if (src === null) continue;
    const once = codeView(src);
    const twice = codeView(once);
    check(`codeView is idempotent on ${rel}`, once === twice,
      `${once.length} chars became ${twice.length}`);
  }

  console.log('\n  both halves of the semantics, on one real file');
  {
    const rel = 'electron/lib/dependencyAdvisor.cjs';
    const view = codeView(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
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

  console.log('\n  every assertion has a recorded mutation');
  {
    const label = 'REDBY covers every label this run emitted';
    const uncovered = [...emitted, label]
      .filter(l => !REDBY.some(r => l.startsWith(r.prefix)));
    check(label, uncovered.length === 0, `uncovered: ${uncovered.join(' | ')}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  return fail;
}

module.exports = { codeView, CODEVIEW_CASES, TRANCHE_FILES, REDBY };

// The guard `scripts/auditRenderer.cjs:409` already uses, so verifyRepairContract.cjs can require
// `codeView` without running the census.
if (require.main === module) {
  process.exit(main() ? 1 : 0);
}
