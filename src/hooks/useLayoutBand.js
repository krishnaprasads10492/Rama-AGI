/**
 * useLayoutBand — the width band of the window this renderer is in.
 *
 *     const band = useLayoutBand();              // read only
 *     const band = useLayoutBand({ own: true }); // ALSO writes data-band on <html>
 *
 * Returns 'compact' | 'regular' | 'wide'. The decision itself is src/config/layoutBands.js, which
 * imports nothing, and its exports are re-exported here so a consumer has one import.
 *
 * WHY `own` EXISTS. Writes of data-band are idempotent, but CLEANUPS ARE NOT. Titlebar.jsx calls
 * this hook too; if every caller removed the attribute on unmount, a Titlebar unmount would strip
 * data-band from <html> while App is still mounted, and :root[data-band="wide"] would silently stop
 * applying. So only an `own: true` caller writes, and the attribute is removed only when the
 * module-level owner count returns to 0 (spec 136.12 [F4]).
 */
import { useState, useRef, useEffect, useLayoutEffect } from 'react';

import { bandFor, BAND_REGULAR_MIN, BAND_WIDE_MIN, BAND_HYSTERESIS } from '@config/layoutBands.js';

export { bandFor, BAND_REGULAR_MIN, BAND_WIDE_MIN, BAND_HYSTERESIS };

/** How many mounted callers asked to own the attribute. The last one out removes it. */
let owners = 0;

/** ResizeObserver absence is warned about once, not once per mount. */
let warnedNoObserver = false;

const hasDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Width in CSS px — which is DIP ÷ zoom factor, the width the layout actually sees. */
const currentWidth = () => (hasDom() ? document.documentElement.clientWidth : 0);

export function useLayoutBand({ own = false } = {}) {
  // Resolved SYNCHRONOUSLY so the very first paint is already in the right band. With no window
  // (a non-DOM environment) this is 'regular', which is exactly today's behaviour.
  const [band, setBand] = useState(() => (hasDom() ? bandFor(currentWidth(), 'regular') : 'regular'));
  const prev = useRef(band);

  useEffect(() => {
    if (!hasDom()) return undefined;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = bandFor(currentWidth(), prev.current);
      if (next !== prev.current) {
        prev.current = next;
        setBand(next);
      }
    };
    // One frame per burst: a drag fires resize continuously and the band can only change once a
    // frame anyway.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();

    // The pattern already used in PanelBoard.jsx: observe if we can, fall back to the resize event
    // if the constructor is missing or throws. Either way the band keeps working.
    let observer = null;
    if (typeof ResizeObserver === 'function') {
      try {
        observer = new ResizeObserver(schedule);
        observer.observe(document.documentElement);
      } catch (err) {
        observer = null;
        if (!warnedNoObserver) {
          warnedNoObserver = true;
          console.warn('[layout] ResizeObserver unavailable, falling back to the resize event', err);
        }
      }
    } else if (!warnedNoObserver) {
      warnedNoObserver = true;
      console.warn('[layout] ResizeObserver unavailable, falling back to the resize event');
    }
    if (!observer) window.addEventListener('resize', schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', schedule);
    };
  }, []);

  // Ownership is registered once per mounted owner, NOT once per band change — otherwise every
  // resize would run the cleanup and the attribute would blink off and on.
  useLayoutEffect(() => {
    if (!own || !hasDom()) return undefined;
    owners += 1;
    return () => {
      owners -= 1;
      if (owners <= 0) {
        owners = 0;
        document.documentElement.removeAttribute('data-band');
      }
    };
  }, [own]);

  // useLayoutEffect, so data-band lands before paint rather than one frame into it.
  useLayoutEffect(() => {
    if (!own || !hasDom()) return;
    document.documentElement.setAttribute('data-band', band);
  }, [own, band]);

  return band;
}

export default useLayoutBand;
