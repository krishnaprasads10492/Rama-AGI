/**
 * ChartSessionLayer — a lightweight-charts SERIES PRIMITIVE that shades alternate trading sessions.
 *
 * THE SECOND PRIMITIVE RĀMA HAS, and deliberately shaped like the first. `ChartDrawingLayer.js` is the
 * pattern: `attached` / `detached` / `paneViews` / `updateAllViews`, live state read on every draw, and
 * nothing cached that a render could leave stale.
 *
 * `zOrder: () => 'bottom'` IS THE WHOLE PLACEMENT DECISION. A band is context, not content: it must sit
 * under the candles, under the volume histogram and under every one of master's own marks. A tint drawn
 * over a wick would be a rendering layer arguing with the data it is supposed to be framing.
 *
 * THE MODEL IS NOT HERE. Which days exist, where each one starts and — the part that is the correctness
 * of the feature — where each one ENDS all come from `chartSessions.js`, pure and tested. This file
 * converts two stored timestamps into two x coordinates and fills the space between them. If a band is
 * in the wrong place, the arithmetic is in the tested module and the conversion is here, and those are
 * two different bugs to look for, never both at once.
 *
 * WHY A SERIES PRIMITIVE AND NOT A PANE PRIMITIVE, as with the drawing layer: a pane primitive gets the
 * chart but not a series, and attaching to the price series is what keeps the bands in the pane the
 * bars are in rather than painting across the volume pane as well.
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {() => object} getState `{bands, theme}` — `bands` from `sessionBands`, already filtered by
 *   master's toggle, so an empty array is the only thing "switched off" has to mean here.
 */
export function createSessionLayer(getState) {
  // THE SERIES ITSELF IS NOT KEPT, and that is a property worth naming: a band is an x-only object that
  // spans the full height of the pane, so this layer needs the time scale and never the price scale.
  // It therefore cannot be wrong about a price — there is no price conversion in it to be wrong.
  let chart = null;
  let requestUpdate = null;

  /**
   * A stored timestamp to an x coordinate, or null when the chart cannot place it.
   *
   * `timeToCoordinate` returns null for a time outside the current data range. That null is honoured
   * rather than clamped to an edge: a band drawn to the edge of the plot would claim the session runs
   * to there, which is the same lie as painting an unloaded afternoon.
   */
  const xOf = (t) => {
    if (!chart) return null;
    const x = chart.timeScale().timeToCoordinate(t);
    return finite(x) ? x : null;
  };

  const renderer = {
    draw(target) {
      const st = getState() || {};
      const bands = st.bands || [];
      if (bands.length === 0) return;
      const theme = st.theme || {};

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const rx = scope.horizontalPixelRatio;
        const W = scope.bitmapSize.width;
        const H = scope.bitmapSize.height;

        ctx.save();
        // The neutral text colour at a few percent, not an accent and not a signal colour. A band is
        // the only thing on this chart that means nothing in particular, so it must not borrow a
        // colour that does — green, red, the accent and master's magenta are all already claims.
        ctx.fillStyle = theme.muted || '#787b86';
        ctx.globalAlpha = 0.06;

        for (const b of bands) {
          // ALTERNATING, SO THE BOUNDARY IS THE INFORMATION. Tinting every session would draw one
          // continuous wash and say nothing about where a day ends.
          if (!b || !Number.isInteger(b.index) || b.index % 2 !== 0) continue;
          const x1 = xOf(b.from);
          const x2 = xOf(b.to);
          if (x1 === null || x2 === null) continue;
          const left = Math.max(0, Math.min(x1, x2) * rx);
          const right = Math.min(W, Math.max(x1, x2) * rx);
          // Under a device pixel wide after a pan or a hard zoom-out, a band is a stripe master would
          // read as an artefact. The model already omits a session with nothing to span; this is the
          // same refusal in pixel space, where only the chart knows the width.
          if (right - left < 1) continue;
          ctx.fillRect(left, 0, right - left, H);
        }
        ctx.restore();
      });
    },
  };

  return {
    // ── The ISeriesPrimitive surface ───────────────────────────────────────────
    attached(param) {
      chart = param.chart;
      requestUpdate = param.requestUpdate;
    },
    detached() {
      chart = null;
      requestUpdate = null;
    },
    paneViews() {
      return [{ renderer: () => renderer, zOrder: () => 'bottom' }];
    },
    updateAllViews() { /* the renderer reads live state on every draw, so there is nothing to cache */ },

    // ── What `PriceChart` needs from it ───────────────────────────────────────
    /** Ask for a redraw after the bands or the toggle change. */
    redraw() { try { requestUpdate?.(); } catch { /* not attached yet */ } },
  };
}
