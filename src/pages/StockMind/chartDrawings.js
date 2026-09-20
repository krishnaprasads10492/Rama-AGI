/**
 * chartDrawings.js — master's own marks on the chart: the model, the geometry, the persistence.
 *
 * Section 120's audit found ZERO drawing capability, and named it the largest remaining gap. This is the
 * half where correctness lives: the annotation model, the hit-testing arithmetic, the Fibonacci and
 * measure maths, and the store. `ChartDrawingLayer` renders it; `PriceChart` wires the pointer. Neither of
 * those can be verified without a screen, so everything that CAN be tested lives here and is.
 *
 * ── THE DECISION THAT MATTERS MOST: ANCHORS ARE ABSOLUTE EPOCH SECONDS ────────────────────────────
 *
 * A drawing is stored as `(time, price)` pairs, never as pixels. Pixel anchors are the classic mistake:
 * they survive nothing — not a zoom, not a pan, not a resize, not a window change.
 *
 * But `toChartTime` deliberately produces TWO types — a `'YYYY-MM-DD'` string for daily bars and UTC
 * epoch seconds for intraday (Section 118) — and that already caused two separate defects. A drawing
 * stored in the chart's own time type would be **unplaceable on any other interval**: a trendline drawn on
 * daily could never appear on 30m, which is exactly when master would want it.
 *
 * So the store speaks ONE time type, absolute epoch seconds, and converts at the boundary in both
 * directions. That is the third application of the same lesson in four sections, and this time it is a
 * design input rather than a bug report.
 *
 * ── AND THE ONE ABOUT INTENT ──────────────────────────────────────────────────────────────────────
 *
 * A drawing is master's OWN claim, not Rāma's. It is never generated, never adjusted, never "snapped to
 * a better level" on his behalf. Rāma's own marks — signal levels, the projection cone, fills — are drawn
 * by other code in other colours, and the two must stay visually distinct or master cannot tell his
 * reasoning from the engine's.
 */

// Tools, and what each is FOR. A palette of eleven that all look alike is its own defect, so this stays
// the set a trader actually reaches for.
export const TOOLS = Object.freeze({
  trendline: { id: 'trendline', label: 'Trend line', points: 2, key: 't',
    hint: 'Two points, segment only — where support or resistance has actually been tested' },
  ray: { id: 'ray', label: 'Ray', points: 2, key: 'y',
    hint: 'Two points, extended forward — the same line projected into the future' },
  hline: { id: 'hline', label: 'Horizontal', points: 1, key: 'h',
    hint: 'One price, across the whole chart — a level' },
  vline: { id: 'vline', label: 'Vertical', points: 1, key: 'i',
    hint: 'One time, top to bottom — an event' },
  rect: { id: 'rect', label: 'Rectangle', points: 2, key: 'e',
    hint: 'A zone rather than a line — a range, a consolidation, a gap' },
  fib: { id: 'fib', label: 'Fibonacci', points: 2, key: 'b',
    hint: 'Retracement levels between a swing low and high' },
  measure: { id: 'measure', label: 'Measure', points: 2, key: 'm', transient: true,
    hint: 'Drag to read the move in price, percent, bars and elapsed time. Not kept.' },
  text: { id: 'text', label: 'Note', points: 1, key: 'n',
    hint: 'A sentence at a point on the chart — why you did something' },
});

export const TOOL_IDS = Object.freeze(Object.keys(TOOLS));

/**
 * Fibonacci retracement levels, plus the two extensions worth having.
 *
 * 0.5 is not a Fibonacci ratio and is included anyway, because it is the level traders actually watch —
 * noted rather than quietly passed off as one.
 */
export const FIB_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618]);

/** Bounded, because this is persisted and master can hold the mouse down. */
export const MAX_PER_SYMBOL = 200;

const PREFIX = 'rama.stockmind.drawings';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ── Time: one type in the store, the chart's own type at the edge ─────────────

