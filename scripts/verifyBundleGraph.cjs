#!/usr/bin/env node
/**
 * verifyBundleGraph.cjs — the built chunk graph, checked against the output rather than the config.
 *
 * WHY THIS EXISTS, and it is the most expensive lesson in the bundle work (spec Section 140).
 *
 * `manualChunks` decides which modules share a chunk. Get it wrong and the build still SUCCEEDS —
 * Rollup emits a graph it is perfectly happy with — and the app dies at runtime on a minified name
 * nobody can trace back to a config line. The row-160 rule put monaco's `definitions/<lang>/
 * register.js` in `lang-<lang>` while `_.contribution.js`, which declares the registry it writes to,
 * stayed in `vendor-monaco`. The barrel statically imports all 81 registers, so the two chunks became
 * MUTUALLY STATIC: `vendor-monaco` imported every `lang-*`, and every `lang-*` imported
 * `vendor-monaco` back. ESM hoists imports, so `lang-abap` ran its top-level `registerLanguage({...})`
 * before `vendor-monaco` had evaluated `const languageDefinitions = {}`.
 *
 * The packaged app said: **Cannot access 'xse' before initialization.**
 *
 * NOTHING IN THE REPOSITORY COULD HAVE CAUGHT IT:
 *   - `npm run build` exits 0; a chunk cycle is legal output
 *   - `auditRenderer.cjs` reads SOURCE, and the source was never wrong
 *   - `verify:render` drives the VITE DEV SERVER, which does no chunking at all, so it cannot see a
 *     `manualChunks` defect by construction — it reported 18/18 routes reachable on the broken build
 *
 * So this suite reads `build/assets/*.js` and asserts the properties the config is TRYING to produce.
 * A cycle-free static graph is the general form of the fix: a TDZ across chunks needs a cycle, and
 * without one no chunk can run its body before a chunk it depends on.
 *
 * IT REFUSES RATHER THAN SKIPS when there is no build. A guard that prints green because it could not
 * look is worse than no guard — that is how this defect reached master in the first place.
 *
 * Run: node scripts/verifyBundleGraph.cjs   (or npm run verify:bundle; `npm run build` runs it too)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'build', 'assets');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ── The refusal, stated before anything else ─────────────────────────────────
if (!fs.existsSync(ASSETS)) {
  console.error('\nverifyBundleGraph: there is no build to read.\n');
  console.error('  Expected: build/assets/*.js');
  console.error('  This suite checks the EMITTED chunk graph, so it cannot run against source and it');
  console.error('  does not pretend to. Run `npm run build` first. It is wired into `npm run build`');
  console.error('  precisely so the artifact always exists when it runs.\n');
  process.exit(2);
}

console.log('\nRama bundle graph');

// ── Read the graph out of the emitted chunks ─────────────────────────────────
//
// Rollup writes relative specifiers between sibling chunks. Static edges are what matter: a dynamic
// import() cannot cause a temporal dead zone, because the importing chunk has already finished
// evaluating by the time it fires.
const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
const statics = new Map();
const dynamics = new Map();
const text = new Map();

for (const f of files) {
  const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  text.set(f, src);
  const s = new Set();
  const d = new Set();
  // `import"./x.js"` (bare side-effect) and `import{a}from"./x.js"` / `export...from"./x.js"`.
  for (const m of src.matchAll(/\bimport\s*["']\.\/([^"']+\.js)["']/g)) s.add(m[1]);
  for (const m of src.matchAll(/\bfrom\s*["']\.\/([^"']+\.js)["']/g)) s.add(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*["']\.\/([^"']+\.js)["']/g)) d.add(m[1]);
  // A dynamic specifier is not a static one even when both forms name the same chunk.
  for (const x of d) s.delete(x);
  statics.set(f, s);
  dynamics.set(f, d);
}

check('the build emitted chunks to read', files.length > 10, String(files.length));
console.log(`        ${files.length} chunks, `
  + `${[...statics.values()].reduce((a, b) => a + b.size, 0)} static edges, `
  + `${[...dynamics.values()].reduce((a, b) => a + b.size, 0)} dynamic edges`);

// ── (1) every static edge lands on a chunk that exists ───────────────────────
const dangling = [];
for (const [f, deps] of statics) for (const d of deps) if (!files.includes(d)) dangling.push(`${f} -> ${d}`);
check('every static import names a chunk that exists', dangling.length === 0, dangling.slice(0, 4).join(', '));

// ── (2) NO STATIC CYCLE. This is the row that would have caught the crash ────
//
// REDBY: put a module that is statically imported by chunk A into chunk B while B still statically
// imports A. Depth-first search with a colour map; a grey hit is a back edge, which is a cycle.
const cycles = [];
const colour = new Map();
const stack = [];
function dfs(node) {
  colour.set(node, 1);
  stack.push(node);
  for (const dep of statics.get(node) || []) {
    if (colour.get(dep) === 1) {
      cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
    } else if (!colour.has(dep)) {
      dfs(dep);
    }
  }
  stack.pop();
  colour.set(node, 2);
}
for (const f of files) if (!colour.has(f)) dfs(f);
check('no chunk statically imports a chunk that statically imports it back',
  cycles.length === 0,
  cycles.slice(0, 2).map((c) => c.join(' -> ')).join('  |  '));
if (cycles.length > 0) {
  console.log('        A static cycle between chunks is what produces "Cannot access X before');
  console.log('        initialization" at runtime: ESM hoists the imports, so one side runs its');
  console.log('        top-level body before the other has declared what that body reads.');
}

// ── (3) the monaco grammars are LAZY, asserted and not believed ──────────────
//
// The broken rule left all 81 as STATIC imports — measured 81 static, 0 dynamic — so every grammar
// downloaded up front AND the `loader()` resolved to a module that was already there. The chunking
// existed to make them lazy, so laziness is the thing to assert.
const langs = files.filter((f) => /^lang-/.test(f));
check('the per-language grammar chunks were emitted', langs.length > 50, String(langs.length));
// A GRAMMAR MAY STATICALLY IMPORT ANOTHER GRAMMAR, and the first version of this row called that a
// defect. `lang-javascript -> lang-typescript` is real and correct: monaco derives the JavaScript
// Monarch definition from the TypeScript one, so loading JS legitimately pulls TS. Laziness is not
// harmed, because neither is reachable except through a dynamic import. What must never happen is a
// NON-grammar chunk importing a grammar — that is what puts all 81 on someone's eager path.
const staticLangs = [];
for (const [f, deps] of statics) {
  if (/^lang-/.test(f)) continue;
  for (const d of deps) if (/^lang-/.test(d)) staticLangs.push(`${f} -> ${d}`);
}
eq('no chunk outside the grammar set statically imports a grammar', staticLangs.length, 0);
const crossLang = [];
for (const [f, deps] of statics) {
  if (!/^lang-/.test(f)) continue;
  for (const d of deps) if (/^lang-/.test(d)) crossLang.push(`${f} -> ${d}`);
}
console.log(`        ${crossLang.length} grammar-to-grammar static edge(s): `
  + `${crossLang.join(', ') || 'none'}`);
const dynLangs = new Set();
for (const deps of dynamics.values()) for (const d of deps) if (/^lang-/.test(d)) dynLangs.add(d);
check('every grammar chunk is reached by dynamic import',
  langs.every((l) => dynLangs.has(l)),
  langs.filter((l) => !dynLangs.has(l)).slice(0, 5).join(', '));

// ── (4) registration never crosses a chunk boundary ──────────────────────────
//
// The registry object and the calls that write to it must be in ONE chunk. That is the specific
// invariant the broken rule violated, and it is worth pinning by name as well as by the cycle rule:
// a future split could separate them without creating a cycle and still break initialisation order.
const withRegistry = files.filter((f) => /registerTokensProviderFactory/.test(text.get(f)));
eq('exactly one chunk holds the language registry', withRegistry.length, 1);
const withOnLangEncountered = files.filter((f) => /onLanguageEncountered/.test(text.get(f)));
check('and the registration helper lives in that same chunk',
  withOnLangEncountered.length === 1 && withOnLangEncountered[0] === withRegistry[0],
  `${withRegistry.join(',')} vs ${withOnLangEncountered.join(',')}`);
check('the chunk holding the registry is the monaco core, not a language chunk',
  /^vendor-monaco-/.test(withRegistry[0] || ''), String(withRegistry[0]));

// ── (5) monaco stays BEHIND a dynamic boundary ───────────────────────────────
//
// 4 MB of editor on the startup path is the thing row 160 set out to prevent. The entry is the
// chunk index.html loads with a <script type="module">.
const html = fs.readFileSync(path.join(ROOT, 'build', 'index.html'), 'utf8');
const entryMatch = /<script[^>]+src="[^"]*assets\/([^"]+\.js)"/.exec(html);
check('index.html names an entry chunk', !!entryMatch, entryMatch ? entryMatch[1] : 'none found');
const entry = entryMatch ? entryMatch[1] : null;
if (entry) {
  // Transitive static closure from the entry. Anything in here is downloaded before first paint.
  const eager = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const n = queue.pop();
    if (eager.has(n)) continue;
    eager.add(n);
    for (const d of statics.get(n) || []) queue.push(d);
  }
  console.log(`        entry ${entry} eagerly reaches ${eager.size} chunk(s): `
    + `${[...eager].sort().join(', ')}`);
  check('monaco is NOT on the startup path',
    ![...eager].some((f) => /^vendor-monaco-/.test(f)),
    [...eager].filter((f) => /^vendor-monaco-/.test(f)).join(', '));
  check('no grammar is on the startup path',
    ![...eager].some((f) => /^lang-/.test(f)),
    [...eager].filter((f) => /^lang-/.test(f)).slice(0, 5).join(', '));

  // ── THE MEASUREMENT THAT WAS MISSING, AND THE WHOLE REASON THE REGRESSION SHIPPED ──
  //
  // Row 160 measured the ENTRY CHUNK and reported 287 kB -> 113 kB, which was true. It did not
  // measure the entry's transitive STATIC closure, which is what the browser actually downloads
  // before first paint — and that had gone to 4,405 kB because Vite's preload helper was sitting in
  // `vendor-monaco`. A number nobody weighs is a number that can quietly invert.
  //
  // MEASURED, same machine, same commit otherwise:
  //   pre-row-160 config        324.09 kB raw / 101.93 kB gzip
  //   row 160 as shipped      4,405.67 kB raw / 1,169.46 kB gzip   <- the regression
  //   with the helper pinned        323.77 kB raw / 101.57 kB gzip
  //
  // The ceiling is deliberately loose — this guards against a 10x inversion, not against normal
  // growth, and a ceiling that reddens on every honest addition gets deleted rather than read.
  const STARTUP_CEILING_KB = 600;
  let startupBytes = 0;
  for (const f of eager) startupBytes += fs.statSync(path.join(ASSETS, f)).size;
  const startupKb = startupBytes / 1024;
  console.log(`        startup payload: ${startupKb.toFixed(2)} kB raw across ${eager.size} chunk(s)`);
  check(`the startup payload stays under ${STARTUP_CEILING_KB} kB`,
    startupKb < STARTUP_CEILING_KB, `${startupKb.toFixed(2)} kB`);

  // ── The helper that caused it, pinned where it cannot drag a vendor chunk in ──
  const helper = files.find((f) => /^vite-preload-/.test(f));
  check('Vite\'s preload helper has a chunk of its own', !!helper, String(helper));
  if (helper) {
    const hk = fs.statSync(path.join(ASSETS, helper)).size / 1024;
    check('and it is small, as a helper should be', hk < 10, `${hk.toFixed(2)} kB`);
    check('and it is on the startup path, which is correct — every lazy route needs it',
      eager.has(helper));
  }

  // ── THE STARTUP SET IS NAMED, NOT COUNTED ──────────────────────────────────
  //
  // An earlier version of this row asked whether any `vendor-*` chunk the entry imports "looks like"
  // it only supplies a helper. It flagged `vendor-react` and `vendor-router`, which are eager for
  // perfectly good reasons — a row that can only pass by coincidence is worse than no row.
  //
  // So the startup set is pinned BY NAME. Anything new becoming eager reddens this and has to be
  // argued for in the spec, which is exactly the review the 4 MB regression never got.
  // REDBY: let any further chunk onto the entry's static closure.
  const EXPECTED_EAGER = ['index', 'vendor-react', 'vendor-router', 'vendor-zustand', 'vite-preload'];
  // The hash is EXACTLY the last 8 characters before `.js`, anchored — a `{8,}` class that also
  // accepts `-` ate the family name and turned `vendor-react` into `vendor`. Vite's hashes are
  // base64url and genuinely do contain hyphens (`Cs1u6-yb`), so the length has to do the work.
  const eagerFamilies = [...eager]
    .map((f) => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, ''))
    .sort();
  check('the startup set is exactly the chunks the design intends',
    JSON.stringify(eagerFamilies) === JSON.stringify([...EXPECTED_EAGER].sort()),
    `got ${JSON.stringify(eagerFamilies)}`);
  // The ledger row 160 regression in its own right: a vendor chunk that exists and holds nothing.
  const react = files.find((f) => /^vendor-react-/.test(f));
  check('a vendor-react chunk exists', !!react, String(react));
  if (react) {
    const size = fs.statSync(path.join(ASSETS, react)).size;
    check('and it is not empty — the 0.00 kB defect row 160 found', size > 50 * 1024,
      `${(size / 1024).toFixed(2)} kB`);
    check('react-dom really is inside it', /createRoot|react-dom/.test(text.get(react)));
  }
}

// ── (6) sourcemaps ship only when asked for ──────────────────────────────────
const maps = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.map'));
if (process.env.RAMA_BUNDLE_AUDIT === '1') {
  check('an audit build emits sourcemaps', maps.length > 0, String(maps.length));
} else {
  eq('a default build ships no sourcemaps', maps.length, 0);
}

// ── What this suite CANNOT tell you ──────────────────────────────────────────
console.log('\n  held by hand, listed rather than implied:');
console.log('    - a cycle-free graph makes a cross-chunk TDZ impossible, but WITHIN one chunk Rollup');
console.log('      still orders module bodies itself; this suite does not re-derive that order');
console.log('    - that the editor actually opens is a browser claim. The reproduction used for the');
console.log('      Section 140 fix was to serve build/ and `await import()` the monaco chunk, which');
console.log('      threw the real error before the fix and resolved clean after it. That probe needs a');
console.log('      browser and is not part of this static check');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
