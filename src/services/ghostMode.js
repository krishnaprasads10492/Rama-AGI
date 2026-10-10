/**
 * ghostMode.js — Rāma AGI Zero-Trace Wipe.
 *
 * Ported from StockMind AI's ghostMode implementation.
 * One call wipes ALL traces of Rāma from this browser/device:
 *   localStorage (rama_ keys), sessionStorage, IndexedDB,
 *   Cache API, Service Workers, cookies, history state, DOM.
 *
 * Does NOT delete server-side encrypted data automatically —
 * that requires wipeServerData() with a master session token.
 *
 * Security use case: master activates this if device is compromised
 * or before handing device to someone else.
 */

import { apiFetch } from './apiClient.js';

// ── Local wipe helpers ─────────────────────────────────────────────────────
/**
 * THE PREFIXES THIS APP ACTUALLY WRITES — and the list used to be wrong, which meant Ghost Mode
 * wiped NOTHING (spec Section 143).
 *
 * It matched `rama_` and `sm_`. Every key this application writes is `rama.`-DOTTED, measured across
 * `src/`: `rama.paletteOpen`, `rama.micMode`, `rama.micMuted`, `rama.speechMuted`, `rama.ramaSpeaks`,
 * `rama.stockmind.chart`, `rama.stockmind.drawings*`, `rama.stockmind.workspace`. Eight of eight
 * survived a "zero-trace wipe" — master's chart drawings, workspace layout and voice settings all
 * still on the device he was handing over, with the function reporting nothing at all.
 *
 * `rama_` and `sm_` are KEPT rather than replaced: `sm_` is the StockMind heritage prefix this was
 * ported from, and a key written by an older build must still be removed. Widening a wipe is additive;
 * narrowing it would be the defect again in the other direction.
 *
 * `verifyReachability.cjs` asserts every storage key literal in `src/` is covered by one of these,
 * so a new dotted namespace cannot slip past the list again.
 */
const WIPE_PREFIXES = Object.freeze(['rama.', 'rama_', 'sm_']);

/**
 * @returns {{ok: boolean, removed: string[], failed: string[], error: string|null}}
 *   The key NAMES are returned, never their values: a caller may want to tell master what was
 *   cleared, and nothing here should put a stored value back on screen.
 */
function clearLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') {
      return { ok: true, removed: [], failed: [], error: 'no localStorage in this context' };
    }
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && WIPE_PREFIXES.some(p => key.startsWith(p))) keysToRemove.push(key);
    }
    const removed = [];
    const failed = [];
    for (const k of keysToRemove) {
      try {
        localStorage.removeItem(k);
        // VERIFIED, NOT ASSUMED. A removal that silently did nothing is the whole class of bug this
        // function just had; re-reading the key is one line and turns a hope into a fact.
        if (localStorage.getItem(k) === null) removed.push(k);
        else failed.push(k);
      } catch { failed.push(k); }
    }
    return { ok: failed.length === 0, removed, failed, error: null };
  } catch (err) {
    return { ok: false, removed: [], failed: [], error: err?.message || String(err) };
  }
}

