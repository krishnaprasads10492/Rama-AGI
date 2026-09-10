import React, { useCallback, useEffect, useState } from 'react';
import PriceChart from './PriceChart.jsx';
import BookPanel from './BookPanel.jsx';
import WhyPanel from './WhyPanel.jsx';

/**
 * PopoutPanel — one StockMind surface, alone in its own OS window (spec Section 97).
 *
 * THE THING THAT MAKES THIS NON-TRIVIAL. A popped-out window is a separate renderer process with its
 * own React tree, so it shares no state with the main window: it cannot see bars that were loaded
 * there. A naive pop-out therefore opens an empty panel and looks broken.
 *
 * So this loads its own data from the few parameters the main process passed in the URL. That also
 * means a popped-out chart keeps working if the main window is closed or navigated away, which is the
 * behaviour master would expect from a real window on a second monitor.
 *
 * There is no polling. Master presses refresh, or reopens. A background poll in every popped-out
 * window would multiply engine load by the number of windows for a benefit nobody asked for.
 */

const inElectron = typeof window !== 'undefined' && !!window.rama?.marketIntel;

// `readPopoutParams` lives in its own import-free module so `App.jsx` can ask "is this a pop-out?"
// without pulling this file — and `lightweight-charts` with it — into the entry bundle.
export { readPopoutParams } from './popoutParams.js';

function Frame({ title, children, onRefresh, busy }) {
  return (
    <div className="hud-panel hud-panel-active" style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      borderRadius: 0, background: 'var(--bg)',
    }}>
      {/* The window has no OS frame (`frame: false`), so this bar is also the drag region — hence
          `-webkit-app-region`, which is the only way to move a frameless Electron window. */}
      <header className="hud-panel-bar" style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', height: 40,
        flexShrink: 0, WebkitAppRegion: 'drag',
      }}>
        <span aria-hidden="true" className="hud-panel-glyph">◈</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {/* Controls must opt OUT of the drag region or they cannot be clicked. */}
        <span style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 6 }}>
          {onRefresh && (
            <button type="button" className="hud-panel-btn" onClick={onRefresh}
                    disabled={busy} aria-label="Reload this panel's data">
              {busy ? '…' : '↺'}
            </button>
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
  const { panel, symbol, exchange, interval } = params;
  const [bars, setBars] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadBars = useCallback(async () => {
    if (!inElectron || panel !== 'chart') return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.rama.marketIntel.ohlcv({ symbol, exchange, interval, limit: 400 });
      if (res?.ok) setBars(Array.isArray(res.data?.bars) ? res.data.bars : []);
      else setError(res?.error || 'could not load bars');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [panel, symbol, exchange, interval]);

  useEffect(() => { loadBars(); }, [loadBars]);

  const title = `${symbol} · ${panel.toUpperCase()}`;

  if (!inElectron) {
    return (
      <Frame title={title}>
        <span style={{ fontSize: 12, color: 'var(--amber)' }}>
          This window needs the desktop app.
        </span>
      </Frame>
    );
  }

  /**
   * A POPPED-OUT WINDOW HAS NO SESSION, and that is not something this file can work around
   * (spec Section 100).
   *
   * `loadSession()` reads `sessionStorage`, which Chromium scopes PER WINDOW. So a second
   * BrowserWindow starts unauthenticated and every StockMind channel — all of them gated on
   * `stockmind.view` — refuses it. Rendering the panel anyway would show master the same
   * "Access denied: stockmind.view is not available unauthenticated" he already reported, which
   * would look like a bug in the panel rather than a missing capability in the pop-out.
   *
   * Saying so plainly is the honest state until a session hand-off exists. That hand-off is a
   * security-relevant change — it means passing a token to a new window — and is deliberately not
   * improvised here.
   */
  return (
    <Frame title={title}>
      <div style={{ fontSize: 12.5, color: 'var(--amber)', lineHeight: 1.7 }}>
        Popped-out windows are not signed in yet.
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 8 }}>
        A separate window gets its own session storage, so this one has no login and StockMind's data
        channels refuse it. Showing you an “access denied” panel would be worse than saying this.
        <br /><br />
        Use the <strong>WORKSPACE</strong> tab in the main window for a draggable board — that is
        fully working. Handing a session to a second window is a security change worth doing
        deliberately rather than quickly.
      </div>
    </Frame>
  );
}

/** Kept for when the session hand-off lands; not reachable until then. */
function PopoutPanelWithSession({ params }) {
  const { panel, symbol, exchange, interval } = params;
  const [bars, setBars] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadBars = useCallback(async () => {
    if (!inElectron || panel !== 'chart') return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.rama.marketIntel.ohlcv({ symbol, exchange, interval, limit: 400 });
      if (res?.ok) setBars(Array.isArray(res.data?.bars) ? res.data.bars : []);
      else setError(res?.error || 'could not load bars');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [panel, symbol, exchange, interval]);

  useEffect(() => { loadBars(); }, [loadBars]);
  const title = `${symbol} · ${panel.toUpperCase()}`;

  if (panel === 'chart') {
    return (
      <Frame title={`${title} · ${interval}`} onRefresh={loadBars} busy={busy}>
        {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>}
        {bars.length > 0
          ? <PriceChart bars={bars} />
          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {busy ? 'Loading bars…' : 'No bars available for this symbol and interval.'}
            </span>}
      </Frame>
    );
  }

  // BookPanel and WhyPanel already load their own data from these props, so they work unchanged in a
  // separate window — which is the payoff for having built them that way.
  if (panel === 'book') {
    return <Frame title={title}><BookPanel symbol={symbol} exchange={exchange} /></Frame>;
  }
  if (panel === 'why') {
    return <Frame title={title}><WhyPanel symbol={symbol} exchange={exchange} signal={null} /></Frame>;
  }

  // A panel id that has no standalone view says so, rather than rendering an empty frame.
  return (
    <Frame title={title}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
        “{panel}” has no standalone view. Signals need the selection state of the main window, so it
        is only available there.
      </span>
    </Frame>
  );
}
