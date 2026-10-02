# CONVERSATION, AND THE 16 GB MACHINE

**Read-only investigation. No source file was modified.** Date of research: 2 October 2026.

**Outbound HTTPS WORKED this session.** `Invoke-WebRequest https://ollama.com/pricing` returned
HTTP 200 / 50,904 bytes. The TLS failure that crippled `OLLAMA_ONLY.md` did not recur, so every
cloud fact below is **freshly verified against ollama.com**, cited inline. The unverified items
in §G are unverified for other reasons, and they are named individually.

**`node_modules` IS present in this workspace** (`Test-Path node_modules` → True), so the
project's own harnesses ran. `scripts/verifyModelRoles.cjs` → **87 passed, 0 failed**. Ollama
itself is still **not installed** (`Get-Command ollama` → not found), so nothing was timed.

---

## A. ONE-SCREEN ANSWER

### A.0 Run this first — everything in §C branches on its output

One paste. Reports total RAM, CPU, populated slots vs total slots, memory speed per module,
and free disk. The CIM queries are the ones `OLLAMA_ONLY.md` §E used on this machine.

```powershell
$cs=Get-CimInstance Win32_ComputerSystem; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; $arr=Get-CimInstance Win32_PhysicalMemoryArray; $dimm=Get-CimInstance Win32_PhysicalMemory; $gpu=Get-CimInstance Win32_VideoController
"RAM total    : {0:N1} GB" -f ($cs.TotalPhysicalMemory/1GB)
"RAM free now : {0:N1} GB" -f ($os.FreePhysicalMemory*1KB/1GB)
"CPU          : {0} ({1}c/{2}t)" -f $cpu.Name.Trim(),$cpu.NumberOfCores,$cpu.NumberOfLogicalProcessors
"Slots        : {0} populated of {1}; board max {2:N0} GB" -f $dimm.Count,$arr.MemoryDevices,($arr.MaxCapacityEx/1MB)
$dimm | ForEach-Object { "  module     : {0:N0} GB @ {1} MT/s  bank={2}  slot={3}" -f ($_.Capacity/1GB),$_.Speed,$_.BankLabel,$_.DeviceLocator }
$gpu  | ForEach-Object { "GPU          : {0}  vram={1:N1} GB" -f $_.Name,($_.AdapterRAM/1GB) }
Get-PSDrive C | ForEach-Object { "Disk C free  : {0:N1} GB" -f ($_.Free/1GB) }
```

Verified: it runs clean on this machine and printed
`31.4 GB / Core Ultra 5 135U (12c/14t) / 1 populated of 2 / 32 GB @ 5600 MT/s / 98.5 GB free`.

**The number that decides the local lineup is `Slots populated`, not `RAM total`.** See §C.1.

### A.1 The conversation gap — confirmed, and it is the whole of it

**MEASURED by running the module:** `modelRoles.ROLE_IDS` =
`["extraction","tool-calling","code","reasoning","long-context","multilingual","embedding","vision","narration"]`.
`ROLE_IDS.includes('conversation')` → **false**. There is no conversation role.
`git grep -i conversation` across `*.cjs`/`*.js`/`*.jsx` finds a `dataStore` **domain**, a UI
label, and a page-capability string in `src/config/registry.js` — **no model role anywhere**.

The consequence, traced end to end: `Chat.jsx` L219 calls `ramaChat.send({ messages, provider,
model, sessionId })` with **no `taskType`**; `ramaClient.js` L23 defaults it to `'general'`;
`modelRouter.cjs` L298 calls `selectModel('general')`; `'general'` is not in `ROLE_IDS`, so
L436's role branch is skipped entirely and routing falls to `TASK_ROUTING.general` → the fixed
`FALLBACK_CHAIN` beginning at `gpt-4o`. Master's conversation gets **no parameter floor, no
sensitivity gate, no cheapest-sufficient ranking, and no `declared`/`substitute`/`none` honesty.**

Three further measured facts that sharpen it:

- **`chat.send` is tier 5, and it is the ONLY tier-5 capability of 77.** Counted from
  `shared/capabilities.json`: tier 0 → 29, tier 1 → 14, tier 2 → 18, tier 3 → 13, tier 4 → 2,
  **tier 5 → 1 (`chat.send`)**. Talking to Rāma is the least-gated thing in the system.
- **The claim gate is inert on the chat path.** `models:chat` takes `requireAttribution = false`
  by default (L296) and `Chat.jsx` never passes it, nor `sources`. So `claimGate.gate()` runs,
  builds its report, and the ungated `result.content` is returned anyway. With `sources: []`
  nothing can be `grounded` — the best any sentence reaches is `prose`.
- **The cognition ladder never runs for conversation.** `Chat.jsx` imports only `resolveReflex`,
  not `think`. `cognition.think()`'s TIER_LOCAL-before-TIER_CLOUD preference — the thing that
  would make conversation private-first — is **not wired to the chat page at all**.

### A.2 The recommendation, in one table

| | pick | why, in one line |
|---|---|---|
| **Cloud conversation** | **`gemma4:31b-cloud`** | Ollama's own **"Low Usage"** label, **256K** ctx, **sized → `paramsB` 31** so floors are checked, family updated **2 days ago**, $0.14/$0.40 per M |
| **Local conversation + narration** | **`lfm2.5:8b-a1b-q4_K_M`** (5.2 GB) | 8B total / **1B active** MoE, ollama.com's own words: *an edge model built for fast, reliable tool calling on consumer hardware*; **`paramsB` 8 clears the 7B narration floor** |
| **Smaller local alternative** | `granite4:7b-a1b-h` (4.2 GB, 1M ctx) | `paramsB` **7**, clears the floor exactly; older (330 d) and no thinking |
| **Do NOT use for conversation** | `qwen3.5:9b` | dense 6.6 GB; derived **~4 tok/s** single-channel — unusable for chat |
| **Do NOT use (unsized)** | `gemma4:cloud`, `lfm2.5:latest`, `granite4:tiny-h` | `paramsB` → **null**, so every floor goes unchecked and the role can only ever be `substitute` |

### A.3 THE CORRECTION THAT CHANGES THE TASK

> The brief states: *"`narration` has `minParamsB: 7`, so `qwen3.5:4b` CANNOT fill it. The
> smallest model that can is `qwen3.5:9b` at 6.6 GB, which on 16 GB competes with the app itself."*

**That premise is wrong, and narration is comfortably servable on 16 GB.** Measured by running
`modelRoles.evaluate('narration', …)` against models built by the project's own
`ollamaCatalog.describeInstalled()`:

```
ollama/lfm2.5:8b-a1b-q4_K_M      declared  []        # 5.2 GB
ollama/granite4:7b-a1b-h         declared  []        # 4.2 GB
ollama/qwen3.5:4b                none      ["4B is below the 7B floor published for this role"]
ollama/gemma4:31b-cloud          none      ["not private — this role's prompt names master's
                                             holdings and must not leave the machine"]
```

The smallest model that fills narration is **4.2 GB, not 6.6 GB** — and because both candidates
are **MoE with roughly 1B active parameters**, they are also several times faster per token than
the dense 9B on a bandwidth-starved machine. **The 16 GB narration question raised in the brief
does not need to be put to master.** The genuinely open narration question is a different and
smaller one (§F.1).

### A.4 THE 16 GB ACTION LIST

1. **Run §A.0.** Nothing below is final until the slot count is known.
2. `ollama pull lfm2.5:8b-a1b-q4_K_M` — 5.2 GB. **Use the sized tag, not `latest`:** measured,
   `paramsB('lfm2.5:latest')` = `null` → `substitute` only; `paramsB('lfm2.5:8b-a1b-q4_K_M')` = `8`
   → `declared`.
