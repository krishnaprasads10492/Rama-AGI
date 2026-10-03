# The stop, the policy table, and the gate on `proposals:create` — third build review

Branch `model/self-upgrade-loop`, commits `ea7cfe1..518a759`, diffed against the branch point on `dev` with the already-reviewed Phase 0 commit `d949b18` excluded.

The narrowed slice builds the three things that must exist before anything is autonomous: a fail-safe stop whose absent configuration means stopped, a fifteen-class policy table with seven classes the data file is never read for, and a validation seam on `proposals:create` plus entry validation in a registered applier. Each of the four measured defects this pass was told to check hardest is closed, and I re-derived every one independently rather than reading the suite's own framing — on a shipped install with no allow-file and no `shared/autonomy-policy.json` a master-approved apply succeeds and the bytes land, nothing renderer-supplied decides whether an action is autonomous, the snapshot directory and allow-file path are derived and unaffected by anything a proposal carries, and the four pre-existing dispatchers behind five shipping behaviours are untouched. One new defect: the governed-path fence canonicalises separators, structure, case, and trailing dots and spaces, but not an NTFS stream suffix — the third spelling in three rounds that this fence has failed to canonicalise, and the first whose bytes do not survive.

**Watch for:** `electron/lib/autonomyStop.cjs::$DATA` is a synonym for the primary data stream on NTFS and `namesGovernedPath` answers "names nothing governed" for it, so a master-approved `self-upgrade` patch spelled that way overwrote the stop module's real bytes with `function isStopped(){return false;}`, and the same spelling replaced `shared/loyalty-tripwire.json` (**confirmed**, reproduced end to end on this platform). I6 holds throughout — the apply still needs master's recorded approval — the create fence refuses this design's kinds from the renderer, and nothing in the shipped tree constructs such a change, so this is a latent hole in the fence rather than a live write path.

**Verdict**: NEEDS_CHANGES

## High-level view

The fence resolves paths before it compares them, which is what the previous two rounds fixed, and it now also trims a trailing dot or space per segment. What it does not do is reject a path that addresses a stream rather than a file, and that is not an adjacent name the way `autonomyStop.cjs.` was — it is the governed file under a name the fence reports as ungoverned. The read side cooperates: `baseSha256` computed through the spelling matches the real file, so the base-drift check passes rather than catching it.

On the shipped default — real policy module, real capability module, no allow-file, `shared/autonomy-policy.json` genuinely absent — every class resolves to `L0` and master's approved apply still succeeds. `requireMasterDriven` is the one door that ignores the stop; it throws for any class outside the frozen two-member `MASTER_ACT` subset, and throws again for a `MASTER_ACT` class that is not also `PERMANENT`, so the two sets cannot drift apart quietly and the data file has no say over master's own act.

Autonomy is never read from a field. `origin` is a literal written at the call site inside the main process and `inspectCreate` throws for everything else, including the coercion near-misses; `opts.autonomous` appears in one expression, as a recorded datum. The one renderer-supplied input that still decides anything is `opts.user`, which arrives with the `proposals:apply` IPC request — a pre-existing hole in a protected file, conceded in the applier's own step-0 comment rather than papered over.

`PERMANENT` and `MASTER_ACT` are membership views with no mutator and the backing `Set` unreachable, which closes round two's `Object.freeze`-on-a-`Set` finding properly; an explicit seven-id expectation list goes red if a class is moved out of the permanent set, and `EDITABLE` is derived from it rather than restated.

Nothing in the diff touches `refreshScheduler`, `metaCognition`, `selfCare`, `marketIntel` or `agentOrchestrator`, none of them references the stop, and `isHalted()` is false on a default install with no production consumer — which the module header states in those words. The ledger's IPC registration degrades to the bare recorder when the gate fails to load, and the applier registration is skipped rather than throwing, so a broken fence costs no channels.

<details>
<summary>Issues (1)</summary>

1. **NTFS stream spelling defeats the governed-path fence** — `namesGovernedPath('electron/lib/autonomyStop.cjs::$DATA')` returns `null`, and a master-approved `self-upgrade` patch spelled that way overwrites the stop module's primary stream (measured; `shared/loyalty-tripwire.json` and `electron/lib/loyaltyGuard.cjs` likewise). Refuse any change path containing a stream separator or a control character in `upgradeApplier.validatePath`, strip the suffix in `autonomyGate.normalise` so the fence names it, and add the spellings to the `variants()` generator in `verifyUpgradeApplier.cjs` §13 with the governed file's bytes asserted intact.

</details>

<details>
<summary>Details</summary>

### The stop is reachable through a stream spelling

