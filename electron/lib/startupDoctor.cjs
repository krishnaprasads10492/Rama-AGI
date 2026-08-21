'use strict';

/**
 * startupDoctor.cjs — what `start.cjs`'s diagnose stage does, but inside the app.
 *
 * THE GAP THIS FILLS: `start.cjs` diagnoses and heals a great deal — dependencies,
 * native bindings, ports, build freshness, with scenario memory on top. None of it
 * ships. It is not in `build.files`, and could not work in an install anyway:
 * every repair shells out to npm against a writable source tree, and a packaged
 * app has no npm, no `vite`, and a read-only asar. So the installed app inherited
 * `selfCare`'s monitoring and lost the entire diagnose-and-repair layer.
 *
 * That asymmetry is what made an installed Rāma a burden rather than an asset: it
 * could tell master its vector memory was degraded, but not that it was missing a
 * third of its own dependencies.
 *
 * WHAT THIS CHECKS, and why each one is here rather than assumed:
 *   - declared production dependencies actually resolve. `genome.verify()` looks
 *     impressive but only resolves *first-party* engine paths, so a missing npm
 *     package never registered as a dead gene. This is the check that would have
 *     caught the `debug` crash before it became a crash.
 *   - the renderer bundle exists. Checked already in `loadRenderer`, but only
 *     after the whole require chain succeeded, so it could never report on a
 *     startup that died earlier.
 *   - the capability matrix is readable. `capability.can()` fails closed on an
 *     unknown capability, so a missing matrix silently denies everything —
 *     an app that appears to work and refuses every action.
 *   - subsystems that degraded on load, from safeRequire's record.
 *   - crash reports from previous runs, so a fault that killed the last launch is
 *     visible on this one instead of being forgotten.
 *
 * WHAT IT DOES ABOUT IT — and a correction. This block previously said repair was
 * impossible in an install, because "an install cannot npm-install into its own
 * read-only archive". That sentence is true; the conclusion drawn from it was not.
 * It answers whether the asar can be rewritten in place. It does not answer
 * whether a missing module can be obtained, which it can — `userData` is writable
 * and Node's module resolution can be pointed at it. Diagnosing a fault and then
 * asking master to reinstall is not self-healing, it is delegation with extra
 * steps. See `selfRepair.cjs` and spec Section 53.
 *
 * So `diagnose()` reports, and `repair()` acts: any missing package named in the
 * lockfile is fetched, checksum-verified, and made resolvable, then the failed
 * loads are retried and the diagnosis re-run. What genuinely remains beyond reach
 * is narrow and stated plainly — a native module needing a compiler, and a corrupt
 * asar, which is the auto-updater's job.
 */

const path = require('path');
const fs   = require('fs');

/** Dependencies the main process and API server genuinely need at runtime. */
const RUNTIME_CRITICAL = [
  { name: 'express',            gives: 'the local API server' },
  { name: 'cors',               gives: 'API request policy' },
  { name: 'helmet',             gives: 'API security headers' },
  { name: 'express-rate-limit', gives: 'API rate limiting' },
];

/** Present is better, absent is survivable — each already has a fallback. */
const RUNTIME_OPTIONAL = [
  { name: 'systeminformation', gives: 'CPU/RAM/thermal detail (falls back to Node os)' },
  { name: 'simple-git',        gives: 'git operations and timeline flashbacks' },
  { name: 'argon2',            gives: 'Argon2id hashing (falls back to scrypt)' },
  { name: 'node-pty',          gives: 'a real terminal (falls back to a piped shell)' },
  { name: 'playwright',        gives: 'browser automation (HTTP fetch still works)' },
  { name: 'vectra',            gives: 'vector memory (falls back to keyword search)' },
  { name: 'axios',             gives: 'some outbound HTTP paths' },
  { name: 'chokidar',          gives: 'file watching' },
  { name: 'electron-updater',  gives: 'self-update — the only repair channel an install has' },
  { name: 'mongodb',           gives: 'optional external database support' },
  { name: 'uuid',              gives: 'identifier generation' },
];

/**
 * Can this module be resolved from the app's own context?
 *
 * `require.resolve` rather than `require`: resolution is the question, and
 * executing a module to test whether it loads has side effects — a check that
 * changes the thing it measures is not a check.
 */
function resolves(name) {
  try { require.resolve(name); return true; }
  catch { return false; }
}

