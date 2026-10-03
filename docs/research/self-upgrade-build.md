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
| `electron/lib/upgradeApplier.cjs` | **THE APPLIER'S ENTRY VALIDATION.** Registered for the new kind `self-upgrade` through `registerApplier`. Derives `masterDriven` from `opts.user`; resolves its level through `requireMasterDriven`; records `opts.autonomous` and never reads it; derives the snapshot directory from the proposal id; re-runs the loyalty guard **against the canonicalised path**; refuses a governed path, an NTFS alternate-data-stream spelling or any control character, a path outside the root, a symlink, `action: 'delete'`, a mis-declared create, and a drifted base digest. Byte snapshot verified on read-back before the first write; revert on a failed write; a failed revert is fatal, marked, and engages the stop. |
| `scripts/verifyAutonomyStop.cjs` | **197** assertions after three review rounds. The stop, the policy table, the permanence row, the I11 behavioural proof, `lift()`'s executed success path, the live data-file loader, and the degraded create fence. |
| `scripts/verifyUpgradeApplier.cjs` | **433** assertions after three review rounds. The shipped-state apply, the create gate, the entry validations, **ten** spellings of a governed path at every gate plus a protected-file pass, the revert, retention, and who can reach `proposals.apply`. |

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
repository root). **§13 of `verifyUpgradeApplier.cjs` ran, AS OF THIS ROUND, five spellings of each of the four
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

## 1B. THE SECOND BUILD-REVIEW ROUND — EIGHT FINDINGS, AND THE ONE THAT WAS NOT ACTIONED

`docs/research/build-review.json` returned **CHANGES_REQUESTED** a second time: 1 MEDIUM, 7 NIT. Again
no module was re-implemented. `+76` assertions in `verifyUpgradeApplier.cjs` and `+10` in
`verifyAutonomyStop.cjs`; three existing rows were rewritten in place and none was removed.

**Finding 1 (MEDIUM) — nothing was in the spec's ledger.** ACTIONED, but NOT as prescribed, and the
difference matters. The finding's fix was to paste both blocks from §6 and renumber the ledger row from
152 to **147**, on the premise that the ledger's last row is 146. That premise is true of THIS
WORKTREE and false of `dev`: the branch was cut at `c595342`, `dev` has since reached `42fa12f`, and
`dev`'s SECTION 28 already contains rows **147, 149, 150, 151, 153 and 155** plus sections 129, 130,
131, 133 and 135. Renumbering to 147 would have collided with a row that exists. **So the row went in
as 152, inserted after row 146 as a single line, with nothing else in SECTION 28 touched — no
renumbering, no reflow, and the I1–I17 invariant block untouched.** Block A (the Section 132 prose)
is deliberately **still paste-ready and not in the spec**: the worktree's copy of the file ends five
sections behind `dev`, so inserting a new section there writes into the exact region `dev` has grown,
and a hand-resolved conflict in this file is the one thing worth avoiding. The ledger row says in its
own first sentence that Section 132 is not in the document yet and where to find it, so a cold session
is pointed, not misled.

**Finding 2 (NIT) — `Object.freeze(new Set([...]))` freezes properties, not internal slots.** Both
exported sets were mutable at runtime: measured, `policy.PERMANENT.delete('revert-own-apply')` succeeded
and dropped the size from 7 to 6, after which
`policy.validate({version:1,levels:{'revert-own-apply':'L0'}}).ok` returned **TRUE** — a class the data
file is never read for became readable from it. Nothing was exploitable (`requireMasterDriven` fails
closed for the pair, and every permanent class has `FLOORS[c] === CEILINGS[c]`), so this was an
assertion overstating its guarantee rather than a fence leaking. **`PERMANENT` and `MASTER_ACT` are now
`frozenSetView` objects: `has`, `size`, an iterator, and NO mutator, with the backing `Set` unreachable
in a closure.** A `delete` is now a TypeError at the call site instead of a silent success, and a caller
that copies the view mutates its own copy. The `Object.isFrozen(policy.PERMANENT)` clause was replaced
by what it was meant to mean: no mutator exists, a mutated copy leaves the view untouched, and the
loader still rejects the file that the mutation used to make valid.

**Finding 3 (NIT) — the loud half of the `MASTER_ACT`/`PERMANENT` fence was asserted by regex.** The
row matched `/PERMANENT\.has\(classId\)/` and `/throw new Error/` over `requireMasterDriven`'s own
source text, which passes for any function that merely mentions the identifier — the one row in that
area asserting a shape instead of a behaviour. The fence is now a pure exported function,
`masterDrivenFence(classId, {masterAct, permanent})`, returning the `Error` to throw or `null`;
`requireMasterDriven` calls it with **no** override and the suite asserts that, then hands it a
divergent pair and asserts the real throw with the real message. The overrides grant no reach:
`masterAct` still bounds which classes reach the door, so an injected `permanent` can only re-permit a
class already in the frozen two-member subset.

**Finding 4 (NIT) — `path.posix.normalize` does not strip a trailing dot or space.** So
`namesGovernedPath('electron/lib/autonomyStop.cjs.')` and the trailing-space form both returned `null`,
`inspectCreate` refused neither at either origin, and `applyWith` with action `create` APPLIED, leaving
`autonomyStop.cjs.` and `autonomyStop.cjs ` in `electron/lib/` beside the real file. **Confirmed on
this machine rather than assumed: `lstat` of the trailing-dot name is ENOENT and a write creates a
second directory entry, so these are genuinely distinct files and the stop's own bytes survived** — it
was the fence answering "names nothing governed" for a governed-ADJACENT name, on the one platform
whose shell and many of whose APIs do collapse the two. `normalise` now trims trailing dots and spaces
**per segment, before `normalize`, and skips `.` and `..`** — trimming those would have turned
`electron/lib/../lib/x` into `electron/lib//lib/x`, breaking the `..` spelling the fence already
caught. §13's generator now carries the ACTION each attack has to use, because a `patch` of a
trailing-dot name is refused for the wrong reason ("there is nothing to patch"): **seven spellings as of
this round, ten after round 3 ×
four governed paths × three gates**, the two new ones additionally asserting that no
governed-adjacent file was left beside the real one, and the ungoverned control extended to match.

**Finding 5 (NIT) — the one component that writes source never consulted `apply-source`.** It resolved
`revert-own-apply`, the safety net, and not the class whose entire description is applying a source
change. No behavioural difference today — both `MASTER_ACT`, both `PERMANENT`, both pinned
`FLOOR === CEILING === L4` — which is exactly why it needed a row rather than a comment: a reader
wiring behaviour onto `apply-source` later would have found the applier never read it. **Both are
required now, `apply-source` first, and the suite asserts the pair and the order through the injected
policy `io` already carries, one class at a time refusing.**

