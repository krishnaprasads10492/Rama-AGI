'use strict';

/**
 * badgeLabel.cjs — what the badge SAYS Rāma is doing, named after what is actually running.
 *
 * THE DEFECT THIS EXISTS TO FIX. `badgeWindow.setStatus` took three words — `live`, `paused`,
 * `closed` — and the badge showed them as colours with a fixed `Rāma AGI` tooltip. Master confirmed
 * the app SHOULD keep running windowless: `app.on('window-all-closed')` deliberately does not quit,
 * and `mainWindow.on('hide')` only hides. So in the `paused` state `refreshScheduler` is still firing
 * its daily tasks and `metaCognition`'s audit timer is still waking every ten minutes — while the one
 * indicator on screen reported that Rāma was paused.
 *
 * **The badge is the only thing master can see when the window is gone.** A label that says "paused"
 * over live background work is not a cosmetic inaccuracy; it is the single surface that decides
 * whether he believes Rāma is doing anything, and it was wrong in the state he would most want it
 * right. Nothing was paused. Nothing is paused now either — the label says so.
 *
 * WHY THE STATUS KEYS DID NOT CHANGE. `badge.html` keys its ring and core colours off
 * `body.status-live|paused|closed`, and `main.cjs` passes those three words from six call sites.
 * Renaming them would be a removal (I11) with a styling regression attached, and it would not fix
 * anything: the key is an internal colour selector, the LABEL is the claim. So the keys stay and the
 * claim is stated.
 *
 * WHY THE TIMER NAMES ARE A LIST AND NOT A SENTENCE. `scripts/verifyBadgeLabel.cjs` asserts that
 * every label enumerates these names AND that each one still corresponds to a real timer on disk —
 * `refreshScheduler.schedule()` calling `setTimer`, and `metaCognition`'s `auditTimer = setInterval`.
 * If a timer is deleted, the suite goes red rather than the badge going on claiming it. A label that
 * cannot be checked against the thing it describes is how this file's predecessor came to be wrong.
 *
 * NO ELECTRON HERE. This module is pure text so the suite can read it without a display server, the
 * same discipline `claimGate.cjs` keeps for the same reason.
 */

/**
 * The timers that keep running with no window open. Order is the order master reads them in.
 *
 * `refreshScheduler` — electron/lib/refreshScheduler.cjs; the registry main.cjs loads the daily
 * Ollama-library and dependency-review tasks into. Its handles are `unref`'d, which stops them
 * holding the event loop open; it does NOT stop them firing while Electron keeps the loop alive.
 *
 * `metaCognition audit timer` — electron/ipc/metaCognition.cjs; a 10-minute `setInterval` that runs
 * `selfAudit()` whenever outcomes have accumulated since the last pass.
 */
const LIVE_TIMERS = Object.freeze([
  'refreshScheduler',
  'metaCognition audit timer',
]);

/** The three keys main.cjs already passes. Exported so the suite names them rather than guessing. */
const STATUS = Object.freeze({
  LIVE:   'live',
  PAUSED: 'paused',
  CLOSED: 'closed',
});

/** What the window is doing. Deliberately separate from what RĀMA is doing. */
const WINDOW_STATE = Object.freeze({
  live:   'window open',
  paused: 'window hidden — nothing is paused',
  closed: 'windows closed — Rāma has not quit',
});

/**
 * One line, stating the window state and then every timer still running behind it.
 *
 * @param {string} status            'live' | 'paused' | 'closed'
 * @param {string[]} [timers]        names of what is running; defaults to LIVE_TIMERS
 * @returns {string}
 *
 * An unknown status is described as unknown rather than silently treated as `live`: a wrong-but-
 * confident label is exactly what this module replaced. An EMPTY timer list says nothing is running,
 * because a label listing timers that are not there would be the same defect pointed the other way.
 */
function statusLabel(status, timers = LIVE_TIMERS) {
  const where = WINDOW_STATE[status] || `unrecognised state "${String(status)}"`;
  const live = Array.isArray(timers) ? timers.filter(t => typeof t === 'string' && t.trim()) : [];
  const what = live.length
    ? `still running: ${live.join(', ')}`
    : 'no background timer is running';
  return `Rāma — ${where}. ${what}.`;
}

/** The payload the badge window receives. The status drives colour; the label is the claim. */
function statusPayload(status, timers = LIVE_TIMERS) {
  return { status, label: statusLabel(status, timers) };
}

module.exports = { statusLabel, statusPayload, LIVE_TIMERS, STATUS, WINDOW_STATE };