/**
 * @param {{safeRequireFailures?: Array, crashReports?: Array, appRoot?: string}} ctx
 * @returns {{ok:boolean, fatal:Array, degraded:Array, report:Array, previousCrash:object|null}}
 */
function diagnose(ctx = {}) {
  const fatal    = [];
  const degraded = [];
  const report   = [];

  const add = (label, pass, note = '') => report.push({ label, pass, note });

  // ── Runtime dependencies ───────────────────────────────────────────────────
  for (const dep of RUNTIME_CRITICAL) {
    const present = resolves(dep.name);
    add(dep.name, present, present ? '' : 'not resolvable');
    if (!present) {
      fatal.push({
        id: `dep-${dep.name}`,
        module: dep.name,
        detail: `${dep.name} is missing — ${dep.gives} cannot run`,
        remedy: 'Rāma will fetch it from the lockfile and retry; no action needed unless that fails.',
      });
    }
  }

  for (const dep of RUNTIME_OPTIONAL) {
    const present = resolves(dep.name);
    add(dep.name, present, present ? '' : 'absent — running on the fallback');
    if (!present) {
      degraded.push({ id: `dep-${dep.name}`, module: dep.name, detail: `${dep.name} absent — ${dep.gives}` });
    }
  }

  // ── Renderer bundle ────────────────────────────────────────────────────────
  const appRoot = ctx.appRoot ?? path.join(__dirname, '..', '..');
  const buildIndex = path.join(appRoot, 'build', 'index.html');
  const hasBuild = fs.existsSync(buildIndex);
  add('renderer bundle', hasBuild, hasBuild ? '' : `absent at ${buildIndex}`);
  if (!hasBuild) {
    // Not fatal in development: the Vite dev server serves the app instead.
    let packaged = false;
    try { packaged = !!require('electron').app?.isPackaged; } catch { /* assume dev */ }
    const entry = {
      id: 'renderer-missing',
      detail: 'The interface bundle is not present in this installation',
      remedy: 'Reinstall or update — the build was packaged incompletely.',
    };
    if (packaged) fatal.push(entry); else degraded.push(entry);
  }

  // ── Capability matrix ──────────────────────────────────────────────────────
  // A missing matrix does not throw: capability.can() returns false for unknown
  // capabilities by design (fail closed). The result is an app that starts and
  // then refuses every action, which looks like a permissions bug rather than a
  // missing file. Worth naming explicitly.
  let capsOk = false;
  let capsCount = 0;
  try {
    const caps = require('../../shared/capabilities.json');
    capsCount = Object.keys(caps?.capabilities ?? {}).length;
    capsOk = capsCount > 0;
  } catch { capsOk = false; }
  add('capability matrix', capsOk, capsOk ? `${capsCount} capabilities` : 'unreadable');
  if (!capsOk) {
    fatal.push({
      id: 'caps-missing',
      detail: 'shared/capabilities.json is unreadable — every action would be denied',
      remedy: 'Reinstall or update to a corrected build.',
    });
  }

  // ── Subsystems that degraded while loading ─────────────────────────────────
  for (const f of ctx.safeRequireFailures ?? []) {
    add(f.name, false, f.reason);
    degraded.push({ id: `load-${f.name}`, detail: `${f.name} did not load — ${f.reason}` });
  }

  // ── What was true when this build was made ─────────────────────────────────
  // Without this, every runtime degradation looks like damage. The manifest lets
  // Rāma say "node-pty was not compiled into this build" — an accepted trade-off
  // recorded at build time — rather than "node-pty is missing", which reads as a
  // broken installation and sends master looking for a fault that is not there.
  let buildManifest = null;
  try { buildManifest = require('../../shared/buildManifest.json'); }
  catch { /* built before manifests existed, or built by the raw build:win path */ }

  if (buildManifest) {
    add('build manifest', true,
      `${buildManifest.version} built ${String(buildManifest.builtAt).slice(0, 10)}, readiness ${buildManifest.readiness?.verdict ?? 'unknown'}`);
  } else {
    add('build manifest', false, 'absent — build-time limits unknown');
  }

  const known = new Set(
    (buildManifest?.readiness?.degraded ?? []).map(d => String(d).split(' ')[0]),
  );

  // Re-label anything the build already knew about, so it reads as expected rather
  // than as a new fault.
  for (const d of degraded) {
    const subject = String(d.detail).split(' ')[0];
    if (known.has(subject)) {
      d.expected = true;
      d.detail = `${d.detail} — known at build time, not a fault in this installation`;
    }
  }

  // ── A crash on a previous run ──────────────────────────────────────────────
  const previousCrash = (ctx.crashReports ?? [])[0] ?? null;

  return {
    ok: fatal.length === 0,
    fatal,
    degraded,
    report,
    previousCrash,
    buildManifest,
  };
}

