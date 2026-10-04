#!/usr/bin/env node

/**
 * verifyTypeScale.mjs — the type scale and the width bands, and the ways they rot.
 *
 * WHY THIS IS TESTED (spec Section 136). A token system no suite can check drifts back to literals:
 * one `fontSize: 10` authored next to a token is invisible in a diff and nothing fails. And a band
 * helper is worse, because it can be WRONG while looking right — an earlier version answered
 * 'regular' for a 500px window that had been wide, and its assertion passed anyway because it never
 * drove that case.
 *
 * So every assertion here publishes the condition that would turn it RED, as a comment at the
 * assertion. An assertion whose red condition cannot be stated is an assertion that is not testing
 * anything.
 *
 * `.mjs`, not `.cjs`: five assertions import the ESM exports of src/config/type.js and
 * src/config/layoutBands.js, and every suite in scripts/ that reads from src/ is .mjs
 * (spec 136.12 [F7]). console.log is correct here — verifyInvariants.cjs's walkShipped
 * deliberately skips scripts/.
 *
 * Assertions 1-11 pin the primitives and passed before anything was migrated. Assertions 12-14 are
 * the census — zero numeric literals at or below 11px, the 140 residual budget, and the chart's
 * CHART_FS — and they first pass on the commit that hand-edits the last five sites, because that is
 * the commit on which they first become true.
 *
 * Run: node scripts/verifyTypeScale.mjs   (or npm run verify:type-scale)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { FS, LH, FLOORS, CHART_FS } from '../src/config/type.js';
import { bandFor, BAND_REGULAR_MIN, BAND_WIDE_MIN, BAND_HYSTERESIS } from '../src/config/layoutBands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};

/* Counting call sites has to read CODE, not prose: useLayoutBand.js documents its own signature
   with a worked example, which a raw text match reads as a second owner. Crude is fine here — a
   URL inside a string losing its slashes cannot affect a count of call expressions. */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

/** The published key map, css -> js: `--fs-dense-lg` is `FS.denseLg`. */
const camel = (cssName) => cssName
  .replace(/^--(fs|lh)-/, '')
  .replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// Comments stripped first, and not as a tidiness measure: index.css explains the specificity trap
// by QUOTING the selector it requires, so an includes() over the raw file would be satisfied by the
// prose while the rule itself was wrong.
const css = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

// Numeric truth lives in index.css, so both token blocks are parsed out of it rather than restated.
const cssFs = new Map();
for (const m of css.matchAll(/(--fs-[a-z0-9-]+):\s*([\d.]+)px\s*;/g)) cssFs.set(camel(m[1]), parseFloat(m[2]));
const cssLh = new Map();
for (const m of css.matchAll(/(--lh-[a-z0-9-]+):\s*([\d.]+)\s*;/g)) cssLh.set(camel(m[1]), parseFloat(m[2]));

// ── 1-2. The two layers name the same roles, in both directions ───────────────
console.log('\n--- the CSS tokens and the JS name map agree ---');

const missingBoth = (cssKeys, jsKeys) => ({
  noExport: [...cssKeys].filter((k) => !jsKeys.includes(k)),
  noToken: jsKeys.filter((k) => !cssKeys.has(k)),
});

check('index.css declares --fs-* tokens at all', cssFs.size > 0, String(cssFs.size));
{
  // RED WHEN: a --fs-* token exists with no export (a role JS can never reach), or an export exists
  // with no token (a var() resolving to nothing, so the site silently inherits its parent size).
  const d = missingBoth(new Set(cssFs.keys()), Object.keys(FS));
  check('--fs-* <-> FS parity, both directions',
    d.noExport.length === 0 && d.noToken.length === 0,
    `token with no export: [${d.noExport}]; export with no token: [${d.noToken}]`);
  eq('and the counts match', Object.keys(FS).length, cssFs.size);
}
{
  // RED WHEN: the same, for line heights.
  const d = missingBoth(new Set(cssLh.keys()), Object.keys(LH));
  check('--lh-* <-> LH parity, both directions',
    d.noExport.length === 0 && d.noToken.length === 0,
    `token with no export: [${d.noExport}]; export with no token: [${d.noToken}]`);
  eq('and the counts match', Object.keys(LH).length, cssLh.size);
}

