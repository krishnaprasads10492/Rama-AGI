# THE STOP, THE POLICY TABLE, AND THE GATE ON `proposals:create`

*A deliberately narrowed slice of `docs/research/SELF_UPGRADE.md`. The orchestrator ended the design
loop after three review rounds and cut the scope to three items; everything else is listed in that
document's `## DEFERRED BY THE ORCHESTRATOR` section with the finding ids that must be resolved before
each part is built. **The design document is otherwise unedited and stands as the record.***

**Branch** `model/self-upgrade-loop`, in the worktree `.worktrees/self-upgrade`. Phase 0 (`d949b18`) is
untouched.

---

## 1. WHAT WAS BUILT

**Four new modules, two new suites, two edits to `electron/main.cjs`, two new `package.json` scripts.
Nothing was removed and no protected file was touched.**

| File | What it is |
|---|---|
| `electron/lib/autonomyStop.cjs` | **THE STOP.** Two predicates — `isStopped()` (fail-safe: absence of configuration means stopped; governs new autonomous action) and `isHalted()` (true only on an explicit `engage()` or `RAMA_AUTONOMY=stop`; governs the four pre-existing dispatchers). `engage()`, `lift()`, `status()`, `statusText()`, and five frozen lists declaring exactly what each predicate governs. `fs`, `path`, `os` at module scope and nothing else. |
| `electron/lib/autonomyPolicy.cjs` | **THE POLICY TABLE.** Fifteen classes over four frozen constants — `CLASSES`, `FLOORS`, `CEILINGS`, `PERMANENT` — with `EDITABLE` **derived**, plus `RAMA_INITIATED`, the two-member `MASTER_ACT`, and `SELF_GOVERNING_PATHS`. `shared/autonomy-policy.json` ships absent; the loader validates and rejects **whole**, never per key. `require(classId, need)` throws when `need` is absent; `requireMasterDriven` throws for any class outside `MASTER_ACT`. |
| `electron/lib/autonomyGate.cjs` | **THE CREATE GATE.** `guardLedgerIpc(ipc)` wraps the recorder the ledger is handed so `proposals:create` is validated before it is reached; `fileProposal(ledger, def)` is the only path by which Rāma may file one of this design's kinds, and it consults the stop and then the policy. `origin` is a literal written at each call site, never read from the definition. |
| `electron/lib/upgradeApplier.cjs` | **THE APPLIER'S ENTRY VALIDATION.** Registered for the new kind `self-upgrade` through `registerApplier`. Derives `masterDriven` from `opts.user`; resolves its level through `requireMasterDriven`; records `opts.autonomous` and never reads it; derives the snapshot directory from the proposal id; re-runs the loyalty guard; refuses a governed path, a path outside the root, a symlink, `action: 'delete'`, a mis-declared create, and a drifted base digest. Byte snapshot verified on read-back before the first write; revert on a failed write; a failed revert is fatal, marked, and engages the stop. |
| `scripts/verifyAutonomyStop.cjs` | 187 assertions. The stop, the policy table, the permanence row, the I11 behavioural proof, `lift()`'s executed success path, the live data-file loader, and the degraded create fence. |
| `scripts/verifyUpgradeApplier.cjs` | 244 assertions. The shipped-state apply, the create gate, the entry validations, every spelling of a governed path at every gate, the revert, retention, and who can reach `proposals.apply`. |

`electron/main.cjs` changed in exactly two places: the ledger's `register()` now receives
`autonomyGate.guardLedgerIpc(ipcRec)` (and the bare `ipcRec` if the gate failed to load, so a degraded
gate never costs the ledger its channels), and `upgradeApplier.register(proposalLedger)` was added to
`REGISTRATIONS` **after** the ledger entry.

### The three item-1 blockers, and what each one is now

**(a) `opts.autonomous` no longer decides anything.** It arrives from the renderer (`preload.cjs` 680)
and reaches the applier untouched (`proposals.cjs` 235, `await applier(p, opts)`), so a predicate built
on it is supplied by the party the stop exists to stop and is bypassable by **omitting a field**. It is
now recorded into `meta.autonomy` — **merged, not assigned**, so `appliedBy` and `autonomousApply`
survive beside it — and the suite asserts both behaviourally (an apply carrying the flag is treated
identically to one without it) and on the source shape (no conditional reads it; no `opts` member other
than `user` and `autonomous` is read at all). Autonomy is derived from the **caller**: `origin` is
`'ipc'` inside the IPC wrapper because that function *is* the IPC handler, and `'rama'` inside
`fileProposal`. `inspectCreate` **throws** on anything else rather than guessing.