3. `ollama pull qwen3-embedding:0.6b` — 639 MB. Local is not a preference here: **Ollama Cloud
   has no embedding model at all**, and embeddings index master's holdings.
4. `ollama signin`, then use **`gemma4:31b-cloud`** for conversation, reasoning and multilingual.
5. *Optional, 3.4 GB:* `ollama pull qwen3.5:4b` — gives `extraction` the `fast` cap
   (`describeInstalled` awards `fast` only at `paramsB <= 4`) and gives `vision` a **local**
   answer. See §F.3 — pasting a portfolio screenshot at a cloud vision model is the narration
   risk wearing a different hat.
6. Run **`models:refresh-catalog`** (master-only, `models.add-key`). Until the library is fetched
   no discovered model carries `code` or `vision`, so both roles report unfilled whatever you pulled.

**Local disk: 5.8 GB minimum, 9.2 GB with step 5.** Measured role outcome of exactly steps 2–4
plus the two cloud tags, through the project's own `modelRoles.plan()`:

```
extraction    => ollama/qwen3.5:4b                [declared]
tool-calling  => ollama/lfm2.5:8b-a1b-q4_K_M      [declared]
code          => ollama/lfm2.5:8b-a1b-q4_K_M      [declared]
reasoning     => ollama/gemma4:31b-cloud          [declared]
long-context  => null                             [none]      <- the known code defect, not a missing pull
multilingual  => ollama/lfm2.5:8b-a1b-q4_K_M      [substitute]
embedding     => ollama/qwen3-embedding:0.6b       [declared]
vision        => ollama/qwen3.5:4b                [declared]
narration     => ollama/lfm2.5:8b-a1b-q4_K_M      [declared]
filled=7 substituted=1 unfilled=["long-context"]
```

**7 declared, 1 substitute, 1 none — identical to what `MODEL_LINEUP.md` §A achieved on the
31.4 GB machine, at half the disk.** 16 GB costs almost nothing in role coverage. What it costs
is named plainly in §D.

---

## B. THE CONVERSATION ROLE

### B.1 Does the per-turn resolution hold? YES — and the hook already exists

The brief's proposed resolution is that sensitivity travels with the **data** and is enforced on
the **payload** at the cloud boundary, per spec **Section 130.8**, rather than on the role name.

**It holds, and more cheaply than the brief assumes, because `modelRoles` already accepts a
per-call privacy requirement.** `evaluate()` takes `{ requirePrivate = false }` and ORs it with
the role's own flag:

```js
if ((role.sensitive || requirePrivate) && model.private !== true) {
  reasons.push('not private — this role\'s prompt names master\'s holdings and must not leave the machine');
}
```

**MEASURED.** Same model set, same non-sensitive role, with and without the flag:

```
selectForRole('tool-calling', set)                          -> ollama/granite4:7b-a1b-h [declared]
  candidate order: granite4:7b-a1b-h, gemma4:31b-cloud, gpt-oss:120b-cloud, gemma4:cloud, nemotron-3-super:cloud

selectForRole('tool-calling', set, { requirePrivate: true }) -> ollama/granite4:7b-a1b-h [declared]
  excluded: gemma4:31b-cloud, gemma4:cloud, gpt-oss:120b-cloud, nemotron-3-super:cloud
            — each: "not private — this role's prompt names master's holdings and must not leave the machine"
```

A per-turn gate therefore needs **no new gating primitive**. It needs a classifier, one payload
chokepoint, and the call-site plumbing to pass `requirePrivate`. That is the cheapest version of
this mechanism available, and it reuses an existing authority rather than creating a second one.

### B.2 But the resolution has a flaw the brief did not anticipate, and it is the one that bites

**`selectForRole`'s comparator ranks `private` BEFORE `cost`.** Read the comparator: fit → private
→ cost → fast → smallest-that-clears-the-floor. So a conversation role with **any** fit local
model will pick local on **every** turn, sensitive or not.

Measured consequence: with both halves present, the winner is `granite4:7b-a1b-h` and
`gemma4:31b-cloud` is **second**. Remove the local models and only then does cloud win:

```
selectForRole('tool-calling', cloudOnly) -> ollama/gemma4:31b-cloud [declared]
```

So on a 16 GB machine a plainly-declared conversation role would route **every ordinary turn** to
the 1B-active local model and never touch the 31B cloud model master is signing up for. **The
absence of `sensitive: true` is not enough to produce cloud-first behaviour.** Cloud-first for
conversation requires an explicit inversion of the private-before-cost tiebreak, and that is a
deliberate choice to send ordinary turns off the machine for quality — raised in §F.4.

### B.3 And a second one: the payload already names master before he types

`Chat.jsx` L211-215 prepends a system prompt to **every** turn, fetched from the sealed nucleus
via `nucleus:get-prompt`. For an authenticated master that prompt is `PERSONA.revealed`, whose
text includes verbatim:

> `Your master is Krishna Prasad. You are absolutely loyal to him.` … `Master: Krishna Prasad | Status: AUTHENTICATED`

**So every conversation payload carries an identity fact about master before he has typed a word.**
A classifier that inspects only the user's message would mark *"how does a Python decorator work"*
as non-sensitive and ship master's name to a US-hosted endpoint.

**This is the concrete, non-hypothetical proof of Section 130.8's warning** — *"a join can assemble
a context payload that no single row looks sensitive enough to block"* — and it means the gate
**must sit on the assembled payload**, never on the user's turn text. It also means the system
prompt itself needs a classification, which is a decision, not an oversight (§F.5).

### B.4 The mechanism, concretely enough to implement

**One chokepoint.** A single function assembles the outbound payload — system prompt + retained
turns + retrieved context + the new user turn — and returns `{ messages, classification, why }`.
No call site composes a payload itself. This is the I8/I9/I10 discipline applied to a fourth
concern: **one classification authority**.

**Three-valued classification, inherited by maximum.**

| value | meaning | effect |
|---|---|---|
| `sensitive` | some component names master's holdings, positions, documents or identity | `requirePrivate: true` |
| `not-sensitive` | **every** component is independently clear | cloud permitted |
| `unknown` | any component could not be classified | **treated as `sensitive`** |

