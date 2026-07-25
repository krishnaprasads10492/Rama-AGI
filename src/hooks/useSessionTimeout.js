/**
 * useSessionTimeout — auto-logout after 45 minutes of inactivity.
 * Ported from StockMind AI's implementation.
 *
 * Resets on: mousemove, keydown, mousedown, touchstart, scroll.
 * Warns 2 minutes before timeout via onWarn callback.
 * On timeout: clears session, navigates to unlock screen.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '@store/userStore.js';

const TIMEOUT_MS = 45 * 60 * 1000;  // 45 minutes
const WARN_MS    =  2 * 60 * 1000;  // warn 2 min before

export function useSessionTimeout(onWarn) {
  const { currentUser, clearSession } = useUserStore();
  const navigate   = useNavigate();
  const timerRef   = useRef(null);
  const warnRef    = useRef(null);

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    clearTimeout(warnRef.current);
    if (!currentUser) return;

    warnRef.current = setTimeout(() => {
      onWarn?.();
    }, TIMEOUT_MS - WARN_MS);

    timerRef.current = setTimeout(() => {
      clearSession();
      // Navigate to root — App.jsx will show Unlock screen
      navigate('/', { replace: true });
      window.location.reload();
    }, TIMEOUT_MS);
  }, [currentUser, clearSession, navigate, onWarn]);

  useEffect(() => {
    if (!currentUser) return;
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      clearTimeout(timerRef.current);
      clearTimeout(warnRef.current);
    };
  }, [currentUser, reset]);
}
