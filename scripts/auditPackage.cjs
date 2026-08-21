'use strict';

/**
 * auditPackage.cjs — prove the packaged app can resolve everything it will load.
 *
 * WHY THIS EXISTS: the installed app died on launch with
 *
 *   Error: Cannot find module 'debug'
 *   Require stack: ...app.asar/node_modules/electron-updater/node_modules/
 *                  builder-util-runtime/out/httpExecutor.js
 *
 * The cause was `build.files` using `!node_modules/**\/*` plus a hand-written
 * allowlist of 18 packages. npm hoists transitive dependencies to top-level
 * `node_modules`, so the exclusion silently dropped every one the list did not
 * name — 211 of 229 production packages were absent. Nothing in the build reported
 * a problem: electron-builder packaged exactly what it was told to, the installer
 * built cleanly, and the failure appeared only when a user double-clicked it.
 *
 * So the check has to read the artefact, not the configuration.
 *
 * WHY REACHABILITY RATHER THAN A FULL SCAN: scanning every JavaScript file in the
 * asar was tried first and produced 65 "missing" packages, of which nearly all
 * were noise — `tape` and `benchmark` required by third-party `test.js` files,
 * `osx-temperature-sensor` which is a macOS-only optional dependency,
 * `browserify` inside a package's own build script. None of those are ever loaded.
 * An audit that cries wolf 65 times gets ignored, and then the one real failure
 * hides in the list.
 *
 * This walks outward from the actual entry points instead, following requires the
 * way Node does, and reports only packages that something genuinely on a load path
 * asks for. That is exactly the `debug` case: main.cjs → electron-updater →
 * builder-util-runtime → debug.
 *
 * WHAT IT DELIBERATELY DOES NOT REPORT: failures to resolve a specific *file*
 * inside a package that is present. Modern packages route entry points through
 * conditional `exports` maps that this resolver does not implement, so a miss
 * there is far more likely to be a limitation here than a packaging fault. The
 * question asked is "is the package present at all", which is the failure mode
 * that actually breaks launches.
 *
 * Usage:
 *   node scripts/auditPackage.cjs
 *   node scripts/auditPackage.cjs --asar <path to app.asar>
 *   node scripts/auditPackage.cjs --verbose   show the load path to each miss
 */

const fs   = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const has  = (f) => args.includes(f);
const valueOf = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const verbose  = has('--verbose');
const showHelp = has('--help') || has('-h');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const out  = (m) => process.stdout.write(`${m}\n`);
const ok   = (m) => out(`  ${C.green}✓${C.reset} ${m}`);
const warn = (m) => out(`  ${C.yellow}!${C.reset} ${m}`);
const bad  = (m) => out(`  ${C.red}✕${C.reset} ${m}`);
const info = (m) => out(`  ${C.cyan}·${C.reset} ${m}`);

const BUILTINS = new Set(Module.builtinModules);
/** Provided by the Electron runtime, never by node_modules. */
const RUNTIME_PROVIDED = new Set(['electron', 'original-fs']);

// The processes that actually start: the main process, its preload, and the API
// server the launcher spawns. Anything unreachable from these cannot break a launch.
const ENTRY_POINTS = [
  'electron/main.cjs',
  'electron/preload.cjs',
  'server/index.cjs',
];

