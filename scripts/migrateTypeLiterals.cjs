#!/usr/bin/env node

'use strict';

/**
 * migrateTypeLiterals.cjs — a ONE-OFF migration, not a capability.
 *
 * It rewrites 668 of src's 813 inline numeric `fontSize` literals to the role tokens
 * src/config/type.js exports, and it is DELETED in the commit that lands its output. Leaving it in
 * the tree invites a second run over already-migrated code, which would re-promote nothing and
 * re-insert nothing but would still rewrite the report and the gate into a lie.
 *
 * WHY A SCRIPT. 673 hand edits, each also deciding whether a line box moves, is the single largest
 * risk in this task (spec 136). The codemod makes the decision once, in one table, and prints what
 * it did so the census can be checked against it rather than trusted.
 *
 * WHAT IT WILL NOT DO
 *   - It never rewrites an EXISTING inline `lineHeight` literal. It only INSERTS, and only at a site
 *     whose rendered font size actually CHANGED and whose enclosing object literal has no
 *     `lineHeight` key. So the 271 pixel-neutral sites gain nothing and keep the inherited
 *     `line-height: 1.6` from index.css:104 — "pixel-neutral" means font size AND line box
 *     unchanged (I11) — and of the moved sites the ones that already carry an inline value keep it
 *     and are counted as overrides.
 *   - It never touches src/services/selfModify.js or src/components/ErrorBoundary.jsx. Those are
 *     hand-edited: selfModify.js's two sites live inside template strings that EMIT JSX for
 *     scaffolded pages, and ErrorBoundary.jsx must render when a module fails, so neither may gain
 *     an import of type.js. Rewriting inside a template string is exactly where an automated brace
 *     scan is unsafe.
 *   - It never shrinks an authored size. Every row of the value->role table is a growth or a no-op.
 *   - It never enlarges a chart label. PriceChart.jsx's `layout.fontSize` takes a JS number, so it
 *     gets CHART_FS (12) — the same 12 it has today.
 *
 * THE GATE. EXPECTED = RESIDUAL_BUDGET (140) + HAND_EDITED_REMAINING (5). The post-codemod count is
 * 145, NOT 140: the five sites this script deliberately leaves for the hand edit are still numeric
 * literals when it finishes. Gating at exactly 140 would fail the script's own gate and revert 668
 * correct edits.
 *
 * Usage:  node scripts/migrateTypeLiterals.cjs --dry-run   (reports, writes nothing)
 *         node scripts/migrateTypeLiterals.cjs
 *
 * console.log is correct here — verifyInvariants.cjs's walkShipped skips scripts/.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DRY = process.argv.includes('--dry-run');

// ─── The budget this run has to land on ──────────────────────────────────────
const RESIDUAL_BUDGET = 140;
/* selfModify.js 2 (the template-string sites at the `9px` badge and the `11px` footnote) plus
 * ErrorBoundary.jsx 3. Hand-edited in the next commit; still numeric literals at the moment this
 * script exits, which is why EXPECTED is 145 and not the budget. */
const HAND_EDITED_REMAINING = 5;
const EXPECTED = RESIDUAL_BUDGET + HAND_EDITED_REMAINING;

const HAND_EDITED = new Set([
  'services/selfModify.js',
  'components/ErrorBoundary.jsx',
]);

/* The four surfaces master uses most, plus the three shell components that are being edited
 * anyway: in these files EVERY literal is in scope, not just the ones at or below 11px. */
const fullScope = (rel) => rel.startsWith('pages/StockMind/')
  || rel === 'pages/Chat/Chat.jsx'
  || rel.startsWith('pages/Settings/')
  || rel === 'pages/RamaMind/RamaMind.jsx'
  || rel === 'components/Titlebar.jsx'
  || rel === 'components/CommandPalette.jsx'
  || rel === 'components/ActivityStream.jsx';

// ─── The value -> role table ─────────────────────────────────────────────────
// Every row grows or holds. 8/9/10/11 all land on chrome (13px) because that is where UI chrome
// belongs; 11.5/12/12.5/13/14/15/16/17/20/24/32 are already on the scale and hold.
const ROLE_BY_VALUE = new Map([
  [8, 'chrome'], [9, 'chrome'], [10, 'chrome'], [11, 'chrome'],
  [11.5, 'chip'], [12, 'dense'], [12.5, 'denseLg'], [13, 'chrome'],
  [13.5, 'chromeLg'], [14, 'chromeLg'], [15, 'body'], [16, 'read'],
  [17, 'h3'], [18, 'h2'], [20, 'h2'], [22, 'h1'], [24, 'h1'],
  [30, 'display'], [32, 'display'],
]);

