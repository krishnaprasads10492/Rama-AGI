import React, { useCallback, useEffect, useState } from 'react';
import PriceChart from './PriceChart.jsx';
import BookPanel from './BookPanel.jsx';
import WhyPanel from './WhyPanel.jsx';
import { saveSession } from '@services/authClient.js';
import { limitForDates } from './timeframes.js';

/**
 * PopoutPanel — one StockMind surface alone in its own OS window (Sections 97, 109).
 *
 * A popped-out window is a separate renderer with its own React tree and its own `sessionStorage`, so
 * it can see neither the opener's bars nor its login. It fetches its own data from the URL parameters,
 * and adopts the opener's session by redeeming a single-use ticket the main process minted.
 *
 * No polling. Master refreshes, or docks it back. A background poll per window would multiply engine
 * load by the number of windows for a benefit nobody asked for.
 */

const inElectron = typeof window !== 'undefined' && !!window.rama?.marketIntel;

export { readPopoutParams } from './popoutParams.js';

function Frame({ title, children, onRefresh, onDock, busy }) {
  return (
    <div className="hud-panel hud-panel-active" style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      borderRadius: 0, background: 'var(--bg)',
    }}>
      {/* Frameless window: this bar is also the drag region, which is what `-webkit-app-region` is for. */}
      <header className="hud-panel-bar" style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', height: 40,
        flexShrink: 0, WebkitAppRegion: 'drag',
      }}>
        <span aria-hidden="true" className="hud-panel-glyph">◈</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {/* Controls must opt out of the drag region or they cannot be clicked. */}
        <span style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 6 }}>
          {onRefresh && (
            <button type="button" className="hud-panel-btn" onClick={onRefresh}
                    disabled={busy} aria-label="Reload this panel's data">
              {busy ? '…' : '↺'}
            </button>
          )}
          {onDock && (
            <button type="button" className="hud-panel-btn" onClick={onDock}
                    aria-label="Send this panel back to the Rāma workspace"
                    title="Dock back into the workspace">⇤</button>
          )}
          <button type="button" className="hud-panel-btn hud-panel-btn-danger"
                  onClick={() => window.close()} aria-label="Close this window">✕</button>
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  );
}

export default function PopoutPanel({ params }) {
  const { panel, symbol, exchange, interval, range, grant } = params;

  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [bars, setBars] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const title = `${symbol} · ${String(panel || '').toUpperCase()}`;

  // Redeem once, on mount. The ticket is burned by the main process whatever the outcome, so a retry
  // loop here would only produce "already used".
  useEffect(() => {
    if (!inElectron || !window.rama?.popout?.redeem) return;
    if (!grant) { setAuthError('This window was opened without a session grant.'); return; }
    let live = true;
    (async () => {
      const res = await window.rama.popout.redeem({ grant });
      if (!live) return;
      if (res?.ok && res.user) {
        // Written to this window's own sessionStorage so every later call has a user, exactly as the
        // main window does after login.
        saveSession(null, res.user);
        setUser(res.user);
      } else {
        setAuthError(res?.error || 'The session grant could not be redeemed.');
      }
    })();
    return () => { live = false; };
  }, [grant]);

  const loadBars = useCallback(async () => {
    if (!inElectron || panel !== 'chart' || !user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.rama.marketIntel.ohlcv({
        user, symbol, exchange, interval, limit: limitForDates(interval, null, null),
      });
      if (res?.ok) setBars(Array.isArray(res.data?.bars) ? res.data.bars : []);
      else setError(res?.error || 'could not load bars');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [panel, symbol, exchange, interval, user]);

  useEffect(() => { loadBars(); }, [loadBars]);

  const dock = useCallback(() => {
    window.rama?.popout?.dock?.({ panel });
  }, [panel]);

  if (!inElectron) {
    return (
      <Frame title={title}>
        <span style={{ fontSize: 12, color: 'var(--amber)' }}>This window needs the desktop app.</span>
      </Frame>
    );
  }

  if (authError) {
    return (
      <Frame title={title} onDock={dock}>
        <div style={{ fontSize: 12.5, color: 'var(--amber)', lineHeight: 1.7 }}>{authError}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 8 }}>
          A pop-out adopts the main window&rsquo;s session through a one-time ticket that expires in
          30 seconds and cannot be reused. Close this window and pop the panel out again.
        </div>
      </Frame>
    );
  }

  if (!user) {
    return <Frame title={title}><span style={{ fontSize: 12, color: 'var(--muted)' }}>
      Adopting the workspace session…
    </span></Frame>;
  }

  if (panel === 'chart') {
    return (
      <Frame title={`${title} · ${interval}`} onRefresh={loadBars} onDock={dock} busy={busy}>
        {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>}
        <PriceChart bars={bars} symbol={symbol} interval={interval} rangeId={range}
                    chartId={`popout-${panel}`} busy={busy} onFetch={loadBars} height={420} />
      </Frame>
    );
  }

  // BookPanel and WhyPanel already load their own data from these props, which is the payoff for
  // having built them that way.
  if (panel === 'book') {
    return (
      <Frame title={title} onDock={dock}>
        <BookPanel currentUser={user} canConfig={false} symbol={symbol} exchange={exchange} />
      </Frame>
    );
  }
  if (panel === 'why') {
    return (
      <Frame title={title} onDock={dock}>
        <WhyPanel currentUser={user} symbol={symbol} exchange={exchange} thesis={null} />
      </Frame>
    );
  }

  return (
    <Frame title={title} onDock={dock}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
        &ldquo;{panel}&rdquo; has no standalone view — signals need the selection state of the main
        window, so it is only available there.
      </span>
    </Frame>
  );
}
