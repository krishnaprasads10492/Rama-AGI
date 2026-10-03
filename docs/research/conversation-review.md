# The conversation role — cloud-first talk with master, and the identifier that stays home

Review of `feat/conversation-role` (`c07e9b5`, `b5a4255`) against `dev`, in the worktree at
`.worktrees/conversation`. Iteration 2 of the gate.

The branch adds a tenth model role, `conversation`, and the one path that uses it: a new unprotected
module `electron/lib/conversationRole.cjs` holding a frozen cloud-safe persona and the single payload
constructor `assembleTurn`, a new `models:converse` IPC handler that selects by role and honours
`fit:'none'` instead of walking `FALLBACK_CHAIN`, a second cloud transport function `chatStream`
beside the untouched buffered `chat()`, and a Chat page that streams tokens, shows which model
answered and why, and can speak the reply behind a toggle that defaults off. All six brief
requirements are met, and the two blocking defects iteration 1 found — an unrecognised
`classification` laundered to `public`, and a non-boolean `sensitive` failing open to cloud — are
genuinely fixed at the places they occurred, with the mislabelled green test row corrected rather
than deleted.

**Watch for:** a reachable state where the conversation path refuses every turn permanently and
bypasses its own fallback — once a session holds 199 user/assistant messages, `retained` exceeds
`egressBoundary.MAX_MESSAGES` and `assembleTurn` returns `tooManyTurns`, which `Chat.jsx` renders as
`[Refused]` and does **not** fall through to `models:chat` (confirmed). Also: the per-turn sensitivity
gate that justifies `sensitive: false` on the role has no producer anywhere in the renderer, so every
turn today is non-sensitive and crosses to cloud as `public` (confirmed).

**Verdict**: NEEDS_CHANGES

## High-level view

`minParamsB: 7` is borrowed from
`tool-calling`; the deliberate absence of `minCtxK` is asserted in both directions, because keyed
cloud rows report `ctxK: null` and `evaluate()` excludes an unknown window — a floor would have
refused every cloud model and silently inverted the feature. `sensitive` is `false` with a note that
says it must stay false and why, and the note is itself asserted by regex so a later session cannot
quietly flip it.

The cloud-safe persona is composed from a frozen eight-sentence array with no interpolation anywhere,
not derived by redacting the revealed prompt, and it lives beside the protected `nucleusSealer.cjs`
rather than in it. The two-sided assertion the brief demanded is there: negative rows over the
identifiers, case variants, `@` and any 24+ character opaque token, and positive rows that the prompt
still names Rāma, still addresses "master", still states the loyalty and still discloses the AI. The
`loyaltyCore.displayIdentity()` row degrades to a declared residual because the core is sealed in the
suite's process — declared as permanent, with the argument that a test process able to open the core
would be a worse thing to own.

One chokepoint holds. The cloud body is built by `egressBoundary.assemble` and nothing else; the local
body cannot be, because the boundary refuses `private` unconditionally and the revealed prompt is
truthfully private, so it is derived in the same function and every local result carries
`wouldRefuseOnCloud` measured by really running the boundary. Uncertainty resolves local or refuse in
every branch I traced: unknown destination refuses, unknown `private` flag routes local, unknown
classification refuses on both destinations, non-boolean `sensitive` refuses at the chokepoint and
resolves to sensitive in selection where a refusal is not available.

Cloud-first was implemented by inverting the privacy comparator for `preferRemote` roles rather than
by the mechanism the brief described, and the commit explains why the brief's version would have been
a no-op: a local pull's `costTier: 0` already beats a cloud row's `1`, so cost agreed with privacy
instead of opposing it. Both directions are asserted with real selections over real rows, order
independent, and `narration`, `extraction` and `tool-calling` are each pinned to local. The chosen row
is `ministral-3:8b` rather than the brief's `gemma4:31b` because fourteen keyed cloud rows clear the 7B
floor and the table's rule is cheapest-sufficient; that deviation was raised for master, not taken.

Refusals surface with role, reason, per-model exclusions and a remedy, at a measured zero `/api/chat`
calls, and a capability denial is deliberately shaped differently from a refusal so tiers 4–5 fall
through and keep the chat they had. Streaming uses the one HTTP client's `postStreamingJsonLines` on
both destinations, and voice defaults off through a store preference independent of the older
`speechMuted`. STT is absent and stated as out of scope.

The gap is at the edges of the happy path rather than in the middle of it. Nothing bounds the retained
history, so the chokepoint's own message ceiling eventually turns into a permanent refusal for that
session. And the sensitivity mechanism — the entire argument for keeping `sensitive` off the role — is
reachable only by a caller that does not exist yet.

<details>
<summary>Issues (6)</summary>

1. **Unbounded retained history turns into a permanent refusal** (blocking, confirmed) —
   `Chat.jsx:237` sends every user/assistant message in the session; at 199 of them
   `conversationRole.cjs:254` refuses with `tooManyTurns`, and `Chat.jsx:263` returns on `refused`
   without falling through to `models:chat`, so the session can never be answered again. Cap
   `retained` at the call site (last N exchanges) so the ceiling is never reached, and give the
   `tooManyTurns` refusal a remedy if it can still occur.
