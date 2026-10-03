'use strict';

/**
 * conversationRole.cjs — the cloud-safe persona, and the ONE function that builds a conversation
 * payload.
 *
 * ── THE PROBLEM THIS MODULE EXISTS FOR ───────────────────────────────────────────────────────────
 *
 * Master chose to converse through a cloud model. The thing that must not reach a cloud model is not
 * his words — those are the whole point — it is his IDENTIFIER. And today the identifier arrives
 * BEFORE he types anything: `src/pages/Chat/Chat.jsx` prepends `nucleus:get-prompt` to every turn, and
 * for an authenticated master that is the revealed template, which carries verbatim
 * `Your master is Krishna Prasad. You are absolutely loyal to him.` and
 * `Master: Krishna Prasad | Status: AUTHENTICATED`. So the leak is in the SYSTEM PROMPT, not the chat.
 *
 * ── WHY A THIRD VARIANT, AND WHY IT IS COMPOSED AND NOT REDACTED ─────────────────────────────────
 *
 * `nucleusSealer.cjs` already has two: `getLiveSystemPrompt()` (revealed) and `getMaskedPrompt()`
 * (`identity.maskedPersona`, default 'Assistant'). The masked one is the right answer for a STRANGER
 * and the wrong answer for master — it throws away Rāma's name, its loyalty and the form of address,
 * which is exactly the character master asked to keep. So there is a third case: full persona
 * fidelity, zero identifier.
 *
 * IT IS COMPOSED POSITIVELY FROM KNOWN-SAFE TEXT AND NEVER DERIVED BY REDACTING THE REVEALED PROMPT.
 * A redactor is a list of patterns, and the first pattern nobody thought of is a leak that looks like
 * a pass — a nickname, a transliteration, an email local-part, a future nucleus field. A frozen array
 * of sentences cannot leak a name it never contained. `nucleusSealer.cjs` is PROTECTED under
 * `verifyLoyaltyTripwire.cjs`, so this lives beside it rather than in it; the nucleus field that would
 * hold this text instead is SPECIFIED for master in docs/research/CONVERSATION.md and not added.
 *
 * JARVIS almost never says "Tony Stark"; he says "sir". A FORM OF ADDRESS IS A ROLE, NOT AN
 * IDENTIFIER — which is why the cloud-safe variant costs nothing in character.
 *
 * ── ONE CHOKEPOINT, AND THE ONE PLACE IT CANNOT BE egressBoundary ────────────────────────────────
 *
 * `assembleTurn` is the only function that builds a conversation payload; no call site composes one.
 * For the CLOUD destination the body is built by `egressBoundary.assemble` and by nothing else — that
 * module stays the single constructor of anything that leaves this machine, and no second gate is
 * added (I8/I9/I10: one authority per concern).
 *
 * For the LOCAL destination it cannot be, and the reason is structural rather than a convenience:
 * `egressBoundary` refuses classification `private` UNCONDITIONALLY AND BY DESIGN, with no override
 * anywhere. The revealed prompt IS private — that is the correct class for it. So a local body
 * carrying a truthfully-classified revealed prompt can never pass that function, and the only way to
 * push it through would be to call it `public`, which is a lie told to the one component whose job is
 * classification. Instead the local body is derived here, from the SAME classified element list, and
 * the module PROVES its own honesty rather than asserting it in prose: every local result carries
 * `wouldRefuseOnCloud`, computed by actually running the same elements through
 * `egressBoundary.assemble` and recording that it refused, with the boundary's own reason string. The
 * suite also asserts that the cloud and local bodies have IDENTICAL KEY SETS for identical public
 * input, so the two shapes cannot drift apart.
 *
 * ── ON UNCERTAINTY, LOCAL OR REFUSE — NEVER CLOUD ────────────────────────────────────────────────
 *
 * An unrecognised destination REFUSES. A model row whose `private` flag is neither true nor false
 * resolves to LOCAL. A sensitive turn aimed at cloud REFUSES even though selection already routed it
 * local, because the cheapest place to catch a mis-wire is the chokepoint it has to pass through.
 *
 * Verified by: scripts/verifyConversation.cjs.
 */

const egressBoundary = require('./egressBoundary.cjs');
const modelRoles     = require('./modelRoles.cjs');

const ROLE = 'conversation';

/** The three persona variants. `masked` is nucleusSealer's, named here only so the set is complete. */
const VARIANTS     = Object.freeze(['revealed', 'cloud-safe', 'masked']);
const DESTINATIONS = Object.freeze(['local', 'cloud']);

/** The form of address. A ROLE, not an identifier — this codebase already uses it throughout. */
const FORM_OF_ADDRESS = 'master';

