import React from 'react';
import { SCREEN_DATA } from './screenMapData.js';

/**
 * ScreenMap — annotated layout maps of each StockMind screen (spec Section 104).
 *
 * MASTER ASKED FOR SCREENSHOTS. THESE ARE SCHEMATICS, NOT SCREENSHOTS — and the substitution is
 * deliberate rather than a shortcut, so it is stated here and, more importantly, in the panel itself
 * where master will actually read it.
 *
 *   - A screenshot cannot be captured from inside the renderer without a screen-capture permission and
 *     a running window, and nothing in this build has been run with a shell.
 *   - A screenshot goes stale on the next restyle and then actively misleads, while nothing in the
 *     toolchain can notice — the same drift class as a stale ledger row.
 *   - A schematic can carry NUMBERED CALLOUTS that point at glossary terms. A screenshot cannot,
 *     without being re-annotated by hand every time.
 *
 * So each map mirrors the real arrangement of the real component — same regions, same order, same
 * relative sizes — with numbered callouts listed beneath it. If the layout changes, the map is wrong
 * in the same way a comment can be wrong, and it lives next to the component it describes.
 *
 * Drawn as inline SVG with a `viewBox` and no fixed width, so it scales with the panel and stays crisp
 * at any zoom — which is exactly what Section 79 said the old hand-rolled SVG chart got wrong, applied
 * correctly this time: `preserveAspectRatio` is left at its default so nothing is stretched.
 */

const C = {
  bg: 'var(--surface, #0e1116)',
  panel: 'var(--panel, #161a22)',
  line: 'var(--border, #2a2e39)',
  text: 'var(--text, #d1d4dc)',
  dim: 'var(--muted, #787b86)',
  accent: 'var(--accent, #4c8dff)',
  green: 'var(--green, #26a69a)',
  red: 'var(--red, #ef5350)',
  amber: 'var(--amber, #ffb74d)',
};

function Box({ x, y, w, h, label, fill, stroke, dashed }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="3"
            fill={fill || C.panel} stroke={stroke || C.line}
            strokeDasharray={dashed ? '3 3' : undefined} />
      {label && (
        <text x={x + 6} y={y + 13} fontSize="9" fill={C.dim} fontFamily="inherit">{label}</text>
      )}
    </g>
  );
}

function Pin({ x, y, n }) {
  return (
    <g>
      <circle cx={x} cy={y} r="7.5" fill={C.accent} />
      <text x={x} y={y + 3.2} fontSize="9" fontWeight="700" fill="#06080c"
            textAnchor="middle" fontFamily="inherit">{n}</text>
    </g>
  );
}

/** Little candle cluster, so a chart region reads as a chart rather than as an empty rectangle. */
function Candles({ x, y, w, h }) {
  const bars = [];
  const n = 22;
  const step = w / n;
  for (let i = 0; i < n; i += 1) {
    const mid = y + h * (0.55 + 0.32 * Math.sin(i / 2.4) - 0.12 * Math.cos(i / 1.6));
    const body = Math.max(3, h * (0.07 + 0.05 * Math.abs(Math.sin(i / 1.3))));
    const up = Math.sin(i / 2.4) >= Math.cos(i / 1.6);
    const cx = x + step * i + step / 2;
    bars.push(
      <g key={i}>
        <line x1={cx} y1={mid - body} x2={cx} y2={mid + body * 1.6}
              stroke={up ? C.green : C.red} strokeWidth="1" />
        <rect x={cx - step * 0.28} y={mid - body / 2} width={step * 0.56} height={body}
              fill={up ? C.green : C.red} />
      </g>,
    );
  }
  return <g>{bars}</g>;
}

