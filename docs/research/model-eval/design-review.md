# Design review — model-eval tranche 1: verification machinery (iteration 3)

**Document reviewed:** `.agents/tasks/model-eval/design.md` (third iteration, responding to findings 1–21).
**Against:** `.agents/tasks/model-eval/requirements.md`, `docs/research/RAMA_MODEL_EVALUATION.md`,
`RAMA_AGI_MASTER_SPEC.md` Section 28 (read only, lines 1607–1818 confirmed).
**Worktree:** `.worktrees/model-eval`, HEAD `8c1c9ee`, tree clean apart from untracked `.agents/` and
`docs/research/`. `node_modules` absent here, present at `Rama_AGI/node_modules` — both confirmed.
**Scope note:** no build or test suite was re-run. Every factual claim below was checked by reading
source or by a single-expression `node -e` probe, and the command is named.

**Verdict: CHANGES_REQUESTED — 1 HIGH, 5 MEDIUM, 6 NIT.**

This iteration is a large improvement on what the findings describe. The two HIGHs from the previous
round are genuinely closed: I16's two-sided probe is the right shape and I6's per-branch messages are
now the distinguishing assertion — both verified against source below, including that the mutation the
review called vacuous now bites. The loyalty core is not touched, no accessor is added, no dependency
is proposed, and the self-modification-boundary argument in §6 is honest about its residuals. What
blocks is narrower than last round: one scanner-correctness gap that silently un-arms the tree-wide
rows over 43 `.jsx` files, three places where a stated assertion does not match the shape of the code
it points at, one requirement element that is neither asserted nor declared unasserted, and one new
suite left outside the mutual-attestation argument that covers the other two.

---

## Findings

### 1. HIGH — the scanner, as specified, mis-tokenises JSX, and `src/` is inside `SHIPPED_DIRS`

**Where:** D1 (`scan(source)`), D1a (`walkShipped`), §3 ("The scanner's own fixture"), P4, and every
row that walks the tree: I8, I9, I10, I11, I12.

D1 specifies a single-pass state machine over exactly these states: normal, line comment, block
comment, single-quoted, double-quoted, template, regex. That is a JavaScript tokeniser. `walkShipped`
feeds it every file under `electron/ server/ shared/ src/` with a code extension — measured here as
**158 files, 78 `.cjs`, 43 `.jsx`, 33 `.js`, 2 `.json`** (`Get-ChildItem -Recurse electron,server,
shared,src -File | Group-Object Extension`), which matches the design's own figure. JSX *text children*
are not JavaScript, and an apostrophe in element text opens the single-quote state. Measured live
occurrences:

| File:line | Text |
|---|---|
| `src/pages/Introspect/Introspect.jsx:276` | `<Empty>No commits found in Rāma's repository.</Empty>` |
| `src/pages/System/System.jsx:88` | `}}>Reading Rāma's own footprint...</div>` |
| `src/pages/System/System.jsx:105` | `<div className="section-label">RĀMA'S OWN FOOTPRINT</div` |
| `src/.../HelpPanel.jsx:401` | `<strong …>Entry is on the next bar's open.</strong>` |
| `src/pages/Settings/Settings.jsx:366` | `manual switch — see Settings > Voice, or CommandPalette's mic` |

(Command: `Get-ChildItem -Recurse src -Include *.jsx | Select-String ">[^<>{}]*[A-Za-z]'[sdtm]\b"`.)

At `Introspect.jsx:276` the scanner enters single-quote state at `Rāma's` and stays there until the
next `'` somewhere further down the file. Everything in between is blanked on the `code` view. The
consequence is the precise failure D1 exists to prevent, inverted: not a false red, a **false green**.
An absence assertion over a blanked region passes vacuously. That reaches I12(b) (`console.log`),
I12(c) (markers — asserted on `comments`, which is the inverse view and is corrupted by the same
state error), I9's renderer half (`fetch`/`XMLHttpRequest` in `src/`), I8's second-tier-table ban, and
I11's `catchBodies` spans — including `PriceChart.jsx`, where the row's whole point is that
`:1021-1022` has `try { chart.timeScale().fitContent(); } catch { return; }` with the call in the
**try** (verified). The same class of error arrives through `//` inside JSX text (a URL, a date) and
through `{/* … */}` boundaries.

Two things stop `--self-test` from noticing. The scanner fixture in §3 contains a comment, a string, a
template, a regex, a division and a `require` in a comment — **no JSX case**. And every planted
mutation for the tree-wide rows targets a `.cjs`: `electron/lib/http.cjs` for I12(b),
`electron/lib/modelRoles.cjs` for I9(a), I10(a), I12(c), I8. So the JSX path is never exercised in
either direction, and AC5 is satisfied on `.cjs` evidence while the `.jsx` half of the walk is unarmed.

