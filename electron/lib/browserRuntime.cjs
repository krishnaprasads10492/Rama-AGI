'use strict';

/**
 * browserRuntime.cjs — which browser Rāma can actually drive (Section 94).
 *
 * Master: *"ability to assimilate existing browsers and their capabilities into RAMA."*
 *
 * MEASURED FIRST, then written. On this machine `playwright` is installed and pinned, its bundled
 * Chromium binary is **absent** — `npm install playwright` does not download browsers, and nothing in
 * the project ever ran `playwright install` — yet Edge and Chrome are both present and **both launch
 * correctly through Playwright's `channel` option**.
 *
 * So the capability was already owned and simply not reached for. Downloading a third Chromium would
 * spend ~150 MB of master's scarcest resource to obtain something he has.
 *
 * Discovery is PURE with the existence check injected, so it is testable with no browser present.
 */

const path = require('path');

/**
 * Candidates in preference order.
 *
 * Edge before Chrome deliberately: Edge ships with Windows, so preferring it makes Rāma's behaviour
 * consistent across installs rather than dependent on what master happens to have added.
 *
 * `channel` is how Playwright drives an installed browser; `paths` exist so a browser installed
 * somewhere unusual is still found, and so discovery can report a concrete file as its evidence.
 */
const CANDIDATES = [
  {
    id: 'msedge',
    label: 'Microsoft Edge',
    channel: 'msedge',
    paths: [
      '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
      '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/microsoft-edge',
    ],
  },
  {
    id: 'chrome',
    label: 'Google Chrome',
    channel: 'chrome',
    paths: [
      '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
      '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
      '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
    ],
  },
  {
    id: 'brave',
    label: 'Brave',
    // Playwright has no `brave` channel, so Brave is only reachable by explicit executable path.
    channel: null,
    paths: [
      '%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
  },
];

/** `%ProgramFiles%\x` → `C:\Program Files\x`. Unset variables make the candidate unresolvable. */
function expand(p, env = process.env) {
  let out = String(p);
  const vars = out.match(/%([^%]+)%/g) || [];
  for (const v of vars) {
    const name = v.slice(1, -1);
    const val = env[name];
    if (!val) return null;
    out = out.split(v).join(val);
  }
  return path.normalize(out);
}

/**
 * What can Rāma drive right now?
 *
 * @param {object}   deps
 * @param {function} deps.exists     `(p) => boolean`, injected so tests need no filesystem
 * @param {object}   deps.playwright the module, or null when it could not be required
 * @param {object}   deps.env
 *
 * @returns {{available:Array, chosen:object|null, playwrightPresent:boolean, reason:string|null}}
 *
 * Every entry reports HOW it was found — `bundled`, `channel` or `path` — on the same rule as
 * Section 92's model classification: a capability Rāma claims must be traceable to its evidence.
 */
function discover({ exists, playwright = null, env = process.env } = {}) {
  const has = typeof exists === 'function' ? exists : () => false;
  const available = [];

  if (!playwright) {
    return {
      available: [],
      chosen: null,
      playwrightPresent: false,
      reason: 'playwright is not installed, so no browser can be driven',
    };
  }

  // 1. Playwright's own Chromium, when the binary was actually downloaded. Preferred when present
  //    because Playwright pins the library/browser pair, making it the least surprising choice.
  try {
    const p = playwright.chromium.executablePath();
    if (p && has(p)) {
      available.push({
        id: 'chromium', label: 'Bundled Chromium', how: 'bundled',
        launch: {}, executablePath: p, evidence: p,
      });
    }
  } catch { /* older or stubbed playwright: fall through to installed browsers */ }

  // 2. Browsers master already has. This is the assimilation.
  for (const c of CANDIDATES) {
    const found = c.paths.map(p => expand(p, env)).find(p => p && has(p));
    if (!found) continue;

    available.push({
      id: c.id,
      label: c.label,
      // A `channel` is the supported route and lets Playwright apply its own launch fixes; an
      // explicit path is the fallback for a browser it has no channel for, such as Brave.
      how: c.channel ? 'channel' : 'path',
      launch: c.channel ? { channel: c.channel } : { executablePath: found },
      executablePath: found,
      evidence: found,
    });
  }

  return {
    available,
    chosen: available[0] || null,
    playwrightPresent: true,
    reason: available.length
      ? null
      : 'playwright is installed but no drivable browser was found — install Microsoft Edge or '
        + 'Google Chrome, or run: npx playwright install chromium',
  };
}

/**
 * Launch options for the best available browser, merged over the caller's.
 *
 * Returns `null` when nothing can be driven, so callers must handle absence explicitly rather than
 * receiving options that will fail at launch with a less legible error.
 */
function launchOptions(found, opts = {}) {
  if (!found || !found.chosen) return null;
  return { ...opts, ...found.chosen.launch };
}

module.exports = { discover, launchOptions, expand, CANDIDATES };
