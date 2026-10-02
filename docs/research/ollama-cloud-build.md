# Build report — the keyed Ollama Cloud path

Worktree `.worktrees/ollama-cloud`, branch `feat/ollama-cloud-api`, built on top of `4fbe246`.

**NO LIVE AUTHENTICATED CALL TO ollama.com WAS MADE.** Every outbound request in this tranche
is exercised through an injected transport. The API key was never given to this session, never
asked for, and nothing key-shaped was written into any file.

The paste-ready Section 131 and ledger row 151 are in `docs/research/OLLAMA_CLOUD.md`.
`RAMA_AGI_MASTER_SPEC.md` is not modified.

---

## 1. Suite counts, before and after

| | before | after |
|---|---|---|
| suites in `npm run verify` | 27 | **28** |
| assertions reported across the chain | 1925 | **2210** |
| failures | 0 | **0** |

The delta is **+285**: a new `scripts/verifyOllamaCloud.cjs` with **264** assertions and
**3 declared residuals**, and **+21** in `scripts/verifyInvariants.cjs` (138 → 159) from the
new `I-SECRETS` row, its planted self-test case, and the per-extension view checks added to
`scannerSelfCheck()`.

`verifyOllamaCloud.cjs` is inserted **after** `verifyOllamaLibrary.cjs` and **before**
`verifyWebResearch.cjs`, keeping the three Ollama suites adjacent. **No existing entry was
reordered or removed.**

---

## 2. What was built

### New

| File | What it is |
|---|---|
| `electron/lib/egressBoundary.cjs` | the ONE constructor of a cloud request body, and the classification gate. Classifies `messages` **and** `parts`, computes `maxLevel` across both so a join is visible, owns the whole envelope (`model`, `stream`, enumerated `options`), and appends accepted parts as their own `system` messages after every caller message. |
| `electron/lib/ollamaCloud.cjs` | the keyed transport. Frozen fourteen-row naming table authoritative in both directions, vault-only credential state with a frozen four-key shape, a frozen fifteen-key `status()`, base-URL validation as a hard gate, `chat`/`listModels`/`webSearch`, and four injection seams. |
| `scripts/verifyOllamaCloud.cjs` | the suite, sections (a)–(k). |
| `docs/research/OLLAMA_CLOUD.md` | the two paste blocks. |
| `docs/research/ollama-cloud-build.md` | this file. |

### Modified — additive only

`electron/ipc/modelRouter.cjs` · `electron/resourceOrchestrator.cjs` ·
`electron/ipc/browserEngine.cjs` (extract-and-export only) · `electron/preload.cjs` ·
`src/pages/Models/Models.jsx` · `src/services/ramaClient.js` · `src/pages/Chat/Chat.jsx` ·
`src/pages/IDE/IDE.jsx` · `src/pages/Resources/Resources.jsx` · `.env.example` ·
`start.cjs` · `scripts/verifyInvariants.cjs` · `package.json`

**Nothing was removed.** The local daemon path is byte-identical in behaviour: `ollamaChat`
still posts to `localhost:11434`, `refreshOllamaModels` still probes `/api/tags` there,
`httpPost`/`httpGet` keep their exact signatures, the four `ollama/*` seed rows keep
`credKey: null, type: 'local'`, and `FALLBACK_CHAIN` gained an export, not an entry. All of
that is asserted in section (j), which is the I11 assertion.

### Not touched

All seven protected files — `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`,
`proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json`. Asserted:
none of them mentions this tranche. `verifyLoyaltyTripwire.cjs --approve` was never run.
`src/pages/StockMind/`, `electron/ipc/intelligenceEngine.cjs`, `electron/genome.cjs`,
`electron/lib/modelRoles.cjs` and `electron/lib/http.cjs` are unmodified. No dependency was
added; `electron/lib/http.cjs` is the only HTTP client, asserted positively.

---

## 3. The seven HIGH items the brief required in the shipped code

1. **Registry rows carry an `id`.** Every `toRegistryEntries()` row has
   `id: 'ollama-cloud/<apiModel>'`. **The non-vacuity assertion is there and it is live**: the
   same row is refused for `narration` with the privacy reason, is accepted for `reasoning`
   (31B clears the 14B floor), `reasons[0] !== 'no model supplied'`, **and stripping the `id`
   is asserted to DO produce the wrong-reason refusal** — a guard that cannot fire is not a
   guard.
2. **The payload gate classifies `messages`.** A `private` message content is refused with
   `where: 'messages'`; the join case plants its private row at index 37 of fifty-one
   **inside `messages`**; `maxLevel` is computed across `messages` and `parts` together.
3. **The `.env` source is gone.** No `source: 'env'` state, no `process.env` credential read
   anywhere in the shipped trees (asserted), every remedy string is the single vault remedy.
   `.env.example` carries the key **name in a comment with no assignment** and the live
   non-secret `OLLAMA_CLOUD_BASE_URL`.
