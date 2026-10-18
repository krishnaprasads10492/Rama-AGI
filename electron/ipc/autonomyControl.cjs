'use strict';

/**
 * autonomyControl.cjs - the command surface for the autonomy stop (spec Section 150.2, D5).
 *
 * Section 132 built the kill-switch and left it with no way to be reached: nothing outside the gate and the
 * applier ever called `engage()`, and `lift()` needed a capability that was not in the matrix. Master
 * approved adding `system.suspend-autonomy` (tier 0), so the stop now has the three channels it needs.
 *
 *   autonomy:stop    ENGAGE. Open to any window, signed in or not, with no capability. A stop that can be
 *                    refused is not a stop (Section 132), and gating it would make the control an
 *                    operator reaches for in an incident depend on the subsystem being investigated. It
 *                    is fail-safe in the only direction that matters: all it can do is make Rāma do
 *                    LESS on its own. It records WHO from the main-process principal, never from the
 *                    payload, so a hostile renderer cannot sign the stop as someone else.
 *   autonomy:resume RESUME. The privileged half. Needs a signed-in session whose account holds
 *                    `system.suspend-autonomy` (master only) and a written note. The account is the
 *                    principal main validated for THIS window, not a user the renderer sent. There is
 *                    no voice or chat path to this channel, and the routing suite asserts there is none.
 *                    It ends the halt and restores what was there BEFORE the stop; it does not grant
 *                    new autonomy (see `autonomyStop.resume`).
 *   autonomy:status  Where things stand, in words and in booleans.
 *
 * This file is the only caller of `resume()`, and `lift()` - the explicit grant of NEW autonomous action -
 * has no caller at all: nothing in the system needs granting yet. `scripts/verifyAutonomyStop.cjs` asserts
 * both, so a new caller is a red row and not a quiet addition.
 */

const stop = require('../lib/autonomyStop.cjs');
const principalBinding = require('../lib/principalBinding.cjs');
const capability = require('../lib/capability.cjs');

const MAX_REASON = 200;
const MAX_NOTE = 500;
const VIA = Object.freeze(['settings', 'voice', 'chat', 'tray', 'unknown']);

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function who(principal) {
  return principal
    ? `${principal.username || principal.name || principal.id} (tier ${principal.tier})`
    : 'an unauthenticated window';
}

function view(principal) {
  const s = stop.status();
  return {
    stopped: s.stopped,
    halted: s.halted,
    text: stop.statusText(),
    record: s.stoppedRecord.present
      ? { at: s.stoppedRecord.at, reason: s.stoppedRecord.reason, by: s.stoppedRecord.by }
      : null,
    allow: s.allowFile.valid ? { by: s.allowFile.by, at: s.allowFile.at, note: s.allowFile.note } : null,
    env: s.env,
    // Only so the UI can decide whether to OFFER the resume button. The channel re-checks on its own.
    canResume: capability.can(principal, 'system.suspend-autonomy'),
  };
}

function register(ipcMain) {
  ipcMain.handle('autonomy:status', async (e) => {
    const principal = principalBinding.getPrincipal(e);
    if (!principal) return { ok: false, error: 'Sign in first' };
    return { ok: true, data: view(principal) };
  });

  ipcMain.handle('autonomy:stop', async (e, opts) => {
    const principal = principalBinding.getPrincipal(e);
    const o = opts && typeof opts === 'object' ? opts : {};
    const via = VIA.includes(o.via) ? o.via : 'unknown';
    const reason = clean(o.reason, MAX_REASON) || `stop requested from ${via}`;
    // `by` is main's account of the caller. Anything the payload says about identity is ignored.
    const res = stop.engage(reason, `${who(principal)} via ${via}`);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, alreadyHalted: res.alreadyHalted === true, data: view(principal) };
  });

  ipcMain.handle('autonomy:resume', async (e, opts) => {
    const principal = principalBinding.getPrincipal(e);
    if (!principal) return { ok: false, error: 'Sign in first' };
    const o = opts && typeof opts === 'object' ? opts : {};
    // `stop.resume` is the gate: it refuses anything without `system.suspend-autonomy`, a numeric tier,
    // and a note. It is handed the PRINCIPAL; whatever user the renderer put in `opts` is never read.
    const res = stop.resume(principal, clean(o.note, MAX_NOTE));
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true, haltCleared: res.haltCleared === true, restoredAllow: res.restoredAllow === true,
      // If RAMA_AUTONOMY=stop is set in the environment, resuming cannot override it, and saying "resumed"
      // while it is still in force would be a label that lies.
      stillHalted: res.stillHalted === true, env: res.env, data: view(principal),
    };
  });
}

module.exports = { register, view, MAX_REASON, MAX_NOTE, VIA };
