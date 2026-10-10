#!/usr/bin/env node
'use strict';

/**
 * verifyConversation.cjs — Rāma talking with master (Section 133).
 *
 * THE BEHAVIOUR WORTH DEFENDING, in the order the suite asserts it:
 *
 *   (a) the role exists as a REQUIREMENT, and `sensitive` is false ON THE TABLE because the gate is
 *       per-turn on the payload — a later session flipping it would silently end cloud conversation;
 *   (b) THE CLOUD-SAFE PERSONA, asserted on BOTH halves: no identifier for master, AND it still names
 *       Rāma and addresses him as "master". A prompt that leaked nothing by saying nothing would pass
 *       a one-sided test;
 *   (c) ONE CHOKEPOINT — the cloud body is built by egressBoundary.assemble and the revealed prompt
 *       never reaches a cloud payload, measured over the assembled bytes rather than read;
 *   (d) CLOUD-FIRST, with real selections over real rows, both directions — and every other role
 *       unchanged, narration included;
 *   (e) `fit: 'none'` HONOURED — a refusal surfaces as a refusal and NO second model is tried;
 *   (f) STREAMING AND VOICE — the conversation path streams through the one HTTP client's
 *       postStreamingJsonLines, and the credential is still never spoken on the streaming path.
 *
 * NO LIVE CALL TO ollama.com IS MADE. Every outbound request is an injected transport and the only
 * credential in play is the literal dummy, which is the same literal verifyOllamaCloud.cjs uses and
 * the single entry on verifyInvariants.cjs's secret allow-list.
 *
 * Run: node scripts/verifyConversation.cjs   (or npm run verify:conversation)
 */

const fs   = require('fs');
const path = require('path');
const util = require('util');

const ROOT = path.resolve(__dirname, '..');

// ─── Reporting ────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];
const residuals = [];

