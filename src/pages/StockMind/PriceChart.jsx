import React, { useMemo, useState } from 'react';

/**
 * PriceChart — candlesticks with the signal's own levels drawn on them.
 *
 * WHY INLINE SVG AND NOT RECHARTS (spec Section 71). `recharts@2.15.3` is a declared
 * dependency and has never been imported, and the reason to keep it that way is that
 * **recharts has no candlestick chart**. Building one means a custom `<Bar shape>` or a
 * `Customized` component — writing this SVG anyway — while carrying ~500 kB into the bundle
 * and fighting its scale model to place the horizontal level lines. The custom-shape work is
 * identical either way, so the dependency buys nothing here.
 *
 * (The `!node_modules/recharts/**` entry in package.json's `build.files` is NOT a packaging
 * bug, incidentally: it sits alongside `react`, `react-dom` and `zustand`, all of which the
 * renderer obviously uses. Vite bundles the renderer into `build/`, so renderer dependencies
 * are compiled in and never need to exist in node_modules at runtime.)
 *
 * Everything drawn here comes from the engine. Nothing is invented in the renderer — a chart
 * that draws a level the engine did not emit is a lie with axes on it.
 */

const UP = 'var(--green)';
const DOWN = 'var(--red)';

const LEVELS = [
  { key: 'stopLoss', label: 'SL', color: 'var(--red)',   dash: '4 3' },
  { key: 'entryPrice', label: 'ENTRY', color: 'var(--accent)', dash: null },
  { key: 't1Price', label: 'T1', color: 'var(--green)', dash: '6 3' },
  { key: 't2Price', label: 'T2', color: 'var(--green)', dash: '2 4' },
  { key: 't3Price', label: 'T3', color: 'var(--green)', dash: '1 5' },
];

