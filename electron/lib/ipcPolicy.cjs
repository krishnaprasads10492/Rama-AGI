'use strict';

/**
 * ipcPolicy.cjs — what every IPC channel requires, as declared data (Section 196).
 *
 * ONE ROW PER REGISTERED CHANNEL. The gate in lib/ipcGuard.cjs reads this and nothing else, so the
 * answer to "who may call this" is a line of text rather than a search through 43 files.
 *
 * THE VERDICTS:
 *
 *   'self'          the handler performs its own capability check. ASSERTED by verifyIpcPolicy: if
 *                   the check is ever removed from the handler, the row becomes a lie and the suite
 *                   fails. This is not a promise, it is a cross-reference.
 *   'cap:<name>'    the gate enforces <name> centrally, before the handler runs
 *   'bootstrap'     must be callable with nobody signed in - login, unlock, first-run. Protected by
 *                   the passphrase, not by a capability, and that is the whole point of the class
 *   'public'        deliberately open and not privileged - window chrome, zoom
 *   'observe'       NOT YET CLASSIFIED. The gate records the call and enforces nothing
 *
 * 'observe' IS A DEBT REGISTER, not a verdict, and it may only SHRINK. 149 channels are in it
 * today. Every one is a handler that trusts whoever called it, and the plan in 196.5 brings them
 * down in tranches, highest privilege first. The suite fails if the count goes up.
 *
 * WHY NOTHING IS ENFORCED CENTRALLY ON DAY ONE. A default-deny gate switched on at once would be
 * correct and would break the app on the first channel nobody had classified yet - and a security
 * control that has to be reverted teaches everyone to revert security controls. So the control ships
 * behaving identically to today, and tightens one row at a time with the UI exercised each time.
 *
 * Generated from the code as it stood, then corrected by hand. Counts at that moment:
 *   self 191, observe 149, bootstrap 16, public 10, enforced here 3
 */
