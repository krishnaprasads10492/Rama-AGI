import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FS, LH } from '@config/type.js';
import { useUserStore } from '@store/userStore.js';
import { bannerOf, EXPIRY_EVENT, EXPIRY_POLL_MS } from '@pages/GitSync/gitCredentialModel.js';

/**
 * TokenExpiryNotice - the GitHub token's expiry, announced (spec Section 158).
 *
 *   EXPIRING SOON   shown for the length the main process names (10 s) each login/start-up, then it goes; it can be
 *                   dismissed sooner
 *   EXPIRED / REFUSED / NOT CONFIRMED
 *                   stays up, with no dismiss and no timer, until GitHub has accepted a newer token
 *
 * The STATE is decided in the main process (lib/tokenExpiry.cjs) from facts kept in the encrypted app store, so it
 * can be announced at login while the vault is still locked. This component only asks, words it and obeys. It asks
 * again every 5 minutes (a token can expire mid-session) and at once when the token tab or the Keys tab changes it.
 * Shown to those who can act on it (vault.read: Master). It never receives, holds or shows a token.
 *
 * (`appStore.pushNotification` is not used: nothing renders that queue.)
 */
export default function TokenExpiryNotice() {
  const { canDo } = useUserStore();
  const allowed = canDo ? canDo('vault.read') : false;
  const navigate = useNavigate();
  const [notice, setNotice] = useState(null);
  const [expiringDone, setExpiringDone] = useState(false);
  const timer = useRef(null);
  const timed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await window.rama.gitAuth.expiry();
      if (res?.ok) setNotice(res.notice);
    } catch (err) {
      console.warn('[token-expiry] could not read the notice:', err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    if (!allowed || !window.rama?.gitAuth?.expiry) return undefined;
    refresh();
    const id = setInterval(refresh, EXPIRY_POLL_MS);
    window.addEventListener(EXPIRY_EVENT, refresh);
    return () => { clearInterval(id); window.removeEventListener(EXPIRY_EVENT, refresh); };
  }, [allowed, refresh]);

  const plan = bannerOf(notice);
  const expiring = !!plan && !plan.persistent;
  const hideAfter = plan ? plan.autoHideMs : 0;

  // The 10 seconds start the first time the warning is seen, and start again only if it went away and came back.
  useEffect(() => {
    if (!expiring) {
      timed.current = false;
      clearTimeout(timer.current);
      setExpiringDone(false);
      return;
    }
    if (timed.current) return;
    timed.current = true;
    timer.current = setTimeout(() => setExpiringDone(true), hideAfter);
  }, [expiring, hideAfter]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!allowed || !plan) return null;
  if (!plan.persistent && expiringDone) return null;

  const bad = plan.tone === 'bad';
  return (
    <div role={plan.persistent ? 'alert' : 'status'}
         style={{
           flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 14px',
           borderBottom: `1px solid ${bad ? 'var(--red)' : 'var(--amber)'}`,
           background: bad ? 'rgba(255,64,64,0.12)' : 'rgba(255,176,0,0.12)',
           fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--text)',
         }}>
      <span aria-hidden="true" style={{ color: bad ? 'var(--red)' : 'var(--amber)' }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{plan.title}.</strong> {plan.text}
      </div>
      <button type="button" className="btn btn-sm btn-primary"
              onClick={() => navigate('/models', { state: { tab: 'keys' } })}>UPDATE TOKEN</button>
      {!plan.persistent && (
        <button type="button" className="btn btn-sm" onClick={() => setExpiringDone(true)}>DISMISS</button>
      )}
    </div>
  );
}
