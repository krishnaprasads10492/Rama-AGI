import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useUserStore } from '@store/userStore.js';
import PriceChart from './PriceChart.jsx';
import BookPanel from './BookPanel.jsx';
import WhyPanel from './WhyPanel.jsx';

/**
 * StockMind — market intelligence panel.
 *
 * Absorbed from StockMind AI per RAMA_AGI_MASTER_SPEC.md Section 39: the prediction engine
 * only, not the whole app. Talks to the Python backend through electron/ipc/marketIntel.cjs
 * (window.rama.marketIntel.*), which auto-starts ai_backend/main.py on first request.
 *
 * WHAT WAS WRONG WITH THIS PAGE (spec Section 71). It read field names the engine does not
 * emit, so two columns were permanently blank:
 *
 *   `signal.strategy || signal.name || signal.algorithm`  — the engine emits `variant`
 *   `signal.direction === 'long'`                          — the engine emits `type: "LONG"`
 *
 * And it never displayed entry, stop-loss or targets at all — the levels are the entire
 * product of a trading signal, and the table showed a probability with nothing to act on.
 * Sections 64 and 66 fixed the engine's honesty; this fixes whether any of it reaches the
 * screen.
 */

const inElectron = typeof window !== 'undefined' && !!window.rama?.marketIntel;

const GRADE_COLOR = {
  'A+': 'var(--green)',
  'A':  'var(--green)',
  'B':  'var(--accent)',
  'C':  'var(--amber)',
  'D':  'var(--red)',
};

const num = (v, dp = 2) =>
  (typeof v === 'number' && isFinite(v)) ? v.toFixed(dp) : '—';

const pct = (v) =>
  (typeof v === 'number' && isFinite(v)) ? `${Math.round(v)}%` : '—';

function Stat({ label, value, color, title }) {
  return (
    <div title={title} style={{ minWidth: '78px' }}>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: '12px', color: color || 'var(--text)', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function SignalRow({ signal, selected, onSelect }) {
  const grade = signal.grade || '—';
  const color = GRADE_COLOR[grade] || 'var(--muted)';
  // `type` is what the engine emits — "LONG" / "SHORT" — not `direction`.
  const dir = String(signal.type || '').toUpperCase();
  const dirColor = dir === 'LONG' ? 'var(--green)' : dir === 'SHORT' ? 'var(--red)' : 'var(--muted)';

  return (
    <tr
      onClick={() => onSelect?.(signal)}
      style={{
        borderBottom: '1px solid var(--border)',
        background: selected ? 'var(--accent-dim, rgba(0,200,255,0.07))' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <td style={{ padding: '7px 9px', fontSize: '12.5px', color: 'var(--text)' }}>
        {signal.variant || `#${signal.rank ?? '—'}`}
        {signal.suppressed && (
          <span title={signal.suppressReason || 'Models disagreed'}
                style={{ marginLeft: '6px', fontSize: '12.5px', color: 'var(--amber)' }}>
            ⚠ SUPPRESSED
          </span>
        )}
      </td>
      <td style={{ padding: '7px 9px', textAlign: 'center' }}>
        <span style={{ color: dirColor, fontWeight: 700, fontSize: '12px' }}>{dir || '—'}</span>
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'right', color: 'var(--text)' }}>
        {num(signal.entryPrice)}
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'right', color: 'var(--red)' }}>
        {num(signal.stopLoss)}
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'right', color: 'var(--green)' }}>
        {num(signal.t1Price)}
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'right', color: 'var(--green)' }}>
        {num(signal.t2Price)}
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'right', color: 'var(--green)' }}>
        {num(signal.t3Price)}
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'center', color: 'var(--text-dim)' }}>
        {num(signal.riskRewardRatio, 2)}
      </td>
      <td style={{ padding: '7px 9px', fontSize: '12.5px', textAlign: 'center', color: 'var(--text)' }}>
        {pct(signal.probability)}
      </td>
      <td style={{ padding: '7px 9px', textAlign: 'center' }}>
        <span className="badge" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
          {grade}
        </span>
      </td>
    </tr>
  );
}

