import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries,
  createSeriesMarkers, CrosshairMode, LineStyle,
} from 'lightweight-charts';

/**
 * PriceChart — candlesticks, master's own fills, his levels, and the projection cone.
 *
 * WHY THIS REPLACED THE INLINE SVG (spec Section 79). The previous chart rendered
 * `viewBox="0 0 900 h"` with `preserveAspectRatio="none"` at `width: 100%`, which stretches the
 * whole drawing horizontally to fit the container. At any width other than exactly 900px — that
 * is, always — glyphs distorted, `strokeWidth="1"` stopped being one pixel, and candle bodies
 * widened independently of their height. It also had no zoom or pan, so the 4,649 daily bars in
 * the store rendered as a smear at 0.19px per slot, and it mounted one React mouse handler per
 * candle.
 *
 * Section 71's decision was against RECHARTS, and it still holds: recharts has no candlestick
 * primitive, so using it means writing the custom SVG anyway. That reasoning was about recharts.
 * `lightweight-charts` is TradingView's charting core — candles, panes, price lines, markers,
 * zoom and crosshair are what it is made of. Section 71 is superseded on its own terms.
 *
 * Everything drawn comes from the engine. A chart that draws a level the engine did not emit is
 * a lie with axes on it.
 */

// The library's licence requires this notice to stay visible. It is not decoration to strip.
const ATTRIBUTION_URL = 'https://www.tradingview.com';

const SIGNAL_LEVELS = [
  { key: 'stopLoss',   label: 'SL',    varName: '--red',    style: LineStyle.Dashed },
  { key: 'entryPrice', label: 'ENTRY', varName: '--accent', style: LineStyle.Solid },
  { key: 't1Price',    label: 'T1',    varName: '--green',  style: LineStyle.Dashed },
  { key: 't2Price',    label: 'T2',    varName: '--green',  style: LineStyle.Dotted },
  { key: 't3Price',    label: 'T3',    varName: '--green',  style: LineStyle.Dotted },
];

/**
 * INTRADAY STAMPS BECOME UTC EPOCH SECONDS; DAILY STAYS A DATE STRING.
 *
 * lightweight-charts treats a 'YYYY-MM-DD' string as a whole day, so handing it intraday bars as
 * strings collapses every bar in a session onto one point — the same defect class Section 73
 * fixed inside the store. The store keeps intraday stamps in UTC (03:45:00 is the 09:15 IST
 * open), so this is a parse rather than a guess.
 */
function toChartTime(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.length <= 10) return s.slice(0, 10);
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function readTheme(el) {
  const cs = getComputedStyle(el);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    green:  get('--green', '#26a69a'),
    red:    get('--red', '#ef5350'),
    accent: get('--accent', '#4c8dff'),
    text:   get('--text', '#d1d4dc'),
    muted:  get('--muted', '#787b86'),
    border: get('--border', '#2a2e39'),
    bg:     get('--panel', 'transparent'),
  };
}

