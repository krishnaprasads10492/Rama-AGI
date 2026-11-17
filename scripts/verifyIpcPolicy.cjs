'use strict';

/**
 * verifyIpcPolicy.cjs — the IPC boundary is declared, and the declaration is true (Section 196).
 *
 * WHAT THIS ANSWERS that nothing else did. `verifyReachability` asks whether a channel has a reader.
 * `verifyInvariants` asks whether the structural rules hold. Neither asks **who is allowed to call
 * a channel**, and the measurement that prompted this found 370 registrations of which 219 check
 * nothing at all.
 *
 * The gate itself is the easy part. The hard part is that a policy table is a CLAIM about code
 * somewhere else, and a claim that drifts is worse than no claim: a row saying `self` for a handler
 * whose capability check has been deleted reads as safety and is its absence. So the rows are
 * cross-referenced against the handlers, not trusted.
 *
 * Run: node scripts/verifyIpcPolicy.cjs   (or npm run verify:ipc-policy)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const guard = require(path.join(ROOT, 'electron/lib/ipcGuard.cjs'));
const { POLICY } = require(path.join(ROOT, 'electron/lib/ipcPolicy.cjs'));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t) { console.log(`\n  ${t}`); }

// ── The registrations, read from the code ───────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.cjs')) out.push(p);
  }
  return out;
}
const mainFiles = walk(path.join(ROOT, 'electron'))
  .filter((f) => !/preload\.cjs$/i.test(path.basename(f)));

/*
 * HOW AN AUTHORISATION CHECK IS RECOGNISED, and this has now been wrong twice.
 *
 * First pass: looked for `capability.*` only. It missed `denyUnless(...)` and a local
 * `deny(user, cap)`, and reported 254 open handlers when the figure was 219 (196.2).
 *
 * Second pass: still missed the WRAPPER form. `gitAuth.cjs` registers every one of its seven
 * channels as `gated('vault.write', fn)` — a closure that calls `capability.deny` before the
 * handler — and `\bgate\(` does not match `gated(`. So seven fully gated channels were filed as
 * unclassified, and the table understated the position while reading as if it were measured.
 *
 * The lesson is the same both times: a pattern that does not match the code it audits produces a
 * number that is confidently wrong. So the two forms are separated and the second is DECLARED:
 *
 *   DIRECT_IDIOM   the check written in the handler body
 *   GATE_WRAPPERS  names of closures that perform the check for the handler they wrap
 *
 * A declared list can rot, so it is cross-checked below: every name here must really be defined in
 * a main-process file with a capability check inside it. A wrapper that stops checking stops
 * counting, and the rows that rest on it go red.
 */