// ── 3. The name map holds names, not numbers ──────────────────────────────────
console.log('\n--- the name map carries var() strings and nothing else ---');

// RED WHEN: someone writes '13px' or 'calc(var(--fs-chrome) + 1px)' into FS/LH — a literal in
// disguise, and a second place a number can live. Matched as a WHOLE value: a "no digits" rule
// could never pass, because --fs-h1/h2/h3 contain digits. FLOORS and CHART_FS are numeric by
// construction and are deliberately outside this check.
const VAR_SHAPE = /^var\(--(fs|lh)-[a-z0-9-]+\)$/;
const badShape = [
  ...Object.entries(FS).filter(([, v]) => !VAR_SHAPE.test(v)).map(([k, v]) => `FS.${k}=${v}`),
  ...Object.entries(LH).filter(([, v]) => !VAR_SHAPE.test(v)).map(([k, v]) => `LH.${k}=${v}`),
];
check('every FS/LH value is a whole var() reference', badShape.length === 0, badShape.join(', '));

// ── 4-5. Floors are a contract, checked as an inequality ──────────────────────
console.log('\n--- every role sits at or above its floor ---');

// RED WHEN: a token is lowered below its contract — --fs-chrome: 12px to win back some density.
// An INEQUALITY, not an identity: index.css may raise a value above its floor freely, and an
// equality check would guard nothing at all.
const noFloor = Object.keys(FS).filter((role) => typeof FLOORS[role] !== 'number');
check('every FS role has a declared floor', noFloor.length === 0, noFloor.join(', '));
const underFloor = [...cssFs.entries()]
  .filter(([role, px]) => typeof FLOORS[role] === 'number' && px < FLOORS[role])
  .map(([role, px]) => `${role} ${px} < ${FLOORS[role]}`);
check('no CSS value is below its role floor', underFloor.length === 0, underFloor.join(', '));

// RED WHEN: the chart's size forks from the scale. CHART_FS is the one sanctioned number, because
// lightweight-charts' layout.fontSize takes a JS number no var() string can reach.
eq('CHART_FS equals FLOORS.chart', CHART_FS, FLOORS.chart);

// ── 6-7. The appearance zoom is untouched, so nothing double-scales ───────────
console.log('\n--- the zoom still composes by multiplication, unchanged ---');

// RED WHEN: the r.factor / r.data regression that 0ba1b44 repaired comes back. A live risk
// precisely because this work edits Settings.jsx.
check('Settings.jsx readZoom still reads the `zoom` reply field',
  /readZoom[\s\S]{0,200}?r\?\.zoom/.test(read('src/pages/Settings/Settings.jsx')));

