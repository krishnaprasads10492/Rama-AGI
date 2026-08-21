'use strict';

/**
 * crashGuard.cjs — the first thing the main process installs, and the reason a
 * packaged Rāma can no longer die without saying why.
 *
 * WHAT HAPPENED WITHOUT IT: the installed app hit
 * `Error: Cannot find module 'debug'` from a module-scope require in main.cjs's
 * chain. Electron showed its own raw error dialog with a stack trace, and the
 * process exited. Nothing of Rāma's own diagnostics ran, because all of it —
 * `selfCare`'s sweep, `bootFailurePage`, `genome.verify()` — is registered inside
 * `app.whenReady()`, which is hundreds of lines downstream of the require that
 * threw. A grep for `uncaughtException` across `electron/**` returned nothing.
 *
 * THE ASYMMETRY THAT MATTERS: `start.cjs` has a full staged diagnose-and-heal
 * layer — `installDeps`, `rebuildNative`, `buildFrontend`, `freePort`, scenario
 * memory — and **none of it is in the installer**. `start.cjs` is not in
 * `build.files`, and could not work there anyway: every repair shells out to npm
 * against a writable source tree, and an install has no npm, no `vite`, and a
 * read-only asar. So the packaged app inherited monitoring and lost repair.
 *
 * WHAT THIS MODULE HONESTLY CLAIMS. A packaged app cannot npm-install a module
 * into its own read-only archive, and pretending otherwise would be worse than
 * the crash. What it can do, and now does:
 *
 *   1. survive  — claim the exception instead of letting Electron kill the app
 *   2. explain  — name the missing piece, in master's language, not a stack trace
 *   3. record   — write a report to userData, which IS writable, so the failure
 *                 is available afterwards instead of vanishing with the dialog
 *   4. act      — offer the recoveries that genuinely exist for an install:
 *                 relaunch, fetch a corrected build, open the report
 *
 * Contain, explain, recover. Not magic.
 *
 * ZERO DEPENDENCIES BY DESIGN: this module requires only `electron` and Node
 * core. A crash handler that needs a third-party package cannot report a missing
 * third-party package — it would fail in exactly the situation it exists for.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

let installed = false;
let handling  = false;   // a fault inside the handler must not recurse forever
const faults  = [];

/** Where a report can actually be written. userData is writable; the asar is not. */
function reportDir() {
  let base = null;
  try {
    const { app } = require('electron');
    base = app?.getPath('userData') ?? null;
  } catch { /* app may be unavailable very early */ }
  if (!base) base = path.join(os.homedir(), '.rama-agi');
  return path.join(base, 'crash');
}

/**
 * Pull the module name out of a resolution failure.
 * Node's message is `Cannot find module 'debug'`, which is the single most useful
 * fact in the whole report and the one a raw stack buries.
 */
function missingModuleFrom(err) {
  const msg = String(err?.message ?? '');
  if (err?.code !== 'MODULE_NOT_FOUND' && !/cannot find module/i.test(msg)) return null;
  const m = msg.match(/cannot find module ['"]([^'"]+)['"]/i);
  return m ? m[1] : null;
}

/** The require chain, which says which of Rāma's parts wanted the missing thing. */
function requireStackFrom(err) {
  const stack = Array.isArray(err?.requireStack) ? err.requireStack : [];
  return stack.slice(0, 12);
}

function isPackaged() {
  try { return !!require('electron').app?.isPackaged; } catch { return false; }
}

function buildReport(err, origin) {
  const missing = missingModuleFrom(err);
  return {
    ts:        new Date().toISOString(),
    origin,                                   // 'uncaughtException' | 'unhandledRejection'
    packaged:  isPackaged(),
    fatalKind: missing ? 'missing-module' : 'unhandled-error',
    missingModule: missing,
    message:   String(err?.message ?? err),
    code:      err?.code ?? null,
    requireStack: requireStackFrom(err),
    stack:     String(err?.stack ?? '').split('\n').slice(0, 30),
    versions:  { node: process.versions.node, electron: process.versions.electron ?? null },
    platform:  `${process.platform}-${process.arch}`,
  };
}

