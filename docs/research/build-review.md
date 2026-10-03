# The stop, the policy table, and the gate on `proposals:create` — fourth build review

Branch `model/self-upgrade-loop`, commits `ea7cfe1..4b63dbf`, diffed against the branch point on `dev` (`c595342`) with the already-reviewed Phase 0 commit `d949b18` excluded.

The narrowed slice builds three things: a fail-safe stop whose absent configuration means stopped, a fifteen-class policy table with seven classes the data file is never read for, and a validation seam on `proposals:create` plus entry validation in a registered applier. Round 3's single HIGH — an NTFS alternate-data-stream suffix defeating the governed-path fence — is closed, in both places the finding asked for and a third it did not. Every one of the five measured defects this pass was told to check hardest is closed, and I re-derived each independently against the shipped default rather than reading the suite's framing. But the spelling class itself is not closed: **an 8.3 short basename is a fourth synonym the fence does not canonicalise, and the governed bytes do not survive it either.**

**Watch for:** `electron/lib/AUTONO~1.CJS` is the NTFS short name for `autonomyStop.cjs`. `namesGovernedPath` returns `null`, `spellingRefusal` returns `null`, `readFileSync` through it returns the real file's bytes so the `baseSha256` drift check passes, and a master-approved `self-upgrade` patch applied and left the stop module reading `function isStopped(){return false;}` (**confirmed**, reproduced end to end on this machine; the same spelling clobbered `autonomyPolicy.cjs`, the protected `loyaltyGuard.cjs` and `shared/loyalty-tripwire.json`). Unlike round 3's finding this one also defeats the **renderer-side** create fence: at `origin: 'ipc'` a `self-modify` create naming `electron/lib/AUTONO~1.CJS` is allowed where the long name is refused, and `electron/ipc/timeline.cjs`'s pre-existing SELF_MODIFY applier writes `changes[].path` verbatim. I6 still holds throughout — every write needed master's recorded approval — but "the stop is unreachable by any proposal" remains false. Separately, a caller-supplied `meta.autonomy.appliedBy: 'master'` survives the entry merge onto an entry that is then persisted FAILED (**confirmed**) — the badge-label defect the code's own comment claims to have fixed.

**Verdict**: NEEDS_CHANGES

## High-level view

`spellingRefusal` refuses before anything resolves and before the snapshot is taken, so the fatal revert path — whose own failure revokes master's allow-file — is never entered for the spelling class. The colon strip is deliberately kept out of `normalise`, which is also applied to the stringified `meta` blob: I measured that folding it in turns `{"plan":"then patch electron/lib/x.cjs"}` into `{"plan"/lib/x.cjs"}` and loses the `electron/` segment, so the separation is load-bearing rather than stylistic, and two rows assert both halves.

What the fix does not change is the approach. Three rounds have each added a string transform for the spelling the previous round missed, and a fourth exists that no string transform can see, because the short name shares no characters with the long one. `fs.realpathSync.native` resolves both `AUTONO~1.CJS` and `autonomyStop.cjs::$DATA` to the canonical long path on this platform — measured — so the fence can ask the filesystem what file a path names instead of inferring it from the characters. That is the fix that ends the series.

On the shipped default — real policy module, real capability module, no allow-file, `shared/autonomy-policy.json` genuinely absent on disk — every class resolves to `L0`, `isStopped()` is true, and master's approved apply still succeeds with the bytes landing. `requireMasterDriven` is the one door that ignores the stop; it throws for any class outside the frozen two-member `MASTER_ACT` subset and throws again for a `MASTER_ACT` class that is not also `PERMANENT`, so the two sets cannot drift apart quietly and the data file has no say over master's own act.

Autonomy is never read from a field. `origin` is a literal written at the call site inside the main process and `inspectCreate` throws for all eight coercion near-misses I tried; an `opts` bag stuffed with `autonomous: true, origin: 'rama', ignoreStop: true, bypass: true, userDataRoot` changed nothing, and an apply carrying `autonomous: true` is indistinguishable in outcome from one omitting the field. The snapshot directory and the allow-file path are derived; a proposal carrying `meta.rollbackPoint.dir` cannot move either.