/**
 * A chart time as absolute epoch seconds.
 *
 * @param {string|number} t `'YYYY-MM-DD'` or epoch seconds
 * @returns {number|null} null when unusable — never 0, which is a real instant
 */
export function toEpoch(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  const s = String(t ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))) return null;
  const ms = Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Epoch seconds back into the type THIS chart uses.
 *
 * @param {number} epoch
 * @param {boolean} intraday whether the chart's own times are epoch numbers
 */
export function fromEpoch(epoch, intraday) {
  if (!finite(epoch)) return null;
  if (intraday) return Math.floor(epoch);
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

// ── The model ─────────────────────────────────────────────────────────────────

let seq = 0;
/** Ids are unique within a session and stable once persisted. */
function nextId() {
  seq += 1;
  return `d${Date.now().toString(36)}${seq.toString(36)}`;
}

/**
 * Build a drawing from points in chart coordinates.
 *
 * @param {string} tool
 * @param {Array<{time: string|number, price: number}>} points
 * @param {object} [extra] `{text, color, width}`
 * @returns {object|null} null when the tool or the points are unusable — never a partial drawing
 */
export function makeDrawing(tool, points, extra = {}) {
  const def = Object.prototype.hasOwnProperty.call(TOOLS, tool) ? TOOLS[tool] : null;
  if (!def) return null;
  const pts = (Array.isArray(points) ? points : [])
    .map((p) => {
      const t = toEpoch(p?.time);
      return (t === null || !finite(p?.price)) ? null : { t, price: p.price };
    })
    .filter(Boolean);
  if (pts.length < def.points) return null;
  return {
    id: nextId(),
    tool,
    points: pts.slice(0, def.points),
    text: typeof extra.text === 'string' ? extra.text.slice(0, 280) : null,
    color: typeof extra.color === 'string' ? extra.color : null,
    width: finite(extra.width) ? Math.max(1, Math.min(6, Math.round(extra.width))) : 2,
    locked: false,
    createdAt: new Date().toISOString(),
  };
}

/** A drawing with its anchors in this chart's own time type, ready to render. */
export function placed(drawing, intraday) {
  if (!drawing?.points?.length) return null;
  const points = drawing.points.map((p) => ({ time: fromEpoch(p.t, intraday), price: p.price }));
  if (points.some((p) => p.time === null)) return null;
  return { ...drawing, points };
}

// ── Geometry: the part that must be right ─────────────────────────────────────

/**
 * Shortest distance from a point to a SEGMENT — not to the infinite line.
 *
 * The infinite-line distance is the common shortcut and it makes a trendline selectable from far past
 * either end, so clicking empty space grabs a drawing that is not there.
 */
export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  // Clamped to [0,1], which is what makes it a segment rather than a line.
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Distance to a ray: the segment from the first point, extended past the second. */
export function distanceToRay(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  // Clamped below at 0 only — forward is unbounded, which is what a ray means.
  const t = Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lenSq);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Whether a point is on a rectangle's EDGE, within tolerance — a zone is selected by its border. */
export function nearRectEdge(px, py, x1, y1, x2, y2, tol) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const inX = px >= left - tol && px <= right + tol;
  const inY = py >= top - tol && py <= bottom + tol;
  if (!inX || !inY) return false;
  return Math.abs(px - left) <= tol || Math.abs(px - right) <= tol
    || Math.abs(py - top) <= tol || Math.abs(py - bottom) <= tol;
}

/**
 * Which drawing is under the pointer, if any.
 *
 * `project` converts a stored point to pixels and may return null when the anchor is off-screen or the
 * chart cannot place it. A drawing whose anchors cannot be projected is NOT selectable rather than
 * selectable at a guessed position.
 *
 * Searched newest-first, so the thing master just drew is the thing he grabs.
 *
 * @param {Array} drawings
 * @param {{x: number, y: number}} at pointer position in pixels
 * @param {(point: object) => ({x: number, y: number}|null)} project
 * @param {{tol?: number, width?: number, height?: number}} [opts]
 * @returns {object|null}
 */
