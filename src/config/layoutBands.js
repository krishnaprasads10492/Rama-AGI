/**
 * layoutBands.js — the window-width bands, as a pure function with no React in it.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE HOOK. scripts/verifyTypeScale.mjs drives every edge,
 * jump and non-finite input of `bandFor`, and a suite cannot import a module that imports React.
 * So the constants and the decision live here, importing nothing, and src/hooks/useLayoutBand.js
 * re-exports them so a consumer still has one import (spec 136.12 [F7]).
 *
 * WHERE THE EDGES COME FROM, honestly (spec 136.5):
 *   - compact < 900 is DERIVED: the titlebar's post-migration hard minimum is ≈885px — the sum of
 *     its non-wrapping content — rounded up to 900. Below it the three space-between zones overlap.
 *   - wide >= 1600 is a PROVISIONAL POLICY THRESHOLD borrowed from appearanceState's REF_WIDTH,
 *     NOT a measured layout break: no layout fails above 1599. It is the width the pixel values
 *     were authored against. Confirming or replacing it is still open on ledger row 156.
 *
 * The band reads CSS px, which is DIP ÷ zoom factor. The main window's floor is 900 DIP
 * (electron/main.cjs), so at zoom 1.0 the main window never enters `compact`; a pop-out at 420 DIP
 * always is. That reachability is recorded in spec 136.12 [F3] and is master's call, not this
 * layer's.
 */

/**
 * EXCLUSIVE — the rule is `width < 900`, so 900 itself is `regular`. Named for the band it STARTS.
 * There is no off-by-one here; a later reader must not "fix" one.
 */
export const BAND_REGULAR_MIN = 900;

/** Lower edge of `wide`, inclusive: 1600 and above is wide. */
export const BAND_WIDE_MIN = 1600;

/**
 * Hysteresis, in px. A window dragged across an edge must not flicker, so an already-resolved band
 * is held for 24px past its edge: `compact` holds to 924 and leaves at 925, `wide` holds down to
 * 1576 and leaves at 1575.
 */
export const BAND_HYSTERESIS = 24;

/**
 * bandFor — pure and total. Returns 'compact' | 'regular' | 'wide'.
 *
 * THE STICKY BRANCHES HOLD ONLY; THEY NEVER RESOLVE A BAND. Each one can answer "keep what you
 * had", and then control FALLS THROUGH to the plain thresholds, so a jump re-resolves correctly:
 * bandFor(500, 'wide') === 'compact' and bandFor(1700, 'compact') === 'wide'. An earlier version
 * returned from inside the branches, which answered 'regular' for a 500px window that had been
 * wide — the overlapping titlebar the band exists to prevent — on exactly the jump a monitor
 * change or an un-maximise produces.
 *
 * A width that is not a usable number (NaN, Infinity, 0, negative) returns `prev` unchanged, which
 * is the honest answer when the DOM has not reported a width yet. It is never undefined.
 */
export function bandFor(width, prev = 'regular') {
  if (!Number.isFinite(width) || width <= 0) return prev;

  const h = BAND_HYSTERESIS;

  // Hold only — no `return` of a NEW band from either branch.
  if (prev === 'compact' && width <= BAND_REGULAR_MIN + h) return 'compact';
  if (prev === 'wide' && width >= BAND_WIDE_MIN - h) return 'wide';

  if (width < BAND_REGULAR_MIN) return 'compact';
  if (width >= BAND_WIDE_MIN) return 'wide';
  return 'regular';
}
