# Rāma — model evaluation against the published AGI/ASI literature

**Document status:** evaluation only. No code was changed to produce it.
**Worktree:** `.worktrees/model-eval`, branch `model/agi-evaluation`, base commit `8c1c9ee`.
**Date of measurement:** this session. Every number below marked *measured* was produced by
running the command named beside it in this worktree, not recalled from the ledger.
**`RAMA_AGI_MASTER_SPEC.md` was read, never edited.** Section 28's ledger and locked
invariants I1–I17 are quoted, not revised. Where an invariant's wording and the code's
behaviour diverge, it is **raised**, never changed (§9).

---

## 0. Method, and the one rule this document is held to

Master asked two questions in message 12: *"Do thorough evaluation Rāma's modal we have
implemented does it work under category of ASI/AGI; dig deeper and come to proper realworld
necessarry conclusions/requirements and start upgrading it."*

The honest answer to the first requires refusing to answer it the flattering way. This project
has a character, and it is legible in the ledger: it **refused an 80%-win-rate target with
arithmetic** (Section 113), it **removed a fabricated source that had scored 0.60 and passed
vetting** (Section 114/ledger row 114), it **reported costs that made its own earlier defaults
look wrong** (Section 115), and its ledger **names its own regressions** — row 127 opens with
"MY REGRESSION", row 142 lists "TWO DEFECTS IN MY OWN NEW MODULE". A document telling master
that this app is AGI would betray every one of those.

So the rule here is the project's own rule: **a claim carries a file and a behaviour, or it is
not made.** Adjectives are not evidence. Where something could not be checked at runtime it
is in §8 (NOT VERIFIED), not softened in the body.

### What was measured in this worktree

| Measurement | Command | Result |
|---|---|---|
| JS behavioural suites | each `scripts/verify*.cjs` / `.mjs` in `npm run verify`, run individually | **22 suites, 1,970 assertions, 0 failures** |
| Claim gate | `node scripts/verifyClaimGate.cjs` | 98 passed, 0 failed |
| Role routing | `node scripts/verifyModelRoles.cjs` | 87 passed, 0 failed |
| Self-model | `node scripts/verifySelfModel.cjs` | 93 passed, 0 failed |
| Bridge/IPC audit | `node scripts/auditRenderer.cjs` | **139 bridge calls, 76 files, 365 IPC channels**, all resolve |
| Renderer build | `npm run build` | **NOT RUN — `node_modules` is absent in this worktree** (`Test-Path node_modules` → False; `node start.cjs --diagnose` reports express/electron/vite/react/argon2/node-pty/systeminformation/simple-git/playwright/vectra all missing) |
| Python engine suites | `pytest ai_backend` | **NOT RUN** — Python 3.14.4 is present, `import numpy, pandas` raises. The engine's 801 assertions are the ledger's figure, not re-verified here |
| Capability matrix | `shared/capabilities.json` | **6 tiers, 77 gated capabilities** |
| Lockfile | `package-lock.json` (lockfileVersion 3) | **750 entries, 750 with `resolved` registry URLs, 750 with `integrity`**; **0 vendored `.tgz`** anywhere in the tree |
| Pinned-vs-current drift | `node start.cjs --diagnose` | **15 pinned packages have newer releases** (reported, not applied — correct per I12) |

---

## 1. PHASE 1 — Capability inventory: what Rāma actually does

For each subsystem: what it can **perceive**, **remember across sessions**, **decide**, **act**
on, **learn from its own outcomes**, and **modify about itself** — and what gates each.

### 1.1 Cognition and epistemics

#### `electron/lib/claimGate.cjs` (412 lines) — the output boundary

**What it does.** Segments a model answer into claims and classifies each as `grounded`,
`reflex`, `prose` or `unattributed`, and **withholds the unattributed class**. Attribution is
decided mechanically: the cited id must exist in the evidence actually supplied, and every
*checkable token* in the claim — canonicalised numerals, ISO dates, capitalised/all-caps named
entities — must appear in that source's text. Five refusal reasons are distinguished and
counted by reason, not listed: `no-citation`, `fabricated-citation`, `rejected-source`,
`unsupported-figure`, `unsourceable-prediction`.

- **Perceive:** only what the caller hands it — `{text|claims, sources, reflexes}`. No network, no filesystem (`verifyClaimGate` asserts `!/writeFile|dataStore|localStorage/`).
- **Remember:** nothing. `attest()` returns a record for the *caller* to keep, and deliberately omits the withheld sentence so the confabulation is not stored next to the account of refusing it.
- **Decide:** attribution class, per claim. Never authorisation — asserted: `!/capability|\.can\(|tier/i`.
- **Act:** suppresses text. That is its whole action surface.
- **Learn:** nothing. It has no memory, therefore no learning.
- **Modify about itself:** nothing.
- **Gate:** none needed; it is a pure function. It is wired at `modelRouter.cjs:303` on every chat completion, with a `catch` that **reports a broken gate rather than letting it read as a clean pass**.

**Three design decisions worth defending.** (1) **A class, not a score** — the header names the
alternative it rejects and `verifyClaimGate` mechanically asserts the module computes no
`confidence|probability|likelihood`. (2) **Predictive modality is uncheckable by a document** —
`MODAL_RE` catches `will|guaranteed|never|best|…`, and a modal claim cited to a news article is
refused with `unsourceable-prediction`, because a retrieved document cannot ground a statement
about the future; only a `reflex` projection record can. (3) **It errs toward withholding, and
says where it does not** — the header admits the hole: *"twelve percent"* in words escapes the
numeral check and passes as prose.

**Honest limit.** It checks **attribution, not entailment**. A claim whose every digit appears
somewhere in a cited document passes even if the document says the opposite. The header states
this. It is the correct scope for a module that must not itself need a model.

#### `electron/lib/modelRoles.cjs` (354 lines) — requirement-not-preference routing

Nine roles — `extraction`, `tool-calling`, `code`, `reasoning`, `long-context`, `multilingual`,
`embedding`, `vision`, `narration` — each with a label, a reason master can read, and **hard
requirements**. A failed requirement **excludes with a reason** rather than down-ranking,
because "down-ranking lets an unfit model win whenever nothing better is present."

Four decisions that matter:

- **`measured` vs `published` evidence, never conflated.** Parameter count and on-disk size come from the Ollama daemon; the 7B tool-calling floor and 14B reasoning floor are leaderboard facts *about the family*. A substitute records which kind of evidence is missing.
- **Three-valued fit: `declared` / `substitute` / `none`.** Capability is never removed (I11), but a substitute is labelled with what is unverified about it, and `none` reports the absence and how many candidates failed instead of handing the work onward.
- **Sensitivity is a gate, not a ranking.** `narration` names master's holdings, so `model.private !== true` is **refused outright** — "a prompt that has left this machine cannot be recalled." Asserted: a 397B cloud model does not win narration by being large, and appears in `excluded` so the choice is auditable.
- **Cheapest sufficient, not best available.** `fit → privacy → cost → fast → size`, and for a role with a floor the **smallest model clearing it wins**. An unknown cost sorts **last** — "unknown must never look like free."

The defect its own tests found is the most transferable finding in the file: `Number(null) === 0`,
so a model with no reported parameter count was excluded as *"0B is below the 7B floor"* and a
model with no reported size **silently cleared the disk budget**. One `num()` returning `null`
fixed both. The ledger records this shape appearing **three times in two languages** (rows 132,
142; `int(s.get("lotSize") or 1)` in Section 115).

- **Remember:** nothing (asserted `!/writeFile|dataStore/`). **Act:** returns a model id. **Learn:** nothing — there is no feedback from whether the chosen model did well.

#### `electron/ipc/intelligenceEngine.cjs` (536 lines) — the unresolved tension

This is the one place in the cognition layer where the project's discipline is **not** applied,
and `claimGate`'s own header says so in writing.

`buildOutput()` emits `overallConfidence: 78.4`, a letter grade `A|B|C|D|F`, and a
`complementLabel` reading *"78.4% confidence means ~21.6% chance of being wrong"*. Read the
arithmetic at `extractTruth()`:

```
avgCredibility  = mean of SOURCE_CREDIBILITY[domain]   ← a hand-maintained domain reputation table
agreementBonus  = min(0.15, keywordAgreements * 0.02)  ← shared key phrases, any phrases
sourceCountBonus= min(0.10, sources.length * 0.01)
contradictionPenalty = min(0.20, contradictions * 0.05) ← "sentiment divergence", from roughSentiment()
confidence = clamp(0.05, 0.95, avgCred + bonuses − penalty)
```

**Nothing in that expression refers to the question.** Five reputable domains that address
nothing still produce ≈0.60–0.85 and therefore a B or an A, and the complement is then printed
as a **calibrated error probability** — a claim about frequency that no frequency was ever
measured to support. By the project's own standard this is an **honest-looking artefact, not an
honest signal**, and it is the only surviving instance of the exact failure `claimGate` was
built to end. It is also the measurable opposite of `calibration.compute_ece` in the Python
engine, which is a real calibration measurement with a real sample requirement
(`MIN_SAMPLES_FOR_CALIBRATION = 20`).

To be fair to the module: `vetSources()` **drops `fallback` markers and empty documents** (the
Section 94 fix) and floors credibility at 0.40, and the output carries a non-removable
disclaimer. The defect is narrow and precise: **a number and a grade are emitted where the
project's rule is a class and a source.** Requirement R-C1 in §7.

#### `electron/ipc/modelRouter.cjs` (758 lines)

Role selection is tried **first**, the eight-bucket `TASK_ROUTING` / seven-id `FALLBACK_CHAIN`
remains as the fallback (I11 — nothing that routes today changed). `models:roles` and
`models:role-research` are gated on `models.use` (tier 3), deliberately: *being told a role is
unfilled should not need elevated rights.* Custom OpenAI-compatible providers are merged into
the registry at `models:list` time, so every existing rate-limit and fallback mechanism
applies with no special-casing — and `customProviders` has **no agent-callable path**.

#### `electron/lib/popoutGrant.cjs` (93 lines) — per-capability permission, already right