export default function PriceChart({
  bars = [],
  signal = null,
  symbol = '',
  height = 380,
  showVolume = true,
  fills = [],
  thesis = null,
  cone = null,
  interval = '1d',
  onReady = null,
}) {
  const holder = useRef(null);
  const chartRef = useRef(null);
  const priceRef = useRef(null);
  const volRef = useRef(null);
  const coneRefs = useRef({});
  const markersRef = useRef(null);
  const linesRef = useRef([]);
  const [readout, setReadout] = useState(null);
  const [layers, setLayers] = useState({ fills: true, levels: true, cone: true });

  const candles = useMemo(() => (bars || [])
    .map((b) => {
      const time = toChartTime(b?.date);
      if (time === null) return null;
      if (![b.open, b.high, b.low, b.close].every(finite)) return null;
      return { time, open: b.open, high: b.high, low: b.low, close: b.close };
    })
    .filter(Boolean)
    // The library requires ascending, de-duplicated times.
    .filter((c, i, a) => i === 0 || String(c.time) !== String(a[i - 1].time)),
  [bars]);

  const volumes = useMemo(() => (bars || [])
    .map((b) => {
      const time = toChartTime(b?.date);
      const v = Number(b?.volume);
      if (time === null || !Number.isFinite(v) || v <= 0) return null;
      return { time, value: v, up: b.close >= b.open };
    })
    .filter(Boolean)
    .filter((c, i, a) => i === 0 || String(c.time) !== String(a[i - 1].time)),
  [bars]);

  // ── Create once. Recreating per render would throw away master's zoom on every poll. ──
  useEffect(() => {
    if (!holder.current) return undefined;
    const theme = readTheme(holder.current);
    const chart = createChart(holder.current, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: theme.muted,
        fontSize: 10,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: theme.border, style: LineStyle.Dotted },
        horzLines: { color: theme.border, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 6,
        timeVisible: String(interval || '').match(/m|h/i) !== null,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: true,
      handleScale: true,
      autoSize: false,
    });

    const price = chart.addSeries(CandlestickSeries, {
      upColor: theme.green, downColor: theme.red,
      borderUpColor: theme.green, borderDownColor: theme.red,
      wickUpColor: theme.green, wickDownColor: theme.red,
      priceLineVisible: true, lastValueVisible: true,
    });

    let vol = null;
    if (showVolume) {
      vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        lastValueVisible: false, priceLineVisible: false,
      });
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false,
      });
    }

    chartRef.current = chart;
    priceRef.current = price;
    volRef.current = vol;

    // A ResizeObserver rather than a fixed width, which is the whole point of the rewrite.
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect?.width || 0);
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(holder.current);
    chart.applyOptions({ width: holder.current.clientWidth || 600 });

    chart.subscribeCrosshairMove((param) => {
      if (!param?.time || !param.seriesData) { setReadout(null); return; }
      const bar = param.seriesData.get(price);
      if (!bar) { setReadout(null); return; }
      const v = vol ? param.seriesData.get(vol) : null;
      setReadout({ ...bar, volume: v?.value ?? null, time: param.time });
    });

    if (onReady) onReady(chart);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volRef.current = null;
      coneRefs.current = {};
      markersRef.current = null;
      linesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, showVolume, interval]);

  // ── Bars ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const price = priceRef.current;
    const chart = chartRef.current;
    if (!price || !chart) return;
    price.setData(candles);
    if (volRef.current) {
      const theme = holder.current ? readTheme(holder.current) : null;
      volRef.current.setData(volumes.map((v) => ({
        time: v.time, value: v.value,
        color: theme ? `${v.up ? theme.green : theme.red}66` : undefined,
      })));
    }
    if (candles.length) chart.timeScale().fitContent();
  }, [candles, volumes]);

  // ── Master's own fills, as arrows on the bars they happened on ─────────────
  useEffect(() => {
    const price = priceRef.current;
    if (!price || !holder.current) return;
    const theme = readTheme(holder.current);
    const marks = (layers.fills ? (fills || []) : [])
      .map((f) => {
        const time = toChartTime(f?.date);
        if (time === null) return null;
        const buy = String(f.side).toUpperCase() === 'BUY';
        return {
          time,
          position: buy ? 'belowBar' : 'aboveBar',
          color: buy ? theme.green : theme.red,
          shape: buy ? 'arrowUp' : 'arrowDown',
          text: `${buy ? 'B' : 'S'} ${f.quantity ?? ''}@${f.price ?? ''}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.time > b.time ? 1 : a.time < b.time ? -1 : 0));

    if (!markersRef.current) {
      markersRef.current = createSeriesMarkers(price, marks);
    } else {
      markersRef.current.setMarkers(marks);
    }
  }, [fills, layers.fills]);

  // ── Levels: the signal's, and master's own thesis ──────────────────────────
  useEffect(() => {
    const price = priceRef.current;
    if (!price || !holder.current) return;
    for (const l of linesRef.current) {
      try { price.removePriceLine(l); } catch { /* already gone with the series */ }
    }
    linesRef.current = [];
    if (!layers.levels) return;
    const theme = readTheme(holder.current);

    const add = (value, title, color, style) => {
      if (!finite(value)) return;
      linesRef.current.push(price.createPriceLine({
        price: value, color, lineWidth: 1, lineStyle: style,
        axisLabelVisible: true, title,
      }));
    };

    if (signal) {
      for (const { key, label, varName, style } of SIGNAL_LEVELS) {
        add(signal[key], label, theme[varName.replace('--', '')] || theme.accent, style);
      }
    }
    // Master's declared levels are drawn thicker than a signal's suggestion: they are what he
    // committed to, and Section 75 treats them as the strongest evidence class there is.
    if (thesis) {
      if (finite(thesis.stopPrice)) {
        linesRef.current.push(price.createPriceLine({
          price: thesis.stopPrice, color: theme.red, lineWidth: 2,
          lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'YOUR STOP',
        }));
      }
      if (finite(thesis.targetPrice)) {
        linesRef.current.push(price.createPriceLine({
          price: thesis.targetPrice, color: theme.green, lineWidth: 2,
          lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'YOUR TARGET',
        }));
      }
    }
  }, [signal, thesis, layers.levels, candles.length]);

  // ── The projection cone ───────────────────────────────────────────────────
  //
  // DASHED AND GREY WHILE THE CENTRE IS UNTILTED. The visual weight tracks the evidence, so an
  // unvalidated projection cannot look authoritative. Only a gate-cleared cone gets the accent.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !holder.current) return;
    for (const s of Object.values(coneRefs.current)) {
      try { chart.removeSeries(s); } catch { /* already disposed */ }
    }
    coneRefs.current = {};

    const points = cone?.points || [];
    if (!layers.cone || !cone?.ok || points.length === 0) return;
    const theme = readTheme(holder.current);
    const tilted = !!cone.tilted;
    const bandColor = tilted ? theme.accent : theme.muted;

    const anchorTime = toChartTime(cone.anchor?.time);
    const anchorPrice = cone.anchor?.price;
    const seed = (finite(anchorPrice) && anchorTime !== null)
      ? [{ time: anchorTime, value: anchorPrice }] : [];

    const build = (field, width, style, color) => {
      const data = seed.concat(points
        .map((p) => {
          const t = toChartTime(p.time);
          return (t === null || !finite(p[field])) ? null : { time: t, value: p[field] };
        })
        .filter(Boolean));
      if (data.length < 2) return;
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle: style,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(data);
      coneRefs.current[field] = s;
    };

    build('upper2', 1, LineStyle.Dotted, `${bandColor}88`);
    build('lower2', 1, LineStyle.Dotted, `${bandColor}88`);
    build('upper1', 1, LineStyle.Dashed, bandColor);
    build('lower1', 1, LineStyle.Dashed, bandColor);
    // The centre only earns a visible line when a model was allowed to move it. A flat centre is
    // just the last price extended, and drawing it boldly would imply a forecast of no change.
    build('mid', tilted ? 2 : 1, tilted ? LineStyle.Solid : LineStyle.Dotted,
      tilted ? theme.accent : `${theme.muted}55`);
  }, [cone, layers.cone, candles.length]);

  const empty = candles.length === 0;
  const toggle = (k) => setLayers((s) => ({ ...s, [k]: !s[k] }));

  const chipStyle = (on) => ({
    padding: '2px 8px', fontSize: '10px', borderRadius: '999px', cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
    color: on ? 'var(--accent)' : 'var(--muted)',
  });

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
        padding: '0 0 6px', fontSize: '10px', color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--text)', fontSize: '11px' }}>{symbol}</strong>
        <span>{interval}</span>
        <span>{candles.length} bars</span>
        <span style={{ flex: 1 }} />
        {(fills || []).length > 0 && (
          <button type="button" onClick={() => toggle('fills')} style={chipStyle(layers.fills)}
                  aria-pressed={layers.fills}>
            your fills ({fills.length})
          </button>
        )}
        {(signal || thesis) && (
          <button type="button" onClick={() => toggle('levels')} style={chipStyle(layers.levels)}
                  aria-pressed={layers.levels}>
            levels
          </button>
        )}
        {cone?.ok && (
          <button type="button" onClick={() => toggle('cone')} style={chipStyle(layers.cone)}
                  aria-pressed={layers.cone}>
            projection {cone.tilted ? '' : '(flat)'}
          </button>
        )}
      </div>

      {empty ? (
        <div style={{
          height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', fontSize: '12px', border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)', textAlign: 'center', padding: '0 16px',
        }}>
          No bars to draw. Fetch price history for {symbol || 'this symbol'} first.
        </div>
      ) : (
        <div ref={holder} style={{ width: '100%', height }}
             role="img"
             aria-label={`Candlestick chart for ${symbol || 'the selected symbol'}, `
               + `${candles.length} ${interval} bars`
               + (fills?.length ? `, with ${fills.length} of your own fills marked` : '')
               + (cone?.ok ? ', with a volatility projection drawn forward' : '')} />
      )}

      <div aria-live="polite" style={{
        display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '6px 2px',
        fontSize: '10.5px', color: readout ? 'var(--text)' : 'var(--muted)',
        borderTop: '1px solid var(--border)',
      }}>
        {readout ? (
          <>
            <span>O {readout.open}</span>
            <span>H {readout.high}</span>
            <span>L {readout.low}</span>
            <span style={{
              color: readout.close >= readout.open ? 'var(--green)' : 'var(--red)',
              fontWeight: 700,
            }}>C {readout.close}</span>
            {finite(readout.volume) && <span>V {readout.volume.toLocaleString()}</span>}
          </>
        ) : (
          <span>Scroll to zoom, drag to pan. Hover a candle for its values.</span>
        )}
      </div>

      {cone?.ok && layers.cone && (
        <div style={{
          fontSize: '10px', color: 'var(--muted)', padding: '4px 2px', lineHeight: 1.5,
        }}>
          {cone.summary?.text}{' '}
          <span style={{ color: cone.tilted ? 'var(--accent)' : 'var(--text-dim)' }}>
            {cone.tiltReason}
          </span>
        </div>
      )}

      {/* Required by the charting library's licence. */}
      <div style={{ fontSize: '9px', color: 'var(--muted)', padding: '2px' }}>
        Charting by{' '}
        <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer"
           style={{ color: 'var(--muted)' }}>TradingView Lightweight Charts</a>
      </div>
    </div>
  );
}