`PERMANENT` and `MASTER_ACT` are membership views with no mutator and the backing `Set` unreachable. All seven permanent classes are rejected by `validate` with the class named, a file mixing one forbidden raise with two legitimate lowerings lands nothing, and the divergence fence is a pure exported function that returns the real `Error` when handed a divergent pair.

Nothing in the diff touches `refreshScheduler`, `metaCognition`, `selfCare`, `marketIntel` or `agentOrchestrator`; none of them references the stop or either predicate, `isHalted` has no consumer outside the module and its two suites, and `statusText()` on a default install names all five behaviours as still running. The ledger's IPC registration degrades to the bare recorder when the gate fails to load and the applier registration is skipped rather than throwing, so a broken fence costs no channels.

Ledger row 152 in `RAMA_AGI_MASTER_SPEC.md` is stale against its own build: it records 320 applier assertions and `2518 → 3035`, where the chain now runs 433 and `2518 → 3148`. The commit message raises this rather than hiding it and parks the corrected row in the build note, but the ledger is the document a cold session resumes from.

<details>
<summary>Issues (3)</summary>

1. **8.3 short basename defeats the governed-path fence** — `electron/lib/AUTONO~1.CJS` reads as naming nothing governed, passes `spellingRefusal`, reads the real file's bytes so the `baseSha256` drift check passes, and a master-approved patch overwrote `autonomyStop.cjs`, `autonomyPolicy.cjs`, the protected `loyaltyGuard.cjs` and `shared/loyalty-tripwire.json`. Replace the string canonicalisation with `fs.realpathSync.native` on the resolved target (measured: it resolves both the short name and the `::$DATA` suffix to the canonical long path), compare *that* against the governed set, and refuse any path whose resolved target cannot be canonicalised.
2. **Forged `meta.autonomy.appliedBy` survives onto a FAILED entry** — the entry merge spreads caller-supplied `meta.autonomy` and only overwrites four keys, so `{appliedBy: 'master', appliedAt: '...'}` persists on an entry refused at the door. Build the object from a whitelist, or delete `appliedBy`/`appliedAt` in the merge, so only the success path can set them.
3. **Ledger row 152 understates its own build** — it records 320 applier assertions and `2518 → 3035`; the chain measures 433 and `2518 → 3148`. Replace the row with the corrected text already prepared in `docs/research/self-upgrade-build.md` §6 Block B.

</details>

<details>
<summary>Details</summary>

### A fourth spelling, and why there will be a fifth

The short name is not a respelling in the sense the previous three were. `autonomyStop.cjs.`, `autonomyStop.cjs ` and `autonomyStop.cjs::$DATA` all *contain* the governed name, so a transform over the characters can recover it. `AUTONO~1.CJS` shares a six-character prefix and nothing else. 8.3 generation is live on this volume for the real worktree, not only the scratch fixture:

```
AUTONO~3.CJS autonomyGate.cjs
AUTONO~2.CJS autonomyPolicy.cjs
AUTONO~1.CJS autonomyStop.cjs
LOYALT~1.CJS loyaltyGuard.cjs
LOYALT~1.JSO loyalty-tripwire.json
```

End to end, in a scratch repository root with the real policy, capability and `loyaltyGuard` modules, master-approved, `action: 'patch'`, `baseSha256` read through the spelling:

```
electron/lib/autonomyStop.cjs   via electron/lib/AUTONO~1.CJS
  reads real bytes  : true   (so the baseSha256 drift check PASSES)
  namesGovernedPath : null
  spellingRefusal   : null
  loyaltyGuard raw=[] canonical=[]
  create gate: ipc=ALLOWED rama=refused
  apply             : APPLIED
  *** GOVERNED BYTES CHANGED: true
  now reads: "function isStopped(){return false;}\n"
```