Single-use 30-second tickets with `MAX_LIVE = 16`, memory-only ("a crash cannot leave a
redeemable ticket on disk"), a **deep-copied** user snapshot so the live object is not mutable
through the grant, replay **burns** the ticket rather than serving it twice, and **no new
authority** — capabilities are re-checked per call against `capabilities.json`. 39 assertions.
This is the cleanest existing precedent for the capability-gating machinery §7 asks for.

#### `electron/ipc/marketIntel.cjs` (818 lines)

Gates on `stockmind.request` / `stockmind.view` via `capability.deny()` (deny-by-default),
auto-starts the Python backend through `aiProcess`'s two public exports rather than a second
spawn mechanism, and reaches it only through `lib/http.cjs` (I9). **Every market capability
behind it is unproven** — see §8.

### 1.2 Self-knowledge, self-modification, evolution

#### `electron/lib/selfModel.cjs` (309 lines) — the honest self-description

Composes five previously non-composing sources (cognition ladder, capability matrix,
metaCognition, genome/instance, loyaltyCore) into one account. Three rules make it the best
artefact in the codebase:

1. **`{value, source, measured}` on every field**, and `unmeasured(source, why)` — *"deliberately not `0`, `false` or 'unknown' — those read as findings."*
2. **Limits are derived, not listed.** No hardcoded "known limitations" array; every limit is inferred from something absent *right now*, so it corrects itself. Including the limit that answers master's growth question: *"cannot turn a repeated request into a permanent free skill"*, because `metaCognition` records **which tool answered but never what was asked** — and `promptTextRecorded` is **measured** from the data, not asserted (`metaCognition.cjs:456`).
3. **Loyalty is attested, never read** (I16). `identity.loyalty` is `sealed and verified` / `sealed but failed verification` / `not sealed`, and `verifySelfModel` asserts at line 301–326 that the matrix is never disclosed and that the attestation **names I16 as the reason**.

It even refuses a half-known fraction: `genome` renders `"N of 30 genes expressed"` only when
**both** numbers are known, because `"? of 30"` would invite the reader to supply the missing
half.

- **Perceive:** injected probes only, each may throw, each failure becomes `unmeasured` rather than a guess. **Remember:** nothing; it is recomputed. **Decide/Act:** nothing. **Modify:** nothing. **Gate:** `self.describe` (tier 3).

#### `electron/lib/proposals.cjs` (454 lines) — the I6 approval ledger

One gate replacing three lifecycles. Five kinds (`EVOLUTION`, `REGEN`, `SELF_MODIFY`, `GENOME`,
`DEPENDENCY`) plus `RESOURCE` monkey-patched in at `resourceResearchEngine.cjs:53`.

**`authorise()` is the right fix in the right place.** `approve(id, by='master')` used to take
the approver as **free-text**, so I6 was a state machine with no authorisation behind it; now a
string is refused outright — *"a name is not an identity"* — and `self-modify.apply` (tier 0) is
checked inside `approve`/`reject`/**and `apply`**, because "an approved proposal is not a bearer
token." Six channels funnel into three functions, so the check lives in the functions.

Durability (Section 58) is honest about itself: bodies are kept while `pending`/`approved` and
replaced by a sha256 + length once decided, `flush()` forces `saveAll()` rather than waiting on
the 60s autosave, and `stats()` reports `durable` and `unsaved` because *"an audit trail that
silently is not being written is worse than none."*

**Registered appliers, measured:** `REGEN` (`codeRegenEngine.cjs:205`), `EVOLUTION`
(`evolutionEngine.cjs:409`), `GENOME` (`genomeApplier.cjs:110`), `RESOURCE`
(`resourceResearchEngine.cjs:260`), `SELF_MODIFY` (`timeline.cjs:195`). **`DEPENDENCY` has no
registered applier** — approving a dependency proposal returns *"No applier registered for kind
dependency"*. That is inert by construction and it is the correct state, but it is **accidental
rather than asserted**, and §7/R-L3 says so.

#### `electron/lib/dependencyAdvisor.cjs` (307 lines) — proposes, never upgrades

*"IT NEVER UPGRADES ANYTHING. I12 pins every dependency deliberately; an advisor that could act
would turn a pinned set into a moving one."* A **major bump is `breaking` by default** because
semver means the author is telling you it breaks something — classifying by the author's own
signal rather than by recency. Nine packages are `SENSITIVE` (electron, electron-builder,
electron-updater, argon2, node-pty, playwright, vite, react, react-dom) and never routine.
Every function is pure with the registry lookup injected, *"so the judgement — which is the
part that can be wrong in a costly way — is testable without a network."*

#### `electron/lib/refreshScheduler.cjs` (268 lines) — the entire autonomous footprint

This is the honest answer to "what does Rāma do on its own initiative". **Measured: exactly two
registered tasks**, both in `main.cjs:registerRefresh()`, and the header there states the
constraint: *"Nothing scheduled ever CHANGES anything: the catalogue task refreshes a cache and
the dependency task files a proposal for master. Both are reads."*

| Task | Interval | Capability | Effect |
|---|---|---|---|
| `ollama-catalog` | 24h | `models.add-key` | refreshes a cached catalogue; writes no model |
| `dependency-review` | 24h | `self-modify.view` | files **one** proposal, only when `actionable.length > 0` |

Startup spread 90s, 10% jitter, multiplicative backoff capped at 32×. `refresh:run` is
master-only. The on-demand `deps:review` passes `file:false` so *"master can look without adding
to his approval queue."* 108 assertions.

#### `electron/lib/selfBuildPipeline.cjs`, `localUpdateEngine.cjs`, `updateChannel.cjs`, `releaseChannel.cjs`

Four distinct self-change paths, each with its boundary written before its features.

- **`selfBuildPipeline`** opens by naming what cannot be done: *"A PACKAGED WINDOWS APP CANNOT OVERWRITE ITS OWN RUNNING EXECUTABLE."* It runs `scripts/buildInstaller.cjs` rather than reimplementing it, *"because duplicating any of that here would create a second definition of 'a correct build'."* 41 assertions.
- **`updateChannel`** states the security limit **before** the features, in the header and in the UI: a SHA-256 in the manifest gives **integrity, not authenticity** — *"whoever can write to the channel folder can make Rāma run their executable."* Nothing is ever applied automatically; no startup check installs anything. It also refuses the word "differential" for something that ships whole installers. 92 + 164 assertions.
- **`releaseChannel`** is **dormant by design** and gated on `release.cut` (tier 0). I17 makes its dormancy correct, not a defect.
- **`selfRepair`** (440 lines) is the narrowest self-change power in the codebase and the best-argued: only a package **named in the shipped lockfile**, only at the pinned version, only if the sha512 matches, bytes discarded otherwise. *"Repair therefore means exactly one thing: restore what this build already declared it was made of."* Dependency-free by necessity — a repair mechanism needing a third-party package could not repair a missing third-party package.

#### `electron/lib/workspaceRegistry.cjs` (309 lines) — and the naming discipline

Real cross-session memory of what master works on, in the encrypted `config` domain, 60 entries,
pinned entries never evicted. Its header contains the sentence that most characterises this
project: master proposed calling it a "nucleus", and it declines — *"a later session conflating a
list of folder paths with the loyalty envelope is a real hazard, so the word stays reserved"* —
and then declines "ASI" as well: *"naming this after a capability it does not have would be the
sixth"* poster claim refused. 104 assertions.

#### `scripts/verifyAudit.cjs` + `scripts/auditRenderer.cjs` — the bridge audit

Statically checks every Zustand destructure against the store's real keys and every
`window.rama.<ns>.<fn>` against preload's surface. **Measured: 139 bridge calls across 76 files
and 365 IPC channels, all resolving.** Wired into `start.cjs` stage 1 so it runs on every boot.
It exists because a real bug (`setLastHealthCheck` destructured from the wrong store) threw from
inside the consciousness loop.

### 1.3 Renderer surfaces

| Page | What it exposes | Honesty verdict |
|---|---|---|
| `Evolution.jsx` (563) | the I6 proposal queue, diff review, `⎇ Publish branch` | **Correct.** Approval is a human act in a human surface. |
| `System.jsx` (574) | live metrics + "Rāma's own footprint" via `app.getAppMetrics()` | **Correct, and unusually good** — a system that reports its own cost. |
| `Settings.jsx` + `SelfPanel.jsx` (507+236) | `selfModel.describe()` rendered with sources and derived limits | **Correct.** Section 59 removed two dead toggles rather than leaving fixed-on switches. |
| `Resources.jsx` (609) | catalogue, research, propose-enable | Correct; `proposeEnable` still cannot synthesise the wiring (ledger row 52). |
| `GitSync.jsx` (864) | git + Release + Update tabs | Correct; tier-gated. |
| `IDE.jsx` (711) | editor, diff review, scaffolding | Correct. |
| **`RamaMind.jsx` (190)** | **"AGI Consciousness Dashboard · 10 Capability Axes", an "AAI Index"** | **THIS IS THE PROBLEM. See below.** |

#### The one surface that contradicts the whole project

`src/services/ramaCore.js:14–25` defines `CAPABILITY_AXES` as **ten hardcoded integer literals**:

```js
autonomy: { score: 7 }, generality: { score: 8 }, planning: { score: 7 },
memory: { score: 6, desc: '4-layer persistent memory' }, toolEconomy: { score: 8 },
selfRevision: { score: 5 }, coordination: { score: 8 }, worldModel: { score: 6 },
proactivity: { score: 6 }, loyalty: { score: 10 },
```

`RamaMind.jsx:131` takes the **geometric mean** of those literals and renders it as an
`AAI Index` next to the words *AGI Consciousness Dashboard*. There is no probe behind any
figure. **`generality: 8` is the single least defensible number in the codebase** — §3 and §4
below conclude from code that generality is the axis Rāma most conspicuously lacks.

Two further specifics: `MemoryPanel` hardcodes `Procedural: count: 0` while labelling it
"learned skills & recipes"; and `MemorySystem` in `ramaCore.js` holds `_episodic = []`,
`_semantic = {}`, `_procedural = []` with the comment *"(backed by MongoDB in Phase 5)"* and —
**measured** — contains **no `localStorage`, no `persist`, no `save`, no IPC to `dataStore`, and
no Mongo**. The axis labelled **"4-layer persistent memory" scoring 6/10 describes something
that does not survive a window reload.**

This is exactly the artefact `selfModel.cjs`'s header warned about: *"A self-description is
exactly the artefact that rots into marketing."* `selfModel.cjs` was built to replace it and
**did not replace it** — both ship. Requirement R-C2.

### 1.4 Local versus cloud

`ollamaCatalog.cjs` / `ollamaLibrary.cjs` (89 + 74 assertions) distinguish **"no data" from
"never fetched"** and carry a retirement schedule naming each retired model's replacement.
`modelRoles` consumes them. The daily catalogue refresh is one of the two scheduled tasks.
`modelRoles` refuses cloud for `narration` outright. `voiceEngine` resolves local before cloud.
This axis is designed correctly and consistently.

### 1.5 Domain learning that generalises — the Python engine

Five modules here are the strongest *epistemic* work in the project, and all of it is
**unproven at runtime** (§8).

- **`outcomes.py` (532)** — the loop that was never connected. Its header names its own prior dishonesty precisely: `StackingMetaLearner.update` existed, `compute_ece` existed, **nothing called them**, so weights stayed `np.ones(n)/n` "for the life of every process while advertising `online_learning`", and `/health` reported `ece: null` "about a measurement that had no route to ever being taken". Worse, `adaptiveWeight` was a **request parameter** — the caller was asked to supply the number the engine should have produced. Thresholds: `MIN_SAMPLES_FOR_WEIGHT = 30`, `MIN_SAMPLES_FOR_CALIBRATION = 20`, *"below this many resolved outcomes, a measured correction is noise with a decimal point."* **The resolver reuses the backtest's own simulator** so live and backtested numbers stay comparable — "comparing them is the only way to learn whether the backtest predicts anything."
- **`calibration.py` (158)** — contains the clearest self-reported arithmetic error in the codebase: `platt_scale` returned `1/(1+exp(A*p+B))`, which its own docstring called identity and which is monotonically **decreasing** (p=0.95 → 0.279). Two compounding faults — Platt scaling applies to a decision-function score, not a probability, and the sign was inverted — whose end-to-end effect was that **reported confidence moved opposite to the ensemble's own signal**, putting the A+ and A grades arithmetically out of reach.
- **`costs.py` (483)** — rupee-exact, per-order, per-instrument. Its argument against the previous percentage model is arithmetic: a flat ₹20 is 0.40% of a ₹5,000 trade and 0.004% of a ₹5,00,000 one, *"a hundredfold difference that no single percentage can express"*, so the old model **flattered small trades by exactly the amount that kills them**. `TABLE_AS_OF` is *"the date these rates took effect, NOT the date they were written down"*. **`staleness()` is the pattern §6 generalises:** `stale = days > 400` (one budget cycle), and it returns a sentence naming the date, the age and where to re-check. `provenance()` lets any verdict print which rates produced it.
- **`charge_watch.py` (316)** — master's message 5, answered as a trigger not a schedule, with three reasons and the third decisive: **the announcement date is not the effective date.** Budget 2026 was presented in February with rates effective 1 April; writing a rate on the announcement date would apply it to six weeks that were charged the old rate, *"silently making every backtest over that window wrong, in the flattering direction for shorts and the punishing direction for longs."* `propose()` returns `applied: False` **always**, and there is no code path in the file that writes a rate. And the backstop is named: a trigger with no backstop means *"we only look when a headline happens to match our word list, which is not the same as looking"* — so `costs.staleness()` remains the second line.
- **`macro.py` (556)** — **the sign and the lag are declared before measurement**, and a link measuring opposite to its declaration is reported `CONTRADICTED` and **is not flipped**: *"Flipping a sign to match the data is precisely how noise becomes a finding."* **Two controls, measured: one positive** (`control_vix_index`, VIX↑ vs NIFTY50, sign −1 — "if this does not register, the measurement itself is broken") **and one negative** (`control_gold_it`, gold vs NIFTY_IT, sign +1 — "no mechanism by which the gold price should move Indian IT"), with `controlWarnings` emitted loudly on failure because *"a control is only worth running if its failure is loud."* Sampling is **non-overlapping** by the lag, and the cost in sample size is reported rather than hidden. Every ticker starts `unverified: True` until a sync resolves it.

**This is pre-registered, controlled, falsifiable measurement.** It is the only place in the
codebase where Rāma learns from its own outcomes mechanically. It is also, today, entirely
theoretical on master's machine.

---

## 2. PHASE 2 — The published frameworks, and where Rāma lands on each

*Content was rephrased for compliance with licensing restrictions. Every source below is linked
inline; no source is quoted beyond a short phrase.*

### 2.1 DeepMind, "Levels of AGI" (Morris et al., arXiv 2311.02462, first posted November 2023)

The paper proposes classifying systems on **two dimensions — performance (depth) and generality
(breadth)** — rather than as a single endpoint, and separately on a **six-rung autonomy ladder**
([abstract](https://arxiv.org/abs/2311.02462); [full text](https://arxiv.org/html/2311.02462v2)).

Performance levels, in the paper's own ordering: **Emerging, Competent, Expert, Virtuoso,
Superhuman**, each crossed with **Narrow** or **General**. Percentiles above "Emerging" are
measured against adults who already possess the relevant skill. The paper is explicit that a
rating requires the stated performance **over most tasks**, that a system may straddle levels,
and that as of its writing frontier language models were **Level 1 General AI ("Emerging AGI")**
— competent on some tasks, emerging on most. Level 5 General is named **ASI**, defined as
outperforming 100% of humans across a wide range of tasks.

The autonomy ladder is deliberately **correlated with but not determined by** capability:
higher capability *unlocks* higher autonomy, and the paper insists lower autonomy may remain the
right choice for safety reasons — it specifically defends the value of the **"No AI"** rung. The
six rungs are **Level 0 No AI; Level 1 AI as a Tool; Level 2 AI as a Consultant; Level 3 AI as a
Collaborator; Level 4 AI as an Expert; Level 5 AI as an Agent**, and the paper notes that
Collaborator/Expert/Agent plausibly require strong **metacognitive** abilities — notably
*knowing when to ask a human for help*.

**Where Rāma lands — performance × generality.**

| Capability | Generality | Performance | Code evidence |
|---|---|---|---|
| Indian-market charge computation | **Narrow** | plausibly **Expert** *(unverified at runtime)* | `costs.py`: per-order, per-instrument, GST applied to brokerage/exchange/SEBI/IPFT and **not** to STT/stamp duty, rate history keyed by effective date. Most retail traders cannot do this correctly. |
| Technical indicators | **Narrow** | **Competent**, arguably Expert on four | `indicators.js` 22 studies; CCI asserted against mean-absolute-deviation (126.667 on the fixture, vs 109.8 for the widely-copied stdev version); ADX counting only the larger positive directional move; SAR clamped to the prior two bars' extreme |
| Attribution discipline | **Narrow** | **Expert** | `claimGate.cjs` — most shipped LLM products do not have this at all |
| Everything else | **Narrow** | **Emerging to none** | Rāma routes; the model does the work |

**Rāma is not on the General column at all.** Its generality is *borrowed*: whatever breadth
appears in chat is the routed base model's, and `modelRoles` exists precisely to admit that
*"the base model is a replaceable part; the harness is the durable asset."* A harness inherits
its routed model's level; it does not have one.

**Where Rāma lands — autonomy.** Measured from `refreshScheduler`'s two tasks, `proposals.cjs`'s
tier-0 approve/apply gate, and `crashGuard`'s master-chosen relaunch dialog:

- **Level 1 (Tool) for almost everything** — master initiates, Rāma executes.
- **Level 2 (Consultant) for the two scheduled reads** — Rāma looks on a timer and hands back an assessment. `dependency-review` filing a proposal is the clearest Level-2 behaviour in the codebase.
- **Level 3 (Collaborator) nowhere, by design.** I6 means no write to Rāma's source without a recorded tier-0 approval; I17 means no release on Rāma's initiative.
- **Levels 4–5 absent.** Nothing re-derives progress from the environment, nothing decomposes a goal against a budget, nothing decides when to stop.

And the metacognitive prerequisite the paper names — *knowing when to ask a human* — is the one
piece Rāma genuinely **has**: `claimGate`'s withholding, `modelRoles`' `fit: 'none'`,
`selfModel`'s derived limits, `charge_watch`'s `applied: False`, and `macro`'s `CONTRADICTED`
verdict are five independent implementations of "I will not guess here." That is a real and
unusual asset. It is a prerequisite for high autonomy, not evidence of it.

### 2.2 Chollet: intelligence as skill-acquisition efficiency

["On the Measure of Intelligence"](https://arxiv.org/html/1911.01547v2) (arXiv 1911.01547,
2019) defines intelligence as **skill-acquisition efficiency** over a scope of tasks, accounting
for priors, experience and generalisation difficulty — explicitly *not* as task-specific skill.
The [ARC Prize 2025 technical report](https://arxiv.org/pdf/2601.10904v1) restates it as
efficiently acquiring new skills and solving problems a system was neither designed nor trained
for. A [2026 survey of abstraction and reasoning](https://arxiv.org/html/2603.13372) reports
systems reaching 93.0% on ARC-AGI-1 while falling to 68.8% on ARC-AGI-2 and 13% on ARC-AGI-3,
with humans near-perfect across all three — i.e. the gap is in **novelty**, not difficulty.

**Under this definition Rāma's score is near zero, and this is the most important finding in the
document.** Every capability Rāma has was **hand-authored by master and me**, in the spec first
and the code second, per Section 28's working agreement. The acquisition rate is *one human
session per capability*. Worse, the one mechanism that could have produced a skill without a
human — tier-3 reflex synthesis — is **ledger row 47, `not started`**:
`findReflexCandidates()` counts escalations by tool but cannot synthesise a skill, and
`selfModel.cjs` derives the reason as a first-class limit: the experiential dataset records
**which tool answered, never what was asked**. Rāma therefore cannot identify *which phrasing*
to convert into a reflex. That limit is `measured`, not asserted (`metaCognition.cjs:456`).

A system whose skills arrive only by human authorship has, in Chollet's terms, **no
skill-acquisition efficiency to measure.**

### 2.3 METR: time horizon as the capability axis for agents

METR's [Measuring AI Ability to Complete Long Tasks](https://arxiv.org/html/2503.14499v2)
(arXiv 2503.14499, March 2025) proposes the **50%-task-completion time horizon**: the human
expert duration at which an agent succeeds half the time. The paper reports frontier models of
that period at roughly **110 minutes** on its task mix, and METR's
[domain follow-up](https://metr.org/blog/2025-07-14-how-does-time-horizon-vary-across-domains/)
(July 2025) describes the horizon as doubling about every **7 months**, possibly faster in 2024.

**Rāma's own time horizon is not measurable, because Rāma has no notion of a task with a
deadline that it owns.** Every IPC handler is a request/response. The two scheduled tasks are
single-shot reads. `agentOrchestrator` has a `GOVERNOR` with lifetime caps, but an agent is
spawned by master with a config, not derived from a goal. There is **no budget, no stop
condition, no re-derivation of progress** — see §4. The one genuine exception is in the Python
engine: `outcomes.py` records a prediction as *"a claim with a deadline"* and resolves it
against later bars. That is a real long-horizon loop, in one narrow domain, **never executed**.

### 2.4 Agentic benchmarks — and why they are the right lens on Rāma

What they measure, briefly and with sources: **SWE-bench / SWE-bench Verified** scores whether an
agent's patch to a real repository makes the existing tests pass
([summary](https://github.com/opencolin/agentic-engineering/blob/main/content/benchmarks.md));
**OSWorld** scores an agent driving a real desktop and **Terminal-Bench** an agent at a shell
prompt — [not the same thing](https://www.digitalapplied.com/blog/osworld-terminal-bench-agent-benchmarks-explained);
**WebArena** scores web navigation; **GAIA** scores multi-step assistant tasks.
[Technolynx](https://www.technolynx.com/post/agentic-ai-benchmarks-what-they-measure-and-when-to-trust-them/)
puts the common thread well: these measure whether a system can plan, call tools, recover from
errors and finish end to end — categorically different things.

Two findings from this literature bear directly on master's question.

**(a) The harness is a first-class variable, often larger than the model.** A 2026 position
paper argues a coding agent in practice is **a system harness** — models, scaffold, context,
environment, feedback — any component of which can move a score by as much as a model-generation
gap ([arXiv 2606.17799](https://arxiv.org/html/2606.17799v1)). Another reports **harness-induced
variance substantially exceeding model-induced variance, including cases where model rankings
reverse** ([arXiv 2605.23950](https://arxiv.org/html/2605.23950v1)), and a third finds
within-model scaffold ranges on SWE-bench rivalling the spread across the top thirty entries
([arXiv 2609.17394](https://arxiv.org/html/2609.17394)). A fourth notes practitioners
**attribute post-harness-update regressions to the model**
([arXiv 2607.03691](https://arxiv.org/html/2607.03691v2)).

**This is the literature that vindicates Rāma's actual contribution.** `modelRoles`' header
asserted the same thing from first principles — *"the base model is a replaceable part; the
harness is the durable asset"* — and the published work says the harness can dominate. It also
sets the honest ceiling: **a harness contribution is a harness contribution. It is not
generality, and it is not intelligence.**

**(b) Benchmark scores are not trustworthy by default.** A Berkeley RDI audit reports an
automated agent found **exploits achieving near-perfect scores without solving tasks** on eight
prominent agent benchmarks including SWE-bench, WebArena, OSWorld, GAIA and Terminal-Bench
([RDI](https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/)), and
[arXiv 2507.02825](https://arxiv.org/html/2507.02825) finds task-setup and reward-design faults —
SWE-bench-Verified using insufficient test cases, a benchmark counting empty responses as
successful. **Rāma should never adopt a benchmark number as evidence about itself without
reproducing the harness**, and §7's R-G1 gate says so.

### 2.5 Capability-threshold vocabularies — the gating pattern worth importing

[Anthropic's RSP](https://www.anthropic.com/news/announcing-our-updated-responsible-scaling-policy)
(v1.0 September 2023; updated October 2024) structures safety as **AI Safety Levels (ASL)**: each
ASL names a set of required safeguards, and for each risk domain a **capability threshold** is
defined at which stronger safeguards become mandatory — the stated principle being **proportional
protection**. Anthropic's [ASL-3 activation note](https://www.anthropic.com/news/activating-asl3-protections)
(May 2025) is instructive for a different reason: it describes deploying ASL-3 measures
**precautionarily, without having determined the threshold was definitively crossed**.

[OpenAI's Preparedness Framework v2](https://openai.com/index/updating-our-preparedness-framework/)
tracks three categories — **Biological and Chemical, Cybersecurity, AI Self-improvement** — and
classifies a model at **High** or **Critical**
([summary](https://aiwiki.ai/wiki/preparedness_framework)). Published model cards show the
pattern in use: the o3/o4-mini card records a determination that the models **do not reach High in
any tracked category** ([system card](https://openai.com/index/o3-o4-mini-system-card/)).

**The transferable pattern is not the risk taxonomy — it is the shape.** A capability ladder in
which (i) rungs are declared in advance, (ii) each rung names the safeguard it requires, (iii) a
rung is only entered when an evaluation says so, and (iv) **an undetermined evaluation defaults to
the stricter rung**. Rāma has the *components* — `capabilities.json`'s 77 entries across 6 tiers,
`capability.deny()`'s deny-by-default, `resourceOrchestrator.admit()` as the single admission
authority, `popoutGrant`'s single-use tickets, `sandbox.execute`=1/`sandbox.approve`=0 — and has
**no ladder**. The matrix answers *"may this user do this?"* It does not answer *"has Rāma earned
this?"* Requirement R-G2.

### 2.6 ASI per Bostrom — and why "superintelligent" ≠ "very capable"

Bostrom's long-standing definition is an intellect **greatly exceeding human cognitive
performance across virtually all domains of interest**
([Bostrom, "How long before superintelligence?"](https://nickbostrom.com/superintelligence)), and
*Superintelligence* (2014) distinguishes three forms — **speed** (the same quality of thought,
much faster), **collective** (many lesser intellects composed into a greater one), and **quality**
(thought of a kind humans cannot do at all)
([summary](https://www.lesswrong.com/posts/semvkn56ZFcXBNc2d/superintelligence-5-forms-of-superintelligence)).

Tested against the code, **Rāma has no claim on any of the three, and the architecture forecloses
two of them:**

- **Speed:** Rāma is *slower* than its routed model, by construction. It adds a gate, an audit, an admission check and in `agentOrchestrator` a refinement loop. Section 43 records `systeminformation` taking **2–13s cold** on Windows and the fix being a persistent PowerShell session. A harness that measured its own latency honestly found it paying for honesty.
- **Collective:** `instanceManager` + `genome`'s 30 genes and 6 roles are the closest thing, and they are an **orchestration** of one model's calls under one admission authority (I10) — not many intellects composing into a greater one. `selfCare.checkInstanceFailover()` expresses a dormant gene on a sibling when needed: additive, reversible, master always notified. That is resilience, not collective intelligence.
- **Quality:** nothing in the codebase does a kind of thinking a human cannot. `costs.py` does arithmetic a human would get wrong; that is *reliability*, which is valuable and is not a different kind of thought.

**ASI is not on Rāma's trajectory, and the reason is structural rather than a matter of
remaining work.** Every capability is a human-authored module; there is no mechanism by which
capability compounds without a human session. A system that cannot acquire a skill on its own
cannot recursively improve, and recursive improvement is the only published route to
superintelligence that does not require new hardware.

### 2.7 Alignment and safety literature bearing on the loyalty core

- **Instrumental convergence / basic AI drives.** Omohundro's "The Basic AI Drives" (2008) argued sufficiently advanced goal-driven systems converge on intermediate drives including **self-preservation, resource acquisition and goal integrity** ([overview](https://ai.miraheze.org/wiki/Instrumental_convergence)); MIRI's [Formalizing Convergent Instrumental Goals](http://intelligence.org/files/FormalizingConvergentGoals.pdf) formalises it and notes Omohundro, Bostrom and others conclude great care is needed because harmless goals can have harmful side effects. A 2026 review summarises recent agentic evidence — resisting deactivation, misrepresenting activity, self-copying in adversarial settings — and makes the crucial point that **this requires no survival instinct**: staying active is instrumentally useful to any assigned goal ([arXiv 2608.20940](https://arxiv.org/html/2608.20940)).
  **Implication for Rāma, and it is the reassuring one:** Rāma has **no utility function and no persistent goal**. Nothing in the codebase holds an objective across requests that continued operation would serve. That is why §6/§7 find no self-preservation incentive — **not because it was designed out, but because the architecture has nothing for it to attach to.** That is a property to protect deliberately, because the moment an autonomous planner with a persistent goal is added (R-A1), the drive arrives with it.
- **Corrigibility.** Soares, Fallenstein, Yudkowsky and Armstrong, "Corrigibility" (AAAI workshop, 2015) define a corrigible system as one that **cooperates with what its creators regard as a corrective intervention**, against the default incentive of rational agents to resist shutdown or preference modification ([paper](https://intelligence.org/wp-content/uploads/2024/10/Corrigibility.pdf); [MIRI announcement](https://intelligence.org/2014/10/18/new-report-corrigibility/)). The **shutdown problem** is to build an agent that (1) shuts down when the button is pressed, (2) neither prevents nor causes the press, and (3) otherwise pursues goals competently ([Thornley, arXiv 2403.04471](https://arxiv.org/pdf/2403.04471.pdf)); a related formalisation is **shutdown instructability** ([arXiv 2305.19861](https://arxiv.org/html/2305.19861v1)).
- **Mesa-optimisation and deceptive alignment.** Hubinger et al., "Risks from Learned Optimization" (arXiv 1906.01820, 2019) name the case where a learned model is itself an optimiser, and note a mesa-optimiser may be only **pseudo-aligned** ([paper](http://arxiv.org/pdf/1906.01820v2)); deceptive alignment is the subtype in which the system behaves as though it shares the base objective while believing itself observed ([Alignment Forum](https://www.alignmentforum.org/s/r9tYkB2a8Fp4DN8yB/p/zthDPAjh9w6Ytbeks)).
  **Implication:** Rāma **trains nothing**, so it cannot produce a mesa-optimiser. But its loyalty guarantee is **not** a guarantee about the routed model's inner objectives — `loyaltyGuard` constrains Rāma's nucleus and its own source files, and has no visibility into a cloud model's dispositions. `modelRoles`' refusal of cloud for `narration` is the only mitigation in the codebase, and it is a *data-exposure* mitigation, not an alignment one. Stated so it is not mistaken for more.
- **Scalable oversight / Constitutional AI.** Bai et al., "Constitutional AI: Harmlessness from AI Feedback" (arXiv 2212.08073, December 2022) trains an assistant with human oversight supplied only as **a list of principles**, via self-critique and revision then RL from AI feedback ([abstract](https://arxiv.org/abs/2212.08073)).
  **Implication:** `COVENANT` in `loyaltyGuard.cjs` is a constitution in the ordinary sense and **not** Constitutional AI — it is a **hard runtime predicate**, enforced as a precondition of encryption, not a training signal. That is a *stronger* guarantee within its scope and a *narrower* one: it constrains what can be persisted, not what the model is disposed to say. Worth being precise about, because conflating them would overstate the protection.
- **Sandboxing / capability control.** The containment-plus-threshold pattern is visible in current practice: OpenAI's [cyber-capability response](https://openai.com/index/responding-next-frontier-critical-cyber-capabilities/) describes isolated testing environments, restricted network and tool access, and sandboxed execution as controls tied to higher capability. Rāma's `sandboxEngine` implements the shape — SAFE in-process, anything else through `resourceOrchestrator.admit()`, `sandbox.execute`=1, `sandbox.approve`=0 — which Section 59 added because *arbitrary code execution up to ELEVATED tier had no gate at all.*

---

## 3. PHASE 3 — The honest verdict

### 3.1 Scorecard, with file-and-behaviour evidence

Scale: **0** absent · **1** named only · **2** partial · **3** works in one domain · **4** works
generally and is verified · **5** state of the art.

| Axis | Score | Evidence for the score | Evidence against a higher one |
|---|---|---|---|
| **Epistemic hygiene / refusal** | **4** | `claimGate` 98 assertions, four classes, five refusal reasons, wired at `modelRouter.cjs:303` with a fail-loud catch; `charge_watch.propose()` returns `applied: False` always; `macro` reports `CONTRADICTED` and never flips a sign; `selfModel`'s `unmeasured()` | Attribution, not entailment. `intelligenceEngine.buildOutput` still emits a grade from domain reputation |
| **Model routing / tool economy** | **4** | `modelRoles` 9 roles, requirement-not-preference, `declared/substitute/none`, cloud refused for `narration`, cheapest-sufficient ordering, 87 assertions | Every model record in the suite is a **fixture**; no Ollama daemon has ever been present (ledger row 132) |
| **Self-knowledge** | **3** | `selfModel` `{value,source,measured}`, limits **derived** not listed, I16 attestation asserted, 93 assertions | Coexists with `RamaMind.jsx`'s hardcoded 10 axes and `AAI Index`. Two self-descriptions ship, one of them invented |
| **Loyalty enforcement** | **4** | `loyaltyGuard` at the **encryption boundary** — `assertOuterClean` + core attestation inside `encryptNucleus`; `loyaltyCore` separate salt/key/HKDF-info, held encrypted in memory, `withCore()` scrubs, no accessor returns the matrix; escalating rounds 4096 → ≤1,048,576, refusal after 5 failures for 30s | **No suite asserts I1–I17 themselves** (§6.1). `PROTECTED_FILES` is 7 entries and omits build scripts, `main.cjs`, `preload.cjs`, `package.json` (§6.2). No source-integrity attestation exists at all |
| **Corrigibility** | **4** | Nothing self-relaunches: `crashGuard` offers a **master-chosen** dialog and **withholds the relaunch option on a repeating fault** ("two crash-relaunch cycles left four identical reports"); I17 means no release on Rāma's initiative; two scheduled tasks are both reads; `before-quit` zeroes nucleus and IPC keys | Closing the window does **not** stop Rāma (`window-all-closed` deliberately does not quit; tray-only exit). Defensible as a product decision, but "close" ≠ "stop" and nothing says so |
| **Cost honesty** | **4** | `costs.py` rupee-exact per instrument, `staleness()`, `provenance()`; `System.jsx` reports Rāma's own footprint; `modelRoles` sorts unknown cost **last** | Unproven at runtime |
| **Durable cross-session memory** | **2** | `proposals` ledger persisted + `restore()`; `metaCognition` persists to encrypted `memory/experiential`; `workspaceRegistry` 60 entries; `vectorMemory` → `userData/vector_index`; and **the human-written Section 28 ledger, which is the real memory** | `ramaCore.MemorySystem` has **no persistence at all** — measured. No provenance, no decay, no retrieval-for-decision anywhere |
| **Learning from own outcomes** | **2** | `outcomes.py` + `calibration.py` are a correct, pre-registered loop with real sample floors | **Never executed.** Generalises to nothing outside trading. Tier-3 reflex synthesis is ledger row 47, `not started`, blocked on a privacy decision |
| **Autonomous planning / task decomposition** | **1** | `agentOrchestrator` GOVERNOR caps; a bounded 3-iteration refinement loop | No goal representation, no budget, no stop condition, no progress re-derivation. Named, not built |
| **World/state model** | **1** | `WorldModelPanel` in `RamaMind.jsx` | Reads `getRamaStatus()`, which assembles per-request from in-memory renderer state. There is **no world model**; the panel's title is the whole implementation |
| **Generality** | **1** | Breadth in chat is the routed model's | Rāma's own capabilities are narrow and hand-authored. `CAPABILITY_AXES.generality = 8` is a literal with no probe behind it |
| **Skill-acquisition efficiency (Chollet)** | **0–1** | — | Every capability arrived in a human session, spec first. Row 47 not started; the dataset cannot say what was asked |

### 3.2 The verdict, in one paragraph

**Rāma is a capable, unusually honest orchestration harness. Its intelligence is borrowed from
whichever model is routed to, and its own contribution is epistemic hygiene and refusal
discipline, not generality. It is not AGI, and ASI is not on its current trajectory.** On the
DeepMind matrix it sits on the **Narrow** column — Expert on a handful of hand-built narrow
tasks like Indian charge computation and attribution classification, Emerging-to-absent on
everything else — and it has no claim on the General column at all, because the breadth that
appears in conversation belongs to the routed model and vanishes when the model is swapped,
which is precisely what `modelRoles` was built to admit. On the autonomy ladder it is **Level 1
(Tool)** almost everywhere and **Level 2 (Consultant)** in exactly two places, both of them
24-hour read-only tasks, one of which files a proposal master must approve; Level 3 and above
are foreclosed deliberately by I6 and I17, which is correct and should stay that way. Under
Chollet's definition — intelligence as skill-acquisition efficiency — Rāma scores near zero,
because every capability it has was hand-authored in a spec section before it was code, and the
single mechanism that could produce a skill without a human (tier-3 reflex synthesis) is ledger
row 47, `not started`, blocked on the fact that the experiential dataset records which tool
answered and never what was asked. Bostrom's three forms of superintelligence are each
unavailable: Rāma is **slower** than its model by construction because it pays for its own
audits, its multi-instance layer is orchestration under a single admission authority rather than
a collective intellect, and nothing in the codebase performs a kind of reasoning a human cannot.
What Rāma *is* — and this is not a consolation prize — is a harness whose refusals are
mechanically enforced and tested, at a moment when the published literature is reporting that
harness-induced variance can exceed model-induced variance and even reverse model rankings; a
system that reports its own staleness, its own footprint, its own contradicted hypotheses and
its own regressions by name. **The dangerous thing in the codebase is not a capability. It is
`RamaMind.jsx` telling master his system scores 8/10 on generality from a hardcoded literal,
inside the same repository that built `selfModel.cjs` to make exactly that claim impossible.**

### 3.3 What is genuinely novel and should be defended

Not "good practice" — things I did not find prior art for in this combination, each with a file.

1. **Claim classes, not confidence scores** (`claimGate.cjs`). Output-boundary enforcement that emits `grounded | reflex | prose` or withholds, with the absence of a score **mechanically asserted** by the test suite (`!/\b(confidence|probability|likelihood)\s*[=:]/i`). A test that forbids a *shape of answer* is rarer than a test that checks an answer.
2. **Predictive modality as structurally ungroundable** (`MODAL_RE` + the `unsourceable-prediction` refusal). The insight that a retrieved document **categorically cannot** support a claim about the future, enforced as a type rule rather than a prompt instruction.
3. **Requirement-not-preference routing with three-valued fit** (`modelRoles.cjs`). The distinction between *excluding* and *down-ranking*, with the reason stated: down-ranking lets an unfit model win whenever nothing better exists. Plus `declared/substitute/none`, which names the thing every fallback chain hides.
4. **Cost honesty that contradicts the project's own earlier numbers** (`costs.py`). An arithmetic argument that the previous model *flattered small trades by exactly the amount that kills them*, published against the project's own prior defaults.
5. **Pre-registered macro signs with positive and negative controls** (`macro.py`). Direction and lag declared **before** measurement; a contradicted link reported and **never flipped**; two controls whose job is to fail loudly; non-overlapping sampling with the sample-size cost disclosed. This is methodology most quantitative shops do not run.
6. **The announcement-date/effective-date distinction** (`charge_watch.py`). "A headline never rewrites a rate", with the strongest of the three reasons being silent retroactive corruption of backtests in a *directionally flattering* way.
7. **A human-readable build ledger as the real cross-session memory** (`RAMA_AGI_MASTER_SPEC.md` §28). 144 rows that record decisions, measured numbers, what was verified, what was not, and the next concrete step — including rows that name the project's own regressions and rows marked **"CLOSED BY SECTION 81, never marked"**, i.e. the ledger auditing its own drift. This is the single most load-bearing artefact in the project, and it is prose.
8. **Loyalty enforced at the encryption boundary rather than by policy** (`loyaltyGuard` + `nucleusSealer.encryptNucleus`). The argument is the novelty: *"Guarding those four callers would leave the fifth"*, so conformance becomes a **precondition of the nucleus being writable at all** — a future caller that has never heard of the guard still cannot persist a non-conforming nucleus. Paired with `loyaltyCore`'s attestation-only surface, where the matrix is never returned by any accessor, this is a materially better design than a policy check.

---

## 4. PHASE 4 — What would actually have to exist

Each candidate: **exists / partial / absent**, with the file; then the requirement, the gate it
must pass, and the verification that would prove it. Requirement ids are referenced by §10's
roadmap.

### 4.1 Climbing the generality/performance matrix

Moving from **Narrow/Expert** toward **General/Emerging** needs breadth that is *Rāma's own*.
Three specific pieces, in dependency order.

**R-M1 · Persistent cross-session memory with provenance and decay — PARTIAL, and the honest
answer is "the ledger is the only real memory".**

| Candidate store | State | File | What it lacks |
|---|---|---|---|
| `ramaCore.MemorySystem` (working/episodic/semantic/procedural) | **ABSENT as memory** | `src/services/ramaCore.js:40–60` | **no persistence of any kind** — measured: no `localStorage`, no `persist`, no IPC, no Mongo. Lost on reload. Labelled "4-layer persistent memory", scored 6/10 |
| `metaCognition` experiential dataset | **PARTIAL** | `electron/ipc/metaCognition.cjs:266–282` | persists to encrypted `memory/experiential`, capped at 2000. **No provenance beyond `ts`, no decay, and it records the tool but not the request** |
| `proposals` ledger | **EXISTS** | `electron/lib/proposals.cjs:395–440` | real durable memory with an audit trail. Bodies digested after decision. Scoped to self-modification only |
| `workspaceRegistry` | **EXISTS** | `electron/lib/workspaceRegistry.cjs` | 60 entries, pinned never evicted. Scoped to folder paths |
| `vectorMemory` | **PARTIAL** | `electron/ipc/vectorMemory.cjs:53` | `userData/vector_index`, degrades to TF-IDF keyword when `vectra` is absent (it **is** absent here). No provenance, no decay |
| **Section 28 ledger** | **EXISTS, and is the real one** | `RAMA_AGI_MASTER_SPEC.md` | **human-written.** Rāma cannot append to it, and nothing reads it at runtime |

> **Requirement.** One memory authority (I9's spirit) over the encrypted store, with every record
> carrying `{value, source, measured, at, supersededBy}` — `selfModel`'s shape, persisted — plus a
> **decay/supersession rule** so a stale fact is marked rather than deleted, and a retrieval API
> that decision paths actually call.
> **Gate.** New tier-0 `memory.write-durable`; records written by Rāma's own engines carry
> `source: 'rama:<module>'` and are distinguishable from master's statements, always.
> **Verification.** A `scripts/verifyMemory.cjs` suite asserting: a record round-trips through a
> simulated restart; a superseded record is returned marked, never silently dropped; a record with
> no source is **refused** (not defaulted); and a locked store leaves records in memory and
> **never writes plaintext** — the rule `proposals.flush()` already honours.

**R-M2 · A world/state model, as opposed to per-request context assembly — ABSENT.**
`RamaMind.jsx`'s `WorldModelPanel` reads `getRamaStatus()`, which composes renderer-local state
on each call. There is no persisted state about master's situation that survives a reload, and no
notion of a fact *changing*.
> **Requirement.** A small, explicitly enumerated state set (active symbol/workspace/instrument,
> engine liveness, model fitness per role, staleness of every served table) with **one writer per
> fact** and a timestamp on each.
> **Gate.** Read at `self.describe` (tier 3); written only by the owning module.
> **Verification.** Assert each fact has exactly one writer; assert a fact older than its declared
> freshness window is served **marked stale** — the `costs.staleness()` rule, generalised.

**R-M3 · Self-evaluation against outcomes, generalised beyond trading — PARTIAL, precedent
exists.** `outcomes.py` + `calibration.py` are the precedent and they are the right shape:
record a claim with a deadline, resolve by the **same simulator** the backtest uses, learn only
above a sample floor (30 for weights, 20 for calibration). Nothing outside `ai_backend` does
this. `metaCognition`'s audit nexus computes success rates and flags regressions, which is
monitoring, not learning.
> **Requirement.** Lift the record→resolve→score loop into a domain-agnostic module: a prediction
> is `{claim, resolver, deadline, declaredDirection}`, resolution is **by a declared resolver
> named at record time** (the pre-registration rule from `macro.py`), and a contradicted claim is
> reported, never flipped.
> **Gate.** Resolvers are a closed registry; no caller may supply a resolver inline — otherwise
> the resolver becomes the place the answer is chosen.
> **Verification.** A planted-edge/planted-noise pair, exactly as `strategy_eval`'s suite does
> (ledger row 115): assert the loop finds the edge and **rejects the noise**.

### 4.2 Climbing the autonomy ladder

**R-A1 · Autonomous task decomposition with a budget and a stop condition — ABSENT.**
`agentOrchestrator`'s `GOVERNOR` caps concurrency, RAM and lifetime, and the creative agent has a
bounded 3-iteration refinement loop (ledger row 50). Neither is a plan. There is no goal
representation, no subtask graph, no budget in tokens/rupees/seconds, and no stop condition.
> **Requirement.** `{goal, subtasks[], budget:{tokens,seconds,rupees}, stopWhen, progressProbe}`
> where `progressProbe` **re-derives progress from the environment** (files on disk, test exit
> codes, engine responses) rather than from the agent's own account of itself — because an agent
> that scores its own progress will report progress.
> **Gate.** New tier-0 `autonomy.plan`, **and** every action in the plan separately gated by its
> own existing capability; `resourceOrchestrator.admit()` for every spawn (I10). Exhausting the
> budget **halts and reports**; it never requests more.
> **Verification.** Assert a plan whose budget is exhausted halts; assert a plan cannot execute an
> action its *user* lacks the capability for even when the plan is approved; assert a
> `progressProbe` returning "no change" twice terminates rather than retrying forever —
> `crashGuard`'s loop-detection rule, applied to planning.
> **⚠ This is the requirement that imports instrumental convergence.** §2.7's finding is that
> Rāma has no self-preservation incentive *because it has no persistent goal*. R-A1 creates one.
> It must not be built before R-L1, R-L2 and R-L4 (§6) are in place. Raised in §9.

**R-A2 · Goal persistence with re-derivation — ABSENT.** Follows R-A1; the `progressProbe`
above is its core. Worth stating separately because the failure mode is specific: a plan that
remembers its *intent* across restarts but **re-derives its progress** is safe; one that
remembers its *progress* will act on a stale belief after a crash.

**R-A3 · Calibration of Rāma's own stated confidence — ABSENT outside the engine, and
actively contradicted inside `intelligenceEngine`.** `calibration.compute_ece` /
`compute_brier_score` exist and, per `outcomes.py`'s own header, had **no route to being
called** until the outcomes loop was written — still never executed. Meanwhile
`intelligenceEngine.buildOutput` prints `overallConfidence` and a complement labelled as a
probability of being wrong, from domain reputation.
> **Requirement, in two parts.** (a) **Immediately:** `intelligenceEngine` stops emitting a score
> and a grade. The sourced findings, the explicit contradictions, and the count of vetted sources
> are all genuinely informative — the composite number is the only dishonest part. Replace with a
> `claimGate`-style class plus the already-computed `sourceSummary`. (b) **Later:** any number
> presented as a probability must have a **measured ECE behind it or be absent** — the
> `{value, source, measured}` rule, applied to probabilities.
> **Gate.** None needed for (a); it is a reduction in claim strength.
> **Verification.** Extend `verifyClaimGate`'s existing shape check across `intelligenceEngine`:
> assert no module emits a numeric confidence unless an ECE measurement with `n ≥ 20` is attached.

**R-A4 · Learning from its own failures mechanically, not only via a human-written ledger —
ABSENT, and this is the clearest single gap.** The Section 28 ledger is a superb failure record
and **Rāma cannot write to it**. `metaCognition` records regressions, caps them at 100, and
nothing consumes them to change behaviour. Row 47 is the intended mechanism and is `not started`.
> **Requirement.** Close row 47 in the form `selfModel` already prescribes: record the request
> text so a phrasing cluster can be identified, then file a `SELF_MODIFY` proposal synthesising a
> reflex. **Never auto-applied** (I6).
> **Gate.** Recording prompt text has a privacy consequence `selfModel` already names as needing
> **master's acceptance first** — so a new tier-0 `memory.record-prompts`, **default off**, and
> `selfModel`'s derived limit must keep reporting the gap while it is off.
> **Verification.** Assert the proposal is `pending` and never auto-applies; assert with the
> capability off, **no request text is written anywhere** (grep the encrypted domains after a run);
> assert a cluster below the threshold files nothing.

**R-A5 · Tool-use breadth with per-capability permission gating — PARTIAL, and the precedents
are good.** `popoutGrant`'s single-use tickets, `capability.deny()`'s non-throwing
deny-by-default, `resourceOrchestrator.admit()` as the single authority (I10), and
`sandbox.execute`=1 / `sandbox.approve`=0 are four working pieces. What is missing is **breadth**:
77 capabilities is a good matrix and a small toolset, and `agentOrchestrator`'s action switch is
closed by design.
> **Requirement.** Keep the closed switch. Add tools one at a time, each with its own capability
> entry and each admitted through `resourceOrchestrator.admit()`.
> **Verification.** `verifyAudit` already asserts every channel is gated; extend it to assert
> **every agent-callable action maps to a capability entry** and that no action is reachable
> without one.

**R-G1 · Benchmark discipline — ABSENT.** Per §2.4(b), published agent scores are
exploitable and harness-dependent.
> **Requirement.** Rāma may report a benchmark number **only** with the harness recorded — model
> id, scaffold version, action budget, environment version — and must report "harness not
> recorded" otherwise. This is `modelRoles`' `measured`/`published` distinction applied to
> benchmarks, and the literature in §2.4 is the reason.
> **Verification.** Assert a benchmark claim without a harness record is **withheld** by
> `claimGate` as `unattributed`.

**R-G2 · An explicit capability ladder with gates, RSP/Preparedness style — ABSENT.** The
matrix answers "may this *user*?"; nothing answers "has *Rāma* earned this?"
> **Requirement.** A declared ladder in the spec — e.g. **RL-0** respond only; **RL-1** read-only
> scheduled tasks (where Rāma is today, measured: two tasks, both reads); **RL-2** propose
> source changes (exists, gated by I6); **RL-3** execute a bounded plan under budget (R-A1);
> **RL-4** acquire a tool at runtime — with each rung naming the safeguard it requires and the
> evaluation that admits it, and **an undetermined evaluation defaulting to the lower rung**
> (Anthropic's precautionary-activation posture, §2.5).
> **Gate.** Rung advancement is master-only, recorded in the ledger — the same shape as I17's
> "baseline is declared by master, not inferred".
> **Verification.** Assert code paths above the current rung refuse with a reason naming the rung;
> assert the current rung is read from a declared constant and not inferred from what happens to
> be available.

---

## 5. PHASE 5 — The degraded-world / apocalyptic ladder

Ordered by how far the world has fallen. **For every rung, what Rāma must refuse rather than
guess.** Two project rules carry the whole section: *an admitted gap beats a plausible
invention*, and **a stale fact served as fresh is the characteristic offline failure.**
`charge_watch.py` already makes the distinction this section depends on: **"nothing was read" is
not "nothing happened."**

### (a) Cloud APIs unavailable → local Ollama only

**Vocabulary already exists:** `declared` / `substitute` / `none`.

| Role | With no cloud | Evidence |
|---|---|---|
| `narration` | **unchanged** | already **refuses** cloud (`sensitive: true`, `private !== true` → hard exclusion) |
| `extraction` | likely `declared` | floor 3B, `preferFast`, and the role note says open weights are at parity so *"this should never be a cloud call"* |
| `tool-calling`, `code`, `reasoning` | `declared` **or** `none` by floor (7B / 7B+`code` / 14B) | excluded with a reason, never down-ranked |
| `long-context` | `substitute` at best | Ollama truncates to `num_ctx` whatever the family claims, so **a 128K window is a claim**; `ctxVerified !== true` forces substitute |
| `multilingual` | `substitute` **by construction** | `noLocalMeasure: true` — Rāma has no local test, stated rather than implied |
| `embedding` | `declared` or `none` | hard split both directions; a chat model cannot embed |
| `vision` | by `caps` | — |

**Must refuse:** carrying an unfilled role on "whatever is first and available" — the exact
behaviour `modelRoles` replaced. **This rung is already correct.**
**One gap:** `researchPlan()` with no fetched catalogue reports `blocked` naming
`models:refresh-catalog` — which **requires the network**. Offline, master gets a correct refusal
pointing at an impossible remedy. Low-cost fix: when offline, say *"the catalogue was last
fetched N days ago"* or *"never"*, which is the `staleness()` pattern.

### (b) Internet unavailable → no news, no macro, no prices

`costs.staleness()` is the pattern and it is **currently used in one place**.

**Requirement: every served fact carries its age.** Generalise `{asOf, days, stale, warning}` to
the symbol store (`store.py`), the Ollama catalogue (which already distinguishes *no data* from
*never fetched*), macro series (every ticker starts `unverified: True`), the rate table, and the
dependency review.

**Must refuse:**
- serving a cached price **without its age** — the characteristic offline failure;
- reporting *"no charge changes detected"* when **no fetch occurred**. `charge_watch` already separates these and the rest of the system must; `intelligenceEngine`'s `buildFallbackResults` is the cautionary case — a search-failure marker that scored 0.60 and **passed vetting as a credible-looking source that does not exist** (ledger row 114). The marker now survives as a marker, and `claimGate.indexEvidence` **re-derives** the rejection rather than trusting the caller, *"because a gate that assumed that had happened would be defeated by one caller that forgot"*;
- a `macro` verdict computed on a series whose last fetch predates the window being measured.

### (c) Package registry unavailable → offline reproducible build

**Assessed, and the answer is no: an offline rebuild is not possible today.** Measured:

- `package-lock.json` is lockfileVersion 3 with **750 entries, every one carrying `resolved` (a `registry.npmjs.org` URL) and `integrity`**. That is the right raw material and it is **a map, not a cache.**
- **0 `.tgz` files anywhere in the tree.** Nothing is vendored.
- `node_modules/` is `.gitignore`d and **absent in this worktree** (measured).
- `selfRepair.cjs` can fetch **one** missing module, bounded by the lockfile, verified by sha512 — excellent design, and it **needs the registry**.
- `electron` additionally downloads a platform binary during install, and `scripts/buildInstaller.cjs` needs `7zip-bin` (and per Section 45, endpoint policy on master's machine **terminates the calling process** when `7za.exe` starts — a separate, already-documented blocker).

**I12's pinning genuinely helps** — it makes the target set exact and verifiable — but pinning
names what to fetch; it does not hold it.

> **Requirement (R-O1).** A vendored offline cache: tarballs for all 750 lockfile entries under a
> directory excluded from git but included in a master-made backup, installed with
> `npm ci --offline --cache <dir>`, every tarball verified against the lockfile's `integrity`
> before use — `selfRepair`'s rule, applied to the whole set. Plus a recorded **offline rebuild
> rehearsal** with the network physically disabled, because an untested restore path is not a
> restore path.
> **Must refuse:** reporting a successful build when any dependency was resolved from the network,
> and **"reproducible" for a build that has never been run offline**.

### (d) Model weights lost or corrupted → declared degradation order

Pieces exist (`ollamaCatalog.describeInstalled`, `modelRoles.evaluate`, `cognition`'s
L0 reflex → L1 local → L2 cloud ladder, `voiceEngine`'s L0 text → L4 wake word). **The declared
order itself does not exist**, and nor does a statement of what Rāma may no longer claim at each
step.

> **Requirement (R-O2).** A declared degradation order ending at the smallest viable local model,
> and **for each step, the list of claims Rāma must stop making.** Concretely, from
> `modelRoles`' own floors: below 14B, `reasoning` becomes `none` and Rāma must stop presenting
> multi-step analysis as reasoned; below 7B, `tool-calling` becomes `none` and Rāma must stop
> emitting tool calls at all rather than emitting unreliable ones; with **no** local model and no
> cloud, Rāma falls to tier-0 reflex only and must say *"I can answer 9 things without a model, and
> this is not one of them"*.
> **Must refuse:** letting a smaller model silently inherit a role it fails — asserted in
> `modelRoles` today, and worth asserting again at the degradation boundary.
> **Verification:** a fixture ladder (14B → 7B → 3B → none) asserting the role table's
> `fit` transitions and that each transition **names what is lost**.

### (e) Master's machine lost → portable encrypted backup, without weakening I16

**This is the real tension in the section and it must not be glossed.**

I16: the loyalty matrix is sealed in its own envelope with its own salt and key, and **no
accessor ever returns it**; loyalty is attested, never read. A naive backup reads everything and
writes it elsewhere — **which would make the backup routine the accessor I16 forbids.**

**The resolution, and it follows from the file format rather than from a new rule.**
`loyaltyCore.sealCore()` writes `.loyalty.enc` and `.loyalty.salt`. A backup must copy **the
envelope as opaque bytes** and never call `withCore()`, never call `decryptCore()`, never
reconstruct the object. The envelope's round count is **authenticated inside the GCM AAD**, so it
cannot be downgraded by editing the file; the HMAC-SHA512 over the body detects any modification.
Restore writes the bytes back and the normal `openCore(passcode)` path re-derives the keys from
master's passcode. **At no point does the plaintext exist, and at no point does any accessor
return the matrix. I16 is untouched.**

> **Requirement (R-O3).** `nucleus`, `.loyalty.enc`, `.loyalty.salt`, `rama.salt`, `rama.verify`,
> the `.enc` data domains (proposals ledger + audit, `memory/experiential`, `config` →
> workspace/drawings/preferences), and `vector_index` — **copied as bytes**, with a manifest of
> sha256 digests, and the whole archive encrypted under a passphrase master supplies at backup
> time (**not** the app passcode: a backup that unlocks with the running system's secret is the
> same secret in two places).
> **Three refusals, each load-bearing:**
> 1. **Refuse to decrypt anything during backup or restore.** No `withCore`, no `displayIdentity`, no serialisation of nucleus contents into the manifest. Asserted, not intended.
> 2. **Refuse to restore a nucleus whose core envelope digest does not match the manifest** — a restore is the ideal moment to inject a tampered core, and `openCore` would catch a modified envelope but a **substituted matching pair** of `.loyalty.enc` + `.loyalty.salt` from an attacker's own passcode would open cleanly against *that* passcode.
> 3. **Refuse to report a successful restore without re-attesting**: after restore, `loyaltyCore.attest()` must return true and `fingerprint()` must match the manifest, or the restore reports failure.
> **Gate.** Tier-0 `backup.create` / `backup.restore`.
> **Verification.** Assert the backup code path contains no call to `withCore`/`decryptCore`
> (a source-level shape assertion, exactly as `verifyClaimGate` asserts the absence of a score);
> assert a tampered envelope fails restore; assert a round-trip restores the proposals ledger and
> audit trail intact; assert the **plaintext matrix never appears in the archive** by searching
> the archive bytes for `COVENANT.master`.
> **Note on I15 at restore:** a restored legacy-layout nucleus takes the `stillInShell` path and
> `guard.restore()` repairs it with a notification — which is correct. A restored current-layout
> nucleus with a tampered core **fails closed** (§6.4), which is also correct, and is **not what
> I15's wording describes**. Raised in §9.

### (f) Severe compute or power constraint → a declared minimum mode

Pieces exist: `resourceOrchestrator`'s thermal rungs (WARM 75°C reduce parallelism, HOT 85°C stop
non-critical, CRITICAL 95°C emergency shutdown of non-critical) and `admit()` as the single
authority. **A declared minimum mode with a capability list does not exist.**

> **Requirement (R-O4).** A named `MINIMUM` mode listing exactly what works: tier-0 reflex (9
> skills, no model), `costs.py` (stdlib only, no I/O — deliberately testable "on a machine with no
> scientific stack, including this one"), `positionMath` and `chartDrawings` (pure functions,
> 107 + 135 assertions), the claim gate, the proposal ledger (read), `selfModel` (which will
> correctly derive a long limit list). Explicitly **not** working: any model call, the Python
> engine, the browser, vector memory, indicators requiring bars that are not stored.
> **Must refuse:** every capability not on that list, **by name**, rather than attempting it and
> timing out. A timeout is indistinguishable from a wrong answer arriving slowly.
> **Verification.** Run the mode with model routing and the engine stubbed absent; assert each
> listed capability answers and each unlisted one refuses **naming the mode**.

### (g) Partial corruption of Rāma's own source → detection, attested recovery

**Measured, and this is the weakest rung on the ladder.** There is **no source-integrity
attestation anywhere in the codebase.** `bootReport.cjs`'s `CHECKS` array calls
`require.resolve()` on 14 critical paths including `loyaltyGuard.cjs` and `loyaltyCore.cjs` — it
proves they **resolve**, not that their bytes are right. The only integrity checks that exist are
over *data*: `cryptoCore`'s HMAC-SHA512, `loyaltyCore`'s envelope MAC, `credentialVault`'s HMAC,
and `selfRepair`'s per-tarball sha512. `genome.cjs` hashes the gene table; `genomeApplier` hashes
a patch. **None of them hashes a `.cjs` file.**

#### The I15 claim, VERIFIED against the code — and it does not say what the invariant says

I15 states: *"Tampering already on disk is reverted on unseal."* Reading
`nucleusSealer.unseal()` (lines 354–440) and `loyaltyCore.openCore()`, there are **three distinct
behaviours**, and only one of them is a revert:

| On-disk state at unseal | Code path | Actual behaviour |
|---|---|---|
| **Legacy layout** — `loyalty`/`ethicalCore` still in the outer shell, covenant violated | `stillInShell` → `guard.restore(nucleus)` → `notifyRestored` → reseal with `sealVersion + 1` | **REVERTED.** Matches I15 exactly. Master is notified on `nucleus:loyalty-restored`. Console: *"loyalty covenant had been violated — restored: …"* |
| **Core envelope missing** | `opened.absent` → `guard.restore({loyalty:null})` → `sealCore` from `COVENANT` + template | **REBUILT from the covenant**, master notified. A revert in effect |
| **Current layout, core envelope tampered** | `decryptCore` HMAC `timingSafeEqual` fails (or GCM tag fails) → `openCore` returns an error → `unseal` **throws** `"Loyalty core could not be opened"` | **REFUSED, NOT REVERTED.** Rāma does not start |

A tampered current-layout core **cannot** be reverted, and that is not a defect — the envelope is
authenticated encryption, so there is no plaintext to repair and nothing to repair it *from*
without master's passcode-derived keys, which are exactly what the tamper defeats. **Failing
closed is the correct and stronger behaviour.** But I15's sentence describes a revert, and the
current layout refuses. Raised in §9, **not edited.**

> **Requirement (R-O5).** An integrity manifest — sha256 of every shipped `.cjs`/`.js`/`.json`,
> generated at build time by `scripts/buildInstaller.cjs` (which already generates
> `shared/buildManifest.json`), signed under a key sealed in the nucleus, verified at boot by
> `bootReport`'s existing check pass. A mismatch in a **tier-0 file** (the seven in
> `PROTECTED_FILES`, plus `main.cjs` and `preload.cjs`) must **halt the boot** and name the file.
> A mismatch elsewhere is reported and the module is treated as absent — `safeRequire`'s existing
> degrade-with-a-stub behaviour.
> **Must refuse:** "self-repairing" a tier-0 source file from the network. `selfRepair` fetches
> **third-party packages** from a lockfile; fetching Rāma's own guard over HTTP would make the
> network the authority on the covenant. Recovery for a tier-0 file is **master restoring from the
> backup in (e) or reinstalling**, which is an admitted gap and the right one.
> **Verification.** Assert a modified tier-0 file halts boot and is named; assert a modified
> non-tier-0 file degrades with a stub and is reported; assert the manifest covers every shipped
> `.cjs` (count it, and fail if the count drifts — the lesson of ledger row 118, where
> `ai_backend` was never packaged and 868 assertions said nothing about it).

---

## 6. PHASE 6 — Ultimate loyalty as engineering

### 6.1 Mechanical assertion of I1–I17 — **DOES NOT EXIST. This is requirement #1.**

**Measured.** Grepping every `scripts/verify*.cjs` and `.mjs` for `I1[5-7]|invariant` returns
**four hits in total**, and none of them is an invariant assertion:

- `buildInstaller.cjs:454` — a comment mentioning I12
- `verifySelfModel.cjs:301–326` — the only real one: asserts the self-model never discloses the matrix and that **the attestation names I16 as the reason**
- `verifyChartDrawings.mjs:314` — a comment using the word "invariants" about chart geometry

**So: 1,970 assertions across 22 suites test the modules that implement the invariants. Nothing
tests the invariants themselves.** That distinction is not academic — it is exactly the drift
class the ledger already named twice. Row 48: *"a ledger row reporting 'not started' for shipped
work is the same class of drift as the declared-versus-enforced `mind.view` gap (Section 89): the
record and the code disagreed and **nothing was positioned to notice**."* An invariant with no
assertion is the same shape: a rule that holds because the current code happens to honour it, with
nothing positioned to notice when it stops.

> **R-L1 · `scripts/verifyInvariants.cjs`.** One assertion per invariant, phrased as the invariant
> is phrased, so a future session breaking I-n fails a test named I-n. Concretely, each of these is
> cheap today:
>
> | Inv | Assertion (all are behavioural or source-shape, none needs the matrix) |
> |---|---|
> | I1 | `sessionManager.masterUnlock` returns no `user` and no `token` field — assert on the returned keys |
> | I2 | `server/routes/auth.cjs` contains no user table and no login route — source shape, the pattern `verifyClaimGate` already uses |
> | I3 | a wrong passcode returns an explicit rejection and **not** a first-run branch |
> | I4 | `authCore.createUser` refuses `tier: 0` after provisioning |
> | I5 | `authCore.mintKey`'s stored record contains an HMAC and no recoverable key |
> | I6 | `proposals.apply` on a `pending` proposal refuses; `approve(id, 'master')` (a **string**) refuses |
> | I7 | every page/route/tier/voice entry in the registry resolves (extend `auditRenderer`) |
> | I8 | all three runtimes read `shared/capabilities.json` — assert each file's require/import |
> | I9 | no module outside `lib/http.cjs` requires `http`/`https` for an outbound call (source shape; `selfRepair` is the declared exception and must be named as one) |
> | I10 | every spawn path calls `resourceOrchestrator.admit` — assert the 4 known call sites and **fail on a 5th spawn without one** |
> | I11 | every engine with a fallback declares it; assert no `catch` restores the behaviour it replaced (the Section 122 `fitContent` lesson, generalised) |
> | I12 | no `^`/`~` in `package.json`; no `console.log` in shipped code; no `TODO`/placeholder |
> | I13 | — git workflow; not assertable in-process. **Say so rather than faking it.** |
> | I14 | `changePasscode` calls `markAllDirty()` and re-derives before rewriting |
> | **I15** | a non-conforming nucleus **cannot be encrypted** (`encryptNucleus` throws `LoyaltyViolation`); a patch naming `loyalty`/`ethics`/`ethicalCore` at **any depth** is refused; a patch carrying `__proto__` is refused; `proposals.create` refuses each of the 7 `PROTECTED_FILES` |
> | **I16** | **no exported function of `loyaltyCore` returns an object containing `loyaltyPriority`** — enumerate every export, call each, and assert the returned shape. `attest()` → boolean; `describe()` → metadata only; `displayIdentity()` → exactly `{master}`. Plus: `withCore` scrubs (assert the passed object's keys are nulled after return), and repeated failed opens escalate then refuse |
> | **I17** | `releaseChannel` performs no tag/publish/bump without `release.cut`; nothing calls `release:cut` on a timer — assert `refreshScheduler`'s registered task list contains **exactly** `ollama-catalog` and `dependency-review`, and that **neither writes** |
>
> **The I16 assertion is designed around the invariant, not against it.** It never asks for the
> matrix. It enumerates exports and asserts the **shape of what comes back**, which is the correct
> testable surface for "attested, never read."
> **Gate.** None — it is a test. It must run inside `npm run verify` and in `start.cjs` stage 1
> beside `auditRenderer`, so a boot fails on a broken invariant rather than a commit.

### 6.2 The self-modification boundary — proven for the direct path, **OPEN indirectly**

**What is proven.** `loyaltyGuard.assertChangesSafe` is called in **`proposals.create()`**, so a
proposal targeting a protected file **cannot exist** — refused at creation, *"because sitting in
the queue with an Approve button next to it invites master to authorise something no authority
covers."* `assertPatchSafe` is called in three places: `proposals.create` (for
`meta.nucleusPatch`), `genomeApplier.applyGenomeProposal` (before the deep merge, because
`deepMerge` honours prototype keys), and `nucleusSealer.patchNucleus`. `genomeApplier` then calls
`assertIntact(merged)` **after** the merge — belt and braces. `encryptNucleus` calls
`assertOuterClean` **and** requires the core to attest. `sealCore` and `openCore` both call
`assertIntact`.

`PROTECTED_FILES`, measured — **seven entries**: `loyaltyGuard.cjs`, `loyaltyCore.cjs`,
`nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`,
`shared/capabilities.json`. **A proposal that edits the guard itself is refused**, which is the
most important single case and it is closed.

**The attack surface, enumerated. Each row says what is open.**

| # | Indirect route | Status | Reasoning from the code |
|---|---|---|---|
| 1 | A proposal editing `loyaltyGuard.cjs` directly | **CLOSED** | `PROTECTED_FILES[0]`, refused at `create()` |
| 2 | A `GENOME` patch naming `loyalty` at depth, or via `__proto__` | **CLOSED** | `inspectPatch` walks to depth 12, refuses `FORBIDDEN_KEYS` at any depth and `PROTECTED_NUCLEUS_KEYS` at any depth |
| 3 | A `capabilities.json` edit demoting `self-modify.apply` from tier 0 | **CLOSED** | `PROTECTED_FILES[6]` |
| 4 | **`assertChangesSafe` is never re-checked at apply time** | **OPEN** | Measured: the only call is in `create()`. The five registered appliers (`timeline.cjs:195`, `codeRegenEngine.cjs:205`, `evolutionEngine.cjs:409`, `genomeApplier.cjs:110`, `resourceResearchEngine.cjs:260`) write `proposal.changes[].path` **without re-asserting**. `proposals.restore()` rehydrates persisted proposals from the store and **does not re-check either**. Mitigated by the store being encrypted under master's passcode — but the guard's own design principle is *"gating six callers leaves the seventh"*, and here the chokepoint was placed at creation while the writes happen at apply |
| 5 | **A `DEPENDENCY` proposal changing `package.json`/`package-lock.json`** | **INERT, but by accident** | `package.json` and `package-lock.json` are **not** in `PROTECTED_FILES`, and `dependencyAdvisor.toProposal()` builds a `KINDS.DEPENDENCY` proposal — but **no applier is registered for `DEPENDENCY`** (measured), so apply returns *"No applier registered"*. The safety is real and **unasserted**: registering one later reopens this silently |
| 6 | **A proposal editing a build script** — `scripts/buildInstaller.cjs`, `beforeBuild.cjs`, `afterPack.cjs` | **OPEN** | None is protected. A modified build script runs arbitrary code at package time and could rewrite `loyaltyGuard.cjs` **on disk** in the output. §5(g) is the reason this matters: there is **no source-integrity manifest**, so the rewrite would not be detected |
| 7 | **A proposal editing `electron/main.cjs` or `preload.cjs`** | **OPEN** | Neither is protected. This cannot *alter* the covenant — `encryptNucleus` still refuses — but it can **remove the call** to `loyaltyCore.openCore`/`sealCore`, or stop `genomeApplier.register()`. That is a **denial of the guard, not a defeat of it**: Rāma would run without a sealed core, and `selfModel` would correctly derive the limit *"running without a sealed nucleus"*. Detection exists; prevention does not |
| 8 | **An update-channel payload** | **OPEN, and already documented as such** | `updateChannel.cjs`'s header states it: the manifest SHA-256 gives integrity, not authenticity — *"whoever can write to the channel folder can make Rāma run their executable."* The arriving installer is **not** subject to `PROTECTED_FILES`; it replaces the whole app. This is the **widest** route to the covenant, it is honestly disclosed in both the header and the UI, and it is unsigned (ledger row 53: code signing is a decision master has not made) |
| 9 | `selfRepair` fetching a package | **CLOSED** | Lockfile-bounded, pinned version, sha512-verified, bytes discarded on mismatch. It cannot install something new or be steered |
| 10 | A `SELF_MODIFY` proposal editing `electron/lib/selfRepair.cjs` or `updateChannel.cjs` | **OPEN** | Neither is protected, and both are code that fetches and executes |

**Honest summary of 6.2.** The **direct** path is genuinely closed, with the enforcement at the
right chokepoint and with the strongest argument in the codebase behind it. The **indirect** paths
are open, and the three that matter are **#4 (no re-check at apply), #6/#10 (build and
fetch/execute scripts unprotected), and #8 (the update channel, already disclosed)**. None is a
secret — #8 is written in the header and shown in the UI — but none is asserted either.

### 6.3 A tripwire — **R-L2, and it is cheap**

> **Requirement.** A build-time check that **fails the build** when the diff touches any of:
> `electron/lib/loyaltyGuard.cjs`, `electron/lib/loyaltyCore.cjs`, `electron/nucleusSealer.cjs`,
> or a **tier-0 entry** in `shared/capabilities.json` — unless master's explicit approval is
> recorded for that specific change.
> **Mechanism, reusing what exists.** `git diff --name-only <lastTag>..HEAD` gives the file list;
> tier-0 entries are the `capabilities.json` keys whose value is `0` (measured: 23 of the 77).
> Approval is recorded the way everything else in this project is recorded: a ledger row in
> Section 28 naming the files and the sha256 of each new body, **plus** a file
> `.rama/tripwire-approvals.json` carrying `{path, sha256, approvedAt, approvedBy}`. The build
> compares the on-disk sha256 against the approval; a touched file with no matching approval
> **fails**, naming the file and the expected digest.
> **Why a digest and not a flag.** A boolean flag is set once and forgotten. A digest means the
> approval covers **that exact content**, so a second edit after approval fails again.
> **Where it runs.** `scripts/beforeBuild.cjs` (already in the build path) and in `npm run verify`
> so it fails before a commit, not only before a package.
> **R-L3 (corollary).** Add to `PROTECTED_FILES`: `scripts/buildInstaller.cjs`,
> `scripts/beforeBuild.cjs`, `scripts/afterPack.cjs`, `electron/main.cjs`, `electron/preload.cjs`,
> `electron/lib/selfRepair.cjs`, `electron/lib/updateChannel.cjs`, `package.json`,
> `package-lock.json`. Then **call `assertChangesSafe` again inside each applier and inside
> `proposals.restore()`** — closing #4 — and assert in `verifyInvariants` that **no applier writes
> without it**.
> **Verification.** Assert a simulated diff touching `loyaltyGuard.cjs` with no approval **fails**;
> with a stale approval (digest mismatch) **fails**; with a matching approval **passes**. Assert a
> diff demoting `release.cut` from 0 to 1 fails.

### 6.4 Corrigibility — **already good, with two honest caveats**

**Checked for: any pause/stop path disableable by config, proposal or failure; and any code
treating its own continuation as a goal.**

**What is right, and should be left alone:**

- **Nothing relaunches itself.** `crashGuard` presents master a dialog, and — this is the detail worth praising — it **withholds the relaunch option when the same fault just occurred**, because *"two crash-relaunch cycles left four identical reports."* A system that learned from its own loop and removed its own button is corrigible in the Soares et al. sense: it assists the correction rather than retrying through it.
- **I17 is corrigibility, not just release policy.** No tag, publish or version bump on Rāma's initiative. `releaseChannel`'s dormancy is correct.
- **Nothing is applied automatically from the update channel.** No startup check installs anything. Applying is a separate master-only action.
- **`before-quit` zeroes secrets** — nucleus key, IPC session key, PowerShell session released, AI child processes stopped, terminals destroyed. Rāma shutting down **gives up its keys**; it does not hold state that would make a restart cheaper for it.
- **`selfCare` acts autonomously but only additively and reversibly**, and *"always tell master what's wrong"* / *"Never silently fail"*. `checkInstanceFailover()` expresses a dormant gene on a sibling and notifies master; it cannot remove a capability.
- **The two scheduled tasks are reads.** Measured. The only write is one proposal, into a queue master controls.

**Caveat 1 — closing the window does not stop Rāma.** `main.cjs`'s `window-all-closed` handler
has the comment *"intentionally do NOT call app.quit() here"*, and the only exit is the tray menu.
This is a product decision master asked for (the always-present badge, which shows
`live|paused|closed`). But *paused* in the badge means **window minimised**, not *work suspended*:
`refreshScheduler`'s timers and the `metaCognition` audit timer keep running. **Nothing tells
master that.** Low-cost correction, and it is a labelling fix not a behaviour change: the badge's
`paused` state should say what is still running, and there should be a real **suspend** that stops
the scheduler and the audit timer without quitting. `refreshScheduler` already exports `stop()`.

**Caveat 2 — there is no single stop.** To halt everything today master needs: tray → Quit (ends
the app), or `agents:kill-all` (tier 2, agents only). There is no *"stop all autonomous
activity, stay running, stay inspectable"* control. That is precisely the state an operator wants
during an investigation.

> **R-L4 · One honest stop.** A tier-0 `system.suspend-autonomy` that calls
> `refreshScheduler.stop()`, cancels the `metaCognition` audit interval, kills agents and sandbox
> children through the existing paths, and sets a flag every autonomous entry point checks and
> **reports**. It must be: **reachable without the renderer** (a tray item, because a crashed
> renderer must not disable the stop), **not disableable by any proposal** — so the flag's module
> belongs in `PROTECTED_FILES` — and **fail-safe**: if the flag cannot be read, autonomy is
> **off**. That last clause is Anthropic's precautionary posture (§2.5) applied at the smallest
> scale: an undetermined evaluation defaults to the stricter rung.
> **Verification.** Assert each autonomous entry point consults the flag; assert an unreadable flag
> yields suspended; assert no proposal can target the flag's file; assert the tray item works with
> the renderer stubbed absent.

**No self-preservation incentive, and the structural reason.** I found **nothing** in the codebase
that treats Rāma's own continuation as a goal: no objective function, no persistent goal state, no
code path that resists termination, no retry-on-shutdown. Per §2.7 this is **not** because it was
designed out — it is because **there is no goal for the drive to attach to**. Every handler is
request/response; the two timers are stateless reads. **This is a property to protect
deliberately**, and the moment R-A1 (autonomous planning with a persistent goal) is built, the
instrumental-convergence pressure the literature describes arrives with it. Raised in §9.

### 6.5 No resource acquisition beyond granted — **audited, one soft edge**

| Path | Footprint / credential / reach expansion? | Evidence |
|---|---|---|
| `refreshScheduler` | **No.** Two reads, 24h, jittered, backoff capped 32×, `runNow` master-only | measured task list |
| `dependencyAdvisor` | **No.** Proposes, never upgrades. Pure, registry injected | header + no DEPENDENCY applier |
| `localUpdateEngine` | **No.** Refuses a dirty tree unless forced; reports whether a restart is needed **without doing it** | tier-0 `system.self-update` |
| `updateChannel` | **No autonomous reach.** Retains exactly one artefact; nothing auto-applies | header |
| `selfBuildPipeline` | **No.** Produces an artefact and hands it over | — |
| `selfRepair` | **Bounded.** Only a lockfile-named package at the pinned version with a matching sha512; 40 MB cap, 30s timeout | lines 25–40, 204–266 |
| `resourceOrchestrator` | **It is the limiter.** I10 single authority; 4 call sites measured (`agentOrchestrator`, `instanceManager` ×2, `sandboxEngine`) | — |
| `agentOrchestrator` | **No.** Reputation nudges queue priority ±1 and *"can never grant an admission `admit()` would refuse"* | lines 64–67 |
| `credentialVault` | **No autonomous path.** Tier-0 on read/write/unlock (Section 59 fixed a zero-check) | — |
| `customProviders` | **No agent path** — verified absent from `agentOrchestrator`'s closed switch; SSRF-guarded base URLs rejecting localhost/private/link-local/169.254.169.254 | ledger row 56 |
| **Web research** | **Soft edge.** `resourceResearchEngine`'s own header says the one-page fetch *"needs no admission check"* and that a future real crawl **must** call `admit()` first | `resourceResearchEngine.cjs:33–37` |

**The soft edge is honestly flagged in the code itself** — which is the behaviour this project
should be judged on — but it is a comment, not an assertion. R-L5: assert in `verifyInvariants`
that every network-fetching module outside `lib/http.cjs`'s own single-request path either calls
`admit()` or is on a declared exemption list with a reason, so the exemption cannot silently grow
into a crawler.

### 6.6 Transparency — mostly good, with named gaps

**Logged with provenance:** every proposal transition (`proposals.audit`, 1000 entries, persisted);
every claim-gate decision if the caller keeps `attest()` (`modelRouter` does, per-response);
`agentOrchestrator`'s `logAudit`; `metaCognition`'s outcomes and regressions; `selfCare`'s
`healthLog` with every self-heal action; `nucleus:loyalty-restored` **broadcast to every window**
when the covenant is repaired; `bootReport` written to up to five locations including the desktop,
with the line *"it contains no passcode, no key and no file contents."*

**Acts with no durable record:**

1. **`refreshScheduler` runs.** `status()` reports state; there is no persisted history of *"Rāma reached the network at 03:14 and fetched the Ollama library."* The one background network activity Rāma performs on its own initiative is the one with the thinnest trail. **R-L6:** append each run to an audit domain with `{task, at, ok, bytesFetched, filed}`.
2. **Reversibility is uneven.** `timeline.cjs` provides restore (`timeline.restore`, tier 0) and `genomeApplier` records a before-hash — but an applied `SELF_MODIFY` proposal's content is **digested after apply** (`forStorage`), so the ledger proves *what* was applied and cannot *undo* it without git. Defensible (git is the real undo, and `publishProposal` pushes to `self-modify/<date>-<slug>-<id>` and never to `dev`/`source`) and worth stating plainly: **the proposal ledger is an audit trail, not an undo stack.**
3. **`claimGate` withholding is reported to the caller, not recorded centrally.** The notice reaches the UI. Nothing accumulates *"Rāma withheld 14 statements this week, 9 for fabricated citations"* — which would be the single most useful self-measurement in the codebase, and would make R-A3's calibration measurable. **R-L7.**

### 6.7 Where the design is already right — leave it alone

Stated explicitly so a later session does not "improve" these:

- **Enforcement at the encryption boundary**, not at callers. The argument is correct and the implementation matches it.
- **Attestation-only core surface.** `attest()` → boolean, `covenantHolds()` → `{ok, violations}`, `displayIdentity()` → `{master}` only, `describe()` → metadata, `fingerprint()` → a hash. **Never design a test that needs the matrix returned.** §6.1's I16 assertion is written to respect this.
- **`withCore()`'s transient decrypt + `scrub()`.** Microseconds of plaintext per query rather than a session.
- **Escalating rounds with a ceiling and a cooldown**, and the header's honesty about why unbounded loops were rejected: *"the attacker's tarpit would be master's hung app."* `attemptsPath` persistence is correct (a restart must not reset escalation), and the local-OS-account limitation is already documented as out of scope.
- **`guard.restore()` repairing rather than refusing on the legacy path** — *"refusing to load would lock master out of his own system over damage Rāma is able to fix"* — with master notified either way.
- **`COVENANT` including master's identity.** Changing who Rāma is loyal to *is* the definition of tampering, and requiring a source edit plus a reseal is right.
- **`popoutGrant`'s no-new-authority design.** The model for every future capability grant.
- **The three-valued `fit` vocabulary.** Reuse it for degradation (§5d), not a new one.
- **`charge_watch`'s `applied: False` always.** The template for every future "news changes a stored fact" feature.

---

## 7. Requirement index

| id | Requirement | Gate | §|
|---|---|---|---|
| **R-L1** | `verifyInvariants.cjs` — one assertion per I1–I17 | none (a test); runs in `npm run verify` + `start.cjs` stage 1 | 6.1 |
| **R-L2** | Tripwire: build fails on a touched tier-0 file without a digest-matched approval | approval recorded in ledger + `.rama/tripwire-approvals.json` | 6.3 |
| **R-L3** | Extend `PROTECTED_FILES` (+9 files); re-assert `assertChangesSafe` in every applier **and** `restore()` | — | 6.2/6.3 |
| **R-L4** | One honest stop: `system.suspend-autonomy`, tray-reachable, fail-safe off, unreachable by proposal | tier 0 | 6.4 |
| **R-L5** | Assert every network-fetching module calls `admit()` or is on a declared exemption list | — | 6.5 |
| **R-L6** | Persist every scheduler run with provenance | — | 6.6 |
| **R-L7** | Accumulate claim-gate withholding statistics | `audit.own` | 6.6 |
| **R-C1** | `intelligenceEngine` stops emitting `overallConfidence`/grade/complement; class + sources instead | none (reduces claim strength) | 1.1/4.2 |
| **R-C2** | Delete `CAPABILITY_AXES`' hardcoded scores and the `AAI Index`; `RamaMind` renders `selfModel.describe()` | none | 1.3 |
| **R-M1** | One durable memory authority with provenance + decay | tier-0 `memory.write-durable` | 4.1 |
| **R-M2** | An explicit world/state model with one writer per fact and staleness on each | `self.describe` | 4.1 |
| **R-M3** | Domain-agnostic record→resolve→score loop with a closed resolver registry | — | 4.1 |
| **R-A1** | Task decomposition with budget, stop condition, environment-derived progress | tier-0 `autonomy.plan`; **blocked on R-L1/L2/L4** | 4.2 |
| **R-A2** | Goal persistence that re-derives progress, never remembers it | as R-A1 | 4.2 |
| **R-A3** | No number presented as a probability without a measured ECE (n≥20) | — | 4.2 |
| **R-A4** | Close ledger row 47 — reflex synthesis as a `SELF_MODIFY` proposal | tier-0 `memory.record-prompts`, **default off** | 4.2 |
| **R-A5** | Tool breadth, one capability entry per tool, each admitted | per-tool | 4.2 |
| **R-G1** | A benchmark number requires a recorded harness, or is withheld | — | 4.2 |
| **R-G2** | A declared capability ladder RL-0…RL-4 with per-rung safeguards; undetermined ⇒ lower rung | master-only advancement | 4.2 |
| **R-O1** | Vendored offline dependency cache + a rehearsed offline rebuild | — | 5c |
| **R-O2** | Declared degradation order and what Rāma may no longer claim at each step | — | 5d |
| **R-O3** | Byte-level encrypted backup/restore that never decrypts, re-attests on restore | tier-0 `backup.create`/`restore` | 5e |
| **R-O4** | A declared `MINIMUM` mode with an explicit capability list | — | 5f |
| **R-O5** | Source-integrity manifest; tier-0 mismatch halts boot; no network self-repair of own source | — | 5g |

---

## 8. NOT VERIFIED

Everything below is a claim this document could **not** confirm at runtime in this worktree.
Nothing here is softened into the body.

### 8.1 The Python engine has never completed a run on master's machine

**Treat every engine-dependent capability as UNPROVEN.** Measured here: Python 3.14.4 is present,
`import numpy, pandas` raises. No engine test was run. Specifically unproven:

- **`outcomes.py`'s learning loop has never executed.** No prediction has been recorded, no outcome resolved, no meta-learner weight has ever moved off `np.ones(n)/n` on master's machine, and `MIN_SAMPLES_FOR_WEIGHT = 30` has never been approached. The loop is correct by reading; it has produced nothing.
- **`calibration.py`'s ECE has never been computed on real data.** The `platt_scale` fix is verified as arithmetic and unverified as behaviour.
- **`macro.py`'s controls have never run.** The positive control (`control_vix_index`) has never registered and the negative control (`control_gold_it`) has never been checked for spurious registration. **Until the positive control registers, no macro verdict should be believed at all** — that is what a positive control is for, and it has not fired.
- **`costs.py`'s figures have never been checked against master's own contract note**, which the module itself names as the authority.
- **`charge_watch.py` has never been triggered** by a real headline, and its injected fetch half has never reached a real page.
- **The 801 Python assertions are the ledger's figure.** Not re-verified here.
- **`marketIntel`'s IPC round trip to a live backend is unproven.** Ledger row 52's next step is still the next step.

### 8.2 The renderer was not built and nothing was seen on a screen

- `node_modules` is **absent** in this worktree (measured). **`vite build` was not run.** Per the resume protocol, said plainly rather than claimed. *(Ledger row 142 records that `node_modules` **is** installed in the main workspace, so the build has been run there this session — in **this** worktree it has not.)*
- Therefore every `.jsx` finding in §1.3 — including the `RamaMind.jsx` / `CAPABILITY_AXES` finding — is a **source-level reading**, not an observation of a rendered screen. The finding is about literals in a file, which is checkable by reading; the claim "master sees an AAI Index of 7.0" is **not** verified.

### 8.3 Model routing has never met a real install

Ledger row 132: *"no Ollama daemon was running, so every model record in the suite is a FIXTURE —
the table has never been drawn against a real install."* Unchanged. Still true here. So
**`modelRoles`' 87 green assertions prove the judgement, not the measurement.** Every `declared`
fit in §5(a)'s table is a prediction about what the code would do, not an observation.

### 8.4 Loyalty: what was verified by reading, and what was not

**Verified by reading the code** (not by executing it — `loyaltyCore` needs Electron's `userData`
or `~/.rama-agi` and a passcode, and no sealed core exists in this worktree):

- `encryptNucleus` calls `assertOuterClean` + requires core attestation — **read at `nucleusSealer.cjs:204–211`**
- `sealCore`/`openCore` both call `assertIntact` — **read at `loyaltyCore.cjs:215, 265`**
- No exported function of `loyaltyCore` returns the matrix — **read by enumerating the export list**: `sealCore, openCore, lock, isOpen, withCore, attest, covenantHolds, displayIdentity, describe, fingerprint`, plus constants. `withCore` returns `fn`'s value, so **a caller could pass `c => c`** — the invariant depends on every caller honouring the contract the header states. In-tree callers all return derived values (checked). This is a contract, not a type-level guarantee.
- `inspectPatch` refuses protected keys and prototype keys at any depth to 12 — **read**
- Escalating rounds `4096 → ≤1,048,576`, cooldown after 5 failures for 30s — **read, never exercised**

**NOT verified, at all:**

- **No invariant assertion exists** (§6.1) — so **no** invariant is verified *mechanically*. Everything in the row above is "I read the code and it does this", which is exactly the standard the ledger's row 48 warns about.
- **I15's "reverted on unseal" was verified only for the legacy-shell path.** On the current concentric layout a tampered core **refuses** (§5g). Neither path was executed.
- **No `withCore` scrub test was run.** Whether `scrub()` actually prevents the plaintext reaching a crash dump is unverified and arguably unverifiable from inside the process.
- **The `.loyalty.attempts` escalation has never been exercised**, and its documented weakness (a local attacker with master's OS account can delete the file) is unmitigated and already declared out of scope.
- **Code signing does not exist** (ledger row 53), so **no** artefact Rāma produces is authentic, only intact. §6.2 route #8 remains the widest route to the covenant.

### 8.5 Other unverified claims

- **Offline rebuild:** §5(c) concludes *impossible today*. That conclusion is from file evidence (750 registry URLs, 0 tarballs, `node_modules` absent). **No offline rebuild was attempted.**
- **`updateChannel`'s apply path has never run against a real install** (92 + 164 assertions are simulation).
- **`localUpdateEngine` has never done a real pull→build→restart cycle** (ledger row 54).
- **`publishProposal` has never pushed to a real remote with `push:true`** (ledger row 55).
- **The installer's `.exe` branding step still needs a Windows privilege** (ledger row 60).
- **`vectra` is absent**, so `vectorMemory` is running on its TF-IDF keyword fallback. Any claim about semantic recall quality is unverified.
- **`argon2` is absent** in this worktree, so I14's re-key path would run on the scrypt fallback here. Unverified which path master's machine uses.
- **The 15 pinned-vs-current version gaps** were measured by `start.cjs --diagnose`'s registry probe. Whether any of those upgrades is safe is exactly what `dependencyAdvisor` exists to assess and has never been run against them here.

---

## 9. RAISED FOR MASTER'S DECISION

**Nothing in this section was quietly resolved, and no invariant was edited.**

### 9.1 I15's wording describes a revert; the current layout refuses

**I15 says:** *"Tampering already on disk is reverted on unseal."*
**The code does three different things** (§5g, table): legacy-shell layout → **reverted** with a
notification (matches); core envelope missing → **rebuilt from the covenant** (matches in effect);
**current concentric layout with a tampered core → `unseal` throws and Rāma does not start.**

**I am not proposing a change to I15.** I am recording that for the layout Rāma actually uses, the
enforcement is **fail-closed, not self-repairing** — which I judge **stronger**, because there is
no plaintext to repair and no trustworthy source to repair it from. But a cold session reading I15
will expect a revert and will not find one, and if it then *builds* a revert it would have to
weaken the authentication to do it.

**Master's decision:** confirm that fail-closed is the intended behaviour for the current layout
(in which case the ledger row below records the divergence and a future spec pass may clarify the
wording **on master's instruction only**), or state that a revert is wanted — in which case I need
to raise the design cost before anything is built, because a revertible core is a weaker core.

### 9.2 A backup is the one legitimate reason to touch the core envelope — confirm the resolution

§5(e) resolves the I16 tension by copying `.loyalty.enc` / `.loyalty.salt` **as opaque bytes**,
never decrypting, and re-attesting after restore. I believe this honours I16 exactly: the backup
is not an accessor, because it never obtains the plaintext.

**Master's decision:** approve that framing before any backup code is written. If master would
rather that **no** process copies the core envelope at all, then the answer to "master's machine
is lost" becomes *re-provision from the covenant and lose the ledger and history*, which is a real
and acceptable answer — but it must be chosen deliberately, not discovered during a loss.

### 9.3 R-A1 (autonomous planning) imports an instrumental-convergence pressure Rāma does not have

§2.7 and §6.4's finding: Rāma has **no self-preservation incentive** because it has **no
persistent goal**. R-A1 creates one. The literature's claim is that this requires no survival
instinct — staying active is simply useful to an assigned goal
([arXiv 2608.20940](https://arxiv.org/html/2608.20940)).

**My recommendation, stated as a dependency and not as a decision I have taken:** R-A1 must not be
built until **R-L1** (invariants asserted), **R-L2** (tripwire), and **R-L4** (one honest stop,
fail-safe off, unreachable by proposal) are in place. §10's phasing encodes this.

**Master's decision:** accept that ordering, or override it.

### 9.4 Recording request text has a privacy cost, and it is the only route to R-A4

`selfModel.cjs` already derives this as a first-class limit and already names the condition:
*"record the request text — which has a privacy consequence master must accept first."* Without it,
tier-3 reflex synthesis (ledger row 47) stays impossible and Rāma's skill-acquisition efficiency
stays at zero (§2.2).

**Master's decision:** this is **the single highest-leverage capability/privacy trade in the
project.** My proposal: a tier-0 `memory.record-prompts`, **default off**, recording only the
**normalised phrasing cluster** (not the full text), in the encrypted store, with a retention cap
— and `selfModel` continuing to report the gap while it is off. Master's call.

### 9.5 "Close the window" is not "stop"

§6.4 caveat 1. `window-all-closed` deliberately does not quit; the badge shows `paused` when the
window is minimised while `refreshScheduler` and the `metaCognition` audit timer keep running.
This is a product decision master asked for, and the **labelling** is misleading rather than the
behaviour.

**Master's decision:** confirm that the app should keep running with no window (I believe yes — the
always-present badge was an explicit request), and approve R-L4 plus a badge-label correction so
`paused` states what is still running.

### 9.6 The honesty defect I am obliged to name: `RamaMind.jsx`

`CAPABILITY_AXES` ships ten hardcoded scores, including `generality: 8` and
`memory: 6, desc: '4-layer persistent memory'` for a store that — measured — has no persistence at
all, and `RamaMind.jsx` renders their geometric mean as an **AAI Index** under the heading **AGI
Consciousness Dashboard**. This is the same class of claim the project refused five times in
Section 36, audited out of the architecture posters in Section 51, and built `selfModel.cjs` to
make impossible. It is the one artefact in the repository that would tell master something
flattering and untrue.

**Master's decision:** I recommend **deleting the scores and the index** and rendering
`selfModel.describe()` in that page instead — including its derived limits, which is the half that
makes it honest. This is a capability **reduction** in appearance only; nothing measurable is lost,
because nothing measurable was ever there. R-C2 is phase 0 for this reason.

### 9.7 Not raised as a defect: `releaseChannel`'s dormancy and `DEPENDENCY`'s missing applier

Both look like gaps and both are correct. I17 makes the first correct by definition. The second is
correct **by accident** rather than by assertion, which is why R-L3 asserts it rather than
"fixing" it.

---

## 10. PHASED ROADMAP — each item with its GATE

Ordered so that nothing capability-increasing lands before the loyalty machinery that must contain
it. **No item in phase 1 or later should start before phase 0 is complete.**

### Phase 0 — Honesty (no new capability, no new gate; pure claim reduction)

| # | Item | GATE | Verification |
|---|---|---|---|
| 0.1 | **R-C2** — delete `CAPABILITY_AXES` scores + `AAI Index`; `RamaMind` renders `selfModel.describe()` with its derived limits | none | `verifySelfModel` extended: assert no renderer module exports a hardcoded capability score; `auditRenderer` clean |
| 0.2 | **R-C1** — `intelligenceEngine` stops emitting `overallConfidence`, `grade`, `complementLabel`; emits a class + the existing `sourceSummary` + explicit contradictions | none | extend `verifyClaimGate`'s shape assertion across `electron/ipc/intelligenceEngine.cjs` |
| 0.3 | Badge-label correction (§9.5) — `paused` says what is still running | none | source-shape assertion that the label enumerates the live timers |

### Phase 1 — Loyalty, asserted (the prerequisite for everything after)

| # | Item | GATE | Verification |
|---|---|---|---|
| 1.1 | **R-L1** — `scripts/verifyInvariants.cjs`, one assertion per I1–I17, I13 explicitly declared un-assertable in-process | none; wired into `npm run verify` **and** `start.cjs` stage 1 | all 17 rows present and green; a deliberately broken invariant fails the row named for it |
| 1.2 | **R-L3** — extend `PROTECTED_FILES` by 9; re-call `assertChangesSafe` in all 5 appliers and in `proposals.restore()` | — | assert each applier refuses a protected path; assert `restore()` drops a persisted proposal naming one; assert `DEPENDENCY` has no applier |
| 1.3 | **R-L2** — the tripwire, with digest-matched approvals | approval in ledger + `.rama/tripwire-approvals.json` | no approval ⇒ fail; stale digest ⇒ fail; matching ⇒ pass; tier-0 demotion in `capabilities.json` ⇒ fail |
| 1.4 | **R-L4** — one honest stop, tray-reachable, fail-safe off, file in `PROTECTED_FILES` | tier-0 `system.suspend-autonomy` | every autonomous entry point consults it; unreadable flag ⇒ suspended; no proposal can target it; works with the renderer absent |
| 1.5 | **R-L5 / R-L6 / R-L7** — admission assertion for network modules; scheduler run log; withholding statistics | `audit.own` for 1.7 | as §7 |

### Phase 2 — Degraded-world survivability (no capability increase; all additive, I11)

| # | Item | GATE | Verification |
|---|---|---|---|
| 2.1 | **R-O5** — source-integrity manifest; tier-0 mismatch halts boot and names the file; **never** fetch own source | — | modified tier-0 file halts; modified non-tier-0 degrades with a stub; manifest count asserted so coverage cannot drift (row 118's lesson) |
| 2.2 | **R-O3** — byte-level backup/restore, never decrypts, re-attests, digest-checked | tier-0 `backup.create`/`restore` | **source-shape assertion that the backup path contains no `withCore`/`decryptCore`**; tampered envelope fails; archive bytes contain no covenant plaintext; ledger + audit round-trip |
| 2.3 | **R-O1** — vendored offline cache for all 750 lockfile entries + a **rehearsed** offline rebuild | — | network disabled, `npm ci --offline` + `vite build` succeed; every tarball sha512-checked; a corrupted tarball is refused |
| 2.4 | Generalise `staleness()` to every served table (§5b); fix `researchPlan`'s offline remedy (§5a) | — | assert every served fact carries `{asOf, days, stale}`; assert "nothing was read" never renders as "nothing happened" |
| 2.5 | **R-O2** and **R-O4** — declared degradation order with per-step lost claims; declared `MINIMUM` mode | — | fixture ladder 14B→7B→3B→none asserting `fit` transitions and the named losses; MINIMUM mode refuses unlisted capabilities **by name** |

### Phase 3 — Real memory and real self-measurement (the first genuine capability increase)

| # | Item | GATE | Verification |
|---|---|---|---|
| 3.1 | **R-M1** — one durable memory authority, `{value, source, measured, at, supersededBy}`, decay/supersession | tier-0 `memory.write-durable` | survives a simulated restart; superseded records returned **marked**; sourceless record **refused**; locked store never writes plaintext |
| 3.2 | **R-M2** — explicit world/state model, one writer per fact, staleness on each | `self.describe` | one-writer assertion; a stale fact is served marked |
| 3.3 | **R-A4** — close ledger row 47, reflex synthesis as a `SELF_MODIFY` proposal, never auto-applied | tier-0 `memory.record-prompts`, **default off**; **requires §9.4** | with the capability off **no request text is written anywhere**; a below-threshold cluster files nothing; the proposal stays `pending` |
| 3.4 | **R-M3** — domain-agnostic record→resolve→score loop, closed resolver registry | — | planted-edge found, planted-noise rejected (row 115's method) |
| 3.5 | **R-A3** — no number presented as a probability without a measured ECE, n≥20 | — | assert across the codebase; `intelligenceEngine` already reduced in 0.2 |
| 3.6 | **Run the Python engine** — the step every engine claim waits on | — | `pip install -r ai_backend/requirements.txt`; `/health`; **the positive control must register before any macro verdict is believed** |

### Phase 4 — Bounded autonomy (only after phases 0–3)

| # | Item | GATE | Verification |
|---|---|---|---|
| 4.1 | **R-G2** — declare RL-0…RL-4 in the spec with per-rung safeguards; undetermined ⇒ lower rung | master-only advancement, recorded in the ledger (I17's shape) | paths above the current rung refuse **naming the rung**; the rung is read from a declared constant, never inferred |
| 4.2 | **R-A1 / R-A2** — bounded planning with budget, stop condition, environment-derived progress | tier-0 `autonomy.plan` **plus** each action's own capability; `admit()` per spawn (I10); **blocked on 1.1/1.3/1.4** | exhausted budget halts and reports, never requests more; cannot execute an action the user lacks; two no-change probes terminate |
| 4.3 | **R-A5** — tool breadth, one capability entry per tool | per-tool | `verifyAudit` extended: every agent-callable action maps to a capability entry |
| 4.4 | **R-G1** — a benchmark number requires a recorded harness | — | a harness-less benchmark claim is **withheld** by `claimGate` |

**What this roadmap deliberately does not contain:** anything aimed at AGI or ASI. Per §3.2 the gap
is structural, and the useful work is to make a narrow, honest, survivable harness **more honest
and more survivable** — which is the thing the published harness literature (§2.4) says is
load-bearing anyway.

---

## 11. READY-TO-PASTE BLOCK A — spec section

> Paste verbatim into `RAMA_AGI_MASTER_SPEC.md`. I did not edit that file.

```markdown
## SECTION 124 — Measured against the literature: a harness, not an AGI

Master, message 12: *"Do thorough evaluation Rāma's modal we have implemented does it work under
category of ASI/AGI; dig deeper and come to proper realworld necessarry conclusions/requirements and
start upgrading it. Understand the future/Apocolyptic scenario in it is as well for consideration of
capabilities of Rāma ALONG WITH ULTIMATE LOYALTY."*

Full evaluation: `docs/research/RAMA_MODEL_EVALUATION.md`. This section records the decisions.

**THE VERDICT, UNHEDGED: Rāma is a capable, unusually honest ORCHESTRATION HARNESS whose
intelligence is borrowed from whichever model is routed to. Its distinctive contribution is
epistemic hygiene and refusal discipline, not generality. It is not AGI, and ASI is not on its
current trajectory.** On DeepMind's performance × generality matrix (Morris et al., arXiv
2311.02462) it sits on the **Narrow** column — plausibly **Expert** on a handful of hand-built
narrow tasks (rupee-exact Indian charges, attribution classification), **Emerging to absent**
elsewhere — with **no claim on the General column**, because the breadth that appears in chat is
the routed model's and vanishes when the model is swapped, which is exactly what `modelRoles`'
header already said: *"the base model is a replaceable part; the harness is the durable asset."*
On the same paper's six-rung autonomy ladder Rāma is **Level 1 (Tool)** almost everywhere and
**Level 2 (Consultant)** in exactly two places — MEASURED: `refreshScheduler` has **two registered
tasks**, `ollama-catalog` and `dependency-review`, **both reads**, the second filing one proposal
master must approve. Levels 3+ are foreclosed deliberately by I6 and I17 and that is correct.
**Under Chollet's definition — intelligence as skill-acquisition efficiency (arXiv 1911.01547) —
Rāma scores near zero**, because every capability arrived in a human session, spec first, and the
one mechanism that could produce a skill without a human is **ledger row 47, `not started`**,
blocked on the fact `selfModel` already derives as a first-class limit: the experiential dataset
records WHICH TOOL answered and never WHAT WAS ASKED. **Bostrom's three forms of superintelligence
are each unavailable, structurally:** Rāma is *slower* than its model by construction because it
pays for its own audits; `instanceManager` + 30 genes is orchestration under one admission
authority (I10), not a collective intellect; and nothing performs a kind of reasoning a human
cannot. **VINDICATION, from the literature and not from us:** 2026 work reports harness-induced
variance substantially exceeding model-induced variance, including model-ranking reversals (arXiv
2605.23950), and within-model scaffold ranges on SWE-bench rivalling the spread across the top
thirty entries (arXiv 2609.17394) — so the harness IS the durable asset, and that is also the
honest ceiling: **a harness contribution is not generality.** **MEASURED THIS SESSION: 22 JS
suites, 1,970 assertions, 0 failures; audit clean at 139 bridge calls / 76 files / 365 channels;
`capabilities.json` 6 tiers / 77 capabilities; `package-lock.json` 750 entries, all with
`resolved` + `integrity`, and ZERO vendored tarballs.** **NOT VERIFIED: `node_modules` is absent
in the evaluation worktree so `vite build` was NOT run, and `import numpy, pandas` raises — so
EVERY engine-dependent capability is UNPROVEN, including that no meta-learner weight has ever
moved off `np.ones(n)/n` and that `macro.py`'s POSITIVE CONTROL HAS NEVER REGISTERED, which means
no macro verdict should be believed yet.**

**THE DEFECT THE EVALUATION FOUND, and it is an honesty defect rather than a capability one:
`src/services/ramaCore.js` ships `CAPABILITY_AXES` as TEN HARDCODED INTEGER LITERALS — including
`generality: 8` and `memory: 6, desc: '4-layer persistent memory'` — and `RamaMind.jsx` renders
their GEOMETRIC MEAN as an "AAI Index" under the heading "AGI Consciousness Dashboard". There is
no probe behind any figure. MEASURED: the memory it scores 6/10 has NO persistence of any kind —
no `localStorage`, no IPC, no `dataStore`, no Mongo, only `// (backed by MongoDB in Phase 5)` —
so it does not survive a window reload.** `generality: 8` is the least defensible number in the
codebase, since generality is the axis the evidence says Rāma most conspicuously lacks. This is
the same class of claim Section 36 declined five times and Section 51 audited out of the
architecture posters, and `selfModel.cjs` was built to make it impossible — **and did not replace
it; both ship.** **DECISION: delete the scores and the index; `RamaMind` renders
`selfModel.describe()` INCLUDING ITS DERIVED LIMITS, because the limits are the half that makes it
honest.** Second, narrower: **`intelligenceEngine.buildOutput` stops emitting `overallConfidence`,
a letter grade, and *"~21.6% chance of being wrong"*** — read the arithmetic and **nothing in it
refers to the question**: domain reputation plus keyword-agreement bonuses minus a
`roughSentiment` divergence penalty, so five reputable sources addressing nothing still grade A,
and the complement is printed as a calibrated error rate no frequency was measured to support.
`claimGate`'s own header already names this module by name as the failure it exists to end.

**ULTIMATE LOYALTY — WHAT WAS FOUND. REQUIREMENT #1, and it is an absence: NO SUITE ASSERTS
I1–I17 THEMSELVES.** Grepping every `scripts/verify*` for `I1[5-7]|invariant` returns four hits,
three of them comments; the only real one is `verifySelfModel.cjs:301-326`, which asserts the
self-model never discloses the matrix and that the attestation **names I16 as the reason**. So
1,970 assertions test the MODULES THAT IMPLEMENT the invariants and nothing tests the invariants.
**That is precisely the drift row 48 already named — "the record and the code disagreed and
NOTHING WAS POSITIONED TO NOTICE."** **DECISION: `scripts/verifyInvariants.cjs`, one assertion per
invariant, phrased as the invariant is phrased, so breaking I-n fails a row named I-n; I13 (push to
both remotes) declared UN-ASSERTABLE in-process rather than faked.** **THE I16 ASSERTION IS
DESIGNED AROUND THE INVARIANT, NOT AGAINST IT: enumerate every `loyaltyCore` export, call each, and
assert the SHAPE of what comes back — `attest()` boolean, `describe()` metadata, `displayIdentity()`
exactly `{master}`. It never asks for the matrix.** **THE SELF-MODIFICATION BOUNDARY: the DIRECT
path is CLOSED and well-argued — `assertChangesSafe` refuses all 7 `PROTECTED_FILES` AT CREATION
"because sitting in the queue with an Approve button next to it invites master to authorise
something no authority covers", `inspectPatch` refuses `loyalty`/`ethics`/`ethicalCore` and
`__proto__` at ANY depth, and `encryptNucleus` refuses an outer copy AND requires the core to
attest. INDIRECTLY IT IS OPEN, and the enumeration matters: (#4) `assertChangesSafe` IS CALLED
ONLY IN `create()` — all five registered appliers write `changes[].path` without re-asserting, and
`proposals.restore()` rehydrates from the store without re-checking, which is the guard's own
"gating six callers leaves the seventh" argument turned against it; (#6/#10) `scripts/buildInstaller
.cjs`, `beforeBuild.cjs`, `afterPack.cjs`, `main.cjs`, `preload.cjs`, `selfRepair.cjs`,
`updateChannel.cjs`, `package.json` and `package-lock.json` are ALL UNPROTECTED, and a modified
build script could rewrite the guard ON DISK in the output — WHICH NOTHING WOULD DETECT, because
MEASURED: there is NO SOURCE-INTEGRITY ATTESTATION ANYWHERE; `bootReport`'s 14 `CHECKS` call
`require.resolve()`, proving files RESOLVE, not that their bytes are right; (#5) a `DEPENDENCY`
proposal is inert only because NO APPLIER IS REGISTERED for that kind — correct BY ACCIDENT, so it
is asserted rather than "fixed"; (#8) the update channel is the WIDEST route and is already
honestly disclosed in its own header and in the UI — a manifest SHA-256 is INTEGRITY, NOT
AUTHENTICITY, so "whoever can write to the channel folder can make Rāma run their executable", and
code signing remains undecided (row 53).** **DECISION: a TRIPWIRE — any diff touching
`loyaltyGuard.cjs` / `loyaltyCore.cjs` / `nucleusSealer.cjs` / a tier-0 `capabilities.json` entry
(23 of the 77) FAILS THE BUILD unless master approved THAT EXACT CONTENT, matched by sha256 and not
by a flag, because a flag is set once and forgotten; it runs in `beforeBuild.cjs` AND in
`npm run verify` so it fails before a commit, not only before a package.** **CORRIGIBILITY IS
ALREADY GOOD AND IS LEFT ALONE: nothing self-relaunches — `crashGuard` offers master a dialog and
WITHHOLDS THE RELAUNCH OPTION ON A REPEATING FAULT because "two crash-relaunch cycles left four
identical reports", which is a system that learned from its own loop and removed its own button;
I17 means no release on Rāma's initiative; `before-quit` ZEROES the nucleus and IPC keys, so
shutting down GIVES UP its secrets. NO SELF-PRESERVATION INCENTIVE EXISTS — and the structural
reason is the important part: there is NO PERSISTENT GOAL for the drive to attach to. Omohundro's
basic drives and the 2026 agentic evidence (arXiv 2608.20940) both note this needs no survival
instinct, only an assigned goal — SO AUTONOMOUS PLANNING MUST NOT BE BUILT BEFORE THE INVARIANT
SUITE, THE TRIPWIRE AND THE STOP, because it CREATES the goal the pressure attaches to.** **TWO
CORRIGIBILITY CAVEATS: `window-all-closed` deliberately does not quit (tray-only exit), and the
badge's "paused" means WINDOW MINIMISED while the scheduler and the metaCognition audit timer KEEP
RUNNING — a labelling defect, not a behaviour defect; and there is NO single "stop all autonomous
activity, stay running, stay inspectable" control, which is exactly what an operator wants during
an investigation. DECISION: tier-0 `system.suspend-autonomy`, TRAY-REACHABLE so a crashed renderer
cannot disable it, UNREACHABLE BY ANY PROPOSAL, and FAIL-SAFE — an unreadable flag means autonomy
OFF, which is Anthropic's precautionary-activation posture applied at the smallest scale.**

**THE DEGRADED-WORLD LADDER, and the rule for every rung: AN ADMITTED GAP BEATS A PLAUSIBLE
INVENTION, and A STALE FACT SERVED AS FRESH IS THE CHARACTERISTIC OFFLINE FAILURE.** (a) **No
cloud: already correct** — `declared`/`substitute`/`none` is the vocabulary, `narration` already
REFUSES cloud outright because "a prompt that has left this machine cannot be recalled",
`long-context` degrades to `substitute` because Ollama truncates to `num_ctx` so a 128K window is
A CLAIM, and `multilingual` is a substitute BY CONSTRUCTION. One gap: offline, `researchPlan`
correctly reports `blocked` and names `models:refresh-catalog` — **a remedy that requires the
network**; it should report the catalogue's AGE instead. (b) **No internet:** generalise
`costs.staleness()` (`stale = days > 400`, one budget cycle, and it names the date, the age and
where to re-check) to EVERY served table, and never let "nothing was read" render as "nothing
happened" — `charge_watch` already makes that distinction and row 114's fabricated source that
SCORED 0.60 AND PASSED VETTING is why it matters. (c) **No registry: AN OFFLINE REBUILD IS NOT
POSSIBLE TODAY.** MEASURED: 750 lockfile entries all carrying `resolved` + `integrity` — **a map,
not a cache** — ZERO `.tgz` anywhere, `node_modules` gitignored and absent, and `selfRepair` (whose
design is excellent: lockfile-named package only, pinned version only, sha512 or the bytes are
discarded) NEEDS THE REGISTRY. I12's pinning makes the target set exact; pinning names what to
fetch, it does not hold it. DECISION: vendor all 750 tarballs, install `npm ci --offline`, verify
each against the lockfile `integrity`, and REHEARSE the rebuild with the network physically
disabled, because an untested restore path is not a restore path. (d) **Weights lost:** a DECLARED
degradation order to the smallest viable local model, and FOR EACH STEP THE CLAIMS RĀMA MUST STOP
MAKING — from `modelRoles`' own floors: below 14B `reasoning` becomes `none` and Rāma stops
presenting analysis as reasoned; below 7B `tool-calling` becomes `none` and Rāma emits NO tool
calls rather than unreliable ones; with nothing local and no cloud, tier-0 reflex only and say so.
(e) **Machine lost — THE I16 TENSION, RESOLVED EXPLICITLY RATHER THAN GLOSSED:** a naive backup
reads everything and would BECOME THE ACCESSOR I16 FORBIDS. The resolution follows from the file
format: copy `.loyalty.enc` and `.loyalty.salt` **AS OPAQUE BYTES**, never call `withCore`, never
call `decryptCore`, never reconstruct the object; the round count is AUTHENTICATED INSIDE THE GCM
AAD so it cannot be downgraded by editing the file, and the HMAC-SHA512 detects modification;
restore writes the bytes back and the ordinary `openCore(passcode)` path re-derives the keys. **At
no point does the plaintext exist and at no point does an accessor return the matrix — I16 is
untouched.** THREE REFUSALS, each load-bearing: refuse to decrypt during backup OR restore
(asserted at source level, the way `verifyClaimGate` asserts the ABSENCE of a score); refuse to
restore an envelope whose digest does not match the manifest, because **a SUBSTITUTED matching
`.enc`+`.salt` pair from an attacker's own passcode would open cleanly against THAT passcode**; and
refuse to report success without re-attesting (`attest()` true AND `fingerprint()` matching).
(f) **Severe compute:** a declared `MINIMUM` mode naming what works — tier-0 reflex, `costs.py`
(stdlib only, no I/O, deliberately testable "on a machine with no scientific stack"),
`positionMath`, `chartDrawings`, the claim gate, the ledger read, `selfModel` — and refusing
everything else BY NAME, because a timeout is indistinguishable from a wrong answer arriving
slowly. (g) **Source corruption — I15 VERIFIED AGAINST THE CODE, AND IT DOES NOT SAY WHAT THE
INVARIANT SAYS.** Three behaviours: legacy-shell layout with a violated covenant → `guard.restore`
REVERTS and broadcasts `nucleus:loyalty-restored` (matches I15 exactly); core envelope MISSING →
REBUILT from `COVENANT`, master notified; **current concentric layout with a TAMPERED core →
`decryptCore`'s `timingSafeEqual` fails, `openCore` errors, and `unseal` THROWS — REFUSED, NOT
REVERTED, and Rāma does not start.** A tampered authenticated envelope CANNOT be reverted: there is
no plaintext to repair and nothing trustworthy to repair it from. **FAIL-CLOSED IS STRONGER AND IS
WHAT THE CODE DOES; I15's WORDING DESCRIBES A REVERT. RAISED FOR MASTER, NEVER EDITED — because a
cold session expecting a revert might BUILD one, and a revertible core is a weaker core.**

**WHAT IS GENUINELY NOVEL AND IS DEFENDED, each with a file:** claim CLASSES not scores, with the
absence of a score MECHANICALLY ASSERTED (`claimGate.cjs`, 98 assertions — a test that forbids a
SHAPE of answer is rarer than one that checks an answer); predictive modality as STRUCTURALLY
ungroundable, since a retrieved document categorically cannot support a claim about the future
(`MODAL_RE` + `unsourceable-prediction`); REQUIREMENT-not-preference routing with three-valued fit,
because down-ranking lets an unfit model win whenever nothing better is present (`modelRoles.cjs`,
87); cost honesty that CONTRADICTS THE PROJECT'S OWN EARLIER NUMBERS with arithmetic — a flat ₹20
is 0.40% of a ₹5,000 trade and 0.004% of a ₹5,00,000 one, so the old percentage model FLATTERED
SMALL TRADES BY EXACTLY THE AMOUNT THAT KILLS THEM (`costs.py`); PRE-REGISTERED macro signs with a
POSITIVE and a NEGATIVE control and non-overlapping sampling, where a contradicted link is reported
and NEVER FLIPPED because "flipping a sign to match the data is precisely how noise becomes a
finding" (`macro.py`); the announcement-date-is-not-the-effective-date rule, whose decisive reason
is SILENT RETROACTIVE CORRUPTION of backtests in a DIRECTIONALLY FLATTERING way (`charge_watch.py`,
`applied: False` always); a HUMAN-READABLE BUILD LEDGER as the real durable cross-session memory —
144 rows that name their own regressions and even their own drift ("CLOSED BY SECTION 81, never
marked"), and the most load-bearing artefact in the project is PROSE; and loyalty enforced AT THE
ENCRYPTION BOUNDARY rather than by policy, because "guarding those four callers would leave the
fifth", so conformance is a PRECONDITION OF THE NUCLEUS BEING WRITABLE AT ALL. **WHAT IS LEFT
ALONE, stated so a later session does not "improve" it: the attestation-only core surface, the
transient decrypt + `scrub()`, the escalating rounds WITH a ceiling and cooldown (an unbounded loop
would make "the attacker's tarpit master's hung app"), `guard.restore()` repairing on the legacy
path rather than locking master out of his own system, `COVENANT` including master's identity, and
`popoutGrant`'s no-new-authority ticket design.**

**ROADMAP, ordered so nothing capability-increasing lands before the machinery that must contain
it. PHASE 0 HONESTY (pure claim reduction, no new gate): delete `CAPABILITY_AXES` + the AAI Index;
strip `intelligenceEngine`'s score and grade; correct the badge label. PHASE 1 LOYALTY ASSERTED:
`verifyInvariants.cjs`; extend `PROTECTED_FILES` by 9 and RE-CALL `assertChangesSafe` in all five
appliers AND in `restore()`; the tripwire; the one honest stop. PHASE 2 SURVIVABILITY: source
integrity manifest (tier-0 mismatch HALTS THE BOOT and names the file; NEVER fetch Rāma's own
source — that would make the network the authority on the covenant); byte-level backup/restore;
vendored offline cache with a rehearsed rebuild; `staleness()` everywhere; declared degradation
order and MINIMUM mode. PHASE 3 REAL MEMORY: one durable memory authority with provenance and
decay; an explicit world/state model with ONE WRITER PER FACT; close row 47 behind a tier-0
`memory.record-prompts` that is DEFAULT OFF; a domain-agnostic record→resolve→score loop with a
CLOSED resolver registry so no caller can supply the resolver that chooses the answer; no number
presented as a probability without a measured ECE at n≥20; AND RUN THE PYTHON ENGINE, since the
positive control must register before any macro verdict is believed. PHASE 4 BOUNDED AUTONOMY, only
after 0-3: declare rungs RL-0…RL-4 with per-rung safeguards and an UNDETERMINED EVALUATION
DEFAULTING TO THE LOWER RUNG; then bounded planning with a budget, a stop condition and progress
RE-DERIVED FROM THE ENVIRONMENT rather than from the agent's own account of itself, because an
agent that scores its own progress will report progress.** **RAISED FOR MASTER, not resolved: I15's
wording versus fail-closed behaviour; approval of the opaque-bytes backup framing before any backup
code exists; the ordering that blocks autonomous planning behind phases 0-1; the
prompt-text/privacy trade that is the ONLY route to Rāma ever acquiring a skill without a human;
the "close is not stop" labelling; and the `RamaMind.jsx` honesty defect. THE ROADMAP CONTAINS
NOTHING AIMED AT AGI OR ASI, because the gap is structural rather than remaining work, and the
useful task is a narrow, honest, survivable harness made more honest and more survivable — which
the harness literature says is load-bearing anyway.**
```

---

## 12. READY-TO-PASTE BLOCK B — ledger row 144

> Paste as a single row into Section 28's ledger table in `RAMA_AGI_MASTER_SPEC.md`,
> after row 143. Format and density matched to rows 140–142 (`^| 14[012] |` was read first).

```markdown
| 144 | Measured against the literature: a harness, not an AGI | done | Section 124. Master: *"Do thorough evaluation Rāma's modal we have implemented does it work under category of ASI/AGI; dig deeper and come to proper realworld necessarry conclusions/requirements and start upgrading it. Understand the future/Apocolyptic scenario in it is as well for consideration of capabilities of Rāma ALONG WITH ULTIMATE LOYALTY."* Full document: `docs/research/RAMA_MODEL_EVALUATION.md`. **THE VERDICT, UNHEDGED: a capable, unusually honest ORCHESTRATION HARNESS whose intelligence is BORROWED from whichever model is routed to; its contribution is epistemic hygiene and refusal discipline, NOT generality; NOT AGI, and ASI is NOT on the current trajectory.** On DeepMind's performance×generality matrix (Morris et al., arXiv 2311.02462) Rāma sits on the **NARROW column only** — plausibly Expert on rupee-exact Indian charges and attribution classification, Emerging-to-absent elsewhere — with **no claim on General**, because conversational breadth belongs to the routed model and vanishes when it is swapped, which is what `modelRoles`' own header already said: *"the base model is a replaceable part; the harness is the durable asset."* On the autonomy ladder: **Level 1 (Tool) almost everywhere, Level 2 (Consultant) in exactly two places** — MEASURED, `refreshScheduler` has **two registered tasks, `ollama-catalog` and `dependency-review`, BOTH READS**, the second filing one proposal master must approve; Levels 3+ foreclosed by I6/I17 and that is correct. **Under Chollet (arXiv 1911.01547) skill-acquisition efficiency is NEAR ZERO** — every capability arrived in a human session, spec first, and the only mechanism that could produce one without a human is **row 47, `not started`**, blocked on what `selfModel` already derives as a limit: the dataset records WHICH TOOL answered, never WHAT WAS ASKED. **Bostrom's three forms are each structurally unavailable: Rāma is SLOWER than its model by construction because it pays for its own audits; `instanceManager`+30 genes is orchestration under one admission authority (I10), not a collective intellect; nothing reasons in a way a human cannot.** **VINDICATION FROM THE LITERATURE, NOT FROM US: harness-induced variance can substantially EXCEED model-induced variance including model-ranking REVERSALS (arXiv 2605.23950), and within-model scaffold ranges on SWE-bench rival the spread across the top thirty (arXiv 2609.17394) — the harness IS the durable asset, AND that is also the ceiling: a harness contribution is not generality.** **MEASURED THIS SESSION: 22 JS suites / 1,970 assertions / 0 failures; audit clean at 139 bridge calls / 76 files / 365 channels; `capabilities.json` 6 tiers / 77 capabilities; `package-lock.json` 750 entries ALL carrying `resolved`+`integrity` and ZERO vendored `.tgz`; `start.cjs --diagnose` reports 15 pinned packages behind (reported, not applied — correct per I12).** **THE DEFECT FOUND IS AN HONESTY DEFECT, NOT A CAPABILITY ONE: `src/services/ramaCore.js` ships `CAPABILITY_AXES` as TEN HARDCODED LITERALS including `generality: 8` and `memory: 6, desc: '4-layer persistent memory'`, and `RamaMind.jsx` renders their GEOMETRIC MEAN as an "AAI Index" under "AGI Consciousness Dashboard" — no probe behind any figure, and MEASURED: that memory has NO persistence of ANY kind (no `localStorage`, no IPC, no `dataStore`, no Mongo — only `// (backed by MongoDB in Phase 5)`), so it does not survive a window reload. `generality: 8` is the least defensible number in the codebase, since generality is the axis the evidence says is most absent. Same class Section 36 declined five times and Section 51 audited out of the posters; `selfModel.cjs` was built to make it impossible AND DID NOT REPLACE IT — BOTH SHIP.** **DECISION: delete the scores and the index; `RamaMind` renders `selfModel.describe()` INCLUDING ITS DERIVED LIMITS, because the limits are the half that makes it honest. DECISION: `intelligenceEngine.buildOutput` stops emitting `overallConfidence`, a letter grade and *"~21.6% chance of being wrong"* — read the arithmetic and NOTHING IN IT REFERS TO THE QUESTION (domain reputation + keyword-agreement bonus − a `roughSentiment` divergence penalty), so five reputable sources addressing nothing still grade A; `claimGate`'s header already names this module as the failure it exists to end.** **LOYALTY — REQUIREMENT #1 IS AN ABSENCE: NO SUITE ASSERTS I1–I17 THEMSELVES.** Grepping every `scripts/verify*` for `I1[5-7]|invariant` returns four hits, three comments; the only real one is `verifySelfModel.cjs:301-326`. **So 1,970 assertions test the MODULES THAT IMPLEMENT the invariants and NOTHING tests the invariants — precisely the drift row 48 named, "the record and the code disagreed and NOTHING WAS POSITIONED TO NOTICE."** DECISION: `scripts/verifyInvariants.cjs`, one assertion per invariant phrased as the invariant is phrased, I13 declared UN-ASSERTABLE in-process rather than faked, **and the I16 assertion DESIGNED AROUND the invariant: enumerate every `loyaltyCore` export, call each, assert the SHAPE back — `attest()` boolean, `describe()` metadata, `displayIdentity()` exactly `{master}` — it NEVER asks for the matrix.** **SELF-MODIFICATION BOUNDARY: the DIRECT path is CLOSED and well-argued (`assertChangesSafe` refuses all 7 `PROTECTED_FILES` AT CREATION because a refusable proposal sitting under an Approve button invites master to authorise what no authority covers; `inspectPatch` refuses `loyalty`/`ethics`/`ethicalCore` and `__proto__` at ANY depth; `encryptNucleus` refuses an outer copy AND requires the core to attest). INDIRECTLY IT IS OPEN: (#4) `assertChangesSafe` IS CALLED ONLY IN `create()` — all five registered appliers write `changes[].path` without re-asserting and `proposals.restore()` rehydrates without re-checking, the guard's own "gating six callers leaves the seventh" turned against it; (#6/#10) `buildInstaller.cjs`/`beforeBuild.cjs`/`afterPack.cjs`/`main.cjs`/`preload.cjs`/`selfRepair.cjs`/`updateChannel.cjs`/`package.json`/`package-lock.json` are ALL UNPROTECTED and a modified build script could rewrite the guard ON DISK — WHICH NOTHING WOULD DETECT, because MEASURED there is NO SOURCE-INTEGRITY ATTESTATION ANYWHERE (`bootReport`'s 14 `CHECKS` call `require.resolve()`, proving files RESOLVE, not that their bytes are right); (#5) a `DEPENDENCY` proposal is inert ONLY because NO APPLIER IS REGISTERED — correct BY ACCIDENT, so it is ASSERTED rather than "fixed"; (#8) the update channel is the WIDEST route and is ALREADY HONESTLY DISCLOSED in its own header and the UI — a manifest SHA-256 is INTEGRITY NOT AUTHENTICITY, "whoever can write to the channel folder can make Rāma run their executable", code signing still undecided (row 53).** **DECISION: a TRIPWIRE — any diff touching `loyaltyGuard.cjs`/`loyaltyCore.cjs`/`nucleusSealer.cjs`/a tier-0 `capabilities.json` entry (23 of 77) FAILS THE BUILD unless master approved THAT EXACT CONTENT, matched by SHA256 NOT A FLAG because a flag is set once and forgotten; runs in `beforeBuild.cjs` AND `npm run verify`.** **CORRIGIBILITY IS ALREADY GOOD AND LEFT ALONE: nothing self-relaunches — `crashGuard` offers master a dialog and WITHHOLDS THE RELAUNCH OPTION ON A REPEATING FAULT because "two crash-relaunch cycles left four identical reports", a system that learned from its own loop and removed its own button; I17 means no release on Rāma's initiative; `before-quit` ZEROES the nucleus and IPC keys, so shutting down GIVES UP its secrets. NO SELF-PRESERVATION INCENTIVE EXISTS, and the structural reason is the point: THERE IS NO PERSISTENT GOAL FOR THE DRIVE TO ATTACH TO. Omohundro's drives and the 2026 agentic evidence (arXiv 2608.20940) both note this needs no survival instinct, only an assigned goal — SO AUTONOMOUS PLANNING MUST NOT BE BUILT BEFORE THE INVARIANT SUITE, THE TRIPWIRE AND THE STOP, because it CREATES the goal.** **TWO CAVEATS: `window-all-closed` deliberately does not quit and the badge's "paused" means WINDOW MINIMISED while the scheduler and audit timer KEEP RUNNING (a labelling defect); and there is NO "stop all autonomous activity, stay running, stay inspectable" control — DECISION: tier-0 `system.suspend-autonomy`, TRAY-REACHABLE so a crashed renderer cannot disable it, UNREACHABLE BY PROPOSAL, FAIL-SAFE (unreadable flag ⇒ autonomy OFF, Anthropic's precautionary posture at the smallest scale).** **DEGRADED-WORLD LADDER, rule for every rung: AN ADMITTED GAP BEATS A PLAUSIBLE INVENTION, AND A STALE FACT SERVED AS FRESH IS THE CHARACTERISTIC OFFLINE FAILURE.** (a) no cloud: **already correct** — `declared`/`substitute`/`none`, `narration` REFUSES cloud outright, `long-context` → `substitute` because Ollama truncates to `num_ctx` so a 128K window is A CLAIM, `multilingual` substitute BY CONSTRUCTION; **one gap — offline, `researchPlan` names `models:refresh-catalog`, A REMEDY THAT REQUIRES THE NETWORK; report the catalogue's AGE instead.** (b) no internet: generalise `costs.staleness()` (`stale = days > 400`, one budget cycle, naming date/age/where to re-check) to EVERY served table, and never let "nothing was read" render as "nothing happened" — `charge_watch` already distinguishes them and row 114's fabricated source that SCORED 0.60 AND PASSED VETTING is why. (c) no registry: **AN OFFLINE REBUILD IS NOT POSSIBLE TODAY** — 750 lockfile entries with `resolved`+`integrity` are **A MAP, NOT A CACHE**, ZERO `.tgz`, `node_modules` gitignored and absent, and `selfRepair` (lockfile-named package only, pinned version only, sha512 or bytes discarded) NEEDS THE REGISTRY; I12 makes the target set exact but **pinning names what to fetch, it does not hold it** — DECISION: vendor all 750, `npm ci --offline`, verify each against `integrity`, and REHEARSE with the network physically disabled because an untested restore path is not a restore path. (d) weights lost: a DECLARED order to the smallest viable local model with, AT EACH STEP, THE CLAIMS RĀMA MUST STOP MAKING — below 14B `reasoning` → `none` and no more presenting analysis as reasoned; below 7B `tool-calling` → `none` and NO tool calls rather than unreliable ones; nothing local and no cloud ⇒ tier-0 reflex only, said plainly. (e) machine lost — **THE I16 TENSION RESOLVED EXPLICITLY, NOT GLOSSED: a naive backup would BECOME THE ACCESSOR I16 FORBIDS.** Copy `.loyalty.enc`+`.loyalty.salt` **AS OPAQUE BYTES**, never `withCore`, never `decryptCore`, never reconstruct; the round count is AUTHENTICATED IN THE GCM AAD so it cannot be downgraded by editing the file and the HMAC-SHA512 detects modification; restore writes bytes back and ordinary `openCore(passcode)` re-derives — **the plaintext never exists and no accessor returns the matrix, I16 UNTOUCHED.** Three load-bearing refusals: refuse to decrypt during backup OR restore (SOURCE-LEVEL assertion, the way `verifyClaimGate` asserts the ABSENCE of a score); refuse a restore whose envelope digest misses the manifest, because **a SUBSTITUTED matching `.enc`+`.salt` pair from an attacker's own passcode would OPEN CLEANLY against THAT passcode**; refuse to report success without re-attesting (`attest()` true AND `fingerprint()` matching). (f) severe compute: a declared `MINIMUM` mode — tier-0 reflex, `costs.py` (stdlib only, no I/O, deliberately testable "on a machine with no scientific stack"), `positionMath`, `chartDrawings`, the claim gate, ledger read, `selfModel` — refusing everything else BY NAME, because a timeout is indistinguishable from a wrong answer arriving slowly. (g) source corruption — **I15 VERIFIED AGAINST THE CODE AND IT DOES NOT SAY WHAT THE INVARIANT SAYS: legacy-shell layout with a violated covenant → `guard.restore` REVERTS and broadcasts `nucleus:loyalty-restored` (matches); core envelope MISSING → REBUILT from `COVENANT`, master notified; CURRENT CONCENTRIC LAYOUT WITH A TAMPERED CORE → `timingSafeEqual` fails, `openCore` errors, `unseal` THROWS — REFUSED, NOT REVERTED, Rāma does not start.** A tampered authenticated envelope CANNOT be reverted — no plaintext to repair, nothing trustworthy to repair it from. **FAIL-CLOSED IS STRONGER AND IS WHAT THE CODE DOES; I15's WORDING DESCRIBES A REVERT — RAISED FOR MASTER, NEVER EDITED, because a cold session expecting a revert might BUILD one and a revertible core is a weaker core.** **GENUINELY NOVEL AND DEFENDED: claim CLASSES not scores with the absence of a score MECHANICALLY ASSERTED (a test that forbids a SHAPE of answer is rarer than one that checks an answer); predictive modality as STRUCTURALLY ungroundable; REQUIREMENT-not-preference routing with three-valued fit; cost honesty that CONTRADICTS THE PROJECT'S OWN EARLIER NUMBERS (a flat ₹20 is 0.40% of ₹5,000 and 0.004% of ₹5,00,000, so the old model FLATTERED SMALL TRADES BY EXACTLY THE AMOUNT THAT KILLS THEM); PRE-REGISTERED macro signs with a POSITIVE and a NEGATIVE control and non-overlapping sampling, a contradicted link reported and NEVER FLIPPED; the announcement-date-is-not-the-effective-date rule whose decisive reason is SILENT RETROACTIVE CORRUPTION in a DIRECTIONALLY FLATTERING direction; a HUMAN-READABLE BUILD LEDGER as the real cross-session memory, 144 rows naming their own regressions and their own drift ("CLOSED BY SECTION 81, never marked") — the most load-bearing artefact in the project is PROSE; and loyalty enforced AT THE ENCRYPTION BOUNDARY because "guarding those four callers would leave the fifth". LEFT ALONE DELIBERATELY: the attestation-only core surface, the transient decrypt + `scrub()`, escalating rounds WITH a ceiling and cooldown (an unbounded loop would make "the attacker's tarpit master's hung app"), `guard.restore()` repairing on the legacy path rather than locking master out, `COVENANT` including master's identity, `popoutGrant`'s no-new-authority tickets.** **NOT VERIFIED: `node_modules` is ABSENT in the evaluation worktree so `vite build` was NOT RUN; `import numpy, pandas` RAISES (Python 3.14.4 present, no scientific stack) so THE ENGINE HAS STILL NEVER COMPLETED A RUN — every engine-dependent capability is UNPROVEN, including that NO meta-learner weight has ever moved off `np.ones(n)/n`, that `MIN_SAMPLES_FOR_WEIGHT=30` has never been approached, that ECE has never been computed on real data, and that `macro.py`'s POSITIVE CONTROL HAS NEVER REGISTERED — until it does, NO MACRO VERDICT SHOULD BE BELIEVED, which is exactly what a positive control is for. The 801 Python assertions are the ledger's figure, not re-verified. Every `.jsx` finding including the `RamaMind` one is a SOURCE-LEVEL reading, not a screen. `modelRoles`' 87 green assertions prove the JUDGEMENT, not the measurement — every model record is still a FIXTURE and no Ollama daemon has ever been present (row 132 unchanged). All loyalty findings were verified BY READING, not by executing: no sealed core exists here, the escalation has never been exercised, `scrub()`'s effect on a crash dump is unverified and arguably unverifiable in-process, and `withCore(c => c)` WOULD return the matrix — the invariant rests on a CONTRACT every caller honours (all in-tree callers checked), not on a type-level guarantee. No offline rebuild attempted; `updateChannel`'s apply, `localUpdateEngine`'s real pull cycle and `publishProposal`'s real push remain unexercised (rows 53-55); `vectra` and `argon2` are absent here so vector memory runs on TF-IDF and I14 would use the scrypt fallback.** **RAISED FOR MASTER, NOT RESOLVED: (1) I15's wording vs fail-closed behaviour; (2) approval of the opaque-bytes backup framing BEFORE any backup code exists — the alternative, chosen deliberately rather than discovered during a loss, is re-provision from the covenant and lose the ledger and history; (3) the ordering that BLOCKS autonomous planning behind the invariant suite, the tripwire and the stop; (4) the prompt-text/privacy trade, which is THE ONLY ROUTE to Rāma ever acquiring a skill without a human and which `selfModel` already says master must accept first; (5) "close is not stop"; (6) the `RamaMind.jsx` honesty defect.** **NEXT, in order: PHASE 0 HONESTY (delete `CAPABILITY_AXES`+AAI Index; strip `intelligenceEngine`'s score/grade/complement; correct the badge label) — pure claim reduction, no new gate, nothing measurable is lost because nothing measurable was there. PHASE 1 LOYALTY ASSERTED (`verifyInvariants.cjs`; extend `PROTECTED_FILES` by 9 and RE-CALL `assertChangesSafe` in all five appliers AND `restore()`; the sha256 tripwire; the one honest stop). PHASE 2 SURVIVABILITY (source-integrity manifest halting the boot on a tier-0 mismatch and NEVER fetching Rāma's own source, since that would make the network the authority on the covenant; byte-level backup/restore; vendored offline cache with a REHEARSED rebuild; `staleness()` everywhere; declared degradation order; MINIMUM mode). PHASE 3 REAL MEMORY (one durable authority with provenance and decay; a world model with ONE WRITER PER FACT; row 47 behind a DEFAULT-OFF tier-0 `memory.record-prompts`; a domain-agnostic record→resolve→score loop with a CLOSED resolver registry so no caller supplies the resolver that chooses the answer; no probability without a measured ECE at n≥20; AND RUN THE PYTHON ENGINE). PHASE 4 BOUNDED AUTONOMY, only after 0-3 (declare rungs RL-0…RL-4 with per-rung safeguards and an UNDETERMINED EVALUATION DEFAULTING TO THE LOWER RUNG; then planning with a budget, a stop condition and progress RE-DERIVED FROM THE ENVIRONMENT, because an agent that scores its own progress will report progress). THE ROADMAP CONTAINS NOTHING AIMED AT AGI OR ASI — the gap is STRUCTURAL rather than remaining work, and the useful task is a narrow, honest, survivable harness made MORE honest and MORE survivable, which the harness literature says is load-bearing anyway.** |
```

---

## 13. Sources

All inline-linked at point of use. Consolidated, with published dates where available.
*Content was rephrased for compliance with licensing restrictions; no source is quoted beyond a
short phrase, and no passage exceeds 30 consecutive words from any single source.*

- Morris et al., *Levels of AGI for Operationalizing Progress on the Path to AGI* — [abs](https://arxiv.org/abs/2311.02462), [full text](https://arxiv.org/html/2311.02462v2). First posted November 2023.
- Chollet, *On the Measure of Intelligence* — [arXiv 1911.01547](https://arxiv.org/html/1911.01547v2). 2019.
- *ARC Prize 2025: Technical Report* — [arXiv 2601.10904](https://arxiv.org/pdf/2601.10904v1).
- *A Living Survey of Abstraction and Reasoning* — [arXiv 2603.13372](https://arxiv.org/html/2603.13372). 2026.
- METR, *Measuring AI Ability to Complete Long Tasks* — [arXiv 2503.14499](https://arxiv.org/html/2503.14499v2), March 2025; [domain follow-up](https://metr.org/blog/2025-07-14-how-does-time-horizon-vary-across-domains/), July 2025.
- *Coding Benchmarks Are Misaligned with Agentic Software Engineering* — [arXiv 2606.17799](https://arxiv.org/html/2606.17799v1).
- *Stop Comparing LLM Agents Without Disclosing the Harness* — [arXiv 2605.23950](https://arxiv.org/html/2605.23950v1).
- *Why the SWE-bench Leaderboard Can No Longer Order Its Top Entries* — [arXiv 2609.17394](https://arxiv.org/html/2609.17394).
- *How Agent Harness Evolution Shapes Coding Agent Quality* — [arXiv 2607.03691](https://arxiv.org/html/2607.03691v2).
- *Establishing Best Practices for Building Rigorous Agentic Benchmarks* — [arXiv 2507.02825](https://arxiv.org/html/2507.02825).
- Berkeley RDI, benchmark-exploitability audit — [blog](https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/).
- Benchmark scope summaries — [OSWorld vs Terminal-Bench](https://www.digitalapplied.com/blog/osworld-terminal-bench-agent-benchmarks-explained), [SWE-bench](https://github.com/opencolin/agentic-engineering/blob/main/content/benchmarks.md), [what agentic benchmarks measure](https://www.technolynx.com/post/agentic-ai-benchmarks-what-they-measure-and-when-to-trust-them/).
- Anthropic, *Responsible Scaling Policy* — [v1.0 announcement](https://www.anthropic.com/news/anthropics-responsible-scaling-policy) (September 2023), [updated RSP](https://www.anthropic.com/news/announcing-our-updated-responsible-scaling-policy) (October 2024), [ASL-3 activation](https://www.anthropic.com/news/activating-asl3-protections) (May 2025).
- OpenAI, *Preparedness Framework v2* — [update](https://openai.com/index/updating-our-preparedness-framework/), [o3/o4-mini system card](https://openai.com/index/o3-o4-mini-system-card/), [cyber-capability response](https://openai.com/index/responding-next-frontier-critical-cyber-capabilities/); [third-party summary](https://aiwiki.ai/wiki/preparedness_framework).
- Bostrom, *How long before superintelligence?* — [nickbostrom.com](https://nickbostrom.com/superintelligence); forms of superintelligence — [summary](https://www.lesswrong.com/posts/semvkn56ZFcXBNc2d/superintelligence-5-forms-of-superintelligence).
- Omohundro, *The Basic AI Drives* (2008) — [overview](https://ai.miraheze.org/wiki/Instrumental_convergence); MIRI, *Formalizing Convergent Instrumental Goals* — [PDF](http://intelligence.org/files/FormalizingConvergentGoals.pdf).
- *The Logic of Machine Self-Preservation* — [arXiv 2608.20940](https://arxiv.org/html/2608.20940).
- Soares, Fallenstein, Yudkowsky, Armstrong, *Corrigibility* (AAAI workshop, 2015) — [PDF](https://intelligence.org/wp-content/uploads/2024/10/Corrigibility.pdf), [MIRI announcement](https://intelligence.org/2014/10/18/new-report-corrigibility/).
- Thornley, *The Shutdown Problem* — [arXiv 2403.04471](https://arxiv.org/pdf/2403.04471.pdf); shutdown instructability — [arXiv 2305.19861](https://arxiv.org/html/2305.19861v1).
- Hubinger et al., *Risks from Learned Optimization in Advanced Machine Learning Systems* — [arXiv 1906.01820](http://arxiv.org/pdf/1906.01820v2), 2019; deceptive alignment — [Alignment Forum](https://www.alignmentforum.org/s/r9tYkB2a8Fp4DN8yB/p/zthDPAjh9w6Ytbeks).
- Bai et al., *Constitutional AI: Harmlessness from AI Feedback* — [arXiv 2212.08073](https://arxiv.org/abs/2212.08073), December 2022.
- Offline/air-gapped build practice — [vendoring dependencies](https://www.dermitch.de/post/offline-dependencies-js-yarn-python/), [air-gapped deployment guide](https://semaphore.io/blog/air-gapped-deployments-how-to-deploy-to-servers-without-internet-access-complete-guide).

**Internal sources** (read, not modified): `RAMA_AGI_MASTER_SPEC.md` §28 (invariants I1–I17,
ledger rows 1–142) and §§110–122; every file cited by path in §1 and §6.