**Finding 6 (NIT) — a refused apply carried a field saying master applied it.** `meta.autonomy` is
merged above every validation and it mutates the **ledger's own entry object**, so when a validation
throws, `proposals.cjs` sets `status = FAILED` and persists that same object (244–248) — with
`appliedBy: 'master'` on it. The badge-label mismatch, in the audit trail of the one component that
writes source. Recording the attempt has value, so it stays where it is and **says what it is:
`attemptedBy`/`attemptedAt` at entry, `appliedBy`/`appliedAt` on the success path only, below the write
loop.** A row asserts a refused apply leaves no field claiming the apply happened, and a source row
asserts the only `appliedBy` assignment sits after the writes.

**Finding 7 (NIT) — `isHalted()` has no production consumer, and the header implied it did.** Grepped
and confirmed: every reference is inside `autonomyStop.cjs` or the two suites. So `governedBy:
'isHalted'` recorded an intention, not a mechanism, and four green rows read that hardcoded field two
lines above a row asserting those same files contain no reference to the stop at all. The field is
**`governedByWhenBuilt`** now, the header says **NOTHING CALLS IT YET** in those words, and the four
rows say they assert the declaration. **A new row asserts the absence of any consumer**, so the day one
of those dispatchers starts consulting the predicate, the row goes red and demands the header be
corrected — which is the point.

**Finding 8 (NIT) — a permissions problem became a FATAL halt.** When a write failed because the
DESTINATION was unwritable rather than because of anything about the change, `revert()` restored the
snapshotted bytes to those same unwritable paths and failed too — so `fatal.json` was written and
`stop.engage()` revoked master's allow-file. A read-only checkout, a `chmod`, or a packaged install
where `repoRoot` resolves inside `app.asar` turned a correctly-approved apply into *"FATAL … and
autonomy has been halted"*, with the message blaming the revert. **Each target is now probed for
writability before the snapshot is taken and refused plainly, by path and by permission, saying in words
that this is an environment problem and not a failed change.** Four executed cases: an injected `fs`
denying the file, one denying the create's nearest existing ancestor, a **real** read-only file with no
fake filesystem involved, and a writable control proving the probe is a probe and not a wall — each
asserting `stop.isHalted()` stays false, master's allow-file survives, and no snapshot directory is
created. **The limit is printed as a residual rather than argued away: on this platform
`accessSync(W_OK)` reports the read-only ATTRIBUTE and not the ACL, so an ACL-denied directory is still
caught only by the write loop's `catch` and the revert behind it.**

---

## 1C. THE THIRD BUILD-REVIEW ROUND — ONE FINDING, AND THE FIRST SPELLING WHOSE GOVERNED BYTES DID NOT SURVIVE

`docs/research/build-review.json` returned **CHANGES_REQUESTED** a third time: **1 HIGH, nothing else.**
No module was re-implemented. `+113` assertions in `verifyUpgradeApplier.cjs`, none anywhere else; one
existing row was rewritten in place (the `variants` count, seven → ten) and none was removed.

**Finding 1 (HIGH) — an NTFS alternate-data-stream suffix is not a respelling, it is a SYNONYM.** This is
the third spelling class this fence has failed to canonicalise in three rounds — round 1 was unresolved
structure, round 2 was a trailing dot and space — and the first whose **governed bytes did not survive**.
Round 2's was graded NIT precisely because they did: `autonomyStop.cjs.` is a genuinely different file
here, so the attack created a second directory entry and left the real one alone. `::$DATA` is not that.
On NTFS it names the primary data stream of the file itself.

Reproduced on this machine against the real modules before the fix:

- `gate.namesGovernedPath('electron/lib/autonomyStop.cjs::$DATA')` returned **`null`** — names nothing
  governed. The same for `:evil`, for a trailing `\t`, and for every governed path.
- `path.resolve` **kept the suffix**, so the confinement check passed; `lstatSync` reported a **regular
  file**, so neither the symlink rule nor the not-a-file rule fired; and `readFileSync` through the
  spelling returned the real file's **25255 bytes**, so the step-6 `baseSha256` base-drift check —
  the one gate whose job is to notice the file is not the file the change was computed from — **PASSED
  instead of catching it.**
- A master-approved `patch` with `action: 'patch'` therefore **APPLIED**, leaving
  `electron/lib/autonomyStop.cjs` containing `function isStopped(){return false;}`. The same spelling
  replaced `shared/loyalty-tripwire.json` with `{"approved":"everything"}` — the baseline the tamper
  evidence compares against — and carried a patch of `electron/lib/loyaltyGuard.cjs` through step 2's
  covenant re-run with `guard.inspectChanges` returning `{ok: true, refused: []}`.

So in-scope item 1, *"the STOP unreachable by any proposal"*, was **false for this design's own kind.**
The bounds, because the severity should not be overstated: I6 held — the apply still needed master's
recorded approval, and `proposals.apply` has no in-process caller; the create fence refuses the owned
kinds at origin `ipc`, so a renderer cannot file one; and `fileProposal` has no caller at all. Nothing in
the shipped tree constructs such a change. **It was reachable by a hand-built approval, not by Rāma.**

**FIXED IN TWO PLACES, and the split is the decision.**

1. **`upgradeApplier.spellingRefusal`, consulted first thing in `validatePath`, refuses the spelling
   CLASS outright for every path — governed, protected or ordinary.** A `:` anywhere outside a leading
   drive designator, or any control character, is refused by name. Neither is ever a legitimate source
   path, so a plain refusal is the whole fix, and it is made **before the snapshot is taken and before a
   byte is written** — so the revert path, whose own failure is fatal and revokes master's allow-file, is
   never entered for it.
2. **`autonomyGate.stripSpellings` / `normalisePath` canonicalise the same two spellings, so
   `namesGovernedPath` REPORTS the path as governed** at both create origins and at the applier's step 3,
   rather than leaving one refusal in one function as the only thing between a stream name and the stop's
   own module. A segment is truncated at its first `:`; a leading `C:/` is preserved, because a drive is
   not a stream and discarding it would stop an absolute path to the allow-file looking absolute; a
   segment that is nothing but a stream suffix is left alone, for the same reason `trimSegments` leaves a
   dots-only segment alone.

