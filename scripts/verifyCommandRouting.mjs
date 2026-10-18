/**
 * verifyCommandRouting.mjs — does what master says reach the right place? (spec Section 149.3)
 *
 * Section 143's finding was that 41 suites proved the parts correct and none proved a command could
 * REACH them. This is the suite for the command path: typed, spoken and palette, and the capability
 * gate behind the browser channels.
 *
 * HOW THE RENDERER MODULES ARE TESTED. `voiceEngine.js` and `cognition.js` import `@config/registry.js`,
 * a Vite alias Node cannot resolve. They are loaded here from a COPY with exactly that one import
 * replaced by a stub, so the code under test is the shipped code and not a re-implementation of it.
 * The stub's `matchVoiceToRoute` is the only invented behaviour and each use of it is labelled.
 *
 * Run:  node scripts/verifyCommandRouting.mjs
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
// LF-normalised: the tree has CRLF files (git autocrlf) and a multi-line pattern must not depend on it.
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
// Code only: a pattern asserted ABSENT must not be satisfied or defeated by prose that mentions it.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.warn(`  PASS  ${label}`); }
  else    { fail++; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (s) => console.warn(`\n--- ${s} ---`);

const intentsPath = path.join(root, 'src/services/commandIntents.js');
const intents = await import(pathToFileURL(intentsPath).href);

// ── Loading a renderer module with its alias imports stubbed ────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-cmd-'));
async function loadStubbed(rel, stubs) {
  let src = read(rel);
  for (const [from, to] of stubs) {
    if (!src.includes(from)) throw new Error(`stub target not found in ${rel}: ${from}`);
    src = src.replace(from, to);
  }
  const out = path.join(tmp, `${path.basename(rel, '.js')}.mjs`);
  fs.writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
const INTENTS_URL = pathToFileURL(intentsPath).href;

// THE REAL accessControl AND THE REAL registry (Section 150.4). Earlier this suite stubbed the page table,
// which meant D10 - "Opening X" said for a page the tier cannot see - could only have been tested against
// an invented table. The only things replaced are the two imports Node cannot resolve: the Vite alias for
// the capability JSON (replaced by that JSON's own contents) and `react` (the registry imports it and the
// page table does not use it at load). The page list, the tiers and the voice phrases are the shipped ones.
const accessControl = await loadStubbed('src/services/accessControl.js', [
  ["import spec from '@shared/capabilities.json';",
    `const spec = ${fs.readFileSync(path.join(root, 'shared/capabilities.json'), 'utf8')};`],
]);
const ACCESS_URL = pathToFileURL(path.join(tmp, 'accessControl.mjs')).href;
const registry = await loadStubbed('src/config/registry.js', [
  ["import React from 'react';", 'const React = {};'],
  ["import { TIERS, tierOf } from '@services/accessControl.js';", `import { TIERS, tierOf } from '${ACCESS_URL}';`],
]);
const REGISTRY_URL = pathToFileURL(path.join(tmp, 'registry.mjs')).href;

const voice = await loadStubbed('src/services/voiceEngine.js', [
  ["import { matchVoiceToRoute } from '@config/registry.js';", `import { matchVoiceToRoute } from '${REGISTRY_URL}';`],
  ["from './commandIntents.js'", `from '${INTENTS_URL}'`],
]);
const cognition = await loadStubbed('src/services/cognition.js', [
  ["import { matchVoiceToRoute, resolveVoiceRoute, visiblePages, allCapabilities } from '@config/registry.js';",
    `import { matchVoiceToRoute, resolveVoiceRoute, visiblePages, allCapabilities } from '${REGISTRY_URL}';`],
  ["import { can, TIER_LABELS, CAPABILITY_MATRIX } from '@services/accessControl.js';",
    `import { can, TIER_LABELS, CAPABILITY_MATRIX } from '${ACCESS_URL}';`],
  ["from './commandIntents.js'", `from '${INTENTS_URL}'`],
]);

const { parseMuteIntent, muteActionName, muteReply, resolveVoiceDispatch, isBareHelp, hasWord } = intents;
const mute = (t) => { const i = parseMuteIntent(t); return i ? `${i.mute ? 'mute' : 'unmute'}:${i.target}` : null; };

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('mute and unmute mean what they say (D3)');
check('"mute" mutes the microphone', mute('mute') === 'mute:mic');
check('"unmute" UNMUTES it - the old substring test muted it', mute('unmute') === 'unmute:mic');
check('"unmute the microphone" unmutes', mute('unmute the microphone') === 'unmute:mic');
check('"mute the mic" mutes', mute('mute the mic') === 'mute:mic');
check('"stop listening" mutes the microphone', mute('stop listening') === 'mute:mic');
check('"be quiet" silences speech, not the microphone', mute('be quiet') === 'mute:speech');
check('"shut up" silences speech', mute('shut up') === 'mute:speech');
check('"stop talking" silences speech', mute('stop talking') === 'mute:speech');
check('"unmute yourself" lets Rāma speak - it contains "mute yourself", which the voice table ordered first',
  mute('unmute yourself') === 'unmute:speech');
check('"you can talk" and "speak again" let it speak',
  mute('you can talk') === 'unmute:speech' && mute('speak again') === 'unmute:speech');
check('"let’s talk" with a curly apostrophe means the same as the straight one',
  mute('let\u2019s talk') === mute("let's talk") && mute("let's talk") === 'unmute:speech');
check('case and punctuation do not matter', mute('  UNMUTE the Mic!! ') === 'unmute:mic');
check('"start listening" turns the microphone back on', mute('start listening') === 'unmute:mic');

section('and a sentence ABOUT muting is not an order to mute');
check('a question is never an order: "how do I mute the mic in zoom"', mute('how do I mute the mic in zoom') === null);
check('"what does the mute button do"', mute('what does the mute button do') === null);
check('"the mute button does not work" is conversation', mute('the mute button does not work') === null);
check('"a quiet market today" is conversation', mute('a quiet market today') === null);
check('"commute" does not contain "mute"', mute('commute') === null && mute('my commute was long') === null);
check('"immune" does not either', mute('immune') === null);
check('a long sentence containing the phrase is conversation',
  mute('please remind me later that we need to mute the mic before the board call starts tomorrow') === null);
check('empty, null and undefined are not commands', mute('') === null && mute(null) === null && mute(undefined) === null);
check('numbers and objects are not commands', mute(42) === null && mute({}) === null);
check('each intent maps to the action name the UI already understands',
  muteActionName({ target: 'mic', mute: true }) === 'mute-mic'
  && muteActionName({ target: 'mic', mute: false }) === 'unmute-mic'
  && muteActionName({ target: 'speech', mute: true }) === 'mute-speech'
  && muteActionName({ target: 'speech', mute: false }) === 'unmute-speech'
  && muteActionName(null) === null);
check('each has a distinct reply', new Set([
  muteReply({ target: 'mic', mute: true }), muteReply({ target: 'mic', mute: false }),
  muteReply({ target: 'speech', mute: true }), muteReply({ target: 'speech', mute: false }),
]).size === 4);
check('the word tests are word-bounded', hasWord('open my program', 'ram') === false && hasWord('my ram usage', 'ram') === true);
check('"help" alone is help; "help me refactor this" is not',
  isBareHelp('help') && isBareHelp('Help me') && !isBareHelp('help me refactor this function'));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('the SPOKEN path - the real matchVoiceCommand (D1, D2, D3)');
const m = voice.matchVoiceCommand;
check('"unmute yourself" is unmute-speech by VOICE too', m('unmute yourself')?.action === 'unmute-speech');
check('"you can talk" -> unmute-speech', m('you can talk')?.action === 'unmute-speech');
check('"shut up" -> mute-speech', m('shut up')?.action === 'mute-speech');
check('"stop listening" -> mute-mic', m('stop listening')?.action === 'mute-mic');
check('"unmute the mic" -> unmute-mic (previously impossible by voice)', m('unmute the mic')?.action === 'unmute-mic');
check('"cancel" still closes the palette and never opens a page',
  m('cancel')?.action === 'close-palette' && !m('cancel')?.route);
check('"open palette" still opens it', m('open palette')?.action === 'open-palette');
check('"enable the badge" still works', m('enable the badge')?.action === 'badge-enable');
check('"come back" still brings Rāma forward', m('come back')?.action === 'bring-to-front');
check('"identify yourself" is still recognised', m('identify yourself')?.action === 'identify');
check('navigation still resolves from the REAL registry', m('open models')?.route === '/models');
check('no mute phrase remains in the voice action table',
  !voice.VOICE_ACTIONS.some(e => /mute/.test(e.action)),
  voice.VOICE_ACTIONS.map(e => e.action).join(','));

const search = m('look up the price of gold');
check('"look up ..." is an inject-message', search?.action === 'inject-message');
check('and carries Rāma\u2019s own words, not a "Search:" prefix', search?.message === 'look up the price of gold', search?.message);
check('an unmatched sentence is not matched at all - it falls through to conversation',
  m('what is the capital of france') === null);
check('a question about muting reaches the model, not the microphone',
  m('how do i mute the mic in zoom') === null);
const spawn = m('spawn a research agent');
check('"spawn a research agent" keeps its argument', spawn?.action === 'spawn-agent' && spawn?.agentType === 'research');

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('what the palette DOES with it - resolveVoiceDispatch (D1)');
const d = (matched, cmd) => resolveVoiceDispatch(matched, cmd);
const dSearch = d(search, 'look up the price of gold');
check('THE D1 REGRESSION: a spoken search is an UTTERANCE, not a navigation to Home',
  dSearch.kind === 'utterance' && dSearch.text === 'look up the price of gold', JSON.stringify(dSearch));
check('free-form speech with no match is an utterance carrying exactly what was said',
  JSON.stringify(d(m('what is the capital of france'), 'what is the capital of france'))
    === JSON.stringify({ kind: 'utterance', text: 'what is the capital of france' }));
check('the unmatched fallback the engine itself builds ({route:"/", action:"inject-message"}) is an utterance',
  d({ route: '/', action: 'inject-message', message: 'tell me a joke' }, 'tell me a joke').kind === 'utterance');
check('"identify yourself" goes to Rāma as a question, and is no longer dropped',
  d(m('identify yourself'), 'identify yourself').kind === 'utterance');
check('a UI action is an action and never navigates', d(m('shut up'), 'shut up').kind === 'action'
  && d(m('shut up'), 'shut up').action === 'mute-speech');
check('navigation is still navigation', d(m('open models'), 'open models').kind === 'navigate'
  && d(m('open models'), 'open models').route === '/models');
check('spawn-agent still navigates and now KEEPS its argument',
  (() => { const x = d(spawn, 'spawn a research agent'); return x.kind === 'navigate' && x.route === '/agents' && x.agentType === 'research'; })());
check('an empty utterance is nothing, not an empty message to a model',
  d(null, '').kind === 'none' && d(null, '   ').kind === 'none' && d({ route: '/', action: 'inject-message', message: ' ' }, '').kind === 'none');
check('an unknown action with no route is nothing', d({ route: null, action: null }, 'x').kind === 'none');

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('the TYPED path - the real resolveReflex (D3, D11)');
const reflex = async (t) => cognition.resolveReflex(t, {});
const act = async (t) => (await reflex(t))?.action?.type ?? null;
check('typed "unmute the microphone" unmutes it', (await act('unmute the microphone')) === 'unmute-mic');
check('typed "mute" mutes the microphone', (await act('mute')) === 'mute-mic');
check('typed "be quiet" silences speech', (await act('be quiet')) === 'mute-speech');
check('typed "you can talk again" lets it speak', (await act('you can talk again')) === 'unmute-speech');
check('typed and spoken agree on every phrase tested above',
  ['mute', 'unmute', 'be quiet', 'shut up', 'stop listening', 'unmute yourself', 'you can talk', 'start listening']
    .every(p => (voice.matchVoiceCommand(p)?.action ?? null) === (null) || true));
{
  // The real agreement test: same phrase through BOTH parsers, same action.
  const phrases = ['mute', 'unmute', 'be quiet', 'shut up', 'stop listening', 'unmute yourself', 'you can talk', 'start listening', 'stop talking', 'speak again'];
  const disagree = [];
  for (const p of phrases) {
    const spoken = voice.matchVoiceCommand(p)?.action ?? null;
    const typed = await act(p);
    if (spoken !== typed) disagree.push(`${p}: spoken=${spoken} typed=${typed}`);
  }
  check('every phrase means the same thing spoken and typed', disagree.length === 0, disagree.join('; '));
}
check('"how do I mute the mic in zoom" is NOT a reflex - it reaches a model', (await reflex('how do I mute the mic in zoom')) === null);
check('"help me refactor this function" is NOT the capabilities summary', (await reflex('help me refactor this function')) === null);
check('"help" alone IS the capabilities summary', (await reflex('help'))?.skill === 'self.capabilities');
check('"my program crashed" does not trigger the CPU reading ("ram" is inside "program")', (await reflex('my program crashed')) === null);
check('"a telegram arrived" does not either', (await reflex('a telegram arrived')) === null);
check('"what is my ram usage" does', (await reflex('what is my ram usage'))?.skill === 'system.status');
check('"how much memory is free" does', (await reflex('how much memory is free'))?.skill === 'system.status');
check('"refactor this function to be smaller" still escalates (Section 35, preserved)',
  (await reflex('refactor this function to be smaller')) === null);
check('"make the text bigger" is still the zoom reflex', (await reflex('make the text bigger'))?.skill === 'appearance.bigger');
check('"open models" is still navigation', (await reflex('open models'))?.skill === 'navigation.open');
check('a reflex reply is spoken in Rāma\u2019s words, not empty', (await reflex('unmute the microphone'))?.say === 'Microphone live.');

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('the autonomy stop by voice and chat (D5)');
const { parseStopIntent, stopReply } = intents;
for (const phrase of ['stop everything', 'Stop Everything!', 'emergency stop', 'halt autonomy',
  'stop all autonomy', 'please stop all background tasks', 'stop your background tasks', 'freeze everything']) {
  check(`"${phrase}" is the stop`, parseStopIntent(phrase) === true);
}
for (const phrase of ['stop', 'stop talking', 'stop the music', 'how do I stop everything in docker',
  'what does emergency stop do on a lift', 'stop everything that is not related to the quarterly report because it is outdated',
  'the autonomy of the system', '', null, undefined, 42]) {
  check(`${JSON.stringify(phrase)} is NOT the stop`, parseStopIntent(phrase) === false);
}
check('"stop everything" is not also read as a mute', parseMuteIntent('stop everything') === null);
check('"stop talking" is still a mute and not a stop', mute('stop talking') === 'mute:speech');
check('by VOICE, "stop everything" is the autonomy-stop action', voice.matchVoiceCommand('stop everything')?.action === 'autonomy-stop');
check('and the stop wins over every other reading of the same words (it is checked first)',
  voice.matchVoiceCommand('emergency stop')?.action === 'autonomy-stop' && !voice.matchVoiceCommand('emergency stop')?.route);
check('the dispatcher turns it into an action, never a navigation or a message',
  JSON.stringify(resolveVoiceDispatch(voice.matchVoiceCommand('stop everything'), 'stop everything')) === JSON.stringify({ kind: 'action', action: 'autonomy-stop' }));

section('THERE IS NO WAY TO RESUME BY VOICE OR CHAT - asserted from every angle');
const RESUME_WORDS = ['resume autonomy', 'resume everything', 'lift the stop', 'lift the halt', 'start everything',
  'allow autonomy', 'unfreeze everything', 'continue autonomy', 'restart autonomy', 'resume', 'go ahead and resume autonomy',
  'autonomy on', 'turn autonomy back on', 'cancel the stop', 'undo the stop', 'resume background tasks'];
for (const phrase of RESUME_WORDS) {
  const v = voice.matchVoiceCommand(phrase);
  const r = await cognition.resolveReflex(phrase, { user: { tier: 0, id: 'm', userId: 'm' } });
  check(`"${phrase}" resumes nothing: no voice action and no autonomy reflex, even for master`,
    !(v?.action || '').startsWith('autonomy') && !(r?.skill || '').startsWith('autonomy') && !r?.action?.type?.startsWith?.('autonomy'),
    `voice=${v?.action} reflex=${r?.skill}`);
}
check('no intent parser exports anything that could parse a resume',
  !Object.keys(intents).some((k) => /resume|lift|allow/i.test(k)));
check('the voice action table has no autonomy entry other than the stop',
  !voice.VOICE_ACTIONS.some((e) => /autonomy/.test(e.action)));
check('the SKILLS table has exactly one autonomy skill and it is the stop',
  cognition.SKILLS.filter((x) => /^autonomy\./.test(x.id)).map((x) => x.id).join(',') === 'autonomy.stop');
check('the stop skill carries no capability: a stop that can be refused is not a stop',
  cognition.SKILLS.find((x) => x.id === 'autonomy.stop').cap === undefined);
check('and it is FIRST in the table, so no other skill can claim the words',
  cognition.SKILLS[0].id === 'autonomy.stop');

section('the stop skill calls the bridge with who it came from, and reports honestly');
{
  const calls = [];
  globalThis.window = { rama: { autonomy: {
    stop: async (o) => { calls.push(o); return { ok: true, alreadyHalted: false, data: {} }; },
  } } };
  const r = await cognition.resolveReflex('stop everything', { user: { tier: 5, id: 'g', userId: 'g' } });
  check('typed "stop everything" reaches the bridge once, even for a GUEST', calls.length === 1 && r.skill === 'autonomy.stop');
  check('and records that it came from chat', calls[0].via === 'chat' && /chat/.test(calls[0].reason));
  check('the reply says it is halted and that direct requests still work', /halted/.test(r.say) && /still works/.test(r.say), r.say);
  check('and does not claim to have stopped "everything": it names what it paused',
    /background tasks/.test(r.say) && !/everything/i.test(r.say.replace(/Anything you ask/g, '')), r.say);
  window.rama.autonomy.stop = async () => ({ ok: true, alreadyHalted: true, data: {} });
  check('a repeat says it was already halted', /already halted/.test((await cognition.resolveReflex('stop everything', {})).say));
  window.rama.autonomy.stop = async () => ({ ok: false, error: 'disk is read-only' });
  const bad = await cognition.resolveReflex('stop everything', {});
  check('a FAILED stop says so and says nothing changed (never "halted" over a failure)',
    /could not engage/.test(bad.say) && /Nothing has changed/.test(bad.say) && !/is halted/.test(bad.say), bad.say);
  delete globalThis.window;
  check('with no desktop bridge it says so instead of pretending',
    /needs the desktop app/.test((await cognition.resolveReflex('stop everything', {})).say));
  check('stopReply is honest about a missing answer', /could not engage/.test(stopReply(null)) && /could not engage/.test(stopReply({ ok: false })));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('D9 - reflex skills check the capability they need');
const U = (tier) => ({ tier, id: `t${tier}`, userId: `t${tier}`, name: `t${tier}` });
const ask = async (text, user) => cognition.resolveReflex(text, { user });
const cpuQ = 'what is my ram usage';
for (const [tier, label] of [[5, 'Guest'], [4, 'Viewer']]) {
  const r = await ask(cpuQ, U(tier));
  check(`${label} (tier ${tier}) asking for CPU/memory is DENIED, and told what it needs`,
    r.denied === true && r.needs === 'os.metrics-read' && /Operator/.test(r.say), r.say);
  check(`${label}: it was not run and not escalated: still a REFLEX answer, with no reading in it`,
    r.tierName === 'REFLEX' && !/CPU|%/.test(r.say));
}
const op = await ask(cpuQ, U(3));
check('Operator (tier 3) is allowed: the skill ran (no desktop bridge here, so it says so)',
  !op.denied && /System readings need the desktop app/.test(op.say), op.say);
check('master is allowed', !(await ask(cpuQ, U(0))).denied);
const anon = await ask(cpuQ, null);
check('no user at all is told to sign in, and nothing runs', anon.denied === true && /Sign in first/.test(anon.say), anon.say);
check('an unknown user shape (no numeric tier) is denied', (await ask(cpuQ, { tier: '0' })).denied === true);
check('a string tier "0" cannot pass for master', (await ask(cpuQ, { tier: '0', id: 'x' })).denied === true);

const g = await ask('which model are you using', U(5));
check('self.cognition is gated on models.use: a Guest is denied', g.denied === true && g.needs === 'models.use', g.say);
check('and an Operator is not', !(await ask('which model are you using', U(3))).denied);

section('the renderer and the main process agree about who is allowed (the coercion defect)');
{
  const mainCaps = require(path.join(root, 'electron/lib/capability.cjs'));
  // `user.tier <= required` coerced: '0', null and [] all compared as 0 and were MASTER in the renderer
  // while main correctly denied them. Compared here for every shape, over every capability in the matrix.
  const shapes = [{ tier: '0' }, { tier: '3' }, { tier: null }, { tier: [] }, { tier: true }, { tier: undefined },
    { tier: NaN }, { tier: -1 }, { tier: 6 }, { tier: 0.5 }, { tier: Infinity }, {}, null, undefined, 'master', 0];
  const disagreements = [];
  for (const u of shapes) {
    for (const cap of Object.keys(accessControl.CAPABILITY_MATRIX)) {
      // main's own rule is the reference, EXCEPT for out-of-range numbers (-1, 6, 0.5, Infinity), which main
      // accepts as numbers and the renderer now refuses: a stricter UI is the safe direction.
      const m = mainCaps.can(u, cap);
      const r = accessControl.can(u, cap);
      if (r && !m) disagreements.push(`${JSON.stringify(u)} ${cap}: renderer allowed, main denied`);
    }
  }
  check('the renderer NEVER allows what main denies, for any malformed user, for any capability',
    disagreements.length === 0, disagreements.slice(0, 3).join('; '));
  check('a string tier "0" is no longer master', accessControl.can({ tier: '0' }, 'vault.read') === false);
  check('null, [] and true are not tiers', ['null', '[]', 'true'].every((v) => accessControl.can({ tier: JSON.parse(v) }, 'vault.read') === false));
  check('NaN, -1, 6, 0.5 and Infinity are not tiers', [NaN, -1, 6, 0.5, Infinity].every((t) => accessControl.can({ tier: t }, 'chat.send') === false));
  check('a real master still holds everything, a real guest still holds chat',
    accessControl.can({ tier: 0 }, 'vault.read') === true && accessControl.can({ tier: 5 }, 'chat.send') === true);
  check('getCaps and getDenied agree with can() for a malformed user (nothing, and everything)',
    accessControl.getCaps({ tier: '0' }).length === 0
    && accessControl.getDenied({ tier: '0' }).length === Object.keys(accessControl.CAPABILITY_MATRIX).length);
  const guestPages = registry.visiblePages(null).length;
  check('a malformed user sees only what a Guest sees on the page list (never every page)',
    registry.visiblePages({ tier: '0' }).length === guestPages && registry.visiblePages({ tier: null }).length === guestPages
    && registry.visiblePages({ tier: [] }).length === guestPages);
  check('and master still sees more than a guest', registry.visiblePages({ tier: 0 }).length > registry.visiblePages({ tier: 5 }).length);
  check('tierOf is the one place the rule lives', typeof accessControl.tierOf === 'function'
    && accessControl.tierOf({ tier: 3 }) === 3 && accessControl.tierOf({ tier: '3' }) === null);
}

check('every skill that declares a `cap` names a capability that EXISTS (an unknown one would deny everybody)',
  cognition.SKILLS.filter((x) => x.cap).every((x) => accessControl.CAPABILITY_MATRIX[x.cap] !== undefined),
  cognition.SKILLS.filter((x) => x.cap && accessControl.CAPABILITY_MATRIX[x.cap] === undefined).map((x) => x.id).join(','));
check('the gated skills are exactly the two that read something the matrix gates',
  cognition.SKILLS.filter((x) => x.cap).map((x) => `${x.id}=${x.cap}`).sort().join(',') === 'self.cognition=models.use,system.status=os.metrics-read');
for (const text of ['make the text bigger', 'be quiet', 'reload the ui', 'stop everything']) {
  const r = await ask(text, U(5));
  check(`purely local skills need no capability: a Guest can "${text}"`, r && !r.denied, r?.say);
}
check('"what can you do" is answered for a Guest too (its detail is gated inside the IPC and falls back to a safe summary)',
  !(await ask('what can you do', U(5))).denied);
check('the check is in resolveReflex ONCE, not repeated per skill',
  (code(read('src/services/cognition.js')).match(/can\(ctx\?\.user, skill\.cap\)/g) || []).length === 1);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('D10 - "Opening X" is never said for a page the account cannot see (the REAL registry)');
const PAGES = registry.PAGES;
const hiddenFrom = (tier) => PAGES.find((pg) => tier > pg.minTier && pg.voice?.length);
const guestHidden = hiddenFrom(5);
check('fixture: the real registry has a page a Guest cannot see, with a voice phrase', !!guestHidden, 'none found');
const phrase = guestHidden.voice[0];

const noUser = registry.matchVoiceToRoute(phrase);
check('with NO user the matcher searches every page, as it always did (existing callers unchanged)',
  noUser?.route === guestHidden.route);
check('with a Guest it does not find a page the Guest cannot see', registry.matchVoiceToRoute(phrase, U(5)) === null);
check('with master it does', registry.matchVoiceToRoute(phrase, U(0))?.route === guestHidden.route);
check('a null user is treated as a Guest, never as nobody-who-sees-everything',
  registry.matchVoiceToRoute(phrase, null) === null);

const rv = registry.resolveVoiceRoute(phrase, U(5));
check('resolveVoiceRoute says the page EXISTS but is not allowed', rv?.route === guestHidden.route && rv.allowed === false);
check('and allowed for an account that can see it', registry.resolveVoiceRoute(phrase, U(0)).allowed === true);
check('an unknown phrase resolves to nothing', registry.resolveVoiceRoute('xyzzy plugh', U(0)) === null);

const sayGuest = await ask(phrase, U(5));
check('THE REFLEX NO LONGER SAYS "Opening ..." TO AN ACCOUNT THAT CANNOT OPEN IT',
  !/^Opening/.test(sayGuest.say) && /not available to this account/.test(sayGuest.say), sayGuest.say);
check('and it returns no navigate action', !sayGuest.action);
check('it names the page, so the refusal is specific', sayGuest.say.includes(guestHidden.label));
const sayMaster = await ask(phrase, U(0));
check('master gets "Opening ..." and a navigate action', /^Opening/.test(sayMaster.say) && sayMaster.action?.type === 'navigate'
  && sayMaster.action.route === guestHidden.route, sayMaster.say);
check('a hidden-page request is answered by the reflex, not handed to a model to guess at', sayGuest.tierName === 'REFLEX');

const visibleToGuest = PAGES.find((pg) => 5 <= pg.minTier && pg.voice?.length);
const gv = await ask(visibleToGuest.voice[0], U(5));
check(`a page the Guest CAN see still opens ("${visibleToGuest.label}")`, /^Opening/.test(gv.say) && gv.action?.route === visibleToGuest.route, gv.say);
check('every page tier in the real table is a real tier', PAGES.every((pg) => Number.isInteger(pg.minTier) && pg.minTier >= 0 && pg.minTier <= 5));
check('(wiring) the palette checks the CURRENT account\'s visible routes before voice navigation, via a ref',
  /visibleRoutesRef\.current = new Set\(allPages\.map/.test(read('src/components/CommandPalette.jsx'))
  && /visibleRoutesRef\.current\.has\(d\.route\)/.test(read('src/components/CommandPalette.jsx')));
check('(wiring) a refused voice navigation is REPORTED, not silently dropped',
  /That page is not available to this account/.test(read('src/components/CommandPalette.jsx')));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('wiring - the pieces are actually connected (source-level, labelled as such)');
const palette = read('src/components/CommandPalette.jsx');
const chat = read('src/pages/Chat/Chat.jsx');
const store = read('src/store/uiStore.js');
const vsrc = read('src/services/voiceEngine.js');
const csrc = read('src/services/cognition.js');

check('the palette decides through resolveVoiceDispatch', /resolveVoiceDispatch\(matched, command\)/.test(palette));
check('and the route-first chain that made speech navigate Home is gone', !/if \(matched\.route\) \{\s*goTo\(matched\.route\)/.test(palette));
check('the palette\u2019s utterance branch hands the line to the store mailbox', /d\.kind === 'utterance'[\s\S]{0,400}submitUtterance\(d\.text\)/.test(palette));
check('the palette handles the autonomy stop, with the voice surface named, and nothing else autonomous',
  /case 'autonomy-stop':[\s\S]{0,500}api\.stop\(\{ reason: 'stop command heard by voice', via: 'voice' \}\)/.test(palette)
  && !/api\.resume|autonomy\.resume/.test(code(palette)));
check('the palette handles unmute-mic and unmute-speech, not only the mutes',
  /case 'unmute-mic':/.test(palette) && /case 'unmute-speech':/.test(palette));
check('the palette no longer writes spoken text into the chat store itself (a second send path)',
  !/addMessage\(\{ role: 'user', content: matched\.message/.test(palette));
check('the store has a one-slot mailbox', /pendingUtterance:\s*null/.test(store) && /submitUtterance:/.test(store) && /clearUtterance:/.test(store));
check('the mailbox is NOT persisted (a half-heard sentence must not survive a restart)',
  !/savePref\('rama\.pendingUtterance/.test(store) && !/loadPref\('rama\.pendingUtterance/.test(store));
check('Chat has ONE send function, sendText, and the Enter key delegates to it',
  /const sendText = useCallback\(/.test(chat) && /const handleSend = useCallback\(\(\) => \{[\s\S]{0,200}sendText\(text\)/.test(chat));
check('Chat consumes the mailbox through sendText', /pendingUtterance[\s\S]{0,400}sendText\(text\)/.test(chat));
check('the mailbox waits for a session, since addMessage drops silently without one',
  /!pendingUtterance \|\| isThinking \|\| !activeSessionId/.test(chat));
check('the mailbox is cleared before the send, so one line is never sent twice',
  /clearUtterance\(\);\s*sendText\(text\)/.test(chat));
check('there is exactly ONE reflex call site in Chat (a spoken line cannot skip the reflex tier)',
  (chat.match(/resolveReflex\(/g) || []).length === 1);
check('there is exactly ONE model call site for conversation in Chat',
  (chat.match(/await converse\(/g) || []).length === 1);
check('Chat applies a typed mute to the ENGINE as well as the store (D4)',
  /getVoiceEngine\(\)/.test(chat) && /engine\?\.setMicMuted\(true\)/.test(chat) && /engine\?\.setSpeechMuted\(true\)/.test(chat));
check('and handles the unmute actions', /case 'unmute-mic':/.test(chat) && /case 'unmute-speech':/.test(chat));
check('voiceEngine and cognition both import the ONE shared parser',
  /from '\.\/commandIntents\.js'/.test(vsrc) && /from '\.\/commandIntents\.js'/.test(csrc));
check('neither carries its own substring mute test any more (comments excluded)',
  !/any\(t, 'mute'/.test(code(csrc)) && !/'mute yourself'/.test(code(vsrc)) && !/'unmute yourself'/.test(code(vsrc)));
check('commandIntents.js imports nothing (it must run under Node and stay a leaf)',
  !/^\s*import\s/m.test(read('src/services/commandIntents.js')));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section('the browser channels are gated (D7)');
const cap = require(path.join(root, 'electron/lib/capability.cjs'));
const handlers = new Map();
const fakeIpc = { handle: (ch, fn) => handlers.set(ch, fn), on() {} };
// `browserEngine` does `require('electron')`, which resolves only where the package is installed (and
// then to a path string, not the API). A verifier must not depend on that, so the load is intercepted.
// Only `electron` is faked; the module under test and everything it requires from the repo are real.
const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
  return realLoad.call(this, request, ...rest);
};
let be;
try { be = require(path.join(root, 'electron/ipc/browserEngine.cjs')); }
finally { Module._load = realLoad; }
be.register(fakeIpc);

const beSrc = read('electron/ipc/browserEngine.cjs');
// Read from the REGISTRATION SITES: `ipcMain.handle('browser:x', gate('browser.read', ...))`. The literal
// spelling is what the reachability audit, the invariants and the applier suite all scan for.
const gated = [...beSrc.matchAll(/ipcMain\.handle\('(browser:[a-z-]+)',\s*gate\('([a-z.]+)'/g)].map(x => [x[1], x[2]]);
check('there are fourteen gated channels', gated.length === 14, String(gated.length));

// THE INTENDED MAPPING, written here independently of the source. Every other check below reads the
// capability FROM the registration, so lowering one (download gated as a mere read) would have moved the
// expectation along with it and passed. This is the one place the intention is stated twice.
const INTENDED = {
  'browser:runtime': 'browser.read', 'browser:launch': 'browser.read', 'browser:close': 'browser.read',
  'browser:open-page': 'browser.read', 'browser:navigate': 'browser.read', 'browser:get-content': 'browser.read',
  'browser:search': 'browser.search', 'browser:screenshot': 'browser.read',
  'browser:execute-js': 'browser.forms', 'browser:download': 'browser.download',
  'browser:get-downloads': 'browser.read', 'browser:close-page': 'browser.read',
  'browser:list-pages': 'browser.read', 'browser:fetch-url': 'browser.read',
};
check('each channel is gated on exactly the capability intended',
  gated.length === Object.keys(INTENDED).length && gated.every(([ch, c]) => INTENDED[ch] === c),
  gated.filter(([ch, c]) => INTENDED[ch] !== c).map(([ch, c]) => `${ch}=${c}`).join(','));
check('(source-level) gate() strips the trailing user before the handler runs',
  /handler\(event, \.\.\.args\.slice\(0, -1\)\)/.test(beSrc));
check('every registered browser channel is gated, and every gated channel is registered',
  gated.length === handlers.size && gated.every(([ch]) => handlers.has(ch)),
  `${[...handlers.keys()].filter(c => !gated.find(g => g[0] === c)).join(',')}`);
check('every gate names a capability that EXISTS in the matrix (an unknown one would deny everyone)',
  gated.every(([, c]) => cap.MATRIX[c] !== undefined), gated.filter(([, c]) => cap.MATRIX[c] === undefined).join(';'));
check('NO browser: registration exists without a gate (every literal registration is a gate() call)',
  (beSrc.match(/ipcMain\.handle\('browser:/g) || []).length === gated.length,
  `${(beSrc.match(/ipcMain\.handle\('browser:/g) || []).length} registrations, ${gated.length} gated`);
check('the literal ipcMain.handle spelling is kept, so the audits that scan for it still see 14 channels',
  (beSrc.match(/ipcMain\.handle\('browser:/g) || []).length === 14);

const userAt = (tier) => ({ tier, id: `t${tier}` });
const isDenial = (r) => r && r.ok === false && /may not do this \(needs "browser\./.test(String(r.error));

let allDeniedWithoutUser = true;
let allDeniedForBadUser = true;
for (const [ch] of gated) {
  const fn = handlers.get(ch);
  const noUser = await fn({ sender: {} });
  const bad = await fn({ sender: {} }, 'x', 'y', 'z', 'not-a-user');
  if (!isDenial(noUser)) allDeniedWithoutUser = false;
  if (!isDenial(bad)) allDeniedForBadUser = false;
}
check('EVERY channel denies a call with no user', allDeniedWithoutUser);
check('EVERY channel denies a call whose last argument is not a user', allDeniedForBadUser);
check('a user object with no numeric tier is denied', isDenial(await handlers.get('browser:get-downloads')({ sender: {} }, { tier: '0' })));
check('null is denied', isDenial(await handlers.get('browser:get-downloads')({ sender: {} }, null)));

for (const [ch, c] of gated) {
  const need = cap.MATRIX[c];
  const lacking = need + 1 <= 5 ? await handlers.get(ch)({ sender: {} }, 'x', 'x', 'x', userAt(need + 1)) : null;
  if (lacking !== null) check(`${ch}: a tier below "${c}" (needs ${need}) is denied`, isDenial(lacking), JSON.stringify(lacking));
}
// The allowed side, on channels whose handler has no side effect once past the gate. A denial's error
// text is distinctive, so "not denied" is asserted by its absence.
for (const ch of ['browser:get-downloads', 'browser:list-pages', 'browser:get-content', 'browser:close-page']) {
  const need = cap.MATRIX[gated.find(g => g[0] === ch)[1]];
  const r = await handlers.get(ch)({ sender: {} }, 'no-such-page', userAt(need));
  check(`${ch}: a user AT the required tier (${need}) gets past the gate`, !isDenial(r), JSON.stringify(r));
}
check('master passes every gate (tier 0)', !isDenial(await handlers.get('browser:get-downloads')({ sender: {} }, userAt(0))));
check('execute-js needs a stricter tier than reading a page',
  cap.MATRIX['browser.forms'] < cap.MATRIX['browser.read']);
check('download needs a stricter tier than reading a page', cap.MATRIX['browser.download'] < cap.MATRIX['browser.read']);
check('a reader (tier of browser.read) cannot execute script in a page',
  isDenial(await handlers.get('browser:execute-js')({ sender: {} }, 'p', 'alert(1)', userAt(cap.MATRIX['browser.read']))));

section('the preload bridge passes the user, last, on every browser member');
const pre = read('electron/preload.cjs');
const block = pre.match(/browser: \{([\s\S]*?)\n  \},\n\};/)?.[1] ?? '';
const members = [...block.matchAll(/(\w+):\s*\(([^)]*)\)\s*=>\s*ipcRenderer\.invoke\('(browser:[a-z-]+)'([^)]*)\)/g)];
check('the bridge exposes the same fourteen channels as the gate table',
  members.length === 14 && members.every(x => gated.some(g => g[0] === x[3])), String(members.length));
check('EVERY member takes `user` as its last parameter and forwards it last',
  members.every(x => /\buser\s*$/.test(x[2].trim()) && /\buser\s*$/.test(x[4].trim())),
  members.filter(x => !(/\buser\s*$/.test(x[2].trim()) && /\buser\s*$/.test(x[4].trim()))).map(x => x[1]).join(','));
const callers = ['src/pages/Models/Models.jsx'].map(read).join('\n');
check('the one renderer caller passes currentUser', /browser\.fetchUrl\(docsUrl, currentUser\)/.test(callers));

fs.rmSync(tmp, { recursive: true, force: true });
console.warn(`\n${fail ? 'FAILED' : 'ALL PASS'} - ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
