# Ollama Cloud — the keyed path, and the credential Rāma must never speak

**Status: BUILT.** Master: *"ollama api key with name Rama; utilise it"*.

This file carries two **ready-to-paste** blocks and nothing else that needs maintaining:
Section 131 for `RAMA_AGI_MASTER_SPEC.md`, and ledger row 151. **This tranche does not
modify `RAMA_AGI_MASTER_SPEC.md`.** Master pastes these, or a later session does once he
approves.

> **Before pasting, re-check that `131` and ledger row `151` are still free on `dev`.**
> From this worktree the ledger jumps `147 → 150`, so rows **148 and 149 are unassigned**,
> and Sections **128 and 129 are claimed in prose** with no `## SECTION` headers of their
> own. Other in-flight worktrees therefore appear to hold 128, 129 and probably rows
> 148–149. **131 and 151 are plausible but unverifiable from here.**

What was built, every design claim that turned out false against source, and the suite
counts are in **`docs/research/ollama-cloud-build.md`**. Read that first if you are
resuming.

---

## Ready to paste — for `RAMA_AGI_MASTER_SPEC.md`

```markdown
## SECTION 131 — The keyed cloud path, and the credential Rāma must never speak

**STATUS: BUILT.** Master: *"ollama api key with name Rama; utilise it"*.

### 131.1 Why a second Ollama path exists at all

Section 130 fixed the scope at **whatever a free ollama.com account reaches**, and
`docs/research/OLLAMA_ONLY.md` answered it for the mechanism it knew: **`ollama signin` on a
local install**, after which the daemon authenticates cloud requests itself and Rāma keeps
talking to `localhost:11434` **with no credential in the process at all**. That report is not
retracted — with a daemon present it remains the simpler path and it keeps working untouched.

**But master's machine is 16 GB with no Ollama installed, and the decisive fact is that cloud
requests do not require an Ollama installation.** The `signin` path cannot serve it:
`refreshOllamaModels()` probes `localhost:11434`, gets `ECONNREFUSED`, sets
`detectedOllamaModels = []`, and every role falls to `fit: 'none'`. **So this is the mechanism
OLLAMA_ONLY.md never covered, added BESIDE the one it did (I11).**

### 131.2 CONFLATING THE TWO AUTH MECHANISMS IS THE PRINCIPAL HAZARD

**(a) `ollama signin`** — the daemon holds the credential; Rāma holds none.
**(b) an API key** — Rāma holds the credential and calls `https://ollama.com/api` with
`Authorization: Bearer`. **Local access at `http://localhost:11434` needs no auth at all.**

A design that blurs these sends master's Bearer token to a daemon, or expects a
daemon-authenticated call to work with no daemon. **They are kept apart by construction: a
distinct module (`electron/lib/ollamaCloud.cjs`), a distinct provider (`ollama-cloud`), a
distinct id namespace (`ollama-cloud/<api-name>` vs `ollama/<daemon-tag>`), and a distinct
rate-limit row.** `allModels()` is `{ ...MODEL_REGISTRY, ...discoveredOllama }` — **discovery
silently wins every key collision** — so a shared namespace would let a local pull overwrite a
cloud entry and change a request's path with no visible cause.

### 131.3 THE CREDENTIAL IS NEVER SPOKEN, AND THAT IS ASSERTED RATHER THAN PROMISED

The key's value was never given to any session and was never asked for. **No log line, at any
level, carries it, any part of it, its length, or a hash of it. A diagnostic reports exactly
two states: PRESENT or ABSENT.** `credentialState()`'s key set is pinned to
`{present, source, vaultUnlocked, reason}` and `status()`'s to fifteen enumerated keys, both
compared as sorted literal lists, so a `prefix` or `length` field cannot be added without the
suite failing.

**The centrepiece assertion is BEHAVIOURAL, not structural, because no regex over source can
prove a value never escapes:** inject the dummy `test-not-a-real-key`, capture all three
console channels, call **every** exported function across the success path and every failure
row, and assert the dummy appears **exactly once per authenticated request — in the
`Authorization` header the stub HTTP client received — and NOWHERE in any return value or any
console line**, with **no substring of length ≥ 6 anywhere else**, which is what catches a
well-meant `key.slice(0, 8)` in a log line. `Authorization: Bearer` is asserted and
`x-api-key` is asserted never sent. `authHeader()` is module-private, built at the request
site, never assigned to a module-level variable.

`verifyInvariants.cjs` gains a secret scan over **five trees** —
`electron/ src/ server/ scripts/ shared/`, its own walker because `walkShipped` has an
explicit `if (rel.startsWith('scripts/')) continue;` — **as its own `I-SECRETS` row and NOT as
a widening of locked invariant I12**, whose text is about `console.log`, pinned dependencies
and placeholders. A credential scan is a different property, and quietly widening a locked
invariant is what the resume protocol forbids. Promotion to a numbered `I18` is **RAISED for
master with a recommendation to promote, and not taken.**

**MEASURED, and the measurement decided the matcher's shape: 194 files inside those five trees
(`.cjs` 103, `.jsx` 43, `.js` 36, `.mjs` 9, `.json` 3, `.md` 0), 0 prefix hits, 0 entropy
hits.** The entropy half requires a 32+ character quoted literal on or just below a line
naming a credential, and rejects identifier- and kebab-worded runs — which is what silences
both strings that would otherwise be its only hits:
`locally-privileged-but-HTTP-reachable` (`src/services/ghostMode.js`) and
`ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX` (`scripts/verifySelfModel.cjs`), neither a
credential. **A "must contain a digit" test was considered and REJECTED: both of those are
all-letters-and-separators, so it does no work against either, and it would silently exclude
every digit-free credential — not exotic, since any long alphabetic slice of a token is one.**
The allow-list holds **exactly one** entry and the length is itself asserted; **it is the
matcher, not the list, that keeps the scan quiet** — reaching for the list when it goes red is
the wrong move.