const DIRECT_IDIOM = /capability\.deny\(|capability\.can\(|requireCap\(|denyUnless\(|\bdeny\(\s*user/;

/*
 * Third pass, and the rule is now DERIVED rather than listed. `agents:spawn` reads
 *
 *     ipcMain.handle('agents:spawn', async (_e, { user, type, task }) =>
 *       createAgent({ user, type, task }));
 *
 * and `createAgent` checks `agents.spawn` on its first line. A name list would need `createAgent`
 * added to it, and the next module would need the next name, forever — which is how a list becomes
 * the thing that is wrong. The general shape is DELEGATION: a handler is guarded when it calls a
 * function, defined in its own file, that checks. That subsumes the wrapper form (`gated(cap, fn)`)
 * without naming it and catches the worker form too.
 *
 * The window is 400 characters from the definition: enough for every real case here (`gated` checks
 * on its second line, `createAgent` on its first, `guard` on its third) and short enough that an
 * unrelated check further down cannot vouch for a function that does nothing.
 */
const CHECK_WINDOW = 400;

/** Names defined in `src` whose definition is followed closely by a capability check. */
function checkingFunctionsIn(src) {
  const names = new Set();
  const defs = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of src.matchAll(defs)) {
    const name = m[1] || m[2];
    if (!name) continue;
    if (DIRECT_IDIOM.test(src.slice(m.index, m.index + CHECK_WINDOW))) names.add(name);
  }
  return names;
}

function isGuarded(body, checkers) {
  if (DIRECT_IDIOM.test(body)) return true;
  for (const name of checkers) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(body)) return true;
  }
  return false;
}

/** @returns {Map<string, {file:string, body:string, guarded:boolean}>} */
function readRegistrations() {
  const out = new Map();
  for (const f of mainFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const checkers = checkingFunctionsIn(src);
    const marks = [...src.matchAll(/ipcMain\.(?:handle|handleOnce|on|once)\(\s*['"`]([^'"`]+)['"`]/g)];
    for (let i = 0; i < marks.length; i += 1) {
      const channel = marks[i][1];
      const body = src.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : src.length);
      const guarded = isGuarded(body, checkers);
      const prev = out.get(channel);
      // Registered in two places: keep the guarded reading, so the table can never claim `self` on
      // the strength of one copy while another is open.
      if (!prev || (!prev.guarded && guarded)) {
        out.set(channel, { file: path.relative(ROOT, f), body, guarded });
      }
    }
  }
  return out;
}
const registrations = readRegistrations();

console.log('\nRama IPC policy — who may call what, declared and cross-checked');
console.log(`        ${registrations.size} registered channels, ${Object.keys(POLICY).length} policy rows`);

// ═══ (1) The gate's decision, driven directly ══════════════════════════════
section('the gate decides correctly, with no Electron and no window');

const allow = () => true;
eq('a foreign sender is refused whatever the policy says',
  guard.decide({ channel: 'x:y', senderTrusted: false, verdict: 'public', user: null, can: allow }).allow,
  false);
eq('and the refusal names the channel rather than being silent',
  /x:y/.test(guard.decide({ channel: 'x:y', senderTrusted: false, verdict: 'public', user: null, can: allow }).reason || ''),
  true);
eq('a public channel runs',
  guard.decide({ channel: 'window:minimize', senderTrusted: true, verdict: 'public', user: null, can: allow }).allow,
  true);
eq('a bootstrap channel runs with nobody signed in',
  guard.decide({ channel: 'auth:login-step1', senderTrusted: true, verdict: 'bootstrap', user: null, can: () => false }).allow,
  true);
eq('a self-checking channel runs, because its handler does the checking',
  guard.decide({ channel: 'fs:read-file', senderTrusted: true, verdict: 'self', user: null, can: () => false }).allow,
  true);
eq('an observed channel runs and is recorded as observed',
  guard.decide({ channel: 'store:get', senderTrusted: true, verdict: 'observe', user: null, can: allow }).record,
  'observed');

// THE CENTRALLY ENFORCED CASE, both ways round.
eq('a cap: channel runs when the capability layer says yes',
  guard.decide({ channel: 'a:b', senderTrusted: true, verdict: 'cap:fs.write', user: { tier: 0 }, can: () => true }).allow,
  true);
eq('and is refused when it says no',
  guard.decide({ channel: 'a:b', senderTrusted: true, verdict: 'cap:fs.write', user: { tier: 9 }, can: () => false }).allow,
  false);
eq('the refusal names the capability, so the reason is actionable',
  /fs\.write/.test(guard.decide({ channel: 'a:b', senderTrusted: true, verdict: 'cap:fs.write', user: null, can: () => false }).reason || ''),
  true);
// REDBY: default a missing capability layer to "allowed and silent". An unclassified channel is
// reported; a cap: row with no way to evaluate it must also be reported, never quietly passed.
eq('a cap: row with no capability layer is reported rather than silently allowed',
  guard.decide({ channel: 'a:b', senderTrusted: true, verdict: 'cap:fs.write', user: null, can: null }).record,
  'no-capability-layer');
eq('an unclassified channel runs, and says so',
  guard.decide({ channel: 'new:thing', senderTrusted: true, verdict: undefined, user: null, can: allow }).record,
  'unclassified');
eq('a malformed verdict is reported, not obeyed',
  guard.decide({ channel: 'a:b', senderTrusted: true, verdict: 'sort-of', user: null, can: allow }).record,
  'malformed-verdict');
eq('cap: with an empty name is not a capability', guard.capOf('cap:'), null);
eq('and a bare word is not one either', guard.capOf('self'), null);

// ═══ (2) Installation behaviour, on a fake ipcMain ═════════════════════════
section('installing the gate changes who runs, and nothing else');

function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handle: (ch, fn) => handlers.set(ch, fn),
    handleOnce: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => { if (!listeners.has(ch)) listeners.set(ch, []); listeners.get(ch).push(fn); },
    once: (ch, fn) => { if (!listeners.has(ch)) listeners.set(ch, []); listeners.get(ch).push(fn); },
    removeListener: (ch, fn) => {
      const l = listeners.get(ch) || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    off: (ch, fn) => { const l = listeners.get(ch) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    _invoke: (ch, event, ...args) => handlers.get(ch)?.(event, ...args),
    _emit: (ch, event, ...args) => (listeners.get(ch) || []).map((f) => f(event, ...args)),
    _listeners: (ch) => (listeners.get(ch) || []).length,
  };
}

{
  const ipcMain = fakeIpcMain();
  let ran = 0;
  const gate = guard.install({
    ipcMain,
    policy: { 'ok:go': 'public', 'need:cap': 'cap:fs.write', 'quiet:one': 'observe' },
    can: (user) => user?.tier === 0,
    isOurSender: (e) => e?.ours === true,
    principal: (e) => e?.who || null,
    report: () => {},
  });
  ipcMain.handle('ok:go', () => { ran += 1; return { ok: true }; });
  ipcMain.handle('need:cap', () => { ran += 1; return { ok: true }; });
  ipcMain.handle('quiet:one', () => { ran += 1; return { ok: true }; });

  eq('a trusted call reaches the handler', ipcMain._invoke('ok:go', { ours: true })?.ok, true);
  eq('a call from outside the app does not', ipcMain._invoke('ok:go', { ours: false })?.ok, false);
  check('and the handler never ran for it', ran === 1, `ran ${ran}`);

  eq('a cap: channel refuses the wrong tier',
    ipcMain._invoke('need:cap', { ours: true, who: { tier: 9 } })?.ok, false);
  eq('and admits the right one',
    ipcMain._invoke('need:cap', { ours: true, who: { tier: 0 } })?.ok, true);

  // THE WHOLE POINT OF THE DAY-ONE DESIGN: an unclassified channel still works.
  ipcMain.handle('brand:new', () => ({ ok: true, fresh: true }));
  eq('a channel with no policy row still works', ipcMain._invoke('brand:new', { ours: true })?.fresh, true);
  check('and it is named for a reader', gate.unclassified().includes('brand:new'),
    gate.unclassified().join(', '));

  // LISTENERS: the identity hazard that made `principalBinding` leave `on` alone.
  const listener = () => { ran += 1; };
  ipcMain.on('quiet:one', listener);
  eq('a listener is registered once', ipcMain._listeners('quiet:one'), 1);
  ipcMain.removeListener('quiet:one', listener);
  eq('and removing it by its ORIGINAL function works despite the wrapper',
    ipcMain._listeners('quiet:one'), 0);

  gate.uninstall();
  eq('uninstall restores the real handle', typeof ipcMain.handle, 'function');
}

// REDBY: let the payload decide who is calling. This is the Section 150.1 defect, and a gate that
// accepts `{ user }` from the renderer would look like a control while being a way around one.
{
  const ipcMain = fakeIpcMain();
  let threw = null;
  try {
    guard.install({ ipcMain, policy: {}, can: allow, isOurSender: () => true });
  } catch (err) { threw = err.message; }
  check('the gate REFUSES to install without a principal resolver',
    threw !== null && /principal/i.test(threw), threw || 'installed anyway');
}
{
  const ipcMain = fakeIpcMain();
  const opts = { ipcMain, policy: {}, can: allow, isOurSender: () => true, principal: () => null, report: () => {} };
  const first = guard.install(opts);
  const second = guard.install(opts);
  check('installing twice is refused, so no call is counted or wrapped twice',
    first !== null && second === null);
  first.uninstall();
}

// A cap: row must consult the principal, NOT the arguments. Driven by handing the gate a principal
// resolver that says "nobody" while the payload claims to be master.
{
  const ipcMain = fakeIpcMain();
  const gate = guard.install({
    ipcMain,
    policy: { 'priv:act': 'cap:self-modify.apply' },
    can: (user, cap) => user?.tier === 0 && typeof cap === 'string',
    isOurSender: () => true,
    principal: () => null,          // the session table says: nobody is signed in
    report: () => {},
  });
  ipcMain.handle('priv:act', () => ({ ok: true, didIt: true }));
  const res = ipcMain._invoke('priv:act', {}, { user: { id: 1, tier: 0, username: 'master' } });
  eq('a payload claiming tier 0 cannot satisfy a cap: row', res?.ok, false);
  check('and the handler did not run', !res?.didIt);
  gate.uninstall();
}

// ═══ (3) The table is true about the code ══════════════════════════════════
section('every policy row is true about the handler it describes');

/*
 * THE DECLARED WRAPPER NAMES ARE CROSS-CHECKED, because a declared list is a claim too.
 *
 * Each name must be DEFINED somewhere in the main process with a capability check inside its body.
 * The window is the 400 characters after the definition, which comfortably covers both real shapes
 * (`gitAuth`'s `gated` checks on its second line, `tracking`'s `guard` on its third) and is small
 * enough that an unrelated check further down the file cannot vouch for a wrapper that does nothing.
 */
/*
 * THE DELEGATION RULE IS ITSELF CHECKED, on the two shapes that drove it.
 *
 * Nothing declares the checking functions any more, so the thing that can rot is the derivation. If
 * `checkingFunctionsIn` stops finding them, 39 channels silently return to reading as unclassified
 * and the measurement understates again — quietly, which is how this went wrong three times.
 */
const gitAuthSrc = fs.readFileSync(path.join(ROOT, 'electron/ipc/gitAuth.cjs'), 'utf8');
const agentsSrc = fs.readFileSync(path.join(ROOT, 'electron/ipc/agentOrchestrator.cjs'), 'utf8');
check('the wrapper form is recognised: gitAuth\'s gated(cap, fn) counts as a check',
  checkingFunctionsIn(gitAuthSrc).has('gated'));
check('and the worker form: agentOrchestrator\'s createAgent counts as one too',
  checkingFunctionsIn(agentsSrc).has('createAgent'));
// REDBY: let a function with no check vouch for a handler. `repo()` sits beside `gated` in gitAuth
// and only reads a property; if the window grew, it would start counting as a gate.
check('a neighbouring helper that does not check is not mistaken for one',
  !checkingFunctionsIn(gitAuthSrc).has('repo'),
  [...checkingFunctionsIn(gitAuthSrc)].join(', '));

const rows = Object.entries(POLICY);
check('the table is frozen, so nothing can widen it at runtime', Object.isFrozen(POLICY));

/*
 * A `cap:` ROW MUST NAME A CAPABILITY THAT EXISTS, and this is the row that stops a typo bricking a
 * feature in the quietest possible way.
 *
 * `capability.can()` returns FALSE for an unknown capability — correct, because unknown means denied
 * — so `cap:self-modfiy.apply` would not throw, would not warn, and would refuse every caller
 * including master, for as long as it took someone to notice they could no longer approve anything.
 * Fail-closed is the right default and it is exactly what makes the typo invisible.
 */
const matrix = require(path.join(ROOT, 'shared/capabilities.json')).capabilities;
const unknownCaps = rows
  .map(([ch, v]) => [ch, guard.capOf(v)])
  .filter(([, cap]) => cap !== null && !(cap in matrix))
  .map(([ch, cap]) => `${ch} wants "${cap}"`);
check('every centrally enforced row names a capability the matrix defines',
  unknownCaps.length === 0, unknownCaps.join('; '));
check('every verdict is one the gate understands',
  rows.every(([, v]) => guard.isKnownVerdict(v)),
  rows.filter(([, v]) => !guard.isKnownVerdict(v)).map(([c, v]) => `${c}=${v}`).join(', '));

// RULE: a `self` row claims the handler checks a capability. If the check is removed, the row is a
// lie that reads as safety. This is the cross-reference that makes the table evidence.
const lyingSelf = rows
  .filter(([ch, v]) => v === 'self')
  .filter(([ch]) => registrations.has(ch) && !registrations.get(ch).guarded)
  .map(([ch]) => ch);
check('every "self" row has a handler that really does check',
  lyingSelf.length === 0,
  lyingSelf.length ? `no check found in: ${lyingSelf.join(', ')}` : '');

// RULE: the other direction. A handler that checks but is filed as `observe` understates the
// position, which is the safer error but still an untrue row.
const understated = rows
  .filter(([ch, v]) => v === 'observe')
  .filter(([ch]) => registrations.get(ch)?.guarded)
  .map(([ch]) => ch);
check('no handler that checks is filed as unclassified',
  understated.length === 0,
  understated.length ? `guarded but filed observe: ${understated.join(', ')}` : '');

// RULE: every registered channel has a row. This is what stops the table going stale as the app grows.
const unrowed = [...registrations.keys()].filter((ch) => !(ch in POLICY)).sort();
check('every registered channel has a policy row',
  unrowed.length === 0,
  unrowed.length ? `no row for: ${unrowed.join(', ')}` : '');

// RULE: and no row for a channel that no longer exists, so the table cannot accumulate fiction.
const orphanRows = rows.map(([ch]) => ch).filter((ch) => !registrations.has(ch)).sort();
check('no policy row describes a channel that is not registered',
  orphanRows.length === 0,
  orphanRows.length ? `stale rows: ${orphanRows.join(', ')}` : '');

// ═══ (4) The ratchet: `observe` may only shrink ════════════════════════════
section('the unclassified count is a debt register, and it may only go down');

const BASELINE = path.join(__dirname, 'ipc-policy-baseline.json');
const tally = rows.reduce((acc, [, v]) => {
  const key = guard.capOf(v) ? 'enforced' : v;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
console.log(`        self ${tally.self || 0}, observe ${tally.observe || 0}, bootstrap `
  + `${tally.bootstrap || 0}, public ${tally.public || 0}, enforced here ${tally.enforced || 0}`);

let baseline = null;
if (fs.existsSync(BASELINE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
} else {
  baseline = {
    writtenAt: new Date().toISOString().slice(0, 10),
    why: 'Ceiling for the number of IPC channels with no authorisation check (spec Section 196). '
      + 'It may only go DOWN. Raising it means a new channel was added that trusts whoever calls it, '
      + 'which is the thing this register exists to stop happening quietly.',
    maxObserve: tally.observe || 0,
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`        BASELINE WRITTEN: maxObserve ${baseline.maxObserve}. It may only shrink.`);
}

// REDBY: add a channel with no capability check and no policy row, then file it as `observe`.
check('the number of unclassified channels has not grown',
  (tally.observe || 0) <= baseline.maxObserve,
  `observe ${tally.observe || 0} vs ceiling ${baseline.maxObserve}`);

// AND THE CEILING MUST EQUAL THE REALITY. A ceiling with slack can never go red, which is the quiet
// way a ratchet becomes decoration — the lesson Section 183.4 paid for twice.
eq('the ceiling equals the real count, so there is no slack to hide in',
  baseline.maxObserve, tally.observe || 0);

// ═══ (5) The hardening that is not about policy ════════════════════════════
section('the window-level defences are still in place');

const mainSrc = fs.readFileSync(path.join(ROOT, 'electron/main.cjs'), 'utf8');
const badgeSrc = fs.readFileSync(path.join(ROOT, 'electron/badgeWindow.cjs'), 'utf8');

// REDBY: flip any of these three. They are the floor the whole renderer boundary stands on.
check('contextIsolation is on in every window that is created',
  !/contextIsolation:\s*false/.test(mainSrc) && !/contextIsolation:\s*false/.test(badgeSrc));
check('nodeIntegration is off in every window',
  !/nodeIntegration:\s*true/.test(mainSrc) && !/nodeIntegration:\s*true/.test(badgeSrc));
check('webSecurity is never disabled', !/webSecurity:\s*false/.test(mainSrc + badgeSrc));
check('no window enables the <webview> tag', !/webviewTag:\s*true/.test(mainSrc + badgeSrc));

check('a renderer cannot open a new window', /setWindowOpenHandler/.test(mainSrc)
  && /action:\s*'deny'/.test(mainSrc));
// Section 196.3: window.open was covered, navigation away was not.
check('and cannot navigate the existing window away either',
  /will-navigate/.test(mainSrc) && /preventDefault/.test(mainSrc));
check('attaching a webview is refused', /will-attach-webview/.test(mainSrc));

check('the CSP denies plugins, rebasing and form posts',
  /object-src 'none'/.test(mainSrc) && /base-uri/.test(mainSrc) && /form-action 'none'/.test(mainSrc));

/*
 * THE EXTERNAL-URL DECISION IS DRIVEN, NOT READ (196.3).
 *
 * These rows used to look for `new URL(` and the words `username`/`password` in the handler body.
 * Mutation testing killed that idea: a mutation that replaced the parse with a prefix test left the
 * words in place and every check passed. So the judgement moved into `lib/externalUrl.cjs` and is
 * called here with the inputs that matter. Positional checks prove where code is; only a call proves
 * what it does.
 */
section('the external-URL judgement, driven with real input');
const externalUrl = require(path.join(ROOT, 'electron/lib/externalUrl.cjs'));

eq('an ordinary https link is allowed', externalUrl.judge('https://docs.example.com/x').ok, true);
eq('and plain http too, because a local tool often serves it', externalUrl.judge('http://localhost:8001/').ok, true);
eq('a file: URL is refused', externalUrl.judge('file:///C:/Windows/System32/cmd.exe').ok, false);
eq('a javascript: URL is refused', externalUrl.judge('javascript:alert(1)').ok, false);
eq('a data: URL is refused', externalUrl.judge('data:text/html,<script>x</script>').ok, false);
// The ones that make an allowlist of two the only defensible shape: a platform-registered scheme
// turns "open a link" into "start a program with an argument".
eq('an OS-handler scheme is refused', externalUrl.judge('ms-msdt:/id PCWDiagnostic').ok, false);
eq('and so is a vscode: link', externalUrl.judge('vscode://file/c:/x').ok, false);
eq('a URL carrying a credential is refused',
  externalUrl.judge('https://user:ghp_secret@github.com/x').ok, false);
eq('a URL carrying only a username is refused too',
  externalUrl.judge('https://user@github.com/x').ok, false);
eq('and the refusal says it was the credential, not something vague',
  /credential/i.test(externalUrl.judge('https://u:p@h/').error || ''), true);
eq('nonsense is refused rather than passed on', externalUrl.judge('not a url').ok, false);
eq('an empty string is refused', externalUrl.judge('').ok, false);
eq('a non-string is refused', externalUrl.judge(null).ok, false);
// REDBY: return the caller's string instead of the parsed one. Validating one string and opening
// another is how a check gets bypassed by whatever difference the two have.
eq('the PARSED url is what comes back, not the input',
  externalUrl.judge('https://example.com').url, 'https://example.com/');
check('and the allowed set is exactly http and https',
  externalUrl.ALLOWED_PROTOCOLS.join(',') === 'http:,https:', externalUrl.ALLOWED_PROTOCOLS.join(','));
check('the judgement cannot act: it reaches for no shell, no electron and no disk',
  !/require\(['"](electron|child_process|fs)['"]\)|shell\./.test(
    fs.readFileSync(path.join(ROOT, 'electron/lib/externalUrl.cjs'), 'utf8'),
  ));
check('and the handler obeys it rather than deciding again',
  /externalUrl\.judge\(url\)/.test(mainSrc) && /if \(!verdict\.ok\) return verdict;/.test(mainSrc));

section('the gate is installed where it can see everything');

/*
 * STRICT PATTERN, because a loose one survived a mutation. `mainSrc.indexOf('ipcGuard.install(')`
 * finds the text even when the call is disabled — `null && ipcGuard.install({...})` passed. The
 * pattern below requires the call to be the whole right-hand side of the assignment, which that
 * mutation no longer satisfies. It is still a textual check and it is listed as such at the end:
 * nothing short of running Electron proves the gate is live, and this suite runs under bare Node.
 */
const INSTALL_CALL = /const ipcGate = ipcGuard\.install\(\{/;
check('the gate is installed, as the whole right-hand side of its assignment',
  INSTALL_CALL.test(mainSrc));
const gateAt = mainSrc.search(INSTALL_CALL);
const firstReg = mainSrc.search(/ipcMain\.(?:handle|on)\(/);
check('and before the first handler registers, or it guards nothing that went first',
  gateAt > 0 && firstReg > 0 && gateAt < firstReg, `gate at ${gateAt}, first registration at ${firstReg}`);
// And it must be handed the principal resolver, not left to read the payload.
check('the gate is wired to the principal, not to the payload',
  /principal:\s*\(event\)\s*=>\s*principalBinding\.getPrincipal\(event\)/.test(mainSrc));
/*
 * PRESENT **AND** FIRST, in that order, because `<` alone let a mutation live.
 *
 * This row was `indexOf('principalBinding.install(ipcMain)') < gateAt`. Delete the call entirely and
 * `indexOf` returns -1, which is less than any position, so removing the defence that stops a
 * renderer claiming `{ tier: 0 }` PASSED the check that exists to protect it. Absence has to be
 * tested before order is — the same mistake shape as Section 190's `some()` on an empty list and
 * 188's index outliving its array.
 */
const bindAt = mainSrc.indexOf('principalBinding.install(ipcMain)');
check('principal binding is installed at all', bindAt >= 0);
check('and before the policy gate, so any renderer claim is already replaced',
  bindAt >= 0 && gateAt > 0 && bindAt < gateAt, `binding at ${bindAt}, gate at ${gateAt}`);

// ═══ (6) The shipped binary's own fuses ════════════════════════════════════
//
// WHAT A FUSE IS FOR. Everything above defends the renderer boundary. A fuse defends the BINARY: a
// packaged Electron executable will, by default, act as a general-purpose Node interpreter when
// `ELECTRON_RUN_AS_NODE` is set, honour `NODE_OPTIONS`, and accept `--inspect`. None of that is
// Rāma's behaviour, and all of it is useful to somebody else — a signed, trusted executable already
// on master's machine is a better place to run code from than anything an attacker could bring.
//
// These three are safe to switch off here, and that was CHECKED rather than assumed:
//   runAsNode                              nothing in the app sets it. `verifyCjsLoadable` does, but
//                                          against the DEV binary in node_modules; fuses are flipped
//                                          on the packaged one, so the suite is unaffected.
//   enableNodeOptionsEnvironmentVariable   `sandboxEngine` does set NODE_OPTIONS — on a spawned
//                                          SYSTEM `node` (`['node', [tmpFile]]`), not on Electron,
//                                          so this fuse cannot reach it.
//   enableNodeCliInspectArguments          debugging happens in dev, where the fuse is not applied.
console.log('\n  the shipped binary cannot be used as a general-purpose Node runtime');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const fuses = (pkg.build || {}).electronFuses || {};

// REDBY: delete the block, or flip any of the three to true. Each one re-opens a way to execute
// arbitrary code through an executable the user already trusts.
eq('the packaged binary refuses to run as Node', fuses.runAsNode, false);
eq('and ignores NODE_OPTIONS', fuses.enableNodeOptionsEnvironmentVariable, false);
eq('and refuses --inspect', fuses.enableNodeCliInspectArguments, false);

/*
 * THE TWO I AM DELIBERATELY NOT SETTING, asserted as absent so that enabling one is a VISIBLE change
 * rather than a quiet line in a config file.
 *
 * `enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar` are the fuses that would detect a
 * tampered bundle, and they are the ones most worth having. They also interact with `asarUnpack`,
 * which this project needs for `node-pty` and `argon2`, and on Windows that combination has a
 * history of failing at startup rather than at build time.
 *
 * `vite build` runs here but a PACKAGED build does not, so I cannot test the one failure mode that
 * matters. Enabling a fuse that can only be proven on master's machine, in a project that lost four
 * tranches to exactly that kind of build problem, would be trading a real risk for a theoretical
 * gain. They are recommended in 196.14 and left off until there is a test build to prove them.
 */
check('the asar-integrity fuses are left off until a packaged build can prove them',
  fuses.enableEmbeddedAsarIntegrityValidation === undefined
  && fuses.onlyLoadAppFromAsar === undefined,
  JSON.stringify(fuses));

console.log('\n  held by hand, listed rather than implied:');
console.log('    - `self` is cross-referenced against a GUARD IDIOM found in the handler body. It');
console.log('      proves a check is present, NOT that the check names the right capability. Picking');
console.log('      the right capability per channel is the tranche work 196.5 describes');
console.log('    - `observe` means nothing is enforced for that channel. 192 of them is not a');
console.log('      position anyone should be comfortable with; it is an honest starting number');
console.log('    - the sender check trusts Electron to tell the truth about `event.sender`. If that');
console.log('      is wrong, nothing above holds, and nothing in this process could detect it');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
