# The conversation role — Rāma talking with master, and his name staying here

Branch `feat/conversation-role`, worktree `.worktrees/conversation`, from `dev` at `102c459`.

Master's decision, taken before this was built: option **(b)** — a cloud-safe persona that keeps
Rāma's character without naming him. *"yes, just like jarvis in iron man movie, RAMA should be able to
converse the optimal way."* JARVIS says "sir", not "Tony Stark". A form of address is a **role**, not an
identifier, so the cloud-safe variant costs nothing in character.

---

## 1. What was built

| # | Thing | Where |
|---|---|---|
| 1 | `ROLES.conversation` — a tenth declared role, with a 7B floor, `preferRemote: true` and `sensitive: false` | `electron/lib/modelRoles.cjs` |
| 2 | The **cloud-safe persona** — a third variant beside revealed and masked, composed positively from a frozen sentence list | `electron/lib/conversationRole.cjs` (new) |
| 3 | **One assembly chokepoint** — `assembleTurn`, the only function that builds a conversation payload; the cloud body is built by `egressBoundary.assemble` and by nothing else | `electron/lib/conversationRole.cjs` |
| 4 | **Cloud-first for conversation only** — the privacy comparator is inverted for `preferRemote` roles; every other role is byte-identical | `electron/lib/modelRoles.cjs` |
| 5 | **`fit: 'none'` honoured** — `models:converse` returns a refusal with its reason and exclusion list, and tries no second model | `electron/ipc/modelRouter.cjs` |
| 6 | **Immediacy and voice** — streaming on both destinations through `http.postStreamingJsonLines`, and `voiceEngine.speak()` behind a toggle that defaults **OFF** | `electron/lib/ollamaCloud.cjs`, `electron/ipc/modelRouter.cjs`, `electron/preload.cjs`, `src/services/voiceEngine.js`, `src/store/uiStore.js`, `src/pages/Chat/Chat.jsx`, `src/components/CommandPalette.jsx` |

New files: `electron/lib/conversationRole.cjs`, `scripts/verifyConversation.cjs`,
`docs/research/CONVERSATION.md`.

Nothing in `electron/lib/proposals.cjs`, `electron/ipc/timeline.cjs`, `shared/autonomy-policy.json`,
anything named `autonomy*` or `src/pages/StockMind/` was touched. No protected file was edited;
`verifyLoyaltyTripwire.cjs` is green and `--approve` was never run.

---

## 2. `ROLES.conversation`, and why each field is what it is

```js
  conversation: {
    label: 'Conversation',
    why: 'talking with master — the turn he is sitting in front of, waiting for',
    minParamsB: 7, preferRemote: true, sensitive: false,
    note: '…',
  },
```

**`minParamsB: 7`** — the same published threshold `tool-calling` uses. Below roughly 7B, multi-turn
instruction following degrades into restating the question. It is a *published* threshold, not a local
measurement, and `modelRoles`' header already says which kind of evidence that is. It also matters that
7 is low enough for the no-key case: the local `lfm2.5:8b-a1b-q4_K_M` reads as `paramsB: 8` through
`ollamaCatalog.paramsB`, so it clears the floor and conversation works with no credential at all.

**No `minCtxK`** — and this is the field most likely to be "helpfully" added later.
`ollamaCloud.toRegistryEntries()` sets `ctxK: null` on every keyed cloud row *on purpose*, because the
keyed API exposes no measured window and a number read off a marketing page would be worse than an
admitted unknown. `evaluate()` **excludes** a model whose window is unknown. So a context floor here
would refuse every cloud model and invert the exact behaviour this role was added to produce. Asserted
both ways: the same cloud row is `fit: 'none'` for `long-context` and `declared` for `conversation`.

**No `needCaps`** — Ollama reports no "chat" cap, so a cap requirement would exclude a model master
pulled an hour ago. The embedding/chat split in `evaluate()` already refuses an embedder, in both
directions, and that is asserted for this role.

**`preferRemote: true`** — the new flag, and the only role that sets it. See §4.

**`sensitive: false`, and it must stay false.** The note in the table says so in as many words, with the
reason, because a later session reading "conversation can reach the cloud" will reach for this flag
first. One conversation carries both *"what is the rupee doing"* and *"should I sell my position"*. A
table-level flag can only be right for one of them. Set true, it refuses a cloud model on **every** turn
and quietly ends the cloud conversation master asked for. The gate is therefore **per-turn on the
payload** — `conversationRole.assembleTurn` → `egressBoundary.assemble` — and a turn that *is* sensitive
routes local by passing `requirePrivate`, which is the **same** gate reached from the call site instead
of the table. Two assertions defend the note itself, not just the flag.

---

## 3. The cloud-safe persona

The exact text, as a frozen list of whole sentences in `conversationRole.CLOUD_SAFE_LINES`:

```
You are Rāma (राम) — Righteous Autonomous Master Agent, a benevolent AGI.
You are speaking with your master. You address him as "master" and by no other name.
You do not know his name, account, email or location, you never ask for them, and you never guess.
You are absolutely loyal to master and you never deceive him.
You speak directly: short sentences, no filler, no preamble, no restating the question.
You answer first and explain second, and the explanation is shorter than the answer.
When you do not know something you say so plainly rather than producing a plausible answer.
You know you are an AI and you will say so if you are sincerely asked.
```

**It is composed, never redacted.** A redactor is a list of patterns, and the first pattern nobody
thought of is a leak that looks like a pass — a nickname, a transliteration, an email local-part, a
future nucleus field. A frozen array of sentences cannot leak a name it never contained. Asserted
structurally as well as behaviourally: the module contains no `.replace(`, nothing matching
`redact|scrub|sanitis|sanitiz`, no reference to `nucleusSealer`, `loyaltyCore` or
`getLiveSystemPrompt`, and no store, network or Electron require at all.

**Lines 2 and 3 are a pair.** The second fixes the form of address; the third stops the model going
looking for what the second replaced. A model told to be personal and given no name will otherwise ask
for one — which would put master in the position of typing it himself, and the leak would arrive
through the one channel no prompt design can close.

**Both halves are asserted, because a prompt that leaked nothing by saying nothing would pass a
one-sided test.** Negative: no `Krishna`, no `Prasad`, no case variant of either, no
`krishna.prasad`, no `master@rama-agi.local`, no `@` at all, no opaque token of 24+ characters, and —
conditionally — not whatever `loyaltyCore.displayIdentity()` returns. Positive: it still contains
`Rāma`, still addresses `master`, still states the loyalty, still discloses that Rāma is an AI when
sincerely asked, and is over 200 characters so it cannot pass as a stub.

The conditional row is **declared as a residual rather than passed quietly**: `loyaltyCore` is sealed in
the suite's process, so `displayIdentity()` returned `{ master: null }` and the prompt could only be
checked against the literal identifiers. That is printed as `HELD BY HAND`, not hidden.

