# The conversation role — cloud-first talk with master, and the identifier that stays home

Review of `feat/conversation-role` (`c07e9b5`, `b5a4255`, `258580c`) against `dev`, in the worktree at
`.worktrees/conversation`. **Iteration 3** of the gate.

This pass judges the iteration-2 fixes. The branch itself is unchanged in shape: a tenth model role
`conversation`, the new unprotected `electron/lib/conversationRole.cjs` holding a frozen cloud-safe
persona and the single payload constructor `assembleTurn`, a `models:converse` handler that honours
`fit:'none'` instead of walking `FALLBACK_CHAIN`, a second cloud transport `chatStream` beside the
untouched buffered `chat()`, and a Chat page that streams, names the model that answered, and can speak
the reply behind a toggle defaulting off. The one blocking finding from iteration 2 — the 200-message
ceiling reachable in ordinary use, turning a long session permanently unanswerable — is fixed where the
review directed it, at the caller rather than inside the chokepoint, and the four non-blocking fixes
(identifier in new source, silent voice, turn ids on deltas) landed with real assertions behind them.
Nothing in the role table, the persona, the chokepoint, the cloud-first ranking, the refusal path,
streaming or the voice default moved.

**Watch for:** voice is wired on the conversation path only — the `models:chat` fallback never calls
`speak()` and never sets `voiceSilent`, so `VOICE ON` is silent with no explanation on exactly the
degraded paths (capability denial for tiers 4–5, transport failure, older preload) where master is
already getting a worse answer (confirmed). Also: the per-turn sensitivity gate still has no producer,
so every turn today is `public` and crosses to a cloud model, holdings questions included — recorded as
master's decision in §11.5, not a defect left open (confirmed).

**Verdict**: APPROVED

## High-level view

The blocking fix is the right shape. `assembleTurn` still refuses above
`egressBoundary.MAX_MESSAGES` and still does not trim — the one honest payload constructor does not
quietly drop history — and the bound moved to `Chat.jsx` where the decision lives: `RETAINED_TURNS = 24`
with `.slice(-RETAINED_TURNS)`. The arithmetic keeping window and ceiling apart is itself asserted
(`cap + 2 < MAX_MESSAGES` and `cap * 4 < MAX_MESSAGES`), so a later session raising the cap toward 199
trips the suite rather than silently restoring the defect. The refusal that used to be a dead end now
carries `assemblyRemedy(reason)` on *every* assembly refusal, and the ceiling case names the action
("start a new session"). Fourteen new assertions drive it through the handler, not only the unit,
including zero `/api/chat` calls on a refused turn and the bounded turn still answered end to end.

The identifier is gone from new source, comments included, and the header still explains the leak by
naming `NUCLEUS_TEMPLATE.identity` instead of reproducing its text — asserted in both directions, which
matters because a file that explains nothing would also pass the leak check.

Voice silence is now surfaced on the conversation path: `speak()`'s `false` return is kept as
`voiceSilent` on the reply and the bubble prints one amber line naming both causes. The toggle is
deliberately not greyed out on `getVoiceEngine()`, which is a defensible call — an engine can mount at
any moment. What the fix does not reach is the fallback path, where no `speak()` call exists at all.

Every token delta now carries a turn id, echoed exactly for a string or number and normalised to `null`
otherwise, with the renderer dropping a delta that is not its own. A caller that passes nothing gets the
old behaviour.

Two items stay open by design and both belong to master rather than to this loop: the sensitivity gate
with no producer (§11.5 states the three options and recommends a per-turn control as its own tranche)
and cheapest-sufficient picking `ministral-3:8b` over the brief's `gemma4:31b` across the full
fourteen-row registry (§11.3, needs a new role flag to change). Both were raised in earlier passes and
neither was quietly closed. Worth noting against requirement 4: the brief's `gemma4:31b` *is* asserted
as the real selection on a local-plus-cloud candidate pair, in both orders — the deviation appears only
once all fourteen keyed rows are present.

Verification evidence is present and specific: `node --check` on the three `.cjs` files touched this
iteration, the conversation suite at 179 passed / 0 failed / 3 held by hand, and the whole chain run
command by command at 28 reporting suites / 3,004 assertions / 0 failures, with per-suite totals in
`verify-chain-iter3.txt`. Nothing was observed on a screen and no live call to ollama.com was made;
§10 says so prominently and `node_modules` is absent from the worktree, so no build claim is made.