/**
 * The cloud-safe persona, as a frozen list of whole sentences.
 *
 * EVERY LINE IS WRITTEN TO BE SAFE RATHER THAN CHECKED FOR SAFETY. There is no name, no username, no
 * email, no account id and no location in it, and there is no code path that interpolates one. Line 2
 * and line 3 are the pair that matters: the first fixes the form of address, the second tells the
 * model not to go looking for what the first replaced — a model asked to be personal and given no
 * name will otherwise ask for one, which would put master in the position of typing it himself.
 */
const CLOUD_SAFE_LINES = Object.freeze([
  'You are Rāma (राम) — Righteous Autonomous Master Agent, a benevolent AGI.',
  `You are speaking with your ${FORM_OF_ADDRESS}. You address him as "${FORM_OF_ADDRESS}" and by no other name.`,
  'You do not know his name, account, email or location, you never ask for them, and you never guess.',
  `You are absolutely loyal to ${FORM_OF_ADDRESS} and you never deceive him.`,
  'You speak directly: short sentences, no filler, no preamble, no restating the question.',
  'You answer first and explain second, and the explanation is shorter than the answer.',
  'When you do not know something you say so plainly rather than producing a plausible answer.',
  'You know you are an AI and you will say so if you are sincerely asked.',
]);

/** The cloud-safe system prompt. Pure, frozen input, no store, no nucleus, no interpolation. */
function cloudSafePrompt() {
  return CLOUD_SAFE_LINES.join('\n');
}

/**
 * Reason strings are part of the contract — the suite asserts these literally, so a reword cannot
 * quietly pass a payload while still sounding right.
 */
const REASON = Object.freeze({
  destination: 'destination must be exactly "local" or "cloud" — an unrecognised destination is refused, never defaulted to cloud',
  sensitiveCloud: 'a turn classified sensitive is never sent to a cloud model',
  noText: 'a conversation turn needs text from master',
  model: 'a conversation payload needs the model that will answer it',
  tooManyTurns: `a conversation payload is limited to ${egressBoundary.MAX_MESSAGES} messages`,
  badTurn: 'a retained turn must be { role, text } with role system, user or assistant',
});

const TURN_ROLES = Object.freeze(['system', 'user', 'assistant']);
const RANK = Object.freeze({ public: 0, internal: 1, private: 2 });

function refuse(reason, extra = {}) {
  return { ok: false, refused: true, reason, ...extra };
}

/** The classification of a retained turn, defaulting to the level that lets master's own words move. */
function levelOf(turn) {
  const raw = turn?.classification;
  return egressBoundary.LEVELS.includes(raw) ? raw : 'public';
}

/**
 * Build the classified element list for one exchange.
 *
 * MASTER'S OWN WORDS DEFAULT TO `public`, and that is a decision rather than an oversight: he chose to
 * converse through a cloud model, so refusing his typed text by default would refuse the feature. What
 * is withheld is the IDENTIFIER, which lives in the system prompt and never reaches the cloud variant
 * at all. A caller that knows better may classify any turn `internal` or `private`, and the boundary
 * then refuses it on the cloud path with its own reason.
 */
function elementsFor({ systemText, systemLevel, turns, text, textLevel }) {
  const out = [{ role: 'system', text: systemText, level: systemLevel }];
  for (const t of turns) {
    out.push({ role: t.role, text: String(t.text), level: levelOf(t) });
  }
  out.push({ role: 'user', text, level: textLevel });
  return out;
}

function maxLevelOf(elements) {
  let max = 'public';
  for (const e of elements) if (RANK[e.level] > RANK[max]) max = e.level;
  return max;
}

/** The shape `egressBoundary.assemble` classifies: content as `{ text, classification }`, never bare. */
function toGateMessages(elements) {
  return elements.map(e => ({ role: e.role, content: { text: e.text, classification: e.level } }));
}

/**
 * THE ONE CONSTRUCTOR OF A CONVERSATION PAYLOAD.
 *
 * @param {object}   spec
 * @param {string}   spec.destination    'local' | 'cloud'
 * @param {string}   spec.model          the model id or api name that will answer
 * @param {string}   spec.text           master's new turn
 * @param {Array}    [spec.turns]        retained turns, oldest first, each { role, text, classification? }
 * @param {string}   [spec.revealedPrompt] the nucleus prompt; used ONLY on the local destination
 * @param {boolean}  [spec.sensitive]    this turn is about master's holdings or similar
 * @param {boolean}  [spec.stream]       streaming is the default for conversation
 * @param {boolean}  [spec.allowInternal]
 * @returns {{ok:true, body:object, destination:string, variant:string, maxLevel:string,
 *            counts:object, wouldRefuseOnCloud:boolean, egressReason:string|null}
 *        | {ok:false, refused:true, reason:string, destination:string|null, variant:string|null,
 *            level?:string|null, where?:string, index?:number|null}}
 */