// ── CHART tab ────────────────────────────────────────────────────────────────
function ChartMap() {
  return (
    <svg viewBox="0 0 640 300" role="img" style={{ width: '100%', height: 'auto' }}
         aria-label="Layout map of the CHART tab: identity and last price along the top, then the
interval row, the window row, the presentation row, the plot with volume beneath it, and the legend
and status strip at the bottom.">
      <rect x="0" y="0" width="640" height="300" rx="4" fill={C.bg} stroke={C.line} />

      <Box x={10} y={10} w={620} h={22} />
      <text x={18} y={25} fontSize="11" fontWeight="700" fill={C.text} fontFamily="inherit">NIFTY50</text>
      <text x={78} y={25} fontSize="9" fill={C.dim} fontFamily="inherit">1D · 1Y</text>
      <text x={128} y={25} fontSize="11" fontWeight="700" fill={C.text} fontFamily="inherit">24,312.55</text>
      <text x={196} y={25} fontSize="10" fill={C.green} fontFamily="inherit">+118.20 (+0.49%)</text>
      <text x={300} y={25} fontSize="9" fill={C.dim} fontFamily="inherit">252 bars</text>
      <Box x={470} y={13} w={72} h={16} />
      <text x={478} y={24} fontSize="8" fill={C.dim} fontFamily="inherit">reset zoom</text>
      <Box x={548} y={13} w={74} h={16} />
      <text x={556} y={24} fontSize="8" fill={C.dim} fontFamily="inherit">fullscreen</text>
      <Pin x={22} y={44} n={1} />

      {[['1m', 40], ['2m', 76], ['5m', 112], ['15m', 148], ['30m', 190], ['1H', 232],
        ['1D', 278], ['1W', 314], ['1M', 350]].map(([l, x]) => (
          <g key={l}>
            <rect x={x} y={38} width={l === '1D' ? 32 : 30} height={16} rx="2"
                  fill={l === '1D' ? 'rgba(76,141,255,0.18)' : 'transparent'}
                  stroke={l === '1D' ? C.accent : C.line} />
            <text x={x + 6} y={49} fontSize="8" fill={l === '1D' ? C.accent : C.dim}
                  fontFamily="inherit">{l}</text>
          </g>
      ))}
      <text x={400} y={49} fontSize="8" fill={C.dim} fontFamily="inherit">
        intraday · swing · long term
      </text>

      <Pin x={22} y={68} n={2} />
      {[['1M', 40], ['3M', 72], ['6M', 104], ['1Y', 136], ['2Y', 170], ['5Y', 202],
        ['10Y', 234], ['MAX', 272]].map(([l, x]) => (
          <g key={l}>
            <rect x={x} y={62} width={l === 'MAX' ? 34 : 28} height={16} rx="2"
                  fill={l === '1Y' ? 'rgba(76,141,255,0.18)' : 'transparent'}
                  stroke={l === '1Y' ? C.accent : C.line} />
            <text x={x + 5} y={73} fontSize="8" fill={l === '1Y' ? C.accent : C.dim}
                  fontFamily="inherit">{l}</text>
          </g>
      ))}

      <Pin x={22} y={92} n={3} />
      <Box x={40} y={86} w={80} h={16} label="Candles · LOG ▾" />
      <Box x={126} y={86} w={86} h={16} label="indicators (2) ▾" />
      <Box x={420} y={86} w={64} h={16} label="your fills" />
      <Box x={490} y={86} w={54} h={16} label="levels" />
      <Box x={550} y={86} w={72} h={16} label="projection" />

      <Box x={10} y={110} w={620} h={122} fill="rgba(0,0,0,0.25)" />
      <Candles x={24} y={116} w={560} h={82} />
      <line x1={24} y1={150} x2={584} y2={150} stroke={C.accent} strokeWidth="1"
            strokeDasharray="4 3" />
      <text x={588} y={153} fontSize="8" fill={C.accent} fontFamily="inherit">ENTRY</text>
      <line x1={24} y1={182} x2={584} y2={182} stroke={C.red} strokeWidth="1"
            strokeDasharray="4 3" />
      <text x={588} y={185} fontSize="8" fill={C.red} fontFamily="inherit">SL</text>
      <Box x={18} y={116} w={150} h={26} fill="rgba(0,0,0,0.45)" stroke="transparent" />
      <text x={24} y={127} fontSize="8" fill={C.text} fontFamily="inherit">O 24190 H 24355</text>
      <text x={24} y={137} fontSize="8" fill={C.text} fontFamily="inherit">L 24102 C 24312 V 1.2M</text>
      <Pin x={182} y={129} n={4} />
      <Pin x={604} y={129} n={5} />

      <rect x="24" y="204" width="560" height="22" fill="none" />
      {Array.from({ length: 22 }, (_, i) => (
        <rect key={i} x={24 + (560 / 22) * i + 2} y={226 - (6 + 14 * Math.abs(Math.sin(i / 1.9)))}
              width={(560 / 22) - 4} height={6 + 14 * Math.abs(Math.sin(i / 1.9))}
              fill={i % 3 === 0 ? 'rgba(239,83,80,0.4)' : 'rgba(38,166,154,0.4)'} />
      ))}
      <text x={588} y={219} fontSize="8" fill={C.dim} fontFamily="inherit">vol</text>
      <Pin x={604} y={216} n={6} />

      <Box x={10} y={240} w={620} h={20} dashed />
      <text x={18} y={253} fontSize="8.5" fill={C.dim} fontFamily="inherit">
        O 24190  H 24355  L 24102  C 24312  V 1,204,880   — repeated in text for screen readers
      </text>
      <Pin x={22} y={274} n={7} />
      <Box x={40} y={266} w={590} h={20} dashed />
      <text x={48} y={279} fontSize="8.5" fill={C.dim} fontFamily="inherit">
        Keys: 1–5 chart type · L log scale · R reset zoom · F fullscreen
      </text>
    </svg>
  );
}