function defaultAsarPath() {
  const distDir = path.join(ROOT, 'dist-electron');
  let entries = [];
  try { entries = fs.readdirSync(distDir); } catch { return null; }
  for (const e of entries) {
    if (!e.endsWith('-unpacked')) continue;
    const p = path.join(distDir, e, 'resources', 'app.asar');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Extract require specifiers, and note which sit inside a try block.
 *
 * A guarded require is how this project loads every optional dependency on
 * purpose (`sysinfo.cjs` wraps `systeminformation`, `instanceManager` wraps
 * `dataStore`), so a missing one degrades rather than crashes. Reporting those as
 * hard failures would flag the fallback design as a bug.
 */
function requiresIn(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const found = [];
  const re = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const spec = m[2];
    if (!spec || spec.startsWith('node:')) continue;
    // Cheap guard detection: is there an unclosed `try {` before this point?
    const before = stripped.slice(0, m.index);
    const tries = (before.match(/\btry\s*\{/g) ?? []).length;
    const catches = (before.match(/\bcatch\s*(\(|\{)/g) ?? []).length;
    found.push({ spec, guarded: tries > catches });
  }
  return found;
}

/** 'debug/src/index.js' -> 'debug';  '@scope/pkg/x' -> '@scope/pkg' */
function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function dirOf(file) {
  const i = file.lastIndexOf('/');
  return i === -1 ? '' : file.slice(0, i);
}

function joinPosix(base, rel) {
  const segs = (base ? base.split('/') : []).concat(rel.split('/'));
  const stack = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') stack.pop();
    else stack.push(s);
  }
  return stack.join('/');
}

/**
 * Node's upward node_modules walk. This is what made the original bug quiet: a
 * nested copy resolves while a hoisted one does not, and the config only listed
 * the nested ones.
 */
function findPackageDir(fromDir, pkgName, packageDirs) {
  let dir = fromDir;
  for (;;) {
    const candidate = `${dir ? `${dir}/` : ''}node_modules/${pkgName}`;
    if (packageDirs.has(candidate)) return candidate;
    if (!dir) return null;
    dir = dirOf(dir);
    if (dir === '' && !packageDirs.has(`node_modules/${pkgName}`)) {
      return packageDirs.has(`node_modules/${pkgName}`) ? `node_modules/${pkgName}` : null;
    }
  }
}

function resolveFile(candidate, fileSet) {
  const tries = [
    candidate,
    `${candidate}.js`, `${candidate}.cjs`, `${candidate}.json`, `${candidate}.node`,
    `${candidate}/index.js`, `${candidate}/index.cjs`, `${candidate}/index.json`,
  ];
  return tries.find(t => fileSet.has(t)) ?? null;
}

function packageEntry(pkgDir, fileSet, readJson) {
  const meta = readJson(`${pkgDir}/package.json`);
  const main = typeof meta?.main === 'string' ? meta.main : null;
  if (main) {
    const hit = resolveFile(joinPosix(pkgDir, main), fileSet);
    if (hit) return hit;
  }
  return resolveFile(`${pkgDir}/index`, fileSet);
}

function help() {
  out(`
${C.bold}Rāma AGI — packaged dependency audit${C.reset}

  node scripts/auditPackage.cjs                  newest built app.asar
  node scripts/auditPackage.cjs --asar <path>     a specific asar
  node scripts/auditPackage.cjs --verbose         show the load path to each miss

Walks outward from electron/main.cjs, electron/preload.cjs and server/index.cjs
inside the built asar, following requires as Node would, and fails if a package on
a real load path was not packaged. Reads the artefact, not the config.
`);
}

function main() {
  if (showHelp) { help(); return 0; }

  out(`\n${C.bold}  ⬢ Rāma AGI — packaged dependency audit${C.reset}`);

  const asarPath = valueOf('--asar', null) ?? defaultAsarPath();
  if (!asarPath || !fs.existsSync(asarPath)) {
    warn('No built app.asar found — nothing to audit. Run a package build first.');
    return 0;
  }

  let asar;
  try { asar = require('@electron/asar'); }
  catch {
    warn('@electron/asar unavailable, so the asar cannot be read — audit skipped.');
    return 0;
  }

  info(`reading ${path.relative(ROOT, asarPath)}`);

  let entries;
  try { entries = asar.listPackage(asarPath); }
  catch (e) { bad(`Could not list the asar: ${e.message}`); return 1; }

  // On Windows the asar index stores backslash paths, and extractFile wants that
  // exact form minus the leading separator, while resolution wants forward
  // slashes. Keep both: normalising once made the first version of this audit
  // read 13 of 7790 files and report success.
  const rawList = entries.map(e => e.replace(/^[\\/]/, ''));
  const normList = rawList.map(e => e.replace(/\\/g, '/'));
  const rawOf = new Map(normList.map((n, i) => [n, rawList[i]]));
  const fileSet = new Set(normList);

  const packageDirs = new Set();
  for (const e of normList) {
    const suffix = '/package.json';
    if (e.endsWith(suffix)) packageDirs.add(e.slice(0, -suffix.length));
    const m = e.match(/^(.*node_modules\/(?:@[^/]+\/[^/]+|[^/]+))\//);
    if (m) packageDirs.add(m[1]);
  }

  const readCache = new Map();
  const read = (file) => {
    if (readCache.has(file)) return readCache.get(file);
    let text = null;
    try { text = asar.extractFile(asarPath, rawOf.get(file) ?? file).toString('utf8'); }
    catch { text = null; }
    readCache.set(file, text);
    return text;
  };
  const readJson = (file) => {
    const t = read(file);
    if (!t) return null;
    try { return JSON.parse(t); } catch { return null; }
  };

  info(`${normList.length} entries, ${packageDirs.size} package dirs`);

  const present = ENTRY_POINTS.filter(e => fileSet.has(e));
  for (const e of ENTRY_POINTS) {
    if (!fileSet.has(e)) bad(`entry point missing from the package: ${e}`);
  }
  if (present.length === 0) {
    bad('No entry point found in the asar — this package cannot start.');
    return 1;
  }
  info(`entry points: ${present.join(', ')}`);

  // ── Reachability walk ──────────────────────────────────────────────────────
  const visited = new Set();
  const cameFrom = new Map();
  const queue = [...present];
  for (const e of present) cameFrom.set(e, null);

  const missing = new Map();   // pkgName -> { from, guarded }
  let filesWalked = 0;

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    const source = read(file);
    if (source === null) continue;
    if (!/\.(js|cjs|mjs)$/.test(file)) continue;
    filesWalked++;

    const fromDir = dirOf(file);

    for (const { spec, guarded } of requiresIn(source)) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const hit = resolveFile(joinPosix(fromDir, spec), fileSet);
        // An unresolved *relative* require is almost always this resolver meeting
        // an exports map or a dynamic path, not a packaging fault. Not reported.
        if (hit && !visited.has(hit)) { cameFrom.set(hit, file); queue.push(hit); }
        continue;
      }

      const pkgName = packageNameOf(spec);
      if (BUILTINS.has(pkgName) || RUNTIME_PROVIDED.has(pkgName)) continue;

      const pkgDir = findPackageDir(fromDir, pkgName, packageDirs);
      if (!pkgDir) {
        const prior = missing.get(pkgName);
        // A hard require anywhere outweighs a guarded one for reporting.
        if (!prior || (prior.guarded && !guarded)) {
          missing.set(pkgName, { from: file, guarded });
        }
        continue;
      }

      const subpath = spec.slice(pkgName.length).replace(/^\//, '');
      const target = subpath
        ? resolveFile(joinPosix(pkgDir, subpath), fileSet)
        : packageEntry(pkgDir, fileSet, readJson);
      if (target && !visited.has(target)) { cameFrom.set(target, file); queue.push(target); }
    }
  }

  out('');
  info(`walked ${filesWalked} reachable file(s) from ${present.length} entry point(s)`);

  // The question this audit exists to answer is "did packaging DROP something we
  // have?" — not "does every third-party package have all its optional peers?".
  // `chromium-bidi` is required by playwright-core's BiDi transport and is not in
  // node_modules at all, so the same require would fail in development; packaging
  // cannot be blamed for losing a package that was never installed. Splitting on
  // local presence removes that entire class of false positive without weakening
  // the real check, because a dropped dependency is by definition installed here.
  const installedLocally = (name) => fs.existsSync(path.join(ROOT, 'node_modules', ...name.split('/')));

  const dropped  = [];   // present locally, absent from the package — the real bug
  const neverHad = [];   // absent locally too — not a packaging fault
  const soft     = [];   // guarded by try/catch — degrades by design

  for (const [name, v] of missing) {
    if (v.guarded) { soft.push([name, v]); continue; }
    (installedLocally(name) ? dropped : neverHad).push([name, v]);
  }
  const hard = dropped;

  const chainTo = (file) => {
    const chain = [];
    let cur = file;
    while (cur && chain.length < 6) { chain.push(cur); cur = cameFrom.get(cur); }
    return chain.reverse().join('\n          -> ');
  };

  if (soft.length) {
    warn(`${soft.length} optional package(s) absent — guarded by try/catch, so they degrade:`);
    for (const [name, v] of soft) out(`      ${C.dim}${name}  (wanted by ${v.from})${C.reset}`);
    out('');
  }

  if (neverHad.length) {
    info(`${neverHad.length} package(s) not installed in node_modules either — not a packaging fault:`);
    for (const [name, v] of neverHad) out(`      ${C.dim}${name}  (wanted by ${v.from})${C.reset}`);
    out('');
  }

  if (hard.length === 0) {
    ok('every package on a real load path is present');
    out('');
    return 0;
  }

  bad(`${hard.length} package(s) required on a load path but NOT packaged:`);
  out('');
  for (const [name, v] of hard) {
    out(`    ${C.red}${name}${C.reset}  required by  ${v.from}`);
    if (verbose) out(`      ${C.dim}load path:${C.reset}\n          -> ${chainTo(v.from)}`);
  }
  out('');
  warn('This is what makes an installed app die on launch with "Cannot find module".');
  warn('Check build.files in package.json — see RAMA_AGI_MASTER_SPEC.md Section 48.');
  out('');
  return 1;
}

try {
  process.exitCode = main();
} catch (e) {
  bad(`audit aborted: ${e.message ?? String(e)}`);
  process.exitCode = 1;
}