function writeReport(report) {
  try {
    const dir = reportDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `crash-${report.ts.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    pruneReports(dir);
    return file;
  } catch {
    return null;   // never let reporting failure mask the original fault
  }
}

/** Keep the newest 20 reports; a crash directory that grows forever is its own bug. */
function pruneReports(dir, keep = 20) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => /^crash-.*\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) {
      try { fs.rmSync(path.join(dir, f)); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

/**
 * What master can actually do about it, phrased for the build they are running.
 *
 * The distinction is not cosmetic: `bootFailurePage` told installed users to run
 * `npm install && npm run build && node start.cjs --prod`, which is impossible
 * from an installed app — no npm, no source, no start.cjs. Advice that cannot be
 * followed is worse than none, because it wastes the trust it spends.
 */
function guidanceFor(report) {
  const packaged = report.packaged;

  if (report.fatalKind === 'missing-module') {
    return packaged
      ? [
        `A component Rāma needs ("${report.missingModule}") is not present in this installation.`,
        'The installation is incomplete — this is a packaging fault, not something you did.',
        'Reinstalling, or updating to a newer build, replaces the missing piece.',
      ]
      : [
        `The module "${report.missingModule}" could not be resolved.`,
        'In a development checkout this is normally a missing or partial install.',
        'Fix: npm install    (then: node start.cjs)',
      ];
  }

  return packaged
    ? [
      'Rāma hit an error it could not recover from during startup.',
      'The full report has been saved so the cause is not lost.',
      'Relaunching often clears a transient fault; updating replaces a persistent one.',
    ]
    : [
      'Rāma hit an unhandled error during startup.',
      'The full report has been saved next to the app data.',
    ];
}

function headline(report) {
  if (report.fatalKind === 'missing-module') {
    return `Rāma is missing a component: ${report.missingModule}`;
  }
  return 'Rāma could not finish starting up';
}

/**
 * Tell master, and offer the recoveries that exist.
 *
 * A native dialog rather than a BrowserWindow on purpose. The failure being
 * reported may be a missing module in the require chain; a window needs the
 * renderer, a preload bridge and possibly the very packages that are absent,
 * so it can fail in the same way as the thing it is reporting. `dialog` is part
 * of the Electron runtime and works when nothing else does. Reliability beats
 * presentation in a crash path.
 */
async function tellMaster(report, reportFile) {
  let electron;
  try { electron = require('electron'); } catch { return; }
  const { app, dialog, shell } = electron;
  if (!app || !dialog) return;

  try { if (!app.isReady()) await app.whenReady(); } catch { /* proceed anyway */ }

  const lines = guidanceFor(report);
  const buttons = ['Relaunch Rāma', 'Show the report', 'Quit'];

  let choice = 2;
  try {
    const res = await dialog.showMessageBox({
      type: 'error',
      title: 'Rāma AGI',
      message: headline(report),
      detail: [
        ...lines,
        '',
        report.requireStack.length
          ? `Wanted by: ${path.basename(report.requireStack[0] ?? '')}`
          : '',
        reportFile ? `Report: ${reportFile}` : 'The report could not be written to disk.',
      ].filter(Boolean).join('\n'),
      buttons,
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    choice = res.response;
  } catch { /* fall through to quit */ }

  try {
    if (choice === 0) {
      app.relaunch();
      app.exit(0);
      return;
    }
    if (choice === 1 && reportFile && shell) {
      shell.showItemInFolder(reportFile);
    }
  } catch { /* best effort */ }

  try { app.exit(1); } catch { process.exit(1); }
}

/**
 * Install the guard. Call this as the FIRST statement of the main process, before
 * any other require — a guard installed after the require that throws protects
 * nothing, which is precisely how the original crash escaped.
 *
 * @param {{onFault?: function}} [opts]
 */
function install(opts = {}) {
  if (installed) return { ok: true, already: true };
  installed = true;

  const handle = (err, origin) => {
    // Log first, always, before anything that could itself fail.
    try {
      console.error(`[crashGuard] ${origin}:`, err?.stack ?? err);
    } catch { /* stderr may be closed in a packaged app */ }

    if (handling) {
      // A fault while reporting a fault. Stop cleanly rather than loop.
      try { require('electron').app?.exit(1); } catch { process.exit(1); }
      return;
    }
    handling = true;

    const report = buildReport(err, origin);
    faults.push(report);

    const file = writeReport(report);
    try { opts.onFault?.(report, file); } catch { /* observer must not break the handler */ }

    // Fire and forget: the process stays alive only long enough to tell master.
    tellMaster(report, file).catch(() => {
      try { require('electron').app?.exit(1); } catch { process.exit(1); }
    });
  };

  process.on('uncaughtException', (err) => handle(err, 'uncaughtException'));

  // An unhandled rejection is not necessarily fatal, but during startup it
  // usually means an await chain that never completed — silently continuing
  // leaves a half-initialised app, which is harder to diagnose than a stop.
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    handle(err, 'unhandledRejection');
  });

  return { ok: true, reportDir: reportDir() };
}

/** Reports written by previous runs — so the app can surface a past crash. */
function recentReports(limit = 5) {
  try {
    const dir = reportDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /^crash-.*\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, limit)
      .map(({ f }) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch { return { ts: null, message: `unreadable report: ${f}` }; }
      });
  } catch { return []; }
}

module.exports = {
  install, recentReports, reportDir,
  // exported for tests — the classification is the part worth verifying
  missingModuleFrom, buildReport, guidanceFor, headline,
};
