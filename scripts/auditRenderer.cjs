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

// ─── Globals a renderer module may legitimately reference ─────────────────────
//
// Deliberately generous. A false positive here fails the audit and blocks a commit over working
// code, which is worse than missing one name — the check earns trust by being quiet when the code
// is fine. Anything genuinely absent from this list AND undeclared is a real bug.
const GLOBALS = new Set([
  // ES
  'globalThis', 'undefined', 'NaN', 'Infinity', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Symbol', 'BigInt', 'Math', 'JSON', 'Date', 'RegExp', 'Function', 'Promise', 'Proxy', 'Reflect',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'Intl', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'structuredClone', 'queueMicrotask', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array',
  'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'escape',
  'unescape', 'eval',
  // Timers and scheduling
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  // DOM and BOM
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'console', 'alert',
  'confirm', 'prompt', 'localStorage', 'sessionStorage', 'indexedDB', 'getComputedStyle',
  'matchMedia', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'scrollTo', 'scrollBy', 'self', 'top', 'parent', 'frames', 'closed', 'CSS', 'customElements',
  'Element', 'HTMLElement', 'Node', 'NodeList', 'Text', 'DocumentFragment', 'Event',
  'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'DragEvent',
  'ClipboardEvent', 'FocusEvent', 'InputEvent', 'WheelEvent', 'TouchEvent', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'PerformanceObserver', 'performance', 'crypto',
  'atob', 'btoa', 'DOMParser', 'XMLSerializer', 'Image', 'Audio', 'Option', 'FileReader',
  'Blob', 'File', 'FormData', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'AbortController', 'AbortSignal', 'fetch', 'Headers', 'Request', 'Response', 'WebSocket',
  'XMLHttpRequest', 'Worker', 'SharedWorker', 'MessageChannel', 'MessagePort', 'BroadcastChannel',
  'Notification', 'ImageData', 'Path2D', 'OffscreenCanvas', 'ReadableStream', 'WritableStream',
  // CacheStorage — `caches` is a real global, used by ghostMode's wipe and guarded by
  // `window.caches` at the call site. Flagging it was the checker's first false positive.
  'caches', 'CacheStorage', 'ServiceWorkerRegistration', 'PushManager',
  // Media and speech, used by the voice ladder
  'MediaRecorder', 'MediaStream', 'AudioContext', 'webkitAudioContext', 'speechSynthesis',
  'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition',
  // Vite build-time
  'process',
]);

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

// ─── 3. Undefined identifiers ────────────────────────────────────────────────
//
// WHY THIS WAS ADDED (spec Section 81). The IDE and Resources pages both failed on mount, and
// this audit passed the whole time. Two one-line ReferenceErrors:
//
//   IDE.jsx        `currentUser` used inside FileTree, declared only in the sibling IDE()
//   Resources.jsx  `os?.cpus?.()` — `os` is a Node builtin, absent from the renderer
//
// Neither is visible to checks 1 and 2: they resolve bridge calls and store destructures, and a
// free variable is outside that model. `node --check` cannot see it either, because both are
// syntactically valid, and a Vite build happily bundles them.
//
// A FLAT MODULE-LEVEL CHECK WOULD HAVE MISSED THE IDE BUG, because `currentUser` IS declared in
// the file — just in a scope that cannot see it. That is why this uses Babel's real scope
// resolution (`scope.getBinding`) rather than collecting every declared name in the module.
function findUndefinedIdentifiers(code, filename = 'unknown') {
  const parser = require('@babel/parser');
  const traverseMod = require('@babel/traverse');
  const traverse = traverseMod.default || traverseMod;

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator',
        'objectRestSpread', 'dynamicImport', 'topLevelAwait'],
    });
  } catch (err) {
    return [{ name: null, line: err.loc?.line ?? null, parseError: err.message }];
  }

  const found = [];
  const seen = new Set();

  const consider = (p) => {
    const name = p.node.name;
    if (!name || GLOBALS.has(name)) return;
    // `getBinding` walks the real scope chain and returns nothing for a global, which is exactly
    // the distinction wanted: declared-but-out-of-scope resolves to undefined here.
    if (p.scope.getBinding(name)) return;
    const line = p.node.loc?.start?.line ?? null;
    const key = `${name}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ name, line });
  };

  traverse(ast, {
    Identifier(p) {
      if (!p.isReferencedIdentifier()) return;
      consider(p);
    },
    JSXIdentifier(p) {
      // `<div>` is an intrinsic element, not a reference. Only capitalised names are components
      // that must resolve, and an attribute name is never a reference.
      if (!/^[A-Z]/.test(p.node.name)) return;
      if (p.parentPath?.isJSXAttribute?.()) return;
      // In `<Foo.Bar>` only `Foo` is the binding; `Bar` is a property.
      if (p.parentPath?.isJSXMemberExpression?.() && p.parentPath.node.property === p.node) return;
      if (!p.isReferencedIdentifier()) return;
      consider(p);
    },
  });

  return found;
}

function auditUndefined(files) {
  let checked = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let hits;
    try {
      hits = findUndefinedIdentifiers(text, file);
    } catch (err) {
      report(file, `could not analyse: ${err.message}`);
      continue;
    }
    checked++;
    for (const h of hits) {
      if (h.parseError) {
        report(file, `parse error at line ${h.line}: ${h.parseError}`);
      } else {
        report(file, `\`${h.name}\` is not defined in this scope (line ${h.line})`);
      }
    }
  }
  return checked;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
function main() {
  const files = walk(SRC);

  process.stdout.write(`\n${C.cyan}Rāma renderer audit${C.reset} ${C.dim}${files.length} files${C.reset}\n\n`);

  const storeSites  = auditStores(files);
  const bridgeSites = auditBridge(files);
  const scopeFiles  = auditUndefined(files);

  process.stdout.write(`  ${C.dim}store destructures checked${C.reset}  ${storeSites}\n`);
  process.stdout.write(`  ${C.dim}bridge calls checked${C.reset}        ${bridgeSites}\n`);
  process.stdout.write(`  ${C.dim}files scope-checked${C.reset}         ${scopeFiles}\n\n`);

  if (problems.length === 0) {
    process.stdout.write(`  ${C.green}✓ stores, bridge calls and identifiers all resolve${C.reset}\n\n`);
    process.exit(0);
  }

  for (const p of problems) {
    process.stdout.write(`  ${C.red}✕${C.reset} ${p.file}\n      ${C.dim}${p.msg}${C.reset}\n`);
  }
  process.stdout.write(`\n  ${C.yellow}${problems.length} unresolved reference(s)${C.reset}\n\n`);
  process.exit(1);
}

// Guarded so the checker can be imported and tested without the script exiting the process.
if (require.main === module) main();

module.exports = { findUndefinedIdentifiers, GLOBALS, walk };
