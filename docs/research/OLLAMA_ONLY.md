# OLLAMA ONLY — how far it reaches, and exactly where it stops

Read-only investigation. **No source file was modified.** Report written 2 October 2026.

Master's instruction, verbatim: *"I have already mentioned; for now I can use free
models in Ollama facilitates. so dig deeper."* — so Groq and Google are **out of
scope** and are not argued for anywhere below. The question answered here is the
harder one: **with Ollama alone and no money, what can Rāma do, what can it not,
and for each gap what is the honest answer.**

**Outbound HTTPS: WORKED, through the agent fetcher.** It still fails from
PowerShell (`Invoke-WebRequest` → `The SSL connection could not be established`),
which is the `SEC_E_ILLEGAL_MESSAGE` condition noted in the brief — so the app's
own `lib/http.cjs` may well fail where this report succeeded. Every web claim
below was fetched live this session and is linked inline. The specific things I
could **not** verify are isolated in **§G** and nowhere else.

Content from external pages was rephrased for compliance with licensing restrictions.

---

## A. ONE-SCREEN ANSWER

### The sentence that matters

> **Staying Ollama-only costs master exactly one capability: speech-to-text. Nothing
> else. Every other role and capability class is either served, or blocked by a defect
> in this repository rather than by the absence of a paid API.**

That is not a consolation. It is a measured result, and it reframes the constraint:
**the Ollama-only path is architecturally aligned with this codebase, not a sacrifice.**
All four role call sites in `electron/ipc/modelRouter.cjs` — `roleNoteFor` (L422),
`selectModel` (L437), the `models:roles` handler (L256) and `models:role-research`
(L277) — pass `Object.values(discoveredOllama)` and nothing else. **A non-Ollama model
cannot fill a declared role today even if master buys a key.** Confirmed by grep this
session. So the constraint he has chosen is the one the role engine was already built for.

### Do these, in this order

Measured on this machine this session: **31.4 GB RAM in a SINGLE channel** (see §E —
this is the most consequential new fact in the report), **Intel Core Ultra 5 135U**
(12 cores / 14 threads), **Intel iGPU + Intel AI Boost NPU, no discrete GPU**,
**99.0 GB free on C:**, **Ollama NOT installed**.