4. **A cloud model is reachable.** `selectModel` gained a last-resort cloud pass after the
   local passes and before `primaryModel`. Asserted: with the dummy key it returns
   `ollama-cloud/qwen3-coder:480b`; with the vault **empty** and with the vault merely
   **locked** it does not.
5. **An absent key is not a silent fallback.** `models:chat` splits `unconfigured[]` from
   `failures[]`, logs only genuine failures, carries `unconfigured` beside `fallbackFrom`, and
   returns `{ ok:false, unconfigured, error, remedy }`. Asserted: the response does **not**
   contain `All models failed`, and `ramaClient.js` forwards `unconfigured`/`remedy`/
   `failures`/`gateError` while `Chat.jsx` renders `res.remedy`.
6. **The capability gate is settled, and it RUNS.** `undefined` user → `gateError` (a
   programming error); `null` → a real denial; a user object → `models.use-cloud` when the
   matrix has it, `models.use` otherwise, with `status().cloudCapability` saying which. The
   positive case is asserted through the real `switch`.
7. **The secret scan is GREEN on the first commit.** Measured over the real tree: 194 files,
   0 prefix hits, 0 entropy hits. The `!WORDY` discriminator alone silences both strings the
   round-2 review measured; the digit test was dropped (see §4.8).

---

## 4. Design claims found FALSE against source, and what was done instead

### 4.1 `npm run verify` DOES run in this worktree — the design said it could not

Design §11.8 and the round-3 review both state that no suite was executed because
`node_modules` is absent. **Measured: the full 28-suite chain runs and is green here.** Every
suite in the chain uses Node built-ins and repo modules only. **`npx vite build` still cannot
run and no claim is made about it** (see §6).

### 4.2 Round-3 finding 14 is itself off by one

The finding says the design's `src/services/ramaClient.js:23` and
`electron/ipc/browserEngine.cjs:193` should be L22 and L192. **Measured: 23 and 193 — the
design was right and the NIT was wrong.** Nothing downstream depended on it; no line number
was changed on the strength of that finding.

### 4.3 The brief's "nothing in the Node/Electron process parses `.env`" is false

`start.cjs:151` `loadEnv()` reads `.env` line by line into `process.env`, and **copies
`.env.example` to `.env` when `.env` is absent**; `start.cjs` spawns children with
`env: { ...process.env }`. **The DECISION the brief required is implemented exactly — vault
only, no `source: 'env'`, no env credential read — but the JUSTIFICATION is the opposite of
the one given, and a wrong justification for a right decision is how the decision gets
reversed by the next session.** The `.env.example` comment, the `--diagnose` warning and the
`process.env` assertion are all written to the true reason: a key there would be in plaintext
on disk **and** inherited by five processes, **and still unusable by Rāma**.

### 4.4 Finding 1 confirmed: `net.request` with an object body throws

`electron/lib/http.cjs` does `Buffer.byteLength(body)` and `req.write(body)` — the body must be
a **string**. Used `post(url, body, opts)` and `get(url, opts)`, which stringify **inside**
`http.cjs` and spread `opts.headers` over its own `Content-Type`. `ollamaCloud.cjs` therefore
contains no `JSON.stringify`, no `body` key assignment and no `.request(` call, and the
dummy-key **success** path is asserted positively — a throw inside `request()` would otherwise
have satisfied every refusal assertion in the suite.

### 4.5 Finding 2 confirmed, and the dropped case

**Zero `.md` files exist under `electron/`, `src/`, `server/`, `scripts/` or `shared/`.** The
specified `I-SECRETS-planted-md` case had nothing to plant into and `walkShipped`'s extension
set would not copy one into the self-test sandbox, so it could only ever fail. **It was
dropped.** The per-extension view choice it existed to prove is asserted in
`scannerSelfCheck()` on synthetic strings instead — `.md`/`.json` raw, the JS family `nc`,
plus a `//`-inside-a-URL case and a literal-survives / comment-does-not pair. **`MUTATIONS`
has fourteen cases, not fifteen.** `.md` scanning nothing today is stated rather than implied.

### 4.6 Finding 4 confirmed: `diagnose()` cannot await

`start.cjs:318` is `function diagnose()`, called un-awaited at L1474 and L1514, and
`probeLocal` does not exist anywhere. **The daemon probe was dropped.** The block is
synchronous, does one `readFileSync`, and adds two report lines plus the `.env` warning and its
`degrade`-severity defect. Daemon reachability belongs to `models:cloud-status`, which can
await and can read the vault.

### 4.7 Finding 5 confirmed: no seam reaches `getCredential`

