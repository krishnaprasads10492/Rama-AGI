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
function rebuildNatives({ root = path.join(__dirname, '..'), stdio = 'inherit' } = {}) {
  const found = resolveBin(root);
  if (!found.ok) return { ok: false, error: found.error };
  try {
    execSync(`node "${found.bin}" --force`, { cwd: root, stdio });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
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
function reportFailure(error, write = console.warn) {
  const facts = require('../shared/nativeModuleFacts.cjs');
  write(`  ⚠ ${BIN} failed: ${error}`);
  for (const line of facts.consequences()) write(`  ⚠ ${line}`);
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

module.exports = { rebuildNatives, resolveBin, reportFailure, PACKAGE, BIN };

// ── CLI, so `npm run rebuild` has something real to call ─────────────────────────────────────────
// Guarded by `require.main` on the Section 161 precedent: requiring this module must not start a
// multi-minute compile as a side effect.
if (require.main === module) {
  const facts = require('../shared/nativeModuleFacts.cjs');
  console.log(`\n  ⬢ Rebuilding native modules (${facts.NATIVE_MODULE_NAMES.join(', ')}) for Electron...`);
  const res = rebuildNatives();
  if (res.ok) {
    console.log('  ✓ Native modules rebuilt\n');
    process.exit(0);
  }
  // One report, shared with `beforeBuild.cjs` so a hand-run and a real build say the same thing.
  reportFailure(res.error);
  process.exit(1);
}