export function hitTest(drawings, at, project, opts = {}) {
  const tol = finite(opts.tol) ? opts.tol : 6;
  // The pane width, so a Fibonacci set stays grabbable across its levels' full drawn extent. Optional:
  // without it the levels are only selectable between the two anchors.
  const w = finite(opts.width) ? opts.width : 0;
  if (!Array.isArray(drawings) || !at || typeof project !== 'function') return null;

  for (let i = drawings.length - 1; i >= 0; i -= 1) {
    const d = drawings[i];
    if (!d || d.locked) continue;
    const pts = (d.points || []).map(project);
    if (pts.some((p) => !p || !finite(p.x) || !finite(p.y))) continue;

    if (d.tool === 'hline') {
      if (Math.abs(at.y - pts[0].y) <= tol) return d;
    } else if (d.tool === 'vline') {
      if (Math.abs(at.x - pts[0].x) <= tol) return d;
    } else if (d.tool === 'text') {
      // A note is grabbed by its anchor, which is a point rather than a line.
      if (Math.hypot(at.x - pts[0].x, at.y - pts[0].y) <= tol * 2) return d;
    } else if (d.tool === 'rect') {
      if (nearRectEdge(at.x, at.y, pts[0].x, pts[0].y, pts[1].x, pts[1].y, tol)) return d;
    } else if (d.tool === 'ray') {
      if (distanceToRay(at.x, at.y, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= tol) return d;
    } else if (d.tool === 'fib') {
      // Any of its levels, each a horizontal line between the two anchors' x range.
      const lo = Math.min(pts[0].x, pts[1].x);
      const hi = Math.max(pts[0].x, pts[1].x);
      if (at.x < lo - tol || at.x > (w > 0 ? w : hi + tol)) continue;
      const near = fibLines(d).some((l) => {
        const y = pts[0].y + (pts[1].y - pts[0].y) * l.level;
        return Math.abs(at.y - y) <= tol;
      });
      if (near) return d;
    } else if (distanceToSegment(at.x, at.y, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= tol) {
      return d;
    }
  }
  return null;
}

/**
 * The Fibonacci levels of one drawing, as ratios and prices.
 *
 * Level 0 is the FIRST anchor and level 1 the second, so dragging low-to-high and high-to-low give
 * retracements measured from the right end. Reversing them silently would make the tool disagree with
 * every other platform.
 */
export function fibLines(drawing) {
  const [a, b] = drawing?.points || [];
  if (!a || !b) return [];
  const span = b.price - a.price;
  return FIB_LEVELS.map((level) => ({
    level,
    price: a.price + span * level,
    label: `${(level * 100).toFixed(1).replace(/\.0$/, '')}%`,
    extension: level > 1,
  }));
}

/**
 * What a measure drag actually says.
 *
 * `bars` needs the chart's own logical positions, so it is passed in rather than guessed from the elapsed
 * time — on an intraday series, wall-clock elapsed spans overnight gaps in which no bars exist, and
 * dividing elapsed time by the interval would count hours the market was shut.
 *
 * @returns {{price: number, pct: number|null, bars: number|null, ms: number, up: boolean, text: string}}
 */
export function measurement(from, to, bars = null) {
  const price = to.price - from.price;
  const pct = from.price !== 0 ? (price / Math.abs(from.price)) * 100 : null;
  const ms = (to.t - from.t) * 1000;
  const up = price >= 0;
  const parts = [
    `${up ? '+' : ''}${price.toFixed(2)}`,
    pct === null ? null : `${up ? '+' : ''}${pct.toFixed(2)}%`,
    finite(bars) ? `${Math.abs(Math.round(bars))} bars` : null,
    ms === 0 ? null : humanSpan(Math.abs(ms)),
  ].filter(Boolean);
  return { price, pct, bars: finite(bars) ? bars : null, ms, up, text: parts.join('  ·  ') };
}

function humanSpan(ms) {
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)}m`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(hr < 10 ? 1 : 0)}h`;
  const day = hr / 24;
  if (day < 31) return `${day.toFixed(day < 10 ? 1 : 0)}d`;
  const mo = day / 30.44;
  if (mo < 12) return `${mo.toFixed(1)}mo`;
  return `${(day / 365.25).toFixed(1)}y`;
}

