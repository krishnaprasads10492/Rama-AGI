# design-review.md — review pass 4 of `docs/research/SELF_UPGRADE.md`

**Reviewed:** `docs/research/SELF_UPGRADE.md` (4,950 lines) on `model/self-upgrade-loop`, base `d949b18`.
**Binding context read:** `RAMA_AGI_MASTER_SPEC.md` Section 28 (locked invariants I1–I17, ledger,
resume protocol) and Section 124 (the ASI/AGI evaluation, its autonomy-ladder finding and its R-L4
stop decision).
**Method:** the design was read without the context that produced it, and every load-bearing
"measured" claim was re-read **in the source in this worktree**. No suite was run and no build was
attempted — per the instruction, this judges the document, and per the project's verification bar,
`node_modules` is absent here so `vite build` could not have been run anyway.

**Verdict: CHANGES_REQUESTED — 3 HIGH, 7 MEDIUM, 5 NIT.**

The document is unusually strong: six stages named and separately testable, blast radius computed
part by part with a stated method and a stated limit for each, the record shaped so an autonomous
apply differs by one field, `registerApplier` used as the extension point with `proposals.cjs`
sha-asserted unchanged, and the honest numbers printed rather than predicted (`six of seven sensors
reach no edit`, `three of four EDITS entries have no producing adapter`). The findings below are not
a rejection of the shape. Two of the three HIGH findings are **claims the source contradicts** — a
guarantee nobody is holding, and a field that does not exist — and the third is a **control that
cannot be undone the way the document says it can**.

---

## Gate questions, answered first

| Gate question | Answer |
|---|---|
| **I6 intact — nothing applies a source change without a recorded master approval, not even a dependency patch or a build repair?** | **Yes, for the loop this design builds.** FR-1 confines writes to `proposals.apply` on an `approved` entry, the FR-28 revert, and the derived snapshot dir; §E.5.0 check 0 refuses without a tier-0 `user`; `dependency-change` and `build-repair` have frozen ceilings at L3, and the brief's sentence is quoted verbatim in D.1. The revert is argued rather than glossed (§E.6) and raised for master (§I.1). **Caveat:** the fence is held at the applier this design owns, and the document says so — `proposals.create` is renderer-reachable at tier 1 and the five pre-existing appliers do not re-assert (H.13). See finding 1 for where that caveat is larger than the document admits. |
| **I17 intact?** | **Yes.** `release-classify` is L0 **permanent**, criterion 2 asserts no new file references `releaseChannel`/`cutRelease`/`npm version`/`git tag`/`publish`, and `releaseChannel.cjs` is on the not-changed list. |
| **Per-class autonomy policy table, declared DATA, defaulting to propose-only?** | **Yes, in the shape Addendum A §A.1 demanded.** Fifteen classes with floors/ceilings/`PERMANENT`/`RAMA_INITIATED`/`MASTER_ACT` frozen in **code**, only the levels of editable classes in **data**, and the data file **ships absent** so the floors are the shipped levels. Defaults are at or below propose-only: `propose-question` L3, every Rāma-initiated source class L1, asserted mechanically over `RAMA_INITIATED` by criterion 12 rather than left as a sentence. |
| **Proposal record shaped so a later autonomous application needs no schema change?** | **Substantially yes** — `meta.autonomy` is the only field that changes, and every justifying field is required and populated today. **But the field has two incompatible shapes in two sections** (finding 6), which is exactly the field the claim rests on. |
| **STOP fail-safe (absent config = stopped), unreachable by any proposal, never disableable by Rāma?** | **Fail-safe: yes** for `isStopped()` — six strict-falsity cases asserted by criterion 14, `RAMA_AUTONOMY=stop` checked first, dependency-free and synchronous so it cannot fail to load. The second predicate `isHalted()` is fail-safe in the opposite direction **and that is argued, printed by name in both states, and raised for master in §I.10** — acceptable, and better than the regression it replaces. **Never disableable by Rāma: yes** — zero in-process callers of `lift` (criterion 18), and `system.suspend-autonomy` absent from the matrix means `can()` is false for everyone. **Unreachable by any proposal: NO** — see finding 1. |
| **Five stages named and testable; NOTICE traces only to measurements; breakage analysis names a cause in `verifyEngineDiagnosis`'s vocabulary?** | **Stages: yes** (six, with AUTHOR declared as the producer of the diff, each `async` with a named pure core). **NOTICE: yes in principle** — `notice()` throws without `{sensor, field, value, at}`, and the remedy is structured `{editId, params}` from a frozen `ADAPTERS` table rather than parsed from prose. **In practice the `suite` sensor's measurement is parsed out of suite stdout with no declared grammar** (finding 5). **Breakage: honestly handled** — the document corrects the earlier claim, states that `diagnoseFailure` carries no `causeId`, and owns the mapping in `breakageAnalysis.cjs` over the eight branches that actually exist (re-verified; see Verified Assumptions). |
| **Avoids the seven protected files; uses `registerApplier`?** | **Yes.** The seven match `loyaltyGuard.PROTECTED_FILES` exactly as read; criterion 5 asserts zero changed lines in all seven; criterion 42 compares `proposals.cjs`'s sha256 before and after; `upgradeApplier.register(ledger, io)` closes over `io` because the ledger calls `applier(p, opts)` with two arguments — which is the measured call shape. |
| **Blast radius computed, not asserted?** | **Yes.** Six parts, each with method and limit: paths verbatim; `analyzeImpact` declared a substring scan that over-reports, with `dependentMethod` carried in the record and absolute→repo-relative normalisation; `invariantsAdjacent` asserted against disk and against `verifyInvariants`; `protectedTouched` from `loyaltyGuard.inspectChanges` rather than a set intersection; `selfGoverningTouched` from one frozen constant; `suiteCoverage` display-only and recomputed at apply; `rollbackPoint` `null` on a dirty tree. |

