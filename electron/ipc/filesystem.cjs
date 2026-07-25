'use strict';

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const os      = require('os');
const { dialog } = require('electron');

// ─── Register all filesystem IPC handlers ────────────────────────────────────
function register(ipcMain) {

  // ── Read file ─────────────────────────────────────────────────────────────
  ipcMain.handle('fs:read-file', async (_e, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Write file ────────────────────────────────────────────────────────────
  ipcMain.handle('fs:write-file', async (_e, filePath, content) => {
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Delete file/dir ───────────────────────────────────────────────────────
  ipcMain.handle('fs:delete-file', async (_e, filePath) => {
    try {
      await fs.promises.rm(filePath, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── List directory ────────────────────────────────────────────────────────
  ipcMain.handle('fs:list-dir', async (_e, dirPath) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const items = await Promise.all(
        entries.map(async (e) => {
          const full = path.join(dirPath, e.name);
          let size = 0, mtime = null;
          try {
            const stat = await fs.promises.stat(full);
            size  = stat.size;
            mtime = stat.mtimeMs;
          } catch { /* ignore */ }
          return {
            name:  e.name,
            path:  full,
            isDir: e.isDirectory(),
            isFile: e.isFile(),
            size,
            mtime,
            ext:   e.isFile() ? path.extname(e.name).toLowerCase() : null,
          };
        })
      );
      // Dirs first, then files, both alphabetical
      items.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      return { ok: true, data: items, cwd: dirPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Create directory ──────────────────────────────────────────────────────
  ipcMain.handle('fs:create-dir', async (_e, dirPath) => {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Rename ────────────────────────────────────────────────────────────────
  ipcMain.handle('fs:rename', async (_e, oldPath, newPath) => {
    try {
      await fs.promises.rename(oldPath, newPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Copy file ─────────────────────────────────────────────────────────────
  ipcMain.handle('fs:copy-file', async (_e, src, dest) => {
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(src, dest);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Move file ─────────────────────────────────────────────────────────────
  ipcMain.handle('fs:move-file', async (_e, src, dest) => {
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.rename(src, dest);
      return { ok: true };
    } catch (err) {
      // cross-device fallback
      try {
        await fs.promises.copyFile(src, dest);
        await fs.promises.unlink(src);
        return { ok: true };
      } catch (e2) {
        return { ok: false, error: e2.message };
      }
    }
  });

  // ── Get file stats ────────────────────────────────────────────────────────
  ipcMain.handle('fs:get-stats', async (_e, filePath) => {
    try {
      const stat = await fs.promises.stat(filePath);
      return {
        ok: true,
        data: {
          size:    stat.size,
          isDir:   stat.isDirectory(),
          isFile:  stat.isFile(),
          created: stat.birthtimeMs,
          modified: stat.mtimeMs,
          accessed: stat.atimeMs,
          mode:    stat.mode,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Search files ──────────────────────────────────────────────────────────
  ipcMain.handle('fs:search-files', async (_e, dir, query) => {
    try {
      const results = [];
      const q = query.toLowerCase();
      const walk = async (p, depth = 0) => {
        if (depth > 8) return;
        const entries = await fs.promises.readdir(p, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          if (['node_modules', '__pycache__', '.git'].includes(e.name)) continue;
          const full = path.join(p, e.name);
          if (e.name.toLowerCase().includes(q)) {
            results.push({ name: e.name, path: full, isDir: e.isDirectory() });
          }
          if (e.isDirectory()) await walk(full, depth + 1);
          if (results.length >= 200) return;
        }
      };
      await walk(dir);
      return { ok: true, data: results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Disk sizes (folder analysis) ──────────────────────────────────────────
  ipcMain.handle('fs:get-disk-sizes', async (_e, dir) => {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      const results = await Promise.all(
        entries.map(async (e) => {
          const full = path.join(dir, e.name);
          let size = 0;
          if (e.isDirectory()) {
            size = await fastDirSize(full);
          } else {
            const stat = await fs.promises.stat(full).catch(() => null);
            size = stat?.size ?? 0;
          }
          return { name: e.name, path: full, isDir: e.isDirectory(), size };
        })
      );
      results.sort((a, b) => b.size - a.size);
      return { ok: true, data: results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Find duplicate files (by MD5 hash) ───────────────────────────────────
  ipcMain.handle('fs:find-dupes', async (_e, dir) => {
    try {
      const hashes = {};
      const walk = async (p, depth = 0) => {
        if (depth > 6) return;
        const entries = await fs.promises.readdir(p, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          if (['node_modules', '.git', '__pycache__'].includes(e.name)) continue;
          const full = path.join(p, e.name);
          if (e.isDirectory()) {
            await walk(full, depth + 1);
          } else {
            const stat = await fs.promises.stat(full).catch(() => null);
            if (!stat || stat.size === 0) continue;
            const hash = await fileHash(full);
            if (!hashes[hash]) hashes[hash] = [];
            hashes[hash].push({ path: full, size: stat.size });
          }
        }
      };
      await walk(dir);
      const dupes = Object.values(hashes).filter(g => g.length > 1);
      return { ok: true, data: dupes };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Show in OS explorer ───────────────────────────────────────────────────
  ipcMain.handle('fs:show-in-explorer', async (_e, filePath) => {
    try {
      const { shell } = require('electron');
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Native file/folder picker ─────────────────────────────────────────────
  ipcMain.handle('fs:select-path', async (_e, opts = {}) => {
    try {
      const props = opts.directory
        ? ['openDirectory']
        : ['openFile', ...(opts.multi ? ['multiSelections'] : [])];

      const result = await dialog.showOpenDialog({
        properties: props,
        filters:    opts.filters || [],
        title:      opts.title   || 'Select',
      });

      if (result.canceled) return { ok: true, canceled: true, paths: [] };
      return { ok: true, canceled: false, paths: result.filePaths };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function fastDirSize(dirPath) {
  let total = 0;
  const walk = async (p, depth = 0) => {
    if (depth > 5) return;
    const entries = await fs.promises.readdir(p, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (['node_modules', '.git'].includes(e.name)) continue;
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        const stat = await fs.promises.stat(full).catch(() => null);
        if (stat) total += stat.size;
      }
    }
  };
  await walk(dirPath);
  return total;
}

function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { register };