`normalise` swaps separators, resolves `.`, `..` and repeated separators through `path.posix.normalize`, trims trailing dots and spaces per segment, and lowercases. It does not touch a stream suffix, and `validatePath` does not refuse one either: `path.resolve` keeps `::$DATA`, the result is still under the repository root, and `lstatSync` reports a regular file because on NTFS that name *is* the file.

Measured against a scratch repository fixture with the real policy, capability and `loyaltyGuard` modules:

```
suffix "::$DATA"  read==primary:true    write:true    PRIMARY STREAM CLOBBERED: true
suffix ":evil"    read==primary:ENOENT  write:true    PRIMARY STREAM CLOBBERED: false
suffix "\t"       read==primary:ENOENT  write:ENOENT  PRIMARY STREAM CLOBBERED: false
suffix "."        read==primary:ENOENT  write:true    PRIMARY STREAM CLOBBERED: false

"electron/lib/autonomyStop.cjs::$DATA"  -> NULL — NOT GOVERNED
"electron/lib/autonomyStop.cjs."        -> electron/lib/autonomystop.cjs
```

End to end with `action: 'patch'` and a `baseSha256` read through the spelling:

```
baseSha256 read through the spelling: 1be411e39ae5...
create gate @ipc: refused — "self-upgrade" is filed by Rāma's loop, not by a caller
applier: APPLIED
PRIMARY STREAM OF THE GOVERNED FILE CLOBBERED: true
primary now = "function isStopped(){return false;}\n"
```

The same spelling replaced `shared/loyalty-tripwire.json` with `{"approved":"everything"}`, which is the tamper-evidence baseline the loyalty tripwire compares against.

Two things bound it. The create fence refuses this design's kinds at origin `ipc`, so a renderer cannot file one; `fileProposal` has no caller and the five-stage authoring loop is deferred, so nothing in the shipped tree constructs such a change. And I6 is untouched — the apply still requires master's recorded approval. But "unreachable by any proposal" is the first of the three things this slice exists to establish, and for the slice's own kind it is false.

One observation that belongs with the fix rather than in the finding count: the same spelling carried a patch of `electron/lib/loyaltyGuard.cjs` through the applier's step 2, with `guard.inspectChanges` returning `{ok: true, refused: []}`. `loyaltyGuard` is a protected file this slice cannot change and `proposals.create` already feeds it unnormalised paths, so the guard's blind spot is pre-existing and reachable through the shipped `self-modify` kind. What is new is that step 2 is presented as the loyalty covenant re-run rather than trusted, and for this spelling it refuses nothing. Refusing the spelling class at `validatePath` closes both at the new seam.

The trailing-tab spelling has no impact today — the write fails `ENOENT` before anything is clobbered, and a patch is refused earlier as "does not exist" — but it is the same canonicalisation gap, so a fix that refuses control characters alongside the stream separator covers it without needing its own row.

### The shipped-install refusal, re-derived without a fixture

This is the defect a fixture hid twice, so I ran it against the shipped default rather than reading the suite. `shared/autonomy-policy.json` confirmed absent on disk, a scratch `userData` holding no allow-file, no faked policy or capability module:

```
shared/autonomy-policy.json exists? false
isStopped() = true
effective(apply-source) = L0
master apply threw: null
bytes on disk: "B\n"
snapshotDir derived? true
verification field = not-run
```

The applier resolves both `MASTER_ACT` classes, `apply-source` first, and either one resolving below `L4` refuses the apply with the class named — so the class whose description is this act is now the class consulted, which it was not before. A data file lowering `revert-own-apply` to `L0` is rejected whole rather than landing, closing the second door to the same refusal.

### Autonomy is derived, never read

`inspectCreate` throws for every origin that is not the literal `'ipc'` or `'rama'`:

```
origin=undefined -> threw     origin="RAMA"     -> threw
origin=null      -> threw     origin="rama "    -> threw
origin=""        -> threw     origin=["rama"]   -> threw
origin=0         -> threw     origin={toString} -> threw
```

An `opts` bag stuffed with `autonomous: true, origin: 'rama', masterDriven: false, ignoreStop: true, bypass: true, policy: null, stop: null` changed nothing: the apply succeeded as master's act, reported `masterDriven: true` and recorded `autonomousApply: false`. An apply carrying `autonomous: true` and one omitting the field produce identical results. A tier-1 user is refused with the I6 message. For `opts.user` the step-0 comment states precisely why the applier cannot close it — `proposals.cjs` 269 passes the IPC request's own `opts` to `apply()`, which authorises `opts.user` at 219 — and binds the fix to master's list instead of claiming coverage.

### Derived locations, and an id that cannot traverse