// ── SIGNALS tab ──────────────────────────────────────────────────────────────
function SignalsMap() {
  return (
    <svg viewBox="0 0 640 250" role="img" style={{ width: '100%', height: 'auto' }}
         aria-label="Layout map of the SIGNALS tab: a header with the data-source badge, a table of
setups with ten columns, and the WHY block beneath the selected row.">
      <rect x="0" y="0" width="640" height="250" rx="4" fill={C.bg} stroke={C.line} />
      <text x={16} y={22} fontSize="10" fontWeight="700" fill={C.text} fontFamily="inherit">
        SIGNALS — NIFTY50 (NSE)
      </text>
      <rect x={178} y={12} width={76} height={14} rx="7" fill="rgba(38,166,154,0.18)" stroke={C.green} />
      <text x={186} y={22} fontSize="8" fill={C.green} fontFamily="inherit">REAL OHLCV</text>
      <rect x={262} y={12} width={82} height={14} rx="7" fill="rgba(255,183,77,0.15)" stroke={C.amber} />
      <text x={270} y={22} fontSize="8" fill={C.amber} fontFamily="inherit">2 SUPPRESSED</text>
      <Pin x={352} y={19} n={1} />

      {['SETUP', 'DIR', 'ENTRY', 'SL', 'T1', 'T2', 'T3', 'R:R', 'PROB', 'GRADE']
        .map((h, i) => (
          <text key={h} x={18 + i * 62} y={46} fontSize="8" fill={C.dim} fontFamily="inherit">{h}</text>
        ))}
      <line x1={12} y1={52} x2={628} y2={52} stroke={C.line} />
      <Pin x={630} y={44} n={2} />

      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x={12} y={56 + r * 22} width={616} height={20}
                fill={r === 0 ? 'rgba(76,141,255,0.10)' : 'transparent'} />
          <text x={18} y={70 + r * 22} fontSize="8.5" fill={C.text} fontFamily="inherit">
            {['tight', 'balanced', 'wide'][r]}
          </text>
          <text x={80} y={70 + r * 22} fontSize="8.5" fill={C.green} fontFamily="inherit">LONG</text>
          {[24312, 24100 - r * 60, 24500 + r * 90, 24700 + r * 140, 24900 + r * 200]
            .map((v, i) => (
              <text key={i} x={142 + i * 62} y={70 + r * 22} fontSize="8.5"
                    fill={i === 1 ? C.red : i > 1 ? C.green : C.text} fontFamily="inherit">
                {v.toLocaleString()}
              </text>
          ))}
          <text x={452} y={70 + r * 22} fontSize="8.5" fill={C.dim} fontFamily="inherit">
            {(1.4 + r * 0.8).toFixed(2)}
          </text>
          <text x={514} y={70 + r * 22} fontSize="8.5" fill={C.text} fontFamily="inherit">
            {62 - r * 7}%
          </text>
          <text x={576} y={70 + r * 22} fontSize="8.5" fill={C.green} fontFamily="inherit">
            {['A', 'B', 'C'][r]}
          </text>
        </g>
      ))}
      <line x1={12} y1={124} x2={628} y2={124} stroke={C.line} />
      <Pin x={22} y={140} n={3} />
      <text x={36} y={143} fontSize="8.5" fill={C.dim} fontFamily="inherit">
        each row is a different risk geometry over ONE prediction · column meanings printed here
      </text>
      <Box x={470} y={132} w={158} h={16} label="show on the chart →" />

      <Box x={12} y={156} w={616} h={82} dashed />
      <text x={20} y={170} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        WHY — balanced
      </text>
      <Pin x={120} y={167} n={4} />
      {['DIRECTIONAL', 'T1/T2/T3', 'SL RISK', 'REGIME', 'AGREEMENT', 'UNCERTAINTY']
        .map((l, i) => (
          <g key={l}>
            <text x={20 + i * 100} y={190} fontSize="7.5" fill={C.dim} fontFamily="inherit">{l}</text>
            <text x={20 + i * 100} y={201} fontSize="9" fill={C.text} fontFamily="inherit">
              {['58%', '62/41/22%', '39%', 'trending', '0.82', '0.031'][i]}
            </text>
          </g>
      ))}
      <text x={20} y={222} fontSize="8.5" fill={C.dim} fontFamily="inherit">
        · momentum positive over 20 bars   · volume above its 20-bar average
      </text>
      <text x={20} y={233} fontSize="8.5" fill={C.dim} fontFamily="inherit">
        Probability basis: ensemble v1.0.0, uncalibrated — no model has cleared the gate
      </text>
    </svg>
  );
}

