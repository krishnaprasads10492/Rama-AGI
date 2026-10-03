# The stop, the policy table and the create gate — build review (pass 2)

Four new modules under `electron/lib/` give Rāma a fail-safe stop, a fifteen-class autonomy ladder
whose permanent rungs are not readable from data, and two fences on the one renderer-reachable door
that files proposals. `main.cjs` wraps the approval ledger's IPC recorder and registers an applier for
one new kind; `package.json` appends two suites to the end of the verify chain. The scope was
deliberately narrowed to three items and the deferred five-stage loop is named rather than implied, so
its absence is not judged here. This is the second pass: the first returned 1 HIGH, 2 MEDIUM and 3 NIT,
and all six are fixed where they lived — I re-derived each fix rather than taking the commit message's
word for it.

Watch for: the build ledger in `RAMA_AGI_MASTER_SPEC.md` was never updated, so a cold session cannot
find this work in Section 28 at all (**confirmed**, MEDIUM); `Object.freeze` over a `Set` is asserted as
though it bounds membership, and it does not (**confirmed**, NIT); a trailing dot or space defeats the
path fence, though Node treats the result as a different file so the stop's bytes stay intact
(**confirmed**, NIT).

Everything the brief asked be checked hardest came back clean. A master-approved apply succeeds on the
shipped default with no allow-file and no policy file — I ran it myself against a scratch root, not a
fixture. Nothing renderer-supplied decides whether an action is autonomous. The snapshot directory is
derived from the proposal id and the persisted one is never read. The four pre-existing dispatchers are
untouched. No permanent class can be raised by a data edit, by three independent mechanisms. No
protected file changed, the tripwire is ALL PASS, and I re-ran the whole chain: 2949 passed, 0 failed.

**Verdict**: NEEDS_CHANGES

## High-level view

The stop's design turns on two predicates rather than one, and that asymmetry is the load-bearing
decision. `isStopped()` is fail-safe — no allow-file, torn JSON, `"true"`, `1`, `{}` or a directory at
that path all mean stopped — and governs new autonomous work. `isHalted()` is true only on an explicit
`engage()` or `RAMA_AUTONOMY=stop`, and is the predicate nominally assigned to the four dispatchers that
ship and run today. Governing those with the fail-safe predicate would have deleted five working
behaviours on every install until master hand-created a file nobody had told him about, which I11 has no
exception for. The slice gets this right by not touching those files at all.

The policy table's answer to "what stops a data edit raising a permanent class" is that the loader never
reads them: for a permanent class `shared/autonomy-policy.json` is not overridden, it is not consulted,
and a file that so much as names one is rejected whole. Three mechanisms hold it, which is why the one
mutable-`Set` weakness below is a nit and not a hole — the pinned ceilings alone make every permanent
class unraisable even if the permanent set were emptied.

The applier's level gate was the first pass's second MEDIUM and the shape of the fix is the interesting
part. `revert-own-apply` is now PERMANENT, so the data file cannot reach it, and `requireMasterDriven`
throws outright for a `MASTER_ACT` class that is not permanent — so the two sets cannot drift apart
quietly. The entry gate consults the revert class rather than `apply-source`, which reads oddly for a
function whose job is applying; both are pinned at L4 so nothing differs today.

Autonomy is derived from the call site, never read from a field. `origin` is a literal written inside
the main process at both call sites and `inspectCreate` throws on anything else; `opts.autonomous`
survives only as an audit datum recorded beside what the system decided. The residual honesty here is
good: the user object the applier reads really does arrive with the IPC request, the applier says so,
and binding it to the session is on the master list because `proposals.cjs` is protected.

What is missing is not code. The spec's Section 28 ledger ends at row 146 and the spec never mentions
`autonomyStop` or the allow-file; the paste-ready section and ledger row sit in the build note instead.
The immediately preceding commit in this same series put its section and row into the spec directly, and
the spec is not a protected file.

<details>
<summary>Issues (8)</summary>

1. **Build ledger never updated** — `RAMA_AGI_MASTER_SPEC.md`'s Section 28 ledger ends at row 146 and
   the spec never mentions these modules; Section 132 and ledger row 152 exist only as paste-ready text
   in `docs/research/self-upgrade-build.md` §6. Paste both into the spec and renumber the row to 147 to
   follow 146.
2. **`Object.freeze` over a `Set` asserted as immutability** — `PERMANENT` and `MASTER_ACT` are mutable
   at runtime despite `Object.isFrozen` returning true, and one `.delete()` makes `validate()` accept a
   data file naming that class. Export frozen arrays or a `has()` closure, and replace the
   `Object.isFrozen(policy.PERMANENT)` row with the membership assertion that already exists below it.
