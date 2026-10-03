# The stop, the policy table, and the gate on `proposals:create` — fifth build review

Branch `model/self-upgrade-loop`, commits `ea7cfe1..8e49846`, diffed against the branch point on `dev` (`c595342`) with the already-reviewed Phase 0 commit `d949b18` excluded.

The narrowed slice builds three things: a fail-safe stop whose absent configuration means stopped, a fifteen-class policy table with seven classes the data file is never read for, and a validation seam on `proposals:create` plus entry validation in a registered applier. Round 4's HIGH — an NTFS 8.3 short basename defeating the governed-path fence — is closed, and closed by retiring the method rather than adding a fifth transform: `fs.realpathSync.native` now answers which file a path names, at both origins and in the covenant re-run. Round 4's MEDIUM is closed too. I re-derived every one of the five measured defects this pass was told to check hardest, independently and against the shipped default rather than against the suite's framing, and each is closed.

**Watch for:** `autonomyGate.canonicalPath`'s header claims the filesystem call closes "any further FILESYSTEM SYNONYM — a junction, **a hard link's other name**, a case variant". A hard link is the one it does not close, and the suite's own §13 residual says so in precise terms (**confirmed**: `realpathSync.native` reports the two names as different canonical paths, `nlink`/`ino` are not consulted, and a master-approved patch through a hard-link alias rewrote `autonomyStop.cjs` to `function isStopped(){return false;}` and separately rewrote the protected `loyaltyGuard.cjs`). Nothing in the slice can create the link — there is no `linkSync` anywhere in `electron/` or `src/` — so this is a shipped comment that contradicts the build's own disclosed residual on the exact mechanism this round stakes its credibility on, not a live hole. Separately, two shipped modules state the guarantee behind master-driven apply as "the asserted ABSENCE of in-process callers of `proposals.apply`"; there are two such callers and the suite asserts something different and correct (**confirmed**). Ledger row 152 remains stale against its own build for the second round running.

**Verdict**: NEEDS_CHANGES

## High-level view

`canonicalPath` resolves to the nearest existing ancestor, canonicalises the root on the same call because `os.tmpdir()` is itself a short path here, and never throws — so the character route stays as the cheap refusal for a name that is not yet a synonym of anything. Both spellings are compared at both origins and in the step-2 covenant re-run, which is what closes the asymmetry that made round 4's finding live rather than latent: the long name was refused at `origin: 'ipc'` while the short name was waved through.

The regression coverage is real, which I established by mutation rather than by reading. Dropping `canonicalPath` out of `namesGovernedPath` turns 18 assertions red across the §13 generator, naming the short basename, both origins, the applier's step 3, and the governed file's bytes afterwards. The short name is looked up at runtime rather than hardcoded, so `~1` versus `~2` ordering cannot rot the rows.

What the header overstates is the reach. "Ask the filesystem" answers *which path*, not *which file* — and a hard link is a second name for one inode with a genuinely different canonical path. The `(dev, ino)` pair is the identity test that would catch it and `ino` is non-zero on this platform, both measured. The suite records this as an open, UNTESTED residual with the mechanism stated correctly and a reason for not repairing on a guess; the module header says the opposite. One of the two is what a cold session will read first.

On the shipped default — real policy and capability modules, `shared/autonomy-policy.json` genuinely absent, no allow-file — every class resolves to `L0`, `isStopped()` is true, and master's approved apply still succeeds with the bytes landing and the snapshot under `userData`. That is the defect the design shipped twice behind an allow-file fixture, and it is closed at both doors: `requireMasterDriven` throws for any class outside the frozen two-member `MASTER_ACT` subset and throws again for a `MASTER_ACT` class that is not also `PERMANENT`, so the two sets cannot drift apart quietly and the data file has no say over master's own act.

Autonomy is never read from a field. `origin` is a literal written at the call site, `inspectCreate` threw for all ten coercion near-misses, and an `opts` bag carrying `autonomous: true, ignoreStop: true, bypass: true, userDataRoot` changed nothing an apply did. The snapshot directory and the allow-file path are derived; a proposal carrying `meta.rollbackPoint.dir` moved neither and created nothing at the path it named.

The seven permanent classes are mechanically unraisable: every mutator on the exported views is `undefined` rather than refused, each class is rejected by name with the class named, and a file mixing one forbidden raise with two legitimate lowerings lands nothing. A forged `meta.autonomy.appliedBy` no longer survives onto an entry persisted FAILED — the two fields are deleted at entry, above every validation, and both refusal paths confirm it while the derived facts and an innocuous prior field are preserved.

Nothing in the diff touches the pre-existing dispatchers. None of the four references the stop or either predicate, `isHalted` still has no consumer outside the module and its suites, and `statusText()` on a default install names all five behaviours as still running. The ledger's IPC registration degrades to the bare recorder when the gate fails to load, so a broken fence costs no channels.