**(b) The snapshot directory is derived, and the persisted one is never read.** `dir` is
`path.join(userDataRoot, 'rama', 'upgrade-snapshots', proposal.id)` behind a `^[0-9a-f]{20}$` test on
the id. The suite plants a `meta.weighing.blastRadius.rollbackPoint.dir` pointing straight at
`<userData>/rama/` and asserts the snapshot still lands under the derived path **and that the
allow-file is byte-identical afterwards**. The stronger assertion is an absence: the string
`rollbackPoint` does not appear in `upgradeApplier.cjs` at all.

**(c) FR-17 versus §E.5.1a is settled: the stop halts Rāma, and must not refuse master.** The
applier's level comes from `policy.requireMasterDriven('revert-own-apply', 'L4')`, which resolves
through `effective(c, {ignoreStop: true})` and **throws for any class outside the frozen two-member
`MASTER_ACT`**. `ignoreStop` has exactly one consumer in the whole tree, asserted. **The assertion the
previous passes did not have is the first one in `verifyUpgradeApplier.cjs`: no allow-file, no policy
file, every class resolving to L0 — and a master-approved apply SUCCEEDS**, with the bytes checked on
disk. It runs again under `RAMA_AUTONOMY=stop` over a valid allow-file, which was the second reachable
form of the same defect.

### Item 2's I11 half

**The fail-safe default halts nothing that ships.** `isHalted()` is false with no configuration, and
the four pre-existing dispatchers are enumerated in `PRE_EXISTING` with the module, the function, the
measured line, what work it dispatches, `governedBy: 'isHalted'` and `haltedByEngage: false` **with the
reason in the data**. The suite asserts, per entry, that the module and the symbol still exist, and
that **no `isStopped()` call reaches any of those four files**. The behavioural row is the one that
matters: with no allow-file, a counting fake registered with `refreshScheduler` is still called by
`runNow`, and the task state is still written — so `ollama-catalog` and `dependency-review` keep
running exactly as in the build master already has.

**`engage()` tears down nothing, and says so.** The resume path is `lift()`; `lift()` requires
`system.suspend-autonomy`; that key is not in the capability matrix, so `capability.can()` refuses it
for every tier including master. Wiring the teardown now would leave master's shipped timers dead until
a restart. `statusText()` therefore prints *"Still ARMED, because this build does not tear them down"*
after an engage, and names the by-hand undo (delete `autonomy.stopped.json`). That is a deliberate
narrowing, not an oversight; it is in the deferred table with its blocker.

### Item 3

`proposals:create` is wrapped. **An IPC create keeps working exactly as before** — `self-modify` from
`src/services/selfModify.js` still files, a tier-2 user is still refused by the ledger's own view gate
— and gains two fences: the kinds this design owns (`self-upgrade`, `self-upgrade-question`) are
refused from outside the main process, and **no create of ANY kind may name a self-governing path or
the stop's own state files**, in `changes[].path` or anywhere in `meta`. The in-process path,
`fileProposal`, consults the stop first and the policy second, and files nothing while stopped — the
ledger is never reached, asserted with a counting fake.

---

## 1A. THE BUILD-REVIEW ROUND — SIX FINDINGS, WHAT EACH ONE WAS

`docs/research/build-review.json` returned **CHANGES_REQUESTED**: 1 HIGH, 2 MEDIUM, 3 NIT. No module
was re-implemented; each finding was fixed where it was, and every one of them gained a behavioural
row. `+120` assertions in `verifyUpgradeApplier.cjs` and `+40` in `verifyAutonomyStop.cjs`.

**Finding 1 (HIGH) — the path fence compared strings it had not resolved.** `autonomyGate.normalise`
swapped separators, stripped a leading `./` and lowercased; it never resolved structure. So
`namesGovernedPath` returned `null` for `electron/lib/./autonomyStop.cjs`,
`electron//lib/autonomyStop.cjs` and `electron/lib/../lib/autonomyStop.cjs` — **reproduced directly
before the fix, all three spellings plus the backslash form returning `null`** — and since
`autonomyStop.cjs` is not in `loyaltyGuard.PROTECTED_FILES`, nothing downstream objected at either
origin or at the applier's step 3. **Both halves of the narrowed FR-14 claim in §2 below were false.**
I6 still held — the apply needed a recorded master approval — but the diff should never have been
fileable. Fixed by canonicalising through `path.posix.normalize` before comparing, with an empty input
returned empty rather than as `normalize`'s `'.'` (which would have made a blank path name the
repository root). **§13 of `verifyUpgradeApplier.cjs` now runs five spellings of each of the four
`SELF_GOVERNING_PATHS` — generated from the path, so a fifth path is covered automatically — at
`inspectCreate` for BOTH origins, in `meta`, and at `applyWith` with a correct `baseSha256` and the
governed file present in the fixture, asserting the bytes are identical afterwards.** It ends with a
**control**: the same spellings applied to an *ungoverned* path must still APPLY, so a green section
cannot mean "the fence refuses odd-looking paths" when what is claimed is "the fence resolves them".

