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

const rendererSrc = rendererFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
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
const KNOWN_ORPHAN_CHANNELS = Object.freeze({
  'models:roles':
    'HIGH/H6 in the audit: modelRoles.plan() exists only for this channel and has no preload '
    + 'namespace or page. Fix is a models.roles preload pair plus a Roles tab, not deletion.',
  'models:role-research':
    'HIGH/H6, same pair as models:roles. modelRoles.researchPlan() is its only consumer.',
});

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
function parsePreloadMembers(src) {
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
function isReached(leaf) {
  const { ns, name, path: full } = leaf;
  if (rendererSrc.includes(`rama.${full}`) || rendererSrc.includes(`rama?.${full}`)) return true;
  if (!ns) return rendererSrc.includes(`rama.${name}`) || rendererSrc.includes(`rama?.${name}`);
  // `const { x } = window.rama.ns` then `x(...)`
  const destructure = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*window\\.rama\\??\\.${ns}`);
  if (destructure.test(rendererSrc)) return true;
  // `const api = window.rama.ns` then `api.x(`
  const alias = new RegExp(`=\\s*window\\.rama\\??\\.${ns}\\b`);
  if (alias.test(rendererSrc) && new RegExp(`\\.${name}\\s*\\(`).test(rendererSrc)) return true;
  return false;
}

const orphanMembers = leaves.filter((l) => !isReached(l)).map((l) => l.path).sort();
console.log(`        ${leaves.length - orphanMembers.length} of ${leaves.length} leaf members reached `
  + `(${orphanMembers.length} not)`);

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
    const src = fs.readFileSync(f, 'utf8');
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
