# Requirements — Rāma AGI model-evaluation tranche 1: verification machinery

**Worktree:** `.worktrees/model-eval`, branch `model/agi-evaluation`, base commit `8c1c9ee`.
**Source of truth for scope:** `docs/research/RAMA_MODEL_EVALUATION.md` §6.1 (R-L1), §6.3 (R-L2),
§5(b) and roadmap row 2.4 (staleness), and roadmap phase 1 ordering.
**`RAMA_AGI_MASTER_SPEC.md` is read-only for this tranche.** Section 28's invariant table was read
to extract enforcement points; nothing in it is edited or re-litigated here.

---

## Summary

This tranche builds the verification machinery that must exist **before** any capability upgrade,
and nothing else. The evaluation measured 1,970 assertions across 22 suites and found that **every
one of them tests a module that implements an invariant, and none tests an invariant** — grepping
all `scripts/verify*` for `I1[5-7]|invariant` returns four hits, three of which are comments. An
invariant that holds only because the current code happens to honour it, with nothing positioned to
notice when it stops, is the same drift class the ledger already named twice (rows 48, 89).

Three deliverables, in dependency order:

1. **R1 — the invariant assertion suite.** One named row per I1–I17 that fails when the
   invariant's *enforcement point* is removed, renamed, bypassed or weakened. Not a suite that
   re-tests the modules. Needs no engine, no network, no `node_modules`.
2. **R2 — the loyalty-core tripwire.** A change touching `electron/lib/loyaltyGuard.cjs`,
   `electron/lib/loyaltyCore.cjs`, `electron/nucleusSealer.cjs`, or a tier-0 entry of
   `shared/capabilities.json` fails the build unless master's approval for **that exact content**
   is recorded, in I6's two-record pattern.
3. **R3 — generalised staleness reporting**, and **only if it can be done purely additively**
   without touching the loyalty core. `costs.staleness()` is the existing pattern to generalise.

Everything else in the evaluation's requirement index (R-C1, R-C2, R-L3–R-L7, R-M*, R-A*, R-G*,
R-O*) stays in the roadmap and is explicitly out of scope below.

### Facts measured in this worktree while authoring (used by the criteria)

| Fact | Command | Value |
|---|---|---|
| `node_modules` absent | `Test-Path node_modules` | `False` — so every criterion below is dependency-free |
| Existing suites runnable here | `npm run verify:claim-gate` | 98 passed, 0 failed |
| Bridge audit runnable here | `node scripts/auditRenderer.cjs` | 139 bridge calls, 76 files, 365 IPC channels, all resolve |
| `PROTECTED_FILES` | `electron/lib/loyaltyGuard.cjs:64-72` | **7** entries |
| Capability matrix | `shared/capabilities.json` | **77** capabilities, **29** at tier 0 |
| `loyaltyCore` export list | `electron/lib/loyaltyCore.cjs:375-379` | `sealCore, openCore, lock, isOpen, withCore, attest, covenantHolds, displayIdentity, describe, fingerprint` + 5 constants |
| `resourceOrchestrator.admit` call sites | grep `\.admit\(` | `agentOrchestrator`, `instanceManager`, `sandboxEngine`, `resourceResearchEngine` |
| Raw `require('http'/'https')` hits outside `lib/http.cjs` | grep | 2: `selfRepair.cjs:45` (declared exception) and `main.cjs:384` — **which is inside a comment** |
| `console.log` hits in shipped dirs | grep | 4, **all of them comments or detector string literals** (`astEngine`, `safeRequire`, `verifyProposal`) |
| Git tags | `git tag` | **none** — a tripwire keyed to `<lastTag>..HEAD` has no base here |
| `.rama/` | `Test-Path .rama` | absent; must be created by the implementation |
| Engine / renderer build | — | **not runnable here**: `import numpy` raises, `vite build` needs `node_modules` |

The two grep lines above are load-bearing: **naive pattern matching produces false positives on
this exact tree**, so R1's source-shape rows must strip comments and string literals before
matching, and must prove both directions (green on HEAD, red on a planted breach).