`modelRouter.cjs:10` destructures `getCredential` at load time, and `credentialVault.cjs:13`
requires `electron` at module scope. **Require-cache stubs for `credentialVault.cjs`,
`dataStore.cjs`, `lib/http.cjs` and `ipc/browserEngine.cjs` are installed before anything real
is loaded**, so the suite runs under bare Node, never loads Electron, never touches master's
real vault path, and creates nothing under `~/.rama-agi`. Stubbing `http.cjs` additionally
makes the fallback-answers assertion possible without a network call.

### 4.8 Finding 9 confirmed: the digit test does no work

Both measured strings — `locally-privileged-but-HTTP-reachable` and
`ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX` — are all letters and separators, so
`WORDY` matches both and the digit test never fires. **Dropped.** `scannerSelfCheck()` asserts
both are rejected as identifier-shaped **and** that a digit-free high-entropy token is still a
candidate, so the removal is proven rather than assumed. Both paste blocks are corrected.

Two implementation choices the finding did not cover: the entropy half scans **quoted string
literals**, not raw text, so a long identifier cannot read as a secret; and **root-level
tracked files receive the prefix matcher only**, which is why `.env.example`'s
`HMAC_SECRET=change-this-to-a-random-64-char-string` is quiet — recorded in the row's own
comment so anyone widening the walk expects it and renames the literal rather than
allow-listing it.

### 4.9 Finding 10 confirmed: `_tick` is guarded by truthiness, not unguarded

`resourceOrchestrator.cjs` had
`if (task.aiProvider && API_RATE_LIMITS[task.aiProvider]) { … usedReq++ }`. The hazard is worse
than "unguarded" conveys: `API_RATE_LIMITS['__proto__']` resolves through the prototype chain
to `Object.prototype`, which **is** truthy, so the guard **passed** and the increment wrote
onto `Object.prototype`. Phrasing corrected in both paste blocks, `hasOwnProperty` applied via
a shared `limitFor()`, and asserted behaviourally:
`Object.prototype.usedReq === undefined` after `_tick` runs with that provider name — reached
through a `CRITICAL` task, because `_canRun` returns `true` for `CRITICAL` before any provider
check, which is the only remaining route to that line.

### 4.10 Design §12(i)'s ceiling assertion was not satisfiable as written

It asks for `admit({ aiProvider })` sixteen times to allow and the seventeenth to defer. **The
specified `admit` block only READS `usedReq`; nothing in it increments.** Making `admit`
increment as well as `recordApiUse` would double-count and produce a fabricated limit. **The
assertion is implemented along the real enforced path**: sixteen `recordApiUse` calls, then the
seventeenth `admit` refuses with a reason naming `16/min`. The enforced number, not the tabled
20, is the one asserted.

### 4.11 `status()` cannot get `inFlight` from the four-member orchestrator seam

Design §2.2 pins the stub to `{ admit, reserveSlot, releaseSlot, recordApiUse }` and §12(i)
asserts a stub missing any of those throws. `status()` needs `inFlight`/`maxConcurrent`.
Adding a fifth required member would change the asserted seam contract. **Instead `status()`
reads the row through a read-only lazy require of the one authority's `API_RATE_LIMITS`,
degrading to `null` when the orchestrator cannot be loaded.** Nothing is written there, and no
field on the row derives from a credential.

### 4.12 Finding 6 confirmed and fixed with a re-check loop

`reserveSlot`'s `CRITICAL` wait tests and increments **in the same synchronous turn**, inside a
`for(;;)` loop, so exactly one waiter wins per release. Asserted: two `CRITICAL` waiters, one
`releaseSlot`, exactly one resolves `{ ok: true, waited: true }`, the other stays pending, and
`inFlight === 1` on a `maxConcurrent: 1` row.

### 4.13 Finding 7: the search body is pinned and labelled

`assemble({ kind: 'search' })` returns `{ query, max_results }` with `maxResults` clamped to
1–10, marked **PROVISIONAL** in the source with a note that the only permitted change when the
real shape is read is the field names inside that function. Asserted: an accepted search body
carries **no key outside that pair** and its only caller-derived value is `query.text`.

### 4.14 Finding 13 confirmed

`PROVIDER_LINKS` is `src/pages/Models/Models.jsx` **L15–L23, eight entries**. The ninth,
`OLLAMA_API_KEY`, was appended.

### 4.15 Smaller corrections made while building

- The suite's structural assertions needed a **comment-stripped** view: a comment explaining
  "no `body` key" contains the text the rule forbids, which would make the rule unstatable.
  `codeOf()` blanks comments before those checks. One source line
  (`typeof res?.body === 'string' ? res.body : ''`) was rewritten because its **ternary colon**
  matched the `body\s*:` pattern — a real false positive caught by the assertion working.
- `egressBoundary` enforces its 1 MB egress ceiling with a structural byte walk rather than
  `JSON.stringify`, so the one-serialiser rule holds inside the gate as well as outside it.