// ── YOUR BOOK tab ────────────────────────────────────────────────────────────
function BookMap() {
  return (
    <svg viewBox="0 0 640 265" role="img" style={{ width: '100%', height: 'auto' }}
         aria-label="Layout map of the YOUR BOOK tab: actionable alerts first, then withheld readings,
then the portfolio totals, then the open positions table, then the exit form.">
      <rect x="0" y="0" width="640" height="265" rx="4" fill={C.bg} stroke={C.line} />

      <Box x={10} y={10} w={620} h={44} />
      <text x={18} y={24} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        NEEDS YOUR ATTENTION (2)
      </text>
      <line x1={18} y1={30} x2={18} y2={48} stroke={C.red} strokeWidth="2.5" />
      <text x={26} y={38} fontSize="8.5" fill={C.red} fontWeight="700" fontFamily="inherit">CLOSE</text>
      <text x={64} y={38} fontSize="8.5" fill={C.text} fontFamily="inherit">
        RELIANCE is below the stop you recorded
      </text>
      <text x={26} y={48} fontSize="8" fill={C.dim} fontFamily="inherit">
        last 2,388 against your stop of 2,400 · recorded 14 days ago
      </text>
      <Pin x={22} y={66} n={1} />

      <text x={40} y={69} fontSize="8.5" fill={C.dim} fontFamily="inherit">
        show 3 readings Rāma will not act on
      </text>
      <Pin x={22} y={90} n={2} />

      <Box x={10} y={80} w={620} h={40} />
      {['INVESTED', 'MARKET VALUE', 'UNREALISED', 'REALISED', 'NET OF FEES'].map((l, i) => (
        <g key={l}>
          <text x={40 + i * 118} y={96} fontSize="7.5" fill={C.dim} fontFamily="inherit">{l}</text>
          <text x={40 + i * 118} y={108} fontSize="10" fontFamily="inherit"
                fill={i === 2 ? C.green : i === 3 ? C.red : C.text}>
            {['482,400', '491,180', '+8,780', '-1,240', '+7,240'][i]}
          </text>
        </g>
      ))}

      <Box x={10} y={128} w={620} h={72} />
      <text x={18} y={142} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        OPEN POSITIONS (2)
      </text>
      {['SYMBOL', 'STYLE', 'QTY', 'AVG', 'LAST', 'P&L', '%', 'DAYS'].map((h, i) => (
        <text key={h} x={18 + i * 74} y={158} fontSize="7.5" fill={C.dim} fontFamily="inherit">{h}</text>
      ))}
      <Pin x={630} y={155} n={3} />
      {[0, 1].map((r) => (
        <g key={r}>
          <line x1={12} y1={164 + r * 18} x2={628} y2={164 + r * 18} stroke={C.line} />
          <text x={18} y={176 + r * 18} fontSize="8.5" fill={C.accent} fontFamily="inherit"
                textDecoration="underline">{['RELIANCE', 'TCS'][r]}</text>
          <text x={92} y={176 + r * 18} fontSize="8.5" fontFamily="inherit"
                fill={r === 0 ? C.green : C.amber}>
            {['POSITIONAL', 'INTRADAY'][r]}
          </text>
          {[['150', '80'], ['2,400', '3,910'], ['2,388', '3,946'], ['-1,800', '+2,880'],
            ['-0.5%', '+0.9%'], ['14', '6']].map((pair, i) => (
              <text key={i} x={166 + i * 74} y={176 + r * 18} fontSize="8.5" fontFamily="inherit"
                    fill={i >= 3 && i <= 4 ? (r === 0 ? C.red : C.green) : C.text}>
                {pair[r]}
              </text>
          ))}
          <Box x={586} y={168 + r * 18 - 10} w={40} h={14} label="exit…" />
        </g>
      ))}
      <Pin x={604} y={196} n={4} />

      <Box x={10} y={208} w={620} h={48} stroke={C.amber} />
      <text x={18} y={222} fontSize="9" fontWeight="700" fill={C.amber} fontFamily="inherit">
        EXIT RELIANCE — LONG 150 @ 2,400
      </text>
      {['EXIT PRICE', 'QUANTITY', 'DATE', 'FEES'].map((l, i) => (
        <g key={l}>
          <text x={18 + i * 96} y={236} fontSize="7.5" fill={C.dim} fontFamily="inherit">{l}</text>
          <Box x={18 + i * 96} y={239} w={80} h={13} />
        </g>
      ))}
      <text x={410} y={240} fontSize="8.5" fill={C.dim} fontFamily="inherit">This realises</text>
      <text x={470} y={240} fontSize="10" fontWeight="700" fill={C.red} fontFamily="inherit">-1,860</text>
      <text x={410} y={251} fontSize="8" fill={C.amber} fontFamily="inherit">
        At or past your stop of 2,400.
      </text>
      <Pin x={604} y={236} n={5} />
    </svg>
  );
}