**`.md` matches ZERO files inside the five trees**, so that half of the scan currently scans
nothing; `docs/` is covered by `verifyOllamaCloud.cjs`'s tracked-file sweep over
`git ls-files`, which applies the **prefix** matcher only. **Root-level tracked files receive
the prefix matcher ONLY**, which is why `.env.example`'s
`HMAC_SECRET=change-this-to-a-random-64-char-string` is quiet: it is not a prefix match and
the `64` breaks the all-letters run, so widening the entropy half to the repo root should
expect it and **rename** the literal rather than allow-list it.

**ONE planted case joins the existing thirteen in the `--self-test` harness** —
`I-SECRETS-planted`, a prefix-shaped literal in a `.cjs` under `electron/` — **with its
literal built by CONCATENATION** so this suite's own source is not a hit for the scan it
installs. **A second, markdown-targeted case was specified and DROPPED: there is no `.md` file
inside the five trees to plant into, and `walkShipped`'s extension set would not copy one into
the self-test sandbox, so the case could only ever fail. The per-extension view choice it
existed to prove is asserted instead in `scannerSelfCheck()`, on synthetic strings, which
needs no file on disk** — `.md`/`.json` read **raw** because `views()` is a JavaScript
comment-stripper that would let a `//` inside a URL blank the rest of a line, and the JS
family reads **`nc`** (comments blanked, string literals intact) because a credential lives in
a LITERAL and against the `code` view every literal is spaces so **nothing could ever match**.

**And the suite's own banner is corrected.** It printed `the 17 locked invariants` before
iterating `INVARIANTS`, so an 18th row would make it print 17 while 18 run. It now reads
`the 17 locked invariants, plus the rows not yet numbered`, and the same clause is on the file
header — because §131.10's argument for promoting I18 is that the enforced set and the
described set must agree, and a banner that misstates the count is that defect at smaller
scale **in the file that exists to stop it**.

**AND THE CREDENTIAL HAS EXACTLY ONE HOME: THE VAULT — for the OPPOSITE of the obvious
reason.** `start.cjs`'s `loadEnv()` **does** parse `.env` into `process.env`, and it **copies
`.env.example` to `.env` when `.env` is absent**, and `start.cjs` spawns every child with
`env: { ...process.env }`. So the reason to keep the key out of `.env` is **not that nothing
reads it — it is that everything does**: one paste would put it in plaintext on disk and in
the Vite, server and sandbox children. **There is no environment source and no `source: 'env'`
state anywhere in the shipped code.** The decision is defended three ways: `.env.example`
carries a comment that says the file **is** loaded and the key must not go there, with the
key NAME and **no assignment**; `--diagnose` **warns** when `.env` carries such a line,
naming **no part of the value**; and it is asserted that **no shipped module reads a
credential of that name out of `process.env`** — the load-bearing one, because it cannot stop
a key reaching `.env`, it stops Rāma reading it from there. The non-secret
`OLLAMA_CLOUD_BASE_URL` is the one value that does belong in that file, and because `.env` is
genuinely loaded, that line is live rather than decorative.

### 131.4 THE MODEL NAMES DIVERGE, AND ONE DIRECTION FAILS SILENTLY

The keyed API takes the **cloud-list** name (`gemma4:31b`); the daemon, CLI and app take a
`-cloud` tag (`gemma4:31b-cloud`, `gemma4:cloud`). Sending the daemon tag to the API is a loud
not-found. **Sending the API name to a DAEMON is the silent one: `gemma4:31b` is also a
plausible LOCAL PULL tag, so a request master believes went to the cloud can run locally or
stall on a 31 B download.**

So the mapping is a **frozen table of fourteen rows, authoritative in both directions,
returning `null` for anything unknown — never a derived guess.** The derivation rule (strip a
trailing `-cloud`; a bare `cloud` tag drops the colon) is used in a **test** to validate the
table and decides nothing at runtime, because the reverse direction cannot be derived safely.
**A daemon tag handed to the keyed transport is refused BEFORE any request is made, and the
assertion is that the stub client records ZERO calls** — a refusal after the bytes have left
is not a refusal. `isApiName` and `isDaemonCloudTag` are asserted to **partition** the names
rather than overlap, and `isApiName('__proto__')` is false.

`listModels()` is **REPORT-ONLY**: unlike `refreshOllamaModels` and `refreshCustomProviders`,
which both merge into `MODEL_REGISTRY`, it never writes the registry, never adds a row and
never fills a `daemonTag` the table does not hold. Reconciling an inferred `apiModel` is a
**source edit** to the table, reviewed and committed — a runtime-added row would have no
attested daemon tag.

**ONE CORRECTION TO THE PREMISE:** `paramsB()`'s regex is anchored at the start and **not**
the end, so `31b-cloud` → `31` as well as `31b` → `31`. Direct-API naming is therefore **never
worse** rather than *strictly* better; the real split is sized vs unsized (`gemma4` → `null`,
no `:` at all). **The valuable consequence is unchanged: `gemma4:31b` → 31 → clears
`reasoning`'s 14 B floor → `declared` rather than `substitute`**, and the registry calls the
real `paramsB()` instead of copying the table's number, so the two can never disagree.

### 131.5 A CLOUD MODEL IS NOT PRIVATE, SO `narration` MUST STILL REFUSE IT

`modelRoles.evaluate` refuses any model whose `private !== true` for the one `sensitive` role,
so `false` **and** `undefined` both refuse today. **Relying on `undefined` is relying on an
accident**, so every cloud row sets `private: false` explicitly and the refusal is asserted
**six ways** — row shape; behavioural `fit: 'none'`; the reason text naming the
leaving-the-machine rule, so a reword cannot pass a sensitive prompt while sounding right; the
`private: undefined` case; **the inverse, that the same row IS fit for `reasoning`**, so the
refusal is proven to be about sensitivity rather than cloud rows failing everything; **and the
anti-vacuity guard without which the others proved nothing.**