**And a third change the finding did not ask for, because step 2 was presented as the covenant re-run
rather than trusted and for this spelling it refused nothing.** `loyaltyGuard.normalise` swaps
separators, strips a leading `./` and lower-cases — it does not resolve structure and it does not strip a
stream suffix. That blind spot is **pre-existing and lives in a protected file this build must not
touch.** What this build owns is what it HANDS the guard, so **the applier now canonicalises each
change's path through `gate.normalisePath` before the re-run**, one change at a time so the refusal still
names the spelling master wrote rather than the canonical form it compared. All ten spellings of
`electron/lib/loyaltyGuard.cjs` are now refused **at step 2, by the covenant**, instead of falling
through to step 4 and being refused for their punctuation.

**Why the colon strip is NOT in `normalise`, which is the non-obvious half.** `normalise` is also applied
to the stringified `meta` blob, and JSON is full of colons. Measured: folding the strip into
`trimSegments` turns `{"plan":"then patch electron/lib/x.cjs"}` into `{"plan"/lib/x.cjs"}`, because the
colon it truncates at is the one after `"plan"` — the `electron/` segment is **deleted** and the `meta`
substring scan then MISSES a governed path it catches today. So the strip lives on the path route only.
The `meta` route needs none: that scan is a substring test, and `electron/lib/x.cjs::$data` **contains**
`electron/lib/x.cjs`. Two rows assert both halves of that, so a later session cannot "tidy" the two
functions into one.

**§13's generator is now ten spellings**, and it carries a fourth element: what the UNGOVERNED control
row expects. The seven that merely respell a path must still **APPLY** — that control is what stops a
green section meaning "the fence refuses anything odd-looking". The three new ones must be **refused even
for an ungoverned path**, and the row asserts the refusal is the SPELLING one and *not* the
governed-path one, so the distinction is held rather than blurred. Ten spellings × four governed paths ×
three gates, plus the applier where the bytes would land, plus the ungoverned control, plus **a new
protected-file pass over all ten spellings** holding the step-2 claim. The assertion that would have
caught this in round 2 — and did not exist — is the one that now runs on every row: **the governed file's
bytes are byte-identical on disk afterwards.**

**One honest residual from the fix.** `existsSync` through `::$DATA` is TRUE whether or not anything was
written, because it is a synonym for a file that exists. So the `::$DATA` rows assert **bytes**, and the
`:stream` and trailing-tab rows — which would have created a NEW entry — assert the **directory
listing**. Asserting the wrong one of those two would have been a green row over a clobbered file.

---

## 1D. THE FOURTH BUILD-REVIEW ROUND — AND THE ROUND THAT RETIRED THE METHOD

`docs/research/build-review.json` returned **CHANGES_REQUESTED** a fourth time: **1 HIGH, 1 MEDIUM,
1 NIT.** No module was re-implemented. `+50` assertions in `verifyUpgradeApplier.cjs`, none anywhere
else; **no existing row was rewritten, weakened or removed**, and two existing source-shape rows were
widened only to the extent that `realpathSync?.native` is spelled with an optional chain.

### Finding 1 (HIGH) — an NTFS 8.3 SHORT BASENAME, and why no fifth transform was written

This was the **fourth** spelling class the path fence failed to canonicalise in four rounds: round 1 was
unresolved structure, round 2 a trailing dot and space, round 3 the `::$DATA` stream suffix. The first
three were each arguably "one more character case". This one is not, and that is the finding's real
content: `AUTONO~1.CJS` shares a **six-character prefix** with `autonomyStop.cjs` and nothing else, so
**no transform over the characters can recover the governed name.** A fifth filesystem synonym — another
hard link, a junction, a case-folding quirk — would have defeated a character fence the same way.

8.3 generation is **live on this volume for the real worktree**, not only for a scratch fixture.
Measured with `dir /x`: `electron/lib` reports `AUTONO~1.CJS autonomyStop.cjs`,
`AUTONO~2.CJS autonomyPolicy.cjs`, `AUTONO~3.CJS autonomyGate.cjs`, and `shared/` reports
`LOYALT~1.JSO loyalty-tripwire.json`. Before the fix: `gate.namesGovernedPath('electron/lib/AUTONO~1.CJS')`
returned `null`, `spellingRefusal` returned `null`, `readFileSync` through the spelling returned the real
file's bytes so the `baseSha256` base-drift check **passed rather than catching it**,
`loyaltyGuard.inspectChanges` refused nothing — and a master-approved `patch` **applied**. The reviewer
also measured the reach, which is what made this worse than round 3: at origin `ipc` **the long name was
refused and the short name was ALLOWED**, so the renderer route was LIVE rather than latent, and
`electron/ipc/timeline.cjs`'s pre-existing `SELF_MODIFY` applier writes `changes[].path` with no root
confinement.

**THE METHOD CHANGED. The fence now asks the FILESYSTEM which file a path names.** Measured on this
machine, which is why `.native` and not the plain call:

| Call | `…/electron/lib/AUTONO~1.CJS` | `…/autonomyStop.cjs::$DATA` |
|---|---|---|
| `fs.realpathSync` | returns the **short path unchanged** — useless here | — |
| `fs.realpathSync.native` | `…/electron/lib/autonomyStop.cjs` | `…/electron/lib/autonomyStop.cjs` |

One call closes the short basename and the stream suffix **together**, and closes any further filesystem
synonym without being told about it first. That is the falsifiable difference between this round and the
three before it: the previous fixes each enumerated a spelling, and this one asks a question.

Three places, which is the split the reviewer prescribed and the second one is the half that matters:

1. **`upgradeApplier.canonicalPathOf` + `validatePath`.** After the existing resolve-and-confine, the
   target is canonicalised and **the canonical form is confined too**. An EXISTING file is asked
   directly and a failure is **refused by name**, not shrugged off; a `create` has no leaf to ask about,
   so the **nearest existing ancestor** is canonicalised and the remainder appended — the same walk
   `writabilityOf` already does. The resolved path is still what is WRITTEN, because a write must land
   where master's approved change said it would; the canonical path is what is COMPARED, carried on the
   target as `canonical`/`canonicalRel`.
2. **`autonomyGate.canonicalPath`, consulted by `namesGovernedPath` at BOTH origins.** Round 3's fix
   left the long name refused at `ipc` and the short name allowed, which is exactly why this was live.
   The comparison now runs over **two** spellings — the character canonicalisation and the filesystem's
   answer — and either one naming a governed token is a refusal. Neither subsumes the other: the
   character route still answers for a name that addresses nothing yet (a `create` with no existing
   ancestor, a trailing dot that makes a NEW directory entry here), and the filesystem route is the only
   thing that catches a synonym of an existing file.