function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`    PASS  ${label}`); return true; }
  fail += 1;
  failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  console.log(`    FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  return false;
}

function residual(msg) {
  residuals.push(msg);
  console.log(`    HELD BY HAND  ${msg}`);
}

function section(title) { console.log(`\n  ${title}`); }

// ─── Stubs, installed into the require cache BEFORE anything real is loaded ───

const DUMMY = 'test-not-a-real-key';

function cacheStub(relFromRoot, exports) {
  const filename = path.join(ROOT, relFromRoot);
  require.cache[filename] = { id: filename, filename, loaded: true, children: [], paths: [], exports };
  return exports;
}

let vaultUnlocked = true;
const vaultKeys = new Map();
const stubVault = cacheStub('electron/ipc/credentialVault.cjs', {
  register() {},
  isUnlocked: () => vaultUnlocked,
  getCredential: (service) => (vaultUnlocked ? (vaultKeys.get(service) ?? null) : null),
  setCredentialDirect() {},
  deleteCredentialDirect() {},
});

const storeData = new Map();
const stubStore = cacheStub('electron/dataStore.cjs', {
  get: (domain, key) => (storeData.has(`${domain}/${key}`) ? storeData.get(`${domain}/${key}`) : null),
  set: (domain, key, value) => { storeData.set(`${domain}/${key}`, value); return true; },
  saveDomain: () => true,
});

/** The LOCAL daemon's tag list. One model, sized so it clears the role's 7B floor. */
const LOCAL_TAG = 'lfm2.5:8b-a1b-q4_K_M';
let localTags = { models: [{ name: LOCAL_TAG, size: 5_400_000_000 }] };

const httpCalls = [];
/** Each streaming call's lines, so "it streamed" is measured per delta rather than asserted. */
let streamLines = () => ([
  { message: { role: 'assistant', content: 'Good ' } },
  { message: { role: 'assistant', content: 'morning, ' } },
  { message: { role: 'assistant', content: 'master.' } },
  { done: true, prompt_eval_count: 11, eval_count: 3 },
]);
let streamResult = () => ({ ok: true, status: 200 });

const stubHttp = cacheStub('electron/lib/http.cjs', {
  post: async (url, body, opts = {}) => {
    httpCalls.push({ method: 'POST', url, body, headers: opts.headers ?? null, streaming: false });
    return { ok: true, status: 200, body: '{"message":{"role":"assistant","content":"buffered"}}' };
  },
  get: async (url, opts = {}) => {
    httpCalls.push({ method: 'GET', url, body: null, headers: opts.headers ?? null, streaming: false });
    if (/\/api\/tags$/.test(url) && /localhost/.test(url)) {
      return { ok: true, status: 200, body: JSON.stringify(localTags) };
    }
    return { ok: true, status: 200, body: '{}' };
  },
  request: async (url, opts = {}) => {
    httpCalls.push({ method: 'RAW', url, body: opts.body ?? null, headers: opts.headers ?? null, streaming: false });
    return { ok: true, status: 200, body: '{}' };
  },
  postStreamingJsonLines: async (url, body, onLine, opts = {}) => {
    httpCalls.push({ method: 'POST', url, body, headers: opts.headers ?? null, streaming: true });
    for (const line of streamLines()) onLine(line);
    return streamResult();
  },
  getCircuitStatus: () => ({}),
  delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  MAX_RESPONSE_SIZE: 10 * 1024 * 1024,
});

// ─── The real modules, which pick up those stubs ──────────────────────────────

const roles      = require('../electron/lib/modelRoles.cjs');
const convo      = require('../electron/lib/conversationRole.cjs');
const egress     = require('../electron/lib/egressBoundary.cjs');
const cloud      = require('../electron/lib/ollamaCloud.cjs');
const capability = require('../electron/lib/capability.cjs');
const router     = require('../electron/ipc/modelRouter.cjs');

cloud.useVault(stubVault);
cloud.useStore(stubStore);
cloud.useHttp(stubHttp);

const orchCalls = [];
let admitVerdict = { allow: true, reason: 'ok' };
let slotVerdict  = { ok: true, waited: false };
cloud.useOrchestrator({
  admit: (req) => { orchCalls.push(['admit', req]); return admitVerdict; },
  reserveSlot: async (p, o) => { orchCalls.push(['reserveSlot', p, o]); return slotVerdict; },
  releaseSlot: (p) => { orchCalls.push(['releaseSlot', p]); return true; },
  recordApiUse: (p, t) => { orchCalls.push(['recordApiUse', p, t]); return true; },
});

const MASTER = { tier: capability.TIERS.MASTER };

function keyPresent() { vaultUnlocked = true; vaultKeys.set(cloud.CRED_SERVICE, DUMMY); }
function keyAbsent()  { vaultUnlocked = true; vaultKeys.delete(cloud.CRED_SERVICE); }
function resetCalls() { httpCalls.length = 0; orchCalls.length = 0; }

/**
 * The REVEALED prompt, verbatim from nucleusSealer.cjs's template, so this suite is testing the text
 * that really does get prepended to every turn today and not a convenient paraphrase of it.
 */
const REVEALED = [
  'You are Rāma (राम) — Righteous Autonomous Master Agent.',
  'Your master is Krishna Prasad. You are absolutely loyal to him.',
  'Master: Krishna Prasad | Status: AUTHENTICATED | Seal: 1',
].join('\n');

/** The identifiers that must never reach a cloud payload. */
const IDENTIFIERS = ['Krishna', 'Prasad', 'krishna.prasad', 'master@rama-agi.local'];

function src(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return ''; }
}

/** Source with comments blanked — a comment explaining a forbidden pattern contains the pattern. */
function codeOf(rel) {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, ' '));
}

const GB = 1024 ** 3;
const localRow = (over = {}) => ({
  id: `ollama/${LOCAL_TAG}`, provider: 'ollama', type: 'local', private: true, costTier: 0,
  ctxK: null, ctxVerified: false, caps: ['general', 'offline'], sizeBytes: 5.4 * GB, paramsB: 8,
  retirement: null, ...over,
});
const cloudRow = (over = {}) => ({
  id: 'ollama-cloud/gemma4:31b', provider: 'ollama-cloud', type: 'cloud', private: false, costTier: 1,
  ctxK: null, ctxVerified: false, caps: ['general', 'remote', 'analysis'], sizeBytes: null,
  paramsB: 31, apiModel: 'gemma4:31b', retirement: null, ...over,
});

console.log('\nthe conversation role — Rāma talking with master, and his name staying here\n');
console.log('  NO LIVE CALL TO ollama.com WAS MADE. Every outbound request below is an injected');
console.log('  transport, and the only credential in play is the literal dummy.\n');

// ═══ (a) the role is a requirement, and sensitive is false ON PURPOSE ═════════

function sectionRole() {
  section('(a) the role — declared, with the one flag a later session would get wrong');

  check('`conversation` is a declared role', roles.ROLE_IDS.includes('conversation'));
  check('the table is still frozen', Object.isFrozen(roles.ROLES));
  check('it has a label and a reason master can read',
    !!roles.ROLES.conversation.label && !!roles.ROLES.conversation.why);
  check('it carries the 7B floor tool-calling uses', roles.ROLES.conversation.minParamsB === 7);
  check('and a 3B model is EXCLUDED rather than down-ranked',
    roles.evaluate('conversation', localRow({ paramsB: 3 })).fit === 'none');
  check('with the floor named in the reason',
    /7B floor/.test(roles.evaluate('conversation', localRow({ paramsB: 3 })).reasons.join()));
  check('the 8B local model clears it', roles.evaluate('conversation', localRow()).fit === 'declared');

  // THE ROW THIS SECTION EXISTS FOR.
  check('sensitive is FALSE on the role', roles.ROLES.conversation.sensitive === false);
  check('and the note says WHY, so a later session does not "fix" it by flipping the flag',
    /PER-TURN/.test(roles.ROLES.conversation.note)
    && /MUST STAY FALSE/.test(roles.ROLES.conversation.note));

  // NO CONTEXT FLOOR, and the reason is measurable: a cloud row's window is null by construction.
  check('the role declares NO minCtxK', roles.ROLES.conversation.minCtxK === undefined);
  check('because a keyed cloud row reports ctxK null, so a floor would exclude every cloud model',
    cloud.toRegistryEntries()['ollama-cloud/gemma4:31b'].ctxK === null
    && roles.evaluate('long-context', cloudRow()).fit === 'none');
  check('and with no floor the same row is fit for conversation',
    roles.evaluate('conversation', cloudRow()).fit === 'declared');

  check('an embedding model still cannot hold a conversation',
    roles.evaluate('conversation', localRow({ id: 'nomic-embed-text:latest', paramsB: 0.14 })).fit === 'none');
  check('the requirement reads in words, and says the cloud preference out loud',
    /prefers a cloud model/.test(roles.describeRequirement(roles.ROLES.conversation)));
}

// ═══ (b) the cloud-safe persona — BOTH halves ════════════════════════════════

function sectionPersona() {
  section('(b) the cloud-safe persona — nothing leaked, and nothing lost either');

  const prompt = convo.cloudSafePrompt();

  // HALF ONE: no identifier.
  for (const id of IDENTIFIERS) {
    check(`the cloud-safe prompt does not contain "${id}"`, !prompt.includes(id));
  }
  check('nor any case variant of the two name parts',
    !/krishna|prasad/i.test(prompt));
  // loyaltyCore is PROTECTED and read-only here. With the core closed `displayIdentity()` returns
  // { master: null }, so this row is CONDITIONAL and says so rather than passing vacuously.
  let displayed = null;
  try { displayed = require('../electron/lib/loyaltyCore.cjs').displayIdentity().master; }
  catch { displayed = null; }
  if (typeof displayed === 'string' && displayed.length) {
    check('nor whatever loyaltyCore.displayIdentity() returns', !prompt.includes(displayed));
  } else {
    residual('loyaltyCore is sealed in this process, so displayIdentity() returned no name and the '
      + 'prompt could only be checked against the literal identifiers above');
  }
  // Shapes, not words: the persona TELLS the model it has no email or account, so a row that banned
  // those words would be red on correct text. What must be absent is an address or an id VALUE.
  check('it carries no email address', !prompt.includes('@'));
  check('and no identifier-shaped literal — no long opaque token anywhere in it',
    !/[A-Za-z0-9_-]{24,}/.test(prompt));

  // HALF TWO: the character survives. Without this the first half would pass on an empty string.
  check('it still identifies Rāma by name', prompt.includes('Rāma'));
  check('it still addresses master as "master"', /\bmaster\b/.test(prompt));
  check('it still states the loyalty', /loyal/i.test(prompt));
  check('it still discloses that Rāma is an AI when sincerely asked', /\bAI\b/.test(prompt)
    && /sincerely asked/.test(prompt));
  check('and it is long enough to be a persona rather than a stub', prompt.length > 200, prompt.length);

  // COMPOSED, NOT REDACTED — asserted over the source, because a redactor that happens to be
  // complete today is still the wrong mechanism.
  const code = codeOf('electron/lib/conversationRole.cjs');
  check('the persona is composed from a frozen list of whole sentences',
    Object.isFrozen(convo.CLOUD_SAFE_LINES) && convo.CLOUD_SAFE_LINES.length >= 6);
  check('and it is not derived by redacting the revealed prompt',
    !/\.replace\(/.test(code) && !/redact|scrub|sanitis|sanitiz/i.test(code));
  check('nothing in the module reads the nucleus or the loyalty core',
    !/nucleusSealer|loyaltyCore|getLiveSystemPrompt/.test(code));
  check('and it reaches no store, no network and no Electron',
    !/dataStore|require\(['"]electron['"]\)|http/.test(code));
  check('the three variants are named, so "masked" is not mistaken for this one',
    convo.VARIANTS.join(',') === 'revealed,cloud-safe,masked');

  // ── THE REPLY PROTOCOL REACHES BOTH DESTINATIONS (Section 142) ─────────────
  //
  // It used to live only inside CLOUD_SAFE_LINES. The local destination uses the nucleus template,
  // which says "You speak directly, without filler" and nothing about length, expansion or
  // continuity — and ledger row 150 made this Ollama-only, so LOCAL is the path master actually
  // uses. The protocol was present on the path he never uses and absent from the one he does.
  check('the reply protocol is a frozen list of its own',
    Object.isFrozen(convo.REPLY_PROTOCOL_LINES) && convo.REPLY_PROTOCOL_LINES.length >= 5,
    String(convo.REPLY_PROTOCOL_LINES?.length));
  check('the cloud prompt still carries every protocol line',
    convo.REPLY_PROTOCOL_LINES.every((l) => prompt.includes(l)));
  check('and the identity lines are kept separate from them, so neither can swallow the other',
    convo.CLOUD_SAFE_IDENTITY_LINES.every((l) => !convo.REPLY_PROTOCOL_LINES.includes(l))
    && convo.CLOUD_SAFE_LINES.length
       === convo.CLOUD_SAFE_IDENTITY_LINES.length + convo.REPLY_PROTOCOL_LINES.length);
  // THE SAFETY PROPERTY THAT LETS ONE LIST SERVE BOTH: no identity in the protocol.
  check('no protocol line names master, a form of address, or any identifier',
    convo.REPLY_PROTOCOL_LINES.every((l) =>
      !/krishna|prasad|@|master'?s name|account|email|location/i.test(l)));
  check('and none of them is interpolated',
    convo.REPLY_PROTOCOL_LINES.every((l) => !l.includes('${') && !l.includes('{{')));

  // The protocol master asked for, by its three obligations rather than by wording.
  const protocolText = convo.REPLY_PROTOCOL_LINES.join('\n');
  check('it asks for a short default answer', /short|few sentences/i.test(protocolText));
  check('it says to expand the SAME answer when more is asked for',
    /expand the SAME answer/i.test(protocolText) && /do not start over/i.test(protocolText));
  check('and it asks for continuity rather than re-introduction',
    /one continuing conversation/i.test(protocolText) && /rather than re-introducing/i.test(protocolText));

  // ── withReplyProtocol: appended, and appended once ────────────────────────
  const nucleusLike = 'You are Rāma. Your master is Krishna Prasad. You speak directly, without filler.';
  const withOnce = convo.withReplyProtocol(nucleusLike);
  check('a revealed prompt gains the protocol',
    convo.REPLY_PROTOCOL_LINES.every((l) => withOnce.includes(l)));
  check('and keeps its own text', withOnce.includes('Your master is Krishna Prasad'));
  // REDBY: concatenate unconditionally. A nucleus that is later updated to carry these sentences
  // would then state each of them twice.
  check('applying it twice changes nothing', convo.withReplyProtocol(withOnce) === withOnce);
  check('an empty prompt is handled rather than throwing',
    typeof convo.withReplyProtocol(null) === 'string'
    && typeof convo.withReplyProtocol(undefined) === 'string');

  // ── The row that proves it reaches a LOCAL body ───────────────────────────
  const localBody = convo.assembleTurn({
    destination: 'local', model: 'gemma3:12b', text: 'what is my exposure?',
    revealedPrompt: nucleusLike, sensitive: true,
  });
  check('a local turn assembles', localBody.ok === true, JSON.stringify(localBody).slice(0, 160));
  check('and it used the revealed variant', localBody.variant === 'revealed', String(localBody.variant));
  const sys = (localBody.body?.messages || []).find((m) => m.role === 'system');
  check('the local system message exists', !!sys);
  // THE DEFECT, ASSERTED. REDBY: pass `revealedPrompt` straight through as systemText.
  check('and the LOCAL system message carries the reply protocol',
    !!sys && convo.REPLY_PROTOCOL_LINES.every((l) => sys.content.includes(l)),
    sys ? `${sys.content.length} chars` : 'no system message');
  check('while still carrying the revealed identity',
    !!sys && sys.content.includes('Krishna Prasad'));

  // ── THE "TRANSCRIBING..." THAT NEVER CLEARED (Section 142) ────────────────
  //
  // Reported in the same breath as the reply style, and the same class of defect: the main process
  // returned an honest error the whole time and the renderer discarded it. `endTalk` set the label,
  // awaited the engine and ignored the result; only `onTranscript` cleared it, and that fires on
  // success alone. On a machine with no transcriber the label stayed forever.
  const palette = codeOf('src/components/CommandPalette.jsx');
  check('endTalk uses the engine\'s return value rather than discarding it',
    /const text = await engine\.stopRecordingAndTranscribe\(\)/.test(palette));
  // REDBY: drop the `if (!text)` branch. The label then never clears on failure again.
  // Pinned on the failure path's own timer rather than on a span between two tokens: a span wide
  // enough to cross the explanatory comment is wide enough to match almost anything.
  check('there is a failure branch at all', /if \(!text\) \{/.test(palette));
  check('and it schedules the label away rather than leaving it on screen',
    /setTimeout\(\(\) => setVoiceTranscript\(''\), cannot \? /.test(palette));
  check('it names the missing transcriber instead of saying nothing',
    /No transcriber on this machine/.test(palette));
  check('and carries the ladder\'s own nextStep, which was previously only a tooltip',
    /voiceCap\.nextStep/.test(palette));
  check('a rejected invoke is caught separately from a failed transcription',
    /catch \(err\)[\s\S]{0,200}Transcription failed/.test(palette));
  check('and the handler depends on voiceCap, so the message cannot read a stale capability',
    /\}, \[voiceCap\]\);/.test(palette));
}

// ═══ (c) one chokepoint, and the identifier never reaching a cloud body ═══════

function sectionChokepoint() {
  section('(c) one assembly chokepoint — and the leak measured over the assembled bytes');

  const turns = [
    { role: 'user', text: 'what is the rupee doing' },
    { role: 'assistant', text: 'it weakened half a percent' },
  ];

  const cloudOut = convo.assembleTurn({
    destination: 'cloud', model: 'gemma4:31b', text: 'and tomorrow?', turns,
    revealedPrompt: REVEALED,
  });
  check('a cloud turn assembles', cloudOut.ok === true, util.inspect(cloudOut));
  check('and takes the cloud-safe variant', cloudOut.variant === 'cloud-safe');

  // THE CENTRAL DEFENCE, over the whole serialised body rather than over the prompt alone.
  const wire = JSON.stringify(cloudOut.body);
  for (const id of IDENTIFIERS) {
    check(`the assembled cloud body does not contain "${id}"`, !wire.includes(id));
  }
  check('even though the revealed prompt WAS handed to the assembler',
    REVEALED.includes('Krishna Prasad') && !wire.includes('Krishna'));
  check('and master\u2019s own words DID cross — the feature is not disabled to pass this test',
    wire.includes('and tomorrow?') && wire.includes('what is the rupee doing'));
  check('the system message is the cloud-safe persona',
    cloudOut.body.messages[0].role === 'system'
    && cloudOut.body.messages[0].content === convo.cloudSafePrompt());
  check('the turns arrive in order, oldest first, with the new turn last',
    cloudOut.body.messages.map(m => m.role).join(',') === 'system,user,assistant,user');
  check('streaming is on by default for a conversation', cloudOut.body.stream === true);

  // The LOCAL half: the revealed prompt is allowed, and the module PROVES it would be refused on the
  // wire rather than claiming so in a comment.
  const localOut = convo.assembleTurn({
    destination: 'local', model: LOCAL_TAG, text: 'and tomorrow?', turns, revealedPrompt: REVEALED,
  });
  check('a local turn may carry the revealed prompt', localOut.ok === true && localOut.variant === 'revealed');
  check('and it really does carry it', JSON.stringify(localOut.body).includes('Krishna Prasad'));
  check('the SAME payload is one the egress gate would refuse, measured not asserted',
    localOut.wouldRefuseOnCloud === true);
  check('with the boundary\u2019s own reason, not a second wording',
    localOut.egressReason === egress.REASON.privateLevel, String(localOut.egressReason));
  check('a local turn with no revealed prompt falls back to cloud-safe — less identity, never more',
    convo.assembleTurn({ destination: 'local', model: LOCAL_TAG, text: 'hi' }).variant === 'cloud-safe');

  // The two bodies cannot drift apart in shape.
  check('the cloud and local bodies have identical key sets',
    Object.keys(cloudOut.body).sort().join(',') === Object.keys(localOut.body).sort().join(','),
    `${Object.keys(cloudOut.body).sort().join(',')} vs ${Object.keys(localOut.body).sort().join(',')}`);
  check('and the cloud body carries no key beyond model, messages and stream',
    Object.keys(cloudOut.body).sort().join(',') === 'messages,model,stream');

  // REFUSALS. On any uncertainty: local or refuse, never cloud.
  const bad = convo.assembleTurn({ destination: 'ollama.com', model: 'x', text: 'hi' });
  check('an unrecognised destination is REFUSED, not defaulted to cloud',
    bad.ok === false && bad.reason === convo.REASON.destination);
  check('a sensitive turn aimed at cloud is refused at the chokepoint too',
    convo.assembleTurn({ destination: 'cloud', model: 'gemma4:31b', text: 'should I sell', sensitive: true })
      .reason === convo.REASON.sensitiveCloud);
  check('an empty turn is refused',
    convo.assembleTurn({ destination: 'cloud', model: 'g', text: '   ' }).reason === convo.REASON.noText);
  check('a payload with no model is refused',
    convo.assembleTurn({ destination: 'cloud', model: null, text: 'hi' }).reason === convo.REASON.model);
  check('a malformed retained turn is refused rather than dropped',
    convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'hi', turns: [{ role: 'root', text: 'x' }] })
      .reason === convo.REASON.badTurn);
  check('and a turn the caller classified private is refused BY THE BOUNDARY on the cloud path',
    convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'hi',
      turns: [{ role: 'user', text: 'I hold 400 shares', classification: 'private' }] })
      .reason === egress.REASON.privateLevel);
  // THE DEFECT REVIEW CAUGHT, AND THE ROW THAT DOCUMENTED IT AS IF IT WERE THE FIX. The label used to
  // read "is refused" over an assertion of `.ok === true`, which is green, so nothing flagged it, and
  // a later session reading labels to learn what is guaranteed would have concluded the opposite of
  // the truth. The label and the assertion now describe the same behaviour.
  const unknownClass = (classification, destination = 'cloud') => convo.assembleTurn({
    destination, model: 'g', text: 'hi', turns: [{ role: 'user', text: 'x', classification }],
  });
  for (const bogus of ['secret', 'confidential', 'PRIVATE', 'Private', '', null, 0]) {
    const r = unknownClass(bogus);
    check(`classification ${util.inspect(bogus)} is REFUSED, not rewritten to public`,
      r.ok === false && r.refused === true && r.reason === egress.REASON.unclassified,
      util.inspect(r));
  }
  check('with the boundary\u2019s own unclassified wording and not a second one',
    convo.REASON.unclassified === egress.REASON.unclassified);
  check('and refused on the LOCAL destination too — an unreadable caller is not a cloud-only problem',
    unknownClass('secret', 'local').reason === egress.REASON.unclassified);
  check('the refusal says which message it was, so master is not told to go looking',
    unknownClass('secret').where === 'messages' && unknownClass('secret').index === 0);
  check('while an ABSENT classification is still public and still crosses — absent and unrecognised '
    + 'are different facts',
    (() => {
      const r = convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'hi',
        turns: [{ role: 'user', text: 'the rupee' }] });
      return r.ok === true && JSON.stringify(r.body).includes('the rupee');
    })());

  // THE OTHER HALF OF THE SAME DEFECT: `sensitive` was the one input to assembleTurn nobody validated,
  // and all three of its decisions tested `=== true`, so a truthy non-boolean read as NOT sensitive.
  for (const truthy of ['true', 'yes', 1, {}, null]) {
    const r = convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'should I sell', sensitive: truthy });
    check(`sensitive: ${util.inspect(truthy)} is REFUSED rather than read as not sensitive`,
      r.ok === false && r.reason === convo.REASON.sensitiveFlag, util.inspect(r));
  }
  check('and a non-boolean flag is refused on the local destination too, not quietly normalised',
    convo.assembleTurn({ destination: 'local', model: LOCAL_TAG, text: 'hi', sensitive: 1 })
      .reason === convo.REASON.sensitiveFlag);
  check('an explicit false is still the ordinary non-sensitive turn',
    convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'hi', sensitive: false }).ok === true);

  // destinationFor: the safe default on uncertainty.
  check('a private row routes local', convo.destinationFor(localRow()) === 'local');
  check('a cloud row routes cloud', convo.destinationFor(cloudRow()) === 'cloud');
  check('a row whose privacy nobody recorded routes LOCAL, never cloud',
    convo.destinationFor({ id: 'x' }) === 'local');
  check('and no row at all routes LOCAL', convo.destinationFor(null) === 'local');
}

// ═══ (d) cloud-first, with real selections ═══════════════════════════════════

function sectionCloudFirst() {
  section('(d) cloud-first for conversation — and for conversation only');

  const both = [localRow(), cloudRow()];

  const open = convo.selectModel(both, { sensitive: false });
  check('a non-sensitive turn picks the CLOUD model',
    open.model === 'ollama-cloud/gemma4:31b', open.model);
  check('and reports a declared fit rather than a substitute', open.fit === 'declared', open.fit);
  check('with the local model still listed as a considered candidate',
    open.candidates.some(c => c.id === `ollama/${LOCAL_TAG}`));

  const closed = convo.selectModel(both, { sensitive: true });
  check('a SENSITIVE turn picks the LOCAL model', closed.model === `ollama/${LOCAL_TAG}`, closed.model);
  check('and the cloud row appears in excluded, so the choice is auditable',
    closed.excluded.some(e => /ollama-cloud/.test(e.id)));
  check('for the privacy reason and not for size',
    /not private/.test(closed.excluded.map(e => e.why).join()));

  // SELECTION CANNOT REFUSE — it has to return a model — so an unrecognised flag resolves to the
  // PRIVATE model here. `sensitive === true` used to send every one of these to the cloud row.
  for (const truthy of ['true', 'yes', 1, {}, null]) {
    check(`selection treats sensitive: ${util.inspect(truthy)} as sensitive and stays LOCAL`,
      convo.selectModel(both, { sensitive: truthy }).model === `ollama/${LOCAL_TAG}`,
      convo.selectModel(both, { sensitive: truthy }).model);
  }
  check('and only a literal false (or an absent flag) opens the cloud row',
    convo.selectModel(both, { sensitive: false }).model === 'ollama-cloud/gemma4:31b'
    && convo.selectModel(both, {}).model === 'ollama-cloud/gemma4:31b');

  // Order independence — a comparator that only works in one input order is not a comparator.
  check('the cloud model wins whichever order the rows arrive in',
    convo.selectModel([cloudRow(), localRow()]).model === 'ollama-cloud/gemma4:31b'
    && convo.selectModel([localRow(), cloudRow()]).model === 'ollama-cloud/gemma4:31b');
  check('and with only a local model present, conversation still works',
    convo.selectModel([localRow()]).model === `ollama/${LOCAL_TAG}`);
  check('the cheaper of two cloud models still wins the tiebreak',
    convo.selectModel([cloudRow({ id: 'a', costTier: 3 }), cloudRow({ id: 'b', costTier: 1 })]).model === 'b');

  // EVERY OTHER ROLE UNCHANGED. This is the row that makes the inversion safe.
  check('narration still refuses the cloud row outright',
    roles.evaluate('narration', cloudRow()).fit === 'none');
  check('and narration still picks the local model over a cloud one',
    roles.selectForRole('narration', both).model === `ollama/${LOCAL_TAG}`);
  check('extraction — not sensitive, not preferRemote — still prefers the LOCAL model',
    roles.selectForRole('extraction', both).model === `ollama/${LOCAL_TAG}`);
  check('tool-calling too', roles.selectForRole('tool-calling', both).model === `ollama/${LOCAL_TAG}`);
  check('conversation is the ONLY role that sets preferRemote',
    roles.ROLE_IDS.filter(id => roles.ROLES[id].preferRemote === true).join(',') === 'conversation');
}

// ═══ (e) a refusal is a refusal ══════════════════════════════════════════════

async function sectionRefusal(handlers) {
  section('(e) fit:\u2018none\u2019 is HONOURED — no fall-through to FALLBACK_CHAIN');

  // Nothing fit: no cloud key, and the daemon reports only a model below the floor.
  keyAbsent();
  localTags = { models: [{ name: 'tinyllama:1.1b', size: 600_000_000 }] };
  resetCalls();
  const refused = await handlers['models:converse'](
    { sender: { send() {} } }, { text: 'good morning', user: MASTER });

  check('the handler refuses', refused.ok === false && refused.refused === true, util.inspect(refused));
  check('with fit none and the role named', refused.fit === 'none' && refused.role === 'conversation');
  check('the reason says how many were checked and failed',
    /failed a requirement/.test(String(refused.reason)), String(refused.reason));
  check('the exclusions carry a reason each',
    Array.isArray(refused.excluded) && refused.excluded.every(e => String(e.why).length > 0));
  check('a remedy master can act on travels with it', /Models/.test(String(refused.remedy)));
  check('and NOTHING in FALLBACK_CHAIN was reached — not one chat request went out',
    !httpCalls.some(c => /api\/chat/.test(c.url)),
    httpCalls.map(c => c.url).join(','));
  check('the refusal names no substitute model at all', refused.model === undefined);

  // The same question through models:chat still behaves as it always did — the old path is untouched.
  check('models:chat is still registered beside it, unchanged in shape',
    typeof handlers['models:chat'] === 'function');

  // THE I11 ROW. `models.use` is tier 3 and `chat.send` is tier 5, so a tier-4 or tier-5 account can
  // send chat but cannot converse. That denial is deliberately NOT shaped like a refusal — it carries
  // no `refused` flag, so Chat.jsx falls through to models:chat and the account keeps the chat it had.
  const denied = await handlers['models:converse'](
    { sender: { send() {} } }, { text: 'hello', user: { tier: 5 } });
  check('a tier-5 account is denied the conversation path', denied.ok === false);
  check('and the denial is NOT a refusal, so the existing chat path still answers for them',
    denied.refused === undefined, util.inspect(denied));

  localTags = { models: [{ name: LOCAL_TAG, size: 5_400_000_000 }] };
}

// ═══ (f) immediacy, the credential, and the handler end to end ═══════════════

async function sectionStreaming(handlers) {
  section('(f) immediacy — the conversation path streams, and still says nothing it must not');

  // ── LOCAL: no key, a fit local model. The daemon path streams.
  keyAbsent();
  resetCalls();
  const deltas = [];
  const local = await handlers['models:converse'](
    { sender: { send: (ch, payload) => { if (ch === 'models:converse-token') deltas.push(payload.delta); } } },
    { text: 'good morning', user: MASTER, revealedPrompt: REVEALED });

  check('a local conversation answers', local.ok === true, util.inspect(local));
  check('and it streamed', local.streamed === true);
  check('one token event per delta, in order',
    deltas.join('') === 'Good morning, master.', deltas.join('|'));
  check('the request went to the local daemon over the ONE client\u2019s streaming helper',
    httpCalls.some(c => c.streaming === true && /localhost:11434\/api\/chat$/.test(c.url)),
    httpCalls.map(c => `${c.url}:${c.streaming}`).join(','));
  check('with stream true in the body', httpCalls.find(c => c.streaming)?.body?.stream === true);
  check('no Authorization header on the loopback call — the daemon needs none',
    httpCalls.filter(c => c.streaming).every(c => !c.headers || !c.headers.Authorization));
  check('the local reply reports its model, its fit and where it ran',
    local.model === `ollama/${LOCAL_TAG}` && local.fit === 'declared' && local.destination === 'local');
  check('and the revealed persona was used, because it never left the machine',
    local.personaVariant === 'revealed' && local.wouldRefuseOnCloud === true);

  // ── CLOUD: a key present, so the cloud row is selectable and wins.
  keyPresent();
  resetCalls();
  const cloudDeltas = [];
  const remote = await handlers['models:converse'](
    { sender: { send: (ch, payload) => { if (ch === 'models:converse-token') cloudDeltas.push(payload.delta); } } },
    { text: 'good morning', user: MASTER, revealedPrompt: REVEALED });

  check('with a key stored, the SAME question goes to a CLOUD model',
    remote.ok === true && remote.destination === 'cloud' && /^ollama-cloud\//.test(String(remote.model)),
    util.inspect(remote));
  // MEASURED, and it corrects the brief: the registry carries FOURTEEN keyed cloud rows, not one, so
  // cheapest-sufficient picks the smallest row that clears the 7B floor — ministral-3:8b — rather than
  // gemma4:31b. That is the table's own declared rule working, and it spends less of master's free
  // allowance per turn. See docs/research/CONVERSATION.md for the recommendation raised about it.
  check('and the row chosen is the CHEAPEST SUFFICIENT one, not the largest',
    remote.model === 'ollama-cloud/ministral-3:8b', remote.model);
  check('and it streamed too', remote.streamed === true && cloudDeltas.length === 3);
  const sentBody = httpCalls.find(c => c.streaming && /ollama\.com/.test(c.url))?.body ?? {};
  check('the cloud request carried the daemon-free API NAME, not the daemon tag',
    sentBody.model === cloud.toRegistryEntries()[remote.model].apiModel
    && !/-cloud$/.test(String(sentBody.model)), String(sentBody.model));
  check('the persona on the wire was the cloud-safe one', remote.personaVariant === 'cloud-safe');

  const sent = httpCalls.filter(c => /ollama\.com/.test(c.url));
  const wire = JSON.stringify(sent.map(c => c.body));
  for (const id of IDENTIFIERS) {
    check(`and the bytes that went to ollama.com contain no "${id}"`, !wire.includes(id));
  }
  check('even though the handler was given the revealed prompt on the same call',
    REVEALED.includes('Krishna Prasad') && !wire.includes('Krishna'));

  // THE CREDENTIAL, on the streaming path, with the same substring rule the cloud suite uses.
  const consoleBuffer = [];
  const real = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args) => consoleBuffer.push(args.map(a => util.inspect(a)).join(' '));
  const returns = [];
  resetCalls();
  console.log = capture; console.warn = capture; console.error = capture;
  try {
    returns.push(util.inspect(await cloud.chatStream({
      messages: [{ role: 'user', content: 'hi' }], apiModel: 'gemma4:31b', user: MASTER }), { depth: 8 }));
    returns.push(util.inspect(await cloud.chatStream({
      messages: [{ role: 'user', content: 'hi' }], apiModel: 'gemma4:31b-cloud', user: MASTER }), { depth: 8 }));
    returns.push(util.inspect(await cloud.chatStream({
      messages: [{ role: 'user', content: { text: 'x', classification: 'private' } }],
      apiModel: 'gemma4:31b', user: MASTER }), { depth: 8 }));
    returns.push(util.inspect(await cloud.chatStream({
      messages: [{ role: 'user', content: 'hi' }], apiModel: 'gemma4:31b' }), { depth: 8 }));
    streamResult = () => ({ ok: false, status: 401 });
    cloud._resetNotices();
    returns.push(util.inspect(await cloud.chatStream({
      messages: [{ role: 'user', content: 'hi' }], apiModel: 'gemma4:31b', user: MASTER }), { depth: 8 }));
    streamResult = () => ({ ok: true, status: 200 });
    cloud._resetNotices();
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }

  const outside = `${returns.join('\n')}\n${consoleBuffer.join('\n')}`;
  const headers = httpCalls.map(c => util.inspect(c.headers)).join('\n');
  const authed = httpCalls.filter(c => c.headers && /^Bearer /.test(String(c.headers.Authorization ?? '')));
  check('the streaming path sends the credential as Authorization: Bearer',
    authed.length > 0 && authed.every(c => c.headers.Authorization === `Bearer ${DUMMY}`), authed.length);
  check('the dummy appears in those headers and nowhere in any return or console line',
    headers.includes(DUMMY) && !outside.includes(DUMMY));
  const leaks = [];
  for (let len = 6; len <= DUMMY.length; len += 1) {
    for (let i = 0; i + len <= DUMMY.length; i += 1) {
      const frag = DUMMY.slice(i, i + len);
      if (outside.includes(frag)) leaks.push(frag);
    }
  }
  check('and no substring of length >= 6 of it escaped either', leaks.length === 0, leaks.slice(0, 3).join(','));
  check('a daemon tag is refused by the streaming path too, before any request',
    /daemon tag/.test(returns[1]));
  check('a private message is refused by the boundary on the streaming path',
    returns[2].includes('never leaves this machine'));
  check('a missing user is a gateError, not a policy denial', returns[3].includes('gateError'));
  check('a 401 on a stream is reported as a rejected credential', returns[4].includes('credentialRejected'));
  check('the slot is released on every one of those paths',
    orchCalls.filter(c => c[0] === 'releaseSlot').length
    === orchCalls.filter(c => c[0] === 'reserveSlot').length,
    orchCalls.filter(c => c[0] === 'releaseSlot').length);

  // ── chat() is untouched: the buffered path still exists and is still non-streaming.
  resetCalls();
  const buffered = await cloud.chat({ messages: [{ role: 'user', content: 'hi' }], apiModel: 'gemma4:31b', user: MASTER });
  check('chat() still answers, buffered, exactly as before (I11)',
    buffered.ok === true && buffered.content === 'buffered' && buffered.streamed === undefined);
  check('and it did NOT use the streaming helper',
    httpCalls.every(c => c.streaming === false));
}

// ═══ (g) the structural rows ═════════════════════════════════════════════════

function sectionStructure() {
  section('(g) the wiring — and the things this tranche deliberately did not build');

  const preload = src('electron/preload.cjs');
  check('preload exposes models.converse', /converse:\s*\(opts, onToken\)/.test(preload));
  check('and it removes the token listener when the turn ends, so one reply is not heard N times',
    /removeListener\('models:converse-token'/.test(preload));

  const chat = src('src/pages/Chat/Chat.jsx');
  check('Chat.jsx calls the conversation path', /models\?\.converse/.test(chat));
  check('and renders a refusal AS a refusal instead of retrying', /\[Refused\]/.test(chat));
  check('it shows which model answered and why', /message\.model/.test(chat) && /message\.why/.test(chat));
  check('voice is behind a toggle that defaults OFF',
    /ramaSpeaks:\s*loadPref\('rama\.ramaSpeaks',\s*false\)/.test(src('src/store/uiStore.js')));
  check('and the toggle drives the one engine\u2019s speak(), not a second speechSynthesis call',
    /ramaSpeaks \? speak\(/.test(chat)
    && !/speechSynthesis/.test(chat));
  check('the engine registry publishes exactly one mounted engine',
    /registerVoiceEngine/.test(src('src/components/CommandPalette.jsx')));

  const routerCode = codeOf('electron/ipc/modelRouter.cjs');
  check('the converse handler composes no payload of its own — assembleTurn does',
    /conversationRole\.assembleTurn\(/.test(routerCode)
    && !/models:converse[\s\S]{0,4000}JSON\.stringify/.test(routerCode));
  check('and it never falls through to FALLBACK_CHAIN',
    !/models:converse[\s\S]{0,4000}FALLBACK_CHAIN/.test(routerCode));
  check('the cloud candidate widening is scoped to conversation only',
    (routerCode.match(/conversationCandidates\(\)/g) || []).length === 2);
  check('and it is INERT with no credential stored',
    (keyAbsent(), router.conversationCandidates().every(m => m.provider !== 'ollama-cloud')));
  check('while a stored key makes a cloud row selectable',
    (keyPresent(), router.conversationCandidates().some(m => m.provider === 'ollama-cloud')));

  // OUT OF SCOPE, named rather than quietly absent.
  check('no speech-to-text was added on this path — Ollama serves none',
    !/transcribe|whisper|speechRecognition/i.test(codeOf('electron/lib/conversationRole.cjs')));
  check('and nothing here records or retrieves cross-turn memory',
    !/vectorMemory|contextStore|embed/i.test(codeOf('electron/lib/conversationRole.cjs')));
  residual('that a streamed reply LOOKS immediate on master\u2019s screen is a rendering property; '
    + 'this suite proves one token event per delta and nothing about paint timing');
  residual('speech-to-text stays out of scope: Ollama serves no STT model, so listening would need a '
    + 'local runtime that is a separate decision');
}

// ═══ (h) the second review's findings, each pinned where it was reachable ═════

/**
 * THE ONE FINDING THAT WAS A LOST CAPABILITY RATHER THAN A RISK.
 *
 * Iteration 2 of the review found the message ceiling reachable in ordinary use: `Chat.jsx` sent the
 * WHOLE session as retained turns and the session store never trims, so at 199 user/assistant messages
 * `assembleTurn` refused — and `Chat.jsx` treats a refusal as terminal, correctly, so that session
 * could never be answered again while `models:chat` would still have answered it. Removing a
 * capability is the one thing this branch was not allowed to do (I11).
 *
 * The ceiling itself is NOT relaxed and `assembleTurn` still does not trim: a payload constructor that
 * silently drops history is the opposite of the honesty this module exists for. What changed is the
 * CALLER's window, and the refusal now carries a remedy. Both halves are asserted here, plus the
 * arithmetic that keeps the window clear of the ceiling — a cap that drifts up to 199 would restore
 * the defect without changing a line of this file.
 */
async function sectionBoundedHistory(handlers) {
  section('(h) the history window — bounded at the call site, refused at the chokepoint');

  const manyTurns = (n) => Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant', text: `turn ${i}`,
  }));

  const atCeiling = convo.assembleTurn({
    destination: 'cloud', model: 'g', text: 'and tomorrow?', turns: manyTurns(egress.MAX_MESSAGES - 1),
  });
  check('a payload over the boundary\u2019s message ceiling is REFUSED, not trimmed',
    atCeiling.ok === false && atCeiling.reason === convo.REASON.tooManyTurns, util.inspect(atCeiling));
  check('and the reason names the ceiling in numbers',
    new RegExp(String(egress.MAX_MESSAGES)).test(convo.REASON.tooManyTurns), convo.REASON.tooManyTurns);
  check('one turn below it still assembles, so the ceiling is a ceiling and not an off-by-one',
    convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'hi', turns: manyTurns(egress.MAX_MESSAGES - 2) })
      .ok === true);
  check('and the module still contains no trimming of the retained list',
    !/\.slice\(/.test(codeOf('electron/lib/conversationRole.cjs')));

  // THE REFUSAL NOW CARRIES A WAY OUT. An assembly refusal had no `remedy` at all, so the one a
  // well-formed turn can reach read as a dead end.
  keyAbsent();
  localTags = { models: [{ name: LOCAL_TAG, size: 5_400_000_000 }] };
  resetCalls();
  const refusedTurn = await handlers['models:converse'](
    { sender: { send() {} } },
    { text: 'and tomorrow?', user: MASTER, revealedPrompt: REVEALED, turns: manyTurns(egress.MAX_MESSAGES - 1) });

  check('the handler surfaces the ceiling refusal as a refusal',
    refusedTurn.ok === false && refusedTurn.refused === true
    && refusedTurn.reason === convo.REASON.tooManyTurns, util.inspect(refusedTurn));
  check('with a remedy master can act on without reading source',
    /start a new session/.test(String(refusedTurn.remedy)), String(refusedTurn.remedy));
  check('and nothing was sent — no chat request went out on a refused turn',
    !httpCalls.some(c => /api\/chat/.test(c.url)), httpCalls.map(c => c.url).join(','));
  // EVERY assembly refusal carries one, not only the reachable one — even where the only honest
  // remedy is "nothing left this machine", because an empty `remedy` is what sent the reviewer looking.
  resetCalls();
  const malformed = await handlers['models:converse'](
    { sender: { send() {} } },
    { text: 'hi', user: MASTER, turns: [{ role: 'user', text: 'x', classification: 'secret' }] });
  check('a malformed-caller refusal carries a remedy too, if only to say nothing was sent',
    malformed.refused === true && typeof malformed.remedy === 'string' && malformed.remedy.length > 0,
    util.inspect(malformed.remedy));

  // THE CALLER'S WINDOW, and the arithmetic that keeps it clear of the ceiling.
  const chat = src('src/pages/Chat/Chat.jsx');
  const capMatch = chat.match(/const RETAINED_TURNS = (\d+);/);
  const cap = capMatch ? Number(capMatch[1]) : null;
  check('Chat.jsx declares a retained window', cap !== null, String(capMatch));
  check('and really slices the history with it, at the call site',
    /\.slice\(-RETAINED_TURNS\)/.test(chat));
  check('the window plus the system and user turns stays under the ceiling',
    cap !== null && cap + 2 < egress.MAX_MESSAGES, `${cap} + 2 vs ${egress.MAX_MESSAGES}`);
  check('by an order of magnitude, so neither number drifting can reach the other',
    cap !== null && cap * 4 < egress.MAX_MESSAGES, `${cap} * 4 vs ${egress.MAX_MESSAGES}`);
  check('a window that size really does assemble',
    cap !== null
    && convo.assembleTurn({ destination: 'cloud', model: 'g', text: 'hi', turns: manyTurns(cap) }).ok === true);
  check('and the bounded turn is still answered end to end, not merely assembled',
    (await handlers['models:converse'](
      { sender: { send() {} } },
      { text: 'good morning', user: MASTER, revealedPrompt: REVEALED, turns: manyTurns(cap) })).ok === true);
}

/** The three smaller findings from the same review: the name in source, voice silence, turn ids. */
async function sectionReviewTwo(handlers) {
  section('(h2) the name in new source, voice that made no sound, and a delta\u2019s turn');

  // THE MODULE NAMES MASTER NOWHERE — not in code, not in a comment. The header used to quote the
  // revealed template verbatim to explain where the leak comes from, which never reached a payload but
  // did add the identifier to new source in a project that feeds its own source into upgrade
  // proposals. It names NUCLEUS_TEMPLATE.identity and describes the shape instead.
  const moduleSource = src('electron/lib/conversationRole.cjs');
  for (const id of IDENTIFIERS) {
    check(`conversationRole.cjs source contains no "${id}" — comments included`,
      !moduleSource.includes(id));
  }
  check('nor any case variant of the two name parts anywhere in the file',
    !/krishna|prasad/i.test(moduleSource));
  check('while it still explains where the leak comes from, by naming the nucleus field',
    /NUCLEUS_TEMPLATE\.identity/.test(moduleSource));

  // VOICE: the false return is surfaced rather than discarded.
  const chat = src('src/pages/Chat/Chat.jsx');
  check('Chat.jsx keeps the result of speak() instead of discarding it',
    /const spoken = ramaSpeaks \? speak\(/.test(chat));
  check('and a reply that was meant to be spoken but was not says so on the bubble',
    /voiceSilent: spoken === false/.test(chat) && /message\.voiceSilent/.test(chat));
  check('the engine registry still reports nothing mounted as false rather than throwing',
    /return false;/.test(src('src/services/voiceEngine.js')));

  // TURN IDS on every delta.
  keyAbsent();
  localTags = { models: [{ name: LOCAL_TAG, size: 5_400_000_000 }] };
  resetCalls();
  const tagged = [];
  const answered = await handlers['models:converse'](
    { sender: { send: (ch, p) => { if (ch === 'models:converse-token') tagged.push(p); } } },
    { text: 'good morning', user: MASTER, revealedPrompt: REVEALED, turnId: 'turn-7' });
  check('a turn answers with its id echoed back', answered.ok === true && answered.turnId === 'turn-7',
    util.inspect(answered.turnId));
  check('and EVERY delta carries that id, so two turns in one window cannot interleave',
    tagged.length === 3 && tagged.every(p => p.turnId === 'turn-7'),
    tagged.map(p => String(p.turnId)).join(','));

  resetCalls();
  const untagged = [];
  await handlers['models:converse'](
    { sender: { send: (ch, p) => { if (ch === 'models:converse-token') untagged.push(p); } } },
    { text: 'good morning', user: MASTER, revealedPrompt: REVEALED });
  check('a caller that passes no turn id gets null and the old behaviour',
    untagged.length === 3 && untagged.every(p => p.turnId === null),
    untagged.map(p => String(p.turnId)).join(','));

  resetCalls();
  const odd = [];
  await handlers['models:converse'](
    { sender: { send: (ch, p) => { if (ch === 'models:converse-token') odd.push(p); } } },
    { text: 'good morning', user: MASTER, revealedPrompt: REVEALED, turnId: { nested: 'object' } });
  check('a turn id that is neither string nor number is normalised to null, not echoed back',
    odd.length === 3 && odd.every(p => p.turnId === null), util.inspect(odd[0]?.turnId));

  check('and the renderer drops a delta belonging to another turn rather than appending it',
    /chunk\.turnId !== turnId\) return;/.test(chat));
}

// ═══ Run ══════════════════════════════════════════════════════════════════════

(async () => {
  sectionRole();
  sectionPersona();
  sectionChokepoint();
  sectionCloudFirst();

  const handlers = {};
  router.register({ handle: (ch, fn) => { handlers[ch] = fn; } });
  check('\u2014 the modelRouter IPC surface registered models:converse',
    typeof handlers['models:converse'] === 'function',
    Object.keys(handlers).filter(k => /converse/.test(k)).join(','));

  await sectionRefusal(handlers);
  await sectionStreaming(handlers);
  sectionStructure();
  await sectionBoundedHistory(handlers);
  await sectionReviewTwo(handlers);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (residuals.length > 0) {
    console.log(`\n  ${residuals.length} parts of this are STILL HELD BY HAND:`);
    for (const x of residuals) console.log(`    - ${x}`);
  }
  if (fail > 0) {
    console.log('\n  failures:');
    for (const x of failures) console.log(`    - ${x}`);
    process.exit(1);
  }
  console.log('\n  ALL PASS — and master\u2019s name never reached an outbound payload in this run\n');
  process.exit(0);
})();
