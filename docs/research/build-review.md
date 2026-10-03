# The stop, the policy table, and the gate on `proposals:create`

Four new main-process modules build the fence before anything autonomous exists behind it: a fail-safe
stop whose absent configuration means stopped, a fifteen-class policy table with six classes the data
file is never read for, a validation seam on the ledger's `proposals:create` channel, and an applier
with entry validation plus a verified byte snapshot. Two new suites carry 271 assertions and both pass.
The three measured defects the orchestrator named are genuinely closed: nothing renderer-supplied
decides whether an action is autonomous, the snapshot directory is derived from the proposal id and the
persisted one is never read, and a master-approved apply succeeds on a shipped install with no
allow-file — asserted in exactly that state rather than against a fixture. No protected file changed,
the tripwire is ALL PASS, no `console.log`, no TODO, no new dependency, and the pre-existing dispatchers
are untouched.

**Watch for:** the governed-path fence is defeated by a single `.` path segment (**confirmed** — a
`self-upgrade` diff naming `electron/lib/./autonomyStop.cjs` was applied over the stop module in a
fixture repo), so the narrowed FR-14 claim the build note states as true is also false; and a
validator-accepted data edit (`revert-own-apply: L0`) makes the applier's entry gate refuse every
master-approved apply (**confirmed**), reintroducing the defect class this slice exists to kill.

**Verdict**: NEEDS_CHANGES

## High-level view

The deferrals are declared as data rather than implied: `DEFERRED_CHOKEPOINTS`, `FUTURE_ENTRIES` and
`PRE_EXISTING[].haltedByEngage` are frozen lists the suite reads back, and the five unbuilt stage
modules are asserted absent so `CHOKEPOINTS.length` cannot overclaim coverage.

The stop's asymmetry — `isStopped()` fail-safe for new work, `isHalted()` explicit-engage only for the
four dispatchers that already ship — is what keeps I11 intact, and it is proved behaviourally: a
counting task registered with `refreshScheduler` is still dispatched on an install with no allow-file.
Nothing in the diff touches `refreshScheduler`, `metaCognition`, `selfCare` or `marketIntel` at all, so
`ollama-catalog`, `dependency-review`, the 10-minute audit, the 120-second sweep and the market ticks
keep running. The cost, declared in words by `statusText()`, is that `engage()` tears nothing down and
`lift()` cannot succeed on any machine.

Permanence is mechanical rather than documentary: `PERMANENT` is a frozen six-member set, `EDITABLE` is
derived from it by filter rather than restated, the loader rejects a file that so much as names a
permanent class, and `resolveWithoutStop` returns the frozen floor for those classes before it looks at
the data. The suite pins the set against a literal list, so moving one into the editable set turns a row
red.

The create gate derives `origin` as a literal written at each call site and throws on anything else,
closing the `opts.autonomous` bypass at its root rather than sanitising it. What it does not close is
the path fence itself: `autonomyGate.normalise()` lowercases and converts separators but never resolves,
so `./`, `//` and `..` variants of the four self-governing paths pass unrecognised. The pre-existing
`loyaltyGuard` handles the same input correctly, which makes the fix local and the gap new code's.

The applier's level comes from `requireMasterDriven` over a frozen two-class subset, which is what lets
a permanently stopped install still apply what master approved. But that level is resolved through the
data file, and `revert-own-apply` is editable down to L0 — so an edit the module documents as "turning
the automatic revert off" instead refuses the whole apply, and does not disable the revert at all.

Coverage is mostly behavioural. The source-shape rows sit where the behaviour is unreachable and each
says why. The exception is `lift()`: it writes the one file that enables autonomy and its success path
has no behavioural coverage at all, with no seam to give it one.

<details>
<summary>Issues (6)</summary>

1. **Governed-path fence defeated by a dot segment** (HIGH, confirmed) — `autonomyGate.normalise()`
   never resolves the path, so `electron/lib/./autonomyStop.cjs`, `electron//lib/autonomyStop.cjs` and
   `electron/lib/../lib/autonomyStop.cjs` are not recognised as the stop module and are applied.
   Normalise by resolution (as `loyaltyGuard` already does) and add suite rows for `./`, `//` and `..`
   variants of each of the four self-governing paths.
