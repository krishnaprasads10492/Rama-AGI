'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * FAILURE MODE THIS FILE GUARDS AGAINST:
 * If preload throws while evaluating, Electron logs one line and moves on —
 * `window.rama` is simply never defined. Every one of the 200+ IPC channels then
 * appears "not a function" from the renderer's side, and the real error is
 * nowhere near the symptom. This project has already lost a debugging session to
 * exactly that (an undefined `app` reference in the isDev getter).
 *
 * So: the API is built into a plain object first, exposure is wrapped, and any
 * failure is reported three ways — main-process log, a marker on window.rama, and
 * the boot diagnostic page. A broken bridge must never be a silent one.
 */
const RAMA_API = {

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

  // ── Floating status badge (always-on-top presence indicator) ──────────────
  // Pure UI visibility control, same sensitivity class as window minimize —
  // no capability gate. Voice actions (badge-enable/disable, bring-to-front)
  // in CommandPalette.jsx call these directly.
  badge: {
    setEnabled:   (enabled) => ipcRenderer.invoke('badge:set-enabled', enabled),
    getEnabled:   ()        => ipcRenderer.invoke('badge:get-enabled'),
    bringToFront: ()        => ipcRenderer.invoke('badge:bring-to-front'),
    setHideTray:  (hide)    => ipcRenderer.invoke('badge:set-hide-tray', hide),
  },

  // ── System / OS ───────────────────────────────────────────────────────────
  // getProcesses/getNetworkStats need user (gated on os.process-list);
  // killProcess needs user (os.process-kill); cleanTemp needs user
  // (os.temp-clean). getMetrics/getDiskUsage/getTempTargets stay open to
  // every signed-in tier — same sensitivity class as the Home dashboard.
  system: {
    getMetrics:       ()              => ipcRenderer.invoke('system:get-metrics'),
    getProcesses:     (user)          => ipcRenderer.invoke('system:get-processes', { user }),
    killProcess:      (user, pid)     => ipcRenderer.invoke('system:kill-process', { user, pid }),
    getNetworkStats:  (user)          => ipcRenderer.invoke('system:get-network-stats', { user }),
    getDiskUsage:     ()              => ipcRenderer.invoke('system:get-disk-usage'),
    getOwnFootprint:  ()              => ipcRenderer.invoke('system:get-own-footprint'),
    cleanTemp:        (user, targetPaths) => ipcRenderer.invoke('system:clean-temp', { user, targetPaths }),
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
  // Every call takes { user, ... } — filesystem.cjs gates reads/writes/
  // deletes on os.filesystem-read/write/delete respectively.
  fs: {
    readFile:     (user, filePath)            => ipcRenderer.invoke('fs:read-file',     { user, filePath }),
    writeFile:    (user, filePath, content)   => ipcRenderer.invoke('fs:write-file',    { user, filePath, content }),
    deleteFile:   (user, filePath)            => ipcRenderer.invoke('fs:delete-file',   { user, filePath }),
    listDir:      (user, dirPath)             => ipcRenderer.invoke('fs:list-dir',      { user, dirPath }),
    createDir:    (user, dirPath)             => ipcRenderer.invoke('fs:create-dir',    { user, dirPath }),
    rename:       (user, oldPath, newPath)    => ipcRenderer.invoke('fs:rename',        { user, oldPath, newPath }),
    copyFile:     (user, src, dest)           => ipcRenderer.invoke('fs:copy-file',     { user, src, dest }),
    moveFile:     (user, src, dest)           => ipcRenderer.invoke('fs:move-file',     { user, src, dest }),
    getStats:     (user, filePath)            => ipcRenderer.invoke('fs:get-stats',     { user, filePath }),
    searchFiles:  (user, dir, query)          => ipcRenderer.invoke('fs:search-files',  { user, dir, query }),
    getDiskSizes: (user, dir)                 => ipcRenderer.invoke('fs:get-disk-sizes', { user, dir }),
    findDupes:    (user, dir)                 => ipcRenderer.invoke('fs:find-dupes',    { user, dir }),
    showInExplorer: (user, filePath)          => ipcRenderer.invoke('fs:show-in-explorer', { user, filePath }),
    selectPath:   (opts)                      => ipcRenderer.invoke('fs:select-path',   opts),
  },

  // ── Git ───────────────────────────────────────────────────────────────────
  // Every call takes user first — git.cjs gates reads on git.read, stage/
  // commit/pull/checkout on git.commit, push/clone on git.push.
  git: {
    status:       (user, repoPath)            => ipcRenderer.invoke('git:status',       { user, repoPath }),
    diff:         (user, repoPath)            => ipcRenderer.invoke('git:diff',         { user, repoPath }),
    log:          (user, repoPath, limit)     => ipcRenderer.invoke('git:log',          { user, repoPath, limit }),
    stage:        (user, repoPath, files)     => ipcRenderer.invoke('git:stage',        { user, repoPath, files }),
    commit:       (user, repoPath, message)   => ipcRenderer.invoke('git:commit',       { user, repoPath, message }),
    push:         (user, repoPath, branch)    => ipcRenderer.invoke('git:push',         { user, repoPath, branch }),
    pull:         (user, repoPath)            => ipcRenderer.invoke('git:pull',         { user, repoPath }),
    clone:        (user, url, dest)           => ipcRenderer.invoke('git:clone',        { user, url, dest }),
    getBranches:  (user, repoPath)            => ipcRenderer.invoke('git:get-branches', { user, repoPath }),
    checkout:     (user, repoPath, branch)    => ipcRenderer.invoke('git:checkout',     { user, repoPath, branch }),
    getRemotes:   (user, repoPath)            => ipcRenderer.invoke('git:get-remotes',  { user, repoPath }),
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
  // Every call takes { user, ... } — appAssimilation.cjs gates each handler
  // on the apps.* capabilities (view / execute-safe / execute-all).
  apps: {
    scanInstalled:   (opts)                    => ipcRenderer.invoke('apps:scan-installed', opts),
    getRegistry:     (opts)                    => ipcRenderer.invoke('apps:get-registry', opts),
    getCapabilities: (opts)                    => ipcRenderer.invoke('apps:get-capabilities', opts),
    execute:         (opts)                    => ipcRenderer.invoke('apps:execute', opts),
    getAuditLog:     (opts)                    => ipcRenderer.invoke('apps:get-audit-log', opts),
    setWhitelist:    (opts)                    => ipcRenderer.invoke('apps:set-whitelist', opts),
    setBlacklist:    (opts)                    => ipcRenderer.invoke('apps:set-blacklist', opts),
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

  // ── Market Intel (absorbed StockMind prediction engine) ───────────────────
  marketIntel: {
    predict:         (opts) => ipcRenderer.invoke('market:predict', opts),
    backtest:        (opts) => ipcRenderer.invoke('market:backtest', opts),
    backtestPresets: (opts) => ipcRenderer.invoke('market:backtest-presets', opts),
    strategyScore:   (opts) => ipcRenderer.invoke('market:strategy-score', opts),
    health:          (opts) => ipcRenderer.invoke('market:health', opts),
  },

  // ── Updater ───────────────────────────────────────────────────────────────
  updater: {
    installNow: () => ipcRenderer.send('updater:install-now'),
    // Plain notices from the updater — including "no releases published yet", which
    // is the expected state until master tags one (Section 60).
    onNotice: (cb) => {
      const handler = (_e, n) => cb(n);
      ipcRenderer.on('updater:notice', handler);
      return () => ipcRenderer.removeListener('updater:notice', handler);
    },
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

  // ── Resource Orchestrator ─────────────────────────────────────────────────
  orchestrator: {
    submit:       (task)        => ipcRenderer.invoke('orchestrator:submit',         task),
    status:       ()            => ipcRenderer.invoke('orchestrator:status'),
    optimalModel: (type, local) => ipcRenderer.invoke('orchestrator:optimal-model',  type, local),
    setLimits:    (limits)      => ipcRenderer.invoke('orchestrator:set-limits',     limits),
    apiLimits:    ()            => ipcRenderer.invoke('orchestrator:api-limits'),
    recordApiUse: (prov, toks)  => ipcRenderer.invoke('orchestrator:record-api-use', prov, toks),
    cancel:       (id)          => ipcRenderer.invoke('orchestrator:cancel',         id),
    onTaskQueued:    (cb) => { const h = (_e,d) => cb(d); ipcRenderer.on('orchestrator:task-queued',    h); return () => ipcRenderer.removeListener('orchestrator:task-queued',    h); },
    onTaskStarted:   (cb) => { const h = (_e,d) => cb(d); ipcRenderer.on('orchestrator:task-started',   h); return () => ipcRenderer.removeListener('orchestrator:task-started',   h); },
    onTaskComplete:  (cb) => { const h = (_e,d) => cb(d); ipcRenderer.on('orchestrator:task-complete',  h); return () => ipcRenderer.removeListener('orchestrator:task-complete',  h); },
    onTaskFailed:    (cb) => { const h = (_e,d) => cb(d); ipcRenderer.on('orchestrator:task-failed',    h); return () => ipcRenderer.removeListener('orchestrator:task-failed',    h); },
    onResourceUpdate:(cb) => { const h = (_e,d) => cb(d); ipcRenderer.on('orchestrator:resource-update',h); return () => ipcRenderer.removeListener('orchestrator:resource-update',h); },
    onWorkersAdapted:(cb) => { const h = (_e,d) => cb(d); ipcRenderer.on('orchestrator:workers-adapted',h); return () => ipcRenderer.removeListener('orchestrator:workers-adapted',h); },
  },

  // ── Evolution Engine ──────────────────────────────────────────────────────
  evolution: {
    scout:             (opts)      => ipcRenderer.invoke('evolution:scout',               opts),
    readRepo:          (opts)      => ipcRenderer.invoke('evolution:read-repo',           opts),
    analyzeAndPropose: (opts)      => ipcRenderer.invoke('evolution:analyze-and-propose', opts),
    apply:             (opts)      => ipcRenderer.invoke('evolution:apply',               opts),
    approve:           (id, user)  => ipcRenderer.invoke('evolution:approve',             id, user),
    reject:            (id, user)  => ipcRenderer.invoke('evolution:reject',              id, user),
    selfAssess:        ()          => ipcRenderer.invoke('evolution:self-assess'),
    getLog:            ()          => ipcRenderer.invoke('evolution:get-log'),
    getScout:          (id)        => ipcRenderer.invoke('evolution:get-scout',           id),
    onScoutProgress:   (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('evolution:scout-progress', h);
      return () => ipcRenderer.removeListener('evolution:scout-progress', h);
    },
    onScoutComplete:   (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('evolution:scout-complete', h);
      return () => ipcRenderer.removeListener('evolution:scout-complete', h);
    },
    onApplied:         (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('evolution:applied', h);
      return () => ipcRenderer.removeListener('evolution:applied', h);
    },
  },

  // ── Release Channel (dormant until master cuts a real release) ────────────
  release: {
    state: (repoPath)       => ipcRenderer.invoke('release:state', { repoPath }),
    cut:   (opts)           => ipcRenderer.invoke('release:cut', opts),
  },

  // ── Publish (applied self-modify proposal → its own branch, with notes) ───
  publish: {
    previewNotes: (proposalId)  => ipcRenderer.invoke('publish:preview-notes', { proposalId }),
    proposal:     (opts)        => ipcRenderer.invoke('publish:proposal', opts),
  },

  // ── Local Update (master's own local CI/CD — pull → install → build → apply) ──
  update: {
    check:        (repoPath)      => ipcRenderer.invoke('update:check', { repoPath }),
    pullBuild:    (opts)          => ipcRenderer.invoke('update:pull-build', opts),
    reloadWindow: (opts)          => ipcRenderer.invoke('update:reload-window', opts),
    restartApp:   (opts)          => ipcRenderer.invoke('update:restart-app', opts),
    onLog: (cb) => {
      const h = (_e, chunk) => cb(chunk);
      ipcRenderer.on('update:log', h);
      return () => ipcRenderer.removeListener('update:log', h);
    },
  },

  // ── Resource Research (catalog + live doc-reading + enable proposals) ─────
  resourceResearch: {
    catalog:       ()      => ipcRenderer.invoke('resource:catalog'),
    research:      (opts)  => ipcRenderer.invoke('resource:research', opts),
    proposeEnable: (opts)  => ipcRenderer.invoke('resource:propose-enable', opts),
  },

  // ── Intelligence Engine ───────────────────────────────────────────────────
  intel: {
    analyze:      (opts)      => ipcRenderer.invoke('intel:analyze', opts),
    getSession:   (id)        => ipcRenderer.invoke('intel:get-session', id),
    listSessions: ()          => ipcRenderer.invoke('intel:list-sessions'),
    checkSource:  (domain)    => ipcRenderer.invoke('intel:check-source', domain),
    onProgress:   (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('intel:progress', handler);
      return () => ipcRenderer.removeListener('intel:progress', handler);
    },
    onComplete:   (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('intel:complete', handler);
      return () => ipcRenderer.removeListener('intel:complete', handler);
    },
  },

  // ── Gate 1: store passcode ────────────────────────────────────────────────
  // This gate opens the encrypted store. It does NOT establish an identity —
  // there is no `validate` here any more, because it never had a session to
  // validate. Identity lives behind `rama.auth`.
  session: {
    isFirstRun:     ()      => ipcRenderer.invoke('session:is-first-run'),
    unlock:         (pass)  => ipcRenderer.invoke('session:unlock', pass),
    lock:           ()      => ipcRenderer.invoke('session:lock'),
    status:         ()      => ipcRenderer.invoke('session:status'),
    // Requires an authenticated Master session; re-encrypts every domain
    changePasscode: (opts)  => ipcRenderer.invoke('session:change-passcode', opts),
  },

  // ── Encrypted data store ──────────────────────────────────────────────────
  store: {
    get:           (domain, key)              => ipcRenderer.invoke('store:get',    domain, key),
    set:           (domain, key, value)       => ipcRenderer.invoke('store:set',    domain, key, value),
    push:          (domain, arrayKey, item)   => ipcRenderer.invoke('store:push',   domain, arrayKey, item),
    update:        (domain, arrayKey, id, ch) => ipcRenderer.invoke('store:update', domain, arrayKey, id, ch),
    remove:        (domain, arrayKey, id)     => ipcRenderer.invoke('store:remove', domain, arrayKey, id),
    find:          (domain, arrayKey, filter) => ipcRenderer.invoke('store:find',   domain, arrayKey, filter),
    save:          ()                         => ipcRenderer.invoke('store:save'),
    status:        ()                         => ipcRenderer.invoke('store:status'),
    exportBackup:  (dest)                     => ipcRenderer.invoke('store:export-backup', dest),
  },

  // ── Nucleus (Immutable Encryption Foundry) ────────────────────────────────
  // `user` is threaded through the channels that write or reveal (Section 57).
  // `unseal` and `status` stay userless on purpose: unseal IS the authentication
  // gate, and status returns only booleans needed before anyone is signed in.
  nucleus: {
    seal:        (passcode, user) => ipcRenderer.invoke('nucleus:seal',        passcode, user),
    unseal:      (passcode)    => ipcRenderer.invoke('nucleus:unseal',          passcode),
    status:      ()            => ipcRenderer.invoke('nucleus:status'),
    getPrompt:   (extra, user) => ipcRenderer.invoke('nucleus:get-prompt',      extra, user),
    patch:       (patches, user) => ipcRenderer.invoke('nucleus:patch',         patches, user),
    lock:        ()            => ipcRenderer.invoke('nucleus:lock'),
    getIdentity: (user)        => ipcRenderer.invoke('nucleus:get-identity',    user),
  },

  // ── IPC Encryption (Pervasive Flow Encryption) ────────────────────────────
  ipcSec: {
    init:               ()      => ipcRenderer.invoke('ipc-enc:init'),
    clear:              ()      => ipcRenderer.invoke('ipc-enc:clear'),
    status:             ()      => ipcRenderer.invoke('ipc-enc:status'),
    verify:             (msg)   => ipcRenderer.invoke('ipc-enc:verify',             msg),
    encryptForState:    (val)   => ipcRenderer.invoke('ipc-enc:encrypt-for-state',  val),
    decryptFromState:   (packed)=> ipcRenderer.invoke('ipc-enc:decrypt-from-state', packed),
  },

  // ── Event Bus ─────────────────────────────────────────────────────────────
  bus: {
    emit:    (event, data) => ipcRenderer.invoke('bus:emit',    event, data),
    status:  ()            => ipcRenderer.invoke('bus:status'),
    history: (limit)       => ipcRenderer.invoke('bus:history', limit),
    onEvent: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('bus:event', h);
      return () => ipcRenderer.removeListener('bus:event', h);
    },
    onCapabilityRegression: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('capability:regression', h);
      return () => ipcRenderer.removeListener('capability:regression', h);
    },
  },

  // ── AST Engine ────────────────────────────────────────────────────────────
  ast: {
    analyzeFile:    (filePath)             => ipcRenderer.invoke('ast:analyze-file',    filePath),
    analyzeRepo:    (repoPath, maxFiles)   => ipcRenderer.invoke('ast:analyze-repo',    repoPath, maxFiles),
    impactAnalysis: (opts)                 => ipcRenderer.invoke('ast:impact-analysis', opts),
    clearCache:     ()                     => ipcRenderer.invoke('ast:cache-clear'),
  },

  // ── Code Regen Engine ─────────────────────────────────────────────────────
  regen: {
    queue:       (item)         => ipcRenderer.invoke('regen:queue',        item),
    getProposal: (id)           => ipcRenderer.invoke('regen:get-proposal', id),
    listProposals: ()           => ipcRenderer.invoke('regen:list-proposals'),
    setFix:      (opts)         => ipcRenderer.invoke('regen:set-fix',      opts),
    apply:       (opts)         => ipcRenderer.invoke('regen:apply',        opts),
    approve:     (id, user)     => ipcRenderer.invoke('regen:approve',      id, user),
    reject:      (id, user)     => ipcRenderer.invoke('regen:reject',       id, user),
    research:    (opts)         => ipcRenderer.invoke('regen:research',     opts),
    getPrompt:   (opts)         => ipcRenderer.invoke('regen:get-prompt',   opts),
    onProposalReady: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('regen:proposal-ready', h);
      return () => ipcRenderer.removeListener('regen:proposal-ready', h);
    },
  },

  // ── Authentication (3 gates: passcode → password → 12-digit access key) ────
  auth: {
    instanceInfo:  ()      => ipcRenderer.invoke('auth:instance-info'),
    provision:     (opts)  => ipcRenderer.invoke('auth:provision', opts),

    loginStep1:    (p)     => ipcRenderer.invoke('auth:login-step1', p),
    loginStep2:    (p)     => ipcRenderer.invoke('auth:login-step2', p),
    logout:        (token) => ipcRenderer.invoke('auth:logout', token),
    me:            (p)     => ipcRenderer.invoke('auth:me', p),

    keygen:            (p) => ipcRenderer.invoke('auth:keygen',             p),
    keygenFromStep:    (t) => ipcRenderer.invoke('auth:keygen-step',        t),
    keygenFromCreds:   (p) => ipcRenderer.invoke('auth:keygen-credentials', p),
    issueKey:          (p) => ipcRenderer.invoke('auth:issue-key',          p),

    changePassword: (p)    => ipcRenderer.invoke('auth:change-password', p),
    resetPassword:  (p)    => ipcRenderer.invoke('auth:reset-password',  p),
    checkPassword:  (pw)   => ipcRenderer.invoke('auth:check-password',  pw),

    listUsers:  (p) => ipcRenderer.invoke('auth:list-users',  p),
    createUser: (p) => ipcRenderer.invoke('auth:create-user', p),
    setTier:    (p) => ipcRenderer.invoke('auth:set-tier',    p),
    setActive:  (p) => ipcRenderer.invoke('auth:set-active',  p),
    deleteUser: (p) => ipcRenderer.invoke('auth:delete-user', p),

    sessions: (p) => ipcRenderer.invoke('auth:sessions', p),
    status:   (p) => ipcRenderer.invoke('auth:status',   p),
  },

  // ── Appearance (whole-surface scaling — reaches inline pixel values) ───────
  // ── Startup health (what loaded, what degraded, what crashed last time) ───
  health: {
    startup:      ()      => ipcRenderer.invoke('health:startup'),
    crashReports: (limit) => ipcRenderer.invoke('health:crash-reports', limit),
    crashDir:     ()      => ipcRenderer.invoke('health:crash-dir'),
    // Ask for a repair pass now rather than waiting for the next launch.
    repair:       ()      => ipcRenderer.invoke('health:repair'),
    // Fired when the automatic pass finishes, so recovery is visible as it
    // happens instead of only when a panel is reopened.
    onRepaired: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('health:repaired', handler);
      return () => ipcRenderer.removeListener('health:repaired', handler);
    },
  },

  appearance: {
    getZoom:   ()      => ipcRenderer.invoke('appearance:get-zoom'),
    setZoom:   (f)     => ipcRenderer.invoke('appearance:set-zoom', f),
    nudgeZoom: (delta) => ipcRenderer.invoke('appearance:nudge-zoom', delta),
    // Hand control back to the automatic display fit, and inspect what that fit
    // would choose — no capability gate, same class as window minimize/maximize.
    resetZoom:   ()    => ipcRenderer.invoke('appearance:reset-zoom'),
    displayInfo: ()    => ipcRenderer.invoke('appearance:display-info'),
  },

  // ── Voice (progressive ladder: text → capture → local STT → cloud STT) ─────
  voice: {
    capabilities: ()     => ipcRenderer.invoke('voice:capabilities'),
    rescan:       ()     => ipcRenderer.invoke('voice:rescan'),
    transcribe:   (clip) => ipcRenderer.invoke('voice:transcribe', clip),
  },

  // ── Genome (complete capability blueprint carried by every instance) ───────
  genome: {
    get:       (user)          => ipcRenderer.invoke('genome:get', user),
    verify:    (user)          => ipcRenderer.invoke('genome:verify', user),
    roles:     (user)          => ipcRenderer.invoke('genome:roles', user),
    genes:     (domain, user)  => ipcRenderer.invoke('genome:genes', domain, user),
    expressed: (role, user)    => ipcRenderer.invoke('genome:expressed', role, user),
    proposeChange: (c, user)   => ipcRenderer.invoke('genome:propose-change', c, user),
  },

  // ── Instances (holonic — each carries the full genome, expresses a subset) ──
  instance: {
    spawn:       (opts)            => ipcRenderer.invoke('instance:spawn',     opts),
    list:        (filter)          => ipcRenderer.invoke('instance:list',      filter),
    get:         (id)              => ipcRenderer.invoke('instance:get',       id),
    express:     (id, gene, user)  => ipcRenderer.invoke('instance:express',   id, gene, user),
    suspend:     (id)              => ipcRenderer.invoke('instance:suspend',   id),
    resume:      (id)              => ipcRenderer.invoke('instance:resume',    id),
    terminate:   (id)              => ipcRenderer.invoke('instance:terminate', id),
    record:      (id, work)        => ipcRenderer.invoke('instance:record',    id, work),
    stats:       ()                => ipcRenderer.invoke('instance:stats'),
    audit:       (limit)           => ipcRenderer.invoke('instance:audit',     limit),
    failover:    (role)            => ipcRenderer.invoke('instance:failover',  role),
    restore:     ()                => ipcRenderer.invoke('instance:restore'),
    ensurePrime: ()                => ipcRenderer.invoke('instance:ensure-prime'),
    on: (event, cb) => {
      const channel = `instance:${event}`;
      const h = (_e, d) => cb(d);
      ipcRenderer.on(channel, h);
      return () => ipcRenderer.removeListener(channel, h);
    },
  },

  // ── Meta-cognition (self-audit nexus + experiential dataset) ───────────────
  meta: {
    record:      (rec)    => ipcRenderer.invoke('meta:record',      rec),
    audit:       ()       => ipcRenderer.invoke('meta:audit'),
    audits:      (limit)  => ipcRenderer.invoke('meta:audits',      limit),
    vectors:     ()       => ipcRenderer.invoke('meta:vectors'),
    profiles:    ()       => ipcRenderer.invoke('meta:profiles'),
    profile:     (action) => ipcRenderer.invoke('meta:profile',     action),
    regressions: (limit)  => ipcRenderer.invoke('meta:regressions', limit),
    outcomes:    (filter) => ipcRenderer.invoke('meta:outcomes',    filter),
    summary:     ()       => ipcRenderer.invoke('meta:summary'),
    resetBaseline: ()     => ipcRenderer.invoke('meta:reset-baseline'),
    onAudit: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('meta:audit', h);
      return () => ipcRenderer.removeListener('meta:audit', h);
    },
    onRegression: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('meta:regression', h);
      return () => ipcRenderer.removeListener('meta:regression', h);
    },
  },

  // ── Timeline (git-backed flashbacks & state replay) ────────────────────────
  timeline: {
    get:            (opts) => ipcRenderer.invoke('timeline:get',             opts),
    flashback:      (opts) => ipcRenderer.invoke('timeline:flashback',       opts),
    compare:        (opts) => ipcRenderer.invoke('timeline:compare',         opts),
    fileHistory:    (opts) => ipcRenderer.invoke('timeline:file-history',    opts),
    proposeRestore: (opts) => ipcRenderer.invoke('timeline:propose-restore', opts),
    markers:        (limit)=> ipcRenderer.invoke('timeline:markers',         limit),
    mark:           (m)    => ipcRenderer.invoke('timeline:mark',            m),
  },

  // ── Proposal Ledger (single approve→apply gate for every self-change) ──────
  proposals: {
    // `approve`/`reject` take the signed-in user, not a name. The ledger refuses a
    // string outright — a label is not an identity (Section 57).
    list:    (filter)           => ipcRenderer.invoke('proposals:list',    filter),
    get:     (id, user)         => ipcRenderer.invoke('proposals:get',     id, user),
    create:  (def)              => ipcRenderer.invoke('proposals:create',  def),
    approve: (id, user)         => ipcRenderer.invoke('proposals:approve', id, user),
    reject:  (id, user, reason) => ipcRenderer.invoke('proposals:reject',  id, user, reason),
    apply:   (id, opts)         => ipcRenderer.invoke('proposals:apply',   id, opts),
    stats:   (user)             => ipcRenderer.invoke('proposals:stats',   user),
    audit:   (limit, user)      => ipcRenderer.invoke('proposals:audit',   limit, user),
    flush:   (user)             => ipcRenderer.invoke('proposals:flush',   user),
    on: (event, cb) => {
      const channel = `proposals:${event}`;
      const h = (_e, d) => cb(d);
      ipcRenderer.on(channel, h);
      return () => ipcRenderer.removeListener(channel, h);
    },
  },

  // ── Vector Memory (semantic search — upgrade, keyword fallback always active) ──
  vector: {
    store:       (text, meta)       => ipcRenderer.invoke('vector:store',        text, meta),
    search:      (query, topK, min) => ipcRenderer.invoke('vector:search',       query, topK, min),
    isDuplicate: (text, threshold)  => ipcRenderer.invoke('vector:is-duplicate', text, threshold),
    health:      ()                 => ipcRenderer.invoke('vector:health'),
    bulkStore:   (items)            => ipcRenderer.invoke('vector:bulk-store',   items),
  },

  // ── Sandbox (safe code execution — tiered safety, never replaces terminal) ──
  // execute/kill gate on sandbox.execute (tier 1, same trust level as
  // terminal.open); approve (the ELEVATED-tier master sign-off) gates
  // master-only on sandbox.approve (tier 0). Previously unchecked entirely.
  sandbox: {
    execute:  (user, opts)       => ipcRenderer.invoke('sandbox:execute', { user, ...opts }),
    approve:  (user, opts)       => ipcRenderer.invoke('sandbox:approve', { user, ...opts }),
    kill:     (user, execId)     => ipcRenderer.invoke('sandbox:kill',    { user, execId }),
    audit:    ()                 => ipcRenderer.invoke('sandbox:audit'),
    health:   ()                 => ipcRenderer.invoke('sandbox:health'),
    onApprovalNeeded: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('sandbox:approval-needed', h);
      return () => ipcRenderer.removeListener('sandbox:approval-needed', h);
    },
  },

  // ── Graph Reasoner (DAG planning — enhances heuristic planner) ────────────
  graph: {
    createPlan:  (opts)               => ipcRenderer.invoke('graph:create-plan',  opts),
    updateNode:  (opts)               => ipcRenderer.invoke('graph:update-node',  opts),
    getPlan:     (planId)             => ipcRenderer.invoke('graph:get-plan',     planId),
    listPlans:   ()                   => ipcRenderer.invoke('graph:list-plans'),
    replan:      (opts)               => ipcRenderer.invoke('graph:replan',       opts),
    metrics:     ()                   => ipcRenderer.invoke('graph:metrics'),
  },

  // ── Self-Care (health monitoring + anti-liability engine) ─────────────────
  selfCare: {
    start:         ()                => ipcRenderer.invoke('selfcare:start'),
    stop:          ()                => ipcRenderer.invoke('selfcare:stop'),
    sweep:         ()                => ipcRenderer.invoke('selfcare:sweep'),
    heal:          (opts)            => ipcRenderer.invoke('selfcare:heal',         opts),
    trackScore:    (axis, score)     => ipcRenderer.invoke('selfcare:track-score',  { axis, score }),
    getLog:        ()                => ipcRenderer.invoke('selfcare:get-log'),
    getAlerts:     ()                => ipcRenderer.invoke('selfcare:get-alerts'),
    getComponents: ()                => ipcRenderer.invoke('selfcare:get-components'),
    getBaselines:  ()                => ipcRenderer.invoke('selfcare:get-baselines'),
    onHealthUpdate: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('selfcare:health-update', h);
      return () => ipcRenderer.removeListener('selfcare:health-update', h);
    },
    onAlert: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('selfcare:alert', h);
      return () => ipcRenderer.removeListener('selfcare:alert', h);
    },
    onRegression: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('selfcare:regression', h);
      return () => ipcRenderer.removeListener('selfcare:regression', h);
    },
  },

  // ── App controls ──────────────────────────────────────────────────────────
  appControl: {
    setLoginItem: (enabled) => ipcRenderer.invoke('app:set-login-item', enabled),
    getLoginItem: ()         => ipcRenderer.invoke('app:get-login-item'),
    getVersion:   ()         => ipcRenderer.invoke('app:get-version'),
    isPackaged:   ()         => !process.env.RAMA_DEV || process.env.RAMA_DEV === '0',
  },

  // ── Platform info (read-only, safe to expose) ─────────────────────────────
  platform: process.platform,
  isDev:    process.env.RAMA_DEV === '1',

  // ── Generic invoke — allows any registered channel (replaces window.ipcRenderer) ──
  // This is the escape hatch so pages calling window.ipcRenderer.invoke() work.
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const handler = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  removeListener: (channel, cb) => ipcRenderer.removeListener(channel, cb),

  // ── Credential Vault ──────────────────────────────────────────────────────
  // unlock/lock/set/get/list/delete/has all gate on vault.unlock/read/write
  // (tier 0, master-only) — every credential in here is master's, not a
  // per-user store. `status` alone stays user-less: it exposes no secret
  // (just locked/unlocked + a count), matching os.metrics-read's openness.
  vault: {
    unlock:  (user, password)        => ipcRenderer.invoke('vault:unlock', { user, password }),
    lock:    (user)                  => ipcRenderer.invoke('vault:lock', { user }),
    status:  ()                      => ipcRenderer.invoke('vault:status'),
    set:     (user, service, value, meta) => ipcRenderer.invoke('vault:set', { user, service, value, meta }),
    get:     (user, service)         => ipcRenderer.invoke('vault:get', { user, service }),
    list:    (user)                  => ipcRenderer.invoke('vault:list', { user }),
    delete:  (user, service)         => ipcRenderer.invoke('vault:delete', { user, service }),
    has:     (user, service)         => ipcRenderer.invoke('vault:has', { user, service }),
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
    ollamaPull:       (opts, cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('models:ollama-pull-progress', handler);
      const promise = ipcRenderer.invoke('models:ollama-pull', opts);
      return promise.finally(() => ipcRenderer.removeListener('models:ollama-pull-progress', handler));
    },
    // Custom OpenAI-compatible providers — master-only (models.add-key).
    listCustomProviders:   (opts)  => ipcRenderer.invoke('models:list-custom-providers', opts),
    addCustomProvider:     (opts)  => ipcRenderer.invoke('models:add-custom-provider', opts),
    removeCustomProvider:  (opts)  => ipcRenderer.invoke('models:remove-custom-provider', opts),
  },

  // ── Agent Orchestrator ────────────────────────────────────────────────────
  // spawn/kill/killAll/setGovernor gate on agents.spawn/kill-own/kill-all/
  // governor-config — spawning and killing agents that can call models and
  // browse on master's behalf is not read-only, and was previously unchecked.
  agents: {
    spawn:        (user, opts) => ipcRenderer.invoke('agents:spawn', { user, ...opts }),
    kill:         (user, id)   => ipcRenderer.invoke('agents:kill', { user, agentId: id }),
    killAll:      (user)       => ipcRenderer.invoke('agents:kill-all', { user }),
    list:         ()           => ipcRenderer.invoke('agents:list'),
    get:          (id)         => ipcRenderer.invoke('agents:get', id),
    getAudit:     ()           => ipcRenderer.invoke('agents:get-audit'),
    getResources: ()           => ipcRenderer.invoke('agents:get-resources'),
    setGovernor:  (user, limits) => ipcRenderer.invoke('agents:set-governor', { user, ...limits }),
    getReputation:()           => ipcRenderer.invoke('agents:get-reputation'),
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
};