3. **A source-regex row where behaviour is now reachable** — `verifyAutonomyStop.cjs` line 508 asserts
   `requireMasterDriven`'s non-permanent refusal by matching `/PERMANENT\.has\(classId\)/` over the
   function's own text; because the set is mutable the real throw can be executed. Execute it.
4. **Trailing dot and space defeat the path fence** — `namesGovernedPath('electron/lib/autonomyStop.cjs.')`
   returns null and a `create` change spelled that way applies, planting a sibling beside the governed
   file. Trim trailing dots and spaces per segment in `normalise`, and add the two spellings to the
   variant generator in `verifyUpgradeApplier.cjs` §13.
5. **`apply-source` is never consulted by the applier** — the entry gate resolves `revert-own-apply`
   only, so the class that names "applying a source change" is not read by the component that applies
   them. Require both at L4, or say in the header why the revert net is the thing gated.
6. **`meta.autonomy` recorded before the entry validations** — a refused apply leaves
   `appliedBy: 'master'` and `recordedAt` on an entry `proposals.apply` then marks FAILED. Move the merge
   below the validations, or rename the field to `attemptedBy`.
7. **`isHalted()` has no production consumers** — `PRE_EXISTING[].governedBy: 'isHalted'` and the suite
   row that reads it describe an assignment with no mechanism. Reword to "would be governed by" and have
   the suite row say it asserts the declaration.
8. **An unwritable repo tree engages the stop** — a failed write triggers a revert that writes back to
   the same unwritable paths, so it also fails, and `engage()` then revokes master's allow-file. Check
   writability before the snapshot and refuse cleanly.

</details>

<details>
<summary>Details</summary>

### The shipped default, re-measured without a fixture

This is the defect the design shipped twice, so I did not take the suite's word for it. With a scratch
`userData` containing no allow-file, `shared/autonomy-policy.json` absent as it ships, and a tier-0
user, `applyWith` returned without throwing and the bytes landed. Tracing why: `requireMasterDriven`
reloads, `effective(classId, {ignoreStop: true})` skips the stop's first line, `resolveWithoutStop` sees
`source === 'absent'` and returns `FLOORS['revert-own-apply']`, which is `L4`, and the gate needs `L4`.
No branch in that chain reads the allow-file.

The second door — a validated data file lowering the class — is shut by making both `MASTER_ACT`
members permanent, and the suite exercises it through the live loader at `policy.DATA_FILE` rather than
a fixture, writing and removing a real file under `try/finally`. I confirmed the file is absent again
afterwards and `git status` is clean. The residual is that a hard kill mid-suite would leave a policy
file in a shipped tree; the `finally` covers throws but not a signal.

### The path fence, and the two spellings still outside it

The first pass's HIGH was a comparison that swapped separators and lowercased but never resolved
structure. `path.posix.normalize` fixes it, and §13 of the applier suite carries a control row that
applies the same odd spellings to an *ungoverned* path — so a green section cannot mean "the fence
rejects anything with a dot in it" when what is claimed is that it resolves them. Twenty variant rows
across both origins, `meta` and `applyWith`; I reproduced the plain spelling being refused at all three
gates.

Two spellings are still outside it, and they are the Windows ones:

```
"electron/lib/autonomyStop.cjs."  -> fence: null   IPC create: ALLOWED   applyWith(create): APPLIED
"electron/lib/autonomyStop.cjs "  -> fence: null   IPC create: ALLOWED   applyWith(create): APPLIED
"electron/lib/autonomyStop.cjs"   -> fence: electron/lib/autonomystop.cjs   refused at both gates
```

`normalize` collapses `.`, `..` and repeated separators but does not trim a trailing dot or space from a
segment, so the comparison misses them. What saves the stop's bytes is libuv, not the fence: Node opens
these through the NT path form, so the write creates a genuinely distinct `autonomyStop.cjs.` and the
real file is byte-identical afterwards — I checked the directory listing and the contents. A `patch` is
refused earlier with "does not exist, so there is nothing to patch", so only `create` gets through, and
what it plants is a sibling Node will never load. The reason it is still worth closing is that the
fence's answer for a governed-adjacent name is "names nothing governed", and plenty of Windows tooling
does collapse trailing dots and spaces.

### Autonomy derived from the call site

`opts.autonomous` reaches no conditional, and the suite proves it with two applies over separate fixture
repos — one carrying the flag, one not — asserted to produce the same outcome, rather than by grepping
for the absence of an `if`. `origin` is a literal at both call sites and an undeclared or invented one
throws rather than being guessed.