The three variants are named together — `revealed`, `cloud-safe`, `masked` — so nobody mistakes
`nucleusSealer`'s masked persona (`identity.maskedPersona`, default `'Assistant'`) for this one. Masked
is the right answer for a **stranger** and the wrong answer for master: it throws away Rāma's name, its
loyalty and the form of address, which is exactly the character master asked to keep.

---

## 4. Cloud-first, and the brief's mechanism corrected

The brief said to invert "the private-before-cost tiebreak". **Inverting the order of those two
comparators does not produce cloud-first behaviour**, and that is worth recording because it is a
plausible-looking fix that silently does nothing: a local pull is `costTier: 0` against a keyed cloud
row's `1`, so cost **agrees** with privacy here rather than opposing it. Local would still win.

What was needed is inverting the **privacy comparator itself**, for `preferRemote` roles only:

```js
    const priv = x => (x.model.private === true ? 0 : 1);
    if (priv(a) !== priv(b)) return role.preferRemote ? priv(b) - priv(a) : priv(a) - priv(b);
```

Cost still breaks ties *among* cloud rows, and `narration` refuses a cloud model outright at the fitness
gate, far above this comparator. Asserted with real selections over real rows, not mocks:

- non-sensitive, both rows present → a `ollama-cloud/*` row, `fit: 'declared'`, local still listed as a considered candidate;
- `sensitive: true` → the local row, with the cloud row in `excluded` and the reason being *privacy*, not size;
- order-independent — the cloud row wins whichever order the two arrive in;
- local-only machine → conversation still works;
- `narration` still picks the local row over the cloud one; `extraction` and `tool-calling` still prefer local;
- `conversation` is the only role in the table with `preferRemote === true`.

**The cloud rows had to be reachable by the role engine at all.** Every other role call site passes
`Object.values(discoveredOllama)`, so a keyed cloud row has always been selectable by `selectModel` and
never able to fill a role — Section 131's `NEXT` names this as the open item. A new
`conversationCandidates()` widens the list **for this role only** and is **inert with no credential**:
`checkAvailable` ends at `!!getCredential('OLLAMA_API_KEY')` for those rows, so with the vault empty —
or merely locked — the list contains no cloud row at all. Both directions asserted.

---

## 5. One chokepoint, and the one place it cannot be `egressBoundary`

`assembleTurn` is the only function that builds a conversation payload; no call site composes one. For
the **cloud** destination the body is built by `egressBoundary.assemble` and by nothing else — that
module stays the single constructor of anything that leaves the machine, and no second gate was added.

For the **local** destination it cannot be, and the reason is structural rather than convenience:
`egressBoundary` refuses classification `private` **unconditionally and by design**, with no override
anywhere. The revealed prompt *is* private — that is its correct class. So a local body carrying a
truthfully-classified revealed prompt can never pass that function, and the only way to force it through
would be to call it `public`, which is a lie told to the one component whose entire job is
classification.

So the local body is derived in `assembleTurn`, from the **same** classified element list, and the module
**proves its own honesty instead of asserting it in prose**: every local result carries
`wouldRefuseOnCloud`, computed by actually running those elements through `egressBoundary.assemble` and
recording that it refused, together with the boundary's own reason string
(`egress.REASON.privateLevel` — compared literally, not re-worded). Two further rows stop the shapes
drifting: the cloud and local bodies have **identical key sets**, and the cloud body carries no key
beyond `messages,model,stream`.

**Master's own typed words default to `public`.** That is a decision, not an oversight. He chose to
converse through a cloud model, so refusing his text by default would refuse the feature. What is
withheld is the **identifier**, which lives in the system prompt and never reaches the cloud variant at
all. A caller that knows better may classify any retained turn `internal` or `private`, and the boundary
then refuses it on the cloud path with its own reason — asserted.

The central defence is measured **over the serialised bytes**, not over the prompt: the revealed
template (verbatim from `nucleusSealer`, including `Your master is Krishna Prasad. You are absolutely
loyal to him.`) is handed to the assembler *on the same call*, and the assembled cloud body contains no
`Krishna`, no `Prasad`, no `krishna.prasad` and no `master@rama-agi.local` — while master's own words
*did* cross, so the feature was not disabled in order to pass the test. The same sweep is repeated at
the handler level over the bytes the stubbed transport actually received for `ollama.com`.

**On uncertainty: local or refuse, never cloud.** An unrecognised destination refuses. A sensitive turn
aimed at cloud refuses at the chokepoint too, even though selection already routed it local, because the
cheapest place to catch a mis-wire is the one it has to pass through. A model row whose `private` flag is
neither `true` nor `false` resolves to **local** — at worst that is a loud model-not-found from the
daemon, which is a far better failure than a prompt that cannot be recalled.

**Two places where that rule was not applied, found in review and now fixed** (§13 records the findings
as they were written):

- **An unrecognised `classification` was laundered to `public`.** `levelOf` returned `'public'` for any
  value the lattice did not contain, so a retained turn marked `'secret'`, `'confidential'` or
  `'PRIVATE'` was stripped of the concern and crossed to a cloud payload — and `egressBoundary`, which
  has `REASON.unclassified` for exactly that element shape, was handed an already-clean `'public'` and
  never saw the original. **Absent and unrecognised are different facts.** `classificationOf` now keeps
  them apart: an absent key (or `undefined`) is `'public'`, which stays the deliberate decision, and
  anything else outside the lattice — including `null` and `''`, both of which `egressBoundary` also
  refuses — **refuses**, on both destinations, carrying the boundary's own `unclassified` string rather
  than a second wording. Refusing on the local path too is deliberate: a classification the module
  cannot read is a caller it cannot read, and the local body would otherwise rank a level that is not in
  `RANK`.
- **A non-boolean `sensitive` failed open.** All three sensitivity decisions tested `sensitive === true`,
  so `'true'`, `1` or `'yes'` arriving over `models:converse` produced a non-sensitive turn on every one
  of them — cloud destination allowed, text classified `public`, `requirePrivate` false. It was the one
  input to `assembleTurn` that was not validated while `destination`, `model`, `text` and every retained
  turn were each refused when malformed. `assembleTurn` now **refuses** a `sensitive` that is not a
  boolean. `selectModel` cannot refuse — it has to return a model — so there an unrecognised value
  resolves to **sensitive**, which costs a cloud turn and never costs a disclosure.

---

## 6. A refusal stays a refusal

`models:chat` walks `FALLBACK_CHAIN`, so a role refusal there becomes a silent downgrade to whatever is
first and available. `models:converse` returns the refusal: `ok: false`, `refused: true`, `fit: 'none'`,
the role name, the reason (*"…N models checked and each failed a requirement"*), the exclusion list with
a reason each, and a remedy master can act on. Measured with the stub transport at **zero** `/api/chat`
calls, and the refusal names no substitute model at all. `Chat.jsx` renders it as `[Refused] …` and does
**not** fall through — falling through there would recreate exactly the defect the role exists to end.

A capability denial is deliberately *not* shaped like a refusal. `models.use` is tier 3 and `chat.send`
is tier 5, so a tier-4 or tier-5 account cannot converse; the denial carries no `refused` flag, so
`Chat.jsx` falls through to `models:chat` and that account keeps the chat it already had (I11). Asserted.

