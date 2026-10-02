#!/usr/bin/env node
'use strict';

/**
 * verifyOllamaCloud.cjs — the keyed Ollama Cloud path, asserted instead of trusted.
 *
 * ── THE BEHAVIOUR WORTH DEFENDING ────────────────────────────────────────────────────────────────
 *
 * 1. THE CREDENTIAL IS NEVER SPOKEN. The centrepiece is BEHAVIOURAL, not structural, because no
 *    regex over source can prove a value never escapes: inject the dummy `test-not-a-real-key`,
 *    capture all three console channels, call every exported function across the success path and
 *    every failure row, and assert the dummy appears EXACTLY ONCE in the whole corpus — in the
 *    `Authorization` header the stub HTTP client received — and that no substring of length >= 6
 *    appears anywhere else, which is what catches a well-meant `key.slice(0, 8)` in a log line.
 *
 * 2. A CLOUD MODEL IS NOT PRIVATE, SO `narration` MUST STILL REFUSE IT. Six assertions, including
 *    an ANTI-VACUITY guard: `modelRoles.evaluate` refuses anything without `model.id` BEFORE the
 *    privacy gate, so a row that lost its `id` would refuse `narration` for an unrelated reason and
 *    the refusal assertions would still pass — green, and proving nothing. The inverse is asserted
 *    too: the same row IS fit for `reasoning`.
 *
 * 3. ABSENT IS NOT BROKEN, AND NEVER A SILENT FALLBACK. With no key, every entry point reports
 *    `unconfigured` with a remedy and the HTTP stub records ZERO calls.
 *
 * 4. THE FEATURE IS REACHABLE AT ALL. `selectModel`'s passes could not return a cloud id, so a
 *    cloud call resolved to `gpt-4o` and died. The reachability pair is asserted both ways.
 *
 * 5. NOTHING CLASSIFIED PRIVATE CROSSES THE EGRESS LINE — in `messages` as well as in `parts`, and
 *    for EVERY search backend rather than only the first one.
 *
 * ── HOW IT RUNS WITH NO NETWORK, NO ELECTRON AND NO node_modules ─────────────────────────────────
 *
 * `electron/ipc/credentialVault.cjs` requires `electron` at module scope, and modelRouter.cjs
 * DESTRUCTURES `getCredential` out of it at load time — a binding no injection seam can reach. So
 * the vault, the dataStore, the HTTP client and browserEngine are installed as REQUIRE-CACHE STUBS
 * BEFORE modelRouter is loaded. That is also why nothing here touches master's real vault file:
 * without the stub, `getVaultPath()` would mkdir under his home directory.
 *
 * Run: node scripts/verifyOllamaCloud.cjs    |    npm run verify:ollama-cloud
 */

const fs   = require('fs');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── The dummy credential. OBVIOUSLY not a real key, and it is the only key this suite ever sees.
const DUMMY = 'test-not-a-real-key';

// ─── Stubs, installed into the require cache BEFORE anything real is loaded ───

function cacheStub(relFromRoot, exports) {
  const filename = path.join(ROOT, relFromRoot);
  require.cache[filename] = {
    id: filename, filename, loaded: true, children: [], paths: [], exports,
  };
  return exports;
}

let vaultUnlocked = true;
const vaultKeys = new Map();          // service -> value

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

/** Every outbound call this suite would have made, recorded instead of sent. */
const httpCalls = [];
let httpReply = () => ({ ok: true, status: 200, body: '{}' });

const stubHttp = cacheStub('electron/lib/http.cjs', {
  post: async (url, body, opts = {}) => {
    httpCalls.push({ method: 'POST', url, body, headers: opts.headers ?? null, opts });
    return httpReply({ method: 'POST', url, body, opts });
  },
  get: async (url, opts = {}) => {
    httpCalls.push({ method: 'GET', url, body: null, headers: opts.headers ?? null, opts });
    return httpReply({ method: 'GET', url, opts });
  },
  request: async (url, opts = {}) => {
    httpCalls.push({ method: 'RAW', url, body: opts.body ?? null, headers: opts.headers ?? null, opts });
    return httpReply({ method: 'RAW', url, opts });
  },
  postStreamingJsonLines: async () => ({ ok: true, status: 200 }),
  getCircuitStatus: () => ({}),
  delay: sleep,
  MAX_RESPONSE_SIZE: 10 * 1024 * 1024,
});

/** The Playwright egress, stubbed so "zero calls" is measurable rather than asserted by reading. */
const playwrightCalls = [];
let playwrightReply = () => ({ ok: false, error: 'playwright not installed' });
cacheStub('electron/ipc/browserEngine.cjs', {
  register() {},
  closeBrowser: async () => true,
  getBrowserPid: () => null,
  searchWeb: async (query, engine) => {
    playwrightCalls.push({ query, engine });
    return playwrightReply({ query, engine });
  },
});

// ─── Now the real modules, which will pick up those stubs ─────────────────────

const cloud      = require('../electron/lib/ollamaCloud.cjs');
const egress     = require('../electron/lib/egressBoundary.cjs');
const modelRoles = require('../electron/lib/modelRoles.cjs');
const catalog    = require('../electron/lib/ollamaCatalog.cjs');
const capability = require('../electron/lib/capability.cjs');
const router     = require('../electron/ipc/modelRouter.cjs');
const orchModule = require('../electron/resourceOrchestrator.cjs');

const { orchestrator, API_RATE_LIMITS, PRIORITY, THRESHOLDS } = orchModule;

cloud.useVault(stubVault);
cloud.useStore(stubStore);
cloud.useHttp(stubHttp);

/** Admission and slots, stubbed for the transport tests so a refusal is driven rather than waited
 *  for. The REAL orchestrator is exercised directly in section (i). */
const orchCalls = [];
let admitVerdict = { allow: true, reason: 'ok' };
let slotVerdict  = { ok: true, waited: false };
const stubOrch = {
  admit: (req) => { orchCalls.push(['admit', req]); return admitVerdict; },
  reserveSlot: async (p, o) => { orchCalls.push(['reserveSlot', p, o]); return slotVerdict; },
  releaseSlot: (p) => { orchCalls.push(['releaseSlot', p]); return true; },
  recordApiUse: (p, t) => { orchCalls.push(['recordApiUse', p, t]); return true; },
};
cloud.useOrchestrator(stubOrch);

const MASTER = { tier: capability.TIERS.MASTER };
const MESSAGES = [{ role: 'user', content: 'hello' }];

function resetCalls() {
  httpCalls.length = 0;
  playwrightCalls.length = 0;
  orchCalls.length = 0;
}

function keyPresent() { vaultUnlocked = true; vaultKeys.set(cloud.CRED_SERVICE, DUMMY); }
function keyAbsent()  { vaultUnlocked = true; vaultKeys.delete(cloud.CRED_SERVICE); }
function vaultLocked() { vaultUnlocked = false; }

function okChatReply(content = 'hi') {
  return () => ({ ok: true, status: 200,
    body: `{"message":{"role":"assistant","content":${JSON.stringify(content)}},"prompt_eval_count":5,"eval_count":7}` });
}

function src(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return ''; }
}

/**
 * Source with comments blanked, for the structural assertions.
 *
 * Needed because those assertions describe forbidden syntax, and a comment EXPLAINING the rule
 * contains the very text the rule forbids. Testing raw source would make the rule unstatable.
 */
function codeOf(rel) {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, ' '));
}

console.log('\nthe keyed Ollama Cloud path — asserted, not trusted\n');
console.log('  NO LIVE CALL TO ollama.com WAS MADE. Every outbound request below is an injected');
console.log('  transport, and the only credential in play is the literal dummy.\n');

// ═══ (b) naming, both directions ══════════════════════════════════════════════

function sectionNaming() {
  section('(b) the name divergence — the table is authoritative in BOTH directions');
  const rows = Object.entries(cloud.CLOUD_TAGS);
  check('the table has fourteen rows', rows.length === 14, rows.length);

  let fwd = 0; let back = 0; let trip = 0; let params = 0; let shape = 0; let ids = 0;
  const registry = cloud.toRegistryEntries();
  for (const [apiModel, row] of rows) {
    if (cloud.apiNameFor(row.daemonTag) === apiModel) fwd += 1;
    if (cloud.daemonTagFor(apiModel) === row.daemonTag) back += 1;
    if (cloud.daemonTagFor(cloud.apiNameFor(row.daemonTag)) === row.daemonTag
        && cloud.apiNameFor(cloud.daemonTagFor(apiModel)) === apiModel) trip += 1;
    if (catalog.paramsB(apiModel) === row.paramsB) params += 1;
    if (!/cloud/.test(apiModel) && /[-:]cloud$/.test(row.daemonTag)) shape += 1;
    if (Object.prototype.hasOwnProperty.call(registry, cloud.ID_PREFIX + apiModel)) ids += 1;
  }
  check('apiNameFor(daemonTag) is the api name for every row', fwd === rows.length, fwd);
  check('daemonTagFor(apiModel) is the daemon tag for every row', back === rows.length, back);
  check('both directions round-trip for every row', trip === rows.length, trip);
  check('the table\u2019s paramsB column agrees with ollamaCatalog.paramsB for every row, nulls included',
    params === rows.length, params);
  check('no apiModel contains "cloud" and every daemonTag ends -cloud or :cloud',
    shape === rows.length, shape);
  check('every apiModel appears as an ollama-cloud/<apiModel> registry id', ids === rows.length, ids);
  check('and no registry id contains -cloud',
    Object.keys(registry).every((id) => !/-cloud/.test(id.slice(cloud.ID_PREFIX.length))));

  check('an unknown daemon tag derives NOTHING', cloud.apiNameFor('no-such-model:cloud') === null);
  check('and an unknown api name derives nothing either', cloud.daemonTagFor('no-such-model') === null);

  // The mechanism itself, pinned — the sized-tag advantage rests on this regex being START-anchored.
  check('paramsB reads 31 from both the api name and the daemon tag',
    catalog.paramsB('gemma4:31b') === 31 && catalog.paramsB('gemma4:31b-cloud') === 31);
  check('and reads null from an unsized family name', catalog.paramsB('gemma4') === null);

  // isApiName is exported, so it is specified: the two predicates PARTITION the names.
  check('isApiName is true for every row', rows.every(([a]) => cloud.isApiName(a) === true));
  check('and false for every daemon tag, so the predicates do not overlap',
    rows.every(([, r]) => cloud.isApiName(r.daemonTag) === false));
  check('and false for an unknown name and for __proto__ — the hasOwnProperty guard',
    cloud.isApiName('no-such-model') === false && cloud.isApiName('__proto__') === false);
}