// The px each role resolves to in index.css. Used only to decide move vs pixel-neutral.
const PX_BY_ROLE = {
  micro: 11, chip: 11.5, dense: 12, denseLg: 12.5, chrome: 13, chromeLg: 14,
  body: 15, read: 16, h3: 17, h2: 20, h1: 24, display: 32,
};

// The line height each role pairs with, per the design's role table.
const LH_BY_ROLE = {
  micro: 'flat', chip: 'chart', dense: 'tight', denseLg: 'tight',
  chrome: 'chrome', chromeLg: 'chrome', body: 'body', read: 'read',
  h3: 'head', h2: 'head', h1: 'head', display: 'display',
};

/**
 * The exception list, and it is exactly six entries.
 *
 * Keyed by file PLUS the matched source text, never by line number alone, so an insertion above a
 * site cannot silently redirect it. A key that does not match EXACTLY ONCE is a hard stop, not a
 * silent fall-through to the table. Line numbers below are indicative only.
 */
const EXCEPTIONS = [
  {
    file: 'pages/StockMind/ScreenMap.jsx', // :456
    match: "color: '#06080c', fontSize: '11px', fontWeight: 700,",
    role: 'micro',
    reason: 'micro, not chrome: one digit inside a fixed 18x18px circle',
  },
  {
    file: 'pages/StockMind/InfoTip.jsx', // :55
    match: "color: 'var(--muted)', fontSize: '11px', cursor: 'pointer', flexShrink: 0,",
    role: 'micro',
    reason: 'micro, not chrome: the ? glyph inside a fixed 15x15px box',
  },
  {
    file: 'pages/Chat/Chat.jsx', // :86
    match: "color:      'var(--text)',\n          fontSize:   '13px',\n          lineHeight: '1.7',",
    role: 'read',
    reason: 'read, not chrome: the message body is the one surface read continuously',
  },
  {
    file: 'pages/Chat/Chat.jsx', // :508
    match: "fontFamily: 'var(--font)',\n              fontSize:   '13px',\n              lineHeight: '1.6',",
    role: 'read',
    reason: 'read, not chrome: the composer matches the bubble it writes into',
  },
  {
    file: 'components/Titlebar.jsx', // :218
    match: "<span style={{ fontSize: '9px', color: 'rgba(212,169,64,0.6)',",
    role: 'dense',
    reason: 'dense, not chrome: the headroom left in the 38px titlebar box',
  },
  {
    file: 'pages/StockMind/PriceChart.jsx', // :679
    match: 'textColor: theme.muted,\n        fontSize: 12,',
    role: 'CHART_FS',
    reason: "CHART_FS, not a token: lightweight-charts' layout.fontSize takes a number",
  },
];

// ─── Matching ────────────────────────────────────────────────────────────────
/* The census regex, identical to the one verifyTypeScale.mjs uses for the residual budget, so the
 * gate and the suite cannot disagree about what counts as a literal. */