function clearSessionStorageAll() {
  try {
    if (typeof sessionStorage === 'undefined') {
      return { ok: true, error: 'no sessionStorage in this context' };
    }
    sessionStorage.clear();
    return { ok: sessionStorage.length === 0, error: null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function clearIndexedDB() {
  try {
    if (!window.indexedDB) return { ok: true, error: null };
    const dbs = await window.indexedDB.databases?.() ?? [];
    await Promise.allSettled(
      dbs.map(db => new Promise((resolve, reject) => {
        if (!db.name) { resolve(); return; }
        const req   = window.indexedDB.deleteDatabase(db.name);
        req.onsuccess = resolve;
        req.onerror   = reject;
        req.onblocked = resolve;
      }))
    );
    return { ok: true, error: null };
  } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

async function unregisterServiceWorkers() {
  try {
    if (!navigator.serviceWorker) return { ok: true, error: null };
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map(r => r.unregister()));
    return { ok: true, error: null };
  } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

async function clearCacheAPI() {
  try {
    if (!window.caches) return { ok: true, error: null };
    const keys = await caches.keys();
    await Promise.allSettled(keys.map(k => caches.delete(k)));
    return { ok: true, error: null };
  } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

function clearCookies() {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const name = cookie.split('=')[0].trim();
      if (!name) continue;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
    }
    return { ok: true, error: null };
  } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

function replaceHistoryState() {
  try {
    window.history.replaceState(null, '', window.location.href);
    window.history.pushState(null, '', 'about:blank');
    return { ok: true, error: null };
  } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

function overwriteDOM() {
  try {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.title = '';
  } catch { /* ignore */ }
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Activate Ghost Mode — complete zero-trace wipe.
 * After this call, page navigates to about:blank.
 * No trace of Rāma remains in the browser.
 */
/**
 * @param {{navigate?: boolean}} [opts] `navigate: false` performs the wipe and SKIPS the jump to
 *   about:blank — which is the only way a caller, or a test, can read the report. The default stays
 *   `true` so the shipped behaviour is unchanged.
 * @returns {Promise<{ok: boolean, steps: object, failed: string[]}>}
 *
 * IT RETURNED `undefined`. A function whose entire purpose is to leave no trace reported neither
 * success nor failure, so "Ghost Mode ran" and "Ghost Mode wiped nothing" were the same observation —
 * and for the local-storage step they were the same FACT for as long as the prefix list was wrong.
 * Each step is now reported by name.
 */
export async function activateGhostMode(opts = {}) {
  const navigate = opts.navigate !== false;
  const steps = {};

  steps.localStorage = clearLocalStorage();
  steps.sessionStorage = clearSessionStorageAll();
  steps.cookies = clearCookies();

  const [idb, sw, caches_] = await Promise.allSettled([
    clearIndexedDB(),
    unregisterServiceWorkers(),
    clearCacheAPI(),
  ]);
  const settled = (r, name) => (r.status === 'fulfilled'
    ? (r.value ?? { ok: true, error: null })
    : { ok: false, error: `${name} threw: ${r.reason?.message || String(r.reason)}` });
  steps.indexedDB = settled(idb, 'indexedDB');
  steps.serviceWorkers = settled(sw, 'serviceWorkers');
  steps.caches = settled(caches_, 'caches');

  steps.history = replaceHistoryState();

  const failed = Object.entries(steps).filter(([, s]) => s && s.ok === false).map(([k]) => k);

  // THE DOM GOES LAST, and only when navigating. Blanking the document before the caller can read
  // the report would make the report unreachable by construction — which is the same mistake in a
  // new shape.
  if (navigate) {
    overwriteDOM();
    try {
      window.location.replace('about:blank');
    } catch {
      window.location.href = 'about:blank';
    }
  }

  return { ok: failed.length === 0, steps, failed };
}

/**
 * Wipe all server-side encrypted data.
 *
 * `serverToken` is the per-boot shared secret (RAMA_SERVER_TOKEN) the
 * launcher hands to the Electron main process — NOT the user's session
 * token. The endpoint used to accept any non-empty `x-session-token` value
 * from a local caller, which validated nothing; it now requires this boot
 * token via `requireLocalToken` (server/routes/auth.cjs), the same guard
 * every other locally-privileged-but-HTTP-reachable route uses. Not yet
 * wired to a caller in the UI — exposing it needs a way to hand the
 * renderer this boot token first (e.g. via `window.rama`), which does not
 * exist yet.
 * POST /api/ghost/wipe
 */
export async function wipeServerData(serverToken) {
  const res = await apiFetch('/api/ghost/wipe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-rama-token': serverToken },
    body:    JSON.stringify({ confirm: true }),
    timeoutMs: 15000,
  });
  return res.json();
}
