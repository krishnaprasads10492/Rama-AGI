'use strict';

/**
 * rebuildNatives.cjs — the one way this project rebuilds native modules (spec Section 185)
 *
 * WHY IT EXISTS. `npm run rebuild` was `"electron-rebuild"` — a bare binary name — and it failed on
 * master's machine with "electron-rebuild is not recognized as an internal or external command".
 * The cause is Section 173: the deprecated `electron-rebuild` package was replaced by
 * `@electron/rebuild`, in a lockfile-only change, so no `node_modules/.bin/electron-rebuild` shim
 * was ever linked. 45 shims exist in that directory; this was the only script naming one that does
 * not. A registered entry point that cannot run is the defect class this project keeps finding, and
 * here it was in `package.json` itself.
 *
 * `beforeBuild.cjs` already solved the same problem properly and privately: it reads the installed
 * package's own manifest, takes the `bin` entry, and runs `node "<path>" --force`. That logic is
 * lifted here so there is ONE implementation with two callers — the build hook and the npm script
 * — rather than a correct copy and a broken one (SRP, per Section 184.4).
 *
 * NEVER BY BARE NAME, AND NEVER THROUGH `npx`. `npx electron-rebuild` stopped finding a local match
 * when the package was renamed and DOWNLOADED the deprecated one mid-build instead, visible in the
 * 2026-11-03 transcript as "The following package was not found and will be installed:
 * electron-rebuild@3.2.9", dragging the vulnerable tar@6.2.1 back in over the network. A build step
 * that silently reaches the registry for a tool it was told not to use is worse than one that
 * stops, so a missing package is REPORTED, never fetched.
 *
 * NODE BUILTINS ONLY. `beforeBuild.cjs` runs on a checkout that may have no `node_modules` at all,
 * and it requires this file, so a dependency here would make the dependency installer need its own
 * dependencies installed first.
 */

const { execSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const path = require('path');

const PACKAGE = '@electron/rebuild';
const BIN = 'electron-rebuild';

/**
 * Where the rebuild binary actually is, according to the installed package rather than PATH.
 *
 * The manifest is read off disk rather than through `require.resolve`, because `@electron/rebuild`
 * declares an `exports` map that does not expose `./package.json` — resolving it that way throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED. The directory is what is needed, not a module specifier.
 *
 * @returns {{ok:true, bin:string}|{ok:false, error:string}}
 */
function resolveBin(root) {
  const dir = path.join(root, 'node_modules', '@electron', 'rebuild');
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) {
    return { ok: false, error: `${PACKAGE} is not installed at ${dir} — run npm install` };
  }
  let binRel;
  try {
    binRel = (JSON.parse(readFileSync(manifest, 'utf8')).bin || {})[BIN];
  } catch (err) {
    return { ok: false, error: `${PACKAGE}'s package.json could not be read: ${err.message}` };
  }
  if (!binRel) return { ok: false, error: `${PACKAGE} declares no ${BIN} binary` };
  return { ok: true, bin: path.join(dir, binRel) };
}

/**
 * Rebuild the native modules for the installed Electron.
 *
 * Returns an outcome rather than throwing, because both callers need to carry it: the build hook
 * writes it into the build manifest, and the CLI turns it into an exit code. A thrown error would
 * make "it failed" and "it was never attempted" the same event, which Section 178 established they
 * are not.
 *
 * @returns {{ok:boolean, error:string|null}}
 */
/**
 * Does this module already load, and is it Node-API?
 *
 * MEASURED, AND IT IS THE WHOLE OF SECTION 190. Both of this project's native modules ship prebuilt
 * Node-API binaries:
 *   - `argon2` is built with `prebuildify --napi` and installed by `node-gyp-build`, with
 *     `prebuilds/win32-x64/argon2.glibc.node` present in the package;
 *   - `node-pty` ships `prebuilds/win32-x64/{pty,conpty,conpty_console_list}.node` plus winpty, and
 *     `lib/utils.js` resolves `['build/Release', 'build/Debug', 'prebuilds/<platform>-<arch>']` —
 *     so it loads the shipped binary when nothing was compiled.
 * Proven on the development machine, which has NO MSVC toolset at all: `node_modules/node-pty/build`
 * contains no `.node` file and `require('node-pty')` still succeeds.
 *
 * Node-API is ABI-stable across Node AND Electron, which is what makes a Node-side load a sound
 * basis for skipping an Electron rebuild. BOTH conditions are required: a module that loads but is
 * NOT Node-API could still be wrong for Electron's ABI, so it is rebuilt rather than trusted.
 *
 * The load runs in a CHILD PROCESS. Requiring a native addon into this process to test it would
 * leave it loaded for the rest of the build, and a check that changes the thing it measures is not
 * a check (the rule `startupDoctor`'s `resolves()` already follows).
 */
function inspect(name, root) {
  let napi = false;
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    napi = !!(deps['node-addon-api'] || deps['node-gyp-build'] || deps.prebuildify
      || Array.isArray(pkg.binary && pkg.binary.napi_versions));
  } catch { /* not installed; `loads` below will say so */ }

  let loads = false;
  let error = null;
  try {
    execSync(`node -e "require('${name}')"`, { cwd: root, stdio: 'pipe', timeout: 60_000 });
    loads = true;
  } catch (err) {
    error = (err.stderr && err.stderr.toString().trim().split('\n').pop()) || err.message;
  }
  return { name, napi, loads, error, skippable: napi && loads };
}