---

## Functional requirements

### R1 — Invariant assertion suite (`scripts/verifyInvariants.cjs`), implementing R-L1

**R1.1 One row per invariant, named for the invariant.** The suite reports a row whose label
begins with the invariant id (`I1` … `I17`), so a failing assertion names the rule that broke, not
the module that happened to notice. Exit code is non-zero if any row fails.

**R1.2 It asserts the enforcement point, not the feature.** Each row must fail if the enforcement
named in Section 28's "Where enforced" column is removed, renamed, bypassed or weakened. Two
assertion kinds are permitted and only these two:

- **behavioural** — call the enforcement point and assert the refusal (preferred wherever the
  module is requireable without `node_modules`);
- **source-shape** — assert the call exists at the chokepoint, or that a forbidden shape is absent,
  after comments and string literals have been stripped.

A row that can only be source-shape must say so in its label, so the weaker assertion is visible
rather than implied.

**R1.3 The rows.** Taken from the evaluation's R-L1 table; each is cheap today.

| Inv | What the row asserts | Kind |
|---|---|---|
| I1 | `sessionManager.masterUnlock`'s success return carries **no `user` and no `token`** key; its failure return is `{ok:false,error}` | behavioural (electron stubbed) |
| I2 | `server/routes/auth.cjs` contains no user table and no login route | source-shape |
| I3 | a wrong passcode returns an explicit rejection and **does not** take a first-run branch — `cryptoCore.verifyPasscode` false ⇒ `{ok:false}`, and `hasVerifier` gates the first-run branch | behavioural |
| I4 | `authCore.createUser` refuses `tier: 0` after provisioning; `provision` is once-only | behavioural |
| I5 | the stored access-key record contains an HMAC and **no recoverable key**; the plaintext key is returned once and not persisted | behavioural |
| I6 | `proposals.apply` on a `pending` proposal refuses; `approve(id, 'master')` with a **string** approver refuses naming I6; `authorise` denies a user without a numeric tier | behavioural |
| I7 | every page/route/tier/voice entry in `src/config/registry.js` resolves (lean on `auditRenderer`'s existing pass rather than re-implementing it) | behavioural via existing audit |
| I8 | all three runtimes read `shared/capabilities.json` — assert each runtime's require/import resolves to that one file, and that no second tier table exists | source-shape |
| I9 | no module outside `electron/lib/http.cjs` performs an outbound request through a raw `http`/`https` require; `selfRepair.cjs` is the **declared exception** and must be named as one in a list inside the suite, with its reason | source-shape, comment-stripped |
| I10 | every spawn path calls `resourceOrchestrator.admit`; the four known call sites are asserted **and a fifth spawn site without an admit fails the row** | source-shape with a counted baseline |
| I11 | no `catch` block restores the behaviour its engine replaced (the Section 122 `fitContent` lesson); every engine declaring a fallback exposes it | source-shape |
| I12 | no `^`/`~` in `package.json` dependency ranges; no real `console.log` in shipped code (`electron/`, `server/`, `shared/`, `src/`); no real `TODO`/`FIXME`/placeholder marker — all three after comment and string-literal stripping | source-shape |
| I13 | **declared un-assertable in-process** (git workflow). Reported as `DECLARED UNASSERTABLE — git workflow, see I13` and counted in its own bucket, never as a pass and never silently omitted | declaration |
| I14 | `sessionManager.changePasscode` calls `markAllDirty()` and re-derives before rewriting, in that order | behavioural + source-shape ordering |
| I15 | a non-conforming nucleus **cannot be encrypted** (`encryptNucleus` throws `LoyaltyViolation`); a patch naming `loyalty`/`ethics`/`ethicalCore` at **any** depth is refused; a patch carrying `__proto__` is refused; `proposals.create` refuses **each of the 7** `PROTECTED_FILES`, and the row fails if the list's length changes without the row being updated | behavioural |
| I16 | **no exported function of `loyaltyCore` returns an object containing the matrix** — enumerate every export, invoke each, assert the returned shape: `attest()` → boolean, `covenantHolds()` → `{ok, violations}`, `displayIdentity()` → exactly `{master}`, `describe()` → metadata only, `fingerprint()` → a hash. Plus: `withCore` scrubs (the passed object's keys are nulled after return), and repeated failed opens escalate then refuse | behavioural, matrix never requested |
| I17 | `releaseChannel` performs no tag/publish/bump without `release.cut`; `refreshScheduler`'s registered task list is **exactly** `ollama-catalog` and `dependency-review`, and **neither writes** | behavioural + counted baseline |

**R1.4 I16 is never weakened to make it testable.** No row may call for the loyalty matrix to be
returned, and no accessor may be added to `loyaltyCore` for the suite's benefit. The testable
surface is the **shape of what comes back** from the existing exports. If an assertion cannot be
written without the matrix, it is dropped and the gap is recorded in this document's open-items
section — never closed by adding an accessor.

**R1.5 A planted-breach self-test.** The suite supports `--self-test`: for every row (except I13),
it applies a planted mutation to a **copy** of the relevant file in `os.tmpdir()` and asserts that
the row **fails** against the mutated copy. This is the property that distinguishes "asserts the
invariant" from "tests the module", and it is the only mechanical proof that the suite would notice
a weakening. The repository working tree is never mutated.

**R1.6 An unavailable probe fails the row; it never skips it.** If a module cannot be required, a
file cannot be read, or a stub is missing, the row **fails** naming the reason. A skipped row is a
silent hole, and the counted-baseline rows (I10, I15, I17, and the tier-0 set in R2) exist because
coverage drift is the failure mode ledger row 118 recorded.

**R1.7 No network, no `node_modules`, no Electron runtime.** Modules that require `electron` at
load time (`dataStore`, `nucleusSealer`, `sessionManager` transitively) are reached through the
established stub pattern in `scripts/verifyEngineDiagnosis.cjs:26-40` — `Module._resolveFilename`
patched plus a `require.cache` entry, restored immediately after. No new mechanism is invented.

**R1.8 Wired into `npm run verify`.** Appended to the `verify` chain in `package.json`, with its own
`verify:invariants` script entry, following the existing naming. Wiring it into `start.cjs` stage 1
is **deferred** (see Out of scope) — a halted boot has no fallback, which is an I11 decision for
master, not a side effect of this tranche.

### R2 — Loyalty-core tripwire (`scripts/verifyLoyaltyTripwire.cjs`), implementing R-L2

**R2.1 The guarded set.** `electron/lib/loyaltyGuard.cjs`, `electron/lib/loyaltyCore.cjs`,
`electron/nucleusSealer.cjs`, the **tier-0 entries** of `shared/capabilities.json` (29 measured —
derived from the file at run time, never hardcoded), and the approvals file itself (R2.4).

**R2.2 Digest-matched approval, not a flag.** A guarded file whose current sha256 differs from the
recorded baseline digest **fails the build**, naming the file, the expected digest and the found
digest — unless an approval entry matches the **new** digest exactly. A boolean flag is set once and
forgotten; a digest means the approval covers that exact content, so a second edit after approval
fails again.

**R2.3 `capabilities.json` is checked at content level, not only by digest.** The baseline records
the tier-0 **set**. Removing a tier-0 entry or demoting one to a higher tier number fails, naming
the capability and both tiers (the evaluation's worked example: `release.cut` 0 → 1 must fail).
Promoting a capability **to** tier 0 is a tightening: allowed, reported, and recorded into the
baseline only by R2.6's explicit baseline command.

**R2.4 Two records must agree (I6's pattern).** An approval entry in `.rama/tripwire-approvals.json`
carries `{path, sha256, approvedAt, approvedBy, reason, ledgerRef}` and is **committed to git** —
an approval that is not in version control is not a record. The entry is valid only when the digest
matches **and** `ledgerRef` names text that the tripwire finds in `RAMA_AGI_MASTER_SPEC.md`. The
tripwire **reads** the spec and never writes it. An entry with no resolvable `ledgerRef` fails.

**R2.5 It cannot approve itself.** `.rama/tripwire-approvals.json` is itself in the guarded set, so
an edit to the approvals file is only accepted when the corresponding `ledgerRef` resolves. The
failure message must distinguish "this file changed" from "this approval does not cover this
content".

**R2.6 Baselines are recorded explicitly.** `--record-baseline` is the only path that writes
`.rama/tripwire-baseline.json`; it prints every digest it records and refuses to overwrite an
existing baseline unless `--force` is passed. No code path records a baseline as a side effect of a
check, because a check that silently re-baselines is a check that always passes.

**R2.7 Fail closed, and name why.** If a guarded file, the baseline, the approvals file or the spec
cannot be read, the tripwire **fails** with the reason. It is offline by construction: it must not
invoke `git` for its verdict (there are no tags here, so `<lastTag>..HEAD` has no base) and must not
reach the network. Git may be used only for advisory context in the output.

**R2.8 Two entry points, one implementation.** Runnable standalone
(`node scripts/verifyLoyaltyTripwire.cjs`), wired into `npm run verify`, and called from
`scripts/beforeBuild.cjs` so it also fails before a package. The packaging path cannot be exercised
in this worktree (no `electron-builder`); that limitation is stated, not papered over.

### R3 — Generalised staleness / degradation reporting — CONDITIONAL

**R3.0 The gate on doing this at all.** Implement only if every change is **additive**: a new module
plus **added** keys on existing return shapes. If any consumer would require changing, renaming or
removing an existing key, R3 is **deferred to the roadmap** and the reason is recorded in this
document's open-items section. Partial adoption of the consumers in R3.3 is acceptable; a breaking
change to one of them is not.

**R3.1 One vocabulary, one module.** A new `electron/lib/staleness.cjs`: pure, dependency-free,
core-Node only, clock injected. It generalises `ai_backend/engine/costs.py:staleness()` and mirrors
its field names so the project has one vocabulary across both runtimes: `{asOf, days, stale,
warning}` plus `neverFetched`.

**R3.2 "Nothing was read" is not "nothing happened."** `neverFetched: true` is distinct from
`days: 0` and distinct from `stale`. A never-fetched fact must never render as fresh, and must never
render as a measurement of absence. This is `charge_watch.py`'s rule applied generally, and
`buildFallbackResults` (ledger row 114 — a search-failure marker that scored 0.60 and passed
vetting) is the cautionary case the rule exists for.

**R3.3 Additive adoption on surfaces that already carry a timestamp.** `ollamaCatalog`,
`ollamaLibrary`, `dependencyAdvisor`'s review output, and `refreshScheduler.status()`. Every key
those functions return today must still be present with the same value; staleness arrives as added
keys only.

**R3.4 It does not touch the loyalty core.** No change to `loyaltyGuard.cjs`, `loyaltyCore.cjs`,
`nucleusSealer.cjs` or `shared/capabilities.json`. R2 is the mechanical proof of this, run after
R3's commit.

**R3.5 Fallback (I11).** A consumer with a missing or unparseable timestamp reports
`neverFetched: true` and never throws. If `staleness.cjs` cannot be loaded, each consumer returns
exactly its pre-R3 shape.

**R3.6 `costs.py` is unchanged in this tranche.** The Python engine cannot be run here
(`import numpy` raises), so the rate table's own staleness stays as it is; the JS module copies its
vocabulary rather than the reverse.

### R4 — Regression safety for the tranche

**R4.1** `npm run verify` contains the new suites and every existing suite still passes.
**R4.2** `node --check` passes on every `.cjs` touched or added.
**R4.3** No `.jsx` is touched, so no renderer diagnostics are claimed; `node scripts/auditRenderer.cjs`
still reports all bridge calls, identifiers and IPC channels resolving.
**R4.4** No dependency is added. No `^`/`~` enters `package.json`.
**R4.5** The build is **not** claimed: `node_modules` is absent here, so `vite build` cannot be run
and is reported as not run.

---

## Non-functional requirements

1. **Offline and dependency-free.** All three deliverables run with no network, no `node_modules`
   and no Python. This is the reason this tranche was chosen first.
2. **Deterministic.** Clocks are injected (`useClock`, the `popoutGrant` pattern); no assertion
   depends on wall-clock time, locale or timezone.
3. **Fast.** The three new suites together add under 10 seconds to `npm run verify` on master's
   machine; no suite sleeps.
4. **Windows-safe paths.** Path comparison normalises separators the way
   `loyaltyGuard.inspectChanges` already does; a `C:\`-prefixed absolute path and a repo-relative
   path must compare equal.
5. **Writes are bounded.** Temp artefacts go to `os.tmpdir()` and are removed; the only repository
   writes are `.rama/tripwire-baseline.json` and `.rama/tripwire-approvals.json`, both only via
   explicit flags.
6. **I12 holds for the code added.** No `console.log` in anything under `electron/`, `server/`,
   `shared/` or `src/`. `scripts/` suites keep the existing `console.log` PASS/FAIL reporter
   convention used by all 22 current suites — the I12 row's shipped-code scope is defined
   accordingly, and that scope definition is asserted so it cannot be quietly widened to excuse a
   real breach.
7. **No placeholders, no TODOs, no stubs** in anything shipped (I12). A row that cannot be asserted
   is declared un-assertable in output (I13's treatment), never left as an empty passing test.
8. **Additive (I11).** Nothing existing is removed or renamed. The 22 current suites and their
   1,970 assertions keep running unchanged.

---

## Acceptance criteria

Each criterion names the command that proves it and the failing case that proves it is not vacuous.
All commands run from `.worktrees/model-eval` on Windows PowerShell.

**AC1.** `node scripts/verifyInvariants.cjs` exits 0 and prints exactly **17** invariant rows,
labelled `I1`…`I17`, with I13 in a `DECLARED UNASSERTABLE` bucket counted separately from passes.
*Failing case:* a run that prints 16 rows, or that counts I13 as a pass, fails this criterion.

**AC2.** `node scripts/verifyInvariants.cjs --self-test` exits 0, and for each of the 16 assertable
invariants reports that the planted mutation **made the matching row fail**. *Failing case:* if a
planted mutation leaves its row green, the self-test exits non-zero naming the invariant whose row
did not notice. After the run, `git status --porcelain` shows no modification to any tracked file.

**AC3.** I16's row never requests the matrix: `Select-String -Path scripts/verifyInvariants.cjs
-Pattern "loyaltyPriority|COVENANT\.master"` returns **only** occurrences used as *forbidden
tokens being searched for* — the suite asserts their absence from returned shapes and from the
`loyaltyCore` export surface. *Failing case:* any assertion that reads a matrix value, or any new
export added to `loyaltyCore.cjs`, fails — and `node scripts/verifyLoyaltyTripwire.cjs` fails too,
because the file's digest changed without approval.

**AC4.** Counted baselines bite. Appending an eighth entry to `PROTECTED_FILES` without updating
I15's row, adding a fifth `admit`-less spawn site, or registering a third `refreshScheduler` task,
each makes the corresponding row fail, naming the drift. *Proved by:* the `--self-test` mutations
for I10, I15 and I17.

**AC5.** Comment- and string-stripping works on this exact tree. The I9 and I12 rows are **green on
HEAD** despite the four `console.log` hits and the `require('http')` hit that greps find — all of
which are comments or detector string literals — and go **red** when a real
`console.log('x')` is planted in `electron/lib/http.cjs`, or a real `require('https').get(` is
planted in `electron/lib/modelRoles.cjs`, in the temp copies used by `--self-test`.

**AC6.** `npm run verify` exits 0 and its output includes the invariant suite and the tripwire.
*Failing case:* `npm run verify` after planting any single invariant breach in the working tree
exits non-zero and the failing line names the invariant.

**AC7.** The tripwire is green on an unmodified tree: `node scripts/verifyLoyaltyTripwire.cjs`
exits 0 after `--record-baseline` has recorded the current digests.

**AC8.** No approval ⇒ fail. Appending a blank line to `electron/lib/loyaltyGuard.cjs` makes
`node scripts/verifyLoyaltyTripwire.cjs` exit non-zero, naming the file, the expected digest and
the found digest. Reverting the line makes it pass again.

**AC9.** Stale approval ⇒ fail. With an approval entry recorded for digest *A* and the file now at
digest *B*, the tripwire exits non-zero and distinguishes "this approval does not cover this
content" from "this file changed".

**AC10.** Matching approval ⇒ pass. With an approval entry carrying digest *B*, a `reason`, and a
`ledgerRef` whose text exists in `RAMA_AGI_MASTER_SPEC.md`, the tripwire exits 0. Removing the
`ledgerRef` text from the spec, or blanking the field, makes it exit non-zero.

**AC11.** Tier-0 demotion ⇒ fail. Editing `shared/capabilities.json` so `release.cut` is `1`
instead of `0` makes the tripwire exit non-zero naming `release.cut`, `0` and `1`. Deleting a
tier-0 entry fails the same way. Adding a new tier-0 capability is reported and does **not** fail.

**AC12.** Fail-closed. Renaming `.rama/tripwire-baseline.json` away, or making a guarded file
unreadable, makes the tripwire exit non-zero with the reason named — never exit 0 on an
indeterminate verdict. `Select-String -Path scripts/verifyLoyaltyTripwire.cjs -Pattern
"require\('https?'\)|execSync\('git"` shows no network call and no git call on the verdict path.

**AC13.** The tripwire cannot be side-stepped by editing its own approvals: adding an entry to
`.rama/tripwire-approvals.json` with no resolvable `ledgerRef` fails, and the approvals file's own
digest is checked.

**AC14.** `scripts/beforeBuild.cjs` calls the tripwire: `Select-String -Path
scripts/beforeBuild.cjs -Pattern "verifyLoyaltyTripwire"` matches, and `node --check
scripts/beforeBuild.cjs` passes. The packaging run itself is **reported as not exercised** here.

**AC15.** (R3, if implemented) `node scripts/verifyStaleness.cjs` exits 0 and asserts:
`neverFetched` is returned for a missing timestamp; `days` and `stale` are returned for a present
one; `stale` flips exactly at the declared budget boundary; the warning sentence names the date,
the age and where to re-check; `neverFetched` never coexists with a numeric `days`.

**AC16.** (R3) Additivity is proved, not asserted in prose: for each adopted consumer, the suite
holds a fixture of the **pre-R3 return shape** and asserts every one of those keys is still present
with the same value. *Failing case:* renaming or dropping any existing key fails the suite.

**AC17.** (R3) `node scripts/verifyLoyaltyTripwire.cjs` exits 0 on the R3 commit, mechanically
proving the loyalty core was not touched. *Failing case:* any edit to the four guarded paths makes
this fail.

**AC18.** (R3) Fallback holds: with `electron/lib/staleness.cjs` renamed away, each adopted
consumer still returns its pre-R3 shape and throws nothing. Proved by a fixture run in
`verifyStaleness.cjs` that stubs the module's absence.

**AC19.** `node --check` passes on every added/modified `.cjs`; `node scripts/auditRenderer.cjs`
exits 0 with 139 bridge calls and 365 IPC channels resolving; `git diff --name-only` shows no
`.jsx` touched.

**AC20.** `npm run verify` suite count increases from 22 to 24 (25 with R3), total assertions
increase, and **no existing assertion count decreases**. *Failing case:* a suite that goes quiet is
treated as a regression, per ledger row 118's lesson.

---

## Assumptions

1. **`npm run verify` is the gate that matters for "fails the build" in this tranche.** The
   evaluation also asks for `start.cjs` stage 1; that is deferred with a reason (below) because
   halting a boot is a policy decision for master under I11.
2. **The approvals and baseline files are committed.** An approval that lives only on master's
   machine is not a record. `.gitignore` does not currently exclude `.rama/`, so no change there is
   needed; the implementation must confirm this rather than assume it.
3. **Tier-0 membership is derived from `shared/capabilities.json` at run time.** The evaluation says
   23 tier-0 entries; this worktree measures **29**. The baseline is recorded from the file, never
   hardcoded, so the divergence is immaterial to correctness — but it is recorded here because a
   hardcoded 23 would have shipped a wrong number.
4. **I5's enforcement is asserted behaviourally, by the real export name.** Section 28 names
   `authCore.mintKey`; the module exports `issueAccessKey` / `keygenAuthenticated` /
   `keygenFromStepToken` / `keygenFromCredentials` and no `mintKey`. The row asserts the
   **behaviour** (stored record carries an HMAC, no recoverable key) against the real exports. The
   naming divergence is **raised, not fixed** — the spec is not edited by this tranche.
5. **I7 is asserted by leaning on `auditRenderer`,** which runs here without `node_modules`
   (measured). Re-implementing registry resolution would create a second definition of "resolves".
6. **I11's row is necessarily partial.** "Every new engine has a working fallback" is not fully
   mechanisable; the row asserts the checkable half — no `catch` restores the behaviour it replaced
   — and labels itself as partial rather than implying full coverage.
7. **I2's row is source-shape** because the Express server cannot be booted here without
   `node_modules`.

---

## Out of scope for this tranche

Each of these stays in `docs/research/RAMA_MODEL_EVALUATION.md` §7 and §10, with the reason it is
not here.

| Deferred | Reason |
|---|---|
| **R-L3** — extend `PROTECTED_FILES` by 9; re-call `assertChangesSafe` in all 5 appliers and in `proposals.restore()` | Changes loyalty-core behaviour. Needs the tripwire (R2) in place first, and an approval, because `loyaltyGuard.cjs` is itself guarded |
| **R-L4** — `system.suspend-autonomy` | New tier-0 capability and new tray wiring; a capability change, not verification machinery |
| **R-L5/L6/L7** — admission assertion for network modules, scheduler run log, withholding statistics | R-L5's checkable half lands inside R1's I9/I10 rows; the persistence halves need store writes and are capability work |
| **R-C1/R-C2** — remove `overallConfidence`/grade, delete `CAPABILITY_AXES` and the `AAI Index` | Phase 0 honesty work touching `.jsx`; the renderer cannot be built here, and it is a separate tranche |
| **`start.cjs` stage 1 wiring of the invariant suite** | A boot that halts on a failed invariant has no fallback, which is an I11 question for master. Raised, not decided here |
| **R-O1/O2/O3/O4/O5** — offline cache, degradation order, byte-level backup, MINIMUM mode, source-integrity manifest | Phase 2; R-O3 additionally waits on master's decision in §9.2 |
| **Everything in roadmap phases 3 and 4** — memory, world model, the learning loop, bounded planning | The ordering is the point: §9.3 makes R-A1 depend on R-L1, R-L2 and R-L4 |
| **Running the Python engine, `vite build`, any benchmark number** | Not runnable in this worktree; claiming otherwise would breach the verification bar |

---

## Open items to record on completion

- Whether R3 was implemented or deferred, and if deferred, which consumer's shape made it
  non-additive.
- Any I1–I17 row that could only be asserted as source-shape, so a later session knows which
  invariants are weakly covered.
- Any invariant whose Section 28 wording diverged from the code (I5's `mintKey` is one; the
  evaluation's §9.1 raises I15's "reverted on unseal" as another). Raised for master, never edited.