3. **Step 2's covenant re-run is handed both spellings too.** `loyaltyGuard.cjs` is NOT one of the
   `SELF_GOVERNING_PATHS`, so step 3 never looks at it — step 2 was the only thing between
   `electron/lib/LOYALT~1.CJS` and the covenant file's own bytes, and it compared characters. The guard
   itself was not touched; what changed is what it is given.

**`spellingRefusal` and `stripSpellings` were KEPT, unchanged.** They are the cheap refusal for a name
that is not yet a synonym of anything, and the colon strip stays out of `normalise` for the measured
meta-blob reason already in the code. This round is **additive**, not a replacement.

**The suite rows discover the short name at RUNTIME and let the FILESYSTEM CONFIRM it.** `~1` versus
`~2` depends on the order a directory's entries were created — `LOYALT~1.CJS` names `loyaltyCore.cjs` in
the real worktree and `loyaltyGuard.cjs` in a fixture built in a different order — so a hardcoded row
would have been a row about this machine's history. The candidates are the documented 8.3 shape, and
each is accepted **only when `realpathSync.native` of it returns the same canonical path as the long
name**, so every row runs against a synonym the filesystem has agreed to. Verified to agree with
`dir /x` for every file tested. A volume with 8.3 generation disabled matches nothing and the row is
**SKIPPED with a printed RESIDUAL, never a silent pass.** No shell is spawned: `cmd /c for … %~sI`
through `execFileSync` returned a mangled argument on this machine, and parsing `dir /x` is
locale-dependent.

Rows added: the filesystem resolution itself, **and the row stating that the character route alone still
reads the spelling as naming nothing** — which is the row that says why the fix was needed; both create
origins per governed path; the applier against the fixture's own root; the covenant through its short
name; a refusal when the filesystem will not canonicalise an existing file; the degraded path when an
injected `fs` has no `realpathSync.native` at all; and **the control** — an UNGOVERNED file reached
through *its* short basename must still APPLY, with the bytes landing in the long-named file, so a green
section cannot be satisfied by a fence that refuses anything with a tilde in it.

### Finding 2 (MEDIUM) — a forged `appliedBy` surviving onto an entry persisted FAILED

The merge at the applier's entry spread `proposal.meta.autonomy` and then overwrote four keys.
`appliedBy` and `appliedAt` were **not among them**, so a pre-seeded pair survived onto an entry that
`proposals.cjs` then persists **FAILED** — the exact contradiction that moving the assignment below the
write loop was supposed to end, reached through the spread instead of through the assignment. Measured:
seeded with `{appliedBy:'master', appliedAt:'2020-01-01T00:00:00.000Z', autonomousApply:true,
note:'forged'}` and refused at step 3 or step 4, the entry kept `appliedBy: 'master'` and the forged
timestamp. `autonomousApply` was already forced to `false`, which is the field the
forward-compatibility argument rests on — so this was **an audit-trail integrity defect, not an
authorisation one**. No byte was written and I6 held.

Fixed the minimal way the finding offered, deliberately: the two fields are **deleted immediately after
the spread**, so the only place either can be set is the success path below the write loop. The
alternative — rebuilding the record from a whitelist — would have dropped the unrecognised-but-innocent
fields that an existing row asserts are preserved, and weakening a passing assertion to fix a MEDIUM is
the wrong trade. §17 pre-seeds the forgery, forces a refusal at **three different steps**, and asserts
neither field survives while `autonomousApply` is false and `note` is untouched — plus the control that
a SUCCESSFUL apply still records both, so the fix cannot degenerate into "delete them always".

### Finding 3 (NIT) — ledger row 152 understating its own build

The row in the spec said `verifyUpgradeApplier.cjs (320)` and `2518 → 3035`, two build-review rounds.
Re-measured by the reviewer and again here, it was **433** and **3148** at the time, three rounds. The
instruction for this round is again **not to modify `RAMA_AGI_MASTER_SPEC.md`**, so it was not modified.
**Block B in §6 is the corrected one-line replacement and it now carries this round's numbers — 197 and
483, 2518 → 3198, four build-review rounds — with `fs.realpathSync.native` named as what closed the
fence.** The staleness is raised here rather than quietly edited, exactly as round 3 did, and applying
it stays a one-line replacement that rebases onto `dev`.

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
| **This note's own §2 row 1 again, and the in-scope claim *"the STOP unreachable by any proposal"*** | **FALSE A SECOND TIME, for a different spelling class.** An NTFS alternate-data-stream suffix is a SYNONYM for the primary stream, not a neighbouring file: `namesGovernedPath('electron/lib/autonomyStop.cjs::$DATA')` returned `null`, `path.resolve` kept the suffix so confinement passed, `lstat` said regular file, `readFileSync` through it returned the real file's **25255 bytes** so the `baseSha256` base-drift check **PASSED**, and a master-approved `patch` APPLIED — the stop module afterwards read `function isStopped(){return false;}`. `shared/loyalty-tripwire.json` was replaced the same way. | Refused as a SPELLING CLASS in `upgradeApplier.spellingRefusal` (any `:` outside a leading drive designator, any control character) before anything resolves it, **and** canonicalised in `autonomyGate.stripSpellings` so the governed-path fence reports it at both origins and at step 3. `+113` assertions: ten spellings × four governed paths × three gates, the applier, an ungoverned control that distinguishes the two refusals, and a protected-file pass over all ten. |
| **`upgradeApplier.cjs`'s step-2 header: *"the loyalty guard, RE-RUN rather than trusted from creation"*** | **FALSE for the stream spelling.** `loyaltyGuard.normalise` (**209–214**) swaps separators, strips a leading `./` and lower-cases; it neither resolves structure nor strips a stream suffix. `guard.inspectChanges` returned `{ok: true, refused: []}` for `electron/lib/loyaltyGuard.cjs::$DATA`, a spelling that reads and writes the real file's bytes. The blind spot is **pre-existing** and `loyaltyGuard.cjs` is protected. | The applier canonicalises each change's path through `gate.normalisePath` **before** handing it to the guard, one change at a time so the refusal still names the spelling master wrote. All ten spellings of a protected file are now refused **at step 2, by the covenant.** The guard itself was not touched; what changed is what it is given. |
| **This note's own §2 row 1 and the in-scope claim *"the STOP unreachable by any proposal"*, a THIRD time — and `autonomyGate`'s own header claim that the fence canonicalises every spelling** | **FALSE for a FOURTH spelling class: an NTFS 8.3 SHORT BASENAME, and this one is not a respelling at all.** `dir /x` reports `AUTONO~1.CJS autonomyStop.cjs`, `AUTONO~2.CJS autonomyPolicy.cjs` and `LOYALT~1.JSO loyalty-tripwire.json` **in the real worktree**. `namesGovernedPath('electron/lib/AUTONO~1.CJS')` returned `null`, `spellingRefusal` returned `null`, `readFileSync` through the spelling returned the real file's bytes so the base-drift check **PASSED**, and a master-approved `patch` APPLIED. Measured reach: at origin `ipc` the long name was refused and **the short name was ALLOWED**, so the renderer route was LIVE. `AUTONO~1.CJS` shares a six-character prefix with the long name and nothing else, so **no character transform could have fixed it.** | **The method was retired, not extended.** `fs.realpathSync.native` — measured: the plain call returns a short path unchanged, `.native` resolves both the short basename and `::$DATA` to the same canonical long path — is consulted in `upgradeApplier.canonicalPathOf`/`validatePath` (which confines the canonical form too), in `autonomyGate.canonicalPath` so `namesGovernedPath` reports it **at both origins**, and in step 2's covenant re-run. `spellingRefusal` and `stripSpellings` are unchanged and still run. `+50` assertions, the short name **discovered at runtime and confirmed by the filesystem**, with a control proving an ungoverned file reached through its own short name still applies. |
| **`upgradeApplier.cjs`'s entry comment: *"`appliedBy`/`appliedAt` are written on the success path only"*** | **FALSE for a CALLER-SUPPLIED one.** The merge spread `proposal.meta.autonomy` and overwrote four keys; these two were not among them. Measured: an entry seeded with `appliedBy: 'master'` and refused at step 3 or step 4 persisted **FAILED while still claiming master applied it**. `autonomousApply` WAS correctly forced to false, so this was an audit-trail defect and not an authorisation one. | Both fields are **deleted immediately after the spread**, above every validation, so the success path below the write loop is the only writer. §17 forces a refusal at three steps with the forgery pre-seeded and asserts neither survives — plus a control that a successful apply still records both. |
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
| **After the first build review** | 29 | 28 | **2949** | 0 |
| **After the second build review** | 29 | 28 | **3035** | 0 |
| **After the third build review** | 29 | 28 | **3148** | 0 |
| **After the fourth build review** | 29 | 28 | **3198** | 0 |