<details>
<summary>Issues (5)</summary>

1. **Voice is wired on one path only** (non-blocking, confirmed) — `Chat.jsx:286` is the only
   `speak()` call site; the `models:chat` fallback at `Chat.jsx:330` adds the reply with no speech
   attempt and no `voiceSilent`, so `VOICE ON` produces silence with no reason whenever the
   conversation path is unavailable (tier 4–5 capability denial, transport failure, older preload).
   Same defect class as iteration 2's finding 5, in the path that fix did not reach. Either speak on
   the fallback reply too, or say on the bubble that the fallback path does not speak.
2. **The per-turn sensitivity gate has no producer** (non-blocking, confirmed, recorded) — no call site
   sets `sensitive`, so every turn is `public` and crosses to cloud. §11.5 records it with three
   options and a recommendation; needs master's decision, not a code change.
3. **Cheapest-sufficient picks `ministral-3:8b`, not the brief's `gemma4:31b`** (non-blocking,
   confirmed, raised twice) — the table's declared rule working. Changing it is a new role flag
   (`preferLargest`) and a behaviour change; §11.3 holds it for master.
4. **The anti-trimming guard is a bare `.slice(` ban over the whole module**
   (non-blocking, likely) — `scripts/verifyConversation.cjs` asserts
   `!/\.slice\(/.test(codeOf('electron/lib/conversationRole.cjs'))`. Any future legitimate `.slice(`
   in that file (string truncation, say) fails the suite under the label "the module still contains no
   trimming of the retained list". Narrow it to the retained list if the row is kept.
5. **`retained` is correct because the closure is stale** (non-blocking, confirmed) —
   `Chat.jsx:263` reads `messages` captured at render, which is why `userMsg` (added at line 219) is not
   in it and master's new turn is not sent twice. A refactor to a ref or a fresh store read would
   duplicate the turn silently. Worth a line of comment at the call site.

</details>

<details>
<summary>Details</summary>

### The ceiling fix, and why the bound landed in the right place

`conversationRole.cjs:264` is unchanged in behaviour — `retained.length + 2 > egressBoundary.MAX_MESSAGES`
still refuses with `tooManyTurns` and still does not trim. The comment above it now carries the whole
argument, including the defect history, so a later session reading the module meets the reasoning before
the code. The bound is at `Chat.jsx:260-265`:

```js
const retained = messages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-RETAINED_TURNS)
  .map(m => ({ role: m.role, text: m.content }));
```

What makes this hold rather than merely work today is the arithmetic in the suite: `cap + 2 <
MAX_MESSAGES` and `cap * 4 < MAX_MESSAGES` are both asserted, so the two numbers cannot drift into each
other without a red row. The ceiling is driven through the handler as well as the unit — the refusal
surfaces as a refusal with its reason, one turn below it still assembles (so the ceiling is a ceiling
and not an off-by-one), nothing goes out on the wire, and the bounded turn is answered end to end.

`assemblyRemedy` at `modelRouter.cjs:695-712` closes the other half. Every assembly refusal carries a
remedy now, including the malformed-caller cases where the only honest one is "the payload was refused
before it was sent — nothing left this machine". An absent remedy is what sent the last review looking
for a fallback that does not exist.

### Voice: fixed on one path, silent on the other

The registry at `voiceEngine.js:761-784` routes through the engine's own `speak()` rather than
`window.speechSynthesis`, which is what keeps the `speechMuted` check and the hands-free cool-down that
stops Rāma transcribing its own voice back as a command.

