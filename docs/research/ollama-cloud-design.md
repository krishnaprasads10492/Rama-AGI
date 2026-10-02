# Design — Rāma on Ollama's KEYED CLOUD API, beside the local daemon

**Scope.** Wire Rāma to Ollama's keyed cloud API (`https://ollama.com/api`) as a
**second, additive** transport alongside the existing `localhost:11434` daemon path. The
daemon path is not changed, not deprecated, and not made conditional on anything. I11 is
the governing invariant: *upgrades are additive, every new engine has a working fallback.*

**Why it exists at all.** Master's target machine has **16 GB RAM and no Ollama
installed**, and the brief's decisive fact is that *cloud requests do not require an Ollama
installation*. The existing path cannot serve that machine: `refreshOllamaModels()` probes
`http://localhost:11434/api/tags`, gets `ECONNREFUSED`, sets `detectedOllamaModels = []`,
and every role falls to `fit: 'none'`. `docs/research/OLLAMA_ONLY.md` — the Ollama-only
research already committed here — assumed the **`ollama signin`** mechanism throughout
(§A row 6: *"`ollama signin`, then use `gemma4:31b-cloud`"*). That mechanism needs a local
install. **This design covers the mechanism that report never covered**, and it does not
retract a line of it: with a daemon present, `signin` remains the simpler path and keeps
working untouched.

**The security rule that outranks every other consideration in this document.** Master
holds an Ollama API key named `Rama`. Its value is never given to any session, never
asked for, never written to any file in this repository, and never logged whole or in
part — no prefix, no suffix, no length. Every diagnostic in this design reports exactly
two states: **PRESENT** or **ABSENT**. Tests use the literal dummy
`test-not-a-real-key`. Section 12 specifies the assertions that make this mechanical
rather than a promise.

**Stack, locked on approval.** Node (CommonJS `.cjs`) in the Electron main process;
`electron/lib/http.cjs` as the only HTTP client (I9); `electron/ipc/credentialVault.cjs`
(AES-256-GCM) as the store of record for the credential; `electron/dataStore.cjs`'s
`config` domain for the base URL and usage counters, so I14's re-key covers them;
`electron/resourceOrchestrator.cjs` as the only admission authority (I10); React 18 with
the existing inline-style idiom for the one renderer change. **No new dependency** (I12).

---

## 1. Inventory — verified by reading, this session

Line numbers are from the worktree at `.worktrees/ollama-cloud` at commit `4fbe246`.

### 1.1 `electron/ipc/credentialVault.cjs` — the store of record exists and is adequate

Verified exports: `register`, `getCredential`, `isUnlocked`, `setCredentialDirect`,
`deleteCredentialDirect`. AES-256-GCM with an HMAC-SHA-512 integrity tag, Argon2id KDF
falling back to scrypt, file at `userData/rama_vault.enc`. `getCredential(service)`
returns `null` when the vault is locked — **not an error**, which matters: the absent and
the locked cases are distinguishable only if the caller asks `isUnlocked()` separately.
`vault:has` already degrades to `{ ok: true, has: false }` when locked rather than
erroring, for exactly this reason. `vault.read`/`vault.write`/`vault.unlock` are all
tier 0 in `shared/capabilities.json`.

**Finding:** nothing needs to change in this file. `OLLAMA_API_KEY` is just another
service name, matching Ollama's own environment-variable convention.

### 1.2 `electron/ipc/modelRouter.cjs` — three hardcoded hosts and a credential gap

Verified:

