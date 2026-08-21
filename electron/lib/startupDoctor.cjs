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
 * WHAT IT DOES NOT DO: repair. An install cannot npm-install into its own
 * read-only archive, and claiming otherwise would be a lie told by the component
 * whose entire job is honesty. Recovery for a packaged app is: degrade the
 * affected capability, tell master precisely what is missing, and offer the update
 * channel — which genuinely can replace a broken build. Repair belongs to
 * `start.cjs` in a checkout, and to the auto-updater in an install.
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
        detail: `${dep.name} is missing — ${dep.gives} cannot run`,
        remedy: 'This installation is incomplete. Reinstall or update to a corrected build.',
      });
    }
  }

  for (const dep of RUNTIME_OPTIONAL) {
    const present = resolves(dep.name);
    add(dep.name, present, present ? '' : 'absent — running on the fallback');
    if (!present) {
      degraded.push({ id: `dep-${dep.name}`, detail: `${dep.name} absent — ${dep.gives}` });
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

  // ── A crash on a previous run ──────────────────────────────────────────────
  const previousCrash = (ctx.crashReports ?? [])[0] ?? null;

  return {
    ok: fatal.length === 0,
    fatal,
    degraded,
    report,
    previousCrash,
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

module.exports = { diagnose, summarise, RUNTIME_CRITICAL, RUNTIME_OPTIONAL };