`evaluate` returns `{ fit:'none', reasons:['no model supplied'] }` for anything without
`model.id`, **before** it reaches the privacy gate. In `MODEL_REGISTRY` the id is the object
**key**, not a field. So **every emitted row carries `id: 'ollama-cloud/<apiModel>'`**, the
suite asserts `reasons[0] !== 'no model supplied'`, and — because a guard that cannot fire is
not a guard — it also asserts that **stripping the id DOES produce the wrong-reason refusal**.

Note the ordering: role selection passes only `Object.values(discoveredOllama)` today, so
**cloud rows still cannot fill a role** — the gate is asserted correct **before** the path to
it exists. `modelRoles.cjs` is not modified, and that is asserted too.

### 131.6 Section 130.8's gate is on the PAYLOAD, and the transport owns it

Section 130.8's words, verbatim and nothing else inside the quotation marks:

> *"a join can assemble a context payload that no single row looks sensitive enough to block.
> Row-level classification is necessary and not sufficient, so the design must name the
> chokepoint where an outbound payload is assembled and show that a classified row cannot
> pass it even when it arrives via a join."*

**This reading is Rāma's own voice and not the spec's:** the chokepoint is the **TRANSPORT**,
not the role engine and not the caller. The role engine never sees a payload; callers get
refactored and there will be more of them. The transport is the one place bytes leave the
machine, so it is the only place the rule can be **true** rather than *currently true*.
`electron/lib/egressBoundary.cjs` is the **only** constructor of a cloud-bound body — asserted
structurally, with `ollamaCloud.cjs` carrying no `JSON.stringify`, no `body` key assignment
and no call to `net.request` — and `maxLevel` is computed across **`messages` AND `parts`
together**.

**THE MODULE IS CALLED `egressBoundary`, NOT `cloudBoundary`.** An earlier design scoped the
gate to *the cloud boundary* and put the Playwright search path **directly beneath it as a
fallback** — so a query refused as `private` for `ollama.com` fell straight through to
`https://www.bing.com/search?q=…`. **The rule was enforced for one egress and broken by the
line underneath it.** So: **"egress" means OFF THIS MACHINE**; the classification runs
**ONCE, ABOVE backend selection**, in `models:search-web`; **a refusal is TERMINAL for every
backend**; and the assertion is that a `private` or bare-string query leaves **the HTTP stub
AND the Playwright stub with ZERO calls**, including with the cloud credential ABSENT so the
cloud backend is skipped and the Playwright path would otherwise be reached.

**`messages` is classified, not only `parts`.** `messages[].content` is the field that
actually carries the prompt, and an earlier draft pinned it to a plain string — so `maxLevel`
was computed over an empty array, resolved `public`, and the primary payload crossed
unexamined. A message's `content` is now either a bare string (→ `public`, preserving today's
callers) or `{ text, classification }`; **an object element with the classification ABSENT,
`undefined`, `null` or `''` is refused with the SAME reason string as an unrecognised value**,
because choosing the object shape is choosing to classify; and the join assertion plants its
`private` row **inside `messages`** at index 37 of fifty-one. `private` is refused
unconditionally. `internal` needs **two independent switches**, because one switch gets
flipped by a default. An unrecognised value **fails closed**. `options` is **enumerated, never
spread** — an unknown key refuses rather than being passed through, because a passthrough into
an outbound body is an unreviewed egress surface with extra steps.

**Search accepts no bare string at all** — a query is the field most likely to carry private
context off the machine, and search has no legacy callers to protect. Accepted parts become
their own `system` messages appended **after** every caller message, in order, and
`counts.parts` is asserted to equal the number appended, so a silently dropped part fails the
suite instead of producing a confident answer from a shortened prompt.

**ONE HONEST LIMIT:** `browser:search`'s own direct IPC channel keeps its unclassified query.
It is pre-existing, gated at tier 3, has **no caller in the tree**, and is not modified here.
**Every egress `models:search-web` can reach is gated; the legacy direct channel is not, and
it is named rather than quietly left out.**

**Honest degradation: with no context store built, every part today is a bare string resolving
to `public` and the gate refuses nothing** in production. Its value is that row 150's store
arrives to a gate it plugs into rather than one it must retrofit.

### 131.7 `API_RATE_LIMITS.ollama: { reqPerMin: 9999 }` was right and is now also wrong

Right for a local daemon; wrong for a free cloud plan whose binding constraint is **ONE
CONCURRENT REQUEST plus a monthly credit pool** — concurrency is not a rate and a monthly pool
is not a per-minute budget. So: separate `ollama-cloud` and `ollama-search` rows (search must
not be able to eat the single inference slot); `maxConcurrent: 1` with `inFlight`, and
`reserveSlot`/`releaseSlot` **inside `resourceOrchestrator` so I10 keeps its monopoly**, a
`Math.max(0, …)` floor so a double-release cannot manufacture capacity, and a mandatory
`finally` because a leaked slot on a 1-slot row is a permanent outage. `RATE_LIMIT_BUFFER` is
**not** applied to `maxConcurrent` — `Math.floor(1 × 0.8)` is 0 and would deadlock — but it
**is** applied to `reqPerMin`, so the **enforced** courtesy ceiling is **16/min, not the 20 in
the table**, and the assertion uses the enforced number.

**`tokPerMin: null` means UNCHECKED, never zero**, and `monthlyTokenBudget` stays `null`:
Ollama does not expose the remaining balance, so Rāma reports **what it has spent** and never
**what remains**. A guessed budget would be the invented number Section 126 exists to prevent.

