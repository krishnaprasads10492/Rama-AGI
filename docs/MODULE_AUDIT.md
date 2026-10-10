# Rāma AGI — module-by-module audit

**Read-only investigation.** No source file was modified. The only file written is this one.
Temporary analysis scripts were written to `%TEMP%\rama_audit\` (outside the repo) and are named
where their output is quoted.

Content audited: the working tree that is now commit **`9054252`** on `dev`. It started as
`7b3c9fd` plus six uncommitted files, which a concurrent process committed mid-audit — see §0.3.

---

## 0. SUMMARY ANSWER FIRST

### 0.1 What I measured (ran), versus what I read

| Check | Command | Result |
|---|---|---|
| Verification suites | `npm run verify` | **39 suites, 4,686 `PASS` assertion lines, 0 failures.** No line matching `[1-9]\d* failed`, no line starting `FAIL`. Log: `%TEMP%\rama_verify.log` |
| Renderer bridge audit | `node scripts\auditRenderer.cjs` | 84 files, 38 store destructures, **141 bridge calls**, **372 IPC channels matched**, all resolve |
| Production build | `npm run build` | `vite build` succeeded in 24.46 s; `verifyBundleGraph.cjs` **21 passed, 0 failed**. Startup payload **324.02 kB across 5 chunks**; `vendor-monaco` 4,180.50 kB and `WhyPanel` 208.41 kB are both off the startup path |
| Python syntax | `python -m py_compile` on all 52 `.py` files | exit 0 — all compile |
| Python runtime | `python -c "import numpy"` | **ImportError.** Python here is **3.14.4**; `numpy==1.26.4` publishes no wheel past CPython 3.12 |
| Engine interpreter ladder | checked all four rungs on disk | `RAMA_PYTHON` unset; `%APPDATA%\rama-agi\python-env`, `%APPDATA%\Rama AGI\python-env` and `.venv-stockmind` all **absent** |

**Therefore: every statement in this report about `ai_backend/` runtime behaviour is unverified.**
The engine has never executed on this machine. `ai_backend/main.py` and all 30 `engine/*.py`
modules parse and compile, and that is the whole of what I can say about them.

I did not launch Electron. Nothing in this report about main-process runtime behaviour was
observed; it is read from source with file:line citations. Where I say "measured" I ran something.

### 0.2 The five findings that matter most

1. **Ghost Mode cannot wipe anything, and the server endpoint that claims to wipe does nothing.**
   `src/services/ghostMode.js:25` clears only `localStorage` keys starting `rama_` or `sm_`. Every
   key the app actually writes is dot-separated: `rama.micMode`, `rama.paletteOpen`,
   `rama.stockmind.chart`, `rama.stockmind.drawings.<SYMBOL>`, `rama.stockmind.workspace`
   (`src/store/uiStore.js:30,58-60,99`; `src/pages/StockMind/PriceChart.jsx:57`;
   `src/pages/StockMind/chartDrawings.js:84`; `src/pages/StockMind/StockMind.jsx:882`). None match.
   Separately `server/index.cjs:72-80` answers `POST /api/ghost/wipe` with `ok:true` and the message
   "Server wipe acknowledged" after doing nothing but a `console.warn` — its own comment says
   "Signal main process to wipe encrypted data" and no signal is sent. And neither
   `activateGhostMode()` nor `wipeServerData()` has a caller anywhere in `src/`. **HIGH.**

2. **Function tracking records nothing.** `electron/lib/functionTracking.cjs:109 record()` has
   **zero production call sites** — only `scripts/verifyFunctionTracking.cjs:19`. The read side
   (`electron/ipc/tracking.cjs`, three channels, `audit.all`-gated) is correct and honest about it
   (`tracking.cjs:70` returns `instrumented:false`), and `window.rama.tracking.*` is exposed at
   `preload.cjs:665-668` with **no renderer caller**. This is the capability master asked for in
   order to validate backtesting; end to end there is no producer and no consumer. **HIGH (feature
   absent, not broken).**

3. **The per-turn privacy gate has no producer.** `electron/ipc/modelRouter.cjs:514` accepts
   `sensitive = false`; `electron/lib/conversationRole.cjs:291-295` refuses a sensitive turn aimed
   at cloud and `:389-393` forces a private model. `src/pages/Chat/Chat.jsx:277-279` is the only
   caller of `models:converse` and **never sends `sensitive`**, so it is always `false` and the gate
   can never engage. **HIGH.**

4. **`window.rama.invoke` is an unrestricted `ipcRenderer.invoke` on every one of 365 channels.**
   `electron/preload.cjs:780`. The guarded shim next to it (`preload.cjs:936-944`, `ALLOWED_PREFIXES`
   at `:925`) exists precisely to stop this, and both are exposed (`:984-986`). Nothing in `src/`
   uses `window.rama.invoke` (grepped). With `contextIsolation:true`, `nodeIntegration:false`
   (`main.cjs:1273-1276`) and a CSP of `script-src 'self' 'unsafe-inline'` (`main.cjs:328`) there is
   no remote-script origin, so I rate this **MEDIUM** — a defence-in-depth hole and dead code, not a
   live exploit path.

5. **`src/pages/Knowledge/Knowledge.jsx:10-13` ships two hardcoded fake entries** ("System
   Architecture", "StockMind Integration") on a page reachable from the registry, with a non-functional
   "+ Add Entry" button (`:29`, no `onClick`) and an empty state promising "Phase 5 will connect this
   to MongoDB" (`:44`). MongoDB is not a dependency. The `knowledge` store domain
   (`electron/dataStore.cjs:160`) is loaded, saved and re-keyed and is **never written by anything**.
   **HIGH** — in a project whose own capability audit document separates real from fabricated, a
   shipped page displaying invented rows is the worst class of defect here.

### 0.3 The tree was dirty when this audit started, and was committed mid-audit by another process

At the start of this investigation `git status --porcelain` reported:

```
 M electron/lib/conversationRole.cjs
 M package.json
 M scripts/verifyConversation.cjs
 M src/components/CommandPalette.jsx
?? docs/UserGuide.pdf
?? scripts/buildUserGuide.mjs
```

**This audit read, and `npm run verify` / `npm run build` were run against, that modified tree.**
Partway through, a concurrent process committed it as `9054252`
*"fix(voice): the reply protocol was on the destination master never uses, and a label that never
cleared"* — 7 files, +776/-8, adding a Section 142 to `RAMA_AGI_MASTER_SPEC.md`, `docs/UserGuide.pdf`
and `scripts/buildUserGuide.mjs`. I issued no git write command; this was not me. The tree is now
clean at `9054252` on `dev`, pushed to `origin/dev` and `origin/source`.

So the audited content equals `9054252`, not `7b3c9fd`. Where sections below say "uncommitted" of
that work, read it as "committed during the audit as `9054252`". It covers master's items 1-3 from
the last request: `REPLY_PROTOCOL_LINES` + `withReplyProtocol()` reaching **both** destinations
(previously the protocol lived only on the cloud path master never uses), the `endTalk` failure path
that clears the stuck "Transcribing…" label, and the `UserGuide.pdf` generator.

This report lives at `.agents/tasks/module-audit/MODULE_AUDIT.md`, which `.gitignore:47` excludes
(`git check-ignore -v` confirms), so it cannot be swept into a commit.

I verified against the originating request text. Item 1 of the first message ("future prediction
should be calculated for the time period the user selects") **is** implemented and reachable:
`src/pages/StockMind/PriceChart.jsx:1367-1374,2335-2381` renders preset horizon chips plus a
free-text period box, `chartProjection.horizonFor` converts and refuses, and
`src/pages/StockMind/StockMind.jsx:372` forwards `bars: horizonBars` to `market:forecast`. The
"background iteration" half is partly present (`marketIntel.startScheduler`, `market:train-horizons`)
but unreachable from the UI — see §2 and §3.

---

## 1. MODULE ENUMERATION — coverage is provable, not claimed

Counted mechanically with `Get-ChildItem`. **285 source files** in scope.

| Group | Count | Covered in §6 |
|---|---|---|
| `electron/*.cjs` | 12 | §6.1 |
| `electron/ipc/*.cjs` | 26 | §6.2 |
| `electron/lib/*.cjs` | 45 | §6.3 |
| `electron/` total `.cjs` | **83** | |
| `src/pages/**` | 51 | §6.4 |
| `src/services/*` | 11 | §6.5 |
| `src/store/*` | 5 | §6.6 |
| `src/components/*` | 7 | §6.7 |
| `src/config/*` | 3 | §6.8 |
| `src/hooks/*` | 3 | §6.8 |
| `src/utils/*` | 2 | §6.8 |
| `src/*` (App.jsx, main.jsx, index.css) | 3 | §6.8 |
| `src/` total | **85** | |
| `server/**` | 7 | §6.9 |
| `ai_backend/**.py` (main, train, 30 engine, 20 tests) | **52** | §6.10 |
| `shared/*.json` | 4 | §6.11 |
| `scripts/*` (39 of them `verify*`) | 51 | §6.12 |
| repo root `start.cjs`, `start.js`, `vite.config.js` | 3 | §6.13 |

Honesty note on depth: I **read in full** `main.cjs` (boot path), `preload.cjs` (bridge),
`sessionManager.cjs`, `cryptoCore.cjs` (tail), `dataStore.cjs`, `ipcEncryption.cjs` (tail),
`credentialVault.cjs` (both copies), `capability.cjs`, `functionTracking.cjs`, `tracking.cjs`,
`sysinfo.cjs` (head), `aiProcess.cjs` (head), `ghostMode.js`, `selfModify.js`, `ipcClient.js`,
`ramaClient.js`, `ramaStore.js`, `Knowledge.jsx`, `server/**` in full, plus the cited regions of
~25 others. The remaining modules were covered by the **mechanical sweeps** in §2-§5 (export
consumers, empty catches, channel reachability, nested-loop scan) and by their own headers. Where a
§6 row carries no defect, that means *the sweeps found nothing in it* — not that I read every line.

---
## 2. DECLARED-BUT-UNCONSUMED SURFACES

Method (`%TEMP%\rama_audit\unconsumed.js`, then `triage.js`): parse the `module.exports` object and
every `exports.X =` in all 83 `electron/**.cjs` and 7 `server/**.cjs`; for each exported name search
every other `.cjs/.mjs/.js/.jsx/.json/.md/.py` file under `electron, server, src, shared, scripts,
docs, ai_backend` for `.NAME`, `'NAME'`, or the name inside a `require(...)` destructure of that
file. **121 exported names have no external importer.** Triaged by whether the name is used inside
its own file beyond the declaration.

### 2.1 Truly unreferenced — declared and used nowhere at all (21)

These are dead code, not over-exports.

| File:line | Name | Verdict |
|---|---|---|
| `electron/ipcEncryption.cjs:193` | `wrapHandle` | **The enforcement function of the whole "Pervasive Flow Encryption Layer" is never called.** `SENSITIVE_CHANNELS` (`:37`) and `CRITICAL_CHANNELS` are declared, `register()` (`:220-253`) registers only the six `ipc-enc:*` self-describing channels, and **no handler anywhere is wrapped**. `ipc-enc:status` (`:237-241`) truthfully reports `sensitiveChannels: SENSITIVE_CHANNELS.size`, which reads as coverage and is a set size. **MEDIUM** |
| `electron/ipcEncryption.cjs:122,144,268,269` | `encryptPayload`, `decryptPayload`, `isSensitive`, `isCritical` | Same subsystem; no caller. |
| `electron/cryptoCore.cjs:299` | `rewriteVerifier` | Written for the I14 re-key. `sessionManager.changePasscode` (`sessionManager.cjs:259-262`) instead does `secureDelete(rama.verify)` then `writeVerifier()` inline. I14 **holds** — but the step exists twice and only the hand-inlined copy runs. **LOW** |
| `electron/cryptoCore.cjs:239,243` | `encryptString`, `decryptString` | No caller. |
| `electron/lib/capability.cjs:75` | `requireCap` | The **throwing** gate. Every IPC file uses the non-throwing `deny()`. Dead. **LOW** |
| `electron/lib/capability.cjs:19,35` | `TIER_COLORS`, `getCaps` | `src` reads tier colours straight out of `shared/capabilities.json` via `accessControl.js`. Dead on the main side. **LOW** |
| `electron/lib/http.cjs:214` | `getCircuitStatus` | The one HTTP client (I9) has a circuit breaker whose state is unreadable — no channel, no panel. **MEDIUM** (operability) |
| `electron/ipc/agentOrchestrator.cjs:342,727` | `spawnChild`, `lineageOf` | Agent lineage/child-spawn is implemented (`MAX_LINEAGE_DEPTH` at `:40`) and unreachable. **MEDIUM** |
| `electron/lib/verifyProposal.cjs:114` | `createVerified` | No caller. |
| `electron/lib/autonomyStop.cjs:115` | `snapshotRoot` | No caller. |
| `electron/lib/sysinfo.cjs:221` | `cpuInfo` | No caller. |
| `electron/nucleusSealer.cjs:605` | `rounds` | No caller, not even internal. |
| `server/brain/credentialVault.cjs:81,172,183` | `initialize`, `listServices`, `getServiceSummary` | See §4.1 — the whole file is unreachable. |

### 2.2 Over-exported (97) — used internally, no external importer

Not defects. I verified the pattern on `electron/ipc/marketIntel.cjs`: all nine flagged names
(`backtestPresets`, `newsBackfill`, `optionChain`, `outcomeStats`, `modelsStatus`, `horizonsList`,
`predictMulti`, `trainHorizons`, `schedulerStatus`) **are** bound to live handlers in the
channel table at `marketIntel.cjs:564-584` and the `try/return` blocks at `:502,617,650,657`. The
export list is simply broader than any importer needs. Same for `timeline.cjs`, `voiceEngine.cjs`,
`genome.cjs`, `modelRoles.cjs` and the rest. Full list in `%TEMP%\rama_audit\triage.js` output.
**Not reported as defects.**

### 2.3 Config keys and store domains that nothing reads

| File:line | Declaration | Evidence of zero consumers |
|---|---|---|
| `electron/dataStore.cjs:157` | `conversations: { maxPerUser: 500 }` | Grepped `maxPerUser` across `electron, src, server, scripts`: **one hit, the declaration.** And nothing ever writes the `conversations` domain — the only domain writes in the whole main process are `config`, `instances`, `memory`, `proposals` (`resourceOrchestrator.cjs:542`, `instanceManager.cjs:56`, `metaCognition.cjs:270`, `customProviders.cjs:129`, `proposals.cjs:386-388`). Chat history lives only in `src/store/ramaStore.js:21` (in-memory zustand) and **does not survive a restart**, while `conversations.enc` is loaded, saved, autosaved and re-keyed holding nothing. **MEDIUM** |
| `electron/dataStore.cjs:160-163` | `knowledge: { entries: [], index: {} }` | Never written. Backs the mock page in §0.2(5). **MEDIUM** |
| `electron/dataStore.cjs:164-167` | `memory: { episodic, semantic, procedural }` | `metaCognition.cjs:270` writes `memory.experiential` — a **fourth, undeclared key**. The three declared ones are never written. The 500-item cap at `src/services/ramaCore.js:127` applies to a *different*, renderer-only array. **LOW** (shape drift) |
| `electron/dataStore.cjs:170-176` | `worldmodel: { masterPrefs, masterGoals, systemInfo, projects, tasksPending, tasksScheduled }` | Never written. |
| `electron/dataStore.cjs:177-180` | `agents: { history: [], auditLog: [] }` | Never written, and **no cap declared** on either, unlike `proposals.audit` which is capped at 1000 (`proposals.cjs:387`) and `tracking.calls` which is capped at `CAP=2000` (`functionTracking.cjs:42,121`). |
| `src/store/ramaStore.js:11,14` | `apiKey: ''` / `setApiKey` | No consumer outside the store. The `setApiKey` hits in `Models.jsx:108` are a local `useState` of the same name. A plaintext provider-key slot in renderer state, commented "stored encrypted in Phase 2", that nothing writes — misleading surface. **LOW**, flag for removal decision. |
| `electron/preload.cjs:925` | `ALLOWED_PREFIXES` includes `'stockmind:'` | **No channel starts with `stockmind:`.** Two hits repo-wide: the allowlist entry and `marketIntel.cjs:559`, whose comment says so explicitly ("CHANNEL PREFIX IS `market:`, NOT `stockmind:`"). Conversely `market:`, `tracking:`, `workspace:`, `popout:`, `self:`, `publish:`, `refresh:` are **absent** from the allowlist, so any future `window.ipcRenderer.invoke('market:…')` returns `{ok:false,'Channel not allowed'}`. No live defect (those domains are called through `window.rama.*`, which bypasses the shim) but a latent trap plus a dead entry. **LOW** |
| `src/store/*` (5 files) | 13 store keys with no consumer outside their store | `agentStore.removeAgent@16`; `appStore.setActivePage@10, setUpdateAvailable@16, setUpdateDownloaded@17, setSidebarExpanded@21, dismissNotification@37`; `ramaStore.setActiveSession@39, deleteSession@41, setKnowledgeSummary@81, setBackendRunning@85`; `uiStore.setRamaSpeaks@101, setConsciousness@118, setPendingMod@123`; `userStore.usersLoading@18, sessionCapabilities@49, setAuthLoading@63`. Two matter: `setPendingMod` (§3.1) and `setBackendRunning` — the Python-engine running flag is never set, so no page can show whether the engine is up. **MEDIUM for those two, LOW for the rest** |

### 2.4 Whole modules with no importer

| Module | Lines | Evidence |
|---|---|---|
| `server/brain/credentialVault.cjs` | 183 | `require`d by nothing in `server/**` (grepped). See §4.1. |
| `src/services/ghostMode.js` | 130 | Neither export has a caller (grepped `activateGhostMode|wipeServerData|ghostMode` across `src/**` — hits are the file itself only). |
| `src/utils/sanitize.js` | 67 | No `utils/sanitize` import anywhere. `maskSecret` has 1 hit: its own declaration. |
| `src/utils/hmac.js` | 74 | No `utils/hmac` import anywhere; `verifySignature` has **0** hits repo-wide. Its own header declares a security control — "The backend signs every sensitive payload. The client verifies signature before rendering. Prevents tampered or injected data from being displayed" (`hmac.js:5-7`) — **and no payload is signed and nothing verifies.** **MEDIUM** (a stated control that does not exist) |
| `src/hooks/usePageVisibility.js` | 39 | No consumer. |
| `src/hooks/useSessionTimeout.js` | 44 | No consumer — **an idle-session-timeout hook that is never mounted.** Session expiry still exists at `authCore` (`SESSION_TTL_MS`) and `sessionManager.cjs:42` (12 h), so this is a missing UI-side idle lock, not an unbounded session. **MEDIUM** |
| `src/services/ipcClient.js:101-116` | — | `appsClient` and `aiProcessClient` are exported and **imported by nothing** (`GitSync.jsx`, `System.jsx`, `Home.jsx`, `Terminal.jsx` import the other four). Worse, `appsClient` passes **no `user`** (`:103-109`) while `appAssimilation.cjs` gates every handler on `apps.view/apps.execute-safe/apps.execute-all` — so if it were wired it would be denied on every call. |
| `src/services/ramaClient.js:77-79` | `systemHttp` | No consumer. |
| `start.js` (repo root) | 276 | ESM duplicate of `start.cjs` (1678 lines). `package.json:12` points `dev` at `start.cjs`; nothing references `start.js`. **Stale duplicate launcher — flag for master's decision, do not silently delete.** |

---

## 3. GATE WITHOUT A PRODUCER SWEEP

Contracts that are implemented, and in several cases suite-verified, that nothing calls.

### 3.1 Confirmed

| Gate | Where implemented | Why it cannot fire |
|---|---|---|
| **Per-turn sensitivity** | `modelRouter.cjs:514` accepts `sensitive`; `conversationRole.cjs:291-295` refuses malformed flags and refuses sensitive→cloud; `:226-228 sensitiveOrUnknown` resolves unknown to *sensitive*; `:389-393` forces `requirePrivate` | `Chat.jsx:277-279` is the only `models:converse` caller and sends `{ text, turns, revealedPrompt, user, turnId }` — **no `sensitive`**. Destructuring default makes it `false`, which is the one value that disables all three decisions. **CONFIRMED, HIGH** |
| **Function tracking `record()`** | `functionTracking.cjs:109`, with `normalise/prune/query/summarise` and a dedicated suite | Zero production call sites; only `scripts/verifyFunctionTracking.cjs:19`. Read side exists and says `instrumented:false`. **CONFIRMED, HIGH** |
| **Broker connector drift report** | `brokerConnectors.cjs:187 driftReport()`, 234 lines, 3 connectors declared with `fields`, `paths`, `docsUrl`, `docsCheckedAt`, `dataOnly`, suite-verified by `scripts/verifyBrokerConnectors.cjs` (9 assertions incl. the inconclusive-on-short-body rule) | **No `ipcMain.handle` anywhere, no `preload` namespace, no page.** Grepped `brokerConnectors|driftReport` across `electron, src, server, scripts`: the only non-self hits are the verify script. Master asked (message 6) for "the fields to actually add URLs and creds" — the declaration exists, **the form does not**. **CONFIRMED, HIGH (capability absent)** |
| **Self-modify approval modal** | `CommandPalette.jsx:625-632` imports `applyModification` and renders `SelfModifyModal` from `uiStore.pendingModification` | `uiStore.js:123 setPendingMod` has **zero callers**, so `pendingModification` is always `null` (`uiStore.js:122`), the modal never renders and `applyModification` is never reached. **CONFIRMED, MEDIUM** |
| **`models:roles` / `models:role-research`** | `modelRouter.cjs:269` and `:289`. Both fully implemented, `models.use`-gated, backed by `modelRoles.plan()`, `modelRoles.researchPlan()`, `describeRequirement()` and the fetched `ollamaCatalog` | **Named neither in `preload.cjs` nor anywhere in `src/`** (mechanical check, `%TEMP%\rama_audit\shim-check.js`: these are the only two of 365 `handle()` channels in that state). So the Models page cannot tell master which model roles are unfilled, which is what Section 112 built `modelRoles.cjs` (350 lines) for. **CONFIRMED, HIGH (value stranded)** |
| **Ghost Mode, both halves** | `ghostMode.js`, `server/index.cjs:72` | No caller; wrong key prefix; server endpoint is a no-op that returns success. **CONFIRMED, HIGH** |
| **Client-side payload signature verification** | `src/utils/hmac.js` | Nothing signs, nothing imports it. **CONFIRMED, MEDIUM** |
| **Idle session lock** | `src/hooks/useSessionTimeout.js` | Never mounted. **CONFIRMED, MEDIUM** |
| **`resourceResearch.proposeEnable`** | `preload.cjs:422`, `resourceResearchEngine.cjs` `resource:propose-enable` | No caller in `src/` — matches ledger row 52's own open note that `proposeEnable` has nothing to hand it a wiring diff. **CONFIRMED, consistent with the ledger** |
| **`publish.previewNotes`** | `preload.cjs:387` | No caller; `publish.proposal` is called from `Evolution.jsx:360`. |
| **Auto-updater renderer notices** | `preload.cjs:302-325` `updater.onNotice/onAvailable/onDownloaded`; producers at `main.cjs:140` (`updater:notice`) | No renderer subscriber, **and** `appStore.setUpdateAvailable/setUpdateDownloaded` have no callers either. Both ends dead. Consistent with I17 (nothing is published yet), so **LOW**, not a defect. |

### 3.2 Scale of it: the preload surface

`%TEMP%\rama_audit\preload-unused2.js` — parse every 2-space namespace and 4-space member of
`RAMA_API`, then look for `rama.<ns>.<member>`, `'<ns>.<member>'`, or any `.member` property access
anywhere in `src/` (the loose form deliberately over-counts, to allow for the alias pattern
`const api = () => window.rama?.auth` used by `authClient.js:16` and `voiceEngine.js:112`).

```
PRELOAD MEMBERS: 410
NO src/ CALLER AT ALL (no direct path, no same-named property access anywhere): 141
AMBIGUOUS (may be reached via an alias): 106
```

**13 whole namespaces have no `window.rama.<ns>` reference in `src/` at all** (94 members):
`refresh` (3), `orchestrator` (13), `evolution` (12), `intel` (6), `store` (9), `nucleus` (7),
`ipcSec` (6), `bus` (5), `ast` (4), `regen` (10), `health` (5), `genome` (6), `tracking` (3),
`timeline` (7). Of these, five are **duplicate surfaces, not dead features** — see §4.4.
The genuinely unreachable ones are `tracking` (§0.2.2), `health` (startup diagnosis and crash
reports are written by `bootReport.cjs`/`crashGuard.cjs` and surfaced by a native dialog only),
`genome.proposeChange`, `bus`, `ipcSec`, and `nucleus` beyond `status`.

---
## 4. IPC SURFACE

### 4.1 Measured sizes

| Thing | Count | Where |
|---|---|---|
| `RAMA_API` top-level keys | **55** | matches the `[preload] Bridge ready — 55 namespaces exposed` warning at `preload.cjs:991`, which counts `Object.keys(RAMA_API).length`. **49 are object namespaces; 6 are not** — `notify` (`:332`), `platform` (`:775`), `isDev` (`:776`), `invoke` (`:780`), `on` (`:781`), `removeListener` (`:786`). The log wording is loose, not wrong. **LOW** |
| Namespace members | 410 | `preload.cjs` |
| `ipcMain.handle` / `handleOnce` channels | **365** | all of `electron/**` except the two preloads |
| `ipcMain.on` channels | 11 | ditto |
| Channels `auditRenderer.cjs` matches | 372 | measured; it resolves all of them |

### 4.2 Registered in main, never called from the renderer

Mechanical (`%TEMP%\rama_audit\shim-check.js`): of the 365 `handle()` channels, exactly **two** are
named neither in `preload.cjs` nor anywhere in `src/`:

- `models:roles` — `electron/ipc/modelRouter.cjs:269`
- `models:role-research` — `electron/ipc/modelRouter.cjs:289`

Both fully implemented and capability-gated. See §3.1. **HIGH value stranded.**

Of the 11 `ipcMain.on` channels, one is named neither in `preload.cjs` nor `src/`: `badge:clicked`
(`electron/badgeWindow.cjs:121`). **This is correct and not a defect** — its producer is the badge
window's own separate bridge, `electron/badgePreload.cjs:16`.

The wider "never called" direction is the 141 preload members of §3.2. Note the asymmetry the brief
predicted: `auditRenderer.cjs` proves every *renderer→preload* call resolves, so nothing is broken
in that direction; the unused direction is where 34 % of the exposed surface sits.

### 4.3 Renderer calls with no handler

**None found.** Every `window.ipcRenderer.invoke(...)` call site in `src/` resolves to a live
`ipcMain.handle`. Full verification (25 shim call sites):

```
Evolution.jsx:280,286,310,327,335,341,347  -> evolutionEngine.cjs:147,153,72,123,143,144,136
IDE.jsx:212,278,525                        -> codeRegenEngine.cjs:301, sandboxEngine.cjs:193, astEngine.cjs:255
Intelligence.jsx:126,166                   -> intelligenceEngine.cjs:186,114
Resources.jsx:348,382,392,573              -> resourceOrchestrator.cjs:693,687,729,704
Unlock.jsx:36,61                           -> sessionManager.cjs:299,304
consciousness.js:87                        -> nucleusSealer.cjs:548
```

Two `on(...)` subscriptions in `Resources.jsx:367,373` use a **dynamic** channel variable, so they
are not statically checkable by `auditRenderer.cjs` or by me. Not a defect; a coverage gap.

One line flagged by my scan as `invoke()` against an `ipcMain.on` channel is a **false positive**:
`Settings.jsx:255` is inside a JSDoc comment describing the already-fixed Section 90 bug; the live
code at `Settings.jsx:259-266` correctly calls `window.rama.updater.check()`.

### 4.4 Three renderer→main transports, two of them generic

| Transport | Guard | Used by |
|---|---|---|
| `window.rama.<ns>.<fn>` | typed wrapper per channel; verified by `auditRenderer.cjs` | 141 call sites |
| `window.ipcRenderer.*` (`IPC_SHIM`, `preload.cjs:936`) | `ALLOWED_PREFIXES` prefix allowlist (`:925`) | 25 call sites across `Evolution.jsx`, `IDE.jsx`, `Intelligence.jsx`, `Resources.jsx`, `Settings.jsx`, `Unlock.jsx`, `consciousness.js` |
| `window.rama.invoke/on/removeListener` (`preload.cjs:780-786`) | **none** | 0 call sites |

Consequences, in order of weight:

1. **`window.rama.invoke` has no allowlist** (`:780`) while the shim beside it does. Its own comment
   calls it "the escape hatch so pages calling window.ipcRenderer.invoke() work" — but
   `window.ipcRenderer` is still exposed (`:985`), so the escape hatch is redundant *and* weaker than
   the thing it was meant to replace. **MEDIUM.** Mitigations present: `contextIsolation:true`,
   `nodeIntegration:false`, `sandbox:false` (`main.cjs:1273-1276`, `:1619-1622`), CSP
   `script-src 'self' 'unsafe-inline'` with the Monaco CDN removed (`main.cjs:314-328`), external
   `window.open` routed to the OS browser, and no `BrowserWindow` anywhere attaches `preload.cjs` to
   untrusted content (`browserEngine.cjs` drives an external runtime via `browserRuntime.cjs`). So I
   rate it defence-in-depth, **not** a live exploit path. Unsure: I did not audit whether any
   renderer path can inject inline `<script>`; `'unsafe-inline'` means that would be the one route.

2. **Five pages bypass their own typed namespace.** `evolution`, `orchestrator`, `intel`, `ast`,
   `regen` are exposed as namespaces in `preload.cjs` *and* called as raw channel strings by the
   pages that own them. That is why §3.2 shows those namespaces "unused" — the feature works, the
   wrapper is dead, and **the pages' IPC calls are invisible to `auditRenderer.cjs`**, which is the
   static check that exists precisely to catch a renamed or typo'd channel. A bug of exactly this
   class already shipped once (`Settings.jsx:255`'s own comment). **MEDIUM — reduce to one
   transport per page, keeping both bridges in place (additive).**

3. `Unlock.jsx:61` reaches the sign-in gate through the shim:
   `await window.ipcRenderer?.invoke('session:unlock', code) ?? { ok:false, error:'IPC not available' }`.
   It works (the channel is handled at `sessionManager.cjs:304`, the prefix `session:` is
   allowlisted), but the **most load-bearing call in the app** sits on the least-checked path, and
   the `??` would mask a missing bridge as an "IPC not available" string rather than the named preload
   failure `main.cjs:1320-1328` was built to show. `window.rama.session.unlock` (`preload.cjs:449`)
   is right there and unused. **MEDIUM.**

---

## 5. SILENT FAILURE SWEEP

Method (`%TEMP%\rama_audit\catches.js`): brace-match every `catch` body in `electron/`, `src/`,
`server/`, strip comments, classify.

```
TOTAL catch blocks (electron+src+server): 636
EMPTY-BODY catch (comments only or nothing): 201   (31.6 %)
LOG-ONLY catch:                              14
```

Highest per-file counts (empty + log-only): `PriceChart.jsx` 16, `main.cjs` 14,
`sessionManager.cjs` 12, `crashGuard.cjs` 11, `ghostMode.js` 8, `ramaEventBus.cjs` 7,
`voiceEngine.js` 7, `modelRouter.cjs` 6, `system.cjs` 6, `DiffReview.jsx` 6.

### 5.1 Where swallowing is correct

Most of the 201 are, and I will not pad the list. Four legitimate patterns dominate:

- **Best-effort reporting on the way down.** `crashGuard.cjs` (11) and `main.cjs`'s dialog/report
  paths (`:1931`, `:1958`, `:1991`, `:2002`, `:2017`) are the code that runs *because* something
  already failed. A throw there costs the diagnosis. Correct.
- **Deliberately fail-open telemetry.** `functionTracking.cjs:121` documents its own exception to
  the project's fail-closed rule: a recorder that throws takes down the computation it was watching.
  Correct, and the asymmetry is stated.
- **Optional-capability probes.** `sysinfo.cjs:55`, `browserRuntime.cjs:116`, `voiceEngine.cjs:77`,
  `ollamaCloud.cjs:268` — absence is an answer, not an error. Correct (I11).
- **Storage that may not exist.** `uiStore.js:21` (`savePref` in private mode), `PanelBoard.jsx:262`
  (quota), `chartDrawings.js:451`. Correct, and each carries a comment saying why.

### 5.2 The worst offenders

| File:line | Body | Why it hides a real failure |
|---|---|---|
| `src/services/ghostMode.js:30,33,49,57,65,77,84,92` | 8 × `catch { /* ignore */ }` | A **wipe** reports nothing about what it failed to clear. `activateGhostMode()` (`:102-116`) returns `undefined` unconditionally, then navigates to `about:blank`, so even a caller that wanted to know cannot. Combined with the wrong key prefix (§0.2.1) the user sees a blanked window and believes the device is clean. **HIGH** |
| `server/index.cjs:72-80` | not a catch — a `console.warn` standing in for the action | `/api/ghost/wipe` returns `{ok:true, message:'Server wipe acknowledged — restart app to reinitialise'}`. Nothing is wiped and nothing is signalled. A success response for work not done is worse than an error. **HIGH** |
| `src/services/selfModify.js:160-174` | per-file `res` collected, then `return { ok: true, results }` regardless | `applyModification`'s direct-write path reports success even when every write failed, and `res` is `undefined` when `file.action` is none of create/update/delete, which spreads to nothing and vanishes. Compounded by the signature bug in §7.1. **HIGH** |
| `electron/ipc/credentialVault.cjs:235` | `catch { /* unreadable JSON is handled by loadVault below */ }` | Correct **as written**, and I checked it: the salt-migration read is allowed to fail because `loadVault()` reaches a three-state verdict afterwards. Listed only to record that the vault's remaining empty catch is the safe one — the `ok:true`-after-failed-decrypt defect this class caused is **fixed** at `:254-272` and `:127-131`. **No action.** |
| `electron/sessionManager.cjs:98,105,158,199,278` (log-only) and `:112,145,148,149,197,211,333` (empty) | mixed | `:145-149` in `lockSession()` swallow three teardowns in a row — revoking auth storage, locking the nucleus, clearing the IPC session key. If `nucleusSealer.lock()` throws, **the identity nucleus stays decrypted in memory after the store is locked** and nothing says so. `:112` swallows `ipcEncryption.initSession()` on unlock, which is how `_sessionKey` can be null while the app believes a session exists. **MEDIUM — these three should report, not ignore.** |
| `electron/ramaEventBus.cjs:81,116,132,144,157,173,181` | 7 empty | The event bus is the Section-20 "neural lattice" spine. Every subscriber dispatch failure is invisible, so a capability regression event that never arrives is indistinguishable from one that was never emitted. **MEDIUM** |
| `electron/lib/loyaltyCore.cjs:85,109,120,317` | 4 empty | I15/I16 territory. I did **not** read enough of this module to judge whether each is correct, and I16 says no accessor may return the matrix — a reporting change here could itself be a disclosure. **Flagging for the owner rather than proposing a fix.** |
| `src/pages/IDE/DiffReview.jsx:89,93,101-104` | 6 empty | Six consecutive swallows in a diff renderer; a failed hunk parse renders as an empty diff, which reads as "no changes" on a self-modification review screen. **MEDIUM** |
| `src/pages/StockMind/PriceChart.jsx:78,281,784,894,997,…` | 16 empty/log-only | The library (`lightweight-charts`) throws on several misuse paths and the file swallows them. Several carry comments explaining why (duplicate-time series, price-indexed types). I did not verify all 16; the pattern is defensible for a canvas that must keep drawing. **LOW, with the caveat that I did not check each one.** |
| `src/pages/Chat/Chat.jsx:313` | `catch { setStreamText(''); }` | Swallows the `models:converse` failure and falls through to `models:chat`. **Correct and documented** — the refusal path above it (`:301-311`) surfaces refusals, and the fallthrough is I11. **No action.** |

Three defects of this exact class were already found and fixed before this audit (the vault
returning `ok:true` after a failed decrypt, `Models.jsx`'s unlock button with no `else`, and
`Promise.all` stranding the Models page — now `Promise.allSettled` at `Models.jsx:277-304`). The
201-count says the class is not closed.

---

## 6. MODULE-BY-MODULE

Notation: **D** = functionality defect, **U** = declared-but-unconsumed, **P** = performance,
**Q** = code quality. "No finding" means the §2-§5 sweeps found nothing, not that I read every line.

### 6.1 `electron/*.cjs` — 12

| Module | What it does | Findings |
|---|---|---|
| `main.cjs` (1863) | Main process: boot, 48 IPC registrations, window/tray/badge lifecycle, CSP, permissions, updater, local self-update | **P** §8. **Q** 14 empty/log-only catches, mostly correct (crash paths). Boot path is unusually well instrumented — `BOOT_CRITICAL_CHANNELS` (`:128`), `registeredChannels` (`:124`), the registration loop (`:1869-1879`), the `whenReady().catch` (`:1995`) and `bootReport` all exist because each failure happened once. |
| `preload.cjs` (932) | The 55-key bridge, plus the allowlisted `IPC_SHIM`, plus guarded exposure | **D/Q** §4.4 — unguarded `invoke` at `:780`; dead `'stockmind:'` allowlist entry at `:925`; 141 members with no caller. |
| `cryptoCore.cjs` (270) | Argon2id→AES-256-GCM key derivation, salt, verifier (I3), secure delete | **U** `rewriteVerifier:299`, `encryptString:239`, `decryptString:243`. 18 sync `fs` calls — correct for a key path. |
| `dataStore.cjs` (306) | 10 encrypted domains, 60 s autosave, `markAllDirty` for the I14 re-key | **U** §2.3 — 5 of 10 domains never written; `maxPerUser` unread. **P** §8.3. |
| `sessionManager.cjs` (301) | Gate 1 only: passcode→keys, store open/closed, full re-key | **D** `writeSessionFile:176` has **zero callers**, so the entire encrypted-temp-session-file mechanism its own header documents at `:12-21` never happens. **D** `_isFirstRun` is set once in `init()` (`:48`) and never cleared after a successful first unlock, so `session:is-first-run` and `session:status` keep reporting `firstRun:true` for the rest of the process's life. **Q** §5.2. I1/I3/I14 all **hold** (verified by reading `:72-85`, `:236-290`). |
| `nucleusSealer.cjs` (552) | Sealed identity nucleus, I15/I16 enforcement, `nucleus:*` channels | **U** `rounds:605`, `splitCore:337` (over-export). 3 empty catches (`:265,501,513`) — I15/I16 adjacent, **flagged for owner**, not judged. |
| `ipcEncryption.cjs` (234) | Declared "Pervasive Flow Encryption Layer" | **D/U** §2.1 — `wrapHandle` is never called, so **no channel is wrapped, signed or session-checked**; `SENSITIVE_CHANNELS`/`CRITICAL_CHANNELS` are inert; `ipc-enc:status` reports their sizes, which reads as coverage. `initSession()` *is* called (`sessionManager.cjs:112`) and the key is real; only the enforcement is unwired. |
| `resourceOrchestrator.cjs` (664) | I10 admission authority, task queue, 1 Hz tick, rate limits | **P** `setInterval(_tick, 1000)` runs for the app's life (`:290`); `_tick` short-circuits on an empty queue so cost is small. The prototype-pollution fix at `:321-327` (`limitFor` instead of a bracket read) is sound. 3 empty catches. |
| `genome.cjs` (316) | 30 genes, 6 roles, genome hash | **P** `coreGenes:151` and `:179` call `GENES.filter(...).map(...)` inside loops — `GENES` is 30 entries, so immaterial. |
| `ramaEventBus.cjs` (199) | Event spine | **Q** §5.2 — 7 empty catches. **U** `bus` namespace has no renderer caller. |
| `badgeWindow.cjs` (152) | Always-on-top presence badge | No finding. `contextIsolation:true` with its own minimal preload — good isolation. |
| `badgePreload.cjs` (24) | 2-member bridge for `badge.html` | No finding. Producer of `badge:clicked`. |

### 6.2 `electron/ipc/*.cjs` — 26

| Module | What it does | Findings |
|---|---|---|
| `marketIntel.cjs` (725) | 53 `market:*` channels fronting the Python engine; capability-gated; table-driven registration at `:564-584`; background scheduler | **D** unverified at runtime — the engine cannot start here (§0.1). **U** 34 of 53 preload members have no `src/` caller, incl. `horizons`, `predictMulti`, `trainHorizons`, `backtest`, `backtestPresets`, `strategyScore`, `health`, `schedulerStatus`, all of `costs*`/`macro*` — so the "background iteration to find the right calculation" half of request 1 is implemented and unreachable. **P** unbounded in-memory scheduler state not checked. |
| `modelRouter.cjs` (1068) | Provider routing, fallback chain, custom OpenAI-compatible providers, claim gate at the output boundary, `models:converse` | **D/U** §4.2 — `models:roles` and `models:role-research` unreachable. **D** `sensitive` has no producer (§3.1). 6 empty catches. |
| `credentialVault.cjs` (410) | The real vault: Argon2id→AES-256-GCM, separate salt file, three-state load, all handlers `vault.*`-gated | **Fixed and sound.** I read it in full: the salt-deletion defect is closed (`:46-68`, `:206-247`), `saveVault` refuses to overwrite unreadable ciphertext (`:131-135`), `vault:set`/`delete` roll back in memory on a refused write (`:291-300`). **U** `vault.lock/list/delete/has` have no `src/` caller. Remaining open question is a **design** one, not a defect — see §7.2. |
| `evolutionEngine.cjs` (488) | GitHub/npm/arXiv scouting, proposal building, delegates approve/apply to `proposals.cjs` | **D (security)** `evolution:scout` (`:72`), `read-repo` (`:112`), `analyze-and-propose` (`:123`), `self-assess` (`:147`), `get-log` (`:153`), `get-scout` (`:159`) have **no capability gate at all** — any signed-in tier can drive outbound network calls to GitHub/npm/arXiv on a free-text `query` **using the vault's `GITHUB_TOKEN`** (`:170`). I6 still holds: `apply/approve/reject` go through `proposals.cjs`, which gates on `self-modify.apply` tier 0 (`proposals.cjs:176-179`, `:46-51`). **MEDIUM-HIGH.** **P** `evolutionLog` (`:64`) and `activeScouts` (`:65`) grow without bound; `get-log` slices 100 for display but never prunes the array. |
| `astEngine.cjs` (258) | Regex-based code comprehension, repo walk, impact analysis | **D (security)** `ast:analyze-file` (`:255`) takes a bare `filePath` with **no gate**, reads it and returns its functions, imports and line numbers — a parallel read path around `os.filesystem-read`, which `filesystem.cjs:26` does gate. **MEDIUM-HIGH.** **P** the walk is `fs.promises.readdir` but the file read is **`fs.readFileSync`** (`:238`, `:285` region) — every source file in the repo is read synchronously on the main-process thread. **U** all 4 `ast.*` preload members unused. |
| `sandboxEngine.cjs` (272) | Gated code execution (`sandbox.execute`=1, `sandbox.approve`=0) | Gates present (ledger row 59). **U** `approve/kill/audit/health/onApprovalNeeded` have no `src/` caller, so an approval-needed event has no UI. **MEDIUM** |
| `graphReasoner.cjs` (298) | Plan DAG, ready-set, parallel grouping, critical path | **P** `getParallelGroups:100-124` is O(ready² × edges) and **recomputes `this.edges.filter(...)` for `node` inside the inner `other` loop** (`:115-116`) instead of once outside it. `getReadyNodes:82-96` is O(nodes × edges). Plans are small today (`ramaCore.js:253` is the only producer) so this is latent. **U** 5 of 6 `graph.*` members unused. |
| `intelligenceEngine.cjs` (579) | Web research sessions, source credibility | **D (security)** `intel:analyze` (`:114`) and `intel:list-sessions` (`:186`) are **ungated** and drive outbound requests. **MEDIUM.** |
| `codeRegenEngine.cjs` (274) | AI-generated fixes as `REGEN` proposals | **D (security)** `regen:research` (`:301`) ungated. Apply path gated by the ledger. 4 empty catches. |
| `browserEngine.cjs` (371) | Drives an external browser runtime | **D (security)** no capability gating found. **U** 12 of 15 `browser.*` members unused. 1 log-only catch at `:12`. |
| `vectorMemory.cjs` (217) | Embedding store, dedup, cosine search | **D (security)** no gating. **P** `:107` normalises inside a loop. **U** `vector.health/bulkStore` unused. |
| `timeline.cjs` (233) | Flashbacks, file history, restore proposals; registers the `SELF_MODIFY` applier at `:184-204` | **D (security)** no gating on `timeline:*`. **U** `flashback/fileHistory/proposeRestore` unused. **Q** the applier registration is guarded by an ad-hoc `ledger.hasSelfModifyApplier` boolean stamped onto the ledger object (`:185`, `:202`) — a module-scope side effect at require time inside `try { } catch { }`, so a load-order change silently loses the applier. **MEDIUM** |
| `metaCognition.cjs` (434) | Self-audit, regression detection, experiential dataset | Gated — `readGate` on `mind.view` (`:359-364`), one of only two `ipc/` files that gate (the other is `instanceManager`). **P** `:446-456` filters the same `outcomes` array 3× inside a loop. **U** 11 of 12 `meta.*` members unused. 4 empty catches. |
| `agentOrchestrator.cjs` (657) | 5 agent types, refinement loop, reputation scheduling, governor | Gated (row 59). **U** `spawnChild:342`, `lineageOf:727` unreachable (§2.1). **P** `:538-540` reduces and filters inside a loop; `:647-648` sweeps with a constant `includes`. `govInterval` at `:630`. |
| `system.cjs` (451) | CPU/RAM/disk/process/network + Rāma's own footprint | Gated on the sensitive half; `get-metrics`/`get-disk-usage`/`get-temp-targets`/`get-own-footprint` deliberately open (documented, matches the Home dashboard's tier). **P** `:73` `list.find(p => p.pid === pid)` inside a loop — O(n²) over the process list; builds a `Map` instead. 6 empty catches. **U** `system.streamMetrics` has no `src/` caller — `System.jsx:78-82` self-paces its own poll instead, which is the better design, so the streaming channel is now redundant. |
| `filesystem.cjs` (314) | 14 `fs:*` channels, every one gated | Gates verified by reading all 14 (`:26-271`). **P** `:189-193`, `:242`, `:310` recursive `readdirSync` walks on the main thread for search/disk-sizes/dupes. |
| `git.cjs` (223) | 11 `git:*` channels + watch, all gated | **U** `git.startWatch` has no `src/` caller — `GitSync.jsx` polls instead. |
| `terminal.cjs` (115) | PTY sessions, `terminal.open`-gated | No finding. 2 empty catches at `:106,116`. |
| `appAssimilation.cjs` (284) | Installed-app registry and gated execution | Gated (row 58). **U** the whole `apps` namespace has no renderer caller, and its only client wrapper (`ipcClient.appsClient`) passes no `user` (§2.4). No UI page exists — matches row 58's own open note. 4 empty catches. |
| `aiProcess.cjs` (381) | Spawns the Python engine; 4-rung interpreter ladder | **Sound and honest.** `child.on('error')` (`:148-176`) exists because an absent interpreter would otherwise kill the main process. **D (environment, not code)** no rung resolves here → falls to `python` on PATH = 3.14.4 → numpy ImportError. The `lastStderr` ring (`:18-20`) will hold the real reason. 3 empty catches. **U** `ai` namespace unused; `aiProcessClient` dead. |
| `voiceEngine.cjs` (317) | L0-L4 capability ladder, Whisper detection by execution | **U** `voice.capabilities/rescan/transcribe` reached only via the `ipc()` alias in `src/services/voiceEngine.js:112` — of those three only `capabilities` is actually called, so `rescan` and `transcribe` are unconsumed on the main side while the renderer does its own MediaRecorder capture. **Relevant to master's "transcribing… but where?" question** — see §7.3. 9 sync `fs` calls, 4 empty catches. |
| `authEngine.cjs` (207) | IPC surface over `authCore`; 20-member `auth` namespace | Reached via the `ipc()` alias in `authClient.js:16` — **not** a dead namespace (my first sweep's "20/20 unused" was a false positive from that indirection; corrected). **U** `attachStorage:75` over-exported. |
| `instanceManager.cjs` (327) | Instance registry, gene expression, failover candidates | Gated per-gene at `:160-166`. **U** `recordWork:233`, `failoverCandidates:291` over-exported; 12 of 14 `instance.*` members unused (`App.jsx:169-170` calls only `restore`/`ensurePrime`). Matches ledger row 32 (ownership not wired). **Q** `emit:330` is byte-identical to `metaCognition.cjs:470`. 4 empty catches. |
| `selfCare.cjs` (347) | 2-minute health sweep, failover check, alerts | **U** 9 of 12 `selfCare.*` members unused; `consciousness.js:108-117` subscribes only to `start/onHealthUpdate/onAlert`, so `getLog`, `getAlerts`, `getComponents`, `getBaselines`, `heal`, `trackScore` have no reader. **P** `:137-146` nested instance×gene filters. Two `setInterval(runHealthSweep, 120000)` registrations (`:345`, `:396`) — **check for a double-start**; I did not trace which path runs. **Unsure.** |
| `resourceResearchEngine.cjs` (274) | Catalog + live doc fetch + enable proposals | **U** `proposeEnable` has no caller (consistent with row 52's open note). **P** `:103-104` `find` inside a loop; `:136-140` `indexOf` scan. |
| `tracking.cjs` (85) | The read side of function tracking, `audit.all`-gated | **Correct and honest** (`:70` says `instrumented:false`). **U** no renderer caller, and nothing produces records (§0.2.2). |

---
### 6.3 `electron/lib/*.cjs` — 45

| Module | What it does | Findings |
|---|---|---|
| `repairContract.cjs` (1030) | Declared repair contract: what may be repaired, how, and the bounds | No sweep finding. 2 empty catches. Largest lib file; not read in depth. |
| `ollamaCloud.cjs` (836) | Keyed Ollama Cloud chat/stream/search, every call behind capability → egress boundary → credential → base URL → admission | Reads as the most rigorous module in the tree. **U** `SEARCH_PROVIDER:57`, `CHAT_PATH:60`, `TAGS_PATH:61`, `SEARCH_PATH:68` over-exported. **Q** `storeOf:168` is byte-identical to `egressBoundary.cjs:81`. 3 empty catches. |
| `authCore.cjs` (658) | I4/I5: provisioning, Argon2id passwords, HMAC-only access keys, lockout, sessions | **U** `validateStepToken:517`, `findByUsername:173`, `revokeUserSessions:529`, `hashPassword:75`, `verifyPassword:89` over-exported. `mustChangePassword` is set and returned but no UI forces the change — **matches ledger row 30, still open.** |
| `upgradeApplier.cjs` (555) | Validates and applies the one proposal kind that writes Rāma's own source | 17 sync `fs` calls (correct — it is an applier). 5 empty catches. **U** `SNAPSHOT_MAX_ENTRIES:78`, `SNAPSHOT_MAX_AGE_MS:79` over-exported. |
| `ollamaCatalog.cjs` (475) | Fetched model library + retirement schedule, cached | **U** `CLOUD_MAX_LOCAL_BYTES:101`, `CLOUD_MIN_PARAMS_B:104`, `STALE_AFTER_MS:37` over-exported. |
| `updateChannel.cjs` (456) | Update classification and staging | **19 sync `fs` calls — the highest in the tree.** Not on the boot path. 5 empty catches. |
| `autonomyStop.cjs` (447) | The stop: halts Rāma starting work, never refuses master | **U** `stateDir:112`, `snapshotRoot:115` (the latter truly unreferenced). 10 sync `fs` calls. |
| `autonomyGate.cjs` (446) | Kind fence + path fence on the ledger's IPC create path | **U** `OWNED_KINDS:79`, `DIFF_CLASSES:85`, `ORIGINS:87`, `STOP_STATE_NAMES:297` over-exported. **P** `:331-332`, `:352-353` substring scans inside loops over the protected-path list. |
| `autonomyPolicy.cjs` (416) | Declared floors/ceilings per diff class | **U** `ORDER:74`. **P** `:440-441` filters `CLASSES` twice inside a summary loop (constant-size). |
| `selfBuildPipeline.cjs` (409) | Self-build stages | 6 sync `fs`. 1 empty catch. |
| `proposals.cjs` (408) | **The** approval ledger (I6); 5 kinds; appliers; persisted to the `proposals` domain; audit capped at 1000 | Gating verified: `approve/reject/apply` all require `self-modify.apply` tier 0 (`:176-179`, `:46-51`); `proposals:list/get` require `self-modify.view` (`:256`). **U** `isDurable:348`. **Q** `broadcast:439` byte-identical to `resourceOrchestrator.cjs:733`. **U** `proposals.reject/flush/list/get/stats/audit/on` — 7 of 10 members have no `src/` caller (`Evolution.jsx` uses the `evolution:*` channels instead). |
| `selfRepair.cjs` (385) | Obtains missing packages | **U** `repairDir:64`, `extractTar:285`, `alreadyResolvable:343` over-exported. 6 sync `fs`, 5 empty catches. |
| `claimGate.cjs` (372) | Classifies model prose into attributed/unattributed; withholds unattributed claims | **P** `:246`, `:349-351` filter the same `classified` array 3× inside/after a loop — cheap, cosmetic. |
| `modelRoles.cjs` (350) | What Rāma needs a model **for**; `plan`, `researchPlan`, `selectForRole`, `describeRequirement` | **Half-stranded.** `selectForRole` is live via `conversationRole.selectModel`. `plan()`, `researchPlan()`, `describeRequirement()`, `ROLE_IDS` exist **only** for `models:roles`/`models:role-research`, which are unreachable (§4.2). **HIGH value stranded.** **P** `:303-308` filters `rows` 3× in one summary. |
| `crashGuard.cjs` (348) | Installed first, before any other require; records fatals; guidance | **U** `missingModuleFrom:64`, `buildReport:81`, `guidanceFor:132` truly unreferenced externally. **Q** `missingModuleFrom` exists **twice with different semantics** — `crashGuard.cjs:64` returns the full specifier, `startupDoctor.cjs:226` returns the package root and rejects relative paths. Two parsers of the same error string that can disagree. **LOW-MEDIUM** |
| `conversationRole.cjs` (331, changed in `9054252`) | The conversation role: cloud-safe vs revealed prompt, destination refusal, sensitivity | **U** `CLOUD_SAFE_IDENTITY_LINES:103`, `REPLY_PROTOCOL_LINES:133`, `withReplyProtocol:167`, `ROLE:85`, `DESTINATIONS:89`, `FORM_OF_ADDRESS:92` have no external importer — `withReplyProtocol` **is** used internally at `:333`, so the fix is live; the exports are for the suite. The module's own new comment records that the nucleus `behavioral` block is read by nothing; **do not change sealed state to fix that — it is master's call** (already flagged there). |
| `loyaltyCore.cjs` (337) | I16: the sealed loyalty matrix, own salt and key, escalating cost on failed opens | 4 empty catches, 10 sync `fs`. **Flagged for owner, not judged** (I16). |
| `localUpdateEngine.cjs` (301) | Master's own local pull→install→build→apply | No sweep finding. Row 54 notes it was never exercised end to end. |
| `selfModel.cjs` (289) | What Rāma is, measured rather than asserted | No finding. |
| `egressBoundary.cjs` (283) | The one cloud request-body constructor and the classification gate | **U** `MAX_PARTS:47`, `MAX_BODY_BYTES:48`, `MAX_QUERY_CHARS:49` over-exported (`conversationRole.cjs` reads `MAX_MESSAGES`). **Q** `storeOf:81` duplicated. |
| `dependencyAdvisor.cjs` (284) | Daily dependency review | **P** `:241-256` filters the same `rows` array **six times** in one summary object. Row count is small. **LOW** |
| `ollamaLibrary.cjs` (284) | Parses the Ollama library page | **U** `COLLAPSE_FLOOR:27`. |
| `workspaceRegistry.cjs` (280) | Shared workspace context | **U** `sortRows:160`. 4 sync `fs`, 1 empty catch. |
| `startupDoctor.cjs` (269) | In-app diagnose + repair | **U** `missingModuleFrom:226` (see `crashGuard`), `RUNTIME_CRITICAL:52`. **P** §8. |
| `loyaltyGuard.cjs` (261) | I15: protected-file list, forbidden keys, revert on unseal | **P** `:225-229` `protectedSet.some(...)` inside a loop over changed paths — O(paths × protected). Small sets. **Flagged, not judged** (I15). |
| `projectScaffold.cjs` (261) | New-project scaffolding | **Q** `slugify` duplicated here, in `customProviders.cjs` and in `publishProposal.cjs`. 7 sync `fs`. |
| `publishProposal.cjs` (245) | Applied proposal → its own branch + release notes | **U** `generateReleaseNotes:140`, `branchNameFor:69` over-exported; `publish.previewNotes` unused. |
| `refreshScheduler.cjs` (242) | One background schedule for every module | **U** `dueAt:107`, `isDue:115`, `JITTER_FRAC:24` over-exported; the whole `refresh` namespace has no `src/` caller, so master cannot see or trigger the schedule. **MEDIUM** |
| `customProviders.cjs` (212) | Any OpenAI-compatible host without a code change; SSRF-guarded | Sound by review. **Q** `slugify` duplicated. |
| `sysinfo.cjs` (209) | Guarded `systeminformation` + Node-only fallback; persistent PowerShell session | **P** §8.2 — spawns `powershell.exe` at module load (`:42`). Documented and measured by the project (2-13 s cold vs 100-800 ms warm). **U** `networkInterfaces:209`, `cpuInfo:221`. 1 log-only + 2 empty catches. |
| `releaseChannel.cjs` (183) | I17: dormant version-bump/tag/CI path, `release.cut` tier 0 | **U** `getState:89` truly unreferenced externally. Dormancy is **correct per I17**, not a defect. 7 sync `fs`. |
| `registrySources.cjs` (173) | npm + OSV endpoints | **U** `NPM_BASE:20`, `OSV_URL:21`. |
| `bootReport.cjs` (169) | Writes the untruncated boot failure report | 3 empty catches — correct (it runs after failure). **P** `:134` filters `chans` inside the report builder. |
| `safeRequire.cjs` (167) | Guarded require → inert reporting stub (I11 at the load boundary) | No finding. Load-bearing; `useRequire(require)` at `main.cjs:19` exists because omitting it stubbed every engine (Section 63). |
| `appearanceState.cjs` (140) | Persisted zoom, first-run fit | **U** `appearance.nudgeZoom` has no `src/` caller. |
| `browserRuntime.cjs` (145) | Finds an installed browser | **U** `CANDIDATES:30`. 1 empty catch. |
| `verifyProposal.cjs` (108) | AST quality/issue report attached to proposals | **U** `createVerified:114` truly unreferenced. 3 sync `fs`, 1 empty catch. |
| `genomeApplier.cjs` (96) | Registers the `GENOME` applier (closed row 33/49) | No finding. |
| `badgeLabel.cjs` (81) | Names the timers still running, so the badge cannot lie | **U** `WINDOW_STATE:57`. |
| `popoutGrant.cjs` (81) | Pop-out window grants | No finding. Required at `main.cjs:1545` (a non-top-level require, deliberately). |
| `capability.cjs` (68) | Main-process read of `shared/capabilities.json` (I8) | **U** `requireCap:75`, `getCaps:35`, `TIER_COLORS:19` truly unreferenced (§2.1). `can()`/`deny()` are the live pair. **Important:** `can()` returns false unless `typeof user.tier === 'number'` (`:28`) — this is what turns the §7.1 signature bug into a silent denial. |
| `badgeState.cjs` (39) | Badge enabled + position, plain JSON by design | 1 empty catch, 3 sync `fs`. No finding. |
| `http.cjs` (249) | I9: the one main-process HTTP client, circuit breaker, streaming JSON lines | **U** `getCircuitStatus:214` truly unreferenced — breaker state is unobservable. `humanHeaders:63`, `ramaHeaders:78` over-exported. 1 empty catch. |

### 6.4 `src/pages/**` — 51

| Module | What it does | Findings |
|---|---|---|
| `StockMind/PriceChart.jsx` (2593) | The chart: candles, 4 price-indexed types, overlays, drawings, sessions, projection cone, horizon control | **Q/P** 16 empty/log-only catches (§5.2); largest file in the tree. The horizon control (`:1367-1374`, `:2335-2381`) satisfies request 1. Caps and refusals are rendered, not inferred (`:2719-2724`). |
| `StockMind/indicators.js` (1470) | Pure indicator math incl. Renko/Kagi/P&F/Line Break | No sweep finding; all pure functions of stored bars. |
| `StockMind/StockMind.jsx` (1370) | The page: symbol, interval, panels, forecast, book | **U** it calls 21 of 53 `marketIntel.*` members. |
| `StockMind/glossary.js` (1169) | 1169-line term glossary, suite-asserted | No finding. |
| `GitSync/GitSync.jsx` (794) | Git + Release + Update tabs | Uses `gitClient`/`fsClient` **with `user`** correctly (`:585-587`, `:658`, `:666`, `:673`, `:680`). |
| `StockMind/BookPanel.jsx` (655) | Recorded positions, fills, thesis | **U** `ledgerRemoveFill`, `ledgerThesis`, `ledgerNote` exposed, no caller. |
| `IDE/IDE.jsx` (656) | Editor, AST panel, sandbox run, regen research | **Q** bypasses its typed namespaces for `regen:research`, `sandbox:execute`, `ast:analyze-file` (§4.4). The comment at `:277-278` records a prior silent-failure bug of exactly this class. |
| `StockMind/StrategyBuilder.jsx` (599) | Rule blocks → strategy spec | **U** `strategyInstruments`, `strategyLibrary`, `strategyTemplate` exposed, no caller. 1 empty catch. |
| `Models/Models.jsx` (580) | Providers, Ollama, Cloud, Custom tabs, vault unlock banner | **Fixed.** `Promise.allSettled` (`:277-304`), the failed-unlock path (`:315-339`), the three-state banner (`:421-443`) and the "vault locked ≠ key absent" distinction (`:39-41`, `:85-89`) all address master's item 11. Remaining is the design question in §7.2. |
| `Resources/Resources.jsx` (565) | Orchestrator status + resource research tab | **Q** bypasses the `orchestrator` namespace (§4.4). **P** `setInterval(load, 2000)` (`:354`) polls on a fixed timer regardless of latency — the pattern row 57 fixed elsewhere. **MEDIUM** |
| `System/System.jsx` (532) | Metrics, processes, disk, Rāma's own footprint | **Good pattern** — `:78-82` self-paces its loop; `:271-273` uses `Promise.all` with per-call `.catch` so one failure cannot strand the page. |
| `Evolution/Evolution.jsx` (527) | Scout findings, proposals, publish | **Q** bypasses the `evolution` namespace entirely (9 raw channels, §4.4). |
| `Chat/Chat.jsx` (519) | Reflex → converse → chat ladder | **D** never sends `sensitive` (§3.1). Otherwise the refusal/remedy/`voiceSilent` handling at `:285-312` is exemplary. |
| `Settings/Settings.jsx` (508) | Appearance, voice, self, passcode change, updates | The only `session.changePasscode` caller (`:307`). `checkForUpdates` is correct (`:259-266`). |
| `StockMind/chartProjection.js` (520) | Cone math, `horizonChoices`, `horizonFor` | No finding; suite-covered. |
| `ScreenMap.jsx` (444) / `screenMapData.js` (157) | Guided map of the StockMind screen | No finding. |
| `Intelligence/Intelligence.jsx` (438) | Research sessions | **Q** bypasses the `intel` namespace; **D** the handlers it calls are ungated (§6.2). |
| `Users/Users.jsx` (420) | Accounts, tiers, key handover | No finding. **U** `auth.sessions` exposed, no panel — matches ledger row 31, still open. |
| `HelpPanel.jsx` (400) / `WhyPanel.jsx` (219) / `InfoTip.jsx` (80) | In-app explanation surfaces | **P** the `WhyPanel` chunk is **208.41 kB** (measured) — it is lazily loaded, so off the startup path, but it is the third-largest chunk after Monaco and the vendor bundles. Worth checking what it drags in. |
| `Login/Login.jsx` (384) | Gates 2 + 3, key recovery | No finding. |
| `Genome/Genome.jsx` (343) | Genes, roles, expression | **U** `genome.*` has no `window.rama.genome` reference in `src/` — needs a trace of how this page loads; **unsure**. |
| `RamaMind/RamaMind.jsx` (347) | Meta-cognition view | **P** `setInterval(refresh, 5000)` (`:297`), fixed timer. |
| `Setup/Setup.jsx` (351) | First-run provisioning | No finding. |
| `Unlock/Unlock.jsx` (207) | Gate 1 | **Q/D** §4.4.3 — reaches `session:unlock` through the shim; `_isFirstRun` staleness (§6.1) means a long-running process keeps reporting first run. |
| `Introspect/Introspect.jsx` (328) | Self-inspection | No finding. |
| `SymbolSearch.jsx` (364) / `symbols.js` (205) / `timeframes.js` (275) / `marketClock.js` (387) / `positionMath.js` (168) / `chartTime.js` (187) / `chartDrawings.js` (476) / `chartZoom.js` (181) / `chartSessions.js` (145) / `chartEmptyState.js` (147) / `ChartDrawingLayer.js` (208) / `ChartSessionLayer.js` (99) / `PopoutPanel.jsx` (202) / `popoutParams.js` (33) | StockMind support modules, all suite-covered | `chartDrawings.js:84` is one of the `rama.`-prefixed keys Ghost Mode misses (§0.2.1). 2 empty catches in the layer files. |
| `Settings/SelfPanel.jsx` (217) | Self-model panel | 1 empty catch at `:82`. |
| `IDE/CodeEditor.jsx` (153) / `DiffReview.jsx` (186) / `NewProject.jsx` (156) / `monacoSetup.js` (144) | Editor pieces | **Q** 10 empty catches between `CodeEditor` (4) and `DiffReview` (6) — see §5.2. |
| `Home/Home.jsx` (126) | Dashboard | No finding. |
| `Terminal/Terminal.jsx` (187) | PTY UI | No finding; correctly passes `user` (`:32`). |
| `Knowledge/Knowledge.jsx` (60) | **Mock page** | **D HIGH** §0.2(5). |

### 6.5 `src/services/*` — 11

| Module | What it does | Findings |
|---|---|---|
| `voiceEngine.js` (702) | Capability ladder, mic modes, VAD segmentation, MediaRecorder capture | **P** `_vadTimer` at `:380`. 7 empty catches. Relevant to §7.3. |
| `ramaCore.js` (603) | Memory/planner/world model/tool router | **Q** `this._episodic` (`:109`) capped at 500 (`:127`) is a renderer-only array that shadows the unused `memory.episodic` store key. 2 empty catches. **P** `setInterval(this._check, 30000)` (`:593`). |
| `cognition.js` (367) | Tier 0 reflex (9 skills) → local → cloud → candidate finding | `findReflexCandidates()` reports counts but synthesises no skill — **matches ledger row 47, still open.** 2 empty catches. |
| `selfModify.js` (232) | Page creation, proposals, apply, commit | **D HIGH** §7.1 — five `window.rama.*` calls with a missing `user` argument. **U** `createPage`, `proposeModification`, `commitModification`, `generateRegistryUpdate`, `listSourceFiles`, `customPageRegistry` have no callers; `applyModification` has one that can never fire (§3.1). |
| `consciousness.js` (193) | The loop, health aggregation, system prompt fetch | 4 empty catches; `:89` swallows the nucleus prompt fetch and falls back to a source template — **documented and correct (I11)**, but it means a locked nucleus silently yields the bootstrap identity. `:202-203` caps `rama_interactions` at 100 in `sessionStorage`. |
| `authClient.js` (190) | Gate 2/3 client; session in `sessionStorage` | `SESSION_KEY = 'rama_session'` (`:46`) — underscore, so this one key *would* be cleared by Ghost Mode, but it lives in `sessionStorage` which is cleared wholesale anyway. 2 empty catches. |
| `apiClient.js` (168) | I9 renderer→server transport: circuit breaker, retry, token | 2 empty catches at `:112,116`. **Q** `recordFailure` exists here and in `authCore.cjs` and `loyaltyCore.cjs` — three same-named, different-purpose functions. |
| `accessControl.js` (92) | Tier ladder for the renderer, reads `shared/capabilities.json` | Live (imported by 7 files). `getVisibleRoutes` is superseded by `registry.visibleRoutes` per `registry.js:207` — check for a leftover. |
| `ipcClient.js` (107) | Typed wrappers over `window.rama` | **U** `appsClient`, `aiProcessClient` dead and would be denied if used (§2.4). |
| `ramaClient.js` (89) | HTTP fallback + formatters | **U** `systemHttp`, `getHistory`, `deleteHistory` dead. |
| `ghostMode.js` (130) | **Entirely dead and broken** | **D HIGH** §0.2(1). |

### 6.6 `src/store/*` — 5

`uiStore.js` (34 keys), `ramaStore.js` (19), `userStore.js` (19), `appStore.js` (15),
`agentStore.js` (9). 13 keys with no external consumer — full list at §2.3. `uiStore.setPendingMod`
and `ramaStore.setBackendRunning` are the two that matter. `ramaStore.sessions` is the chat history
that never reaches `conversations.enc`.

### 6.7 `src/components/*` — 7

| Module | Findings |
|---|---|
| `CommandPalette.jsx` (734, changed in `9054252`) | Hosts the dead `SelfModifyModal` (§3.1). `9054252` adds the `endTalk` failure path — the fix for master's item 2. |
| `PanelBoard.jsx` (419) | 3 empty catches, all `localStorage` quota — correct. |
| `Titlebar.jsx` (278) | **P** `setInterval(poll, 5000)` (`:51`) plus a 1 Hz clock (`:61`) — fixed timers. |
| `ActivityStream.jsx` (147) | No finding. |
| `ErrorBoundary.jsx` (127) | 1 empty catch at `:48`; keyed on route so it clears on navigation (Section 33). |
| `AppShell.jsx` (40), `RamaOrb.jsx` (77) | No finding. |

### 6.8 `src/config`, `src/hooks`, `src/utils`, `src/` root — 11

`registry.js` (293) is I7's single source and is live. `type.js` (91) and `layoutBands.js` (56)
live. `useLayoutBand.js` (94) live. **`usePageVisibility.js` (39) and `useSessionTimeout.js` (44)
have no consumer** (§2.4). **`sanitize.js` (67) and `hmac.js` (74) have no consumer** (§2.4).
`App.jsx` (296) — 1 log-only catch at `:177`; gate chain Unlock→Setup→Login→app. `main.jsx` (11),
`index.css` (631) — no finding.

### 6.9 `server/**` — 7

| Module | What it does | Findings |
|---|---|---|
| `index.cjs` (89) | Express on 127.0.0.1:4097, helmet, cors, threatShield, rate limit | **D HIGH** `/api/ghost/wipe` (`:72-80`) returns success for work not done. **D MEDIUM** `/api/security/threats` (`:83-90`) has **no token guard** — only `req.ip.includes('127.0.0.1')`, so any local process can read the threat log. Compare the ghost route, which correctly uses `requireLocalToken`. Also both IP checks use `String.includes` rather than an equality test. |
| `routes/auth.cjs` (100) | **I2 upheld**: every auth route answers 501 with an explanation; `requireLocalToken` is a real `timingSafeEqual` guard that fails closed when `RAMA_SERVER_TOKEN` is unset (`:50-69`) | No defect. Exemplary. |
| `routes/ai.cjs` (54) | HTTP chat fallback for browser dev mode | **P/D MEDIUM** `const conversations = {}` (`:17`) is **unbounded** — every POST stores the full `messages` array under a fresh 32-hex key and nothing ever evicts. `GET /api/ai/history/:sessionId` (`:55`) is **unauthenticated**. In Electron this path never runs (`ramaClient.js:24` prefers IPC), so the exposure is browser-dev-mode only — but in that mode `Chat.jsx:315-319` sends `allMessages` including the **revealed nucleus system prompt**, which then sits in a plain object on an unauthenticated server. |
| `middleware/threatShield.cjs` (221) | AI-bot detection, eternal loop, mirror trap, rate tracking | **U** `HONEYPOT_PATHS:55` truly unreferenced — the honeypot path list is declared and no route serves it. **P** two `setInterval`s (`:158`, `:245`); `aiAgentBlacklist`/`eternalLoopSet` growth not traced. **Unsure** whether the sweeps bound them. |
| `routes/system.cjs` (23), `routes/health.cjs` (16) | Metrics and ping | No finding. |
| `brain/credentialVault.cjs` (183) | **Second, unreachable credential vault** | **D/Q MEDIUM** §4.1 below. |

#### 4.1 (ref) The two credential vaults

| | `electron/ipc/credentialVault.cjs` (410) | `server/brain/credentialVault.cjs` (183) |
|---|---|---|
| Reachable | yes, 8 gated channels | **no — `require`d by nothing** |
| KDF | Argon2id 64 MiB/3/2, scrypt fallback (`:92-113`) | PBKDF2-SHA512 310 000 (`:28`) |
| Salt | own file `rama_vault.salt` (`:66`), explicitly because keeping it in the blob deleted it | **inside the blob** (`:92`, `:186`) — the exact defect the other file's header documents at `:46-62` |
| Wrong password | rejected by verifier before decrypt (`:117`, `:254-262`) | `catch { return 'Invalid master password' }` (`:103`) — adequate |
| Overwrite protection | refuses to write over unreadable ciphertext (`:131-135`) | **none** — `_persist()` (`:184-188`) re-reads the file only for the salt |
| I14 re-key | outside `dataStore`, so **not** re-keyed by `markAllDirty` — by design, it has its own password | writes to `~/.rama-agi/credentials.vault.json`, outside both |

**Recommendation:** do not quietly delete it (standing rule: additive, always a fallback). Record it
in the spec as unreachable and let master decide; keeping a second, weaker vault implementation in
the tree is a security-review liability, and someone will eventually wire it.

### 6.10 `ai_backend/**` — 52 `.py`

**All 52 compile; none has ever run here.** `python -m py_compile` exit 0 on `main.py`,
`train.py`, all 30 `engine/*.py` and all 20 `tests/test_*.py`. `import numpy` fails on Python
3.14.4 against the pinned `numpy==1.26.4`.

`main.py` (1391) is the FastAPI surface. `engine/`: `strategy_spec.py` (1395), `derivatives.py`
(917), `training.py` (871), `news.py` (864), `ledger.py` (761), `dispatcher.py` (741), `explain.py`
(676), `strategy_scorer.py` (639), `backtest.py` (611), `strategy_eval.py` (608), `models.py` (582),
`providers.py` (583), `macro.py` (556), `registry.py` (549), `outcomes.py` (532),
`strategy_library.py` (530), `costs.py` (483), `advanced_features.py` (467), `features.py` (446),
`featureset.py` (421), `projection.py` (398), `strategy_codegen.py` (374), `store.py` (362),
`charge_watch.py` (316), `horizons.py` (256), `data_fetcher.py` (198), `calibration.py` (158),
`health.py` (99), `alerts.py` (596), `__init__.py` (5). `tests/` holds 20 suites (8 585 lines).

**Findings, all of which are about reachability rather than the Python:**

- **D HIGH (environment).** No interpreter on this machine can run it. The 4-rung ladder in
  `aiProcess.cjs:87-131` is correct and the remedy it prints is correct ("install Python 3.10 to
  3.12, then pip install -r ai_backend/requirements.txt"); nothing has created the venv.
- **U.** `requirements.txt` pins 15 packages and `ai_backend/tests/` holds 20 suites, and
  **`npm run verify` does not run them** — the 39-suite chain is all `.cjs`/`.mjs`. There is no
  `pytest` invocation anywhere in `package.json`. So the engine's own 8 585 lines of tests are never
  executed by the project's verification bar. **MEDIUM.**
- `ai_backend/data/history/NSE/NIFTY50__1D.csv` (4 650 rows) and `__15M.csv` (577 rows) are
  committed sample data with `.meta.json` siblings. `data/models/` and `data/history/_outcomes/`
  are empty — consistent with "never run".
- **Not assessed:** any claim about prediction quality, calibration, in-sample leakage, or whether
  `horizons.py`/`training.py` actually implement the iterative horizon search request 1 asks for.
  I read none of the Python bodies. Saying otherwise would be a confident guess.

### 6.11 `shared/*.json` — 4

| File | Findings |
|---|---|
| `capabilities.json` (107) | I8's single definition, read by all three runtimes. Protected. No finding. |
| `resourceCatalog.json` (238) | Seed catalog for `resourceResearchEngine`. Reachable via the Research tab. |
| `buildManifest.json` (35) | Read by the bundle-graph verifier. |
| `loyalty-tripwire.json` (17) | The approved manifest; `verifyLoyaltyTripwire.cjs` passes 12/12 (measured). **I did not run `--approve`.** |

### 6.12 `scripts/*` — 51 (39 `verify*`)

All 39 run green (measured). `auditRenderer.cjs` is wired into boot (`start.cjs` stage 1) and
resolves 372 channels. Two structural gaps in the verification bar, both already named above:

- `auditRenderer.cjs` checks `window.rama.<ns>.<fn>` and zustand destructures. It **cannot see** the
  25 raw-channel calls through `window.ipcRenderer` (§4.4) nor the 2 dynamic subscriptions.
- No suite asserts that an exposed preload member, or a registered channel, has a caller. That is
  the single check that would have caught `models:roles`, `functionTracking.record`,
  `brokerConnectors.driftReport`, `setPendingMod`, `ipcEncryption.wrapHandle` and the `sensitive`
  gate — six of this report's findings, in one rule. **This is the highest-leverage fix in the
  list.**
- No suite asserts the Ghost Mode key prefix against the keys `uiStore`/`PriceChart`/`chartDrawings`
  actually write.

### 6.13 Repo root — 3

`start.cjs` (1678) — the staged self-healing launcher; `--diagnose`, build-staleness, live reload by
domain, 4-rung install ladder. Live (`package.json:12`). `start.js` (276) — **stale ESM duplicate,
no referrer** (§2.4). `vite.config.js` — build config; the chunk rules it carries are asserted by
`verifyBundleGraph.cjs`, which passes 21/21.

---
## 7. THREE ITEMS THAT DESERVE THEIR OWN SECTION

### 7.1 `selfModify.js` passes a file path where a user is expected — seven times

Ledger row 59 added `capability.deny(user, …)` to every `fs:*` and `git:*` handler and updated
`preload.cjs` to take `user` first. `selfModify.js` was not updated with them.

| Call site | Code | Receives |
|---|---|---|
| `selfModify.js:165` | `window.rama.fs.writeFile(file.path, file.content)` | `preload.cjs:81` is `(user, filePath, content)` → `user = "src/pages/X/X.jsx"`, `filePath = <the code>`, `content = undefined` |
| `selfModify.js:167` | `window.rama.fs.deleteFile(file.path)` | `user = path`, `filePath = undefined` |
| `selfModify.js:180` | `window.rama.git.stage(repoPath, files)` | `preload.cjs:105` is `(user, repoPath, files)` |
| `selfModify.js:182` | `window.rama.git.commit(repoPath, commitMsg)` | ditto |
| `selfModify.js:183` | `window.rama.git.push(repoPath, 'dev')` | ditto |
| `selfModify.js:190` | `window.rama.fs.readFile(filePath)` | `user = filePath` |
| `selfModify.js:197` | `window.rama.fs.searchFiles(basePath, '')` | `user = basePath` |

`capability.can` requires `typeof user.tier === 'number'` (`capability.cjs:28`), a string has no
`.tier`, so every one of these returns `{ok:false, error:'This account may not do this …'}`.
`applyModification` then **discards the per-file result and returns `{ok:true}`** (`:174`), so the
UI would report a successful self-modification that wrote nothing.

Mitigating: the only caller (`CommandPalette.jsx:627`) can never fire because `setPendingMod` has no
producer (§3.1), and `readSourceFile`/`listSourceFiles` are only called by `createPage`, which also
has no caller. So this is **latent, not currently firing** — which is exactly why it has survived.
Severity **HIGH** on the grounds that wiring the modal up (an obvious next step) turns it live, and
the failure mode is a false success on a self-modification.

### 7.2 The vault asks for a third secret — master's item 11, half-closed

Master reported: *"why the master password to be entered again? vault not unlocked after entering
master password and enter/click on unlock."*

**The "not unlocked" half is fixed.** `Models.jsx:315-339` now has the `else` branch it never had,
`:421-443` distinguishes *no vault yet* / *locked* / *present but undecryptable*, and
`credentialVault.cjs:206-247` refuses to mint a new salt over existing ciphertext instead of
silently making it unrecoverable. If master's existing vault predates commit `7b3c9fd`, the honest
answer he will now see is that **those stored keys are gone** (`credentialVault.cjs:243-247`) and he
must re-enter them — recoverable only if the old blob still carries its inline salt, which the
migration at `:217-227` will adopt.

**The "again" half is a design decision that is still open.** There are genuinely three independent
secrets: the store passcode (`cryptoCore`, `rama.salt`, opens `data/*.enc`), the account password
(gate 2, `authCore`, Argon2id) plus the 12-digit access key (gate 3), and the **vault** password
(`rama_vault.salt`, its own Argon2id). `Models.jsx:413-421` now explains why it is asking, which is
better than silence. Whether it should be one secret is master's call, and it interacts with I1
(passcode ≠ identity) and I14 (the vault sits outside `dataStore` and is therefore **not** re-keyed
by a passcode change — correct today because its key comes from a different password, but it would
stop being correct if the two were merged). **I am flagging this rather than proposing a change.**

### 7.3 "Transcribing…" — where it is transcribed, and why it never finished

Master asked where transcription happens. Answer, from source:

1. `src/components/CommandPalette.jsx` captures audio in the renderer via `MediaRecorder`
   (`src/services/voiceEngine.js`), then calls `engine.stopRecordingAndTranscribe()`.
2. That calls `window.rama.voice.transcribe` (`preload.cjs:596`) → `voice:transcribe` in
   `electron/ipc/voiceEngine.cjs`, which resolves the ladder **local before cloud**: a local Whisper
   binary (detected by *executing* the candidate and requiring it to identify itself,
   `voiceEngine.cjs:85-136`), else cloud Whisper, which needs an OpenAI key in the vault.
3. **On this machine neither rung exists**, so the engine returns null.

Up to `7b3c9fd` the code set the label and `await`ed the engine **without using the result**; only
`onTranscript` cleared it, and `onTranscript` fires only on success. So the label stayed on screen
forever while `onError` showed the real reason for six seconds and then removed it. **`9054252`
fixes exactly this** — `endTalk` now branches on the returned value, names the missing transcriber,
and surfaces `voiceCap.nextStep` where the action is instead of only as a tooltip.

The reply-conciseness half (item 1) is addressed in the same commit: `REPLY_PROTOCOL_LINES` now
reaches the **local** destination too (`conversationRole.cjs:333`), which it previously did not —
the protocol lived only in `CLOUD_SAFE_LINES` while master's conversations route locally.

**Still open after `9054252`:** the ladder has no rung on this machine, so transcription cannot
succeed here at all — no Whisper binary on PATH and no OpenAI key path exercised. The fix makes the
failure legible; it does not give master a transcriber. That is an environment item, not a code one.

---

## 8. STARTUP COST

### 8.1 Measured module-load count

`electron/main.cjs` has **7 literal top-level `require`s**:

```
10  crashGuard          (./lib/crashGuard.cjs)  — deliberately first
13  safeRequire         (./lib/safeRequire.cjs)
20  electron
21  path
22  fs
91  appearanceState     (./lib/appearanceState.cjs)
1545 popoutGrant        (./lib/popoutGrant.cjs)  — NOT top level; inside a function
```

That number is misleading on its own. **42 further modules are loaded at module scope through
`safeRequire(...)`, lines 35-88.** `safeRequire` performs a real synchronous `require` and returns an
inert stub only on failure, so the honest figure is **49 modules required before `app.whenReady()`
even runs**, and transitively far more (`modelRouter.cjs` 1068 lines, `marketIntel.cjs` 725,
`repairContract.cjs` 1030, `ollamaCloud.cjs` 836 all pull their own trees).

`electron-updater` is correctly **not** among them — it is lazily required inside
`setupAutoUpdater()` because its dependency chain once killed the installed app (`main.cjs:22-27`).

### 8.2 Process spawn on the require chain

`electron/lib/sysinfo.cjs:42` calls `_si.powerShellStart()` **at module load**. `sysinfo` is required
by `system.cjs` and `resourceOrchestrator.cjs`, both of which `main.cjs` requires at module scope.
So a `powershell.exe` is started during the require chain, **before `whenReady`, before any window
exists**. This is a deliberate, measured trade (the module's own comment records 2-13 s per call
cold versus 100-800 ms warm, and ledger row 57 is the fix it belongs to). **Reported as a measured
cost, not a defect.** It is released in `before-quit` via `shutdown()` (`:53-58`).

### 8.3 What runs inside `whenReady` before `createMainWindow()`

In order (`main.cjs:1690-1968`):

1. `require('./lib/startupDoctor.cjs')` then `doctor.diagnose({...})` (`:1696-1701`) — **synchronous
   filesystem work**: `RUNTIME_CRITICAL` checks, entry-missing/duplicate checks, build freshness,
   `crashGuard.recentReports(3)` reading crash files. `startupDoctor.cjs` has 1 sync `fs` call of its
   own; `crashGuard.cjs` has 9.
2. `dataStore.getDataDir()` + `await sessionMgr.init(dataDir)` (`:1768-1769`) — `cryptoCore.isFirstRun`
   does an `existsSync` on the salt.
3. The **48-entry** `REGISTRATIONS` loop (`:1797-1879`), every `register()` synchronous. Each one
   creates its channels; several do work at registration time, notably
   `['Market scheduler', () => marketIPC.startScheduler?.()]` (`:1853`) which arms two `setInterval`s
   (`marketIntel.cjs:784-785`) **before the window exists**. It is gated by
   `RAMA_DISABLE_MARKET_SCHEDULER` and documented as declining to start Python itself, so the cost is
   two timers, not a spawn.
4. `BOOT_CRITICAL_CHANNELS` check, and on failure a `crashGuard.record`, a `bootReport.write` and a
   **modal `dialog.showMessageBox`** (`:1903-1956`) — correct: at that point the renderer cannot be
   trusted.
5. `applyCsp()`, `applyPermissions()` (`:1964-1966`).
6. `createMainWindow()` (`:1968`).
7. Tray, badge window, badge IPC (`:1972-1979`).

**Network calls before first paint: none that I can find.** The repair pass is explicitly
`setTimeout(…, 2_000)` after the window (`:1718-1762`) precisely so a network-bound fetch cannot
delay it, and `probeVite()` only runs inside `createMainWindow`'s loader. That is the right shape.

**The cost is therefore: 49 synchronous module loads + one PowerShell spawn + a synchronous
diagnose + 48 synchronous registrations, all before `createMainWindow()`.** I did not instrument it,
so I have **no millisecond figure** — stating one would be invention. If master wants the number, the
cheapest honest measurement is `performance.now()` deltas at `main.cjs:10`, `:1690`, `:1796`, `:1968`
written through `console.warn`.

The one change that would most reduce it without removing anything: move the engines that nothing
touches before the first window — `marketIntel`, `evolutionEngine`, `intelligenceEngine`,
`astEngine`, `codeRegenEngine`, `browserEngine`, `graphReasoner`, `vectorMemory`, `sandboxEngine` —
behind a lazy `safeRequire` resolved on first channel use, keeping `safeRequire`'s stub-on-failure
contract so I11 is untouched. `BOOT_CRITICAL_CHANNELS` already names what genuinely must be eager.

---

## 9. PRIORITISED FIX LIST

Severity: **HIGH** = cannot work, loses data, or is a security hole. **MEDIUM** = works but wrong or
slow. **LOW** = cosmetic or stylistic. "Provable?" = can a suite in `scripts/verify*` prove the fix.

### HIGH

| # | File:line | Evidence | Proposed fix (one sentence) | Provable? |
|---|---|---|---|---|
| H1 | `src/services/ghostMode.js:25` | Clears only `rama_`/`sm_` prefixes; every real key is `rama.`-dotted (`uiStore.js:30,58-60,99`; `PriceChart.jsx:57`; `chartDrawings.js:84`; `StockMind.jsx:882`) | Match on `rama.` and `rama_` and `sm_`, and return a per-step report instead of `undefined`. | **Yes** — a suite can assert the prefix list covers every literal key written in `src/`. |
| H2 | `server/index.cjs:72-80` | `/api/ghost/wipe` returns `ok:true, 'Server wipe acknowledged'` after only a `console.warn`; its own comment claims it signals the main process | Either send the signal, or return `501` with the same honest wording `routes/auth.cjs` uses for work this process cannot do. | **Yes** — route-level assertion. |
| H3 | `src/services/ghostMode.js:102,136` | Neither `activateGhostMode` nor `wipeServerData` has a caller; `wipeServerData` needs the boot token, which the renderer cannot obtain | Add a master-only Ghost Mode action in Settings, and expose the boot token to the renderer over `window.rama` so `wipeServerData` has something to send. | Partly — reachability is provable; the wipe itself is not. |
| H4 | `electron/lib/functionTracking.cjs:109` | `record()` has zero production call sites (only `verifyFunctionTracking.cjs:19`) | Instrument the call sites master named — `marketIntel`'s predict/backtest/forecast handlers with their `window` and `sample`, plus `modelRouter.chat` — and add a Tracking panel that calls `window.rama.tracking.summary`. | **Yes** — assert ≥1 `record(` call site per named module. |
| H5 | `src/pages/Chat/Chat.jsx:277-279` | `models:converse` is called without `sensitive`; `conversationRole.cjs:291-295,389-393` can therefore never refuse a cloud turn | Classify the turn in the renderer (or in `cognition.js`) and pass a real boolean; `conversationRole` already refuses a non-boolean, so a wrong value fails closed. | **Yes** — `verifyConversation.cjs` already covers the gate; add a renderer-side assertion that the flag is supplied. |
| H6 | `electron/ipc/modelRouter.cjs:269,289` | `models:roles` and `models:role-research` are the only 2 of 365 channels named neither in `preload.cjs` nor `src/`; `modelRoles.plan/researchPlan/describeRequirement` exist only for them | Add a `models.roles`/`models.roleResearch` preload pair and a Roles tab on `Models.jsx`. | **Yes** — the §6.12 "every channel has a caller" rule. |
| H7 | `electron/lib/brokerConnectors.cjs:187` | 234 lines, 3 declared connectors, a suite — and no channel, no preload namespace, no page | Add a gated `brokers:list`/`brokers:fields`/`brokers:drift-check` trio and a Brokers section that renders `fieldsFor()` as a credential form writing to `credentialVault`; keep `driftReport` proposing only, never applying (I6). | **Yes** — reachability plus the existing drift assertions. |
| H8 | `src/pages/Knowledge/Knowledge.jsx:10-13,29,44` | Two hardcoded fake entries, a no-op "+ Add Entry", an empty state promising MongoDB | Back it with the `knowledge` store domain and `vectorMemory` search; until then render an honest empty state and remove the invented rows. **Do not remove the page.** | **Yes** — assert the page holds no literal entry array. |
| H9 | `src/services/selfModify.js:165,167,180,182,183,190,197` | Seven calls pass a path where `user` is expected; `capability.cjs:28` denies a string; `:174` returns `ok:true` regardless | Thread `user` through all seven and return `ok:false` when any file write failed. | **Yes** — a static rule that every `window.rama.fs.*`/`git.*` call site passes `user` first (this is `auditRenderer.cjs`'s natural home). |
| H10 | `electron/ipcEncryption.cjs:193` | `wrapHandle` is never called, so none of `SENSITIVE_CHANNELS` is wrapped, signed or session-checked, while `ipc-enc:status` reports the set size | Either apply `wrapHandle` to the listed channels at registration (`main.cjs`'s `ipcRec` is the natural seam), or make `ipc-enc:status` report `wrapped: 0` so the gap is visible. | **Yes** — assert every `SENSITIVE_CHANNELS` member is registered through the wrapper. |

### MEDIUM

| # | File:line | Evidence | Proposed fix | Provable? |
|---|---|---|---|---|
| M1 | `electron/ipc/evolutionEngine.cjs:72,112,123,147,153,159` | Six ungated handlers; `evolution:scout` drives GitHub/npm/arXiv on free text using the vault's `GITHUB_TOKEN` (`:170`) | `capability.deny(user, …)` on all six, plus `user` through `preload.cjs:353-361` and `Evolution.jsx`. | **Yes** — a suite asserting every `ipc/*.cjs` handler that touches network or `getCredential` has a gate. |
| M2 | `electron/ipc/astEngine.cjs:255` | `ast:analyze-file` reads any path with no gate, returning functions, imports and line numbers — a read path around `os.filesystem-read` | Gate on `os.filesystem-read`; same for `ast:analyze-repo` and `ast:impact-analysis`. | **Yes** |
| M3 | `electron/ipc/{intelligenceEngine:114,186, codeRegenEngine:301, browserEngine, vectorMemory, graphReasoner, timeline}.cjs` | No capability gating in six more `ipc/` modules; only `metaCognition` and `instanceManager` gate among the non-row-59 files | Extend row 59's pass to these six. | **Yes** |
| M4 | `electron/preload.cjs:780` | `window.rama.invoke` is an unrestricted `ipcRenderer.invoke` with zero call sites, beside a shim that does allowlist | Route it through `isAllowed()` (keeps the capability, adds the guard — additive). | **Yes** — assert both generic transports share one allowlist. |
| M5 | `src/pages/{Evolution,Resources,Intelligence,IDE}.jsx`, `Unlock.jsx` | 25 raw-channel calls bypass typed namespaces that already exist, so `auditRenderer.cjs` cannot see them | Move each page onto its `window.rama.<ns>` wrapper; keep both bridges exposed. | **Yes** — audit coverage becomes 166 call sites instead of 141. |
| M6 | `electron/sessionManager.cjs:176` | `writeSessionFile()` has zero callers; the encrypted-temp-session mechanism its header documents at `:12-21` never happens | Either call it from `masterUnlock` step 6 or correct the header. | **Yes** |
| M7 | `electron/sessionManager.cjs:48` | `_isFirstRun` set once in `init()` and never cleared; `session:is-first-run` and `session:status` keep saying `firstRun:true` | Set it false after a successful first unlock (`:81`). | **Yes** |
| M8 | `electron/sessionManager.cjs:145-149` | Three teardowns swallowed in `lockSession()`; a failed `nucleusSealer.lock()` leaves the nucleus decrypted in memory after the store locks | Report each failure (`console.error` + a flag on `session:status`). | **Yes** — behavioural test with a throwing stub. |
| M9 | `electron/dataStore.cjs:157,160,170,177` | `conversations`, `knowledge`, `worldmodel`, `agents` are loaded/saved/re-keyed and never written; `maxPerUser:500` is read by nothing; chat history lives only in `ramaStore.js:21` and is lost on restart | Persist chat sessions into `conversations` honouring `maxPerUser`, and cap `agents.auditLog` the way `proposals.audit` is capped at `proposals.cjs:387`. | **Yes** |
| M10 | `server/routes/ai.cjs:17,55` | `conversations` object is unbounded; `GET /api/ai/history/:id` is unauthenticated; in browser dev mode the stored messages include the revealed nucleus prompt (`Chat.jsx:315-319`) | Cap the map (LRU, e.g. 20 sessions) and put both history routes behind `requireLocalToken`. | **Yes** |
| M11 | `server/index.cjs:83-90` | `/api/security/threats` guarded only by `req.ip.includes('127.0.0.1')`, no token | Add `requireLocalToken`, as the ghost route already does. | **Yes** |
| M12 | `src/utils/hmac.js` | Declares a client-side signature-verification control; nothing signs and nothing imports it | Either wire it to a signed channel or record in the spec that it is aspirational. | **Yes** — reachability. |
| M13 | `src/hooks/useSessionTimeout.js` | Idle-lock hook never mounted | Mount it in `AppShell`/`App.jsx` so an idle session locks the UI. | **Yes** |
| M14 | `src/store/uiStore.js:123` | `setPendingMod` has no producer, so `CommandPalette.jsx:643`'s `SelfModifyModal` never renders | Call it from whichever path generates a modification (after H9). | **Yes** |
| M15 | `src/store/ramaStore.js:85` | `setBackendRunning` never called, so no page can show whether the Python engine is up | Set it from `ai:get-status` / `ai:log`, and surface it on StockMind so a dead engine is named rather than inferred. | **Yes** |
| M16 | `electron/ipc/astEngine.cjs:238` | `fs.readFileSync` inside an otherwise-async repo walk — every source file read synchronously on the main thread | `await fs.promises.readFile`. | Partly — a timing test is flaky; the static change is reviewable. |
| M17 | `electron/ipc/filesystem.cjs:189,242,310` | Three recursive `readdirSync` walks (search, disk-sizes, find-dupes) block the main process | Convert to `fs.promises` with a yield every N entries. | Partly |
| M18 | `electron/ipc/system.cjs:73` | `list.find(p => p.pid === pid)` inside a loop over the process list — O(n²) | Build a `Map` by pid once. | **Yes** — behavioural test on a synthetic list. |
| M19 | `electron/ipc/graphReasoner.cjs:115-116` | `this.edges.filter(...)` for `node` recomputed inside the `other` loop — O(ready² × edges) | Precompute a `Map<nodeId, Set<depId>>` once per call. | **Yes** |
| M20 | `electron/ipc/evolutionEngine.cjs:64-65` | `evolutionLog` and `activeScouts` grow without bound in the main process | Cap both, following `functionTracking.prune`'s pattern. | **Yes** |
| M21 | `src/pages/Resources/Resources.jsx:354`, `RamaMind.jsx:297`, `Titlebar.jsx:51` | Fixed-interval polls that fire regardless of call latency — the pattern row 57 fixed in `System.jsx` and `sysinfo` | Self-pacing loops, as `System.jsx:78-82` already does. | Partly |
| M22 | `electron/lib/http.cjs:214` | `getCircuitStatus` has no caller; the one HTTP client's breaker state is unobservable | Surface it on `health:startup` or the System page. | **Yes** |
| M23 | `electron/ipc/timeline.cjs:184-204` | The `SELF_MODIFY` applier is registered by a module-scope side effect inside `try{}catch{}`, guarded by an ad-hoc `ledger.hasSelfModifyApplier` boolean; a load-order change loses it silently | Register it from `main.cjs`'s `REGISTRATIONS` list like every other applier. | **Yes** |
| M24 | `electron/ramaEventBus.cjs:81,116,132,144,157,173,181` | Seven empty catches on the event spine; a dropped capability-regression event is indistinguishable from one never emitted | `console.error` with the subscriber name. | **Yes** |
| M25 | `src/pages/IDE/DiffReview.jsx:89,93,101-104` | Six consecutive empty catches; a failed hunk parse renders as "no changes" on a self-modification review screen | Render the parse failure. | **Yes** |
| M26 | `scripts/` | No suite asserts that an exposed preload member or a registered channel has a caller | Add `verifyReachability.cjs`: every `ipcMain.handle` channel is named in `preload.cjs` or `src/`; every preload member has a caller; allow an explicit documented exceptions list. **This one rule catches H4, H6, H7, H10, M14 and the `sensitive` gate.** | **Yes — highest leverage item in this report** |
| M27 | `ai_backend/tests/` (20 suites, 8 585 lines) | Never executed — `npm run verify` is 39 `.cjs`/`.mjs` suites and `package.json` has no `pytest` | Add `verify:engine` running `pytest ai_backend/tests` **only when the venv exists**, skipping with a stated reason otherwise, so it is honest on a machine like this one. | **Yes** |
| M28 | `electron/ipc/selfCare.cjs:345,396` | Two `setInterval(runHealthSweep, 120000)` registrations; I did not trace whether both can arm | Guard with the existing `monitorInterval` null-check in both paths. **Unsure** this is a real double-start. | **Yes** |

### LOW

| # | File:line | Evidence | Fix |
|---|---|---|---|
| L1 | `electron/preload.cjs:925` | `'stockmind:'` in `ALLOWED_PREFIXES` matches no channel; `market:`, `tracking:`, `workspace:`, `popout:`, `self:`, `publish:`, `refresh:` are absent | Replace the dead entry with the seven real ones. |
| L2 | `electron/preload.cjs:991` | Logs "55 namespaces" counting 6 non-namespace keys | Count object values. |
| L3 | `electron/lib/crashGuard.cjs:64` vs `startupDoctor.cjs:226` | Two `missingModuleFrom` with different semantics on the same error string | One implementation, imported. |
| L4 | `instanceManager.cjs:330` ≡ `metaCognition.cjs:470` (`emit`); `egressBoundary.cjs:81` ≡ `ollamaCloud.cjs:168` (`storeOf`); `proposals.cjs:439` ≡ `resourceOrchestrator.cjs:733` (`broadcast`) | Byte-identical bodies, measured | Three small shared helpers — the same consolidation Section 23 did for 19 subsystems. |
| L5 | `slugify` in `customProviders.cjs`, `projectScaffold.cjs`, `publishProposal.cjs` | Three copies | One helper. |
| L6 | `start.js` (276 lines, repo root) | Stale ESM duplicate of `start.cjs`; no referrer | **Flag for master's decision** — record as superseded or remove with approval. |
| L7 | `server/brain/credentialVault.cjs` (183 lines) | Second, weaker, unreachable vault (§4.1) | **Flag for master's decision.** |
| L8 | `electron/cryptoCore.cjs:299` | `rewriteVerifier` duplicates the inline re-key step in `sessionManager.cjs:259-262` | Call it, or delete it — one of the two. |
| L9 | `src/store/ramaStore.js:11,14` | `apiKey`/`setApiKey` — a plaintext key slot nothing uses | Remove with approval; it reads as a credential path that does not exist. |
| L10 | `electron/dataStore.cjs:164-167` | `memory` declares `episodic/semantic/procedural`; `metaCognition.cjs:270` writes `experiential` | Declare `experiential` in the defaults. |
| L11 | 13 zustand keys (§2.3) | No consumer outside their store | Remove the genuinely unused ones with approval; wire `setPendingMod`/`setBackendRunning` (M14/M15). |
| L12 | `electron/lib/capability.cjs:19,35,75` | `TIER_COLORS`, `getCaps`, `requireCap` unused | Remove or adopt — `requireCap` is the throwing form nothing wants. |
| L13 | `server/middleware/threatShield.cjs:55` | `HONEYPOT_PATHS` declared, no route serves it | Serve them, or drop the declaration. |
| L14 | `electron/lib/dependencyAdvisor.cjs:241-256` | Same `rows` array filtered six times in one summary | Single pass. |
| L15 | `WhyPanel-*.js` chunk is 208.41 kB (measured) | Third-largest chunk after Monaco and the vendor bundles; lazily loaded so off the startup path | Check what it pulls in (likely `glossary.js`, 1169 lines) and split if it is loaded eagerly by a panel open. |

### Flagged for the owner, not proposed as changes

- **I15/I16 adjacency.** `loyaltyCore.cjs:85,109,120,317` and `nucleusSealer.cjs:265,501,513` are
  empty catches inside the loyalty/nucleus seal. Making them report could itself be a disclosure
  under I16 ("no accessor ever returns it"). I did not read enough of these two modules to judge, and
  guessing here is the one place a confident wrong finding is unacceptable. **Raising, not changing.**
- **I17.** `releaseChannel.cjs` being dormant and `updater.onAvailable/onDownloaded` having no
  subscriber are **correct** pre-baseline, exactly as I17 and ledger row 53 state. Listed only so a
  later reader does not mistake them for defects.
- **The vault-as-third-secret question** (§7.2) — interacts with I1 and I14.
- **The nucleus `behavioral` block** — already raised in the working-tree comment at
  `conversationRole.cjs:113-118`; it is sealed state and changing it is master's call.
- **Concurrent writes during a read-only audit** (§0.3) — commit `9054252` landed while this
  investigation was running, from a process other than this one. Nothing was lost, but an audit and a
  committing session sharing one worktree is a race worth knowing about before the next pass.

---

## 10. WHAT I DID NOT DO

Stated plainly, because an omission is cheaper than a confident wrong finding.

- **I never launched the app.** No runtime behaviour was observed. Every main-process and renderer
  claim is read from source with a citation.
- **I never ran the Python engine** and could not. No claim is made about prediction quality,
  calibration, in-sample leakage, or whether `horizons.py`/`training.py` implement the iterative
  horizon search request 1 describes. I read none of the 30 engine bodies.
- **I did not run `scripts/verifyLoyaltyTripwire.cjs --approve`**, per instruction.
- **I did not read every line of all 285 modules.** §1 lists what I read in full. The rest is covered
  by the mechanical sweeps, which are reproducible from the five scripts in `%TEMP%\rama_audit\`.
- **Unsure, and labelled as such:** whether `selfCare.cjs` can double-arm its sweep (M28); whether
  `threatShield`'s `aiAgentBlacklist`/`eternalLoopSet` are bounded; whether `Genome.jsx` reaches the
  `genome` namespace by a path my greps missed; whether any renderer surface can inject inline
  `<script>` (which is what would upgrade M4 from defence-in-depth to live); whether all 16 empty
  catches in `PriceChart.jsx` are individually justified.
- **I did not report style preferences.** No naming, formatting, comment-density or
  file-length item appears above. The 97 over-exports of §2.2 are explicitly excluded from the fix
  list for the same reason.
- **I proposed removing no capability.** Every fix above is additive or a correction; the four
  dead-duplicate items (L6, L7, L9, L12) are flagged for master's decision rather than proposed.

### Headline count

**10 HIGH, 28 MEDIUM, 15 LOW, 5 owner-flags.** 36 of the 53 are provable by a suite, and **one of
them — M26, a reachability suite — would have caught six of the ten HIGH items by itself.** That is
the single highest-value change in this report: the project's 39 suites prove that what exists is
correct, and nothing yet proves that what exists is *reachable*.

