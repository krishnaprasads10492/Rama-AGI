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
  return null;
}

/**
 * Live status only — never mutates anything. Used to show master what a pull
 * would do before they ask for it.
 */
async function checkForUpdates(repoPath) {
  if (!repoPath) return { ok: false, error: 'repoPath is required' };
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
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
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
async function pullBuildApply({ repoPath, force = false, onLog = () => {} } = {}) {
  if (!repoPath) return { ok: false, error: 'repoPath is required' };

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
    return { ok: true, changed: false, message: 'Already up to date', fromHead: beforeHead, toHead: afterHead };
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

  const requiresAppRestart   = domains.has('main') || domains.has('server') || domains.has('deps');
  const requiresWindowReload = domains.has('renderer') && !requiresAppRestart;

  onLog(
    requiresAppRestart
      ? 'Done. electron/server/dependency files changed — a full app restart is needed to load them.\n'
      : requiresWindowReload
        ? 'Done. Renderer rebuilt — the window can reload now.\n'
        : 'Done. No domain needed a rebuild or restart (e.g. docs/config-only changes).\n'
  );

  return {
    ok: true,
    changed: true,
    fromHead: beforeHead,
    toHead: afterHead,
    domains: [...domains],
    installRan,
    buildRan,
    requiresAppRestart,
    requiresWindowReload,
  };
}

module.exports = { checkForUpdates, pullBuildApply, classifyChange };
