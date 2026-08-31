'use strict';

/**
 * localUpdateEngine.cjs — master's own local CI/CD: pull the configured repo,
 * install/build if needed, and hand back what changed so the caller can apply
 * it to the RUNNING instance — no GitHub Actions, no external pipeline.
 *
 * WHY THIS IS SEPARATE FROM `releaseChannel.cjs`: that module is about cutting
 * a versioned release for OTHER installed copies to eventually receive via the
 * auto-updater (future scope, explicitly deferred). This module is about
 * updating THIS running instance from THIS machine's own git history right
 * now — the "for now" ask. They share no code because they solve different
 * problems: one is distribution, this one is local self-update.
 *
 * WHY THIS DOES NOT GO THROUGH `proposals.cjs` (I6): the code being pulled in
 * already exists in git history — committed by master or through whatever
 * review process master already uses before pushing. This module fetches and
 * builds it; it does not author new source. That is the same category as
 * `git.cjs`'s pull/checkout handlers, which also bypass the ledger. What IS
 * gated is tier — only master may trigger it (`system.self-update`, tier 0).
 *
 * WHAT IT ACTUALLY DOES, IN ORDER:
 *   1. Refuse if the working tree is dirty (unless `force`) — a pull must
 *      never silently discard uncommitted local edits.
 *   2. git pull the current branch's upstream.
 *   3. Diff the two HEADs to see which domains changed (same classification
 *      start.cjs's live-reload watcher already uses, so behaviour matches
 *      what a manual file edit would trigger).
 *   4. `npm install` only if package.json/package-lock.json changed.
 *   5. `npm run build` only if renderer-domain files changed.
 *   6. Report whether the running process needs a full restart (main/server/
 *      deps changed) or just a window reload (renderer-only) — it does NOT
 *      restart or reload anything itself; the caller (main.cjs, which owns
 *      the window and the app lifecycle) decides when, since master should
 *      see the outcome before the app relaunches out from under them.
 */

const simpleGit = require('simple-git');
const { spawn } = require('child_process');
const path = require('path');

// The SAME command string `aiProcess.cjs` spawns. pip is invoked as `<this> -m pip` rather than a
// bare `pip`, because a bare `pip` on PATH can belong to a different interpreter than the one the
// backend actually runs under — the install would succeed and the backend still would not have the
// package. Going through `-m` makes that mismatch impossible by construction (Section 80).
const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

/**
 * Which domain does a changed path belong to? Mirrors start.cjs's
 * `classifyChange` exactly, so a git-pulled change is treated the same way a
 * file-save change already is — one rule, not two that could drift apart.
 */
function classifyChange(rel) {
  const p = String(rel).replace(/\\/g, '/');
  if (p === 'package.json' || p === 'package-lock.json') return 'deps';
  if (p.startsWith('electron/')) return 'main';
  if (p.startsWith('server/'))   return 'server';
  if (p.startsWith('src/') || p.startsWith('shared/')) return 'renderer';
  if (p === 'index.html' || p === 'vite.config.js')     return 'renderer';
  // THE PYTHON ENGINE USED TO FALL THROUGH TO null (spec Section 80). Every consequence came
  // from that one omission: a pull containing new engine code set no restart flag, the running
  // Python child kept serving the OLD module set, and new routes 404'd against a repo that
  // visibly contained them. The update reported success while the running system did not have
  // the code — the worst shape a bug can take.
  if (p === 'ai_backend/requirements.txt') return 'pydeps';
  if (p.startsWith('ai_backend/'))         return 'python';
  return null;
}

/**
 * Would pulling `repoPath` change the code THIS process is executing?
 *
 * A packaged install has no `.git`, no `src/` and no `node_modules` — its code lives inside a
 * read-only `app.asar`. Master can still legitimately keep a clone on the same machine and update
 * it through Rāma's git UI before rebuilding the installer, so this is reported rather than
 * blocked; what must not happen is implying the update landed on the running app.
 */