| # | Do this | Why | Cost |
|---|---------|-----|------|
| 1 | **Install Ollama** for Windows | Not present. Nothing below exists without it. | free |
| 2 | `ollama pull qwen3.5:9b` | 6.6 GB fills **five** roles — tool-calling, code, vision, multilingual and **narration**, the one role that refuses cloud outright. 256K window. [qwen3.5 tags](https://ollama.com/library/qwen3.5/tags) | free, 6.6 GB |
| 3 | `ollama pull qwen3.5:4b` | Smallest tag that clears the 3B extraction floor *and* still earns `fast` (`paramsB <= 4`). | free, 3.4 GB |
| 4 | `ollama pull qwen3-embedding:0.6b` | 32K context vs `nomic-embed-text`'s 2K. Fills `embedding` as `declared`. | free, 639 MB |
| 5 | `ollama pull glm-ocr:q8_0` | OCR + vision + **128K** context in **1.6 GB** — cheaper than the `latest`/`bf16` tag at 2.2 GB, same window. [glm-ocr tags](https://ollama.com/library/glm-ocr/tags) | free, 1.6 GB |
| 6 | `ollama signin`, then use **`gemma4:31b-cloud`** for `reasoning` | A **sized** cloud tag → `paramsB()` reads **31** → the role returns **`declared`**, not `substitute`. **Verified free-accessible** on a Free account (§D). Ollama's own tags page labels it **"Low Usage"**. | free starter credits |
| 7 | Run **`models:refresh-catalog`** (master-only) | Until it runs, `ollamaCatalogData` is `{}`, so no model earns a `code` or `vision` cap and both roles report unfilled whatever was pulled. **One action, highest value.** | free |
| 8 | **Do NOT pull a local reasoning model** | `qwen3.5:27b` (17 GB) clears the 14B floor and then delivers **~1.6 tok/s** on single-channel memory. Nominally installable, practically unusable. §E. | — |

**Total local disk: ~12.2 GB** of 99 GB free.

### Measured outcome — the project's own planner, run this session

I ran `modelRoles.selectForRole()` and `ollamaCatalog.describeInstalled()` against
exactly that install (script kept outside the repo, nothing tracked touched):

```
extraction     => ollama/qwen3.5:4b              [declared]
tool-calling   => ollama/qwen3.5:9b              [declared]
code           => ollama/qwen3.5:9b              [declared]
reasoning      => ollama/gemma4:31b-cloud        [declared]
long-context   => null                           [none]      <- code defect, not a missing pull
multilingual   => ollama/glm-ocr:latest          [substitute] <- WRONG MODEL. Ranking defect, §F.2
embedding      => ollama/qwen3-embedding:0.6b    [declared]
vision         => ollama/qwen3.5:9b              [declared]
narration      => ollama/qwen3.5:9b              [declared]
```

**8 of 9 roles filled — 7 `declared`, 1 `substitute`, 1 `none`.** That is
**identical to what the Groq+Google lineup achieved** in the prior report.
Removing the paid providers cost **zero roles**.

Two of those nine lines are defects this report found or sharpened, both fixable in
code at no cost: `long-context` (§F.1) and `multilingual` picking an OCR model
over a 9B general model (§F.2 — **new, and specific to this lineup**).

---

## B. THE REVISED CAPABILITY MATRIX — Ollama only

`served` = works on the recommended lineup. `degraded` = works, but worse than it
should. `blocked` = does not work and no Ollama model changes that.

| # | Capability class | Where it lives in the code | Local pick | Free-cloud pick | Verdict | Fallback / note |
|---|---|---|---|---|---|---|
| 1 | **General chat** | `models:chat`, `FALLBACK_CHAIN` | `qwen3.5:9b` | `gemma4:31b-cloud` | **served** | — |
| 2 | **Tool / function calling** | `routeToTools()`, `src/services/ramaCore.js` | `qwen3.5:9b` `[declared]` | `gpt-oss:120b-cloud` (free ✅) | **served** | — |
| 3 | **Code** (Rāma's own diffs) | `astEngine.cjs`, `codeRegenEngine.cjs`, `selfBuildPipeline.cjs` | `qwen3.5:9b` `[declared]` | `qwen3-coder:480b-cloud` (free ✅) | **served** | Cloud forbidden when the diff touches the loyalty core |
| 4 | **Reasoning** (≥14B floor) | `reasoning` role | *none usable* — 27B is 1.6 tok/s | **`gemma4:31b-cloud`** `[declared]` | **served** (cloud) | Local is `degraded` to the point of unusable. Not sensitive → cloud valid |
| 5 | **Extraction** | `extraction` role | `qwen3.5:4b` `[declared]` | — (role note: never a cloud call) | **served** | — |
| 6 | **Vision / chart reading** | `vision` role | `qwen3.5:9b` `[declared]` | `qwen3-vl:235b-cloud` (free ✅) | **served** | Needs `models:refresh-catalog` first |
| 7 | **OCR / document understanding** | contract notes, filings | **`glm-ocr:q8_0`** 1.6 GB, 128K | `gemma4:31b-cloud` | **served** | Best value on the list |
| 8 | **Embeddings** | `TOOL_REGISTRY['model.embed']`, `vectorMemory.cjs` | **`qwen3-embedding:0.6b`** `[declared]` | **NONE EXISTS** — the `c=embedding` facet returns 12 families, **not one carries a `cloud` badge** ([embedding models](https://ollama.com/search?c=embedding)) | **served** (local only) | Local-only is *correct* here: it embeds holdings |
| 9 | **Long context** (≥128K) | `long-context` role | models qualify, **role does not fill** | same | **blocked by defect** | `ctxK` is `null` for every model. Pure code fix, zero cost. §F.1 |
| 10 | **Multilingual** | `multilingual` role | `qwen3.5:9b` — but ranking picks `glm-ocr` | `mistral-large-3` 🔒 not free | **degraded** | Ranking defect §F.2. Can never be `declared` (`noLocalMeasure: true`) |
| 11 | **Narration about master's money** | `narration`, `sensitive: true` | **`qwen3.5:9b`** `[declared]` | **INVALID BY CONSTRUCTION** | **served** | **Ollama Cloud does NOT open this gate.** §B.1 |
| 12 | **Speech → text** | `voiceEngine.js` L2/L3, `voiceEngine.cjs → transcribe()` | **NONE** | **NONE** | **BLOCKED** | `whisper.cpp` — a free *local binary*, not an API. §C.1 |
| 13 | **Text → speech** | `voiceEngine.js → speak()` | **no model needed** | — | **served, already** | `window.speechSynthesis` on OS voices. §C.3 |
| 14 | **Wake word** | `WAKE_WORDS`, cap `identity.voice-wake` (**tier 0**) | **NONE** | **NONE** | **BLOCKED** | openWakeWord ONNX, ~200 KB/phrase. Streaming ambient audio to a cloud is the wrong trade anyway |
| 15 | **Reranking** | after `vectorMemory.search()` | no official reranker tag | none | **degraded** | Embedding similarity alone. Acceptable; §C.4 |
| 16 | **Guardrail / claim classification** | `electron/lib/claimGate.cjs` | **no model at all** | — | **served, already** | `classifyOne()` is pure token/regex logic. **A pull here would be additive, not a fix.** §C.5 |
| 17 | **Structured JSON output** | model-agnostic DB records | **`format` + JSON schema** | same | **served** | Verified: [structured outputs](https://docs.ollama.com/capabilities/structured-outputs). §D.5 / §F.4 |

### B.1 Why Ollama Cloud does not open the narration gate

`modelRoles.evaluate()` L165, read this session:

```js
if ((role.sensitive || requirePrivate) && model.private !== true) {
  reasons.push('not private — this role\'s prompt names master\'s holdings and must not leave the machine');
}
```

and `ollamaCatalog.describeInstalled()` L279 sets `private: cls.cloud === false`.
Measured: `gemma4:31b-cloud` → `private=false`. **The gate is about the prompt
leaving the machine, not about what the host promises to do with it.** Ollama's
no-log/no-train policy — which is genuine and documented ([pricing FAQ](https://ollama.com/pricing)) —
is therefore irrelevant to this gate. That reading is correct and should stay.

`narration` is the **only** role with `sensitive: true`. Confirmed against
`modelRoles.cjs → ROLES` this session. `qwen3.5:9b` fills it `declared`, locally,
free. **This is the role the Ollama-only path serves best, and no paid provider
could ever have served it.**

---

## C. BLOCKED, AND WHAT IT WOULD TAKE

Stated factually. No advocacy — these are for master to decide later.

### C.1 Speech-to-text — genuinely BLOCKED, and I closed the prior report's open gap

The prior report asserted "Ollama does not serve STT" and left verification open.
**It is confirmed, and the mechanism is more interesting than a plain absence.**

**The weights exist in Ollama's library. The audio path does not.** Two independent
confirmations:

1. **`nemotron3`** is the *only* family under Ollama's audio facet
   ([audio models](https://ollama.com/search?c=audio)). Its own description names
   *"speech transcription"* and *"video+speech comprehension"*
   ([nemotron3](https://ollama.com/library/nemotron3)). But its
   [tags page](https://ollama.com/library/nemotron3/tags) lists **four tags, and every
   one declares `Text, Image input`.** Its tag-level capability badges are
   `vision`, `tools`, `thinking` — **no `audio` badge.**
2. **`gemma4`** carries an **`audio`** badge on the cloud search page, and its model
   card states E2B/E4B support **`Text, Image, Audio`** with a **~300M audio encoder**
   and publishes CoVoST and FLEURS (ASR) scores
   ([gemma4](https://ollama.com/library/gemma4)). Yet **all 51 tags on its
   [tags page](https://ollama.com/library/gemma4/tags) declare `Text, Image input`** —
   `e2b`, `e4b`, `12b`, `26b`, `31b`, `cloud`, `31b-cloud`, every quantisation. And
   the only cloud tags are the **31B dense**, which has **no audio encoder at all**.

**Conclusion: the `audio` badge is family-level metadata inherited from the upstream
model card; Ollama's packaging drops the audio projector.** No Ollama tag — local or
cloud — accepts audio input today. Voice input through Ollama **waits**.

**What would unblock it, factually:**

| Option | Cost | Trade |
|---|---|---|
| **Wait** for Ollama to ship the audio path | free | The weights are already in the library (`gemma4:e4b`, `nemotron3`). This is plausible but has no announced date. Voice stays at level 1 (push-to-talk, no transcription). |
| **`whisper.cpp` + `ggml-base.bin`** (~148 MB) or `small` (~488 MB) | free, local | **This is a different category from a paid API and should be judged as such.** A free local binary, no account, no network, no per-use cost — and master's voice **never leaves the machine**, so it is *stronger* on the loyalty axis than any cloud STT. Cost is CPU: on a 15 W U-series chip with no GPU, `base` runs faster than realtime on short dictation; `small` is near realtime. Adds a native binary to the install. |
| Paid STT API | money + master's voice leaves the machine | **Out of scope by instruction.** Named only for completeness. |

`voiceEngine.js` already models this honestly: `resolveVoiceCapability()` sets
`level = d.backend === 'local' ? LOCAL_STT : CLOUD_STT` and **prefers local when
available**. The ladder is built for the whisper.cpp answer; it is waiting for a binary.

### C.2 Wake word — BLOCKED

No Ollama model does keyword spotting, and streaming ambient audio to a cloud is the
wrong trade (`voiceEngine.cjs` says so in a comment). **openWakeWord** ONNX models are
~200 KB per phrase and free. Needs an ONNX runtime dependency and either training
"hey rāma" or accepting a prebuilt phrase. `WAKE_WORDS` already lists five variants
including `'hey rāma'`. The cap `identity.voice-wake` is **tier 0** — master only.

### C.3 Text-to-speech — NOT blocked. Already works, with no model.

Confirmed in `src/services/voiceEngine.js → speak()` (L691):

```js
if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
...
const voices = window.speechSynthesis.getVoices();
const preferred = voices.find(v => v.name.includes('Google UK English Male'))
               || voices.find(v => v.name.includes('Daniel')) ...
window.speechSynthesis.speak(utter);
```

Windows ships SAPI voices; Electron's Chromium exposes them. **Zero models, zero cost,
works today.** A better local voice (Piper, Kokoro-82M ONNX, both free local binaries)
is a quality upgrade, **not a gap** — lowest priority on this list.

### C.4 Reranking — DEGRADED, and acceptable

No official reranker tag exists in Ollama's library. Consequence: retrieval ranks by
embedding cosine similarity alone, with no cross-encoder second pass. That is a real
quality ceiling, not a failure. Note that `modelRoles.isEmbeddingModel()` matches
`/embed|minilm|\bbge\b/i`, so a community reranker tag would be **mis-classified as an
embedder** and could win the `embedding` role — a reason to be careful rather than a
reason to pull one. **Recommendation: accept embedding-only ranking.**

### C.5 Guardrail classification — NOT a gap. Already served, with no model.

Confirmed by reading `electron/lib/claimGate.cjs → classifyOne()` (L262): it is pure
token and regex logic — `isCheckable(tok)`, `ABSTENTION_RE`, citation presence,
`rejected.has(cite)`, `tok.modal && evidence.kind !== CLASS.REFLEX`, figure matching.
**No model call anywhere in the classification path.** Reasons emitted are
`no-citation`, `rejected-source`, `fabricated-citation`, `unsourceable-prediction`,
`unsupported-figure`.

**So a classifier pull would be additive, not remedial. Do not pull one to "fix"
guardrails — they are not broken.** Saying this prevents a pointless download.

---

## D. THE FREE CLOUD TIER, IN DETAIL

### D.1 What a free account actually grants

All from the live [pricing page](https://ollama.com/pricing) and its FAQ:

- **$0.** Running models on **your own hardware is always unlimited.**
- **"Starter usage credits"** plus **"access to starter models"**. Buying credits
  unlocks all models. No service fees.
- **Usage is metered in tokens**, at the per-model rates in the pricing table — not
  in GPU-time. (A third-party post claims GPU-time and 5-hour/weekly windows; that
  contradicts Ollama's own page and I am going with Ollama's. Flagged in §G.)
- **Free usage resets monthly from the date you signed up.** Unused credit **does
  not roll over.**
- **ONE concurrent request** (Pro 3, Max/Team 10).
- Cloud models run **native weights as released by the provider** — *not* quantised.
  So a cloud answer is of higher quality than the same model pulled locally at q4.
- **Privacy:** prompt and response data is never logged or trained on; NVIDIA Cloud
  Provider hosts are contractually required to apply no-logging, no-training and
  zero-retention. Hosted primarily in the US, with Europe and Singapore for capacity.

### D.2 What happens at exhaustion — explicit refusal, NOT silent degradation

This is the thing the brief asked to pin down, and the answer is good news:

- **Concurrency limit:** requests beyond the plan's concurrency are **queued** up to a
  fixed depth; **"if the queue is full, the request will be rejected"** (pricing FAQ).
  So an overrun surfaces as a rejection or latency — never a quietly worse model.
- **Model not on the free tier:** Ollama returns **an explicit subscription/upgrade
  error** (§D.4 methodology). A refusal, not a substitution.
- **Credit exhaustion:** **one real sharp edge.** Ollama emails a reminder at 90% of
  included usage — **"On paid plans"**. A Free account therefore gets **no proactive
  warning**; master must check the usage page. The *request* behaviour at zero credits
  I could not verify (§G.1), but given the two behaviours above, an explicit error is
  far more likely than a silent downgrade.

**I found no evidence of silent degradation anywhere in Ollama's cloud behaviour.**
That matters to this project and is worth recording as a positive finding.

### D.3 The complete cloud model list — 16 families

From [cloud models](https://ollama.com/search?c=cloud), fetched this session:

| Family | tools | vision | thinking | Sized tags |
|---|---|---|---|---|
| `deepseek-v4.1-flash` | ✓ | ✓ | ✓ | — |
| `deepseek-v4-pro` | ✓ | | ✓ | — (2 tags) |
| `glm-5.3` | ✓ | | ✓ | — |
| `glm-5.3-flash` | ✓ | ✓ | ✓ | — |
| `glm-5.2` | ✓ | | ✓ | — |
| `minimax-m3` | ✓ | ✓ | ✓ | — |
| `minimax-m2.7` | ✓ | | ✓ | — |
| `kimi-k3` | ✓ | ✓ | ✓ | — |
| `kimi-k2.7-code` | ✓ | ✓ | ✓ | — |
| `kimi-k2.6` | ✓ | ✓ | ✓ | — |
| `nemotron-3-ultra` | ✓ | | ✓ | — |
| `nemotron-3-super` | ✓ | | ✓ | `120b` |
| `nemotron-3-nano` | ✓ | | ✓ | `4b`, `30b` |
| `gemma4` | ✓ | ✓ | ✓ | `e2b`,`e4b`,`12b`,`26b`,**`31b`** |
| `mistral-large-3` | ✓ | ✓ | | — |
| `gpt-oss` | ✓ | | ✓ | `20b`, **`120b`** |

**No embedding model appears in the cloud list.** Embeddings are local-only on Ollama.
**No audio-input model appears either** (§C.1).

### D.4 Which cloud tags a FREE account can actually call

Ollama does not publish its starter-model list. The best available evidence is an
**unofficial tracker that empirically probes each cloud tag from a real Free account**
([ollama-cloud-free-tier](https://github.com/OshriFatkiev/ollama-cloud-free-tier), last
checked 2026-09-15). **Third-party and ~2.5 weeks stale — treat as strong evidence,
not as Ollama's word** (§G.1). Its method: send "Reply with exactly: OK", record
success vs. a subscription/upgrade error.

**Free-accessible (✅), with Ollama's own usage bucket:**

`gemma4:31b-cloud` (low) · `gemma4:cloud` (low) · `gpt-oss:20b-cloud` (low) ·
`gpt-oss:120b-cloud` (medium) · `ministral-3:3b/8b/14b-cloud` (low) ·
`nemotron-3-nano:30b-cloud` (low) · `nemotron-3-super:cloud` (medium) ·
`nemotron-3-ultra:cloud` (high) · `qwen3-coder:480b-cloud` (high) ·
`qwen3-coder-next:cloud` (medium) · `qwen3-next:80b-cloud` (medium) ·
`qwen3-vl:235b-cloud` + `:235b-instruct-cloud` (high) · `devstral-2:123b-cloud` (high) ·
`devstral-small-2:24b-cloud` (low) · `cogito-2.1:671b-cloud` (high) ·
`glm-4.6:cloud` · `glm-4.7:cloud` (high) · `minimax-m2/m2.1/m2.5:cloud` (medium) ·
`gemma3:4b/12b/27b-cloud` (low) · `rnj-1:8b-cloud` (medium)

**Locked behind a subscription (🔒) — note the pattern:** `qwen3.5:cloud`,
`qwen3.5:397b-cloud`, `glm-5.x`, `kimi-k2.x` / `kimi-k3`, `deepseek-v4*`,
`minimax-m2.7` / `m3`, `mistral-large-3:675b-cloud`.

**The pattern is the finding: the Free tier serves the cheap-per-token models and
locks the expensive flagships.** Cross-check against the pricing table — every 🔒
model sits at $0.95–$3.00 input, and the ✅ models at $0.015–$0.60. `gemma4` at
$0.14/$0.40 is free; `glm-5.3` at $1.40/$4.40 is not. **This correlation is
independently corroborated by Ollama's own tags page**, which labels both
`gemma4:cloud` and `gemma4:31b-cloud` as **"Low Usage"**.

Practical consequence: **the current-generation Qwen flagship is NOT free, but
`gemma4:31b-cloud` is** — which is exactly the tag the reasoning role needs.

### D.5 Which free cloud tags are SIZED — measured, not read

`paramsB()` parses the parameter count out of the **tag**, so an unsized tag leaves
every floor **unchecked** and degrades the role to `substitute`. I ran the real
function (`electron/lib/ollamaCatalog.cjs → paramsB`) over all 27 free-accessible tags:

**SIZED — floors CHECKED, role can return `declared`:**

| Tag | `paramsB` | | Tag | `paramsB` |
|---|---|---|---|---|
| `gemma4:31b-cloud` | **31** | | `qwen3-coder:480b-cloud` | 480 |
| `gpt-oss:120b-cloud` | **120** | | `qwen3-vl:235b-cloud` | 235 |
| `gpt-oss:20b-cloud` | 20 | | `qwen3-next:80b-cloud` | 80 |
| `ministral-3:14b-cloud` | **14** | | `devstral-2:123b-cloud` | 123 |
| `ministral-3:8b-cloud` | 8 | | `devstral-small-2:24b-cloud` | 24 |
| `ministral-3:3b-cloud` | 3 | | `cogito-2.1:671b-cloud` | 671 |
| `nemotron-3-nano:30b-cloud` | 30 | | `gemma3:4b/12b/27b-cloud` | 4 / 12 / 27 |
| `rnj-1:8b-cloud` | 8 | | `qwen3-vl:235b-instruct-cloud` | 235 |

**UNSIZED — `paramsB: null`, floors unchecked, `substitute` only:**
`gemma4:cloud`, `glm-4.6:cloud`, `glm-4.7:cloud`, `minimax-m2:cloud`,
`minimax-m2.1:cloud`, `minimax-m2.5:cloud`, `nemotron-3-super:cloud`,
`nemotron-3-ultra:cloud`, `qwen3-coder-next:cloud`.

Mechanism confirmed by reading the code: the regex is `tag.match(/^([\d.]+)b/i)`,
anchored at the start and **not** at the end — so `31b-cloud` → `31`, while `cloud`
→ `null`. **`gemma4:31b-cloud` is the right reasoning pick on both axes: free, and
sized.** `ministral-3:14b-cloud` is the minimal alternative that clears the 14B floor
exactly, at the lowest usage bucket.

### D.6 Retirements — the schedule source is still dead

`ollamaLibrary.RETIREMENT_URL` points at `https://docs.ollama.com/cloud`. I fetched it:
**1,420 bytes of prose with no retirement table.** It says retirements for recently
used models appear in your account's usage settings ([cloud docs](https://docs.ollama.com/cloud)).
So `parseRetirements()` yields `[]`, `retirementFor()` always returns null, and
`migrationPlan()` always produces nothing. **An empty plan reads as "all clear" when
it means "never checked."** `scheduleLoaded: false` is returned alongside, which is
the saving grace — but no UI obligation enforces the distinction. Unchanged from the
prior report; re-confirmed, not re-litigated.

---

## E. THROUGHPUT REALITY — the measurement that changes the lineup

### E.1 The single most consequential fact in this report

```
Get-CimInstance Win32_PhysicalMemoryArray  -> MemoryDevices: 2,  MaxCapacityEx: 64 GB
Get-CimInstance Win32_PhysicalMemory       -> 1 module populated
  slot='Bottom-Slot 1(left)'  bank='Controller0ChannelADimm0'
  32 GB @ 5600 MT/s  DataWidth=64bit  TotalWidth=64bit
```

**This machine runs 32 GB on a SINGLE 64-bit channel. Two slots, one populated.**

Peak memory bandwidth = 5600 MT/s × 8 bytes = **44.8 GB/s**. A dual-channel
configuration of the same memory would be **89.6 GB/s**. **The machine has half the
bandwidth any estimate would assume** — and for quantised LLM inference,
**bandwidth is the binding constraint**, because generating one token requires reading
every weight once.

Neither prior report measured this. It is the reason their token estimates were
optimistic.

### E.2 Derived ceilings — honest about being derived

`tok/s ≈ effective bandwidth ÷ bytes read per token`, where bytes/token ≈ the model
file size for a dense quantised model. CPU inference typically achieves 50–70% of peak;
I use 60% → **~27 GB/s effective**.

**These are derivations from a measured bandwidth figure, not benchmarks. Ollama is
not installed, so nothing was timed.** (§G.3)

| Model | Size | Ceiling @44.8 | Realistic @60% | Verdict |
|---|---|---|---|---|
| `glm-ocr:q8_0` | 1.6 GB | 28 tok/s | **~17 tok/s** | **comfortable** |
| `glm-ocr:latest` | 2.2 GB | 20 | ~12 | comfortable |
| `qwen3.5:4b` | 3.4 GB | 13 | **~8 tok/s** | **usable, interactive** |
| `qwen3.5:9b` | 6.6 GB | 6.8 | **~4 tok/s** | **usable but slow** — reading pace. The practical ceiling for interactive work |
| `qwen3.5:27b` | 17 GB | 2.6 | **~1.6 tok/s** | **nominally installable, practically unusable.** A 300-token answer takes ~3 minutes |
| `qwen3.5:35b` | 24 GB | 1.9 | ~1.1 | **do not.** 24 GB resident of 31.4 GB total leaves nothing for Electron + Chromium; it will swap |
| `nemotron3:33b` | 28 GB | 1.6 | — | **will not fit** alongside the app |
| `gemma4:31b` local | 19–20 GB | 2.3 | ~1.4 | unusable locally — **use `gemma4:31b-cloud`** |

**Prompt processing is a separate and underrated problem.** Prefill is compute-bound,
not bandwidth-bound, and the 135U has AVX2/AVX-VNNI but **no AVX-512**. Filling a large
context is slow. The 256K window on `qwen3.5` and the 128K on `glm-ocr` are real
*claims* but **time-to-first-token at even 32K will be minutes on this machine.**
A long window you cannot afford to fill is not the same as a long window.
This is a genuine UX caveat for the `long-context` role even once §F.1 is fixed.

### E.3 Does Ollama use the Intel iGPU? Mostly no, and it would not help much.

Measured devices: `Intel(R) Graphics` (driver 32.0.101.8508) and `Intel(R) AI Boost`
(the NPU). **No discrete GPU.**

From [Ollama hardware support](https://docs.ollama.com/gpu), fetched this session:

- First-class backends are **NVIDIA (CUDA)**, **AMD (ROCm)** and **Apple (Metal)**.
  **Intel appears nowhere in those tables.**
- Intel is reachable only through **Vulkan**, which is *"enabled by default when the
  backend is installed"*, and on Windows most vendor drivers bundle Vulkan support
  with no extra setup. The only Intel-specific link in the doc is for **Linux**.
- **Two caveats stated by Ollama itself:** Vulkan needs extra capabilities or root to
  report available VRAM, and without that *"Ollama will use approximate sizes of the
  models to make best effort scheduling decisions"* — so scheduling on this machine is
  a guess. And Ollama explicitly addresses the case *"where the Vulkan iGPU is
  unstable"*, with `OLLAMA_VULKAN=0` as the escape.
- **There is no SYCL, OpenVINO or IPEX path, and no NPU support at all.** `Intel AI
  Boost` will sit idle.

**The deeper point: an iGPU has no memory of its own.** It shares the same
single-channel 44.8 GB/s system RAM. Moving the matrix multiplies to the iGPU does not
raise the bandwidth ceiling that sets tok/s. **Expect CPU-class throughput whether
Vulkan engages or not**, and treat the §E.2 numbers as the operating reality.

### E.4 The cheapest real speedup — and it is not a GPU

**Populate the second SODIMM slot with a matching 32 GB DDR5-5600 module.** That moves
the machine to dual channel, **89.6 GB/s**, and roughly **doubles** every number in
§E.2 — `qwen3.5:9b` from ~4 to ~8 tok/s, `qwen3.5:27b` from ~1.6 to ~3.2. One free
slot, 64 GB supported, no software change, no recurring cost. **For this workload it
is better value than any GPU upgrade available to a U-series laptop.** Stated as a
fact for master to weigh; not a recommendation to spend.

---

## F. THE INTEGRATION BILL — by file

Invariant **I6**: Rāma writing its own source needs a ledger-recorded approval; master
editing his own source is outside that gate by design. Invariant **I10**: one
resource-admission authority, `electron/resourceOrchestrator.cjs`, owns `THRESHOLDS`
and `API_RATE_LIMITS`.

### F.1 `long-context` is unfillable for every model — `electron/lib/ollamaCatalog.cjs`

`describeInstalled()` L284: `ctxK: known?.ctxK ?? null, ctxVerified: false`, where
`known` comes from the four-entry `MODEL_REGISTRY` seed (llama3.2 / codellama /
mistral / phi3). **Measured this session: `ctxK=null` for all five models in the
recommended lineup.** `evaluate()` L181 then hard-excludes:
`no context length known, and this role needs 128K`.

The models are fine — **verified live: `qwen3.5` is 256K on every tag, `glm-ocr` is
128K on every tag.** `glm-ocr:q8_0` would fill `long-context` at 1.6 GB.

Two fixes:
- **Measurement (best):** read `model_info`'s `*.context_length` from Ollama's
  `/api/show` in `refreshOllamaModels()`. That is a measurement, so it may legitimately
  set `ctxVerified: true` → `declared`.
- **Catalogue (cheaper):** carry the window through `ollamaLibrary.parseLibrary()`.
  Stays `ctxVerified: false` → `substitute`, which is the honest label for a claim.

Files: `electron/lib/ollamaCatalog.cjs`, `electron/ipc/modelRouter.cjs`, possibly
`electron/lib/ollamaLibrary.cjs`.

### F.2 **NEW DEFECT** — an unsized model wins any floored role it can substitute for

**Found by running the project's own planner on the Ollama-only lineup. This is
specific to this lineup and neither prior report has it.**

Measured: `multilingual => ollama/glm-ocr:latest [substitute]` — **an OCR model was
selected to read master's non-English sources, over `qwen3.5:9b`.**

The mechanism, confirmed by probing `evaluate()` and `selectForRole()` directly:

1. `glm-ocr:latest` has `paramsB: null` (the tag is `latest`). `evaluate()` L171 puts
   *"parameter count unknown, so the 7B floor is unchecked"* into **`unverified`**, not
   `reasons` — so it is **not excluded**; it survives as a `substitute`.
2. `selectForRole()`'s comparator uses `p = x => (num(x.model.paramsB) ?? 0)` and, for
   a role with a floor, sorts **ascending** — "the smallest model that clears it is the
   cheapest correct answer." **`null` becomes `0`, so an unsized model sorts FIRST**,
   ahead of every properly-sized candidate.
3. It only bites where **nothing can be `declared`**, because `fit` is the primary sort
   key. `tool-calling`, `code` and `narration` all have a `declared` candidate, which
   masks the bug. **`multilingual` has `noLocalMeasure: true`, so nothing can ever be
   `declared`** — every candidate is a `substitute` — and the `null → 0` tiebreak
   decides the winner.

Measured corroboration: remove `glm-ocr` → winner becomes `qwen3.5:9b`. Give it a
**sized** tag (`glm-ocr:2b`) → correctly **excluded** at 2B < 7B floor, winner
`qwen3.5:9b`.

**And there is no pull-side workaround:** `glm-ocr` has exactly three tags —
`latest`, `q8_0`, `bf16` — **none carries a parameter count**
([glm-ocr tags](https://ollama.com/library/glm-ocr/tags)). So `paramsB` is `null` for
every glm-ocr tag master could choose. **This must be fixed in code.**

Fix: treat an unknown parameter count as **not smallest** in the comparator — e.g.
sort `null` last for floored roles (`Number.POSITIVE_INFINITY` instead of `0`), or
exclude unsized models from floored roles outright. File: `electron/lib/modelRoles.cjs`
→ `selectForRole()` comparator. A unit case belongs in `scripts/verifyModelRoles.cjs`.

### F.3 `API_RATE_LIMITS.ollama` is wrong for a cloud plan — `electron/resourceOrchestrator.cjs`

L82: `ollama: { reqPerMin: 9999, tokPerMin: 9999999, ... }`. **Correct for a local
daemon, wrong for a Free cloud plan.** Two distinct problems:

1. **No separate cloud entry.** `describeInstalled` already distinguishes them
   (`type: 'cloud-ollama'` vs `'local'`, `costTier` 1 vs 0), so the orchestrator should
   carry `ollama` (local, unmetered) and `ollama-cloud` (metered) as separate rows.
   Today, spend through Ollama Cloud is admitted essentially unmetered.
2. **The shape cannot express the actual limit.** The Free constraint is **one
   concurrent request** plus a **monthly credit pool**. `API_RATE_LIMITS` expresses only
   `reqPerMin` / `tokPerMin` with a 60-second reset window (L144). **Concurrency is not
   a rate, and a monthly pool is not a per-minute budget.** `TaskQueue._canRun()`
   cannot represent either. A faithful entry needs a concurrency slot count and a
   monthly token budget — **this is the one place where honouring I10 requires new
   policy, not just a new row.**

**Also found, same file, L370:**
`return { model: 'ollama/phi3', reason: 'fallback-all-limited' };`
**The last-resort fallback is hardcoded to `ollama/phi3`, which master will not have
installed** under this lineup (`qwen3.5:9b` / `:4b` / `qwen3-embedding` / `glm-ocr` /
`gemma4:31b-cloud`). When every provider is rate-limited, the orchestrator returns a
model id that does not exist. It should fall back to a *discovered* local model.

### F.4 `vectorMemory.cjs` — **the mixed-dimension index**, and master's DB instruction

`electron/ipc/vectorMemory.cjs` hardcodes the embedder (L82-85):

```js
const data = await net.postJson('http://localhost:11434/api/embeddings',
  { model: 'nomic-embed-text', prompt: text }, { timeout: 5000, retries: 0 });
if (Array.isArray(data?.embedding)) return { vector: data.embedding, source: 'ollama' };
...
return { vector: tfidfVector(text), source: 'tfidf' };   // tfidfVector(text, dims = 256)
```

**The design principle is already honoured** — and this is worth saying plainly:
`store()` calls `index.insertItem({ id, metadata: { text, ...metadata, ts }, vector })`,
so **the canonical text is stored in the record and the vector sits beside it as an
index.** Swapping the embedding model is therefore a **reindex, never a loss of
meaning**, exactly as the orchestrator's principle requires. Good.

**But there is a real defect, and it is the silent kind.** `store()` destructures
only `const { vector } = await embed(text)` — **it discards `source`**, and records
**neither the model name nor the vector dimension** in metadata. Consequence:

- Ollama absent (today — it is not installed): every vector written is a **256-dim
  TF-IDF** vector.
- Master installs Ollama and pulls an embedder: every *new* vector is the model's
  dimension instead.
- **Both cohorts land in the same `vectra` `LocalIndex`**, with nothing recording which
  is which. A query vector can only match one cohort; the other is mis-scored or
  unreachable. `health.errors` counts insert throws, not scoring decay.

**That is semantic memory degrading silently at the moment the system is upgraded** —
precisely the failure class this project spends effort avoiding elsewhere.

**Minimum fix:** record `embedModel` and `dim` in each item's metadata; refuse or
segregate on mismatch; expose a reindex action. **Then** change the hardcoded model.

Two smaller items in the same file:
- It calls the **legacy** `/api/embeddings` (singular `prompt`). Current Ollama docs
  use **`/api/embed`** with `input`, which **accepts arrays** — batching matters a lot
  for a 10k-record reindex ([nomic-embed-text](https://ollama.com/library/nomic-embed-text)).
- The health recommendation string still names `nomic-embed-text` (L210).

### F.5 Embedding model choice, and reindex cost

Verified live: **no embedding model is available on Ollama Cloud at all**
([embedding models](https://ollama.com/search?c=embedding) — 12 families, none with a
`cloud` badge). Embeddings are **local-only**, which is the right answer anyway since
they index master's holdings.

`qwen3-embedding` — **32K context**, and *"Embedding Dimension: Up to 4096, supports
user-defined output dimensions ranging from 32 to 4096"*
([qwen3-embedding](https://ollama.com/library/qwen3-embedding)). Those figures are
stated for the **8B**; the 0.6B's native dimension is not on the page (§G.4).
`nomic-embed-text` is **2K context and two years old** — the reason to move off it.

A **user-definable output dimension is strategically useful**: master can fix one
dimension and keep it stable across future model swaps, so a reindex never changes the
index geometry. **Whether Ollama's `/api/embed` exposes a dimensions parameter I could
not verify** (§G.4) — if it does not, the dimension is whatever the model emits.

**Reindex cost for ~10k records** (derived, not measured — §G.3): embedding is a single
forward pass, compute-bound, not autoregressive. A 0.6B model on 12 cores without
AVX-512 should manage roughly 500–1,000 tok/s. At ~500 tokens per record, 10k records
≈ 5M tokens ≈ **1.5–3 hours, single pass, batchable, and an overnight job.** Entirely
acceptable **given that it is a rebuildable index and not the record** — which is
exactly why the principle matters. Use `/api/embed` with batched `input` arrays to stay
at the low end.

### F.6 Structured output — the mechanism for "understood by any model"

Master's instruction: *"Utilise DB to store context which can be understood by any
model."* The model-side mechanism exists and is verified:

**Ollama supports enforcing a JSON schema on responses via the `format` field, and via
`response_format` on the OpenAI-compatible API**
([structured outputs](https://docs.ollama.com/capabilities/structured-outputs)). Its
own guidance: define the schema with Pydantic or Zod and **set temperature to 0** for
determinism. Vision models accept the same `format` parameter.

So a model-agnostic record is achievable: **store canonical text + a schema-validated
JSON projection; keep vectors as a rebuildable index beside it.** Any model that
honours `format` can read and write the same records. All lineup models are
tools-capable families, which is the group that handles structured output best.

### F.7 PROTECTED FILES — the exact procedure, not an assumption

`scripts/verifyLoyaltyTripwire.cjs` takes its list from
`electron/lib/loyaltyGuard.cjs → PROTECTED_FILES` (read this session), which contains
**both** files the brief names:

```
electron/lib/loyaltyGuard.cjs   electron/lib/loyaltyCore.cjs   electron/nucleusSealer.cjs
electron/lib/proposals.cjs      electron/lib/capability.cjs    electron/lib/genomeApplier.cjs
shared/capabilities.json
```

**Nothing in the Ollama-only path requires editing either file.** Voice, embeddings,
rate limits and role selection all live outside the protected set. Stated so no one
assumes otherwise.

**If a capability entry is ever needed** — and the one plausible candidate is a
`voice.transcribe` entry, since `shared/capabilities.json` today has **only**
`identity.voice-wake: 0` and no transcription capability at all (file read in full
this session) — then **it cannot simply be added.** The procedure is:

1. Add the entry to `shared/capabilities.json`.
2. Run `node scripts/verifyLoyaltyTripwire.cjs`. It fails and **prints the new
   `manifestDigest`**.
3. Hand the digest back deliberately:
   ```powershell
   $env:RAMA_MASTER_APPROVAL = '<the manifestDigest printed by the failure>'
   node scripts/verifyLoyaltyTripwire.cjs --approve --note "<why>"
   ```
4. **Commit `shared/loyalty-tripwire.json` in the same commit as the change it
   approves.**

`--approve` refuses unless the environment carries the exact digest being approved —
*"An approval you did not have to read is not an approval."* Two records are checked:
per-file SHA-256 **and** a digest over all of them, so a single-file edit cannot
self-approve.

**Suggested entry, for master to decide:** `"voice.transcribe": 0` — tier 0, matching
`identity.voice-wake`, because transcription carries master's own voice. Specified
here rather than added.

### F.8 Summary of the bill

| File | Change | Cost |
|---|---|---|
| `electron/lib/ollamaCatalog.cjs` | measure `ctxK` from `/api/show` → unblocks `long-context` | small |
| `electron/lib/modelRoles.cjs` | `null` paramsB must not sort as smallest (**F.2**) | small, important |
| `electron/resourceOrchestrator.cjs` | split `ollama` / `ollama-cloud`; express concurrency + monthly pool; fix the `ollama/phi3` fallback | medium, I10 policy |
| `electron/ipc/vectorMemory.cjs` | record `embedModel` + `dim`; segregate cohorts; `/api/embed` batching; de-hardcode the model | medium, **data integrity** |
| `electron/lib/ollamaLibrary.cjs` | retirement source is dead; surface "never checked" honestly | small |
| `electron/ipc/voiceEngine.cjs` | only if whisper.cpp is adopted | medium |
| `shared/capabilities.json` | **only** if `voice.transcribe` is wanted — **PROTECTED**, procedure in F.7 | gated |
| *none* | guardrail classification — **already works with no model** | zero |

---

## G. NOT VERIFIED

Stated plainly. An admitted gap beats a plausible claim, and it applies hardest to a
list master will act on.

1. **Ollama's official free "starter model" list.** Ollama does not publish it; the
   pricing page says only *"a set of starter models"*. §D.4's ✅/🔒 split comes from an
   **unofficial third-party tracker** that probed a real Free account on **2026-09-15**
   — empirical, but not Ollama's word and ~2.5 weeks old. **Confirm in the Ollama app
   or the account usage page before relying on it.** The corroborating "Low Usage"
   labels on `gemma4:cloud` and `gemma4:31b-cloud` *are* from ollama.com and are verified.
2. **Behaviour at zero remaining free credits.** Explicit rejection is strongly implied
   (queue-full rejections and subscription errors are both explicit), but I did not
   observe a credit-exhausted request. **Verified** that the 90%-usage email is
   paid-plans-only, so a Free account gets no proactive warning.
3. **Every tokens-per-second figure in §E.** **Derived** from a measured 44.8 GB/s
   single-channel bandwidth and a 60%-of-peak efficiency assumption — **not
   benchmarked. Ollama is not installed, so nothing was timed.** The *bandwidth,
   channel count, CPU, GPU and free slot are measured.* Confirm with
   `ollama run --verbose` before trusting any local model choice. Likewise the 1.5–3
   hour reindex estimate in §F.5.
4. **Embedding dimensions.** `qwen3-embedding`'s page states 32K context and 32–4096
   user-defined dimensions **for the 8B**; the **0.6B's native dimension is not stated**
   and I did not verify it. `nomic-embed-text`'s page **does not state its dimension at
   all** — I deliberately did not supply a number from memory. **Whether Ollama's
   `/api/embed` exposes a dimensions parameter is unverified**; the API reference did
   not yield that text to this fetcher.
5. **Whether Ollama's Vulkan path engages this specific Intel iGPU on Windows, and by
   how much.** Ollama's doc says Vulkan is on by default and Windows drivers usually
   bundle it, but its only Intel link is for Linux and it warns about unstable Vulkan
   iGPUs. **Unmeasured.** The §E.3 conclusion (bandwidth-bound either way) does not
   depend on it.
6. **whisper.cpp and openWakeWord throughput on this chip.** The model file sizes are
   from general knowledge of those projects, **not fetched this session**, and no
   transcription was timed. Treat §C.1's "faster than realtime for `base`" as an
   expectation to verify, not a measurement.
7. **A conflict I did not resolve.** A third-party post claims Ollama cloud usage is
   metered by **GPU-time** with 5-hour and weekly windows. Ollama's own pricing page and
   FAQ say usage is measured **in tokens** at published per-million rates, resetting
   monthly. **I went with Ollama's own page**; the third-party claim may describe a
   superseded scheme.
8. **`vite build`.** Not attempted — and per the project's standing note it could not
   be verified here regardless. **No source file was modified, so nothing could have
   broken.** The two probe scripts I ran live in `%TEMP%\rama_probe\`, outside the
   repository.
9. **Whether `models:refresh-catalog` succeeds against the live library through the
   app's own `lib/http.cjs`.** My fetches went through this agent's fetcher.
   **PowerShell HTTPS failed outright this session** with a TLS error, which is reason
   for real doubt about the app's own egress path. §D.6's dead retirement source is
   confirmed either way.

---

## EVIDENCE — file and symbol citations

| Claim | Source (verified this session) |
|---|---|
| Only Ollama models can fill a role; all four call sites | `electron/ipc/modelRouter.cjs` L256, L277, L422, L437 — `Object.values(discoveredOllama)` |
| Nine roles, floors, one sensitivity gate | `electron/lib/modelRoles.cjs → ROLES` |
| Sensitive role refuses non-private outright | `modelRoles.evaluate()` L165 |
| `private` means weights measured on this disk | `ollamaCatalog.describeInstalled()` L279 — `private: cls.cloud === false` |
| `ctxK` always null → `long-context` excluded | `describeInstalled()` L284; `evaluate()` L181; **measured: null for all 5** |
| `paramsB` reads the tag, start-anchored | `ollamaCatalog.paramsB()` L121; **measured over 27 free cloud tags** |
| Unsized model sorts first in a floored role | `modelRoles.selectForRole()` comparator L242 — `(num(x.model.paramsB) ?? 0)`; **measured** |
| `glm-ocr` has no sized tag | [glm-ocr tags](https://ollama.com/library/glm-ocr/tags) — `latest`, `q8_0`, `bf16` only |
| `ollama` rate limit 9999/min; no cloud entry | `electron/resourceOrchestrator.cjs` L82 |
| Rate check skipped when no entry; 80% buffer | `TaskQueue._canRun()` L140-146; `THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER = 0.8` |
| Hardcoded `ollama/phi3` last-resort fallback | `electron/resourceOrchestrator.cjs` L370 |
| `nomic-embed-text` hardcoded at legacy endpoint | `electron/ipc/vectorMemory.cjs` L82-85 |
| TF-IDF fallback is 256-dim; `source` discarded on store | `vectorMemory.cjs` — `tfidfVector(text, dims = 256)`; `store()` `const { vector } = await embed(text)` |
| Canonical text stored beside the vector | `vectorMemory.store()` — `insertItem({ metadata: { text, ... }, vector })` |
| Guardrail classification uses no model | `electron/lib/claimGate.cjs → classifyOne()` L262 |
| TTS works on OS voices, no model | `src/services/voiceEngine.js → speak()` L691 |
| Five voice levels; local STT preferred over cloud | `voiceEngine.js` — `VOICE_LEVELS`, `LEVEL_NAMES`, `resolveVoiceCapability()` L158-165 |
| `identity.voice-wake` is tier 0; no `voice.transcribe` exists | `shared/capabilities.json` (read in full) |
| Both `capabilities.json` and `capability.cjs` are protected | `electron/lib/loyaltyGuard.cjs → PROTECTED_FILES` |
| Two-record attestation; `--approve` needs the digest | `scripts/verifyLoyaltyTripwire.cjs` — `MANIFEST`, `manifestDigestOf()`, `approve()` |
| 31.4 GB **single-channel** DDR5-5600, 2 slots / 1 used, 64 GB max | `Win32_PhysicalMemory`, `Win32_PhysicalMemoryArray` |
| Core Ultra 5 135U, 12c/14t; Intel Graphics + AI Boost NPU; no dGPU | `Win32_Processor`, `Win32_VideoController`, `Win32_PnPEntity` |
| 99.0 GB free; Ollama **not installed** | `Get-PSDrive C`; `Get-Command ollama` → not found |

**Web sources:** [Ollama pricing](https://ollama.com/pricing) ·
[cloud docs](https://docs.ollama.com/cloud) ·
[cloud models](https://ollama.com/search?c=cloud) ·
[audio models](https://ollama.com/search?c=audio) ·
[embedding models](https://ollama.com/search?c=embedding) ·
[hardware support](https://docs.ollama.com/gpu) ·
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs) ·
[gemma4](https://ollama.com/library/gemma4) + [tags](https://ollama.com/library/gemma4/tags) ·
[nemotron3](https://ollama.com/library/nemotron3) + [tags](https://ollama.com/library/nemotron3/tags) ·
[qwen3.5 tags](https://ollama.com/library/qwen3.5/tags) ·
[glm-ocr tags](https://ollama.com/library/glm-ocr/tags) ·
[qwen3-embedding](https://ollama.com/library/qwen3-embedding) ·
[nomic-embed-text](https://ollama.com/library/nomic-embed-text) ·
[ollama-cloud-free-tier tracker (unofficial)](https://github.com/OshriFatkiev/ollama-cloud-free-tier)

---

## CONCLUSIONS

1. **The Ollama-only constraint costs one capability: speech-to-text.** Measured, not
   argued: the same 8-of-9 roles fill, with the same 7 `declared`, as the lineup that
   assumed paid providers.
2. **It is an architectural fit, not a compromise.** The role engine only ever sees
   Ollama models. Master's constraint matches the machinery that already exists.
3. **The two real gaps in the role table are code defects, not missing downloads** —
   `long-context` (`ctxK` never measured) and `multilingual` (an unsized model sorts as
   smallest). Both cost nothing to fix and both are fixed in files outside the
   protected set.
4. **The most urgent defect is not about models at all.** `vectorMemory.cjs` will mix
   256-dim TF-IDF vectors and model vectors in one index the moment Ollama is
   installed, with no record of which is which. Master's own instruction about
   DB-stored context lands directly on it. **Fix the metadata before changing the
   embedder.**
5. **The hardware reality is harsher than previously estimated, and the remedy is
   cheap.** Single-channel 44.8 GB/s puts the practical local ceiling at `qwen3.5:9b`
   (~4 tok/s). `qwen3.5:27b` is nominally installable and practically unusable at
   ~1.6 tok/s — which is exactly why `gemma4:31b-cloud` carrying `reasoning` as
   `declared`, for free, is the right call. **Populating the free SODIMM slot would
   roughly double every local figure** and is better value here than any GPU.
6. **Voice deserves a decision rather than a default.** Ollama holds audio-capable
   weights (`gemma4:e4b`, `nemotron3`) but serves no audio input path, so waiting is
   legitimate. `whisper.cpp` is a free *local binary* — not a paid API, no account, no
   network — and keeps master's voice on the machine, which is *stronger* on loyalty
   than any cloud STT. **That is master's call, and it is a genuine choice, not a
   fallback.**

---

*This file is untracked (`.agents/` is not in git) and nothing was committed. It is a
report; nothing was implemented. The ledger has not been updated — if master wants any
of §F acted on, those are new tasks and belong in Section 28 before implementation,
per the working agreement.*