// ═══ (b2) the derivation rule, asserted AGAINST the table and never used instead of it ════════

function sectionDerivation() {
  section('(b2) the derivation rule is a TEST, not a runtime authority');
  const derive = (tag) => String(tag).replace(/-cloud$/, '').replace(/:cloud$/, '');
  let agree = 0;
  for (const [apiModel, row] of Object.entries(cloud.CLOUD_TAGS)) {
    if (derive(row.daemonTag) === apiModel) agree += 1;
  }
  check('every row satisfies strip-the-suffix, so a typo in a hand-written row is caught',
    agree === Object.keys(cloud.CLOUD_TAGS).length, agree);
  check('but the rule is nowhere in the shipped module — only the table decides',
    !/replace\(\/-cloud\$\//.test(src('electron/lib/ollamaCloud.cjs')));
}

// ═══ (c) base URL ═════════════════════════════════════════════════════════════

function sectionBaseUrl() {
  section('(c) the base URL is a hard gate — a wrong value sends master\u2019s token to someone else');
  storeData.clear();
  delete process.env.OLLAMA_CLOUD_BASE_URL;
  cloud._resetNotices();
  check('the default is https://ollama.com', cloud.baseUrl() === cloud.DEFAULT_BASE_URL);

  const rejected = [
    ['http://ollama.com',        'cleartext'],
    ['https://evil.test',        'a host outside the allow-list'],
    ['https://u:p@ollama.com',   'credentials in the URL'],
    ['https://ollama.com?x=1',   'a query string'],
    ['https://ollama.com#f',     'a fragment'],
    [`https://ollama.com/${'a'.repeat(250)}`, 'over 200 characters'],
    ['not a url',                'unparseable'],
  ];
  for (const [candidate, why] of rejected) {
    storeData.set('config/ollamaCloudBaseUrl', candidate);
    cloud._resetNotices();
    const r = cloud.resolveBaseUrl();
    check(`${why} is refused and the known-good default stands`,
      r.overrideRejected === true && r.url === cloud.DEFAULT_BASE_URL && typeof r.why === 'string',
      JSON.stringify(r));
  }

  storeData.clear();
  cloud._resetNotices();
  storeData.set('config/ollamaCloudBaseUrl', 'https://api.ollama.com');
  check('an allow-listed host IS accepted', cloud.baseUrl() === 'https://api.ollama.com');

  storeData.clear();
  cloud._resetNotices();
  process.env.OLLAMA_CLOUD_BASE_URL = 'https://api.ollama.com';
  check('process.env is consulted when the store has nothing', cloud.baseUrl() === 'https://api.ollama.com');
  storeData.set('config/ollamaCloudBaseUrl', 'https://ollama.com');
  cloud._resetNotices();
  check('and the store wins over process.env', cloud.baseUrl() === 'https://ollama.com');
  delete process.env.OLLAMA_CLOUD_BASE_URL;

  // WIDENING THE HOST IS ITS OWN ACT. One mistyped base URL must not be able to reach a new host.
  storeData.clear();
  cloud._resetNotices();
  storeData.set('config/ollamaCloudBaseUrl', 'https://mirror.example');
  check('a new host is refused with only the base URL set', cloud.resolveBaseUrl().overrideRejected === true);
  storeData.set('config/ollamaCloudHostAllow', 'mirror.example');
  cloud._resetNotices();
  check('and accepted only once ollamaCloudHostAllow names it SEPARATELY',
    cloud.resolveBaseUrl().url === 'https://mirror.example');
  storeData.clear();
  cloud._resetNotices();
  check('a host allow entry ALONE does not widen anything',
    (storeData.set('config/ollamaCloudHostAllow', 'mirror.example'), cloud.baseUrl() === cloud.DEFAULT_BASE_URL));
  storeData.clear();
}

// ═══ (d) absence is reported, never attempted, and never as broken ════════════

async function sectionAbsence() {
  section('(d) ABSENT is not BROKEN — and locked is not absent either');
  storeData.clear();
  cloud._resetNotices();

  keyAbsent();
  resetCalls();
  const c1 = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  const l1 = await cloud.listModels({ user: MASTER });
  const w1 = await cloud.webSearch({ query: { text: 'x', classification: 'public' }, user: MASTER });
  for (const [name, r] of [['chat', c1], ['listModels', l1], ['webSearch', w1]]) {
    check(`${name} reports unconfigured rather than failing`,
      r.unconfigured === true && r.present === false && r.ok === false, JSON.stringify(r));
    check(`${name} carries the one remedy that works`, r.remedy === cloud.REMEDY);
  }
  check('and the HTTP stub recorded ZERO calls — absence is never an attempt',
    httpCalls.length === 0, httpCalls.length);

  const unlockedReason = cloud.credentialState().reason;
  vaultLocked();
  cloud._resetNotices();
  const locked = cloud.credentialState();
  check('a locked vault reports vaultUnlocked:false', locked.vaultUnlocked === false);
  check('and says the vault is locked, not that no key is stored',
    locked.reason === 'the vault is locked');
  check('the two states are DISTINGUISHABLE, which is the whole point',
    unlockedReason === 'no Ollama API key is stored' && unlockedReason !== locked.reason,
    `${unlockedReason} / ${locked.reason}`);

  keyPresent();
  const present = cloud.credentialState();
  check('with the key stored, present is true and the source is the vault',
    present.present === true && present.source === 'vault');
  check('and there is NO env source to report, because there is no env source',
    cloud.credentialState().source !== 'env');
}

// ═══ (e) which path served it, and that a cloud row is reachable at all ══════

async function sectionReachability() {
  section('(e) WHICH path served it — and that a cloud row can be reached at all');
  storeData.clear();
  cloud._resetNotices();
  keyPresent();
  resetCalls();
  httpReply = okChatReply('hi');
  admitVerdict = { allow: true, reason: 'ok' };
  slotVerdict = { ok: true, waited: false };

  const r = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('a dummy-key call SUCCEEDS and returns content — the one constructor can produce a sendable request',
    r.ok === true && r.content === 'hi', JSON.stringify(r).slice(0, 180));
  check('it declares path: cloud', r.path === 'cloud');
  check('it names the endpoint it actually used', String(r.endpoint).includes('ollama.com'));
  check('it names the mechanism', r.via === 'ollama-cloud-keyed');
  check('and where the credential came from', r.credentialSource === 'vault');
  check('token counts are recorded through the one authority',
    orchCalls.some(([m, p, t]) => m === 'recordApiUse' && p === cloud.PROVIDER && t === 12),
    JSON.stringify(orchCalls));
  check('and the slot is released even on the success path',
    orchCalls.filter(([m]) => m === 'releaseSlot').length === 1);

  // ── REACHABILITY. Without the last-resort pass in selectModel, no cloud row could ever be
  //    selected: the four passes are roles, offline, FALLBACK_CHAIN (seven hardcoded ids, none of
  //    them cloud) and discoveredOllama — so on a machine with no daemon and no OpenAI key the call
  //    resolved to 'gpt-4o' and died in the chain.
  vaultKeys.clear();
  keyPresent();
  const picked = router.selectModel('general');
  check('with the key in the vault and NO daemon, selectModel returns an ollama-cloud/* id',
    typeof picked === 'string' && picked.startsWith(cloud.ID_PREFIX), picked);
  check('and it is the largest cloud row, because paramsB is the only quality signal this path has',
    picked === `${cloud.ID_PREFIX}qwen3-coder:480b`, picked);

  keyAbsent();
  const unpicked = router.selectModel('general');
  check('with the vault EMPTY the same call does not — an unreachable model must not be selected',
    !String(unpicked).startsWith(cloud.ID_PREFIX), unpicked);
  vaultLocked();
  const lockedPick = router.selectModel('general');
  check('and with the vault LOCKED it does not either', !String(lockedPick).startsWith(cloud.ID_PREFIX), lockedPick);
  vaultUnlocked = true;

  const ids = Object.keys(cloud.toRegistryEntries());
  const localIds = Object.keys(router.MODEL_REGISTRY).filter((k) => k.startsWith('ollama/'));
  check('no ollama-cloud/* id collides with any ollama/* id',
    ids.every((id) => !localIds.includes(id)) && localIds.length >= 4, localIds.length);
}

// ═══ (f) the registry rows, and the sensitive-role refusal ═══════════════════

function sectionRows() {
  section('(f) the rows — and the refusal this whole tranche is weighted on');
  const rows = Object.values(cloud.toRegistryEntries());
  const all = (fn) => rows.every(fn);

  check('every row carries an id EQUAL to its registry key',
    all((m) => m.id === cloud.ID_PREFIX + m.apiModel));
  check('every row carries the vault service name as its credKey',
    all((m) => m.credKey === cloud.CRED_SERVICE));
  check('every row is type "cloud", which is what puts it in the CLOUD tab with an Add-key button',
    all((m) => m.type === 'cloud'));
  check('every row is costTier 1 — a free allowance is a budget even with no invoice',
    all((m) => m.costTier === 1));
  check('every row has ctxK null, so long-context EXCLUDES them rather than trusting a claim',
    all((m) => m.ctxK === null && m.ctxVerified === false));
  check('every row reports "remote" and NEVER "offline"',
    all((m) => m.caps.includes('remote') && !m.caps.includes('offline')));
  check('every row\u2019s paramsB comes from the real function that judges it',
    all((m) => m.paramsB === catalog.paramsB(m.apiModel)));
  check('and the sized rows really do clear the reasoning floor',
    rows.filter((m) => (m.paramsB ?? 0) >= 14).length >= 10);

  // ── 1. shape
  check('1/6 every row is explicitly private: false — not undefined, not absent',
    all((m) => m.private === false));

  const row31 = cloud.toRegistryEntries()[`${cloud.ID_PREFIX}gemma4:31b`];

  // ── 2. behaviour
  const narr = modelRoles.evaluate('narration', row31);
  check('2/6 narration refuses a cloud row', narr.fit === 'none', JSON.stringify(narr));

  // ── 3. the message, so a future reword cannot pass a sensitive prompt while sounding right
  check('3/6 and the reason names the leaving-the-machine rule',
    narr.reasons.some((x) => /not private/.test(x) && /must not leave the machine/.test(x)),
    JSON.stringify(narr.reasons));

  // ── 4. the undefined case, pinned so the gate does not depend on an accident
  const narrUndef = modelRoles.evaluate('narration', { ...row31, private: undefined });
  check('4/6 a row that LOST its private field is refused too',
    narrUndef.fit === 'none' && narrUndef.reasons.some((x) => /not private/.test(x)));

  // ── 5. the inverse, so assertions 2-4 are not vacuous
  const reason = modelRoles.evaluate('reasoning', row31);
  check('5/6 the SAME row IS fit for reasoning — the refusal is about sensitivity, not about cloud rows failing everything',
    reason.fit !== 'none', JSON.stringify(reason));

  // ── 6. THE ANTI-VACUITY GUARD. evaluate() returns ['no model supplied'] for a row with no id,
  //      BEFORE the privacy gate — so without this, a row that lost its id would refuse narration
  //      for an unrelated reason and 2 and 4 would still pass.
  check('6/6 the refusal is the PRIVACY refusal, not "no model supplied"',
    narr.reasons[0] !== 'no model supplied', JSON.stringify(narr.reasons));
  const noId = modelRoles.evaluate('narration', { ...row31, id: undefined });
  check('and the guard is live: stripping the id DOES produce the wrong-reason refusal',
    noId.reasons[0] === 'no model supplied', JSON.stringify(noId.reasons));

  check('modelRoles.cjs itself is not modified by this tranche',
    !/ollama-cloud/.test(src('electron/lib/modelRoles.cjs')));
}

// ═══ (g) the payload boundary ═════════════════════════════════════════════════

const CHAT_ENV = { kind: 'chat', model: 'gemma4:31b' };

async function sectionPayload() {
  section('(g) the egress boundary — nothing classified private crosses this line');
  storeData.clear();
  cloud._resetNotices();

  // ── private, in BOTH halves of the payload. `messages[].content` is the field that actually
  //    carries the prompt, and an earlier draft classified only `parts`.
  const pm = egress.assemble({ ...CHAT_ENV,
    messages: [{ role: 'user', content: { text: 'master holds 400 shares', classification: 'private' } }] });
  check('a private MESSAGE is refused', pm.ok === false && pm.refused === true && pm.where === 'messages');
  check('and the refusal names the level', pm.level === 'private' && /never leaves this machine/.test(pm.reason));
  const pp = egress.assemble({ ...CHAT_ENV, messages: MESSAGES,
    parts: [{ text: 'master holds 400 shares', classification: 'private' }] });
  check('a private PART is refused too', pp.ok === false && pp.where === 'parts' && pp.index === 0);
  check('and a refusal NEVER returns a body — a silently shortened prompt is a wrong answer dressed as a right one',
    pm.body === undefined && pp.body === undefined);

  // ── internal needs TWO independent switches, because one switch gets flipped by a default
  const int = { role: 'user', content: { text: 'internal note', classification: 'internal' } };
  check('internal is refused by default',
    egress.assemble({ ...CHAT_ENV, messages: [int] }).ok === false);
  check('and still refused with only the caller flag',
    egress.assemble({ ...CHAT_ENV, messages: [int], allowInternal: true }).ok === false);
  storeData.set('config/allowInternalToCloud', true);
  check('and still refused with only the config flag',
    egress.assemble({ ...CHAT_ENV, messages: [int] }).ok === false);
  check('and permitted only with BOTH',
    egress.assemble({ ...CHAT_ENV, messages: [int], allowInternal: true }).ok === true);
  storeData.clear();

  // ── fail closed on every unclassified or mis-shaped element
  const absent = egress.assemble({ ...CHAT_ENV, messages: MESSAGES, parts: [{ text: 'x' }] });
  const undef  = egress.assemble({ ...CHAT_ENV, messages: MESSAGES, parts: [{ text: 'x', classification: undefined }] });
  const nul    = egress.assemble({ ...CHAT_ENV, messages: MESSAGES, parts: [{ text: 'x', classification: null }] });
  const empty  = egress.assemble({ ...CHAT_ENV, messages: MESSAGES, parts: [{ text: 'x', classification: '' }] });
  const typo   = egress.assemble({ ...CHAT_ENV, messages: MESSAGES, parts: [{ text: 'x', classification: 'publik' }] });
  check('an object part with the classification ABSENT is refused', absent.ok === false);
  check('undefined, null and empty are refused with the SAME reason as a typo',
    [undef, nul, empty, typo].every((r) => r.ok === false && r.reason === absent.reason),
    [undef.reason, typo.reason].join(' / '));
  check('a typo fails CLOSED rather than being coerced to public', typo.level === null);
  check('a number, an array and a bare object with no text are all refused',
    [7, ['x'], { note: 'x' }].every((bad) =>
      egress.assemble({ ...CHAT_ENV, messages: MESSAGES, parts: [bad] }).ok === false));
  check('a message content that is an object with no classification is refused',
    egress.assemble({ ...CHAT_ENV, messages: [{ role: 'user', content: { text: 'x' } }] }).ok === false);
  check('while a BARE STRING content is accepted as public — today\u2019s callers are not a regression',
    egress.assemble({ ...CHAT_ENV, messages: MESSAGES }).maxLevel === 'public');
  check('and a bad role is refused',
    egress.assemble({ ...CHAT_ENV, messages: [{ role: 'root', content: 'x' }] }).where === 'messages');

  // ── THE JOIN. Row-level classification is necessary and not sufficient.
  const many = [];
  for (let i = 0; i < 50; i += 1) many.push({ role: 'user', content: `public row ${i}` });
  many.splice(37, 0, { role: 'user', content: { text: 'master holds 400 shares', classification: 'private' } });
  const join = egress.assemble({ ...CHAT_ENV, messages: many });
  check('fifty public rows and one private row refuse AS A WHOLE, wherever the private one sits',
    join.ok === false && join.where === 'messages' && join.index === 37, JSON.stringify(join));

  // ── the envelope, which lives here precisely so there is no second body constructor
  check('kind:chat with NO model refuses at the envelope',
    egress.assemble({ kind: 'chat', messages: MESSAGES }).where === 'envelope');
  check('an absent or unknown kind refuses',
    egress.assemble({ messages: MESSAGES }).where === 'envelope'
    && egress.assemble({ kind: 'embed', messages: MESSAGES }).where === 'envelope');
  check('a search envelope carrying chat fields refuses as mis-wired',
    egress.assemble({ kind: 'search', query: { text: 'x', classification: 'public' }, model: 'gemma4:31b' }).where === 'envelope');
  check('a chat envelope carrying a query refuses as mis-wired',
    egress.assemble({ ...CHAT_ENV, messages: MESSAGES, query: { text: 'x', classification: 'public' } }).where === 'envelope');
  check('a non-boolean think refuses',
    egress.assemble({ ...CHAT_ENV, messages: MESSAGES, options: { think: 'yes' } }).where === 'envelope');
  check('a format other than null or json refuses',
    egress.assemble({ ...CHAT_ENV, messages: MESSAGES, options: { format: 'yaml' } }).where === 'envelope');
  check('an UNKNOWN option key refuses rather than being passed through — a passthrough is an unreviewed egress surface',
    egress.assemble({ ...CHAT_ENV, messages: MESSAGES, options: { temperature: 0.7 } }).where === 'envelope');

  // ── POSITIVE. "No second constructor" is worth nothing if the one constructor cannot produce a
  //    sendable request, which is exactly what an earlier revision specified.
  const good = egress.assemble({ ...CHAT_ENV, messages: MESSAGES, options: { think: true, format: 'json' } });
  check('a valid envelope yields a COMPLETE body', good.ok === true
    && good.body.model === 'gemma4:31b' && good.body.stream === false
    && Array.isArray(good.body.messages) && good.body.messages.length === 1, JSON.stringify(good.body));
  check('and the enumerated options reach it', good.body.think === true && good.body.format === 'json');

  const withParts = egress.assemble({ ...CHAT_ENV,
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'ask' }],
    parts: ['ctx one', 'ctx two'] });
  const appended = withParts.body.messages.filter((m) => m.role === 'system' && /^ctx /.test(m.content));
  check('counts.parts equals the number of appended system messages — a dropped part fails the suite',
    withParts.counts.parts === 2 && appended.length === 2, JSON.stringify(withParts.counts));
  check('and they appear AFTER every caller message, in the order given',
    withParts.body.messages.map((m) => m.content).join('|') === 'sys|ask|ctx one|ctx two',
    withParts.body.messages.map((m) => m.content).join('|'));

  // ── the search body, PROVISIONAL and therefore pinned so it cannot quietly widen
  const sb = egress.assemble({ kind: 'search', query: { text: 'q', classification: 'public' }, maxResults: 99 });
  check('an accepted search body carries no key outside { query, max_results }',
    sb.ok === true && Object.keys(sb.body).sort().join(',') === 'max_results,query', JSON.stringify(sb.body));
  check('its only caller-derived value is query.text', sb.body.query === 'q');
  check('and maxResults is clamped to 1..10 rather than trusted', sb.body.max_results === 10);
  check('a BARE STRING query is refused — there is no bare-string allowance for a search',
    egress.assemble({ kind: 'search', query: 'plain string' }).where === 'query');
  check('and a private query is refused like anywhere else',
    egress.assemble({ kind: 'search', query: { text: 'q', classification: 'private' } }).level === 'private');

  // ── STRUCTURAL: there is no second body constructor, and no second HTTP client
  const cloudCode = codeOf('electron/lib/ollamaCloud.cjs');
  check('ollamaCloud.cjs contains no JSON.stringify', !/JSON\.stringify/.test(cloudCode));
  check('and no `body` key assignment — the body is never built here, only passed by reference',
    !/\bbody\s*:/.test(cloudCode));
  check('and no call to net.request — only post/get, which serialise INSIDE lib/http.cjs',
    !/\.request\s*\(/.test(cloudCode));
  check('the only outbound calls are post and get on the one client',
    /httpClient\(\)\.post\(/.test(cloudCode) && /httpClient\(\)\.get\(/.test(cloudCode));
  check('egressBoundary.cjs requires no HTTP client at all',
    !/require\(['"][^'"]*http/.test(codeOf('electron/lib/egressBoundary.cjs')));

  // ── webSearch runs the gate BEFORE the transport, measured by call ordering
  keyPresent();
  resetCalls();
  const bare = await cloud.webSearch({ query: 'plain string', user: MASTER });
  check('webSearch refuses a bare-string query with ZERO HTTP calls',
    bare.refused === true && httpCalls.length === 0, httpCalls.length);
  resetCalls();
  const priv = await cloud.webSearch({ query: { text: 'q', classification: 'private' }, user: MASTER });
  check('and refuses a private query with ZERO HTTP calls',
    priv.refused === true && httpCalls.length === 0, httpCalls.length);
}

// ═══ (g1) both egresses — the round-2 finding that mattered most ═════════════

async function sectionBothEgresses(handlers) {
  section('(g1) a refusal is TERMINAL for every backend — bing.com is no less of a network');
  keyPresent();
  resetCalls();
  playwrightReply = () => ({ ok: true, results: [{ title: 't', url: 'https://x.test', snippet: 's' }] });

  const p = await handlers['models:search-web'](null, {
    user: MASTER, query: { text: 'master holds 400 shares', classification: 'private' } });
  check('a private query through models:search-web is refused', p.refused === true, JSON.stringify(p));
  check('and the HTTP stub AND the Playwright stub BOTH record zero calls',
    httpCalls.length === 0 && playwrightCalls.length === 0,
    `http=${httpCalls.length} playwright=${playwrightCalls.length}`);

  resetCalls();
  const b = await handlers['models:search-web'](null, { user: MASTER, query: 'plain string' });
  check('a bare-string query is refused the same way, both backends at zero',
    b.refused === true && httpCalls.length === 0 && playwrightCalls.length === 0);

  // THE GATE RUNS ABOVE BACKEND SELECTION. With the credential ABSENT, cloud is skipped — so if the
  // gate ran inside the transport the Playwright path would still be reached. It is not.
  keyAbsent();
  resetCalls();
  const skipped = await handlers['models:search-web'](null, {
    user: MASTER, query: { text: 'master holds 400 shares', classification: 'private' } });
  check('with the cloud credential ABSENT and Playwright present, a private query STILL records zero Playwright calls',
    skipped.refused === true && playwrightCalls.length === 0, playwrightCalls.length);

  // And the positive, so the refusals are not the only thing proven.
  resetCalls();
  const okRes = await handlers['models:search-web'](null, {
    user: MASTER, query: { text: 'rupee', classification: 'public' } });
  check('an ALLOWED query with no cloud key falls through to the local browser backend',
    okRes.ok === true && okRes.backend === 'playwright' && playwrightCalls.length === 1,
    JSON.stringify({ ok: okRes.ok, backend: okRes.backend, n: playwrightCalls.length }));
  check('and the backend receives the GATED text, not the caller\u2019s object',
    playwrightCalls[0]?.query === 'rupee', JSON.stringify(playwrightCalls[0]));

  const denied = await handlers['models:search-web'](null, { user: null, query: { text: 'q', classification: 'public' } });
  check('an unauthenticated caller is denied on browser.search before anything else',
    denied.ok === false && /browser\.search/.test(String(denied.error)), JSON.stringify(denied));
  playwrightReply = () => ({ ok: false, error: 'playwright not installed' });
}

// ═══ (g2) the capability gate RUNS, and distinguishes a missing wire-up from a denial ════════

async function sectionCapability() {
  section('(g2) the gate runs — and a missing wire-up never reads as "master lacks permission"');
  keyPresent();
  httpReply = okChatReply('hi');

  for (const [name, call] of [
    ['chat',       () => cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b' })],
    ['listModels', () => cloud.listModels({})],
    ['webSearch',  () => cloud.webSearch({ query: { text: 'q', classification: 'public' } })],
  ]) {
    resetCalls();
    const r = await call();
    check(`${name} with NO user returns gateError — a programming error, not a policy outcome`,
      r.gateError === true && r.ok === false, JSON.stringify(r));
    check(`${name} made zero HTTP calls in that case`, httpCalls.length === 0);
  }

  for (const [name, call] of [
    ['chat',       () => cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: null })],
    ['listModels', () => cloud.listModels({ user: null })],
    ['webSearch',  () => cloud.webSearch({ query: { text: 'q', classification: 'public' }, user: null })],
  ]) {
    resetCalls();
    const r = await call();
    check(`${name} with user:null is DENIED, and says which capability`,
      r.ok === false && r.gateError !== true && /may not do this \(needs "/.test(String(r.error)),
      JSON.stringify(r));
    check(`${name} made zero HTTP calls in that case too`, httpCalls.length === 0);
  }

  resetCalls();
  const ok = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('a master-tier user REACHES the transport', ok.ok === true && httpCalls.length === 1);

  // ── THE POSITIVE CASE THROUGH THE REAL SWITCH. A suite that asserts only the refusals cannot
  //    tell a dropped argument at the dispatch site from correct behaviour: three arguments to a
  //    four-parameter function makes `user` undefined, so EVERY cloud request returns gateError and
  //    the gate stands shut while looking like a policy decision.
  resetCalls();
  const viaSwitch = await router.chatCompletion(MESSAGES, `${cloud.ID_PREFIX}gemma4:31b`, MASTER);
  check('chatCompletion dispatches a cloud model with all four arguments and reaches the transport',
    viaSwitch.content === 'hi' && viaSwitch.path === 'cloud' && httpCalls.length === 1,
    JSON.stringify(viaSwitch));
  resetCalls();
  let threw = null;
  try { await router.chatCompletion(MESSAGES, `${cloud.ID_PREFIX}gemma4:31b`); }
  catch (e) { threw = e; }
  check('while omitting the user throws a gateError rather than making an ungated cloud call',
    threw !== null && threw.gateError === true && httpCalls.length === 0, String(threw && threw.message));

  // ── the optional tightening, both ways
  check('without models.use-cloud in the matrix, the fallback gate is models.use and status says so',
    cloud.status().cloudCapability.key === 'models.use'
    && cloud.status().cloudCapability.dedicated === false,
    JSON.stringify(cloud.status().cloudCapability));
  capability.MATRIX['models.use-cloud'] = 1;
  check('with it present, the dedicated tier-1 gate applies with no code change',
    cloud.status().cloudCapability.key === 'models.use-cloud'
    && cloud.status().cloudCapability.dedicated === true);
  const tier3 = { tier: 3 };
  const denied3 = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: tier3 });
  check('and a tier-3 account is then refused, which is the genuine tightening',
    denied3.ok === false && /models\.use-cloud/.test(String(denied3.error)), JSON.stringify(denied3));
  delete capability.MATRIX['models.use-cloud'];
  check('the matrix is left exactly as it was — shared/capabilities.json is PROTECTED and untouched',
    capability.MATRIX['models.use-cloud'] === undefined
    && !/models\.use-cloud/.test(src('shared/capabilities.json')));
  check('and the key is SPECIFIED for master rather than added',
    /models\.use-cloud/.test(src('docs/research/OLLAMA_CLOUD.md')));

  // ── the orchestrator seam cannot drift from the real instance without failing loudly
  for (const missing of ['admit', 'reserveSlot', 'releaseSlot', 'recordApiUse']) {
    const partial = { admit() {}, reserveSlot() {}, releaseSlot() {}, recordApiUse() {} };
    delete partial[missing];
    let caught = null;
    try { cloud.useOrchestrator(partial); } catch (e) { caught = e; }
    check(`an orchestrator stub missing ${missing} THROWS rather than letting the suite be green about admission that did not happen`,
      caught !== null && new RegExp(missing).test(caught.message));
  }
  cloud.useOrchestrator(stubOrch);
}

// ═══ (g3) the one wire that decides whether the gate runs at all ═════════════

function sectionRendererWire() {
  section('(g3) the renderer wire — without it the whole thread-through is inert');
  const rc = src('src/services/ramaClient.js');
  check('ramaChat.send destructures `user`', /send:\s*async\s*\(\{[^}]*\buser\b[^}]*\}\)/.test(rc));
  check('and forwards it to window.rama.models.chat',
    /window\.rama\.models\.chat\(\{[^}]*\buser\b[^}]*\}\)/.test(rc));
  check('its FAILURE return carries remedy and unconfigured, which make an absent key actionable',
    /ok:\s*false[\s\S]{0,400}?remedy:/.test(rc) && /ok:\s*false[\s\S]{0,400}?unconfigured:/.test(rc));
  check('and its SUCCESS return carries path, so WHICH path served a request is visible',
    /ok:\s*true[\s\S]{0,1400}?\bpath:/.test(rc));

  const chat = src('src/pages/Chat/Chat.jsx');
  check('Chat.jsx passes currentUser', /ramaChat\.send\(\{[\s\S]{0,300}?user:\s*currentUser/.test(chat));
  check('and its failure branch RENDERS res.remedy, so the forwarding does not stop one layer higher',
    /res\.remedy/.test(chat));
  const ide = src('src/pages/IDE/IDE.jsx');
  check('IDE.jsx passes currentUser too', /ramaChat\.send\(\{[\s\S]{0,300}?user:\s*currentUser/.test(ide));

  const models = src('src/pages/Models/Models.jsx');
  check('Models.jsx has a PROVIDER_LINKS row for the Ollama Cloud key', /OLLAMA_API_KEY:\s*\{/.test(models));
  check('and it points at ollama.com\u2019s key page', /ollama\.com\/settings\/keys/.test(models));
  check('the locked-vault branch REPLACES the Add-key button rather than sitting beside it',
    /vaultLockedWithStoredKey\(cloudStatus, model\)/.test(models)
    && /vault locked — unlock to use the stored key/.test(models));
  check('the cloud tab renders three states, not two',
    /key PRESENT/.test(models) && /key ABSENT/.test(models) && /vault locked/.test(models));
  check('the local tab names the cloud way forward where master discovers the problem',
    /or add an Ollama Cloud key to use cloud models with no install/.test(models));
  check('and checkAvailable / credentialStatus are left alone — both are correct about what they claim',
    !/function checkAvailable/.test(models));

  const res = src('src/pages/Resources/Resources.jsx');
  check('Resources.jsx renders a task refusal, which it previously could not',
    /Task refused/.test(res));

  residual('that the three states RENDER differently is asserted on the predicate and the strings, '
    + 'not through a DOM render: this suite is a .cjs under bare Node with no React test renderer. '
    + 'The data behind them — present / vaultUnlocked:false / vaultUnlocked:true+present:false — IS '
    + 'asserted behaviourally in section (d)');
}

// ═══ (h) the error table ══════════════════════════════════════════════════════

async function sectionErrors() {
  section('(h) every failure is NAMED, and none of them is a silent fallback');
  keyPresent();
  storeData.clear();
  cloud._resetNotices();

  resetCalls();
  const nameErr = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b-cloud', user: MASTER });
  check('row 4: a DAEMON tag sent to the keyed API is refused BEFORE any request',
    nameErr.nameError === true && httpCalls.length === 0, JSON.stringify(nameErr));
  check('and the reason names both the tag and what the keyed API wants',
    /daemon tag/.test(nameErr.reason) && /gemma4:31b/.test(nameErr.reason));
  resetCalls();
  const colonCloud = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:cloud', user: MASTER });
  check('the :cloud form is refused too, with zero calls',
    colonCloud.nameError === true && httpCalls.length === 0);

  resetCalls();
  const refused = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER,
    parts: [{ text: 'holdings', classification: 'private' }] });
  check('row 5: a refused payload never reaches the wire',
    refused.refused === true && httpCalls.length === 0);

  const rows = [
    [401, '{"error":"unauthorized"}', 'credentialRejected', 'row 8: a rejected credential'],
    [402, '{"error":"upgrade required"}', 'planError',       'row 9: a model not on this plan'],
    [404, '{"error":"model not found"}', 'modelError',       'row 10: an unknown model'],
    [0,   null,                          'offline',          'row 14: unreachable'],
  ];
  for (const [status, body, flag, label] of rows) {
    cloud._resetNotices();
    resetCalls();
    httpReply = () => (status === 0
      ? { ok: false, status: 0, error: 'Timeout after 120000ms' }
      : { ok: false, status, body });
    const r = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
    check(`${label} is reported as ${flag} and NEVER as ok`, r[flag] === true && r.ok !== true,
      JSON.stringify(r));
  }
  check('row 9 NAMES the model and makes no substitute',
    (await (async () => {
      cloud._resetNotices();
      httpReply = () => ({ ok: false, status: 402, body: '{"error":"not available on your plan"}' });
      return cloud.chat({ messages: MESSAGES, apiModel: 'gpt-oss:120b', user: MASTER });
    })()).apiModel === 'gpt-oss:120b');

  cloud._resetNotices();
  httpReply = () => ({ ok: true, status: 200, body: 'not json at all' });
  const shape1 = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('row 15: a non-JSON body is a shapeError with at most 200 characters echoed',
    shape1.shapeError === true && String(shape1.raw).length <= 200);

  httpReply = () => ({ ok: true, status: 200, body: '{"message":{"role":"assistant"}}' });
  const shape2 = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('row 16: a response missing message.content is a shapeError, not an empty answer',
    shape2.shapeError === true && shape2.ok !== true);

  httpReply = () => ({ ok: true, status: 200, body: '{"error":"something went wrong"}' });
  const err200 = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('row 17: an error on a 200 is still a failure', err200.ok === false && /something went wrong/.test(err200.reason));

  // ── a bad key must not hammer the endpoint
  cloud._resetNotices();
  httpReply = () => ({ ok: false, status: 401, body: '{"error":"unauthorized"}' });
  resetCalls();
  await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  const afterFirst = httpCalls.length;
  const second = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('after a 401 the next attempt is SUPPRESSED and the stub records no second call',
    httpCalls.length === afterFirst && second.suppressed === true, `${afterFirst} -> ${httpCalls.length}`);
  cloud._resetNotices();

  // ── admission and the slot, as the transport sees them
  admitVerdict = { allow: false, reason: 'ollama-cloud is at its 16/min courtesy ceiling' };
  resetCalls();
  const deferred = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('row 6: admission denied is deferred, with the reason, and no request',
    deferred.deferred === true && httpCalls.length === 0 && /16\/min/.test(deferred.reason));
  admitVerdict = { allow: true, reason: 'ok' };

  slotVerdict = { ok: false, deferred: true, reason: 'ollama-cloud is at its 1-request concurrency limit' };
  resetCalls();
  const noSlot = await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER });
  check('row 7: no slot is deferred, with no request and no slot leaked',
    noSlot.deferred === true && httpCalls.length === 0
    && orchCalls.filter(([m]) => m === 'releaseSlot').length === 0);
  slotVerdict = { ok: true, waited: false };

  // ── row 18: a slot is released even when the body throws
  httpReply = () => { throw new Error('transport exploded'); };
  resetCalls();
  let boom = null;
  try { await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER }); }
  catch (e) { boom = e; }
  check('row 18: a throw inside the request still releases the slot — a leaked slot on a 1-slot row is a permanent outage',
    boom !== null && orchCalls.filter(([m]) => m === 'releaseSlot').length === 1);
  httpReply = okChatReply('hi');

  check('no row in the table degrades to a different model or a shortened payload',
    !/fallbackTo|substitute|truncat/i.test(src('electron/lib/ollamaCloud.cjs')));
}

