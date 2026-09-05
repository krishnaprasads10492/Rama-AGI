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

/**
 * Does every channel the preload INVOKES have a `handle`, and every channel it SENDS have an `on`?
 *
 * THE BUG THIS EXISTS FOR (Section 90). Settings → About called
 * `ipcRenderer.invoke('updater:install-now')`, but that channel is registered with `ipcMain.on`.
 * Electron rejects an `invoke` against a `send`-only channel with "No handler registered", and the
 * call site had no `.catch` — so the button did nothing at all, silently, in a shipped build.
 *
 * Nothing could see it. `node --check` passes, both lines are valid, the bridge check only asks
 * whether the preload EXPOSES the function, and the scope check only resolves identifiers. The
 * mismatch is between two files and two different Electron APIs.
 *
 * Only single-quoted literal channel names are considered; a templated channel is skipped rather
 * than guessed at, on the same rule the globals allowlist follows — a false positive here would
 * block a commit over working code.
 */
function findIpcMismatches(preloadCode, mainCodes = []) {
  // Registered sets. The `ipcMain` object is often a parameter of a register(ipcMain) function, and
  // sometimes a recorder wrapper, so match on the method rather than the receiver name.
  const handled = new Set();
  const listened = new Set();

  // A quoted, channel-shaped literal, e.g. 'market:ohlcv'.
  //
  // NOTE ON WHY THIS IS ONE TIGHT PATTERN rather than "find every quoted string, then test its
  // shape": scanning for /'([^']+)'/ pairs off the quotes sequentially, and a single apostrophe in
  // a comment — "Rāma's", "master's", "doesn't", all over this codebase — shifts every pair after
  // it by one, so real literals are swallowed by a span that starts at the wrong quote. Measured on
  // marketIntel.cjs: 126 "literals" found, ZERO of them channel-shaped, while the file plainly
  // contains 'market:forecast'. Anchoring both quotes and the content shape in one pattern makes
  // the match self-contained and immune to that drift.
  const CHANNEL_LITERAL = /'([a-z][\w-]*:[\w-]+)'/gi;

  for (const code of mainCodes) {
    for (const m of code.matchAll(/\.handle\(\s*'([^']+)'/g)) handled.add(m[1]);
    for (const m of code.matchAll(/\.handleOnce\(\s*'([^']+)'/g)) handled.add(m[1]);
    for (const m of code.matchAll(/\.on\(\s*'([^']+)'/g)) listened.add(m[1]);

    // DYNAMIC REGISTRATION. `marketIntel.cjs` builds a map and registers it in a loop:
    //   for (const [channel, fn] of Object.entries(readOnly)) ipcMain.handle(channel, ...)
    // so the channel name is an OBJECT KEY and never sits next to `.handle(`. The first version of
    // this check reported 26 of those as missing handlers — all false positives, in working
    // shipped code. Since a false positive blocks a commit over correct code and erodes trust
    // faster than a miss (the rule the globals allowlist already follows), a file that registers
    // dynamically has every channel-shaped literal in it treated as registered.
    //
    // The check therefore stays conservative and still catches what it was built for: a channel
    // registered with `.on` but invoked, and a channel registered nowhere at all.
    if (/\.handle\(\s*[A-Za-z_$]/.test(code)) {
      for (const m of code.matchAll(CHANNEL_LITERAL)) handled.add(m[1]);
    }
    if (/\.on\(\s*[A-Za-z_$]/.test(code)) {
      for (const m of code.matchAll(CHANNEL_LITERAL)) listened.add(m[1]);
    }
  }

  const problemsFound = [];
  let checked = 0;

  for (const m of preloadCode.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)) {
    checked += 1;
    const ch = m[1];
    if (handled.has(ch)) continue;
    problemsFound.push({
      channel: ch,
      kind: listened.has(ch) ? 'invoke-on-listener' : 'invoke-unregistered',
      msg: listened.has(ch)
        ? `invoke without a handler: channel "${ch}" is registered with ipcMain.on, so invoke() `
          + 'will be rejected — use ipcRenderer.send, or register it with ipcMain.handle'
        : `invoke without a handler: channel "${ch}" has no ipcMain.handle anywhere in electron/`,
    });
  }

  for (const m of preloadCode.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)) {
    checked += 1;
    const ch = m[1];
    // A `handle`-only channel still receives a `send`, but nothing ever replies and the caller
    // cannot tell — worth reporting, since it is the same confusion in the other direction.
    if (listened.has(ch)) continue;
    problemsFound.push({
      channel: ch,
      kind: handled.has(ch) ? 'send-on-handler' : 'send-unregistered',
      msg: handled.has(ch)
        ? `send without a listener: channel "${ch}" is registered with ipcMain.handle only, so `
          + 'send() is silently dropped — use ipcRenderer.invoke'
        : `send without a listener: channel "${ch}" has no ipcMain.on anywhere in electron/`,
    });
  }

  return { checked, problems: problemsFound };
}

/** Read the real files and report. The pure checker above is what the test drives. */
function auditIpcParity() {
  const ELECTRON = path.join(ROOT, 'electron');
  const preloadPath = path.join(ELECTRON, 'preload.cjs');
  if (!fs.existsSync(preloadPath)) return 0;

  const codes = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') collect(p); }
      else if (e.name.endsWith('.cjs')) codes.push(fs.readFileSync(p, 'utf8'));
    }
  })(ELECTRON);

  const res = findIpcMismatches(fs.readFileSync(preloadPath, 'utf8'), codes);
  for (const p of res.problems) report(preloadPath, p.msg);
  return res.checked;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
function main() {
  const files = walk(SRC);

  process.stdout.write(`\n${C.cyan}Rāma renderer audit${C.reset} ${C.dim}${files.length} files${C.reset}\n\n`);

  const storeSites  = auditStores(files);
  const bridgeSites = auditBridge(files);
  const scopeFiles  = auditUndefined(files);
  const ipcChannels = auditIpcParity();

  process.stdout.write(`  ${C.dim}store destructures checked${C.reset}  ${storeSites}\n`);
  process.stdout.write(`  ${C.dim}bridge calls checked${C.reset}        ${bridgeSites}\n`);
  process.stdout.write(`  ${C.dim}files scope-checked${C.reset}         ${scopeFiles}\n`);
  process.stdout.write(`  ${C.dim}ipc channels matched${C.reset}        ${ipcChannels}\n\n`);

  if (problems.length === 0) {
    process.stdout.write(`  ${C.green}✓ stores, bridge calls, identifiers and IPC channels all resolve${C.reset}\n\n`);
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

module.exports = { findUndefinedIdentifiers, findIpcMismatches, GLOBALS, walk };