const POLICY = Object.freeze({
  'agents:get': 'observe',
  'agents:get-audit': 'observe',
  'agents:get-reputation': 'observe',
  'agents:get-resources': 'observe',
  'agents:kill': 'self',  // enforces agents.kill-own
  'agents:kill-all': 'self',  // enforces agents.kill-all
  'agents:list': 'observe',
  'agents:set-governor': 'self',  // enforces agents.governor-config
  'agents:spawn': 'self',
  'ai:get-status': 'observe',
  'ai:start-backend': 'observe',
  'ai:stop-backend': 'observe',
  'app:get-login-item': 'observe',
  'app:get-version': 'bootstrap',
  'app:preload-error': 'bootstrap',
  'app:set-login-item': 'observe',
  'appearance:display-info': 'public',
  'appearance:get-zoom': 'public',
  'appearance:nudge-zoom': 'public',
  'appearance:reset-zoom': 'public',
  'appearance:set-zoom': 'public',
  'apps:execute': 'self',
  'apps:get-audit-log': 'self',  // enforces apps.view
  'apps:get-capabilities': 'self',  // enforces apps.view
  'apps:get-registry': 'self',  // enforces apps.view
  'apps:scan-installed': 'self',  // enforces apps.view
  'apps:set-blacklist': 'self',  // enforces apps.execute-all
  'apps:set-whitelist': 'self',  // enforces apps.execute-all
  'ast:analyze-file': 'observe',
  'ast:analyze-repo': 'observe',
  'ast:cache-clear': 'observe',
  'ast:impact-analysis': 'observe',
  'auth:change-password': 'self',
  'auth:check-password': 'observe',
  'auth:create-user': 'self',
  'auth:delete-user': 'self',
  'auth:instance-info': 'bootstrap',
  'auth:issue-key': 'self',
  'auth:keygen': 'bootstrap',
  'auth:keygen-credentials': 'bootstrap',
  'auth:keygen-step': 'bootstrap',
  'auth:list-users': 'self',
  'auth:login-step1': 'bootstrap',
  'auth:login-step2': 'bootstrap',
  'auth:logout': 'bootstrap',
  'auth:me': 'bootstrap',
  'auth:provision': 'bootstrap',
  'auth:reset-password': 'self',
  'auth:sessions': 'self',
  'auth:set-active': 'self',
  'auth:set-tier': 'self',
  'auth:status': 'self',
  'autonomy:resume': 'observe',
  'autonomy:status': 'observe',
  'autonomy:stop': 'observe',
  'badge:bring-to-front': 'observe',
  'badge:clicked': 'public',
  'badge:get-enabled': 'observe',
  'badge:set-enabled': 'observe',
  'badge:set-hide-tray': 'observe',
  'brokerAccounts:detect-ip': 'self',
  'brokerAccounts:distributable-remove': 'self',
  'brokerAccounts:distributable-save': 'self',
  'brokerAccounts:list': 'self',
  'brokerAccounts:remove': 'self',
  'brokerAccounts:save': 'self',
  'brokers:drift-check': 'self',  // enforces vault.read
  'brokers:fields': 'self',  // enforces vault.read
  'brokers:list': 'self',  // enforces vault.read
  'browser:close': 'self',
  'browser:close-page': 'self',
  'browser:download': 'self',
  'browser:execute-js': 'self',
  'browser:fetch-url': 'self',
  'browser:get-content': 'self',
  'browser:get-downloads': 'self',
  'browser:launch': 'self',
  'browser:list-pages': 'self',
  'browser:navigate': 'self',
  'browser:open-page': 'self',
  'browser:runtime': 'self',
  'browser:screenshot': 'self',
  'browser:search': 'self',
  'bus:emit': 'observe',
  'bus:history': 'observe',
  'bus:status': 'observe',
  'deps:review': 'self',  // enforces self-modify.view
  'engineSetup:install-python': 'self',
  'engineSetup:run': 'self',
  'engineSetup:status': 'self',
  'evolution:analyze-and-propose': 'observe',
  'evolution:apply': 'observe',
  'evolution:approve': 'observe',
  'evolution:get-log': 'observe',
  'evolution:get-scout': 'observe',
  'evolution:read-repo': 'observe',
  'evolution:reject': 'observe',
  'evolution:scout': 'observe',
  'evolution:self-assess': 'observe',
  'fs:copy-file': 'self',  // enforces os.filesystem-write
  'fs:create-dir': 'self',  // enforces os.filesystem-write
  'fs:delete-file': 'self',  // enforces os.filesystem-delete
  'fs:find-dupes': 'self',  // enforces os.filesystem-read
  'fs:get-disk-sizes': 'self',  // enforces os.filesystem-read
  'fs:get-stats': 'self',  // enforces os.filesystem-read
  'fs:list-dir': 'self',  // enforces os.filesystem-read
  'fs:move-file': 'self',  // enforces os.filesystem-write
  'fs:read-file': 'self',  // enforces os.filesystem-read
  'fs:rename': 'self',  // enforces os.filesystem-write
  'fs:search-files': 'self',  // enforces os.filesystem-read
  'fs:select-path': 'observe',
  'fs:show-in-explorer': 'self',  // enforces os.filesystem-read
  'fs:write-file': 'self',  // enforces os.filesystem-write
  'genome:expressed': 'self',
  'genome:genes': 'self',
  'genome:get': 'self',
  'genome:propose-change': 'self',  // enforces genome.propose
  'genome:roles': 'self',
  'genome:verify': 'self',
  'git:checkout': 'self',  // enforces git.commit
  'git:clone': 'self',  // enforces git.push
  'git:commit': 'self',  // enforces git.commit
  'git:diff': 'self',  // enforces git.read
  'git:get-branches': 'self',  // enforces git.read
  'git:get-remotes': 'self',  // enforces git.read
  'git:log': 'self',  // enforces git.read
  'git:pull': 'self',  // enforces git.commit
  'git:push': 'self',  // enforces git.push
  'git:stage': 'self',  // enforces git.commit
  'git:start-watch': 'self',
  'git:status': 'self',  // enforces git.read
  'git:stop-watch': 'observe',
  'gitAuth:expiry': 'self',
  'gitAuth:remove': 'self',
  'gitAuth:scrub': 'self',
  'gitAuth:set': 'self',
  'gitAuth:set-expiry': 'self',
  'gitAuth:status': 'self',
  'gitAuth:test': 'self',
  'graph:create-plan': 'observe',
  'graph:get-plan': 'observe',
  'graph:list-plans': 'observe',
  'graph:metrics': 'observe',
  'graph:replan': 'observe',
  'graph:update-node': 'observe',
  'health:crash-dir': 'observe',
  'health:crash-reports': 'observe',
  'health:repair': 'observe',
  'health:startup': 'observe',
  'instance:audit': 'self',
  'instance:ensure-prime': 'observe',
  'instance:express': 'self',
  'instance:failover': 'self',
  'instance:get': 'self',
  'instance:list': 'self',
  'instance:record': 'self',
  'instance:restore': 'observe',
  'instance:resume': 'self',
  'instance:spawn': 'self',
  'instance:stats': 'self',
  'instance:suspend': 'self',
  'instance:terminate': 'self',
  'intel:analyze': 'observe',
  'intel:check-source': 'observe',
  'intel:get-session': 'observe',
  'intel:list-sessions': 'observe',
  'ipc-enc:clear': 'observe',
  'ipc-enc:decrypt-from-state': 'observe',
  'ipc-enc:encrypt-for-state': 'observe',
  'ipc-enc:init': 'observe',
  'ipc-enc:status': 'observe',
  'ipc-enc:verify': 'observe',
  'kiteSession:fetch-bars': 'self',
  'kiteSession:login-complete': 'self',
  'kiteSession:login-start': 'self',
  'kiteSession:logout': 'self',
  'market:backtest': 'self',  // enforces stockmind.request
  'market:backtest-presets': 'self',  // enforces stockmind.view
  'market:costs-watch': 'self',  // enforces stockmind.request
  'market:dataset-delete': 'self',  // enforces stockmind.request
  'market:dataset-save': 'self',  // enforces stockmind.request
  'market:derivatives-sync': 'self',  // enforces stockmind.request
  'market:health': 'self',  // enforces stockmind.view
  'market:macro-sync': 'self',  // enforces stockmind.request
  'market:news-backfill': 'self',  // enforces stockmind.config
  'market:news-sync': 'self',  // enforces stockmind.request
  'market:predict': 'self',  // enforces stockmind.request
  'market:resolve-outcomes': 'self',  // enforces stockmind.request
  'market:scheduler-status': 'self',  // enforces stockmind.view
  'market:strategy-backtest': 'self',  // enforces stockmind.request
  'market:strategy-code': 'self',  // enforces stockmind.request
  'market:strategy-score': 'self',  // enforces stockmind.request
  'market:train': 'self',  // enforces stockmind.config
  'market:train-horizons': 'self',  // enforces stockmind.config
  'meta:audit': 'self',
  'meta:audits': 'self',
  'meta:outcomes': 'self',
  'meta:profile': 'self',
  'meta:profiles': 'self',
  'meta:record': 'observe',
  'meta:regressions': 'self',
  'meta:reset-baseline': 'self',
  'meta:summary': 'self',
  'meta:vectors': 'self',
  'models:add-custom-provider': 'self',  // enforces models.add-key
  'models:chat': 'observe',
  'models:check-credentials': 'observe',
  'models:cloud-list': 'observe',
  'models:cloud-status': 'observe',
  'models:converse': 'self',  // enforces models.use
  'models:get-primary': 'observe',
  'models:list': 'observe',
  'models:list-custom-providers': 'self',  // enforces models.use
  'models:migration-plan': 'self',  // enforces models.use
  'models:needs-for-task': 'observe',
  'models:ollama-list': 'observe',
  'models:ollama-pull': 'self',  // enforces models.ollama-pull
  'models:refresh-catalog': 'self',  // enforces models.add-key
  'models:remove-custom-provider': 'self',  // enforces models.add-key
  'models:role-research': 'self',  // enforces models.use
  'models:roles': 'self',  // enforces models.use
  'models:route': 'observe',
  'models:search-web': 'self',  // enforces browser.search
  'models:set-primary': 'observe',
  'models:suggestions': 'observe',
  'notify': 'observe',
  'nucleus:get-identity': 'self',  // enforces identity.reveal
  'nucleus:get-prompt': 'self',  // enforces identity.reveal
  'nucleus:lock': 'observe',
  'nucleus:patch': 'self',  // enforces self-modify.apply
  'nucleus:seal': 'self',  // enforces self-modify.apply
  'nucleus:status': 'observe',
  'nucleus:unseal': 'observe',
  'orchestrator:api-limits': 'observe',
  'orchestrator:cancel': 'observe',
  'orchestrator:optimal-model': 'observe',
  'orchestrator:record-api-use': 'observe',
  'orchestrator:set-limits': 'observe',
  'orchestrator:status': 'observe',
  'orchestrator:submit': 'observe',
  'popout:dock': 'observe',
  'popout:redeem': 'observe',
  'proposals:apply': 'self',  // enforces self-modify.apply
  'proposals:approve': 'observe',
  'proposals:audit': 'self',
  'proposals:create': 'self',
  'proposals:flush': 'self',
  'proposals:get': 'self',
  'proposals:list': 'self',
  'proposals:reject': 'observe',
  'proposals:stats': 'self',
  'publish:preview-notes': 'observe',
  'publish:proposal': 'self',  // enforces release.cut
  'refresh:run': 'self',  // enforces self-modify.view
  'refresh:status': 'self',  // enforces git.read
  'regen:apply': 'observe',
  'regen:approve': 'observe',
  'regen:get-prompt': 'observe',
  'regen:get-proposal': 'observe',
  'regen:list-proposals': 'observe',
  'regen:queue': 'observe',
  'regen:reject': 'observe',
  'regen:research': 'observe',
  'regen:set-fix': 'observe',
  'release:cut': 'self',  // enforces release.cut
  'release:state': 'bootstrap',
  'resource:catalog': 'observe',
  'resource:propose-enable': 'observe',
  'resource:research': 'observe',
  'sandbox:approve': 'self',  // enforces sandbox.approve
  'sandbox:audit': 'observe',
  'sandbox:execute': 'self',  // enforces sandbox.execute
  'sandbox:health': 'observe',
  'sandbox:kill': 'self',  // enforces sandbox.execute
  'self:describe': 'self',  // enforces self.describe
  'selfcare:get-alerts': 'observe',
  'selfcare:get-baselines': 'observe',
  'selfcare:get-components': 'observe',
  'selfcare:get-log': 'observe',
  'selfcare:heal': 'observe',
  'selfcare:start': 'observe',
  'selfcare:stop': 'observe',
  'selfcare:sweep': 'observe',
  'selfcare:track-score': 'observe',
  'session:change-passcode': 'observe',
  'session:is-first-run': 'bootstrap',
  'session:lock': 'bootstrap',
  'session:status': 'bootstrap',
  'session:unlock': 'bootstrap',
  'shell:open-external': 'observe',
  'store:export-backup': 'observe',
  'store:find': 'observe',
  'store:get': 'observe',
  'store:push': 'observe',
  'store:remove': 'observe',
  'store:save': 'observe',
  'store:set': 'observe',
  'store:status': 'observe',
  'store:update': 'observe',
  'system:clean-temp': 'self',  // enforces os.temp-clean
  'system:get-disk-usage': 'observe',
  'system:get-metrics': 'observe',
  'system:get-network-stats': 'self',  // enforces os.process-list
  'system:get-own-footprint': 'observe',
  'system:get-processes': 'self',  // enforces os.process-list
  'system:get-temp-targets': 'observe',
  'system:kill-process': 'self',  // enforces os.process-kill
  'system:start-stream': 'observe',
  'system:stop-stream': 'observe',
  'terminal:create': 'self',  // enforces terminal.open
  'terminal:destroy': 'cap:terminal.open',
  'terminal:resize': 'cap:terminal.open',
  'terminal:write': 'cap:terminal.open',
  'timeline:compare': 'observe',
  'timeline:file-history': 'observe',
  'timeline:flashback': 'observe',
  'timeline:get': 'observe',
  'timeline:mark': 'observe',
  'timeline:markers': 'observe',
  'timeline:propose-restore': 'observe',
  'tracking:query': 'self',
  'tracking:shape': 'observe',
  'tracking:summary': 'self',
  'update:channel-apply': 'self',  // enforces system.self-update
  'update:channel-publish': 'self',  // enforces system.self-update
  'update:channel-status': 'self',  // enforces stockmind.view
  'update:check': 'observe',
  'update:install-build': 'self',  // enforces system.self-update
  'update:pull-build': 'self',  // enforces system.self-update
  'update:release': 'self',  // enforces system.self-update
  'update:reload-window': 'self',  // enforces system.self-update
  'update:restart-app': 'self',  // enforces system.self-update
  'update:restart-backend': 'self',  // enforces system.self-update
  'update:self-build': 'self',  // enforces system.self-update
  'updater:check': 'observe',
  'updater:install-now': 'observe',
  'vault:delete': 'self',  // enforces vault.write
  'vault:get': 'self',  // enforces vault.read
  'vault:has': 'self',  // enforces vault.read
  'vault:list': 'self',  // enforces vault.read
  'vault:lock': 'self',  // enforces vault.unlock
  'vault:set': 'self',  // enforces vault.write
  'vault:status': 'observe',
  'vault:unlock': 'self',  // enforces vault.unlock
  'vector:bulk-store': 'observe',
  'vector:health': 'observe',
  'vector:is-duplicate': 'observe',
  'vector:search': 'observe',
  'vector:store': 'observe',
  'voice:capabilities': 'observe',
  'voice:cloud-optin': 'observe',
  'voice:rescan': 'observe',
  'voice:set-cloud-optin': 'observe',
  'voice:transcribe': 'self',
  'window:close': 'public',
  'window:is-maximized': 'public',
  'window:maximize': 'public',
  'window:minimize': 'public',
  'window:popout': 'observe',
  'window:popouts': 'observe',
  'workspace:create': 'self',  // enforces os.filesystem-write
  'workspace:detect': 'self',
  'workspace:forget': 'self',
  'workspace:list': 'self',
  'workspace:pin': 'self',
  'workspace:preferred': 'self',
  'workspace:register': 'self',
  'workspace:templates': 'self',
  'workspace:touch': 'self',
});

module.exports = { POLICY };