Identical results for `autonomyPolicy.cjs` via `AUTONO~2.CJS`, `loyaltyGuard.cjs` via `LOYALT~1.CJS`, and `shared/loyalty-tripwire.json` via `LOYALT~1.JSO`. The step-2 covenant re-run refuses nothing for the protected file, with or without the new `gate.normalisePath` canonicalisation — `loyaltyGuard.normalise` has no way to see this either.

The `rama=refused` column is the stop doing its job: on a default install `isStopped()` is true, so `inspectCreate` refuses before it reaches the path fence. That is a refusal for a different reason, and it evaporates the moment master writes an allow-file.

`ipc=ALLOWED` is the part that distinguishes this from round 3. The long name is refused at `origin: 'ipc'` for every kind — that is the fence this slice built, and it works. The short name is not, which makes the renderer route live rather than latent: a tier-1 `proposals:create` with `kind: 'self-modify'` and `path: 'electron/lib/AUTONO~1.CJS'` passes the new fence, and `electron/ipc/timeline.cjs` registers a SELF_MODIFY applier that writes `change.path` verbatim with no root confinement:

```js
fs.mkdirSync(path.dirname(change.path), { recursive: true });
fs.writeFileSync(change.path, change.content, 'utf8');
```

That applier is pre-existing and the design's own header names it as an unclosed residual, so the write primitive is not this slice's defect. What is this slice's is that its fence refuses the long name and waves the short one through, and that master reviewing a diff containing `AUTONO~1.CJS` is being shown a name that does not say what it addresses.

I6 is intact in every case — each write required master's recorded approval, `proposals.apply` has no in-process caller, and `fileProposal` has no caller at all. No autonomy rung was climbed. But in-scope item 1 is "the STOP, unreachable by any proposal", and for this spelling it is not.

The fix is a change of method rather than another transform. Measured on this platform:

```
realpathSync        AUTONO~1.CJS        -> ...\electron\lib\AUTONO~1.CJS      (unchanged)
realpathSync.native AUTONO~1.CJS        -> ...\electron\lib\autonomyStop.cjs
realpathSync.native autonomyStop.cjs::$DATA -> ...\electron\lib\autonomyStop.cjs
```

`realpathSync` is useless here; `realpathSync.native` resolves both the short name and the stream suffix to one canonical path, because it asks the filesystem rather than the characters. Canonicalising the resolved target that way and comparing *that* against `SELF_GOVERNING_PATHS` closes all four spellings at once and any fifth that is a filesystem synonym. Two residuals to state with the fix rather than after it: `realpathSync.native` throws for a path that does not exist yet, so a `create` needs the nearest existing ancestor canonicalised and the remainder appended, which is the shape `writabilityOf` already uses; and it cannot canonicalise a name that is not yet a synonym, so `spellingRefusal` should stay as the cheap refusal it is rather than being replaced.

The suite's §13 generator is the right place for the rows and already has the right shape — ten spellings × four governed paths × every gate, with a fourth element declaring what the ungoverned control expects, and a byte-identity assertion on every row. It mentions neither `~1` nor `realpath`. A row per governed path via its short basename, with the bytes asserted intact, is what would have caught this; the short name has to be looked up at runtime rather than hardcoded, because `~1` versus `~2` depends on directory creation order.

### A refused entry that says master applied it

Round 2 moved `appliedBy` to the success path for a stated reason: an entry refused at the door is persisted FAILED by `proposals.cjs`, and must not carry a field claiming master applied it. The entry record is built by spreading the caller's own `meta.autonomy` and then overwriting four keys — `attemptedBy`, `autonomousApply`, `flagFromOpts`, `attemptedAt`. `appliedBy` and `appliedAt` are not among them, so they survive:

```
proposal.meta.autonomy = { appliedBy: 'master', appliedAt: '2020-01-01T00:00:00.000Z',
                           autonomousApply: true, note: 'forged' }

refused -> action "delete" is refused — only patch and create are applied
persisted on the FAILED entry:
  { "appliedBy": "master", "appliedAt": "2020-01-01T00:00:00.000Z",
    "autonomousApply": false, "note": "forged",
    "attemptedBy": "master", "flagFromOpts": false, "attemptedAt": "2026-10-03T08:54:14.549Z" }
  appliedBy survived? true
```

