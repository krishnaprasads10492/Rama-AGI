#!/usr/bin/env node
'use strict';

/**
 * verifyAudit.cjs — proof that the scope checker catches the bugs it was built for (Section 81).
 *
 * The IDE and Resources pages both failed on mount while `npm run audit` reported everything
 * resolving. Adding a check is not enough: the check has to be shown to catch those exact shapes,
 * and shown not to fire on working code. A checker that is silently broken is worse than no
 * checker, because it is trusted.
 *
 * The two real shapes, reproduced as fixtures:
 *   A. an identifier declared in a SIBLING scope — the IDE bug. A flat "is this name declared
 *      anywhere in the module" check passes this, which is why real scope resolution was needed.
 *   B. a Node builtin referenced in the renderer — the Resources bug.
 *
 * Run: node scripts/verifyAudit.cjs   (or npm run verify:audit)
 */

const fs = require('fs');
const path = require('path');
const { findUndefinedIdentifiers, findIpcMismatches } = require('./auditRenderer.cjs');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const names = (code) => findUndefinedIdentifiers(code).map(h => h.name);
const flags = (code, name) => names(code).includes(name);

// ── Fixture A: the IDE bug — declared in a sibling scope ─────────────────────
console.log('\n--- FIXTURE A: the IDE bug, an identifier declared in a sibling scope ---');

const siblingScope = `
import React, { useCallback } from 'react';
import { useUserStore } from '@store/userStore.js';

function FileTree({ onFileOpen }) {
  const listDir = useCallback(async (p) => {
    const res = await window.rama.fs.listDir(currentUser, p);
    return res.ok ? res.data : [];
  }, [currentUser]);
  return <div onClick={listDir}>tree</div>;
}

export default function IDE() {
  const { currentUser } = useUserStore();
  return <FileTree onFileOpen={() => {}} user={currentUser} />;
}
`;

check('the sibling-scope leak IS caught', flags(siblingScope, 'currentUser'),
  JSON.stringify(names(siblingScope)));
check('THIS IS THE CASE A FLAT MODULE-WIDE CHECK WOULD MISS — the name is declared in the file',
  /const \{ currentUser \}/.test(siblingScope));
check('it reports a line number',
  findUndefinedIdentifiers(siblingScope).find(h => h.name === 'currentUser')?.line > 0,
  JSON.stringify(findUndefinedIdentifiers(siblingScope)));
check('the legitimately-scoped use inside IDE() is NOT double-reported',
  names(siblingScope).filter(n => n === 'currentUser').length >= 1
  && !flags(siblingScope, 'useUserStore'),
  JSON.stringify(names(siblingScope)));
check('imported bindings are not flagged',
  !flags(siblingScope, 'React') && !flags(siblingScope, 'useCallback'));
check('component references that resolve are not flagged',
  !flags(siblingScope, 'FileTree'));
check('lowercase JSX intrinsics are not flagged', !flags(siblingScope, 'div'));

// ── Fixture B: the Resources bug — a Node builtin in the renderer ────────────
console.log('\n--- FIXTURE B: the Resources bug, a Node builtin in the renderer ---');

const nodeBuiltin = `
export default function Panel({ s }) {
  return <div>{Math.max(4, (os?.cpus?.()?.length ?? 4) - 1)} workers {s.workers.max}</div>;
}
`;

check('a Node builtin used in the renderer IS caught', flags(nodeBuiltin, 'os'),
  JSON.stringify(names(nodeBuiltin)));
check('OPTIONAL CHAINING DOES NOT HIDE IT — `os?.x` still throws on the identifier',
  /os\?\./.test(nodeBuiltin) && flags(nodeBuiltin, 'os'));
check('Math is a known global and is not flagged', !flags(nodeBuiltin, 'Math'));
check('a destructured prop is not flagged', !flags(nodeBuiltin, 's'));

// ── Working code must stay quiet ─────────────────────────────────────────────
console.log('\n--- working code must not be flagged ---');