// ── STRATEGY tab ─────────────────────────────────────────────────────────────
function StrategyMap() {
  return (
    <svg viewBox="0 0 640 265" role="img" style={{ width: '100%', height: 'auto' }}
         aria-label="Layout map of the STRATEGY tab: block groups, the chosen blocks with parameters and
sweeps, exit and money, the variant count before running, and the verdict.">
      <rect x="0" y="0" width="640" height="265" rx="4" fill={C.bg} stroke={C.line} />

      <Box x={10} y={10} w={620} h={46} />
      <text x={18} y={24} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        BUILD A STRATEGY
      </text>
      {['Trend structure', 'Moving averages', 'Momentum', 'Volatility', 'Breakout', 'Session',
        'Probability ⚠', 'News ⚠'].map((g, i) => (
          <g key={g}>
            <rect x={18 + i * 76} y={32} width={72} height={15} rx="2"
                  fill={i === 0 ? 'rgba(76,141,255,0.18)' : 'transparent'}
                  stroke={i === 0 ? C.accent : C.line} />
            <text x={22 + i * 76} y={42} fontSize="6.5" fontFamily="inherit"
                  fill={i === 0 ? C.accent : i > 5 ? C.amber : C.dim}>{g}</text>
          </g>
      ))}
      <Pin x={22} y={68} n={1} />

      <Box x={10} y={62} w={620} h={56} />
      <text x={40} y={76} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        ENTRY — 2 blocks
      </text>
      <Box x={152} y={66} w={98} h={14} label="all must be true ▾" />
      <Box x={256} y={66} w={58} h={14} label="long ▾" />
      <Box x={18} y={84} w={300} h={28} />
      <text x={24} y={95} fontSize="8" fill={C.text} fontFamily="inherit">
        Higher highs and higher lows
      </text>
      <text x={24} y={106} fontSize="7" fill={C.dim} fontFamily="inherit">span 3 · swings 2</text>
      <Box x={326} y={84} w={300} h={28} />
      <text x={332} y={95} fontSize="8" fill={C.text} fontFamily="inherit">RSI band</text>
      <text x={332} y={106} fontSize="7" fill={C.dim} fontFamily="inherit">
        period 14 · level 30 · below · sweep 20,30,40
      </text>
      <Pin x={618} y={104} n={2} />

      <Box x={10} y={124} w={620} h={38} />
      <text x={18} y={137} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        EXIT AND MONEY
      </text>
      {['STOP %', 'TARGET %', 'MAX BARS', 'CAPITAL', 'RISK / TRADE'].map((l, i) => (
        <g key={l}>
          <text x={18 + i * 122} y={150} fontSize="7.5" fill={C.dim} fontFamily="inherit">{l}</text>
          <Box x={18 + i * 122} y={152} w={98} h={7} />
        </g>
      ))}
      <Pin x={630} y={143} n={3} />

      <Box x={10} y={168} w={620} h={38} stroke={C.amber} />
      <text x={18} y={182} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">
        BEFORE YOU RUN IT
      </text>
      <text x={132} y={182} fontSize="11" fontWeight="700" fill={C.amber} fontFamily="inherit">
        3 variants
      </text>
      <text x={200} y={182} fontSize="8" fill={C.dim} fontFamily="inherit">
        each extra variant raises the result the winner must beat
      </text>
      <Box x={18} y={188} w={144} h={14} label="⚗ Backtest 3 variants" />
      <Box x={170} y={188} w={116} h={14} label="🐍 Generate Python" />
      <Pin x={630} y={187} n={4} />

      <Box x={10} y={212} w={620} h={44} stroke={C.red} />
      <text x={18} y={226} fontSize="9" fontWeight="700" fill={C.text} fontFamily="inherit">VERDICT</text>
      <rect x={70} y={216} width={106} height={14} rx="7" fill="rgba(239,83,80,0.15)" stroke={C.red} />
      <text x={76} y={226} fontSize="8" fill={C.red} fontFamily="inherit">NOT DEMONSTRATED</text>
      <text x={18} y={240} fontSize="8.5" fill={C.text} fontFamily="inherit">
        Net Sharpe 0.84 sounds good, but searching 3 variants would produce about 0.56 from pure noise.
      </text>
      <text x={18} y={251} fontSize="8.5" fill={C.text} fontFamily="inherit">
        Allowing for that, the chance this is a real edge is 71% — short of the 95% required.
      </text>
      <Pin x={630} y={234} n={5} />
    </svg>
  );
}