The honest half: `masterDriven` derives from `opts.user`, and that object is renderer-supplied.
`ipcMain.handle('proposals:apply', (_e, id, opts) => apply(id, opts || {}))` at `proposals.cjs` 269 and
`authorise(opts.user, ...)` at 219 — I read both lines, and the applier's step-0 comment describes them
accurately, which it did not in the first pass. The hole is pre-existing, lives in a protected file, and
is on the master list. What holds "Rāma does not start an apply" is the asserted absence of in-process
callers of `proposals.apply`: the suite walks `electron/lib`, `electron/ipc` and `electron/`, finds
exactly two call sites, asserts both sit inside an `ipcMain.handle` body, and goes red at a third.

### The permanent set is mechanically unraisable, and the freeze assertion is not what it looks like

Three independent mechanisms stop a data edit raising a permanent class: `validate()` rejects a file
naming one, whole rather than per key; `resolveWithoutStop` returns the floor without consulting the
file; and every one of the seven has `FLOORS[c] === CEILINGS[c]`, so `min(CEILINGS[c], declared)` cannot
exceed the floor even if the first two were bypassed. The red-on-change row is a literal list of the
seven ids compared against the set, and it does go red when one is moved out by a source edit.

The weakness is in the assertion beside it. `Object.freeze` on a `Set` freezes properties, not internal
slots:

```
isFrozen(PERMANENT) true size 7
after delete       size 6   has('revert-own-apply') false
validate({levels:{'revert-own-apply':'L0'}}).ok  ->  true
requireMasterDriven('revert-own-apply','L4')     ->  throws "...is a MASTER_ACT class but not a PERMANENT one"
MASTER_ACT.add('propose-source')                 ->  succeeds
```

So `check('the four frozen constants really are frozen', ... Object.isFrozen(policy.PERMANENT))` asserts
a guarantee it does not provide, and `check('the MASTER_ACT subset is exactly two — a third member turns
this RED')` holds against a source edit but not against a runtime `.add()`. Nothing is exploitable: the
loud `throw` catches the `MASTER_ACT` pair fail-closed, and the pinned ceilings catch the other five.
It is the claim that is overstated, not the fence.

The same mutability makes the one regex row in this area unnecessary. Line 508 asserts
`requireMasterDriven`'s refusal by matching `/PERMANENT\.has\(classId\)/` against the function's own
source; deleting a member and calling it produces the real throw, as above.

### Snapshot directory, and the poisoned record

`path.join(userDataRoot, stop.STATE_DIR, stop.SNAPSHOT_DIR, proposal.id)`, with `userDataRoot` closed
over at wiring time and the id matched against `^[0-9a-f]{20}$` before any path is built. `rollbackPoint`
appears nowhere in the module. The suite plants
`meta.weighing.blastRadius.rollbackPoint.dir` pointing at the state directory itself, applies, and then
asserts both that the snapshot went to the derived path and that the allow-file is byte-identical — a
`Buffer.compare` against bytes read before the apply, which is the assertion that matters, since the
earlier design's failure mode was the stop's own state landing inside the one branch the fence permits
to write.

### The pre-existing dispatchers

None of `refreshScheduler.cjs`, `metaCognition.cjs`, `selfCare.cjs` or `marketIntel.cjs` is in the diff,
and no `isStopped(` or `isHalted(` reaches any of them — I grepped the whole of `electron/` and the only
hits outside the new modules are in the two suites. `refreshScheduler` gets a behavioural row: a scratch
store, a counting probe task, `isStopped()` asserted true, and `runNow` asserted to have called the task
and recorded its outcome twice. The other three rest on the file being unmodified, which is a sound
proxy only because they genuinely are.

What that exposes is that `isHalted()` has no production consumer anywhere. `PRE_EXISTING[].governedBy:
'isHalted'` is a label, and the suite row `"runNow is governed by isHalted(), not by the fail-safe
predicate"` passes by reading that hardcoded field — a green row over a claim with no mechanism, which is
the `badgeLabel` defect's shape. It is disclosed three other ways and `statusText()` is careful to say
"Still ARMED, because this build does not tear them down", so a reader is not misled for long. The module
header's "`isHalted()` governs the PRE-EXISTING dispatchers" is the sentence to fix.

### The audit record is written before the door

Step 0 merges `meta.autonomy` — `appliedBy: 'master'`, `autonomousApply: false`, `flagFromOpts`,
`recordedAt` — above the schema check, the loyalty guard, the governed-path fence and the six per-change
validations. `proposals.apply` then runs `p.status = STATUS.FAILED; log('failed', p, ...)` on the same
mutated object, so a proposal refused at the door carries a record of master having applied it. The
status and reason sit beside it, so both facts are available; it is the field name `appliedBy` on a
FAILED entry that reads wrong. Recording the attempt is worth keeping, so renaming is the cheaper fix
than moving the merge.