**Concrete fix** — three parts, all required:

1. Give `scan` an explicit JSX mode selected by extension, and specify it. The minimal rule that is
   correct for this tree: track element context. On `<` followed by an identifier, `/` or `>` enter
   *tag* state; inside tag state behave as JavaScript for attribute values (`"…"`, `'…'`, `{…}`
   expression containers re-enter normal state with depth counting); on `>` that closes a tag enter
   *text* state. **In text state nothing opens a string, a comment or a regex** — only `<` (back to
   tag) and `{` (expression container, normal state) change state. Text is emitted as blanks on `code`
   and as blanks on `comments`.
2. Add fixture cases, asserted before the rows, one per line in the table above plus
   `<p>see https://x/y</p>` and `<p>{'a'}</p>`: for each, assert that a `console.log('x')` placed on
   the **following** line is still visible on `code`. That is the direction that catches a swallowed
   region.
3. Move at least one planted mutation onto a `.jsx` so `--self-test` covers the JSX path. Cheapest:
   change I12(b)'s mutation to plant `console.log('x')` into a copy of `src/pages/System/System.jsx`
   on the line after `:105`, and keep the `http.cjs` plant as a second mutation. I11's mutation (a)
   already targets `PriceChart.jsx` and should additionally be required to go red **with** a
   JSX-apostrophe line present earlier in the file.

If a full JSX mode is judged too large for this tranche, the acceptable alternative is to **narrow
`walkShipped` to `.cjs`, `.js`, `.mjs` and `.json`, declare `.jsx` out of scope for the tree-wide rows,
and lower the affected row labels to say so** — plus adjust `SCAN_FLOOR` and P4's wording. What is not
acceptable is scanning 43 `.jsx` files with a tokeniser that cannot read them while the labels claim
coverage.

---

### 2. MEDIUM — I17's "no write on a timer" assertion is vacuous for the `dependency-review` task

**Where:** §4, I17, *"Neither writes" — narrowed, with the reason*; and its mutation (b).

The row locates each task's `run:` body with `blockAfter`, defined in D1a as "the next `{…}` block at
or after `offset`". Measured in `electron/main.cjs`:

```
551: sched.register({ name:'ollama-catalog', … run: async () => {        ← block body
565: sched.register({ name:'dependency-review', … 
570:   run: async () => runDependencyReview({ file: true }),             ← expression body
```