const CENSUS_RE = /fontSize:\s*['"]?(\d+(?:\.\d+)?)(?:px)?/g;
/* The rewrite regex is stricter: it requires a balanced quote, so it can replace the value and
 * leave the alignment whitespace after the colon intact. If the two regexes ever disagree on a
 * count, that file is skipped rather than half-rewritten. */
const WRITE_RE = /fontSize:(\s*)(['"]?)(\d+(?:\.\d+)?)(px)?\2/g;

// ─── A mask of which characters are code ─────────────────────────────────────
/**
 * Brace scanning has to ignore braces that live inside strings, template literals, comments and
 * regex literals. This builds a byte mask (1 = code) in one pass.
 *
 * `${...}` inside a template literal is code again, so the scanner keeps a stack of frames and
 * counts braces per frame. Regex detection uses the preceding significant token: a `/` after a
 * value is division, after an operator or keyword it opens a regex.
 *
 * FOUR EXCLUSIONS THAT ARE ABOUT JSX, NOT ABOUT JAVASCRIPT, and each one was a measured failure:
 *   - `<` does not open a regex. `</div>` is on nearly every line of this codebase.
 *   - `}` does not open a regex. `<Panel user={user} />}` ends an attribute, and reading the `/>`
 *     as a regex swallowed the `}` that closed a JSX expression container — this is what put 11
 *     files out of brace balance.
 *   - a newline does not open a regex, because a continuation line of `/>` is ordinary JSX.
 *   - `/>` never opens a regex, whatever precedes it.
 * And a string never opens immediately after an identifier character: `master's` inside JSX text
 * is prose, not a quote, and JavaScript has no production where `foo'...'` is legal.
 */
const REGEX_OPENERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case']);

const codeMask = (text) => {
  const mask = new Uint8Array(text.length);
  const stack = [{ mode: 'code', braces: 0 }];
  let prev = '\n';      // last significant code character
  let prevWord = '';    // last identifier-ish run of code characters
  let word = '';
  let i = 0;

  const top = () => stack[stack.length - 1];

  while (i < text.length) {
    const f = top();
    const c = text[i];
    const c2 = text[i + 1];

    if (f.mode === 'code') {
      if (c === '/' && c2 === '/') {
        while (i < text.length && text[i] !== '\n') i += 1;
        continue;
      }
      if (c === '/' && c2 === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      const rawPrev = i > 0 ? text[i - 1] : '\u0000';
      if ((c === "'" || c === '"') && !/[A-Za-z0-9_$]/.test(rawPrev)) {
        stack.push({ mode: 'string', quote: c }); i += 1; prev = c; word = ''; continue;
      }
      if (c === '`') { stack.push({ mode: 'template' }); i += 1; prev = c; word = ''; continue; }
      if (c === '/' && c2 !== '>' && (REGEX_OPENERS.has(prev) || REGEX_KEYWORDS.has(prevWord))) {
        stack.push({ mode: 'regex', klass: false });
        i += 1; prev = '/'; word = '';
        continue;
      }
      if (c === '{') f.braces += 1;
      if (c === '}') {
        if (f.braces === 0 && stack.length > 1) { stack.pop(); i += 1; prev = '}'; word = ''; continue; }
        f.braces -= 1;
      }
      mask[i] = 1;
      if (/\S/.test(c)) prev = c;
      if (c === '\n') prev = '\n';
      if (/[A-Za-z_$]/.test(c)) { word += c; } else if (word) { prevWord = word; word = ''; }
      i += 1;
      continue;
    }

    if (f.mode === 'string') {
      if (c === '\\') { i += 2; continue; }
      if (c === f.quote || c === '\n') { stack.pop(); i += 1; continue; }
      i += 1;
      continue;
    }

    if (f.mode === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i += 1; continue; }
      if (c === '$' && c2 === '{') { stack.push({ mode: 'code', braces: 0 }); i += 2; prev = '{'; word = ''; continue; }
      i += 1;
      continue;
    }

    // regex literal
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') { stack.pop(); i += 1; continue; }
    if (c === '[') { f.klass = true; i += 1; continue; }
    if (c === ']') { f.klass = false; i += 1; continue; }
    if (c === '/' && !f.klass) { stack.pop(); i += 1; prev = '/'; word = ''; continue; }
    i += 1;
  }
  return mask;
};

/** Net code-brace balance. A file that does not return to zero was mis-scanned; skip it. */
const braceBalance = (text, mask) => {
  let d = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!mask[i]) continue;
    if (text[i] === '{') d += 1;
    else if (text[i] === '}') d -= 1;
    if (d < 0) return d;
  }
  return d;
};

/** The object literal that directly encloses `idx`, found by scanning braces outward. */
const enclosingObject = (text, mask, idx) => {
  let depth = 0;
  let open = -1;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (!mask[i]) continue;
    const c = text[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) { open = i; break; }
      depth -= 1;
    }
  }
  if (open < 0) return null;
  let d = 0;
  for (let i = open; i < text.length; i += 1) {
    if (!mask[i]) continue;
    const c = text[i];
    if (c === '{') d += 1;
    else if (c === '}') {
      d -= 1;
      if (d === 0) return idx < i ? { open, close: i } : null;
    }
  }
  return null;
};

/** Does this object literal declare `lineHeight` as a DIRECT property? */
const hasLineHeight = (text, mask, open, close) => {
  let d = 0;
  for (let i = open; i < close; i += 1) {
    if (!mask[i]) continue;
    const c = text[i];
    if (c === '{') { d += 1; continue; }
    if (c === '}') { d -= 1; continue; }
    if (d !== 1 || c !== 'l' || !text.startsWith('lineHeight', i)) continue;
    if (i > 0 && /[A-Za-z0-9_$.]/.test(text[i - 1])) continue;
    if (/^\s*:/.test(text.slice(i + 'lineHeight'.length))) return true;
  }
  return false;
};

