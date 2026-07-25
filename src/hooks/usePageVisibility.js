/**
 * usePageVisibility — tracks whether the browser tab is visible.
 * Ported from StockMind AI's implementation.
 *
 * Returns true when tab is active, false when hidden.
 * All polling hooks use this to pause when tab is hidden —
 * conserves API quota and CPU.
 */
import { useState, useEffect } from 'react';

export function usePageVisibility() {
  const [visible, setVisible] = useState(
    typeof document !== 'undefined'
      ? document.visibilityState === 'visible'
      : true
  );

  useEffect(() => {
    function handler() {
      setVisible(document.visibilityState === 'visible');
    }
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
}

/**
 * useVisibilityInterval — like setInterval but pauses when tab is hidden.
 * When tab becomes visible, fires immediately to catch up, then resumes normal interval.
 */
export function useVisibilityInterval(callback, intervalMs, enabled = true) {
  const visible = usePageVisibility();

  useEffect(() => {
    if (!enabled) return;
    if (visible) callback();  // catch up immediately on tab focus
    if (!visible) return;
    const t = setInterval(callback, intervalMs);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, enabled, intervalMs]);
}