Both numbers in the last row were measured by summing every `N passed, M failed` line the chain prints,
before the round's edits and again after them: **3148 → 3198, `+50`, 0 failures either way**, across
**28** scripts that print a count. `verifyUpgradeApplier.cjs` is **433 → 483**;
`verifyAutonomyStop.cjs` is unchanged at **197**; `verifyInvariants.cjs` and
`verifyLoyaltyTripwire.cjs` are both **ALL PASS**, and the tripwire's `--approve` was **not run**.

The slice is `+680` in total: `+197` from `verifyAutonomyStop.cjs` and `+483` from
`verifyUpgradeApplier.cjs`. The fourth review round added `+50`, all of them in the applier suite,
appended inside §13 and as a new §17 at the end, and **rewrote no row** — the two source-shape rows it
touched were widened only to accept `realpathSync?.native`'s optional chain. The third review round
added `+113`, all of them in the applier suite, and
rewrote one row in place — the `variants` coverage count, seven spellings → ten. The second review round
added `+86` (`+10` and `+76`), rewrote
three rows in place — the `Object.isFrozen(PERMANENT)` clause, the regex over `requireMasterDriven`'s
source, and the four `governedBy` rows — and removed none. The first build-review round added `+160`
(`+40` and `+120`) and
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

### Added by the second build review

- **The trailing-dot and trailing-space measurement is WINDOWS-ONLY.** `lstat` of
  `target.cjs.` returning ENOENT, and a write creating a second directory entry beside `target.cjs`,
  were measured on this machine and nowhere else. On a POSIX host those are ordinary filename
  characters, so the per-segment trim makes the fence **stricter** there than it strictly needs to be —
  never looser — and nothing in this build depends on the difference. The variant rows would behave the
  same on either platform; the *reason* the rows use action `create` rather than `patch` is the Windows
  measurement.
- **`accessSync(W_OK)` does not see an ACL.** Measured: on a read-only FILE it throws `EPERM`, and on a
  directory whose ACL denies writes it returns success, because Windows reports the read-only
  ATTRIBUTE. So the writability probe catches a read-only file, a missing ancestor and an `app.asar`
  root, and **not** an ACL-denied directory. For that case the write loop's `catch` and the revert
  behind it are still what responds — which means the FATAL-halt-on-a-permissions-problem path is
  narrowed, not eliminated. Printed as a residual on every run.
- **`frozenSetView` is not a containment boundary against in-process code.** It removes the mutators and
  hides the backing `Set`, so a stray `delete` is a TypeError instead of a silent demotion. Anything
  already running inside the main process could still replace the module's entry in `require.cache`;
  what holds that line is the same thing that holds it everywhere else in this slice — the asserted
  absence of callers — not the shape of an export.
- **The probe adds one `accessSync` per target per apply.** Unmeasured cost. It is a stat-class call on
  a handful of paths, so it is almost certainly irrelevant, but nobody has timed it.

### Added by the third build review

- **The stream-suffix measurement is WINDOWS-ONLY, and this time the platform difference cuts the other
  way.** That `electron/lib/autonomyStop.cjs::$DATA` resolves, `lstat`s as a regular file, reads the real
  file's 25255 bytes and **writes through to them** was measured on this machine. On a POSIX host `::$DATA`
  is an ordinary filename and the attack is a create of a differently-named file. So the *refusal* is
  correct everywhere and *stricter than strictly necessary* on POSIX — never looser — but **the severity
  of what it prevents is a Windows fact, and this is the only platform it has been observed on.**
- **`:` is now refused in EVERY change path, on every platform.** A colon outside a leading drive
  designator is legal in a POSIX filename. No source file in this project has one, and nothing in the
  shipped tree constructs such a path, so this removes no reachable capability (I11) — but it is a
  behaviour change for a hypothetical future change set, stated here rather than discovered later. The
  refusal names the path and says why.
- **Three spellings were NOT exercised, because a true alternate stream was not written.** The rows assert
  that `:stream` is refused and that no entry appears beside the file. They do **not** assert what would
  have happened had the write proceeded — the round-3 measurement says a hidden stream is created and the
  primary is left intact, and that measurement was taken by the reviewer, not reproduced here.
