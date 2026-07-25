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
function clearLocalStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('rama_') || key.startsWith('sm_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

function clearSessionStorageAll() {
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

async function clearIndexedDB() {
  try {
    if (!window.indexedDB) return;
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
  } catch { /* ignore */ }
}

async function unregisterServiceWorkers() {
  try {
    if (!navigator.serviceWorker) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map(r => r.unregister()));
  } catch { /* ignore */ }
}

async function clearCacheAPI() {
  try {
    if (!window.caches) return;
    const keys = await caches.keys();
    await Promise.allSettled(keys.map(k => caches.delete(k)));
  } catch { /* ignore */ }
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
  } catch { /* ignore */ }
}

function replaceHistoryState() {
  try {
    window.history.replaceState(null, '', window.location.href);
    window.history.pushState(null, '', 'about:blank');
  } catch { /* ignore */ }
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
export async function activateGhostMode() {
  clearLocalStorage();
  clearSessionStorageAll();
  clearCookies();

  await Promise.allSettled([
    clearIndexedDB(),
    unregisterServiceWorkers(),
    clearCacheAPI(),
  ]);

  replaceHistoryState();
  overwriteDOM();

  try {
    window.location.replace('about:blank');
  } catch {
    window.location.href = 'about:blank';
  }
}

/**
 * Wipe all server-side encrypted data.
 * Requires master session token.
 * POST /api/ghost/wipe
 */
export async function wipeServerData(token) {
  const res = await apiFetch('/api/ghost/wipe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ confirm: true }),
    timeoutMs: 15000,
  });
  return res.json();
}