**Finding 2 (MEDIUM) — a documented data edit re-created the §1 defect.** `revert-own-apply` was
EDITABLE, so `{"version":1,"levels":{"revert-own-apply":"L0"}}` validated clean, and the applier's
`requireMasterDriven` gate then threw on a **master-approved apply** — the exact defect the first rows
of that suite exist to catch, reached through a second door. Worse, the edit did not do what
`autonomyPolicy.cjs`'s header said it did: `revert()` consults neither the policy nor the stop (a token
is its authority), so the automatic revert kept running while the apply was blocked. **Fixed by making
`revert-own-apply` PERMANENT**, so the file is not read for it and a file that so much as names it is
rejected whole. Both `MASTER_ACT` members are now permanent, and that is held mechanically rather than
by comment: **`requireMasterDriven` THROWS for a `MASTER_ACT` class that is not also `PERMANENT`**, so
removing one fails loudly at the first apply instead of quietly handing the decision to a data edit.
The two false sentences in the module header were replaced with what is true — the data file cannot
turn the automatic revert off, and this design does not offer that at all. Permanent is now **seven**
and editable **eight**.

**Finding 3 (MEDIUM) — the only writer of `allowed: true` had no behavioural coverage.** `lift()`
required `./capability.cjs` inline with no seam, and `system.suspend-autonomy` is absent from the
matrix, so it could not succeed on any machine: the note refusal, the file contents, the
write-then-unlink ordering and the halt clearing were asserted by **regex over the function's own source
text**, and the first real execution would have been in production on the day master added the key.
`lift(user, note, {capability})` now takes an injected module, in the same shape `upgradeApplier` uses
for `io`, and §17 executes the success path. **The seam adds no reach:** `isStopped()` reads a plain
unsigned JSON file, so anything that could pass a fake capability could already write
`allowed: true` to `allowPath()` and skip the function entirely — the capability check gates the in-app
control, it is not a containment boundary against code already inside the main process. What holds that
line is the asserted absence of callers, and a new row asserts no module in the shipped tree passes a
`capability` override either. A denying fake is also asserted to still refuse, so the seam cannot be
read as a bypass.

**Finding 4 (NIT) — `reload()` promised "no restart is required" and had no production caller.**
`current()` cached the first load for the process lifetime, so a hand edit did nothing until the app
restarted. `reload()` is now called at each of the three doors that make or report a decision —
`require`, `requireMasterDriven`, `policyStatus` — and §16 proves it against **a real file at
`policy.DATA_FILE`**, which §4's NOT VERIFIED list previously had to concede was a branch the suite
never took: a hand-written restriction takes effect at the next gate with no `reload()` call and no
restart, and deleting the file restores the floors live. `effective()` deliberately stays on the cache
as the plain reader; the doors re-read before consulting it, so the two never disagree at the moment a
decision is made. **The residual is stated rather than engineered around** and is in §4.

**Finding 5 (NIT) — a comment understated where a forgery can originate.** Measured:
`proposals.cjs` registers `ipcMain.handle('proposals:apply', (_e, id, opts) => apply(id, opts || {}))`
at **269** and `apply()` authorises `opts.user` at **219**, so the user object the applier reads
**arrives with the IPC request** and is renderer-supplied, not merely forgeable in-process. The comment
now says that, and binding that user to the authenticated session is on the FOR MASTER list — the hole
is pre-existing and lives in a protected file.

**Finding 6 (NIT) — a degraded create fence was invisible on the autonomy surface.** The stop is
fail-safe; the create fence is fail-open by design, so `main.cjs` registers the ledger with the bare
recorder when `autonomyGate.cjs` cannot load and a broken fence never costs the ledger its channels
(I11). `safeRequire` records that in `loadFailures()` — the boot log, not the autonomy surface — so
`status()` and `statusText()` would have gone on describing a fence that was not in place. `status()`
now carries a `createFence` field with the module named and `failOpen: true` declared, and
`statusText()` warns, naming **both** missing fences, when it is not in place. The degraded branch is
**executed**, not read: the suite replaces the cached module's exports with an object that is not the
fence, asserts the warning, and restores it.