- **The `meta` route still has no resolution, only substring matching.** That is deliberate and now
  asserted, because folding the colon strip into `normalise` measurably breaks it. The consequence is that
  `meta` is matched by containment: a governed path mentioned anywhere in a persisted `meta` blob is
  caught, and a path *constructed* at apply time from pieces that are individually innocuous would not be.
  No code in this slice constructs one; nothing mechanical prevents it.
- **Step 2 now depends on `autonomyGate` loading.** The applier already required the gate for step 3, so
  this adds no new failure mode — but it does mean the covenant re-run's canonicalisation shares a fate
  with the governed-path fence. If `autonomyGate.cjs` fails to load, `upgradeApplier.cjs` throws at
  `require` and registers no applier at all, which is the safe direction and is **not** the fail-open
  behaviour the create fence's wiring site has.

### Added by the fourth build review

- **The 8.3 short-basename measurement is WINDOWS-ONLY, and so is the fix's necessity.** That
  `electron/lib/AUTONO~1.CJS` is a synonym for `autonomyStop.cjs` — on this volume, for the real
  worktree — was measured here and nowhere else. On a POSIX host there are no 8.3 names and
  `realpathSync.native` resolves symlinks and nothing more, so the second spelling the fence compares is
  simply the resolved path. The fix is therefore **inert on POSIX and necessary here**, and if a future
  platform has a synonym mechanism `realpathSync.native` does not report, this fence misses it again.
- **`fs.realpathSync.native` is now on the gating path, and it is a SYSCALL per change path.** Unmeasured
  cost, on top of the `accessSync` probe. Both are stat-class calls on a handful of paths at a rate of
  one per proposal filing or apply, so it is almost certainly irrelevant — nobody has timed it. More
  importantly: it means the governed-path fence now **depends on the filesystem being answerable**. A
  create gate called for a path on a disconnected network volume gets `''` back and falls through to the
  character comparison, which is the pre-existing behaviour and the safe direction, but it is a
  degradation the suite does not exercise.
- **The ancestor walk is bounded at 64 levels and that bound is arbitrary.** A path deeper than 64
  segments canonicalises to `''` in the gate and is refused outright in the applier. No real source path
  is that deep; the number was chosen, not derived.
- **A FIFTH synonym class is not excluded, and this is recorded as an OPEN RESIDUAL rather than repaired
  on a guess.** Four rounds of character transforms were the wrong approach; asking the filesystem closes
  everything the filesystem will admit to. If something addresses a governed file and
  `realpathSync.native` still reports a different canonical path for it — a hard link's second name in
  another directory is the obvious candidate, since it genuinely IS a different path to the same inode —
  **this fence misses it.** A hard link to a governed file inside the repository root has not been tested
  and `fs.lstatSync().nlink` is not consulted. Stated here so the next reviewer grades a known gap rather
  than discovering an unknown one.
- **The MEDIUM was fixed by deletion, not by a whitelist, and that is a bounded choice.** Anything a
  caller puts in `meta.autonomy` other than `appliedBy`/`appliedAt`/`autonomousApply` still survives onto
  the persisted entry — `note: 'forged'` is asserted to survive, on purpose, because an existing passing
  row depends on it. So the guarantee is narrow and exact: **no field on a FAILED entry claims the apply
  happened.** It is not "the audit record is authored solely by the applier".
- **`npx vite build` still has not been run and still cannot be run from this worktree.** `node_modules`
  is absent. No `.jsx` was touched in this round either.

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
>
> **STATE AFTER THE MERGE ONTO `dev` — BOTH BLOCKS ARE NOW IN THE SPEC, so the two blocks below are
> the SOURCE of what is there and no longer an instruction to paste anything.** Ledger row 152 went in
> at `518a759` as a single line, was corrected in place at `476f5d9`, and sits between rows 151 and 153
> with nothing else in SECTION 28 touched and the I1–I17 block untouched. Section 132's prose was
> pasted in during the merge, between Sections 131 and 133 — it was held out of the branch's copy of
> `RAMA_AGI_MASTER_SPEC.md` deliberately, because that copy was cut at `c595342` and `dev` had since
> grown Sections 129, 130, 131, 133, 134 and 135 into the same region.
>
> **The numbers in Block B below are the BRANCH's numbers and are superseded by the spec's.** The
> branch measured `3198 passed, 0 failed` across 28 counting scripts; after the rebase onto `dev` the
> merged chain measured **4021 passed, 0 failed across 33 counting scripts, 34 chain entries**, with
> `verifyAutonomyStop.cjs` 197 and `verifyUpgradeApplier.cjs` 483 unchanged. Row 152 in the spec
> carries both figures. `npm run build` PASSED in 24.89 s from the main workspace. Read the spec row,
> not this block, for what holds today.

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
precedes comparison, with a control proving the fence resolves paths rather than rejecting
unusual-looking ones.

**The path fence failed FOUR times, on four different spellings, and the fourth one retired the method.**
Round 1 was unresolved structure. Round 2 was a trailing dot and space, which `path.posix.normalize`
leaves alone — graded a NIT because those are genuinely distinct files here, so the governed bytes
survived. Round 3 was an **NTFS alternate data stream**, and that is not a respelling: `file::$DATA` is a
SYNONYM for the primary stream. `path.resolve` keeps the suffix, `lstat` reports a regular file,
`readFileSync` through it returns the real file's bytes — so the `baseSha256` base-drift check, the one
gate whose job is to notice the file is not the file the change was computed from, **passed instead of
catching it** — and a master-approved patch left `autonomyStop.cjs` reading
`function isStopped(){return false;}`. The same spelling replaced `shared/loyalty-tripwire.json` and
carried a patch of `loyaltyGuard.cjs` past the covenant re-run. **A stream suffix and a control character
are now refused as a SPELLING CLASS in the applier before anything resolves them, and canonicalised in
the gate so the fence reports them; and the applier hands the loyalty guard the canonical path, because
the guard is protected and its own comparison does not resolve either.** Ten spellings × four governed
paths × every gate, plus a protected-file pass, and every row asserts the governed file is
**byte-identical afterwards** — the assertion whose absence let round 2 grade this class a NIT.