2. **The per-turn sensitivity gate has no producer** (non-blocking, confirmed) — no call site passes
   `sensitive`, so "should I sell my position" is classified `public` and crosses to cloud. Either add
   a producer (a classifier or a per-turn UI control) or record the absence explicitly in
   CONVERSATION.md §11 / NEXT, since §2's note leans on this mechanism as the reason the role flag
   stays false.
3. **Cheapest-sufficient picks `ministral-3:8b`, not the brief's `gemma4:31b`** (non-blocking,
   confirmed, already raised) — the table's own rule working, documented in §11.3 as needing a new
   role flag. Needs master's decision, not a code change.
4. **The revealed template is quoted verbatim in the new module's header** (non-blocking, likely) —
   `conversationRole.cjs` lines 11-12 contain the identifier in prose. Harmless to the payload, but
   this project reads its own source for self-upgrade; refer to the nucleus template by name instead
   of reproducing its text.
5. **`speak()` fails silently when no engine is mounted** (non-blocking, confirmed) —
   `Chat.jsx:255` ignores the return of `voiceEngine.speak()`, which is `false` whenever
   `CommandPalette` is not mounted, so VOICE ON can be on and produce nothing with no indication.
   Surface the false return, or gate the toggle on `getVoiceEngine()`.
6. **Token events carry no turn id** (non-blocking, possible) — `models:converse-token` is scoped to
   the sender but not to a turn, so two in-flight turns in one window would interleave into a single
   `streamText`. Unreachable through the UI today because `isThinking` guards `handleSend`; worth a
   turn id if the path is ever called from elsewhere.

</details>

<details>
<summary>Details</summary>

### Unbounded retained history, and the one refusal that has no way out

`Chat.jsx:237-240` builds the retained list from the whole session with no cap:

```js
const retained = messages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .map(m => ({ role: m.role, text: m.content }));
```

`src/store/ramaStore.js:61` appends to `session.messages` forever — there is no trimming anywhere in
the store. `conversationRole.cjs:254` then enforces the boundary's ceiling:

```js
if (retained.length + 2 > egressBoundary.MAX_MESSAGES) {
  return refuse(REASON.tooManyTurns, { destination, variant: null });
}
```

`MAX_MESSAGES` is 200, so at 199 retained messages every turn in that session refuses. The refusal is
honest and fails closed, which is the right direction, but `Chat.jsx:263` treats `refused` as terminal
by design — "a refusal is a fact, not a prompt to try something else" — so it does not fall through to
`models:chat`, and `models:chat` would have answered that same session on `dev` because it slices
nothing either. That makes this the one state where the branch removes a capability instead of adding
one, against the project's additive rule, and the refusal text carries no remedy because `remedy` is
only attached to the selection refusal at `modelRouter.cjs:529`. Master sees
`[Refused] a conversation payload is limited to 200 messages` with no action and no fallback.

The reachability is what makes it worth sending back: sessions persist in the data store, 99 exchanges
is an ordinary month of use, and the failure is permanent for the affected session rather than
transient. The fix is at the call site rather than in the chokepoint — trimming inside `assembleTurn`
would make the one honest constructor silently drop history, which is the opposite of what the module
is for.

### The sensitivity gate and the caller that does not exist

`ROLES.conversation`'s note argues, correctly, that a table-level `sensitive` flag can only be right
for one of the two kinds of turn a single conversation carries, and that the real gate is per-turn on
the payload, "reached from the call site instead of the table". The mechanism is complete and
well-tested from `assembleTurn` and `selectModel` inward: a sensitive turn selects the local row, is
refused if aimed at cloud, and a non-boolean flag refuses at the chokepoint and resolves to sensitive
in selection.

What is missing is the call site. `modelRouter.cjs:514` defaults `sensitive = false`, `Chat.jsx:241`
passes no `sensitive` and no `classification` on any retained turn, and nothing else invokes
`models:converse`. So in the shipped product every turn — including master's holdings — is `public`
and crosses to a cloud model. That is consistent with the documented decision that master's typed text
defaults to public, and it is not a brief violation, but the brief's requirement 1 accepted
`sensitive: false` on the role *because* gating happens per turn, and per turn nothing gates. §13 of
CONVERSATION.md notes in passing that no call site passes either field; §11 (RAISED FOR MASTER) and
the NEXT list do not, and that is where a decision this shaped belongs.

### The persona, and the one place the name still appears in new source

The persona itself is clean: `CLOUD_SAFE_LINES` is frozen, eight whole sentences, no interpolation, and
the suite asserts structurally that the module contains no `.replace(`, nothing matching
`redact|scrub|sanitis`, and no reference to `nucleusSealer` or `loyaltyCore`. Lines 2 and 3 of the
persona are a good pairing — fixing the form of address and then telling the model not to go looking
for what it replaced, so it never asks master to type his own name.