| Line | What is there | Why it blocks this feature |
|---|---|---|
| 28–31 | all four `ollama/*` seed entries are `credKey: null, type: 'local'` | an Ollama model can never carry a credential, so `checkAvailable` can never test one |
| 71 | `let ollamaBaseUrl = 'http://localhost:11434'` | declared, and used at **only one** call site (L353, `/api/pull`) |
| 489 | `httpGet('http://localhost:11434/api/tags')` | literal, ignores `ollamaBaseUrl` |
| 659 | `httpPost('localhost', 11434, '/api/chat', body)` | literal host **and** port |
| **706–713** (`httpPost`), **716–720** (`httpGet`) | `httpPost(hostname, port, path, body)` — **four parameters, no `headers`** | **it cannot carry `Authorization: Bearer`.** Confirmed by reading the signature; it hardcodes `headers: { 'Content-Type': 'application/json' }` internally. `httpGet(url)` likewise takes no headers. (L745–753 is `credentialStatus()` — the first draft cited the wrong lines; corrected per review #18.) |

So the answer to the brief's question is explicit: **`httpPost`'s signature does not admit
a header, and neither does `httpGet`.** Both are described in-file as *"thin adapters over
electron/lib/http.cjs … Signatures are unchanged so provider functions above stay
untouched."* Widening them would touch every Ollama call path for no gain, because
`net.request(url, { headers })` — which they wrap — already does exactly what is needed,
and `customChat` (L556–L573) already demonstrates the pattern: build a URL, set
`Authorization: Bearer`, call `net.request`. **This design follows `customChat`, not
`httpPost`.** `httpPost` and `httpGet` are left alone.

Also verified: `allModels()` is `{ ...MODEL_REGISTRY, ...discoveredOllama }` — discovery
wins on key collision, which is why §3.2 gives the cloud entries their own id namespace.
`chatCompletion` dispatches on `info.provider` through a `switch` with a
`default: throw new Error('Unsupported provider')`. `checkAvailable` ends with
`if (!info.credKey) return true; return !!getCredential(info.credKey)` — so a cloud entry
carrying `credKey` becomes available exactly when the key is readable, with no further
change. **modelRouter does not call `orchestrator.admit()` anywhere** — verified: there are
exactly **three `.admit(` call sites in three modules** (`agentOrchestrator.cjs:281`,
`instanceManager.cjs:312`, `sandboxEngine.cjs:242`); `resourceResearchEngine.cjs` mentions
`admit()` only in a comment (review #20).

`module.exports` (L755–758) is `{ register, selectModel, chatCompletion, checkAvailable,
credentialStatus, allModels, modelInfo, MODEL_REGISTRY }` — **`FALLBACK_CHAIN` is not
exported**, which has a live consequence recorded in §1.5 and fixed in §6.4.

### 1.3 `electron/lib/ollamaCatalog.cjs` — the daemon path is already honest about cloud

`describeInstalled()` (L231–L297) emits, per daemon tag: `type: 'cloud-ollama' | 'local' |
'unknown'`, `cloud: true|false|null` (**`null` is never folded into local** — the comment
on `classify()` states the asymmetry explicitly), `private: cls.cloud === false`,
`costTier: cls.cloud === true ? 1 : 0`, and `caps` containing `remote` or `offline`. It
hardcodes `credKey: null` for every entry.

`paramsB(id)` (L121–L135) splits on `:` and matches `/^([\d.]+)b/i` — **anchored at the
start, not the end**, so `31b-cloud` → `31` and `cloud` → `null`. `familyOf` splits on
`:`. `CLOUD_MIN_PARAMS_B = 8`, `CLOUD_MAX_LOCAL_BYTES = 512 MB`.

**Finding:** the daemon path needs no change. This design adds a parallel path and leaves
`describeInstalled`'s contract alone.

### 1.4 `electron/lib/modelRoles.cjs` — nine roles, and the gate that must keep refusing

Verified: `ROLES` is `Object.freeze`d with nine entries — `extraction`, `tool-calling`,
`code`, `reasoning`, `long-context`, `multilingual`, `embedding`, `vision`, `narration`.
**`narration` alone carries `sensitive: true`.** In `evaluate()`:

```js
if ((role.sensitive || requirePrivate) && model.private !== true) {
  reasons.push('not private — this role\'s prompt names master\'s holdings and must not leave the machine');
}
```

`model.private !== true` means **`false` and `undefined` both refuse** — so a
`MODEL_REGISTRY` entry with no `private` field is already refused for `narration`. §3.3
sets `private: false` explicitly anyway, and §12 asserts both the explicit and the absent
case, because relying on `undefined` is relying on an accident.

`selectForRole`'s comparator sorts `private` before `costTier`; an unknown `costTier`
sorts last via `?? 9`; an unknown `paramsB` sorts via `?? 0`, **which OLLAMA_ONLY.md §F.2
already identified as a defect** (unsized sorts as smallest for a floored role). That
defect is out of scope here and is left to row 150's work — this design must simply not
depend on it.

### 1.5 `electron/resourceOrchestrator.cjs` — the admission authority, and three real gaps

Verified at L76–L83:

```js
ollama: { reqPerMin: 9999, tokPerMin: 9999999, usedReq: 0, usedTok: 0, resetAt: 0 },
```

Correct for a local daemon. For a free cloud plan whose constraint is **one concurrent
request**, it is not merely loose — it is the wrong shape. Three findings:

1. **`_canRun` (L140–L148) is unguarded for a missing provider.** `const limit =
   API_RATE_LIMITS[task.aiProvider]; if (limit) { … }` — no `else`. A task naming an
   unregistered provider skips the check entirely and **passes**.
2. **`selectOptimalModel` (L358–L370) is unguarded in the opposite direction and worse:**
   `else { return { model: modelId, reason: 'no-rate-limit' }; }` — a missing entry is an
   affirmative *selection*. Its last line is
   `return { model: 'ollama/phi3', reason: 'fallback-all-limited' }`, a hardcoded id master
   will not have installed (already recorded in OLLAMA_ONLY.md §F.3).
   **And it cannot reach either line today, because the function throws.** L337–339
   destructures `FALLBACK_CHAIN` out of `require('./ipc/modelRouter.cjs')`; the `require`
   **succeeds**, so the `catch` default never applies, and `FALLBACK_CHAIN` is `undefined`
   because §1.2 shows it is not exported. `for (const modelId of undefined)` throws
   `TypeError` at L345/L354. **`selectOptimalModel('general')` therefore throws on every
   call** (review #14). §6.4 exports `FALLBACK_CHAIN` — additive, and it fixes the caller —
   and §12(i) asserts the function *returns* before asserting anything about what it
   returns.
3. **`admit(req)` does not look at `aiProvider` at all.** It checks RAM, CPU, temperature
   and pressure. Rate limiting lives only in `TaskQueue._canRun` and `selectOptimalModel`,
   neither of which is on `modelRouter`'s path. So **a cloud call today would pass through
   no admission check whatsoever.**

`THRESHOLDS.NETWORK = { MAX_CONCURRENT_REQUESTS: 8, RATE_LIMIT_BUFFER: 0.8 }`.
`PRIORITY.CRITICAL` bypasses both `_canRun` and `admit` — *"loyalty outranks throttling"*.

### 1.6 `electron/lib/http.cjs` — the one client (I9), and it already does everything needed

Verified: `request(url, { method, headers, body, timeout, human, retries, maxSize })`
merges `headers` over a base, so an `Authorization` header passes through unmodified.
Per-origin circuit breaker (4 failures → 20 s open), 429 backoff with jitter, 5xx retry,
10 MB response cap, `postStreamingJsonLines` for NDJSON. `verifyInvariants.cjs` L294–L297
pins the allow-list of modules permitted a raw `http`/`https` require to exactly two:
`electron/lib/http.cjs` and `electron/lib/selfRepair.cjs`. **modelRouter is not on it, and
neither will the new module be.**

One behaviour to design around: `request()` returns `{ ok, status, body, headers }` and
**never throws** for an HTTP error — `ok` is `status >= 200 && status < 400`. So a 401
arrives as `{ ok: false, status: 401, body: '<json>' }`, and the body is the only place
Ollama's reason lives.

### 1.7 `src/services/ramaCore.js` and the real web-search backend

Verified: `TOOL_REGISTRY['web.search'] = { desc: 'Search the internet', input: 'query',
output: 'results', cost: 'low', cap: 'browser.search' }`; `browser.search` is **tier 3**
in `shared/capabilities.json`.

The executing backend is `electron/ipc/browserEngine.cjs` L193, and its **first line is
`if (!playwright) return { ok: false, error: 'playwright not installed' };`**.
`start.cjs`'s `MODULES` table lists `playwright` as `required: false, gives: 'browser
automation (HTTP fetch still works)'`. The module's own header records that DuckDuckGo
serves a 305-byte empty shell to automation and that Bing is the measured default.
`intelligenceEngine.cjs` has a second, HTTP-only path (`fetchDDGAPI`,
`searchWithHumanEmulation`, `buildFallbackResults`) — that file is **out of scope for
modification** (another workflow holds it) and is only read here.

**Finding that decides §5:** on master's target machine — 16 GB, no Ollama, and a
`node_modules` tree that is not installed in this workspace at all — `web.search`'s
primary backend is a 230 MB-plus optional native-ish dependency that is very likely
absent. The capability is nominally present and practically dark.

### 1.8 `src/pages/Models/Models.jsx` — a key-entry UI already exists

Verified: `PROVIDER_LINKS` (L16–L21) maps a `credKey` to `{ label, url, hint }` for six
services; `ModelRow` renders an **Add key** button when `!isAvailable && model.credKey`
(L67–L68); `AddKeyModal` (L167–L210) takes a password-type input and calls
`saveKey(credKey, value)` → `window.rama.vault.set(currentUser, credKey, value, { label })`
(L260–L262); a vault-unlock strip sits above the tabs (L329–L340); tabs are
`['cloud','local','custom','keys']` and the filters are
`models.filter(m => m.type === 'cloud')` and `m.type === 'local'` (L296–L297).

**Two consequences.** (a) Master's setup path already exists end to end; it needs one
`PROVIDER_LINKS` row and nothing else structural. (b) `type: 'cloud'` is the value that
puts an entry in the cloud tab with the Add-key affordance — which is precisely the brief's
requirement for the keyed entries, and which `'cloud-ollama'` (the daemon-discovered value)
deliberately does **not** match. The two paths therefore render in different places without
either filter being touched. This file is `src/pages/Models/`, not `src/pages/StockMind/`,
so it is outside the other workflows' territory.

### 1.9 The verify chain and the covenant chain

`package.json` has **27** suites in `npm run verify` (counted, review #19), ending
`… verifyModelRoles.cjs && verifyChartTime.mjs && verifyChartDrawings.mjs &&
verifyChartSessions.mjs && verifyChartEmptyState.mjs && auditRenderer.cjs &&
verifyInvariants.cjs && verifyLoyaltyTripwire.cjs`. `npm run audit` is the short chain:
`auditRenderer && verifyInvariants && verifyLoyaltyTripwire`. `verify:covenant` is
`verifyInvariants && verifyLoyaltyTripwire`.

`verifyInvariants.cjs` idioms, verified: a `recorder` with `check/pass/fail/residual`; an
`INVARIANTS` array of `{ id, title, files, check(root, r) }`; `viewOf(root, rel)` returning
`{ code, nc }` (comment-stripped) views; `walkShipped(root)` which walks
**`electron`, `src`, `server`, `shared`** with `.cjs/.mjs/.js/.jsx`, skipping
`node_modules .git build dist release .worktrees coverage .vite docs research .agents .kiro`
and **skipping `scripts/`** (*"the suites themselves are not shipped"*); and a `--self-test`
harness of **thirteen** planted-defect cases, including `I12-jsx`, `I12-range` and
`I9-rawhttp`, each asserting that a specific invariant turns **red**. The thirteen are
`I12-jsx, I12-range, I15-guard, I16-failure, I16-accessor, I1-token, I2-login, I3-firstrun,
I4-reprovision, I17-gate, I8-ladder, I9-rawhttp, I14-order`, each a
`{ id, expect, why, pick, mutate }` record — counted and listed because §12.2(c) adds two
and a cold session should not under-estimate what the harness already covers.

`views(src)` returns **three** views, and which one a matcher runs against decides whether
it can ever match: `raw`; `code`, where comments **and string contents** are blanked; and
`nc`, where only comments are. `viewOf` is a JavaScript comment-stripper and does not
understand `.json` or `.md`. The banner printed before the `INVARIANTS` loop (L1021) reads
`the 17 locked invariants — asserted, not trusted`.

`electron/lib/loyaltyGuard.cjs → PROTECTED_FILES` is the authority for
`verifyLoyaltyTripwire.cjs`, covering the seven protected files. **Nothing in this design
edits any of them.**

### 1.10 `.env.example` and `.gitignore`

`.gitignore` line 4 is `.env` — verified. `.env.example` is tracked and already carries
`OLLAMA_BASE_URL=http://localhost:11434` plus provider keys written as shape hints
(`sk-...`, `AIzaSy...`). It has **no** `OLLAMA_API_KEY` line.

### 1.11 Six facts the first draft of this design got wrong — re-verified this session

The design review re-read every "verified by reading" claim and found six that were not
true. All six are re-verified here, because each one changes a decision below and a cold
session implementing the old text would have shipped something that looked green and did
nothing.

| # | Fact, re-verified | Where it lands |
|---|---|---|
| 1 | **`modelRoles.evaluate` refuses anything without `model.id` before the privacy gate** — L146–148 returns `{ fit:'none', reasons:['no model supplied'] }`. A registry row with no `id` field makes §3.3's `narration` refusal pass **for the wrong reason** and makes the inverse assertion fail. | §3.2 puts `id` on every emitted row; §3.3 gains a sixth, anti-vacuity assertion |
| 2 | ~~Nothing in the Node/Electron process loads a `.env` file.~~ **FALSE, and corrected in §1.12 — `start.cjs:150-180` (`loadEnv`) parses `.env` into `process.env` and CREATES `.env` from `.env.example` when absent.** The vault-only decision survives; its justification and the shipped `.env.example` text did not. | §1.12; §2.4's option (b); §7.2's comment block; §7.3's new warning; §12.3's new assertion |
| 3 | **No cloud model is reachable through `selectModel`.** `FALLBACK_CHAIN` (L47–55) is a hardcoded seven-id array with no cloud entry, and `selectModel`'s four passes (L433–470) are: roles over `Object.values(discoveredOllama)`; an `offline`-caps pass; the `FALLBACK_CHAIN` loop; `discoveredOllama` again; then `return primaryModel` (`'gpt-4o'`). | §3.4 adds a specified last-resort cloud pass; §12(e) asserts it |
| 4 | **`models:chat`'s fallback chain is `catch { continue; }`** (L322–335). It logs **nothing** for any error, and a missing credential is indistinguishable from a 500: a different model answers carrying only `fallbackFrom`. When nothing else is available it returns `{ ok:false, error:'All models failed…' }`, discarding `unconfigured`. | §3.4 specifies the chain change; §8's closing paragraph is rewritten |
| 5 | **`capability.can(null, …)` is hardcoded `false`** (`if (!user \|\| typeof user.tier !== 'number') return false`), and `models:chat` destructures no `user` at all (L296–297). A gate inside `chat()` with `user = null` denies every cloud call. | §2.5 step 0 and §13.1 settle it; §14 threads `user` |
| 6 | **`g.model-router` declares `channels: ['models:']`** (`genome.cjs:77`), so a `search:web` handler inside `modelRouter.cjs` is outside its gene's declared prefix. Also: **nothing in the tree invokes `browser:search`** — `ramaCore.js` only *plans* a step naming the tool (L274) and declares it in `TOOL_REGISTRY` (L326). | §5.2 renames the channel `models:search-web`; §5.1 states plainly that the chain is built ahead of its caller |

Two more, smaller, also re-verified: the §12.2 entropy matcher as first specified produces
**two false positives** in the current tree (`src/services/ghostMode.js:130`
`locally-privileged-but-HTTP-reachable`, `scripts/verifySelfModel.cjs:307`
`ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX` — both read and confirmed), and
`credentialStatus()` (L745–753) maps **every** unavailable non-`local` row to
`'missing-key'`, so a merely-locked vault renders an Add-key button for a key master
already has. Both are fixed below (§12.2(b), §7.1).

### 1.12 Round 2 — seven more facts, each verified by reading or measuring in THIS session

The second design review found one false premise, three pieces of specified code that
cannot execute as written, one uncovered egress, and a set of signatures the implementer
would have had to invent. Each is re-verified here against the worktree, because each one
changes a decision below.

| # | Fact, verified this session | Where it lands |
|---|---|---|
| 1 | **`.env` IS parsed into `process.env`.** `start.cjs:150–180` is a hand-rolled loader: it **copies `.env.example` → `.env` when `.env` is absent** (L158, L166), then `for (const raw of …split('\n'))` sets `process.env[key]` for every `KEY=value` line that is not already exported (L176–177). `loadEnv()` is called at L1463, in Stage 0. And `start.cjs` spawns every child with `env: { ...process.env, … }` at **L886, L1004, L1129, L1197, L1271**. `dotenv` really is not a dependency — but *the absence of `dotenv` is not the absence of a `.env` loader*, and L384's existence check is not the only `.env` interaction. **So a key master writes into `.env` is loaded and inherited by the Vite, server and sandbox children. That is a reason to keep it out of `.env`, not a reason to think it would be inert there** — and `.env.example` actively invites it, already listing `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `GITHUB_TOKEN` with shape hints. | §2.4's option (b); §7.2's comment block, rewritten to be true; §7.3's new `.env` warning; §12.3's new assertion; §9's base-URL row, which now works via `.env` as well as a shell export |
| 2 | **`src/services/ramaClient.js:23` is the ONLY `models.chat` caller in the tree.** `Models.jsx` has none — the §14 row claiming otherwise was wrong. `ramaChat.send({ messages, provider, model, sessionId, taskType })` has no `user` parameter and does not import the user store. **Its two callers both already hold `currentUser`:** `src/pages/Chat/Chat.jsx:219` (`const { currentUser } = useUserStore()` at L149) and `src/pages/IDE/IDE.jsx:253` (same at L183). **No caller lacks a user**, so the thread-through is three one-line changes, not a migration. | §3.4(a); §13.1's wiring paragraph; §14 gains three renderer rows; §12(g3)'s structural assertion |
| 3 | **`browser:search` is an inline closure with no exported function.** `browserEngine.cjs:193` registers `ipcMain.handle('browser:search', async (_e, query, engine = 'bing') => …)` inside `register(ipcMain)`, over module-scoped `browser`/`browserCtx`; `module.exports` (L386) is exactly `{ register, closeBrowser, getBrowserPid }`. An `ipcMain` handler cannot be invoked from main-process code. | §5.2 chooses extract-and-export; `browserEngine.cjs` joins §14 with a §12(j) assertion |
| 4 | **`orchestrator.submit()` returns a bare `task.id` STRING**, and it has exactly **one** caller — the IPC handler at L478, which wraps it as `{ ok: true, id }`. So the review's recommended `return { ok: false, error }` would change `submit`'s return type and break that wrap. | §6.4b refuses by **throwing**, which is the additive form of the same decision |
| 5 | **`aiProvider` is free text from the UI.** `src/pages/Resources/Resources.jsx:155` is an `<input placeholder="AI provider (optional: openai, anthropic, groq, ollama...)">` whose value is submitted verbatim at L158, and L381–383 only acts `if (res?.ok)` — **there is no error surface at all**. And `_tick()` (L253–L256) increments `API_RATE_LIMITS[task.aiProvider].usedReq` through an **unguarded** bracket read, a third `__proto__` surface. | §6.4b; §6.4's `hasOwnProperty` rule extended to `_tick`; §14 gains the `Resources.jsx` error line |
| 6 | **`views()` returns `{ raw, code, nc }`** (L111–L161): in `code` both comments **and string contents** are blanked; in `nc` only comments are. `viewOf` caches per file and is a JavaScript comment-stripper, so it does not understand `.json`/`.md`. `walkShipped` (L215–L235) walks **`electron`, `src`, `server`, `shared`** and has an explicit `if (rel.startsWith('scripts/')) continue;`. The banner at **L1021** prints `the 17 locked invariants — asserted, not trusted` before iterating `INVARIANTS`. `MUTATIONS` (L826) has **thirteen** cases — `I12-jsx, I12-range, I15-guard, I16-failure, I16-accessor, I1-token, I2-login, I3-firstrun, I4-reprovision, I17-gate, I8-ladder, I9-rawhttp, I14-order` — each `{ id, expect, why, pick, mutate }`. | §12.2(b) names the view per extension; §12.2(c) adds a second planted case; the banner is corrected; §1.9 is corrected |
| 7 | **MEASURED, NOT TAKEN ON FAITH: the matcher is quiet with `server/` included.** I reimplemented §12.2(b) exactly as specified under bare Node, outside the repo, over **`electron/ src/ server/ scripts/ shared/`** with `.cjs .mjs .js .jsx .json .md`: **194 files, 0 prefix hits, 0 entropy hits.** With the two discriminators removed: **exactly 2 entropy hits — `src/services/ghostMode.js:130` (H=4.06) and `scripts/verifySelfModel.cjs:307` (H=3.98)**, the same two strings §12.2(b) names and neither a credential. The probe scanned **raw** text for every extension, which is the more permissive case, so the `nc` variant §12.2(b) now specifies for the JS family can only match the same or fewer. The probe was written in `$env:TEMP`, never inside the repo, and deleted. | §12.2(b) adds `server/` at zero cost; §11 records the measurement as this session's own |

---

## 2. The transport — `electron/lib/ollamaCloud.cjs` (new)

### 2.1 Why a new module rather than branches inside `modelRouter.cjs`

`modelRouter.cjs` is 758 lines, is a `register(ipcMain)` IPC surface, and is not on I9's
raw-HTTP allow-list. Three considered options:

- **(a) Inline the cloud branch into `ollamaChat`.** Smallest diff. Rejected: the
  credential, the base-URL validation, the name mapping, the payload boundary and the
  concurrency slot would all land in a function that is four lines long today, inside a file
  that already mixes six providers. The security-critical logic would be the hardest part of
  the file to test, because testing it means stubbing `ipcMain`.
- **(b) A new provider in `customProviders.cjs`.** Tempting — `customChat` already does
  Bearer auth over `net.request`. Rejected: `customProviders` is master-managed data
  (`models.add-key`, add/remove at runtime), and Ollama Cloud is not a provider master
  registers by URL; it needs a fixed name table, its own admission row and its own payload
  gate. Bending a data-driven mechanism to carry policy would hide the policy.
- **(c) A dedicated `electron/lib/ollamaCloud.cjs`, consumed by `modelRouter`.** **Chosen.**
  It matches the house shape exactly — `ollamaCatalog.cjs`, `modelRoles.cjs`,
  `claimGate.cjs` and `customProviders.cjs` are all pure-ish libs under `electron/lib/`
  with no Electron requirement, each with its own `scripts/verify*.cjs`. It is unit-testable
  with injected stubs, which is the decisive argument for security-critical code.

### 2.2 Module contract

```js
// electron/lib/ollamaCloud.cjs
module.exports = {
  // configuration + state, never values
  baseUrl, resolveBaseUrl, credentialState, isConfigured, status,
  // naming
  CLOUD_TAGS, apiNameFor, daemonTagFor, isDaemonCloudTag, isApiName,
  // registry
  toRegistryEntries,
  // transport
  chat, listModels, webSearch,
  // seams for tests
  useVault, useStore, useHttp, useOrchestrator,
  // constants
  DEFAULT_BASE_URL, ALLOWED_HOSTS, CRED_SERVICE,
};
```

`CRED_SERVICE = 'OLLAMA_API_KEY'`. The injection seams follow `ollamaCatalog.useStore`
exactly: a module-level `injected*` variable, a lazy `require` when nothing is injected,
so a test never loads the real vault, store, HTTP client or orchestrator.

**`isApiName` is defined, because an exported function nobody specified is the seam a later
session uses for something the gate never reviewed:**

```js
const isApiName = (s) => Object.prototype.hasOwnProperty.call(CLOUD_TAGS, String(s));
```

It is the positive counterpart of `isDaemonCloudTag` and is asserted in §4.5 (assertion 11).

**`useOrchestrator(stub)` requires `stub` to expose exactly
`{ admit, reserveSlot, releaseSlot, recordApiUse }`** — all four, all functions — and
**throws** if any is missing. Without that check a test stub and the real instance can drift
apart silently, which is the one way a suite can be green about admission while admission
does not happen. When nothing is injected, the module lazily does
`require('../resourceOrchestrator.cjs').orchestrator` — **the instance, not the module**,
because the instance is what owns the counters (§6.3). Asserted in §12(i).

**`status()`'s key set is FROZEN and enumerated here, because §12.4(7) asserts this literal
list** and an implementer who invents the shape and then writes the assertion to match it
has produced the vacuous green §3.3's sixth assertion exists to prevent — here guarding the
leak surface itself:

```js
// status() — the ONLY structured self-description of this module. No field is derived from
// the credential VALUE: no length, no prefix, no suffix, no mask, no hash. §12.4(7) pins
// this exact key list, so adding such a field fails the suite rather than shipping.
status() => Object.freeze({
  present,                  // bool — from credentialState()
  source,                   // 'vault' | null
  vaultUnlocked,            // bool
  reason,                   // string | null
  remedy,                   // string | null
  baseUrl,                  // a host, not a secret
  baseUrlOverrideRejected,  // bool
  baseUrlOverrideWhy,       // string | null — the RULE violated, plus the hostname
  cloudCapability: { key, dedicated },   // §13.1
  monthlyBudget: null,      // always null — Ollama does not expose it (§6.3)
  monthlyBudgetKnown: false,
  usedTokMonth,             // what RĀMA SPENT, never what remains
  monthStartedAt,           // epoch ms | null
  inFlight,                 // from the orchestrator row
  maxConcurrent,
})
```

`models:cloud-status` (§7.1) returns a **SUBSET of exactly these keys** —
`{ present, source, vaultUnlocked, baseUrl, baseUrlOverrideRejected, reason, remedy }` — and
**not a parallel shape**, so there is one definition of what may be said about the
credential and the renderer surface is provably narrower than it.

### 2.3 Base URL resolution and validation — the first place a credential could leak

A configurable base is required, and a configurable base is the most dangerous input in
this design: a wrong value means **sending master's Bearer token to a host of someone
else's choosing.** The validation is therefore a hard gate, not a sanitiser.

`resolveBaseUrl()` precedence, first hit wins:

1. `dataStore.get('config', 'ollamaCloudBaseUrl')`
2. `process.env.OLLAMA_CLOUD_BASE_URL`
3. `DEFAULT_BASE_URL = 'https://ollama.com'`

Validation, applied to 1 and 2 only (3 is a frozen literal):

| Rule | On failure |
|---|---|
| parses as a URL | reject |
| `protocol === 'https:'` | reject — a credential never goes over cleartext, and this is the rule that stops `http://evil.test` and stops someone "testing" against the local daemon with the key attached |
| no `username`/`password` in the URL | reject — credentials in a URL get logged by intermediaries |
| no `search`, no `hash` | reject — a query string on a base URL is a redirect vector |
| `hostname` is in `ALLOWED_HOSTS = Object.freeze(['ollama.com', 'api.ollama.com'])`, or exactly equals `config.ollamaCloudHostAllow` which **master must set separately** | reject |
| length ≤ 200 | reject |

A rejected override is **fatal for configuration, not for the process**: `resolveBaseUrl()`
returns `{ url: DEFAULT_BASE_URL, overrideRejected: true, why }`, logs **once per process**
at `console.error` with the *reason and the hostname only* (a hostname is not a secret; the
key is never in scope here), and `status()` surfaces `baseUrlOverrideRejected: true` so the
UI can say so. Falling back to the known-good default rather than refusing to run keeps a
bad config from bricking the feature, and `overrideRejected` keeps it from being silent.

Requiring a **second, separate** config key to widen the host allow-list is deliberate: a
single mistyped base URL cannot reach a new host, because widening the host is its own act.

### 2.4 Credential read — the vault is the ONLY store, and what may be said about it

**Decision, changed from the first draft: there is no environment-variable credential
source. The DECISION is unchanged; its JUSTIFICATION was wrong, and a wrong justification
for a right decision is how the decision gets reversed by the next session.**

The first draft accepted `process.env.OLLAMA_API_KEY` and told master to write the key into
`.env`. The first revision removed it on the grounds that *"nothing parses a `.env` file"*.
**That is false** (§1.12 fact 1): `start.cjs:150–180` parses `.env` into `process.env`, and
it **creates `.env` from `.env.example`** when `.env` is absent. The real reason to keep the
credential out of `.env` is the opposite of the reason given — **not that nothing reads it,
but that everything does.**

Three options were considered:

- **(a) add `dotenv` and load `.env` deliberately.** Rejected twice over: a new dependency
  (I12 pins and limits dependencies), and `start.cjs` already has a loader, so the
  dependency would buy nothing but a second one.
- **(b) keep an env source — `.env`, or a real exported shell variable. Rejected, and this
  is the reason that actually holds:** a credential in `process.env` sits in plaintext on
  disk (`.env`) **and** is inherited by **every** child process Rāma spawns —
  `start.cjs` passes `env: { ...process.env, … }` at **L886, L1004, L1129, L1197 and
  L1271**, which is the Vite dev server, the Express server and the sandbox children. One
  paste into `.env` hands master's Ollama key to five processes that have no business
  holding it, and puts it in any crash dump any of them produces. The convenience bought is
  one the existing UI already covers (§1.8).
- **(c) vault-only.** **Chosen.** One store, AES-256-GCM at rest, re-keyed by I14, with a
  key-entry UI that already exists end to end (§1.8). One remedy string, which is the
  remedy that actually works.

**And because `.env.example` invites precisely the wrong thing — it already lists
`OPENAI_API_KEY=sk-…`, `ANTHROPIC_API_KEY=sk-ant-…`, `GEMINI_API_KEY=AIzaSy…` and
`GITHUB_TOKEN=ghp_…` as shape hints, and `loadEnv()` COPIES IT TO `.env` on first launch —
the decision is defended three ways rather than asserted once:** `.env.example` says in a
comment that the file **is** loaded and that the key must not go there (§7.2); `--diagnose`
**warns** when `.env` carries an `OLLAMA_API_KEY` line, naming no part of the value (§7.3);
and §12.3 asserts that no shipped module contains the expression
`process.env.OLLAMA_API_KEY`, so Rāma cannot *use* such a key even if master loads one.
**That last assertion is the load-bearing one: it cannot stop a key being put in `.env`, it
stops Rāma reading it from there.**

```js
function credentialState() {
  const vault = v();
  const unlocked = vault.isUnlocked();
  const stored = unlocked ? vault.getCredential(CRED_SERVICE) : null;
  if (stored) return { present: true, source: 'vault', vaultUnlocked: true, reason: null };
  return { present: false, source: null, vaultUnlocked: unlocked,
           reason: unlocked ? 'no Ollama API key is stored' : 'the vault is locked' };
}
```

**The returned object's keys are exactly `present`, `source`, `vaultUnlocked`, `reason`,**
and `source` is now `'vault' | null`. No length, no prefix, no suffix, no masked rendering,
no hash. §12 asserts the key set literally, because "no prefix" is only enforceable if the
shape is pinned.

`CRED_SERVICE` stays `'OLLAMA_API_KEY'` — it matches Ollama's own environment-variable
convention, which is what master will recognise — but **the name is a vault service name,
not an environment variable Rāma reads.** §12 asserts that no module in the shipped tree
contains the expression `process.env.OLLAMA_API_KEY`, so the removed source cannot creep
back in as a one-line "convenience".

Consequences of (c), written out so no remedy string is left stale: `suggestVaultImport` is
**deleted** (there is nothing to import from); every `remedy` in §8 is the single string
*"Models → Cloud → Ollama Cloud → Add key (unlock the vault first)"*; `.env.example` gains
**no key assignment at all** (§7.2); and `--diagnose`, which runs before Electron and cannot
read the vault, **does not report on the credential at all** rather than reporting a false
`ABSENT` (§7.3).

**Locked ≠ absent** is now the only distinction `credentialState()` has to carry, and it
carries it in `reason` plus `vaultUnlocked`.

`present: false` with `reason: 'the vault is locked'` and `vaultUnlocked: false` is a
*recoverable, named* state, and **the UI must render it differently from "no key stored"
all the way out to the model row** — not just inside this function. §7.1 specifies that
rendering, because `credentialStatus()` (L745–753) flattens both states to `'missing-key'`
one layer up and would otherwise undo the distinction (§1.11, review #10).

`authHeader()` is **module-private**, never exported, builds
`{ Authorization: 'Bearer ' + key }` and is called inline at the request site so the value
has the shortest possible lifetime. The key is never assigned to a module-level variable,
never cached, never put in an object that is returned or logged.

### 2.5 `chat()` — the request path

```js
async function chat({ messages, apiModel, user,            // user has NO default — step 0
                      priority = PRIORITY.NORMAL,          // passed to admit() at step 5
                      options  = null,                     // { think, format } — enumerated, §9
                      timeout  = 120000, parts = null })
```

Note `user` has **no default**. That is deliberate and is step 0.

**`priority` is declared, because step 5 passes it.** The first revision called
`admit({ …, priority })` from a function whose signature did not declare it — an undefined
variable, which `admit` would have read as `undefined` and defaulted to `NORMAL`, so the
parameter master's critical work needs would have been silently inoperative. It is
`PRIORITY.NORMAL` by default, clamped to 0–4, and `PRIORITY.CRITICAL` is accepted only from
a master-initiated call (§9).

**`think` and `format` moved into `options`, because they could not previously reach the
body.** They were declared on the signature, had no validation row, and §12(g) forbids any
body construction outside `egressBoundary.assemble` — so they were either dead or a second
body-construction path waiting to be written. They now travel as `options` through
`assemble`, enumerated there, with `format` restricted to `null | 'json'` and any other
value **refused rather than passed through** (§9).

Sequence, in order, each step a hard gate:

0. **Capability.** `chat()`, `listModels()` and `webSearch()` each require an **explicit**
   `user`. Three cases, kept distinct because conflating them is how a gate becomes
   decorative (§1.11 fact 5):
   - `user === undefined` — the argument was never threaded. This is a **programming
     error**, not a permissions outcome, and it returns
     `{ ok: false, gateError: true, reason: 'no user supplied to a gated cloud call' }`
     and logs at `console.error`. A missing wire-up must never read as "master lacks
     permission", because that sends the next session looking in
     `shared/capabilities.json` for a bug that is in a call site.
   - `user === null` — an unauthenticated caller. **Denied**, via
     `capability.deny(user, capKey)` (§13.1's shape).
   - a user object — gated on `models.use-cloud` when `capability.MATRIX` has that key and
     `models.use` otherwise, with `status()` saying which is in force (§13.1).

   **Zero HTTP calls in the first two cases**, asserted. `models:chat` is changed to accept
   and thread `user` (§3.4), which is what makes this gate run rather than stand closed.
1. **Name pre-flight.** `isDaemonCloudTag(apiModel)` → if the name ends in `-cloud` or
   `:cloud`, **refuse** (§4). This is the single assertion that stops the brief's "break
   silently" failure from ever reaching the wire.
2. **Payload boundary — and the ONE place a body is built.**
   `egressBoundary.assemble({ kind: 'chat', messages, parts, model: apiModel, stream: false, options })`
   (§5.3), which classifies **`messages` as well as `parts`** because `messages` is the
   field that actually carries the prompt, **and which owns the whole envelope** — `model`,
   `stream` and `options` included. **Nothing else in this module may construct a body**
   (§12(g)), and that is why the envelope has to live here: the first revision gave
   `assemble` only `{ messages, parts }` while `/api/chat` requires a `model`, so the
   request specified could not have been made at all.
3. **Credential.** `credentialState()`; if `!present`, return the UNCONFIGURED shape (§2.7)
   — never a fallback, never an attempt.
4. **Base URL.** `resolveBaseUrl()`.
5. **Admission.** `orchestrator.admit({ aiProvider: 'ollama-cloud', label: 'ollama cloud chat', ramMB: 32, priority })`
   (§6.3). If `!allow`, return `{ ok: false, deferred: true, reason }`. The only bypass is
   the one `admit` already has for `PRIORITY.CRITICAL`, which this design does not widen.
6. **Slot.** `orchestrator.reserveSlot('ollama-cloud', { priority, waitMs })` (§6.3) —
   released in a `finally`, unconditionally. A `CRITICAL` request **waits** for the slot
   rather than bypassing it, because one concurrent request is a physical limit of the free
   tier and bypassing it buys a 429, not a faster answer.
7. **Send.** `net.request(`${base}/api/chat`, { method: 'POST', body: gate.body, headers: { 'Content-Type': 'application/json', ...authHeader() }, timeout, retries: 1 })`
   — `gate.body` is `assemble`'s result, used verbatim and never amended.
8. **Shape.** Parse; require `parsed.message.content` to be a string.
9. **Record.** `orchestrator.recordApiUse('ollama-cloud', tokens)` from
   `parsed.prompt_eval_count + parsed.eval_count` when present.

Every successful return carries the provenance the brief requires:

```js
{ ok: true, content, usage,
  path: 'cloud', endpoint: `${base}/api/chat`, apiModel,
  via: 'ollama-cloud-keyed', credentialSource: 'vault' }
```

`path` is `'cloud'` here and `'local'` on the daemon path (§3.4), and it is threaded all
the way to `models:chat`'s response so **which path served a request is visible to master,
not inferred from a model name.**

### 2.6 `listModels()` and `webSearch()`

`listModels({ user })` → `GET ${base}/api/tags` with the Bearer header. Returns
`{ ok, models: [{ apiModel, daemonTag, family, paramsB, sized }], path: 'cloud' }`, with
`daemonTag` filled from `CLOUD_TAGS` where the table knows it and `null` where it does not
— **never derived by guessing**. Admission row `ollama-cloud`, `ramMB: 16`,
`timeout: 15000`, `retries: 1`.

`webSearch({ query, maxResults })` → §5.

### 2.7 The UNCONFIGURED shape — absent, not broken

The brief's requirement is that an absent key reports **ABSENT and UNCONFIGURED**, never
broken and never a silent fallback. One shape, used by every entry point:

```js
{ ok: false, unconfigured: true, present: false,
  path: 'cloud', reason: '<from credentialState().reason>',
  remedy: 'Models → Cloud → Ollama Cloud → Add key (unlock the vault first)',
  vaultUnlocked: <bool> }
```

`unconfigured: true` is the field callers branch on. It is **not** an error string, so a
caller cannot accidentally render "Ollama cloud failed".

**And that is not enough on its own, which the first draft got wrong.** It claimed
`modelRouter`'s fallback chain "treats `unconfigured` as not a failure of this model and
moves on without logging an error; a genuine failure logs at `console.warn` as the chain
does today". The chain does not do that today: it is `catch { continue; }` (§1.11 fact 4).
It logs nothing, it cannot tell a missing key from a 500, and when nothing else is
available it collapses everything into `All models failed. Last error: …` — **reporting
ABSENT as BROKEN, and reporting a substitution silently.** Both are things the brief
forbids in as many words.

So this design **changes the chain** (specified in §3.4), and the rule is:

- an `unconfigured` candidate is recorded in an `unconfigured[]` array and **not** logged as
  a failure;
- a genuine failure is recorded in `failures[]` and logged at `console.warn` — which the
  chain does not do today and will after this change;
- when a fallback answers, the response carries `unconfigured` **alongside** `fallbackFrom`,
  so the substitution and its cause are both **declared**;
- when every candidate was merely unconfigured, the response is
  `{ ok: false, unconfigured, error, remedy }` and **never** the string `All models failed`.

---

## 3. Making `ollama/*` able to carry a credential and a type

### 3.1 The decision: a separate id namespace, not a flag on the existing one

`allModels()` is `{ ...MODEL_REGISTRY, ...discoveredOllama }`, so **discovery silently wins
every key collision.** If a keyed cloud entry were `ollama/gemma4:31b` and the daemon ever
reported a local `gemma4:31b` pull, the local entry would overwrite the cloud one and a
request would change path with no visible cause. That is the exact silent-divergence failure
this design exists to prevent.

**Decision: keyed cloud entries live under `ollama-cloud/<api-name>` with
`provider: 'ollama-cloud'`.** Three things fall out for free:

- collision with `ollama/<daemon-tag>` is structurally impossible;
- `provider` gives the orchestrator a distinct `API_RATE_LIMITS` row with no string
  parsing (§6);
- **the id itself says which path served the request** — `ollama-cloud/gemma4:31b` versus
  `ollama/gemma4:31b-cloud` versus `ollama/qwen3.5:9b`.

The alternative — one `ollama` provider with a `cloudKeyed: true` flag — was rejected
because every consumer (`selectOptimalModel`, `_canRun`, `credentialStatus`, the Models
tabs) would need to learn the flag, and any consumer that did not would quietly treat a
metered cloud call as an unmetered local one.

### 3.2 The seed entries in `MODEL_REGISTRY`

`electron/ipc/modelRouter.cjs` L28–L31: **the four existing `ollama/*` rows are not
touched.** `llama3.2`, `codellama`, `mistral`, `phi3` are local pulls; `credKey: null,
type: 'local'` is correct for them and stays.

Appended below them, a new block built from `ollamaCloud.CLOUD_TAGS` rather than typed
twice:

```js
// Keyed Ollama Cloud models — reached at https://ollama.com/api with a Bearer token from
// the vault, with NO local Ollama installation. Distinct from the `ollama/*` rows above
// (local pulls) and from `ollamaCatalog.describeInstalled`'s `cloud-ollama` entries (cloud
// models reached THROUGH a signed-in local daemon). All three can coexist; `provider`
// and the id prefix say which is which.
Object.assign(MODEL_REGISTRY, require('../lib/ollamaCloud.cjs').toRegistryEntries());
```

`ollamaCloud.toRegistryEntries()` emits, per row of `CLOUD_TAGS`:

```js
'ollama-cloud/gemma4:31b': {
  // `id` ON THE ROW, not only as the object key. In MODEL_REGISTRY the id is the key, but
  // modelRoles.evaluate refuses anything without model.id BEFORE it reaches the privacy
  // gate (modelRoles.cjs L146-148: { fit:'none', reasons:['no model supplied'] }). Without
  // this field §3.3's narration refusal passes for the WRONG reason and its inverse fails —
  // the one defence this design weights highest would ship green and prove nothing.
  // `discoveredOllama` rows already carry `id`; this brings the cloud rows into line.
  id:       'ollama-cloud/gemma4:31b',
  provider: 'ollama-cloud',
  credKey:  'OLLAMA_API_KEY',
  type:     'cloud',
  private:  false,
  ctxK:     null,          // never measured on this path — see §9
  ctxVerified: false,
  costTier: 1,             // a free allowance is a budget even with no invoice
  caps:     ['general', 'remote', ...fromTable],
  paramsB:  31,            // from ollamaCatalog.paramsB(apiModel) — the SIZED advantage
  apiModel: 'gemma4:31b',
  daemonTag:'gemma4:31b-cloud',
  usage:    'low',
}
```

Mirrors `customProviders.toRegistryEntries()`, which is already merged into
`MODEL_REGISTRY` by `refreshCustomProviders()` — same precedent, same mutation-in-place
discipline (`Object.assign`, never replacing the object, because `resourceOrchestrator`
holds a direct reference).

`type: 'cloud'` is chosen deliberately, per §1.8: it is what puts the row in the Models
cloud tab with an Add-key button, and it is what makes `checkAvailable` fall through to
`!!getCredential('OLLAMA_API_KEY')`. **No change to `checkAvailable` is needed at all.**

`private: false` is explicit. `costTier: 1` matches `describeInstalled`'s own reasoning for
a cloud model, so the `modelRoles` comparator ranks a local model above a cloud one for the
same fitness — which is the correct default when the free tier allows one concurrent
request.

### 3.3 Keeping `narration` correct — the assertion that matters most

`narration` is the only `sensitive: true` role. `evaluate()` refuses any model whose
`private !== true`. Since `private: false` is set explicitly on every cloud row, **every
`ollama-cloud/*` entry is refused for `narration` by the existing code with no change.**

The risk is not today's code; it is a future edit that adds `private: true` to a cloud row
by copy-paste, or a refactor that drops the field. §12 therefore asserts **six** things,
not one:

1. every `ollamaCloud.toRegistryEntries()` row has `private === false` (shape);
2. `modelRoles.evaluate('narration', cloudRow)` is `fit: 'none'` (behaviour);
3. the refusal reason names the leaving-the-machine rule (message, so a future reword
   cannot pass a sensitive prompt while sounding right);
4. `modelRoles.evaluate('narration', { ...cloudRow, private: undefined })` is **also**
   `fit: 'none'` — the `undefined` case, pinned so the gate does not depend on an accident;
5. the inverse, so the assertion is not vacuous: the same row **is** fit for
   `reasoning` (31B clears the 14B floor), proving the refusal is about sensitivity rather
   than about cloud rows failing everything;
6. **and the anti-vacuity guard that makes 2–4 mean anything:
   `evaluate('narration', cloudRow).reasons[0] !== 'no model supplied'`.** Without it, a row
   that lost its `id` would refuse `narration` for an unrelated reason and assertions 2 and
   4 would still pass — green, and proving nothing. This is the assertion the review found
   missing, and it is the cheapest one in the suite.

Every one of the six runs against the row **as `toRegistryEntries()` emits it**, not against
a hand-built object, so a change to the emitter is what the suite sees.

`modelRoles` is not modified. Note that role selection in `modelRouter` passes
`Object.values(discoveredOllama)` — so **cloud-keyed entries do not reach the role engine
at all today**, and OLLAMA_ONLY.md §D.9 already records that only Ollama models can fill a
role. Feeding them in is a *separate* change belonging to row 150's work. This design
deliberately does **not** make it, and §12's assertions run `evaluate()` directly so the
gate is proven correct **before** anything routes through it. That ordering is the point: the
refusal is asserted before the path exists.

### 3.4 `modelRouter` dispatch and the `path` field

`chatCompletion`'s switch gains one case:

```js
// FOUR arguments. `user` is the one that decides whether the gate RUNS or merely STANDS
// SHUT: ollamaCloudChat declares it, the transport's step 0 refuses `undefined` with
// gateError, so omitting it here makes EVERY cloud request fail while looking like a
// policy decision — the exact failure §131.8b(3) exists to close. The first revision
// passed three.
case 'ollama-cloud': return ollamaCloudChat(messages, modelId, info, user);
```

```js
async function ollamaCloudChat(messages, modelId, info, user) {
  const cloud = require('../lib/ollamaCloud.cjs');
  const res = await cloud.chat({ messages, apiModel: info.apiModel, user, timeout: 120000 });
  if (res.unconfigured) {
    // BOTH flags ride on the error. `remedy` is what the chain reports to master when every
    // candidate was merely unconfigured; without it the one actionable sentence is lost at
    // the throw and the response can only say that something failed.
    const e = new Error(res.reason); e.unconfigured = true; e.remedy = res.remedy; throw e;
  }
  if (res.gateError) { const e = new Error(res.reason); e.gateError = true; throw e; }
  if (!res.ok) throw new Error(res.error || res.reason || 'Ollama Cloud request failed');
  return { content: res.content, usage: res.usage, path: 'cloud', endpoint: res.endpoint };
}
```

Throwing on failure matches every sibling (`openaiChat`, `groqChat`, …) so the chain's
control flow is unchanged in shape. `ollamaChat` gains one line and no behaviour change —
`path: 'local'` on its return.

`path` and `endpoint` reach the renderer through **`gated()`'s `...result` spread** (L311),
not through the `extra` argument — `extra` carries only `{ model, fallbackFrom }` and now
`unconfigured`. Correction noted because the first draft named the wrong mechanism (review
#22). Worth stating: the five non-Ollama providers return no `path` field at all, so
`path` is `'cloud' | 'local' | undefined`, and `undefined` means "a provider that has only
one path".

**Three changes to `models:chat`, all additive, all specified rather than described.**

**§3.4(a) It accepts and threads `user`,** which is what makes §2.5 step 0 a gate that runs
instead of a gate that is always closed. `preload.cjs`'s `models.chat` already forwards the
whole options object, so the renderer side is a call-site addition, not a bridge change:

```js
ipcMain.handle('models:chat', async (_e, { messages, model, taskType, user, stream = false,
                                           requireAttribution = false, sources = [], reflexes = {} } = {}) => {
```

**And the renderer half of that wire is named exactly, because the first revision named the
wrong file.** §14 claimed `Models.jsx` includes `user` at the `models.chat` call site.
`Models.jsx` has no such call site. **The only `models.chat` caller in the tree is
`src/services/ramaClient.js:23`** (§1.12 fact 2), so without changing that file the
thread-through is inert and every cloud chat returns `gateError`. Three one-line changes,
and **no caller lacks a user**:

```js
// src/services/ramaClient.js — ramaChat.send gains `user` and forwards it.
send: async ({ messages, provider, model, sessionId, taskType, user }) => {
  …
  const res = await window.rama.models.chat({ messages, model,
                                              taskType: taskType || 'general', user });
```

| Caller | Has a user in scope? | Change |
|---|---|---|
| `src/pages/Chat/Chat.jsx:219` | **yes** — `const { currentUser } = useUserStore()` at L149, already passed to `resolveReflex` and `getSystemPromptAsync` | add `user: currentUser` to the `ramaChat.send({…})` object |
| `src/pages/IDE/IDE.jsx:253` | **yes** — same hook at L183, already passed to `window.rama.sandbox.*` at L276 for this very reason | add `user: currentUser` to the `ramaChat.send({…})` call |

Both already hold the same value `window.rama.vault.set(currentUser, …)` is given, so there
is **no missing wire-up to discover later** — which is why it is tabulated rather than
described. `ramaChat.send`'s HTTP dev-mode fallback is unchanged: it has no vault access and
therefore no cloud path. §12(g3) asserts structurally that `ramaClient.js`'s `models.chat`
call includes `user` — the cheapest possible guard on the one wire that decides whether the
gate runs at all.

**§3.4(b) The fallback chain distinguishes "not configured" from "failed".** `unconfigured` is
not a failure of a model, so it is neither logged as one nor collapsed into one:

```js
try {
  return gated(await chatCompletion(messages, targetModel, user));
} catch (err) {
  const unconfigured = [];
  const failures = [];
  const note = (id, e) => (e.unconfigured
    ? unconfigured.push({ model: id, reason: e.message, remedy: e.remedy })
    : failures.push({ model: id, reason: e.message }));
  note(targetModel, err);
  if (!err.unconfigured) console.warn(`[models] ${targetModel} failed: ${err.message}`);

  for (const fallback of FALLBACK_CHAIN) {
    if (fallback === targetModel) continue;
    if (!checkAvailable(fallback))  continue;
    try {
      const result = await chatCompletion(messages, fallback, user);
      // The substitution is DECLARED, and so is its cause. Today the renderer gets
      // `fallbackFrom` with no statement that a credential was missing.
      return gated(result, { model: fallback, fallbackFrom: targetModel, unconfigured });
    } catch (e) {
      note(fallback, e);
      if (!e.unconfigured) console.warn(`[models] ${fallback} failed: ${e.message}`);
    }
  }

  // ABSENT is not BROKEN. If nothing failed and nothing was configured, say exactly that,
  // with the one remedy that works — never 'All models failed'.
  if (unconfigured.length && !failures.length) {
    return { ok: false, unconfigured, error: unconfigured[0].reason,
             remedy: unconfigured[0].remedy };
  }
  return { ok: false, error: `All models failed. Last error: ${err.message}`,
           unconfigured, failures };
}
```

`chatCompletion(messages, modelId, user)` gains a third parameter, defaulting
`undefined`, passed only to `ollamaCloudChat`. Every other provider function is untouched,
and a caller that omits it gets §2.5 step 0's `gateError` rather than a silent cloud call —
which is the right way round.

**§3.4(c) Cloud rows become reachable at all.** This is the correction that decides whether the
feature works on the machine it exists for. `selectModel`'s four passes cannot return a
cloud id (§1.11 fact 3), and `FALLBACK_CHAIN` has no cloud entry, so a `models:chat` with no
explicit `model` resolves to `'gpt-4o'` on a machine with no OpenAI key and dies in the
chain. One pass is appended — **after** the `discoveredOllama` pass and **before**
`return primaryModel`:

```js
  // LAST RESORT, deliberately: a local pull still wins, because the free cloud tier allows
  // one concurrent request and spends master's allowance. Largest-first within the cloud
  // rows, because paramsB is the only quality signal this path has. This does NOT feed the
  // role engine — that is row 150's work and §3.3's gate is asserted ahead of it.
  const cloud = Object.entries(allModels())
    .filter(([id, m]) => m.provider === 'ollama-cloud'
                      && caps.some(c => m.caps.includes(c))
                      && checkAvailable(id))
    .sort((a, b) => (b[1].paramsB ?? 0) - (a[1].paramsB ?? 0));
  if (cloud.length) return cloud[0][0];

  return primaryModel;
```

`checkAvailable` already returns `!!getCredential('OLLAMA_API_KEY')` for these rows, so the
pass is inert when no key is stored and inert when the vault is locked — which is correct:
an unreachable model must not be *selected*. §12(e) asserts both directions of that.

`ollamaChat`'s hardcoded `httpPost('localhost', 11434, …)` is **left exactly as it is.**
Pointing it at `ollamaBaseUrl` would be a tidy-up, and tidying the one function that must
keep working while a new path is proven is how an additive change stops being additive.
Recorded as follow-up work in §14, not done here.

---

## 4. The name divergence — mapping table and both-direction assertions

### 4.1 The hazard, stated precisely

Two naming schemes exist for the same weights:

- **direct keyed API** (`https://ollama.com/api`) takes the **cloud-list** name, e.g.
  `gemma4:31b`;
- **the local daemon / CLI / app** takes a `-cloud`-suffixed tag, e.g. `gemma4:31b-cloud`
  or `gemma4:cloud`.

Both failure directions are silent-ish and both are bad:

- `gemma4:31b-cloud` sent to the keyed API → a model-not-found error at best. Recoverable
  but opaque, and it looks like an outage rather than a naming bug.
- `gemma4:31b` sent to the **daemon** → **worse.** `gemma4:31b` is also a plausible *local
  pull* tag, so on a machine with a daemon this can resolve to a local model, or trigger a
  31 B download, instead of a cloud call. A request master believes went to the cloud runs
  locally, or stalls on a multi-gigabyte pull. **That is the silent one**, and it is why §2.5
  step 1 is a pre-flight refusal rather than a log line.

### 4.2 The table

`CLOUD_TAGS` is `Object.freeze`d in `ollamaCloud.cjs`. **The two name columns have different
provenance and the preamble must say which, because one is attested and the other is not:
`daemonTag` is ATTESTED** from `docs/research/OLLAMA_ONLY.md` §D.3–§D.5, which probed the
free tier and ran the real `paramsB()` over every tag; **`apiModel` is INFERRED by §4.3's
rule for every row except `gemma4:31b`**, the only cloud-list name this project has on
record (see §11.5). Seeded with the free-accessible, **sized** tags plus the two unsized
rows most likely to be asked for, because an unsized row must still map correctly even
though it cannot clear a floor:

| `apiModel` (keyed API — **inferred**, except row 1) | `daemonTag` (daemon/CLI — attested) | family | `paramsB()` | sized | free-tier usage |
|---|---|---|---|---|---|
| `gemma4:31b` | `gemma4:31b-cloud` | gemma4 | **31** | yes | low |
| `gemma4` | `gemma4:cloud` | gemma4 | `null` | no | low |
| `gpt-oss:120b` | `gpt-oss:120b-cloud` | gpt-oss | 120 | yes | medium |
| `gpt-oss:20b` | `gpt-oss:20b-cloud` | gpt-oss | 20 | yes | low |
| `ministral-3:14b` | `ministral-3:14b-cloud` | ministral-3 | **14** | yes | low |
| `ministral-3:8b` | `ministral-3:8b-cloud` | ministral-3 | 8 | yes | low |
| `ministral-3:3b` | `ministral-3:3b-cloud` | ministral-3 | 3 | yes | low |
| `nemotron-3-nano:30b` | `nemotron-3-nano:30b-cloud` | nemotron-3-nano | 30 | yes | low |
| `qwen3-coder:480b` | `qwen3-coder:480b-cloud` | qwen3-coder | 480 | yes | high |
| `qwen3-vl:235b` | `qwen3-vl:235b-cloud` | qwen3-vl | 235 | yes | high |
| `qwen3-next:80b` | `qwen3-next:80b-cloud` | qwen3-next | 80 | yes | medium |
| `devstral-2:123b` | `devstral-2:123b-cloud` | devstral-2 | 123 | yes | high |
| `devstral-small-2:24b` | `devstral-small-2:24b-cloud` | devstral-small-2 | 24 | yes | low |
| `nemotron-3-super` | `nemotron-3-super:cloud` | nemotron-3-super | `null` | no | medium |

Each row also carries `caps` (`code` / `vision` / `analysis` from OLLAMA_ONLY.md §D.3's
tools/vision/thinking columns) and `usage`.

**The table is authoritative. `apiNameFor` / `daemonTagFor` return `null` for anything not
in it** — never a derived guess, because the reverse direction is where a guess becomes a
local 480 B download.

### 4.3 The derivation rule is asserted *against* the table, not used instead of it

A rule does exist: strip a trailing `-cloud` from the tag, and if the tag is exactly
`cloud`, drop the colon and the tag entirely. `gemma4:31b-cloud → gemma4:31b`;
`nemotron-3-super:cloud → nemotron-3-super`.

It is used in exactly one place — **a test** — asserting that every row satisfies it. That
catches a typo in a hand-written row without letting the rule decide anything at runtime.
Rule-as-truth was rejected because the reverse direction cannot be derived safely: from
`gemma4:31b` the rule produces `gemma4:31b-cloud`, which is correct, but the rule has no way
to know that `gemma4:31b` is *also* a valid local pull tag. Only a table knows that.

### 4.4 Preserving the sized-tag advantage, with one correction to the brief's premise

`ollamaCatalog.paramsB()`'s regex is anchored at the start and not the end, so **both**
`gemma4:31b` and `gemma4:31b-cloud` parse to `31`. The brief's claim that the direct-API
name is *strictly* better for the role engine is therefore **slightly too strong, and the
design consequence is unchanged** — stated here because the next session will read the code
and should not think the document is wrong:

- where a family has a sized cloud tag, **both** paths parse and both clear a floor;
- where it does not (`gemma4:cloud` → `gemma4`), **neither** parses — `paramsB('gemma4')`
  is `null` because there is no `:` at all;
- so the honest statement is **never worse, and the sized rows are what make `declared`
  reachable.** `gemma4:31b` → `31` → clears `reasoning`'s 14 B floor → `fit: 'declared'`.

`toRegistryEntries()` therefore populates `paramsB` by calling the real
`ollamaCatalog.paramsB(apiModel)` rather than copying the number from the table, so the
registry can never disagree with the function that judges it. The table's `paramsB` column
exists to be **asserted against** that call (§12), same discipline as §4.3.

### 4.5 The assertions, both directions

1. `apiNameFor(row.daemonTag) === row.apiModel` for every row.
2. `daemonTagFor(row.apiModel) === row.daemonTag` for every row.
3. Round trip: `daemonTagFor(apiNameFor(t)) === t`, and `apiNameFor(daemonTagFor(a)) === a`.
4. `apiNameFor('no-such-model:cloud') === null`; `daemonTagFor('no-such-model') === null`.
5. No `apiModel` in the table contains `cloud`; every `daemonTag` ends `-cloud` or `:cloud`.
6. `ollamaCatalog.paramsB(row.apiModel) === row.paramsB` for every row (incl. the `null`s).
7. `paramsB('gemma4:31b') === 31` **and** `paramsB('gemma4:31b-cloud') === 31` **and**
   `paramsB('gemma4') === null` — the mechanism itself, pinned.
8. `chat({ apiModel: 'gemma4:31b-cloud' })` **refuses before any request is made**, with a
   reason naming the daemon tag, and the stub HTTP client records **zero** calls. The
   zero-calls part is the assertion that matters; a refusal after the bytes have left is not
   a refusal.
9. `chat({ apiModel: 'gemma4:cloud' })` refuses likewise (the `:cloud` form, not just
   `-cloud`).
10. Every `apiModel` in `CLOUD_TAGS` appears as an `ollama-cloud/<apiModel>` key in
    `toRegistryEntries()`, and no registry id contains `-cloud`.
11. **`isApiName`, which is exported and therefore must be specified:**
    `isApiName(row.apiModel) === true` for every row; `isApiName('no-such-model')` and
    `isApiName('__proto__')` are both `false` (the `hasOwnProperty` guard, same discipline
    as §6.4); `isApiName(row.daemonTag) === false` for every row, so the two predicates
    partition the names rather than overlapping.

---

## 5. Hosted web search — assessment and decision

### 5.1 Assessment

**The existing capability is nominally present and practically dark on master's machine.**
`web.search` → `browser:search` → `if (!playwright) return { ok: false, error: 'playwright
not installed' }`. `playwright` is optional in `start.cjs`'s module table; `node_modules` is
not installed in this workspace at all; and master's 16 GB machine is the one that has no
Ollama either. `intelligenceEngine.cjs` has an HTTP-only DDG path, but that file belongs to
another workflow and `browserEngine.cjs`'s own header records that DuckDuckGo serves
automation a 305-byte empty shell.

Ollama's hosted web search is keyed on the **same credential** this design already wires,
needs **no Playwright and no daemon**, and is one `net.request` away once §2 exists.

Against it: it spends the same free credit pool as inference, and it is a cloud egress of a
query string. The second is the serious one — a search query is the most natural place for
master's private context to be smuggled off the machine, because a query is *supposed* to
contain whatever the user is curious about.

**And the capability is dark for a second reason the first draft missed, which changes what
this tranche can honestly claim: nothing in the tree invokes `browser:search` at all.**
Verified: `browserEngine.cjs:193` registers it, `preload.cjs:874` binds it,
`ramaCore.js:274` *plans* a step naming `browser.search`, and `ramaCore.js:326` declares
`web.search` in `TOOL_REGISTRY` — **no renderer code calls the bridge.** There is no tool
executor mapping `TOOL_REGISTRY` entries onto IPC. So `web.search` is dark because the
backend may be missing *and* because no caller exists.

**Stated plainly, because it decides what §5.2 may claim: this tranche builds the backend
ahead of its caller.** No consumer is wired here — writing a tool executor is a different
piece of work with a different blast radius, and §5.2's three-step order has nobody to
report to until it exists. **The first observable behaviour of hosted search is a
`verifyOllamaCloud.cjs` assertion, not a working search in the UI.** That is an acceptable
thing to build (the credential, the gate and the admission row are all shared with chat, so
the marginal cost is small and the leak surface is reviewed now rather than later) but it is
not the same as "a dark capability becomes a working one", which is what the first draft
said and is not true.

### 5.2 Decision: wire the backend, behind the same credential, with its own admission row

**Decided: wire it** — as a backend, with the caller named as follow-up. It costs no new
dependency, it reuses the transport, the credential and the payload gate this design builds
anyway, and it is the only search backend that can work on master's target machine. It is
**additive**: `browser:search` is not modified, not deprecated and not removed.

**The classification gate runs ONCE, ABOVE backend selection, and a refusal is terminal.**
This is the round-2 correction, and it is the most serious one in the document. The first
revision ran §5.3's gate inside `ollamaCloud.webSearch()` and then placed the Playwright
path **directly beneath it as a fallback** — so a query refused as `private` for ollama.com
fell through to `browser:search`, which sends it to
`https://www.bing.com/search?q=…` (`browserEngine.cjs` L205–L208). **The brief's rule was
satisfied for one egress and broken by the line underneath it.** `bing.com` is not less of
a network than `ollama.com`, and §5.3's own argument — the transport is the one place bytes
leave the machine — applies to both and was implemented for one. (That reasoning is also
why the module is named `egressBoundary.cjs` and not `cloudBoundary.cjs`: **"egress" means
off this machine, not "ollama.com"**, and a name read as a scope limit is how the next
session re-opens this.)

```js
// models:search-web — classification is decided ONCE, for EVERY backend, because bing.com
// is no less of an egress than ollama.com. A refusal ENDS the request; it never falls
// through to a different way of sending the same bytes.
const gate = egressBoundary.assemble({ kind: 'search', query, maxResults });
if (!gate.ok) return { ok: false, refused: true, level: gate.level, reason: gate.reason };
for (const backend of order) { … }   // every backend receives an ALREADY-CLEARED payload
```

Backend order **inside the new handler**, each step reporting which one answered (and, until
a tool executor exists, reporting it to a test):

1. `ollamaCloud.webSearch()` — if and only if the credential is PRESENT;
2. the existing Playwright path, via **`browserEngine.searchWeb(query, engine)`**;
3. explicit absence — *"no search backend is available"*, with the remedy for each.

Ordering cloud first is a measured choice, not a preference: on the target machine step 2
cannot run. Where Playwright **is** installed, master may pin the order via
`config.searchBackendOrder`; the default stays cloud-first because it is the one that works
everywhere the key is present.

**Step 2 required a six-line change to `browserEngine.cjs`, because as written it was not
implementable.** The first revision said the Playwright path is *"invoked through
`browserEngine`'s handler"*. It cannot be: the logic is a closure inside `register(ipcMain)`
over module-scoped `browser`/`browserCtx`, the signature is positional `(_e, query, engine)`,
`module.exports` is `{ register, closeBrowser, getBrowserPid }`, and **an `ipcMain` handler
cannot be called from main-process code** (§1.12 fact 3). Two options:

- **(a) extract and export**, so there is one implementation of the search logic;
- **(b) drop step 2** from this tranche, leaving `models:search-web` cloud-or-absent.

**Chosen: (a).** Option (b) is the smaller diff, but it would leave the Playwright egress
reachable only through `browser:search` — i.e. reachable, and **outside** the gate that was
just built to cover it, which is finding 5 re-opened by a different route. Extract-and-export
is a pure refactor with no behaviour change and it puts both egresses behind one gate:

```js
// browserEngine.cjs — the handler body becomes a named function so main-process callers
// (models:search-web) and the IPC surface share ONE implementation. No behaviour change:
// the first line is still the playwright absence check.
async function searchWeb(query, engine = 'bing') { /* the current L193-L260 body */ }
ipcMain.handle('browser:search', async (_e, query, engine = 'bing') => searchWeb(query, engine));
module.exports = { register, closeBrowser, getBrowserPid, searchWeb };
```

`searchWeb` is declared at module scope but **closes over the same module-scoped
`browser`/`browserCtx` the handler does**, so `launchChosen`/`touchBrowser` behave
identically; the extraction moves no state. §12(j) asserts `browser:search` still returns
`{ ok: false, error: 'playwright not installed' }` when `playwright` is absent — the one
behaviour an extraction could plausibly break.

**One honest limit, stated rather than papered over: `browser:search`'s own direct IPC path
stays unclassified.** It is pre-existing, it is gated on `browser.search` (tier 3), it has
**no caller in the tree**, and this tranche does not modify it. Routing it through the gate
means routing it through `models:search-web`, which is the tool-executor follow-up's job
(§14). So the accurate claim is: **every egress `models:search-web` can reach is gated; the
legacy direct channel is not, and is named here so it is a listed item rather than a later
discovery.**

**It gets its own `API_RATE_LIMITS` row** — `ollama-search` — rather than sharing
`ollama-cloud`. A page of search traffic must not be able to consume the single concurrent
slot that inference needs, and separating them is the only way `getStatus()` can tell master
which one spent his allowance.

**The handler is `models:search-web`, not `search:web`.** `electron/genome.cjs:77` declares
`g.model-router` with `channels: ['models:']`, so a `search:web` handler inside
`modelRouter.cjs` would be a channel its own gene does not describe — Rāma's self-model
would stop matching its IPC surface, and `auditRenderer.cjs` only checks invoke↔handle
parity, so **nothing would turn red** (which is exactly why it is written down rather than
discovered later). Two options: rename the channel, or edit `genome.cjs` to
`channels: ['models:', 'search:']`. **Chosen: rename.** It stays inside the declared prefix,
needs no genome edit, and tells the truth — the handler lives in `modelRouter` because that
is where the credential surface lives. `preload.cjs`'s binding is
`models.searchWeb(opts)` → `ipcRenderer.invoke('models:search-web', opts)`, matching the
channel name.

Gated on **`browser.search`** — the capability the tool already declares (tier 3) — and, as
a cloud call, also on §2.5 step 0's cloud capability inside `webSearch()` itself. No new
capability key is invented for a capability that already exists; see §13 for the one that is
*specified* rather than assumed.

### 5.3 The payload gate — `electron/lib/egressBoundary.cjs` (new)

Spec Section 130.8 is the binding requirement here. Quoted **verbatim**, and nothing added
inside the quotation marks (the first draft's blockquote mixed the spec's words with this
design's inference, which would have sent a later session grepping the spec for a phrase
that is not in it — review #11):

> *"a join can assemble a context payload that no single row looks sensitive enough to
> block. Row-level classification is necessary and not sufficient, so the design must name
> the chokepoint where an outbound payload is assembled and show that a classified row
> cannot pass it **even when it arrives via a join**."* — Section 130.8

**This design's reading of that requirement, in its own voice:** the chokepoint is the
**transport**, and enforcement is on the **PAYLOAD**, not on the role name. That inference
is this document's, not Section 130.8's wording.

**Why the transport owns it.** Not the role engine — `modelRoles` only ever sees a model,
never a payload, so it cannot see a join. Not the caller —
callers are refactored, and there will be more of them. The transport is the one place bytes
leave the machine, so it is the only place where "nothing classified private crosses this
line" can be *true* rather than *currently true*.

Contract:

```js
// classification lattice, lowest first. Reuses Section 127's intent; does NOT invent a
// second provenance vocabulary (claimGate's grounded/reflex/prose/unattributed describes
// how a claim was DERIVED, which is a different question from who it is ABOUT).
const LEVELS = Object.freeze(['public', 'internal', 'private']);

// assemble() owns the WHOLE envelope, not just the classified parts of it, because §12(g)
// forbids any other body construction in the cloud path. The first revision gave it only
// { messages, parts } — so `model`, `stream` and the search `query` had nowhere to come
// from, and NEITHER REQUEST COULD BE MADE. Widening the call site was not an option; the
// structural assertion is the point. So the envelope moved in here.
assemble({
  kind,                 // 'chat' | 'search' — REQUIRED; anything else refuses
  messages   = null,    // chat only
  parts      = null,    // chat only
  query      = null,    // search only: { text, classification } — no bare string (§5.3)
  model      = null,    // chat only: the apiModel, already name-checked by §2.5 step 1
  stream     = false,
  options    = null,    // { think, format } — ENUMERATED; an unknown key refuses
  maxResults = 5,
  allowInternal = false,
})
  // → { ok: true,  body, maxLevel, counts: { messages, parts } }
  // → { ok: false, refused: true, level, reason, where: 'messages'|'parts'|'query'|'envelope', index }
```

**`kind: 'chat'` with no `model` REFUSES** (§8 row 4b, §9's `model` row): a `/api/chat` body
with no model is a request that cannot succeed, and sending it would spend a slot and an
allowance to be told so. `kind: 'search'` with a `model` refuses too — a field that cannot
apply is a field somebody mis-wired.

**`options` is enumerated, never spread.** `think` must be a boolean; `format` must be
`null` or `'json'`; **any other key, or any other `format` value, refuses rather than being
passed through**. A passthrough of unknown keys into an outbound body is an unreviewed
egress surface with extra steps.

**`messages` is classified too, and that is the correction that makes this gate real.** The
first draft wrote every rule about `parts` and pinned `messages[].content` to a plain
string — so the one field that actually carries the prompt crossed the boundary
unclassified, `maxLevel` was computed over an empty `parts` array and resolved to `'public'`,
and the claim that nothing private can cross was false for the primary payload. Every
existing caller of `models:chat` puts its text in `messages`, and a context store's
retrieved rows would land there too.

Rules:

1. **A bare primitive string is `'public'`** — whether it appears as a `part` or as a
   message's `content`. That is what today's callers pass, and refusing them would be a
   capability regression on day one.
2. **An OBJECT must carry an explicit `classification` in `LEVELS`.** `{ text: 'x' }` with
   the field **absent**, `undefined`, `null` or `''` is **REFUSED**, with the same reason
   string as an unrecognised value. Choosing the object shape is choosing to classify;
   forgetting to is not a default. (The first draft left this case unspecified, and it is
   precisely the shape a half-migrated caller produces — review #12.)
3. **A message's `content` may be either form:** a bare string (→ `'public'`) or
   `{ text, classification }`. Any other shape — a number, an array, a nested object with no
   `text` — is **refused**, so nothing slips through unclassified by being the wrong type.
4. `classification: 'private'` → **always refused**, no option, no override. Master's
   holdings, recorded prompts and anything a future context store marks private cannot reach
   a cloud endpoint through this module.
5. `classification: 'internal'` → refused unless the caller passes `allowInternal: true`
   **and** `config.allowInternalToCloud === true`. Default `false`. Two independent switches,
   because one switch gets flipped by a default.
6. An unrecognised classification value → **refused** (not coerced to `public`). A typo must
   fail closed.
7. Refusal is **fatal for that request** and returns a named reason plus `where` and
   `index`, so a caller can find the offending element. It is never a downgrade to a
   different model and never a truncation of the payload — a silently shortened prompt is a
   wrong answer dressed as a right one.

**How an accepted `part` reaches the body — stated, because `/api/chat` has no `parts`
field and an unstated rule here means the parts either vanish or get spliced into master's
words by whatever the implementer invents.** Rule 7 forbids a silently shortened payload,
and a dropped part is exactly that:

```js
// Each accepted part becomes its OWN system message, appended AFTER the caller's messages,
// in the order given — so a context store's rows arrive AS CONTEXT rather than being
// spliced into master's words. Nothing is dropped and nothing is truncated; if a part
// cannot be represented as text, assemble() REFUSES.
body.messages = [...normalisedMessages,
                 ...acceptedParts.map(p => ({ role: 'system', content: textOf(p) }))];
```

§12(g) asserts `counts.parts` equals the number of appended `system` messages, so a dropped
part fails the suite rather than producing a confidently wrong answer from a shortened
prompt. Appending **after** rather than prepending is deliberate: a `system` message placed
before master's turn competes with the real system prompt, while one placed after reads as
supplied context, which is what it is.

**The join problem.** Row-level classification is necessary and not sufficient:
**`maxLevel` is computed across `messages` AND `parts` together**, so a payload assembled
from fifty `public` rows and one `private` row refuses as a whole, wherever the private one
sits. The gate is on the assembled payload, which is the only level at which a join is
visible. §12(g)'s join assertion plants the `private` row **inside `messages`**, because
that is the path callers actually use.

**Honest degradation today.** No context store exists (Section 130.10: *"Nothing is
built"*). So today every part arrives as a bare string and resolves to `public`, and the
gate is a pass-through — **except** that it is now the only constructor of a cloud body,
and §12 asserts there is no second one. That assertion is the whole value of building it
now: when row 150's store lands, its read path has a gate to plug into instead of a gate to
retrofit, and the retrofit is the failure mode Section 127 names
(*"it is a refactor months later that nobody notices"*).

**For search, the query must be classified — there is no bare-string allowance.** Rule 1
exists to protect existing callers, and §5.1 names the search query as the single most
likely route for private context to leave the machine. Both cannot hold at once: a bare
query string would resolve to `'public'` and **every** query would pass, including one
assembled from master's holdings, which would make the gate decorative against the risk
§5.1 itself names (review #13). Search has **no legacy callers at all** (§5.1: nothing
invokes the bridge), and a query is one short field, so the migration cost of requiring
classification is zero:

```js
// The one cloud call with no bare-string allowance, for the reason §5.1 gives.
webSearch({ query, maxResults, user })
// query: { text: string, classification: 'public' | 'internal' }
// a bare string → refused: 'a search query must be classified'
// classification 'private' → refused, as everywhere else
```

The brief's requirement — *do not let a web-search call become a route by which master's
private context leaves the machine* — is met three ways:

1. **`webSearch()` has no body-construction path of its own.** It calls
   `egressBoundary.assemble({ kind: 'search', query, maxResults })` and uses the returned
   body verbatim; §12(g) asserts this by stubbing `egressBoundary` and requiring it to have
   been called **before** the HTTP stub was.
2. **Its input cannot be unclassified** — a bare string is refused with zero HTTP calls.
3. **`models:search-web` runs the same gate once, above backend selection** (§5.2), so the
   refusal is terminal for **every** backend rather than for the cloud one only. §12(g)
   asserts a `private` query and a bare-string query each leave **both** the HTTP stub
   **and** the Playwright stub with **zero** calls. Running the gate twice — in the handler
   and again inside `webSearch()` — is deliberate redundancy, not an oversight: the handler
   gate is what covers Bing, and the transport gate is what covers a second entry point
   added later.

---

## 6. Rate limits — correcting the shape, and making a missing entry refuse

### 6.1 What is wrong today

`ollama: { reqPerMin: 9999, tokPerMin: 9999999 }` is right for a local daemon and wrong for
a free cloud plan. OLLAMA_ONLY.md §F.3 already diagnosed both halves: there is no separate
cloud row, and **the shape cannot express the actual limit** — the free constraint is *one
concurrent request* plus a *monthly credit pool*, and `API_RATE_LIMITS` carries only
per-minute counters on a 60-second reset.

### 6.2 The corrected rows

```js
const API_RATE_LIMITS = {
  openai:    { reqPerMin: 500,  tokPerMin: 200000,  maxConcurrent: 8, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  anthropic: { reqPerMin: 60,   tokPerMin: 100000,  maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  gemini:    { reqPerMin: 60,   tokPerMin: 1000000, maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  groq:      { reqPerMin: 30,   tokPerMin: 14400,   maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
  mistral:   { reqPerMin: 60,   tokPerMin: 100000,  maxConcurrent: 4, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },

  // A LOCAL daemon: unmetered, bounded only by the machine, which admit() already governs.
  ollama:    { reqPerMin: 9999, tokPerMin: 9999999, maxConcurrent: 2, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },

  // KEYED CLOUD, FREE TIER. The binding constraint is ONE CONCURRENT REQUEST, not a rate.
  // reqPerMin is a courtesy ceiling so a loop cannot queue a thousand requests behind the
  // one slot; the slot is what is actually enforced. tokPerMin is deliberately null — a
  // per-minute token budget is not a thing Ollama publishes, and inventing one would be a
  // fabricated limit presented as a measurement.
  'ollama-cloud':  { reqPerMin: 20, tokPerMin: null, maxConcurrent: 1, inFlight: 0,
                     usedReq: 0, usedTok: 0, resetAt: 0,
                     monthlyTokenBudget: null, usedTokMonth: 0, monthStartedAt: null,
                     note: 'free tier: one concurrent request; monthly credit pool is not exposed to the API' },

  // Hosted web search shares the credential, NOT the inference slot.
  'ollama-search': { reqPerMin: 10, tokPerMin: null, maxConcurrent: 1, inFlight: 0,
                     usedReq: 0, usedTok: 0, resetAt: 0 },

  // Master-registered OpenAI-compatible providers. Conservative, because their real limits
  // are unknown. Present so that §6.4's refuse-by-default cannot break a shipped capability.
  custom:    { reqPerMin: 20, tokPerMin: null, maxConcurrent: 2, inFlight: 0, usedReq: 0, usedTok: 0, resetAt: 0 },
};
```

`tokPerMin: null` must not read as zero. `_canRun`'s token test becomes
`if (Number.isFinite(limit.tokPerMin) && limit.usedTok >= limit.tokPerMin * BUFFER) return false`
— an unknown budget is **unchecked**, never failed and never cleared, the same `num()`
discipline `modelRoles.cjs` already applies to an unknown parameter count.

`maxConcurrent: 1` with `RATE_LIMIT_BUFFER` **not** applied: `Math.round(1 * 0.8) === 1`
would be a coincidence, and `Math.floor` would be 0 and deadlock. Concurrency is a slot
count, so it is compared exactly — one of the reasons it cannot live in the per-minute
fields. **The buffer *is* applied to `reqPerMin`**, which is compared as
`limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER` (0.8), so the real courtesy ceiling
is **16 requests per minute, not 20** (review #23). Stated because the number in the table
is not the number enforced, and the next session should not have to re-derive it.

### 6.3 Concurrency and monthly accounting, inside the one authority (I10)

Three additions to `resourceOrchestrator.cjs`, all additive. **All three are METHODS on
`ResourceOrchestrator`, not module-level functions** — the first revision wrote them as bare
functions in one place and called them as `orchestrator.X(…)` in another. Methods is the
correct answer and not an arbitrary one: `API_RATE_LIMITS` holds the live counters, `admit`
is already an instance method called as `orchestrator.admit({…})` at all three existing
sites, and **I10's monopoly is on the instance that owns the counters.** `ollamaCloud`
obtains them as `require('../resourceOrchestrator.cjs').orchestrator` unless injected
(§2.2's `useOrchestrator`).

- **`reserveSlot(provider, { priority, waitMs = 20000 })` / `releaseSlot(provider)`.**
  `reserveSlot` returns `{ ok: true }` and increments `inFlight` when
  `inFlight < maxConcurrent`, or `{ ok: false, deferred: true, reason: 'ollama-cloud is at
  its 1-request concurrency limit' }`. `releaseSlot` decrements with a `Math.max(0, …)`
  floor so a double-release cannot create free capacity, and emits a `slot:released` event
  that waiters listen for. Called by `ollamaCloud` in a `try/finally` — the `finally` is
  mandatory, because a leaked slot on a `maxConcurrent: 1` row is a permanent outage.

  **`PRIORITY.CRITICAL` WAITS for the slot; it does not bypass it.** The first revision had
  a real contradiction here: `admit` returns at L395 on `CRITICAL` before any other check,
  so the asserted bypass was true of `admit` — but `reserveSlot` had no priority argument
  and no bypass, so a critical cloud request was still refused `deferred: true` whenever the
  single slot was busy, and §12(i) asserted the principle rather than the behaviour. Two
  resolutions were available: make `reserveSlot` bypass, or make it wait. **Chosen: wait**,
  bounded, because *one concurrent request is a physical limit of the free tier* — bypassing
  it does not produce a faster answer for master, it produces a 429 and spends an attempt.
  Waiting honours "loyalty outranks throttling" in the only way the endpoint permits:

  ```js
  // CRITICAL is master's work, so it does not get REFUSED for a busy slot — it QUEUES at
  // the head and takes the slot the instant it frees. Bounded, because an unbounded await
  // on a leaked slot is an invisible hang, which is worse than an honest refusal.
  if (priority === PRIORITY.CRITICAL) {
    const got = await this._awaitSlot(provider, waitMs);   // resolves on 'slot:released'
    if (!got) return { ok: false, deferred: true, timedOut: true,
                       reason: `${provider}'s single slot did not free within ${waitMs}ms` };
    return { ok: true, waited: true };
  }
  ```

  The bounded wait is §8 row 7b. Non-critical priorities do **not** wait: they are refused
  immediately with `deferred: true`, because a queue of waiters on a one-slot row is a
  latency trap that looks like a hang.
- **`admit({ aiProvider })` — and WHICH FIELDS it consults, written out, because "it
  consults the row" is not a design decision.** `admit`'s destructure gains
  `aiProvider = null`; when set, the block runs **after** the existing RAM/CPU/thermal
  checks and immediately before `return { allow: true, reason: 'ok', … }`:

  ```js
  // admit(), after the thermal check. This is the ONLY place the cloud path is metered,
  // because §2.5 calls admit() then reserveSlot() and never touches TaskQueue._canRun or
  // selectOptimalModel — so a ceiling asserted against those two is a ceiling that is not
  // enforced on the one path that spends master's allowance.
  if (aiProvider) {
    const limit = Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, aiProvider)
      ? API_RATE_LIMITS[aiProvider] : null;
    if (!limit) return { allow: false, snapshot: snap,
      reason: `no rate-limit row for provider "${aiProvider}" — it cannot be metered` };
    const now = Date.now();
    if (now > limit.resetAt) { limit.usedReq = 0; limit.usedTok = 0; limit.resetAt = now + 60000; }
    const ceiling = Math.floor(limit.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER);
    if (limit.usedReq >= ceiling) return { allow: false, snapshot: snap,
      reason: `${aiProvider} is at its ${ceiling}/min courtesy ceiling` };
    if (limit.inFlight >= limit.maxConcurrent) return { allow: false, snapshot: snap,
      reason: `${aiProvider} is at its ${limit.maxConcurrent}-request concurrency limit` };
  }
  ```

  Three named reasons, not one. Default `null` → byte-identical behaviour for the **three
  existing call sites in three modules** (`agentOrchestrator.cjs:281`,
  `instanceManager.cjs:312`, `sandboxEngine.cjs:242`; `resourceResearchEngine.cjs` only
  mentions `admit()` in a comment), which is what keeps this additive. **This is what puts
  the cloud call under I10 at all; today it would be under nothing** (§1.5 finding 3). The
  `CRITICAL` bypass at L395 is **not** widened or moved — it still returns before this
  block, which is correct for a rate ceiling and is why concurrency is handled by
  `reserveSlot`'s bounded wait instead.
- **`recordApiUse(provider, tokens)`** — a method wrapping what
  `orchestrator:record-api-use` already does, with the same `hasOwnProperty` guard, plus
  `usedTokMonth += tokens` and a rollover when `monthStartedAt` is more than one calendar
  month old, persisted to `dataStore.config.ollamaCloudUsage` so it survives a restart. The
  IPC handler at L508 is rewritten to call it so there is **one** implementation.

**On the monthly pool, stated plainly rather than modelled:** `monthlyTokenBudget` stays
`null`. Ollama meters free usage in credits that reset monthly from master's signup date,
and OLLAMA_ONLY.md §D.2 records that a free account gets **no proactive warning** (the 90 %
email is paid-plans-only) and that behaviour at zero credits is **unverified**. Rāma does
not know the signup date and cannot read the remaining balance. So `usedTokMonth` is
reported as **"what Rāma has spent, as counted here"** and never as **"what remains"**, and
`status()` carries `monthlyBudget: null, monthlyBudgetKnown: false`. A guessed budget would
be exactly the invented number Section 126 exists to prevent.

### 6.4 A missing provider entry must refuse

`_canRun` L140–L148 becomes:

```js
if (task.aiProvider) {
  // hasOwnProperty, not a bracket read — `'__proto__'` resolves through the prototype
  // chain on a plain object literal and would return an object that is not a row.
  const limit = Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, task.aiProvider)
    ? API_RATE_LIMITS[task.aiProvider] : null;
  // A provider with no declared limit is REFUSED, not waved through. An unknown budget is
  // not an unlimited one, and the old `if (limit)` with no else admitted an unregistered
  // provider's traffic unmetered. §12's assertion that every shipped provider HAS a row is
  // what makes refusing here safe rather than a capability regression.
  if (!limit) return false;
  …
  if (limit.inFlight >= limit.maxConcurrent) return false;
}
```

`selectOptimalModel` L358–L370: the `else { return … 'no-rate-limit' }` branch becomes
`else continue;` — a model whose provider has no row is skipped rather than *selected*.

### 6.4b …and `_canRun` is the wrong place to be the ONLY refusal

`_canRun` returning `false` means **"not this tick"**, not "this task is impossible":
`dequeue` simply never selects the task, and it renders as `queued` forever with no reason.
That is acceptable for a rate ceiling, which clears in a minute, and **wrong for a provider
that does not exist** — and `aiProvider` is not an internal enum. It is **free text from the
UI**: `src/pages/Resources/Resources.jsx:155` is an `<input placeholder="AI provider
(optional: openai, anthropic, groq, ollama...)">` submitted verbatim at L158 (§1.12 fact 5).
So after §6.4 alone, a task master submits with `opanai` sits in the queue permanently and
says nothing. §6.5's every-shipped-provider-has-a-row assertion covers `MODEL_REGISTRY` and
cannot reach a typed string.

**So an unknown provider is refused where it is ASKED FOR.** `submit()` returns a bare
`task.id` **string** today and has exactly one caller — the IPC handler at L478, which wraps
it as `{ ok: true, id }` (§1.12 fact 4). The review's recommended
`return { ok: false, error }` would therefore change `submit`'s return type and break that
wrap, so the refusal is expressed the additive way, by **throwing**:

```js
// resourceOrchestrator.cjs — submit(), before enqueue. An unknown provider is refused when
// it is ASKED FOR. `_canRun` returning false means "not now", and "not now" is the wrong
// answer to "this provider does not exist". Thrown rather than returned because submit()'s
// success contract is a bare id STRING and its one caller wraps it — changing the type
// would break the wrap, which is the opposite of additive.
if (task.aiProvider && !Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, task.aiProvider)) {
  throw new Error(`unknown AI provider "${task.aiProvider}" — no rate-limit row, so it cannot be metered`);
}
```

```js
// the handler at L477-481 — the refusal becomes something the renderer can render.
ipcMain.handle('orchestrator:submit', async (_e, task) => {
  try { return { ok: true, id: orchestrator.submit(task) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
```

and `Resources.jsx`'s `submitTask` gains the `else` it never had — L381–383 currently acts
only `if (res?.ok)`, so a refusal is invisible:

```jsx
if (res?.ok) { emitActivity('action', `Task submitted: ${task.type} — id ${res.id}`); load(); }
else { emitActivity('error', `Task refused: ${res?.error || 'unknown reason'}`); }
```

`_canRun`'s `if (!limit) return false;` **stays** as defence in depth, for a task that
reached the queue by some path `submit` does not guard. And the same `hasOwnProperty` guard
goes on **`_tick`'s unguarded increment** (L253–L256,
`API_RATE_LIMITS[task.aiProvider].usedReq++`), which is a third `__proto__` surface and
would throw on a provider whose row `submit` has just refused.

§12(i) asserts an unknown provider is **REPORTED** rather than queued — a queued-forever task
and a refused one are indistinguishable from the suite unless the refusal is the thing
asserted.

**And `FALLBACK_CHAIN` is exported from `modelRouter`, because without that the function
above cannot run at all.** §1.5 finding 2: `selectOptimalModel` destructures
`FALLBACK_CHAIN` from a `require` that **succeeds**, so the `catch` default never applies,
`FALLBACK_CHAIN` is `undefined`, and `for (const modelId of undefined)` throws `TypeError`
on every call. Editing a dead function and asserting on it would be a green test on code
that cannot execute. Two options were considered — declare it out of scope (the same
one-tranche-per-function argument used above for `'ollama/phi3'`), or fix the export in the
same change. **Chosen: fix the export**, because it is a one-line addition to an existing
export list, it is strictly additive, and the alternative leaves §6.4's own `else continue;`
change unreachable and unverifiable:

```js
// modelRouter.cjs L755-758 — FALLBACK_CHAIN is destructured by
// resourceOrchestrator.selectOptimalModel and was never exported, so that function threw
// TypeError on every call. Exporting it is additive and fixes the caller.
module.exports = { register, selectModel, chatCompletion, checkAvailable, credentialStatus,
                   allModels, modelInfo, MODEL_REGISTRY, FALLBACK_CHAIN };
```

§12(i) therefore asserts **first** that `selectOptimalModel('general')` *returns* rather
than throws, and only then what it returns.

`'__proto__'` as a provider name resolves through the prototype chain on a plain object
literal, so every lookup becomes
`Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, provider) ? API_RATE_LIMITS[provider] : null`
— the same guard `modelRoles.cjs` already applies to `ROLES`, and `verifyModelRoles.cjs`
already has a `__proto__` case to copy.

The hardcoded `'ollama/phi3'` last resort is **left alone**: it is recorded as a defect in
OLLAMA_ONLY.md §F.3 and belongs to row 150's file-level work on this module. Changing it
here would mean two tranches editing the same function.

### 6.5 The assertion that makes refusal safe

`npm run verify` must fail if any shipped provider lacks a row. Concretely: collect the
distinct `provider` values from `modelRouter.MODEL_REGISTRY` (which by then includes the
`ollama-cloud` rows) plus `'custom'`, `'ollama-search'`, and assert each is an own-property
of `API_RATE_LIMITS`. **This is the assertion that converts "refuse by default" from a
capability regression into a safety property**, and it is the reason refusing is acceptable
at all.

---

## 7. Master's setup path

### 7.1 Where he puts the key — the UI, which already exists

One row in `src/pages/Models/Models.jsx`'s `PROVIDER_LINKS`:

```js
OLLAMA_API_KEY: {
  label: 'Ollama Cloud',
  url:   'https://ollama.com/settings/keys',
  hint:  'Create a key named Rama → paste here. No Ollama install needed for cloud models.',
},
```

That is the whole structural change. `ModelRow` already renders **Add key** for any
unavailable model carrying a `credKey`; `AddKeyModal` already takes a `type="password"`
input and already says *"Stored AES-256-GCM encrypted in your local vault. Never leaves this
machine."*; `saveKey` already calls `window.rama.vault.set`. The `ollama-cloud/*` entries
are `type: 'cloud'`, so they land in the **CLOUD** tab beside OpenAI and Anthropic, which is
where master would look.

Three small additions to the same file:

- a one-line status strip in the cloud tab reading
  **`OLLAMA CLOUD — key PRESENT (vault)`** /
  **`key ABSENT — add a key to use cloud models`** /
  **`vault locked — unlock to use the stored key`**, fed by `models:cloud-status`;
- on the local tab, the existing *"Ollama must be running at localhost:11434"* note gains
  *"— or add an Ollama Cloud key to use cloud models with no install"*, so a master with no
  daemon is told the way forward at the point he discovers the problem;
- **and the Add-key button is replaced by the locked-vault message on `ollama-cloud` rows
  when the vault is locked.** This is not cosmetic. `checkAvailable` ends
  `!!getCredential(credKey)` and `getCredential` returns `null` while the vault is locked,
  so `credentialStatus()` (L745–753) maps every unavailable non-`local` row to
  `'missing-key'` — meaning a master with the key already stored, vault merely locked, is
  shown **Add key** and invited to re-paste a credential he already gave Rāma. That is the
  exact conflation §7.4 forbids, surviving one layer above the function that gets it right:

  ```jsx
  {!isAvailable && model.credKey && (
    cloudStatus?.vaultUnlocked === false && model.provider === 'ollama-cloud'
      ? <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
          vault locked — unlock to use the stored key
        </span>
      : <button className="btn btn-sm" onClick={() => onAddKey(model.credKey)}
          style={{ borderColor: 'var(--amber)', color: 'var(--amber)', fontSize: '10px' }}>
          + Add Key
        </button>
  )}
  ```

  `checkAvailable` and `credentialStatus` are **left alone** — both are correct about what
  they claim ("not usable right now"), and widening them would change five other providers'
  behaviour for an Ollama-shaped problem. §12(d) asserts the states of §7.4 are
  distinguishable **as rendered**, not only inside `credentialState()`.

The renderer **never** receives the key. `models:cloud-status` returns
`{ present, source, vaultUnlocked, baseUrl, baseUrlOverrideRejected, reason, remedy }` and
nothing else; `baseUrl` is a host, not a secret.

### 7.2 `.env.example` — a comment that tells the truth, and no key line

**Corrected in round 2, and this is the one place the earlier error would have SHIPPED.**
The first draft appended `OLLAMA_API_KEY=` to `.env.example`. The first revision removed the
assignment but replaced it with a comment saying *"Rama does not parse .env (there is no
dotenv dependency, by design)"* — **a false statement, written into a tracked file.**
`start.cjs:150–180` parses `.env`, and copies `.env.example` **to** `.env` when `.env` is
absent (§1.12 fact 1). A document that lies is worse than one that admits a gap, and this
one would have been committed.

So `.env.example` gains a **comment block, no assignment, and text that is true**:

```
# ── Ollama Cloud (keyed, no local install needed) ───────────────
# DO NOT put the Ollama Cloud key here. start.cjs DOES load this file into process.env
# (loadEnv(), start.cjs:150 — and it COPIES this file to .env when .env is absent), and it
# spawns every child process with env: { ...process.env }, so a key on a line below would
# be inherited by the Vite, server and sandbox children and would sit in plaintext on disk.
# Rama reads the key ONLY from the encrypted vault and reads NO credential from
# process.env at all (asserted: no shipped module contains process.env.OLLAMA_API_KEY).
# Put it in: Models -> Cloud -> Ollama Cloud -> Add key. Name it `Rama` on ollama.com.
# Creating a key: https://ollama.com/settings/keys
#
# Only the non-secret base URL is configurable here, and config.ollamaCloudBaseUrl in the
# dataStore takes precedence over it:
OLLAMA_CLOUD_BASE_URL=https://ollama.com
```

The key **name** appears only inside a comment, with no `=` assignment, which is both what
the brief permits and the shape that cannot be mistaken for somewhere to paste a value.
**No shape hint** (`ollama-...` or otherwise): the existing file uses them for other
providers, and a shape hint for the one key in this design would be the thing a secret
scanner has to allow-list, and every allow-list entry is a hole.

§12.3 asserts: `.env.example` contains **zero** uncommented `OLLAMA_API_KEY` assignments;
it contains `OLLAMA_CLOUD_BASE_URL=https://ollama.com`; `.gitignore` has a line that is
exactly `.env`; and `git ls-files .env` is empty.

`OLLAMA_CLOUD_BASE_URL` is read from `process.env` (§2.3 precedence 2), and **because
`loadEnv()` really does parse `.env` — and creates it from `.env.example` on first launch —
the line above is LIVE, not decorative.** The first revision claimed it "works if master
exports it in a shell before launching", which understated it and made §2.3's precedence
list read as partly unreachable. Both paths work: a shell export wins (`loadEnv` never
overrides an already-exported variable, L176–177), `.env` works, and
`config.ollamaCloudBaseUrl` in the dataStore takes precedence over both and is the one that
works from inside the app with no restart. A base URL is a hostname, not a secret, so this
is **the one piece of this feature's configuration that is allowed a plaintext home** — and
the reason the key is not allowed one is the same mechanism, read the other way.

### 7.3 The diagnostics — PRESENT or ABSENT where that can be known, and silence where it cannot

Two surfaces, because they can see different things:

**(a) `node start.cjs --diagnose`.** This runs before Electron, so it **cannot read the
vault** — the vault needs master's password — and Rāma reads no credential from
`process.env` by design (§2.4). **So it does not report PRESENT or ABSENT for the credential
at all.** Reporting `ABSENT` here would be a false negative in the normal case (key in the
vault), and reporting `PRESENT` is impossible. An honest diagnostic says what it can see and
names where the answer lives:

```
   ✓  Ollama Cloud base         https://ollama.com (default; config.ollamaCloudBaseUrl wins)
   !  Ollama daemon             not reachable at localhost:11434 — cloud models still work
                                with a key in the vault
   ✓  Ollama Cloud credential   stored in the encrypted vault; not readable before the app
                                starts — check Models → Cloud
```

**One thing it CAN see, and must say: a key sitting in `.env`.** `loadEnv()` loads `.env`
into `process.env` and `start.cjs` spawns every child with `env: { ...process.env }`, so a
key there is both on disk in plaintext and in five processes — and Rāma will **not** read it,
so master gets the exposure with none of the benefit. `--diagnose` is the only surface that
runs in the same process as the loader and can therefore detect it:

```js
// start.cjs diagnose() — the ONE credential thing this stage can honestly observe. It
// tests only that a non-empty assignment EXISTS; it never reads, prints, lengths, hashes or
// otherwise characterises the value, and the defect text names no part of it.
const envText = (() => { try { return fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); }
                         catch { return ''; } })();
if (/^\s*OLLAMA_API_KEY\s*=\s*\S/m.test(envText)) {
  add('Ollama Cloud key in .env', false,
      'a key in .env is loaded into process.env and inherited by every child process');
  defects.push({ id: 'ollama-key-in-env', severity: 'degrade',
    detail: 'OLLAMA_API_KEY is assigned in .env, where Rama does not read it',
    fix: 'delete that line and add the key in Models → Cloud → Ollama Cloud → Add key' });
}
```

A **warning**, not a failure: it is master's file and his choice, and `--diagnose` reporting
a hard failure for a line Rāma ignores would be the diagnostic overstating its own
authority. §12.3 asserts the regex exists and that the message contains no capture group
and no slice of the match.

Two shapes are needed, because `diagnose()`'s two collections carry different fields —
`report` entries are `{ label, pass, note }` via `add()`, `degraded` entries are
`{ module, state, gives }` (L374), and **only a `defect` carries `fix`** (L368–379). The
first draft asked for "a `degraded` entry with the fix line", and a `degraded` entry has
nowhere to put one (review #17). So:

```js
// start.cjs diagnose() — `http` is already required at L46, so no new import.
const daemonUp = await probeLocal('127.0.0.1', 11434, 500);   // 500 ms, loopback only
add('Ollama Cloud base', true, `${baseUrl} (default; config.ollamaCloudBaseUrl wins)`);
add('Ollama daemon', daemonUp, daemonUp ? 'localhost:11434'
  : 'not reachable at localhost:11434 — cloud models still work with a key in the vault');
add('Ollama Cloud credential', true,
    'stored in the encrypted vault; not readable before the app starts — check Models → Cloud');

if (!daemonUp) {
  // Both channels, each for what it carries: `degraded` is what capabilityReport() renders,
  // and the `degrade`-severity defect is the only shape with a `fix` field for the remedy.
  degraded.push({ module: 'ollama', state: 'absent', gives: 'local model inference' });
  defects.push({ id: 'ollama-daemon-absent', severity: 'degrade',
                 detail: 'no Ollama daemon at localhost:11434',
                 fix: 'install Ollama for local models, or add an Ollama Cloud key in Models → Cloud' });
}
```

`severity: 'degrade'` matches the existing optional-module rows (L376) so nothing new has to
learn a new severity, and `probeLocal` is a loopback-only TCP/HTTP probe with a 500 ms
timeout — `--diagnose` must not hang on a firewall.

**(b) `models:cloud-status` IPC** (§7.1) — can read the vault, so it is the authoritative
answer, and it returns the same two states plus `source`.

### 7.4 Honest absence at every level

| Condition | Reported as | Rendered as | Never |
|---|---|---|---|
| vault unlocked, no entry | `present: false, source: null, reason: 'no Ollama API key is stored'` | `key ABSENT — add a key to use cloud models` + **Add key** button | an error, a failure, or a fallback to a different provider |
| vault locked, entry exists or not | `present: false, reason: 'the vault is locked'`, `vaultUnlocked: false` | `vault locked — unlock to use the stored key`, **no Add-key button** (§7.1) | conflated with "no key stored", at any layer including the model row |
| key stored, vault unlocked | `present: true, source: 'vault'` | `key PRESENT (vault)` | the value, any part of it, its length or a hash, anywhere |
| key present, rejected 401 | `ok: false, credentialRejected: true` | the reason, with a replace-the-key remedy | retried in a loop, or reported as an outage |
| `user` never threaded | `ok: false, gateError: true` | a programming-error notice | reported as "master lacks permission" |

**The row the first draft had and this one does not:** *"key in `.env`, vault locked"*.
There is no such state any more (§2.4), and leaving the row in would be a documented path
that does nothing.

---

## 8. Error handling — every operation that can fail

`lib/http.cjs` never throws on an HTTP status; it returns `{ ok, status, body, error }`. So
every row below is a branch on a return value, not a `catch`.

| # | Failure | Detection | Recoverable? | Caller receives | Logged |
|---|---|---|---|---|---|
| 0a | `user` not threaded (`undefined`) | §2.5 step 0 | **no** — programming error | `{ ok:false, gateError:true, reason:'no user supplied to a gated cloud call' }`, **zero HTTP calls** | `console.error` every time — a missing wire-up must not be rate-limited into invisibility, and it must never read as a permissions denial |
| 0b | `user === null`, or tier too low | `capability.can()` false | yes — master signs in / raises tier | `capability.deny(user, capKey)`'s shape: `{ ok:false, error:'… may not do this (needs "models.use")' }`, **zero HTTP calls** | not logged; a denial is a normal outcome |
| 1 | no credential | `credentialState().present === false` | yes — master adds a key | `{ ok:false, unconfigured:true, present:false, reason, remedy }` — and `remedy` is copied onto the thrown error by `ollamaCloudChat`, so the chain can report it | **once per process**, `console.warn`, deduped by a module flag. Repeating it every call would spam a machine that simply has no key. |
| 2 | vault locked | `isUnlocked() === false` | yes — unlock | as #1 with `reason:'the vault is locked'`, `vaultUnlocked:false` | once per lock→unlock cycle, `console.warn` |
| 3 | base URL override rejected | §2.3 validation | yes — fix config | request proceeds on the **default** base; `status().baseUrlOverrideRejected = true` | **once**, `console.error`, with hostname + rule violated. Never the key. |
| 4 | daemon-cloud tag sent to the keyed API | §2.5 step 1 | **no** — programming error | `{ ok:false, nameError:true, reason:'<tag> is a daemon tag; the keyed API wants <api>' }`, **zero HTTP calls** | `console.error` every time — a caller bug must not be rate-limited into invisibility |
| 4b | `kind:'chat'` with no `model`, or an unknown `options` key / bad `format` | `assemble()` envelope validation (§5.3) | **no** — programming error | `{ ok:false, refused:true, where:'envelope', reason:'a /api/chat body needs a model' \| 'unknown option <k>' \| "format must be null or 'json'" }`, **zero HTTP calls** | `console.error` every time — a body that cannot succeed must not spend a slot and an allowance to be told so |
| 5 | payload refused by `egressBoundary` | `assemble().refused` | **no** for that payload | `{ ok:false, refused:true, level, reason, where:'messages'\|'parts'\|'query'\|'envelope', index }` | `console.warn` with the **level, `where` and index only — never the text** |
| 5b | search query not classified | `webSearch`'s own check (§5.3) | **no** — caller must classify | `{ ok:false, refused:true, reason:'a search query must be classified' }`, **zero HTTP calls** | `console.warn` once per caller shape |
| 6 | admission denied | `admit().allow === false` | yes — retry later | `{ ok:false, deferred:true, reason }` | not logged; this is normal throttling, and logging it would bury #4 and #5 |
| 7 | concurrency slot unavailable, non-critical priority | `reserveSlot().ok === false` | yes | `{ ok:false, deferred:true, reason:'…one-request concurrency limit' }` — **refused immediately, not queued**, because a waiter queue on a one-slot row is a latency trap that looks like a hang | not logged |
| 7b | concurrency slot unavailable, `PRIORITY.CRITICAL` | `_awaitSlot` times out after `waitMs` (20 s default) | yes | master's work **waits** for the slot rather than bypassing a physical free-tier limit (§6.3); on timeout `{ ok:false, deferred:true, timedOut:true, reason:'…single slot did not free within 20000ms' }` | `console.warn` **on timeout only** — a critical request that waited and still lost the slot is a real signal; a critical request that waited 300 ms is not |
| 8 | 401 / 403 | `status === 401 \|\| 403` | yes — replace the key | `{ ok:false, credentialRejected:true, status, reason:'Ollama rejected the credential' }`; a module flag suppresses further attempts for **10 minutes** so a bad key cannot hammer the endpoint | `console.error` **once per suppression window**, naming neither the key nor any part of it |
| 9 | 402 / subscription or upgrade error | `status === 402`, or body matching `/subscription\|upgrade\|not available on your plan/i` | **no** for that model | `{ ok:false, planError:true, apiModel, reason:'<model> is not on this plan' }` — **the model is named and no substitute is made** | `console.warn` once per model |
| 10 | 404 unknown model | `status === 404` | **no** for that model | `{ ok:false, modelError:true, apiModel, hint: daemonTagFor(apiModel) ? 'that is the daemon tag' : 'not in CLOUD_TAGS — refresh with models:cloud-list' }` | `console.warn` |
| 11 | 429 / queue full | `status === 429` | yes | `lib/http.cjs` already backs off twice with jitter; after that `{ ok:false, retryable:true, status:429 }` | not logged — the client already handles it |
| 12 | 5xx | `status >= 500` | yes | `lib/http.cjs` retries then opens the per-origin circuit at 4 failures; `{ ok:false, status, retryable:true }` | `console.warn` once per circuit opening |
| 13 | circuit open | `status === 503` + `error` matching `/Circuit open/` | yes, after 20 s | `{ ok:false, retryable:true, reason:'Ollama Cloud is circuit-broken for 20s after repeated failures' }` | not logged |
| 14 | timeout / offline | `status === 0` | yes | `{ ok:false, offline:true, reason: res.error }` — and the **local path is untouched**, so a daemon user loses nothing | `console.warn` |
| 15 | unparseable JSON | `JSON.parse` throws | **no** for that request | `{ ok:false, shapeError:true, reason:'Ollama Cloud returned a non-JSON body' }` with **at most 200 chars** of body, matching `lib/http.cjs`'s own `raw` truncation | `console.warn` |
| 16 | response shape mismatch | `typeof parsed.message?.content !== 'string'` | **no** | `{ ok:false, shapeError:true, reason:'response did not match the /api/chat shape (message.content)' }` — the same phrasing discipline as `customChat`'s existing shape error | `console.warn` |
| 17 | `parsed.error` present with 200 | `parsed.error` truthy | depends | `{ ok:false, reason: String(parsed.error).slice(0,300) }` | `console.warn` |
| 18 | slot leaked by a throw | — | — | prevented structurally: `releaseSlot` in a `finally`, `Math.max(0, …)` floor | — |

**Not in the table, because it must not exist: a silent fallback.** No row above degrades
to a different model, a different provider, or a shortened payload.

Rows 1 and 2 are `unconfigured`, and the behaviour that makes them *declared* rather than
silent is **a change to `models:chat`, specified in §3.4 — not something the existing chain
already does.** Today the chain is `catch { continue; }`: it logs nothing, it cannot tell a
missing credential from a 500, it returns `fallbackFrom` with no statement of cause, and
when nothing else is available it answers
`{ ok:false, error:'All models failed. Last error: no Ollama API key is stored' }` —
**which is ABSENT reported as BROKEN, and it is the target machine's exact state.** After
§3.4's change:

- a fallback that answers carries `unconfigured[]` beside `fallbackFrom`, so master sees
  **which** model was substituted and **why**;
- every candidate being unconfigured yields `{ ok:false, unconfigured, error, remedy }` and
  **never** the words `All models failed`;
- genuine failures are logged at `console.warn`, which is new; `unconfigured` is not logged
  as a failure, because it is not one.

§12(d) asserts both halves of that, because a "declared chain" that declares nothing is
indistinguishable from the silent substitution the brief forbids.

**No log line in this design, at any level, carries the credential, any part of it, its
length, or a hash of it.** §12.4 asserts this behaviourally by capturing console output
during a full dummy-key run.

---

## 9. Input validation

| Input | Source | Required | Type / limits | On failure |
|---|---|---|---|---|
| `user` | caller | **required, no default** | an object with a numeric `tier`; `undefined` → `gateError`, `null` → denied | refuse, zero HTTP calls (§2.5 step 0) |
| `OLLAMA_CLOUD_BASE_URL`, `config.ollamaCloudBaseUrl` | `process.env` (populated by a shell export **or** by `loadEnv()` reading `.env`, §1.12 fact 1) / dataStore | optional | https URL, host in `ALLOWED_HOSTS`, no credentials, no query, no hash, ≤ 200 chars | default base + `overrideRejected: true`, logged once (§2.3) |
| `priority` | caller | optional | integer `0`–`4`, default `PRIORITY.NORMAL`; a non-integer or out-of-range value is **clamped**, not refused, because a bad priority must not fail master's request; `PRIORITY.CRITICAL` only from a master-initiated call | clamped, and the clamp appears in `status()`-visible logs only as the effective value |
| `options` | caller | optional | **enumerated, not spread**: `think` boolean only; `format` `null \| 'json'` only; **any other key refuses** | `refused: true, where: 'envelope'` (§8 row 4b), zero HTTP calls |
| `model` (inside `assemble`) | §2.5 step 1 | **required when `kind: 'chat'`** | the already-name-checked `apiModel`; absent → refuse, because `/api/chat` cannot answer without it | `refused: true, where: 'envelope'`, zero HTTP calls |
| `kind` (inside `assemble`) | caller | **required** | exactly `'chat'` or `'search'`; a `search` envelope carrying `model`/`messages`, or a `chat` envelope carrying `query`, is **refused** as mis-wired | `refused: true, where: 'envelope'` |
| `config.ollamaCloudHostAllow` | dataStore | optional | a single hostname, `/^[a-z0-9.-]{1,80}$/` | ignored, `overrideRejected: true` |
| `apiModel` | caller | **required** | non-empty string ≤ 120 chars, `/^[a-z0-9._-]+(:[a-z0-9._-]+)?$/i`, must **not** match `/[-:]cloud$/` | refuse, `nameError: true`, zero HTTP calls |
| `messages` | caller | **required** | array, 1–200 entries, each `{ role: 'system'\|'user'\|'assistant', content: string \| { text: string, classification } }`, total serialised body ≤ 1 MB | refuse, `validationError: true`; an object `content` with no classification → `egressBoundary` **refuses** (§5.3 rules 2–3); the 1 MB cap is a self-imposed egress ceiling, because a payload nobody sized is a payload nobody reviewed |
| `parts` | caller | optional | array of `string` (→ `public`) or `{ text: string, classification: 'public'\|'internal'\|'private' }` | any other shape, an **absent/undefined/null/empty** classification on an object part, or an unknown value → `egressBoundary` **refuses** (fail closed, §5.3) |
| `query` (search) | caller | **required** | `{ text, classification }` — **no bare string accepted** (§5.3); `text` non-empty after trim, ≤ 400 chars, no control characters; `classification` in `['public','internal']` | refuse; a bare string → `refused: true, reason:'a search query must be classified'`, zero HTTP calls |
| `maxResults` (search) | caller | optional | integer 1–10, default 5 | clamped, and the clamp is reported in the result |
| `timeout` | caller | optional | integer 1 000–300 000 ms, default 120 000 | clamped |
| `/api/chat` response | network | — | `message.content` must be a string; `prompt_eval_count`/`eval_count` finite-or-ignored | `shapeError: true` (#16); an unparseable token count is **ignored, never counted as 0**, matching `modelRoles.num()` |
| `/api/tags` response | network | — | `models` must be an array; a row without a string `name` is **skipped and counted**, not dropped silently | the result carries `skipped: n` |
| search response | network | — | results array; each row needs a `url` parsing as http(s) — rows failing it are dropped and counted | `{ ok:true, results, dropped: n }` |
| `ctxK` | — | — | **never set from the cloud path** | §9 note below |

**`ctxK` is deliberately `null` on every cloud registry row.** `ollamaCatalog` already
records that *"Ollama truncates to `num_ctx` regardless of what the family supports, so a
claimed window is a claim"*, and the keyed API exposes no measured window. A `null` `ctxK`
makes `modelRoles.evaluate` **exclude** cloud rows from `long-context` with the reason *"no
context length known"* — the correct outcome, and strictly better than a number read from a
marketing page. OLLAMA_ONLY.md §F.1 already has measuring `ctxK` from `/api/show` on row
150's list; this design does not pre-empt it.

---

## 10. Testability

**Unit-testable in `scripts/verifyOllamaCloud.cjs`, with no network and no Electron**, via
the four injection seams (`useVault`, `useStore`, `useHttp`, `useOrchestrator`):

- the name mapping, both directions, round trips, unknowns (§4.5);
- base-URL resolution and all seven validation rules (§2.3);
- `credentialState()` across every credential condition of §7.4, with a stub vault — and
  the **rendering** predicate for the vault-locked row, which is where the distinction
  would otherwise be lost (§7.1);
- the capability gate's three cases — no `user`, `user: null`, a master-tier user — with
  zero HTTP calls in the first two, and `status().cloudCapability` both ways against a
  stubbed `MATRIX` (§13.1);
- `selectModel`'s last-resort cloud pass, both directions, with a stub vault and no daemon
  (§3.4(c)) — the one assertion that proves the feature is reachable on the target machine;
- `models:chat`'s `unconfigured` chain, by stubbing `chatCompletion` to throw an
  `unconfigured` error and asserting the response never says `All models failed` (§3.4(b));
- `egressBoundary.assemble` across every classification, the join case, bad shapes, unknown
  values;
- the UNCONFIGURED shape, including the assertion that a stub HTTP client records **zero
  calls** when the key is absent;
- every row of §8's error table, by making the stub HTTP client return that status/body;
- `toRegistryEntries()` shape, `private === false`, `paramsB` agreement with
  `ollamaCatalog.paramsB`;
- `modelRoles.evaluate('narration', …)` refusal, four ways (§3.3);
- the dummy-key leak sweep (§12.4) — the single most important test in the suite;
- rate-limit refusal for a missing provider, and the slot reserve/release/floor behaviour;
- **`assemble`'s envelope**, positively and negatively: a valid envelope yields a body
  carrying `model`/`stream`/`messages`; a missing `model`, a bad `kind`, a non-boolean
  `think`, a `format` other than `null`/`'json'` and an unknown `options` key each refuse;
  and `counts.parts` equals the number of appended `system` messages;
- **the ceiling and the slot through the functions the cloud path calls** —
  `admit({ aiProvider })` sixteen-then-defer, the missing-row refusal, the `__proto__` case,
  and `reserveSlot`'s three behaviours (immediate defer for NORMAL, queue-then-succeed for
  CRITICAL, bounded timeout) driven by a fake clock and a manual `releaseSlot`;
- **`submit()`'s refusal**, asserted as reported-and-not-enqueued via `getStats().queued`;
- **both-egress coverage for search**, with a Playwright stub alongside the HTTP stub, which
  is the only way to assert that a refusal is terminal rather than merely first.

**Integration-testable only, and listed as such:** the `browserEngine.searchWeb` extraction
needs `playwright` and an `ipcMain`, neither of which exists in this workspace, so §12(j)'s
playwright-absent assertion runs under `npm run verify` on a machine with `node_modules` and
is **specified-not-executed** here (§11.13).

**Integration-testable only with a real key, which this session does not have and must not
ask for.** Listed in §11: that the keyed endpoint accepts `Authorization: Bearer`, that it
rejects `x-api-key` alone, that `gemma4:31b` resolves there, that hosted search returns the
shape assumed, and what a credit-exhausted request actually does. **Every one of those is
behind a stub in the suite and named as unverified in §11** — the suite proves Rāma's side
of the contract, not Ollama's.

**A design note on testability driving the design:** the reason §2.1 chose a separate
`lib/` module over an inline branch is precisely this list. Inside `modelRouter.register`,
the leak sweep and the zero-calls assertion would both require stubbing `ipcMain`, and a
security test that is awkward to write is a security test that gets written once and then
not extended.

---

## 11. NOT VERIFIED

Stated plainly, because an admitted gap beats a plausible claim.

1. **Every Ollama fact in this design is UNVERIFIED-IN-THIS-RUN.** The network is blocked
   from this workspace: `Invoke-WebRequest https://docs.ollama.com/api` failed with *"The
   SSL connection could not be established"*. So the two auth mechanisms, the Bearer
   requirement, the `x-api-key` rejection, the *"cloud requests do not require an Ollama
   installation"* claim, the cloud-list vs app naming split and the hosted-search
   credential are all **taken as given from the brief**, cross-checked against
   `docs/research/OLLAMA_ONLY.md` (which was written in a session that *did* have network).
   **Nothing here was confirmed against Ollama's live documentation in this run.**
2. **`https://ollama.com/settings/keys` is the assumed key-management URL** and was not
   loaded. If it is wrong, master lands on a 404 — cosmetic, but it is in §7.1 and should
   be checked on the first run with network.
3. **The hosted web-search endpoint path, request body and response shape are not known
   to this design.** §5 commits to the *decision* and the *gate*; the actual
   `POST /api/web_search` (or whatever it is called) body and result fields must be read
   from Ollama's docs before `webSearch()` is written. **This is the one part of the design
   that cannot be implemented from this document alone**, and it is called out rather than
   guessed. Everything around it — credential, admission row, payload gate, ordering,
   capability gate — is fully specified.
4. **`CLOUD_TAGS` free-tier accessibility comes from a third-party tracker**, via
   OLLAMA_ONLY.md §D.4, which probed a real free account on 2026-09-15 and was already
   ~2.5 weeks stale when recorded. Ollama does not publish its starter-model list. The
   `gemma4:cloud` / `gemma4:31b-cloud` "Low Usage" labels *are* from ollama.com. **Treat
   the ✅/🔒 split as strong evidence, not Ollama's word** — and note that a wrong row
   surfaces as §8 row 9 (`planError`, model named, no substitution), which is the honest
   failure.
5. **The direct-API names in `CLOUD_TAGS` are derived from the daemon tags** in
   OLLAMA_ONLY.md §D.3–§D.5 by the §4.3 rule. Only `gemma4:31b` is attested as a
   cloud-list name (from the brief). **The other thirteen `apiModel` values are inferred
   and must be reconciled against a live `GET /api/tags` on the keyed endpoint** — which is
   exactly what `listModels()` is for, and why §4.2's table carries `daemonTag: null` where
   unknown rather than a guess. **And the reconciliation mechanism is itself unverified:**
   `GET /api/tags` is the daemon's catalogue path, taken from the brief for the keyed
   endpoint too. If the keyed API exposes its catalogue elsewhere, `listModels()` needs its
   path corrected before it can reconcile anything — so the fix for an inferred name list
   depends on a fact that is also inferred. Checked first on the first run with network.
6. **Behaviour at zero remaining free credits is unverified** (OLLAMA_ONLY.md §G.2 reached
   the same conclusion). §8 row 9 assumes an explicit plan error. If Ollama instead returns
   a 429 or a 200 with a short response, row 9 does not fire and row 11 or 16 does — all
   three are honest refusals, so the design does not break, but the *message* master sees
   would be less precise.
7. **The one-concurrent-request figure** comes from OLLAMA_ONLY.md §D.1 reading the live
   pricing page. Not re-checked here. If the free tier has changed, `maxConcurrent` is one
   literal in one row.
8. **`npm run verify` and `vite build` cannot be run in this workspace. `node_modules` is
   not installed** (project convention, confirmed in the resume protocol). So no assertion
   count in §12 has been executed, and **no claim is made that the build passes.** The
   suites are `.cjs` requiring only Node built-ins plus repo modules, so they *should* run
   under a bare Node — unproven here.
9. **Nothing in this design has been run against a real credential, and must not be.**
   Whether the vault round-trips a real Ollama key, whether the endpoint accepts it, and
   whether hosted search returns results are all **unmeasured by construction.**
10. **`egressBoundary`'s value is projected, not measured.** With no context store built
    (Section 130.10), every part today is a bare string resolving to `public`, so the gate
    has nothing to refuse in production. Its benefit arrives with row 150's store. What *is*
    verifiable now is the structural property: it is the only constructor of a cloud body.
11. **`assemble`'s envelope FIELD LIST is provisional on item 1.** §5.3 commits to
    `{ kind, messages, parts, query, model, stream, options, maxResults, allowInternal }`
    because `/api/chat` is documented to need `model` and `stream` — but the exact field
    names and whether `think`/`format` are the right two options come from the same
    unverified request shape as everything else in item 1. **The structural rule is firm and
    the field list is not:** whatever `/api/chat` turns out to want, it is assembled **here**
    and nowhere else, and §12(g)'s "no `JSON.stringify` outside `assemble`" assertion holds
    regardless of which fields the body carries. If a field has to be added, it is added to
    the envelope, not at the call site.
12. **The hosted-search request/response shape governs more of §5 than §5 can prove.**
    Item 3's gap now also covers `maxResults`' name and the result-row field this design
    validates as `url`. The *gate* is independent of all of it — the query is classified
    before any body exists — but the body and the result parsing are not implementable from
    this document.
13. **The `browser:search` extraction is unexercised.** §5.2's six-line extract-and-export
    cannot be run here (no `node_modules`, so no `playwright`, and no Electron `ipcMain`), so
    §12(j)'s playwright-absent assertion is specified and **not executed**. The extraction
    moves no module-scoped state, which is why it is claimed as behaviour-preserving — a
    claim from reading, not from running.
14. **What WAS measured in this session, and is therefore not in this list:** the secret
    matcher over all five trees (194 files, 0 prefix hits, 0 entropy hits, exactly 2 without
    the discriminators — §1.12 fact 7), and every source fact in §1.11 and §1.12, each read
    directly out of the worktree. **Nothing was run against a real credential, and no part of
    a real key was read, requested or written anywhere in this document.**

---

## 12. The assertions, and exactly where they append into the verify chain

### 12.1 New suite — `scripts/verifyOllamaCloud.cjs`

House shape, copied from `verifyModelRoles.cjs`: a shebang, `'use strict'`, a header
explaining *the behaviour worth defending*, `let pass/fail`, a
`check(label, ok, detail)` printing `PASS`/`FAIL`, grouped `console.log` sections, and
`process.exit(fail ? 1 : 0)`.

Wired into `package.json` in two places:

- a script: `"verify:ollama-cloud": "node scripts/verifyOllamaCloud.cjs"`, placed
  immediately after `"verify:ollama-lib"`;
- the `verify` chain: inserted **after `node scripts/verifyOllamaLibrary.cjs` and before
  `node scripts/verifyWebResearch.cjs`**, keeping the three Ollama suites adjacent
  (`verifyOllamaCatalog → verifyOllamaLibrary → verifyOllamaCloud`) and placing it before
  the web-search suite it has a bearing on.

Sections and their assertions:

**(a) the credential is never spoken** — see §12.4, which is this suite's centrepiece.

**(b) naming, both directions** — the ten assertions of §4.5.

**(c) base URL** — default is `https://ollama.com`; each of §2.3's seven rules rejects
(`http://ollama.com`, `https://evil.test`, `https://u:p@ollama.com`,
`https://ollama.com?x=1`, `https://ollama.com#f`, a 300-char URL, `not a url`); a rejection
yields the default base plus `overrideRejected: true`; `config` beats env; env beats
default; **widening the host requires `ollamaCloudHostAllow` and a base-URL override
together** — setting only one does not widen.

**(d) absence is reported, not attempted — and never as broken** — with the stub vault
empty: `chat()`, `listModels()` and `webSearch()` each return
`unconfigured: true, present: false`, carry a `remedy`, and the stub HTTP client records
**zero calls**; with the vault locked, the reason is `'the vault is locked'` and
`vaultUnlocked: false`; **the states of §7.4 are mutually distinguishable** — asserted as
distinct `reason` strings, because the whole point is that locked and absent are not the
same thing; and two new ones that pin the layers above:

- **a `models:chat` naming a cloud model with the vault empty returns `unconfigured` with a
  `remedy`, and its response does NOT contain the string `All models failed`** — the
  assertion that ABSENT is not reported as BROKEN on the target machine;
- **when a fallback does answer, the response carries the `unconfigured` entry alongside
  `fallbackFrom`** — the assertion that a substitution is declared;
- **the §7.4 states are distinguishable AS RENDERED**: given
  `models:cloud-status → { vaultUnlocked: false }`, the Models row for an `ollama-cloud/*`
  model renders the locked-vault text and **no Add-key button**; given
  `{ vaultUnlocked: true, present: false }` it renders the button. (Asserted on the
  rendering predicate, not through a DOM render, because the suite is a `.cjs` under bare
  Node — see §10.)

**(e) which path served it, and that a cloud row is reachable at all** — a dummy-key success
carries `path: 'cloud'`, `endpoint` containing `ollama.com`, `via: 'ollama-cloud-keyed'` and
`credentialSource: 'vault'`; the registry rows are `provider: 'ollama-cloud'` with ids
prefixed `ollama-cloud/`; **no `ollama-cloud/*` id collides with any `ollama/*` id**; `path`
is `'local'` on the daemon path and `undefined` for the five non-Ollama providers; and the
reachability pair that the first draft asserted nowhere:

- with a stub vault holding the dummy key, **no daemon and no other credential,
  `selectModel('general')` returns an id beginning `ollama-cloud/`**;
- with the vault **empty**, the same call does **not** — an unreachable model must not be
  selected.

**(f) the registry rows and the sensitive-role refusal** — the **six** assertions of §3.3
(including the anti-vacuity guard that `reasons[0] !== 'no model supplied'`), plus
**`id === 'ollama-cloud/' + apiModel` on every row**, `credKey === 'OLLAMA_API_KEY'`,
`type === 'cloud'`, `costTier === 1`, `ctxK === null`, `caps` includes `remote` and does
**not** include `offline`, and `paramsB` equals `ollamaCatalog.paramsB(apiModel)` for every
row.

**(g) the payload boundary** — `private` always refused, **in `messages` as well as in
`parts`**; `internal` refused by default and allowed only with both switches; an unknown
classification refused; an **object part with `classification` absent** refused, and
`{ text:'x', classification: undefined }` refused **with the same reason string**; a
non-string non-`{text}` element refused; a message `content` that is an object with no
classification refused, and a bare-string `content` accepted as `public`; the **join case
planted inside `messages`** (fifty `public` message rows + one `private` → refused as a
whole, with `where: 'messages'` and `index` naming the offender); a refusal returns
`refused: true` and **never** a truncated body; `webSearch({ query: 'plain string' })`
refused with zero HTTP calls, and `webSearch({ query: { text:'x', classification:'private' } })`
likewise; and the structural one — **`ollamaCloud.cjs` source contains no `JSON.stringify`
and no `body:` assignment; the only serialisation in the cloud path is inside
`egressBoundary.assemble`** — so there is no second body constructor. Plus: `webSearch` calls
`assemble` too — asserted by stubbing `egressBoundary` and requiring it to have been called
before the HTTP stub was. And five more that the envelope change and the Playwright egress
make necessary:

- **the envelope refusals**: `assemble({ kind:'chat', messages, parts })` with **no
  `model`** refuses `where: 'envelope'` with zero HTTP calls; `kind` absent or anything
  other than `'chat'`/`'search'` refuses; `options: { think: 'yes' }` refuses;
  `options: { format: 'yaml' }` refuses; `options: { temperature: 0.7 }` refuses as an
  unknown key **rather than being passed through**;
- **the accepted path builds a complete body**: with a valid envelope, `gate.body` carries
  `model`, `stream: false` and a `messages` array — asserted positively, because "no second
  constructor" is worth nothing if the one constructor cannot produce a sendable request,
  which is precisely what the first revision specified;
- **`counts.parts` equals the number of appended `role: 'system'` messages**, and those
  messages appear **after** every caller message, in the order given — so a silently dropped
  part fails the suite instead of producing a confident answer from a shortened prompt;
- **both egresses are covered**: `models:search-web` with
  `query: { text:'x', classification:'private' }` and with a **bare string** each return
  `refused: true` while **the HTTP stub AND the Playwright stub both record zero calls**.
  This is the assertion for the finding that mattered most in round 2 — the gate was enforced
  for `ollama.com` and bypassed by the fallback directly beneath it;
- **the gate runs above backend selection**: with the cloud credential ABSENT and Playwright
  present, a `private` query still records zero Playwright calls — proving the refusal is
  terminal rather than merely first.

**(g3) the one wire that decides whether the gate runs at all** — a structural assertion that
`src/services/ramaClient.js`'s `window.rama.models.chat({ … })` call object includes `user`,
and that `ramaChat.send`'s destructured parameter list includes it. Cheap, and it guards the
only `models.chat` call site in the tree; without it the whole §3.4(a) thread-through can be
inert while every other assertion in this suite passes.

**(g2) the capability gate runs, and distinguishes a missing wire-up from a denial** —
`chat()`, `listModels()` and `webSearch()` with **no `user`** return `gateError: true`;
with `user: null` return `capability.deny`'s shape; with a master-tier user proceed to the
HTTP stub; **and the stub records zero calls in the first two cases**.

**And the one that is not about refusing: with a stub `chatCompletion` wired through the
REAL `switch`, a master-tier user's cloud request REACHES the HTTP stub.** This is the
assertion that catches an argument dropped at the dispatch site — the first revision's
`case 'ollama-cloud': return ollamaCloudChat(messages, modelId, info)` passed three
arguments to a four-parameter function, so `user` was `undefined`, **every** cloud request
returned `gateError` and logged at `console.error`, and the gate stood shut while looking
like a policy decision. **A suite that asserts only the refusals cannot tell that bug from
correct behaviour**, which is why the positive case is listed as its own assertion rather
than assumed from the negatives.

With a stubbed
`MATRIX` containing `models.use-cloud`, `status().cloudCapability` reports
`{ key: 'models.use-cloud', dedicated: true }`; without it,
`{ key: 'models.use', dedicated: false }` — both ways, so §13.1's optional tightening is
proven to tighten and proven not to break.

**(h) the error table** — one assertion per §8 row 4,5,8,9,10,14,15,16,17: the stub returns
that status or body and the result carries the named flag (`nameError`, `refused`,
`credentialRejected`, `planError`, `modelError`, `offline`, `shapeError`) and **never
`ok: true`**. Plus: after a 401, a second immediate `chat()` is suppressed and the stub
records no second call.

**(i) rate limits and admission.** The shape assertions first: `API_RATE_LIMITS` has
own-properties `ollama-cloud` and `ollama-search`; `ollama-cloud.maxConcurrent === 1`;
`ollama-cloud.tokPerMin === null` and an unknown `tokPerMin` does **not** fail or clear the
token test; **every distinct `provider` in `MODEL_REGISTRY` plus `custom` and
`ollama-search` has a row** (§6.5).

**Then the ceiling, driven through the function the cloud path actually calls.** The first
revision asserted *"16 requests pass in a minute and the 17th defers"* — a `reqPerMin`
comparison that lives only in `TaskQueue._canRun` (L140–L147) and `selectOptimalModel`
(L358–L363), **and the cloud transport calls neither**: §2.5 goes `admit()` then
`reserveSlot()`. So the courtesy ceiling was asserted in the suite and unenforced on the one
path that spends master's allowance. Rewritten:

- `admit({ aiProvider: 'ollama-cloud' })` sixteen times **allows**; the seventeenth returns
  `allow: false` with a reason naming `16/min`, since `Math.floor(20 × 0.8) === 16` — the
  number in the table is not the number enforced, and the assertion uses the enforced one;
- `admit({ aiProvider: 'nope' })` is `allow: false` with a reason naming the **missing row**,
  and `admit({ aiProvider: '__proto__' })` likewise — the `hasOwnProperty` guard;
- `admit({ aiProvider: 'ollama-cloud' })` with `inFlight` at `maxConcurrent` is
  `allow: false` with the **concurrency** reason, distinct from the ceiling reason;
- `admit({})` with no `aiProvider` behaves **exactly** as before — the additive guarantee,
  and the assertion that keeps the three existing call sites honest;
- `admit({ aiProvider: 'ollama-cloud', priority: CRITICAL })` **still bypasses the rate
  ceiling**, because `admit` returns at L395 before any other check and this design does not
  widen or move that.

`_canRun({ aiProvider: 'nope' })` and `_canRun({ aiProvider: '__proto__' })` are each
**false** — kept as the **separate queue-side** assertions they are, not as a stand-in for
the admission path.

**Then the slot, including the behaviour the two priorities do differently** (§6.3, §8 rows
7 and 7b):

- `reserveSlot('ollama-cloud', { priority: NORMAL })` twice: the second is
  `{ ok: false, deferred: true }` **immediately**, with no wait;
- `reserveSlot('ollama-cloud', { priority: CRITICAL })` while the slot is held **queues**,
  and **resolves `{ ok: true, waited: true }`** once `releaseSlot` fires — so master's work
  is not refused for a busy slot;
- the same call with the slot never released returns
  `{ ok: false, deferred: true, timedOut: true }` after `waitMs` — a **bounded** wait, so a
  leaked slot is an honest refusal rather than an invisible hang;
- `releaseSlot` three times after one reserve leaves `inFlight === 0` and never negative.

**And the unknown-provider refusal is asserted as REPORTED, not as queued** (§6.4b):
`orchestrator.submit({ type:'x', aiProvider:'opanai' })` **throws**, the
`orchestrator:submit` handler turns that into `{ ok: false, error }` whose message names the
provider, and **no task is enqueued** — `getStats().queued` is unchanged. A queued-forever
task and a refused one are indistinguishable unless the refusal is the thing asserted.

**The orchestrator seam:** `useOrchestrator({ admit })` — a stub missing `reserveSlot`,
`releaseSlot` or `recordApiUse` — **throws**, so a stub that drifts from the real instance
fails loudly rather than letting the suite be green about admission that did not happen.

**And the dead function, in order:** **`modelRouter.FALLBACK_CHAIN` is exported and is an
array** (without which the next assertion throws); **`selectOptimalModel('general')` RETURNS
rather than throws** — asserted **first**, because until §6.4's export it threw `TypeError`
on every call and anything asserted after it was unreachable; then that it never returns a
model whose provider has no row.

**(j) the daemon path is untouched** — `ollamaChat` still posts to `localhost:11434`;
`describeInstalled` still emits `type: 'cloud-ollama'` and `credKey: null`; the four
original `ollama/*` seed rows still read `credKey: null, type: 'local'`;
`refreshOllamaModels` still probes `/api/tags` on localhost; **`chatCompletion` with no
`user` still serves every non-cloud provider unchanged** (the new third parameter is passed
only to `ollamaCloudChat`, so a cloud call without a user is the one thing that refuses);
and **`FALLBACK_CHAIN`'s contents are unchanged** — it gains an export, not an entry, so
master's configured preference order still wins where it applies and the cloud pass remains
the last resort.

**And the one pre-existing path this tranche refactors: `browser:search` still behaves
identically** (§5.2's extract-and-export). With `playwright` absent, both
`browserEngine.searchWeb('x')` **and** the `browser:search` handler return
`{ ok: false, error: 'playwright not installed' }` — the first line of the extracted body,
and the one behaviour an extraction could plausibly break. `module.exports` still carries
`register`, `closeBrowser` and `getBrowserPid`; `searchWeb` is **added**, nothing replaced.

**This section is the I11 assertion** — it fails if the additive change stopped being
additive.

### 12.2 Appended to `scripts/verifyInvariants.cjs`

Three additions, because these belong to the covenant chain (`npm run audit` and
`verify:covenant`) and not to a feature suite:

**(a) under `I9`** — `electron/lib/ollamaCloud.cjs` and `electron/lib/egressBoundary.cjs`
are **not** added to `RAW_HTTP_ALLOWED`, and the existing *"no other shipped module
requires http/https directly"* sweep (which walks `electron/`) covers them automatically.
One new explicit check: **`ollamaCloud.cjs` requires `'./http.cjs'`** — the correct
specifier from inside `electron/lib/`, not `'../lib/http.cjs'` as the first draft wrote,
which is a string that could never appear (review #21) — so it is positively using the one
client rather than merely not using a second one.

**(b) a NEW invariant row `I-SECRETS`, not a widening of `I12`** — **the secret scan.**

The first draft bolted this onto `I12`, whose text at spec L1643 and in the file's own title
(L577–578) is *"no console.log in shipped code; pinned dependencies; no placeholders"*.
A credential scan is a different property, and widening a **locked** invariant's check
changes what that invariant means without master saying so, which the resume protocol
forbids in as many words (*raise it rather than quietly changing it*). The goal was right —
one implementation, caught by both `npm run audit` and `verify:covenant` — and it is reached
by adding a row rather than editing one:

```js
{
  id: 'I-SECRETS',
  title: 'no real-looking credential in shipped or scripted source',
  files: ['.gitignore', '.env.example'],
  check(root, r) { /* walkForSecrets + the two matchers + the one-entry allow-list */ },
},
```

Both chains run every row in `INVARIANTS`, so coverage is identical and `I12` keeps its
text. §13 **raises for master** whether this should be promoted to a numbered invariant
(`I18`) in Section 28 — a one-line decision that is his.

**And the suite's own banner has to change, or it starts lying in the file whose purpose is
to stop that.** `verifyInvariants.cjs:1021` prints `the 17 locked invariants — asserted, not
trusted` before iterating `INVARIANTS`; adding `I-SECRETS` makes it print `17` while 18 rows
run. §13.1b's whole argument for promoting `I18` is that the enforced set and the described
set must agree, and a banner that misstates the count is the same defect at smaller scale:

```js
console.log('\nthe 17 locked invariants, plus the rows not yet numbered — asserted, not trusted\n');
```

The file header's own line 4 (*"the 17 locked invariants, asserted instead of trusted"*) gets
the same clause, for the same reason.

The scan itself: a new `walkForSecrets(root)` over **`electron`, `src`, `server`, `scripts`,
`shared`** — `walkShipped`'s four **plus `scripts`**, because `walkShipped` has an explicit
`if (rel.startsWith('scripts/')) continue;` (*"the suites themselves are not shipped"*) and
the brief requires `scripts/` to be covered, so this needs its own walker. **`server/` is in
the list because dropping it left one shipped tree scanned by nothing:** the first revision
walked four directories and omitted `server/`, which `walkShipped` *does* cover for every
other invariant and which contains `server/routes/auth.cjs` among others, while §12.3's
tracked-file sweep applies only the prefix matcher. **Measured in this session, so including
it is known to cost nothing: 194 files over all five trees, 0 prefix hits, 0 entropy hits**
(§1.12 fact 7). Extensions `.cjs .mjs .js .jsx .json .md`, same skip-list.

**Which source view each matcher runs against is specified, because the wrong choice makes
the scan permanently green — a silently-passing check, which this file's own header names as
the worst outcome available:**

| Extension | View | Why |
|---|---|---|
| `.cjs .mjs .js .jsx` | **`nc`** (comments blanked, string literals intact) | a credential in shipped code lives in a **literal**; a credential-shaped string in a comment is master's own note. Against `code` every literal is spaces and **the scan can never match anything.** |
| `.json .md` | **raw** | `views()` is a JavaScript comment-stripper and does not understand either format — a `//` inside a URL would blank the rest of the line and silently hide whatever followed it. |

Two matchers:

- **Known credential prefixes** — `sk-`, `sk-ant-`, `AIzaSy`, `ghp_`, `gho_`, `gsk_`,
  `xoxb-`, `hf_`, `pplx-`, each followed by **≥ 16** `[A-Za-z0-9_-]`. Low false-positive by
  construction; `.env.example`'s `sk-...` lines do **not** match (three dots, not 16 chars).
- **Credential-adjacent high-entropy literals, with two discriminators that the first draft
  lacked.** A string literal of `[A-Za-z0-9_\-]{32,}` whose Shannon entropy is **≥ 3.5
  bits/char**, on or one line below a line matching
  `/key|token|secret|password|credential|bearer|apikey/i` — **and** which is not
  identifier-shaped **and** contains a digit:

  ```js
  // A credential is not a sentence and not an identifier. Without these two tests the scan
  // is RED ON THE FIRST COMMIT: measured, it hits src/services/ghostMode.js:130
  // ('locally-privileged-but-HTTP-reachable') and scripts/verifySelfModel.cjs:307
  // ('ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX'). Neither is a credential, and the
  // one-entry allow-list rule below means neither could be allow-listed — so npm run audit
  // and verify:covenant would both be red immediately, which is how a check gets disabled.
  const WORDY = /^[A-Za-z]+(?:[_-][A-Za-z]+)+$/;
  const candidate = s => !WORDY.test(s) && /\d/.test(s) && entropy(s) >= 3.5;
  ```

  **Re-measured in THIS session, over all five trees including `server/`: 194 files,
  0 prefix hits, 0 entropy hits with the discriminators, and exactly 2 without them** — the
  two strings named above, at H=4.06 and H=3.98, neither a credential. The probe scanned
  **raw** text for every extension, which is strictly more permissive than the `nc` view
  specified above for the JS family, so the shipped matcher can only match the same or
  fewer. The probe lived in `$env:TEMP`, never inside the repo, and was deleted (§1.12
  fact 7).
- **Allow-list, exactly one entry: `test-not-a-real-key`.** Every addition to this list is
  a hole, so the list is itself asserted to have length 1 — **and the note that matters for
  the next person: the discriminators, not the allow-list, are what keep the scan quiet.**
  Reaching for the allow-list when it goes red is the wrong move; narrowing the matcher or
  renaming the literal is the right one.

**(c) TWO new `--self-test` planted cases**, joining the existing **thirteen** (`I12-jsx,
I12-range, I15-guard, I16-failure, I16-accessor, I1-token, I2-login, I3-firstrun,
I4-reprovision, I17-gate, I8-ladder, I9-rawhttp, I14-order` — counted and listed in §1.9,
because the first revision described the harness as three cases and a later session
extending it needs to know the shape). Each is a `{ id, expect, why, pick, mutate }` record
and each requires a named invariant to turn **red**:

- **`I-SECRETS-planted`** — plants a prefix-shaped literal on a credential-adjacent line in
  a `.cjs` file under `electron/`.
- **`I-SECRETS-planted-md`** — plants the same shape in a tracked **`.md`** file under
  `electron/` or `src/`. **This case exists to assert the VIEW CHOICE itself.** The table
  above says `.md` is scanned raw because `views()` cannot parse it; without a planted
  markdown case, an implementer who routes every extension through `viewOf` gets a suite
  that is green for the wrong reason, and the whole `.md`/`.json` half of the scan is dead
  with nothing to notice it.

Without these the scan can go silently green on a regex typo or a view mistake, which is the
exact failure the file's own header warns about: *"A test that can quietly pass is worse than
no test."*

**The planted literal is built by concatenation, on purpose.** `verifyInvariants.cjs` lives
in `scripts/`, which `walkForSecrets` covers and which §12.3's tracked-file sweep covers, so
a contiguous prefix-shaped literal in the `MUTATIONS` table would make this suite's own
source a hit for the scan it installs — the same self-referential trap as the false
positives, from the other direction:

```js
{
  id: 'I-SECRETS-planted', expect: 'I-SECRETS',
  why: 'a prefix-shaped credential literal on a credential-adjacent line',
  pick: (root) => walkShipped(root).find(f => f.startsWith('electron/') && f.endsWith('.cjs')),
  // Concatenated so no contiguous match exists in THIS file. A literal here would make
  // scripts/verifyInvariants.cjs a hit for its own scan.
  mutate: (src) => `const apiKey = '${'sk' + '-' + 'A1b2C3d4E5f6G7h8I9j0'}';\n${src}`,
}
```

### 12.3 Tracked-file assertions (in `verifyOllamaCloud.cjs`, section (k))

- `git ls-files -z` → every tracked **text** file is run through the known-prefix matcher
  from §12.2(b); zero matches. This covers `docs/`, which `walkForSecrets` skips, and it is
  the assertion that *"no real-looking credential appears in tracked files."*
- `.gitignore` contains a line that is exactly `.env`.
- `git ls-files .env` returns **empty**.
- **`scripts/verifyInvariants.cjs`'s own source has zero known-prefix matches** — asserted,
  not assumed, because §12.2(c) plants one and the construction that keeps it invisible is
  easy to "tidy" into a contiguous literal.
- `.env.example` contains **zero uncommented `OLLAMA_API_KEY` assignments** (§7.2 — the key
  name appears only inside a comment, because a `.env` file is not read by anything).
- `.env.example` contains `OLLAMA_CLOUD_BASE_URL=https://ollama.com`.
- **No module under `electron/`, `src/`, `server/` or `shared/` contains the expression
  `process.env.OLLAMA_API_KEY`** — §2.4 rejected the environment source because `.env` **is**
  loaded into `process.env` and inherited by every child process Rāma spawns, and a one-line
  "convenience" re-adding this read would make that exposure usable. **This bullet is the
  rule.**
- No file under `electron/`, `src/`, `server/`, `scripts/`, `shared/` contains the string
  `OLLAMA_API_KEY` **adjacent to a value assignment** other than the declaration
  `CRED_SERVICE = 'OLLAMA_API_KEY'`, the `credKey: 'OLLAMA_API_KEY'` rows, and the
  `PROVIDER_LINKS` key — enumerated, so a new assignment site is a visible, reviewed act.
  **These two bullets must not disagree: the expression `process.env.OLLAMA_API_KEY` is
  forbidden everywhere, and this enumeration does not list it.** The first revision's
  enumeration ended *"and `process.env.OLLAMA_API_KEY` reads"*, permitting exactly what the
  bullet above forbids — and an implementer resolving the contradiction permissively would
  have reopened the credential source §2.4 removed, with the suite still green.
- **`.env` carries no `OLLAMA_API_KEY` assignment** — tested as
  `/^\s*OLLAMA_API_KEY\s*=\s*\S/m` against the file's text, **reported as a residual rather
  than a failure** when `.env` is absent (the normal state on a fresh clone, and
  `.gitignore` guarantees it is never tracked). This is the one assertion that can see the
  file `.env.example` invites master to create, and the message it prints names the rule and
  **no part of the matched line** — no capture group, no slice, no length. §7.3's
  `--diagnose` warning is the same check at a surface master actually reads.
- If `git` is unavailable, these checks **report a residual** via the recorder's
  `residual()` channel rather than passing — an unrunnable check must not look like a
  satisfied one.

### 12.4 The leak sweep — the one test this whole design rests on

Behavioural, not structural, because a regex over source cannot prove a value never
escapes:

1. Inject a stub vault returning the literal `test-not-a-real-key` for `OLLAMA_API_KEY`.
2. Monkey-patch `console.log`, `console.warn` and `console.error` to append every argument,
   `util.inspect`-ed, to a buffer.
3. Call **every exported function** of `ollamaCloud.cjs` and `egressBoundary.cjs`, including
   `status()`, `credentialState()`, `chat()`, `listModels()`, `webSearch()` — across the
   success path and **every** §8 failure row, driven by the stub HTTP client. The gated
   calls are passed a stub master-tier `user` (and, separately, no user and `null`, for
   §12(g2)), so the sweep covers the path where a request is actually built and not only
   the paths that refuse early.
4. Collect every returned object, `JSON.stringify`-ed, plus the console buffer, plus the
   `headers` object the stub HTTP client was handed on each call.
5. **Assert the string `test-not-a-real-key` appears exactly once in the whole corpus: in
   the `Authorization` header of a request the stub received.** Nowhere in any return value.
   Nowhere in any console output. Nowhere in any error message.
6. **Assert no proper substring of length ≥ 6 of the dummy appears anywhere outside that
   header** — this is what catches a well-meant `key.slice(0, 8)` in a log line.
7. **Assert `credentialState()`'s key set is exactly
   `['present','source','vaultUnlocked','reason']`, and `status()`'s key set is exactly the
   fifteen keys §2.2 freezes** — `present, source, vaultUnlocked, reason, remedy, baseUrl,
   baseUrlOverrideRejected, baseUrlOverrideWhy, cloudCapability, monthlyBudget,
   monthlyBudgetKnown, usedTokMonth, monthStartedAt, inFlight, maxConcurrent` — compared as
   a **sorted literal list**, so no `length`, `prefix`, `masked` or `hash` field can be added
   without the suite failing, and `cloudCapability`'s own keys are exactly `['dedicated','key']`.
   **The list is in §2.2 and not invented here**: the first revision asserted "the key set is
   enumerated" while never enumerating it, which leaves an implementer to invent the shape
   and then write the assertion to match whatever was invented — a vacuous green, guarding
   the leak surface.
7b. **Assert `models:cloud-status`'s key set is a SUBSET of `status()`'s** — not a parallel
   shape — so there is one definition of what may be said about the credential and the
   renderer surface is provably narrower than it.
8. **Assert the stub was sent `Authorization: Bearer test-not-a-real-key` and was NOT sent
   an `x-api-key` header** — the brief's fact that the endpoint does not accept `x-api-key`
   alone, pinned so nobody "helpfully" adds it.

### 12.5 Where nothing is added

`scripts/verifyLoyaltyTripwire.cjs` is **not** touched, and
`node scripts/verifyLoyaltyTripwire.cjs --approve` is **never** run. No protected file is
edited, so the tripwire has nothing to re-approve. If the capability in §13 is added by
master, the procedure is OLLAMA_ONLY.md §F.7's four steps and **master runs them**, not
Rāma.

---

## 13. RAISED FOR MASTER

### 13.1 A capability key, specified rather than added

`shared/capabilities.json` is a **protected file** under `loyaltyGuard.PROTECTED_FILES`, so
this design specifies and does not add:

| Key | Tier | Why |
|---|---|---|
| `models.use-cloud` | **1** | A cloud call spends master's metered allowance **and** sends bytes off the machine. That is a materially different act from running a local model, which `models.use` (tier 3) governs. Tier 1 matches `models.add-key` and `models.ollama-pull` — the other two acts that commit master's resources. |

**How the feature degrades honestly until master adds it.** `capability.can()` returns
`false` for an unknown key (*"unknown means denied"*), so gating on a missing key would make
the feature **dead**, not degraded. So the gate is written as an **optional tightening**:

```js
// Tier 1 is the right gate for spending master's cloud allowance, but the key lives in a
// PROTECTED file and is specified for master rather than added (Section 131, RAISED FOR
// MASTER). Until he adds it, cloud calls are gated by `models.use` like any other model,
// and `status()` says so out loud. When he adds it, it applies with no code change.
const CLOUD_CAP = 'models.use-cloud';
const capKey = Object.prototype.hasOwnProperty.call(capability.MATRIX, CLOUD_CAP)
  ? CLOUD_CAP : 'models.use';

// §2.5 step 0. `undefined` means the argument was never threaded — a PROGRAMMING ERROR,
// reported as such so a missing wire-up never reads as a permissions problem. `null` means
// an unauthenticated caller and is a genuine denial. capability.can(null, …) is hardcoded
// false, so without this split a gate placed here would deny EVERY cloud call and look
// like a policy decision.
if (user === undefined) {
  console.error('[ollama-cloud] no user supplied to a gated cloud call');
  return { ok: false, gateError: true, reason: 'no user supplied to a gated cloud call' };
}
if (!capability.can(user, capKey)) return capability.deny(user, capKey);
```

**Where it lives: inside `ollamaCloud.chat()` / `listModels()` / `webSearch()`,** at step 0,
before any other work. Not in the IPC handler alone — a second entry point added later
would bypass a handler-only gate, and the transport is the layer that owns every other
cloud invariant in this design (§5.3's argument applies unchanged). The handler's job is to
**supply** the user, not to decide.

**And the wiring that makes it run rather than stand closed** (§1.11 fact 5): `models:chat`
destructures `user` from its payload and threads it `chatCompletion → ollamaCloudChat →
cloud.chat` — **with all four arguments at the dispatch site**, which is the one-line defect
§12(g2) now asserts against. `models:search-web` does the same for `webSearch`.
`preload.cjs`'s `models.chat` already forwards the whole options object, so the renderer
change is a call-site addition, not a bridge change.

**The renderer call site is `src/services/ramaClient.js:23` — the ONLY `models.chat` caller
in the tree.** The first revision named `Models.jsx`, which has no such call site, so the
thread-through would have been inert and every cloud chat would have returned `gateError`
even with the dispatch bug fixed. `ramaChat.send` gains `user` and forwards it; its two
callers — `Chat.jsx:219` and `IDE.jsx:253` — **both already hold `currentUser` from
`useUserStore()`** (L149 and L183 respectively, the same value
`window.rama.vault.set(currentUser, …)` is given), so **no caller lacks a user** and there is
no missing wire-up to discover later. The table is in §3.4(a) and the rows are in §14.

and `status()` carries
`cloudCapability: { key: capKey, dedicated: capKey === CLOUD_CAP }` so the Models page can
state **"cloud calls are gated by `models.use` (tier 3); a dedicated tier-1
`models.use-cloud` gate is available and not yet enabled"**. Asserted both ways in §12
with a stubbed `MATRIX`. `MATRIX` is already exported, so no protected file is read in an
unsupported way.

**Search** needs no new key: `browser.search` (tier 3) already exists and is what
`TOOL_REGISTRY['web.search']` declares.

### 13.1b Should the secret scan become invariant I18? — raised, not decided

§12.2(b) adds the credential scan as its own `INVARIANTS` row, `I-SECRETS`, rather than
widening locked invariant **I12** (*"no console.log in shipped code; pinned dependencies;
no placeholders"*), because a credential scan is a different property and quietly widening
a locked invariant is what the resume protocol forbids.

That leaves a numbering question that is master's: **`RAMA_AGI_MASTER_SPEC.md` Section 28
holds I1–I17. Should "no real-looking credential in shipped or scripted source" be promoted
to a numbered invariant `I18` there?**

- **In favour:** it is exactly the kind of property the numbered list exists for — checkable,
  never-to-be-regressed, and about loyalty rather than style. It would also be the first
  invariant added since the list was sealed, which is itself worth a deliberate decision.
- **Against:** the row works today without a number. An unnumbered row runs in both chains
  and fails the build identically; the number is documentation, not enforcement.

**Rāma's recommendation: promote it, in a separate commit that touches only Section 28.**
Keeping it unnumbered means the spec's invariant list no longer describes everything the
covenant chain enforces, and that gap is how a later session concludes a check is optional.
**This design does not edit the spec and does not add the number.** Until master decides, the
row's `id` is the string `I-SECRETS`, which cannot be mistaken for a numbered invariant.

### 13.2 Three decisions that are master's, not Rāma's

1. **Is the monthly credit pool worth tracking at all?** §6.3 counts what Rāma spends but
   cannot read what remains, and Ollama sends no warning on a free plan. The alternative is
   not counting and letting the plan error (§8 row 9) be the signal. **Recommendation: keep
   the count** — it is cheap, it is honest about what it is, and it is the only number
   master has.
2. **Should `config.allowInternalToCloud` exist at all?** §5.3 defaults it off and requires
   two switches. A stricter design would omit it and refuse `internal` permanently.
   **Recommendation: keep it, default off** — removing it later is easy; discovering a
   needed payload class is permanently blocked is not.
3. **Search backend order where Playwright *is* installed.** §5.2 defaults cloud-first
   because that is what works on the target machine. Master may prefer local-first to
   conserve credit. **Recommendation: `config.searchBackendOrder`, defaulting
   `['ollama-cloud','playwright']`**, one config line either way. **Both named backends are
   genuinely invocable** — `'playwright'` resolves to `browserEngine.searchWeb`, which §5.2
   extracts and exports for this purpose. An order config over a backend that cannot be
   called is a setting that does nothing, which is what this entry would have been had §5.2
   kept the un-invocable handler reference.

### 13.3 What master must do, in order

1. Launch Rāma, unlock the vault, go to **Models → Cloud → Ollama Cloud → Add key**, paste
   the key named `Rama`. **That is the only place it goes.** There is no `.env` path and no
   environment variable: **Rāma reads no credential from `process.env` at all** (§2.4,
   asserted in §12.3), and an earlier draft of this design was wrong to offer one. **Note
   the distinction, because it is the one that matters: `.env` IS loaded into `process.env`
   by `start.cjs` — so a key put there would be exposed to every child process AND still
   unusable by Rāma.** `--diagnose` will warn if it finds one, naming no part of it.
2. Confirm the strip reads **`key PRESENT (vault)`**. If it reads
   **`vault locked — unlock to use the stored key`**, the key is already stored and the
   vault just needs unlocking — Rāma will not ask for it again.
3. Optionally add `"models.use-cloud": 1` to `shared/capabilities.json` and run
   OLLAMA_ONLY.md §F.7's four-step approval. **Rāma will not do this.**
4. Optionally decide §13.1b: whether the credential scan becomes numbered invariant `I18` in
   Section 28. Nothing waits on it.

---

## 14. Files touched, and what is deliberately left alone

| File | Change | Size |
|---|---|---|
| `electron/lib/ollamaCloud.cjs` | **new** — transport, naming table, credential state, status | ~380 lines |
| `electron/lib/egressBoundary.cjs` | **new** — the one cloud-payload constructor and classification gate | ~120 lines |
| `electron/ipc/modelRouter.cjs` | merge `toRegistryEntries()`; `case 'ollama-cloud'` + `ollamaCloudChat` (carrying `remedy` and `gateError` onto the thrown error); `chatCompletion`'s third `user` param; `path: 'local'` on `ollamaChat`; **`models:chat` gains `user` and the `unconfigured`/`failures` chain (§3.4(b))**; **`selectModel` gains the last-resort cloud pass (§3.4(c))**; **`FALLBACK_CHAIN` added to `module.exports` (§6.4)**; `models:cloud-status` and **`models:search-web`** handlers | ~130 lines added, **nothing removed** |
| `electron/resourceOrchestrator.cjs` | `ollama-cloud` / `ollama-search` / `custom` rows; `maxConcurrent`+`inFlight` on every row; `_canRun` refuses a missing row; `selectOptimalModel` skips instead of selecting; `reserveSlot`/`releaseSlot`/`recordApiUse`; `admit({ aiProvider })` | ~70 lines |
| `electron/preload.cjs` | `models.cloudStatus`, `models.searchWeb` — **both inside the `models:` prefix `genome.cjs` already declares for this gene**, so no genome edit (§5.2) | 2 lines |
| `electron/ipc/browserEngine.cjs` | **extract-and-export only**: the `browser:search` handler body becomes `async function searchWeb(query, engine = 'bing')`, the handler delegates to it, `module.exports` gains `searchWeb`. **No behaviour change** — §12(j) asserts the playwright-absent return is identical. Needed because an `ipcMain` handler cannot be called from main-process code (§1.12 fact 3) | ~6 lines |
| `src/pages/Models/Models.jsx` | `PROVIDER_LINKS` row; cloud-status strip; local-tab note; **the vault-locked branch in `ModelRow` that replaces the Add-key button (§7.1)**. **No `models.chat` call site here** — that correction is the three rows below | ~40 lines |
| `src/services/ramaClient.js` | **`ramaChat.send` gains `user` and forwards it to `window.rama.models.chat`** — the ONLY `models.chat` caller in the tree, and the wire without which §3.4(a)'s thread-through is inert (§1.12 fact 2) | 2 lines |
| `src/pages/Chat/Chat.jsx` | `user: currentUser` added to the `ramaChat.send({…})` object at L219; `currentUser` already in scope from L149 | 1 line |
| `src/pages/IDE/IDE.jsx` | `user: currentUser` added to the `ramaChat.send({…})` call at L253; `currentUser` already in scope from L183 | 1 line |
| `src/pages/Resources/Resources.jsx` | the **`else` branch `submitTask` never had** — an unknown-provider refusal is currently invisible because L381–383 acts only `if (res?.ok)` (§6.4b) | 1 line |
| `.env.example` | the Ollama Cloud **comment block** — a key name in a comment, `OLLAMA_CLOUD_BASE_URL`, **no `OLLAMA_API_KEY` assignment**, and text that correctly says the file **IS** loaded into `process.env` and copied to `.env` (§7.2) | 10 lines |
| `start.cjs` | three `diagnose()` report lines, a loopback daemon probe, one `degraded` entry **and** one `degrade`-severity defect carrying the `fix`; **plus the `.env` `OLLAMA_API_KEY` warning and its own `degrade` defect** (§7.3) | ~35 lines |
| `scripts/verifyOllamaCloud.cjs` | **new** suite, sections (a)–(k) | ~560 lines |
| `scripts/verifyInvariants.cjs` | I9 positive check (`'./http.cjs'`); **a new `I-SECRETS` row** + `walkForSecrets` over **five** trees + the two discriminators + the per-extension view rule; **two** self-test cases (`I-SECRETS-planted`, `I-SECRETS-planted-md`) with concatenated literals; **the banner and header line corrected to `the 17 locked invariants, plus the rows not yet numbered`**, because an 18th row makes the old text false. **`I12` is not modified** | ~110 lines |
| `package.json` | `verify:ollama-cloud` script + one chain insertion | 2 lines |
| `docs/research/OLLAMA_CLOUD.md` | **new** — the report, carrying §15's two ready-to-paste blocks | — |

**Deliberately left alone:** `httpPost`/`httpGet` in `modelRouter` (§1.2 — `net.request`
is used directly instead); `ollamaChat`'s hardcoded `localhost:11434` (§3.4);
`checkAvailable` and `credentialStatus` (§7.1 — both are correct about what they claim; the
locked-vault distinction is made where it is rendered); `FALLBACK_CHAIN`'s **contents**
(only its export changes); the `'ollama/phi3'` last resort and `modelRoles`' unsized-sort
defect (both already on row 150's list — two tranches must not edit the same function);
`ollamaCatalog.describeInstalled`; `modelRoles.cjs` itself; **`genome.cjs`** (the channel
was renamed instead — §5.2); **`browser:search`'s own direct IPC path**, which keeps its
tier-3 `browser.search` gate and its unclassified query, because routing it through the
egress gate means routing it through `models:search-web` and that is the tool-executor
follow-up's job (§5.2's honest limit); all seven protected files;
`intelligenceEngine.cjs`, `selfRepair.cjs`, `releaseChannel.cjs`, `proposals.cjs` and
everything under `src/pages/StockMind/` (other workflows hold them).

**Follow-up work this design creates and does not do:**

- **a tool executor for `TOOL_REGISTRY['web.search']`.** Nothing in the tree invokes
  `browser:search` today (§5.1), and `models:search-web` lands the same way: a backend with
  no caller. Its first observable behaviour is a suite assertion. Naming this honestly is
  the point — the alternative was to claim a dark capability had become a working one.
- **feed `ollama-cloud/*` rows into the role engine.** `modelRouter` passes only
  `Object.values(discoveredOllama)` to `modelRoles`, so after §3.4(c) a cloud row **is
  selectable by `selectModel`'s last-resort pass** but still **cannot fill a role**. §3.3's
  gate is asserted ahead of that path, deliberately.
- reconcile `CLOUD_TAGS`' inferred `apiModel` values against a live keyed `GET /api/tags`
  (§11.5 — and confirm that path exists on the keyed endpoint at all);
- read the real hosted-search endpoint shape (§11.3).

---

## 15. Ready to paste

### 15.1 For `RAMA_AGI_MASTER_SPEC.md` — write into `docs/research/OLLAMA_CLOUD.md`, not into the spec

> **This block is specified here and written into `docs/research/OLLAMA_CLOUD.md`.
> `RAMA_AGI_MASTER_SPEC.md` is not modified by this tranche.** Master pastes it, or a later
> session does once he approves.
>
> **Before pasting, re-check that `131` and ledger row `151` are still free on `dev`.**
> Verified from this worktree: the ledger jumps `147 → 150`, so rows **148 and 149 are
> unassigned**, and Sections **128 and 129 are claimed in prose** (spec L14108, and commit
> `b93054b` — *"the section this tranche cites is 129, not a number dev already used"*) with
> no `## SECTION` headers of their own. Other in-flight worktrees therefore appear to hold
> 128, 129 and probably rows 148–149. **131 and 151 are plausible but unverifiable from
> here.** This line goes into `docs/research/OLLAMA_CLOUD.md` too, so whoever pastes reads it
> first.

```markdown
## SECTION 131 — The keyed cloud path, and the credential Rāma must never speak

**STATUS: DESIGNED, NOTHING BUILT.** Master: *"ollama api key with name Rama; utilise it"*.

### 131.1 Why a second Ollama path exists at all

Section 130 fixed the scope at **whatever a free ollama.com account reaches**, and
`docs/research/OLLAMA_ONLY.md` answered it for the mechanism it knew: **`ollama signin` on
a local install**, after which the daemon authenticates cloud requests itself and Rāma keeps
talking to `localhost:11434` **with no credential in the process at all**. That report is
not retracted — with a daemon present it remains the simpler path and it keeps working
untouched.

**But master's machine is 16 GB with no Ollama installed, and the decisive fact is that
cloud requests do not require an Ollama installation.** With the key, that machine reaches
cloud models directly. The `signin` path cannot serve it: `refreshOllamaModels()` probes
`localhost:11434`, gets `ECONNREFUSED`, sets `detectedOllamaModels = []`, and every role
falls to `fit: 'none'`. **So this is the mechanism OLLAMA_ONLY.md never covered, added
BESIDE the one it did (I11).**

### 131.2 CONFLATING THE TWO AUTH MECHANISMS IS THE PRINCIPAL HAZARD

**(a) `ollama signin`** — the daemon holds the credential; Rāma holds none.
**(b) an API key** — Rāma holds the credential and calls `https://ollama.com/api` with
`Authorization: Bearer`. **Local access at `http://localhost:11434` needs no auth at all.**
A design that blurs these ends up sending master's Bearer token to a daemon, or expecting a
daemon-authenticated call to work with no daemon. **They are kept apart by construction: a
distinct module (`electron/lib/ollamaCloud.cjs`), a distinct provider (`ollama-cloud`), a
distinct id namespace (`ollama-cloud/<api-name>` vs `ollama/<daemon-tag>`), and a distinct
rate-limit row.** `allModels()` is `{ ...MODEL_REGISTRY, ...discoveredOllama }` — discovery
silently wins every key collision — so a shared namespace would let a local pull overwrite a
cloud entry and change a request's path with no visible cause.

### 131.3 THE CREDENTIAL IS NEVER SPOKEN, AND THAT IS ASSERTED RATHER THAN PROMISED

The key's value was never given to any session and was never asked for. **No log line, at
any level, carries it, any part of it, its length, or a hash of it. A diagnostic reports
exactly two states: PRESENT or ABSENT.** `credentialState()`'s key set is pinned to
`{present, source, vaultUnlocked, reason}` so a `prefix` or `length` field cannot be added
without the suite failing. **The centrepiece assertion is behavioural, not structural,
because no regex over source can prove a value never escapes:** inject the dummy
`test-not-a-real-key`, capture all three console channels, call **every** exported function
across the success path and every failure row, and assert the dummy appears **exactly once
in the entire corpus — in the `Authorization` header the stub HTTP client received** — and
that **no substring of length ≥ 6 appears anywhere else**, which is what catches a
well-meant `key.slice(0, 8)` in a log line. `verifyInvariants.cjs` gains a secret scan over
`electron/ src/ scripts/ shared/` — **as its own `I-SECRETS` row, NOT as a widening of
locked invariant I12**, whose text is about `console.log`, pinned dependencies and
placeholders; a credential scan is a different property and quietly widening a locked
invariant is what the resume protocol forbids (promotion to a numbered `I18` is RAISED for
master, not taken). The matcher rejects identifier- and kebab-worded runs and requires a
digit, because without those two discriminators it is measurably **red on the first
commit** on two English strings that are not credentials — and the allow-list is asserted to
hold **exactly one** entry, so the discriminators, not the list, are what keep it quiet. An
`I-SECRETS-planted` case joins the existing `--self-test` harness, with its literal built by
**concatenation** so this suite's own source is not a hit for the scan it installs, because
the file's own header is right that *"a test that can quietly pass is worse than no test."*

**AND THE CREDENTIAL HAS EXACTLY ONE HOME: the vault — for the OPPOSITE of the reason an
earlier draft gave.** That draft accepted `process.env.OLLAMA_API_KEY` and told master to
write the key into `.env`; the next one removed it on the grounds that *"nothing parses a
`.env` file"*. **That was false, and it would have shipped as a comment inside
`.env.example`.** `start.cjs:150–180` (`loadEnv`) **parses `.env` into `process.env` and
CREATES `.env` from `.env.example` when `.env` is absent**, and `start.cjs` spawns every
child with `env: { ...process.env, … }` (L886, L1004, L1129, L1197, L1271). So the reason to
keep the credential out of `.env` is **not that nothing reads it — it is that everything
does**: one paste would put the key in plaintext on disk and in the Vite, server and sandbox
children, and `.env.example` actively invites it, already listing `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `GITHUB_TOKEN` as shape hints. **The env source is
removed, and the decision is defended three ways rather than asserted once:** `.env.example`
gains a comment that says the file **is** loaded and the key must not go there; `--diagnose`
**warns** when `.env` carries an `OLLAMA_API_KEY=` line, naming **no part of the value**; and
it is asserted that no shipped module contains the expression `process.env.OLLAMA_API_KEY`,
so Rāma cannot *use* such a key even if master loads one. **That last assertion is the
load-bearing one: it cannot stop a key reaching `.env`, it stops Rāma reading it from
there.** The non-secret `OLLAMA_CLOUD_BASE_URL` is the one value that *does* belong in that
file, and because `.env` is genuinely loaded, the line is live rather than decorative.

### 131.4 THE MODEL NAMES DIVERGE, AND ONE DIRECTION FAILS SILENTLY

The keyed API takes the **cloud-list** name (`gemma4:31b`); the daemon, CLI and app take a
`-cloud` tag (`gemma4:31b-cloud`, `gemma4:cloud`). Sending the daemon tag to the API is a
loud not-found. **Sending the API name to a DAEMON is the silent one: `gemma4:31b` is also
a plausible LOCAL PULL tag, so a request master believes went to the cloud can run locally
or stall on a 31 B download.** So the mapping is a **frozen table, authoritative in both
directions, returning `null` for anything unknown — never a derived guess** — the derivation
rule (strip a trailing `-cloud`; a bare `cloud` tag drops the colon) is used in a **test**
to validate the table and decides nothing at runtime, because the reverse direction cannot
be derived safely. **A daemon tag handed to the keyed transport is refused BEFORE any
request is made, and the assertion is that the stub client records ZERO calls** — a refusal
after the bytes have left is not a refusal.

**ONE CORRECTION TO THE PREMISE, recorded so the next session does not think the document
is wrong:** `paramsB()`'s regex is anchored at the start and **not** the end, so `31b-cloud`
→ `31` as well as `31b` → `31`. Direct-API naming is therefore **never worse** rather than
*strictly* better; the real split is sized vs unsized (`gemma4` → `null`, no `:` at all).
**The design consequence is unchanged and is the valuable one: `gemma4:31b` → 31 → clears
`reasoning`'s 14 B floor → `declared` rather than `substitute`**, and the registry calls the
real `paramsB()` instead of copying the table's number, so the two can never disagree.

### 131.5 A CLOUD MODEL IS NOT PRIVATE, SO `narration` MUST STILL REFUSE IT

`modelRoles.evaluate` refuses any model whose `private !== true` for the one `sensitive`
role, so `false` **and** `undefined` both refuse today. **Relying on `undefined` is relying
on an accident**, so every cloud row sets `private: false` explicitly and the refusal is
asserted **five ways** — row shape, behavioural `fit: 'none'`, the reason text naming the
leaving-the-machine rule (so a reword cannot pass a sensitive prompt while sounding right),
the `private: undefined` case, **plus the inverse, that the same row IS fit for `reasoning`,
so the refusal is proven to be about sensitivity rather than cloud rows failing
everything.**

**AND A SIXTH, WITHOUT WHICH THE OTHERS WERE VACUOUS.** `evaluate` returns
`{ fit:'none', reasons:['no model supplied'] }` for anything without `model.id`, **before**
it reaches the privacy gate (`modelRoles.cjs` L146–148). In `MODEL_REGISTRY` the id is the
object **key**, not a field, so the first draft's row had none — the `narration` refusal
passed **for the wrong reason**, the reason-text assertion failed, and the inverse failed.
Fixed two ways: every emitted row carries `id: 'ollama-cloud/<apiModel>'`, and the suite
asserts `reasons[0] !== 'no model supplied'`. **The defence this design weights highest
would otherwise have shipped green and proved nothing.**

Note the ordering: role selection passes only `Object.values(discoveredOllama)` today, so
**cloud rows still cannot fill a role** — the gate is asserted correct **before** the path to
it exists.

### 131.6 Section 130.8's gate is on the PAYLOAD, and the transport owns it

Section 130.8's words, verbatim and nothing else inside the quotation marks:

> *"a join can assemble a context payload that no single row looks sensitive enough to
> block. Row-level classification is necessary and not sufficient, so the design must name
> the chokepoint where an outbound payload is assembled and show that a classified row
> cannot pass it even when it arrives via a join."*

**This design's reading, in its own voice and not the spec's:** the chokepoint is the
**TRANSPORT**, not the role engine and not the caller. The role engine never sees a payload;
callers get refactored and there will be more of them. The transport is the one place bytes
leave the machine, so it is the only place the rule can be **true** rather than *currently
true*. `electron/lib/egressBoundary.cjs` is therefore the **only** constructor of a
cloud-bound body — asserted structurally — and `maxLevel` is computed across **`messages`
AND `parts` together**.

**THE MODULE IS CALLED `egressBoundary`, NOT `cloudBoundary`, AND THE RENAME IS THE FIX FOR
THE WORST DEFECT FOUND IN REVIEW.** An earlier draft scoped the gate to *the cloud boundary*
and placed the Playwright search path **directly beneath it as a fallback** — so a query
refused as `private` for `ollama.com` fell straight through to
`https://www.bing.com/search?q=…` (`browserEngine.cjs` L205–L208). **The rule was enforced
for one egress and broken by the line underneath it.** Bing is not less of a network than
ollama.com. So: **"egress" means OFF THIS MACHINE, not "ollama.com"**; the classification
runs **ONCE, ABOVE backend selection**, in `models:search-web`; **a refusal is TERMINAL for
every backend** and never falls through to a different way of sending the same bytes; and the
assertion is that a `private` or bare-string query leaves **the HTTP stub AND the Playwright
stub with ZERO calls**. A name that reads as a scope limit is how a later session re-opens
this, which is why the name changed and not only the code.

**ONE HONEST LIMIT:** `browser:search`'s own direct IPC channel keeps its unclassified query.
It is pre-existing, gated at tier 3, has **no caller in the tree**, and is not modified here;
routing it through the gate means routing it through `models:search-web`, which is the
tool-executor follow-up. **Every egress `models:search-web` can reach is gated; the legacy
direct channel is not, and it is named rather than quietly left out.**

**That last word is a correction worth its own sentence: the first draft classified only
`parts`, and `messages` is the field that actually carries the prompt.** Every existing
caller of `models:chat` puts its text there, and a context store's retrieved rows would land
there too — so the gate computed `maxLevel` over an empty array, resolved `public`, and
passed the primary payload unexamined. Now a message's `content` is either a bare string
(→ `public`, preserving today's callers) or `{ text, classification }`, **an object part or
content with the classification ABSENT is refused exactly as an unrecognised value is**
(choosing the object shape is choosing to classify), and the join assertion plants its
`private` row **inside `messages`**, which is the path callers use. **Search goes further
and accepts no bare string at all** — a query is the field most likely to carry private
context off the machine, there are no legacy callers to protect, and a bare-string allowance
there would have made the gate decorative against the one risk this section names.
`private` is refused unconditionally; `internal` needs two independent switches, because one
switch gets flipped by a default; an unrecognised classification **fails closed**. **Honest degradation: with no context store built, every part today is a bare
string resolving to `public` and the gate refuses nothing** — its value is that row 150's
store arrives to a gate it plugs into rather than one it must retrofit, which is the failure
Section 127 names by name.

### 131.7 `API_RATE_LIMITS.ollama: { reqPerMin: 9999 }` was right and is now also wrong

Right for a local daemon; wrong for a free cloud plan whose binding constraint is **ONE
CONCURRENT REQUEST plus a monthly credit pool**. OLLAMA_ONLY.md §F.3 had already found that
**the shape cannot express the limit** — concurrency is not a rate and a monthly pool is not
a per-minute budget. So: separate `ollama-cloud` and `ollama-search` rows (search must not
be able to eat the single inference slot); `maxConcurrent` + `inFlight` with
`reserveSlot`/`releaseSlot` **inside `resourceOrchestrator` so I10 keeps its monopoly**, a
`Math.max(0, …)` floor so a double-release cannot manufacture capacity, and a mandatory
`finally` because a leaked slot on a 1-slot row is a permanent outage. **`tokPerMin: null`
and `monthlyTokenBudget: null` are deliberate: Ollama does not expose the remaining
balance, so Rāma reports WHAT IT HAS SPENT and never WHAT REMAINS.** A guessed budget would
be the invented number Section 126 exists to prevent. **AND THE THIRD FINDING WAS THE
WORST: `modelRouter` calls `orchestrator.admit()` NOWHERE, and `admit()` never looked at
`aiProvider` at all — so a cloud call would have passed through NO admission check
whatsoever.** `admit({ aiProvider })` closes it, defaulting `null` so the **three** existing
call sites are byte-identical — **and WHICH FIELDS it consults is written out rather than
left as "it consults the row": a `hasOwnProperty` lookup, refuse when there is no row, the
per-minute reset, the ceiling at `reqPerMin × 0.8`, then `inFlight >= maxConcurrent`, each
with its own named reason.** That matters because the courtesy ceiling was previously
asserted against `TaskQueue._canRun` and `selectOptimalModel`, **neither of which the cloud
transport calls** — so the limit was green in the suite and unenforced on the one path that
spends master's allowance. **`_canRun`'s `if (limit)` with no `else` admitted an
unregistered provider's traffic unmetered; it now REFUSES — and `selectOptimalModel`'s
`else { return … 'no-rate-limit' }` was worse, treating a missing entry as an affirmative
SELECTION. The assertion that every shipped provider HAS a row is what makes refusing safe
instead of a capability regression**, and `hasOwnProperty` guards keep `__proto__` from
resolving through the prototype chain — in `_canRun`, in `admit`, in `recordApiUse` and in
`_tick`'s previously unguarded `usedReq++`.

**BUT REFUSING AT `_canRun` ALONE WOULD HAVE TRADED ONE DEFECT FOR A WORSE ONE.** `_canRun`
returning `false` means *"not this tick"*, so `dequeue` simply never selects the task: it
renders as `queued` forever and says nothing. And `aiProvider` is **free text from the UI** —
`Resources.jsx:155` is a bare `<input>` submitted verbatim — so a typo'd provider would hang
silently in the queue. **So an unknown provider is refused where it is ASKED FOR:
`submit()` THROWS**, the `orchestrator:submit` handler turns that into
`{ ok: false, error }` naming the provider, and `Resources.jsx` gains the `else` branch it
never had. Thrown rather than returned because `submit()`'s success contract is a bare id
**string** and its one caller wraps it — changing the return type would have broken the wrap,
which is the opposite of additive. `_canRun`'s refusal stays as defence in depth, and the
suite asserts the refusal is **REPORTED** and **nothing is enqueued**, because a
queued-forever task and a refused one are otherwise indistinguishable.

### 131.8 Hosted web search — assessed, and wired

`web.search` → `browser:search`, whose **first line** is
`if (!playwright) return { ok: false, error: 'playwright not installed' }`. On master's
target machine that dependency is absent. **And it is dark for a second reason: NOTHING IN
THE TREE INVOKES `browser:search` AT ALL** — `browserEngine` registers it, `preload` binds
it, `ramaCore` only *plans* a step naming the tool and declares it in `TOOL_REGISTRY`; there
is no tool executor. Ollama's hosted search is keyed on the same credential, needs no
Playwright and no daemon, and costs no new dependency. **Decided: wire the BACKEND** — cloud
first, the Playwright path second, explicit absence third, each reporting which answered;
nothing removed (I11). It gets its **own** admission row and is gated on the **existing**
`browser.search`, because a capability that already exists does not need a new key. And it
goes through `egressBoundary` with **no bare-string allowance for the query** — **a search
query is the most natural route for private context to leave a machine, because a query is
SUPPOSED to contain whatever the user is curious about** — with the classification decided
**once, above backend selection**, so the refusal binds the Playwright path too (§131.6).

**AND STEP 2 NEEDED SIX LINES IN `browserEngine.cjs`, BECAUSE AS WRITTEN IT WAS NOT
IMPLEMENTABLE.** An earlier draft said the Playwright path is *"invoked through
`browserEngine`'s handler"*. It cannot be: the logic is a closure inside `register(ipcMain)`
over module-scoped state, the signature is positional `(_e, query, engine)`,
`module.exports` is `{ register, closeBrowser, getBrowserPid }`, and **an `ipcMain` handler
cannot be called from main-process code.** The handler body becomes
`async function searchWeb(query, engine = 'bing')`, the handler delegates to it, and
`module.exports` gains it — **a pure refactor, no behaviour change, asserted by requiring
`{ ok: false, error: 'playwright not installed' }` from both entry points when `playwright`
is absent.** Dropping step 2 instead was the smaller diff and was rejected: it would leave
the Playwright egress reachable only through the ungated legacy channel, which is §131.6's
defect re-opened by a different route.

**Stated plainly rather than overclaimed: this tranche builds the backend AHEAD OF ITS
CALLER.** No consumer is wired, so the first observable behaviour is a suite assertion, not
a working search in the UI. The tool executor is named as follow-up. The honest version of
the claim is *"the backend that can work on master's machine now exists and its leak surface
is reviewed"* — **not** *"a dark capability became a working one"*, which is what an earlier
draft of this section said and was not true.

### 131.8b THE FEATURE HAD TO BE REACHABLE, AND IT WASN'T

Three facts, each verified by reading, that together meant the designed feature could not
have served the machine it exists for:

**(1) `selectModel` could not return a cloud id.** `FALLBACK_CHAIN` is a hardcoded seven-id
array with no cloud entry, and the four passes are roles over `discoveredOllama`, an
`offline`-caps pass (which cloud rows must fail by design), the `FALLBACK_CHAIN` loop, and
`discoveredOllama` again — then `return primaryModel`, i.e. `'gpt-4o'`. On master's machine
that resolves to a model with no key, throws, and walks a chain in which nothing is
available. **A last-resort cloud pass is appended after the local passes and before the
hardcoded primary — local still beats cloud, because the free tier allows one concurrent
request — and it is asserted in both directions: with the dummy key it returns an
`ollama-cloud/*` id, with the vault empty it does not.**

**(2) `models:chat`'s chain reported ABSENT as BROKEN.** It is `catch { continue; }`: it
logs nothing, it cannot tell a missing credential from a 500, a fallback answers carrying
only `fallbackFrom` with no cause, and when nothing else is available it returns
`All models failed. Last error: no Ollama API key is stored` — **which is the target
machine's exact state, reported as a failure.** The chain now accumulates `unconfigured[]`
separately from `failures[]`, logs only genuine failures, carries `unconfigured` **beside**
`fallbackFrom` so a substitution is declared, and returns `{ ok:false, unconfigured, error,
remedy }` — never `All models failed` — when nothing was configured.

**(3) The capability gate was either always-closed or never-run.** `capability.can(null, …)`
is hardcoded `false` and `models:chat` destructured no `user` at all, so a gate inside the
transport would have denied **every** cloud call while looking like a policy decision.
**Settled as step 0: an explicit `user` is required; `undefined` is a PROGRAMMING ERROR
returning `gateError` and logging at `console.error`; `null` is a genuine denial — and
`models:chat` now threads `user` through to the transport, which is what makes the gate run
rather than stand shut.** Both no-user cases are asserted to make **zero** HTTP calls.

**(4) AND THE THREAD-THROUGH WAS STILL BROKEN IN TWO PLACES, EACH OF WHICH ALONE MADE EVERY
CLOUD CALL RETURN `gateError`.** The dispatch site passed **three** arguments to a
**four**-parameter `ollamaCloudChat`, so `user` was `undefined` by construction; and the
renderer wire was attributed to `Models.jsx`, which **has no `models.chat` call site at
all** — the only caller in the tree is `src/services/ramaClient.js:23`, inside
`ramaChat.send`. Both fixed, and **the suite now asserts the POSITIVE case** — a master-tier
user's request **reaches** the HTTP stub through the real `switch` — because a suite that
asserts only the refusals cannot tell a gate that is correctly shut from a gate that is
shut by a dropped argument. `ramaChat.send`'s two callers, `Chat.jsx:219` and `IDE.jsx:253`,
**both already hold `currentUser`**, so nothing is left to discover.

**(5) `priority` was passed and never declared.** `chat()` called
`admit({ …, priority })` from a signature that did not list it — an undefined variable,
defaulted back to `NORMAL` by `admit`, so the parameter master's critical work depends on was
silently inoperative. Declared, clamped, and given its own validation row. **And the
`CRITICAL` story was self-contradictory**: `admit` bypasses on `CRITICAL`, but `reserveSlot`
had no priority argument, so a critical cloud request was still **refused** whenever the one
slot was busy — the stated principle and the specified sequence disagreed, and the suite
asserted the principle. **Settled: `CRITICAL` WAITS for the slot, bounded**, because one
concurrent request is a physical limit of the free tier and bypassing it buys a 429 rather
than a faster answer. Loyalty outranks throttling; it does not outrank arithmetic.

### 131.9 Not verified

**THE NETWORK IS BLOCKED FROM THIS WORKSPACE** — `https://docs.ollama.com/api` failed TLS —
so **every Ollama fact here is taken from the brief and cross-checked against
OLLAMA_ONLY.md, and NONE was confirmed against live documentation in this run.** **The
hosted-search endpoint path, body and response shape are not known** and must be read before
`webSearch()` is written; that is the one part not implementable from the design alone.
**Thirteen of fourteen `apiModel` values are INFERRED** from daemon tags by the derivation
rule — only `gemma4:31b` is attested — which is why `listModels()` exists and why unknown
mappings are `null`; `daemonTag` is the **attested** column, `apiModel` the **inferred** one,
and the table says so per column. **`assemble`'s ENVELOPE FIELD LIST is provisional on the
same unverified request shape** — the structural rule (one constructor, no `JSON.stringify`
anywhere else) is firm; the field names are not, and a field that turns out to be needed is
added to the envelope rather than at the call site. Free-tier accessibility comes from a
**third-party tracker, ~2.5 weeks stale when recorded**; a wrong row surfaces as an explicit
plan error with the model named and no substitution. Behaviour at **zero credits** is
unverified. The `browserEngine` extraction is **claimed behaviour-preserving from reading,
not from running** — there is no `playwright` and no `ipcMain` here. **`node_modules` is not
installed, so no assertion has been executed and NO CLAIM IS MADE THAT THE BUILD PASSES.**
**What WAS measured: the secret matcher over `electron/ src/ server/ scripts/ shared/` —
194 files, 0 prefix hits, 0 entropy hits, exactly 2 without the discriminators — from a
probe written outside the repo and deleted. Nothing has been run against a real credential,
and must not be.**

### 131.10 Raised for master

**`"models.use-cloud": 1`** in `shared/capabilities.json` — tier 1, matching
`models.add-key` and `models.ollama-pull`, because spending a metered allowance and sending
bytes off the machine is a different act from running a local model (`models.use`, tier 3).
**`shared/capabilities.json` is PROTECTED, so it is SPECIFIED, NOT ADDED.** And because
`capability.can()` denies an unknown key, gating on it would make the feature **dead rather
than degraded** — so the gate is an **optional tightening**: it uses the dedicated key when
`capability.MATRIX` has it and `models.use` otherwise, **says which one is in force**, and
needs no code change when master adds it. Search needs no new key.

**ALSO RAISED, AND NOT TAKEN: whether the credential scan becomes numbered invariant
`I18`.** It is added as its own `I-SECRETS` row rather than by widening I12, because I12's
locked text is about `console.log`, pinned dependencies and placeholders. Unnumbered, it
enforces identically in both chains; numbered, Section 28's list would once again describe
everything the covenant chain enforces. **Rāma's recommendation is to promote it, in a
separate commit touching only Section 28 — and Rāma does not do it.**

**Master's setup path is three steps: unlock the vault, Models → Cloud → Ollama Cloud → Add
key, confirm the strip reads `key PRESENT (vault)`. There is no `.env` step and no
environment variable — RĀMA READS NO CREDENTIAL FROM `process.env` AT ALL, asserted. And the
distinction that matters: `.env` IS loaded into `process.env` by `start.cjs`, so a key put
there would be exposed to every child process AND still unusable by Rāma — which is why
`--diagnose` warns about one, naming no part of it.** If the strip reads *vault locked —
unlock to use the stored key*, the key is already there and Rāma will not ask again.

### 131.11 Next

Build in the order the assertions were written: `egressBoundary.cjs` and the leak sweep
first, because everything else sends bytes; then `ollamaCloud.cjs` with the naming table and
the step-0 gate; then the orchestrator rows, `admit`'s provider block, `reserveSlot`'s
bounded `CRITICAL` wait and `submit`'s refusal; then `browserEngine.cjs`'s six-line
extract-and-export, so `models:search-web` has a second backend to order; then
`modelRouter`'s changes — the two handlers, the `user` thread-through **with four arguments
at the dispatch site**, the `unconfigured` chain, the last-resort cloud pass and the
`FALLBACK_CHAIN` export; then the renderer wires — `ramaClient.js`, `Chat.jsx`, `IDE.jsx`,
`Resources.jsx`'s error branch and `Models.jsx`'s `PROVIDER_LINKS` row and vault-locked
branch; then `start.cjs`'s diagnostic lines and the `.env` warning; then the `I-SECRETS` row
and its two planted cases in `verifyInvariants.cjs`.

**Then, separately: a tool executor for `TOOL_REGISTRY['web.search']`** — without one, both
search backends have no caller — **and feeding `ollama-cloud/*` into the role engine.**
`modelRouter` passes only `Object.values(discoveredOllama)` to `modelRoles`, so after this
tranche a cloud row **is selectable by `selectModel`** but still **cannot fill a role**, and
§131.5's gate is asserted ahead of the path that will need it.
```

### 15.2 The ledger row — `| 151 | … |`, appended after row 150

```markdown
| 151 | The keyed cloud path, and the credential Rāma must never speak | in-progress | Section 131. Master: *"ollama api key with name Rama; utilise it"*. **DESIGNED, NOTHING BUILT.** **WHY A SECOND OLLAMA PATH: `docs/research/OLLAMA_ONLY.md` answered Section 130's Ollama-only scope for the mechanism it knew — `ollama signin` on a LOCAL INSTALL, after which the daemon authenticates cloud requests itself and Rāma holds NO credential at all. That report is not retracted and that path keeps working untouched (I11). But master's machine is 16 GB WITH NO OLLAMA INSTALLED, and the decisive fact is that CLOUD REQUESTS DO NOT REQUIRE AN OLLAMA INSTALLATION — `refreshOllamaModels()` probes `localhost:11434`, gets ECONNREFUSED, sets `detectedOllamaModels = []`, and every role falls to `fit: 'none'`. So this is the mechanism OLLAMA_ONLY.md never covered, added BESIDE the one it did.** **CONFLATING THE TWO AUTH MECHANISMS IS THE PRINCIPAL HAZARD — `signin` (daemon holds the credential) vs an API key (Rāma holds it and sends `Authorization: Bearer` to `https://ollama.com/api`), with local access at `localhost:11434` needing no auth at all. Blur them and you send master's Bearer token to a daemon, or expect a daemon-authenticated call to work with no daemon. They are kept apart BY CONSTRUCTION: a distinct module, a distinct provider (`ollama-cloud`), a distinct id namespace (`ollama-cloud/<api-name>` vs `ollama/<daemon-tag>`) and a distinct rate-limit row — because `allModels()` is `{ ...MODEL_REGISTRY, ...discoveredOllama }` and DISCOVERY SILENTLY WINS EVERY COLLISION, so a shared namespace would let a local pull overwrite a cloud entry and change a request's path with no visible cause.** **THE CREDENTIAL IS NEVER SPOKEN, AND IT IS ASSERTED RATHER THAN PROMISED: the value was never given to this session and never asked for; no log line at any level carries it, any part of it, its length or a hash; a diagnostic reports exactly PRESENT or ABSENT; `credentialState()`'s key set is PINNED to `{present, source, vaultUnlocked, reason}` so a `prefix` or `length` field cannot be added without the suite failing. THE CENTREPIECE ASSERTION IS BEHAVIOURAL, NOT STRUCTURAL, because no regex over source can prove a value never escapes — inject the dummy `test-not-a-real-key`, capture all three console channels, call EVERY exported function across the success path and every failure row, and assert the dummy appears EXACTLY ONCE IN THE WHOLE CORPUS, in the `Authorization` header the stub client received, with NO SUBSTRING OF LENGTH ≥ 6 anywhere else — which is what catches a well-meant `key.slice(0, 8)` in a log line. Plus a secret scan in `verifyInvariants.cjs` over `electron/ src/ scripts/ shared/` (its own walker, because `walkShipped` skips `scripts/`) added as ITS OWN `I-SECRETS` ROW AND NOT AS A WIDENING OF LOCKED INVARIANT I12 — I12's text is `console.log`/pinned deps/placeholders, a credential scan is a different property, and quietly widening a locked invariant is what the resume protocol forbids; promotion to a numbered `I18` in Section 28 is RAISED FOR MASTER with a recommendation to promote, not taken. The matcher rejects identifier- and kebab-worded runs and requires a digit, because WITHOUT THOSE TWO DISCRIMINATORS IT IS MEASURABLY RED ON THE FIRST COMMIT on two English strings that are not credentials (`src/services/ghostMode.js:130`, `scripts/verifySelfModel.cjs:307`) which the one-entry allow-list rule could not have silenced — and a check that cries wolf gets disabled. The allow-list holds EXACTLY ONE entry and it is the discriminators, not the list, that keep the scan quiet. A tracked-file sweep via `git ls-files`, and TWO planted cases joining the existing THIRTEEN in the `--self-test` harness — `I-SECRETS-planted` (a `.cjs` under `electron/`) and `I-SECRETS-planted-md` (a tracked `.md`) — EACH WITH ITS LITERAL BUILT BY CONCATENATION so this suite's own source is not a hit for the scan it installs, because that file's own header is right that a test which can quietly pass is worse than no test. THE WALK COVERS FIVE TREES, NOT FOUR: `electron/ src/ server/ scripts/ shared/` — the first draft dropped `server/`, which `walkShipped` covers for every other invariant and which holds `server/routes/auth.cjs`, while the tracked-file sweep applies only the PREFIX matcher, so a high-entropy credential literal there was caught by NEITHER HALF. Measured this session: with `server/` included the matcher still reports 194 files, 0 prefix hits, 0 entropy hits, so it costs nothing. AND WHICH SOURCE VIEW EACH MATCHER READS IS SPECIFIED, because the wrong choice makes the scan PERMANENTLY GREEN: `nc` (comments blanked, literals intact) for `.cjs/.mjs/.js/.jsx`, because a credential lives in a LITERAL and against the `code` view every literal is spaces so NOTHING CAN EVER MATCH; and RAW for `.json/.md`, which `views()` is a JavaScript comment-stripper and cannot parse — a `//` inside a URL would blank the rest of the line. `I-SECRETS-planted-md` exists to assert THAT CHOICE, so routing every extension through `viewOf` fails rather than passing for the wrong reason. AND THE SUITE'S OWN BANNER IS CORRECTED: `verifyInvariants.cjs:1021` prints "the 17 locked invariants" before iterating `INVARIANTS`, so an 18th row makes it print 17 while 18 run — it becomes "the 17 locked invariants, plus the rows not yet numbered", and the same clause goes on the file header, because §13.1b's whole argument for promoting I18 is that the enforced set and the described set must agree and a banner that misstates the count is that defect at smaller scale IN THE FILE THAT EXISTS TO STOP IT.** **THE CREDENTIAL HAS EXACTLY ONE HOME: THE VAULT — FOR THE OPPOSITE OF THE REASON AN EARLIER DRAFT GAVE. One draft offered `process.env.OLLAMA_API_KEY` and a `.env` line as a bootstrap; the next removed it on the grounds that "nothing parses a `.env` file". THAT WAS FALSE, AND IT WOULD HAVE SHIPPED AS A COMMENT INSIDE `.env.example`. `start.cjs:150-180` (`loadEnv`) PARSES `.env` INTO `process.env` AND CREATES `.env` FROM `.env.example` WHEN `.env` IS ABSENT, and `start.cjs` spawns every child with `env: { ...process.env }` (L886, L1004, L1129, L1197, L1271) — so the reason to keep the key out of `.env` is NOT THAT NOTHING READS IT, IT IS THAT EVERYTHING DOES: one paste puts it in plaintext on disk and in the Vite, server and sandbox children, and `.env.example` actively invites it, already listing OPENAI_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY/GITHUB_TOKEN as shape hints. THE VAULT IS THE ONLY STORE: `source` is `'vault' | null`, `suggestVaultImport` is deleted, and the decision is DEFENDED THREE WAYS rather than asserted once — `.env.example` carries the key NAME ONLY INSIDE A COMMENT that says the file IS loaded and the key must not go there; `--diagnose` WARNS when `.env` carries an `OLLAMA_API_KEY=` line, NAMING NO PART OF THE VALUE; and it is asserted that NO SHIPPED MODULE CONTAINS the expression `process.env.OLLAMA_API_KEY`. That last one is load-bearing: it cannot stop a key reaching `.env`, it stops Rāma reading it from there. The two §12.3 bullets about that expression previously CONTRADICTED each other — one forbade it, the next enumeration permitted it — and a permissive resolution would have reopened the source silently with the suite still green; the enumeration no longer lists it.** **THE MODEL NAMES DIVERGE AND ONE DIRECTION FAILS SILENTLY: the keyed API takes the cloud-list name (`gemma4:31b`), the daemon/CLI/app take a `-cloud` tag (`gemma4:31b-cloud`, `gemma4:cloud`). Daemon tag → API is a loud not-found. API NAME → DAEMON IS THE SILENT ONE, because `gemma4:31b` is ALSO A PLAUSIBLE LOCAL PULL TAG, so a request master believes went to the cloud can run locally or stall on a 31B download. Hence a FROZEN TABLE, authoritative both directions, `null` for anything unknown and NEVER a derived guess — the derivation rule validates the table in a TEST and decides nothing at runtime, because the reverse direction cannot be derived safely. A daemon tag handed to the keyed transport is refused BEFORE any request, asserted by the stub recording ZERO CALLS — a refusal after the bytes have left is not a refusal.** **ONE CORRECTION TO THE PREMISE, recorded so the next session does not think the document is wrong: `paramsB()`'s regex is anchored at the START and NOT THE END, so `31b-cloud` → 31 as well as `31b` → 31. Direct-API naming is NEVER WORSE rather than strictly better; the real split is sized vs unsized (`gemma4` → `null`, no `:` at all). The valuable consequence is unchanged: `gemma4:31b` → 31 clears `reasoning`'s 14B floor → `declared` instead of `substitute`, and the registry calls the REAL `paramsB()` rather than copying the table's number so the two can never disagree.** **A CLOUD MODEL IS NOT PRIVATE SO `narration` MUST STILL REFUSE IT: `evaluate` refuses `private !== true`, so `false` AND `undefined` both refuse today — but relying on `undefined` is relying on an accident, so `private: false` is explicit and the refusal is asserted FIVE WAYS (row shape; behavioural `fit: 'none'`; the reason text naming the leaving-the-machine rule, so a reword cannot pass a sensitive prompt while sounding right; the `undefined` case; PLUS THE INVERSE — that the same row IS fit for `reasoning` — so the refusal is proven to be about sensitivity rather than cloud rows failing everything) AND A SIXTH WITHOUT WHICH THE OTHERS WERE VACUOUS: `evaluate` returns `{fit:'none', reasons:['no model supplied']}` for anything with no `model.id`, BEFORE the privacy gate (modelRoles.cjs L146-148), and in MODEL_REGISTRY the id is the object KEY not a field — so an earlier draft's row had none, the narration refusal passed FOR THE WRONG REASON, the reason-text assertion failed and the inverse failed. Fixed both ways: every emitted row carries `id: 'ollama-cloud/<apiModel>'`, and the suite asserts `reasons[0] !== 'no model supplied'`. THE DEFENCE THIS DESIGN WEIGHTS HIGHEST WOULD OTHERWISE HAVE SHIPPED GREEN AND PROVED NOTHING. Note the ordering: role selection passes only `Object.values(discoveredOllama)`, so cloud rows STILL CANNOT FILL A ROLE, and the gate is asserted correct BEFORE the path to it exists.** **SECTION 130.8's GATE IS ON THE PAYLOAD AND THE TRANSPORT OWNS IT — not the role engine (which never sees a payload) and not the caller (callers get refactored and there will be more of them). The transport is the one place bytes leave the machine, so it is the only place the rule can be TRUE rather than currently true. `egressBoundary.cjs` is the ONLY constructor of a cloud body, asserted structurally, and `maxLevel` is computed across `messages` AND `parts` TOGETHER so fifty public rows plus one private row refuse AS A WHOLE — the join case Section 130.8 names. AND THAT LAST WORD IS A CORRECTION: an earlier draft classified ONLY `parts` and pinned `messages[].content` to a plain string, so THE FIELD THAT ACTUALLY CARRIES THE PROMPT crossed unexamined, `maxLevel` was computed over an empty array and resolved `public`. Now a message's `content` is either a bare string (→ public, preserving today's callers) or `{text, classification}`; AN OBJECT WITH THE CLASSIFICATION ABSENT, undefined, null or empty IS REFUSED exactly as an unrecognised value is, because choosing the object shape is choosing to classify; and the join assertion plants its private row INSIDE `messages`, the path callers use. SEARCH GOES FURTHER AND ACCEPTS NO BARE STRING AT ALL — a bare query would resolve to `public` and EVERY query would pass, which would make the gate decorative against the one risk this section names; there are no legacy search callers to protect and a query is one short field, so `query: {text, classification}` is required and a bare string is refused with zero HTTP calls. `private` refused unconditionally; `internal` needs TWO independent switches because one switch gets flipped by a default; an unrecognised classification FAILS CLOSED. Honest degradation: with no context store built every part today is a bare string resolving to `public` and the gate refuses nothing — its value is that row 150's store arrives to a gate it PLUGS INTO rather than one it must RETROFIT, which is the failure Section 127 names by name.** **`API_RATE_LIMITS.ollama: { reqPerMin: 9999 }` WAS RIGHT AND IS NOW ALSO WRONG — right for a local daemon, wrong for a free plan whose constraint is ONE CONCURRENT REQUEST plus a monthly credit pool, and OLLAMA_ONLY.md §F.3 had already found THE SHAPE CANNOT EXPRESS THE LIMIT (concurrency is not a rate; a monthly pool is not a per-minute budget). So: separate `ollama-cloud` and `ollama-search` rows (search must not eat the single inference slot); `maxConcurrent`+`inFlight` with reserve/release INSIDE `resourceOrchestrator` so I10 keeps its monopoly, a `Math.max(0, …)` floor so a double-release cannot manufacture capacity, and a mandatory `finally` because a leaked slot on a 1-slot row is a PERMANENT OUTAGE. `tokPerMin: null` and `monthlyTokenBudget: null` are deliberate — Ollama does not expose the remaining balance, so Rāma reports WHAT IT HAS SPENT and NEVER WHAT REMAINS; a guessed budget would be the invented number Section 126 exists to prevent. AND THE THIRD FINDING WAS THE WORST: `modelRouter` calls `orchestrator.admit()` NOWHERE and `admit()` never looked at `aiProvider` at all, so a cloud call would have passed through NO ADMISSION CHECK WHATSOEVER — `admit({ aiProvider })` closes it, defaulting `null` so the THREE existing call sites in three modules (`agentOrchestrator.cjs:281`, `instanceManager.cjs:312`, `sandboxEngine.cjs:242`; `resourceResearchEngine` mentions `admit()` only in a comment) stay byte-identical. `_canRun`'s `if (limit)` with no `else` admitted an unregistered provider unmetered and now REFUSES; `selectOptimalModel`'s `else { return … 'no-rate-limit' }` was worse, treating a missing entry as an affirmative SELECTION. The assertion that EVERY SHIPPED PROVIDER HAS A ROW is what makes refusing safe instead of a capability regression, and `hasOwnProperty` guards stop `__proto__` resolving through the prototype chain. AND `selectOptimalModel` COULD NOT RUN AT ALL: it destructures `FALLBACK_CHAIN` from a `require` that SUCCEEDS, so the catch default never applies, `FALLBACK_CHAIN` is `undefined`, and `for (const modelId of undefined)` threw TypeError on EVERY call — editing and asserting on it would have been a green test on dead code. `FALLBACK_CHAIN` is now exported (additive, one line, and it fixes the caller) and the suite asserts the function RETURNS before asserting what it returns. The courtesy `reqPerMin: 20` is compared WITH the 0.8 buffer, so the enforced ceiling is 16/min, not 20 — AND THAT CEILING IS NOW ASSERTED THROUGH `admit()`, THE FUNCTION THE CLOUD PATH ACTUALLY CALLS: it was previously asserted against `TaskQueue._canRun` and `selectOptimalModel`, NEITHER OF WHICH THE TRANSPORT TOUCHES (§2.5 goes admit → reserveSlot), so the limit was green in the suite and unenforced on the one path that spends master's allowance. `admit`'s provider block is written out field by field — hasOwnProperty lookup, refuse on no row, per-minute reset, `usedReq >= floor(reqPerMin × 0.8)`, `inFlight >= maxConcurrent` — each with its own named reason, three reasons not one. AND REFUSING AT `_canRun` ALONE WOULD HAVE TRADED ONE DEFECT FOR A WORSE ONE: `_canRun` returning false means "NOT THIS TICK", so `dequeue` never selects the task and it renders as `queued` FOREVER saying nothing — and `aiProvider` IS FREE TEXT FROM THE UI (`Resources.jsx:155` is a bare `<input>` submitted verbatim at L158), so a typo'd provider would hang silently. So an unknown provider is refused WHERE IT IS ASKED FOR: `submit()` THROWS, the `orchestrator:submit` handler turns that into `{ ok:false, error }` naming the provider, and `Resources.jsx` gains the `else` branch it never had (L381-383 acts only `if (res?.ok)`). Thrown rather than returned because `submit()`'s success contract is a bare id STRING and its ONE caller wraps it as `{ ok:true, id }` — changing the type would break the wrap, the opposite of additive. `_canRun`'s refusal stays as defence in depth, the suite asserts the refusal is REPORTED and NOTHING IS ENQUEUED, and the hasOwnProperty guard also goes on `_tick`'s previously unguarded `API_RATE_LIMITS[task.aiProvider].usedReq++`. The three orchestrator additions are METHODS on `ResourceOrchestrator`, not bare functions — I10's monopoly is on the instance that OWNS the counters — and `useOrchestrator(stub)` requires exactly `{ admit, reserveSlot, releaseSlot, recordApiUse }` and THROWS otherwise, so a stub cannot drift from the real instance while the suite stays green about admission that did not happen.** **HOSTED WEB SEARCH, ASSESSED AND WIRED: `web.search` → `browser:search`, whose FIRST LINE is `if (!playwright) return { ok:false, error:'playwright not installed' }` — on master's target machine that dependency is absent, so the capability is NOMINALLY PRESENT AND PRACTICALLY DARK. Ollama's hosted search is keyed on the same credential, needs no Playwright and no daemon, and costs no new dependency (I12). Decided: WIRE IT — cloud first, Playwright second, explicit absence third, each reporting which answered, nothing removed. Its own admission row; gated on the EXISTING `browser.search`, because a capability that already exists needs no new key. And it goes through `egressBoundary` with NO BARE-STRING ALLOWANCE FOR THE QUERY, because A SEARCH QUERY IS THE MOST NATURAL ROUTE FOR PRIVATE CONTEXT TO LEAVE A MACHINE — a query is SUPPOSED to contain whatever the user is curious about. **AND THE GATE RUNS ONCE, ABOVE BACKEND SELECTION, WHICH IS THE WORST DEFECT FOUND IN REVIEW: an earlier draft gated ollama.com and then placed the Playwright path DIRECTLY BENEATH IT AS A FALLBACK, so a query refused as `private` fell through to `https://www.bing.com/search?q=…` (browserEngine.cjs L205-208). THE RULE WAS ENFORCED FOR ONE EGRESS AND BROKEN BY THE LINE UNDERNEATH IT. Bing is no less of a network than ollama.com, so the module is named `egressBoundary` — "egress" means OFF THIS MACHINE, not "ollama.com", because a name read as a scope limit is how the next session re-opens this — the classification is decided once in `models:search-web`, A REFUSAL IS TERMINAL FOR EVERY BACKEND, and the assertion is that a private or bare-string query leaves THE HTTP STUB AND THE PLAYWRIGHT STUB WITH ZERO CALLS. AND STEP 2 WAS NOT IMPLEMENTABLE AS WRITTEN: `browser:search` is a CLOSURE inside `register(ipcMain)` over module-scoped state, positional `(_e, query, engine)`, and `module.exports` is `{ register, closeBrowser, getBrowserPid }` — an ipcMain handler CANNOT be called from main-process code. Six lines in `browserEngine.cjs` extract the body as `async function searchWeb(query, engine = 'bing')`, the handler delegates, exports gain it: a pure refactor asserted by requiring `{ ok:false, error:'playwright not installed' }` from BOTH entry points when playwright is absent. Dropping step 2 was the smaller diff and was rejected — it leaves the Playwright egress reachable only through the ungated legacy channel, the same defect by another route. ONE HONEST LIMIT: `browser:search`'s own direct IPC channel keeps its unclassified query — pre-existing, tier-3 gated, NO CALLER IN THE TREE, not modified here; every egress `models:search-web` can reach is gated, the legacy channel is not, and it is NAMED rather than quietly omitted.** THE CHANNEL IS `models:search-web`, NOT `search:web`: `genome.cjs:77` declares `g.model-router` with `channels: ['models:']`, so `search:web` would be a channel Rāma's own self-model does not describe, and `auditRenderer` only checks invoke↔handle parity so NOTHING WOULD TURN RED — renaming stays inside the declared prefix and needs no genome edit. AND IT IS DARK FOR A SECOND REASON AN EARLIER DRAFT MISSED: NOTHING IN THE TREE INVOKES `browser:search` AT ALL — `browserEngine` registers it, `preload` binds it, `ramaCore` only PLANS a step naming the tool and declares it in TOOL_REGISTRY; there is no tool executor. SO THIS TRANCHE BUILDS THE BACKEND AHEAD OF ITS CALLER, the first observable behaviour is a suite assertion rather than a working search, and the honest claim is that the backend which can work on master's machine now exists with its leak surface reviewed — NOT that a dark capability became a working one.** **THE FEATURE ALSO HAD TO BE REACHABLE, AND IT WASN'T. (1) `selectModel` COULD NOT RETURN A CLOUD ID: `FALLBACK_CHAIN` is a hardcoded seven-id array with no cloud entry, and the four passes are roles over `discoveredOllama`, an `offline`-caps pass (which cloud rows must fail by design), the FALLBACK_CHAIN loop, and `discoveredOllama` again — then `return primaryModel`, i.e. `'gpt-4o'`, which on master's machine has no key, throws, and walks a chain in which nothing is available. A LAST-RESORT CLOUD PASS is appended after the local passes and before the hardcoded primary — local still beats cloud because the free tier allows one concurrent request — asserted BOTH WAYS: with the dummy key `selectModel('general')` returns an `ollama-cloud/*` id; with the vault empty it does not, because an unreachable model must not be SELECTED. (2) `models:chat`'s CHAIN REPORTED ABSENT AS BROKEN: it is `catch { continue; }` — it logs NOTHING, a missing credential is indistinguishable from a 500, a fallback answers carrying only `fallbackFrom` with no cause, and when nothing else is available it returns `All models failed. Last error: no Ollama API key is stored`, WHICH IS THE TARGET MACHINE'S EXACT STATE. The chain now accumulates `unconfigured[]` separately from `failures[]`, logs only genuine failures (which it does not do today at all), carries `unconfigured` BESIDE `fallbackFrom` so a substitution is DECLARED, and returns `{ok:false, unconfigured, error, remedy}` — NEVER `All models failed` — when nothing was configured. (3) THE CAPABILITY GATE WAS EITHER ALWAYS-CLOSED OR NEVER-RUN: `capability.can(null, …)` is hardcoded false and `models:chat` destructured no `user` at all, so a gate in the transport would have denied EVERY cloud call while looking like a policy decision. Settled as STEP 0: an explicit `user` is required; `undefined` is a PROGRAMMING ERROR returning `{ok:false, gateError:true}` and logging at console.error, DISTINCT from a denial so a missing wire-up never reads as a permissions problem; `null` is a genuine denial — and `models:chat` now threads `user` through `chatCompletion → ollamaCloudChat → cloud.chat`, which is what makes the gate run rather than stand shut. Both no-user cases make ZERO HTTP CALLS, asserted. (4) AND THE THREAD-THROUGH WAS STILL BROKEN IN TWO PLACES, EACH OF WHICH ALONE RETURNED `gateError` ON EVERY CLOUD CALL: the dispatch site passed THREE arguments to a FOUR-parameter `ollamaCloudChat`, so `user` was `undefined` by construction; and the renderer wire was attributed to `Models.jsx`, WHICH HAS NO `models.chat` CALL SITE AT ALL — the only caller in the tree is `src/services/ramaClient.js:23` inside `ramaChat.send`, whose own two callers `Chat.jsx:219` and `IDE.jsx:253` BOTH ALREADY HOLD `currentUser` from `useUserStore()` (L149, L183), so nothing is left to discover. Both fixed, and THE SUITE NOW ASSERTS THE POSITIVE CASE — a master-tier user's request REACHES the HTTP stub through the real switch — because a suite that asserts only the refusals cannot tell a gate correctly shut from a gate shut by a dropped argument. (5) `priority` WAS PASSED AND NEVER DECLARED: `chat()` called `admit({ …, priority })` from a signature that did not list it, so `admit` defaulted it back to NORMAL and the parameter master's critical work depends on was silently inoperative — now declared, clamped, with its own validation row. AND THE CRITICAL STORY WAS SELF-CONTRADICTORY: `admit` bypasses on CRITICAL at L395, but `reserveSlot` had no priority argument, so a critical cloud request was still REFUSED whenever the one slot was busy — the stated principle and the specified sequence disagreed and the suite asserted the principle. SETTLED: CRITICAL WAITS FOR THE SLOT, BOUNDED (20 s default, `timedOut: true` on expiry, `console.warn` on timeout only), because one concurrent request is a PHYSICAL limit of the free tier and bypassing it buys a 429 rather than a faster answer. Loyalty outranks throttling; it does not outrank arithmetic. (6) `assemble()` COULD NOT PRODUCE EITHER BODY IT NEEDED: its signature was `{ messages, parts, allowInternal }` while `/api/chat` requires a `model` and search requires a `query`, and §12(g) forbids any body construction at the call site — so AS SPECIFIED NEITHER REQUEST COULD BE MADE. The WHOLE ENVELOPE moved into `assemble({ kind, messages, parts, query, model, stream, options, maxResults, allowInternal })`, it stays the only constructor, `kind:'chat'` with no `model` REFUSES, `options` is ENUMERATED (`think` boolean, `format` null|'json') with an unknown key refused rather than passed through, and the suite asserts POSITIVELY that an accepted envelope yields a body carrying `model`, `stream` and `messages` — because "no second constructor" is worth nothing if the one constructor cannot produce a sendable request. (7) AN ACCEPTED `part` HAD NOWHERE TO GO: `/api/chat` has no `parts` field and no rule said what happened to one, so parts either VANISHED — the silently shortened prompt rule 7 forbids — or got spliced into master's words by whatever the implementer invented. Each accepted part now becomes its OWN `{ role:'system' }` message appended AFTER the caller's messages, in order, nothing dropped and nothing truncated, refusing if a part cannot be represented; the suite asserts `counts.parts` equals the number of appended system messages.** **NOT VERIFIED: THE NETWORK IS BLOCKED FROM THIS WORKSPACE (`docs.ollama.com` failed TLS), so EVERY Ollama fact is taken from the brief and cross-checked against OLLAMA_ONLY.md and NONE was confirmed against live documentation in this run. THE HOSTED-SEARCH ENDPOINT PATH, BODY AND RESPONSE SHAPE ARE NOT KNOWN and must be read before `webSearch()` is written — the one part not implementable from the design alone. THIRTEEN OF FOURTEEN `apiModel` VALUES ARE INFERRED from daemon tags; only `gemma4:31b` is attested, which is why `listModels()` exists and unknown mappings are `null`. Free-tier accessibility comes from a THIRD-PARTY TRACKER ~2.5 WEEKS STALE when recorded; a wrong row surfaces as an explicit plan error with the model named and NO substitution. Behaviour at ZERO CREDITS is unverified. `node_modules` IS NOT INSTALLED, so no assertion has been executed and NO CLAIM IS MADE THAT THE BUILD PASSES. NOTHING HAS BEEN RUN AGAINST A REAL CREDENTIAL, AND MUST NOT BE.** **RAISED FOR MASTER: `"models.use-cloud": 1` — tier 1, matching `models.add-key`/`models.ollama-pull`, because spending a metered allowance and sending bytes off the machine is a DIFFERENT ACT from running a local model (`models.use`, tier 3). `shared/capabilities.json` is PROTECTED, so it is SPECIFIED, NOT ADDED — and because `capability.can()` denies an unknown key, gating on it would make the feature DEAD RATHER THAN DEGRADED, so the gate is an OPTIONAL TIGHTENING: the dedicated key when `capability.MATRIX` has it, `models.use` otherwise, SAYING WHICH IS IN FORCE, with no code change when master adds it. `verifyLoyaltyTripwire.cjs --approve` is NEVER run by Rāma. ALSO RAISED AND NOT TAKEN: whether the credential scan becomes numbered invariant `I18` in Section 28 — unnumbered it enforces identically in both chains, numbered the invariant list would again describe everything the covenant chain enforces; Rāma recommends promoting it in a separate commit touching only Section 28, and does not do it. Master's path is THREE STEPS: unlock the vault, Models → Cloud → Ollama Cloud → Add key, confirm the strip reads `key PRESENT (vault)` — THERE IS NO `.env` STEP AND NO ENVIRONMENT VARIABLE, because RĀMA READS NO CREDENTIAL FROM `process.env` AT ALL (asserted); and the distinction that matters is that `.env` IS loaded into `process.env` by `start.cjs`, so a key put there would be exposed to every child process AND STILL UNUSABLE BY RĀMA, which is why `--diagnose` warns about one while naming no part of it; if the strip reads `vault locked — unlock to use the stored key` the key is already there and Rāma will not ask again.** **BEFORE PASTING SECTION 131 OR THIS ROW: re-check that 131 and 151 are still free on `dev`. The ledger jumps 147 → 150 so rows 148-149 are UNASSIGNED, and Sections 128 and 129 are claimed IN PROSE (spec L14108; commit b93054b) with no section headers, so other in-flight worktrees appear to hold them.** **NEXT: build in assertion order — `egressBoundary.cjs` + the leak sweep FIRST, because everything else sends bytes; then `ollamaCloud.cjs` with the naming table and the step-0 gate; then the orchestrator rows, `admit`'s provider block, `reserveSlot`'s bounded CRITICAL wait and `submit`'s refusal; then `browserEngine.cjs`'s six-line extract-and-export so `models:search-web` has a second backend to order; then `modelRouter`'s changes (two handlers, the `user` thread-through WITH FOUR ARGUMENTS AT THE DISPATCH SITE, the `unconfigured` chain, the last-resort cloud pass, the FALLBACK_CHAIN export); then the renderer wires — `ramaClient.js`, `Chat.jsx`, `IDE.jsx`, `Resources.jsx`'s error branch, and `Models.jsx`'s PROVIDER_LINKS row and vault-locked branch; then `start.cjs`'s diagnostic lines and the `.env` warning; then the `I-SECRETS` row and its two planted cases. THEN, SEPARATELY, A TOOL EXECUTOR FOR `TOOL_REGISTRY['web.search']` — without one both search backends have no caller — and feed `ollama-cloud/*` into the role engine, which today cannot happen because `modelRouter` passes only `Object.values(discoveredOllama)` to `modelRoles`.** |
```

---

## 16. Summary of decisions made, so none is left to the implementer

| # | Decision | Chosen |
|---|---|---|
| 1 | where the transport lives | new `electron/lib/ollamaCloud.cjs`, **not** inline in `modelRouter`, **not** via `customProviders` (§2.1) |
| 2 | HTTP client | `net.request` from `lib/http.cjs` directly, following `customChat`; `httpPost`/`httpGet` untouched (§1.2) |
| 3 | id namespace | `ollama-cloud/<api-name>`, `provider: 'ollama-cloud'` (§3.1) |
| 4 | registry `type` | `'cloud'` — puts it in the Models cloud tab and makes `checkAvailable` test the credential with no code change (§3.2) |
| 5 | name mapping | frozen table, authoritative both directions, `null` on unknown; the rule validates the table in a test only (§4.3) |
| 6 | `ctxK` on cloud rows | `null` — unmeasurable on this path, so `long-context` correctly excludes them (§9) |
| 7 | credential store | **the vault, and nothing else.** No env var, no `.env`, no auto-import; `source` is `'vault' \| null`; asserted that no shipped module reads `process.env.OLLAMA_API_KEY` (§2.4) |
| 8 | base URL | configurable with seven hard validation rules; widening the host needs a **second** config key (§2.3) |
| 9 | payload gate | `egressBoundary.cjs`, enforced at the **transport**, the only body constructor (§5.3) |
| 10 | web search | **wire it**, cloud-first, own admission row, existing `browser.search` gate (§5.2) |
| 11 | missing rate-limit row | **refuse**, made safe by the every-provider-has-a-row assertion (§6.4, §6.5) |
| 12 | monthly pool | counted as *spent*, never as *remaining*; `monthlyTokenBudget: null` (§6.3) |
| 13 | capability | `models.use-cloud` tier 1 **specified for master**; optional-tightening gate so the feature degrades rather than dies (§13.1) |
| 14 | new suite placement | `verifyOllamaCloud.cjs` between `verifyOllamaLibrary` and `verifyWebResearch` (§12.1) |
| 15 | secret scan placement | `verifyInvariants.cjs` as **its own `I-SECRETS` row**, not a widening of locked **I12**; both chains still run it; promotion to `I18` raised for master (§12.2(b), §13.1b) |
| 16 | secret matcher | prefix list **plus** two discriminators — not identifier/kebab-worded, and must contain a digit — because without them it is red on the first commit; allow-list stays at one entry (§12.2(b)) |
| 17 | registry row `id` | **present as a field**, not only as the object key, because `modelRoles.evaluate` refuses `!model.id` before the privacy gate (§3.2, §3.3) |
| 18 | `messages` classification | `content` is a bare string (→ `public`) **or** `{ text, classification }`; `maxLevel` spans `messages` **and** `parts`; an object with no classification is **refused** (§5.3) |
| 19 | search query | **no bare-string allowance** — `{ text, classification }` required, a bare string refused with zero HTTP calls (§5.3) |
| 20 | capability gate | step 0 inside the transport; `user` **required**, `undefined` → `gateError`, `null` → denied; `models:chat` threads `user` (§2.5, §13.1) |
| 21 | cloud reachability | a **last-resort pass** appended to `selectModel` after the local passes, before `primaryModel`; largest-`paramsB` first (§3.4(c)) |
| 22 | absent-key reporting | `models:chat` accumulates `unconfigured[]` / `failures[]`, logs only genuine failures, declares substitutions, and never answers `All models failed` for a missing credential (§3.4(b)) |
| 23 | search channel | **`models:search-web`** — inside `g.model-router`'s declared `models:` prefix, so `genome.cjs` is untouched (§5.2) |
| 24 | search caller | **none in this tranche.** Backend built ahead of its caller, stated plainly; a tool executor is follow-up (§5.1, §14) |
| 25 | `FALLBACK_CHAIN` | **exported** from `modelRouter` — additive, and it fixes `selectOptimalModel`, which threw `TypeError` on every call without it (§6.4) |
| 26 | vault-locked rendering | the model row shows *vault locked — unlock to use the stored key* instead of **Add key**; `checkAvailable`/`credentialStatus` untouched (§7.1) |
| 27 | `--diagnose` and the credential | **it reports neither PRESENT nor ABSENT** — it cannot read the vault and reads no credential from `process.env`; it names where the answer lives instead, **and warns if `.env` carries an `OLLAMA_API_KEY=` line, naming no part of the value** (§7.3) |
| 28 | the payload-gate module's **name** | **`egressBoundary.cjs`**, not `cloudBoundary.cjs` — "egress" means off this machine, so the name cannot be read as a scope limit that excludes Bing (§5.2, §5.3) |
| 29 | where the search classification runs | **once, in `models:search-web`, ABOVE backend selection; a refusal is terminal for every backend.** The transport gates again, deliberately, for a second entry point added later (§5.2) |
| 30 | the Playwright backend | **extract-and-export `browserEngine.searchWeb`** (~6 lines, no behaviour change) rather than dropping step 2, so both egresses sit behind one gate (§5.2) |
| 31 | `assemble`'s signature | **the whole envelope** — `{ kind, messages, parts, query, model, stream, options, maxResults, allowInternal }` — and it stays the only constructor; `options` is enumerated, never spread (§5.3, §9) |
| 32 | what an accepted `part` becomes | **its own `{ role: 'system' }` message, appended after the caller's messages, in order.** Nothing dropped, nothing truncated; `counts.parts` is asserted against the appended count (§5.3) |
| 33 | `CRITICAL` and the one concurrency slot | **it WAITS, bounded (20 s), not bypasses.** One concurrent request is a physical limit; bypassing buys a 429, not a faster answer (§6.3, §8 row 7b) |
| 34 | an unknown `aiProvider` | **`submit()` THROWS and the handler reports it**; `_canRun`'s refusal stays as defence in depth. Thrown rather than returned because `submit`'s success contract is a bare id string (§6.4b) |
| 35 | the three orchestrator additions | **methods on `ResourceOrchestrator`**, so I10's monopoly is on the instance that owns the counters; `useOrchestrator(stub)` requires all four members and throws otherwise (§6.3, §2.2) |
| 36 | the renderer `user` wire | **`src/services/ramaClient.js` + `Chat.jsx` + `IDE.jsx`** — the only `models.chat` caller and its two callers, both of which already hold `currentUser`. Not `Models.jsx`, which has no such call site (§3.4(a), §14) |
| 37 | `status()`'s shape | **enumerated and frozen in §2.2** — fifteen keys, none derived from the credential value; `models:cloud-status` returns a **subset**, not a parallel shape (§2.2, §12.4(7)) |
| 38 | the secret scan's reach and view | **five trees** (`walkShipped`'s four **plus** `scripts/`), `nc` for the JS family and **raw** for `.json`/`.md`, with a planted markdown case asserting the view choice (§12.2(b), §12.2(c)) |




---

## 17. Responses to the FIRST design review (round 1)

Review round 1 — **CHANGES_REQUESTED**, 7 HIGH, 10 MEDIUM, 7 NIT. **Round 2's responses are
in §18**, and where the two disagree, §18 wins: round 2 found that one of the facts round 1
was answered with was itself false (finding 3 below, the `.env` bootstrap).

**All 24 findings are addressed; none is backlogged and none is ignored.** Every factual
claim in the review was re-verified against the worktree source in this session before
acting on it (the re-verification is recorded in §1.11), and all 24 held. Nothing in the
architecture changed: the module split, the `ollama-cloud/<api-name>` namespace, the frozen
name table with both-direction assertions and the zero-calls refusal, the transport-owned
payload gate, the concurrency slot inside the one admission authority, refuse-on-missing-row
made safe by the every-provider-has-a-row assertion, the capability key raised rather than
added, and the leak sweep as the centrepiece all stand as decided.

### HIGH

| # | Finding | Response | Where |
|---|---|---|---|
| 1 | registry rows carry no `id`, so the `narration` assertions are vacuous | **Addressed as recommended.** `id: 'ollama-cloud/<apiModel>'` on every emitted row, plus a sixth assertion that `reasons[0] !== 'no model supplied'`. | §3.2, §3.3, §12(f), §131.5 |
| 2 | `egressBoundary` classifies only `parts`; `messages` carries the prompt | **Addressed as recommended.** `content` is a bare string (→ `public`) or `{ text, classification }`; `maxLevel` spans both; refusal carries `where`/`index`; the join assertion plants its private row inside `messages`. | §5.3, §9, §12(g), §131.6 |
| 3 | the `.env` bootstrap is non-functional | **Decision addressed and still correct — the env source is dropped entirely. The REASON given was wrong and is corrected in §18 finding 1:** `.env` **is** parsed into `process.env` by `start.cjs:150–180`, so the ground for refusing it is that the value would be inherited by every spawned child, not that nothing would read it. | §2.4, §7.2, §7.4, §12.3, §13.3, **§1.12**, **§18(1)** |
| 4 | no cloud model is reachable through `selectModel` | **Addressed as recommended.** A last-resort pass after the `discoveredOllama` pass and before `primaryModel`, largest-`paramsB` first, with both-direction assertions (dummy key → cloud id; empty vault → not). | §3.4(c), §12(e), §131.8b |
| 5 | the absent-key state becomes a silent fallback in `models:chat` | **Addressed as recommended**, with one correction to the review's snippet: it referenced a `failures` array it had not declared, so both arrays are declared and a `note()` helper routes each error to the right one. `remedy` rides on the thrown error. | §2.7, §3.4(b), §8 closing, §12(d) |
| 6 | the capability gate has no enforcement point and no `user` reaches it | **Addressed as recommended.** Step 0 in §2.5, enforced inside the transport (not only the handler, so a later entry point cannot bypass it), `undefined` → `gateError` + `console.error`, `null` → denied, `user` threaded from `models:chat`. | §2.5 step 0, §13.1, §12(g2), §14 |
| 7 | the secret scan is red on the first commit and un-allow-listable | **Addressed as recommended.** `WORDY` rejection plus a required digit; both measured false positives re-read and confirmed here; the allow-list stays at one entry and the document now says the discriminators, not the list, are what keep it quiet. | §12.2(b) |

### MEDIUM

| # | Finding | Response | Where |
|---|---|---|---|
| 8 | the planted literal would match the scan in its own source | **Addressed as recommended.** Built by concatenation with the reason in a comment, plus an assertion that `verifyInvariants.cjs`'s own source has zero known-prefix matches. | §12.2(c), §12.3 |
| 9 | the scan silently widens locked invariant I12 | **Addressed as recommended.** Its own `I-SECRETS` row; `I12` untouched; `I-SECRETS-planted` self-test case; promotion to `I18` **raised** for master with a recommendation. | §12.2(b), §13.1b, §131.10 |
| 10 | vault-locked renders as `missing-key` with an Add-key button | **Addressed as recommended.** The rendering branch is specified; `checkAvailable` and `credentialStatus` are left alone; §12(d) asserts the states are distinguishable **as rendered**. | §7.1, §7.4, §12(d) |
| 11 | the Section 130.8 blockquote is part fabricated | **Addressed as recommended.** Only the spec's verbatim wording is quoted (re-read at spec L14055–14063 this session); the inference is stated separately in this design's own voice. | §5.3, §131.6 |
| 12 | `{ text }` with no `classification` is unspecified | **Addressed as recommended, failing closed.** Bare primitive → `public`; an object with the field absent/undefined/null/empty → refused with the same reason string as an unrecognised value. | §5.3 rule 2, §9, §12(g) |
| 13 | the web-search gate is decorative against the risk §5.1 names | **Addressed as recommended.** `query` must be `{ text, classification }`; a bare string is refused with zero HTTP calls; `private` refused as everywhere else. | §5.3, §9, §12(g) |
| 14 | `selectOptimalModel` throws, so the design edits dead code | **Addressed — the export is added** rather than declaring the function out of scope, because the alternative leaves §6.4's own change unreachable. §12(i) asserts the function *returns* first. | §1.5, §6.4, §12(i) |
| 15 | `search:web` is outside `g.model-router`'s declared prefix | **Addressed — option (a), the recommended one: renamed `models:search-web`.** No `genome.cjs` edit; `preload.cjs`'s binding name matches. | §5.2, §14 |
| 16 | the hosted-search backend has no consumer | **Addressed — the honest option.** The document now states that the backend is built ahead of its caller, that no caller is wired here, and that the first observable behaviour is a suite assertion. The "dark capability becomes working" claim is removed. | §5.1, §5.2, §14, §131.8 |
| 17 | the `--diagnose` output fits neither of `diagnose()`'s shapes | **Addressed, adapted for finding 3.** Three `add()` report lines, a `degraded` entry **and** a `degrade`-severity defect carrying the `fix`; and because the env source is gone, the credential line reports neither PRESENT nor ABSENT — it names where the answer lives. | §7.3 |

### NIT

All seven corrected: line numbers `706`/`716` for `httpPost`/`httpGet` with `745–753` noted
as `credentialStatus` (#18); **27** suites in `npm run verify` (#19); **three** `admit()`
call sites in three modules, with `resourceResearchEngine`'s comment-only mention noted
(#20); `'./http.cjs'` as the asserted require specifier (#21); `path`/`endpoint` arriving via
the `...result` spread, with `path` undefined for the five non-Ollama providers (#22); the
0.8 buffer applied to `reqPerMin`, so the enforced ceiling is **16/min** (#23); and the
ledger-numbering caution — 148/149 unassigned, 128/129 claimed in prose — written into both
§15.1's preamble and the row itself, for `docs/research/OLLAMA_CLOUD.md` (#24).

### The review's one unverified-gap flag

The review noted that `listModels()` is offered as the reconciliation mechanism for the
thirteen inferred `apiModel` values while `GET /api/tags` on the **keyed** endpoint is itself
unverified. **Accepted and written in:** §11.5 now says the reconciliation path depends on a
fact that is also inferred, and that it is the first thing to check on a run with network.

### What was NOT changed, and why

- **No architectural decision was revisited.** The review explicitly asked for none, and
  re-reading the findings against the source gave no reason to.
- **`checkAvailable` and `credentialStatus` stay as they are.** Both are correct about what
  they claim; the locked-vault distinction belongs where it is rendered, and widening them
  would change five other providers' behaviour for an Ollama-shaped problem.
- **`FALLBACK_CHAIN` gains an export, not an entry.** Master's configured preference order
  still wins where it applies; the cloud pass stays the last resort.
- **`RAMA_AGI_MASTER_SPEC.md` is still not edited,** `verifyLoyaltyTripwire.cjs --approve` is
  still never run, no protected file is touched, and nothing under `src/pages/StockMind/`,
  `proposals.cjs`, `selfRepair.cjs`, `releaseChannel.cjs` or `intelligenceEngine.cjs` is
  modified.
- **`node_modules` is not installed in this workspace,** so no assertion in §12 has been
  executed and **no claim is made that `npm run verify` or `vite build` passes.** The two
  false-positive strings in §12.2(b) and every source fact in §1.11 were verified by reading
  and grepping the files directly.

---

## 18. Responses to the SECOND design review (round 2)

Review: `docs/research/ollama-cloud-design-review.json` / `.md` — **CHANGES_REQUESTED**,
**6 HIGH, 11 MEDIUM, 3 NIT**, against this document at worktree `HEAD = 4fbe246`.

**All 20 findings are addressed. None is backlogged and none is ignored.** Every factual
claim in the review was re-verified against the worktree source in this session before being
acted on — the re-verification is §1.12, and **all 20 held**. Four of them surfaced facts the
review itself had not stated, recorded in §1.12 and used below: `submit()` returns a bare id
**string** (so finding 12's recommended fix would have broken its one caller), `ramaChat.send`
has exactly **two** callers and **both already hold `currentUser`**, `_tick` has a third
unguarded `__proto__` read, and the thirteen `MUTATIONS` ids.

**Nothing in the architecture changed.** The review asked for none, and re-reading gave no
reason to: the module split, the `ollama-cloud/<api-name>` namespace, the frozen
two-direction name table with the zero-calls refusal, the transport-owned payload gate, the
concurrency slot inside the one admission authority, refuse-on-missing-row made safe by the
every-provider-has-a-row assertion, the capability key raised rather than added, and the
dummy-key leak sweep as the centrepiece all stand as decided.

### HIGH

| # | Finding | Response | Where |
|---|---|---|---|
| 1 | `.env` **is** parsed into `process.env`; the design shipped that false claim into a tracked file | **Addressed as recommended, in full.** The vault-only decision is unchanged; its justification is rewritten to the true one — a plaintext `.env` value is loaded and inherited by every spawned child (L886/L1004/L1129/L1197/L1271). `.env.example`'s comment block now says the file **is** loaded and is **copied to `.env`**. `--diagnose` gains a `.env` warning plus a `degrade` defect, naming no part of the value. §12.3 gains the matching assertion, reported as a **residual** when `.env` is absent. §7.2 now states that the base-URL line is **live** via `.env`, which the old text understated. | §1.12(1), §2.4, §7.2, §7.3, §9, §12.3, §131.3, ledger row |
| 2 | the switch case passes three arguments to a four-parameter function, so every cloud call returns `gateError` | **Addressed as recommended.** `case 'ollama-cloud': return ollamaCloudChat(messages, modelId, info, user);` with the reason in a comment, **plus §12(g2)'s positive assertion** that a master-tier user's request **reaches** the HTTP stub through the real switch — a suite asserting only the refusals cannot tell this bug from correct behaviour. | §3.4, §12(g2), §131.8b(4) |
| 3 | the only `models.chat` caller is `ramaClient.js`, which the design did not touch, so `user` never arrives | **Addressed as recommended, and the callers are enumerated rather than described.** `ramaClient.js` joins §14 (`ramaChat.send` gains `user` and forwards it); its two callers are `Chat.jsx:219` and `IDE.jsx:253`, **both already holding `currentUser`** (L149, L183) — **no caller lacks one**, which is stated explicitly because a missing wire-up must be a listed item. §12(g3) asserts the call object includes `user`. | §1.12(2), §3.4(a), §13.1, §14, §12(g3) |
| 4 | `assemble()`'s signature cannot produce either body, and §12(g) forbids fixing it at the call site | **Addressed as recommended.** The whole envelope moved into `assemble({ kind, messages, parts, query, model, stream, options, maxResults, allowInternal })`; §12(g) is restated against it; `kind:'chat'` with no `model` refuses (§8 row 4b, §9 rows). **One addition beyond the recommendation:** a **positive** assertion that an accepted envelope yields a body carrying `model`, `stream` and `messages` — "no second constructor" is worthless if the one constructor cannot produce a sendable request. `options` is enumerated, never spread. | §5.3, §2.5 steps 2 and 7, §8, §9, §12(g) |
| 5 | the Playwright fallback is a second egress the gate does not cover | **Addressed as recommended, including the rename.** Classification runs **once in `models:search-web`, above backend selection**, and a refusal is **terminal for every backend**. The module is renamed **`egressBoundary.cjs`** — "egress" means off this machine — because the review was right that a name read as a scope limit is how this re-opens. §12(g) asserts a `private` and a bare-string query leave **both** stubs with **zero** calls, plus a third case proving the refusal is terminal and not merely first. **One honest limit added:** `browser:search`'s own direct channel keeps its unclassified query, is pre-existing and callerless, and is **named** in §5.2 and §14 rather than quietly omitted. | §5.2, §5.3, §12(g), §14, §131.6 |
| 6 | §5.2 step 2 is not implementable — `browser:search` is an inline closure with no export | **Addressed — option (a), extract-and-export.** Option (b) (drop step 2) was the smaller diff and was **rejected with a reason**: it leaves the Playwright egress reachable only through the ungated legacy channel, which is finding 5 re-opened by another route. `browserEngine.cjs` joins §14 as ~6 lines, no behaviour change, with §12(j)'s playwright-absent assertion at **both** entry points. §13.2(3) now says both named backends are genuinely invocable. | §1.12(3), §5.2, §12(j), §13.2(3), §14 |

### MEDIUM

| # | Finding | Response | Where |
|---|---|---|---|
| 7 | `priority` passed but never declared; `think`/`format` dead or a second body path | **Addressed as recommended.** `priority = PRIORITY.NORMAL` on the signature with a §9 row (integer 0–4, clamped, `CRITICAL` only from a master-initiated call). `think`/`format` routed through `assemble`'s `options` with explicit rows — `format` is `null \| 'json'` and **any other value refuses rather than being passed through**. | §2.5, §5.3, §9 |
| 8 | `status()`'s key set is asserted but never defined | **Addressed as recommended.** Enumerated and frozen in §2.2 as the fifteen keys the review listed; §12.4(7) asserts the **sorted literal list** and `cloudCapability`'s own two keys; `models:cloud-status` is stated to be a **subset**, with §12.4(7b) asserting it. | §2.2, §12.4(7) |
| 9 | `reserveSlot`/`releaseSlot`/`recordApiUse` have no home; `useOrchestrator` has no shape | **Addressed as recommended.** All three are **methods on `ResourceOrchestrator`** — I10's monopoly is on the instance that owns the counters; `ollamaCloud` obtains `…orchestrator` lazily unless injected; `useOrchestrator(stub)` requires exactly `{ admit, reserveSlot, releaseSlot, recordApiUse }` and **throws** otherwise, asserted in §12(i). | §2.2, §6.3, §12(i) |
| 10 | "admit consults the row" names no fields, and the 16/17 ceiling is asserted against code the cloud path never calls | **Addressed as recommended.** `admit`'s provider block is written out — `hasOwnProperty`, refuse on no row, per-minute reset, `usedReq >= floor(reqPerMin × 0.8)`, `inFlight >= maxConcurrent` — with three distinct named reasons. §12(i) is rewritten to drive the 16/17 case through `admit({ aiProvider: 'ollama-cloud' })`, keeping the `_canRun` cases as the separate queue-side assertions they are. | §6.3, §12(i), §131.7 |
| 11 | the `CRITICAL` bypass and the single slot contradict each other | **Addressed — option (a), the recommended one: `CRITICAL` WAITS, bounded.** `reserveSlot(provider, { priority, waitMs = 20000 })` resolves on a `slot:released` event, `{ ok: true, waited: true }`, or `{ timedOut: true }` after the bound. Non-critical priorities are refused immediately rather than queued, because a waiter queue on a one-slot row is a latency trap. §8 row 7b is the wait; §12(i) asserts queue-then-succeed, immediate-defer, and timeout. `admit`'s L395 bypass is **not** widened or moved. | §6.3, §8 rows 7/7b, §12(i), §131.8b(5) |
| 12 | refuse-on-missing-row turns a free-text field into a stuck task with nothing reported | **Addressed, with one deliberate departure from the recommended mechanism.** The review asked `submit()` to `return { ok: false, error }`. **`submit()` returns a bare `task.id` STRING and its one caller wraps it as `{ ok: true, id }`** (§1.12 fact 4), so returning an object would change the type and break the wrap — the opposite of additive. **It THROWS instead**, the handler catches and returns `{ ok: false, error }`, and `Resources.jsx` gains the `else` branch it never had. Same outcome, same loudness, no contract change. `_canRun`'s refusal stays as defence in depth, the `hasOwnProperty` guard also goes on `_tick`'s unguarded increment, and §12(i) asserts the refusal is **reported** and **nothing is enqueued**. | §1.12(4)(5), §6.4b, §12(i), §14, §131.7 |
| 13 | `walkForSecrets` drops `server/`, so one shipped tree is scanned by nothing | **Addressed as recommended, and re-measured rather than taken from the review.** Five trees: `electron, src, server, scripts, shared`, with the one-line reason. **My own probe this session: 194 files, 0 prefix hits, 0 entropy hits, exactly 2 without the discriminators** — same two strings the review named. Including `server/` costs nothing. | §1.12(7), §12.2(b) |
| 14 | which source view the matchers read is unspecified, and the wrong choice makes the scan permanently green | **Addressed as recommended.** A per-extension table: **`nc`** for `.cjs/.mjs/.js/.jsx` (a credential lives in a literal; against `code` nothing can ever match), **raw** for `.json/.md` (`views()` cannot parse either). Second planted case **`I-SECRETS-planted-md`** added, so the view choice is itself asserted. | §12.2(b), §12.2(c) |
| 15 | an 18th `INVARIANTS` row makes the suite's own banner false | **Addressed as recommended.** The banner and the file-header line become *"the 17 locked invariants, plus the rows not yet numbered — asserted, not trusted"*; §14's entry says so; §13.1b cites it as one more small argument for promotion. | §12.2(b), §13.1b, §14 |
| 16 | `parts` is classified and counted but never reaches the body | **Addressed as recommended, keeping the parameter.** Each accepted part becomes its own `{ role: 'system', content: textOf(p) }` message appended **after** the caller's messages, in order; nothing dropped, nothing truncated; `assemble` **refuses** if a part cannot be represented. §12(g) asserts `counts.parts` equals the appended count. The append-after choice is justified in §5.3 rather than left implicit. | §5.3, §12(g), §131.6 |
| 17 | the two `process.env.OLLAMA_API_KEY` bullets contradict each other | **Addressed as recommended.** The expression is deleted from the enumeration, the first bullet is marked as **the rule**, and the sentence the review asked for is added: *these two bullets must not disagree*. The enumeration now lists only `CRED_SERVICE`, the `credKey` rows and the `PROVIDER_LINKS` key, and the sweep is widened to `server/` for consistency with the walker. | §12.3 |

### NIT

All three corrected. **(18)** §1.9 now says **thirteen** `--self-test` cases and **lists all
thirteen ids** with the required `{ id, expect, why, pick, mutate }` keys, counted from
`MUTATIONS` at L826 in this session, since §12.2(c) adds two. **(19)** `isApiName` is
**defined** — `hasOwnProperty.call(CLOUD_TAGS, String(s))` — and gains §4.5 assertion 11,
including the `__proto__` case and the partition property that no `daemonTag` is an api
name; it stays exported because it is the positive counterpart of `isDaemonCloudTag`.
**(20)** §4.2's preamble now **marks the columns**: `daemonTag` attested from OLLAMA_ONLY.md
§D.3–§D.5, `apiModel` **inferred** by §4.3's rule for every row except `gemma4:31b`, with
`(inferred)` in the column header and the cross-reference to §11.5.

### Items the review flagged as unverified-and-not-flagged

Both are now in §11. **(14)** the envelope field list is provisional on the same unverified
`/api/chat` request shape as everything else in §11.1 — stated as §11.11, with the
distinction that the **structural** rule is firm and the **field names** are not.
**(15)** that a `private` query could reach Bing through the Playwright path was never
considered before finding 5 — the assertion now exists (§12(g)), and §11.13 records that the
`browserEngine` extraction itself is unexercised here because there is no `playwright` and no
`ipcMain` in this workspace.

### What was NOT changed, and why

- **No architectural decision was revisited.** The review asked for none and re-reading
  justified none.
- **One recommended mechanism was changed, with the reason stated** — finding 12's
  `return { ok: false }` became a `throw`, because `submit()`'s success contract is a bare
  id string and its one caller wraps it. The decision the review asked for (refuse loudly,
  where it is asked for) is implemented exactly; only the signalling differs, and the
  alternative would have broken an existing caller.
- **`checkAvailable`, `credentialStatus`, `httpPost`/`httpGet`, `ollamaChat`'s hardcoded
  host, `FALLBACK_CHAIN`'s contents, `modelRoles.cjs`, `genome.cjs`, `ollamaCatalog` and the
  `'ollama/phi3'` last resort** all stay as they are, for the reasons §14 already gives.
- **`browser:search`'s own direct IPC path stays unclassified** — pre-existing, tier-3
  gated, no caller in the tree, and routing it through the gate is the tool-executor
  follow-up. Named as a limit rather than claimed as coverage.
- **`RAMA_AGI_MASTER_SPEC.md` is still not edited**, `verifyLoyaltyTripwire.cjs --approve`
  is still never run, no protected file is touched, and nothing under
  `src/pages/StockMind/`, `proposals.cjs`, `selfRepair.cjs`, `releaseChannel.cjs` or
  `intelligenceEngine.cjs` is modified. Section 131 and ledger row 151 remain **ready-to-paste
  blocks in `docs/research/OLLAMA_CLOUD.md`**, not spec edits.
- **`node_modules` is not installed in this workspace,** so **no assertion in §12 has been
  executed and no claim is made that `npm run verify` or `vite build` passes.** The one thing
  executed in this session was a standalone reimplementation of §12.2(b)'s matcher under
  bare Node, written in `$env:TEMP`, run against the worktree read-only, and deleted.
- **No part of a real credential was read, requested, written or inferred anywhere in this
  document or in the course of producing it.**