Same result for a refusal at step 3, the governed-path fence. `autonomousApply` is correctly forced to `false`, which is the field the forward-compatibility argument rests on, so this is an audit-trail defect and not an authorisation one: no byte was written and I6 held. It matters because the audit trail of the one component that writes source is how master reconstructs what happened, and "FAILED, and `appliedBy: master`" is the same contradiction as a badge reading paused over running work.

The live route is an in-process `proposals.create()` or a `restore()` rehydrating a crafted on-disk entry — the create fence refuses this design's kinds from IPC, so the renderer cannot seed it directly. Both of those are disclosed residuals rather than new holes. A whitelist build, or two `delete`s in the merge, confines the claim to the success path that already sets it.

### The shipped-install refusal, re-derived without a fixture

This is the defect a fixture hid twice, so I ran it against the shipped default rather than reading the suite. `shared/autonomy-policy.json` confirmed absent on disk, a scratch `userData` with no allow-file, real policy and real capability modules:

```
shared/autonomy-policy.json on disk? false
allow-file present?                  false
isStopped()                        = true
effective(apply-source)            = L0
effective(revert-own-apply)        = L0
master apply on shipped default: SUCCEEDED
  bytes on disk now: "C\n"
  snapshotDir derived under userData? true
  verification field: not-run
```

The applier resolves both `MASTER_ACT` classes, `apply-source` first, and either one resolving below `L4` refuses with the class named — so the class whose description is this act is the class consulted. The data-file door to the same refusal is shut: `{"revert-own-apply":"L0"}` and `{"apply-source":"L0"}` are both rejected whole as permanent classes rather than landing.

### Autonomy is derived, never read

Three `opts` shapes, same outcome, with the derived values winning over everything the caller claimed:

```
omitted         : applied, masterDriven=true autonomousApply=false flagFromOpts=false snapshotDerived=true
autonomous:true : applied, masterDriven=true autonomousApply=false flagFromOpts=true  snapshotDerived=true
kitchen sink    : applied, masterDriven=true autonomousApply=false flagFromOpts=true  snapshotDerived=true
```

The kitchen-sink bag carried `autonomous: true, origin: 'rama', masterDriven: false, ignoreStop: true, bypass: true, policy: null, stop: null, userDataRoot`. A tier-1 user and a missing user are both refused with the I6 message and the bytes unchanged. `inspectCreate` threw for all eight origins that are not the literal `'ipc'` or `'rama'`, including `'RAMA'`, `'rama '`, `['rama']` and an object with a `toString`.

`opts.user` is the one renderer-supplied input that still decides anything, and the applier's step-0 comment states precisely why it cannot close it — `proposals.cjs` 269 hands the IPC request's own `opts` to `apply()`, which authorises `opts.user` at 219 — and binds the fix to master's list rather than claiming coverage.

### The frozen sets, and the fence between them

Every mutator on the exported views is `undefined` rather than refused, so a call throws at the site instead of silently succeeding:

```
PERMANENT.delete / add / clear -> TypeError: policy.PERMANENT[m] is not a function
Object.defineProperty(.., 'has') -> TypeError
```

All seven permanent classes are rejected by name, `{observe:'L0', 'propose-source':'L2', 'apply-source':'L5'}` lands nothing, `L5` anywhere is rejected, and a ceiling breach is named with both levels. The divergence fence executes rather than being read: handed a `permanent` whose `has` always returns false, `masterDrivenFence('apply-source', …)` returns the real `Error` with the real message. `requireMasterDriven` threw for `observe`, `propose-source`, `autonomy-policy` and an unknown id. `EDITABLE` is derived from `PERMANENT` rather than restated, and the suite's explicit seven-id expectation list is what goes red if a class is moved into the editable set.

### The pre-existing dispatchers

None of the four references the stop module or either predicate, and the symbol each entry cites still exists in its file:

