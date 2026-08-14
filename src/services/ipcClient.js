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
// getProcesses/killProcess/getNetworkStats/cleanTemp need `user` first —
// system.cjs gates them on os.process-list/os.process-kill/os.temp-clean.
// getMetrics/getDiskUsage/getTempTargets/getOwnFootprint stay open to every
// signed-in tier — same sensitivity class as the Home dashboard.
export const systemClient = {
  getMetrics:     ()             => ipc('system.getMetrics'),
  getProcesses:   (user)         => ipc('system.getProcesses', user),
  killProcess:    (user, pid)    => ipc('system.killProcess', user, pid),
  getNetworkStats: (user)        => ipc('system.getNetworkStats', user),
  getDiskUsage:   ()             => ipc('system.getDiskUsage'),
  getTempTargets: ()             => ipc('system.getTempTargets'),
  cleanTemp:      (user, targets) => ipc('system.cleanTemp', user, targets),
  getOwnFootprint: ()            => ipc('system.getOwnFootprint'),
};

// ─── Filesystem ───────────────────────────────────────────────────────────────
// Every method needs `user` first — filesystem.cjs gates reads/writes/deletes
// on os.filesystem-read/write/delete. See RAMA_AGI_MASTER_SPEC.md's fix pass:
// these handlers previously had no capability check at all.
export const fsClient = {
  readFile:      (user, p)             => ipc('fs.readFile', user, p),
  writeFile:     (user, p, c)          => ipc('fs.writeFile', user, p, c),
  deleteFile:    (user, p)             => ipc('fs.deleteFile', user, p),
  listDir:       (user, p)             => ipc('fs.listDir', user, p),
  createDir:     (user, p)             => ipc('fs.createDir', user, p),
  rename:        (user, o, n)          => ipc('fs.rename', user, o, n),
  copyFile:      (user, s, d)          => ipc('fs.copyFile', user, s, d),
  moveFile:      (user, s, d)          => ipc('fs.moveFile', user, s, d),
  getStats:      (user, p)             => ipc('fs.getStats', user, p),
  searchFiles:   (user, d, q)          => ipc('fs.searchFiles', user, d, q),
  getDiskSizes:  (user, d)             => ipc('fs.getDiskSizes', user, d),
  findDupes:     (user, d)             => ipc('fs.findDupes', user, d),
  showInExplorer:(user, p)             => ipc('fs.showInExplorer', user, p),
  selectPath:    (opts)                => ipc('fs.selectPath', opts),   // no user needed — dialog only
};

// ─── Git ──────────────────────────────────────────────────────────────────────
// Every method needs `user` first — git.cjs gates reads on git.read,
// stage/commit/pull/checkout on git.commit, push/clone on git.push.
export const gitClient = {
  status:       (user, repo)           => ipc('git.status', user, repo),
  diff:         (user, repo)           => ipc('git.diff', user, repo),
  log:          (user, repo, limit)    => ipc('git.log', user, repo, limit),
  stage:        (user, repo, files)    => ipc('git.stage', user, repo, files),
  commit:       (user, repo, msg)      => ipc('git.commit', user, repo, msg),
  push:         (user, repo, branch)   => ipc('git.push', user, repo, branch),
  pull:         (user, repo)           => ipc('git.pull', user, repo),
  clone:        (user, url, dest)      => ipc('git.clone', user, url, dest),
  getBranches:  (user, repo)           => ipc('git.getBranches', user, repo),
  checkout:     (user, repo, branch)   => ipc('git.checkout', user, repo, branch),
  getRemotes:   (user, repo)           => ipc('git.getRemotes', user, repo),
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