const clean = `
import React, { useState, useEffect, useMemo } from 'react';
import { useUserStore } from '@store/userStore.js';
import PriceChart from './PriceChart.jsx';

const HELPER = (v) => v * 2;

export default function Page({ initial = 1, ...rest }) {
  const { currentUser, canDo } = useUserStore();
  const [n, setN] = useState(initial);
  const doubled = useMemo(() => HELPER(n), [n]);

  useEffect(() => {
    const id = setInterval(() => setN(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const onClick = async (e) => {
    e.preventDefault();
    try {
      const res = await window.rama.marketIntel.alerts({ user: currentUser });
      console.log(res);
    } catch (err) {
      console.error(err.message);
    }
  };

  for (const item of [1, 2, 3]) { HELPER(item); }
  const { a, b: renamed } = rest;

  class Inner { constructor(x) { this.x = x; } }
  const inst = new Inner(a);

  return (
    <div onClick={onClick}>
      <PriceChart bars={[]} />
      {doubled}{renamed}{inst.x}{canDo('x') ? 'y' : 'n'}
      {[1,2].map((v, i) => <span key={i}>{v}</span>)}
    </div>
  );
}
`;

const cleanHits = findUndefinedIdentifiers(clean);
check('clean code produces NO findings', cleanHits.length === 0, JSON.stringify(cleanHits));

const globalsUse = `
export function wipe() {
  if (!window.caches) return;
  return caches.keys().then(k => k.map(x => caches.delete(x)));
}
export function sizes() {
  return { w: innerWidth, dpr: devicePixelRatio, ua: navigator.userAgent,
    t: performance.now(), j: JSON.stringify({}), d: new Date(), u: new URL('https://x') };
}
`;
check('browser globals including caches are not flagged',
  findUndefinedIdentifiers(globalsUse).length === 0,
  JSON.stringify(findUndefinedIdentifiers(globalsUse)));

// ── Shapes that must not confuse the checker ────────────────────────────────
console.log('\n--- shapes that must not produce false positives ---');

const shapes = `
import React from 'react';
import * as Icons from './icons.js';
const { Provider } = Icons;

function hoisted() { return later(); }
function later() { return 1; }

export default function S({ items = [] }) {
  const [{ x = 1 }, setState] = React.useState({});
  const obj = { key: 'value', shorthandOk: x, computed: [x], nested: { deep: x } };
  const fn = function named() { return named; };
  label: for (const i of items) { if (i) break label; }
  try { hoisted(); } catch ({ message }) { void message; }
  return (
    <Icons.Star aria-label="s" data-x={obj.key}>
      <Provider value={fn}>{items.map(i => i)}</Provider>
    </Icons.Star>
  );
}
`;
const shapeHits = findUndefinedIdentifiers(shapes);
check('object keys, labels, catch params, hoisting and namespace imports are all fine',
  shapeHits.length === 0, JSON.stringify(shapeHits));

const badParse = 'export default function ( { return <div>;';
const parseRes = findUndefinedIdentifiers(badParse);
check('an unparseable file reports a parse error rather than throwing',
  parseRes.length === 1 && !!parseRes[0].parseError, JSON.stringify(parseRes));

