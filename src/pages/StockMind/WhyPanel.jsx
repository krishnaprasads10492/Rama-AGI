import React, { useCallback, useEffect, useState } from 'react';

/**
 * WhyPanel — the justification bullets and the pitfalls (Section 76), plus the risk ruler
 * (Section 78).
 *
 * THE BULLETS ARE GROUPED BY `basis`, AND THE ORDER IS DELIBERATE: the gate verdict first, then
 * the forecast it qualifies, then measured observations, then conventions. Printing the
 * probability first and admitting later that it is unvalidated gets the emphasis backwards, which
 * is the exact harm Section 76 exists to prevent.
 *
 * A convention is rendered in muted type and labelled, because "above 70 is read as overbought"
 * is a widely used habit rather than a measured edge in this data.
 *
 * WARNINGS THAT COULD NOT RUN ARE SHOWN, not hidden. An empty list must mean "checked and clear",
 * never "could not look".
 */

const BASIS_LABEL = {
  gate: 'WHETHER IT MAY BE BELIEVED',
  forecast: 'WHAT THE MODEL SAYS',
  observation: 'WHAT IS MEASURED',
  convention: 'HOW THE MARKET CONVENTIONALLY READS IT',
};
const BASIS_ORDER = ['gate', 'forecast', 'observation', 'convention'];
const BASIS_COLOR = {
  gate: 'var(--amber)', forecast: 'var(--accent)',
  observation: 'var(--text)', convention: 'var(--muted)',
};
const SEV_COLOR = { critical: 'var(--red)', warning: 'var(--amber)', info: 'var(--muted)' };