The identifier does appear in new source, though never in a payload: twice in the module header
quoting the revealed template verbatim, and in the suite's `REVEALED` fixture and `IDENTIFIERS` list,
where it is the point. The name is already in thirteen places on `dev` (`loyaltyGuard.cjs`,
`nucleusSealer.cjs`, `consciousness.js`, `Settings.jsx` among them), so this is existing practice
rather than a new exposure. It is still worth not adding to, because this codebase feeds its own
source into upgrade proposals; the header can name `NUCLEUS_TEMPLATE.identity` and describe the shape
without reproducing the sentence.

### Double assembly on the cloud path

The cloud turn passes through `egressBoundary.assemble` twice: once in `assembleTurn`, which
classifies each element from the `{ text, classification }` shape, and again inside `chatStream`, which
receives `assembled.body.messages` — by then bare strings, which `egressBoundary.classifyElement`
treats as `public` by its own documented rule. The second pass is therefore a formality for this path
rather than a check; it cannot leak anything, because the first pass already refused every `private`
and `internal` element, and keeping `chatStream` gated matters for its other callers. Worth knowing
rather than worth changing: a future caller handing `chatStream` raw messages gets the permissive
reading, and the cross-check in `modelRouter.cjs` comparing row provider against destination is what
actually catches a mis-wire.

### What the suite covers, and what it does not

151 assertions, 3 declared residuals, appended after `verifyModelRoles.cjs` with no pre-existing suite
reordered — verified against the chain in `package.json` and the per-suite totals in
`verify-chain-iter2.txt` (28 reporting suites, 2,976 assertions, 0 failures). The rows I checked for
substance rather than presence: the leak defence is measured over `JSON.stringify(body)` with the
revealed prompt handed to the assembler on the same call, *and* with master's own words still crossing,
so the test cannot pass by disabling the feature; the credential sweep is repeated on the streaming
path including every substring of length ≥ 6; the cloud candidate widening is asserted inert with no
key and live with one; `chat()` is asserted still buffered and still not using the streaming helper.
The iteration-1 row that read "is refused" over an assertion of `.ok === true` is now label-matched and
expanded to seven bogus classifications and five non-boolean flags, with a companion row proving an
*absent* classification still crosses, so the fix cannot be mistaken for "refuse everything".

Not tested: anything on a screen. No live call to ollama.com, so the streaming line shape, the Bearer
requirement, the thirteen inferred `apiModel` spellings and free-tier behaviour remain inherited
assumptions; `node_modules` is absent from the worktree so neither `vite build` nor `npm run build` can
run and no claim is made that they pass. Also untested: the 200-message ceiling in §1 above — no row
exercises `tooManyTurns` through the handler, which is why it reads as theoretical in the module and
is reachable in the product. The CONVERSATION.md NOT VERIFIED (§10) and RAISED FOR MASTER (§11)
sections are present and prominent, and `RAMA_AGI_MASTER_SPEC.md` is untouched with Section 133 and
ledger row 153 staged as paste blocks in §12.

### Hard rules

Checked and clean: no protected file in the diff (`loyaltyGuard.cjs`, `loyaltyCore.cjs`,
`nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`,
`shared/capabilities.json`), no out-of-bounds file (`electron/ipc/timeline.cjs`,
`shared/autonomy-policy.json`, anything `autonomy*`, `src/pages/StockMind/`),
`RAMA_AGI_MASTER_SPEC.md` not modified, zero `console.log` in added lines, zero `TODO`/`FIXME`/
placeholder in added lines including `.jsx`, no credential value anywhere (the only literal is the
dummy already on the invariants allow-list), no dependency added or unpinned — `package.json` gains
two script entries and nothing else. `verifyLoyaltyTripwire.cjs` green at the end of the chain is the
independent confirmation on the protected set.

</details>

<details>
<summary>File map</summary>

- `electron/lib/conversationRole.cjs` — new: cloud-safe persona, `assembleTurn` chokepoint,
  `selectModel`, `destinationFor`
- `electron/lib/modelRoles.cjs` — `ROLES.conversation`, privacy comparator inverted for
  `preferRemote`, requirement prose
- `electron/lib/ollamaCloud.cjs` — new `chatStream`, same gate order as `chat()`, which is unchanged
- `electron/ipc/modelRouter.cjs` — `models:converse` handler, `conversationCandidates()`,
  `ollamaStream()`
- `electron/preload.cjs` — `models.converse(opts, onToken)` with listener cleanup
- `src/pages/Chat/Chat.jsx` — conversation path tried first, streaming bubble, model/fit/why line,
  VOICE toggle
- `src/services/voiceEngine.js` — mounted-engine registry and module-level `speak()`
- `src/components/CommandPalette.jsx` — registers its engine
- `src/store/uiStore.js` — `ramaSpeaks`, default off
- `scripts/verifyConversation.cjs` — new, 151 assertions; `package.json` — chain + script entry
- `docs/research/CONVERSATION.md`, `verify-chain-iter2.txt`, `verify-conversation-iter2.txt` — design,
  evidence

Full diff: `git -C .worktrees/conversation diff dev...feat/conversation-role`

</details>
