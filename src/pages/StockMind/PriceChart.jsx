import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries,
  HistogramSeries, createSeriesMarkers, CrosshairMode, LineStyle, PriceScaleMode,
} from 'lightweight-charts';
import {
  overlaysFor, overlayById, overlayShortfall, heikinAshi, resolveParams, labelFor,
} from './indicators';
import {
  intervalGroups, allRangesFor, shortfallNote, describeLimit, showsClock,
  interval as intervalDef,
} from './timeframes';
import {
  toChartTime, sessionStarts, markerTime, timeTypesMatch,
  makeTickFormatter, makeTimeFormatter, formatStamp, zoneLabel,
} from './chartTime.js';
import {
  zoomPlan, pxPerBar, verifyZoom, rangeForPxPerBar, describeZoom,
  DENSITIES, DEFAULT_DENSITY, densityById, pxForDensity,
} from './chartZoom.js';
import * as DRAW from './chartDrawings.js';
import { createDrawingLayer } from './ChartDrawingLayer.js';
import { sessionBands, describeBands } from './chartSessions.js';
import { createSessionLayer } from './ChartSessionLayer.js';
import { emptyState } from './chartEmptyState.js';
import InfoTip from './InfoTip.jsx';

/**
 * PriceChart — candles, master's own fills, his levels, and the projection cone.
 *
 * Built on `lightweight-charts`, which supersedes Section 71's case against recharts on its own terms:
 * recharts has no candlestick primitive, so it meant hand-writing SVG anyway. The hand-written SVG it
 * replaced (Section 79) stretched at any width but 900px and had no zoom, so 4,649 bars were a smear.
 *
 * THE RULE (Sections 101, 103): the renderer may draw any pure function of the visible bars; anything
 * forward-looking, model-derived or advisory comes from the engine. Indicators are arithmetic on what is
 * already on screen; the cone and the signal levels are claims. See `indicators.js`.
 *
 * Defects closed here and worth not reintroducing:
 *   - the timeframe control offered 2 of 9 intervals while the engine supported all of them
 *   - `fitContent()` ran on every data change, so every poll threw away master's zoom
 *   - volume rode an overlay price scale instead of its own pane, costing price a quarter of the height
 *   - there was no chart type, no log or percent scale, and no overlays
 *   - the crosshair readout sat 400px below the candle it described
 *   - a slow fetch rendered "no bars — fetch history first", advice to do what was already in flight
 */

// The library's licence requires this notice to stay visible. It is not decoration to strip.
const ATTRIBUTION_URL = 'https://www.tradingview.com';

const PREFS_KEY = 'rama.stockmind.chart';

/** Next paint, or the next tick where there is no compositor (a test, a hidden tab). */
const frame = (fn) => (typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(fn) : setTimeout(fn, 0));

/**
 * The width of the PLOT AREA, not of the container — and the difference is a real defect (Section 122).
 *
 * `clientWidth` includes the price scale: sixty to seventy pixels of axis that no candle is ever drawn
 * in. Every width-derived candle calculation in Sections 110 and 119 used it, so each one overstated the
 * result by about 8% at 900px, and "correcting" a visible range against an overstated width applies a
 * systematically wrong zoom rather than fixing one. `timeScale().width()` is the axis's own width, which
 * is exactly the span the visible logical range covers.
 *
 * The container is kept as a fallback, because a slightly wrong width beats no measurement at all.
 */
function plotWidth(chart, holderEl) {
  try {
    const w = chart?.timeScale?.()?.width?.();
    if (Number.isFinite(w) && w > 0) return w;
  } catch { /* before the first layout there is no axis yet */ }
  return holderEl?.clientWidth || 0;
}

/**
 * READ the candle width off the live chart and report it. Measurement only — it changes nothing.
 *
 * This is the piece Sections 110 and 119 were both missing. Neither ever asked the chart what the
 * candle width had become, so a zoom that did not take looked exactly like one that did, and three
 * sections were spent adjusting a number that was never being honoured.
 */
function measureZoom(chart, count, holderEl, report, note = null) {
  if (!chart || !report) return;
  const width = plotWidth(chart, holderEl);
  let range = null;
  try { range = chart.timeScale().getVisibleLogicalRange(); }
  catch { range = null; }
  const actual = pxPerBar(range, width);
  report({ actual, width, count, text: describeZoom(actual, count, width), note });
}

/**
 * Apply the default zoom, then CHECK THAT IT TOOK, and correct it once if it did not.
 *
 * The decision — how wide a candle should be — lives in `chartZoom.js`, tested. This carries it out
 * and verifies it, which is the whole of Section 122:
 *
 *   1. set `barSpacing`, the library's own unit for pixels between bar centres;
 *   2. **wait a frame.** `setData` moves the visible range itself and the time scale settles
 *      asynchronously, so a read-back in this tick reads a range that is about to be replaced. The
 *      library's maintainers describe the correct sequence as change, wait, then read;
 *   3. measure the actual width from the visible logical range and the pane width;
 *   4. if it drifted outside tolerance, set the range explicitly — which does hold — and measure again.
 *
 * There is NO `fitContent()` fallback. Both previous attempts had one, and it restored precisely the
 * squeeze-everything-in behaviour being replaced, silently, so the fix looked applied when it was not.
 * A failure is warned about and reported instead.
 *
 * ONE DEFINITION — the data effect, the density control and `reset zoom` all call this. Two copies of
 * the arithmetic is how they drift apart, and Section 110 had two.
 */
function applyLegibleZoom(chart, count, holderEl, targetPx, report) {
  if (!chart) return;
  const plan = zoomPlan(count, targetPx);
  if (plan.mode === 'none') return;
  const target = plan.barSpacing;
  const ts = chart.timeScale();

  try {
    ts.applyOptions({ barSpacing: target });
    ts.scrollToRealTime();
  } catch (err) {
    console.warn(`[PriceChart] the candle width could not be set: ${err.message}`);
    measureZoom(chart, count, holderEl, report, `the ${target}px candle width was refused`);
    return;
  }

  const settle = (correctionsLeft) => {
    const width = plotWidth(chart, holderEl);
    let range = null;
    try { range = ts.getVisibleLogicalRange(); }
    catch { range = null; }
    const check = verifyZoom(range, width, target);

    if (check.ok) { measureZoom(chart, count, holderEl, report); return; }
    if (correctionsLeft <= 0 || check.actual === null) {
      // Said out loud rather than left as "it still looks wrong". If this ever appears on master's
      // machine it names both numbers, which is the diagnosis Sections 110 and 119 never had.
      console.warn(`[PriceChart] zoom unverified: ${check.why}`);
      measureZoom(chart, count, holderEl, report, check.why);
      return;
    }

    const want = rangeForPxPerBar(count, width, target);
    if (!want) { measureZoom(chart, count, holderEl, report, check.why); return; }
    try { ts.setVisibleLogicalRange(want); }
    catch (err) {
      console.warn(`[PriceChart] zoom correction refused: ${err.message}`);
      measureZoom(chart, count, holderEl, report, check.why);
      return;
    }
    frame(() => settle(correctionsLeft - 1));
  };

  frame(() => settle(1));
}

const SIGNAL_LEVELS = [
  { key: 'stopLoss',   label: 'SL',    varName: '--red',    style: LineStyle.Dashed },
  { key: 'entryPrice', label: 'ENTRY', varName: '--accent', style: LineStyle.Solid },
  { key: 't1Price',    label: 'T1',    varName: '--green',  style: LineStyle.Dashed },
  { key: 't2Price',    label: 'T2',    varName: '--green',  style: LineStyle.Dotted },
  { key: 't3Price',    label: 'T3',    varName: '--green',  style: LineStyle.Dotted },
];

/**
 * The chart types worth having, and what each is FOR.
 *
 * This is not a styling menu. At 2,500 bars a candle is under a pixel wide and the OHLC information
 * candles exist to carry is gone, so a ten-year view is strictly better as a line — and a baseline
 * chart anchored on master's average cost answers "am I up or down on this position" without any
 * arithmetic. Offering only candles meant the long views were unreadable.
 */
const CHART_TYPES = [
  { id: 'candles',  label: 'Candles',  key: '1' },
  { id: 'bars',     label: 'Bars',     key: '2' },
  { id: 'line',     label: 'Line',     key: '3' },
  { id: 'area',     label: 'Area',     key: '4' },
  { id: 'baseline', label: 'Baseline', key: '5' },
  // HEIKIN-ASHI IS A LENS, AND THE WARNING IS IN THE TITLE (Section 120). Its open and close are
  // averages, so they are prices that never traded — excellent for reading whether a trend is intact,
  // useless as a source of levels. A stop read off an HA body is a stop at a fictional price.
  { id: 'heikin',   label: 'Heikin-Ashi', key: '6',
    warn: 'Smoothed: HA open and close are averages, not traded prices. Read direction from it, never '
      + 'levels — a stop taken off an HA body sits at a price that never existed.' },
];

const SCALE_MODES = [
  { id: 'normal', label: 'LIN', mode: PriceScaleMode.Normal,
    title: 'Linear price scale' },
  { id: 'log',    label: 'LOG', mode: PriceScaleMode.Logarithmic,
    title: 'Logarithmic — equal percentage moves get equal height. The honest scale for a '
      + 'multi-year view, where a linear axis makes the recent years look like all the movement.' },
  { id: 'pct',    label: '%',   mode: PriceScaleMode.Percentage,
    title: 'Percentage from the first visible bar — for reading the size of a move rather than '
      + 'its price.' },
];

// INTRADAY STAMPS BECOME UTC EPOCH SECONDS; DAILY STAYS A DATE STRING — and that lives in
// `chartTime.js` now, tested, because the one function producing two types is what allowed two
// separate defects: the projection cone and master's fills (Section 117). Redefining it here is
// precisely what kept the rule implicit.

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const todayYmd = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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
    amber:  get('--amber', '#ffb74d'),
    text:   get('--text', '#d1d4dc'),
    muted:  get('--muted', '#787b86'),
    border: get('--border', '#2a2e39'),
    bg:     get('--panel', 'transparent'),
  };
}