// ─── FIXTURE D: invoke against a send-only channel (Section 90) ───────────────
//
// The real bug: Settings → About called `ipcRenderer.invoke('updater:install-now')`, a channel
// registered with `ipcMain.on`. Electron rejects that with "No handler registered", the call site
// had no `.catch`, so a shipped button did nothing at all and did so silently. `node --check`
// passes, both lines are valid, and the bridge check only asks whether the preload exposes the
// function — the mismatch lives between two files and two different Electron APIs.
console.log('\n--- FIXTURE D: invoke/send against the wrong registration ---');
{
  const realBugPreload = `
    updater: {
      installNow: () => ipcRenderer.invoke('updater:install-now'),
    },
  `;
  const realBugMain = `
    ipcMain.on('updater:install-now', () => { updater.quitAndInstall(); });
  `;
  const r = findIpcMismatches(realBugPreload, [realBugMain]);

  check('the real bug shape IS caught', r.problems.length === 1, JSON.stringify(r.problems));
  check('it is identified as invoke-against-a-listener',
    r.problems[0]?.kind === 'invoke-on-listener', r.problems[0]?.kind);
  check('the message names the fix',
    /ipcMain\.handle/.test(r.problems[0]?.msg || ''), r.problems[0]?.msg);

  // The mirror image: send() to a handle-only channel is silently dropped.
  const mirror = findIpcMismatches(
    "check: () => ipcRenderer.send('updater:check'),",
    ["ipcMain.handle('updater:check', async () => runUpdateCheck());"],
  );
  check('send() to a handle-only channel is caught',
    mirror.problems.length === 1 && mirror.problems[0].kind === 'send-on-handler',
    JSON.stringify(mirror.problems));

  // Correct wiring must stay silent, both directions.
  const good = findIpcMismatches(
    "a: () => ipcRenderer.invoke('x:one'), b: () => ipcRenderer.send('x:two'),",
    ["ipcMain.handle('x:one', () => {}); ipcMain.on('x:two', () => {});"],
  );
  check('correct wiring is not reported', good.problems.length === 0, JSON.stringify(good.problems));
  check('both directions are counted as checked', good.checked === 2, String(good.checked));

  // A channel registered nowhere is a different, also-real finding.
  const missing = findIpcMismatches("a: () => ipcRenderer.invoke('x:ghost'),", ['']);
  check('a channel registered nowhere is caught',
    missing.problems.length === 1 && missing.problems[0].kind === 'invoke-unregistered',
    JSON.stringify(missing.problems));

  // DYNAMIC REGISTRATION must not be reported. marketIntel.cjs registers from a map in a loop, so
  // the channel is an object key and never sits beside `.handle(`. The first version of this check
  // reported 26 such channels as missing handlers — all false positives in working shipped code.
  const dynamicMain = `
    const readOnly = { 'market:ohlcv': ohlcv, 'market:forecast': forecast };
    for (const [channel, fn] of Object.entries(readOnly)) {
      ipcMain.handle(channel, async (_e, a) => fn(a));
    }
  `;
  const dyn = findIpcMismatches(
    "ohlcv: () => ipcRenderer.invoke('market:ohlcv'), f: () => ipcRenderer.invoke('market:forecast'),",
    [dynamicMain],
  );
  check('dynamically registered channels are NOT falsely reported',
    dyn.problems.length === 0, JSON.stringify(dyn.problems));

  // And the reason the shape-anchored pattern exists: an apostrophe in a comment shifts every
  // naive quote pair after it, which is why scanning for /'([^']+)'/ found 126 "literals" in
  // marketIntel.cjs and zero channel-shaped ones while the file plainly contains 'market:forecast'.
  const withApostrophe = `
    // Rāma's own routes — master's list, doesn't include writes
    const readOnly = { 'market:ohlcv': ohlcv };
    for (const [channel, fn] of Object.entries(readOnly)) ipcMain.handle(channel, fn);
  `;
  const apos = findIpcMismatches("o: () => ipcRenderer.invoke('market:ohlcv'),", [withApostrophe]);
  check('an apostrophe in a comment does not hide a registered channel',
    apos.problems.length === 0, JSON.stringify(apos.problems));
}