---

## 2. EVERY DESIGN CLAIM MEASURED **FALSE** AGAINST SOURCE

| Claim in the design | Measured | What was built instead |
|---|---|---|
| FR-14: *"the STOP and the policy table are unreachable by any proposal"* | **FALSE.** `electron/ipc/timeline.cjs` 195 registers the pre-existing `SELF_MODIFY` applier, which does `fs.writeFileSync(change.path, …)` at **204** and `fs.rmSync(change.path, …)` at **199** — no resolve-then-compare, no root confinement, no `lstat`. And `loyaltyGuard.PROTECTED_FILES` (`loyaltyGuard.cjs` **64**) is exactly seven paths; `shared/autonomy-policy.json` is not among them. | The claim is **narrowed to what is true**: the stop's state is unreachable by **this design's applier** and by **the renderer create path**. **Both halves of that narrowed claim were themselves FALSE on the first pass — see the build-review table below, finding 1 — because the fence compared paths it had not resolved. They are true now.** The in-process route is open and `verifyUpgradeApplier.cjs` prints it as a residual on every run. Confining `timeline.cjs` would change a shipped applier's behaviour and refusing `delete` would remove a capability the renderer can reach today, so it is **master's decision**, raised rather than taken. |
| Criterion 21c: *"a source-shape assertion finds **zero** in-process callers of `proposals.apply`"* | **FALSE as written.** Two call sites: `electron/ipc/evolutionEngine.cjs` **137** and `electron/ipc/codeRegenEngine.cjs` **296**. | Both are **inside `ipcMain.handle` bodies**, passing a user that arrived with the request. The assertion that actually holds is now in the suite: *every* call site of `proposals.apply` sits inside an IPC handler, **none is reached from a timer, a scheduler task or a loop**, and the count is pinned at **two** so a third turns the row red and demands a review. A guarantee stated as "zero" would have gone red on correct code and been "fixed" by weakening it. |
| §E.2.5: `metaCognition` *"`startAudit`/`stopAudit` **exported**"* | **FALSE today.** Neither function exists. The audit interval is armed inline at `metaCognition.cjs` **332**, inside `register()`, and there is no exported re-arm. | Nothing was added to that file. `PRE_EXISTING` records `auditTimer` at 332 with the reason the teardown is deferred: without an exported re-arm and without a working `lift()`, a halt could not be undone except by restart. |
| §E.1.3: *"`ignoreStop` has exactly one consumer"* | **Would have been false on the first honest implementation.** `policyStatus()` needs *"what would hold if autonomy were allowed"*, and the obvious way to get it is a second `{ignoreStop: true}`. | A private `resolveWithoutStop(state, classId)` holds everything after the stop's line; `effectiveFrom` and `policyStatus` both call it, and **the literal `ignoreStop: true` appears exactly once in the tree** — inside `requireMasterDriven` — asserted by the suite, including that no other module mentions `ignoreStop` at all. |
| Review's *"`proposals.cjs` 230 calls `applier(p, opts)`"* and *"`authorise` at 215, the apply handler at 272"* | **Measured in this worktree:** `applier(p, opts)` at **235**, `authorise(opts.user, …)` at **219**, `proposals:apply` at **269**, `proposals:create` at **289**, `registerApplier` at **85**, the id at **117**. So the design's §J.0 corrections were right and the newer citations are not. | Every citation written into the new modules uses the measured number. |
| §E.13 / the review: `capability.can` *"reads only `user.tier` (`capability.cjs` 27–33)"* | **True, with a tighter range:** `can()` spans **27–32**; the unknown-capability refusal is at **30** and the tier comparison at **31**. | Cited as measured. The consequence the design draws from it is correct and is why `masterDriven` is written down as **insufficient** rather than as the guarantee. |
| Part F's *"25 suites"*, and the review's *"18 files match `scripts/verify*.cjs`"* | **Both FALSE.** Measured in this worktree: **17** tracked `scripts/verify*.cjs` before this slice (**19** after), plus **8** `scripts/verify*.mjs` — **25 files in total before, 27 after**, which is probably where "25" came from. The `verify` chain itself invokes **29** scripts (27 before this slice) and **28** of them print a count. | The build note states the real numbers, below, separated by what was counted. |

### And what the BUILD review measured false — in this build note and in these modules