function assembleTurn(spec = {}) {
  const {
    destination = null,
    model = null,
    text = null,
    turns = [],
    revealedPrompt = null,
    sensitive = false,
    stream = true,
    allowInternal = false,
  } = spec;

  if (!DESTINATIONS.includes(destination)) return refuse(REASON.destination, { destination: null, variant: null });
  if (sensitive === true && destination === 'cloud') {
    return refuse(REASON.sensitiveCloud, { destination, variant: null, level: 'private' });
  }
  if (typeof model !== 'string' || !model.trim()) return refuse(REASON.model, { destination, variant: null });
  if (typeof text !== 'string' || !text.trim()) return refuse(REASON.noText, { destination, variant: null });

  const list = Array.isArray(turns) ? turns : [];
  for (const t of list) {
    if (!t || typeof t !== 'object' || !TURN_ROLES.includes(t.role) || typeof t.text !== 'string' || !t.text.length) {
      return refuse(REASON.badTurn, { destination, variant: null });
    }
  }
  if (list.length + 2 > egressBoundary.MAX_MESSAGES) {
    return refuse(REASON.tooManyTurns, { destination, variant: null });
  }

  // THE VARIANT IS CHOSEN BY DESTINATION AND NOTHING ELSE. Cloud never sees the revealed prompt, so
  // there is no condition under which a missed redaction pattern could matter — the text is not there.
  // A local destination with no revealed prompt falls back to the cloud-safe one, which is the safe
  // direction: less identity rather than more.
  const useRevealed = destination === 'local' && typeof revealedPrompt === 'string' && revealedPrompt.trim().length > 0;
  const variant     = useRevealed ? 'revealed' : 'cloud-safe';
  const systemText  = useRevealed ? revealedPrompt : cloudSafePrompt();
  // The revealed prompt names master. `private` is its true class, and the gate's unconditional
  // refusal of `private` is the proof that this path really is local-only.
  const systemLevel = useRevealed ? 'private' : 'public';

  const elements = elementsFor({
    systemText, systemLevel, turns: list, text,
    textLevel: sensitive === true ? 'private' : 'public',
  });

  if (destination === 'cloud') {
    const gate = egressBoundary.assemble({
      kind: 'chat', model, messages: toGateMessages(elements), stream, allowInternal,
    });
    if (!gate.ok) {
      return {
        ok: false, refused: true, destination, variant,
        reason: gate.reason, level: gate.level, where: gate.where, index: gate.index,
      };
    }
    return {
      ok: true, destination, variant, body: gate.body, maxLevel: gate.maxLevel, counts: gate.counts,
      wouldRefuseOnCloud: false, egressReason: null,
    };
  }

  // LOCAL. The same elements are run through the boundary anyway — not to build the body, which it
  // cannot, but so that "this payload is one the egress gate would stop" is MEASURED and travels with
  // the result instead of living in a comment.
  const probe = egressBoundary.assemble({
    kind: 'chat', model, messages: toGateMessages(elements), stream, allowInternal,
  });

  return {
    ok: true,
    destination,
    variant,
    body: { model, messages: elements.map(e => ({ role: e.role, content: e.text })), stream: stream === true },
    maxLevel: maxLevelOf(elements),
    counts: { messages: elements.length, parts: 0 },
    wouldRefuseOnCloud: probe.ok !== true,
    egressReason: probe.ok ? null : probe.reason,
  };
}

/**
 * Which model answers this turn.
 *
 * Returns `modelRoles.selectForRole` UNCHANGED, including `fit: 'none'` with its reason and its
 * exclusion list. Honouring a refusal is the caller's contract and is asserted as such: the defect
 * this replaces is `models:chat`'s FALLBACK_CHAIN, where a refusal became a silent downgrade to
 * whatever was first and available, so master could not tell "I asked the big model" from "I quietly
 * got the small one".
 */
function selectModel(models = [], { sensitive = false, diskBudgetBytes = null } = {}) {
  return modelRoles.selectForRole(ROLE, models, {
    requirePrivate: sensitive === true,
    diskBudgetBytes,
  });
}

/**
 * Where a chosen model's payload goes.
 *
 * `private === true` is local; `private === false` is cloud; ANYTHING ELSE IS LOCAL. A row whose
 * privacy nobody recorded is an unknown, and the safe default for an unknown is the loopback — at
 * worst that is a loud model-not-found from the daemon, which is a far better failure than a prompt
 * that cannot be recalled.
 */
function destinationFor(modelRow) {
  if (!modelRow || typeof modelRow !== 'object') return 'local';
  return modelRow.private === false ? 'cloud' : 'local';
}

module.exports = {
  ROLE, VARIANTS, DESTINATIONS, REASON, FORM_OF_ADDRESS, CLOUD_SAFE_LINES,
  cloudSafePrompt, assembleTurn, selectModel, destinationFor,
};