- `models:chat`'s `note()` defaults `e.remedy` to `null`, so a failure without one does not
  produce `undefined` in the response.
- `models:search-web` reads `config.searchBackendOrder`, defaulting
  `['ollama-cloud', 'playwright']`, and hands the backend the **gated** `gate.body.query`
  rather than the caller's object.
- `PROVIDER_COLORS` gained an `ollama-cloud` entry so the keyed rows are not coloured as local
  Ollama rows.
- `Chat.jsx`'s `useCallback` dependency array gained `currentUser`.

---

## 5. Where the capability entry is needed

`shared/capabilities.json` is **protected and was not edited.** Master adds, if he chooses:

```json
"models.use-cloud": 1,
```

Tier 1, matching `models.add-key` and `models.ollama-pull`. Until he does, cloud calls are
gated by `models.use` (tier 3) and `status().cloudCapability` reports
`{ key: 'models.use', dedicated: false }`. Both ways are asserted against a temporarily stubbed
matrix, and the suite asserts the matrix is left exactly as it was found.

Also raised, not taken: promoting the `I-SECRETS` row to numbered invariant `I18` in
Section 28. Rāma recommends promoting it in a separate commit touching only that section.

---

## 6. NOT VERIFIED

**Read this before trusting anything above as measured.**

1. **NO LIVE AUTHENTICATED CALL TO ollama.com WAS MADE, AND NO REAL CREDENTIAL WAS EVER IN
   PLAY.** The network is unreachable from this workspace. Every Ollama fact is taken from the
   brief and cross-checked against `docs/research/OLLAMA_ONLY.md`, and **none was confirmed
   against live documentation in this run**: both auth mechanisms, the `Authorization: Bearer`
   requirement, `x-api-key`'s rejection, *"cloud requests do not require an Ollama
   installation"*, `https://ollama.com/settings/keys`, `/api/chat`'s request and response
   envelope, `GET /api/tags` on the keyed endpoint, free-tier model accessibility, behaviour at
   zero credits, and the one-concurrent-request figure.
2. **The hosted-search endpoint path, request body and response shape are UNKNOWN.**
   `SEARCH_PATH = '/api/web_search'`, `{ query, max_results }` and a `results` array with a
   `url` field are all **provisional**. The gate above them does not depend on any of it.
3. **Thirteen of the fourteen `apiModel` values are INFERRED** from attested daemon tags by the
   strip-the-suffix rule. Only `gemma4:31b` is attested as a cloud-list name. `listModels()`
   exists to reconcile them — and **the reconciliation mechanism is itself inferred**, because
   `GET /api/tags` on the keyed endpoint is taken from the brief.
4. **Free-tier accessibility comes from a third-party tracker**, via OLLAMA_ONLY.md, already
   ~2.5 weeks stale when recorded. A wrong row surfaces as an explicit plan error with the
   model named and no substitution.
5. **`npx vite build` CANNOT RUN in this worktree** — `node_modules` is not installed there —
   so **no claim is made that the renderer build passes.** `scripts/auditRenderer.cjs` does run
   and is green: 79 files, 38 store destructures, 141 bridge calls, 368 IPC channels, all
   resolving. That is reference integrity, not a build.
6. **`browser:search`'s playwright-absent return is asserted STRUCTURALLY, not executed.**
   `browserEngine.cjs` requires `electron` at module scope and `playwright` is absent, so the
   suite asserts the extracted function's first line and the handler's delegation by reading
   source. The behavioural assertion runs under `npm run verify` on a machine with
   `node_modules` installed. The extraction is claimed behaviour-preserving because it moves no
   module-scoped state — a claim from reading, not from running.
7. **The three credential states are asserted as a RENDERING PREDICATE and as strings, not
   through a DOM render.** The suite is a `.cjs` under bare Node with no React test renderer.
   The data behind the three states is asserted behaviourally in section (d).
8. **`egressBoundary`'s practical value is projected, not measured.** With no context store
   built, every part today is a bare string resolving to `public`, so the gate refuses nothing
   in production. What is verifiable now is the structural property: it is the only constructor
   of a cloud body.
9. **`user` arrives from the renderer**, so `capability.can(user, …)` checks a
   renderer-asserted identity. That is the established house pattern and a strict improvement
   on `models:chat`'s previous no-gate state, **but it is not a boundary against a compromised
   renderer** and must not be described as one.
10. **A credential that looks like ordinary prose — low entropy, no known prefix — is not
    detectable by `I-SECRETS`.** The behavioural leak sweep covers the runtime half; the static
    half has this declared gap, carried as a residual in the row itself.
11. **No `.env` file exists in this worktree**, so the key-in-`.env` assertion reports a
    residual rather than a pass. That is the normal state on a fresh clone and `.gitignore`
    guarantees `.env` is never tracked (asserted via `git ls-files`).
