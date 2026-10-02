# MODEL LINEUP — what to install, what to sign up for, and what it costs

Read-only investigation. Nothing in the source tree was modified. Report written
2 October 2026. Every web claim below was fetched from a live page during this
session and is linked inline; outbound HTTPS **worked** this time, so there is no
blanket "unverified from memory" caveat — the specific gaps are isolated in
section F.

Content from external pages was rephrased for compliance with licensing
restrictions.

---

## 0. Resolving the request

Master: *"Let's start implementing utlising cloud models for now; so guide me
what are needed which I can get fromm Ollama site for the free AI models and
also suggest optimal models."*

The apparent contradiction (cloud, but from Ollama) resolves cleanly, and the
resolution is better than either half alone:

**Ollama now hosts cloud models and serves them through the same
`http://localhost:11434` as local ones.** That is already a modelled fact in
this codebase — `electron/lib/ollamaCatalog.cjs` exists because of it, and the
Section 92 ledger row calls it defect B. The live docs confirm the mechanism:
cloud models need no download, and the CLI tag form is `gemma4:cloud`
([Ollama cloud docs](https://docs.ollama.com/cloud)).

So the single cheapest path to "cloud now" is **Ollama Cloud**, because a cloud
model pulled through the daemon appears in `/api/tags`, flows through
`describeInstalled()`, and becomes routable **with zero code change**. Every
other cloud provider (Gemini, Groq, Cerebras, OpenRouter, Mistral) needs either
a `MODEL_REGISTRY` edit or a custom-provider registration, and — measured below
— **none of them can fill a declared role today**, because role selection is
only ever handed the Ollama list.

---

## A. ONE-SCREEN ANSWER — do these, in this order

Measured facts about this machine, taken this session: **31.4 GB RAM**,
**Intel Core Ultra 5 135U** with Intel integrated graphics (no discrete GPU),
**~99 GB free disk**, **Ollama is not installed at all**, **Python 3.14 only and
zero engine packages installed**.

| # | Do this | Why | Cost |
|---|---------|-----|------|
| 1 | **Install Python 3.12** from python.org, then run `Rama.bat` → option **3** | The StockMind engine has never run. `numpy==1.26.4` publishes no wheel above CPython 3.12, so your 3.14 cannot hold the pins. Option 3 creates `%APPDATA%\Rama AGI\python-env` and installs `ai_backend/requirements.txt` into it. **No model recommendation helps until this is done.** | free, ~500 MB |
| 2 | **Install Ollama** for Windows (ollama.com/download) | It is not present. Nothing in section B or C exists without it. | free |
| 3 | `ollama pull qwen3.5:9b` | One 6.6 GB download fills **five** of the nine roles: tool-calling, code, vision, multilingual and — critically — **narration**, the one role that refuses cloud outright. | free, 6.6 GB |
| 4 | `ollama pull qwen3.5:4b` | The cheapest model that *clears* the 3B extraction floor while still earning the `fast` cap (`paramsB <= 4`). Cheapest-sufficient, exactly as `modelRoles` ranks it. | free, 3.4 GB |
| 5 | `ollama pull qwen3-embedding:0.6b` | `model.embed` is a registered tool (`src/services/ramaCore.js`). 32K context vs `nomic-embed-text`'s 2K — the only embedding pick that can take a filing in one pass. | free, 639 MB |
| 6 | **Sign in to Ollama** (`ollama signin`), then pull one **sized** cloud tag for reasoning | 9B fails the 14B reasoning floor; locally only `qwen3.5:27b` (17 GB) clears it, and on a 15 W U-series CPU that is unusably slow. Reasoning has **no** sensitivity gate, so cloud is valid here. Use a tag that carries its parameter count (see section B note). | free plan = starter credits, 1 concurrent request |
| 7 | **Get a Google AI Studio key** and a **Groq key** | Free general-purpose capacity for `models:chat`'s fallback chain. **Never** route master's holdings through Google's free tier — see section D. | free |
| 8 | In Rāma: run **`models:refresh-catalog`** (master-only) | Until the library is fetched, no discovered model carries a `code` or `vision` cap, so both roles report unfilled no matter what you pulled. | free |

Total local disk: **~10.7 GB** of your 99 GB free. Measured outcome of exactly
that install, run through the project's own `modelRoles.plan()` this session:
**8 of 9 roles filled**, 7 `declared`, 1 `substitute`, 1 `none`.

The one `none` is **long-context**, and it is a code defect, not a missing
download. See section E.

---

## B. THE NINE ROLES — cloud pick × local pick

Role names, floors and the sensitivity gate are taken verbatim from
`electron/lib/modelRoles.cjs` → `ROLES`. Selection discipline:
a failed requirement **excludes with a reason**, never down-ranks; ranking is
fit → private → cost → fast → smallest-that-clears-the-floor.

**Only `narration` carries `sensitive: true`.** It is the sole role where a
cloud recommendation is *invalid by construction*: `evaluate()` pushes
`'not private — this role's prompt names master's holdings and must not leave
the machine'` for any model whose `private !== true`, and
`describeInstalled()` sets `private` to `cls.cloud === false`, i.e. true only
when the weights are measured as being on this disk. Ollama's own no-training
policy does **not** open this gate — the gate is about the prompt leaving the
machine, not about what the host promises to do with it. That is the correct
reading and it should stay that way.

`extraction` has no gate but carries a note that amounts to one: *open weights
are at parity here, so this should never be a cloud call.* Treated as binding
below.

| Role | Floor / requirement | Cloud pick | Local pick (recommended) | Why | Cost | Cloud forbidden? |
|------|--------------------|-----------|--------------------------|-----|------|------------------|
| **extraction** | ≥3B, prefers `fast` | *none — don't* | **`qwen3.5:4b`** (3.4 GB, 256K) | 4B is the smallest tag that clears 3B *and* still gets `fast` (`paramsB <= 4` in `describeInstalled`). `qwen3.5:2b` is **excluded**: 2B < 3B floor. | free | Not gated, but the role's own note says open weights are at parity — a cloud call here is waste |
| **tool-calling** | ≥7B | `gpt-oss:120b` family on Ollama Cloud | **`qwen3.5:9b`** (6.6 GB, 256K) | Published reliability collapse below ~7B is the stated reason for the floor. 9B clears it and the family carries the `tools` tag on the live library listing. Strictly cheaper alternative that also clears: `granite4:7b-a1b-h` (4.2 GB, 1M ctx) — older (11 months) and no vision. | free | No |
| **code** | ≥7B **and** reports `code` | `kimi-k2.7-code` ($0.95/$4.00 per M) or `glm-5.3` | **`qwen3.5:9b`**; upgrade `qwen3-coder:30b` (19 GB, 256K) | The `code` cap is derived from the family's `tools` tag in `describeInstalled`, so any tools-capable family earns it once the catalogue is fetched. `qwen3-coder` is a year old; `qwen3.5` also ships `27b-coding-bf16`. | free local / see §D | No |
| **reasoning** | ≥14B | **a sized Ollama Cloud tag** (`gpt-oss:120b`: $0.15 in / $0.60 out per M) | `qwen3.5:27b` (17 GB) — works, but ~CPU-slow here | 9B is **excluded** (9 < 14). This is the role that justifies cloud: the local answer costs 17 GB and minutes per answer on an iGPU. Not sensitive → cloud is valid. | ~$0.15–0.60/M | No |
| **long-context** | ≥128K | — | — | **UNFILLABLE TODAY, for all models.** `describeInstalled` sets `ctxK: known?.ctxK ?? null` and the seed (`MODEL_REGISTRY`) only knows `llama3.2`/`codellama`/`mistral`/`phi3`. So every modern family arrives with `ctxK: null` and `evaluate` **excludes** it: *no context length known, and this role needs 128K*. The models are fine — `qwen3.5` is 256K and `granite4:*-h` is 1M, both verified on ollama.com. The gap is in code. | — | No |
| **multilingual** | ≥7B, `noLocalMeasure` | `mistral-large-3` or `gemma4` | **`qwen3.5:9b`** | Always returns `substitute`, never `declared`, by design — the module has no local test for it. Qwen is the strongest open multilingual family at this size. | free | No |
| **embedding** | must be an embedding model | Gemini Embedding (free-tier batch quota 10M tokens) | **`qwen3-embedding:0.6b`** (639 MB, **32K** ctx) | `nomic-embed-text` is 274 MB but only **2K** context and two years old; `embeddinggemma:300m` is 622 MB / 2K. 32K is the difference between embedding a document and embedding a paragraph of it. All three are recognised by `isEmbeddingModel()` via its `/embed/i` fallback. | free | No |
| **vision** | reports `vision` | `gemma4` (vision + thinking, $0.14/$0.40 per M) | **`qwen3.5:9b`** (tags page reports *Text, Image*) | Same download as tool-calling. Smaller dedicated option: `qwen3-vl:4b`. Requires `models:refresh-catalog` first — the cap comes from the catalogue, not the tag name. | free | No |
| **narration** (master's money) | ≥7B **and private** | **INVALID — no cloud pick exists** | **`qwen3.5:9b`** | The prompt names real holdings and a prompt that has left the machine cannot be recalled. Any cloud model, Ollama's included, is refused with a stated reason rather than ranked lower. | free | **YES** |

### Measured, not asserted

Running the project's own `modelRoles.plan()` against exactly that install
(local `qwen3.5:4b` + `qwen3.5:9b` + `qwen3-embedding:0.6b`, plus a
`gpt-oss:120b-cloud` tag, catalogue populated) produced:

```
extraction    => ollama/qwen3.5:4b              [declared]
tool-calling  => ollama/qwen3.5:9b              [declared]
code          => ollama/qwen3.5:9b              [declared]
reasoning     => ollama/gpt-oss:120b-cloud      [declared]
long-context  => null                           [none] — 5 models checked, each failed
multilingual  => ollama/qwen3.5:9b              [substitute] (no local measurement)
embedding     => ollama/qwen3-embedding:0.6b    [declared]
vision        => ollama/qwen3.5:9b              [declared]
narration     => ollama/qwen3.5:9b              [declared]
```

**One trap worth naming.** `paramsB()` reads the parameter count out of the
*tag*. A cloud tag spelled `gemma4:cloud` yields `paramsB: null`, so every
parameter floor goes **unchecked** and the role comes back `substitute`, not
`declared`. The sized spelling `gpt-oss:120b-cloud` yields 120 and comes back
`declared`. **Prefer the sized cloud tag.** Verified both ways this session.

---

## C. `ollama pull` by RAM tier

Sizes and context windows below are read from the live tags pages on ollama.com,
not estimated, except where marked. Rule of thumb for fit: you need the file
size **plus roughly 1–2 GB** for the KV cache and runtime, and a long context
costs more KV cache.

**Speed caveat for this machine specifically.** The 135U has Intel integrated
graphics and no discrete GPU. Ollama on Windows enables **Vulkan by default** as
the fallback path for such systems, and notes that without root/extra
capabilities it falls back to approximate VRAM sizing
([Ollama hardware support](https://docs.ollama.com/gpu)). Intel iGPU
acceleration is real but modest and historically fiddly. Expect
CPU-class throughput. The per-tier token rates below are **estimates, not
measured on this machine** — see section F.

### ~8 GB RAM tier (≈4 GB of weights max)

```
ollama pull qwen3.5:2b            # 2.7 GB · 256K ctx · tools+think+vision
ollama pull qwen3.5:4b            # 3.4 GB · 256K ctx · tools+think+vision · earns `fast`
ollama pull granite4:3b-h         # 1.9 GB · 1M ctx   · tools
ollama pull qwen3-embedding:0.6b  # 639 MB · 32K ctx  · embedding
```
Fills: extraction, embedding. **Not** tool-calling, code, reasoning, narration
(all need ≥7B). Estimated ~10–20 tok/s on a modern laptop CPU.

### 16 GB RAM tier (≈8 GB of weights)

```
ollama pull qwen3.5:9b            # 6.6 GB · 256K ctx · tools+think+vision
ollama pull qwen3.5:4b            # 3.4 GB
ollama pull qwen3-embedding:0.6b  # 639 MB
ollama pull granite4:7b-a1b-h     # 4.2 GB · 1M ctx · tools  (optional, cheapest 7B)
```
Total ~11–15 GB disk. Fills 7 of 9 roles (all but reasoning and long-context).
Estimated ~5–9 tok/s CPU-only. **This is the tier to aim at — it covers
narration, which cloud can never cover.**

### 32 GB RAM tier — *this machine*

Everything above, plus a local reasoning model if you want one:

```
ollama pull qwen3.5:27b           # 17 GB · 256K ctx · clears the 14B reasoning floor
ollama pull qwen3-coder:30b       # 19 GB · 256K ctx · dedicated code (1 year old)
ollama pull granite4:32b-a9b-h    # 19 GB · 1M ctx
```
Estimated ~1.5–3 tok/s for the 27B on this CPU — correct but too slow for
interactive work, which is precisely why reasoning should go to cloud here.
`qwen3.5:35b-a3b` (24 GB) is an MoE with ~3B active and will feel much faster
than its size suggests; it is the better 32 GB bet if you want local reasoning.

### "has a usable GPU" (NVIDIA ≥12 GB VRAM)

```
ollama pull qwen3.5:27b           # 17 GB — comfortable on 24 GB VRAM
ollama pull qwen3.5:35b-a3b       # 24 GB — MoE, ~3B active, fast
ollama pull qwen3-coder:30b       # 19 GB
ollama pull qwen3.5:27b-int4      # 16 GB — slightly smaller than the default q4
```
At this point every role except long-context is local and cloud becomes
optional. Ollama's CUDA support needs compute capability 5.0+ and driver 550+
([Ollama hardware support](https://docs.ollama.com/gpu)).

### Tool-calling and long-context flags (from the live library listing)

Parsed from `ollama.com/library` this session using the project's own
`ollamaLibrary.parseLibrary()` — 238 families. Current-generation families
carrying the **`tools`** tag, local weights available:

`qwen3.5` (0.8b–122b, +think +vision, 30 d old) · `qwen3.6` (27b/35b, 1 d) ·
`qwen3.8` (27b, 7 d) · `qwen3-coder` (30b/480b) · `qwen3-vl` (2b–235b) ·
`granite4` / `granite4.1` (350m–34b) · `devstral-small-2` (24b, +vision) ·
`devstral-2` (123b) · `mistral-small3.2` (24b, +vision) · `ministral-3`
(3b/8b/14b) · `magistral` (24b, +think) · `mistral-medium-3.5` (128b) ·
`deepseek-r1` (1.5b–671b, +think) · `deepseek-v3.1` (671b) · `nemotron3` (33b) ·
`nemotron-3.5-lightning` (30b) · `olmo-3` / `olmo-3.1` · `lfm2.5` (8b) ·
`lfm2.5-thinking` (1.2b) · `muse-glimmer` (30b) · `phi4-mini` (3.8b) ·
`gpt-oss-safeguard` (20b/120b) · `functiongemma` (270m — smallest tool-trained
model in the library) · `llama3-groq-tool-use` (8b/70b, 2 y old).

**Long context, verified:** `qwen3.5` = 256K every tag · `qwen3-coder` = 256K ·
`granite4` `-h` variants = **1M** (the non-`h` are 128K, and `granite4:350m` is
only 32K). Note these are the *family's* claims; Ollama truncates to `num_ctx`
regardless, which is exactly why `modelRoles` marks an unverified window as
`substitute` rather than `declared`.

**Embedding models, verified sizes:** `qwen3-embedding:0.6b` 639 MB / 32K ·
`:4b` 2.5 GB / 40K · `:8b` 4.7 GB / 40K · `embeddinggemma:300m` 622 MB / 2K
(239 MB at `qat-q4_0`) · `nomic-embed-text` 274 MB / **2K**, 2 years old ·
also present: `mxbai-embed-large` (335m), `bge-m3` (567m),
`snowflake-arctic-embed2` (568m), `granite-embedding` (30m/278m),
`nomic-embed-text-v2-moe`, `all-minilm`, `paraphrase-multilingual` (278m),
`bge-large` (335m).

**Phi, Gemma, Llama, DeepSeek, Mistral — current state, honestly:**
`phi4` (14b) and `phi4-mini` (3.8b) exist but are a year old and `phi4` has no
`tools` tag. `gemma4` (e2b/e4b/12b/26b/31b, 2 days old, tools+think+vision) is
the current Gemma and carries a **cloud** tag alongside its local builds.
`llama4` (16x17b / 128x17b) is a year old; `llama3.1:8b` is still the
most-pulled tools model in the library at ~120M pulls but is a year old and
superseded. `deepseek-r1` still exists across 1.5b–671b with tools+think, but
the current DeepSeek generation (`deepseek-v4-pro`, `deepseek-v4.1-flash`) is
**cloud-only**. `devstral-small-2` (24b) is the current Devstral.

---

## D. CLOUD SIGN-UPS — exact free limits and training policy

Ordered by how useful they are to this project today.

### 1. Ollama Cloud — **sign up first**

- **What's free:** the Free plan is $0 and includes "starter usage credits" for a
  smaller set of starter models; buying credits unlocks all models. **1
  concurrent request** on Free (Pro 3, Max/Team 10). Running models on your own
  hardware is unlimited. ([Ollama pricing](https://ollama.com/pricing))
- **Paid tiers:** Pro $20/mo ($60 credits), Max $100/mo ($300), Team $500/mo
  ($1,000 shared). Usage is metered per million tokens; off-peak rates apply
  outside 12:00–18:00 UTC on weekdays and all weekend.
- **Per-million token rates (live table):** `gpt-oss:20b` $0.07/$0.30 ·
  `gpt-oss:120b` $0.15/$0.60 · `gemma4` $0.14/$0.40 · `glm-5.3-flash`
  $0.15/$0.50 · `deepseek-v4.1-flash` $0.30/$1.20 (off-peak $0.15/$0.60) ·
  `minimax-m2.7` $0.30/$1.20 · `mistral-large-3` $0.50/$1.50 ·
  `nemotron-3-super` $0.015/$0.60 · `kimi-k2.6` $0.95/$4.00 ·
  `deepseek-v4-pro` $1.32/$3.96 · `glm-5.3` $1.40/$4.40 · `kimi-k3` $3.00/$15.00.
- **Training:** Ollama states prompt and response data is never logged or
  trained on, and that it requires no-logging / no-training / zero-retention
  from the NVIDIA Cloud Providers hosting the models. Hosted primarily in the
  US, with Europe and Singapore for capacity.
- **Tool calling:** yes — Ollama says cloud models trained for tools are tested
  for tool calling before going live.
- **Why first:** it is the **only** cloud that this codebase's role machinery can
  select today without a source change.

### 2. Google AI Studio / Gemini API

- **What's free:** an unpaid quota tier exists. **Google no longer publishes the
  free-tier RPM/TPM/RPD numbers.** The rate-limits page now says to view active
  limits in AI Studio and that specified limits are not guaranteed
  ([Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
  last updated 2026-09-02). Third-party trackers report roughly 5–15 RPM and
  ~1,000 RPD on the Flash line; treat those as unverified.
- **Current lineup (from that page):** Gemini 3.1 Pro Preview, 3.8 / 3.7 / 3.6 /
  3.5 Flash, 3.5 Flash-Lite, 3.1 Flash Lite, 2.5 Pro/Flash, Gemini Embedding.
  **Note: `MODEL_REGISTRY` still names `gemini-1.5-pro` and
  `gemini-1.5-flash`, which are not in the current lineup.**
- **Training: THIS IS THE DISQUALIFIER.** Google's own additional terms state
  that for Unpaid Services — AI Studio and unpaid Gemini API quota — submitted
  content and generated responses are used to provide, improve and develop
  Google products and machine-learning technologies; human reviewers may read
  and annotate the input and output; and the terms say plainly not to submit
  sensitive, confidential or personal information to the Unpaid Services
  ([Gemini API additional terms](https://ai.google.dev/gemini-api/terms)).
  EEA/Switzerland/UK users get the Paid-Services data treatment on all
  services; **India does not.**
- **Verdict for Rāma:** fine for extraction over public news, chart reading, and
  general chat. **Never** for anything naming master's positions — which is the
  `narration` gate stated in policy terms, independently of the mechanical gate.
- **Tool calling:** yes (function calling is a documented core capability).

### 3. Groq

- **What's free:** a free tier with no credit card, ~30 RPM on chat models. The
  published table on the docs page is labelled as the **Developer plan** base
  limits — `openai/gpt-oss-120b`, `gpt-oss-20b`, `gpt-oss-safeguard-20b` and
  `qwen/qwen3.8-27b` all at 30 RPM / 1K RPD / 8K TPM / 200K TPD; Whisper at 20
  RPM / 2K RPD. Groq says the exact limits for your org are on the account
  limits page ([Groq rate limits](https://console.groq.com/docs/rate-limits)).
- **Training:** strong. Groq does not retain customer data for inference
  requests by default; retention happens only for features that need it (batch,
  fine-tuning) or temporarily for reliability/abuse investigation, capped at 30
  days; **Zero Data Retention is self-serve** for all customers
  ([Your data in GroqCloud](https://console.groq.com/docs/your-data)). Data sits
  in US GCP buckets.
- **Tool calling:** yes. OpenAI-compatible endpoints.
- **Verdict:** the best free *throughput* on the list, and the best free privacy
  posture of the direct API providers. Still fails the `narration` gate
  mechanically (weights are not on this disk) — correctly, and that is not a
  reason to loosen the gate.

### 4. Cerebras

- **What's free (Free Trial tier, live table):** `gpt-oss-120b` — 5 RPM, 30K
  uncached TPM, 90K total TPM, 1M TPH, **1M TPD**; `qwen-3.8-27b` — 15 RPM,
  same token ceilings. New accounts get **$5 credit** after adding a verified
  payment method
  ([Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits),
  [billing](https://inference-docs.cerebras.ai/console/account-billing)).
  Dual-bucket model: a cache hit does not count against the uncached limit.
- **Training:** Cerebras' cloud page says data, models and outputs are never
  stored, logged or reused, and its privacy policy says inputs and outputs for
  inference services are not retained. Good, but less precisely documented than
  Groq's, and there is no self-serve ZDR toggle to point at.
- **Tool calling:** yes, OpenAI-compatible.
- **Verdict:** 1M tokens/day free is the most generous daily token allowance
  here. 5 RPM on the 120B is the real constraint — fine for batch analysis,
  poor for an interactive agent loop.

### 5. OpenRouter

- **What's free:** `:free` models at **20 requests/minute** and **50
  requests/day**, rising to **1,000/day** once the account has bought $10 of
  credits lifetime. No token cap, a hard request cap
  ([OpenRouter limits](https://openrouter.ai/docs/api_reference/limits),
  [rate-limit explainer](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379-OpenRouter-Rate-Limits-What-You-Need-to-Know)).
- **Training: the catch.** Paid and free models have separate data-policy
  settings. OpenRouter works with providers so prompts are not trained on
  *where possible*, with exceptions; if you opt out of training in account
  settings, OpenRouter will not route to providers that train — which is why
  opting out commonly makes **every free model return 404 "no endpoints
  matching your data policy"**. Enabling prompt logging grants broad rights.
- **Tool calling:** varies per model; the free router filters for the features a
  request needs, including tool calling.
- **Verdict:** useful as a breadth layer, **not** for anything sensitive, and the
  opt-out/404 interaction will look like an outage if you don't expect it.

### 6. Mistral La Plateforme

- **What's free:** a free "Experiment" tier with rate-limited access to the API
  models. Mistral's own help centre describes Free mode as the default with the
  lowest limits, intended for evaluation and prototyping, and does not publish
  the numbers. Third-party trackers say ~1B tokens/month — unverified.
- **Training: disqualifying by default.** Mistral's help centre states input and
  output data are used **by default** to train its models unless you opt out,
  which you can do at any time
  ([Mistral: do you use my data to train?](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)).
  **If you use Mistral's free tier, opt out before the first request.**
- **Tool calling:** yes.

### 7. GitHub Models — **do not plan on this**

GitHub moved Copilot to usage-based billing effective 1 June 2026, and its own
FAQ answers the question directly: with that shift, free models are no longer
part of the offering
([GitHub community discussion #192948](https://github.com/orgs/community/discussions/192948)).
Everything is metered in GitHub AI Credits (1 credit = $0.01). Remove it from
consideration.

### Sensitivity summary

| Provider | Trains on free-tier data? | Safe for `narration`? |
|---|---|---|
| Local Ollama (weights on disk) | n/a | **Yes — the only Yes** |
| Ollama Cloud | No (states never logged or trained on) | No — prompt leaves the machine |
| Groq | No (not retained by default; ZDR self-serve) | No — same reason |
| Cerebras | States not stored/logged/reused | No — same reason |
| Google Gemini **free tier** | **Yes**, and human reviewers may read it | **No — doubly no** |
| Mistral free tier | **Yes by default**, opt-out available | No |
| OpenRouter free pool | Depends on provider; opting out breaks free routing | No |

---

## E. WHAT THE PROJECT MUST ADD TO USE ANY OF THIS

Files named, not hand-waved. Invariant **I6** means Rāma writing its own source
needs an approval recorded in the ledger (`verifyInvariants.cjs` row I6, enforced
against the propose/approve/apply path); master editing his own source is
explicitly outside that gate by design. Invariant **I10** means there is exactly
one resource-admission authority, `electron/resourceOrchestrator.cjs`, and it
owns `THRESHOLDS` and `API_RATE_LIMITS`.

### E.1 Ollama Cloud — **no code change at all**

Install Ollama, `ollama signin`, pull a cloud tag. It arrives via `/api/tags`,
`ollamaCatalog.classify()` marks it cloud from the `:cloud` name marker (or from
"120B of parameters in 40 MB on disk"), `describeInstalled()` gives it
`private: false`, `costTier: 1`, `caps: [... 'remote']`, and `selectModel()`
can route to it. `API_RATE_LIMITS.ollama` already exists.

**But that entry is wrong for cloud.** It reads
`{ reqPerMin: 9999, tokPerMin: 9999999 }` — correct for a local daemon, badly
wrong for a Free plan that allows **1 concurrent request** and a monthly credit
pool. Spend through Ollama Cloud is therefore admitted essentially unmetered.
Fixing it is a source change to **`electron/resourceOrchestrator.cjs`** and, if
Rāma makes it, an I6-recorded approval. Recommended: split the entry into
`ollama` (local, unmetered) and `ollama-cloud` (metered), since
`describeInstalled` already distinguishes them via `type`/`cloud`.

### E.2 Any OpenAI-compatible provider — **no code change, data only**

Groq, Cerebras, OpenRouter, Mistral and Ollama's own `ollama.com` endpoint all
speak `/v1/chat/completions`. `electron/lib/customProviders.cjs` exists exactly
for this: master registers one through `models:add-custom-provider`
(capability `models.add-key`, tier 1), the key goes in the encrypted vault,
`toRegistryEntries()` merges it into `MODEL_REGISTRY`, and
`modelRouter.customChat()` calls it. No per-vendor function, no source edit.
A base URL on loopback or a private range is refused unless master passes
`allowLocal: true` — deliberate SSRF protection against this app's own
unauthenticated `localhost:4097` API.

**Three real limits to know before relying on it:**

1. `toRegistryEntries()` sets `ctxK: null`, `costTier: null`,
   `caps: ['general']` and **no `private` field** — honest, since master never
   supplied those. Consequence against `modelRoles.evaluate()`: such a model is
   **excluded** from `code` and `vision` (doesn't report the cap) and from
   `long-context` (no window known), can only ever be a **`substitute`** for the
   floored roles, and is **correctly refused** for `narration`.
2. **`API_RATE_LIMITS` has no `custom` entry**, and `TaskQueue._canRun()` only
   checks a limit `if (limit)` — so a custom provider's spend passes admission
   with **no rate-limit check at all**. That is a genuine I10 gap: one authority,
   but no policy for the provider. Adding entries for `cerebras`, `openrouter`
   and `custom` is a source change to `electron/resourceOrchestrator.cjs`.
3. Anthropic's and Gemini's own formats are **not** OpenAI-compatible and need
   their own adapter function in `electron/ipc/modelRouter.cjs` —
   `anthropicChat`/`geminiChat` already exist for them. This is disclosed in
   `customProviders.cjs`'s own header, not a surprise.

### E.3 The role table cannot see any non-Ollama model — **source change**

Every one of the four role call sites in `electron/ipc/modelRouter.cjs` passes
`Object.values(discoveredOllama)`:

- `roleNoteFor(taskType)`
- `selectModel(taskType)`
- the `models:roles` handler
- the `models:role-research` handler

So a Gemini or Groq key makes those models reachable through `models:chat` and
the `FALLBACK_CHAIN`, but **never selectable for a declared role**. If master
wants a Gemini key to fill `reasoning`, that needs `allModels()` there plus
`private`/`paramsB`/`ctxK` on the registry entries. Until then, Ollama Cloud is
the only cloud the role table can use — which is the strongest practical reason
to start there.

### E.4 `ctxK` is null for every discovered model — **the long-context defect**

`describeInstalled()` sets `ctxK: known?.ctxK ?? null` where `known` comes from
the `MODEL_REGISTRY` seed, which holds four stale ids. No modern family matches,
so `ctxK` is always null and `long-context` reports `none` for every install.
Two fixes, both source changes:

- **Cheap and honest:** parse the context window from Ollama's `/api/show`
  (`model_info`'s `*.context_length`) in `refreshOllamaModels()`. That is a
  *measurement*, so it could legitimately set `ctxVerified: true`.
- **Cheaper still:** carry the window in the fetched catalogue —
  `ollamaLibrary.parseLibrary()` already walks the listing, and the per-tag
  pages publish the window (verified this session: `qwen3.5` 256K everywhere,
  `granite4:*-h` 1M). This would stay `ctxVerified: false`, i.e. a
  `substitute` — which is the correct label for a claim.

Files: `electron/ipc/modelRouter.cjs`, `electron/lib/ollamaCatalog.cjs`,
possibly `electron/lib/ollamaLibrary.cjs`.

### E.5 The retirement schedule is now dead — **source change, and nobody would notice**

`ollamaLibrary.RETIREMENT_URL` is `https://docs.ollama.com/cloud`. That page no
longer carries the upcoming/past retirement tables. It now says retirements for
models you have recently used appear in your account's usage settings
([Ollama cloud docs](https://docs.ollama.com/cloud)). Fetched and measured this
session: the page is ~1.4 KB of prose, and `parseRetirements()` run over its
text returns **`[]`**.

The guard in `refresh()` behaves correctly — zero rows means "keep the cached
schedule and report why", not "wipe it". But the cache has never been populated,
so `retirementFor()` always returns null, `advisories()` is always empty, and
`migrationPlan()` always produces nothing. **An empty plan reads as "all clear"
when it means "never checked"** — the handler does return `scheduleLoaded:
false` alongside, which is the saving grace, but no UI obligation enforces that
distinction. Section 93's deprecation half is effectively non-functional and the
suite (74 assertions, all passing) cannot catch it, because it tests the parser
against fixtures, not the live page.

Remedy: find the current machine-readable source for retirements (the usage
settings page is behind auth; `/api/tags` from `ollama.com` may expose it) or
accept the loss and say so in the UI rather than showing an empty, reassuring
list.

### E.6 Two smaller things, no change needed

- `modelRoles.EMBED_FAMILIES` does **not** list `qwen3-embedding`,
  `embeddinggemma` or `granite-embedding`. They are still recognised, because
  `isEmbeddingModel()` falls back to `/embed|minilm|\bbge\b/i` over the id and
  description. Verified: `qwen3-embedding:0.6b` fills the embedding role as
  `declared`. The explicit set is stale; the fallback saves it.
- The `code` cap is derived from the family's **`tools`** tag, not from being a
  coding model (`describeInstalled`: `if (entry?.tools || known?.caps?.includes('code')) caps.add('code')`).
  So `qwen3.5:9b` satisfies the `code` role's `needCaps: ['code']`. Defensible —
  a model that can call tools can edit files — but it is not what the role name
  implies, and `qwen3-coder` would not rank above `qwen3.5` for being a coder.
  Worth a deliberate decision rather than leaving it implicit.

### E.7 Run this before judging any role as unfilled

`models:refresh-catalog` (capability `models.add-key`, master only). Until it
runs, `ollamaCatalogData` is `{}`, so no discovered model gets a `code` or
`vision` cap and both roles report `none` regardless of what is installed. This
is not a code change — it is one action, and it is the single highest-value
thing to do after installing Ollama.

---

## THE BLOCKER: the Python engine has never run

This is first in the one-screen answer for a reason. Measured this session on
master's machine:

- `py -0p` lists **only** `-V:3.14` → `...\Python314\python.exe`.
  `python --version` → **Python 3.14.4**.
- Of the fourteen modules the engine needs, **zero** are importable:
  `numpy`, `pandas`, `scipy`, `sklearn`, `lightgbm`, `xgboost`, `statsmodels`,
  `ta`, `httpx`, `fastapi`, `uvicorn`, `pydantic`, `joblib`, `numpy_financial`
  — all `False`.

So `ai_backend/engine/providers.py`, `projection.py` and `derivatives.py` cannot
even be imported here, and nothing in StockMind's prediction path can execute.

**What he needs, exactly:**

1. **CPython 3.12** (3.11 also fine; 3.10 is the floor). The binding constraint
   is stated in the code, not guessed: `scripts/buildInstaller.cjs` declares
   `PY_MIN_MINOR = 10` / `PY_MAX_MINOR = 12` and comments that
   `numpy==1.26.4` publishes no wheel above CPython 3.12, so pip falls back to
   compiling from source and dies in a C compiler — *which looks like a broken
   machine rather than the wrong interpreter*. `scipy==1.14.1` and
   `pandas==2.2.3` stop at 3.13.
2. **The pinned packages** from `ai_backend/requirements.txt` (pinned per I12,
   no ranges): `fastapi==0.115.12`, `uvicorn[standard]==0.34.3`,
   `pydantic==2.11.7`, `numpy==1.26.4`, `pandas==2.2.3`, `scipy==1.14.1`,
   `scikit-learn==1.5.2`, `lightgbm==4.5.0`, `xgboost==2.1.3`,
   `statsmodels==0.14.4`, `numpy-financial==1.0.0`, `ta==0.11.0`,
   `httpx==0.28.1`, `python-dotenv==1.1.0`, `joblib==1.4.2`.
3. **`Rama.bat` option 3** ("Build installer from source — installs what is
   missing"). Its `ensureEngineVenv()` finds an in-range interpreter via the
   `py` launcher, creates `%APPDATA%\Rama AGI\python-env`, and installs the
   requirements into it. `aiProcess.cjs` resolves the interpreter through the
   same ladder — `RAMA_PYTHON` → `<userData>/python-env` → `<repo>/.venv-stockmind`
   → bare `python` on PATH — so after option 3 the engine starts with **no
   environment variable to set**. Option 2 ("check readiness") measures and
   changes nothing, and will tell him whether option 3 can succeed.
4. **By hand, if he prefers** (the exact commands the build script prints):
   ```powershell
   py -3.12 -m venv .venv-stockmind
   .venv-stockmind\Scripts\python -m pip install -r ai_backend\requirements.txt
   setx RAMA_PYTHON "<full path>\.venv-stockmind\Scripts\python.exe"
   ```

One correction worth recording: **`node start.cjs --diagnose` does not check
Python.** Run this session it reported `0 blocking · 0 warning · 0 degraded`
with 101,500 MB free and every Node dependency present — and said nothing about
the interpreter that blocks StockMind entirely. Readiness (option 2) is the one
that probes Python. A diagnosis that reports all-clear on a machine where the
engine cannot start is the kind of quiet wrongness this project spends a lot of
effort avoiding elsewhere; it belongs in Stage 1.

---

## EVIDENCE — file and symbol citations

| Claim | Source |
|---|---|
| Nine roles, their floors, the single sensitivity gate | `electron/lib/modelRoles.cjs` → `ROLES` (frozen) |
| Requirement excludes, never down-ranks; three-valued `fit` | `modelRoles.evaluate()` → returns `declared` / `substitute` / `none` |
| Cheapest-sufficient ranking: fit → private → cost → fast → smallest-over-floor | `modelRoles.selectForRole()` comparator |
| Sensitive role refuses non-private outright | `evaluate()`: `if ((role.sensitive \|\| requirePrivate) && model.private !== true)` |
| `private` means weights measured on this disk | `ollamaCatalog.describeInstalled()`: `private: cls.cloud === false` |
| Cloud tags cost `costTier: 1`, not 0 — a free allowance is a budget | same function |
| `paramsB` read from the tag; `16x17b` → 272B total | `ollamaCatalog.paramsB()` |
| `ctxK` seeded from `MODEL_REGISTRY`, never measured | `describeInstalled()`: `ctxK: known?.ctxK ?? null`, `ctxVerified: false` |
| `code` cap derived from the `tools` tag | `describeInstalled()`: `if (entry?.tools \|\| known?.caps?.includes('code'))` |
| Role selection sees only the Ollama list | `electron/ipc/modelRouter.cjs` — `roleNoteFor`, `selectModel`, `models:roles`, `models:role-research` all pass `Object.values(discoveredOllama)` |
| Stale registry: `gemini-1.5-pro`, `gpt-4o`, `ollama/llama3.2`… | `modelRouter.cjs` → `MODEL_REGISTRY`, `FALLBACK_CHAIN` |
| One admission authority owning thresholds and rate limits | `electron/resourceOrchestrator.cjs` → `THRESHOLDS`, `API_RATE_LIMITS`; `verifyInvariants.cjs` row I10 |
| Rate-limit check skipped when a provider has no entry | `TaskQueue._canRun()`: `const limit = API_RATE_LIMITS[task.aiProvider]; if (limit) {…}` |
| 80% of a known limit is the usable ceiling | `THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER = 0.8` |
| `ollama` entry is 9999 req/min — wrong for cloud | `API_RATE_LIMITS.ollama` |
| A provider can be added as data, master-gated, SSRF-guarded | `electron/lib/customProviders.cjs` → `add()`, `validateBaseUrl()`, `toRegistryEntries()` |
| Unattributed output is withheld, so a model that cannot cite is unfit for grounded work | `electron/lib/claimGate.cjs` → `CLASS.UNATTRIBUTED`, `classifyOne()`, reasons `no-citation` / `fabricated-citation` / `unsupported-figure` / `unsourceable-prediction` |
| A document cannot ground a prediction — only a reflex record can | `claimGate.classifyOne()`: `if (tok.modal && evidence.kind !== CLASS.REFLEX)` |
| `model.embed` is a registered tool | `src/services/ramaCore.js` → tool table, cap `models.use` |
| Python window is 3.10–3.12 because of `numpy==1.26.4` | `scripts/buildInstaller.cjs` → `PY_MIN_MINOR`/`PY_MAX_MINOR`, `probePythonRuntime()`; `electron/ipc/aiProcess.cjs` interpreter ladder |
| Pinned engine dependencies | `ai_backend/requirements.txt` |
| Retirement source URL | `electron/lib/ollamaLibrary.cjs` → `RETIREMENT_URL` |
| Suites pass: 87 / 89 / 74 assertions | ran this session: `verifyModelRoles.cjs`, `verifyOllamaCatalog.cjs`, `verifyOllamaLibrary.cjs` |
| 238 Ollama families, tags, sizes, ages | `ollama.com/library` fetched and parsed with the project's own `parseLibrary()` |
| Machine: 31.4 GB RAM, Core Ultra 5 135U, Intel iGPU, 99 GB free, no Ollama | `Win32_ComputerSystem` / `Win32_VideoController` / `Get-Command ollama` |
| Python 3.14 only, zero engine packages | `py -0p`, `importlib.util.find_spec` over all 14 modules |

Web sources: [ollama.com/library](https://ollama.com/library) ·
[Ollama pricing](https://ollama.com/pricing) ·
[Ollama cloud docs](https://docs.ollama.com/cloud) ·
[Ollama hardware support](https://docs.ollama.com/gpu) ·
[Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling) ·
tags pages for [qwen3.5](https://ollama.com/library/qwen3.5/tags),
[qwen3-coder](https://ollama.com/library/qwen3-coder/tags),
[granite4](https://ollama.com/library/granite4/tags),
[qwen3-embedding](https://ollama.com/library/qwen3-embedding/tags),
[embeddinggemma](https://ollama.com/library/embeddinggemma/tags),
[nomic-embed-text](https://ollama.com/library/nomic-embed-text/tags) ·
[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) ·
[Gemini API additional terms](https://ai.google.dev/gemini-api/terms) ·
[Groq rate limits](https://console.groq.com/docs/rate-limits) ·
[Groq data handling](https://console.groq.com/docs/your-data) ·
[Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits) ·
[Cerebras billing](https://inference-docs.cerebras.ai/console/account-billing) ·
[OpenRouter limits](https://openrouter.ai/docs/api_reference/limits) ·
[Mistral training policy](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models) ·
[GitHub Copilot billing FAQ](https://github.com/orgs/community/discussions/192948)

---

## F. NOT VERIFIED

Stated plainly, because an admitted gap beats a plausible claim.

1. **Which models are on Ollama's Free "starter" set.** The pricing page says the
   Free plan includes starter credits for "a set of starter models" and does not
   name them. Check the Ollama app or account usage page. The per-token rates in
   section D are verified; which of them the free credits apply to is not.
2. **The exact cloud tag spelling.** The docs show `gemma4:cloud` for the CLI and
   `gemma4:31b` for API calls to ollama.com. I did **not** verify that
   `gpt-oss:120b-cloud` is a live tag — it is used in section B's simulation to
   demonstrate the sized-tag behaviour. Run `ollama list` after signing in and
   use whatever the daemon actually reports. The behavioural point stands either
   way: a tag without a number in it yields `paramsB: null` and degrades the role
   to `substitute`.
3. **Gemini free-tier RPM / TPM / RPD.** Google has removed these from the public
   rate-limits page and directs you to AI Studio per project, adding that
   specified limits are not guaranteed. Third-party figures (5–15 RPM,
   ~1,000 RPD) are **not** from a Google page and should not be designed against.
4. **Groq's *free*-tier per-model limits.** The published table is explicitly the
   **Developer plan** baseline. The ~30 RPM / no-credit-card figure comes from
   third-party coverage, not a Groq page. The real numbers are on the account
   limits page.
5. **Mistral's free-tier token allowance.** The ~1B tokens/month figure is from
   third-party trackers. Mistral's own help centre describes Free mode as
   lowest-limit and does not publish numbers. The **training-by-default** policy
   *is* from Mistral's own page and is verified.
6. **Cerebras data handling precision.** "Never stored, logged, or reused" is
   from a marketing page; the privacy policy is consistent but less specific, and
   there is no documented self-serve ZDR toggle as Groq has.
7. **Every tokens-per-second number in section C.** Estimates, not measured.
   Nothing was benchmarked on this machine — Ollama is not installed. In
   particular, whether Ollama's default-on Vulkan path actually engages the
   Core Ultra 5 135U's integrated graphics, and by how much, is **unknown**.
   Measure it with `ollama run --verbose` before relying on a local 27B.
8. **Disk sizes for families whose tags pages I did not fetch** — `qwen3.6`,
   `qwen3.8`, `gemma4`, `qwen3-vl`, `devstral-small-2`, `functiongemma`,
   `lfm2.5`, `granite4.1`/`4.2`, `mistral-small3.2`, `magistral`. Parameter
   counts and capability tags for these come from the live library listing and
   are reliable; byte sizes are not quoted for them. The project's own heuristic
   (`ollamaCatalog.q4Bytes`, ~0.6 GB per billion at 4-bit) is the right estimator
   if you need one.
9. **Whether `models:refresh-catalog` currently succeeds against the live
   library page.** `parseLibrary()` parsed the fetched HTML correctly in this
   session (238 families) — but through this tool's fetcher, not through
   `lib/http.cjs`. The retirement half definitively yields zero rows (§E.5).
10. **`vite build`.** Not attempted. `node_modules` *is* present in this
    workspace (contrary to the standing note) and `--diagnose` reports the build
    as 43 minutes old and up to date, but no build was run for this report and
    nothing here required one. No source file was modified, so nothing could
    have broken.

---

*This file is untracked and was not committed. It is a report; nothing was
implemented. The ledger has not been updated — if master wants any of section E
acted on, those are new tasks and should be written into Section 28 before
implementation, per the working agreement.*