| Claim | Measured | What it is now |
|---|---|---|
| **This note's own §2 row 1:** *"the stop's state is unreachable by **this design's applier** and by the **renderer create path**"* | **BOTH HALVES FALSE.** `autonomyGate.normalise` never resolved path structure, so `electron/lib/./autonomyStop.cjs`, `electron//lib/autonomyStop.cjs`, `electron/lib/../lib/autonomyStop.cjs` and the backslash form all read as naming nothing governed — reproduced returning `null` for every one of them. The gate allowed them at both origins and the applier's step 3 allowed them too. | Canonicalised through `path.posix.normalize`. 100 new assertions cover five spellings × four paths × three gates, plus a control that proves the fence **resolves** paths rather than rejecting unusual ones. |
| `autonomyPolicy.cjs`'s header: *"a present file … turns the automatic revert off"* and *"setting `revert-own-apply` to L0 in the data file still genuinely disables the automatic revert"* | **FALSE, twice.** `revert()` consults neither the policy nor the stop — a token is its authority — so the edit never touched the revert. What it DID do was make `requireMasterDriven` refuse a **master-approved apply**. A documented, validator-accepted edit that re-created the defect this slice exists to prevent. | `revert-own-apply` is PERMANENT, so the file is not read for it; a file naming it is rejected whole; `requireMasterDriven` throws for a `MASTER_ACT` class that is not permanent. Both sentences rewritten to say what is true. |
| `autonomyPolicy.cjs`'s `reload()`: *"no build and no restart is required"* | **FALSE.** `reload()` had **no production caller anywhere in `electron/`** and there is no IPC channel for the policy, so `current()` cached the first load for the process lifetime. | Called at `require`, `requireMasterDriven` and `policyStatus`, and proven against a real file on disk. |
| `upgradeApplier.cjs`'s step-0 comment: *"a `{tier: 0}` object is forgeable **in-process**"* | **UNDERSTATED.** `proposals:apply` is `ipcMain.handle('proposals:apply', (_e, id, opts) => apply(id, opts \|\| {}))` at **269**, and `apply()` authorises `opts.user` at **219** — the user object arrives with the IPC request. | The comment says renderer-supplied, and the fix is on the FOR MASTER list because `proposals.cjs` is protected. |
| The build review's own fix note: *"canonicalise by resolution … the way the pre-existing `loyaltyGuard` already does"* | **FALSE as to mechanism, true as to outcome.** `loyaltyGuard.normalise` (**209–214**) is byte-for-byte the same non-resolving function. What makes it refuse `electron/lib/./loyaltyGuard.cjs` is a *third* clause in `inspectChanges` at **229** — `p.endsWith(basename(prot)) && p.includes(dirname(prot))` — which is basename-plus-dirname matching, not resolution. | The prescribed fix was adopted anyway, because it is the better one: resolution is exact where basename matching is a heuristic that would also refuse an unrelated file of the same name in the same directory tree. Recorded because *"copy what loyaltyGuard does"* would have reproduced the hole. |

**One thing the design claimed and source confirmed, worth recording because the whole slice rests on
it:** `shared/autonomy-policy.json` really does ship absent, so the floors really are the shipped
levels, and `verifyLoyaltyTripwire.cjs` hashes only `PROTECTED_FILES` — so adding four modules does not
disturb the tripwire. Both asserted.

---

## 3. SUITE COUNTS, BEFORE AND AFTER

| | Scripts in the `verify` chain | Of those, printing a count | Assertions | Failures |
|---|---|---|---|---|
| **Before this slice** | 27 | 26 | **2518** | 0 |
| **After the first pass** | 29 | 28 | **2789** | 0 |
| **After the build review** | 29 | 28 | **2949** | 0 |

The slice is `+431` in total: `+187` from `verifyAutonomyStop.cjs` and `+244` from
`verifyUpgradeApplier.cjs`. The build-review round added `+160` of those (`+40` and `+120`) and
**changed three existing assertions in place** — the permanent-set literal and the two counts that read
six-and-nine now read seven-and-eight, and the `requireMasterDriven` source row is bounded by the next
function declaration instead of by a character count, so growing that function's body can no longer
turn a true claim red. **Both suites are still appended to the end of the `verify` chain; nothing in it
was reordered and no existing script was removed.** Two scripts were added in the first pass
(`verify:autonomy`, `verify:applier`); `package.json` was not touched in this round. Five residuals
print across the two suites on every run and are counted out loud rather than hidden.

---

## 4. NOT VERIFIED

**Read this section before trusting anything above it.**

- **`npx vite build` has not been run and cannot be run from this worktree.** No `.jsx` was touched, so
  there is no renderer change to build — but the claim is not "the build passes", it is "nothing here
  is renderer code".
