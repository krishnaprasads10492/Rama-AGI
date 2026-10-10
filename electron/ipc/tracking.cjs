'use strict';

/**
 * tracking.cjs — the read side of Function tracking (spec Section 138).
 *
 * Master asked whether he could see what is going on through StockMind, or any module, by triggering
 * a call. Before this file the answer was no for a reason worth stating: the record existed and
 * NOTHING COULD REACH IT — no `ipcMain` handle, no preload surface, no route. A store with no reader
 * is not an observability feature.
 *
 * GATED ON `audit.all`, WHICH ALREADY EXISTS. Cross-module telemetry is exactly what that capability
 * names (tier 2 and above), so no new key is invented and `shared/capabilities.json` — a PROTECTED
 * file — is not touched. `audit.own` exists too and is deliberately NOT accepted here: these records
 * are about MODULES, not about the caller, so "your own audit" is not the right permission for them.
 *
 * IT REFUSES, IT DOES NOT THROW. Every handler returns `{ok:false, error}` on a refusal, matching
 * `capability.deny`'s shape, so a renderer that is not allowed to read telemetry gets a sentence it
 * can show rather than an unhandled rejection.
 *
 * AND IT TELLS THE TRUTH ABOUT BEING EMPTY. An empty result from an uninstrumented system looks
 * identical to an empty result from a quiet one, so `instrumented: false` is returned whenever the
 * store holds nothing at all. "Nothing was recorded" and "nothing happened" are different facts and
 * this is the one place that can still tell them apart.
 */

const tracking = require('../lib/functionTracking.cjs');

let capability = null;
try { capability = require('../lib/capability.cjs'); } catch { capability = null; }

let dataStore = null;
try { dataStore = require('../dataStore.cjs'); } catch { dataStore = null; }

/** The capability a caller must hold. Existing key, deliberately not a new one. */
const NEEDS = 'audit.all';

function guard(user) {
  if (!capability || typeof capability.can !== 'function') {
    return { ok: false, error: 'the capability matrix is unavailable, so no telemetry is served.' };
  }
  if (!capability.can(user, NEEDS)) {
    return { ok: false, error: `reading cross-module telemetry needs ${NEEDS}.` };
  }
  if (!dataStore || typeof dataStore.get !== 'function') {
    return { ok: false, error: 'the data store is unavailable, so there is nothing to read.' };
  }
  return null;
}

/** Whether ANY record exists, which is what separates "not instrumented" from "quiet". */
function anyRecords() {
  try {
    const bag = dataStore.get(tracking.DOMAIN) || {};
    const rows = bag[tracking.ARRAY_KEY];
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

function register(ipcMain) {
  ipcMain.handle('tracking:query', async (_e, opts) => {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const denied = guard(o.user);
    if (denied) return denied;
    const records = tracking.query(dataStore, o);
    return {
      ok: true,
      records,
      instrumented: anyRecords(),
      // Said in words, because a caller that only reads `records.length` cannot tell the two apart.
      note: anyRecords()
        ? `${records.length} record(s) match this filter.`
        : 'no call site is instrumented yet, so this is an EMPTY RECORD rather than a quiet system.',
    };
  });

  ipcMain.handle('tracking:summary', async (_e, opts) => {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const denied = guard(o.user);
    if (denied) return denied;
    const summary = tracking.summarise(dataStore, o);
    return { ok: true, summary, instrumented: anyRecords(), capacity: tracking.CAP };
  });

  // What CAN be asked, so a caller does not have to guess the vocabulary. No user data, no gate
  // needed: it returns only the shape of the contract.
  ipcMain.handle('tracking:shape', async () => ({
    ok: true,
    domain: tracking.DOMAIN,
    outcomes: tracking.OUTCOMES,
    capacity: tracking.CAP,
    filters: ['module', 'fn', 'outcome', 'from', 'to', 'limit'],
    needs: NEEDS,
  }));
}

module.exports = { register, NEEDS, anyRecords };