/** Which modules actually need compiling, and why the others do not. */
function plan({ root = path.join(__dirname, '..') } = {}) {
  const names = require('../shared/nativeModuleFacts.cjs').NATIVE_MODULE_NAMES;
  const modules = names.map((n) => inspect(n, root));
  return { modules, needed: modules.filter((m) => !m.skippable).map((m) => m.name) };
}

/**
 * Rebuild the native modules that need it.
 *
 * NOT `--force` ANY MORE, and that flag is why four tranches went into a Visual Studio component
 * this project does not need. `--force` compels a from-source compile of every native module,
 * including ones shipping working prebuilt binaries — and `node-pty`'s own `binding.gyp` asks for
 * Spectre-mitigated libraries, so that forced compile is what produced MSB8040. Nothing was broken
 * by the absence of those libraries except a build step that did not have to run.
 *
 * @returns {{ok:boolean, error:string|null, skipped:string[], rebuilt:string[]}}
 */
function rebuildNatives({ root = path.join(__dirname, '..'), stdio = 'inherit', force = false } = {}) {
  const { modules, needed } = plan({ root });
  const skipped = modules.filter((m) => m.skippable).map((m) => m.name);

  if (!force && needed.length === 0) {
    // NOTHING TO DO IS AN OUTCOME, not a silence. Said out loud so a reader does not conclude the
    // step was skipped by accident.
    return { ok: true, error: null, skipped, rebuilt: [], reason: 'every native module already '
      + `loads from a shipped Node-API binary (${skipped.join(', ')}), so no compile is required` };
  }

  const found = resolveBin(root);
  if (!found.ok) return { ok: false, error: found.error, skipped, rebuilt: [] };
  // Scoped to what needs it. `--only` keeps a module that already works out of a compile that can
  // only fail, which is the difference between a degraded build and a clean one.
  const only = force ? '' : ` --only ${needed.join(',')}`;
  try {
    execSync(`node "${found.bin}"${force ? ' --force' : only}`, { cwd: root, stdio });
    return { ok: true, error: null, skipped, rebuilt: force ? modules.map((m) => m.name) : needed };
  } catch (err) {
    return { ok: false, error: err.message, skipped, rebuilt: [] };
  }
}

/**
 * Everything a reader needs when the rebuild fails, in one place.
 *
 * WHY SHARED (spec Section 188). The CLI printed the consequences, the remedy AND the toolchain
 * probe; `beforeBuild.cjs` — the path a real build takes — printed only the first two. So master's
 * build log carried generic advice and no diagnosis, while `npm run rebuild` on the same machine
 * would have told him which of the four causes applied. Two callers reporting the same failure
 * differently is how one of them ends up worse, which is the Section 185 lesson repeated.
 *
 * @param {(line:string)=>void} write  where the lines go (console.warn in both callers)
 */
function reportFailure(error, write = console.warn, { root = path.join(__dirname, '..') } = {}) {
  const facts = require('../shared/nativeModuleFacts.cjs');
  write(`  ⚠ ${BIN} failed: ${error}`);
  // ONLY THE MODULES THAT ACTUALLY FAIL TO LOAD (Section 190). A failed compile of a module whose
  // prebuilt binary loads anyway has NO consequence, and claiming one told master his vault had
  // dropped to scrypt when argon2 was working.
  let broken = null;
  try { broken = plan({ root }).modules.filter((m) => !m.loads).map((m) => m.name); }
  catch { /* fall back to the whole set below */ }
  if (broken && broken.length === 0) {
    write('  ⚠ ...but every native module still LOADS from a shipped binary, so nothing is degraded.');
    write('');
    return;
  }
  for (const line of facts.consequences(broken)) write(`  ⚠ ${line}`);
  for (const line of facts.remedyLines()) write(`  ⚠ ${line}`);
  // The machine-specific half. Guarded, because a probe that throws must not cost the report the
  // sentences above it.
  try {
    const probe = require('./toolchainProbe.cjs');
    write('');
    write('  WHY IT FAILED — read this before acting on the generic advice above:');
    for (const line of probe.lines(probe.probeNow())) write(`  ${line}`);
  } catch (err) {
    write(`  (the toolchain probe could not run: ${err.message})`);
  }
  write('');
}

module.exports = { rebuildNatives, resolveBin, reportFailure, inspect, plan, PACKAGE, BIN };

// ── CLI, so `npm run rebuild` has something real to call ─────────────────────────────────────────
// Guarded by `require.main` on the Section 161 precedent: requiring this module must not start a
// multi-minute compile as a side effect.
if (require.main === module) {
  const facts = require('../shared/nativeModuleFacts.cjs');
  console.log(`\n  ⬢ Rebuilding native modules (${facts.NATIVE_MODULE_NAMES.join(', ')}) for Electron...`);
  const res = rebuildNatives();
  if (res.ok) {
    // Says which it was. "Rebuilt" when nothing was compiled is a small lie that would send the
    // next reader looking for build output that does not exist (Section 190).
    if (res.reason) console.log(`  ✓ No rebuild needed — ${res.reason}\n`);
    else console.log(`  ✓ Rebuilt: ${res.rebuilt.join(', ') || '(nothing)'}\n`);
    process.exit(0);
  }
  // One report, shared with `beforeBuild.cjs` so a hand-run and a real build say the same thing.
  reportFailure(res.error);
  process.exit(1);
}