// ─── FIXTURE E: two subsystems, one channel (Section 182.0) ──────────────────────────────────────
//
// THE REAL BUG, REPRODUCED. `deps:review` was registered in `main.cjs` and again in
// `ipc/system.cjs`. `ipcMain.handle` throws on the second registration, the throw landed in
// `main.cjs`'s per-subsystem catch, and what followed the throwing line was `sched.start()` — so
// the duplicate did not cost a channel, it cost every background task in the app, silently.
//
// This check saw nothing, because registrations were accumulated into a Set where a second `add()`
// of the same name is indistinguishable from the first. The parity check answers "does this channel
// have A handler"; nothing answered "does it have exactly one".
{
  console.log('\n--- FIXTURE E: the same channel registered by two subsystems ---');

  const first  = "ipcMain.handle('deps:review', async () => ({ ok: true }));";
  const second = "ipcMain.handle('deps:review', async () => ({ ok: true }));\n"
    + "ipcMain.handle('refresh:status', async () => ({}));";
  const dupe = findIpcMismatches(
    "d: () => ipcRenderer.invoke('deps:review'), s: () => ipcRenderer.invoke('refresh:status'),",
    [first, second],
    ['electron/main.cjs', 'electron/ipc/system.cjs'],
  );
  const dups = dupe.problems.filter(p => p.kind === 'duplicate-handler');
  check('a channel registered twice IS caught', dups.length === 1, JSON.stringify(dupe.problems));
  check('it names the channel', dups[0] && dups[0].channel === 'deps:review');
  check('it names BOTH files, so the reader does not have to grep for the pair',
    !!dups[0] && /electron\/main\.cjs/.test(dups[0].msg) && /electron\/ipc\/system\.cjs/.test(dups[0].msg),
    dups[0] && dups[0].msg);
  check('the message says what a duplicate actually costs — the registrations that follow it',
    !!dups[0] && /THROWS/.test(dups[0].msg) && /every\s+line\s+that\s+follows/.test(dups[0].msg));
  check('and the duplicate is the ONLY thing reported — both channels still resolve',
    dupe.problems.length === 1, JSON.stringify(dupe.problems));
  check('the channel count is unaffected: `checked` still counts preload call sites, not registrations',
    dupe.checked === 2, String(dupe.checked));
  check('registrations are reported separately', dupe.registrations === 2, String(dupe.registrations));

  // `handleOnce` is the same claim on the same channel and collides identically.
  const once = findIpcMismatches("x: () => ipcRenderer.invoke('x:y'),",
    ["ipcMain.handle('x:y', () => 1);", "ipcMain.handleOnce('x:y', () => 1);"], ['a.cjs', 'b.cjs']);
  check('handle + handleOnce on one channel is also a collision',
    once.problems.filter(p => p.kind === 'duplicate-handler').length === 1, JSON.stringify(once.problems));

  // NOT A DUPLICATE: a registration quoted inside a comment. `upgradeApplier.cjs` documents
  // `proposals.cjs`'s registration in prose to explain what it wraps, and reporting that would be
  // a false positive against correct code — the one failure mode this file refuses outright.
  const documented = "// `proposals.cjs` registers `ipcMain.handle('proposals:apply', (_e, id) => apply(id))`\n"
    + 'const wraps = true;';
  const quoted = findIpcMismatches("a: () => ipcRenderer.invoke('proposals:apply'),",
    ["ipcMain.handle('proposals:apply', (_e, id) => apply(id));", documented],
    ['electron/lib/proposals.cjs', 'electron/lib/upgradeApplier.cjs']);
  check('a registration QUOTED IN A COMMENT is not counted as a second site',
    quoted.problems.length === 0, JSON.stringify(quoted.problems));

  const solo = findIpcMismatches("a: () => ipcRenderer.invoke('x:y'),", ["ipcMain.handle('x:y', () => 1);"], ['a.cjs']);
  check('a channel registered exactly once is reported as nothing at all',
    solo.problems.length === 0, JSON.stringify(solo.problems));

  // And the live tree, which is the assertion that keeps the fix from regressing.
  const ELECTRON = path.join(ROOT, 'electron');
  const codes = [];
  const names = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') collect(p); }
      else if (e.name.endsWith('.cjs')) {
        codes.push(fs.readFileSync(p, 'utf8'));
        names.push(path.relative(ROOT, p).replace(/\\/g, '/'));
      }
    }
  })(ELECTRON);
  const live = findIpcMismatches(fs.readFileSync(path.join(ELECTRON, 'preload.cjs'), 'utf8'), codes, names);
  const liveDups = live.problems.filter(p => p.kind === 'duplicate-handler');
  check('NO channel in the real main process is registered twice today',
    liveDups.length === 0, liveDups.map(p => p.msg).join(' | '));
}

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);
