import React, { useState } from 'react';
import { useUserStore } from '@store/userStore.js';

/**
 * StockMind — market intelligence panel.
 *
 * Absorbed from StockMind AI per RAMA_AGI_MASTER_SPEC.md Section 39: the
 * prediction engine only, not the whole app. This page talks to the Python
 * backend through electron/ipc/marketIntel.cjs (window.rama.marketIntel.*),
 * which auto-starts ai_backend/main.py on first request. Gated on
 * stockmind.request (tier 3) for predictions, stockmind.view (tier 4) for
 * read-only status.
 */

const inElectron = typeof window !== 'undefined' && !!window.rama?.marketIntel;

const GRADE_COLOR = {
  'A+': 'var(--green)',
  'A':  'var(--green)',
  'B':  'var(--accent)',
  'C':  'var(--amber)',
  'D':  'var(--red)',
};

function SignalRow({ signal }) {
  const grade = signal.grade || signal.riskGrade || '—';
  const color = GRADE_COLOR[grade] || 'var(--muted)';
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--text)' }}>
        {signal.strategy || signal.name || signal.algorithm || '—'}
      </td>
      <td style={{ padding: '8px 10px', fontSize: '12px', textAlign: 'center' }}>
        <span style={{
          color: signal.direction === 'long' ? 'var(--green)' : signal.direction === 'short' ? 'var(--red)' : 'var(--muted)',
          fontWeight: 700, textTransform: 'uppercase', fontSize: '10px',
        }}>
          {signal.direction || '—'}
        </span>
      </td>
      <td style={{ padding: '8px 10px', fontSize: '12px', textAlign: 'center', color: 'var(--text)' }}>
        {typeof signal.probability === 'number' ? `${(signal.probability > 1 ? signal.probability : signal.probability * 100).toFixed(1)}%` : '—'}
      </td>
      <td style={{ padding: '8px 10px', fontSize: '12px', textAlign: 'center' }}>
        <span className="badge" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
          {grade}
        </span>
      </td>
      <td style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--text-dim)', maxWidth: '260px' }}>
        {Array.isArray(signal.reasons) ? signal.reasons.slice(0, 2).join('; ') : (signal.reason || '—')}
      </td>
    </tr>
  );
}

export default function StockMind() {
  const { currentUser, canDo } = useUserStore();

  const [symbol,   setSymbol]   = useState('RELIANCE');
  const [exchange, setExchange] = useState('NSE');
  const [basePrice, setBasePrice] = useState('2500');
  const [capital,  setCapital]  = useState('100000');
  const [riskPct,  setRiskPct]  = useState('1.5');
  const [direction, setDirection] = useState('both');

  const [status, setStatus] = useState('idle'); // idle | requesting | done | error
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState(null);

  const canRequest = canDo ? canDo('stockmind.request') : false;

  const runPredict = async () => {
    if (!inElectron) {
      setError('Market Intel bridge unavailable — run inside the Rāma desktop app.');
      setStatus('error');
      return;
    }
    setStatus('requesting');
    setError(null);
    setResult(null);

    const res = await window.rama.marketIntel.predict({
      user:      currentUser,
      symbol:    symbol.trim().toUpperCase(),
      exchange,
      basePrice: parseFloat(basePrice),
      capital:   parseFloat(capital),
      riskPct:   parseFloat(riskPct),
      direction,
    });

    if (res?.ok === false) {
      setError(res.error || 'Prediction request failed');
      setStatus('error');
      return;
    }

    setResult(res.data);
    setStatus('done');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--magenta)', letterSpacing: '0.1em' }}>STOCKMIND AI</span>
        <span className="badge badge-magenta">ABSORBED ENGINE</span>
        <span className={`badge ${status === 'done' ? 'badge-green' : status === 'requesting' ? 'badge-amber' : status === 'error' ? 'badge-red' : ''}`}>
          {status.toUpperCase()}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Disclaimer — non-removable per spec */}
        <div style={{
          padding: '14px 18px',
          background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.3)',
          borderRadius: 'var(--radius)', fontSize: '11px', color: 'var(--amber)', lineHeight: '1.7',
        }}>
          ⚠ DISCLAIMER: StockMind provides AI-generated market analysis for informational purposes only.
          Not financial advice. Past performance does not guarantee future results.
          All signals carry inherent risk of loss. Human judgment required for all trading decisions.
        </div>

        {/* Request form */}
        <div className="hud-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="section-label">SIGNAL REQUEST</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>SYMBOL</div>
              <input className="input" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="RELIANCE" />
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>EXCHANGE</div>
              <select className="input" value={exchange} onChange={e => setExchange(e.target.value)}>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
                <option value="NASDAQ">NASDAQ</option>
                <option value="NYSE">NYSE</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>DIRECTION</div>
              <select className="input" value={direction} onChange={e => setDirection(e.target.value)}>
                <option value="both">Both</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>BASE PRICE</div>
              <input className="input" type="number" value={basePrice} onChange={e => setBasePrice(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>CAPITAL</div>
              <input className="input" type="number" value={capital} onChange={e => setCapital(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>RISK %</div>
              <input className="input" type="number" step="0.5" min="0.5" max="5" value={riskPct} onChange={e => setRiskPct(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            {!canRequest && (
              <span style={{ fontSize: '11px', color: 'var(--amber)', alignSelf: 'center' }}>
                Requires Operator tier or higher
              </span>
            )}
            <button
              className="btn btn-primary"
              disabled={!canRequest || status === 'requesting' || !symbol.trim() || !basePrice || !capital}
              onClick={runPredict}
            >
              {status === 'requesting' ? 'Requesting...' : '⚡ Generate Signals'}
            </button>
          </div>
        </div>

        {/* Error */}
        {status === 'error' && error && (
          <div style={{ padding: '12px 16px', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.3)',
            borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: '12px' }}>
            ✕ {error}
            {error.includes('not reachable') && (
              <div style={{ marginTop: '6px', color: 'var(--text-dim)', fontSize: '11px' }}>
                The Python backend may still be starting (model ensemble load takes a few seconds). Try again.
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div className="section-label">SIGNALS — {result.symbol} ({result.exchange})</div>
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                {result.dataSource === 'real' ? 'real OHLCV' : 'mock data — indicative only'}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{result.modelVersion}</span>
            </div>

            {Array.isArray(result.signals) && result.signals.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '10px', color: 'var(--muted)' }}>STRATEGY</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '10px', color: 'var(--muted)' }}>DIR</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '10px', color: 'var(--muted)' }}>PROB</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '10px', color: 'var(--muted)' }}>GRADE</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '10px', color: 'var(--muted)' }}>REASONS</th>
                  </tr>
                </thead>
                <tbody>
                  {result.signals.map((s, i) => <SignalRow key={i} signal={s} />)}
                </tbody>
              </table>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: '12px', padding: '12px' }}>No signals returned.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