export default function WhyPanel({ currentUser, symbol, exchange, thesis }) {
  const [brief, setBrief] = useState(null);
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [horizon, setHorizon] = useState('swing');

  const hasBridge = typeof window !== 'undefined' && !!window.rama?.marketIntel;

  const load = useCallback(async () => {
    if (!hasBridge || !symbol) return;
    setBusy(true);
    const [b, f] = await Promise.all([
      window.rama.marketIntel.explain({ user: currentUser, symbol, exchange, includeLive: live }),
      window.rama.marketIntel.forecast({
        user: currentUser, symbol, exchange, horizon,
        stop: thesis?.stopPrice ?? null, target: thesis?.targetPrice ?? null,
      }),
    ]);
    setBusy(false);
    setBrief(b?.ok === false ? { error: b.error } : b?.data || null);
    setRisk(f?.ok === false ? { error: f.error } : f?.data || null);
  }, [currentUser, symbol, exchange, live, horizon,
    thesis?.stopPrice, thesis?.targetPrice]);

  useEffect(() => { load(); }, [load]);

  if (!hasBridge) {
    return <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
      Unavailable — run inside the Rāma desktop app.
    </div>;
  }

  const bullets = brief?.bullets || [];
  const warnings = brief?.warnings || [];
  const checked = warnings.filter((w) => w.checked);
  const unchecked = warnings.filter((w) => !w.checked);
  const ruler = risk?.risk;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div className="section-label">WHY — {symbol}</div>
        <div style={{ flex: 1 }} />
        <select className="input" style={{ width: 'auto', fontSize: '12px' }}
                value={horizon} onChange={(e) => setHorizon(e.target.value)}>
          <option value="intraday">intraday</option>
          <option value="swing">swing</option>
          <option value="positional">positional</option>
        </select>
        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex',
          gap: '4px', alignItems: 'center' }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          delivery + events (fetches)
        </label>
        <button type="button" className="btn btn-sm" onClick={load} disabled={busy}>
          {busy ? '…' : 'refresh'}
        </button>
      </div>

      {/* The caveat is part of the payload, not something the UI may drop. */}
      {brief?.caveat && (
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: '12.5px',
          lineHeight: 1.7,
          background: brief.entitledHorizons?.length
            ? 'rgba(80,200,120,0.06)' : 'rgba(255,170,0,0.06)',
          border: `1px solid ${brief.entitledHorizons?.length
            ? 'rgba(80,200,120,0.3)' : 'rgba(255,170,0,0.3)'}`,
          color: brief.entitledHorizons?.length ? 'var(--green)' : 'var(--amber)',
        }}>
          {brief.caveat}
        </div>
      )}

      {/* ── The risk ruler — arithmetic, so it is usable today ───────────────── */}
      {ruler?.ok && (ruler.stop || ruler.target) && (
        <div className="hud-card" style={{ padding: '12px 14px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>
            YOUR LEVELS AGAINST THIS INSTRUMENT'S OWN VOLATILITY
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
            {ruler.stop && (
              <div style={{
                borderLeft: `3px solid ${ruler.stop.insideNoise ? 'var(--red)' : 'var(--green)'}`,
                paddingLeft: '10px',
              }}>
                <div style={{ color: 'var(--text)' }}>
                  Stop {ruler.stop.price} — {ruler.stop.distancePct}% away,
                  {' '}{ruler.stop.barsOfNoise} ordinary bar-moves
                </div>
                <div style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  {ruler.stop.verdict}
                </div>
              </div>
            )}
            {ruler.target && (
              <div style={{
                borderLeft: `3px solid ${ruler.target.insideNoise ? 'var(--amber)' : 'var(--green)'}`,
                paddingLeft: '10px',
              }}>
                <div style={{ color: 'var(--text)' }}>
                  Target {ruler.target.price} — {ruler.target.distancePct}% away,
                  {' '}{ruler.target.horizonSigmas} horizon-sigmas
                </div>
                <div style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  {ruler.target.verdict}
                </div>
              </div>
            )}
            {ruler.rewardRisk !== null && ruler.rewardRisk !== undefined && (
              <div style={{ color: 'var(--muted)', fontSize: '12.5px' }}>
                Reward-to-risk {ruler.rewardRisk}:1 against your own levels · one-bar σ
                {' '}{ruler.sigmaOneBar} · horizon σ {ruler.sigmaHorizon}
              </div>
            )}
          </div>
        </div>
      )}
      {ruler?.ok === false && (
        <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
          Risk ruler unavailable: {ruler.reason}
        </div>
      )}

      {/* ── Warnings ─────────────────────────────────────────────────────────── */}
      {checked.length > 0 && (
        <div className="hud-card" style={{ padding: '12px 14px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>
            PITFALLS AND TRAPS ({checked.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {checked.map((w, i) => (
              <div key={`${w.kind}${i}`} style={{
                borderLeft: `3px solid ${SEV_COLOR[w.severity] || 'var(--border)'}`,
                paddingLeft: '10px',
              }}>
                <div style={{ fontSize: '12.5px', color: 'var(--text)', fontWeight: 600 }}>
                  {w.headline}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  {w.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bullets, grouped by basis, in the deliberate order ───────────────── */}
      <div className="hud-card" style={{ padding: '12px 14px' }}>
        <div className="section-label" style={{ marginBottom: '8px' }}>JUSTIFICATION</div>
        {bullets.length === 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
            {brief?.error || (busy ? 'Reading…' : 'Nothing to explain yet.')}
          </div>
        )}
        {BASIS_ORDER.map((basis) => {
          const group = bullets.filter((b) => b.basis === basis);
          if (group.length === 0) return null;
          return (
            <div key={basis} style={{ marginBottom: '10px' }}>
              <div style={{
                fontSize: '12.5px', letterSpacing: '0.08em', color: BASIS_COLOR[basis],
                marginBottom: '4px', fontWeight: 700,
              }}>
                {BASIS_LABEL[basis]}
              </div>
              <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex',
                flexDirection: 'column', gap: '3px' }}>
                {group.map((b, i) => (
                  <li key={i} style={{
                    fontSize: '12.5px', lineHeight: 1.65,
                    color: basis === 'convention' ? 'var(--muted)'
                      : basis === 'gate' ? 'var(--amber)' : 'var(--text-dim)',
                    fontStyle: basis === 'convention' ? 'italic' : 'normal',
                  }}>
                    {b.text}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Silence must never read as safety. */}
      {unchecked.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--text-dim)' }}>Not checked</strong> — these are not a
          clean bill of health, they simply could not be looked at:
          <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
            {unchecked.map((w, i) => (
              <li key={i}>{w.headline} — {w.detail}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