/** One-line summary for the terminal and the health log. */
function summarise(result) {
  if (result.fatal.length > 0) {
    return `${result.fatal.length} fatal, ${result.degraded.length} degraded`;
  }
  if (result.degraded.length > 0) {
    return `healthy, ${result.degraded.length} capability(ies) on fallbacks`;
  }
  return 'healthy';
}

/**
 * The npm package name inside a "Cannot find module 'x'" reason.
 *
 * A first-party engine usually fails to load because of a missing *transitive*
 * package, not because the engine file is gone — `sysinfo` died on `debug`. The
 * name is therefore taken from the error text, which is untrusted input. That is
 * safe only because selfRepair refuses anything absent from the lockfile: the
 * worst a crafted message can do is name a package this build already contains.
 */
function missingModuleFrom(reason) {
  const m = /Cannot find module ['"]([^'"]+)['"]/.exec(String(reason ?? ''));
  if (!m) return null;
  const id = m[1];
  if (id.startsWith('.') || id.startsWith('/') || path.isAbsolute(id)) return null;   // first-party file
  const parts = id.split('/');
  return id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Act on the diagnosis: obtain what is missing, retry what failed, re-diagnose.
 *
 * Runs after the window exists rather than before it. A repair is network-bound
 * and an app that shows nothing until the network answers looks broken in exactly
 * the way this is meant to prevent; master gets a usable window first, then a
 * report of what was fixed underneath it.
 *
 * @param {object} result   the value returned by diagnose()
 * @param {object} ctx      same shape diagnose() takes, plus retryFailures
 * @returns {Promise<{attempted:string[], repaired:string[], stillMissing:string[],
 *                    recoveredSubsystems:string[], rediagnosed:object|null, notes:string[]}>}
 */
async function repair(result, ctx = {}) {
  const notes = [];
  const wanted = new Set();

  for (const entry of [...(result.fatal ?? []), ...(result.degraded ?? [])]) {
    if (entry.expected) continue;            // a build-time trade-off, not damage
    if (entry.module) { wanted.add(entry.module); continue; }
    const fromReason = missingModuleFrom(entry.detail);
    if (fromReason) wanted.add(fromReason);
  }

  for (const f of ctx.safeRequireFailures ?? []) {
    const name = missingModuleFrom(f.reason);
    if (name) wanted.add(name);
  }

  if (wanted.size === 0) {
    return { attempted: [], repaired: [], stillMissing: [], recoveredSubsystems: [], rediagnosed: null, notes: ['nothing to repair'] };
  }

  let selfRepair;
  try { selfRepair = require('./selfRepair.cjs'); }
  catch (e) {
    return { attempted: [...wanted], repaired: [], stillMissing: [...wanted], recoveredSubsystems: [], rediagnosed: null, notes: [`selfRepair unavailable: ${e.message}`] };
  }

  const repaired = [];
  const stillMissing = [];

  for (const name of wanted) {
    let res;
    try { res = await selfRepair.repairModule(name); }
    catch (e) { res = { ok: false, repaired: [], failed: [{ name, error: e.message }] }; }

    if (res.ok) repaired.push(...res.repaired);
    else {
      stillMissing.push(name);
      for (const f of res.failed ?? []) notes.push(`${f.name}: ${f.error}`);
    }
  }

  // A repaired package is only useful if the module that needed it now loads.
  let recoveredSubsystems = [];
  if (repaired.length > 0 && typeof ctx.retryFailures === 'function') {
    try { recoveredSubsystems = ctx.retryFailures().recovered ?? []; }
    catch (e) { notes.push(`retry failed: ${e.message}`); }
  }

  const rediagnosed = repaired.length > 0 ? diagnose(ctx) : null;

  return { attempted: [...wanted], repaired, stillMissing, recoveredSubsystems, rediagnosed, notes };
}

module.exports = { diagnose, repair, summarise, missingModuleFrom, RUNTIME_CRITICAL, RUNTIME_OPTIONAL };