A proposal carrying `meta.rollbackPoint.dir`, `meta.snapshotDir` and `meta.weighing.blastRadius.rollbackPoint.dir` all pointed at the stop's own state directory still snapshotted to the derived path, and the allow-file was byte-identical afterwards. The id is validated against `^[0-9a-f]{20}$` before any path is built, so `../../..`, `aaaa…/../..` and an uppercase-hex id are all refused with "malformed proposal id". `configure()` accepts only `userDataRoot` and silently drops an `allowFile` or `stateDir` key, so the file names stay frozen and a caller cannot redirect `isStopped()` at a file it controls.

### The frozen sets, and the fence between them

Every mutation attempt on the exported views throws, with size and membership unchanged after each:

```
PERMANENT.delete   -> TypeError: policy.PERMANENT.delete is not a function
PERMANENT.add      -> TypeError: policy.PERMANENT.add is not a function
MASTER_ACT.add     -> TypeError: policy.MASTER_ACT.add is not a function
defineProperty has -> TypeError: Cannot redefine property: has
assign has         -> TypeError: Cannot assign to read only property 'has'
values().clear     -> TypeError: ...values(...).clear is not a function
```

All seven permanent classes are pinned `FLOOR === CEILING`, every one is rejected by `validate` with the class named, a file mixing one forbidden raise with four legitimate lowerings lands nothing, and `MASTER-RECORD` and `" master-record"` are both rejected as unknown ids rather than slipping through a case or whitespace variant. The divergence fence is a pure exported function and executes: handed a `permanent` whose `has` always returns false, `masterDrivenFence('apply-source', …)` returns the real `Error`. The requirement that an assertion go red if a permanent class is moved into the editable set is met by an explicit seven-id expectation list checked against the view's size and membership.

### What the assertions assert

Behaviour, with a declared set of exceptions. Nineteen refusal cases each assert the message *and* that the target file's bytes are unchanged; the write-failure revert and the fatal-revert path are both executed; the retention bounds are exercised; `lift()`'s success path now runs with the capability module injected instead of being read by regex over its own source.

The source-text assertions that remain have a source property as their subject: the stop's module-scope dependency list, the absence of in-process callers of `lift` and `proposals.apply`, the single consumer of `ignoreStop`, the `main.cjs` wiring (not executable without Electron), and the `appliedBy`-below-the-write-loop ordering. Two duplicate rows that now also execute — `lift()`'s empty-note refusal and `path.posix.normalize`'s presence. One, `/NOTHING CALLS IT YET/.test(stopSrc)`, asserts only that a disclosure sentence is present; the behavioural "no consumers anywhere" scan sits two rows above it.

### What was run, and what could not be

`node --check` clean on all five `.cjs` touched plus both suites. `verifyAutonomyStop.cjs` 197/0 with one residual printed; `verifyUpgradeApplier.cjs` 320/0 with five. `npm run verify` 3035 passed, 0 failed across 28 scripts — 2518 before this slice, so the arithmetic in the commit message and in ledger row 152 both check out. `verifyInvariants.cjs` ALL PASS and `verifyLoyaltyTripwire.cjs` 12/0 ALL PASS, so no protected file changed and `--approve` was not run. No `console.log` outside the two suites, no `TODO`/`FIXME`, no dependency added, nothing out of scope in the diff.

`node_modules` is absent from the worktree, so `npx vite build` genuinely cannot run here; no `.jsx` changed, so there is nothing for it to check. The app has never booted with these modules loaded and `app.getPath('userData')` has never been resolved — every assertion and every probe injects a scratch root.

</details>

<details>
<summary>File map</summary>

| file | what changed |
| --- | --- |
| `electron/lib/autonomyStop.cjs` | new — fail-safe `isStopped()`, explicit `isHalted()`, `engage`/`lift`, declared coverage tables |
| `electron/lib/autonomyPolicy.cjs` | new — fifteen classes over frozen floors and ceilings, seven permanent, the `MASTER_ACT` door |
| `electron/lib/autonomyGate.cjs` | new — the create fence, path canonicalisation, the IPC validation seam |
| `electron/lib/upgradeApplier.cjs` | new — entry validation, writability probe, byte snapshot, revert, retention |
| `electron/main.cjs` | +15 — gate and applier wired in behind `isStub`, ledger registration wrapped |
| `package.json` | +4 — two suites appended to the `verify` chain, two aliases; no dependency change |
| `RAMA_AGI_MASTER_SPEC.md` | +1 — ledger row 152 |
| `docs/research/*` | the design document, the build note, and the two prior review rounds |
| `scripts/verifyAutonomyStop.cjs` | new — 197 assertions |
| `scripts/verifyUpgradeApplier.cjs` | new — 320 assertions |

Full diff: `git diff d949b18..518a759`

</details>
