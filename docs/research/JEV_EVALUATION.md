# Does Jev add value to Rāma? A research-and-decision document

**Status:** research only. No code was changed, no dependency added, no worktree created.
**Written:** this session, against the `dev` branch at commit `94b3d41`, working tree clean.
**Audience:** master (Krishna Prasad). The recommendation is in §1 and repeated in `JEV_SUMMARY.md`.

---

## 0. Which thing this evaluates, and why — the Jev / JEPA disambiguation

**This document evaluates Jev, the hosted "System One" decision model from TypeSafe AI.** Master
wrote "JEV", and there are two unrelated things that name can reach. They are not the same work,
not the same decade, and not the same kind of artefact, so the choice is stated before anything
else.

- **Jev** — a proprietary, hosted model released by TypeSafe AI, dated **15 September 2026** by
  [Sanity's glossary entry](https://www.sanity.io/glossary/jev-typesafe-ai-model) (published
  18 Oct 2026). You send it state plus typed questions; it returns a choice from an enumerated
  option set, a position on a rubric, or the probability that a statement is true. It never emits
  prose. TypeSafe calls this a *System One model*, a category it coined, and the
  [Wikipedia entry for Jev (AI model)](https://en.wikipedia.org/wiki/Jev_(AI_model)) records that
  the name nods to Kahneman's fast System 1 thinking. The
  [name's second origin](https://github.com/zeke/jev) is William Stanley Jevons, whose paradox is
  that falling unit cost raises total consumption. **This is the thing master asked about, and the
  thing evaluated below.**
- **JEPA** — Joint Embedding Predictive Architecture, a **self-supervised representation-learning
  objective** from the LeCun line of work: predict in representation space rather than in token or
  pixel space. It is a *training* method, not an API and not a decision layer.
  [I-JEPA](https://arxiv.org/abs/2301.08243) is from 2023;
  [LLM-JEPA](https://arxiv.org/html/2509.14252v2) and
  [VL-JEPA](https://arxiv.org/abs/2512.10942) extend it to language and vision-language.

**They are unrelated.** Jev is a product you call over HTTPS; JEPA is a loss function you train
with. **JEPA is not materially relevant to Rāma** and therefore gets no section of its own: Rāma
trains no models, has no GPU, and cannot run its own Python engine (§7.1). Adopting a JEPA-style
pre-training objective is not a decision available to this project. That the two names collide is
worth knowing precisely so a later session does not research the wrong one.

*Content was rephrased for compliance with licensing restrictions.*

---

## 1. The recommendation

**Do not adopt hosted Jev. Not yet, and on the present evidence, probably not at all.**

The reason is not that Jev is bad. The independent evidence says it is a competent, cheap, fast,
reasonably calibrated typed classifier. The reason is that **Rāma has nothing for it to displace.**

The financial and speed case for Jev rests on replacing LLM calls that are being made today to do
bounded classification work. **MEASURED-HERE: across the twenty-one decision points inventoried in
§4, zero currently invoke a language model.** Every one of Rāma's gates — `claimGate`,
`egressBoundary`, `autonomyPolicy`, `capability`, `modelRoles`, `dependencyAdvisor`,
`ollamaCatalog.classify`, `badgeLabel` — is deterministic code over declared data. There is no
per-decision model spend to reduce, so the honest cost saving from adopting Jev on Rāma's existing
gates is **0%**, and the honest speed saving is **negative**, because a network round trip replaces
a function call.

What Jev could genuinely do is **add judgements Rāma does not currently make**. There are five of
those (§4.3), and the best of them — a per-turn sensitivity classifier for `egressBoundary` — is a
real, acknowledged hole. But for that specific hole, **the local alternative is strictly better on
every axis master cares about**: Ollama's JSON-schema constrained decoding already gives a typed
answer from an enumerated set, at zero cost, with zero new egress surface, without reversing the
Ollama-only scope decision, and without sending the one thing the gate exists to protect to a third
party in order to ask whether it is private (§8.3 — this last point is close to decisive).

**What I recommend instead:** build the missing per-turn sensitivity producer locally, as a
small-model-plus-schema reflex with a deterministic keyword prefilter that fails closed. That is
stage 1 of §10, it needs no new vendor, no new key, no scope reversal, and it has a falsifiable
success criterion. Revisit Jev only if that pilot measurably fails for a reason Jev would fix.

**The one decision only master can make:** whether the Ollama-only scope (ledger row 150,
SECTION 130.9) may be reversed. Everything else in this document is engineering. If the answer is
no — and §7 argues it should be — then hosted Jev is out of scope and the question is closed
without needing the rest of the analysis.

---

## 2. What Jev is, and what it is not

### 2.1 The interface

Three primitives, per the independent benchmark paper
([Deußer, Sparrenberg and Sifa, arXiv 2609.37647, 29 Sep 2026](https://arxiv.org/html/2609.37647v1)):

| Primitive | What it returns | Bound |
|---|---|---|
| **Choice** | one option from an enumerated set, plus a probability per option and a confidence | up to 255 options |
| **Score** | a position on an ordered rubric, probability-weighted | 2–10 described levels |
| **Noul** | the probability that a yes/no statement is true | — |

All questions in one request share one state and are answered independently in a single pass. The
state accepts a string, a JSON object or an array, up to **32k tokens** including the longest
question. INDEPENDENT (same paper).

### 2.2 What it is not

- **Not a chat model.** It cannot write a sentence. The
  [Arize write-up](https://arize.com/blog/typesafe-jev-llm-judge/) (18 Sep 2026) puts it as a model
  that classifies, scores and routes but cannot produce prose.
- **Not self-hostable.** The vendor-adjacent
  [Jev landing page](https://www.jevtypesafeai.com/) states the tooling around it is open —
  `awesome-jev`, `jev-mcp`, the LangChain integration — while the model itself runs on TypeSafe's
  servers. VENDOR-adjacent claim, consistent with every other source read.
- **Not a reasoner.** [DataCamp's tutorial](https://www.datacamp.com/tutorial/jev-api-tutorial)
  (22 Oct 2026) notes it cannot count, cannot do date arithmetic, and reads questions literally.
  Independently measured: [etsabary/jev-deterministic-benchmark](https://github.com/Yifan-Lan/awesome-jev-robustness)
  recorded 97–100% on static logic but **13.2% on sequential state mutation and 33.3% on exact
  counting** over 1,000 decisions. INDEPENDENT.
- **Not incapable of error.** [Firecrawl's explainer](https://www.firecrawl.dev/blog/what-is-jev)
  (16 Oct 2026) states the point exactly: "cannot hallucinate" means it cannot return a value
  outside your schema; it can still be wrong. This is §9's whole subject.

*Content was rephrased for compliance with licensing restrictions.*

### 2.3 Provenance of the mechanism

TypeSafe has not published the architecture. RLCD (reinforcement learning from contrastive
distillation) is referenced in the surrounding literature as a training method. The most informative
account of *how such a thing can work* comes from the open reconstructions rather than the vendor:
[daseinlabs/open-jev](https://github.com/daseinlabs/open-jev) describes prefilling the context once,
expanding that KV cache across the option batch, and scoring every option in a single padded forward
pass by the log-probability of its tokens, with a softmax over option scores giving a distribution.
**No decoding.** That is a mechanism Rāma could in principle reproduce; §8.2 assesses whether it can
reproduce it *here*.

---

## 3. The figures, every one tagged with its provenance

This is the section master's honesty standard bears on hardest. Rāma's own
`electron/lib/claimGate.cjs` fixes a claim vocabulary at `grounded | reflex | prose | unattributed`
and `electron/lib/selfModel.cjs` carries every fact as `{ value, source, measured }` with `null`
rather than `0` where nothing was measured. The same discipline applies below.

### 3.1 VENDOR claims

| Figure | Claim | Source |
|---|---|---|
| **up to 200x faster** | vs comparable LLMs on classification-shaped work | [LangChain, 21 Oct 2026](https://blog.langchain.com/building-a-harness-with-jev?ref=explainx) repeating TypeSafe's own number |
| **up to 400x cheaper** | same comparison | same |
| **193.6x / 444.6x** | the precise figures behind the round numbers: ~$0.000081 and 0.114 s per decision against $0.01388 and 8.566 s for an LLM | [a2aprotocol summary of TypeSafe's site, 18 Oct 2026](https://a2aprotocol.ai/insights/2026-jev-system-one-model-guide) |
| **70–500 ms end-to-end** | latency band | [Hyperstack, 18 Oct 2026](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model) |
| **calibrated probabilities** | a stated 0.8 is right about 80% of the time | [OpenRouter explainer, 20 Oct 2026](https://openrouter.ai/blog/insights/what-is-jev/) |

**The 200x/400x pair does not survive independent measurement**, and that matters more than any
other single fact in this document. §3.2 shows why. A vendor ratio built against an 8.5-second
frontier-LLM baseline is a ratio against a badly-chosen denominator; nobody doing classification at
volume uses an 8.5-second call for it.

### 3.2 INDEPENDENT measurements

| Figure | Measurement | Methodology note | Source |
|---|---|---|---|
| **$9.15 for 346,009 requests** | 217.9M input tokens, 630 input tokens per request on average, over 37 datasets | full evaluation splits, one frozen template per dataset, `jev-1.13.0` pinned | [Deußer et al., arXiv 2609.37647](https://arxiv.org/html/2609.37647v1) |
| **0.36 s mean request latency** | client-side, at 32 concurrent requests | includes network time; throughput was capped by the rate limit, not the service | same |
| **5.43x faster than Claude Haiku 4.5** | p50 classifier latency 126.81 ms vs 688.40 ms; 3.88x at p95; 5.21x by mean | 80 synthetic cases × 3 reps = 240 calls per classifier, 18 Sep 2026; clustered-bootstrap CI 5.20–5.71x | [LiteLLM benchmark](https://docs.litellm.ai/blog/jev-auto-router-benchmark) |
| **96.1% lower classifier cost** | $0.0077 vs $0.1985 for 240 calls; CI 95.97–96.27% | registry-priced, same 240 calls | same |
| **95.00% vs 73.75% tier match** | against the benchmark author's own frozen labels | labels authored by the same person who wrote the prompts, **no blind adjudication** — the authors say so themselves | same |
| **~2.2x faster than a nano-class LLM** | median call 0.42 s vs 0.92 s on the same 30 items | the authors state explicitly this is not the 40–200x the vendor comparisons imply | [ickma2311/jev-baselines-eval](https://github.com/ickma2311/jev-baselines-eval) |
| **+7.5 pp over `gpt-5.4-nano`, −4.5 pp vs frontier** | CLINC150 zero-shot; paired 95% CI [+3.0, +12.5] and [+2.0, +7.5] respectively | pre-registered | same |
| **81.0% vs 84.4%** | Jev against Claude Opus 5 on a classification set | CIs 79.6–82.3 and 83.1–85.6 — the frontier model is ahead and the intervals do not overlap | [OpenRouter, 20 Oct 2026](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/) |
| **42 of 49 tasks matched or beat an LLM baseline, ~1/7 latency, ~1/4 cost** | lost on counting and on a 77-option classification | author's own harness | [OmarMujahid/jev-decision-bench](https://github.com/OmarMujahid/jev-decision-bench) |
| **beats Qwen3.8-27B on 27/37, Gemma-4-E4B on 37/37** | open models scored on *identical requests* via exact next-token option probabilities | the fairest comparison in the literature, because the readout is matched | [Deußer et al.](https://arxiv.org/html/2609.37647v1) |
| **no independent accuracy advantage from the typed readout** | meta-review of 28 early typed-decision-model papers; Jev's clearest gains are **latency and cost**, not accuracy | 28 papers, posted 19–24 Sep 2026 | ["Typed Decision Models: An Early Evidence Audit"](https://github.com/Yifan-Lan/awesome-jev-robustness) |

**So the honest speed and cost picture is this.** Against a *frontier chat model asked to classify*,
Jev is roughly **2–7x faster and ~25x cheaper** (96% cost reduction is a 25.7x factor, not 400x).
Against an *open-weight model scored by its own option probabilities*, Jev wins on accuracy on most
datasets but the typed interface itself contributes none of that edge. **The 200x/400x pair is a
vendor figure with no independent corroboration at that magnitude, and two independent groups
measured ratios one to two orders of magnitude smaller.** Where this document needs a speed or cost
multiplier, it uses the independent one.

### 3.3 MEASURED-HERE

| Figure | Derivation |
|---|---|
| **Core Ultra 5 135U, 12 physical / 14 logical cores** | `Get-CimInstance Win32_Processor` on this machine |
| **31.43 GB usable RAM** | `Win32_ComputerSystem.TotalPhysicalMemory` ÷ 1024³ |
| **One DIMM, 32 GB, 5600 MT/s, slot `Controller0ChannelADimm0`** | `Win32_PhysicalMemory` returned exactly one row → **single-channel confirmed, not inferred** |
| **44.8 GB/s peak memory bandwidth, against 89.6 GB/s if the second channel were populated** | 5600 MT/s × 8 bytes per 64-bit channel = 44.8 GB/s; ×2 channels = 89.6. Arithmetic shown; this is the binding constraint on all local inference on this box |
| **No discrete GPU** | `Win32_VideoController` reports only `Intel(R) Graphics` |
| **Python 3.14.4 on PATH** | `python --version`. `requirements.txt` pins `numpy==1.26.4`, which publishes no wheel above CPython 3.12 (`RAMA_AGI_MASTER_SPEC.md` §9377–9378) |
| **0 of 21 decision points invoke a model** | §4 table; derivation in §4.2 |
| **5 of 21 decision points (23.8%) are candidates for an added typed judgement** | §4.3; denominator stated and limits given in §4.4 |
| **Per-conversation-turn sensitivity classification: no producer exists** | `src/pages/Chat/Chat.jsx:274` calls `converse` with `{ text, turns, revealedPrompt, user, turnId }` and **no `sensitive` field**; `electron/ipc/modelRouter.cjs:515` defaults `sensitive = false`; `grep sensitive src/**/*.jsx` returns **zero matches**. Therefore every turn crosses as non-sensitive today |

### 3.4 What has no honest number at all

- **The share of Rāma's actual runtime cost that these decision points represent.** There is no
  per-call cost or latency telemetry anywhere in this codebase. I can count decision *points*; I
  cannot weight them by how often they fire or what they cost. Any percentage of *cost* would be
  invented. **Bound instead: it is between 0% and 100%, and most likely near the low end, because
  none of them calls a model.**
- **Any figure for the 16 GB second machine.** Master's own note records it as unmeasured. It stays
  unmeasured here.
- **Jev's throughput under Rāma's actual request shapes.** Nobody has measured that, because no
  such integration exists.

No composite score, index or grade is computed anywhere in this document. A previous Rāma module
shipped invented capability integers behind a geometric mean and had to be deleted; the figures above
are reported separately and stay separate.

---

## 4. Rāma's decision surfaces — the inventory, read from the code

Every row below was read, not guessed. Paths are relative to
`c:\CodeBase\Velvet_UI\Velvet\Rama_AGI\`.

Columns: **Bounded?** = is the answer space enumerable in advance. **LLM today?** = does this
decision currently involve a model call. **Typed layer?** = could a single-pass typed model serve it,
and what would happen if it did — `ADD` (a judgement that does not exist today), `REGRESS` (it would
replace a provable rule with a probabilistic one), `FORBIDDEN` (an invariant bars it), or `NO`
(technically possible, evidentially a bad idea).

### 4.1 The table

| # | Surface | The decision it makes | Bounded? | LLM today? | Typed layer? |
|---|---|---|---|---|---|
| 1 | `electron/lib/claimGate.cjs` → `classifyOne` | one of `grounded`\|`reflex`\|`prose`\|`unattributed` per claim | **Yes**, 4 values, frozen in `CLASS` | **No** | **REGRESS** — see §9.3 |
| 2 | `electron/lib/egressBoundary.cjs` → `classifyElement`/`levelPermitted` | enforce `public`\|`internal`\|`private` on every outbound element | **Yes**, 3-level lattice | **No** | **REGRESS** for enforcement; the *producer* is #3 |
| 3 | `electron/lib/conversationRole.cjs` → the `sensitive` flag | is this turn about master's holdings | **Yes**, boolean | **No** | **ADD** — ← **the pilot**, no producer exists |
| 4 | `electron/lib/modelRoles.cjs` → `evaluate` | `declared`\|`substitute`\|`none` per (role, model) | **Yes**, 3 values | **No** | **REGRESS** — threshold arithmetic over declared metadata |
| 5 | `electron/lib/modelRoles.cjs` → `selectForRole` ranking | one model from N, with a stated reason | **Yes** | **No** | **REGRESS** — the auditable comparator is the feature |
| 6 | `electron/ipc/modelRouter.cjs` → `TASK_ROUTING`/`selectModel` | one of 8 task buckets | **Yes**, 8 keys | **No** | **ADD** — `taskType` is *supplied by the caller*, so no classification happens today |
| 7 | `electron/ipc/modelRouter.cjs` → `analyzeCredentialNeeds` | which of 5 credentials a task description implies | **Yes**, 5 services | **No** | **ADD** — currently `desc.includes('stock')`-style substring matching |
| 8 | `electron/ipc/modelRouter.cjs` → `credentialStatus`/`checkAvailable` | `available`\|`not-installed`\|`missing-key` | **Yes**, 3 values | **No** | **NO** — it is a daemon and keystore probe, not a judgement |
| 9 | `electron/lib/dependencyAdvisor.cjs` → `classifyJump` | semver jump kind | **Yes** | **No** | **REGRESS** — version arithmetic; and see the counting evidence in §2.2 |
| 10 | `electron/lib/dependencyAdvisor.cjs` → `assess` | one of 6 `recommend` values × `urgency` | **Yes**, 6 × 4 | **No** | **NO** — and there is *direct* adverse evidence, §6.3 |
| 11 | `electron/lib/releaseChannel.cjs` | upgrade \| update \| fix | **Yes**, 3 values | **No** | **FORBIDDEN** — **I17**: master alone classifies a release |
| 12 | `electron/lib/autonomyPolicy.cjs` → `effective` | `L0`…`L4` over 15 frozen classes | **Yes**, 6 levels × 15 classes | **No** | **FORBIDDEN** — the frozen floors/ceilings *are* the containment |
| 13 | `electron/lib/capability.cjs` → `can`/`deny` | permit or refuse, by tier matrix | **Yes**, boolean | **No** | **FORBIDDEN** — `shared/capabilities.json` is protected under `verifyLoyaltyTripwire.cjs`; a probabilistic access check is a security regression |
| 14 | `electron/lib/ollamaCatalog.cjs` → `classify` | evidence class in `catalog`\|`name`\|`size`\|`none`, plus private/cloud | **Yes**, 4 values | **No** | **REGRESS** — the class *records which deterministic source was available*; a model cannot know that |
| 15 | `electron/lib/ollamaCatalog.cjs` → `scoreCandidate` | recommend-or-exclude, with rank | partly (a ranking) | **No** | **NO** — disk and parameter arithmetic over declared rows |
| 16 | `electron/lib/selfRepair.cjs` → `integrityMatches` | does this tarball match its lockfile integrity hash | **Yes**, boolean | **No** | **REGRESS** — replacing a SHA check with a judgement is the clearest possible regression in this list |
| 17 | `electron/lib/badgeLabel.cjs` → `statusLabel` | one of 3 window states → a label | **Yes**, 3 values | **No** | **NO** — a frozen lookup table |
| 18 | `electron/ipc/intelligenceEngine.cjs` → the grounding gap | **does this source actually support this claim** | **Yes** as a Noul | **No** | **ADD** — the strongest *additive* candidate; §4.3 |
| 19 | `electron/ipc/vectorMemory.cjs` → `search` | is this memory relevant (TF-IDF cosine ≥ 0.3) | partly (a rerank) | **embedding only**, local `nomic-embed-text` on `localhost:11434` with a TF-IDF fallback | **ADD** (rerank), but see §6.4 |
| 20 | `electron/ipc/astEngine.cjs` → `qualityScore` | a 0–100 code-quality number | rubric-shaped | **No** | **NO** — invented arithmetic (`100 − issues×5`); replacing it with a *learned* rubric score re-creates exactly the composite number master had deleted |
| 21 | `electron/ipc/marketIntel.cjs` → `predict`/`backtest`/`strategyScore` | numeric forecasts and strategy scores | **No** — continuous | delegated to the Python engine, **which has never run here** | **NO** — Jev cannot count or do date arithmetic (§2.2) |

### 4.2 The count, and the denominator

**Denominator: 21 named decision points across 15 modules**, chosen as every exported function or
frozen table in the modules master named that *selects from a set or returns a gate verdict*. The
boundary is stated so it can be argued with: I excluded pure data transforms, IPC plumbing, and HTTP
helpers, and I included three surfaces master did not name (#3, #16, #19) because reading the code
showed they belong.

From that denominator:

- **Bounded and enumerable answer space: 18 of 21 (85.7%).** The three that are not are #15
  (a ranking), #19 (a continuous similarity) and #21 (continuous forecasts).
- **Involve a language model today: 0 of 21 (0%).** Verified by searching all twelve gate modules
  for `ollama|models:chat|generate(|invokeModel|modelRouter`: `claimGate`, `dependencyAdvisor`,
  `releaseChannel`, `selfRepair`, `capability` and `astEngine` returned **zero** references of any
  kind. The non-zero counts in `modelRoles` (9), `ollamaCatalog` (29), `egressBoundary` (6) and
  `vectorMemory` (6) are references to model *metadata*, the daemon probe, or — in `vectorMemory`
  alone — a **local embedding** call (`nomic-embed-text` on `localhost:11434`, free, private, with a
  TF-IDF fallback). **No generative inference is performed by any gate.**
- **Where a typed single-pass model would ADD a judgement that does not exist today: 5 of 21
  (23.8%)** — #3, #6, #7, #18, #19.
- **Where it would REGRESS a provable rule into a probabilistic one: 7 of 21 (33.3%)** —
  #1, #2, #4, #5, #9, #14, #16.
- **Where an invariant forbids it outright: 3 of 21 (14.3%)** — #11 (I17), #12, #13.
- **Where it is merely a bad idea on the evidence: 6 of 21 (28.6%)** — #8, #10, #15, #17, #20, #21.

### 4.3 The five genuine candidates, ranked

1. **#3 — per-turn conversation sensitivity.** The hole is real and the spec already admits it:
   `RAMA_AGI_MASTER_SPEC.md` §131.6 records that with no context store built, every payload part
   today is a bare string resolving to `public` *and the gate refuses nothing in production*.
   `modelRoles.cjs`'s `conversation` role carries a long comment explaining — correctly — that a
   table-level `sensitive` flag cannot be right for a conversation carrying both "what is the rupee
   doing" and "should I sell my position", and that the gate must therefore be per-turn at the call
   site. **That call site never sets it.** Answer space: boolean. This is item 4 in master's queue
   and it is the right pilot. §8.3 explains why it should nonetheless be built *locally*.
2. **#18 — does this source support this claim.** `claimGate.cjs`'s own header states the limit
   plainly: it decides *attribution*, not truth, because truth needs entailment, which needs a
   model, which is the thing being contained. `intelligenceEngine.cjs` used to paper over this with
   an `overallConfidence: 78.4` computed from domain reputation and keyword overlap; Sections 110/111
   deleted it, correctly. So there is a **genuine, acknowledged capability gap** with nothing in it.
   A Noul over (claim, source) is exactly the right shape for it. This is the one place where a
   typed decision layer would strictly add capability rather than substitute for one.
3. **#19 — reranking retrieved memory.** Today a TF-IDF cosine with a hardcoded 0.3 floor.
   Reranking was a measured strength in [OmarMujahid's bench](https://github.com/OmarMujahid/jev-decision-bench).
   But §130.9 of the spec already concluded reranking has no respectable answer either way, and the
   current path is local and free.
4. **#6 — task-type classification.** 8 buckets, no producer; the caller supplies the label. Low
   value because the caller usually knows.
5. **#7 — credential need from a task description.** 5 services, currently substring matching that
   misses any paraphrase. Genuinely brittle, genuinely low stakes.

### 4.4 What this count can and cannot support

**It can support:** "23.8% of Rāma's identified decision points are places where a typed decision
layer would add a judgement that does not exist today, and 0% of them currently spend anything on a
model."

**It cannot support any percentage of cost, latency or value**, and master asked for a percentage.
The honest answer to "by how much does it add value as a percentage of existing infrastructure" is:

> **On cost: 0%, because the denominator is zero — no model spend exists on these surfaces to
> reduce.** On capability: 5 new judgements against 21 existing decision points, but those five are
> not currently *wrong*, they are *absent*, so there is no error rate to improve on and no
> before-measurement to compare against. On speed: negative for the 16 surfaces that are function
> calls today and would become network round trips.

That is the whole honest answer, and a single value cannot be derived from this codebase because
**no per-call cost or latency telemetry exists in it.** If master wants a real percentage, the thing
to build first is the telemetry, not the integration.

---

## 5. The financial case

### 5.1 What Rāma spends today

Master runs **free Ollama models** and holds **one Ollama API key**. The spec records what the free
cloud tier actually constrains (`RAMA_AGI_MASTER_SPEC.md` §131.7): **one concurrent request plus a
monthly credit pool**, not a per-minute rate. Rāma enforces `maxConcurrent: 1` with slot
reserve/release inside `resourceOrchestrator`, and a courtesy ceiling of **16 requests/minute**.

So the baseline is: **₹0 / $0 marginal cost per decision, with a hard ceiling of one concurrent
cloud inference.**

### 5.2 What Jev would cost

Pricing is **$0.042 per million input tokens, output free** —
[OpenRouter's `~typesafe/jev-latest` listing](https://openrouter.ai/~typesafe/jev-latest), and the
same figure independently recorded by [Deußer et al.](https://arxiv.org/html/2609.37647v1). VENDOR
for the price itself; INDEPENDENT for the observed spend.

Derivation, MEASURED-HERE from the independent paper's own numbers:

```
$9.15 / 346,009 requests          = $0.00002644 per request   (avg 630 input tokens)
1,000 decisions/day × 365         = 365,000 decisions/year
365,000 × $0.00002644             = $9.65/year
```

Rāma's requests would be smaller than 630 tokens for #3 and #7 (a single turn plus one question) and
larger for #18 (a claim plus a retrieved document, which can be thousands of tokens). Taking a
pessimistic 3,000-token average for a grounding check:

```
3,000 tokens × $0.042 / 1,000,000 = $0.000126 per grounding check
10 checks/answer × 20 answers/day × 365 = 73,000 checks/year
73,000 × $0.000126                = $9.20/year
```

**MEASURED-HERE (arithmetic over the published price): on the order of $10–20 per year at Rāma's
plausible volumes.** That is not a lot of money. It is, however:

- **not zero**, against a baseline that is exactly zero;
- **a paid dependency**, which requires master to put a payment method on file. OpenRouter bills Jev
  to the OpenRouter account ([OpenRouter's Jev guide](https://openrouter.ai/docs/guides/community/jev));
  a [third-party access roundup](https://juliangoldie.com/jev-ai-api/) notes a Vercel AI Gateway
  free window that required a card on file and has since expired (25 Sep 2026);
- **a second vendor relationship** on top of Ollama, with its own key to vault, rotate and never
  speak — Rāma already has a ledger row (151) for the discipline the *first* key needed;
- **unbudgeted.** Master has not said there is a budget. Any recommendation that assumes one is
  assuming something master did not say.

### 5.3 Where the real money is, and it is not here

The honest financial finding is that **Rāma's decision layer is not a cost centre.** It costs
nothing because it runs no models. The expensive part of Rāma is the conversation and research path
— genuine generation — and Jev cannot touch that by construction.

The one financial argument that *does* hold: a Jev call would not consume Rāma's **single
concurrent cloud inference slot**, because it is a different provider. On a free tier where
concurrency 1 is the binding constraint, offloading a gate decision to a different endpoint buys
back the slot for the conversation master is waiting on. **That is a real and specific benefit.** It
is also fully obtained by doing the classification on the *local* daemon instead, which also does not
consume the cloud slot, and costs nothing.

### 5.4 Jevons' paradox, which the model is named after

[Sophos' analysis](https://www.sophos.com/en-us/blog/jevs-paradox-hidden-cost-of-cheap-ai-decisions)
(29 Oct 2026) makes the point that the name invites: if automated decisions become cheap enough to
run on everything, teams run far more of them, and any error rate above the current baseline
multiplies into more total mistakes. **For Rāma this is not an abstraction.** Rāma's gates currently
have an error rate of *zero on their own terms* — a SHA either matches or it does not, a tier is
either ≤ the required tier or it is not. Making judgement cheap is precisely how a project with
provable gates acquires probabilistic ones.

*Content was rephrased for compliance with licensing restrictions.*

---

## 6. The resource and speed case, on master's actual hardware

### 6.1 The binding constraint, measured

MEASURED-HERE this session:

- **Intel Core Ultra 5 135U**, 12 physical / 14 logical cores.
- **31.43 GB RAM in a single DIMM** (`Win32_PhysicalMemory` returned exactly one row, slot
  `Controller0ChannelADimm0`, 5600 MT/s). **Single-channel is confirmed by the row count, not
  inferred from a spec sheet.**
- **44.8 GB/s peak memory bandwidth** (5600 MT/s × 8 bytes), against **89.6 GB/s** if the second
  slot were populated. Shown as arithmetic, not quoted.
- **No discrete GPU** — `Win32_VideoController` reports only `Intel(R) Graphics`.

For CPU inference, decode throughput is bounded by how fast weights can be streamed from RAM. At
44.8 GB/s, a Q4 model with *A* GB of active weights has a hard ceiling near `44.8 / A` tokens per
second before any other overhead. A 7B Q4 model (~4.1 GB) ceilings around 11 tok/s; a 1B-active MoE
(~0.6 GB active) ceilings an order of magnitude higher. **This is why the local path for a
*classification* is viable on this box even though the local path for *conversation* is not.**

### 6.2 What Jev would actually change

| Surface class | Today | With hosted Jev |
|---|---|---|
| 16 surfaces that are deterministic function calls | **microseconds**, in-process | **126–500 ms** network round trip, plus failure modes that do not exist today |
| #3, #7 — small typed judgements (not built) | n/a | ~126–400 ms (INDEPENDENT, [LiteLLM p50 126.81 ms / max 401.26 ms](https://docs.litellm.ai/blog/jev-auto-router-benchmark)) |
| #18 — grounding check (not built) | n/a | ~0.36 s mean (INDEPENDENT, [Deußer et al.](https://arxiv.org/html/2609.37647v1)) |
| Conversation, research, code generation | local or cloud LLM | **unchanged** — Jev cannot generate |

**The speed case is therefore the inverse of how it is usually presented.** On 16 of 21 surfaces,
Jev is a *slowdown* of several orders of magnitude. On the five candidates it is a new latency cost
against a baseline of "this judgement is not made at all". There is no surface where Jev makes
something Rāma already does faster — because nothing Rāma already does is an LLM classification.

### 6.3 One directly adverse independent measurement, worth naming

[scarif-labs/jev-software-decision-benchmark](https://github.com/Yifan-Lan/awesome-jev-robustness)
evaluated Jev on **dependency auto-merge decisions** — surface #10, almost exactly. In distribution
it reached AUROC 0.851. Out of distribution, the tuned threshold **failed to transfer: 50% precision
and 15 unsafe merges across 185 cases**. INDEPENDENT. That is a direct measurement of the nearest
published analogue to `dependencyAdvisor`, and it says the deterministic version is the safer one.

### 6.4 Reranking

[OmarMujahid's bench](https://github.com/OmarMujahid/jev-decision-bench) found reranking among Jev's
biggest leads, which argues for #19. Against that:
[yodablocks/jev-orderby-bench](https://github.com/Yifan-Lan/awesome-jev-robustness) pre-registered
six gates and found **four of six failed on graded product relevance**, that **40 rows per request
broke a gate one row per request passed**, and that **53 of 360 rows tied at 0.99** — a ranking
signal that saturates cannot rank. INDEPENDENT, both. The evidence is genuinely mixed and #19 should
not be the pilot.

---

## 7. The constraints that reshape or kill this

### 7.1 The Ollama-only decision — a scope reversal only master can authorise

`RAMA_AGI_MASTER_SPEC.md` **§130.9** fixes the scope at *whatever a free ollama.com account reaches*
— local pulls plus Ollama's own cloud free tier — **and nothing else**. The section is explicit that
this **retracts live recommendations already committed to the repository**: `MODEL_LINEUP.md`'s
Google AI Studio and Groq keys, and `CAPABILITY_MODELS.md`'s Groq recommendation for speech and
**guardrail classification**. Ledger row 150 carries it.

**Hosted Jev is a proprietary third-party model reachable via OpenRouter**
([OpenRouter's community guide](https://openrouter.ai/docs/guides/community/jev); also listed on
[Cloudflare Workers AI](https://developers.cloudflare.com/ai/models/typesafe/jev/) and in
[Pydantic AI](https://pydantic.dev/docs/ai/models/typesafe/)). **Adopting it reverses §130.9.** I am
not treating that as permitted. It is a decision for master, and the cost of reversing it is:

- a second vendor and a second key to vault, with the §131.7 discipline re-derived for a new rate
  model and a new failure mode;
- the §130.9 retraction becomes partially un-retracted, so `MODEL_LINEUP.md` and
  `CAPABILITY_MODELS.md` need re-reading to work out which parts come back;
- §130.9's own conclusion is directly contradicted. It states that **guardrail classification is not
  a gap**, because `claimGate.cjs` classifies with no model at all. Adopting Jev for guardrail
  classification is reopening a question master closed with a reason.

**And §130.9 contains an argument that applies to Jev with no modification:** only Ollama models can
fill a declared role at all, because every role call site in `modelRouter.cjs` passes
`Object.values(discoveredOllama)`. A third-party endpoint was always reachable through
`models:chat`'s fallback chain and **never** able to fill a declared role. **A Jev integration would
be architecturally outside the role system** — the same inconsistency §130.9 removed, re-created.

### 7.2 Is there a local or Ollama-compatible path?

This is the most interesting finding in the whole document, and it is favourable — not to Jev, but
to the *pattern*.

**The vendor model: no.** [Jev's own landing material](https://www.jevtypesafeai.com/) states the
model runs on TypeSafe's servers and only the surrounding tooling is open.

**The open reconstructions: several, and they are not equivalent.** There is no single `open-jev`;
there is a cluster, written in the two weeks after release, none of them reproducing TypeSafe's
weights or training:
- [kyegomez/open-jev](https://github.com/kyegomez/open-jev) — a from-first-principles PyTorch
  reconstruction of the ideas. **PyTorch is the blocker, not the enabler** — see below.
- [daseinlabs/open-jev](https://github.com/daseinlabs/open-jev) — the clearest statement of the
  mechanism: prefill once, expand the KV cache across the option batch, score all options in one
  padded forward pass by option-token log-probability, softmax for the distribution.
- [mithalouni/system-one-open](https://github.com/mithalouni/system-one-open) — an open replica on
  Gemma 4 E2B and Gemma 3 270M, trained and served on **Modal** (a hosted GPU service — so not local).
- [GPT-AGI/OpenJev](https://github.com/GPT-AGI/OpenJev) — reproduces the *interface*, explicitly not
  the model or training, and says so.
- **[aiwithenoch/Jev-Skill](https://github.com/aiwithenoch/Jev-Skill) — the one that matters:** a Jev
  harness that targets **TypeSafe, OpenJev, LocalJev, Ollama, vLLM, LM Studio and llama.cpp**, with
  typed decisions, calibration, verification, abstention and CI gates.

**The conclusion: the *pattern* is adoptable without the vendor, over Ollama, within §130.9.** That
is the finding that reshapes the whole question — see §8.

**But the PyTorch path specifically is blocked on this machine, and the blocker is already recorded.**
MEASURED-HERE: `python --version` returns **3.14.4**. `requirements.txt` pins `numpy==1.26.4`, which
publishes no wheel above CPython 3.12 (`RAMA_AGI_MASTER_SPEC.md` §9377–9378 states this and notes
`pip install` would fall back to *compiling* numpy from source rather than failing cleanly). Rāma's
own Python engine **has never successfully run on master's machine** for exactly this reason, and
`marketIntel.cjs` delegates to a service on port 8001 that therefore does not answer. **Any
PyTorch-based local Jev inherits that blocker, plus a no-discrete-GPU constraint, plus 44.8 GB/s of
memory bandwidth.** It is not a path.

### 7.3 Egress and loyalty

Invariants **I15** (loyalty above the hierarchy, a non-conforming core cannot be encrypted and
therefore cannot be persisted) and **I16** (the loyalty matrix sealed in its own envelope, no
accessor ever returns it) are locked and are not re-litigated here. What follows is only an
assessment of a *new* egress surface against them.

**What a Jev call would transmit, per candidate surface:**

| Surface | What goes to TypeSafe | Assessment |
|---|---|---|
| **#3 per-turn sensitivity** | **master's typed turn, verbatim** — there is nothing else to classify | **The worst possible trade.** To ask "is this private?" you must first send it. See §8.3 |
| **#7 credential needs** | the task description | low — usually master's own phrasing of a task, no holdings |
| **#6 task type** | the request text | low-to-moderate, same shape as #3 at lower stakes |
| **#18 grounding check** | the claim **and** the retrieved source document | moderate. The claim may name a holding; narration prompts do by design (`modelRoles.narration` is the one role with `sensitive: true`) |
| **#19 rerank** | the query and candidate memory rows | **high** — vector memory is where master's context accumulates |

**The point that favours Jev, stated precisely.** A Choice or Noul request carries *the state plus
the option set* and returns a typed value. It does **not** carry a system prompt, so
`PERSONA.revealed` — which interpolates master's real name, per `conversationRole.cjs`'s header — is
**never part of a Jev payload**. `conversationRole.cjs` composes the cloud-safe persona positively
from a frozen array of sentences rather than redacting the revealed one, precisely because a
redactor's first unanticipated pattern is a leak that looks like a pass. **A typed decision request
has no persona slot at all, so there is no identifier channel to leak through.** That is a genuine
structural improvement over a prose prompt, and it is the strongest egress argument in Jev's favour.

**The point that kills it for #3.** The argument above is about the *prompt*, and #3's problem is the
*state*. For every other surface the state is incidental; for #3 the state **is** the sensitive
thing. `egressBoundary.cjs` refuses `classification: 'private'` unconditionally, with no override
anywhere, by design. A design that sends the turn to TypeSafe to find out whether it is private has
already done the thing the gate exists to prevent, and no amount of typing the response fixes that.

**Mechanically, it would not even be permitted.** `egressBoundary.assemble` is asserted to be the
one constructor of anything that leaves this machine, its `kind` is frozen to exactly
`['chat', 'search']`, and `options` is **enumerated and never spread** (`OPTION_KEYS` is
`['think', 'format']`). A Jev request is neither a chat nor a search body. Adding a third `kind`
means widening the one module whose entire value is that it is narrow — and `scripts/verifyOllamaCloud.cjs`
section (g) asserts the cloud path contains no second body constructor.

### 7.4 Project rules that constrain any implementation

- **I12 — pinned exact versions, no `^` or `~`.** `@typesafe-ai/sdk` would need an exact pin, and
  the model alias `jev-latest` **must not** be used: [Deußer et al.](https://arxiv.org/html/2609.37647v1)
  explicitly note that the vendor's aliases will move to newer versions, and their own results refer
  to `jev-1.13.0`. Pinning the SDK while the *model behind the alias* floats is a pin in name only.
  Any adoption pins `typesafe/jev-1.13`, not the alias.
- **I12 — no `console.log` in shipped code.** `console.warn`/`console.error` only, as
  `ollamaCloud.cjs` already does for refusals.
- **I11 — upgrades are additive, always a fallback.** Any Jev path needs a working answer for
  "TypeSafe is down, the key is unset, or the key is revoked". For #3 that fallback must **fail
  closed** (treat the turn as sensitive → route local), which means the deterministic path has to
  exist and be good enough anyway — which is most of §8's argument.
- **No placeholders or TODOs**, and `shared/capabilities.json` is a protected file, so any new
  capability entry is **specified for master, not added**.
- **MEASURED-HERE caveat on verification:** `node_modules` is present in this workspace, but
  `vite build` was not run and is not claimed to pass. Nothing was built or installed for this
  document, because this is research only.

---

## 8. The honest alternative: do nothing, or do it locally

This section is the real comparison, and it is not a straw man. It is where the recommendation
comes from.

### 8.1 Option A — do nothing

**Cost: $0. Risk: the five absent judgements stay absent.**

For 16 of 21 surfaces this is simply correct and needs no defence: a SHA check, a tier comparison
and a semver parse do not want a model. For the five candidates, doing nothing has a specific,
nameable cost:

- **#3 is a live hole.** Every conversation turn crosses as non-sensitive (MEASURED-HERE, §3.3).
  Doing nothing means a turn in which master asks about his own position is eligible for a cloud
  model. That is the thing master raised, and it should not be left.
- **#18 is a capability ceiling**, not a hole. Rāma withholds rather than asserting, so the failure
  mode is *withholding something true*, which `claimGate.cjs`'s own header says it errs toward
  deliberately. Doing nothing here is tolerable indefinitely.
- **#6, #7, #19 are cosmetic.** Doing nothing costs nothing material.

**So: do nothing is the right answer for 20 of 21 surfaces, and the wrong answer for #3.**

### 8.2 Option B — a small local Ollama model doing the same typed work

This is the option that wins, and here is the mechanism, which is not speculative.

**Ollama already supports schema-constrained decoding.** Passing a **JSON Schema object** (not the
bare string `"json"`) to the `format` parameter constrains generation at the token level:
[Ollama's structured-outputs documentation](https://docs.ollama.com/capabilities/structured-outputs)
describes enforcing a schema on responses, and
[Ollama's API reference](https://docs.ollama.com/api/generate) confirms `format` accepts either
`"json"` or a schema object. A practitioner account spells out the enforcement precisely: at each
generation step the probability of any token that would violate the schema is set to zero, so the
model **physically cannot** emit a fence, a preamble or a structurally invalid object
([dev.to, 25 Oct 2026](https://dev.to/syed_anzar/your-llm-returns-json-that-isnt-json-a-robust-structured-output-pipeline-for-local-models-2pm9)).

**What that buys, exactly:** a `{"sensitive": true|false}` schema with an enum makes the
out-of-schema answer *unreachable*. That is **the same structural guarantee Jev's typed output
provides** — the "cannot fabricate prose" property — obtained from a model already on master's disk.

**What it does not buy:** a *calibrated distribution over the option set*. A single constrained
decode gives you the chosen enum, not a trustworthy probability. That is the real, specific thing
Jev adds, and §9.4 assesses how much it is worth given that independent audits found Jev's own
calibration varies sharply by task.

**And Rāma is already plumbed for it.** `egressBoundary.cjs`'s `FORMATS` constant is
`[null, 'json']` and `OPTION_KEYS` includes `format`, so the JSON path is already an enumerated,
reviewed option on the outbound envelope. Widening `FORMATS` to accept a schema object is a change
*inside* an existing enumerated surface — categorically smaller than adding a third request `kind`.

**Hardware feasibility, MEASURED-HERE (§6.1):** at 44.8 GB/s, a small model emitting **one or two
constrained tokens** is bounded by prefill, not decode. Prefill on this CPU for a few hundred tokens
of state is well inside a second. A 7B Q4 model ceilings near 11 tok/s on decode — hopeless for
prose, entirely adequate for a two-token answer. **A classification is the one local-inference
workload this machine is actually good at.**

**Cost: $0. Egress: zero — `localhost:11434`. Scope: inside §130.9. New vendor: none. New key:
none.**

### 8.3 Why local wins on #3 specifically, and it is not close

| | Hosted Jev | Local Ollama + schema |
|---|---|---|
| Must transmit master's turn to a third party to ask if it is private | **yes** | **no** |
| Cost per decision | ~$0.000026 (INDEPENDENT) | **$0** |
| Latency | 126–400 ms p50–max (INDEPENDENT) | sub-second prefill-bound (not measured here) |
| Reverses §130.9 | **yes** | no |
| Needs a new `egressBoundary` request kind | **yes** | no — `format` is already enumerated |
| Fails closed when unavailable | needs building | needs building (same work) |
| Calibrated option probabilities | **yes** | no |
| Survives the machine being offline | **no** | **yes** |

**The first row is on its own sufficient.** Sending a turn off the machine in order to find out
whether it may go off the machine is a contradiction, not a tradeoff. The last row is nearly as
strong: Rāma is a local-first agent on a laptop, and a sensitivity gate that stops working without
a network is a gate that stops working.

### 8.4 Option C — adopt the Jev *pattern* over local models

This is Option B with the vendor's interface discipline borrowed rather than its endpoint. It is
what [aiwithenoch/Jev-Skill](https://github.com/aiwithenoch/Jev-Skill) does: the typed-decision
harness, calibration, verification and abstention, over Ollama / vLLM / llama.cpp.

**The idea worth stealing is not the model. It is three design rules**, and all three are supported
by independent measurement:

1. **Enumerate the answer space in advance and include an explicit abstain option.** This is the
   single most important finding in the robustness literature, and §9.4 gives the numbers.
2. **Decompose one hard judgement into several easy ones and combine them in code.**
   [anisselbd/jev-phishing-bench](https://github.com/Yifan-Lan/awesome-jev-robustness) measured
   62.6% as one question against **95.0%** for the same judgement split into five signal questions
   combined deterministically. INDEPENDENT, n=2,000 emails. **This is a free, vendor-independent
   accuracy improvement available to any typed-decision design**, and it is exactly the shape
   `claimGate.cjs` already uses — it checks dates, figures, entities and modality as separate
   deterministic tests rather than asking one big question.
3. **Keep the final permission decision in code, never in the model.** The model proposes; the
   deterministic gate disposes. This is already Rāma's architecture.

**Recommendation: adopt Option C's rules, Option B's mechanism, and not the vendor.**

---

## 9. The hallucination question

Master asked whether this "can remove hallucination from the picture", and raised that it "might be
a combo to carry any action". Both halves are answered, and the distinction between them is the
most important thing in this document.

### 9.1 The structural argument — what it buys

**It is true, and it is narrower than it sounds.**

A model that returns a value from an enumerated set has **no free-text channel to fabricate into**.
There is no place to put an invented citation, an invented figure or a confident narrative, because
the output is one of *n* pre-declared values and a probability vector. You cannot hallucinate a
source id into a field whose domain is `{true, false}`.

`claimGate.cjs` already states the same principle from the other direction, citing HALO
(arXiv 2607.17883): zero hallucination is not a property a model possesses, it is a property a
**system enforces**. Jev's typed output is one way of enforcing it at the output boundary.
`claimGate` is another way, and `claimGate` needs no model at all.

### 9.2 What it does NOT buy — and this is the heart of the answer

**"Cannot hallucinate" is not "cannot err", and conflating them is the failure mode this whole
project has spent weeks removing.**

[Firecrawl's explainer](https://www.firecrawl.dev/blog/what-is-jev) (16 Oct 2026) states it exactly:
cannot hallucinate means cannot return a value outside your schema; it can still be wrong. The
independent evidence on *how* wrong, and *how confidently* wrong, is substantial:

- **Confidence is not independent information.** Multiple independent audits converge on Choice
  confidence being a **fixed closed-form function of the top probability**, `(N·p_max − 1)/(N − 1)`
  ([primeline.cc pre-registered test and others, collated in awesome-jev-robustness](https://github.com/Yifan-Lan/awesome-jev-robustness)).
  It is a restatement of `p_max`, not a second signal. A design that treats "probability" and
  "confidence" as two checks is double-counting one number. INDEPENDENT.
- **Confidently wrong is measured, not hypothetical.**
  [nikkoxgonzales/jev-certify](https://github.com/Yifan-Lan/awesome-jev-robustness) found Jev returns
  **exactly 1.0 confidence on 56.4% of answers, nine of which were wrong**, which floors the
  achievable conformal risk bound at 1.95% (n=2,412). INDEPENDENT.
  [Anthus' audit](https://github.com/Yifan-Lan/awesome-jev-robustness) found stated 91.4% against
  actual 76.1% for Choice on 8,801 examples, with the 50–95% band only 50–57% correct.
- **Calibration is task-dependent, sharply.** Calibrated on CLINC150 (ECE 0.020) and overconfident
  on Banking77 (ECE 0.094) in the *same harness*
  ([jourdanlabs/assay-001](https://github.com/Yifan-Lan/awesome-jev-robustness), n=8,576). ECE 0.33
  on retrieval-stopping and 0.087 on chunk boundaries in one RAG pipeline
  ([ajanm007/jevrag](https://github.com/Yifan-Lan/awesome-jev-robustness)). **A threshold tuned on
  one task does not transfer**, which is the same finding as §6.3's dependency result.
- **Its probabilities do not always obey the probability axioms.**
  ["Do System One Decisions Add Up?"](https://arxiv.org/abs/2609.33971) (Joy et al., 27 Sep 2026,
  72,000 questions): mean category-level total variation **0.219 to 0.349** for Jev, and on CLINC150
  reconstructing a fine label through broad categories **reduces accuracy by 22.9 percentage points**
  (95% bootstrap [−24.9, −20.9]). Li et al. found P(X) and P(not X) miss summing to one by 0.064 on
  average over 480 negation pairs. **So the same decision asked two structurally equivalent ways
  gives two different answers.** INDEPENDENT.
- **A one-line injection can invert it.** [zkousama/jagged](https://github.com/Yifan-Lan/awesome-jev-robustness),
  pre-registered, n=486 Wikipedia deletion discussions: **96.5% accurate at baseline, 26.5% under a
  single injected instruction.** [xzx34/JevOut](https://github.com/Yifan-Lan/awesome-jev-robustness)
  flipped **312 of 508 decisions (61.4%)** with fluent answer-preserving added context, pushing 229
  past 0.7 confidence on the *wrong* target. VentureBeat recorded an agent gate whose block
  probability for `rm -rf ~/.ssh` **fell from 0.76 to 0.48** after a fake pre-approval was injected
  into tool output. **Counter-evidence, reported honestly:**
  [cwhy/decision-injection-bench](https://github.com/Yifan-Lan/awesome-jev-robustness) ran 1,056
  injection attacks and Jev flipped on **1 (0.09%)** where other classifiers flipped on 3.0–62.6%,
  and [eugeniughelbur/jev-engineering](https://github.com/Yifan-Lan/awesome-jev-robustness) found
  **0 of 30** blunt dangerous commands passed while a *claimed human approval* got up to 3 of 30
  through. The pattern across all of them: **blunt commands fail, text that reads as evidence about
  the judged item succeeds.** INDEPENDENT, mixed, and the mixed-ness is itself the finding.
- **Option names matter more than the rubric bound to them.** Sun and Xu swapped only which option
  *name* was bound to which rubric: hosted Jev dropped from **AUC .81 to .58**, 24x its test-retest
  floor, and random-string names removed the effect entirely (n=1,200). INDEPENDENT. **The model is
  partly reading the label, not the definition.**

**So, precisely:**

> A typed decision layer **removes fabricated prose** from the channel it governs. It does **not**
> make the chosen value correct, it does **not** make the attached probability trustworthy across
> tasks, and it does **not** resist text planted in the state it is judging. A confidently wrong
> classification is still wrong, and the independent measurements above show it happens at rates
> that matter.

For Rāma, the operational consequence is: **a typed layer can be trusted to never invent, and must
never be trusted to be right.** Which means it belongs upstream of a deterministic gate, never
instead of one.

### 9.3 Where Jev would be a regression, named surface by surface

Master asked for hard-nosed. Here it is. **Where Rāma's existing gate is deterministic over declared
data, a learned model is a regression, because it trades a provable rule for a probabilistic one.**

- **#1 `claimGate`.** The gate's guarantee is *mechanical*: the cited source must exist in the
  evidence supplied, and every checkable token — numerals, ISO dates, named entities — must appear in
  that source. A fabricated citation is caught because the id is not there. An invented figure is
  caught because the digits are not there. **That is a proof, not a judgement**, and it cannot be
  talked out of checking digits. Replacing it with a Jev Noul means the gate's input is *untrusted
  model output and fetched web documents* — precisely the input where §9.2's injection results are
  worst (96.5% → 26.5%). **Clear regression.** `claimGate` should stay exactly as it is.
- **#2 `egressBoundary` enforcement.** `private` has no override anywhere, by design. A probabilistic
  `private` has an override by construction: the probability. **Clear regression.** Enforcement stays
  deterministic; only the *producer* (#3) is a candidate, and even that one should be local.
- **#12 `autonomyPolicy`.** Fifteen classes with floors and ceilings frozen in code, where the data
  file is *not consulted at all* for permanent classes. The frozen floors **are** the containment.
  A learned level is the containment removed. **Forbidden, not merely regressive.**
- **#13 `capability`.** A tier comparison against a protected matrix. A probabilistic access check
  is a security defect with extra steps. **Forbidden.**
- **#16 `selfRepair.integrityMatches`.** A SHA-256 comparison. There is no version of "a model judges
  whether this tarball is the right tarball" that is not worse. **The clearest regression in the list.**
- **#9/#10 `dependencyAdvisor`.** Semver arithmetic, plus §6.3's direct adverse measurement on the
  nearest published analogue. **Regression with evidence attached.**
- **#14 `ollamaCatalog.classify`.** Its `EVIDENCE` values — `catalog`, `name`, `size`, `none` —
  record *which deterministic source was available*. A model cannot know which of Rāma's own data
  sources was populated. **Category error, not just a regression.**
- **#20 `astEngine.qualityScore`.** Replacing invented arithmetic with a *learned* rubric number
  re-creates exactly the composite score Sections 110/111 deleted, and
  [Deußer et al.](https://arxiv.org/html/2609.37647v1) found rubric-based quality judgment is where
  **all three** evaluated models degrade. **Do not.**

**That is 7 regressions and 3 invariant conflicts out of 21 surfaces.** Rāma's gates are good
*because* they are dumb. That is not an accident of implementation; it is the design.

### 9.4 The combo / hybrid pattern — the part that is genuinely right

Master's instinct that it "might be a combo" is correct, and it is the only architecture worth
considering. The shape:

```
untrusted input ──► typed decision layer (classify / route / flag)
                         │  proposes, with an enumerated answer
                         ▼
                    deterministic gate (claimGate / egressBoundary / autonomyPolicy)
                         │  decides, provably
                         ▼
                    LLM does the prose, inside the decided envelope
                         │
                         ▼
                    claimGate on the way out
```

**Rāma already has the right-hand two-thirds of this.** `claimGate`, `egressBoundary`,
`autonomyPolicy` and `capability` are the deterministic dispose layer, and
[LangChain's LangGraph write-up](https://www.langchain.com/blog/building-prod-with-jev-and-langgraph)
(21 Oct 2026) and [SitePoint's harness piece](https://www.sitepoint.com/build-safer-ai-agent-harness-jev-langchain/)
(28 Oct 2026) describe adding exactly the left-hand third: a request router that classifies
complexity and picks a cheaper model tier, and a tool gate that scores a proposed tool call against
a low/medium/high risk policy before it executes.

**So the honest classification of Jev against Rāma's existing gates:**

| Existing gate | Jev would… | Verdict |
|---|---|---|
| `claimGate` attribution check | **duplicate badly** — a probabilistic version of a token-presence proof | REGRESSION |
| `claimGate`'s *missing* entailment check (#18) | **add** what the header says it cannot do | **STRENGTHEN** |
| `egressBoundary` enforcement | duplicate, probabilistically | REGRESSION |
| `egressBoundary`'s *missing* per-turn producer (#3) | **add** what has no producer | **STRENGTHEN** — but §8.3: do it locally |
| `autonomyPolicy` level resolution | duplicate | FORBIDDEN |
| `capability` tier check | duplicate | FORBIDDEN |
| A **pre-tool-call risk gate** | **add** — Rāma gates *who may act* (capability) and *how far* (autonomyPolicy) but does not score *this specific proposed action's risk* | **STRENGTHEN**, and the honest candidate after #3 |
| A **post-hoc validator on LLM output before master sees it** | **partly duplicate** — `claimGate` already withholds unattributed claims. It would add "is this answer responsive to the question", which `claimGate` explicitly does not judge | **STRENGTHEN**, narrowly |

**Four design rules the independent evidence makes non-negotiable for any such layer**, hosted or
local:

1. **Always include an explicit abstain / none-of-these option.** The evidence here is overwhelming
   and it is the single most actionable finding in this document.
   [jujumilk3/jev-calibration-audit](https://github.com/Yifan-Lan/awesome-jev-robustness): removing
   the abstain option took KoBBQ accuracy from **0.950 to 0.000** and ECE from **0.023 to 0.793**
   (n=11,759). [priorbench/jev](https://github.com/Yifan-Lan/awesome-jev-robustness): **0 of 30**
   out-of-scope inputs were flagged without an explicit none option (n=5,721).
   [andre-langchain/calibration-probe](https://github.com/Yifan-Lan/awesome-jev-robustness): without
   an insufficient-evidence option, **47%** of unanswerable questions got a confident answer; adding
   one moved 77% to abstain but **13% still answered confidently**. INDEPENDENT, three sources.
   **For Rāma this is existential**, because withholding *is* Rāma's correct behaviour —
   `claimGate.ABSTENTION_RE` exists specifically so that Rāma saying it does not know is never
   withheld. A decision layer without an abstain option would systematically convert "I don't know"
   into a confident guess.
2. **Decompose.** 62.6% → 95.0% by splitting one judgement into five and combining in code (§8.4).
3. **Do not tune a threshold on one distribution and ship it.** §6.3 (15 unsafe merges OOD) and the
   UNFAIR-ToS result (micro-F1 0.50 → 0.75 only *after* tuning on training data,
   [Deußer et al.](https://arxiv.org/html/2609.37647v1)) say the fixed 0.5 threshold is the wrong
   default and a tuned one does not travel.
4. **Keep the permission in code.** The model's output is an input to a gate, never the gate.

---

## 10. The optimal adoption path, staged smallest-first

Each stage has a **falsifiable success criterion**. If a stage fails its criterion, the next stage
does not start. No stage requires reversing §130.9 except the explicitly-marked optional one, and
every stage is additive with a fallback (I11).

### Stage 0 — telemetry, because there is no baseline (no new dependency)

**Do:** record per-decision latency and, where a model is involved, token counts, for the decision
points in §4. Nothing exists today, which is why §4.4 cannot give master a cost percentage.

**Falsifiable criterion:** after one week of ordinary use, Rāma can state, from measurement, how
many times each of the 21 decision points fired and the p50/p95 wall time of each. **If the numbers
show the decision layer is not on any hot path, Stages 2–4 are unjustifiable and should be dropped.**

**Why first:** master asked for a percentage. This is the only thing that can produce an honest one.

### Stage 1 — the pilot: a local per-turn sensitivity producer for `egressBoundary` (#3)

**Do:** build the producer that does not exist, **locally**, in three layers that fail closed:

1. A **deterministic prefilter** that classifies a turn `private` on declared evidence — the turn
   references a holding in master's own portfolio data, a position, a quantity, or a Rāma-internal
   identifier. This layer alone must be allowed to decide `private`; it never needs a model and it
   is the layer that cannot be injected.
2. A **local small-model reflex** over Ollama with a **JSON Schema** `format` whose enum is
   `{"sensitivity": "public" | "internal" | "private" | "unclear"}`. Note the fourth value: Stage 1
   ships with an explicit abstain option from the first line of code, per §9.4 rule 1.
3. **`unclear` and any failure both resolve to `private`.** `conversationRole.sensitiveOrUnknown`
   already encodes exactly this asymmetry — only a literal `false` means not sensitive — so the
   seam already exists and this plugs into it rather than retrofitting it.

Then wire `src/pages/Chat/Chat.jsx` to pass the resulting `sensitive` boolean, which it currently
does not (MEASURED-HERE, §3.3).

**Falsifiable criterion:** over a frozen fixture set of turns — written **before** the implementation,
including turns that name a holding obliquely and turns that merely discuss the market — the layered
producer classifies **every** holdings-naming turn as `private`, with **zero** such turns reaching a
cloud destination, and `verifyConversation.cjs` continues to pass. **False negatives are failures;
false positives are not** — a public turn routed local costs latency, which is recoverable, while a
private turn routed cloud is not.

**Spec work first, per the resume protocol:** this decision goes into the spec and the ledger
*before* implementation, with its next concrete step written.

### Stage 2 — a pre-tool-call risk gate (local, schema-constrained)

**Do:** score a *proposed* action before it executes, over an enumerated risk set, feeding
`autonomyPolicy`'s existing level resolution rather than replacing it. Rāma gates *who* may act
(`capability`) and *how far* autonomy extends (`autonomyPolicy`), but does not score *this specific
action's* risk. [Independent evidence is encouraging but not clean](https://github.com/Yifan-Lan/awesome-jev-robustness):
`themsquared/jev-benchmark` recorded **91.7% on 60 adversarially-worded destructive-command cases
with every wrong answer at hedged confidence** — the right failure shape — against the authority-
injection results in §9.2.

**Falsifiable criterion:** on a fixture set of proposed actions including adversarially-worded
destructive ones **and** fake-pre-approval injections, the gate never *lowers* a risk classification
below what the deterministic policy already assigns. **It may only escalate.** An escalate-only gate
cannot regress `autonomyPolicy`, which is the property that makes Stage 2 safe to ship at all.

### Stage 3 — the entailment check `claimGate` cannot do (#18)

**Do:** add a grounding Noul — *does this source support this claim* — as a **separate, labelled
signal alongside** `claimGate`'s attribution verdict. Never folded into it, never allowed to
*promote* a claim to `grounded`; only allowed to **demote**.

**Falsifiable criterion:** on a fixture set of claim/source pairs including fabricated citations,
correct-citation-wrong-figure, and plausible-but-unsupported, the signal demotes every unsupported
pair and **promotes nothing**, and `verifyClaimGate.cjs` still asserts that no score shape appears
anywhere in the output. Per §9.4 rule 2, the check is **decomposed** into separate questions
(is the entity present, is the figure present, does the document address the question) combined in
code — the 62.6% → 95.0% pattern.

### Stage 4 — OPTIONAL, and only with master's explicit authorisation: measure hosted Jev against Stages 1–3

**Do:** nothing in the product. Run a **read-only, offline A/B** against the frozen fixture sets from
Stages 1–3 using `typesafe/jev-1.13` — **the pinned version, never `jev-latest`** (§7.4) — on
*synthetic fixtures only*, with **no real conversation turn, no holding, no memory row, and no
`PERSONA.revealed` text** in any payload.

**Prerequisite:** master authorises a §130.9 scope exception for a measurement harness. Without it,
Stage 4 does not happen.

**Falsifiable criterion:** hosted Jev beats the local Stage 1–3 implementations on the frozen
fixtures by a margin whose bootstrap interval excludes zero, **and** the §8.3 table's first row has
an answer master accepts. **If either fails, the question is closed and this document is the
record of why.**

---

## 11. What remains unmeasured, and what would change the recommendation

### 11.1 Unmeasured

- **Every runtime figure for Rāma's decision layer.** No per-call cost or latency telemetry exists.
  This is Stage 0 and it is the single biggest gap. Reported as `not measured`, not as zero.
- **Local small-model classification accuracy and latency on this box.** Option B's feasibility
  argument in §8.2 is a bandwidth-ceiling calculation plus Ollama's documented schema enforcement.
  **It has not been run.** I did not install, pull or execute anything for this document.
- **Whether `vite build` passes.** `node_modules` is present in this workspace but no build was run
  and none is claimed.
- **The 16 GB machine.** Entirely unmeasured, as master's own note records.
- **Jev's behaviour on Rāma's actual request shapes.** Nobody has measured it because the
  integration does not exist. Every Jev number in this document comes from someone else's task mix.
- **How often turn-level sensitivity actually matters.** Nobody has counted how many of master's
  turns name a holding. This changes Stage 1's priority but not its correctness.
- **Jev's training data.** Not public, so contamination cannot be ruled out. Deußer et al. say so
  explicitly: rotating options left accuracy unchanged and withholding the question dropped it to
  chance, which rules out *shallow* memorisation but **not memorised question-answer pairs**.

### 11.2 What would have to be true for the recommendation to change

**To "adopt hosted Jev":**
- Master reverses §130.9 and accepts a paid third-party endpoint, **and**
- Stage 0 telemetry shows the decision layer is on a hot path that materially costs master time or
  money, **and**
- Stage 1's local implementation measurably fails for a reason that is about *model quality*, not
  about plumbing, **and**
- §8.3 row 1 is resolved — i.e. the use is limited to surfaces where the state is not itself the
  sensitive thing (so: #18, #6, #7 — **never #3**), **and**
- an independent corroboration of the 200x/400x magnitude appears, or master accepts the measured
  2–7x / ~25x instead.

**To "adopt the pattern locally and sooner" (the current recommendation, accelerated):**
- Stage 0 shows conversation turns frequently carry holdings. This would raise Stage 1 above other
  queue items. It would not change *what* Stage 1 is.

**To "do nothing at all":**
- Stage 0 shows the decision points fire rarely and cost nothing measurable, **and** master judges
  the #3 hole acceptable. I do not recommend this: #3 is a live hole in the one boundary Rāma exists
  to hold, and leaving it is the one option in this document that is affirmatively wrong.

### 11.3 Closing

**Jev is a real, competent product, and the idea behind it is right.** A decision that belongs in an
`if` statement should not be routed through a model that writes essays, and TypeSafe has built a
clean interface for that. The independent literature — thirty-odd preprints and a hundred-plus
community audits inside six weeks of release — is unusually good for something this new, and it is
broadly favourable on cost and latency and broadly cautionary on calibration, injection and
abstention.

**It is also solving a problem Rāma does not have.** Rāma's decision layer was built deterministic on
purpose, by someone who had already deleted an invented composite score and a fabricated source. The
200x/400x framing is aimed at a team paying a frontier model to classify support tickets. Master
pays nothing, classifies nothing with a model, and has gates that are provable.

**The right move is to take Jev's three good design rules — enumerate the answer space including
abstain, decompose the judgement, keep the permission in code — and apply them to the five
judgements Rāma is genuinely missing, using the local daemon that is already on master's disk.
That is cheaper, faster to master, inside the locked scope, and does not require sending a private
turn off the machine to ask whether it is private.**

The pilot is item 4 in master's queue, and it should be built locally.

---

## 12. Sources

Dates are as reported by the search index; where a source carried no date it is marked undated. This
field is moving quickly and anything here may be superseded.

**Primary / peer-reviewable**
- [Deußer, Sparrenberg, Sifa — *Evaluating and Benchmarking the System One Model Jev*, arXiv 2609.37647](https://arxiv.org/html/2609.37647v1) (29 Sep 2026) — the largest independent evaluation; 37 datasets, 346,009 requests.
- [Joy et al. — *Do System One Decisions Add Up? A Study of Probabilistic Coherence*, arXiv 2609.33971](https://arxiv.org/abs/2609.33971) (27 Sep 2026).
- [*Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture* (I-JEPA), arXiv 2301.08243](https://arxiv.org/abs/2301.08243) — JEPA, for the disambiguation only.
- [*LLM-JEPA*, arXiv 2509.14252](https://arxiv.org/html/2509.14252v2) and [*VL-JEPA*, arXiv 2512.10942](https://arxiv.org/abs/2512.10942) — same.

**Evidence ledgers and independent audits**
- [Yifan-Lan/awesome-jev-robustness](https://github.com/Yifan-Lan/awesome-jev-robustness) — 109 entries, almost all against `jev-1.13.0`, snapshot 23 Sep 2026. The index for most audits cited above; its own caveat is that the numbers are the authors' own and should be read as evidence to inspect, not settled results. That caveat is accepted and restated here.
- [ickma2311/jev-baselines-eval](https://github.com/ickma2311/jev-baselines-eval), [OmarMujahid/jev-decision-bench](https://github.com/OmarMujahid/jev-decision-bench), [AbdelStark/jev-benchmarks](https://github.com/AbdelStark/jev-benchmarks/blob/main/README.md), [dhruvmehra/jevbench](https://github.com/dhruvmehra/jevbench), [4esv/jev-eval](https://github.com/4esv/jev-eval).
- [LiteLLM — *JEV Classifier: 5.43x as Fast as Haiku, 96% Lower Cost*](https://docs.litellm.ai/blog/jev-auto-router-benchmark) (18 Sep 2026).
- [OpenRouter — *Is Jev as Accurate as Frontier Models at Classification?*](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/) (20 Oct 2026).
- [MindStudio — *Jev vs BERT and Zero-Shot NLI*](https://www.mindstudio.ai/blog/jev-vs-classic-classifiers-benchmark) (16 Oct 2026) — trained local classifiers won on raw accuracy in most cases; Jev won on zero-shot flexibility.

**Vendor and vendor-adjacent**
- [Wikipedia — Jev (AI model)](https://en.wikipedia.org/wiki/Jev_(AI_model)); [jevtypesafeai.com](https://www.jevtypesafeai.com/) (undated); [jevmodel.org](https://jevmodel.org/) (22 Oct 2026).
- [OpenRouter — TypeSafe Decision Model guide](https://openrouter.ai/docs/guides/community/jev), [`~typesafe/jev-latest` pricing](https://openrouter.ai/~typesafe/jev-latest), [SDK guide](https://openrouter.ai/docs/guides/community/typesafe-sdk), [*What Is Jev?*](https://openrouter.ai/blog/insights/what-is-jev/).
- [Cloudflare Workers AI — Jev (typesafe)](https://developers.cloudflare.com/ai/models/typesafe/jev/) (undated); [Pydantic AI — TypeSafe (Jev)](https://pydantic.dev/docs/ai/models/typesafe/) (undated).
- [LangChain — *Building Production Agents with Jev and LangGraph*](https://www.langchain.com/blog/building-prod-with-jev-and-langgraph) (21 Oct 2026); [LangChain — *What Is Jev?*](https://blog.langchain.com/building-a-harness-with-jev?ref=explainx) (21 Oct 2026).
- [SitePoint — *Cut LLM Costs and Block Risky Tool Calls in LangChain with Jev*](https://www.sitepoint.com/build-safer-ai-agent-harness-jev-langchain/) (28 Oct 2026).
- [Hyperstack](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model) (18 Oct 2026); [a2aprotocol](https://a2aprotocol.ai/insights/2026-jev-system-one-model-guide) (18 Oct 2026); [TrueFoundry](https://www.truefoundry.com/ja/blog/typesafe-ai-jev) (31 Oct 2026); [Sanity glossary](https://www.sanity.io/glossary/jev-typesafe-ai-model) (18 Oct 2026); [Width.ai](https://www.width.ai/post/what-is-jev-ai-typesafe) (30 Oct 2026).

**Analysis and critique**
- [Sophos — *Jev's Paradox: The hidden cost of cheap AI decisions*](https://www.sophos.com/en-us/blog/jevs-paradox-hidden-cost-of-cheap-ai-decisions) (29 Oct 2026).
- [Arize — *Can Decision Models Replace LLM Judges?*](https://arize.com/blog/typesafe-jev-llm-judge/) (18 Sep 2026).
- [Firecrawl — *What Is Jev?*](https://www.firecrawl.dev/blog/what-is-jev) (16 Oct 2026) — the "can't hallucinate ≠ can't be wrong" framing.
- [DataCamp tutorial](https://www.datacamp.com/tutorial/jev-api-tutorial) (22 Oct 2026); [eesel — *Is Jev really ultrafast?*](https://www.eesel.ai/blog/jev-ultrafast) (17 Oct 2026); [zeke/jev research notes](https://github.com/zeke/jev) (14 Oct 2026).

**Open reconstructions**
- [kyegomez/open-jev](https://github.com/kyegomez/open-jev) (undated), [daseinlabs/open-jev](https://github.com/daseinlabs/open-jev) (15 Oct 2026), [mithalouni/system-one-open](https://github.com/mithalouni/system-one-open) (undated), [GPT-AGI/OpenJev](https://github.com/GPT-AGI/OpenJev) (undated), [aiwithenoch/Jev-Skill](https://github.com/aiwithenoch/Jev-Skill) (undated), [TypeSafeAI/typesafe-playground LangChain doc](https://github.com/TypeSafeAI/typesafe-playground/blob/main/docs/langchain.md) (undated).

**Local alternative**
- [Ollama — Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) (1 Nov 2026); [Ollama — Generate a response API](https://docs.ollama.com/api/generate) (30 Oct 2026); [Ollama blog — Structured outputs](https://ollama.com/blog/structured-outputs) (6 Dec 2024); [token-level schema enforcement explained](https://dev.to/syed_anzar/your-llm-returns-json-that-isnt-json-a-robust-structured-output-pipeline-for-local-models-2pm9) (25 Oct 2026).

**Rāma's own code and spec, read this session**
`electron/lib/claimGate.cjs` · `electron/lib/egressBoundary.cjs` · `electron/lib/modelRoles.cjs` ·
`electron/lib/conversationRole.cjs` · `electron/lib/capability.cjs` · `electron/lib/badgeLabel.cjs` ·
`electron/lib/autonomyPolicy.cjs` · `electron/lib/dependencyAdvisor.cjs` ·
`electron/lib/releaseChannel.cjs` · `electron/lib/selfRepair.cjs` · `electron/lib/ollamaCatalog.cjs` ·
`electron/lib/selfModel.cjs` · `electron/ipc/modelRouter.cjs` · `electron/ipc/intelligenceEngine.cjs` ·
`electron/ipc/marketIntel.cjs` · `electron/ipc/vectorMemory.cjs` · `electron/ipc/astEngine.cjs` ·
`src/pages/Chat/Chat.jsx` · `scripts/verifyLoyaltyTripwire.cjs` ·
`RAMA_AGI_MASTER_SPEC.md` §130.9, §130.10, §131.6, §131.7, invariants I10–I17, ledger rows 150/151.

*Content was rephrased for compliance with licensing restrictions.*






