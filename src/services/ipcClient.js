/**
 * ipcClient.js — Thin wrapper around window.rama IPC calls.
 * Provides consistent error handling and falls back gracefully
 * when running in a browser (non-Electron) context.
 */

const isElectron = typeof window !== 'undefined' && !!window.rama;

// ─── Safe IPC call wrapper ────────────────────────────────────────────────────
async function ipc(path, ...args) {
  if (!isElectron) {
    console.warn(`[ipcClient] Not in Electron context — ipc call skipped: ${path}`);
    return { ok: false, error: 'Not running in Electron' };
  }

  // Resolve nested path: 'system.getMetrics' → window.rama.system.getMetrics()
  const parts = path.split('.');
  let fn = window.rama;
  for (const part of parts) {
    fn = fn?.[part];
    if (!fn) {
      console.error(`[ipcClient] Unknown IPC path: ${path}`);
      return { ok: false, error: `Unknown IPC path: ${path}` };
    }
  }

  try {
    const result = await fn(...args);
    return result;
  } catch (err) {
    console.error(`[ipcClient] Error on ${path}:`, err);
    return { ok: false, error: err.message };
  }
}

// ─── System ───────────────────────────────────────────────────────────────────
export const systemClient = {
  getMetrics:     ()             => ipc('system.getMetrics'),
  getProcesses:   ()             => ipc('system.getProcesses'),
  killProcess:    (pid)          => ipc('system.killProcess', pid),
  getNetworkStats: ()            => ipc('system.getNetworkStats'),
  getDiskUsage:   ()             => ipc('system.getDiskUsage'),
  getTempTargets: ()             => ipc('system.getTempTargets'),
  cleanTemp:      (targets)      => ipc('system.cleanTemp', targets),
};

// ─── Filesystem ───────────────────────────────────────────────────────────────
export const fsClient = {
  readFile:      (p)             => ipc('fs.readFile', p),
  writeFile:     (p, c)          => ipc('fs.writeFile', p, c),
  deleteFile:    (p)             => ipc('fs.deleteFile', p),
  listDir:       (p)             => ipc('fs.listDir', p),
  createDir:     (p)             => ipc('fs.createDir', p),
  rename:        (o, n)          => ipc('fs.rename', o, n),
  copyFile:      (s, d)          => ipc('fs.copyFile', s, d),
  moveFile:      (s, d)          => ipc('fs.moveFile', s, d),
  getStats:      (p)             => ipc('fs.getStats', p),
  searchFiles:   (d, q)          => ipc('fs.searchFiles', d, q),
  getDiskSizes:  (d)             => ipc('fs.getDiskSizes', d),
  findDupes:     (d)             => ipc('fs.findDupes', d),
  showInExplorer:(p)             => ipc('fs.showInExplorer', p),
  selectPath:    (opts)          => ipc('fs.selectPath', opts),
};

// ─── Git ──────────────────────────────────────────────────────────────────────
export const gitClient = {
  status:       (repo)           => ipc('git.status', repo),
  diff:         (repo)           => ipc('git.diff', repo),
  log:          (repo, limit)    => ipc('git.log', repo, limit),
  stage:        (repo, files)    => ipc('git.stage', repo, files),
  commit:       (repo, msg)      => ipc('git.commit', repo, msg),
  push:         (repo, branch)   => ipc('git.push', repo, branch),
  pull:         (repo)           => ipc('git.pull', repo),
  clone:        (url, dest)      => ipc('git.clone', url, dest),
  getBranches:  (repo)           => ipc('git.getBranches', repo),
  checkout:     (repo, branch)   => ipc('git.checkout', repo, branch),
  getRemotes:   (repo)           => ipc('git.getRemotes', repo),
};

// ─── Terminal ─────────────────────────────────────────────────────────────────
export const terminalClient = {
  create:  (opts)              => ipc('terminal.create', opts),
  write:   (id, data)          => window.rama?.terminal.write(id, data),
  resize:  (id, cols, rows)    => window.rama?.terminal.resize(id, cols, rows),
  destroy: (id)                => ipc('terminal.destroy', id),
  onData:  (id, cb)            => window.rama?.terminal.onData(id, cb),
  onExit:  (id, cb)            => window.rama?.terminal.onExit(id, cb),
};

// ─── Apps ─────────────────────────────────────────────────────────────────────
export const appsClient = {
  scanInstalled:   ()             => ipc('apps.scanInstalled'),
  getRegistry:     ()             => ipc('apps.getRegistry'),
  getCapabilities: (id)           => ipc('apps.getCapabilities', id),
  execute:         (id, act, p)   => ipc('apps.execute', id, act, p),
  getAuditLog:     ()             => ipc('apps.getAuditLog'),
  setWhitelist:    (list)         => ipc('apps.setWhitelist', list),
  setBlacklist:    (list)         => ipc('apps.setBlacklist', list),
};

// ─── AI process ───────────────────────────────────────────────────────────────
export const aiProcessClient = {
  start:     ()  => ipc('ai.startBackend'),
  stop:      ()  => ipc('ai.stopBackend'),
  getStatus: ()  => ipc('ai.getStatus'),
};

export { isElectron };