export default function StockMind() {
  const { currentUser, canDo } = useUserStore();

  const [symbol,   setSymbol]   = useState('NIFTY50');
  const [exchange, setExchange] = useState('NSE');
  const [capital,  setCapital]  = useState('100000');
  const [riskPct,  setRiskPct]  = useState('1.5');
  const [direction, setDirection] = useState('both');
  const [barCount, setBarCount] = useState('180');

  const [status, setStatus]   = useState('idle');
  const [result, setResult]   = useState(null);
  const [error,  setError]    = useState(null);
  const [selected, setSelected] = useState(null);

  const [bars, setBars]       = useState([]);
  const [barsMeta, setBarsMeta] = useState(null);
  const [barsBusy, setBarsBusy] = useState(false);
  const [barsNote, setBarsNote] = useState(null);

  const [news, setNews]       = useState(null);
  const [newsBusy, setNewsBusy] = useState(false);
  const [derivs, setDerivs]   = useState(null);
  const [engine, setEngine]   = useState(null);

  // Tabs rather than one long scroll (Section 79). Seven stacked cards was the cramming; the
  // chart is the primary surface and everything else is a deliberate visit.
  const [tab, setTab] = useState('chart');
  // NOT named `interval`/`setInterval`: that shadows the global `setInterval` inside this
  // component, and the failure would look like a mystery rather than a name collision.
  const [barInterval, setBarInterval] = useState('1d');
  const [cone, setCone] = useState(null);
  const [coneOn, setConeOn] = useState(false);
  const [held, setHeld] = useState(null);   // the tracked position in this symbol, if any

  const canRequest = canDo ? canDo('stockmind.request') : false;
  const canView    = canDo ? canDo('stockmind.view') : false;
  const canConfig  = canDo ? canDo('stockmind.config') : false;

  const sym = symbol.trim().toUpperCase();

  // The last close is the natural base price. Typing it by hand was the previous design and
  // it invites a stale number — a signal priced off a price the market left days ago.
  const lastClose = bars.length ? bars[bars.length - 1].close : null;

  const loadBars = useCallback(async (doSync = false) => {
    if (!inElectron || !sym) return;
    setBarsBusy(true);
    setBarsNote(null);
    const res = await window.rama.marketIntel.ohlcv({
      user: currentUser, symbol: sym, exchange,
      interval: barInterval, limit: parseInt(barCount, 10) || 180, sync: doSync,
    });
    setBarsBusy(false);
    if (res?.ok === false) {
      setBarsNote(res.error || 'Could not load price history');
      return;
    }
    setBars(res.data?.bars || []);
    setBarsMeta(res.data || null);
    if (res.data?.note) setBarsNote(res.data.note);
  }, [sym, exchange, barCount, currentUser, barInterval]);

  // The tracked position in this symbol, so the chart can mark master's own fills and draw the
  // levels he committed to. Section 79: "where am I inside this move?" was previously answerable
  // only by reading the table and the chart separately and doing it in your head.
  const loadHeld = useCallback(async () => {
    if (!inElectron || !sym) return;
    const res = await window.rama.marketIntel.ledgerPositions({
      user: currentUser, symbol: sym, status: 'open',
    });
    const first = res?.ok === false ? null : (res.data?.positions || [])[0] || null;
    if (!first) { setHeld(null); return; }
    const detail = await window.rama.marketIntel.ledgerPosition({
      user: currentUser, positionId: first.positionId,
    });
    setHeld(detail?.ok === false ? first : (detail.data || first));
  }, [sym, currentUser]);

  const loadCone = useCallback(async (horizonName) => {
    if (!inElectron || !sym) return;
    const res = await window.rama.marketIntel.forecast({
      user: currentUser, symbol: sym, exchange,
      horizon: horizonName || (barInterval === '60m' ? 'intraday' : 'swing'),
      stop: held?.thesis?.stopPrice ?? null,
      target: held?.thesis?.targetPrice ?? null,
    });
    setCone(res?.ok === false ? { error: res.error } : (res.data?.cone || null));
  }, [sym, exchange, currentUser, barInterval,
    held?.thesis?.stopPrice, held?.thesis?.targetPrice]);

  const loadNews = useCallback(async () => {
    if (!inElectron || !sym) return;
    setNewsBusy(true);
    const res = await window.rama.marketIntel.news({ user: currentUser, symbol: sym, limit: 14 });
    setNewsBusy(false);
    setNews(res?.ok === false ? { error: res.error } : res.data);
  }, [sym, currentUser]);

  const loadContext = useCallback(async () => {
    if (!inElectron) return;
    const [d, m] = await Promise.all([
      window.rama.marketIntel.derivatives({ user: currentUser, symbol: sym, exchange }),
      window.rama.marketIntel.models({ user: currentUser }),
    ]);
    setDerivs(d?.ok === false ? { error: d.error } : d.data);
    setEngine(m?.ok === false ? { error: m.error } : m.data);
  }, [sym, exchange, currentUser]);

  // Load once on mount for the default symbol, so the page is not empty on arrival.
  useEffect(() => {
    if (inElectron && canView) {
      loadBars(false);
      loadContext();
      loadHeld();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-read bars when the interval changes, so the 60m/1d switch is not a dead control.
  useEffect(() => {
    if (inElectron && canView) loadBars(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barInterval]);

  useEffect(() => {
    if (coneOn) loadCone();
    else setCone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coneOn, sym, barInterval]);

  const runPredict = async () => {
    if (!inElectron) {
      setError('Market Intel bridge unavailable — run inside the Rāma desktop app.');
      setStatus('error');
      return;
    }
    if (!lastClose) {
      setError('Load price history first — the base price comes from the last stored close.');
      setStatus('error');
      return;
    }
    setStatus('requesting');
    setError(null);
    setResult(null);
    setSelected(null);

    const res = await window.rama.marketIntel.predict({
      user:      currentUser,
      symbol:    sym,
      exchange,
      basePrice: lastClose,
      capital:   parseFloat(capital),
      riskPct:   parseFloat(riskPct),
      direction,
      predictionMode: 'realworld',
    });

    if (res?.ok === false) {
      setError(res.error || 'Prediction request failed');
      setStatus('error');
      return;
    }
    setResult(res.data);
    setSelected((res.data?.signals || [])[0] || null);
    setStatus('done');
  };

  const signals = useMemo(
    () => Array.isArray(result?.signals) ? result.signals : [],
    [result]
  );

  const dataIsMock = result && result.dataSource !== 'real';
  const latestDeriv = derivs?.latest || null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--magenta)', letterSpacing: '0.1em' }}>STOCKMIND AI</span>
        <span className="badge badge-magenta">ABSORBED ENGINE</span>
        <span className={`badge ${status === 'done' ? 'badge-green' : status === 'requesting' ? 'badge-amber' : status === 'error' ? 'badge-red' : ''}`}>
          {status.toUpperCase()}
        </span>
        <div style={{ flex: 1 }} />
        {engine && !engine.error && (
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}
                title={engine.note || ''}>
            {engine.registry?.models_trained || 0} trained ·{' '}
            {engine.featureContract?.aligned ? 'contract aligned' : 'CONTRACT MISALIGNED'}
          </span>
        )}
      </div>

      {/* Tabs, not a seven-card scroll (Section 79). The chart is the primary surface. */}
      <div style={{
        display: 'flex', gap: '2px', padding: '0 20px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }} role="tablist">
        {[
          ['chart', 'CHART'],
          ['signals', 'SIGNALS'],
          ['book', 'YOUR BOOK'],
          ['why', 'WHY'],
          ['engine', 'ENGINE'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  style={{
                    padding: '8px 14px', fontSize: '12.5px', letterSpacing: '0.08em',
                    background: 'none', cursor: 'pointer',
                    border: 'none',
                    borderBottom: `2px solid ${tab === id ? 'var(--magenta)' : 'transparent'}`,
                    color: tab === id ? 'var(--text)' : 'var(--muted)',
                    fontWeight: tab === id ? 700 : 400,
                  }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Disclaimer — non-removable per spec */}
        <div style={{
          padding: '14px 18px',
          background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.3)',
          borderRadius: 'var(--radius)', fontSize: '12.5px', color: 'var(--amber)', lineHeight: '1.7',
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
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>SYMBOL</div>
              <input className="input" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="NIFTY50" />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>EXCHANGE</div>
              <select className="input" value={exchange} onChange={e => setExchange(e.target.value)}>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
                <option value="NASDAQ">NASDAQ</option>
                <option value="NYSE">NYSE</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>DIRECTION</div>
              <select className="input" value={direction} onChange={e => setDirection(e.target.value)}>
                <option value="both">Both</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                BASE PRICE (last stored close)
              </div>
              <input className="input" value={lastClose ?? ''} readOnly
                     placeholder="load history →"
                     title="Taken from the last stored bar rather than typed, so a signal cannot be priced off a stale number." />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>CAPITAL</div>
              <input className="input" type="number" value={capital} onChange={e => setCapital(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>RISK %</div>
              <input className="input" type="number" step="0.5" min="0.5" max="5" value={riskPct} onChange={e => setRiskPct(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
            {/* Interval is a real control now, not a hardcoded '1d' (Section 79). 60m is the only
                intraday depth Yahoo gives — 5m and 15m cap at a month, see horizons.DISPLAY_ONLY. */}
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>INTERVAL</div>
            <select className="input" style={{ width: '78px' }} value={barInterval}
                    onChange={e => setBarInterval(e.target.value)}>
              <option value="1d">1d</option>
              <option value="60m">60m</option>
            </select>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>BARS</div>
            <input className="input" type="number" min="40" max="1200" step="20"
                   style={{ width: '84px' }}
                   value={barCount} onChange={e => setBarCount(e.target.value)} />
            <button className="btn" disabled={barsBusy || !canView} onClick={() => loadBars(false)}>
              {barsBusy ? 'Loading…' : '↺ Load history'}
            </button>
            <button className="btn" disabled={barsBusy || !canView} onClick={() => loadBars(true)}
                    title="Fetch from the provider chain into the local store. Reaches back as far as the provider allows.">
              ⇩ Fetch &amp; store
            </button>
            <button className="btn" disabled={newsBusy || !canView} onClick={loadNews}>
              {newsBusy ? 'Reading…' : '📰 Read news'}
            </button>
            <div style={{ flex: 1 }} />
            {!canRequest && (
              <span style={{ fontSize: '12.5px', color: 'var(--amber)' }}>Requires Operator tier or higher</span>
            )}
            <button
              className="btn btn-primary"
              disabled={!canRequest || status === 'requesting' || !sym || !capital || !lastClose}
              onClick={runPredict}
            >
              {status === 'requesting' ? 'Requesting…' : '⚡ Generate Signals'}
            </button>
          </div>

          {barsNote && (
            <div style={{ fontSize: '12.5px', color: 'var(--amber)' }}>{barsNote}</div>
          )}
        </div>

        {/* Error */}
        {status === 'error' && error && (
          <div style={{ padding: '12px 16px', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.3)',
            borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: '12px' }}>
            ✕ {error}
            {String(error).includes('not reachable') && (
              <div style={{ marginTop: '6px', color: 'var(--text-dim)', fontSize: '12.5px' }}>
                The Python backend may still be starting (model ensemble load takes a few seconds). Try again.
              </div>
            )}
          </div>
        )}

        {/* Chart */}
        {tab === 'chart' && (
          <div className="hud-card" style={{ padding: '14px 16px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {barsMeta?.stored != null && (
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {barsMeta.stored} stored from {barsMeta.storedFirstBar}
                </span>
              )}
              <div style={{ flex: 1 }} />
              {held && (
                <span style={{ fontSize: '12px', color: 'var(--green)' }}
                      title="your tracked position in this symbol">
                  you hold {held.netQty} @ {held.avgCost} ({held.tradeStyle})
                </span>
              )}
              {selected && (
                <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                  overlay: {selected.variant || `#${selected.rank}`} ({String(selected.type || '').toUpperCase()})
                </span>
              )}
              <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex',
                gap: '4px', alignItems: 'center' }}
                     title="Draw the range this instrument's own volatility calls ordinary over the horizon">
                <input type="checkbox" checked={coneOn}
                       onChange={e => setConeOn(e.target.checked)} />
                projection
              </label>
            </div>
            <PriceChart
              bars={bars}
              signal={selected}
              symbol={sym}
              interval={barInterval}
              height={400}
              fills={held?.fills || []}
              thesis={held?.thesis || null}
              cone={cone}
            />
            {cone?.error && (
              <div style={{ fontSize: '12px', color: 'var(--amber)', padding: '2px' }}>
                Projection unavailable: {cone.error}
              </div>
            )}
            {cone && cone.ok === false && (
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '2px' }}>
                Projection unavailable: {cone.reason}
              </div>
            )}
          </div>
        )}

        {tab === 'book' && (
          <BookPanel currentUser={currentUser} canConfig={canConfig}
                     symbol={sym} exchange={exchange} lastClose={lastClose}
                     onPickSymbol={(s) => { setSymbol(s); setTab('chart'); }} />
        )}

        {tab === 'why' && (
          <WhyPanel currentUser={currentUser} symbol={sym} exchange={exchange}
                    thesis={held?.thesis || null} />
        )}

        {/* Signals */}
        {tab === 'signals' && result && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <div className="section-label">SIGNALS — {result.symbol} ({result.exchange})</div>
              <span className={`badge ${dataIsMock ? 'badge-amber' : 'badge-green'}`}>
                {dataIsMock ? 'MOCK DATA — INDICATIVE ONLY' : 'REAL OHLCV'}
              </span>
              {result.suppressedCount > 0 && (
                <span className="badge badge-amber" title="Models disagreed on these setups">
                  {result.suppressedCount} SUPPRESSED
                </span>
              )}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{result.modelVersion}</span>
            </div>

            {signals.length > 0 ? (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['SETUP', 'DIR', 'ENTRY', 'SL', 'T1', 'T2', 'T3', 'R:R', 'PROB', 'GRADE'].map((h, i) => (
                        <th key={h} style={{
                          padding: '7px 9px', fontSize: '12.5px', color: 'var(--muted)',
                          textAlign: i === 0 ? 'left' : i >= 2 && i <= 6 ? 'right' : 'center',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {signals.map((s, i) => (
                      <SignalRow key={s.id || i} signal={s}
                                 selected={selected && (selected.id === s.id)}
                                 onSelect={setSelected} />
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                  Click a row to overlay its levels on the chart. Each row is a different risk
                  geometry over <strong>one</strong> prediction — not {signals.length} independent forecasts.
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: '12px', padding: '12px' }}>No signals returned.</div>
            )}

            {/* Why — straight from the ensemble */}
            {selected && Array.isArray(selected.reasons) && selected.reasons.length > 0 && (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                <div className="section-label" style={{ marginBottom: '8px' }}>
                  WHY — {selected.variant || `#${selected.rank}`}
                </div>
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <Stat label="DIRECTIONAL" value={pct(selected.directionalProbability)}
                        title="The ensemble's view on direction, before geometry" />
                  <Stat label="T1 / T2 / T3"
                        value={`${pct(selected.t1Probability)} / ${pct(selected.t2Probability)} / ${pct(selected.t3Probability)}`} />
                  <Stat label="SL RISK" value={pct(selected.slProbability)} color="var(--red)" />
                  <Stat label="REGIME" value={selected.regime || '—'} />
                  <Stat label="AGREEMENT" value={num(selected.modelAgreement, 2)}
                        title="Share of models within 0.15 of the blended probability" />
                  <Stat label="UNCERTAINTY" value={num(selected.uncertainty, 3)} />
                  <Stat label="MAX RISK" value={selected.maxRisk != null ? String(selected.maxRisk) : '—'} />
                  <Stat label="VALID FOR" value={selected.validityBars != null ? `${selected.validityBars} bars` : '—'} />
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-dim)', lineHeight: '1.8' }}>
                  {selected.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                {selected.probabilityBasis && (
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                    Probability basis: {selected.probabilityBasis}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Derivatives context */}
        {tab === 'engine' && latestDeriv && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div className="section-label">DERIVATIVES — {derivs.symbol}</div>
              <span className="badge badge-green">BACKTESTABLE</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                {derivs.rows} days stored · as of {String(latestDeriv.date || '').slice(0, 10)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <Stat label="PCR (OI)" value={num(latestDeriv.pcr_oi, 3)}
                    title="Put/call open-interest ratio for the nearest expiry" />
              <Stat label="MAX PAIN" value={num(latestDeriv.max_pain, 0)}
                    title="Strike at which option writers pay out least" />
              <Stat label="SUPPORT" value={num(latestDeriv.max_pe_oi_strike, 0)} color="var(--green)" />
              <Stat label="RESISTANCE" value={num(latestDeriv.max_ce_oi_strike, 0)} color="var(--red)" />
              <Stat label="FUT BASIS" value={latestDeriv.fut_basis_pct != null
                    ? `${(latestDeriv.fut_basis_pct * 100).toFixed(2)}%` : '—'} />
              <Stat label="ROLLOVER" value={latestDeriv.rollover_pct != null
                    ? `${(latestDeriv.rollover_pct * 100).toFixed(1)}%` : '—'} />
              <Stat label="EXPECTED MOVE" value={latestDeriv.straddle_pct != null
                    ? `${(latestDeriv.straddle_pct * 100).toFixed(2)}%` : '—'}
                    title="ATM straddle as a fraction of spot — the market's own priced move to expiry" />
              <Stat label="DAYS TO EXPIRY" value={latestDeriv.days_to_expiry != null
                    ? String(latestDeriv.days_to_expiry) : '—'} />
            </div>
          </div>
        )}

        {/* News */}
        {tab === 'engine' && news && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <div className="section-label">NEWS — {sym}</div>
              <span className="badge badge-amber" title="No free feed has enough history to measure whether this predicts anything">
                NOT BACKTESTABLE
              </span>
              {news.aggregate && (
                <>
                  <Stat label="SENTIMENT" value={num(news.aggregate.sentiment, 3)}
                        color={news.aggregate.sentiment > 0.05 ? 'var(--green)'
                          : news.aggregate.sentiment < -0.05 ? 'var(--red)' : 'var(--muted)'} />
                  <Stat label="POS / NEG"
                        value={`${news.aggregate.positive} / ${news.aggregate.negative}`} />
                  <Stat label="EVENT" value={news.aggregate.dominantEvent || '—'} />
                  <Stat label="SOURCES" value={String(news.aggregate.sources ?? '—')} />
                </>
              )}
            </div>
            {news.error ? (
              <div style={{ fontSize: '12.5px', color: 'var(--red)' }}>✕ {news.error}</div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {(news.items || []).map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: '9px', alignItems: 'baseline', fontSize: '12.5px' }}>
                      <span style={{
                        width: '38px', flexShrink: 0, textAlign: 'right', fontWeight: 700,
                        color: it.sentiment > 0.05 ? 'var(--green)'
                          : it.sentiment < -0.05 ? 'var(--red)' : 'var(--muted)',
                      }}>
                        {it.sentiment > 0 ? '+' : ''}{num(it.sentiment, 2)}
                      </span>
                      {it.event && (
                        <span className="badge" style={{ flexShrink: 0 }}>{it.event}</span>
                      )}
                      <span style={{ color: 'var(--text)' }}>{it.title}</span>
                      <span style={{ color: 'var(--muted)', fontSize: '12.5px', flexShrink: 0, marginLeft: 'auto' }}>
                        {it.publisher}
                      </span>
                    </div>
                  ))}
                </div>
                {news.note && (
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '10px' }}>{news.note}</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Engine state. Says plainly whether any model has earned the right to advise. */}
        {tab === 'engine' && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div className="section-label" style={{ marginBottom: '10px' }}>ENGINE</div>
            {engine && !engine.error ? (
              <>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  <Stat label="MODELS TRAINED" value={String(engine.registry?.models_trained ?? '—')} />
                  <Stat label="FEATURE CONTRACT"
                        value={engine.featureContract?.aligned ? 'ALIGNED' : 'MISALIGNED'}
                        color={engine.featureContract?.aligned ? 'var(--green)' : 'var(--red)'} />
                  <Stat label="AVAILABLE" value={String(engine.registry?.available?.length ?? '—')} />
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--amber)', marginTop: '12px',
                  lineHeight: 1.7 }}>
                  No horizon's model currently clears the acceptance gate, measured on live data.
                  Every directional reading in this page is therefore reported but not acted on —
                  see the WHY tab for the recorded reason. The stop, drawdown, concentration and
                  holding-period warnings do not depend on a model and are live.
                </div>
                {engine.note && (
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                    {engine.note}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '12.5px', color: engine?.error ? 'var(--red)' : 'var(--muted)' }}>
                {engine?.error || 'Engine state not loaded.'}
              </div>
            )}
            {!news && (
              <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '10px' }}>
                Use “Read news” above to pull headlines for {sym}.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