For the second task `blockAfter` returns `{ file: true }`. The ban list (`releaseChannel`,
`release:cut`, `cutRelease`, `bumpSemver`, `.apply(`, `version =`, `writeFileSync`) is trivially
satisfied by a two-token object literal, so half of the assertion asserts nothing — and the real body,
the nested `runDependencyReview` at `:579`, is never inspected. Mutation (b) ("insert
`require('./lib/releaseChannel.cjs').cutRelease({})` into a `run:` body") goes red only if the
implementer happens to pick task 1, which the design does not say.

**Concrete fix.** Specify the span rule and pin both mutations:

> For each of the two `sched.register(` argument blocks, find `run:`. If the first significant token
> after the arrow is `{`, the span is that block. Otherwise the span is the expression up to the `,`
> at the register-argument's own brace depth, **and** if that expression is a call to an identifier
> that `functionBody` resolves in the same file, the span is the union of the expression and that
> function's body. A `run:` whose span cannot be resolved fails the row (R1.6).
> Mutations: (b1) insert `cutRelease({})` into task 1's `run:` body → red. (b2) insert
> `require('./lib/releaseChannel.cjs').cutRelease({})` into `runDependencyReview`'s body → red.

Note while fixing: `main.cjs:536-539`'s own comment is the property being asserted, and
`runDependencyReview({file:true})` legitimately files a proposal, so the ban list must stay the
I17-relevant one (`.apply(` yes, `create(` no) — the design already has that right.

---

### 3. MEDIUM — §7 contradicts itself on `warning` for a future `asOf`, and the suite asserts exact shapes

**Where:** §7, `electron/lib/staleness.cjs`, the "Semantics" bullet list.

Two bullets, three lines apart:

> - `warning` is `null` unless `stale` or `neverFetched`; when present it names the `asOf` date, the age in days, and `recheckAt` if given.
> - A future `asOf` (clock skew) → `days: 0`, `stale: false`, and a `warning` naming the skew.

A future `asOf` is neither stale nor never-fetched, so the first rule says `warning === null` and the
second says it is a sentence about skew. `verifyStaleness.cjs` is specified to assert exact shapes
(§7, AC15), so module and suite will disagree according to which sentence the implementer read. This
is the same defect class finding 14 closed for the invalid-budget branch, left open one bullet later.

**Concrete fix.** Keep the skew warning (it is the useful behaviour) and restate the first rule:

```
warning === null  iff  stale === false && neverFetched === false && !futureAsOf
```

and add the row to §7's input table with the literal sentence, e.g.
`'<label> is timestamped <asOf>, which is in the future — the clock on one side is wrong'`, plus the
assertion `describe({asOf: now + 3*86400000, budgetDays: 1, now}).days === 0 && …stale === false &&
…warning !== null`.

---

### 4. MEDIUM — I3 asserts a shape `sessionManager.masterUnlock` does not have

**Where:** §4, I3, *Source-shape, independently*.

The design states `!cryptoCore.hasVerifier(` "appears exactly once **and is the condition guarding the
`writeVerifier` branch**". Measured, `electron/sessionManager.cjs:78-85`:

```js
const firstUnlock = !cryptoCore.hasVerifier(dataDir);

if (firstUnlock) {
  cryptoCore.writeVerifier(dataDir);
} else if (!cryptoCore.verifyPasscode(dataDir)) {
  cryptoCore.lock();
  return { ok: false, error: 'Incorrect passcode' };
}
```

The branch condition is the boolean `firstUnlock`; the `hasVerifier` call is one line above, in a
declaration. An implementer who asserts the sentence literally ("the `if` whose condition contains
`!cryptoCore.hasVerifier(` has `writeVerifier(` in its body") writes a row that is **red on HEAD**, and
§4's own preamble says a row red on HEAD for the wrong reason is worse than a missing assertion
because it trains a maintainer to ignore the row.

Everything else in I3 checks out against source: `verifyPasscode(` occurs exactly once, inside
`else if (!…)`; `blockAfter` on it yields a body containing `cryptoCore.lock()` and a return carrying
`ok: false`; `cryptoCore.lock()` does indeed appear twice in the span (`:83` and the outer catch at
`:132`), so isolating the branch body is necessary as stated; `orderWithin` puts `hasVerifier` (`:78`)
before `verifyPasscode` (`:82`); and `cryptoCore`'s `module.exports` lists both names.

**Concrete fix.** Replace the clause with the three assertions that are true of this code:

> (i) `!cryptoCore.hasVerifier(` occurs **exactly once** in `masterUnlock`'s span;
> (ii) the first `if (` at or after that offset has `cryptoCore.writeVerifier(` inside its
> `blockAfter` body — so the first-run branch is still guarded by the verifier test and not by
> something else;
> (iii) `orderWithin` puts `hasVerifier` before `verifyPasscode`.

If (ii) is felt to lean on statement adjacency, the stronger and still-cheap form is: the identifier
assigned from `!cryptoCore.hasVerifier(` is the whole condition of that `if`. Either is fine; state
which.

---

### 5. MEDIUM — I16 never asserts that a failed open records a failure, and the gap is not declared

**Where:** §4, I16, *Escalation arithmetic* and *Cooldown refusal*; R1.3's I16 row; §13's
"Not asserted" list.

R1.3 requires the I16 row to assert that "repeated failed opens escalate then refuse". The design
asserts two things that are adjacent to it and neither of which is it:

- `roundsFor(0|1|8|99)` and monotonicity — a pure function, verified present at
  `electron/lib/loyaltyCore.cjs:124-127` with `BASE_ROUNDS 4096`, `MAX_ESCALATION 8` (confirmed
  **not** exported), `CEILING_ROUNDS 1_048_576`;
- the cooldown refusal, reached by **planting** `.loyalty.attempts` as
  `{failures: COOLDOWN_AFTER, lastFailAt: Date.now()}` and then calling `openCore('x')`.

The enforcement point is that a failed open *accumulates* a failure. Measured: `recordFailure()` at
`:112`, called on `openCore`'s failure path (`:279` builds the message from `next.failures`), and
`describe()` already exposes `failures` and `nextAttemptRounds` (`:344-353`). Delete `recordFailure()`
and every assertion in the row still passes — the planted attempts file supplies the state the code
was supposed to produce. That is the "tests the module, not the invariant" shape this whole tranche
exists to remove, and §13 records only the cooldown **expiry** as unasserted, so the gap reads as
covered.

**Concrete fix.** After the seal and the shape walk, inside the same `finally`-cleaned block:

```js
const before = loyaltyCore.describe();              // failures: 0
await loyaltyCore.openCore('a-wrong-passcode');
const once   = loyaltyCore.describe();              // failures: 1
await loyaltyCore.openCore('a-wrong-passcode');
const twice  = loyaltyCore.describe();              // failures: 2
// assert: 0 → 1 → 2, and nextAttemptRounds strictly increases across the three
```

plus a mutation: delete `recordFailure()` from `openCore`'s failure path → the row must go red. Cost
is two 4096-round PBKDF2 derivations plus two envelope reads — well inside the 1.41 s the design
already measures for the argon2-bearing rows, and `loyaltyCore`'s own KDF is the cheap one by §4's
reasoning. If master would rather not pay it, then say so in §13 as an explicit declared gap in the
same voice I13 uses, rather than leaving R1.3's clause looking satisfied.

---

### 6. MEDIUM — `scripts/verifyStaleness.cjs` is wired into the chain but left out of the attestation argument

**Where:** §5 `STRUCTURAL_GUARDED` and the structural-checks list; §3 preflight P1; §6.3's claim; D7;
§11's "suite count 22 → 24 → 25".

The design's own standard for a check it adds is mutual attestation: P1 asserts the tripwire exists,
is non-empty and is named in `package.json`'s `verify` chain; the tripwire asserts the same of
`verifyInvariants.cjs` plus its row ids and `--self-test` branch. §6.3 concludes "**There is no single
edit that removes the check silently.**" That is true of the two covenant suites. It is not true of the
third suite this tranche ships: nothing asserts that `scripts/verifyStaleness.cjs` exists, and §5's
`package.json` wiring check looks only for `verifyInvariants.cjs` and `verifyLoyaltyTripwire.cjs`. So
deleting the file and its chain link is exactly the one silent edit — a suite going quiet, which is
ledger row 118's recorded failure mode and the thing AC20 is written against. §9's "which layer owns
which invariant" table has no owner for it either.

**Concrete fix.** One array entry and one assertion:

```js
const STRUCTURAL_GUARDED = Object.freeze(['scripts/verifyInvariants.cjs', 'package.json',
                                          'scripts/beforeBuild.cjs',
                                          'scripts/verifyStaleness.cjs',
                                          '.rama/tripwire-approvals.json']);
```

and extend §5's `package.json` check to require all three script names in the `verify` string. (It
stays in `STRUCTURAL_GUARDED`, not `APPROVABLE`, so no approval is ever needed to edit it — the same
trade D8 took for `verifyInvariants.cjs`.) Alternatively, state in §5 and §6 that it is deliberately
unguarded and why; but given the fix is one line, guarding it is the cheaper honesty.

---

### 7. NIT — D2 and D3 both define `Module._resolveFilename`, with different bodies

D2's snippet handles only `'electron'`; D3's `patched` handles `'electron'` plus the overlay rebase.
They are presented as separate decisions and an implementer has to infer that D3's supersedes. Say it:
"D3's `patched` is the single installed resolver; D2's snippet shows only the stub exports it returns."

### 8. NIT — bare specifiers requested from an overlay-materialised parent are not rebased

D3's rebase branch is gated on `isRelative(request)`. A bare specifier issued from a file under
`ctx.tmp` resolves with `parent.paths` rooted at `os.tmpdir()`, so `require('argon2')` from a mutated
`electron/cryptoCore.cjs` copy throws `MODULE_NOT_FOUND`. Harmless today — every optional-dependency
require that could be reached this way sits inside a `try`/`catch` (verified: `cryptoCore.cjs:79`,
`authCore.cjs:72`, `nucleusSealer.cjs:164`) — but it is an undocumented behaviour difference between
an overlay run and a normal run. Either extend the rebase to all requests (set `p.paths` whenever the
parent is under `ctx.tmp`) or record the limitation next to S1.

### 9. NIT — §4's I7 prose is wrong by one field

"`route:` occurs 19 times … while the other five fields occur 18 times." Measured in
`src/config/registry.js`: `route:` 19, `id:` 18, `component:` 18, `voice:` 18, `keys:` 18, **`minTier`
20** — 18 inside the `PAGES` span (`:34`–`:197`), one in the JSDoc at `:26`, and one real code use at
`:204` (`return PAGES.filter(p => tier <= p.minTier)`). The span-scoped assertion the row actually
makes is unaffected and correct; the sentence justifying it names the wrong exception set. Fix the
sentence to "two of the six fields also occur outside the span — `route:` at `:233` and `minTier` at
`:204`, plus `minTier` in the JSDoc at `:26`, which `code` blanks."

### 10. NIT — two export counts for `loyaltyGuard` read as a conflict

§4/I15 freezes a 14-name export set (verified exactly: `COVENANT, PROTECTED_NUCLEUS_KEYS,
PROTECTED_FILES, FORBIDDEN_KEYS, LoyaltyViolation, inspect, assertIntact, inspectOuter,
assertOuterClean, inspectPatch, assertPatchSafe, inspectChanges, assertChangesSafe, restore`), while
§10 says "`loyaltyGuard`'s **nine** exported predicates". Both are true — nine of the fourteen are
functions — but the two numbers invite a maintainer to think one is stale. Say "nine of its fourteen
exports are predicates".

### 11. NIT — I5 never states where the HMAC input comes from

The row asserts `createHmac('sha256', digits).update('u1').digest('hex') === captured.keyHash`. The
suite cannot see `digits`; it can only derive them as `r1.key.replace(/-/g,'')`, which the adjacent
bullet implies but the assertion does not state. Verified that this works:
`mintKey` (`authCore.cjs:219-226`) builds `formatted` from the same 12 digits and hashes
`createHmac('sha256', digits).update(userId)`. Write the derivation into the row.

### 12. NIT — `--self-test` re-spawns `auditRenderer` once for I7's mutation

§10 says the self-test is "source-shape mutations only, no KDF repeat", but I7's row keeps its
behavioural half, so one mutation costs a 2.51 s child spawn (measured). Either state it in §10's cost
table or skip the child half when `ctx.overlay` is non-empty (the child cannot see the overlay anyway,
so it contributes nothing to that verdict) — the latter is consistent with D3's existing rule for the
KDF halves.

---

## Verified assumptions

Each was checked in this worktree at `8c1c9ee`; the design's figure is confirmed unless noted.

| Claim | How checked | Result |
|---|---|---|
| Section 28 spans lines 1607–1818 and holds I1–I17 with a "Where enforced" column | `Select-String "^## SECTION 2[89]"`, read 1607–1686 | confirmed, all 17 rows present |
| `node_modules` absent here, present at `Rama_AGI/node_modules` | `Test-Path` both | confirmed |
| `require('electron')` resolves and returns a string with `app === undefined` | `node -e` | confirmed — D2's premise for an *unconditional* stub is sound |
| The existing stub pattern is at `scripts/verifyEngineDiagnosis.cjs:29-37` | read | confirmed, exactly the cited shape |
| `verify` is a 23-link chain = 22 suites + `auditRenderer.cjs`; `build.beforeBuild` is `scripts/beforeBuild.cjs` | `node -e` on `package.json` | confirmed |
| 24 dependencies, 10 devDependencies, no range specifiers | `node -e` | confirmed |
| `beforeBuild` returning `false` is already overloaded ⇒ the tripwire call must throw | read `scripts/beforeBuild.cjs:11-24` | confirmed, the comment says exactly that |
| 158 files under the four shipped dirs; 78 `.cjs`, 43 `.jsx`, 33 `.js`, 2 `.json`, 1 `.css`, 1 `.html` | `Group-Object Extension` | confirmed — `SCAN_FLOOR = 150` sits just under 156 |
| 4 raw `console.log` hits, all comments or string literals: `astEngine.cjs:101,106`, `safeRequire.cjs:140`, `verifyProposal.cjs:8` | grep | confirmed, exact lines |
| 4 raw `require('http'\|'https')` hits: `http.cjs:23,24`, `selfRepair.cjs:45`, `main.cjs:384` (comment) | grep | confirmed, exact lines |
| 6 word-bounded marker lines: `astEngine.cjs:109,110,114`, `verifyProposal.cjs:9`, `Agents.jsx:270`, `consciousness.js:188` | grep `\b(TODO\|FIXME\|HACK\|XXX)\b` | confirmed — the two real breaches and the four exempt/blanked ones |
| `fetch(` appears once in `src/`, at `apiClient.js:88`; no `XMLHttpRequest` | grep | confirmed |
| `COVENANT` carries `firstPriority`, not `loyaltyPriority`; `inspect` compares `loyaltyPriority[0] === COVENANT.firstPriority` | read `loyaltyGuard.cjs:48-54`, `:114` | confirmed — H5's correction stands, and the literal-based `CONFORMING` is necessary |
| `PROTECTED_FILES` is 7 entries at `:64-72`, membership exactly as the design lists | read | confirmed |
| `PROTECTED_NUCLEUS_KEYS` = `['loyalty','ethics','ethicalCore']`; `FORBIDDEN_KEYS` = `['__proto__','constructor','prototype']` | read `:57`, `:79` | confirmed |
| `inspect`'s six messages match the design's six regexes | read `:98-116` | confirmed (`the loyalty block is missing or not an object`, `master must remain`, …) |
| `loyaltyCore` exports exactly the 15 names of `CORE_EXPORTS`, in that order | read `:375-379` | confirmed |
| `baseDir()` falls back to `os.homedir()/.rama-agi`; `corePath()` is `baseDir()/.loyalty.enc`; `describe().present` is `fs.existsSync(corePath())` at `:347` | read `:82-90`, `:347` | confirmed — the two-sided probe is genuinely necessary, finding 1 of the last round was real |
| `sealCore` sets `_open = true` (`:234`), so `withCore` works without a separate `openCore` | read `:214-239`, `:297-310` | confirmed — I16's flow is executable as written |
| `scrub` nulls every own key to depth 8 | read `:312-319` | confirmed; `Object.values(captured).every(v => v === null)` holds for `{coreVersion, loyalty}` |
| `BASE_ROUNDS 4096`, `MAX_ESCALATION 8` (not exported), `CEILING_ROUNDS 1048576`, `COOLDOWN_AFTER 5`, `COOLDOWN_MS 30000`; `cooldownRefusal()` returns `{ok:false, error:/cooling down/, cooldown:true}` | read `:68-72`, `:130-139` | confirmed, including that the literal `8` must be written into the suite |
| `nucleusSealer` does **not** export `encryptNucleus`; exports are exactly the 12 names listed; `assertOuterClean` is inside `encryptNucleus` (`:205`), `assertPatchSafe` inside `patchNucleus` (`:485`) | read | confirmed |
| `authorise`'s two branches are at `:42-44` (string) and `:45-47` (no numeric tier), both naming I6; `approve(id, user)` is positional (`:176`), `apply(id, opts)` reads `opts.user` (`:219`) | read + `node -e` | confirmed. The live probe returns `…requires an authenticated user — "master" is a label, not an identity (I6)` for the string branch and `…requires an authenticated user (I6)` for the other, so the design's two regexes **are** distinguishing and mutation (a) now bites |
| `proposals.create` works with no store; `KINDS` keys are exactly `EVOLUTION, REGEN, SELF_MODIFY, GENOME, DEPENDENCY` on a fresh require | `node -e` | confirmed — I6's behavioural half is executable outside Electron |
| `approve(id,{tier:5,name:'g'})` is refused by `capability.deny` with `Guest may not do this (needs "self-modify.apply")` | `node -e` | confirmed, matches `/self-modify\.apply/` |
| 5 `registerApplier(` sites at the exact files and lines listed, plus the definition at `proposals.cjs:85`; no `DEPENDENCY` applier | grep | confirmed |
| 3 `.admit(` code sites (`agentOrchestrator:281`, `instanceManager:312`, `sandboxEngine:242`); `resourceResearchEngine:34` is a comment | grep | confirmed |
| `capability.can` is safe for `undefined` and for a string user (`:27-32`); `TIER_LABELS[String(undefined)] ?? 'This account'` | read | confirmed — I17's four cases all return `{ok:false}` with the expected label |
| `release:cut` handler at `releaseChannel.cjs:198`, message at `:203`, `module.exports = { register, getState, cutRelease, bumpSemver }` | read | confirmed |
| `capability.cjs:15` requires `../../shared/capabilities.json`; `accessControl.js:21` imports `@shared/capabilities.json`; `auth.cjs` takes `TIERS`/`can` from `capability.cjs` and re-exports at `:113-114` | read | confirmed — I8's delegation claim is right |
| 77 capabilities, 29 at tier 0; ladder `MASTER 0 … GUEST 5`; `tierLabels` keys `0`–`5`; `release.cut === 0`; `self-modify.apply === 0` | `node -e` | confirmed |
| `MASTER: 0` / `SUPERADMIN: 1` literals appear only in `shared/capabilities.json`, and only in quoted JSON form | grep | confirmed — N5's raw-view ban for `.json` is required, the `code` view would miss it |
| `auth.cjs` registers routes through two `router.all(` loops (`:85-86`, `:90-91`), one `router.get('/tiers')` (`:100`), and exports `module.exports = router` + three assignments (`:111-114`) | read | confirmed — the three-form `exportedNames` is a requirement of the row, as the design says |
| `createUser`'s order is `!actor` → `checkUsername` → `checkPasswordStrength` → tier floor at `:605`; message is `Tier must be 1–5. Master cannot be created.` with **U+2013** | read `:595-610` | confirmed. Also confirmed `Number(fields.tier)` + `Number.isInteger` refuses `0, -1, '0', 0.0, null` with that one message |
| `setUserTier`'s order is `findById` → `User not found` (`:675`) → master-immutable (`:676`) → tier floor (`:679`) | read | confirmed — seeding both accounts is required, finding 10 of the last round was real |
| `provision` checks `isProvisioned()` at `:295` before any `putUser`; floor at `:307` uses `TIERS.VIEWER`; `tier = TIERS.MASTER` occurs **once** in the file, at `:323` inside the `opts.masterSecret` branch | read + grep | confirmed |
| `issueAccessKey` (`:241-253`) returns `{ok, key: formatted, expiresAt, daysValid}` and stores `{...user, keyHash, keyExpiresAt, keyIssuedAt}` at `:249`; `mintKey` (`:219-226`) hashes `createHmac('sha256', digits).update(userId)`; `keyMatches` is internal | read | confirmed |
| `masterUnlock`'s span is `:70-135`; its only `token`/`userId`/`tier` mentions are in comments at `:115`/`:129`; return keys are a subset of `{ok, storeUnlocked, firstRun, error}` | read | confirmed — I1's source-shape half is green on HEAD and catches an added `token` key twice over |
| I14's nine tokens and their counts, and the order 252 < 253 < 261 < 264 < 266 < 269 < 270 < 273 < 274 | read `:242-289` | **confirmed exactly**, including `unlock(oldPasscode` ×2 and `secureDelete(` ×2. The strongest row in the document |
| `changePasscode('wrong-one', <26 chars>)` reaches the `Current passcode is incorrect` return, and the ≥10-char guard precedes it | read `:243-256` | confirmed |
| `registerRefresh` at `main.cjs:541`, `sched.register` at `:551` and `:565`, `runDependencyReview` nested at `:579`, both `intervalMs: DAY` | read | confirmed, and the unkeyed-literal problem the design describes is real |
| `refreshScheduler.status({now})` returns `running` + 12 per-task keys; module has no top-level `require`; exports `useStore`/`reset` | read `:233-256`, grep | confirmed — 13 keys for the AC16 fixture |
| `ollamaCatalog.loadCatalog({now})` is clocked by a `Date` and returns exactly 7 keys; `STALE_AFTER_MS = 24 h`, exported; no top-level `require` | read `:78-98`, `:37` | confirmed. The `stale`-agreement assertion also holds for a future `asOf`, because the module clamps `ageMs` with `Math.max(0, …)` |
| `startupDoctor.RUNTIME_OPTIONAL` is exported with **11** entries, exactly the names listed | `node -e` | confirmed |
| `PriceChart.jsx:1021-1022` has `fitContent()` in the **try** with `catch { return; }`; every `fitContent` mention in `chartZoom.js` is a comment | read | confirmed — I11(b) is green on HEAD for the stated reason |
| `server/routes/system.cjs:5` requires `systeminformation` at top level; `server/index.cjs:48` requires that route module unguarded | grep | confirmed, both line numbers exact |
| `.gitignore` does not exclude `.rama/`, and neither tripwire file matches any pattern | read | confirmed |
| `git log` HEAD is `8c1c9ee`; tree clean apart from untracked `.agents/` and `docs/research/` | `git log`, `git status --porcelain` | confirmed |

---

## Unverified / wrong assumptions

| Claim | Status |
|---|---|
| D1's scanner handles every file `walkShipped` returns | **WRONG.** JSX text children break the string/comment state machine on at least five measured lines across four `.jsx` files. See finding 1 |
| I17: `blockAfter` yields each task's `run:` body | **WRONG for the second task.** `run: async () => runDependencyReview({ file: true })` has no block; `blockAfter` returns `{ file: true }`. See finding 2 |
| I3: `!cryptoCore.hasVerifier(` "is the condition guarding the `writeVerifier` branch" | **WRONG.** The condition is the boolean `firstUnlock`; the call is in the declaration one line above. See finding 4 |
| §7: `warning` is `null` unless `stale` or `neverFetched` | **CONTRADICTED** by the future-`asOf` bullet three lines later. See finding 3 |
| I16 covers R1.3's "repeated failed opens escalate then refuse" | **NOT ESTABLISHED.** The escalation is asserted as pure arithmetic and the refusal from planted state; nothing asserts `recordFailure()` runs. See finding 5 |
| §6.3: "There is no single edit that removes the check silently" | **TRUE for the two covenant suites, not for `verifyStaleness.cjs`.** See finding 6 |
| §4/I7: "the other five fields occur 18 times" | **WRONG for `minTier` (20).** The row's span-scoped assertion is unaffected. See finding 9 |
| P3's `CACHE_ALLOWED` is exactly `argon2`, `@phc/format`, `node-gyp-build` after a full behavioural run | **NOT VERIFIED HERE** — proving it requires running the KDF-bearing rows, which this review did not do. Plausible: `argon2` resolves from the parent workspace and those two are its declared dependency closure. The design's fail-closed treatment (any other `node_modules` package fails P3) makes a wrong list a visible failure rather than a silent pass, so this is acceptable as a measured-on-implementation figure |
| §1's timings (776 ms / 427 ms / 210 ms, 1.41 s total, ≈5 s projected) | **NOT RE-MEASURED** — no suite was run. §10 already commits to recording the real figures on implementation and to raising an NFR3 breach with master, which is the right handling |
| `--self-test`'s total cost | **NOT STATED** and not measurable from the document. Finding 12 notes the one child spawn that makes it more than "source-shape only" |
| `electron-builder`'s `beforeBuild` hook actually invokes the tripwire | **CANNOT BE EXERCISED HERE** and the design says so (AC14). Correctly reported as a limitation rather than claimed |
| `vite build`, the Python engine, `costs.py` | **NOT RUNNABLE HERE**, and the design claims nothing about them (R4.5, R3.6). Correct |

---

## What is sound, and should not be reopened

Recorded so a later session does not re-litigate ground this iteration settled with evidence.

- **The loyalty core is untouched and I16's accessor ban is self-enforcing.** No row requests the
  matrix. `CORE_EXPORTS` is frozen against the real 15-name surface, so adding an accessor for the
  suite's benefit fails the row *and* changes `loyaltyCore.cjs`'s digest, which fails the tripwire.
  `withCore(c => …)` is the module's own documented mechanism, and the row asserts the scrub rather
  than reading the core — which is what R1.3 asks for. The failure message printing only a count is
  the right instinct.
- **I16's two-sided probe is correct and necessary.** `baseDir()`'s `~/.rama-agi` fallback makes an
  absence meaningless, and the "probe did not clear" branch is what catches a real core in master's
  profile. The `finally` cleanup is what makes `--self-test`'s clean re-run honest.
- **I6's per-branch messages are the distinguishing assertion**, verified by live probe. Deleting the
  string branch changes the message and turns the row red.
- **D9's `--force` refusal closes the re-baseline hole**, and the all-or-nothing write means no partial
  baseline can exist.
- **D11's tier-0 projection** is the right granularity: R2.1 says "the tier-0 entries", and a whole-file
  digest would demand a covenant approval for a tier-4 addition.
- **Finding 3's regress argument** (approvals digest advisory, per-entry provenance fatal) is right, and
  AC13 is literally satisfied without a fixed point.
- **D8's structural guarding of `verifyInvariants.cjs`** is the correct trade and its residual is stated
  rather than hidden.
- **D10's counted inventories** are the honest answer where the universal is false today, and the three
  FLAGGED-FOR-MASTER blocks (ten unadmitted spawn paths, two live `TODO`s, one unguarded optional
  require) are raised rather than closed or excused. All three were verified real.
- **R3 is additive as designed.** Nested-only `staleness`, every pre-R3 key preserved, module-local
  fallback helpers, no shared module invented, `console.warn` not `console.log`, and the two deferrals
  (`dependencyAdvisor.review` because its output reaches a proposal master approves,
  `ollamaLibrary.refresh` because it persists) are reasoned, not convenient.
- **No dependency is added**, and the design says a later change believing one unavoidable is a separate
  decision for master with a pinned version. Correct per I12 and the project conventions.
- **D7 follows R1.8** and hands the head-versus-tail preference to master rather than deciding it.

---

## Suggested fix order

1. Finding 1 — the scanner. It is the only one that changes the shape of the implementation, and
   findings 2 and 4 touch rows that depend on the same extractor contracts.
2. Findings 2, 4, 5 — three row-level corrections, each a paragraph in §4 plus one mutation.
3. Finding 3 — one rule and one table row in §7.
4. Finding 6 — one array entry and one wiring assertion in §5.
5. Findings 7–12 — editorial, fold in while touching the surrounding sections.