- **The app has never been started with these modules loaded.** `main.cjs`'s two edits are asserted by
  reading the file, not by booting Electron. In particular: that `autonomyGate.guardLedgerIpc(ipcRec)`
  behaves identically to `ipcRec` for every channel other than `proposals:create` is proven against a
  **fake** recorder, not against Electron's real `ipcMain`.
- **`app.getPath('userData')` has never been resolved.** Every assertion injects a scratch root through
  `stop.configure()`. The Electron branch and the platform fallback (`%APPDATA%/Rama AGI`,
  `~/Library/Application Support/Rama AGI`, `$XDG_CONFIG_HOME/Rama AGI`) are **unexercised**, and if
  the fallback disagrees with Electron's answer on some platform then a suite-time path and a runtime
  path differ. That is the single most likely defect in this slice.
- **No proposal of kind `self-upgrade` has ever been filed by anything but a test.** `fileProposal` has
  **no caller in the shipped tree** — the loop that would call it is deferred — so the chokepoint is
  built and unreached. It is built first on purpose; it is also, today, untravelled.
- **`lift()` has never succeeded against the REAL capability matrix**, and cannot until master adds
  `system.suspend-autonomy`. Its success path is now executed — the allow-file written and parsed back,
  `isStopped()` flipping to false, the halt cleared, the note and the author on disk, an empty note
  still refused — but with an **injected** capability module that grants the key. The write ordering
  (allow-file first, stopped-record second) remains asserted **on the source text**, because asserting
  the interleaving would need a crash between two synchronous writes.
- **`engage()`'s teardown does not exist**, so nothing has been observed stopping or re-arming. No
  timer in this project has been watched being halted by this build, because this build halts none.
- **The symlink refusal was not exercised on this machine** — `fs.symlinkSync` needs privileges Windows
  did not grant, so the `lstat` rule is asserted on source only, and that is printed as a residual.
- **The stop is not unreachable by every proposal** (see §2, row 1). The renderer route is closed; the
  in-process `proposals.create()` route is not, and cannot be without editing a protected file.
- **No `console.log` was added and no dependency was added**, verified by `verifyInvariants.cjs` as part
  of the chain — but **I11's "every new engine has a working fallback" is only partly mechanical here**:
  the fallback asserted is that a failed load of the gate leaves the ledger registering exactly as
  before. Whether a *degraded* policy module is a safe state is a judgement, not a row.
- **`shared/autonomy-policy.json` now exists transiently during the suite, and that is a risk of its
  own.** The live `load()` path's present-file branch is exercised at last — accepted, rejected, and
  deleted, with the gate's answer changing each time and no restart — but the rows **write the real
  `policy.DATA_FILE`**. They refuse to run and print a residual if the file already exists, so master's
  own policy file is never clobbered, and the write is inside a `try/finally` that deletes it. **If the
  suite is killed between the write and the `finally`, a `{"version":1,…}` file is left in `shared/`.**
  A `git status` after an interrupted run is the check; nothing automatic catches it.
- **A hand edit landing mid-read is unhandled, deliberately.** Now that the gating doors re-read the
  file, a read that lands part-way through master's save sees a torn file. That is REJECTED WHOLE, so it
  falls back to the floors: stricter for a raise, briefly more permissive for one of master's
  restrictions. Every floor is at or below L3 (propose-only) and no permanent class is readable from the
  file at all, so the worst case is a proposal Rāma should not have filed — which still cannot be
  applied without master's recorded approval (I6). **Not fixed, not locked, not atomically read.**
- **The create fence's degraded branch was proven by poisoning `require.cache`, not by a real load
  failure.** The suite replaces the cached `autonomyGate.cjs` exports with an object that is not the
  fence and restores them afterwards. That is the shape a partial or shadowed load leaves behind; it is
  **not** the same event as `safeRequire` failing at boot, which has never been observed.
- **`policy.reload()` is now called on every gating decision, and that disk read has never been
  measured under load.** The gates are rare by construction — a proposal filing, an apply — so the cost
  is assumed negligible rather than profiled.

---

## 5. FOR MASTER — the entries this build cannot add

`shared/capabilities.json` and `electron/lib/loyaltyGuard.cjs` are **protected files**. The tripwire's
`--approve` was **not run**, and must not be.

**Capability matrix, two entries:**

```json
"system.suspend-autonomy": 0,
"autonomy.view":           1
```