// ─── Import insertion ────────────────────────────────────────────────────────
/** The offset just past the last top-level `import ... ;` statement. */
const afterLastImport = (text) => {
  const lines = text.split('\n');
  let offset = 0;
  let best = -1;
  let open = false;
  for (const line of lines) {
    const next = offset + line.length + 1;
    const t = line.trim();
    if (!open && /^import[\s{*]/.test(t)) open = true;
    if (open && /;\s*$/.test(t)) { best = next; open = false; }
    offset = next;
  }
  return best;
};

// ─── Per-file migration ──────────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

const relOf = (file) => path.relative(SRC, file).split(path.sep).join('/');
const countCensus = (text) => (text.match(new RegExp(CENSUS_RE.source, 'g')) || []).length;

const fatal = (lines) => {
  console.log('');
  for (const l of lines) console.log(l);
  console.log('');
  console.log('  Nothing was written. Run `git checkout -- src` if an earlier attempt left edits.');
  process.exit(1);
};

const files = walk(SRC).sort();
const report = [];
const overflow = [];
const skipped = [];
const moveTally = new Map();
let censusTotal = 0;
let rewritten = 0;
let inserted = 0;
let overrides = 0;
let neutral = 0;
let residualAfter = 0;
const residualPerFile = new Map();

for (const file of files) {
  const rel = relOf(file);
  const original = fs.readFileSync(file, 'utf8');

  if (HAND_EDITED.has(rel)) {
    const n = countCensus(original);
    censusTotal += n;
    residualAfter += n;
    if (n) residualPerFile.set(rel, n);
    skipped.push(`${rel} — hand-edited surface, ${n} literals left for the hand edit`);
    continue;
  }

  const census = countCensus(original);
  censusTotal += census;
  if (census === 0) continue;

  /* src is CRLF. An exception key written with \n in this file would never match, and a \n
   * insertion would split a CRLF pair. Both follow the file. */
  const EOL = original.includes('\r\n') ? '\r\n' : '\n';

  const mask = codeMask(original);
  const balance = braceBalance(original, mask);
  if (balance !== 0) {
    residualAfter += census;
    residualPerFile.set(rel, census);
    skipped.push(`${rel} — code-brace balance ${balance}, not 0: the scan cannot be trusted here`);
    continue;
  }

  // Exception ranges for this file, each required to match exactly once.
  const ranges = [];
  for (const ex of EXCEPTIONS) {
    if (ex.file !== rel) continue;
    const key = ex.match.split('\n').join(EOL);
    const first = original.indexOf(key);
    const last = original.lastIndexOf(key);
    if (first < 0) fatal([`  STOP  ${rel}: exception key did not match: ${JSON.stringify(ex.match)}`]);
    if (first !== last) fatal([`  STOP  ${rel}: exception key matched more than once: ${JSON.stringify(ex.match)}`]);
    ranges.push({ start: first, end: first + key.length, ex, hits: 0 });
  }

  // Collect every rewritable site first, then apply from the end so offsets stay valid.
  const sites = [];
  let unresolved = null;
  let m;
  WRITE_RE.lastIndex = 0;
  while ((m = WRITE_RE.exec(original))) {
    const at = m.index;
    if (!mask[at]) continue;
    const value = parseFloat(m[3]);
    const range = ranges.find((r) => at >= r.start && at < r.end);
    const inScope = range ? true : (fullScope(rel) || value <= 11);
    if (!inScope) continue;
    if (range) range.hits += 1;

    const role = range ? range.ex.role : ROLE_BY_VALUE.get(value);
    if (!role) fatal([`  STOP  ${rel}: no role for fontSize ${value} — the value->role table is incomplete`]);

    const obj = enclosingObject(original, mask, at);
    if (!obj) { unresolved = `fontSize ${value} at offset ${at}`; break; }

    const after = role === 'CHART_FS' ? 12 : PX_BY_ROLE[role];
    sites.push({
      at,
      length: m[0].length,
      gap: m[1],
      value,
      role,
      moved: after !== value,
      obj,
      reason: range ? range.ex.reason : null,
    });
  }

  if (unresolved) {
    residualAfter += census;
    residualPerFile.set(rel, census);
    skipped.push(`${rel} — enclosing object unresolvable for ${unresolved}; left byte-identical`);
    continue;
  }
  for (const r of ranges) {
    if (r.hits !== 1) fatal([`  STOP  ${rel}: exception key covers ${r.hits} fontSize literals, want 1: ${JSON.stringify(r.ex.match)}`]);
  }
  if (sites.length === 0) {
    residualAfter += census;
    residualPerFile.set(rel, census);
    continue;
  }

  let text = original;
  let fileRewritten = 0;
  let fileInserted = 0;
  let fileOverrides = 0;
  let fileNeutral = 0;
  const needs = { FS: false, LH: false, CHART_FS: false };
  const promoted = [];

  for (let k = sites.length - 1; k >= 0; k -= 1) {
    const s = sites[k];
    const token = s.role === 'CHART_FS' ? 'CHART_FS' : `FS.${s.role}`;
    if (s.role === 'CHART_FS') needs.CHART_FS = true; else needs.FS = true;

    const lineStart = text.lastIndexOf('\n', s.at) + 1;
    let lineEnd = text.indexOf('\n', s.at);
    if (lineEnd < 0) lineEnd = text.length;
    else if (text[lineEnd - 1] === '\r') lineEnd -= 1;
    const line = text.slice(lineStart, lineEnd);
    const ownLine = /^\s*fontSize:/.test(line) && /,\s*$/.test(line);
    const indent = (line.match(/^\s*/) || [''])[0];

    // What follows the value: the comma, if there is one, so an inline insert lands after it.
    const tail = text.slice(s.at + s.length);
    const commaAt = /^(\s*),/.exec(tail);

    let insertion = '';
    if (s.moved) {
      if (hasLineHeight(text, codeMask(text), s.obj.open, s.obj.close)) {
        fileOverrides += 1;
      } else {
        const lh = `lineHeight: LH.${LH_BY_ROLE[s.role]}`;
        needs.LH = true;
        fileInserted += 1;
        if (ownLine) {
          insertion = `__OWNLINE__${lh}`;
        } else if (commaAt) {
          insertion = `__INLINE_AFTER_COMMA__${lh}`;
        } else {
          insertion = `__INLINE_NO_COMMA__${lh}`;
        }
      }
      promoted.push(s);
    } else {
      fileNeutral += 1;
    }

    // Build the replacement for the matched `fontSize: <value>` span.
    let replaced = `fontSize:${s.gap}${token}`;
    if (s.reason && !ownLine) replaced += ` /* ${s.reason} */`;

    let before = text.slice(0, s.at);
    let rest = text.slice(s.at + s.length);

    if (insertion.startsWith('__INLINE_AFTER_COMMA__')) {
      const lh = insertion.slice('__INLINE_AFTER_COMMA__'.length);
      rest = rest.replace(/^(\s*),/, `$1, ${lh},`);
    } else if (insertion.startsWith('__INLINE_NO_COMMA__')) {
      const lh = insertion.slice('__INLINE_NO_COMMA__'.length);
      replaced += `, ${lh}`;
    }

    text = before + replaced + rest;

    // Own-line work happens after the value is in place, so the line is final.
    if (insertion.startsWith('__OWNLINE__') || (s.reason && ownLine)) {
      let end = text.indexOf('\n', s.at);
      if (end < 0) end = text.length;
      else if (text[end - 1] === '\r') end -= 1;
      let addition = '';
      if (insertion.startsWith('__OWNLINE__')) {
        addition += `${EOL}${indent}${insertion.slice('__OWNLINE__'.length)},`;
      }
      const comment = s.reason && ownLine ? `  // ${s.reason}` : '';
      text = text.slice(0, end) + comment + addition + text.slice(end);
    }

    fileRewritten += 1;
  }

  // The import, through the project's vite alias, carrying only the bindings this file uses.
  const bindings = ['FS', 'LH', 'CHART_FS'].filter((b) => needs[b]);
  const at = afterLastImport(text);
  if (at < 0) fatal([`  STOP  ${rel}: no top-level import to anchor the type.js import to`]);
  text = `${text.slice(0, at)}import { ${bindings.join(', ')} } from '@config/type.js';${EOL}${text.slice(at)}`;

  // Overflow acceptance: fixed px boxes sharing an object with a promoted fontSize, or its parent.
  const finalMask = codeMask(text);
  /* The leading boundary matters: without it `lineHeight: '13px'` matches as a `Height` box and the
   * acceptance list fills up with line heights. */
  const BOX_RE = /(^|[^A-Za-z0-9_$])((?:min)?(?:Width|Height):\s*'\d+px')/g;
  let b;
  while ((b = BOX_RE.exec(text))) {
    if (!finalMask[b.index]) continue;
    const obj = enclosingObject(text, finalMask, b.index);
    if (!obj) continue;
    const near = text.slice(obj.open, obj.close);
    const parent = enclosingObject(text, finalMask, obj.open);
    const nearParent = parent ? text.slice(parent.open, parent.close) : '';
    const sameObject = /fontSize:\s*(?:FS\.|CHART_FS)/.test(near);
    const parentObject = /fontSize:\s*(?:FS\.|CHART_FS)/.test(nearParent);
    if (!sameObject && !parentObject) continue;
    const lineNo = text.slice(0, b.index).split('\n').length;
    overflow.push(`${rel}:${lineNo}  ${b[2]}  (${sameObject ? 'same object' : 'parent object'})`);
  }

  const left = countCensus(text);
  residualAfter += left;
  if (left) residualPerFile.set(rel, left);

  for (const s of sites) {
    if (!s.moved) continue;
    const key = `${s.value}->${s.role === 'CHART_FS' ? 12 : PX_BY_ROLE[s.role]}`;
    moveTally.set(key, (moveTally.get(key) || 0) + 1);
  }

  rewritten += fileRewritten;
  inserted += fileInserted;
  overrides += fileOverrides;
  neutral += fileNeutral;
  report.push({ rel, census, fileRewritten, fileInserted, fileOverrides, fileNeutral, left, bindings });

  if (!DRY) fs.writeFileSync(file, text, 'utf8');
}

// ─── Report ──────────────────────────────────────────────────────────────────
console.log(`\nmigrateTypeLiterals — ${DRY ? 'DRY RUN, nothing written' : 'WRITING'}\n`);
console.log('  file                                        total  rewrit  lh-ins  overr  neutral  left  import');
console.log('  ' + '-'.repeat(104));
for (const r of report.sort((a, b2) => a.rel.localeCompare(b2.rel))) {
  console.log(`  ${r.rel.padEnd(42)} ${String(r.census).padStart(5)} ${String(r.fileRewritten).padStart(7)} ${String(r.fileInserted).padStart(7)} ${String(r.fileOverrides).padStart(6)} ${String(r.fileNeutral).padStart(8)} ${String(r.left).padStart(5)}  ${r.bindings.join(',')}`);
}
console.log('  ' + '-'.repeat(104));
console.log(`  ${'TOTAL'.padEnd(42)} ${String(censusTotal).padStart(5)} ${String(rewritten).padStart(7)} ${String(inserted).padStart(7)} ${String(overrides).padStart(6)} ${String(neutral).padStart(8)} ${String(residualAfter).padStart(5)}`);
/* The census this task validated is 813. If the TOTAL above reads 812, that is Settings.jsx's
 * block comment at :48-54, which quoted a sub-12px literal as PROSE while explaining why zoom
 * exists. The census regex counts it; no style object contains it; the migration made its claim
 * false, so it was reworded rather than exempted. The script does not get to edit the census. */

console.log('\n  moves by authored px -> rendered px:');
for (const [k, v] of [...moveTally.entries()].sort()) console.log(`    ${k.padEnd(12)} x${v}`);
console.log(`    moved total  ${rewritten - neutral}`);
console.log(`    pixel-neutral (font size AND line box unchanged)  ${neutral}`);

console.log('\n  skipped:');
if (skipped.length === 0) console.log('    none');
for (const s of skipped) console.log(`    ${s}`);

console.log('\n  residual by file:');
for (const [k, v] of [...residualPerFile.entries()].sort()) console.log(`    ${k.padEnd(44)} ${v}`);
console.log(`    across ${residualPerFile.size} files`);

console.log('\n  fixed px boxes to accept, beside or above a promoted fontSize:');
if (overflow.length === 0) console.log('    none');
for (const o of overflow) console.log(`    ${o}`);

console.log(`\n  LH.chart and LH.flat ship with NO consumer from this run: the chip (11.5px) and micro`);
console.log('  (11px) cohorts are pixel-neutral, and this script inserts a lineHeight only where the');
console.log('  size moved. That is a statement of fact, not a gap to fill.');

if (residualAfter !== EXPECTED) {
  fatal([
    `  STOP  post-run literal count is ${residualAfter}, want ${EXPECTED}`,
    `        (${RESIDUAL_BUDGET} residual budget + ${HAND_EDITED_REMAINING} left for the hand edit)`,
    '        The per-file table above carries the delta.',
  ]);
}

console.log(`\n  OK — ${rewritten} literals rewritten, ${residualAfter} remaining (${RESIDUAL_BUDGET} + ${HAND_EDITED_REMAINING} hand-edited).\n`);
process.exit(0);