// ─── Compatibility shim ───────────────────────────────────────────────────────
// Several pages were written against window.ipcRenderer directly.
// This exposes a SAFE, allow-listed subset — not the raw ipcRenderer object.
// Only channels registered by our own IPC modules can be invoked.
const ALLOWED_PREFIXES = [
  'window:', 'nav:', 'badge:', 'system:', 'fs:', 'git:', 'terminal:', 'apps:', 'ai:',
  'updater:', 'shell:', 'notify', 'orchestrator:', 'evolution:', 'intel:',
  'session:', 'store:', 'nucleus:', 'ipc-enc:', 'bus:', 'ast:', 'regen:',
  'vector:', 'sandbox:', 'graph:', 'selfcare:', 'vault:', 'models:',
  'agents:', 'browser:', 'app:', 'capability:', 'genome:', 'instance:',
  'proposals:', 'meta:', 'timeline:', 'auth:', 'voice:', 'appearance:',
  'health:', 'resource:', 'release:', 'update:', 'stockmind:',
];

function isAllowed(channel) {
  return typeof channel === 'string' && ALLOWED_PREFIXES.some(p => channel.startsWith(p));
}

const IPC_SHIM = {
  invoke: (channel, ...args) => {
    if (!isAllowed(channel)) {
      console.error(`[preload] Blocked invoke on unregistered channel: ${channel}`);
      return Promise.resolve({ ok: false, error: `Channel not allowed: ${channel}` });
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel, ...args) => {
    if (!isAllowed(channel)) {
      console.error(`[preload] Blocked send on unregistered channel: ${channel}`);
      return;
    }
    ipcRenderer.send(channel, ...args);
  },
  on: (channel, cb) => {
    if (!isAllowed(channel)) {
      console.error(`[preload] Blocked listener on unregistered channel: ${channel}`);
      return () => {};
    }
    const handler = (event, ...args) => cb(event, ...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  removeListener: (channel, handler) => {
    if (!isAllowed(channel)) return;
    ipcRenderer.removeListener(channel, handler);
  },
};

// ─── Guarded exposure ─────────────────────────────────────────────────────────
/**
 * `contextBridge` rejects values it cannot clone — a class instance, a Symbol, a
 * getter that throws. When that happens mid-object the whole bridge is lost and
 * the renderer sees `window.rama === undefined`, which surfaces as an unrelated
 * "not a function" somewhere far away. Report it instead of losing it.
 */
function expose(name, value) {
  try {
    contextBridge.exposeInMainWorld(name, value);
    return null;
  } catch (err) {
    const detail = `${name}: ${err.message}`;
    console.error(`[preload] FAILED to expose window.${name} —`, err);
    return detail;
  }
}

const failures = [
  expose('rama', RAMA_API),
  expose('ipcRenderer', IPC_SHIM),
].filter(Boolean);

if (failures.length === 0) {
  // A positive signal is worth as much as an error: it proves the bridge is live
  // and tells us which namespaces the renderer can actually reach.
  console.warn(`[preload] Bridge ready — ${Object.keys(RAMA_API).length} namespaces exposed`);
} else {
  // Tell the main process so it appears in the launcher output and the window,
  // not only in a DevTools console the user may not have open.
  try { ipcRenderer.send('app:preload-error', failures); } catch { /* bridge is very broken */ }

  // Last resort: expose a marker so the renderer can explain itself rather than
  // failing with a confusing TypeError on the first IPC call it attempts.
  try {
    contextBridge.exposeInMainWorld('rama', {
      __preloadFailed: true,
      __errors: failures,
    });
  } catch { /* nothing more can be done from here */ }
}
