/**
 * chartZoom.js — how wide a candle should be on open, decided in one place (Section 119).
 *
 * WHY THIS IS A MODULE AND NOT A FEW LINES IN THE EFFECT. Section 110 set out to show candles at 8px
 * and did not, and the reason was a width that had not settled:
 *
 *   - `createChart` is called with no width and `autoSize: false`, so the chart takes the container's
 *     width at creation and a `ResizeObserver` corrects it afterwards.
 *   - The old default zoom derived a BAR COUNT from `holder.clientWidth || 900` and called
 *     `setVisibleLogicalRange`, while the chart's own initial width fell back to `|| 600`. **Two
 *     different fallbacks for the same unknown**, so the count asked for and the pane it landed in
 *     disagreed by half again, and the configured 8px was displayed as roughly 5.
 *   - `lightweight-charts` preserves `barSpacing` across a resize, NOT the logical range — so the drift
 *     survived the ResizeObserver rather than being corrected by it.
 *
 * So the decision is expressed in the library's own unit, `barSpacing` — pixels between candle centres —
 * which states the intent exactly and cannot be knocked out of shape by resize timing. The width is
 * consulted only for the coarse question of whether the series already fits, where being a little wrong
 * changes nothing. `scripts/verifyChartTime.mjs` tests this; the component only applies the result.
 */

/**
 * Pixels between candle centres at the default zoom.
 *
 * 12, up from Section 110's 8. At 8 the body is about 5px and master said it still was not readable; 12
 * leaves roughly an 8px body with a 4px gap, which is where TradingView sits. The cost is context — a
 * 900px pane shows about 69 bars instead of 112 — and that is the right trade, because `fit all` is one
 * click away and a smear is not readable at any width.
 */
export const TARGET_BAR_PX = 12;

/**
 * Show a short series whole rather than pinned to one edge, up to this share of the pane.
 *
 * Thirty fat candles against 900px of blank is not "seeing candles properly" either.
 */
export const SHORT_SERIES_FILL_RATIO = 0.9;

/**
 * What the default zoom should do for this series in this pane.
 *
 * @param {number} count how many bars are loaded
 * @param {number} [width] the pane's width in px; 0 or absent means not yet known
 * @returns {{mode: 'none'|'fit'|'spacing', barSpacing: number|null, reason: string}}
 *   `fit` means show everything; `spacing` means set `barSpacing` and scroll to the newest bars.
 */
export function zoomPlan(count, width) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) {
    return { mode: 'none', barSpacing: null, reason: 'no bars to zoom to' };
  }
  const w = Number.isFinite(Number(width)) ? Number(width) : 0;

  // A series that already fits comfortably is better shown whole. Only this branch needs the width, and
  // getting it wrong costs a slightly different spacing rather than an unreadable chart.
  if (w > 0 && n * TARGET_BAR_PX < w * SHORT_SERIES_FILL_RATIO) {
    return {
      mode: 'fit',
      barSpacing: null,
      reason: `${n} bars at ${TARGET_BAR_PX}px fit inside ${Math.round(w)}px, so show them all`,
    };
  }
  return {
    mode: 'spacing',
    barSpacing: TARGET_BAR_PX,
    reason: `${TARGET_BAR_PX}px per candle on the newest bars; the rest is scrolling`,
  };
}

/**
 * How many bars a plan puts on screen — for describing the zoom, never for setting it.
 *
 * Setting the zoom from a bar count is exactly the mistake this module exists to correct.
 */
export function visibleBars(plan, width) {
  const w = Number(width);
  if (!plan || plan.mode === 'none' || !Number.isFinite(w) || w <= 0) return null;
  if (plan.mode === 'fit') return null;          // everything, so the count is the series length
  return Math.max(1, Math.floor(w / plan.barSpacing));
}
