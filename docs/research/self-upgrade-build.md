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
| `scripts/verifyAutonomyStop.cjs` | 147 assertions. The stop, the policy table, the permanence row, and the I11 behavioural proof. |
| `scripts/verifyUpgradeApplier.cjs` | 124 assertions. The shipped-state apply, the create gate, the entry validations, the revert, retention, and who can reach `proposals.apply`. |

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

## 2. EVERY DESIGN CLAIM MEASURED **FALSE** AGAINST SOURCE

| Claim in the design | Measured | What was built instead |
|---|---|---|
| FR-14: *"the STOP and the policy table are unreachable by any proposal"* | **FALSE.** `electron/ipc/timeline.cjs` 195 registers the pre-existing `SELF_MODIFY` applier, which does `fs.writeFileSync(change.path, …)` at **204** and `fs.rmSync(change.path, …)` at **199** — no resolve-then-compare, no root confinement, no `lstat`. And `loyaltyGuard.PROTECTED_FILES` (`loyaltyGuard.cjs` **64**) is exactly seven paths; `shared/autonomy-policy.json` is not among them. | The claim is **narrowed to what is true**: the stop's state is unreachable by **this design's applier** and by **the renderer create path**. The in-process route is open and `verifyUpgradeApplier.cjs` prints it as a residual on every run. Confining `timeline.cjs` would change a shipped applier's behaviour and refusing `delete` would remove a capability the renderer can reach today, so it is **master's decision**, raised rather than taken. |
| Criterion 21c: *"a source-shape assertion finds **zero** in-process callers of `proposals.apply`"* | **FALSE as written.** Two call sites: `electron/ipc/evolutionEngine.cjs` **137** and `electron/ipc/codeRegenEngine.cjs` **296**. | Both are **inside `ipcMain.handle` bodies**, passing a user that arrived with the request. The assertion that actually holds is now in the suite: *every* call site of `proposals.apply` sits inside an IPC handler, **none is reached from a timer, a scheduler task or a loop**, and the count is pinned at **two** so a third turns the row red and demands a review. A guarantee stated as "zero" would have gone red on correct code and been "fixed" by weakening it. |
| §E.2.5: `metaCognition` *"`startAudit`/`stopAudit` **exported**"* | **FALSE today.** Neither function exists. The audit interval is armed inline at `metaCognition.cjs` **332**, inside `register()`, and there is no exported re-arm. | Nothing was added to that file. `PRE_EXISTING` records `auditTimer` at 332 with the reason the teardown is deferred: without an exported re-arm and without a working `lift()`, a halt could not be undone except by restart. |
| §E.1.3: *"`ignoreStop` has exactly one consumer"* | **Would have been false on the first honest implementation.** `policyStatus()` needs *"what would hold if autonomy were allowed"*, and the obvious way to get it is a second `{ignoreStop: true}`. | A private `resolveWithoutStop(state, classId)` holds everything after the stop's line; `effectiveFrom` and `policyStatus` both call it, and **the literal `ignoreStop: true` appears exactly once in the tree** — inside `requireMasterDriven` — asserted by the suite, including that no other module mentions `ignoreStop` at all. |
| Review's *"`proposals.cjs` 230 calls `applier(p, opts)`"* and *"`authorise` at 215, the apply handler at 272"* | **Measured in this worktree:** `applier(p, opts)` at **235**, `authorise(opts.user, …)` at **219**, `proposals:apply` at **269**, `proposals:create` at **289**, `registerApplier` at **85**, the id at **117**. So the design's §J.0 corrections were right and the newer citations are not. | Every citation written into the new modules uses the measured number. |
| §E.13 / the review: `capability.can` *"reads only `user.tier` (`capability.cjs` 27–33)"* | **True, with a tighter range:** `can()` spans **27–32**; the unknown-capability refusal is at **30** and the tier comparison at **31**. | Cited as measured. The consequence the design draws from it is correct and is why `masterDriven` is written down as **insufficient** rather than as the guarantee. |
| Part F's *"25 suites"*, and the review's *"18 files match `scripts/verify*.cjs`"* | **Both FALSE.** Measured in this worktree: **17** tracked `scripts/verify*.cjs` before this slice (**19** after), plus **8** `scripts/verify*.mjs` — **25 files in total before, 27 after**, which is probably where "25" came from. The `verify` chain itself invokes **29** scripts (27 before this slice) and **28** of them print a count. | The build note states the real numbers, below, separated by what was counted. |

**One thing the design claimed and source confirmed, worth recording because the whole slice rests on
it:** `shared/autonomy-policy.json` really does ship absent, so the floors really are the shipped
levels, and `verifyLoyaltyTripwire.cjs` hashes only `PROTECTED_FILES` — so adding four modules does not
disturb the tripwire. Both asserted.

---

## 3. SUITE COUNTS, BEFORE AND AFTER

| | Scripts in the `verify` chain | Of those, printing a count | Assertions | Failures |
|---|---|---|---|---|
| **Before** | 27 | 26 | **2518** | 0 |
| **After** | 29 | 28 | **2789** | 0 |

`+147` from `verifyAutonomyStop.cjs` and `+124` from `verifyUpgradeApplier.cjs`. **Both are appended to
the end of the `verify` chain; nothing in it was reordered.** Two scripts were added
(`verify:autonomy`, `verify:applier`) and no existing script was changed. Four residuals print on every
run and are counted out loud rather than hidden.

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
- **`lift()` has never succeeded**, and cannot until master adds `system.suspend-autonomy`. The write
  ordering inside it (allow-file first, stopped-record second) is asserted **on the source text**, not
  by execution.
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
- **`shared/autonomy-policy.json` has never existed on disk.** Every present-file behaviour is proven
  against a fixture resolved through `loadFrom`/`effectiveFrom`, which is deliberate — a module-level
  setter redirecting the live policy would be a hole — but it means the live `load()` path has only ever
  taken its absent branch.

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
six-member `PERMANENT` frozen in `autonomyPolicy.cjs`, with the editable set DERIVED from them.
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
| 152 | The stop, the policy table, and the gate on `proposals:create` — built before there is anything autonomous | done | Section 132. Four new modules (`autonomyStop`, `autonomyPolicy`, `autonomyGate`, `upgradeApplier`), two suites, +271 assertions (2518 → 2789, 0 failed). Fail-safe stop with a second explicit-engage predicate so no shipping timer is halted (I11); six permanent policy classes the data file is not read for; `requireMasterDriven` over a two-class subset so a stopped install still applies what master approved; `proposals:create` fenced at the IPC seam. `node_modules` is absent from the worktree, so `vite build` was NOT run — no `.jsx` changed. NOT VERIFIED: the app has never booted with these modules, `app.getPath('userData')` never resolved, `lift()` never succeeded (needs `system.suspend-autonomy`), `engage()` tears down nothing by design. Next step: the five-stage loop, blocked on design-review findings 2 and 5 — see `docs/research/SELF_UPGRADE.md` § DEFERRED BY THE ORCHESTRATOR. |
```