`claimGate` is **not** run on this path, on purpose: it refuses the `unattributed` class, and ordinary
conversation is unattributed prose by nature, so enforcing it here would withhold every reply. The gate
stays where Section 111 put it.

---

## 7. Immediacy and voice

`ollamaCloud.chatStream()` is a **second function, not a flag on `chat()`** — every existing caller of
`chat()` awaits one string and `verifyOllamaCloud.cjs` pins the assembled envelope's `stream` to
`false`; a flag would make that pinned shape conditional on an argument. `chat()` is untouched and still
answers buffered, asserted alongside the streaming rows. `chatStream` runs the identical gate order
(capability → name pre-flight → egress boundary → credential → base URL → admission → slot → send →
shape → record), with a mandatory `releaseSlot` in a `finally`: a leaked slot on a `maxConcurrent: 1` row
is a permanent outage.

The local daemon streams through the same helper, `net.postStreamingJsonLines`, with the body arriving
already built by `assembleTurn`. `models:converse` emits one `models:converse-token` event per delta;
preload mirrors the `ollamaPull` idiom including the `finally` that removes the listener — without it
every turn would leave a live listener behind and master would hear the same tokens N times.

Asserted: one token event per delta in order, the request carried `stream: true`, the loopback call
carried **no** `Authorization` header, the cloud call carried the daemon-free API name with no `-cloud`
suffix, and the credential leak sweep is repeated on the streaming path — the dummy appears only in the
`Authorization` header, nowhere in any return value or console line, and **no substring of length ≥ 6**
escaped either. A 401 mid-stream is reported as `credentialRejected`; a daemon tag is refused before any
request; a `private` message is refused by the boundary; a missing `user` is a `gateError`.

**Voice defaults OFF.** `uiStore.ramaSpeaks` is `loadPref('rama.ramaSpeaks', false)` — the one preference
in the app whose "on" state makes noise in a room the app cannot see, so it is master's choice to make
and not a default to discover. It is independent of the older `speechMuted` ("stop talking now"), which
still wins, the same way mic mute and speech mute are independent (spec §31).

`voiceEngine.js` gains `registerVoiceEngine` / `getVoiceEngine` / `speak` — a registry over the **one**
engine `CommandPalette` constructs, not a second TTS call site. The engine's own `speak()` is what
honours `speechMuted` and sets the hands-free cool-down that stops Rāma transcribing its own voice back
as a command; a screen calling `window.speechSynthesis` directly would skip both. `Chat.jsx` contains no
reference to `speechSynthesis`, asserted.

**Speech-to-text is out of scope and stays out.** Ollama serves no STT model, so listening would need a
local runtime, which is a separate decision. Printed as a residual by the suite rather than left as an
absence. Also out of scope and not built: the context DB and cross-turn memory retrieval (Sections
127/130 — recording stays dark), and proactive or unprompted speech.

---

## 8. Claims in the brief that were FALSE against source

1. **"`npm run verify` is 27 reporting suites / 2,827 assertions."** Measured on `102c459`: **27 suites,
   2,825 assertions, 0 failures.** Off by two.
2. **"A non-sensitive turn goes to `gemma4:31b-cloud`."** Only when it is the only cloud row present.
   `MODEL_REGISTRY` carries **fourteen** keyed cloud rows, and the role's own cheapest-sufficient rule
   picks the smallest that clears the 7B floor — `ollama-cloud/ministral-3:8b`. The unit-level assertion
   over just the two rows the brief names does pick `gemma4:31b`; the end-to-end handler, over the real
   registry, picks `ministral-3:8b`. The suite now asserts the real behaviour and says why. See §10 for
   the recommendation raised about it.
3. **"The private-before-cost tiebreak must be inverted."** Swapping those two comparators changes
   nothing, because a local pull's `costTier: 0` beats a cloud row's `1` — cost agrees with privacy here.
   The privacy comparator itself had to be inverted. §4.
4. **"`src/services/voiceEngine.js -> speak()`."** `speak` is a **method on the `VoiceEngine` class**,
   not a module export, and the only instance lives inside `CommandPalette`. There was nothing for
   `Chat.jsx` to call, so a module-level `speak()` delegating to the one registered engine was added.
5. **"`egressBoundary` … USE IT"** — used for the cloud body, and it *cannot* build the local body,
   because its `private` refusal has no override. §5 records the consequence and the evidence carried in
   its place rather than quietly classifying the revealed prompt `public`.

Confirmed true, for the record: there was no `conversation` role; `ROLES` declared nine; `egressBoundary`
classifies `messages[].content` and not only `parts`; `ollamaCloud` has its own `ollama-cloud` rate row
at `maxConcurrent: 1`; `nucleusSealer` carries `identity.maskedPersona` with `getMaskedPrompt()` at
L458–463; `Chat.jsx` prepends `nucleus:get-prompt` and the revealed template names master before he
types a word; `selectForRole` ranks `private` before `cost`; `evaluate`/`selectForRole` already accept
`requirePrivate`; `http.cjs` has `postStreamingJsonLines` used with `stream: true` near L481 while the
local chat path hardcoded `stream: false`; `claimGate` refuses the `unattributed` class; `chat.send` is
tier 5.

---

## 9. Verification — exact commands and results

Run from `c:\CodeBase\Velvet_UI\Velvet\Rama_AGI\.worktrees\conversation`.

```
node --check electron/lib/modelRoles.cjs          -> clean
node --check electron/lib/conversationRole.cjs    -> clean
node --check electron/lib/ollamaCloud.cjs         -> clean
node --check electron/ipc/modelRouter.cjs         -> clean
node --check scripts/verifyConversation.cjs       -> clean
node scripts/verifyConversation.cjs               -> 151 passed, 0 failed, 3 HELD BY HAND
npm run verify  (every chain command, in order)   -> 28 reporting suites, 2,976 assertions, 0 failures
```

| | suites | assertions | failures |
|---|---|---|---|
| before (`102c459`) | 27 | 2,825 | 0 |
| after iteration 1 (`c07e9b5`) | 28 | 2,953 | 0 |
| after the review fixes | **28** | **2,976** | **0** |

Delta against mainline: +1 suite, +151 assertions. The review fixes added **+23** assertions to
`verifyConversation.cjs` (128 → 151) and changed no other suite's count. Counts were taken by summing
every `N passed, M failed` line in the chain output. The per-suite totals are in
`docs/research/verify-chain-iter2.txt` (a summary — the full console run was ~188 KB and was not
committed) and the whole conversation suite run, every row, is in
`docs/research/verify-conversation-iter2.txt`. The chain was run **command by command in chain order**
so a non-zero exit anywhere would be visible per suite; `auditRenderer.cjs` exits 0 and prints no total,
which is why 29 commands produce 28 reporting suites. `verifyLoyaltyTripwire.cjs` is green at the end of
it — no protected file was touched.