// RED WHEN: a later session changes zoom policy as a side effect of type work, without the
// Section 47 amendment such a change requires. THIS IS THE NO-DOUBLE-SCALING GUARD: the type scale
// is authored px only, and effective px = role token x zoom factor.
{
  const app = read('electron/lib/appearanceState.cjs');
  const num = (name) => {
    const m = app.match(new RegExp(`const\\s+${name}\\s*=\\s*(-?[\\d.]+)`));
    return m ? parseFloat(m[1]) : NaN;
  };
  eq('appearanceState AUTO_MIN', num('AUTO_MIN'), 1.0);
  eq('appearanceState AUTO_MAX', num('AUTO_MAX'), 1.4);
  eq('appearanceState ZOOM_MIN', num('ZOOM_MIN'), 0.6);
  eq('appearanceState ZOOM_MAX', num('ZOOM_MAX'), 2.0);
  eq('appearanceState REF_WIDTH', num('REF_WIDTH'), 1600);
  eq('appearanceState REF_HEIGHT', num('REF_HEIGHT'), 900);
  check('and it still exports all six',
    /module\.exports\s*=\s*\{[\s\S]*ZOOM_MIN[\s\S]*ZOOM_MAX[\s\S]*AUTO_MIN[\s\S]*AUTO_MAX[\s\S]*REF_WIDTH[\s\S]*REF_HEIGHT/.test(app));
}

// ── 8. bandFor is correct, sticky and total ───────────────────────────────────
console.log('\n--- bandFor: both edges, the hold ranges, the jumps, and totality ---');

eq('BAND_REGULAR_MIN', BAND_REGULAR_MIN, 900);
eq('BAND_WIDE_MIN', BAND_WIDE_MIN, 1600);
eq('BAND_HYSTERESIS', BAND_HYSTERESIS, 24);

// RED WHEN: either edge drifts, or the hysteresis inverts.
eq('899 from regular is compact', bandFor(899, 'regular'), 'compact');
eq('900 from regular is regular (the edge is exclusive)', bandFor(900, 'regular'), 'regular');
eq('912 holds compact', bandFor(912, 'compact'), 'compact');
eq('924 still holds compact', bandFor(924, 'compact'), 'compact');
eq('925 leaves compact', bandFor(925, 'compact'), 'regular');
eq('1600 from regular is wide', bandFor(1600, 'regular'), 'wide');
eq('1580 holds wide', bandFor(1580, 'wide'), 'wide');
eq('1576 still holds wide', bandFor(1576, 'wide'), 'wide');
eq('1575 leaves wide', bandFor(1575, 'wide'), 'regular');

// RED WHEN: a sticky branch starts RESOLVING instead of holding — the exact earlier bug, where a
// jump from wide to a 500px window answered 'regular' and the titlebar overlapped itself. The
// earlier assertion could not reach this because it never drove prev='wide' below 900.
eq('a jump down from wide re-resolves to compact', bandFor(500, 'wide'), 'compact');
eq('a jump up from compact re-resolves to wide', bandFor(1700, 'compact'), 'wide');

// RED WHEN: the function stops being total and returns undefined before the DOM reports a width.
eq('NaN returns prev', bandFor(NaN, 'wide'), 'wide');
eq('zero returns prev', bandFor(0, 'compact'), 'compact');
eq('a negative width returns prev', bandFor(-1, 'regular'), 'regular');
eq('Infinity returns prev', bandFor(Infinity, 'compact'), 'compact');

// RED WHEN: the band oscillates at a fixed width — bandFor's own answer fed back in changes it,
// so a rAF-coalesced resize would flip the band forever at one window size.
{
  const widths = [500, 888, 899, 900, 912, 924, 925, 1575, 1576, 1588, 1600, 1700];
  const prevs = ['compact', 'regular', 'wide'];
  const drifted = [];
  for (const w of widths) {
    for (const p of prevs) {
      const once = bandFor(w, p);
      const twice = bandFor(w, once);
      if (once !== twice) drifted.push(`${w} from ${p}: ${once} -> ${twice}`);
    }
  }
  check(`idempotent over ${widths.length * prevs.length} width/prev cases`,
    drifted.length === 0, drifted.join('; '));
}

// ── 9-10. The band is wired up, once, in the right place ──────────────────────
console.log('\n--- the band has a rule with winning specificity and exactly one owner ---');

// RED WHEN: the wide override is written as a bare [data-band="wide"], which scores (0,1,0), ties
// with :root, and so depends on source order to apply at all.
check('index.css carries the :root-prefixed wide rule', css.includes(':root[data-band="wide"]'));
check('and it is what sets --palette-w for wide',
  /:root\[data-band="wide"\]\s*\{[^}]*--palette-w:/.test(css));

// RED WHEN: the responsive half ships as a hook nobody owns, a SECOND owner appears and the
// cleanups race, or the owner is moved below the pop-out branch and silently stops working in
// pop-out windows.
{
  const owners = [];
  let total = 0;
  for (const file of walk(SRC)) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const n = (text.match(/useLayoutBand\(\{\s*own:\s*true\s*\}\)/g) || []).length;
    if (n > 0) { total += n; owners.push(`${path.relative(ROOT, file)} (${n})`); }
  }
  eq('exactly one own:true call site in all of src', total, 1);
  check('and it is App.jsx', owners.length === 1 && /App\.jsx/.test(owners[0]), owners.join(', '));

  const app = read('src/App.jsx');
  const hookAt = app.indexOf('useLayoutBand({ own: true })');
  const branchAt = app.search(/const popout\s*=\s*readPopoutParams\(\)/);
  check('App.jsx still has the pop-out early return', branchAt > -1);
  check('and the band owner sits above it', hookAt > -1 && hookAt < branchAt, `hook ${hookAt}, branch ${branchAt}`);
}