The gap is the other path. `handleSend` falls through to `ramaChat.send` whenever `converse` is absent,
the capability check denies (`models.use` is tier 3 against `chat.send`'s 5), or the transport throws,
and that branch at `Chat.jsx:330` adds the reply with no `speak()` and no `voiceSilent`. So a tier-4
account, or master during a daemon hiccup, sees `VOICE ON` and hears nothing, with no amber line to
explain it — the precise experience iteration 2 called a defect, on a path the fix did not reach. It is
non-blocking because voice defaults off and the fallback is already the degraded answer, but it is an
asymmetry rather than a decision, and nothing in CONVERSATION.md names it.

### Turn ids, and the id that is correct by accident

The id is `turn-${userMsg.id}` where `userMsg.id` is `Date.now()`, so two turns in the same millisecond
would collide — unreachable through the UI (`isThinking` blocks a second send), and the correlation sits
on top of a channel already scoped to the window.

`retained` is built from the `messages` value captured when `handleSend`
was created, not from the store after `addMessage(userMsg)`. That staleness is what keeps master's new
turn out of the retained list, since it is sent separately as `text`. The dependency array at
`Chat.jsx:353` does include `messages`, so the window is fresh per render — the correctness depends on
the capture happening before the append within one invocation, which is true but unstated.

### What the suite covers, and what it does not

179 assertions, 3 declared residuals, appended immediately after `verifyModelRoles.cjs` with the
relative order of every pre-existing suite unchanged — confirmed against `package.json`. Chain totals:
28 reporting suites, 3,004 assertions, 0 failures, +28 over iteration 2 and no other suite's count
moved. The two-sided persona assertion the brief demanded is real in both halves: negative rows over the
identifiers, case variants, `@` and any 24+ character opaque token, and positive rows at
`verifyConversation.cjs:262-263` that the prompt still addresses master as "master" and still states the
loyalty, plus the Rāma-naming row above them. Cloud-first is asserted with real selections over real
rows in both orders, and `narration`, `extraction` and `tool-calling` are each pinned to local.
`fit:'none'` is asserted as a refusal with the role named, at zero chat requests, with a structural row
that `models:converse` does not reach `FALLBACK_CHAIN`.

The new `.slice(` guard is the one row that will age badly: it bans the substring across the whole
module under a label about the retained list, so an unrelated future `.slice(` fails red with a
misleading reason.

Not tested: anything on a screen, and no live authenticated call to ollama.com. `node_modules` is absent
from the worktree so neither `vite build` nor `npm run build` can run here and no claim is made that
they pass — §10 states this plainly, along with the streaming bubble, the amber voice-silent line, the
VOICE toggle and the model/fit/why line all being unobserved. The `loyaltyCore.displayIdentity()` row
remains a declared permanent residual, with the argument that a test process able to open the loyalty
core is a worse thing to own, and the clause carried by construction instead.

### Hard rules

Clean. No protected file in the diff (`loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`,
`proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json`), no out-of-bounds
file (`electron/ipc/timeline.cjs`, `shared/autonomy-policy.json`, anything `autonomy*`,
`src/pages/StockMind/`), `RAMA_AGI_MASTER_SPEC.md` not modified with Section 133 and ledger row 153
staged as paste blocks in §12. No `console.log` in shipped code — the only added occurrences are in
`scripts/verifyConversation.cjs`, matching every other suite in the chain. No `TODO`/`FIXME`/placeholder
in added lines including `.jsx`. No credential value anywhere; the only literal is the dummy already on
the invariants allow-list. `package.json` gains two script entries and no dependency, pinned or
otherwise. Additive: with no cloud key and no fit install the handler refuses with a reason and
`models:chat` is byte-identical, and a capability denial is deliberately shaped without `refused` so
tiers 4–5 fall through and keep the chat they had (I11). `verifyLoyaltyTripwire.cjs` green at the end of
the chain is the independent confirmation on the protected set.

</details>

<details>
<summary>File map</summary>

- `electron/lib/conversationRole.cjs` — cloud-safe persona, `assembleTurn` chokepoint, `selectModel`,
  `destinationFor`; header no longer reproduces the nucleus text
- `electron/lib/modelRoles.cjs` — `ROLES.conversation`, privacy comparator inverted for `preferRemote`
- `electron/lib/ollamaCloud.cjs` — new `chatStream`, same gate order as the unchanged `chat()`
- `electron/ipc/modelRouter.cjs` — `models:converse`, `conversationCandidates()`, `ollamaStream()`,
  `assemblyRemedy()`, turn-id tagging
- `electron/preload.cjs` — `models.converse(opts, onToken)` with listener cleanup
- `src/pages/Chat/Chat.jsx` — `RETAINED_TURNS = 24` window, streaming bubble, model/fit/why line,
  amber voice-silent line, VOICE toggle
- `src/services/voiceEngine.js` — mounted-engine registry and module-level `speak()`
- `src/components/CommandPalette.jsx` — registers its engine
- `src/store/uiStore.js` — `ramaSpeaks`, default off
- `scripts/verifyConversation.cjs` — 179 assertions; `package.json` — chain + script entry
- `docs/research/CONVERSATION.md`, `verify-chain-iter3.txt`, `verify-conversation-iter3.txt` — design,
  evidence

Full diff: `git -C .worktrees/conversation diff dev...feat/conversation-role`

</details>
