/**
 * chartZoom.js — how wide a candle is on open. Third attempt, and the first one with a feedback loop.
 *
 * ── WHY TWO ATTEMPTS FAILED ────────────────────────────────────────────────────────────────────────
 *
 * Section 110 asked for 8px and showed about 5. Section 119 diagnosed that as a width-derived bar count
 * against an unsettled `clientWidth`, switched to `barSpacing` — the library's own unit — and master
 * reported it still wrong. So the number was never the problem. Three separate faults were:
 *
 * 1. **NO CEILING.** The old plan had a floor and a "short series fills the pane" rule that called
 *    `fitContent()`. With a sparse store — and StockMind's engine has never completed a run on master's
 *    machine, so a 30m series can be a few dozen bars — 20 bars in a 900px pane became **45px per
 *    candle**. Enormous. Three sections were spent assuming the candles were too NARROW while the rule
 *    as written could just as easily make them far too wide.
 *
 * 2. **APPLIED IN THE SAME TICK AS `setData`, WITH NO READ-BACK.** `setData` moves the visible range
 *    itself, and the library's own maintainers describe the correct pattern as *change the time scale,
 *    wait for it to take effect, then read it back*. Both previous attempts set the scale synchronously
 *    and assumed it held. Neither ever checked.
 *
 * 3. **THE FALLBACK UNDID THE FIX.** `catch { ts.fitContent(); }` — so any throw from the scroll call
 *    silently restored precisely the squeeze-everything-in behaviour being replaced, with no trace.
 *
 * ── WHAT IS DIFFERENT NOW ──────────────────────────────────────────────────────────────────────────
 *
 * - **One rule, clamped both ways.** Always set `barSpacing`, never `fitContent`. A short series leaves
 *   blank space, which is what every trading platform does and is not a defect.
 * - **A CLOSED LOOP.** `pxPerBar()` derives the ACTUAL candle width from the visible logical range and
 *   the pane width, both public API. The component applies, waits a frame, reads back, and corrects once
 *   if it did not take. Verified rather than assumed.
 * - **OBSERVABLE.** The measured width is reported so the header can show it. Three sections were spent
 *   guessing because nothing on screen ever said what the zoom actually was — that was the real defect.
 * - **MASTER'S CHOICE.** A density he sets and Rāma remembers, so "not as expected" becomes a setting
 *   rather than a number I keep guessing at.
 */

/**
 * Candle widths worth offering, in pixels between centres.
 *
 * Named by what master would want rather than by number: nobody thinks "I would like 16 pixels", they
 * think "I want to see the candles" or "I want to see the year".
 */
export const DENSITIES = Object.freeze([
  { id: 'comfortable', label: 'Comfortable', px: 18,
    hint: 'Big candles, a few weeks on screen — for reading the bars themselves' },
  { id: 'standard', label: 'Standard', px: 12,
    hint: 'About where TradingView opens. Readable bodies, a few months of daily' },
  { id: 'compact', label: 'Compact', px: 7,
    hint: 'More history at the cost of body detail' },
  { id: 'dense', label: 'Dense', px: 3,
    hint: 'Shape only — bodies are not readable at this width' },
]);

export const DEFAULT_DENSITY = 'standard';

/** Hard limits. Outside these a candle is either a smear or a billboard. */
export const MIN_BAR_PX = 1;
export const MAX_BAR_PX = 40;

/** How far the measured width may drift from the target before it is worth correcting. */
export const CORRECTION_TOLERANCE = 0.12;

export const densityById = (id) => DENSITIES.find((d) => d.id === id) || null;

export const pxForDensity = (id) => (densityById(id) || densityById(DEFAULT_DENSITY)).px;

/**
 * Clamp any requested width into something drawable.
 *
 * ABSENT IS NOT ZERO, and that distinction is Section 112's lesson applied here: `Number(null)` is 0,
 * so a missing width would clamp to the 1px floor — a smear — rather than falling back to the default.
 * An unknown target means "use the default", never "use the narrowest legal value".
 */
export function clampPxPerBar(px) {
  if (px === null || px === undefined || px === '') return pxForDensity(DEFAULT_DENSITY);
  const v = Number(px);
  if (!Number.isFinite(v)) return pxForDensity(DEFAULT_DENSITY);
  return Math.max(MIN_BAR_PX, Math.min(MAX_BAR_PX, v));
}

/**
 * What the default zoom should do.
 *
 * ALWAYS `spacing`. There is no `fit` branch any more, and its absence is the fix: `fitContent()` on a
 * short series is what produced 45px candles, and `fit all` remains available for the times master
 * genuinely wants the whole series squeezed in.
 *
 * @param {number} count bars loaded
 * @param {number} [pxPerBar] the wanted candle width; omitted means the default density
 * @returns {{mode: 'none'|'spacing', barSpacing: number|null, reason: string}}
 */
