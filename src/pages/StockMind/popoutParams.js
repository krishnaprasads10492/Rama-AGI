/**
 * popoutParams.js — reading the pop-out query, with no other imports (spec Section 97).
 *
 * DELIBERATELY ITS OWN FILE. `App.jsx` must decide whether this window is a pop-out before it renders
 * anything, so that check has to be imported eagerly. When it lived in `PopoutPanel.jsx` the eager
 * import dragged `PriceChart` and `lightweight-charts` into the entry bundle: measured at 282 kB →
 * 499 kB on the main chunk while StockMind's own fell 234 kB → 29 kB, which is ~200 kB of charting
 * library loaded at startup for every account including those that never open StockMind.
 *
 * Splitting the cheap question away from the expensive answer keeps the panel lazily loaded.
 * This file must therefore stay import-free.
 */

/** Read the allowlisted parameters the main process put on the URL, or null when not a pop-out. */
export function readPopoutParams(search) {
  const raw = typeof search === 'string'
    ? search
    : (typeof window !== 'undefined' ? window.location.search : '');

  const q = new URLSearchParams(raw || '');
  const panel = q.get('panel');
  if (!panel) return null;

  // Defaults rather than nulls: a pop-out with a missing symbol should show something sensible
  // instead of rendering an empty frame while technically being "correct".
  return {
    panel,
    symbol: q.get('symbol') || 'NIFTY50',
    exchange: q.get('exchange') || 'NSE',
    interval: q.get('interval') || '1d',
  };
}