// ── Persistence: per symbol, and portable across intervals ────────────────────

const keyFor = (symbol) => `${PREFIX}.${String(symbol || '').toUpperCase() || 'UNKNOWN'}`;

/**
 * Master's drawings for one symbol.
 *
 * PER SYMBOL, NOT PER INTERVAL — a level that mattered on the daily matters on the 30m, and storing
 * per interval would hide his own work from him whenever he changed timeframe. Absolute epoch anchors are
 * what make that possible.
 */
export function load(symbol) {
  try {
    const raw = window.localStorage?.getItem(keyFor(symbol));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    // Validated on read, not trusted: a hand-edited or half-written store must not throw inside a render.
    return parsed.filter((d) => d && TOOLS[d.tool] && Array.isArray(d.points)
      && d.points.length >= TOOLS[d.tool].points
      && d.points.every((p) => finite(p?.t) && finite(p?.price)))
      .slice(-MAX_PER_SYMBOL);
  } catch {
    return [];
  }
}

export function save(symbol, drawings) {
  try {
    const keep = (Array.isArray(drawings) ? drawings : [])
      .filter((d) => d && !TOOLS[d.tool]?.transient)
      .slice(-MAX_PER_SYMBOL);
    window.localStorage?.setItem(keyFor(symbol), JSON.stringify(keep));
    return keep.length;
  } catch {
    // Quota or private mode. The drawings still work for this session; only persistence is lost.
    return -1;
  }
}

/** Add one, respecting the cap by dropping the OLDEST — never the one just drawn. */
export function add(drawings, drawing) {
  if (!drawing) return Array.isArray(drawings) ? drawings : [];
  const next = (Array.isArray(drawings) ? drawings : []).concat(drawing);
  return next.length > MAX_PER_SYMBOL ? next.slice(next.length - MAX_PER_SYMBOL) : next;
}

export function remove(drawings, id) {
  return (Array.isArray(drawings) ? drawings : []).filter((d) => d?.id !== id);
}

export function toggleLock(drawings, id) {
  return (Array.isArray(drawings) ? drawings : [])
    .map((d) => (d?.id === id ? { ...d, locked: !d.locked } : d));
}

/** Remove the most recent unlocked drawing — a locked one is master saying "not this". */
export function undo(drawings) {
  const list = Array.isArray(drawings) ? drawings : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!list[i]?.locked) return list.filter((_, j) => j !== i);
  }
  return list;
}

/** Clear the unlocked ones. Locked drawings survive a clear, which is what locking is for. */
export function clear(drawings) {
  return (Array.isArray(drawings) ? drawings : []).filter((d) => d?.locked);
}

/** A one-line description, for the list and for a screen reader. */
export function describe(drawing, intraday) {
  const def = TOOLS[drawing?.tool];
  if (!def) return 'unknown drawing';
  const at = (p) => `${fromEpoch(p.t, intraday)} @ ${p.price.toLocaleString(undefined,
    { maximumFractionDigits: 2 })}`;
  if (drawing.tool === 'text') return `Note "${drawing.text || ''}" at ${at(drawing.points[0])}`;
  if (def.points === 1) return `${def.label} at ${at(drawing.points[0])}`;
  return `${def.label} from ${at(drawing.points[0])} to ${at(drawing.points[1])}`;
}