function niceTicks(lo, hi, count = 5) {
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export default function PriceChart({
  bars = [],
  signal = null,
  symbol = '',
  height = 340,
  showVolume = true,
}) {
  const [hover, setHover] = useState(null);

  const W = 900;
  const padL = 8, padR = 62, padT = 10, padB = 22;
  const volH = showVolume ? Math.round(height * 0.18) : 0;
  const priceH = height - padT - padB - volH;

  const model = useMemo(() => {
    const clean = (bars || []).filter(
      b => b && [b.open, b.high, b.low, b.close].every(v => typeof v === 'number' && isFinite(v))
    );
    if (clean.length === 0) return null;

    // The y-scale must contain the LEVELS too, or a stop below the visible range is silently
    // clipped and the chart shows a trade that appears to have no risk.
    let lo = Math.min(...clean.map(b => b.low));
    let hi = Math.max(...clean.map(b => b.high));
    if (signal) {
      for (const { key } of LEVELS) {
        const v = signal[key];
        if (typeof v === 'number' && isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    const span = hi - lo || Math.max(1e-6, Math.abs(hi) * 0.01);
    lo -= span * 0.04;
    hi += span * 0.04;

    const innerW = W - padL - padR;
    const slot = innerW / clean.length;
    const bodyW = Math.max(1, Math.min(11, slot * 0.62));
    const y = v => padT + priceH - ((v - lo) / (hi - lo)) * priceH;
    const x = i => padL + slot * (i + 0.5);

    const maxVol = Math.max(1, ...clean.map(b => Number(b.volume) || 0));
    const vy = v => padT + priceH + volH - (Math.max(0, v) / maxVol) * volH;

    return { clean, lo, hi, slot, bodyW, y, x, vy, maxVol, innerW };
  }, [bars, signal, height, showVolume, priceH, volH]);

  if (!model) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', fontSize: '12px', border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
      }}>
        No bars to draw. Fetch price history for {symbol || 'this symbol'} first.
      </div>
    );
  }

  const { clean, lo, hi, slot, bodyW, y, x, vy } = model;
  const ticks = niceTicks(lo, hi, 5);
  const dateEvery = Math.max(1, Math.round(clean.length / 6));

  // The engine emits `probability` as an integer percent and `entryZoneLow/High` as the band
  // it is actually willing to enter in. Both are drawn as given.
  const zoneLow = signal && typeof signal.entryZoneLow === 'number' ? signal.entryZoneLow : null;
  const zoneHigh = signal && typeof signal.entryZoneHigh === 'number' ? signal.entryZoneHigh : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        role="img"
        aria-label={`Candlestick chart for ${symbol || 'the selected symbol'}, ${clean.length} bars`
          + (signal ? `, with entry, stop-loss and target levels overlaid` : '')}
        onMouseLeave={() => setHover(null)}
      >
        {/* Horizontal grid + price axis */}
        {ticks.map(t => (
          <g key={`t${t}`}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)}
                  stroke="var(--border)" strokeWidth="1" opacity="0.45" />
            <text x={W - padR + 5} y={y(t) + 3.5} fontSize="9" fill="var(--muted)">
              {t >= 1000 ? t.toFixed(0) : t.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Entry zone band — the range the engine will actually enter in, not a decoration */}
        {zoneLow !== null && zoneHigh !== null && (
          <rect x={padL} width={W - padL - padR}
                y={Math.min(y(zoneHigh), y(zoneLow))}
                height={Math.max(1, Math.abs(y(zoneLow) - y(zoneHigh)))}
                fill="var(--accent)" opacity="0.10" />
        )}

        {/* Candles */}
        {clean.map((b, i) => {
          const rising = b.close >= b.open;
          const col = rising ? UP : DOWN;
          const yO = y(b.open), yC = y(b.close);
          const top = Math.min(yO, yC);
          const bodyH = Math.max(1, Math.abs(yC - yO));
          return (
            <g key={i}
               onMouseEnter={() => setHover({ ...b, i })}
               style={{ cursor: 'crosshair' }}>
              {/* A transparent full-height hit area, so hovering does not require pixel
                  accuracy on a 1px wick. */}
              <rect x={x(i) - slot / 2} y={padT} width={slot} height={priceH + volH}
                    fill="transparent" />
              <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)}
                    stroke={col} strokeWidth="1" />
              <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bodyH}
                    fill={rising ? 'none' : col} stroke={col} strokeWidth="1" />
            </g>
          );
        })}

        {/* Volume */}
        {showVolume && clean.map((b, i) => {
          const v = Number(b.volume) || 0;
          if (v <= 0) return null;
          const top = vy(v);
          return (
            <rect key={`v${i}`} x={x(i) - bodyW / 2} y={top}
                  width={bodyW} height={Math.max(0, padT + priceH + volH - top)}
                  fill={b.close >= b.open ? UP : DOWN} opacity="0.28" />
          );
        })}
        {showVolume && (
          <line x1={padL} x2={W - padR} y1={padT + priceH} y2={padT + priceH}
                stroke="var(--border)" strokeWidth="1" />
        )}

        {/* Signal levels */}
        {signal && LEVELS.map(({ key, label, color, dash }) => {
          const v = signal[key];
          if (typeof v !== 'number' || !isFinite(v)) return null;
          return (
            <g key={key}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)}
                    stroke={color} strokeWidth="1.25"
                    strokeDasharray={dash || undefined} opacity="0.9" />
              <text x={padL + 3} y={y(v) - 3} fontSize="9" fill={color} fontWeight="700">
                {label} {v >= 1000 ? v.toFixed(0) : v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Date axis */}
        {clean.map((b, i) => (
          i % dateEvery === 0 ? (
            <text key={`d${i}`} x={x(i)} y={height - 6} fontSize="8.5"
                  fill="var(--muted)" textAnchor="middle">
              {String(b.date || '').slice(2)}
            </text>
          ) : null
        ))}

        {/* Crosshair */}
        {hover && (
          <line x1={x(hover.i)} x2={x(hover.i)} y1={padT} y2={padT + priceH + volH}
                stroke="var(--text-dim)" strokeWidth="0.75" strokeDasharray="2 3" />
        )}
      </svg>

      {/* Readout. A div rather than an SVG tooltip so it inherits the app's text styling and
          can be read by a screen reader as live text. */}
      <div aria-live="polite" style={{
        display: 'flex', gap: '14px', flexWrap: 'wrap',
        padding: '6px 10px', fontSize: '10.5px',
        color: hover ? 'var(--text)' : 'var(--muted)',
        borderTop: '1px solid var(--border)',
      }}>
        {hover ? (
          <>
            <span style={{ color: 'var(--text-dim)' }}>{hover.date}</span>
            <span>O {hover.open}</span>
            <span>H {hover.high}</span>
            <span>L {hover.low}</span>
            <span style={{ color: hover.close >= hover.open ? UP : DOWN, fontWeight: 700 }}>
              C {hover.close}
            </span>
            {Number(hover.volume) > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                V {Number(hover.volume).toLocaleString()}
              </span>
            )}
          </>
        ) : (
          <span>
            {clean.length} bars, {clean[0].date} → {clean[clean.length - 1].date}
            {signal ? ' — hover a candle for its values' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
