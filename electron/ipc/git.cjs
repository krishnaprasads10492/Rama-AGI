'use strict';

const simpleGit = require('simple-git');
const chokidar  = require('chokidar');
const path      = require('path');

// Active watchers per repo path
const watchers = {};

// ─── Register all git IPC handlers ───────────────────────────────────────────
function register(ipcMain) {

  // ── Status ────────────────────────────────────────────────────────────────
  ipcMain.handle('git:status', async (_e, repoPath) => {
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
  ipcMain.handle('git:diff', async (_e, repoPath) => {
    try {
      const git  = simpleGit(repoPath);
      const diff = await git.diff();
      return { ok: true, data: diff };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Log ───────────────────────────────────────────────────────────────────
  ipcMain.handle('git:log', async (_e, repoPath, limit = 50) => {
    try {
      const git = simpleGit(repoPath);
      const log = await git.log({ maxCount: limit });
      return { ok: true, data: log.all };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Stage files ───────────────────────────────────────────────────────────
  ipcMain.handle('git:stage', async (_e, repoPath, files) => {
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
  ipcMain.handle('git:commit', async (_e, repoPath, message) => {
    try {
      const git    = simpleGit(repoPath);
      const result = await git.commit(message);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Push ──────────────────────────────────────────────────────────────────
  ipcMain.handle('git:push', async (_e, repoPath, branch = 'HEAD') => {
    try {
      const git    = simpleGit(repoPath);
      const result = await git.push('origin', branch);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Pull ──────────────────────────────────────────────────────────────────
  ipcMain.handle('git:pull', async (_e, repoPath) => {
    try {
      const git    = simpleGit(repoPath);
      const result = await git.pull();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Clone ─────────────────────────────────────────────────────────────────
  ipcMain.handle('git:clone', async (_e, url, dest) => {
    try {
      const git = simpleGit();
      await git.clone(url, dest);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get branches ─────────────────────────────────────────────────────────
  ipcMain.handle('git:get-branches', async (_e, repoPath) => {
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
  ipcMain.handle('git:checkout', async (_e, repoPath, branch) => {
    try {
      const git = simpleGit(repoPath);
      await git.checkout(branch);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get remotes ───────────────────────────────────────────────────────────
  ipcMain.handle('git:get-remotes', async (_e, repoPath) => {
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