// ═══ (d2) the chain above the transport ══════════════════════════════════════

async function sectionChain(handlers) {
  section('(d2) models:chat — a substitution is DECLARED, and nothing says "All models failed"');
  vaultKeys.clear();
  vaultUnlocked = true;
  cloud._resetNotices();
  resetCalls();

  const r = await handlers['models:chat'](null, {
    messages: MESSAGES, model: `${cloud.ID_PREFIX}gemma4:31b`, user: MASTER });
  check('a cloud model with the vault EMPTY returns unconfigured', Array.isArray(r.unconfigured)
    && r.unconfigured.length === 1 && r.ok === false, JSON.stringify(r));
  check('and carries the remedy, which used to be lost at the throw', r.remedy === cloud.REMEDY);
  check('and its response does NOT contain "All models failed" — that is the target machine\u2019s exact state',
    !JSON.stringify(r).includes('All models failed'), JSON.stringify(r).slice(0, 200));
  check('and nothing was sent', httpCalls.length === 0);

  // ── a fallback answers: the substitution AND its cause are both declared
  vaultKeys.set('OPENAI_API_KEY', 'test-not-a-real-key-openai');
  httpReply = () => ({ ok: true, status: 200,
    body: '{"choices":[{"message":{"role":"assistant","content":"from the fallback"}}],"usage":{}}' });
  resetCalls();
  const fb = await handlers['models:chat'](null, {
    messages: MESSAGES, model: `${cloud.ID_PREFIX}gemma4:31b`, user: MASTER });
  check('when a fallback answers, the response carries fallbackFrom',
    fb.ok === true && fb.fallbackFrom === `${cloud.ID_PREFIX}gemma4:31b`, JSON.stringify(fb).slice(0, 200));
  check('AND the unconfigured entry beside it, so master sees WHICH model was substituted and WHY',
    Array.isArray(fb.unconfigured) && fb.unconfigured[0].remedy === cloud.REMEDY,
    JSON.stringify(fb.unconfigured));
  vaultKeys.delete('OPENAI_API_KEY');
  httpReply = okChatReply('hi');

  const cs = await handlers['models:cloud-status'](null, {});
  const full = cloud.status();
  check('models:cloud-status returns a SUBSET of status()\u2019s frozen key set, never a parallel shape',
    Object.keys(cs).filter((k) => k !== 'ok').every((k) => Object.prototype.hasOwnProperty.call(full, k)),
    Object.keys(cs).join(','));
  check('and it reports PRESENT or ABSENT and nothing that derives from a key value',
    !Object.keys(cs).some((k) => /length|prefix|suffix|mask|hash|value/i.test(k)), Object.keys(cs).join(','));
}

