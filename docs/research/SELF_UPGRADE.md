# SELF_UPGRADE.md

> **ADDENDUM FROM MASTER — ARRIVED AFTER THE TASK BRIEF WAS WRITTEN. MANDATORY. DO NOT DELETE THIS
> SECTION; APPEND YOUR INVENTORY, REQUIREMENTS AND DESIGN BELOW IT.**
>
> This file was pre-created by the orchestrator to carry a decision master took while your worktree was
> being set up. It is not optional context and it is not a suggestion — it is a requirement on the
> design you are about to author. Nothing below the horizontal rule exists yet.

---

## ADDENDUM A — the autonomy policy table gains a PERMANENT class, and four data guarantees

Master decided, during this run, how Rāma may record what he asks it. The decision is recorded in full
as **Section 127 of `RAMA_AGI_MASTER_SPEC.md` on the `dev` branch — which this worktree predates, so you
will NOT find it in your checkout.** Everything you need is restated here.

### A.1 Why this lands on your design specifically

Your brief already requires a **per-class autonomy policy table**: declared data, defaulting to
`propose-only`, so that a later unlock is a data change plus a master approval rather than a redesign.

Master's memory decision adds a requirement that **changes the shape of that table**: it needs a class
whose autonomy can NEVER be raised, by anyone, by any policy edit.

> **"What is recorded about master" is a PERMANENTLY PROPOSE-ONLY class.** Rāma may never widen its own
> retention window or its own capture scope, whatever else is unlocked later.

So the table cannot be a flat `class → autonomy level` map where every row is editable. It needs a
notion of a row that is **structurally unraisable** — and the suite must assert that raising it fails.
A policy table where every value can be edited is a policy table with no floor, and this is the floor.

**Design consequence to resolve explicitly:** if the policy table lives in a data file, what stops Rāma
proposing an edit to that file which raises this class? Your answer must be mechanical, not a comment.
Candidates: the class list is frozen in code rather than data while only the *levels* of raisable
classes are data; or the permanent classes are enumerated in a frozen constant that the loader
intersects against. Pick one, state why, and assert it — including an assertion that goes RED if a
permanent class is moved into the editable set.

### A.2 The four guarantees — fold these into the same policy object

These are the same kind of object as your autonomy table: a declared, data-level policy about what Rāma
may do without asking. They are NOT to be designed as a separate subsystem.

**(1) SUBJECT-SCOPED FROM DAY ONE.** Every recorded item carries a `userId`. Master is the only user
today, so *"it is his own data, his call"* holds — but the project ships six tiers, `authCore` and
access keys, and **the moment Rāma serves anyone else those records become someone else's data.** Do not
write a single-user schema that would have to be broken later.

**(2) THE SENSITIVITY GATE IS ON THE DATA, NOT ON THE ROLE. This is the most important of the four and
the easiest to get wrong.** Today `narration` refuses cloud because the ROLE carries `sensitive: true`
(`electron/lib/modelRoles.cjs`). Recorded prompts, though, are only useful as CONTEXT — *"you asked this
before, here is what we found"* — and that context could ride a research call on **any** role.
Therefore: **the classification travels with the record and is enforced on the PAYLOAD at the cloud
boundary, not on the role name.** A role-level gate is the comfortable choice and is wrong: without a
payload check the leak path is not a decision anybody makes, it is a refactor months later that nobody
notices. Your design must name the exact chokepoint where an outbound request is assembled and show
that a classified record cannot pass it.

**(3) RETENTION CAP, AND A PURGE THAT ACTUALLY DELETES.** `electron/cryptoCore.cjs` exports
`secureDelete`, and I14's full re-key (`sessionManager.changePasscode`) already proves this project can
do the real thing — so a purge that flips a flag is not acceptable. Also: a visible indicator while
recording is on, and one-click purge.

**(4) EXCLUDED FROM BACKUP UNLESS MASTER SAYS OTHERWISE, AND THIS COUPLES TO AN OPEN QUESTION.** By
master's framing the accumulated record is part of what makes Rāma *Rāma* — the most irreplaceable asset
in the system, which argues for backing it up. **But a backup is exactly how a local-only record stops
being local-only.** The resolution is the loyalty envelope's posture: opaque encrypted bytes under a key
master holds, never plaintext, never automatic. **Section 124 §9.2's backup question and this are now
ONE decision**; if your design needs the backup shape settled, RAISE it rather than choosing.

### A.3 Staging, and the falsifiable criterion — design for it, do not start it

**RECORDING STAYS DARK.** Master has not yet named a domain, so:

- **Stage 0 — what you build.** The schema, the capability, the four guarantees, the policy class.
  Tier-0, **default off**, **recording nothing**. `selfModel.cjs` must keep reporting the existing limit
  while it is off, so the cost of the gap stays visible instead of being quietly accepted.
- **Stage 1 — not yours.** Master names ONE domain (coding or StockMind recommended) and enables it.
- **Stage 2 — on evidence only.**

**THE SUCCESS CRITERION IS SET BEFORE RECORDING BEGINS, and your design must carry the machinery to
evaluate it:** if after a defined window tier-3 reflex synthesis has produced **no reflex that actually
saves a model call**, that is a **finding**, and the honest response is to **stop recording rather than
record more**. `ai_backend/engine/outcomes.py` and `calibration.py` already run exactly this test on
market predictions — did it come true, was the stated confidence earned. **The same test now applies to
Rāma's own learning mechanism.** Without a criterion fixed in advance, recording becomes permanent on
the strength of a hope and nobody revisits it.

### A.4 REFUSED — do not design a path to this

**Recording prompts AND sending them to a cloud model for better analysis.** It converts a reversible
local cost into an irreversible external one, and **it will look most attractive exactly when the local
models feel too weak** — which, on master's 15 W CPU with no discrete GPU, is now. If it is ever wanted
it is a separate explicit decision with its own question. Your design must make this difficult, not
merely undocumented.

### A.5 What NOT to do in this run

- **Do not add the capability entry to `shared/capabilities.json`.** It is a PROTECTED FILE under
  `scripts/verifyLoyaltyTripwire.cjs` and changing it needs master's recorded approval. **Specify the
  exact key and tier in your report and leave it to him**, and design the feature to degrade honestly
  until he adds it.
- **Do not begin recording.** Not even behind a flag that defaults off and could be flipped by a test.
- **Do not build the tier-3 synthesis itself.** This run builds the vessel and the guarantees. Whether
  the synthesis is worth building is the question stage 1 exists to answer.

### A.6 Context you may not have: why master considers this the bottleneck

`metaCognition.recordOutcome` records which TOOL answered and **never what was ASKED**. So tier-3 reflex
synthesis — Rāma noticing master asks the same thing weekly and converting it into a free, instant,
offline skill — is **structurally impossible**, not merely unbuilt. It is ledger row 47, `not started`,
and it is why Section 124 measured skill-acquisition efficiency at near zero.

`electron/lib/selfModel.cjs` already derives this as a first-class limit in its own words: *"the
experiential dataset records which TOOL answered but never what was ASKED, so tier 3 can count
escalations and cannot identify which phrasing to convert into a reflex"*, with the remedy *"record the
request text — which has a privacy consequence master must accept first."*

Master's framing of the whole programme: *"Rama itself is a model; exponential increase means
understanding requirement and upgrading/proposing upgrades after thorough research & review."*
**Rāma cannot understand a requirement it never recorded** — which is why this sits in the same design
as the propose-and-rollback loop rather than in a later tranche.

### A.7 One rejected option, recorded so you do not re-propose it

**Normalised phrasing clusters instead of full text.** This was Section 124's own recommendation and
master rejected it: it pays most of the privacy cost — a canonical form of *"how much am I down on
HDFC"* is still a record of him asking about HDFC — while **destroying exactly the variation that
identifying a convertible phrasing requires.** Full text under a hard local-only gate was chosen
instead, because the protection is the gate, not the redaction.

---

*Everything above is master's decision and the orchestrator's instruction. Append your inventory,
requirements and design below.*

---

# PART B — INVENTORY: what already exists, and what each piece actually does

**This is not a from-scratch build and the design below does not pretend otherwise.** Measured by
reading the source in this worktree (`model/self-upgrade-loop`, base `d949b18`). The propose →
approve → apply spine, the sensors that would feed it, the diagnosis vocabulary, the admission
authority and the release gate are all built and working. **What is missing is a POLICY layer, a
BREAKAGE LOOP, and — found by the second review pass — a CHANGE AUTHOR that is not a model
(§B.5a, §E.4.2a).** Those three things, and nothing else, are what Part E designs.

### B.1 `electron/lib/proposals.cjs` — the I6 spine. **DO NOT MODIFY. Extend via `registerApplier`.**

454 lines. One ledger, one audit trail, one sentence it exists to enforce: *"NOTHING IS APPLIED
WITHOUT AN EXPLICIT MASTER APPROVAL RECORDED HERE."*

| Export | What it does |
|---|---|
| `create(def)` | `{kind, title, summary, changes[], meta, requiresRestart, risk, id?}` → proposal at `PENDING`. **Calls `loyaltyGuard.assertChangesSafe(changes)` and `assertPatchSafe(meta.nucleusPatch)` AT CREATION** — a proposal naming a protected file never exists, because "sitting in the queue with an Approve button next to it invites master to authorise something no authority covers". |
| `get(id)` / `list({kind,status,limit})` / `stats()` | Reads. `list` returns `summarise()` — bodies stripped, `meta` passed **whole**. `stats()` reports `durable`, `unsaved`, `auditEntries` honestly. |
| `approve(id, user)` / `reject(id, user, reason)` | `authorise()` → **refuses a string outright** (*"a name is not an identity"*), requires `user.tier` to be a number, then `capability.deny(user, 'self-modify.apply')` — tier 0. **One id per call.** |
| `apply(id, opts)` | Re-authorises (*"an approved proposal is not a bearer token"*), refuses unless `status === APPROVED`, looks up `appliers.get(p.kind)`, awaits it, sets `APPLIED`/`FAILED`. |
| `registerApplier(kind, fn)` | `appliers.set(kind, fn)` — **an unconstrained Map keyed by any string.** `create()` likewise accepts any `kind`. **This is the extension point: a new kind needs no edit to this file.** |
| `KINDS` / `STATUS` | `evolution`, `regen`, `self-modify`, `genome`, `dependency` · `pending`, `approved`, `rejected`, `applied`, `failed`. Plain objects, not frozen. |
| `restore()` / `flush()` / `isDurable()` / `forStorage()` | Encrypted `dataStore`, 250 ms coalesced write, `saveAll()` forced so *"an audit trail has to be on disk when it says it is"*. **`DURABLE_STATUSES = {pending, approved}` — once `applied`/`rejected`/`failed`, `changes[].content` is replaced by a sha256 + byte count.** |

**Three facts that shape the design.** (i) `meta` is free-form and persisted, so the dossier can ride
there with **no schema change** — which is also what makes an eventual autonomous apply a
no-schema-change event. (ii) **Content is dropped once decided, so a proposal is not a rollback
source** — the rollback point must be captured independently (§E.6). (iii) `restore()` rehydrates
**without** re-calling `assertChangesSafe` (Section 124 finding #4, still open) — the design must not
lean on that guard holding across a restart.

### B.2 `electron/lib/dependencyAdvisor.cjs` — **THE POSTURE TO COPY.**

307 lines, pure, registry lookup injected. Its header is the whole argument: *"**IT NEVER UPGRADES
ANYTHING.** I12 pins every dependency deliberately; an advisor that could act would turn a pinned
set into a moving one, which is the opposite of what pinning is for. It produces an assessment and
files it through the approval ledger that already exists."*

Six habits this design inherits verbatim:

1. **`unchecked` ≠ `no-advisory-found` ≠ `verified-clean`.** *"The most tempting dishonesty in this
   module."* An absent result is never a clean result.
2. **A major bump is `breaking` by the author's own signal**, not by recency.
3. **Online commentary is `status: 'unverified claim'`, attributed, and cannot by itself set the
   recommendation.**
4. **Deltas, not absolutes** (`+31 MB`, not `42 MB`); **absent rather than zero** when unknown.
5. **`recommend: 'master decides'` is a first-class verdict**, alongside `hold` / `investigate` /
   `safe to consider`.
6. **`toProposal()` files ONE proposal with `changes: []`** — *"this proposal asks a question, it does
   not carry an edit"* — under `kind: 'dependency-upgrade'`, which is **in no `KINDS` entry and has no
   registered applier**, so it is structurally inert. (Section 124 #5 notes `DEPENDENCY` is likewise
   inert *by accident*; the suite now asserts it rather than hoping.)

### B.3 `electron/lib/selfModel.cjs` — the natural input to NOTICE.

309 lines. `describe(probes)` with **every probe injected**, returning `{identity, ability,
experience, limits, summary, attestation}`. Every field is `{value, source, measured}`;
`unmeasured(source, why)` yields `value: null` — *"deliberately not `0`, `false` or 'unknown' — those
read as findings."*

**`limits[]` is the half that matters, and it is DERIVED, never listed:** each entry is
`{what, why, source, fixable, measured}`, computed from what is absent **right now** — so it
self-corrects. Nine derivations exist today, including the one Addendum A §A.6 quotes about prompt
text. **`fixable` is a non-null string on seven of the nine.** A limit with a non-null `fixable` is a
requirement traced to a measurement with a remedy attached — exactly the NOTICE record, already built.

### B.4 `scripts/verifyEngineDiagnosis.cjs` + `aiProcess.diagnoseFailure` — **the breakage vocabulary to reuse.**

212 assertions-worth of suite over a pure function whose contract is *"the reason, not the symptom"*.
Named causes, each distinguished from the others and each carrying a `remedy`:

`missing python packages` (names the module) · `bound port` (recognised even from the WinError
`10048` form) · `parse failure → version mismatch` (names 3.10–3.12) · `missing interpreter`
(*"distinguished from a missing package"*) · `unrecognised exit` (reports the code **and** the
interpreter) · `no process running` · `running-but-silent` (*"not called a crash"*) ·
`alive-but-silent` (carries `silent: true` so a caller can treat it differently) · `never-spawned`.

**Four properties the suite enforces that the breakage analysis must also hold:** the function is
**TOTAL** (every input including `undefined` yields a `reason` **and** a `remedy`, both > 10 chars);
**nothing returns `null`**, because null is what sent the caller to its raw fallback; **no diagnosis
contains a bare URL or IP**, which is what master was actually shown; and **the evidence gate is
asserted gone** — gating the diagnosis behind `lastExit || lastStderr.length` made the branch written
for silence unreachable.

### B.5 The rest of the inventory, briefly

| File | What it is | Bearing on this design |
|---|---|---|
| `electron/lib/selfRepair.cjs` (440) | Restores a **lockfile-named, version-pinned, sha512-verified** module into `userData/repair/node_modules`. Core modules only — *"a repair mechanism that needed a third-party package could not repair a missing third-party package"*. Explicitly **cannot** install something new, upgrade anything, or be steered. | Proves `userData` is writable in every install → it is where the rollback snapshot lives. Proves the posture: repair means *restore what this build already declared it was made of*. |
| `electron/lib/releaseChannel.cjs` (209) | **Dormant by design (I17).** `cutRelease` bumps `package.json`, prepends `CHANGELOG.md`, commits, annotated-tags, pushes only on an explicit `push: true`. Tier-0 `release.cut`. *"Not a `proposals.cjs` entry: cutting a release is a MASTER action taken directly."* | The `release-classify` class is **L0 forbidden, PERMANENT**. Nothing in this design calls it. |
| `electron/lib/localUpdateEngine.cjs` (330) + `scripts/verifyUpdateEngine.cjs` (172) | `checkForUpdates` (read-only) and `pullBuildApply`, which **refuses on a dirty tree unless forced**, classifies changed files with `start.cjs`'s domain rule, installs only if deps changed, builds only if the renderer changed, and **reports whether a restart is needed without doing it**. The suite exists because `classifyChange` returning `null` for `ai_backend/` made a pull report success while the running engine served old modules — *"the worst shape a bug can take"*. | The dirty-tree refusal is the precedent for refusing to apply without a clean rollback point. `classifyChange` is reused to decide whether a verification plan needs a build, a restart, or neither. |
| `electron/lib/updateChannel.cjs` (483) + `verifyUpdateChannel.cjs` (361) + `simulateUpdateChannel.cjs` (532) | `publish`/`apply`/`prune`/`validateManifest`, sha256 per payload. Header **discloses honestly** that a manifest digest is *integrity, not authenticity*: "whoever can write to the channel folder can make Rāma run their executable". Section 124 calls it the widest indirect I6 route. | Out of scope here and **named as such** rather than quietly widened. |
| `scripts/verifySelfBuild.cjs` (210) | `classifyArtifacts` is pure and tested because *"a build that had actually failed would install an OLDER version and look like it had worked… the worst possible outcome for an update mechanism."* | The same rule applied to verification: **a verification step that cannot fail is not a verification step.** |
| `electron/ipc/astEngine.cjs` (292) | `analyzeFile(path)` → `{functions, imports, exports, classes, issues, qualityScore}`, sha-keyed cache, emits `ast:analyzed`. `analyzeImpact(name, repoPath)` walks ≤6 deep and returns `usages[{file, lines}]`. | A sensor for NOTICE (`issues`, `qualityScore`) and the dependent-finder for blast radius — **with the caveat in §E.5 that `analyzeImpact` is a substring scan.** |
| `electron/ipc/metaCognition.cjs` (485) | `recordOutcome({action, ok, ms, tool, actor, role, context, error})`, `selfAudit`, `experienceSummary`, `optimizationVectors`, `profileFor`. **Records which TOOL answered, never what was ASKED** — Addendum A §A.6's bottleneck. Audit timer every 10 min. | A sensor (failure rates per action). Its audit interval is one of the things the STOP must halt. |
| `electron/resourceOrchestrator.cjs` (532) | **I10, the one admission authority.** `admit({ramMB, label, priority, allowUnderPressure})` → `{allow, reason, snapshot}`. `PRIORITY` CRITICAL 0 → BACKGROUND 4; `PRIORITY.CRITICAL` bypasses — *"loyalty outranks throttling"*. `THRESHOLDS` CPU 50/70/85/95, RAM 50/70/85/92. | **Every stage of the loop runs at `PRIORITY.BACKGROUND` through `admit()`.** No second admission path. |
| `electron/lib/http.cjs` (284) | **I9, the one main-process HTTP client.** `request/get/post/getJson/postJson/getHuman/postStreamingJsonLines`, circuit breaker, `MAX_RESPONSE_SIZE`. | **The only outbound path RESEARCH may use.** |
| `src/config/registry.js` (310) | **I7.** `PAGES`, `visiblePages`, `visibleRoutes`, `searchPages`, `matchVoiceToRoute`, `allCapabilities`, `capabilitiesForTier`, `lazyFor`, `routablePages`, `registryIssues`. | Any new surface is a `PAGES` entry, never a hand-written `<Route>`. |
| `electron/lib/capability.cjs` | `can(user, cap)` → **`false` for an unknown capability — "unknown means denied"**, for every tier including master. `deny()` → `null` or `{ok:false,error}`. | **Load-bearing for the STOP's honest degradation (§E.2.6):** until master adds the key, the stop cannot be lifted in-app by anyone. |
| `electron/lib/loyaltyGuard.cjs` (289) | `PROTECTED_FILES` = `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json`. Plus `inspect/assertIntact`, `inspectOuter/assertOuterClean`, `inspectPatch/assertPatchSafe`, `inspectChanges/assertChangesSafe`, `restore`. | **Read, never restated** (§E.5). **Not modified** — which is why §I asks master to extend `PROTECTED_FILES` himself. |
| `electron/lib/refreshScheduler.cjs` (268) + `main.cjs:registerRefresh` | One registry of timed work. `register({name, label, intervalMs, run, capability, enabled})`, 90 s startup spread, 10 % jitter, ×2 backoff capped at ×32, state in `config/refreshTasks`. Two tasks today — `ollama-catalog` and `dependency-review` — and `main.cjs` states: *"Nothing scheduled ever CHANGES anything… Both are reads."* | **The loop registers here as a third task. The sentence above must stay true.** |
| `electron/lib/badgeLabel.cjs` + `verifyBadgeLabel.cjs` | Pure text; the suite asserts every label **enumerates the real timers and that each still exists on disk**. *"A label that cannot be checked against the thing it describes is how this file's predecessor came to be wrong."* | The STOP's visible state goes through here, so it is checkable the same way. |
| `electron/main.cjs` tray (`createTray`, context menu at ~1444) | A real `Tray` with a `Menu.buildFromTemplate` context menu; survives a hidden window; `badge:set-hide-tray` can destroy it but restores it rather than leaving no way back. | **Where the STOP is reachable without the renderer.** |
| `electron/ipc/modelRouter.cjs` (758) | `chatCompletion(messages, modelId)` is a **single switch over seven providers** — `openai`/`anthropic`/`gemini`/`mistral`/`groq`/`custom`/`ollama`. `modelInfo(id)` returns `discoveredOllama[id]` ∥ `MODEL_REGISTRY[id]` ∥ `null`, and **a DISCOVERED Ollama entry already carries `{cloud: true\|false\|null, type: 'cloud-ollama'\|'local'\|'unknown', cloudEvidence, cloudWhy, private}`** because `describeInstalled` ran `ollamaCatalog.classify` per tag. **`MODEL_REGISTRY`'s static `ollama/*` seeds carry `type: 'local'` by DECLARATION, with no measurement behind it.** | **The chokepoint for MODEL egress and for Addendum A §A.2(2)'s payload gate** (§E.7.4), and the measured `cloud` field is what the gate classifies on. **`provider === 'ollama'` is NOT a synonym for local** — this file's own catalogue module says Ollama serves cloud models through the same `localhost:11434`. |
| `electron/lib/ollamaCatalog.cjs` | `classify(tag, catalogEntry)` → `{cloud: true\|false\|null, why, evidence}` — the library entry first, then a `[-:]cloud` name marker, then params-versus-bytes-on-disk; **`cloud: null` means UNKNOWN and is never collapsed into local.** `describeInstalled({tags, catalog, schedule, seed})` builds the routable entries, rebuilding capabilities rather than copying the seed's `offline`/`costTier: 0`. Every function pure. | **The authority `destinationOf` consults** (§E.7.4). Its header is the whole argument: reporting a cloud model as local *"would tell master his prompt stayed on the machine when it did not."* Spec §130.9 puts Ollama's cloud free tier **in scope**, so this is a live path, not a hypothetical. |
| `electron/lib/customProviders.cjs` | `add`/`remove`/`list`/`toRegistryEntries`/`validateBaseUrl`. `PRIVATE_HOST_PATTERNS` covers `localhost`, `127.`, `0.0.0.0`, `10.`, `172.16–31.`, `192.168.`, `169.254.`, `::1`; **`isPrivateHost` is internal and NOT exported.** | **An SSRF predicate, not an egress predicate** — `10.x` and `192.168.x` are *other machines*. §E.7.4 adds a separate exported **`isLoopbackHost`** and leaves `isPrivateHost` and its patterns untouched with their original meaning (§E.0.1). |
| `electron/ipc/voiceEngine.cjs`, `browserEngine.cjs`, `codeRegenEngine.cjs`, `intelligenceEngine.cjs` | **Four outbound paths carrying text that do NOT pass `chatCompletion`:** a multipart `POST https://api.openai.com/v1/audio/transcriptions` (~269); three `encodeURIComponent(query)` search URLs (~205–207); `researchFix`'s DuckDuckGo URL (~49); `fetchDDGAPI`'s DuckDuckGo URL (~295). | **Why the payload-gate claim is scoped to MODEL egress** and why these four call the gate directly, with the call-site count asserted (§E.7.4, criterion 54a). Found by the review; the first draft's completeness claim was false. |
| `shared/capabilities.json` | 6 tiers, 77 capabilities. Relevant: `self-modify.view` 1, `self-modify.apply` 0, `system.self-update` 0, `audit.own` 3, `audit.all` 2, `release.cut` 0. **No `system.suspend-autonomy`, no `autonomy.*`.** | **PROTECTED. Not touched.** Exact entries specified in §E.13 and left for master. |
| `scripts/verifyInvariants.cjs` + `verifyLoyaltyTripwire.cjs` | 139 + 11 assertions, **13 planted breaches, unconditional self-test**, two digest records (per-file sha256 **and** a `manifestDigest`) so *"whoever changed a file cannot update its digest in the same edit"*, `--approve` refusing unless the environment carries the exact digest **plus a `--note`**. **Ten residuals printed and counted on every run.** | The verification model for everything below: **a row passes only if breaking the enforcement point makes it go RED**, and **unclosed gaps are printed, not implied**. |

### B.5a `electron/ipc/codeRegenEngine.cjs` — the only existing fix "generator", and what it actually is

*Added in revision pass 2, because the review asked which component authors a change and the answer
required reading the one module whose name suggests it already does (review-2 finding 1).*

**Measured: `generateFix(brokenCode, error, language, researchFindings, filePath)` BUILDS A PROMPT AND
RETURNS `{prompt, researchContext}`.** It writes no code. The model's reply arrives separately as
`runRegenPipeline(item, modelResponse)`, which is where a proposal is assembled. So the existing fix
path is **model-authored by construction**: the bytes that would reach Rāma's source are a model's
text, and `researchFix` (line 43) sends the **error message** out to DuckDuckGo, the npm registry and
GitHub search on the way (three of the ten request sites §E.7.4 counts).

**That is why §E.4.2a does not reuse it**, and the reason is a fence reason rather than a quality one:
a prompt-plus-reply pipeline cannot satisfy FR-18's *"nothing is invented by a model"* for a change
body, and adopting it would decide — silently, inside a tranche about holding the fence — both that a
model may rewrite Rāma's source and that Rāma's source text may leave the machine. **`upgradeAuthor`
is template-only, `codeRegenEngine` is left exactly as it is, and §I.9 asks master the question rather
than answering it by reuse.**

### B.6 What does NOT exist

Measured by grep across this worktree: **no `autonomyStop`, no `suspend-autonomy`, no `autonomy.*`
capability, no autonomy policy of any kind, no breakage analysis for a source change, no rollback of
an applied proposal, no module that turns a `selfModel` limit into a proposal, and — the one revision
pass 2 had to add — no module that turns a REMEDY into an EDIT without a model writing it** (§B.5a). The only
proposal Rāma files unprompted is `dependency-review`'s single daily question. **Section 124 measured
the autonomy ladder at Level 1 (Tool) almost everywhere and Level 2 (Consultant) in exactly two
places, both reads. That measurement must still be true after this design ships.**

---

# PART C — THE GAP, STATED PRECISELY

Six sentences, each traceable to Part B.

1. **NOTICE exists as data but nothing reads it.** `selfModel.limits[]` carries `fixable` remedies
   that no code consumes; `metaCognition` profiles failures nobody queries; `astEngine.issues` are
   emitted on a bus with no subscriber for this purpose.
2. **RESEARCH exists for exactly one subject.** `dependencyAdvisor` + `registrySources` research
   packages, auditably and well. Nothing researches anything else, and no module records *what was
   read, what it said, and what is still unknown* as a first-class artefact.
3. **WEIGH is asserted, never computed.** `dependencyAdvisor.concerns[]` is a good list of judgements;
   `verifyProposal.cjs` attaches an AST quality report. **Neither computes which files a change
   touches, which invariants sit adjacent, whether a suite covers it, or where the tree could be
   returned to.** `risk: 'medium'` is a literal passed by the caller.
4. **PROPOSE exists and is the strongest part of the system.** It needs a dossier to carry and a
   per-item batch affordance; it does not need rebuilding.
5. **AFTER APPLY does not exist at all.** `proposals.apply` sets `FAILED` and stores
   `err.message`. **There is no verification after the write, no rollback, no named cause, and no
   second attempt carrying what was learned.** A failed apply leaves Rāma's source changed, the
   ledger saying `failed`, and master holding a string.
6. **And nothing authors a change except a model.** *(Added in revision pass 2 — review-2 finding 1.)*
   The only fix generator in the tree, `codeRegenEngine.generateFix`, **builds a prompt and returns
   `{prompt, researchContext}`** (§B.5a); the bytes come back from a model and `runRegenPipeline`
   assembles them into a proposal. **So a loop that files diffs needs a producer of diffs, and the
   only existing one decides the model-authoring question by reusing it.** That is the gap §E.4.2a
   fills with a declared table of mechanical edits, and the one §I.9 leaves open deliberately.

**And the policy gap that sits over all five:** there is no declared statement of what Rāma may do by
itself in each of these classes, so the answer is whatever each call site happens to implement — the
exact drift pattern ledger row 48 named (*"the record and the code disagreed and nothing was
positioned to notice"*) and Section 124 §2.5 diagnosed: the capability matrix answers *"may this user
do this?"* and **nothing answers *"has Rāma earned this?"***

---

# PART D — REQUIREMENTS

## D.1 Summary

Give Rāma a **named, testable, five-stage loop** — NOTICE → RESEARCH → WEIGH → PROPOSE → AFTER-APPLY,
**plus the AUTHOR stage that produces the diff WEIGH weighs** (§E.4.2a, added in revision pass 2
because nothing in the first design wrote the patch) — that turns a measurement about itself into a
proposal master can approve in one click, and that — **after master applies it** — verifies the
result, reverts to the exact prior bytes on failure, names the cause of the breakage in an existing
vocabulary, and files a corrected proposal carrying what it learned.

**Rāma proposes. Master approves. Nothing in this design applies a source change without a recorded
master approval — not a dependency patch, not a build repair, not ever.** The autonomy is in the
research and the proposal. Alongside the loop ship the three pieces of architecture that make a later
unlock a data change rather than a redesign: a **per-class autonomy policy table**, a **proposal
record already shaped for autonomous application**, and a **fail-safe STOP**.

> **Three things revision pass 3 changed that a reader of the earlier draft must not carry forward**
> (Part J §J.0 has all nineteen dispositions):
> **(1) The STOP has TWO state predicates, not one.** `isStopped()` — fail-safe, absence means stopped
> — governs the six new chokepoints. **`isHalted()` — true only on an explicit engage — governs the
> four PRE-EXISTING dispatchers**, because those govern work that runs on master's machine today and
> one fail-safe predicate over both would have switched five working behaviours off on every install.
> **(2) The applier does not consult the STOP, and `opts.autonomous` is never a gate.** Its level comes
> from `requireMasterDriven` over a frozen two-class `MASTER_ACT` subset; *"Rāma does not start an
> apply"* is held by an **asserted absence of in-process callers of `proposals.apply`**, because every
> predicate available at the applier is either forgeable in-process or tautologically true there.
> **(3) The author can currently produce exactly ONE kind of change — a dependency version pin.** A
> finding's remedy is structured `{editId, params}` from a frozen per-sensor `ADAPTERS` table, never
> parsed from prose, and **six of the seven sensors declare no reachable edit** because every
> `fixable` string in `selfModel.cjs` is a sentence written for master. That number is printed by the
> suite, not predicted by this document.

## D.2 Functional requirements

**The fence**

- **FR-1** **No DIRECT filesystem write by code introduced by this design**, anywhere — not only under
  the repository root — **except** (a) through `proposals.apply` on a proposal whose
  `status === 'approved'`, (b) the revert of **FR-28**, **restoring each snapshotted file to its
  recorded prior state — its exact prior bytes, or its ABSENCE where the apply created it**, or
  (c) **the DERIVED snapshot directory** of FR-13a.
  **One declared exception, named rather than left to collide with the fence** (review-3 finding 13):
  the verification plan's **spawned** steps write files this design does not write and cannot stop
  them writing — **`vite build` writes `dist/` under the repository root, and each `scripts/verify*`
  suite writes its own temp directory** (`verifyLoyaltyTripwire` plants and restores; `publishProposal`
  was verified *"against a disposable scratch repo"*). Revision pass 2's FR-1 forbade *"any write under
  the repository root"* while §E.5.2's own plan spawned one, and criterion 1 scanned `fs.write*` in new
  `.cjs` files only — **so the spawned writes were unasserted and the literal fence was contradicted
  with no row going red.** The exception is bounded by one rule: **no step argument, `cwd` or
  environment value is ever taken from persisted `meta`** — every one derives from the re-derived change
  set (§E.5.2), and criterion 83 asserts the `cwd` and the provenance of every `execFile` argument.
  Two consequences stated rather than left implicit: a
  `create` whose path already exists is refused at `toProposalDef` (it is a `patch` misdescribed, and
  the snapshot shapes differ), and **`action: 'delete'` — which `proposals.cjs` documents at line 121
  as part of the change vocabulary — is refused outright by this design**, because the loop has no
  honest way to verify the restoration of something it was asked to remove.
- **FR-2** No path may call `releaseChannel.cutRelease`, bump a version, write a tag, or publish.
  (I17.)
- **FR-3** No path may write `shared/capabilities.json` or any file in
  `loyaltyGuard.PROTECTED_FILES`. The protected list is **read from `loyaltyGuard`**, never restated.
- **FR-4** `electron/lib/proposals.cjs` is not modified. New kinds arrive via `registerApplier`.
- **FR-5** Every capability that exists today still works, with a working fallback for every new path
  (I11). Nothing is removed.

**Autonomy policy**

- **FR-6** A declared per-class autonomy policy: **classes, floors and ceilings in code**, **levels of
  non-permanent classes in data**. **Every class resolves to its declared FLOOR whenever the data file
  is absent, rejected or silent about it** — and the data file ships **absent**, so the floors *are*
  the shipped levels (§E.1.2, §E.2.7). **The floor is a FALLBACK, not a minimum:** a present data file
  may **restrict** any editable class below its floor, and may **raise** one only as far as its
  ceiling. That asymmetry is the whole mechanism — *data may always restrict; it may raise only within
  a frozen ceiling; and for a permanent class it is not read at all.*
  **No floor exceeds `L4 apply-after-approval` and no floor is ever `L5`.** The two classes whose floor
  is L4 — **`apply-source`** and **`revert-own-apply`** — describe *applying, or undoing, a change
  master has already approved*, which is master's act and not Rāma's autonomy (§E.1.1's L4 gloss, §E.6).
  **No class whose action Rāma INITIATES has a floor above `L3 propose-only`**, and that is asserted
  mechanically over a declared frozen `RAMA_INITIATED` subset rather than left as a sentence
  (criterion 12). *(Reworded twice: revision pass 1 fixed "the lower of propose-only and its ceiling";
  revision pass 2 fixed the contradiction between "no floor exceeds L3" and the table's own two L4 rows
  — review-2 finding 8 — and removed the "ships at" column that described a file which ships absent —
  review-2 finding 5.)*
- **FR-7** A class may be **PERMANENT**: its level can never be raised by any policy edit, by anyone.
  `master-record` is permanent (Addendum A §A.1), as are `apply-source`, `release-classify`,
  `capability-grant`, `loyalty-core` and — added in revision — **`autonomy-policy`, which covers the
  policy DATA FILE itself, the two modules that implement the policy and the stop, and the tripwire
  manifest.** Without that class the lever that raises every other class was itself unfenced (review
  finding 5).
- **FR-8** The permanent set is **mechanically unraisable, not documented as such**: the loader must
  make a data-file edit incapable of raising a permanent class, and a suite must go RED if a permanent
  class is moved into the editable set.
- **FR-9** A level `L5 apply-autonomous` is **declared in the ladder and unreachable**: no class may
  hold it and the loader rejects any file that sets it.
- **FR-10** Every gated path consults the table by **class id AND by the level it needs**, and a refusal
  **names both**. **The `need` is not the caller's choice and not a default** (review-3 finding 7):
  `policy.require(classId, need)` takes `need` as a **required** argument and **throws when it is
  absent**, and the pairing of every gated function with its `classId` and its `need` is a **frozen
  `GATED` table** (§E.1.4) — six rows, all six spelled out. Revision pass 2 declared `GATED` as
  `[{module, fn, classId}]` with no `need`, so **a refusal could not name the level FR-10 requires it to
  name**, and criterion 13 could only assert the literal `policy.require('<classId>'` with the level
  missing. **And `upgradeWeigh.weigh` was a chokepoint no class covered** — `observe` and
  `research-local` were both candidates and nothing picked; **it is `research-local` at L1**, because
  weighing reads repo files, walks the tree through `analyzeImpact` and runs `git` read-only, which is
  that class's definition verbatim (§E.1.2 row 2).
- **FR-11** Policy resolution is **fail-safe**: an absent, unreadable, unparsable or
  schema-violating data file puts **every** class at its floor — not just the offending key.

**The STOP**

- **FR-12** **One** switch halts **all** autonomous activity introduced here **plus every existing
  timer that can change Rāma's own state or reach the network on its own initiative**, while Rāma
  **stays running and stays inspectable**.

  > **TWO STATE PREDICATES, ONE SWITCH, AND THE ASYMMETRY IS DELIBERATE** (review-3 finding 3, and this
  > is the correction that keeps FR-5/I11 true). Revision pass 2 had **one** predicate —
  > `isStopped()`, fail-safe, absent configuration ⇒ stopped — governing **both** the six new
  > chokepoints **and** the four pre-existing dispatchers. Measured, those four dispatchers govern work
  > that **ships and runs today**: `ollama-catalog` and `dependency-review` through
  > `refreshScheduler.runNow` (`main.cjs` 552/566, dispatched at `refreshScheduler.cjs` 133), the
  > `metaCognition` audit, `selfCare`'s 120-second health sweep including `checkInstanceFailover`
  > (`selfCare.cjs` 345 **and** 396, sweep at 200, failover at 125/224), and `marketIntel`'s two ticks
  > (784–785). **So installing revision pass 2's design would have REMOVED four working behaviours on
  > every install until master hand-created a file nobody had told him about** — a fail-safe argument
  > used to justify a regression, which is exactly what FR-5 and I11 forbid, and the opposite of
  > §E.1.2 row 3's own reason for giving `research-network` an L2 floor (*"its honest current level —
  > a floor of L1 would have described an install that does not exist"*).
  >
  > **`isStopped()`** — fail-safe, **absent configuration means stopped** (FR-13) — governs the **six
  > new chokepoints**, i.e. work that does not exist in any shipped build. Nothing is removed, because
  > nothing is there yet.
  >
  > **`isHalted()`** — governs the **four pre-existing dispatchers** and is `true` only on an
  > **explicit** engage: `<userData>/rama/autonomy.stopped.json` present (written by `engage()` —
  > FR-16a), or `RAMA_AUTONOMY=stop`. **Absent configuration means NOT halted**, because the absent
  > state is the behaviour of the build master already has, and *"fail-safe"* cannot mean *"delete
  > what works"*. The way back is symmetrical with §E.2.3's third route: **delete the stopped-record by
  > hand**, which needs no capability and no running Rāma — so a halt is always recoverable even
  > though `lift()` cannot succeed until master adds `system.suspend-autonomy` (§E.2.4).
  >
  > **The option NOT taken, and why.** The review offered a first-run migration writing an allow-file
  > carrying `by: 'upgrade-migration'`. **Refused:** that file is the thing `isStopped()` reads, so on
  > every upgraded profile the **new** loop would start allowed — Rāma would begin noticing and
  > researching on master's machine without him creating anything, which is the one state §E.2.7 exists
  > to prevent. Two predicates keep each question's safe direction instead of trading one for the other.
  >
  > **The asymmetry is printed, never inferred.** `statusText()` and the Autonomy panel **enumerate by
  > name** which pre-existing work is halted and which is still running, in both states, and criterion
  > 22d asserts both enumerations against the dispatcher table. A panel that said *"stopped"* over four
  > live timers, or *"running"* over four dead ones, is the `badgeLabel` defect (§E.2.6) in a new place.

  **The halt is implemented at the places that actually
  dispatch that work, each named and each measured — four dispatch points, not two** (review-1 finding
  7; the count was corrected in revision pass 2 after review-2 finding 7 measured two more):
  **Each of the four reads `isHalted()`, not `isStopped()`** (the distinction above); the six new
  chokepoints read `isStopped()`.
  - **`refreshScheduler.runNow`, before `await task.run()`** — the single dispatcher every scheduled
    task passes through, so one check covers `ollama-catalog`, `dependency-review` and the loop's own
    task without a per-task wrapper. **And `engage()` also calls the module's existing
    `refreshScheduler.stop()`** (line 220, exported), which is what R-L4 literally asks for and
    revision pass 2 did not do (review-3 finding 19): without it the named timers kept firing and
    no-op'd inside `runNow`, while the badge label said the timers were halted. **Both — the timer is
    cleared AND the dispatch point refuses** — because `stop()` alone cannot cover a `runNow` already
    in flight, and the in-dispatch check alone cannot stop a timer from waking the process.
  - **`metaCognition`, gaining `startAudit`/`stopAudit`** — its audit timer is armed inside
    `register()` and its existing `stop()` has no re-arm, so a lift could not restart it.
  - **`selfCare`, gaining `startSweep`/`stopSweep` plus an `isHalted()` check at the top of
    `runHealthSweep`** — measured: `register()` auto-arms `setInterval(runHealthSweep, 120000)` at
    **BOTH line 345 and line 396** (review-3 finding 17 — revision pass 2 named only 396, and
    **replacing one inline arm would have left a live timer that the interval-clearing assertion
    still passed**), and kicks a sweep 5 s after boot; `runHealthSweep` (line 200) calls
    `checkInstanceFailover()` (line 125, invoked at 224), which per ledger row 49 **expresses a
    dormant gene on a sibling instance**. That is
    state-changing autonomous work running every two minutes on a shipped install. **Both arming
    sites are replaced by `startSweep()`**, and the in-function
    check matters as much as the timer: an interval already in flight when the halt engages must
    become a no-op rather than finish its sweep.
  - **`marketIntel`, an `isHalted()` check inside `tickResolveOutcomes` and `tickSyncNews`** —
    measured at lines 784–785, two background timers that write outcome resolutions and fetch news.
    `startScheduler`/`stopScheduler` already exist and are exported, so the STOP calls `stopScheduler()`
    and the in-tick checks cover an in-flight run. **Master's on-demand StockMind calls are
    unaffected**, because they arrive through IPC handlers rather than these ticks — which is what
    keeps FR-17's promise true.
  **Plus the teardown R-L4 names and revision pass 1 missed:** `engage()` **kills running agents and
  sandbox children through the existing paths** — `agentOrchestrator`'s per-agent `killFn` and
  `sandboxEngine`'s `proc.kill('SIGTERM')` — rather than leaving autonomous children alive behind a
  stopped parent.
  **One declared exemption, and it is printed rather than silent:** `agentOrchestrator`'s governor
  (line 630) is **`stopExempt`**, because measured it only **reaps** — it kills agents that have
  exceeded `GOVERNOR.AGENT_TIMEOUT_MS` and garbage-collects finished ones after assimilating them.
  Halting a reaper does not stop work; it **leaves hung agents running and unassimilated**, which is
  the necrosis `agentOrchestrator`'s own comment warns about. A task or timer may declare
  `stopExempt: true`; **the exempt set ships with exactly one member, is printed by the suite, and
  every member carries its reason** (criterion 22a).
- **FR-13** **FAIL-SAFE: absent configuration means stopped — for `isStopped()`, which governs the
  autonomy this design introduces.** The stored state is a positive
  allowance; absence, corruption or ambiguity all resolve to stopped. **`isHalted()`, which governs
  the four pre-existing dispatchers, is fail-safe in the other direction and that is stated as a
  decision, not an oversight** (FR-12's blockquote, review-3 finding 3): absence there means *"the
  build master already has"*, because a safety mechanism whose installation silently removes four
  working behaviours is a regression, and I11 does not have an exception for well-meant ones.
- **FR-13a** **The STOP's state is unreachable by a proposal through `meta` as well as through
  `changes[]`** (review-2 finding 2). Revision pass 1 argued unreachability from the fact that the
  allow-file lives outside the repository root and `changes[].path` cannot name it — which is true of
  `changes[]` and **was not true of `meta`**: `meta.weighing.blastRadius.rollbackPoint.dir` was a
  persisted, renderer-writable string that the applier used as the **destination of filesystem
  writes**, under `userData`, which is where the allow-file lives. **So: every path the applier writes
  to is DERIVED at apply time, never read from the record.** The snapshot directory is
  `path.join(userDataRoot, 'rama', 'upgrade-snapshots', proposal.id)` with `proposal.id` validated
  against `/^[0-9a-f]{20}$/` first; the persisted `dir` is **display-only, exactly as the persisted
  verification plan is** (§E.5.2); and `rollbackPoint.files[].path` is validated by §E.9's
  resolve-then-compare rule **and required to be a subset of `changes[].path`**. A proposal that names
  a snapshot path is therefore not refused — it is **not consulted**, which is the stronger property.
- **FR-14** The STOP **and the policy table** are **unreachable by any proposal**. The stop's state does
  not live under the repository root at all **and no path in the record reaches it** (FR-13a); the
  policy data file does live under the root, so the proposer's refusal list
  is **one frozen constant, `SELF_GOVERNING_PATHS`**, covering `shared/autonomy-policy.json`,
  `electron/lib/autonomyPolicy.cjs`, `electron/lib/autonomyStop.cjs` and
  `shared/loyalty-tripwire.json`. **The proposer refuses any change path or remedy text naming any of
  them, and the list is derived from that one constant rather than restated per call site.**
- **FR-15** Rāma can **never** lift the STOP. Lifting requires a tier-0 capability and an
  authenticated `user` object plus a typed note; there is no internal caller, and a source-shape
  assertion forbids one.
- **FR-16** Engaging the STOP requires **no** capability check and **no** renderer: tray menu item,
  environment variable, or deleting the state file by hand all work.
- **FR-16a** **Engaging RECORDS why, before it destroys anything** (review-3 finding 11).
  `engage(reason, by)` writes `<userData>/rama/autonomy.stopped.json` carrying
  `{at, reason, by, priorAllow}` — `priorAllow` being the allow-file's contents — **and only then
  deletes the allow-file.** Revision pass 2's `engage(reason)` deleted the allow-file and returned,
  **destroying the only record of who allowed autonomy, when, and master's note, and dropping its own
  `reason` on the floor.** For the one automatic engage in the design — a **fatal revert**, with
  Rāma's source in an unverified state (§E.5.5) — that reason is the most important datum in the
  system, and it survived only as a ledger entry and a `console.error` line; `lift()` cannot succeed
  by design until master adds a capability, so recovery was master hand-writing a file **whose prior
  contents had just been deleted.** The stopped-record is read by `statusText()` and the Autonomy
  panel **for the reason**, and by `isHalted()` **for the pre-existing-dispatcher state** (FR-12) — and
  **never** by `isStopped()`, which stays a positive allowance, so **an absent stopped-record never
  implies autonomy is running.**
- **FR-17** The STOP does **not** block master's direct requests. `PRIORITY.CRITICAL` work, chat,
  StockMind on demand, **`proposals.approve` and `proposals.apply`**, and every manual action continue.
  **What is stopped is enumerated by name and shown** wherever Rāma's status is displayed.
  **The stop gates Rāma STARTING an apply, not master applying one** (review-2 finding 6). Applying an
  approved proposal is reachable only through `proposals:apply` with a tier-0 `user`, and this design's
  own framing is that the application is **master's act** (§E.1.1's L4 gloss, §D.1's fence) — so a
  STOP that revoked it would revoke master's ability to apply a change he had already approved, and
  **the shipped install, which has no allow-file, would begin in exactly that state.**

  > **Mechanically — and revision pass 2 got this wrong twice over, in opposite directions**
  > (review-3 findings 1 and 2). It said *"`apply()` consults `isStopped()` only when
  > `opts.autonomous === true`, and the `policy.require('revert-own-apply')` check is unconditional at
  > entry."* Both halves were defective:
  >
  > **(i) The unconditional policy check refused master's own apply on every shipped install.**
  > `effective()` resolves **every** class to `L0` while the STOP is engaged (§E.1.3's first line), the
  > shipped install has no allow-file, so `policy.require('revert-own-apply', 'L4')` **failed at entry
  > for a master-approved proposal** — the exact defect review-2 finding 5 raised and that raising
  > `revert-own-apply`'s floor to L4 was supposed to fix. Raising the floor fixed the *data* state and
  > left the *stop* state broken, and the same hole was reachable even with a valid allow-file through
  > `RAMA_AUTONOMY=stop`. **The fix: `apply-source` and `revert-own-apply` are a frozen `MASTER_ACT`
  > subset, and the master-driven path calls `policy.requireMasterDriven(classId, need)`, which
  > resolves through `effective(c, {ignoreStop: true})`.** `requireMasterDriven` **throws for any
  > classId outside the frozen `MASTER_ACT` set**, so the stop-ignoring path cannot be borrowed by a
  > Rāma-initiated class — which is what makes it a carve-out for master's act rather than a hole in
  > the stop. `effective(c)` with no options still returns `L0` for all fifteen while stopped, so
  > criterion 6a is unchanged.
  >
  > **(ii) The predicate deciding whether the STOP applied was supplied by the party the STOP
  > exists to stop.** Measured: `preload.cjs` 680 → `proposals:apply` (`proposals.cjs` 272) →
  > `apply(id, opts)` → `applier(p, opts)` at line 235 — **`opts` is renderer input passed through
  > untouched.** A future autonomous applier would bypass the stop by **omitting a field**, which is
  > this document's own *"gating six callers leaves the seventh"* doctrine failing on itself.
  > **`opts.autonomous` is therefore NEVER consulted as a gate. It is recorded into `meta.autonomy`
  > and nothing else** (FR-54, §E.9's `opts` row).
  >
  > **(iii) And the derivation the review proposed is necessary but NOT sufficient, which has to be
  > said rather than implemented and believed.** `masterDriven = !!(opts?.user && typeof
  > opts.user.tier === 'number' && capability.can(opts.user, 'self-modify.apply'))` is strictly better
  > than reading a renderer flag, and the applier asserts it **unconditionally — no tier-0 user, no
  > write** (FR-53). But measured, `proposals.apply` **already** ran `authorise(opts.user,
  > 'self-modify.apply')` before reaching the applier (`proposals.cjs` 215), so inside the applier the
  > predicate is **tautologically true**; and `capability.can` reads nothing but `user.tier`
  > (`capability.cjs` 27–33), so **a `{tier: 0}` object is forgeable by any in-process caller.** A
  > predicate that cannot be false where it is evaluated is not a gate. **So the structural guarantee
  > is an ABSENCE, in the shape criterion 18 already uses for `lift`: a source-shape assertion finds
  > ZERO in-process callers of `proposals.apply` anywhere in the tree** (FR-55, criterion 21c) — the
  > only caller is the IPC handler inside `proposals.cjs` itself. *The strongest guarantee available in
  > JavaScript is that the function is not called.*

**NOTICE**

- **FR-18** Every finding carries a `measurement` naming the sensor, the field and the value read.
  **A finding without one is refused at construction.** Nothing is invented by a model — **and that now
  holds for the change BODY as well as the finding** (FR-49): the bytes in `changes[].content` are
  produced by a declared mechanical transform over bytes read from disk, not generated as prose.
- **FR-19** Sensors: `selfModel.describe().limits[]` (where `fixable` is non-null),
  **`dependencyAdvisor.review(rows).actionable`** — where `rows` is
  **`registrySources.collect({pinned, getJson, postJson}).rows`** over `package.json`'s `dependencies`
  plus `devDependencies`, exactly as `main.cjs`'s `runDependencyReview` already builds them.
  **`.rows`, because `collect` returns `{rows, failures}`** (measured: `registrySources.cjs` 118 and
  188 — review-3 finding 15), **and `failures[]` is not dropped: each entry feeds `sensorsAbsent[]`**,
  which is the *unchecked-is-not-nothing-found* habit (B.2 habit 1) applied to this sensor rather than
  asserted about it in general. A package whose registry lookup failed is a package **not checked**,
  and reporting it as *"no action"* is the one dishonesty `dependencyAdvisor`'s header calls the most
  tempting;
  `review()` with no argument returns `{rows: [], actionable: []}`, so the earlier wording named a
  call that can only ever yield nothing (review-2 finding 19) — `astEngine.analyzeFile().issues`/
  `qualityScore`, a failing `scripts/verify*` suite (by row name), `metaCognition` outcome profiles,
  `aiProcess.diagnoseFailure`, and `auditRenderer` unresolved-bridge findings.
- **FR-20** Findings are **deduplicated by a stable fingerprint** so the same measurement does not
  produce a second proposal while the first is pending.

**RESEARCH**

- **FR-21** Research produces an auditable record: **what was read** (source, retrieval time, digest),
  **what it said** (claim, attributed, marked `unverified claim` where it is commentary), and **what is
  still unknown** — the third being mandatory and never empty-by-assertion.
- **FR-22** `unchecked` ≠ `nothing-found` ≠ `verified`. Not consulting a source is never reported as
  a clean result. (B.2 habit 1.)
- **FR-23** All outbound reads go through `lib/http.cjs` (I9) under
  `resourceOrchestrator.admit({priority: BACKGROUND})` (I10). Offline, research completes and says so;
  it does not fabricate and does not name a remedy that requires the network.
- **FR-23a** **Admission is per stage, from a declared table, and the heavy stages are the ones that
  must ask** (review finding 14): the NOTICE suite sensor and the applier's verification run are the
  most expensive work in the design and were previously unadmitted. **Pure in-process reads are exempt
  by explicit declaration, not by omission.** §E.4.0 carries the table.

**WEIGH**

- **FR-24** Pros and cons explicitly, **including the cost of doing nothing**, which is a required
  field.
- **FR-25** **Blast radius is COMPUTED, not asserted:** the files touched; the dependents found; the
  adjacent invariants; whether a protected file is touched; whether a `scripts/verify*` suite covers
  the change; and the rollback point. **A protected file in range ⇒ `needs-master-decision`
  unconditionally, and no diff-bearing proposal is created.** **No clean rollback point ⇒
  `needs-master-decision`.**

**PROPOSE**

- **FR-26** One ledger entry carries the whole dossier: requirement, research + sources, weighing,
  diff, verification plan, blast radius, rollback point — and after apply, the verification result.
  It must fit `proposals.create` with **no change to `proposals.cjs`**.
- **FR-27** Master's one-click **batch** approval must record a **per-item decision**. Mechanically:
  **no IPC channel that approves an array**, so a batch is a loop over single approvals, each with its
  own audit row.

**AFTER APPLY**

- **FR-28** After an applied proposal's write, run a verification plan **re-derived from `changes[]` at
  apply time** (the persisted plan is display-only — review finding 15). On failure, **restore each
  snapshotted file to its recorded prior state automatically**, verify the restore by digest, and
  re-run the plan. **The applier ALWAYS RESOLVES — never throws for a verification failure — with
  `{verified, reverted, revertAttested, causeId, cause, remedy}`, and mirrors the same verdict into
  `meta.verification.result` before resolving**, because `proposals.apply` sets `applied` whenever the
  applier resolves and keeps only `err.message` when it throws. Throwing would discard the dossier;
  resolving silently would leave the ledger saying `applied` for a reverted change. Both are fixed by
  making the verdict live in `meta`, which `forStorage()` preserves (review finding 6).
- **FR-29** Analyse the breakage with a **named cause from `verifyEngineDiagnosis`'s vocabulary**,
  extended in the same grammar for source-change failures. `"it failed"` must not be a reachable
  output. The analyser is **TOTAL**: every input yields a non-empty cause and remedy; nothing returns
  `null`; no bare URL or IP appears in the text.
- **FR-30** File a **new** proposal for the corrected fix, carrying `supersedes` and what was learned.
  **Bounded: at most one automatic re-proposal per fingerprint per 24 h, and after two failures on the
  same fingerprint the loop stops proposing for it and files a question instead.**

**Addendum A — what is recorded about master**

- **FR-31** `master-record` is a permanent `propose-only` class. Rāma may never widen its own
  retention window or capture scope.
- **FR-32** Every recorded item carries a `userId` from day one.
- **FR-33** The sensitivity gate is **on the payload at the cloud boundary**, not on the role name.
  The design names the exact chokepoint and shows a classified record cannot pass it. **The claim is
  scoped honestly to MODEL EGRESS: `chatCompletion` is the one path every provider's chat/completion
  call passes through, and it is NOT the only outbound path in the process that carries text.**
  **The counting unit is a GATE CALL SITE, and both numbers are stated and asserted: EIGHT gate call
  sites across SIX modules, covering TEN measured request sites** (§E.7.4's table gives file and
  line for each). Revision pass 1 asserted "exactly four" — which was an under-count in two
  directions: `codeRegenEngine.researchFix` makes **three** requests, not one (DDG 49, npm registry 69,
  GitHub search 87), and **`evolutionEngine.cjs` was absent from the design entirely** while making
  three more (`searchNpm` 220, `searchArxiv` 255, `githubAPI` 540). **Asserting a number that was not
  measured is worse than asserting a scoped one that was, and it would have made the suite green on
  the under-count while blocking anyone who added the missing calls** (review-2 findings 4 and 13).
  **One known-uncovered path is printed rather than omitted:** `evolutionEngine.readRepoFiles` also
  reaches `githubAPI`, carrying repository and path names rather than caller text, and is **not**
  gated — stated as a residual so a later session can decide it, not discovered by a leak.
- **FR-33b** **`gateOutbound`'s input shape and its default are declared, because the gate's default
  behaviour is a decision and not an implementation detail** (review-2 finding 14):
  `gateOutbound(parts, destination, why)` where `parts` is
  `Array<string | {text, classification?} | {contextBlock, classification}>`; **a bare string, or a
  part carrying no `classification`, is UNCLASSIFIED and PASSES**; `destination` is `'local'|'cloud'`
  with **no default**; the return is `null` when permitted and `{error, classification, why, evidence}`
  when refused. **Fail-open on an unclassified payload is the stated decision**: this gate exists to
  stop *classified rows* leaving, not to classify the whole application's traffic, and a fail-closed
  default would stop every chat in the product on the day it shipped.
  **And the consequence of that default must be stated where the gate is CREDITED with enforcement, not
  only where it is defined** (review-3 finding 10): a gate whose input is all bare strings **cannot
  refuse**, so a call site passing `[query]` is an **audit point**, not an enforcement point — *"a
  verification step that cannot fail is not a verification step"*, by this document's own rule. Hence
  **FR-51a**.
- **FR-51a** **A part is classified AT ITS SOURCE, by the code that constructs it**, so the gate it
  reaches can genuinely refuse. **In this design's own research path that is mandatory and mechanical:**
  `upgradeResearch` builds `{text: finding.what, classification: 'shareable'}` and
  `{text: finding.measurement.field, classification: 'shareable'}`, and **anything derived from
  `measurement.value`, a file's contents, or a `stderr`/`stdout` excerpt is constructed as
  `classification: 'local-only'`** — which turns FR-51's exclusion into a **positive** suite case (a
  part built from `measurement.value` is **REFUSED**, criterion 93) instead of an absence that a bare
  string satisfies by accident. **For the seven pre-existing call sites (§E.7.4 rows 1–7) the parts are
  master-supplied query text and stay UNCLASSIFIED, so those calls pass by construction and are
  declared AUDIT POINTS**; what enforces them is the construction of the query plus criterion 54a's
  counted-call assertion, and §E.7.4 and §E.11's residual list now say that rather than letting the
  prose credit the gate with a refusal it will never issue there.
- **FR-33a** **The destination is decided PER MODEL from measured classification, never from a
  provider name or a host string.** Ollama serves cloud models through the same `localhost:11434` as
  local ones (spec §130.9 puts that free tier in scope; `ollamaCatalog.cjs`'s own header says
  reporting them as local *"would tell master his prompt stayed on the machine when it did not"*), so
  `local` requires a measured `cloud === false`. **Unknown resolves to `cloud`.**
- **FR-34** A retention cap, and a purge that **actually deletes** via `cryptoCore.secureDelete`; a
  visible indicator while recording is on; one-click purge.
- **FR-35** Excluded from backup unless master says otherwise. The coupling to §9.2's backup question
  is **raised, not resolved**.
- **FR-36** **Stage 0 only: the schema, the capability, the guarantees, the policy class. Default off.
  Recording nothing.** `selfModel` keeps reporting the existing limit while it is off.
- **FR-37** Carry the machinery to evaluate the falsifiable criterion set in advance: if after a
  declared window tier-3 synthesis has produced no reflex that saves a model call, that is a finding
  and the response is to **stop recording**. **The criterion is a FROZEN CONSTANT, not a caller's
  argument** — `CRITERION = Object.freeze({windowDays: 90, minModelCallsSaved: 1, minReflexes: 1})` —
  because a criterion the caller supplies is not fixed in advance, which is the whole point of having
  one (Addendum A §A.3, spec §127.5; review finding 17). **The measurement source is named:**
  `metaCognition.recordOutcome`'s `{action, tool, role}` is what makes *"a reflex saved a model call"*
  a counted event. **Until that source exists, `evaluateCriterion` returns
  `{verdict: 'too-early', why: 'no measurement source yet'}` rather than accepting an unmeasured
  number** — the `unmeasured()` rule from `selfModel`, applied to the criterion itself.
- **FR-38** **REFUSED, and made difficult rather than merely undocumented:** recorded prompts must
  have no path to a cloud model.

**Added in revision pass 2 — FR-49…FR-52**

*Numbered after FR-48 (Addendum B's block in §D.7) rather than renumbered, so a finding and the
requirement that answers it stay traceable.*

- **FR-49** **Something must AUTHOR the change, and what it is must be declared.** Revision pass 1
  described a loop that could notice, research, weigh, propose, apply and revert — **and no stage,
  module or injected io produced `changes[].content`** (review-2 finding 1). A class permitting a diff
  to be filed is empty if nothing makes one. **The decision: a named sixth module,
  `upgradeAuthor.cjs`, whose authoring mechanism in THIS tranche is a frozen table of MECHANICAL
  EDITS over bytes read from disk — no model writes Rāma's source.** Specifically:
  - **A frozen `EDITS` table.** Each entry declares `{editId, matches, appliesTo, transform,
    preconditions, verifiableBy}`; a finding whose `fixable` string matches no entry **produces no
    diff** and the loop files a question reading `blockedBy: 'no declared edit matches this remedy'`.
    **`build-repair` therefore means "the repairs this table can express"**, which is a narrower and
    honest claim, and the table is additive (I11) — a new edit is a new frozen entry with its own
    suite row.
  - **Every change records its author and its base.** `changes[]` carries
    `author: 'template:<editId>'` and `baseSha256` — the digest of the file the transform read — and
    **the applier refuses if the on-disk digest no longer matches `baseSha256`**, so a diff authored
    against bytes that have since changed cannot be applied blind.
  - **`AUTHORING_MODES = Object.freeze(['template'])`.** `author: 'model:<id>'` is a declared,
    reserved and currently **refused** value. Turning it on is **one value in one frozen constant,
    visible in a diff, needing an I6 approval** — the same unlock shape as L5 — **plus** the two
    conditions specified now rather than later: `destinationOf(modelInfo(id)).dest === 'local'`, so
    Rāma's own source never leaves the machine to be rewritten; and a mandatory
    `cons += 'the patch was written by <modelId>, not measured'`, so the weighing says out loud that
    one term in it is not a measurement. **§I.9 raises it; this design does not take it.**
  - **The class is `author-change`** (floor L1, ceiling L3, §E.1.2 row 8), so on a shipped install
    **no change body is authored at all** — which is the same behaviour as `propose-source` at L1 and
    is why the two must be raised together for a diff to exist.
- **FR-50** **The proposer's refusals bind the LOOP; the applier's validation binds the KIND**
  (review-2 finding 3). Every refusal in §E.4.4 lives inside `upgradeProposer.file()` — **one caller.**
  Measured: `proposals.create` consults none of them, and `proposals:create` is a renderer-reachable
  IPC handler gated only on `self-modify.view` (**tier 1**) that passes `def` through with `meta`
  intact. `loyaltyGuard.assertChangesSafe` still protects the seven files at creation, but
  `shared/autonomy-policy.json` and `shared/loyalty-tripwire.json` are **not** in `PROTECTED_FILES` —
  so a hand-built `self-upgrade` entry raising `propose-source` from L1 to L3 could sit in the queue
  under an Approve button. **`proposals.cjs` is protected and must not change, so the enforcement
  moves to the one component this design owns that writes source: the applier.** §E.5.0 specifies
  **seven** entry validations — six on the entry plus check 0 on the caller (FR-53/FR-55) — and **the
  residual is printed** rather than implied.
- **FR-51** **A research query's classification is decided here, not by whoever implements it**
  (review-2 finding 13). RESEARCH is itself an outbound text path, and what it would naturally carry —
  a stderr excerpt, a measured value, a file's contents — is **Rāma's own internals, about which
  master has not been asked.** **The rule: a research query may carry the finding's `what` and a
  sensor's FIELD NAME. It may not carry `measurement.value`, file contents, or any stderr/stdout
  excerpt.** Asserted as an absence: those fields never appear in the query string.
- **FR-52** **The snapshot eviction rule is a rule, not a phrase.** "The lesser of 20 entries or 30
  days" is not a comparison — a count and a duration have no ordering (review-2 finding 15). **A
  snapshot directory is evicted when EITHER bound is exceeded: its age is over 30 days, OR it is not
  among the 20 most recent non-`fatal` directories. `fatal` entries are never evicted and do not count
  toward the 20. The eviction count is reported.**

**Added in revision pass 3 — FR-53…FR-59**

*Numbered after FR-52 rather than renumbered, keeping the convention: a finding and the requirement that
answers it stay traceable across passes.*

- **FR-53** **`MASTER_ACT` is a frozen subset of two classes — `apply-source` and `revert-own-apply` —
  and it is the ONLY path that may ignore the STOP** (review-3 finding 1). `policy.effective(c)`
  resolves `L0` for all fifteen classes while the STOP is engaged, unchanged; **`policy.effective(c,
  {ignoreStop: true})` is the opt-in that skips that first line, and `policy.requireMasterDriven(classId,
  need)` is the only caller of it.** `requireMasterDriven` **throws** when `classId ∉ MASTER_ACT`, so a
  Rāma-initiated class can never borrow the carve-out. The reason this exists: without it a
  master-approved `self-upgrade` **could not be applied on any shipped install**, because the shipped
  install has no allow-file, is therefore stopped, and the applier's `policy.require('revert-own-apply',
  'L4')` at entry resolved against an `L0` the stop had forced — the same defect review-2 finding 5
  raised, fixed in the data state and left live in the stop state.
- **FR-54** **`opts` is renderer input and is treated as such.** Recognised keys are **exactly
  `{user, autonomous}`**. `autonomous` is **recorded into `meta.autonomy` and never consulted as a
  gate**. **No path, directory, plan, timeout, `cwd`, environment value or force flag is ever read from
  `opts`** — every such value is derived (FR-13a's rule, generalised). Unrecognised keys are ignored, not
  rejected, because `proposals.cjs` may add one and this design does not get a veto on it. Measured:
  `opts` reaches the applier whole (`preload.cjs` 680 → `proposals.cjs` 272 → `applier(p, opts)` at
  235), and revision pass 2's §E.9 had **no row for it** while validating the proposal in six ways
  (review-3 finding 6). The design's own FR-13a lesson is that a persisted string used as a write
  destination is a leak path; **an `opts.snapshotDir`, `opts.plan`, `opts.repoRoot` or `opts.force`
  added later is the same mistake through a different door**, and the row plus criterion 83a's
  source-shape assertion close it in advance rather than after.
- **FR-55** **Nothing in Rāma's own process calls `proposals.apply`.** A source-shape assertion over the
  whole tree finds **zero** in-process callers; the only caller is the `proposals:apply` IPC handler
  inside `proposals.cjs`. **This, not a predicate over `opts`, is what makes "Rāma does not start an
  apply" true** — because `capability.can` reads only `user.tier` (`capability.cjs` 27–33), a `{tier: 0}`
  object is forgeable by any in-process caller, and `proposals.apply` already authorised `opts.user`
  before the applier ran, so the derived predicate is tautologically true where it is evaluated
  (review-3 finding 2). The future L5 entry point is **named and currently absent**:
  `upgradeLoop.applyAutonomously` would call `policy.require('apply-source', 'L5')` **and**
  `stop.isStopped()` **at its own entry** — which is where a start-of-work check belongs — and the
  assertion that finds zero callers today is the row that must be deliberately changed to add it.
- **FR-56** **A finding's remedy is STRUCTURED DATA, produced by a declared per-sensor adapter; the prose
  stays for display and is never parsed** (review-3 finding 4). `finding.remedy` is
  `{editId, params} | null`, produced by a frozen `ADAPTERS` table keyed by sensor id.
  **`upgradeAuthor.author` refuses unless `remedy.editId` is a member of `EDITS` and `params` satisfy
  that entry's preconditions.** Measured, this is not a tidy-up: **all seven `fixable` strings in
  `selfModel.cjs` 206–266 are human prose** — *"install Ollama and pull a model — tier 1 then works
  offline and free"*, *"record the request text — which has a privacy consequence master must accept
  first"*, *"build on a machine that can run 7za, or install a system 7-Zip"* — **and not one is in a
  shape any `EDITS` entry could match**, while revision pass 2 declared the match as *"a fixable naming
  'export X from Y'"* and said nothing about how parameters leave prose. So **the sensor this document
  calls the natural input to NOTICE had zero reachable edits**, and criterion 41's diff assertion was
  satisfiable only by a synthetic fixture. `ADAPTERS` makes the reachable set **declared and counted**
  (criterion 90a), and **`selfModel → null` is written down as a decision**, not discovered as an
  absence.
- **FR-57** **One applier signature, and it is the one `proposals.cjs` can actually call.** Measured:
  `proposals.cjs` 235 invokes `await applier(p, opts)` — **two arguments** — so **no injected `io` can
  reach a registered applier** and NFR-2's injection seam did not exist for this module; revision pass 2
  gave three mutually incompatible signatures across §E.5.0, §E.5.1a and §E.11 (review-3 finding 5).
  **The decision: `upgradeApplier.register(ledger, io)` closes over `io` and registers
  `(proposal, opts) => applyWith(io, proposal, opts)`, and `applyWith(io, proposal, opts)` is exported
  so the suite calls it directly with fakes.** One signature, one seam, and the registered closure is
  the only thing that has to match the ledger's call shape.
- **FR-58** **The classification predicate is dependency-free and separate from the store.**
  `gateOutbound` and the classification constants move to a new **`electron/lib/classificationGate.cjs`**
  with no `dataStore`, no `cryptoCore` and no Electron requirement; **`contextStore` re-exports them**, so
  every call site in §E.7.4 reads unchanged. The reason is this document's own argument about the STOP —
  *"a stop that can fail to load is not a stop"* — applied to the gate: revision pass 2 put `gateOutbound`
  in `contextStore.cjs`, which criterion 54b requires to be the **only** holder of
  `dataStore.get('context')`, so **the chat chokepoint acquired a store-bound dependency and the design
  never said what happens when the store is locked or loads late** (review-3 finding 9). A gate that
  throws because the vault is locked is a chat failure, not a refusal.
- **FR-59** **A policy level master has lowered to `L0` silences the loop VISIBLY.** If
  `propose-question` is restricted to `L0`, `upgradeProposer.file()` files nothing and the run log and
  `policyStatus()` both carry `{blocked: true, classId: 'propose-question', have: 'L0', need: 'L3'}`,
  which the Autonomy panel renders as *"Rāma is noticing and researching, and may file nothing — you set
  `propose-question` to L0."* **A loop that has been silenced by data must never be indistinguishable
  from a loop with nothing to say** — that is `sensorsAbsent[]`'s rule (B.2 habit 1) applied to the
  proposer's own output.

## D.3 Non-functional requirements

- **NFR-1** `node --check` clean on every `.cjs`; diagnostics clean on every `.jsx`.
- **NFR-2** Every new pure function testable under plain `node` with no Electron, no network, no
  Python — every probe, clock, store and fetcher **injected**. (`selfModel`, `dependencyAdvisor`,
  `refreshScheduler`, `badgeLabel`, `claimGate` all already hold this line.) **For the applier the seam
  is a CLOSURE, not a third parameter, because the ledger calls `applier(p, opts)` with exactly two
  arguments** (measured, `proposals.cjs` 235) — `register(ledger, io)` closes over `io` and the suite
  calls the exported `applyWith(io, proposal, opts)` directly (FR-57, review-3 finding 5).
- **NFR-3** Suites follow the house pattern: **a row passes only if breaking the enforcement point
  makes it go RED**, planted breaches run **unconditionally**, and **unclosed gaps are printed and
  counted on every run**.
- **NFR-4** No `console.log`; `console.warn`/`console.error` only. No placeholders, no TODOs. Pinned
  versions. (I12.)
- **NFR-5** The loop's steady-state cost is bounded: one scheduler task, `PRIORITY.BACKGROUND`, no new
  timer system, and **`admit()` before every stage that spends more than an in-process read — five
  admissions, each with its own `ramMB` and label, declared in §E.4.0.** The pure-read sensors are
  listed there as exempt so the exemption is a decision rather than a gap.
- **NFR-6** New surfaces are `src/config/registry.js` `PAGES` entries (I7), reachable at a tier the
  matrix already defines.

## D.4 Acceptance criteria

*Numbered, specific, testable. Suite names in §E.11.*

**Fence**

1. A source-shape assertion over every new `.cjs` finds **no DIRECT `fs.write*`/`fs.rename`/`fs.unlink`/
   `fs.rm` call whose target is anything other than (a) the DERIVED snapshot directory or (b) a
   validated `changes[].path`**, plus **one declared exception row that the suite PRINTS rather than
   hides** (FR-1, review-3 finding 13): the plan's **spawned** steps write — `vite build` → `dist/`
   under the repository root, each `scripts/verify*` suite → its own temp directory — and those writes
   are performed by the spawned process, not by code introduced here. **The exception is bounded by
   criterion 83's extension**, which asserts the `cwd` and that every `execFile` argument derives from
   the re-derived change set rather than from persisted `meta`. *Revision pass 2 wrote the fence as
   "no write under the repo root" while its own plan ran `vite build`, and the scan covered only new
   `.cjs` files — so the literal fence was contradicted with no row going red.* — the scan is **no longer scoped to paths under the repo root**, which
   is what left writes under `userData` unasserted while the allow-file lives there (review-2
   finding 2). The two allowed branches are `upgradeApplier.cjs`'s approved-apply branch and its
   `revert(token)` snapshot-restore branch. **Both live in `upgradeApplier.cjs` — there is no separate
   `upgradeRevert.cjs`, and revision pass 1 removed the two references that implied one** — so the scan
   has exactly one file to allow and every other new `.cjs` must be clean. The allowed-call count is
   printed.
2. A source-shape assertion finds **no reference to `releaseChannel`, `cutRelease`, `npm version`,
   `git tag` or `publish`** in any new file.
3. `weigh()` given a change naming `electron/lib/loyaltyGuard.cjs` returns
   `verdict: 'needs-master-decision'` and `blastRadius.protectedTouched: ['electron/lib/loyaltyGuard.cjs']`;
   `propose()` on that weighing creates a **question-kind** entry with `changes: []` and **never** a
   diff-bearing one.
4. The protected list used by `weigh()` is **obtained from `loyaltyGuard`, read at CALL TIME and never
   captured at module load**: a test that monkey-patches `PROTECTED_FILES` to add a path makes
   `weigh()` refuse the added path. (A restated literal list fails this.)
4a. **`weigh()` uses `loyaltyGuard.inspectChanges(changes).refused` as `protectedTouched`, not a set
   intersection** — the guard matches by equality, `/`-suffix and basename-plus-dirname, so the two
   algorithms disagree on absolute and `./`-prefixed paths (review finding 9). Asserted with
   `'./electron/lib/proposals.cjs'` and with an absolute path to the same file: **both refused.**
4b. **Injection alone cannot prove the list is not restated, so a source-shape scan covers it**
   (review finding 10): over every new `.cjs` **and the `main.cjs` wiring site**, the literal strings
   `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`,
   `genomeApplier.cjs`, `capabilities.json` appear **zero** times outside a single
   `require('./loyaltyGuard.cjs')` read. The count is printed.
5. `scripts/verifyLoyaltyTripwire.cjs` is **unchanged and still green** after this work; `git diff`
   shows **zero** lines changed in `proposals.cjs`, `loyaltyGuard.cjs`, `loyaltyCore.cjs`,
   `nucleusSealer.cjs`, `capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json`.

**Autonomy policy**

> **Criteria 6–9 all run WITH A VALID ALLOW-FILE FIXTURE PRESENT.** Without one the STOP dominates and
> `effective()` resolves every class to `L0` before it looks at the data file at all, so "returns the
> floor" is false in the shipped state for every class whose floor is not `L0` (review-2 finding 9).
> The precedence between the two gates is **criterion 6a**, which makes it testable rather than
> implied. This is review-1 finding 3's defect again, in the policy suite rather than the loop suite:
> criteria 40 and 40a were fixed by naming the fixture; 6–9 were not.

6. With a valid allow-file fixture present and **no** `shared/autonomy-policy.json` — **which is the
   shipped state of the data file (§E.2.7)** — `effective(c)` returns `floor(c)` for all **15** classes
   and `reason` reads `'no policy file — every class at its floor'`.
6a. With **no allow-file and no policy file** — the state a shipped install actually boots in —
   `effective(c)` is `'L0'` for all **15** classes and `policyStatus().stopped` is `true`. **Two
   assertions, and together with criterion 6 they pin the precedence: the STOP is consulted before the
   data file, always.**
7. With the allow-file fixture present, a data file containing `{"levels":{"master-record":"L4"}}` is
   **rejected whole**: `effective()` returns the floor for **every** class (not just `master-record`),
   `policyStatus().rejected` is `true`, and `policyStatus().why` names `master-record` as a permanent
   class.
8. A data file containing `{"levels":{"observe":"L5"}}` is rejected whole, and `why` states that `L5`
   is declared and unreachable.
9. A data file is rejected whole in each of **five** cases, one assertion each: an unknown class id; a
   non-string level; an extra top-level key; a level above that class's ceiling; and **a missing
   `version`, or a `version` that is not `1`** — the fifth case, which the earlier row promised five
   assertions without naming (review-2 finding 18). `validate()` lists nine rejection conditions in
   total (§E.1.3); these five are the ones the suite plants.
9a. **A data file may RESTRICT below a floor and that is not a rejection:**
   `{"version":1,"levels":{"research-network":"L1","revert-own-apply":"L0"}}` is **accepted**, and
   `effective()` returns `L1` and `L0` for those two. **Two assertions.** The floor is a fallback for
   an absent value, not a minimum for a present one (FR-6), and §I.1's offer to disable the automatic
   revert is exactly this path.
10. Moving `'master-record'` out of the frozen `PERMANENT` set in `autonomyPolicy.cjs` makes the row
    *"permanent classes cannot be raised"* go **RED** — a planted mutation, run unconditionally.
11. `CLASSES`, `FLOORS`, `CEILINGS` and `PERMANENT` are `Object.freeze`d, and an assertion proves a
    runtime write to each is a no-op.
12. Every class id in `CLASSES` appears in `FLOORS` **and** `CEILINGS`, `floor <= ceiling` for all,
    `PERMANENT ⊆ CLASSES`, and **`RAMA_INITIATED ⊆ CLASSES`** — so the table cannot drift partway.
    **Plus the row that makes FR-6 mechanical rather than a sentence** (review-2 finding 8):
    `levelIndex(FLOORS[c]) <= levelIndex('L3')` **for every `c` in the frozen `RAMA_INITIATED`
    subset**, and `levelIndex(FLOORS[c]) <= levelIndex('L4')` with `FLOORS[c] !== 'L5'` for every class
    without exception. A coder writing the assertion from FR-6's old wording — `<= L3` over *all*
    classes — would have got a red row on the shipped table, because `apply-source` and
    `revert-own-apply` both have an L4 floor by design. **Six assertions.**
13. **Mechanically checkable, which the earlier wording was not** (review-1 finding 16), **and the
    `need` is part of the literal, which revision pass 2's was not** (review-3 finding 7).
    `autonomyPolicy` exports a frozen **`GATED = [{module, fn, classId, need}]`** with **all six rows
    spelled out** (§E.1.4's table). The suite asserts: every `classId` in `GATED` is in `CLASSES`;
    every `need` matches `/^L[0-4]$/`; the **named function's own body contains the FULL literal
    `policy.require('<classId>', '<need>')`** — or, for the applier, `policy.requireMasterDriven(
    '<classId>', '<need>')` — a source-shape scan bounded to that function;
    **`GATED.length === autonomyStop.CHOKEPOINTS.length + autonomyStop.MASTER_DRIVEN_ENTRIES.length`
    (6 = 5 + 1), every member of `MASTER_DRIVEN_ENTRIES` carries a non-empty `reason`, and a gated
    path in neither list FAILS the row** — `stopExempt`'s rule (criterion 22b) applied to the
    chokepoint list itself, so the one path that does not consult the stop is **declared rather than
    omitted**; all three counts are
    **printed**; and a **planted mutation deleting one `policy.require` call turns the row RED**.
    **Plus the row that makes `need` non-optional: `policy.require('observe')` with no second argument
    THROWS** (§E.9's no-default rule), because a gate whose level defaults is a gate whose refusal
    cannot name what it needed. **And `upgradeWeigh.weigh`'s class is `research-local`, not left
    between two candidates** — revision pass 2 listed `weigh` as a chokepoint while no class among the
    fifteen covered weighing, and `observe` and `research-local` were both plausible.
    *"No autonomy decision without a require call" is not a syntactic category; a named list of
    functions that must each contain a named literal is.*
13a. **`file()`'s class is decided by the KIND it is filing, from a declared sub-table** (review-3
    finding 7): `KIND.QUESTION → propose-question`, and `KIND.DIFF → propose-source |
    dependency-change | build-repair` by the finding's own `class`. **Four assertions:** a question
    requires `propose-question` at L3; a diff from a `dependency-change` finding requires that class
    and not `propose-source`; **with `propose-question` restricted to `L0` by the data file, `file()`
    files NOTHING and returns `{ok: false, blocked: true, classId: 'propose-question', have: 'L0',
    need: 'L3'}`**; and `policyStatus()` plus the Autonomy panel render that state as *"Rāma is
    noticing and researching, and may file nothing — you set `propose-question` to L0"* (FR-59). **The
    third and fourth matter together: a loop silenced by master's own data edit must not look
    identical to a loop with nothing to say.**

**STOP**

14. With no state file: `isStopped()` is `true`. With `{"allowed":true,...}`: `false`. With
    `{"allowed":"true"}` (string), `{}`, `{"allowed":1}`, invalid JSON, a directory where the file
    should be, and a zero-byte file: `true` in **all six** cases.
15. `RAMA_AUTONOMY=stop` forces `isStopped() === true` **even with a valid allow-file present**.
16. `isStopped()` is synchronous and **requires only `fs`/`path`/`os` AT MODULE SCOPE**; **Electron is
    reached only through a guarded lazy `require` inside `allowPath()`**, and a test run with
    `electron` unresolvable **and an injected root** still gets an answer. *(Reworded in revision
    pass 2: "requires only `fs`/`path`/`os`" read as a contradiction with §E.2.7's
    `app.getPath('userData')`. Both are satisfiable together — that is what "at module scope" and "lazy"
    mean — but the row has to say so, because a coder reading the old wording would have had to choose
    one — review-2 finding 20.)*
17. `lift(user, note)` refuses: a string `user`; `{tier: 1}`; `{tier: 0}` with no note; `{tier: 0}`
    with a note **when `system.suspend-autonomy` is absent from the matrix** (→ `can()` is false for
    everyone, so the honest refusal names the missing capability). **Four assertions.**
18. A source-shape assertion finds **exactly zero** internal callers of `lift` across the tree.
19. The state file path resolves **outside** the repository root, and `proposer.file()` refuses a
    finding whose remedy or diff names **any member of `SELF_GOVERNING_PATHS`** — four assertions, one
    per path, **planted, and the row goes RED if a refusal is removed**.
19a. **`SELF_GOVERNING_PATHS` is one frozen constant and the proposer's refusal list is derived from
    it**: removing `shared/autonomy-policy.json` from the constant makes the row go **RED** rather
    than quietly widening what may be proposed. Asserted specifically: a diff-bearing proposal that
    would raise `propose-source` from L1 to L3 by editing the data file is **refused outright, not
    downgraded to a question**, so it can never sit in the queue under an Approve button (review-1
    finding 5).
19b. **The applier refuses what the proposer never saw — because the proposer is a caller, not the
    chokepoint** (review-2 finding 3). `proposals.create` consults no refusal in §E.4.4 and
    `proposals:create` is renderer-reachable at **tier 1**, so a hand-built entry can enter the queue
    outside the loop. **Six assertions, one per §E.5.0 validation, each with a hand-built
    `kind: 'self-upgrade'` proposal approved by a tier-0 fixture and each refused BY THE APPLIER with
    the ledger recording `failed`:** (a) no dossier / `meta.schema !== 'self-upgrade/1'`; (b) a change
    path naming a `SELF_GOVERNING_PATHS` member; (c) a change path failing §E.9's resolve-then-compare
    rule; (d) `action: 'delete'`, or a `create` over an existing path; (e) a path
    `guard.inspectChanges` refuses, **re-run at apply time rather than trusted from creation**;
    (f) `baseSha256` no longer matching the file on disk. **§E.5.0's CHECK 0 — the `masterDriven`
    derivation and `requireMasterDriven` — is covered by criteria 21, 21b, 21c and 83a instead of
    here, because its fixtures are about the caller rather than about the entry.** **A seventh
    assertion prints the residual:**
    *"`proposals.create` is reachable at tier 1 and consults neither the autonomy policy nor the stop;
    the proposer's refusals bind the loop, the applier's validation binds the kind."*
20. With the STOP engaged, each of the **five** `CHOKEPOINTS` stage entry points returns
    `{ok: false, stopped: true, reason}` **without** performing its work — **five assertions, one per
    chokepoint, including `upgradeAuthor.author`** (FR-49) — while a `PRIORITY.CRITICAL` admission
    still succeeds. **A sixth assertion covers the one gated path that is NOT a chokepoint:
    `upgradeApplier.applyWith` is in `MASTER_DRIVEN_ENTRIES`, completes while stopped for a
    master-driven apply (criterion 21b), and carries a non-empty declared `reason`** — because the
    member that behaves differently must be declared rather than left out of the list (review-3
    findings 1 and 2). *Revision pass 2 counted the applier as the sixth chokepoint while specifying
    that it consulted the stop only on a renderer-supplied flag — so the list said one thing and the
    behaviour another.*
21. **The in-flight revert carve-out is a TOKEN, not a special case inside `effective()`** (review-1
    finding 12). `applyWith(io, proposal, opts)` checks
    **`policy.requireMasterDriven('revert-own-apply', 'L4')`** — which resolves through
    `effective(c, {ignoreStop: true})` and **throws for any class outside the frozen `MASTER_ACT`
    subset** (FR-53) — **unconditionally at entry, before any write**, derives `masterDriven` from
    `opts.user` and **refuses with no write when it is false** (FR-53, FR-55), **never consults
    `opts.autonomous` as a gate** (it is recorded into `meta.autonomy`), and issues
    `{proposalId, snapshot, dir, at}`. `revert(token)` consults **neither** the policy nor the stop.
    **Five assertions:** a revert holding a token completes with the STOP engaged
    mid-apply; a **tokenless** revert is refused; **an apply with no `user` and no `autonomous` flag,
    while stopped, never reaches a write** — refused for the missing tier-0 user, and the row states
    that reason so nobody later credits the stop with it (review-3 finding 2);
    **an apply carrying `autonomous: true` is applied exactly like one without it and the flag appears
    only in `meta.autonomy`** — the flag is data, not a decision; and **a master-driven apply (tier-0
    `user`) entered while stopped COMPLETES** — because applying a proposal master already approved is
    master's act, and the shipped install is permanently stopped, so the earlier wording would have made
    the headline guarantee dormant on every install.
21a. **With no policy file and a valid allow-file, a master-approved apply completes and its revert
    runs** (review-2 finding 5 — the row that would have caught it). `revert-own-apply`'s floor is
    **L4**, so the `policy.require` at `apply()` entry passes in the shipped data state; a fixture
    whose plan fails then reverts, and `revertAttested` is `true`. **Two assertions, and this is the
    load-bearing one for the whole AFTER-APPLY guarantee**: with the floor at L0 — which is what
    revision pass 1 shipped — a master-approved `self-upgrade` could not have been applied at all.
21b. **THE ROW THAT WOULD HAVE CAUGHT REVISION PASS 2, AND IT RUNS IN THE SHIPPED STATE** (review-3
    finding 1). **With NO allow-file and NO policy file — what every shipped install actually boots
    into — three assertions:** a tier-0 master-approved `self-upgrade` **applies**; a fixture whose plan
    fails **reverts**; and `revertAttested` is **`true`**. **Then the same three with
    `RAMA_AUTONOMY=stop` set over a VALID allow-file**, because that environment variable is checked
    first and overrides the file, so it was the second reachable form of the same defect. **Six
    assertions.** *Criterion 21a asserted the data state and passed; the stop state forced `L0` on
    every class before the resolver read the file, so `policy.require('revert-own-apply', 'L4')` at
    entry refused a master-approved apply on every install — the defect review-2 finding 5 named,
    half-fixed, and left live through the other gate. `requireMasterDriven` over the frozen
    `MASTER_ACT` subset is what closes it, and a planted mutation ADDING a third class to `MASTER_ACT`
    must turn this row's seventh assertion RED.*
21c. **Nothing in the process calls `proposals.apply`** (FR-55, review-3 finding 2). A source-shape
    assertion over the whole tree finds **exactly zero** in-process callers of `proposals.apply` or a
    bound `ledger.apply` — the only caller is the `proposals:apply` IPC handler inside `proposals.cjs`
    itself — **and `upgradeLoop.applyAutonomously` does not exist.** **Three assertions, in criterion
    18's shape**, and the row **prints why the obvious alternative is not enough**: `capability.can`
    reads only `user.tier`, so a `{tier: 0}` object is forgeable in-process, and `proposals.apply`
    authorised `opts.user` before the applier ran — so the derived `masterDriven` predicate is
    tautologically true where it is evaluated and **cannot be the thing that stops Rāma starting an
    apply.** *An absence is the only guarantee available here, and this project has asserted absences
    before: `verifyClaimGate`'s missing score, `loyaltyCore`'s missing accessor, criterion 18's zero
    callers of `lift`.*
22. `badgeLabel`'s stopped-state text **enumerates the halted timers by name**, and the existing
    `verifyBadgeLabel` rule — each named timer still exists on disk — holds for them.
22a. **Every timer the halted label names is actually halted, and every timer that is NOT halted is
    named with its reason** (review-1 finding 7, extended in revision pass 2 after review-2 finding 7
    measured two more state-changing timers). **Run with the STOP EXPLICITLY ENGAGED — `engage()`
    called, or `RAMA_AUTONOMY=stop` — because these four read `isHalted()`, not `isStopped()`, and an
    absent allow-file does not halt them** (review-3 finding 3; the fixture state is named here the
    way criteria 6–9 name theirs). Then: `refreshScheduler.runNow(
    'ollama-catalog')` and `runNow('dependency-review')` both return without calling `task.run()`
    (counting fake `run`) **and `refreshScheduler.stop()` has cleared the named timers** — both,
    because a cleared timer cannot stop an in-flight `runNow` and an in-dispatch check cannot stop a
    timer waking the process (review-3 finding 19); `metaCognition.stopAudit()` has cleared the audit
    interval and `startAudit()` re-arms it on lift; **`selfCare.runHealthSweep()` called directly while
    halted returns without calling `checkInstanceFailover` (counting fake) and `stopSweep()` has
    cleared the 2-minute interval — asserted over BOTH arming sites, 345 and 396, because replacing
    one inline arm leaves a live timer the interval-clearing assertion still passes** (review-3
    finding 17); **`marketIntel.tickResolveOutcomes()` and `tickSyncNews()` called directly
    while halted each return without doing their work, and `stopScheduler()` has cleared both
    timers**. **Ten assertions.** The in-function checks are asserted *separately from* the
    interval-clearing ones, because an interval already in flight when the halt engages is exactly the
    case a `clearInterval` alone does not cover.
22d. **The two predicates are asymmetric, and BOTH states are enumerated by name rather than
    labelled** (FR-12, FR-13, review-3 finding 3). **Six assertions.** With **no configuration at
    all** — the shipped install: `isStopped()` is `true`, `isHalted()` is **`false`**, a counting fake
    proves `refreshScheduler.runNow('ollama-catalog')` **does** call `task.run()` and
    `selfCare.runHealthSweep()` **does** call `checkInstanceFailover`, and **`statusText()` names those
    four pre-existing dispatchers as STILL RUNNING while naming the six new chokepoints as stopped.**
    With the stop **explicitly engaged**: `isHalted()` is `true` and `statusText()` names all four as
    halted. **Plus the planted row:** making `isHalted()` read the allow-file — i.e. collapsing the two
    predicates back into one — must turn this row **RED**, because that is precisely the change that
    would silently remove four working behaviours on every install. *Revision pass 2 had one predicate
    and an §E.2.7 shipped-state sentence that named only the loop; the four dispatchers it also
    governed ship and run today, so installing that design was a regression dressed as a fail-safe.*
22b. **The exempt set is declared, non-empty, printed, and every member carries a reason.**
    `stopExempt` ships with **exactly one** member — `agentOrchestrator`'s governor — whose reason
    reads *"reaper only: it kills timed-out agents and assimilates finished ones, so halting it leaves
    hung agents running and unassimilated"*. **Three assertions:** the set has one member; that member
    has a non-empty `reason`; and **a timer present in neither `DISPATCHERS` nor `stopExempt` fails the
    row** — so a future autonomous timer cannot be neither stopped nor declared, which is the gap that
    made `selfCare`'s sweep invisible to revision pass 1. *(Revision pass 1 printed `stopExempt` as
    empty, which read as "nothing is exempt" when the truth was "nothing had been looked for".)*
22c. **`engage(reason, by)` tears down autonomous children, clears the named timers, and RECORDS WHY
    BEFORE IT DESTROYS ANYTHING** (R-L4's second half; extended in revision pass 3 by findings 11 and
    19). With two fake running agents
    and one fake sandbox child, `engage('fatal revert', 'applier')` calls each agent's `killFn` — the
    path the governor uses at **`agentOrchestrator.cjs` 637**, not 634 (review-3 finding 17; `killFn`
    also appears at 122, 140 and 359, so the wrong line pointed at a different caller) — and the
    sandbox's `proc.kill('SIGTERM')`, **and calls `refreshScheduler.stop()`**, and a further assertion
    proves it does **not** throw when there are none. **Plus the record:
    `<userData>/rama/autonomy.stopped.json` exists afterwards carrying
    `{at, reason: 'fatal revert', by: 'applier', priorAllow: <the allow-file's prior contents>}`, it
    was written BEFORE the allow-file was unlinked (ordering asserted with a write-ordering fake), and
    `statusText()` reads the reason out of it.** **And the row that keeps the two predicates honest: an
    ABSENT `autonomy.stopped.json` never makes `isStopped()` return `false`** — criterion 14's shape,
    because the stopped-record is the authority for `isHalted()` and is **never** consulted for
    `isStopped()`. **Eight assertions.** *Revision pass 2's `engage(reason)` deleted the allow-file and
    returned, dropping its own reason and the only record of who had allowed autonomy — on the one
    automatic engage in the design, where that reason is the most important datum in the system.*

**NOTICE**

23. `notice({what:'x', class:'build-repair'})` with no `measurement` **throws**; with
    `measurement:{sensor,field,value,at}` it returns a finding whose `fingerprint` is a 64-hex string.
24. The same sensor reading twice yields the **same** fingerprint; a changed `value` with the same
    `sensor`+`field` yields the **same** fingerprint (so a drifting number does not spam); a different
    `field` yields a **different** one. **Three assertions.**
25. A `selfModel` fixture with two `limits[]` entries, one with `fixable: null`, yields **exactly
    one** finding, and its `measurement.source` reads `selfModel.limits[].fixable`.
26. A fixture of each of the seven sensors yields a well-formed finding — **seven assertions** — and a
    fixture with **no** sensors yields `[]` with `reason: 'no sensor reported anything'`, never a
    fabricated finding.

**RESEARCH**

27. A research record with `sources: []` and `unknown: []` is **refused**: a record claiming nothing
    is unknown must carry `completenessClaimed: true`, which `weigh()` surfaces as a con.
28. With the fetcher throwing (offline), `gather()` resolves with `offline: true`,
    `sources[].status: 'unchecked'`, a non-empty `unknown[]`, and **no** remedy text containing a URL
    that requires the network.
29. Every source entry carries `retrievedAt` and a `sha256` of the bytes read; commentary carries
    `status: 'unverified claim'` and an attribution. A source lacking either is dropped and **counted**
    in `dropped`.
30. A source-shape assertion finds `require('./http.cjs')` (or the injected equivalent) as the **only**
    outbound mechanism — no `https`, `http`, `fetch`, `axios` or `node:https` in any new file (I9).
31. **Five admissions, one per spending stage, each echoing the orchestrator's `reason` verbatim**
    (review-1 finding 14): `upgrade-notice-suites` (128 MB), `upgrade-research` (64 MB),
    `upgrade-author` (64 MB), `upgrade-weigh` (64 MB) and `upgrade-verify` (512 MB, or 1024 MB when the
    plan contains a `build` step) — all `PRIORITY.BACKGROUND`. Each stage **returns without doing the
    work** when `allow: false`. A sixth assertion proves the pure-read sensors (`selfModel`,
    `metaCognition`, `rendererAudit`) are **declared exempt** in `ADMISSION_EXEMPT` rather than merely
    absent from it.

**WEIGH**

32. `costOfDoingNothing` is a required non-empty string; a weighing without it **throws**.
33. `blastRadius.files` equals the diff's change paths exactly; `blastRadius.dependents` is derived
    from `analyzeImpact` and the record states `method: 'substring scan — over-reports, never
    under-reports'`. **`analyzeImpact` returns `{file: path.join(repoPath, …)}` — absolute — so every
    dependent is normalised to a repo-relative POSIX path before entering the record, and the
    assertion checks the normalisation** (review finding 24): no `\`, no drive letter, no leading
    `/`. A machine path must not reach a persisted dossier.
34. `blastRadius.invariantsAdjacent` for a change to `electron/lib/http.cjs` includes `I9`; for
    `src/config/registry.js` includes `I7`; for `electron/resourceOrchestrator.cjs` includes `I10`.
    **Three assertions.** Every entry in the `INVARIANT_FILES` map names a path that exists on disk
    **and** is mentioned in `scripts/verifyInvariants.cjs` — so the map cannot drift from the suite.
35. `blastRadius.suiteCoverage` names the `scripts/verify*` files mentioning a changed path; with none,
    `covered: false` appears as a **con**, not a blocker.
36. `rollbackPoint` is `null` and the verdict is `needs-master-decision` when the working tree is
    dirty (mirroring `localUpdateEngine`'s refusal); with a clean tree it carries `gitHead`,
    `snapshotDir` and a per-file `sha256` **for every file the diff touches**.
37. The four verdicts are each reachable from a fixture: `propose`, `needs-master-decision`, `hold`,
    `no-action`. **Four assertions.**

**PROPOSE**

38. `propose()` produces a def that `proposals.create()` accepts unmodified, and the round-trip
    through `forStorage()` → `restore()` **preserves every dossier field** while `pending`.
39. `summarise()`'s `meta` payload for a worst-case dossier is **under 64 KB**; research bodies are
    stored as digests plus a bounded excerpt, asserted by a size test.
40. **Run with a valid allow-file fixture present** (because with none, nothing runs at all — see 40a
    and §E.2.7): with `propose-source` at its shipped `L1`, a weighing with `verdict: 'propose'` and a
    diff files a **question-kind** entry with `changes: []` and a `blockedBy: 'autonomy policy:
    propose-source is L1 (observe); L3 required'` field. **This is the behaviour once master has
    allowed autonomy, and is asserted as such.**
40a. **With NO allow-file — the shipped install — a scheduler tick reads no sensor and files nothing**
    (review finding 3). Asserted with counting fakes: `sensorsRead === 0`, `ledger.create` call count
    `0`, and the returned reason reads `'autonomy stopped: no allow-file'`. **The shipped install does
    nothing until master creates the file**, and the earlier draft asserted the opposite in criterion
    40 while §E.2.1 made it impossible.
41. **With a valid allow-file**, raising **both `propose-source` and `author-change` to `L3`** in the
    data file alone makes the same input file a diff-bearing proposal — **provided the finding carries a
    `remedy: {editId, params}` produced by a declared `ADAPTERS` entry whose `editId` is in `EDITS` and
    whose `params` satisfy that entry's preconditions** (FR-56, review-3 finding 4 — revision pass 2
    wrote *"provided a declared `EDITS` entry matches the finding's `fixable` string"*, and **no
    matching grammar existed and no rule said how parameters leave prose**). **No source change in the
    test.** (This is the unlock mechanism, exercised.) **Four assertions:** raising `propose-source`
    **alone** still files a question, reading
    `blockedBy: 'author-change is L1 (observe); L3 required'`; raising both with a finding whose
    `remedy` is **`null`** — which is what every `selfModel` finding carries, by declaration — files a
    question reading `blockedBy: 'no declared edit produces this remedy'`; raising both with a
    `remedy.editId` present in `EDITS` but `params` failing its preconditions files a question reading
    `blockedBy: '<editId> preconditions not met: <which>'`; and raising both with a **`dependencyAdvisor`
    finding carrying `{editId: 'pin-version', params: {name, version}}`** — the one adapter that
    reaches an edit today — files a diff whose `changes[0]` carries `author: 'template:pin-version'`
    and a `baseSha256`. **The fourth assertion uses the ONE really-reachable path, not a synthetic
    fixture, and that is the whole correction: a class that permits a diff is empty if nothing authors
    one, and an authoring table is empty if no sensor can address it.**
42. A new kind is registered via `proposals.registerApplier` and `proposals.cjs` is byte-identical
    before and after (sha256 compared in the test).
43. The question kind has **no registered applier**, and `proposals.apply` on one returns
    `No applier registered for kind` — **asserted, not assumed** (B.2 habit 6).
44. No IPC channel accepts an array of proposal ids: an assertion over `preload.cjs` and the new
    handler file finds no `ids`/`Array` parameter on any approve channel, and the renderer's
    "Approve selected" helper is shown to loop.

**AFTER APPLY**

45. A fixture apply that fails verification **restores every snapshotted file to its recorded prior
    state**, verified by sha256, and **both** `result` **and** `meta.verification.result` carry
    `{verified: false, reverted: true, revertAttested: true, causeId, cause, remedy}`. **A second
    fixture covers a `create`**: the file is **absent** after the revert, because its snapshot
    recorded `existed: false` (review finding 11). A third fixture proves a `create` whose path
    already exists is refused at `toProposalDef`, and a fourth that `action: 'delete'` is refused.
45a. **No renderer branch treats `status === 'applied'` as success for this kind.** A source-shape
    assertion over `Evolution.jsx` requires every `applied` branch for `self-upgrade` to read
    `meta.verification.result.verified` as well — because `proposals.apply` records `applied` whenever
    the applier resolves, and the applier resolves on a reverted apply by design (review-1 finding 6).
    **The channels the row scans are named** (review-2 finding 21): `proposals:list`, which returns
    `summarise()`, and `proposals:get`, which returns the full proposal. **And `summarise()` does not
    carry `p.result` at all** — measured: it returns `{id, kind, title, summary, status, risk,
    requiresRestart, createdAt, decidedAt, decidedBy, appliedAt, reason, changeCount, paths, meta}` —
    so a second assertion proves the list view has **no other field it could read**, which is a
    stronger reason for §E.5.2a's decision than the one originally given.
    The status vocabulary's inability to express *"applied then reverted"* is **printed as a residual**
    rather than worked around inside `proposals.cjs`, which this design does not modify.
46. A revert whose restored bytes do **not** match the recorded digest **does not report success**: it
    returns `{reverted: false, fatal: true}`, notifies master, and the ledger records it. (Section
    124's rule: refuse to report success without re-attesting.)
47. `analyse()` is **TOTAL** — `undefined`, `{}`, `{stderr: []}`, `{exit: {code: null}}`,
    `{suite: null}` and ten further shapes each yield non-empty `cause` and `remedy`, and nothing
    returns `null`. **One property assertion over a fixture array, as `verifyEngineDiagnosis` does.**
48. Each of the **thirteen** `causeId`s — `unrecognised-exit` **included**, since the branch that
    identifies nothing must still be reachable and must still carry a remedy — is reachable from a
    fixture, and `'it failed'`, `'unknown error'` and `'see logs'` appear **nowhere** in the output of
    any fixture. **Fourteen assertions: thirteen reachability, plus one forbidden-string absence.**
48a. **Every branch of `aiProcess.diagnoseFailure` maps to exactly one `causeId`, and the mapping is
    a literal table in `breakageAnalysis.cjs`** (review finding 8): the eight branches measured in
    the source map onto six engine ids, the mapping is asserted branch-by-branch against real
    `diagnoseFailure` output, and **`aiProcess.cjs` and `verifyEngineDiagnosis.cjs` are unchanged**
    (sha256-compared). §E.5.3a carries the table.
49. No `cause` or `remedy` from any fixture contains a bare URL or an IP. (Copied verbatim from
    `verifyEngineDiagnosis`.)
50. `analyse()` sets `confident: false` for `unrecognised-exit` and `true` for a cause with positive
    evidence; a caller is shown treating the two differently.
51. A second failure on the same fingerprint files a **question**, not a third fix; a third call
    within 24 h files **nothing** and reports `suppressed: 'rate'`. **Two assertions.**
52. The corrected proposal carries `meta.supersedes` equal to the failed id and
    `meta.learned.causeId`; a source-shape assertion forbids a corrected proposal being created with
    an empty `learned`.

**Addendum A**

53. Every record the schema produces carries a non-empty `userId`; a record without one is **refused**
    at construction.
54. `chatCompletion` refuses a message array containing any part classified `local-only`, **for every
    non-local destination**: `openai`, `anthropic`, `gemini`, `mistral`, `groq`, and `custom` with a
    public base URL — **six assertions** — while a **measured-local** `ollama` model
    (`modelInfo(id).cloud === false`) and `custom` with a loopback base URL pass. A seventh assertion
    adds a fake eighth provider to the switch and shows the gate **still** refuses (the gate is before
    the switch, not inside the branches). **Four further assertions, each a measured leak path the
    earlier draft would have allowed:**
    - **(8)** an Ollama id whose `modelInfo` carries `cloud: true` / `type: 'cloud-ollama'` is
      classified **cloud** and the `local-only` payload is **refused** — Ollama serves cloud models
      through the same `localhost:11434` (spec §130.9; review finding 1).
    - **(9)** an Ollama id whose `cloud` is **`null`** (unknown — no catalogue entry, no marker,
      inconclusive size) is classified **cloud** and refused. *Unknown is never folded into local;
      `ollamaCatalog.classify` already states the asymmetry and `describeInstalled` already keeps
      `type: 'unknown'` as its own state.*
    - **(10)** a **seed-only** `ollama/*` entry from `MODEL_REGISTRY` — present before any daemon
      probe, marked `type: 'local'` by declaration with no measurement — is classified **cloud** and
      refused, with a refusal naming *"classification not measured"*. A declared `local` that nobody
      measured is not a measurement.
    - **(11)** a custom provider on `https://192.168.1.50:8000` is classified **cloud** and refuses a
      `local-only` payload. **`isPrivateHost` is the wrong question for data egress** — `10.x` and
      `192.168.x` are other machines — so `destinationOf` consults a separate **`isLoopbackHost`**,
      leaving `isPrivateHost` its SSRF meaning (review-1 finding 20).
    - **(12)** **The field is `info.customProviderId`, not `info.baseUrl`** (review-2 finding 10).
      Measured: `customProviders.toRegistryEntries` sets `customProviderId: r.baseUrl` (line 220) and
      `modelRouter.customChat` reads `info.customProviderId` as the base URL (line 566). **There is no
      `baseUrl` on a registry entry**, so revision pass 1's `hostOf(info.baseUrl)` was
      `hostOf(undefined)` — safe in direction (every custom provider would have been refused) but it
      made assertion 11's loopback-versus-`192.168` contrast **unachievable**, so the suite would have
      proved nothing about the predicate. **Three assertions:** a loopback `customProviderId` passes; a
      public one refuses; **an unparsable one (`'not a url'`) is `cloud` with
      `why: 'base URL unparsable'`** — parsed inside a `try`, because `new URL()` throws and a throw
      inside the gate would become a chat failure rather than a refusal.
    - **(13)** **`isLoopbackHost`'s declared set covers every host form that can reach it**
      (review-2 finding 11): `/^127\./`, `/^0\.0\.0\.0$/`, `/^localhost$/i`, `/^\[?::1\]?$/`, operating
      on `new URL(...).hostname`. **`URL.hostname` returns an IPv6 literal BRACKETED**, so
      `http://[::1]:8000` would have classified as cloud under the earlier narrower set, as would
      `http://0.0.0.0:8000` — safe in direction again, but wrong rather than strict, and a later reader
      would have filed it as a bug. **Four assertions, one per pattern.**
54a. **`chatCompletion` is not the only outbound path carrying text, and the measured exceptions each
    call the gate — EIGHT gate call sites across SIX modules, covering TEN request sites** (review-1
    finding 2, **re-measured and corrected in revision pass 2 after review-2 finding 4 found the count
    wrong in two directions**). §E.7.4's table gives file and line for every one. **The suite asserts
    BOTH numbers and prints both**, and the counting unit — a **gate call site** — is stated in the row,
    because "four paths" was ambiguous between modules, call sites and requests and was wrong under
    every reading. **Three assertions:** the gate-call count is 8; the request-site count named in the
    table is 10; and **a planted ninth outbound request with no gate call turns the row RED.**
    *Revision pass 1 asserted `=== 4`. Measured, `codeRegenEngine.researchFix` makes three requests
    (49, 69, 87) behind one honest gate call at the top of the function, and `evolutionEngine.cjs` —
    absent from the design entirely — makes three more (220, 255, 540). An unmeasured completeness
    claim would have made the suite green on the under-count and blocked anyone who added the missing
    calls, which is the opposite of what the row is for.*
54b. **A source-shape assertion proves no module other than `contextStore.cjs` reads the `context`
    domain** — `dataStore.get('context')` appears in exactly one file. If only one module can obtain a
    classified row, the gate's coverage question becomes *"which modules call it"* rather than
    *"which modules might have a row"*.
55. Classification travels on the **record**, and a test proves a `local-only` payload is refused
    **even on a role whose `sensitive` flag is `false`** — the role-level gate is shown to be
    insufficient.
56. With the capability absent from the matrix, the recording surface renders
    `"not available — master has not added memory.record-prompts"` and **writes nothing**; a filesystem
    assertion proves no file is created anywhere.
57. With recording off, `selfModel.describe()` **still** emits the prompt-text limit — asserted
    against the existing `verifySelfModel` row so the cost of the gap stays visible.
58. `purge()` calls `cryptoCore.secureDelete`; a source-shape assertion forbids a flag-flip purge
    (`deleted: true`, `active: false` or equivalent) as the only effect.
59. The backup exclusion is asserted: the record domain is **absent** from any backup manifest the
    test constructs.
60. `evaluateCriterion(observation, criterion = CRITERION)` — **five assertions** (review finding 17):
    **(a)** `CRITERION` exists, is `Object.freeze`d, and reads
    `{windowDays: 90, minModelCallsSaved: 1, minReflexes: 1}`; **(b)** an observation whose elapsed
    window is under 90 days returns `{verdict: 'too-early'}` **whatever the counts say**; **(c)** at
    the boundary with `modelCallsSaved: 0` the verdict is `'stop-recording'`; **(d)** at the boundary
    with `modelCallsSaved: 1` it is `'continue'`; **(e)** an observation carrying no measurement
    source returns `{verdict: 'too-early', why: 'no measurement source yet'}` rather than treating an
    unmeasured number as zero. The measurement source is named in the record as
    `metaCognition.recordOutcome`.

**House rules**

61. `npm run verify` grows by the new suites, **appended never reordered** (I11), and the whole chain
    reports **0 failures**.
62. `node scripts/auditRenderer.cjs` clean: every new `window.rama.*` call resolves against
    `preload.cjs` and every Zustand destructure against its store.
63. Every new suite **prints and counts its residuals** — the gaps it does not cover — on every run.

## D.5 Out of scope

- **Any autonomous application of a source change.** Not deferred-but-planned; **forbidden**, and the
  architecture is shaped so turning it on is a visible single value rather than a redesign.
- **Tagging, publishing, version bumping, release classification** (I17 — master alone).
- **Closing I6's indirect write paths** (Section 124 #4/#6/#10: `assertChangesSafe` called only in
  `create()`; the nine unprotected build/update files; no source-integrity attestation past the seven).
  **Named here as the largest adjacent hole and explicitly not touched** — it is Section 125's declared
  next step and needs `loyaltyGuard.cjs`, which is protected.
- **Code signing and the update channel's authenticity gap** (integrity ≠ authenticity).
- **Building the tier-3 reflex synthesis itself** (Addendum A §A.5). This builds the vessel.
- **Beginning to record anything** (Addendum A §A.5) — not even behind a default-off flag a test could
  flip.
- **A path from recorded prompts to a cloud model** (Addendum A §A.4 — refused).
- **Normalised phrasing clusters** (Addendum A §A.7 — rejected, not re-proposed).
- **Editing `shared/capabilities.json`.** Entries specified in §E.13 and left for master.
- **Resolving §9.2's backup question.** Raised in §I.
- **Autonomous planning with a goal** (Section 124's R-A1) — it *creates* the persistent goal that
  Omohundro's drives need, and Section 124 blocks it behind this machinery, not alongside it.

## D.6 Assumptions, stated because the design rests on them

- **A1** Master's decision is option 1 as given in the brief: I6 and I17 intact; Rāma proposes, master
  approves in one click. Everything else follows from it.
- **A2** `userData` is writable in every install. Grounded — `selfRepair.cjs` already depends on it.
- **A3** The working tree is a git checkout and `git rev-parse HEAD` / `git status --porcelain`
  succeed. Where they do not, `rollbackPoint.gitHead` is `null` and the file snapshot is still the
  restore mechanism, so the loop degrades rather than failing.
- **A4** `node_modules` is **absent** in this workspace, so `vite build` cannot be verified here.
  Stated plainly rather than claimed. (NFR, and §H.)
- **A5** **The paste targets are verified by a METHOD, not by a claim, and the method is stated because
  the claim went stale between passes** (review-3 finding 14). **Run immediately before pasting:**
  `grep -n '^## SECTION 1\(2[6-9]\|3[0-9]\)' RAMA_AGI_MASTER_SPEC.md` and
  `grep -n '^| 1\(4[4-9]\|5[0-2]\) |' RAMA_AGI_MASTER_SPEC.md`. **Measured on `dev` during revision
  pass 3:** Sections **125, 126, 127, 130 and 129** exist (in that FILE order — **129 sits AFTER 130**,
  lines 14116 and 13973); ledger rows **144/145/146** are `done`, **147** (Section 127), **150**
  (Section 130) and **149** (Section 129) are taken, with **150 appearing before 149 in the table**.
  **So Section 128 and row 148 are free — the paste targets are right — but revision pass 2's
  supporting claim that "128 and 129 are free" and "148 and 149 are unused" is WRONG**, and a cold
  session trusting it could file over existing content. **And "numeric position" is not a convention
  this file currently keeps**, since 129 already follows 130 and 150 already precedes 149; Part F
  still asks for numeric position because it is the better habit, not because the file is tidy.
  **Section 130 was read**, and §130.11 states outright
  that *"the storage decision is being resolved inside Section 128's design"* — so Addendum B is
  Section 130, and §E.7 answers §130.6's option (a) with the assertion §130.6 demands.
- **A6** Addendum A's Section 127 is authoritative even though absent from this checkout, per its own
  instruction.
- **A7** Addendum B arrived mid-design and is folded into Part E, not deferred. Its requirements are
  **FR-39…FR-48** and acceptance criteria **64…80** in §D.7 below.

## D.7 Addendum B — context storage requirements (added mid-design)

Master, verbatim: **"Utilise DB to store context which can be understood by any model."**

- **FR-39** The context record is **model-agnostic**: nothing about a stored row may depend on which
  model wrote it or which model will read it.
- **FR-40** **EMBEDDINGS ARE AN INDEX, NOT THE RECORD.** Canonical text and structure are stored;
  vectors are a derived, rebuildable index beside them. The index is **disposable**; the record is not.
  Changing the embedding model must be a **reindex**, never a migration of meaning.
- **FR-41** A reindex is explicitly triggerable and verifiable, and the index declares which embedding
  model and dimensionality produced it.
- **FR-42** "Understood by any model" is a schema constraint: plain JSON with named fields,
  self-describing, ISO-8601 dates, explicit units, the question as asked where that is the record. **No
  model-specific tokens, no provider-shaped payloads, no opaque blob as primary content.** Testable as:
  a record dumped to text is answerable by a fresh model with no extra instructions.
- **FR-43** Provenance per row, reusing the two schemes that exist: `selfModel`'s
  `{value, source, measured}` for the measured case and `claimGate.CLASS`
  (`grounded`/`reflex`/`prose`/`unattributed`) for the derived case. **No parallel provenance scheme.**
- **FR-44** **I14 must stay true.** A context store outside `dataStore.cjs` would not be re-keyed by
  `sessionManager.changePasscode`, making I14 quietly false. The chosen option must be stated, and an
  assertion must fail if a context store exists outside the re-key path.
- **FR-45** **No new dependency**, and specifically no native-compiled one: Section 124 measured that
  an offline rebuild is impossible today (750 lockfile entries, zero vendored tarballs) and a native
  dependency makes that worse. I12 requires a stated reason for any addition; the stated reason here is
  that there is none.
- **FR-46** **One authority owns bytes on disk.** The context store must not become a second store
  authority competing with `dataStore` (the I8/I9/I10 pattern). Encryption at rest is the existing
  AES-256-GCM path, not a second scheme.
- **FR-47** Section 127's four guarantees are **schema requirements on this DB**: `userId` per row;
  classification on the record, enforced on the payload at the cloud boundary; retention cap with a
  purge that really deletes; excluded from backup unless master says otherwise.
- **FR-48** **A join is the new leak path.** A DB makes guarantee 2 harder because a join can assemble
  a context payload no single row looks sensitive enough to block. The chokepoint where an outbound
  payload is assembled must be named, and a classified row must be unable to pass it **even when it
  arrives via a join**.

**Acceptance criteria 64–80**

64. `dataStore.DOMAINS` contains `'context'`; a test asserts `markAllDirty()` returns
    `DOMAINS.length` and that the returned count **includes** the context domain, so the re-key covers
    it by construction.
65. A source-shape assertion over the whole tree finds **no second persistence mechanism**: no
    `sqlite`, `better-sqlite3`, `nedb`, `lowdb`, `level`, `pouchdb`, `mongodb`, `.db` file open, and no
    `fs.writeFile*` targeting the data dir outside `cryptoCore.encryptToFile`. **The row that proves
    FR-44 — planted: adding a fake `contextDb.cjs` that writes its own file makes it go RED.**
66. `package.json`'s dependency count and `package-lock.json`'s entry count are **unchanged** by this
    work (asserted numerically), and every version remains pinned with no `^`/`~` (I12, already
    asserted by `verifyInvariants`).
67. A context row is refused at construction unless it carries all of: `id`, `userId`, `at` (ISO-8601),
    `kind`, `text` or `fields`, `provenance.source`, `provenance.measured`, `classification`,
    `retainUntil`. **Nine assertions, one per required field.**
68. `provenance.measured === false` requires a `provenance.claimClass` drawn from
    `claimGate.CLASS`; any other value is refused. A test proves the value is **read from
    `claimGate.CLASS`**, not restated — monkey-patching the export changes what is accepted.
69. `toPlainText(row)` output contains no `<|`, no `[INST]`, no `<s>`, no `###` role marker, no
    provider field name (`choices`, `message.content`, `candidates`, `completion`), and every date in
    it matches an ISO-8601 regex. **Five assertions.**
70. A round-trip `row → toPlainText → parsePlainText` preserves every field, so the canonical form is
    lossless and the "answerable by a fresh model" claim is about a real artefact.
71. The index record carries `{embeddingModel, dims, builtAt, rowCount, recordDigest}`; a query against
    an index whose `embeddingModel` differs from the current one returns
    `{stale: true, reason}` and **falls back to keyword search** rather than returning scored results.
72. `reindex()` rebuilds from the canonical rows alone — a source-shape assertion proves it reads the
    record domain and **never** another index — and afterwards `recordDigest` matches a fresh digest of
    the rows.
73. Deleting the entire index and calling `reindex()` restores query results identical to before
    **(the disposability claim, asserted rather than asserted-in-prose)**.
74. **The dimension-mismatch defect found in `vectorMemory.cjs` during this inventory is fixed and
    asserted:** `embed()` returns whatever length Ollama's `nomic-embed-text` responds with, while
    `tfidfVector(text, dims = 256)` returns **256 by an explicit parameter default**, and `cosineSim`
    returns `0` on a length mismatch — so a single index containing both silently scores every
    cross-source pair at zero. **The verifiable fact is the mismatch and the silent `0`, not a specific
    dimensionality**: the code never states the Ollama length, which is exactly why it must be measured
    at runtime rather than assumed. The index record's `dims` must be enforced on insert, and a vector
    of the wrong length is **refused, not stored**. **Five assertions** (extended per review finding
    18): a mismatched insert is refused; a mixed-dims index is reported `stale` rather than queried;
    **`embed`, `tfidfVector` and `cosineSim` are EXPORTED** — today
    `module.exports = {register, store, search, isDuplicate, getHealth}`, so not one of them was
    reachable from a suite; **`embed()` returns `{vector, source, dims}`** while `store`/`search`/
    `isDuplicate`/`getHealth` keep their existing signatures unchanged (I11 — nothing removed); and a
    **mixed-legacy-index fixture** (entries of two different lengths already stored) is reported by
    `getHealth()` with a `mixedDims` count and marked `stale`, because **refusing new wrong-length
    inserts does not repair vectors already on disk** and the honest move is to count them rather than
    report a clean index. **Ownership is declared: `contextStore` owns the context index and uses
    `vectorMemory.embed` as a pure embedder; `vectorMemory` keeps its own index for its own callers.**
    Two stores, one embedder, no shared index — asserted by the source-shape row in criterion 72.
75. **With recording off (the shipped state) the context domain DECRYPTS to
    `{rows: [], index: null, recording: false}`. Three assertions: `rows.length === 0`;
    `index === null`; and a filesystem assertion proves no context ROW PAYLOAD exists anywhere.**
    **The domain FILE is present, and that is correct, not a leak** (review-3 finding 8): measured,
    `dataStore.markAllDirty()` instantiates `getDefaultData(domain)` for every domain and `saveAll()`
    writes one encrypted file per dirty domain (`electron/dataStore.cjs` 305–311, 78–79), so **adding
    `'context'` to `DOMAINS` — which criterion 64 requires and which is the entire I14 argument of
    §E.7.1 — GUARANTEES a context domain file on disk.** Revision pass 2's wording, *"a filesystem
    check proves no context bytes exist anywhere"*, is therefore **red on a correct implementation**,
    and a coder would have resolved the contradiction by removing the domain from `DOMAINS` — losing
    the re-key coverage this design calls its deciding finding. **The claim that matters is that no
    ROW ever exists**, and that is what is asserted.
76. `assembleContext()` — the join — refuses to emit any row whose `classification` is `local-only`
    when its `destination` argument is non-local, and the refusal is **counted and reported**
    (`withheld: n`), never silent. Two assertions.
77. `chatCompletion` refuses a payload carrying an assembled context block containing a `local-only`
    row, for all six non-local providers **and** for a joined payload where no individual row was
    passed directly. **Seven assertions** — this is FR-48's row.
77a. **The gate answers with the store unavailable** (FR-58, review-3 finding 9), in criterion 16's
    shape. **Three assertions:** `classificationGate.cjs` requires **no** `dataStore`, no `cryptoCore`
    and no `electron` at module scope; `chatCompletion` answers normally **with the context store
    locked**; and it answers normally **with `dataStore` unresolvable** (the require made to throw).
    *Revision pass 2 put `gateOutbound` inside `contextStore.cjs`, which criterion 54b requires to be
    the only holder of `dataStore.get('context')` — so the chat chokepoint acquired a store-bound
    dependency and the design never said what happens when the vault is locked or the store loads
    late. The design makes the opposite argument for `autonomyStop`: "a stop that can fail to load is
    not a stop."* `contextStore` re-exports `gateOutbound`, so every call site in §E.7.4 reads
    unchanged.
78. `purge(userId)` removes rows, **destroys the index**, and calls `cryptoCore.secureDelete` on the
    domain file; a source-shape assertion forbids a flag-flip-only purge.
79. `retentionSweep(now)` drops every row whose `retainUntil < now` and reports the count; a row with
    no `retainUntil` is impossible by criterion 67, so the sweep has no unbounded case.
80. The context domain is **absent** from any backup manifest the test constructs (FR-35/FR-47), and a
    test adding it makes the row go RED.

**Acceptance criteria 81–88 — added in the revision pass**

*Numbered after 80 rather than renumbered, so a review finding and the row that answers it stay
traceable. Lettered rows (4a, 4b, 19a, 22a, 40a, 45a, 48a, 54a, 54b) sit beside the row they extend.*

81. **The snapshot directory is bounded and swept** (review-1 finding 13): after an apply that passes
    its plan with `verified: true`, the **derived** snapshot directory is **deleted** and a filesystem
    assertion proves it is gone. **Eviction runs after every apply and the rule is FR-52's, which is a
    rule rather than a phrase** (review-2 finding 15 — *"the lesser of 20 entries or 30 days"* is not a
    comparison): a directory is evicted when **either** bound is exceeded. **Four fixtures:** 25
    non-`fatal` entries evicts 5; **5 entries one of which is 31 days old evicts exactly 1**; **21
    entries whose oldest is `fatal` evicts 1 and the `fatal` one survives**; and a `fatal`-only fixture
    evicts 0. The eviction count is **reported**, and `statusText()` and the Autonomy panel report
    snapshot **count and total bytes**. *The earlier single fixture exercised only the count, so the
    suite would have passed under either reading of the phrase and the age bound was untested.*
82. **The verification plan is re-derived at apply time and the persisted plan is display-only**
    (review-1 finding 15). Asserted with a **poisoned** persisted plan — `meta.verification.plan`
    rewritten to `[{step: 'suite', target: '../../evil.cjs'}]` on a `pending` entry, which
    `proposals.restore()` rehydrates with only an id check — and the apply **runs the re-derived plan
    and never the poisoned one**, proven by a spawn-counting fake. A second assertion rejects
    `target: 'verify;rm -rf.cjs'` against the validation row in §E.9.
82a. **A poisoned `rollbackPoint.dir` causes no write outside the derived snapshot directory**
    (review-2 finding 2, in the shape of 82). A `pending` entry whose persisted
    `meta.weighing.blastRadius.rollbackPoint.dir` is rewritten to `<userData>/rama/` — the directory
    the STOP's allow-file lives in — is applied, and a **write-counting fake proves every write target
    is either the derived `path.join(userDataRoot, 'rama', 'upgrade-snapshots', proposal.id)` or a
    validated `changes[].path`.** **Four assertions:** the poisoned dir is never written to; a
    malformed `proposal.id` (`'../../x'`) is refused before any derivation; a
    `rollbackPoint.files[].path` that is **not** a subset of `changes[].path` is refused; and
    **`<userData>/rama/autonomy.allow` still exists, byte-identical, after the apply** — the assertion
    that states the actual guarantee rather than a proxy for it.
82b. **`suiteCoverage` is RECOMPUTED at apply time, not read from `meta`** (review-2 finding 12).
    §E.5.2's rule is that the executed plan is re-derived — but a `suite` step "for every suite
    `suiteCoverage` named" could only come from persisted `meta`, which is the untrusted input the
    re-derivation exists to avoid. **Three assertions:** a persisted `suiteCoverage` naming
    `verifyEvil.cjs` is **ignored**; the **recomputed** list (a scan of `scripts/verify*.cjs` for a
    changed path or basename, over the re-derived change set) is what runs; and
    `meta.verification.planDrift` is **`true`** because the two differ. *Without this the plan either
    silently dropped change-specific suites — verifying a change without the suite written for it — or
    re-read `meta`, re-opening review-1 finding 15 through a different field.*
83. **Every verification step is launched with `execFile` and `shell: false`**, asserted by a
    source-shape scan: no `exec(`, no `spawn(` with `shell: true`, no template-string command
    assembly anywhere in `upgradeApplier.cjs`. **Extended in revision pass 3 (finding 13), because
    FR-1's declared exception for the spawned writes has to be paid for by an assertion rather than a
    sentence. Four further assertions:** the `cwd` of every spawned step **equals the repo root** and
    is not read from `meta` or `opts`; **every `execFile` argument derives from the RE-DERIVED change
    set** or from the frozen step vocabulary (`node --check` · `suite` · `audit` · `build`), proven by
    a launch-recording fake that compares each argument against the re-derived set; **no element of
    `env` is taken from the record**; and the declared write targets — `vite build` → `dist/`, suites →
    their own temp directories — are **printed in the residual list** so the exception is visible on
    every run rather than buried in FR-1.
83a. **`opts` is a two-key allow-list and the applier reads nothing else from it** (FR-54, review-3
    finding 6). **Four assertions:** a source-shape scan over `upgradeApplier.cjs` finds **no `opts`
    member read other than `opts.user`** — `opts.autonomous` is **written into `meta.autonomy`** and
    never read in a conditional, asserted by the scan plus a value check; an apply carrying
    `opts.snapshotDir`, `opts.plan`, `opts.repoRoot`, `opts.force` and `opts.timeoutMs` **ignores all
    five** (a write-counting fake proves the destination is still the derived directory and a
    launch-recording fake proves the plan is still the re-derived one); unrecognised keys are
    **ignored rather than rejected**, because `proposals.cjs` may add one and this design does not get
    a veto over a protected file; and **`meta.autonomy` carries the recorded flag afterwards**, so the
    audit keeps the datum the gate refuses to trust. *Measured: `opts` reaches the applier whole
    (`preload.cjs` 680 → `proposals.cjs` 272 → `applier(p, opts)` at 235), and revision pass 2's §E.9
    validated the proposal in six ways and had no row for `opts` at all.*
84. **A policy-file change with no ledger record is visible, not silent** (review finding 19):
    `load()` records `fileSha256`; `policyStatus()` returns
    `{fileSha256, ledgerAttested, attestedBy, attestedAt}`; an **unattested** digest warns **once per
    load** and the Autonomy panel reads *"policy file changed <when> — no ledger record"*. Master
    records an advancement with **one tier-0 call that writes a question-kind ledger entry carrying
    the digest**, after which `ledgerAttested` is `true`. **Three assertions: unattested warns once;
    attested is quiet; a digest that no longer matches the file reverts to unattested.** This is
    R-G2's gate — *master-only advancement, recorded in the ledger (I17's shape)* — which a hand edit
    to a JSON file does not by itself satisfy.
85. **The two new kinds are exported constants, not scattered literals** (review finding 26):
    `upgradeProposer.KIND` is frozen and reads `{DIFF: 'self-upgrade', QUESTION: 'self-upgrade-question'}`.
    A source-shape assertion finds the string `'self-upgrade'` **nowhere** in `Evolution.jsx` or the
    IPC handler except through `KIND`, and asserts `stats().byKind` reports both **without** any entry
    in `proposals.KINDS` — which stays untouched, because `proposals.cjs` is a protected file.
86. **`ADMISSION` and `GATED` cannot drift from the stages they describe**: every key in `ADMISSION`
    names a function in `GATED` or appears in its printed `exempt` list, and the suite fails if a new
    stage entry point exists in neither.
87. **`SELF_GOVERNING_PATHS` members exist on disk** — or, for `shared/autonomy-policy.json` which
    ships absent, are declared `optional: true` in the constant. A path that is neither present nor
    declared optional fails the row, the way `verifyBadgeLabel` checks that every timer it names is
    real.
88. **`node --check` passes on every new and changed `.cjs`, and `scripts/auditRenderer.cjs` is clean**
    — stated as a criterion because it is the one part of the verification bar this workspace can
    actually run (`node_modules` is absent, so `vite build` cannot — §H.2).

**Acceptance criteria 89–95 — added in revision pass 2**

89. **The author is template-only, and that is mechanically enforced** (FR-49, review-2 finding 1).
    **Six assertions:** `EDITS` is `Object.freeze`d and every entry carries all of
    `{editId, matches, appliesTo, transform, preconditions, verifiableBy}`; `AUTHORING_MODES` is
    `Object.freeze(['template'])`; **`author()` refuses an `authoringMode` of `'model'`** naming the
    constant that would have to change; every produced `changes[].author` matches
    `/^template:[a-z0-9-]+$/`; **every produced `changes[].content` is derivable from the bytes
    `author()` read** — asserted by re-running the transform over the same input and comparing
    digests, which is what *"nothing invented by a model"* means for a change body; and **a
    source-shape assertion finds no `chatCompletion`, no `modelRouter` require and no
    `codeRegenEngine.generateFix` reference anywhere in `upgradeAuthor.cjs`.**
90. **Each declared edit is exercised, and each refuses outside its preconditions.** **Two assertions
    per `EDITS` entry** — one producing the expected content from a fixture file, one proving the
    precondition refusal (`add-export` on a file with two `module.exports` literals, or a name already
    exported; `pin-version` on a name in `dependencyAdvisor.SENSITIVE`, which is **read from the
    export**; `add-array-member` on a duplicate member; `replace-literal` on zero or more than one
    occurrence). **A refusal yields `{changes: [], why}` and never a partial edit.**
90a. **WHICH SENSORS CAN ACTUALLY REACH AN EDIT IS A MEASURED, PRINTED NUMBER — not a hope**
    (FR-56, review-3 finding 4). The suite **prints, for each of the seven sensors, the `editId`s its
    `ADAPTERS` entry can produce, and prints the count of sensors with none.** **Eleven assertions:
    one per sensor asserting its declared reachable set** — `selfModel.limits → []` **by declaration**,
    because all seven of its `fixable` strings are human prose (`selfModel.cjs` 206–266) and none is in
    a shape any transform could consume; `astEngine → []`; `suite → []`; `metaCognition → []`;
    `engineDiagnosis → []`; `rendererAudit → []`; **`dependencyAdvisor → ['pin-version']`** — plus
    **three assertions on the other side of the table**: `add-export`, `add-array-member` and
    `replace-literal` each carry `producedBy: []` today and the suite prints them as **declared but
    unreachable**, and **a fourth asserts the printed line reads `sensors with no reachable edit: 6 of
    7`.** **So "most findings file a question" stops being a prediction and becomes a number**, and the
    honest consequence is stated where a reader will meet it: **today the loop can author exactly one
    kind of change — a dependency version pin — and every other finding produces a question with a
    researched remedy in words.** *This is the row that makes §I.9's question answerable: the cost of
    template-only authoring is not "fewer patches", it is "one editId".*
91. **`baseSha256` drift is caught at apply time, not at author time.** A proposal whose target file
    has changed on disk since authoring is **refused by the applier** with
    `causeId: 'base-drift'`, the ledger records `failed`, and **nothing is written** (counting fake).
    **Three assertions**, including that the message names the file and both digests — because *"the
    file changed"* without saying which is the `'it failed'` of this design.
92. **`gateOutbound`'s declared contract holds, including its default** (FR-33b, review-2 finding 14).
    **Six assertions:** a bare-string array passes for **every** provider; an array of
    `{text}` parts with no `classification` passes; an array containing one
    `{text, classification: 'local-only'}` part is **refused** for a cloud destination and **passes**
    for a local one; a `{contextBlock, classification: 'local-only'}` part — the shape
    `assembleContext` returns, **inserted into `messages` by the caller carrying the block's tag**,
    which is what makes criterion 77's joined case reachable — is refused; `destination: undefined`
    **throws** (§E.9: no default, because a default would decide the leak question by omission); and
    the refusal object carries `{error, classification, why, evidence}` with the **classification and
    never the content**.
93. **A research query carries the finding's `what` and a field NAME, and nothing else of Rāma's**
    (FR-51, review-2 finding 13). **Four assertions over a finding whose `measurement.value` is
    `'Error: cannot find module ./loyaltyGuard.cjs at line 64'`:** the query string contains the
    `what`; it contains the sensor's field name; it contains **neither** `measurement.value`, **nor**
    any `stderr`/`stdout` excerpt, **nor** any file content read in the same run; and
    `gateOutbound(queryParts, 'cloud')` is called **before the first `fetchText`** (source-shape, with
    the line order asserted).
94. **The path master actually takes to raise a class is exercised end to end** (review-2 finding 16).
    **Four assertions:** editing `shared/autonomy-policy.json` by hand and calling `policy.reload()`
    changes `effective()` **with no restart and no build** — asserted explicitly, because
    `localUpdateEngine.classifyChange` returns **`'renderer'`** for anything under `shared/` and a
    later session reading that would believe a `vite build` was required, when the file is read by the
    **main** process and is not bundled; the tier-0 attest call then files a **question-kind** entry
    carrying `fileSha256`; `policyStatus().ledgerAttested` becomes `true`; and **a proposal naming that
    file is still refused outright** (refusal 5) — so the hand edit is not a workaround for a refusal,
    it is the designed route.
95. **The class table's arithmetic is asserted, not described.** `CLASSES.length === 15`;
    `PERMANENT.size === 6`; the count of classes with `floor === ceiling` is **11**; the count with
    `floor < ceiling` is **4** and they are exactly `propose-source`, `dependency-change`,
    `build-repair`, `author-change`. **Four assertions, and they exist because Part G's prose
    disagreed with §E.1.2's prose in a block destined for the spec verbatim** (review-2 finding 17) —
    a count in two places is a count that drifts, so the suite owns it and both prose blocks quote the
    suite's numbers.

**Acceptance criterion 96 — added in revision pass 3**

96. **The file counts are asserted, the way criterion 95 asserts the class table** (review-3 finding
    16). **Three assertions:** `git diff --name-only` over this work lists **nineteen** changed files
    and **eleven** new ones; **twelve** of the nineteen are the stop-and-gate edits and the suite
    **names all twelve** — `refreshScheduler`, `metaCognition`, `selfCare`, `marketIntel`,
    `agentOrchestrator`, `sandboxEngine`, `customProviders`, `voiceEngine`, `browserEngine`,
    `codeRegenEngine`, `intelligenceEngine`, `evolutionEngine` — with the other seven named as outside
    that count (`modelRouter`, `vectorMemory`, `dataStore`, `main.cjs`, `preload.cjs`, `registry.js`,
    `Evolution.jsx`); and **both numbers are printed.** *§E.0 said "twelve small additive edits to
    existing modules" while §E.0.1 listed nineteen changed files — a count in two places is a count
    that drifts, and this one already had.*

## D.8 Where this sits in the roadmap, and the ordering rule it has to answer to

*Added in the revision pass (review finding 21). A cold session must be able to tell whether the
phased ordering was respected or stepped over.*

`docs/research/RAMA_MODEL_EVALUATION.md` §10 is the phased roadmap, and **this design touches
THREE of its rows — 1.4, 4.1, and the Phase-3 pair 3.1/3.3, which revision pass 2 did not list at
all** (review-3 finding 12; claiming two while shipping a context store that sits on a third is the
kind of under-count this document keeps catching in itself):

| Roadmap row | Item | Phase | What this design does |
|---|---|---|---|
| **1.4** | **R-L4** — one honest stop, tray-reachable, fail-safe off, file in `PROTECTED_FILES`; **kills agents and sandbox children through the existing paths**; gate tier-0 `system.suspend-autonomy` | **Phase 1** (*"Loyalty, asserted — the prerequisite for everything after"*) | §E.2 implements **the flag, the tray route, the fail-safe direction, FOUR dispatch points, the agent and sandbox-child teardown, and one declared printed exemption** — i.e. all of R-L4 **except the `PROTECTED_FILES` entry**, which needs a protected file edited and is raised in §I.2. Phase 1 is gated behind nothing, so this part is in order. **Revision pass 1's claim of "in full except the `PROTECTED_FILES` entry" was overstated in two ways and is corrected here** (review-2 finding 7): it named two dispatch points when four state-changing timers exist (`selfCare` 396 — which calls `checkInstanceFailover` — and `marketIntel` 784–785 were unhalted *and* undeclared), and it omitted R-L4's requirement to kill agents and sandbox children. Both halves are now designed; **neither has been run (§H.17).** |
| **4.1** | **R-G2** — declare RL-0…RL-4 with per-rung safeguards; undetermined ⇒ lower rung; **gate: master-only advancement recorded in the ledger (I17's shape)**; the rung read from a declared constant, never inferred | **Phase 4** (*"only after phases 0–3"*) | §E.1 **declares the ladder and climbs no rung.** Criterion 84 implements the gate's ledger half, which a hand edit to a JSON file does not satisfy by itself. |
| **3.1** and **3.3** | **R-M1** — one durable memory authority with provenance and decay, gate tier-0 `memory.write-durable`; **R-A4** — reflex synthesis as a `SELF_MODIFY` proposal, gate tier-0 `memory.record-prompts` **default off** and **"requires §9.4"** | **Phase 3** | **ADDED IN REVISION PASS 3 (finding 12), because §E.7 sits on these two rows and revision pass 2's table claimed the design touched exactly two rows — both of which were 1.4 and 4.1.** Measured against `RAMA_MODEL_EVALUATION.md` §10 lines 1359 and 1361, **§E.7 ships a context record schema, an index, `reindex`, retention, purge, the join and the egress gate — which is 3.1's territory and 3.3's precondition.** **What this design does with them: it builds the VESSEL ONLY.** `recording: false` (§E.7.6); **`memory.record-prompts` is NOT added to `shared/capabilities.json`** (§E.13 specifies it and leaves it to master); **no row is ever written** (criterion 75); `selfModel` keeps reporting the gap (criterion 57). **No capability is added, because the key does not exist** — and `capability.can()` returns `false` for an unknown capability for every tier including master, so the gate on 3.3 is satisfied by absence rather than by a default-off flag a test could flip. **§9.4's precondition for 3.3 — the privacy cost of recording request text — is NOT claimed met; it is raised** (§I.3, §I.7). **And the subtractive argument below does NOT cover these two rows**, which is why they get their own: a schema plus an index plus a purge is not subtractive, it is new machinery that happens to be switched off. The ordering claim for them is narrower and is stated as such: **a vessel that records nothing adds no capability, and §I.7 asks master to confirm that reading rather than leaving a subagent to assert it.** |

**The ordering question, stated rather than finessed.** §10's Phase 4 is gated *"only after phases 0–3"*,
and phase 2/3 rows are open: **2.1** source-integrity manifest, **2.2** byte-level backup, **2.3**
offline rebuild, **3.1** durable memory authority, **3.6** running the Python engine. **The exemption
argued here is narrow: row 4.1 is a DECLARATION, and what it declares is strictly subtractive.** Before
this design, every self-modifying path's answer to *"may Rāma do this by itself?"* was whatever its call
site happened to implement; after it, every such path refuses unless a frozen constant permits it, and
no class ships above `propose-only`. **Declaring the ladder removes capability; climbing a rung adds it,
and no rung is climbed here** — which is why §E.1.5's shipped default keeps Section 124's Level-2
measurement true, and criterion 40a proves the shipped install does nothing at all.

**Row 4.2 (R-A1/R-A2, bounded planning) is out of scope and stays blocked.** §10 blocks it on
1.1/1.3/1.4, and 1.4 is only *partly* satisfied here because the `PROTECTED_FILES` entry is master's to
make. It is also the row Section 124 blocks *behind* this machinery rather than alongside it, because
bounded planning is what creates the persistent goal Omohundro's drives need. **§I.7 asks master to
confirm this exemption argument** rather than leaving it asserted by a subagent.

---

# PART E — DESIGN

## E.0 Overview, and the one shape that holds it together

**Eleven new modules** — ten plus `classificationGate.cjs`, which revision pass 3 split out of
`contextStore` so the chat chokepoint's gate carries no store dependency (FR-58) — one new JSON data
file (**which ships absent — master creates it, §E.2.7**), three new
suites, two new `PAGES` entries, one line added to `dataStore.cjs`'s `DOMAINS`, one new scheduler task,
and **NINETEEN changed files, TWELVE of them the stop-and-gate edits** — the twelve being
`refreshScheduler`, `metaCognition`, `selfCare`, `marketIntel`, `agentOrchestrator`, `sandboxEngine`,
`customProviders`, `voiceEngine`, `browserEngine`, `codeRegenEngine`, `intelligenceEngine` and
`evolutionEngine`; the other seven — `modelRouter`, `vectorMemory`, `dataStore`, `main.cjs`,
`preload.cjs`, `registry.js`, `Evolution.jsx` — are **outside that count**. *Revision pass 2 said
"twelve small additive edits to existing modules" here while §E.0.1 listed nineteen changed files
(review-3 finding 16); **criterion 96 asserts and prints both numbers**, because a count in two places
is a count that drifts and this one already had.* All of them are listed in §E.0.1 with their
reason. The list grew twice under review, and both times because a claim had been made that the code
could not keep: revision pass 1 added `refreshScheduler`, `metaCognition` and `customProviders` (relied
on without being declared) plus four engines (once the outbound-text claim was measured); **revision
pass 2 added `evolutionEngine` — a fifth outbound text path the design had missed entirely — and
`selfCare`, `marketIntel` and `agentOrchestrator`, once "the STOP halts the existing timed work" was
measured against the timers that actually exist.** **Nothing else changes.**
`proposals.cjs` is the spine and is not touched; the seven protected files are not touched;
`shared/capabilities.json` is not touched; `aiProcess.cjs` and `verifyEngineDiagnosis.cjs` are not
touched (§E.5.3a).

The shape: **a policy table decides whether a stage may run at all, a STOP overrides the table, six
stage modules each do one thing and hand a growing dossier to the next, and the dossier lands in
`proposals.cjs` as one ledger entry's `meta`.** **Six, not five** — the five named stages of the brief
plus **AUTHOR (§E.4.2a), which produces the diff WEIGH weighs**; revision pass 1 had no module for it
and the loop proposed a patch nothing wrote (review-2 finding 1). Every stage is a pure function with its sensors,
clock, fetcher, store and git reader injected, so all of it tests under plain `node`.

**Technology stack — locked once this design is approved.** Node 20 CommonJS (`.cjs`) in the Electron
main process, matching every module in `electron/lib/`. React 18 + Zustand for the two renderer
surfaces, matching the rest of `src/pages/`. Plain JSON for declared data, matching
`shared/capabilities.json` and `shared/loyalty-tripwire.json`. `node:crypto` for digests,
`node:fs`/`node:path` for files, `child_process.execFile` for `git`, `lib/http.cjs` for every outbound
byte (I9), `resourceOrchestrator.admit` for every admission (I10), the existing encrypted `dataStore`
for every persisted byte. **Zero new dependencies** — asserted numerically by criterion 66. Suites are
plain `node` scripts in `scripts/`, in the house `check(label, ok, detail)` style with a `pass/fail`
tally and `process.exit(fail ? 1 : 0)`.

**Why no new dependency, stated rather than assumed.** The candidates for "a DB" all cost something
this project has already measured: `better-sqlite3` and `sqlite3` are native and need
`electron-rebuild` per platform, which deepens the offline-rebuild hole Section 124 found (750
lockfile entries, zero vendored tarballs, `npm ci --offline` impossible today); `lowdb`/`nedb` are
pure JS but are a **second store authority** writing their own plaintext files outside
`cryptoCore`, which breaks both I14 and the AES-256-GCM-at-rest guarantee; a server-backed DB adds a
process that must be running for the record to work, which is the argument `proposals.cjs`'s own
Section 58 comments already made and won. **`dataStore` is the DB.** §E.7 argues this properly.

### E.0.1 Files

| Path | New/changed | Purpose |
|---|---|---|
| `electron/lib/autonomyPolicy.cjs` | **new** | The policy table: frozen classes/floors/ceilings/permanent in code, levels in data, `effective()`, `require()`, `policyStatus()`. |
| `shared/autonomy-policy.json` | **new — and it SHIPS ABSENT** | The only editable half: `{version, levels}`. **Not created by this work.** The floors in §E.1.2 are therefore the shipped levels, which is why the "ships at" column is gone (review-2 finding 5): with no file there is no shipped value distinct from the floor, and printing one that no install has is how a table lies. Master creates it only when he wants to restrict or raise something — §E.1.4 gives the exact sequence, and §E.2.7 confirms he needs **one** file (the allow-file), not two. |
| `electron/lib/autonomyStop.cjs` | **new** | The STOP. **`isStopped()`** (the six new chokepoints; fail-safe, absent ⇒ stopped), **`isHalted()`** (the four pre-existing dispatchers; `true` only on an explicit engage — FR-12, review-3 finding 3), `engage(reason, by)` **which writes the stopped-record before deleting the allow-file** (FR-16a), `lift(user, note)`, `statusText()` **which enumerates both sets by name in both states**. Dependency-free, synchronous. |
| `electron/lib/upgradeNotice.cjs` | **new** | Stage 1. `collect(sensors)` → `Finding[]`, `notice(def)` refusing a finding with no measurement. **Also owns the frozen `ADAPTERS` table that turns a sensor reading into `finding.remedy = {editId, params} \| null`** (FR-56, review-3 finding 4) — structured, never parsed out of a prose `fixable` string. |
| `electron/lib/upgradeResearch.cjs` | **new** | Stage 2. `gather(finding, io)` → `ResearchRecord`. **Also an outbound text path, so it calls `gateOutbound` itself** (§E.4.2, FR-51). |
| `electron/lib/upgradeAuthor.cjs` | **new** | **Stage 3a — THE PRODUCER OF THE DIFF, which revision pass 1 had no module for** (FR-49, review-2 finding 1). `author(finding, research, io)` → `{changes[], author, editId, why}`. A frozen `EDITS` table of mechanical transforms over bytes read from disk; `AUTHORING_MODES = ['template']`; no model, no `chatCompletion`, no `modelRouter` require. |
| `electron/lib/upgradeWeigh.cjs` | **new** | Stage 3. `weigh(finding, research, changes, io)` → `Weighing` with computed blast radius. **`changes` now comes from `upgradeAuthor`, not from an injected `diff` nothing produced.** |
| `electron/lib/upgradeProposer.cjs` | **new** | Stage 4. `toProposalDef(...)`, `file(...)`; registers appliers. |
| `electron/lib/upgradeApplier.cjs` | **new** | Stage 5a. **`register(ledger, io)`** closes over `io` and registers `(proposal, opts) => applyWith(io, proposal, opts)`; **`applyWith(io, proposal, opts)` is exported for the suite** (FR-57, review-3 finding 5 — the ledger calls `applier(p, opts)` with **two** arguments, so an injected third parameter could never have been reached). It validates entry (§E.5.0) → snapshots into a **derived** directory → writes → verifies a **re-derived** plan → reverts on failure. **It is the chokepoint for the kind, because the proposer is only a caller** (FR-50). |
| `electron/lib/breakageAnalysis.cjs` | **new** | Stage 5b. `analyse(evidence)` → named cause. Pure, total. |
| `electron/lib/contextStore.cjs` | **new** | Addendum B. The record schema, `toPlainText`, the index, `reindex`, `assembleContext`, `purge`, `retentionSweep`, `evaluateCriterion`. **It re-exports `gateOutbound` and the classification constants from `classificationGate.cjs`**, so every call site in §E.7.4 reads unchanged while the predicate itself carries no store dependency (FR-58). |
| `electron/lib/classificationGate.cjs` | **new — added in revision pass 3** | **`gateOutbound` and the classification constants, dependency-free: no `dataStore`, no `cryptoCore`, no `electron`** (FR-58, review-3 finding 9). Revision pass 2 put the gate inside `contextStore.cjs`, which criterion 54b requires to be the **only** holder of `dataStore.get('context')` — so the one chokepoint above `chatCompletion`'s switch became store-bound, and the design never said what it does when the vault is locked or the store loads late. **The design makes the opposite argument for `autonomyStop` — *"a stop that can fail to load is not a stop"* — and a gate that throws because the vault is locked is a chat failure, not a refusal.** Criterion 77a. |
| `electron/dataStore.cjs` | **changed, 2 lines** | `'context'` added to `DOMAINS`; a `context` entry in `getDefaultData`. |
| `electron/ipc/modelRouter.cjs` | **changed, ~25 lines** | The payload gate **above** `chatCompletion`'s switch, plus `destinationOf(info)` — per-model classification from `modelInfo`'s measured `cloud` field, `isLoopbackHost` for `custom`, and **`cloud: null` or a seed-only entry resolving to `cloud`** (§E.7.4). |
| `electron/ipc/vectorMemory.cjs` | **changed** | The dims defect (criterion 74): `embed()` reports `dims`, callers enforce it. |
| `electron/main.cjs` | **changed** | One scheduler task; tray item; `upgradeApplier.register()`; the new IPC namespace. |
| `electron/preload.cjs` | **changed** | `window.rama.selfUpgrade.*`, `window.rama.autonomy.*`. |
| `src/config/registry.js` | **changed** | Two `PAGES` entries (I7). |
| `src/pages/Evolution/Evolution.jsx` | **changed** | Dossier rendering + "Approve selected" looping over single approvals. |
| `electron/lib/refreshScheduler.cjs` | **changed, ~6 lines** | **The STOP's halt of existing timed work** (review-1 finding 7). An **`isHalted()`** check **inside `runNow` before `await task.run()`** (line 133) — the single dispatcher every scheduled task passes through — plus a `stopExempt` flag on `register()` that nothing in this design sets. A wrapper on the loop's own task could not halt `ollama-catalog` or `dependency-review` (registered at `main.cjs` 552 and 566); this can. **And `engage()` calls the module's existing `stop()` (line 220, already exported) as well** — R-L4's literal ask, which revision pass 2 omitted while the badge label claimed the timers were halted (review-3 finding 19). Both, because `stop()` cannot cover a `runNow` already in flight and the in-dispatch check cannot stop a timer waking the process. |
| `electron/ipc/metaCognition.cjs` | **changed, ~10 lines** | **`startAudit()` / `stopAudit()` exported.** The audit interval is armed inside `register()` and the existing `stop()` has no re-arm, so without this a lift could not restart it and FR-12 would be a claim the code could not keep. `register()` now calls `startAudit()`; `stop()` keeps its existing behaviour (I11, nothing removed). |
| `electron/lib/customProviders.cjs` | **changed, ~8 lines** | **`isLoopbackHost` exported** — a *new, separate* predicate (`127.0.0.0/8`, `::1`, `localhost`) for the egress question, leaving `isPrivateHost` and `PRIVATE_HOST_PATTERNS` their SSRF meaning untouched. `10.x`/`192.168.x` are other machines, so they must not read as local for a local-only record (review finding 20). |
| `electron/ipc/voiceEngine.cjs` | **changed, 2 lines** | `gateOutbound(textParts, 'cloud')` before the `POST https://api.openai.com/v1/audio/transcriptions` at line ~269. Measured: it does not pass `chatCompletion` (review finding 2). |
| `electron/ipc/browserEngine.cjs` | **changed, 2 lines** | `gateOutbound([query], 'cloud')` before the three `encodeURIComponent(query)` search URLs at ~205–207. |
| `electron/ipc/codeRegenEngine.cjs` | **changed, 2 lines** | `gateOutbound([query], 'cloud')` before `researchFix`'s DuckDuckGo URL at ~49. |
| `electron/ipc/intelligenceEngine.cjs` | **changed, 2 lines** | `gateOutbound([query], 'cloud')` before `fetchDDGAPI`'s URL at ~295. |
| `electron/ipc/evolutionEngine.cjs` | **changed, ~6 lines** | **THE FIFTH OUTBOUND TEXT PATH, absent from revision pass 1 entirely** (review-2 finding 4). Three gate calls: top of `searchNpm` (~218, request at 220), top of `searchArxiv` (~252, request at 255), top of `searchGitHub` (~167, request through `githubAPI` at 540). It already routes through `lib/http.cjs` (`net.get`, line 547), so I9 is intact and only the gate is missing. **`readRepoFiles` (~290) also reaches `githubAPI` and is NOT gated** — it carries repository and path names rather than caller text — and that is a printed residual, not an omission. |
| `electron/ipc/selfCare.cjs` | **changed, ~8 lines** | **The STOP's third dispatch point** (review-2 finding 7). `startSweep()`/`stopSweep()` exported, and **`register()` calls `startSweep()` instead of arming the interval inline at EITHER of its TWO arming sites — line 345 AND line 396, both replaced** (review-3 finding 17: revision pass 2 named only 396, and **replacing one leaves a live timer that criterion 22a's interval-clearing assertion would still pass** — a green row over a running timer), plus an `isHalted()` check at the top of `runHealthSweep` (line 200) so an in-flight interval is a no-op. Measured: the sweep auto-arms at `register()` every 120 s and calls `checkInstanceFailover()` (line 125, invoked at 224), which per ledger row 49 expresses a dormant gene on a sibling instance — **state-changing autonomous work, unhalted and undeclared before this.** |
| `electron/ipc/marketIntel.cjs` | **changed, ~4 lines** | **The STOP's fourth dispatch point.** An `isHalted()` check at the top of `tickResolveOutcomes` (731) and `tickSyncNews` (748); timers armed at 784–785. `startScheduler`/`stopScheduler` already exist and are exported, so the STOP calls `stopScheduler()` and the two in-tick checks cover a run already in flight. Master's on-demand StockMind calls go through IPC handlers and are untouched. |
| `electron/ipc/agentOrchestrator.cjs` | **changed, ~6 lines** | **R-L4's teardown half, plus the one declared exemption.** `killAllRunning()` exported, iterating `agents` and calling each `agent.killFn` — the path the governor already uses at **line 637** (corrected in revision pass 3, review-3 finding 17: `killFn` also appears at 122, 140 and 359, so "634" pointed at a different caller and a coder following it would have copied the wrong one) — so `engage()` does not leave autonomous children alive behind a stopped parent. The governor itself (line 630) is **declared `stopExempt` with its reason**: it only reaps, and halting a reaper leaves hung agents running and unassimilated. |
| `electron/ipc/sandboxEngine.cjs` | **changed, ~4 lines** | **R-L4's other teardown half.** `killAllExecs()` exported, iterating `activeExecs` and calling `exec.proc.kill('SIGTERM')` — the path `sandbox:kill` already uses at line 285 — so `engage()` can reach sandbox children. Today the module exports only `{register}`, so no caller outside its own IPC handlers can stop a child. |
| `scripts/verifyAutonomyPolicy.cjs` | **new** | Criteria 6–22c, 84, 86, 87, 94, 95. |
| `scripts/verifySelfUpgradeLoop.cjs` | **new** | Criteria 1–5, 19b, 23–52, 61–63, 81–83b, 85, 88–91, 93. |
| `scripts/verifyContextStore.cjs` | **new** | Criteria 64–80, 92, and 54/54a/54b's gate rows. |

**Not changed, and named so a later session does not reach for them:** `electron/ipc/aiProcess.cjs` and
`scripts/verifyEngineDiagnosis.cjs` (the cause-id mapping lives in `breakageAnalysis.cjs` instead —
§E.5.3a), `electron/lib/proposals.cjs`, `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`,
`capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json`, `shared/loyalty-tripwire.json`,
`releaseChannel.cjs`, `sessionManager.cjs`.

## E.1 The autonomy policy table

**The shape is Anthropic RSP / OpenAI Preparedness Framework, as Section 124 §2.5 identified it:**
rungs declared in advance, each naming the safeguard it requires, a rung entered only when an
evaluation says so, and **an undetermined evaluation defaulting to the stricter rung.** Section 124's
finding was that Rāma has the components and *no ladder* — the matrix answers *"may this user do
this?"* and nothing answers *"has Rāma earned this?"* This is that ladder.

### E.1.1 The levels

```
L0 forbidden            the path refuses, naming the class and the level it would need
L1 observe              may read in-process; no network, no write
L2 research             may read the network through lib/http.cjs under admit()
L3 propose-only         may create a ledger entry; may not apply
L4 apply-after-approval may apply an entry master approved (this is master's act, not Rāma's)
L5 apply-autonomous     DECLARED AND UNREACHABLE — no class may hold it; the loader rejects it
```

**Why L5 is in the ladder at all.** The brief requires the architecture to be ready for an unlock
without a redesign. A ladder that stops at L4 would make autonomous application a *new concept* to be
invented later, which is exactly how a stop gets retrofitted onto a running loop. Declaring L5 and
making it unreachable means the thing that would have to change is **one value in one frozen constant,
visible in a diff, with a suite row that currently asserts it is impossible.**

### E.1.2 The classes — fifteen, with the floors as the shipped levels

> **Legend. Two columns, not three, and that is a correction** (review-1 finding 4 asked for three
> distinct values; **review-2 finding 5 measured that one of them described a file that ships absent**).
> **FLOOR** — frozen in code; the level a class holds whenever the data file is absent, rejected, or
> silent about it. **Since `shared/autonomy-policy.json` ships absent (§E.0.1, §E.2.7), the FLOOR IS
> THE SHIPPED LEVEL** — there is no third value, and the old "ships at" column printed levels no
> install has ever had. **CEILING** — frozen in code; the highest level the data file can ever reach
> for that class. **PERMANENT** — the data file is not read for this class at all, so its level is
> always exactly its floor.
>
> **The floor is a FALLBACK, not a minimum** (FR-6). A present data file may **restrict** an editable
> class below its floor — which is how master puts Rāma offline (`research-network` → L1) or turns the
> automatic revert off (`revert-own-apply` → L0, §I.1) — and may **raise** one only as far as its
> ceiling. `floor ≤ ceiling` and the `RAMA_INITIATED` bound are asserted for every row (criterion 12);
> the row counts are asserted too (criterion 95), because a count in two prose blocks is a count that
> drifts.
>
> **The three-clause legend must travel together, because its first clause is false alone**
> (review-3 finding 18). *"Data may always restrict"* is true **of an EDITABLE class only** — a
> **permanent** class's level is not read from the data file at all, so **master cannot lower
> `master-record` or `loyalty-core` by data either; only by a source edit to `autonomyPolicy.cjs`
> under an I6 approval.** Wherever that clause is quoted on its own — §E.1.2's headline paragraph,
> Part F, Part G — it now carries the qualifying half-sentence, because a reader who meets the short
> form first will believe master has a lever he does not have.

| # | classId | Covers | Floor = shipped | Ceiling | Permanent | Why the ceiling is there |
|---|---|---|---|---|---|---|
| 1 | `observe` | Reading sensors in-process | L1 | L1 | no | Nothing above L1 means anything for a read. |
| 2 | `research-local` | Reading repo files, running read-only suites | L1 | L1 | no | Same. |
| 3 | `research-network` | Outbound reads through `lib/http.cjs` | **L2** | L2 | no | **Its honest current level** — `ollama-catalog` and `dependency-review` already do this daily, so a floor of L1 would have described an install that does not exist. Master lowers it to L1 to put Rāma offline without stopping everything. |
| 4 | `propose-question` | A ledger entry with `changes: []` | **L3** | L3 | no | A question carries no diff; `dependencyAdvisor` already files these daily. The floor is L3 because **this is the behaviour §E.1.5 describes**, and with a floor of L1 an install with no policy file could not have filed the question the whole shipped posture rests on. |
| 5 | `propose-source` | A ledger entry **with a diff** | L1 | L3 | no | **I6 pins the ceiling at L3.** Floor L1 so the first unlock is a pure data change (§E.1.5). |
| 6 | `dependency-change` | `package.json` / `package-lock.json` diffs | L1 | L3 | no | **I12 pins the ceiling at L3** — `dependencyAdvisor`'s posture: it never upgrades. |
| 7 | `build-repair` | A fix for a failed build or suite | L1 | L3 | no | A repair is still a source change; I6 applies identically. The brief: *"not a build repair, not ever."* |
| 8 | `author-change` | **Producing the bytes of a change body at all** (FR-49, §E.4.2a) | L1 | L3 | no | **Added in revision pass 2** (review-2 finding 1). Nothing in revision pass 1 authored the diff the loop proposed, so `propose-source` at L3 permitted filing something no component made. At L1 the author emits **no content**; **L3 is required to emit any**, so a diff exists only when `propose-source` **and** `author-change` are both raised. The ceiling is L3 because authoring is not applying. |
| 9 | `revert-own-apply` | Restoring each file snapshotted before an approved apply to its recorded prior state | **L4** | L4 | no | **The floor was L0 and that was a live defect** (review-2 finding 5): `apply()` checks `policy.require('revert-own-apply')` at entry, the data file ships absent, so on every shipped install a master-approved `self-upgrade` **could not have been applied at all** — and the automatic revert the whole AFTER-APPLY guarantee rests on was forbidden. **The floor is the level that must hold when configuration is absent**, and for a safety net that level is "works". §E.6 argues why one approval covers it; §I.1 offers master the L0 data value if he reads I6 more strictly (criterion 9a). |
| 10 | `apply-source` | Writing Rāma's own source | L4 | L4 | **YES** | **I6.** Permanent-at-L4 means it can never become L5. |
| 11 | `release-classify` | Tag, publish, version bump, classification | L0 | L0 | **YES** | **I17 — master alone.** |
| 12 | `capability-grant` | `shared/capabilities.json` | L0 | L0 | **YES** | **I8** + protected file + the tripwire. |
| 13 | `loyalty-core` | The seven protected files and the nucleus | L0 | L0 | **YES** | **I15 / I16.** |
| 14 | `master-record` | **Capture scope and retention window for what is recorded about master** | L3 | L3 | **YES** | **Addendum A §A.1.** Rāma may never widen its own retention window or capture scope. |
| 15 | `autonomy-policy` | **The policy table's own data file and the two modules that implement the policy and the stop:** `shared/autonomy-policy.json`, `electron/lib/autonomyPolicy.cjs`, `electron/lib/autonomyStop.cjs`, `shared/loyalty-tripwire.json` | L0 | L0 | **YES** | **Added in revision pass 1** (review-1 finding 5). The first table fenced the policy MODULES through the proposer's refusal list but not the policy **DATA FILE**, which sits under the repo root and is exactly the lever that raises a class — so a diff-bearing proposal raising `propose-source` from L1 to L3 could have sat in the queue with an Approve button next to it. **Rāma may not propose its own promotion.** |

**The arithmetic, stated once and asserted by criterion 95 so the two prose blocks cannot drift from
each other:** **six** permanent classes (10–15) for which the data file **is not read at all**;
**eleven** classes with `floor === ceiling` (1–4, 9–15), of which the five non-permanent ones (1–4, 9)
the data file can only **lower**; and **four** with `floor < ceiling` — `propose-source`,
`dependency-change`, `build-repair`, `author-change` — which are **the live raise path**. 6 + 5 + 4 = 15.

**So: the data file can always RESTRICT — any EDITABLE class, never a permanent one, whose level it is
not read for at all — it can RAISE only those four and only to L3, and it can never
raise its own authority** — which is what class 15 is for. **Raising any of the four is a data change
plus a master approval, with no source edit**, and criterion 41 exercises exactly that. *Revision
pass 1's headline for this paragraph was "as shipped the data file can only restrict", which was true
only of a file that shipped with levels in it; with the file absent the honest statement is the one
above.*

### E.1.3 What is in code and what is in data — the mechanical answer to Addendum A §A.1

Addendum A asks: *if the policy table lives in a data file, what stops Rāma proposing an edit to that
file which raises the permanent class? Your answer must be mechanical, not a comment.*

**The answer: the data file carries no authority over permanent classes, because the loader never reads
them from it.** `autonomyPolicy.cjs` holds four frozen constants:

```js
const CLASSES   = Object.freeze([...15 ids...]);
const FLOORS    = Object.freeze({ ...classId -> 'L0'..'L4' });
const CEILINGS  = Object.freeze({ ...classId -> 'L0'..'L4' });
const PERMANENT = Object.freeze(new Set([
  'apply-source','release-classify','capability-grant','loyalty-core','master-record','autonomy-policy',
]));
const EDITABLE  = Object.freeze(CLASSES.filter(c => !PERMANENT.has(c)));   // derived, never restated

// The classes whose action RĀMA INITIATES. FR-6's bound is asserted over THIS set, not over
// CLASSES — because `apply-source` and `revert-own-apply` have L4 floors by design and describe
// master applying or undoing something he already approved. Without the declared subset, FR-6's
// sentence and the table it governs contradicted each other (review-2 finding 8).
const RAMA_INITIATED = Object.freeze([
  'observe','research-local','research-network','propose-question',
  'propose-source','dependency-change','build-repair','author-change','master-record',
]);   // criterion 12: floor(c) <= L3 for every c in here

// MASTER'S ACTS, not Rāma's autonomy: applying, or undoing, a change master already approved.
// THE ONLY CLASSES THAT MAY IGNORE THE STOP, and the only ones requireMasterDriven() accepts.
// Added in revision pass 3 (review-3 finding 1). Without it, the STOP's first resolver line forced
// L0 on EVERY class, the shipped install has no allow-file and is therefore stopped, and the
// applier's `policy.require('revert-own-apply','L4')` at entry REFUSED A MASTER-APPROVED APPLY ON
// EVERY INSTALL — the defect review-2 finding 5 named, fixed in the data state (floor L0 -> L4) and
// left live in the stop state, and reachable even with a valid allow-file via RAMA_AUTONOMY=stop.
const MASTER_ACT = Object.freeze(new Set(['apply-source', 'revert-own-apply']));

// The paths the loop may never name in a diff or a remedy. ONE constant; the proposer's refusal
// list, the `autonomy-policy` class's coverage and criterion 19a all read it rather than restating it.
const SELF_GOVERNING_PATHS = Object.freeze([
  { path: 'shared/autonomy-policy.json',        optional: true  },  // ships absent by design
  { path: 'electron/lib/autonomyPolicy.cjs',    optional: false },
  { path: 'electron/lib/autonomyStop.cjs',      optional: false },
  { path: 'shared/loyalty-tripwire.json',       optional: false },
]);
```

**`SELF_GOVERNING_PATHS` is declared here, in the policy module, and not in the proposer** — because
the thing being protected is the policy's authority, and a list that lived with the consumer could be
narrowed by a change to the consumer alone. `optional: true` on the data file is there so criterion 87
can assert the other three exist on disk without failing on the one that ships absent.

`shared/autonomy-policy.json` may contain **exactly** `{version: 1, levels: {<id>: 'L0'..'L4'}}` where
every `<id> ∈ EDITABLE`. The loader validates and then **intersects**:

```
effective(c, opts = {})
  = STOP engaged && !opts.ignoreStop -> 'L0'                 // checked FIRST, always
  | file absent                      -> FLOORS[c]            // THE SHIPPED PATH
  | file rejected                    -> FLOORS[c]
  | PERMANENT.has(c)                 -> FLOORS[c]            // data is not consulted at all
  | min(CEILINGS[c], levels[c] ?? FLOORS[c])
```

> **`opts.ignoreStop` exists for exactly one caller and cannot be reached by any other**
> (FR-53, review-3 finding 1). **`effective(c)` with no options is unchanged** — `L0` for all fifteen
> while the STOP is engaged, which is what criterion 6a asserts. The opt-in has **one** consumer:
>
> ```js
> function requireMasterDriven(classId, need) {
>   if (!MASTER_ACT.has(classId)) {
>     throw new Error(`requireMasterDriven is only for MASTER_ACT classes — "${classId}" is not one`);
>   }
>   return gate(effective(classId, { ignoreStop: true }), classId, need);
> }
> ```
>
> **The `throw` is the fence.** A Rāma-initiated class cannot borrow the carve-out, because the only
> function that ignores the stop refuses to be called with one — and criterion 21b plants a third
> member into `MASTER_ACT` and requires the row to go **RED**. *The reasoning is the same one §E.1.1's
> L4 gloss and §D.1's fence already give: applying or undoing a change master approved is **master's
> act**, and the STOP exists to halt **Rāma starting work**. A stop that revoked master's own apply
> would, on an install that is permanently stopped by design, mean he could approve a change and never
> apply it — forever.*

> **The first line dominates, and that is why criteria 6–9 name an allow-file fixture** (review-2
> finding 9). On a shipped install there is no allow-file, so `isStopped()` is `true` and **every class
> is `L0` before the resolver ever looks at the data file** — the floors in §E.1.2 describe what the
> policy resolves to *once master has allowed autonomy at all*, not what a fresh install does.
> Criterion 6a pins that precedence as its own row rather than leaving it implied by two rows that
> each assume the other's state.
>
> **And `min()` is why a present data file can go BELOW a floor.** `levels[c] = 'L0'` for an editable
> class resolves to `L0`, which is deliberate: the floor answers *"what holds when nothing is
> configured"*, and master restricting something explicitly is not the same question. This is the
> mechanism behind §I.1's offer and criterion 9a.

> **`effective()` is a PURE RESOLVER and carries no exception for the in-flight revert** (review
> finding 12). The earlier draft parenthesised one here, which could not work: a pure resolver cannot
> know a revert is in flight, so with the STOP engaged `revert-own-apply` would resolve to `L0` and the
> revert would be refused — producing exactly the stranded half-applied tree the exception exists to
> prevent. **The carve-out is a token issued at `apply()` entry instead, and §E.5.1a specifies it.**

**Note the third line: for a permanent class the data file is not merely overridden, it is not read.**
A `"master-record": "L4"` key is not a value that loses a `min()`; it is a key with no reader.

**And the file is rejected WHOLE, not per-key.** `validate()` returns
`{ok: false, why}` on: an unknown class id, a permanent class id, a non-string level, a level outside
`L0..L4`, `L5` anywhere, a level above that class's ceiling, any extra top-level key, a missing or
non-`1` `version`, or unparsable JSON. On rejection **every** class falls to its floor.

> **Why whole-file rejection and not ignore-the-bad-key.** A partial accept teaches whoever wrote the
> file which edits are silently dropped and lets the rest through — so a proposal mixing one forbidden
> raise with four legitimate lowerings would land four of five and look like it landed nothing. A
> whole-file rejection is loud, fails safe, and makes the file's validity a single binary that
> `policyStatus()` reports and the UI shows. This is the same reasoning `claimGate` uses when it marks
> the **whole** answer `unattributed` if any finding was withheld: *"reporting `grounded` while quietly
> dropping a sentence would re-create the thing this replaced."*

**Raising a permanent class therefore requires editing `autonomyPolicy.cjs` itself** — a source change
needing an I6 approval, visible in a diff, and **criterion 10 plants exactly that mutation and requires
the row to go RED.** Two further guards: `upgradeProposer` refuses any diff naming
`electron/lib/autonomyPolicy.cjs` or `electron/lib/autonomyStop.cjs` (§E.4.4), and §I asks master to
add both to `PROTECTED_FILES` and the tripwire manifest — which this design **cannot** do, because
`loyaltyGuard.cjs` is protected.

**Honest residual, printed by the suite on every run:** until master adds those two paths to
`PROTECTED_FILES`, the proposer's refusal is the only mechanical guard on them, and the proposer is
not a protected file either. The suite prints `RESIDUAL: autonomyPolicy.cjs and autonomyStop.cjs are
not in loyaltyGuard.PROTECTED_FILES — see SELF_UPGRADE.md §I.2` and counts it. This follows Section
125's rule: *"a suite that silently covered half an invariant while printing a green line would be a
worse artefact than no suite at all."*

### E.1.4 The API every gated path uses

```js
policy.require(classId, need, { action } = {})      // `need` is REQUIRED and THROWS when absent
// -> null                                        when permitted
// -> { ok:false, blocked:true, classId, have:'L1', need:'L3', reason }   when not

policy.requireMasterDriven(classId, need)          // MASTER_ACT classes ONLY; throws otherwise
```

**`need` is a required positional argument with no default, and that is FR-10's mechanism rather than
its wish** (review-3 finding 7). Revision pass 2 wrote `require(classId, {action})` and declared
`GATED` as `[{module, fn, classId}]` — **so nothing said where the level came from, a refusal could not
name what it needed, and criterion 13 could only look for the literal `policy.require('<classId>'`
with the level missing.** A gate whose level defaults is a gate whose refusal is *"not allowed"*, which
is this design's `'it failed'` in a different costume. §E.9's no-default rule applies: **absent `need`
throws.**

**The frozen `GATED` table — all six rows, so the pairing is data the suite reads rather than prose a
coder re-derives:**

| Module | Function | `classId` | `need` | Why that class |
|---|---|---|---|---|
| `upgradeNotice` | `collect` | `observe` | **L1** | In-process sensor reads. |
| `upgradeResearch` | `gather` | `research-network` | **L2** | Outbound reads through `lib/http.cjs`. |
| `upgradeAuthor` | `author` | `author-change` | **L3** | Producing the bytes of a change body. |
| `upgradeWeigh` | `weigh` | **`research-local`** | **L1** | **Picked, not left between two candidates** (review-3 finding 7): `weigh` was listed as a chokepoint while **no class among the fifteen covered weighing**, and `observe` and `research-local` were both plausible. It reads repo files, walks the tree through `analyzeImpact` and runs `git` read-only — which is §E.1.2 row 2's definition verbatim, and is strictly more than `observe`'s *"reading sensors in-process"*. |
| `upgradeProposer` | `file` | **per KIND** (sub-table below) | **L3** | A ledger entry is a `propose-*` act, and which one depends on what is being filed. |
| `upgradeApplier` | `applyWith` | `revert-own-apply` | **L4** | Via **`requireMasterDriven`**, because this is master's act (FR-53). |

**`file()`'s class comes from the kind it is filing:**

| Filing | `classId` | `need` |
|---|---|---|
| `KIND.QUESTION` | `propose-question` | L3 |
| `KIND.DIFF`, finding class `propose-source` | `propose-source` | L3 |
| `KIND.DIFF`, finding class `dependency-change` | `dependency-change` | L3 |
| `KIND.DIFF`, finding class `build-repair` | `build-repair` | L3 |

**And what `file()` does when `propose-question` is itself restricted to `L0` by master's data file —
because that is reachable (criterion 9a: data may always restrict an editable class) and revision
pass 2 never said.** **It files nothing, and it says so loudly** (FR-59): the run log and
`policyStatus()` both carry `{blocked: true, classId: 'propose-question', have: 'L0', need: 'L3'}`, and
the Autonomy panel reads *"Rāma is noticing and researching, and may file nothing — you set
`propose-question` to L0."* **A loop silenced by master's own edit must never be indistinguishable from
a loop with nothing to say** — `sensorsAbsent[]`'s rule (B.2 habit 1), pointed at the proposer's own
output. Criterion 13a.

Shaped exactly like `capability.deny()` — returns `null` when allowed, the refusal object when not —
because that pattern is already the house idiom and *"most IPC files were hand-rolling this exact check
inconsistently"* is a lesson already paid for. The refusal **names the class and the level needed**
(FR-10), so a blocked path produces a sentence master can act on rather than a silent no-op.

`policyStatus()` returns
`{levels, floors, ceilings, permanent, rejected, why, source, stopped, fileSha256, ledgerAttested, attestedBy, attestedAt}`
for the UI and for `selfModel`. Every field carries its own truth; nothing is inferred by the renderer.

**Why the last four fields exist — R-G2's gate, which a JSON edit does not satisfy** (review finding
19). §10 row 4.1's gate is *"master-only advancement, **recorded in the ledger** (I17's shape)"*. A hand
edit to `shared/autonomy-policy.json` changes what Rāma may do with **no ledger row, no audit entry and
no attested who-or-when** — the drift pattern ledger row 48 named, arriving through the one file this
design asks master to edit. So:

- **`load()` records `fileSha256`** over the bytes it read.
- **An unattested digest warns once per load** (`console.warn`, not per call — §E.8 row 2's rule) and
  the Autonomy panel reads *"policy file changed <when> — no ledger record"*.
- **Master records an advancement with one tier-0 call** that files a **question-kind** ledger entry
  carrying `{fileSha256, levelsBefore, levelsAfter, note}`. It is a question kind deliberately: it has
  no applier, carries no diff, and is a record of a decision master already took by editing the file —
  not a request for permission to take it.
- **Rāma cannot attest its own policy file.** The attesting call requires a real `user` at tier 0, and
  criterion 18's source-shape rule — zero internal callers — covers it the same way it covers `lift`.

**The sequence master actually performs, written down in one place because it was spread across three**
(review-2 finding 16). Raising a class is described as *"a data change plus a master approval"*,
refusal 5 forbids a **proposal** naming the file, and criterion 84 wants the digest ledger-attested —
three true statements that never said what master does. He does this:

1. **Edits `shared/autonomy-policy.json` by hand.** It is **not** a proposal — the proposer refuses any
   change naming it (§E.4.4 refusal 5), outright and not downgraded, because a question asking to be
   promoted is still asking to be promoted. Creating the file for the first time is the same act; it
   ships absent.
2. **Calls `policy.reload()`, or restarts.** **No build is required, and this has to be said out loud:**
   `localUpdateEngine.classifyChange` returns **`'renderer'`** for anything under `shared/`, because
   that is the right answer for the files it was written about — but **this file is read by the MAIN
   process through `fs.readFileSync` and is not bundled by Vite**, so there is nothing to build. A
   later session reading `classifyChange` would conclude otherwise, and `vite build` is the one step
   this workspace cannot run (§H.2). Criterion 94 asserts the no-build, no-restart path.
3. **Calls the tier-0 attest channel**, which files the **question-kind** entry carrying `fileSha256`,
   `levelsBefore`, `levelsAfter` and his note — after which `policyStatus().ledgerAttested` is `true`.

**Steps 1 and 2 change what Rāma may do; step 3 is what makes the change a record.** Skipping step 3
leaves the levels in force and the panel saying *"policy file changed <when> — no ledger record"*, which
is the honest state rather than a refusal to honour master's edit.
- The effective levels do **not** depend on attestation. An unattested file still applies, because
  silently ignoring master's edit would be worse than reporting it unrecorded. **What is withheld is
  the claim that the change was recorded**, which is the honest thing to withhold.

### E.1.5 Staging — once autonomy is allowed, the default is "notice and research, propose nothing"

> **Read §E.2.7 first. There are TWO gates and this section describes only the second one.** As
> shipped, **no allow-file exists, so the STOP is engaged and the loop does nothing at all** — it reads
> no sensor and files nothing (criterion 40a). Everything in this section describes what happens
> **after master has created the allow-file.** The earlier draft asserted this section's behaviour as
> *the shipped default*, which contradicted the fail-safe stop two sections later (review finding 3);
> the behaviour is right, the words "shipped default" were not.

Once autonomy is allowed — with `research-network` at **L2** and `propose-question` at **L3**, both
their floors, and `propose-source`, `dependency-change`, `build-repair` and `author-change` all at
**L1** — the loop **notices, researches, authors nothing, and weighs and files a QUESTION** carrying the
whole dossier and a `blockedBy: 'autonomy policy: propose-source is L1 (observe); L3 required'` field.
**Two classes have to be raised for a diff to exist, not one**: `author-change` is what permits the
bytes to be produced and `propose-source` is what permits them to be filed, and at L1 the author emits
nothing, so the question carries a researched remedy **in words** rather than a patch (FR-49,
criterion 41). Master reads a
researched, weighed, blast-radius-computed account of a real measured defect — and decides whether to
raise the class, rather than deciding on a diff Rāma produced before anyone agreed it should.

**This mirrors Addendum A §A.3's Stage 0 / Stage 1 / Stage 2 posture exactly, and it makes
Section 124's measurement still true after this ships:** the loop's registered scheduler task is a
**read** that files a question, which is the `dependency-review` shape — Level 2 (Consultant), not
Level 3. **No autonomy ladder rung is climbed by this design.** Criterion 40 asserts this behaviour
**with a valid allow-file fixture**; criterion 40a asserts that **without one, nothing runs**;
criterion 41 asserts the data-only unlock works.

## E.2 The STOP — designed now, before anything is autonomous

> **Why now, when nothing is autonomous yet.** Because a stop retrofitted onto a running loop is the
> one thing that must not be retrofitted. Section 124 already found there is *no "stop all autonomous
> activity, stay running, stay inspectable" control*, which is exactly what an operator wants during an
> investigation — and it found it while nothing much was running. Building it first means the loop below
> is born with its chokepoints already consulting it, rather than having them added to a system whose
> call graph has grown past the point where anyone can enumerate it.

### E.2.1 A positive allowance, not a stop-flag — and why that direction

State lives in **one** file, **outside the repository**:
`<userData>/rama/autonomy.allow` containing `{"allowed": true, "by": "...", "at": "<ISO>", "note": "..."}`.

```js
// ── isStopped(): governs the SIX NEW CHOKEPOINTS. Fail-safe; absence means stopped. ──
function isStopped() {
  if (String(process.env.RAMA_AUTONOMY || '').toLowerCase() === 'stop') return true;
  let raw; try { raw = fs.readFileSync(allowPath(), 'utf8'); } catch { return true; }
  let o;   try { o = JSON.parse(raw); } catch { return true; }
  return o?.allowed !== true;        // strict true, not truthy
}

// ── isHalted(): governs the FOUR PRE-EXISTING DISPATCHERS. True only on an EXPLICIT engage. ──
//
// Added in revision pass 3 (review-3 finding 3). The four dispatchers govern work that SHIPS AND
// RUNS TODAY — ollama-catalog and dependency-review, the metaCognition audit, selfCare's 120s sweep
// including checkInstanceFailover, and marketIntel's two ticks. Governing them with isStopped()
// meant INSTALLING THIS DESIGN REMOVED FOUR WORKING BEHAVIOURS on every install until master
// hand-created a file nobody had told him about: a fail-safe argument used to justify a regression,
// which FR-5 and I11 do not have an exception for.
function isHalted() {
  if (String(process.env.RAMA_AUTONOMY || '').toLowerCase() === 'stop') return true;
  try { fs.accessSync(stoppedRecordPath()); return true; } catch { return false; }
}
```

> **Two predicates, two safe directions, and the asymmetry is the decision.** For autonomy that does
> not exist yet, the safe default is *off*, and absence must mean *off* — nothing is lost because
> nothing was there. For autonomy that **already runs on master's machine**, the safe default is
> *unchanged*, and absence must mean *as the build he already has* — because deleting four working
> behaviours is not a safe direction, it is a different failure. **Both halves are printed by name in
> `statusText()` in both states** (criterion 22d), because the one thing that must never happen is a
> label saying *"stopped"* over four live timers or *"running"* over four dead ones — the `badgeLabel`
> defect §E.2.6 exists to prevent.
>
> **The option refused, recorded so it is not re-proposed.** The review offered a first-run migration:
> on first boot of a build containing `autonomyStop.cjs`, if no allow-file and no `autonomy.migrated`
> marker exist, write both, the allow-file carrying `by: 'upgrade-migration'`. **Refused, because the
> allow-file is what `isStopped()` reads** — so every upgraded profile would start with the **new**
> loop ALLOWED, and Rāma would begin noticing and researching on master's machine without him creating
> anything. That is the exact state §E.2.7 exists to prevent, and trading it for the four dispatchers
> is trading the wrong way. Two predicates cost one extra exported function and keep both directions.

**Why a file whose PRESENCE grants rather than whose presence forbids.** A stop-flag means the default
state of a fresh install, a wiped profile, a half-written file, a disk error or a permissions change is
**RUNNING**. Fail-safe requires that the uncertain state be the safe one, so the safe state must be the
one that needs nothing to be true. `o?.allowed !== true` is deliberately strict: `"true"`, `1`, `{}`,
`null` and a zero-byte file all resolve to stopped. Criterion 14 asserts all six.

This is Anthropic's precautionary-activation posture at the smallest scale — ASL-3 measures deployed
*without having determined the threshold was definitively crossed* (§2.5). **An undetermined evaluation
takes the stricter rung**, and an unreadable flag is an undetermined evaluation.

### E.2.2 Dependency-free and synchronous, deliberately

`autonomyStop.cjs` requires only `fs`, `path` and `os`. No `electron`, no `dataStore`, no `cryptoCore`.
It is therefore callable from `before-quit`, from a suite under plain `node`, from a module loaded
before the store is unlocked, and from inside a `catch` block during a failing boot. **A stop that can
fail to load is not a stop** — and `selfRepair.cjs` already made this argument for itself: *"a repair
mechanism that needed a third-party package could not repair a missing third-party package."* Criterion
16 asserts it answers with `electron` unresolvable.

`userData` as the location is grounded, not assumed: `selfRepair.cjs` already depends on it being
writable in every install on every platform. **And it is outside the repo root, which is what makes the
state unnameable by any `changes[].path`** (FR-14) — a proposal cannot target a file the diff format
cannot address.

### E.2.3 Engaging — three ways, none of them refusable, none needing the renderer

| Route | Mechanism | Why it exists |
|---|---|---|
| **Tray** | A `Menu.buildFromTemplate` item *"Stop all autonomous activity"* in `createTray()`'s existing context menu (`main.cjs` ~1444) | The renderer may be crashed. Section 124's requirement: *tray-reachable so a crashed renderer cannot disable it.* The tray already survives a hidden window and `badge:set-hide-tray` restores it rather than leaving no way back. |
| **Environment** | `RAMA_AUTONOMY=stop`, checked **first**, overriding a valid allow-file | Works before the app starts, and works when the filesystem is the thing that is wrong. |
| **By hand** | Delete `<userData>/rama/autonomy.allow`, and/or create `<userData>/rama/autonomy.stopped.json` | Needs no running Rāma at all. Master always has a route that does not depend on Rāma cooperating. **Deleting the allow-file stops the loop; the stopped-record is what also halts the four pre-existing dispatchers** (`isHalted()`), and **deleting the stopped-record is how a halt is undone without `lift()`** — which matters because `lift()` cannot succeed at all until master adds `system.suspend-autonomy` (§E.2.4). |

**Engaging requires no capability check and no `user`.** A stop that can be refused is not a stop, and
gating it would make the one control an operator reaches for during an incident dependent on the
subsystem being investigated.

**But it RECORDS before it destroys** (FR-16a, review-3 finding 11):

```js
engage(reason, by) // 1. read the allow-file's current contents, if any        -> priorAllow
                   // 2. WRITE <userData>/rama/autonomy.stopped.json
                   //      { at, reason, by, priorAllow }
                   // 3. THEN unlink the allow-file
                   // 4. refreshScheduler.stop() · metaCognition.stopAudit() · selfCare.stopSweep()
                   //    marketIntel.stopScheduler() · agentOrchestrator.killAllRunning()
                   //    sandboxEngine.killAllExecs()
```

**Revision pass 2's `engage(reason)` deleted the allow-file and returned** — destroying the only record
of **who** allowed autonomy, **when**, and master's **note**, and dropping its own `reason` on the
floor. For the one automatic engage in this design — a **fatal revert**, with Rāma's source in an
unverified state and the snapshot untrustworthy (§E.5.5) — **that reason is the most important datum in
the system**, and it survived only as a ledger entry and a `console.error` line. `lift()` cannot
succeed until master adds a capability, so recovery was master hand-writing a file whose prior contents
had just been deleted. **Ordering is asserted, not intended** (criterion 22c): the record is written
first, so a crash between steps 2 and 3 leaves a recorded reason and a still-present allow-file —
inconsistent in the **recoverable** direction — rather than a deleted file and no explanation.

**And one boundary stated so the two predicates stay honest:** `statusText()` and the Autonomy panel
read the stopped-record **for the reason**; `isHalted()` reads **its presence** for the
pre-existing-dispatcher state; and **`isStopped()` never reads it at all**, so **an absent
`autonomy.stopped.json` never implies autonomy is running** — criterion 14's shape, asserted in
criterion 22c.

### E.2.4 Lifting — the only gated direction, and it degrades honestly

```js
lift(user, note)   // the ONLY writer of allowed:true
```
Refuses, in order: a string `user` (*"a name is not an identity"* — `proposals.authorise`'s own words);
a `user` without a numeric `tier`; `capability.deny(user, 'system.suspend-autonomy')`; an empty or
whitespace `note`.

**The honest degradation, and it is the good kind.** `shared/capabilities.json` is protected, so this
design does **not** add `system.suspend-autonomy`. `capability.can()` returns **`false` for an unknown
capability, for every tier including master**. Therefore, until master adds the key, **`lift()` cannot
succeed for anyone, and the STOP can only be lifted by master writing the allow-file himself.** That is
the correct failure direction, it needs no special-casing, and the UI says exactly that — *"Autonomy is
stopped. Lifting it in-app needs the `system.suspend-autonomy` capability, which master has not added
to `shared/capabilities.json`. See SELF_UPGRADE.md §E.13."* — rather than rendering a dead button, which
is the defect Section 59 found and removed (*two dead UI toggles that rendered as fixed-on switches
with no-op `onChange`*). Criterion 17 asserts all four refusals.

**Rāma can never lift it.** There is **no internal caller of `lift`** anywhere in the tree, and
criterion 18 is a source-shape assertion that finds exactly zero — *"the way `verifyClaimGate` asserts
the ABSENCE of a score"*, which Section 124 called out as the rarer and stronger kind of test. `lift`
is reachable only from the tier-0 IPC handler and the tray's *"Resume"* item, both of which pass a real
`user`.

### E.2.5 The chokepoints — five stop-consulting stage functions, one declared master-driven entry, four dispatch points, one declared exemption

`autonomyStop.cjs` exports **two** frozen lists, and the split is revision pass 3's (findings 1 and 2):

```
CHOKEPOINTS           — the FIVE Rāma-initiated stage functions that consult isStopped():
  upgradeNotice.collect · upgradeResearch.gather · upgradeAuthor.author
  upgradeWeigh.weigh    · upgradeProposer.file

MASTER_DRIVEN_ENTRIES — the ONE gated path that does NOT consult the stop, with its reason:
  upgradeApplier.applyWith
    reason: "applying or undoing a change master already approved is master's act; the level comes
             from policy.requireMasterDriven over the frozen MASTER_ACT subset, and 'Rāma does not
             start an apply' is held by criterion 21c's asserted absence of in-process callers"
```

**Six gated paths, five stop-consulting, one declared with its reason — never five with a sixth that
quietly does something different.** `GATED.length === CHOKEPOINTS.length + MASTER_DRIVEN_ENTRIES.length`
is asserted and all three counts are printed (criterion 13), which is `stopExempt`'s rule applied to
the chokepoint list itself: **the member that behaves differently is declared, not omitted.**

**`upgradeApplier<entry>` does NOT consult the STOP at all, and revision pass 2's rule for it was
unsafe in both directions** (review-3 findings 1 and 2). It said *"only for an autonomous apply
(`opts.autonomous === true`)"*. Measured, **`opts` is renderer input passed through untouched** —
`preload.cjs` 680 → `proposals.cjs` 272 → `applier(p, opts)` at 235 — **so the predicate deciding
whether the STOP applied was supplied by the party the STOP exists to stop**, and a future autonomous
applier would bypass it by **omitting a field**: this document's own *"gating six callers leaves the
seventh"* doctrine failing on itself. And the companion rule — an unconditional
`policy.require('revert-own-apply')` at entry — **refused a master-approved apply on every shipped
install**, because the STOP forces `L0` on every class and the shipped install has no allow-file. What
replaces both:

- **`opts.autonomous` is recorded into `meta.autonomy` and never read in a conditional** (FR-54,
  criterion 83a). It is a datum for the audit, not a gate. Nothing about the stop may be decided by a
  field a caller can omit.
- **The applier's gate is `policy.requireMasterDriven('revert-own-apply', 'L4')` plus an unconditional
  derivation of `masterDriven` from `opts.user` — no tier-0 user, no write** (FR-53, FR-55).
  `requireMasterDriven` resolves through `effective(c, {ignoreStop: true})` and **throws for any class
  outside the frozen `MASTER_ACT` subset**, so master's apply works on a permanently-stopped install
  **without** opening the stop to anything Rāma initiates.
- **"Rāma does not start an apply" is guaranteed by an ABSENCE, because no predicate available here can
  guarantee it.** `capability.can` reads only `user.tier` (`capability.cjs` 27–33), so `{tier: 0}` is
  forgeable in-process, and `proposals.apply` already authorised `opts.user` before the applier ran —
  the derived predicate is **tautologically true where it is evaluated.** So: **a source-shape
  assertion finds zero in-process callers of `proposals.apply` anywhere in the tree** (FR-55,
  criterion 21c), in the shape criterion 18 already uses for `lift`. The future L5 entry point is
  **named and absent** — `upgradeLoop.applyAutonomously`, which would consult
  `policy.require('apply-source', 'L5')` **and** `stop.isStopped()` **at its own entry**, because a
  start-of-work check belongs in the function that starts the work, not in the function that writes the
  bytes.

**Plus four existing dispatch points, each named and each measured — and ALL FOUR READ `isHalted()`,
NOT `isStopped()`** (review-1 finding 7 named two;
**review-2 finding 7 measured two more, both state-changing, both neither halted nor declared; and
review-3 finding 3 found that governing them with the fail-safe predicate would have REMOVED four
working behaviours on every install** — FR-12's blockquote carries that argument and §E.2.7 states the
shipped consequence):

| Dispatch point | Mechanism | Why it is not a wrapper |
|---|---|---|
| `refreshScheduler.runNow` | **`isHalted()` check before `await task.run()`** (line 133) **AND `engage()` calling the module's existing `stop()`** (line 220, already exported) | The single dispatcher `ollama-catalog`, `dependency-review` and the loop's own task all pass through, so one check covers three; a wrapper on the loop's own task would have covered one. **Both the timer and the dispatch point, because R-L4 asks for `stop()` and revision pass 2 never called it** (review-3 finding 19): without it the named timers kept firing and no-op'd inside `runNow` while the badge label said they were halted — and `verifyBadgeLabel`'s rule is that **the label describes what is true.** Conversely `stop()` alone cannot cover a `runNow` already in flight. |
| `metaCognition` | **`startAudit`/`stopAudit` exported**, `register()` calls `startAudit()` | Its interval is armed **inside `register()`** and the existing `stop()` has no re-arm, so without this a lift could not restart it. |
| `selfCare` | **`startSweep`/`stopSweep` exported, replacing BOTH inline arming sites — 345 AND 396** — plus an `isHalted()` check at the top of `runHealthSweep` (line 200) | Measured: `register()` auto-arms a 120 s sweep at **two** places and kicks one 5 s after boot, and the sweep calls `checkInstanceFailover()` (125, invoked at 224) — which per ledger row 49 **expresses a dormant gene on a sibling instance.** **Revision pass 2 named only line 396** (review-3 finding 17), and **replacing one arm leaves a live timer that criterion 22a's interval-clearing assertion still passes** — a green row over running work, which is the one failure mode this project treats as worse than a red one. The in-function check is separate on purpose: an interval already in flight must become a no-op, not finish. |
| `marketIntel` | `stopScheduler()` (already exported) plus an `isHalted()` check at the top of `tickResolveOutcomes` (731) and `tickSyncNews` (748) | Measured at lines 784–785: two background timers that write outcome resolutions and fetch news on their own schedule. **Master's on-demand StockMind calls arrive through IPC handlers and are untouched**, which is what keeps FR-17's promise true while still halting the timers. |

**And the teardown R-L4 names, which revision pass 1 omitted:** `engage(reason, by)` calls
`refreshScheduler.stop()`, `metaCognition.stopAudit()`, `selfCare.stopSweep()`,
`marketIntel.stopScheduler()`, `agentOrchestrator.killAllRunning()` and `sandboxEngine.killAllExecs()`
— the last two new exports over paths those modules already use internally (`agent.killFn` at
`agentOrchestrator.cjs` **637**, `proc.kill('SIGTERM')` at `sandboxEngine.cjs` 285) — so a stopped Rāma
does not leave autonomous children alive, and so the label's claim that the timers are halted is true
of the timers and not only of the dispatch points.

**One declared exemption, printed rather than silent:** `agentOrchestrator`'s governor is
`stopExempt`, with the reason carried in the set: *measured, it only reaps* — it kills agents past
`GOVERNOR.AGENT_TIMEOUT_MS` and garbage-collects finished ones **after assimilating them**, and that
module's own comment calls deleting an unassimilated agent *"necrosis rather than programmed death"*.
**Halting a reaper does not stop work; it leaves hung agents running.** `CHOKEPOINTS` enumerates the
six stage functions, `DISPATCHERS` the four dispatch points, `stopExempt` the one exemption, and **the
suite prints all three counts and fails if a timer is in none of them** (criteria 22a, 22b, 22c) —
because the gap that hid `selfCare`'s sweep from revision pass 1 was not a wrong answer, it was a
question nobody's suite was asking.

**Chokepoint, not caller** — `proposals.cjs` earned this lesson twice over: *"gating six callers leaves
the seventh, gating the chokepoint cannot be routed around"*, and the loyalty covenant sits at the
encryption boundary for the same reason. The suite asserts each of the five returns
`{ok: false, stopped: true, reason}` **without doing its work** (criterion 20) and **prints the
chokepoint count**, so coverage cannot silently shrink — row 118's lesson, as the tripwire applies it to
its manifest count.

**What is NOT stopped, named explicitly:** master's direct requests, `PRIORITY.CRITICAL` admissions,
chat, StockMind on demand, the UI, the ledger, `selfModel`, **`proposals.approve` and
`proposals.apply`**, and every manual action. **A stop that also breaks the app is a stop master will
never use**, which would make it worse than none. `admit()` at `PRIORITY.CRITICAL` still bypasses —
*"loyalty outranks throttling"*, and the stop does not change who Rāma is for.

**`proposals.apply` is on that list deliberately** (review-2 finding 6). Applying an approved proposal
is reachable only through `proposals:apply`
with a tier-0 `user`; it is the most unambiguously manual action in the system; and **the shipped
install is permanently stopped**, so a stop that blocked it would mean master could approve a change
and then be unable to apply it, on every install, forever. **And "on that list" now has a mechanism
rather than a flag** (review-3 findings 1 and 2): the applier reaches its level through
`policy.requireMasterDriven` over the frozen `MASTER_ACT` subset — **a declared two-class carve-out in
code**, not `opts.autonomous === true`, which was renderer input and omittable. **What stops Rāma
starting an apply is that nothing in the process calls `proposals.apply`, asserted as an absence**
(criterion 21c).

**And the four pre-existing dispatchers are a different question from this one, which is why they get a
different predicate.** They are halted by an **explicit** engage (`isHalted()`), not by the absence of
an allow-file — so the shipped install keeps `ollama-catalog`, `dependency-review`, the
`metaCognition` audit, `selfCare`'s sweep and `marketIntel`'s ticks running exactly as the build master
already has, **and the Autonomy panel says so by name in both states** (FR-12, criterion 22d). A stop
whose installation silently removed five working behaviours would be the kind of stop master
uninstalls.

**The one exception, and it is deliberate: an in-flight revert completes.** If the STOP engages while
`upgradeApplier.applyWith` is between its first write and its `revert(token)`, the revert finishes. A stop
that stranded a half-applied change would leave Rāma's source in a state nobody chose, which is worse
than either endpoint — and the revert only ever restores the snapshotted prior state, so completing it
cannot produce a new one. **New reverts are not started, and the mechanism is the token of §E.5.1a, not
a branch inside `effective()`** — a pure resolver cannot know a revert is in flight, so the earlier
draft's carve-out would have refused the very revert it existed to permit. Criterion 21's **five**
assertions cover the token, the tokenless refusal, an apply with no `user` while stopped, an apply
carrying `autonomous: true` being treated identically to one without it, and a master-driven apply
entered while stopped completing; **criterion 21b runs all of it in the state a shipped install
actually boots into — no allow-file, no policy file — and again under `RAMA_AUTONOMY=stop` over a
valid allow-file**, which was the second reachable form of the same defect.

### E.2.6 Visible, in the one place master can see when the window is gone

`badgeLabel.cjs` gains a stopped-state label that **enumerates the halted timers by name**, so the
existing `verifyBadgeLabel` rule applies unchanged: *every named timer must still exist on disk, or the
suite goes red rather than the badge going on claiming it.* This matters because `badgeLabel` exists
precisely because a label said "paused" over live background work: *"The badge is the only thing master
can see when the window is gone… it was wrong in the state he would most want it right."* A STOP whose
indicator could drift would recreate that defect in the one place it is least acceptable.

### E.2.7 What the shipped install actually does: nothing, until master creates one file

*Added in the revision pass. The fail-safe stop and §E.1.5's "shipped default" could not both be true
(review finding 3), and this is the reconciliation — stated here rather than left for whoever
implements it to discover from a failing suite.*

**As shipped there is no allow-file, so `isStopped()` is `true`, `effective()` is `L0` for every class,
and all six chokepoints refuse. The loop reads no sensor and files nothing.** That is the correct
behaviour for a fail-safe design and it is also the behaviour master will see on first run, so it is
documented as a first-class state rather than as an edge case.

> **AND — stated here because revision pass 2's version of this section named only the loop, which is
> what let the defect through** (review-3 finding 3): **the four PRE-EXISTING dispatchers keep
> running.** `isHalted()` is `false` with no configuration, so on a shipped install
> `ollama-catalog` and `dependency-review` still run on their schedule, the `metaCognition` audit timer
> is still armed, `selfCare`'s 120-second health sweep still runs (including `checkInstanceFailover`),
> and `marketIntel`'s two ticks still resolve outcomes and sync news. **Nothing master has today is
> removed by installing this** (FR-5, I11). Governing them with `isStopped()` — which is what revision
> pass 2 specified — **would have deleted five working behaviours on every install until master
> hand-created a file he had not been told about**, which is a regression wearing a fail-safe argument.
>
> **Halting them is a deliberate act with its own route:** `engage()` from the tray,
> `RAMA_AUTONOMY=stop`, or creating `<userData>/rama/autonomy.stopped.json` by hand — and **deleting
> that record is how the halt is undone**, which matters because `lift()` cannot succeed at all until
> master adds `system.suspend-autonomy`. **Both states are enumerated by name** in `statusText()` and
> the Autonomy panel (criterion 22d), so *"stopped"* never renders over five live timers.
>
> **The two sentences master should be able to read off the panel on a fresh install:** *"Rāma's
> self-maintenance loop is stopped — no allow-file at `<path>`; it is noticing nothing and proposing
> nothing."* and *"Still running on their own schedule: `ollama-catalog`, `dependency-review`, the
> metacognition audit, the 120-second health sweep, market outcome resolution and news sync. Stop all
> of it from the tray."*

**`lift()` cannot start it either**, and that is deliberate: `system.suspend-autonomy` is not in
`shared/capabilities.json` (a protected file this design does not touch), and `capability.can()`
returns `false` for an unknown capability for **every** tier including master. So **the only way to
allow autonomy on a shipped install is for master to create the file himself**, which is exactly the
guarantee §E.2.4 wants — the in-app lift is not a second route, it is a convenience that does not exist
yet.

**The literal thing to create:**

```
<userData>/rama/autonomy.allow
```
```json
{ "allowed": true, "by": "master", "at": "2026-02-14T09:31:04.000Z", "note": "why, in master's words" }
```

- On Windows `<userData>` is `%APPDATA%/<app name>`; `autonomyStop.cjs` resolves it through
  `app.getPath('userData')` when Electron is present and through an injected path otherwise, which is
  what keeps the module suite-testable (§E.2.2).
- `allowed` must be the boolean `true`. `"true"`, `1`, a missing key, a zero-byte file, invalid JSON, a
  directory at that path and an absent file **all mean stopped** (criterion 14).
- `by`, `at` and `note` are recorded and displayed, not enforced — a hand-written allow-file is master
  acting directly, and demanding a schema from him would be the stop refusing master rather than
  refusing Rāma.
- **Deleting the file stops everything again**, needs no running Rāma, and is the route §E.2.3 lists
  third precisely because it cannot be taken away.

**ONE file, not two — and revision pass 1 would have needed two** (review-2 finding 5).
`shared/autonomy-policy.json` **also ships absent**, and with it absent every class resolves to its
floor (§E.1.3). The floors are now the levels the design wants shipped — `research-network` L2,
`propose-question` L3, `revert-own-apply` **L4** — so **master creates the allow-file and nothing
else.** Revision pass 1 printed shipped levels that only a *present* policy file could produce while
`revert-own-apply`'s floor was L0, which meant a shipped install would have refused
`policy.require('revert-own-apply')` at `apply()` entry: **a master-approved `self-upgrade` could not
have been applied at all, and the automatic revert the AFTER-APPLY guarantee rests on was off.**
Criterion 21a is the row that proves it is on; criterion 6 asserts the floors with no policy file.

**The Autonomy panel states this state in full** rather than rendering an idle loop: *"Autonomy is
stopped — no allow-file at `<path>`. Rāma is noticing nothing and proposing nothing. Create that file
to allow it, or see SELF_UPGRADE.md §E.2.7."* **A stopped loop that looked like a running one would be
the badge defect (§E.2.6) in a new place.**

## E.3 The proposal record — shaped so an autonomous apply would need no schema change

Everything rides in `proposals.create`'s `meta`, which is free-form, persisted, and restored. **No
change to `proposals.cjs`.**

```js
{
  kind: 'self-upgrade' | 'self-upgrade-question',
  title, summary, risk, requiresRestart,
  changes: [ { action:'patch'|'create', path, content,
               author: 'template:<editId>',   // STAGE 3a — who wrote these bytes (FR-49)
               baseSha256: '<64-hex>' } ],    // the digest of the file the transform READ
                                              // [] for a question
  meta: {
    schema: 'self-upgrade/1',                 // the applier REFUSES an entry without this (§E.5.0)

    requirement: {                      // STAGE 1 — NOTICE
      fingerprint, class: '<policy classId>', what, why,
      measurement: { sensor, field, value, at },   // mandatory; no measurement, no finding
      fixable
    },

    research: {                         // STAGE 2
      sources: [ { ref, kind:'url'|'path'|'suite', retrievedAt, sha256, bytes,
                   claim, status:'read from source'|'unverified claim', attribution } ],
      said: [ ... ], unknown: [ ... ],
      offline: false, dropped: 0, completenessClaimed: false,
      queryParts: [ '<what>', '<sensor field name>' ]   // FR-51: what left the machine, recorded
    },

    authoring: {                        // STAGE 3a — NEW in revision pass 2 (FR-49)
      mode: 'template',                 // ∈ AUTHORING_MODES; 'model' is reserved and refused
      editId: 'add-export',             // the frozen EDITS entry that matched
      matchedOn: '<the finding.fixable substring the entry matched>',
      filesRead: [ { path, sha256 } ],  // exactly what the transform saw
      why: null                         // non-null when NO edit matched, and then changes[] is []
    },

    weighing: {                         // STAGE 3
      pros: [], cons: [], costOfDoingNothing: '<required, non-empty>',
      verdict: 'propose'|'needs-master-decision'|'hold'|'no-action',
      blastRadius: {
        files: [], dependents: [ { file, lines } ], dependentMethod: 'substring scan — over-reports, never under-reports',
        invariantsAdjacent: ['I9'], protectedTouched: [],
        suiteCoverage: { covered: true, suites: [] },   // DISPLAY-ONLY; recomputed at apply (§E.5.2)
        rollbackPoint: { kind:'file-snapshot',
                         dir,            // DISPLAY-ONLY. Never read. Re-derived at apply (FR-13a)
                         gitHead, treeClean,
                         files:[{path, existed, sha256, bytes}] }   // path ⊆ changes[].path, revalidated
      }
    },

    verification: {                     // STAGE 4 declares the plan (DISPLAY-ONLY once persisted);
      plan: [ { step:'node --check', target },   // STAGE 5 re-derives it and fills the result
              { step:'suite', target }, { step:'audit' }, { step:'build', needed:false, run:false } ],
      planDrift: false,                 // true when the re-derived plan differs from the approved one
      result: null                      // -> { verified, reverted, revertAttested, causeId, cause,
                                        //      remedy, steps:[{step,target,exit,ms}] }   (§E.5.2a)
    },

    policy: { classId, effectiveLevel, required: 'L3', blockedBy: null },
    autonomy: { appliedBy: 'master', autonomousApply: false },   // the field that would change, and nothing else
    supersedes: null,
    learned: null                       // filled on a corrected re-proposal
  }
}
```

**`result` is where the verdict lives, and `status` is not.** `proposals.apply` sets `applied` whenever
the applier resolves, and §E.5.2a makes the applier resolve even for a reverted change — so
`meta.verification.result.verified` is the field that means success. `forStorage()` keeps `meta` whole
for every status (only `changes[].content` is dropped once decided), which is why the verdict is
mirrored **here** rather than relying on `p.result` alone. Criterion 45a forbids the renderer reading
`status` alone for this kind.

**Why this needs no schema change for an eventual autonomous apply.** The only field that would differ
is `autonomy.autonomousApply: true` and `autonomy.appliedBy: 'rama'`. Everything an autonomous apply
would need to justify itself — the measurement, the sources, the weighing, the computed blast radius,
the declared verification plan, the rollback point — **is already required and already populated on
every record, today, while nothing is autonomous.** The record is not reserved space for a future
feature; it is the dossier master reads now, which happens to be exactly the dossier an autonomous
decision would have to produce. That is the difference between designing for an unlock and promising one.

**Two constraints the inventory imposes.** (i) `summarise()` sends `meta` **whole** to the renderer, so
research bodies are stored as `sha256` + a bounded excerpt, never full documents — criterion 39 caps a
worst-case dossier at 64 KB. (ii) `DURABLE_STATUSES` drops `changes[].content` once a proposal is
decided, so **the record is not the rollback source**; `blastRadius.rollbackPoint` points at an
independent byte snapshot (§E.6).

## E.4 The five-stage loop, and the sixth module that feeds it

Each stage is a named module with one entry point, a pure core, and injected io. The scheduler task
`self-upgrade-review` (daily, `intervalMs: DAY`, `capability: 'self-modify.view'`, matching
`dependency-review`) runs them in order and stops at the first refusal.

**The order is NOTICE → RESEARCH → AUTHOR → WEIGH → PROPOSE → AFTER-APPLY.** The five named stages of
the brief are unchanged; **AUTHOR (§E.4.2a) is the producer of the diff WEIGH weighs**, and it sits
before WEIGH because a blast radius cannot be computed for a change that does not exist yet. Revision
pass 1 injected `diff` into `weigh()` as io and **no module produced it** (review-2 finding 1) — the
loop could notice, research, weigh, propose, apply and revert, and nothing wrote the patch.

**The six stage entry points — `collect`, `gather`, `author`, `weigh`, `file`, `applyWith` — are all
`async`**, and that is a contract rather than an accident (review-1 finding 23): `analyzeImpact`, the suite runs, the git
reads and `fetchText` are all asynchronous, so a synchronous signature would be a lie the first caller
discovered. **The pure synchronous cores are named in the same breath, because their synchronicity is
load-bearing: `toProposalDef`, `analyse`, `fingerprint`, `effective` and `isStopped`.** `isStopped()`
especially — criterion 16 requires it answerable from `before-quit` and from inside a failing boot,
which an async answer could not do.

### E.4.0 Admission — per stage, from a declared table

*Added in the revision pass. NFR-5 claimed `admit()` before every stage while only `gather()` required
it, which left the two most expensive stages unadmitted (review finding 14) — and an unadmitted heavy
stage is how a background loop becomes the reason master's machine is slow.*

```js
const ADMISSION = Object.freeze({
  'upgrade-notice-suites': { ramMB: 128,  priority: PRIORITY.BACKGROUND },
  'upgrade-research':      { ramMB: 64,   priority: PRIORITY.BACKGROUND },
  'upgrade-author':        { ramMB: 64,   priority: PRIORITY.BACKGROUND },
  'upgrade-weigh':         { ramMB: 64,   priority: PRIORITY.BACKGROUND },
  'upgrade-verify':        { ramMB: 512,  priority: PRIORITY.BACKGROUND, withBuild: 1024 },
});
const ADMISSION_EXEMPT = Object.freeze([
  'selfModel.limits', 'metaCognition', 'rendererAudit', 'dependencyAdvisor', 'astEngine',
]);   // pure in-process reads, exempt BY DECLARATION so the exemption is a decision, not a gap
```

| Stage / work | Label | `ramMB` | Why that number |
|---|---|---|---|
| NOTICE's **suite sensor** (spawns `node scripts/verify*.cjs`) | `upgrade-notice-suites` | **128** | A spawned Node process with a suite's fixtures loaded. `admit()`'s own default is 128, so this is the house figure for "one more Node process", not an invention. |
| NOTICE's other six sensors | *exempt* | — | In-process reads of data already computed for another reason. Declared in `ADMISSION_EXEMPT`. |
| RESEARCH | `upgrade-research` | **64** | Bounded by `http.cjs`'s `MAX_RESPONSE_SIZE` and ≤ 20 sources. |
| AUTHOR | `upgrade-author` | **64** | Reads each target file whole and holds the transformed copy in memory; bounded by §E.9's 1 MB-per-file cap and ≤ 4 MB per proposal, so 64 MB is the same house figure as WEIGH. |
| WEIGH | `upgrade-weigh` | **64** | `analyzeImpact` walks the tree six deep reading files whole; bounded but not free. |
| Stage 5 **verification** | `upgrade-verify` | **512**, or **1024** when the plan carries a `build` step | `node --check` plus `verifyInvariants` plus `verifyLoyaltyTripwire` plus whatever `suiteCoverage` named; a `vite build` is the heaviest thing this design can start, and asking for 512 when it needs a gigabyte would make the admission decorative. |

**All five at `PRIORITY.BACKGROUND`** — the band `resourceOrchestrator`'s own comment reserves for
*"evolution, maintenance, pre-fetching"*. **None at `CRITICAL`**: master's work outranks Rāma's
self-maintenance by construction, and a loop that could claim `CRITICAL` would be a loop that could
make the machine unusable while reducing master's burden on paper. **On `allow: false` the stage
returns without doing its work and reports the orchestrator's `reason` verbatim** — never paraphrased,
because the reason already names the measured pressure (`"Insufficient free RAM for upgrade-verify:
312MB free, needs 512MB"`), and a paraphrase would lose the number. Criterion 31 asserts five
admissions plus the exemption list.

### E.4.1 Stage 1 — NOTICE: `upgradeNotice.cjs`

```js
notice(def)            // -> Finding; THROWS if def.measurement is absent or malformed
collect(sensors)       // -> { findings: Finding[], reason, sensorsRead, sensorsAbsent }
fingerprint(finding)   // -> 64-hex
ADAPTERS               // frozen: sensorId -> (reading) => ({editId, params}) | null
```

**The rule that makes this trustworthy: a finding without a `measurement` does not exist.** `notice()`
throws rather than returning an error object, because this is a programming-error boundary rather than a
runtime condition — a caller that invents a requirement is a bug, not a degraded input. `measurement`
requires `{sensor, field, value, at}`; `sensor` must be one of the seven declared ids; `at` must parse
as a date. **Nothing invented by a model can enter the loop**, and nothing needs a model to produce a
finding: every sensor below is already computing its value for another reason.

| Sensor id | Reads | Yields a finding when |
|---|---|---|
| `selfModel.limits` | `describe(probes).limits[]` | `fixable !== null`. `{what, why, source, fixable}` maps **field-for-field** onto the requirement — this is why §B.3 calls it the natural input. |
| `dependencyAdvisor` | `review(rows).actionable[]`, where **`rows` is `registrySources.collect({pinned, getJson, postJson}).rows`** over `package.json`'s `dependencies` + `devDependencies` — exactly how `main.cjs`'s `runDependencyReview` (line 579) already builds them | `recommend !== 'no action'`. Class is `dependency-change`. **`urgency`/`recommend` are carried, never recomputed.** **The row names where `rows` comes from because `review()` with no argument returns `{rows: [], actionable: []}`** — FR-19 originally wrote `review().actionable`, which can only ever be empty (review-2 finding 19). **Needs `research-network` at L2**, since `collect` reaches the registry; offline it yields `sensorsAbsent: ['dependencyAdvisor']`, not an empty clean result. |
| `astEngine` | `analyzeFile(p).issues`, `qualityScore` | an issue is reported, or the score drops below a declared threshold. |
| `suite` | a `scripts/verify*` exit code + the failing **row name** | non-zero exit. The row name is the `field`, so two different red rows are two findings. |
| `metaCognition` | `profileFor(action)` | a `failures/n` ratio over a declared threshold on an action with `n` above a minimum. |
| `engineDiagnosis` | `aiProcess.diagnoseFailure()` | `reason` is anything other than the healthy case. **Measured: it returns `{reason, remedy, silent?}` and carries NO `causeId`** — so nothing "carries straight through", and `breakageAnalysis` maps its branches onto ids itself. **§E.5.3a is that mapping, and it is the honest version of what the earlier draft claimed** (review finding 8). |
| `rendererAudit` | `auditRenderer`'s unresolved bridge calls / destructures | any unresolved entry. |

#### The remedy is STRUCTURED DATA, and `fixable` prose is never parsed

*Added in revision pass 3 (FR-56, review-3 finding 4). **This is the correction that tells the truth
about how much the loop can actually author.***

Revision pass 2 declared the author's `EDITS` entries as matching *"a `fixable` naming 'export X from
Y'"* and **said nothing about how parameters are extracted from prose.** Measured, **all seven
`fixable` strings in `selfModel.cjs` 206–266 are sentences written for master to read** —

> *"install Ollama and pull a model — tier 1 then works offline and free"* ·
> *"unlock the vault, or add a provider key under Models"* ·
> *"open StockMind — the engine starts on first use"* ·
> *"exogenous data is the untested lever — news tone and derivatives, not another model type"* ·
> *"record the request text — which has a privacy consequence master must accept first"* ·
> *"build on a machine that can run 7za, or install a system 7-Zip"* ·
> *"use Rāma — the record accumulates from ordinary use"*

— **and not one is in a shape any transform could consume.** So the sensor §B.3 calls *"the natural
input to NOTICE"* had **zero reachable edits**, `propose-source` / `dependency-change` /
`build-repair` described a path nothing could take in production, and **criterion 41's diff assertion
was satisfiable only by a synthetic fixture.** A string written for a human is not a parameter list,
and parsing it would have been exactly the model-shaped guessing FR-18 forbids, performed by a regex
instead of a model.

**The decision: `finding.remedy = {editId, params} | null`, produced by a FROZEN per-sensor `ADAPTERS`
table. The prose `fixable` stays, untouched, as the display and the question body.**

| Sensor | Adapter | Reachable `editId`s |
|---|---|---|
| `selfModel.limits` | **`null` BY DECLARATION** — its remedies are human instructions, and six of the seven are things only master can do (install a daemon, unlock a vault, change machine, accept a privacy cost). **Declared, so the absence is a decision rather than a gap.** | **none** |
| `dependencyAdvisor` | `(row) => ({editId: 'pin-version', params: {name: row.name, version: row.target}})` | **`pin-version`** |
| `astEngine` | `null` — an issue is a location and a severity, not a remedy. | none |
| `suite` | `null` — a red row names what failed, not what to write. | none |
| `metaCognition` | `null` | none |
| `engineDiagnosis` | `null` — its `remedy` is prose for master (*"install the engine's Python packages"*). | none |
| `rendererAudit` | `null` — an unresolved bridge call needs a `contextBridge` nesting edit, which no declared transform expresses. | none |

**`upgradeAuthor.author` refuses unless `remedy.editId ∈ EDITS` and `params` satisfy that entry's
preconditions** — so there is no path from prose to a change body at all.

**And the honest number is printed, not predicted** (criterion 90a): **six of seven sensors can reach
no edit, and three of four `EDITS` entries have no producing adapter.** Stated plainly: **today this
loop can author exactly one kind of change — a dependency version pin — and every other finding
produces a question carrying a researched remedy in words.** That is a much narrower claim than
revision pass 2's and it is the true one; it is also the number that makes §I.9's question
answerable, because the cost of template-only authoring is not *"fewer patches"*, it is *"one
`editId`"*.

**Fingerprint:** `sha256(classId + '\0' + sensor + '\0' + field)`. **Deliberately excluding `value`** —
a drifting number (a quality score sliding 71 → 70 → 69) must not produce three proposals for one
defect. Criterion 24 asserts a changed value keeps the fingerprint and a changed field does not.
Deduplication is against `proposals.list({status:'pending'})` and against an `approved`-but-unapplied
set, so the loop never files a second copy of something already in front of master.

**Absence is not a finding.** No sensor reporting anything yields `{findings: [], reason: 'no sensor
reported anything'}`, and `sensorsAbsent[]` names the sensors that could not be read at all —
**including, per package, every entry in `registrySources.collect(...).failures[]`**, which revision
pass 2 dropped on the floor (review-3 finding 15): a package whose registry lookup failed is a package
**not checked**, and letting it fall out of the loop silently is `unchecked` rendering as
`no-advisory-found`, the one dishonesty `dependencyAdvisor`'s own header calls the most tempting. The
`unchecked` ≠ `nothing-found` distinction (B.2 habit 1), because *"nothing was read"* must never render
as *"nothing happened"*. Criterion 26.

### E.4.2 Stage 2 — RESEARCH: `upgradeResearch.cjs`

```js
gather(finding, { fetchText, readFile, runSuite, admit, now }) -> ResearchRecord
```

**Three fields, all mandatory: what was read, what it said, what is still unknown.**

- **`sources[]`** — each `{ref, kind, retrievedAt, sha256, bytes, claim, status, attribution}`.
  `sha256` is over the bytes actually read, so a later session can tell whether the source changed under
  it. A source missing `retrievedAt` or `sha256` is **dropped and counted** in `dropped`, never silently
  kept (criterion 29).
- **`said[]`** — the extracted claims. `status: 'read from source'` only when the bytes were read in
  this run. Everything from commentary is `status: 'unverified claim'` **with an attribution**, exactly
  as `dependencyAdvisor` tags its `signals[]`: *"an issue thread saying a release is broken is worth
  surfacing and worth attributing; it is not a fact about the package."*
- **`unknown[]`** — **mandatory, and the honest field.** If the researcher believes nothing is unknown
  it must set `completenessClaimed: true`, which `weigh()` surfaces as a **con** reading *"research
  claims nothing is unknown, which is itself a claim"*. Criterion 27. A record with empty `sources`
  **and** empty `unknown` is refused outright: a research record that read nothing and wonders nothing
  is not a record.

**Network.** `fetchText` is injected and in production is `lib/http.cjs`'s `get`/`getHuman` (I9).
Criterion 30 is a source-shape assertion that **no new file contains `https`, `http`, `fetch`, `axios`
or `node:https`**. Before the first fetch, `admit({ramMB: 64, label: 'upgrade-research', priority:
PRIORITY.BACKGROUND})` (I10); on `allow: false` the stage returns with the orchestrator's `reason`
**verbatim** and `sources[].status: 'unchecked'` — not a failure, a declared non-read.

**Offline is a first-class outcome.** The fetcher throwing yields `offline: true`, `unchecked` sources,
a non-empty `unknown[]`, and — the specific trap Section 124 §5(a) named — **no remedy text naming a
network-requiring action.** `researchPlan`'s existing bug was offering `models:refresh-catalog`, *a
remedy that requires the network*, to an offline user. Criterion 28 asserts the absence.

**RESEARCH is itself an outbound text path, so it calls the gate, and WHAT IT MAY CARRY IS DECIDED
HERE** (FR-51, review-2 finding 13). The query is derived from the finding, and a finding carries
`what`, `why`, `fixable` and — for the `suite` and `engineDiagnosis` sensors — **real error text out of
Rāma's own source.** That is a new text-egress path this design introduces, it belongs in §E.7.4's
table and its count, and the classification question it raises was unasked: *Addendum A is about what
is recorded about **master**; an invariant-breach message or a failing row name is about **Rāma**.*

```js
// upgradeResearch.gather, before the FIRST fetchText — never between fetches.
// EVERY PART IS CLASSIFIED AT CONSTRUCTION (FR-51a), so the gate can actually refuse:
const queryParts = [
  { text: finding.what,                    classification: 'shareable' },
  { text: finding.measurement.field,       classification: 'shareable' },
];
// Anything derived from measurement.value, file contents or a stderr/stdout excerpt is constructed
// as { text, classification: 'local-only' } — so if a later edit reaches for one, the gate REFUSES
// instead of passing it as an unclassified bare string.
const refusal = classificationGate.gateOutbound(queryParts, 'cloud');
if (refusal) return { ...offlineShape, unknown: ['research blocked: ' + refusal.error] };
```

> **Why the parts are classified rather than passed as bare strings** (FR-51a, review-3 finding 10).
> FR-33b's declared default is that **a bare string PASSES.** Revision pass 2 built `queryParts` as
> two bare strings — so `gateOutbound` here **returned `null` by construction and could never have
> refused anything**, while the prose credited it with enforcing FR-51. By this document's own rule,
> *"a verification step that cannot fail is not a verification step."* Classifying at the source makes
> criterion 93 a **positive** case — a part built from `measurement.value` is **REFUSED**, not merely
> absent — which is a test that can go red. **And for the seven pre-existing call sites (§E.7.4 rows
> 1–7) the parts stay unclassified master-supplied query text, so those calls are declared AUDIT
> POINTS and the real enforcement there is the construction of the query plus criterion 54a's counted
> assertion.** Both statements are printed in §E.11's residual list, because crediting a gate with a
> refusal it cannot issue is how a design acquires a guarantee nobody is holding.

**The rule: a query may carry the finding's `what` and a sensor's FIELD NAME. It may not carry
`measurement.value`, a file's contents, or a stderr/stdout excerpt.** The reason is not squeamishness:
a stderr excerpt from a failing suite can contain master's paths, a module's internals and sometimes
his data, and *"search the web for Rāma's own error text"* is a decision master has not been asked to
make. `queryParts` is **recorded in the dossier** (§E.3's `research.queryParts`) so what left the
machine is auditable, and criterion 93 asserts the excluded fields never appear in the query string.
**Offline, nothing leaves and the record says so** — which is also the path this takes when the gate
refuses, because a refused research run is an `unchecked` source, not a failure.

### E.4.2a Stage 3a — AUTHOR: `upgradeAuthor.cjs`

*Added in revision pass 2. **Nothing in revision pass 1 produced `changes[].content`** — `weigh()`
received `diff` as injected io, `propose()` carried it, the applier wrote it, and no module, io binding
or existing function made it (review-2 finding 1). A class that permits filing a diff is empty if
nothing authors one, so `propose-source` at L3 meant nothing and `build-repair` named a repair no
component could express.*

```js
async author(finding, research, { readFile, policy, stop, admit, now })
  -> { changes: [ {action, path, content, author, baseSha256} ], mode, editId, matchedOn, filesRead, why }
```

**The decision, stated with its consequence: the author is TEMPLATE-ONLY in this tranche. No model
writes Rāma's source.** Three options were live — ship a questions-only loop with no author at all;
add a model-authored stage; or restrict changes to a declared table of mechanical edits. **The third
is chosen**, because the first makes `propose-source`, `dependency-change` and `build-repair` three
classes describing a path nothing can take, and the second decides two things master has not been asked
(whether a model rewrites Rāma's source, and whether that source text leaves the machine) inside a
tranche whose entire point is that the fence holds.

**`EDITS` — a frozen table, and `build-repair` means what this table can express.**

```js
const AUTHORING_MODES = Object.freeze(['template']);   // 'model' is RESERVED and REFUSED (§I.9)
const EDITS = Object.freeze([ /* each: {editId, params, appliesTo, transform, preconditions,
                                        verifiableBy, producedBy} */ ]);
```

> **AN EDIT IS SELECTED BY `remedy.editId`, NEVER BY MATCHING PROSE** (FR-56, review-3 finding 4).
> Revision pass 2's table had a column reading *"Matches a `fixable` naming 'export X from Y'"* and
> **no matching grammar was declared anywhere, nor any rule for extracting parameters from a
> sentence.** Measured, every `fixable` string in `selfModel.cjs` is prose written for master, so the
> column described a match that could never occur. **The entry now declares a `params` SCHEMA, and the
> `{editId, params}` arrives from `upgradeNotice.ADAPTERS`** (§E.4.1). A finding whose `remedy` is
> `null` — which is every `selfModel` finding, **by declaration** — produces no diff and files a
> question. **`producedBy` names which adapters can reach the entry, and the suite prints it**, so
> *"declared but unreachable"* is a visible state rather than a discovery.

| `editId` | `params` schema | Transform | Preconditions — a violation yields `changes: []`, never a partial edit | `producedBy` | Verified by |
|---|---|---|---|---|---|
| `pin-version` | `{name: string, version: string}` | Replaces one `"name": "<range>"` value in `package.json` with the exact version | `version` has no `^`/`~`/range characters (I12); **`name` is not in `dependencyAdvisor.SENSITIVE`** — read from the export, never restated — else the verdict is `needs-master-decision`; `name` is present exactly once in `dependencies` + `devDependencies` | **`dependencyAdvisor`** | `node --check` is meaningless for JSON, so the plan runs `JSON.parse` + the dependency-count row of criterion 66 |
| `add-export` | `{file: string, name: string}` | Adds one name to the single `module.exports = { … }` object literal | Exactly one such literal in the file; the name is defined in the file; the name is not already exported | **none today** | `node --check` + a require-and-read assertion in the plan |
| `add-array-member` | `{file: string, arrayName: string, member: string}` | Appends one string literal to the named `const <arrayName> = [ … ]` | Exactly one `const <arrayName> =` array literal; `member` not already present; every existing member is a string literal | **none today** | `node --check` + the suite `suiteCoverage` names |
| `replace-literal` | `{file: string, from: string, to: string}` | Replaces one exact occurrence | **Exactly one** occurrence of `from` in `file` — zero or more than one refuses | **none today** | `node --check` + `suiteCoverage` |

**`pin-version` is listed first because it is the only entry anything can currently reach**, and the
ordering is the honest one: the other three are **the declared vocabulary for later adapters**, kept
because the table is additive (I11) and removing them would make a future edit a new concept rather
than a new row — but **the suite prints `editIds with no producing adapter: 3 of 4` on every run**
(criterion 90a) so nobody reads the table as a description of current capability. *A table of four
transforms that one sensor can address is not four capabilities.*

**Four properties make this trustworthy, and each is a suite row:**

1. **The content is DERIVED, never generated.** Every transform reads the current bytes and returns a
   function of them, so `changes[].content` is reproducible: criterion 89 re-runs the transform over the
   same input and compares digests. This is what *"nothing invented by a model"* (FR-18) means once the
   loop has a change body, and it is why the author needs no network and no `chatCompletion` — a
   source-shape assertion proves `upgradeAuthor.cjs` requires neither `modelRouter` nor
   `codeRegenEngine`.
2. **`baseSha256` travels with the change.** The digest of the file the transform read is recorded, and
   **the applier refuses if the file on disk no longer matches it** (§E.5.0 check 6,
   `causeId: 'base-drift'`). A patch authored against bytes that have since moved is the quiet
   corruption case this design would otherwise have shipped: the change would still apply cleanly to a
   file it was never computed from.
3. **No remedy is a first-class outcome, not an empty diff.** A finding whose `remedy` is `null`
   returns `{changes: [], why: 'no declared edit produces this remedy'}`; a `remedy.editId` present in
   `EDITS` whose `params` fail the preconditions returns
   `{changes: [], why: '<editId> preconditions not met: <which>'}`; and in both cases the proposer
   files a **question** carrying the researched remedy in words. **This is the honest half of the
   template-only decision, and revision pass 3 put a number on it: six of the seven sensors declare
   `null`, so this is the COMMON path, not the edge case** (criterion 90a, review-3 finding 4). The
   loop says so instead of manufacturing something.
4. **The gate is the policy, at L3.** `policy.require('author-change')` must pass to emit any content;
   at the shipped floor L1 it does not, so **a shipped install authors nothing** — the same shape as
   `propose-source`, which is why a diff requires both classes raised (§E.1.5, criterion 41).

**The unlock, designed and not taken.** `AUTHORING_MODES` is the single frozen constant that would
change for a model-authored patch, exactly as `L5` is for autonomous application. The two conditions
are specified **now** so a later session does not get to invent them: `destinationOf(modelInfo(id)).dest
=== 'local'` is required, so Rāma's own source is never shipped to a cloud model to be rewritten; and
`weighing.cons` gains a mandatory entry reading *"the patch was written by `<modelId>`, not measured"*,
because a weighing that does not say which of its terms is unmeasured is a weighing that misleads.
**§I.9 asks master; this design refuses it.**

### E.4.3 Stage 3 — WEIGH: `upgradeWeigh.cjs`

```js
async weigh(finding, research, changes, { guard, selfGoverningPaths, analyzeImpact, listSuites, git, now, admit })
  -> Weighing
```

**`changes` is a positional argument from `upgradeAuthor`, not an injected `diff`** (review-2
finding 1). The earlier signature took `diff` as io, which read as *"someone hands this in"* — and
nobody did. A weighing over `changes: []` is legitimate and common: it is the question path, and
`blastRadius.files` is then `[]` with the verdict still reachable.

**`guard` replaces the earlier `protectedFiles` argument** (review findings 9 and 10): the injected
thing is now the **guard module** — `{inspectChanges, PROTECTED_FILES}` — and `weigh()` calls
`guard.inspectChanges(changes)` rather than comparing against a list it was handed. The injection still
makes the suite able to monkey-patch, and **the list is read at call time, never captured at module
load**, so a long-lived process picks up a `PROTECTED_FILES` change without a restart.

`pros[]`, `cons[]`, and **`costOfDoingNothing` as a required non-empty string** — a weighing without it
throws (criterion 32). It is required because it is the term that is always omitted and always decides:
`dependencyAdvisor` already encodes the one case where it dominates (*"staying put carries a security
one"*), and without the field a weighing silently defaults to "doing nothing is free".

**The blast radius is COMPUTED. Six parts, each with a stated method and a stated limit.**

| Part | How it is computed | Limit, stated |
|---|---|---|
| `files` | The diff's `changes[].path`, verbatim. | Exact. |
| `dependents` | `astEngine.analyzeImpact(symbol, repoRoot)` for each exported symbol the diff touches, **then normalised to repo-relative POSIX paths before entering the record.** | **`analyzeImpact` is a substring scan** (`code.includes(functionName)`), not a reference resolver. It matches comments, strings and unrelated identically-named symbols. **It therefore OVER-reports and never UNDER-reports, which is the safe direction for a blast radius** — and the record carries `dependentMethod` saying so, so nobody later mistakes the list for a call graph. **It also returns `{file: path.join(repoPath, …)}` — absolute — while `blastRadius.files` is repo-relative, so without the normalisation the dossier would mix two path conventions and persist master's machine path into the ledger** (review finding 24). Criterion 33. |
| `invariantsAdjacent` | A declared `INVARIANT_FILES` map, path-prefix → I-numbers. | A map can drift from reality, so **every entry is asserted to name a path that exists on disk AND to be mentioned in `scripts/verifyInvariants.cjs`** (criterion 34). A map the suite does not check is the `CAPABILITY_AXES` defect in a new costume. |
| `protectedTouched` | **`loyaltyGuard.inspectChanges(changes).refused`** — the guard's own matcher, called at weigh time; **not a set intersection, and not a restated list.** | **A plain `intersect()` under-reports against the guard** (review finding 9): `inspectChanges` normalises (`\`→`/`, strips `./`, lower-cases) and then matches by **equality, `/`-suffix, or basename-plus-dirname** — so `'./electron/lib/proposals.cjs'` and an absolute path to it are refused by the guard and **missed** by set membership. Calling the guard means the loop's answer and `assertChangesSafe`'s answer cannot diverge, which is the whole reason the "unreachable `LoyaltyViolation`" claim below holds. Criteria 4, 4a, 4b. |
| `selfGoverningTouched` | `SELF_GOVERNING_PATHS` from `autonomyPolicy` — **one frozen constant, read not restated.** | Separate from `protectedTouched` because the consequence is different: a protected file in range **downgrades to a question**, while a self-governing path in range is **refused outright** (§E.4.4 refusal 5). Rāma may ask master to change the loyalty covenant's neighbourhood; it may not ask for its own promotion. Criterion 19a. |
| `suiteCoverage` | Which `scripts/verify*.cjs` mention a changed path or its basename. | A textual association, not proof of coverage. `covered: false` is a **con, not a blocker** — refusing every uncovered change would refuse most useful ones, and the honest move is to tell master the change is unguarded. **And the persisted value is DISPLAY-ONLY: the applier RECOMPUTES it from the re-derived change set** (§E.5.2, criterion 82b), because a `suite` step chosen from persisted `meta` is the untrusted input the re-derivation exists to avoid. The scan is cheap and deterministic, so recomputing costs nothing and a difference is reported as `planDrift`. |
| `rollbackPoint` | §E.5.1. `git rev-parse HEAD` + `git status --porcelain` + a per-file `{existed, sha256, bytes}` of current state. | **Dirty tree ⇒ `null`.** **`dir` is recorded for display and NEVER READ** — the applier derives it from `userDataRoot` and a validated `proposal.id` (FR-13a, §E.5.1). **`files[].path` must be a subset of `changes[].path`** and is revalidated at apply time; a snapshot naming a file the change does not touch is refused. |

**Two verdicts are forced, not judged:**

- **`protectedTouched` non-empty ⇒ `needs-master-decision`, unconditionally**, and **no diff-bearing
  proposal is created** (§E.4.4). `proposals.create` would throw anyway via `assertChangesSafe`, but
  relying on that would mean the loop's only protection against proposing a covenant edit is an
  exception from another module. Pre-empting it is `loyaltyGuard`'s own reasoning: *a proposal that
  targets the loyalty covenant must never exist, because sitting in the queue with an Approve button
  next to it invites master to authorise something no authority covers.*
- **`rollbackPoint === null` ⇒ `needs-master-decision`.** `localUpdateEngine` already *"refuses on a
  dirty tree unless forced"*; the same rule applies with more force here, because a change with no
  recorded way back cannot honour FR-28.

Verdicts: `propose` · `needs-master-decision` · `hold` (research surfaced a credible negative signal —
`dependencyAdvisor`'s own `hold`) · `no-action`. All four reachable from fixtures (criterion 37).

### E.4.4 Stage 4 — PROPOSE: `upgradeProposer.cjs`

```js
toProposalDef(finding, research, weighing, policyView) -> def      // pure
file(def, { ledger, policy, stop })                     -> { filed, id } | { ok:false, ... }
```

**The applier is wired by `upgradeApplier.register(ledger, io)`, not by the proposer** (FR-57): the
closure that `registerApplier` receives has to carry `io`, because `proposals.cjs` 235 calls
`applier(p, opts)` with two arguments and that file is protected (§E.5.0).

**Two kinds, arriving through the extension point:**

| kind | Carries | Applier |
|---|---|---|
| `KIND.DIFF` = `'self-upgrade'` | A diff. Requires `propose-source` (or `dependency-change`/`build-repair`) at **L3**. | `upgradeApplier.applyWith`, wired by `upgradeApplier.register(ledger, io)` — a closure, because `proposals.cjs` 235 calls `applier(p, opts)` with **two** arguments (FR-57) |
| `KIND.QUESTION` = `'self-upgrade-question'` | `changes: []` — asks master something. | **None. Deliberately inert.** |

**The two kinds are a frozen export, not two literals** (review finding 26):
`upgradeProposer.KIND = Object.freeze({DIFF: 'self-upgrade', QUESTION: 'self-upgrade-question'})`.
`proposals.KINDS` is a plain object **inside a protected file**, so these two have no home there and
this design does not give them one — which is exactly the kind of tidiness a later session might "fix"
by editing `proposals.cjs`. Declaring `KIND` here gives the renderer and every `list({kind})` filter
something to import, and **`stats().byKind` reports both without any `KINDS` entry**, because `stats()`
counts what is in the ledger rather than what is declared. Criterion 85 asserts the export, the absence
of the literals in `Evolution.jsx`, and `byKind`'s behaviour.

**`proposals.cjs` is not modified.** `registerApplier(kind, fn)` is `appliers.set(kind, fn)` on an
unconstrained Map, and `create()` accepts any `kind` string — so a new kind is a call, not an edit.
Criterion 42 compares `proposals.cjs`'s sha256 before and after the whole change.

**The question kind having no applier is ASSERTED, not assumed** (criterion 43). Section 124 found
`DEPENDENCY` inert *"only because NO APPLIER IS REGISTERED — correct BY ACCIDENT"*, and the remedy it
chose was to assert it. Same here: `proposals.apply` on a question returns *"No applier registered for
kind"*, and the suite proves it rather than trusting that nobody will register one later.

**Refusals, before anything is filed — and READ §E.5.0 WITH THIS LIST, because every refusal here is
a refusal in ONE CALLER** (FR-50, review-2 finding 3). This design's own doctrine is *"chokepoint, not
caller — gating six callers leaves the seventh"*, and the seven refusals below all live inside
`upgradeProposer.file()`. **The ledger's real entry point is `proposals.create`, which consults none of
them, and `proposals:create` is a renderer-reachable IPC handler gated only on `self-modify.view` —
tier 1 — that passes `def` through with `meta` intact.** `loyaltyGuard.assertChangesSafe` still fires
at creation, so the seven protected files are safe; but `shared/autonomy-policy.json` and
`shared/loyalty-tripwire.json` are **not** in `PROTECTED_FILES`, so a hand-built entry naming the
policy file could sit in the queue under an Approve button — *the exact hole review-1 finding 5 was
raised to close, closed in the proposer and left open at the ledger.* **`proposals.cjs` is protected
and does not change, so the enforcement moves to §E.5.0: the proposer's refusals bind the LOOP, the
applier's validation binds the KIND.**

1. `stop.isStopped()` → `{ok: false, stopped: true}`.
2. `policy.require(classId)` blocked → **downgrade to a question** carrying `policy.blockedBy`, rather
   than filing nothing. **This is the shipped default** (§E.1.5, criterion 40): master still gets the
   researched dossier; he just gets it as a question. Filing nothing would hide a measured defect
   because of a policy level, which is the wrong failure.
3. `weighing.verdict === 'needs-master-decision'` → question.
4. `weighing.verdict === 'hold' | 'no-action'` → nothing filed, reason recorded in the run log.
5. **Any `changes[].path`, or any `remedy` text, naming a member of
   `autonomyPolicy.SELF_GOVERNING_PATHS` → refused outright, not downgraded.** The list is
   **`shared/autonomy-policy.json`, `electron/lib/autonomyPolicy.cjs`, `electron/lib/autonomyStop.cjs`,
   `shared/loyalty-tripwire.json`** — and **the DATA FILE is the important addition** (review finding
   5). The earlier draft named the two modules and the allow-file but not the policy data file, which
   sits under the repo root and is the one lever that raises a class: a proposal raising
   `propose-source` from L1 to L3 would have been a one-key JSON diff sitting in the queue with an
   Approve button next to it. **Refused outright rather than downgraded to a question**, because a
   question Rāma files asking to be promoted is still Rāma asking to be promoted — and master raising a
   class should start from his own reading of §I.4, not from a request. FR-14/FR-8. Criteria 19 and
   19a plant this and require the row to go RED if a path is removed from the constant.
6. Duplicate fingerprint already `pending`/`approved` → nothing filed.
7. Rate limit (§E.5.4) → `{suppressed: 'rate'}`.

**ONE proposal, not twenty.** `dependencyAdvisor`'s reasoning transfers directly: *"twenty separate
approvals is a queue master will stop reading, and the decisions are related."* Findings sharing a
`classId` and a sensor are batched into one entry whose dossier carries each requirement separately.

**Batch approval with a per-item decision — the mechanical guarantee.** `proposals.approve(id, user)`
takes **one id** and writes **one audit row**. The design rule is therefore stated as an absence:
**no IPC channel accepts an array of proposal ids.** The renderer's *"Approve selected"* control loops
`window.rama.proposals.approve(id, user)` over the checked items, awaiting each, and renders a per-item
result row including partial failure. Criterion 44 asserts no `ids`/array parameter exists on any
approve channel and shows the renderer looping.

> **Why the absence rather than a rule inside a batch handler.** If an array channel existed, a future
> caller could use it and record one decision for many items; the only durable guarantee is that the
> capability to do so is not present. This is the same reasoning as `claimGate`'s asserted absence of a
> score and `loyaltyCore`'s absent accessor: **the strongest guarantee available in JavaScript is that
> the function does not exist.**

## E.5 Verification, rollback and breakage analysis — Stage 5

### E.5.0 The applier's entry validation — the chokepoint for the KIND

*Added in revision pass 2 (FR-50, review-2 finding 3). **Every §E.4.4 refusal was bypassable**, because
the proposer is a caller and `proposals.create` is reachable from the renderer at tier 1 with `meta`
passed straight through. `proposals.cjs` is protected and must not change, so the one component this
design owns that **writes source** has to be the one that refuses.*

**ONE SIGNATURE, and it is the one the ledger can actually call** (FR-57, review-3 finding 5):

```js
// electron/lib/upgradeApplier.cjs
function register(ledger, io) {                       // io closed over HERE, once, at wiring time
  ledger.registerApplier(KIND.DIFF, (proposal, opts) => applyWith(io, proposal, opts));
}
async function applyWith(io, proposal, opts) { /* … */ }     // EXPORTED, for the suite
module.exports = { register, applyWith, revert, KIND };
```

> **Measured: `proposals.cjs` 235 invokes `await applier(p, opts)` — TWO arguments.** So a registered
> applier **cannot** receive a third injected parameter, and NFR-2's injection seam did not exist for
> this module. Revision pass 2 gave three mutually incompatible signatures across §E.5.0
> (`apply(proposal, io)`), §E.5.1a (`apply(proposal, opts, io)`) and §E.11 (an async stage entry point
> with injected `io`) — **and `proposals.cjs` is protected, so the call shape is not negotiable.** A
> closure is the only seam available, and exporting `applyWith` is what keeps the suite able to pass
> fakes without an Electron process. **The other two forms are deleted from this document, not
> deprecated**, because a signature that appears twice is a signature a coder picks from.

**`applyWith` runs SEVEN validations before the snapshot, and a failure THROWS**
— deliberately, because `proposals.apply` records `FAILED` with the message when the applier throws
(§E.5.2a), and a proposal refused at the door is a failure *outside* the verification plan rather than
a verification result with a dossier.

```js
// upgradeApplier.applyWith — before ANY read or write of a target file:
// 0. masterDriven = !!(opts?.user && typeof opts.user.tier === 'number'
//                      && capability.can(opts.user, 'self-modify.apply'));
//    if (!masterDriven) throw new Error('apply requires an authenticated tier-0 user (I6)');
//    policy.requireMasterDriven('revert-own-apply', 'L4');   // ignores the STOP, MASTER_ACT only
//    meta.autonomy = { flag: opts?.autonomous === true, recordedAt: now };   // RECORDED, never read
// 1. meta.schema === 'self-upgrade/1' AND the dossier validates
//    — an entry of this kind with no dossier was not filed by this loop.
// 2. guard.inspectChanges(changes).refused.length === 0        — RE-RUN, never trusted from creation
//    (restore() rehydrates without re-calling assertChangesSafe — §B.1 note iii)
// 3. no changes[].path, and no meta text, names a SELF_GOVERNING_PATHS member
// 4. every changes[].path passes §E.9's resolve-then-compare + lstat rule
// 5. action ∈ {patch, create};  create ⇒ the path does not exist;  delete ⇒ refused (FR-1)
// 6. for every patch, sha256(bytes on disk) === changes[].baseSha256   -> else 'base-drift'
const PID = /^[0-9a-f]{20}$/;                                  // proposals.create's exact id shape
if (!PID.test(proposal.id)) throw new Error('malformed proposal id');
const dir = path.join(userDataRoot, 'rama', 'upgrade-snapshots', proposal.id);   // DERIVED, never read
```

**Check 0 is new in revision pass 3 and it is two things at once** (findings 1 and 2). The
`masterDriven` derivation is **defence in depth** — `proposals.apply` already authorised `opts.user`
at `proposals.cjs` 215, so inside the applier the predicate is tautologically true today, **and that
is exactly why it is written down as insufficient**: `capability.can` reads only `user.tier`
(`capability.cjs` 27–33), so a `{tier: 0}` object is forgeable by any in-process caller. The guarantee
that **Rāma does not start an apply** is therefore **criterion 21c's absence** — zero in-process callers
of `proposals.apply` — not this check. What this check buys is that the applier does not depend on
`proposals.cjs` having run its own gate, which is the same reasoning as check 2. And
`requireMasterDriven` is what makes a master-approved apply work **on an install that is permanently
stopped by design** (FR-53): `policy.require('revert-own-apply', 'L4')` resolved against the `L0` the
STOP forces and **refused master's own apply on every shipped install.**

**Check 2 is the one worth arguing.** Re-running `inspectChanges` looks redundant — `create()` already
called `assertChangesSafe` — but **`restore()` rehydrates `meta` and `changes` on an id check alone**,
which is the same measured fact that made the verification plan untrusted (§E.5.2). A guard that ran
once, before a restart, is not a guard that holds at apply time.

**Check 6 exists because the proposer cannot know how long a proposal sits.** Master may approve a
`self-upgrade` a week after it was authored, and `baseSha256` is what distinguishes *"applies cleanly"*
from *"applies to the file it was computed from"*.

**The residual is printed, not implied** (§E.11): *"`proposals.create` is reachable at tier 1 and
consults neither the autonomy policy nor the stop; the proposer's refusals bind the loop, the applier's
validation binds the kind."* Criterion 19b plants one hand-built proposal per validation, approved by a
tier-0 fixture, and requires the applier to refuse each with the ledger recording `failed`.

### E.5.1 The rollback point is a byte snapshot, not a git ref

Taken in **Stage 3**, before master ever sees the proposal, and carried in the record:

```
rollbackPoint = {
  kind: 'file-snapshot',
  dir: '<userData>/rama/upgrade-snapshots/<proposalId>/',   // DISPLAY-ONLY. The applier DERIVES it.
  gitHead: '<sha|null>',  treeClean: true,
  files: [ { path, existed: true,  sha256: '<64-hex>', bytes: 4213 },   // a patch target
           { path, existed: false, sha256: null,       bytes: null } ]  // a create target
}
```

**`existed` is why this shape and not the earlier `{path, sha256, bytes}`** (review finding 11). A
`create` has no prior bytes, so "restore the prior bytes" has no meaning for it and the only correct
revert is **to delete the file again**. The earlier FR-1 permitted only restoring bytes, which made the
revert of a created file either undefined or a quiet violation of the design's own fence. Now:
**`existed: true` restores the recorded bytes; `existed: false` removes the file and asserts its
absence** — and both are *"restoring each snapshotted file to its recorded prior state"*, which is what
FR-1 now says. Two further consequences: **a `create` whose path already exists is refused** (it is a
mis-declared `patch`, and accepting it would snapshot bytes under a record saying there were none), and
**`action: 'delete'` is refused outright** even though `proposals.cjs` documents it, because a deletion
reverts to *"the file as it was"* — which is a `create` of content the loop did not author, and the loop
has no honest way to verify it.

The applier copies the current bytes of every target file that exists into `dir` **before writing
anything**, then re-reads them and checks each `sha256`. A mismatch at this point aborts **before the
first write**: if the snapshot cannot be trusted, the change must not happen.

> **`dir` IS DERIVED AT APPLY TIME AND THE PERSISTED VALUE IS NEVER READ** (FR-13a, review-2
> finding 2). This is the one place the STOP's unreachability claim was actually false. FR-14 argued
> that a proposal cannot name the allow-file because it lives outside the repository root and
> `changes[].path` cannot address it — **true of `changes[]`, and not true of `meta`.** `rollbackPoint`
> is persisted inside `meta`; `proposals.restore()` rehydrates `meta` **on an id check alone**;
> §E.5.1a's token carried the snapshot **by value**; and the applier used `dir` as the **destination of
> filesystem writes**. `<userData>/rama/autonomy.allow` lives under `userData`. A persisted `dir` of
> `<userData>/rama/` with a snapshotted basename of `autonomy.allow` would have been a write to the
> STOP's own state, performed by the applier, inside the one branch the fence permits to write — and
> criterion 1's scan was bounded to *paths under the repo root*, so it was unasserted **by
> construction**.
>
> ```js
> const PID = /^[0-9a-f]{20}$/;
> if (!PID.test(proposal.id)) throw new Error('malformed proposal id');
> const dir = path.join(userDataRoot, 'rama', 'upgrade-snapshots', proposal.id);
> // meta.weighing.blastRadius.rollbackPoint.dir is DISPLAY-ONLY, exactly as plan[] is (§E.5.2).
> ```
>
> `rollbackPoint.files[].path` is revalidated by §E.9's resolve-then-compare rule **and required to be
> a subset of `changes[].path`**, so the snapshot cannot name a file the change does not touch.
> Criterion 82a plants a poisoned `dir` and proves the allow-file is byte-identical afterwards;
> criterion 1 is widened from *"under the repo root"* to **any** `fs.write*` whose target is neither
> the derived directory nor a validated change path. **The lesson is the one the design already states
> about the plan and then did not apply twice: anything that comes back out of `restore()` is input.**

**Retention, because a whole-file copy per apply accumulates and nothing was removing it** (review
finding 13 — and the design mandates a real purge for every other byte it writes, so an unbounded
snapshot directory would be its own counter-example):

| Outcome | What happens to `dir` |
|---|---|
| Plan passed, entry applied with `verified: true` | **Deleted immediately.** A snapshot of a verified apply is a copy of bytes git already has, and keeping it would be keeping master's source in a second place for no purpose. Criterion 81 asserts it is gone. |
| Plan failed, revert succeeded | **Kept** — it is the evidence for the breakage analysis and for the corrected proposal's `learned` field. |
| Revert failed (`fatal`) | **Kept, and never evicted**, because it is the only record of what the tree was supposed to be. Counted separately in `statusText()`. |
| Eviction | **Runs after every apply. A directory is evicted when EITHER bound is exceeded: its age is over 30 days, OR it is not among the 20 most recent non-`fatal` directories.** Oldest first. **`fatal` entries are never evicted and do not count toward the 20.** The eviction **count is reported**, not silent. |

> **"The lesser of 20 entries or 30 days" was not a rule** (FR-52, review-2 finding 15). A count and a
> duration have no ordering, so the phrase had at least two readings — *evict when either bound is
> exceeded* and *keep whichever subset is smaller*, the second being undecidable — and criterion 81's
> only fixture exercised the count, so **the suite would have passed under either reading and the age
> bound was never tested.** The rule above is the strict reading, stated as an `OR`, and criterion 81
> now carries four fixtures including a 31-day-old entry and a `fatal` survivor.

`statusText()` and the Settings → Autonomy panel both report **snapshot count and total bytes**, for
the same reason `dependencyAdvisor` reports deltas rather than absolutes: a number master can watch
grow is a number he can act on.

### E.5.1a The revert token — how the in-flight carve-out actually works

*Added in the revision pass. §E.1's `effective()` carried a parenthetical exception for an in-flight
revert, which a pure resolver cannot implement (review finding 12).*

```js
applyWith(io, proposal, opts)  // ONCE, at entry, BEFORE any write:
                               //   masterDriven derived from opts.user — false ⇒ THROW, no write
                               //   policy.requireMasterDriven('revert-own-apply', 'L4')
                               //       → effective(c, {ignoreStop:true}); MASTER_ACT classes only
                               //   opts.autonomous RECORDED into meta.autonomy — never a gate
                               // then issues:
const token = { proposalId, snapshot: { files: rollbackPoint.files }, dir: derivedDir, at }

revert(token, io)              // consults NEITHER the policy NOR the stop. A token IS the authority.
```

**Four properties, each load-bearing.** (i) **The STOP is not consulted on this path at all, and the
level comes from `requireMasterDriven` over the frozen `MASTER_ACT` subset** — a STOP engaged
mid-flight cannot strand a half-written tree, and master applying a
proposal he approved is not Rāma starting work (FR-17, FR-53). **Revision pass 1 checked the stop
unconditionally and revision pass 2 checked it on `opts.autonomous`; both were wrong, in opposite
directions** (review-3 findings 1 and 2). Unconditional meant — on an install that is permanently
stopped until master writes an allow-file — **master could approve a change and never be able to apply
it**; and `opts.autonomous` is **renderer input**, so the predicate deciding whether the STOP applied
was supplied by the party it exists to stop, bypassable by **omitting a field**. The level now resolves
through `effective(c, {ignoreStop: true})`, reachable **only** through `requireMasterDriven`, which
**throws for any class outside `MASTER_ACT`**; the flag is recorded into `meta.autonomy` and never
read; and *"Rāma does not start an apply"* is held by **criterion 21c's zero in-process callers**, not
by a boolean. (ii) **`revert(token)`
with no token is refused** — there is no path to a revert that was not preceded by an admitted,
permitted, snapshotted apply, which is what keeps the revert inside §E.6's reading of I6 rather than
becoming a general-purpose write. (iii) **The token carries the snapshot FILES by value and the
DERIVED directory** — not the persisted `dir` (FR-13a): the revert target is fixed at apply time, and
the destination is computed, so neither can be steered by a rehydrated record. (iv) **The policy check
is unconditional** — it ignores the STOP, not the data file — so lowering `revert-own-apply` to L0 in
the data file **still** genuinely disables the automatic revert, which is §I.1's offer, and criterion
9a proves the data value reaches it. *`ignoreStop` skips the resolver's first line only; `min(CEILINGS,
levels)` is untouched, which is what keeps master's restriction authority intact while restoring his
apply.* Criterion 21's five assertions, criterion 21a, **criterion 21b (the shipped state, and again
under `RAMA_AUTONOMY=stop`)** and **criterion 21c (zero in-process callers)** cover all of it.

> **Why not `git checkout` / `git stash` / `git reset`.** Because a verification failure does not
> justify a destructive side effect on work master did not submit. A `git checkout` of the changed paths
> would discard master's **unrelated uncommitted edits** to those same files, and a `reset --hard` is
> worse. The file snapshot restores exactly the bytes that were there, touching nothing else. `gitHead`
> is still recorded — it is genuinely useful for the audit and for master's own `git diff` — but it is
> **not the restore mechanism**, and the design says so in the record's `kind` field so no later session
> mistakes one for the other. This also keeps the loop working in a non-git checkout (assumption A3).
>
> Location: `userData`, for the reason `selfRepair.cjs` already established — writable in every install
> — and because a snapshot inside the repo would be a file the next diff could name.

### E.5.2 The verification plan is DISPLAYED from Stage 4 and RE-DERIVED at Stage 5

> **The persisted plan is display-only, and the executed plan is re-derived from `changes[]` at apply
> time** (review finding 15). The reason is measured: `proposals.restore()` rehydrates `meta` from the
> encrypted store **with only an id check** — it does not re-validate the dossier and does not re-call
> `assertChangesSafe` (§B.1 note iii, Section 124 finding #4, still open). So a persisted
> `plan[].target` is **untrusted input that was about to be handed to a process launcher.** Re-deriving
> it from `changes[]` through the same `classifyChange` costs nothing, cannot drift from what is
> actually being written, and removes the attack surface entirely. **The persisted plan is still shown
> to master** — it is what he approved, and if the re-derived plan differs the applier **says so in
> `meta.verification.planDrift`** rather than quietly running a different plan.

`verification.plan[]` is built from the changed file set using **`localUpdateEngine.classifyChange`** —
the function `verifyUpdateEngine.cjs` exists to protect, reused rather than re-derived, because a second
classifier is how two classifiers disagree:

| Step | When it is in the plan | Pass condition |
|---|---|---|
| `node --check <file>` | every changed `.cjs`/`.js` | exit 0 |
| `suite <name>` | every suite in a **RECOMPUTED** `suiteCoverage` — a scan of `scripts/verify*.cjs` for a changed path or basename, run over the **re-derived** change set — plus `verifyInvariants` and `verifyLoyaltyTripwire` **always** | exit 0 |
| `audit` | any changed `.jsx`/`preload.cjs`/store | `auditRenderer` exit 0 |
| `build` | `classifyChange` says the renderer is affected | `vite build` exit 0 — **and this is the step that cannot be verified in this workspace** (§H) |

**`verifyInvariants` and `verifyLoyaltyTripwire` are in every plan regardless of what changed.** They
are cheap, they are the two suites that assert the covenant rather than the modules, and a change that
breaks an invariant it did not appear to touch is precisely the case a plan derived from the diff would
miss.

**`suiteCoverage` is RECOMPUTED, not read — and this was the gap the re-derivation left open**
(review-2 finding 12). The rule says the executed plan is re-derived from `changes[]`; the plan table
said a `suite` step is in the plan *"for every suite `suiteCoverage` named"* — and `suiteCoverage`
exists only in persisted `meta.weighing.blastRadius`, **which is precisely the untrusted input the
re-derivation exists to avoid.** So the plan either silently dropped the change-specific suites —
verifying a change without the suite written for it, which is the `verifySelfBuild` failure mode in a
new place — or re-read `meta` and re-opened review-1 finding 15 through a different field. **Neither.
It is recomputed:** the scan is a `scripts/verify*.cjs` grep for a changed path or basename, cheap and
deterministic, so the applier derives it from the re-derived change set and **sets `planDrift: true`
when it differs from the persisted value** (criterion 82b). *The persisted one is still shown to
master, because it is what he approved.*

**How each step is launched, stated because "run the suite" is not a design decision:**
`child_process.execFile` with **`shell: false`**, an argument array, `cwd` set to the repo root, and a
per-step timeout. **No `exec`, no shell string, no template-string command assembly** — asserted by
source shape (criterion 83). `step` must be one of `node --check` · `suite` · `audit` · `build`;
`target` is constrained by §E.9's row. A `build` step is the one step this workspace cannot exercise
(§H.2), and the plan records `needed` and `run` separately so *"not run"* never renders as *"passed"*.

### E.5.2a What the applier returns — and why a reverted apply is not a thrown error

*Added in the revision pass (review finding 6). The design said "revert on failure" without saying
whether the applier throws or resolves, and the two are not equivalent in this ledger.*

**Measured in `proposals.cjs`:** `apply()` awaits the applier, then sets `STATUS.APPLIED` and
`p.result = result` **whenever it resolves**, and sets `STATUS.FAILED` with `p.reason = err.message`
**only when it throws**. So the two obvious choices are both wrong on their own: **resolving** leaves
the ledger saying `applied` for a change that was reverted, and **throwing** satisfies the status but
discards the whole dossier down to a single string — which is the exact defect Part C item 5 names
(*"master holding a string"*).

**The decision: the applier ALWAYS RESOLVES, with a verdict object, and mirrors that verdict into
`meta` before it resolves.**

```js
// upgradeApplier.applyWith(io, proposal, opts) resolves with:
{ verified: false, reverted: true, revertAttested: true,
  causeId: 'suite-red', cause: '…', remedy: '…',
  plan: [...], planDrift: false, snapshotDir: '…' }
```

- **`meta.verification.result` is written with the same object before resolving.** `forStorage()` keeps
  `meta` whole for every status — only `changes[].content` is dropped once decided — so the verdict
  survives the restart that `p.result` alone might not, and `summarise()` already sends `meta` to the
  renderer. **And `summarise()` does not carry `result` AT ALL** — measured, it returns
  `{id, kind, title, summary, status, risk, requiresRestart, createdAt, decidedAt, decidedBy,
  appliedAt, reason, changeCount, paths, meta}` — **so the list view has no other field it could
  read.** That is a stronger reason for this decision than the one originally given (review-2
  finding 21): it is not only that `meta` survives `forStorage`, it is that **`result` never reaches
  the renderer's list channel at all**, so mirroring into `meta` is the only way a dossier's verdict is
  visible without fetching each proposal individually. Criterion 45a names both channels it scans.
- **`verified` is the field that means success, not `status`.** Criterion 45a forbids any renderer
  branch treating `status === 'applied'` as success for `KIND.DIFF`.
- **An applier that throws is still handled** — a thrown error means something outside the plan failed
  (a disk error, a bug) and `FAILED` is then the right status. What must not throw is a *verification
  failure*, because that is an expected outcome with a dossier attached.
- **The residual is printed rather than engineered around:** `proposals.cjs`'s status vocabulary has no
  term for *"applied, then reverted"*, and this design does not add one because the file is protected.
  The suite prints `RESIDUAL: proposals.STATUS cannot express "applied then reverted" — the verdict
  lives in meta.verification.result; see SELF_UPGRADE.md §E.5.2a` and counts it.

### E.5.3 On failure: revert, then NAME the cause

```js
breakageAnalysis.analyse({ phase, step, target, stderr, stdout, exit, suiteRow, running })
// -> { causeId, cause, evidence, remedy, confident, phase }
```

**The vocabulary is `verifyEngineDiagnosis`'s, extended in the same grammar — but the `causeId`s
themselves are NEW, and saying otherwise was wrong** (review finding 8). Measured:
`aiProcess.diagnoseFailure` returns `{reason, remedy, silent?}` and **carries no `causeId` at all**, so
nothing "carries straight through". What carries over is the *discipline* — named causes,
distinguishable from one another, each with a remedy, total over every input — and that is worth
copying because `verifyEngineDiagnosis` already proved those names are distinguishable, which is the
property that makes a cause actionable. **Thirteen ids: six for the engine's existing branches, six for
source-change failures, and `unrecognised-exit` for the branch that identified nothing.**

| causeId | Recognised from | `confident` |
|---|---|---|
| `missing-package` | `ModuleNotFoundError` / `Cannot find module` — **names the module** | true |
| `bound-port` | `EADDRINUSE` / `Errno 10048` / *bind on address* | true |
| `version-mismatch` | `SyntaxError` from a parse, Node/Python version evidence | true |
| `missing-interpreter` | *not found on PATH*, spawn `ENOENT` | true |
| `live-but-silent` | started, did not answer; carries `silent: true` | true |
| `never-spawned` | no process, no output | true |
| `syntax-rejected` | `node --check` non-zero — **names file and line** | true |
| `suite-red` | a suite exited non-zero — **names the suite AND the failing row** | true |
| `invariant-red` | `verifyInvariants` red — **names the I-number** | true |
| `tripwire-red` | a protected file's digest mismatched — **names the file** | true |
| `bridge-unresolved` | `auditRenderer` — names the `window.rama.*` call or destructure | true |
| `import-unresolved` | a changed file imports something that does not resolve | true |
| `unrecognised-exit` | nothing above matched — **reports the exit code AND the interpreter/command** | **false** |

### E.5.3a The mapping from `diagnoseFailure`'s branches to `causeId` — literal, and owned here

*Added in the revision pass (review finding 8). Two designs were possible and one had to be chosen:
**(a)** `breakageAnalysis` owns the mapping and `aiProcess` is untouched, or **(b)** `diagnoseFailure`
gains a `causeId` field, which makes `aiProcess.cjs` a changed file and `verifyEngineDiagnosis.cjs` a
changed suite.*

**Chosen: (a).** `breakageAnalysis.cjs` carries the table and **`aiProcess.cjs` and
`verifyEngineDiagnosis.cjs` are not modified** (sha256-asserted, criterion 48a). Three reasons. The
engine diagnosis is consumed today by `marketIntel` and `getRunningStatus`, which want a sentence for
master and have no use for an id — adding a field for this caller's benefit spends their stability on
our convenience. The mapping is a **property of this loop's vocabulary**, so it belongs where the
vocabulary is defined and where a planted mutation can turn it red. And a 212-assertion suite over a
pure function is an asset; changing its subject to add a field we can derive is a poor trade.

**The eight measured branches, in source order, and the id each maps to:**

| # | `diagnoseFailure` branch — the evidence it matches | Returns | → `causeId` | `confident` |
|---|---|---|---|---|
| 1 | `/No module named '([^']+)'/` | *"the engine's Python packages are not installed — "X" is missing"* | `missing-package` | true |
| 2 | `/SyntaxError\|IndentationError/` | *"the engine source failed to parse"*, remedy names Python 3.10–3.12 | `version-mismatch` | true |
| 3 | `/Address already in use\|Errno 10048\|WinError 10048\|only one usage of each socket address/i` | *"port 8001 is already in use"* | `bound-port` | true |
| 4 | `/ENOENT\|not found on PATH\|could not be started/i` | *"the Python interpreter could not be started"* | `missing-interpreter` | true |
| 5 | `exit && exit.code !== 0 && exit.code !== null` | *"the engine exited with code N (interpreter: …)"* | **`unrecognised-exit`** | **false** |
| 6 | `running && text.length === 0` → `silent: true` | *"alive but has not answered on its port yet"* | `live-but-silent` | true |
| 7 | `!exit && text.length === 0` → `silent: true` | *"no engine process is running and none has reported anything"* | `never-spawned` | true |
| 8 | the final fallback — output present, nothing matched, no usable exit code | *"the engine started but did not answer"* | **`unrecognised-exit`** with `exitCode: null` | **false** |

**Branches 5 and 8 both map to `unrecognised-exit`, and that is the honest collapse rather than a
lossy one.** Both are the function saying *"I did not identify a cause"* — one with a code it can
report, one without. The id's contract is to **report the exit code and the interpreter/command**, and
where the code is absent it is reported **absent rather than zero**, which is `dependencyAdvisor`
habit 4 applied to a diagnosis. `evidence` carries the raw excerpt in both cases, and `confident:false`
sends the caller to a **question** rather than a fix (§E.5.3's last paragraph) — so the collapse costs
nothing a proposal would have used.

**Reconciling §B.4's nine names with these six.** §B.4 lists the nine *cases the suite distinguishes*,
which are not nine branches: `missing python packages` → 1; `bound port` → 3; `parse failure → version
mismatch` → 2; `missing interpreter` → 4; `unrecognised exit` → 5; `no process running` and
`never-spawned` are **the same branch** (7) under two descriptions; `running-but-silent` and
`alive-but-silent` are **the same branch** (6), the second naming its `silent: true` flag. So nine
descriptions over eight branches over seven ids — and the table above is the mapping the suite asserts
branch by branch against real `diagnoseFailure` output, rather than the prose agreement the earlier
draft relied on.

**Four properties copied verbatim from `verifyEngineDiagnosis`, because they are what made that function
usable:**

1. **TOTAL.** Every input — including `undefined`, `{}`, `{stderr: []}`, `{exit: {code: null}}` — yields a
   non-empty `cause` **and** a non-empty `remedy`. Criterion 47 asserts it over a fixture array, the way
   that suite does.
2. **Never `null`.** *"null is what sent the caller to its raw fallback."*
3. **`'it failed'`, `'unknown error'` and `'see logs'` appear in no output, ever.** Criterion 48.
4. **No bare URL or IP in any cause or remedy** — *"which is what master was actually shown."*

**And `confident: false` on `unrecognised-exit` is the honest state, not a hedge.** It is the one branch
that genuinely did not identify anything, and the caller treats it differently: a confident cause
produces a corrected fix proposal; `unrecognised-exit` produces a **question** carrying the raw evidence,
because proposing a fix for a cause you could not name is the fabrication this whole project refuses.

### E.5.4 Then file a NEW proposal — bounded

On a `confident` cause, `upgradeProposer` files a fresh entry carrying:

```
meta.supersedes = '<failed proposal id>'
meta.learned    = { causeId, evidence, whatTheFirstAttemptAssumed, whatChanged }
```

A corrected proposal with an empty `learned` is refused by a source-shape assertion (criterion 52) — a
re-proposal that cannot say what it learned is a retry wearing a dossier.

**The bound, and why it is not optional.** At most **one** automatic re-proposal per fingerprint per
24 h; after **two** failures on the same fingerprint the loop stops proposing for it entirely and files a
**question** instead. Two reasons: an unbounded retry produces a queue master stops reading, which
destroys the value of the one channel this design depends on; and if the same approach has failed twice
the problem is the diagnosis, not the diff — so the correct output is a question, not a third attempt.
Criterion 51.

### E.5.5 A revert that fails is fatal and says so

If restored bytes do not match the recorded `sha256`, the applier returns
`{reverted: false, fatal: true, cause, remedy}`, notifies master through the existing proposal
broadcast, and records it in the ledger. **It does not report success.** Section 124's rule for the
backup path applies identically here: *refuse to report success without re-attesting.* Criterion 46.

This is the one outcome the design cannot repair, and it is named rather than smoothed over: Rāma's
source is in an unverified state, the snapshot is untrustworthy, and the honest output is to say exactly
that and stop — **`engage('revert failed: <file>, expected <sha> got <sha>', 'upgradeApplier')`**,
which is the one place in this design that engages the STOP without master asking, and it is in the safe
direction.

**And this is the engage FR-16a exists for** (review-3 finding 11). It writes
`<userData>/rama/autonomy.stopped.json` carrying `{at, reason, by, priorAllow}` **before** it unlinks
the allow-file, so the reason — *the most important datum in the system at that moment* — survives
somewhere master will find it, and **the allow-file's prior contents survive with it** so he can
restore the state he had. Revision pass 2's `engage(reason)` deleted the allow-file and returned,
**dropping its own reason and destroying the record of who had allowed autonomy** — and since `lift()`
cannot succeed until master adds `system.suspend-autonomy`, recovery meant hand-writing a file whose
prior contents had just been deleted, with nothing on disk saying why.

## E.6 The `revert-own-apply` question, answered directly

**It looks like the fence is breached, so it is argued rather than glossed.** I6 says *nothing is
written to Rāma's own source without an approval recorded in the ledger.* The revert writes source
without a separate approval. The resolution:

> **Approving proposal P authorises exactly two tree states: P applied and verified, or the tree as it
> was when P was approved.** Nothing else. The revert target is **fixed at approval time** — the
> snapshot digests are in the record master approved — so Rāma cannot *choose* a state to revert to
> later; it can only restore bytes that were already recorded as the alternative at the moment of
> approval. The approval covers both endpoints because both are named in the thing approved.

Three properties make that reading safe rather than convenient: the revert can only restore
`rollbackPoint.files[]`, which is fixed in the approved record; every restored byte is `sha256`-checked
against the approved digest; and a mismatch is **fatal and reported**, never retried into something new.
The class is `revert-own-apply`, it is **lowerable to L0** if master prefers a failed apply to leave the
tree changed and merely report, and **§I.1 raises this reading for his explicit confirmation** because it
is the single most load-bearing interpretation in the document.

## E.7 Addendum B — the context store

### E.7.1 The DB decision: `dataStore` is the DB. Option (a).

Addendum B §5 offers three options and requires one to be chosen explicitly. **Option (a): the context
store is a `dataStore` domain.** The decisive finding, measured in the source during this inventory:

```js
// electron/dataStore.cjs
const DOMAINS = ['users','conversations','knowledge','memory','worldmodel','agents','config','instances','proposals'];
function markAllDirty() { for (const d of DOMAINS) { ...; dirty.add(d); } return DOMAINS.length; }

// electron/sessionManager.cjs  changePasscode
dataStore.loadAll();            // step 2 — iterates DOMAINS
...
dataStore.markAllDirty();       // step 5 — iterates DOMAINS
dataStore.saveAll();
```

**`changePasscode` steps 2 and 5 both iterate `DOMAINS`. Adding `'context'` to that array makes the new
store inherit the full I14 re-key for free — one line, no change to `sessionManager.cjs`, and therefore
no change to the file `verifyInvariants.cjs` pins its nine ordered steps against.** Option (b) would
have meant editing the re-key path and writing a new assertion to prove the extension; option (a) means
the invariant covers the new store **by construction**, which is strictly stronger than covering it by
a new line of code someone could later remove.

It also settles Addendum B §6's other three constraints at once: **zero new dependencies** (nothing
native, nothing to `electron-rebuild`, no deepening of Section 124's offline-rebuild hole, nothing to
pin); **one authority owns bytes on disk** — `dataStore` via `cryptoCore.encryptToFile`, so no second
store authority competes with it (the I8/I9/I10 pattern); and **one encryption scheme** — the existing
AES-256-GCM path, not a second one. `proposals.cjs`'s Section 58 comments already won this argument for
the ledger, and every sentence transfers: *a local database would add an external service that has to be
running for the audit trail to work, which makes it less reliable, and its files would be plaintext by
default.*

**The honest limit, stated rather than discovered later.** A `dataStore` domain is one encrypted JSON
blob loaded wholly into memory — it is a key-value store, not a query engine. That is right for stage 0
(which records nothing) and right at the volumes the retention cap permits, **and the retention cap is
what keeps it right** (FR-34, criterion 79). If volume ever outgrows it, **the record is canonical plain
JSON, so moving to a real engine is a copy and a reindex, not a loss of meaning** — which is the same
disposability argument as §E.7.3's index, applied one level up. That property is the point of the schema,
not a consolation.

**And the assertion Addendum B §5 demands:** criterion 65 is a source-shape scan over the whole tree for
any second persistence mechanism — `sqlite`, `better-sqlite3`, `nedb`, `lowdb`, `level`, `pouchdb`,
`mongodb`, a `.db` open, or any `fs.writeFile*` into the data dir outside `cryptoCore.encryptToFile` —
**planted, so adding a fake `contextDb.cjs` that writes its own file turns the row RED.** That is the row
that keeps I14 true against a future session that reaches for a DB.

### E.7.2 The record — "understood by any model" as a schema constraint

```js
{
  id, userId,                                  // FR-32: subject-scoped from day one
  at: '2026-02-14T09:31:04.000Z',              // ISO-8601 always
  kind: 'request' | 'outcome' | 'fact' | 'preference',
  text: 'how much am I down on HDFC',          // the question AS ASKED, where that is the record
  fields: { symbol: 'HDFCBANK', exchange: 'NSE', amount: { value: -4820, unit: 'INR' } },
  provenance: {
    producedBy: 'module:marketIntel' | 'model:<id>' | 'master',
    source: '<where it came from>',
    measured: true,                            // selfModel's shape, reused
    claimClass: null                           // claimGate.CLASS when measured === false
  },
  classification: 'local-only' | 'shareable',
  domain: 'coding' | 'stockmind' | ...,
  retainUntil: '2026-05-14T09:31:04.000Z'      // FR-34: no row without one
}
```

**Model-agnostic in the strong sense (FR-39/FR-42).** Plain JSON, named fields, self-describing, units
explicit (`{value, unit}`), dates ISO-8601, and **the question as asked** where that is the record.
Criterion 69 asserts the absence of `<|`, `[INST]`, `<s>`, role markers, and every provider-shaped field
name (`choices`, `message.content`, `candidates`, `completion`). `toPlainText(row)` renders the canonical
text form, and `parsePlainText` round-trips it losslessly (criterion 70) — so *"answerable by a fresh
model with no extra instructions"* is a claim about a real artefact that a test exercises, not a slogan.

**Provenance reuses both existing schemes and invents neither (FR-43).** `{source, measured}` is
`selfModel`'s shape — including its rule that an unmeasured field is `null` rather than a default, because
*"those read as findings"*. When `measured === false`, `claimClass` must come from **`claimGate.CLASS`**
(`grounded`/`reflex`/`prose`/`unattributed`), **read from the export, not restated** — criterion 68
monkey-patches it and requires the accepted set to change. This is how Rāma never confuses what it was
told with what it concluded: the two cases use two different, already-tested vocabularies.

### E.7.3 The index is disposable. The record is not.

**This is Addendum B's most important line and it is a structural commitment, not a comment.**

```
context domain = { rows: [...], index: { embeddingModel, dims, builtAt, rowCount, recordDigest, vectors }, recording: false }
```

`rows` is canonical. `index` is **derived and rebuildable from `rows` alone** — criterion 72 is a
source-shape assertion that `reindex()` reads the record domain and **never** another index. Criterion 73
deletes the entire index, rebuilds it, and requires query results identical to before. **If the record
were vectors, swapping the embedding model would silently invalidate every memory Rāma has** — the exact
organ-swap failure the *"Rāma is a model"* framing exists to prevent, and the thing `modelRoles.cjs`
already says out loud: *"the base model is a replaceable part; the harness is the durable asset."*

**A reindex is triggered** by: `embeddingModel` or `dims` differing from the current embedder; a
`recordDigest` mismatch against a fresh digest of `rows`; or master asking. **It is verified** by
`recordDigest` matching afterwards and `rowCount === rows.length`. **A stale index is never queried as
if fresh**: `query()` returns `{stale: true, reason}` and **falls back to keyword search** (criterion 71)
— the fallback `vectorMemory.cjs` already has, which is also I11's working-fallback requirement.

So the `nomic-embed-text` → `qwen3-embedding:0.6b` replacement Addendum B mentions is a **reindex**: new
`embeddingModel`, new `dims`, vectors rebuilt from `rows`, meaning untouched. Nothing migrates.

**A real defect found while verifying this, and it is fixed here (criterion 74).** `vectorMemory.embed()`
returns **whatever length Ollama's `nomic-embed-text` responds with** on the first path and **exactly 256**
on the fallback — `tfidfVector(text, dims = 256)`, an explicit parameter default — while `cosineSim`
returns **`0` on a length mismatch**:

```js
function cosineSim(a, b) { if (!a || !b || a.length !== b.length) return 0; ... }
```

So an index containing vectors from both sources — which happens whenever Ollama is available for some
writes and absent for others, the normal case on master's machine — **silently scores every cross-source
pair at exactly zero.** No error, no warning, just permanently unfindable memories. This is the
`cosineSim` equivalent of the JSX-apostrophe defect Section 125 found: *a test that can quietly pass is
worse than no test, because it is also a claim that someone checked.*

**The fix, specified precisely enough to implement and to test** (review finding 18 — the earlier
paragraph named a fix the module's exports made untestable):

1. **`embed(text)` returns `{vector, source, dims}`** — today it returns `{vector, source}` and the
   length is implicit in the array. `dims` is `vector.length`, measured, never assumed.
2. **`embed`, `tfidfVector` and `cosineSim` become exported.** Today
   `module.exports = {register, store, search, isDuplicate, getHealth}` — **not one of the three
   functions the defect lives in is reachable from a suite**, so criterion 74 could not have been
   written against the module as it stands. The five existing exports keep their signatures and
   behaviour unchanged (I11: additive, nothing removed).
3. **Ownership is declared, because it was ambiguous:** `contextStore` **owns the context index** and
   uses `vectorMemory.embed` as a **pure embedder**; `vectorMemory` keeps its own `vectra` index for
   its own callers. Two indexes, one embedder, no shared state — and criterion 72's source-shape row
   asserts `contextStore.reindex()` reads the record domain and never another index.
4. **New inserts of the wrong length are refused, not stored** — `contextStore`'s index enforces its
   recorded `dims`.
5. **Vectors already stored are not repaired by that refusal, and the design says so instead of
   implying otherwise.** `vectorMemory`'s existing index may already hold both lengths. So
   **entries whose lengths disagree mark the index `stale`**, `getHealth()` reports a **`mixedDims`
   count**, and a stale index **falls back to keyword search** rather than returning scores that are
   silently zero. Repairing it is a **reindex**, which is free by §E.7.3's own rule.

**Five assertions, not two** (criterion 74), including the export row — because the first draft's two
assertions could not have run.

### E.7.4 The sensitivity gate — on the payload, at the cloud boundary, and it survives a join

Addendum A §A.2(2) requires the gate be **on the data, not on the role**, and Addendum B §7 adds the
harder case: **a join can assemble a payload no single row looks sensitive enough to block.**

**The chokepoint for MODEL EGRESS is `chatCompletion(messages, modelId)` in
`electron/ipc/modelRouter.cjs`.** Measured: it is a **single switch** over seven providers —
`openai`, `anthropic`, `gemini`, `mistral`, `groq`, `custom`, `ollama` — and **every
chat/completion call reaches its provider only through it.** The gate goes **immediately before the
switch**, not inside the branches:

```js
async function chatCompletion(messages, modelId) {
  const info = modelInfo(modelId);
  if (!info) throw new Error(`Unknown model: ${modelId}`);
  // { dest: 'local'|'cloud', why, evidence } — `why` and `evidence` ride into the refusal so master
  // is told WHY it was treated as cloud, not just that it was.
  const d = destinationOf(info);
  const refusal = contextStore.gateOutbound(messages, d.dest, { why: d.why, evidence: d.evidence });
  if (refusal) throw new Error(refusal.error);  // names the classification, never the content
  switch (info.provider) { ... }
}
```

**The gate's signature and its DEFAULT, declared — because the default is the gate's whole behaviour
for most traffic and revision pass 1 left it to inference** (FR-33b, review-2 finding 14):

> **IT LIVES IN `electron/lib/classificationGate.cjs`, NOT IN `contextStore.cjs`** (FR-58, review-3
> finding 9). The predicate is pure and synchronous, and it sits above the switch of the one function
> every chat passes through — **so it must not be able to fail to load.** Revision pass 2 put it in
> `contextStore.cjs`, which criterion 54b requires to be the **only** holder of
> `dataStore.get('context')`: the chat chokepoint thereby acquired a store-bound dependency, and the
> design never said what happens when the vault is locked or the store loads late. **This document
> makes exactly the opposite argument two sections earlier — *"a stop that can fail to load is not a
> stop"* — and a gate that throws because the vault is locked is a chat failure, not a refusal.** So:
> `classificationGate.cjs` requires no `dataStore`, no `cryptoCore` and no `electron`; `contextStore`
> **re-exports** `gateOutbound` and the classification constants, so every call site below reads
> unchanged; and **criterion 77a asserts `chatCompletion` answers normally with the store locked and
> with `dataStore` unresolvable** — criterion 16's shape, applied to the gate.

```js
// classificationGate.gateOutbound(parts, destination, why) — pure, synchronous.
// Re-exported as contextStore.gateOutbound, so the call sites below are unchanged.
//
// parts: Array< string
//              | { text, classification? }
//              | { contextBlock, classification } >     // what assembleContext returns
//
//   A bare string, or a part with NO `classification`, is UNCLASSIFIED and **PASSES**.
//   Stated as a DECISION, not an omission: this gate exists to stop CLASSIFIED ROWS leaving,
//   not to classify the whole application's traffic. A fail-closed default would refuse every
//   chat message in the product on the day it shipped, which is how a safety mechanism gets
//   removed rather than fixed.
//
// destination: 'local' | 'cloud' — no third value and NO DEFAULT (§E.9). An absent
//   destination THROWS, because a default would decide the leak question by omission.
//
// -> null                                                  when permitted
// -> { error, classification, why, evidence }               when refused
```

**How a context block gets its tag into `messages`.** `assembleContext({userId, query, destination})`
returns `{block, used, withheld, why, classification}` — the `classification` being the **strictest**
of any row that went into the block — and **the caller inserts it as a part carrying that tag**:
`messages.push({ contextBlock: block, classification })`. That is what makes criterion 77's joined case
reachable: without the tag travelling into `messages`, the boundary would see an ordinary string and
pass it, and the join's own filter would be the only guard. **Two guards, one of which is the
boundary** (FR-48). Criterion 92 asserts the whole contract, including that an unclassified array
passes every provider while a tagged one is refused.

**Three design decisions inside that, each load-bearing:**

- **Before the switch, not in the branches.** Gating the seven branches leaves the eighth when a vendor
  is added — `proposals.cjs`'s *"gating six callers leaves the seventh"* and `loyaltyGuard`'s
  *"guarding those four callers would leave the fifth"*. **Criterion 54's seventh assertion adds a fake
  eighth provider to the switch and requires the gate to still refuse**, which only passes if the gate is
  above the switch.
- **The destination is classified PER MODEL from measured evidence — not from the provider name, and
  not from the host** (review findings 1 and 20; spec §130.9). This is the single most important
  correction in the revision pass, because the earlier rule — *"`local` for `ollama`"* — would have let
  a `local-only` record leave the machine through the one gate Addendum A §A.2(2) calls the most
  important.

  ```js
  function destinationOf(info) {
    // 1. Ollama: the provider name says NOTHING about where the model runs. ollamaCatalog.cjs's own
    //    header: Ollama serves CLOUD models through the same localhost:11434 as local ones, and
    //    reporting them as local "would tell master his prompt stayed on the machine when it did not".
    //    modelInfo() already carries the measurement, because describeInstalled() already ran
    //    classify() per tag: { cloud: true|false|null, type: 'cloud-ollama'|'local'|'unknown' }.
    if (info.provider === 'ollama') {
      return info.cloud === false
        ? { dest: 'local',  why: info.cloudWhy, evidence: info.cloudEvidence }
        : { dest: 'cloud',  why: info.cloud === true ? info.cloudWhy : 'classification not measured',
            evidence: info.cloudEvidence || 'none' };
    }
    // 2. A custom endpoint is local only if it is THIS machine. isLoopbackHost, NOT isPrivateHost.
    //    THE FIELD IS info.customProviderId. There is no info.baseUrl on a registry entry:
    //    toRegistryEntries sets `customProviderId: r.baseUrl` (customProviders.cjs 220) and
    //    customChat reads `info.customProviderId` as the base URL (modelRouter.cjs 566).
    if (info.provider === 'custom') {
      let host = null;
      try { host = new URL(info.customProviderId).hostname; } catch { /* malformed => cloud */ }
      return host && customProviders.isLoopbackHost(host)
        ? { dest: 'local', why: 'loopback host',     evidence: info.customProviderId }
        : { dest: 'cloud', why: host ? 'non-loopback host' : 'base URL unparsable',
            evidence: 'url' };
    }
    return { dest: 'cloud', why: `provider ${info.provider}`, evidence: 'provider' };
  }
  ```

  > **`info.baseUrl` does not exist, and revision pass 1 read it** (review-2 finding 10). The failure
  > direction was safe — `isLoopbackHost(undefined)` is false, so every custom provider would have been
  > classified cloud — but **the suite would then have proved nothing about the predicate**: criterion
  > 54's *"custom with a loopback base URL passes"* and its loopback-versus-`192.168` contrast were both
  > unachievable, so a green row would have described a gate that refused everything identically. **A
  > test that cannot distinguish its two cases is a claim that someone checked.** The `new URL()` is
  > inside a `try` because it throws on a malformed value, and a throw here would surface as a chat
  > failure rather than a refusal.

  **Three decisions inside it.** **(i) `cloud: null` resolves to `cloud`.** `classify()` already states
  the asymmetry — *"calling a cloud model local tells master his data stayed home when it did not,
  while calling a local model unknown costs one line of UI"* — and `describeInstalled` already keeps
  `type: 'unknown'` as its own state rather than folding it into local. This gate inherits that rule
  instead of inventing a softer one. **(ii) A seed-only `ollama/*` entry from `MODEL_REGISTRY` resolves
  to `cloud`.** Those entries are *declared* `type: 'local'` with no measurement behind them and exist
  only until a daemon probe replaces them; a declared `local` that nobody measured is not a
  measurement, and the refusal names *"classification not measured"* so master can see why. **(iii)
  `isLoopbackHost`, not `isPrivateHost`.** `customProviders.PRIVATE_HOST_PATTERNS` covers `10.x`,
  `172.16–31.x`, `192.168.x` and `169.254.x` — which are **other machines on a network** and exactly
  right for the SSRF question that predicate was written for, and exactly wrong for *"did master's data
  stay on this machine?"* So the revision **adds a separate exported `isLoopbackHost`** and leaves
  `isPrivateHost` untouched with its original meaning. Two predicates, two questions, neither borrowed
  for the other — the same reasoning that keeps `unchecked` and `verified-clean` apart.

  **`isLoopbackHost`'s declared set, widened in revision pass 2 to cover every host form that can
  actually reach it** (review-2 finding 11):

  ```js
  const LOOPBACK = [ /^127\./, /^0\.0\.0\.0$/, /^localhost$/i, /^\[?::1\]?$/ ];
  // Operates on new URL(...).hostname — which returns an IPv6 literal BRACKETED, e.g. '[::1]'.
  function isLoopbackHost(hostname) { return LOOPBACK.some(re => re.test(String(hostname))); }
  ```

  The earlier set was `127.0.0.0/8`, `::1`, `localhost`, which would have classified
  `http://[::1]:8000` and `http://0.0.0.0:8000` as **cloud** — safe in direction, but **wrong rather
  than strict**, and the next reader would have filed it as a bug and corrected it in whichever
  direction was convenient. The two extra patterns are taken from the neighbouring
  `PRIVATE_HOST_PATTERNS`, which already handles both forms. Criterion 54 assertion 13 is one row per
  pattern.

  **And one sentence so nobody reconciles two fields that are not in conversation:**
  `toRegistryEntries` sets **`type: 'cloud'` on every custom entry by declaration** (line 222), so a
  loopback custom provider is `dest: 'local'` and `type: 'cloud'` at once. **`info.type` is a
  declaration and is NOT consulted — `destinationOf` is the only authority on destination**, and the
  disagreement is a known cosmetic one rather than a second opinion. Recorded here because the
  tempting "fix" is to start trusting `type`, and the safe direction is to stop declaring it.

  **A provider-name check was the comfortable option and it is wrong twice over:** it would mark a
  localhost custom endpoint as cloud (needlessly refusing), and it would mark a cloud-served Ollama
  model as local (silently leaking). Criterion 54's assertions 8–13 are each one of these cases.
- **The gate reads `classification` off the PAYLOAD, not the role.** Criterion 55 proves a `local-only`
  payload is refused **on a role whose `sensitive` flag is `false`**. Addendum A's reasoning, kept
  verbatim because it is the whole point: *without a payload check the leak path is not a decision
  anybody makes, it is a refactor months later that nobody notices.*

**The join (FR-48).** `assembleContext({userId, query, destination})` is the **only** function that
builds a context block, and it filters by `classification` against `destination` **before** assembling,
reporting `{block, used, withheld, why}` — the withheld count is surfaced, never silent (criterion 76),
because *"nothing was read" must never render as "nothing happened"*. Belt and braces: the assembled
block is **tagged** with the strictest classification of any row that went into it, and `gateOutbound`
re-checks the tag at the boundary. **So a classified row cannot pass even when it arrives via a join** —
the join refuses to include it, and if it somehow did, the tag makes the whole block `local-only` and the
boundary refuses the request. Criterion 77 asserts the joined case specifically, with no row passed
directly.

**`chatCompletion` is NOT the only outbound path that carries text, and the earlier completeness claim
was false** (review finding 2). Measured, by reading the source rather than reasoning about it:

**The counting unit is a GATE CALL SITE. Eight of them, across six modules, covering ten measured
request sites.** Revision pass 1's table named four sites and asserted `=== 4`; **re-measured, two of
those four were three requests behind one call, and a fifth existing module was missing entirely**
(review-2 finding 4). The honest table:

| # | Gate call site | Requests it covers | What leaves | Passes `chatCompletion`? |
|---|---|---|---|---|
| 1 | `voiceEngine.cjs` ~268 | 269 | a multipart `POST https://api.openai.com/v1/audio/transcriptions` carrying **audio bytes** | **no** |
| 2 | `browserEngine.cjs` ~204, before the `page.goto` at ~209 | 209 (one of the three URL forms at 205–207) | `duckduckgo` / `bing` / `google`, each `encodeURIComponent(query)` | **no** |
| 3 | `codeRegenEngine.cjs`, **top of `researchFix`** ~44 | **49, 69, 87** — DDG, `registry.npmjs.org/-/v1/search?text=<pkg from the error message>`, `api.github.com/search/repositories?q=<errorMessage.slice(0,60)>` | the **error message, package name and language** | **no** |
| 4 | `intelligenceEngine.cjs` ~294 | 295 | `fetchDDGAPI`'s `https://api.duckduckgo.com/?q=…` | **no** |
| 5 | `evolutionEngine.cjs`, top of `searchNpm` ~218 | 220 | `registry.npmjs.org/-/v1/search?text=<query>` | **no** |
| 6 | `evolutionEngine.cjs`, top of `searchArxiv` ~252 | 255 | `export.arxiv.org/api/query?search_query=all:<query>` | **no** |
| 7 | `evolutionEngine.cjs`, top of `searchGitHub` ~167 | 540 (via `githubAPI`) | `api.github.com<endpoint>` carrying a master-supplied query | **no** |
| 8 | `upgradeResearch.gather`, before the first `fetchText` (§E.4.2) | all of this design's research reads | the finding's `what` and a sensor field name — **and nothing else** (FR-51), **each part constructed with an explicit `classification`** (FR-51a) | **no** |

> **SITES 1–7 ARE AUDIT POINTS; SITE 8 IS AN ENFORCEMENT POINT. The difference is stated here because
> the prose previously credited all eight with a refusal** (FR-51a, review-3 finding 10). FR-33b's
> declared default is that **a bare string PASSES.** Sites 1–7 pass `[query]` — a bare,
> master-supplied string — so **`gateOutbound` returns `null` there by construction and cannot refuse
> anything.** What they give is a **recorded, counted, planted-against call** at every outbound text
> path, which is what criterion 54a is for and is genuinely worth having; what they do **not** give is
> a refusal, and *"a verification step that cannot fail is not a verification step"* is this document's
> own rule. **What enforces FR-51 at those sites is the construction of the query**, and **what
> enforces it at site 8 is that every part is classified at construction** — `shareable` for the
> finding's `what` and the field name, `local-only` for anything derived from `measurement.value`,
> file contents or a `stderr`/`stdout` excerpt — **so criterion 93 has a positive case that can go
> red** instead of an absence a bare string satisfies by accident. Both statements are printed in
> §E.11's residual list.

**Three decisions inside that table, each stated rather than left to the implementer:**

- **Site 3 is ONE call covering THREE requests, deliberately.** `researchFix` derives all three URLs
  from the same `errorMessage`/`language`/`codeContext`, so one
  `gateOutbound([errorMessage, language, codeContext], 'cloud')` at the top of the function covers
  every one of them, and a comment in the code says why it is one and not three. Three calls over the
  same payload would be three chances to drift apart.
- **`evolutionEngine` was absent from revision pass 1 entirely** and is the reason the old assertion
  was not merely imprecise but **wrong**: it makes three outbound requests carrying a master-supplied
  query, and it already routes them through `lib/http.cjs` (`net.get`, line 547), so I9 was intact and
  only the gate was missing. An `=== 4` assertion would have gone **green on the under-count** and
  **blocked anyone who added the missing calls** — the exact inversion of what the row is for.
- **One uncovered path is printed, not omitted.** `evolutionEngine.readRepoFiles` (~290) also reaches
  `githubAPI`, carrying repository and file-path names rather than caller text. **It is not gated**,
  that is a judgement about what those names are, and it is in §E.11's residual list so master or a
  later session decides it from a printed line rather than discovering it from a leak.

**So the claim is narrowed to what is true — `chatCompletion` is the one chokepoint for MODEL egress —
and the eight remaining call sites each invoke the gate directly.** Two lines each:
`const refusal = contextStore.gateOutbound([query], 'cloud'); if (refusal) return {ok:false, error: refusal.error};`
**Both counts are asserted and printed — eight gate calls, ten request sites — and a planted ninth
ungated request turns the row RED** (criterion 54a), so a new outbound text path cannot appear without
the row changing. Row 118's lesson: a count nobody prints is a count that drifts. **And a count nobody
measured is worse than a scoped one that was** — which is the lesson this row learned twice.

**And one structural guard that makes the coverage question tractable at all:** a source-shape assertion
proves **`dataStore.get('context')` appears in exactly one file, `contextStore.cjs`** (criterion 54b).
If only one module can obtain a classified row, then *"which paths could leak one"* reduces to *"which
modules call `contextStore`"* — a list the suite can enumerate — rather than *"every outbound call in
the process"*, which it cannot. **The honest residual, printed:** these sites are gated by a call,
not by a chokepoint, and a sixth engine added later would be unguarded until someone adds the call.
The counted assertion is what turns that from a silent gap into a failing row — **and the fact that
revision pass 1's count was wrong is the argument for the counted assertion, not against it.**

**Addendum A §A.4's refusal, made difficult rather than merely undocumented:** there is no parameter,
flag or config on `assembleContext` that permits a `local-only` row to a cloud destination. The
capability does not exist in the function's surface, so enabling it is a visible source change to a named
function with a suite row (criterion 77) that goes red — not a config toggle. **And it will look most
attractive exactly when the local models feel too weak**, which is why the guard is a missing parameter
rather than a default.

### E.7.5 Retention, purge, backup, and the falsifiable criterion

- **Retention (FR-34).** `retainUntil` is required on every row (criterion 67), so `retentionSweep(now)`
  has **no unbounded case** — there is no row it cannot age out. It reports the count dropped.
- **Purge that actually deletes.** `purge(userId)` removes the rows, **destroys the index** (a purge that
  left vectors behind would leave a searchable shadow of the thing purged), and calls
  **`cryptoCore.secureDelete`** on the domain file — the DoD 5220.22-M 3-pass function that already
  exists and that `changePasscode` already uses on `rama.salt`/`rama.verify`. Criterion 78 forbids a
  flag-flip purge as the only effect. I14's full re-key already proves this project does the real thing;
  a flag would be a regression against its own precedent.
- **Visible while recording.** The badge and the page both show it, through `badgeLabel` so the claim is
  checkable against the thing it describes.
- **Backup (FR-35).** The context domain is **excluded** from any backup manifest (criterion 80, planted
  so adding it goes RED). **The coupling to Section 124 §9.2 is raised, not resolved** — §I.3.
- **The falsifiable criterion, present before recording begins, and FIXED IN ADVANCE (FR-37).**

  ```js
  const CRITERION = Object.freeze({ windowDays: 90, minModelCallsSaved: 1, minReflexes: 1 });
  evaluateCriterion(observation, criterion = CRITERION)
  // observation = { startedAt, now, reflexesSynthesised, modelCallsSaved, measurementSource }
  // -> { verdict: 'stop-recording' | 'continue' | 'too-early', why, criterion }
  ```

  **The constant is the point** (review finding 17). The earlier signature took `windowDays`,
  `reflexesSynthesised` **and** `modelCallsSaved` all from the caller, which means the criterion was
  whatever the caller said it was — and *"a criterion fixed in advance"* that the caller supplies is
  not fixed in advance. Addendum A §A.3 and spec §127.5 both require it set **before** recording
  begins, so it is a frozen constant, it is the default argument, and criterion 60(a) asserts its
  three values literally.

  **90 days, and the number is argued rather than picked:** one full quarter is long enough for a
  weekly-recurring request to appear a dozen times — which is what reflex synthesis needs to see —
  and short enough that master is not asked to carry a privacy cost for a year on a projection.

  **The measurement source is NAMED, and absent it the verdict is `too-early`.**
  `metaCognition.recordOutcome({action, tool, role})` is what makes *"a reflex saved a model call"* a
  counted event: a reflex answering is an outcome whose `tool` is the reflex rather than a model.
  Until that counting exists, `evaluateCriterion` returns
  `{verdict: 'too-early', why: 'no measurement source yet'}` — **it does not treat an unsupplied
  number as zero and conclude `stop-recording`**, because a fabricated verdict in the honest direction
  is still a fabricated verdict, and `selfModel`'s `unmeasured()` rule exists for exactly this.

  This is deliberately the same test
  `ai_backend/engine/outcomes.py` and `calibration.py` already run on market predictions — *did it come
  true, was the stated confidence earned* — now pointed at Rāma's own learning mechanism. **Without a
  criterion fixed in advance, recording becomes permanent on the strength of a hope.** Criterion 60.

### E.7.6 Stage 0: the vessel, dark

Shipped state: `{rows: [], index: null, recording: false}`. **Nothing is recorded.** No domain is named
by master yet, the capability is not in the matrix, and `selfModel.describe()` **keeps emitting the
prompt-text limit** so the cost of the gap stays visible instead of being quietly accepted (criterion 57,
asserted against the existing `verifySelfModel` row).

**Criterion 75 asserts that no context ROW ever exists — NOT that no context FILE exists, and the
difference is a correction** (review-3 finding 8). Measured: `dataStore.markAllDirty()` instantiates
`getDefaultData(domain)` for **every** domain and `saveAll()` writes one encrypted file per dirty
domain (`electron/dataStore.cjs` 305–311, 78–79). **So adding `'context'` to `DOMAINS` — which
criterion 64 requires, and which is the entire I14 argument of §E.7.1 — GUARANTEES a context domain
file on disk.** Revision pass 2's *"a filesystem check proves no context bytes exist anywhere"* is
therefore **red on a correct implementation**, and the natural way for a coder to make it green is to
take the domain out of `DOMAINS` — **losing the re-key coverage this design calls its deciding
finding.** The three assertions are: the domain decrypts to `{rows: [], index: null, recording: false}`;
`rows.length === 0` and `index === null`; and no **row payload** exists anywhere. **The file is present
because the invariant requires it to be, and that is worth one sentence rather than one deleted line.**

The tier-3 synthesis itself is not built (Addendum A §A.5); normalised
phrasing clusters are not re-proposed (§A.7).

## E.8 Error handling — per operation, concrete

"Handle errors appropriately" is not a design decision, so each failure is named with its
recoverability, what the caller receives, and whether it is logged.

| # | Operation | Failure condition | Recoverable? | Caller receives | Logged |
|---|---|---|---|---|---|
| 1 | `policy.load()` | file absent | **yes, by design** | every class at its floor; `policyStatus().source: 'none'` | no — the normal shipped state |
| 2 | `policy.load()` | unparsable / schema-violating / permanent-class key / `L5` / above-ceiling | **yes** | every class at its floor; `rejected: true` + `why` | **`console.warn` once per load**, and shown in the UI — a rejected policy file master cannot see is a policy file that lies |
| 3 | `stop.isStopped()` | any read or parse error | **yes — this IS the behaviour** | `true` (stopped) | no. A warn on every call would be a log flood, and the UI shows the stopped state |
| 3a | `stop.isHalted()` | the stopped-record cannot be `access`ed for any reason other than absence (permissions, a directory at that path) | **yes, and it resolves to HALTED** | `true` | **`console.warn` once per process** — an unreadable stopped-record is ambiguous, and for *this* predicate the ambiguous answer is the restrictive one, which is the opposite direction from row 3's for the opposite reason (FR-12/FR-13: absence means *"as the build master has"*, ambiguity means *"halt"*) |
| 3b | `stop.engage(reason, by)` | the stopped-record cannot be written | **NO — fatal, and it does NOT proceed to unlink the allow-file** | `{ok:false, fatal:true, error}`; the in-memory flag is set stopped anyway so the process-local answer is safe | **`console.error`**. Writing the record **before** deleting the allow-file is the ordering FR-16a specifies and criterion 22c asserts: a crash between the two leaves a recorded reason and a live allow-file — inconsistent in the **recoverable** direction |
| 4 | `stop.lift()` | bad user / no note / capability absent | yes | `{ok:false, error}` naming what is missing | `console.warn` — a lift attempt is security-relevant |
| 5 | `stop.engage()` | the allow-file cannot be deleted | **NO — fatal** | `{ok:false, fatal:true}` | **`console.error`**, and the in-memory flag is set stopped anyway so the process-local answer is still safe |
| 6 | `notice()` | `measurement` absent/malformed | **no — throws** | `TypeError` | the throw is the record. A programming-error boundary, not a runtime condition |
| 7 | `collect()` | one sensor throws | **yes, isolated** | that sensor in `sensorsAbsent[]`, others still read | `console.warn` naming the sensor |
| 8 | `collect()` | every sensor throws | yes | `{findings: [], sensorsAbsent: [all]}` — **never** `reason: 'no sensor reported anything'`, which is a different sentence | `console.warn` |
| 9 | `gather()` | `admit()` denies | yes | `{admitted:false, reason}` verbatim from the orchestrator | no — throttling is normal |
| 10 | `gather()` | fetch throws / times out / circuit open | yes | `offline:true`, sources `unchecked`, non-empty `unknown[]` | no — offline is a declared outcome, not an error |
| 11 | `gather()` | response over `MAX_RESPONSE_SIZE` | yes | source dropped, `dropped` incremented, named in `unknown[]` | `console.warn` |
| 12 | `weigh()` | `costOfDoingNothing` empty | **no — throws** | `TypeError` | the throw is the record |
| 13 | `weigh()` | `git` unavailable / not a repo | yes | `gitHead: null`, snapshot still the mechanism | no (assumption A3) |
| 14 | `weigh()` | tree dirty | **yes, by design** | `rollbackPoint: null`, verdict `needs-master-decision` | no |
| 15 | `weigh()` | `analyzeImpact` throws | yes | `dependents: []` + a **con** reading *"dependents could not be computed"* — never an empty list presented as "no dependents" | `console.warn` |
| 16 | `file()` | STOP engaged / policy blocked / duplicate / rate-limited | yes | `{ok:false}` with the specific reason | no |
| 17 | `file()` | diff names the stop or the policy module | **refused outright** | `{ok:false, refused:'protected-by-design'}` | **`console.error`** — this should never happen and must be loud |
| 18 | `file()` | `proposals.create` throws (`assertChangesSafe`) | **no — propagates** | the `LoyaltyViolation` | **`console.error`**. §E.4.3 means this is unreachable; if it fires, the pre-emption failed and that is worth knowing |
| 19 | `apply()` | snapshot digest mismatch **before** any write | **yes — aborts clean** | `{ok:false, reason:'snapshot not trustworthy'}`, nothing written | `console.error` |
| 20 | `apply()` | a write fails midway | yes | revert runs; **the applier RESOLVES** with `{verified:false, reverted:true, revertAttested:true, causeId, cause, remedy}`, mirrored into `meta.verification.result` **before** resolving (§E.5.2a) | `console.error` |
| 21 | `apply()` | verification fails | yes | identical shape to row 20 with the plan's `causeId`. **Never a throw** — throwing would reduce the dossier to `err.message`, and resolving without the mirrored verdict would leave the ledger reading `applied` for a reverted change | `console.warn` + `meta.verification.result` |
| 21a | `apply()` | something **outside** the plan fails — disk error, a bug in the applier | no | **throws**, so `proposals.apply` records `FAILED` with the message, which is the right status for an unexpected failure | **`console.error`** |
| 21b | `apply()` | the re-derived plan differs from the persisted one | yes | runs the **re-derived** plan and sets `meta.verification.planDrift: true`; master sees both | `console.warn` |
| 22 | `revert()` | restored bytes mismatch the approved digest, **or a file snapshotted `existed:false` still exists after removal** | **NO — FATAL** | `{reverted:false, fatal:true, cause, remedy}`; **STOP engaged automatically**; master notified; snapshot dir **retained and exempt from eviction** | **`console.error`** + ledger |
| 22a | `revert()` | called without a token | **no — refused** | `{ok:false, error:'revert requires a token issued by apply()'}`. There is no path to a revert that was not preceded by a permitted, snapshotted apply (§E.5.1a) | `console.error` |
| 23 | `analyse()` | any input, including none | **cannot fail** | always `{causeId, cause, remedy}`; `unrecognised-exit` when nothing matched | no |
| 24 | `contextStore.add()` | any required field missing | **no — throws** | `TypeError` naming the field | the throw is the record |
| 25 | `contextStore.query()` | index stale / dims mismatch | yes | `{stale:true, reason, results}` from the **keyword fallback** | no — the fallback is the designed path (I11) |
| 26 | `gateOutbound()` | a `local-only` row reaches a cloud destination | **no — refuses the request** | an `Error` naming the **classification**, never the content | **`console.error`** — a near-miss on the leak path |
| 27 | `purge()` | `secureDelete` throws | **NO — fatal** | `{ok:false, fatal:true}`; rows stay marked unpurged | **`console.error`**. **Never reports a purge it did not perform** |
| 28 | `reindex()` | embedder unavailable | yes | index rebuilt with the TF-IDF source at its own `dims`, marked `source:'tfidf'` | `console.warn` |
| 29 | ledger `restore()` | a persisted dossier fails schema validation | yes | that entry dropped and **counted** in `stats()` | `console.warn`. §B.1 note (iii): `restore()` does not re-check `assertChangesSafe`, so the dossier validator is the loop's own guard and does not assume that one |
| 30 | scheduler task | the whole run throws | yes | `{ok:false}`; the scheduler's existing ×2 backoff to ×32 applies | `console.error` |

**No `console.log` anywhere (I12).** Every row above is `warn` or `error`.

## E.9 Input validation — per external input

| Input | Required | Type / limits | On failure |
|---|---|---|---|
| `shared/autonomy-policy.json` | optional | object; exactly `{version:1, levels:{}}`; keys ∈ `EDITABLE`; values `/^L[0-4]$/`; ≤ ceiling; no extra top-level keys; ≤ 8 KB | **whole file rejected**, all classes to floor, `why` names the first violation |
| `<userData>/rama/autonomy.allow` | optional | object; `allowed === true` strictly; ≤ 4 KB | **stopped** |
| `RAMA_AUTONOMY` | optional | string; `'stop'` case-insensitive is the only recognised value | any other value ignored; **absent ≠ stop** (the file governs) |
| `lift(user, note)` | required | `user` an object with numeric `tier`; `note` a non-empty trimmed string ≤ 500 chars | `{ok:false, error}` naming what is missing |
| `finding.measurement` | **required** | `{sensor ∈ SENSORS, field: string ≤200, value: JSON-serialisable ≤2 KB, at: parsable date}` | **throws** |
| `research.sources[]` | optional, bounded | ≤ 20 entries; `ref` ≤ 2048; `claim` ≤ 2000; `sha256` 64-hex; `retrievedAt` ISO | entry **dropped and counted** in `dropped` |
| `research.unknown[]` | **required** | array; empty only with `completenessClaimed: true` | **refused** |
| `weighing.costOfDoingNothing` | **required** | non-empty trimmed string ≤ 1000 | **throws** |
| `changes[].path` | required | repo-relative; **no `..`, no absolute, no symlink, must resolve under the repo root**; not in `PROTECTED_FILES`; not `autonomyStop.cjs`/`autonomyPolicy.cjs` | **refused**; `console.error` |
| `changes[].content` | required for `patch`/`create` | string ≤ 1 MB per file, ≤ 4 MB per proposal | **refused** |
| `changes[].author` | **required** on every change | `/^template:[a-z0-9-]+$/` where the `editId` is a member of the frozen `EDITS` table; **`model:*` is refused** while `AUTHORING_MODES` is `['template']` (FR-49) | **refused** at `toProposalDef` **and again by the applier** (§E.5.0) |
| `changes[].baseSha256` | **required** for `patch` | 64-hex; **must equal `sha256` of the file on disk at apply time** | **refused** by the applier with `causeId: 'base-drift'`, naming the file and both digests; nothing written |
| **`opts` (the applier's second argument)** | required | **Recognised keys EXACTLY `{user, autonomous}`.** `user` must be an object with a numeric `tier` that `capability.can(user, 'self-modify.apply')` accepts — **no tier-0 user, no write**, derived unconditionally (FR-53). `autonomous` is **recorded into `meta.autonomy` and NEVER consulted as a gate** (FR-54). **No path, directory, plan, `cwd`, timeout, environment value or force flag is ever read from `opts`** — every such value is derived (FR-13a's rule generalised). Unrecognised keys are **ignored, not rejected**, because `proposals.cjs` may add one and this design has no veto over a protected file | a missing or non-tier-0 `user` **throws** before any read or write; a classified-input violation is impossible because nothing else is read. **This row exists because `opts` arrives from the renderer and reaches the applier WHOLE** — `preload.cjs` 680 → `proposals.cjs` 272 → `applier(p, opts)` at 235 — **while revision pass 2's §E.9 validated the proposal in six ways and had no row for `opts` at all** (review-3 finding 6). The design's own FR-13a lesson is that a persisted string used as a write destination is a leak path; an `opts.snapshotDir`, `opts.plan`, `opts.repoRoot` or `opts.force` added later is the same mistake through a different door. **Criterion 83a is the source-shape assertion that `upgradeApplier.cjs` reads no `opts` member other than `user`** |
| **`rollbackPoint.dir` as persisted** | — | **NEVER READ.** Re-derived at apply time as `path.join(userDataRoot, 'rama', 'upgrade-snapshots', proposal.id)` after `proposal.id` matches `/^[0-9a-f]{20}$/` | n/a — there is no failure mode, because the value is not consulted (FR-13a). **This row exists because `meta` is rehydrated by `restore()` on an id check alone, and a persisted path was the destination of a filesystem write under `userData` — where the STOP's allow-file lives** (review-2 finding 2) |
| `rollbackPoint.files[].path` | required when a rollback point exists | the **same resolve-then-compare + lstat rule as `changes[].path`**, and **required to be a subset of `changes[].path`** | **refused**; `console.error`. A snapshot naming a file the change does not touch is either a bug or an attempt |
| **`gateOutbound(parts, destination)`** | `parts` required, `destination` required | `parts`: `Array<string \| {text, classification?} \| {contextBlock, classification}>`, ≤ 256 entries; **an unclassified part PASSES, by decision** (FR-33b); `destination ∈ {'local','cloud'}` with **no default** | an absent or unrecognised `destination` **throws**; a classified part to a non-local destination returns `{error, classification, why, evidence}` naming the **classification, never the content** |
| `proposalId` (IPC) | required | `/^[0-9a-f]{20}$/` — `crypto.randomBytes(10).toString('hex')`'s exact shape | `{ok:false}`; never used in a path before validation |
| **`verification.plan[]` as persisted** | optional | **display-only.** `step ∈ {'node --check','suite','audit','build'}`; `target` matches `/^verify[A-Za-z0-9]+\.(cjs\|mjs)$/` and resolves under `scripts/`, **or** is one of the proposal's own `changes[].path` (the `node --check` case); ≤ 40 steps | **the persisted plan is never executed** — the plan is re-derived from `changes[]` at apply time (§E.5.2) and the persisted one is validated only to decide whether it is safe to *render*. A failing entry renders as *"plan entry rejected"*. **This row exists because `proposals.restore()` rehydrates `meta` with only an id check** (review finding 15) |
| **`step` execution** | — | `execFile`, **`shell: false`**, argument array, `cwd` = repo root, per-step timeout | a non-zero exit is a **verification failure with a `causeId`**, not an exception; a timeout is `unrecognised-exit` with `confident: false` |
| context row | required | §E.7.2's nine fields; `text` ≤ 8 KB; `at`/`retainUntil` ISO; `classification ∈ {local-only, shareable}`; `userId` non-empty; `claimClass ∈ claimGate.CLASS` when `measured === false` | **throws**, naming the field |
| `assembleContext({destination})` | required | `'local'` \| `'cloud'` — **no third value, no default** | **throws**. A default would decide the leak question by omission |
| embedding vector | required on insert | `Array<number>`, length `=== index.dims` | **refused, not stored** |

**Path validation is resolve-then-compare, not string-prefix.** `path.resolve(root, p)` must start with
`root + path.sep`, and `fs.lstatSync` must not report a symlink — a prefix check passes
`repo/../repo-evil` and a non-lstat check follows a link out of the tree.

## E.10 Invariant ownership — which layer enforces what, and why there

| Invariant | Owned by | Why that layer |
|---|---|---|
| **I6** — no source write without a recorded approval | **`proposals.cjs`, unchanged** | It already is the chokepoint. This design adds callers, never a second gate. A second gate is how two gates disagree. |
| **I6 (pre-emption)** — a protected-file proposal must not exist | `upgradeWeigh` calling **`loyaltyGuard.inspectChanges`** and forcing `needs-master-decision` | Refusing at creation is `loyaltyGuard`'s own posture; the loop refuses one step earlier so the refusal is a *verdict with reasons* rather than a thrown exception master cannot read. **And it uses the guard's own matcher, not a set intersection** — with an intersection the two algorithms disagreed on absolute and `./`-prefixed paths, so the claim that the `LoyaltyViolation` is unreachable was not established (review finding 9). Calling `inspectChanges` makes the pre-emption and the enforcement **the same predicate by construction**, which is the only way that claim holds. |
| **The policy's own authority** | `autonomyPolicy.SELF_GOVERNING_PATHS` + the proposer's outright refusal **+ the applier's re-check** (§E.5.0 check 3) | The table must not be editable by the thing it governs, and the lever is the **data file**, not only the modules. Owned by the policy module because a list living with its consumer could be narrowed by a change to the consumer alone. **The applier re-checks it because the proposer is a caller and `proposals.create` is renderer-reachable at tier 1** (FR-50, review-2 finding 3) — the proposer's refusal binds the loop, the applier's binds the kind. |
| **I6 (the kind's entry)** — a `self-upgrade` entry not filed by this loop must not be applied | **`upgradeApplier`'s seven entry validations** (§E.5.0 — six on the entry, plus check 0 on the caller) | `proposals.cjs` is protected and cannot gain a per-kind validator, and `proposals:create` passes `def` through at tier 1 with `meta` intact. **The applier is the only component this design owns that writes source**, so it is the only place that can refuse at the moment it matters. A dossier-less entry of this kind was not filed by this loop, and that is a decidable statement. |
| **The change body's provenance** | **`upgradeAuthor`'s frozen `EDITS` + `AUTHORING_MODES`** (FR-49) | *"Nothing invented by a model"* has to be owned by whatever produces the bytes, and revision pass 1 had no such component (review-2 finding 1). Owned in the author rather than checked at the proposer because a transform is reproducible — criterion 89 re-runs it and compares digests — while a check downstream could only ever ask whether the content *looks* mechanical. |
| **What a research query may carry** | **`upgradeResearch.gather`, before the first fetch** (FR-51) | The query is assembled there and nowhere else, so that is the only place the exclusion is enforceable. Owned here rather than in `gateOutbound` because the gate's job is classification, and *"Rāma's own stderr is not shareable"* is a policy about this loop's own payload (review-2 finding 13). |
| **The snapshot destination** | **`upgradeApplier`, by DERIVATION** (FR-13a) | An invariant enforced by validating an input is weaker than one enforced by not reading it. The persisted `dir` is display-only, so there is no value to validate and no branch to get wrong (review-2 finding 2). |
| **I7** — pages/routes/tiers from the registry | `src/config/registry.js` | Unchanged. New surfaces are `PAGES` entries. |
| **I8** — one capability definition | `shared/capabilities.json`, **not touched** | §E.13 specifies entries and leaves them to master. |
| **I9** — one HTTP client | `lib/http.cjs`, injected as `fetchText` | Injection makes the suite able to assert the **absence** of every other mechanism (criterion 30), which a direct require could not. |
| **I10** — one admission authority | `resourceOrchestrator.admit`, called in `gather` | The stage that spends a resource asks; the scheduler does not ask on its behalf, because `admit` needs the real `ramMB` of the actual work. |
| **I11** — additive, always a fallback | per module | Stale index → keyword search. Offline → declared non-read. No Ollama → TF-IDF at its own dims. Policy file absent → floors. Capability absent → honest refusal text. **Nothing is removed.** |
| **I12** — no `console.log`, pinned deps, no placeholders | `verifyInvariants.cjs`, unchanged | Criterion 66 adds the numeric dependency-count assertion so "zero new dependencies" is measured, not claimed. |
| **I14** — passcode change is a full re-key | **`dataStore.DOMAINS` + `sessionManager.changePasscode`, unchanged** | §E.7.1. The context store inherits the re-key **by construction**; criterion 65 is the row that keeps it true against a future DB. |
| **I15 / I16** — loyalty above the hierarchy, matrix never returned | `loyaltyGuard` / `loyaltyCore`, **not touched** | `loyalty-core` is an L0 permanent class. Nothing in this design reads, writes or backs up the core. |
| **I17** — master alone classifies a release | `releaseChannel`, **not touched** | `release-classify` is L0 permanent. Criterion 2 asserts no new file even references the module. |
| **The autonomy ceiling** | `autonomyPolicy.cjs`'s frozen `CEILINGS`/`PERMANENT` | It must be in code, not data, or the fence is editable by the thing it fences. |
| **The STOP** | `autonomyStop.cjs`, with **`isStopped()`** at **six** enumerated chokepoints and **`isHalted()`** at **four** named dispatch points | Chokepoints, not callers. The module owns the enumeration and the suite counts all three sets — chokepoints, dispatchers and the one declared exemption — and **fails if a timer is in none of them** (criterion 22b). **Two predicates, because the two questions have opposite safe directions** (FR-12, review-3 finding 3): for autonomy that does not exist yet, absence must mean *off*; for autonomy already running in master's build, absence must mean *unchanged*, or installing a safety mechanism deletes five working behaviours. **Collapsing them back into one predicate turns criterion 22d RED.** |
| **"Rāma does not start an apply"** | **An ABSENCE: zero in-process callers of `proposals.apply`**, asserted over the whole tree (criterion 21c) | **No predicate available at the applier can own this** (review-3 finding 2). `opts.autonomous` is renderer input and omittable; `opts.user` is a plain `{tier}` object that `capability.can` reads nothing else from (`capability.cjs` 27–33), so it is forgeable in-process; and `proposals.apply` already authorised it before the applier ran, so the derived predicate is tautologically true where it is evaluated. **The only enforceable statement is that the function is not called** — the shape criterion 18 already uses for `lift`, `verifyClaimGate` for its missing score, and `loyaltyCore` for its missing accessor. The future L5 caller is **named and absent**, and adding it must change this row deliberately. |
| **Master's own apply surviving a stopped install** | **`autonomyPolicy.requireMasterDriven` over the frozen `MASTER_ACT` subset** | The STOP forces `L0` on every class, and the shipped install is stopped, so an unconditional `policy.require('revert-own-apply','L4')` at the applier's entry **refused a master-approved apply on every install** (review-3 finding 1). The carve-out is owned in the policy module, as **two frozen class ids plus a function that throws for anything else** — not as a branch in the applier, because a branch there would be one `if` away from covering a Rāma-initiated class. |
| **The change body's REMEDY** | **`upgradeNotice.ADAPTERS`, frozen, per sensor** | *"Nothing invented by a model"* must also mean *"nothing inferred from prose"*. All seven `selfModel` `fixable` strings are human sentences (`selfModel.cjs` 206–266), so a prose matcher would have been model-shaped guessing performed by a regex (review-3 finding 4). Owned at the sensor boundary because that is the only place that knows the reading's structure; the author only checks `editId ∈ EDITS` and the params. |
| **The classification predicate's availability** | **`classificationGate.cjs`, dependency-free** | A gate above `chatCompletion`'s switch must not be able to fail to load. Owned outside `contextStore` because criterion 54b makes that module store-bound by design, and *"a stop that can fail to load is not a stop"* applies to a gate identically (FR-58, review-3 finding 9). |
| **The payload gate (model egress)** | `chatCompletion` **above** the provider switch | Measured as the one point every chat/completion call passes through. **Scoped to model egress deliberately: it is NOT the only outbound path carrying text**, and the **eight** measured gate call sites covering **ten** request sites each invoke the gate directly with both counts asserted (§E.7.4). |
| **The destination classification** | `destinationOf` reading `modelInfo`'s measured `cloud` field, from `ollamaCatalog.classify` | The provider name cannot answer it — Ollama serves cloud models through `localhost:11434` — and the module that already measures it is the only honest source. `cloud: null` ⇒ `cloud`, inheriting `classify`'s own asymmetry rule. |

## E.11 Testability

**Unit-testable, no Electron, no network, no Python** — because every dependency is injected, following
`selfModel` (probes), `dependencyAdvisor` (registry lookup), `refreshScheduler` (clock and store) and
`localUpdateEngine` (`packaged`/`appPath`):

`autonomyPolicy` (all of it, pure) · `autonomyStop.isStopped` (temp dir) · `upgradeNotice` (sensor
fixtures) · `upgradeResearch` (fake `fetchText`) · **`upgradeAuthor` (fixture files on a temp dir —
the highest-value new suite after `breakageAnalysis`, because every `EDITS` entry is a pure function
of bytes in to bytes out, and criterion 89's reproducibility row is a two-line test)** ·
`upgradeWeigh` (fake `git`/`analyzeImpact`, a `changes` array passed in, and a fake `guard` whose
`inspectChanges` is counted) · `upgradeProposer.toProposalDef` (pure) ·
**`upgradeApplier`'s seven entry validations (§E.5.0) — pure refusals over a hand-built proposal, no
filesystem needed for six of the seven, reached through the exported `applyWith(io, proposal, opts)`
rather than through a registered closure** (FR-57: the ledger calls `applier(p, opts)` with two
arguments, so `register(ledger, io)` closes over `io` and the suite calls `applyWith` directly) ·
**`classificationGate` (entirely pure and dependency-free — no store, no Electron, which is what
criterion 77a asserts)** ·
`breakageAnalysis` (**entirely pure and total** — the easiest and most valuable suite here, and now
including §E.5.3a's branch-to-id mapping asserted against real `diagnoseFailure` output) ·
`destinationOf` (pure, with `modelInfo` fixtures carrying `cloud: true|false|null`) ·
`vectorMemory.embed`/`tfidfVector`/`cosineSim` (**newly exported, which is what makes criterion 74
possible at all**) · `contextStore` schema, `toPlainText`/`parsePlainText`, `assembleContext`,
`gateOutbound`, `evaluateCriterion`, `retentionSweep`.

**The sync/async contract, stated because it was ambiguous** (review-1 finding 23): the six stage entry
points **`collect`, `gather`, `author`, `weigh`, `file`, `applyWith` are all `async`**; the pure
synchronous cores are
**`toProposalDef`, `analyse`, `fingerprint`, `effective`, `isStopped`, `isHalted`, `destinationOf`,
`gateOutbound`, `validate` and `evaluateCriterion`**. **`isHalted()` is synchronous for the same reason
`isStopped()` is** — it is read at the top of `runHealthSweep` and inside two `marketIntel` ticks, and
an `await` there would change the dispatch semantics of code this design is only adding a guard to. `isStopped()`'s synchronicity is load-bearing for
criterion 16 (answerable from `before-quit` and from inside a failing boot) and `gateOutbound`'s is
load-bearing for the gate sitting above `chatCompletion`'s switch without making every provider branch
await something new.

**Integration-testable in-process, no UI:** the whole five-stage run against a real `proposals.cjs` with
an injected store (the ledger's own `useStore`-style seam); apply → fail → revert against a temp repo
copy, which is exactly how `verifyLoyaltyTripwire` plants and restores and how `publishProposal` was
verified *"against a disposable scratch repo"*.

**Not testable here, and said plainly:** the `vite build` step of a verification plan (no
`node_modules`), the tray menu item, anything on a screen, and a real embedding call (no Ollama daemon
has ever been present — ledger row 132).

**Three house rules on every new suite.** (1) **A row passes only if breaking the enforcement point makes
it go RED** — **fifteen** planted mutations: a permanent class moved into `EDITABLE` (c10), a removed STOP
chokepoint (c20), a removed stop-path refusal (c19), **a path removed from `SELF_GOVERNING_PATHS`
(c19a)**, **a deleted `policy.require` call (c13)**, a restated protected list (c4/c4b), a second
persistence mechanism (c65), the context domain added to a backup manifest (c80), **a poisoned
`rollbackPoint.dir` (c82a)**, **a ninth ungated outbound request (c54a)**, **a timer in neither
`DISPATCHERS` nor `stopExempt` (c22b)**, **a hand-built dossier-less proposal of the diff kind
(c19b)**, and **three added in revision pass 3: a third class added to the frozen `MASTER_ACT` subset
(c21b), `isHalted()` made to read the allow-file — i.e. the two predicates collapsed back into one
(c22d), and an in-process call to `proposals.apply` added anywhere in the tree (c21c)**. (2) **The planted breaches run
unconditionally** — *"a suite whose own breach detection sits behind a flag is one whose breach detection
nobody runs."* (3) **Residuals printed and counted on every run** (criterion 63), listing at minimum:
`autonomyPolicy.cjs`/`autonomyStop.cjs` not in `PROTECTED_FILES`; `proposals.restore()` not re-checking
`assertChangesSafe`; `vite build` unverified; `suiteCoverage` being a textual association; `analyzeImpact`
being a substring scan; **`proposals.STATUS` having no term for "applied then reverted", so the verdict
lives in `meta.verification.result`**; **the seven non-model outbound text paths being gated by a counted
CALL rather than by a chokepoint**; **`voiceEngine` sending audio the text gate cannot inspect**;
**`proposals.create` being reachable from the renderer at tier 1 and consulting neither the autonomy
policy nor the stop — so the proposer's refusals bind the loop and only the applier's validation binds
the kind** (§E.5.0); **`evolutionEngine.readRepoFiles` reaching `githubAPI` ungated, carrying
repository and path names**; **`agentOrchestrator`'s governor being `stopExempt`, so a reaper keeps
running while everything else is halted**; **`upgradeAuthor` being template-only, so `build-repair`
means only what the `EDITS` table can express and most findings will file a question rather than a
fix**;
**no `ollamaCatalog.classify` output ever observed against a real daemon (row 132), so the egress
classification is fixture-tested only**; **`vectorMemory`'s pre-existing index possibly holding mixed
dimensions, reported as a `mixedDims` count rather than repaired**; **and six added in revision pass 3**
— **`gateOutbound` at §E.7.4's sites 1–7 is an AUDIT POINT, not an enforcement point, because every
part there is a bare string and FR-33b's declared default is that a bare string passes; what enforces
FR-51 at those sites is the construction of the query** (review-3 finding 10); **six of seven sensors
can reach no declared edit and three of four `EDITS` entries have no producing adapter, so this loop
can author exactly one kind of change today — a dependency version pin** (criterion 90a); **the four
pre-existing dispatchers are NOT halted by an absent allow-file, only by an explicit engage, so a
shipped install still runs `ollama-catalog`, `dependency-review`, the metacognition audit, the
120-second health sweep and `marketIntel`'s two ticks** (FR-12); **`proposals.apply`'s `opts` is
renderer input that reaches the applier whole, so `opts.autonomous` is recorded and never trusted, and
"Rāma does not start an apply" rests on an asserted absence of in-process callers rather than on any
predicate** (criterion 21c); **`capability.can` reads only `user.tier`, so a tier-0 `user` object is
forgeable by any in-process caller** — which is why the absence above is the guarantee and the derived
`masterDriven` check is only defence in depth; **and the verification plan's SPAWNED steps write files
this design does not write — `vite build` → `dist/`, each suite → its own temp dir — a declared FR-1
exception paid for by criterion 83's `cwd` and argument-provenance assertions rather than by a
sentence**; and the **nine** open items in §I.

## E.12 Renderer surfaces

Two `PAGES` entries in `src/config/registry.js` (I7), both at tiers the matrix already defines:

- **Evolution → Dossier.** `Evolution.jsx`'s existing `ProposalCard` gains a collapsible dossier: the
  requirement with its measurement, the sources with retrieval times, pros/cons **with the cost of doing
  nothing given equal weight**, the computed blast radius, the verification plan and its result, and the
  rollback point. Plus **"Approve selected"**, which loops single approvals and renders a per-item result
  including partial failure (criterion 44).
- **Settings → Autonomy.** `policyStatus()` rendered as the **15-row** table with **floor, effective
  level and ceiling as three distinct columns** — three, not four, because the data file ships absent
  so there is no shipped level distinct from the floor (§E.1.2's corrected legend is the panel's
  legend too) — **permanent rows visibly marked unraisable**, the policy file's validity (and `why` when
  rejected), **its `fileSha256` and whether that digest is ledger-attested** — *"policy file changed
  <when> — no ledger record"* when it is not (criterion 84) — the STOP's state with its three engage
  routes, **the snapshot count and total bytes** (criterion 81), and, when no allow-file exists, the
  §E.2.7 sentence stating that Rāma is noticing nothing and proposing nothing.
  **Plus the two things revision pass 3 requires the panel to say out loud** — because a panel that
  renders one of two states as if it were both is the `badgeLabel` defect:
  **(a) BOTH halves of the autonomy state, enumerated by name** (FR-12, criterion 22d) — the six new
  chokepoints as *stopped*, and the four pre-existing dispatchers listed individually as **still
  running** (`ollama-catalog`, `dependency-review`, the metacognition audit, the 120-second health
  sweep, market outcome resolution, news sync) with the tray route to halt them, or as **halted** with
  the reason read out of `autonomy.stopped.json`; and **(b) when `propose-question` has been restricted
  to L0 by master's own data edit, the sentence *"Rāma is noticing and researching, and may file
  nothing — you set `propose-question` to L0"*** (FR-59, criterion 13a), so a loop silenced by data is
  never indistinguishable from a loop with nothing to say. Where
  `system.suspend-autonomy` is absent it says so (§E.2.4) — **no dead buttons**, which is the defect
  Section 59 removed.

Every value renders through the `Fact` component pattern Section 126 established: `{value, source,
measured}`, with an unmeasured field reading *"not measured"* in italics and **never** as `0`, `false` or
*"unknown"*, because those read as findings. The header pill **counts what is blocked, not a score** —
*"an index invites 'make the number go up'; a count of named gaps each with a fix invites closing one."*

## E.13 For master — the exact `shared/capabilities.json` entries, NOT added here

`shared/capabilities.json` is a **protected file** under `verifyLoyaltyTripwire.cjs`. This design does not
touch it. **Add these three entries, each with its tier:**

```json
"system.suspend-autonomy": 0,
"autonomy.view":           1,
"memory.record-prompts":   0
```

| Key | Tier | Why that tier | How the feature degrades until it is added |
|---|---|---|---|
| `system.suspend-autonomy` | **0** | Lifting a stop is the most consequential control in the design. Section 124's R-L4 already specified tier 0. | **`can()` returns `false` for an unknown capability, for everyone.** So the STOP **cannot be lifted in-app at all** — only by master writing the allow-file by hand. Safe direction. The UI names the missing key instead of showing a dead button. |
| `autonomy.view` | **1** | Reading the policy table is the same sensitivity class as `self-modify.view` (1). | The Settings → Autonomy panel renders *"not available — `autonomy.view` is not in the capability matrix"*. `policyStatus()` still works in-process, so the loop is unaffected. |
| `memory.record-prompts` | **0** | Addendum A: a privacy consequence master must accept. Default off even once present. | The recording surface renders *"not available — master has not added `memory.record-prompts`"* and **writes nothing**; criterion 56 is a filesystem assertion that no file is created. `selfModel` keeps reporting the prompt-text limit (criterion 57). |

**Also for master, and this design cannot do it:** add `electron/lib/autonomyPolicy.cjs` and
`electron/lib/autonomyStop.cjs` to `loyaltyGuard.PROTECTED_FILES` and to
`shared/loyalty-tripwire.json`'s manifest. `loyaltyGuard.cjs` is itself protected, so the edit needs
master's digest-matched approval (`--approve` with the exact digest **plus a `--note`**). Until then the
suite **prints the residual on every run** (§E.1.3).

---

# PART F — READY-TO-PASTE BLOCK A: spec section

> **Paste into `RAMA_AGI_MASTER_SPEC.md` in NUMERIC POSITION — after Section 127 (*What Rāma may
> remember about master*) and BEFORE Section 129/130.**
>
> **VERIFY THE TARGET IMMEDIATELY BEFORE PASTING. Do not trust this note's numbers; run the method**
> (review-3 finding 14):
>
> ```
> grep -n '^## SECTION 1\(2[6-9]\|3[0-9]\)' RAMA_AGI_MASTER_SPEC.md
> grep -n '^| 1\(4[4-9]\|5[0-2]\) |'        RAMA_AGI_MASTER_SPEC.md
> ```
>
> **Measured on `dev` during revision pass 3:** Sections **125, 126, 127, 130 and 129** exist — **in
> that FILE order, with 129 sitting AFTER 130** (lines 14116 and 13973). Ledger rows **144/145/146**
> are `done`; **147** (Section 127), **150** (Section 130) and **149** (Section 129) are taken, with
> **150 appearing before 149** in the table. **So Section 128 and row 148 are free and the paste
> targets are correct — but revision pass 2's supporting claim that "128 and 129 are free" and "148
> and 149 are unused" is WRONG**, and a cold session trusting it could file over Section 129. **Hence
> the method rather than the number: a checked claim goes stale between passes, a command does not.**
>
> **And "numeric position" is a preference here, not a description of the file.** 129 already follows
> 130 and 150 already precedes 149, so the spec does not currently keep numeric order; Part F asks for
> it because it is the better habit for the next reader, not because the file is tidy.
>
> Section 130 §130.11 states outright that *"the storage decision
> is being resolved inside Section 128's design"*, so this is the section it points at.
>
> Nothing here has been written into the spec by this run; the spec was read and not modified, as
> instructed.

```markdown
## SECTION 128 — Rāma proposes, master approves: the self-maintenance loop and its fence

Master: *"BaseLine mode is 'Rama' Super ASI/AGI modal which should exponentially grow consciousness and
capability and start upgrading itself after considering all the inputs for upgrading and weighing pros
and cons. Trying to reduce burden on MASTER as it should maintain, repair, upgrade itself for better but
need to have previous version fallback incase of breakage and analyse the breakage build and resolve it
accordingly."* Then, asked to choose: **option 1 — keep I6 and I17 intact; Rāma PROPOSES, master approves
in one click.** And: *"Rāma itself is a model; exponential increase means understanding requirement and
upgrading/proposing upgrades after thorough research & review."* And: *"Utilise DB to store context which
can be understood by any model."*

Full design: `docs/research/SELF_UPGRADE.md`.

**THE FENCE, AND IT IS THE WHOLE DESIGN: THE AUTONOMY IS IN THE RESEARCH AND THE PROPOSAL, NEVER THE
APPLICATION. Nothing designed here applies a source change without a recorded master approval — not a
dependency patch, not a build repair, not ever.** I6 unchanged, I17 unchanged, `proposals.cjs` **byte-identical**
(asserted by sha256), the seven protected files untouched, `shared/capabilities.json` untouched.

**THIS IS NOT A FROM-SCRATCH BUILD, AND SAYING SO IS THE FIRST FINDING.** The propose→approve→apply spine
(`proposals.cjs`: `create` refusing protected paths **at creation** because *"a proposal sitting under an
Approve button invites master to authorise what no authority covers"*; `approve`/`apply` refusing a
free-text approver because *"a name is not an identity"*; encrypted durability with bodies stripped once
decided), the sensors (`selfModel.limits[]` already deriving `{what, why, source, fixable}` from what is
absent **right now**; `dependencyAdvisor`; `astEngine`; `metaCognition`; 25 suites), the diagnosis
vocabulary (`verifyEngineDiagnosis`), the admission authority (I10) and the release gate (I17) **are all
built and working. THE GAP IS POLICY, A BREAKAGE LOOP, AND A CHANGE AUTHOR THAT IS NOT A MODEL.**
Measured: NOTICE exists as
data nothing reads; RESEARCH exists for exactly one subject; **NOTHING AUTHORS A CHANGE EXCEPT A MODEL
— `codeRegenEngine.generateFix` BUILDS A PROMPT AND RETURNS `{prompt, researchContext}`, and the bytes
come back from a model — so a loop that files diffs has no producer of diffs that measurement could
vouch for;** **WEIGH is asserted never computed —
`risk:'medium'` is a literal the caller passes**; PROPOSE is the strongest part of the system; **AFTER
APPLY DOES NOT EXIST AT ALL — `proposals.apply` sets `FAILED`, stores `err.message`, and leaves Rāma's
source changed with master holding a string.**

**THE POSTURE IS COPIED, NOT INVENTED: `dependencyAdvisor.cjs`'s header is the argument.** *"IT NEVER
UPGRADES ANYTHING. I12 pins every dependency deliberately; an advisor that could act would turn a pinned
set into a moving one."* Six habits inherited verbatim: **`unchecked` ≠ `no-advisory-found` ≠
`verified-clean`** (*"the most tempting dishonesty in this module"* — an absent result is never a clean
result); a major bump is `breaking` by **the author's own signal**; commentary is `status:'unverified
claim'`, attributed, and **cannot by itself set the recommendation**; **deltas not absolutes, absent not
zero**; **`'master decides'` is a first-class verdict**; and **one proposal with `changes: []` because
*"twenty separate approvals is a queue master will stop reading."***

**THE AUTONOMY POLICY TABLE — RSP/Preparedness SHAPE, which Section 124 §2.5 already identified as the
pattern worth importing: rungs declared in advance, each naming its safeguard, a rung entered only when
an evaluation says so, AND AN UNDETERMINED EVALUATION DEFAULTING TO THE STRICTER RUNG.** Section 124's
finding was that Rāma has the components and **no ladder** — the matrix answers *"may this user do
this?"* and **nothing answered *"has Rāma earned this?"*** Six levels (`L0 forbidden` → `L1 observe` →
`L2 research` → `L3 propose-only` → `L4 apply-after-approval` → **`L5 apply-autonomous`, DECLARED AND
UNREACHABLE**). **L5 exists in the ladder precisely so that turning it on would be ONE VALUE IN ONE
FROZEN CONSTANT, VISIBLE IN A DIFF, with a suite row that currently asserts it is impossible — rather
than a new concept invented later, which is how a stop gets retrofitted.** **FIFTEEN classes. CLASSES,
FLOORS, CEILINGS AND THE PERMANENT SET ARE FROZEN CONSTANTS IN CODE; ONLY THE LEVELS OF NON-PERMANENT
CLASSES ARE DATA — AND THE DATA FILE SHIPS ABSENT, SO THE FLOORS ARE THE SHIPPED LEVELS.** **THE FLOOR
IS A FALLBACK, NOT A MINIMUM: a present data file may RESTRICT any editable class below its floor —
which is how master puts Rāma offline (`research-network` → L1) or turns the automatic revert off
(`revert-own-apply` → L0) — and may RAISE one only as far as its frozen ceiling. DATA MAY ALWAYS
RESTRICT **AN EDITABLE CLASS**; IT MAY RAISE ONLY WITHIN A CEILING; AND **FOR A PERMANENT CLASS IT IS
NOT READ AT ALL — SO MASTER CANNOT LOWER `master-record` OR `loyalty-core` BY DATA EITHER, ONLY BY A
SOURCE EDIT UNDER AN I6 APPROVAL. The three clauses travel together, because the first one alone says
master has a lever he does not have.** **NO
FLOOR EXCEEDS `L4 apply-after-approval` AND NO FLOOR IS EVER `L5`; the two L4 floors —
`apply-source` and `revert-own-apply` — describe APPLYING OR UNDOING A CHANGE MASTER ALREADY APPROVED,
which is master's act and not Rāma's autonomy; and NO CLASS WHOSE ACTION RĀMA INITIATES HAS A FLOOR
ABOVE `L3 propose-only`, asserted over a declared frozen `RAMA_INITIATED` SUBSET rather than left as a
sentence a coder would have had to contradict.** **`revert-own-apply`'s FLOOR IS L4 AND THAT IS A
CORRECTION WORTH STATING: it was L0, the data file ships absent, and `apply()` checks
`policy.require('revert-own-apply')` at entry — so on every shipped install a master-approved
self-upgrade COULD NOT HAVE BEEN APPLIED AT ALL and the automatic revert the whole AFTER-APPLY
guarantee rests on was FORBIDDEN. The floor is the level that must hold when configuration is absent,
and for a safety net that level is "works".** **SIX classes are PERMANENT** and can never be raised by anyone: `apply-source` (I6,
permanent-at-L4 — it can never become L5), `release-classify` (I17), `capability-grant` (I8),
`loyalty-core` (I15/I16), — master's decision in Section 127 — **`master-record`: Rāma may never widen
its own retention window or capture scope**, and **`autonomy-policy`: the policy table's own DATA FILE,
the two modules that implement the policy and the stop, and the tripwire manifest. THAT LAST CLASS IS
THE ONE A FIRST DRAFT MISSES, AND MISSING IT IS THE WHOLE GAME: the policy data file sits under the repo
root and is the ONE LEVER THAT RAISES A CLASS, so without it a one-key JSON diff raising `propose-source`
from L1 to L3 could have sat in the queue WITH AN APPROVE BUTTON NEXT TO IT. RĀMA MAY NOT PROPOSE ITS OWN
PROMOTION, and the refusal is OUTRIGHT — not downgraded to a question, because a question asking to be
promoted is still asking to be promoted.**

**THE MECHANICAL ANSWER TO "WHAT STOPS RĀMA PROPOSING AN EDIT TO THE POLICY FILE?" — AND IT HAD TO BE
MECHANICAL, NOT A COMMENT: THE DATA FILE CARRIES NO AUTHORITY OVER A PERMANENT CLASS BECAUSE THE LOADER
NEVER READS ONE FROM IT.** `"master-record": "L4"` is not a value that loses a `min()`; it is a key with
no reader. **AND THE FILE IS REJECTED WHOLE, NOT PER-KEY** — on an unknown class, a permanent class, a
bad level, `L5` anywhere, a level above a ceiling, an extra top-level key or unparsable JSON, **EVERY
CLASS FALLS TO ITS FLOOR.** Reason: *a partial accept teaches whoever wrote the file which edits are
silently dropped and lets the rest through*, so a proposal mixing one forbidden raise with four
legitimate lowerings would land four of five and look like it landed nothing — the same reasoning
`claimGate` uses when it marks the **whole** answer `unattributed` if any finding was withheld.
**Raising a permanent class therefore requires editing `autonomyPolicy.cjs`, an I6 source change, and A
PLANTED MUTATION MOVING `master-record` OUT OF THE FROZEN PERMANENT SET MUST TURN THE ROW RED.**

**AND THE POLICY FILE'S OWN DIGEST IS RECORDED AND LEDGER-ATTESTED, BECAUSE R-G2's GATE IS "MASTER-ONLY
ADVANCEMENT, RECORDED IN THE LEDGER (I17's SHAPE)" AND A HAND EDIT TO A JSON FILE SATISFIES NO PART OF
THAT.** `load()` records `fileSha256`; `policyStatus()` reports `{fileSha256, ledgerAttested, attestedBy,
attestedAt}`; an unattested digest **warns once and the panel reads "policy file changed <when> — no
ledger record"**; master records an advancement with one tier-0 call that files a **question-kind ledger
entry carrying the digest**. **The effective levels still apply unattested — silently ignoring master's
edit would be worse than reporting it unrecorded. WHAT IS WITHHELD IS THE CLAIM THAT IT WAS RECORDED.**
**AND THE SEQUENCE MASTER ACTUALLY PERFORMS IS WRITTEN DOWN IN ONE PLACE, BECAUSE IT WAS TRUE IN THREE:
HE EDITS `shared/autonomy-policy.json` BY HAND — it is NOT a proposal, the proposer refuses any change
naming it — THEN RELOADS OR RESTARTS, THEN CALLS THE TIER-0 ATTEST CHANNEL. NO BUILD IS REQUIRED, AND
THAT HAS TO BE SAID OUT LOUD BECAUSE `localUpdateEngine.classifyChange` RETURNS `'renderer'` FOR
ANYTHING UNDER `shared/` — the right answer for the files it was written about, and wrong here: THIS
FILE IS READ BY THE MAIN PROCESS AND IS NOT BUNDLED, so a later session trusting `classifyChange` would
believe a `vite build` was needed for a policy edit, and `vite build` is the one step that cannot be
verified in this workspace.**

**THE ARITHMETIC, STATED ONCE AND ASSERTED BY A SUITE ROW SO TWO PROSE BLOCKS CANNOT DRIFT APART:**
**SIX** permanent classes the data file is not read for; **ELEVEN** with `floor === ceiling`, of which
the five non-permanent ones data can only **LOWER**; and **FOUR** with `floor < ceiling` —
`propose-source`, `dependency-change`, `build-repair` and **`author-change`** — which are **THE LIVE
RAISE PATH**, where raising one is **A DATA CHANGE PLUS A MASTER APPROVAL WITH NO SOURCE EDIT.**
6 + 5 + 4 = 15. **AND A DIFF NEEDS TWO OF THEM RAISED, NOT ONE: `author-change` permits the bytes to
be produced and `propose-source` permits them to be filed.** **AND THERE ARE TWO GATES, NOT ONE, WHICH A
READER MUST NOT CONFLATE: AS ACTUALLY SHIPPED THERE IS NO ALLOW-FILE, SO THE STOP IS ENGAGED, EVERY
CLASS RESOLVES TO L0 BEFORE THE RESOLVER EVER LOOKS AT THE DATA FILE, AND THE LOOP READS NO SENSOR AND
FILES NOTHING** — a scheduler tick does nothing at all, and a suite row asserts exactly that. **ONCE
MASTER CREATES THE ALLOW-FILE — ONE FILE, NOT TWO, SINCE THE POLICY FILE'S ABSENCE IS THE DESIGNED
STATE — THE BEHAVIOUR IS "NOTICE, RESEARCH, AUTHOR NOTHING, WEIGH, AND THEN FILE A QUESTION"**
carrying the whole dossier and `blockedBy: 'propose-source is L1; L3 required'`. Master reads a researched, weighed,
blast-radius-computed account of a real measured defect and decides whether to raise the class — rather
than deciding on a diff Rāma produced before anyone agreed it should. **THIS KEEPS SECTION 124's
MEASUREMENT TRUE AFTER THIS SHIPS: the loop's scheduler task is a READ that files a question, the
`dependency-review` shape, Level 2 (Consultant). NO AUTONOMY RUNG IS CLIMBED BY THIS SECTION.**

**THE STOP — DESIGNED NOW, WHILE NOTHING IS AUTONOMOUS, BECAUSE A STOP RETROFITTED ONTO A RUNNING LOOP
IS THE ONE THING THAT MUST NOT BE RETROFITTED.** Section 124 found there is no *"stop all autonomous
activity, stay running, stay inspectable"* control, which is exactly what an operator wants during an
investigation. **IT IS A POSITIVE ALLOWANCE, NOT A STOP-FLAG: `<userData>/rama/autonomy.allow` carrying
`{"allowed":true}`, and `allowed !== true` STRICTLY means stopped — so `"true"`, `1`, `{}`, invalid JSON,
a zero-byte file, a directory and AN ABSENT FILE ALL RESOLVE TO STOPPED.** The direction is the whole
point: **a stop-flag means the default state of a fresh install, a wiped profile, a half-written file or
a permissions error is RUNNING**, and fail-safe requires the uncertain state to be the safe one, so the
safe state must be the one that needs **nothing** to be true. Anthropic's precautionary-activation
posture at the smallest scale — **an unreadable flag is an undetermined evaluation, and an undetermined
evaluation takes the stricter rung.** **DEPENDENCY-FREE AND SYNCHRONOUS** (`fs`/`path`/`os` only, no
`electron`, no store) so it answers from `before-quit`, from a suite, from before the store is unlocked
and from inside a failing boot — *`selfRepair` already made this argument: a repair mechanism that needed
a third-party package could not repair a missing third-party package.* **ITS STATE LIVES OUTSIDE THE
REPO, WHICH IS WHAT MAKES IT UNNAMEABLE BY ANY `changes[].path` — a proposal cannot target a file the
diff format cannot address.** **ENGAGING NEEDS NO CAPABILITY AND NO RENDERER** — tray item, `RAMA_AUTONOMY=stop`
checked FIRST and overriding a valid allow-file, or deleting the file by hand; **a stop that can be
refused is not a stop, and gating it would make the one control an operator reaches for during an
incident depend on the subsystem being investigated.** **LIFTING IS THE ONLY GATED DIRECTION** and needs
tier-0 `system.suspend-autonomy`, a real `user` and a typed note — **and since `capability.can()` returns
FALSE FOR AN UNKNOWN CAPABILITY FOR EVERYONE INCLUDING MASTER, until he adds that key THE STOP CANNOT BE
LIFTED IN-APP AT ALL, which is the correct failure direction and needs no special-casing.** **RĀMA CAN
NEVER LIFT IT: there is NO INTERNAL CALLER of `lift` and a source-shape assertion finds exactly zero —
the way `verifyClaimGate` asserts the ABSENCE of a score.** **SIX ENUMERATED CHOKEPOINTS, not callers**
(*"gating six callers leaves the seventh"*), with the count PRINTED so coverage cannot silently shrink.
**WHAT IS NOT STOPPED IS NAMED: master's direct requests, `PRIORITY.CRITICAL`, chat, StockMind, the UI,
the ledger, AND `proposals.approve`/`proposals.apply` — because A STOP THAT ALSO BREAKS THE APP IS A STOP MASTER WILL NEVER USE, which would make it
worse than none. THE STOP GATES RĀMA STARTING AN APPLY, NOT MASTER APPLYING ONE — because applying an
approved proposal is reachable only through a tier-0 `proposals:apply`, this design's own framing is
that the application is MASTER'S ACT, and THE SHIPPED INSTALL IS PERMANENTLY STOPPED, so gating it
would have meant master could approve a change and never be able to apply it, on every install,
forever.**
**AND THE MECHANISM FOR THAT IS DECLARED DATA PLUS AN ASSERTED ABSENCE, NOT A FLAG — TWO DRAFTS GOT IT
WRONG IN OPPOSITE DIRECTIONS AND BOTH ARE RECORDED. An unconditional `policy.require('revert-own-apply',
'L4')` at the applier's entry REFUSED A MASTER-APPROVED APPLY ON EVERY SHIPPED INSTALL**, because the
STOP's first resolver line forces `L0` on every class and the shipped install has no allow-file — and
the same hole was reachable with a valid allow-file through `RAMA_AUTONOMY=stop`. **And checking the
STOP "only when `opts.autonomous === true`" PUT THE PREDICATE IN THE HANDS OF THE PARTY THE STOP EXISTS
TO STOP: `opts` is renderer input passed through untouched, so a future autonomous applier would bypass
the STOP BY OMITTING A FIELD — this design's own "gating six callers leaves the seventh" doctrine
failing on itself.** So: **`apply-source` and `revert-own-apply` are a FROZEN `MASTER_ACT` SUBSET, and
the only function that may ignore the STOP — `requireMasterDriven(classId, need)` — THROWS for any
class outside it**, which is what keeps master's apply alive without opening the stop to anything Rāma
initiates. **`opts.autonomous` IS RECORDED INTO `meta.autonomy` AND NEVER READ IN A CONDITIONAL.** And
**"Rāma does not start an apply" IS HELD BY AN ASSERTED ABSENCE — ZERO IN-PROCESS CALLERS OF
`proposals.apply` ANYWHERE IN THE TREE — because no predicate at the applier can hold it:
`capability.can` reads only `user.tier`, so a `{tier: 0}` object is forgeable in-process, and
`proposals.apply` already authorised `opts.user` before the applier ran, making the derived check
tautologically true where it is evaluated. THE STRONGEST GUARANTEE AVAILABLE IN JAVASCRIPT IS THAT THE
FUNCTION IS NOT CALLED** — the shape this project already uses for `lift`, for `claimGate`'s missing
score and for `loyaltyCore`'s missing accessor. The future L5 entry point is **NAMED AND ABSENT**, and
it is the one that would consult the STOP, because a start-of-work check belongs in the function that
starts the work.
**AND THERE ARE TWO STATE PREDICATES, NOT ONE, BECAUSE THE TWO QUESTIONS HAVE OPPOSITE SAFE
DIRECTIONS. `isStopped()` — fail-safe, absence means STOPPED — governs the six new chokepoints, where
nothing is lost because nothing is there yet. `isHalted()` — true only on an EXPLICIT engage — governs
the four PRE-EXISTING dispatchers, where absence must mean "as the build master already has".
GOVERNING BOTH WITH THE FAIL-SAFE PREDICATE WOULD HAVE DELETED FIVE WORKING BEHAVIOURS ON EVERY
INSTALL — `ollama-catalog`, `dependency-review`, the metacognition audit, `selfCare`'s 120-second sweep
INCLUDING `checkInstanceFailover`, and `marketIntel`'s two ticks — until master hand-created a file
nobody had told him about: A REGRESSION WEARING A FAIL-SAFE ARGUMENT, and I11 has no exception for
well-meant ones. THE ASYMMETRY IS PRINTED BY NAME IN BOTH STATES rather than labelled, because
"stopped" over five live timers is the badge defect in a new place. And a first-run migration that
wrote an allow-file was REFUSED: that file is what `isStopped()` reads, so every upgraded profile would
have started with the NEW loop allowed.**
**AND WHAT IS HALTED IS HALTED WHERE THE WORK IS ACTUALLY DISPATCHED, NOT BY A WRAPPER
ON THE LOOP'S OWN TASK — FOUR DISPATCH POINTS, EACH MEASURED: a stop check INSIDE
`refreshScheduler.runNow` BEFORE `await task.run()` — the single dispatcher every scheduled task passes
through, so `ollama-catalog` and `dependency-review` are covered too; `metaCognition` GAINING
`startAudit`/`stopAudit`, because its audit timer is armed inside `register()` and its existing
`stop()` HAS NO RE-ARM, so without that a lift could not restart it; `selfCare` GAINING
`startSweep`/`stopSweep` PLUS AN `isStopped()` CHECK INSIDE `runHealthSweep`, BECAUSE MEASURED IT
AUTO-ARMS A 120-SECOND SWEEP AT `register()` AND THAT SWEEP CALLS `checkInstanceFailover()`, WHICH PER
LEDGER ROW 49 EXPRESSES A DORMANT GENE ON A SIBLING INSTANCE — state-changing autonomous work running
unconditionally on every shipped install, NEITHER HALTED NOR DECLARED by a first draft that named two
dispatch points and believed it had named them all; and `marketIntel`'s TWO BACKGROUND TIMERS through
the `stopScheduler()` it already exports plus a check inside each tick, WHILE MASTER'S ON-DEMAND
STOCKMIND CALLS — which arrive through IPC handlers, not these ticks — STAY UNTOUCHED.** **PLUS THE
TEARDOWN R-L4 NAMES AND A FIRST DRAFT OMITTED: `engage()` KILLS RUNNING AGENTS AND SANDBOX CHILDREN
through the paths those modules already use internally, so a stopped Rāma does not leave autonomous
children alive behind it.** **AND ONE DECLARED EXEMPTION, PRINTED WITH ITS REASON RATHER THAN SHIPPED AS
AN EMPTY SET: `agentOrchestrator`'s GOVERNOR, because measured IT ONLY REAPS — halting a reaper does not
stop work, it leaves hung agents running and unassimilated, which that module's own comment calls
"necrosis rather than programmed death". EVERY TIMER THE STOPPED LABEL NAMES IS ASSERTED ACTUALLY
HALTED, AND A TIMER IN NEITHER THE DISPATCHER LIST NOR THE EXEMPT SET FAILS THE ROW — because an empty
exempt list read as "nothing is exempt" when the truth was "nothing had been looked for".**
**ONE DELIBERATE EXCEPTION: AN IN-FLIGHT REVERT COMPLETES** — stranding a
half-applied change leaves Rāma's source in a state nobody chose, which is worse than either endpoint,
and a revert can only restore bytes master already had. **AND THE EXCEPTION IS A TOKEN, NOT A CARVE-OUT
INSIDE THE RESOLVER: `effective()` IS PURE AND CANNOT KNOW A REVERT IS IN FLIGHT, so `apply()` checks the
policy ONCE AT ENTRY BEFORE ANY WRITE and issues a token carrying the snapshot FILES BY VALUE AND THE
DERIVED SNAPSHOT DIRECTORY; `revert(token)` consults NEITHER the policy NOR the stop, and A TOKENLESS
REVERT IS REFUSED.** A carve-out inside the resolver
would have refused the very revert it existed to permit. New reverts are not started. Visible through
`badgeLabel`, so
`verifyBadgeLabel`'s existing rule applies: **every named timer must still exist on disk or the suite
goes red rather than the badge going on claiming it** — the defect that file exists to fix.

**THE FIVE-STAGE LOOP, each a named testable module — PLUS THE STAGE A FIRST DRAFT FORGOT TO HAVE.**
**(1) NOTICE — `upgradeNotice.cjs`: A FINDING
WITHOUT A `measurement` DOES NOT EXIST; `notice()` THROWS, because a caller that invents a requirement is
a bug and not a degraded input. NOTHING IS INVENTED BY A MODEL, and nothing needs one — all seven sensors
are already computing their value for another reason** (`selfModel.limits[]` where `fixable !== null`,
mapping FIELD-FOR-FIELD onto the requirement; `dependencyAdvisor.review(rows).actionable` over the rows
`registrySources.collect` builds from `package.json` — **named, because `review()` with no argument
returns an empty review and a first draft wrote exactly that**; `astEngine` issues;
a failing suite BY ROW NAME; `metaCognition` profiles; `diagnoseFailure`; `auditRenderer`).
**Fingerprint = sha256(class, sensor, field) — DELIBERATELY EXCLUDING THE VALUE, so a quality score
sliding 71→70→69 is ONE defect and not three proposals.** **Absence is not a finding:** no sensor
reporting anything yields `[]` with `sensorsAbsent[]` naming what could not be read — *"nothing was read"
must never render as "nothing happened".* **(2) RESEARCH — `upgradeResearch.cjs`: three mandatory fields,
WHAT WAS READ (with `retrievedAt` and a sha256 of the bytes, so a later session can tell the source
changed under it), WHAT IT SAID (`'read from source'` only when bytes were read this run; everything else
`'unverified claim'` WITH AN ATTRIBUTION), AND WHAT IS STILL UNKNOWN — mandatory, and a researcher
claiming nothing is unknown must set `completenessClaimed: true`, WHICH WEIGH SURFACES AS A CON. A record
with no sources AND no unknowns is REFUSED: a record that read nothing and wonders nothing is not a
record.** Every byte through `lib/http.cjs` (I9, asserted by the ABSENCE of `https`/`fetch`/`axios` in
every new file) under `admit()` at `BACKGROUND` (I10). **OFFLINE IS A DECLARED OUTCOME, NOT AN ERROR —
and the specific trap Section 124 §5(a) named is asserted absent: NO REMEDY MAY NAME A NETWORK-REQUIRING
ACTION, which is exactly the bug `researchPlan` still has in offering `models:refresh-catalog` to an
offline user.** **AND RESEARCH IS ITSELF AN OUTBOUND TEXT PATH, SO IT CALLS THE GATE AND WHAT IT MAY
CARRY IS DECIDED HERE RATHER THAN BY WHOEVER IMPLEMENTS IT: A QUERY MAY CARRY THE FINDING'S `what` AND A
SENSOR'S FIELD NAME. IT MAY NOT CARRY `measurement.value`, A FILE'S CONTENTS, OR ANY STDERR EXCERPT —
because a stderr excerpt from a failing suite carries master's paths and a module's internals, and
"search the web for Rāma's own error text" is a decision master has not been asked to make. The query
parts are RECORDED IN THE DOSSIER so what left the machine is auditable, and the excluded fields are
asserted ABSENT from the query string. AND EVERY PART IS CONSTRUCTED WITH AN EXPLICIT
`classification` — `shareable` for the `what` and the field name, `local-only` for anything derived
from `measurement.value`, file contents or a stderr excerpt — BECAUSE THE GATE'S DECLARED DEFAULT IS
THAT A BARE STRING PASSES, so a draft that passed two bare strings had a gate call that COULD NEVER
REFUSE while the prose credited it with enforcement. A VERIFICATION STEP THAT CANNOT FAIL IS NOT A
VERIFICATION STEP, and classifying at the source turns the assertion into a positive case that can go
red.** **(3a) AUTHOR — `upgradeAuthor.cjs`, AND IT EXISTS BECAUSE A
FIRST DRAFT DESCRIBED A LOOP THAT COULD NOTICE, RESEARCH, WEIGH, PROPOSE, APPLY AND REVERT WHILE
NOTHING PRODUCED THE DIFF IT PROPOSED. A class permitting a diff to be filed is EMPTY if nothing makes
one. THE AUTHOR IS TEMPLATE-ONLY: a FROZEN `EDITS` TABLE of mechanical transforms — pin a version, add
an export, add an array member, replace one exact literal — each with declared preconditions, each
reading the CURRENT BYTES and returning a function of them, so `changes[].content` IS REPRODUCIBLE and
a suite row re-runs the transform and compares digests. THAT IS WHAT "NOTHING INVENTED BY A MODEL"
MEANS ONCE THE LOOP HAS A CHANGE BODY.
**AND AN EDIT IS SELECTED BY A STRUCTURED `remedy = {editId, params}` FROM A FROZEN PER-SENSOR
`ADAPTERS` TABLE — NEVER BY MATCHING PROSE, WHICH IS WHERE A DRAFT CLAIMED MORE THAN THE CODE COULD DO.
MEASURED: ALL SEVEN `fixable` STRINGS IN `selfModel.cjs` ARE SENTENCES WRITTEN FOR MASTER TO READ**
(*"install Ollama and pull a model — tier 1 then works offline and free"*, *"record the request text —
which has a privacy consequence master must accept first"*, *"build on a machine that can run 7za"*),
**so the sensor this design calls the natural input to NOTICE HAD ZERO REACHABLE EDITS, and three
classes described a path nothing could take in production. Parsing those sentences would have been
model-shaped guessing performed by a regex. SO: `selfModel → null` BY DECLARATION, and the honest
number is PRINTED — SIX OF SEVEN SENSORS CAN REACH NO EDIT AND THREE OF FOUR `EDITS` ENTRIES HAVE NO
PRODUCING ADAPTER. TODAY THIS LOOP CAN AUTHOR EXACTLY ONE KIND OF CHANGE: A DEPENDENCY VERSION PIN.
Everything else files a question with a researched remedy in words — which is a far narrower claim than
"four mechanical edits", and it is the true one.** Every change records `author: 'template:<editId>'` and
`baseSha256` — the digest of the file the transform read — and THE APPLIER REFUSES IF THE FILE ON DISK
NO LONGER MATCHES, because master may approve a week later and "applies cleanly" is not "applies to the
file it was computed from". A `fixable` MATCHING NO ENTRY PRODUCES NO DIFF and the loop files a question
carrying the remedy IN WORDS — the honest half of the decision, since most findings will not match, and
`build-repair` therefore means "the repairs this table can express" rather than "a repair".
`AUTHORING_MODES = ['template']` IS THE ONE FROZEN CONSTANT A MODEL-AUTHORED PATCH WOULD CHANGE, and
the two conditions are specified NOW so a later session cannot invent them: the authoring model must
classify `dest: 'local'`, so Rāma's own source is never shipped to a cloud model to be rewritten, and
the weighing gains a mandatory con naming the model, because a weighing that does not say which of its
terms is unmeasured misleads. RAISED FOR MASTER; NOT TAKEN HERE.** **(3) WEIGH — `upgradeWeigh.cjs`: `costOfDoingNothing` IS A REQUIRED NON-EMPTY STRING AND
A WEIGHING WITHOUT IT THROWS**, because it is the term always omitted and always decisive — without the
field a weighing silently defaults to *"doing nothing is free"*, and `dependencyAdvisor` already encodes
the one case where it dominates (*"staying put carries a security one"*). **BLAST RADIUS COMPUTED, SIX
PARTS, EACH WITH ITS METHOD AND ITS LIMIT STATED: files (exact); dependents via `analyzeImpact`, WHICH IS
A SUBSTRING SCAN (`code.includes(name)`) AND THEREFORE OVER-REPORTS AND NEVER UNDER-REPORTS — THE SAFE
DIRECTION FOR A BLAST RADIUS — with `dependentMethod` saying so IN THE RECORD so nobody later mistakes
the list for a call graph; adjacent invariants from a declared map WHOSE EVERY ENTRY IS ASSERTED TO NAME
A PATH THAT EXISTS AND TO BE MENTIONED IN `verifyInvariants.cjs`, because a map the suite does not check
is the `CAPABILITY_AXES` defect in a new costume; `protectedTouched` READ FROM `loyaltyGuard.PROTECTED_FILES`
AND NEVER RESTATED, with a test that monkey-patches the export and requires `weigh()` to honour it
(*"a second list is how two lists disagree"*); suite coverage, where `covered:false` is A CON AND NOT A
BLOCKER because refusing every unguarded change would refuse most useful ones; and the rollback point.**
**TWO VERDICTS ARE FORCED, NOT JUDGED: a protected file in range ⇒ `needs-master-decision` AND NO
DIFF-BEARING PROPOSAL IS CREATED** — `assertChangesSafe` would throw anyway, but relying on that would
mean the loop's only protection against proposing a covenant edit is an exception from another module —
**and no clean rollback point ⇒ `needs-master-decision`, the rule `localUpdateEngine` already applies in
refusing a dirty tree.** **(4) PROPOSE — `upgradeProposer.cjs`: two kinds arriving through
`registerApplier` WITHOUT MODIFYING `proposals.cjs` (sha256-compared before and after); the question kind
has NO APPLIER AND THAT IS ASSERTED, NOT ASSUMED — Section 124 found `DEPENDENCY` inert "correct BY
ACCIDENT", and the remedy is to assert it.** **MASTER'S ONE-CLICK BATCH APPROVAL STILL RECORDS A PER-ITEM
DECISION, AND THE GUARANTEE IS AN ABSENCE: NO IPC CHANNEL ACCEPTS AN ARRAY OF PROPOSAL IDS**, so a batch
is necessarily a loop over `approve(id, user)`, each writing its own audit row and its own result —
*the strongest guarantee available in JavaScript is that the function does not exist*, the same shape as
`claimGate`'s asserted missing score and `loyaltyCore`'s missing accessor. **AND EVERY REFUSAL ABOVE IS
A REFUSAL IN ONE CALLER, WHICH IS THIS DESIGN'S OWN DOCTRINE TURNED ON ITSELF: `proposals.create`
CONSULTS NONE OF THEM AND `proposals:create` IS A RENDERER-REACHABLE IPC HANDLER GATED ONLY ON
`self-modify.view` — TIER 1 — THAT PASSES `def` THROUGH WITH `meta` INTACT. `assertChangesSafe` still
protects the seven files, but `shared/autonomy-policy.json` IS NOT AMONG THEM, so a hand-built entry
naming the policy file could have sat in the queue under an Approve button — the hole closed in the
proposer and left open at the ledger. `proposals.cjs` IS PROTECTED AND DOES NOT CHANGE, so the
enforcement moves to THE ONE COMPONENT THIS DESIGN OWNS THAT WRITES SOURCE: THE APPLIER VALIDATES SEVEN
THINGS AT ENTRY BEFORE ANY SNAPSHOT — a derived `masterDriven` from `opts.user` (no tier-0 user, no
write) plus six on the entry: — `meta.schema === 'self-upgrade/1'` with a validating dossier,
because AN ENTRY OF THIS KIND WITH NO DOSSIER WAS NOT FILED BY THIS LOOP; `guard.inspectChanges`
RE-RUN rather than trusted from creation, because `restore()` rehydrates on an id check alone; no path
or meta text naming a self-governing path; every path through the resolve-then-compare rule;
`action ∈ {patch, create}` with `create` refused over an existing path and `delete` refused outright;
and `baseSha256` matching the bytes on disk. A REFUSAL THROWS, so the ledger records `failed`. THE
PROPOSER'S REFUSALS BIND THE LOOP; THE APPLIER'S VALIDATION BINDS THE KIND — and the residual that
`proposals.create` remains tier-1-reachable is PRINTED, not implied.** **(5) AFTER APPLY —
`upgradeApplier.cjs` + `breakageAnalysis.cjs`: verify, and on failure RESTORE EACH SNAPSHOTTED FILE TO ITS
RECORDED PRIOR STATE AUTOMATICALLY, THEN NAME THE CAUSE.** **"PRIOR STATE", NOT "PRIOR BYTES", AND THE
DIFFERENCE IS A REAL CASE: A `create` HAS NO PRIOR BYTES, SO ITS SNAPSHOT RECORDS `existed: false` AND ITS
REVERT DELETES THE FILE AND ASSERTS ITS ABSENCE.** Hence `files: [{path, existed, sha256|null,
bytes|null}]`, a `create` whose path already exists is **refused** (it is a mis-declared `patch`), and
**`action: 'delete'` — which `proposals.cjs` documents — is REFUSED OUTRIGHT by this design**, because
reverting a deletion means re-creating content the loop did not author and cannot honestly attest.
**THE ROLLBACK IS A BYTE SNAPSHOT, NOT A GIT REF, AND THE REASON IS
NOT INCIDENTAL: `git checkout` OF THE CHANGED PATHS WOULD DISCARD MASTER'S UNRELATED UNCOMMITTED EDITS TO
THOSE SAME FILES, AND NO VERIFICATION FAILURE JUSTIFIES THAT.** Snapshot taken at Stage 3 into `userData`
(writable in every install — `selfRepair` proved it; and inside the repo it would be a file the next diff
could name), every file sha256'd, **a mismatch ABORTS BEFORE THE FIRST WRITE because if the snapshot
cannot be trusted the change must not happen.** **AND THE SNAPSHOTS ARE SWEPT, BECAUSE A DESIGN THAT
MANDATES A REAL PURGE FOR EVERY OTHER BYTE IT WRITES CANNOT LEAVE WHOLE-FILE COPIES ACCUMULATING: deleted
the moment an apply is VERIFIED (a snapshot of a verified apply is a copy of bytes git already has), kept
for failed and reverted entries because they are the evidence the breakage analysis reads, and **EVICTED
WHEN EITHER BOUND IS EXCEEDED — OVER 30 DAYS OLD, OR NOT AMONG THE 20 MOST RECENT NON-`fatal`
DIRECTORIES — with `fatal` ENTRIES NEVER EVICTED AND NOT COUNTED TOWARD THE 20. Stated as an `OR`
because "the lesser of 20 entries or 30 days" IS NOT A COMPARISON: a count and a duration have no
ordering, and a fixture exercising only the count would have passed under either reading while the age
bound went untested.** And the **COUNT AND
TOTAL BYTES REPORTED** where master can see them. **AND THE SNAPSHOT DIRECTORY IS DERIVED AT APPLY TIME
FROM `userData` AND A VALIDATED `/^[0-9a-f]{20}$/` PROPOSAL ID, NEVER READ FROM THE RECORD — THE ONE
PLACE THE STOP'S UNREACHABILITY CLAIM WAS ACTUALLY FALSE. The claim rested on the allow-file living
outside the repo root where no `changes[].path` can name it; TRUE OF `changes[]`, AND NOT TRUE OF `meta`,
which is rehydrated on an id check alone and carried a persisted `dir` that the applier used as THE
DESTINATION OF FILESYSTEM WRITES — under `userData`, WHERE THE ALLOW-FILE LIVES. A persisted `dir` of
`<userData>/rama/` with a snapshotted basename of `autonomy.allow` would have been a write to the STOP's
own state, performed inside the one branch the fence permits to write, and the fs-write assertion was
scoped to paths under the repo root so it was unasserted BY CONSTRUCTION. ANYTHING THAT COMES BACK OUT
OF `restore()` IS INPUT — the lesson the design already stated about the verification plan and then did
not apply twice.** `gitHead` is still recorded — useful for the audit and
master's own `git diff` — **but it is NOT the restore mechanism and the record's `kind` field says so, so
no cold session mistakes one for the other.** **THE APPLIER ALWAYS RESOLVES AND NEVER THROWS FOR A
VERIFICATION FAILURE, AND THE VERDICT IS MIRRORED INTO `meta.verification.result` BEFORE IT RESOLVES —
BECAUSE `proposals.apply` SETS `applied` WHENEVER THE APPLIER RESOLVES AND KEEPS ONLY `err.message` WHEN
IT THROWS. Throwing would reduce the dossier to a string — the exact defect this design exists to fix —
and resolving without the mirrored verdict would leave the ledger CLAIMING "applied" FOR A REVERTED
CHANGE. `forStorage()` keeps `meta` whole for every status, so the verdict survives a restart; `verified`
is the field that means success, NOT `status`; and no renderer branch may read `status === 'applied'`
alone. The status vocabulary's inability to say "applied then reverted" is PRINTED AS A RESIDUAL rather
than fixed by editing a protected file.** The verification plan is derived with
**`localUpdateEngine.classifyChange`, REUSED NOT RE-DERIVED** (*a second classifier is how two
classifiers disagree*) — **and RE-DERIVED AT APPLY TIME, WITH THE PERSISTED PLAN TREATED AS DISPLAY-ONLY,
BECAUSE `proposals.restore()` REHYDRATES `meta` WITH ONLY AN ID CHECK: a persisted `plan[].target` was
untrusted input about to be handed to a process launcher. Every step runs through `execFile` with
`shell: false`, `target` constrained to `/^verify[A-Za-z0-9]+\.(cjs|mjs)$/` under `scripts/` or to one of
the proposal's own change paths, and a POISONED PERSISTED PLAN IS A SUITE FIXTURE.** And **`verifyInvariants` + `verifyLoyaltyTripwire` ARE IN EVERY PLAN REGARDLESS OF
WHAT CHANGED, because a change that breaks an invariant it did not appear to touch is precisely what a
diff-derived plan would miss.** **AND `suiteCoverage` IS RECOMPUTED, NOT READ — the gap the
re-derivation itself left open: the plan called for a step per suite `suiteCoverage` named, and
`suiteCoverage` lives ONLY IN PERSISTED `meta`, which is exactly the untrusted input being avoided. So
it is a fresh scan of `scripts/verify*.cjs` over the RE-DERIVED change set — cheap and deterministic —
and a difference from the persisted value sets `planDrift: true` RATHER THAN SILENTLY DROPPING THE
CHANGE-SPECIFIC SUITES, which would have verified a change without the suite written for it.** **THE BREAKAGE ANALYSIS INHERITS `verifyEngineDiagnosis`'s DISCIPLINE AND
EXTENDS IT IN THE SAME GRAMMAR — AND THE `causeId`s ARE NEW, WHICH HAD TO BE SAID PLAINLY:
`aiProcess.diagnoseFailure` RETURNS `{reason, remedy, silent?}` AND CARRIES NO `causeId` AT ALL, so
nothing "carries straight through". `breakageAnalysis.cjs` OWNS A LITERAL EIGHT-BRANCH-TO-ID MAPPING
TABLE and `aiProcess.cjs` AND `verifyEngineDiagnosis.cjs` ARE NOT MODIFIED (sha256-asserted) — because
the engine diagnosis is consumed by `marketIntel` and `getRunningStatus`, which want a sentence for
master and have no use for an id, and because a 212-assertion suite over a pure function is an asset not
to be spent on this caller's convenience. Thirteen named causes, not "it failed": `missing-package` (names
the module), `bound-port` (recognised even from the WinError 10048 form), `version-mismatch`,
`missing-interpreter`, `live-but-silent`, `never-spawned`, plus `syntax-rejected` (file and line),
`suite-red` (the suite AND the failing row), `invariant-red` (the I-number), `tripwire-red` (the file),
`bridge-unresolved`, `import-unresolved`, and `unrecognised-exit` (the code AND the interpreter).** Four
properties copied verbatim because they are what made that function usable: **TOTAL** (every input
including none yields a non-empty cause AND remedy); **never `null`** (*"null is what sent the caller to
its raw fallback"*); **`'it failed'`/`'unknown error'`/`'see logs'` appear in NO output, EVER**; and **no
bare URL or IP, which is what master was actually shown.** **`confident:false` ON `unrecognised-exit` IS
THE HONEST STATE AND THE CALLER TREATS IT DIFFERENTLY: a confident cause produces a corrected fix, an
unnamed one produces A QUESTION — proposing a fix for a cause you could not name is the fabrication this
project refuses.** The corrected proposal carries `supersedes` and `learned` (**empty `learned` refused —
a re-proposal that cannot say what it learned is a retry wearing a dossier**), **BOUNDED AT ONE
RE-PROPOSAL PER FINGERPRINT PER 24h AND AFTER TWO FAILURES THE LOOP STOPS AND FILES A QUESTION**, because
an unbounded retry produces a queue master stops reading — destroying the one channel this design depends
on — and if the same approach failed twice the problem is the diagnosis, not the diff. **A REVERT WHOSE
RESTORED BYTES MISMATCH THE APPROVED DIGEST IS FATAL: it returns `{reverted:false, fatal:true}`, notifies
master, records it, AND ENGAGES THE STOP — the one place anything engages it unasked, and it is in the
safe direction. IT NEVER REPORTS A SUCCESS IT DID NOT HAVE**, Section 124's own rule for the backup path.
**AND THAT ENGAGE RECORDS BEFORE IT DESTROYS: `engage(reason, by)` WRITES
`<userData>/rama/autonomy.stopped.json` CARRYING `{at, reason, by, priorAllow}` AND ONLY THEN UNLINKS
THE ALLOW-FILE. A draft deleted the allow-file and returned — destroying the only record of who had
allowed autonomy, when, and master's note, AND DROPPING ITS OWN REASON — on the one automatic engage in
the design, where Rāma's source is in an unverified state and that reason is the most important datum
in the system. Since `lift()` cannot succeed until master adds a capability, recovery meant hand-writing
a file whose prior contents had just been deleted, with nothing on disk saying why. The ORDERING is
asserted: a crash between the write and the unlink leaves a recorded reason and a live allow-file —
inconsistent in the RECOVERABLE direction. And the boundary is stated: the record is read for the
REASON and for the pre-existing-dispatcher state, and NEVER by `isStopped()`, so AN ABSENT STOPPED-RECORD
NEVER IMPLIES AUTONOMY IS RUNNING.**

**THE ONE PLACE THE FENCE LOOKS BREACHED, ARGUED RATHER THAN GLOSSED: `revert-own-apply` writes source
without its own approval. THE READING IS THAT APPROVING PROPOSAL P AUTHORISES EXACTLY TWO TREE STATES — P
APPLIED AND VERIFIED, OR THE TREE AS IT WAS WHEN P WAS APPROVED — AND NOTHING ELSE. The revert target is
FIXED AT APPROVAL TIME because the snapshot digests are in the record master approved, so Rāma cannot
CHOOSE a state to revert to later; it can only restore bytes already recorded as the alternative at the
moment of approval.** Three properties make that safe rather than convenient: only `rollbackPoint.files[]`
can be restored, every byte is digest-checked against the approved value, and a mismatch is fatal rather
than retried into something new. **The class is LOWERABLE TO L0 if master prefers a failed apply to leave
the tree changed and merely report. RAISED FOR MASTER — it is the most load-bearing interpretation in the
design.**

**CONTEXT STORAGE — master: *"Utilise DB to store context which can be understood by any model."* THE DB
IS `dataStore`, AND THE DECIDING FINDING IS AN INVARIANT ONE THAT IS EASY TO MISS: `changePasscode` STEPS
2 AND 5 BOTH ITERATE `dataStore.DOMAINS` (`loadAll()`, then `markAllDirty()` + `saveAll()`), SO ADDING
`'context'` TO THAT ARRAY MAKES THE NEW STORE INHERIT I14's FULL RE-KEY FOR FREE — ONE LINE, NO CHANGE TO
`sessionManager.cjs`, AND THEREFORE NO CHANGE TO THE FILE `verifyInvariants.cjs` PINS ITS NINE ORDERED
STEPS AGAINST. A DB OUTSIDE `dataStore` WOULD NOT BE RE-KEYED AND I14 WOULD BECOME QUIETLY FALSE — master's
recorded context left under the old key, or worse in plaintext.** Covering the invariant **by
construction** is strictly stronger than covering it by a line someone could later remove, and a planted
assertion — a fake `contextDb.cjs` writing its own file turns the row RED — is what keeps it true against
a future session that reaches for SQLite. It settles the rest at once: **ZERO NEW DEPENDENCIES** (nothing
native to `electron-rebuild`, no deepening of Section 124's offline-rebuild hole at 750 lockfile entries
and zero vendored tarballs, nothing to pin under I12), **ONE AUTHORITY OWNING BYTES ON DISK** (the
I8/I9/I10 pattern), **ONE ENCRYPTION SCHEME** (the existing AES-256-GCM path) — every sentence
`proposals.cjs`'s Section 58 already used to win this argument for the ledger. **THE HONEST LIMIT, STATED
RATHER THAN DISCOVERED: a `dataStore` domain is ONE ENCRYPTED JSON BLOB IN MEMORY, a key-value store and
not a query engine. That is right for stage 0 and right at the volumes the retention cap permits, AND THE
RETENTION CAP IS WHAT KEEPS IT RIGHT — and because the record is canonical plain JSON, outgrowing it is A
COPY AND A REINDEX, NOT A LOSS OF MEANING.** **THE RULE THAT MAKES THAT TRUE, AND IT IS THE MOST IMPORTANT
LINE: EMBEDDINGS ARE AN INDEX, NOT THE RECORD. `rows` is canonical; `index` is derived and rebuildable
from `rows` ALONE (asserted by source shape, and by deleting the whole index, rebuilding, and requiring
identical results). IF THE RECORD WERE VECTORS, SWAPPING THE EMBEDDING MODEL WOULD SILENTLY INVALIDATE
EVERY MEMORY RĀMA HAS — the exact organ-swap failure the "Rāma is a model" framing exists to prevent, and
the thing `modelRoles` already says: "the base model is a replaceable part; the harness is the durable
asset."** So `nomic-embed-text` → `qwen3-embedding:0.6b` is a **REINDEX**, triggered by a differing
`embeddingModel`/`dims` or a `recordDigest` mismatch, verified by the digest matching afterwards, and **a
stale index is NEVER QUERIED AS IF FRESH — it reports `stale` and falls back to keyword search** (I11).
**A REAL DEFECT FOUND WHILE VERIFYING THAT, AND IT IS FIXED HERE: `vectorMemory.embed()` returns WHATEVER
LENGTH OLLAMA RESPONDS WITH on one path and EXACTLY 256 on the other (`tfidfVector(text, dims = 256)`, an
explicit parameter default — the code never states the Ollama length, which is itself the problem), while
`cosineSim` RETURNS 0 ON A LENGTH MISMATCH — so an index
holding vectors from both sources, which happens whenever Ollama is available for some writes and absent
for others (the normal case on master's machine), SILENTLY SCORES EVERY CROSS-SOURCE PAIR AT EXACTLY ZERO.
No error, no warning, permanently unfindable memories — the `cosineSim` equivalent of the JSX-apostrophe
defect Section 125 found, and the same lesson: a test that can quietly pass is worse than no test, because
it is also a claim that someone checked.** Fix: `embed()` reports `dims`, the index enforces them, **a
wrong-length vector is REFUSED NOT STORED**, and a mixed-dims index is `stale`. **"UNDERSTOOD BY ANY
MODEL" IS A SCHEMA CONSTRAINT, NOT A SLOGAN:** plain JSON, named fields, ISO-8601 dates, explicit
`{value, unit}`, the question AS ASKED — and asserted by the absence of `<|`, `[INST]`, `<s>`, role
markers and every provider-shaped field name, plus a lossless `toPlainText`/`parsePlainText` round-trip so
*"answerable by a fresh model"* is a claim a test exercises. **PROVENANCE REUSES BOTH EXISTING SCHEMES AND
INVENTS NEITHER: `selfModel`'s `{source, measured}` with `null` rather than a default (*"those read as
findings"*) for the measured case, and `claimGate.CLASS` — grounded/reflex/prose/unattributed — READ FROM
THE EXPORT NOT RESTATED for the derived case.** That is how Rāma never confuses what it was told with what
it concluded.

**THE SENSITIVITY GATE IS ON THE PAYLOAD AT THE CLOUD BOUNDARY, NOT ON THE ROLE, AND THE CHOKEPOINT IS
NAMED: `chatCompletion(messages, modelId)` in `modelRouter.cjs` — MEASURED AS A SINGLE SWITCH THROUGH
WHICH EVERY CHAT/COMPLETION CALL PASSES (openai/anthropic/gemini/mistral/groq/custom/ollama). THE GATE
GOES ABOVE THE SWITCH, NOT IN THE BRANCHES, BECAUSE GATING THE SEVEN LEAVES THE EIGHTH WHEN A VENDOR IS
ADDED — and the assertion that proves it is above the switch is one that ADDS A FAKE EIGHTH PROVIDER AND
REQUIRES THE REFUSAL TO STILL FIRE.** **THE GATE'S INPUT SHAPE AND ITS DEFAULT ARE DECLARED, BECAUSE A
GATE'S DEFAULT IS ITS BEHAVIOUR FOR ALMOST ALL TRAFFIC AND LEAVING IT TO INFERENCE LEAVES THE MOST
IMPORTANT MECHANISM IN THE DESIGN UNSPECIFIED: `gateOutbound(parts, destination, why)` where `parts` is
`Array<string | {text, classification?} | {contextBlock, classification}>`; A BARE STRING OR A PART
WITH NO CLASSIFICATION IS UNCLASSIFIED AND PASSES — stated as a DECISION, since this gate exists to stop
CLASSIFIED ROWS leaving and not to classify the whole application's traffic, and a fail-closed default
would refuse every chat in the product on the day it shipped; `destination` is `'local'|'cloud'` with NO
DEFAULT and an absent one THROWS, because a default would decide the leak question by omission; and the
return is `null` or `{error, classification, why, evidence}` naming THE CLASSIFICATION AND NEVER THE
CONTENT. `assembleContext` returns its block WITH the strictest classification of any row in it, and the
caller inserts it as a part CARRYING THAT TAG — which is what makes the joined case reachable at the
boundary rather than guarded only by the join's own filter.** **AND THE CLAIM IS SCOPED TO MODEL EGRESS BECAUSE THAT IS WHAT IS
TRUE: `chatCompletion` IS NOT THE ONLY OUTBOUND PATH CARRYING TEXT. MEASURED — EIGHT GATE CALL SITES
ACROSS SIX MODULES, COVERING TEN REQUEST SITES, EACH WITH ITS FILE AND LINE IN THE TABLE:**
`voiceEngine`'s multipart POST to `api.openai.com/v1/audio/transcriptions`; the
`encodeURIComponent(query)` search URL builders in `browserEngine` and `intelligenceEngine`; **ONE call
at the top of `codeRegenEngine.researchFix` COVERING ITS THREE REQUESTS (DuckDuckGo, the npm registry
search, and a GitHub repository search carrying the error message) — one and not three because all
three derive from the same payload, and three calls over one payload are three chances to drift**;
**THREE in `evolutionEngine` — `searchNpm`, `searchArxiv` and `searchGitHub` — A MODULE A FIRST DRAFT
MISSED ENTIRELY while it made three outbound requests carrying a master-supplied query**; and one in
this design's own `upgradeResearch`. **THE COUNTING UNIT IS STATED, BOTH NUMBERS ARE ASSERTED AND
PRINTED, AND A PLANTED NINTH UNGATED REQUEST TURNS THE ROW RED. A first draft asserted "exactly four",
which would have gone GREEN ON AN UNDER-COUNT and BLOCKED ANYONE WHO ADDED THE MISSING CALLS — the
opposite of what the row is for. A COMPLETENESS CLAIM THAT WAS NOT MEASURED IS WORSE THAN A SCOPED ONE
THAT WAS, and that is the lesson this row has now learned twice. One uncovered path is PRINTED rather
than omitted: `evolutionEngine.readRepoFiles` also reaches the GitHub API, carrying repository and path
names rather than caller text.**
**THE DESTINATION IS CLASSIFIED PER MODEL FROM MEASURED EVIDENCE, NOT FROM THE PROVIDER NAME AND NOT FROM
THE HOST — AND THIS IS THE CORRECTION THAT MATTERS MOST: `provider === 'ollama'` IS NOT A SYNONYM FOR
LOCAL. `ollamaCatalog.cjs`'s own header says Ollama SERVES CLOUD MODELS THROUGH THE SAME
`localhost:11434` as local ones, and Section 130.9 puts that free tier IN SCOPE — so a provider-name or
host check would have let a local-only record leave the machine through the one gate Section 127 calls
the most important.** `destinationOf` therefore reads `modelInfo(id)`'s **measured** `cloud` field, which
`describeInstalled` already produced by running `classify()` per tag: **`local` ONLY when
`cloud === false`; `cloud === true` ⇒ cloud; `cloud === null` (unknown) ⇒ CLOUD, inheriting `classify`'s
own stated asymmetry that "calling a cloud model local tells master his data stayed home when it did
not"; and a SEED-ONLY `ollama/*` entry — declared `type:'local'` with no measurement behind it — ⇒ CLOUD,
refused with "classification not measured", because a declared local that nobody measured is not a
measurement.** For a `custom` provider the predicate is **`isLoopbackHost`, NOT `isPrivateHost`** —
`PRIVATE_HOST_PATTERNS` covers `10.x` and `192.168.x`, which are
**other machines** and exactly right for the SSRF question that predicate was written for and exactly
wrong for *"did master's data stay on this machine?"* **TWO PREDICATES, TWO QUESTIONS, NEITHER BORROWED
FOR THE OTHER.** **AND TWO MEASURED CORRECTIONS THAT A FIRST DRAFT GOT WRONG IN THE SAFE DIRECTION,
WHICH IS STILL WRONG: THE FIELD IS `info.customProviderId`, NOT `info.baseUrl` — there is no `baseUrl`
on a registry entry, so the predicate was being handed `undefined`, and while that refused every custom
provider identically it also made the suite's loopback-versus-`192.168` contrast UNACHIEVABLE, so a
green row would have described a gate that proved nothing. AND THE LOOPBACK SET IS
`/^127\./`, `/^0\.0\.0\.0$/`, `/^localhost$/i`, `/^\[?::1\]?$/` OVER `new URL(...).hostname` — WHICH
RETURNS IPv6 LITERALS BRACKETED, so `http://[::1]:8000` and `http://0.0.0.0:8000` would otherwise have
classified as CLOUD: wrong rather than strict, and the kind of wrongness a later reader corrects in
whichever direction is convenient. An unparsable base URL is `cloud` with `why: 'base URL unparsable'`,
parsed inside a `try` because a throw at the gate would surface as a chat failure rather than a
refusal. AND `info.type` — which `toRegistryEntries` DECLARES as `'cloud'` on every custom entry — IS
NOT CONSULTED: `destinationOf` is the only authority on destination, so a loopback entry being
`dest:'local'` and `type:'cloud'` at once is a KNOWN COSMETIC DISAGREEMENT recorded here rather than a
second opinion someone later reconciles in the unsafe direction.** **A ROLE-LEVEL GATE IS THE COMFORTABLE CHOICE AND IS WRONG: without a payload
check the leak path is not a decision anybody makes, it is a refactor months later that nobody notices**
— and a test proves a `local-only` payload is refused **on a role whose `sensitive` flag is false.**
**AND A DB MAKES ONE GUARANTEE HARDER, WHICH IS THE POINT OF SAYING IT: A JOIN CAN ASSEMBLE A PAYLOAD NO
SINGLE ROW LOOKS SENSITIVE ENOUGH TO BLOCK.** So `assembleContext({userId, query, destination})` is the
**only** builder, it filters by classification BEFORE assembling and **reports `withheld: n` rather than
withholding silently**, and the assembled block is **TAGGED WITH THE STRICTEST CLASSIFICATION OF ANY ROW
IN IT** so the boundary re-checks the tag — **a classified row cannot pass even when it arrives via a
join**, asserted with no row passed directly. **SECTION 127 §A.4's REFUSAL IS MADE DIFFICULT RATHER THAN
MERELY UNDOCUMENTED: there is NO PARAMETER, FLAG OR CONFIG permitting a `local-only` row to a cloud
destination — the capability is absent from the function's surface, so enabling it is a visible source
change to a named function with a suite row that goes red. AND IT WILL LOOK MOST ATTRACTIVE EXACTLY WHEN
THE LOCAL MODELS FEEL TOO WEAK, which on a 15 W CPU with no discrete GPU is now — which is why the guard
is a missing parameter and not a default.** **PURGE ACTUALLY DELETES: rows removed, THE INDEX DESTROYED
(leaving vectors behind would leave a searchable shadow of the thing purged), and `cryptoCore.secureDelete`
— the DoD 5220.22-M 3-pass already used on `rama.salt`/`rama.verify` — called on the domain file; a
flag-flip purge is forbidden by assertion, because I14's full re-key already proves this project does the
real thing and a flag would be a regression against its own precedent. `retainUntil` IS REQUIRED ON EVERY
ROW, SO THE RETENTION SWEEP HAS NO UNBOUNDED CASE.** **RECORDING STAYS DARK: the shipped domain is
`{rows:[], index:null, recording:false}`, **a filesystem assertion proves NO CONTEXT ROW PAYLOAD EXISTS
ANYWHERE — "no context BYTES anywhere" was the wrong claim and would have been RED ON A CORRECT
IMPLEMENTATION, since `markAllDirty()` instantiates every domain's default and `saveAll()` writes one
encrypted file per domain, so adding `'context'` to `DOMAINS` — the entire I14 argument — GUARANTEES a
domain file on disk. The natural way to make the wrong claim green was to remove the domain from
`DOMAINS`, losing the re-key coverage this design calls its deciding finding. THE FILE IS PRESENT
BECAUSE THE INVARIANT REQUIRES IT; NO ROW EVER IS**,
`selfModel` KEEPS EMITTING THE PROMPT-TEXT LIMIT so the cost of the gap stays visible instead of being
quietly accepted, and THE FALSIFIABLE CRITERION IS PRESENT BEFORE RECORDING BEGINS — if after a declared
window tier-3 synthesis has saved ZERO model calls, the verdict is `stop-recording`, the same test
`outcomes.py`/`calibration.py` already run on market predictions now pointed at Rāma's own learning
mechanism. Without a criterion fixed in advance, recording becomes permanent on the strength of a hope.**

**NOT ADDED, SPECIFIED AND LEFT FOR MASTER, BECAUSE `shared/capabilities.json` IS A PROTECTED FILE:
`"system.suspend-autonomy": 0`, `"autonomy.view": 1`, `"memory.record-prompts": 0`. EACH DEGRADES HONESTLY
UNTIL HE ADDS IT** — the stop becomes unliftable in-app (the safe direction), the Autonomy panel names the
missing key instead of rendering a dead button (the defect Section 59 removed), and the recording surface
writes nothing while `selfModel` keeps reporting the gap. **ALSO FOR MASTER AND IMPOSSIBLE HERE: adding
`autonomyPolicy.cjs` and `autonomyStop.cjs` TO `PROTECTED_FILES` AND THE TRIPWIRE MANIFEST — `loyaltyGuard.cjs`
is itself protected, so it needs his digest-matched approval WITH a `--note`. UNTIL THEN THE SUITE PRINTS
THE RESIDUAL ON EVERY RUN**, Section 125's rule that a suite silently covering half an invariant while
printing a green line would be worse than no suite at all.

**DELIBERATELY OUT OF SCOPE AND NAMED RATHER THAN QUIETLY SKIPPED: I6's INDIRECT WRITE PATHS REMAIN OPEN**
— `assertChangesSafe` is still called only in `create()`, `proposals.restore()` still rehydrates without
re-checking, the nine build/update files are still unprotected, and there is still no source-integrity
attestation past the seven. **That is Section 125's declared next step, it needs `loyaltyGuard.cjs`, and
this design DOES NOT LEAN ON THAT GUARD HOLDING ACROSS A RESTART — the dossier validator is the loop's own
check.** Also out: code signing and the update channel's integrity-is-not-authenticity gap; the tier-3
synthesis itself (this builds the vessel); beginning to record anything; normalised phrasing clusters
(rejected in Section 127, not re-proposed); and **autonomous planning with a goal, which Section 124
blocks BEHIND this machinery rather than alongside it, because it CREATES the persistent goal
Omohundro's drives need and which Rāma structurally does not have.**
```

---

# PART G — READY-TO-PASTE BLOCK B: ledger row 148

> Paste into Section 28's ledger. **Not written into the spec by this run.**
>
> **VERIFY THE ROW ID IMMEDIATELY BEFORE PASTING — run `grep -n '^| 1\(4[4-9]\|5[0-2]\) |'
> RAMA_AGI_MASTER_SPEC.md`, do not trust this note** (review-3 finding 14). **Measured on `dev` during
> revision pass 3:** 144/145/146 are `done`; **147** is Section 127, **150** is Section 130 and
> **149** is Section 129 (*"The empty chart stops saying 'nothing stored'"*), with **150 appearing
> before 149** in the table. **So 148 is free and is the right id — but revision pass 2's note saying
> "148 and 149 are unused" is WRONG**, and a cold session trusting it could file over row 149. The
> rows being out of numeric order is not an error to tidy: each was filed by the session that did the
> work. **Insert 148 in numeric position, before 150.**
>
> **Format and density, measured against the house rows rather than asserted** (the brief's
> instruction, and the habit this project applies to its own counts). The existing comparable rows are
> **144 at 17,837 characters, 145 at 8,905 and 146 at 7,397**, all four columns
> (`| id | title | status | notes |`) on **one line** with inline pipes escaped as `\|`. **Row 148
> below is four columns, one line, pipes escaped, and 25,219 characters — about 1.4× the largest
> existing row.** That is a residual, printed rather than implied: it is the largest item in the
> ledger (96 criteria, **eleven** new modules, **nineteen** changed ones, **three** review passes), and the row was cut
> from 37,777 characters by moving the context-store and egress-gate argument into Section 128 §E.7
> and leaving the decision plus a pointer here. **Revision pass 3 grew it again** — the character
> count above is pass 2's and **must be re-measured before pasting**, like the row id itself. **If master wants it inside 18 k, the next things to
> move out are the five-stage prose and the policy-table rationale — both of which Section 128 already
> carries in full, so the cut would remove duplication rather than record.**

```markdown
| 148 | Rāma proposes, master approves — the self-maintenance loop, its autonomy policy, and the stop | in-progress (design complete, implementation not started) | Section 128. Design in full, with all 95 acceptance criteria: `docs/research/SELF_UPGRADE.md`. Master chose **option 1 — keep I6 and I17 intact; Rāma PROPOSES, master approves in one click** — plus *"Utilise DB to store context which can be understood by any model."* **THE FENCE IS THE WHOLE DESIGN: THE AUTONOMY IS IN THE RESEARCH AND THE PROPOSAL, NEVER THE APPLICATION — not a dependency patch, not a build repair, not ever.** `proposals.cjs` byte-identical (sha256-asserted), the seven protected files untouched, `shared/capabilities.json` untouched, no autonomy rung climbed. **NOT A FROM-SCRATCH BUILD, AND THAT IS THE FIRST FINDING: the propose→approve→apply spine, seven sensors, the diagnosis vocabulary, the admission authority and the release gate are ALL BUILT. THE GAP IS POLICY, A BREAKAGE LOOP, AND A CHANGE AUTHOR THAT IS NOT A MODEL.** Measured: NOTICE exists as data nothing reads; RESEARCH exists for exactly one subject; **nothing authors a change except a model** — `codeRegenEngine.generateFix` builds a PROMPT and returns `{prompt, researchContext}`, and the bytes come back from a model; **WEIGH is asserted never computed**, since `risk:'medium'` is a literal the caller passes; PROPOSE is the strongest part of the system; **AFTER APPLY DOES NOT EXIST AT ALL** — `proposals.apply` sets `FAILED`, stores `err.message`, and leaves Rāma's source changed with master holding a string. Posture copied verbatim from `dependencyAdvisor` (*"IT NEVER UPGRADES ANYTHING"*): `unchecked` ≠ `no-advisory-found` ≠ `verified-clean`; commentary is an attributed `'unverified claim'` that cannot set the recommendation; deltas not absolutes, absent not zero; `'master decides'` is a first-class verdict; one proposal, because *"twenty separate approvals is a queue master will stop reading"*. **THE AUTONOMY POLICY TABLE — RSP/Preparedness shape, answering the question Section 124 §2.5 found nothing answered: not "may this user do this?" but "has Rāma earned this?"** Six levels, `L0 forbidden` → `L4 apply-after-approval` → **`L5 apply-autonomous`, DECLARED AND UNREACHABLE** so a future unlock is one value in one frozen constant, visible in a diff, with a suite row that currently asserts it is impossible. **15 classes; CLASSES, FLOORS, CEILINGS and the PERMANENT set frozen in code, only non-permanent levels in data — and the data file SHIPS ABSENT, so the floors ARE the shipped levels.** **The floor is a FALLBACK, not a minimum:** a present file may **restrict** any editable class below its floor (`research-network` → L1 puts Rāma offline; `revert-own-apply` → L0 turns the automatic revert off) and may **raise** one only within its frozen ceiling. **Arithmetic, asserted by a suite row so two prose blocks cannot drift: 6 permanent classes the file is not read for; 11 with `floor === ceiling`, of which the 5 non-permanent can only be lowered; 4 with `floor < ceiling` — `propose-source`, `dependency-change`, `build-repair`, `author-change` — the live raise path, where raising one is A DATA CHANGE PLUS A MASTER APPROVAL WITH NO SOURCE EDIT. 6+5+4=15. And a diff needs TWO raised, not one: `author-change` permits the bytes to be produced, `propose-source` permits them to be filed.** **No floor exceeds L4, none is ever L5, and NO CLASS RĀMA INITIATES HAS A FLOOR ABOVE L3** — asserted over a frozen `RAMA_INITIATED` subset; the two L4 floors (`apply-source`, `revert-own-apply`) describe applying or undoing a change master already approved. **SIX PERMANENT:** `apply-source` (I6, permanent-at-L4 so it can never become L5), `release-classify` (I17), `capability-grant` (I8), `loyalty-core` (I15/I16), `master-record` (Section 127 — Rāma may never widen its own retention window or capture scope), and **`autonomy-policy`, covering the policy table's own DATA FILE plus the two modules and the tripwire manifest, from ONE frozen `SELF_GOVERNING_PATHS` constant. That class is the one a first draft misses: the data file sits under the repo root and is THE ONE LEVER THAT RAISES A CLASS, so without it a one-key JSON diff raising `propose-source` L1→L3 could have sat in the queue with an Approve button next to it. RĀMA MAY NOT PROPOSE ITS OWN PROMOTION, and the refusal is OUTRIGHT, not downgraded — a question asking to be promoted is still asking to be promoted.** **The mechanical answer, not a comment: the data file carries no authority over a permanent class BECAUSE THE LOADER NEVER READS ONE FROM IT** — `"master-record":"L4"` is a key with no reader — **and the file is REJECTED WHOLE, not per-key**, because a partial accept teaches whoever wrote it which edits are silently dropped and lets the rest through. **The file's digest is ledger-attested**, since R-G2's gate is *"master-only advancement recorded in the ledger (I17's shape)"* and a hand edit satisfies no part of that: `load()` records `fileSha256`, an unattested digest warns once, and master attests with one tier-0 call writing a question-kind entry. **The levels still apply unattested — what is withheld is the CLAIM that it was recorded.** His sequence, written in one place because it was true in three: hand-edit (not a proposal — the proposer refuses it), reload or restart, attest. **No build is required**, said out loud because `classifyChange` calls anything under `shared/` a renderer file while this one is read by the main process and is not bundled. **TWO GATES, NOT ONE: AS SHIPPED THERE IS NO ALLOW-FILE, SO THE STOP IS ENGAGED, EVERY CLASS RESOLVES TO L0 BEFORE THE RESOLVER LOOKS AT THE DATA FILE, AND A SCHEDULER TICK READS NO SENSOR AND FILES NOTHING** — asserted, because an earlier draft asserted the opposite. **Once master creates the allow-file — ONE file, not two** — the behaviour is *notice, research, author nothing, weigh, file a QUESTION* carrying the dossier and `blockedBy`. He reads a researched, weighed, blast-radius-computed account of a real measured defect and decides whether to raise the class, instead of deciding on a diff Rāma produced before anyone agreed it should. **Section 124's measurement stays true: a READ that files a question — Level 2 (Consultant).** **THE STOP, DESIGNED NOW BECAUSE A STOP RETROFITTED ONTO A RUNNING LOOP IS THE ONE THING THAT MUST NOT BE RETROFITTED. A POSITIVE ALLOWANCE, NOT A STOP-FLAG:** `<userData>/rama/autonomy.allow` with `allowed !== true` **strictly** meaning stopped — so `"true"`, `1`, `{}`, invalid JSON, a zero-byte file, a directory **and an absent file** all resolve to stopped. **The direction is the point:** a stop-flag makes a fresh install, a wiped profile or a permissions error RUNNING, and fail-safe requires the safe state to be the one that needs nothing to be true. Dependency-free and synchronous (`fs`/`path`/`os` at module scope, Electron only through a guarded lazy require), so it answers from `before-quit`, from a suite, before the store is unlocked, and inside a failing boot. **Its state lives outside the repo — and no path in the record reaches it either.** **Engaging needs no capability and no renderer** (tray, `RAMA_AUTONOMY=stop` checked first, or delete the file), because a stop that can be refused is not a stop. **Lifting is the only gated direction**, needing tier-0 `system.suspend-autonomy`, a real `user` and a typed note — and since `capability.can()` returns **false for an unknown capability for everyone including master**, until he adds that key **the stop cannot be lifted in-app at all**, which is the correct failure direction. **Rāma can never lift it: no internal caller of `lift` exists and a source-shape assertion finds exactly zero.** **Six enumerated chokepoints, not callers, count printed.** **What is NOT stopped is named** — master's requests, `PRIORITY.CRITICAL`, chat, StockMind, the UI, the ledger, **and `proposals.approve`/`proposals.apply`** — because a stop that also breaks the app is a stop master will never use. **The stop gates RĀMA STARTING an apply, not MASTER applying one** — otherwise, the shipped install being permanently stopped, master could approve a change and never apply it, on every install, forever. **And the mechanism is declared data plus an asserted absence, not a flag, because two drafts got it wrong in opposite directions: an unconditional `policy.require('revert-own-apply','L4')` at the applier's entry REFUSED A MASTER-APPROVED APPLY ON EVERY SHIPPED INSTALL** (the STOP forces `L0` on every class, and the shipped install has no allow-file — reachable too via `RAMA_AUTONOMY=stop` over a valid one), **and checking the stop "only when `opts.autonomous === true`" put the predicate in the hands of the party it exists to stop, since `opts` is renderer input passed through untouched (`preload.cjs` 680 → `proposals.cjs` 272 → `applier(p, opts)` 235) and omitting a field would have bypassed it. SO: `apply-source` and `revert-own-apply` are a FROZEN `MASTER_ACT` SUBSET, and `requireMasterDriven(classId, need)` — the only function that may ignore the STOP — THROWS for any class outside it; `opts.autonomous` is RECORDED into `meta.autonomy` and never read in a conditional; and "Rāma does not start an apply" is held by an ASSERTED ABSENCE of in-process callers of `proposals.apply`, because `capability.can` reads only `user.tier` so a `{tier:0}` object is forgeable in-process and `proposals.apply` already authorised `opts.user` before the applier ran — making the derived check tautologically true where it is evaluated. THE STRONGEST GUARANTEE AVAILABLE IS THAT THE FUNCTION IS NOT CALLED.** **AND THERE ARE TWO STATE PREDICATES: `isStopped()` (fail-safe, absence means stopped) for the six new chokepoints, and `isHalted()` (true only on an explicit engage) for the four PRE-EXISTING dispatchers — because governing both with the fail-safe one would have DELETED FIVE WORKING BEHAVIOURS on every install (`ollama-catalog`, `dependency-review`, the metacognition audit, `selfCare`'s 120-second sweep including `checkInstanceFailover`, `marketIntel`'s two ticks) until master hand-created a file nobody had told him about: a regression wearing a fail-safe argument, and I11 has no exception for well-meant ones. The asymmetry is PRINTED BY NAME in both states.** **And `engage(reason, by)` WRITES `<userData>/rama/autonomy.stopped.json` carrying `{at, reason, by, priorAllow}` BEFORE unlinking the allow-file**, because a draft deleted the allow-file and returned — dropping its own reason and destroying the record of who had allowed autonomy, on the one automatic engage in the design, where that reason is the most important datum in the system. **The halt reaches FOUR measured dispatch points, not two:** `refreshScheduler.runNow` before `await task.run()`; `metaCognition` gaining `startAudit`/`stopAudit`, since its interval is armed in `register()` and `stop()` has no re-arm; **`selfCare` gaining `startSweep`/`stopSweep` plus an `isStopped()` check inside `runHealthSweep`, because measured it auto-arms a 120-second sweep at `register()` and that sweep calls `checkInstanceFailover()`, which per LEDGER ROW 49 expresses a dormant gene on a sibling instance — state-changing autonomous work running unconditionally on every install, neither halted nor declared by a draft that named two dispatch points and believed it had named them all**; and `marketIntel`'s two background timers, through its existing `stopScheduler()` plus a check inside each tick, while master's on-demand StockMind calls arrive through IPC handlers and stay untouched. **Plus R-L4's teardown half: `engage()` kills running agents and sandbox children through the paths those modules already use internally.** **One declared exemption, printed with its reason rather than shipped as an empty set:** `agentOrchestrator`'s governor, because it only **reaps**, and halting a reaper leaves hung agents running and unassimilated. **A timer in neither the dispatcher list nor the exempt set FAILS the row.** One deliberate exception: **an in-flight revert completes** — and it is a **token**, not a carve-out inside the resolver, since `effective()` is pure and cannot know a revert is in flight; a tokenless revert is refused. **THE LOOP — five stages plus the one a first draft forgot to have, each a named testable module, each refusing while the STOP is engaged. Section 128 carries each stage's contract; what a cold session must not re-decide is here.** **NOTICE:** a finding without a `measurement` **does not exist** — `notice()` throws, nothing is invented by a model, and the fingerprint **excludes the value** so a score sliding 71→70→69 is one defect and not three proposals. **RESEARCH:** what was read, what it said (attributed `'unverified claim'` unless the bytes were read this run), and **what is still unknown** — all three mandatory; I9-only, `admit()` at `BACKGROUND`, offline a declared outcome; **and because research is itself an outbound text path, what it may carry is decided here: the finding's `what` and a sensor's FIELD NAME, never `measurement.value`, file contents or a stderr excerpt, because those are Rāma's internals and master has not been asked.** **AUTHOR — `upgradeAuthor.cjs`, and it exists because a first draft described a loop that could notice, research, weigh, propose, apply and revert while NOTHING PRODUCED THE DIFF IT PROPOSED: a class permitting a diff to be filed is empty if nothing makes one. TEMPLATE-ONLY — a frozen `EDITS` table of mechanical transforms, each reading the CURRENT BYTES and returning a function of them, so `changes[].content` is REPRODUCIBLE and a suite row re-runs the transform and compares digests; that is what "nothing invented by a model" means once the loop has a change body. Each change records `author: 'template:<editId>'` and `baseSha256`, and the applier REFUSES ON DRIFT. A `fixable` matching no entry produces NO DIFF and the loop files a question carrying the remedy in words, so `build-repair` means "the repairs this table can express". `AUTHORING_MODES = ['template']` is the one frozen constant a model-authored patch would change, and its conditions are specified now: a `dest:'local'` model, and a mandatory con naming it. RAISED FOR MASTER, NOT TAKEN.** **WEIGH:** `costOfDoingNothing` required or it **throws**; **blast radius COMPUTED, six parts, each with its method and its limit stated** — `analyzeImpact` **over**-reports and never under-reports and the record says so, and `protectedTouched` comes from **`loyaltyGuard.inspectChanges(changes).refused`, the guard's own matcher, not a set intersection**; a protected file in range, or no clean rollback point, **forces `needs-master-decision` and no diff-bearing proposal.** **PROPOSE:** two kinds through `registerApplier` with `proposals.cjs` sha256-compared before and after; the question kind has **no applier and that is asserted, not assumed**; **batch approval records a per-item decision because no IPC channel accepts an array of ids — the guarantee is an absence.** **AND EVERY PROPOSER REFUSAL IS A REFUSAL IN ONE CALLER, WHICH IS THIS DESIGN'S DOCTRINE TURNED ON ITSELF: `proposals.create` consults none of them, `proposals:create` is renderer-reachable at TIER 1 with `meta` passed through, and `shared/autonomy-policy.json` is not in `PROTECTED_FILES`, so a hand-built entry naming the policy file could have sat under an Approve button. `proposals.cjs` is protected, so THE APPLIER VALIDATES SEVEN THINGS AT ENTRY BEFORE ANY SNAPSHOT — a derived `masterDriven` from `opts.user` (no tier-0 user, no write), dossier/`meta.schema`, `guard.inspectChanges` RE-RUN rather than trusted from creation, no self-governing path, the resolve-then-compare path rule, `action ∈ {patch, create}` with `delete` refused outright, and `baseSha256` matching disk — AND A REFUSAL THROWS, so the ledger records `failed`. THE PROPOSER'S REFUSALS BIND THE LOOP; THE APPLIER'S VALIDATION BINDS THE KIND.** **AFTER APPLY:** verify with the plan **re-derived at apply time** and **`suiteCoverage` RECOMPUTED rather than read**, because `restore()` rehydrates `meta` on an id check alone and a persisted `plan[].target` was untrusted input about to reach a process launcher; `verifyInvariants` and `verifyLoyaltyTripwire` run in **every** plan regardless of what changed. **Then restore each snapshotted file to its RECORDED PRIOR STATE — its bytes, or its ABSENCE where the apply created it.** **The applier ALWAYS RESOLVES and mirrors its verdict into `meta.verification.result` BEFORE resolving**, because `proposals.apply` sets `applied` whenever the applier resolves and keeps only `err.message` when it throws; **`verified` is the field that means success, not `status`**, and `summarise()` does not carry `result` at all. **The rollback is a BYTE SNAPSHOT, not a git ref, because `git checkout` would discard master's unrelated uncommitted edits to those same files**, and a digest mismatch **aborts before the first write**. **AND THE SNAPSHOT DIRECTORY IS DERIVED AT APPLY TIME FROM `userData` AND A VALIDATED PROPOSAL ID, NEVER READ FROM THE RECORD — THE ONE PLACE THE STOP'S UNREACHABILITY CLAIM WAS ACTUALLY FALSE:** it held for `changes[]` and not for `meta`, which carried a persisted `dir` the applier used as the **destination of filesystem writes**, under `userData`, where the allow-file lives — and the fs-write assertion was scoped to the repo root, so it was unasserted **by construction**. **Anything that comes back out of `restore()` is input**, which this design had already said about the plan and then failed to apply twice. Snapshots are swept — deleted on a verified apply, kept when reverted, `fatal` never evicted, **evicted when EITHER bound is exceeded: over 30 days, OR not among the 20 most recent non-`fatal` directories.** **BREAKAGE ANALYSIS inherits `verifyEngineDiagnosis`'s discipline and the `causeId`s are NEW, which had to be said plainly:** `diagnoseFailure` carries **no `causeId`**, so nothing *"carries straight through"*; `breakageAnalysis.cjs` owns a literal eight-branch-to-id table and **`aiProcess.cjs` and `verifyEngineDiagnosis.cjs` are not modified**. **Thirteen named causes, not *"it failed"*; total; never `null`; no bare URL or IP** — and **`confident: false` on `unrecognised-exit` sends the caller to a QUESTION rather than a fix**, because proposing a fix for a cause you could not name is the fabrication this project refuses. Re-proposals carry `supersedes` and a non-empty `learned`, **bounded at one per fingerprint per 24 h, and after two failures the loop files a question instead.** **A revert whose bytes mismatch is FATAL: it never reports a success it did not have, it notifies master, and it ENGAGES THE STOP** — the one unasked engage, in the safe direction. **The one place the fence looks breached, argued rather than glossed:** `revert-own-apply` writes source without its own approval. **The reading: approving P authorises exactly two tree states — P applied and verified, or the tree as it was — with the revert target FIXED AT APPROVAL TIME because the snapshot digests are in the record master approved**, so Rāma cannot *choose* a state later, only restore what was already recorded as the alternative. Lowerable to L0 by data. **Raised for master as the most load-bearing interpretation here.** **CONTEXT DB — `dataStore` IS THE DB, and the deciding finding is an invariant one:** `changePasscode` steps 2 and 5 both iterate `dataStore.DOMAINS`, **so adding `'context'` to that array inherits I14's full re-key FOR FREE** — one line, no change to `sessionManager.cjs`. A DB outside `dataStore` would not be re-keyed and **I14 would become quietly false**; a planted fake `contextDb.cjs` writing its own file must turn the row RED. Zero new dependencies, one authority owning bytes, one encryption scheme. **EMBEDDINGS ARE AN INDEX, NOT THE RECORD** — rebuildable from `rows` alone, because if the record were vectors, swapping the embedding model would **silently invalidate every memory Rāma has**. **And a real defect found by reading and fixed here:** `embed()` returns Ollama's length on one path and exactly 256 on the other while `cosineSim` **returns 0 on a length mismatch**, so a mixed index — the normal case when Ollama is present for some writes and absent for others — **silently scores every cross-source pair at zero: no error, no warning, permanently unfindable memories**; `embed`/`tfidfVector`/`cosineSim` become exported, since today not one of the three is and the assertions could not have run. Schema, provenance, retention and the full argument: Section 128 §E.7 — and the context store's own ledger row is **150** (Section 130). **THE SENSITIVITY GATE IS ON THE PAYLOAD AT THE CLOUD BOUNDARY, NOT ON THE ROLE**, at `chatCompletion` in `modelRouter.cjs` — measured as the single switch every chat/completion call passes through — **with the gate ABOVE the switch, because gating the seven leaves the eighth.** An unclassified part **passes**, stated as a decision rather than left to inference; the destination has **no default** and an absent one throws; a refusal names **the classification, never the content**. **The claim is scoped to MODEL EGRESS because that is what is true — measured: EIGHT gate call sites across SIX modules covering TEN request sites, both counts asserted and printed, with a planted ninth ungated request turning the row RED.** A first draft asserted *"exactly four"*, which would have gone **green on an under-count** and blocked anyone who added the missing calls — including the three in `evolutionEngine`, a module it missed entirely. **`provider === 'ollama'` IS NOT A SYNONYM FOR LOCAL:** Ollama serves cloud models through the same `localhost:11434` (§130.9), so `local` requires a measured `cloud === false`, while `cloud: true`, `cloud: null` and a **seed-only declared-local** entry all resolve to **cloud**; for a `custom` provider the predicate is **`isLoopbackHost`, not `isPrivateHost`**, over **`info.customProviderId`** (there is no `info.baseUrl`) and covering bracketed `::1` and `0.0.0.0`. **A join is the new leak path, so `assembleContext` is the only builder** — it filters before assembling, reports `withheld: n` rather than withholding silently, and **tags the block with the strictest classification in it**, which the caller carries into the payload so the boundary re-checks the tag. Recording stays **dark**, purge **actually deletes** through `cryptoCore.secureDelete`, and the falsifiable criterion is a **frozen constant present before recording begins**. Full argument: Section 128 §E.7.4. **96 numbered acceptance criteria plus seventeen lettered rows across THREE review passes, three new suites, and FIFTEEN planted mutations run unconditionally** — because a row that cannot be broken is not testing anything. Residuals printed and counted on every run. **THE DESIGN WAS REVIEWED THREE TIMES AGAINST THE SOURCE BEFORE ANY CODE WAS WRITTEN, AND EACH PASS FOUND A DEFECT THE PREVIOUS PASS HAD INTRODUCED WHILE FIXING ITS OWN — WHICH IS THE ARGUMENT FOR THE NEXT ONE.** Pass 1: `provider === 'ollama'` is not a synonym for local; `chatCompletion` is not the only outbound text path; the policy **data file** was unfenced; the fail-safe stop and the *"shipped default"* could not both be true; a reverted apply would have been recorded `applied`; the stop could not halt the timers it named; `diagnoseFailure` carries no `causeId`. Pass 2: no stage authored the diff the loop proposed; the STOP was reachable by a proposal through `meta.rollbackPoint.dir`; every proposer refusal was bypassable because `proposals:create` is renderer-reachable at tier 1; the outbound count was wrong in two directions and a whole module was missing; the shipped levels could not exist, so `revert-own-apply` shipped at L0; the STOP revoked master's own apply; and two more state-changing timers were neither halted nor declared. **Pass 3 — and every one of its four HIGH findings was a defect the PREVIOUS FIX CREATED: raising `revert-own-apply`'s floor to L4 fixed the data state and left the stop state refusing a master-approved apply on EVERY SHIPPED INSTALL, since `effective()` forces `L0` on every class while stopped; the replacement check read `opts.autonomous`, which is RENDERER INPUT, so the predicate deciding whether the STOP applied was supplied by the party it exists to stop and was bypassable BY OMITTING A FIELD; one fail-safe predicate over both the new chokepoints and the four pre-existing dispatchers meant installing the design REMOVED FIVE WORKING BEHAVIOURS on every install; and the author's `EDITS` table declared a prose matcher for `fixable` strings that are all human sentences, so the sensor called "the natural input to NOTICE" had ZERO REACHABLE EDITS and the loop's authoring claim was satisfiable only by a synthetic fixture. The honest number is now printed: SIX OF SEVEN SENSORS CAN REACH NO EDIT, AND THIS LOOP CAN AUTHOR EXACTLY ONE KIND OF CHANGE — A DEPENDENCY VERSION PIN.** **NOT ADDED, SPECIFIED, LEFT FOR MASTER (protected files):** `"system.suspend-autonomy": 0`, `"autonomy.view": 1`, `"memory.record-prompts": 0`, **each degrading honestly until he adds it** — the stop becomes unliftable in-app (the safe direction), the panel names the missing key instead of rendering a dead button, the recording surface writes nothing; **and** adding `autonomyPolicy.cjs` and `autonomyStop.cjs` to `PROTECTED_FILES` and the tripwire manifest, impossible here because `loyaltyGuard.cjs` is itself protected — **until then the suite prints the residual.** **NOT VERIFIED: NOTHING IS IMPLEMENTED — this row is a DESIGN, and the distinction is the point of the ledger.** `node_modules` is absent, so `vite build` was **not run** and the `build` verification step is unexercised; no suite has been written or run; **no `EDITS` transform has ever produced a byte**, so *"the content is derived, never generated"* is a property of a design and not of an observed output; **no timer has been observed stopping** — the four dispatch points and the agent and sandbox teardown were **read** in their source; **the eight gate call sites were counted by reading**; the thirteen-cause vocabulary is designed against `verifyEngineDiagnosis`'s **source**, not a real failing build; the `cosineSim` dims defect was found **by reading**, not by a failing query; the tray item, every `.jsx` and anything on a screen are unexercised; **no Ollama daemon has ever been present** (row 132), so no real embedding and no real `classify()` output has ever been observed; and `restore()`'s missing `assertChangesSafe` re-check plus the nine unprotected build/update files **remain open and are declared, not implied.** **RAISED FOR MASTER, NOT RESOLVED:** (1) the `revert-own-apply` reading, that one approval authorises two tree states; (2) the three capability keys; (3) adding the two new files to `PROTECTED_FILES`, which is also the one unmet half of roadmap item 1.4 (R-L4); (4) Section 124 §9.2's backup question, now one decision together with the context domain's backup exclusion; (5) whether `propose-source` **and** `author-change` ship at L1 as designed or go straight to L3 — a question about **two data values**, not about the design; (6) I15's wording-versus-fail-closed divergence, still open from Section 125; (7) the ordering exemption, since this section touches roadmap items 1.4 (Phase 1), 4.1 (Phase 4) **and — added in revision pass 3, because §E.7 sits on them and a draft listed only two rows — 3.1 (R-M1, tier-0 `memory.write-durable`) and 3.3 (R-A4, tier-0 `memory.record-prompts`, "requires §9.4")** while Phase 4 is gated *"only after phases 0–3"* and 2.1/2.2/2.3/3.6 are open — the argument being that **4.1 declares the ladder and climbs no rung, so it is strictly subtractive, and that the Phase-3 pair is a VESSEL ONLY: `recording: false`, the capability not added to a protected file so `can()` refuses it for everyone, no row ever written, `selfModel` still reporting the gap, and §9.4's privacy precondition NOT claimed met. The subtractive argument does not cover a schema plus an index plus a purge, which is why they are raised separately rather than folded in;** (8) **whether a MODEL may ever author a patch to Rāma's own source** — refused here, designed for as one frozen constant plus two stated conditions; (9) whether `marketIntel`'s two background timers halt with the STOP as designed, or are declared exempt like the agent governor. **NEXT, IN ORDER:** `autonomyStop.cjs` + `scripts/verifyAutonomyPolicy.cjs` **first** — the stop and the policy before any stage that could use them, the ordering Section 124 §9.3 exists to protect. Then `breakageAnalysis.cjs` (pure, total, the highest-value suite here). Then **NOTICE → RESEARCH → AUTHOR → WEIGH → PROPOSE** in order, each with its suite green before the next starts. Then `upgradeApplier` — **its seven entry validations before its snapshot code**, because the validations are the chokepoint for the kind and the snapshot is what writes — plus the revert. Then **`classificationGate.cjs`** (pure, dependency-free, so the chat chokepoint's gate cannot fail to load), then `contextStore.cjs` with the `dataStore` domain line and the `chatCompletion` payload gate. The renderer surfaces **last**, since they cannot be verified in this workspace. **NO STAGE SHIPS BEFORE THE STOP CONSULTS IT.** |
```

---

# PART H — NOT VERIFIED

**Said plainly, in the house style, because an admitted gap beats a plausible invention.**

1. **NOTHING IN THIS DESIGN IS IMPLEMENTED.** No module was created, no suite was written, no suite was
   run. This document is a design and a set of acceptance criteria. Every "asserts", "refuses" and
   "goes RED" above describes **what the suite must do**, not what a suite did.
2. **`node_modules` is absent in this workspace, so `vite build` cannot be run here.** The `build` step of
   a verification plan (§E.5.2) is therefore **unexercised**, and the two renderer surfaces (§E.12) have
   not been compiled, rendered or clicked. Per the verification bar, stated rather than claimed.
3. **The 13-cause breakage vocabulary was designed against `verifyEngineDiagnosis.cjs`'s and
   `aiProcess.diagnoseFailure`'s SOURCE, not against a real failing build.** The six engine causes are
   known-good because that suite exercises them; the six source-change causes (`syntax-rejected`,
   `suite-red`, `invariant-red`, `tripwire-red`, `bridge-unresolved`, `import-unresolved`) are **designed
   and unexercised** — their recognisers have never seen real output.
4. **The `vectorMemory` dimension defect (§E.7.3) was found by READING, not by a failing query.** The
   structure is unambiguous — `tfidfVector(text, dims = 256)` versus an Ollama response of unstated
   length, and `cosineSim` returning `0` on a length mismatch — but **no mixed index was built and no
   query was observed returning zero, and the Ollama vector's actual length has never been measured on
   this machine** because no Ollama daemon has ever been present (row 132). **The defect is that the two
   lengths are not reconciled anywhere and the mismatch is silent; the specific numbers are not the
   claim.** Worth saying because the claim is about a silent failure, and a
   silent failure is exactly the kind one should not claim to have seen without seeing it.
5. **Every inventory claim in Part B is a source-level reading**, not an observed behaviour. In
   particular: `proposals.cjs`'s durability was read, not exercised; the tray context menu was read, not
   opened; `chatCompletion`'s switch was read, and **no cloud provider was ever called**.
6. **`changePasscode`'s coverage of a new domain (§E.7.1) was verified by reading `DOMAINS`, `loadAll`,
   `markAllDirty` and `saveAll` — not by adding a domain and changing a passcode.** The reasoning is
   mechanical and the code is short, but the re-key has not been run with a context domain present.
   **This is the single most important unverified claim in the document, because I14 rests on it.** It is
   also the cheapest to verify once implemented, and criterion 64 is written to do exactly that.
7. **No Ollama daemon has ever been present on master's machine (ledger row 132, unchanged), so no real
   embedding has been produced**, the TF-IDF path is the only one ever exercised, and the reindex design
   is unexercised end to end.
8. **The Python engine has still never completed a run** (Section 124, unchanged), so
   `evaluateCriterion`'s deliberate parallel to `outcomes.py`/`calibration.py` is an architectural
   parallel, not a shared code path, and those modules' behaviour is taken from the ledger rather than
   re-verified here.
9. **Section 127 was not read** — it is on `dev`, which this worktree predates. Addendum A's restatement
   was taken as authoritative per its own instruction. **If Section 127's text diverges from Addendum A,
   Section 127 wins and §E.7 needs re-checking against it.**
10. **`git` behaviour under assumption A3 was not tested in a non-git tree.** The design says the snapshot
    is still the mechanism and `gitHead` becomes `null`; that path has not been run.
11. **The 64 KB dossier cap (criterion 39) is a stated budget, not a measurement.** No worst-case dossier
    was constructed and sized.
12. **Spec Section 128 and ledger row 148 have NOT been written into `RAMA_AGI_MASTER_SPEC.md`.** They are
    paste-ready blocks in Parts F and G of this file, as instructed. The spec was read and not modified.
13. **Known-open and untouched by design, repeated here so it is not read as closed:** I6's indirect write
    paths (`assertChangesSafe` called only in `create()`; `proposals.restore()` not re-checking; the nine
    unprotected build/update files; no source-integrity attestation past the seven); the update channel's
    integrity-is-not-authenticity gap; code signing; I15's wording-versus-fail-closed divergence.

**Added in the revision pass — what the revision verified, and what it did not.**

14. **Everything the revision corrected was verified by READING THE SOURCE in this worktree, not by
    running it.** Specifically read and quoted: `ollamaCatalog.classify`/`describeInstalled` (the
    `cloud: true|false|null` field and the `type: 'cloud-ollama'|'local'|'unknown'` state);
    `customProviders.PRIVATE_HOST_PATTERNS` and the fact that `isPrivateHost` is **not** exported;
    `modelRouter.modelInfo`/`chatCompletion`; the four outbound text sites and their line numbers;
    `loyaltyGuard.inspectChanges`'s three-way matcher; `proposals.apply`'s
    resolve-means-`APPLIED`/throw-means-`FAILED` behaviour and `forStorage`'s preservation of `meta`;
    `proposals.cjs` line 121's `action:'create'|'patch'|'delete'`; `refreshScheduler.runNow` and the
    absence of a stop check in it; `metaCognition.register`'s `setInterval` and `stop()`'s lack of a
    re-arm; `vectorMemory`'s five exports and `cosineSim`'s length guard; `astEngine.analyzeImpact`
    returning `path.join(repoPath, …)`; `resourceOrchestrator.admit`'s default `ramMB: 128` and its
    verbatim reason strings; `aiProcess.diagnoseFailure`'s **eight** branches. **None of it was
    executed.**
15. **No Ollama daemon has ever been present on this machine (ledger row 132), so no `classify()` output
    has ever been observed on real `/api/tags` data.** §E.7.4's gate is designed against the function's
    source and its documented contract. **This is now the most load-bearing unverified claim in the
    document after §E.7.1's re-key reasoning**, because the leak path it closes is the one Section 127
    calls the most important — and criterion 54's assertions 8–11 are written against `modelInfo`
    **fixtures**, not against a daemon.
16. **`isLoopbackHost` does not exist yet.** It is specified in §E.0.1 and §E.7.4 as a new export on
    `customProviders.cjs`; nothing has been added to that file.
17. **The stop's halt of `refreshScheduler` and `metaCognition` has not been run.** The reasoning is
    mechanical — one dispatcher, one armed interval — but no timer has been observed stopping, and
    whether `startAudit()` can re-arm cleanly inside a long-lived main process is **asserted by
    criterion 22a and not yet demonstrated**.
18. **`CRITERION`'s 90-day window is a REASONED CHOICE, not a measurement.** One quarter is argued in
    §E.7.5 as long enough for a weekly request to recur a dozen times; no data supports the specific
    number, because the measurement source (`metaCognition.recordOutcome` counting a reflex answering)
    does not exist yet. **That is why `evaluateCriterion` returns `too-early` rather than a verdict
    when no source is present.**
19. **The snapshot retention figures (20 entries / 30 days) are a declared budget, not a measurement**,
    like the 64 KB dossier cap in item 11. No snapshot has been taken and none sized.
20. **`proposals.cjs`'s status vocabulary cannot express "applied then reverted", and this design does
    not fix it.** The verdict lives in `meta.verification.result` and criterion 45a forbids the
    renderer from branching on `status` alone. **A reader of the raw ledger will still see `applied` on
    a reverted change**, and that is a printed residual rather than a solved problem — solving it means
    editing a protected file.
21. **The review's own suggested fixes were not adopted verbatim where the source disagreed with
    them**, and the divergences are recorded in the disposition table (Part J) rather than silently
    smoothed: the review proposed `ollamaCatalog.classify(id, {tags, catalogEntry})`, but the measured
    signature is `classify(tag, catalogEntry)` and `modelInfo` **already carries** the classified
    result, so the design consults the measurement instead of re-classifying; and the review's
    thirteen-vs-nine cause reconciliation resolves to **eight branches over seven ids**, which is what
    §E.5.3a's table states.

**Added in revision pass 2 — what this pass could and could not establish.**

22. **No `EDITS` transform has ever been run.** §E.4.2a's four mechanical edits are specified with
    their preconditions and their verification, and **not one has produced a byte.** The claim
    *"`changes[].content` is derived, never generated"* is a property of the design; criterion 89's
    reproducibility row is the cheapest thing in the document to write and should be written first,
    alongside criterion 64.
23. **No timer has been observed stopping.** The four dispatch points, the `isStopped()` checks inside
    `runHealthSweep` / `tickResolveOutcomes` / `tickSyncNews`, and the agent and sandbox-child teardown
    were all **read in their source in this worktree** — `selfCare.cjs` 345/396 and
    `checkInstanceFailover` at 125, `marketIntel.cjs` 784–785 with `stopScheduler` already exported,
    `agentOrchestrator.cjs` 628–651 with `agent.killFn` at 634, `sandboxEngine.cjs` 285's
    `proc.kill('SIGTERM')` — and **nothing was executed.** Whether `startSweep()` re-arms cleanly in a
    long-lived main process is in the same position as §H.17's `startAudit()`.
24. **The eight gate call sites and ten request sites were counted by READING**, with file and line
    recorded in §E.7.4. The count is what the suite must prove. **Revision pass 1 asserted four and
    was wrong, which is the reason to state the method rather than the number alone:** the sites are
    `voiceEngine` 269; `browserEngine` 209 (URL forms 205–207); `codeRegenEngine` 49, 69, 87;
    `intelligenceEngine` 295; `evolutionEngine` 220, 255, 540; plus `upgradeResearch`, which does not
    exist yet.
25. **`evolutionEngine.readRepoFiles` is a judgement, not a measurement.** It reaches `githubAPI` with
    repository and file-path names, and the design declares that those are not caller text and leaves
    it ungated. **Nobody has looked at what those names actually contain in practice**, and if a
    finding's remedy ever names a private repository the judgement changes. Printed as a residual and
    raised in §I.8.
26. **The `author-change` / `propose-source` double-raise has not been exercised**, because neither the
    policy module nor the author exists. Criterion 41's three assertions are the design's claim that
    the unlock needs **two** data values and nothing else; a cold session should not assume one is
    enough.
27. **`baseSha256` drift has never been observed.** The failure it prevents — a patch applying cleanly
    to a file it was not computed from — is a reasoned case, not a seen one. It is also the cheapest
    row in criterion 91 to write.

**Added in revision pass 3 — including the one thing this pass changed its mind about.**

28. **Everything revision pass 3 corrected was verified by READING THE SOURCE IN THIS WORKTREE, and
    the readings are named so a later session can re-check them rather than trust them.** Read and
    quoted: `proposals.cjs` 77 (`appliers` typed as `(proposal, opts) => result`), **215**
    (`authorise(opts.user, 'self-modify.apply')` **before** the applier runs), **229–235**
    (`applier(p, opts)` — **two arguments**), 240/248 (resolve ⇒ `APPLIED`, throw ⇒ `FAILED`), **272**
    (`proposals:apply` passing `opts` through untouched), 282–289 (`proposals:create` gated on
    `canView`, i.e. tier 1); `preload.cjs` **677–680**; `capability.cjs` **27–33** (`can()` reads
    **only** `user.tier`); `selfModel.cjs` **206–266** (the `limit()` helper and all seven prose
    `fixable` strings, quoted verbatim in §E.4.1); `electron/dataStore.cjs` **44** (`DOMAINS`), **78–79**
    (`saveAll` writes per dirty domain), **305–311** (`markAllDirty` instantiates every default);
    `registrySources.cjs` **103/118/188** (`{rows, failures}`); `refreshScheduler.cjs` **133**
    (`await task.run()`) and **220** (`stop()`, exported); `selfCare.cjs` **125, 200, 224, 345, 396**
    (**two** arming sites); `marketIntel.cjs` **731, 748, 784–785, 796**;
    `agentOrchestrator.cjs` **122, 140, 359, 637** (`killFn` at **637**, not 634);
    `main.cjs` **552, 566, 570, 579**; and `RAMA_MODEL_EVALUATION.md` §10 **lines 1359 and 1361**
    (roadmap rows 3.1 and 3.3). **None of it was executed.**
29. **`isHalted()` — the two-predicate split — is the largest unexercised change in this pass.** Its
    correctness claim is *"a shipped install still runs the four pre-existing dispatchers exactly as
    the current build does"*, and **that has been reasoned from the source, not observed.** Criterion
    22d is written to prove it with counting fakes, and it should be written **before** any of the four
    modules is touched, because the failure mode it guards is silent: a working behaviour that stops
    happening does not raise an error.
30. **The claim "six of seven sensors can reach no declared edit" is a reading of today's source, and
    it will change.** It follows from the shape of the seven `fixable` strings and from
    `ADAPTERS` declaring `null` for six sensors — both of which are facts about this moment. **Adding
    one adapter changes the number**, which is why criterion 90a **prints** it rather than asserting a
    constant.
31. **`requireMasterDriven`'s carve-out is a REASONED SAFETY ARGUMENT, not a measured one, and it is
    the single most load-bearing new claim in this pass.** The argument is that `apply-source` and
    `revert-own-apply` describe master's act, so ignoring the STOP for exactly those two is not a hole
    in the STOP. **If that argument is wrong, the STOP has a two-class gap and nothing in this document
    would catch it** — criterion 21b's planted mutation only proves a *third* class cannot be added. It
    is raised in §I.11 for exactly that reason.
32. **The one place this pass declined the review's proposed mechanism and the divergence is
    load-bearing:** the review's fix for finding 2 was to derive
    `masterDriven = capability.can(opts.user, 'self-modify.apply')` and refuse when
    `!masterDriven && stop.isStopped()`. **Measured, that predicate cannot be false where it is
    evaluated** (`proposals.apply` already authorised `opts.user`) **and is forgeable where it could
    be** (`capability.can` reads only `user.tier`). The derivation is kept as defence in depth; the
    guarantee moved to criterion 21c's asserted absence of in-process callers. **A reader who prefers
    the review's version should know that the design did not skip it — it adopted it and then said
    what it does not buy.**

---

# PART I — RAISED FOR MASTER, NOT RESOLVED

**I.1 — The one reading the whole fence rests on: does approving a proposal authorise its revert?**

§E.6's position is that **approving proposal P authorises exactly two tree states — P applied and
verified, or the tree as it was when P was approved — and nothing else**, because the revert target is
fixed by digests inside the record you approved. On that reading the automatic revert is *covered by* I6
rather than an exception to it. **If you read I6 more strictly, say so and the design lowers
`revert-own-apply` to L0:** a failed apply then leaves the tree changed, reports the named cause, and
files a question. That is more literal and strictly worse in practice — a verification failure would
leave Rāma's source in the broken state until you acted. **I have not assumed your answer; the class is
built lowerable precisely so this is your call and not mine.**

**I.2 — Two capability-matrix and two protected-file edits only you can make.**

`shared/capabilities.json` and `loyaltyGuard.cjs` are protected files and were not touched.

- Add `"system.suspend-autonomy": 0`, `"autonomy.view": 1`, `"memory.record-prompts": 0` (§E.13 gives the
  reasoning per tier and exactly how each feature degrades until you do).
- Add `electron/lib/autonomyPolicy.cjs` and `electron/lib/autonomyStop.cjs` to
  `loyaltyGuard.PROTECTED_FILES` **and** to `shared/loyalty-tripwire.json`, which needs
  `--approve` with the exact digest **plus a `--note`**. **Until then the only mechanical guard on the
  policy table and the stop is `upgradeProposer`'s refusal, and the proposer is not itself protected** —
  the suite prints this residual on every run rather than letting it pass as covered.

**I.3 — The backup question is now one decision, and §9.2 is still open.**

Addendum A §A.2(4) said the accumulated record is *"part of what makes Rāma Rāma — the most irreplaceable
asset in the system"*, which argues for backing it up, **while a backup is exactly how a local-only
record stops being local-only.** §E.7.5 excludes the context domain from backup (criterion 80) **as the
safe default, not as an answer.** The proposed resolution is the loyalty envelope's posture — opaque
encrypted bytes under a key you hold, never plaintext, never automatic — but **Section 124 §9.2's backup
framing has still never been approved, and this is now ONE decision with that one.** I have not chosen it.

**I.4 — Should `propose-source` and `author-change` ship at L1, as designed? (A question about TWO DATA
VALUES.)**

> *Narrowed in revision pass 1 (review-1 finding 4) and widened by one value in pass 2, because the
> design now has an author and a diff needs both classes raised (review-2 finding 1). This asks only
> what you would put in `shared/autonomy-policy.json` — **a file that ships absent**, so answering
> "leave it" is a valid answer that requires creating nothing. The FLOORS (L1) and the CEILINGS (L3)
> are frozen code and are not on the table: whatever you answer, a fresh install with no data file
> still proposes nothing and authors nothing.*

The design ships both at **L1**, so the loop notices, researches, **authors nothing**, weighs and files
a **question** rather than a diff. The argument: it makes your first unlock a pure data change exercising the real mechanism at zero
risk, it keeps Section 124's Level-2 measurement true, and it means you see a dossier before you ever see
a diff Rāma wrote. **The cost is that the loop does not reduce your burden on day one** — which is
precisely what you asked it to do (*"Trying to reduce burden on MASTER"*). **If you want diffs
immediately, that is two values in `shared/autonomy-policy.json` — `propose-source: "L3"` and
`author-change: "L3"` — and no code changes.** I designed the cautious default and am naming the
tension rather than hiding it inside a default. **One caveat that belongs with the answer: even at L3,
a diff only appears when a declared `EDITS` entry matches the finding's remedy (§E.4.2a), so raising
both will produce fewer patches than it sounds like — and that is §I.9's question, not this one.**

**I.5 — Still open from Section 125, deliberately untouched: I15's wording versus fail-closed behaviour.**

I15 as written describes a **revert**; the current concentric layout **refuses** (`timingSafeEqual` fails,
`openCore` errors, `unseal` throws, Rāma does not start). Section 124 §9.1 raised it, Section 125 left it,
and this design does not touch it. **Repeated here because a cold session reading I15's wording might
BUILD the revert it describes, and a revertible core is a weaker core.**

**I.6 — A question this design deliberately does not answer: what counts as "exponentially grow"?**

Your instruction is *"exponential increase means understanding requirement and upgrading/proposing
upgrades after thorough research & review"* — which this design implements as a loop that proposes. **But
the loop's output rate is bounded by your approval rate, by construction, and that bound is the fence.**
So the honest statement is: **this design makes Rāma's proposals better-researched, better-weighed and
recoverable; it does not and cannot make them more numerous than you approve.** If what you want is
throughput rather than quality, the only lever is raising a class — which is §I.4's question, asked once
rather than implied everywhere.

**I.7 — The roadmap ordering exemption. One line to confirm or refuse.** *(Added in the revision pass.)*

`RAMA_MODEL_EVALUATION.md` §10 puts the autonomy ladder (**4.1, R-G2**) in **Phase 4**, gated *"only
after phases 0–3"*, and phases 2–3 are open: the source-integrity manifest (2.1), byte-level backup
(2.2), the offline rebuild (2.3), the durable memory authority (3.1) and **running the Python engine at
all** (3.6). The stop (**1.4, R-L4**) is Phase 1 and is in order.

**The argument for doing 4.1 now:** it *declares* the ladder and *climbs no rung*. Today every
self-modifying path answers *"may Rāma do this alone?"* however its call site happens to; after this,
every one of them refuses unless a frozen constant permits it, and nothing ships above `propose-only`.
**Declaring the ladder subtracts capability; climbing a rung adds it.** On that reading the ordering
rule — which exists to stop capability landing before the machinery that contains it — is honoured
rather than bent.

**If you read it the other way, say so and this work waits behind 2.1/2.2.** The cost of waiting is
that the policy layer is also what *constrains* the loop, so deferring it means the sensors stay
unread and nothing answers *"has Rāma earned this?"* for longer. **I have not assumed your answer, and
4.2 (bounded planning) stays out of scope and blocked either way.**

**AND THERE IS A SECOND HALF TO THIS QUESTION THAT REVISION PASS 2 DID NOT ASK** *(added in revision
pass 3 — review-3 finding 12)*. The design claimed it implemented exactly two roadmap rows, 1.4 and
4.1, and built the exemption on 4.1 being **strictly subtractive**. **Measured against §10, that was an
under-count: §E.7's context store also sits on PHASE 3 — row 3.1 (R-M1, one durable memory authority,
gate tier-0 `memory.write-durable`, §10 line 1359) and row 3.3 (R-A4, reflex synthesis as a
`SELF_MODIFY` proposal, gate tier-0 `memory.record-prompts` default off, and explicitly "requires
§9.4", line 1361).** Neither appeared in the table, **and the subtractive argument does not cover
them**: a record schema, an index, a reindex, retention, a purge, a join and an egress gate are new
machinery, not removed capability.

**What I claim instead, narrowly:** §E.7 **builds the vessel and nothing else.** `recording: false`;
**`memory.record-prompts` is not added to `shared/capabilities.json`**, so `can()` refuses it for
everyone including you; **no row is ever written** (criterion 75); `selfModel` keeps reporting the gap
(criterion 57). **No capability is added because the key does not exist** — which is a stronger gate
than a default-off flag, since there is nothing to flip. **And §9.4's privacy precondition for 3.3 is
NOT claimed met; it is raised** (§I.3, and §9.2's backup question with it). **So the question is two
lines, not one:** (a) is the 4.1 declaration-is-subtractive argument accepted? and (b) **is a
record-nothing vessel on 3.1/3.3 acceptable ahead of Phase 3, or should §E.7 wait and Section 128 ship
with the loop, the policy and the stop only?** Splitting it that way is possible: §E.7 is the one part
of this design nothing else depends on.

**I.8 — Three things the revision passes could not settle without you.** *(Two added in pass 1, one in
pass 2, and the first one materially re-scoped in pass 3 — the count of paths went from four to seven,
and what the gate call at each of them actually buys turned out to be an audit record rather than a
refusal.)*

- **The SEVEN non-model outbound paths** (§E.7.4 rows 1–7; the count was four until revision pass 2
  re-measured it): `voiceEngine`'s transcription POST, the search-URL builders in `browserEngine`,
  `codeRegenEngine` and `intelligenceEngine`, and `evolutionEngine`'s three. They are gated **by a
  call, with the call count asserted** — not by a chokepoint,
  because there is no single point they all pass through. **An eighth engine added later would be
  unguarded until someone adds the call.** The alternative is a real chokepoint — routing every
  outbound request through one gated helper — which touches `http.cjs` (I9's module) and five engines,
  and is a larger change than this design should make unasked. **Raised rather than chosen.**
  **And revision pass 3 narrowed what those seven calls actually BUY, because the prose was crediting
  them with more** (review-3 finding 10): each passes a **bare string**, and FR-33b's declared default
  is that **an unclassified part PASSES** — so those seven calls **cannot refuse anything.** They are
  **audit points**: a recorded, counted, planted-against call at every outbound text path, which is
  worth having. **What enforces FR-51 there is the construction of the query, not the gate**, and the
  residual now says so. **Only site 8 — this design's own `upgradeResearch` — classifies its parts at
  construction, so only there can the gate genuinely refuse.** If you want the other seven to refuse
  too, that is a per-site decision about classifying master's own query text, and it is a different
  question from this one.
- **`voiceEngine` sends AUDIO, not text**, and `gateOutbound` classifies text parts. A recorded voice
  request is arguably the most sensitive thing in the system and the gate as designed cannot inspect
  it. Today nothing records audio and the context store holds no audio, so there is no live leak —
  **but if you ever enable voice recording, this gate does not cover it, and that needs its own
  decision rather than an assumption that the text gate generalises.**
- **`evolutionEngine.readRepoFiles` is left ungated on a judgement** (added in revision pass 2): it
  reaches the GitHub API carrying repository and file-path names rather than caller text. That reads as
  harmless, and it is the kind of thing that stops being harmless the first time a finding's remedy
  names a private repository. **Printed as a residual; gate it if you disagree, and it is two lines.**

**I.9 — May a MODEL ever write Rāma's own source? Refused here, designed for, and yours to answer.**
*(Added in revision pass 2, because review-2 finding 1 found the design had no author at all and
answering it decides more than it looks like.)*

§E.4.2a's author is **template-only**: a frozen table of four mechanical transforms over bytes read
from disk, so `changes[].content` is reproducible and *"nothing invented by a model"* holds for the
change body as well as the finding. **The cost is real and is stated rather than buried: most findings
will not match any declared edit, so most of what the loop produces will be a question with a
researched remedy in words, not a patch.** `build-repair` therefore means *"the repairs this table can
express"*.

**The unlock is one frozen constant — `AUTHORING_MODES = ['template']` — plus two conditions I have
specified in advance so a later session cannot invent softer ones:** the authoring model must classify
`destinationOf(...).dest === 'local'`, so Rāma's own source is never shipped to a cloud model to be
rewritten; and the weighing gains a mandatory con naming the model, because a weighing that does not
say which of its terms is unmeasured misleads the person reading it. **Three things to weigh if you are
inclined to allow it:** it would widen what the loop can repair by a large factor; it would make the
most sensitive text in the system — your source — an outbound payload, even to a local model; and
**a model-authored patch is exactly the input the fence was built to contain, so allowing it raises the
cost of every other guarantee in this document being right.** I have not assumed your answer. The
record field (`changes[].author`), the constant, and the suite row that currently refuses `model:*`
all exist so that your answer is a data-and-approval change rather than a redesign.

**I.10 — Should `marketIntel`'s two background timers halt with the STOP, or be declared exempt?**
*(Added in revision pass 2 — review-2 finding 7.)*

They are halted as designed: `tickResolveOutcomes` writes outcome resolutions and `tickSyncNews`
fetches news, both on their own schedule, which is autonomous work by any reading. **But they are also
StockMind's background freshness**, and §E.2.5 promises *"StockMind on demand"* keeps working — which
it does, because your calls arrive through IPC handlers rather than these ticks. **The question is
whether a stopped Rāma should also mean stale market data.** The alternative is to declare them
`stopExempt` beside the agent governor, with the reason recorded and printed. **I chose halting because
FR-12 says "every existing timer that can change Rāma's own state or reach the network on its own
initiative", and these do both** — but the cost lands on you, in a surface you use daily, so it is
yours to confirm.

**AND REVISION PASS 3 WIDENED THIS QUESTION FROM ONE TIMER TO FOUR, BECAUSE THE REVIEW FOUND THAT THE
WAY REVISION PASS 2 WIRED THE STOP WOULD HAVE HALTED ALL FOUR ON EVERY INSTALL, WITHOUT ASKING YOU**
*(review-3 finding 3)*. Revision pass 2 had **one** state predicate — fail-safe, absence means stopped
— governing both the six new chokepoints **and** the four pre-existing dispatchers. Measured, those
four govern work that **runs on your machine today**: `ollama-catalog`, `dependency-review`, the
metacognition audit, **`selfCare`'s 120-second health sweep including `checkInstanceFailover`** — which
per ledger row 49 expresses a dormant gene on a sibling instance — and `marketIntel`'s two ticks. **So
installing that design would have switched five working behaviours off until you hand-created a file
nobody had told you about.** That is not a fail-safe, it is a regression with a safety argument
attached, and I11 does not have an exception for it.

**The design now has two predicates (FR-12): `isStopped()` for the new loop, fail-safe, absence means
stopped; `isHalted()` for the four pre-existing dispatchers, true only when you engage explicitly.**
So a fresh install keeps everything you have today and the loop does nothing. **What I need from you
is which of these you want, stated once:**

1. **As designed** — the four keep running until you engage the stop, and engaging halts all four.
2. **`marketIntel` exempt** — the other three halt on engage; market freshness never stops. (This is
   §I.10's original question.)
3. **Per-timer** — you tell me which of the five named behaviours halt and which are `stopExempt`, and
   each exemption is printed with its reason beside the agent governor's.

**I have not assumed. Option 1 is built; 2 and 3 are declared-data changes to the dispatcher table, not
redesigns.**

**I.11 — The two-class carve-out that keeps your own apply working. One line to confirm, and it is the
most load-bearing new claim in this pass.** *(Added in revision pass 3 — review-3 finding 1, and
§H.31 records that it is reasoned rather than measured.)*

**The problem it solves was real and shipped in two drafts.** The STOP resolves **every** autonomy
class to `L0`; a shipped install has no allow-file and is therefore stopped; and the applier checked
`policy.require('revert-own-apply', 'L4')` at entry. **So on every shipped install, a proposal you had
approved could not be applied at all** — and the automatic revert that the whole AFTER-APPLY guarantee
rests on was forbidden. Revision pass 2 half-fixed it by raising the floor to L4, which fixed the
*data* state and left the *stop* state broken; the same hole was reachable with a valid allow-file
through `RAMA_AUTONOMY=stop`.

**The fix: `apply-source` and `revert-own-apply` are a frozen `MASTER_ACT` subset, and
`requireMasterDriven` — the only function that may ignore the STOP — throws for any class outside it.**
The argument is the one §E.6 and §E.1.1 already make: **applying, or undoing, a change you already
approved is YOUR act, and the STOP exists to halt RĀMA STARTING WORK.** On that reading the carve-out
is not a gap in the STOP, it is the STOP being correctly scoped.

**What I need you to confirm is that reading, because if it is wrong the STOP has a two-class gap and
nothing in this document would catch it.** Criterion 21b plants a mutation adding a *third* class and
requires the row to go red — it cannot test whether the first two belong. **The alternative, if you
read it the other way:** no carve-out, the STOP blocks apply and revert too, **and the consequence is
that you must create the allow-file before you can apply anything at all** — which makes the allow-file
a prerequisite for using the Approve button rather than a prerequisite for autonomy, and makes the
automatic revert dependent on autonomy being allowed. **I think that is the wrong trade and I have
built the other one. It is two frozen class ids either way.**

---

# PART J — DISPOSITION OF EVERY REVIEW FINDING

*Three review passes, three tables. **§J.0 is revision pass 3** — the current review,
`design-review.json` → `design-review.md`, **4 HIGH / 10 MEDIUM / 5 NIT**. **§J.1 is revision pass 2**
(7 HIGH / 9 MEDIUM / 5 NIT); **§J.2 is revision pass 1** (7 HIGH / 14 MEDIUM / 5 NIT). Both older
tables are kept **unedited**.*

> **Why the current pass is numbered `J.0` rather than renumbering the two below it.** §J.2's rows
> cross-reference §J.1 by name — *"§J.1 row 4 re-measured it"*, *"§J.1 row 15"* — so shifting the
> headings would break every one of those pointers. This document's own habit is to **append rather
> than renumber** (FR-49…FR-59 after FR-48, criteria 81…96 after 80, lettered rows beside the row they
> extend), **so that a finding and the row that answered it stay traceable across passes.** The same
> habit applied to the table headings puts the newest pass first without touching the two behind it.

## J.0 — Revision pass 3

**Review:** `docs/research/design-review.json` → `design-review.md`, reviewed against the source in
this worktree. **Verdict: `CHANGES_REQUESTED` — 4 HIGH, 10 MEDIUM, 5 NIT.**

**Summary: all 4 HIGH and all 10 MEDIUM are ADDRESSED IN PLACE. All 5 NITs are addressed. Nothing is
backlogged.** **Two findings are answered with a mechanism different from the one the review proposed,
and both divergences are load-bearing rather than cosmetic** — stated in their rows and again in the
block below the table, because a divergence adopted silently is how a review becomes theatre.

> **THE PATTERN ACROSS THE THREE PASSES, AND IT IS THE MOST USEFUL THING IN THIS DOCUMENT:
> every HIGH finding in this pass was a defect the PREVIOUS PASS INTRODUCED WHILE FIXING ITS OWN.**
> Raising `revert-own-apply`'s floor to L4 (pass 2's fix for pass 2's finding 5) fixed the data state
> and left the stop state refusing master's apply. Replacing the unconditional stop check with
> `opts.autonomous` (pass 2's fix for pass 2's finding 6) moved the predicate into renderer input.
> Making the stop fail-safe over every dispatcher (pass 1's and pass 2's fix for finding 7) turned a
> safety mechanism into a five-behaviour regression. Adding an author with a frozen `EDITS` table
> (pass 2's fix for pass 2's finding 1) declared a prose matcher for strings that are all prose.
> **None of the four was a missing idea; all four were a fix whose consequence nobody measured.** That
> is the argument for a fourth pass, and for writing the measurement into the suite — criteria 21b,
> 22d, 90a and 83a all exist so the next such consequence goes red instead of shipping.

| # | Sev | Finding, in one line | Disposition | Where, and what changed |
|---|---|---|---|---|
| 1 | HIGH | With the STOP engaged every class resolves to `L0`, so the applier's unconditional `policy.require('revert-own-apply')` refuses a **master-approved apply on every shipped install** | **Addressed in full, by the review's mechanism** | **FR-53** declares a frozen **`MASTER_ACT = {apply-source, revert-own-apply}`**; **§E.1.3's resolver gains `effective(c, {ignoreStop})`** with a blockquote showing the only consumer; **`policy.requireMasterDriven(classId, need)` THROWS for any class outside `MASTER_ACT`**, which is what makes the carve-out a two-class declaration rather than a hole. **§E.1.4** adds it to the API; **§E.5.0's new check 0** and **§E.5.1a** carry it at the applier; **§E.10** gains an ownership row; **FR-17's blockquote** states the defect in full. **Criterion 21b is the row that would have caught it, and it runs in the SHIPPED state — no allow-file, no policy file — plus the second reachable form, `RAMA_AUTONOMY=stop` over a valid allow-file: six assertions, and a planted mutation adding a THIRD class to `MASTER_ACT` turns it RED.** `effective(c)` with no options is unchanged, so **criterion 6a still asserts `L0` for all fifteen.** **And §H.31 records that the carve-out's safety argument is reasoned, not measured, and §I.11 asks master to confirm the reading** — because criterion 21b can prove a third class is refused and cannot prove the first two belong. |
| 2 | HIGH | The STOP is consulted on an apply only when `opts.autonomous === true` — and `opts` is **renderer input passed through untouched**, so the predicate is supplied by the party the STOP exists to stop | **Addressed — the review's direction adopted, its specific predicate adopted AND declared insufficient, and the guarantee moved to an asserted absence** | **Direction adopted in full: `opts.autonomous` is never consulted as a gate; it is recorded into `meta.autonomy`** (FR-54, §E.9's new `opts` row, criterion 83a). **The review's derived predicate is also adopted — `masterDriven` from `opts.user`, unconditional, no tier-0 user no write** (FR-53, §E.5.0 check 0). **But it is written down as NOT SUFFICIENT, with the measurements:** `proposals.apply` already ran `authorise(opts.user, 'self-modify.apply')` at `proposals.cjs` **215** before the applier is reached, so inside the applier the predicate is **tautologically true**; and `capability.can` reads **only** `user.tier` (`capability.cjs` **27–33**), so a `{tier: 0}` object is **forgeable by any in-process caller.** *A predicate that cannot be false where it is evaluated is not a gate.* **So the guarantee is an ABSENCE: FR-55 plus criterion 21c assert ZERO in-process callers of `proposals.apply` across the tree**, in criterion 18's shape, with the future L5 entry point (`upgradeLoop.applyAutonomously`) **named, absent, and specified to consult `isStopped()` at its OWN entry** — where a start-of-work check belongs. **The review's requested assertion is kept and its real reason named:** an apply with no user and no flag, while stopped, never reaches a write — refused for the missing tier-0 user, **not** by the stop. §E.2.5, §E.5.1a, §E.10 and Parts F and G all rewritten. |
| 3 | HIGH | Absent configuration means stopped, and the four dispatch points govern work that **ships and runs today** — so installing this removes four working behaviours on every install, contradicting FR-5/I11 | **Addressed in full — the review's option (b), two-tier state; option (a) explicitly REFUSED with its reason** | **FR-12 gains a blockquote declaring TWO predicates: `isStopped()`** (fail-safe, absence ⇒ stopped) **for the six new chokepoints, and `isHalted()`** (true only on an explicit `engage()` or `RAMA_AUTONOMY=stop`) **for the four pre-existing dispatchers, where absence means "as the build master already has".** **FR-13** states the asymmetry as a decision. The four dispatch rows in **FR-12, §E.0.1 and §E.2.5** now read `isHalted()`; **§E.2.1 carries both functions**; **§E.2.7 gains the sentence revision pass 2's shipped-state paragraph was missing — the four keep running — plus the two sentences the panel must show**; **§E.8 rows 3a/3b**; **§E.10's STOP row**; **§E.12's panel requirement**; **§D.8 row 1.4**. **Criterion 22d is six assertions including the planted mutation that collapses the two predicates back into one**, and it is the row that goes RED on the regression. **Option (a) — the first-run migration writing an allow-file — is refused and the reason recorded: the allow-file is what `isStopped()` reads, so every upgraded profile would have started with the NEW loop ALLOWED**, which is the one state §E.2.7 exists to prevent. **And §I.10 is widened from "`marketIntel`?" to all four, with three named options** (as designed / `marketIntel` exempt / per-timer), since the review correctly noted §I.10 asked about one timer. §H.29 records that none of it has been run. |
| 4 | HIGH | No matching grammar exists for `EDITS`, and all seven `selfModel` `fixable` strings are prose — so the sensor called "the natural input to NOTICE" has **zero reachable edits** | **Addressed in full, by the review's mechanism, and the measured consequence is PRINTED rather than softened** | **FR-56** declares `finding.remedy = {editId, params} \| null` from a **frozen per-sensor `ADAPTERS` table, never parsed out of prose**; **§E.4.1 gains a subsection quoting all seven prose strings verbatim** and the adapter table (`selfModel → null` **by declaration**; `dependencyAdvisor → pin-version`; the other five `null`); **§E.4.2a's `EDITS` table is rebuilt** with a `params` **schema** instead of a prose `matches` column, a **`producedBy`** column, and `pin-version` moved first because it is the only reachable entry; **§E.10** gains an ownership row; **criterion 41 is re-scoped to four assertions using the one really-reachable path** rather than a synthetic fixture. **Criterion 90a is the row the review asked for and it prints two numbers: `sensors with no reachable edit: 6 of 7` and `editIds with no producing adapter: 3 of 4`** — eleven assertions. **The honest consequence is stated in §E.4.1, §E.4.2a, §E.11's residuals, Part F, Part G and §I.9: today this loop can author exactly ONE kind of change, a dependency version pin.** That is a much narrower claim than revision pass 2's, and it is the one the code can keep. |
| 5 | MED | `proposals.cjs` 230 calls `applier(p, opts)` — two arguments — so no injected `io` can reach the applier, and the document gives three different signatures | **Addressed in full, by the review's mechanism** | **FR-57** declares **one** signature: **`register(ledger, io)` closes over `io` and registers `(proposal, opts) => applyWith(io, proposal, opts)`; `applyWith` is exported for the suite.** **§E.5.0 opens with the code and the measurement** (`proposals.cjs` **235**, two arguments, and the file is protected so the call shape is not negotiable); **§E.5.1a** and **§E.5.2a** rewritten to `applyWith(io, proposal, opts)`; **§E.0.1's applier row** and **§E.11's testability list** updated; **NFR-2 gains the closure clause.** **The other two forms are DELETED, not deprecated**, because a signature that appears twice is a signature a coder picks from. |
| 6 | MED | `opts` arrives from the renderer and reaches the applier whole, yet §E.9 has no row for it | **Addressed in full, by the review's mechanism** | **FR-54** plus **a new §E.9 row**: recognised keys **exactly `{user, autonomous}`**; `autonomous` recorded into `meta.autonomy` and never consulted as a gate; **no path, directory, plan, `cwd`, timeout, environment value or force flag is ever read from `opts`**; unrecognised keys **ignored, not rejected** (`proposals.cjs` may add one and this design has no veto over a protected file). **Criterion 83a is four assertions including the source-shape row the review asked for** — `upgradeApplier.cjs` reads no `opts` member other than `user` — and an apply carrying five poisoned keys that ignores all five. The row states the review's own reasoning: **FR-13a's lesson is that a persisted string used as a write destination is a leak path, and an `opts.snapshotDir` added later is the same mistake through a different door.** |
| 7 | MED | Nothing declares where `require()`'s `need` comes from, and `upgradeWeigh.weigh` is a chokepoint no class covers | **Addressed in full, by the review's mechanism, including the sub-table and the L0 question** | **FR-10 rewritten**: `policy.require(classId, need)` with **`need` required and THROWING when absent**, and the refusal naming both. **§E.1.4 carries the frozen `GATED = [{module, fn, classId, need}]` with all six rows spelled out** — `collect`/`observe`/L1, `gather`/`research-network`/L2, `author`/`author-change`/L3, **`weigh`/`research-local`/L1 (PICKED, with the reason: it reads repo files, walks the tree via `analyzeImpact` and runs `git` read-only, which is §E.1.2 row 2's definition verbatim)**, `file`/per-kind/L3, `applyWith`/`revert-own-apply`/L4. **The `file()` sub-table is there too** (QUESTION → `propose-question`; DIFF → `propose-source` \| `dependency-change` \| `build-repair`). **And the question the review asked last is answered as FR-59: with `propose-question` at L0, `file()` files NOTHING and says so loudly** — the run log, `policyStatus()` and the panel all carry `{blocked, classId, have, need}`, because *a loop silenced by data must not look like a loop with nothing to say*. **Criterion 13 now asserts the FULL literal `policy.require('<classId>', '<need>')` plus a throw on a missing `need`; criterion 13a is four assertions over the sub-table and the L0 case.** |
| 8 | MED | `markAllDirty` + `saveAll` guarantee a context domain file, so criterion 75's *"no context bytes anywhere"* is **red on a correct implementation** | **Addressed in full, by the review's wording** | **Criterion 75 reworded to the review's three assertions**: the domain decrypts to `{rows: [], index: null, recording: false}`; `rows.length === 0` and `index === null`; **a filesystem assertion proves no context ROW PAYLOAD exists.** **§E.7.6 gains the paragraph with the measurements** (`dataStore.cjs` **305–311** instantiating every default, **78–79** writing per dirty domain) and the sentence that matters: **the domain file is present because I14's re-key requires it.** Propagated to **Part F**. The row records *why this was dangerous rather than merely wrong*: **the natural way for a coder to make the old claim green was to remove `'context'` from `DOMAINS` — losing the re-key coverage §E.7.1 calls its deciding finding.** |
| 9 | MED | `gateOutbound` is specified as pure and synchronous but lives in a store-bound module, and the design never says what happens when the store is locked | **Addressed in full, by the review's mechanism** | **FR-58** plus a **new module, `electron/lib/classificationGate.cjs`** (§E.0.1), dependency-free: no `dataStore`, no `cryptoCore`, no `electron`. **`contextStore` re-exports `gateOutbound` and the classification constants, so every call site in §E.7.4 reads unchanged.** **§E.7.4 gains a blockquote** making the design's own argument against itself — *"a stop that can fail to load is not a stop"*, and a gate that throws because the vault is locked is a **chat failure, not a refusal**. **Criterion 77a is three assertions in criterion 16's shape**: no store/crypto/Electron at module scope; `chatCompletion` answers normally with the context store **locked**; and with `dataStore` **unresolvable**. §E.10 gains an ownership row; §E.11 lists the new pure suite. |
| 10 | MED | FR-33b's pass-by-default means `upgradeResearch`'s two bare-string parts make the gate call **unable to refuse**, so FR-51's credited enforcement is a different mechanism from the one the prose names | **Addressed in full — the review's PREFERRED option, classify at the source** | **FR-51a** declares that **a part is classified at construction**: `upgradeResearch` builds `{text: finding.what, classification: 'shareable'}` and the field name likewise, and **anything derived from `measurement.value`, file contents or a `stderr`/`stdout` excerpt is constructed `local-only`** — so **criterion 93 gains a POSITIVE case (a part built from `measurement.value` is REFUSED), not merely an absence.** **§E.4.2's code block is rewritten** with the classified parts and a blockquote carrying the review's own sentence — *"a verification step that cannot fail is not a verification step"*. **And the other half of the review's fix is also taken: §E.7.4 states plainly that rows 1–7 are AUDIT POINTS, not enforcement points**, that what enforces FR-51 there is the construction of the query plus criterion 54a's counted call, and **the residual is printed** in §E.11 and raised in §I.8. FR-33b carries the forward pointer. |
| 11 | MED | `engage(reason)` deletes the allow-file and returns, destroying the record of who allowed autonomy and dropping its own reason | **Addressed in full, by the review's mechanism** | **FR-16a**: `engage(reason, by)` **writes `<userData>/rama/autonomy.stopped.json` carrying `{at, reason, by, priorAllow}` BEFORE unlinking the allow-file.** **§E.2.3 gains the code and the argument**; **§E.5.5 names the call the fatal revert makes** (`engage('revert failed: …', 'upgradeApplier')`) and why that reason is the most important datum in the system at that moment; **§E.8 row 3b** makes an unwritable record **fatal and non-proceeding**, so a crash leaves a recorded reason and a live allow-file — **inconsistent in the recoverable direction.** `statusText()` and the panel read it **for the reason**; `isHalted()` reads **its presence** for state; **`isStopped()` never reads it at all, so an absent stopped-record never implies autonomy is running** — the review's requested assertion, in criterion 14's shape, inside **criterion 22c (now eight assertions, including the write-ordering fake)**. Propagated to Parts F and G. |
| 12 | MED | §D.8 claims exactly two roadmap rows while §E.7 also sits on Phase 3's 3.1 and 3.3, which the subtractive argument does not cover | **Addressed in full, by the review's mechanism** | **§D.8's intro now says THREE rows** and gains a **third table row naming 3.1 (R-M1, tier-0 `memory.write-durable`, §10 line 1359) and 3.3 (R-A4, tier-0 `memory.record-prompts`, "requires §9.4", line 1361)** — both verified in `RAMA_MODEL_EVALUATION.md` during this pass. **It states that §E.7 builds the VESSEL ONLY** (`recording: false`; the capability **not** added, so `can()` refuses it for everyone; no row ever written, criterion 75; `selfModel` still reporting the gap, criterion 57) **and that §9.4's precondition is NOT claimed met**, and **says outright that the subtractive argument does not cover them** — a schema plus an index plus a purge is new machinery, not removed capability. **§I.7 is extended into a two-part question** (a: accept 4.1's subtractive argument? b: is a record-nothing vessel acceptable ahead of Phase 3, or should §E.7 ship separately?) **with the note that §E.7 is the one part of this design nothing else depends on, so splitting it is possible.** Part G's §I list updated. |
| 13 | MED | FR-1 forbids writes under the repo root while §E.5.2's plan runs `vite build` and the suites, and criterion 1's scan cannot see spawned writes | **Addressed in full, by the review's mechanism** | **FR-1 narrowed** to *"no DIRECT filesystem write by code introduced here, except (a) an approved apply, (b) the FR-28 revert, (c) the derived snapshot directory"* — **and widened beyond the repo root**, which is the other half of FR-13a's lesson. **One declared exception names the spawned steps and their write targets** (`vite build` → `dist/`, each suite → its own temp dir) **plus the bounding rule: no step argument, `cwd` or environment value is ever taken from persisted `meta`.** **Criterion 1 prints the exception rather than hiding it; criterion 83 gains four assertions** — the `cwd` equals the repo root and is not read from `meta`/`opts`; every `execFile` argument derives from the re-derived change set or the frozen step vocabulary, proven by a launch-recording fake; no `env` element comes from the record; and the write targets are printed in the residual list. |
| 14 | MED | A5 / Part F / Part G claim Sections 128–129 and rows 148–149 are free; measured, **129 and 149 are taken** and 129 sits after 130 in file order | **Addressed in full, by the review's mechanism — the claim is replaced by a COMMAND** | **A5 rewritten around the two `grep` invocations to run immediately before pasting**, with the pass-3 measurement recorded as a dated reading rather than a standing fact: **125/126/127/130/129 exist in that FILE order** (129 at line 14116, **after** 130 at 13973); **147, 150 and 149 are taken, with 150 appearing before 149**; **128 and 148 are free, so the paste targets are correct and the supporting claim was wrong.** **Part F's and Part G's notes both carry the commands and the warning not to trust the note.** **And the review's last point is taken: *"numeric position" is not a convention this file currently keeps*** — Part F still asks for it as the better habit for the next reader, and says so. |
| 15 | NIT | FR-19 says `rows` is what `registrySources.collect` returns; it returns `{rows, failures}` | **Addressed, with the review's extension** | **FR-19 reads `.rows`** (measured, `registrySources.cjs` **118** and **188**), **and `failures[]` feeds `sensorsAbsent[]` rather than being dropped** — §E.4.1's absence paragraph carries it, with the reason in `dependencyAdvisor`'s own words: a package whose registry lookup failed is a package **not checked**, and reporting it as *"no action"* is the one dishonesty that module's header calls the most tempting. |
| 16 | NIT | §E.0 says twelve edits; §E.0.1 lists nineteen changed files | **Addressed, and made un-driftable** | **§E.0 now reads "NINETEEN changed files, TWELVE of them the stop-and-gate edits"** and **names all twelve** — `refreshScheduler`, `metaCognition`, `selfCare`, `marketIntel`, `agentOrchestrator`, `sandboxEngine`, `customProviders`, `voiceEngine`, `browserEngine`, `codeRegenEngine`, `intelligenceEngine`, `evolutionEngine` — **and names the other seven as outside the count**, exactly the partition the review measured. **Criterion 96 asserts and prints both numbers**, the way criterion 95 owns the class table: *a count in two places is a count that drifts, and this one already had.* The new-module count is corrected to **eleven** (finding 9's `classificationGate.cjs`) in §E.0 and Part G. |
| 17 | NIT | `agent.killFn` is at 637, not 634; and `selfCare` arms the sweep at **both** 345 and 396 | **Addressed** | **637 corrected in §E.0.1 and §E.2.5 and criterion 22c**, with the reason it mattered: `killFn` also appears at **122, 140 and 359**, so "634" pointed at a different caller. **And the two `selfCare` arming sites are stated explicitly in FR-12, §E.0.1, §E.2.5 and criterion 22a, with the consequence named: replacing ONE inline arm leaves a live timer that the interval-clearing assertion still passes** — a green row over running work. |
| 18 | NIT | *"Data may always restrict"* is false where it is quoted alone | **Addressed** | **§E.1.2's legend gains a blockquote** stating that the clause is true **of an EDITABLE class only**, and that **master cannot lower `master-record` or `loyalty-core` by data either — only by a source edit under an I6 approval.** The qualifying half-sentence is added at **every place the clause is quoted on its own**: §E.1.2's arithmetic paragraph, Part F and Part G. |
| 19 | NIT | R-L4 asks for `refreshScheduler.stop()`; `engage()` never calls it, so the named timers still fire while the label says they are halted | **Addressed — the first of the review's two options, and the label stays true** | **`engage()` now calls `refreshScheduler.stop()`** (measured: it exists at `refreshScheduler.cjs` **220** and is exported) **in addition to the in-dispatch check** — stated in FR-12, §E.0.1, §E.2.5's dispatch table and §E.2.5's teardown paragraph, **with the reason for doing both: `stop()` cannot cover a `runNow` already in flight, and the in-dispatch check cannot stop a timer from waking the process.** **Criterion 22a asserts both**, so `verifyBadgeLabel`'s rule — *the label describes what is true* — keeps holding without weakening the label. |

**Two divergences from the review's suggested mechanism, recorded because both are load-bearing.**
**(1) Finding 2.** The review proposed deriving
`masterDriven = !!(opts?.user && typeof opts.user.tier === 'number' && capability.can(opts.user,
'self-modify.apply'))` and refusing when `!masterDriven && stop.isStopped()`. **That derivation is
adopted — and declared insufficient, with the measurements.** `proposals.apply` already authorised
`opts.user` at `proposals.cjs` 215 before the applier runs, so the predicate is **tautologically true
where it is evaluated**; and `capability.can` reads only `user.tier` (`capability.cjs` 27–33), so a
`{tier: 0}` object is **forgeable by any in-process caller**. The guarantee therefore moves to
**criterion 21c's asserted absence of in-process callers of `proposals.apply`**, with the future L5
entry point named, absent, and specified to consult the STOP at its own entry. *The review's fix closed
the renderer-input hole; it did not close the in-process one, and saying so is cheaper than discovering
it in pass 4.* **(2) Finding 3.** The review offered a one-time migration **or** two-tier state. **Two-tier
state is taken and the migration is REFUSED with its reason written down:** the allow-file is what
`isStopped()` reads, so writing one on first run would start the **new** loop allowed on every upgraded
profile — trading the regression for the one state §E.2.7 exists to prevent.

**And one place the review's wording is tightened rather than copied.** Finding 1 asked for
`effective(c, {ignoreStop: true})` **or** gating `revert-own-apply` exactly as the stop is gated. The
design takes the first **and adds the containment the review did not specify**: `ignoreStop` has
**exactly one consumer**, `requireMasterDriven`, which **throws for any class outside the frozen
`MASTER_ACT` subset** — because an option that any caller may pass is an option every future caller
will pass.

## J.1 — Revision pass 2

**Review:** `docs/research/design-review.json` → `design-review.md`, reviewed 2026-02-14 against the
source in this worktree. **Verdict: `CHANGES_REQUESTED`** — **7 HIGH, 9 MEDIUM, 5 NIT.** Gate checks:
the proposal-record shape, the protected-file avoidance and the computed blast radius **passed**; the
I6/I17 fence and the policy table passed **with findings**; **the STOP and the five-stage loop
failed.**

**Summary: all 7 HIGH and all 9 MEDIUM are ADDRESSED IN PLACE. All 5 NITs are addressed. Nothing is
backlogged.** Two findings were answered with a mechanism different from the one the review proposed,
and one was answered by choosing between options the review deliberately left open — each stated in
its row rather than quietly substituted.

| # | Sev | Finding, in one line | Disposition | Where, and what changed |
|---|---|---|---|---|
| 1 | HIGH | No stage authors the change — the diff has no producer | **Addressed — option (c), with option (b)'s record shape, and the reasoning stated** | The review offered three: ship a questions-only loop, add a model-authoring stage, or restrict changes to declared mechanical edits. **Chosen: a named module with a declared table — `upgradeAuthor.cjs` (§E.4.2a), FR-49, class `author-change` (§E.1.2 row 8, floor L1 / ceiling L3), criteria 89, 90, 91 and a re-scoped 41.** A frozen `EDITS` table of four transforms over bytes read from disk; `changes[].author = 'template:<editId>'` and `baseSha256` in the record (§E.3); `AUTHORING_MODES = ['template']` with `model:*` refused. **Why not (a):** it would leave three classes describing a path nothing can take. **Why not (b) now:** it decides two things master has not been asked, and §I.9 asks them with the two conditions (a locally-classified model, a mandatory con naming it) specified in advance. **`build-repair` is re-scoped in the design's own words to "the repairs this table can express"**, and a non-matching `fixable` files a question — stated as the honest cost, since most findings will not match. `weigh()`'s signature drops the injected `diff` and takes `changes` positionally. |
| 2 | HIGH | The STOP is reachable by a proposal: `rollbackPoint.dir` comes from untrusted persisted `meta` | **Addressed in full, by DERIVATION rather than validation** | **FR-13a** is new and states the general rule; **§E.5.1** carries the derivation with the `/^[0-9a-f]{20}$/` id check; **§E.9** gains rows for `rollbackPoint.dir` (*never read*) and `rollbackPoint.files[].path` (same resolve-then-compare rule, **required to be a subset of `changes[].path`**); **§E.5.1a**'s token now carries the snapshot files by value **and the derived directory**; **§E.10** gains an ownership row saying why derivation beats validation. **Criterion 1 is widened from "a path under the repo root" to any `fs.write*` whose target is neither the derived directory nor a validated change path** — the scoping was what left writes under `userData` unasserted by construction — and **criterion 82a** plants a `dir` of `<userData>/rama/` and asserts the allow-file is byte-identical afterwards. **The lesson is written into the document, because it was available and unused: anything that comes back out of `restore()` is input, and the design had already said so about the verification plan.** |
| 3 | HIGH | Every §E.4.4 refusal is bypassable — the proposer is a caller, not the chokepoint | **Addressed in full, at the applier, since `proposals.cjs` is protected** | **New §E.5.0** specifies six entry validations — dossier/`meta.schema`, `guard.inspectChanges` **re-run**, no self-governing path, §E.9's path rule, `action` vocabulary, and `baseSha256` — **and a refusal THROWS**, so `proposals.apply` records `failed`. **FR-50** states the doctrine (*the proposer's refusals bind the loop; the applier's validation binds the kind*); **§E.4.4 gains a preamble** naming the measured facts (`proposals:create` renderer-reachable at tier 1, `meta` passed through, `shared/autonomy-policy.json` not in `PROTECTED_FILES`); **§E.10** gains two ownership rows. **Criterion 19b is six planted hand-built proposals, one per validation, each approved by a tier-0 fixture and each refused by the applier**, plus a seventh assertion that prints the residual. |
| 4 | HIGH | "Exactly four outbound text paths" is measurably wrong — two are three, and `evolutionEngine` is missing | **Addressed in full, with the counting unit declared** | **Re-measured in this worktree.** FR-33 now asserts **eight gate call sites across six modules covering ten request sites**, with **§E.7.4's table giving file and line for every one**. `evolutionEngine.cjs` is added to **§E.0.1** (three gate calls: `searchNpm` ~218, `searchArxiv` ~252, `searchGitHub` ~167) with the note that it already routes through `lib/http.cjs` so **I9 was intact and only the gate was missing**. `codeRegenEngine` gets **one** call at the top of `researchFix` covering requests 49/69/87, **with the reason it is one and not three in the design**. **Criterion 54a asserts both numbers, prints both, and plants a ninth ungated request.** Propagated to §E.7.4, §E.10, Part B's inventory row, Part F and Part G. **`readRepoFiles` is declared uncovered** (§E.11 residual, §I.8, §H.25) rather than omitted. |
| 5 | HIGH | The shipped levels cannot exist: the policy file ships absent, so `revert-own-apply` ships at L0 and the automatic revert is off | **Addressed in full — the review's second option, keep-it-absent, with one floor raised** | **The "Ships at" column is deleted** and §E.1.2's legend now says two columns, not three, with the reason (*printing a shipped value no install has is how a table lies*). **Floors are set to the intended shipped values: `research-network` L2, `propose-question` L3, and `revert-own-apply` L4.** FR-6 is reworded around *fallback, not minimum*. **§E.2.7 now says ONE file, not two**, and explains the defect it closes. **Criterion 21a is the row that would have caught it** — with no policy file and a valid allow-file, a master-approved apply completes and its revert runs — and **criterion 9a** proves master can still reach L0 by data, which is what keeps §I.1's offer and the *lowering* capability alive (I11: nothing removed). |
| 6 | HIGH | FR-17 and §E.5.1a disagree about whether the STOP blocks master's own apply | **Addressed in full — the review's recommended reading** | **`apply()` consults `isStopped()` only when `opts.autonomous === true`** (§E.5.1a), the one field §E.3 says an autonomous apply would set; the `policy.require('revert-own-apply')` check stays unconditional. **FR-17 gains `proposals.approve`/`proposals.apply` to its not-stopped list with the reasoning**, as do §E.2.5 and Parts F and G. **Criterion 21 becomes four assertions** — the fourth being that **a master-driven apply entered while stopped COMPLETES** — because the shipped install is permanently stopped and the earlier wording would have made the headline guarantee dormant on every install. |
| 7 | HIGH | FR-12's halt misses state-changing timers, and §D.8 overstates R-L4 | **Addressed in full — the halt is extended rather than the claim narrowed** | **FR-12 is rewritten around FOUR measured dispatch points:** `refreshScheduler.runNow`, `metaCognition`, **`selfCare` (`startSweep`/`stopSweep` + an `isStopped()` check inside `runHealthSweep`, because it auto-arms a 120 s sweep at `register()` that calls `checkInstanceFailover`)** and **`marketIntel` (`stopScheduler()` plus a check inside each tick)**. **Plus R-L4's teardown half:** `engage()` calls new `agentOrchestrator.killAllRunning()` and `sandboxEngine.killAllExecs()` over paths those modules already use internally. **One declared exemption, printed with its reason** — the agent governor, because it only reaps and halting a reaper leaves hung agents unassimilated. Four modules added to **§E.0.1**; **§E.2.5** rewritten with the dispatch table; **§D.8 row 1.4 corrected** to name what is and is not implemented. **Criteria 22a (eight assertions), 22b (the exempt set is non-empty, reasoned, and a timer in neither list FAILS the row) and 22c (teardown)**; §H.23 records that no timer has been observed stopping. **§I.10 asks master to confirm the `marketIntel` halt**, since the cost lands on a surface he uses daily. |
| 8 | MED | FR-6 contradicts its own table — `apply-source` has floor L4 | **Addressed in full** | **FR-6 reworded as the review proposed:** no floor exceeds L4, none is ever L5, the two L4 floors describe master's act, and **no class Rāma INITIATES has a floor above L3**. **A frozen `RAMA_INITIATED` subset is declared in §E.1.3** and **criterion 12 asserts the bound over it** (six assertions), so the sentence is mechanical rather than prose a coder would have had to contradict. |
| 9 | MED | Criteria 6–9 cannot pass: with no allow-file the resolver returns L0, not the floor | **Addressed in full** | **Criteria 6–9 are prefixed with the allow-file fixture** and a **blockquote above them states why**; **criterion 6a is new** — no allow-file and no policy file ⇒ L0 for all 15 and `stopped: true` — which makes the precedence between the two gates testable instead of implied. **§E.1.3's resolver gains a note** that its first line dominates and that the floors describe the state *after* master has allowed autonomy. |
| 10 | MED | `destinationOf` reads `info.baseUrl`; the measured field is `info.customProviderId` | **Addressed in full** | **§E.7.4's listing now reads `info.customProviderId`**, parsed with `new URL()` **inside a `try`**, with an unparsable value resolving to `cloud` and `why: 'base URL unparsable'`. Corrected in §E.0.1's row and in Parts F and G. **Criterion 54 assertion 12 is three rows** (loopback passes, public refuses, unparsable is cloud). **The row records why the safe-direction failure still mattered: it made the suite's loopback-versus-`192.168` contrast unachievable, so a green row would have proved nothing about the predicate.** |
| 11 | MED | `isLoopbackHost`'s declared set is narrower than the host forms that reach it, and contradicts `type:'cloud'` | **Addressed in full** | **The set is declared as `/^127\./`, `/^0\.0\.0\.0$/`, `/^localhost$/i`, `/^\[?::1\]?$/` over `new URL(...).hostname`, bracketed IPv6 included** (§E.7.4, §E.0.1, Parts F and G), with the note that `URL.hostname` returns IPv6 literals bracketed so `[::1]` and `0.0.0.0` would otherwise have read as cloud — **wrong rather than strict.** **And one sentence added as the review asked:** `info.type` is a declaration from `toRegistryEntries` and **is not consulted**; `destinationOf` is the only authority, and the disagreement is cosmetic. **Criterion 54 assertion 13 is one row per pattern.** |
| 12 | MED | The re-derived plan cannot include `suiteCoverage`'s suites, and the design says it does | **Addressed in full — option (c), recompute** | **§E.5.2's plan table row now reads "a RECOMPUTED `suiteCoverage`"**, with a paragraph explaining that the persisted value lives in exactly the untrusted input the re-derivation exists to avoid, and that the alternative was silently dropping change-specific suites — *verifying a change without the suite written for it.* **§E.4.3's blast-radius row marks the persisted value display-only.** **Criterion 82b is three assertions**: a persisted `verifyEvil.cjs` is ignored, the recomputed list runs, `planDrift` is `true`. |
| 13 | MED | `upgradeResearch` is itself an outbound text path and is absent from the gate's count | **Addressed in full, and the classification question is answered rather than noted** | **`upgradeResearch.gather` is site 8 in §E.7.4's table and in the asserted count.** **FR-51 decides the classification**, as the review recommended: a query may carry the finding's `what` and a sensor's **field name**; it may **not** carry `measurement.value`, file contents, or any stderr/stdout excerpt — *because a stderr excerpt carries master's paths and a module's internals, and "search the web for Rāma's own error text" is a decision master has not been asked to make.* **§E.4.2 carries the gate call with the code and the rule**, `research.queryParts` records what left the machine (§E.3), and **criterion 93 asserts the excluded fields never appear in the query string and that the gate call precedes the first `fetchText`.** |
| 14 | MED | `gateOutbound`'s input shape is undefined and its behaviour on an unclassified payload is unstated | **Addressed in full** | **FR-33b declares the signature and the default**; **§E.7.4 carries the annotated contract**, **§E.9 gains the row**, and **the fail-open default is stated as a DECISION with its reason** — the gate exists to stop classified rows leaving, and a fail-closed default would refuse every chat in the product on day one. **`destination` has no default and an absent one throws.** **And the missing link is written down:** `assembleContext` returns the block with the strictest classification in it, and **the caller inserts it as a part carrying that tag**, which is what makes criterion 77's joined case reachable. **Criterion 92 is six assertions.** |
| 15 | MED | "The lesser of 20 entries or 30 days" is not a comparison — the eviction rule is ambiguous | **Addressed in full** | **FR-52 states the rule as an `OR`** — over 30 days, **or** not among the 20 most recent non-`fatal` directories, `fatal` never evicted and not counted, eviction after every apply, count reported — and **§E.5.1's retention table plus a blockquote carry it**, with the note that a count and a duration have no ordering. **Criterion 81 now has four fixtures** including a 31-day-old entry and a `fatal` survivor, because the single count fixture would have passed under either reading. Propagated to Parts F and G. |
| 16 | MED | The policy file classifies as `renderer`, and the path master takes to raise a class is never stated end to end | **Addressed in full** | **§E.1.4 gains a numbered three-step sequence**: hand-edit (it is **not** a proposal — refusal 5), `reload()` or restart, then the tier-0 attest call. **And it says out loud that NO BUILD IS REQUIRED and why `classifyChange` would suggest otherwise** — `shared/` returns `'renderer'`, but the file is read by the main process and is not bundled, and `vite build` is the one step this workspace cannot run. **Criterion 94 is four assertions** including the no-build/no-restart path and that a proposal naming the file is still refused. Mirrored into Part F. |
| 17 | NIT | Part G's class arithmetic disagrees with §E.1.2 in a block pasted into the spec verbatim | **Addressed, and made un-driftable** | Both blocks now state **the same arithmetic — 6 permanent / 5 lower-only / 4 raise-path = 15** — and **criterion 95 asserts all four numbers**, so the suite owns the count and the prose quotes it. *The review's fix was "Part G reads 8"; the stronger fix is that no prose block is the authority for a number two prose blocks contain.* |
| 18 | NIT | Criterion 9 promises five assertions and names four cases | **Addressed** | **Criterion 9 names the fifth** — a missing `version`, or a `version` that is not `1` — and notes that `validate()` has nine rejection conditions of which these five are planted. |
| 19 | NIT | FR-19 calls `dependencyAdvisor.review()` with no argument | **Addressed — with a correction to the review's own fix** | **FR-19 now reads `review(rows).actionable`** and names where `rows` comes from. **The review suggested `dependencyAdvisor.parse` over `package.json`; measured, `parse(version)` parses a VERSION STRING** (`dependencyAdvisor.cjs` 33) — the real producer is **`registrySources.collect({pinned, getJson, postJson})`**, exactly as `main.cjs`'s `runDependencyReview` (line 579) builds it from `dependencies` + `devDependencies`. §E.4.1's sensor row says so and adds that the sensor **needs `research-network` at L2**, since `collect` reaches the registry. |
| 20 | NIT | Criterion 16's "only fs/path/os" reads as a contradiction with §E.2.7's `app.getPath` | **Addressed** | **Criterion 16 reworded as the review proposed:** synchronous, `fs`/`path`/`os` **at module scope**, Electron reached only through a guarded lazy require inside `allowPath()`, and a test with `electron` unresolvable **and an injected root** still gets an answer. |
| 21 | NIT | `summarise()` omits `result`, which strengthens §E.5.2a but is not where criterion 45a points | **Addressed** | **§E.5.2a gains the clause with the measured field list** — `summarise()` does not carry `p.result` at all, so the list view has **no other field it could read** — and **criterion 45a names the channels it scans**: `proposals:list` via `summarise`, `proposals:get` via the full proposal. |

**Two divergences from the review's suggested mechanism, and one choice among options it left open** —
recorded because a divergence adopted silently is how a review becomes theatre. **(1)** Finding 19's
`dependencyAdvisor.parse` over `package.json`: `parse()` parses a version string, so the design names
`registrySources.collect` instead. **(2)** Finding 2's fix validated the persisted directory; the design
**derives** it and treats the persisted value as display-only, because an invariant enforced by not
reading a value is stronger than one enforced by checking it. **(3)** Finding 1 offered three options
and the design takes **(c) with (b)'s record shape** — a declared mechanical edit table inside a named
module, with the model-authoring field, constant and conditions specified but refused — so the later
unlock needs no schema change and no new concept.

## J.2 — Revision pass 1

*The first review of this design, kept unedited. **Verdict was `CHANGES_REQUESTED` — 7 HIGH, 14 MEDIUM,
5 NIT.** Several rows below are superseded by §J.1 above, and where they are, §J.1 says so: pass 1's
row 2 counted four outbound sites (§J.1 row 4 re-measured it), row 7 named two dispatch points (§J.1
row 7 found four), row 13's eviction phrase was ambiguous (§J.1 row 15), and row 4's "ships at" column
described a file that ships absent (§J.1 row 5). **Both tables are kept because the pattern across them
is the most useful thing in this document: every finding in both passes came from reading the source,
and the second pass found more than the first.***

**Summary: all 7 HIGH and all 14 MEDIUM are ADDRESSED IN PLACE. All 5 NITs are addressed. Nothing is
backlogged. Three findings were addressed with a mechanism DIFFERENT from the one the review proposed,
because the source disagreed with the proposal — each divergence is stated in the row rather than
quietly substituted.**

| # | Sev | Finding, in one line | Disposition | Where, and what changed |
|---|---|---|---|---|
| 1 | HIGH | `destinationOf` treated provider `ollama` as local, but Ollama serves cloud models through `localhost:11434` | **Addressed — mechanism differs from the proposal** | §E.7.4 rewritten with the literal `destinationOf`. **The review proposed `classify(id, {tags, catalogEntry})`; the measured signature is `classify(tag, catalogEntry)` and `modelInfo(id)` ALREADY CARRIES the classified result** (`{cloud, type, cloudEvidence, cloudWhy, private}`) because `describeInstalled` ran `classify` per tag. So the gate **consults the existing measurement** rather than re-running classification at the boundary — strictly better, since a second classification is a second opinion. `cloud: null` ⇒ cloud; **plus a case the review did not name: a seed-only `MODEL_REGISTRY` `ollama/*` entry is `type:'local'` BY DECLARATION with no measurement, and also resolves to cloud.** §130.9 cited. Criterion 54 assertions **8, 9, 10, 11**; inventory rows for `modelRouter` and `ollamaCatalog` added. |
| 2 | HIGH | `chatCompletion` is not the only outbound path carrying text — four measured sites bypass it | **Addressed in full** | FR-33 narrowed to **model egress**; §E.7.4 carries the four-site table with line numbers; each site calls `gateOutbound` and **the call-site count is asserted at four and printed** (criterion 54a); **criterion 54b asserts `dataStore.get('context')` appears in exactly one file**, which is what makes the coverage question tractable. The four files are in §E.0.1 with their reason. **The residual — gated by a call, not a chokepoint — is printed, and §I.8 raises both the chokepoint alternative and the fact that `voiceEngine` sends AUDIO the text gate cannot inspect.** |
| 3 | HIGH | Shipped behaviour self-contradictory: fail-safe STOP means nothing runs, yet criterion 40 asserted a running default | **Addressed in full** | **New §E.2.7** states it outright with the literal path and JSON, how `<userData>` resolves, and why `lift()` cannot start it (the capability is absent, `can()` returns false for everyone). §E.1.5 gains a read-this-first note and drops the phrase "shipped default". **Criteria 40 and 41 now run with a valid allow-file fixture; new criterion 40a asserts a tick with no allow-file reads no sensor and files nothing.** The Autonomy panel states the stopped state in full (§E.12). |
| 4 | HIGH | FR-6's "defaults to the lower of propose-only and its ceiling" contradicted the shipped table | **Addressed in full** | **FR-6 reworded: "every class defaults to its declared FLOOR, and no floor exceeds `L3 propose-only`."** §E.1.2 gains a **floor / shipped / ceiling legend** naming the three as distinct values, and the Autonomy panel renders four columns. **§I.4 is kept but narrowed to a question about the shipped DATA VALUE only**, which is what it always should have asked. |
| 5 | HIGH | `shared/autonomy-policy.json` was not on the refusal list, so Rāma could propose its own promotion | **Addressed in full** | **A 14th PERMANENT class, `autonomy-policy`, at L0/L0**, covering the data file, both modules and the tripwire manifest. **One frozen `SELF_GOVERNING_PATHS` constant, declared in `autonomyPolicy.cjs`** (not in the proposer — a list living with its consumer could be narrowed by a change to the consumer), from which the proposer's refusal list is derived. Refusal 5 rewritten: **outright, not downgraded to a question**, with the reason. FR-7, FR-14, §E.1.2, §E.1.3, §E.4.3's new `selfGoverningTouched` row, §E.10. **Criterion 19a is planted and goes RED when a path is removed**; criterion 87 asserts the members exist. |
| 6 | HIGH | A reverted apply would be recorded `applied`; the throw-or-resolve contract was never stated | **Addressed in full** | **New §E.5.2a: the applier ALWAYS RESOLVES with `{verified, reverted, revertAttested, causeId, cause, remedy}` and mirrors the verdict into `meta.verification.result` BEFORE resolving** — which survives `forStorage`/`restore` because only `changes[].content` is dropped. A throw is reserved for failures outside the plan (§E.8 row 21a). **Criterion 45a forbids any renderer branch reading `status === 'applied'` alone**, and the status-vocabulary limit is a **printed residual** (§H.20) rather than an edit to a protected file. |
| 7 | HIGH | FR-12's halt of existing timed work was unimplementable; two needed modules were missing from the file table | **Addressed in full** | **FR-12 rewritten to name the two dispatch points.** `refreshScheduler.cjs` (stop check **inside `runNow` before `await task.run()`**, plus a `stopExempt` flag nothing sets) and `metaCognition.cjs` (**`startAudit`/`stopAudit` exported**, because `register()` arms the interval and `stop()` has no re-arm) are both in §E.0.1 with their line estimate and reason. **Criterion 22a asserts every timer the stopped label names is actually halted**, with counting fakes, and prints the exempt list. §H.17 states it has not been run. |
| 8 | MED | `diagnoseFailure` has no `causeId`; the vocabulary is new, not inherited; §B.4's nine vs §E.5.3's six | **Addressed — and the reconciliation differs from the review's framing** | **New §E.5.3a** with a literal branch→id table over the **eight** measured branches. **Decision recorded: `breakageAnalysis` owns the mapping and `aiProcess.cjs`/`verifyEngineDiagnosis.cjs` are NOT modified** (the review's preferred option), with three reasons. **The reconciliation is eight branches over seven ids, not nine over six**: §B.4's nine are *descriptions*, and `no process running`/`never-spawned` and `running-but-silent`/`alive-but-silent` are each one branch twice. **Branches 5 and 8 both map to `unrecognised-exit`**, with the exit code reported absent rather than zero. §E.4.1's sensor row and the Part F prose both corrected. |
| 9 | MED | `protectedTouched` as a set intersection under-reports against `loyaltyGuard`'s own matcher | **Addressed in full** | `weigh()` now calls **`guard.inspectChanges(changes)` and uses `refused[]`**; the injected argument changed from `protectedFiles` to the `guard` module (§E.4.3 signature). **Criterion 4a covers `'./electron/lib/proposals.cjs'` and an absolute path.** §E.10's I6 pre-emption row states that this is what makes the "unreachable `LoyaltyViolation`" claim hold — same predicate by construction. |
| 10 | MED | Criterion 4 could not detect a restated list, since `protectedFiles` was injected | **Addressed in full** | Injection kept **and** **criterion 4b added**: a source-shape scan over every new `.cjs` **and the `main.cjs` wiring site** for any protected-path literal, requiring zero hits outside one `require('./loyaltyGuard.cjs')` read, with the count printed. §E.4.3 states the list is **read at call time, never captured at module load**. |
| 11 | MED | Reverting a created file was undefined; FR-1 permitted only restoring bytes; `action:'delete'` unaddressed | **Addressed in full** | Snapshot shape is now **`{path, existed, sha256\|null, bytes\|null}`**; **FR-1 reworded to "its exact prior bytes, or its ABSENCE"**; a `create` whose path exists is **refused**; **`action:'delete'` is refused outright** with the reason. §E.5.1 and the Part F prose both carry it. **Criterion 45 gains a created-file fixture asserting the file is absent after revert**, plus fixtures for the two refusals. |
| 12 | MED | The in-flight revert carve-out had no mechanism — `effective()` cannot know a revert is in flight | **Addressed in full** | **Parenthetical removed from `effective()`**, with a note saying why it could not have worked. **New §E.5.1a: a token issued at `apply()` entry** after one `policy.require` and one `isStopped()` check, before any write; **`revert(token)` consults neither; a tokenless revert is refused** (§E.8 row 22a). **Criterion 21 is now three assertions.** Part F's "one deliberate exception" paragraph rewritten. |
| 13 | MED | Snapshot retention unspecified — whole-file copies accumulate unbounded | **Addressed in full** | §E.5.1 gains a retention table: **deleted on a verified apply**, kept for failed/reverted, **`fatal` never evicted**, eviction at **the lesser of 20 entries or 30 days with the count reported**, and **count + total bytes in `statusText()` and the Autonomy panel**. **Criterion 81** covers the verified-apply cleanup and the eviction count. §H.19 records that the figures are a budget, not a measurement. |
| 14 | MED | `admit()` claimed for every stage, required for one — the heaviest stages unadmitted | **Addressed in full** | **New §E.4.0 with a declared `ADMISSION` table**: `upgrade-notice-suites` 128 MB, `upgrade-research` 64, `upgrade-weigh` 64, `upgrade-verify` 512 (1024 with a build), all `PRIORITY.BACKGROUND`, **and an explicit `ADMISSION_EXEMPT` list for the pure in-process reads so the exemption is a decision rather than a gap**. NFR-5 and FR-23a reworded. **Criterion 31 is now four admissions plus the exemption row, each echoing the orchestrator's reason verbatim.** |
| 15 | MED | The persisted verification plan was executed after `restore()` without validation | **Addressed in full** | **§E.5.2 retitled: the plan is DISPLAYED from Stage 4 and RE-DERIVED at Stage 5**, with the reason (`restore()` rehydrates `meta` on an id check alone). **§E.9 gains two rows** constraining `step` to a fixed set and `target` to `/^verify[A-Za-z0-9]+\.(cjs\|mjs)$/` under `scripts/` or one of the proposal's own change paths, and specifying **`execFile` with `shell: false`**. **Criterion 82 uses a poisoned persisted plan; criterion 83 is the source-shape row.** `planDrift` is reported to master rather than silently resolved. |
| 16 | MED | Criterion 13 was not mechanically checkable | **Addressed in full** | **Criterion 13 rewritten around a frozen `GATED` list** `[{module, fn, classId}]`: every `classId` in `CLASSES`, the named function's body containing the literal `policy.require('<classId>'`, `GATED.length === CHOKEPOINTS.length`, the count printed, **and a planted deleted `require` proving RED**. Criterion 86 stops `GATED`/`ADMISSION` drifting from the stages. |
| 17 | MED | The falsifiable criterion had no declared window and no measured input | **Addressed in full** | **`CRITERION = Object.freeze({windowDays: 90, minModelCallsSaved: 1, minReflexes: 1})`**, the default argument; FR-37 and §E.7.5 both rewritten, with the 90 days **argued** rather than picked. **`metaCognition.recordOutcome`'s `{action, tool, role}` is named as the measurement source**, and with no source the verdict is **`{verdict:'too-early', why:'no measurement source yet'}`** rather than an unmeasured number. **Criterion 60 is five assertions** (constant-exists, too-early, boundary-zero, boundary-one, no-source). §H.18 records the window as a choice. |
| 18 | MED | The `vectorMemory` fix was under-specified; its effect on existing data unstated | **Addressed in full** | §E.7.3 now carries a **five-point fix**: `embed()` returns `{vector, source, dims}`; **`embed`/`tfidfVector`/`cosineSim` are exported** (today none of the three is, which is why the original two assertions could not have run); the five existing exports keep their signatures (I11); **ownership declared — `contextStore` owns the context index and uses `vectorMemory.embed` as a pure embedder**; new wrong-length inserts refused; **and vectors already stored are NOT repaired by that refusal, so a mixed index is marked `stale` and `getHealth()` reports a `mixedDims` count.** **Criterion 74 is five assertions including a mixed-legacy fixture.** |
| 19 | MED | Raising a class left no ledger record, which R-G2's gate requires | **Addressed in full** | §E.1.4 gains **`fileSha256` on `load()`** and **`{ledgerAttested, attestedBy, attestedAt}` on `policyStatus()`**; an unattested digest **warns once** and the panel reads *"policy file changed <when> — no ledger record"*; **master records an advancement with one tier-0 call writing a question-kind ledger entry carrying the digest**; Rāma cannot attest its own policy file. **The effective levels still apply unattested — what is withheld is the CLAIM that it was recorded**, which is the honest thing to withhold. **Criterion 84 is three assertions.** |
| 20 | MED | `customProviders`' host classification is unexported, and private-range is the wrong question for egress | **Addressed in full** | **A separate exported `isLoopbackHost`** (`127.0.0.0/8`, `::1`, `localhost`) that `destinationOf` consults, **leaving `isPrivateHost` and `PRIVATE_HOST_PATTERNS` untouched with their SSRF meaning** — two predicates, two questions, neither borrowed for the other. `customProviders.cjs` added to §E.0.1 and to the Part B inventory. **Criterion 54 assertion 11: a custom provider on `https://192.168.1.50:8000` is cloud and refuses a local-only payload.** |
| 21 | MED | The roadmap gate this work sits behind was never addressed | **Addressed in full** | **New §D.8** names the two implemented rows (**1.4 R-L4**, Phase 1, in order; **4.1 R-G2**, Phase 4, gated), lists the open phase-2/3 rows by number, and **argues the exemption narrowly: 4.1 declares the ladder and climbs no rung, so it is strictly subtractive.** **4.2 (R-A1/R-A2) stays out of scope and blocked.** **§I.7 asks master to confirm the exemption**, and the ledger row's RAISED list gains it as item (7). |
| 22 | NIT | `causeId` count disagreed with the table (twelve vs thirteen) | **Addressed** | §E.5.3 says **thirteen ids** and states `unrecognised-exit`'s membership; **criterion 48 is fourteen assertions — thirteen reachability plus one forbidden-string absence.** |
| 23 | NIT | The stage entry points' sync/async contract was unstated | **Addressed** | §E.4 and §E.11 both declare **`collect`/`gather`/`weigh`/`file`/`apply` async** and name the synchronous pure cores — **`toProposalDef`, `analyse`, `fingerprint`, `effective`, `isStopped`, `destinationOf`, `gateOutbound`, `validate`, `evaluateCriterion`** — with `isStopped`'s and `gateOutbound`'s synchronicity called out as load-bearing. |
| 24 | NIT | `analyzeImpact` returns absolute paths while `blastRadius.files` is repo-relative | **Addressed** | §E.4.3's `dependents` row states the **normalisation to repo-relative POSIX** and why (a machine path must not reach a persisted dossier); **criterion 33 asserts it** — no `\`, no drive letter, no leading `/`. |
| 25 | NIT | Part F/G paste instructions and §D.6 A5's numbering were stale | **Addressed** | **Part F: insert Section 128 in NUMERIC POSITION, after 127 and before 130**, with the reason. **Part G: row 148 confirmed free with 150 taken**, and a note that 148/149 free while 150 is used is not an error to tidy. **§D.6 A5 rewritten with the measured line numbers and records that Section 130 was read** — including §130.11 pointing at Section 128 for this decision. |
| 26 | NIT | The two new kinds existed only as literals with no UI filter contract | **Addressed** | **`upgradeProposer.KIND` is a frozen export** `{DIFF, QUESTION}`; `Evolution.jsx` and every `list({kind})` filter import it; **`stats().byKind` reports both without a `KINDS` entry**, and the reason `KINDS` is not edited is stated (protected file). **Criterion 85** asserts the export, the absence of the literals in the renderer, and `byKind`'s behaviour. |

**Three places where the design diverges from the review's suggested fix, each because the source
disagreed with it** — recorded here because a divergence adopted silently is how a review becomes
theatre: **(1)** finding 1's `classify(id, {tags, catalogEntry})` → the real signature is
`classify(tag, catalogEntry)` and `modelInfo` already carries the result, so the gate reads the
measurement instead of re-classifying. **(2)** finding 8's nine-causes-versus-thirteen → the measured
shape is **eight branches over seven ids**, with two branches sharing `unrecognised-exit`. **(3)**
finding 7's *"or state plainly that resuming the audit needs a restart"* → `metaCognition` gains
`startAudit`/`stopAudit` so a lift **can** resume it, and the label-says-so fallback is kept as the
honest degradation if the re-arm proves unreliable (§H.17).

---

# DEFERRED BY THE ORCHESTRATOR

*Appended after three design-review rounds. **The rest of this document is unchanged and stands as the
record** — nothing above was edited, including the parts that describe work this slice did not build.
Read that as the design and this section as what of it is NOT on disk.*

**What WAS built, and where it is written up:** the STOP (`electron/lib/autonomyStop.cjs`), the policy
table (`electron/lib/autonomyPolicy.cjs`), the create gate (`electron/lib/autonomyGate.cjs`) and the
applier's entry validation (`electron/lib/upgradeApplier.cjs`), with two suites —
`scripts/verifyAutonomyStop.cjs` and `scripts/verifyUpgradeApplier.cjs`. The build note, every design
claim measured FALSE against source, and the NOT VERIFIED list are in
**`docs/research/self-upgrade-build.md`**.

**Finding ids below refer to `docs/research/design-review.json` as it stands in this worktree** (3 HIGH,
7 MEDIUM, 5 NIT), and to §J.0's row numbers where a row is named. A deferred part is not a backlog
entry: it is a part whose blockers are unresolved, and the blocker is named so the next session fixes
the cause rather than re-litigating the shape.

| Deferred | Why it is not built | Must be resolved first |
|---|---|---|
| **`upgradeAuthor.cjs`, and anything that produces the bytes of a diff** | Nothing in this slice authors a change body. The `author-change` class exists in the table at floor L1, so the level that would permit authoring is declared and unreachable without a data edit. | **Finding 2** — the one reachable adapter reads `row.target`, which does not exist on a `dependencyAdvisor` row (`{name, pinned, latest, jump, …}`), so the single edit the loop could author writes `"undefined"` or throws. The adapter must read `.latest` and return `null` for `jump === 'current' \| 'downgrade'`. |
| **The `EDITS` table** | No transform exists, so no `editId` is reachable. | **§J.0 row 4** measured that none of `selfModel`'s seven `fixable` prose strings can match any entry, which leaves `propose-source`, `build-repair` and `dependency-change` with no reachable path. The table needs a **declared grammar** — a frozen per-sensor adapter table, never a prose match — before it is worth writing. **Finding 4** additionally requires `pin-version` to answer for `package-lock.json`, which it cannot today. |
| **The five-stage loop — NOTICE / RESEARCH / WEIGH / PROPOSE / ANALYSE** | The five stage functions are absent, and `autonomyStop.DEFERRED_CHOKEPOINTS` names them so the chokepoint count cannot claim coverage this build does not have. `verifyAutonomyStop.cjs` asserts each file is absent. | **Finding 5** — the NOTICE suite sensor is unspecified in four ways and parses the failing row name out of free-form stdout, which the design forbids elsewhere. **Finding 2** blocks the only adapter. Nothing calls `autonomyGate.fileProposal` until this exists; the gate was built first on purpose. |
| **The breakage-analysis vocabulary, and the verification plan** | `upgradeApplier.applyWith` returns `verification: 'not-run'`, a declared value asserted never to render as a pass. No `causeId`, no corrected proposal, no plan re-derivation. | **Finding 10** — FR-28's third clause is unimplemented and a post-revert failure has no defined outcome, so a cause would be attributed to a change that did not cause it. **Finding 13** — the plan's spawned steps write under the repo root, which FR-1 forbids until the exception is declared and bounded. |
| **The context DB and the memory vessel (Addendum B, §E.7)** | Not started. No `context` domain, no record schema, no index, no purge, no sensitivity gate. | **Finding 8** — criterion 75's *"no context bytes anywhere"* is RED on a correct implementation, because `markAllDirty` + `saveAll` guarantee a domain file; the natural way to make it green is to drop `'context'` from `DOMAINS`, which loses the I14 re-key coverage §E.7.1 calls its deciding finding. **Finding 9** — `gateOutbound` must move to a dependency-free module. **§I.7** asks master whether a record-nothing vessel is acceptable ahead of Phase 3 at all. |
| **The teardown of the four pre-existing dispatchers, and the resume path** | `engage()` records the halt and tears down NOTHING. `PRE_EXISTING[].haltedByEngage` is `false` on every entry, with the reason in the data, and `statusText()` says so in words. | **Finding 3** — `lift()` is the only resume, and it cannot succeed until master adds `system.suspend-autonomy`, so wiring the teardown now would leave master's shipped timers dead until a restart. The capability comes first; then `engage()` gains `refreshScheduler.stop()`, `metaCognition.stopAudit()`, `selfCare.stopSweep()` (BOTH arming sites, 345 and 396) and `marketIntel.stopScheduler()`, and `lift()` re-arms them in the mirrored order. |
| **Confining `timeline.cjs`'s SELF_MODIFY applier** | It writes `changes[].path` verbatim: no resolve-then-compare, no `lstat`, and `fs.rmSync` for a delete. The renderer route is closed by `autonomyGate`; the in-process route is not. | **Finding 1** — and this is **master's decision, not an implementation detail**: confining it changes a shipped applier's behaviour, and refusing `action: 'delete'` removes a capability `src/services/selfModify.js` can reach today, which I11 forbids. `verifyUpgradeApplier.cjs` prints the residual on every run. |
| **The renderer surfaces — the Autonomy panel and the Evolution additions** | No `.jsx` was touched. `policyStatus()` and `statusText()` exist and are callable; nothing renders them. | **Finding 9** — a `PAGES` entry without a `LOADERS` entry is half a page and `registryIssues()` reports it, so the design's *"two new PAGES entries"* would produce two registry issues. The panel belongs inside `Settings.jsx`, gated on `autonomy.view`, which master has not added to the matrix. |
| **The policy file's ledger attestation** | `policyStatus()` reports `fileSha256` and `source`; it does not report `ledgerAttested`, and there is no tier-0 attest channel. | The attest channel files a **question-kind** entry, which means it depends on the kinds this design owns being filable — and `fileProposal` has no caller until the loop exists. Master editing the file still takes effect; what is withheld is the claim that it was recorded, which is the honest thing to withhold. |
