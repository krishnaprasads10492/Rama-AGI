'use strict';

const simpleGit = require('simple-git');
const chokidar  = require('chokidar');
const path      = require('path');
const capability = require('../lib/capability.cjs');

// Active watchers per repo path
const watchers = {};

// ─── Register all git IPC handlers ───────────────────────────────────────────
// Reads (status/diff/log/branches/remotes) gate on git.read (tier 3);
// stage/commit gate on git.commit (tier 2); push gates on git.push (tier 1);
// clone writes to an arbitrary destination so it uses git.push's tier too.
// These capabilities already existed in shared/capabilities.json but nothing
// here checked them before this fix.
function register(ipcMain) {

  // ── Status ────────────────────────────────────────────────────────────────
  ipcMain.handle('git:status', async (_e, { user, repoPath } = {}) => {
    const denied = capability.deny(user, 'git.read');
    if (denied) return denied;
    try {
      const git    = simpleGit(repoPath);
      const status = await git.status();
      const log    = await git.log({ maxCount: 1 }).catch(() => ({ latest: null }));
      return {
        ok: true,
        data: {
          branch:       status.current,
          tracking:     status.tracking,
          ahead:        status.ahead,
          behind:       status.behind,
          staged:       status.staged,
          modified:     status.modified,
          not_added:    status.not_added,
          deleted:      status.deleted,
          renamed:      status.renamed,
          conflicted:   status.conflicted,
          isClean:      status.isClean(),
          lastCommit:   log.latest,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Diff ──────────────────────────────────────────────────────────────────
  ipcMain.handle('git:diff', async (_e, { user, repoPath } = {}) => {
    const denied = capability.deny(user, 'git.read');
    if (denied) return denied;
    try {
      const git  = simpleGit(repoPath);
      const diff = await git.diff();
      return { ok: true, data: diff };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Log ───────────────────────────────────────────────────────────────────
  ipcMain.handle('git:log', async (_e, { user, repoPath, limit = 50 } = {}) => {
    const denied = capability.deny(user, 'git.read');
    if (denied) return denied;
    try {
      const git = simpleGit(repoPath);
      const log = await git.log({ maxCount: limit });
      return { ok: true, data: log.all };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Stage files ───────────────────────────────────────────────────────────
  ipcMain.handle('git:stage', async (_e, { user, repoPath, files } = {}) => {
    const denied = capability.deny(user, 'git.commit');
    if (denied) return denied;
    try {
      const git = simpleGit(repoPath);
      if (Array.isArray(files) && files.length > 0) {
        await git.add(files);
      } else {
        await git.add('.');
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Commit ────────────────────────────────────────────────────────────────
  ipcMain.handle('git:commit', async (_e, { user, repoPath, message } = {}) => {
    const denied = capability.deny(user, 'git.commit');
    if (denied) return denied;
    try {
      const git    = simpleGit(repoPath);
      const result = await git.commit(message);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Push ──────────────────────────────────────────────────────────────────
  ipcMain.handle('git:push', async (_e, { user, repoPath, branch = 'HEAD' } = {}) => {
    const denied = capability.deny(user, 'git.push');
    if (denied) return denied;
    try {
      const git    = simpleGit(repoPath);
      const result = await git.push('origin', branch);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Pull ──────────────────────────────────────────────────────────────────
  ipcMain.handle('git:pull', async (_e, { user, repoPath } = {}) => {
    const denied = capability.deny(user, 'git.commit');
    if (denied) return denied;
    try {
      const git    = simpleGit(repoPath);
      const result = await git.pull();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Clone ─────────────────────────────────────────────────────────────────
  ipcMain.handle('git:clone', async (_e, { user, url, dest } = {}) => {
    const denied = capability.deny(user, 'git.push');
    if (denied) return denied;
    try {
      const git = simpleGit();
      await git.clone(url, dest);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get branches ─────────────────────────────────────────────────────────
  ipcMain.handle('git:get-branches', async (_e, { user, repoPath } = {}) => {
    const denied = capability.deny(user, 'git.read');
    if (denied) return denied;
    try {
      const git      = simpleGit(repoPath);
      const branches = await git.branchLocal();
      const remote   = await git.branch(['-r']).catch(() => ({ all: [] }));
      return {
        ok: true,
        data: {
          local:   branches.all,
          current: branches.current,
          remote:  remote.all,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Checkout branch ───────────────────────────────────────────────────────
  ipcMain.handle('git:checkout', async (_e, { user, repoPath, branch } = {}) => {
    const denied = capability.deny(user, 'git.commit');
    if (denied) return denied;
    try {
      const git = simpleGit(repoPath);
      await git.checkout(branch);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get remotes ───────────────────────────────────────────────────────────
  ipcMain.handle('git:get-remotes', async (_e, { user, repoPath } = {}) => {
    const denied = capability.deny(user, 'git.read');
    if (denied) return denied;
    try {
      const git     = simpleGit(repoPath);
      const remotes = await git.getRemotes(true);
      return { ok: true, data: remotes };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Auto-watch repo (chokidar → notify renderer on changes) ──────────────
  ipcMain.handle('git:start-watch', async (event, repoPath) => {
    if (watchers[repoPath]) return { ok: true, message: 'already watching' };

    try {
      const watcher = chokidar.watch(repoPath, {
        ignored:        /(^|[/\\])\.git([/\\]|$)/,
        persistent:     true,
        ignoreInitial:  true,
        depth:          4,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      });

      let debounceTimer = null;
      const notify = (type, filePath) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            const git    = simpleGit(repoPath);
            const status = await git.status();
            event.sender.send('git:watch-event', {
              type,
              path:  filePath,
              dirty: !status.isClean(),
              modified: status.modified,
              not_added: status.not_added,
              deleted: status.deleted,
              ts: Date.now(),
            });
          } catch { /* ignore */ }
        }, 600);
      };

      watcher.on('add',    (p) => notify('add',    p));
      watcher.on('change', (p) => notify('change', p));
      watcher.on('unlink', (p) => notify('delete', p));

      watchers[repoPath] = watcher;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('git:stop-watch', async (_e, repoPath) => {
    if (watchers[repoPath]) {
      await watchers[repoPath].close();
      delete watchers[repoPath];
    }
    return { ok: true };
  });
}

module.exports = { register };