export function zoomPlan(count, pxPerBar) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) {
    return { mode: 'none', barSpacing: null, reason: 'no bars to zoom to' };
  }
  const px = clampPxPerBar(pxPerBar ?? pxForDensity(DEFAULT_DENSITY));
  return {
    mode: 'spacing',
    barSpacing: px,
    reason: `${px}px per candle on the newest bars`
      + (n * px < 400 ? ' — a short series leaves the rest of the pane empty, which is correct'
        : ' — the rest is scrolling'),
  };
}

/**
 * The ACTUAL candle width on screen, from the visible logical range and the pane width.
 *
 * Both inputs are public API (`getVisibleLogicalRange()` and the container's width), so this is a real
 * measurement rather than a restatement of what was requested — which is the whole point. There is no
 * `getBarSpacing()` in the library; people fork it to add one. This derives it instead.
 *
 * @param {{from: number, to: number}|null} range
 * @param {number} width pane width in px
 * @returns {number|null} null when it cannot be measured, never a guess
 */
export function pxPerBar(range, width) {
  const w = Number(width);
  if (!range || !Number.isFinite(w) || w <= 0) return null;
  const span = Number(range.to) - Number(range.from);
  if (!Number.isFinite(span) || span <= 0) return null;
  return w / span;
}

/**
 * Did the zoom actually take?
 *
 * Checked because assuming it did is what made Sections 110 and 119 both wrong.
 *
 * @returns {{ok: boolean, actual: number|null, target: number, drift: number|null, why: string}}
 */
export function verifyZoom(range, width, target) {
  const t = clampPxPerBar(target);
  const actual = pxPerBar(range, width);
  if (actual === null) {
    return { ok: false, actual: null, target: t, drift: null,
      why: 'the visible range could not be read, so the zoom is unverified' };
  }
  const drift = Math.abs(actual - t) / t;
  return {
    ok: drift <= CORRECTION_TOLERANCE,
    actual,
    target: t,
    drift,
    why: drift <= CORRECTION_TOLERANCE
      ? `${actual.toFixed(1)}px per candle, within tolerance of ${t}`
      : `${actual.toFixed(1)}px per candle against a target of ${t} — off by `
        + `${Math.round(drift * 100)}%, so it did not take`,
  };
}

/** Bars of empty space kept to the right of the newest candle, so it is not flush against the axis. */
export const RIGHT_HEADROOM_BARS = 2;

/**
 * The logical range that puts `target` pixels per candle on the newest bars.
 *
 * The correction of last resort: when `barSpacing` did not hold, setting the range explicitly does. It
 * needs a settled width, which by correction time it has — that is the difference from Section 110,
 * where the same arithmetic ran against a width that had not settled yet.
 *
 * THE SPAN IS ALWAYS THE FULL PANE, EVEN WITH FEWER BARS THAN THAT — so `from` goes NEGATIVE on a short
 * series, and it must. Clamping it to 0 was the first version of this function and it walked straight
 * back into the defect being fixed: 20 bars pinned into a 900px pane is 41px per candle, which is the
 * same stretch `fitContent()` was producing. Logical coordinates are allowed to sit left of the first
 * bar, and empty space there is how "a short series does not fill the pane" is expressed.
 */
export function rangeForPxPerBar(count, width, target) {
  const n = Number(count);
  const w = Number(width);
  const t = clampPxPerBar(target);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 0) return null;
  const span = Math.max(2, Math.floor(w / t));
  const to = n + RIGHT_HEADROOM_BARS;
  return { from: to - span, to };
}

/** How many bars a width shows at a given candle width — for describing the zoom, never for setting it. */
export function visibleBars(width, pxPerBarValue) {
  const w = Number(width);
  const px = Number(pxPerBarValue);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(px) || px <= 0) return null;
  return Math.max(1, Math.round(w / px));
}

/** One line for the header, so the zoom is never again something nobody can see. */
export function describeZoom(measured, count, width) {
  const actual = Number(measured);
  if (!Number.isFinite(actual) || actual <= 0) return null;
  const shown = visibleBars(width, actual);
  const n = Number(count);
  const of = Number.isFinite(n) && n > 0 ? ` of ${n.toLocaleString()}` : '';
  return `${actual.toFixed(actual < 10 ? 1 : 0)}px/bar · ${shown?.toLocaleString() ?? '—'}${of} bars`;
}