### Failure direction on an unwritable tree

If a write throws, `revert(token, io)` restores from the snapshot in `userData` back to the same paths
under `repoRoot`. When the cause of the original failure is the destination rather than the source — a
read-only tree, a permissions change, a packaged install where `path.resolve(__dirname, '..', '..')`
lands inside `app.asar` — the restore writes fail too, `failures` is non-empty, `fatal.json` is written
and `stop.engage()` revokes master's allow-file and records a halt. A mundane permissions problem ends
with autonomy halted and a FATAL message. Recoverable by hand, and master writes that file by hand
anyway since `lift()` cannot succeed until the capability exists, but a pre-flight writability check
would turn it into a clean refusal. Traced through the code; not executed against a read-only fixture.

### The ledger, which is the one thing not in the diff

`RAMA_AGI_MASTER_SPEC.md` is unchanged. Its Section 28 ledger ends at row 146 (Section 126, the already
reviewed Phase 0 commit), rows 147–151 do not exist, and the spec contains no occurrence of
`autonomyStop` or `autonomy.allow`. Section 132 and ledger row 152 are written out in full in
`docs/research/self-upgrade-build.md` §6 under a "PASTE-READY" heading. The spec is not in
`loyaltyGuard.PROTECTED_FILES`, and the preceding commit in this same series added its own section and
ledger row to the spec directly, so the pattern in this project is that the build commit carries them.
The resume protocol's stated purpose is that a cold session can resume from the document alone; right
now that session would find four new modules governing Rāma's autonomy with no entry in the ledger and
no next step recorded.

### Suites and verification

I ran everything. `node --check` clean on all five `.cjs` touched plus the two suites. The two new
suites: 187 and 244, 0 failed. The whole chain via `npm run verify`: exit 0, 2949 passed, 0 failed
summed across every suite, with both new ones at the end and nothing reordered. `verifyLoyaltyTripwire`
is ALL PASS — the live core hashes to the approved manifest digest, so no protected file moved and
`--approve` was not run; `shared/loyalty-tripwire.json` is not in the diff. `verifyInvariants` ALL PASS
with its held-by-hand list unchanged.

`node_modules` is absent from this worktree, so `npx vite build` genuinely cannot run. No `.jsx`
changed, so there is nothing a renderer build would have covered.

`console.log` appears only in the two suites (28 and 22 calls), matching the existing verify scripts;
none in the four shipped modules. No TODO, FIXME, XXX or placeholder anywhere in the seven files.
`package.json` adds two `verify:*` scripts and extends the chain — no dependency added, nothing
unpinned. Only `main.cjs` and `package.json` were modified; everything else in the diff is new, and
nothing outside `electron/lib/`, `scripts/` and `docs/research/` is touched.

One check on the wiring, since the gate now sits between the ledger and `ipcMain`: `guardLedgerIpc`
intercepts `proposals:create` and forwards every other channel, and the suite registers the real
`proposals.cjs` through it against a fake recorder, asserts all nine channels arrive, and asserts a
shipped `self-modify` create from a tier-1 user still succeeds while a tier-2 one is still refused by the
ledger's own view gate. I also grepped `src/` for every governed path and the stop's state names: no
shipped renderer flow names any of them, so the path fence is additive and cannot have removed a working
behaviour.

</details>

<details>
<summary>Files changed</summary>

- `electron/lib/autonomyStop.cjs` — new; two predicates, `engage`/`lift`, the declared coverage lists and the status reporting
- `electron/lib/autonomyPolicy.cjs` — new; fifteen classes over frozen floors, ceilings and a seven-member permanent set, with the whole-file validator and the two gate doors
- `electron/lib/autonomyGate.cjs` — new; the path and kind fences, `inspectCreate`, `fileProposal`, and the ledger IPC wrapper
- `electron/lib/upgradeApplier.cjs` — new; entry validation, the verified byte snapshot, the revert and snapshot retention
- `electron/main.cjs` — wraps the ledger's recorder with the gate when it loaded, registers the applier after the ledger
- `package.json` — two `verify:*` scripts, both appended to the end of the chain
- `scripts/verifyAutonomyStop.cjs` — new; 187 assertions
- `scripts/verifyUpgradeApplier.cjs` — new; 244 assertions
- `docs/research/SELF_UPGRADE.md`, `docs/research/self-upgrade-build.md`, `docs/research/design-review.{md,json}` — the design, the build note with the paste-ready spec text, and the design review

Full diff: `git diff d949b18..HEAD` in `.worktrees/self-upgrade`.

</details>