**THE WORST OF THE THREE FINDINGS: `modelRouter` calls `orchestrator.admit()` NOWHERE, and
`admit()` never looked at `aiProvider` at all — so a cloud call would have passed through NO
admission check whatsoever.** `admit({ aiProvider })` closes it, defaulting `null` so the three
existing call sites are byte-identical, and **which fields it consults is written out**: a
`hasOwnProperty` lookup, refuse when there is no row, the per-minute reset, the ceiling, then
`inFlight >= maxConcurrent`, each with its own named reason. That matters because the ceiling
was previously only in `TaskQueue._canRun` and `selectOptimalModel`, **neither of which the
cloud transport calls**.

`_canRun`'s `if (limit)` with no `else` admitted an unregistered provider's traffic unmetered;
it now **refuses**. `selectOptimalModel`'s `else { return … 'no-rate-limit' }` was worse,
treating a missing entry as an affirmative **selection**; it now skips. **The assertion that
every shipped provider HAS a row is what makes refusing safe instead of a capability
regression.**

**`_tick` (`API_RATE_LIMITS[task.aiProvider].usedReq++`) guarded by TRUTHINESS, not by
ownership — and the hazard is worse than "unguarded" conveys:
`API_RATE_LIMITS['__proto__']` resolves through the prototype chain to `Object.prototype`,
which IS truthy, so the guard PASSED and `.usedReq++` wrote onto `Object.prototype` —
prototype pollution affecting every plain object in the process, from one free-text UI field,
with the symptom appearing nowhere near the cause.** `hasOwnProperty` closes it, the same
guard `_canRun`, `admit` and `recordApiUse` take, and the suite asserts
`Object.prototype.usedReq === undefined` after `_tick` runs with that provider name — reached
through a `CRITICAL` task, because `_canRun` returns `true` for `CRITICAL` before any provider
check.

**AND REFUSING AT `_canRun` ALONE WOULD HAVE TRADED ONE DEFECT FOR A WORSE ONE.** `_canRun`
returning `false` means *"not this tick"*, so the task renders as `queued` forever and says
nothing. And `aiProvider` is **free text from the UI**. **So an unknown provider is refused
where it is ASKED FOR: `submit()` THROWS**, the `orchestrator:submit` handler turns that into
`{ ok: false, error }` naming the provider, and `Resources.jsx` gains the `else` branch it
never had. Thrown rather than returned because `submit()`'s success contract is a bare id
**string** and its one caller wraps it. `_canRun`'s refusal stays as defence in depth, and the
suite asserts the refusal is **REPORTED** and **nothing is enqueued**.

**`orchestrator:api-limits` returns `API_RATE_LIMITS` WHOLESALE and is UNGATED** — it was
before this change and still is. That is acceptable only because **no field on any row derives
from a credential value**, and the rule is now written at the table's declaration and asserted:
no own-property name matches `/key|secret|bearer|prefix|hash/i`, and the dummy key appears
nowhere in the serialised table. `getStatus().apiLimits` keeps its **explicit** narrower
projection and gains `inFlight`/`maxConcurrent`; the monthly counters are reported only through
`ollamaCloud.status()`, the surface whose key set is frozen.

### 131.8 Hosted web search — assessed, and wired

`web.search` → `browser:search`, whose **first line** is
`if (!playwright) return { ok: false, error: 'playwright not installed' }`. On master's target
machine that dependency is absent. **And it is dark for a second reason: NOTHING IN THE TREE
INVOKES `browser:search` AT ALL** — there is no tool executor. Ollama's hosted search is keyed
on the same credential, needs no Playwright and no daemon, and costs no new dependency.
**Decided: wire the BACKEND** — cloud first, the Playwright path second, explicit absence
third, each reporting which answered; nothing removed (I11). It gets its **own** admission row
and is gated on the **existing** `browser.search` (tier 3), because a capability that already
exists does not need a new key.

**Step 2 needed an extraction in `browserEngine.cjs`, because as written it was not
implementable.** The logic was a closure inside `register(ipcMain)` over module-scoped state
with a positional `(_e, query, engine)` signature, and **an `ipcMain` handler cannot be called
from main-process code.** The handler body is now
`async function searchWeb(query, engine = 'bing')` at module scope — closing over the same
`browser`/`browserCtx`, so the extraction moves no state — the handler delegates to it, and
`module.exports` **gains** it. Dropping step 2 instead was the smaller diff and was rejected:
it would leave the Playwright egress reachable only through the ungated legacy channel.

**THE SEARCH REQUEST BODY IS PROVISIONAL AND LABELLED AS SUCH.** The hosted-search endpoint
path, request shape and response shape are **NOT VERIFIED**. `assemble({ kind: 'search' })`
returns `{ query, max_results }` with `maxResults` clamped to 1–10, and the suite asserts that
an accepted search body **carries no key outside that pair** and that its **only
caller-derived value is `query.text`**. When the real shape is read, the only permitted change
is the field names **inside `assemble`**.

**Stated plainly rather than overclaimed: this tranche builds the backend AHEAD OF ITS
CALLER.** No consumer is wired, so the first observable behaviour is a suite assertion, not a
working search in the UI. The tool executor is named as follow-up. The honest claim is *"the
backend that can work on master's machine now exists and its leak surface is reviewed"* — not
*"a dark capability became a working one"*.

### 131.9 THE FEATURE HAD TO BE REACHABLE, AND IT WASN'T

Five facts, each verified by reading, that together meant the designed feature could not have
served the machine it exists for:

**(1) `selectModel` could not return a cloud id.** `FALLBACK_CHAIN` is a hardcoded seven-id
array with no cloud entry, and the four passes are roles over `discoveredOllama`, an
`offline`-caps pass (which cloud rows must fail by design), the `FALLBACK_CHAIN` loop, and
`discoveredOllama` again — then `return primaryModel`, i.e. `'gpt-4o'`. On master's machine
that resolves to a model with no key, throws, and walks a chain in which nothing is available.
**A last-resort cloud pass is appended after the local passes and before the hardcoded
primary — local still beats cloud, because the free tier allows one concurrent request — and
it is asserted in BOTH directions: with the dummy key `selectModel('general')` returns an
`ollama-cloud/*` id; with the vault empty, and with the vault merely locked, it does not.**