The payload's class is the **maximum** over its components, so one sensitive retrieved row makes
the whole turn sensitive. This is what makes the join safe: rows are classified individually
(Section 127's guarantee, now a schema requirement per 130.8) and the assembly takes the max.

**The failure-safe default is local, and if local is impossible it is REFUSAL — never cloud.**
Two ordered consequences:

1. `unknown` ⇒ `sensitive`. Unclassifiable text is treated as master's, not as public.
2. When `requirePrivate` is set and no fit private model exists, `selectForRole` already returns
   `{ model: null, fit: 'none', why: … }`. **Measured** on a cloud-only install with the sensitive
   role shape: `winner: null [none] — "nothing available is fit … 4 models checked and each failed
   a requirement"`, with all four excluded for not being private. The routing change must
   **honour that `none`** and say so to master. It must NOT do what `selectModel` does today at
   L438-439 — log a warning and fall through to `FALLBACK_CHAIN`. A fall-through there is the
   exact failure this whole mechanism exists to prevent: a sensitive turn quietly reaching cloud.

**What classifies a turn.** Deliberately in this order, cheapest and most certain first:

1. **Provenance, not text.** Any component drawn from the holdings/positions domain, or any
   retrieved record whose stored classification is sensitive, makes the payload sensitive. This
   is a lookup, not a judgement, and it covers the §B.3 system-prompt case and the join case.
2. **Deterministic patterns, no model.** `claimGate.cjs` already does exactly this shape of work
   with no model at all — `classifyOne()` detects tickers, currency and numerals to decide whether
   a sentence is checkable. The same detectors answer "does this turn name an instrument or a
   figure". Reusing them keeps one authority and costs nothing.
3. **A local model, only for the residue, and only to escalate.** If steps 1–2 are inconclusive,
   a local call may move `unknown` → `sensitive`. It may **never** move anything to
   `not-sensitive`: a model's reassurance is not evidence, and the asymmetry matches
   `ollamaCatalog`'s own stated rule that unknown is never collapsed into the safe-looking value.

**What master sees when a turn is held back.** The vocabulary exists on both sides already.
`roleNoteFor()` returns `{ role, roleFit, roleWhy, roleExcluded }`, and `Chat.jsx` already stores
and renders per-message provenance for reflexes (`addMessage({ …, tier: reflex.tierName, skill:
reflex.skill })`). A held-back turn should carry the same, stated rather than implied:

> *Answered locally by `lfm2.5:8b-a1b` — this turn names your holdings, so it did not leave the
> machine. `gemma4:31b-cloud` was excluded: not private.*

And when nothing private is fit, the refusal names the remedy rather than silently degrading:

> *I did not answer this. It names your holdings, and no model on this machine is fit for it.
> `ollama pull lfm2.5:8b-a1b-q4_K_M` would fix it.*

### B.5 The proposed `ROLES.conversation` entry

Specified for master, in the file's own idiom. **`electron/lib/modelRoles.cjs` is NOT a protected
file** — verified against `loyaltyGuard.PROTECTED_FILES` — so this is an ordinary edit.

```js
  conversation: {
    label: 'Conversation',
    why: 'talking with master — the thing he does most often',
    minParamsB: 7,
    sensitive: false,
    note: 'NOT sensitive as a ROLE, because conversation is not one thing: "how does a Python '
      + 'decorator work" is not sensitive and "how much am I down on HDFC" is. The gate is PER '
      + 'TURN — the caller passes `requirePrivate` for a turn whose assembled payload is '
      + 'classified sensitive, and an UNKNOWN classification passes it too. A blanket '
      + 'sensitive:true here would forbid cloud outright and quietly degrade the one capability '
      + 'master uses most (Section 130.8).',
  },
```

Each field, with its reason:

- **`minParamsB: 7`** — the same floor the project already publishes for the two roles that depend
  on instruction-following, `tool-calling` and `narration`. It is also the floor that keeps the
  **local** half fillable on 16 GB: the fit candidates land at 7B and 8B. A 14B floor (as
  `reasoning` uses) would make local conversation **unfillable** on this machine, which is the
  degradation to avoid. Measured: at 7 the floor admits `granite4:7b-a1b-h` and
  `lfm2.5:8b-a1b-q4_K_M` and correctly excludes `qwen3.5:4b`.
- **`minCtxK`: OMIT FOR NOW. This is an ordering constraint, not a preference.** `evaluate()`
  pushes a **hard exclusion** when the window is unknown — *"no context length known, and this
  role needs 128K"* — into `reasons`, not `unverified`. And `describeInstalled()` sets
  `ctxK: known?.ctxK ?? null` from a four-entry seed that knows only
  `llama3.2`/`codellama`/`mistral`/`phi3`. **So any `minCtxK` at all makes `conversation`
  unfillable on day one, exactly as it already does to `long-context`.** Ship without it; add
  **`minCtxK: 32`** (justified in §B.9) only after `OLLAMA_ONLY.md` §F.1's `/api/show` measurement
  fix lands.
- **`needCaps: []`** — omit. Tempting to require `'code'`, but `describeInstalled` derives the
  `code` cap from the family's **`tools`** flag, so `needCaps: ['code']` would really act as a
  "tools-capable" filter under a misleading name. Leave it empty rather than encode a lie.
- **`preferFast`: omit.** `fast` is awarded only at `paramsB <= 4`, which no model clearing a 7B
  floor can ever hold. Setting it would be dead weight in the comparator.
- **`sensitive: false`**, with the note carrying the whole argument so the next session cannot read
  it as an oversight.

**Plus one change outside the entry, which §B.2 showed is required for cloud-first to actually
happen:** an opt on `selectForRole`, e.g. `{ preferCapable: true }`, that inverts the
private-before-cost tiebreak for a turn already classified `not-sensitive`. **Prefer the opt to a
new role flag**, for two reasons: the per-turn decision then lives at the call site alongside the
classification that produced it, and the nine existing roles keep byte-identical behaviour.

### B.6 Conversation's requirements, checked one by one

Conversation has requirements the batch roles do not. Each is stated and answered.

| requirement | cloud `gemma4:31b-cloud` | local `lfm2.5:8b-a1b-q4_K_M` | verified? |
|---|---|---|---|
| **Latency** — *a 2 tok/s model is unusable for chat however good its output* | Ollama-hosted; Free = **1 concurrent request**, excess queued, rejected if the queue fills | ~1B active params → **derived ~20–45 tok/s**; see §C.2 | cloud: concurrency verified on the [pricing FAQ](https://ollama.com/pricing). tok/s **derived, not timed** |
| **Multi-turn coherence** | tools + thinking + vision; 26.2M pulls; family updated **2 days ago** | tools + thinking; ollama.com: *"fast, reliable tool calling"* | badges and dates verified live; **coherence itself is a published-reputation judgement, not measured here** |
| **Instruction following** | gemma4 description: *"reasoning, agentic workflows, coding, and multimodal understanding"* | LFM2.5 is purpose-built for reliable tool calling, which is instruction following with a schema | descriptions verified live |
| **Context window** | **256K** | **125K** | both read off the live tags pages |
| **Consistent persona** | **model-independent** — the persona arrives in the system prompt from the sealed nucleus, so it survives an organ swap by construction | same | code read: `consciousness.getSystemPromptAsync` → `nucleus:get-prompt` |
| **Willing to say it does not know** | not a property any tag advertises | same | **NOT verifiable from a model card.** This is enforced at the boundary, not chosen by model: `claimGate` classifies `grounded`/`reflex`/`prose`/`unattributed` and withholds the unattributed class — **but only when `requireAttribution` is passed, which the chat path does not do today** (§A.1). Turning it on for conversation is in the bill (§E) |
| **SIZED tag** | **yes — `paramsB` 31** | **yes — `paramsB` 8** | measured by running `ollamaCatalog.paramsB()` |

### B.7 The live cloud candidates, measured — this corrects the prior report

The cloud catalogue **has changed materially** since `OLLAMA_ONLY.md`. `https://ollama.com/api/tags`
returns exactly **17** cloud names today:

`kimi-k2.6 · nemotron-3-nano:30b · minimax-m2.7 · glm-5.3 · deepseek-v4-pro:0813 · kimi-k2.7-code ·
kimi-k3 · mistral-large-3:675b · gemma4:31b · gpt-oss:120b · glm-5.2 · deepseek-v4.1-flash ·
nemotron-3-ultra · glm-5.3-flash · gpt-oss:20b · minimax-m3 · nemotron-3-super`

**Most of `OLLAMA_ONLY.md` §D.4's free list no longer exists as cloud models.** Verified by
fetching each family's tags page: `ministral-3`, `qwen3-coder`, `qwen3-next`, `qwen3-vl`,
`cogito-2.1`, `rnj-1`, `glm-4.7`, `gemma3` and `qwen3.5` **carry no `-cloud` tag at all** today.
In particular **`ministral-3:14b-cloud`, which that report named as the minimal tag clearing the
14B reasoning floor, is gone.** The third-party free-tier tracker it relied on is now
demonstrably stale.

Usage labels and windows, each read from the family's own tags page this session, with prices
from the [pricing table](https://ollama.com/pricing):

| cloud tag | Ollama's label | ctx | `paramsB` | $/M in → out | conversation verdict |
|---|---|---|---|---|---|
| **`gemma4:31b-cloud`** | **Low** | **256K** | **31** | 0.14 → 0.40 | **the pick** — low bucket, sized, newest, multimodal |
| `gemma4:cloud` | Low | 256K | **null** | 0.14 → 0.40 | avoid — unsized ⇒ `substitute` forever |
| `nemotron-3-nano:30b-cloud` | **Low** | **1M** | **30** | 0.06 → 0.24 | **the pick if retrieved context is large.** Cheapest on the board. Text-only |
| `gpt-oss:20b-cloud` | Low | 128K | 20 | 0.07 → 0.30 | usable; smallest of the low bucket |
| `gpt-oss:120b-cloud` | Medium | 128K | 120 | 0.15 → 0.60 | keep for **reasoning** — a thinking model spends output tokens and latency on every turn |
| `nemotron-3-super:cloud` | Medium | 256K | **null** | 0.015 → 0.60 | cheapest input on the board but **unsized** |
| `glm-5.3-flash:cloud` | Medium | 1M | null | 0.15 → 0.50 | capable, unsized, medium bucket |
| `deepseek-v4.1-flash:cloud` | Medium | 1M | null | 0.30 → 1.20 | — |
| `mistral-large-3:675b-cloud` | Medium | 256K | 675 | 0.50 → 1.50 | sized, but no reason to prefer it |
| `minimax-m3:cloud` · `glm-5.3:cloud` · `glm-5.2:cloud` · `kimi-k2.6:cloud` · `kimi-k2.7-code:cloud` · `nemotron-3-ultra:cloud` | **High** | 200K–1M | mostly null | 0.10–1.40 → 2.40–4.40 | assume **not** on the free tier |

**Why `gemma4:31b-cloud` over the cheaper `nemotron-3-nano:30b-cloud`:** gemma4 is multimodal, so
one tag serves conversation **and** vision; it is 2 days old against nano's 6 months; and
`gemma4:31b-cloud` is **already the reasoning pick** in the committed lineup, so master signs up
for and monitors one tag instead of two. Switch to nano only if §B.9's context budget grows past
~200K, where its 1M window and lower price win.

**One trap, restated because it is easy to hit:** the [cloud docs](https://docs.ollama.com/cloud)
say *for API requests to ollama.com use the name from the list (e.g. `gemma4:31b`), and in the
Ollama app or CLI use `gemma4:cloud`.* **The CLI spelling is the unsized one.** Since
`describeInstalled` reads `/api/tags` from the local daemon, following the CLI instruction
literally yields `paramsB: null` and a permanent `substitute`. **Pull `gemma4:31b-cloud`** — it
exists on the tags page, labelled Low Usage at 256K, and it parses to 31.

### B.8 Should `chat.send` stay at tier 5?

**Today tier 5 is defensible.** A GUEST session gets `PERSONA.masked` — `identity.reveal` is
tier 0, enforced in the main process per Section 57 — and there is no context store to read from,
so a guest conversation reaches nothing of master's.

**Once conversation retrieves from the context store, tier 5 stops being defensible as the only
gate**, because `chat.send` would then be the lowest-privileged capability that can cause a read
of master's record. But the right fix is probably **not** to raise `chat.send`: the existing
matrix already gates reads separately (`knowledge.read` 4, `chat.history.own` 3,
`stockmind.view` 4, `mind.view` 0). Gating the **retrieval** rather than the **sending** keeps
conversation open while keeping master's record closed.

**`shared/capabilities.json` is a PROTECTED FILE** under `verifyLoyaltyTripwire.cjs` via
`loyaltyGuard.PROTECTED_FILES`. **Specified, not assumed. Raised in §F.2.**

### B.9 Keeping context across turns — only the part that decides model choice

Section 130.3 fixed the storage shape: **the canonical text and structure are the record; vectors
are a derived, rebuildable INDEX beside it.** `vectorMemory.store()` already honours this —
`index.insertItem({ id, metadata: { text, …metadata, ts }, vector })` keeps the text in the record
— so swapping the embedder is a **reindex, never a loss of meaning.** Three consequences bear on
which conversation model to pick.

**(a) How much retrieved context a turn should carry, and the window it implies.**

A conversation turn is assembled from four things. Budgeting them rather than taking each
component's maximum:

```
    ~400 tokens   system prompt (PERSONA.revealed, from the sealed nucleus)
  ~5,000 tokens   retrieved context — vector:search defaults topK = 10, minScore = 0.3,
                  at the ~500 tokens-per-record figure used for the reindex estimate
  ~6,000 tokens   retained conversation — a CAP of roughly the last 12 turns
    ~200 tokens   the new question
  ~2,000 tokens   headroom for the answer
= ~13,600 tokens typical, ~24K at the wide end
```

**→ `minCtxK: 32` is the right floor: about 2× the typical turn, with room for a long exchange.**
Both recommended models clear it with enormous margin (256K cloud, 125K local), so the floor costs
nothing and documents the real requirement. **Do not raise it toward either model's maximum** —
§C.2's prefill point applies directly: prefill is compute-bound, so a large *filled* context costs
minutes of time-to-first-token on a U-class CPU. **A window you cannot afford to fill is not a
window.** `nemotron-3-nano:30b-cloud`'s 1M only becomes the better pick if the retrieved budget
grows past roughly 200K, which this arithmetic says it should not.

**One defect found while deriving this.** `Chat.jsx` L214 sends the **entire** session history —
`...messages.filter(m => m.role !== 'system')` — with no cap. Cost per turn therefore grows with
session length, and a long session will eventually exceed any window and spend free-tier credits
re-reading its own past on every turn. **The ~6,000-token retention cap above is a recommendation,
not a description of current behaviour.** It belongs with the payload-assembly chokepoint in §B.4,
which is the natural place to enforce it.

**(b) Does any free Ollama tag reliably emit clean JSON?** This matters because the records must be
model-agnostic, so the model that writes them must produce well-formed structured output.

**Yes, and the honest framing is that schema conformance is a property of the RUNTIME, not of the
model.** Ollama enforces a JSON schema via the `format` field, and via `response_format` on its
OpenAI-compatible API, with its own guidance to define the schema in Pydantic or Zod and set
**temperature 0** for determinism ([structured outputs](https://docs.ollama.com/capabilities/structured-outputs)).
So *any* tag can be constrained to well-formed JSON; what varies between models is whether the
content **inside** the schema is correct.

On that second axis the evidence points one way, and it is a verified citation rather than a
reputation claim: **`granite4.1`'s own library description explicitly names *"structured JSON
output"*** among its capabilities (read via `ollamaLibrary.parseLibrary()` over the live library).
Every model recommended here is from a **`tools`**-badged family — verified live for `lfm2.5`,
`granite4`, `granite4.1`, `qwen3.5` and `gemma4` — and tool-calling training is the same
constrained-generation competence that structured output needs.

**Practical split:** have the **local** model write records (`lfm2.5:8b-a1b-q4_K_M`, with
`format` + temperature 0), because records derive from master's context and that is precisely the
payload class §B.4 keeps on the machine. Reserve cloud for the conversational reply. **Not
verified:** I did not observe a schema-constrained response from either tag, and whether Ollama's
**cloud** path honours `format` identically to the local daemon is documented but untested here
(§G.10).

**(c) Embeddings stay local, and that is not a preference.** Verified: **no embedding model carries
a cloud badge** — embeddings are local-only on Ollama. Since the index is built over master's own
records, that limitation happens to be the correct policy anyway. It also means the **one**
unavoidable local pull on a 16 GB machine is `qwen3-embedding:0.6b` at 639 MB, which is cheap
enough that the constraint never binds.

---

## C. 16 GB DECISION TREE

### C.1 Why channels matter more than gigabytes

`OLLAMA_ONLY.md` §E established the governing fact and it is worth restating because the whole
tree hangs off it: **for quantised inference, memory bandwidth is the binding constraint, because
generating one token requires reading every active weight once.** This machine measures
**32 GB on a single 64-bit channel** — 1 of 2 slots populated, 5600 MT/s → 5600 × 8 bytes =
**44.8 GB/s**, against **89.6 GB/s** for the same memory in dual channel. **Half the bandwidth
any estimate would assume.**

If the 16 GB machine is a thin laptop with **soldered single-channel LPDDR5**, local inference is
worse than the raw GB suggests and there is no upgrade path. If it is 2 × 8 GB in two slots, it is
**dual channel** and roughly twice as fast per token at the same capacity. **That single fact
changes the lineup more than the drop from 31 GB to 16 GB does.** It is why §A.0 comes first.

### C.2 The arithmetic, from measured figures

**Usable RAM.** The brief's 8–10 GB estimate is roughly right at the top end and optimistic once
anything else is open. Grounding it in what was measured on this machine rather than asserted:

```
measured here:  svchost (90 procs)  2.10 GB
                Memory Compression  1.29 GB
                MsMpEng (Defender)  0.52 GB
                WmiPrvSE            0.42 GB      }  OS + services + AV  ~= 4.3 GB
                TaniumCX            0.40 GB      }  (endpoint agent — corporate build)

                Kiro (17 procs)     3.61 GB      <- a real Electron + Chromium app, MEASURED
```

An Electron app with a single window should sit well below Kiro's 17-process footprint; call Rāma
**1.5–2.5 GB**. So on 16 GB:

```
16.0  total
-4.3  OS + services + Defender (+ endpoint agent if this is a corporate build)
-2.0  Rāma (Electron + Chromium)
=9.7  GB before anything else is open
-2.0  a browser or an editor, which master will have open
=7.7  GB realistically available to Ollama
```

**Ollama's resident cost is the model file PLUS roughly 1–2 GB of KV cache and runtime, and KV
grows with the context you actually fill.** So the honest weights budget is:

| weights | + KV | verdict on 16 GB |
|---|---|---|
| ≤ 4.5 GB | ~6 GB | **comfortable** |
| 5–5.5 GB | ~7 GB | **fits** — the `lfm2.5:8b-a1b` band |
| 6.6 GB (`qwen3.5:9b`) | ~8–8.6 GB | **tight to swapping.** And at ~4 tok/s derived it is the wrong model for chat anyway |
| ≥ 8 GB | ≥ 10 GB | **do not** |

**Derived token rates.** Same method as `OLLAMA_ONLY.md` §E.2 — `tok/s ≈ effective bandwidth ÷
bytes read per token`, CPU inference at ~60% of peak. **Derived from a bandwidth figure, not
benchmarked; Ollama is not installed and nothing was timed.**

| model | disk | bytes/token read | single-channel 44.8 GB/s → ~27 eff. | dual-channel 89.6 → ~54 eff. |
|---|---|---|---|---|
| `lfm2.5:8b-a1b-q4_K_M` | 5.2 GB | **~1B active**, ~0.6–1.2 GB | **~22–45 tok/s** | ~45–90 tok/s |
| `granite4:7b-a1b-h` | 4.2 GB | ~1B active | ~22–45 tok/s | ~45–90 tok/s |
| `granite4.1:8b` (dense) | 5.3 GB | 5.3 GB | ~5 tok/s | ~10 tok/s |
| `qwen3.5:9b` (dense) | 6.6 GB | 6.6 GB | **~4 tok/s** | ~8 tok/s |

**This is the finding behind the local pick: on a bandwidth-bound machine, a sparse MoE is a
different class of thing from a dense model of the same disk size.** A 1B-active model reads
roughly a sixth of the bytes per token that `qwen3.5:9b` does while still parsing to 8B and
therefore still clearing the 7B floor. **The MoE architecture, not the RAM total, is what makes
narration and local conversation viable on this machine.** The active-parameter assumption is
itself derived — see §G.3.

### C.3 The tree

**Branch A — single channel (1 module, or soldered single-channel).** The likely case for a thin
16 GB laptop.

> **Cloud-first is not a preference here; it is the only usable answer above ~5 GB of weights.**
> Pull exactly §A.4 steps 2–4. Local = narration + embedding (+ optional extraction/vision).
> Conversation **defaults to cloud** (`gemma4:31b-cloud`) and falls to `lfm2.5:8b-a1b` only when a
> turn is classified sensitive. **Do not pull `qwen3.5:9b`** — at ~4 tok/s derived it is both too
> slow for chat and too close to the resident ceiling. **If the second slot is free, populating it
> is the cheapest real speedup available and costs no software change** (§F.6).

**Branch B — dual channel (2 modules, 2 × 8 GB).**

> Same local set. Bandwidth roughly doubles, so `qwen3.5:9b` becomes ~8 tok/s derived —
> borderline usable. **But capacity now binds before bandwidth does:** 6.6 GB of weights plus KV
> against ~7.7 GB available means the app and the model are competing. Add `qwen3.5:9b` **only**
> if you accept ~8 GB resident and close other apps, and keep `lfm2.5:8b-a1b` as the default.
> Cloud-first still stands for conversation, on quality rather than on speed.

**Branch C — discrete NVIDIA GPU, ≥ 8 GB VRAM.**

> The calculus changes completely: weights move off system RAM onto memory with an order of
> magnitude more bandwidth, and the 16 GB of system RAM stops being the constraint. Offload
> `lfm2.5:8b-a1b` or `qwen3.5:9b` fully; local conversation becomes genuinely fast and cloud is
> needed only for `reasoning`. Ollama's CUDA path needs compute capability 5.0+ and driver 550+
> ([hardware support](https://docs.ollama.com/gpu)).

**Branch D — Intel or AMD integrated graphics only.** The same situation as this machine.

> **Treat Branch A's numbers as the operating reality regardless of whether Vulkan engages.** An
> iGPU has no memory of its own: it shares the same single-channel system RAM, so moving the
> matrix multiplies onto it does not raise the bandwidth ceiling that sets tok/s. Ollama lists
> first-class support for NVIDIA, AMD and Apple only; **Intel appears nowhere in those tables**
> and is reachable only via Vulkan, with Ollama's own caveats about unstable iGPUs and about
> falling back to *approximate* model sizing when VRAM cannot be reported.

**On every branch: prompt processing is a separate problem and is underrated.** Prefill is
compute-bound, not bandwidth-bound. A 125K or 256K window is a real **claim**, but
time-to-first-token on a large filled context will be minutes on a U-class CPU. **A long window
you cannot afford to fill is not the same as a long window** — which is exactly why §B.9 budgets
conversation context deliberately rather than taking the maximum.

---

## D. WHAT 16 GB GIVES UP VERSUS THE 31 GB MACHINE

Named plainly, including the things that turn out **not** to be losses.

**Real losses:**

1. **Any local reasoning, permanently.** `qwen3.5:27b` is 17 GB — it does not fit beside the app
   at any channel count. On the 31 GB machine it was *nominally installable and practically
   unusable* at ~1.6 tok/s derived, and the committed lineup already routed reasoning to cloud.
   **So this is a loss on paper that costs nothing in practice.**
2. **`qwen3.5:9b` as the general-purpose local workhorse.** On 31 GB it filled five roles from one
   6.6 GB download. On 16 GB it is both too slow (~4 tok/s derived) and too close to the resident
   ceiling. Replaced by `lfm2.5:8b-a1b-q4_K_M` at 5.2 GB — **fewer dense parameters, but faster
   and still above the 7B floor.** The honest summary: a step down in dense capability, a step up
   in responsiveness, and **no change in which roles fill.**
3. **Local vision becomes optional rather than free.** On 31 GB `qwen3.5:9b` carried vision as a
   by-product. On 16 GB it costs a deliberate extra 3.4 GB (`qwen3.5:4b`). Skip it and screenshots
   go to cloud — see §F.3, because that is a privacy decision wearing a capacity disguise.
4. **Headroom for the embedding reindex.** Rebuilding ~10k records is an overnight job either way,
   but on 16 GB it wants the app closed rather than running alongside.
5. **The illusion of a long local window.** KV cache at 125K+ is the real cost, not the weights.
   A 1M-context tag on a 16 GB machine is a number you cannot spend.

**Not losses, measured:**

- **Role coverage is identical.** 7 `declared`, 1 `substitute`, 1 `none` — the same as the 31 GB
  recommendation, at 5.8–9.2 GB of disk instead of 10.7 GB.
- **Narration survives, and with room to spare** (§A.3). This was the brief's main worry and it
  does not hold.
- **The one unfilled role is the same one** — `long-context`, a code defect in `ctxK` measurement,
  not a missing download.

---

## E. THE INTEGRATION BILL, BY FILE

Invariant **I6**: Rāma writing its own source needs a ledger-recorded approval; master editing his
own source is outside that gate by design. Invariant **I8**: one capability definition.
Invariant **I10**: one resource-admission authority.

| file | change | protected? | cost |
|---|---|---|---|
| `electron/lib/modelRoles.cjs` | add `ROLES.conversation` (§B.5); add a `preferCapable` opt inverting private-before-cost for a non-sensitive turn (§B.2); **and the still-outstanding `null`-`paramsB` comparator fix** from `OLLAMA_ONLY.md` §F.2 | no | small |
| `electron/ipc/modelRouter.cjs` | route a `conversation` taskType through `selectForRole` with `{ requirePrivate }`; **honour `fit: 'none'` instead of falling through `FALLBACK_CHAIN` at L438-439**; return `roleNoteFor()` with the reply; pass `requireAttribution: true` for conversation | no | **medium — this is the load-bearing change** |
| **NEW** `electron/lib/sensitivity.cjs` | the single payload-assembly + classification authority (§B.4). Must be the only place a conversation payload is composed, and the place the **retention cap** is enforced — `Chat.jsx` L214 sends the whole unbounded session history today (§B.9a) | no | medium |
| `src/services/ramaClient.js` | stop defaulting `taskType: 'general'` (L23); pass `'conversation'` | no | trivial |
| `src/pages/Chat/Chat.jsx` | pass `taskType`/`requireAttribution`/`sources`; render the role note and the held-back notice, reusing the existing per-message `tier`/`skill` pattern (L199-205) | no | small |
| `electron/lib/ollamaCatalog.cjs` | measure `ctxK` from `/api/show`. **Blocks `conversation.minCtxK` — must land first (§B.5)** | no | small |
| `electron/ipc/vectorMemory.cjs` | record `embedModel` + `dim` per item; segregate cohorts; move to `/api/embed` with batched `input`. **Blocks the context store** | no | medium, **data integrity** |
| `electron/resourceOrchestrator.cjs` | split `ollama` / `ollama-cloud`; express Free's **1 concurrent request + monthly credit pool** (neither is a per-minute rate); replace the hardcoded `ollama/phi3` last-resort at L370 with a *discovered* local model | no | medium, **I10 policy** |
| `scripts/verifyModelRoles.cjs` | behavioural cases: a sensitive turn never selects a non-private model; `unknown` behaves as sensitive; `fit: 'none'` is not silently replaced. Harness currently **87 passed, 0 failed** | no | small, **security-critical** |
| `shared/capabilities.json` | **only** if `chat.send` is re-tiered or a context-read capability is added | **YES — PROTECTED** | gated, §F.2 |

**Nothing in the conversation path requires editing a protected file**, unless master decides to
change `chat.send`. Stated so no later session assumes otherwise.

**If a capability entry is needed, the procedure is fixed** (`verifyLoyaltyTripwire.cjs` checks
per-file SHA-256 **and** a digest over all of them, so a single-file edit cannot self-approve):

```powershell
# 1. edit shared/capabilities.json
node scripts/verifyLoyaltyTripwire.cjs                       # fails, PRINTS the new manifestDigest
$env:RAMA_MASTER_APPROVAL = '<the manifestDigest it printed>'
node scripts/verifyLoyaltyTripwire.cjs --approve --note "<why>"
# then commit shared/loyalty-tripwire.json in the SAME commit as the change it approves
```

---

## F. RAISED FOR MASTER — decisions I did not take

**F.1 — Narration on 16 GB: resolved, with one small question left.**
The brief asked whether narration is servable at all on 16 GB. **It is** — `lfm2.5:8b-a1b-q4_K_M`
(5.2 GB) and `granite4:7b-a1b-h` (4.2 GB) both return `declared`, measured. The question that
remains is smaller: **are you content for an 8B/1B-active MoE to narrate your money, rather than a
dense 9B?** The published floor is cleared either way, and the MoE is several times faster. I
recommend yes. *(The project's discipline — report `none` with a reason rather than silently
routing holdings to cloud — is therefore not triggered. It stays the correct behaviour if a future
install drops below the floor, and §B.4 point 2 is where that is enforced.)*

**F.2 — Should `chat.send` stay at tier 5?** Analysis in §B.8: defensible today, not defensible
once conversation retrieves from your context store. My suggestion is to gate the **retrieval**
rather than raise `chat.send`, keeping conversation open and your record closed.
**`shared/capabilities.json` is protected — specified, not changed.**

**F.3 — `vision` is `sensitive: false`, but its stated purpose is screenshots you paste.** The
role's own `why` reads *"reading a chart or a screenshot master pastes in."* A screenshot of your
portfolio sent to a cloud vision model is the narration risk exactly, under a role that permits
cloud. Either `vision` should become sensitive, or the per-turn mechanism in §B.4 should cover
pasted images as well as text. **I did not change it.** It also decides whether §A.4 step 5's
3.4 GB is optional or mandatory.

**F.4 — Cloud-first for conversation needs an explicit inversion** (§B.2). Today's ranking would
answer every ordinary turn locally. Making cloud the default is a deliberate choice to send
non-sensitive turns off the machine for better answers. **Confirm that is what you want.** If not,
the local model answers everything and conversation quality is bounded by 1B active parameters.

**F.5 — The system prompt itself needs a classification** (§B.3). `PERSONA.revealed` names you by
name on every turn. Options: (a) classify it sensitive, which forces **every** turn local and
effectively reverses F.4; (b) hold a cloud-safe variant of the prompt that preserves the persona
without naming you; (c) accept that your name reaches Ollama. **(b) is the only one that keeps
both quality and discretion, and it is a decision about your identity, so it is yours.**

**F.6 — The second SODIMM slot, if the 16 GB machine has one free.** §A.0's output answers it. If
it reports *1 populated of 2*, a matching module roughly doubles every token rate in §C.2 for no
software change and no recurring cost. **A fact to weigh, not a recommendation to spend.**

**F.7 — The free-tier model list is still unpublished.** Ollama's pricing page says only *"access
to starter models"*. I used Ollama's **own** Low/Medium/High usage labels, which I verified live
per tag, and they correlate cleanly with the price table — but **a cost bucket is not an access
guarantee** (§G.1). The only way to be certain is to sign in and call the tag. `gemma4:31b-cloud`
is the best-evidenced candidate: Low Usage, and the cheapest multimodal tag on the board.

---

## G. NOT VERIFIED

Stated plainly. An admitted gap beats a plausible claim, and that matters most in a list you will
act on.

1. **Free-tier accessibility of any specific cloud tag.** The Low/Medium/High labels in §B.7 are
   **verified live from each family's ollama.com tags page**, and the price table is verified. But
   Ollama does not publish which models the Free plan reaches, so **"Low Usage ⇒ free" is my
   inference from the cost correlation, not Ollama's word.** Separately: `OLLAMA_ONLY.md` §D.4's
   third-party tracker is now **demonstrably stale** — most of the tags it listed no longer carry a
   `-cloud` tag at all (verified). Do not rely on it.
2. **Behaviour at zero remaining free credits.** Explicit rejection is strongly implied — the FAQ
   says a full queue causes rejection, and off-tier models return subscription errors — but I did
   not observe a credit-exhausted request. **Verified** that the 90%-usage email is paid-plans-only,
   so a Free account gets **no proactive warning**; you must check the usage page.
3. **Every tok/s figure in §C.2, and the MoE active-parameter assumption behind the local pick.**
   Derived from a bandwidth figure measured on **this** machine at a 60%-of-peak efficiency
   assumption. **Ollama is not installed; nothing was timed.** The MoE rows additionally assume
   bytes-read-per-token tracks *active* rather than total parameters — architecturally sound and
   the basis of the whole local recommendation, but **unmeasured here.** Confirm with
   `ollama run --verbose` before committing to a local model.
4. **EVERYTHING about the 16 GB machine — which is all of it.** Its CPU, channel count, memory
   speed, GPU, free disk and whether memory is soldered are **all unknown.** This workspace runs on
   the 31.4 GB machine (re-measured this session: 31.4 GB, Core Ultra 5 135U 12c/14t, 1 of 2 slots
   at 5600 MT/s, 98.5 GB free). **§C's usable-RAM arithmetic is a derivation from measurements
   taken on the WRONG machine**, including the corporate endpoint agent in the 4.3 GB baseline,
   which the target machine may not carry. §A.0 exists to close this gap.
5. **The 1.5–2.5 GB estimate for Rāma's own Electron footprint.** Anchored on a real measurement of
   a different Electron app (Kiro, 3.61 GB across 17 processes), **not on Rāma**, which was not run.
6. **Nothing was observed on a live page.** No model was called, no conversation was held, no
   routing decision was observed in the running app. Every behavioural claim about routing comes
   from reading the code and from running `modelRoles`/`ollamaCatalog`/`ollamaLibrary` directly in
   a scratch harness.
7. **`vite build` was not attempted.** No source file was modified, so nothing could have broken.
   The three probes I ran live in `%TEMP%\rama_conv_probe\`, outside the repository.
8. **`gemma4`'s `audio` badge is unresolved, and it bears on the speech-to-text question.** The
   family header on [the cloud list](https://ollama.com/search?c=cloud) now carries an **`audio`**
   badge, yet every individual tag row reads *"Text, Image input"*. `OLLAMA_ONLY.md` §C.1 declared
   speech-to-text genuinely blocked on the grounds that no audio-input model exists on Ollama.
   **That conclusion may be out of date.** Separately, local `nemotron3:33b` is described as
   unifying *"video, audio, image and text"* including transcription — but its tag rows also read
   Text+Image only, and at 28 GB it cannot run on either machine. **Worth a dedicated check; out of
   scope here.**
9. **Multi-turn coherence, instruction following and willingness to admit ignorance** for both
   recommended models. These come from model cards and family reputation, **not from any local
   test.** `modelRoles` has the right instinct here — `multilingual` carries `noLocalMeasure: true`
   precisely because reputation is not measurement — and a `conversation` role has the same honesty
   problem. I did **not** propose `noLocalMeasure` on it, because that would force every
   conversation to report `substitute` forever; the honest alternative is the §E test harness.
10. **Schema-constrained output was not exercised.** That Ollama supports `format` /
    `response_format` is **verified from its documentation**, and that `granite4.1` advertises
    *"structured JSON output"* is verified from the live library. **But I did not send a
    schema-constrained request to any tag**, and whether Ollama's **cloud** path honours `format`
    identically to the local daemon is documented rather than tested. The §B.9(b) recommendation to
    have the local model write records is therefore sound on documentation and unproven in practice.
11. **The context-budget arithmetic in §B.9(a) rests on one borrowed figure** — ~500 tokens per
    stored record, taken from `OLLAMA_ONLY.md` §F.5's reindex estimate. **No record exists yet**
    (Section 130.10: nothing is built), so the real average is unknown and the 32K floor should be
    re-checked once records exist.

---

## EVIDENCE — file, symbol and URL citations

| claim | source, verified this session |
|---|---|
| Nine roles, no `conversation` | `electron/lib/modelRoles.cjs → ROLES`; **ran `ROLE_IDS`** → 9 ids, `includes('conversation')` false |
| `chat.send` is tier 5 and the only one of 77 | `shared/capabilities.json`; **counted by tier**: 29/14/18/13/2/**1** |
| Only `narration` is `sensitive: true`, `minParamsB: 7` | `modelRoles.cjs → ROLES.narration` |
| A sensitive role EXCLUDES non-private, not down-ranks | `modelRoles.evaluate()` — `reasons.push('not private — …')`; **measured**: 4 cloud models excluded |
| `requirePrivate` already exists as a per-call opt | `evaluate(roleId, model, { requirePrivate })`; **measured** both ways |
| Private ranks before cost, so local always wins | `selectForRole()` comparator; **measured**: local winner with cloud second |
| `fit: 'none'` is currently followed by a fall-through | `modelRouter.selectModel()` L436-442 — warns, then `TASK_ROUTING`/`FALLBACK_CHAIN` |
| Conversation routes as `'general'`, bypassing roles | `Chat.jsx` L219 (no `taskType`) → `ramaClient.js` L23 (`\|\| 'general'`) → `modelRouter.cjs` L298 |
| Claim gate is not enforced on chat | `models:chat` L296 `requireAttribution = false`; `Chat.jsx` passes neither it nor `sources` |
| `cognition.think()` is unused by the chat page | `Chat.jsx` L5 imports only `resolveReflex` |
| Claim classes incl. `unattributed` withheld | `claimGate.cjs → CLASS`; model-free classifier at `classifyOne()` |
| The system prompt names master on every turn | `consciousness.js → PERSONA.revealed`; `getSystemPromptAsync` → `nucleus:get-prompt`; `Chat.jsx` L211-215 |
| `private` = weights measured on this disk | `ollamaCatalog.describeInstalled()` — `private: cls.cloud === false` |
| `ctxK` null ⇒ hard exclusion for any `minCtxK` | `describeInstalled()` — `ctxK: known?.ctxK ?? null`; `evaluate()` pushes to `reasons` |
| `fast` only at `paramsB <= 4` | `describeInstalled()` — `if (params !== null && params <= 4) caps.add('fast')` |
| `paramsB` parses the tag, start-anchored | `ollamaCatalog.paramsB()`; **ran it**: `lfm2.5:8b-a1b-q4_K_M`→8, `lfm2.5:latest`→null, `granite4:7b-a1b-h`→7, `granite4:tiny-h`→null, `gemma4:31b-cloud`→31, `gemma4:cloud`→null |
| 7 declared / 1 substitute / 1 none on the 16 GB set | **ran `modelRoles.plan()`** over `describeInstalled()` output |
| Narration filled by a 4.2–5.2 GB model | **ran `modelRoles.evaluate('narration', …)`** |
| `capabilities.json` is protected; two-record attestation | `electron/lib/loyaltyGuard.cjs → PROTECTED_FILES`; `scripts/verifyLoyaltyTripwire.cjs` |
| Role harness green | `node scripts/verifyModelRoles.cjs` → **87 passed, 0 failed** |
| `vector:search` defaults topK 10, minScore 0.3 | `electron/ipc/vectorMemory.cjs` L149, L224-225 |
| Canonical text is stored beside the vector (index, not record) | `vectorMemory.store()` — `insertItem({ metadata: { text, … }, vector })` |
| Whole session history sent every turn, uncapped | `Chat.jsx` L214 — `...messages.filter(m => m.role !== 'system')` |
| **No embedding model on Ollama Cloud** — verified THIS session | [embedding search](https://ollama.com/search?c=embedding) — **zero** `cloud` badge occurrences on the page |
| `granite4.1` advertises *"structured JSON output"* | `ollamaLibrary.parseLibrary()` over [library?sort=newest](https://ollama.com/library?sort=newest) |
| This machine: 31.4 GB, 1 of 2 slots @ 5600 MT/s, 98.5 GB free | `Win32_ComputerSystem`, `Win32_PhysicalMemory(Array)`, `Get-PSDrive C` |
| Electron+Chromium measured footprint | `Get-Process` grouped: Kiro 3.61 GB / 17 procs; svchost 2.10 GB; Defender 0.52 GB |
| Ollama not installed | `Get-Command ollama` → not found |
| 17 cloud models; `gemma4:31b` among them | [`https://ollama.com/api/tags`](https://ollama.com/api/tags) |
| Free = $0, starter credits, starter models, **1 concurrent**, token-metered, monthly reset, no roll-over, native weights, no logging/training | [pricing + FAQ](https://ollama.com/pricing) |
| Queue-full ⇒ **rejection**, not a worse model | [pricing FAQ](https://ollama.com/pricing) |
| 90%-usage email is **paid plans only** | [pricing FAQ](https://ollama.com/pricing) |
| CLI uses `gemma4:cloud`, API uses `gemma4:31b` | [cloud docs](https://docs.ollama.com/cloud) |
| Retirements only in account usage settings — no table | [cloud docs](https://docs.ollama.com/cloud) — 1,420 bytes, still no schedule |
| `gemma4:31b-cloud` Low Usage, 256K, Text+Image | [gemma4 tags](https://ollama.com/library/gemma4/tags) |
| `gpt-oss:20b-cloud` Low / `:120b-cloud` Medium, 128K | [gpt-oss tags](https://ollama.com/library/gpt-oss/tags) |
| `nemotron-3-nano:30b-cloud` Low, **1M** ctx | [nemotron-3-nano tags](https://ollama.com/library/nemotron-3-nano/tags) |
| `nemotron-3-super:cloud` Medium, 256K | [nemotron-3-super tags](https://ollama.com/library/nemotron-3-super/tags) |
| `glm-5.3-flash:cloud` Medium, 1M; `glm-5.3`/`glm-5.2`/`kimi-*`/`minimax-m3`/`nemotron-3-ultra` High | respective `/tags` pages |
| `lfm2.5` = 8B-A1B edge model, tools+thinking, 5.2 GB / 125K | [lfm2.5 tags](https://ollama.com/library/lfm2.5/tags); description via `ollamaLibrary.parseLibrary()` over [library?sort=newest](https://ollama.com/library?sort=newest) (238 families) |
| `granite4:7b-a1b-h` 4.2 GB / 1M; `granite4.1:8b` 5.3 GB / 128K | [granite4 tags](https://ollama.com/library/granite4/tags), [granite4.1 tags](https://ollama.com/library/granite4.1/tags) |
| `qwen3.5` 0.8b–122b, 256K every tag; `:9b` = 6.6 GB | [qwen3.5 tags](https://ollama.com/library/qwen3.5/tags) |
| `ministral-3`/`qwen3-coder`/`qwen3-next`/`qwen3-vl`/`cogito-2.1`/`rnj-1`/`glm-4.7`/`gemma3` have **no** cloud tag | each family's `/tags` page, fetched this session |
| Ollama's first-class GPU backends exclude Intel | [hardware support](https://docs.ollama.com/gpu) |
| `format` / `response_format` enforce a JSON schema | [structured outputs](https://docs.ollama.com/capabilities/structured-outputs) |

---

## CONCLUSIONS

1. **The conversation gap is real, and it is larger than a missing role entry.** Conversation
   bypasses the role engine entirely, so it gets no floor, no sensitivity gate, no
   cheapest-sufficient ranking and no `declared`/`substitute`/`none` honesty — and the claim gate,
   which exists to stop unattributed claims, is never enforced on it. Four files and one new
   classifier close it; none of them is protected.

2. **The per-turn resolution holds, and the hook already exists.** `evaluate()` and
   `selectForRole()` accept `requirePrivate` and OR it with the role flag — measured working. So
   conversation can be the first real consumer of Section 130's payload-level mechanism without a
   new gating primitive. **But two things must be built deliberately:** a single payload-assembly
   chokepoint where classification is inherited by maximum, and an honouring of `fit: 'none'` in
   `modelRouter`, because today a role that reports nothing-fit falls through to the cloud-first
   `FALLBACK_CHAIN` — the precise failure the mechanism exists to prevent.

3. **The sharpest finding is that the payload is already sensitive before master types.**
   `PERSONA.revealed` names him on every turn. Any classifier that reads only the user's message
   will send his name to the cloud on a question about Python decorators. Section 130.8's join
   warning is not hypothetical; it is already true of the system prompt.

4. **Cloud-first for conversation does not happen by default — it must be chosen.** The comparator
   ranks private before cost, so a declared conversation role would answer every turn locally with
   a 1B-active model. Master should confirm the inversion rather than have it assumed either way.

5. **16 GB is far less of a constraint than the brief feared, and the reason is architecture, not
   capacity.** Narration is comfortably servable: `granite4:7b-a1b-h` at **4.2 GB** and
   `lfm2.5:8b-a1b-q4_K_M` at **5.2 GB** both clear the 7B floor and return `declared`, measured.
   Because both are ~1B-active MoE, they also read roughly a sixth of the bytes per token that the
   dense `qwen3.5:9b` does — which on a bandwidth-bound machine is the difference between ~4 tok/s
   and a usable conversation. **The 16 GB set fills the same 7 declared / 1 substitute / 1 none as
   the 31 GB set, at 5.8–9.2 GB of disk instead of 10.7 GB.**

6. **Cloud-first is the right call on 16 GB, and the arithmetic rather than the sentiment says so.**
   ~4.3 GB of OS and services plus ~2 GB of Electron leaves ~7.7 GB realistically, against a
   weights-plus-KV budget that makes 5 GB comfortable and 6.6 GB a swap risk. Keep local **only**
   what cloud is forbidden to touch — narration and embedding, optionally extraction and vision —
   and put everything else on `gemma4:31b-cloud`.

7. **The cloud catalogue moved, and the prior report's free list is stale.** Ollama now serves 17
   cloud models; `ministral-3:14b-cloud` and most of the previously-listed free tags no longer
   exist. **Anything acting on `OLLAMA_ONLY.md` §D.4 must read §B.7 here first.** The one load-bearing
   conclusion that survives intact is the sized-tag trap — and the cloud docs now actively steer
   toward the **unsized** CLI spelling, which would silently cost conversation its `declared` fit.