Ledger row 152 records 320 applier assertions and `2518 → 3035` and says two review rounds were fixed in place. The chain measures 483 and `2518 → 3198`, and there have been four. The row is the document a cold session resumes from, and the correction has now been deferred twice.

<details>
<summary>Issues (3)</summary>

1. **Header claims a hard link is closed; the suite says it is open** — `autonomyGate.canonicalPath`'s header lists "a hard link's other name" among the synonyms the filesystem call closes. Measured false: a patch through a hard-link alias rewrote `autonomyStop.cjs` and the protected `loyaltyGuard.cjs`. Strike the hard link from that sentence and point it at the §13 residual, which already states the mechanism correctly — or close it with the `(dev, ino)` identity comparison (measured available here) and keep the claim.
2. **"Asserted absence of in-process callers of `proposals.apply`" is not what is asserted** — `autonomyStop.MASTER_DRIVEN_ENTRIES[].reason`, which `status()` surfaces to master, and `upgradeApplier`'s step-0 comment both say the guarantee is the absence of in-process callers; there are two (`evolutionEngine.cjs` 137 and `proposals.cjs` 269). Restate both to the property the suite actually checks: every call site sits inside an `ipcMain.handle`, there are exactly two, and a third turns the row red.
3. **Ledger row 152 understates its own build, for the second round** — it records 320 applier assertions, `2518 → 3035`, and two review rounds fixed in place; the chain measures 483, `2518 → 3198`, and four rounds. Replace the row with the corrected text in `docs/research/self-upgrade-build.md` §6 Block B.

</details>

<details>
<summary>Details</summary>

### The spelling series, and whether it is actually over

The four spellings the fence missed in four rounds were unresolved structure, a trailing dot and space, an NTFS `::$DATA` stream suffix, and an 8.3 short basename. All eight spellings of the stop module I tried are now refused at both origins:

```
"electron/lib/autonomyStop.cjs"              ipc=refused  rama=refused
"electron/lib/AUTONO~1.CJS"                  ipc=refused  rama=refused
"electron/lib/autonomyStop.cjs::$DATA"       ipc=refused  rama=refused
"electron/lib/autonomyStop.cjs."             ipc=refused  rama=refused
"electron/lib/autonomyStop.cjs "             ipc=refused  rama=refused
"electron/lib/./autonomyStop.cjs"            ipc=refused  rama=refused
"electron/lib/../lib/autonomyStop.cjs"       ipc=refused  rama=refused
"electron\\lib\\autonomyStop.cjs"            ipc=refused  rama=refused
```

The ungoverned control still passes — `electron/lib/ordinary.cjs`, `src/app.jsx` and an unrelated alias all read `ipc=ALLOWED, governed=null`, so the fence resolves paths rather than refusing odd-looking ones. End to end against a scratch root carrying the real governed files, master-approved, `baseSha256` read through the spelling:

```
electron/lib/autonomyStop.cjs   via electron/lib/AUTONO~1.CJS
  canonicalPath      : "electron/lib/autonomystop.cjs"
  namesGovernedPath  : "electron/lib/autonomystop.cjs"
  create gate ipc    : refused
  apply              : refused at step 3
  *** GOVERNED BYTES CHANGED: false
```

Identical for `autonomyPolicy.cjs` via `AUTONO~2.CJS` and `shared/loyalty-tripwire.json` via `LOYALT~1.JSO`. The protected `loyaltyGuard.cjs` via `LOYALT~1.CJS` is not a `SELF_GOVERNING_PATH`, so step 3 does not see it and step 2's covenant re-run is the only thing in its way — it refuses, reporting the spelling master wrote rather than the canonical form it compared, which is the right string to show him.

The hard link is where the method's reach stops. `realpathSync.native` resolves a path to its canonical *path*; two names for one inode are two canonical paths:

```
autonomyStop.cjs  nlink=2 dev=248412091 ino=1407374884372969
alias.cjs         nlink=2 dev=248412091 ino=1407374884372969
same (dev,ino)?   true          <- the identity test that WOULD catch it
realpathSync.native agrees they are one file?  false
isSymbolicLink()? false         (so the existing symlink refusal does not see it)

apply through electron/lib/alias.cjs: APPLIED
  *** autonomyStop.cjs BYTES CHANGED: true
  now reads: "function isStopped(){return false;}\n"

apply through electron/lib/helper.cjs (alias of the PROTECTED loyaltyGuard.cjs): APPLIED
  *** loyaltyGuard.cjs BYTES CHANGED: true
```