| Key | Tier | How it degrades until it is added |
|---|---|---|
| `system.suspend-autonomy` | **0** | `capability.can()` returns false for an unknown capability for **every** tier, so `lift()` cannot succeed for anyone and the stop can only be lifted by writing `<userData>/rama/autonomy.allow` by hand. Safe direction. The refusal names the missing key and the file rather than rendering a dead button. |
| `autonomy.view` | **1** | Nothing renders the panel yet (deferred), so there is no visible degradation today. When the panel is built it must gate on this itself. |

**`loyaltyGuard.PROTECTED_FILES` and `shared/loyalty-tripwire.json`, four paths:**
`shared/autonomy-policy.json`, `electron/lib/autonomyPolicy.cjs`, `electron/lib/autonomyStop.cjs`,
`shared/loyalty-tripwire.json`. Until they are added, the create gate and the applier's entry
validation are the **only** mechanical guards on them, and neither of those files is protected either.
Both suites print this residual on every run.

**And one fix inside a protected file:** **bind `proposals:apply`'s user to the authenticated session
rather than to the payload.** `proposals.cjs` **269** is
`ipcMain.handle('proposals:apply', (_e, id, opts) => apply(id, opts || {}))` and `apply()` authorises
`opts.user` at **219**, so the tier-0 identity every apply is checked against **arrives from the
renderer**. `capability.can` reads only `user.tier`, so `{tier: 0}` is enough. The hole is pre-existing
and `proposals.cjs` is protected, so this build only declines to depend on it: `upgradeApplier`'s
`masterDriven` check is written down as **insufficient**, and what actually holds "Rāma does not start
an apply" is the asserted absence of any call site of `proposals.apply` outside an IPC handler, pinned
at two so a third turns the row red.

**And one decision, not a task:** should `electron/ipc/timeline.cjs`'s `SELF_MODIFY` applier be confined
(resolve-then-compare, `lstat`, and refusing `action: 'delete'`)? It would close the last route to the
stop's own state — and it would change a shipped applier and remove a delete path
`src/services/selfModify.js` can reach, which I11 forbids without your word.

**To allow autonomy at all** (nothing below happens until you do):

```
<userData>/rama/autonomy.allow
```
```json
{ "allowed": true, "by": "master", "at": "2026-02-14T09:31:04.000Z", "note": "why, in master's words" }
```

Deleting it stops everything again, needs no running Rāma, and cannot be taken away.

---

## 6. PASTE-READY — spec Section 132 and ledger row 152

> **Section 129 and ledger row 149 are TAKEN on `dev`.** These blocks use **132** and **152**.
> **Verify the target immediately before pasting; do not trust these numbers:**
> `Select-String -Path RAMA_AGI_MASTER_SPEC.md -Pattern '^## SECTION 13[0-9]'` and
> `Select-String -Path RAMA_AGI_MASTER_SPEC.md -Pattern '^\| 15[0-9] \|'`.
> **`RAMA_AGI_MASTER_SPEC.md` was NOT modified by this build.**

### Block A — the spec section