2. **A permitted data edit refuses master's apply** (MEDIUM, confirmed) — `revert-own-apply` is
   editable to L0 and the applier's entry gate resolves it through the data file, so master setting it
   to L0 blocks every apply while leaving `revert()` fully enabled. Resolve MASTER_ACT classes at the
   entry gate against the frozen floor, or make `revert()` the thing that consults the class, and add a
   suite row with a present data file that lowers it.
3. **`lift()` has no behavioural coverage and no seam for it** (MEDIUM, confirmed) — it hard-requires
   `./capability.cjs` and can never succeed, so the allow-file write ordering, the note check and the
   halt clearing are asserted only by regex over source text. Give it an injectable capability module
   so the success path can be exercised before master adds `system.suspend-autonomy`.
4. **The policy file is read once per process** (NIT, confirmed) — `reload()` has no production caller
   and no IPC surface, so a hand edit needs a restart, contradicting the module's own "no build and no
   restart is required". Drop the claim or call `reload()` where the policy is read.
5. **"Forgeable in-process" understates the trust boundary** (NIT, confirmed) — `proposals:apply`
   passes the renderer's `opts` through, so the `{tier: 0}` object the applier's `masterDriven` check
   reads is forgeable from the renderer, not just in-process. Reword the comment to name the renderer
   route and add it to the "for master" list.
6. **A degraded gate is a silent fail-open fence** (NIT, likely) — if `autonomyGate.cjs` fails to load,
   `main.cjs` hands the ledger the bare recorder and the path fence disappears, while the stop itself
   stays fail-safe. Surface the degradation in `status()` so it is visible where autonomy is reported,
   not only in `loadFailures`.

</details>

<details>
<summary>Details</summary>

### A single dot segment reaches the stop module

`autonomyGate.normalise()` is the whole of the path fence's canonicalisation:

```js
function normalise(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
```

Separators and case are handled; path *structure* is not. `namesGovernedPath` then compares the result
against four repo-relative tokens with `===` and `endsWith('/' + rel)`, so any form that is not already
canonical misses:

```
"electron/lib/autonomyStop.cjs"          -> "electron/lib/autonomystop.cjs"
"electron/lib/./autonomyStop.cjs"        -> null
"electron//lib/autonomyStop.cjs"         -> null
"electron/lib/../lib/autonomyStop.cjs"   -> null
"shared/./autonomy-policy.json"          -> null
```

The stop's own state files survive this, because they are matched on basename and
`.../rama/./autonomy.allow` still ends with `/autonomy.allow`. The four repo-relative paths do not, and
`electron/lib/autonomyStop.cjs` is one of them.

Both routes the build note claims are closed are open. Driving a `self-upgrade` entry with
`meta.schema` set, one `patch` change naming `electron/lib/./autonomyStop.cjs` with a correct
`baseSha256`, and a tier-0 user through `applyWith` against a fixture repo: the applier raised no
refusal and the file on disk afterwards read `function isStopped(){return false;}`. The same string in
`meta` passes `fileProposal`'s scan. On the renderer side the create fence returns no refusal either,
and since `autonomyStop.cjs` is not in `loyaltyGuard.PROTECTED_FILES`, nothing downstream objects —
`timeline.cjs`'s SELF_MODIFY applier writes `changes[].path` verbatim, which is already a printed
residual.

I6 is still intact: this needs a recorded master approval and a diff master reads. But the whole point
of the fence is that the diff should never have been fileable, and the build note's §2 explicitly
narrows FR-14 to "unreachable by **this design's applier** and by **the renderer create path**" — both
halves of the narrowed claim are false as shipped.

`loyaltyGuard` refuses `electron/lib/./loyaltyGuard.cjs` and `electron/lib/../lib/loyaltyGuard.cjs` on
the same input, so the covenant itself is unaffected and the correct matching already exists in the tree
to copy.

### `revert-own-apply: L0` turns into "no applies at all"

`revert-own-apply` is not permanent. Its floor and ceiling are both L4, which means the data file can
only move it down — and the module presents that as a feature: *"A present file may RESTRICT an editable
class below its floor — that is how master puts Rāma offline, or turns the automatic revert off"*, and
again, *"setting `revert-own-apply` to L0 in the data file still genuinely disables the automatic
revert."*

Neither sentence holds. With `shared/autonomy-policy.json` present and `{"revert-own-apply": "L0"}`,
the file validates clean (`source=file`, `rejected=false`) and the applier's entry gate refuses:

```
autonomy policy: "revert-own-apply" is L0 (forbidden); L4 (apply-after-approval) required
for a master-driven act
```

