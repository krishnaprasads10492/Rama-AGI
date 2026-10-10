#!/usr/bin/env node
/**
 * verifyCjsLoadable.cjs — every dependency the main process `require()`s must be CommonJS-loadable
 * UNDER ELECTRON'S NODE, not under the system's.
 *
 * WHY THIS EXISTS, and it is the most embarrassing gap found so far (spec Section 147).
 *
 * A dependency upgrade took `chokidar` to 5.0.0, `uuid` to 14.0.3 and `vectra` to 0.15.0. All three
 * are `"type": "module"` — ESM-only. Each was checked with `node -e "require('x')"` and each PASSED,
 * because **system Node 22 permits `require()` of an ES module**. Electron 31 bundles **Node 20,
 * which does not.** So in the actual runtime:
 *
 *   [safeRequire] Version control did not load (require() of ES Module chokidar/index.js
 *                 from electron/ipc/git.cjs not supported) — continuing without it
 *   [vectorMemory] vectra unavailable — keyword fallback active
 *
 * **The entire git subsystem was down and vector memory had silently degraded**, and the 42 suites
 * were all green, because `safeRequire` and a keyword fallback caught both. Graceful degradation is
 * correct behaviour and it is also what hid this: a capability can disappear while every gate passes.
 *
 * THE ROOT ERROR WAS THE RUNTIME, NOT THE VERSION. Verifying a main-process `require()` with the
 * system `node` binary measures the wrong interpreter. This suite runs the probe **inside Electron**
 * so the answer comes from the Node that will actually execute the code.
 *
 * It degrades honestly: with no Electron binary present it reports that it could not use the real
 * runtime and falls back to the system Node, naming the weaker guarantee rather than implying the
 * strong one.
 *
 * Run: node scripts/verifyCjsLoadable.cjs   (or npm run verify:cjs)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}

console.log('\nRama CommonJS loadability — measured in the runtime that will run it');

// ── Which dependencies does the main process actually require() at runtime? ──
//
// Derived from source rather than listed, so a new dependency is covered the day it is added.
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.cjs')) out.push(p);
  }
  return out;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies || {}));

const required = new Set();
for (const f of walk(path.join(ROOT, 'electron'))) {
  const src = fs.readFileSync(f, 'utf8')
    // Comments stripped: a package NAMED in prose is not a package REQUIRED in code, and this
    // project has paid five times for patterns that could not tell the difference.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const m of src.matchAll(/require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) {
    const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
    if (declared.has(name)) required.add(name);
  }
}

const names = [...required].sort();
check('runtime dependencies were found to check', names.length >= 5, String(names.length));
console.log(`        ${names.length} production dependency(ies) required from electron/: ${names.join(', ')}`);

// ── Declared module type, read off disk ─────────────────────────────────────
//
// `"type": "module"` with no `require` condition in `exports` cannot be require()d by any Node that
// lacks require(esm). This is the static half; the runtime probe below is the real answer.
const esmOnly = [];
for (const n of names) {
  const mp = path.join(ROOT, 'node_modules', n, 'package.json');
  if (!fs.existsSync(mp)) continue;
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const dual = !!(m.main && /cjs|\.cjs$/.test(String(m.main)))
    || JSON.stringify(m.exports || {}).includes('"require"');
  if (m.type === 'module' && !dual) esmOnly.push(`${n}@${m.version}`);
}
check('no required dependency is ESM-only with no CommonJS entry',
  esmOnly.length === 0, esmOnly.join(', '));

// ── The runtime probe, inside Electron ──────────────────────────────────────
function electronBinary() {
  try {
    const p = require(path.join(ROOT, 'node_modules', 'electron'));
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  const guess = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  return fs.existsSync(guess) ? guess : null;
}

const probe = `
const out = { node: process.versions.node, electron: process.versions.electron || null, results: {} };
for (const name of ${JSON.stringify(names)}) {
  try { require(name); out.results[name] = 'ok'; }
  catch (e) { out.results[name] = String(e && e.message || e).split('\\n')[0]; }
}
process.stdout.write('RAMA_PROBE' + JSON.stringify(out));
`;

const bin = electronBinary();
let parsed = null;
let ranInElectron = false;

if (bin) {
  const r = spawnSync(bin, ['-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    // ELECTRON_RUN_AS_NODE makes the binary behave as its own bundled Node, which is exactly the
    // interpreter the main process runs under — and the whole point of this suite.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const i = text.indexOf('RAMA_PROBE');
  if (i >= 0) {
    try { parsed = JSON.parse(text.slice(i + 'RAMA_PROBE'.length)); ranInElectron = true; }
    catch { parsed = null; }
  }
}

if (!ranInElectron) {
  // HONEST DEGRADATION. A suite that quietly measured the wrong runtime is what created this defect,
  // so the weaker guarantee is named rather than presented as the strong one.
  console.log('        COULD NOT USE ELECTRON\'S NODE — no runnable binary found. Falling back to the');
  console.log('        system Node, which is a WEAKER check: system Node may permit require(esm)');
  console.log('        where Electron\'s bundled Node does not, which is exactly how three ESM-only');
  console.log('        packages passed review and broke the running app.');
  const results = {};
  for (const n of names) {
    try { require(n); results[n] = 'ok'; }
    catch (e) { results[n] = String(e.message).split('\n')[0]; }
  }
  parsed = { node: process.versions.node, electron: null, results };
}

console.log(`        probe ran on Node ${parsed.node}`
  + `${parsed.electron ? ` inside Electron ${parsed.electron}` : ' (system Node)'}`);
check('the probe reported on every dependency',
  Object.keys(parsed.results).length === names.length,
  `${Object.keys(parsed.results).length} of ${names.length}`);

const broken = Object.entries(parsed.results).filter(([, v]) => v !== 'ok');
// THE ROW THAT WOULD HAVE CAUGHT IT. REDBY: install an ESM-only package that electron/ requires.
check('every dependency the main process requires actually loads in that runtime',
  broken.length === 0,
  broken.map(([k, v]) => `${k}: ${v}`).join(' | '));

check('this ran inside Electron rather than the system Node',
  ranInElectron,
  'the fallback above is a weaker guarantee and says so');

// ═══ node-pty must SPAWN, not merely load ══════════════════════════════════
//
// THIS ROW REPLACES A HELD-BY-HAND NOTE, and the note is why it exists. node-pty 1.0.0 `require()`d
// cleanly and could not spawn: `Cannot find module '../build/Release/conpty.node'`, because the
// binary was never built and this machine has no compiler. **Loadability passed; the Terminal was
// dead.** `package.json`'s own note had concluded from that clean `require()` that the gyp step was
// "ceremony", which was true for argon2 and wrong for this.
//
// So loadability is the floor, and for the one dependency whose whole purpose is to start a process,
// the floor is not enough. node-pty 1.1.0 is Node-API (`node-addon-api`) and ships its prebuilds
// inside the npm tarball — `prebuilds/win32-x64/{pty,conpty}.node` plus `conpty.dll` and
// `OpenConsole.exe` — so no compiler is involved and the ABI is stable across Electron versions.
//
// REDBY: downgrade to node-pty 1.0.0, or delete the `prebuilds/` directory.
if (names.includes('node-pty')) {
  console.log('\n  node-pty must start a process, not just load');
  const ptyPrebuild = path.join(ROOT, 'node_modules', 'node-pty', 'prebuilds',
    `${process.platform}-${process.arch}`);
  check('a prebuilt binary for this platform ships with the package',
    fs.existsSync(ptyPrebuild), ptyPrebuild);
  check('and it includes a pty binary', fs.existsSync(path.join(ptyPrebuild, 'pty.node')));

  if (bin) {
    const spawnProbe = [
      'try {',
      "  const pty = require('node-pty');",
      "  const p = pty.spawn(process.env.COMSPEC || '/bin/sh', [], { cols: 80, rows: 24 });",
      "  let got = '';",
      '  p.onData((d) => { got += d; });',
      '  setTimeout(() => {',
      "    process.stdout.write('RAMAPTY' + JSON.stringify({ ok: true, pid: p.pid,",
      '      bytesRead: got.length, node: process.versions.node }));',
      '    try { p.kill(); } catch (e) { /* already gone */ }',
      '    process.exit(0);',
      '  }, 2500);',
      '} catch (e) {',
      "  process.stdout.write('RAMAPTY' + JSON.stringify({ ok: false,",
      "    error: String(e && e.message || e).split('\\n')[0] }));",
      '  process.exit(0);',
      '}',
    ].join('\n');
    const pr = spawnSync(bin, ['-e', spawnProbe], {
      cwd: ROOT, encoding: 'utf8', timeout: 90000, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const pt = `${pr.stdout || ''}${pr.stderr || ''}`;
    const pi = pt.indexOf('RAMAPTY');
    let res = null;
    if (pi >= 0) { try { res = JSON.parse(pt.slice(pi + 'RAMAPTY'.length)); } catch { res = null; } }
    check('node-pty spawns a real shell inside Electron\'s Node',
      !!res && res.ok === true, res ? (res.error || JSON.stringify(res)) : 'probe produced no result');
    check('and the shell wrote something back, so the pty is genuinely connected',
      !!res && res.ok === true && res.bytesRead > 0,
      res ? `bytesRead=${res.bytesRead}` : 'no result');
  } else {
    check('node-pty spawn could not be probed — no Electron binary', false,
      'this is reported as a failure rather than skipped: the Terminal was dead for an unknown '
      + 'length of time precisely because nothing asserted it could start');
  }
}

console.log('\n  held by hand, listed rather than implied:');
console.log('    - loadability is a floor, not a functional claim. The node-pty rows above are the');
console.log('      one place it is taken further, because that module exists to start a process');
console.log('    - lazy `require()` inside a function body is found by the same scan, but a require');
console.log('      built from a computed name would not be');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
