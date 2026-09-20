/**
 * ChartDrawingLayer — a lightweight-charts SERIES PRIMITIVE that renders master's drawings.
 *
 * Section 120's audit found the plugin surface entirely unused, and named it the root of most of the
 * chart's gaps. This is the first primitive Rāma has.
 *
 * WHY A SERIES PRIMITIVE AND NOT A PANE PRIMITIVE. A drawing is anchored in `(time, price)`, so rendering
 * it needs `series.priceToCoordinate` as well as `timeScale().timeToCoordinate`. A pane primitive gets the
 * chart but not a series, so it could place x and not y. The library's own guidance is the same: decorate
 * a series, attach to the series.
 *
 * THE MODEL IS NOT HERE. Every anchor, every hit test and the whole store live in `chartDrawings.js`,
 * pure and tested. This file only converts data coordinates to pixels and issues canvas calls — the part
 * that cannot be verified without a screen, kept as thin as it can be so there is little in it to be
 * wrong. If a drawing is in the wrong place, the arithmetic is in the tested module and the conversion is
 * here, and those are two different bugs to look for.
 */

import { fibLines, measurement, TOOLS } from './chartDrawings.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {() => object} getState `{drawings, draft, selectedId, intraday, theme, measure}`
 */
export function createDrawingLayer(getState) {
  let series = null;
  let chart = null;
  let requestUpdate = null;

  /** A stored point to pixels, or null when the chart cannot place it. */
  const project = (p) => {
    if (!series || !chart) return null;
    const y = series.priceToCoordinate(p.price);
    // `timeToCoordinate` returns null for a time outside the current data range, which is correct and
    // must be honoured — placing it at a clamped edge would draw a line to a bar that is not there.
    const x = chart.timeScale().timeToCoordinate(p.time);
    return (finite(x) && finite(y)) ? { x, y } : null;
  };

  const renderer = {
    draw(target) {
      const st = getState() || {};
      const list = (st.drawings || []).concat(st.draft ? [st.draft] : []);
      if (list.length === 0) return;
      const theme = st.theme || {};

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const rx = scope.horizontalPixelRatio;
        const ry = scope.verticalPixelRatio;
        const W = scope.bitmapSize.width;
        const H = scope.bitmapSize.height;

        ctx.save();
        // Master's marks are one colour and Rāma's are others, so his reasoning stays distinguishable
        // from the engine's at a glance (Section 121).
        const own = theme.magenta || '#c678dd';

        for (const d of list) {
          if (!d) continue;
          const pts = (d.points || []).map((p) => {
            const c = project({ time: st.intraday !== false ? p.time : p.time, price: p.price });
            return c ? { x: c.x * rx, y: c.y * ry } : null;
          });
          if (pts.some((p) => !p)) continue;

          const selected = d.id && d.id === st.selectedId;
          ctx.strokeStyle = d.color || own;
          ctx.fillStyle = d.color || own;
          ctx.lineWidth = Math.max(1, (d.width || 2) * (selected ? 1.8 : 1)) * ry;
          ctx.setLineDash(d.tool === 'ray' ? [] : []);
          ctx.globalAlpha = d.locked ? 0.55 : 1;

          if (d.tool === 'hline') {
            line(ctx, 0, pts[0].y, W, pts[0].y);
          } else if (d.tool === 'vline') {
            line(ctx, pts[0].x, 0, pts[0].x, H);
          } else if (d.tool === 'trendline') {
            line(ctx, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
          } else if (d.tool === 'ray') {
            const far = extend(pts[0], pts[1], Math.max(W, H) * 2);
            line(ctx, pts[0].x, pts[0].y, far.x, far.y);
          } else if (d.tool === 'rect') {
            const x = Math.min(pts[0].x, pts[1].x);
            const y = Math.min(pts[0].y, pts[1].y);
            const w = Math.abs(pts[1].x - pts[0].x);
            const h = Math.abs(pts[1].y - pts[0].y);
            ctx.globalAlpha *= 0.14;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = d.locked ? 0.55 : 1;
            ctx.strokeRect(x, y, w, h);
          } else if (d.tool === 'fib') {
            const lo = Math.min(pts[0].x, pts[1].x);
            const span = d.points[1].price - d.points[0].price;
            for (const l of fibLines(d)) {
              const yc = series.priceToCoordinate(d.points[0].price + span * l.level);
              if (!finite(yc)) continue;
              const y = yc * ry;
              ctx.globalAlpha = (d.locked ? 0.55 : 1) * (l.extension ? 0.55 : 1);
              ctx.setLineDash(l.level === 0 || l.level === 1 ? [] : [4 * rx, 4 * rx]);
              line(ctx, lo, y, W, y);
              ctx.setLineDash([]);
              label(ctx, `${l.label}  ${fmt(l.price)}`, lo + 4 * rx, y - 3 * ry, ry, theme);
            }
            ctx.globalAlpha = d.locked ? 0.55 : 1;
          } else if (d.tool === 'measure') {
            // The measure box draws its own reading, because a transient tool that needed a panel
            // elsewhere on the screen would make master look away from the thing he is measuring.
            const x = Math.min(pts[0].x, pts[1].x);
            const y = Math.min(pts[0].y, pts[1].y);
            const w = Math.abs(pts[1].x - pts[0].x);
            const h = Math.abs(pts[1].y - pts[0].y);
            const m = measurement(d.points[0], d.points[1], st.measureBars ?? null);
            ctx.strokeStyle = m.up ? (theme.green || '#26a69a') : (theme.red || '#ef5350');
            ctx.fillStyle = ctx.strokeStyle;
            ctx.globalAlpha = 0.16;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1;
            ctx.strokeRect(x, y, w, h);
            line(ctx, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
            label(ctx, m.text, x + 4 * rx, y - 4 * ry, ry, theme);
          } else if (d.tool === 'text') {
            dot(ctx, pts[0].x, pts[0].y, 3 * rx);
            label(ctx, d.text || '(empty note)', pts[0].x + 7 * rx, pts[0].y - 4 * ry, ry, theme);
          }

          // Handles on the selected drawing, so master can see what he has grabbed.
          if (selected) {
            for (const p of pts) dot(ctx, p.x, p.y, 4 * rx);
          }
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
        ctx.restore();
      });
    },
  };

  return {
    // ── The ISeriesPrimitive surface ───────────────────────────────────────────
    attached(param) {
      series = param.series;
      chart = param.chart;
      requestUpdate = param.requestUpdate;
    },
    detached() {
      series = null;
      chart = null;
      requestUpdate = null;
    },
    paneViews() {
      return [{ renderer: () => renderer, zOrder: () => 'top' }];
    },
    updateAllViews() { /* the renderer reads live state on every draw, so there is nothing to cache */ },

    // ── What `PriceChart` needs from it ───────────────────────────────────────
    /** Ask for a redraw after master changes something. */
    redraw() { try { requestUpdate?.(); } catch { /* not attached yet */ } },
    /** Pixel position of a stored point, for hit-testing in the component. */
    project,
    /**
     * A pointer position back into `(time, price)`.
     *
     * `coordinateToPrice` and `coordinateToTime` are the inverse the library provides; both return null
     * off the data, and that null is passed through rather than clamped — a drawing anchored to a bar
     * that does not exist is worse than one master could not place.
     */
    unproject(x, y) {
      if (!series || !chart) return null;
      const price = series.coordinateToPrice(y);
      const time = chart.timeScale().coordinateToTime(x);
      return (finite(price) && time !== null && time !== undefined) ? { time, price } : null;
    },
    /** Logical bar index at an x, so a measure can count BARS rather than divide elapsed time. */
    logicalAt(x) {
      try {
        const l = chart?.timeScale().coordinateToLogical(x);
        return finite(l) ? l : null;
      } catch { return null; }
    },
  };
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, r), 0, Math.PI * 2);
  ctx.fill();
}

/** Extend a ray from `a` through `b` by `len` pixels. */
function extend(a, b, len) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return b;
  return { x: a.x + (dx / d) * len, y: a.y + (dy / d) * len };
}

const fmt = (v) => (finite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '');

/** A label with a backing plate, because text straight onto candles is unreadable. */
function label(ctx, text, x, y, ry, theme) {
  if (!text) return;
  const size = Math.round(11 * ry);
  ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const w = ctx.measureText(text).width;
  const pad = 3 * ry;
  const prevFill = ctx.fillStyle;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = theme.bg && theme.bg !== 'transparent' ? theme.bg : '#0b0e14';
  ctx.fillRect(x - pad, y - size - pad, w + pad * 2, size + pad * 2);
  ctx.globalAlpha = prevAlpha;
  ctx.fillStyle = prevFill;
  ctx.fillText(text, x, y);
}

export { TOOLS };
