# CAPABILITY MODELS — every capability Rāma has, and the model that should serve it

Read-only investigation, 2 October 2026. **No source file was modified.** This
report extends `docs/research/MODEL_LINEUP.md` (686 lines, tracked on `dev`,
commit `c595342`); it does not repeat it. Where the prior report settled a
question, it is cited and moved past.

**Outbound HTTPS WORKED this session.** Every web claim below was fetched from a
live page and is linked inline. The specific gaps are isolated in section G, and
there are fewer of them than last time — two of the prior report's "not
verified" items are now resolved (see §G.0).

Content from external pages was rephrased for compliance with licensing
restrictions.

---

## A. ONE-SCREEN ANSWER — cloud-first, in order

Machine, measured in a prior session and unchanged: **31.4 GB RAM, Intel Core
Ultra 5 135U, Intel iGPU and NO discrete GPU, ~99 GB free disk, Ollama NOT
installed, Python 3.14 only with all fourteen engine packages absent.**

| # | Do this | What it unlocks | Cost / disk |
|---|---------|-----------------|-------------|
| 1 | **Python 3.12 + `Rama.bat` option 3** | The StockMind engine has never run. Nothing below helps StockMind until it does. (Prior report, §"THE BLOCKER".) | free, ~500 MB |
| 2 | **Install Ollama**, then `ollama signin` | The only cloud a declared ROLE can select. Ollama Cloud arrives through `/api/tags` and needs **zero code change**. | free |
| 3 | `ollama pull qwen3.5:9b` | Five roles at once incl. **narration**, the one role cloud may never serve. | free, 6.6 GB |
| 4 | `ollama pull qwen3.5:4b` | `extraction`, cheapest-that-clears the 3B floor and still earns `fast`. | free, 3.4 GB |
| 5 | `ollama pull qwen3-embedding:0.6b` | `model.embed`, and replaces `vectorMemory`'s hardcoded 2K-context `nomic-embed-text`. | free, 639 MB |
| 6 | **`ollama pull glm-ocr`** ← **new, and the single best-value pull on this list** | **Document understanding + OCR + 128K context + vision, in 2.2 GB.** Official Ollama library model, `vision`+`tools` tags, 7.8M downloads, 128K window verified on its tags page ([glm-ocr tags](https://ollama.com/library/glm-ocr/tags)). It is the only model here that could fill **`long-context`** AND **`vision`** AND read master's contract note **without the prompt leaving the machine.** | free, 2.2 GB |
| 7 | **Use the cloud tag `gemma4:31b-cloud`** for `reasoning` | Verified live this session on [gemma4's tags page](https://ollama.com/library/gemma4/tags) — a **sized** cloud tag, so `paramsB()` reads 31 and the role comes back `declared` rather than `substitute`. This resolves the prior report's open item. Alternative: `gpt-oss:120b` at $0.15/$0.60 per M ([Ollama pricing](https://ollama.com/pricing)). | free starter credits |
| 8 | **Get a Groq key** — this is the voice decision | Groq is the **only** provider on this list that serves STT *and* TTS *and* a guardrail classifier on an **OpenAI-compatible** endpoint, and `electron/ipc/voiceEngine.cjs` already speaks that exact wire format. `whisper-large-v3-turbo` at **$0.04/audio-hour**; free-tier **20 RPM / 2K RPD / 7.2K audio-sec per hour / 28.8K per day** — i.e. **8 audio hours a day, free** ([Groq STT](https://console.groq.com/docs/speech-to-text), [Groq rate limits](https://console.groq.com/docs/rate-limits)). | free tier |
| 9 | In Rāma: run **`models:refresh-catalog`** (master-only) | Until it runs, no discovered model carries a `code` or `vision` cap and both roles report unfilled whatever you pulled. | free |
| 10 | **Do NOT buy a Google AI Studio key for voice or documents** | Gemini's free tier is marked **"Used to improve our products: Yes"** on every row including `gemini-3.5-transcribe` and multimodal embedding ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). Master's voice and his contract note are exactly what must not go there. Fine for public news. | — |

**Total local disk: ~12.9 GB** of 99 GB free (the prior report's 10.7 GB plus
`glm-ocr`'s 2.2 GB). **Total cash today: $0.**

**Three things no model fixes, stated up front:**

- **TTS already works and needs no model.** `voiceEngine.js → speak()` uses
  `window.speechSynthesis` with the OS SAPI voices. It is free, zero-install,
  zero-latency and private. Buying a TTS model is a *quality* upgrade, not a
  capability gap. Do it last.
- **Wake word needs a detector, not an LLM**, and there is no Ollama answer.
  See §B row 6.
- **Nothing about price prediction belongs to a language model.** §B row 14 and
  §C.4 refuse it with the reason.

---

## B. THE CAPABILITY × MODEL MATRIX

Fourteen classes. "Free Ollama cloud" means reachable on a free ollama.com
account. "Gate?" means: does this capability deserve `sensitive: true`
treatment in the sense `electron/lib/modelRoles.cjs → ROLES.narration` uses it
— the prompt must not leave this machine.

| # | Class | What it serves in THIS codebase | Free Ollama cloud pick | Best cloud elsewhere | Local pick for later (disk) | Gate? | Integration work |
|---|-------|--------------------------------|------------------------|----------------------|------------------------------|-------|------------------|
| 1 | **General reasoning / chat** | `chat.send` (tier 5, the only tier-5 cap), `TOOL_REGISTRY['model.chat']`, cognition TIER 2 | `gemma4:31b-cloud` · `gpt-oss:120b` | Groq `openai/gpt-oss-120b` | `qwen3.5:27b` (17 GB) — ~1.5–3 tok/s here | No | **None** for Ollama Cloud |
| 2 | **Tool / function calling** | `routeToTools()` over 17 tools in `src/services/ramaCore.js`; `agents.spawn` | `gpt-oss:120b`, `minimax-m3` | Groq `gpt-oss-120b` | `qwen3.5:9b` (6.6 GB) | No | None |
| 3 | **Code** | `/ide` page, `electron/ipc/astEngine.cjs`, `codeRegenEngine.cjs`, `selfBuildPipeline.cjs` — Rāma writing its own upgrade diffs | `kimi-k2.7-code` ($0.95/$4.00) · `glm-5.3` ($1.40/$4.40) | Groq `qwen/qwen3.8-27b` ($0.80/$4.00, 131K ctx) | `qwen3.5:9b`; upgrade `qwen3-coder:30b` (19 GB) | **Yes when the diff is of Rāma's own protected core** — see §F.3 | None for Ollama; a coding-specialised model does NOT beat a general one at the sizes that fit here — see §C.1 |
| 4 | **Speech → text** | `voiceEngine.js` L2 LOCAL STT / L3 CLOUD STT; `voiceEngine.cjs → transcribe()` | **NONE. Ollama does not serve STT.** | **Groq `whisper-large-v3-turbo`**, $0.04/audio-hr, free tier 8 audio-hr/day | `whisper.cpp` + `ggml-base.bin` (~148 MB) or `small` (~488 MB) | **YES — master's own voice** | **One base-URL + model change** in `voiceEngine.cjs`. See §D.1 |
| 5 | **Text → speech** | `voiceEngine.js → speak()` | None | Groq `canopylabs/orpheus-v1-english`, $22/1M chars, free 10 RPM / 100 RPD | **Piper** (~63 MB/voice) or **Kokoro-82M** (~86–92 MB int8 ONNX) | No (output only) | New IPC handler + audio playback. **Lowest priority — SAPI already works** |
| 6 | **Wake word** | `voiceEngine.js → WAKE_WORDS`, `capability.wakeWordCapable`, cap `identity.voice-wake` (**tier 0**) | None | None worth having (streaming ambient audio to an API is the wrong trade, and `voiceEngine.cjs` says so in a comment) | **openWakeWord** ONNX, **~200 KB per phrase** | **YES — always-on mic** | Train "hey rāma"; add an ONNX runtime. See §C.2 |
| 7 | **Embeddings** | `TOOL_REGISTRY['model.embed']`, `electron/ipc/vectorMemory.cjs → embed()` | **No embedding model appears in Ollama's cloud list** ([cloud models](https://ollama.com/search?c=cloud)) | Gemini Embedding (free tier, **but trains on free-tier data**) | **`qwen3-embedding:0.6b`** (639 MB, 32K ctx) | **YES — it embeds everything, incl. holdings** | None locally; `vectorMemory.cjs` hardcodes `nomic-embed-text`. §D.3 |
| 8 | **Reranking** | Retrieval quality after `vectorMemory.search()`; `intelligenceEngine.cjs` cross-reference step | None (no official reranker tag) | Cohere / Jina rerank APIs — **not recommended**, see §C.3 | `dengcao/Qwen3-Reranker-0.6B` — **community tag, 23.8K pulls, 1 yr old** ([ollama search](https://ollama.com/search?q=reranker)) | Yes (same reason as 7) | `isEmbeddingModel()` would mis-classify a reranker as an embedder. §D.4 |
| 9 | **Vision / screen** | `ROLES.vision` ("reading a chart or a screenshot master pastes in") | `glm-5.3-flash`, `kimi-k3`, `minimax-m3`, `gemma4` (all carry `vision`) | Groq has **no vision model** in its current catalogue ([Groq models](https://console.groq.com/docs/models)) | `qwen3.5:9b`; dedicated `qwen3-vl:4b` (3.3 GB, 256K) or `:2b` (1.9 GB) | Only if the screenshot is of master's portfolio | None; needs `models:refresh-catalog` first |
| 10 | **Document understanding + OCR** | **NO CODE PATH EXISTS TODAY.** `costs.py` and `charge_watch.py` both name master's contract note as the sole authority on his charges, and nothing can read one. | `glm-5.3-flash` (vision+cloud) | Gemini (**free tier trains — refuse**) | **`glm-ocr` (2.2 GB, 128K ctx)**, alt `deepseek-ocr` (6.7 GB, **8K ctx**) | **YES — a contract note is master's financial record** | **Largest build item.** New tool, new capability entry, PDF→image step. §D.2 |
| 11 | **Long context** | `ROLES['long-context']`, minCtxK 128 — **`none` for every model today** | `minimax-m3` (1M ctx, per its library card) | Gemini 1M | **`glm-ocr` 128K · `granite4:*-h` 1M · `qwen3.5` 256K · `gemma4:12b+` 256K** | No | Code defect, not a download. §D.5 — now fixable with **verified** numbers |
| 12 | **Classification / guardrails** | `electron/lib/claimGate.cjs` (`CLASS = grounded/reflex/prose/unattributed`); screening a `destructive: true` tool call before it runs | None | **Groq `meta-llama/llama-prompt-guard-2-22m`** — $0.03/$0.03 per M, 512 ctx, free 30 RPM / 14.4K RPD / 500K TPD. Also `gpt-oss-safeguard-20b`. | `functiongemma:270m`; `qwen3.5:2b` (2.7 GB) | Yes if it sees the prompt it screens | §D.6 — and claimGate works **without** a model today, so this is additive only |
| 13 | **Translation / multilingual** | `ROLES.multilingual` (`noLocalMeasure: true` → always `substitute`); `news.py` non-English sources | `mistral-large-3`, `gemma4` | Gemini (public news only) | `qwen3.5:9b` | No | None |
| 14 | **Time series / forecasting** | `ai_backend/engine/projection.py`, `models.py`, `strategy_eval.py` | **REFUSED — see §C.4** | **REFUSED** | LightGBM/XGBoost already pinned in `requirements.txt`; **FinBERT-class classifier** for the `SentimentModel` stub | n/a | **Install Python 3.12. No LLM.** |

### The capability surface, measured

| Measured | Value | Source |
|---|---|---|
| Capabilities in the matrix | **77** | `shared/capabilities.json → capabilities` |
| Of those, **tier 0** (master only) | **29** | same; tier 1 = 14, tier 2 = 18, tier 3 = 13, tier 4 = 2, tier 5 = 1 |
| Registered tools | **17** | `TOOL_REGISTRY`, `src/services/ramaCore.js` |
| Pages / routes | **18** | `PAGES`, `src/config/registry.js` |
| Tier-0 reflex skills | **9** | `SKILLS`, `src/services/cognition.js` |
| Voice levels | **5** (TEXT → WAKE WORD) | `VOICE_LEVELS`, `src/services/voiceEngine.js` |
| Protected files | **7** | `loyaltyGuard.PROTECTED_FILES` |

**Nine capabilities already answered with NO model, and recommending one for
them would be waste.** `SKILLS` in `src/services/cognition.js`:
`appearance.bigger`, `appearance.smaller`, `appearance.reset`,
`navigation.open`, `voice.mute`, `system.status`, `self.capabilities`,
`self.cognition`, `self.reload`. The module's own header states the rule —
*"make the text bigger" is not a language problem.* Add to that list:
`matchVoiceCommand()` (pattern matching, not NLU), `claimGate.gate()`
(tokenisation and evidence indexing), `selfModel.describe()` (composition of
measured facts), `strategy_eval` (stdlib statistics, deliberately), and
`projection.py`'s risk ruler (*"both are arithmetic over stored bars, so both
are actionable today with no model involved"*). **None of these should ever be
handed to a model.**

**Capabilities with no model dimension at all** — `vault.*`, `users.*`,
`git.*`, `release.*`, `instances.*`, `timeline.*`, `audit.*`, `os.*`,
`terminal.*`, `genome.*`. A model may *decide to call* them; none is *served
by* one. Of the 77 capabilities, roughly **20** have a genuine model dimension;
the rest are authority, plumbing or state.

---

## C. WHAT HAS NO GOOD ANSWER TODAY

### C.1 A coding-specialised model does not beat a general one at the sizes that fit

The `code` role needs ≥7B **and** a `code` cap. But `describeInstalled()`
derives that cap from the family's **`tools`** tag
(`if (entry?.tools || known?.caps?.includes('code'))`), so `qwen3.5:9b` already
satisfies it and `qwen3-coder:30b` would not outrank it for being a coder. On
the merits: `qwen3-coder` is a year old, costs 19 GB, and on a 15 W U-series CPU
with no discrete GPU it is not interactively usable. The honest answer is **use
`qwen3.5:9b` locally and `kimi-k2.7-code` in cloud for anything hard** — and
fix the derivation deliberately rather than leave it implicit (prior report
§E.6, still open).

### C.2 Wake word: no cloud answer, and the free local path has a dependency problem

`identity.voice-wake` is a **tier-0** capability — master-only. It is also the
one model that runs *continuously*, which rules out cloud on both cost and
privacy. Two options and neither is clean:

- **openWakeWord** — Apache-licensed, pre-trained phrases, ~200 KB ONNX
  artefacts, runs on one Raspberry Pi 3 core
  ([ovos plugin](https://github.com/OpenVoiceOS/ovos-ww-plugin-openwakeword),
  [trainer](https://github.com/lgpearson1771/openwakeword-trainer)). No
  pre-trained "hey rāma" exists, so one must be trained — and multiple
  2026 community repos exist *specifically because* the upstream training
  pipeline pins 2022-era PyTorch/TensorFlow and no longer installs cleanly
  ([atlas-voice-training](https://github.com/briankelley/atlas-voice-training/)).
  Inference is fine; training is the friction. Mitigation: ship `hey_jarvis`
  (pre-trained, already a `WAKE_WORDS` cousin in spirit) as the fallback and
  train "hey rāma" later.
- **Picovoice Porcupine** — instant custom phrase training, best published
  accuracy. A third-party post says the **free tier was deprecated 30 June
  2026**; Picovoice's pricing page would not yield that text to this fetcher, so
  **treat it as unverified** (§G.4).

**Verdict: openWakeWord, accept the training friction, keep `hey_jarvis` as the
shipped fallback.** Until then, `MIC_MODES.HANDS_FREE` with the existing RMS VAD
(`VAD.SPEECH_RMS = 0.018`, `SILENCE_MS = 1200`) is the right answer and it
already works.

### C.3 Reranking has no respectable answer

No official Ollama library model serves reranking. Every candidate is a
**community upload** — `dengcao/Qwen3-Reranker-0.6B` (23.8K pulls),
`qllama/bge-reranker-v2-m3` (282.9K pulls), all **a year old**
([search](https://ollama.com/search?q=reranker)). Some carry an `embedding`
tag, some a `tools` tag, some neither — meaning
`modelRoles.isEmbeddingModel()`'s `/embed|minilm|\bbge\b/i` fallback would
classify `bge-reranker-v2-m3` as an **embedder**, which it is not. A hosted
reranker (Cohere, Jina) means a new provider, a new rate-limit entry, and
sending every candidate passage off-machine for a retrieval-quality gain that
has not been measured here.

**Verdict: do not add reranking yet.** Spend the effort on
`qwen3-embedding:0.6b`'s 32K context instead — going from
`nomic-embed-text`'s **2K** window to 32K is a far larger retrieval win than
reranking a bad candidate set, and it costs 639 MB and no new provider.

### C.4 Price forecasting by language model — REFUSED, with the reason

Master asked for every capability. This one is refused, not deferred.

- `projection.py`'s header states the design: **a cone, never a path**, the
  width measured from realised volatility, the centre flat *"unless a model is
  entitled to tilt it, and a gate-refused model tilts it by nothing at all."*
- `strategy_eval.py` exists to be *"the judge that the search cannot flatter"*
  and explicitly refuses to rank by raw return or raw Sharpe, or to report a
  metric without the trial count.
- `claimGate.classifyOne()` refuses a modal claim whose evidence is not a
  REFLEX record — reason `unsourceable-prediction`. **An LLM opinion about a
  price is precisely that**, and the gate would withhold it.

On time-series *foundation* models specifically, the literature agrees with the
codebase. A June 2026 benchmark of TimeGPT, TimesFM-2.5, Moirai-2.0, Chronos and
Chronos-2 against five liquid US equities concludes they are useful priors that
cut model-development cost, but **not reliable engines for statistically
meaningful alpha** — gains over a random walk were small and sparse, and a
one-sided Diebold-Mariano test rejected equal-or-worse accuracy in only two of
ten tasks ([arXiv 2606.27100](https://arxiv.org/abs/2606.27100)).

**What IS legitimately a model here**, and what master should fund instead:

1. **LightGBM / XGBoost** — already pinned in `ai_backend/requirements.txt`
   (`lightgbm==4.5.0`, `xgboost==2.1.3`). They need **Python 3.12**, not a
   download. This is item 1 of §A for a reason.
2. **A FinBERT-class text classifier** for `models.py`'s `SentimentModel`
   stub — which `news.py` records as having returned
   `0.5 + np.random.normal(0, 0.04)` on every prediction, *"pure noise,"* one of
   eight ensemble members a random number generator. A fine-tuned encoder of a
   few hundred MB is the right tool: fine-tuned FinBERT/FinDRoBERTa have been
   shown to beat much larger zero-shot general models on financial sentiment
   ([arXiv 2409.11408](https://arxiv.org/abs/2409.11408)), while a 2026 study
   finds fine-tuned 7–8B LLMs ahead again on heterogeneous corpora
   ([arXiv 2512.00946](https://arxiv.org/html/2512.00946v1)). Either way it is a
   **classifier**, it reports a label with a confidence, and `news.py` already
   holds the line that sixteen days of history cannot support a trained feature
   — **so this must stay context, not a signal, until Section 69's gate can
   judge it.**
3. **Nothing else.** No LLM touches a price.

### C.5 Capacity ceilings on a free account

- **Ollama Free = 1 concurrent request** ([pricing FAQ](https://ollama.com/pricing)).
  Confirmed verbatim on the live page this session. `resourceOrchestrator.
  API_RATE_LIMITS.ollama` is `{ reqPerMin: 9999 }` — correct for a local
  daemon, **wrong by three orders of magnitude for a cloud plan**. Any design
  that wants parallel work — `resourceResearchEngine` researching three
  directions at once, a batch of self-upgrade proposals, `agentOrchestrator`
  fanning out — will serialise behind one slot, and admission control will not
  know. Cheapest paid step: **Pro $20/mo, $60 credits, 3 concurrent.**
- **Groq free STT = 28.8K audio-seconds/day** ≈ 8 audio hours. Ample for
  dictation; not for always-on. Which is exactly why wake word must be local.
- **Groq free TTS = 100 RPD** on Orpheus. That is ~100 spoken replies a day.
  Thin for a conversational assistant — another reason SAPI stays the default
  and Orpheus is the garnish.
- **Gemini free tier RPM/TPM/RPD are no longer published by Google.** Still
  true (prior report §F.3). One free-tier count was *claimed* by a third party
  as 23 of 35 model entries, checked 28 Sept 2026 — not from a Google page, do
  not design against it.

---

## D. THE INTEGRATION BILL

The architectural fact that governs all of it, re-verified this session:
**only Ollama models can fill a declared ROLE.** Every role call site in
`electron/ipc/modelRouter.cjs` passes `Object.values(discoveredOllama)` —
`models:roles` (line 256), `models:role-research` (277), `selectModel` (422),
`roleNoteFor` (437). A Groq or Gemini key is reachable through `models:chat` and
`FALLBACK_CHAIN` but can **never** fill a role. So every non-Ollama
recommendation below carries an integration cost, stated.

Invariant **I10**: one admission authority, `electron/resourceOrchestrator.cjs`,
owning `THRESHOLDS` and `API_RATE_LIMITS`. Invariant **I6**: Rāma writing its
own source needs an approval recorded in the ledger.

**PROTECTED FILES — `loyaltyGuard.PROTECTED_FILES`, verified this session:**
`electron/lib/capability.cjs`, `electron/lib/genomeApplier.cjs`,
`electron/lib/loyaltyCore.cjs`, `electron/lib/loyaltyGuard.cjs`,
`electron/lib/proposals.cjs`, `electron/nucleusSealer.cjs`,
**`shared/capabilities.json`**. `scripts/verifyLoyaltyTripwire.cjs` records a
SHA-256 per file plus a manifest digest over all of them, and asserts *"no
protected file has changed since master approved it"* and *"newly protected and
unapproved"*. **So a new capability cannot simply be added — the entry must be
specified, approved by master, and the manifest re-attested.** Every capability
proposed below is written out as an exact entry for that reason.

### D.1 Groq for STT — the cheapest integration in this report

`electron/ipc/voiceEngine.cjs → transcribeCloud()` builds a multipart body and
POSTs to `https://api.openai.com/v1/audio/transcriptions` with
`field('model', 'whisper-1')`. Groq's endpoint is
`https://api.groq.com/openai/v1/audio/transcriptions` and is **OpenAI-compatible
with the same field names** — `file`, `model`, `language`, `response_format`,
`prompt`, `temperature`, `timestamp_granularities`
([Groq STT](https://console.groq.com/docs/speech-to-text)).

- **Change:** `electron/ipc/voiceEngine.cjs` — `detectCloud()` to look for
  `GROQ_API_KEY` as well as `OPENAI_API_KEY`, and `transcribeCloud()` to take
  the base URL and model id from whichever key was found. Everything else —
  the multipart assembly, the `shred()` of the temp clip, the
  `metaCognition.recordOutcome()` call — is unchanged.
- **Rate limits:** `API_RATE_LIMITS.groq` exists at `{ reqPerMin: 30,
  tokPerMin: 14400 }`. **It cannot express an audio budget.** Groq meters STT in
  **ASH/ASD** (audio-seconds per hour/day), not tokens. A new shape is needed —
  `{ reqPerMin: 20, reqPerDay: 2000, audioSecPerHour: 7200, audioSecPerDay: 28800 }`
  — and `TaskQueue._canRun()` must understand it. **This is the one place
  where honouring I10 actually requires new policy, not just a new row.**
- **Capability:** none. `identity.voice-wake` (tier 0) and the voice IPC already
  exist.
- **Sensitivity:** see §F.1. Groq's posture is good — no retention by default
  for inference, self-serve ZDR ([Groq data](https://console.groq.com/docs/your-data))
  — but it is still master's voice leaving the machine, so the local whisper.cpp
  path must stay **preferred**, which `capabilities()` already does
  (`if (local.available) { level = 2; backend = 'local'; }`).

### D.2 Document understanding and OCR — the largest build, and the one with real consequences

There is **no document path in this codebase at all.** Grepped for
`contract note|contract_note|OCR|pdf` across every `.py/.cjs/.js/.jsx`: the only
hits are `costs.py` and `charge_watch.py` *naming* the contract note as the
authority — *"master's own contract note, which is the only authority that
describes HIS charges"* — and the tests that assert the caveat is printed. **No
PDF parser, no OCR, no image ingestion.** The capability Section 116 relies on
does not exist.

What to build, in order:

1. **`ollama pull glm-ocr`** (2.2 GB, 128K ctx, vision+tools). Local, so the
   contract note never leaves the machine. Prompt it with the layout/markdown
   prompts `deepseek-ocr`'s card documents (`<|grounding|>Convert the document
   to markdown.`) — the technique is the same, and the Ollama cards state these
   models are sensitive to exact prompt punctuation.
2. **A PDF→image step.** A contract note arrives as PDF. No renderer exists in
   the tree. Electron can print a PDF to an offscreen `BrowserWindow`, or
   `pdfjs-dist` can be added as a **pinned** dependency (I12 — no `^`, no `~`).
3. **A new tool in `TOOL_REGISTRY`** (`src/services/ramaCore.js`), matching the
   existing table's shape:
   ```
   'doc.read': { desc: 'Read a document or contract note', input: 'path',
                 output: 'text+fields', cost: 'free', cap: 'documents.read' }
   ```
4. **A new capability in `shared/capabilities.json` — PROTECTED, needs master's
   recorded approval.** Specified, not assumed:
   ```json
   "documents.read": 0
   ```
   **Tier 0 (Master).** Justification: a contract note is master's financial
   record. `vault.read` is 0, `mind.view` is 0, `audit.audit` is 0. Giving a
   Viewer the ability to read master's statements would be the sharpest
   privilege inversion in the matrix. If a lower tier later needs public-filing
   reading, add a **separate** `documents.read-public` at tier 3 rather than
   loosening this one.
5. **Then and only then**, wire it to `costs.py`'s reconciliation so a parsed
   note can correct the modelled rate table — which is what
   `charge_watch.py`'s *"does not rewrite a charge rate from a news article"*
   guarantee is protecting.

**Alternative rejected:** `deepseek-ocr` (6.7 GB) is the better-known model and
sits in the official library, but its tags page reports an **8K context
window** ([tags](https://ollama.com/library/deepseek-ocr/tags)) against
`glm-ocr`'s 128K, at three times the disk. For a multi-page statement, 8K is the
wrong shape.

### D.3 Embeddings — one hardcoded string, one real fix

`electron/ipc/vectorMemory.cjs → embed()` POSTs to
`http://localhost:11434/api/embeddings` with `model: 'nomic-embed-text'`
hardcoded, falling back to a TF-IDF approximation. `nomic-embed-text` is **2K
context and two years old**. `qwen3-embedding:0.6b` is 639 MB and **32K**
([embedding models](https://ollama.com/search?c=embedding)).

- **Change:** `vectorMemory.cjs` should ask `modelRoles.selectForRole('embedding', …)`
  rather than naming a model — the role engine already ranks embedders
  correctly, and `isEmbeddingModel()`'s `/embed/i` fallback recognises
  `qwen3-embedding` even though `EMBED_FAMILIES` does not list it.
- **No cloud option.** No embedding model appears in Ollama's cloud catalogue.
  Gemini's multimodal embedding has a free tier but is marked **"Used to improve
  our products: Yes"** ([pricing](https://ai.google.dev/gemini-api/docs/pricing)).
  Since the vector store holds *everything* Rāma remembers, including holdings:
  **local only.** §F.2.
- **Rate limits / capability:** none. `models.use` (tier 3) already covers
  `model.embed`.

### D.4 Reranking — not recommended; if ever added, fix the classifier first

`isEmbeddingModel()` would match `bge-reranker-v2-m3` on its `\bbge\b` branch
and offer a cross-encoder as an embedder, which returns a score, not a vector.
If reranking is ever added, `modelRoles.cjs` needs a distinct `reranker`
predicate **before** any reranker tag is pulled. Until then this is a known
sharp edge, documented here, touching no code.

### D.5 Long context — the defect, now fixable with verified numbers

Unchanged diagnosis (prior report §E.4): `describeInstalled()` sets
`ctxK: known?.ctxK ?? null` from a four-entry `MODEL_REGISTRY` seed, so every
modern family arrives `null` and `evaluate()` excludes it with *"no context
length known."* What is **new** is that the numbers are now verified from live
tags pages, so the fix can ship with real data:

| Model | Context | Source |
|---|---|---|
| `glm-ocr` (all 3 tags) | **128K** | [tags](https://ollama.com/library/glm-ocr/tags) |
| `qwen3-vl` (every tag, 2b–235b) | **256K** | [tags](https://ollama.com/library/qwen3-vl/tags) |
| `gemma4:12b / :26b / :31b / :cloud / :31b-cloud` | **256K** | [tags](https://ollama.com/library/gemma4/tags) |
| `gemma4:latest / :e2b / :e4b` | **128K** | same |
| `deepseek-ocr` | **8K** | [tags](https://ollama.com/library/deepseek-ocr/tags) |
| `qwen3.5` (all) · `qwen3-coder` | 256K | prior report, verified |
| `granite4:*-h` | 1M | prior report, verified |

Preferred fix remains reading `model_info.*.context_length` from Ollama's
`/api/show` in `refreshOllamaModels()` — that is a **measurement**, so it may
legitimately set `ctxVerified: true`. Parsing the tags page is cheaper but stays
a claim, hence `substitute`. Files:
`electron/ipc/modelRouter.cjs`, `electron/lib/ollamaCatalog.cjs`,
`electron/lib/ollamaLibrary.cjs`.

### D.6 Guardrail classification — additive, never load-bearing

`claimGate` needs no model: `gate()`, `segment()`, `indexEvidence()` and
`checkableTokens()` are deterministic, and `CLASS` is
`{grounded, reflex, prose, unattributed}`. **That must stay true** — a gate whose
verdict depends on a model inherits the model's failure modes, and the whole
point of `claimGate` is to be the thing that does not.

Where a classifier *does* help is **screening a tool call before it runs** —
`TOOL_REGISTRY` marks `system.kill`, `system.clean` and `terminal.run`
`destructive: true`, and `sandboxEngine.cjs` exists for exactly this risk.
Groq's `meta-llama/llama-prompt-guard-2-22m` is $0.03 per M in **and** out, 512
context, 30 RPM / 14.4K RPD / 500K TPD free
([Groq models](https://console.groq.com/docs/models),
[rate limits](https://console.groq.com/docs/rate-limits)) — a prompt-injection
detector sized for exactly this. `gpt-oss-safeguard-20b` is the heavier option.

- **Change:** a screening call in the tool-dispatch path, **advisory only**. If
  the classifier is unreachable, the existing capability check still governs.
- **Rate limits:** needs the `groq` entry to be per-model, since 22m's limits
  (30 RPM / 14.4K RPD) differ from `whisper`'s (20 RPM / 2K RPD) and
  `gpt-oss-120b`'s (30 RPM / 1K RPD). `API_RATE_LIMITS` is currently flat per
  provider. **This is the second genuine I10 shape change.**
- **Capability:** none new. It is a guard on existing caps.

### D.7 TTS — last, and smallest

Groq's speech endpoint is `https://api.groq.com/openai/v1/audio/speech`, same
shape as OpenAI's: `model`, `input`, `voice`, `response_format`
([Groq TTS](https://console.groq.com/docs/text-to-speech)). Orpheus English is
$22 per 1M characters, 4,000-token context, free tier 10 RPM / 100 RPD.
Needs a new `voice:speak` IPC handler and renderer audio playback —
`voiceEngine.js → speak()` currently returns a boolean and schedules the
hands-free cool-down (`this._cooldownUntil = Date.now() + max(250, text.length*60)`),
which a real audio duration would make precise rather than estimated.

**Do not do this third.** SAPI works, costs nothing, and has no latency floor.
Locally, **Piper** (~63 MB/voice, MIT) is the CPU-realistic upgrade and
**Kokoro-82M** (~86–92 MB int8 ONNX, Apache-2.0) the quality one; every
autoregressive engine — XTTS-v2, Bark, Orpheus local, IndexTTS-2 — is reported
as out of the running on CPU regardless of quantisation
([CPU TTS comparison](https://localaimaster.com/blog/best-tts-without-gpu)).
That is a third-party benchmark, not a vendor page (§G.5).

### D.8 Summary of source changes, by file

| File | Change | Why | Invariant |
|---|---|---|---|
| `electron/ipc/voiceEngine.cjs` | Groq base URL + model id in `detectCloud`/`transcribeCloud` | STT at $0.04/hr with a free 8 audio-hr/day tier | — |
| `electron/resourceOrchestrator.cjs` | split `ollama` / `ollama-cloud`; **per-model** Groq entries; **audio-seconds** budget type | Free plan = 1 concurrent; Groq meters audio, not tokens | **I10** |
| `electron/ipc/vectorMemory.cjs` | ask `modelRoles.selectForRole('embedding')` instead of hardcoding `nomic-embed-text` | 2K → 32K context | — |
| `electron/lib/ollamaCatalog.cjs` + `modelRouter.cjs` | read `context_length` from `/api/show` | unblocks `long-context` for every model | — |
| `electron/lib/modelRoles.cjs` | distinct `reranker` predicate; a real `code` cap instead of deriving it from `tools` | two known mis-classifications | — |
| `src/services/ramaCore.js` | `'doc.read'` in `TOOL_REGISTRY` | the contract-note capability | — |
| `shared/capabilities.json` | `"documents.read": 0` | **PROTECTED — master's recorded approval + tripwire re-attestation** | tripwire |
| `electron/ipc/modelRouter.cjs` | `allModels()` at the four role call sites, + `private`/`paramsB`/`ctxK` on registry entries | **only if** master wants a non-Ollama key to fill a role | — |

---

## E. STAGED PLAN — each stage useful on its own

**Stage 0 — unblock the engine. No model involved.**
Python 3.12, `Rama.bat` option 3. `lightgbm`, `xgboost`, `statsmodels`,
`numpy` are already pinned and cannot install on 3.14. Without this, StockMind's
*actual* models cannot run and no LLM substitutes for them. **Also fix
`--diagnose`, which reported 0 blocking on a machine where the engine cannot
start.**

**Stage 1 — Ollama, four pulls, zero code. ~12.9 GB, $0.**
`qwen3.5:9b`, `qwen3.5:4b`, `qwen3-embedding:0.6b`, **`glm-ocr`**. Then
`models:refresh-catalog`. Outcome: 7 of 9 roles filled locally,
**`narration` among them**, plus a local document reader. Nothing leaves the
machine.

**Stage 2 — `ollama signin`, one sized cloud tag. Still zero code.**
`gemma4:31b-cloud` fills `reasoning` as **`declared`** (31 ≥ 14, and the tag
carries its number so `paramsB()` reads it). Know the ceiling: **1 concurrent
request.**

**Stage 3 — Groq key, and voice becomes real. One file.**
The `voiceEngine.cjs` change in §D.1. L3 CLOUD STT lights up at $0.04/audio-hour
with 8 free audio-hours a day. Same key later serves prompt-guard (§D.6) and
Orpheus TTS (§D.7). **Pair it with the `API_RATE_LIMITS` work** — a key whose
spend is admitted unmetered is worse than no key.

**Stage 4 — the long-context fix.**
`/api/show` context parsing. Turns `long-context` from `none` into `declared`
for every model already installed. Pure win, no download, numbers verified in
§D.5.

**Stage 5 — the document capability.**
`doc.read` tool, PDF→image, `"documents.read": 0` approved and the tripwire
manifest re-attested. The largest item, and the one that makes Section 116's
contract-note authority real instead of aspirational.

**Stage 6 — the optional tail.**
openWakeWord for "hey rāma"; Piper or Kokoro to replace SAPI; prompt-guard
screening on destructive tools; a FinBERT-class classifier for `news.py`'s
sentiment stub, **reported as context, never as a signal**, until Section 69's
gate can judge it.

**Deliberately not planned:** reranking (§C.3), any time-series foundation model
(§C.4), any non-Ollama provider filling a declared role (§D.8 last row) —
each is a real cost with unmeasured benefit.

---

## F. SENSITIVITY RULING, per capability

The standard is `ROLES.narration`'s, verbatim from `modelRoles.cjs`: *"the
prompt names master's holdings, and a prompt that has left this machine cannot
be recalled — so a non-private model is refused outright, not ranked lower."*
`describeInstalled()` sets `private: cls.cloud === false`, i.e. **true only when
the weights are measured to be on this disk.** A host's no-training promise does
not open the gate. That reading is correct and should stay.

**Capabilities that deserve a gate they do not currently have:**

| Capability | Ruling | Reason |
|---|---|---|
| **F.1 Speech → text** | **GATE. Prefer local; cloud only with master's explicit per-session consent.** | A voice clip is biometric and may contain anything said near the mic. `voiceEngine.cjs` already shreds the temp file with random bytes before unlinking — that care is for local storage, and it is undone the moment the clip is POSTed. Groq's posture is good; Google's free tier is **marked as training on input** and must be refused outright for voice. The ladder already prefers local; make it a **refusal**, not a preference, for the Gemini free tier. |
| **F.2 Embeddings** | **GATE — local only.** | `vectorMemory` embeds *everything* Rāma stores. A cloud embedder sees master's holdings by construction, one memory at a time. `qwen3-embedding:0.6b` is 639 MB and closes this permanently. |
| **F.3 Document reading / OCR** | **GATE — strictest in this report. Local only, tier 0.** | A contract note is the authority on what master is actually charged (`costs.py`, `charge_watch.py`). It names his broker, his account, his positions and his costs. Identical in kind to `narration` and should be treated identically. `glm-ocr` at 2.2 GB means there is **no excuse** to send one to a cloud. |
| **F.4 Wake word** | **GATE — local only, by construction.** | Always-on. Streaming ambient audio to any API is the wrong trade, as `voiceEngine.cjs`'s own comment says. |
| **F.5 Code, when the diff touches Rāma's own protected core** | **GATE for the seven `PROTECTED_FILES`.** | Sending `loyaltyCore.cjs` or `capability.cjs` to a cloud model exports Rāma's loyalty and authority model. Not currently gated. General application code is fine in cloud; the nucleus is not. |
| **F.6 Vision, when the image is master's portfolio** | **Conditional gate.** | A pasted chart is fine. A pasted holdings screenshot is `narration` in pixels. The gate cannot be decided from the role — it must be decided from the *content*, which means it belongs at the call site, not in `ROLES`. |

**Ungated and correctly so:** reasoning, tool-calling, multilingual,
long-context over public filings, general chat, TTS (output only, nothing of
master's goes out).

**A note on `extraction`.** It has no `sensitive` flag but carries the note
*"open weights are at parity with the frontier here, so this should never be a
cloud call."* That is a gate in all but name. Making it one — or deleting the
note — is a decision worth taking deliberately rather than leaving ambiguous.

---

## G. NOT VERIFIED

### G.0 Two of the prior report's gaps are now closed

1. **Sized cloud tag spelling — RESOLVED.** `gemma4:31b-cloud` is a live tag,
   read from [gemma4's tags page](https://ollama.com/library/gemma4/tags) this
   session alongside `gemma4:cloud`. The prior report could only simulate
   `gpt-oss:120b-cloud`. Use the sized form so `paramsB()` reads the number.
2. **Context windows for the families whose tags pages were not fetched —
   PARTLY RESOLVED.** `gemma4`, `qwen3-vl`, `glm-ocr`, `deepseek-ocr` are now
   verified (§D.5), with sizes.

### G.1 Still open from the prior report

- **Which models the Free "starter" set covers.** The pricing page says the Free
  plan includes starter credits for *a set of starter models* and **does not
  name them**, re-read verbatim this session. So I cannot confirm
  `gemma4:31b-cloud` is reachable on $0. Check the Ollama app's usage page.
  **This is the single biggest hole in §A** — step 7 may require buying credits.
- **Gemini free-tier RPM/TPM/RPD.** Still unpublished by Google.
- **Groq's *free*-tier per-model limits.** The table I read and quote is
  labelled **Developer plan** base limits. Free-tier numbers are on the account
  limits page, behind auth. The ASH/ASD *shape* is certain; the free-tier
  *values* are not.
- **Every tokens-per-second figure.** Nothing was benchmarked. Ollama is not
  installed. Whether the 135U's iGPU engages via Vulkan, and by how much, is
  unknown.

### G.2 Ollama and STT — what I verified, and the one thing I did not

**Verified:** Ollama's cloud docs describe chat and tool calling and have no
audio endpoint ([cloud docs](https://docs.ollama.com/cloud));
`docs.ollama.com/capabilities` resolves to the **streaming** page and contains
no occurrence of "audio"; every `gemma4` tag's input column reads
**"Text, Image"** — not audio — across all 51 tags.

**The wrinkle:** the `gemma4` *family* card on
[the cloud model list](https://ollama.com/search?c=cloud) carries an **`audio`**
capability tag. Family tag says audio; per-tag input says Text+Image; the API
docs expose no audio endpoint. I did **not** test an audio payload against a
running daemon — Ollama is not installed. **Conclusion for planning: treat
Ollama as not serving STT, which is why voice needs a second provider.** Worth
one empirical check after Stage 1: if `gemma4` accepts audio through
`/api/chat`, row 4 of §B gets much cheaper.

Community `whisper` tags exist on ollama.com (`dimavz/whisper-tiny`,
`karanchopda333/whisper`) but Ollama's API has no transcription endpoint, so a
whisper tag there cannot be driven as an ASR model. Multiple 2026 voice-stack
write-ups say the same in different words — Ollama does not ship the STT piece
([3-model chain](https://dev.to/benracicot/adding-voice-to-ollama-on-mac-the-3-model-chain-4hop)).
Third-party, consistent with what the official pages show.

### G.3 whisper.cpp model sizes

The ~148 MB / ~488 MB figures for `ggml-base` / `ggml-small` are from memory and
third-party summaries; I did **not** fetch `whisper.cpp/models/README.md`
successfully. The ~1.6 GB / ~3 GB figures for `large-v3-turbo` / `large-v3` come
from a third-party mirror of the model list, not from ggml-org. **Check
`huggingface.co/ggerganov/whisper.cpp` before sizing a download.** The
*architectural* claim — tiny/base run near-realtime on CPU, large wants a GPU —
is consistent across sources and is the one that matters for a 15 W CPU.

### G.4 Picovoice Porcupine free tier

A third-party post states the free tier was deprecated 30 June 2026, replaced by
a 7-day trial. `picovoice.ai/pricing/` returned no matching content to this
fetcher, so **this is unverified.** It does not change the recommendation
(openWakeWord, for the licence as much as the price), but if master wants
Porcupine, check the pricing page directly.

### G.5 TTS and OCR benchmark claims

Piper ~63 MB/voice, Kokoro-82M ~86–92 MB int8, "autoregressive engines are out
on CPU" — all from third-party comparison blogs, not model cards. Likewise the
OCR accuracy rankings (PaddleOCR-VL, LightOnOCR-2-1B, Chandra-9B, olmOCR-2) come
from aggregator posts and HF blog posts. **The `glm-ocr` recommendation does not
rest on them** — it rests on its Ollama tags page: 2.2 GB, 128K context,
vision+tools, official library, 7.8M downloads. That much is verified.

### G.6 Not attempted

- **`vite build`.** `node_modules` is present and `--diagnose` was not re-run
  this session. No source file was modified, so nothing could have broken.
- **`modelRoles.plan()`** was not re-run; §B's role outcomes are carried from
  the prior report's measured run.
- **FinBERT model sizes and current best-in-class.** The two arXiv papers cited
  are real and their abstracts were read, but I did not verify any specific
  Hugging Face artefact's size or licence. Treat §C.4 item 2 as a direction, not
  a procurement line.
- **No live daemon test of anything.** Ollama is not installed on this machine.

---

## EVIDENCE — file and symbol citations

| Claim | Source |
|---|---|
| 77 capabilities; name → minimum tier; 29 at tier 0 | `shared/capabilities.json`, enumerated this session |
| Tier names MASTER=0 … GUEST=5 | same, `tiers` / `tierLabels` |
| 17 registered tools, each with a `cap`; 3 marked `destructive` | `src/services/ramaCore.js` → `TOOL_REGISTRY` |
| 18 pages/routes, one declaration site (I7) | `src/config/registry.js` → `PAGES` |
| 9 tier-0 reflex skills answering with no model | `src/services/cognition.js` → `SKILLS` |
| "make the text bigger is not a language problem" | same, module header |
| 5 voice levels, 4 mic modes, VAD constants | `src/services/voiceEngine.js` → `VOICE_LEVELS`, `MIC_MODES`, `VAD` |
| TTS is `window.speechSynthesis`, not a model | same → `speak()` |
| Cloud STT is hardcoded to OpenAI `whisper-1` | `electron/ipc/voiceEngine.cjs` → `transcribeCloud()` |
| Local STT preferred over cloud; wake word requires local | same → `capabilities()` |
| Voice clips overwritten with random bytes before unlink | same → `shred()` |
| Nine roles, floors, the single `sensitive: true` | `electron/lib/modelRoles.cjs` → `ROLES` |
| `private` = weights measured on this disk | `electron/lib/ollamaCatalog.cjs` → `describeInstalled()` |
| `ctxK` seeded from a stale 4-entry registry, never measured | same |
| `code` cap derived from the `tools` tag | same |
| Role selection sees only the Ollama list (4 call sites) | `electron/ipc/modelRouter.cjs` lines 256, 277, 422, 437 |
| One admission authority owning rate limits (I10) | `electron/resourceOrchestrator.cjs` → `API_RATE_LIMITS`; `scripts/verifyInvariants.cjs` row I10 |
| `ollama` entry is 9999 req/min — wrong for a 1-concurrent cloud plan | `API_RATE_LIMITS.ollama` |
| Groq entry is token-shaped and cannot express an audio budget | `API_RATE_LIMITS.groq` |
| claimGate classes are deterministic: grounded/reflex/prose/unattributed | `electron/lib/claimGate.cjs` → `CLASS` |
| Embedding model hardcoded to 2K-context `nomic-embed-text` + TF-IDF fallback | `electron/ipc/vectorMemory.cjs` → `embed()` |
| 7 protected files incl. `shared/capabilities.json`; per-file SHA-256 + manifest digest; "no protected file has changed since master approved it" | `electron/lib/loyaltyGuard.cjs` → `PROTECTED_FILES`; `scripts/verifyLoyaltyTripwire.cjs` |
| Self-model: every field carries its source, unmeasurable fields absent | `electron/lib/selfModel.cjs` header; exports `describe`, `fact`, `unmeasured` |
| A cone never a path; cone width measured, centre tilts only for an entitled model | `ai_backend/engine/projection.py` header |
| Risk ruler is arithmetic over stored bars, no model involved | same |
| Refuses to rank by raw return/Sharpe or report a metric without the trial count; stdlib only | `ai_backend/engine/strategy_eval.py` header |
| `SentimentModel` returned `0.5 + np.random.normal(0, 0.04)` — one of eight ensemble members was a random number generator | `ai_backend/engine/news.py` header |
| LSTM/TFT/Sentiment are stubs needing torch / pytorch-forecasting / transformers | `ai_backend/engine/models.py` header |
| Declared sign and lag before measurement; a contradicted link is not flipped | `ai_backend/engine/macro.py` header |
| Archive-primary, not live-chain, because only the archive can feed a backtest | `ai_backend/engine/derivatives.py` header |
| Master's own contract note is the authority on his charges | `ai_backend/engine/costs.py`, `charge_watch.py` |
| **No PDF/OCR/document path exists anywhere in the tree** | grep `contract note\|contract_note\|OCR\|pdf` over all `.py/.cjs/.js/.jsx` — only doc-comment and test hits |
| AST analysis is regex/structural, no model | `electron/ipc/astEngine.cjs` header |
| Intelligence engine is source-vetting and cross-reference, not a model | `electron/ipc/intelligenceEngine.cjs` header |

**Web sources (all fetched live this session):**
[Ollama cloud docs](https://docs.ollama.com/cloud) ·
[Ollama pricing](https://ollama.com/pricing) ·
[Ollama cloud models](https://ollama.com/search?c=cloud) ·
[Ollama embedding models](https://ollama.com/search?c=embedding) ·
[Ollama reranker search](https://ollama.com/search?q=reranker) ·
[Ollama OCR search](https://ollama.com/search?q=ocr) ·
[glm-ocr tags](https://ollama.com/library/glm-ocr/tags) ·
[deepseek-ocr](https://ollama.com/library/deepseek-ocr) ·
[deepseek-ocr tags](https://ollama.com/library/deepseek-ocr/tags) ·
[gemma4 tags](https://ollama.com/library/gemma4/tags) ·
[qwen3-vl tags](https://ollama.com/library/qwen3-vl/tags) ·
[Groq supported models](https://console.groq.com/docs/models) ·
[Groq speech-to-text](https://console.groq.com/docs/speech-to-text) ·
[Groq text-to-speech](https://console.groq.com/docs/text-to-speech) ·
[Groq rate limits](https://console.groq.com/docs/rate-limits) ·
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
[Gemini 3.5 Transcribe](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe) ·
[arXiv 2606.27100 — TSFMs for financial returns](https://arxiv.org/abs/2606.27100) ·
[arXiv 2409.11408 — fine-tuned FinBERT vs GPT](https://arxiv.org/abs/2409.11408) ·
[arXiv 2512.00946 — lightweight LLMs for financial sentiment](https://arxiv.org/html/2512.00946v1) ·
[openWakeWord OVOS plugin](https://github.com/OpenVoiceOS/ovos-ww-plugin-openwakeword) ·
[openWakeWord trainer](https://github.com/lgpearson1771/openwakeword-trainer) ·
[atlas-voice-training](https://github.com/briankelley/atlas-voice-training/) ·
[CPU TTS comparison](https://localaimaster.com/blog/best-tts-without-gpu) ·
[Ollama voice stack: Ollama ships no STT](https://dev.to/benracicot/adding-voice-to-ollama-on-mac-the-3-model-chain-4hop)

---

## THE SHORT VERSION

Rāma's capability surface is **77 capabilities, 17 tools, 18 pages, 9 tier-0
reflexes and 5 voice levels**, and only about **20** of those capabilities have
a model dimension at all. Of the fourteen model classes, **nine are already
answered or answerable with four free local pulls**; **one** (speech-to-text)
genuinely needs a second provider and Groq serves it for $0.04 an audio hour on
an endpoint this codebase already speaks; **one** (document reading) is the
real gap, because Rāma treats master's contract note as the authority on his own
money and cannot read one; **two** (reranking, wake word) have no clean answer
and should wait; and **one** — handing price prediction to a language model —
is refused, because `projection.py`, `strategy_eval.py` and `claimGate` were all
built to refuse it, and the published evidence on time-series foundation models
in financial returns agrees with them.

The cheapest honest answer to "which models do I get": **install Ollama, pull
four models totalling 12.9 GB, sign in for one sized cloud tag, and take one
Groq key.** Everything else on this list is a later stage with a stated reason.