---

## Findings

### 1. HIGH — FR-14's "the STOP and the policy table are unreachable by any proposal" is false, and the argument given for it is the wrong argument

**Where:** FR-14, FR-13a, §E.2.2 ("outside the repo root, which is what makes the state unnameable by
any `changes[].path`"), §E.10 row *"The policy's own authority"*.

**The problem.** FR-14 is stated as a mechanical guarantee. Measured, it does not hold, by two
independent routes:

- **`shared/autonomy-policy.json` is not a protected file.** `loyaltyGuard.PROTECTED_FILES`
  (`electron/lib/loyaltyGuard.cjs:64–72`) lists exactly seven paths and `inspectChanges` matches only
  against those, with no root confinement. So a hand-built proposal naming the policy data file passes
  `assertChangesSafe` at creation. The design closes this for `kind: 'self-upgrade'` (proposer refusal
  5 + applier check 3) — **and not for any other kind.**
- **A pre-existing applier writes `changes[].path` verbatim.** `electron/ipc/timeline.cjs:195–210`
  registers the `SELF_MODIFY` applier and its body is:
  `fs.mkdirSync(path.dirname(change.path), {recursive:true}); fs.writeFileSync(change.path, change.content, 'utf8')`,
  plus `fs.rmSync(change.path, {force:true})` for `action: 'delete'`. **No resolve-then-compare, no
  root check, no lstat.** An absolute path is written wherever the process can write — including
  `<userData>/rama/autonomy.allow`. So the premise *"the state lives outside the repository root,
  therefore `changes[].path` cannot address it"* is not a property of the system; it is a property of
  the applier this design happens to write.

`proposals:create` is renderer-reachable at tier 1, so the entry can be created outside the loop, and
`approve`/`apply` then need a tier-0 user — this is not a privilege-escalation path, it is a
**fence-scope** defect: the document claims a guarantee it does not hold, over the two files that
govern Rāma's own autonomy. §H.13 and §E.11's residual list mention the general "appliers do not
re-assert" problem and that `autonomyPolicy.cjs`/`autonomyStop.cjs` are not yet protected, but FR-14
and §E.2.2 still assert unreachability as settled, and §I.2's ask to master omits the data file.

**Concrete fix — three parts, all small:**

1. **Restate FR-14 with its real scope,** so no later session inherits a guarantee nobody holds:

   > **FR-14** The STOP's state and the policy table are unreachable **by this design's own proposer
   > and applier** (`SELF_GOVERNING_PATHS`, refused at `file()` and re-checked at §E.5.0 check 3).
   > **They are NOT unreachable by every proposal:** `loyaltyGuard.PROTECTED_FILES` does not cover
   > `shared/autonomy-policy.json`, and `timeline.cjs`'s pre-existing `SELF_MODIFY` applier writes
   > `changes[].path` with no path validation (measured, `timeline.cjs:199–207`), so an absolute path
   > reaches `<userData>` — where the allow-file lives. Closing it needs either master's protected-file
   > edit (§I.2) or a path guard in `timeline.cjs`, which is **not** a protected file.

2. **Add a criterion that plants it rather than leaving it to prose.** New criterion 19c: build a
   `kind: 'self-modify'` proposal naming (a) `shared/autonomy-policy.json` and (b) an absolute path to
   the allow-file; assert that `proposals.create` **accepts** both today and **print** the residual
   *"the policy data file and the stop's state are writable through `timeline.cjs`'s SELF_MODIFY
   applier; this design's applier refuses them, that one does not"*. A residual that is counted cannot
   quietly become a belief.

3. **Widen §I.2's ask and offer master the cheap mechanical close.** §I.2 currently asks for
   `autonomyPolicy.cjs` and `autonomyStop.cjs` in `PROTECTED_FILES` + the tripwire manifest. Add
   `shared/autonomy-policy.json` to that ask — it is the lever, and protecting the modules without it
   protects the mechanism and not the setting. And offer, as a declared one-file change this design
   *can* make (`timeline.cjs` is unprotected): apply §E.9's resolve-then-compare + lstat rule inside
   that applier before each write, and refuse `delete`. That makes it a 20th changed file; it is
   master's call whether to take it in this tranche, and the question belongs in Part I rather than in
   an implementer's discretion.

### 2. HIGH — the only reachable `EDITS` entry reads a field that does not exist on a `dependencyAdvisor` row

**Where:** §E.4.1's `ADAPTERS` table, row `dependencyAdvisor`:
`(row) => ({editId: 'pin-version', params: {name: row.name, version: row.target}})`.

**The problem.** `dependencyAdvisor.assess()` returns
`{name, pinned, latest, jump, jumpWhy, sensitive, security, diskDeltaBytes, signals, concerns,
recommend, urgency, meaning}` (`electron/lib/dependencyAdvisor.cjs:189–205`), and `review()` builds
`rows`/`actionable` by mapping `assess` over its entries (`:241–248`). **There is no `target` field
anywhere in that shape.** So `params.version` is `undefined`, `pin-version`'s precondition *"`version`
has no `^`/`~`/range characters"* is evaluated against `undefined`, and the single edit the whole loop
can currently author either throws or emits `"name": "undefined"` into `package.json`. The document's
own headline claim — *"today this loop can author exactly one kind of change — a dependency version
pin"* — is unreachable as written, and criterion 41's diff assertion would only ever pass against a
synthetic fixture carrying a field production never produces.

**Concrete fix.** Use the measured field and say which one it is:

```js
// upgradeNotice.ADAPTERS
dependencyAdvisor: (row) => (
  row.jump === 'current' || row.jump === 'downgrade' || !row.latest
    ? null                                      // nothing to pin, or the registry is behind the pin
    : { editId: 'pin-version', params: { name: row.name, version: row.latest } }
),
```

`latest` is the registry version `assess` already classified, and `jump === 'downgrade'` must return
`null` rather than a pin, because `dependencyAdvisor`'s own `buildMeaning` reads that state as *"the
release was withdrawn, so this needs looking at rather than upgrading"* — pinning to it would be the
advisor's posture inverted. Add an assertion to criterion 90a that every `ADAPTERS` output names only
fields present on a real `assess()` return, built from a `registrySources.collect` fixture — the
defect class here is "a field read from a shape nobody checked", and it is checkable.

### 3. HIGH — `lift()` does not clear the stopped-record, so an engaged halt cannot be undone in-app and criterion 22a contradicts `isHalted()`

**Where:** §E.2.4 (`lift(user, note)` — *"the ONLY writer of `allowed:true`"*), §E.2.1's `isHalted()`,
criterion 22a (*"`stopAudit()` has cleared the audit interval and `startAudit()` re-arms it on lift"*),
§E.2.3's engage routes.

**The problem.** `isHalted()` is **presence-based**: `fs.accessSync(stoppedRecordPath())` ⇒ `true`.
`engage()` writes that record. **Nothing in the document ever deletes it.** `lift()` is specified
only as the writer of `allowed: true`, and §E.2.3 lists hand-deleting the record as the way back.
Consequences, all mechanical:

- After any engage (tray, env, or the automatic one on a fatal revert), a successful `lift()` leaves
  `isHalted()` **true**. `refreshScheduler.runNow`, `selfCare.runHealthSweep`,
  `marketIntel.tickResolveOutcomes` and `tickSyncNews` all carry in-function `isHalted()` checks, so
  they stay no-ops. Criterion 22a's *"`startAudit()` re-arms it on lift"* is satisfiable only for the
  one dispatcher that has **no** in-function check — so a lift resumes one of five behaviours and the
  panel, reading the still-present record, keeps reporting them halted.
- `lift()` is also never specified to call `refreshScheduler.start()`, `startSweep()` or
  `startScheduler()`, while `engage()` is specified to call all four `stop*` functions. The resume
  path is asymmetric with the teardown path and the asymmetry is not declared.
- The tray is specified with a *"Resume"* item (§E.2.4) that routes to `lift` — so the one control
  Section 124 demanded be reachable from the tray can be engaged from the tray and **not** undone
  from it, even once master adds `system.suspend-autonomy`.

**Concrete fix.** Specify the resume explicitly and assert it, mirroring `engage`'s ordering rule:

```js
lift(user, note)  // after the four refusals pass:
                  // 1. write <userData>/rama/autonomy.allow { allowed:true, by, at, note }
                  // 2. THEN unlink <userData>/rama/autonomy.stopped.json   (isHalted() -> false)
                  // 3. refreshScheduler.start() · metaCognition.startAudit() · selfCare.startSweep()
                  //    marketIntel.startScheduler()
                  // Agents and sandbox children are NOT respawned — they were master's work,
                  // and resuming a reaper is not resuming the thing it reaped. Declared, not omitted.
```

Order 1-before-2 for the same reason `engage` writes before it unlinks: a crash between them leaves
*allowed but still halted*, which is the recoverable direction. Then extend criterion 22d with a sixth
state: **after `lift()`, `isHalted()` is `false`, the stopped-record is gone, a counting fake proves
`runNow('ollama-catalog')` calls `task.run()` again and `runHealthSweep()` calls
`checkInstanceFailover` again, and `statusText()` names all four as running.** A planted mutation
removing step 2 must turn that row RED. If master prefers that a halt be undoable **only** by hand,
that is a legitimate answer — but then §E.2.4's tray *"Resume"* item and criterion 22a's re-arm
sentence must both go, and the choice belongs in Part I.

### 4. MEDIUM — `pin-version` edits `package.json` and never `package-lock.json`, and nothing in the plan can see the divergence

**Where:** §E.4.2a's `EDITS` table (`pin-version`), §E.1.2 class 6 (*"`package.json` /
`package-lock.json` diffs"*), §E.5.2's plan table.

**The problem.** The class is defined over both files; the transform touches one. A pinned version
changed in `package.json` without the corresponding lockfile entry makes `npm ci` fail outright — and
the verification plan for this change is `JSON.parse` plus a dependency-count row, because
*"`node --check` is meaningless for JSON"*. So the one change the loop can author is the one change
whose failure mode the plan is structurally unable to detect, on a machine where `node_modules` is
absent and §124 already measured that an offline rebuild is impossible. That is the
`verifySelfBuild` failure mode the design quotes — *"a build that had actually failed would install an
older version and look like it had worked"* — reached from the other side.

**Concrete fix.** Pick one and write it into the table, with the reason:

- **(a) Recommended, and it is the posture-consistent one:** `pin-version` emits a `changes[]` of
  **length one over `package.json`** and the weighing carries a **mandatory con**: *"`package-lock.json`
  is not updated by this change; `npm ci` will refuse until the lockfile is regenerated on the build
  machine"*, with `requiresRestart: false` and `verdict: 'needs-master-decision'` whenever the
  dependency is in `dependencyAdvisor.SENSITIVE` (already specified) **or** whenever a lockfile exists
  on disk. The loop never writes a lockfile, which is `dependencyAdvisor`'s *"it never upgrades"*
  posture kept honest.
- **(b)** Add a `lockfile-sync` precondition: refuse to author `pin-version` at all while
  `package-lock.json` exists, so the edit is reachable only in a tree where it cannot cause the
  divergence. Narrower and simpler; it also means the edit is unreachable in this repository, which
  should be said rather than discovered.

Either way add a criterion asserting the `changes[]` paths of a `pin-version` output and the presence
of the lockfile con, so the gap is a printed fact rather than an implementer's surprise.

### 5. MEDIUM — NOTICE's `suite` sensor is unspecified in four ways, including a prose parse the design forbids elsewhere

**Where:** §E.4.1's sensor table, row `suite` (*"a `scripts/verify*` exit code + the failing **row
name**... The row name is the `field`"*); §E.4.0's `upgrade-notice-suites` admission.

**The problem.** This sensor spawns processes and feeds a `fingerprint`, and four decisions are
missing:

- **Which suites?** `scripts/verify*.cjs` measures **18 files** in this worktree. Does NOTICE run all
  of them daily, a declared subset, or only ones whose last run was red? Unstated.
- **One admission or eighteen?** `ADMISSION` declares a single `upgrade-notice-suites` label at 128 MB
  described as *"a spawned Node process with a suite's fixtures loaded"* — singular. Eighteen
  sequential spawns under one admission is a different resource story from one, and `admit()` is I10's
  authority, not a formality.
- **Timeout?** Per-step timeouts are specified for the **verification** plan (§E.5.2) and for nothing
  in NOTICE. A hung suite hangs the scheduled task.
- **How is the row name extracted?** The house suites print `    PASS  <msg>` / `    FAIL  <msg>`
  under a `\n  ${id} — ${title}` header (`scripts/verifyInvariants.cjs:66–73`). Nothing declares that
  shape as the contract. Parsing a `field` out of free-form stdout is precisely what FR-56 forbids for
  remedies — *"a string written for a human is not a parameter list"* — and a misparse silently
  changes the fingerprint, which is the one value deduplication depends on.

**Concrete fix.** Declare the sensor as data, the way `ADAPTERS` is declared:

```js
const SUITE_SENSOR = Object.freeze({
  suites: ['verifyInvariants.cjs', 'verifyLoyaltyTripwire.cjs'],  // the two covenant suites, named
  rowPattern: /^\s*FAIL\s{2}(.+?)\s*$/m,       // the house check() shape; see verifyInvariants.cjs:73
  sectionPattern: /^\s{2}(\S+)\s+—\s+(.+)$/m,  // the section header, so field = "<id>/<row>"
  timeoutMs: 120000,                            // per suite
  admitPerSuite: true,                          // one admit() per spawn, not one per sweep
});
```

and state the two refusals: a suite whose stdout matches **no** `FAIL` row while exiting non-zero
yields `sensorsAbsent: ['suite:<name>']` and **no finding** — `unchecked` is not a finding (B.2 habit
1) — and a timeout is `sensorsAbsent`, never a `suite-red` finding. Add to criterion 26 a fixture of
real captured suite stdout with two failing rows, asserting two findings with distinct fingerprints.

### 6. MEDIUM — `meta.autonomy` has two incompatible shapes, and it is the field the "no schema change" claim rests on

**Where:** §E.3 — `autonomy: { appliedBy: 'master', autonomousApply: false }` with the comment *"the
field that would change, and nothing else"*, plus the paragraph *"the only field that would differ is
`autonomy.autonomousApply: true` and `autonomy.appliedBy: 'rama'`"*. §E.5.0 check 0 and §E.5.1a —
`meta.autonomy = { flag: opts?.autonomous === true, recordedAt: now }`.

**The problem.** Implemented as written, the applier **overwrites** the record's `autonomy` object,
destroying `appliedBy` and `autonomousApply` — the two fields the forward-compatibility argument and
the audit trail both depend on. FR-54, criterion 83a and §E.9's `opts` row all say *"recorded into
`meta.autonomy`"* without naming the shape, so neither reading is privileged and a coder picks.

**Concrete fix.** One shape, both facts, written as a merge not an assignment:

```js
// §E.3 — the declared shape
autonomy: {
  appliedBy: 'master' | 'rama',      // the field an L5 apply would change
  autonomousApply: false,            // the field an L5 apply would change
  flagFromOpts: false,               // opts.autonomous as RECEIVED — recorded, never read
  recordedAt: '<ISO>',
}

// §E.5.0 check 0
meta.autonomy = { ...(meta.autonomy || {}), appliedBy: 'master',
                  flagFromOpts: opts?.autonomous === true, recordedAt: now };
```

Keeping the received flag under its own key is what makes the distinction auditable: *what the caller
claimed* and *what the system decided* are two facts, and collapsing them into one field is how the
renderer-supplied flag got mistaken for a gate in the first place. Extend criterion 83a to assert
`autonomousApply` and `appliedBy` survive an apply.

### 7. MEDIUM — criterion 25 asserts a `measurement.source` field the schema does not define

**Where:** criterion 25 (*"its `measurement.source` reads `selfModel.limits[].fixable`"*) versus §E.3
(`measurement: { sensor, field, value, at }`), §E.9 (`{sensor ∈ SENSORS, field, value, at}`) and
criterion 23 (`measurement:{sensor,field,value,at}`).

**The problem.** Three places define the measurement as four fields and `notice()` is specified to
throw on a malformed one; a fourth place asserts a fifth field. Either the validator rejects what
criterion 25 requires, or the schema is wrong — and the suite is the thing that decides, so this will
be discovered as a red row rather than as a decision.

**Concrete fix.** The `sensor` id already answers *"which sensor"*; what criterion 25 is reaching for
is *"which field of that sensor's reading"*, which is `field`. Restate it:

> 25. A `selfModel` fixture with two `limits[]` entries, one with `fixable: null`, yields **exactly
>     one** finding, whose `measurement.sensor` is `'selfModel.limits'` and whose `measurement.field`
>     is `'fixable'`, and whose `remedy` is `null` **by declaration** (§E.4.1's `ADAPTERS`).

If a provenance string genuinely adds something over `sensor` + `field`, add `source` to §E.3, §E.9
and criterion 23 together — but the `ADAPTERS` table already owns that mapping, so it does not.

### 8. MEDIUM — the halted skip inside `refreshScheduler.runNow` has an unspecified interaction with the state it writes

**Where:** FR-12 and §E.2.5 (*"`isHalted()` check before `await task.run()`"*, line 133), against
`refreshScheduler.runNow`'s measured body.

**The problem.** `runNow` is not only a dispatcher; it is the **recorder**
(`electron/lib/refreshScheduler.cjs:125–159`): every path through it writes
`state[name] = {lastRunAt: now, lastOk, failures, …}` and then `writeState(state)`, and `status()`
derives `lastRunAt`, `failures`, `nextDueAt`, `overdue`, `backingOff` and the staleness master reads
from exactly that record. The design says where the check goes and not what it does to the record.
Three outcomes are all consistent with the text: a halted skip that records `lastOk: true` makes the
task look freshly run and not overdue (a label lying about work that did not happen — the `badgeLabel`
defect, in the scheduler's own status surface); one that records `ok: false` inflates `failures` and
drives the ×2→×32 backoff, so lifting the halt leaves the task artificially deferred; one that returns
before `readState()` leaves the record untouched.

**Concrete fix.** Specify the third and assert it:

> `runNow` returns `{ok: false, halted: true, reason}` **before `readState()`** — it touches no
> state, so a halt neither refreshes `lastRunAt` nor increments `failures`, and `status()` keeps
> reporting the real staleness and the real backoff. Criterion 22a gains an eleventh assertion: with
> the halt engaged, `runNow('ollama-catalog')` leaves the persisted task state **byte-identical**.

A halt that quietly looked like a successful run is the exact defect `badgeLabel` and
`verifyBadgeLabel` exist to prevent; it should not be reintroduced one layer down.

### 9. MEDIUM — the two renderer surfaces are specified as new `PAGES` entries but have no component files, no loaders, and no host file in the changed-file table

**Where:** §E.0.1 (*"two new `PAGES` entries"*, `src/config/registry.js` **changed**,
`src/pages/Evolution/Evolution.jsx` **changed**) and §E.12 (*"Evolution → Dossier"*, *"Settings →
Autonomy"*, *"both at tiers the matrix already defines"*).

**The problem.** Measured, a `PAGES` entry is only half a page: `registry.js` holds a parallel
`LOADERS` map of `import('@pages/<X>/<X>.jsx')` expressions, `lazyFor(id)` returns `null` without one,
`routablePages()` filters them out, and **`registryIssues()` reports `page "<id>" has no loader`**
(`src/config/registry.js:255–309`). The design declares two new entries and lists **no new `.jsx`
file**, no `LOADERS` additions, and **no change to `src/pages/Settings/Settings.jsx`** — so the
Autonomy panel has no host file at all. As written, the work either produces two registry issues (and
turns whatever row asserts `registryIssues()` is empty red), or the two surfaces are panels inside the
existing `evolution` and `settings` pages, in which case they need **no** `PAGES` entries and the file
table is missing `Settings.jsx`. Also: PAGES entries carry `minTier` and a descriptive
`capabilities: [...]` array of free-text labels, **not** matrix keys — so §E.12's *"both at tiers the
matrix already defines"* is conflating `minTier` with `shared/capabilities.json`, which matters
because §E.13 asks master to add `autonomy.view` and the panel must gate on it itself.

**Concrete fix — the panel reading, which is what §E.12 actually describes:**

- Delete *"two new `PAGES` entries"* from §E.0.1 and the I7 claim with it. Replace with: **no new
  `PAGES` entry; two panels inside existing pages.** `src/config/registry.js` then becomes
  **unchanged**, and I7 is satisfied because no route is hand-written.
- Add `src/pages/Settings/Settings.jsx` to the changed-file table (*"a new Autonomy panel, gated on
  `autonomy.view` with the §E.13 degradation text when the capability is absent"*) and keep
  `Evolution.jsx`.
- Restate §E.12's tier sentence as: *"both render inside pages the registry already defines at their
  existing `minTier`; the Autonomy panel additionally gates on `autonomy.view`, which is not in the
  matrix, so until master adds it the panel renders the §E.13 sentence and nothing else."*
- If master wants them as real pages instead, then the file table needs two new `.jsx` files, two
  `LOADERS` entries, two `PAGES` entries with ids/routes/`minTier`, and a criterion asserting
  `registryIssues()` is empty — which is a bigger change than §E.0.1's *"nothing else changes"*
  claims, and so is master's call rather than an implementer's.

### 10. MEDIUM — FR-28 requires the plan to be re-run after a revert; no section implements it and no outcome is defined for a post-revert failure

**Where:** FR-28 (*"restore each snapshotted file to its recorded prior state automatically, verify
the restore by digest, **and re-run the plan**"*) against §E.5.2a's verdict object, §E.5.3's flow,
§E.5.5's fatal case and §E.8 rows 20–22.

**The problem.** The verdict object is
`{verified, reverted, revertAttested, causeId, cause, remedy, plan, planDrift, snapshotDir}` — there
is no field for a second plan run, §E.5.3 goes straight from failure to naming a cause, and §E.5.5's
fatal branch is reached only by a **digest** mismatch. So FR-28's third clause is unimplemented, and
the state it exists to detect has no handling: **if the plan still fails after a successful,
digest-attested revert, the tree was already red before the apply** — which means the `causeId`
attributed to this change is wrong, and filing a corrected proposal under §E.5.4 would be chasing a
defect the apply did not cause.

**Concrete fix.** Name the step, the field and the outcome:

- `revert(token)` is followed by **one** re-run of the **same re-derived plan** (not a fresh
  derivation — the change set is gone).
- The verdict gains `postRevertVerified: true | false | 'not-run'`, and `'not-run'` is a declared
  value so *"not run"* never renders as *"passed"* (the `needed`/`run` rule of §E.5.2, applied here).
- `postRevertVerified: false` ⇒ `causeId: 'pre-existing-red'`, `confident: false`, **no corrected
  proposal** under §E.5.4, and a **question** carrying both plan runs' evidence: *"the tree did not
  verify before this change either"*. Add it to §E.5.3's thirteen ids — it is the fourteenth, and it
  is exactly the *"I did not identify a cause **of this change**"* state that `unrecognised-exit`'s
  `confident: false` precedent exists for.
- Criterion 46 gains the fixture: a temp repo that is already red, an apply that reverts cleanly, and
  the row asserting `postRevertVerified: false`, `causeId: 'pre-existing-red'`, and that **nothing was
  re-proposed**.

### 11. NIT — §B.3's "nine derivations ... seven of the nine" is eight

Measured: `electron/lib/selfModel.cjs` contains **eight** `limit(...)` calls (lines 210, 216, 222,
228, 241, 248, 255, 263), seven with a non-null `fixable` (the nucleus one has none). §B.3 says nine.
The design's conclusions are unaffected — `ADAPTERS` declares `null` for this sensor by decision — but
the inventory is the thing later sessions trust. Fix: *"**Eight** derivations exist today... `fixable`
is a non-null string on **seven of the eight**."*

### 12. NIT — three stale line citations, one of them the kind revision pass 3 corrected elsewhere

- §H.23 still reads *"`agent.killFn` at 634"*, while §E.2.5, §E.0.1 and §H.28 all say **637** and
  explain why 634 pointed at a different caller. Measured: `killFn` at 122, 140, 359, **637**. Fix the
  stale one — a coder reading Part H first copies the wrong line, which is review-3 finding 17's exact
  failure mode surviving in the section that records it.
- §E.5.0 and §H.28 cite `proposals.cjs` **215** for `authorise(opts.user, 'self-modify.apply')`;
  measured, it is **219**.
- §E.5.1a, §D.2 and §H.28 cite `proposals.cjs` **272** for the `proposals:apply` handler; measured, it
  is **269**. (`applier(p, opts)` at **235** and `preload.cjs` **680** are both correct.)

### 13. NIT — "25 suites" is unsourced; the tree has 18 `scripts/verify*.cjs`

Part F's spec block says *"25 suites"*. Measured: 18 files match `scripts/verify*.cjs` (Section 124
recorded *"22 JS suites"* across the tree). Fix: say *"18 `scripts/verify*` suites"* or cite §124's 22
with its scope — this number lands in the master spec, where it becomes the next session's baseline.

### 14. NIT — §B.5's inventory row still says "four outbound paths", omitting `evolutionEngine`

The row headed *"`voiceEngine`, `browserEngine`, `codeRegenEngine`, `intelligenceEngine`"* describes
*"Four outbound paths carrying text"*, while §E.0.1, §E.7.4, FR-33 and §I.8 all carry the corrected
count — **five files, seven paths, ten request sites**, with `evolutionEngine` named as the fifth.
Part B is read first. Fix: add `evolutionEngine.cjs` to that row's file list and change "Four" to
"Seven paths across five files (§E.7.4 counts them; criterion 54a asserts the count)".

### 15. NIT — §E.0.1 places `codeRegenEngine`'s gate call at a line that covers one of its three requests

§E.0.1 says *"`gateOutbound([query], 'cloud')` before `researchFix`'s DuckDuckGo URL at ~49"*, while
§E.7.4 row 3 correctly says *"top of `researchFix` ~44"* covering **49, 69, 87** (DDG, the npm
registry, GitHub search — all three measured). Placing it at 49 happens to precede all three in the
same function, so the behaviour survives the ambiguity; the file table should still match the gate
table. Fix §E.0.1 to *"at the top of `researchFix` (~44), covering its three requests at 49, 69 and
87"*.

---

## Verified Assumptions

Each was re-read in the source in this worktree. The design's claim held.

1. **`proposals.cjs` 235 calls `applier(p, opts)` with two arguments** — so FR-57's closure-plus-
   exported-`applyWith` seam is the only one available. ✔
2. **`proposals.apply` authorises before the applier runs** (`:219`, `authorise(opts.user,
   'self-modify.apply', …)`), so the applier's `masterDriven` derivation is tautologically true where
   it is evaluated — which is why the design moves the guarantee to criterion 21c's asserted absence.
   The reasoning is correct; only the line number is off (finding 12). ✔
3. **`capability.can` reads nothing but `user.tier`** (`capability.cjs:25–31`) and returns `false` for
   an unknown capability for every tier — so a `{tier: 0}` object is forgeable in-process, and
   `system.suspend-autonomy` being absent genuinely makes `lift()` unable to succeed for anyone. ✔
4. **`summarise()` does not carry `result`** — it returns `{id, kind, title, summary, status, risk,
   requiresRestart, createdAt, decidedAt, decidedBy, appliedAt, reason, changeCount, paths, meta}`
   (`:297–308`). The mirror-into-`meta` decision (§E.5.2a) is the only way a verdict reaches the list
   channel. ✔
5. **`DURABLE_STATUSES = {pending, approved}`** (`:338`) and the proposal id is
   `crypto.randomBytes(10).toString('hex')` (`:117`) — so `/^[0-9a-f]{20}$/` is the exact shape, and
   "the record is not the rollback source" is right. ✔
6. **`registerApplier` is `appliers.set(kind, fn)` on an unconstrained Map** (`:85`) and `create()`
   accepts any `kind` — a new kind needs no edit to the protected file. ✔
7. **`loyaltyGuard.PROTECTED_FILES` is exactly the seven named** (`:64–72`), and `inspectChanges`
   matches by normalised equality, `/`-suffix, or basename-plus-dirname (`:220–232`) — so §E.4.3's
   insistence on calling the guard rather than intersecting a set is correct, and a set membership test
   really would miss `'./electron/lib/proposals.cjs'` and absolute paths. ✔
8. **`refreshScheduler` has one dispatcher**: `schedule()`'s timer callback calls `runNow(name)`
   (`:204–216`), `runNow` awaits `task.run()` at **133**, and `stop()` at **220** clears every timer
   and sets `running = false`. One check plus `stop()` does cover all three tasks. ✔
9. **`selfCare` arms its 120-second sweep at BOTH 345 and 396**, kicks one at 395 (`setTimeout … 5000`),
   `runHealthSweep` is at 200, and it calls `checkInstanceFailover()` (defined 125, invoked 224). The
   two-arming-sites correction is real and load-bearing. ✔
10. **`marketIntel`** — `tickResolveOutcomes` 731, `tickSyncNews` 748, both timers armed 784–785,
    `startScheduler`/`stopScheduler` exported (`:816`). ✔
11. **`agentOrchestrator`** — governor interval armed at 630, `agent.killFn()` invoked at **637**
    inside it, and `killFn` also at 122/140/359. The reaper-only characterisation is accurate: the
    governor kills timed-out agents and assimilates before garbage-collecting. ✔
12. **`registrySources.collect` returns `{rows, failures}`** (`:118`, `:188`) and pushes per-package
    failure reasons (`:138, :143, :163`) — so FR-19's insistence that `failures[]` feeds
    `sensorsAbsent[]` is both possible and necessary. ✔
13. **`dependencyAdvisor.SENSITIVE` is exported** (`:307`), so §E.4.2a's *"read from the export, never
    restated"* precondition is reachable. ✔
14. **`dependencyAdvisor.review()` with no argument returns empty** (`entries = []`), confirming
    review-2 finding 19's correction. ✔
15. **`aiProcess.diagnoseFailure` has exactly eight branches** (`:290`ff: `No module named`,
    `SyntaxError|IndentationError`, the three-spelling port match, `ENOENT|not found on
    PATH|could not be started`, the non-zero exit, `running && !text`, `!exit && !text`, final
    fallback) and returns `{reason, remedy, silent?}` with **no `causeId`**. §E.5.3a's eight-branches-
    over-seven-ids mapping is accurate, and so is the correction that nothing "carries straight
    through". ✔
16. **`astEngine.analyzeImpact` is a substring scan** — `code.includes(functionName)` at `:240`, line
    numbers from `l.includes(functionName)` at `:242` — and returns `path.join(dir, …)` absolutes. The
    over-reports-never-under-reports framing and the normalisation requirement are both right. ✔
17. **`localUpdateEngine.classifyChange` exists and is exported** (`:53`, `:330`), so reusing it rather
    than writing a second classifier is available. ✔
18. **`dataStore.DOMAINS` is a nine-entry array at `:44`** and `markAllDirty()` iterates it,
    instantiates missing defaults and returns `DOMAINS.length` — so adding `'context'` really does
    inherit I14's re-key by construction, and criterion 64 is the right row. ✔
19. **`customProviders.isPrivateHost` is internal, not exported** (`:83`, `module.exports` at `:232`),
    and `PRIVATE_HOST_PATTERNS` covers `10.`/`192.168.` — i.e. other machines. A separate exported
    `isLoopbackHost` for the egress question, leaving the SSRF predicate alone, is the correct call. ✔
20. **The house suite output shape is `    PASS  <msg>` / `    FAIL  <msg>` under a
    `\n  <id> — <title>` header** (`verifyInvariants.cjs:66–73`) — which is what makes finding 5's
    declared `rowPattern` possible rather than speculative. ✔
21. **I6 and I17 are worded in Section 28 as the design quotes them**, and Section 124's R-L4 decision
    does specify tier-0 `system.suspend-autonomy`, tray-reachable, unreachable by any proposal, and
    fail-safe. The design's two-predicate split is a documented, argued departure from "fail-safe" for
    the four pre-existing dispatchers only, printed in both states and raised in §I.10 — not a quiet
    reinterpretation. ✔
22. **`verifyLoyaltyTripwire.cjs` has exactly one `fs.writeFileSync`** (`:155`, the `--approve`
    manifest write) — so FR-1's declared exception *overstates* what the suites write rather than
    understating it. Conservative, so not a finding. ✔

## Unverified / Wrong Assumptions

1. **WRONG — `row.target` on a `dependencyAdvisor` row** (finding 2). The shape is
   `{name, pinned, latest, jump, …}`; there is no `target`. This is the only reachable `editId`'s only
   version parameter.
2. **WRONG — "the STOP's state is unnameable by any `changes[].path`" / "the policy table is
   unreachable by any proposal"** (finding 1). `timeline.cjs`'s `SELF_MODIFY` applier writes
   `change.path` verbatim with no root confinement, and `shared/autonomy-policy.json` is not in
   `PROTECTED_FILES`.
3. **WRONG — criterion 22a's "`startAudit()` re-arms it on lift" as a description of resumption**
   (finding 3). With the stopped-record still present, `isHalted()` stays true and the three
   dispatchers carrying in-function checks stay no-ops.
4. **WRONG — §B.3's nine `selfModel` derivations** (finding 11); measured eight.
5. **WRONG — three line citations** (finding 12): `killFn` 634, `proposals.cjs` 215 and 272.
6. **WRONG — "25 suites"** (finding 13); 18 `scripts/verify*.cjs` on disk.
7. **UNVERIFIED, and correctly declared so by Part H — accepted as stated, not re-checked here:**
   nothing is implemented; `vite build` cannot run in this workspace; the six source-change `causeId`
   recognisers have never seen real output; the `vectorMemory` dimension defect was found by reading;
   the re-key has not been run with a context domain present; no Ollama daemon has ever been present,
   so `ollamaCatalog.classify` is fixture-tested only; no `EDITS` transform has produced a byte; no
   timer has been observed stopping or re-arming; the 64 KB dossier cap, the 20-entry/30-day snapshot
   budget and the 90-day criterion window are declared budgets rather than measurements;
   `requireMasterDriven`'s two-class carve-out is a reasoned safety argument that no row in the
   document can falsify (raised in §I.11, and that is the right place for it).
8. **UNVERIFIED by me, and worth the implementer's attention:** `modelRouter.chatCompletion` being the
   single switch every chat/completion call reaches its provider through. I read §E.7.4's reasoning and
   the `modelInfo`/`destinationOf` design but did not enumerate every caller of every provider branch,
   so the chokepoint claim is taken from the document. It is central to Addendum A §A.2(2), and
   criterion 54's fake-eighth-provider assertion is the right shape to prove it.

---

## What to do next

Findings 1, 2 and 3 are the ones that change the design rather than the prose: a guarantee that has to
be restated and re-fenced, a field that has to be corrected before the loop can author anything at
all, and a resume path that has to be specified before the STOP can be called reversible. Findings 4–10
are each a paragraph and a criterion. Findings 11–15 are text.

Two of these are cheap and high-value to write first, in the spirit of the document's own advice about
criterion 64 and criterion 89: the `ADAPTERS`-output-against-a-real-`assess()`-return assertion
(finding 2) and criterion 22d's sixth state covering `lift()` (finding 3). Both would have caught
their defect before a line of the loop existed.
