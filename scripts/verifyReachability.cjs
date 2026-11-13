#!/usr/bin/env node
/**
 * verifyReachability.cjs — is it WIRED UP, not is it correct.
 *
 * WHY THIS EXISTS, and it is the conclusion of a whole-repository audit (spec Section 143).
 *
 * This project has 39 verification suites and 4,874 assertions, and they all answer the same kind of
 * question: given that something is called, does it behave correctly? **Nothing asked whether it is
 * called at all.** The audit found that gap had been paid for five separate times:
 *
 *   nucleusSealer's `behavioral` block   declared, read by nothing          (Section 142)
 *   CHART_TYPES' `warn` strings          declared, rendered by nothing      (Section 139)
 *   the voice ladder's `nextStep`        computed, only ever a tooltip      (Section 142)
 *   functionTracking.record()            built and tested, zero call sites  (Section 138)
 *   brokerConnectors.driftReport()       built and tested, no fetcher       (Section 141)
 *
 * Every one passed every suite. A contract with no producer is indistinguishable from a working
 * feature when the only thing you test is the contract.
 *
 * THE RATCHET, WHICH IS THE WHOLE DESIGN. A rule saying "every exposed member must have a caller"
 * would go red on a large existing backlog, and a suite that is red on arrival gets deleted rather
 * than read. So the known gaps are named in `KNOWN_ORPHANS` below, each with a reason, and the suite
 * asserts:
 *
 *   1. every orphan found is already named — a NEW one fails immediately
 *   2. every name in the list is still an orphan — a FIXED one must be removed from the list, so the
 *      backlog cannot silently become a lie about work still outstanding
 *
 * That second rule is what makes it a ratchet instead of a suppression file. The list is a debt
 * register: it only shrinks, and it is printed in full on every run so the size of the debt is never
 * out of sight.
 *
 * Run: node scripts/verifyReachability.cjs   (or npm run verify:reachability)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

// ── File collection ─────────────────────────────────────────────────────────
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.git') walk(p, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

const electronFiles = walk(path.join(ROOT, 'electron'), ['.cjs']);
const rendererFiles = walk(path.join(ROOT, 'src'), ['.js', '.jsx']);
const PRELOAD = path.join(ROOT, 'electron', 'preload.cjs');

const preloadSrc = fs.readFileSync(PRELOAD, 'utf8');

// THERE IS MORE THAN ONE PRELOAD, and the first version of this suite knew about one. The badge
// window has its own bridge, `electron/badgePreload.cjs`, so `badge:clicked` — registered with
// `ipcMain.on` in `badgeWindow.cjs:121` and sent from that preload — read as an unreachable channel.
// Every preload is a caller surface; collecting them by name rather than listing one means a third
// window's bridge is picked up automatically.
const preloadFiles = electronFiles.filter((f) => /preload\.cjs$/i.test(path.basename(f)));
const allPreloadSrc = preloadFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const rendererByFile = rendererFiles.map((f) => fs.readFileSync(f, 'utf8'));
const rendererSrc = rendererByFile.join('\n');
// Preloads are excluded from "main process" text so a channel named only in a preload is not
// mistaken for one registered there.
const mainSrc = electronFiles
  .filter((f) => !preloadFiles.includes(f))
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');

console.log('\nRama reachability — registered, exposed, and actually called');
console.log(`        ${electronFiles.length} main-process files, ${rendererFiles.length} renderer files`);

// ═══════════════════════════════════════════════════════════════════════════
// KNOWN ORPHANS — the debt register. Each entry must carry a reason.
//
// Adding a name here is a deliberate act that says "this is not wired up yet, and here is why".
// Removing something from the code without removing it here makes the suite fail, which is the point:
// the list cannot drift out of date in either direction.
// ═══════════════════════════════════════════════════════════════════════════

/** Channels registered in main that no preload or renderer code names. */
// EMPTY, AND THAT IS THE POINT. It held `models:roles` and `models:role-research` — the audit's H6,
// the only 2 of 377 registered channels that nothing named. Both now have a preload pair and a Roles
// tab (Section 145), so they were removed from here, which the "no stale entry" rule REQUIRED: the
// suite failed until they were. Every registered channel is now named by a caller surface.
const KNOWN_ORPHAN_CHANNELS = Object.freeze({});

/**
 * Preload members with no renderer caller.
 *
 * NOT A DEFECT ON ITS OWN: the bridge is a deliberate superset, and a namespace master has not opened
 * a page for yet is a capability waiting rather than a bug. What the audit found is that NOBODY KNEW
 * WHICH, so a genuinely broken wiring looked identical to a deliberate spare. This list is that
 * knowledge, written down.
 *
 * Seeded from the measured set on the day the suite was written, so the number can only go down.
 */
