/**
 * commandIntents.js — what a spoken or typed line MEANS, decided once (spec Section 149.3).
 *
 * WHY THIS EXISTS. Master's words reach Rāma by three routes - typed in Chat (the reflex skills in
 * `cognition.js`), spoken (the table in `voiceEngine.js`), and the palette - and each had its own idea of
 * what "mute" meant. The reflex tested `t.includes('mute')`, so "unmute the microphone" MUTED it. The
 * voice table listed 'mute yourself' under mute-speech BEFORE unmute-speech, and "unmute yourself"
 * contains "mute yourself", so by voice it muted too. Two parsers, the same defect, found only by
 * reading both. They now read this one.
 *
 * PURE ON PURPOSE: no imports, no `window`, no store. It runs under Node, so the behaviour is asserted
 * (`scripts/verifyCommandRouting.mjs`) instead of trusted.
 *
 * A MISFIRE IS WORSE THAN AN ESCALATION. `cognition.js` already says it for the zoom skills: a false
 * positive silently replaces what master actually asked with an unrelated action, whereas an escalation
 * only costs a model call. So these intents are strict - word-bounded, short utterances only, never a
 * question - and everything else is conversation.
 */

/** Longer than this and it is a sentence about muting, not an order to mute. */
export const MAX_COMMAND_WORDS = 10;

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[\u2018\u2019]/g, "'")          // curly apostrophes: "let’s" must equal "let's"
  .replace(/[^a-z0-9'\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const wordCount = (t) => (t ? t.split(' ').length : 0);

/** A question is never an order. "how do I mute the mic in zoom" must reach a model, not the mic. */
const QUESTION_LEAD = /^(how|what|why|when|where|which|who|whom|whose|is|are|does|do|did|should|would)\b/;

/** Word-bounded phrase test: `unmute` does NOT contain the word `mute`; `commute` does not either. */
const has = (t, phrase) => new RegExp(`(?:^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(t);
const hasAny = (t, phrases) => phrases.some(p => has(t, p));

// Order matters and is the whole point: UNMUTE is tested before MUTE, so a phrase that is a longer form
// of the opposite can never be swallowed by it.
const SPEECH_UNMUTE = ['you can talk', 'speak again', 'talk again', 'start talking', 'unmute yourself',
  'unmute speech', 'unmute your voice', 'convo yes', 'lets talk', "let's talk"];
const MIC_UNMUTE = ['unmute the mic', 'unmute mic', 'unmute the microphone', 'unmute microphone',
  'unmute my mic', 'unmute my microphone', 'start listening', 'listen again'];
const SPEECH_MUTE = ['stop talking', 'be quiet', 'mute yourself', 'shut up', 'no convo',
  'stop the conversation', 'stop speaking', 'mute speech', 'mute your voice'];
const MIC_MUTE = ['mute the mic', 'mute mic', 'mute the microphone', 'mute microphone', 'mute my mic',
  'mute my microphone', 'stop listening'];

// A single word is a command only when it is nearly ALL of the utterance. "mute" or "unmute please" is
// an order; "the mute button does not work" and "a quiet market today" are sentences about something
// else, and acting on them would replace what master said with a muted microphone.
const BARE = { mute: ['mic', true], unmute: ['mic', false], silence: ['speech', true], quiet: ['speech', true] };
const BARE_MAX_WORDS = 3;

/**
 * @param {string} text
 * @returns {{target: 'mic'|'speech', mute: boolean} | null}
 */
export function parseMuteIntent(text) {
  const t = norm(text);
  if (!t || wordCount(t) > MAX_COMMAND_WORDS || QUESTION_LEAD.test(t)) return null;

  if (hasAny(t, SPEECH_UNMUTE)) return { target: 'speech', mute: false };
  if (hasAny(t, MIC_UNMUTE))    return { target: 'mic',    mute: false };
  if (hasAny(t, SPEECH_MUTE))   return { target: 'speech', mute: true };
  if (hasAny(t, MIC_MUTE))      return { target: 'mic',    mute: true };

  if (wordCount(t) <= BARE_MAX_WORDS) {
    for (const [word, [target, mute]] of Object.entries(BARE)) {
      if (has(t, word)) return { target, mute };
    }
  }
  return null;
}

// ─── The autonomy stop (Section 150.2) ────────────────────────────────────────
/**
 * "Stop everything." Engages the halt on Rāma's own background activity. Strict on purpose, for the
 * reason every intent here is: a phrase that fires in the middle of a sentence about something else halts
 * work master did not mean to halt. The cost of a false stop is small and visible; the cost of a stop that
 * needs the exact words is worse, so a handful of natural phrasings are listed rather than one.
 *
 * THERE IS NO RESUME PHRASE AND THERE MUST NOT BE ONE. Stopping is the fail-safe direction and any voice
 * in the room can ask for it; resuming is master-only, from a signed-in session, with a written note
 * (`system.suspend-autonomy`). `scripts/verifyCommandRouting.mjs` asserts that nothing in this module or
 * the voice table can produce a resume, so adding one is a red row and not a quiet convenience.
 */
const STOP_PHRASES = ['stop everything', 'halt everything', 'emergency stop', 'halt autonomy',
  'stop autonomy', 'stop all autonomy', 'stop autonomous activity', 'stop your background tasks',
  'stop all background tasks', 'freeze everything'];

export function parseStopIntent(text) {
  const t = norm(text);
  if (!t || wordCount(t) > MAX_COMMAND_WORDS || QUESTION_LEAD.test(t)) return false;
  return hasAny(t, STOP_PHRASES);
}

/** What Rāma says back. It states what the stop does AND what it does not, because "stop" over-promises. */
export function stopReply(result) {
  if (!result || result.ok === false) {
    return `I could not engage the stop: ${result?.error ?? 'no answer'}. Nothing has changed.`;
  }
  const base = result.alreadyHalted
    ? 'Autonomy was already halted.'
    : 'Autonomy is halted. My background tasks will skip their work until the master resumes them.';
  return `${base} Anything you ask me directly still works.`;
}

/** The action name the UI layers already understand. One mapping, so they cannot disagree. */
export function muteActionName(intent) {
  if (!intent) return null;
  return `${intent.mute ? 'mute' : 'unmute'}-${intent.target === 'mic' ? 'mic' : 'speech'}`;
}

/** What Rāma says back, in one place. */
export function muteReply(intent) {
  if (!intent) return '';
  if (intent.target === 'speech') return intent.mute ? 'I will stay silent.' : 'I can speak again.';
  return intent.mute ? 'Microphone muted.' : 'Microphone live.';
}

/**
 * What the palette should DO with the result of `matchVoiceCommand` - the decision that was wrong.
 *
 * `onCommand` used to test `if (matched.route)` first. `matchVoiceCommand` returns `route: '/'` together
 * with `action: 'inject-message'` for every "search for / look up / find" and for the unmatched fallback,
 * so every free-form sentence master spoke took the NAVIGATE branch (to Home) and the branch that was
 * meant to carry it to Rāma could never run. Speech has not reached a model since the voice ladder was
 * built. Deciding it here, in order, means the order is a thing a test can hold.
 *
 *   utterance  free-form speech: hand it to Chat exactly as if it had been typed
 *   action     a UI command (palette, mute, badge) - no navigation, no model
 *   navigate   go to a page. `spawn-agent` also lands here with its argument kept, not dropped
 *   none       nothing worth doing (an empty utterance)
 *
 * @param {{route?:string|null, action?:string|null, message?:string, agentType?:string}|null} matched
 * @param {string} command  the utterance with the wake word already removed
 */
export function resolveVoiceDispatch(matched, command) {
  const cmd = String(command ?? '').trim();
  const speech = (text) => {
    const t = String(text ?? '').trim();
    return t ? { kind: 'utterance', text: t } : { kind: 'none' };
  };

  if (!matched) return speech(cmd);
  if (matched.action === 'inject-message') return speech(matched.message ?? cmd);
  // "identify yourself" is a question for Rāma, and Chat already knows how to answer it for master and
  // for a stranger differently. It used to be matched and then dropped by a handler that did not exist.
  if (matched.action === 'identify') return speech(cmd);
  if (matched.route) {
    return matched.action
      ? { kind: 'navigate', route: matched.route, action: matched.action, agentType: matched.agentType ?? null }
      : { kind: 'navigate', route: matched.route };
  }
  if (matched.action) return { kind: 'action', action: matched.action };
  return { kind: 'none' };
}

/**
 * A whole-utterance test for the bare word. "help" must mean the capabilities summary, not "help me
 * refactor this function" - the old substring test sent the second to the first.
 */
export function isBareHelp(text) {
  const t = norm(text);
  return t === 'help' || t === 'help me' || t === 'what can you do' || t === 'what can you do for me';
}

/** Word-bounded single-term test for skills that matched on substrings (`ram` inside `program`). */
export function hasWord(text, word) {
  return has(norm(text), norm(word));
}

export { norm as normaliseUtterance };