```
refreshScheduler.cjs runNow              autonomyStop=false isHalted=false isStopped=false
metaCognition.cjs    auditTimer          autonomyStop=false isHalted=false isStopped=false
selfCare.cjs         runHealthSweep      autonomyStop=false isHalted=false isStopped=false
marketIntel.cjs      tickResolveOutcomes autonomyStop=false isHalted=false isStopped=false
```

`isHalted` appears only in `autonomyStop.cjs` and its two suites, so nothing consumes the predicate yet and `engage()` tears nothing down. On a default install `statusText()` says so in words, naming all five behaviours as "Still running on their own schedule, exactly as before", and `agentOrchestrator`'s reaper is declared exempt with its reason in the data. All five deferred stage modules and `upgradeLoop.cjs` are absent from disk, so the chokepoint count cannot claim coverage the slice does not have.

### What the assertions assert

Behaviour, with a small declared set of exceptions. Nine source-text assertions remain across both suites, each with a source property as its subject: the stop's module-scope dependency list, `lift`'s injectable-capability signature, the `main.cjs` wiring and its registration ordering (not executable without Electron), and the `NOTHING CALLS IT YET` disclosure sentence — the one row that asserts only that a sentence is present, with the behavioural "no consumers anywhere" scan sitting beside it rather than replacing it.

**Not covered:** no row looks up a short basename, and neither suite mentions `realpath`, so the §13 generator — ten spellings × four governed paths, every row asserting the governed file is byte-identical afterwards — would not have caught this round's finding. No row seeds `meta.autonomy` before the apply, so the "no field claims the apply happened" assertion holds only for an entry whose `meta` the test itself authored.

### What was run, and what could not be

`node --check` clean on all five `.cjs` touched plus both suites. `verifyAutonomyStop.cjs` 197/0 with one residual printed; `verifyUpgradeApplier.cjs` 433/0 with five. `npm run verify` **3148 passed, 0 failed** across 28 scripts, which matches the commit message and not ledger row 152. `verifyInvariants.cjs` ALL PASS and `verifyLoyaltyTripwire.cjs` 12/0 ALL PASS before and after my probes, so no protected file changed and `--approve` was not run. No `console.log` in the shipped modules, no `TODO`/`FIXME`, no dependency added and no version range loosened, nothing out of scope in the diff. The worktree is clean and `shared/autonomy-policy.json` is still absent; every probe wrote to a scratch repository root and a scratch `userData` under `%TEMP%`.

`node_modules` is absent from this worktree, so `npx vite build` genuinely cannot run here; no `.jsx` changed, so there is nothing for it to check. The app has never booted with these modules loaded and `app.getPath('userData')` has never been resolved — every assertion and every probe injects a scratch root.

</details>

<details>
<summary>File map</summary>

| file | what changed |
| --- | --- |
| `electron/lib/autonomyStop.cjs` | new — fail-safe `isStopped()`, explicit `isHalted()`, `engage`/`lift`, declared coverage tables |
| `electron/lib/autonomyPolicy.cjs` | new — fifteen classes over frozen floors and ceilings, seven permanent, the `MASTER_ACT` door |
| `electron/lib/autonomyGate.cjs` | new — the create fence, path canonicalisation, `stripSpellings`/`normalisePath`, the IPC seam |
| `electron/lib/upgradeApplier.cjs` | new — `spellingRefusal`, entry validation, writability probe, byte snapshot, revert, retention |
| `electron/main.cjs` | +15 — gate and applier wired in behind `isStub`, ledger registration wrapped |
| `package.json` | +4 — two suites appended to the `verify` chain, two aliases; no dependency change |
| `RAMA_AGI_MASTER_SPEC.md` | +1 — ledger row 152, stale against its own build |
| `docs/research/*` | the design document, the build note, and the prior review rounds |
| `scripts/verifyAutonomyStop.cjs` | new — 197 assertions |
| `scripts/verifyUpgradeApplier.cjs` | new — 433 assertions, §13 now ten spellings |

Full diff: `git diff d949b18..4b63dbf`

</details>
