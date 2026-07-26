'use strict';

/**
 * auditRenderer.cjs — catch the "<name> is not a function" bug class statically.
 *
 * WHY THIS EXISTS: two kinds of typo produce `undefined` instead of an error at
 * the point of the mistake, then throw "not a function" somewhere unrelated and
 * much later:
 *
 *   1. destructuring a key a Zustand store does not define
 *      (`const { setLastHealthCheck } = useAppStore()` — it lives in uiStore)
 *   2. calling a `window.rama.<ns>.<fn>` that preload does not expose
 *
 * Both have cost real debugging time on this project, and neither is caught by
 * `node --check` or by a build. This script finds them in seconds.
 *
 * Usage:  node scripts/auditRenderer.cjs
 *         npm run audit
 *
 * Exit code 1 when anything is unresolved, so it can gate a commit or CI.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'src');

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const problems = [];
const report = (file, msg) => problems.push({ file: path.relative(ROOT, file), msg });

// ─── 1. Zustand store keys ────────────────────────────────────────────────────
function auditStores(files) {
  const stores = {};
  const storeDir = path.join(SRC, 'store');
  if (!fs.existsSync(storeDir)) return 0;

  for (const file of fs.readdirSync(storeDir)) {
    if (!file.endsWith('.js')) continue;
    const base = file.replace(/\.js$/, '');

    // uiStore is exported as useUIStore, not useUiStore — accept both spellings
    const names = new Set([
      `use${base[0].toUpperCase()}${base.slice(1)}`,
      `use${base.replace(/^ui/, 'UI').replace(/^([a-z])/, c => c.toUpperCase())}`,
    ]);

    const text = fs.readFileSync(path.join(storeDir, file), 'utf8');
    const keys = new Set();
    for (const m of text.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm))            keys.add(m[1]);
    for (const m of text.matchAll(/^\s{2}(?:get\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) keys.add(m[1]);

    for (const n of names) stores[n] = keys;
  }

  let checked = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /(?:const|let)\s*\{([^}]+)\}\s*=\s*(use\w+Store)\s*\(\s*\)/g;

    for (const m of text.matchAll(re)) {
      const known = stores[m[2]];
      if (!known) { report(file, `unknown store ${m[2]}`); continue; }
      checked++;

      const names = m[1].split(',')
        .map(s => s.split(':')[0].replace(/\/\/.*/, '').trim())
        .filter(Boolean);

      const missing = names.filter(n => !known.has(n));
      if (missing.length) report(file, `${m[2]} does not define: ${missing.join(', ')}`);
    }
  }
  return checked;
}

// ─── 2. Preload bridge surface ────────────────────────────────────────────────
function auditBridge(files) {
  const preloadPath = path.join(ROOT, 'electron', 'preload.cjs');
  if (!fs.existsSync(preloadPath)) return 0;

  const preload = fs.readFileSync(preloadPath, 'utf8');
  const api = {};
  let ns = null;

  for (const raw of preload.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '');

    const nsOpen = line.match(/^ {2}([A-Za-z_$][\w$]*)\s*:\s*\{\s*$/);
    if (nsOpen) { ns = nsOpen[1]; api[ns] = new Set(); continue; }
    if (/^ {2}\},?\s*$/.test(line)) { ns = null; continue; }

    if (ns) {
      const member = line.match(/^ {4}([A-Za-z_$][\w$]*)\s*:/);
      if (member) api[ns].add(member[1]);
    }
  }

  let checked = 0;
  const seen = new Set();

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /window\.rama\??\.([A-Za-z_$][\w$]*)\??\.([A-Za-z_$][\w$]*)\s*\??\.?\(/g;

    for (const m of text.matchAll(re)) {
      const [, nsName, fnName] = m;
      const key = `${file}|${nsName}.${fnName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checked++;

      if (!api[nsName])            report(file, `window.rama.${nsName} is not exposed by preload`);
      else if (!api[nsName].has(fnName)) report(file, `window.rama.${nsName}.${fnName} is not exposed by preload`);
    }
  }
  return checked;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
const files = walk(SRC);

process.stdout.write(`\n${C.cyan}Rāma renderer audit${C.reset} ${C.dim}${files.length} files${C.reset}\n\n`);

const storeSites  = auditStores(files);
const bridgeSites = auditBridge(files);

process.stdout.write(`  ${C.dim}store destructures checked${C.reset}  ${storeSites}\n`);
process.stdout.write(`  ${C.dim}bridge calls checked${C.reset}        ${bridgeSites}\n\n`);

if (problems.length === 0) {
  process.stdout.write(`  ${C.green}✓ every store key and bridge call resolves${C.reset}\n\n`);
  process.exit(0);
}

for (const p of problems) {
  process.stdout.write(`  ${C.red}✕${C.reset} ${p.file}\n      ${C.dim}${p.msg}${C.reset}\n`);
}
process.stdout.write(`\n  ${C.yellow}${problems.length} unresolved reference(s)${C.reset}\n\n`);
process.exit(1);