**(2) `models:chat`'s chain reported ABSENT as BROKEN.** It was `catch { continue; }`: it
logged nothing, it could not tell a missing credential from a 500, a fallback answered carrying
only `fallbackFrom` with no cause, and when nothing else was available it returned
`All models failed. Last error: no Ollama API key is stored` — **which is the target machine's
exact state, reported as a failure.** The chain now accumulates `unconfigured[]` separately
from `failures[]`, logs only genuine failures, carries `unconfigured` **beside**
`fallbackFrom` so a substitution is declared, and returns `{ ok:false, unconfigured, error,
remedy }` — never `All models failed` — when nothing was configured.

**(3) The capability gate was either always-closed or never-run.** `capability.can(null, …)`
is hardcoded `false` and `models:chat` destructured no `user` at all. **Settled as step 0: an
explicit `user` is required; `undefined` is a PROGRAMMING ERROR returning `gateError` and
logging at `console.error`, because a missing wire-up must never read as "master lacks
permission"; `null` is a genuine denial.** Both no-user cases are asserted to make **zero**
HTTP calls, and `models:chat` now threads `user` through to the transport.

**(4) The thread-through was broken in two more places, each of which alone made every cloud
call return `gateError`.** The dispatch site passed **three** arguments to a **four**-parameter
`ollamaCloudChat`; and the renderer wire was attributed to `Models.jsx`, which **has no
`models.chat` call site at all** — the only caller in the tree is
`src/services/ramaClient.js`, inside `ramaChat.send`. **The suite asserts the POSITIVE case** —
a master-tier user's request **reaches** the transport through the real `switch` — because a
suite that asserts only refusals cannot tell a gate that is correctly shut from a gate shut by
a dropped argument. **And the only renderer caller used to discard every field that makes
absence honest: it now forwards `unconfigured`, `remedy`, `failures`, `gateError`, `path`,
`endpoint`, `via` and `credentialSource`, and `Chat.jsx`'s failure branch RENDERS `res.remedy`
— otherwise the one actionable sentence is deleted one function above master.**

**(5) `priority` was passed and never declared**, so the parameter master's critical work
depends on was silently inoperative. Declared, clamped, validated. **And the `CRITICAL` story
was self-contradictory**: `admit` bypasses on `CRITICAL`, but `reserveSlot` had no priority
argument. **Settled: `CRITICAL` WAITS for the slot, bounded**, because one concurrent request
is a physical limit of the free tier and bypassing it buys a 429 rather than a faster answer.
**The wait re-checks and increments in the SAME synchronous turn, so exactly one waiter wins
per release** — an event wait with no re-check would let two `CRITICAL` waiters both resolve on
one `slot:released` and both take a `maxConcurrent: 1` row, breaking the limit with the
mechanism added to honour it. Asserted: two waiters, one release, exactly one resolves
`{ ok: true, waited: true }`, the other stays pending, `inFlight === 1`. Loyalty outranks
throttling; it does not outrank arithmetic.

### 131.10 Raised for master

**`"models.use-cloud": 1`** in `shared/capabilities.json` — tier 1, matching `models.add-key`
and `models.ollama-pull`, because spending a metered allowance and sending bytes off the
machine is a different act from running a local model (`models.use`, tier 3).
**`shared/capabilities.json` is PROTECTED, so it is SPECIFIED, NOT ADDED, and
`verifyLoyaltyTripwire.cjs --approve` was never run.** Because `capability.can()` denies an
unknown key, gating on it would make the feature **dead rather than degraded** — so the gate
is an **optional tightening**: it uses the dedicated key when `capability.MATRIX` has it and
`models.use` otherwise, **says which one is in force** through `status().cloudCapability`, and
needs no code change when master adds it. Both ways are asserted against a temporarily
stubbed matrix, and the suite asserts the matrix is left exactly as it was. Search needs no
new key.

**ALSO RAISED, AND NOT TAKEN: whether the credential scan becomes numbered invariant `I18`.**
Unnumbered, it enforces identically in both chains; numbered, Section 28's list would once
again describe everything the covenant chain enforces. **Rāma's recommendation is to promote
it, in a separate commit touching only Section 28 — and Rāma does not do it.**

One pre-existing caveat worth a sentence: `user` arrives from the renderer, so
`capability.can(user, …)` checks a renderer-asserted identity. That is the established house
pattern and a strict improvement on `models:chat`'s previous no-gate state, **but it should
not be described as a boundary against a compromised renderer.**

**Master's setup path is three steps: unlock the vault, Models → Cloud → Ollama Cloud → Add
key, confirm the strip reads `key PRESENT (vault)`. There is no `.env` step and no environment
variable — RĀMA READS NO CREDENTIAL FROM `process.env` AT ALL, asserted. And the distinction
that matters: `.env` IS loaded into `process.env` by `start.cjs`, so a key put there would be
exposed to every child process AND still unusable by Rāma — which is why `--diagnose` warns
about one, naming no part of it.** If the strip reads *vault locked — unlock to use the stored
key*, the key is already there and Rāma will not ask again — a distinction `credentialStatus()`
flattens to `missing-key` one layer up, which is why the Models row replaces the Add-key button
rather than inviting master to re-paste a credential Rāma already holds.

### 131.11 Not verified