function resolveTarget({ repoPath, packaged = false, appPath = null } = {}) {
  const out = { packaged: !!packaged, updatesRunningInstance: false, guidance: null };
  if (packaged) {
    out.guidance =
      'This copy of Rāma was installed from a setup file, so its code lives inside a read-only '
      + 'app.asar with no git repository. Pulling here updates the clone you selected, NOT the '
      + 'running app. To update the installed app: git pull, npm install, npm run package:win, '
      + 'then run the produced installer over this one. Your data directory is outside the app '
      + 'and is not touched.';
    return out;
  }
  if (!appPath) {
    out.guidance = 'Could not determine where this instance runs from, so whether the pull '
      + 'affects it is unknown. Treating it as if it does not.';
    return out;
  }
  try {
    const repo = path.resolve(repoPath);
    const app = path.resolve(appPath);
    const rel = path.relative(repo, app);
    // Inside, or the same directory. `..` means the app lives outside the repo entirely.
    out.updatesRunningInstance = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    out.updatesRunningInstance = false;
  }
  out.guidance = out.updatesRunningInstance
    ? 'This pull updates the code this instance runs from.'
    : 'The selected repository is not where this instance runs from, so pulling it will not '
      + 'change the running app.';
  return out;
}

/**
 * Live status only — never mutates anything. Used to show master what a pull
 * would do before they ask for it.
 */
async function checkForUpdates(repoPath, { packaged = false, appPath = null } = {}) {
  if (!repoPath) return { ok: false, error: 'repoPath is required' };
  const target = resolveTarget({ repoPath, packaged, appPath });
  try {
    const git = simpleGit(repoPath);
    await git.fetch();
    const status = await git.status();

    let commits = [];
    if (status.behind > 0 && status.tracking) {
      const log = await git.log({ from: 'HEAD', to: status.tracking }).catch(() => ({ all: [] }));
      commits = (log.all || []).map(c => ({
        hash: c.hash.slice(0, 7), message: c.message, author: c.author_name, date: c.date,
      }));
    }

    return {
      ok: true,
      data: {
        branch:    status.current,
        tracking:  status.tracking,
        ahead:     status.ahead,
        behind:    status.behind,
        isClean:   status.isClean(),
        upToDate:  status.behind === 0,
        commits,
        ...target,
      },
    };
  } catch (err) {
    // A packaged install has no repository, so the raw git error reads like a broken feature
    // rather than a category error. Say which it is.
    return {
      ok: false,
      error: packaged
        ? `Not a git repository. ${target.guidance}`
        : err.message,
      ...target,
    };
  }
}

/** Run a command, streaming both stdout and stderr line-by-line to onLog. */
function runStreamed(cmd, args, opts, onLog) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
    } catch (err) {
      resolve({ ok: false, error: err.message, out: '' });
      return;
    }

    let out = '';
    proc.stdout?.on('data', d => { out += d; onLog?.(String(d)); });
    proc.stderr?.on('data', d => { out += d; onLog?.(String(d)); });
    proc.on('error', (err) => resolve({ ok: false, error: err.message, out }));
    proc.on('close', (code) => resolve({ ok: code === 0, code, out }));
  });
}

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * @param {object} opts { repoPath, force, onLog }
 * @returns {Promise<object>} outcome — never restarts/reloads anything itself.
 */