// Overlay colours are assigned from a fixed list rather than from the theme, because two moving
// averages that both read `--accent` are indistinguishable, which is the one thing an overlay must
// not be. Chosen to stay apart from the green/red the candles own.
const OVERLAY_COLORS = ['#4c8dff', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581'];

function loadPrefs() {
  try {
    const raw = window.localStorage?.getItem(PREFS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (!p || typeof p !== 'object') return null;
    return p;
  } catch {
    // A corrupt preference must never stop the chart drawing.
    return null;
  }
}

function savePrefs(p) {
  try {
    window.localStorage?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch { /* private mode, quota, or no storage — the chart still works */ }
}

const numberFmt = (v) => (finite(v)
  ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  : '—');

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
  // ── Added by Section 101, all optional so every existing call site keeps working (I11) ──
  busy = false,             // a fetch is in flight; distinct from "there is nothing"
  onFetch = null,           // lets the empty state perform the fix it names
  rangeId = null,           // the lookback preset, or null when the dates are custom
  onInterval = null,        // supplying these renders the timeframe strip on the chart
  onRange = null,
  fromDate = null,          // the window as dates (Section 105) — the bar count was removed
  toDate = null,
  onDates = null,           // (from, to) => void; omit to hide the date pickers
  coverage = null,          // {first, last, stored} from the reply, so the picker has real bounds
  chartId = 'chart',        // so two charts on one screen do not share input ids
  basePrice = null,         // master's average cost, for the baseline chart's zero line
  // ── Section 121 ──
  fillHeight = false,       // size to the container instead of the `height` prop — for a resizable panel
  onDrawingsChange = null,  // notified when master adds or removes a mark, for a count elsewhere
  /**
   * ── Section 129: what the reply already said, carried to the canvas ──
   *
   * Both optional and both defaulting to null, so the existing call sites keep working (I11). These are
   * fields the ohlcv reply ACTUALLY carries today — `res.data.note` and, on `ok === false`, the gate
   * object the bridge returns verbatim. `meta` and `syncInfo` are deliberately NOT props: the route
   * sends them, but nothing here has a use for them yet, and a prop no renderer reads is a contract
   * waiting to be believed.
   */
  // NOT `note`: this component already has a `note` state for the inline note editor, and shadowing it
  // is a parse error the renderer audit catches. `replyNote` says whose sentence it is.
  replyNote = null,         // the route's own sentence about THIS reply (`res.data.note`)
  failure = null,           // {error, diagnosis:{reason, remedy}, detail, stderrTail} — all failure modes
}) {
  const holder = useRef(null);
  const chartRef = useRef(null);
  const priceRef = useRef(null);
  const volRef = useRef(null);
  const coneRefs = useRef({});
  const overlayRefs = useRef([]);
  const markersRef = useRef(null);
  const linesRef = useRef([]);
  const fitKeyRef = useRef(null);
  const savedRangeRef = useRef(null);
  // The zoom target and the bar count as refs, so the effects that need the LATEST value can read it
  // without listing it as a dependency — listing `density` on the data effect would re-`setData` every
  // bar in the series each time master nudged the candle width.
  const targetPxRef = useRef(null);
  const countRef = useRef(0);
  const lastPxRef = useRef(null);

  // ── Session shading (Section 123) ──────────────────────────────────────────
  // The second primitive, and it gets its own ref pair for the same reason the first has one: the
  // layer reads live state on every draw, so nothing here is re-attached when the bands change.
  const sessionLayerRef = useRef(null);
  const sessionStateRef = useRef({});

  // ── Drawings (Section 121) ─────────────────────────────────────────────────
  const shellRef = useRef(null);
  const layerRef = useRef(null);
  const drawStateRef = useRef({});
  const draftRef = useRef(null);
  const [tool, setTool] = useState(null);            // null means the crosshair, not a tool
  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [measured, setMeasured] = useState(null);

  /**
   * DRAGGING AND RESHAPING AN EXISTING MARK (Section 123).
   *
   * `editing` is a WORKING COPY of the drawing under the pointer, and nothing else sees it: the stored
   * list is left alone until the mouse comes up, so one drag is one commit and one `DRAW.save` rather
   * than one per mouse-move event. Escape mid-drag drops the copy and the stored mark stands, because a
   * half-dragged line is not a claim master made.
   *
   * `drawingsRef` is the STORED list for the pointer handlers — whose anchors are absolute epoch
   * seconds — while `drawStateRef` carries the placed copies the layer draws. Those are two different
   * time types on purpose (Section 118), and mixing them is exactly the defect the split prevents.
   */
  const [editing, setEditing] = useState(null);
  const [hoverEdit, setHoverEdit] = useState(null);  // 'move' | 'resize' | null, for the cursor
  const hoverRef = useRef(null);
  const drawingsRef = useRef([]);

  /**
   * THE INLINE NOTE EDITOR, which is what finally removes the last browser prompt from the chart.
   *
   * `{ id, point, x, y, text }` — `id` null means a draft that does not exist yet. A prompt blocked the
   * whole renderer, could not be styled, could not be re-opened to EDIT a note, and on a packaged
   * Electron window is a system dialog over the chart master is reading. `noteRef` mirrors it so the
   * pointer effect can see an open editor without listing it as a dependency and re-registering its
   * listeners on every keystroke.
   */
  const [note, setNote] = useState(null);
  const noteRef = useRef(null);
  const [fitted, setFitted] = useState(0);           // container height when `fillHeight`

  const [readout, setReadout] = useState(null);
  const [full, setFull] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  const prefs = useRef(loadPrefs());
  const [chartType, setChartType] = useState(() => {
    const want = prefs.current?.chartType;
    return CHART_TYPES.some((t) => t.id === want) ? want : 'candles';
  });
  const [scaleMode, setScaleMode] = useState(() => {
    const want = prefs.current?.scaleMode;
    return SCALE_MODES.some((m) => m.id === want) ? want : 'normal';
  });
  const [enabled, setEnabled] = useState(() => {
    const want = prefs.current?.overlays;
    return Array.isArray(want) ? want.filter((id) => overlayById(id)) : [];
  });

  /**
   * INDICATOR PERIODS ARE MASTER'S TO SET (Section 123).
   *
   * Every one of the 22 studies had its window frozen in a literal, which is the single most universal
   * feature of every trading surface researched and the one Rāma did not have. Stored as
   * `{ [id]: { [key]: value } }` inside the EXISTING prefs key, so an older stored preference simply has
   * no `overlayParams` and therefore loads today's defaults — the fallback path IS the upgrade path.
   *
   * Loaded through `resolveParams`, because this is master's own localStorage: a stale build or a hand
   * edit must not be able to put a period of 0 or of 1e9 into a study. A RAW value is what sits in state
   * while he is typing, so clearing the field reads as "use the default" rather than as zero.
   */
  const [overlayParams, setOverlayParams] = useState(() => {
    const want = prefs.current?.overlayParams;
    if (!want || typeof want !== 'object' || Array.isArray(want)) return {};
    const out = {};
    for (const id of Object.keys(want)) {
      if (overlayById(id)) out[id] = resolveParams(id, want[id]);
    }
    return out;
  });
  // VOLUME IS NOW A TOGGLE (Section 120). It was a prop defaulting to true that no call site ever
  // passed, so it was permanently on and took 18% of the pane from price whether or not master wanted
  // it — the one study with no way to switch it off.
  const [volOn, setVolOn] = useState(() => (typeof prefs.current?.volume === 'boolean'
    ? prefs.current.volume : showVolume));

  /**
   * THE EVIDENCE LAYERS, AND THE ONE OF THEM THAT IS REMEMBERED (Section 123).
   *
   * `fills`, `levels` and `cone` stay session-scoped on purpose: each one appears only when the data for
   * it arrives, so a remembered "off" would hide evidence master had forgotten he dismissed. `sessions`
   * is different — it is a drawing preference about the bars themselves, the same class of choice as the
   * chart type and the candle width, so it is persisted inside the EXISTING prefs key. An older stored
   * preference has no `sessions` and therefore loads on, which is the default this feature wants.
   *
   * Declared here rather than beside `readout` because the initialiser reads `prefs`, which is a ref
   * created a few lines above — a lazy initialiser runs during this render, so the order is load-bearing.
   */
  const [layers, setLayers] = useState(() => ({
    fills: true,
    levels: true,
    cone: true,
    sessions: typeof prefs.current?.sessions === 'boolean' ? prefs.current.sessions : true,
  }));

  /**
   * HOW WIDE A CANDLE IS, AS MASTER'S SETTING (Section 122).
   *
   * Three sections guessed at a single number and he reported it wrong three times. A number I choose
   * for him is a number I will keep getting wrong; a setting he chooses, that Rāma remembers and shows
   * back to him, ends the guessing. The default is still an opinion — `standard`, about where a trading
   * platform opens — but it is now the starting point rather than the only point.
   */
  const [density, setDensity] = useState(() => {
    const want = prefs.current?.density;
    return densityById(want) ? want : DEFAULT_DENSITY;
  });
  const barPx = pxForDensity(density);

  // What the zoom ACTUALLY is, measured off the chart. Displayed, so it is never again invisible.
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    savePrefs({
      chartType, scaleMode, overlays: enabled, volume: volOn, density, overlayParams,
      sessions: layers.sessions,
    });
  }, [chartType, scaleMode, enabled, volOn, density, overlayParams, layers.sessions]);

  const isIntraday = showsClock(interval);

  // ── Drawings: loaded per SYMBOL, so a level survives a timeframe change ────
  useEffect(() => {
    const loaded = DRAW.load(symbol);
    setDrawings(loaded);
    setSelectedId(null);
    setDraft(null);
    setMeasured(null);
    if (onDrawingsChange) onDrawingsChange(loaded.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Persisted on change rather than on unmount: a crash or a closed window must not lose master's work.
  useEffect(() => {
    if (!symbol) return;
    DRAW.save(symbol, drawings);
    if (onDrawingsChange) onDrawingsChange(drawings.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings, symbol]);

  // The layer reads this ref, so a redraw never waits on a React render.
  useEffect(() => {
    const el = holder.current;
    // The drag in progress is substituted for its stored original, so the mark follows the pointer
    // without the store being written to once per mouse-move event.
    const shown = editing
      ? drawings.map((d) => (d?.id === editing.id ? editing : d))
      : drawings;
    drawingsRef.current = drawings;
    drawStateRef.current = {
      drawings: shown.map((d) => DRAW.placed(d, isIntraday)).filter(Boolean),
      draft: draft ? DRAW.placed(draft, isIntraday) : null,
      selectedId,
      intraday: isIntraday,
      theme: el ? readTheme(el) : {},
      measureBars: measured?.bars ?? null,
    };
    layerRef.current?.redraw();
  }, [drawings, draft, selectedId, isIntraday, measured, editing]);

  useEffect(() => { noteRef.current = note; }, [note]);

  const commit = useCallback((d) => {
    if (!d) return;
    if (DRAW.TOOLS[d.tool]?.transient) return;       // a measure is read, never kept
    setDrawings((list) => DRAW.add(list, d));
  }, []);

  /**
   * Close the note editor — committing master's words, or abandoning the draft.
   *
   * `keep` false is Escape: a NEW note leaves nothing behind, and an EXISTING one keeps the text it
   * already had. `keep` true is Enter or clicking away: an empty draft is still never created (the rule
   * the prompt branch had, preserved exactly), and an emptied EXISTING note is refused by `DRAW.setText`
   * rather than deleted, because deletion is the Delete key.
   */
  const settleNote = useCallback((keep) => {
    const n = noteRef.current;
    if (!n) return;
    noteRef.current = null;
    setNote(null);
    const text = (n.text || '').trim();
    if (keep) {
      if (n.id) setDrawings((list) => DRAW.setText(list, n.id, text));
      else if (text) commit(DRAW.makeDrawing('text', [n.point], { text }));
    }
    // The tool disarms either way, exactly as the one-point commit path already did — a note is placed
    // one at a time, and an armed tool master has forgotten about is a click that surprises him.
    if (!n.id) setTool(null);
  }, [commit]);
  const available = useMemo(() => overlaysFor(isIntraday), [isIntraday]);

  // An overlay that is only meaningful intraday must not stay silently active on a daily chart. It
  // is filtered out of what gets drawn rather than removed from master's choice, so switching back
  // to 5m restores it.
  const active = useMemo(
    () => enabled.filter((id) => available.some((o) => o.id === id)),
    [enabled, available],
  );

  // The RESOLVED parameters, keyed by id, computed once per change rather than per use — so the legend,
  // the menu, the shortfall note and the arithmetic cannot disagree about what a study is set to.
  const activeParams = useMemo(() => {
    const out = {};
    for (const id of active) out[id] = resolveParams(id, overlayParams[id]);
    return out;
  }, [active, overlayParams]);
  // A keystroke that does not change a RESOLVED value must not tear down and rebuild every series, so the
  // overlay effect depends on this rather than on the raw state object.
  const paramsKey = useMemo(() => JSON.stringify(activeParams), [activeParams]);

  const setOverlayParam = (id, key, raw) => setOverlayParams((s) => ({
    ...s, [id]: { ...(s[id] || {}), [key]: raw },
  }));

  const candles = useMemo(() => (bars || [])
    .map((b) => {
      const time = toChartTime(b?.date);
      if (time === null) return null;
      if (![b.open, b.high, b.low, b.close].every(finite)) return null;
      return { time, open: b.open, high: b.high, low: b.low, close: b.close,
        volume: Number(b.volume) };
    })
    .filter(Boolean)
    // The library requires ascending, de-duplicated times.
    .filter((c, i, a) => i === 0 || String(c.time) !== String(a[i - 1].time)),
  [bars]);

  const volumes = useMemo(() => candles
    .filter((c) => Number.isFinite(c.volume) && c.volume > 0)
    .map((c) => ({ time: c.time, value: c.volume, up: c.close >= c.open })),
  [candles]);

  /**
   * WHERE ONE TRADING DAY ENDS (Section 123).
   *
   * `starts` was computed inside the fill-marker effect; it is hoisted here because the session bands
   * need the same map and one chart should not build the same boundary list twice. It is still the
   * tested `sessionStarts` doing the deciding — `chartSessions.js` consumes it and adds only where each
   * session ends, which is the half no existing module had.
   *
   * `bands` is empty on a daily chart by design, and the chip hides itself when it is: alternating tints
   * on daily bars would shade calendar days, which means nothing when a day is already one candle.
   */
  const starts = useMemo(() => sessionStarts(candles), [candles]);
  const bands = useMemo(() => sessionBands(candles, { starts }), [candles, starts]);
  const bandNote = useMemo(() => describeBands(bands), [bands]);

  // The session layer reads this ref, so the toggle redraws without the chart being rebuilt. THE TOGGLE
  // IS APPLIED HERE rather than in the layer: "switched off" and "there are no sessions in these bars"
  // are the same thing to a renderer, and keeping that decision in one place leaves the layer with no
  // opinion to hold. Declared after the memo it depends on, because a dependency array is evaluated
  // during the render that reaches it and `bands` would not exist yet above.
  useEffect(() => {
    const el = holder.current;
    sessionStateRef.current = {
      bands: layers.sessions ? bands : [],
      theme: el ? readTheme(el) : {},
    };
    sessionLayerRef.current?.redraw();
  }, [bands, layers.sessions, chartType, volOn]);

  // Kept current on every render so the long-lived chart subscription and the data effect both see
  // master's present choice rather than the one in force when they were created.
  targetPxRef.current = barPx;
  countRef.current = candles.length;

  const last = candles.length ? candles[candles.length - 1] : null;
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const change = last && prev ? last.close - prev.close : null;
  const changePct = change !== null && prev && prev.close !== 0
    ? (change / prev.close) * 100 : null;

  // The baseline chart's zero line. Master's average cost when he holds the symbol, otherwise the
  // first visible close — which turns the chart into "the move since this window opened".
  const baseValue = finite(basePrice) ? basePrice : (candles[0]?.close ?? 0);

  /**
   * THE CHART CAN NOW FILL ITS CONTAINER (Section 121).
   *
   * The workspace panel is 400px tall and passed a hard `height={260}`, so maximising the panel widened
   * the chart and never heightened it — the chart's own `ResizeObserver` only ever applied width. With
   * `fillHeight` the shell is a flex column, the canvas holder takes the remaining space, and the
   * measured container height drives the chart.
   *
   * `fitted` is only trusted once it is a usable size: before layout settles it is 0, and falling back to
   * `height` means a chart that is briefly the wrong size rather than one that is zero pixels tall.
   */
  const effectiveHeight = full
    ? Math.max(360, window.innerHeight - 180)
    : (fillHeight && fitted > 120 ? fitted : height);

  // ── Create once. Recreating per render would throw away master's zoom on every poll. ────────
  //
  // THE HOLDER IS ALWAYS MOUNTED, AND THAT IS LOAD-BEARING (Section 107). The empty state used to
  // REPLACE it, so mounting with no bars left `holder.current` null, this effect returned, and no chart
  // was ever created — and the deps below do not change when data arrives, so nothing tried again. It
  // broke on only one of two mount orders, which is why the workspace widget worked and the CHART tab,
  // which mounts before its bars, did not.
  //
  // `height` and `interval` are deliberately NOT deps: `applyOptions` sets both on a live chart, and
  // having them here rebuilt it on every interval change and on fullscreen. `chartType` IS a dep because
  // the price series changes class; the visible range is carried across by hand below.
  useEffect(() => {
    if (!holder.current) return undefined;
    const theme = readTheme(holder.current);
    const chart = createChart(holder.current, {
      height: effectiveHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: theme.muted,
        fontSize: 12,
        attributionLogo: true,
        panes: { separatorColor: theme.border, separatorHoverColor: `${theme.accent}55`,
          enableResize: true },
      },
      grid: {
        vertLines: { color: theme.border, style: LineStyle.Dotted },
        horzLines: { color: theme.border, style: LineStyle.Dotted },
      },
      // The bottom margin no longer reserves a quarter of the pane for volume: volume has its own
      // pane now, so price gets the height back.
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 6,
        // THE CANDLE WIDTH IS SET AT CREATION, NOT ONLY AFTER THE FIRST `setData` (Section 122). The
        // library's default is 6px, and that default is almost certainly what master was looking at:
        // Section 110 measured "about 5px" while asking for 8, which is the untouched default rather
        // than a miscalculated target. Starting at the right width means the first paint is already
        // correct instead of being corrected.
        barSpacing: targetPxRef.current,
        // A manual zoom may go narrower than a body is readable — that is master's business — but the
        // floor stays above zero so a pinch cannot collapse the series into a line.
        minBarSpacing: 0.5,
        timeVisible: showsClock(interval),
        secondsVisible: false,
        // THE AXIS READS IN MASTER'S OWN TIME (Section 118). The library renders a UTCTimestamp in UTC,
        // so the 09:15 IST open was labelled 03:45 — a chart in a timezone he does not trade in. The
        // stored values stay true UTC; only the label is converted.
        tickMarkFormatter: makeTickFormatter(),
      },
      // The crosshair's own time label, same conversion.
      localization: { timeFormatter: makeTimeFormatter() },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: true,
      handleScale: true,
      autoSize: false,
    });

    const common = { priceLineVisible: true, lastValueVisible: true };
    let price;
    if (chartType === 'bars') {
      price = chart.addSeries(BarSeries, { ...common, upColor: theme.green, downColor: theme.red });
    } else if (chartType === 'line') {
      price = chart.addSeries(LineSeries, { ...common, color: theme.accent, lineWidth: 2 });
    } else if (chartType === 'area') {
      price = chart.addSeries(AreaSeries, {
        ...common, lineColor: theme.accent, lineWidth: 2,
        topColor: `${theme.accent}55`, bottomColor: `${theme.accent}08`,
      });
    } else if (chartType === 'baseline') {
      price = chart.addSeries(BaselineSeries, {
        ...common,
        baseValue: { type: 'price', price: baseValue },
        topLineColor: theme.green, topFillColor1: `${theme.green}44`, topFillColor2: `${theme.green}08`,
        bottomLineColor: theme.red, bottomFillColor1: `${theme.red}08`, bottomFillColor2: `${theme.red}44`,
      });
    } else {
      price = chart.addSeries(CandlestickSeries, {
        ...common,
        upColor: theme.green, downColor: theme.red,
        borderUpColor: theme.green, borderDownColor: theme.red,
        wickUpColor: theme.green, wickDownColor: theme.red,
      });
    }

    let vol = null;
    if (volOn) {
      // PANE 1, not an overlay price scale. The previous version put volume on the price pane with
      // `scaleMargins: {top: 0.82}`, which is a way of saying "price may only use 74% of its own
      // pane". v5.2's pane API is the mechanism actually meant for this.
      vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        lastValueVisible: false, priceLineVisible: false,
      }, 1);
      try { chart.panes()[1]?.setHeight(Math.max(60, Math.round(effectiveHeight * 0.18))); }
      catch { /* the pane exists or it does not; a failed resize is cosmetic */ }
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

    // THE FIRST PRIMITIVE RĀMA HAS. Section 120 found the whole plugin surface unused; drawings are what
    // it was for. The layer reads live state on every draw, so nothing here has to be re-attached when
    // master adds a mark.
    try {
      const layer = createDrawingLayer(() => drawStateRef.current);
      price.attachPrimitive(layer);
      layerRef.current = layer;
    } catch (err) {
      // A chart without drawings is still a chart. Reported rather than silently absent.
      console.warn(`[PriceChart] drawing layer unavailable: ${err.message}`);
      layerRef.current = null;
    }

    // THE SECOND PRIMITIVE: the session bands (Section 123). Attached to the same series and ordered by
    // its own `zOrder: 'bottom'` rather than by the order of these two calls, so bands sit under the
    // candles, under volume and under every drawing however this code is arranged later.
    try {
      const sessions = createSessionLayer(() => sessionStateRef.current);
      price.attachPrimitive(sessions);
      sessionLayerRef.current = sessions;
    } catch (err) {
      // Unshaded bars are still bars. The gap stops being marked, which is worth saying out loud.
      console.warn(`[PriceChart] session layer unavailable: ${err.message}`);
      sessionLayerRef.current = null;
    }

    /**
     * THE ZOOM IS NOW OBSERVABLE, AND THAT IS THE REAL FIX (Section 122).
     *
     * Nothing on screen ever said how wide a candle was, so "the default zoom is wrong" could only be
     * answered by guessing. This reports the measured width on every range change — the default, a
     * scroll-wheel zoom, a pan, a resize — so the number is always visible and a wrong one is
     * immediately a specific complaint rather than a vague one.
     *
     * Deduped to quarter-pixel steps: a drag fires this every frame, and sixty identical state updates
     * a second is a way to make a chart stutter.
     */
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      const width = plotWidth(chart, holder.current);
      const actual = pxPerBar(range, width);
      const step = actual === null ? null : Math.round(actual * 4) / 4;
      if (step === lastPxRef.current) return;
      lastPxRef.current = step;
      setZoom({
        actual, width, count: countRef.current,
        text: describeZoom(actual, countRef.current, width),
        note: null,
      });
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param?.time || !param.seriesData) { setReadout(null); return; }
      const bar = param.seriesData.get(price);
      if (!bar) { setReadout(null); return; }
      const v = vol ? param.seriesData.get(vol) : null;
      const over = {};
      for (const entry of overlayRefs.current) {
        if (!entry.legend) continue;
        const pt = param.seriesData.get(entry.series);
        if (pt && finite(pt.value)) over[entry.legend] = pt.value;
      }
      setReadout({ ...bar, volume: v?.value ?? null, time: param.time, overlays: over });
    });

    if (onReady) onReady(chart);

    return () => {
      // Remember where master was looking. The rebuild below is deliberate (the series class
      // changed), but his zoom is not the thing that changed.
      try { savedRangeRef.current = chart.timeScale().getVisibleLogicalRange(); }
      catch { savedRangeRef.current = null; }
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volRef.current = null;
      coneRefs.current = {};
      overlayRefs.current = [];
      markersRef.current = null;
      linesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volOn, chartType]);

  // Height and the axis clock are applied to the live chart rather than rebuilding it.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      height: effectiveHeight,
      timeScale: { timeVisible: showsClock(interval), secondsVisible: false },
    });
    if (volOn) {
      try { chart.panes()[1]?.setHeight(Math.max(60, Math.round(effectiveHeight * 0.18))); }
      catch { /* cosmetic */ }
    }
  }, [effectiveHeight, interval, volOn]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const mode = SCALE_MODES.find((m) => m.id === scaleMode) || SCALE_MODES[0];
    chart.priceScale('right').applyOptions({ mode: mode.mode });
  }, [scaleMode, chartType]);

  useEffect(() => {
    const price = priceRef.current;
    if (!price || chartType !== 'baseline') return;
    price.applyOptions({ baseValue: { type: 'price', price: baseValue } });
  }, [baseValue, chartType]);

  // ── Bars ──────────────────────────────────────────────────────────────────
  //
  // FITTING IS NOT AUTOMATIC. `fitContent()` on every data change reset the zoom master had just set.
  // It now fits only when the series IDENTITY changes — symbol, interval or window.
  useEffect(() => {
    const price = priceRef.current;
    const chart = chartRef.current;
    if (!price || !chart) return;

    const forLine = chartType === 'line' || chartType === 'area' || chartType === 'baseline';
    // Heikin-Ashi is a transform of the SAME bars, not a different series — so it shares every overlay,
    // marker and level, and the indicators still read the real closes rather than the smoothed ones.
    // Computing studies on HA values is a well-known way to produce an RSI of a price that never traded.
    const drawn = chartType === 'heikin' ? heikinAshi(candles) : candles;
    price.setData(forLine
      ? drawn.map((c) => ({ time: c.time, value: c.close }))
      : drawn.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));

    if (volRef.current) {
      const theme = holder.current ? readTheme(holder.current) : null;
      volRef.current.setData(volumes.map((v) => ({
        time: v.time, value: v.value,
        color: theme ? `${v.up ? theme.green : theme.red}66` : undefined,
      })));
    }

    if (candles.length === 0) return;

    // ZOOM TO LEGIBLE CANDLES, NOT TO EVERY BAR (Section 110), as bar spacing rather than a
    // width-derived range (Section 119), VERIFIED RATHER THAN ASSUMED (Section 122).
    // `applyLegibleZoom` above holds the reasoning and the only copy of the arithmetic.
    const fitLegible = () => applyLegibleZoom(chart, candles.length, holder.current,
      targetPxRef.current, setZoom);

    // The DATES are part of the series identity, not just the preset name: with a hand-typed window
    // `rangeId` is null, so a key from the preset alone would keep the old zoom over a different span.
    const fitKey = `${symbol}|${interval}|${rangeId || ''}|${fromDate || ''}|${toDate || ''}`;
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      savedRangeRef.current = null;
      fitLegible();
      return;
    }
    if (savedRangeRef.current) {
      try { chart.timeScale().setVisibleLogicalRange(savedRangeRef.current); }
      catch { fitLegible(); }
      savedRangeRef.current = null;
    }
  }, [candles, volumes, chartType, symbol, interval, rangeId, fromDate, toDate]);

  // ── Overlays: pure functions of the bars on screen (Section 101) ───────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !holder.current) return;
    for (const entry of overlayRefs.current) {
      try { chart.removeSeries(entry.series); } catch { /* already disposed */ }
    }
    overlayRefs.current = [];
    if (candles.length === 0) return;

    const theme = readTheme(holder.current);
    // Oscillators go below price, and below volume when volume is shown, so the panes read
    // top-to-bottom in the order a trader expects.
    let nextPane = volOn ? 2 : 1;
    let colorIdx = 0;

    const addLine = (data, { color, width = 1, style = LineStyle.Solid, pane = 0, legend = null }) => {
      if (!data || data.length === 0) return null;
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle: style,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }, pane);
      s.setData(data);
      overlayRefs.current.push({ series: s, legend });
      return s;
    };

    /**
     * THE PANE IS DECIDED FIRST, THEN THE SHAPE — and that order is a bug fix (Section 120).
     *
     * This used to branch on `kind` first, and `rsi14` is `{pane: 'oscillator', kind: 'line'}`. So RSI
     * matched the `kind === 'line'` branch and was drawn on PANE 0, against the price. A 0–100 series on
     * a 25,000-point index axis renders as a flat line along the floor — which is precisely the "classic
     * chart bug" `indicators.js` warns about in its own comment, present in the code that quoted it. The
     * guides and the 0–100 autoscale sat in an unreachable branch.
     *
     * `pane` and `kind` are independent properties and are now read independently.
     */
    const resolve = (v) => (typeof v === 'string' && v.startsWith('var(')
      ? (theme[v.slice(6, -1)] ?? null) : v);

    for (const id of active) {
      const def = overlayById(id);
      if (!def) continue;
      const color = OVERLAY_COLORS[colorIdx % OVERLAY_COLORS.length];
      colorIdx += 1;
      // THE LABEL FOLLOWS THE PARAMETERS, here and in the menu and the readout. A legend still reading
      // 'SMA 20' over a 50-period average is a wrong number that looks right.
      const params = resolveParams(id, overlayParams[id]);
      const label = labelFor(def, params);
      const computed = def.make(candles, params);
      const own = def.pane === 'oscillator';
      const pane = own ? nextPane : 0;
      if (own) nextPane += 1;

      // Guides and a fixed scale belong to the study, and `kind: 'series'` may declare them alongside
      // its lines — so they are read from either place rather than only from the definition.
      const guides = computed?.guides ?? def.guides;
      const scale = computed?.scale ?? def.scale;
      let anchor = null;                    // the series the guides and scale attach to

      if (def.kind === 'band') {
        anchor = addLine(computed.middle,
          { color, style: LineStyle.Dashed, pane, legend: label });
        addLine(computed.upper, { color: `${color}99`, pane });
        addLine(computed.lower, { color: `${color}99`, pane });
      } else if (def.kind === 'macd') {
        if (computed.macd.length === 0) continue;
        const hist = computed.histogram.length > 0
          ? chart.addSeries(HistogramSeries, {
            priceLineVisible: false, lastValueVisible: false,
          }, pane)
          : null;
        if (hist) {
          hist.setData(computed.histogram.map((p) => ({
            time: p.time, value: p.value,
            color: p.value >= 0 ? `${theme.green}77` : `${theme.red}77`,
          })));
          overlayRefs.current.push({ series: hist, legend: null });
        }
        anchor = addLine(computed.macd, { color, width: 2, pane, legend: label });
        addLine(computed.signal, { color: theme.amber, pane, legend: `${label} sig` });
      } else if (def.kind === 'series') {
        // GENERIC MULTI-LINE. Ichimoku's five lines, Supertrend's two sides, ADX's three, the pivot
        // ladder and PSAR's dots all render here, so a study with any number of lines needs no new
        // branch — which is the only reason the five of them were affordable at once.
        for (const part of (computed.series || [])) {
          const s = addLine(part.data, {
            color: resolve(part.color) || color,
            width: part.width || 1,
            style: part.dotted ? LineStyle.Dotted
              : part.dashed ? LineStyle.Dashed : LineStyle.Solid,
            pane,
            legend: part.label,
          });
          if (s && part.dots) {
            // PSAR is a sequence of points, not a path: joining them draws a line through prices the
            // stop never sat at.
            try { s.applyOptions({ pointMarkersVisible: true, lineVisible: false }); }
            catch { /* the line is still readable if the library refuses */ }
          }
          if (s && !anchor) anchor = s;
        }
      } else {
        anchor = addLine(computed, { color, width: 2, pane, legend: label });
      }

      if (anchor && Array.isArray(guides)) {
        // Guides are price lines on the study's own series so they scale WITH it. As data they would
        // join the series and widen its range, which defeats the purpose of a reference level.
        for (const g of guides) {
          try {
            anchor.createPriceLine({
              price: g, color: theme.border, lineWidth: 1,
              lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: String(g),
            });
          } catch { /* a guide is cosmetic */ }
        }
      }
      if (anchor && scale) {
        try {
          anchor.applyOptions({ autoscaleInfoProvider: () => ({
            priceRange: { minValue: scale.min, maxValue: scale.max },
          }) });
        } catch { /* fall back to autoscale */ }
      }
      if (own) {
        try { chart.panes()[pane]?.setHeight(Math.max(60, Math.round(effectiveHeight * 0.22))); }
        catch { /* cosmetic */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, active, chartType, volOn, paramsKey]);

  // ── Master's own fills, as arrows on the bars they happened on ─────────────
  useEffect(() => {
    const price = priceRef.current;
    if (!price || !holder.current) return;
    const theme = readTheme(holder.current);
    // A FILL CARRIES A DATE; AN INTRADAY CANDLE CARRIES A TIME (Section 117).
    //
    // The ledger records `YYYY-MM-DD`, so `toChartTime` returns a STRING for it — which cannot sit on
    // a chart whose candles are UTC epoch numbers. This is the same defect the cone had, in a second
    // layer, found while fixing the first.
    //
    // RESOLVED BY LOOKING UP THE FIRST BAR OF THAT SESSION, not by inventing a time of day. Master's
    // ledger genuinely does not know when in the session he filled, so the marker sits at the
    // session's first stored bar: derived from data on hand rather than guessed. A date with no bar
    // is skipped, because a marker at a time that has no candle is a marker in empty space.
    //
    // `starts` is now the hoisted memo rather than a second call, because the session bands need the
    // same map. One boundary list per chart, and it is the tested one.
    const marks = (layers.fills ? (fills || []) : [])
      .map((f) => {
        const time = markerTime(f?.date, starts);
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

    // The markers primitive is bound to a series instance, so a chart type change — which replaces
    // the series — has to rebind rather than reuse the stale handle.
    markersRef.current = createSeriesMarkers(price, marks);
    // `candles` joins the dependencies because the session-start lookup is built from them: on an
    // intraday chart a fill cannot be placed until the bars it sits among have loaded. `starts` is a
    // memo of the same `candles` and so cannot be stale while they are listed — naming both would name
    // one thing twice, and `verifyChartTime.mjs` pins this array by name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fills, layers.fills, chartType, candles]);

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
  }, [signal, thesis, layers.levels, candles.length, chartType]);

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

    // ONE CHART HOLDS ONE TIME TYPE. `toChartTime` yields a 'YYYY-MM-DD' string for daily bars and a
    // UTC epoch NUMBER for intraday ones, and lightweight-charts cannot mix them on one chart.
    //
    // This guard exists because the two used to disagree: the cone was requested by horizon, only
    // `60m` mapped to an intraday horizon, so a 30m chart drew 30m candles (numbers) against a daily
    // cone (strings) — and Section 110 made 30m the default, so it failed every time. The request is
    // fixed at the source (Section 117); this refuses to draw rather than throwing if they ever
    // diverge again, because a silent absence is easier to diagnose than a crashed effect that also
    // takes the candles down with it.
    const candleTime = candles[0]?.time;
    const coneTime = seed[0]?.time ?? toChartTime(points[0]?.time);
    if (!timeTypesMatch(candleTime, coneTime)) {
      console.warn('[PriceChart] cone not drawn: the projection is on a different bar interval from '
        + `the chart (chart time is a ${typeof candleTime}, cone time is a ${typeof coneTime})`);
      return;
    }

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
      }, 0);
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
  }, [cone, layers.cone, candles.length, chartType]);

  const empty = candles.length === 0;
  // WHAT THE OVERLAY SAYS, decided outside the render so it can be asserted (Section 129). The three
  // defects it ends — a false "nothing stored", a fetch button that cannot help, and a generic failure
  // over a named cause — are documented in chartEmptyState.js.
  const vacancy = useMemo(() => emptyState({
    bars: candles.length, busy, failure, note: replyNote, coverage, interval, symbol, rangeId,
  }), [candles.length, busy, failure, replyNote, coverage, interval, symbol, rangeId]);
  const toggle = (k) => setLayers((s) => ({ ...s, [k]: !s[k] }));

  // One step wider or narrower. `+1` is narrower because the list runs comfortable → dense.
  const stepDensity = useCallback((dir) => {
    const here = DENSITIES.findIndex((d) => d.id === density);
    const from = here < 0 ? DENSITIES.findIndex((d) => d.id === DEFAULT_DENSITY) : here;
    const next = Math.max(0, Math.min(DENSITIES.length - 1, from + dir));
    setDensity(DENSITIES[next].id);
  }, [density]);

  const toggleOverlay = (id) => setEnabled((s) => (s.includes(id)
    ? s.filter((x) => x !== id) : s.concat(id)));

  // Two different things, so both are offered: back to a readable zoom, or truly everything.
  const resetZoom = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applyLegibleZoom(chart, candles.length, holder.current, targetPxRef.current, setZoom);
  }, [candles.length]);

  /**
   * `fit all` is the one place `fitContent()` is right: master asked for the whole series, so a smear
   * is the answer he wants. It is a button, never a fallback — as a fallback it is what silently undid
   * the fix twice.
   */
  const zoomAll = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try { chart.timeScale().fitContent(); }
    catch { return; }
    // Measured afterwards, so the readout does not go on claiming the density's width.
    frame(() => measureZoom(chart, candles.length, holder.current, setZoom,
      'fitted to the whole series, so the candle width is whatever that takes'));
  }, [candles.length]);

  // MASTER'S CHOICE APPLIES AT ONCE. A density that only took effect at the next data change would
  // read as a control that does nothing, which is its own defect.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    applyLegibleZoom(chart, candles.length, holder.current, targetPxRef.current, setZoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  /**
   * Save the chart as a PNG (Section 120).
   *
   * `takeScreenshot()` is the library's own call and was never used, so there was no way to get a chart
   * out of Rāma at all — not to a note, not to a message, not into the spec. The filename carries the
   * symbol, interval and date, because a folder of `chart.png` files is a folder of nothing.
   *
   * THE IMAGE IS THE CANVAS ONLY. The toolbars, the readout and the shortfall notes are DOM, so they are
   * not in it — said here rather than discovered when the saved file is missing the note that mattered.
   */
  const saveImage = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const canvas = chart.takeScreenshot();
      const name = `${symbol || 'chart'}-${interval}-${todayYmd()}.png`;
      const done = (url) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        // Revoked on the next tick rather than immediately: revoking before the click is processed
        // cancels the download in Chromium.
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }, 4000);
      };
      if (canvas.toBlob) canvas.toBlob((b) => { if (b) done(URL.createObjectURL(b)); });
      else done(canvas.toDataURL('image/png'));
    } catch (err) {
      console.warn(`[PriceChart] could not save the image: ${err.message}`);
    }
  }, [symbol, interval]);

  /**
   * Pointer handling for the drawing tools.
   *
   * ON THE HOLDER, NOT THE DOCUMENT, and only while a tool is active — so the chart's own pan and zoom
   * keep working whenever master is not drawing. `handleScroll`/`handleScale` are switched off for the
   * duration, because a drag that both draws a line and pans the chart produces neither.
   *
   * A one-point tool commits on mouse DOWN; a two-point tool tracks a draft until mouse UP. There is no
   * click-click mode: a drag is unambiguous, and a two-click tool leaves the chart in a state where the
   * next click anywhere means something master may not remember arming.
   *
   * WITH NO TOOL ARMED the same three handlers now also EDIT an existing mark: a handle grabs an end and
   * reshapes it, the body grabs the whole thing and moves it, and empty space deselects as it always
   * did. The order is handle, then body, then nothing — `DRAW.HANDLE_TOL` is the wider tolerance, so
   * where both tests succeed the end wins. `pointer.current.mode` says which of the three drags is in
   * progress, because a reshape that pans the chart produces neither.
   */
  const pointer = useRef(null);

  useEffect(() => {
    const el = holder.current;
    const chart = chartRef.current;
    const layer = layerRef.current;
    if (!el || !chart || !layer) return undefined;

    // No tool: the chart behaves exactly as it did, and a click selects or deselects a mark.
    const rect = () => el.getBoundingClientRect();
    const project = (p) => layer.project(p);
    const grab = () => chart.applyOptions({ handleScroll: false, handleScale: false });
    const release = () => chart.applyOptions({ handleScroll: true, handleScale: true });
    // The stored original, whose anchors are epoch seconds — never the placed copy the layer holds.
    const storedById = (id) => (drawingsRef.current || []).find((d) => d?.id === id) || null;

    const down = (e) => {
      if (e.button !== 0) return;
      const r = rect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      // An open editor settles first: clicking the chart commits non-empty words rather than discarding
      // what master has already typed.
      if (noteRef.current) { settleNote(true); return; }

      if (!tool) {
        const placedList = drawStateRef.current.drawings || [];
        // The selection comes from the ref the layer already reads, not from the closure: a drag must
        // not depend on the effect having been re-registered since master last clicked something.
        const selected = placedList.find((d) => d?.id === drawStateRef.current.selectedId) || null;

        // Double-click a note to edit it in place. Read off `detail` rather than a second listener, so
        // the pointer surface stays the three handlers it has always been.
        if (e.detail >= 2) {
          const onNote = DRAW.hitTest(placedList, { x, y }, project, { tol: 6, width: r.width });
          if (onNote?.tool === 'text') {
            const at = project(onNote.points[0]);
            setSelectedId(onNote.id);
            setNote({ id: onNote.id, point: onNote.points[0],
              x: at ? at.x : x, y: at ? at.y : y, text: onNote.text || '' });
            return;
          }
        }

        const handle = DRAW.handleAt(selected, { x, y }, project);
        if (selected && handle !== null) {
          const before = storedById(selected.id);
          if (before) {
            grab();
            pointer.current = { mode: 'reshape', id: before.id, index: handle };
            setEditing(before);
            return;
          }
        }

        const hit = DRAW.hitTest(placedList, { x, y }, project, { tol: 6, width: r.width });
        if (hit) {
          setSelectedId(hit.id);
          const at = layer.unproject(x, y);
          const before = storedById(hit.id);
          // Without an anchor under the pointer there is nothing to measure a delta from, so the click
          // selects and stops there rather than moving the mark by a guess.
          if (at && before) {
            grab();
            pointer.current = { mode: 'move', id: before.id, from: at };
            setEditing(before);
          }
          return;
        }
        setSelectedId(null);
        return;
      }
      const at = layer.unproject(x, y);
      if (!at) return;                                // off the data: nothing to anchor to
      const def = DRAW.TOOLS[tool];
      if (def.points === 1) {
        if (tool === 'text') {
          // THE LAST BROWSER PROMPT IS GONE. A draft opens an inline input at the clicked anchor; the
          // note itself is created only once there are words, which is the rule the prompt branch had.
          setNote({ id: null, point: at, x, y, text: '' });
          return;
        }
        commit(DRAW.makeDrawing(tool, [at]));
        setTool(null);
        return;
      }
      grab();
      pointer.current = { mode: 'draw', from: at, fromX: x };
      setDraft(DRAW.makeDrawing(tool, [at, at]));
    };

    const move = (e) => {
      const r = rect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const p = pointer.current;

      if (!p) {
        // HOVER, so the chart says what a drag will do BEFORE the button goes down. Only the changed
        // value reaches state: a setState per mouse-move event would re-render the whole chart while
        // master is simply passing over it.
        let next = null;
        if (!tool && x >= 0 && y >= 0 && x <= r.width && y <= r.height) {
          const placedList = drawStateRef.current.drawings || [];
          const selected = placedList.find((d) => d?.id === drawStateRef.current.selectedId) || null;
          if (selected && DRAW.handleAt(selected, { x, y }, project) !== null) next = 'resize';
          else if (DRAW.hitTest(placedList, { x, y }, project, { tol: 6, width: r.width })) next = 'move';
        }
        if (hoverRef.current !== next) { hoverRef.current = next; setHoverEdit(next); }
        return;
      }

      const to = layer.unproject(x, y);
      if (!to) return;

      if (p.mode === 'reshape') {
        setEditing((cur) => (cur ? DRAW.reshapeDrawing(cur, p.index, to) : cur));
        return;
      }
      if (p.mode === 'move') {
        const a = DRAW.toEpoch(p.from.time);
        const b = DRAW.toEpoch(to.time);
        if (a === null || b === null) return;
        // The delta is measured from where the drag STARTED and applied to the stored original, so a
        // reshape of one anchor per frame cannot accumulate rounding across a long drag.
        const base = storedById(p.id);
        if (!base) return;
        setEditing(DRAW.moveDrawing(base, b - a, to.price - p.from.price));
        return;
      }

      const d = DRAW.makeDrawing(tool, [p.from, to]);
      setDraft(d);
      if (tool === 'measure' && d) {
        // Bars from the chart's own logical scale, never from elapsed time — an intraday span crosses
        // overnight gaps in which no bars exist.
        const a = layer.logicalAt(p.fromX);
        const b = layer.logicalAt(x);
        const bars = (a !== null && b !== null) ? b - a : null;
        setMeasured(DRAW.measurement(d.points[0], d.points[1], bars));
      }
    };

    const up = () => {
      const p = pointer.current;
      if (!p) return;
      pointer.current = null;
      release();
      if (p.mode === 'draw') {
        setDraft((d) => {
          if (d) commit(d);
          return null;
        });
        // The measure reading survives the drag that produced it, so master can read it after letting go.
        setTool((t) => (t === 'measure' ? t : null));
        return;
      }
      // ONE commit per drag, at the end — so the store holds the mark master let go of, not every
      // intermediate position his hand passed through. A click that selected without dragging commits
      // NOTHING: rewriting the store with an identical copy would make every selection look like an
      // edit to anything watching the list.
      setEditing((cur) => {
        if (cur) {
          const base = storedById(cur.id);
          const changed = !base || JSON.stringify(base.points) !== JSON.stringify(cur.points);
          if (changed) setDrawings((list) => list.map((d) => (d?.id === cur.id ? cur : d)));
        }
        return null;
      });
    };

    el.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      el.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // `settleNote` is the only addition, and it is a stable callback — the selection, the stored list and
    // the open editor are all read through refs precisely so this array does not grow with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, commit, settleNote, chartType, candles.length]);

  // `fillHeight`: measure the shell and let the chart take what is left below the toolbars.
  useEffect(() => {
    if (!fillHeight) return undefined;
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      const used = (holder.current?.offsetTop ?? 0) - (el.offsetTop ?? 0);
      // Whatever the toolbars did not take, minus the notes below the canvas.
      const avail = Math.floor(h - used - 28);
      if (avail > 120) setFitted(avail);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillHeight]);

  // A menu that only closes by clicking its own button sits over the chart master is trying to read.
  useEffect(() => {
    if (!menuOpen && !viewOpen) return undefined;
    const away = (e) => {
      if (holder.current?.contains(e.target)) { setMenuOpen(false); setViewOpen(false); return; }
      if (!e.target.closest?.('[aria-haspopup="true"], [role="group"][aria-label]')) {
        setMenuOpen(false);
        setViewOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menuOpen, viewOpen]);

  // Keyboard, because a chart master uses every day should not need the mouse for the six things he
  // changes most. Scoped to the chart's own focus, never a document-level listener that would
  // hijack typing in the symbol field.
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && (menuOpen || viewOpen)) {
      setMenuOpen(false);
      setViewOpen(false);
      e.preventDefault();
      return;
    }
    const type = CHART_TYPES.find((t) => t.key === k);
    if (type) { setChartType(type.id); e.preventDefault(); return; }
    if (k === 'f') { setFull((v) => !v); e.preventDefault(); return; }
    if (k === 'l') {
      setScaleMode((m) => (m === 'log' ? 'normal' : 'log'));
      e.preventDefault();
      return;
    }
    if (k === 'r') { resetZoom(); e.preventDefault(); return; }
    if (k === 'v') { setVolOn((v) => !v); e.preventDefault(); return; }
    // Candle width, the bracket keys — the same convention as every brush-size control. Neither
    // bracket is a chart-type, view or drawing shortcut, and the suite asserts that.
    if (k === ']') { stepDensity(-1); e.preventDefault(); return; }
    if (k === '[') { stepDensity(1); e.preventDefault(); return; }
    // Drawing keys. Every one is checked against the chart-type and view keys by the suite, so a tool
    // shortcut can never silently steal `1`-`6`, `f`, `l`, `r` or `v`.
    const td = DRAW.TOOL_IDS.find((id) => DRAW.TOOLS[id].key === k);
    if (td) { setTool((t) => (t === td ? null : td)); e.preventDefault(); return; }
    if (k === 'delete' || k === 'backspace') {
      if (selectedId) {
        setDrawings((l) => DRAW.remove(l, selectedId));
        setSelectedId(null);
        e.preventDefault();
      }
      return;
    }
    if (k === 'z') { setDrawings((l) => DRAW.undo(l)); e.preventDefault(); return; }
    if (k === 'escape'
        && (editing || pointer.current?.mode === 'move' || pointer.current?.mode === 'reshape')) {
      // Escape mid-drag RESTORES the mark: only the working copy is dropped, the stored one was never
      // written to, and pan and zoom come back because the drag that switched them off has ended.
      // SCOPED TO THE EDIT DRAGS BY MODE, not to `pointer.current` bare: a DRAW drag also sets the ref,
      // and matching it here swallowed the Escape that the branch below uses to drop a half-drawn mark
      // and disarm the tool — one press left the draft painted and the tool still armed.
      pointer.current = null;
      setEditing(null);
      try { chartRef.current?.applyOptions({ handleScroll: true, handleScale: true }); } catch {
        /* the chart is gone; nothing to restore */
      }
      e.preventDefault();
      return;
    }
    if (k === 'escape' && (tool || draft)) {
      // Escape abandons the tool and any half-drawn mark before it reaches fullscreen or a menu. Pan and
      // zoom are restored here as well, because a DRAW drag may be the thing being abandoned: nulling the
      // ref makes `up` return early, which would otherwise leave the grab in place and the chart frozen.
      setTool(null);
      setDraft(null);
      pointer.current = null;
      try { chartRef.current?.applyOptions({ handleScroll: true, handleScale: true }); } catch {
        /* the chart is gone; nothing to restore */
      }
      e.preventDefault();
      return;
    }
    if (k === 'escape' && full) { setFull(false); e.preventDefault(); }
  };

  // What a drag would do if it started here: reshape an end, or move the whole mark. Stated by the
  // cursor, because a chart that reshapes on drag while showing a grab cursor is one master cannot read.
  const editCursor = hoverEdit === 'resize' ? 'nwse-resize'
    : (hoverEdit === 'move' ? 'move' : undefined);

  const chip = (on) => ({
    padding: '2px 8px', fontSize: '12px', borderRadius: '999px', cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
    color: on ? 'var(--accent)' : 'var(--muted)',
    whiteSpace: 'nowrap',
  });

  const seg = (on) => ({
    padding: '3px 9px', fontSize: '12px', cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
    color: on ? 'var(--accent)' : 'var(--muted)',
    borderRadius: '4px', fontWeight: on ? 700 : 400, minWidth: '34px',
    fontVariantNumeric: 'tabular-nums',
  });

  // EVERY window, not only the servable ones (Section 107). Master overrode the earlier design: the
  // control was refusing on his behalf. The ones past the provider cap are marked rather than hidden.
  const allowedRanges = useMemo(() => allRangesFor(interval), [interval]);
  const shortfall = useMemo(
    () => (rangeId ? shortfallNote(interval, rangeId, candles.length) : null),
    [interval, rangeId, candles.length],
  );
  const limitNote = useMemo(() => describeLimit(interval), [interval]);
  const shortfalls = useMemo(() => active
    .map((id) => overlayShortfall(id, candles.length, isIntraday, activeParams[id]))
    .filter(Boolean),
  [active, candles.length, isIntraday, activeParams]);

  const shell = full
    ? {
      position: 'fixed', inset: 0, zIndex: 900, background: 'var(--bg, #0b0e14)',
      padding: '12px 16px', overflow: 'auto',
    }
    // A flex column so the canvas can take what the toolbars leave. `minHeight: 0` is load-bearing: a
    // flex child without it is sized by its content and the measurement below would never shrink.
    : (fillHeight ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } : {});

  return (
    // The OUTER div owns the keyboard, not the document. A document-level listener would swallow
    // "l" and "r" while master types a symbol into the field above.
    <div ref={shellRef} style={shell} onKeyDown={onKeyDown} tabIndex={0} role="group"
         aria-label={`Price chart for ${symbol || 'the selected symbol'}. `
           + 'Press 1 to 6 for chart type, L for log scale, V for volume, '
           + 'open and close bracket to widen or narrow the candles, R to reset zoom, '
           + 'F for fullscreen.'}>

      {/* ── Identity and last price. Previously the only header was the symbol and the interval
             string, so the number master looks at first was not on the chart at all. ── */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap',
        padding: '0 0 6px', fontSize: '12px', color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--text)', fontSize: '14px', letterSpacing: '0.02em' }}>
          {symbol || '—'}
        </strong>
        <span style={{ textTransform: 'uppercase' }}>
          {intervalDef(interval)?.label || interval}{rangeId ? ` · ${rangeId}` : ''}
        </span>
        {last && (
          <span style={{ color: 'var(--text)', fontSize: '14px', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums' }}>
            {numberFmt(last.close)}
          </span>
        )}
        {change !== null && (
          <span style={{
            color: change >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {change >= 0 ? '+' : ''}{numberFmt(change)}
            {changePct !== null && ` (${change >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {candles.length.toLocaleString()} bars<InfoTip id="bars" />
        </span>

        {/* ── WHAT THE ZOOM ACTUALLY IS (Section 122) ─────────────────────────────────────────────
               Master reported the default zoom wrong three times and there was no way for either of us
               to say what it was — so each fix was a guess at a number nothing on screen reported. This
               is measured off the chart's own visible range, not restated from what was requested, and
               it turns "the zoom is wrong" into "it says 3px and I want 12". ── */}
        {zoom?.text && (
          <span style={{
            fontVariantNumeric: 'tabular-nums',
            color: zoom.note ? 'var(--amber)' : 'var(--muted)',
          }} title={`Measured from the chart, not the value asked for. Target ${barPx}px per candle `
            + `(${densityById(density)?.label || density}) — change it under `
            + `${CHART_TYPES.find((t) => t.id === chartType)?.label || 'Candles'}, or press [ and ].`
            + (zoom.note ? `\n\n${zoom.note}` : '')}>
            {zoom.text}{zoom.note ? ' ⚠' : ''}
          </span>
        )}
        {busy && <span style={{ color: 'var(--accent)' }}>loading…</span>}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={resetZoom} style={chip(false)}
                title="Back to a readable candle width (r)">reset zoom</button>
        <button type="button" onClick={zoomAll} style={chip(false)}
                title="Squeeze the entire loaded history into view">fit all</button>
        <button type="button" onClick={() => setVolOn((v) => !v)} style={chip(volOn)}
                aria-pressed={volOn}
                title={volOn ? 'Hide the volume pane and give price its height back (v)'
                  : 'Show volume in its own pane (v)'}>volume</button>
        <button type="button" onClick={saveImage} style={chip(false)}
                title="Save the chart canvas as a PNG. The toolbars and notes are not in the image.">
          ⤓ png
        </button>

        {/* ── DRAWING TOOLS (Section 121) ──────────────────────────────────────────────────────
            Master's OWN marks, in one colour that is not any of Rāma's, so his reasoning stays
            distinguishable from the engine's. Collapsed into a menu for the same reason the appearance
            controls are: eight more always-visible buttons above a 400px chart is its own defect. */}
        <div style={{ position: 'relative' }}>
          <button type="button" style={chip(!!tool || drawings.length > 0)}
                  aria-expanded={drawOpen} aria-haspopup="true"
                  onClick={() => { setDrawOpen((v) => !v); setMenuOpen(false); setViewOpen(false); }}
                  title="Your own lines, zones and notes. Stored per symbol, so they survive an interval change.">
            ✎ draw{tool ? `: ${DRAW.TOOLS[tool].label}` : ''}
            {drawings.length > 0 ? ` (${drawings.length})` : ''} ▾
          </button>
          <InfoTip id="chartNote" />
          {drawOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: '4px',
              background: 'var(--panel, #131722)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius, 6px)', padding: '6px', minWidth: '260px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }} role="group" aria-label="Drawing tools">
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '2px 6px 4px' }}>
                TOOL — click once to arm, drag on the chart
              </div>
              {DRAW.TOOL_IDS.map((id) => (
                <button key={id} type="button"
                        onClick={() => setTool((t) => (t === id ? null : id))}
                        aria-pressed={tool === id}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '4px 6px', fontSize: '12.5px', cursor: 'pointer',
                          background: tool === id
                            ? 'color-mix(in srgb, var(--magenta) 18%, transparent)' : 'transparent',
                          border: 'none', borderRadius: '4px',
                          color: tool === id ? 'var(--text)' : 'var(--text-dim, var(--muted))',
                        }}
                        title={DRAW.TOOLS[id].hint}>
                  {DRAW.TOOLS[id].label}
                  <span style={{ float: 'right', color: 'var(--muted)', fontSize: '12px' }}>
                    {DRAW.TOOLS[id].key}
                  </span>
                </button>
              ))}
              <div style={{ display: 'flex', gap: '4px', padding: '6px 4px 2px',
                borderTop: '1px solid var(--border)', marginTop: '4px' }}>
                <button type="button" style={seg(false)} onClick={() => setTool(null)}
                        title="Back to the crosshair (Escape)">✕ done</button>
                <button type="button" style={seg(false)}
                        onClick={() => setDrawings((l) => DRAW.undo(l))}
                        title="Remove the most recent unlocked mark (z)">↶ undo</button>
                {selectedId && (
                  <>
                    <button type="button" style={seg(false)}
                            onClick={() => { setDrawings((l) => DRAW.remove(l, selectedId));
                              setSelectedId(null); }}
                            title="Delete the selected mark (Delete)">🗑 delete</button>
                    <button type="button" style={seg(false)}
                            onClick={() => setDrawings((l) => DRAW.toggleLock(l, selectedId))}
                            title="A locked mark cannot be selected, deleted by undo, or cleared">
                      🔒 lock
                    </button>
                  </>
                )}
                {drawings.length > 0 && (
                  <button type="button" style={seg(false)}
                          onClick={() => { setDrawings((l) => DRAW.clear(l)); setSelectedId(null); }}
                          title="Remove every unlocked mark on this symbol. Locked ones survive.">
                    clear
                  </button>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '4px 6px 2px',
                lineHeight: 1.5 }}>
                Your marks, not Rāma&rsquo;s — stored per symbol and anchored to time and price, so they
                stay put through a zoom, a window change or a different interval.
                <br />
                Drag a selected mark to move it, drag one of its handles to reshape it, double-click a
                note to rewrite it. A locked mark does none of the three.
              </div>
            </div>
          )}
        </div>
        <button type="button" onClick={() => setFull((v) => !v)} style={chip(full)}
                aria-pressed={full}
                title={full ? 'Leave fullscreen (f or Escape)' : 'Fill the window (f)'}>
          {full ? '⤡ exit' : '⛶ fullscreen'}
        </button>
      </div>

      {/* ── Timeframe. Rendered only when the parent supplies handlers, so a read-only panel does
             not grow controls that cannot do anything. ── */}
      {(onInterval || onRange) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '6px' }}>
          {onInterval && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '12px',
                color: 'var(--muted)' }}>
                BAR<InfoTip id="interval" />
              </span>
              {/* Groups are LABELLED BY PURPOSE, not by unit (Section 104): "intraday / swing / long
                  term" is the distinction master is making when he reaches for the control, and it is
                  how trading platforms describe the same three clusters. */}
              {intervalGroups().map((g) => (
                <div key={g.group} style={{ display: 'flex', gap: '3px', alignItems: 'baseline' }}
                     role="group" aria-label={`Bar interval — ${g.label}`}>
                  {g.items.map((iv) => (
                    <button key={iv.id} type="button" style={seg(iv.id === interval)}
                            aria-pressed={iv.id === interval}
                            onClick={() => onInterval(iv.id)}
                            title={`${iv.label} bars — ${g.label}`}>
                      {iv.label}
                    </button>
                  ))}
                  <span style={{ fontSize: '12px', color: 'var(--muted)', paddingLeft: '2px' }}>
                    {g.label}
                  </span>
                </div>
              ))}
            </div>
          )}
          {onRange && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}
                 role="group" aria-label="Lookback window">
              <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '12px',
                color: 'var(--muted)', paddingRight: '4px' }}>
                BACK<InfoTip id="window" />
              </span>
              {/* CLICKING THE SELECTED WINDOW CLEARS IT (Section 107), at master's instruction — the
                  filter comes off entirely and the chart shows everything stored. A preset is a
                  convenience, not a constraint. `⚠` marks a window deeper than free data serves; it is
                  still selectable, and the note below says what actually arrived. */}
              {allowedRanges.map((rg) => (
                <button key={rg.id} type="button" style={seg(rg.id === rangeId)}
                        aria-pressed={rg.id === rangeId}
                        onClick={() => onRange(rg.id === rangeId ? null : rg.id)}
                        title={rg.id === rangeId
                          ? 'Selected — click again to remove the date filter and show everything stored'
                          : `${rg.id} of ${intervalDef(interval)?.label || interval} bars — about `
                            + `${rg.bars.toLocaleString()} bars`
                            + (rg.beyondCap ? '. Deeper than free data serves; Rāma will request it and '
                              + 'report what actually arrived.' : '')}>
                  {rg.label}{rg.beyondCap && <span style={{ color: 'var(--amber)' }}> ⚠</span>}
                </button>
              ))}
              <button type="button" style={seg(!rangeId && !fromDate && !toDate)}
                      aria-pressed={!rangeId && !fromDate && !toDate}
                      onClick={() => onRange(null)}
                      title="No date filter at all — every bar Rāma holds for this interval">
                ALL
              </button>

              {/* THE DATE PICKER (Section 105). Master asked for one, and it is also the trading-app
                  convention: preset buttons for the common windows, plus manual entry for a specific
                  span. The presets SET these fields, so the two can never disagree — and a typed date
                  un-highlights the presets rather than leaving a button lit that no longer describes
                  what is on screen. */}
            </div>
          )}

          {/* ── DATES: their own row, and an independent filter (Section 110) ───────────────────
              Master: "based on time interval and time frame can be individually selected, like
              individual filters not dependent on each other." So the interval no longer reconciles
              the window and the window no longer constrains the interval — they are two filters over
              one series. `coverage` gives the picker real bounds, so master can see what exists rather
              than guessing, and "beginning" is one click instead of a date he has to know. */}
          {onDates && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '12px',
                color: 'var(--muted)', minWidth: '44px' }}>
                DATES<InfoTip id="window" />
              </span>
              <input id={`${chartId}-from`} className="input" type="date" value={fromDate || ''}
                     aria-label="From date"
                     min={coverage?.first || undefined}
                     max={toDate || coverage?.last || undefined}
                     onChange={(e) => onDates(e.target.value, toDate)}
                     style={{ width: '138px', fontSize: '12px', padding: '2px 5px' }} />
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>→</span>
              <input id={`${chartId}-to`} className="input" type="date" value={toDate || ''}
                     aria-label="To date"
                     min={fromDate || coverage?.first || undefined}
                     onChange={(e) => onDates(fromDate, e.target.value)}
                     style={{ width: '138px', fontSize: '12px', padding: '2px 5px' }} />

              {coverage?.first && (
                <button type="button" style={seg(false)}
                        onClick={() => onDates(coverage.first, toDate)}
                        title={`Earliest stored bar: ${coverage.first}`}>⇤ beginning</button>
              )}
              <button type="button" style={seg(false)}
                      onClick={() => onDates(fromDate, todayYmd())}
                      title="Bring the end of the window up to today">today ⇥</button>
              {(fromDate || toDate) && (
                <button type="button" style={seg(false)} onClick={() => onDates('', '')}
                        title="Remove the date filter — every bar Rāma holds for this interval">
                  ✕ clear
                </button>
              )}

              {(fromDate || toDate) && !rangeId && (
                <span style={{ fontSize: '12px', color: 'var(--accent)' }}>custom</span>
              )}
              {!fromDate && !toDate && (
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  no date filter · everything stored
                </span>
              )}
              {coverage?.first && (
                <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: 'auto' }}>
                  stored {coverage.first} → {coverage.last || 'now'}
                </span>
              )}

              {limitNote && (
                <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '8px' }}
                      title={limitNote}>
                  max {intervalDef(interval)?.label} depth reached
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Presentation, then evidence layers. Two groups, because "how it is drawn" and "what is
             drawn on it" are different decisions and mixing them made the old chip row read as a
             pile of unrelated switches. ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingBottom: '6px',
      }}>
        {/* CHART TYPE AND SCALE ARE IN A MENU, NOT EIGHT MORE BUTTONS (Section 102).
            The first draft of this toolbar put nine intervals, ten windows, five chart types, three
            scales, an indicator menu and five chips above a 400px chart — about thirty controls, which
            is its own usability defect however capable each one is. The timeframe rows stay visible
            because they are what master changes constantly; presentation is a setting he picks once,
            so it collapses. The current choice is in the button label, so nothing is hidden. */}
        <div style={{ position: 'relative' }}>
          <button type="button" style={chip(viewOpen)}
                  aria-expanded={viewOpen} aria-haspopup="true"
                  onClick={() => { setViewOpen((v) => !v); setMenuOpen(false); }}
                  title="How the price is drawn, and which price scale is used">
            {CHART_TYPES.find((t) => t.id === chartType)?.label || 'Candles'}
            {scaleMode !== 'normal' ? ` · ${SCALE_MODES.find((m) => m.id === scaleMode)?.label}` : ''} ▾
          </button>
          {viewOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: '4px',
              background: 'var(--panel, #131722)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius, 6px)', padding: '6px', minWidth: '200px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }} role="group" aria-label="Chart appearance">
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '2px 6px 4px' }}>
                DRAW AS
              </div>
              <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', padding: '0 4px 6px' }}>
                {CHART_TYPES.map((t) => (
                  <button key={t.id} type="button" style={seg(t.id === chartType)}
                          aria-pressed={t.id === chartType}
                          onClick={() => setChartType(t.id)}
                          title={`${t.label} (press ${t.key})`}>
                    {t.label}
                  </button>
                ))}
              </div>
              {/* ── CANDLE WIDTH, AS A SETTING (Section 122) ───────────────────────────────────────
                     The default zoom was reported wrong in Sections 110, 119 and again after 121. A
                     single number I pick is a number I will keep picking wrongly; this is master's to
                     set, Rāma remembers it per browser, and the measured result is in the header. The
                     options are named by intent because nobody wants "16 pixels", they want to see the
                     candles or to see the year. ── */}
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '2px 6px 4px',
                borderTop: '1px solid var(--border)' }}>
                CANDLE WIDTH<InfoTip id="zoom" />
              </div>
              <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', padding: '0 4px 4px' }}>
                {DENSITIES.map((d) => (
                  <button key={d.id} type="button" style={seg(d.id === density)}
                          aria-pressed={d.id === density}
                          onClick={() => setDensity(d.id)}
                          title={`${d.px}px per candle — ${d.hint}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '0 6px 6px',
                lineHeight: 1.5 }}>
                {densityById(density)?.hint}
                {' '}Applies on open and on <em>reset zoom</em>; the brackets <kbd>[</kbd>{' '}
                <kbd>]</kbd> step it. A short series leaves the rest of the pane empty rather than
                stretching a few bars across it.
              </div>

              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '2px 6px 4px',
                borderTop: '1px solid var(--border)' }}>
                PRICE SCALE
              </div>
              <div style={{ display: 'flex', gap: '3px', padding: '0 4px 4px' }}>
                {SCALE_MODES.map((m) => (
                  <button key={m.id} type="button" style={seg(m.id === scaleMode)}
                          aria-pressed={m.id === scaleMode}
                          onClick={() => setScaleMode(m.id)} title={m.title}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '4px 6px 2px',
                borderTop: '1px solid var(--border)', lineHeight: 1.5 }}>
                {SCALE_MODES.find((m) => m.id === scaleMode)?.title}
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button type="button" style={chip(active.length > 0)}
                  aria-expanded={menuOpen} aria-haspopup="true"
                  onClick={() => { setMenuOpen((v) => !v); setViewOpen(false); }}
                  title="Overlays computed from the bars on screen — never a forecast">
            indicators{active.length > 0 ? ` (${active.length})` : ''} ▾
          </button>
          <InfoTip id="overlay" />
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: '4px',
              background: 'var(--panel, #131722)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius, 6px)', padding: '6px', minWidth: '248px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }}>
              {available.map((o) => {
                const on = active.includes(o.id);
                // THE FIELDS APPEAR ONLY UNDER AN ENABLED STUDY. Twenty-two studies' worth of number
                // boxes open at once is a form, not a menu, and master is here to read a chart.
                const fields = on ? (o.params || []) : [];
                // NAMED `shortfall`, NOT `note`: `note` is the open note editor's state in this same
                // component, and a local called `note` here would read as that state to anyone editing
                // this menu later — the two features that added them landed one after the other.
                const shortfall = on
                  ? overlayShortfall(o.id, candles.length, isIntraday, overlayParams[o.id]) : null;
                return (
                  <div key={o.id}>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px',
                      fontSize: '12.5px', color: 'var(--text)', cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={on}
                             onChange={() => toggleOverlay(o.id)} />
                      {labelFor(o, overlayParams[o.id])}
                      {o.pane === 'oscillator' && (
                        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--muted)' }}>
                          own pane
                        </span>
                      )}
                    </label>
                    {fields.length > 0 && (
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
                        padding: '0 6px 6px 24px',
                      }}>
                        {fields.map((f) => (
                          <label key={f.key} style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            fontSize: '11.5px', color: 'var(--muted)',
                          }}>
                            {f.label}
                            <input className="input" type="number"
                                   value={overlayParams[o.id]?.[f.key] ?? f.default}
                                   min={f.min} max={f.max} step={f.step}
                                   aria-label={`${labelFor(o, overlayParams[o.id])} ${f.label}`}
                                   onChange={(e) => setOverlayParam(o.id, f.key, e.target.value)}
                                   style={{ width: '62px', fontSize: '11.5px', padding: '1px 4px' }} />
                          </label>
                        ))}
                        <InfoTip id="indicatorPeriod" />
                        {/* The consequence of the number he just typed, beside the number — the same
                            sentence the chart shows below itself, so there is one wording for it. */}
                        {shortfall && (
                          <div style={{ flexBasis: '100%', fontSize: '11.5px', lineHeight: 1.45,
                            color: 'var(--amber)' }}>
                            {shortfall}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{
                fontSize: '12px', color: 'var(--muted)', padding: '6px 6px 2px',
                borderTop: '1px solid var(--border)', marginTop: '4px', lineHeight: 1.5,
              }}>
                Each of these is arithmetic on the bars above. Forecasts come from the engine and are
                drawn separately.
              </div>
            </div>
          )}
        </div>

        <span style={{ flex: 1 }} />

        {/* HIDDEN WHEN THERE IS NOTHING TO SHADE, which on a daily chart is always: a toggle for a
            thing that cannot appear is a control master would press to no effect. */}
        {bands.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button type="button" onClick={() => toggle('sessions')} style={chip(layers.sessions)}
                    aria-pressed={layers.sessions}>
              sessions ({bands.length})
            </button>
            <InfoTip id="sessionBand" />
          </span>
        )}
        {(fills || []).length > 0 && (
          <button type="button" onClick={() => toggle('fills')} style={chip(layers.fills)}
                  aria-pressed={layers.fills}>
            your fills ({fills.length})
          </button>
        )}
        {(signal || thesis) && (
          <button type="button" onClick={() => toggle('levels')} style={chip(layers.levels)}
                  aria-pressed={layers.levels}>
            levels
          </button>
        )}
        {cone?.ok && (
          <button type="button" onClick={() => toggle('cone')} style={chip(layers.cone)}
                  aria-pressed={layers.cone}>
            projection {cone.tilted ? '' : '(flat)'}
          </button>
        )}
      </div>

      {/* ── The canvas. ALWAYS MOUNTED; the empty state sits over it (Section 107). ── */}
      <div style={{ position: 'relative' }}>
        {empty && vacancy && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', flexDirection: 'column', gap: '10px',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)', fontSize: '12.5px', border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)', textAlign: 'center', padding: '0 16px',
            background: 'var(--panel, #131722)', overflow: 'auto',
          }} aria-live="polite">
            {/* A DIAGNOSED FAILURE IS RED, a wrong window is amber, an absence is muted. Master has
                never had a completed engine run, so `failed` is the state he actually sees, and it
                must not look like the chart merely has nothing yet. */}
            <span style={{ maxWidth: '62ch', lineHeight: 1.6,
              color: vacancy.kind === 'failed' ? 'var(--red)'
                : vacancy.kind === 'nothing-in-window' ? 'var(--amber)' : 'var(--muted)' }}>
              {vacancy.kind === 'failed' ? '✕ ' : ''}{vacancy.headline}
            </span>
            {/* Only printed when the headline does not already contain it — the bridge usually folds
                the remedy into its sentence, but a route-level failure carries the reason alone. */}
            {vacancy.remedy && (
              <span style={{ maxWidth: '62ch', lineHeight: 1.6, color: 'var(--amber)' }}>
                {vacancy.remedy}
              </span>
            )}
            {vacancy.action?.id === 'fetch' && onFetch && (
              <button type="button" className="btn" onClick={() => onFetch()}>
                {vacancy.action.label}
              </button>
            )}
            {/* THE ACTION THAT CAN ACTUALLY HELP. Fetching cannot move bars into a window the provider
                does not serve, so for `nothing-in-window` the button clears the dates instead. */}
            {vacancy.action?.id === 'clear-dates' && onDates && (
              <button type="button" className="btn" onClick={() => onDates('', '')}>
                {vacancy.action.label}
              </button>
            )}
            {vacancy.detail && (
              <span style={{ maxWidth: '56ch', lineHeight: 1.5, color: 'var(--text-dim, var(--muted))',
                fontVariantNumeric: 'tabular-nums' }}>
                {vacancy.detail}
              </span>
            )}
            {vacancy.hint && (
              <span style={{ maxWidth: '44ch', lineHeight: 1.5 }}>{vacancy.hint}</span>
            )}
            {/* The engine's own last words, collapsed. Section 99 put these on the reply; two of the
                three charts used to drop them on the floor. */}
            {vacancy.tail.length > 0 && (
              <details style={{ maxWidth: '62ch', width: '100%', textAlign: 'left' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: '12px' }}>
                  engine output
                </summary>
                <pre style={{
                  margin: '6px 0 0', padding: '8px 10px', maxHeight: 120, overflow: 'auto',
                  background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)',
                  fontSize: '11.5px', color: 'var(--text-dim)', whiteSpace: 'pre-wrap',
                }}>{vacancy.tail.join('\n')}</pre>
              </details>
            )}
          </div>
        )}
        <>
          {/* The cursor states which mode the chart is in. A chart that draws on drag while still
              showing a grab cursor is a chart master cannot predict. */}
          <div ref={holder} style={{ width: '100%', height: effectiveHeight,
            cursor: tool ? 'crosshair' : editCursor }}
               role="img"
               aria-label={`${CHART_TYPES.find((t) => t.id === chartType)?.label || 'Candlestick'}`
                 + ` chart for ${symbol || 'the selected symbol'}, `
                 + `${candles.length} ${intervalDef(interval)?.label || interval} bars`
                 + (last ? `, last ${numberFmt(last.close)}` : '')
                 + (changePct !== null ? `, ${changePct >= 0 ? 'up' : 'down'} `
                   + `${Math.abs(changePct).toFixed(2)} percent on the bar` : '')
                 + (active.length ? `, with ${active
                   .map((id) => labelFor(overlayById(id), activeParams[id])).join(', ')}`
                   : '')
                 + (fills?.length ? `, with ${fills.length} of your own fills marked` : '')
                 + (cone?.ok ? ', with a volatility projection drawn forward' : '')
                 + (layers.sessions && bandNote ? `, ${bandNote}` : '')} />

          {/* THE LEGEND SITS ON THE CHART, not under it. The previous readout was below the canvas,
              so reading a candle's values meant moving your eyes 400px away from the candle and
              back. Top-left over the plot is where every trading platform puts it, and it is
              `pointer-events: none` so it cannot steal a drag. */}
          <div style={{
            position: 'absolute', top: 6, left: 8, pointerEvents: 'none',
            fontSize: '12px', lineHeight: 1.6, fontVariantNumeric: 'tabular-nums',
            color: 'var(--text)', textShadow: '0 1px 3px rgba(0,0,0,0.75)',
          }} aria-hidden="true">
            {/* THE TIME IS NAMED WITH ITS ZONE (Section 118). The legend previously showed no time at
                all, so the only times on screen were the axis labels — which the library renders in
                UTC. A bare "09:15" is ambiguous between IST and UTC, and that ambiguity is what made
                Section 117's defect hard to see, so the zone travels with the reading. */}
            {tool && (
              <div style={{ color: 'var(--magenta)', marginBottom: '2px' }}>
                {DRAW.TOOLS[tool].label}: {DRAW.TOOLS[tool].points === 1
                  ? 'click to place' : 'drag to draw'} · Escape to cancel
              </div>
            )}
            {measured && (
              <div style={{ color: measured.up ? 'var(--green)' : 'var(--red)',
                marginBottom: '2px', fontWeight: 700 }}>
                {measured.text}
              </div>
            )}
            {chartType === 'heikin' && (
              // The warning rides on the chart, not in a tooltip on the menu item that selected it —
              // master will have forgotten the tooltip by the time he reads a level off a body.
              <div style={{ color: 'var(--amber)', marginBottom: '2px', maxWidth: '52ch' }}>
                Heikin-Ashi: averaged prices. Read direction, not levels.
              </div>
            )}
            {readout ? (
              <>
                <div style={{ color: 'var(--text-dim, var(--muted))', marginBottom: '2px' }}>
                  {formatStamp(readout.time)}
                  {showsClock(interval) && zoneLabel() ? ` ${zoneLabel()}` : ''}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--muted)' }}>O</span>{numberFmt(readout.open)}
                  <span style={{ color: 'var(--muted)' }}>H</span>{numberFmt(readout.high)}
                  <span style={{ color: 'var(--muted)' }}>L</span>{numberFmt(readout.low)}
                  <span style={{ color: 'var(--muted)' }}>C</span>
                  <strong style={{
                    color: readout.close >= readout.open ? 'var(--green)' : 'var(--red)',
                  }}>{numberFmt(readout.close ?? readout.value)}</strong>
                  {finite(readout.volume) && (
                    <>
                      <span style={{ color: 'var(--muted)' }}>V</span>
                      {readout.volume.toLocaleString()}
                    </>
                  )}
                </div>
                {Object.keys(readout.overlays || {}).length > 0 && (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap',
                    color: 'var(--text-dim, var(--muted))' }}>
                    {Object.entries(readout.overlays).map(([k, v]) => (
                      <span key={k}>{k} {numberFmt(v)}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--muted)' }}>
                hover a bar · scroll to zoom · drag to pan
              </span>
            )}
          </div>

          {/* ── THE NOTE EDITOR, WHERE A BLOCKING PROMPT USED TO BE (Section 123) ────────────────
              A plain focused input at the anchor's own pixel position, not a modal and not a system
              dialog: it is beside the bar it is about, it can be re-opened to EDIT a note that already
              exists, and it cannot block the renderer. Its own keydown stops propagating, so typing
              "f" is a letter rather than fullscreen and Escape abandons the note rather than also
              leaving fullscreen. */}
          {note && (
            <div style={{
              position: 'absolute', zIndex: 30,
              left: Math.max(2, Math.min(note.x + 8,
                Math.max(2, (holder.current?.clientWidth || 0) - 248))),
              top: Math.max(2, note.y - 12),
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <input className="input" type="text" autoFocus
                     value={note.text}
                     maxLength={DRAW.MAX_NOTE_CHARS}
                     aria-label={note.id ? 'Edit this note' : 'Note text'}
                     placeholder="why you did something"
                     onChange={(ev) => setNote((n) => (n ? { ...n, text: ev.target.value } : n))}
                     onKeyDown={(ev) => {
                       ev.stopPropagation();
                       if (ev.key === 'Enter') { ev.preventDefault(); settleNote(true); }
                       else if (ev.key === 'Escape') { ev.preventDefault(); settleNote(false); }
                     }}
                     onBlur={() => settleNote(true)}
                     style={{ width: '228px', fontSize: '12.5px', padding: '3px 6px',
                       borderColor: 'var(--magenta)' }} />
              <span style={{ fontSize: '12px', color: 'var(--muted)', whiteSpace: 'nowrap',
                textShadow: '0 1px 3px rgba(0,0,0,0.75)' }}>
                ⏎ keep · esc {note.id ? 'leave as it was' : 'drop'}
              </span>
            </div>
          )}
        </>
      </div>

      {/* The values again, in text, because the legend above is inside an aria-hidden overlay on a
          canvas and a canvas is not readable by assistive technology. */}
      <div aria-live="polite" style={{
        display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '6px 2px',
        fontSize: '12.5px', color: readout ? 'var(--text)' : 'var(--muted)',
        borderTop: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums',
      }}>
        {readout ? (
          <>
            {/* The accessible readout carries the time too, and names the zone — a screen reader
                cannot infer it from an axis label. */}
            <span>{formatStamp(readout.time)}
              {showsClock(interval) && zoneLabel() ? ` ${zoneLabel()}` : ''}</span>
            <span>O {numberFmt(readout.open)}</span>
            <span>H {numberFmt(readout.high)}</span>
            <span>L {numberFmt(readout.low)}</span>
            <span style={{
              color: readout.close >= readout.open ? 'var(--green)' : 'var(--red)',
              fontWeight: 700,
            }}>C {numberFmt(readout.close ?? readout.value)}</span>
            {finite(readout.volume) && <span>V {readout.volume.toLocaleString()}</span>}
          </>
        ) : (
          <span>
            Keys: 1–6 chart type · L log scale · V volume · [ ] candle width · R reset zoom ·
            F fullscreen. Click the chart first.
          </span>
        )}
      </div>

      {/* The provider served less than was asked for. Said plainly, because master can now select a
          window deeper than free data reaches and a short answer must not pass as a complete one. */}
      {shortfall && (
        <div style={{ fontSize: '12px', color: 'var(--amber)', padding: '2px', lineHeight: 1.6 }}>
          {shortfall}
        </div>
      )}

      {/* An overlay that drew nothing says so. A toggle that turns on and changes nothing visible is
          indistinguishable from a broken toggle. */}
      {shortfalls.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--amber)', padding: '2px', lineHeight: 1.5 }}>
          {shortfalls.map((s, i) => <div key={i}>{s}</div>)}
        </div>
      )}

      {cone?.ok && layers.cone && (
        <div style={{
          fontSize: '12px', color: 'var(--muted)', padding: '4px 2px', lineHeight: 1.5,
        }}>
          {cone.summary?.text}{' '}
          <span style={{ color: cone.tilted ? 'var(--accent)' : 'var(--text-dim)' }}>
            {cone.tiltReason}
          </span>
        </div>
      )}

      {/* Required by the charting library's licence. */}
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', padding: '2px' }}>
        Charting by{' '}
        <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer"
           style={{ color: 'var(--muted)' }}>TradingView Lightweight Charts</a>
      </div>
    </div>
  );
}
