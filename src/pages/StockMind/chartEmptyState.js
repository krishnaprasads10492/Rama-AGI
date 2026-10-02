
/**
 * chartEmptyState.js — what the chart says when it has no candles, and why it says that.
 *
 * THREE DEFECTS THIS MODULE EXISTS TO END. All three were live in the inline block that used to sit in
 * PriceChart.jsx's canvas overlay, and all three were invisible to every suite because the sentence was
 * composed inside JSX where nothing could call it.
 *
 *   1. A FALSE HEADLINE. "No 30m bars stored for NIFTY50 over 1Y." was printed whenever the canvas was
 *      empty — including when the store held 400 bars and master's dates simply did not overlap any of
 *      them. The route already sends the one true sentence for that case
 *      (`ai_backend/main.py`, the matched == 0 branch: "N 30m bars are stored, but none fall between X
 *      and Y. Widen the dates, or fetch more history."), it arrives as `res.data.note`, and the
 *      renderer talked over it. So `nothing-in-window` is a state of its own and its headline IS the
 *      route's note, verbatim, whenever one arrived.
 *   2. AN UNFOLLOWABLE REMEDY. That same false headline offered "⇩ Fetch & store them", which cannot
 *      move bars into a window the provider does not serve. The window is the thing that is wrong, so
 *      the action is to widen it.
 *   3. A GENERIC FAILURE OVER A NAMED CAUSE. When the engine is down, `ensureBackendRunning` has
 *      already produced a reason AND a remedy and the bridge returns them verbatim
 *      (`electron/ipc/marketIntel.cjs`), but only the StockMind chart tab read them — the workspace
 *      panel and the pop-out window showed "no bars stored", which blames the store for the engine.
 *      `failed` outranks every other state here, because a reply that never arrived says nothing about
 *      what is stored.
 *
 * PURE ON PURPOSE. No callbacks in, no JSX out: an action is an `id` the renderer binds to the handler
 * it already has. That is what makes the three sentences above assertable in
 * `scripts/verifyChartEmptyState.mjs` without a screen.
 */

// The extension is REQUIRED, not stylistic: `scripts/verifyChartEmptyState.mjs` imports this module
// under plain node, where ESM does no extension resolution. Vite is tolerant; node is not.
import { interval as intervalDef, describeLimit } from './timeframes.js';

/**
 * The failure sentence, and the guarantee that a remedy reaches the screen.
 *
 * The bridge composes `error` as "<reason>. <remedy>" so in the common case the remedy is already in
 * the headline and repeating it would be noise. But a route-level failure (the engine answered and the
 * request still failed) carries `error` alone, and a malformed gate object could carry `diagnosis`
 * alone — so both are read, and `remedy` is emitted only when the headline does not already contain it.
 */
function failureState(failure) {
  const diagnosis = failure.diagnosis || null;
  const reason = typeof diagnosis?.reason === 'string' ? diagnosis.reason.trim() : '';
  const remedy = typeof diagnosis?.remedy === 'string' ? diagnosis.remedy.trim() : '';
  const error = typeof failure.error === 'string' ? failure.error.trim() : '';

  // Never invent a cause. With neither an error string nor a diagnosis all that is honestly known is
  // that the request did not come back.
  const headline = error
    || (reason ? `${reason}${reason.endsWith('.') ? '' : '.'}${remedy ? ` ${remedy}` : ''}` : '')
    || 'Price history could not be loaded, and the reply carried no reason.';

  return {
    kind: 'failed',
    headline,
    composed: !error,
    remedy: remedy && !headline.includes(remedy) ? remedy : null,
    detail: typeof failure.detail === 'string' && failure.detail ? failure.detail : null,
    tail: Array.isArray(failure.stderrTail) ? failure.stderrTail.filter((l) => typeof l === 'string') : [],
    hint: null,
    action: { id: 'fetch', label: '↻ Try again' },
  };
}

/**
 * @param {object} input
 * @param {number} [input.bars] how many candles are actually on the canvas
 * @param {boolean} [input.busy] a fetch is in flight
 * @param {{error?: string, diagnosis?: {reason?: string, remedy?: string}, detail?: string,
 *          stderrTail?: string[]}|null} [input.failure] a failed reply, verbatim from the bridge
 * @param {string|null} [input.note] the route's own sentence about this reply (`res.data.note`)
 * @param {{first?: string, last?: string, stored?: number}|null} [input.coverage] what is on disk
 * @param {string} [input.interval]
 * @param {string} [input.symbol]
 * @param {string|null} [input.rangeId]
 * @returns {{kind: string, headline: string, composed: boolean, remedy: string|null,
 *            detail: string|null, hint: string|null, tail: string[],
 *            action: {id: string, label: string}|null}|null} null when there is nothing to say
 */
export function emptyState({
  bars = 0,
  busy = false,
  failure = null,
  note = null,
  coverage = null,
  interval = '1d',
  symbol = '',
  rangeId = null,
} = {}) {
  if (bars > 0) return null;          // candles on screen; the overlay must not cover them

  const label = intervalDef(interval)?.label || interval || 'price';
  const who = symbol || 'this symbol';
  const base = { composed: true, remedy: null, detail: null, hint: null, tail: [], action: null };

  // IN FLIGHT FIRST. The old empty state said "fetch price history first" while a fetch was running —
  // advice to do the thing already in flight.
  if (busy) {
    return { ...base, kind: 'fetching', headline: `Fetching ${label} bars for ${who}…` };
  }

  // A FAILED REPLY OUTRANKS ANY CLAIM ABOUT THE STORE. `coverage` on a failure is whatever the last
  // successful reply left behind, so reading it would describe a moment that has passed.
  if (failure) return failureState(failure);

  const stored = Number.isFinite(coverage?.stored) ? coverage.stored : 0;

  // BARS EXIST, THE WINDOW IS WRONG. The route's note names the counts and the dates, so it is truer
  // than anything composable here; it is used verbatim and only replaced when it did not arrive — and
  // the replacement states the fact without claiming a cause.
  if (stored > 0) {
    return {
      ...base,
      kind: 'nothing-in-window',
      headline: typeof note === 'string' && note.trim()
        ? note.trim()
        : `${stored} ${label} bars are stored for ${who}, but none fall inside the selected dates.`,
      composed: !(typeof note === 'string' && note.trim()),
      detail: coverage?.first ? `stored ${coverage.first} → ${coverage.last || 'now'}` : null,
      // NOT a fetch. Fetching cannot move bars into a window the provider does not serve, which is the
      // whole reason this state is separate from `nothing-yet`.
      action: { id: 'clear-dates', label: '✕ clear dates' },
    };
  }

  // NOTHING YET, and this headline is verified verbatim by the Section 107 no-regression assertion.
  return {
    ...base,
    kind: 'nothing-yet',
    headline: `No ${label} bars stored for ${who}${rangeId ? ` over ${rangeId}` : ''}.`,
    hint: describeLimit(interval),
    action: { id: 'fetch', label: '⇩ Fetch & store them' },
  };
}

export default emptyState;
