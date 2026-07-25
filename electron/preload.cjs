'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Rama API — exposed to renderer via window.rama ──────────────────────────
// All Node/Electron access MUST go through this bridge.
// The renderer never sees ipcRenderer directly.

contextBridge.exposeInMainWorld('rama', {

  // ── Window Controls ────────────────────────────────────────────────────────
  window: {
    minimize:    ()  => ipcRenderer.send('window:minimize'),
    maximize:    ()  => ipcRenderer.send('window:maximize'),
    close:       ()  => ipcRenderer.send('window:close'),
    isMaximized: ()  => ipcRenderer.sendSync('window:is-maximized'),
    onMaximized: (cb) => {
      const handler = (_e, val) => cb(val);
      ipcRenderer.on('window:maximized', handler);
      return () => ipcRenderer.removeListener('window:maximized', handler);
    },
  },

  // ── Navigation (from tray) ─────────────────────────────────────────────────
  nav: {
    onGoto: (cb) => {
      const handler = (_e, route) => cb(route);
      ipcRenderer.on('nav:goto', handler);
      return () => ipcRenderer.removeListener('nav:goto', handler);
    },
  },

  // ── System / OS ───────────────────────────────────────────────────────────
  system: {
    getMetrics:       ()              => ipcRenderer.invoke('system:get-metrics'),
    getProcesses:     ()              => ipcRenderer.invoke('system:get-processes'),
    killProcess:      (pid)           => ipcRenderer.invoke('system:kill-process', pid),
    getNetworkStats:  ()              => ipcRenderer.invoke('system:get-network-stats'),
    getDiskUsage:     ()              => ipcRenderer.invoke('system:get-disk-usage'),
    cleanTemp:        (targets)       => ipcRenderer.invoke('system:clean-temp', targets),
    getTempTargets:   ()              => ipcRenderer.invoke('system:get-temp-targets'),
    streamMetrics:    (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('system:metrics-stream', handler);
      ipcRenderer.send('system:start-stream');
      return () => {
        ipcRenderer.send('system:stop-stream');
        ipcRenderer.removeListener('system:metrics-stream', handler);
      };
    },
  },

  // ── Filesystem ────────────────────────────────────────────────────────────
  fs: {
    readFile:     (filePath)            => ipcRenderer.invoke('fs:read-file',     filePath),
    writeFile:    (filePath, content)   => ipcRenderer.invoke('fs:write-file',    filePath, content),
    deleteFile:   (filePath)            => ipcRenderer.invoke('fs:delete-file',   filePath),
    listDir:      (dirPath)             => ipcRenderer.invoke('fs:list-dir',      dirPath),
    createDir:    (dirPath)             => ipcRenderer.invoke('fs:create-dir',    dirPath),
    rename:       (oldPath, newPath)    => ipcRenderer.invoke('fs:rename',        oldPath, newPath),
    copyFile:     (src, dest)           => ipcRenderer.invoke('fs:copy-file',     src, dest),
    moveFile:     (src, dest)           => ipcRenderer.invoke('fs:move-file',     src, dest),
    getStats:     (filePath)            => ipcRenderer.invoke('fs:get-stats',     filePath),
    searchFiles:  (dir, query)          => ipcRenderer.invoke('fs:search-files',  dir, query),
    getDiskSizes: (dir)                 => ipcRenderer.invoke('fs:get-disk-sizes', dir),
    findDupes:    (dir)                 => ipcRenderer.invoke('fs:find-dupes',    dir),
    showInExplorer: (filePath)          => ipcRenderer.invoke('fs:show-in-explorer', filePath),
    selectPath:   (opts)                => ipcRenderer.invoke('fs:select-path',   opts),
  },

  // ── Git ───────────────────────────────────────────────────────────────────
  git: {
    status:       (repoPath)            => ipcRenderer.invoke('git:status',       repoPath),
    diff:         (repoPath)            => ipcRenderer.invoke('git:diff',         repoPath),
    log:          (repoPath, limit)     => ipcRenderer.invoke('git:log',          repoPath, limit),
    stage:        (repoPath, files)     => ipcRenderer.invoke('git:stage',        repoPath, files),
    commit:       (repoPath, message)   => ipcRenderer.invoke('git:commit',       repoPath, message),
    push:         (repoPath, branch)    => ipcRenderer.invoke('git:push',         repoPath, branch),
    pull:         (repoPath)            => ipcRenderer.invoke('git:pull',         repoPath),
    clone:        (url, dest)           => ipcRenderer.invoke('git:clone',        url, dest),
    getBranches:  (repoPath)            => ipcRenderer.invoke('git:get-branches', repoPath),
    checkout:     (repoPath, branch)    => ipcRenderer.invoke('git:checkout',     repoPath, branch),
    getRemotes:   (repoPath)            => ipcRenderer.invoke('git:get-remotes',  repoPath),
    startWatch:   (repoPath, cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('git:watch-event', handler);
      ipcRenderer.invoke('git:start-watch', repoPath);
      return () => {
        ipcRenderer.invoke('git:stop-watch', repoPath);
        ipcRenderer.removeListener('git:watch-event', handler);
      };
    },
  },

  // ── Terminal (PTY) ────────────────────────────────────────────────────────
  terminal: {
    create:    (opts)         => ipcRenderer.invoke('terminal:create',    opts),
    write:     (id, data)     => ipcRenderer.send('terminal:write',       id, data),
    resize:    (id, cols, rows) => ipcRenderer.send('terminal:resize',    id, cols, rows),
    destroy:   (id)           => ipcRenderer.invoke('terminal:destroy',   id),
    onData:    (id, cb) => {
      const channel = `terminal:data:${id}`;
      const handler = (_e, data) => cb(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onExit:    (id, cb) => {
      const channel = `terminal:exit:${id}`;
      const handler = (_e, code) => cb(code);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },

  // ── App Assimilation ──────────────────────────────────────────────────────
  apps: {
    scanInstalled:  ()              => ipcRenderer.invoke('apps:scan-installed'),
    getRegistry:    ()              => ipcRenderer.invoke('apps:get-registry'),
    getCapabilities:(appId)         => ipcRenderer.invoke('apps:get-capabilities',  appId),
    execute:        (appId, action, params) =>
                                       ipcRenderer.invoke('apps:execute',  appId, action, params),
    getAuditLog:    ()              => ipcRenderer.invoke('apps:get-audit-log'),
    setWhitelist:   (list)          => ipcRenderer.invoke('apps:set-whitelist',  list),
    setBlacklist:   (list)          => ipcRenderer.invoke('apps:set-blacklist',  list),
  },

  // ── AI Process Manager ────────────────────────────────────────────────────
  ai: {
    startBackend:  ()       => ipcRenderer.invoke('ai:start-backend'),
    stopBackend:   ()       => ipcRenderer.invoke('ai:stop-backend'),
    getStatus:     ()       => ipcRenderer.invoke('ai:get-status'),
    onLog:         (cb) => {
      const handler = (_e, line) => cb(line);
      ipcRenderer.on('ai:log', handler);
      return () => ipcRenderer.removeListener('ai:log', handler);
    },
  },

  // ── Updater ───────────────────────────────────────────────────────────────
  updater: {
    installNow: () => ipcRenderer.send('updater:install-now'),
    onAvailable: (cb) => {
      const handler = (_e, info) => cb(info);
      ipcRenderer.on('updater:update-available', handler);
      return () => ipcRenderer.removeListener('updater:update-available', handler);
    },
    onDownloaded: (cb) => {
      const handler = (_e, info) => cb(info);
      ipcRenderer.on('updater:update-downloaded', handler);
      return () => ipcRenderer.removeListener('updater:update-downloaded', handler);
    },
  },

  // ── Shell / OS helpers ────────────────────────────────────────────────────
  shell: {
    openExternal: (url)           => ipcRenderer.invoke('shell:open-external', url),
  },

  // ── Native Notifications ──────────────────────────────────────────────────
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // ── Platform info (read-only, safe to expose) ─────────────────────────────
  platform: process.platform,
  isDev:    !app?.isPackaged,

  // ── Credential Vault ──────────────────────────────────────────────────────
  vault: {
    unlock:  (password)           => ipcRenderer.invoke('vault:unlock', password),
    lock:    ()                   => ipcRenderer.invoke('vault:lock'),
    status:  ()                   => ipcRenderer.invoke('vault:status'),
    set:     (service, value, meta) => ipcRenderer.invoke('vault:set', service, value, meta),
    get:     (service)            => ipcRenderer.invoke('vault:get', service),
    list:    ()                   => ipcRenderer.invoke('vault:list'),
    delete:  (service)            => ipcRenderer.invoke('vault:delete', service),
    has:     (service)            => ipcRenderer.invoke('vault:has', service),
  },

  // ── Model Router ──────────────────────────────────────────────────────────
  models: {
    list:             ()           => ipcRenderer.invoke('models:list'),
    setPrimary:       (model)      => ipcRenderer.invoke('models:set-primary', model),
    getPrimary:       ()           => ipcRenderer.invoke('models:get-primary'),
    route:            (taskType)   => ipcRenderer.invoke('models:route', taskType),
    chat:             (opts)       => ipcRenderer.invoke('models:chat', opts),
    checkCredentials: ()           => ipcRenderer.invoke('models:check-credentials'),
    needsForTask:     (task)       => ipcRenderer.invoke('models:needs-for-task', task),
    ollamaList:       ()           => ipcRenderer.invoke('models:ollama-list'),
    ollamaPull:       (name, cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('models:ollama-pull-progress', handler);
      const promise = ipcRenderer.invoke('models:ollama-pull', name);
      return promise.finally(() => ipcRenderer.removeListener('models:ollama-pull-progress', handler));
    },
  },

  // ── Agent Orchestrator ────────────────────────────────────────────────────
  agents: {
    spawn:        (opts)       => ipcRenderer.invoke('agents:spawn', opts),
    kill:         (id)         => ipcRenderer.invoke('agents:kill', id),
    killAll:      ()           => ipcRenderer.invoke('agents:kill-all'),
    list:         ()           => ipcRenderer.invoke('agents:list'),
    get:          (id)         => ipcRenderer.invoke('agents:get', id),
    getAudit:     ()           => ipcRenderer.invoke('agents:get-audit'),
    getResources: ()           => ipcRenderer.invoke('agents:get-resources'),
    setGovernor:  (limits)     => ipcRenderer.invoke('agents:set-governor', limits),
    onSpawned:    (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('agents:spawned', h);
      return () => ipcRenderer.removeListener('agents:spawned', h);
    },
    onUpdate: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('agents:update', h);
      return () => ipcRenderer.removeListener('agents:update', h);
    },
    onStep: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('agents:step', h);
      return () => ipcRenderer.removeListener('agents:step', h);
    },
    onComplete: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('agents:complete', h);
      return () => ipcRenderer.removeListener('agents:complete', h);
    },
    onApprovalNeeded: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('agents:approval-needed', h);
      return () => ipcRenderer.removeListener('agents:approval-needed', h);
    },
  },

  // ── Browser Engine ────────────────────────────────────────────────────────
  browser: {
    launch:      (opts)              => ipcRenderer.invoke('browser:launch', opts),
    close:       ()                  => ipcRenderer.invoke('browser:close'),
    openPage:    (url)               => ipcRenderer.invoke('browser:open-page', url),
    navigate:    (id, url)           => ipcRenderer.invoke('browser:navigate', id, url),
    getContent:  (id)                => ipcRenderer.invoke('browser:get-content', id),
    search:      (query, engine)     => ipcRenderer.invoke('browser:search', query, engine),
    screenshot:  (id)                => ipcRenderer.invoke('browser:screenshot', id),
    executeJs:   (id, script)        => ipcRenderer.invoke('browser:execute-js', id, script),
    download:    (url, dir, name)    => ipcRenderer.invoke('browser:download', url, dir, name),
    getDownloads:()                  => ipcRenderer.invoke('browser:get-downloads'),
    closePage:   (id)                => ipcRenderer.invoke('browser:close-page', id),
    listPages:   ()                  => ipcRenderer.invoke('browser:list-pages'),
    fetchUrl:    (url)               => ipcRenderer.invoke('browser:fetch-url', url),
    onDownloadProgress: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('browser:download-progress', h);
      return () => ipcRenderer.removeListener('browser:download-progress', h);
    },
  },
});