// ═══ (i) rate limits, admission and the slot — through the REAL orchestrator ══

async function sectionLimits() {
  section('(i) the ceiling and the slot, through the functions the cloud path actually calls');
  const own = (k) => Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, k);
  check('API_RATE_LIMITS has an ollama-cloud row and a separate ollama-search row',
    own('ollama-cloud') && own('ollama-search'));
  check('ollama-cloud.maxConcurrent is 1 — the free tier\u2019s binding constraint',
    API_RATE_LIMITS['ollama-cloud'].maxConcurrent === 1);
  check('ollama-cloud.tokPerMin is null, meaning UNCHECKED and not zero',
    API_RATE_LIMITS['ollama-cloud'].tokPerMin === null);
  check('every row carries maxConcurrent and inFlight',
    Object.values(API_RATE_LIMITS).every((l) => Number.isFinite(l.maxConcurrent) && Number.isFinite(l.inFlight)));
  check('no row own-property name looks like a credential field',
    !Object.values(API_RATE_LIMITS).some((l) => Object.keys(l).some((k) => /key|secret|bearer|prefix|hash/i.test(k))));
  check('and the dummy key appears nowhere in the whole table',
    !JSON.stringify(API_RATE_LIMITS).includes(DUMMY));

  // ── THE ASSERTION THAT MAKES REFUSE-BY-DEFAULT SAFE rather than a capability regression
  const providers = new Set(Object.values(router.MODEL_REGISTRY).map((m) => m.provider));
  providers.add('custom');
  providers.add('ollama-search');
  const missing = [...providers].filter((p) => !own(p));
  check('every provider in MODEL_REGISTRY, plus custom and ollama-search, HAS a row',
    missing.length === 0, missing.join(', '));

  // ── the ceiling, driven through admit() — the one function the cloud path calls
  const row = API_RATE_LIMITS['ollama-cloud'];
  row.usedReq = 0; row.usedTok = 0; row.resetAt = Date.now() + 60000; row.inFlight = 0;
  const ceiling = Math.floor(row.reqPerMin * THRESHOLDS.NETWORK.RATE_LIMIT_BUFFER);
  check('the ENFORCED ceiling is 16/min, not the 20 in the table', ceiling === 16);
  let allowed = 0;
  for (let i = 0; i < ceiling; i += 1) {
    if (orchestrator.admit({ aiProvider: 'ollama-cloud', priority: PRIORITY.NORMAL }).allow) allowed += 1;
    orchestrator.recordApiUse('ollama-cloud', 0);
  }
  check('sixteen recorded uses all admit', allowed === ceiling, allowed);
  const seventeenth = orchestrator.admit({ aiProvider: 'ollama-cloud', priority: PRIORITY.NORMAL });
  check('the seventeenth is refused, and the reason names the ENFORCED number',
    seventeenth.allow === false && /16\/min/.test(seventeenth.reason), seventeenth.reason);

  row.usedReq = 0; row.resetAt = Date.now() + 60000;
  const noRow = orchestrator.admit({ aiProvider: 'nope' });
  check('a provider with no row is refused, with the missing row named',
    noRow.allow === false && /no rate-limit row/.test(noRow.reason), noRow.reason);
  const proto = orchestrator.admit({ aiProvider: '__proto__' });
  check('and __proto__ is refused the same way — ownership, not truthiness',
    proto.allow === false && /no rate-limit row/.test(proto.reason), proto.reason);

  row.inFlight = row.maxConcurrent;
  const conc = orchestrator.admit({ aiProvider: 'ollama-cloud', priority: PRIORITY.NORMAL });
  check('a full slot is a DISTINCT refusal from the ceiling',
    conc.allow === false && /concurrency limit/.test(conc.reason), conc.reason);
  row.inFlight = 0;

  check('admit({}) with no aiProvider behaves EXACTLY as before — the additive guarantee',
    orchestrator.admit({ ramMB: 1 }).allow === true);
  row.usedReq = 999;
  check('and CRITICAL still bypasses the rate ceiling, because admit returns before this block',
    orchestrator.admit({ aiProvider: 'ollama-cloud', priority: PRIORITY.CRITICAL }).allow === true);
  row.usedReq = 0;

  check('_canRun refuses an unknown provider', orchestrator.queue._canRun(
    { aiProvider: 'nope' }, PRIORITY.NORMAL, { cpu: 0, ram: 0, temp: 0 }) === false);
  check('and refuses __proto__', orchestrator.queue._canRun(
    { aiProvider: '__proto__' }, PRIORITY.NORMAL, { cpu: 0, ram: 0, temp: 0 }) === false);

  // ── PROTOTYPE POLLUTION, asserted because the symptom appears nowhere near the cause
  orchestrator.registerHandler('probe', async () => 'ok');
  orchestrator.queue.enqueue({ id: 'proto-probe', type: 'probe', aiProvider: '__proto__',
    priority: PRIORITY.CRITICAL });
  await orchestrator._tick();
  check('after _tick runs with aiProvider "__proto__", Object.prototype.usedReq is still undefined',
    Object.prototype.usedReq === undefined, String(Object.prototype.usedReq));

  // ── the slot, including what the two priorities do DIFFERENTLY
  row.inFlight = 0;
  const first = await orchestrator.reserveSlot('ollama-cloud', { priority: PRIORITY.NORMAL });
  check('the first NORMAL reservation succeeds', first.ok === true && row.inFlight === 1);
  const secondNormal = await orchestrator.reserveSlot('ollama-cloud', { priority: PRIORITY.NORMAL });
  check('the second is deferred IMMEDIATELY, with no wait — a waiter queue on a one-slot row is a latency trap',
    secondNormal.ok === false && secondNormal.deferred === true && secondNormal.timedOut === undefined);

  // TWO CRITICAL WAITERS, ONE RELEASE. Exactly one may win, or inFlight reaches 2 on a 1-slot row —
  // the exact limit this mechanism exists to honour, broken by the mechanism added to honour it.
  const settled = [];
  const w1 = orchestrator.reserveSlot('ollama-cloud', { priority: PRIORITY.CRITICAL, waitMs: 3000 });
  const w2 = orchestrator.reserveSlot('ollama-cloud', { priority: PRIORITY.CRITICAL, waitMs: 3000 });
  w1.then((r) => settled.push(['w1', r]));
  w2.then((r) => settled.push(['w2', r]));
  await sleep(10);
  orchestrator.releaseSlot('ollama-cloud');
  await sleep(50);
  check('exactly ONE critical waiter wins a single release', settled.length === 1, JSON.stringify(settled));
  check('and it reports that it waited rather than being refused',
    settled[0] && settled[0][1].ok === true && settled[0][1].waited === true, JSON.stringify(settled));
  check('and inFlight is 1, not 2, on a maxConcurrent:1 row', row.inFlight === 1, row.inFlight);
  orchestrator.releaseSlot('ollama-cloud');
  await Promise.all([w1, w2]);
  check('the second waiter then wins the next release', settled.length === 2 && settled[1][1].ok === true);

  row.inFlight = row.maxConcurrent;
  const timedOut = await orchestrator.reserveSlot('ollama-cloud', { priority: PRIORITY.CRITICAL, waitMs: 60 });
  check('a critical wait is BOUNDED — a leaked slot is an honest refusal, not an invisible hang',
    timedOut.ok === false && timedOut.timedOut === true, JSON.stringify(timedOut));

  row.inFlight = 0;
  await orchestrator.reserveSlot('ollama-cloud', { priority: PRIORITY.NORMAL });
  orchestrator.releaseSlot('ollama-cloud');
  orchestrator.releaseSlot('ollama-cloud');
  orchestrator.releaseSlot('ollama-cloud');
  check('three releases after one reserve leave inFlight at 0 and never negative', row.inFlight === 0, row.inFlight);
  check('releasing an unknown provider is a no-op, not a throw', orchestrator.releaseSlot('nope') === false);

  // ── THE DEAD FUNCTION, in order: it threw TypeError on every call until FALLBACK_CHAIN was exported
  check('modelRouter exports FALLBACK_CHAIN and it is an array', Array.isArray(router.FALLBACK_CHAIN));
  let selected = null;
  let selectThrew = null;
  try { selected = orchestrator.selectOptimalModel('general'); } catch (e) { selectThrew = e; }
  check('selectOptimalModel RETURNS rather than throwing', selectThrew === null && selected !== null,
    String(selectThrew && selectThrew.message));
  check('and it never returns a model whose provider has no row',
    selected && (own(router.modelInfo(selected.model)?.provider ?? '') || selected.reason === 'fallback-all-limited'),
    JSON.stringify(selected));

  // ── the refusal is REPORTED, not queued forever
  const before = orchestrator.queue.getStats().queued;
  let submitThrew = null;
  try { orchestrator.submit({ type: 'probe', aiProvider: 'opanai' }); } catch (e) { submitThrew = e; }
  check('submit() THROWS for a provider it cannot meter', submitThrew !== null
    && /unknown AI provider "opanai"/.test(submitThrew.message), String(submitThrew && submitThrew.message));
  check('and no task was enqueued — a queued-forever task and a refused one are otherwise indistinguishable',
    orchestrator.queue.getStats().queued === before, `${before} -> ${orchestrator.queue.getStats().queued}`);

  const fakeIpc = {};
  const handlers = {};
  fakeIpc.handle = (ch, fn) => { handlers[ch] = fn; };
  orchModule.register(fakeIpc);
  const refusal = await handlers['orchestrator:submit'](null, { type: 'probe', aiProvider: 'opanai' });
  check('the IPC handler turns that throw into something the renderer can render',
    refusal.ok === false && /opanai/.test(refusal.error), JSON.stringify(refusal));
  const accepted = await handlers['orchestrator:submit'](null, { type: 'probe', aiProvider: 'ollama-cloud' });
  check('while a known provider is still accepted and still returns a bare id in { ok, id }',
    accepted.ok === true && typeof accepted.id === 'string');

  const limits = await handlers['orchestrator:api-limits'](null);
  check('orchestrator:api-limits still returns the whole table, and it carries no credential-derived field',
    limits.ok === true && !JSON.stringify(limits.data).includes(DUMMY));
  const status = orchestrator.getStatus();
  check('getStatus().apiLimits keeps its EXPLICIT projection and gains inFlight and maxConcurrent',
    Object.keys(status.apiLimits['ollama-cloud']).sort().join(',') === 'cap,inFlight,maxConcurrent,pct,used',
    Object.keys(status.apiLimits['ollama-cloud']).join(','));
  check('and the monthly counters are NOT in that projection — they are reported through status()',
    status.apiLimits['ollama-cloud'].usedTokMonth === undefined);

  const used = await handlers['orchestrator:record-api-use'](null, 'ollama-cloud', 10);
  check('record-api-use delegates to the instance method, so there is one implementation',
    used.ok === true && API_RATE_LIMITS['ollama-cloud'].usedTokMonth >= 10);
  check('an unknown provider is not recorded',
    (await handlers['orchestrator:record-api-use'](null, 'nope', 10)).ok === false);
  check('and the monthly counter is reported as what RAMA SPENT, with no budget invented',
    cloud.status().monthlyBudget === null && cloud.status().monthlyBudgetKnown === false);

  orchestrator.stop();
}