// The callout TEXT lives in `screenMapData.js`, a plain module with no JSX, so the verify suite can
// import it and check every term id exactly. It was scraped from this file by regex once, and the
// regex could not tell a pin's term id from a column heading inside the SVG — so it reported real
// terms as unreferenced and SVG strings as broken references. Data that needs checking should not be
// embedded in something a checker cannot parse.
const RENDERERS = {
  chart: ChartMap, signals: SignalsMap, book: BookMap, strategy: StrategyMap,
};

export const SCREEN_IDS = Object.keys(SCREEN_DATA);
export const screenMap = (id) => SCREEN_DATA[id] || null;

export default function ScreenMap({ id, onTerm }) {
  const map = SCREEN_DATA[id];
  const Drawing = RENDERERS[id];
  if (!map || !Drawing) return null;
  return (
    <div>
      <div style={{ fontSize: '12.5px', color: 'var(--text-dim, var(--muted))', lineHeight: 1.7,
        marginBottom: '10px', maxWidth: '78ch' }}>
        {map.intro}
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        padding: '8px', background: 'rgba(0,0,0,0.2)' }}>
        <Drawing />
      </div>
      <ol style={{ margin: '12px 0 0', paddingLeft: '0', listStyle: 'none',
        display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {map.pins.map(([title, body, termId], i) => (
          <li key={title} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{
              flexShrink: 0, width: '18px', height: '18px', borderRadius: '50%',
              background: 'var(--accent)', color: '#06080c', fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px',
            }}>{i + 1}</span>
            <span style={{ fontSize: '12.5px', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text)' }}>{title}</strong>
              <span style={{ color: 'var(--text-dim, var(--muted))' }}> — {body}</span>
              {termId && onTerm && (
                <button type="button" onClick={() => onTerm(termId)}
                        style={{ background: 'none', border: 'none', padding: '0 0 0 5px',
                          color: 'var(--accent)', cursor: 'pointer', font: 'inherit' }}>
                  glossary →
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