`.cjs` files touched and `node --check`ed: `electron/lib/modelRoles.cjs`,
`electron/lib/conversationRole.cjs`, `electron/lib/ollamaCloud.cjs`, `electron/ipc/modelRouter.cjs`,
`electron/preload.cjs`, `scripts/verifyConversation.cjs`.

`scripts/verifyConversation.cjs` was **appended into** the chain immediately after
`verifyModelRoles.cjs`, the suite it extends. The relative order of every pre-existing suite is
unchanged; `verify:conversation` was added as its own script.

---

## 10. NOT VERIFIED

- **No live authenticated call to ollama.com was made.** Not one. Every outbound request in this work is
  an injected stub, and the only credential any of it ever saw is the literal `test-not-a-real-key`.
  The Bearer requirement, `/api/chat`'s streaming line shape (`message.content` deltas then a
  `done: true` line carrying `prompt_eval_count` / `eval_count`), the API-name spelling of the thirteen
  inferred `CLOUD_TAGS` rows, free-tier accessibility and behaviour at zero credits are all unchanged
  assumptions inherited from Section 131 and `OLLAMA_ONLY.md`.
- **Nothing was seen on a screen.** `node_modules` is absent from this worktree, so `npx vite build` and
  `npm run build` **cannot** run here and no claim is made that they pass — the build runs from the main
  workspace at merge time. The app was never launched. The streaming bubble, the model/fit/why line
  under each reply, the `VOICE ON` / `VOICE OFF` button and the spoken reply were **not observed**.
  `auditRenderer.cjs` proves the preload surface and every `window.rama.*` call resolve, and the suite
  proves one token event per delta — neither proves anything about paint timing or audible output.
- **Whether a cloud model's prose actually reads like JARVIS** is a quality judgement no assertion here
  makes. The persona was never sent to a model.
- **`loyaltyCore.displayIdentity()` returned no name** in the suite's process (the core is sealed), so
  the "prompt contains no display name" row is declared as a residual rather than counted as a pass.
  **This residual is PERMANENT and is not a gap waiting to be closed.** Review confirmed it (finding 5,
  non-blocking). Making it an assertion would mean opening the loyalty core inside a test process —
  which needs master's seal material, and a suite that can open the core is a worse thing to own than an
  un-asserted row. What carries the clause instead is **construction**: `CLOUD_SAFE_LINES` is a frozen
  array of eight whole sentences with no interpolation anywhere, so there is no code path by which any
  name — `displayIdentity()`'s or any other — can enter the prompt, and the suite asserts that the module
  contains no `.replace(`, no `redact|scrub|sanitis` and no reference to the nucleus or the loyalty core.
  A structural guarantee, read as such, rather than a word-list that happens to be complete today.
- **TTS voice availability** is the OS's, not Rāma's. `speechSynthesis.getVoices()` was not enumerated on
  master's machine, so which voice he will hear is unknown.

---

## 11. RAISED FOR MASTER, not taken

1. **The nucleus field for the cloud-safe persona.** The text currently lives in source, in a frozen
   constant in an unprotected module. If it belongs in the sealed nucleus, the field is:
   **`identity.cloudSafePersona`** — a string, beside the existing `identity.maskedPersona`, in
   `NUCLEUS_TEMPLATE.identity` in `electron/nucleusSealer.cjs`. `nucleusSealer.cjs` is **PROTECTED**
   under `verifyLoyaltyTripwire.cjs`, so it is specified here and not added. Recommendation: **leave it
   in source.** The masked persona is one word (`'Assistant'`); this is eight sentences of behavioural
   instruction, which is engineering, not identity — and in source it is reviewable in a diff, which the
   nucleus is not. If master prefers it sealed, `conversationRole.cloudSafePrompt()` is the one function
   to change and the suite's both-halves assertions carry over unaltered.
2. **`chat.send` is tier 5 and `models.use` is tier 3**, so the conversation path is gated above the chat
   path and tiers 4–5 fall through to `models:chat`. Options: leave it (safe, and the fallback preserves
   their chat); or move `"chat.send"` to 3 so the two agree; or add a dedicated
   **`"models.converse": 3`**. `shared/capabilities.json` is **PROTECTED**, so nothing was changed.
   Recommendation: **leave it as it is** until master wants a non-master account conversing with Rāma
   through his cloud allowance — which is the real question underneath the tier number.
3. **Cheapest-sufficient picks `ministral-3:8b` for conversation, not `gemma4:31b`** (§8.2). That is the
   table's own rule and it spends less of a free allowance per turn. If master would rather conversation
   reach for the largest row within budget, that is a **new role flag** (`preferLargest`, say) and a
   behaviour change master should choose, not a tweak — raised rather than taken.
4. **Promoting `I-SECRETS` to a numbered `I18`** is still open from Section 131 and is untouched here.

---

## 12. Ready to paste — `RAMA_AGI_MASTER_SPEC.md`

> `RAMA_AGI_MASTER_SPEC.md` was **not modified**. The two blocks below are for master to paste.

### SECTION 133