// ═══ (j) the daemon path is untouched — this is the I11 assertion ═════════════

function sectionDaemonUntouched() {
  section('(j) I11 — the local daemon path keeps working, untouched, for someone with no key');
  const rs = src('electron/ipc/modelRouter.cjs');
  check('ollamaChat still posts to localhost:11434', /httpPost\('localhost',\s*11434,\s*'\/api\/chat'/.test(rs));
  check('refreshOllamaModels still probes /api/tags on localhost',
    /httpGet\('http:\/\/localhost:11434\/api\/tags'\)/.test(rs));
  check('httpPost and httpGet are left exactly as they were — no header parameter was bolted on',
    /async function httpPost\(hostname, port, path, body\)/.test(rs)
    && /async function httpGet\(url\)/.test(rs));

  for (const id of ['ollama/llama3.2', 'ollama/codellama', 'ollama/mistral', 'ollama/phi3']) {
    const row = router.MODEL_REGISTRY[id];
    check(`${id} is still credKey:null, type:'local'`, row && row.credKey === null && row.type === 'local');
  }

  const describe = src('electron/lib/ollamaCatalog.cjs');
  check('describeInstalled still emits cloud-ollama and hardcodes credKey: null',
    /'cloud-ollama'/.test(describe) && /credKey:\s*null/.test(describe));

  check('FALLBACK_CHAIN\u2019s CONTENTS are unchanged — it gained an export, not an entry',
    router.FALLBACK_CHAIN.join(',') === 'gpt-4o,claude-3-5-sonnet,gemini-1.5-pro,llama-3.1-70b-groq,'
      + 'mistral-large,ollama/llama3.2,ollama/phi3', router.FALLBACK_CHAIN.join(','));

  const be = src('electron/ipc/browserEngine.cjs');
  check('browserEngine still exports register, closeBrowser and getBrowserPid, and GAINS searchWeb',
    /module\.exports = \{ register, closeBrowser, getBrowserPid, searchWeb \}/.test(be));
  check('searchWeb\u2019s first line is still the playwright absence check',
    /async function searchWeb\(query, engine = 'bing'\) \{\s*\n\s*if \(!playwright\) return \{ ok: false, error: 'playwright not installed' \};/.test(be));
  check('and the browser:search handler DELEGATES to it, so there is one implementation',
    /ipcMain\.handle\('browser:search', async \(_e, query, engine = 'bing'\) => searchWeb\(query, engine\)\)/.test(be));
  residual('that browser:search returns the identical playwright-absent object AT RUNTIME is '
    + 'specified and NOT EXECUTED here: browserEngine.cjs requires electron at module scope and '
    + 'node_modules is absent, so the assertion above is structural. It runs under npm run verify '
    + 'on a machine with node_modules installed');
  check('and browser:search\u2019s own direct channel is NOT modified — its unclassified query is a '
    + 'named limit, not coverage', !/egressBoundary/.test(be));

  const genome = src('electron/genome.cjs');
  check('genome.cjs is NOT edited — the channel was renamed to stay inside the declared models: prefix',
    /channels:\s*\[\s*'models:'\s*\]/.test(genome) && !/'search:'/.test(genome));

  const protectedFiles = ['electron/lib/loyaltyGuard.cjs', 'electron/lib/loyaltyCore.cjs',
    'electron/nucleusSealer.cjs', 'electron/lib/proposals.cjs', 'electron/lib/capability.cjs',
    'electron/lib/genomeApplier.cjs', 'shared/capabilities.json'];
  const touched = protectedFiles.filter((f) => /ollama-cloud|ollamaCloud|egressBoundary/.test(src(f)));
  check('no protected file mentions this tranche at all', touched.length === 0, touched.join(', '));
}

// ═══ (k) tracked files ════════════════════════════════════════════════════════

const SECRET_PREFIXES = ['sk-ant-', 'sk-', 'AIzaSy', 'ghp_', 'gho_', 'gsk_', 'xoxb-', 'hf_', 'pplx-'];
const PREFIX_RE = new RegExp(
  `(?:${SECRET_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[A-Za-z0-9_-]{16,}`);

function sectionTracked() {
  section('(k) no real-looking credential in any TRACKED file, docs included');
  let tracked = null;
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 })
      .split('\0').filter(Boolean);
  } catch { tracked = null; }

  if (!tracked) {
    residual('git is unavailable, so the tracked-file sweep did not run. An unrunnable check must '
      + 'not look like a satisfied one');
  } else {
    const TEXT = new Set(['.cjs', '.mjs', '.js', '.jsx', '.json', '.md', '.txt', '.yml', '.yaml',
      '.html', '.css', '.py', '.example', '.bat', '.sh', '']);
    const hits = [];
    let scanned = 0;
    for (const rel of tracked) {
      if (!TEXT.has(path.extname(rel))) continue;
      let text = '';
      try {
        const full = path.join(ROOT, rel);
        if (fs.statSync(full).size > 4 * 1024 * 1024) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch { continue; }
      scanned += 1;
      const m = text.match(PREFIX_RE);
      if (m && m[0] !== DUMMY) hits.push(`${rel}: ${m[0].slice(0, 6)}…`);
    }
    check('every tracked text file was swept', scanned > 100, scanned);
    check('and not one carries a known credential prefix', hits.length === 0, hits.slice(0, 4).join(' | '));

    let listed = '';
    try { listed = execFileSync('git', ['ls-files', '.env'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch { listed = ''; }
    check('.env is not tracked', listed === '', listed);
  }

  check('.gitignore has a line that is exactly .env',
    src('.gitignore').split('\n').some((l) => l.trim() === '.env'));
  check('verifyInvariants.cjs\u2019s own source has zero known-prefix matches — its planted literal is '
    + 'built by concatenation on purpose', !PREFIX_RE.test(src('scripts/verifyInvariants.cjs')));
  check('and so does this suite', !PREFIX_RE.test(src('scripts/verifyOllamaCloud.cjs')));

  const example = src('.env.example');
  check('.env.example has ZERO uncommented Ollama Cloud key assignments',
    !example.split('\n').some((l) => /^\s*OLLAMA_API_KEY\s*=/.test(l)));
  check('the key name appears in a COMMENT only, which cannot be mistaken for somewhere to paste',
    /#.*OLLAMA_API_KEY/.test(example));
  check('and it carries the non-secret base URL, which IS live because loadEnv parses this file',
    example.includes('OLLAMA_CLOUD_BASE_URL=https://ollama.com'));
  check('and NO shape hint for the Ollama key — every allow-list entry is a hole',
    !/OLLAMA_API_KEY\s*=\s*\S/.test(example));

  // THE LOAD-BEARING RULE. It cannot stop a key being put in .env; it stops Rama READING one there.
  const trees = ['electron', 'src', 'server', 'shared'];
  const readers = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
      if (!/\.(cjs|mjs|js|jsx|json)$/.test(e.name)) continue;
      let t = '';
      try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (/process\.env\.OLLAMA_API_KEY|process\.env\[['"]OLLAMA_API_KEY['"]\]/.test(t)) {
        readers.push(path.relative(ROOT, full));
      }
    }
  };
  for (const t of trees) walk(path.join(ROOT, t));
  check('NO shipped module reads an Ollama Cloud key out of process.env — the vault is the only store',
    readers.length === 0, readers.join(', '));

  // Every assignment site is ENUMERATED, so a new one is a visible, reviewed act.
  const sites = [];
  const walkAssign = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walkAssign(full); continue; }
      if (!/\.(cjs|mjs|js|jsx|json)$/.test(e.name)) continue;
      let t = '';
      try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
      for (const line of t.split('\n')) {
        if (!/OLLAMA_API_KEY/.test(line)) continue;
        if (/CRED_SERVICE\s*=\s*'OLLAMA_API_KEY'/.test(line)) continue;
        if (/credKey:\s*'OLLAMA_API_KEY'/.test(line) || /credKey:\s*CRED_SERVICE/.test(line)) continue;
        if (/^\s*OLLAMA_API_KEY:\s*\{/.test(line)) continue;                 // PROVIDER_LINKS key
        if (/^\s*(\*|\/\/)/.test(line)) continue;                            // a comment
        if (/OLLAMA_API_KEY\s*=\s*\S/.test(line) || /=\s*['"]?OLLAMA_API_KEY/.test(line)) {
          sites.push(`${path.relative(ROOT, full)}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
  };
  for (const t of ['electron', 'src', 'server', 'scripts', 'shared']) walkAssign(path.join(ROOT, t));
  check('the only assignment sites are the enumerated ones', sites.length === 0, sites.slice(0, 3).join(' | '));

  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    residual('.env does not exist here, which is the normal state on a fresh clone, so the '
      + 'key-in-.env check reports a residual rather than a pass');
  } else {
    let t = '';
    try { t = fs.readFileSync(envPath, 'utf8'); } catch { t = ''; }
    check('.env carries no Ollama Cloud key assignment — reported without naming any part of the line',
      !/^\s*OLLAMA_API_KEY\s*=\s*\S/m.test(t));
  }

  check('start.cjs warns about a key in .env without reading, printing, lengthing or hashing it',
    /\^\\s\*OLLAMA_API_KEY\\s\*=\\s\*\\S/.test(src('start.cjs'))
    && !/match\[1\]|\.slice\(|\.length/.test(
      src('start.cjs').split('ollama-key-in-env')[0].split('const envText')[1] ?? ''));
}

// ═══ (a) THE LEAK SWEEP — the one test this whole tranche rests on ═══════════

async function sectionLeakSweep() {
  section('(a) the credential is never spoken — asserted behaviourally, over a whole run');

  const consoleBuffer = [];
  const real = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args) => consoleBuffer.push(args.map((a) => util.inspect(a)).join(' '));

  const returns = [];
  const headerCorpus = [];
  let authedRequests = 0;

  storeData.clear();
  cloud._resetNotices();
  keyPresent();
  resetCalls();

  console.log = capture; console.warn = capture; console.error = capture;
  try {
    const record = (v) => { returns.push(util.inspect(v, { depth: 8 })); return v; };

    // Every exported function, plus every failure row, so the sweep covers the path where a request
    // is actually BUILT and not only the paths that refuse early.
    record(cloud.baseUrl());
    record(cloud.resolveBaseUrl());
    record(cloud.credentialState());
    record(cloud.isConfigured());
    record(cloud.status());
    record(cloud.toRegistryEntries());
    record(cloud.apiNameFor('gemma4:31b-cloud'));
    record(cloud.daemonTagFor('gemma4:31b'));
    record(cloud.isApiName('gemma4:31b'));
    record(cloud.isDaemonCloudTag('gemma4:31b-cloud'));
    record(egress.assemble({ kind: 'chat', model: 'gemma4:31b', messages: MESSAGES }));
    record(egress.assemble({ kind: 'search', query: { text: 'q', classification: 'public' } }));

    httpReply = okChatReply('hi');
    record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER }));
    record(await cloud.listModels({ user: MASTER }));

    httpReply = () => ({ ok: true, status: 200, body: '{"results":[{"title":"t","url":"https://x.test"}]}' });
    record(await cloud.webSearch({ query: { text: 'q', classification: 'public' }, user: MASTER }));

    for (const reply of [
      () => ({ ok: false, status: 401, body: '{"error":"unauthorized"}' }),
      () => ({ ok: false, status: 402, body: '{"error":"upgrade"}' }),
      () => ({ ok: false, status: 404, body: '{"error":"missing"}' }),
      () => ({ ok: false, status: 429, body: '{}' }),
      () => ({ ok: false, status: 503, error: 'Circuit open for https://ollama.com' }),
      () => ({ ok: false, status: 500, body: 'boom' }),
      () => ({ ok: false, status: 0, error: 'Timeout after 120000ms' }),
      () => ({ ok: true, status: 200, body: 'not json' }),
      () => ({ ok: true, status: 200, body: '{"message":{}}' }),
      () => ({ ok: true, status: 200, body: '{"error":"bad"}' }),
    ]) {
      cloud._resetNotices();
      httpReply = reply;
      record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER }));
    }

    cloud._resetNotices();
    record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b-cloud', user: MASTER }));
    record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b' }));
    record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: null }));
    keyAbsent();
    record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER }));
    vaultLocked();
    record(await cloud.chat({ messages: MESSAGES, apiModel: 'gemma4:31b', user: MASTER }));
    keyPresent();
    storeData.set('config/ollamaCloudBaseUrl', 'http://evil.test');
    cloud._resetNotices();
    record(cloud.resolveBaseUrl());
    record(cloud.status());
    storeData.clear();

    for (const c of httpCalls) {
      headerCorpus.push(util.inspect(c.headers, { depth: 6 }));
      if (c.headers && /^Bearer /.test(String(c.headers.Authorization ?? ''))) authedRequests += 1;
    }
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }

  const count = (hay, needle) => hay.split(needle).length - 1;
  const outside = `${returns.join('\n')}\n${consoleBuffer.join('\n')}`;
  const headers = headerCorpus.join('\n');

  check('the sweep exercised a REQUEST-BUILDING path, not only the refusals',
    authedRequests >= 3, authedRequests);
  check('and it captured console output, so "nothing was logged" is measured rather than assumed',
    consoleBuffer.length > 0, consoleBuffer.length);

  check('the dummy appears in the Authorization header of every authenticated request',
    count(headers, DUMMY) === authedRequests, `${count(headers, DUMMY)} vs ${authedRequests}`);
  check('and NOWHERE in any return value or any console line — not once',
    count(outside, DUMMY) === 0, count(outside, DUMMY));

  // THE SUBSTRING SWEEP is what catches a well-meant key.slice(0, 8) in a log line.
  const leaks = [];
  for (let len = 6; len <= DUMMY.length; len += 1) {
    for (let i = 0; i + len <= DUMMY.length; i += 1) {
      const frag = DUMMY.slice(i, i + len);
      if (outside.includes(frag)) leaks.push(frag);
    }
  }
  check('no substring of length >= 6 of the dummy appears outside that header either',
    leaks.length === 0, leaks.slice(0, 3).join(', '));

  check('nothing resembling a length, prefix or hash of the key was emitted',
    !/keyLength|keyPrefix|keyHash|key\.slice|maskedKey/i.test(outside + src('electron/lib/ollamaCloud.cjs')));

  // ── the FROZEN key sets, compared as sorted literal lists
  check('credentialState()\u2019s key set is exactly present, reason, source, vaultUnlocked',
    Object.keys(cloud.credentialState()).sort().join(',') === 'present,reason,source,vaultUnlocked',
    Object.keys(cloud.credentialState()).sort().join(','));
  const STATUS_KEYS = ['baseUrl', 'baseUrlOverrideRejected', 'baseUrlOverrideWhy', 'cloudCapability',
    'inFlight', 'maxConcurrent', 'monthStartedAt', 'monthlyBudget', 'monthlyBudgetKnown', 'present',
    'reason', 'remedy', 'source', 'usedTokMonth', 'vaultUnlocked'];
  check('status()\u2019s key set is exactly the fifteen frozen keys, so a length or prefix field cannot be added',
    Object.keys(cloud.status()).sort().join(',') === STATUS_KEYS.join(','),
    Object.keys(cloud.status()).sort().join(','));
  check('and cloudCapability\u2019s own keys are exactly dedicated and key',
    Object.keys(cloud.status().cloudCapability).sort().join(',') === 'dedicated,key');
  check('status() is frozen, so a caller cannot bolt a field on after the fact',
    Object.isFrozen(cloud.status()));
  check('source is \u2018vault\u2019 or null and never \u2018env\u2019 — there is no environment source to report',
    [null, 'vault'].includes(cloud.status().source)
    && !/source:\s*'env'/.test(src('electron/lib/ollamaCloud.cjs')));

  // ── the brief's own fact about the endpoint, pinned so nobody "helpfully" adds the other header
  const authed = httpCalls.filter((c) => c.headers && c.headers.Authorization);
  check('the credential travels as Authorization: Bearer',
    authed.length > 0 && authed.every((c) => c.headers.Authorization === `Bearer ${DUMMY}`));
  check('and x-api-key is NEVER sent — the keyed endpoint does not accept it alone',
    !httpCalls.some((c) => Object.keys(c.headers ?? {}).some((h) => /^x-api-key$/i.test(h))));
  check('authHeader is module-private and never exported',
    cloud.authHeader === undefined && !/authHeader,/.test(
      src('electron/lib/ollamaCloud.cjs').split('module.exports')[1] ?? ''));
  check('and the key is never assigned to a module-level variable',
    !/^let\s+(apiKey|key|credential|token)\b/m.test(src('electron/lib/ollamaCloud.cjs')));
}

// ═══ Run ══════════════════════════════════════════════════════════════════════

(async () => {
  sectionNaming();
  sectionDerivation();
  sectionBaseUrl();
  await sectionAbsence();
  await sectionReachability();
  sectionRows();
  await sectionPayload();

  const handlers = {};
  router.register({ handle: (ch, fn) => { handlers[ch] = fn; } });
  check('\u2014 the modelRouter IPC surface registered the three new channels',
    ['models:cloud-status', 'models:cloud-list', 'models:search-web'].every((c) => handlers[c]),
    Object.keys(handlers).filter((k) => /cloud|search/.test(k)).join(','));

  await sectionBothEgresses(handlers);
  await sectionCapability();
  sectionRendererWire();
  await sectionErrors();
  await sectionChain(handlers);
  await sectionLimits();
  sectionDaemonUntouched();
  sectionTracked();
  await sectionLeakSweep();

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
  console.log('\n  ALL PASS — and no live authenticated call to ollama.com was made by this suite\n');
  process.exit(0);
})();