The `baseSha256` drift check passes for the same reason it passed for the stream suffix — the alias reads the real file's bytes. Reachability is the mitigating half and it is strong: `git grep` over `electron/`, `src/` and `scripts/` finds no `fs.linkSync` or `symlinkSync` outside `buildInstaller.cjs`'s tmpdir privilege probe and the applier suite's own symlink fixture, so creating the link needs a write inside the repository root, which is the thing every other gate here governs. On top of that, Rāma's own route cannot reach it even with an allow-file present: `classFor` sends a diff-bearing filing to `propose-source`, whose floor is `L1` against a needed `L3`, so `fileProposal` refuses for the policy rather than for the stop.

So this is not a live hole, and I am not asking for the check. I am asking for the sentence. §13's residual already states it exactly right — "a HARD LINK is the one it will not… `nlink` is not consulted and the case is UNTESTED… recorded as an open residual rather than repaired on a guess, because four rounds of enumerating spellings is what retired the character method" — and the module header four files away says the filesystem call closes it. The header is what a session reads before deciding whether a check is needed, and it currently says no.

### The guarantee that is stated as an absence

`MASTER_DRIVEN_ENTRIES[0].reason` is declared data, returned by `status()`, and it reads in part: *"'Rāma does not start an apply' is held by the asserted absence of in-process callers of proposals.apply"*. `upgradeApplier`'s step-0 comment makes the same claim. There are two in-process callers:

```
electron/ipc/evolutionEngine.cjs:137   const res = await proposals.apply(proposalId, { repoPath, user });
electron/lib/proposals.cjs:269         ipcMain.handle('proposals:apply', async (_e, id, opts) => apply(id, opts || {}));
```

The suite does not claim they are absent. It scans `electron/`, `electron/lib` and `electron/ipc`, collects every `proposals|ledger|proposalLedger.apply(` site, and asserts that *every one sits inside an `ipcMain.handle`* — "none is reached from a timer or a loop" — plus that there are exactly two, "so a third demands a review". That is the correct property, and it goes red both if a timer-driven caller appears and if the count moves. The prose describes a stronger and false version of it. Given that `status()` is the surface master reads, the fix is to make the data say what the suite checks.

`lift()` is the genuine absence and is asserted as one: zero in-process callers, and no module passes a capability override.

### The shipped-install refusal, re-derived without a fixture

This is the defect a fixture hid twice, so it was run against the shipped default rather than read:

```
shared/autonomy-policy.json on the install? false
allow-file present?                         false
isStopped()                               = true
effective(apply-source)                   = L0
effective(revert-own-apply)               = L0
master apply on shipped default: SUCCEEDED
  bytes now                 : "C\n"
  snapshotDir under userData? true
  verification              : not-run
```

Both `MASTER_ACT` classes resolve, `apply-source` first, so the class whose description is this act is the class consulted. The data-file door to the same refusal is shut: `{"revert-own-apply":"L0"}` is rejected whole as a permanent class rather than landing, and `masterDrivenFence` handed a divergent pair returns the real `Error` over the real code.

### Autonomy is derived, and the forged field no longer survives

Three `opts` shapes, same outcome, derived values winning over everything the caller claimed — the kitchen-sink bag carried `autonomous: true, origin: 'rama', masterDriven: false, ignoreStop: true, bypass: true, userDataRoot: 'C:/evil'`:

```
omitted         : applied masterDriven=true autonomousApply=false flagFromOpts=false
autonomous:true : applied masterDriven=true autonomousApply=false flagFromOpts=true
kitchen sink    : applied masterDriven=true autonomousApply=false flagFromOpts=true
```

A tier-1 user and a missing user are both refused with the I6 message and the bytes unchanged. `meta.rollbackPoint.dir` was not honoured, the derived path under `userData` was, and the directory the proposal named was never created. Round 4's forged-`appliedBy` finding is closed by two deletes at entry, above every validation, and both refusal paths confirm it:

```
refused at step 4 (delete)   -> appliedBy survived? false   appliedAt survived? false
refused at step 3 (governed) -> appliedBy survived? false   appliedAt survived? false
  persisted: {"autonomousApply":false,"note":"forged","attemptedBy":"master",
              "flagFromOpts":false,"attemptedAt":"..."}
```

The success path below the write loop is the only writer of either field.

`opts.user` remains the one renderer-supplied input that decides anything, and the step-0 comment states precisely why this build cannot close it — `proposals.cjs` 269 hands the IPC request's own `opts` to `apply()`, which authorises `opts.user` at 219 — and binds the fix to master's list rather than claiming coverage.

### The pre-existing dispatchers

```
electron/lib/refreshScheduler.cjs  runNow               refsStop=false refsIsStopped=false refsIsHalted=false
electron/ipc/metaCognition.cjs     auditTimer           refsStop=false refsIsStopped=false refsIsHalted=false
electron/ipc/selfCare.cjs          runHealthSweep       refsStop=false refsIsStopped=false refsIsHalted=false
electron/ipc/marketIntel.cjs       tickResolveOutcomes  refsStop=false refsIsStopped=false refsIsHalted=false
```