let KNOWN_ORPHAN_MEMBERS = [];
const SEED_PATH = path.join(__dirname, 'reachability-baseline.json');
if (fs.existsSync(SEED_PATH)) {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  KNOWN_ORPHAN_MEMBERS = Array.isArray(seed.unusedPreloadMembers) ? seed.unusedPreloadMembers : [];
}

// ═══ (1) Channels registered in the main process ═══════════════════════════
console.log('\n  every channel registered in main is named somewhere a caller could reach it');

// THREE REGISTRATION MECHANISMS, NOT ONE, and the first version of this suite only knew about the
// literal `ipcMain.handle('x', ...)` form. It then reported 46 missing handlers that were all
// registered perfectly well — `marketIntel.cjs:595` registers 38 of them by iterating an object whose
// KEYS are the channel names, and the fire-and-forget channels use `ipcMain.on` because the preload
// reaches them with `send` rather than `invoke`.
//
// A guard that cries wolf on a correct codebase is worse than no guard, so the detection matches what
// the codebase actually does:
//   ipcMain.handle('x', …)     the common form
//   ipcMain.on('x', …)         send/fire-and-forget channels
//   'x': fn                    an entry in a registration table
const channels = new Set();
for (const m of mainSrc.matchAll(/ipcMain\.(?:handle|on)\(\s*['"`]([^'"`]+)['"`]/g)) channels.add(m[1]);
for (const m of mainSrc.matchAll(/ipcRec(?:order)?\.(?:handle|on)\(\s*['"`]([^'"`]+)['"`]/g)) channels.add(m[1]);

// The namespaces that are PROVEN to be channel namespaces, taken from the explicit registrations
// above. This set is what makes the table-key form safe to read.
const nsSeen = new Set([...channels].map((c) => c.split(':')[0]));

// A registration-table key, restricted to a proven namespace. Unrestricted, `'x:y':` also matches
// Ollama model tags — the first version of this row reported `gemma4:31b`, `qwen3-coder:480b` and
// eleven other MODEL NAMES as unreachable IPC channels, because a model catalogue is also an object
// keyed by colon-separated strings. Calibrating on namespaces the codebase already registers means
// the rule cannot invent a channel out of unrelated data.
for (const m of mainSrc.matchAll(/['"`]([a-z][\w-]*:[\w-]+)['"`]\s*:/g)) {
  if (nsSeen.has(m[1].split(':')[0])) channels.add(m[1]);
}
check('channels were found to check', channels.size > 100, String(channels.size));
console.log(`        ${channels.size} channels registered`);

const orphanChannels = [];
for (const ch of channels) {
  const named = allPreloadSrc.includes(`'${ch}'`) || allPreloadSrc.includes(`"${ch}"`)
    || allPreloadSrc.includes(`\`${ch}\``)
    || rendererSrc.includes(`'${ch}'`) || rendererSrc.includes(`"${ch}"`)
    || rendererSrc.includes(`\`${ch}\``);
  if (!named) orphanChannels.push(ch);
}
orphanChannels.sort();

// RULE 1: no NEW orphan. This is the row that catches the next one on the day it is written.
const unexpected = orphanChannels.filter((c) => !(c in KNOWN_ORPHAN_CHANNELS));
check('no channel is registered that nothing anywhere names',
  unexpected.length === 0,
  unexpected.length ? `unregistered-but-unreachable: ${unexpected.join(', ')}` : '');

// RULE 2: no STALE entry. A fixed orphan must leave the register.
const staleChannels = Object.keys(KNOWN_ORPHAN_CHANNELS).filter((c) => !orphanChannels.includes(c));
check('every channel in the debt register is still actually an orphan',
  staleChannels.length === 0,
  staleChannels.length ? `now reachable, remove from KNOWN_ORPHAN_CHANNELS: ${staleChannels.join(', ')}` : '');

check('every registered orphan carries a written reason',
  Object.values(KNOWN_ORPHAN_CHANNELS).every((r) => typeof r === 'string' && r.length > 40));

if (orphanChannels.length > 0) {
  console.log(`        ${orphanChannels.length} known orphan channel(s), each with a reason:`);
  for (const c of orphanChannels) console.log(`          ${c}`);
}

// ═══ (2) Renderer calls with no handler — the other direction ══════════════
//
// `auditRenderer.cjs` already proves every `window.rama.*` call resolves to a preload member. This
// asserts the step after it: that the preload member's channel is actually registered.
console.log('\n  every channel the preload invokes is registered in main');

const invoked = new Set();
for (const m of preloadSrc.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*['"`]([^'"`$]+)['"`]/g)) {
  invoked.add(m[1]);
}
check('the preload invokes channels', invoked.size > 100, String(invoked.size));
const unhandled = [...invoked].filter((c) => !channels.has(c)).sort();
// REDBY: rename a channel in main without renaming it in the preload. That is a dead button with no
// error anywhere until someone presses it.
eq('no preload channel is missing its handler', unhandled.length, 0);
if (unhandled.length) console.log(`        missing handlers: ${unhandled.join(', ')}`);

// ═══ (3) Preload members with a renderer caller ════════════════════════════
console.log('\n  every member exposed on window.rama is reached from the renderer');

/**
 * Parse `RAMA_API` into `namespace.member` paths. A brace walk rather than a regex, because the
 * object is nested and a regex over nested braces is how a parser silently under-counts.
 */
function parsePreloadMembers(rawSrc) {
  // COMMENTS STRIPPED FIRST, and this is the fourth time this project has paid for a pattern that
  // read prose as code. The brace walk below matches `name:` at the right nesting depth — and a
  // comment containing the words `member:` produced a phantom bridge member called `member`, which
  // then failed the "no NEW orphan" row. Replaced with spaces rather than removed so every byte
  // offset and nesting depth is preserved.
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (m, pre, c) => pre + ' '.repeat(c.length));

  const start = /const RAMA_API\s*=\s*\{/.exec(src);
  if (!start) return null;
  let i = start.index + start[0].length;
  let depth = 1;
  const members = [];
  const stack = [];
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') { depth += 1; i += 1; continue; }
    if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      if (depth === stack[stack.length - 1]?.depth) stack.pop();
      i += 1;
      continue;
    }
    // A key at the current nesting level.
    const key = /^([A-Za-z_$][\w$]*)\s*:/.exec(src.slice(i));
    if (key && (depth === 1 || depth === 2)) {
      const name = key[1];
      const after = src.slice(i + key[0].length).trimStart();
      if (after.startsWith('{')) {
        stack.push({ name, depth });
        members.push({ path: name, kind: 'namespace', depth });
      } else {
        const ns = stack.length ? stack[stack.length - 1].name : null;
        members.push({ path: ns ? `${ns}.${name}` : name, kind: 'leaf', depth, ns, name });
      }
      i += key[0].length;
      continue;
    }
    i += 1;
  }
  return members;
}

const members = parsePreloadMembers(preloadSrc);
check('the preload surface parsed', Array.isArray(members) && members.length > 200,
  members ? String(members.length) : 'parse returned null');

const leaves = (members || []).filter((m) => m.kind === 'leaf');
const namespaces = (members || []).filter((m) => m.kind === 'namespace');
console.log(`        ${namespaces.length} namespaces, ${leaves.length} leaf members`);

// A member is reached if the renderer names `window.rama.<ns>.<name>` or destructures it, or if the
// renderer names `.<name>(` on a value taken from that namespace. The looser second form is
// deliberate: a false "reached" is better here than a false orphan, because the register's job is to
// catch NEW gaps, and a noisy list stops being read.
/**
 * OPTIONAL CHAINING NORMALISED, and this was a measured defect in both directions (Section 187.1).
 *
 * The patterns below accept `rama.ns.name` and `rama?.ns.name`, but a panel that guards the whole
 * chain writes `rama?.health?.startup?.()` — optional on EVERY link — which matches neither. So:
 *   - `health.repair` read as UNREACHED while `HealthPanel.jsx` calls it, and
 *   - `health.startup` read as reached only because that file's docblock names the API in prose,
 *     which is the comment hazard this suite already lists as held by hand.
 * The register was therefore wrong in both directions at once for the same namespace. Collapsing
 * `?.` to `.` before matching catches the form the newest panels actually use, and it can only
 * INCREASE what counts as reached — so the debt register can only shrink, never redden on arrival.
 */
const ALL_RENDERER_CODE = normalise(rendererSrc);
// Per-file, for grading evidence (194.6). The concatenation above can only say that both halves of a
// weak match exist SOMEWHERE; these say whether one file contains both.
const RENDERER_BY_FILE = rendererByFile.map(normalise);
// Declared here rather than beside `filesNaming()` below, because the grading pass runs before that
// point in the file and a `const` does not hoist the way its function does.
const _filesNaming = new Map();

function normalise(code) {
  return code.replace(/\?\./g, '.');
}

/**
 * `code` IS A PARAMETER so that the shapes this matcher must recognise can be asserted against
 * fixtures rather than against the live tree. Every blind spot so far was found by a human reading a
 * long orphan list and recognising one name; the fixtures below turn each one into a row that fails
 * if the rule is ever tightened back.
 */
function reachedBy(leaf, rendererCode = ALL_RENDERER_CODE) {
  const { ns, name, path: full } = leaf;
  if (rendererCode.includes(`rama.${full}`)) return 'chain';
  if (!ns) return rendererCode.includes(`rama.${name}`) ? 'chain' : null;
  // `const { x } = window.rama.ns` then `x(...)`
  const destructure = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*window\\.rama\\.${ns}`);
  if (destructure.test(rendererCode)) return 'destructure';

  /*
   * THE MEMBER PATH AS A QUOTED STRING, which closes the blind spot this suite has been declaring as
   * "held by hand" since Section 143 — a member called through a computed property.
   *
   * It is not hypothetical. `src/services/ipcClient.js` is the service layer for eight namespaces and
   * it dispatches by STRING:
   *
   *     async function ipc(path, ...args) {        // 'system.getProcesses'
   *       let fn = window.rama;
   *       for (const part of path.split('.')) fn = fn?.[part];
   *       return fn(...args);
   *     }
   *     export const systemClient = { getProcesses: (user) => ipc('system.getProcesses', user) };
   *
   * No `window.rama.system.getProcesses` appears anywhere, so every member reached this way counted
   * only through the loose rule — real callers resting on coincidental evidence.
   *
   * This is the STRONGEST rule here after the written-out chain: `'system.getProcesses'` names the
   * namespace and the member together, in order, in one token. The quotes are required so that
   * `'system.getProcessesDetailed'` cannot satisfy `system.getProcesses`.
   */
  if (new RegExp(`['"\`]${ns}\\.${name}['"\`]`).test(rendererCode)) return 'dispatch-path';
  // A NAMESPACE CAPTURED IN ANY FORM, then the member called on it.
  //
  // THE SECOND BLIND SPOT (Section 194). This required an ASSIGNMENT — `= window.rama.ns` — and
  // the service wrappers do not assign, they return:
  //
  //     const ipc = () => (typeof window !== 'undefined' ? window.rama?.auth : null);
  //     const api = ipc();   api.loginStep1(...)
  //
  // So all twenty `auth` members read as unreached while the app plainly cannot log anyone in
  // without them. `auth`, `evolution`, `meta` and others are reached through exactly this shape.
  // The requirement is now only that the namespace is NAMED somewhere and the member is CALLED
  // somewhere, which is the looser form this function's own comment already blesses: a false
  // "reached" is better than a false orphan, because the register exists to catch NEW gaps and a
  // list with false entries stops being read. It can only INCREASE what counts as reached, so the
  // register can only shrink.
  if (new RegExp(`window\\.rama\\.${ns}\\b`).test(rendererCode)
      && new RegExp(`\\.${name}\\s*\\(`).test(rendererCode)) return 'namespace+call';
  return null;
}

/**
 * WHICH RULE MATCHED IS REPORTED, because the loosest rule is the one that can be WRONG and a prose
 * caveat does not survive contact with a hurry (194.6).
 *
 * `namespace+call` proves only that the namespace appears somewhere in the renderer and that
 * SOMETHING is called `.<name>(` somewhere — not that they are the same object. `browser.close` is
 * the live example: the whole `browser` namespace has ONE renderer call site, `browser.fetchUrl` in
 * `Models.jsx`, and `.close(` appears in unrelated modal code, so `browser.close` counts as reached
 * on evidence that would not convince anyone who read it.
 *
 * The trade-off still stands — a false orphan is worse, because it hides the next real gap — but the
 * count of weak matches is now a NUMBER printed on every run rather than a sentence in a docblock.
 */
function isReached(leaf, rendererCode = ALL_RENDERER_CODE) {
  return reachedBy(leaf, rendererCode) !== null;
}

// ── The shapes the matcher must see, asserted against fixtures ──────────────
//
// Both blind spots in this matcher were found the same way: a human read a long orphan list and
// recognised one name on it as a feature that plainly works. That does not scale and it does not
// repeat. Each shape below is a real calling convention in this renderer, written out as the smallest
// code that exhibits it, and each is a row that fails if the rule is narrowed again.
//
// The last two rows are the counterweight. A matcher loosened twice could end by calling everything
// reached, which would empty the debt register by lying rather than by work — so a member named
// nowhere, and a member whose namespace is named but which is never called, must both stay UNREACHED.
//
// EACH ROW ASSERTS WHICH RULE MATCHED, not merely that something did. A fixture that only checks the
// boolean passes when a strong rule quietly degrades into the weakest one, which is precisely the
// drift that makes a loosened matcher untrustworthy.
console.log('\n  the matcher sees every shape this renderer uses to call the bridge');
const SHAPES = [
  ['the plain chain, window.rama.ns.name(...)',
    { ns: 'auth', name: 'loginStep1', path: 'auth.loginStep1' },
    'await window.rama.auth.loginStep1(user);', 'chain'],
  ['optional on every link, rama?.ns?.name?.()  (Section 187)',
    { ns: 'health', name: 'repair', path: 'health.repair' },
    'const r = await window.rama?.health?.repair?.();', 'chain'],
  ['destructured off the namespace',
    { ns: 'git', name: 'status', path: 'git.status' },
    'const { status } = window.rama.git;\nconst s = await status();', 'destructure'],
  ['a service wrapper that RETURNS the namespace  (Section 194)',
    { ns: 'auth', name: 'changePassword', path: 'auth.changePassword' },
    'const ipc = () => (typeof window !== "undefined" ? window.rama?.auth : null);\n'
      + 'export async function changePassword(a, b) { const api = ipc(); return api.changePassword(a, b); }',
    'namespace+call'],
  ['a namespace held on a module-level constant',
    { ns: 'vault', name: 'list', path: 'vault.list' },
    'const vault = window.rama.vault;\nvault.list().then(render);', 'namespace+call'],
  ['the member path dispatched as a STRING, ipc("ns.name", ...)  (194.7)',
    { ns: 'system', name: 'getProcesses', path: 'system.getProcesses' },
    "export const systemClient = { getProcesses: (user) => ipc('system.getProcesses', user) };",
    'dispatch-path'],
  ['a LONGER member name does not satisfy the shorter one it starts with',
    { ns: 'system', name: 'getProcesses', path: 'system.getProcesses' },
    "const r = ipc('system.getProcessesDetailed', user);", null],
  ['a member named nowhere is still UNREACHED',
    { ns: 'browser', name: 'screenshot', path: 'browser.screenshot' },
    'const ipc = () => window.rama?.auth;\nipc().loginStep1();', null],
  ['a namespace named but the member never called is still UNREACHED',
    { ns: 'browser', name: 'download', path: 'browser.download' },
    'const b = window.rama.browser;\nb.launch();', null],
];
for (const [label, leaf, fixture, want] of SHAPES) {
  eq(label, reachedBy(leaf, normalise(fixture)), want);
}

// EACH VERDICT IS COMPUTED ONCE. Grading walks 104 files per member, so calling it from several
// places put this suite at 17 seconds — slow enough that a developer starts skipping it, which is how
// a guard stops guarding. One pass, then everything below reads the answer.
const liveRule = new Map(leaves.map((l) => [l, reachedBy(l)]));
const liveTier = new Map(leaves.map((l) => [l, liveRule.get(l) ? evidenceTier(l) : null]));

const orphanMembers = leaves.filter((l) => !liveRule.get(l)).map((l) => l.path).sort();
console.log(`        ${leaves.length - orphanMembers.length} of ${leaves.length} leaf members reached `
  + `(${orphanMembers.length} not)`);

/**
 * GRADES THE EVIDENCE. Separate from `reachedBy` on purpose: that one decides the register's gate
 * and must not move, this one only describes how convincing each "reached" verdict is.
 *
 * `reachedBy` matches against every renderer file CONCATENATED, so the namespace may be named in one
 * file and `.<name>(` called in a completely different one. Grading per file separates:
 *
 *   `chain`          `window.rama.<ns>.<name>` written out — not in doubt
 *   `dispatch-path`  the member path as a quoted string, `ipc('system.getProcesses', user)`
 *   `alias-chain`    `<something>.<ns>.<name>(` — the bridge held on a local name, e.g. `ipc`
 *   `same-file`      one file both names the namespace and makes the call — the wrapper shape
 *   `cross-file`     the two halves are in different files with nothing linking them — UNCONFIRMED
 *
 * THE TIERS EXIST BECAUSE THREE SPOT CHECKS DISAGREED WITH EACH OTHER (194.7). With only
 * `cross-file` to fall into, `system.getProcesses` (really called, through a string-dispatching
 * service module), `instance.list` (really called, as `ipc.instance.list()`) and `browser.close`
 * (NOT called — the matches are `window.rama.window.close()`, `window.close()` and an AudioContext)
 * all read alike. Grading them apart is what makes the rest worth triaging instead of worth ignoring.
 *
 * This does NOT tighten the gate, and that is deliberate rather than timid: the register may only
 * SHRINK (184.2), so a rule change that reduces "reached" turns currently-reached members into
 * orphans that are not in the baseline and cannot be added to it. Precision can therefore only
 * arrive one member at a time, as each is triaged by hand. What is affordable today is to say how
 * strong the evidence is instead of letting every verdict read alike.
 */
/**
 * Which renderer files name `window.rama.<ns>` — cached per NAMESPACE, not per member, because 55
 * namespaces scanned once beats 458 members scanning 104 files each.
 */
function filesNaming(ns) {
  if (!_filesNaming.has(ns)) {
    const re = new RegExp(`window\\.rama\\.${ns}\\b`);
    _filesNaming.set(ns, RENDERER_BY_FILE.filter((code) => re.test(code)));
  }
  return _filesNaming.get(ns);
}

function evidenceTier(leaf) {
  const { ns, name, path: full } = leaf;
  if (ALL_RENDERER_CODE.includes(`rama.${full}`)) return 'chain';
  if (!ns) return 'chain';

  if (new RegExp(`['"\`]${ns}\\.${name}['"\`]`).test(ALL_RENDERER_CODE)) return 'dispatch-path';

  // `ipc.instance.list()` — the whole bridge on a local name. The member and its namespace are still
  // written in the right order next to each other, which is what makes this nearly as good as `chain`.
  if (new RegExp(`\\b[A-Za-z_$][\\w$]*\\.${ns}\\.${name}\\s*\\(`).test(ALL_RENDERER_CODE)) {
    return 'alias-chain';
  }

  const callsIt = new RegExp(`\\.${name}\\s*\\(`);
  for (const code of filesNaming(ns)) {
    if (callsIt.test(code)) return 'same-file';
  }

  return 'cross-file';
}

// ── How strong is the evidence for "reached"? (194.6) ───────────────────────
//
// WHY THIS IS PRINTED. Section 194 freed 78 members from the debt register and the tranche note said
// they "have real renderer callers". Triaging `browser` for the next tranche showed that is not true
// of all of them: the whole namespace has ONE renderer call site, `browser.fetchUrl` in `Models.jsx`,
// yet `browser.close` and `browser.search` counted as reached because `.close(` and `.search(` occur
// in unrelated renderer code. The rule is still the right trade-off — a false orphan hides the next
// real gap, which is worse — but the claim attached to it was stronger than the evidence.
//
// So the weak matches are COUNTED on every run. A number cannot be forgotten the way a caveat can.
const tiers = { chain: [], 'dispatch-path': [], 'alias-chain': [], 'same-file': [], 'cross-file': [] };
for (const l of leaves) {
  if (liveRule.get(l)) tiers[liveTier.get(l)].push(l.path);
}
console.log(`        evidence for the ${leaves.length - orphanMembers.length} reached:`);
for (const [tier, list] of Object.entries(tiers)) {
  console.log(`          ${tier.padEnd(15)} ${String(list.length).padStart(3)}`);
}
if (tiers['cross-file'].length) {
  console.log(`        UNCONFIRMED (nothing links the two halves): ${tiers['cross-file'].join(', ')}`);
}

// REDBY: let the weak tier stop being reported, or let it grow past the members named in full. This
// row does not fix the imprecision — the ratchet forbids tightening, see `evidenceTier` — it refuses
// to let it go unstated, the same treatment 187.1 gave the comment hazard it could not safely remove.
check('the weakest evidence tier is reported and is still a minority of what counts as reached',
  tiers['cross-file'].length < tiers.chain.length,
  `cross-file ${tiers['cross-file'].length} vs named-in-full ${tiers.chain.length}`);

// THE GRADING CANNOT FLATTER ITSELF. A grader is a second opinion on the same text, so nothing stops
// it drifting into agreeing with everything — and "all 280 are named in full" would be a comfortable
// lie that no other row here would catch. These two tie it to the gate's own reasoning: the strongest
// tier must be exactly the members the gate matched on the written-out chain, and a member the gate
// matched by quoted path cannot be graded as something stronger.
const gradedTotal = Object.values(tiers).reduce((n, l) => n + l.length, 0);
eq('every reached member is graded exactly once', gradedTotal, leaves.length - orphanMembers.length);

const strongestDisagrees = leaves.filter((l) => liveRule.get(l)
  && (liveRule.get(l) === 'chain') !== (liveTier.get(l) === 'chain'));
check('the strongest tier holds exactly the members the gate matched in full',
  strongestDisagrees.length === 0,
  strongestDisagrees.map((l) => l.path).join(', '));

const pathMisgraded = leaves.filter((l) => liveRule.get(l) === 'dispatch-path'
  && liveTier.get(l) !== 'dispatch-path');
check('a member matched by its quoted path is graded as such, not as something stronger',
  pathMisgraded.length === 0,
  pathMisgraded.map((l) => l.path).join(', '));

if (KNOWN_ORPHAN_MEMBERS.length === 0) {
  // FIRST RUN: write the baseline rather than failing with hundreds of rows. Stated loudly, because a
  // suite that creates its own passing condition must never do so quietly.
  fs.writeFileSync(SEED_PATH, `${JSON.stringify({
    writtenAt: new Date().toISOString().slice(0, 10),
    why: 'Baseline for verifyReachability.cjs rule 3. Each entry is a preload member with no renderer '
      + 'caller on the day the suite was written (spec Section 143). THIS LIST MAY ONLY SHRINK: the '
      + 'suite fails if a member not named here becomes unreachable, and fails if a member named here '
      + 'becomes reachable without being removed.',
    unusedPreloadMembers: orphanMembers,
  }, null, 2)}\n`, 'utf8');
  KNOWN_ORPHAN_MEMBERS = orphanMembers;
  console.log(`\n        BASELINE WRITTEN: ${path.relative(ROOT, SEED_PATH)} with ${orphanMembers.length} entries.`);
  console.log('        This is the debt register. It may only shrink from here.');
}

const newOrphans = orphanMembers.filter((m) => !KNOWN_ORPHAN_MEMBERS.includes(m));
// THE ROW THAT CATCHES THE NEXT ONE. REDBY: expose a new preload member and ship no caller for it.
check('no NEW preload member is exposed without a caller',
  newOrphans.length === 0,
  newOrphans.length ? newOrphans.join(', ') : '');

const fixedMembers = KNOWN_ORPHAN_MEMBERS.filter((m) => !orphanMembers.includes(m));
check('every member in the debt register is still unreached, so the register cannot overstate the debt',
  fixedMembers.length === 0,
  fixedMembers.length
    ? `now reached — remove from scripts/reachability-baseline.json: ${fixedMembers.join(', ')}`
    : '');

// ═══ (4) The five surfaces the audit named, asserted BY NAME ═══════════════
//
// The register above catches the next gap. These rows are about the ones already known: each is a
// built, tested contract with no producer, and each is named so that closing it is visible as
// progress rather than disappearing into a count.
console.log('\n  the named gaps from the audit, so closing one is visible');

/**
 * Count call sites of `<module>.<fn>(` where the module is one that actually REQUIRES the file that
 * defines it. A bare `fn(` match is not good enough and that is not a hypothetical: the first version
 * of this counted `record(` and reported **4 production call sites for
 * `functionTracking.record()` when the real number is 0** — it was matching `crashGuard.record(` in
 * `main.cjs`, an unrelated function with the same name.
 *
 * A guard that OVERSTATES progress is worse than one that understates it: it retires an open item.
 */
function callSitesOf(defFile, fnName, files) {
  const base = path.basename(defFile);
  const sites = [];
  for (const f of files) {
    if (path.basename(f) === base) continue;
    if (f.includes(`${path.sep}scripts${path.sep}`)) continue;
    const raw = fs.readFileSync(f, 'utf8');
    // COMMENTS ARE STRIPPED BEFORE COUNTING. Without this the counter matches its own prose: the
    // comment explaining why `functionTracking.record()` needed a producer contains the literal
    // `.record(`, so instrumenting it reported 2 call sites in a file that has 1. This is the same
    // class of error as the three earlier regexes that matched comments rather than code, and the
    // fourth time it has been paid for — a counter that reads documentation as implementation
    // reports work that was not done.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // Only files that require the defining module can be calling it.
    if (!src.includes(base.replace(/\.cjs$/, ''))) continue;
    // `x.fn(` where x is a local binding — the import name is not assumed, only that it is a member
    // access rather than a bare call, which is what excludes a same-named function elsewhere.
    const re = new RegExp(`\\b[A-Za-z_$][\\w$]*\\.${fnName}\\s*\\(`, 'g');
    const n = (src.match(re) || []).length;
    if (n > 0) sites.push(`${path.relative(ROOT, f)}×${n}`);
  }
  return sites;
}

const trackingSites = callSitesOf('functionTracking.cjs', 'record', electronFiles);
console.log(`        functionTracking.record() production call sites: ${trackingSites.length}`
  + `${trackingSites.length ? ` (${trackingSites.join(', ')})` : ' — still no producer'}`);
const driftSites = callSitesOf('brokerConnectors.cjs', 'driftReport', electronFiles);
console.log(`        brokerConnectors.driftReport() call sites: ${driftSites.length}`
  + `${driftSites.length ? ` (${driftSites.join(', ')})` : ' — still no producer'}`);

// These are REPORTED, not asserted to be zero: asserting zero would make FIXING them fail the suite,
// which is the exact inversion that makes a guard an obstacle. The register above is what holds the
// line; this is here so the number is in front of whoever runs it.
check('the named gaps are reported with their call sites rather than a bare count',
  Array.isArray(trackingSites) && Array.isArray(driftSites));

// ═══ (5) Ghost Mode — the audit's H1/H3, asserted because it is a PRIVACY claim ═══
console.log('\n  Ghost Mode actually covers the keys this app writes');

const ghost = fs.readFileSync(path.join(ROOT, 'src', 'services', 'ghostMode.js'), 'utf8');
// Every localStorage key literal the renderer writes, gathered from the source rather than listed.
const writtenKeys = new Set();
for (const f of rendererFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:savePref|loadPref)\(\s*'([^']+)'/g)) writtenKeys.add(m[1]);
  for (const m of src.matchAll(/(?:PREFS_KEY|PREFIX|storageKey)\s*[=:]\s*'([^']+)'/g)) writtenKeys.add(m[1]);
  for (const m of src.matchAll(/storageKey="([^"]+)"/g)) writtenKeys.add(m[1]);
}
check('real storage keys were found to check against', writtenKeys.size >= 8, String(writtenKeys.size));
console.log(`        ${writtenKeys.size} storage keys written by the renderer`);

// Read the DECLARED list, not the call that uses it. The first version of this row scraped
// `startsWith('…')` literals, which stopped matching the moment the prefixes were lifted into a named
// frozen array — the row then reported "prefixes: none" and would have kept failing after the fix.
// A guard that only recognises one spelling of the thing it guards is a guard against refactoring.
const prefixDecl = /WIPE_PREFIXES\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(ghost);
check('Ghost Mode declares its prefixes as one named list', !!prefixDecl);
const prefixes = prefixDecl
  ? (prefixDecl[1].match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1))
  : [];
console.log(`        Ghost Mode clears prefixes: ${prefixes.join(', ') || 'none'}`);
// The heritage prefixes are kept, not replaced: a key written by an older build must still go.
check('the StockMind heritage prefixes are still covered',
  prefixes.includes('rama_') && prefixes.includes('sm_'), prefixes.join(','));
// REDBY: make activateGhostMode return undefined again. "It ran" and "it wiped nothing" were the
// same observation for as long as it did.
check('activateGhostMode reports what it did rather than returning undefined',
  /return \{ ok: failed\.length === 0, steps, failed \};/.test(ghost));
check('and the local-storage step verifies each removal instead of assuming it',
  /if \(localStorage\.getItem\(k\) === null\) removed\.push\(k\)/.test(ghost));

// THE ROW THAT WOULD HAVE CAUGHT IT. REDBY: drop 'rama.' from the prefix list. Every key this app
// writes is dotted, so a wipe matching only 'rama_' removes nothing at all.
const uncovered = [...writtenKeys].filter((k) => !prefixes.some((p) => k.startsWith(p))).sort();
eq('every key this app writes is covered by a Ghost Mode prefix', uncovered.length, 0);
if (uncovered.length) console.log(`        NOT WIPED: ${uncovered.join(', ')}`);

console.log('\n  held by hand, listed rather than implied:');
console.log('    - "reached" is decided from SOURCE TEXT. A member called through a computed property');
console.log('      would read as an orphan, and a member named only in a comment would read as reached.');
console.log('      The looser direction is deliberate: this register exists to catch NEW gaps, and a');
console.log('      list with false entries stops being read, which is how the first five were missed');
console.log('    - an orphan is not automatically a defect. A bridge member with no page yet is a');
console.log('      capability waiting; the defect was that nobody could tell which was which');
console.log('    - this says nothing about whether a reached member WORKS. That is what the other 39');
console.log('      suites are for; this is the question none of them asked');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