```markdown
## SECTION 132 — The stop built before there was anything to stop

Master asked for a model that upgrades itself. The design for it ran to six modules and three review
rounds, and every remaining blocker sat in a part that produces a diff. So the scope was cut to the
three things that must exist BEFORE any of it, and the first of them is the switch that turns it off.

**Why first.** A stop retrofitted onto a running loop is the one thing that must not be retrofitted.
Section 124 found there is no *"stop all autonomous activity, stay running, stay inspectable"* control,
and found it while nothing much was running — which is exactly when it is cheap to build.

**Two predicates, and the asymmetry is the decision.** `isStopped()` is fail-safe: the absence of
`<userData>/rama/autonomy.allow`, an unreadable file, invalid JSON, `"true"`, `1`, `{}`, `null` or a
directory at that path all mean STOPPED, and it governs new autonomous action. `isHalted()` is true
only on an explicit `engage()` or `RAMA_AUTONOMY=stop`, and it governs the four dispatchers that ship
and run today — `ollama-catalog` and `dependency-review`, the metacognition audit, selfCare's
120-second sweep including `checkInstanceFailover`, and marketIntel's two ticks. **Governing those with
the fail-safe predicate would have removed five working behaviours on every install until master
hand-created a file nobody had told him about: a regression wearing a fail-safe argument, which I11 has
no exception for.** A counting fake proves a default install still dispatches.

**The policy table is declared data over frozen code.** Fifteen classes; `FLOORS`, `CEILINGS` and a
seven-member `PERMANENT` frozen in `autonomyPolicy.cjs`, with the editable set DERIVED from them.
`shared/autonomy-policy.json` ships absent, so the floors are the shipped levels. A present file may
restrict an editable class below its floor and raise one only to its ceiling — and for a permanent
class **the file is not read at all**, so a `"master-record": "L4"` key is a key with no reader.
Raising one requires editing the module, which is a source change under an I6 approval. The file is
rejected WHOLE, never per key, because a partial accept teaches whoever wrote it which edits are
silently dropped. **`master-record` is permanent because of Section 127: Rāma may never widen its own
retention window or capture scope for what is recorded about master.**

**The stop halts Rāma and must never refuse master.** On a shipped install every class resolves to L0,
so an unconditional `policy.require('revert-own-apply', 'L4')` at the applier's entry refused a
MASTER-APPROVED APPLY on every install — the defect two revisions each thought they had fixed, hidden
because the row that tested it used an allow-file fixture. The level now comes from
`requireMasterDriven`, which ignores the stop for exactly two classes (`apply-source`,
`revert-own-apply`) and THROWS for everything else. The first assertions in the new suite run in the
state a real install boots into: no allow-file, no policy file, and master's apply SUCCEEDS.

**The same defect had a second door, and the build review found it.** With `revert-own-apply` merely
editable, `{"version":1,"levels":{"revert-own-apply":"L0"}}` validated clean and refused master's apply
again — a documented edit re-creating the defect, and it did not even do what the module header claimed,
since `revert()` consults neither the policy nor the stop. Both `MASTER_ACT` classes are PERMANENT now,
and `requireMasterDriven` THROWS for a `MASTER_ACT` class that is not, so the two sets cannot drift
apart quietly. The review also found the path fence comparing strings it had never resolved:
`electron/lib/./autonomyStop.cjs` and `electron/lib/../lib/autonomyStop.cjs` named nothing governed, so
a diff against the stop's own module was fileable at both origins and at the applier. Resolution now
precedes comparison, and 100 assertions cover five spellings of each governed path at every gate — with
a control proving the fence resolves paths rather than rejecting unusual-looking ones.

**Nothing autonomous was unlocked.** `author-change` and `propose-source` sit at L1, L5 is declared and
unreachable, `fileProposal` has no caller, and the five stage functions are asserted ABSENT so the
chokepoint count cannot claim coverage that does not exist. **No autonomy rung was climbed.**

What is deferred, and the finding blocking each, is in `docs/research/SELF_UPGRADE.md`'s
`## DEFERRED BY THE ORCHESTRATOR`. What was built, every design claim measured false against source,
and a NOT VERIFIED list are in `docs/research/self-upgrade-build.md`.

**For master:** add `"system.suspend-autonomy": 0` and `"autonomy.view": 1` to
`shared/capabilities.json`; add `shared/autonomy-policy.json`, `electron/lib/autonomyPolicy.cjs`,
`electron/lib/autonomyStop.cjs` and `shared/loyalty-tripwire.json` to `loyaltyGuard.PROTECTED_FILES`
and the tripwire manifest. Both are protected files, so this build asks rather than acts, and the suites
print the residual on every run. One decision is yours: whether `timeline.cjs`'s SELF_MODIFY applier
should be confined, which would close the last route to the stop's own state and would also change a
shipped applier.
```

### Block B — the ledger row

```markdown
| 152 | The stop, the policy table, and the gate on `proposals:create` — built before there is anything autonomous | done | Section 132. Four new modules (`autonomyStop`, `autonomyPolicy`, `autonomyGate`, `upgradeApplier`), two suites, +431 assertions (2518 → 2949, 0 failed). Fail-safe stop with a second explicit-engage predicate so no shipping timer is halted (I11); **seven** permanent policy classes the data file is not read for, including both `MASTER_ACT` members so no data edit can refuse master's own apply; `requireMasterDriven` over that two-class subset so a stopped install still applies what master approved; `proposals:create` fenced at the IPC seam, with the path fence canonicalising by resolution so no spelling of a governed path gets past it. The build review returned 1 HIGH / 2 MEDIUM / 3 NIT and all six were fixed in place (+160 assertions), the HIGH being a path fence that compared unresolved strings. `node_modules` is absent from the worktree, so `vite build` was NOT run — no `.jsx` changed. NOT VERIFIED: the app has never booted with these modules, `app.getPath('userData')` never resolved, `lift()` has never succeeded against the real capability matrix (needs `system.suspend-autonomy`; its success path is executed with an injected one), `engage()` tears down nothing by design, and a torn read of a hand-edited policy file falls back to the floors. Next step: the five-stage loop, blocked on design-review findings 2 and 5 — see `docs/research/SELF_UPGRADE.md` § DEFERRED BY THE ORCHESTRATOR. |
```