Every cited symbol still exists in its file. `isHalted` appears only in `autonomyStop.cjs` and the two suites, so `engage()` tears nothing down, and `statusText()` on a default install says so in words: *"Still running on their own schedule, exactly as before: ollama-catalog, dependency-review and every other registered refresh task; the 10-minute metacognition audit; the 120-second health sweep, including checkInstanceFailover; outcome resolution and news sync."* I11 is intact.

The IPC seam wraps `proposals:create` alone. `proposals:apply`, `:list` and `:authorise` reach the ledger unchanged, the kind fence refuses `self-upgrade` and `self-upgrade-question` from outside while `self-modify`, `GENOME` and `dependency` pass as before, and the wrapper forwards the listener methods the host actually has.

### What the assertions assert

Behaviour, and I tested that claim rather than accepting it. Dropping the filesystem half of the fence out of `namesGovernedPath` produces `465 passed, 18 failed`, naming the short basename at both origins, the applier's step 3, and `and shared/autonomy-policy.json is BYTE-IDENTICAL on disk afterwards` — so the row that would have caught round 4's finding exists, asserts bytes, and is red when the fix is absent. The file was restored and the suite is back to 483/0.

33 of 297 `check()` sites take a source property as their subject, each with a stated reason: the stop's module-scope dependency list, the write orderings in `engage`/`lift`, the no-override scan, the `main.cjs` wiring and its registration ordering (not executable without Electron), and the two rows asserting that the comparison rests on `realpathSync.native` and never on the plain call. Where a behavioural sibling is possible it sits beside the source row rather than being replaced by it; the symlink row degrades to a printed residual when a symlink cannot be created.

**Not covered:** no row creates a hard link, so the §13 generator would not catch the case the residual discloses — which is consistent with the residual calling it UNTESTED, not a contradiction.

### What was run, and what could not be

`node --check` clean on all five `.cjs` touched plus both suites. `verifyAutonomyStop.cjs` 197/0 with one residual; `verifyUpgradeApplier.cjs` 483/0 with seven. `npm run verify` **3198 passed, 0 failed** across 28 scripts — which matches neither ledger row 152 nor the prior round's 3148. `verifyInvariants.cjs` ALL PASS and `verifyLoyaltyTripwire.cjs` 12/0 ALL PASS before and after every probe and after the mutation test, so no protected file changed and `--approve` was never run. The worktree is clean, `shared/autonomy-policy.json` is still absent, and every probe wrote to a scratch repository root and a scratch `userData` under `%TEMP%`.

I6 and I17 are intact: every write in every probe required a recorded tier-0 approval, `L5` exists only as the refused constant and the deferred entry point's citation, `apply-source` is pinned `FLOOR === CEILING === L4`, and `release-classify` is `L0` and permanent. No autonomy rung was climbed.

No `console.log` in the four shipped modules, no `TODO`/`FIXME`, no dependency added and no version range loosened — `package.json` gains two suites on the `verify` chain and two aliases, nothing else. The diff touches only the four new `electron/lib` modules, `main.cjs`, `package.json`, the two new suites, one ledger row and `docs/research/`; nothing out of scope.

`node_modules` is absent from this worktree, so `npx vite build` genuinely cannot run here; no `.jsx` changed, so there is nothing for it to check. The app has never booted with these modules loaded and `app.getPath('userData')` has never been resolved — every assertion and every probe injects a scratch root.

</details>

<details>
<summary>File map</summary>

| file | what changed |
| --- | --- |
| `electron/lib/autonomyStop.cjs` | new — fail-safe `isStopped()`, explicit `isHalted()`, `engage`/`lift`, declared coverage tables |
| `electron/lib/autonomyPolicy.cjs` | new — fifteen classes over frozen floors and ceilings, seven permanent, the `MASTER_ACT` door |
| `electron/lib/autonomyGate.cjs` | new — the create fence, `canonicalPath` via `realpathSync.native`, the IPC seam |
| `electron/lib/upgradeApplier.cjs` | new — `spellingRefusal`, `canonicalPathOf`, entry validation, writability probe, byte snapshot, revert, retention |
| `electron/main.cjs` | +15 — gate and applier wired in behind `isStub`, ledger registration wrapped |
| `package.json` | +4 — two suites appended to the `verify` chain, two aliases; no dependency change |
| `RAMA_AGI_MASTER_SPEC.md` | +1 — ledger row 152, stale against its own build |
| `docs/research/*` | the design document, the build note, and the prior review rounds |
| `scripts/verifyAutonomyStop.cjs` | new — 197 assertions |
| `scripts/verifyUpgradeApplier.cjs` | new — 483 assertions, §13 now generates real short basenames at runtime |

Full diff: `git diff d949b18..8e49846`

</details>