async function pullBuildApply({ repoPath, force = false, onLog = () => {},
  packaged = false, appPath = null } = {}) {
  if (!repoPath) return { ok: false, error: 'repoPath is required' };

  const target = resolveTarget({ repoPath, packaged, appPath });
  if (!target.updatesRunningInstance) {
    onLog(`NOTE: ${target.guidance}\n`);
  }

  const git = simpleGit(repoPath);

  let status;
  try { status = await git.status(); }
  catch (err) { return { ok: false, error: `git status failed: ${err.message}` }; }

  if (!status.isClean() && !force) {
    return {
      ok: false, dirty: true,
      error: 'Local changes present — commit or stash them, or retry with force:true (uncommitted edits are never silently discarded)',
    };
  }

  let beforeHead;
  try { beforeHead = (await git.revparse(['HEAD'])).trim(); }
  catch (err) { return { ok: false, error: `git revparse failed: ${err.message}` }; }

  onLog(`Pulling ${status.tracking || `origin/${status.current}`}...\n`);
  try {
    await git.pull();
  } catch (err) {
    return { ok: false, error: `git pull failed: ${err.message}`, fromHead: beforeHead };
  }

  let afterHead;
  try { afterHead = (await git.revparse(['HEAD'])).trim(); }
  catch (err) { return { ok: false, error: `git revparse failed after pull: ${err.message}` }; }

  if (beforeHead === afterHead) {
    onLog('Already up to date.\n');
    return { ok: true, changed: false, message: 'Already up to date',
      fromHead: beforeHead, toHead: afterHead, ...target };
  }

  let diffFiles = [];
  try {
    const diff = await git.diff(['--name-only', beforeHead, afterHead]);
    diffFiles = diff.split('\n').map(l => l.trim()).filter(Boolean);
  } catch (err) {
    onLog(`Could not diff changed files (${err.message}) — proceeding conservatively as if everything changed.\n`);
    diffFiles = ['package.json', 'electron/', 'src/'];   // safe over-approximation
  }

  const domains = new Set(diffFiles.map(classifyChange).filter(Boolean));
  onLog(`${diffFiles.length} file(s) changed — domains: ${[...domains].join(', ') || 'none recognised'}\n`);

  let installRan = false;
  if (domains.has('deps')) {
    onLog('package.json/package-lock.json changed — running npm install...\n');
    const res = await runStreamed(npmBin, ['install', '--no-audit', '--no-fund'], { cwd: repoPath }, onLog);
    installRan = true;
    if (!res.ok) {
      return { ok: false, error: `npm install failed${res.error ? `: ${res.error}` : ''}`, fromHead: beforeHead, toHead: afterHead, domains: [...domains] };
    }
  }

  let buildRan = false;
  if (domains.has('renderer')) {
    onLog('Renderer/shared files changed — running npm run build...\n');
    const res = await runStreamed(npmBin, ['run', 'build'], { cwd: repoPath }, onLog);
    buildRan = true;
    if (!res.ok) {
      return { ok: false, error: `npm run build failed${res.error ? `: ${res.error}` : ''}`, fromHead: beforeHead, toHead: afterHead, domains: [...domains] };
    }
  }

  // ── Python engine (Section 80) ────────────────────────────────────────────
  //
  // Skipped when the pull does not update the running instance: installing dependencies for code
  // that will not be loaded, or respawning a backend that reads from `resources/ai_backend`, would
  // both be theatre. Skipping is REPORTED, never silent.
  let pipRan = false;
  let pipSkippedReason = null;
  if (domains.has('pydeps')) {
    if (!target.updatesRunningInstance) {
      pipSkippedReason = 'requirements.txt changed, but this pull does not update the running '
        + 'instance, so its dependencies were left alone';
      onLog(`Skipping pip install — ${pipSkippedReason}.\n`);
    } else {
      onLog(`ai_backend/requirements.txt changed — running ${pythonBin} -m pip install...\n`);
      const res = await runStreamed(
        pythonBin,
        ['-m', 'pip', 'install', '-r', path.join('ai_backend', 'requirements.txt')],
        { cwd: repoPath }, onLog);
      pipRan = true;
      if (!res.ok) {
        return {
          ok: false,
          error: `pip install failed${res.error ? `: ${res.error}` : ''}`
            + ` — StockMind's engine may not start until its dependencies are installed`,
          fromHead: beforeHead, toHead: afterHead, domains: [...domains], ...target,
        };
      }
    }
  }

  const pythonChanged = domains.has('python') || domains.has('pydeps');
  const requiresAppRestart   = domains.has('main') || domains.has('server') || domains.has('deps');
  const requiresWindowReload = domains.has('renderer') && !requiresAppRestart;
  // DELIBERATELY SEPARATE FROM requiresAppRestart. Relaunching the whole application to pick up a
  // Python change is heavier than the change needs and throws away master's window state; the
  // backend is a child process that can be respawned on its own.
  const requiresBackendRestart = pythonChanged && target.updatesRunningInstance;

  const lines = [];
  if (requiresAppRestart) {
    lines.push('electron/server/dependency files changed — a full app restart is needed.');
  } else if (requiresWindowReload) {
    lines.push('Renderer rebuilt — the window can reload now.');
  }
  if (requiresBackendRestart) {
    lines.push('ai_backend changed — the Python engine must be respawned to serve the new code.');
  }
  if (pythonChanged && !target.updatesRunningInstance) {
    lines.push('ai_backend changed in the pulled repository, but the running engine loads from '
      + 'elsewhere and is unaffected.');
  }
  if (lines.length === 0) {
    lines.push('No domain needed a rebuild or restart (e.g. docs or config only).');
  }
  onLog(`Done. ${lines.join(' ')}\n`);

  return {
    ok: true,
    changed: true,
    fromHead: beforeHead,
    toHead: afterHead,
    domains: [...domains],
    installRan,
    buildRan,
    pipRan,
    pipSkippedReason,
    requiresAppRestart,
    requiresWindowReload,
    requiresBackendRestart,
    outcome: lines.join(' '),
    ...target,
  };
}

module.exports = { checkForUpdates, pullBuildApply, classifyChange, resolveTarget, pythonBin };