// ── 11. The fs-exempt: parser, self-tested because it has no users yet ────────
console.log('\n--- the fs-exempt: allow-list parser ---');

/**
 * A sub-12px literal is allowed only with an `fs-exempt:` marker carrying a NON-EMPTY reason, on
 * the same line or the one above. Keyed by marker rather than file:line, so an unrelated insertion
 * above a site cannot invalidate its exemption.
 *
 * This correctly has ZERO users after the primitives land — the two micro-glyph sites take
 * FS.micro, which is not a numeric literal — and it is kept because the next sub-12px glyph will
 * need it. DO NOT delete it as dead code; the self-test below is what keeps it honest in the
 * meantime (spec 136.12 [F11]).
 */
const hasExemption = (text, lineIndex) => {
  const lines = String(text).split(/\r?\n/);
  for (const line of [lines[lineIndex], lineIndex > 0 ? lines[lineIndex - 1] : '']) {
    const m = String(line || '').match(/fs-exempt:(.*)$/);
    if (m && m[1].trim().length > 0) return true;
  }
  return false;
};

// RED WHEN: the parser stops honouring a well-formed marker (every future exemption then fails to
// register) or starts accepting a marker with no reason (the mechanism becomes a rubber stamp).
const WITH_REASON = "fontSize: 10,  // fs-exempt: an 18x18px badge circle — enlarging it breaks the box";
const WITHOUT_REASON = 'fontSize: 10,  // fs-exempt:';
check('a marker with a reason is accepted', hasExemption(WITH_REASON, 0) === true);
check('a marker with an empty reason is rejected', hasExemption(WITHOUT_REASON, 0) === false);
check('a reason on the preceding line is accepted',
  hasExemption('// fs-exempt: fixed 15x15px help glyph\nfontSize: 11,', 1) === true);
check('no marker at all is rejected', hasExemption('fontSize: 10,', 0) === false);

// ── 12-13. The census, after the migration ───────────────────────────────────
console.log('\n--- the census: the sub-12px floor holds and the residual is inside budget ---');

/**
 * The residual budget. 812 numeric fontSize literals were measured in src; 672 were migrated to
 * role tokens and 140 were deliberately left, every one of them 12px or above.
 *
 * THIS CONSTANT MAY ONLY EVER BE LOWERED. Raising it to make a suite green would let a literal be
 * authored next to a token, which is the exact drift this file exists to catch.
 */
const RESIDUAL_BUDGET = 140;

/**
 * The allow-list, and it is EMPTY — which is the correct state, not an oversight.
 *
 * A file named here may keep a numeric fontSize at or below 11px, and only at a site that also
 * carries an `fs-exempt:` marker with a reason. After the Section 136 migration nothing needs it:
 * the two sub-12px glyphs (ScreenMap's 18x18px badge digit, InfoTip's 15x15px `?`) take FS.micro,
 * which is not a numeric literal at all. It ships empty because the NEXT fixed-geometry glyph will
 * need it and because hasExemption above is self-tested, so the mechanism cannot rot while unused.
 * DO NOT delete this as dead code.
 */