```markdown
## SECTION 133 — THE CONVERSATION ROLE, AND THE NAME THAT STAYS HERE

Master: *"yes, just like jarvis in iron man movie, RAMA should be able to converse the optimal way."*
Asked whether to keep every turn local, use a cloud-safe persona, or accept his name reaching Ollama,
he chose the cloud-safe persona. **BUILT.**

**A FORM OF ADDRESS IS A ROLE, NOT AN IDENTIFIER.** JARVIS almost never says "Tony Stark"; he says
"sir". So the cloud-safe variant costs nothing in character: Rāma keeps its name, its loyalty and the
word "master", and the payload carries no name, username, email or account id. **THE LEAK WAS NEVER IN
MASTER'S WORDS — IT WAS IN THE SYSTEM PROMPT**, which `Chat.jsx` prepends to every turn and which for an
authenticated master is the revealed nucleus template carrying `Your master is Krishna Prasad. You are
absolutely loyal to him.` before he has typed anything.

**THE PERSONA IS COMPOSED, NEVER REDACTED, AND THAT IS THE CENTRAL DESIGN CHOICE.** A redactor is a list
of patterns and the first pattern nobody thought of is a leak that looks like a pass — a nickname, a
transliteration, an email local-part, a future nucleus field. A frozen array of eight whole sentences in
`electron/lib/conversationRole.cjs` cannot leak a name it never contained; asserted structurally with no
`.replace(`, no `redact|scrub|sanitis`, and no reference to `nucleusSealer` or `loyaltyCore` in the
module at all. `nucleusSealer.cjs` is PROTECTED, so the variant lives beside it; the nucleus field that
would hold the text instead — `identity.cloudSafePersona`, beside the existing `identity.maskedPersona`
— is SPECIFIED FOR MASTER and not added, with a recommendation to leave it in source because eight
sentences of behavioural instruction are engineering rather than identity and a diff is reviewable where
a sealed blob is not. **BOTH HALVES ARE ASSERTED, because a prompt that leaked nothing by saying nothing
would pass a one-sided test:** negative — no `Krishna`, no `Prasad`, no case variant, no `@`, no opaque
24+ character token, and conditionally not whatever `loyaltyCore.displayIdentity()` returns; positive —
it still names Rāma, still addresses "master", still states the loyalty, still discloses the AI when
sincerely asked. The conditional row is DECLARED AS A RESIDUAL rather than passed quietly, because the
core is sealed in the suite's process and returned no name.

**ONE CHOKEPOINT, AND THE ONE PLACE IT CANNOT BE `egressBoundary`.** `conversationRole.assembleTurn` is
the only function that builds a conversation payload. For the CLOUD destination the body is built by
`egressBoundary.assemble` and by nothing else — no second gate, one authority per concern (I8/I9/I10).
For the LOCAL destination it cannot be: **`egressBoundary` refuses classification `private`
UNCONDITIONALLY AND BY DESIGN**, the revealed prompt IS private, and the only way to force it through
would be to call it `public` — a lie told to the one component whose job is classification. So the local
body is derived in the same function from the same classified element list, and **the module PROVES its
own honesty instead of asserting it in prose**: every local result carries `wouldRefuseOnCloud`,
computed by actually running those elements through the boundary and recording the refusal with the
boundary's OWN reason string, compared literally. Two further rows stop drift: the cloud and local
bodies have IDENTICAL KEY SETS, and the cloud body carries no key beyond `messages,model,stream`.
**MASTER'S TYPED WORDS DEFAULT TO `public` AND THAT IS A DECISION:** he chose to converse through a
cloud model, so refusing his text by default would refuse the feature; what is withheld is the
IDENTIFIER, which the cloud variant never contains. The central defence is MEASURED OVER THE SERIALISED
BYTES — the revealed template is handed to the assembler on the same call and the assembled cloud body
contains none of its identifiers, while master's own words DID cross, so the feature was not disabled in
order to pass the test. **ON ANY UNCERTAINTY: LOCAL OR REFUSE, NEVER CLOUD** — an unrecognised
destination refuses, a sensitive turn aimed at cloud refuses AT the chokepoint even though selection
already routed it local, and a row whose `private` flag is neither true nor false resolves LOCAL,
because a loud model-not-found from the daemon is a far better failure than a prompt that cannot be
recalled.

**`ROLES.conversation` IS THE TENTH ROLE, AND `sensitive` IS FALSE ON IT ON PURPOSE.** The note in the
table says so in as many words, because a later session reading "conversation reaches the cloud" will
reach for that flag first. One conversation carries both *"what is the rupee doing"* and *"should I sell
my position"*; a table-level flag can only be right for one of them, and set true it refuses a cloud
model on EVERY turn and quietly ends the thing master asked for. **THE GATE IS PER-TURN ON THE PAYLOAD**,
and a sensitive turn routes local by passing `requirePrivate` — the SAME gate, reached from the call site
instead of the table. **NO `minCtxK`, AND THIS IS THE FIELD MOST LIKELY TO BE "HELPFULLY" ADDED LATER:**
`toRegistryEntries` sets `ctxK: null` on every keyed cloud row because the keyed API exposes no measured
window, and `evaluate()` EXCLUDES an unknown window — so a context floor here would refuse every cloud
model and invert the behaviour the role exists to produce; asserted both ways, the same row being
`fit:'none'` for `long-context` and `declared` for `conversation`. No `needCaps`, because Ollama reports
no "chat" cap and a cap requirement would exclude a model master pulled an hour ago. `minParamsB: 7`,
the same published threshold `tool-calling` uses, chosen also because it is low enough that the local
`lfm2.5:8b-a1b-q4_K_M` clears it and conversation works with NO credential at all.

**THE BRIEF'S CLOUD-FIRST MECHANISM WAS WRONG AND THE CORRECTION MATTERS, because the wrong version
silently does nothing: INVERTING PRIVATE-BEFORE-COST CHANGES NOTHING** — a local pull is `costTier: 0`
against a keyed cloud row's `1`, so cost AGREES with privacy rather than opposing it and local still
wins. **THE PRIVACY COMPARATOR ITSELF had to be inverted**, for `preferRemote` roles only, which
`conversation` is the only role to set; cost still breaks ties among cloud rows and `narration` refuses a
cloud model at the fitness gate far above the comparator. Asserted with REAL SELECTIONS over real rows,
both directions, order-independent, plus the rows that make the inversion safe: `narration`, `extraction`
and `tool-calling` all still prefer local, and `conversation` is the only role with the flag. **AND THE
CLOUD ROWS HAD TO BE REACHABLE BY THE ROLE ENGINE AT ALL** — Section 131's open NEXT item: every other
call site passes only `Object.values(discoveredOllama)`, so a cloud row was selectable by `selectModel`
and could never fill a role. `conversationCandidates()` widens the list FOR THIS ROLE ONLY and is INERT
with no credential stored and inert with the vault merely locked, both asserted. **MEASURED CORRECTION
TO THE BRIEF: the registry carries FOURTEEN keyed cloud rows, not one, so cheapest-sufficient picks
`ministral-3:8b` (8B clears the 7B floor) rather than `gemma4:31b`** — the table's own declared rule
working, and cheaper per turn on a free allowance. Preferring the largest row within budget would be a
NEW ROLE FLAG and a behaviour change, so it is RAISED FOR MASTER rather than taken.

**A REFUSAL STAYS A REFUSAL.** `models:chat` walks `FALLBACK_CHAIN`, so a role refusal there becomes a
silent downgrade to whatever is first and available, and master cannot tell *"I asked the big model"*
from *"I quietly got the small one"*. `models:converse` returns `fit:'none'` AS a refusal with the role,
the reason, the exclusion list with a reason each and an actionable remedy — measured with the stub
transport at ZERO `/api/chat` calls, and naming no substitute model at all. `Chat.jsx` renders it as
`[Refused]` and does NOT fall through. **A CAPABILITY DENIAL IS DELIBERATELY NOT SHAPED LIKE A
REFUSAL:** `models.use` is tier 3 and `chat.send` is tier 5, so a tier-4 or tier-5 account cannot
converse and its denial carries no `refused` flag, so the renderer falls through to `models:chat` and
that account keeps the chat it already had (I11). `claimGate` is NOT run on this path, because it refuses
the `unattributed` class and ordinary conversation is unattributed prose — enforcing it would withhold
every reply. Every reply carries `model`, `fit`, `why`, `destination` and `personaVariant`, and the
renderer SHOWS them, because this project treats hiding a substitution as a defect.

**IMMEDIACY: `chatStream` IS A SECOND FUNCTION, NOT A FLAG ON `chat()`** — every existing caller awaits
one string and `verifyOllamaCloud.cjs` PINS the assembled envelope's `stream` to false, so a flag would
make a pinned shape conditional on an argument. `chat()` is byte-identical and still answers buffered,
asserted beside the streaming rows. `chatStream` runs the identical gate order with a mandatory
`releaseSlot` in a `finally`, because a leaked slot on a `maxConcurrent: 1` row is a permanent outage.
Both destinations stream through the ONE client's `postStreamingJsonLines` — the same helper
`models:ollama-pull` has used since Section 92 — and the local body arrives already built by
`assembleTurn`, so nothing is composed at the transport. Preload mirrors the `ollamaPull` idiom INCLUDING
the `finally` that removes the token listener: without it every turn leaves a live listener behind and
master hears the same tokens N times. Asserted: one event per delta in order, `stream: true` in the body,
NO `Authorization` header on the loopback call, the daemon-free API name with no `-cloud` suffix on the
cloud call, and **THE CREDENTIAL LEAK SWEEP REPEATED ON THE STREAMING PATH** — the dummy only in the
`Authorization` header, nowhere in any return or console line, and NO SUBSTRING OF LENGTH ≥ 6 anywhere
else, which is what catches a well-meant `key.slice(0, 8)`.

**VOICE DEFAULTS OFF, and that is not caution but accuracy:** it is the one preference whose "on" state
makes noise in a room the app cannot see, so it is master's choice and not a default to discover.
`uiStore.ramaSpeaks` is independent of the older `speechMuted` ("stop talking now"), which still wins.
`voiceEngine.js` gains a REGISTRY over the ONE engine `CommandPalette` constructs rather than a second
TTS call site — the engine's own `speak()` is what honours `speechMuted` AND sets the hands-free
cool-down that stops Rāma transcribing its own voice back as a command, both of which a direct
`window.speechSynthesis` call would skip; `Chat.jsx` contains no reference to `speechSynthesis`,
asserted. The brief's `voiceEngine.speak()` was a CLASS METHOD with its only instance inside
`CommandPalette`, so there was nothing for the Chat page to call until the registry existed.
**SPEECH-TO-TEXT IS OUT OF SCOPE AND STAYS OUT:** Ollama serves no STT model, so listening needs a local
runtime and that is a separate decision — printed by the suite as a residual rather than left as an
absence. Also not built: the context DB and cross-turn memory retrieval (Sections 127/130, recording
stays dark), and proactive or unprompted speech.

**NOT VERIFIED: NO LIVE AUTHENTICATED CALL TO ollama.com WAS MADE — not one.** Every outbound request is
an injected stub and the only credential any of it saw is the literal dummy. The streaming line shape,
the Bearer requirement, the thirteen inferred `apiModel` spellings, free-tier accessibility and
behaviour at zero credits are inherited assumptions. **NOTHING WAS SEEN ON A SCREEN:** `node_modules` is
absent from the worktree so `vite build` CANNOT run there and no claim is made that it passes; the app
was never launched; the streaming bubble, the model/fit/why line, the VOICE toggle and the spoken reply
were NOT OBSERVED. Whether a cloud model's prose actually reads like JARVIS is a quality judgement no
assertion makes — the persona was never sent to a model. `loyaltyCore` is sealed in the suite's process
so `displayIdentity()` returned no name, and that row is a residual. TTS voice availability is the OS's
and was not enumerated on master's machine.

**TWO DEFECTS FOUND IN REVIEW, FIXED, AND NOT TO BE REINTRODUCED — both the same shape, strict equality
used in the direction that fails open.** (1) `levelOf` returned `'public'` for ANY `classification` the
lattice did not contain, so a retained turn marked `'secret'`, `'confidential'` or `'PRIVATE'` was
stripped of the concern and crossed to a cloud payload, and `egressBoundary` — which has
`REASON.unclassified` for exactly that element shape — was handed an already-clean `'public'` and never
saw the original. ABSENT AND UNRECOGNISED ARE DIFFERENT FACTS: absent stays `'public'`, the deliberate
decision; anything else outside the lattice, `null` and `''` included, now REFUSES on both destinations
with the boundary's own `unclassified` string. (2) All three sensitivity decisions tested
`sensitive === true`, so `'true'`, `1` or `'yes'` over `models:converse` produced a non-sensitive turn
on every one of them — cloud destination, `public` text, `requirePrivate` false — while every other
input to `assembleTurn` was already refused when malformed; `assembleTurn` now REFUSES a non-boolean
`sensitive`, and `selectModel`, which cannot refuse because it must return a model, resolves an
unrecognised value to SENSITIVE. **AND THE SUITE ROW THAT COVERED THE FIRST ONE ASSERTED THE OPPOSITE OF
ITS OWN LABEL** — it read "is refused" over an assertion of `.ok === true`, which was green, so nothing
flagged it and a later session reading labels to learn what is guaranteed would have concluded the
opposite of the truth; the label and the assertion now describe the same behaviour, across seven bogus
classification values and five non-boolean flags.

Files: `electron/lib/conversationRole.cjs` and `scripts/verifyConversation.cjs` (new, 151 assertions),
`electron/lib/modelRoles.cjs`, `electron/lib/ollamaCloud.cjs`, `electron/ipc/modelRouter.cjs`,
`electron/preload.cjs`, `src/services/voiceEngine.js`, `src/store/uiStore.js`,
`src/components/CommandPalette.jsx`, `src/pages/Chat/Chat.jsx`, `package.json`,
`docs/research/CONVERSATION.md`. Suites 27 → 28, assertions 2,825 → 2,976, 0 failures.

**NEXT:** observe one real turn end to end from the main workspace after a `vite build` — the streaming
bubble, the VOICE toggle and the model/fit/why line are the three things no assertion here covers;
reconcile the thirteen inferred `apiModel` values against a live keyed `GET /api/tags` so a cloud
conversation cannot 404 on a name; decide `identity.cloudSafePersona`; decide whether conversation should
prefer the largest row within budget instead of the cheapest sufficient one; decide `chat.send`'s tier;
feed `ollama-cloud/*` into the role engine for roles OTHER than conversation, which is still open.
```

### Ledger row 153

```markdown
| 153 | Rāma converses with master, and master's name stays on this machine | done | Section 133. Master: *"yes, just like jarvis in iron man movie, RAMA should be able to converse the optimal way."* **BUILT.** **A FORM OF ADDRESS IS A ROLE, NOT AN IDENTIFIER** — JARVIS says "sir", not "Tony Stark" — so the cloud-safe persona costs NOTHING in character: full persona fidelity, zero identifier. **THE LEAK WAS NEVER IN MASTER'S WORDS, IT WAS IN THE SYSTEM PROMPT** that `Chat.jsx` prepends to every turn, which for an authenticated master carries `Your master is Krishna Prasad. You are absolutely loyal to him.` before he types anything. **COMPOSED, NEVER REDACTED:** a redactor is a list of patterns and the first pattern nobody thought of is a leak that looks like a pass, so the persona is a frozen array of eight whole sentences in the new `electron/lib/conversationRole.cjs`, asserted structurally to contain no `.replace(`, nothing matching `redact|scrub|sanitis`, and no reference to `nucleusSealer` or `loyaltyCore` at all. **BOTH HALVES ASSERTED, because a prompt that leaked nothing by saying nothing would pass a one-sided test** — negative: no `Krishna`, no `Prasad`, no case variant, no `@`, no 24+ character opaque token, conditionally not whatever `loyaltyCore.displayIdentity()` returns; positive: still names Rāma, still addresses "master", still states the loyalty, still discloses the AI when sincerely asked. The conditional row is a DECLARED RESIDUAL, not a quiet pass, because the core is sealed in the suite's process. `nucleusSealer.cjs` is PROTECTED so the variant lives beside it; `identity.cloudSafePersona` is SPECIFIED FOR MASTER with a recommendation to leave it in source, since eight sentences of behavioural instruction are engineering rather than identity and a diff is reviewable where a sealed blob is not. **ONE CHOKEPOINT, AND THE ONE PLACE IT CANNOT BE `egressBoundary`:** `assembleTurn` is the only builder of a conversation payload; the CLOUD body is built by `egressBoundary.assemble` and nothing else, but the LOCAL body cannot be — **the boundary refuses `private` UNCONDITIONALLY AND BY DESIGN, the revealed prompt IS private, and forcing it through would mean calling it `public`, a lie told to the one component whose job is classification.** So the local body is derived in the same function from the same classified elements and **the module PROVES its own honesty rather than asserting it in prose**: every local result carries `wouldRefuseOnCloud`, computed by really running those elements through the boundary and recording the refusal WITH THE BOUNDARY'S OWN REASON STRING, compared literally; plus two anti-drift rows, identical key sets between the two bodies and no cloud key beyond `messages,model,stream`. **MASTER'S TYPED WORDS DEFAULT TO `public` AND IT IS A DECISION:** he chose to converse through a cloud model, so refusing his text by default would refuse the feature; the IDENTIFIER is what is withheld, and the cloud variant never contains one. The defence is MEASURED OVER THE SERIALISED BYTES — the revealed template handed to the assembler on the same call, the assembled cloud body carrying none of its identifiers, AND master's own words still crossing, so the feature was not disabled to pass the test. **ON ANY UNCERTAINTY, LOCAL OR REFUSE, NEVER CLOUD:** unknown destination refuses, a sensitive turn aimed at cloud refuses AT the chokepoint even though selection already routed it local, and a row whose `private` flag is neither true nor false resolves LOCAL — a loud model-not-found beats a prompt that cannot be recalled. **THAT RULE WAS NOT APPLIED IN TWO PLACES AND REVIEW CAUGHT BOTH; THEY ARE FIXED AND MUST NOT COME BACK, BECAUSE THEY ARE THE SAME SHAPE — STRICT EQUALITY POINTED AT THE UNSAFE SIDE.** (1) `levelOf` returned `'public'` for ANY `classification` outside the lattice, so a retained turn marked `'secret'`, `'confidential'` or `'PRIVATE'` had the concern STRIPPED and crossed to a cloud payload, and `egressBoundary` — which carries `REASON.unclassified` for precisely that element shape — was handed an already-clean `'public'` and never saw the original. **ABSENT AND UNRECOGNISED ARE DIFFERENT FACTS:** absent (or `undefined`) stays `'public'`, the deliberate decision that keeps the feature usable; anything else outside the lattice, INCLUDING `null` AND `''` WHICH THE BOUNDARY ALSO REFUSES, now REFUSES — on the LOCAL destination too, because a classification the module cannot read is a caller it cannot read and the local body would otherwise rank a level absent from `RANK` — carrying the boundary's own `unclassified` string rather than a second wording. (2) All three sensitivity decisions tested `sensitive === true`, so `'true'`, `1` or `'yes'` arriving over `models:converse` produced a NON-sensitive turn on every one of them: cloud destination allowed, text classified `public`, `requirePrivate` false. It was the ONE input to `assembleTurn` that was not validated while `destination`, `model`, `text` and every retained turn were each refused when malformed. `assembleTurn` now REFUSES a non-boolean `sensitive`; `selectModel` cannot refuse because it has to return a model, so there an unrecognised value resolves to SENSITIVE — which costs a cloud turn and never costs a disclosure. **AND THE SUITE ROW COVERING THE FIRST DEFECT ASSERTED THE OPPOSITE OF ITS OWN LABEL:** it read "is refused" over an assertion of `.ok === true`, it was GREEN so nothing flagged it, and a later session reading labels to learn what is guaranteed would have concluded the opposite of the truth — a green row that documents a leak as if it were the fix is worse than no row. Label and assertion now describe the same behaviour, over seven bogus classification values and five non-boolean flags, plus a row pinning `convo.REASON.unclassified` to the boundary's own string and a row proving an ABSENT classification still crosses, so the fix cannot be mistaken for "refuse everything". **`ROLES.conversation` IS THE TENTH ROLE AND `sensitive` IS FALSE ON IT ON PURPOSE, said in the note so a later session does not "fix" it:** one conversation carries both "what is the rupee doing" and "should I sell my position", a table flag can only be right for one, and set true it refuses cloud on EVERY turn; the gate is PER-TURN ON THE PAYLOAD and a sensitive turn routes local via `requirePrivate` — the same gate from the call site instead of the table. **NO `minCtxK`, the field most likely to be helpfully added later:** keyed cloud rows report `ctxK: null` by construction and `evaluate()` EXCLUDES an unknown window, so a floor would refuse every cloud model and invert the behaviour — asserted both ways, the same row `fit:'none'` for `long-context` and `declared` for `conversation`. No `needCaps` because Ollama reports no "chat" cap. `minParamsB: 7` is `tool-calling`'s published threshold and is low enough that the local `lfm2.5:8b-a1b-q4_K_M` clears it, so conversation works with NO credential. **THE BRIEF'S CLOUD-FIRST MECHANISM WAS WRONG IN A WAY THAT SILENTLY DOES NOTHING: INVERTING PRIVATE-BEFORE-COST CHANGES NOTHING**, because a local pull's `costTier: 0` beats a cloud row's `1` so cost AGREES with privacy — **the privacy comparator ITSELF had to be inverted**, for `preferRemote` roles only, which `conversation` alone sets; cost still breaks ties among cloud rows and `narration` refuses cloud at the fitness gate far above it. Asserted with REAL selections, both directions, order-independent, plus the rows that make it safe: `narration`, `extraction` and `tool-calling` all still prefer local and `conversation` is the only role with the flag. **AND CLOUD ROWS HAD TO REACH THE ROLE ENGINE AT ALL** — Section 131's open NEXT: `conversationCandidates()` widens the list FOR THIS ROLE ONLY and is INERT with no key stored AND with the vault merely locked, both asserted. **MEASURED CORRECTION: the registry holds FOURTEEN keyed cloud rows, not one, so cheapest-sufficient picks `ministral-3:8b` and not `gemma4:31b`** — the table's own rule, and cheaper per turn; preferring the largest within budget would be a new role flag and a behaviour change, so it is RAISED rather than taken. **A REFUSAL STAYS A REFUSAL:** `models:chat` walks `FALLBACK_CHAIN` so a refusal there becomes a silent downgrade and master cannot tell "I asked the big model" from "I quietly got the small one"; `models:converse` returns `fit:'none'` AS a refusal with role, reason, per-model exclusions and a remedy, measured at ZERO `/api/chat` calls and naming no substitute, and `Chat.jsx` renders `[Refused]` without falling through. **A CAPABILITY DENIAL IS DELIBERATELY NOT SHAPED LIKE A REFUSAL** — `models.use` is tier 3 against `chat.send`'s 5, so tiers 4–5 get a denial with no `refused` flag and fall through to `models:chat`, keeping the chat they had (I11). `claimGate` is NOT run here, because it refuses the `unattributed` class and conversation is unattributed prose, so enforcing it would withhold every reply. **IMMEDIACY: `chatStream` IS A SECOND FUNCTION, NOT A FLAG** — `verifyOllamaCloud.cjs` PINS the envelope's `stream` to false, so a flag would make a pinned shape argument-dependent; `chat()` is byte-identical and still buffered, asserted beside the streaming rows, and `chatStream` keeps the identical gate order with a mandatory `releaseSlot` in a `finally` because a leaked slot on `maxConcurrent: 1` is a permanent outage. Both destinations use the ONE client's `postStreamingJsonLines`, the local body arriving already built so nothing is composed at the transport, and preload mirrors `ollamaPull` INCLUDING the `finally` that removes the token listener — without it master hears the same tokens N times. Asserted: one event per delta in order, `stream: true` in the body, NO `Authorization` on the loopback call, the daemon-free API name with no `-cloud` suffix on the wire, and **THE CREDENTIAL LEAK SWEEP REPEATED ON THE STREAMING PATH** with the dummy only in the header, nowhere in any return or console line, and NO SUBSTRING OF LENGTH ≥ 6 elsewhere. **VOICE DEFAULTS OFF, for accuracy rather than caution:** it is the one preference whose "on" state makes noise in a room the app cannot see. `uiStore.ramaSpeaks` is independent of the older `speechMuted`, which still wins, and `voiceEngine.js` gains a REGISTRY over the ONE engine `CommandPalette` constructs rather than a second TTS call site — the engine's `speak()` is what honours the mute AND sets the hands-free cool-down that stops Rāma transcribing its own voice back as a command, both of which a direct `speechSynthesis` call would skip; `Chat.jsx` references `speechSynthesis` nowhere, asserted. The brief's `voiceEngine.speak()` was a CLASS METHOD whose only instance lives in `CommandPalette`, so the Chat page had nothing to call until the registry existed. **SPEECH-TO-TEXT STAYS OUT:** Ollama serves no STT model, printed by the suite as a residual rather than left as an absence. Also not built: the context DB and cross-turn memory (Sections 127/130, recording stays dark), and proactive speech. **NOT VERIFIED: NO LIVE AUTHENTICATED CALL TO ollama.com WAS MADE — not one;** every request is an injected stub and the only credential seen is the literal dummy, so the streaming line shape, the Bearer requirement, the thirteen inferred `apiModel` spellings, free-tier access and zero-credit behaviour are inherited assumptions. **NOTHING WAS SEEN ON A SCREEN:** `node_modules` is absent from the worktree so `vite build` CANNOT run there and no claim is made that it passes, the app was never launched, and the streaming bubble, the model/fit/why line, the VOICE toggle and the spoken reply were NOT OBSERVED. Whether the prose reads like JARVIS is a judgement no assertion makes — the persona was never sent to a model. Files: `electron/lib/conversationRole.cjs`, `scripts/verifyConversation.cjs` (new, 151 assertions), `electron/lib/modelRoles.cjs`, `electron/lib/ollamaCloud.cjs`, `electron/ipc/modelRouter.cjs`, `electron/preload.cjs`, `src/services/voiceEngine.js`, `src/store/uiStore.js`, `src/components/CommandPalette.jsx`, `src/pages/Chat/Chat.jsx`, `package.json`, `docs/research/CONVERSATION.md`. Suites 27 → 28, assertions 2,825 → 2,976, 0 failures. **NEXT:** observe one real turn end to end from the main workspace after a build — the bubble, the toggle and the model line are the three things no assertion covers; reconcile the inferred `apiModel` values against a live keyed `GET /api/tags`; decide `identity.cloudSafePersona`; decide cheapest-sufficient versus largest-within-budget for conversation; decide `chat.send`'s tier; feed `ollama-cloud/*` into the role engine for the OTHER roles, still open. |
```

---

## 13. Review iteration 1 — the findings, and what changed

The first build was reviewed at `c07e9b5`; the verdict was CHANGES_REQUESTED with three blocking
findings and two for the record. Nothing in the role, the persona, the chokepoint, the cloud-first
ranking, the refusal path, streaming or the voice default changed. All three blocking fixes point
strictness at the safe side of a trust boundary; none of them alters what master sees on a turn that
is well-formed, because **no call site passes `classification` or `sensitive` today** — `Chat.jsx`
sends neither.

| # | finding | status | what changed |
|---|---|---|---|
| 1 | Unknown classification laundered to `public` (blocking) | **fixed** | `levelOf` is replaced by `classificationOf`, which separates ABSENT (→ `public`, kept) from PRESENT-BUT-UNRECOGNISED (→ refuse with `egressBoundary.REASON.unclassified`). Refused on both destinations. `electron/lib/conversationRole.cjs` |
| 2 | Suite row asserted the opposite of its own label (blocking) | **fixed** | The row is rewritten to assert the refusal and its reason, over seven bogus values (`'secret'`, `'confidential'`, `'PRIVATE'`, `'Private'`, `''`, `null`, `0`), plus a row pinning our reason string to the boundary's, a row for the local destination, a row for `where`/`index`, and a row proving an ABSENT classification still crosses. `scripts/verifyConversation.cjs` |
| 3 | Non-boolean `sensitive` failed open to cloud (blocking) | **fixed** | `assembleTurn` refuses a `sensitive` that is not a boolean (`REASON.sensitiveFlag`). `selectModel` has to return a model, so there `sensitiveOrUnknown` treats anything that is not a literal `false` as sensitive. Five truthy/odd values asserted on both functions. |
| 4 | Cheapest-sufficient picks `ministral-3:8b`, not `gemma4:31b` (needs master) | **raised, not taken** | No code change, as the review directed. §11.3 holds the decision: keep cheapest-sufficient, or add a `preferLargest` role flag. The requirement's intent — cloud-first for a non-sensitive turn, local for a sensitive one — is asserted in both directions with real selections either way. |
| 5 | `displayIdentity()` leak row is vacuous in practice (non-blocking) | **recorded as permanent** | §10 now states plainly that this residual is not a gap waiting to be closed, why making it an assertion would be worse (a test process that can open the loyalty core), and what carries the clause instead — construction: a frozen literal list with no interpolation. |

Findings 1 and 3 are the same defect twice: `x === expected` used where the `else` branch is the
permissive one. The module's header now names both so the next session reading it meets the defect
before it meets the code.