**THE NETWORK IS BLOCKED FROM THIS WORKSPACE, AND NO LIVE AUTHENTICATED CALL TO ollama.com WAS
EVER MADE.** Every Ollama fact here is taken from the brief and cross-checked against
OLLAMA_ONLY.md, and **none was confirmed against live documentation**: both auth mechanisms,
the Bearer requirement, `x-api-key`'s rejection, *"cloud requests do not require an Ollama
installation"*, `https://ollama.com/settings/keys`, `/api/chat`'s envelope, `GET /api/tags` on
the keyed endpoint, the hosted-search path and shape, free-tier model accessibility, behaviour
at zero credits, and the one-concurrent-request figure. **Thirteen of fourteen `apiModel`
values are INFERRED** from attested daemon tags by the derivation rule — only `gemma4:31b` is
attested — which is why `listModels()` exists and why unknown mappings are `null`.
**`vite build` cannot run in the worktree: `node_modules` is not installed there, so no claim
is made that the build passes.** The `browserEngine` extraction's playwright-absent behaviour
is asserted **structurally** and not executed, because that module requires Electron at module
scope. **Nothing has been run against a real credential, and must not be.**

### 131.12 Next

A tool executor for `TOOL_REGISTRY['web.search']` — without one, both search backends have no
caller. Feeding `ollama-cloud/*` into the role engine: `modelRouter` passes only
`Object.values(discoveredOllama)` to `modelRoles`, so a cloud row **is selectable by
`selectModel`** but still **cannot fill a role**, and §131.5's gate is asserted ahead of the
path that will need it. Reconcile the inferred `apiModel` values against a live keyed
`GET /api/tags`. Read the real hosted-search shape. Promote `I-SECRETS` to `I18` if master
agrees. `ollamaChat`'s hardcoded `localhost:11434` and `selectOptimalModel`'s hardcoded
`'ollama/phi3'` last resort are deliberately left to row 150's file-level work — two tranches
must not edit the same function.
```

---

## Ready to paste — the ledger row, appended after row 150

```markdown
| 151 | The keyed cloud path, and the credential Rāma must never speak | done | Section 131. Master: *"ollama api key with name Rama; utilise it"*. **BUILT.** **WHY A SECOND OLLAMA PATH: `docs/research/OLLAMA_ONLY.md` answered Section 130's Ollama-only scope for the mechanism it knew — `ollama signin` on a LOCAL INSTALL, after which the daemon authenticates cloud requests itself and Rāma holds NO credential at all. That report is not retracted and that path keeps working untouched (I11), asserted by its own suite section. But master's machine is 16 GB WITH NO OLLAMA INSTALLED, and the decisive fact is that CLOUD REQUESTS DO NOT REQUIRE AN OLLAMA INSTALLATION.** **CONFLATING THE TWO AUTH MECHANISMS IS THE PRINCIPAL HAZARD — `signin` (daemon holds the credential) vs an API key (Rāma holds it and sends `Authorization: Bearer` to `https://ollama.com/api`), with `localhost:11434` needing no auth at all. They are kept apart BY CONSTRUCTION: `electron/lib/ollamaCloud.cjs`, provider `ollama-cloud`, id namespace `ollama-cloud/<api-name>` vs `ollama/<daemon-tag>`, and its own rate-limit row — because `allModels()` is `{ ...MODEL_REGISTRY, ...discoveredOllama }` and DISCOVERY SILENTLY WINS EVERY COLLISION, so a shared namespace would let a local pull overwrite a cloud entry and change a request's path with no visible cause.** **THE CREDENTIAL IS NEVER SPOKEN, AND IT IS ASSERTED RATHER THAN PROMISED: the value was never given to any session and never asked for; no log line carries it, any part of it, its length or a hash; a diagnostic reports exactly PRESENT or ABSENT; `credentialState()`'s key set is pinned to `{present, source, vaultUnlocked, reason}` and `status()`'s to fifteen enumerated keys, both compared as sorted literal lists. THE CENTREPIECE ASSERTION IS BEHAVIOURAL, NOT STRUCTURAL, because no regex over source can prove a value never escapes — inject the dummy `test-not-a-real-key`, capture all three console channels, call EVERY exported function across the success path and every failure row, and assert the dummy appears once per authenticated request in the `Authorization` header the stub client received and NOWHERE in any return value or console line, with NO SUBSTRING OF LENGTH ≥ 6 anywhere else, which is what catches a well-meant `key.slice(0, 8)`. `x-api-key` is asserted never sent. Plus a secret scan in `verifyInvariants.cjs` over FIVE trees — `electron/ src/ server/ scripts/ shared/`, its own walker because `walkShipped` skips `scripts/` — added as ITS OWN `I-SECRETS` ROW AND NOT AS A WIDENING OF LOCKED INVARIANT I12, whose text is `console.log`/pinned deps/placeholders; quietly widening a locked invariant is what the resume protocol forbids, and promotion to a numbered `I18` is RAISED FOR MASTER with a recommendation to promote, not taken. MEASURED: 194 files (.cjs 103, .jsx 43, .js 36, .mjs 9, .json 3, .md 0), 0 prefix hits, 0 entropy hits, GREEN ON THE FIRST COMMIT. The entropy half rejects identifier- and kebab-worded runs, which is what silences both strings that would otherwise be its only hits (`src/services/ghostMode.js`, `scripts/verifySelfModel.cjs`), neither a credential. A "MUST CONTAIN A DIGIT" TEST WAS CONSIDERED AND REJECTED: both of those are all-letters-and-separators so it does no work against either, and it would silently exclude every digit-free credential. The allow-list holds EXACTLY ONE entry and the length is asserted; it is the MATCHER, not the list, that keeps the scan quiet. `.md` matches ZERO files inside the five trees, so that half scans nothing today and `docs/` is covered by the `git ls-files` sweep, which applies the PREFIX matcher only — as do root-level tracked files, which is why `.env.example`'s `HMAC_SECRET` placeholder is quiet. ONE planted case joins the existing thirteen in `--self-test`, with its literal built by CONCATENATION so this suite's own source is not a hit for the scan it installs; A SECOND, MARKDOWN-TARGETED CASE WAS SPECIFIED AND DROPPED because there is no `.md` file in those trees to plant into and `walkShipped` would not copy one into the sandbox — the per-extension view choice it existed to prove is asserted in `scannerSelfCheck()` on synthetic strings instead, `nc` for the JS family because a credential lives in a LITERAL and against `code` every literal is spaces so NOTHING COULD EVER MATCH, raw for `.json/.md` because `views()` is a JavaScript comment-stripper. AND THE SUITE'S OWN BANNER IS CORRECTED to "the 17 locked invariants, plus the rows not yet numbered", because an 18th row made it print 17 while 18 ran — that defect at smaller scale IN THE FILE THAT EXISTS TO STOP IT.** **THE CREDENTIAL HAS EXACTLY ONE HOME: THE VAULT — FOR THE OPPOSITE OF THE OBVIOUS REASON. `start.cjs`'s `loadEnv()` DOES parse `.env` into `process.env` AND COPIES `.env.example` TO `.env` WHEN `.env` IS ABSENT, and `start.cjs` spawns every child with `env: { ...process.env }` — so the reason to keep the key out of `.env` is NOT that nothing reads it, it is THAT EVERYTHING DOES. There is NO environment source and no `source: 'env'` state in the shipped code. Defended three ways: `.env.example` carries the key NAME in a comment with NO assignment and text that says the file IS loaded; `--diagnose` WARNS about such a line, naming no part of the value; and it is asserted that NO SHIPPED MODULE READS A CREDENTIAL OF THAT NAME OUT OF `process.env` — the load-bearing one, because it cannot stop a key reaching `.env`, it stops Rāma reading it from there.** **THE NAMES DIVERGE AND ONE DIRECTION FAILS SILENTLY: the keyed API takes `gemma4:31b`, the daemon takes `gemma4:31b-cloud`. The daemon tag sent to the API is a loud not-found; THE API NAME SENT TO A DAEMON IS THE SILENT ONE, because `gemma4:31b` is also a plausible LOCAL PULL tag, so a request master believes went to the cloud can run locally or stall on a 31 B download. A FROZEN FOURTEEN-ROW TABLE, authoritative in both directions, `null` for anything unknown — never a derived guess; the derivation rule lives in a TEST and decides nothing at runtime; a daemon tag is refused BEFORE any request with the stub asserted at ZERO CALLS. `listModels()` is REPORT-ONLY and never writes the registry. One correction to the premise: `paramsB()`'s regex is START-anchored, so `31b-cloud` → 31 too — direct-API naming is NEVER WORSE rather than strictly better, and the valuable consequence stands: 31 clears `reasoning`'s 14 B floor, so a sized row reaches `declared`.** **A CLOUD MODEL IS NOT PRIVATE, SO `narration` STILL REFUSES IT — asserted SIX ways: row shape, `fit: 'none'`, the reason text naming the leaving-the-machine rule, the `private: undefined` case, THE INVERSE (the same row IS fit for `reasoning`, so the refusal is about sensitivity rather than cloud rows failing everything), AND THE ANTI-VACUITY GUARD without which the rest proved nothing — `evaluate` returns `['no model supplied']` for a row with no `id` BEFORE the privacy gate, and in `MODEL_REGISTRY` the id is the KEY not a field, so every emitted row now carries `id`, the suite asserts `reasons[0] !== 'no model supplied'`, and it also asserts that STRIPPING the id DOES produce the wrong-reason refusal, because a guard that cannot fire is not a guard.** **SECTION 130.8's GATE IS ON THE PAYLOAD AND THE TRANSPORT OWNS IT: `electron/lib/egressBoundary.cjs` is the ONLY constructor of a cloud body — asserted structurally, with `ollamaCloud.cjs` carrying no `JSON.stringify`, no `body` key assignment and no `net.request` — and `maxLevel` is computed across `messages` AND `parts` TOGETHER, because `messages[].content` is the field that actually carries the prompt and an earlier draft classified only `parts`, so the primary payload crossed unexamined. `private` refused unconditionally; `internal` needs TWO independent switches because one gets flipped by a default; an absent, undefined, null or empty classification on an object refused with the SAME reason as a typo; `options` ENUMERATED NEVER SPREAD. THE MODULE IS `egressBoundary`, NOT `cloudBoundary`: an earlier design put the Playwright path directly beneath the gate as a fallback, so a query refused for ollama.com fell through to bing.com — the rule enforced for one egress and broken by the line underneath it. The classification now runs ONCE ABOVE BACKEND SELECTION and a refusal is TERMINAL, asserted with the HTTP stub AND the Playwright stub both at ZERO CALLS, including with the credential absent so the cloud backend is skipped. ONE HONEST LIMIT: `browser:search`'s own direct channel keeps its unclassified query — pre-existing, tier 3, no caller in the tree, not modified, and NAMED rather than quietly left out.** **RATE LIMITS CORRECTED: separate `ollama-cloud` and `ollama-search` rows so search cannot eat the single inference slot; `maxConcurrent: 1` with `inFlight`, `reserveSlot`/`releaseSlot` INSIDE the orchestrator so I10 keeps its monopoly, a zero floor, a mandatory `finally`; the buffer NOT applied to concurrency (`floor(1×0.8)` is 0 and would deadlock) but IS applied to `reqPerMin`, so the ENFORCED ceiling is 16/min not the tabled 20 and the assertion uses the enforced number; `tokPerMin: null` means UNCHECKED not zero; `monthlyTokenBudget` stays null because Ollama does not expose the balance, so Rāma reports WHAT IT SPENT and never WHAT REMAINS. THE WORST FINDING: `modelRouter` calls `admit()` NOWHERE and `admit()` never looked at `aiProvider`, so a cloud call passed through NO admission check whatsoever — `admit({ aiProvider })` closes it, defaulting null so the three existing call sites are byte-identical. `_canRun`'s `if (limit)` with no else admitted an unregistered provider unmetered and now REFUSES; `selectOptimalModel`'s `else return 'no-rate-limit'` treated a missing entry as an affirmative SELECTION and now skips; the assertion that EVERY SHIPPED PROVIDER HAS A ROW is what makes refusing safe instead of a capability regression. `_tick`'s increment was guarded by TRUTHINESS, not ownership — `API_RATE_LIMITS['__proto__']` resolves through the prototype chain to `Object.prototype`, which IS truthy, so the guard PASSED and `.usedReq++` wrote onto `Object.prototype`: prototype pollution from a free-text UI field, asserted closed by `Object.prototype.usedReq === undefined` after a `_tick` with that provider name. AND REFUSING AT `_canRun` ALONE WOULD HAVE BEEN WORSE: `false` means "not this tick", so a typo'd provider sits queued forever saying nothing — `submit()` now THROWS, the handler returns `{ ok:false, error }`, `Resources.jsx` gains the `else` it never had, and the suite asserts the refusal is REPORTED and NOTHING IS ENQUEUED. `orchestrator:api-limits` stays wholesale and ungated, which is acceptable ONLY because NO FIELD ON ANY ROW DERIVES FROM A CREDENTIAL — now written at the declaration and asserted.** **AND THE FEATURE HAD TO BE REACHABLE, AND WASN'T: `selectModel`'s four passes could not return a cloud id and `FALLBACK_CHAIN` has no cloud entry, so on master's machine a cloud call resolved to `gpt-4o` and died — a LAST-RESORT cloud pass is appended after the local passes (local still beats cloud, because the free tier allows one concurrent request) and asserted BOTH ways: with the dummy key it returns an `ollama-cloud/*` id, with the vault empty AND with the vault merely locked it does not. `models:chat`'s chain was `catch { continue; }`, logging nothing and collapsing a missing credential into `All models failed. Last error: …` — THE TARGET MACHINE'S EXACT STATE REPORTED AS A FAILURE — and now splits `unconfigured[]` from `failures[]`, logs only genuine failures, carries `unconfigured` BESIDE `fallbackFrom` so a substitution is DECLARED, and never says `All models failed` when nothing was configured. The capability gate was either always-closed or never-run (`can(null, …)` is hardcoded false and `models:chat` destructured no `user`) and is settled as step 0: `undefined` is a PROGRAMMING ERROR returning `gateError`, `null` is a denial, and the POSITIVE case is asserted through the real `switch` because a suite that asserts only refusals cannot tell a correctly-shut gate from one shut by a dropped argument — which is exactly what the dispatch site had, three arguments to a four-parameter function. The only renderer caller, `src/services/ramaClient.js`, DISCARDED every field that makes absence honest and now forwards `unconfigured`/`remedy`/`failures`/`gateError`/`path`/`endpoint`/`via`/`credentialSource`, with `Chat.jsx` RENDERING `res.remedy`. `CRITICAL` WAITS for the slot rather than bypassing a physical limit, BOUNDED, and the wait RE-CHECKS AND INCREMENTS IN THE SAME SYNCHRONOUS TURN so exactly one waiter wins per release — asserted with two waiters and one release, `inFlight === 1`. Loyalty outranks throttling; it does not outrank arithmetic.** **RAISED FOR MASTER, NOT TAKEN: `"models.use-cloud": 1` in the PROTECTED `shared/capabilities.json` — specified, not added, and `verifyLoyaltyTripwire.cjs --approve` never run. Because `can()` denies an unknown key, the gate is an OPTIONAL TIGHTENING that uses the dedicated key when the matrix has it and `models.use` otherwise and SAYS WHICH IS IN FORCE, so the feature degrades rather than dies; both ways asserted. Also raised: promoting `I-SECRETS` to numbered `I18`.** **NOT VERIFIED: the network is blocked here and NO LIVE AUTHENTICATED CALL TO ollama.com WAS EVER MADE — both auth mechanisms, the Bearer requirement, `x-api-key`'s rejection, the no-install claim, `/api/chat`'s envelope, `GET /api/tags` on the keyed endpoint, the hosted-search path/body/response, free-tier accessibility, behaviour at zero credits and the one-concurrent-request figure are all from the brief and OLLAMA_ONLY.md. THIRTEEN OF FOURTEEN `apiModel` VALUES ARE INFERRED; only `gemma4:31b` is attested. The search body is PROVISIONAL and the suite pins it to `{ query, max_results }` so it cannot quietly widen. `vite build` CANNOT RUN in the worktree — `node_modules` is absent — so no claim is made that the build passes. The `browserEngine` extraction's playwright-absent behaviour is asserted STRUCTURALLY and not executed. Nothing was run against a real credential, and must not be.** Files: `electron/lib/ollamaCloud.cjs` and `electron/lib/egressBoundary.cjs` (new), `electron/ipc/modelRouter.cjs`, `electron/resourceOrchestrator.cjs`, `electron/ipc/browserEngine.cjs` (extract-and-export only), `electron/preload.cjs`, `src/pages/Models/Models.jsx`, `src/services/ramaClient.js`, `src/pages/Chat/Chat.jsx`, `src/pages/IDE/IDE.jsx`, `src/pages/Resources/Resources.jsx`, `.env.example`, `start.cjs`, `scripts/verifyOllamaCloud.cjs` (new, 263 assertions), `scripts/verifyInvariants.cjs` (+21), `package.json`, `docs/research/OLLAMA_CLOUD.md`, `docs/research/ollama-cloud-build.md`. **NEXT:** a tool executor for `TOOL_REGISTRY['web.search']` — both search backends have no caller; feed `ollama-cloud/*` into the role engine (`modelRouter` passes only `discoveredOllama` to `modelRoles`, so a cloud row IS selectable by `selectModel` and still CANNOT fill a role, and §131.5's gate is asserted ahead of that path); reconcile the inferred `apiModel` values against a live keyed `GET /api/tags`; read the real hosted-search shape; decide `I18`. |
```