const FS_EXEMPT_FILES = new Set();

const LITERAL = /fontSize:\s*['"]?(\d+(?:\.\d+)?)(?:px)?/g;
const residual = new Map();
const tooSmall = [];
let residualTotal = 0;
let lhLiterals = 0;
let lhTokens = 0;

for (const file of walk(SRC)) {
  const relPath = path.relative(ROOT, file).split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  let n = 0;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LITERAL)) {
      n += 1;
      const px = parseFloat(m[1]);
      if (px > 11) continue;
      if (FS_EXEMPT_FILES.has(relPath) && hasExemption(text, i)) continue;
      tooSmall.push(`${relPath}:${i + 1} = ${px}px`);
    }
  });
  if (n > 0) { residual.set(relPath, n); residualTotal += n; }
  // Line heights are counted off the CODE, so type.js's own worked example in a doc comment is not
  // mistaken for a consumer.
  const code = stripComments(text);
  lhLiterals += (code.match(/lineHeight:\s*['"]?[\d.]+(?:px)?['"]?/g) || []).length;
  lhTokens += (code.match(/lineHeight:\s*LH\.[a-zA-Z]+/g) || []).length;
}

// A12. RED WHEN: a new sub-12px literal lands anywhere in src — including inside a template string
// that emits a generated page, which is why this reads raw text rather than parsing — or when an
// exemption loses its reason. The floor is the whole point of the migration; nothing else pins it.
check('no numeric fontSize at or below 11px anywhere in src',
  tooSmall.length === 0, tooSmall.slice(0, 8).join('; '));

// A13. RED WHEN: a literal is authored instead of a token, or a migrated file is reverted. FLOORS
// and CHART_FS are not `fontSize:` sites, so they sit outside this count by construction rather
// than by exemption.
console.log(`        residual ${residualTotal} literals across ${residual.size} files, budget ${RESIDUAL_BUDGET}`);
for (const [f, n] of [...residual.entries()].sort()) console.log(`          ${f.padEnd(44)} ${n}`);
// Both numbers are whole-of-src totals, not per-site attributions: the first is every LH.* the
// migration inserted; the second is every inline lineHeight still authored as a number, which is
// the overrides the migration deliberately left alone PLUS the sites it never touched.
console.log(`        line heights: ${lhTokens} LH.* tokens inserted, ${lhLiterals} inline literals left untouched`);
check(`residual numeric fontSize count is within budget (${residualTotal} <= ${RESIDUAL_BUDGET})`,
  residualTotal <= RESIDUAL_BUDGET, `${residualTotal} > ${RESIDUAL_BUDGET}`);

// ── 14. The chart's one sanctioned number ────────────────────────────────────
console.log('\n--- the chart reads CHART_FS and holds no number of its own ---');

// RED WHEN: the chart size forks from the scale, or someone re-types `fontSize: 12` into the
// createChart option.
//
// Asserted over the WHOLE file, with NO `layout:` anchor. An anchored
// /layout:\s*\{[^}]*fontSize:\s*CHART_FS\b/s cannot work here: `[^}]` cannot cross the brace that
// closes `background: { color: 'transparent' }`, and that brace sits BETWEEN `layout: {` and
// `fontSize`. So the anchored must-match half fails on correct code, and its must-not-match half
// is vacuous even before the migration. Verified against the real file text (spec 136.12 [F1]).
{
  const chart = read('src/pages/StockMind/PriceChart.jsx');
  check('PriceChart.jsx passes CHART_FS to createChart', /fontSize:\s*CHART_FS\b/.test(chart));
  check('and PriceChart.jsx holds no numeric fontSize anywhere', !/fontSize:\s*['"]?\d/.test(chart));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