So the edit blocks every master-approved apply of this kind — the exact failure the first assertions of
`verifyUpgradeApplier.cjs` were written to catch, reachable again through a documented, validator-
accepted edit. And `revert()` reads neither the policy nor the stop by design, so the automatic revert
the edit was supposed to disable keeps running. The suite's shipped-state rows all exercise the
absent-file branch, and §4 of the build note concedes the live `load()` path has only ever taken that
branch, so nothing covers this.

Compounding it mildly: `current()` caches the first load for the process lifetime and `reload()` has no
production caller, so undoing the edit by deleting the file does not take effect until a restart.

### Behaviour versus string existence, row by row

The load-bearing rows drive real state. The fail-safe matrix writes seven malformed allow-files plus a
directory at the allow path and checks `isStopped()` for each. The revert rows inject an `fs` whose
`writeFileSync` fails for the second target once (transient — reverted) and then forever (fatal —
`fatal.json` written, stop engaged, prior allow-file preserved inside the stopped-record). Section 9
registers the real ledger through `guardLedgerIpc` and calls the captured `proposals:create` handler, so
the I11 row and the kind fence are exercised rather than read.

The source-shape rows are confined to unreachable behaviour: the record-then-unlink ordering in
`engage()` is also proved behaviourally, the equivalent ordering inside `lift()` is not. `ignoreStop`
having exactly one consumer is a regex over the module plus a scan of every other file in
`electron/lib`, which is the right shape for a "nobody else may borrow this" claim.

The gap is `lift()`. Its empty-note refusal, the allow-file contents, the write ordering and the halt
clearing are all regex over source text, because `lift()` reaches for `require('./capability.cjs')`
directly with no injection point — unlike `upgradeApplier`'s `io` — so the suite cannot construct a
passing case even artificially. When master adds `system.suspend-autonomy`, the first real execution of
the function that enables autonomy is in production.

### The I11 half, and what `isHalted()` governs today

`isHalted()` has no consumer other than `status()`/`statusText()`. The four `PRE_EXISTING` entries say
`haltedByEngage: false` with a per-entry reason and `statusText()` prints "Still ARMED, because this
build does not tear them down", so nothing misreports — but it means the stop currently halts exactly
one thing, `fileProposal`, which has no caller in the shipped tree. The fence is built and untravelled,
which is the stated intent.

`engage()`'s one production caller is the fatal-revert path in `upgradeApplier`. There is no tray entry
and no IPC channel for `status()`, `statusText()` or `policyStatus()`, so master has no in-app view of
any of this — within the scope cut, and listed as deferred.

</details>

<details>
<summary>File map</summary>

| File | What changed |
|---|---|
| `electron/lib/autonomyStop.cjs` | new — the two predicates, `engage`/`lift`, five frozen coverage lists, `status`/`statusText` |
| `electron/lib/autonomyPolicy.cjs` | new — fifteen classes over frozen floors/ceilings/permanent, whole-file loader, `require`/`requireMasterDriven` |
| `electron/lib/autonomyGate.cjs` | new — `guardLedgerIpc` seam, `fileProposal`, the kind and path fences |
| `electron/lib/upgradeApplier.cjs` | new — entry validation, derived snapshot dir, verified snapshot, revert, retention |
| `electron/main.cjs` | two edits — ledger registered through the gate wrapper, applier added after it |
| `package.json` | two new verify scripts, both appended to the `verify` chain |
| `scripts/verifyAutonomyStop.cjs` | new — 147 assertions, 1 residual |
| `scripts/verifyUpgradeApplier.cjs` | new — 124 assertions, 3 residuals |
| `docs/research/SELF_UPGRADE.md` | new — the full design, with the orchestrator's deferral section |
| `docs/research/self-upgrade-build.md` | new — build note, design claims measured false, NOT VERIFIED list |
| `docs/research/design-review.md`, `design-review.json` | new — the prior design-pass review artifacts |

Diff reviewed: `git diff d949b18..HEAD` on `model/self-upgrade-loop` (Phase 0 excluded).
Suites re-run in the worktree: `verifyAutonomyStop` 147/0, `verifyUpgradeApplier` 124/0,
`verifyLoyaltyTripwire` 12/0 ALL PASS, `verifyInvariants` ALL PASS, `node --check` clean on all seven
touched `.cjs`. `npx vite build` genuinely cannot run — `node_modules` is absent from the worktree and
no `.jsx` changed.

</details>