Round 4 was an **NTFS 8.3 short basename**, and it is the one that ended the approach. `dir /x` reports
`AUTONO~1.CJS autonomyStop.cjs` and `LOYALT~1.JSO loyalty-tripwire.json` **in the real tree**, the short
name shares a six-character prefix with the long one and nothing else, and at origin `ipc` the long name
was refused while the short name was **allowed** — so the renderer route was live, not latent. **No
fifth character transform was written.** The fence now asks the filesystem:
`fs.realpathSync.native` — measured, the plain call returns a short path unchanged — resolves the short
basename *and* `::$DATA` to the same canonical long path, so one question closes all four classes and
any further synonym the filesystem will admit to. It is consulted in the applier's `validatePath`
(which confines the canonical form too), in the gate so the fence reports the spelling **at both
origins**, and in the covenant re-run. The character canonicalisers were kept and still run, because
they answer for a name that addresses nothing yet. **The lesson, recorded because it is the reusable
part: a path fence must be proven by EXECUTING the attack and reading the bytes back, not by reading the
comparison — and after the second miss, stop enumerating spellings and ask the authority that owns the
namespace.** One residual is stated rather than guessed at: a hard link's second name is a different
canonical path to the same inode, `nlink` is not consulted, and that case is untested.

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
| 152 | The stop, the policy table, and the gate on `proposals:create` — built before there is anything autonomous | done | Section 132 — **the section's prose is NOT in this document yet; it is paste-ready in `docs/research/self-upgrade-build.md` §6 Block A**, held out of this file deliberately so this row is a one-line insertion that rebases cleanly onto `dev`. **THE LOCKED DECISION, master's option 1: I6 and I17 stay INTACT — Rāma proposes, master approves, and nothing in this slice applies a source change without a recorded approval. No autonomy rung was climbed.** The STOP is built BEFORE anything is autonomous, because a stop retrofitted onto a running loop is the one thing that must not be retrofitted. **BUILT: four modules — `electron/lib/autonomyStop.cjs` (the fail-safe switch), `autonomyPolicy.cjs` (fifteen classes over frozen floors/ceilings/permanence), `autonomyGate.cjs` (the create fence) and `upgradeApplier.cjs` (entry validation plus a byte snapshot) — and two suites, `verifyAutonomyStop.cjs` (197) and `verifyUpgradeApplier.cjs` (483), appended to the end of the `verify` chain and never reordered. 2518 → 3198 assertions, 0 failures across 28 counting scripts; `verifyInvariants.cjs` and `verifyLoyaltyTripwire.cjs` both ALL PASS and the tripwire's `--approve` was never run.** **TWO PREDICATES, AND THE ASYMMETRY IS THE DECISION: `isStopped()` is fail-safe — no `<userData>/rama/autonomy.allow`, an unreadable file, invalid JSON, `"true"`, `1`, `{}`, `null` or a directory there all mean STOPPED — and it governs NEW autonomous action only. `isHalted()` is true only on an explicit `engage()` or `RAMA_AUTONOMY=stop` and is the predicate the four PRE-EXISTING dispatchers will consult when a teardown is built; NOTHING CALLS IT YET and the module says so. Governing those four with the fail-safe predicate would have deleted five shipping behaviours on every install until master hand-created a file nobody had told him about — `ollama-catalog`, `dependency-review`, the metacognition audit, selfCare's 120s sweep including `checkInstanceFailover`, and marketIntel's two ticks — a regression wearing a fail-safe argument, which I11 has no exception for. A counting fake proves a default install still dispatches.** **SEVEN PERMANENT POLICY CLASSES THE DATA FILE IS NOT READ FOR AT ALL** (`apply-source`, `revert-own-apply`, `release-classify`, `capability-grant`, `loyalty-core`, `master-record` — Section 127 — and `autonomy-policy`), with the editable eight DERIVED from them so two lists cannot disagree; `shared/autonomy-policy.json` ships ABSENT so the floors are the shipped levels, and a file that so much as names a permanent class is rejected WHOLE. **THE DEFECT TWO REVISIONS EACH THOUGHT THEY HAD FIXED: on a shipped install every class resolves to L0, so an unconditional `policy.require('revert-own-apply','L4')` at the applier's entry REFUSED A MASTER-APPROVED APPLY on every install — hidden because the row testing it used an allow-file fixture. The level now comes from `requireMasterDriven` over the frozen two-member `MASTER_ACT` subset, both members also PERMANENT so no data edit can refuse master either, and the first assertions in the suite run in the state a real install boots into: no allow-file, no policy file, master's apply SUCCEEDS.** **THE HOLE A LATER SESSION COULD NOT RECONSTRUCT, FOUND BY EXECUTING THE ATTACK RATHER THAN READING THE CODE: `autonomyGate.normalise` swapped separators and stripped a leading `./` but NEVER RESOLVED PATH STRUCTURE, so `electron/lib/./autonomyStop.cjs`, `electron//lib/autonomyStop.cjs`, `electron/lib/../lib/autonomyStop.cjs` and the backslash form all read as naming nothing governed — a `self-upgrade` proposal with a correct `baseSha256` passed the create gate at BOTH origins and the applier's step 3, and the stop module on disk afterwards read `function isStopped(){return false;}`. `autonomyStop.cjs` is not in `PROTECTED_FILES`, so nothing downstream objected. I6 still held — the apply needed master's recorded approval — but the diff should never have been fileable. FIXED BY RESOLVING BEFORE COMPARING (`path.posix.normalize`), plus per-segment trimming of a trailing dot or space, which `normalize` does not collapse and which on this platform left `autonomyStop.cjs.` and `autonomyStop.cjs ` readable as ungoverned. Ten spellings × four governed paths × every gate, with a control proving the fence RESOLVES paths rather than refusing odd-looking ones.** **THE SAME FENCE FAILED A THIRD TIME, ON THE ONE SPELLING THAT IS NOT A RESPELLING: an NTFS alternate data stream. `file::$DATA` is a SYNONYM for the primary stream, so `path.resolve` kept the suffix, `lstat` said regular file, `readFileSync` through it returned the real file's 25255 bytes — and the `baseSha256` base-drift check, whose entire job is to notice the file is not the file the change was computed from, PASSED instead of catching it. A master-approved patch left `autonomyStop.cjs` reading `function isStopped(){return false;}`; the same spelling replaced `shared/loyalty-tripwire.json` and carried a patch of `loyaltyGuard.cjs` past step 2's covenant re-run with `inspectChanges` returning `{ok:true,refused:[]}`. Round 2 graded the trailing-dot class a NIT because the governed bytes SURVIVED; this is the first class where they did not. FIXED IN TWO PLACES AND A THIRD NOBODY ASKED FOR: `upgradeApplier.spellingRefusal` refuses a `:` outside a leading drive designator and any control character for EVERY path before anything resolves it, so the revert path — whose own failure is fatal and revokes master's allow-file — is never entered for it; `autonomyGate.stripSpellings`/`normalisePath` canonicalise the same two so `namesGovernedPath` reports them at both origins and at step 3; and the applier now hands `loyaltyGuard.inspectChanges` the CANONICAL path, because that guard's own comparison does not resolve structure or strip a stream suffix either and it is a protected file this build cannot fix. The colon strip is deliberately NOT in `normalise`: `normalise` is applied to the stringified `meta` blob and JSON is full of colons — measured, folding it in turns `{"plan":"then patch electron/lib/x.cjs"}` into `{"plan"/lib/x.cjs"}` and the meta scan MISSES a path it catches today. Every variant row now asserts the governed file is BYTE-IDENTICAL afterwards, which is the assertion whose absence let round 2 grade this class a NIT.** **OPEN GAP, STATED PLAINLY RATHER THAN ASSUMED COVERED: `shared/autonomy-policy.json`, `electron/lib/autonomyPolicy.cjs`, `electron/lib/autonomyStop.cjs` and `shared/loyalty-tripwire.json` are NOT in `loyaltyGuard.PROTECTED_FILES` (seven entries, tripwire-asserted), so they are not tamper-evident by that route — the create fence and the applier's entry validation are the only mechanical guards on them today. `loyaltyGuard.cjs` and `shared/capabilities.json` are protected and invariant-adjacent, so this build ASKS: add those four paths to `PROTECTED_FILES` and the tripwire manifest, and add `"system.suspend-autonomy": 0` and `"autonomy.view": 1` to the matrix. Until the capability exists, `lift()` cannot succeed for anyone including master, and the refusal names the file he writes by hand instead of rendering a dead button.** **THE FENCE FAILED A FOURTH TIME AND THE METHOD WAS RETIRED RATHER THAN EXTENDED: an NTFS 8.3 SHORT BASENAME. 8.3 generation is live on this volume for the REAL worktree — `dir /x` reports `AUTONO~1.CJS autonomyStop.cjs`, `AUTONO~2.CJS autonomyPolicy.cjs`, `LOYALT~1.JSO loyalty-tripwire.json` — and `AUTONO~1.CJS` shares a six-character prefix with the long name and NOTHING ELSE, so no transform over the characters could ever have recovered the governed name; a fifth filesystem synonym would have defeated the fence the same way. Measured before the fix: `namesGovernedPath` returned null, `spellingRefusal` returned null, `readFileSync` through the spelling returned the real file's bytes so the base-drift check PASSED, and a master-approved patch APPLIED. And the reach was worse than round 3: at origin `ipc` the LONG name was refused while the SHORT name was ALLOWED, so the renderer route was LIVE rather than latent. FIXED BY ASKING THE FILESYSTEM INSTEAD OF THE CHARACTERS — measured on this platform, `fs.realpathSync` returns a short path UNCHANGED and is useless, while `fs.realpathSync.native` resolves BOTH `AUTONO~1.CJS` and `autonomyStop.cjs::$DATA` to the same canonical long path, so one call closes all four spelling classes and any further synonym the filesystem will admit to. Consulted in `upgradeApplier.canonicalPathOf`/`validatePath` (which confines the canonical form too, canonicalising the ROOT on the same call because `os.tmpdir()` is itself a short path here, and refusing by name when the filesystem will not canonicalise an existing file), in `autonomyGate.canonicalPath` so `namesGovernedPath` reports the spelling AT BOTH ORIGINS, and in step 2's covenant re-run — `loyaltyGuard.cjs` is not a SELF_GOVERNING_PATH, so step 2 was the only thing between `LOYALT~1.CJS` and the covenant file's own bytes. `spellingRefusal` and `stripSpellings` are UNCHANGED and still run: they are the cheap refusal for a name that is not yet a synonym of anything. The suite discovers the short name AT RUNTIME and accepts a candidate only when `realpathSync.native` of it returns the same canonical path as the long name — `~1` versus `~2` depends on directory creation order, which is why `LOYALT~1.CJS` names `loyaltyCore.cjs` in the worktree and `loyaltyGuard.cjs` in a fixture — and SKIPS with a printed residual on a volume where 8.3 generation is off, never a silent pass. A control row proves an UNGOVERNED file reached through its own short basename still applies, with the bytes landing in the long-named file. OPEN RESIDUAL, STATED RATHER THAN GUESSED AT: a hard link's second name inside the repository root genuinely IS a different canonical path to the same inode, `nlink` is not consulted, and that case is untested — the next review should grade a known gap rather than discover an unknown one.** Four build-review rounds were fixed in place rather than re-implemented: round 1 (1 HIGH / 2 MEDIUM / 3 NIT, +160), round 2 (1 MEDIUM / 7 NIT, +86), round 3 (1 HIGH, +113) and round 4 (1 HIGH / 1 MEDIUM / 1 NIT, +50) — the frozen `Set`s that were mutable because `Object.freeze` freezes properties and not internal slots, a fence asserted by regex and now executed, both master-driven classes resolved instead of only the revert net, `appliedBy` no longer written onto an entry refused at the door, an unwritable destination refused as an environment problem instead of becoming a FATAL revert that revoked master's allow-file, and a CALLER-SUPPLIED `appliedBy` deleted at entry because the merge spread an untrusted `meta.autonomy` and a seeded `{appliedBy:'master'}` survived onto an entry persisted FAILED — an audit-trail defect rather than an authorisation one, since `autonomousApply` was already forced to false and no byte was written. **`node_modules` is absent from the worktree, so `vite build` was NOT run — no `.jsx` changed. NOT VERIFIED: the app has never booted with these modules loaded, `app.getPath('userData')` has never been resolved (every row injects a scratch root), `fileProposal` has no caller in the shipped tree, `engage()` tears down nothing by design, `lift()` has never succeeded against the real capability matrix, and a torn read of a hand-edited policy file falls back to the floors.** **NEXT STEP: the five-stage NOTICE/RESEARCH/WEIGH/PROPOSE/ANALYSE loop and `upgradeAuthor.cjs`, both DEFERRED and blocked on design-review findings 2 and 5 — see `docs/research/SELF_UPGRADE.md` § DEFERRED BY THE ORCHESTRATOR for the full deferred list with the finding id gating each item. Before any of it: paste Section 132 from the build note, and decide the two protected-file/capability additions above, because the loop files proposals and the fence on its own state is not complete without them.** |
```
