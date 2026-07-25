import React, { useState } from 'react';

/**
 * StockMind — Embedded panel.
 * Phase 4 will embed the full StockMind app via an Electron webview
 * pointing to localhost:4099 (StockMind Vite port).
 * This shell provides the navigation wrapper and connection state.
 */
export default function StockMind() {
  const [url, setUrl]     = useState('http://localhost:4099');
  const [status, setStatus] = useState('disconnected'); // 'connected' | 'connecting' | 'disconnected'

  const connect = () => {
    setStatus('connecting');
    // Will wire to Electron webview in Phase 4
    setTimeout(() => setStatus('connected'), 1200);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--magenta)', letterSpacing: '0.1em' }}>STOCKMIND AI</span>
        <span className="badge badge-magenta">ASSIMILATED MODULE</span>
        <span className={`badge ${status === 'connected' ? 'badge-green' : status === 'connecting' ? 'badge-amber' : 'badge-red'}`}>
          {status.toUpperCase()}
        </span>
        <div style={{ flex: 1 }} />
        <input className="input" value={url} onChange={e => setUrl(e.target.value)}
          style={{ width: '220px', fontSize: '11px' }} />
        <button className="btn btn-sm btn-primary" onClick={connect}>
          {status === 'connecting' ? 'Connecting...' : 'Connect'}
        </button>
      </div>

      {/* Content */}
      {status === 'connected' ? (
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Phase 4: <webview src={url} style={{width:'100%',height:'100%'}} /> */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', gap: '16px',
          }}>
            <span style={{ fontSize: '32px' }}>◬</span>
            <div style={{ color: 'var(--magenta)', fontWeight: 700, letterSpacing: '0.1em' }}>
              STOCKMIND CONNECTED
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center', lineHeight: '1.8' }}>
              Phase 4 will embed the full StockMind app here via Electron webview.<br />
              StockMind server: <span style={{ color: 'var(--accent)' }}>{url}</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '20px' }}>
          <span style={{ fontSize: '48px', opacity: 0.4 }}>◬</span>
          <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', lineHeight: '1.8' }}>
            StockMind AI module<br />
            <span style={{ fontSize: '11px' }}>Start StockMind server on port 4099, then click Connect</span>
          </div>

          {/* Safety disclaimer — non-removable per spec */}
          <div style={{
            maxWidth: '480px', padding: '14px 18px',
            background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.3)',
            borderRadius: 'var(--radius)', fontSize: '11px', color: 'var(--amber)', lineHeight: '1.7',
            textAlign: 'center',
          }}>
            ⚠ DISCLAIMER: StockMind provides AI-generated market analysis for informational purposes only.
            Not financial advice. Past performance does not guarantee future results.
            All signals carry inherent risk of loss. Human judgment required for all trading decisions.
          </div>

          <button className="btn btn-primary" onClick={connect}>
            Connect to StockMind
          </button>
        </div>
      )}
    </div>
  );
}
