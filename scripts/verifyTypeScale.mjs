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
 * Nothing is migrated at the point this suite first ships, so every assertion below passes on the
 * primitives alone. The census assertions (zero literals <= 11px, the 140 residual budget, the
 * chart's CHART_FS) arrive with the migration that makes them true.
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

const css = read('src/index.css');

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

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
